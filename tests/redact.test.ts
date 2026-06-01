import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { redactSecrets, safeProviderError, REDACTED } from "../core/redact.js";
import type { StructuredProviderError } from "../types/provider-error.js";

// A representative fake key — clearly synthetic, never a live credential.
const FAKE_OR_KEY = "sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef";

function assertNoSecret(s: string): void {
  assert.ok(!s.includes(FAKE_OR_KEY), `leaked OpenRouter key: ${s}`);
  assert.ok(!/sk-or-v1-[A-Za-z0-9]/.test(s), `leaked sk-or-v1 key: ${s}`);
  assert.ok(!/bearer\s+[A-Za-z0-9]{8,}/i.test(s), `leaked Bearer token: ${s}`);
}

describe("redactSecrets — credentials", () => {
  it("redacts an sk-or-v1 OpenRouter key anywhere in the text", () => {
    const out = redactSecrets(`auth failed using ${FAKE_OR_KEY} on minimax`);
    assert.ok(out.includes(REDACTED));
    assertNoSecret(out);
  });

  it("redacts an Authorization header value (with Bearer)", () => {
    const out = redactSecrets(`Authorization: Bearer ${FAKE_OR_KEY}`);
    assertNoSecret(out);
    assert.ok(/authorization/i.test(out));
  });

  it("redacts a bare Bearer token", () => {
    const out = redactSecrets("sent header Bearer abcdef0123456789TOKEN");
    assertNoSecret(out);
  });

  it("redacts the OPENROUTER_API_KEY env assignment and its value", () => {
    const out = redactSecrets(`OPENROUTER_API_KEY=${FAKE_OR_KEY} not configured`);
    assertNoSecret(out);
    assert.ok(out.includes(`OPENROUTER_API_KEY=${REDACTED}`));
  });

  it("redacts generic apiKey / api_key / token / secret fields", () => {
    const out = redactSecrets('{"apiKey":"abc12345secret","api_key":"def67890","token":"qwertytoken","secret":"hunter2pass"}');
    assert.ok(!out.includes("abc12345secret"));
    assert.ok(!out.includes("def67890"));
    assert.ok(!out.includes("qwertytoken"));
    assert.ok(!out.includes("hunter2pass"));
  });

  it("redacts secrets inside a JSON request-headers blob", () => {
    const headers = JSON.stringify({ Authorization: `Bearer ${FAKE_OR_KEY}`, "X-Title": "luak" });
    const out = redactSecrets(`request headers: ${headers}`);
    assertNoSecret(out);
    // A non-secret header is allowed to survive.
    assert.ok(out.includes("luak"));
  });

  it("is idempotent", () => {
    const once = redactSecrets(`Authorization: Bearer ${FAKE_OR_KEY}`);
    assert.equal(redactSecrets(once), once);
  });

  it("does not over-redact ordinary prose", () => {
    const prose = "the token budget was fine and the secret sauce stayed put";
    assert.equal(redactSecrets(prose), prose);
  });

  it("accepts non-string input (objects/errors) without throwing", () => {
    const out = redactSecrets({ authorization: `Bearer ${FAKE_OR_KEY}` });
    assertNoSecret(out);
  });
});

describe("safeProviderError — projection allow-list", () => {
  const raw: StructuredProviderError = {
    kind: "AUTH",
    origin: "PROVIDER",
    provider: "openrouter",
    adapter: "openrouter",
    statusCode: 401,
    retryable: false,
    // Raw message deliberately carries a leaked key + header — must NOT survive.
    rawMessage: `HTTP 401 Authorization: Bearer ${FAKE_OR_KEY} — OPENROUTER_API_KEY=${FAKE_OR_KEY}`,
    rawCode: "no_auth",
    cause: `Bearer ${FAKE_OR_KEY}`,
    attempt: 1,
    durationMs: 32,
    requestId: "gen-abc123-XYZ",
  };

  it("keeps only safe fields and never the raw message, cause, or headers", () => {
    const safe = safeProviderError(raw, "minimax/minimax-m3");
    const serialized = JSON.stringify(safe);
    assertNoSecret(serialized);
    assert.ok(!serialized.includes("rawMessage"));
    assert.ok(!serialized.includes("cause"));
    assert.equal(safe.provider, "openrouter");
    assert.equal(safe.model, "minimax/minimax-m3");
    assert.equal(safe.statusCode, 401);
    assert.equal(safe.kind, "AUTH");
    // Message is the bucketed summary, not the raw provider text.
    assert.ok(/auth/i.test(safe.message));
  });

  it("preserves an opaque request id but drops a credential-shaped one", () => {
    assert.equal(safeProviderError(raw).requestId, "gen-abc123-XYZ");
    const tainted = safeProviderError({ ...raw, requestId: `Bearer ${FAKE_OR_KEY}` });
    assert.equal(tainted.requestId, null);
  });
});
