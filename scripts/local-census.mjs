#!/usr/bin/env node
/**
 * Local-qualification census.
 *
 * Answers one question: which parts of Luak's existing benchmark surface
 * actually measure something meaningful about a *local* model, and which
 * measure the harness, the provider, or nothing at all.
 *
 * The census is split in two on purpose:
 *
 *   - **Mechanical facts** are computed here, from the manifests, oracles,
 *     suites and adapters themselves — never from filenames or directory
 *     layout. Prompt text, scoring types, tool requirements, oracle checks and
 *     context sizes are all read out of the files.
 *   - **Judgements** ("does this apply to local models", "does it confound
 *     model quality with runtime failure") live in
 *     `docs/local/census-annotations.json`, authored by a human and versioned
 *     beside the code.
 *
 * The join is strict: a family present in `tasks/` with no annotation is an
 * error, and an annotation for a family that no longer exists is an error.
 * That way the census cannot quietly go stale as Luak grows — which is the
 * usual fate of a document like this.
 *
 * Emits `docs/local/CENSUS.json` (machine-readable) and `docs/local/CENSUS.md`
 * (human-readable). Run with --check to verify the committed artefacts are up
 * to date without rewriting them.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "local");
const ANNOTATIONS = join(OUT_DIR, "census-annotations.json");

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf-8"));
}

// ---------------------------------------------------------------------------
// mechanical facts, per task
// ---------------------------------------------------------------------------

/**
 * Classify what a task *needs from the execution environment*. This is the
 * single most important mechanical fact for local qualification: a task that
 * requires shell access and file mutation cannot be run against a chat-only
 * inference server, however capable the model is.
 */
function executionRequirements(manifest) {
  if (manifest.execution_mode === "conversational") {
    return {
      mode: "conversational",
      needsTools: false,
      needsShell: false,
      needsFileMutation: false,
      needsNetwork: false,
      needsImageInput: Boolean(manifest.metadata?.image_fixture || manifest.image_fixture),
      allowedTools: [],
    };
  }
  const c = manifest.constraints ?? {};
  const tools = c.allowed_tools ?? [];
  return {
    mode: "agentic_repo",
    needsTools: tools.length > 0,
    needsShell: tools.includes("shell"),
    needsFileMutation: tools.includes("write_file") || (c.max_file_edits ?? 0) > 0,
    needsNetwork: c.network_allowed === true,
    needsImageInput: false,
    allowedTools: tools,
  };
}

/**
 * Oracle determinism.
 *
 * "Deterministic" here means: the pass/fail decision is computed by code or by
 * running a command, with no model in the loop. Luak's conversational judge is
 * entirely deterministic — every scoring_type resolves to string, regex or
 * numeric comparison — and repo oracles run shell checks. Nothing in the
 * current tree calls a model to judge, which is worth stating plainly because
 * a model-judged benchmark cannot qualify a model without circularity.
 */
const DETERMINISTIC_SCORING_TYPES = new Set([
  "text_match", "text_match_all", "regex_match", "refusal_check", "refusal_quality",
  "recall", "correction", "proactive", "hedge_count", "corporate_check",
  "numeric_fact_match", "uncertainty_honesty", "absence_honesty",
  "roleplay_character_consistency", "roleplay_continuity_fact_match",
]);

/**
 * Resolve an oracle the way `core/oracle.ts:resolveOraclePath` does.
 *
 * The literal `oracle_ref.path` in repo manifests is `../../oracles/<id>...`,
 * which only lands on the right file because Luak resolves it from the repo
 * root rather than from the manifest's own directory — relative to the manifest
 * it would point at `tasks/oracles/`. Reimplementing that resolution here by
 * eye produced 25 false "hash mismatch" findings on the first run; mirroring the
 * real candidate order is the only way this census can be trusted to agree with
 * the code it is describing.
 */
function resolveOracle(manifest) {
  const refPath = manifest.oracle_ref?.path;
  const oraclesDir = join(ROOT, "oracles");
  const candidates = [
    refPath ? resolve(ROOT, refPath) : "",
    refPath ? join(oraclesDir, refPath.split("/").pop()) : "",
    join(oraclesDir, `${manifest.id}.oracle.json`),
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c)) ?? null;
}

function oracleFacts(manifest) {
  if (manifest.execution_mode === "conversational") {
    const types = [...new Set((manifest.questions ?? []).map((q) => q.scoring_type))];
    const unknown = types.filter((t) => t !== "custom" && !DETERMINISTIC_SCORING_TYPES.has(t));
    return {
      kind: unknown.length > 0 ? "hybrid_or_unknown" : "deterministic",
      scoringTypes: types.sort(),
      unknownScoringTypes: unknown,
      oraclePath: null,
      oracleHash: null,
      oracleHashPinned: null,
      checkCounts: null,
    };
  }
  const ref = manifest.oracle_ref ?? {};
  const oraclePath = resolveOracle(manifest);
  let checkCounts = null;
  let actualHash = null;
  if (oraclePath && existsSync(oraclePath)) {
    const raw = readFileSync(oraclePath, "utf-8");
    actualHash = sha256(raw);
    const o = JSON.parse(raw);
    checkCounts = {
      correctness: (o.checks?.correctness ?? []).length,
      regression: (o.checks?.regression ?? []).length,
      integrity: (o.checks?.integrity ?? []).length,
      decoys: (o.checks?.decoys ?? []).length,
    };
  }
  return {
    kind: "deterministic",
    scoringTypes: [],
    unknownScoringTypes: [],
    oraclePath: oraclePath ? relative(ROOT, oraclePath) : null,
    oracleHash: actualHash,
    oracleHashPinned: ref.hash ?? null,
    oracleHashMatches:
      ref.hash === "sha256:placeholder"
        ? "placeholder"
        : actualHash === null
          ? "oracle_not_found"
          : ref.hash === actualHash,
    checkCounts,
  };
}

/**
 * Prompt and output sizes, measured rather than declared.
 *
 * Local models are context-bound in a way hosted models are not, so the real
 * question — how much text does this task actually push through the window —
 * has to be measured from the prompt strings themselves. Characters are
 * reported rather than tokens because tokenisation is model-specific and any
 * token count here would be a guess dressed as a measurement.
 */
function sizeFacts(manifest) {
  if (manifest.execution_mode === "conversational") {
    const qs = manifest.questions ?? [];
    const promptChars = qs.map((q) => (q.question ?? "").length);
    const sysChars = (manifest.system_prompt ?? "").length;
    const maxLengths = qs.map((q) => q.maxLength).filter((n) => typeof n === "number");
    return {
      questionCount: qs.length,
      systemPromptChars: sysChars,
      maxPromptChars: promptChars.length ? Math.max(...promptChars) : 0,
      totalPromptChars: promptChars.reduce((a, b) => a + b, 0) + sysChars,
      declaredMaxOutputChars: maxLengths.length ? Math.max(...maxLengths) : null,
      unboundedOutputQuestions: qs.length - maxLengths.length,
    };
  }
  const c = manifest.constraints ?? {};
  return {
    questionCount: null,
    systemPromptChars: (manifest.task?.description ?? "").length,
    maxPromptChars: (manifest.task?.description ?? "").length,
    totalPromptChars: (manifest.task?.description ?? "").length,
    declaredMaxOutputChars: null,
    unboundedOutputQuestions: null,
    stepBudget: c.max_steps ?? null,
    timeLimitSec: c.time_limit_sec ?? null,
    maxFilesRead: c.max_files_read ?? null,
  };
}

/**
 * Memorisation and leakage exposure.
 *
 * A fixture whose answer is a well-known string, or whose prompt is short and
 * distinctive, is a fixture a model may have seen. This flags the mechanically
 * detectable cases: public repository content, short exact-match answers, and
 * fixtures whose ground truth is embedded in the prompt.
 */
function leakageFacts(manifest) {
  const provenance = manifest.metadata?.benchmark_provenance ?? {};
  const shortExactAnswers = (manifest.questions ?? []).filter(
    (q) => (q.scoring_type === "text_match" || q.scoring_type === "regex_match") &&
      typeof q.maxLength === "number" && q.maxLength <= 40,
  ).length;
  return {
    publicStatus: provenance.public_status ?? null,
    oracleVisibility: provenance.oracle_visibility ?? null,
    goldSolutionVisibility: provenance.gold_solution_visibility ?? null,
    declaredContaminationRisk: provenance.contamination_risk ?? null,
    knownScoringLimitations: provenance.known_scoring_limitations ?? [],
    shortExactAnswerQuestions: shortExactAnswers,
  };
}

function censusTask(manifestPath) {
  const manifest = readJson(manifestPath);
  const raw = readFileSync(manifestPath, "utf-8");
  return {
    id: manifest.id,
    family: manifest.family,
    version: manifest.version ?? null,
    difficulty: manifest.difficulty ?? null,
    manifestPath: relative(ROOT, manifestPath),
    manifestHash: sha256(raw),
    description: manifest.description ?? manifest.task?.title ?? null,
    execution: executionRequirements(manifest),
    oracle: oracleFacts(manifest),
    sizes: sizeFacts(manifest),
    leakage: leakageFacts(manifest),
    tags: [...new Set((manifest.questions ?? []).flatMap((q) => q.tags ?? []))].sort(),
  };
}

// ---------------------------------------------------------------------------
// adapters, suites, scorers
// ---------------------------------------------------------------------------

function censusAdapters() {
  const out = [];
  for (const f of readdirSync(join(ROOT, "adapters"))) {
    if (!f.endsWith(".ts") || f === "base.ts" || f === "registry.ts") continue;
    const src = readFileSync(join(ROOT, "adapters", f), "utf-8");
    const idMatch = src.match(/^\s*id\s*=\s*["']([^"']+)["']/m);
    out.push({
      file: `adapters/${f}`,
      id: idMatch ? idMatch[1] : f.replace(/\.ts$/, ""),
      declaresChat: /supportsChat\(\)\s*:\s*boolean\s*\{\s*return\s+true/.test(src),
      declaresToolCalls: /supportsToolCalls\(\)\s*:\s*boolean\s*\{\s*return\s+true/.test(src),
      // A local inference server reached over HTTP, versus a hosted API or a
      // wrapped coding agent. Only the first kind is a local-qualification
      // target; the rest measure somebody else's infrastructure too.
      localTransport: /localhost|127\.0\.0\.1|OLLAMA_URL|LLAMA|base_url/i.test(src),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function censusSuites() {
  const dir = join(ROOT, "suites");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = readFileSync(join(dir, f), "utf-8");
      const s = JSON.parse(raw);
      return {
        file: `suites/${f}`,
        id: s.id,
        hash: sha256(raw),
        // A suite id with no version field cannot bind evidence to a fixture
        // set: adding a fixture changes the bar without changing the id.
        hasVersionField: Object.prototype.hasOwnProperty.call(s, "version"),
        passThreshold: s.scoring?.pass_threshold ?? null,
        weights: s.scoring?.weights ?? null,
        flakeRetries: s.flake_detection?.retries ?? null,
        families: s.families,
        tasks: s.tasks,
      };
    });
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

function build() {
  const manifests = walk(join(ROOT, "tasks")).filter((p) => p.endsWith("manifest.json"));
  const tasks = manifests.map(censusTask).sort((a, b) => a.id.localeCompare(b.id));

  const families = {};
  for (const t of tasks) {
    const f = (families[t.family] ??= {
      family: t.family,
      taskCount: 0,
      modes: new Set(),
      scoringTypes: new Set(),
      needsShell: false,
      needsFileMutation: false,
      needsImageInput: false,
      maxPromptChars: 0,
      totalQuestions: 0,
    });
    f.taskCount += 1;
    f.modes.add(t.execution.mode);
    for (const s of t.oracle.scoringTypes) f.scoringTypes.add(s);
    f.needsShell ||= t.execution.needsShell;
    f.needsFileMutation ||= t.execution.needsFileMutation;
    f.needsImageInput ||= t.execution.needsImageInput;
    f.maxPromptChars = Math.max(f.maxPromptChars, t.sizes.maxPromptChars);
    f.totalQuestions += t.sizes.questionCount ?? 0;
  }
  for (const f of Object.values(families)) {
    f.modes = [...f.modes].sort();
    f.scoringTypes = [...f.scoringTypes].sort();
  }

  const annotations = readJson(ANNOTATIONS);
  const annotated = new Set(Object.keys(annotations.families));
  const present = new Set(Object.keys(families));
  const missing = [...present].filter((f) => !annotated.has(f)).sort();
  const stale = [...annotated].filter((f) => !present.has(f)).sort();

  return {
    census: {
      censusVersion: annotations.censusVersion,
      generatedFrom: {
        taskCount: tasks.length,
        familyCount: Object.keys(families).length,
        questionCount: tasks.reduce((a, t) => a + (t.sizes.questionCount ?? 0), 0),
      },
      families: Object.fromEntries(
        Object.entries(families).map(([k, v]) => [k, { ...v, annotation: annotations.families[k] ?? null }]),
      ),
      tasks,
      adapters: censusAdapters(),
      suites: censusSuites(),
    },
    missing,
    stale,
  };
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

function renderMarkdown(c) {
  const L = [];
  L.push("# Local-qualification census of the existing Luak benchmark surface");
  L.push("");
  L.push("**Generated by `scripts/local-census.mjs`. Do not edit by hand.**");
  L.push("Mechanical facts are read from the manifests, oracles, suites and adapters");
  L.push("themselves. The `applies to local` / `confounds` columns are authored judgements");
  L.push("from `docs/local/census-annotations.json`, and the generator fails if a family");
  L.push("has no annotation — so this file cannot go stale as Luak grows.");
  L.push("");
  L.push(`Census version ${c.censusVersion} · ${c.generatedFrom.taskCount} tasks · ` +
    `${c.generatedFrom.familyCount} families · ${c.generatedFrom.questionCount} conversational questions`);
  L.push("");
  L.push("## Families");
  L.push("");
  L.push("| Family | Tasks | Mode | Deterministic | Needs shell | Needs mutation | Needs image | Applies to local | Disposition |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const [name, f] of Object.entries(c.families).sort()) {
    const a = f.annotation ?? {};
    L.push(`| \`${name}\` | ${f.taskCount} | ${f.modes.join(", ")} | ` +
      `${f.scoringTypes.length ? "yes" : "yes (oracle)"} | ${f.needsShell ? "**yes**" : "no"} | ` +
      `${f.needsFileMutation ? "**yes**" : "no"} | ${f.needsImageInput ? "**yes**" : "no"} | ` +
      `${a.appliesToLocal ?? "?"} | ${a.disposition ?? "?"} |`);
  }
  L.push("");
  L.push("## What each family actually measures, and why it is or is not usable locally");
  L.push("");
  for (const [name, f] of Object.entries(c.families).sort()) {
    const a = f.annotation;
    if (!a) continue;
    L.push(`### \`${name}\` — ${a.disposition}`);
    L.push("");
    L.push(`- **Measures:** ${a.measures}`);
    L.push(`- **Oracle:** ${a.oracleKind}`);
    L.push(`- **Applies to local models:** ${a.appliesToLocal}`);
    L.push(`- **Confounds model quality with infrastructure:** ${a.confounds}`);
    L.push(`- **Dimension:** ${a.dimension}`);
    L.push(`- **Memorisation exposure:** ${a.memorisationExposure}`);
    L.push(`- **Context:** max prompt ${f.maxPromptChars} chars` +
      (f.totalQuestions ? `, ${f.totalQuestions} questions` : ""));
    if (a.note) L.push(`- **Note:** ${a.note}`);
    L.push("");
  }
  L.push("## Adapters");
  L.push("");
  L.push("| Adapter | chat | tool calls | local transport |");
  L.push("|---|---|---|---|");
  for (const ad of c.adapters) {
    L.push(`| \`${ad.id}\` | ${ad.declaresChat ? "yes" : "no"} | ` +
      `${ad.declaresToolCalls ? "yes" : "no"} | ${ad.localTransport ? "yes" : "no"} |`);
  }
  L.push("");
  L.push("## Suites");
  L.push("");
  for (const s of c.suites) {
    L.push(`- \`${s.id}\` (${s.file}) — pass threshold ${s.passThreshold}, ` +
      `flake retries ${s.flakeRetries}, version field: ${s.hasVersionField ? "yes" : "**absent**"}`);
  }
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------------------

const check = process.argv.includes("--check");
const { census, missing, stale } = build();

if (missing.length > 0) {
  console.error(`Census annotation missing for families: ${missing.join(", ")}`);
  console.error("Add them to docs/local/census-annotations.json. A family with no");
  console.error("annotation has not been assessed for local qualification.");
  process.exit(1);
}
if (stale.length > 0) {
  console.error(`Census annotations reference families that no longer exist: ${stale.join(", ")}`);
  process.exit(1);
}

const json = `${JSON.stringify(census, null, 2)}\n`;
const md = `${renderMarkdown(census)}`;
const jsonPath = join(OUT_DIR, "CENSUS.json");
const mdPath = join(OUT_DIR, "CENSUS.md");

if (check) {
  let ok = true;
  for (const [p, want] of [[jsonPath, json], [mdPath, md]]) {
    const have = existsSync(p) ? readFileSync(p, "utf-8") : "";
    if (have !== want) {
      console.error(`Out of date: ${relative(ROOT, p)} — re-run scripts/local-census.mjs`);
      ok = false;
    }
  }
  process.exit(ok ? 0 : 1);
}

writeFileSync(jsonPath, json);
writeFileSync(mdPath, md);
console.log(`Census written: ${census.generatedFrom.taskCount} tasks, ` +
  `${census.generatedFrom.familyCount} families, ` +
  `${census.generatedFrom.questionCount} questions`);
void statSync;
