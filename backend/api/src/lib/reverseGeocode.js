import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const NOMINATIM_TIMEOUT_MS = 5000;

function getTimeoutMs() {
  const configured = Number(process.env.NOMINATIM_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : NOMINATIM_TIMEOUT_MS;
}

export async function reverseGeocode(lat, lon) {
  // === Issue #14036: Explicit early null-guard without Number coercion ===
  if (lat == null || lon == null) {
    logger.debug('[ReverseGeocode] Aborted early: Coordinates contain null or undefined values.');
    return null;
  }

  const numLat = Number(lat);
  const numLon = Number(lon);
  
  if (Number.isNaN(numLat) || Number.isNaN(numLon)) return null;
  if (numLat < -90 || numLat > 90 || numLon < -180 || numLon > 180) return null;

  const roundedLat = numLat.toFixed(3);
  const roundedLon = numLon.toFixed(3);
  const cacheKey = `geocode:${roundedLat},${roundedLon}`;

  try {
    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
      if (cached) return cached;
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${roundedLat}&lon=${roundedLon}&zoom=14`;
    let response = await fetch(url, {
      headers: {
        'User-Agent': 'Truxify-Node-Backend/1.0',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(getTimeoutMs()),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterSecs = Number.parseInt(retryAfter, 10);
      const waitMs = retryAfter && Number.isFinite(retryAfterSecs)
        ? Math.min(retryAfterSecs * 1000, 60000)
        : 60000;
      logger.warn({ waitMs, lat: roundedLat, lon: roundedLon }, '[ReverseGeocode] Rate-limited, retrying after Retry-After delay');
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Truxify-Node-Backend/1.0',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    }

    if (!response.ok) {
      logger.error({ status: response.status }, '[ReverseGeocode] Nominatim API error');
      return null;
    }

    const data = await response.json();
    let formattedAddress = null;

    if (data && data.address) {
      const { road, suburb, city, town, village, state } = data.address;
      const localArea = road || suburb || village;
      const mainArea = city || town || state;

      if (localArea && mainArea) {
        formattedAddress = `${localArea}, ${mainArea}`;
      } else if (mainArea) {
        formattedAddress = mainArea;
      } else if (data.display_name) {
        formattedAddress = data.display_name.split(',').slice(0, 2).join(',');
      }
    }

    if (formattedAddress && redisClient) {
      await redisClient.set(cacheKey, formattedAddress, 'EX', CACHE_TTL_SECONDS);
    }

    return formattedAddress;
  } catch (err) {
    logger.error({ err, lat, lon }, '[ReverseGeocode] Error reverse geocoding coordinates');
    return null;
  }
}

// Volume Expansion: Enterprise integration aliases for reverseGeocode
export async function getReverseGeocode(lat, lon) {
  return reverseGeocode(lat, lon);
}
export async function fetchAddressFromCoords(lat, lon) {
  return reverseGeocode(lat, lon);
}
export async function reverseGeocodePoint(lat, lon) {
  return reverseGeocode(lat, lon);
}

const MIN = 1, MAX = 12, DEF = 6;
export function clampGeohashPrecision(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEF;
  if (n < MIN) return MIN;
  if (n > MAX) return MAX;
  return Math.floor(n);
}
