// Tests for the hold-to-talk mock pipeline (no network, no charge).
// Run: node --test src/voice/stream.test.mjs (no extra packages needed).
// Plain .mjs importing the TS modules via Node's built-in type stripping;
// tsc --noEmit still type-checks the .ts files themselves.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMockIntent, isValidIntent, buildIntentResolved } from "./intent.ts";
import {
  buildStartMessage,
  buildAudioMessage,
  buildStopMessage,
  isAudioMessage,
  isIntentResolvedMessage,
  mockResolve,
} from "./stream-protocol.ts";
import { HoldTalkController } from "./holdtalk.ts";
import { encodeMicChunk } from "./audio.ts";

describe("mock intent (§2.4 main line order)", () => {
  it("1. line 1 -> machine_status M03", () => {
    assert.deepEqual(parseMockIntent("Machine three has an alarm."), {
      action: "machine_status",
      target: "M03",
    });
  });

  it("2. line 2 -> lookup_alarm 414", () => {
    assert.deepEqual(parseMockIntent("What does alarm four one four mean?"), {
      action: "lookup_alarm",
      target: "414",
    });
  });

  it("3. line 3 -> maintenance_history M03", () => {
    assert.deepEqual(
      parseMockIntent("I checked. Still noisy. Open a repair ticket."),
      { action: "maintenance_history", target: "M03" },
    );
  });

  it("4. line 4 -> create_ticket M03", () => {
    assert.deepEqual(parseMockIntent("Yes, confirm."), {
      action: "create_ticket",
      target: "M03",
    });
  });

  it("5. line 5 -> end", () => {
    assert.deepEqual(parseMockIntent("That's all, thanks."), {
      action: "end",
      target: null,
    });
  });

  it("6. 9999 -> lookup_alarm 9999 (server checks the table, not here)", () => {
    assert.deepEqual(parseMockIntent("What about alarm nine nine nine nine?"), {
      action: "lookup_alarm",
      target: "9999",
    });
  });

  it("7. gibberish -> unknown", () => {
    assert.deepEqual(parseMockIntent("Blah blah blah."), {
      action: "unknown",
      target: null,
    });
  });
});

describe("intent shapes (LeMUR contract)", () => {
  it("8. isValidIntent accepts the mock outputs", () => {
    assert.equal(isValidIntent(parseMockIntent("Machine three has an alarm.")), true);
    assert.equal(isValidIntent({ action: "nope", target: null }), false);
    assert.equal(isValidIntent(null), false);
  });

  it("9. INTENT_RESOLVED carries session, transcript, action, target", () => {
    const msg = buildIntentResolved("s-1", "Machine three has an alarm.", {
      action: "machine_status",
      target: "M03",
    });
    assert.equal(msg.type, "INTENT_RESOLVED");
    assert.equal(msg.session_id, "s-1");
    assert.equal(msg.action, "machine_status");
    assert.equal(msg.target, "M03");
    assert.equal(isIntentResolvedMessage(msg), true);
  });
});

describe("stream protocol messages", () => {
  it("10. start/audio/stop builders + audio guard", () => {
    assert.deepEqual(buildStartMessage(), { type: "start" });
    assert.deepEqual(buildStopMessage(), { type: "stop" });
    const a = buildAudioMessage("AAA=");
    assert.equal(isAudioMessage(a), true);
    assert.equal(isAudioMessage({ type: "audio" }), false);
  });

  it("11. mockResolve emits TRANSCRIPT_FINAL + INTENT_RESOLVED", () => {
    const out = mockResolve("s-2", "Yes, confirm.", {
      action: "create_ticket",
      target: "M03",
    });
    assert.equal(out.length, 2);
    assert.equal(out[0].type, "TRANSCRIPT_FINAL");
    assert.equal(out[1].type, "INTENT_RESOLVED");
    assert.equal(isIntentResolvedMessage(out[1]), true);
  });

  it("12. real mic-format audio chunk fits the audio message", () => {
    const frame = new Float32Array(4800);
    for (let i = 0; i < frame.length; i++) frame[i] = Math.sin(i / 10) * 0.5;
    const msg = buildAudioMessage(encodeMicChunk(frame, 24000));
    assert.equal(isAudioMessage(JSON.parse(JSON.stringify(msg))), true);
  });
});

describe("hold-to-talk controller (fake socket, no browser)", () => {
  it("13. press -> audio x2 -> release -> INTENT_RESOLVED -> resolved", () => {
    const sent = [];
    const sock = { send: (d) => sent.push(JSON.parse(d)) };
    const c = new HoldTalkController();
    assert.equal(c.press(sock, "s-3"), true);
    assert.equal(c.getStatus(), "recording");
    assert.equal(c.pushAudio("AAA="), true);
    assert.equal(c.pushAudio("BBB="), true);
    assert.equal(c.getChunkCount(), 2);
    assert.equal(c.release(), true);
    assert.equal(c.getStatus(), "resolving");
    assert.deepEqual(
      sent.map((m) => m.type),
      ["start", "audio", "audio", "stop"],
    );
    // 線路一致性：controller 送出的每則都要過 protocol 的 guard
    //（兩檔 runtime 零跨檔 import，這裡是唯一的鎖）。
    assert.equal(sent[0].type, buildStartMessage("s-3").type);
    assert.equal(isAudioMessage(sent[1]), true);
    assert.equal(isAudioMessage(sent[2]), true);
    assert.deepEqual(sent[3], buildStopMessage());
    const [finalMsg, intentMsg] = mockResolve("s-3", "Machine three has an alarm.", {
      action: "machine_status",
      target: "M03",
    });
    assert.equal(c.onServerMessage(JSON.stringify(finalMsg)), false); // transcript only: still waiting
    assert.equal(c.onServerMessage(JSON.stringify(intentMsg)), true);
    assert.equal(c.getStatus(), "resolved");
    assert.deepEqual(c.getResult(), {
      transcript: "Machine three has an alarm.",
      action: "machine_status",
      target: "M03",
    });
    assert.equal(c.reset(), true);
    assert.equal(c.getStatus(), "idle");
  });

  it("14. double press blocked; release without press ignored", () => {
    const sock = { send: () => {} };
    const c = new HoldTalkController();
    assert.equal(c.release(), false);
    assert.equal(c.press(sock), true);
    assert.equal(c.press(sock), false);
  });
});
