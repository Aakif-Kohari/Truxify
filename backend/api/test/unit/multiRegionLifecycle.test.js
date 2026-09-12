import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisQuit = vi.fn().mockResolvedValue('OK');

vi.mock('ioredis', () => ({
    default: class RedisMock {
        quit = redisQuit;
    }
}));

vi.mock('../../src/middleware/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock('../../src/config/db.js', () => ({
    supabase: {}
}));

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn()
    }
}));

describe('RegionService lifecycle', () => {
    let RegionService;
    let singleton;

    beforeEach(async () => {
        vi.useFakeTimers();
        redisQuit.mockClear();

        const module = await import('../../../../k8s/multi-region/region-service.js');
        RegionService = module.RegionService;
        singleton = module.default;
    });

    afterEach(async () => {
        await singleton.stop();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('does not create duplicate health or replication intervals', async () => {
        const service = Object.create(RegionService.prototype);
        service._healthInterval = null;
        service._replicationInterval = null;
        service.checkAllRegions = vi.fn();
        service.replicateData = vi.fn();

        await service.startHealthChecks();
        const healthHandle = service._healthInterval;
        await service.startHealthChecks();

        await service.startDataReplication();
        const replicationHandle = service._replicationInterval;
        await service.startDataReplication();

        expect(service._healthInterval).toBe(healthHandle);
        expect(service._replicationInterval).toBe(replicationHandle);

        clearInterval(service._healthInterval);
        clearInterval(service._replicationInterval);
    });

    it('clears both interval handles and closes Redis on stop', async () => {
        const service = Object.create(RegionService.prototype);
        service._healthInterval = setInterval(() => {}, 10000);
        service._replicationInterval = setInterval(() => {}, 5000);
        service.redis = { quit: vi.fn().mockResolvedValue('OK') };

        await service.stop();

        expect(service._healthInterval).toBeNull();
        expect(service._replicationInterval).toBeNull();
        expect(service.redis.quit).toHaveBeenCalledOnce();
    });

    it('can restart background loops after stop', async () => {
        const service = Object.create(RegionService.prototype);
        service._healthInterval = null;
        service._replicationInterval = null;
        service.redis = { quit: vi.fn().mockResolvedValue('OK') };
        service.checkAllRegions = vi.fn();
        service.replicateData = vi.fn();

        await service.startHealthChecks();
        await service.startDataReplication();
        await service.stop();
        await service.startHealthChecks();
        await service.startDataReplication();

        expect(service._healthInterval).not.toBeNull();
        expect(service._replicationInterval).not.toBeNull();

        clearInterval(service._healthInterval);
        clearInterval(service._replicationInterval);
    });
});
