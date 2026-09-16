
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeatherService } from '../../src/services/weatherService.js';

describe('WeatherService', () => {
  let service;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    service = new WeatherService({ logger: mockLogger });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('stores the provided logger', () => {
      expect(service.logger).toBe(mockLogger);
    });

    it('can be created without a logger', () => {
      const instance = new WeatherService({});

      expect(instance.logger).toBeUndefined();
    });
  });

  describe('getWeatherForecast', () => {
    describe('cold weather branch', () => {
      it('returns cold weather when latitude is greater than 40', async () => {
        const result = await service.getWeatherForecast(45, 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('returns cold weather for a northern latitude of 41', async () => {
        const result = await service.getWeatherForecast(41, 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('returns cold weather for a high northern latitude', async () => {
        const result = await service.getWeatherForecast(90, 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('returns cold weather when latitude is less than -40', async () => {
        const result = await service.getWeatherForecast(-50, 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('returns cold weather for a southern latitude of -41', async () => {
        const result = await service.getWeatherForecast(-41, 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('returns cold weather for the southern extreme latitude', async () => {
        const result = await service.getWeatherForecast(-90, 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });
    });

    describe('warm weather branch', () => {
      it('returns warm weather for a latitude between -40 and 40', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather for latitude 0', async () => {
        const result = await service.getWeatherForecast(0, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather for a negative latitude above -40', async () => {
        const result = await service.getWeatherForecast(-30, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather at the positive boundary of 40', async () => {
        const result = await service.getWeatherForecast(40, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather at the negative boundary of -40', async () => {
        const result = await service.getWeatherForecast(-40, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather just inside the positive boundary', async () => {
        const result = await service.getWeatherForecast(39.999999, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns warm weather just inside the negative boundary', async () => {
        const result = await service.getWeatherForecast(-39.999999, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });
    });

    describe('latitude conversion', () => {
      it('accepts a numeric latitude supplied as a string', async () => {
        const result = await service.getWeatherForecast('25', 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('converts a numeric string above 40 to the cold branch', async () => {
        const result = await service.getWeatherForecast('45', 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('converts a numeric string below -40 to the cold branch', async () => {
        const result = await service.getWeatherForecast('-45', 72);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('treats an empty string latitude as the numeric value 0', async () => {
        const result = await service.getWeatherForecast('', 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });
    });

    describe('non-finite and invalid coordinates', () => {
      it('returns the warm default for NaN latitude', async () => {
        const result = await service.getWeatherForecast(NaN, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for positive Infinity latitude', async () => {
        const result = await service.getWeatherForecast(Infinity, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for negative Infinity latitude', async () => {
        const result = await service.getWeatherForecast(-Infinity, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for a non-numeric latitude', async () => {
        const result = await service.getWeatherForecast('not-a-number', 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for undefined latitude', async () => {
        const result = await service.getWeatherForecast(undefined, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for null latitude', async () => {
        const result = await service.getWeatherForecast(null, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for NaN longitude', async () => {
        const result = await service.getWeatherForecast(30, NaN);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for positive Infinity longitude', async () => {
        const result = await service.getWeatherForecast(30, Infinity);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for negative Infinity longitude', async () => {
        const result = await service.getWeatherForecast(30, -Infinity);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default for a non-numeric longitude', async () => {
        const result = await service.getWeatherForecast(30, 'invalid');

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default when longitude is undefined', async () => {
        const result = await service.getWeatherForecast(30, undefined);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('returns the warm default when longitude is null', async () => {
        const result = await service.getWeatherForecast(30, null);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });
    });

    describe('longitude handling', () => {
      it('does not use longitude to select the weather branch', async () => {
        const result = await service.getWeatherForecast(45, 0);

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });

      it('accepts a numeric longitude supplied as a string', async () => {
        const result = await service.getWeatherForecast(30, '72');

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('keeps cold weather for a valid northern latitude and string longitude', async () => {
        const result = await service.getWeatherForecast(50, '100');

        expect(result.temperature_c).toBe(-5);
        expect(result.condition).toBe('snow');
      });
    });

    describe('logger interaction', () => {
      it('calls logger.debug when a logger is provided', async () => {
        await service.getWeatherForecast(30, 72);

        expect(mockLogger.debug).toHaveBeenCalledTimes(1);
      });

      it('logs the latitude and longitude values', async () => {
        await service.getWeatherForecast(30, 72);

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[WeatherService] Fetching forecast for lat: 30, lng: 72'
        );
      });

      it('logs negative coordinates correctly', async () => {
        await service.getWeatherForecast(-45, -90);

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[WeatherService] Fetching forecast for lat: -45, lng: -90'
        );
      });

      it('logs string coordinates without changing the logged values', async () => {
        await service.getWeatherForecast('45', '72');

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[WeatherService] Fetching forecast for lat: 45, lng: 72'
        );
      });

      it('logs invalid coordinate values', async () => {
        await service.getWeatherForecast(NaN, Infinity);

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[WeatherService] Fetching forecast for lat: NaN, lng: Infinity'
        );
      });

      it('does not call other logger methods', async () => {
        await service.getWeatherForecast(30, 72);

        expect(mockLogger.info).not.toHaveBeenCalled();
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
      });

      it('works when logger is omitted', async () => {
        const instance = new WeatherService({});

        const result = await instance.getWeatherForecast(30, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });

      it('works when logger is explicitly undefined', async () => {
        const instance = new WeatherService({ logger: undefined });

        const result = await instance.getWeatherForecast(30, 72);

        expect(result.temperature_c).toBe(15);
        expect(result.condition).toBe('clear');
      });
    });

    describe('response structure', () => {
      it('returns an object', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result).toBeTypeOf('object');
      });

      it('returns exactly the expected response properties', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(Object.keys(result).sort()).toEqual([
          'condition',
          'forecast_time',
          'temperature_c',
        ]);
      });

      it('returns a numeric temperature', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.temperature_c).toBeTypeOf('number');
      });

      it('returns a string condition', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.condition).toBeTypeOf('string');
      });

      it('returns a string forecast_time', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.forecast_time).toBeTypeOf('string');
      });

      it('returns an ISO-formatted forecast_time', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result.forecast_time).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        );
      });

      it('returns a forecast_time that can be parsed as a valid date', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(Number.isNaN(Date.parse(result.forecast_time))).toBe(false);
      });

      it('returns snow condition together with the cold temperature', async () => {
        const result = await service.getWeatherForecast(45, 72);

        expect(result).toEqual(
          expect.objectContaining({
            temperature_c: -5,
            condition: 'snow',
          })
        );
      });

      it('returns clear condition together with the warm temperature', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result).toEqual(
          expect.objectContaining({
            temperature_c: 15,
            condition: 'clear',
          })
        );
      });
    });

    describe('deterministic behavior', () => {
      it('returns the same weather values for repeated warm requests', async () => {
        const first = await service.getWeatherForecast(20, 72);
        const second = await service.getWeatherForecast(20, 72);

        expect(first.temperature_c).toBe(second.temperature_c);
        expect(first.condition).toBe(second.condition);
      });

      it('returns the same weather values for repeated cold requests', async () => {
        const first = await service.getWeatherForecast(60, 72);
        const second = await service.getWeatherForecast(60, 72);

        expect(first.temperature_c).toBe(second.temperature_c);
        expect(first.condition).toBe(second.condition);
      });

      it('does not change behavior based on longitude', async () => {
        const first = await service.getWeatherForecast(30, -180);
        const second = await service.getWeatherForecast(30, 180);

        expect(first.temperature_c).toBe(15);
        expect(second.temperature_c).toBe(15);
        expect(first.condition).toBe('clear');
        expect(second.condition).toBe('clear');
      });

      it('handles several valid coordinates consistently', async () => {
        const coordinates = [
          [45, 72, -5, 'snow'],
          [41, 10, -5, 'snow'],
          [40, 10, 15, 'clear'],
          [0, 0, 15, 'clear'],
          [-40, 10, 15, 'clear'],
          [-41, 10, -5, 'snow'],
          [-90, 10, -5, 'snow'],
        ];

        for (const [lat, lng, expectedTemperature, expectedCondition] of coordinates) {
          const result = await service.getWeatherForecast(lat, lng);

          expect(result.temperature_c).toBe(expectedTemperature);
          expect(result.condition).toBe(expectedCondition);
        }
      });
    });

    describe('return value independence', () => {
      it('returns a new response object for each call', async () => {
        const first = await service.getWeatherForecast(30, 72);
        const second = await service.getWeatherForecast(30, 72);

        expect(first).not.toBe(second);
      });

      it('does not expose internal service state through the response', async () => {
        const result = await service.getWeatherForecast(30, 72);

        expect(result).not.toBe(service);
      });
    });
  });
});

