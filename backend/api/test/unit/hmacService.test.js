import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const sharedRedisNonces = new Map();

vi.mock('ioredis', () => ({
  default: class MockRedis {
    async set(key, value, nx, ex, ttl) {
      if (nx !== 'NX' || ex !== 'EX' || ttl !== 300) {
        throw new Error('Unexpected Redis SET arguments');
      }
      if (sharedRedisNonces.has(key)) {
        return null;
      }
      sharedRedisNonces.set(key, value);
      return 'OK';
    }
  },
}));

process.env.REDIS_URL = 'redis://mock-hmac-test';
process.env.NODE_ENV = 'test';
process.env.HMAC_SECRET = 'a'.repeat(64);

const serviceA = await import('../../src/services/hmacService.js?instance=A');
const serviceB = await import('../../src/services/hmacService.js?instance=B');

afterAll(() => {
  delete process.env.REDIS_URL;
});

describe('hmacService distributed and bounded nonce protection', () => {
  beforeEach(() => {
    sharedRedisNonces.clear();
  });

  it('accepts a new nonce once and rejects the same nonce on another service instance', async () => {
    const nonce = `distributed-${Date.now()}`;
    expect(await serviceA.isNonceValid(nonce)).toBe(true);
    expect(await serviceB.isNonceValid(nonce)).toBe(false);
  });

  it('uses an atomic NX reservation with a five-minute expiration', async () => {
    const nonce = `ttl-${Date.now()}`;
    expect(await serviceA.isNonceValid(nonce)).toBe(true);
    expect(sharedRedisNonces.has(`truxify:hmac:nonce:${nonce}`)).toBe(true);
  });

  it('rejects empty, non-string, and oversized nonces', async () => {
    expect(await serviceA.isNonceValid('')).toBe(false);
    expect(await serviceA.isNonceValid(null)).toBe(false);
    expect(await serviceA.isNonceValid('x'.repeat(257))).toBe(false);
  });

  it('preserves timestamp validation', () => {
    const now = Date.now();
    expect(serviceA.isTimestampValid(now)).toBe(true);
    expect(serviceA.isTimestampValid(now - 6 * 60 * 1000)).toBe(false);
  });

  it('preserves HMAC signature verification', () => {
    const payload = 'payment-confirmation';
    const timestamp = Date.now();
    const nonce = 'signature-test';
    const signature = serviceA.generateSignature(payload, timestamp, nonce);

    expect(serviceA.verifySignature(signature, payload, timestamp, nonce)).toBe(true);
    expect(serviceA.verifySignature(signature, 'tampered', timestamp, nonce)).toBe(false);
  });

  it('fails closed when the HMAC secret is missing or too short', () => {
    delete process.env.HMAC_SECRET;
    expect(() => serviceA.generateSignature('payload', Date.now(), 'nonce')).toThrow(/HMAC_SECRET is required/);

    process.env.HMAC_SECRET = 'too-short';
    expect(() => serviceA.generateSignature('payload', Date.now(), 'nonce')).toThrow(/at least 32 bytes/);

    process.env.HMAC_SECRET = 'a'.repeat(64);
  });
});
