import { describe, it, expect, vi } from 'vitest';

const anonFrom = vi.fn(() => {
  throw new Error('anon Supabase client must not access events');
});

const maybeSingle = vi.fn().mockResolvedValue({
  data: { event_id: 'evt-9202' },
  error: null,
});

const query = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle,
};

const adminFrom = vi.fn(() => query);

vi.mock('../../api/src/config/db.js', () => ({
  supabase: { from: anonFrom },
  supabaseAdmin: { from: adminFrom },
}));

vi.mock('../../api/src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import eventRepository from '../repositories/event.repository.js';

describe('EventRepository service-role access (issue #9202)', () => {
  it('uses supabaseAdmin for the service-role-only events table', async () => {
    await expect(eventRepository.getEventById('evt-9202')).resolves.toEqual({ event_id: 'evt-9202' });

    expect(adminFrom).toHaveBeenCalledWith('events');
    expect(anonFrom).not.toHaveBeenCalled();
  });
});
