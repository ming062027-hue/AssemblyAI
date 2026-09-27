// Unit tests for the local-assistant TTS voice picker (總管 2026-09-27).
// Run: node --test src/voice/ttsVoice.test.mjs (no extra packages needed).
// MAC_VOICES is the real speechSynthesis.getVoices() list (name, lang, same order)
// captured on 大銘's MacBook Air on 2026-09-27: "Albert" is the first en-US voice.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgentSayMessage, createAgentSayQueue, isVoiceSessionActive, pickTtsVoice } from "./ttsVoice.ts";

const MAC_VOICES = [["婷婷","zh-CN"],["Albert","en-US"],["Alice","it-IT"],["Alva","sv-SE"],["Amélie","fr-CA"],["Amira","ms-MY"],["Anna","de-DE"],["Bad News","en-US"],["Bahh","en-US"],["Bells","en-US"],["Boing","en-US"],["Bubbles","en-US"],["Carmit","he-IL"],["Cellos","en-US"],["Damayanti","id-ID"],["Daniel","en-GB"],["Daria","bg-BG"],["Eddy (中文（台灣）)","zh-TW"],["Eddy (中文（中國大陸）)","zh-CN"],["Eddy (德文（德國）)","de-DE"],["Eddy (英文（英國）)","en-GB"],["Eddy (英文（美國）)","en-US"],["Eddy (西班牙文（西班牙）)","es-ES"],["Eddy (西班牙文（墨西哥）)","es-MX"],["Eddy (芬蘭文（芬蘭）)","fi-FI"],["Eddy (法文（加拿大）)","fr-CA"],["Eddy (法文（法國）)","fr-FR"],["Eddy (義大利文（義大利）)","it-IT"],["Eddy (日文（日本）)","ja-JP"],["Eddy (韓文（南韓）)","ko-KR"],["Eddy (葡萄牙文（巴西）)","pt-BR"],["Ellen","nl-BE"],["Flo (中文（台灣）)","zh-TW"],["Flo (中文（中國大陸）)","zh-CN"],["Flo (德文（德國）)","de-DE"],["Flo (英文（英國）)","en-GB"],["Flo (英文（美國）)","en-US"],["Flo (西班牙文（西班牙）)","es-ES"],["Flo (西班牙文（墨西哥）)","es-MX"],["Flo (芬蘭文（芬蘭）)","fi-FI"],["Flo (法文（加拿大）)","fr-CA"],["Flo (法文（法國）)","fr-FR"],["Flo (義大利文（義大利）)","it-IT"],["Flo (日文（日本）)","ja-JP"],["Flo (韓文（南韓）)","ko-KR"],["Flo (葡萄牙文（巴西）)","pt-BR"],["Fred","en-US"],["Geeta","te-IN"],["Good News","en-US"],["Grandma (中文（台灣）)","zh-TW"],["Grandma (中文（中國大陸）)","zh-CN"],["Grandma (德文（德國）)","de-DE"],["Grandma (英文（英國）)","en-GB"],["Grandma (英文（美國）)","en-US"],["Grandma (西班牙文（西班牙）)","es-ES"],["Grandma (西班牙文（墨西哥）)","es-MX"],["Grandma (芬蘭文（芬蘭）)","fi-FI"],["Grandma (法文（加拿大）)","fr-CA"],["Grandma (法文（法國）)","fr-FR"],["Grandma (義大利文（義大利）)","it-IT"],["Grandma (日文（日本）)","ja-JP"],["Grandma (韓文（南韓）)","ko-KR"],["Grandma (葡萄牙文（巴西）)","pt-BR"],["Grandpa (中文（台灣）)","zh-TW"],["Grandpa (中文（中國大陸）)","zh-CN"],["Grandpa (德文（德國）)","de-DE"],["Grandpa (英文（英國）)","en-GB"],["Grandpa (英文（美國）)","en-US"],["Grandpa (西班牙文（西班牙）)","es-ES"],["Grandpa (西班牙文（墨西哥）)","es-MX"],["Grandpa (芬蘭文（芬蘭）)","fi-FI"],["Grandpa (法文（加拿大）)","fr-CA"],["Grandpa (法文（法國）)","fr-FR"],["Grandpa (義大利文（義大利）)","it-IT"],["Grandpa (日文（日本）)","ja-JP"],["Grandpa (韓文（南韓）)","ko-KR"],["Grandpa (葡萄牙文（巴西）)","pt-BR"],["Ioana","ro-RO"],["Jacques","fr-FR"],["Jester","en-US"],["Joana","pt-PT"],["Junior","en-US"],["Kanya","th-TH"],["Karen","en-AU"],["Kathy","en-US"],["Kyoko","ja-JP"],["Lana","hr-HR"],["Laura","sk-SK"],["Lekha","hi-IN"],["Lesya","uk-UA"],["Linh","vi-VN"],["Luciana","pt-BR"],["Majed","ar-001"],["Melina","el-GR"],["Milena","ru-RU"],["Moira","en-IE"],["Montse","ca-ES"],["Mónica","es-ES"],["Nora","nb-NO"],["Organ","en-US"],["Paulina","es-MX"],["Piya","bn-IN"],["Ralph","en-US"],["Reed (中文（台灣）)","zh-TW"],["Reed (中文（中國大陸）)","zh-CN"],["Reed (德文（德國）)","de-DE"],["Reed (英文（英國）)","en-GB"],["Reed (英文（美國）)","en-US"],["Reed (西班牙文（西班牙）)","es-ES"],["Reed (西班牙文（墨西哥）)","es-MX"],["Reed (芬蘭文（芬蘭）)","fi-FI"],["Reed (法文（加拿大）)","fr-CA"],["Reed (義大利文（義大利）)","it-IT"],["Reed (日文（日本）)","ja-JP"],["Reed (韓文（南韓）)","ko-KR"],["Reed (葡萄牙文（巴西）)","pt-BR"],["Rishi","en-IN"],["Rocko (中文（台灣）)","zh-TW"],["Rocko (中文（中國大陸）)","zh-CN"],["Rocko (德文（德國）)","de-DE"],["Rocko (英文（英國）)","en-GB"],["Rocko (英文（美國）)","en-US"],["Rocko (西班牙文（西班牙）)","es-ES"],["Rocko (西班牙文（墨西哥）)","es-MX"],["Rocko (芬蘭文（芬蘭）)","fi-FI"],["Rocko (法文（加拿大）)","fr-CA"],["Rocko (法文（法國）)","fr-FR"],["Rocko (義大利文（義大利）)","it-IT"],["Rocko (日文（日本）)","ja-JP"],["Rocko (韓文（南韓）)","ko-KR"],["Rocko (葡萄牙文（巴西）)","pt-BR"],["Samantha","en-US"],["Sandy (中文（台灣）)","zh-TW"],["Sandy (中文（中國大陸）)","zh-CN"],["Sandy (德文（德國）)","de-DE"],["Sandy (英文（英國）)","en-GB"],["Sandy (英文（美國）)","en-US"],["Sandy (西班牙文（西班牙）)","es-ES"],["Sandy (西班牙文（墨西哥）)","es-MX"],["Sandy (芬蘭文（芬蘭）)","fi-FI"],["Sandy (法文（加拿大）)","fr-CA"],["Sandy (法文（法國）)","fr-FR"],["Sandy (義大利文（義大利）)","it-IT"],["Sandy (日文（日本）)","ja-JP"],["Sandy (韓文（南韓）)","ko-KR"],["Sandy (葡萄牙文（巴西）)","pt-BR"],["Sara","da-DK"],["Satu","fi-FI"],["Shelley (中文（台灣）)","zh-TW"],["Shelley (中文（中國大陸）)","zh-CN"],["Shelley (德文（德國）)","de-DE"],["Shelley (英文（英國）)","en-GB"],["Shelley (英文（美國）)","en-US"],["Shelley (西班牙文（西班牙）)","es-ES"],["Shelley (西班牙文（墨西哥）)","es-MX"],["Shelley (芬蘭文（芬蘭）)","fi-FI"],["Shelley (法文（加拿大）)","fr-CA"],["Shelley (法文（法國）)","fr-FR"],["Shelley (義大利文（義大利）)","it-IT"],["Shelley (日文（日本）)","ja-JP"],["Shelley (韓文（南韓）)","ko-KR"],["Shelley (葡萄牙文（巴西）)","pt-BR"],["Soumya","kn-IN"],["Superstar","en-US"],["Tessa","en-ZA"],["Thomas","fr-FR"],["Tina","sl-SI"],["Trinoids","en-US"],["Tünde","hu-HU"],["Vani","ta-IN"],["Whisper","en-US"],["Wobble","en-US"],["Xander","nl-NL"],["Yelda","tr-TR"],["Yuna","ko-KR"],["Zarvox","en-US"],["Zosia","pl-PL"],["Zuzana","cs-CZ"],["善怡","yue-HK"],["美佳","zh-TW"]].map(([name, lang]) => ({ name, lang }));
const v = (name, lang) => ({ name, lang });
const NOVELTY_OR_ELOQUENCE =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|fred|good news|jester|junior|kathy|organ|ralph|superstar|trinoids|whisper|wobble|zarvox|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

describe("pickTtsVoice", () => {
  it("on the real Mac list picks Samantha / 美佳, never Albert", () => {
    assert.equal(MAC_VOICES.length, 180);
    assert.equal(MAC_VOICES.find((x) => x.lang === "en-US").name, "Albert");
    assert.equal(pickTtsVoice(MAC_VOICES, "en").name, "Samantha");
    assert.equal(pickTtsVoice(MAC_VOICES, "zh").name, "美佳");
  });

  it("never returns a novelty or Eloquence voice, even when they are the only ones", () => {
    const junk = MAC_VOICES.filter((x) => NOVELTY_OR_ELOQUENCE.test(x.name));
    assert.ok(junk.length > 50);
    assert.equal(pickTtsVoice(junk, "en"), null);
    assert.equal(pickTtsVoice(junk, "zh"), null);
  });

  it("returns null for an empty list (voices not loaded yet)", () => {
    assert.equal(pickTtsVoice([], "en"), null);
    assert.equal(pickTtsVoice([], "zh"), null);
  });

  it("uses Chrome network voices when the Mac voices are missing", () => {
    const chrome = [v("Albert", "en-US"), v("Google US English", "en-US"), v("Google UK English Female", "en-GB"), v("Google 國語（臺灣）", "zh-TW"), v("Google 普通话（中国大陆）", "zh-CN")];
    assert.equal(pickTtsVoice(chrome, "en").name, "Google US English");
    assert.equal(pickTtsVoice(chrome, "zh").name, "Google 國語（臺灣）");
  });

  it("uses Windows / Edge voices", () => {
    const win = [v("Microsoft David - English (United States)", "en-US"), v("Microsoft Zira - English (United States)", "en-US"), v("Microsoft Hanhan - Chinese (Traditional, Taiwan)", "zh-TW")];
    assert.equal(pickTtsVoice(win, "en").name, "Microsoft Zira - English (United States)");
    assert.equal(pickTtsVoice(win, "zh").name, "Microsoft Hanhan - Chinese (Traditional, Taiwan)");
  });

  it("prefers Taiwan Mandarin, falls back to Mainland only when needed", () => {
    assert.equal(pickTtsVoice([v("婷婷", "zh-CN"), v("美佳", "zh-TW")], "zh").name, "美佳");
    assert.equal(pickTtsVoice([v("婷婷", "zh-CN")], "zh").name, "婷婷");
  });

  it("does not use an English voice for Chinese or the other way round", () => {
    assert.equal(pickTtsVoice([v("Samantha", "en-US")], "zh"), null);
    assert.equal(pickTtsVoice([v("美佳", "zh-TW")], "en"), null);
  });
});

describe("isVoiceSessionActive", () => {
  it("mutes the local voice while a voice session is connecting or connected", () => {
    for (const s of ["connecting", "listening", "thinking", "speaking"]) assert.equal(isVoiceSessionActive(s), true, s);
    for (const s of ["idle", "ended", "error"]) assert.equal(isVoiceSessionActive(s), false, s);
  });
});

// Connected + shortcut pressed: the official AI reads the console answer (總管 2026-09-27).
describe("buildAgentSayMessage", () => {
  it("is an official reply.create that quotes the console answer and forbids extras and tools", () => {
    const m = buildAgentSayMessage("  Alarm 414: spindle load abnormal.\n First check the tool edge. ");
    assert.equal(m.type, "reply.create");
    assert.match(m.instructions, /Console answer: "Alarm 414: spindle load abnormal\. First check the tool edge\."$/);
    assert.match(m.instructions, /Do not add any fact, number or ticket ID/);
    assert.match(m.instructions, /do not call any tool/);
    assert.deepEqual(Object.keys(m).sort(), ["instructions", "type"]);
  });
  it("caps very long console answers", () => {
    assert.ok(buildAgentSayMessage("x".repeat(5000)).instructions.length < 1000);
  });
});

describe("createAgentSayQueue", () => {
  const setup = (connected = true) => {
    const sent = [];
    let t = 1000;
    const q = createAgentSayQueue((msg) => { if (!connected) return false; sent.push(msg); return true; }, () => t);
    return { q, sent, tick: (ms) => { t += ms; } };
  };
  const said = (msg) => msg.instructions.match(/Console answer: "(.*)"$/)[1];

  it("sends right away when the AI is idle", () => {
    const { q, sent } = setup();
    assert.equal(q.say("Hello"), true);
    assert.deepEqual(sent.map(said), ["Hello"]);
  });
  it("does nothing without a live connection (mock or not connected)", () => {
    const { q, sent } = setup(false);
    assert.equal(q.say("Hello"), false);
    q.onReplyDone();
    assert.equal(sent.length, 0);
  });
  it("waits while the AI is replying and then sends only the latest", () => {
    const { q, sent } = setup();
    q.onReplyStarted();
    q.say("first");
    q.say("second");
    assert.equal(sent.length, 0);
    q.onReplyDone();
    assert.deepEqual(sent.map(said), ["second"]);
  });
  it("two quick presses before reply.started do not send two reply.create", () => {
    const { q, sent, tick } = setup();
    q.say("one");
    tick(300);
    q.say("two");
    assert.deepEqual(sent.map(said), ["one"]);
    q.onReplyStarted();
    q.onReplyDone();
    assert.deepEqual(sent.map(said), ["one", "two"]);
  });
  it("if reply.started never comes, the busy window ends after 5 seconds", () => {
    const { q, sent, tick } = setup();
    q.say("one");
    tick(5001);
    q.say("two");
    assert.deepEqual(sent.map(said), ["one", "two"]);
  });
  it("reset drops anything waiting", () => {
    const { q, sent } = setup();
    q.onReplyStarted();
    q.say("stale");
    q.reset();
    q.onReplyDone();
    assert.equal(sent.length, 0);
  });
  it("ignores empty text", () => {
    const { q, sent } = setup();
    assert.equal(q.say("   "), false);
    assert.equal(sent.length, 0);
  });
});
