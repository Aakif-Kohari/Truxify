import { describe, it, expect } from 'vitest';
import driverEarningsService, {
  toAmount,
  calculateAverageEarnings,
  calculateCompletionRate,
  aggregateTripEarnings,
  calculateEarningsAggregation,
} from '../../../src/services/driverEarningsService.js';

describe('driverEarningsService', () => {
  describe('toAmount', () => {
    it('returns numeric value when finite', () => {
      expect(toAmount(100)).toBe(100);
      expect(toAmount('150.5')).toBe(150.5);
    });

    it('returns 0 for non-finite, null, or undefined values', () => {
      expect(toAmount(null)).toBe(0);
      expect(toAmount(undefined)).toBe(0);
      expect(toAmount(NaN)).toBe(0);
      expect(toAmount(Infinity)).toBe(0);
      expect(toAmount(-Infinity)).toBe(0);
      expect(toAmount('invalid')).toBe(0);
    });
  });

  describe('calculateAverageEarnings', () => {
    it('calculates average correctly for positive finite count', () => {
      expect(calculateAverageEarnings(1000, 4)).toBe(250);
    });

    it('returns 0 when count is zero, negative, or not finite', () => {
      expect(calculateAverageEarnings(1000, 0)).toBe(0);
      expect(calculateAverageEarnings(1000, -1)).toBe(0);
      expect(calculateAverageEarnings(1000, NaN)).toBe(0);
      expect(calculateAverageEarnings(1000, Infinity)).toBe(0);
      expect(calculateAverageEarnings(1000, null)).toBe(0);
      expect(calculateAverageEarnings(1000, undefined)).toBe(0);
    });

    it('returns 0 when totalEarnings is not finite', () => {
      expect(calculateAverageEarnings(NaN, 5)).toBe(0);
      expect(calculateAverageEarnings(Infinity, 5)).toBe(0);
      expect(calculateAverageEarnings(null, 5)).toBe(0);
    });
  });

  describe('calculateCompletionRate', () => {
    it('calculates completion rate correctly for positive finite totalTrips', () => {
      expect(calculateCompletionRate(8, 10)).toBe(0.8);
      expect(calculateCompletionRate(0, 10)).toBe(0);
      expect(calculateCompletionRate(10, 10)).toBe(1);
    });

    it('returns 0 when totalTrips is zero, negative, or not finite', () => {
      expect(calculateCompletionRate(5, 0)).toBe(0);
      expect(calculateCompletionRate(5, -2)).toBe(0);
      expect(calculateCompletionRate(5, NaN)).toBe(0);
      expect(calculateCompletionRate(5, Infinity)).toBe(0);
      expect(calculateCompletionRate(5, null)).toBe(0);
      expect(calculateCompletionRate(5, undefined)).toBe(0);
    });

    it('returns 0 when completedTrips is not finite', () => {
      expect(calculateCompletionRate(NaN, 10)).toBe(0);
      expect(calculateCompletionRate(Infinity, 10)).toBe(0);
      expect(calculateCompletionRate(null, 10)).toBe(0);
    });
  });

  describe('aggregateTripEarnings', () => {
    it('aggregates normal numeric trip earnings correctly', () => {
      const trips = [
        { total_earnings: 1000, net_earnings: 800, status: 'completed' },
        { total_earnings: 2000, net_earnings: 1600, status: 'completed' },
      ];

      const result = aggregateTripEarnings(trips);

      expect(result).toEqual({
        totalEarnings: 3000,
        netEarnings: 2400,
        tripCount: 2,
        averageEarnings: 1500,
        completionRate: 1,
      });
    });

    it('returns zeros with zero-division guards for empty trip lists', () => {
      const result = aggregateTripEarnings([]);

      expect(result).toEqual({
        totalEarnings: 0,
        netEarnings: 0,
        tripCount: 0,
        averageEarnings: 0,
        completionRate: 0,
      });
    });

    it('handles null or corrupted trips input safely', () => {
      const result = aggregateTripEarnings(null);

      expect(result).toEqual({
        totalEarnings: 0,
        netEarnings: 0,
        tripCount: 0,
        averageEarnings: 0,
        completionRate: 0,
      });
    });

    it('replaces NaN and Infinity earnings with 0 safely without producing NaN in averages', () => {
      const trips = [
        { total_earnings: NaN, net_earnings: Infinity, status: 'cancelled' },
        { total_earnings: 1000, net_earnings: -Infinity, status: 'completed' },
      ];

      const result = aggregateTripEarnings(trips);

      expect(result.totalEarnings).toBe(1000);
      expect(result.netEarnings).toBe(0);
      expect(result.tripCount).toBe(2);
      expect(result.averageEarnings).toBe(500);
      expect(result.completionRate).toBe(0.5);
    });
  });

  describe('calculateEarningsAggregation', () => {
    it('returns zeroed structure when trips is empty', () => {
      const result = calculateEarningsAggregation([], [], null);
      expect(result.gross_earnings).toBe(0);
      expect(result.net_earnings).toBe(0);
      expect(result.trips_completed).toBe(0);
      expect(result.average_earnings).toBe(0);
      expect(result.completion_rate).toBe(0);
      expect(result.weekly_chart).toHaveLength(7);
      expect(result.cumulative_stats.total_km).toBe(0);
      expect(result.cumulative_stats.avg_earning_per_km).toBe(0);
      expect(result.cumulative_stats.lifetime_trips).toBeNull();
      expect(result.deadhead_trips_saved).toBe(0);
    });

    it('returns zeroed structure when trips is null', () => {
      const result = calculateEarningsAggregation(null, null, null);
      expect(result.gross_earnings).toBe(0);
      expect(result.trips_completed).toBe(0);
      expect(result.average_earnings).toBe(0);
      expect(result.completion_rate).toBe(0);
      expect(result.cumulative_stats.avg_earning_per_km).toBe(0);
    });

    it('aggregates total_earnings, net_earnings, and averages correctly', () => {
      const trips = [
        { total_earnings: 1000, net_earnings: 800, distance: '100', trip_date: new Date().toISOString(), status: 'completed' },
        { total_earnings: 2000, net_earnings: 1500, distance: '150', trip_date: new Date().toISOString(), status: 'completed' },
      ];
      const result = calculateEarningsAggregation(trips, trips, 10);
      expect(result.gross_earnings).toBe(3000);
      expect(result.net_earnings).toBe(2300);
      expect(result.trips_completed).toBe(2);
      expect(result.average_earnings).toBe(1500);
      expect(result.completion_rate).toBe(1);
      expect(result.cumulative_stats.total_km).toBe(250);
      expect(result.cumulative_stats.avg_earning_per_km).toBeCloseTo(2300 / 250, 4);
    });

    it('treats NaN earnings and distance as 0 and avoids division by zero', () => {
      const trips = [
        { total_earnings: 'not-a-number', net_earnings: 'invalid', distance: '0', trip_date: null },
      ];
      const result = calculateEarningsAggregation(trips, trips, 1);
      expect(result.gross_earnings).toBe(0);
      expect(result.net_earnings).toBe(0);
      expect(result.cumulative_stats.total_km).toBe(0);
      expect(result.cumulative_stats.avg_earning_per_km).toBe(0);
    });

    it('increments deadhead_trips_saved for consecutive matching trips', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const trips = [{ trip_date: pastDate, route_label: 'A → B' }];
      const allTrips = [
        { trip_date: new Date(Date.now() - 2 * 86400000).toISOString(), route_label: 'X → A' },
        { trip_date: pastDate, route_label: 'A → B' },
      ];
      const result = calculateEarningsAggregation(trips, allTrips, 2);
      expect(result.deadhead_trips_saved).toBe(1);
    });

    it('passes lifetime_trips to cumulative_stats', () => {
      const result = calculateEarningsAggregation([], [], 42);
      expect(result.cumulative_stats.lifetime_trips).toBe(42);
    });
  });

  describe('default export', () => {
    it('exports all utility functions on the default object', () => {
      expect(typeof driverEarningsService.calculateAverageEarnings).toBe('function');
      expect(typeof driverEarningsService.calculateCompletionRate).toBe('function');
      expect(typeof driverEarningsService.aggregateTripEarnings).toBe('function');
      expect(typeof driverEarningsService.calculateEarningsAggregation).toBe('function');
      expect(typeof driverEarningsService.toAmount).toBe('function');
    });
  });
});
