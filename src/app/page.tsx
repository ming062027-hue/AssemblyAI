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
  type CommandContext,
} from "@/console/commands";
import { subscribe, list, type Ticket } from "@/board/ticketStore";

declare global {
  interface Window {
    lucide?: { createIcons: () => void };
  }
}

type ViewKey = "f1" | "f2" | "f3" | "f4" | "f5";

const TAB_NAMES: Record<ViewKey, string> = {
  f1: "F1 流程監控總覽",
  f2: "F2 AGV 車隊手動調度",
  f3: "F3 手臂軸向數據分析",
  f4: "F4 原料庫存與補叫料",
  f5: "F5 AI 外部通訊錄明細",
};

// 派工包 v2 §2.1 中央狀態：五站子項各自燈號（§3 表）。
// green 正常 / blue 搬運中（補料中＝藍）/ amber 待命 / red 警報
type Light = "green" | "blue" | "amber" | "red";
const LIGHT_DOT: Record<Light, string> = {
  green: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};
function stationBadge(lights: Light[]): { label: string; cls: string } {
  if (lights.includes("red")) return { label: "警報", cls: "text-rose-700" };
  if (lights.includes("blue")) return { label: "搬運中", cls: "text-blue-700" };
  if (lights.includes("amber")) return { label: "待命中", cls: "text-amber-700" };
  return { label: "正常", cls: "text-emerald-700" };
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

  // Model宇宙 語音管家
  const [mvListening, setMvListening] = useState(false);
  const [mvDraft, setMvDraft] = useState("");
  const [mvCtx, setMvCtx] = useState<CommandContext>(emptyContext());
  const [mvReply, setMvReply] = useState(
    "我是 Model宇宙。說「機台 3 狀態」「查警報 414」「開維修單」「看手臂數據」，我幫你操控畫面。",
  );
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [voiceOn, setVoiceOn] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);

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
  }, [view, mvListening, isAlarm, tickets, refreshIcons]);

  const switchTab = useCallback((key: ViewKey) => setView(key), []);

  const dispatchAgv = useCallback((id: string, task: string) => {
    setAgvMsg(`[調度完成] ${id} 收到指令：『${task}』。`);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setAgvMsg(null), 3500);
  }, []);

  const callSupplierManual = useCallback((mat: string) => {
    setSupplierMsg(`[AI通話完成] 已致電供應商催促『${mat}』，工單已建立。`);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setSupplierMsg(null), 4000);
  }, []);

  // 對話框：打開後 6 秒沒新訊息自動收回，只剩球。
  const openDialog = useCallback(() => {
    setDialogOpen(true);
    if (dialogTimer.current) clearTimeout(dialogTimer.current);
    dialogTimer.current = setTimeout(() => setDialogOpen(false), 6000);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    if (dialogTimer.current) clearTimeout(dialogTimer.current);
  }, []);

  // 宇宙開口講話（瀏覽器內建 TTS，免費，固定 zh-TW 女聲、正常語速 rate=1.0）。
  // 女聲挑法：zh 語音裡名字帶 女/female/常見女聲名 → Google 中文 → 第一個 zh。
  const speak = useCallback(
    (text: string) => {
      if (!voiceOn || typeof window === "undefined" || !window.speechSynthesis) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-TW";
        u.rate = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const zh = voices.filter((v) => v.lang.toLowerCase().startsWith("zh"));
        const pool = zh.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("zh-tw")).length
          ? zh.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith("zh-tw"))
          : zh;
        const female =
          pool.find((v) => /女|female|mei-?jia|ting|yun|hsiao|ying|lin/i.test(v.name)) ??
          pool.find((v) => /google/i.test(v.name)) ??
          pool[0];
        if (female) u.voice = female;
        window.speechSynthesis.speak(u);
      } catch {
        // TTS 失敗不致命
      }
    },
    [voiceOn],
  );

  // 派工包 v2 §4：解除警報只有這一個函式。
  // 語音「解除警報」＋警報面板按鈕＋F6 都接它：面板收回、04 轉正常、F3 的 J2 142% 一起清除。
  // 語音上下文的 alarm 也清空，下一句「開維修單」不會再沿用舊警報。
  const clearAlarm = useCallback(() => {
    setIsAlarm(false);
    setMvCtx(emptyContext());
    const msg = "警報已解除，04 加工區恢復正常，警報面板已收回。";
    setMvReply(msg);
    speak(msg);
    openDialog();
  }, [speak, openDialog]);

  const runModelCommand = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      const res = interpret(t, mvCtx);
      setMvCtx(res.context);
      setMvReply(res.response);
      speak(res.response);
      if (res.clearAlarm) {
        setIsAlarm(false); // 跟按鈕/F6 同一個效果
      } else if (res.alarm) {
        setIsAlarm(true);
        setView("f1"); // 警報 → 讓總覽亮起來（站別 04＋伺服＋CLOSED-LOOP）
      } else if (res.navigate) {
        setView(res.navigate);
      }
      if (res.agv) dispatchAgv(res.agv.id, res.agv.task);
      if (res.supplier) callSupplierManual(supplierName(res.supplier.material));
      if (res.ticketId || res.ticketResolveId) setTickets(list()); // 同分頁強制刷新看板
      setMvDraft("");
      setMvListening(false);
      openDialog(); // 講完彈出對話框，6 秒後自動收回
    },
    [mvCtx, speak, openDialog, dispatchAgv, callSupplierManual],
  );

  // 點麥克風：用瀏覽器內建語音辨識（Chrome 免費）真的聽你講中文。
  const onMic = useCallback(() => {
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
    rec.lang = "zh-TW";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setMvDraft(transcript);
      runModelCommand(transcript);
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
  }, [mvListening, runModelCommand, openDialog]);

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

      <header className="bg-[#202731] text-white px-6 py-2.5 flex justify-between items-center border-b-2 border-[#12161c] shadow-md">
        <div className="flex items-center space-x-4">
          <div className="bg-[#0056b3] text-white font-black text-sm px-3 py-1 tracking-wider uppercase rounded-sm border border-blue-400">
            CNC-640
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-wide">SMART FACTORY SYSTEM · 智慧工廠總控系統</span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-900/80 text-emerald-300 font-mono font-semibold border border-emerald-600">
                AUTO RUN
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-3">
              <span>MODE: FULL AUTONOMOUS</span>
              <span>•</span>
              <span>VIEW: {TAB_NAMES[view]}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="flex items-center gap-1.5 bg-[#14181f] px-3 py-1.5 rounded border border-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-400 font-bold">READY</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#14181f] px-3 py-1.5 rounded border border-slate-700">
            {isAlarm ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                <span className="text-rose-400 font-bold">ALARM (1)</span>
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-400 font-bold">NORMAL (0)</span>
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
            <section className="hh-card rounded-lg p-4">
              <div className="flex justify-between items-center pb-2 mb-3 border-b border-[#9aa3b4]">
                <h2 className="text-sm font-bold flex items-center gap-2 text-[#202731]">
                  <i data-lucide="git-branch" className="w-4 h-4 text-[#0056b3]" />
                  自動化製程全節點即時監控
                </h2>
                <span className="text-xs font-mono font-semibold text-slate-600">STATIONS: 5 ACTIVE</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-sans">
                {/* 01 碼頭進貨 */}
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col gap-2 min-h-[260px]">
                  <div className="flex justify-between text-[12px] font-mono font-bold">
                    <span>01 碼頭進貨</span>
                    {(() => {
                      const b = stationBadge(["green", "green"]);
                      return <span className={b.cls}>● {b.label}</span>;
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1">
                      <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center gap-1.5">
                        <SubDot light="green" />A 碼頭進貨
                      </div>
                      <div className="text-[10px] text-slate-600 leading-relaxed font-mono">
                        司機 AA｜車牌 BBB-123<br />10:00 碼頭下貨<br />1 號 AGV 來下貨
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1">
                      <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center gap-1.5">
                        <SubDot light="green" />B 碼頭進貨
                      </div>
                      <div className="text-[10px] text-slate-600 leading-relaxed font-mono">
                        司機 BB｜車牌 CCC-456<br />15:00 到碼頭<br />2 號 AGV 來下貨
                      </div>
                    </div>
                  </div>
                </div>

                {/* 02 下貨入庫 AGV */}
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col gap-2 min-h-[260px]">
                  <div className="flex justify-between text-[12px] font-mono font-bold">
                    <span>02 下貨入庫 AGV</span>
                    {(() => {
                      const b = stationBadge(["blue", "blue"]);
                      return <span className={b.cls}>● {b.label}</span>;
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1">
                      <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center gap-1.5">
                        <SubDot light="blue" />1 號 AGV
                      </div>
                      <div className="text-[10px] text-slate-600 leading-relaxed">
                        確認司機車牌 · 碼頭<br />品名/數量/材質/供應商<br />
                        <span className="font-mono font-bold text-slate-800">入庫 A 櫃 2-1</span>
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1">
                      <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center gap-1.5">
                        <SubDot light="blue" />2 號 AGV
                      </div>
                      <div className="text-[10px] text-slate-600 leading-relaxed">
                        確認司機車牌 · 碼頭<br />品名/數量/材質/供應商<br />
                        <span className="font-mono font-bold text-slate-800">入庫 B 櫃 1-1</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 03 取料 AGV：1 號手臂物料區補料中＝藍燈（派工包 v2 §3） */}
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col gap-2 min-h-[260px]">
                  <div className="flex justify-between text-[12px] font-mono font-bold">
                    <span>03 取料 AGV</span>
                    {(() => {
                      const b = stationBadge(["blue", "amber"]);
                      return <span className={b.cls}>● {b.label}</span>;
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-amber-50 border border-amber-300 flex-1">
                      <div className="text-[11px] font-bold text-amber-800 mb-1 flex items-center gap-1.5">
                        <SubDot light="blue" />1 號手臂物料區 · 補料中
                      </div>
                      <div className="text-[10px] text-slate-700 leading-relaxed">
                        <span className="text-rose-700 font-bold">低於下限 · 補貨</span><br />
                        鋁鋼｜100 支｜S45C<br />
                        <span className="font-mono font-bold text-slate-800">B 櫃 1-1</span>
                      </div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1">
                      <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center gap-1.5">
                        <SubDot light="amber" />2 號手臂物料區
                      </div>
                      <div className="text-[10px] text-emerald-700 font-bold leading-relaxed">
                        原料正常<br />待命中
                      </div>
                    </div>
                  </div>
                </div>

                {/* 04 加工區（正常 / 警報）：子項燈號跟著 isAlarm 走 */}
                <div className={`p-3 rounded flex flex-col gap-2 min-h-[260px] ${isAlarm ? "bg-rose-50 border-2 border-rose-600 shadow-sm" : "bg-white/70 border border-[#9aa3b4]"}`}>
                  <div className={`flex justify-between text-[12px] font-mono font-bold ${isAlarm ? "text-rose-800" : ""}`}>
                    <span>04 加工區</span>
                    {(() => {
                      const b = stationBadge(lights04);
                      return (
                        <span className={isAlarm ? "text-rose-700 animate-pulse font-black" : b.cls}>
                          ● {b.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1">
                      <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center gap-1.5">
                        <SubDot light="green" />1 號機械手臂 · AE800
                      </div>
                      <div className="text-[10px] text-slate-600 leading-relaxed">物料區 › 自檢成品 › 成品區</div>
                    </div>
                    <div className={`p-2 rounded border flex-1 ${isAlarm ? "bg-rose-100 border-rose-300" : "bg-slate-50 border-slate-200"}`}>
                      <div className={`text-[11px] font-bold mb-1 flex items-center gap-1.5 ${isAlarm ? "text-rose-900" : "text-[#0056b3]"}`}>
                        <SubDot light={lights04[1]} />2 號機械手臂 · AF800{isAlarm ? "：E-402" : ""}
                      </div>
                      <div className={`text-[10px] leading-relaxed ${isAlarm ? "text-rose-700 font-bold" : "text-slate-600"}`}>
                        {isAlarm ? "J2 伺服過載 142%" : "物料區 › 自檢成品 › 成品區"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 05 品檢入庫 AGV */}
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col gap-2 min-h-[260px]">
                  <div className="flex justify-between text-[12px] font-mono font-bold">
                    <span>05 品檢入庫 AGV</span>
                    {(() => {
                      const b = stationBadge(["green", "green"]);
                      return <span className={b.cls}>● {b.label}</span>;
                    })()}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1">
                      <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center gap-1.5">
                        <SubDot light="green" />3 號 AGV · 1 號手臂
                      </div>
                      <div className="text-[10px] text-slate-600 leading-relaxed">成品區搬運 › 品檢區</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200 flex-1">
                      <div className="text-[11px] font-bold text-[#0056b3] mb-1 flex items-center gap-1.5">
                        <SubDot light="green" />4 號 AGV · 2 號手臂
                      </div>
                      <div className="text-[10px] text-slate-600 leading-relaxed">成品區搬運 › 品檢區</div>
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
                  語音開單即時看板
                </h2>
                <span className="text-xs font-mono font-semibold text-slate-600">
                  {openCount} 待修＋{resolvedCount} 已完成
                </span>
              </div>
              {latestTickets.length === 0 ? (
                <div className="text-center text-slate-500 text-xs py-3 font-mono">
                  等待語音開單…　跟 Model宇宙 說「開維修單」試試
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 border-b font-mono text-slate-600">
                      <tr>
                        <th className="p-2">工單</th><th className="p-2">機台</th><th className="p-2">症狀</th><th className="p-2">嚴重度</th><th className="p-2">狀態</th><th className="p-2">時間</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {latestTickets.map((t) => {
                        const done = (t.status ?? "open") === "resolved";
                        return (
                          <tr key={t.ticket_id} className={done ? "bg-emerald-50/60" : undefined}>
                            <td className="p-2 font-mono font-bold text-[#0056b3]">{t.ticket_id}</td>
                            <td className="p-2 font-mono">{t.machine_id}</td>
                            <td className="p-2">{t.symptom}</td>
                            <td className="p-2 text-amber-700 font-bold">{t.severity}</td>
                            <td className="p-2">
                              {done ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-300">
                                  已完成
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300">
                                  待修
                                </span>
                              )}
                            </td>
                            <td className="p-2 font-mono text-slate-500">{new Date(t.created_at).toLocaleTimeString("zh-TW", { hour12: false })}</td>
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
                    <span>伺服軸即時監控 (ROBOT-02)</span>
                    <span className="text-rose-600 font-bold">E-402 警報中</span>
                  </div>
                  <div className="flex justify-between p-1.5 bg-white rounded border"><span>J1 BASE:</span><span>+124.500 mm (32%)</span></div>
                  <div className="flex justify-between p-1.5 bg-rose-100 rounded border border-rose-400 font-bold text-rose-900">
                    <span>J2 SHOULDER:</span><span>-48.210 mm (142% 超載)</span>
                  </div>
                  <div className="flex justify-between p-1.5 bg-white rounded border"><span>J3 ELBOW:</span><span>+982.015 mm (28%)</span></div>
                </section>
                <section className="hh-card rounded-lg p-4 text-xs font-sans space-y-2">
                  <div className="font-bold border-b border-[#9aa3b4] pb-1 flex justify-between">
                    <span>AI 大腦最新自主行動摘要</span>
                    <span className="text-emerald-700 font-mono font-bold">CLOSED-LOOP</span>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-300">
                    <div className="text-rose-700 font-bold text-[11px]">● 已致電原廠報修 (13:10:15)</div>
                    <div className="text-[11px] text-slate-700 mt-0.5">預約工程師今日 15:00 到廠排查 J2 軸卡料。</div>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-300">
                    <div className="text-amber-800 font-bold text-[11px]">● 已致電材料供應商 (12:45:00)</div>
                    <div className="text-[11px] text-slate-700 mt-0.5">S45C 鋼材庫存偏低，自動叫料 200 支，明日 09:00 前送達。</div>
                  </div>
                </section>
              </div>
              <button
                type="button"
                onClick={clearAlarm}
                className="w-full py-2.5 rounded-lg text-sm font-bold bg-[#b71c1c] hover:bg-[#c62828] text-white border border-[#7f0000] shadow-md transition flex items-center justify-center gap-2"
              >
                <span aria-hidden="true">●</span>
                解除警報（跟語音「解除警報」/ F6 同一個功能）
              </button>
              </div>
            )}
          </div>

          {/* ============ F2 AGV（原樣） ============ */}
          <div className={view === "f2" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="truck" className="w-5 h-5 text-[#0056b3]" />
                AGV 車隊手動即時調度中心
              </h2>
              <span className="text-xs font-mono text-slate-600">FLEET: 4 UNITS ACTIVE</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 bg-slate-900 rounded-lg overflow-hidden border-2 border-slate-700 relative shadow-inner">
                <div className="absolute top-2 left-3 z-10 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
                  <span className="font-mono text-xs font-bold text-white bg-black/60 px-2 py-0.5 rounded">● CAM-01: AGV-02 導航前視鏡頭 [LIVE]</span>
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
                      路徑鎖定：➔ 1號手臂備料區 (7.4m)
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
                    <span className="font-bold font-mono text-xs">AGV-01 (下料搬運車)</span>
                    <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold">運行中</span>
                  </div>
                  <div className="text-[11px] text-slate-600">碼頭卸貨 ➜ WMS 立體庫 (電量 88%)</div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => dispatchAgv("AGV-01", "返回碼頭")} className="flex-1 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-xs font-bold">調回碼頭</button>
                    <button type="button" onClick={() => dispatchAgv("AGV-01", "前往充電樁")} className="py-1.5 px-3 bg-slate-200 hover:bg-slate-300 rounded text-xs font-bold">回充</button>
                  </div>
                </div>
                <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold font-mono text-xs">AGV-02 (補料出庫車)</span>
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">視訊連線中</span>
                  </div>
                  <div className="text-[11px] text-slate-600">立體倉出料口待命位 (電量 95%)</div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => dispatchAgv("AGV-02", "送料至 1 號手臂")} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold">補料至 1 號手臂</button>
                    <button type="button" onClick={() => dispatchAgv("AGV-02", "送料至 2 號手臂")} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold">補料至 2 號手臂</button>
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
                六軸機械手臂精細數據與扭矩頻譜分析 (ROBOT-02)
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
                  <span className="font-bold text-slate-800">J1 底座旋轉軸 (BASE)</span>
                  <span className="font-bold text-emerald-700">32%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "32%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>角度: +124.5°</div><div>轉速: 120 RPM</div><div>電流: 4.2 A</div><div>溫度: 42°C</div><div>振動: 0.8 mm/s</div><div className="text-emerald-700 font-bold">狀態: 正常</div>
                </div>
              </div>
              {/* J2：警報時 142% 紅卡；解除後跟著轉正常綠卡（跟語音說的同步） */}
              {isAlarm ? (
              <div className="p-3 bg-rose-50 border-2 border-rose-500 rounded space-y-2 shadow-sm">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-black text-rose-900">J2 大臂俯仰軸 (SHOULDER)</span>
                  <span className="font-black text-rose-700 animate-pulse">142% [超標]</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-rose-600 h-full rounded-full" style={{ width: "100%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-rose-900 pt-1 border-t border-rose-300 font-bold">
                  <div>角度: -48.2°</div><div>轉速: 0 RPM</div><div className="text-rose-700">電流: 18.9 A</div><div>溫度: 78°C</div><div>振動: 4.6 mm/s</div><div className="text-rose-700">狀態: 卡死鎖定</div>
                </div>
              </div>
              ) : (
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">J2 大臂俯仰軸 (SHOULDER)</span>
                  <span className="font-bold text-emerald-700">36%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "36%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>角度: -48.2°</div><div>轉速: 90 RPM</div><div>電流: 5.1 A</div><div>溫度: 45°C</div><div>振動: 0.9 mm/s</div><div className="text-emerald-700 font-bold">狀態: 正常</div>
                </div>
              </div>
              )}
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">J3 小臂關節軸 (ELBOW)</span>
                  <span className="font-bold text-emerald-700">28%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "28%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>角度: +98.0°</div><div>轉速: 85 RPM</div><div>電流: 3.8 A</div><div>溫度: 39°C</div><div>振動: 0.6 mm/s</div><div className="text-emerald-700 font-bold">狀態: 正常</div>
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">J4 腕部旋轉軸 (WRIST 1)</span>
                  <span className="font-bold text-emerald-700">15%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "15%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>角度: +0.0°</div><div>轉速: 0 RPM</div><div>電流: 1.2 A</div><div>溫度: 35°C</div><div>振動: 0.2 mm/s</div><div className="text-emerald-700 font-bold">狀態: 正常</div>
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">J5 腕部俯仰軸 (WRIST 2)</span>
                  <span className="font-bold text-emerald-700">18%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "18%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>角度: -30.0°</div><div>轉速: 0 RPM</div><div>電流: 1.6 A</div><div>溫度: 36°C</div><div>振動: 0.3 mm/s</div><div className="text-emerald-700 font-bold">狀態: 正常</div>
                </div>
              </div>
              <div className="p-3 bg-white rounded border border-slate-300 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">J6 末端法蘭夾爪 (FLANGE)</span>
                  <span className="font-bold text-emerald-700">10%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: "10%" }} />
                </div>
                <div className="grid grid-cols-3 text-[10px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>氣壓: 0.62 MPa</div><div>夾緊力: 150 N</div><div>電流: 0.9 A</div><div>開合行程: 45mm</div><div>磁簧感應: ON</div><div className="text-emerald-700 font-bold">狀態: 閉合保壓</div>
                </div>
              </div>
            </div>
            <div className="p-3 bg-white rounded border border-slate-300 text-xs font-sans space-y-1">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <i data-lucide="wrench" className="w-4 h-4 text-rose-600" />
                機台專家系統診斷與即時排除建議：
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                {isAlarm
                  ? "J2 軸伺服扭矩於 13:10:02 發生階躍型過載（峰值達 142% 額定扭矩），系統已觸發硬體煞車安全連鎖。AI 研判內部減速機或導軌異物卡阻，已完成原廠緊急報修，工單單號：#TICKET-8902。"
                  : "各軸負載正常（J2 回到 36%），無過載警報。歷史工單：#TICKET-8902（已結案）。"}
              </p>
            </div>
          </div>

          {/* ============ F4 原料庫存（原樣） ============ */}
          <div className={view === "f4" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="package" className="w-5 h-5 text-[#0056b3]" />
                立體倉原料庫存監控與 AI 自動叫料
              </h2>
              <span className="text-xs font-mono text-slate-600">ERP / WMS LIVE</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-6 bg-slate-900 rounded-lg overflow-hidden border-2 border-slate-700 relative shadow-inner">
                <div className="absolute top-2 left-3 z-10 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
                  <span className="font-mono text-xs font-bold text-white bg-black/60 px-2 py-0.5 rounded">● CAM-02: 原料立體倉 03 貨架全景 [LIVE]</span>
                </div>
                <div className="absolute top-2 right-3 z-10 font-mono text-[11px] text-amber-400 bg-black/60 px-2 py-0.5 rounded">
                  AI 物體辨識：低於安全庫存
                </div>
                <div className="h-60 w-full bg-gradient-to-b from-slate-950 via-slate-800 to-slate-900 flex flex-col justify-between p-4 relative cam-overlay">
                  <div className="mt-6 flex justify-between text-[11px] font-mono text-slate-300">
                    <div>RACK: B-03-A<br />CAPACITY: 42%</div>
                    <div className="text-right">TEMP: 22.4°C<br />HUMID: 48%</div>
                  </div>
                  <div className="w-44 h-24 mx-auto border-2 border-dashed border-amber-400 bg-amber-500/10 rounded flex flex-col items-center justify-center text-center p-1">
                    <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-950/80 px-1 rounded">MAT-S45C-50</span>
                    <span className="text-[10px] text-rose-400 font-bold mt-1">▲ 剩餘 35 支 (警戒線 50)</span>
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
                      <th className="p-2">料號 / 品名</th>
                      <th className="p-2">庫存</th>
                      <th className="p-2">下限</th>
                      <th className="p-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-slate-700">
                    <tr className="bg-amber-50">
                      <td className="p-2 font-bold font-mono">S45C 圓棒材 Ø50</td>
                      <td className="p-2 font-bold text-rose-700">35 支</td>
                      <td className="p-2 font-mono">50 支</td>
                      <td className="p-2 text-right">
                        <button type="button" onClick={() => callSupplierManual("S45C 圓棒材")} className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-bold">催料通話</button>
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2 font-mono">AL6061 方棒 30x30</td>
                      <td className="p-2 font-bold text-emerald-700">180 支</td>
                      <td className="p-2 font-mono">60 支</td>
                      <td className="p-2 text-right text-slate-400">-</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-mono">SUS304 棒材 Ø20</td>
                      <td className="p-2 font-bold text-emerald-700">92 支</td>
                      <td className="p-2 font-mono">40 支</td>
                      <td className="p-2 text-right text-slate-400">-</td>
                    </tr>
                  </tbody>
                </table>
                {supplierMsg && (
                  <div className="p-2 bg-blue-50 border border-blue-300 rounded text-xs font-mono text-blue-800">
                    {supplierMsg}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ============ F5 AI 通話紀錄（原樣） ============ */}
          <div className={view === "f5" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="phone-call" className="w-5 h-5 text-[#0056b3]" />
                AI 外部語音通話與採購報修紀錄明細
              </h2>
              <span className="text-xs font-mono text-slate-600">OUTBOUND AI LOG</span>
            </div>
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-white rounded border space-y-2">
                <div className="flex justify-between font-mono">
                  <span className="font-bold text-rose-700">● 機械手臂原廠緊急維修窗口 (通話 52 秒)</span>
                  <span className="text-slate-500">2026-09-19 13:10:15</span>
                </div>
                <div className="p-2 bg-slate-50 border rounded text-[11px] leading-relaxed text-slate-700">
                  AI:「2號手臂發生 E-402 伺服負載 142% 警報，現場無障礙物，判定內部卡料需工程師到廠。」<br />
                  原廠:「工單已成立，已指派工程師攜帶備品，預計 15:00 前抵達。」
                </div>
                <div className="text-[11px] text-emerald-700 font-bold">工單編號：#TICKET-8902 (預約確認)</div>
              </div>
              <div className="p-3 bg-white rounded border space-y-2">
                <div className="flex justify-between font-mono">
                  <span className="font-bold text-amber-800">● 晉茂鋼鐵業務窗口 (通話 38 秒)</span>
                  <span className="text-slate-500">2026-09-19 12:45:00</span>
                </div>
                <div className="p-2 bg-slate-50 border rounded text-[11px] leading-relaxed text-slate-700">
                  AI:「李經理，S45C Ø50 圓棒庫存已跌破安全線，請依協議緊急配送 200 支。」<br />
                  供應商:「有現貨，已排明日第一班車送達。」
                </div>
                <div className="text-[11px] text-emerald-700 font-bold">EDI 採購單：#PO-20260919-01 (已出單)</div>
              </div>
            </div>
          </div>
        </main>

        {/* ============ 右側：F1–F6 軟鍵 ＋ Model宇宙 語音管家 ============ */}
        <aside className="w-full lg:w-72 flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => switchTab("f1")} className={`hh-softkey py-3 px-3.5 rounded-lg text-left text-xs font-bold text-[#202731] flex justify-between items-center shadow-sm${view === "f1" ? " active" : ""}`}>
              <span className="font-mono text-sm">F1: 流程監控總覽</span>
              <i data-lucide="chevron-right" className="w-4 h-4 text-slate-500" />
            </button>
            <button type="button" onClick={() => switchTab("f2")} className={`hh-softkey py-3 px-3.5 rounded-lg text-left text-xs font-bold text-[#202731] flex justify-between items-center shadow-sm${view === "f2" ? " active" : ""}`}>
              <span className="font-mono text-sm">F2: AGV 車隊手動調度</span>
              <i data-lucide="chevron-right" className="w-4 h-4 text-slate-500" />
            </button>
            <button type="button" onClick={() => switchTab("f3")} className={`hh-softkey py-3 px-3.5 rounded-lg text-left text-xs font-bold text-[#202731] flex justify-between items-center shadow-sm${view === "f3" ? " active" : ""}`}>
              <span className="font-mono text-sm">F3: 手臂軸向數據分析</span>
              <i data-lucide="chevron-right" className="w-4 h-4 text-slate-500" />
            </button>
            <button type="button" onClick={() => switchTab("f4")} className={`hh-softkey py-3 px-3.5 rounded-lg text-left text-xs font-bold text-[#202731] flex justify-between items-center shadow-sm${view === "f4" ? " active" : ""}`}>
              <span className="font-mono text-sm">F4: 原料庫存與補叫料</span>
              <i data-lucide="chevron-right" className="w-4 h-4 text-slate-500" />
            </button>
            <button type="button" onClick={() => switchTab("f5")} className={`hh-softkey py-3 px-3.5 rounded-lg text-left text-xs font-bold text-[#202731] flex justify-between items-center shadow-sm${view === "f5" ? " active" : ""}`}>
              <span className="font-mono text-sm">F5: AI 外部通訊錄明細</span>
              <i data-lucide="chevron-right" className="w-4 h-4 text-slate-500" />
            </button>
            <button type="button" onClick={clearAlarm} className="py-3 px-3.5 rounded-lg text-left text-xs font-bold bg-[#b71c1c] hover:bg-[#c62828] text-white border border-[#7f0000] shadow-md flex justify-between items-center transition">
              <span className="font-mono text-sm font-bold">F6: 警報靜音 / 重置</span>
              <i data-lucide="bell-off" className="w-4 h-4 text-rose-200" />
            </button>
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
            className="mv-dialog w-72 hh-card rounded-lg p-3 flex flex-col gap-2 bg-white shadow-xl"
            onMouseDown={recallOrb}
          >
            <div
              className="w-full pb-1 border-b border-[#9aa3b4] flex justify-between items-center cursor-move"
              onMouseDown={handleDialogMouseDown}
              title="拖這裡可以移動浮層"
            >
              {/* 不用 lucide 圖示：對話框會整個 unmount，lucide 換掉的節點會讓 React removeChild 炸掉 */}
              <span className="text-xs font-bold text-[#202731] flex items-center gap-1">
                <span className="text-[#0056b3]" aria-hidden="true">●</span>
                MODEL宇宙 語音管家
              </span>
              <div className="flex items-center gap-1.5">
                <div className={mvListening ? "flex items-center gap-1" : "hidden items-center gap-1"}>
                  <span className="wave-bar" /><span className="wave-bar" /><span className="wave-bar" /><span className="wave-bar" />
                </div>
                <button
                  type="button"
                  onClick={() => setVoiceOn((v) => !v)}
                  title="開關宇宙的語音回覆"
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100"
                >
                  {voiceOn ? "🔊 語音開" : "🔇 語音關"}
                </button>
                <button
                  type="button"
                  onClick={closeDialog}
                  title="收回對話框"
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-300 hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="w-full p-2 bg-white rounded border border-slate-400 text-[11px] font-sans text-slate-800 leading-snug min-h-[52px]">
              {mvReply}
            </div>
            <form
              className="w-full flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                runModelCommand(mvDraft);
              }}
            >
              <input
                ref={inputRef}
                id="mv-command"
                name="mv-command"
                value={mvDraft}
                onChange={(e) => setMvDraft(e.target.value)}
                placeholder="打字，或點宇宙球用講的"
                autoComplete="off"
                className="flex-1 rounded border border-slate-400 bg-white px-2 py-1.5 text-xs text-slate-800"
              />
              <button type="submit" className="rounded bg-[#0056b3] hover:bg-blue-700 px-2.5 py-1.5 text-xs font-bold text-white">
                送
              </button>
            </form>
            <div className="text-[10px] text-slate-400 font-mono leading-relaxed">
              試試說：F1、手臂數據、查警報 414、開維修單、解除警報…
            </div>
          </div>
        )}
        <button
          type="button"
          onMouseDown={handleOrbMouseDown}
          onTouchStart={(e) => orbPress(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={(e) => orbMove(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={orbRelease}
          aria-pressed={mvListening}
          aria-label="Model宇宙語音球：點一下說話，拖曳移動"
          title="點一下說話，拖曳移動"
          className={`mv-orb w-24 h-24 flex items-center justify-center${mvListening ? " listening" : ""}`}
        >
          {/* 球面只留星空漸層＋高光＋mic，不放文字 */}
          <i data-lucide="mic" className="w-8 h-8 text-white drop-shadow" />
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
