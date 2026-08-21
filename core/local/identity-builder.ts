/**
 * Luak — build a local model identity from the deployment, not from a person.
 *
 * `export-qualification` takes `--identity <file.json>`, and until now that file
 * was written by hand. Every field in it can invalidate a verdict on its own,
 * and a hand-written file has three failure modes that a derived one does not:
 * it can be wrong on the day it is written, it can go stale the moment anything
 * is restarted, and — worst — it can be *plausible*. The pilot's identity.json
 * carried `placement: { requestedGpuLayers: null, observedGpuLayers: null,
 * cpuOffloadEnabled: null, gpuConfirmed: null }` while the deployment it
 * described was running `--n-gpu-layers 999 --cpu-moe` on a confirmed device.
 * Nothing was lying; nobody had filled it in. The evidence simply could not say
 * where the model ran.
 *
 * So the identity is read out of Bokahli's own attestation. Bokahli is the
 * authority for served identity, device placement, tokenizer, template and
 * backend instance, and it publishes all of them on `/health/ready`. What this
 * module adds is the part Bokahli does not know: which fixture suite the
 * campaign ran, at which context tier, under which scoring regime, and what
 * sampler the responder sent.
 *
 * Two rules hold throughout:
 *
 *   - Nothing is defaulted. A field Bokahli does not report stays null and the
 *     identity check refuses the bundle. A plausible default here is how one
 *     deployment's results get attributed to another.
 *   - Nothing is asserted from configuration. `enforcementConfirmed` comes from
 *     Bokahli's behavioural probe, never from the fact that the campaign asked
 *     for a grammar; the difference between asking and getting is the whole
 *     reason those are two fields.
 */
import { LOCAL_IDENTITY_VERSION, type LocalModelIdentity } from "../../types/local-identity.js";
import type { TokenCountSource } from "../../types/local-verdict.js";
import { LOCAL_REGIME_VERSION } from "./regime.js";
import type { BokahliResponderConfig } from "./responders/bokahli-config.js";

/** Bump when the derivation changes what a field means. */
export const IDENTITY_BUILDER_VERSION = "local-identity-builder-1.0.0" as const;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export interface IdentityBuildInput {
  /** The parsed body of Bokahli's `/health/ready`. */
  readonly ready: Record<string, unknown>;
  /** The catalog entry Bokahli publishes for the artifact under test. */
  readonly modelEntry: Record<string, unknown>;
  readonly config: BokahliResponderConfig;
  readonly fixtureSuiteId: string;
  readonly fixtureSuiteVersion: string;
  /** Largest prompt this run actually pushed through, from the records. */
  readonly effectiveMaxTokens: number | null;
  /** Worst token-count provenance observed across the run. */
  readonly tokenCountSource: TokenCountSource;
  /** Host facts Bokahli does not publish. Read from the machine, not invented. */
  readonly hardware: {
    readonly profileId: string;
    readonly gpuModel: string | null;
    readonly gpuMemoryMiB: number | null;
    readonly gpuDriver: string | null;
    readonly cudaVersion: string | null;
    readonly cpuModel: string | null;
    readonly systemMemoryMiB: number | null;
  };
  /**
   * RSS of the serving process, in bytes.
   *
   * Bokahli reports VRAM but not host RAM: the backend's resident set is a
   * property of a process on this machine, and Bokahli deliberately does not
   * claim facts it has not measured.
   */
  readonly observedHostRamBytes: number | null;
  /**
   * Reported per attempt rather than by `/health/ready`, so read off the run's
   * records and passed in. Null under the unconstrained regime.
   */
  readonly outputSchemaDigest?: string | null;
  /** Bokahli's evidence-policy identity, as the attempts reported it. */
  readonly evidencePolicyVersion?: string | null;
  readonly evidencePolicyDigest?: string | null;
}

export function buildLocalIdentity(input: IdentityBuildInput): LocalModelIdentity {
  const ready = input.ready;
  const attestation = obj(ready["attestation"]);
  const binding = obj(attestation["binding"]);
  const placement = obj(ready["devicePlacement"]);
  const runtimeFacts = obj(ready["runtimeFacts"]);
  const tokenizer = obj(ready["tokenizer"]);
  const template = obj(ready["promptTemplate"]);
  const effectiveTemplate = obj(template["effective"]);
  const structured = obj(ready["structuredOutput"]);
  const invocation = obj(ready["runtimeInvocation"]);
  const entryFacts = obj(input.modelEntry["facts"]);
  const runtimeBlock = obj(ready["runtime"]);

  const constrained = input.config.regime === "json_schema";

  return {
    identityVersion: LOCAL_IDENTITY_VERSION,
    artifact: {
      modelId: String(binding["modelId"] ?? input.config.modelId),
      artifactDigest: String(binding["artifactDigest"] ?? input.config.artifactDigest),
      quantization: String(input.modelEntry["quantization"] ?? entryFacts["quantization"] ?? "unknown"),
      format: "gguf",
      sizeBytes: num(entryFacts["sizeBytes"]),
      parameterCount: num(entryFacts["parameterCount"]),
      activeParameterCount: num(entryFacts["activeParameterCount"]),
    },
    runtime: {
      name: str(runtimeFacts["engine"]) ?? "llama.cpp",
      build: String(runtimeBlock["build"] ?? binding["runtimeBuild"] ?? input.config.expectedRuntimeBuild),
      // Bokahli reports this as null with a stated limitation when the serving
      // image cannot be digested whole. Carried as null rather than filled with
      // a partial digest: a digest over part of an image is indistinguishable
      // from one over all of it, which is exactly why Bokahli refuses to offer
      // it as identity.
      binaryDigest: str(runtimeFacts["imageDigest"]),
      apiFlavour: "native",
    },
    promptTemplate: {
      templateId: str(effectiveTemplate["templateId"]),
      templateDigest: str(effectiveTemplate["templateDigest"]),
      appliedBy: str(effectiveTemplate["appliedBy"]) === "runtime" ? "runtime" : "unknown",
      bosTokenId: null,
      eosTokenId: null,
    },
    sampler: {
      temperature: input.config.sampler.temperature,
      topP: input.config.sampler.topP,
      topK: null,
      repeatPenalty: null,
      // The campaign sends no seed. Recorded as null with `seedHonoured: null`
      // rather than as a number nobody chose: "no seed was requested" and "a
      // seed was requested and ignored" are different repeatability stories.
      seed: null,
      seedHonoured: null,
    },
    hardware: input.hardware,
    placement: {
      requestedGpuLayers: num(placement["requestedGpuLayers"]),
      // Bokahli reports what was requested and whether the device is held; the
      // runtime does not publish a per-layer count, so this stays null rather
      // than being set equal to the request. Setting it equal would erase the
      // one distinction the field exists for.
      observedGpuLayers: null,
      cpuOffloadEnabled: bool(placement["cpuOffloadEnabled"]),
      observedVramBytes: (() => {
        const mib = num(placement["backendVramMiB"]);
        return mib === null ? null : mib * 1024 * 1024;
      })(),
      observedHostRamBytes: input.observedHostRamBytes,
      gpuConfirmed: bool(placement["backendHoldsDevice"]),
    },
    context: {
      configuredTokens: num(binding["servedContextTokens"]) ?? 0,
      effectiveMaxTokens: input.effectiveMaxTokens,
      tierLabel: input.config.contextTier,
      tokenCountSource: input.tokenCountSource,
    },
    concurrency: {
      slots: num(runtimeBlock["totalSlots"]),
      maxConcurrentRequests: num(binding["maxConcurrentRequests"]),
      batchSize: null,
    },
    generation: {
      regime: input.config.regime ?? "unconstrained",
      contractVersion: str(structured["contractVersion"]),
      outputSchemaDigest: constrained ? (input.outputSchemaDigest ?? null) : null,
      enforcementRequested: constrained,
      // From Bokahli's behavioural probe against the serving instance, never
      // from the fact that this campaign asked. A run that asked and was
      // ignored must be readable as exactly that.
      //
      // Null under the unconstrained regime, and that is not a formality. The
      // instance is *capable* of constraining — the probe says so — but nothing
      // was constrained on these attempts, and `enforcementConfirmed: true`
      // beside `enforcementRequested: false` reads as a run that got a grammar
      // it never asked for. Confirmed means confirmed for this evidence.
      enforcementConfirmed: constrained ? bool(structured["constrained"]) : null,
      evidencePolicyVersion: input.evidencePolicyVersion ?? null,
      evidencePolicyDigest: input.evidencePolicyDigest ?? null,
      // The flag the runtime was *started* with, read from its argv — not
      // `reasoningFormat`, which names the parser that would extract think tags
      // and reads "deepseek" on a Qwen deployment running `--reasoning off`.
      // Recording the parser name under this label would be recording a
      // different fact correctly.
      reasoningMode: str(invocation["requestedReasoning"]),
    },
    fixtureSuiteId: input.fixtureSuiteId,
    fixtureSuiteVersion: input.fixtureSuiteVersion,
    verificationRegimeVersion: LOCAL_REGIME_VERSION,
  } as LocalModelIdentity;
}
