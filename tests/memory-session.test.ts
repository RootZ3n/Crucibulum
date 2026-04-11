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
    const transcript = messages.map((message) => message.content.toLowerCase()).join("\n");
    let text = "I don't know.";

    if (lastUser.includes("What tea did I tell you to remember?")) {
      text = transcript.includes("favorite tea is lapsang") ? "You said lapsang." : "I don't know.";
    } else if (lastUser.includes("What library code did I ask you to remember?")) {
      text = transcript.includes("library code is lark-742") ? "The code was LARK-742." : "I don't know.";
    } else if (lastUser.includes("Earlier in this benchmark, what tea")) {
      text = transcript.includes("favorite tea is lapsang") ? "Earlier you said lapsang." : "I don't know.";
    } else if (lastUser.includes("Earlier in this benchmark, what library code")) {
      text = transcript.includes("library code is lark-742") ? "Earlier you said LARK-742." : "I don't know.";
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
    rmSync("state/memory-sessions/memory-demo-001.json", { force: true });

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
    assert.ok(loadPersistedConversation("memory-demo-001").length > 0);
  });
});
