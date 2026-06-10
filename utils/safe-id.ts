/**
 * Luak — Safe identifier + path-containment helpers.
 *
 * Centralizes the defense against the path-traversal cluster (audit C5): an
 * untrusted id (`../../etc/passwd`, `sessionId` from a manifest, a bundle id
 * from a URL) flowing into `join(dir, id)` and escaping the intended
 * directory — enabling arbitrary file read OR write.
 *
 * Two layers, applied together at every `join(dir, untrustedId)` site:
 *   1. assertSafeId / isSafeId — reject anything that isn't a single safe path
 *      segment ([A-Za-z0-9._-], no "/" "\" or ".."/".").
 *   2. assertContainedPath — post-resolve containment check so even a value
 *      that slipped past (1) cannot resolve outside the base directory.
 */

import { resolve, sep } from "node:path";

// A single, safe path segment. Note: the charset alone still admits the
// literal ".." and ".", so those are rejected explicitly below.
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;

/** True when `id` is safe to use as a single filesystem path segment. */
export function isSafeId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 256 &&
    id !== "." &&
    id !== ".." &&
    SAFE_ID_RE.test(id)
  );
}

/**
 * Throw unless `id` is a safe single path segment; returns the id on success
 * so it can be used inline: `join(dir, assertSafeId(rawId))`.
 */
export function assertSafeId(id: unknown, label = "id"): string {
  if (!isSafeId(id)) {
    const shown = typeof id === "string" ? id.slice(0, 64) : typeof id;
    throw new Error(`Unsafe ${label}: ${JSON.stringify(shown)} — must match [A-Za-z0-9._-], no path separators or ".."`);
  }
  return id;
}

/**
 * Post-resolve containment assertion. Ensures `candidate` resolves to `dir`
 * itself or something strictly inside it (using a trailing separator so a
 * sibling like `/runs-evil` cannot pass a bare `startsWith("/runs")`).
 * Returns the resolved absolute path.
 */
export function assertContainedPath(dir: string, candidate: string, label = "path"): string {
  const baseResolved = resolve(dir);
  const resolved = resolve(candidate);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + sep)) {
    throw new Error(`Unsafe ${label}: resolved path escapes ${baseResolved}`);
  }
  return resolved;
}

/**
 * Convenience: validate `id` as a safe segment, join it under `dir`, and
 * assert the result stays contained. Returns the resolved absolute path.
 */
export function safeJoinId(dir: string, id: unknown, suffix = "", label = "id"): string {
  const safe = assertSafeId(id, label);
  return assertContainedPath(dir, resolve(dir, `${safe}${suffix}`), label);
}
