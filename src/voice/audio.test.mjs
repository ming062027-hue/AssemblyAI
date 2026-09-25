// Unit tests for the voice audio pure functions (Claude 2026-09-19, hardening
// the previously-untested audio encoding layer that the real connection relies on).
// Run: node --test src/voice/audio.test.mjs (no extra packages needed).
// Plain .mjs importing the TS module via Node's built-in type stripping;
// tsc --noEmit still type-checks audio.ts itself.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_RATE,
  resampleTo24k,
  floatToPCM16,
  pcm16ToBase64,
  base64ToPCM16,
  encodeMicChunk,
  makeTestToneB64,
  createPlaybackQueue,
  PLAYBACK_START_LEAD_S,
  replyAudioOf,
} from "./audio.ts";

describe("voice/audio pure functions", () => {
  it("1. AssemblyAI sample rate is 24000 Hz", () => {
    assert.equal(SAMPLE_RATE, 24000);
  });

  it("2. floatToPCM16 maps full-scale and clamps out-of-range", () => {
    const pcm = floatToPCM16(new Float32Array([0, 1, -1, 2, -2]));
    assert.equal(pcm[0], 0);
    assert.equal(pcm[1], 32767); // +1 -> max
    assert.equal(pcm[2], -32768); // -1 -> min
    assert.equal(pcm[3], 32767); // +2 clamped to +1
    assert.equal(pcm[4], -32768); // -2 clamped to -1
  });

  it("3. pcm16ToBase64 -> base64ToPCM16 round-trips exactly", () => {
    const original = Int16Array.from([0, 1, -1, 12345, -12345, 32767, -32768]);
    const back = base64ToPCM16(pcm16ToBase64(original));
    assert.equal(back.length, original.length);
    for (let i = 0; i < original.length; i++) assert.equal(back[i], original[i]);
  });

  it("4. resampleTo24k: same rate keeps length, 48k halves, empty stays empty", () => {
    assert.equal(resampleTo24k(new Float32Array([0.1, 0.2, 0.3]), 24000).length, 3);
    assert.equal(resampleTo24k(new Float32Array(100), 48000).length, 50);
    assert.equal(resampleTo24k(new Float32Array(0), 48000).length, 0);
  });

  it("5. encodeMicChunk at 24k yields base64 decoding to the same sample count", () => {
    const frame = new Float32Array(4800); // 200 ms at 24 kHz
    for (let i = 0; i < frame.length; i++) frame[i] = Math.sin(i / 10) * 0.5;
    assert.equal(base64ToPCM16(encodeMicChunk(frame, 24000)).length, 4800);
  });

  it("6. makeTestToneB64 length matches seconds x 24000 samples", () => {
    assert.equal(base64ToPCM16(makeTestToneB64(440, 0.1)).length, 2400);
  });
});

// Gapless playback (總管 2026-09-25): the old queue started each chunk only after the
// previous chunk's onended fired, leaving a gap at every boundary (the "hoarse voice").
// A fake AudioContext records the start time of every chunk.
function fakeAudioContext(startTime) {
  const sources = [];
  const ctx = {
    sampleRate: 48000,
    currentTime: startTime,
    destination: {},
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource() {
      const node = {
        buffer: null,
        onended: null,
        startedAt: null,
        stopped: false,
        connect() {},
        start(when) { node.startedAt = when; },
        stop() { node.stopped = true; },
      };
      sources.push(node);
      return node;
    },
  };
  return { ctx, sources };
}
const chunk40ms = () => pcm16ToBase64(new Int16Array(SAMPLE_RATE * 0.04));
const close = (a, b) => Math.abs(a - b) < 1e-9;

describe("voice/audio gapless playback queue", () => {
  it("7. back-to-back chunks start exactly where the previous one ends", () => {
    const { ctx, sources } = fakeAudioContext(1.0);
    const q = createPlaybackQueue(ctx, () => {});
    q.enqueue(chunk40ms());
    q.enqueue(chunk40ms());
    q.enqueue(chunk40ms());
    assert.ok(close(sources[0].startedAt, 1.0 + PLAYBACK_START_LEAD_S));
    assert.ok(close(sources[1].startedAt, sources[0].startedAt + 0.04));
    assert.ok(close(sources[2].startedAt, sources[1].startedAt + 0.04));
  });

  it("8. after the queue has drained, a new chunk starts from now plus the lead", () => {
    const { ctx, sources } = fakeAudioContext(1.0);
    const q = createPlaybackQueue(ctx, () => {});
    q.enqueue(chunk40ms());
    ctx.currentTime = 5.0;
    q.enqueue(chunk40ms());
    assert.ok(close(sources[1].startedAt, 5.0 + PLAYBACK_START_LEAD_S));
  });

  it("9. onEmpty fires once, only after the last scheduled chunk ends", () => {
    const { ctx, sources } = fakeAudioContext(0);
    let empty = 0;
    const q = createPlaybackQueue(ctx, () => { empty += 1; });
    q.enqueue(chunk40ms());
    q.enqueue(chunk40ms());
    sources[0].onended();
    assert.equal(empty, 0);
    sources[1].onended();
    assert.equal(empty, 1);
  });

  it("10. stopAndClear stops every scheduled chunk and restarts the timeline", () => {
    const { ctx, sources } = fakeAudioContext(2.0);
    const q = createPlaybackQueue(ctx, () => {});
    q.enqueue(chunk40ms());
    q.enqueue(chunk40ms());
    q.enqueue(chunk40ms());
    assert.equal(q.stopAndClear(), 3);
    assert.ok(sources.every((s) => s.stopped && s.onended === null));
    q.enqueue(chunk40ms());
    assert.ok(close(sources[3].startedAt, 2.0 + PLAYBACK_START_LEAD_S));
  });
});

// reply.audio field (總管 2026-09-25): the official API puts the audio in `data`;
// the frontend used to read `audio`, so the real agent voice was never played.
describe("voice/audio replyAudioOf", () => {
  it("11. reads the official data field", () => {
    assert.equal(replyAudioOf({ type: "reply.audio", data: "AAAA" }), "AAAA");
  });
  it("12. still accepts the old mock audio field", () => {
    assert.equal(replyAudioOf({ type: "reply.audio", audio: "BBBB" }), "BBBB");
  });
  it("13. prefers data when both exist; returns null when missing or empty", () => {
    assert.equal(replyAudioOf({ data: "CC", audio: "DD" }), "CC");
    assert.equal(replyAudioOf({ type: "reply.audio" }), null);
    assert.equal(replyAudioOf({ data: "" }), null);
    assert.equal(replyAudioOf(null), null);
  });
});
