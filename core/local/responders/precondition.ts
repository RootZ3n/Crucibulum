/**
 * Luak — pre-attempt preconditions for a Bokahli campaign.
 *
 * Checked before **every** attempt, not once at the start. A deployment that
 * was healthy six attempts ago is not evidence that it is healthy now, and a
 * run that continued through a restart would mix two deployments under a single
 * evidence key — the kind of error that is invisible afterwards and invalidates
 * everything built on it.
 *
 * Returning a string aborts the run. Nothing is retried: an infrastructure
 * failure is preserved with its real attribution rather than papered over by a
 * second attempt that happened to work.
 */
import type { BokahliResponderConfig } from "./bokahli-config.js";
import { authHeaders, readCredential } from "./credentials.js";

export interface PreconditionSnapshot {
  readonly attempt: number;
  readonly ready: boolean;
  readonly runtimeHealth: string | null;
  readonly attested: boolean | null;
  readonly build: string | null;
  readonly modelId: string | null;
  readonly digest: string | null;
  readonly busySlots: number | null;
  readonly gpuUsedMiB: number | null;
  readonly foreignHolders: number | null;
}

export const preconditionLog: PreconditionSnapshot[] = [];

/** Builds the check. Returns null when everything holds, or a reason to abort. */
export function makeBokahliPrecondition(
  config: BokahliResponderConfig,
): (attempt: number) => Promise<string | null> {
  return async (attempt: number): Promise<string | null> => {
    let token: string;
    try {
      token = readCredential(config);
    } catch (err) {
      return `credential unavailable: ${(err as Error).message}`;
    }
    const headers = authHeaders(token);

    const get = async (path: string): Promise<Record<string, unknown> | null> => {
      try {
        const r = await fetch(`${config.endpoint}${path}`, {
          headers, redirect: "manual", signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) return null;
        return (await r.json()) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    const ready = await get("/health/ready");
    if (!ready) return `attempt ${attempt}: /health/ready did not return 200`;
    const runtime = (ready["runtime"] ?? {}) as Record<string, unknown>;
    const lease = (ready["gpuLease"] ?? {}) as Record<string, unknown>;
    const snapshot = (lease["snapshot"] ?? null) as Record<string, unknown> | null;
    const capacity = (ready["capacity"] ?? {}) as Record<string, unknown>;
    const foreign = (lease["foreignHolders"] ?? []) as unknown[];

    const models = await get("/v1/models");
    const first = ((models?.["data"] ?? []) as Record<string, unknown>[])[0];
    const bok = (first?.["bokahli"] ?? {}) as Record<string, unknown>;

    preconditionLog.push({
      attempt,
      ready: ready["status"] === "ready",
      runtimeHealth: (runtime["health"] as string) ?? null,
      attested: (runtime["attested"] as boolean) ?? null,
      build: (runtime["build"] as string) ?? null,
      modelId: (first?.["id"] as string) ?? null,
      digest: (bok["digest"] as string) ?? null,
      busySlots: (runtime["busySlots"] as number) ?? null,
      gpuUsedMiB: (snapshot?.["usedMiB"] as number) ?? null,
      foreignHolders: foreign.length,
    });

    if (ready["status"] !== "ready") return `attempt ${attempt}: deployment is not ready`;
    if (runtime["health"] !== "healthy") return `attempt ${attempt}: runtime health is ${String(runtime["health"])}`;
    if (runtime["attested"] !== true) return `attempt ${attempt}: runtime is not attested`;
    if (runtime["build"] !== config.expectedRuntimeBuild) {
      return `attempt ${attempt}: runtime build ${String(runtime["build"])} is not ${config.expectedRuntimeBuild}`;
    }
    if (first?.["id"] !== config.modelId) {
      return `attempt ${attempt}: advertised model ${String(first?.["id"])} is not ${config.modelId}`;
    }
    if (bok["digest"] !== config.artifactDigest) {
      return `attempt ${attempt}: advertised digest does not match the configured artifact`;
    }
    if (lease["available"] !== true) return `attempt ${attempt}: GPU lease is not available`;
    if (foreign.length > 0) {
      return `attempt ${attempt}: ${foreign.length} foreign GPU holder(s) — contention would ` +
        "make latency unattributable";
    }
    if (typeof capacity["depth"] === "number" && capacity["depth"] > 0) {
      return `attempt ${attempt}: queue depth ${String(capacity["depth"])}; something else is ` +
        "driving this deployment";
    }
    return null;
  };
}
