import { describe, it, expect, vi, beforeEach } from "vitest";

// -- Intercept CJS redisMock required by setup.js in ESM mode -----------------
class SetupRedisMockStub {
  constructor() {
    this.store = new Map();
    this.expirations = new Map();
  }
  clear() {
    this.store.clear();
    this.expirations.clear();
  }
  set() { return Promise.resolve("OK"); }
  get() { return Promise.resolve(null); }
  del() { return Promise.resolve(1); }
  eval() { return Promise.resolve(0); }
}

vi.mock("../../mocks/redisMock.js", () => ({ default: SetupRedisMockStub }));
vi.mock("../../mocks/redisMock", () => ({ default: SetupRedisMockStub }));

// -- Application Mocks --------------------------------------------------------
vi.mock("../../../src/middleware/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/middleware/auth.js", () => ({
  verifyAuthToken: vi.fn(),
  authenticate: vi.fn((_req, _res, next) => next()),
  requireRole: vi.fn(() => (_req, _res, next) => next()),
}));

vi.mock("../../../src/sockets/telemetryBuffer.js", () => ({
  default: { enqueue: vi.fn(), start: vi.fn(), shutdown: vi.fn(), readLatestPoint: vi.fn() },
}));

const dbMock = vi.hoisted(() => ({
  supabase: {},
  redisClient: null,
}));
vi.mock("../../../src/config/db.js", () => dbMock);

const { applySequenceGate, parseGpsTimestamp } = await import("../../../src/sockets/locationServer.js");

// -- Local ESM Fake Redis ------------------------------------------------------
function makeFakeRedis(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(async (_script, _numKeys, key, ...args) => {
      const incoming = Number(args[0]);
      if (Number.isNaN(incoming)) return 1;
      const currentStr = store.get(key) ?? null;
      const current = currentStr !== null ? Number(currentStr) : null;
      if (current !== null && incoming <= current) return 0;
      store.set(key, String(incoming));
      return 1;
    }),
    _store: store,
  };
}

const DRIVER = "driver-ordering-test";
const KEY = `driver:sequence:${DRIVER}`;
const ts = (ms) => new Date(1_700_000_000_000 + ms);

// -- Test Suite ---------------------------------------------------------------
describe("locationServer - applySequenceGate ordering & idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.redisClient = null;
  });

  it("1. increasing timestamps are accepted (T1 -> T2 -> T3)", async () => {
    const redis = makeFakeRedis();
    dbMock.redisClient = redis;

    expect(await applySequenceGate(DRIVER, ts(1000))).toBe(true);
    expect(await applySequenceGate(DRIVER, ts(2000))).toBe(true);
    expect(await applySequenceGate(DRIVER, ts(3000))).toBe(true);

    expect(Number(redis._store.get(KEY))).toBe(ts(3000).getTime());
    expect(redis.eval).toHaveBeenCalledTimes(3);
  });

  it("2. stale/out-of-order timestamp is rejected (T1 -> T2 -> T1)", async () => {
    const redis = makeFakeRedis();
    dbMock.redisClient = redis;

    expect(await applySequenceGate(DRIVER, ts(1000))).toBe(true);
    expect(await applySequenceGate(DRIVER, ts(5000))).toBe(true);
    expect(await applySequenceGate(DRIVER, ts(1000))).toBe(false);

    expect(Number(redis._store.get(KEY))).toBe(ts(5000).getTime());
  });

  it("3. duplicate timestamp is rejected (T2 -> T2)", async () => {
    const redis = makeFakeRedis();
    dbMock.redisClient = redis;

    expect(await applySequenceGate(DRIVER, ts(5000))).toBe(true);
    expect(await applySequenceGate(DRIVER, ts(5000))).toBe(false);

    expect(Number(redis._store.get(KEY))).toBe(ts(5000).getTime());
  });

  it("4. multiple out-of-order timestamps (T1 -> T3 -> T2)", async () => {
    const redis = makeFakeRedis();
    dbMock.redisClient = redis;

    expect(await applySequenceGate(DRIVER, ts(1000))).toBe(true);
    expect(await applySequenceGate(DRIVER, ts(4000))).toBe(true);
    expect(await applySequenceGate(DRIVER, ts(2000))).toBe(false);

    expect(Number(redis._store.get(KEY))).toBe(ts(4000).getTime());
  });

  it("5. Redis unavailable fails open (null)", async () => {
    dbMock.redisClient = null;
    expect(await applySequenceGate(DRIVER, ts(1000))).toBe(true);
  });

  it("6. Redis EVAL error fails open", async () => {
    dbMock.redisClient = {
      eval: vi.fn().mockRejectedValue(new Error("Redis connection error")),
    };
    expect(await applySequenceGate(DRIVER, ts(1000))).toBe(true);
  });

  it("7. verifies atomic Redis EVAL is used rather than GET + SET", async () => {
    const redis = makeFakeRedis();
    dbMock.redisClient = redis;

    await applySequenceGate(DRIVER, ts(1000));

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();

    const [script, numKeys, key, incoming] = redis.eval.mock.calls[0];
    expect(numKeys).toBe(1);
    expect(key).toBe(KEY);
    expect(Number(incoming)).toBe(ts(1000).getTime());
    expect(script).toContain("redis.call('GET', key)");
    expect(script).toContain("redis.call('SET', key, tostring(incoming), 'EX', 86400)");
    expect(script).toContain("incoming <= current");
  });
});

describe("parseGpsTimestamp", () => {
  it("parses valid ISO string and falls back to now on invalid or missing timestamp", () => {
    expect(parseGpsTimestamp("2024-01-15T10:30:00.000Z").toISOString()).toBe("2024-01-15T10:30:00.000Z");
    expect(Number.isNaN(parseGpsTimestamp(undefined).getTime())).toBe(false);
    expect(Number.isNaN(parseGpsTimestamp("invalid").getTime())).toBe(false);
  });
});
