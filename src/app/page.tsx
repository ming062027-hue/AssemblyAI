"use client";

// 首頁＝ CNC-640 淺色控制台（大銘定稿）＋ Model宇宙 語音管家（取代原本假語音）。
// - 五站放大、內容照大銘 2026-09-20 規格（A/B 碼頭、AGV 明細、手臂代號 AE800/AF800…）。
// - 伺服軸監控＋AI CLOSED-LOOP 兩塊：平常不出現，警報觸發（isAlarm）才跳出。
// - 右下角 Model宇宙：真的查警報/開單/用講的跳畫面（重用 src/console/commands、src/board）。
//   Phase 1 用打字/膠囊模擬語音；Phase 2 換成真 AssemblyAI，動作層不動。

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_VERSION } from "@/config/site";
import {
  interpret,
  emptyContext,
  buildStartupReport,
  type CommandContext,
} from "@/console/commands";
import { subscribe, list, type Ticket } from "@/board/ticketStore";
import { useVoiceAgentBridge } from "@/voice/useVoiceAgentBridge";
import { useWakeWordListener, playWakeChime } from "@/voice/wakeWord";
import {
  useFactoryHeartbeat,
  formatSecondsToMS,
} from "@/console/factoryHeartbeat";
import {
  get_machine_status,
  lookup_alarm,
  get_maintenance_history,
  create_repair_ticket,
  resolve_repair_ticket,
} from "@/tools/handlers";

declare global {
  interface Window {
    lucide?: { createIcons: () => void };
  }
}

type ViewKey = "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7";

const TAB_NAMES: Record<ViewKey, string> = {
  f1: "F1 流程監控總覽",
  f2: "F2 AGV 車隊手動調度",
  f3: "F3 手臂軸向數據分析",
  f4: "F4 原料庫存與補叫料",
  f5: "F5 AI 外部通訊錄明細",
  f6: "F6 智能品檢與尺寸公差",
  f7: "F7 綠色能源與設備健康",
};

const TAB_NAMES_EN: Record<ViewKey, string> = {
  f1: "F1 Main Process Overview",
  f2: "F2 AGV Fleet Manual Dispatch",
  f3: "F3 Robot Arm & Axis Telemetry",
  f4: "F4 Raw Material Inventory & Urge",
  f5: "F5 AI Outbound Call & Tickets",
  f6: "F6 AI Vision & CMM QC Inspection",
  f7: "F7 ESG Energy & Machine Health",
};

interface SupplierCallRecord {
  id: string;
  target: string;
  targetEn?: string;
  duration: string;
  durationEn?: string;
  time: string;
  aiSay: string;
  aiSayEn?: string;
  respSay: string;
  respSayEn?: string;
  po: string;
  poEn?: string;
  type: "repair" | "material";
}

interface QuickActionItem {
  id: string;
  nameZh: string;
  nameEn: string;
  cmdZh: string;
  cmdEn: string;
  tag: string;
  tagClass: string;
  btnClass: string;
  descZh: string;
  descEn: string;
}

const QUICK_ACTIONS: QuickActionItem[] = [
  {
    id: "briefing",
    nameZh: "📊 智慧戰情報告",
    nameEn: "📊 Executive Briefing",
    cmdZh: "智慧戰情報告",
    cmdEn: "executive briefing",
    tag: "F1",
    tagClass: "text-indigo-500",
    btnClass: "bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border-indigo-200",
    descZh: "智慧戰情報告（診斷 5 站、瓶頸、伺服負載與物料）",
    descEn: "Executive briefing: 5-station telemetry, bottleneck, load & stock",
  },
  {
    id: "qc",
    nameZh: "🔬 最新品檢報告",
    nameEn: "🔬 Quality Inspection",
    cmdZh: "最新品檢報告",
    cmdEn: "quality inspection report",
    tag: "F6",
    tagClass: "text-purple-500",
    btnClass: "bg-purple-50 hover:bg-purple-100 text-purple-900 border-purple-200",
    descZh: "最新品檢報告（CMM 三次元測量與 AI 瑕疵）",
    descEn: "CMM 3D metrology, surface roughness Ra & AI defect analysis",
  },
  {
    id: "energy",
    nameZh: "⚡ 廠房即時能耗",
    nameEn: "⚡ Real-time Energy",
    cmdZh: "廠房即時能耗",
    cmdEn: "factory energy consumption",
    tag: "F7",
    tagClass: "text-emerald-500",
    btnClass: "bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-200",
    descZh: "廠房即時能耗（功率、累計度數、電費、碳排）",
    descEn: "Active load kW, power cost & ESG carbon footprint",
  },
  {
    id: "health",
    nameZh: "🛡️ 設備預測健康",
    nameEn: "🛡️ Predictive Health",
    cmdZh: "設備預測健康",
    cmdEn: "machine health diagnostics",
    tag: "F7",
    tagClass: "text-cyan-500",
    btnClass: "bg-cyan-50 hover:bg-cyan-100 text-cyan-900 border-cyan-200",
    descZh: "設備預測健康（主軸軸承頻譜、潤滑油、切削水）",
    descEn: "Spindle bearing vibration, lube oil & coolant concentration",
  },
  {
    id: "workorder",
    nameZh: "🔄 換切燃油閥體",
    nameEn: "🔄 Switch Fuel Valve",
    cmdZh: "換切燃油閥體",
    cmdEn: "switch to work order B202 fuel valve",
    tag: "MES",
    tagClass: "text-blue-500",
    btnClass: "bg-blue-50 hover:bg-blue-100 text-blue-900 border-blue-200",
    descZh: "換切工單 B202 航太高壓燃油閥體",
    descEn: "Switch to Work Order B202 Aero High-Pressure Fuel Valve",
  },
  {
    id: "alarm",
    nameZh: "🔍 查 414 警報",
    nameEn: "🔍 Check Alarm 414",
    cmdZh: "查 414 警報",
    cmdEn: "check alarm 414",
    tag: "ALARM",
    tagClass: "text-rose-600",
    btnClass: "bg-rose-50 hover:bg-rose-100 text-rose-900 border-rose-300",
    descZh: "查詢 414 警報原因與排除步驟（啟動故障演練連鎖）",
    descEn: "Lookup alarm 414 causes & 3-step troubleshooting sequence",
  },
  {
    id: "nav_arm",
    nameZh: "🦾 F3 手臂軸向",
    nameEn: "🦾 F3 Robot Arm",
    cmdZh: "F3 手臂軸向",
    cmdEn: "switch to screen F3 robot arm",
    tag: "F3",
    tagClass: "text-slate-500",
    btnClass: "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300",
    descZh: "查看 F3 機械手臂 6 軸扭力與刀庫",
    descEn: "View Robot Arm 6-axis torque telemetry & tool magazine",
  },
  {
    id: "ticket_create",
    nameZh: "📝 開立維修單",
    nameEn: "📝 Open Ticket",
    cmdZh: "開立維修單",
    cmdEn: "open a repair ticket",
    tag: "DISPATCH",
    tagClass: "text-amber-600",
    btnClass: "bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300",
    descZh: "為 M03 開立高優先度維修單並同步主管看板",
    descEn: "Dispatch high-priority repair ticket to supervisor dashboard",
  },
  {
    id: "alarm_clear",
    nameZh: "🔕 解除警報",
    nameEn: "🔕 Clear Alarm",
    cmdZh: "解除警報",
    cmdEn: "clear alarm reset",
    tag: "RESET",
    tagClass: "text-rose-700",
    btnClass: "bg-rose-100 hover:bg-rose-200 text-rose-950 border-rose-400",
    descZh: "解除警報（04 加工區恢復運作、警報面板收回）",
    descEn: "Reset alarm, restore machining zone 04 & clear alert panel",
  },
  {
    id: "ticket_resolve",
    nameZh: "✅ 解除 RT-1001",
    nameEn: "✅ Resolve RT-1001",
    cmdZh: "解除 RT-1001",
    cmdEn: "resolve ticket RT-1001",
    tag: "RESOLVE",
    tagClass: "text-emerald-600",
    btnClass: "bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300",
    descZh: "維修完工解除 RT-1001 並結案",
    descEn: "Mark maintenance complete for ticket RT-1001 and close loop",
  },
  {
    id: "daily_report",
    nameZh: "📋 今日工廠日報",
    nameEn: "📋 Daily Report",
    cmdZh: "今日工廠日報",
    cmdEn: "today factory daily report",
    tag: "REPORT",
    tagClass: "text-slate-500",
    btnClass: "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300",
    descZh: "今日工廠日報（開單、結案、催料、低庫存提醒）",
    descEn: "Daily factory summary: tickets, urges, and inventory warnings",
  },
  {
    id: "tool_wear",
    nameZh: "🗡️ 刀具磨損預警",
    nameEn: "🗡️ Tool Wear",
    cmdZh: "刀具磨損預警",
    cmdEn: "tool wear status alert",
    tag: "TOOL",
    tagClass: "text-amber-600",
    btnClass: "bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300",
    descZh: "刀具磨損狀態與更換備刀預警",
    descEn: "Spindle tool wear telemetry & standby tool replacement warning",
  },
  {
    id: "production",
    nameZh: "🎯 今日產量進度",
    nameEn: "🎯 Production Target",
    cmdZh: "今日產量進度",
    cmdEn: "today production progress",
    tag: "PROD",
    tagClass: "text-slate-500",
    btnClass: "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300",
    descZh: "今日生產進度與當班達成率",
    descEn: "Shift production count and completion rate vs target 500 pcs",
  },
  {
    id: "cycle",
    nameZh: "⏱️ 切削倒數時間",
    nameEn: "⏱️ Cycle Time",
    cmdZh: "切削倒數時間",
    cmdEn: "cycle remaining time",
    tag: "CYCLE",
    tagClass: "text-slate-500",
    btnClass: "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300",
    descZh: "當前工件切削剩餘倒數時間",
    descEn: "Remaining machining cycle time for active NC block",
  },
  {
    id: "oee",
    nameZh: "📈 OEE與停機損失",
    nameEn: "📈 OEE & Downtime",
    cmdZh: "OEE與停機損失",
    cmdEn: "oee status and downtime loss",
    tag: "OEE",
    tagClass: "text-slate-500",
    btnClass: "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300",
    descZh: "查詢工廠 OEE 總體設備效率",
    descEn: "Overall Equipment Effectiveness & real-time downtime cost rate",
  },
];

/** 🔊 Web Audio API 合成真實電話撥號 (DTMF) ＋ 振鈴 (Ringback Tone) 音效 */
function playPhoneCallAudio() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // 1. DTMF 觸控撥號雙音頻 (3 個電話號碼按鍵聲)
    const dtmfPairs = [
      [770, 1336], // 按鍵 5
      [852, 1209], // 按鍵 7
      [941, 1477], // 按鍵 #
    ];
    dtmfPairs.forEach(([f1, f2], idx) => {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.frequency.value = f1;
      osc2.frequency.value = f2;
      const startT = now + idx * 0.14;
      gain.gain.setValueAtTime(0, startT);
      gain.gain.linearRampToValueAtTime(0.12, startT + 0.02);
      gain.gain.setValueAtTime(0.12, startT + 0.08);
      gain.gain.linearRampToValueAtTime(0, startT + 0.1);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(startT);
      osc2.start(startT);
      osc1.stop(startT + 0.11);
      osc2.stop(startT + 0.11);
    });

    // 2. 電信標準回鈴音 (440Hz + 480Hz 雙音頻電話接通嘟聲)
    const ringT = now + 0.48;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const ringGain = ctx.createGain();
    oscA.frequency.value = 440;
    oscB.frequency.value = 480;
    ringGain.gain.setValueAtTime(0, ringT);
    ringGain.gain.linearRampToValueAtTime(0.15, ringT + 0.04);
    ringGain.gain.setValueAtTime(0.15, ringT + 0.75);
    ringGain.gain.linearRampToValueAtTime(0, ringT + 0.85);
    oscA.connect(ringGain);
    oscB.connect(ringGain);
    ringGain.connect(ctx.destination);
    oscA.start(ringT);
    oscB.start(ringT);
    oscA.stop(ringT + 0.9);
    oscB.stop(ringT + 0.9);
  } catch (err) {
    console.warn("Web Audio telephone effect failed:", err);
  }
}

// 派工包 v2 §2.1 中央狀態：五站子項各自燈號（§3 表）。
// green 正常 / blue 搬運中（補料中＝藍）/ amber 待命 / red 警報
type Light = "green" | "blue" | "amber" | "red";
const LIGHT_DOT: Record<Light, string> = {
  green: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};
function stationBadge(lights: Light[], isEn?: boolean): { label: string; cls: string } {
  if (lights.includes("red")) return { label: isEn ? "ALARM" : "警報", cls: "text-rose-700" };
  if (lights.includes("blue")) return { label: isEn ? "TRANSIT" : "搬運中", cls: "text-blue-700" };
  if (lights.includes("amber")) return { label: isEn ? "STANDBY" : "待命中", cls: "text-amber-700" };
  return { label: isEn ? "NORMAL" : "正常", cls: "text-emerald-700" };
}
function SubDot({ light }: { light: Light }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${LIGHT_DOT[light]}`}
      aria-label={light}
    />
  );
}

// 語音催料的材料代號→中文品名（跟 F4 表格一致）。
function supplierName(code: string): string {
  const c = code.toUpperCase();
  if (c.includes("AL6061")) return "AL6061 方棒";
  if (c.includes("SUS304")) return "SUS304 棒材";
  return "S45C 圓棒材";
}

// 智慧格式化工單症狀，支援中英切換（包含既有與歷史工單）
function formatSymptom(symptom: string, lang: "zh" | "en"): string {
  if (lang !== "en") return symptom;
  if (symptom.includes("414 J2 軸伺服負載 142% 過載卡死") || symptom.includes("需工程師到廠檢修")) {
    return "414 J2 servo load 142% overload stall, field engineer inspection required";
  }
  if (symptom.includes("414 軸過載") || symptom.includes("警報 414")) {
    return "Alarm 414 Axis Overload Stall";
  }
  if (symptom.includes("異常故障")) {
    return symptom.replace(/警報\s*(\w+)\s*異常故障/, "Alarm $1 Fault");
  }
  return symptom;
}

// 瀏覽器內建語音辨識（webkitSpeechRecognition）沒有內建 TS 型別，這裡給最小型別。
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export default function Home() {
  const [view, setView] = useState<ViewKey>("f1");
  const [isAlarm, setIsAlarm] = useState(false); // 平常無警報，Model宇宙 查到警報才亮
  const [clock, setClock] = useState("13:15:00");
  const [agvMsg, setAgvMsg] = useState<string | null>(null);
  const [supplierMsg, setSupplierMsg] = useState<string | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🏭 工廠真實心跳動態引擎（G-code 滾動、週期倒數、OEE、停機損失計價、刀具磨損、三大工單、故障演練、品檢、綠能）
  const heartbeat = useFactoryHeartbeat(isAlarm, (alarm) => setIsAlarm(alarm));
  const [wakeEnabled, setWakeEnabled] = useState(true);

  // 🌐 國際競賽雙語切換 (zh: 繁體中文現場 / en: International Competition English)
  const [langMode, setLangMode] = useState<"zh" | "en">("zh");

  // 📞 外部 AI 催料通話狀態 (idle | calling | done)
  const [supplierCallStatus, setSupplierCallStatus] = useState<"idle" | "calling" | "done">("idle");
  const [supplierCalls, setSupplierCalls] = useState<SupplierCallRecord[]>([
    {
      id: "TICKET-8902",
      target: "機械手臂原廠緊急維修窗口",
      targetEn: "Robot Arm OEM Emergency Service Desk",
      duration: "通話 52 秒",
      durationEn: "Call 52s",
      time: "2026-09-19 13:10:15",
      aiSay: "2號手臂發生 E-402 伺服負載 142% 警報，現場無障礙物，判定內部卡料需工程師到廠。",
      aiSayEn: "Robot Arm #2 triggered E-402 Servo Overload at 142%. Workspace clear; internal mechanical jam diagnosed, field engineer requested.",
      respSay: "工單已成立，已指派工程師攜帶備品，預計 15:00 前抵達。",
      respSayEn: "Ticket confirmed. Field engineer dispatched with spare parts, ETA before 15:00.",
      po: "工單編號：#TICKET-8902 (預約確認)",
      poEn: "Ticket ID: #TICKET-8902 (Confirmed)",
      type: "repair",
    },
    {
      id: "PO-20260919-01",
      target: "晉茂鋼鐵業務窗口",
      targetEn: "Jinmao Steel Sales Desk",
      duration: "通話 38 秒",
      durationEn: "Call 38s",
      time: "2026-09-19 12:45:00",
      aiSay: "李經理，S45C Ø50 圓棒庫存已跌破安全線，請依協議緊急配送 200 支。",
      aiSayEn: "Manager Li, S45C Ø50 bar stock dropped below safety line. Please expedite delivery of 200 pcs per SLA.",
      respSay: "有現貨，已排明日第一班車送達。",
      respSayEn: "In stock. Scheduled for first priority truck delivery tomorrow morning.",
      po: "EDI 採購單：#PO-20260919-01 (已出單)",
      poEn: "EDI Purchase Order: #PO-20260919-01 (Issued)",
      type: "material",
    },
  ]);

  // Model宇宙 語音管家
  const [mvListening, setMvListening] = useState(false);
  const [mvDraft, setMvDraft] = useState("");
  const [mvCtx, setMvCtx] = useState<CommandContext>(emptyContext());
  const [mvReply, setMvReply] = useState(
    "我是 Model宇宙，正在開機巡檢（掃 5 站＋庫存＋待修單），等一下跟你報告。",
  );
  const [urgeCount, setUrgeCount] = useState(0); // 本次開機累計催料次數（交班摘要用）
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [voiceOn, setVoiceOn] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);

  // Live vs Mock mode settings
  const [liveModeWanted, setLiveModeWanted] = useState(false);
  const [passcode, setPasscode] = useState("414");
  const [showConfig, setShowConfig] = useState(false);

  // Model宇宙 常駐浮層：平時只剩球，對話框講話時才彈出、說完自動收回。
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // orbPos=null＝預設右下角；拖曳後記住座標，放開停留在該處。
  const [orbPos, setOrbPos] = useState<{ x: number; y: number } | null>(null);
  const floatRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);

  // 對話框：打開後 10 秒沒新訊息自動收回，只剩球。
  const openDialog = useCallback(() => {
    setDialogOpen(true);
    if (dialogTimer.current) clearTimeout(dialogTimer.current);
    dialogTimer.current = setTimeout(() => setDialogOpen(false), 10000);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    if (dialogTimer.current) clearTimeout(dialogTimer.current);
  }, []);

  // Hook up official Voice Agent Bridge
  const bridge = useVoiceAgentBridge({
    isDev: process.env.NODE_ENV !== "production",
    mockUrl: "ws://localhost:8787",
    onToolCall: async (name, args) => {
      openDialog();
      if (name === "switch_console_view") {
        const v = String(args.view ?? "f1").toLowerCase() as ViewKey;
        if (["f1", "f2", "f3", "f4", "f5", "f6", "f7"].includes(v)) {
          setView(v);
          return { success: true, active_view: v, view_name: TAB_NAMES[v] };
        }
        return { error: `Invalid view: ${String(args.view)}` };
      }
      if (name === "clear_machine_alarm") {
        setIsAlarm(false);
        setMvCtx(emptyContext());
        heartbeat.injectFault("none");
        return { success: true, message: "Alarm cleared. Machine returned to normal." };
      }
      if (name === "lookup_alarm") {
        const res = lookup_alarm({
          alarm_code: String(args.alarm_code ?? ""),
          machine_id: args.machine_id ? String(args.machine_id) : undefined,
        });
        if (!("error" in res)) {
          setIsAlarm(true);
          setView("f1");
        }
        return res as unknown as Record<string, unknown>;
      }
      if (name === "get_machine_status") {
        return get_machine_status({ machine_id: String(args.machine_id ?? "M03") }) as unknown as Record<string, unknown>;
      }
      if (name === "get_maintenance_history") {
        return get_maintenance_history({
          machine_id: String(args.machine_id ?? "M03"),
          limit: typeof args.limit === "number" ? args.limit : 3,
        }) as unknown as Record<string, unknown>;
      }
      if (name === "create_repair_ticket") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = create_repair_ticket(args as any);
        setTickets(list());
        return res as unknown as Record<string, unknown>;
      }
      if (name === "resolve_repair_ticket") {
        const res = resolve_repair_ticket({ ticket_id: String(args.ticket_id ?? "") });
        setTickets(list());
        return res as unknown as Record<string, unknown>;
      }
      if (name === "end_conversation") {
        return { success: true };
      }
      return { error: `Unknown tool ${name}` };
    },
    onSessionReady: () => {
      openDialog();
    },
  });

  // 宇宙開口講話（瀏覽器內建 TTS，免費，固定 zh-TW 女聲、正常語速 rate=1.0；
  // 英文模式改用 en-US 聲音，語速一樣 1.0）。
  const speak = useCallback(
    (text: string, lang: "zh" | "en" = "zh") => {
      if (!voiceOn || typeof window === "undefined" || !window.speechSynthesis) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        if (lang === "en") {
          u.lang = "en-US";
          u.rate = 1.0;
          const pool = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
          const pick =
            pool.find((v) => /female|google us english|samantha|zira/i.test(v.name)) ??
            pool.find((v) => /google/i.test(v.name)) ??
            pool[0];
          if (pick) u.voice = pick;
        } else {
          u.lang = "zh-TW";
          u.rate = 1.0;
          const zh = voices.filter((v) => v.lang.toLowerCase().startsWith("zh"));
          const pool = zh.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("zh-tw")).length
            ? zh.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("zh-tw"))
            : zh;
          const female =
            pool.find((v) => /女|female|mei-?jia|ting|yun|hsiao|ying|lin/i.test(v.name)) ??
            pool.find((v) => /google/i.test(v.name)) ??
            pool[0];
          if (female) u.voice = female;
        }
        window.speechSynthesis.speak(u);
      } catch {
        // TTS 失敗不致命
      }
    },
    [voiceOn],
  );

  useEffect(() => {
    const id = setInterval(() => {
      setClock(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => subscribe(setTickets), []);

  useEffect(
    () => () => {
      if (msgTimer.current) clearTimeout(msgTimer.current);
      if (dialogTimer.current) clearTimeout(dialogTimer.current);
    },
    [],
  );

  const refreshIcons = useCallback(() => {
    window.lucide?.createIcons();
  }, []);

  useEffect(() => {
    refreshIcons();
  }, [view, mvListening, isAlarm, tickets, bridge.status, refreshIcons]);

  useEffect(() => {
    if (bridge.lastAgentSay) {
      openDialog();
      // 僅在純英文語音代理模式且本地未發聲時才播報英文，避免與中文語音雙重混音
      if (voiceOn && !bridge.isLiveMode && mvCtx.lang === "en") {
        speak(bridge.lastAgentSay, "en");
      }
    }
  }, [bridge.lastAgentSay, bridge.isLiveMode, voiceOn, speak, openDialog, mvCtx.lang]);

  useEffect(() => {
    if (bridge.lastUserSay) {
      setMvDraft(bridge.lastUserSay);
      openDialog();
    }
  }, [bridge.lastUserSay, openDialog]);

  const switchTab = useCallback((key: ViewKey) => setView(key), []);

  const dispatchAgv = useCallback((id: string, task: string) => {
    setAgvMsg(`[調度完成] ${id} 收到指令：『${task}』。`);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setAgvMsg(null), 3500);
  }, []);

  const callSupplierManual = useCallback(
    (mat: string) => {
      // 1. 播放真實電話撥號 (DTMF) ＋ 雙音頻振鈴音效 (Web Audio API)
      playPhoneCallAudio();
      setSupplierCallStatus("calling");
      setUrgeCount((n) => n + 1);

      const isEn = langMode === "en";
      const msg = isEn
        ? `Outbound call to Jinmao Steel for '${mat}' connected. Supplier confirmed 20 pcs dispatched, ETA 14:30. Expedited PO created.`
        : `正在致電晉茂鋼鐵業務窗口催促『${mat}』... 供應商確認現貨 20 支裝車出發，預計今日 14:30 前送達，已成立急件採購工單！`;

      setSupplierMsg(msg);
      setMvReply(msg);
      speak(msg, langMode);
      openDialog();

      // 2. 接通交談完成，切換狀態並寫入 F5 通話日誌
      window.setTimeout(() => {
        setSupplierCallStatus("done");
        const poNum = `#PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-0${urgeCount + 1}`;
        setSupplierCalls((prev) => [
          {
            id: poNum,
            target: "晉茂鋼鐵業務窗口 (AI自動催料)",
            targetEn: "Jinmao Steel Outbound Supply (AI Auto-Urge)",
            duration: "通話 32 秒",
            durationEn: "Call 32s",
            time: new Date().toLocaleTimeString(),
            aiSay: `AI:「晉茂鋼鐵您好，CNC-640 目前 S45C Ø50 圓棒庫存僅剩 35 支，請依協議急件配送 20 支。」`,
            aiSayEn: `AI: "Emergency stock replenishment: CNC-640 S45C bar inventory critical at 35 pcs. Need expedited delivery of 20 pcs."`,
            respSay: `供應商:「收到！倉庫現貨已有 20 支裝車，預計下午 14:30 前專車直達工廠碼頭。」`,
            respSayEn: `Supplier: "Received! 20 pcs loaded on priority truck, ETA 14:30 at factory dock."`,
            po: `EDI 採購單：${poNum} (已出單配送)`,
            poEn: `Expedited PO: ${poNum} (Dispatched)`,
            type: "material",
          },
          ...prev,
        ]);
      }, 1200);

      if (msgTimer.current) clearTimeout(msgTimer.current);
      msgTimer.current = setTimeout(() => setSupplierMsg(null), 6000);
    },
    [langMode, urgeCount, speak, openDialog],
  );

  // 派工包 v2 §4：解除警報只有這一個函式。
  // 語音「解除警報」＋警報面板按鈕＋F6 都接它：面板收回、04 轉正常、F3 的 J2 142% 一起清除。
  // 語音上下文的 alarm 也清空，下一句「開維修單」不會再沿用舊警報。
  const clearAlarm = useCallback(() => {
    setIsAlarm(false);
    heartbeat.injectFault("none");
    setMvCtx(emptyContext());
    const isEn = langMode === "en";
    const msg = isEn
      ? "Alarm cleared. Machining Station 04 returned to normal, alert panel closed."
      : "警報已解除，04 加工區恢復正常，警報面板已收回。";
    setMvReply(msg);
    speak(msg, langMode);
    openDialog();
    if (bridge.status === "listening" || bridge.status === "speaking" || bridge.status === "thinking") {
      bridge.sendSay("clear machine alarm");
    }
  }, [langMode, speak, openDialog, bridge, heartbeat]);

  const runModelCommand = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      // 看板即時狀態傳進 interpret：支援中英雙語
      const isEn = langMode === "en";
      const res = interpret(t, mvCtx, { tickets: list(), urges: urgeCount }, isEn);
      setMvCtx(res.context);
      setMvReply(res.response);
      speak(res.response, langMode);
      if (res.clearAlarm) {
        setIsAlarm(false); // 跟按鈕/F8 同一個效果
        heartbeat.injectFault("none");
      } else if (res.alarm) {
        setIsAlarm(true); // 異常推播：紅球＋警報面板跳出＋回話問切畫面
        heartbeat.injectFault("414"); // 真正的 414 故障演練連鎖啟動！
        setView("f1"); // 警報 → 讓總覽亮起來（站別 04＋伺服＋CLOSED-LOOP）
      } else if (res.navigate) {
        setView(res.navigate);
      }
      if (res.workOrder) {
        heartbeat.switchWorkOrder(res.workOrder);
      }
      if (res.agv) dispatchAgv(res.agv.id, res.agv.task);
      if (res.supplier) callSupplierManual(supplierName(res.supplier.material));
      if (res.ticketId || res.ticketResolveId) setTickets(list()); // 同分頁強制刷新看板
      setMvDraft("");
      setMvListening(false);
      openDialog(); // 講完彈出對話框，10 秒後自動收回
    },
    [langMode, mvCtx, urgeCount, speak, openDialog, dispatchAgv, callSupplierManual, heartbeat],
  );

  const toggleVoiceSession = useCallback(async () => {
    openDialog();
    if (bridge.status === "idle" || bridge.status === "ended" || bridge.status === "error") {
      await bridge.startCall(passcode, liveModeWanted);
    } else {
      bridge.endCall();
    }
  }, [bridge, passcode, liveModeWanted, openDialog]);

  const sendQuick = useCallback(
    (txt: string) => {
      const line = txt.trim();
      if (!line) return;
      openDialog();
      // 1. 本地 CNC-640 控制台介面立即執行因應對的事件
      runModelCommand(line);
      // 2. 若語音 Bridge 在線，同步送出文字給 AssemblyAI / Mock-Agent
      if (bridge.status === "listening" || bridge.status === "speaking" || bridge.status === "thinking") {
        bridge.sendSay(line);
      }
    },
    [bridge, openDialog, runModelCommand],
  );

  // 🎙️ 免接觸「嘿宇宙」/「宇宙」喚醒監聽（現場黑手免觸摸螢幕，Siri 級無感體驗）
  useWakeWordListener({
    enabled: wakeEnabled && !mvListening,
    onWake: () => {
      window.speechSynthesis?.cancel();
      openDialog();
      const msg = "我在，請說！";
      setMvReply(msg);
      speak(msg, "zh");
    },
    onCommand: (cmd) => {
      window.speechSynthesis?.cancel();
      openDialog();
      sendQuick(cmd);
    },
  });

  // 開機巡檢：載入後自動掃 5 站＋庫存＋待修單，宇宙開場報告＋問從哪開始。
  // 延遲 1.5 秒等 TTS 聲音載入；警報站（M03）存在時直接亮紅燈＋推播。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const open = list().filter((tk) => (tk.status ?? "open") === "open").length;
      const r = buildStartupReport(open);
      setMvReply(r.text);
      speak(r.text, "zh");
      if (r.hasAlarm) {
        setIsAlarm(true);
        setView("f1");
      }
      openDialog();
    }, 1500);
    return () => window.clearTimeout(timer);
    // 只跑一次：開機巡檢。speak/openDialog 是 stable callback。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 點麥克風：用瀏覽器內建語音辨識（Chrome 免費）真的聽你講中文。
  const onMic = useCallback(() => {
    // 立即中斷先前仍在發聲的開機巡檢或舊語音，避免重疊混音
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (liveModeWanted || bridge.isLiveMode) {
      void toggleVoiceSession();
      return;
    }
    if (bridge.status === "idle" || bridge.status === "ended" || bridge.status === "error") {
      void bridge.startCall(passcode, false);
    }
    if (mvListening) {
      recognitionRef.current?.stop();
      setMvListening(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setMvReply("這個瀏覽器不支援語音辨識，請用下面的輸入框打字（Chrome 可以用講的）。");
      openDialog();
      window.setTimeout(() => inputRef.current?.focus(), 60);
      return;
    }
    const rec = new Ctor();
    rec.lang = langMode === "en" ? "en-US" : "zh-TW";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setMvDraft(transcript);
      // 1. 本地 CNC-640 控制台一律立即執行指令，確保畫面因應與語音 100% 響應！
      runModelCommand(transcript);
      // 2. 若 Bridge 在線，同步送出文字給後端代理
      if (bridge.status === "listening" || bridge.status === "speaking" || bridge.status === "thinking") {
        bridge.sendSay(transcript);
      }
    };
    rec.onend = () => setMvListening(false);
    rec.onerror = () => setMvListening(false);
    recognitionRef.current = rec;
    setMvListening(true);
    openDialog(); // 開始聽就彈出對話框
    try {
      rec.start();
    } catch {
      setMvListening(false);
    }
  }, [langMode, liveModeWanted, bridge, passcode, mvListening, toggleVoiceSession, openDialog, runModelCommand]);

  // 浮層夾取：對話框＋球是同一個 fixed 容器，夾的是整個浮層（球在框下方，
  // 只夾容器左上角會讓球掉出螢幕下緣 → 用容器實際寬高反推）。
  const clampFloat = (x: number, y: number) => {
    const w = floatRef.current?.offsetWidth ?? 300;
    const h = floatRef.current?.offsetHeight ?? 420;
    return {
      x: Math.min(Math.max(x, 8), Math.max(8, window.innerWidth - w - 8)),
      y: Math.min(Math.max(y, 8), Math.max(8, window.innerHeight - h - 8)),
    };
  };
  // 對話框拖曳＋召回球：點/拖對話框就把整個浮層夾回可視範圍（球被拖出螢幕邊只剩對話框時用）。
  const recallOrb = useCallback(() => {
    setOrbPos((prev) => {
      if (!prev) return prev;
      const w = floatRef.current?.offsetWidth ?? 300;
      const h = floatRef.current?.offsetHeight ?? 420;
      return {
        x: Math.min(Math.max(prev.x, 8), Math.max(8, window.innerWidth - w - 8)),
        y: Math.min(Math.max(prev.y, 8), Math.max(8, window.innerHeight - h - 8)),
      };
    });
  }, []);
  const dialogDragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  // 對話框標題列可拖著走（整個浮層一起動）；輸入框/按鈕不觸發拖曳。
  const handleDialogMouseDown = (e: React.MouseEvent) => {
    recallOrb();
    if ((e.target as HTMLElement).closest("button,input,form")) return;
    const rect = floatRef.current?.getBoundingClientRect();
    dialogDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: rect ? rect.left : window.innerWidth - 320,
      baseY: rect ? rect.top : window.innerHeight - 320,
    };
    const move = (ev: MouseEvent) => {
      const d = dialogDragRef.current;
      if (!d) return;
      setOrbPos(clampFloat(d.baseX + ev.clientX - d.startX, d.baseY + ev.clientY - d.startY));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      dialogDragRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  // 宇宙球拖曳：點一下＝說話（onMic），拖著走＝移動，放開停留在該處。
  const orbPress = (clientX: number, clientY: number) => {
    const rect = floatRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      baseX: rect ? rect.left : window.innerWidth - 140,
      baseY: rect ? rect.top : window.innerHeight - 140,
      moved: false,
    };
  };
  const orbMove = (clientX: number, clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = clientX - d.startX;
    const dy = clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (d.moved) {
      const p = clampFloat(d.baseX + dx, d.baseY + dy);
      setOrbPos(p);
    }
  };
  const orbRelease = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) onMic();
  };
  const handleOrbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    orbPress(e.clientX, e.clientY);
    const move = (ev: MouseEvent) => orbMove(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      orbRelease();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const latestTickets = [...tickets].slice(-5).reverse();
  const openCount = tickets.filter((x) => (x.status ?? "open") === "open").length;
  const resolvedCount = tickets.length - openCount;
  // 派工包 v2 §3：五站子項燈號。03「1 號手臂物料區補料中」＝藍燈。
  const lights04: Light[] = ["green", isAlarm ? "red" : "green"];

  return (
    <main className="min-h-full flex flex-col select-none">
      <Script
        src="https://unpkg.com/lucide@latest"
        strategy="afterInteractive"
        onLoad={refreshIcons}
      />

      <header className="bg-[#202731] text-white px-6 py-2.5 flex flex-wrap justify-between items-center border-b-2 border-[#12161c] shadow-md gap-3">
        <div className="flex items-center space-x-4">
          <div className="bg-[#0056b3] text-white font-black text-sm px-3 py-1 tracking-wider uppercase rounded-sm border border-blue-400 shadow-sm">
            CNC-640
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-base tracking-wide">
                {langMode === "en" ? "SMART FACTORY SYSTEM · Autonomous Operations Hub" : "SMART FACTORY SYSTEM · 智慧工廠總控系統"}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/80 text-emerald-300 font-mono font-semibold border border-emerald-600">
                {langMode === "en" ? "AUTO RUN" : "全自動運轉"}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-blue-900/80 text-cyan-300 font-mono font-semibold border border-blue-600" title={`可用率 ${heartbeat.oeeAvailability}% · 表現率 ${heartbeat.oeePerformance}% · 品質率 ${heartbeat.oeeQuality}%`}>
                OEE {heartbeat.oeeTotal}%
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-mono font-semibold border border-slate-600">
                {langMode === "en" ? "🎯 Today's Output: " : "🎯 今日產量: "}{heartbeat.partsToday}/{heartbeat.partsTarget} PCS ({heartbeat.completionRate}%)
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-3 mt-0.5">
              <span>{langMode === "en" ? "MODE: FULL AUTONOMOUS" : "模式: 全自主連線運轉"}</span>
              <span>•</span>
              <span>{langMode === "en" ? "VIEW: " : "視圖: "}{langMode === "en" ? TAB_NAMES_EN[view] : TAB_NAMES[view]}</span>
              <span>•</span>
              <span className="text-slate-300">{langMode === "en" ? "WO: " : "工單: "}{heartbeat.workOrder} ({heartbeat.partName})</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 font-mono text-xs flex-wrap">
          {/* 🌐 國際比賽雙語切換分段選擇器 / Segmented Bilingual Switcher */}
          <div className="flex items-center bg-[#14181f] p-0.5 rounded border border-slate-700 text-xs font-mono shadow-sm">
            <button
              type="button"
              onClick={() => {
                if (langMode !== "zh") {
                  setLangMode("zh");
                  const switchMsg = "已切換為繁體中文現場模式。";
                  setMvReply(switchMsg);
                  speak(switchMsg, "zh");
                  openDialog();
                }
              }}
              title="切換至繁體中文現場模式（台灣工廠車間）"
              className={`flex items-center gap-1 px-2.5 py-1 rounded font-bold transition ${
                langMode === "zh"
                  ? "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/50"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🇹🇼</span>
              <span>繁體中文</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (langMode !== "en") {
                  setLangMode("en");
                  const switchMsg = "Switched to English voice and console mode.";
                  setMvReply(switchMsg);
                  speak(switchMsg, "en");
                  openDialog();
                }
              }}
              title="Switch to English mode (for hackathon judges)"
              className={`flex items-center gap-1 px-2.5 py-1 rounded font-bold transition ${
                langMode === "en"
                  ? "bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/50"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🇺🇸</span>
              <span>English</span>
            </button>
          </div>

          {/* 免接觸「宇宙」語音喚醒開關（直接喊「宇宙」） */}
          <button
            type="button"
            onClick={() => setWakeEnabled((v) => !v)}
            title={wakeEnabled ? "免觸控語音喚醒中（黑手免碰螢幕，直接喊「宇宙」即可）" : "免觸控語音喚醒已關閉，點擊開啟"}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-mono font-semibold transition ${
              wakeEnabled
                ? "bg-purple-950/80 border-purple-500 text-purple-200 hover:bg-purple-900"
                : "bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${wakeEnabled ? "bg-purple-400 animate-pulse" : "bg-slate-500"}`} />
            <span>
              {langMode === "en"
                ? `🎙️ Wake Word: ${wakeEnabled ? "ON ('Universe')" : "OFF"}`
                : `🎙️ 語音喚醒: ${wakeEnabled ? "ON (喊「宇宙」)" : "OFF"}`}
            </span>
          </button>

          {/* 停機損失即時跳表（老闆視角：每秒都在算錢） */}
          {isAlarm && (
            <div className="flex items-center gap-1.5 bg-rose-950/90 px-3 py-1.5 rounded border border-rose-500 text-rose-300 font-mono font-bold animate-pulse shadow-sm">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              <span>
                {langMode === "en" ? "⏱ Downtime Loss: " : "⏱ 停機損失: "}${heartbeat.downtimeCostUSD} USD ({heartbeat.downtimeSec}s)
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-[#14181f] px-3 py-1.5 rounded border border-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-400 font-bold">{langMode === "en" ? "READY" : "正常連線"}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#14181f] px-3 py-1.5 rounded border border-slate-700">
            {isAlarm ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                <span className="text-rose-400 font-bold">{langMode === "en" ? "ALARM (1)" : "警報異常 (1)"}</span>
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-400 font-bold">{langMode === "en" ? "NORMAL (0)" : "全線正常 (0)"}</span>
              </>
            )}
          </div>

          <div className="bg-black/60 px-3 py-1.5 rounded border border-slate-700 text-amber-300 font-bold text-sm tracking-wider">
            {clock}
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row p-4 gap-4 max-w-[1720px] w-full mx-auto">
        <main className="flex-1 space-y-4">
          {/* ============ F1 流程監控總覽（放大五站 + 警報才出現的面板） ============ */}
          <div className={view === "f1" ? "space-y-4" : "space-y-4 hidden"}>
            {/* 🎛️ 工業 4.0 現場操作中樞：MES 工單切換配方 ＋ 現場故障應急演練模擬條 */}
            <div className="p-3 bg-white/90 border border-[#9aa3b4] rounded-lg shadow-sm flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
              {/* 左側：MES 多工單配方切換 */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 whitespace-nowrap">
                  <i data-lucide="layers" className="w-3.5 h-3.5 text-[#0056b3]" />
                  {langMode === "en" ? "MES Work Orders:" : "MES 工單配方:"}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => heartbeat.switchWorkOrder("A109")}
                    className={`px-2.5 py-1 text-xs font-mono rounded border transition flex items-center gap-1 font-semibold ${
                      heartbeat.workOrderId === "A109"
                        ? "bg-[#0056b3] text-white border-blue-600 shadow-sm"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300"
                    }`}
                  >
                    <span>{langMode === "en" ? "A109 Turbine Blade" : "A109 渦輪葉片"}</span>
                    <span className="text-[10px] opacity-80">(8.5k RPM)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => heartbeat.switchWorkOrder("B202")}
                    className={`px-2.5 py-1 text-xs font-mono rounded border transition flex items-center gap-1 font-semibold ${
                      heartbeat.workOrderId === "B202"
                        ? "bg-[#0056b3] text-white border-blue-600 shadow-sm"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300"
                    }`}
                  >
                    <span>{langMode === "en" ? "B202 Fuel Valve" : "B202 燃油閥體"}</span>
                    <span className="text-[10px] opacity-80">(12k RPM)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => heartbeat.switchWorkOrder("C303")}
                    className={`px-2.5 py-1 text-xs font-mono rounded border transition flex items-center gap-1 font-semibold ${
                      heartbeat.workOrderId === "C303"
                        ? "bg-[#0056b3] text-white border-blue-600 shadow-sm"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300"
                    }`}
                  >
                    <span>{langMode === "en" ? "C303 Hip Joint" : "C303 人工關節"}</span>
                    <span className="text-[10px] opacity-80">(6.8k RPM)</span>
                  </button>
                </div>
              </div>

              {/* 右側：現場故障演練注入模擬器 */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 border-t md:border-t-0 md:border-l md:pl-3 border-slate-200">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 whitespace-nowrap">
                  <i data-lucide="zap" className="w-3.5 h-3.5 text-rose-600" />
                  {langMode === "en" ? "Fault Simulation:" : "1鍵故障演練:"}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => heartbeat.injectFault("414")}
                    title="模擬 414 / E-402 軸負載過載 142% 卡死"
                    className={`px-2 py-1 text-xs font-mono rounded border transition font-bold flex items-center gap-1 ${
                      heartbeat.activeFault === "414"
                        ? "bg-rose-700 text-white border-rose-900 shadow-sm animate-pulse"
                        : "bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-200"
                    }`}
                  >
                    {langMode === "en" ? "🚨 414 Servo Overload" : "🚨 414 軸過載"}
                  </button>

                  <button
                    type="button"
                    onClick={() => heartbeat.injectFault("E108")}
                    title="模擬 E-108 主軸軸承過溫 88.4°C"
                    className={`px-2 py-1 text-xs font-mono rounded border transition font-bold flex items-center gap-1 ${
                      heartbeat.activeFault === "E108"
                        ? "bg-amber-600 text-white border-amber-800 shadow-sm animate-pulse"
                        : "bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200"
                    }`}
                  >
                    {langMode === "en" ? "🌡️ E-108 Spindle Temp" : "🌡️ E-108 主軸過溫"}
                  </button>

                  <button
                    type="button"
                    onClick={() => heartbeat.injectFault("E305")}
                    title="模擬 E-305 切削水泵斷流 <1.2 bar"
                    className={`px-2 py-1 text-xs font-mono rounded border transition font-bold flex items-center gap-1 ${
                      heartbeat.activeFault === "E305"
                        ? "bg-sky-700 text-white border-sky-900 shadow-sm animate-pulse"
                        : "bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-200"
                    }`}
                  >
                    {langMode === "en" ? "💧 E-305 Coolant Flow" : "💧 E-305 冷卻斷流"}
                  </button>

                  <button
                    type="button"
                    onClick={() => clearAlarm()}
                    title="解除所有故障演練與警報，恢復全線正常運作"
                    className="px-2 py-1 text-xs font-mono rounded border transition font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 flex items-center gap-1"
                  >
                    {langMode === "en" ? "✅ Reset Normal" : "✅ 復歸正常"}
                  </button>
                </div>
              </div>
            </div>

            {/* 演練中警報醒目條 */}
            {heartbeat.activeFault !== "none" && (
              <div className="p-3 rounded-lg border-2 border-rose-500 bg-rose-50 shadow-md flex items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-rose-600 animate-ping" />
                  <span className="font-bold text-rose-900 text-sm">{heartbeat.faultTitle}</span>
                  <span className="text-rose-800">— {heartbeat.faultDesc}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-600 font-semibold hidden sm:inline">
                    {langMode === "en" ? "[Simulating] Say 'Universe, clear alarm' or click reset" : "【演練中】喊「宇宙，解除警報」或點擊右側復歸"}
                  </span>
                  <button
                    type="button"
                    onClick={() => clearAlarm()}
                    className="px-2.5 py-1 bg-rose-700 hover:bg-rose-800 text-white rounded font-bold shadow-sm"
                  >
                    {langMode === "en" ? "Manual Reset" : "手動復歸"}
                  </button>
                </div>
              </div>
            )}

            <section className="hh-card rounded-lg p-4">
              <div className="flex justify-between items-center pb-2 mb-2.5 border-b border-[#9aa3b4]">
                <h2 className="text-sm font-bold flex items-center gap-2 text-[#202731]">
                  <i data-lucide="git-branch" className="w-4 h-4 text-[#0056b3]" />
                  {langMode === "en" ? "Autonomous Manufacturing Pipeline · Live Material Conveyor" : "自動化製程全節點即時監控 · 動態物流流水線"}
                </h2>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-slate-600 font-semibold">
                    {langMode === "en" ? "STATIONS: 5 ACTIVE" : "工站: 5 站連線運轉"}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-emerald-700 font-bold">
                    {langMode === "en" ? "FLOWING" : "連續流動中"}
                  </span>
                </div>
              </div>

              {/* 🏭 動態物流流向輸送管線 (LIVE MATERIAL CONVEYOR PIPELINE) */}
              <div className={`p-2 rounded-md border flex flex-wrap items-center justify-between text-xs font-mono mb-3 gap-2 ${
                isAlarm
                  ? "bg-rose-950/10 border-rose-400 text-rose-800 flow-conveyor-alarm"
                  : "bg-blue-50/70 border-blue-300 text-slate-700 flow-conveyor-track"
              }`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-[#0056b3] flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${isAlarm ? "bg-rose-500 animate-ping" : "bg-emerald-500 animate-pulse"}`} />
                    {langMode === "en" ? "Material Pipeline: " : "即時物流動脈："}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                    <span className="px-1.5 py-0.5 rounded bg-white border border-slate-300">{langMode === "en" ? "01 Dock Inbound" : "01 碼頭進貨"}</span>
                    <span className="text-blue-600 font-bold flow-arrow-pulse">❯❯</span>
                    <span className="px-1.5 py-0.5 rounded bg-white border border-slate-300">{langMode === "en" ? "02 AGV Inbound" : "02 AGV入庫"}</span>
                    <span className="text-blue-600 font-bold flow-arrow-pulse">❯❯</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-100/90 border border-amber-300 text-amber-900 font-bold">{langMode === "en" ? "03 Buffer Feeder" : "03 取料急送"}</span>
                    <span className="text-blue-600 font-bold flow-arrow-pulse">❯❯</span>
                    <span className={`px-1.5 py-0.5 rounded border font-bold ${
                      isAlarm
                        ? "bg-rose-100 border-rose-400 text-rose-900 animate-pulse"
                        : "bg-emerald-100/80 border-emerald-300 text-emerald-900"
                    }`}>
                      {langMode === "en" ? `04 CNC Machining ${isAlarm ? "[LOCKED]" : ""}` : `04 切削加工 ${isAlarm ? "[鎖死]" : ""}`}
                    </span>
                    <span className="text-blue-600 font-bold flow-arrow-pulse">❯❯</span>
                    <span className="px-1.5 py-0.5 rounded bg-white border border-slate-300">{langMode === "en" ? "05 QC Storage" : "05 品檢入庫"}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                  <span>{langMode === "en" ? "Speed: " : "輸送節拍: "}<strong className="text-slate-800">1.2 m/s</strong></span>
                  <span>{langMode === "en" ? "Cycle Time: " : "工廠生產週期: "}<strong className="text-slate-800">{formatSecondsToMS(heartbeat.cycleRemainSec)}</strong></span>
                  <span className={`px-2 py-0.5 rounded font-bold border ${
                    isAlarm
                      ? "bg-rose-100 text-rose-700 border-rose-300"
                      : "bg-emerald-100 text-emerald-800 border-emerald-300"
                  }`}>
                    {langMode === "en" ? (isAlarm ? "⚠ STOPPED" : "● FLOWING") : (isAlarm ? "⚠ 異常停擺" : "● 連續流動中")}
                  </span>
                </div>
              </div>

              {/* 五站卡片：保留大銘定稿全部文字與規格，全面賦予動態進度與即時物理心跳 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-sans">
                {/* 01 碼頭進貨 */}
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col gap-2 min-h-[270px] shadow-sm hover:border-blue-400 transition">
                  <div className="flex justify-between text-[12px] font-mono font-bold items-center border-b border-slate-200 pb-1">
                    <span className="flex items-center gap-1.5 text-slate-800">
                      <span>{langMode === "en" ? "01 Dock Inbound" : "01 碼頭進貨"}</span>
                    </span>
                    {(() => {
                      const b = stationBadge(["green", "green"], langMode === "en");
                      return <span className={`${b.cls} flex items-center gap-1 text-[11px]`}>● {b.label}</span>;
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="green" />A 碼頭進貨</span>
                          <span className="text-[9px] font-mono text-emerald-700 font-bold bg-emerald-50 px-1 rounded">卸貨中</span>
                        </div>
                        <div className="text-[10px] text-slate-600 leading-relaxed font-mono">
                          司機 AA｜車牌 BBB-123<br />10:00 碼頭下貨<br />1 號 AGV 來下貨
                        </div>
                      </div>
                      {/* 動態卸貨進度條 */}
                      <div className="mt-1.5 pt-1 border-t border-slate-200">
                        <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-0.5">
                          <span>卸載進度 (裝載AGV-01)</span>
                          <span className="text-blue-700 font-bold">{heartbeat.dockAProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-600 h-full rounded-full transition-all duration-1000"
                            style={{ width: `${heartbeat.dockAProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="green" />B 碼頭進貨</span>
                          <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1 rounded">待命中</span>
                        </div>
                        <div className="text-[10px] text-slate-600 leading-relaxed font-mono">
                          司機 BB｜車牌 CCC-456<br />15:00 到碼頭<br />2 號 AGV 來下貨
                        </div>
                      </div>
                      <div className="mt-1 pt-1 border-t border-slate-200 text-[9px] text-slate-500 font-mono flex justify-between">
                        <span>過磅狀態</span>
                        <span className="text-emerald-700 font-bold">過磅完成</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 02 下貨入庫 AGV */}
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col gap-2 min-h-[270px] shadow-sm hover:border-blue-400 transition">
                  <div className="flex justify-between text-[12px] font-mono font-bold items-center border-b border-slate-200 pb-1">
                    <span className="flex items-center gap-1.5 text-slate-800">
                      <span>{langMode === "en" ? "02 Inbound Storage AGV" : "02 下貨入庫 AGV"}</span>
                    </span>
                    {(() => {
                      const b = stationBadge(["blue", "blue"], langMode === "en");
                      return <span className={`${b.cls} flex items-center gap-1 text-[11px]`}>● {b.label}</span>;
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="blue" />1 號 AGV</span>
                          <span className="text-[9px] font-mono text-blue-700 font-bold bg-blue-50 px-1 rounded animate-pulse">運送中</span>
                        </div>
                        <div className="text-[10px] text-slate-600 leading-relaxed">
                          確認司機車牌 · 碼頭<br />品名/數量/材質/供應商<br />
                          <span className="font-mono font-bold text-slate-800">入庫 A 櫃 2-1</span>
                        </div>
                      </div>
                      {/* 動態 AGV 搬運進度條 */}
                      <div className="mt-1.5 pt-1 border-t border-slate-200">
                        <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-0.5">
                          <span>碼頭A ➔ A櫃 2-1</span>
                          <span className="text-blue-700 font-bold">{heartbeat.agv1Progress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-blue-600 h-full rounded-full transition-all duration-1000"
                            style={{ width: `${heartbeat.agv1Progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="blue" />2 號 AGV</span>
                          <span className="text-[9px] font-mono text-blue-700 font-bold bg-blue-50 px-1 rounded">運送中</span>
                        </div>
                        <div className="text-[10px] text-slate-600 leading-relaxed">
                          確認司機車牌 · 碼頭<br />品名/數量/材質/供應商<br />
                          <span className="font-mono font-bold text-slate-800">入庫 B 櫃 1-1</span>
                        </div>
                      </div>
                      {/* 動態 AGV 搬運進度條 */}
                      <div className="mt-1.5 pt-1 border-t border-slate-200">
                        <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-0.5">
                          <span>碼頭B ➔ B櫃 1-1</span>
                          <span className="text-blue-700 font-bold">{heartbeat.agv2Progress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-blue-600 h-full rounded-full transition-all duration-1000"
                            style={{ width: `${heartbeat.agv2Progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 03 取料 AGV：1 號手臂物料區補料中＝藍燈（派工包 v2 §3） */}
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col gap-2 min-h-[270px] shadow-sm hover:border-blue-400 transition">
                  <div className="flex justify-between text-[12px] font-mono font-bold items-center border-b border-slate-200 pb-1">
                    <span className="flex items-center gap-1.5 text-slate-800">
                      <span>{langMode === "en" ? "03 Buffer Feeder AGV" : "03 取料 AGV"}</span>
                    </span>
                    {(() => {
                      const b = stationBadge(["blue", "amber"], langMode === "en");
                      return <span className={`${b.cls} flex items-center gap-1 text-[11px]`}>● {b.label}</span>;
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-amber-50 border-2 border-amber-400 flex-1 flex flex-col justify-between shadow-sm">
                      <div>
                        <div className="text-[11px] font-bold text-amber-900 mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="blue" />1 號手臂物料區 · 補料中</span>
                          <span className="text-[9px] font-mono text-rose-700 font-bold bg-rose-50 px-1 rounded animate-pulse">急送中</span>
                        </div>
                        <div className="text-[10px] text-slate-800 leading-relaxed">
                          <span className="text-rose-700 font-black">低於下限 · 補貨</span><br />
                          鋁鋼｜100 支｜S45C<br />
                          <span className="font-mono font-bold text-slate-900">B 櫃 1-1</span>
                        </div>
                      </div>
                      {/* 動態補料進度條 */}
                      <div className="mt-1.5 pt-1 border-t border-amber-200">
                        <div className="flex justify-between text-[9px] font-mono text-amber-900 mb-0.5">
                          <span>急件配送中 (預計28s)</span>
                          <span className="text-amber-800 font-bold">{heartbeat.feedDeliveryProgress}%</span>
                        </div>
                        <div className="w-full bg-amber-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-amber-600 h-full rounded-full transition-all duration-1000"
                            style={{ width: `${heartbeat.feedDeliveryProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="amber" />2 號手臂物料區</span>
                          <span className="text-[9px] font-mono text-emerald-700 bg-emerald-50 px-1 rounded font-bold">充沛</span>
                        </div>
                        <div className="text-[10px] text-emerald-700 font-bold leading-relaxed">
                          原料正常<br />待命中
                        </div>
                      </div>
                      <div className="mt-1 pt-1 border-t border-slate-200 text-[9px] text-slate-500 font-mono flex justify-between">
                        <span>目前庫存</span>
                        <span className="text-emerald-700 font-bold">100% 滿足</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 04 加工區（正常 / 警報）：子項燈號跟著 isAlarm 走 */}
                <div className={`p-3 rounded flex flex-col gap-2 min-h-[270px] transition ${
                  isAlarm
                    ? "bg-rose-50 border-2 border-rose-600 shadow-md animate-pulse"
                    : "bg-white/70 border border-[#9aa3b4] shadow-sm hover:border-blue-400"
                }`}>
                  <div className={`flex justify-between text-[12px] font-mono font-bold items-center border-b pb-1 ${
                    isAlarm ? "text-rose-800 border-rose-300" : "border-slate-200"
                  }`}>
                    <span className="flex items-center gap-1.5">
                      <span>{langMode === "en" ? "04 CNC Machining Area" : "04 加工區"}</span>
                    </span>
                    {(() => {
                      const b = stationBadge(lights04, langMode === "en");
                      return (
                        <span className={isAlarm ? "text-rose-700 animate-pulse font-black text-[11px]" : `${b.cls} text-[11px]`}>
                          ● {b.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="green" />1 號機械手臂 · AE800</span>
                          <span className="text-[9px] font-mono text-emerald-700 font-bold bg-emerald-50 px-1 rounded animate-pulse">切削中</span>
                        </div>
                        <div className="text-[10px] text-slate-600 leading-relaxed">物料區 › 自檢成品 › 成品區</div>
                      </div>
                      {/* 與真實 CNC 物理切削倒數連動 */}
                      <div className="mt-1.5 pt-1 border-t border-slate-200">
                        <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-0.5">
                          <span>五軸切削: {heartbeat.activeGCode.n}</span>
                          <span className="text-blue-700 font-bold">{Math.round(((270 - heartbeat.cycleRemainSec) / 270) * 100)}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-[#0056b3] h-full rounded-full transition-all duration-1000"
                            style={{ width: `${Math.round(((270 - heartbeat.cycleRemainSec) / 270) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className={`p-2 rounded border flex-1 flex flex-col justify-between ${
                      isAlarm ? "bg-rose-100 border-rose-300" : "bg-slate-50 border-slate-200"
                    }`}>
                      <div>
                        <div className={`text-[11px] font-bold mb-1 flex items-center justify-between ${
                          isAlarm ? "text-rose-900" : "text-[#0056b3]"
                        }`}>
                          <span className="flex items-center gap-1.5"><SubDot light={lights04[1]} />2 號機械手臂 · AF800{isAlarm ? "：E-402" : ""}</span>
                          <span className={`text-[9px] font-mono px-1 rounded font-bold ${
                            isAlarm ? "bg-rose-200 text-rose-900 animate-pulse" : "bg-slate-100 text-slate-600"
                          }`}>
                            {isAlarm ? "伺服鎖定" : "自檢待命"}
                          </span>
                        </div>
                        <div className={`text-[10px] leading-relaxed ${isAlarm ? "text-rose-700 font-bold" : "text-slate-600"}`}>
                          {isAlarm ? "J2 伺服過載 142%" : "物料區 › 自檢成品 › 成品區"}
                        </div>
                      </div>
                      <div className="mt-1 pt-1 border-t border-slate-200 text-[9px] text-slate-500 font-mono flex justify-between">
                        <span>運作狀態</span>
                        <span className={isAlarm ? "text-rose-700 font-bold" : "text-emerald-700 font-bold"}>
                          {isAlarm ? "連鎖煞車觸發" : "正常"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 05 品檢入庫 AGV */}
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col gap-2 min-h-[270px] shadow-sm hover:border-blue-400 transition">
                  <div className="flex justify-between text-[12px] font-mono font-bold items-center border-b border-slate-200 pb-1">
                    <span className="flex items-center gap-1.5 text-slate-800">
                      <span>{langMode === "en" ? "05 QC Storage AGV" : "05 品檢入庫 AGV"}</span>
                    </span>
                    {(() => {
                      const b = stationBadge(["green", "green"], langMode === "en");
                      return <span className={`${b.cls} flex items-center gap-1 text-[11px]`}>● {b.label}</span>;
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="green" />3 號 AGV · 1 號手臂</span>
                          <span className="text-[9px] font-mono text-emerald-700 font-bold bg-emerald-50 px-1 rounded animate-pulse">送檢中</span>
                        </div>
                        <div className="text-[10px] text-slate-600 leading-relaxed">成品區搬運 › 品檢區</div>
                      </div>
                      {/* 動態送檢進度條 */}
                      <div className="mt-1.5 pt-1 border-t border-slate-200">
                        <div className="flex justify-between text-[9px] font-mono text-slate-500 mb-0.5">
                          <span>成品送檢: Part #{heartbeat.partsToday}</span>
                          <span className="text-emerald-700 font-bold">{heartbeat.qcDeliveryProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-600 h-full rounded-full transition-all duration-1000"
                            style={{ width: `${heartbeat.qcDeliveryProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5"><SubDot light="green" />4 號 AGV · 2 號手臂</span>
                          <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1 rounded">待命</span>
                        </div>
                        <div className="text-[10px] text-slate-600 leading-relaxed">成品區搬運 › 品檢區</div>
                      </div>
                      <div className="mt-1 pt-1 border-t border-slate-200 text-[9px] text-slate-500 font-mono flex justify-between">
                        <span>品檢三次元</span>
                        <span className="text-emerald-700 font-bold">校正就緒</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 工業級 CNC-640 實體加工中心即時動態（G-Code / Klartext 程式流 ＋ 主軸物理遙測） */}
            <section className="hh-card rounded-lg p-4 font-sans">
              <div className="flex justify-between items-center pb-2 mb-3 border-b border-[#9aa3b4]">
                <h2 className="text-sm font-bold flex items-center gap-2 text-[#202731]">
                  <i data-lucide="cpu" className="w-4 h-4 text-[#0056b3]" />
                  {langMode === "en"
                    ? "CNC-640 5-Axis Machining Center · Cutting Telemetry & G-Code Flow"
                    : "CNC-640 5軸高速加工中心 · 實體切削遙測與程式流"}
                </h2>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-300">
                    {langMode === "en" ? "Tool: " : "刀具: "}<strong className="text-blue-700">{heartbeat.tools[2]?.id || "T03"}</strong> {langMode === "en" ? "(R4 Bullnose Endmill)" : "(R4 圓鼻銑刀)"}
                  </span>
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-300 font-bold">
                    {langMode === "en" ? "Cycle Remaining: " : "週期剩餘: "}{formatSecondsToMS(heartbeat.cycleRemainSec)} / 04:30
                  </span>
                </div>
              </div>

              {/* 切削進度條 */}
              <div className="mb-3">
                <div className="flex justify-between text-[11px] font-mono text-slate-600 mb-1">
                  <span>{langMode === "en" ? "Single Part Cutting Progress (CYCLE PROGRESS)" : "單件切削進度 (CYCLE PROGRESS)"}</span>
                  <span>{Math.round(((270 - heartbeat.cycleRemainSec) / 270) * 100)}% {langMode === "en" ? "(Auto storage on finish)" : "(完成將自動入庫並計數)"}</span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[#0056b3] h-full rounded-full transition-all duration-1000"
                    style={{ width: `${Math.round(((270 - heartbeat.cycleRemainSec) / 270) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* 左側：實體 G-Code / Klartext 執行視窗（綠/黑 CRT 工控面板） */}
                <div className="lg:col-span-7 bg-[#12161c] rounded-lg p-3 border border-slate-700 shadow-inner font-mono text-xs flex flex-col justify-between">
                  <div className="flex justify-between items-center pb-1.5 border-b border-slate-800 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5 text-cyan-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      PROGRAM: 0420_TITANIUM_BLADE.NC
                    </span>
                    <span>BLOCK: N0415 - N0424</span>
                  </div>
                  <div className="space-y-1 my-2">
                    {heartbeat.gcodeList.map((item, idx) => {
                      const isActive = idx === heartbeat.activeGCodeIdx;
                      return (
                        <div
                          key={item.n}
                          className={`px-2 py-1 rounded flex justify-between items-center transition-colors text-[11px] ${
                            isActive
                              ? "bg-blue-900/60 border border-blue-400 text-amber-300 font-bold shadow-sm"
                              : "text-slate-400 opacity-75 hover:opacity-100"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={isActive ? "text-cyan-400 font-black" : "text-slate-500"}>
                              {isActive ? "►" : " "}
                            </span>
                            <span>{item.code}</span>
                          </div>
                          <span className={`text-[10px] ${isActive ? "text-emerald-300 font-semibold" : "text-slate-500"}`}>
                            {item.comment} {isActive ? "◄" : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-slate-500 flex justify-between border-t border-slate-800 pt-1">
                    <span>FEED OVERRIDE: 100%</span>
                    <span>RAPID: 24 m/min</span>
                    <span>M08 COOLANT: HIGH-PRESSURE</span>
                  </div>
                </div>

                {/* 右側：物理感測器即時儀表 */}
                <div className="lg:col-span-5 grid grid-cols-2 gap-2 font-mono text-xs">
                  {/* 主軸轉速 */}
                  <div className="p-2.5 bg-white rounded border border-slate-300 flex flex-col justify-between">
                    <div className="text-slate-500 text-[10px] flex justify-between">
                      <span>SPINDLE RPM</span>
                      <span className="text-emerald-600 font-bold">● RUN</span>
                    </div>
                    <div className="text-xl font-black text-slate-800 my-1">
                      {heartbeat.spindleRpm} <span className="text-xs font-normal text-slate-500">RPM</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {langMode === "en" ? "Target Set: 8,500 RPM" : "目標設定: 8,500 RPM"}
                    </div>
                  </div>

                  {/* 主軸負載 */}
                  <div className={`p-2.5 rounded border flex flex-col justify-between ${
                    isAlarm ? "bg-rose-50 border-rose-400" : "bg-white border-slate-300"
                  }`}>
                    <div className="text-slate-500 text-[10px] flex justify-between">
                      <span>SPINDLE LOAD</span>
                      <span className={isAlarm ? "text-rose-600 font-bold animate-pulse" : "text-blue-600 font-bold"}>
                        {isAlarm ? "OVERLOAD" : "NORMAL"}
                      </span>
                    </div>
                    <div className={`text-xl font-black my-1 ${isAlarm ? "text-rose-700 animate-pulse" : "text-slate-800"}`}>
                      {heartbeat.spindleLoadPct}%
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${heartbeat.spindleLoadPct > 100 ? "bg-rose-600" : heartbeat.spindleLoadPct > 85 ? "bg-amber-500" : "bg-emerald-600"}`}
                        style={{ width: `${Math.min(heartbeat.spindleLoadPct, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* 進給率 */}
                  <div className="p-2.5 bg-white rounded border border-slate-300 flex flex-col justify-between">
                    <div className="text-slate-500 text-[10px] flex justify-between">
                      <span>ACTUAL FEED</span>
                      <span className="text-slate-400">G01/G02</span>
                    </div>
                    <div className="text-xl font-black text-slate-800 my-1">
                      {heartbeat.feedRateActual} <span className="text-xs font-normal text-slate-500">mm/min</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {langMode === "en" ? "Servo Response: 0.8ms" : "伺服響應: 0.8ms"}
                    </div>
                  </div>

                  {/* 切削液壓力 */}
                  <div className="p-2.5 bg-white rounded border border-slate-300 flex flex-col justify-between">
                    <div className="text-slate-500 text-[10px] flex justify-between">
                      <span>COOLANT PRESS</span>
                      <span className="text-emerald-600 font-bold">NORMAL</span>
                    </div>
                    <div className="text-xl font-black text-slate-800 my-1">
                      {heartbeat.coolantPressureBar} <span className="text-xs font-normal text-slate-500">BAR</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {langMode === "en" ? "Filter Rating: 10µm" : "過濾精度: 10µm"}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 語音開單即時看板（Model宇宙 開的單；resolved 標已完成） */}
            <section className="hh-card rounded-lg p-4">
              <div className="flex justify-between items-center pb-2 mb-2 border-b border-[#9aa3b4]">
                <h2 className="text-sm font-bold text-[#202731] flex items-center gap-2">
                  <i data-lucide="clipboard-list" className="w-4 h-4 text-[#0056b3]" />
                  {langMode === "en" ? "Voice Work Orders Live Kanban" : "語音開單即時看板"}
                </h2>
                <span className="text-xs font-mono font-semibold text-slate-600">
                  {openCount} {langMode === "en" ? "Pending + " : "待修＋"}{resolvedCount} {langMode === "en" ? "Resolved" : "已完成"}
                </span>
              </div>
              {latestTickets.length === 0 ? (
                <div className="text-center text-slate-500 text-xs py-3 font-mono">
                  {langMode === "en"
                    ? "Waiting for voice tickets... Say 'Issue work order' to MODEL Universe"
                    : "等待語音開單…　跟 Model宇宙 說「開維修單」試試"}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 border-b font-mono text-slate-600">
                      <tr>
                        <th className="p-2">{langMode === "en" ? "Ticket #" : "工單"}</th>
                        <th className="p-2">{langMode === "en" ? "Machine" : "機台"}</th>
                        <th className="p-2">{langMode === "en" ? "Symptom" : "症狀"}</th>
                        <th className="p-2">{langMode === "en" ? "Severity" : "嚴重度"}</th>
                        <th className="p-2">{langMode === "en" ? "Status" : "狀態"}</th>
                        <th className="p-2">{langMode === "en" ? "Time" : "時間"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {latestTickets.map((t) => {
                        const done = (t.status ?? "open") === "resolved";
                        return (
                          <tr key={t.ticket_id} className={done ? "bg-emerald-50/60" : undefined}>
                            <td className="p-2 font-mono font-bold text-[#0056b3]">{t.ticket_id}</td>
                            <td className="p-2 font-mono">{t.machine_id}</td>
                            <td className="p-2">{formatSymptom(t.symptom, langMode)}</td>
                            <td className="p-2 text-amber-700 font-bold">{t.severity}</td>
                            <td className="p-2">
                              {done ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-300">
                                  {langMode === "en" ? "RESOLVED" : "已完成"}
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300">
                                  {langMode === "en" ? "OPEN" : "待修"}
                                </span>
                              )}
                            </td>
                            <td className="p-2 font-mono text-slate-500">
                              {new Date(t.created_at).toLocaleTimeString(langMode === "en" ? "en-US" : "zh-TW", { hour12: false })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 警報才出現：伺服軸監控 ＋ AI CLOSED-LOOP ＋解除警報鈕 */}
            {isAlarm && (
              <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <section className="hh-card rounded-lg p-4 font-mono text-xs space-y-2">
                  <div className="font-bold border-b border-[#9aa3b4] pb-1 flex justify-between">
                    <span>{langMode === "en" ? "Servo Joint Telemetry (ROBOT-02)" : "伺服軸即時監控 (ROBOT-02)"}</span>
                    <span className="text-rose-600 font-bold">
                      {langMode === "en" ? "E-402 ALARM ACTIVE" : "E-402 警報中"}
                    </span>
                  </div>
                  <div className="flex justify-between p-1.5 bg-white rounded border">
                    <span>J1 BASE:</span><span>+124.500 mm (32%)</span>
                  </div>
                  <div className="flex justify-between p-1.5 bg-rose-100 rounded border border-rose-400 font-bold text-rose-900">
                    <span>J2 SHOULDER:</span>
                    <span>{langMode === "en" ? "-48.210 mm (142% OVERLOAD)" : "-48.210 mm (142% 超載)"}</span>
                  </div>
                  <div className="flex justify-between p-1.5 bg-white rounded border">
                    <span>J3 ELBOW:</span><span>+982.015 mm (28%)</span>
                  </div>
                </section>
                <section className="hh-card rounded-lg p-4 text-xs font-sans space-y-2">
                  <div className="font-bold border-b border-[#9aa3b4] pb-1 flex justify-between">
                    <span>{langMode === "en" ? "AI Autonomous Action Feed" : "AI 大腦最新自主行動摘要"}</span>
                    <span className="text-emerald-700 font-mono font-bold">CLOSED-LOOP</span>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-300">
                    <div className="text-rose-700 font-bold text-[11px]">
                      {langMode === "en" ? "● Called OEM Repair Service (13:10:15)" : "● 已致電原廠報修 (13:10:15)"}
                    </div>
                    <div className="text-[11px] text-slate-700 mt-0.5">
                      {langMode === "en"
                        ? "Booked field engineer today at 15:00 to inspect J2 axis mechanical stall."
                        : "預約工程師今日 15:00 到廠排查 J2 軸卡料。"}
                    </div>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-300">
                    <div className="text-amber-800 font-bold text-[11px]">
                      {langMode === "en" ? "● Called Material Supplier (12:45:00)" : "● 已致電材料供應商 (12:45:00)"}
                    </div>
                    <div className="text-[11px] text-slate-700 mt-0.5">
                      {langMode === "en"
                        ? "S45C steel bar inventory low. Auto-ordered 200 pcs, arriving tomorrow before 09:00."
                        : "S45C 鋼材庫存偏低，自動叫料 200 支，明日 09:00 前送達。"}
                    </div>
                  </div>
                </section>
              </div>
              <button
                type="button"
                onClick={clearAlarm}
                className="w-full py-2.5 rounded-lg text-sm font-bold bg-[#b71c1c] hover:bg-[#c62828] text-white border border-[#7f0000] shadow-md transition flex items-center justify-center gap-2"
              >
                <span aria-hidden="true">●</span>
                {langMode === "en" ? "Mute & Reset Alarm (Voice 'Clear Alarm' or F8)" : "解除警報（跟語音「解除警報」/ F8 同一個功能）"}
              </button>
              </div>
            )}
          </div>

          {/* ============ F2 AGV（原樣） ============ */}
          <div className={view === "f2" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="truck" className="w-5 h-5 text-[#0056b3]" />
                {langMode === "en" ? "AGV Fleet Manual & Autonomous Dispatch Center" : "AGV 車隊手動即時調度中心"}
              </h2>
              <span className="text-xs font-mono text-slate-600">FLEET: 4 UNITS ACTIVE</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 bg-slate-900 rounded-lg overflow-hidden border-2 border-slate-700 relative shadow-inner">
                <div className="absolute top-2 left-3 z-10 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
                  <span className="font-mono text-xs font-bold text-white bg-black/60 px-2 py-0.5 rounded">
                    {langMode === "en" ? "● CAM-01: AGV-02 Nav Camera [LIVE]" : "● CAM-01: AGV-02 導航前視鏡頭 [LIVE]"}
                  </span>
                </div>
                <div className="absolute top-2 right-3 z-10 font-mono text-[11px] text-emerald-400 bg-black/60 px-2 py-0.5 rounded">
                  30 FPS • 1080P • LiDAR ON
                </div>
                <div className="h-64 sm:h-72 w-full bg-gradient-to-b from-slate-950 via-slate-800 to-slate-900 flex flex-col justify-between p-4 relative cam-overlay">
                  <div className="mt-6 flex justify-between text-[11px] font-mono text-cyan-400">
                    <div>SPEED: 1.2 m/s<br />STEER: +0.2°</div>
                    <div className="text-right">ZONE: BAY-C<br />OBSTACLE: CLEAR</div>
                  </div>
                  <div className="relative w-full h-24 flex items-center justify-center">
                    <div className="w-48 h-full border-b-4 border-l-2 border-r-2 border-cyan-400/50 rounded-b-3xl" />
                    <div className="absolute text-[10px] font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 border border-cyan-500 rounded">
                      {langMode === "en" ? "Route Locked: ➔ Arm 1 Staging (7.4m)" : "路徑鎖定：➔ 1號手臂備料區 (7.4m)"}
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                    <span>RCS_SYNC: OK (4ms)</span>
                    <span>BATTERY: 95%</span>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-5 space-y-3">
                <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold font-mono text-xs">{langMode === "en" ? "AGV-01 (Inbound Transport)" : "AGV-01 (下料搬運車)"}</span>
                    <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold">
                      {langMode === "en" ? "RUNNING" : "運行中"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    {langMode === "en" ? "Dock Unload ➜ WMS Storage (Battery 88%)" : "碼頭卸貨 ➜ WMS 立體庫 (電量 88%)"}
                  </div>
                  {/* 動態搬運進度條 */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>{langMode === "en" ? "Route: Dock A ➔ High-Bay 03" : "路徑進度: 碼頭 A ➔ 立體倉 03"}</span>
                      <span className="text-blue-600 font-bold">{heartbeat.agv1Progress}%</span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 h-full rounded-full transition-all duration-1000"
                        style={{ width: `${heartbeat.agv1Progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => dispatchAgv("AGV-01", "返回碼頭")} className="flex-1 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-xs font-bold">
                      {langMode === "en" ? "Return to Dock" : "調回碼頭"}
                    </button>
                    <button type="button" onClick={() => dispatchAgv("AGV-01", "前往充電樁")} className="py-1.5 px-3 bg-slate-200 hover:bg-slate-300 rounded text-xs font-bold">
                      {langMode === "en" ? "Recharge" : "回充"}
                    </button>
                  </div>
                </div>
                <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold font-mono text-xs">{langMode === "en" ? "AGV-02 (Feeder Transport)" : "AGV-02 (補料出庫車)"}</span>
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                      {langMode === "en" ? "VIDEO LIVE" : "視訊連線中"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    {langMode === "en" ? "High-Bay Output Staging (Battery 95%)" : "立體倉出料口待命位 (電量 95%)"}
                  </div>
                  {/* 動態補料進度條 */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>{langMode === "en" ? "Feed Route: High-Bay ➔ Arm 1" : "補料路徑: 立體倉 ➔ 1號手臂"}</span>
                      <span className="text-amber-600 font-bold">{heartbeat.agv2Progress}%</span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-amber-600 h-full rounded-full transition-all duration-1000"
                        style={{ width: `${heartbeat.agv2Progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => dispatchAgv("AGV-02", "送料至 1 號手臂")} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold">
                      {langMode === "en" ? "Feed to Arm 1" : "補料至 1 號手臂"}
                    </button>
                    <button type="button" onClick={() => dispatchAgv("AGV-02", "送料至 2 號手臂")} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold">
                      {langMode === "en" ? "Feed to Arm 2" : "補料至 2 號手臂"}
                    </button>
                  </div>
                </div>
                {agvMsg && (
                  <div className="p-2 bg-emerald-50 border border-emerald-300 rounded text-xs font-mono text-emerald-800">
                    {agvMsg}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ============ F3 手臂數據（原樣） ============ */}
          <div className={view === "f3" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="activity" className="w-5 h-5 text-[#0056b3]" />
                {langMode === "en"
                  ? "6-Axis Robotic Arm Telemetry & Torque Spectrum (ROBOT-02)"
                  : "六軸機械手臂精細數據與扭矩頻譜分析 (ROBOT-02)"}
              </h2>
              {isAlarm ? (
                <span className="text-xs font-mono font-bold text-rose-700 bg-rose-100 border border-rose-300 px-2 py-0.5 rounded">
                  E-402 OVER-TORQUE
                </span>
              ) : (
                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded">
                  ALL AXES NORMAL
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 font-mono">
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">
                    {langMode === "en" ? "J1 Base Rotation (BASE)" : "J1 底座旋轉軸 (BASE)"}
                  </span>
                  <span className="font-bold text-emerald-700">32%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "32%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>{langMode === "en" ? "Angle: +124.5°" : "角度: +124.5°"}</div>
                  <div>{langMode === "en" ? "Speed: 120 RPM" : "轉速: 120 RPM"}</div>
                  <div>{langMode === "en" ? "Current: 4.2 A" : "電流: 4.2 A"}</div>
                  <div>{langMode === "en" ? "Temp: 42°C" : "溫度: 42°C"}</div>
                  <div>{langMode === "en" ? "Vib: 0.8 mm/s" : "振動: 0.8 mm/s"}</div>
                  <div className="text-emerald-700 font-bold">{langMode === "en" ? "Status: OK" : "狀態: 正常"}</div>
                </div>
              </div>
              {/* J2：警報時 142% 紅卡；解除後跟著轉正常綠卡（跟語音說的同步） */}
              {isAlarm ? (
              <div className="p-3 bg-rose-50 border-2 border-rose-500 rounded space-y-2 shadow-sm">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-black text-rose-900">
                    {langMode === "en" ? "J2 Shoulder Pitch (SHOULDER)" : "J2 大臂俯仰軸 (SHOULDER)"}
                  </span>
                  <span className="font-black text-rose-700 animate-pulse">
                    {langMode === "en" ? "142% [OVERLOAD]" : "142% [超標]"}
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-rose-600 h-full rounded-full" style={{ width: "100%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-rose-900 pt-1 border-t border-rose-300 font-bold">
                  <div>{langMode === "en" ? "Angle: -48.2°" : "角度: -48.2°"}</div>
                  <div>{langMode === "en" ? "Speed: 0 RPM" : "轉速: 0 RPM"}</div>
                  <div className="text-rose-700">{langMode === "en" ? "Current: 18.9 A" : "電流: 18.9 A"}</div>
                  <div>{langMode === "en" ? "Temp: 78°C" : "溫度: 78°C"}</div>
                  <div>{langMode === "en" ? "Vib: 4.6 mm/s" : "振動: 4.6 mm/s"}</div>
                  <div className="text-rose-700">{langMode === "en" ? "Status: LOCKED" : "狀態: 卡死鎖定"}</div>
                </div>
              </div>
              ) : (
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">
                    {langMode === "en" ? "J2 Shoulder Pitch (SHOULDER)" : "J2 大臂俯仰軸 (SHOULDER)"}
                  </span>
                  <span className="font-bold text-emerald-700">36%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "36%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>{langMode === "en" ? "Angle: -48.2°" : "角度: -48.2°"}</div>
                  <div>{langMode === "en" ? "Speed: 90 RPM" : "轉速: 90 RPM"}</div>
                  <div>{langMode === "en" ? "Current: 5.1 A" : "電流: 5.1 A"}</div>
                  <div>{langMode === "en" ? "Temp: 45°C" : "溫度: 45°C"}</div>
                  <div>{langMode === "en" ? "Vib: 0.9 mm/s" : "振動: 0.9 mm/s"}</div>
                  <div className="text-emerald-700 font-bold">{langMode === "en" ? "Status: OK" : "狀態: 正常"}</div>
                </div>
              </div>
              )}
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">
                    {langMode === "en" ? "J3 Elbow Joint (ELBOW)" : "J3 小臂關節軸 (ELBOW)"}
                  </span>
                  <span className="font-bold text-emerald-700">28%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "28%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>{langMode === "en" ? "Angle: +98.0°" : "角度: +98.0°"}</div>
                  <div>{langMode === "en" ? "Speed: 85 RPM" : "轉速: 85 RPM"}</div>
                  <div>{langMode === "en" ? "Current: 3.8 A" : "電流: 3.8 A"}</div>
                  <div>{langMode === "en" ? "Temp: 39°C" : "溫度: 39°C"}</div>
                  <div>{langMode === "en" ? "Vib: 0.6 mm/s" : "振動: 0.6 mm/s"}</div>
                  <div className="text-emerald-700 font-bold">{langMode === "en" ? "Status: OK" : "狀態: 正常"}</div>
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">
                    {langMode === "en" ? "J4 Wrist Rotation (WRIST 1)" : "J4 腕部旋轉軸 (WRIST 1)"}
                  </span>
                  <span className="font-bold text-emerald-700">15%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "15%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>{langMode === "en" ? "Angle: +0.0°" : "角度: +0.0°"}</div>
                  <div>{langMode === "en" ? "Speed: 0 RPM" : "轉速: 0 RPM"}</div>
                  <div>{langMode === "en" ? "Current: 1.2 A" : "電流: 1.2 A"}</div>
                  <div>{langMode === "en" ? "Temp: 35°C" : "溫度: 35°C"}</div>
                  <div>{langMode === "en" ? "Vib: 0.2 mm/s" : "振動: 0.2 mm/s"}</div>
                  <div className="text-emerald-700 font-bold">{langMode === "en" ? "Status: OK" : "狀態: 正常"}</div>
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">
                    {langMode === "en" ? "J5 Wrist Pitch (WRIST 2)" : "J5 腕部俯仰軸 (WRIST 2)"}
                  </span>
                  <span className="font-bold text-emerald-700">18%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "18%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>{langMode === "en" ? "Angle: -30.0°" : "角度: -30.0°"}</div>
                  <div>{langMode === "en" ? "Speed: 0 RPM" : "轉速: 0 RPM"}</div>
                  <div>{langMode === "en" ? "Current: 1.6 A" : "電流: 1.6 A"}</div>
                  <div>{langMode === "en" ? "Temp: 36°C" : "溫度: 36°C"}</div>
                  <div>{langMode === "en" ? "Vib: 0.3 mm/s" : "振動: 0.3 mm/s"}</div>
                  <div className="text-emerald-700 font-bold">{langMode === "en" ? "Status: OK" : "狀態: 正常"}</div>
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">
                    {langMode === "en" ? "J6 End Flange Gripper (FLANGE)" : "J6 末端法蘭夾爪 (FLANGE)"}
                  </span>
                  <span className="font-bold text-emerald-700">10%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "10%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>{langMode === "en" ? "Pressure: 0.62 MPa" : "氣壓: 0.62 MPa"}</div>
                  <div>{langMode === "en" ? "Clamping: 150 N" : "夾緊力: 150 N"}</div>
                  <div>{langMode === "en" ? "Current: 0.9 A" : "電流: 0.9 A"}</div>
                  <div>{langMode === "en" ? "Stroke: 45mm" : "開合行程: 45mm"}</div>
                  <div>{langMode === "en" ? "Sensor: ON" : "磁簧感應: ON"}</div>
                  <div className="text-emerald-700 font-bold">{langMode === "en" ? "Status: CLAMPED" : "狀態: 閉合保壓"}</div>
                </div>
              </div>
            </div>

            {/* CNC 24 刀位刀庫壽命即時監控（主管/班長視角：防斷刀、提前備刀） */}
            <div className="p-3 bg-white rounded border border-slate-300 space-y-3 font-sans">
              <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                <div className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <i data-lucide="disc" className="w-4 h-4 text-[#0056b3]" />
                  <span>
                    {langMode === "en"
                      ? "CNC-640 24-Pocket Tool Magazine Life & Wear Telemetry"
                      : "CNC-640 刀庫 24 刀位動態壽命與磨損預警監控"}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded font-bold">
                  {langMode === "en" ? "⚠ 1 Tool Near Wear Limit" : "⚠ 1 支刀具接近磨損極限"}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs font-mono">
                {heartbeat.tools.map((t) => {
                  const isCritical = t.life <= 15;
                  const isWarning = t.life <= 30 && t.life > 15;
                  const toolLabel =
                    langMode === "en"
                      ? t.id === "T01"
                        ? "Face Mill"
                        : t.id === "T02"
                        ? "Rough Mill"
                        : t.id === "T03"
                        ? "Ball Endmill"
                        : t.id === "T04"
                        ? "Center Drill"
                        : t.id === "T05"
                        ? "Micro Tap"
                        : "Chamfer Tool"
                      : t.name;
                  return (
                    <div
                      key={t.id}
                      className={`p-2 rounded border flex flex-col justify-between ${
                        isCritical
                          ? "bg-rose-50 border-rose-400 shadow-sm"
                          : isWarning
                            ? "bg-amber-50 border-amber-300"
                            : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="font-bold text-slate-800">{t.id}</span>
                        <span
                          className={`font-black ${
                            isCritical
                              ? "text-rose-600 animate-pulse"
                              : isWarning
                                ? "text-amber-700"
                                : "text-emerald-600"
                          }`}
                        >
                          {t.life}%
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-600 my-1 truncate" title={`${toolLabel} ${t.spec}`}>
                        {toolLabel}
                      </div>
                      <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            isCritical ? "bg-rose-600" : isWarning ? "bg-amber-500" : "bg-emerald-600"
                          }`}
                          style={{ width: `${t.life}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[9px] text-slate-500 flex justify-between">
                        <span>{langMode === "en" ? "Est. Remaining" : "預估剩餘"}</span>
                        <span className={isCritical ? "text-rose-700 font-bold" : ""}>
                          {isCritical
                            ? (langMode === "en" ? "12 min" : "12 分鐘")
                            : (langMode === "en" ? "Normal" : "正常")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 flex items-center justify-between">
                <span>
                  💡 <strong>{langMode === "en" ? "Autonomous Tool Dispatch" : "智慧刀具調度連動"}</strong>：
                  {langMode === "en"
                    ? "T03 Endmill has 12% life remaining. AGV-02 scheduled to deliver replacement upon WO completion."
                    : "T03 圓鼻銑刀壽命僅剩 12%，系統已自動排定於本工單完成後，引導 AGV-02 遞送新刀具至刀庫換刀位。"}
                </span>
                <button
                  type="button"
                  onClick={() => sendQuick(langMode === "en" ? "check tool wear" : "檢查刀具磨損狀態")}
                  className="px-2 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded text-[10px] font-bold whitespace-nowrap ml-2"
                >
                  {langMode === "en" ? "Voice Tool Report" : "語音回報刀況"}
                </button>
              </div>
            </div>

            <div className="p-3 bg-white rounded border border-slate-300 text-xs font-sans space-y-1">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <i data-lucide="wrench" className="w-4 h-4 text-rose-600" />
                {langMode === "en"
                  ? "Expert System Machine Diagnostic & Triage Advice:"
                  : "機台專家系統診斷與即時排除建議："}
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                {isAlarm
                  ? (langMode === "en"
                      ? "J2 servo torque step-overloaded at 13:10:02 (peak 142% rated torque). Hardware brake interlock triggered. AI diagnosed mechanical jam in reducer/guide. Emergency ticket #TICKET-8902 dispatched to OEM."
                      : "J2 軸伺服扭矩於 13:10:02 發生階躍型過載（峰值達 142% 額定扭矩），系統已觸發硬體煞車安全連鎖。AI 研判內部減速機或導軌異物卡阻，已完成原廠緊急報修，工單單號：#TICKET-8902。")
                  : (langMode === "en"
                      ? "All axis loads nominal (J2 returned to 36%). No overload alarms. Historical ticket: #TICKET-8902 (Closed)."
                      : "各軸負載正常（J2 回到 36%），無過載警報。歷史工單：#TICKET-8902（已結案）。")}
              </p>
            </div>
          </div>

          {/* ============ F4 原料庫存（原樣） ============ */}
          <div className={view === "f4" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="package" className="w-5 h-5 text-[#0056b3]" />
                {langMode === "en"
                  ? "Automated High-Bay Raw Material Inventory & AI Procurement"
                  : "立體倉原料庫存監控與 AI 自動叫料"}
              </h2>
              <span className="text-xs font-mono text-slate-600">ERP / WMS LIVE</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-6 bg-slate-900 rounded-lg overflow-hidden border-2 border-slate-700 relative shadow-inner">
                <div className="absolute top-2 left-3 z-10 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
                  <span className="font-mono text-xs font-bold text-white bg-black/60 px-2 py-0.5 rounded">
                    {langMode === "en" ? "● CAM-02: High-Bay 03 Overview [LIVE]" : "● CAM-02: 原料立體倉 03 貨架全景 [LIVE]"}
                  </span>
                </div>
                <div className="absolute top-2 right-3 z-10 font-mono text-[11px] text-amber-400 bg-black/60 px-2 py-0.5 rounded">
                  {langMode === "en" ? "AI Vision: Below Safety Stock" : "AI 物體辨識：低於安全庫存"}
                </div>
                <div className="h-60 w-full bg-gradient-to-b from-slate-950 via-slate-800 to-slate-900 flex flex-col justify-between p-4 relative cam-overlay">
                  <div className="mt-6 flex justify-between text-[11px] font-mono text-slate-300">
                    <div>RACK: B-03-A<br />CAPACITY: 42%</div>
                    <div className="text-right">TEMP: 22.4°C<br />HUMID: 48%</div>
                  </div>
                  <div className="w-44 h-24 mx-auto border-2 border-dashed border-amber-400 bg-amber-500/10 rounded flex flex-col items-center justify-center text-center p-1">
                    <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-950/80 px-1 rounded">MAT-S45C-50</span>
                    <span className="text-[10px] text-rose-400 font-bold mt-1">
                      {langMode === "en" ? "▲ Remaining 35 pcs (Threshold: 50)" : "▲ 剩餘 35 支 (警戒線 50)"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                    <span>SENSOR: RFID / OPTICAL ON</span>
                    <span>WMS_STABLE</span>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-6 space-y-3">
                <table className="w-full text-xs text-left bg-white rounded border border-slate-300">
                  <thead className="bg-slate-100 border-b font-mono">
                    <tr>
                      <th className="p-2">{langMode === "en" ? "Part # / Material" : "料號 / 品名"}</th>
                      <th className="p-2">{langMode === "en" ? "Stock" : "庫存"}</th>
                      <th className="p-2">{langMode === "en" ? "Min" : "下限"}</th>
                      <th className="p-2 text-right">{langMode === "en" ? "Action" : "操作"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-slate-700">
                    <tr className="bg-amber-50">
                      <td className="p-2 font-bold font-mono">
                        {langMode === "en" ? "S45C Round Bar Ø50" : "S45C 圓棒材 Ø50"}
                      </td>
                      <td className="p-2 font-bold text-rose-700">
                        {langMode === "en" ? "35 pcs" : "35 支"}
                        {supplierCallStatus === "done" && (
                          <span className="ml-1 text-xs text-emerald-700 font-bold">
                            {langMode === "en" ? "(+20 in transit)" : "(+20 支在途)"}
                          </span>
                        )}
                      </td>
                      <td className="p-2 font-mono">{langMode === "en" ? "50 pcs" : "50 支"}</td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          onClick={() => callSupplierManual("S45C 圓棒材")}
                          disabled={supplierCallStatus === "calling"}
                          className={`px-2.5 py-1 rounded text-[11px] font-bold shadow-sm transition flex items-center gap-1.5 ml-auto ${
                            supplierCallStatus === "calling"
                              ? "bg-amber-500 text-white animate-pulse"
                              : supplierCallStatus === "done"
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                              : "bg-amber-600 hover:bg-amber-700 text-white"
                          }`}
                        >
                          {supplierCallStatus === "calling" ? (
                            <>
                              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                              <span>{langMode === "en" ? "Calling Supplier..." : "撥號通話中..."}</span>
                            </>
                          ) : supplierCallStatus === "done" ? (
                            <>
                              <span>✅</span>
                              <span>{langMode === "en" ? "Urged (ETA 14:30)" : "已催料 (14:30到)"}</span>
                            </>
                          ) : (
                            <>
                              <span>📞</span>
                              <span>{langMode === "en" ? "Urge Call" : "催料通話"}</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2 font-mono">{langMode === "en" ? "AL6061 Square Bar 30x30" : "AL6061 方棒 30x30"}</td>
                      <td className="p-2 font-bold text-emerald-700">{langMode === "en" ? "180 pcs" : "180 支"}</td>
                      <td className="p-2 font-mono">{langMode === "en" ? "60 pcs" : "60 支"}</td>
                      <td className="p-2 text-right text-slate-400">-</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-mono">{langMode === "en" ? "SUS304 Round Bar Ø20" : "SUS304 棒材 Ø20"}</td>
                      <td className="p-2 font-bold text-emerald-700">{langMode === "en" ? "92 pcs" : "92 支"}</td>
                      <td className="p-2 font-mono">{langMode === "en" ? "40 pcs" : "40 支"}</td>
                      <td className="p-2 text-right text-slate-400">-</td>
                    </tr>
                  </tbody>
                </table>
                {supplierMsg && (
                  <div className="p-2.5 bg-blue-50 border border-blue-300 rounded text-xs font-mono text-blue-900 shadow-sm animate-fade-in flex items-center gap-2">
                    <span className="text-base">📞</span>
                    <span>{supplierMsg}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ============ F5 AI 通話紀錄（動態記錄實體撥出通話） ============ */}
          <div className={view === "f5" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="phone-call" className="w-5 h-5 text-[#0056b3]" />
                {langMode === "en"
                  ? "AI Outbound Voice Telephony & Procurement Tickets"
                  : "AI 外部語音通話與採購報修紀錄明細"}
              </h2>
              <span className="text-xs font-mono text-slate-600">OUTBOUND AI LOG</span>
            </div>
            <div className="space-y-3 text-xs">
              {supplierCalls.map((call) => (
                <div key={call.id} className="p-3 bg-white rounded border space-y-2 shadow-sm">
                  <div className="flex justify-between font-mono">
                    <span className={`font-bold ${call.type === "repair" ? "text-rose-700" : "text-amber-800"}`}>
                      ● {langMode === "en" ? (call.targetEn || call.target) : call.target} ({langMode === "en" ? (call.durationEn || call.duration) : call.duration})
                    </span>
                    <span className="text-slate-500">{call.time}</span>
                  </div>
                  <div className="p-2 bg-slate-50 border rounded text-[11px] leading-relaxed text-slate-700">
                    <div>{langMode === "en" ? (call.aiSayEn || call.aiSay) : call.aiSay}</div>
                    <div className="mt-1 text-slate-800 font-medium">{langMode === "en" ? (call.respSayEn || call.respSay) : call.respSay}</div>
                  </div>
                  <div className="text-[11px] text-emerald-700 font-bold">{langMode === "en" ? (call.poEn || call.po) : call.po}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ============ F6 智能品檢與尺寸公差分析 (AI Vision & CMM Precision QC) ============ */}
          <div className={view === "f6" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="scan-line" className="w-5 h-5 text-[#0056b3]" />
                {langMode === "en"
                  ? "AI Smart Quality Inspection & Dimensional Tolerance · CMM & Vision Scan"
                  : "智能品檢與尺寸公差分析 · 三次元 CMM & AI 視覺掃描"}
              </h2>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-slate-600">
                  {langMode === "en" ? "Linked to Station 05: QC Storage AGV" : "連動第 05 站「品檢入庫 AGV」"}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">
                  ● CMM ONLINE
                </span>
              </div>
            </div>

            {/* 頂部四指標卡 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div className="p-3 bg-white rounded border border-slate-300 shadow-sm">
                <div className="text-slate-500 font-semibold">{langMode === "en" ? "Latest Inspected Part" : "最新完工送檢"}</div>
                <div className="text-lg font-bold text-slate-800 mt-0.5">{heartbeat.inspectionPartId}</div>
                <div className="text-[11px] text-slate-400 mt-1">{langMode === "en" ? "WO " : "工單 "}{heartbeat.workOrder}</div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 shadow-sm">
                <div className="text-slate-500 font-semibold">{langMode === "en" ? "Surface Roughness (Ra)" : "表面粗糙度 (Ra)"}</div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">{heartbeat.surfaceRoughnessRa} µm</div>
                <div className="text-[11px] text-emerald-600 mt-1">{langMode === "en" ? "Std <0.8 µm (PASS)" : "基準 <0.8 µm (合格)"}</div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 shadow-sm">
                <div className="text-slate-500 font-semibold">{langMode === "en" ? "Profile / Roundness Tol" : "輪廓/真圓度公差"}</div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">±{heartbeat.circularityTolerance} mm</div>
                <div className="text-[11px] text-emerald-600 mt-1">{langMode === "en" ? "Tol ±0.008 mm (PASS)" : "公差 ±0.008 mm (合格)"}</div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 shadow-sm">
                <div className="text-slate-500 font-semibold">{langMode === "en" ? "Shift Inspection Yield" : "當班總檢驗良率"}</div>
                <div className="text-lg font-bold text-blue-700 mt-0.5">{heartbeat.shiftYieldRate}%</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {langMode === "en" ? "Pass " : "合格 "}
                  {heartbeat.shiftPartsPassed}
                  {langMode === "en" ? " / Total " : " / 總量 "}
                  {heartbeat.shiftPartsInspected}
                </div>
              </div>
            </div>

            {/* 雙欄：左側 CMM 高精度幾何公差明細，右側 AI 視覺光學外觀與 QR 印章 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 左側：三次元 CMM 幾何尺寸量測 */}
              <div className="p-4 bg-white rounded border border-slate-300 space-y-3 shadow-sm">
                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                    <i data-lucide="crosshair" className="w-4 h-4 text-blue-600" />
                    {langMode === "en" ? "CMM Critical Geometric Tolerance Report" : "三次元 (CMM) 關鍵幾何尺寸精度報告"}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {langMode === "en" ? "ZEISS ACCURA ONLINE" : "ZEISS ACCURA 聯網"}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 text-left border-b border-slate-300">
                        <th className="p-2">{langMode === "en" ? "Measured Feature" : "量測特徵項目"}</th>
                        <th className="p-2">{langMode === "en" ? "Nominal" : "工程標稱"}</th>
                        <th className="p-2">{langMode === "en" ? "Actual" : "實測值"}</th>
                        <th className="p-2">{langMode === "en" ? "Deviation" : "公差偏差"}</th>
                        <th className="p-2 text-center">{langMode === "en" ? "Status" : "判定"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      <tr>
                        <td className="p-2 font-bold text-slate-800">{langMode === "en" ? "Base Tenon Thickness (Base T)" : "葉根榫頭厚度 (Base T)"}</td>
                        <td className="p-2 text-slate-600">18.500 mm</td>
                        <td className="p-2 font-bold text-slate-900">18.498 mm</td>
                        <td className="p-2 text-emerald-700 font-semibold">-0.002 mm</td>
                        <td className="p-2 text-center"><span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">PASS</span></td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-slate-800">{langMode === "en" ? "Pin Hole Diameter (Pin Hole)" : "葉根安裝銷孔 (Pin Hole)"}</td>
                        <td className="p-2 text-slate-600">Ø8.000 mm</td>
                        <td className="p-2 font-bold text-slate-900">Ø8.001 mm</td>
                        <td className="p-2 text-emerald-700 font-semibold">+0.001 mm</td>
                        <td className="p-2 text-center"><span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">PASS</span></td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-slate-800">{langMode === "en" ? "Leading Edge Profile Tolerance" : "前緣流線型面輪廓度"}</td>
                        <td className="p-2 text-slate-600">0.000 mm</td>
                        <td className="p-2 font-bold text-slate-900">0.002 mm</td>
                        <td className="p-2 text-emerald-700 font-semibold">+0.002 mm</td>
                        <td className="p-2 text-center"><span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">PASS</span></td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-slate-800">{langMode === "en" ? "Trailing Edge Thickness" : "尾緣厚度 (Trailing Edge)"}</td>
                        <td className="p-2 text-slate-600">1.200 mm</td>
                        <td className="p-2 font-bold text-slate-900">1.203 mm</td>
                        <td className="p-2 text-emerald-700 font-semibold">+0.003 mm</td>
                        <td className="p-2 text-center"><span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">PASS</span></td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-slate-800">{langMode === "en" ? "Surface Roughness (Ra)" : "表面粗糙度 (Ra)"}</td>
                        <td className="p-2 text-slate-600">&lt; 0.80 µm</td>
                        <td className="p-2 font-bold text-slate-900">0.38 µm</td>
                        <td className="p-2 text-emerald-700 font-semibold">-0.42 µm</td>
                        <td className="p-2 text-center"><span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">PASS</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900 font-mono">
                  {langMode === "en" ? (
                    <>
                      💡 <strong>CMM Closed-Loop Feedback:</strong> Avg geometric tolerance within ±0.002mm. CNC tool wear offset compensation not required (Tool Wear Offset: 0.000mm).
                    </>
                  ) : (
                    <>
                      💡 <strong>CMM 智能閉環反饋：</strong>平均幾何尺寸精度在 ±0.002mm 以內，無需進行 CNC 刀長刀徑磨耗補償 (Tool Wear Offset: 0.000mm)。
                    </>
                  )}
                </div>
              </div>

              {/* 右側：AI 光學視覺瑕疵掃描與出庫打標印章 */}
              <div className="p-4 bg-white rounded border border-slate-300 space-y-3 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center border-b border-slate-200 pb-2 mb-3">
                    <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                      <i data-lucide="eye" className="w-4 h-4 text-purple-600" />
                      {langMode === "en" ? "AI Vision Optical Surface Defect Scan (Visual AI Defect)" : "AI 機器視覺表面瑕疵掃描 (Visual AI Defect)"}
                    </span>
                    <span className="text-[11px] font-mono text-purple-700 font-bold">
                      {langMode === "en" ? "100% Surface Coverage" : "100% 表面檢測"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-3">
                    <div className="p-2.5 bg-slate-50 border rounded flex justify-between items-center">
                      <span className="text-slate-600">{langMode === "en" ? "Burrs Detection" : "邊緣毛刺檢測 (Burrs)"}</span>
                      <span className="font-bold text-emerald-700">{langMode === "en" ? "0 found (PASS)" : "0 處 (合格)"}</span>
                    </div>
                    <div className="p-2.5 bg-slate-50 border rounded flex justify-between items-center">
                      <span className="text-slate-600">{langMode === "en" ? "Micro-Cracks" : "微裂痕/暗紋 (Cracks)"}</span>
                      <span className="font-bold text-emerald-700">{langMode === "en" ? "0 found (PASS)" : "0 處 (合格)"}</span>
                    </div>
                    <div className="p-2.5 bg-slate-50 border rounded flex justify-between items-center">
                      <span className="text-slate-600">{langMode === "en" ? "Scratches / Dents" : "刮痕/碰傷 (Scratches)"}</span>
                      <span className="font-bold text-emerald-700">{langMode === "en" ? "0 found (PASS)" : "0 處 (合格)"}</span>
                    </div>
                    <div className="p-2.5 bg-slate-50 border rounded flex justify-between items-center">
                      <span className="text-slate-600">{langMode === "en" ? "Heat Discoloration" : "切削熱變色 (Discolor)"}</span>
                      <span className="font-bold text-emerald-700">{langMode === "en" ? "None (PASS)" : "無變色 (合格)"}</span>
                    </div>
                  </div>

                  {/* 檢驗判定大印章 */}
                  <div className="p-4 rounded-lg bg-emerald-50 border-2 border-dashed border-emerald-500 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs text-emerald-900 font-mono font-bold">
                        {langMode === "en" ? "Auto Laser Serial Marking" : "自動雷射序號打標"}
                      </div>
                      <div className="text-sm font-mono font-black text-emerald-800">
                        SN: 2026-A109-0348-PASS
                      </div>
                      <div className="text-[11px] text-emerald-700">
                        {langMode === "en"
                          ? "Synced with MES. AGV-04 automatically dispatching to climate-controlled warehouse."
                          : "已連線 MES 系統歸檔，AGV-04 自動接駁運往恆溫品管立體倉庫。"}
                      </div>
                    </div>
                    <div className="px-4 py-2 bg-emerald-600 text-white rounded font-black text-xl font-mono tracking-wider shadow-md transform -rotate-3 border border-emerald-400">
                      QC PASS
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 font-mono text-right">
                  {langMode === "en" ? "Inspection Timestamp: " : "檢驗時間戳記: "}
                  {heartbeat.lastInspectionTime}
                  {langMode === "en" ? " · Inspector: MODEL UNIVERSE AI Vision Agent" : " · 檢驗員: Model宇宙 AI 視覺代理"}
                </div>
              </div>
            </div>
          </div>

          {/* ============ F7 綠色能源與設備健康預測維護 ============ */}
          <div className={view === "f7" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="leaf" className="w-5 h-5 text-emerald-600" />
                {langMode === "en"
                  ? "Green Energy & ESG Carbon Tracking · Predictive Maintenance"
                  : "綠色能源管理 · ESG 碳排計算與設備預測性維護"}
              </h2>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-slate-600">
                  {langMode === "en" ? "Facility IoT Telemetry" : "廠務物聯網遙測"}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">
                  ● ISO 50001 & ISO 14064
                </span>
              </div>
            </div>

            {/* 頂部四指標卡 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div className="p-3 bg-white rounded border border-slate-300 shadow-sm">
                <div className="text-slate-500 font-semibold flex items-center gap-1">
                  <i data-lucide="zap" className="w-3.5 h-3.5 text-amber-500" />
                  {langMode === "en" ? "Total Real-Time Power" : "全機即時總功率"}
                </div>
                <div className="text-xl font-bold text-slate-900 mt-0.5">{heartbeat.realtimePowerKW} kW</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {langMode === "en" ? "Spindle 18.2kW · Servo 4.8kW" : "主軸 18.2kW · 伺服 4.8kW"}
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 shadow-sm">
                <div className="text-slate-500 font-semibold flex items-center gap-1">
                  <i data-lucide="activity" className="w-3.5 h-3.5 text-blue-500" />
                  {langMode === "en" ? "Shift Cumulative Energy" : "當班累計耗電"}
                </div>
                <div className="text-xl font-bold text-blue-700 mt-0.5">{heartbeat.cumulativeKWh} kWh</div>
                <div className="text-[11px] text-blue-600 mt-1">
                  {langMode === "en" ? "Real-Time Sub-Metering" : "每秒即時跳錶計算"}
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 shadow-sm">
                <div className="text-slate-500 font-semibold flex items-center gap-1">
                  <i data-lucide="dollar-sign" className="w-3.5 h-3.5 text-emerald-600" />
                  {langMode === "en" ? "Shift Electricity Cost" : "當班電費折算"}
                </div>
                <div className="text-xl font-bold text-emerald-700 mt-0.5">{heartbeat.electricityCostNTD} NTD</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {langMode === "en" ? "Approx $" : "約 $"}{heartbeat.electricityCostUSD} USD
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 shadow-sm">
                <div className="text-slate-500 font-semibold flex items-center gap-1">
                  <i data-lucide="globe" className="w-3.5 h-3.5 text-teal-600" />
                  {langMode === "en" ? "ESG Cumulative Carbon" : "ESG 累計碳排放"}
                </div>
                <div className="text-xl font-bold text-teal-700 mt-0.5">{heartbeat.carbonKgCO2e} kg CO₂e</div>
                <div className="text-[11px] text-teal-600 mt-1">
                  {langMode === "en" ? "0.26 kg CO₂e / part" : "單件 0.26 kg CO2e / 件"}
                </div>
              </div>
            </div>

            {/* 雙欄：左側能耗結構與太陽能綠電，右側預測性維護健康矩陣 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 左側：能耗架構與太陽能綠電 */}
              <div className="p-4 bg-white rounded border border-slate-300 space-y-3 shadow-sm">
                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                    <i data-lucide="pie-chart" className="w-4 h-4 text-emerald-600" />
                    {langMode === "en" ? "Detailed Machine Load Breakdown" : "全機能耗細部負載結構分析"}
                  </span>
                  <span className="text-[11px] font-mono text-emerald-700 font-bold">
                    {langMode === "en" ? "Rooftop Solar: " : "屋頂太陽能: "}{heartbeat.solarSelfSufficiency}%
                  </span>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div>
                    <div className="flex justify-between text-slate-700 mb-1">
                      <span>{langMode === "en" ? "Spindle Motor Drive" : "主軸馬達旋轉驅動 (Spindle Motor)"}</span>
                      <span className="font-bold">{heartbeat.spindlePowerKW} kW (64.1%)</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-blue-600 rounded-full" style={{ width: "64.1%" }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-700 mb-1">
                      <span>{langMode === "en" ? "5-Axis Servo Feed Drives" : "五軸伺服進給系統 (5-Axis Servo Drives)"}</span>
                      <span className="font-bold">{heartbeat.servoPowerKW} kW (16.9%)</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-cyan-600 rounded-full" style={{ width: "16.9%" }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-700 mb-1">
                      <span>{langMode === "en" ? "High-Pressure Coolant & Chip Conveyor" : "高壓冷卻泵與排屑機 (High-Pressure Pump)"}</span>
                      <span className="font-bold">{heartbeat.pumpPowerKW} kW (12.3%)</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: "12.3%" }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-700 mb-1">
                      <span>{langMode === "en" ? "CNC Cabinet, Chiller & Auxiliaries" : "工控機電、冷氣與輔助周邊 (Aux & Controls)"}</span>
                      <span className="font-bold">{heartbeat.auxPowerKW} kW (6.7%)</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-slate-400 rounded-full" style={{ width: "6.7%" }} />
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-900 font-mono space-y-1">
                  <div className="font-bold">
                    {langMode === "en" ? "🌱 Green Sustainable Manufacturing Metrics (ESG)" : "🌱 綠色永續智造指標 (ESG Sustainability)"}
                  </div>
                  <div className="text-[11px] leading-relaxed text-emerald-800">
                    {langMode === "en" ? (
                      <>
                        Rooftop 250kW solar self-sufficiency at <strong>{heartbeat.solarSelfSufficiency}%</strong>, reducing 33.6 kg CO₂e this shift. Fully compliant with EU CBAM & 2026 Machine Tool Energy Standards.
                      </>
                    ) : (
                      <>
                        屋頂 250kW 太陽能光電自給率 <strong>{heartbeat.solarSelfSufficiency}%</strong>，當班減少碳排 33.6 kg CO₂e。符合歐盟 CBAM 碳邊境機制與 2026 工具機節能標章。
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 右側：預測性維護健康矩陣 */}
              <div className="p-4 bg-white rounded border border-slate-300 space-y-3 shadow-sm">
                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                    <i data-lucide="shield-check" className="w-4 h-4 text-blue-600" />
                    {langMode === "en" ? "Predictive Health Matrix" : "預測性維護健康矩陣 (Predictive Health Matrix)"}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {langMode === "en" ? "AI Vibration Spectrum & Prognostics" : "AI 震動頻譜 & 壽命預警"}
                  </span>
                </div>

                <div className="space-y-3 text-xs font-mono">
                  {/* 主軸軸承震動頻譜 */}
                  <div className="p-2.5 bg-slate-50 border rounded space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-800">
                        {langMode === "en" ? "Spindle Rear Bearing Vibration Health" : "主軸後軸承震動健康度"}
                      </span>
                      <span className="font-bold text-emerald-700">
                        {heartbeat.spindleVibrationHealth}% {langMode === "en" ? "(Good)" : "(良好)"}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${heartbeat.spindleVibrationHealth}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {langMode === "en" ? (
                        <>
                          ISO 10816 RMS vibration: <strong>0.82 mm/s</strong> (Normal zone &lt;1.8 mm/s).
                        </>
                      ) : (
                        <>
                          ISO 10816 震動速度均方根值: <strong>0.82 mm/s</strong> (綠色優良區間 &lt;1.8 mm/s)。
                        </>
                      )}
                    </div>
                  </div>

                  {/* 滾珠螺桿自動潤滑油槽 */}
                  <div className="p-2.5 bg-slate-50 border rounded space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-800">
                        {langMode === "en" ? "Ball Screw Auto Lubrication Reservoir" : "滾珠螺桿自動潤滑油槽"}
                      </span>
                      <span className="font-bold text-blue-700">
                        {heartbeat.lubricationOilLevel}% {langMode === "en" ? "(2.1L Left)" : "(剩餘 2.1L)"}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${heartbeat.lubricationOilLevel}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {langMode === "en" ? (
                        <>
                          Est. continuous run: <strong>48 hrs</strong>. Scheduled top-up with Mobil Vactra No.2 recommended.
                        </>
                      ) : (
                        <>
                          預估可連續運轉 <strong>48 小時</strong>，建議後天早班前例行補充 Mobil Vactra No.2 導軌油。
                        </>
                      )}
                    </div>
                  </div>

                  {/* 切削水箱冷卻液濃度 */}
                  <div className="p-2.5 bg-slate-50 border rounded space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-800">
                        {langMode === "en" ? "Coolant Tank Refractometer Concentration" : "切削水箱冷卻液折光濃度"}
                      </span>
                      <span className="font-bold text-amber-700">
                        {heartbeat.coolantBrix}% Brix {langMode === "en" ? "(Slightly Low)" : "(微偏低)"}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: "70%" }} />
                    </div>
                    <div className="text-[11px] text-amber-800 font-semibold">
                      {langMode === "en"
                        ? "Std spec: 9.0% - 11.0%, currently 8.5%. Recommend adding 5L water-soluble coolant concentrate."
                        : "標準基準 9.0% - 11.0%，目前 8.5%，建議下班前補充 5 公升水性抗磨切削油精。"}
                    </div>
                  </div>

                  {/* 廠房空壓 */}
                  <div className="p-2.5 bg-slate-50 border rounded flex justify-between items-center">
                    <div>
                      <div className="font-bold text-slate-800">
                        {langMode === "en" ? "Main Shop Pneumatic Air Pressure" : "廠房空壓總源壓力"}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {langMode === "en" ? "Supply for ATC Tool Changer & Unclamp Cylinder" : "五軸換刀與打刀缸驅動氣源"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-emerald-700 text-sm">{heartbeat.airPressureMpa} MPa</div>
                      <div className="text-[10px] text-emerald-600">
                        {langMode === "en" ? "Normal Range (0.60-0.70)" : "正常標準 (0.60-0.70)"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* ============ 右側：F1–F7 軟鍵 ＋ F8 警報 ＋ Model宇宙 語音管家 ============ */}
        <aside className="w-full lg:w-72 flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {(["f1", "f2", "f3", "f4", "f5", "f6", "f7"] as ViewKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => switchTab(k)}
                className={`hh-softkey py-3 px-3.5 rounded-lg text-left text-xs font-bold text-[#202731] flex justify-between items-center shadow-sm${view === k ? " active" : ""}`}
              >
                <span className="font-mono text-sm">
                  {langMode === "en" ? TAB_NAMES_EN[k] : TAB_NAMES[k]}
                </span>
                <i data-lucide="chevron-right" className="w-4 h-4 text-slate-500" />
              </button>
            ))}
            <button
              type="button"
              onClick={clearAlarm}
              className="py-3 px-3.5 rounded-lg text-left text-xs font-bold bg-[#b71c1c] hover:bg-[#c62828] text-white border border-[#7f0000] shadow-md flex justify-between items-center transition"
            >
              <span className="font-mono text-sm font-bold">
                {langMode === "en" ? "F8: Mute / Reset Alarm" : "F8: 警報靜音 / 重置"}
              </span>
              <i data-lucide="bell-off" className="w-4 h-4 text-rose-200" />
            </button>
          </div>

          {/* 15 大現場語音快捷事件（通用 CNC-640 控制台介面） */}
          <div className="mt-3 pt-2.5 border-t-2 border-[#9aa3b4] flex flex-col gap-1.5">
            <div className="text-[11px] font-bold text-slate-700 tracking-wider uppercase flex justify-between items-center">
              <span>{langMode === "en" ? "Voice Action Shortcuts" : "現場事件 / 語音直達"}</span>
              <span className="text-[9px] font-mono bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">
                {langMode === "en" ? "15 ACTIONS" : "15 快捷"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {QUICK_ACTIONS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => sendQuick(langMode === "en" ? q.cmdEn : q.cmdZh)}
                  className={`py-1.5 px-2 rounded text-left text-xs font-semibold shadow-sm flex items-center justify-between transition border ${q.btnClass}`}
                  title={langMode === "en" ? q.descEn : q.descZh}
                >
                  <span>{langMode === "en" ? q.nameEn : q.nameZh}</span>
                  <span className={`text-[9px] font-mono font-bold ${q.tagClass}`}>{q.tag}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ============ Model宇宙：常駐浮層語音球（可拖曳）＋對話框（球在框正下方置中） ============ */}
      <div
        ref={floatRef}
        className="fixed z-50 flex flex-col items-center gap-2"
        style={orbPos ? { left: orbPos.x, top: orbPos.y } : { right: 20, bottom: 20 }}
      >
        {dialogOpen && (
          <div
            className="mv-dialog w-[340px] hh-card rounded-lg p-3 flex flex-col gap-2.5 bg-white shadow-2xl border-2 border-[#7e889b]"
            onMouseDown={recallOrb}
          >
            {/* 標題列：可拖曳浮層 */}
            <div
              className="w-full pb-1.5 border-b border-[#9aa3b4] flex justify-between items-center cursor-move"
              onMouseDown={handleDialogMouseDown}
              title="拖這裡可以移動浮層"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[#0056b3] text-sm" aria-hidden="true">●</span>
                <span className="text-xs font-bold text-[#202731]">
                  {langMode === "en" ? "MODEL Universe (AI Voice)" : "MODEL宇宙 語音管家"}
                </span>
                {bridge.status === "listening" && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 animate-pulse">
                    LISTENING
                  </span>
                )}
                {bridge.status === "thinking" && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 animate-pulse">
                    THINKING
                  </span>
                )}
                {bridge.status === "speaking" && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 animate-pulse">
                    SPEAKING
                  </span>
                )}
                {bridge.status === "connecting" && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 animate-pulse">
                    CONNECTING
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {/* 浮層內中英分段選擇器 */}
                <div className="flex items-center bg-slate-100 rounded border border-slate-300 p-0.5 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => {
                      if (langMode !== "zh") {
                        setLangMode("zh");
                        const msg = "已切換為繁體中文語音模式。";
                        setMvReply(msg);
                        speak(msg, "zh");
                      }
                    }}
                    title="切換為繁體中文"
                    className={`px-1.5 py-0.5 rounded font-bold transition ${
                      langMode === "zh"
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    中
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (langMode !== "en") {
                        setLangMode("en");
                        const msg = "Switched to English voice mode.";
                        setMvReply(msg);
                        speak(msg, "en");
                      }
                    }}
                    title="Switch to English"
                    className={`px-1.5 py-0.5 rounded font-bold transition ${
                      langMode === "en"
                        ? "bg-blue-600 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    EN
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setLiveModeWanted((prev) => !prev)}
                  title={
                    langMode === "en"
                      ? liveModeWanted
                        ? "Currently Live AssemblyAI mode. Click to switch to Mock"
                        : "Currently Mock mode. Click to switch to Live AssemblyAI"
                      : liveModeWanted
                        ? "目前為 AssemblyAI 真人模式，點擊切換為 Mock 模擬模式"
                        : "目前為 Mock 模擬模式，點擊切換為 AssemblyAI 真人模式"
                  }
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-semibold ${
                    liveModeWanted
                      ? "bg-purple-100 text-purple-800 border-purple-300"
                      : "bg-slate-100 text-slate-700 border-slate-300"
                  }`}
                >
                  {liveModeWanted ? "⚡ Live" : "🤖 Mock"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfig((prev) => !prev)}
                  title={langMode === "en" ? "Connection Settings" : "連線設定"}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100 text-slate-700"
                >
                  ⚙
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceOn((v) => !v)}
                  title={langMode === "en" ? "Toggle Voice Audio Feedback" : "開關宇宙的語音回覆"}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100"
                >
                  {voiceOn ? "🔊" : "🔇"}
                </button>
                <button
                  type="button"
                  onClick={closeDialog}
                  title={langMode === "en" ? "Close Dialog" : "收回對話框"}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100 text-slate-700"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 設定展開區塊 */}
            {showConfig && (
              <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700">
                    {langMode === "en" ? "Voice Backend Mode:" : "語音後端模式："}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {liveModeWanted ? "AssemblyAI Voice Agent API" : "Local Mock (ws://localhost:8787)"}
                  </span>
                </div>
                {liveModeWanted && (
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="passcode-input" className="text-slate-600 font-mono text-[10px]">
                      Passcode:
                    </label>
                    <input
                      id="passcode-input"
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder={langMode === "en" ? "Default: 414" : "預設 414"}
                      className="flex-1 px-1.5 py-0.5 rounded border border-slate-300 font-mono text-xs"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 通話控制列 */}
            <div className="flex justify-between items-center text-[11px] px-1 font-mono">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    bridge.status === "listening" || bridge.status === "speaking"
                      ? "bg-emerald-500 animate-ping"
                      : bridge.status === "connecting" || bridge.status === "thinking"
                        ? "bg-amber-500 animate-pulse"
                        : "bg-slate-400"
                  }`}
                />
                <span className="text-slate-600 font-semibold">
                  {bridge.status === "listening"
                    ? (langMode === "en" ? `Voice Connected (${bridge.seconds}s)` : `語音連線中 (${bridge.seconds}s)`)
                    : bridge.status === "speaking"
                      ? (langMode === "en" ? `AI Speaking (${bridge.seconds}s)` : `語音回話中 (${bridge.seconds}s)`)
                      : bridge.status === "thinking"
                        ? (langMode === "en" ? "AI Executing Action..." : "AI 決策執行中...")
                        : bridge.status === "connecting"
                          ? (langMode === "en" ? "Connecting..." : "連線建立中...")
                          : (langMode === "en" ? "Voice Assistant Standby" : "語音助理待命中")}
                </span>
              </div>
              <div>
                {bridge.status === "idle" || bridge.status === "ended" || bridge.status === "error" ? (
                  <button
                    type="button"
                    onClick={() => void toggleVoiceSession()}
                    className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px]"
                  >
                    {langMode === "en" ? "▶ Connect Voice" : "▶ 連線對話"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => bridge.endCall()}
                    className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px]"
                  >
                    {langMode === "en" ? "⏹ End Call" : "⏹ 掛斷"}
                  </button>
                )}
              </div>
            </div>

            {/* 對話訊息區塊 */}
            <div className="w-full p-2.5 bg-slate-50/90 rounded border border-slate-300 text-[11px] font-sans text-slate-800 leading-snug min-h-[60px] flex flex-col gap-1.5 max-h-[160px] overflow-y-auto">
              {bridge.lastUserSay && (
                <div className="text-blue-900 bg-blue-50/80 p-1.5 rounded border border-blue-200">
                  <span className="font-bold">{langMode === "en" ? "👤 Operator: " : "👤 操作員："}</span>
                  {bridge.lastUserSay}
                </div>
              )}
              {mvReply ? (
                <div className="text-slate-900 bg-emerald-50/60 p-1.5 rounded border border-emerald-200">
                  <span className="font-bold text-emerald-800">{langMode === "en" ? "🤖 MODEL UNIVERSE: " : "🤖 MODEL宇宙："}</span>
                  {mvReply}
                </div>
              ) : bridge.lastAgentSay ? (
                <div className="text-slate-900 bg-emerald-50/60 p-1.5 rounded border border-emerald-200">
                  <span className="font-bold text-emerald-800">{langMode === "en" ? "🤖 MODEL UNIVERSE: " : "🤖 MODEL宇宙："}</span>
                  {bridge.lastAgentSay}
                </div>
              ) : null}
              {bridge.error && (
                <div className="text-rose-700 bg-rose-50 p-1.5 rounded border border-rose-300 text-[10px] font-mono">
                  ⚠ {bridge.error}
                </div>
              )}
            </div>

            {/* 快速語音指令膠囊（裁判 / 現場 1-click 測試） */}
            <div className="flex flex-wrap gap-1">
              {QUICK_ACTIONS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => sendQuick(langMode === "en" ? q.cmdEn : q.cmdZh)}
                  className={`text-[10px] px-2 py-1 rounded font-semibold transition border ${q.btnClass}`}
                  title={langMode === "en" ? q.descEn : q.descZh}
                >
                  {langMode === "en" ? q.nameEn : q.nameZh}
                </button>
              ))}
            </div>

            {/* 打字輸入框 */}
            <form
              className="w-full flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const line = mvDraft.trim();
                if (!line) return;
                setMvDraft("");
                sendQuick(line);
              }}
            >
              <input
                ref={inputRef}
                id="mv-command"
                name="mv-command"
                value={mvDraft}
                onChange={(e) => setMvDraft(e.target.value)}
                placeholder={
                  langMode === "en"
                    ? "Enter voice command or say 'Universe'..."
                    : "輸入指令，或直接喊「宇宙」用講的..."
                }
                autoComplete="off"
                className="flex-1 rounded border border-slate-400 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-blue-500"
              />
              <button
                type="submit"
                className="rounded bg-[#0056b3] hover:bg-blue-700 px-3 py-1.5 text-xs font-bold text-white transition"
              >
                {langMode === "en" ? "Send" : "送出"}
              </button>
            </form>
          </div>
        )}

        {/* 宇宙球主體 */}
        <button
          type="button"
          onMouseDown={handleOrbMouseDown}
          onTouchStart={(e) => orbPress(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={(e) => orbMove(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={orbRelease}
          aria-pressed={bridge.status === "listening" || mvListening}
          aria-label={
            langMode === "en"
              ? "MODEL Universe Voice Orb: Say 'Universe' or click to speak, drag to reposition"
              : "Model宇宙語音球：直接喊「宇宙」或點擊對話，拖曳移動"
          }
          title={
            langMode === "en"
              ? "Say 'Universe' or click to speak, drag to reposition"
              : "直接喊「宇宙」或點擊對話，拖曳移動"
          }
          className={`mv-orb w-24 h-24 flex items-center justify-center cursor-pointer transition-transform active:scale-95 ${
            bridge.status === "listening" || mvListening ? "listening " : ""
          }${bridge.status === "speaking" ? "speaking " : ""}${
            bridge.status === "thinking" ? "thinking " : ""
          }${isAlarm ? "alarm " : ""}`}
        >
          {/* 球面星空漸層＋高光＋圖示 */}
          <i
            data-lucide={
              bridge.status === "speaking"
                ? "volume-2"
                : bridge.status === "thinking"
                  ? "cpu"
                  : "mic"
            }
            className="w-8 h-8 text-white drop-shadow"
          />
        </button>
      </div>

      <footer className="bg-[#202731] text-slate-400 text-xs px-6 py-2 flex justify-between items-center border-t border-slate-700 font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-slate-200 font-bold">STATUS:</span>
          <span>ALL SENSORS SYNCHRONIZED. VIDEO PIPELINE CONNECTED.</span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span>SYNC: 100%</span>
          <span>LATENCY: 8ms</span>
          <span className="text-amber-300 font-bold" data-testid="site-version">
            VoiceAndon {SITE_VERSION}
          </span>
        </div>
      </footer>
    </main>
  );
}
