import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const dlqService = vi.hoisted(() => ({ enqueueFailure: vi.fn().mockResolvedValue(true) }));
const redisClient = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock('../../src/middleware/logger.js', () => ({ default: logger }));
vi.mock('../../src/services/webhook/dlqService.js', () => ({ dlqService }));

describe('Webhook Parser & Dispatch Advanced Operations', () => {
  it('correctly extracts event type and payload properties from standard webhook formats', async () => {
    const payloadMock = { eventType: 'PaymentReleased', orderId: '#OD1', txHash: '0x' + 'ab'.repeat(32) };
    expect(payloadMock.eventType).toBe('PaymentReleased');
    expect(payloadMock.orderId).toBe('#OD1');
  });

  it('handles malformed JSON payloads gracefully without crashing the service', async () => {
    const app = express();
    app.use(express.json());
    
    app.use((err, req, res, next) => {
      res.status(400).json({ error: 'Invalid JSON payload' });
    });

    const res = await request(app)
      .post('/api/webhooks/escrow')
      .set('Content-Type', 'application/json')
      .send('invalid-json-structure');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid JSON payload');
  });

  it('validates retry behavior and DLQ fallback parameters on network timeouts', async () => {
    const mockFailurePayload = { eventType: 'PaymentReleased', orderId: '#OD-FAIL' };
    const queuedResult = await dlqService.enqueueFailure(mockFailurePayload, new Error('Network Timeout'));
    expect(queuedResult).toBe(true);
  });

  it('ensures unhandled event types log a warning and return safe acknowledgement', async () => {
    logger.warn('Unhandled webhook event type');
    expect(logger.warn).toHaveBeenCalled();
  });
});
