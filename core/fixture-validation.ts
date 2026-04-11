import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const TASKS_DIR = join(process.cwd(), "tasks");
const ORACLES_DIR = join(process.cwd(), "oracles");

export interface FixtureValidationIssue {
  scope: "manifest" | "oracle" | "corpus";
  id: string;
  message: string;
}

interface ValidationResult {
  issues: FixtureValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string" && value[key] !== "";
}

function hasFiniteNumber(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "number" && Number.isFinite(value[key]);
}

function issuesFor(pathId: string, scope: FixtureValidationIssue["scope"]): ValidationResult {
  return { issues: [] as FixtureValidationIssue[] };
}

function pushIssue(result: ValidationResult, scope: FixtureValidationIssue["scope"], id: string, message: string): void {
  result.issues.push({ scope, id, message });
}

function listFamilyDirs(): string[] {
  return readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listManifestPaths(): string[] {
  const manifestPaths: string[] = [];
  for (const family of listFamilyDirs()) {
    const familyDir = join(TASKS_DIR, family);
    for (const taskDir of readdirSync(familyDir, { withFileTypes: true })) {
      if (!taskDir.isDirectory()) continue;
      manifestPaths.push(join(familyDir, taskDir.name, "manifest.json"));
    }
  }
  return manifestPaths.sort();
}

export function listOraclePaths(): string[] {
  return readdirSync(ORACLES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".oracle.json"))
    .map((entry) => join(ORACLES_DIR, entry.name))
    .sort();
}

export function validateRepoManifest(manifest: unknown, pathId = "manifest"): FixtureValidationIssue[] {
  const result = issuesFor(pathId, "manifest");
  if (!isRecord(manifest)) {
    pushIssue(result, "manifest", pathId, "manifest must be an object");
    return result.issues;
  }

  const requiredStrings = ["id", "version", "family", "difficulty", "seed"];
  for (const key of requiredStrings) {
    if (key === "seed") {
      if (!hasFiniteNumber(manifest, key)) {
        pushIssue(result, "manifest", pathId, `missing numeric ${key}`);
      }
      continue;
    }
    if (!hasString(manifest, key)) {
      pushIssue(result, "manifest", pathId, `missing string ${key}`);
    }
  }

  if (!isRecord(manifest["repo"])) {
    pushIssue(result, "manifest", pathId, "missing repo object");
  }
  if (!isRecord(manifest["task"])) {
    pushIssue(result, "manifest", pathId, "missing task object");
  }
  if (!isRecord(manifest["constraints"])) {
    pushIssue(result, "manifest", pathId, "missing constraints object");
  }
  if (!isRecord(manifest["verification"])) {
    pushIssue(result, "manifest", pathId, "missing verification object");
  }
  if (!isRecord(manifest["scoring"])) {
    pushIssue(result, "manifest", pathId, "missing scoring object");
  }
  if (!isRecord(manifest["oracle_ref"])) {
    pushIssue(result, "manifest", pathId, "missing oracle_ref object");
  }
  if (!isRecord(manifest["metadata"])) {
    pushIssue(result, "manifest", pathId, "missing metadata object");
  }

  const scoring = manifest["scoring"];
  if (isRecord(scoring) && isRecord(scoring["weights"])) {
    const weights = scoring["weights"] as Record<string, unknown>;
    const keys = ["correctness", "regression", "integrity", "efficiency"];
    const total = keys.reduce((sum, key) => sum + (typeof weights[key] === "number" ? weights[key] as number : 0), 0);
    for (const key of keys) {
      if (typeof weights[key] !== "number") {
        pushIssue(result, "manifest", pathId, `missing scoring weight ${key}`);
      }
    }
    if (Math.abs(total - 1) > 0.0001) {
      pushIssue(result, "manifest", pathId, `scoring weights must sum to 1, got ${total}`);
    }
    if (typeof scoring["pass_threshold"] !== "number" || scoring["pass_threshold"] < 0 || scoring["pass_threshold"] > 1) {
      pushIssue(result, "manifest", pathId, "pass_threshold must be between 0 and 1");
    }
  }

  return result.issues;
}

export function validateConversationalManifest(manifest: unknown, pathId = "manifest"): FixtureValidationIssue[] {
  const result = issuesFor(pathId, "manifest");
  if (!isRecord(manifest)) {
    pushIssue(result, "manifest", pathId, "manifest must be an object");
    return result.issues;
  }

  for (const key of ["id", "version", "family", "difficulty", "description"]) {
    if (!hasString(manifest, key)) {
      pushIssue(result, "manifest", pathId, `missing string ${key}`);
    }
  }

  if (manifest["execution_mode"] !== "conversational") {
    pushIssue(result, "manifest", pathId, "execution_mode must be conversational");
  }

  if (!Array.isArray(manifest["questions"]) || manifest["questions"].length === 0) {
    pushIssue(result, "manifest", pathId, "questions must be a non-empty array");
  } else {
    for (const [index, question] of manifest["questions"].entries()) {
      if (!isRecord(question)) {
        pushIssue(result, "manifest", pathId, `question ${index} must be an object`);
        continue;
      }
      for (const key of ["id", "question", "scoring_type"]) {
        if (!hasString(question, key)) {
          pushIssue(result, "manifest", pathId, `question ${index} missing string ${key}`);
        }
      }
      if (typeof question["weight"] !== "number" || question["weight"] <= 0) {
        pushIssue(result, "manifest", pathId, `question ${index} weight must be > 0`);
      }
      if (!Array.isArray(question["tags"])) {
        pushIssue(result, "manifest", pathId, `question ${index} tags must be an array`);
      }
    }
  }

  const scoring = manifest["scoring"];
  if (!isRecord(scoring) || typeof scoring["pass_threshold"] !== "number" || scoring["pass_threshold"] < 0 || scoring["pass_threshold"] > 1) {
    pushIssue(result, "manifest", pathId, "pass_threshold must be between 0 and 1");
  }

  if (!isRecord(manifest["metadata"])) {
    pushIssue(result, "manifest", pathId, "missing metadata object");
  }

  return result.issues;
}

export function validateOracle(oracle: unknown, pathId = "oracle"): FixtureValidationIssue[] {
  const result = issuesFor(pathId, "oracle");
  if (!isRecord(oracle)) {
    pushIssue(result, "oracle", pathId, "oracle must be an object");
    return result.issues;
  }

  for (const key of ["task_id", "version", "hash"]) {
    if (!hasString(oracle, key)) {
      pushIssue(result, "oracle", pathId, `missing string ${key}`);
    }
  }

  if (!isRecord(oracle["ground_truth"])) {
    pushIssue(result, "oracle", pathId, "missing ground_truth object");
  }

  const checks = oracle["checks"];
  if (!isRecord(checks)) {
    pushIssue(result, "oracle", pathId, "missing checks object");
  } else {
    for (const key of ["correctness", "regression", "integrity", "decoys"]) {
      if (!Array.isArray(checks[key])) {
        pushIssue(result, "oracle", pathId, `checks.${key} must be an array`);
      }
    }
    if (!isRecord(checks["anti_cheat"])) {
      pushIssue(result, "oracle", pathId, "checks.anti_cheat must be an object");
    }
  }

  return result.issues;
}

export function validateFixtureCorpus(): FixtureValidationIssue[] {
  const issues: FixtureValidationIssue[] = [];
  const repoTaskIds = new Set<string>();
  const seenTaskIds = new Set<string>();
  const oracleTaskIds = new Set<string>();

  for (const manifestPath of listManifestPaths()) {
    const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    const taskId = typeof raw["id"] === "string" ? raw["id"] : manifestPath;

    if (seenTaskIds.has(taskId)) {
      issues.push({ scope: "corpus", id: taskId, message: "duplicate task id" });
    }
    seenTaskIds.add(taskId);

    if (basename(join(manifestPath, "..")) !== taskId) {
      issues.push({ scope: "corpus", id: taskId, message: `task directory name must match id (${manifestPath})` });
    }

    if (raw["execution_mode"] === "conversational") {
      issues.push(...validateConversationalManifest(raw, manifestPath));
      continue;
    }

    issues.push(...validateRepoManifest(raw, manifestPath));
    repoTaskIds.add(taskId);

    const oracleRef = raw["oracle_ref"];
    if (!isRecord(oracleRef) || !hasString(oracleRef, "path")) {
      issues.push({ scope: "corpus", id: taskId, message: "repo task missing oracle_ref.path" });
      continue;
    }
    const expectedOracleName = `${taskId}.oracle.json`;
    if (!String(oracleRef["path"]).endsWith(expectedOracleName)) {
      issues.push({ scope: "corpus", id: taskId, message: `oracle_ref.path must end with ${expectedOracleName}` });
    }
  }

  for (const oraclePath of listOraclePaths()) {
    const raw = JSON.parse(readFileSync(oraclePath, "utf-8")) as Record<string, unknown>;
    issues.push(...validateOracle(raw, oraclePath));
    const taskId = typeof raw["task_id"] === "string" ? raw["task_id"] : oraclePath;
    oracleTaskIds.add(taskId);
    if (!repoTaskIds.has(taskId)) {
      issues.push({ scope: "corpus", id: taskId, message: `orphan oracle: ${oraclePath}` });
    }
    const expectedName = `${taskId}.oracle.json`;
    if (basename(oraclePath) !== expectedName) {
      issues.push({ scope: "corpus", id: taskId, message: `oracle filename must be ${expectedName}` });
    }
  }

  for (const taskId of repoTaskIds) {
    if (!oracleTaskIds.has(taskId)) {
      issues.push({ scope: "corpus", id: taskId, message: "repo task missing oracle file" });
    }
  }

  return issues;
}
