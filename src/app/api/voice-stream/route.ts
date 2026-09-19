// 看板資料線：/api/voice-stream mock 轉發路由（不連真 AssemblyAI、不花錢）
//
// 白話：按住說話的新流程，前端經 WebSocket 送 start／audio／stop，
// 伺服器回 TRANSCRIPT_*（逐字稿）＋INTENT_RESOLVED（意圖）。
// mock 版先可跑：STT 用示範句代替（真版等架構定案才接 Streaming STT＋LeMUR），
// 意圖用 intent.ts 的 parseMockIntent，組訊息用 stream-protocol.ts 的 mockResolve
//（形狀跟真版一樣，前端不用改）。全程本機、0 元。
//
// Next.js 路由放不了 WS 長連線（serverless 沒有 upgrade），所以：
// - WS 真升級等架構定案（語音線 Q2）再由獨立伺服器接，
//   到時同一支 toServerMessages 逐則餵給 socket 即可；
// - 本路由先用 HTTP 鏡像同一映射：POST 一則 ClientMessage 回 ServerMessage[]，
//   curl 就能驗；GET 回協定說明（路由存在、不 404）。
// 額外命名匯出只有 GET／POST＋runtime／dynamic（Next 路由檢查只認這些，
// 純函式刻意不 export，見 voice-token/route.ts 同一招）。

import { parseMockIntent } from "@/voice/intent";
import { mockResolve } from "@/voice/stream-protocol";
import type { ServerMessage } from "@/voice/stream-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// mock STT 沒有真聲音辨識：WS 的 stop 本身不帶文字，先用示範句（§4.1 M03 alarm）
// 回放整條管線；HTTP 測試想走別句時，POST body 帶 transcript 覆寫。
const DEMO_TRANSCRIPT = "Machine three has an alarm.";

let mockSeq = 0;
function newSessionId(): string {
  mockSeq += 1;
  return `mock-session-${Date.now().toString(36)}-${mockSeq}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// WS 訊息→伺服器訊息的映射（無狀態：start 重置、audio 只計數不回、
// stop 回 TRANSCRIPT_FINAL＋INTENT_RESOLVED；未知訊息回空陣列不炸）。
function toServerMessages(
  msg: unknown,
  sessionId: string,
  transcriptForStop?: string,
): ServerMessage[] {
  if (!isRecord(msg) || typeof msg.type !== "string") return [];
  if (msg.type === "start") return [];
  if (msg.type === "audio") {
    if (typeof msg.audio !== "string") return [];
    return [];
  }
  if (msg.type === "stop") {
    const transcript =
      typeof transcriptForStop === "string" && transcriptForStop.length > 0
        ? transcriptForStop
        : DEMO_TRANSCRIPT;
    return mockResolve(sessionId, transcript, parseMockIntent(transcript));
  }
  return [];
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  return Response.json(
    {
      ok: true,
      mode: "mock",
      accepts: ["start", "audio", "stop"],
      emits: ["TRANSCRIPT_PARTIAL", "TRANSCRIPT_FINAL", "INTENT_RESOLVED"],
      note: "mock only: no AssemblyAI connection, no charge. POST one ClientMessage, get ServerMessage[]. Real WS upgrade after arch decision.",
    },
    { headers: NO_STORE },
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400, headers: NO_STORE });
  }
  const b = isRecord(body) ? body : {};
  const sessionId =
    typeof b.session_id === "string" && b.session_id.length > 0
      ? b.session_id
      : newSessionId();
  const transcript =
    typeof b.transcript === "string" && b.transcript.length > 0
      ? b.transcript
      : undefined;
  const messages = toServerMessages(body, sessionId, transcript);
  return Response.json({ session_id: sessionId, messages }, { headers: NO_STORE });
}
