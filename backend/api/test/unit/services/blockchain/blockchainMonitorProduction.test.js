import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

vi.mock('../../../../src/config/db.js', () => ({
  supabaseAdmin: null,
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
  redisClient: null,
}));

import BlockchainMonitor from '../../../../src/services/blockchain/blockchainMonitor.js';
import StateDivergenceDetector from '../../../../src/services/blockchain/stateDivergenceDetector.js';

const ESCROW_ABI = [
  'event BookingCreated(uint256 indexed bookingId, address indexed customer, address indexed driver, uint256 amount)',
  'event PaymentReleased(uint256 indexed bookingId, address indexed driver, uint256 amount)',
  'event BookingCancelled(uint256 indexed bookingId, address indexed customer, uint256 refundAmount)',
  'event BookingStarted(uint256 indexed bookingId, address indexed driver, uint256 amount)',
  'event BookingDisputed(uint256 indexed bookingId, address indexed raisedBy)',
  'event DisputeResolved(uint256 indexed bookingId, address indexed driver, uint256 driverAmount, address indexed customer, uint256 refundAmount)',
];

const iface = new ethers.Interface(ESCROW_ABI);

function createTestMonitor(overrides = {}) {
  const alertRouter = { route: vi.fn().mockResolvedValue(undefined) };
  const metricsService = {
    recordBlockScan: vi.fn(),
    recordBlockScanError: vi.fn(),
    recordPaymentEvent: vi.fn(),
  };
  const escalationHandler = { escalate: vi.fn().mockResolvedValue(undefined) };
  const checkpointStore = {
    saveCheckpoint: vi.fn().mockResolvedValue(undefined),
    loadCheckpoint: vi.fn().mockResolvedValue(null),
    storeEvent: vi.fn().mockResolvedValue(undefined),
    isEventProcessed: vi.fn().mockResolvedValue(false),
  };

  const monitor = new BlockchainMonitor({
    rpcUrl: 'https://rpc.example.com',
    contractAddress: '0x1111111111111111111111111111111111111111',
    alertRouter,
    metricsService,
    escalationHandler,
    checkpointStore,
    ...overrides,
  });

  return { monitor, alertRouter, metricsService, escalationHandler, checkpointStore };
}

describe('Blockchain Monitor Production Suite (Issue #11641)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Real TruxifyEscrow Event Parsing', () => {
    it('parses PaymentReleased and routes alert with booking details', async () => {
      const { monitor, alertRouter, metricsService } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 42n;
      const driver = '0x2222222222222222222222222222222222222222';
      const amount = 1000000000000000000n;

      const logDescription = iface.encodeEventLog(
        iface.getEvent('PaymentReleased'),
        [bookingId, driver, amount]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xrealtxhash1',
        index: 3,
        blockNumber: 1500,
        blockHash: '0xblockhash1500',
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PAYMENT_RELEASED',
          severity: 'LOW',
          bookingId: '42',
          driver,
          amount: amount.toString(),
          txHash: '0xrealtxhash1',
          logIndex: 3,
          blockNumber: 1500,
        })
      );
      expect(metricsService.recordPaymentEvent).toHaveBeenCalledWith('success');
    });

    it('parses BookingCancelled and routes alert with refund amount', async () => {
      const { monitor, alertRouter } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 43n;
      const customer = '0x3333333333333333333333333333333333333333';
      const refundAmount = 500000000000000000n;

      const logDescription = iface.encodeEventLog(
        iface.getEvent('BookingCancelled'),
        [bookingId, customer, refundAmount]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xrealtxhash2',
        index: 1,
        blockNumber: 1501,
        blockHash: '0xblockhash1501',
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BOOKING_CANCELLED',
          bookingId: '43',
          customer,
          refundAmount: refundAmount.toString(),
        })
      );
    });

    it('parses BookingStarted and routes alert', async () => {
      const { monitor, alertRouter } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 44n;
      const driver = '0x4444444444444444444444444444444444444444';
      const amount = 2000000000000000000n;

      const logDescription = iface.encodeEventLog(
        iface.getEvent('BookingStarted'),
        [bookingId, driver, amount]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xrealtxhash3',
        index: 0,
        blockNumber: 1502,
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BOOKING_STARTED',
          bookingId: '44',
          driver,
          amount: amount.toString(),
        })
      );
    });

    it('parses BookingDisputed and escalates HIGH severity alert', async () => {
      const { monitor, alertRouter, escalationHandler } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 45n;
      const raisedBy = '0x5555555555555555555555555555555555555555';

      const logDescription = iface.encodeEventLog(
        iface.getEvent('BookingDisputed'),
        [bookingId, raisedBy]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xrealtxhash4',
        index: 2,
        blockNumber: 1503,
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BOOKING_DISPUTED',
          severity: 'HIGH',
          bookingId: '45',
          raisedBy,
        })
      );
      expect(escalationHandler.escalate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BOOKING_DISPUTED',
          severity: 'HIGH',
          bookingId: '45',
        })
      );
    });

    it('parses DisputeResolved and routes settlement details', async () => {
      const { monitor, alertRouter } = createTestMonitor();
      monitor.setupEventHandlers();

      const bookingId = 46n;
      const driver = '0x6666666666666666666666666666666666666666';
      const driverAmount = 600000000000000000n;
      const customer = '0x7777777777777777777777777777777777777777';
      const refundAmount = 400000000000000000n;

      const logDescription = iface.encodeEventLog(
        iface.getEvent('DisputeResolved'),
        [bookingId, driver, driverAmount, customer, refundAmount]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xrealtxhash5',
        index: 4,
        blockNumber: 1504,
      };

      await monitor.processLog(log);

      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DISPUTE_RESOLVED',
          bookingId: '46',
          driver,
          driverAmount: driverAmount.toString(),
          customer,
          refundAmount: refundAmount.toString(),
        })
      );
    });
  });

  describe('2. Historical Backfill', () => {
    it('scans historical events from lastBlockScanned to current head on startListening', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(120),
        getBlock: vi.fn().mockResolvedValue({ hash: '0xblock120hash' }),
        getLogs: vi.fn().mockResolvedValue([]),
      };

      const { monitor, checkpointStore } = createTestMonitor({
        provider: mockProvider,
        contract: {},
      });

      monitor.lastBlockScanned = 100;
      const scanBlockRangeSpy = vi.spyOn(monitor, 'scanBlockRange');

      await monitor.startListening();

      // Verified: Scanned range 101 to 120 before starting live polling
      expect(scanBlockRangeSpy).toHaveBeenCalledWith(101, 120);
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(120, '0xblock120hash');
      expect(monitor.isListening).toBe(true);

      await monitor.stopListening();
    });

    it('respects configured startBlock when no checkpoint exists', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(200),
      };

      const { monitor } = createTestMonitor({
        provider: mockProvider,
        contract: {},
        startBlock: 150,
      });

      const initialized = await monitor.initialize();
      expect(initialized).toBe(true);
      expect(monitor.lastBlockScanned).toBe(150);
    });
  });

  describe('3. Durable Cursor & Checkpoint Resume', () => {
    it('resumes from persisted checkpoint on restart', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(300),
        getBlock: vi.fn().mockResolvedValue({ hash: '0xpersistedHash' }),
      };

      const { monitor, checkpointStore } = createTestMonitor({
        provider: mockProvider,
        contract: {},
      });

      checkpointStore.loadCheckpoint.mockResolvedValue({
        blockNumber: 250,
        blockHash: '0xpersistedHash',
      });

      await monitor.initialize();

      expect(monitor.lastBlockScanned).toBe(250);
    });
  });

  describe('4. Reorg Detection & Rewind', () => {
    it('detects block hash mismatch at checkpoint and rewinds by confirmation window', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(600),
        // Chain returned a different block hash for block 500 (reorg!)
        getBlock: vi.fn().mockResolvedValue({ hash: '0xCanonicalChainHash' }),
      };

      const { monitor, checkpointStore } = createTestMonitor({
        provider: mockProvider,
        contract: {},
        reorgRewindBlocks: 15,
      });

      checkpointStore.loadCheckpoint.mockResolvedValue({
        blockNumber: 500,
        blockHash: '0xOrphanedCheckpointHash',
      });

      await monitor.initialize();

      // Checkpoint was 500, reorg rewound by 15 to 485
      expect(monitor.lastBlockScanned).toBe(485);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Reorg detected at block 500')
      );
    });
  });

  describe('5. (transactionHash, logIndex) Deduplication', () => {
    it('skips processing and storing duplicate events on replay or reorg rescan', async () => {
      const { monitor, alertRouter, checkpointStore } = createTestMonitor();
      monitor.setupEventHandlers();

      const logDescription = iface.encodeEventLog(
        iface.getEvent('PaymentReleased'),
        [99n, '0x9999999999999999999999999999999999999999', 500n]
      );

      const log = {
        topics: logDescription.topics,
        data: logDescription.data,
        transactionHash: '0xuniqueTxHash',
        index: 2,
        blockNumber: 100,
      };

      // First run: processes event
      await monitor.processLog(log);
      expect(alertRouter.route).toHaveBeenCalledTimes(1);
      expect(checkpointStore.storeEvent).toHaveBeenCalledTimes(1);

      // Second run (duplicate replay): must skip
      await monitor.processLog(log);
      expect(alertRouter.route).toHaveBeenCalledTimes(1);
      expect(checkpointStore.storeEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. API Lifecycle & Multi-Loop Prevention', () => {
    it('manages listening lifecycle and prevents multiple polling loops', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(100),
      };

      const { monitor } = createTestMonitor({
        provider: mockProvider,
        contract: {},
      });

      await monitor.initialize();
      await monitor.startListening();
      expect(monitor.isListening).toBe(true);
      expect(monitor.pollTimer).not.toBeNull();

      const initialTimer = monitor.pollTimer;

      // Calling startListening again should warn and NOT create another interval
      await monitor.startListening();
      expect(monitor.pollTimer).toBe(initialTimer);

      await monitor.stopListening();
      expect(monitor.isListening).toBe(false);
      expect(monitor.pollTimer).toBeNull();
    });
  });

  describe('7. Health and Lag Reporting', () => {
    it('reports accurate health status, current chain head, and block lag', async () => {
      const mockProvider = {
        getBlockNumber: vi.fn().mockResolvedValue(1250),
      };

      const { monitor } = createTestMonitor({
        provider: mockProvider,
        contract: {},
      });

      monitor.isListening = true;
      monitor.lastBlockScanned = 1200;
      monitor.lastSuccessfulScan = '2026-09-14T19:00:00.000Z';

      const health = await monitor.getHealth();

      expect(health).toEqual({
        status: 'running',
        running: true,
        lastScannedBlock: 1200,
        currentChainHead: 1250,
        blockLag: 50,
        lastSuccessfulScan: '2026-09-14T19:00:00.000Z',
        lastError: null,
      });
    });
  });

  describe('8. Real State Divergence Detection', () => {
    it('detects on-chain vs off-chain state mismatch and emits actionable alert', async () => {
      const mockBatchCallBuilder = {
        buildPaymentStatusCall: vi.fn((bookingId) => ({
          target: '0xEscrow',
          callData: '0xcall',
          bookingId,
        })),
      };

      const mockMulticallService = {
        batchCalls: vi.fn().mockResolvedValue([
          // Order 1: DB says 'funded', but on-chain says 'Delivered' (1, paid: true) -> DIVERGENCE!
          {
            success: true,
            decoded: { status: 1, paid: true, started: true, amount: '1000' },
          },
          // Order 2: DB says 'funded', on-chain says 'Active' (0, paid: false) -> IN SYNC
          {
            success: true,
            decoded: { status: 0, paid: false, started: false, amount: '2000' },
          },
        ]),
      };

      const alertRouter = { route: vi.fn().mockResolvedValue(undefined) };
      const escalationHandler = { escalate: vi.fn().mockResolvedValue(undefined) };
      const mockSupabase = {
        from: vi.fn(() => ({
          insert: vi.fn().mockResolvedValue({ error: null }),
        })),
      };

      const detector = new StateDivergenceDetector({
        disableMonitoring: true,
        batchCallBuilder: mockBatchCallBuilder,
        multicallService: mockMulticallService,
        alertRouter,
        escalationHandler,
        supabase: mockSupabase,
      });

      const orders = [
        { id: 'order-diverged', bookingId: '101', escrow_status: 'funded', payment_status: 'locked' },
        { id: 'order-synced', bookingId: '102', escrow_status: 'funded', payment_status: 'locked' },
      ];

      const result = await detector.checkForDivergence(orders);

      expect(result.divergenceDetected).toBe(true);
      expect(result.count).toBe(1);
      expect(result.divergences[0].orderId).toBe('order-diverged');
      expect(result.divergences[0].severity).toBe('CRITICAL');
      expect(result.divergences[0].message).toContain("DB escrow_status is 'funded' but on-chain status is 'Delivered'");

      // Actionable alert routed
      expect(alertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BLOCKCHAIN_STATE_DIVERGENCE',
          severity: 'CRITICAL',
          orderId: 'order-diverged',
        })
      );

      // Escalation triggered
      expect(escalationHandler.escalate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BLOCKCHAIN_STATE_DIVERGENCE',
          orderId: 'order-diverged',
        })
      );

      // Logged to database
      expect(mockSupabase.from).toHaveBeenCalledWith('blockchain_divergence_log');
    });
  });
});
