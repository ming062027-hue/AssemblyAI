import { PROMPT_S0, PROMPT_S1 } from "./prompt";
import { TOOLS_S0, TOOLS_S1 } from "./tools";

function buildSessionUpdate(systemPrompt: string, tools: object[]) {
  return {
    type: "session.update",
    session: {
      system_prompt: systemPrompt,
      tools,
      input: {
        voice_focus: "far-field",
        // 多語：明確列出需要的三種（en/zh/pt），不鎖英文。
        // 理由：不設 language_codes 是全自動偵測（18 種裡猜，吵雜現場易誤判）；
        // 設成 ["en","zh","pt"] 只在這三種裡判斷，官方說會稍微準一點
        //（見 交接/線_語音.md 結論④）。輸出仍只用英文（規格書 §1 #4：尚無中文聲音）。
        language_codes: ["en", "zh", "pt"],
        keyterms: [
          "M01", "M02", "M03", "M04", "M05",
          "414", "1001",
          "spindle", "coolant", "ATC", "servo",
          "S45C", "E-402", "AGV", "PLC", "Fanuc", "J2軸",
          "chuck", "turret"
        ],
        // turn_detection 必須放在 input 裡（2026-09-19 Claude 用真 API 實測：
        // 放在 session 底層會被打回 invalid_format；放進 input 後 session.ready 通過）。
        turn_detection: {
          vad_threshold: 0.5,
          min_silence: 1400,
          max_silence: 4000,
          interrupt_response: true
        }
      },
      output: {
        voice: "alba"
      }
    }
  };
}

export function createInitialSessionUpdate() {
  return buildSessionUpdate(PROMPT_S0, TOOLS_S0);
}

// S1（機台確認後）只送「對話中能改」的欄位：system_prompt、tools。
// output.voice／input.voice_focus／input.language_codes 在第一次 session.update 後不可變，
// 再送整包會被真 API 回 immutable_field（2026-09-19 Claude 用真 API 實測）。
export function createConfirmedSessionUpdate() {
  return {
    type: "session.update",
    session: {
      system_prompt: PROMPT_S1,
      tools: TOOLS_S1,
    },
  };
}
