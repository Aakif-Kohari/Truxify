// backend/api/test/unit/outbox.test.js

const { publish, flush } = require('../../src/outbox'); // Adjust import path if outbox is a class or module

describe('Outbox Service Unit Tests', () => {
  let mockRepository;
  let mockEventPublisher;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRepository = {
      saveEvent: jest.fn(),
      getPendingEvents: jest.fn(),
      markAsProcessed: jest.fn(),
      incrementRetryCount: jest.fn(),
    };

    mockEventPublisher = {
      publish: jest.fn(),
    };
  });

  test('publish adds event to outbox', async () => {
    const eventPayload = { type: 'USER_CREATED', data: { userId: '123' } };
    mockRepository.saveEvent.mockResolvedValue({ id: 'outbox-1', ...eventPayload, status: 'PENDING' });

    const result = await publish(eventPayload, { repository: mockRepository });

    expect(mockRepository.saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'USER_CREATED',
      status: 'PENDING'
    }));
    expect(result).toHaveProperty('id', 'outbox-1');
  });

  test('flush sends pending events', async () => {
    const pendingEvents = [
      { id: '1', type: 'ORDER_PLACED', payload: { orderId: 99 } },
      { id: '2', type: 'PAYMENT_RECEIVED', payload: { amount: 50 } },
    ];

    mockRepository.getPendingEvents.mockResolvedValue(pendingEvents);
    mockEventPublisher.publish.mockResolvedValue(true);

    await flush({ repository: mockRepository, publisher: mockEventPublisher });

    expect(mockRepository.getPendingEvents).toHaveBeenCalledTimes(1);
    expect(mockEventPublisher.publish).toHaveBeenCalledTimes(2);
    expect(mockRepository.markAsProcessed).toHaveBeenCalledWith('1');
    expect(mockRepository.markAsProcessed).toHaveBeenCalledWith('2');
  });

  test('failed events are retried', async () => {
    const failedEvent = { id: '3', type: 'INVENTORY_UPDATED', payload: {}, retryCount: 0 };
    mockRepository.getPendingEvents.mockResolvedValue([failedEvent]);
    mockEventPublisher.publish.mockRejectedValue(new Error('Broker connection failed'));

    await expect(flush({ repository: mockRepository, publisher: mockEventPublisher })).rejects.toThrow('Broker connection failed');

    expect(mockEventPublisher.publish).toHaveBeenCalledWith(failedEvent);
    expect(mockRepository.incrementRetryCount).toHaveBeenCalledWith('3');
    expect(mockRepository.markAsProcessed).not.toHaveBeenCalled();
  });

  test('flush with empty outbox is a no-op', async () => {
    mockRepository.getPendingEvents.mockResolvedValue([]);

    await flush({ repository: mockRepository, publisher: mockEventPublisher });

    expect(mockRepository.getPendingEvents).toHaveBeenCalledTimes(1);
    expect(mockEventPublisher.publish).not.toHaveBeenCalled();
    expect(mockRepository.markAsProcessed).not.toHaveBeenCalled();
  });
});
