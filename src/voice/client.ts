// 語音線：WebSocket 連線流程（規格書 §4.4，不連線、不花錢的純邏輯模組）
//
// 白話：跟 AssemblyAI 講話的順序寫死在這裡，mock 和真連線共用同一套判斷：
//   拿 token → 連 wss → 送 session.update（S0）→ 收到 session.ready 才算通
//   → 收到 tool.call 先暫存結果，等 reply.done 才送 tool.result
//   → 機台確認了就送 session.update 換 S1（提示詞＋寫入工具一起換）
//   → 結束一定先送 session.end，收到 session.ended 才關連線（閒置也算錢）。
//
// 事件名跟交接/線_語音.md 記的官方格式一致；錯誤一律顯示英文（畫面給評審看）。

import {
  createConfirmedSessionUpdate,
  createInitialSessionUpdate,
} from "./session";

// 瀏覽器連 AssemblyAI 的入口（token 由 /api/voice-token 拿，每次連線重拿）。
export const ASSEMBLYAI_WS_URL = "wss://agents.assemblyai.com/v1/ws";

export function buildWsUrl(token: string): string {
  return `${ASSEMBLYAI_WS_URL}?token=${encodeURIComponent(token)}`;
}

export function initialUpdate(): ReturnType<typeof createInitialSessionUpdate> {
  return createInitialSessionUpdate();
}

export function confirmedUpdate(): ReturnType<typeof createConfirmedSessionUpdate> {
  return createConfirmedSessionUpdate();
}

// input.audio 要送的形狀（聲音本體是 base64，見 audio.ts）。
export function buildInputAudioMessage(audioB64: string): {
  type: string;
  audio: string;
} {
  return { type: "input.audio", audio: audioB64 };
}

export interface IncomingMessage {
  type?: string;
  status?: string;
  text?: string;
  session_id?: string;
  call_id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  message?: string;
  code?: string | number;
}

// 插話判斷（§4.4）：收到 input.speech.started，或 reply.done 帶 interrupted，
// 要立刻停掉正在播的聲音並清空排隊。
export function isInterruptionMessage(msg: IncomingMessage): boolean {
  if (msg.type === "input.speech.started") return true;
  if (msg.type === "reply.done" && msg.status === "interrupted") return true;
  return false;
}

export function isNormalReplyDone(msg: IncomingMessage): boolean {
  return msg.type === "reply.done" && msg.status !== "interrupted";
}

// 機台確認判斷：讀取工具成功回來 → 可以換 S1（寫入工具＋複誦提示詞一起上）。
export function shouldUpgradeToS1(
  toolName: string,
  result: Record<string, unknown>,
): boolean {
  if (toolName !== "get_machine_status" && toolName !== "lookup_alarm") {
    return false;
  }
  return typeof result.error !== "string";
}

// 關線原因 → 畫面顯示的英文（評審看得懂；不准把 token／金鑰放進訊息）。
export function englishErrorForClose(code: number): string {
  if (code === 1008) {
    return "Session unauthorized. Please press Start again to get a new token.";
  }
  if (code === 1006) {
    return "Connection lost. Please check the network and press Start again.";
  }
  return `Connection closed (${code}). Please press Start again.`;
}

// 伺服器送 session.error → 畫面顯示的英文。
export function englishErrorForSessionError(msg: IncomingMessage): string {
  const detail = typeof msg.message === "string" && msg.message ? msg.message : "";
  const code = msg.code !== undefined ? ` (${msg.code})` : "";
  return detail
    ? `Assistant error${code}: ${detail}`
    : `Assistant error${code}. Please press Start again.`;
}

// tool.result 的形狀（result 先轉 JSON 字串；失敗加 is_error，見結論 ②）。
export function buildToolResult(
  callId: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: "tool.result",
    call_id: callId,
    result: JSON.stringify(result),
  };
  if (typeof result.error === "string") payload.is_error = true;
  return payload;
}
