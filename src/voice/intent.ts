// 語音線：意圖解析（新規格：Streaming STT 逐字稿 → LeMUR → {action, target}）
//
// 白話：操作員按住講完一句話，伺服器把聽到的文字丟給 LeMUR（語言理解），
// LeMUR 只回兩個欄位：要做什麼（action）、對哪台機台或哪個警報碼（target）。
// 前端收到後顯示 INTENT_RESOLVED。
//
// mock 版（本檔，不連線、不花錢）：關鍵字路由，規則跟 scripts/mock-agent.mjs
// 同一套（M03／414 示範值跟規格書 §4.1 對齊），給前端先接著用。
// 真版（以後）：LeMUR 回傳的物件只做形狀檢查（isValidIntent），不連線。

export type IntentAction =
  | "machine_status"
  | "lookup_alarm"
  | "maintenance_history"
  | "create_ticket"
  | "end"
  | "unknown";

export interface Intent {
  action: IntentAction;
  target: string | null;
}

export interface IntentResolved {
  type: "INTENT_RESOLVED";
  session_id: string;
  transcript: string;
  action: IntentAction;
  target: string | null;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
const NUMBER_WORD_RE =
  /\b(zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\b/g;
const MACHINE_RE = /\bmachine\s*(three|3)\b|\bm03\b/;

function wordsToDigits(text: string): string | null {
  const hits = [...text.matchAll(NUMBER_WORD_RE)].map((m) => NUMBER_WORDS[m[1]]);
  return hits.length > 0 ? hits.join("") : null;
}

// mock 意圖路由（純函式，不碰網路）。
// 順序跟 mock-agent.mjs 一致：先把「machine three」這種機台指稱拿掉，
// 剩下的數字才算警報碼，不然 "Machine three has an alarm." 裡的 three
// 會被誤判成警報碼 3。
export function parseMockIntent(text: string): Intent {
  const lower = String(text ?? "").toLowerCase();

  if (lower.includes("that's all") || lower.includes("that is all")) {
    return { action: "end", target: null };
  }

  const machineHit = lower.match(MACHINE_RE);
  const rest = machineHit ? lower.replace(machineHit[0], " ") : lower;

  const digitHit = rest.match(/\d[\d ]*/);
  const wordDigits = digitHit ? null : wordsToDigits(rest);
  const rawCode = digitHit ? digitHit[0] : wordDigits;
  if (rawCode) {
    return { action: "lookup_alarm", target: rawCode.replaceAll(" ", "") };
  }

  if (machineHit) {
    return { action: "machine_status", target: "M03" };
  }

  if (lower.includes("repair") || lower.includes("ticket")) {
    return { action: "maintenance_history", target: "M03" };
  }

  if (/\byes\b/.test(lower)) {
    return { action: "create_ticket", target: "M03" };
  }

  return { action: "unknown", target: null };
}

// LeMUR 真回傳的形狀檢查（以後接真 API 時用，現在只給單測）。
export function isValidIntent(obj: unknown): obj is Intent {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  const actions: IntentAction[] = [
    "machine_status",
    "lookup_alarm",
    "maintenance_history",
    "create_ticket",
    "end",
    "unknown",
  ];
  if (typeof o.action !== "string" || !actions.includes(o.action as IntentAction)) {
    return false;
  }
  return o.target === null || typeof o.target === "string";
}

export function buildIntentResolved(
  sessionId: string,
  transcript: string,
  intent: Intent,
): IntentResolved {
  return {
    type: "INTENT_RESOLVED",
    session_id: sessionId,
    transcript,
    action: intent.action,
    target: intent.target,
  };
}
