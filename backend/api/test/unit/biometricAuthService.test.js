import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    createChallenge,
    verifyBiometric,
} from '../../src/services/biometricAuthService.js';

const FALLBACK_SECRET = 'truxify-biometric-secret';
const CONFIGURED_SECRET = 'test-biometric-secret';

function createBiometricToken(challenge, secret, method = 'fingerprint') {
    const timestamp = Date.now();
    const payload = {
        userId: challenge.userId,
        nonce: challenge.nonce,
        method,
        timestamp,
    };

    payload.signature = crypto
        .createHmac('sha256', secret)
        .update(`${payload.userId}${payload.nonce}${payload.method}${payload.timestamp}`)
        .digest('hex');

    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

describe('biometricAuthService', () => {
    let originalSecret;

    beforeEach(() => {
        originalSecret = process.env.BIOMETRIC_APP_SECRET;
        delete process.env.BIOMETRIC_APP_SECRET;
    });

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.BIOMETRIC_APP_SECRET;
        } else {
            process.env.BIOMETRIC_APP_SECRET = originalSecret;
        }
    });

    it('rejects biometric proofs when no app secret is configured', () => {
        const challenge = createChallenge('user-1', 'shipment-1', 5_000_000);
        const token = createBiometricToken(challenge, FALLBACK_SECRET);

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result).toEqual({
            success: false,
            error: 'Biometric token verification is not configured',
        });
    });

    it('rejects the historical public fallback secret when configuration is missing', () => {
        const challenge = createChallenge('user-2', 'shipment-2', 5_000_000);
        const token = createBiometricToken(challenge, FALLBACK_SECRET);

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result.success).toBe(false);
        expect(result.error).not.toBe('Signature verification failed');
        expect(result.error).toBe('Biometric token verification is not configured');
    });

    it('accepts a valid proof when the app secret is configured', () => {
        process.env.BIOMETRIC_APP_SECRET = CONFIGURED_SECRET;

        const challenge = createChallenge('user-3', 'shipment-3', 5_000_000);
        const token = createBiometricToken(challenge, CONFIGURED_SECRET);

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result.success).toBe(true);
        expect(result.challengeId).toBe(challenge.challengeId);
        expect(result.method).toBe('fingerprint');
    });

    it('rejects a proof signed with a different secret', () => {
        process.env.BIOMETRIC_APP_SECRET = CONFIGURED_SECRET;

        const challenge = createChallenge('user-4', 'shipment-4', 5_000_000);
        const token = createBiometricToken(challenge, 'wrong-secret');

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result).toEqual({
            success: false,
            error: 'Signature verification failed',
        });
    });

    it('treats a whitespace-only secret as unconfigured', () => {
        process.env.BIOMETRIC_APP_SECRET = '   ';

        const challenge = createChallenge('user-5', 'shipment-5', 5_000_000);
        const token = createBiometricToken(challenge, FALLBACK_SECRET);

        const result = verifyBiometric(challenge.challengeId, token, 'fingerprint');

        expect(result).toEqual({
            success: false,
            error: 'Biometric token verification is not configured',
        });
    });
});
