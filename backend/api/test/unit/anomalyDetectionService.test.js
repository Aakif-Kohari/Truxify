import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              gte: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })),
          })),
        })),
      })),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    })),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: mockSupabase,
  supabaseAdmin: mockSupabase,
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn(async (name, fn) => fn()),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

import AnomalyDetectionService, {
  ANOMALY_THRESHOLDS,
  ANOMALY_SEVERITY,
} from '../../src/services/security/anomalyDetectionService.js';

describe('AnomalyDetectionService', () => {
  let service;
  let mockAlertRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAlertRouter = {
      route: vi.fn().mockResolvedValue([]),
    };
    service = new AnomalyDetectionService({ alertRouter: mockAlertRouter });
  });

  describe('isWithdrawalDirection', () => {
    it('correctly identifies withdrawal transactions case-insensitively', () => {
      expect(service.isWithdrawalDirection({ type: 'withdrawal' })).toBe(true);
      expect(service.isWithdrawalDirection({ type: 'WITHDRAWAL' })).toBe(true);
      expect(service.isWithdrawalDirection({ type: 'Withdrawal' })).toBe(true);
    });

    it('returns false for deposits, transfers, and undefined types', () => {
      expect(service.isWithdrawalDirection({ type: 'deposit' })).toBe(false);
      expect(service.isWithdrawalDirection({ type: 'transfer' })).toBe(false);
      expect(service.isWithdrawalDirection({})).toBe(false);
      expect(service.isWithdrawalDirection(null)).toBe(false);
    });
  });

  describe('detectUnusualTime', () => {
    it('detects transactions occurring during unusual UTC hours (0 to 6)', () => {
      const tx = { timestamp: '2026-09-15T02:30:00.000Z' };
      const anomaly = service.detectUnusualTime(tx);

      expect(anomaly).toBeDefined();
      expect(anomaly.type).toBe('UNUSUAL_TIME');
      expect(anomaly.severity).toBe('LOW');
      expect(anomaly.message).toContain('2:00 UTC');
    });

    it('returns null for transactions during normal business/daytime UTC hours', () => {
      const tx = { timestamp: '2026-09-15T14:15:00.000Z' };
      expect(service.detectUnusualTime(tx)).toBeNull();
    });
  });

  describe('calculateRiskLevel', () => {
    it('returns LOW when no anomalies are present', () => {
      expect(service.calculateRiskLevel([])).toBe('LOW');
    });

    it('evaluates CRITICAL, HIGH, and MEDIUM severities properly', () => {
      expect(service.calculateRiskLevel([{ severity: 'CRITICAL' }, { severity: 'LOW' }])).toBe('CRITICAL');
      expect(service.calculateRiskLevel([{ severity: 'HIGH' }, { severity: 'MEDIUM' }])).toBe('HIGH');
      expect(service.calculateRiskLevel([{ severity: 'MEDIUM' }])).toBe('MEDIUM');
      expect(service.calculateRiskLevel([{ severity: 'LOW' }])).toBe('LOW');
    });
  });

  describe('shouldBlockTransaction', () => {
    it('returns true when a LARGE_WITHDRAWAL or CRITICAL anomaly is flagged', () => {
      expect(service.shouldBlockTransaction([{ type: 'LARGE_WITHDRAWAL', severity: 'HIGH' }])).toBe(true);
      expect(service.shouldBlockTransaction([{ type: 'OTHER', severity: 'CRITICAL' }])).toBe(true);
    });

    it('returns false for non-blocking anomalies like UNUSUAL_TIME or MEDIUM transfers', () => {
      expect(service.shouldBlockTransaction([{ type: 'UNUSUAL_TIME', severity: 'LOW' }])).toBe(false);
      expect(service.shouldBlockTransaction([{ type: 'MULTIPLE_TRANSFERS', severity: 'MEDIUM' }])).toBe(false);
    });
  });

  describe('detectLargeWithdrawal', () => {
    it('returns null immediately if transaction is not a withdrawal', async () => {
      const depositTx = { type: 'deposit', amount: 50000 };
      const result = await service.detectLargeWithdrawal('usr-1', '0x123', depositTx);
      expect(result).toBeNull();
    });
  });

  describe('triggerSecurityAlert', () => {
    it('routes security alerts through alertRouter when configured', async () => {
      const anomalies = [{ type: 'LARGE_WITHDRAWAL', severity: 'HIGH' }];
      await service.triggerSecurityAlert('usr-1', '0xabc', anomalies, 'HIGH');

      expect(mockAlertRouter.route).toHaveBeenCalledTimes(1);
      expect(mockAlertRouter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WALLET_ANOMALY_DETECTED',
          severity: 'HIGH',
          userId: 'usr-1',
          walletAddress: '0xabc',
        })
      );
    });
  });

  describe('constants export', () => {
    it('exports ANOMALY_THRESHOLDS and ANOMALY_SEVERITY constants', () => {
      expect(ANOMALY_THRESHOLDS.LARGE_WITHDRAWAL).toBe(1000);
      expect(ANOMALY_SEVERITY.CRITICAL).toBe('CRITICAL');
    });
  });
});
