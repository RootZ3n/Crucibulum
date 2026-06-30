import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

interface SceneAction {
  id: string;
  label: string;
  run: (api: unknown) => Promise<unknown>;
}

interface Scene {
  id: string;
  title: string;
  purpose: string;
  greeting: string;
  blurb: string;
  actions: SceneAction[];
}

interface LuakScenesRegistry {
  all: Scene[];
  get: (id: string) => Scene | null;
  match: (text: string) => string | null;
}

function loadPehSceneRegistry(): LuakScenesRegistry {
  const source = readFileSync(join(process.cwd(), "ui", "scenes.js"), "utf-8");
  const sandbox = { window: {} as { LuakScenes?: LuakScenesRegistry }, Promise };
  vm.runInNewContext(source, sandbox, { filename: "ui/scenes.js" });
  assert.ok(sandbox.window.LuakScenes, "ui/scenes.js must register window.LuakScenes");
  return sandbox.window.LuakScenes;
}

describe("Peh scene and tool registration", () => {
  it("registers every expected Peh scene in the real registry", () => {
    const registry = loadPehSceneRegistry();
    const ids = Array.from(registry.all, (scene) => scene.id);

    assert.deepEqual(ids, [
      "speedway",
      "racetrack",
      "results-table",
      "grandstand",
      "timing-tower",
      "pit-lane",
      "victory-circle",
      "workshop",
    ]);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("returns the expected registered scene and action shape", () => {
    const registry = loadPehSceneRegistry();
    const workshop = registry.get("workshop");

    assert.ok(workshop);
    assert.equal(workshop.id, "workshop");
    assert.equal(workshop.title, "The Workshop");
    assert.equal(typeof workshop.purpose, "string");
    assert.equal(typeof workshop.greeting, "string");
    assert.equal(typeof workshop.blurb, "string");
    assert.deepEqual(Array.from(workshop.actions, (action) => action.id), ["scorers", "fleet"]);
    for (const action of workshop.actions) {
      assert.equal(typeof action.label, "string");
      assert.equal(typeof action.run, "function");
    }
  });

  it("registers the expected Peh tool actions against production scenes", () => {
    const registry = loadPehSceneRegistry();
    const actionIds = new Map(Array.from(registry.all, (scene) => [
      scene.id,
      Array.from(scene.actions, (action) => action.id),
    ]));

    assert.deepEqual(actionIds.get("speedway"), ["pulse"]);
    assert.deepEqual(actionIds.get("racetrack"), ["runs", "tasks"]);
    assert.deepEqual(actionIds.get("results-table"), ["open-table"]);
    assert.deepEqual(actionIds.get("grandstand"), ["board", "recent"]);
    assert.deepEqual(actionIds.get("timing-tower"), ["stats"]);
    assert.deepEqual(actionIds.get("pit-lane"), ["providers", "models"]);
    assert.deepEqual(actionIds.get("victory-circle"), ["wins"]);
    assert.deepEqual(actionIds.get("workshop"), ["scorers", "fleet"]);
  });

  it("handles unknown scenes and unmatched commands gracefully", () => {
    const registry = loadPehSceneRegistry();

    assert.equal(registry.get("missing-scene"), null);
    assert.equal(registry.match("nonsense that maps nowhere"), null);
    assert.equal(registry.match("show me adapter health"), "workshop");
    assert.equal(registry.match("open the leaderboard"), "grandstand");
  });
});
