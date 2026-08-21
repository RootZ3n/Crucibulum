/**
 * Luak CLI — `local-qualify` and `export-qualification`.
 *
 * The supported entry points into the local lane. Before these existed, the
 * lane was a collection of modules nothing executed: no command reached it,
 * `core/suite-loader.ts` could not load a local suite by its declared id, and
 * producing an export meant hand-writing a script and assembling JSON. That is
 * not an integration, and the audit was right to say so.
 *
 * Both commands are offline by default. `local-qualify` is a dry run unless
 * `--responder` names one, and the credential is never a flag — it is read at
 * request time from an environment variable or a 0600 file named in the
 * responder config, so it never appears in argv, in `ps`, or in shell history.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../../utils/logger.js";
import {
  canAdjudicate, listLocalSuites, loadLocalSuite, LocalSuiteError,
} from "../../core/local/suite-registry.js";
import { runLocalSuite } from "../../core/local/runner.js";
import { summarise } from "../../core/local/regime.js";
import { exportBokahliBundle } from "../../core/local/bokahli-export.js";
import { assertSplitsDisjoint } from "../../core/local/fixtures/index.js";
import { buildLocalIdentity } from "../../core/local/identity-builder.js";
import { readCredential } from "../../core/local/responders/credentials.js";
import { checkLocalIdentity, type LocalModelIdentity } from "../../types/local-identity.js";
import type { AttemptRecord } from "../../core/local/regime.js";
import type { LocalSuite } from "../../core/local/suite-registry.js";
import type { BokahliResponderConfig } from "../../core/local/responders/bokahli-config.js";
import { hostname, totalmem } from "node:os";
import { readFileSync as readFileSyncNode } from "node:fs";

/**
 * Read the deployment's own account of itself, and fill in only what it cannot
 * know.
 *
 * Bokahli is the authority for served identity, placement, tokenizer, template
 * and backend instance. What it does not publish is the host's CPU and memory,
 * the backend's resident set, and which fixture suite and regime this campaign
 * ran — so those, and only those, are gathered here.
 */
async function deriveIdentity(args: {
  config: BokahliResponderConfig;
  suite: LocalSuite;
  records: readonly AttemptRecord[];
  tokenCountSource: string;
}): Promise<LocalModelIdentity> {
  const { config } = args;
  const token = await readCredential(config);
  const get = async (path: string): Promise<Record<string, unknown>> => {
    const r = await fetch(`${config.endpoint}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`${path} returned ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  };

  const ready = await get("/health/ready");
  const models = await get("/v1/models");
  const data = Array.isArray(models["data"]) ? (models["data"] as Record<string, unknown>[]) : [];
  // Found by identity, never at index zero. A catalog is advertised in whatever
  // order it was loaded, and the campaign's artifact is the one it names.
  const entry = data.find((e) => e["id"] === config.modelId);
  const modelEntry = {
    ...((entry?.["bokahli"] as Record<string, unknown> | undefined) ?? {}),
  };

  // The backend's resident set, from the process Bokahli says is serving.
  const instance = (ready["backendInstance"] ?? {}) as Record<string, unknown>;
  const pid = typeof instance["pid"] === "number" ? instance["pid"] : null;
  let observedHostRamBytes: number | null = null;
  if (pid !== null) {
    try {
      const status = readFileSyncNode(`/proc/${pid}/status`, "utf-8");
      const m = status.match(/^VmRSS:\s+(\d+) kB$/m);
      if (m) observedHostRamBytes = Number(m[1]) * 1024;
    } catch {
      // A pid we cannot read leaves the field null. Never estimated.
    }
  }

  const gpu = ((ready["gpuLease"] as Record<string, unknown> | undefined)?.["snapshot"] ?? {}) as
    Record<string, unknown>;
  const runtimeFacts = (ready["runtimeFacts"] ?? {}) as Record<string, unknown>;
  let cpuModel: string | null = null;
  try {
    const info = readFileSyncNode("/proc/cpuinfo", "utf-8");
    cpuModel = info.match(/^model name\s*:\s*(.+)$/m)?.[1]?.trim() ?? null;
  } catch { /* not Linux, or unreadable: stays null */ }

  const gpuMemoryMiB = typeof gpu["totalMiB"] === "number" ? (gpu["totalMiB"] as number) : null;
  // The device's own name, from the driver. Bokahli publishes VRAM, utilisation
  // and temperature but not the model string — it reports what it measures, and
  // the name is not something it measures. Read here, like the CPU model, and
  // left null when the driver cannot be asked rather than filled with a guess.
  let gpuModel: string | null = null;
  try {
    const { execFileSync } = await import("node:child_process");
    gpuModel = execFileSync("nvidia-smi",
      ["--query-gpu=name", "--format=csv,noheader"],
      { encoding: "utf-8", timeout: 5000 }).split("\n")[0]?.trim() || null;
  } catch { /* no driver, or no nvidia-smi: stays null */ }

  // Per-attempt facts that live on the records rather than on /health/ready.
  const withGen = args.records.find((r) => r.generation != null);
  const promptTokens = args.records
    .map((r) => r.promptTokens)
    .filter((v): v is number => typeof v === "number");

  return buildLocalIdentity({
    ready,
    modelEntry,
    config,
    fixtureSuiteId: args.suite.fixtureSuites[0]?.id ?? args.suite.id,
    fixtureSuiteVersion: args.suite.fixtureSuites[0]?.version ?? args.suite.version,
    effectiveMaxTokens: promptTokens.length ? Math.max(...promptTokens) : null,
    tokenCountSource: args.tokenCountSource as never,
    hardware: {
      // Host, device and VRAM. Evidence is keyed on this, so two machines that
      // differ in the thing that decides where a model runs must not share it.
      profileId: [
        hostname(),
        gpuModel?.toLowerCase().replace(/^nvidia\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        gpuMemoryMiB === null ? null : `${Math.round(gpuMemoryMiB / 1024)}g`,
      ].filter((x): x is string => typeof x === "string" && x.length > 0).join("-"),
      gpuModel,
      gpuMemoryMiB,
      gpuDriver: typeof runtimeFacts["driverVersion"] === "string" ? (runtimeFacts["driverVersion"] as string) : null,
      cudaVersion: typeof runtimeFacts["driverSupportedCuda"] === "string" ? (runtimeFacts["driverSupportedCuda"] as string) : null,
      cpuModel,
      systemMemoryMiB: Math.round(totalmem() / (1024 * 1024)),
    },
    observedHostRamBytes,
    outputSchemaDigest: withGen?.generation?.outputSchemaDigest ?? null,
    evidencePolicyVersion: withGen?.generation?.evidencePolicyVersion ?? null,
    evidencePolicyDigest: withGen?.generation?.evidencePolicyDigest ?? null,
  });
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

const USAGE = `
Luak local qualification

  luak local-qualify --list
      List local suites, their adjudication state, and fixture coverage.

  luak local-qualify --suite <id> [--split evaluation|development|both] [--seed N]
                     [--responder bokahli --responder-config <path.json>]
      Build the suite's prompts and report coverage. Without --responder this is
      a dry run and nothing is invoked. With --responder bokahli it executes
      attempts against the configured Bokahli deployment, one request at a time.
      The credential is never a flag: name it in the config as an environment
      variable or a 0600 file.

  luak export-qualification --suite <id> --identity <path.json> --records <path.json>
                            [--out <path.json>] [--allow-development-split]
      Produce a Bokahli Phase 2A import bundle from recorded attempts. Refuses
      incomplete, mixed, or non-model-attributable evidence. Never claims
      Bokahli import trust.
`;

export async function localQualifyCommand(args: string[]): Promise<void> {
  assertSplitsDisjoint();

  if (has(args, "list") || args.length === 0) {
    const suites = listLocalSuites();
    if (suites.length === 0) {
      console.log("No local suites found. Expected suites/local/*.json");
      return;
    }
    console.log("\nLocal qualification suites\n");
    for (const s of suites) {
      console.log(`  ${s.id}@${s.version}`);
      console.log(`    ${s.label}`);
      console.log(`    lane=${s.lane}  interface=${s.requiresInterface}  ` +
        `adjudication=${s.adjudication}  canAdjudicate=${canAdjudicate(s)}`);
      console.log(`    fixtures: ${s.fixtureSuites.map((f) => `${f.id}@${f.version}`).join(", ") || "(none)"}`);
      console.log(`    tiers: ${s.contextTiers.join(", ")}`);
      console.log(`    bound: regime=${s.boundVersions.regime} scorers=${s.boundVersions.scorers}`);
      console.log("");
    }
    console.log("No suite can adjudicate: thresholds are unset by design until a campaign\n" +
      "has produced the distributions to choose them from.\n");
    return;
  }

  const suiteId = flag(args, "suite");
  if (!suiteId) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  let suite;
  try {
    suite = loadLocalSuite(suiteId);
  } catch (err) {
    if (err instanceof LocalSuiteError) {
      log("error", "local", err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  if (!suite) {
    log("error", "local", `no local suite "${suiteId}". Try: luak local-qualify --list`);
    process.exitCode = 1;
    return;
  }

  const split = (flag(args, "split") ?? "evaluation") as "development" | "evaluation" | "both";
  const seed = Number(flag(args, "seed") ?? 1);
  const repeats = Number(flag(args, "repeats") ?? 1);

  const responderName = flag(args, "responder");
  let responder;
  let responderConfig: import("../../core/local/responders/bokahli-config.js").BokahliResponderConfig | undefined;
  if (responderName === "bokahli") {
    const cfgPath = flag(args, "responder-config");
    if (!cfgPath) {
      log("error", "local", "--responder bokahli requires --responder-config <path.json>");
      process.exitCode = 1;
      return;
    }
    const { createBokahliResponder } = await import("../../core/local/responders/bokahli.js");
    const { validateBokahliConfig } = await import("../../core/local/responders/bokahli-config.js");
    const parsedCfg = validateBokahliConfig(JSON.parse(readFileSync(cfgPath, "utf-8")));
    if (!parsedCfg.ok) {
      log("error", "local", "invalid responder config:");
      for (const p of parsedCfg.problems) log("error", "local", `  ${p.field}: ${p.detail}`);
      process.exitCode = 1;
      return;
    }
    responder = createBokahliResponder({ config: parsedCfg.config });
    responderConfig = parsedCfg.config;
  } else if (responderName !== undefined) {
    log("error", "local", `unknown responder "${responderName}" (have: bokahli)`);
    process.exitCode = 1;
    return;
  }

  // Preconditions are re-checked before every attempt when a responder is
  // configured. A deployment that was healthy at the start of a run is not
  // evidence that it is healthy now, and continuing through a restart would mix
  // two deployments under one evidence key.
  const precondition = responder
    ? await (async () => {
        const { makeBokahliPrecondition } = await import("../../core/local/responders/precondition.js");
        return makeBokahliPrecondition(responderConfig!);
      })()
    : undefined;

  const { parseTriageAnswer, parseReconAnswer } = await import("../../core/local/parsers.js");

  const result = await runLocalSuite({
    suite, split, seed, repeats,
    parseTriage: parseTriageAnswer,
    parseRecon: parseReconAnswer,
    ...(responder ? { responder } : {}),
    ...(precondition ? { precondition } : {}),
  });

  if (result.abortedReason) {
    log("error", "local", `run aborted: ${result.abortedReason}`);
    log("error", "local", "no infrastructure failure is retried; the partial run is preserved as-is");
  }

  console.log(`\n${suite.id}@${suite.version} — ${suite.label}`);
  console.log(`  adjudication : ${suite.adjudication} (canAdjudicate=${canAdjudicate(suite)})`);
  console.log(`  split        : ${split}`);
  console.log(`  prompts built: ${result.prompts.length}`);
  const bySplit = result.prompts.reduce<Record<string, number>>((a, p) => {
    a[p.split] = (a[p.split] ?? 0) + 1;
    return a;
  }, {});
  for (const [k, v] of Object.entries(bySplit)) console.log(`    ${k}: ${v}`);
  if (result.dryRun) {
    console.log("  mode         : DRY RUN — no responder configured, so nothing was contacted");
    console.log("                 and no attempt records were produced.");
  } else {
    console.log(`  mode         : LIVE via --responder ${responderName}`);
    console.log(`  attempts     : ${result.records.length}`);
    const outcomes = result.scored.reduce<Record<string, number>>((a, s2) => {
      a[s2.outcome] = (a[s2.outcome] ?? 0) + 1;
      return a;
    }, {});
    for (const [k, v] of Object.entries(outcomes)) console.log(`    ${k}: ${v}`);
  }
  console.log(`  token counts : ${result.tokenCountSource}`);
  if (result.tokenCountSource !== "runtime_tokenizer" && !result.dryRun) {
    console.log("                 NOT exportable as qualification evidence: only a");
    console.log("                 runtime-tokenizer measurement supports export.");
  }
  // Persist the canonical records so `export-qualification` can read them.
  // Written to runs/, which is gitignored: pilot output is plumbing evidence,
  // not something to commit.
  const out = flag(args, "out");
  if (out && !result.dryRun) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({
      suiteId: result.suiteId, suiteVersion: result.suiteVersion,
      tokenCountSource: result.tokenCountSource,
      abortedReason: result.abortedReason ?? null,
      records: result.records, scored: result.scored,
    }, null, 2)}\n`);
    console.log(`  records      : ${out}`);

    // The completions, beside the records rather than inside them.
    //
    // A structured-output verdict is a claim about specific bytes. The previous
    // campaign kept none, so its "HARNESS_PARSER" attributions could not be
    // re-read and checked — which is how a model defect stayed labelled as a
    // harness defect for a whole campaign. Each record's `completion.sha256`
    // resolves into this file. Nothing here is repaired or re-escaped, and it
    // never enters an export bundle.
    const completionsPath = out.replace(/\.json$/, "") + ".completions.json";
    writeFileSync(completionsPath, `${JSON.stringify({
      note: "Raw model completions, verbatim. Resolved from records[].completion.sha256.",
      suiteId: result.suiteId,
      completions: result.completions,
    }, null, 2)}\n`);
    console.log(`  completions  : ${completionsPath}`);

    // The identity, derived beside the records rather than written by hand.
    //
    // These two files describe one run and are produced from it together, so
    // they cannot drift apart. The pilot's hand-written identity claimed null
    // placement for a deployment running `--n-gpu-layers 999 --cpu-moe` on a
    // confirmed device — not a lie, just a file nobody had filled in, and
    // evidence that could not say where the model ran.
    if (responderConfig) {
      try {
        const identity = await deriveIdentity({
          config: responderConfig,
          suite,
          records: result.records,
          tokenCountSource: result.tokenCountSource,
        });
        const identityPath = out.replace(/\.json$/, "") + ".identity.json";
        writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`);
        console.log(`  identity     : ${identityPath}`);
        const check = checkLocalIdentity(identity);
        if (!check.ok) {
          console.log("                 INCOMPLETE — export will refuse this bundle:");
          for (const m of check.missing) console.log(`                   missing ${m}`);
          for (const i of check.invalid) console.log(`                   invalid ${i.path}: ${i.why}`);
        }
      } catch (err) {
        // A derivation that failed is reported and the run is kept. Writing a
        // partial identity would be worse than writing none: the export refuses
        // an absent file loudly and a plausible one quietly.
        log("error", "local", `identity could not be derived: ${(err as Error).message}`);
        log("error", "local", "the records are intact; export will refuse until an identity exists");
      }
    }
  }

  console.log("");
  if (has(args, "print-prompts")) {
    for (const p of result.prompts) {
      console.log(`--- ${p.fixtureId} [${p.split}] ---`);
      console.log(p.user.slice(0, 400) + (p.user.length > 400 ? "\n…" : ""));
      console.log("");
    }
  }
}

export async function exportQualificationCommand(args: string[]): Promise<void> {
  const suiteId = flag(args, "suite");
  const identityPath = flag(args, "identity");
  const recordsPath = flag(args, "records");
  if (!suiteId || !identityPath || !recordsPath) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const suite = loadLocalSuite(suiteId);
  if (!suite) {
    log("error", "local", `no local suite "${suiteId}"`);
    process.exitCode = 1;
    return;
  }

  const identity = JSON.parse(readFileSync(identityPath, "utf-8")) as LocalModelIdentity;
  const parsed = JSON.parse(readFileSync(recordsPath, "utf-8")) as {
    records: Parameters<typeof summarise>[1];
    scored: Parameters<typeof summarise>[0];
  };

  const result = exportBokahliBundle({
    taskClass: suite.lane === "repo_reconnaissance" ? "repo_reconnaissance" : "test_log_triage",
    taskClassContractVersion: "1.0.0",
    identity,
    records: parsed.records,
    scored: parsed.scored,
    luakBundleIds: parsed.records.map((r) => r.attemptId),
    luakBundleHashes: [],
    luakSignatureStatus: null,
    luakRepoCommit: process.env["LUAK_COMMIT"] ?? null,
    requireEvaluationSplit: !has(args, "allow-development-split"),
    now: new Date(),
  });

  if (!result.ok) {
    console.log(`\nExport refused — ${result.refusals.length} problem(s):\n`);
    for (const r of result.refusals) {
      console.log(`  ${r.code}${r.field ? `  (${r.field})` : ""}`);
      console.log(`    ${r.detail}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const out = flag(args, "out");
  const json = `${JSON.stringify(result.bundle, null, 2)}\n`;
  if (out) {
    writeFileSync(out, json);
    console.log(`\nWrote ${out}`);
  } else {
    console.log(json);
  }
  console.log(`  contentHash : ${result.bundle.contentHash}`);
  console.log(`  verdict     : ${result.bundle.verdict}`);
  console.log(`  attempts    : ${result.bundle.attempts.length}`);
  console.log("\n  This bundle carries no Bokahli import trust and cannot grant itself any.");
  console.log("  Authorising it is an operator action on the Bokahli side: pin its");
  console.log("  contentHash in the trust anchor there.\n");
}
