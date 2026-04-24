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
import { type Server } from "node:http";
export interface CreateAppOptions {
    /** If true, applies rate limiting; tests that exhaust buckets can pass false. Defaults to true. */
    rateLimit?: boolean;
}
/**
 * Build an http.Server wired to the Crucible routes. Does NOT call listen() —
 * the caller decides when/where to bind. Safe to import from tests.
 */
export declare function createApp(options?: CreateAppOptions): Server;
/**
 * Production boot. Loads the scorer registry, then binds the configured port.
 * Returns the listening server so callers can hold a reference for tests or
 * shutdown hooks.
 */
export declare function startServer(port?: number): Promise<Server>;
//# sourceMappingURL=app.d.ts.map