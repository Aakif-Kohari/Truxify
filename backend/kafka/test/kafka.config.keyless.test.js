import { describe, expect, it } from 'vitest';

import { formatKafkaMessageKey } from '../config/kafka.config.js';

describe('Kafka consumer message-key logging', () => {
  it('returns null for a valid keyless Kafka message', () => {
    expect(formatKafkaMessageKey(null)).toBeNull();
    expect(formatKafkaMessageKey(undefined)).toBeNull();
  });

  it('preserves the string representation of keyed messages', () => {
    expect(formatKafkaMessageKey(Buffer.from('order-42'))).toBe('order-42');
    expect(formatKafkaMessageKey('plain-key')).toBe('plain-key');
  });
});
