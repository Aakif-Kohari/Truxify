# Internal B2B Routes

## Overview

The Truxify backend exposes internal B2B endpoints (`routes/internalRoutes.js`) consumed by automation (the n8n "Truxify Emergency Smart Contract Circuit Breaker" workflow) to monitor and control escrow operations.

---

## Location

```
backend/api/src/routes/internalRoutes.js
```

---

## Endpoints

### GET /api/internal/escrow-velocity

Reports escrow event counts (deposits, releases, refunds) within a rolling window and whether the combined rate exceeds the anomaly threshold.

- Window: `ESCROW_VELOCITY_WINDOW_MINUTES` (default 5).
- Threshold: `ESCROW_ANOMALY_THRESHOLD` (default 20).
- Also reports the circuit-breaker pause state.

### POST /api/internal/pause-escrow

Opens or closes the escrow circuit breaker (`{"paused": true|false}`). While open, every on-chain escrow submission in `services/escrow.js` is refused.

---

## Escrow pause state (emergency control)

- The Redis-backed escrow pause flag is an **emergency control**: while set, it refuses all on-chain escrow submissions.
- **Fail-closed:** if Redis cannot be read (unreachable, missing client, or read error), the pause state is considered **active/paused** — `isEscrowPaused()` reports paused and escrow submissions are refused while the state is unreadable.
- **Operator action:** restore/verify Redis and the pause state before normal escrow operation resumes. Confirm Redis is reachable, check `GET /api/internal/escrow-velocity` (`escrowPaused` field), then close the circuit explicitly with `POST /api/internal/pause-escrow {"paused": false}` once the incident is resolved.

---

## Security

Both endpoints are gated by `requireApiKey` (`x-api-key` header or `api_key` query against `VALID_API_KEYS`), so only authenticated B2B callers can reach them. Responses never expose internal infrastructure details.

---

## Why It Exists

An emergency circuit breaker lets operators stop on-chain escrow submissions instantly when a contract incident is detected, without a redeploy — and the velocity endpoint lets the n8n workflow detect anomalous escrow rates automatically.

---

## Testing

Automated tests verify:

- Velocity counts and anomaly detection.
- Pause/open/close behavior.
- Not-configured and error paths.
