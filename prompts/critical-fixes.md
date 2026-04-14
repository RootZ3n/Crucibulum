# Claude Code Prompt — Crucibulum Critical Fixes

## Context

Crucibulum is the truth engine / evaluation system in the Squidley ecosystem. It runs tasks against AI models, evaluates results with a deterministic judge, and produces evidence bundles. Three critical issues must be fixed before it can be trusted as the foundation layer.

**Repo:** `/mnt/ai/crucibulum`
**Port:** 18795
**Stack:** TypeScript, Node.js, native HTTP server (no Express/Fastify)

---

## Fix 1: Custom Scorer Registry

### Problem
The system advertises "custom" scoring but there's no registry/loader/implementation. This means custom scorers silently fail, producing false confidence in results. This is a trust killer.

### Solution
Build a scorer registry that:
1. Defines a `ScorerPlugin` interface
2. Loads scorer plugins from a configurable directory (`/mnt/ai/crucibulum/scorers/`)
3. Validates scorer exports at load time (fail loud, not silent)
4. Integrates with the existing judge pipeline

### Implementation

**A. Create `core/scorer-registry.ts`:**

```typescript
/**
 * Crucibulum — Scorer Registry
 * Loads, validates, and manages custom scorer plugins.
 */

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { log } from "../utils/logger.js";

export interface ScorerPlugin {
  /** Unique scorer ID (e.g., "custom/my-scorer") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Version string */
  version: string;
  /** Task families this scorer applies to */
  taskFamilies: string[];
  /**
   * Score a model response.
   * @param input — the model's output + oracle/expected data
   * @returns score 0.0–1.0 + breakdown
   */
  score(input: ScorerInput): ScorerOutput;
}

export interface ScorerInput {
  taskId: string;
  taskFamily: string;
  modelResponse: string;
  oracleData: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ScorerOutput {
  score: number; // 0.0–1.0
  passed: boolean;
  breakdown: Record<string, number>; // e.g., { correctness: 0.9, completeness: 0.7 }
  explanation: string;
  metadata?: Record<string, unknown>;
}

interface LoadedScorer {
  plugin: ScorerPlugin;
  sourcePath: string;
  loadedAt: string;
}

const scorers = new Map<string, LoadedScorer>();
let scorersDir = resolve(process.cwd(), "scorers");

/** Set the scorers directory (call before loadAll) */
export function setScorersDir(dir: string): void {
  scorersDir = resolve(dir);
}

/** Validate a scorer plugin has all required fields */
function validateScorer(plugin: unknown): plugin is ScorerPlugin {
  if (typeof plugin !== "object" || plugin === null) return false;
  const p = plugin as Record<string, unknown>;
  
  if (typeof p.id !== "string" || !p.id.trim()) {
    throw new Error("Scorer missing required field: id (non-empty string)");
  }
  if (typeof p.name !== "string" || !p.name.trim()) {
    throw new Error(`Scorer '${p.id}': missing required field: name`);
  }
  if (typeof p.version !== "string") {
    throw new Error(`Scorer '${p.id}': missing required field: version`);
  }
  if (!Array.isArray(p.taskFamilies)) {
    throw new Error(`Scorer '${p.id}': taskFamilies must be an array`);
  }
  if (typeof p.score !== "function") {
    throw new Error(`Scorer '${p.id}': missing required function: score()`);
  }
  
  return true;
}

/**
 * Load all scorer plugins from the scorers directory.
 * Each .ts or .js file should export default a ScorerPlugin.
 */
export async function loadAllScorers(): Promise<{ loaded: number; failed: Array<{ path: string; error: string }> }> {
  const results = { loaded: 0, failed: Array<{ path: string; error: string }>() };
  
  if (!existsSync(scorersDir)) {
    log("warn", "scorer-registry", `Scorers directory does not exist: ${scorersDir}. Creating.`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(scorersDir, { recursive: true });
    return results;
  }
  
  const entries = readdirSync(scorersDir).filter(f => f.endsWith(".ts") || f.endsWith(".js"));
  
  for (const entry of entries) {
    const fullPath = join(scorersDir, entry);
    try {
      const mod = await import(fullPath);
      const plugin = mod.default;
      
      if (!validateScorer(plugin)) {
        throw new Error("Invalid scorer plugin shape");
      }
      
      // Check for duplicate IDs
      if (scorers.has(plugin.id)) {
        throw new Error(`Duplicate scorer ID: ${plugin.id} (already loaded from ${scorers.get(plugin.id)!.sourcePath})`);
      }
      
      scorers.set(plugin.id, {
        plugin,
        sourcePath: fullPath,
        loadedAt: new Date().toISOString(),
      });
      
      log("info", "scorer-registry", `Loaded scorer: ${plugin.id} v${plugin.version}`, {
        name: plugin.name,
        taskFamilies: plugin.taskFamilies,
      });
      results.loaded++;
    } catch (err) {
      const error = String((err as Error).message ?? err);
      log("error", "scorer-registry", `Failed to load scorer: ${fullPath}`, { error });
      results.failed.push({ path: fullPath, error });
    }
  }
  
  return results;
}

/** Get a loaded scorer by ID */
export function getScorer(id: string): ScorerPlugin | undefined {
  return scorers.get(id)?.plugin;
}

/** List all loaded scorers */
export function listScorers(): Array<{ id: string; name: string; version: string; taskFamilies: string[]; sourcePath: string }> {
  return [...scorers.values()].map(s => ({
    id: s.plugin.id,
    name: s.plugin.name,
    version: s.plugin.version,
    taskFamilies: s.plugin.taskFamilies,
    sourcePath: s.sourcePath,
  }));
}

/** Find scorers applicable to a given task family */
export function findScorersForFamily(taskFamily: string): ScorerPlugin[] {
  return [...scorers.values()]
    .map(s => s.plugin)
    .filter(s => s.taskFamilies.includes(taskFamily) || s.taskFamilies.includes("*"));
}

/** Clear all loaded scorers (for testing) */
export function clearScorers(): void {
  scorers.clear();
}
```

**B. Create example scorer `scorers/example-correctness.ts`:**

```typescript
/**
 * Example custom scorer — correctness checker
 * Place custom scorers in the /scorers/ directory.
 * Each must export default a ScorerPlugin.
 */
import type { ScorerPlugin, ScorerInput, ScorerOutput } from "../core/scorer-registry.js";

const plugin: ScorerPlugin = {
  id: "custom/correctness",
  name: "Correctness Scorer",
  version: "1.0.0",
  taskFamilies: ["*"], // applies to all task families

  score(input: ScorerInput): ScorerOutput {
    const expected = input.oracleData["expected_output"] as string | undefined;
    if (!expected) {
      return {
        score: 0,
        passed: false,
        breakdown: { correctness: 0 },
        explanation: "No expected output in oracle data — cannot score correctness",
      };
    }

    const response = input.modelResponse.toLowerCase().trim();
    const expectedLower = expected.toLowerCase().trim();
    
    // Exact match
    if (response === expectedLower) {
      return {
        score: 1.0,
        passed: true,
        breakdown: { correctness: 1.0 },
        explanation: "Exact match with expected output",
      };
    }
    
    // Fuzzy match — check if expected appears in response
    if (response.includes(expectedLower)) {
      return {
        score: 0.8,
        passed: true,
        breakdown: { correctness: 0.8 },
        explanation: "Expected output found within model response",
      };
    }
    
    // Keyword overlap
    const expectedWords = new Set(expectedLower.split(/\s+/).filter(w => w.length > 3));
    const responseWords = new Set(response.split(/\s+/));
    const overlap = [...expectedWords].filter(w => responseWords.has(w)).length;
    const keywordScore = expectedWords.size > 0 ? overlap / expectedWords.size : 0;
    
    return {
      score: Math.round(keywordScore * 100) / 100,
      passed: keywordScore >= 0.5,
      breakdown: { correctness: keywordScore },
      explanation: `Keyword overlap: ${overlap}/${expectedWords.size} (${Math.round(keywordScore * 100)}%)`,
    };
  },
};

export default plugin;
```

**C. Integrate into `server/api.ts`:**

At the top of api.ts, after existing imports:
```typescript
import { loadAllScorers, listScorers, getScorer, findScorersForFamily } from "../core/scorer-registry.js";
```

At startup (before the server starts listening):
```typescript
// Load custom scorers
const scorerResults = await loadAllScorers();
log("info", "api", `Scorer registry: ${scorerResults.loaded} loaded, ${scorerResults.failed.length} failed`);
if (scorerResults.failed.length > 0) {
  for (const f of scorerResults.failed) {
    log("error", "api", `Scorer load failure: ${f.path} — ${f.error}`);
  }
}
```

Add new API routes:
```typescript
// GET /api/scorers — list all loaded scorers
if (pathname === "/api/scorers" && method === "GET") {
  return sendJSON(res, 200, { scorers: listScorers() });
}

// GET /api/scorers/health — registry health check
if (pathname === "/api/scorers/health" && method === "GET") {
  const all = listScorers();
  return sendJSON(res, 200, {
    status: all.length > 0 ? "ok" : "no_scorers_loaded",
    count: all.length,
    scorers: all.map(s => s.id),
  });
}
```

**D. Hard-fail if custom scoring is referenced but no scorer is loaded:**

In `core/judge.ts`, where scoring happens, add:
```typescript
import { findScorersForFamily } from "./scorer-registry.js";

// If task requests custom scoring, ensure a scorer is available
if (taskManifest.scoring?.type === "custom") {
  const applicable = findScorersForFamily(taskManifest.family ?? "unknown");
  if (applicable.length === 0) {
    throw new Error(
      `TASK ERROR: Task '${taskManifest.id}' requests custom scoring but no scorer plugin ` +
      `is loaded for family '${taskManifest.family}'. ` +
      `Either add a scorer to the /scorers/ directory or change scoring.type to 'deterministic'.`
    );
  }
}
```

### Exit Criteria
- [ ] `scorer-registry.ts` exists and loads plugins from `/scorers/`
- [ ] Invalid plugins fail loudly at load time (not silently)
- [ ] Duplicate IDs are rejected
- [ ] Example scorer exists as reference
- [ ] API exposes `GET /api/scorers` and `GET /api/scorers/health`
- [ ] Tasks requesting custom scoring without a loaded scorer get a clear error
- [ ] `npm test` passes

---

## Fix 2: API Authentication

### Problem
Anyone on the network can hit Crucibulum's endpoints. No auth means no access control.

### Solution
Token-based authentication via environment variable. Local-only by default, token required for remote access.

### Implementation

**A. Create `server/auth.ts`:**

```typescript
/**
 * Crucibulum — API Authentication
 * Token-based auth via CRUCIBULUM_API_TOKEN env var.
 * Local-only by default (127.0.0.1, ::1, localhost).
 */

import type { IncomingMessage } from "node:http";
import { log } from "../utils/logger.js";

const API_TOKEN = process.env["CRUCIBULUM_API_TOKEN"]?.trim() || "";
const ALLOW_LOCAL = process.env["CRUCIBULUM_ALLOW_LOCAL"] !== "false"; // default: allow local without token

const TRUSTED_LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface AuthResult {
  ok: boolean;
  reason: string;
}

/**
 * Check if a request is authenticated.
 * Returns { ok: true } if:
 *   - Request is from a trusted local host (and ALLOW_LOCAL is true)
 *   - Request has valid Authorization: Bearer <token> header
 */
export function checkAuth(req: IncomingMessage): AuthResult {
  const host = req.headers["host"]?.split(":")[0] ?? "";
  const forwarded = req.headers["x-forwarded-for"]?.split(",")[0]?.trim();
  
  // Local requests
  const isLocal = TRUSTED_LOCAL_HOSTS.has(host) || host.startsWith("127.") || host.startsWith("::1");
  if (isLocal && ALLOW_LOCAL) {
    return { ok: true, reason: "local" };
  }
  
  // Token auth
  if (API_TOKEN) {
    const authHeader = req.headers["authorization"] ?? "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    
    if (match && match[1] === API_TOKEN) {
      return { ok: true, reason: "token" };
    }
    
    log("warn", "auth", "Authentication failed", {
      host,
      forwarded,
      hasAuthHeader: !!authHeader,
      path: req.url,
    });
    
    return { ok: false, reason: "invalid_or_missing_token" };
  }
  
  // No token configured and not local
  if (!API_TOKEN) {
    return { ok: false, reason: "no_token_configured" };
  }
  
  return { ok: false, reason: "unauthorized" };
}

/** Middleware-style check — sends 401 and returns false if unauthorized */
export function requireAuth(req: IncomingMessage, res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (body: string) => void }): boolean {
  const result = checkAuth(req);
  if (!result.ok) {
    log("warn", "auth", `Rejected request: ${result.reason}`, { path: req.url });
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    res.end(JSON.stringify({ error: "Unauthorized", reason: result.reason }));
    return false;
  }
  return true;
}
```

**B. Integrate into `server/api.ts`:**

At the top:
```typescript
import { requireAuth } from "./auth.js";
```

In the request handler, after method/path parsing but before any route logic:
```typescript
// Auth check — skip for health endpoint
if (pathname !== "/api/health" && pathname !== "/health") {
  if (!requireAuth(req, res)) return;
}
```

**C. Add auth health info to `/api/health`:**

```typescript
if (pathname === "/api/health" || pathname === "/health") {
  return sendJSON(res, 200, {
    status: "ok",
    service: "crucibulum",
    auth: {
      enabled: !!API_TOKEN || !ALLOW_LOCAL,
      tokenConfigured: !!API_TOKEN,
      localAllowed: ALLOW_LOCAL,
    },
    uptime: process.uptime(),
  });
}
```

### Exit Criteria
- [ ] `auth.ts` exists with token-based authentication
- [ ] Local requests (127.0.0.1, ::1, localhost) allowed without token by default
- [ ] Remote requests require `Authorization: Bearer <token>` header
- [ ] Auth failures logged with receipt
- [ ] `/api/health` is always public (for load balancers/probes)
- [ ] `CRUCIBULUM_API_TOKEN` env var controls the token
- [ ] `CRUCIBULUM_ALLOW_LOCAL=false` can disable local bypass
- [ ] `npm test` passes

---

## Fix 3: Rate Limiting & Circuit Breakers

### Problem
No rate limiting means a failing provider can be spammed with retries, causing cost spikes and cascading failures.

### Solution
Per-adapter rate limiter + circuit breaker with cooldown.

### Implementation

**A. Create `core/circuit-breaker.ts`:**

```typescript
/**
 * Crucibulum — Circuit Breaker & Rate Limiter
 * Prevents cascading failures and retry storms.
 */

import { log } from "../utils/logger.js";

// ─── Circuit Breaker ───────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before trying half-open */
  cooldownMs: number;
  /** Number of successful requests in half-open before closing */
  successThreshold: number;
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000, // 30 seconds
  successThreshold: 3,
};

interface CircuitState_ {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

const circuits = new Map<string, CircuitState_>();

function getCircuit(id: string): CircuitState_ {
  let c = circuits.get(id);
  if (!c) {
    c = { state: "closed", failures: 0, successes: 0, lastFailureAt: null, openedAt: null };
    circuits.set(id, c);
  }
  return c;
}

export function getCircuitState(id: string): { state: CircuitState; failures: number; lastFailureAt: number | null } {
  const c = getCircuit(id);
  return { state: c.state, failures: c.failures, lastFailureAt: c.lastFailureAt };
}

/** Check if a request is allowed through the circuit breaker */
export function circuitAllow(id: string): boolean {
  const c = getCircuit(id);
  
  if (c.state === "closed") return true;
  
  if (c.state === "open") {
    // Check if cooldown has passed
    if (c.openedAt && Date.now() - c.openedAt >= DEFAULT_CIRCUIT_CONFIG.cooldownMs) {
      c.state = "half-open";
      c.successes = 0;
      log("info", "circuit-breaker", `Circuit ${id}: open → half-open (cooldown expired)`);
      return true;
    }
    return false;
  }
  
  // half-open: allow through to test
  return true;
}

/** Record a successful request */
export function circuitSuccess(id: string): void {
  const c = getCircuit(id);
  
  if (c.state === "half-open") {
    c.successes++;
    if (c.successes >= DEFAULT_CIRCUIT_CONFIG.successThreshold) {
      c.state = "closed";
      c.failures = 0;
      c.successes = 0;
      c.openedAt = null;
      log("info", "circuit-breaker", `Circuit ${id}: half-open → closed (recovered)`);
    }
  } else {
    // Reset failure count on success
    c.failures = 0;
  }
}

/** Record a failed request */
export function circuitFailure(id: string): void {
  const c = getCircuit(id);
  c.failures++;
  c.lastFailureAt = Date.now();
  
  if (c.state === "half-open") {
    // Failed during half-open → back to open
    c.state = "open";
    c.openedAt = Date.now();
    log("warn", "circuit-breaker", `Circuit ${id}: half-open → open (test failed)`);
  } else if (c.failures >= DEFAULT_CIRCUIT_CONFIG.failureThreshold) {
    c.state = "open";
    c.openedAt = Date.now();
    log("warn", "circuit-breaker", `Circuit ${id}: closed → open (${c.failures} failures)`, {
      failureThreshold: DEFAULT_CIRCUIT_CONFIG.failureThreshold,
    });
  }
}

/** Force-reset a circuit (manual recovery) */
export function circuitReset(id: string): void {
  circuits.set(id, { state: "closed", failures: 0, successes: 0, lastFailureAt: null, openedAt: null });
  log("info", "circuit-breaker", `Circuit ${id}: manually reset`);
}

// ─── Rate Limiter ──────────────────────────────────────────────────

export interface RateLimiterConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in ms */
  windowMs: number;
}

const DEFAULT_RATE_CONFIG: RateLimiterConfig = {
  maxRequests: 30,       // 30 requests
  windowMs: 60_000,      // per minute
};

interface RateState_ {
  requests: number[];
  blocked: boolean;
}

const rateLimiters = new Map<string, RateState_>();

function getRateState(id: string): RateState_ {
  let s = rateLimiters.get(id);
  if (!s) {
    s = { requests: [], blocked: false };
    rateLimiters.set(id, s);
  }
  return s;
}

/** Check if a request is within the rate limit */
export function rateLimitAllow(id: string): boolean {
  const s = getRateState(id);
  const now = Date.now();
  const windowStart = now - DEFAULT_RATE_CONFIG.windowMs;
  
  // Prune old requests
  s.requests = s.requests.filter(t => t > windowStart);
  
  if (s.requests.length >= DEFAULT_RATE_CONFIG.maxRequests) {
    s.blocked = true;
    log("warn", "rate-limiter", `Rate limit exceeded for ${id}`, {
      count: s.requests.length,
      limit: DEFAULT_RATE_CONFIG.maxRequests,
      windowMs: DEFAULT_RATE_CONFIG.windowMs,
    });
    return false;
  }
  
  s.requests.push(now);
  s.blocked = false;
  return true;
}

/** Get current rate limit status for an adapter */
export function rateLimitStatus(id: string): { count: number; limit: number; remaining: number; resetsInMs: number } {
  const s = getRateState(id);
  const now = Date.now();
  const windowStart = now - DEFAULT_RATE_CONFIG.windowMs;
  const recent = s.requests.filter(t => t > windowStart);
  
  return {
    count: recent.length,
    limit: DEFAULT_RATE_CONFIG.maxRequests,
    remaining: Math.max(0, DEFAULT_RATE_CONFIG.maxRequests - recent.length),
    resetsInMs: recent.length > 0 ? Math.max(0, DEFAULT_RATE_CONFIG.windowMs - (now - Math.min(...recent))) : 0,
  };
}
```

**B. Integrate into adapter calls in `server/api.ts` or `adapters/registry.ts`:**

Before each adapter request:
```typescript
import { circuitAllow, circuitSuccess, circuitFailure, rateLimitAllow, rateLimitStatus } from "../core/circuit-breaker.js";

async function runWithProtection(adapterId: string, fn: () => Promise<unknown>): Promise<unknown> {
  // Circuit breaker check
  if (!circuitAllow(adapterId)) {
    throw new Error(`Circuit breaker OPEN for ${adapterId}. Cooling down. Check /api/health for status.`);
  }
  
  // Rate limit check
  if (!rateLimitAllow(adapterId)) {
    throw new Error(`Rate limit exceeded for ${adapterId}. Try again later.`);
  }
  
  try {
    const result = await fn();
    circuitSuccess(adapterId);
    return result;
  } catch (err) {
    circuitFailure(adapterId);
    throw err;
  }
}
```

**C. Add health endpoint for circuit/rate status:**

In `server/api.ts`:
```typescript
// GET /api/health/adapters — circuit breaker + rate limiter status
if (pathname === "/api/health/adapters" && method === "GET") {
  const adapters = await getAdapterCatalog();
  const status = adapters.map(a => ({
    id: a.id,
    circuit: getCircuitState(a.id),
    rateLimit: rateLimitStatus(a.id),
  }));
  return sendJSON(res, 200, { adapters: status });
}
```

### Exit Criteria
- [ ] `circuit-breaker.ts` exists with circuit breaker + rate limiter
- [ ] Circuit opens after 5 failures, cooldown 30s, half-open test, 3 successes to close
- [ ] Rate limiter: 30 requests per 60s window per adapter
- [ ] Adapter calls wrapped with `runWithProtection()`
- [ ] `GET /api/health/adapters` shows circuit/rate status
- [ ] Open circuits and rate-limited requests return clear errors (not silent)
- [ ] `npm test` passes

---

## Implementation Order

1. **Circuit breaker + rate limiter** (no dependencies, standalone module)
2. **API authentication** (no dependencies, standalone module)
3. **Scorer registry** (depends on judge integration, most complex)
4. **Integration** — wire all three into api.ts
5. **Test** — `npm run build && npm test`

## Testing

1. `npm run build` — must compile clean
2. `npm test` — must pass
3. Manual: start server, hit `/api/health` without token (should work locally)
4. Manual: hit `/api/run` from remote without token (should get 401)
5. Manual: load a custom scorer, verify it appears in `/api/scorers`
6. Manual: delete scorer file, verify startup logs the failure loudly
7. Manual: check `/api/health/adapters` for circuit/rate status

## Success Criteria

- Custom scoring fails loudly (not silently) when no scorer is loaded
- API requires authentication for non-local access
- Rate limiting and circuit breakers prevent retry storms
- All existing tests pass
- New functionality has clear error messages and health endpoints
