/**
 * Luak — local model identity (v1).
 *
 * A hosted model is identified by `adapter:provider:model`, and that is
 * sufficient there: the provider owns the weights, the runtime and the machine,
 * and changes them under a version string you can cite. Locally, none of that
 * holds. The same logical model may be four different artifacts at four
 * quantisations, served by two runtime builds with different samplers, on
 * hardware that decides whether half the tensors live on the GPU at all.
 *
 * So local evidence carries the whole tuple. Every field here can invalidate a
 * verdict on its own, and a verdict that cannot name them is not evidence about
 * any particular thing.
 *
 * **Backward compatibility is the hard constraint.** All of this is optional in
 * the evidence bundle. A hosted bundle written before this file existed stays
 * schema-valid and keeps its historical meaning — and, equally important, does
 * not silently become valid local qualification evidence. `isLocalQualifiable`
 * is the only gate that says otherwise, and it demands every field.
 */

/** Bump when a required field is added or a meaning changes. */
export const LOCAL_IDENTITY_VERSION = "local-identity-1.0.0" as const;
export type LocalIdentityVersion = typeof LOCAL_IDENTITY_VERSION;

export type ArtifactFormat = "gguf" | "safetensors" | "onnx" | "other";

/** The weights themselves, exactly. */
import type { TokenCountSource } from "./local-verdict.js";

export interface LocalArtifactIdentity {
  /** Stable logical identity. Never a filesystem path. */
  readonly modelId: string;
  /** Content digest of the artifact on disk, "sha256:<64 hex>". */
  readonly artifactDigest: string;
  /** e.g. "Q2_K", "Q4_K_M", "F16". A different quantisation is a different model. */
  readonly quantization: string;
  readonly format: ArtifactFormat;
  readonly sizeBytes: number | null;
  /** Parameter counts where known; null rather than guessed. */
  readonly parameterCount: number | null;
  readonly activeParameterCount: number | null;
}

/** The program that ran the weights. */
export interface LocalRuntimeIdentity {
  /** e.g. "llama.cpp", "vllm", "ollama". */
  readonly name: string;
  /** Exact build, e.g. "b10505-ee4c505a4". A tag is not enough. */
  readonly build: string;
  /** Digest of the server binary where the build is compiled per-host. */
  readonly binaryDigest: string | null;
  readonly apiFlavour: "openai-compatible" | "native" | "other";
}

/**
 * The prompt formatting actually applied.
 *
 * A model served with the wrong chat template produces degraded output that is
 * indistinguishable from incapacity. Recording the template identity is what
 * makes `local_prompt_template_mismatch` diagnosable rather than a guess.
 */
export interface PromptTemplateIdentity {
  /** Template name the runtime reports, e.g. "chatml", "llama3". */
  readonly templateId: string | null;
  /** Digest of the template text, when the runtime exposes it. */
  readonly templateDigest: string | null;
  /** Who applied it: the server from GGUF metadata, or Luak. */
  readonly appliedBy: "runtime" | "harness" | "unknown";
  readonly bosTokenId: number | null;
  readonly eosTokenId: number | null;
}

/**
 * Sampler settings. Determinism claims depend on these, so they are recorded
 * even when the runtime ignores them — `seedHonoured: false` is a fact worth
 * having when a repeatability measurement comes out noisier than expected.
 */
export interface SamplerIdentity {
  readonly temperature: number | null;
  readonly topP: number | null;
  readonly topK: number | null;
  readonly repeatPenalty: number | null;
  readonly seed: number | null;
  /** Whether the runtime confirmed it applied the seed. */
  readonly seedHonoured: boolean | null;
}

/** The machine. `id` is what evidence is keyed on; the rest is provenance. */
export interface HardwareProfileIdentity {
  readonly profileId: string;
  readonly gpuModel: string | null;
  readonly gpuMemoryMiB: number | null;
  readonly gpuDriver: string | null;
  readonly cudaVersion: string | null;
  readonly cpuModel: string | null;
  readonly systemMemoryMiB: number | null;
}

/**
 * Where the weights actually ended up.
 *
 * Requested and observed are separate fields on purpose. `--n-gpu-layers 999`
 * is a request; a CUDA init failure turns it into a CPU load that serves the
 * right artifact, attests correctly, and runs at roughly a third of the rate.
 * Only the observed values make that visible.
 */
export interface DevicePlacementFacts {
  readonly requestedGpuLayers: number | null;
  readonly observedGpuLayers: number | null;
  /** Experts or layers deliberately held in system RAM (e.g. --cpu-moe). */
  readonly cpuOffloadEnabled: boolean | null;
  readonly observedVramBytes: number | null;
  readonly observedHostRamBytes: number | null;
  /**
   * True only when the runtime was observed holding device memory. Not inferred
   * from flags: the flag says what was asked for, this says what happened.
   */
  readonly gpuConfirmed: boolean | null;
}

/**
 * Context, in three separate numbers that are routinely conflated.
 *
 * `configuredTokens` is what the server was started with. `effectiveMaxTokens`
 * is the largest prompt this evidence actually pushed through. `tierLabel`
 * names the fixture tier. A verdict earned at 1K says nothing about 32K, and
 * without `effectiveMaxTokens` there is no way to tell which one you have.
 */
export interface ContextFacts {
  readonly configuredTokens: number;
  readonly effectiveMaxTokens: number | null;
  readonly tierLabel: string | null;
  /**
   * How the token counts were obtained. Only "runtime_tokenizer" is a
   * measurement; everything else is labelled for what it is, so a character
   * count can never be presented as a token count. Shares one definition with
   * the attempt records — see [[TokenCountSource]] — because when the identity
   * kept its own narrower copy, a run measuring
   * `runtime_reported_unknown_tokenizer` had to describe itself as `unknown`.
   */
  readonly tokenCountSource: TokenCountSource;
}

/** Concurrency the runtime was configured for while the evidence was produced. */
export interface ConcurrencyFacts {
  readonly slots: number | null;
  readonly maxConcurrentRequests: number | null;
  readonly batchSize: number | null;
}

/**
 * The complete local identity. Optional on the bundle; all-or-nothing when
 * present, enforced by `isLocalQualifiable`.
 */
export interface LocalModelIdentity {
  readonly identityVersion: LocalIdentityVersion;
  readonly artifact: LocalArtifactIdentity;
  readonly runtime: LocalRuntimeIdentity;
  readonly promptTemplate: PromptTemplateIdentity;
  readonly sampler: SamplerIdentity;
  readonly hardware: HardwareProfileIdentity;
  readonly placement: DevicePlacementFacts;
  readonly context: ContextFacts;
  readonly concurrency: ConcurrencyFacts;
  /** Fixture suite this evidence was produced against, and its version. */
  readonly fixtureSuiteId: string;
  readonly fixtureSuiteVersion: string;
  /** Scoring/verification regime version. */
  readonly verificationRegimeVersion: string;
}

/** Fields without which local evidence is not about anything in particular. */
export const REQUIRED_LOCAL_IDENTITY_PATHS: readonly string[] = [
  "artifact.modelId",
  "artifact.artifactDigest",
  "artifact.quantization",
  "artifact.format",
  "runtime.name",
  "runtime.build",
  "hardware.profileId",
  "context.configuredTokens",
  "fixtureSuiteId",
  "fixtureSuiteVersion",
  "verificationRegimeVersion",
];

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

export interface LocalIdentityCheck {
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly invalid: readonly { readonly path: string; readonly why: string }[];
}

/**
 * Decide whether a bundle carries enough local identity to be qualification
 * evidence at all.
 *
 * Deliberately strict and deliberately silent about *quality*: this answers
 * "is this evidence about a specific artifact on a specific runtime on a
 * specific machine", nothing more. Partial identity is refused rather than
 * filled in, because a plausible default here is how one model's results end
 * up attributed to another.
 */
export function checkLocalIdentity(identity: unknown): LocalIdentityCheck {
  const missing: string[] = [];
  const invalid: { path: string; why: string }[] = [];

  if (!identity || typeof identity !== "object") {
    return { ok: false, missing: [...REQUIRED_LOCAL_IDENTITY_PATHS], invalid: [] };
  }

  for (const p of REQUIRED_LOCAL_IDENTITY_PATHS) {
    const v = get(identity, p);
    if (v === undefined || v === null || v === "") missing.push(p);
  }

  const digest = get(identity, "artifact.artifactDigest");
  if (typeof digest === "string" && !DIGEST_RE.test(digest)) {
    invalid.push({ path: "artifact.artifactDigest", why: "must be sha256:<64 lowercase hex>" });
  }
  const modelId = get(identity, "artifact.modelId");
  if (typeof modelId === "string" && /[\\/]|^\.|\.(gguf|safetensors|bin|onnx)$/i.test(modelId)) {
    invalid.push({
      path: "artifact.modelId",
      why: "must be a stable logical identity, never a filesystem path or artifact filename",
    });
  }
  const ctx = get(identity, "context.configuredTokens");
  if (typeof ctx === "number" && (!Number.isInteger(ctx) || ctx <= 0)) {
    invalid.push({ path: "context.configuredTokens", why: "must be a positive integer" });
  }
  const version = get(identity, "identityVersion");
  if (version !== undefined && version !== LOCAL_IDENTITY_VERSION) {
    invalid.push({
      path: "identityVersion",
      why: `this build implements ${LOCAL_IDENTITY_VERSION}`,
    });
  }

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

/** Convenience predicate. Absence of local identity is the normal hosted case. */
export function isLocalQualifiable(identity: unknown): boolean {
  return checkLocalIdentity(identity).ok;
}

/**
 * Whether device placement was confirmed rather than merely requested.
 *
 * Separate from identity completeness because a CPU-only run is still valid
 * evidence — of a CPU-only deployment. What it must never do is pass silently
 * as evidence of the GPU deployment somebody thought they were testing.
 */
export function placementConfirmed(p: DevicePlacementFacts): boolean {
  return p.gpuConfirmed === true;
}
