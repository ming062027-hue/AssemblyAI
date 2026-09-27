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
