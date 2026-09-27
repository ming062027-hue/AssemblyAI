// 本機助理（Model宇宙）用瀏覽器內建語音講話時，挑哪一個聲音、什麼時候不講。
//
// 為什麼要有這個（總管 2026-09-27，大銘回報「按按鈕有沙啞聲、連線後兩個聲音一起出來」）：
//   1. Chrome 的聲音清單是晚一點才載入的；以前清單還是空的時候就不指定聲音，讓 Chrome 自己挑。
//      macOS 的英文清單排第一個是 Albert（沙啞老人特效聲），大銘聽比對音檔確認就是它。
//   2. 連上 AssemblyAI 之後，本機語音從喇叭出來又被麥克風收進去，AI 以為有人講話也跟著回，變成兩個聲音。
// 做法：只從下面的好聲音清單挑，挑不到就不講（只顯示文字）；語音連線期間本機不出聲，只留 AI 一個聲音。

export interface VoiceLike {
  name: string;
  lang: string;
}

// 依序比對，先找到的先用。Chrome 網路聲音、macOS、Windows／Edge 的常見好聲音都列進來。
const EN_PREFERRED: RegExp[] = [
  /^samantha/i, // macOS 英文女聲
  /^google us english$/i, // Chrome 網路英文女聲
  /^microsoft (aria|jenny|zira)\b/i, // Windows／Edge
  /^(ava|allison|susan|serena|karen|moira|tessa)\b/i, // macOS 其他英文女聲
  /^google uk english female$/i,
  /^daniel\b/i, // macOS 英國男聲
];

const ZH_PREFERRED: RegExp[] = [
  /^(美佳|meijia)/i, // macOS 台灣國語女聲
  /^google\s*國語/i, // Chrome 網路台灣國語
  /^microsoft (hanhan|yating|zhiwei|hsiaochen|hsiaoyu)\b/i, // Windows 台灣
  /^(婷婷|tingting)/i, // macOS 普通話女聲（沒有台灣聲音時才用）
  /^google\s*普通话/i,
  /^microsoft (xiaoxiao|yaoyao|huihui|kangkang)\b/i,
];

/** 從瀏覽器的聲音清單挑一個好聲音；挑不到回 null（呼叫端就不要講，絕不能讓瀏覽器自己挑）。 */
export function pickTtsVoice<V extends VoiceLike>(voices: readonly V[], lang: "zh" | "en"): V | null {
  const prefix = lang === "zh" ? "zh" : "en";
  const pool = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix));
  for (const re of lang === "zh" ? ZH_PREFERRED : EN_PREFERRED) {
    const hit = pool.find((v) => re.test(v.name.trim()));
    if (hit) return hit;
  }
  return null;
}

/** 語音連線（AssemblyAI 或本機 mock）進行中：本機助理只顯示文字、不出聲。 */
export function isVoiceSessionActive(status: string): boolean {
  return status === "connecting" || status === "listening" || status === "thinking" || status === "speaking";
}

// ---- 連線時按按鈕：請官方 AI 用它自己的聲音唸出主控台的回答 ----
// 大銘 2026-09-27：連線後按按鈕沒聲音（本機不出聲、按鈕也沒送給 AI），選「按鈕的回答改由官方 AI 唸」。
// 用官方 reply.create（events-reference：可附一次性 instructions，不改 system_prompt）。

/** 組 reply.create：只唸主控台給的內容，不加料、不為這句呼叫工具（免得按按鈕讓 AI 自己去開單）。 */
export function buildAgentSayMessage(consoleText: string): { type: "reply.create"; instructions: string } {
  const text = consoleText.replace(/\s+/g, " ").trim().slice(0, 600);
  return {
    type: "reply.create",
    instructions:
      "The operator just pressed a shortcut on the CNC-640 console. Treat the console answer below as a tool result. " +
      "Tell the operator what it says, in English, in one or two short sentences. " +
      "Do not add any fact, number or ticket ID that is not in it, and do not call any tool for this reply. " +
      `Console answer: "${text}"`,
  };
}

export interface AgentSayQueue {
  /** 送出或排隊；回傳 false＝沒有真連線（mock 或沒連上），什麼都不做。 */
  say(text: string): boolean;
  onReplyStarted(): void;
  onReplyDone(): void;
  reset(): void;
}

/**
 * AI 正在回話時不能插一句 reply.create（官方說明：在 reply.done 之後再送），所以先排隊，只留最新一句。
 * 送出後 5 秒內還沒收到 reply.started 也當成忙碌，避免連按兩下送出兩個 reply.create。
 */
export function createAgentSayQueue(send: (msg: object) => boolean, now: () => number = Date.now): AgentSayQueue {
  let replying = false;
  let busyUntil = 0;
  let pending: string | null = null;
  const fire = (text: string): boolean => {
    if (!send(buildAgentSayMessage(text))) return false;
    busyUntil = now() + 5000;
    return true;
  };
  return {
    say(text) {
      const t = text.trim();
      if (!t) return false;
      if (replying || now() < busyUntil) {
        pending = t;
        return true;
      }
      return fire(t);
    },
    onReplyStarted() {
      replying = true;
      busyUntil = 0;
    },
    onReplyDone() {
      replying = false;
      busyUntil = 0;
      if (pending) {
        const t = pending;
        pending = null;
        fire(t);
      }
    },
    reset() {
      replying = false;
      busyUntil = 0;
      pending = null;
    },
  };
}
