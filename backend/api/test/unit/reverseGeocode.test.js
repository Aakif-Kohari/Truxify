/**
 * Comprehensive Unit Tests for backend/api/src/lib/reverseGeocode.js
 * Covers edge cases: null/non-finite coordinates, out-of-range values,
 * precision clamping bounds, cache hit paths, and network error resilience.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clampGeohashPrecision } from '../../src/lib/reverseGeocode.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { mockFetch, mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

global.fetch = mockFetch;

vi.mock('../../src/config/db.js', () => ({
  redisClient: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
}));

import { reverseGeocode } from '../../src/lib/reverseGeocode.js';

describe('reverseGeocode - Comprehensive Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Coordinate Validation & Null/Non-Finite Handling', () => {
    it('returns null for null lat', async () => {
      const result = await reverseGeocode(null, 72.5);
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null for null lon', async () => {
      const result = await reverseGeocode(23.0, null);
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null for undefined lat or lon', async () => {
      expect(await reverseGeocode(undefined, 72.5)).toBeNull();
      expect(await reverseGeocode(23.0, undefined)).toBeNull();
    });

    it('returns null for NaN lat or lon', async () => {
      expect(await reverseGeocode(NaN, 72.5)).toBeNull();
      expect(await reverseGeocode(23.0, NaN)).toBeNull();
    });

    it('returns null for Infinity or -Infinity lat/lng values', async () => {
      expect(await reverseGeocode(Infinity, 72.5)).toBeNull();
      expect(await reverseGeocode(-Infinity, 72.5)).toBeNull();
      expect(await reverseGeocode(23.0, Infinity)).toBeNull();
      expect(await reverseGeocode(23.0, -Infinity)).toBeNull();
    });

    it('returns null for out-of-range lat (< -90 or > 90)', async () => {
      expect(await reverseGeocode(90.1, 72.5)).toBeNull();
      expect(await reverseGeocode(-90.1, 72.5)).toBeNull();
      expect(await reverseGeocode(150.0, 72.5)).toBeNull();
    });

    it('returns null for out-of-range lon (< -180 or > 180)', async () => {
      expect(await reverseGeocode(23.0, 180.1)).toBeNull();
      expect(await reverseGeocode(23.0, -180.1)).toBeNull();
      expect(await reverseGeocode(23.0, 250.0)).toBeNull();
    });
  });

  describe('Caching & Network Behavior', () => {
    it('returns cached value from Redis cache hit path without making any network call', async () => {
      mockRedisGet.mockResolvedValue('MG Road, Cyber City, Indore');
      
      const result = await reverseGeocode(22.7196, 75.8577);
      
      expect(result).toBe('MG Road, Cyber City, Indore');
      expect(mockRedisGet).toHaveBeenCalledTimes(1);
      expect(mockRedisGet).toHaveBeenCalledWith('geocode:22.720,75.858');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls Nominatim API and caches result when cache misses', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisSet.mockResolvedValue('OK');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: { road: 'Rajwada', city: 'Indore' },
          display_name: 'Rajwada, Indore, Madhya Pradesh, India',
        }),
      });

      const result = await reverseGeocode(22.7196, 75.8577);
      
      expect(result).toBe('Rajwada, Indore');
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toContain('lat=22.720&lon=75.858');
      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'geocode:22.720,75.858',
        'Rajwada, Indore',
        'EX',
        604800
      );
    });

    it('returns null when Nominatim API returns non-ok response without throwing', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await reverseGeocode(22.7196, 75.8577);
      expect(result).toBeNull();
    });

    it('returns null on network error or fetch rejection without throwing', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new Error('ECONNRESET Network Timeout'));

      const result = await reverseGeocode(22.7196, 75.8577);
      expect(result).toBeNull();
    });

    it('returns null when Nominatim response lacks address and display_name data', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await reverseGeocode(22.7196, 75.8577);
      expect(result).toBeNull();
    });
  });
});

describe('clampGeohashPrecision - Boundary & Edge Cases', () => {
  it('returns DEF (6) for non-finite values (NaN, null, undefined, strings)', () => {
    expect(clampGeohashPrecision(NaN)).toBe(6);
    expect(clampGeohashPrecision(null)).toBe(6);
    expect(clampGeohashPrecision(undefined)).toBe(6);
    expect(clampGeohashPrecision('invalid')).toBe(6);
    expect(clampGeohashPrecision(Infinity)).toBe(6);
  });

  it('returns MIN (1) for values below 1 (<= 0, negative numbers)', () => {
    expect(clampGeohashPrecision(0)).toBe(1);
    expect(clampGeohashPrecision(-5)).toBe(1);
    expect(clampGeohashPrecision(-0.5)).toBe(1);
  });

  it('returns MAX (12) for values above 12', () => {
    expect(clampGeohashPrecision(13)).toBe(12);
    expect(clampGeohashPrecision(20)).toBe(12);
    expect(clampGeohashPrecision(100)).toBe(12);
  });

  it('passes through valid precision integers between 1 and 12', () => {
    expect(clampGeohashPrecision(1)).toBe(1);
    expect(clampGeohashPrecision(6)).toBe(6);
    expect(clampGeohashPrecision(12)).toBe(12);
    expect(clampGeohashPrecision(8)).toBe(8);
  });
});