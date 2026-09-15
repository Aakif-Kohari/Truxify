import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  requiresBiometricAuth,
  getBiometricThreshold,
  updateBiometricThreshold,
  createChallenge,
  verifyBiometric,
  verifyFallbackOtp,
  getFallbackOtp,
  getChallengeStatus,
  getChallenge,
} from '../../src/services/biometricAuthService.js';

describe('biometricAuthService', () => {
  const testUser = 'driver-bio-test-1';
  const testShipment = 'shipment-999';

  beforeEach(() => {
    // Reset threshold to default ₹50,000 (5,000,000 paisa)
    updateBiometricThreshold(testUser, 5_000_000);
  });

  describe('threshold management', () => {
    it('correctly evaluates freight value against threshold', () => {
      expect(requiresBiometricAuth(testUser, 4_999_999)).toBe(false);
      expect(requiresBiometricAuth(testUser, 5_000_000)).toBe(true);
      expect(requiresBiometricAuth(testUser, 10_000_000)).toBe(true);
    });

    it('updates biometric threshold and returns updated config', () => {
      const updated = updateBiometricThreshold(testUser, 2_000_000);
      expect(updated.threshold_paisa).toBe(2_000_000);
      expect(requiresBiometricAuth(testUser, 2_000_000)).toBe(true);
      expect(requiresBiometricAuth(testUser, 1_999_999)).toBe(false);
    });

    it('rejects invalid threshold values', () => {
      expect(() => updateBiometricThreshold(testUser, 0)).toThrow();
      expect(() => updateBiometricThreshold(testUser, -500)).toThrow();
      expect(() => updateBiometricThreshold(testUser, 100_000_001)).toThrow();
      expect(() => updateBiometricThreshold(testUser, 'invalid')).toThrow();
    });
  });

  describe('challenge lifecycle and biometric verification', () => {
    it('creates a valid challenge session with nonce and supported methods', () => {
      const challenge = createChallenge(testUser, testShipment, 6_000_000);

      expect(challenge.challengeId).toBeDefined();
      expect(challenge.nonce).toBeDefined();
      expect(challenge.expiresAt).toBeGreaterThan(Date.now());
      expect(challenge.supported_methods).toEqual(['fingerprint', 'face_recognition']);
      expect(challenge.fallback_available).toBe(true);

      const status = getChallengeStatus(challenge.challengeId, testUser);
      expect(status.status).toBe('pending');
      expect(status.shipmentId).toBe(testShipment);
    });

    it('successfully verifies a valid cryptographic biometric token', () => {
      const challenge = createChallenge(testUser, testShipment, 6_000_000);
      const method = 'fingerprint';
      const timestamp = Date.now();
      const secret = process.env.BIOMETRIC_APP_SECRET || 'truxify-biometric-secret';

      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${testUser}${challenge.nonce}${method}${timestamp}`)
        .digest('hex');

      const token = Buffer.from(
        JSON.stringify({
          userId: testUser,
          nonce: challenge.nonce,
          method,
          timestamp,
          signature,
        })
      ).toString('base64url');

      const verification = verifyBiometric(challenge.challengeId, token, method);
      expect(verification.success).toBe(true);
      expect(verification.method).toBe('fingerprint');
      expect(verification.verifiedAt).toBeDefined();

      // Ensure challenge is now consumed and cannot be reused
      const secondAttempt = verifyBiometric(challenge.challengeId, token, method);
      expect(secondAttempt.success).toBe(false);
      expect(secondAttempt.error).toContain('already verified');
    });

    it('rejects biometric verification with invalid HMAC signature', () => {
      const challenge = createChallenge(testUser, testShipment, 6_000_000);
      const method = 'face_recognition';
      const timestamp = Date.now();

      const invalidToken = Buffer.from(
        JSON.stringify({
          userId: testUser,
          nonce: challenge.nonce,
          method,
          timestamp,
          signature: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        })
      ).toString('base64url');

      const result = verifyBiometric(challenge.challengeId, invalidToken, method);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Signature verification failed');
    });

    it('rejects unsupported biometric authentication methods', () => {
      const challenge = createChallenge(testUser, testShipment, 6_000_000);
      const result = verifyBiometric(challenge.challengeId, 'dummyToken', 'iris_scan');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported method');
    });
  });

  describe('fallback OTP verification', () => {
    it('verifies correctly with matching fallback OTP', () => {
      const challenge = createChallenge(testUser, testShipment, 6_000_000);
      const otp = getFallbackOtp(challenge.challengeId);
      expect(otp).toBeDefined();
      expect(otp.length).toBe(6);

      const result = verifyFallbackOtp(challenge.challengeId, otp);
      expect(result.success).toBe(true);
      expect(result.method).toBe('fallback_otp');

      const rawSession = getChallenge(challenge.challengeId);
      expect(rawSession.status).toBe('verified');
    });

    it('rejects incorrect fallback OTP', () => {
      const challenge = createChallenge(testUser, testShipment, 6_000_000);
      const result = verifyFallbackOtp(challenge.challengeId, '000000');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid OTP');
    });
  });
});
