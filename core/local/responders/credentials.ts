/**
 * Luak — Bokahli credential handling.
 *
 * One job: get a bearer token from an operator-controlled place into an
 * Authorization header, and nowhere else. Everything here is written on the
 * assumption that the token *will* end up somewhere it should not unless each
 * route is closed deliberately.
 *
 * Closed routes:
 *   - CLI arguments. A token in argv is in `ps`, in shell history, and in any
 *     crash report that dumps the command line. `readCredential` has no code
 *     path that accepts one, and the CLI has no flag for it.
 *   - Config files. `validateBokahliConfig` refuses a config carrying a
 *     token-shaped key at all.
 *   - Evidence, errors, receipts, logs. `redact()` runs over every diagnostic
 *     this responder emits, and the token is never placed on an attempt record.
 *   - Loose file permissions. A credential file readable by group or other is
 *     refused rather than warned about, as is one owned by another user.
 *   - Symlinked credentials and the stat-then-read race. The link is rejected
 *     before anything is opened, and the permission check runs against the same
 *     descriptor the bytes are read from.
 *
 * The token is held in a local const for the duration of one request and is
 * never stored on an object that gets serialised.
 */
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isSecretBearingKey, type BokahliResponderConfig } from "./bokahli-config.js";

export class CredentialError extends Error {}

/** Expand a leading `~` so operator-facing config can use the familiar form. */
function expand(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

/**
 * Read the bearer token.
 *
 * Returns the secret to the caller and keeps no copy. The error paths are
 * written to describe *where to look* without ever quoting what was found.
 */
export function readCredential(config: BokahliResponderConfig): string {
  if (config.credential.kind === "env") {
    const name = config.credential.variable;
    const value = process.env[name];
    if (!value || value.trim().length === 0) {
      throw new CredentialError(
        `environment variable ${name} is unset or empty. Export it in the shell that runs ` +
          "the campaign; it is never passed as an argument.",
      );
    }
    return value.trim();
  }

  const path = expand(config.credential.path);

  // Refuse a symlink before opening anything. `statSync` follows links and
  // reports the *target's* mode, so a world-writable symlink pointing at a
  // 0600 file passes a naive check — and whoever can rewrite the link chooses
  // which file gets read. Checking the link itself is the only way to see it.
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new CredentialError(
        `credential path ${path} is a symlink. Point the config at the real file: whoever can ` +
          "rewrite the link controls which file is read.",
      );
    }
  } catch (err) {
    if (err instanceof CredentialError) throw err;
    throw new CredentialError(`credential file not found: ${path}`);
  }

  // Open once, then check and read through the same descriptor. A stat-then-read
  // pair can be raced: the file that passed the permission check need not be the
  // file that gets read.
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    throw new CredentialError(`credential file cannot be opened: ${path}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) {
      throw new CredentialError(`credential path is not a regular file: ${path}`);
    }
    // 0600 or tighter. A token any local process can read is a token that has
    // already been shared with every local process.
    const mode = st.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new CredentialError(
        `credential file ${path} has mode ${mode.toString(8).padStart(4, "0")}; it must not be ` +
          "readable or writable by group or other. Fix with: chmod 600 " + path,
      );
    }
    // A file owned by someone else is a file someone else can rewrite between
    // one attempt and the next.
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (uid !== null && st.uid !== uid) {
      throw new CredentialError(
        `credential file ${path} is owned by uid ${st.uid}, not by this process (uid ${uid})`,
      );
    }
    const raw = readFileSync(fd, "utf-8").trim();
    if (raw.length === 0) throw new CredentialError(`credential file ${path} is empty`);
    return raw;
  } finally {
    closeSync(fd);
  }
}

/**
 * Scrub secrets from anything about to be logged, stored, or returned.
 *
 * Deliberately broad and pattern-based rather than "remove this one string":
 * the value being redacted is often not in scope where the redaction happens,
 * and a redactor that needs the secret in order to hide it is one more place
 * the secret has to travel.
 */
export function redact(text: string): string {
  return text
    .replace(/(authorization\s*:\s*)(bearer\s+)?\S+/gi, "$1Bearer «redacted»")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1«redacted»")
    .replace(/([?&](?:token|api_key|apikey|access_token)=)[^&\s]+/gi, "$1«redacted»")
    .replace(/(bokahli_token=)[^;\s]+/gi, "$1«redacted»")
    .replace(/("(?:token|secret|apiKey|api_key|password)"\s*:\s*")[^"]*(")/gi, "$1«redacted»$2");
}

/** Redact recursively through a structure destined for evidence or a log. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Redaction is deliberately broader than the config guard: here a false
      // positive costs a hidden diagnostic, while a false negative leaks a
      // secret. `authorization` is included as a whole-word match.
      out[k] = isSecretBearingKey(k) || /^authorization$/i.test(k)
        ? "«redacted»"
        : redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Headers for a request, built fresh each time.
 *
 * Not cached and not stored: a header object holding a bearer token that
 * survives past one request is an object that can be logged later.
 */
export function authHeaders(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
}

/** Headers with the credential removed, for diagnostics. */
export function safeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = k.toLowerCase() === "authorization" ? "Bearer «redacted»" : v;
  }
  return out;
}
