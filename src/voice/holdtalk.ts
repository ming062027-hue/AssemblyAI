// 語音線：按住說話控制器（新規格 /api/voice-stream 用，不連線、不花錢）
//
// 白話：操作員「按住」開始收音、「放開」結束送出。聲音小塊（audio.ts
// encodeMicChunk 轉好的 base64）一邊錄一邊經 WebSocket 送伺服器；放開後
// 等伺服器回 INTENT_RESOLVED，前端顯示 action＋target。
//
// 本檔是狀態機＋送訊息順序（純邏輯，socket 用最小介面注入，Node 直接能測）。
// 真正開麥克風（getUserMedia＋AudioWorklet）沿用 audio.ts，頁面層再接。

import type {
  ServerMessage,
} from "./stream-protocol";

// 註：本檔 runtime 零跨檔 import（Node 型別剝離單測要能直接跑，見 audio.test.mjs
// 慣例），所以 start／audio／stop 字面量在這裡直接組，不 import stream-protocol.ts
// 的 builder。線路形狀（type 名、audio 欄位）必須跟 stream-protocol.ts 一致，
// 由 stream.test.mjs 逐則斷言鎖住（送出的每則都過 protocol 的 guard）。
function startPayload(sessionId?: string): string {
  return sessionId
    ? JSON.stringify({ type: "start", session_id: sessionId })
    : JSON.stringify({ type: "start" });
}

function audioPayload(audioB64: string): string {
  return JSON.stringify({ type: "audio", audio: audioB64 });
}

const STOP_PAYLOAD = JSON.stringify({ type: "stop" });

function isIntentResolved(raw: unknown): raw is {
  transcript?: unknown;
  action: string;
  target: string | null;
} {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    o.type === "INTENT_RESOLVED" &&
    typeof o.action === "string" &&
    (o.target === null || typeof o.target === "string")
  );
}

export type HoldStatus = "idle" | "recording" | "resolving" | "resolved" | "error";

// 測試和頁面共用的最小 socket 形狀（只用到 send，關線由頁面管）。
export interface MinimalSocket {
  send(data: string): void;
}

export interface HoldResult {
  transcript: string;
  action: string;
  target: string | null;
}

export class HoldTalkController {
  private socket: MinimalSocket | null = null;
  private status: HoldStatus = "idle";
  private chunks = 0;
  private lastResult: HoldResult | null = null;
  private lastError = "";

  getStatus(): HoldStatus {
    return this.status;
  }

  getChunkCount(): number {
    return this.chunks;
  }

  getResult(): HoldResult | null {
    return this.lastResult;
  }

  getError(): string {
    return this.lastError;
  }

  // 按住：一定要 idle 才能開始，不然回 false（連打保護）。
  press(socket: MinimalSocket, sessionId?: string): boolean {
    if (this.status !== "idle") return false;
    this.socket = socket;
    this.chunks = 0;
    this.lastResult = null;
    this.lastError = "";
    try {
      socket.send(startPayload(sessionId));
    } catch {
      this.status = "error";
      this.lastError = "Could not start recording. Please try again.";
      return false;
    }
    this.status = "recording";
    return true;
  }

  // 錄音中送一塊聲音（頁面層用 audio.ts encodeMicChunk 轉好再傳進來）。
  pushAudio(audioB64: string): boolean {
    if (this.status !== "recording" || !this.socket) return false;
    try {
      this.socket.send(audioPayload(audioB64));
    } catch {
      this.status = "error";
      this.lastError = "Could not send audio. Please try again.";
      return false;
    }
    this.chunks++;
    return true;
  }

  // 放開：送 stop，等伺服器回 INTENT_RESOLVED（沒錄到半塊也照送，伺服器判）。
  release(): boolean {
    if (this.status !== "recording" || !this.socket) return false;
    try {
      this.socket.send(STOP_PAYLOAD);
    } catch {
      this.status = "error";
      this.lastError = "Could not finish recording. Please try again.";
      return false;
    }
    this.status = "resolving";
    return true;
  }

  // 收到伺服器訊息：只認 INTENT_RESOLVED（逐字稿 TRANSCRIPT_* 由頁面直接顯示）。
  // 回 true 表示這句話有結果了（狀態進 resolved）。
  onServerMessage(raw: string): boolean {
    if (this.status !== "resolving") return false;
    let msg: unknown;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return false;
    }
    if (!isIntentResolved(msg)) return false;
    this.lastResult = {
      transcript: typeof msg.transcript === "string" ? msg.transcript : "",
      action: msg.action,
      target: msg.target,
    };
    this.status = "resolved";
    return true;
  }

  // 再講下一句之前重置（resolved／error 才能重置，錄音中按重置不算）。
  reset(): boolean {
    if (this.status !== "resolved" && this.status !== "error") return false;
    this.socket = null;
    this.chunks = 0;
    this.lastResult = null;
    this.lastError = "";
    this.status = "idle";
    return true;
  }
}
