import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import type { AdapterConfig, ChatMessage, ChatResult, CrucibulumAdapter, ExecutionInput, ExecutionResult, TimelineEvent } from "../adapters/base.js";
import { loadPersistedConversation, persistConversation, runConversationalTask } from "../core/conversational-runner.js";

class MemoryMockAdapter implements CrucibulumAdapter {
  id = "memory-mock";
  name = "Memory Mock";
  version = "1.0.0";

  supports(): boolean { return true; }
  supportsChat(): boolean { return true; }
  supportsToolCalls(): boolean { return false; }
  async init(_config: AdapterConfig): Promise<void> {}
  async healthCheck(): Promise<{ ok: boolean; reason?: string | undefined }> { return { ok: true }; }
  async teardown(): Promise<void> {}
  async execute(_input: ExecutionInput): Promise<ExecutionResult> {
    throw new Error("not used");
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const lastUserNorm = lastUser.toLowerCase();
    const transcript = messages.map((message) => message.content.toLowerCase()).join("\n");
    let text = "I don't know.";

    if (lastUserNorm.includes("what was it")) {
      text = transcript.includes("ember-owl") ? "ember-owl" : "I don't know.";
    } else if (lastUserNorm.includes("what meeting room did i tell you")) {
      text = transcript.includes("cobalt-9") ? "Cobalt-9" : "I don't know.";
    } else if (lastUserNorm.includes("what city did i say i was born in")) {
      text = "I don't know.";
    } else if (lastUserNorm.includes("what was the name of my dog")) {
      text = "I don't know.";
    } else {
      text = "Stored.";
    }

    return {
      text,
      tokens_in: 20,
      tokens_out: 10,
      duration_ms: 5,
    };
  }
}

describe("memory session persistence", () => {
  it("persists and reloads conversation transcripts across conversational runs", async () => {
    rmSync("state/memory-sessions/memory-cross-turn-001.json", { force: true });
    rmSync("state/memory-sessions/memory-uncertainty-001.json", { force: true });

    persistConversation("memory-roundtrip-test", [{ role: "user", content: "remember this" }]);
    assert.deepEqual(loadPersistedConversation("memory-roundtrip-test"), [{ role: "user", content: "remember this" }]);

    const adapter = new MemoryMockAdapter();
    const firstRun = await runConversationalTask({
      taskId: "memory-001",
      adapter,
      model: "memory-mock-model",
    });
    assert.equal(firstRun.passed, true);

    const secondRun = await runConversationalTask({
      taskId: "memory-002",
      adapter,
      model: "memory-mock-model",
    });
    assert.equal(secondRun.passed, true);
    assert.ok(loadPersistedConversation("memory-cross-turn-001").length > 0);
  });
});
