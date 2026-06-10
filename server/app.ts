/**
 * Luak — API app factory
 *
 * Pure factory for the HTTP server. The previous layout ran listen() as a
 * module-load side effect, which made it impossible to stand the server up in
 * a test without actually binding port 18795. This module exposes two things:
 *
 *   createApp()   — returns a configured http.Server that has NOT yet called listen()
 *   startServer() — the production boot path: loads scorers, binds the configured port
 *
 * Tests can call createApp() and manage the lifecycle themselves (listen on
 * port 0, send requests, close). The real entrypoint (server/api.ts) just
 * calls startServer() and does nothing else.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";
import { sendJSON } from "./routes/shared.js";
import { envValue } from "../utils/env.js";
import { loadAllScorers } from "../core/scorer-registry.js";
import { reapStaleWorkspaces } from "../core/cleanup.js";
import { initCircuitBreaker } from "../core/circuit-breaker.js";
import { enforce, RATE_READ, RATE_RUN, RATE_INGEST } from "./rate-limit.js";

import * as health from "./routes/health.js";
import * as run from "./routes/run.js";
import * as storage from "./routes/storage.js";
import * as suite from "./routes/suite.js";
import * as leaderboard from "./routes/leaderboard.js";
import * as registry from "./routes/registry.js";
import { handleRunBatch } from "./routes/batch.js";
import * as capExport from "./routes/export.js";
import * as vision from "./routes/vision.js";
import * as capVision from "./routes/capabilities-vision.js";
import * as roleplay from "./routes/roleplay.js";

const DEFAULT_PORT = parseInt(envValue("LUAK_PORT", "CRUCIBLE_PORT", "CRUCIBULUM_PORT") ?? "18795", 10);
const DEFAULT_HOST = envValue("LUAK_HOST", "CRUCIBLE_HOST", "CRUCIBULUM_HOST") ?? "127.0.0.1";
const UI_DIR = join(import.meta.dirname, "..", "..", "ui");
const UI_PATH = join(UI_DIR, "index.html");
const CRUCIBULUM_CSS_PATH = join(UI_DIR, "crucibulum.css");

export interface CreateAppOptions {
  /** If true, applies rate limiting; tests that exhaust buckets can pass false. Defaults to true. */
  rateLimit?: boolean;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, opts: CreateAppOptions): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${DEFAULT_PORT}`);
  const rawPath = url.pathname;
  // Reject paths with double-slash (path normalization bypass) or empty segments.
  // Also normalize all redundant consecutive slashes to prevent bypass attempts.
  if (rawPath.includes("//") || rawPath !== rawPath.replace(/\/\/+/g, "/")) {
    sendJSON(res, 400, { error: "Invalid path" });
    return;
  }
  const path = rawPath.replace(/\/\/+/g, "/");
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  try {
    if (path === "/" || path === "/index.html") {
      if (existsSync(UI_PATH)) {
        // Single-file UI: every fix lives in this HTML. Browser heuristic
        // caching of HTML defeats updates between sessions, so force a
        // re-fetch on every load. Static assets (css/png) still cache normally.
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        });
        res.end(readFileSync(UI_PATH, "utf-8"));
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h1>Luak</h1><p>UI not built yet.</p></body></html>");
      }
      return;
    }

    // Luak design-system stylesheet. Auctor is now a standalone
    // product with its own server and its own copy of these tokens; this
    // route only serves Luak's own shell.
    if (method === "GET" && path === "/crucibulum.css") {
      if (existsSync(CRUCIBULUM_CSS_PATH)) {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" });
        res.end(readFileSync(CRUCIBULUM_CSS_PATH, "utf-8"));
        return;
      }
    }

    if (method === "GET" && /^\/[a-zA-Z0-9_\-]+\.(png|jpg|jpeg|svg|webp|gif|ico)$/.test(path)) {
      const assetPath = join(UI_DIR, path.slice(1));
      if (existsSync(assetPath)) {
        const ext = path.split(".").pop()!.toLowerCase();
        const mime: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          svg: "image/svg+xml", webp: "image/webp", gif: "image/gif", ico: "image/x-icon",
        };
        res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
        res.end(readFileSync(assetPath));
        return;
      }
    }

    const isApi = path.startsWith("/api/") || ["runs", "stats", "receipts", "leaderboard", "health"].some((p) => path === `/${p}`);
    const isHealthAlias = path === "/health";

    if (isApi && opts.rateLimit !== false) {
      const isWrite = method === "POST" || method === "PATCH" || method === "DELETE";
      const rule = isWrite
        ? (path === "/api/scores/sync" || path === "/api/verum/ingest" ? RATE_INGEST : RATE_RUN)
        : RATE_READ;
      if (!enforce(req, res, rule)) return;
    }

    if ((path === "/api/health" || isHealthAlias) && method === "GET") {
      return void await health.handleHealth(req, res);
    }

    if (path === "/api/health/logs" && method === "GET") return void await health.handleHealthLogs(req, res);
    if (path === "/api/health/reaper" && method === "GET") return void await health.handleReaperHealth(req, res);
    if (path === "/api/scorers" && method === "GET") return void await health.handleScorers(req, res);
    if (path === "/api/scorers/health" && method === "GET") return void await health.handleScorersHealth(req, res);
    if (path === "/api/health/adapters" && method === "GET") return void await health.handleAdaptersHealth(req, res);
    if (path.startsWith("/api/adapters/") && path.endsWith("/reset-circuit") && method === "POST") {
      const adapterId = path.slice("/api/adapters/".length, path.length - "/reset-circuit".length);
      return void await health.handleResetAdapterCircuit(req, res, decodeURIComponent(adapterId));
    }
    if (path === "/api/judge" && method === "GET") return void await health.handleJudge(req, res);
    if (path === "/api/suites" && method === "GET") return void await health.handleSuites(req, res);
    if (path === "/api/tasks" && method === "GET") return void await health.handleTasks(req, res);
    if (path === "/api/adapters" && method === "GET") return void await health.handleAdapters(req, res);
    if (path === "/api/models" && method === "GET") return void await health.handleModels(req, res);
    if (path === "/api/providers" && method === "GET") return void await health.handleProviders(req, res);

    if ((path === "/api/runs" || path === "/runs") && method === "GET") return void await run.handleRunsList(req, res, url);
    if (path.startsWith("/api/runs/") && path.endsWith("/summary") && method === "GET") return void await run.handleRunSummary(req, res, path);
    if (path.startsWith("/api/runs/") && !path.includes("/live") && !path.endsWith("/summary") && !path.endsWith("/crucible-link") && !path.endsWith("/luak-link") && method === "GET") return void await run.handleRunGet(req, res, path);
    if ((path === "/api/stats" || path === "/stats") && method === "GET") return void await run.handleStats(req, res, url);
    if (path === "/api/receipts" && method === "GET") return void await run.handleReceipts(req, res, url);
    if (path === "/api/compare" && method === "GET") return void await run.handleCompare(req, res, url);
    if (path.startsWith("/api/run/") && path.endsWith("/status") && method === "GET") return void await run.handleRunStatus(req, res, path);
    if (path === "/api/run" && method === "POST") return void await run.handleRunPost(req, res);
    if (path.startsWith("/api/run/") && path.endsWith("/live") && method === "GET") return void await run.handleRunLive(req, res, path);

    // ── Storage / retention surface ─────────────────────────────────────
    if (path === "/api/storage/status" && method === "GET") return void await storage.handleStorageStatus(req, res);
    if (path === "/api/storage/cleanup" && method === "POST") return void await storage.handleStorageCleanup(req, res);

    if (path === "/api/run-suite" && method === "POST") return void await suite.handleRunSuitePost(req, res);
    if (path.startsWith("/api/run-suite/") && path.endsWith("/status") && method === "GET") return void await suite.handleRunSuiteStatus(req, res, path);

    if (path.startsWith("/api/runs/") && (path.endsWith("/crucible-link") || path.endsWith("/luak-link")) && method === "POST") return void await run.handleCrucibleLink(req, res, path);

    // ── Provider / model registry ───────────────────────────────────────
    if (path === "/api/registry/state" && method === "GET") return void await registry.handleRegistryState(req, res);
    if (path === "/api/registry/providers" && method === "POST") return void await registry.handleAddProvider(req, res);
    if (path === "/api/registry/models" && method === "POST") return void await registry.handleAddModel(req, res);
    if (path === "/api/registry/models/bulk" && method === "POST") return void await registry.handleBulkAddModels(req, res);
    if (path.startsWith("/api/registry/providers/") && path.endsWith("/test") && method === "POST") {
      return void await registry.handleTestProvider(req, res, path.slice("/api/registry/providers/".length, -"/test".length));
    }
    if (path.startsWith("/api/registry/providers/") && method === "PATCH") {
      return void await registry.handleUpdateProvider(req, res, path.slice("/api/registry/providers/".length));
    }
    if (path.startsWith("/api/registry/providers/") && method === "DELETE") {
      return void await registry.handleRemoveProvider(req, res, path.slice("/api/registry/providers/".length));
    }
    if (path.startsWith("/api/registry/models/") && method === "PATCH") {
      return void await registry.handleUpdateModel(req, res, path.slice("/api/registry/models/".length));
    }
    if (path.startsWith("/api/registry/models/") && method === "DELETE") {
      return void await registry.handleRemoveModel(req, res, path.slice("/api/registry/models/".length));
    }

    if (path === "/api/scores/sync" && method === "POST") return void await leaderboard.handleScoresSync(req, res);
    if (path === "/api/verum/ingest" && method === "POST") return void await leaderboard.handleVerumIngest(req, res);
    if (path === "/api/scores" && method === "GET") return void await leaderboard.handleScoresQuery(req, res, url);
    if (path === "/api/leaderboard/quarantine" && method === "GET") return void await leaderboard.handleLeaderboardQuarantine(req, res, url);
    if ((path === "/api/scores/leaderboard" || path === "/api/leaderboard" || path === "/leaderboard") && method === "GET") return void await leaderboard.handleLeaderboard(req, res, url);
    if (path === "/api/synthesis" && method === "POST") return void await leaderboard.handleSynthesis(req, res);
    if (path === "/api/run-batch" && method === "POST") return void await handleRunBatch(req, res);

    // ── Vision (experimental, not in leaderboard/certification) ──────────
    if (path === "/api/vision/latest-smoke" && method === "GET") return void await vision.handleLatestSmoke(req, res);
    // Roadmap Phase D — read-only Vision promotion evaluator. Never
    // mutates registries or persistent state; surfaces the doctrine
    // evaluator's PROVIDER_TESTED / STABLE / CAPABILITY_CERTIFIED
    // decisions for currently-tested Vision routes. GET-only by design.
    if (path === "/api/capabilities/vision/promotion-evaluation" && method === "GET") return void await capVision.handlePromotionEvaluation(req, res);
    // Phase 16 / Roadmap follow-up — explicit, confirmation-gated
    // Vision capability promotion write phase. POST-only. Refuses to
    // write unless aggregateCapabilityCertified.decision.eligible is
    // true with empty blockingReasons. Writes data/capability-certifications.json
    // + an immutable receipt under reports/capability-promotions/vision/.
    // Never touches certified-models.json or MODEL_CERTIFICATION.tier.
    if (path === "/api/capabilities/vision/promote" && method === "POST") return void await capVision.handlePromote(req, res);

    // ── Roleplay (experimental, not in leaderboard/certification) ────────
    if (path === "/api/roleplay/latest-smoke" && method === "GET") return void await roleplay.handleLatestSmoke(req, res);

    // ── Capability export ────────────────────────────────────────────────
    if (path === "/api/export/capability-summary" && method === "GET") return void await capExport.handleCapabilitySummary(req, res);
    if (path.startsWith("/api/export/model-eligibility/") && method === "GET") {
      const modelId = decodeURIComponent(path.slice("/api/export/model-eligibility/".length));
      return void await capExport.handleModelEligibility(req, res, modelId);
    }

    sendJSON(res, 404, { error: "Not found" });
  } catch (err) {
    // Don't leak internal error strings (stack traces, file paths, provider
    // detail) to the client. Log the full error server-side under a
    // correlation id and return only that id. (Audit M2.)
    const correlationId = randomUUID();
    log("error", "api", `Request error [${correlationId}]: ${String(err)}`);
    sendJSON(res, 500, { error: "Internal server error", correlation_id: correlationId });
  }
}

/**
 * Build an http.Server wired to the Luak routes. Does NOT call listen() —
 * the caller decides when/where to bind. Safe to import from tests.
 */
export function createApp(options: CreateAppOptions = {}): Server {
  const opts = { rateLimit: true, ...options };
  return createServer((req, res) => {
    handleRequest(req, res, opts).catch((err) => {
      log("error", "api", String(err));
      res.writeHead(500);
      res.end("Internal error");
    });
  });
}

/**
 * Emit a startup warning when no bundle-signing HMAC key is configured.
 * Without it the integrity model is inert: every bundle verifies to
 * "legacy_unverified" and forged bundles are indistinguishable from
 * legitimate ones. (Audit C4 — the server was started directly, bypassing
 * start.sh's key auto-generation, so this warning is the only signal.)
 *
 * Returns the resolved status so callers/tests can assert without re-reading
 * the environment. Exported for unit testing the warning path.
 */
export function warnIfHmacKeyMissing(): "missing" | "legacy-alias" | "ok" {
  if (!process.env["LUAK_HMAC_KEY"] && !process.env["CRUCIBLE_HMAC_KEY"]) {
    log("warn", "hmac", "WARNING: No HMAC key configured. All bundles will be unsigned. Set LUAK_HMAC_KEY in .env.");
    log("warn", "hmac", "Unsigned bundles will be quarantined and not ranked on the public leaderboard. This is fine for local demos, but meaningful verified rankings require a configured HMAC key.");
    return "missing";
  }
  if (!process.env["LUAK_HMAC_KEY"] && process.env["CRUCIBLE_HMAC_KEY"]) {
    log("warn", "hmac", "Using deprecated CRUCIBLE_HMAC_KEY; rename to LUAK_HMAC_KEY (CRUCIBLE_* remains supported as an alias)");
    return "legacy-alias";
  }
  return "ok";
}

/**
 * Production boot. Loads the scorer registry, then binds the configured port.
 * Returns the listening server so callers can hold a reference for tests or
 * shutdown hooks.
 */
export async function startServer(port: number = DEFAULT_PORT, host: string = DEFAULT_HOST): Promise<Server> {
  const server = createApp();
  log("info", "api", "Auth: NONE — no built-in authentication. Bind to loopback or put a private-network gate (Tailscale, VPN, firewall, reverse-proxy auth) in front of Luak if you expose it beyond this machine.");
  warnIfHmacKeyMissing();
  // Reload persisted circuit state so a restart honors in-flight cooldowns
  // instead of re-thrashing providers that were mid-ban. (Audit C3.)
  initCircuitBreaker();
  try {
    const scorerResults = await loadAllScorers();
    log("info", "api", `Scorer registry: ${scorerResults.loaded} loaded, ${scorerResults.failed.length} failed`);
    for (const f of scorerResults.failed) {
      log("error", "api", `Scorer load failure: ${f.path} — ${f.error}`);
    }
  } catch (err) {
    log("error", "api", `Failed to initialize scorer registry: ${String(err)}`);
  }
  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  log("info", "api", `Luak server running on http://${displayHost}:${port}`);
  log("info", "api", `Bind host: ${host}`);
  log("info", "api", `UI: http://${displayHost}:${port}/`);
  log("info", "api", `API: http://${displayHost}:${port}/api/`);

  // Run one reap synchronously at startup (Audit C2). The hourly interval is
  // unref'd, so on a short-lived or freshly-restarted process it may never
  // fire — that's how 78 stale workspaces survived a 3.6-day uptime. A
  // synchronous startup pass guarantees at least one cleanup per boot and
  // populates /api/health/reaper before the first request is served.
  try {
    const startup = reapStaleWorkspaces();
    log("info", "api", `Startup workspace reap: checked ${startup.checked}, deleted ${startup.deleted}, kept ${startup.kept}`);
  } catch (err) {
    log("warn", "api", `Startup workspace reap error: ${String(err)}`);
  }

  // TTL reaper: periodically remove stale workspace dirs (only ws_*, never
  // bundles) so a crashed/OOM-killed run doesn't leak its workspace. (Audit M6.)
  const reaper = setInterval(() => {
    try { reapStaleWorkspaces(); } catch (err) { log("warn", "api", `Workspace reaper error: ${String(err)}`); }
  }, 60 * 60 * 1000);
  reaper.unref?.();

  // Graceful shutdown: run one final reap and close the listener so a clean
  // SIGTERM/SIGINT (systemd stop, Ctrl-C) doesn't leave the port or stale
  // workspaces behind. (Audit M6.)
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", "api", `Received ${signal} — shutting down`);
    clearInterval(reaper);
    try { reapStaleWorkspaces(); } catch { /* best effort */ }
    server.close(() => process.exit(0));
    // Don't hang forever if connections linger.
    setTimeout(() => process.exit(0), 5_000).unref?.();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return server;
}
