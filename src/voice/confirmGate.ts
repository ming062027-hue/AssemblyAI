// 確認關卡：會改變東西的語音工具（開維修單、清除警報），要操作員「最近一輪話」明確說了 yes 才放行。
//
// 為什麼要有這道（總管 2026-09-25 用真 AssemblyAI 重錄示範時抓到）：
//   AI 嘴巴說「請確認，準備好我就送出」，同一個回合就自己呼叫 create_repair_ticket，
//   operator_confirmed 自己填 "yes"——操作員其實還沒回答。只靠提示詞擋不住，改由程式看操作員講了什麼。
//
// 規則：
//   - 一輪話＝AI 講完之後，操作員接著講的所有片段（AssemblyAI 常把一句話切成好幾段 transcript.user）。
//   - 這一輪要有「yes／confirm／是／確認」這類字，而且沒有「no／cancel／不要／取消」這類字，才放行。
//   - 一次 yes 只能用一次：避免 AI 拿同一個 yes 連開兩張單。

export const CONFIRM_REQUIRED_TOOLS: ReadonlySet<string> = new Set([
  "create_repair_ticket",
  "clear_machine_alarm",
]);

// 任何位置出現都算同意
const EN_YES =
  /\b(yes|yeah|yep|yup|confirm|confirmed|correct|affirmative|go ahead|please do|do it|submit it|sounds good|that's right|that is right)\b/i;
// 口氣比較弱的，只有整輪話很短、而且放在開頭才算（避免 "OK so the spindle…" 被當成同意）
const EN_SHORT_YES = /^(ok|okay|sure|alright|all right|fine)\b/i;
const EN_NO = /\b(no|nope|not|don't|do not|cancel|wait|hold on|stop|never mind)\b/i;
const EN_NOT_REALLY_NO = /\bno (problem|worries)\b/gi;
const ZH_YES = /確認|确认|確定|确定|沒錯|没错|沒問題|没问题|送出|開吧|开吧/;
const ZH_SHORT_YES = /^(是|對|对|好|可以|嗯|行)/;
const ZH_NO = /不要|取消|等一下|等等|先不要|還沒|还没|不對|不对|不是|別|别|確認一下|确认一下|再確認|再确认/;

/** 操作員這段話算不算明確同意。寧可誤判成「還沒同意」（AI 會再問一次），也不要誤判成同意。 */
export function isOperatorYes(text: string): boolean {
  const t = text.replace(/[’‘]/g, "'").trim();
  if (!t) return false;
  if (EN_NO.test(t.replace(EN_NOT_REALLY_NO, "")) || ZH_NO.test(t)) return false;
  if (EN_YES.test(t) || ZH_YES.test(t)) return true;
  const bare = t.replace(/[\s.,!?;:，。！？、…]+/g, " ").trim();
  if (EN_SHORT_YES.test(bare) && bare.split(" ").length <= 5) return true;
  // 中文的「是／好／對」太常出現在一般句子裡（「是主軸的問題」），只認 4 個字以內的短答（是的、好的、對啊）
  return ZH_SHORT_YES.test(bare) && bare.replace(/ /g, "").length <= 4;
}

export type ConfirmCheck = { allowed: true } | { allowed: false; error: string };

export interface ConfirmGate {
  onUserTranscript(text: string): void;
  onAgentTranscript(): void;
  /** 這個工具可不可以執行；放行需要確認的工具時，會把這次 yes 用掉。 */
  check(toolName: string): ConfirmCheck;
  reset(): void;
}

function notConfirmedMessage(toolName: string): string {
  if (toolName === "clear_machine_alarm") {
    return "NOT DONE: the operator has not said yes yet, so the alarm was NOT cleared. Say which alarm on which machine you will clear, ask the operator to say yes, and call clear_machine_alarm again only after the operator says yes.";
  }
  return "NOT DONE: the operator has not said yes yet, so NO ticket was created. Read back the machine, symptom, severity and whether production can continue in one short sentence, ask the operator to say yes, and call create_repair_ticket again only after the operator says yes.";
}

export function createConfirmGate(): ConfirmGate {
  let turn: string[] = [];
  let agentSpokeSinceTurn = true;
  let yesUsed = false;
  return {
    onUserTranscript(text) {
      if (agentSpokeSinceTurn) {
        turn = [];
        yesUsed = false;
        agentSpokeSinceTurn = false;
      }
      turn.push(text);
    },
    onAgentTranscript() {
      agentSpokeSinceTurn = true;
    },
    check(toolName) {
      if (!CONFIRM_REQUIRED_TOOLS.has(toolName)) return { allowed: true };
      if (!yesUsed && isOperatorYes(turn.join(" "))) {
        yesUsed = true;
        return { allowed: true };
      }
      return { allowed: false, error: notConfirmedMessage(toolName) };
    },
    reset() {
      turn = [];
      agentSpokeSinceTurn = true;
      yesUsed = false;
    },
  };
}
