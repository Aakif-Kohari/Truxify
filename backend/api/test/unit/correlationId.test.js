import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
}));

vi.mock("../../src/middleware/logger.js", () => ({
  default: mockLogger,
}));

import {
  correlationIdMiddleware,
  getCorrelationStore,
  runWithCorrelationId,
} from "../../src/middleware/correlationId.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createResponse() {
  return { setHeader: vi.fn() };
}

function runMiddleware(headers = {}, response = createResponse()) {
  const request = { headers };
  const next = vi.fn(() => getCorrelationStore());

  correlationIdMiddleware(request, response, next);

  return { request, response, next };
}

describe("correlationIdMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates a valid client correlation ID to the request and response", () => {
    const { request, response, next } = runMiddleware({
      "x-correlation-id": "client-request-42",
    });

    expect(request.correlationId).toBe("client-request-42");
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      "client-request-42",
    );
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveReturnedWith({ correlationId: "client-request-42" });
  });

  it("accepts supported header casing, surrounding whitespace, and array headers", () => {
    const { request, response } = runMiddleware({
      "X-Correlation-ID": ["  alternate-header-id  ", "ignored-id"],
    });

    expect(request.correlationId).toBe("alternate-header-id");
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      "alternate-header-id",
    );
  });

  it("generates a UUID when the client correlation ID has an invalid format", () => {
    const { request, response } = runMiddleware({
      "x-correlation-id": "contains spaces and is invalid",
    });

    expect(request.correlationId).toMatch(uuidPattern);
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      request.correlationId,
    );
  });

  it("generates a UUID when no correlation ID is provided", () => {
    const { request, response } = runMiddleware();

    expect(request.correlationId).toMatch(uuidPattern);
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      request.correlationId,
    );
  });

  it("supports responses without a setHeader function", () => {
    const { request, next } = runMiddleware({}, {});

    expect(request.correlationId).toMatch(uuidPattern);
    expect(next).toHaveBeenCalledOnce();
  });

  it("emits the correlation ID event with request metadata", () => {
    const { request } = runMiddleware({ "x-correlation-id": "trace-abc" });
    request.requestId = "request-123";

    mockLogger.debug.mockClear();
    correlationIdMiddleware(request, createResponse(), vi.fn());

    expect(mockLogger.debug).toHaveBeenCalledWith(
      {
        event: "CORRELATION_ID_SET",
        correlationId: "trace-abc",
        requestId: "request-123",
      },
      "Correlation ID trace-abc propagated from client",
    );
  });
});

describe("runWithCorrelationId and getCorrelationStore", () => {
  it("runs the callback with the specified correlation ID in the store", () => {
    const result = runWithCorrelationId("callback-id", () =>
      getCorrelationStore(),
    );

    expect(result).toEqual({ correlationId: "callback-id" });
  });

  it("returns the correlation store inside an active context", () => {
    expect(runWithCorrelationId("context-id", getCorrelationStore)).toEqual({
      correlationId: "context-id",
    });
  });

  it("returns an empty object outside an active context", () => {
    expect(getCorrelationStore()).toEqual({});
  });

  it("keeps concurrent async request contexts isolated", async () => {
    const firstRequest = runWithCorrelationId("first-request", async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return getCorrelationStore();
    });
    const secondRequest = runWithCorrelationId("second-request", async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return getCorrelationStore();
    });

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      { correlationId: "first-request" },
      { correlationId: "second-request" },
    ]);
  });
});
