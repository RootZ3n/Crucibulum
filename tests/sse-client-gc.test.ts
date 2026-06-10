/**
 * Luak — SSE client GC tests (Audit H1)
 *
 * `sseClients` previously grew without bound: disconnected clients were never
 * evicted and `broadcastSSE` swallowed write errors. These tests pin the two
 * eviction paths — `req.on('close')` removing a client (and dropping the
 * emptied run slot) and the periodic GC sweep removing dead sockets.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRunLive, sseClients, sweepDeadSSEClients } from "../server/routes/run.js";

afterEach(() => sseClients.clear());

/** Minimal SSE response stub: records writes, simulates socket lifecycle. */
class MockRes extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  writes: string[] = [];
  writeHead() { return this; }
  write(chunk: string) {
    if (this.destroyed || this.writableEnded) throw new Error("write after end");
    this.writes.push(chunk);
    return true;
  }
  end() { this.writableEnded = true; }
}

describe("SSE client GC (H1)", () => {
  it("removes a client and drops the empty run slot on req close", async () => {
    const req = new EventEmitter() as unknown as IncomingMessage;
    const res = new MockRes();
    await handleRunLive(req, res as unknown as ServerResponse, "/api/run/h1-close/live");

    assert.equal(sseClients.get("h1-close")?.length, 1, "client registered while connected");

    req.emit("close");

    assert.equal(sseClients.has("h1-close"), false, "run slot removed once its last client disconnects");
  });

  it("keeps other clients on the same run when one disconnects", async () => {
    const reqA = new EventEmitter() as unknown as IncomingMessage;
    const reqB = new EventEmitter() as unknown as IncomingMessage;
    await handleRunLive(reqA, new MockRes() as unknown as ServerResponse, "/api/run/h1-multi/live");
    await handleRunLive(reqB, new MockRes() as unknown as ServerResponse, "/api/run/h1-multi/live");
    assert.equal(sseClients.get("h1-multi")?.length, 2);

    reqA.emit("close");

    assert.equal(sseClients.get("h1-multi")?.length, 1, "only the disconnected client is removed");
  });

  it("sweep evicts dead sockets and cleans emptied slots", () => {
    const alive = new MockRes();
    const dead = new MockRes();
    dead.destroyed = true; // socket gone, never fired 'close'
    sseClients.set("h1-sweep", [alive as unknown as ServerResponse, dead as unknown as ServerResponse]);
    sseClients.set("h1-alldead", [dead as unknown as ServerResponse]);

    const result = sweepDeadSSEClients();

    assert.equal(result.removed, 2, "both dead-socket references evicted");
    assert.equal(result.runsCleaned, 1, "the all-dead run slot is removed");
    assert.equal(sseClients.get("h1-sweep")?.length, 1, "alive client retained");
    assert.equal(sseClients.has("h1-alldead"), false, "emptied slot dropped");
    assert.ok(alive.writes.some((w) => w.startsWith(": ping")), "alive client got a ping probe");
  });
});
