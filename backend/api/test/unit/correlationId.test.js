import { describe, it, expect, vi } from 'vitest';
import { correlationIdMiddleware, correlationContext, runWithCorrelationId, getCorrelationStore } from '../../src/middleware/correlationId.js';

function makeReq(headers = {}) {
  return {
    headers,
  };
}

function makeRes() {
  return {
    setHeader: vi.fn(),
    on: vi.fn(),
  };
}

describe('correlationIdMiddleware', () => {
  it('uses X-Correlation-ID header value when it is a non-empty string', () => {
    const req = makeReq({ 'x-correlation-id': 'my-custom-id-123' });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe('my-custom-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'my-custom-id-123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('trims whitespace from the header value', () => {
    const req = makeReq({ 'x-correlation-id': '  trimmed-id-456  ' });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe('trimmed-id-456');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'trimmed-id-456');
  });

  it('falls back to a random UUID when no X-Correlation-ID header is present', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Correlation-ID',
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    );
  });

  it('generates unique IDs per request', () => {
    const req1 = makeReq({});
    const req2 = makeReq({});
    const res1 = makeRes();
    const res2 = makeRes();
    correlationIdMiddleware(req1, res1, vi.fn());
    correlationIdMiddleware(req2, res2, vi.fn());
    expect(req1.correlationId).not.toBe(req2.correlationId);
  });

  it('sets the correlation ID in the AsyncLocalStorage context', () => {
    const req = makeReq({ 'x-correlation-id': 'context-test-id' });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    let storedId = null;
    correlationContext.run({ correlationId: 'context-test-id' }, () => {
      storedId = correlationContext.getStore()?.correlationId;
    });
    expect(req.correlationId).toBe('context-test-id');
  });

  it('uses header value as-is when it is a valid UUID', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const req = makeReq({ 'x-correlation-id': validUuid });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe(validUuid);
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', validUuid);
  });

  it('takes the first value when the header is an array', () => {
    const req = makeReq({ 'x-correlation-id': ['first-id-789', 'second-id-000'] });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe('first-id-789');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'first-id-789');
  });

  it('falls back to a random UUID when the array header has no usable string', () => {
    const req = makeReq({ 'x-correlation-id': [] });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('reads the header case-insensitively (X-Correlation-ID)', () => {
    const req = makeReq({ 'X-Correlation-ID': 'mixed-case-header-1' });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe('mixed-case-header-1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'mixed-case-header-1');
  });

  it('reads the header case-insensitively (x-correlation-ID)', () => {
    const req = makeReq({ 'x-correlation-ID': 'mixed-case-header-2' });
    const res = makeRes();
    const next = vi.fn();
    correlationIdMiddleware(req, res, next);
    expect(req.correlationId).toBe('mixed-case-header-2');
  });

  it('does not crash when res has no setHeader method', () => {
    const req = makeReq({ 'x-correlation-id': 'no-set-header-id' });
    const res = { on: vi.fn() };
    const next = vi.fn();
    expect(() => correlationIdMiddleware(req, res, next)).not.toThrow();
    expect(req.correlationId).toBe('no-set-header-id');
    expect(next).toHaveBeenCalledOnce();
  });
});


describe('runWithCorrelationId and getCorrelationStore', () => {
  describe('getCorrelationStore', () => {
    it('returns an empty object when called outside any correlation context', () => {
      const store = getCorrelationStore();
      expect(store).toEqual({});
      expect(store.correlationId).toBeUndefined();
    });

    it('returns the current store object containing correlationId within runWithCorrelationId', () => {
      runWithCorrelationId('test-corr-id-123', () => {
        const store = getCorrelationStore();
        expect(store).toEqual({ correlationId: 'test-corr-id-123' });
        expect(store.correlationId).toBe('test-corr-id-123');
      });
    });
  });

  describe('runWithCorrelationId', () => {
    it('propagates correlation ID synchronously to child function executions', () => {
      const result = runWithCorrelationId('sync-id-1', () => {
        expect(getCorrelationStore().correlationId).toBe('sync-id-1');
        return 'sync-result';
      });
      expect(result).toBe('sync-result');
      expect(getCorrelationStore().correlationId).toBeUndefined();
    });

    it('propagates correlation ID to async children across promises and awaits', async () => {
      await runWithCorrelationId('async-id-1', async () => {
        expect(getCorrelationStore().correlationId).toBe('async-id-1');

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(getCorrelationStore().correlationId).toBe('async-id-1');

        const nestedAsync = async () => {
          await new Promise((resolve) => setImmediate(resolve));
          return getCorrelationStore().correlationId;
        };

        const resolvedId = await nestedAsync();
        expect(resolvedId).toBe('async-id-1');
      });

      expect(getCorrelationStore().correlationId).toBeUndefined();
    });

    it('propagates correlation ID concurrently across Promise.all tasks', async () => {
      const task1 = runWithCorrelationId('task-1-id', async () => {
        await new Promise((r) => setTimeout(r, 15));
        return getCorrelationStore().correlationId;
      });

      const task2 = runWithCorrelationId('task-2-id', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getCorrelationStore().correlationId;
      });

      const [res1, res2] = await Promise.all([task1, task2]);
      expect(res1).toBe('task-1-id');
      expect(res2).toBe('task-2-id');
    });

    it('maintains separate contexts for nested calls and restores outer context on exit', () => {
      let outerBefore = null;
      let innerValue = null;
      let outerAfter = null;

      runWithCorrelationId('outer-scope-id', () => {
        outerBefore = getCorrelationStore().correlationId;

        runWithCorrelationId('inner-scope-id', () => {
          innerValue = getCorrelationStore().correlationId;
        });

        outerAfter = getCorrelationStore().correlationId;
      });

      expect(outerBefore).toBe('outer-scope-id');
      expect(innerValue).toBe('inner-scope-id');
      expect(outerAfter).toBe('outer-scope-id');
      expect(getCorrelationStore().correlationId).toBeUndefined();
    });

    it('handles undefined or null correlation ID without throwing', () => {
      runWithCorrelationId(undefined, () => {
        const store = getCorrelationStore();
        expect(store).toEqual({ correlationId: undefined });
      });

      runWithCorrelationId(null, () => {
        const store = getCorrelationStore();
        expect(store).toEqual({ correlationId: null });
      });
    });

    it('re-throws errors thrown inside fn while still cleaning up the context', () => {
      expect(() => {
        runWithCorrelationId('error-id', () => {
          expect(getCorrelationStore().correlationId).toBe('error-id');
          throw new Error('Custom execution failure');
        });
      }).toThrow('Custom execution failure');

      expect(getCorrelationStore().correlationId).toBeUndefined();
    });
  });
});

