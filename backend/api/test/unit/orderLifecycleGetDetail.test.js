import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/order/domainError.js', () => ({
  DomainError: class DomainError extends Error {
    constructor(status, payload) {
      super(payload?.error);
      this.status = status;
      this.payload = payload;
    }
  },
}));
vi.mock('../../src/services/order/deliveryVerificationService.js', () => ({
  DeliveryVerificationService: class DeliveryVerificationService {},
}));
vi.mock('../../src/services/notificationService.js', () => ({
  expireDeliveryOtps: vi.fn(),
  sendPushNotification: vi.fn(),
}));
vi.mock('../../src/lib/redisLock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));
vi.mock('../../src/lib/lockFallback.js', () => ({
  acquireLockOrFallback: vi.fn(),
}));
vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn((_name, operation) => operation()),
}));
vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {},
}));
vi.mock('../../src/services/escrow.js', () => ({
  submitEscrowRefund: vi.fn(),
  recordDepositTx: vi.fn(),
  submitEscrowCancelWithPenalty: vi.fn(),
  confirmEscrowRefund: vi.fn(),
  getEscrowBookingId: vi.fn(),
  resolveExpectedDepositAmount: vi.fn(),
  paisaToMaticWei: vi.fn(),
}));
vi.mock('../../src/lib/pricing.js', () => ({
  computeOrderPricing: vi.fn(),
}));
vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: vi.fn(),
}));
vi.mock('../../src/services/routingService.js', () => ({
  optimizeWaypoints: vi.fn(),
}));
vi.mock('../../src/services/ml.js', () => ({
  predictPrice: vi.fn(),
}));
vi.mock('../../src/services/trafficService.js', () => ({
  getLiveTrafficMultiplier: vi.fn(),
}));
vi.mock('../../src/core/events/index.js', () => ({
  eventBus: {},
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/lib/circuitBreaker.js', () => ({
  CircuitBreaker: class CircuitBreaker {
    execute(operation) {
      return operation();
    }
  },
}));
vi.mock('../../src/lib/orderDisplayId.js', () => ({
  generateOrderDisplayId: vi.fn(),
  ORDER_DISPLAY_ID_MAX_RETRIES: 3,
}));

const { OrderLifecycleService } = await import('../../src/services/order/orderLifecycleService.js');

describe('OrderLifecycleService.getOrderDetail', () => {
  let orderRepository;
  let orderTimelineService;
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    orderRepository = {
      findOrderByAnyId: vi.fn().mockResolvedValue({
        data: {
          id: 'order-uuid',
          order_display_id: 'ORD-123',
          customer_id: 'customer-1',
          driver_id: null,
          status: 'pending',
        },
        error: null,
      }),
    };
    orderTimelineService = {
      getTimeline: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    service = new OrderLifecycleService({
      orderRepository,
      orderTimelineService,
      bidAcceptanceService: {},
      deliveryVerificationService: {},
    });
  });

  it('selects only client-safe fields from the orders table', async () => {
    await service.getOrderDetail('ORD-123', 'customer-1');

    expect(orderRepository.findOrderByAnyId).toHaveBeenCalledTimes(1);
    const [, projection] = orderRepository.findOrderByAnyId.mock.calls[0];
    const selectedFields = projection.split(',').map(field => field.trim());

    expect(selectedFields).toEqual(expect.arrayContaining([
      'id',
      'order_display_id',
      'customer_id',
      'driver_id',
      'truck_id',
      'status',
      'pickup_address',
      'drop_address',
      'total_amount',
      'updated_at',
    ]));
    expect(selectedFields).not.toContain('*');
    expect(selectedFields).not.toEqual(expect.arrayContaining([
      'delivery_otp',
      'upi_id',
      'payment_method_id',
      'blockchain_tx_hash',
      'escrow_status',
      'escrow_amount_wei',
      'escrow_refund_amount',
      'escrow_release_attempts',
      'release_tx_hash',
      'refund_tx_hash',
    ]));
  });
});
