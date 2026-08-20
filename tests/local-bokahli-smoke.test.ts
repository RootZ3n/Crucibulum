/**
 * Bounded metadata-only smoke test against the live Bokahli deployment.
 *
 * Verifies authentication, inventory, readiness, exact served identity, runtime
 * metadata and device-placement reporting — and **invokes no generation**. Not
 * one request here reaches the model: `/health/live`, `/health/ready`,
 * `/v1/models` and `/v1/catalog` are all metadata routes, and the chat routes
 * are never touched.
 *
 * Skips cleanly when the deployment or the credential is absent, because a
 * developer without Mushin should not see a red suite. It does *not* skip when
 * both are present: the whole point is to catch a contract drift between what
 * the responder was written against and what the service actually serves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENDPOINT = process.env["LUAK_BOKAHLI_ENDPOINT"] ?? "http://127.0.0.1:8080";
const TOKEN_PATH = process.env["LUAK_BOKAHLI_TOKEN_PATH"]
  ?? join(homedir(), ".config", "bokahli", "token");

function credential(): string | null {
  if (!existsSync(TOKEN_PATH)) return null;
  const mode = statSync(TOKEN_PATH).mode & 0o777;
  if ((mode & 0o077) !== 0) return null;
  const t = readFileSync(TOKEN_PATH, "utf-8").trim();
  return t.length > 0 ? t : null;
}

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${ENDPOINT}/health/live`, { signal: AbortSignal.timeout(2_000) });
    return r.ok;
  } catch {
    return false;
  }
}

const available = (await reachable()) && credential() !== null;

test("live Bokahli: metadata only, no generation", { skip: !available }, async (t) => {
  const token = credential() as string;
  const auth = { authorization: `Bearer ${token}` };
  const get = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    const r = await fetch(`${ENDPOINT}${path}`, { headers: auth, signal: AbortSignal.timeout(10_000) });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: r.status, body };
  };

  await t.test("liveness is unauthenticated and readiness is not", async () => {
    const live = await fetch(`${ENDPOINT}/health/live`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(live.status, 200);
    const readyNoAuth = await fetch(`${ENDPOINT}/health/ready`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(readyNoAuth.status, 401, "readiness must require the token");
  });

  await t.test("a wrong token is refused", async () => {
    const r = await fetch(`${ENDPOINT}/v1/models`, {
      headers: { authorization: "Bearer definitely-not-the-token" },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(r.status, 401);
  });

  await t.test("readiness exposes the runtime metadata the responder binds to", async () => {
    const { status, body } = await get("/health/ready");
    assert.equal(status, 200);
    const runtime = body["runtime"] as Record<string, unknown>;
    for (const k of ["health", "reachable", "build", "attested", "servedContextTokens", "totalSlots"]) {
      assert.ok(k in runtime, `/health/ready runtime is missing ${k}`);
    }
    assert.equal(runtime["attested"], true);
    assert.equal(typeof runtime["build"], "string");
  });

  await t.test("device placement is whole-GPU, not per-process", async () => {
    const { body } = await get("/health/ready");
    const lease = body["gpuLease"] as Record<string, unknown>;
    const snapshot = lease["snapshot"] as Record<string, unknown> | null;
    assert.ok(snapshot, "gpuLease.snapshot should be present");
    for (const k of ["totalMiB", "usedMiB", "freeMiB", "utilisationPct", "temperatureC"]) {
      assert.equal(typeof snapshot[k], "number", `snapshot.${k}`);
    }
    // The documented gap: this is the whole device, so it cannot confirm that
    // *our* backend holds VRAM. Asserted so the limitation is a test fact
    // rather than a claim in a document nobody re-reads.
    assert.ok(!("ownProcessVramMiB" in snapshot), "per-process placement is not exposed");
  });

  await t.test("inventory exposes exact identity without a filesystem path", async () => {
    const { status, body } = await get("/v1/models");
    assert.equal(status, 200);
    const data = body["data"] as Record<string, unknown>[];
    assert.ok(data.length > 0);
    const b = data[0]?.["bokahli"] as Record<string, unknown>;
    for (const k of ["digest", "quantization", "servedContextTokens", "attested"]) {
      assert.ok(k in b, `/v1/models bokahli block is missing ${k}`);
    }
    assert.match(String(b["digest"]), /^sha256:[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(body).includes("/home/"), "no filesystem path may appear in inventory");
  });

  await t.test("no tokenizer provenance field exists anywhere in metadata", async () => {
    // The reason the exporter refuses qualification export today. If Bokahli
    // gains the field, this test fails and the responder can be upgraded.
    const ready = await get("/health/ready");
    const models = await get("/v1/models");
    const text = JSON.stringify(ready.body) + JSON.stringify(models.body);
    assert.ok(!/tokenCountSource|tokenizer/i.test(text),
      "Bokahli now reports tokenizer provenance — upgrade BOKAHLI_TOKEN_PROVENANCE");
  });

  await t.test("no prompt-template identity is exposed", async () => {
    const models = await get("/v1/models");
    assert.ok(!/chat_?template|templateId|templateDigest/i.test(JSON.stringify(models.body)));
  });
});
