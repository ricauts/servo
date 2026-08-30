// The Docling circuit breaker (dcl-05). Three consecutive failures open
// the circuit for ten minutes: while open, no connection is ATTEMPTED and
// extraction falls back to baseline with docling-circuit-open. A success
// closes it immediately; the window's expiry closes it too.
//
// Pure state machine over an injected clock so the test can time-travel:
// nothing here reads Date.now() itself.

export const CIRCUIT_FAILURE_THRESHOLD = 3;
export const CIRCUIT_OPEN_WINDOW_MS = 10 * 60 * 1000;

export type CircuitState =
  | { status: "closed"; consecutiveFailures: number }
  | { status: "open"; openedAt: number };

export function initialCircuit(): CircuitState {
  return { status: "closed", consecutiveFailures: 0 };
}

/** Record a failure; the threshold-th consecutive failure opens the circuit. */
export function recordFailure(state: CircuitState, now: number): CircuitState {
  if (state.status === "open") return state; // already open; the window governs
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    return { status: "open", openedAt: now };
  }
  return { status: "closed", consecutiveFailures };
}

/** A success closes the circuit and resets the count. */
export function recordSuccess(): CircuitState {
  return initialCircuit();
}

/**
 * Whether a call may be attempted at `now`. An open circuit whose window
 * has elapsed reads as closed (half-open: the next call proves the lane),
 * and the caller should treat that transition through allow() — the state
 * itself is only rewritten by record*().
 */
export function allow(state: CircuitState, now: number): boolean {
  if (state.status === "closed") return true;
  return now - state.openedAt >= CIRCUIT_OPEN_WINDOW_MS;
}

/** True when the circuit is open at `now` — the fallback reason's trigger. */
export function isOpen(state: CircuitState, now: number): boolean {
  return !allow(state, now);
}
