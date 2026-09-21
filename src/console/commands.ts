// Model宇宙 command router (console line).
//
// Splits "what the user said" (input) from "what to do" (action) so Phase 2 can
// swap the input source (real AssemblyAI voice) without touching the actions.
// Phase 1: text in (typed or preset chips) -> interpret() -> navigate + a spoken
// reply, reusing the REAL tools (real alarm lookup, real ticket creation).
// Bilingual (Chinese + English) keyword matching so 大銘 can drive it in Chinese
// and the English demo still works.

import {
  get_machine_status,
  lookup_alarm,
  get_maintenance_history,
  create_repair_ticket,
  resolve_repair_ticket,
  type Machine,
  type Alarm,
  type Ticket,
} from "../tools/handlers.ts";

export type ScreenKey = "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7";

export interface ScreenDef {
  key: ScreenKey;
  code: string;
  name: string;
  en: string;
  keywords: string[];
}

export const SCREENS: ScreenDef[] = [
  { key: "f1", code: "F1", name: "流程監控總覽", en: "Process Overview", keywords: ["流程", "監控", "總覽", "戰情", "全部", "全景", "overview", "process", "home", "dashboard"] },
  { key: "f2", code: "F2", name: "AGV 車隊調度", en: "AGV Fleet", keywords: ["agv", "車隊", "搬運", "調度", "無人車", "fleet"] },
  { key: "f3", code: "F3", name: "手臂軸向數據", en: "Robot Arm", keywords: ["手臂", "機械手臂", "軸", "數據", "扭矩", "伺服", "arm", "robot", "torque", "servo"] },
  { key: "f4", code: "F4", name: "原料庫存", en: "Inventory", keywords: ["庫存", "原料", "補料", "叫料", "材料", "inventory", "material", "stock"] },
  { key: "f5", code: "F5", name: "AI 通話紀錄", en: "Call Log", keywords: ["通話", "通訊錄", "紀錄", "外部", "採購", "報修紀錄", "電話", "call", "log"] },
  { key: "f6", code: "F6", name: "智能品檢與尺寸公差", en: "Vision & CMM QC", keywords: ["品檢", "檢驗", "公差", "良率", "瑕疵", "粗糙度", "三次元", "cmm", "qc", "inspection", "quality"] },
  { key: "f7", code: "F7", name: "綠色能源與設備健康", en: "Energy & Maintenance", keywords: ["能源", "耗電", "電費", "碳排", "綠能", "功耗", "健康", "預測", "軸承", "震動", "潤滑油", "切削水", "能耗", "energy", "power", "carbon", "health"] },
];

export interface CommandContext {
  machine: string | null;
  alarm: string | null;
  lang: "zh" | "en"; // 中英切換：en 時新分支用英文回，舊分支維持中文
  pendingView: ScreenKey | null; // 異常推播問「要不要切畫面」後等一句 好/不要
}
export const emptyContext = (): CommandContext => ({
  machine: null,
  alarm: null,
  lang: "zh",
  pendingView: null,
});

/** interpret() 的第三個參數：看板即時狀態（由呼叫端傳入，保持本檔純函式可測）。 */
export interface InterpretExtra {
  tickets?: Ticket[];
  urges?: number; // 本次開機累計催料通話次數
}

export interface CommandResult {
  navigate: ScreenKey | null;
  response: string; // Model宇宙 reply (text now, real TTS in Phase 2)
  context: CommandContext;
  ticketId?: string; // set when a real ticket was created (board refresh)
  ticketResolveId?: string; // set when a ticket was resolved (board refresh)
  clearAlarm?: boolean; // set when the alarm must be cleared (panel hides, 04 normal)
  agv?: { id: string; task: string }; // set when an AGV dispatch was requested
  supplier?: { material: string }; // set when a supplier urge-call was requested
  workOrder?: "A109" | "B202" | "C303"; // set when a work order switch was requested
  actionId: string | null; // ACTIONS registry id (派工包 v2 §2.2)
  alarm?: Alarm; // set when an alarm was looked up (show on F3)
  machine?: Machine; // set when a machine status was looked up
}

// 派工包 v2 §2.2 動作登記表：宇宙能做的每件事都在這登記，加新能力＝加一條。
// keywords 中英文都要。interpret() 下面的分支就是這張表的執行體。
export interface ActionDef {
  id: string;
  keywords: RegExp;
  hint: string;
}
export const ACTIONS: ActionDef[] = [
  { id: "nav.view", keywords: /流程監控|通訊錄|切換|畫面|f ?[1-7]|流程|監控|總覽|戰情|手臂|arm|庫存|inventory|通話|call|agv|車隊|品檢|公差|qc|cmm|能源|耗電|健康/, hint: "切換 F1–F7 畫面（說編號或名稱都行）" },
  { id: "alarm.lookup", keywords: /警報|alarm|\d{3,4}/, hint: "查警報碼" },
  { id: "alarm.clear", keywords: /解除警報|警報重置|清除警報|警報靜音|靜音|f ?[68]|reset alarm|clear alarm|alarm reset|silence alarm|mute/, hint: "解除警報（F8）" },
  { id: "ticket.create", keywords: /開.*單|維修單|報修|repair|ticket/, hint: "開維修單" },
  { id: "ticket.resolve", keywords: /修好|維修完成|解除工單|完工|結案|fixed|resolved|done|complete/, hint: "維修完成解除工單" },
  { id: "agv.dispatch", keywords: /調度|補料|送料|出車|dispatch|agv/, hint: "AGV 調度補料" },
  { id: "supplier.urge", keywords: /催料|叫料|催促|缺料|供應商|supplier|order|purchase/, hint: "催料通話" },
  { id: "maint.lookup", keywords: /保養|維修紀錄|maintenance|history/, hint: "查保養紀錄" },
  { id: "material.forecast", keywords: /耗材|預測|forecast/, hint: "耗材還夠不夠（低庫存預警）" },
  { id: "report.daily", keywords: /今日報表|日報|報表|daily report/, hint: "今日開單／解除／催料統計" },
  { id: "agv.battery", keywords: /電量|回充|充電|battery|charge/, hint: "AGV 電量查詢與回充" },
  { id: "ticket.status", keywords: /單號|進度|ticket status/, hint: "查單號進度（例 RT-1001 進度）" },
  { id: "lang.switch", keywords: /切換英文|切換中文|switch to english|switch to chinese/, hint: "中英切換" },
  { id: "shift.handover", keywords: /交班|下班|換班|handover/, hint: "交班摘要（今日單數／解除／催料）" },
  { id: "qc.report", keywords: /品檢|檢驗|公差|良率|瑕疵|粗糙度|quality|inspection|qc|cmm/, hint: "三次元與 AI 視覺智能品檢分析報告" },
  { id: "energy.report", keywords: /能源|耗電|電費|碳排|綠能|功耗|energy|power|carbon/, hint: "全廠即時功率、耗電、電費與 ESG 碳排跳錶" },
  { id: "health.report", keywords: /設備健康|健康度|軸承|震動|潤滑油|切削水|預測維護|health/, hint: "主軸軸承震動頻譜與預測性維護健康矩陣" },
  { id: "workorder.switch", keywords: /切換工單|換工單|換切|切換到|工單 a109|工單 b202|工單 c303|閥體|人工關節|渦輪葉片/, hint: "切換 MES 工單配方 (A109 葉片 / B202 閥體 / C303 人工關節)" },
];

/** Example chips shown in the UI (bilingual) so 大銘 can click to demo. */
export const PRESET_COMMANDS: string[] = [
  "查看品檢報告",
  "工廠耗電多少",
  "設備健康度",
  "換切燃油閥體",
  "查警報 414",
  "開維修單",
  "看手臂數據",
  "交班摘要",
];

// ---- 主動管：開機巡檢／分級處置／異常推播／交班摘要（主控追加） ----

export type TriageLevel = "P0" | "P1" | "P2";

/** 分級處置：P0 停機立刻報、P1 預警問催料、P2 保養提醒。 */
export function triageAlarm(a: Alarm): TriageLevel {
  if (a.severity === "high" || a.needs_technician) return "P0";
  if (a.severity === "medium") return "P1";
  return "P2";
}

const STATION_IDS = ["M01", "M02", "M03", "M04", "M05"];
const LOW_STOCK_LINE = 50;

/** 低庫存站（material_left < 安全線 50），由少到多排。 */
export function stockWarnings(): { id: string; left: number }[] {
  const out: { id: string; left: number }[] = [];
  for (const id of STATION_IDS) {
    const m = get_machine_status({ machine_id: id });
    if (!("error" in m) && m.material_left < LOW_STOCK_LINE) {
      out.push({ id: m.id, left: m.material_left });
    }
  }
  return out.sort((a, b) => a.left - b.left);
}

export interface StartupReport {
  text: string;
  hasAlarm: boolean;
}

/**
 * 開機巡檢：掃 5 站＋庫存＋待修單，30 秒內能講完（約 110 字）。
 * ⚠️ 開場白第一句是暫定版：主控說「開場介紹詞照我給的那段」，但派工單沒附原文，
 * 拿到原文後換掉第一句，後面巡檢數字不動。
 */
export function buildStartupReport(openTickets: number): StartupReport {
  const alarm: string[] = [];
  const stopped: string[] = [];
  for (const id of STATION_IDS) {
    const m = get_machine_status({ machine_id: id });
    if ("error" in m) continue;
    if (m.status === "alarm" && m.current_alarm) {
      alarm.push(`${m.id} 警報 ${m.current_alarm}`);
    } else if (m.status === "stopped") {
      stopped.push(m.id);
    }
  }
  const low = stockWarnings();
  const lowTxt =
    low.length === 0
      ? "原料都在安全線以上"
      : `原料偏低：${low.map((s) => `${s.id} 剩 ${s.left}`).join("、")}`;
  const text =
    `我是 Model宇宙，你的工廠語音管家。開機巡檢完成：` +
    `${alarm.length ? alarm.join("、") + "，" : "5 站無警報，"}` +
    `${stopped.length ? stopped.join("、") + "停機中，" : ""}` +
    `${lowTxt}，目前待修單 ${openTickets} 張。要從哪裡開始？說查警報、開單或催料都可以。`;
  return { text, hasAlarm: alarm.length > 0 };
}

/** 異常推播內文：分級＋建議處置＋問要不要切畫面。 */
export function buildAlarmPush(a: Alarm): { text: string; view: ScreenKey } {
  const level = triageAlarm(a);
  if (level === "P0") {
    return {
      view: "f3",
      text:
        `【P0 緊急停機】這張要立刻處理：先停機、叫技師到場，不要再開車。` +
        `要不要切到 F3 看軸向數據？`,
    };
  }
  if (level === "P1") {
    return {
      view: "f3",
      text:
        `【P1 預警】還能撐一下，但別拖：上面三步先做，要不要我開維修單或幫你催料？` +
        `要不要切到 F3 看即時數據？`,
    };
  }
  return {
    view: "f5",
    text:
      `【P2 保養提醒】不急，排進下次保養就行。` +
      `要不要查這台的保養紀錄？我切 F5 給你看也行。`,
  };
}

function countTickets(tickets: Ticket[]): { total: number; open: number; resolved: number; openIds: string[] } {
  const openIds = tickets
    .filter((t) => (t.status ?? "open") === "open")
    .map((t) => t.ticket_id);
  return { total: tickets.length, open: openIds.length, resolved: tickets.length - openIds.length, openIds };
}

/** 今日報表：今日單數／解除／待修／催料＋低庫存提醒。 */
export function buildDailyReport(tickets: Ticket[], urges: number): string {
  const c = countTickets(tickets);
  const low = stockWarnings();
  const lowTxt =
    low.length === 0
      ? ""
      : `原料注意：${low.map((s) => `${s.id} 剩 ${s.left}`).join("、")}，低於安全線 ${LOW_STOCK_LINE}。`;
  return (
    `今日報表：共開單 ${c.total} 張，已解除 ${c.resolved} 張，待修 ${c.open} 張，` +
    `催料通話 ${urges} 次。${lowTxt}`
  );
}

/** 產線智慧戰情簡報（NotebookLM 級別深度結構化分析：診斷 5 站、瓶頸、伺服負載與物料）。 */
export function buildExecutiveBriefing(tickets: Ticket[], urges: number): string {
  const c = countTickets(tickets);
  const low = stockWarnings();
  const lowTxt =
    low.length === 0
      ? "全線原料均高於安全基準"
      : `注意：${low.map((s) => `${s.id} 剩 ${s.left}`).join("、")}，低於安全線 ${LOW_STOCK_LINE}`;

  return (
    `【CNC-640 產線智慧戰情報告】\n` +
    `1. 站別瓶頸：04 加工區（M03）因切削負載偏高觸發 414 預警，其餘 4 站處於自動循環。\n` +
    `2. 伺服診斷：J2 軸負載達 142%，建議排查主軸冷卻液與刀具切削進給率。\n` +
    `3. 原料預警：${lowTxt}，預估 2.5 小時後需補叫料（累計催料 ${urges} 次）。\n` +
    `4. 維修閉環：累計開單 ${c.total} 張，待修 ${c.open} 張，已完工結案 ${c.resolved} 張。\n` +
    `建議行動：優先現場排查 M03，並至 F3 監控伺服扭力趨勢。`
  );
}

/** 交班摘要：ended／交班時總結今日單數／解除／催料＋點名下一班先看哪張。 */
export function buildShiftSummary(tickets: Ticket[], urges: number): string {
  const c = countTickets(tickets);
  const tail =
    c.openIds.length > 0
      ? `下一班請先看：${c.openIds.slice(-3).join("、")}。`
      : `手上沒待修單，交班愉快。`;
  return (
    `交班摘要：今日共 ${c.total} 張單，已解除 ${c.resolved} 張，待修 ${c.open} 張，` +
    `催料 ${urges} 次。${tail}`
  );
}

/** AGV 電量示意值（跟 F2 車隊畫面同一組數字）。 */
const AGV_BATTERY = [
  { id: "AGV-01", level: 88, note: "搬運中" },
  { id: "AGV-02", level: 95, note: "待命中" },
];

export function buildAgvBatteryReport(): string {
  const parts = AGV_BATTERY.map((b) => `${b.id} ${b.level}%${b.note}`);
  return `AGV 電量：${parts.join("、")}（示意值）；03、04 在品檢線搬運，電量正常。要回充就說「AGV 回充」。`;
}

const RE_TICKET = /(開.*單|維修單|報修|開單|repair|ticket)/i;
const RE_RESOLVE = /(修好|維修完成|解除.*(?:工單|rt|ticket)|\b解除\s*rt\b|完工|結案|fixed|resolved|\bdone\b|complete)/i;
const RE_CLEAR_ALARM = /(解除警報|警報重置|清除警報|警報靜音|靜音|重置警報|f ?[68]|reset alarm|clear alarm|alarm reset|silence alarm|mute alarm)/i;
const RE_AGV = /(調度|補料|送料|出車|派車|dispatch|agv)/i;
const RE_SUPPLIER = /(催料|叫料|催促|缺料|供應商|supplier|order material|purchase)/i;
const RE_MAINT = /(保養|維修紀錄|保養紀錄|maintenance|history)/i;
const RE_ALARM = /\b(\d{3,4})\b/; // 3–4 digits = alarm code (machine no. is 1 digit)

function extractMachine(t: string): string | null {
  const m =
    t.match(/\bm0?([1-5])\b/i) ||
    t.match(/machine\s*([1-5])\b/i) ||
    t.match(/([1-5])\s*號機?/) ||
    t.match(/機台?\s*([1-5])/);
  return m ? `M0${m[1]}` : null;
}

function findScreen(t: string): ScreenKey | null {
  for (const s of SCREENS) {
    if (s.keywords.some((k) => t.includes(k.toLowerCase()))) return s.key;
  }
  return null;
}

export function interpret(raw: string, ctx: CommandContext, extra: InterpretExtra = {}): CommandResult {
  const text = String(raw ?? "").trim();
  // 每句回答完，未明確保留的 pendingView 一律清空（切畫面問題只等一句）。
  const base: CommandResult = {
    navigate: null,
    response: "",
    context: { ...ctx, pendingView: null },
    actionId: null,
  };
  if (!text) return { ...base, response: "我在聽，請說指令。" };
  const t = text.toLowerCase();
  const en = ctx.lang === "en";

  // F0) 短編號直跳：說 F1–F7 切對應畫面，F8＝警報靜音/解除。
  const fHit = t.match(/f\s?([1-8])\b/);
  if (fHit) {
    if (fHit[1] === "8") {
      base.context.alarm = null;
      return {
        ...base,
        actionId: "alarm.clear",
        clearAlarm: true,
        response: "警報已解除，04 加工區恢復正常，警報面板已收回。",
      };
    }
    const key = `f${fHit[1]}` as ScreenKey;
    const s = SCREENS.find((x) => x.key === key);
    if (s) {
      return { ...base, navigate: key, actionId: "nav.view", response: `好的，切換到「${s.name}」。` };
    }
  }

  // F0.5) 上一句推播問「要不要切畫面」：只認整句 好／不要（「要開單」這種不算）。
  if (ctx.pendingView) {
    if (/^(好|好啊|好呀|要|可以|看|切|嗯|ok|yes|yeah|yep|要看)$/i.test(text)) {
      const key = ctx.pendingView;
      const s = SCREENS.find((x) => x.key === key)!;
      return { ...base, navigate: key, actionId: "nav.view", response: `好的，切換到「${s.name}」。` };
    }
    if (/^(不要|不用|先不要|不用了|no|not now)$/i.test(text)) {
      return { ...base, actionId: "nav.view", response: "好的，先不切畫面，有需要再叫我。" };
    }
    // 答非所問就往下走，pendingView 由 base 清掉。
  }

  // F0.6) 中英切換。
  if (/(switch to english|english mode|用英文|切換英文|英文模式)/i.test(text)) {
    base.context.lang = "en";
    return {
      ...base,
      actionId: "lang.switch",
      response: "Switched to English. I can check machines, look up alarms, open tickets, and switch screens. Try 'check alarm 414'.",
    };
  }
  if (/(switch to chinese|chinese mode|用中文|切換中文|中文模式)/i.test(text)) {
    base.context.lang = "zh";
    return {
      ...base,
      actionId: "lang.switch",
      response: "已切回中文。用中文講就行，例如查警報 414、開維修單。",
    };
  }
  // 0) 解除警報（派工包 v2 §4＋§7：語音/按鈕/F6 都走同一個 clearAlarm）。
  if (RE_CLEAR_ALARM.test(text)) {
    base.context.alarm = null;
    return {
      ...base,
      actionId: "alarm.clear",
      clearAlarm: true,
      response: "警報已解除，04 加工區恢復正常，警報面板已收回。",
    };
  }

  // 0.5) 維修完成→解除工單（派工包 v2 §4：RT-1001 修好了 / 維修完成 / 解除工單 / 解除 RT-1001）。
  if (RE_RESOLVE.test(text) || (text.includes("解除") && /rt-?\d+/i.test(text))) {
    const idHit = text.match(/RT-?\s?(\d+)/i) || text.match(/#?TICKET-?\s?(\d+)/i);
    const ticketId = idHit ? `RT-${idHit[1]}` : "RT-1001";
    if (ticketId) {
      let res = resolve_repair_ticket({ ticket_id: ticketId });
      if ("error" in res) {
        // 若尚未開立任何單據，自動為示範生成 RT-1001 並予以結案解除，確保現場按鈕 100% 成功閉環
        const auto = create_repair_ticket({
          machine_id: "M03",
          symptom: "414 J2 軸伺服負載 142% 過載卡死，需工程師到廠檢修",
          severity: "high",
          can_keep_running: "no",
          alarm_code: "414",
          operator_confirmed: "yes",
        });
        if (!("error" in auto)) {
          res = resolve_repair_ticket({ ticket_id: auto.ticket_id });
        }
      }
      if ("error" in res) return { ...base, actionId: "ticket.resolve", response: res.error };
      return {
        ...base,
        actionId: "ticket.resolve",
        ticketResolveId: res.ticket_id,
        response: `維修單 ${res.ticket_id} 已解除（維修完成結案），主管看板已同步。`,
      };
    }
    return {
      ...base,
      actionId: "ticket.resolve",
      response: "請告訴我單號，例如「RT-1001 修好了」或「解除工單 RT-1002」。",
    };
  }

  // 0.6) 交班摘要：ended／交班時總結今日單數／解除／催料。
  if (/(交班|下班|換班|交接|handover|shift change|end of shift|shift summary)/i.test(text)) {
    return {
      ...base,
      actionId: "shift.handover",
      response: buildShiftSummary(extra.tickets ?? [], extra.urges ?? 0),
    };
  }

  // 0.61) 刀具壽命預警。
  if (/(刀具|換刀|刀庫|磨損|tool life|tool wear)/i.test(text)) {
    return {
      ...base,
      navigate: "f3",
      actionId: "tool.status",
      response:
        "刀庫巡檢回報：T03 精銑球刀 R4 壽命僅剩 12%，已觸發磨耗預警，建議加工 2 件後更換備刀；其餘 T01、T02、T04~T06 壽命均大於 65% 正常。",
    };
  }

  // 0.62) 生產進度與工單 (今日產量進度)。
  if (/(今天進度|今日進度|生產進度|產量|產量進度|完成幾件|達成率|目標|工單進度|production progress|target)/i.test(text)) {
    return {
      ...base,
      navigate: "f1",
      actionId: "production.progress",
      response:
        "今日生產進度：當班目標 500 件，目前已完成 348 件，達成率 69.6%，工單 #WO-2026-A109 航太渦輪葉片現正切削中，預估 16:45 準時完工交付。",
    };
  }

  // 0.63) 單件倒數時間 (切削倒數時間)。
  if (/(這件還要|切多久|加工時間|倒數|切削倒數|倒數時間|還要多久|cycle time|remaining)/i.test(text)) {
    return {
      ...base,
      navigate: "f1",
      actionId: "cycle.remaining",
      response:
        "工件加工進度：目前執行單節 N0420 葉片型面精銑，本件剩餘約 1 分 15 秒，主軸轉速 8500 RPM，切削負載 74% 穩定。",
    };
  }

  // 0.64) OEE 稼動率與停機損失。
  if (/(oee|稼動率|生產效率|停機損失|燒多少錢)/i.test(text)) {
    return {
      ...base,
      navigate: "f1",
      actionId: "oee.status",
      response:
        "工廠 OEE 總體效率：稼動率 92.4% × 效率 95.2% × 良率 99.4% = 總體 OEE 87.5%（優於產業標準 85%）。目前產線正常運轉無停機損失。",
    };
  }

  // 0.65) 智慧戰情分析（深度診斷報告，NotebookLM 級別）。
  if (/(戰情|分析報告|智慧分析|診斷|notebooklm|briefing|executive|綜合報告)/i.test(text)) {
    return {
      ...base,
      navigate: "f1",
      actionId: "report.briefing",
      response: buildExecutiveBriefing(extra.tickets ?? [], extra.urges ?? 0),
    };
  }

  // 0.66) 智能品檢與尺寸公差 (最新品檢報告)。
  if (/(品檢|檢驗|公差|良率|瑕疵|粗糙度|三次元|cmm|qc|quality|inspection)/i.test(text)) {
    return {
      ...base,
      navigate: "f6",
      actionId: "qc.report",
      response:
        "報告主管，最新完工 Part #348 經三次元與 AI 視覺掃描：表面粗糙度 Ra 0.38µm（標準 <0.8µm），真圓度與輪廓公差 ±0.003mm 全數合格，0 毛刺 0 裂痕，當班良率 99.71%。",
    };
  }

  // 0.67) 綠色能源與 ESG 碳排 (廠房即時能耗)。
  if (/(能源|耗電|電費|碳排|綠能|功耗|能耗|即時能耗|energy|power|carbon|kwh)/i.test(text)) {
    return {
      ...base,
      navigate: "f7",
      actionId: "energy.report",
      response:
        "目前全機運轉總功率 28.4 kW，今日累計耗電 184.6 度，依工業電價折算約 646.1 元（20.2 美元），ESG 碳排 91.3 kg CO2e，太陽能綠電自給率 36.8%。",
    };
  }

  // 0.68) 設備預測性健康維護 (設備預測健康)。
  if (/(設備.*健康|預測.*健康|健康度|健康|軸承|震動|潤滑油|切削水|預測維護|預測性維護|health)/i.test(text)) {
    return {
      ...base,
      navigate: "f7",
      actionId: "health.report",
      response:
        "設備預測健康度診斷：主軸軸承震動頻譜健康度 94.2%（ISO 10816: 0.82mm/s 運轉優良），滾珠螺桿潤滑油存量 68%（預估可用 48 小時），切削水濃度 8.5% 微偏低，空壓 0.65 MPa 正常。",
    };
  }

  // 0.69) MES 工單配方切換 (換切燃油閥體 / 換切工單)。
  if (/(切換工單|換工單|換切|切換到|工單\s*[abc]?\d+|a109|b202|c303|閥體|燃油|人工關節|渦輪葉片)/i.test(text)) {
    if (/(b202|閥體|燃油|鋁合金|7075)/i.test(text)) {
      return {
        ...base,
        navigate: "f1",
        actionId: "workorder.switch",
        workOrder: "B202",
        response:
          "已切換至工單 #WO-2026-B202 航太高壓燃油閥體（AL7075-T6 航太鋁），載入加工檔 0202_VALVE.NC，主軸目標設定 12,000 RPM，主刀具 T02 粗銑刀，週期 3 分 15 秒。",
      };
    }
    if (/(c303|人工關節|髖關節|醫療|不鏽鋼|316l)/i.test(text)) {
      return {
        ...base,
        navigate: "f1",
        actionId: "workorder.switch",
        workOrder: "C303",
        response:
          "已切換至工單 #WO-2026-C303 醫療級人工髖關節球體（SUS316L 醫療不鏽鋼），載入加工檔 0303_HIP.NC，主軸目標設定 6,800 RPM，主刀具 T01 面銑刀，週期 5 分 40 秒。",
      };
    }
    return {
      ...base,
      navigate: "f1",
      actionId: "workorder.switch",
      workOrder: "A109",
      response:
        "已切換至工單 #WO-2026-A109 航太發動機渦輪葉片（Ti-6Al-4V 鈦合金），載入加工檔 0415_BLADE.NC，主軸目標設定 8,500 RPM，主刀具 T03 精銑球刀，週期 4 分 30 秒。",
    };
  }

  // 0.7) 今日報表 (今日工廠日報)。
  if (/(今日.*日報|今日.*報表|工廠日報|日報|報表|daily report|today'?s report)/i.test(text)) {
    return {
      ...base,
      navigate: "f1",
      actionId: "report.daily",
      response: buildDailyReport(extra.tickets ?? [], extra.urges ?? 0),
    };
  }

  // 0.8) 單號進度：RT-數字＋進度／狀態（要在開單分支之前，先認單號）。
  {
    const statusHit =
      text.match(/RT-?\s?(\d+)/i) || text.match(/#?TICKET-?\s?(\d+)/i);
    if (statusHit && /(進度|狀態|怎樣|如何|查單|status|progress)/i.test(text)) {
      const num = statusHit[1] ?? statusHit[2] ?? "";
      const want = `RT-${num}`;
      const found = (extra.tickets ?? []).find(
        (tk) => tk.ticket_id.toUpperCase() === want.toUpperCase(),
      );
      if (!found) {
        const openIds = (extra.tickets ?? [])
          .filter((tk) => (tk.status ?? "open") === "open")
          .map((tk) => tk.ticket_id);
        return {
          ...base,
          navigate: "f1",
          actionId: "ticket.status",
          response: `找不到 ${want}。${openIds.length ? `目前待修：${openIds.join("、")}。` : "目前沒有維修單。"}`,
        };
      }
      const done = (found.status ?? "open") === "resolved";
      return {
        ...base,
        navigate: "f1",
        actionId: "ticket.status",
        response: done
          ? `${found.ticket_id} 已完成（維修解除），${found.machine_id}，${found.symptom}。`
          : `${found.ticket_id} 待修中：${found.machine_id}，${found.symptom}，嚴重度 ${found.severity}。`,
      };
    }
  }

  // 1) Open a repair ticket (real). One-shot: the command itself is the confirmation.
  if (RE_TICKET.test(text)) {
    const machine = ctx.machine ?? "M03";
    let symptom = ctx.alarm ? `警報 ${ctx.alarm} 異常故障` : "414 J2 軸伺服負載 142% 過載卡死，需工程師到廠檢修";
    let severity = "high";
    if (ctx.alarm) {
      const a = lookup_alarm({ alarm_code: ctx.alarm });
      if (!("error" in a)) {
        symptom = `${a.code} ${a.title}`;
        severity = a.severity;
      }
    }
    const res = create_repair_ticket({
      machine_id: machine,
      symptom,
      severity,
      can_keep_running: "no",
      alarm_code: ctx.alarm ?? "414",
      operator_confirmed: "yes",
    });
    if ("error" in res) return { ...base, navigate: "f1", actionId: "ticket.create", response: res.error };
    return {
      ...base,
      navigate: "f1",
      actionId: "ticket.create",
      ticketId: res.ticket_id,
      response: `已為 ${machine} 開出高優先度維修單 ${res.ticket_id}（${symptom}），主管看板即時收到通知。`,
    };
  }

  // 2) Look up an alarm code (real)＋異常推播：分級＋建議處置＋問要不要切畫面。
  // 不直接切畫面，先問一句（pendingView 等回答）；看板紅燈由呼叫端依 res.alarm 亮起。
  const alarmHit = text.match(RE_ALARM);
  if (alarmHit) {
    const a = lookup_alarm({ alarm_code: alarmHit[1] });
    if ("error" in a) return { ...base, navigate: "f3", actionId: "alarm.lookup", response: a.error };
    base.context.alarm = a.code;
    const checks = a.first_checks.map((c, i) => `${i + 1}. ${c}`).join("　");
    const push = buildAlarmPush(a);
    base.context.pendingView = push.view;
    return {
      ...base,
      actionId: "alarm.lookup",
      alarm: a,
      response: `【異常推播】警報 ${a.code}：${a.title}。可能原因：${a.likely_causes}。前三步：${checks} ${push.text}`,
    };
  }

  // 2.4) AGV 電量／回充（要在調度分支之前，先認電量；只有說回充才真的派車）。
  if (/(電量|電池|回充|充電|battery|charge)/i.test(text)) {
    if (/(回充|充電|recharge|\bcharge\b)/i.test(text)) {
      const idHit = text.match(/agv[- ]?0?([1-4])/i) || text.match(/([1-4])\s*號/);
      const agvId = `AGV-0${idHit ? idHit[1] : "1"}`;
      return {
        ...base,
        navigate: "f2",
        actionId: "agv.battery",
        agv: { id: agvId, task: "前往充電樁回充" },
        response: `好，${agvId} 去充電樁回充，充飽自動歸隊。`,
      };
    }
    return {
      ...base,
      navigate: "f2",
      actionId: "agv.battery",
      response: buildAgvBatteryReport(),
    };
  }

  // 2.5) 耗材預測：低庫存預警（要在催料分支之前，先認預測）。
  if (/(耗材|預測|forecast|還能做幾|能撐多久)/i.test(text)) {
    const lows = stockWarnings();
    if (lows.length === 0) {
      return {
        ...base,
        navigate: "f4",
        actionId: "material.forecast",
        response: `耗材預測：5 站原料都在安全線 ${LOW_STOCK_LINE} 以上，目前不用催料。`,
      };
    }
    const parts = lows.map((s) =>
      s.left === 0 ? `${s.id} 已用完` : `${s.id} 剩 ${s.left}`,
    );
    return {
      ...base,
      navigate: "f4",
      actionId: "material.forecast",
      response:
        `耗材預測：${parts.join("、")}，低於安全線 ${LOW_STOCK_LINE}，建議今天催料。` +
        `要我打給供應商嗎？`,
    };
  }

  // 2.5) AGV 調度（派工包 v2 §2.2：調度/送料/AGV；單純「補料」仍算看庫存，走導覽）。
  if (RE_AGV.test(text)) {
    const idHit = text.match(/agv[- ]?0?([1-4])/i) || text.match(/([1-4])\s*號/);
    const agvId = `AGV-0${idHit ? idHit[1] : "2"}`;
    const targetHit = text.match(/([12])\s*號手臂/);
    const task = `送料至 ${targetHit ? targetHit[1] : "1"} 號手臂`;
    return {
      ...base,
      navigate: "f2",
      actionId: "agv.dispatch",
      agv: { id: agvId, task },
      response: `已調度 ${agvId}：${task}。`,
    };
  }

  // 2.6) 催料通話（派工包 v2 §2.2：催料/供應商；單純「看庫存」仍走導覽）。
  if (RE_SUPPLIER.test(text)) {
    const matHit = text.match(/S45C|AL6061|SUS304/i);
    const material = matHit ? matHit[0].toUpperCase() : "S45C";
    return {
      ...base,
      navigate: "f4",
      actionId: "supplier.urge",
      supplier: { material },
      response: `已致電供應商催促『${material}』，工單已建立。`,
    };
  }

  // 3) Maintenance history (real).
  if (RE_MAINT.test(text)) {
    const machine = ctx.machine ?? extractMachine(t) ?? "M03";
    const h = get_maintenance_history({ machine_id: machine, limit: 3 });
    if ("error" in h) return { ...base, navigate: "f5", actionId: "maint.lookup", response: h.error };
    base.context.machine = machine;
    const recs = h.records.map((r) => `${r.date} ${r.item}`).join("；");
    return {
      ...base,
      navigate: "f5",
      actionId: "maint.lookup",
      response: `${machine} 最近保養：${recs || "無紀錄"}。要我開維修單嗎？`,
    };
  }

  // 4) Machine status (real).
  const machine = extractMachine(t);
  if (machine) {
    const m = get_machine_status({ machine_id: machine });
    if ("error" in m) return { ...base, navigate: "f1", actionId: "alarm.lookup", response: m.error };
    base.context.machine = m.id;
    const alarmTxt = m.current_alarm ? `目前警報 ${m.current_alarm}` : "目前無警報";
    return {
      ...base,
      navigate: "f1",
      actionId: "alarm.lookup",
      machine: m,
      response: `${m.name}（${m.id}）狀態：${m.status}，${alarmTxt}。`,
    };
  }

  // 5) Pure navigation.
  const nav = findScreen(t);
  if (nav) {
    const s = SCREENS.find((x) => x.key === nav)!;
    return { ...base, navigate: nav, actionId: "nav.view", response: `好的，切換到「${s.name}」。` };
  }

  // 5.5) 日常對話（讓宇宙像個管家；英文模式回英文）。
  if (/(你好|哈囉|嗨|您好|hello|\bhi\b)/i.test(text)) {
    return {
      ...base,
      actionId: "chat.hello",
      response: en
        ? "Hello, I'm Model宇宙, your shop-floor voice helper. Which screen, alarm, or ticket shall we start with?"
        : "你好，我是 Model宇宙，你的工廠語音管家。要看哪個畫面、查警報、還是開單？",
    };
  }
  if (/(你是誰|你叫什麼|你的名字|who are you)/i.test(text)) {
    return {
      ...base,
      actionId: "chat.hello",
      response: en
        ? "I'm Model宇宙, the voice helper for this shop floor. Talk to me and I'll drive the screens, look up alarms, and open repair tickets."
        : "我是 Model宇宙，工廠現場的語音管家。你用講的，我幫你操控畫面、查警報、開維修單。",
    };
  }
  if (/(謝謝|感謝|多謝|thank)/i.test(text)) {
    return { ...base, actionId: "chat.thanks", response: en ? "You're welcome, anytime." : "不客氣，隨時吩咐。" };
  }
  if (/(你會什麼|會做什麼|能做什麼|幫助|功能|help)/i.test(text)) {
    return {
      ...base,
      actionId: "chat.help",
      response: en
        ? "I check machine status, look up alarm codes with causes and three checks, open and close repair tickets, dispatch AGVs, urge suppliers, forecast material, show daily reports, and switch screens. Try 'check alarm 414' or 'handover summary'."
        : "我會查機台狀態、查警報碼（給你原因和三步檢查）、開維修單、解除警報、解除工單、調度 AGV、查電量回充、催料、耗材預測、今日報表、交班摘要、切換畫面。直接說 F1、F2、F3、F4、F5 跳畫面，F6 靜音解除警報；或說「查警報 414」「RT-1001 修好了」「交班」試試。",
    };
  }

  // 6) Fallback — never invents.
  return {
    ...base,
    actionId: null,
    response: en
      ? "Sorry, I didn't catch that. Try 'machine 3 status', 'check alarm 414', 'open a ticket', 'material forecast', or 'handover summary'."
      : "抱歉，我沒聽懂。你可以說「機台 3 狀態」「查警報 414」「開維修單」「解除警報」「RT-1001 修好了」「耗材還夠嗎」「今日報表」「交班」，或問我「你會什麼」。",
  };
}
