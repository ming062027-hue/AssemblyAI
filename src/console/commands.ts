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
  type Machine,
  type Alarm,
} from "@/tools/handlers";

export type ScreenKey = "f1" | "f2" | "f3" | "f4" | "f5";

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
  { key: "f5", code: "F5", name: "AI 通話紀錄", en: "Call Log", keywords: ["通話", "紀錄", "外部", "採購", "報修紀錄", "電話", "call", "log"] },
];

export interface CommandContext {
  machine: string | null;
  alarm: string | null;
}
export const emptyContext = (): CommandContext => ({ machine: null, alarm: null });

export interface CommandResult {
  navigate: ScreenKey | null;
  response: string; // Model宇宙 reply (text now, real TTS in Phase 2)
  context: CommandContext;
  ticketId?: string; // set when a real ticket was created (board refresh)
  alarm?: Alarm; // set when an alarm was looked up (show on F3)
  machine?: Machine; // set when a machine status was looked up
}

/** Example chips shown in the UI (bilingual) so 大銘 can click to demo. */
export const PRESET_COMMANDS: string[] = [
  "機台 3 狀態",
  "查警報 414",
  "開維修單",
  "看手臂數據",
  "看主管看板",
  "查警報 9999",
];

const RE_TICKET = /(開.*單|維修單|報修|開單|repair|ticket)/i;
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

export function interpret(raw: string, ctx: CommandContext): CommandResult {
  const text = String(raw ?? "").trim();
  const base: CommandResult = { navigate: null, response: "", context: { ...ctx } };
  if (!text) return { ...base, response: "我在聽，請說指令。" };
  const t = text.toLowerCase();

  // 1) Open a repair ticket (real). One-shot: the command itself is the confirmation.
  if (RE_TICKET.test(text)) {
    const machine = ctx.machine ?? "M03";
    let symptom = "Operator reported an issue by voice";
    let severity = "medium";
    if (ctx.alarm) {
      const a = lookup_alarm({ alarm_code: ctx.alarm });
      if (!("error" in a)) {
        symptom = a.title;
        severity = a.severity;
      }
    }
    const res = create_repair_ticket({
      machine_id: machine,
      symptom,
      severity,
      can_keep_running: "no",
      alarm_code: ctx.alarm ?? undefined,
      operator_confirmed: "yes",
    });
    if ("error" in res) return { ...base, navigate: "f1", response: res.error };
    return {
      ...base,
      navigate: "f1",
      ticketId: res.ticket_id,
      response: `已為 ${machine} 開出維修單 ${res.ticket_id}，主管看板即時收到。`,
    };
  }

  // 2) Look up an alarm code (real).
  const alarmHit = text.match(RE_ALARM);
  if (alarmHit) {
    const a = lookup_alarm({ alarm_code: alarmHit[1] });
    if ("error" in a) return { ...base, navigate: "f3", response: a.error };
    base.context.alarm = a.code;
    const checks = a.first_checks.map((c, i) => `${i + 1}. ${c}`).join("　");
    return {
      ...base,
      navigate: "f3",
      alarm: a,
      response: `警報 ${a.code}：${a.title}。可能原因：${a.likely_causes}。前三步：${checks}`,
    };
  }

  // 3) Maintenance history (real).
  if (RE_MAINT.test(text)) {
    const machine = ctx.machine ?? extractMachine(t) ?? "M03";
    const h = get_maintenance_history({ machine_id: machine, limit: 3 });
    if ("error" in h) return { ...base, navigate: "f5", response: h.error };
    base.context.machine = machine;
    const recs = h.records.map((r) => `${r.date} ${r.item}`).join("；");
    return {
      ...base,
      navigate: "f5",
      response: `${machine} 最近保養：${recs || "無紀錄"}。要我開維修單嗎？`,
    };
  }

  // 4) Machine status (real).
  const machine = extractMachine(t);
  if (machine) {
    const m = get_machine_status({ machine_id: machine });
    if ("error" in m) return { ...base, navigate: "f1", response: m.error };
    base.context.machine = m.id;
    const alarmTxt = m.current_alarm ? `目前警報 ${m.current_alarm}` : "目前無警報";
    return {
      ...base,
      navigate: "f1",
      machine: m,
      response: `${m.name}（${m.id}）狀態：${m.status}，${alarmTxt}。`,
    };
  }

  // 5) Pure navigation.
  const nav = findScreen(t);
  if (nav) {
    const s = SCREENS.find((x) => x.key === nav)!;
    return { ...base, navigate: nav, response: `好的，切換到「${s.name}」。` };
  }

  // 5.5) 日常對話（讓宇宙像個管家）。
  if (/(你好|哈囉|嗨|您好|hello|\bhi\b)/i.test(text)) {
    return { ...base, response: "你好，我是 Model宇宙，你的工廠語音管家。要看哪個畫面、查警報、還是開單？" };
  }
  if (/(你是誰|你叫什麼|你的名字|who are you)/i.test(text)) {
    return { ...base, response: "我是 Model宇宙，工廠現場的語音管家。你用講的，我幫你操控畫面、查警報、開維修單。" };
  }
  if (/(謝謝|感謝|多謝|thank)/i.test(text)) {
    return { ...base, response: "不客氣，隨時吩咐。" };
  }
  if (/(你會什麼|會做什麼|能做什麼|幫助|功能|help)/i.test(text)) {
    return { ...base, response: "我會查機台狀態、查警報碼（給你原因和三步檢查）、開維修單、切換 F1 到 F5 畫面。說「機台 3 狀態」「查警報 414」「開維修單」「看手臂數據」試試。" };
  }

  // 6) Fallback — never invents.
  return {
    ...base,
    response: "抱歉，我沒聽懂。你可以說「機台 3 狀態」「查警報 414」「開維修單」「看手臂數據」，或問我「你會什麼」。",
  };
}
