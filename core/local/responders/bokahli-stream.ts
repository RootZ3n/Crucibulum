/**
 * Luak — Bokahli SSE stream reader.
 *
 * Bokahli's native streaming protocol, read exactly as the chat UI reads it:
 *
 *   event: bokahli.identity   { requestId, route, servedIdentity }
 *   event: bokahli.delta      { text }
 *   event: bokahli.done       { requestId, outcome, result|route, telemetry,
 *                               partialTextDiscarded? }
 *
 * The load-bearing rule is at the bottom: **text that arrived before a
 * non-ROUTED terminal event is never a completion.** Bokahli itself discards
 * partial output when the runtime dies mid-generation and says so with
 * `partialTextDiscarded`. A client that scored those deltas anyway would be
 * grading a fragment the server already disowned — the exact "plausible model
 * output" failure the whole contract exists to prevent.
 *
 * A stream that ends without a terminal event is likewise not a completion. It
 * is `missing_terminal_event`, attributed to the harness, and whatever text
 * arrived is discarded.
 */
import type { TransportEvent } from "./bokahli-failure-map.js";

export interface StreamEvent {
  readonly event: string;
  readonly data: unknown;
}

export interface StreamOutcome {
  /** Deltas concatenated. Empty unless `terminal` is a ROUTED done event. */
  readonly text: string;
  /** Text seen before a non-ROUTED terminal, kept only for diagnostics. */
  readonly discardedText: string;
  readonly identity: Record<string, unknown> | null;
  readonly terminal: Record<string, unknown> | null;
  readonly transportEvent: TransportEvent | null;
  readonly deltaCount: number;
}

/**
 * Parse one SSE frame.
 *
 * Three outcomes, not two. `"skip"` is a frame with nothing to read — a
 * keepalive comment or a stray blank — which is legitimate and must be ignored.
 * `null` is a frame that *carried data this client could not parse*, which must
 * stop the stream, because it may have been the terminal event.
 *
 * Collapsing the two was a real bug: a `: keepalive` comment, which Bokahli and
 * every intermediary are entitled to send, aborted the stream as malformed.
 */
export function parseFrame(frame: string): StreamEvent | "skip" | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    else if (line.startsWith(":")) continue; // comment/keepalive
  }
  if (dataLines.length === 0) return "skip";
  const raw = dataLines.join("\n");
  if (raw === "[DONE]") return { event: "openai.done", data: null };
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return null;
  }
}

export interface ReadStreamOptions {
  readonly firstTokenTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly now?: () => number;
}

/**
 * Consume a Bokahli SSE body.
 *
 * Timeouts are split because the two failures have different causes and
 * different operator responses: no first token means prompt processing did not
 * finish, while a stall afterwards is a decode problem. Collapsing them would
 * make a context-size problem look like a throughput problem.
 */
export async function readBokahliStream(
  body: ReadableStream<Uint8Array>,
  opts: ReadStreamOptions,
): Promise<StreamOutcome> {
  const clock = opts.now ?? (() => Date.now());
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let text = "";
  let identity: Record<string, unknown> | null = null;
  let terminal: Record<string, unknown> | null = null;
  let deltaCount = 0;
  let transportEvent: TransportEvent | null = null;
  const started = clock();
  let firstTokenAt: number | null = null;

  const finish = (): StreamOutcome => {
    // A terminal event that is not a successful route means the text is not an
    // answer. Bokahli discarded it server-side; this discards it client-side so
    // no scorer can ever see it.
    const routed = terminal?.["outcome"] === "ROUTED";
    return {
      text: routed ? text : "",
      discardedText: routed ? "" : text,
      identity,
      terminal,
      transportEvent,
      deltaCount,
    };
  };

  try {
    for (;;) {
      const elapsed = clock() - started;
      if (firstTokenAt === null && elapsed > opts.firstTokenTimeoutMs) {
        transportEvent = "timeout_before_first_token";
        return finish();
      }
      if (elapsed > opts.totalTimeoutMs) {
        transportEvent = "timeout_during_generation";
        return finish();
      }

      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (frame.trim().length === 0) continue;

        const parsed = parseFrame(frame);
        if (parsed === "skip") continue;
        if (!parsed) {
          // Refused rather than skipped: a frame this client cannot read may
          // have carried the terminal event, and quietly continuing would turn
          // a protocol mismatch into a silent truncation.
          transportEvent = "malformed_event";
          return finish();
        }

        if (parsed.event === "bokahli.identity") {
          identity = parsed.data as Record<string, unknown>;
        } else if (parsed.event === "bokahli.delta") {
          const t = (parsed.data as { text?: unknown })?.text;
          if (typeof t === "string") {
            if (firstTokenAt === null) firstTokenAt = clock();
            text += t;
            deltaCount += 1;
          }
        } else if (parsed.event === "bokahli.done") {
          if (terminal !== null) {
            // The protocol allows exactly one. A second must not overwrite the
            // first, or a stream could be made to end however it liked.
            transportEvent = "duplicate_terminal_event";
            return finish();
          }
          terminal = parsed.data as Record<string, unknown>;
        }
      }
    }
  } catch (err) {
    void err;
    transportEvent = "unexpected_close";
    return finish();
  } finally {
    reader.releaseLock?.();
  }

  if (terminal === null) {
    transportEvent = "missing_terminal_event";
  }
  return finish();
}
