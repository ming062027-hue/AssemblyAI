// 語音線：/api/voice-stream 線上協定（mock 版，不連線、不花錢）
//
// 白話：按住說話的新流程走這條線，不走舊的 Voice Agent 直連。
//   1. 前端按住 → 送 {type:"start"}，放開 → 開始送聲音 {type:"audio", audio: base64}
//     （PCM16、單聲道、24kHz，跟 audio.ts 送 AssemblyAI 同一規格）
//   2. 放開 → 送 {type:"stop"}，伺服器回逐字稿 {type:"TRANSCRIPT_FINAL", text}
//   3. 再回 {type:"INTENT_RESOLVED", action, target}（真版由 LeMUR 產生，
//      mock 版由 intent.ts 的 parseMockIntent 產生，形狀一樣，前端不用改）
// 中間的 {type:"TRANSCRIPT_PARTIAL", text} 是即時逐字（可有可無）。
//
// 本檔只有組訊息＋認訊息的純函式（兩邊共用，前端和伺服器都 import），
// Node 直接能測。真轉發（送 AssemblyAI Streaming STT＋LeMUR）等架構定案再寫。

import type { Intent } from "./intent";

export type ClientMessage =
  | { type: "start"; session_id?: string }
  | { type: "audio"; audio: string }
  | { type: "stop" };

export type ServerMessage =
  | { type: "TRANSCRIPT_PARTIAL"; text: string }
  | { type: "TRANSCRIPT_FINAL"; text: string }
  | {
      type: "INTENT_RESOLVED";
      session_id: string;
      transcript: string;
      action: string;
      target: string | null;
    };

export function buildStartMessage(sessionId?: string): ClientMessage {
  return sessionId ? { type: "start", session_id: sessionId } : { type: "start" };
}

export function buildAudioMessage(audioB64: string): ClientMessage {
  return { type: "audio", audio: audioB64 };
}

export function buildStopMessage(): ClientMessage {
  return { type: "stop" };
}

export function isAudioMessage(msg: unknown): msg is { type: "audio"; audio: string } {
  if (!msg || typeof msg !== "object") return false;
  const o = msg as Record<string, unknown>;
  return o.type === "audio" && typeof o.audio === "string";
}

export function isIntentResolvedMessage(msg: unknown): msg is ServerMessage & {
  type: "INTENT_RESOLVED";
} {
  if (!msg || typeof msg !== "object") return false;
  const o = msg as Record<string, unknown>;
  return (
    o.type === "INTENT_RESOLVED" &&
    typeof o.action === "string" &&
    (o.target === null || typeof o.target === "string")
  );
}

// mock 伺服器回法：一句 transcript → TRANSCRIPT_FINAL ＋ INTENT_RESOLVED
//（形狀跟真 LeMUR 回來的一樣，前端分不出來）。
// 註：INTENT_RESOLVED 字面量在這裡直接組（不 import intent.ts 的 builder），
// 讓本檔 runtime 零跨檔 import（Node 型別剝離單測要能直接跑，見 audio.test.mjs 慣例）。
// 形狀一致性由 stream.test.mjs 鎖住。
export function mockResolve(
  sessionId: string,
  transcript: string,
  intent: Intent,
): ServerMessage[] {
  return [
    { type: "TRANSCRIPT_FINAL", text: transcript },
    {
      type: "INTENT_RESOLVED",
      session_id: sessionId,
      transcript,
      action: intent.action,
      target: intent.target,
    },
  ];
}
