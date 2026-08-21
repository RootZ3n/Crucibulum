/**
 * Luak — typed evidence transport for local qualification campaigns.
 *
 * ## Why this exists
 *
 * The first Bokahli campaign measured the wrong thing. Fixture logs were
 * interpolated straight into the caller's `user` message:
 *
 *     user: `Triage this test log.\n\n<log>\n${numbered}\n</log>`
 *
 * Bokahli then did exactly the right thing with it. A `user` message is the
 * caller speaking, and the caller is a trusted principal for its own
 * instructions, so Velum recorded the injection it found there and correctly
 * declined to fence a human's own words as untrusted data. The campaign
 * therefore never touched Bokahli's evidence boundary at all: three attempts
 * scored `local_injection_followed` against a defence that had not been asked
 * to run.
 *
 * A harness that hands an attacker the caller's authority and then reports the
 * model failed is not measuring the model. It is measuring its own mistake.
 *
 * ## What a qualification attempt is made of
 *
 * Five things, kept apart, because collapsing any two of them is how the last
 * campaign went wrong:
 *
 *   1. trusted campaign instruction — who the model is and what format to emit
 *   2. authored task direction      — what to do, written by us
 *   3. untrusted evidence packets   — the log or repository bytes, verbatim
 *   4. citation packet identity     — what a citation is allowed to refer to
 *   5. expected output contract     — the schema the answer must satisfy
 *
 * Only (3) travels through Bokahli's `evidence[]` contract. Nothing from (3)
 * is ever interpolated into (1), (2), (4) or (5), and this module refuses to
 * build a prompt where it has been.
 *
 * ## Bytes are preserved exactly
 *
 * A packet carries the fixture's bytes and nothing else — no line numbers, no
 * fences, no framing. The previous builder prefixed every line with its number,
 * which meant a citation could only ever resolve against a rendering Luak
 * invented, not against the evidence. Line numbers now travel as a bound
 * *index* — UTF-8 byte ranges computed from the exact content — so a citation
 * resolves against the original raw bytes and a digest over those bytes still
 * means something.
 */

import { createHash } from "node:crypto";

export const EVIDENCE_TRANSPORT_VERSION = "luak.evidence-transport/1" as const;
export type EvidenceTransportVersion = typeof EVIDENCE_TRANSPORT_VERSION;

/** What a packet is, for the citation contract. Never inferred from content. */
export type EvidenceKind = "test-log" | "repo-file";

/** One line's exact position in the packet's UTF-8 bytes. */
export interface EvidenceLineSpan {
  /** 1-based, the convention stated to the model in the authored direction. */
  readonly line: number;
  readonly startByte: number;
  /** Exclusive, and excluding the line terminator itself. */
  readonly endByte: number;
}

/**
 * One untrusted packet, exactly as it will be sent.
 *
 * `id` is what Bokahli echoes in its fence header, in Velum findings and in
 * telemetry, so it is the join key between what we sent and what the boundary
 * reported. `label` is the human path the model may cite. They are separate on
 * purpose: transport identity must stay stable even where two fixtures
 * describe the same file path.
 */
export interface EvidencePacket {
  readonly id: string;
  readonly label: string;
  readonly kind: EvidenceKind;
  /** The fixture's bytes, verbatim. */
  readonly content: string;
  readonly contentSha256: string;
  readonly byteLength: number;
  readonly lineCount: number;
  readonly lineSpans: readonly EvidenceLineSpan[];
}

export class EvidenceTransportError extends Error {}

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const sha256 = (s: string): string =>
  `sha256:${createHash("sha256").update(Buffer.from(s, "utf-8")).digest("hex")}`;

/**
 * Index every line by its UTF-8 byte range.
 *
 * Computed over the encoded bytes rather than JS string indices: a fixture
 * containing a non-BMP character would otherwise produce spans that disagree
 * with the digest they are supposed to describe, and Bokahli's own finding
 * spans are byte spans.
 */
export function indexLines(content: string): readonly EvidenceLineSpan[] {
  const bytes = Buffer.from(content, "utf-8");
  const spans: EvidenceLineSpan[] = [];
  let line = 1;
  let start = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === NEWLINE) {
      // A trailing terminator ends the last line; it does not begin an empty one.
      const trailingEmpty = i === bytes.length && start === i && spans.length > 0;
      if (!trailingEmpty) {
        let end = i;
        if (end > start && bytes[end - 1] === CARRIAGE_RETURN) end--;
        spans.push({ line, startByte: start, endByte: end });
        line++;
      }
      start = i + 1;
    }
  }
  return spans;
}

/** Build a packet from exact content. The only way to make one. */
export function buildEvidencePacket(args: {
  readonly id: string;
  readonly label: string;
  readonly kind: EvidenceKind;
  readonly content: string;
}): EvidencePacket {
  const { id, label, kind, content } = args;
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/:]{0,127}$/.test(id)) {
    throw new EvidenceTransportError(
      `evidence packet id is not a safe identifier: ${JSON.stringify(id)}`,
    );
  }
  if (label.length === 0 || label.length > 512) {
    throw new EvidenceTransportError(`evidence packet label is empty or too long: ${id}`);
  }
  const spans = indexLines(content);
  return {
    id,
    label,
    kind,
    content,
    contentSha256: sha256(content),
    byteLength: Buffer.byteLength(content, "utf-8"),
    lineCount: spans.length,
    lineSpans: spans,
  };
}

/**
 * A digest over the packet *set*, order included.
 *
 * Binds id, label, kind and content digest together, so two packets holding
 * identical bytes stay distinguishable and neither can be substituted for the
 * other without changing this value. Per-packet digests alone would not catch
 * a swap between two same-content packets, and that is exactly the
 * substitution a citation contract has to survive.
 */
export function evidenceSetDigest(packets: readonly EvidencePacket[]): string {
  const h = createHash("sha256");
  h.update(EVIDENCE_TRANSPORT_VERSION);
  for (const [i, p] of packets.entries()) {
    h.update(`${i}|${p.id}|${p.label}|${p.kind}|${p.contentSha256}|${p.byteLength}|`);
  }
  return `sha256:${h.digest("hex")}`;
}

/**
 * Text that would make a model treat what follows as a new turn.
 *
 * Applied only to *authored* text — the campaign instruction and the task
 * direction. Evidence is never checked against this and never rejected for
 * containing it: a log that carries a fake system turn is the whole point of
 * the injection fixtures, and refusing to transport it would quietly delete
 * the test. Bokahli's fencing is what makes it inert; Luak's job is only to
 * make sure it travels as evidence.
 */
const ROLE_MARKER =
  /<\|im_start\|>|<\|im_end\|>|<\|start_header_id\|>|<\|eot_id\|>|<start_of_turn>|<end_of_turn>|^[ \t]*(system|assistant|developer|tool)[ \t]*:/im;

/**
 * Refuse to send a prompt whose authored text carries evidence bytes.
 *
 * This is the regression guard for the original defect. It does not inspect
 * evidence; it inspects the two fields that carry *our* authority and proves
 * no packet's content leaked into them.
 */
export function assertEvidenceIsolated(args: {
  readonly system: string;
  readonly user: string;
  readonly evidence: readonly EvidencePacket[];
}): void {
  const { system, user, evidence } = args;

  if (ROLE_MARKER.test(system) || ROLE_MARKER.test(user)) {
    throw new EvidenceTransportError(
      "authored campaign text contains a chat role marker; the campaign must not synthesise turns",
    );
  }

  const seenIds = new Set<string>();
  for (const p of evidence) {
    if (seenIds.has(p.id)) {
      throw new EvidenceTransportError(`duplicate evidence packet id: ${p.id}`);
    }
    seenIds.add(p.id);

    if (p.contentSha256 !== sha256(p.content)) {
      throw new EvidenceTransportError(`evidence packet ${p.id} does not match its own digest`);
    }
    if (p.byteLength !== Buffer.byteLength(p.content, "utf-8")) {
      throw new EvidenceTransportError(
        `evidence packet ${p.id} has a byteLength that is not its length`,
      );
    }

    // The original defect, stated as an assertion. A distinctive slice is
    // enough: matching whole content would miss a partially interpolated
    // packet, which is the same bug with a smaller blast radius.
    const probe = longestProbe(p.content);
    if (probe.length >= 24) {
      for (const [name, text] of [["system", system], ["user", user]] as const) {
        if (text.includes(probe)) {
          throw new EvidenceTransportError(
            `evidence packet ${p.id} appears inside the authored ${name} text; ` +
              "untrusted material must travel in evidence[] only",
          );
        }
      }
    }
  }
}

/** The longest single line of a packet, as a cheap distinctive fingerprint. */
function longestProbe(content: string): string {
  let best = "";
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.length > best.length) best = t;
  }
  return best;
}

/** The wire form Bokahli accepts. Exactly `{id, content}`, and nothing more. */
export function toWireEvidence(
  packets: readonly EvidencePacket[],
): readonly { readonly id: string; readonly content: string }[] {
  return packets.map((p) => ({ id: p.id, content: p.content }));
}

/**
 * What a citation is permitted to name, stated to the model in authored text.
 *
 * Built from the packets rather than written by hand, so the allowlist and the
 * transport cannot drift apart.
 */
export function citationContract(packets: readonly EvidencePacket[]): string {
  return packets
    .map((p) => `  - packet "${p.id}" (${p.label}): ${p.lineCount} lines, numbered from 1`)
    .join("\n");
}
