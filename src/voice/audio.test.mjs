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
