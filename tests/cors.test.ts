import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setCorsHeaders } from "../server/routes/shared.js";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockReq(origin?: string): IncomingMessage {
  return { headers: origin ? { origin } : {} } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
  } as unknown as ServerResponse & { _headers: Record<string, string> };
}

describe("CORS setCorsHeaders", () => {
  const savedOrigins = process.env["CRUCIBLE_ALLOWED_ORIGINS"];

  beforeEach(() => {
    delete process.env["CRUCIBLE_ALLOWED_ORIGINS"];
  });

  afterEach(() => {
    if (savedOrigins === undefined) delete process.env["CRUCIBLE_ALLOWED_ORIGINS"];
    else process.env["CRUCIBLE_ALLOWED_ORIGINS"] = savedOrigins;
  });

  it("allows localhost origin", () => {
    const res = mockRes();
    setCorsHeaders(mockReq("http://localhost:18795"), res);
    assert.equal(res._headers["access-control-allow-origin"], "http://localhost:18795");
  });

  it("allows 127.0.0.1 origin", () => {
    const res = mockRes();
    setCorsHeaders(mockReq("http://127.0.0.1:3000"), res);
    assert.equal(res._headers["access-control-allow-origin"], "http://127.0.0.1:3000");
  });

  it("blocks remote origin without CRUCIBLE_ALLOWED_ORIGINS", () => {
    const res = mockRes();
    setCorsHeaders(mockReq("http://evil.example.com"), res);
    assert.equal(res._headers["access-control-allow-origin"], undefined);
  });

  it("allows remote origin listed in CRUCIBLE_ALLOWED_ORIGINS", () => {
    process.env["CRUCIBLE_ALLOWED_ORIGINS"] = "http://my-app.example.com,http://other.test";
    const res = mockRes();
    setCorsHeaders(mockReq("http://my-app.example.com"), res);
    assert.equal(res._headers["access-control-allow-origin"], "http://my-app.example.com");
  });

  it("still blocks unlisted remote origin even with CRUCIBLE_ALLOWED_ORIGINS set", () => {
    process.env["CRUCIBLE_ALLOWED_ORIGINS"] = "http://allowed.example.com";
    const res = mockRes();
    setCorsHeaders(mockReq("http://evil.example.com"), res);
    assert.equal(res._headers["access-control-allow-origin"], undefined);
  });

  it("always sets allow-methods and allow-headers", () => {
    const res = mockRes();
    setCorsHeaders(mockReq(), res);
    assert.ok(res._headers["access-control-allow-methods"]);
    assert.ok(res._headers["access-control-allow-headers"]);
  });
});
