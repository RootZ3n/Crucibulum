/**
 * Crucible — API app factory
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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";
import { sendJSON } from "./routes/shared.js";
import { requireAuth, ensureTokenConfigured } from "./auth.js";
import { envValue } from "../utils/env.js";
import { loadAllScorers } from "../core/scorer-registry.js";
import { enforce, RATE_READ, RATE_RUN, RATE_INGEST } from "./rate-limit.js";

import * as health from "./routes/health.js";
import * as run from "./routes/run.js";
import * as suite from "./routes/suite.js";
import * as leaderboard from "./routes/leaderboard.js";
import * as auth from "./routes/auth.js";
import * as registry from "./routes/registry.js";
import { handleRunBatch } from "./routes/batch.js";

const DEFAULT_PORT = parseInt(envValue("CRUCIBLE_PORT", "CRUCIBULUM_PORT") ?? "18795", 10);
const DEFAULT_HOST = envValue("CRUCIBLE_HOST", "CRUCIBULUM_HOST") ?? "127.0.0.1";
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
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(UI_PATH, "utf-8"));
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h1>Crucible</h1><p>UI not built yet.</p></body></html>");
      }
      return;
    }

    // Crucible design-system stylesheet. Auctor is now a standalone
    // product with its own server and its own copy of these tokens; this
    // route only serves Crucible's own shell.
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
    // Auth-surface endpoints bypass the global auth gate. Each implements its
    // own policy: /auth/status is public; /auth/bootstrap* is loopback-only;
    // /auth/redeem is a public secret-input endpoint (rate-limited);
    // /auth/pairing and /auth/logout are auth-gated inside the handler.
    const isAuthSurface = path === "/api/auth/status"
      || path === "/api/auth/bootstrap"
      || path === "/api/auth/bootstrap-local"
      || path === "/api/auth/redeem"
      || path === "/api/auth/pairing"
      || path === "/api/auth/logout";

    if (isApi && opts.rateLimit !== false) {
      // /auth/redeem is brute-forceable input — bind it to the tighter
      // ingest bucket. Other auth-surface POSTs are also tight (avoids
      // someone using /pairing to spam token issuance).
      const isAuthIngest = path === "/api/auth/redeem" || path === "/api/auth/pairing" || path === "/api/auth/bootstrap-local";
      const isWrite = method === "POST" || method === "PATCH" || method === "DELETE";
      const rule = isWrite
        ? (isAuthIngest || path === "/api/scores/sync" || path === "/api/verum/ingest" ? RATE_INGEST : RATE_RUN)
        : RATE_READ;
      if (!enforce(req, res, rule)) return;
    }

    if (isApi && !isAuthSurface) {
      if (!requireAuth(req, res)) return;
    }

    if ((path === "/api/health" || isHealthAlias) && method === "GET") {
      return void await health.handleHealth(req, res);
    }

    if (path === "/api/auth/status" && method === "GET") {
      return void await auth.handleAuthStatus(req, res);
    }
    if (path === "/api/auth/bootstrap" && method === "GET") {
      return void await auth.handleAuthBootstrap(req, res);
    }
    if (path === "/api/auth/bootstrap-local" && method === "POST") {
      return void await auth.handleAuthBootstrapLocal(req, res);
    }
    if (path === "/api/auth/pairing" && method === "POST") {
      return void await auth.handleAuthPairing(req, res);
    }
    if (path === "/api/auth/redeem" && method === "POST") {
      return void await auth.handleAuthRedeem(req, res);
    }
    if (path === "/api/auth/logout" && method === "POST") {
      return void await auth.handleAuthLogout(req, res);
    }

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
    if (path.startsWith("/api/runs/") && !path.includes("/live") && !path.endsWith("/summary") && !path.endsWith("/crucible-link") && method === "GET") return void await run.handleRunGet(req, res, path);
    if ((path === "/api/stats" || path === "/stats") && method === "GET") return void await run.handleStats(req, res, url);
    if (path === "/api/receipts" && method === "GET") return void await run.handleReceipts(req, res, url);
    if (path === "/api/compare" && method === "GET") return void await run.handleCompare(req, res, url);
    if (path.startsWith("/api/run/") && path.endsWith("/status") && method === "GET") return void await run.handleRunStatus(req, res, path);
    if (path === "/api/run" && method === "POST") return void await run.handleRunPost(req, res);
    if (path.startsWith("/api/run/") && path.endsWith("/live") && method === "GET") return void await run.handleRunLive(req, res, path);

    if (path === "/api/run-suite" && method === "POST") return void await suite.handleRunSuitePost(req, res);
    if (path.startsWith("/api/run-suite/") && path.endsWith("/status") && method === "GET") return void await suite.handleRunSuiteStatus(req, res, path);

    if (path.startsWith("/api/runs/") && path.endsWith("/crucible-link") && method === "POST") return void await run.handleCrucibleLink(req, res, path);

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

    sendJSON(res, 404, { error: "Not found" });
  } catch (err) {
    log("error", "api", `Request error: ${String(err)}`);
    sendJSON(res, 500, { error: String(err) });
  }
}

/**
 * Build an http.Server wired to the Crucible routes. Does NOT call listen() —
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
 * Production boot. Loads the scorer registry, then binds the configured port.
 * Returns the listening server so callers can hold a reference for tests or
 * shutdown hooks.
 */
export async function startServer(port: number = DEFAULT_PORT, host: string = DEFAULT_HOST): Promise<Server> {
  const server = createApp();
  // Resolve/generate the auth token and log the bootstrap banner if one was
  // just auto-generated. Done before listen() so the banner appears above
  // the "server running" line in operator logs.
  ensureTokenConfigured();
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
  log("info", "api", `Crucible server running on http://${displayHost}:${port}`);
  log("info", "api", `Bind host: ${host}`);
  log("info", "api", `UI: http://${displayHost}:${port}/`);
  log("info", "api", `API: http://${displayHost}:${port}/api/`);
  return server;
}
