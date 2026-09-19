"use client";

// 看板資料線：首頁＝車間控制台風格（自有樣式，不含任何第三方品牌字樣）。
// - 版式（依主控派工單文字描述還原；原始 HTML 全文未收到，見交接檔 13n）：
//   頂部深色列（VoiceAndon｜Smart Factory Console＋綠色 AUTO RUN｜READY/ALARM＋時間）、
//   5 站卡（01碼頭–05品檢，紅框標示實際告警站）、左下伺服 J1–J3、右下 AI 摘要 CLOSED-LOOP、
//   F1–F6 橫排軟鍵、底部 STATUS 列。
//   語音卡保持固定寬度（不拉全寬），置於主內容最底下置中；右側語音區已移除。
// - CSS 變數 --hh-bg:#c9d0db、--hh-panel:#dce2ec 照派工單採用；其餘為同色系延伸。
// - F1–F6 可點、可按鍵盤 F1–F6 真切換；內容只用 src/data 現有 M01–M05 / 警報 / 保養（自編示範資料）。
//   F2 AGV 4 台可點派車（本機狀態、不控制真車）；F3 J1–J6 負載/溫度每 1.5 秒本機跳動（示意、非感測值）；
//   F4 S45C 庫存 <50 紅字＋一鍵催料鈕（本機旗標、未連線）；F5 通訊錄明細（虛構技師＋示範單號 #TICKET-8902 / #PO-DEMO-…）；
//   F6 重置（只清本頁預覽狀態，F6 燈回綠；實際機台狀態以 F1 為準）。
// - 語音鍵：按住說話（mousedown / mouseup＋觸控），波形為本機示意動畫；不改語音線任何邏輯，
//   不連 AssemblyAI、不讀金鑰。真的語音 Demo 走 /operator（語音線負責）。

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import alarmsData from "../data/alarms.json" with { type: "json" };
import machinesData from "../data/machines.json" with { type: "json" };
import maintenanceData from "../data/maintenance.json" with { type: "json" };

interface Machine {
  id: string;
  name: string;
  location: string;
  status: string;
  current_alarm: string | null;
  material_left: number;
}

interface Alarm {
  code: string;
  title: string;
  likely_causes: string;
  first_checks: string[];
  severity: string;
  needs_technician: boolean;
}

interface MaintenanceRecord {
  machine_id: string;
  date: string;
  item: string;
  technician: string;
}

const machines = machinesData as Machine[];
const alarms = alarmsData as Alarm[];
const maintenanceRecords = maintenanceData as MaintenanceRecord[];

type FuncKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";

const FUNC_KEYS: { key: FuncKey; label: string; hint: string }[] = [
  { key: "F1", label: "Overview", hint: "5 stations" },
  { key: "F2", label: "Transport", hint: "4 AGVs" },
  { key: "F3", label: "Axis data", hint: "J1–J6 live" },
  { key: "F4", label: "Stock", hint: "S45C" },
  { key: "F5", label: "Contacts", hint: "tickets / POs" },
  { key: "F6", label: "Mute / Reset", hint: "back to green" },
];

// 站號中文名：派工單只給 01碼頭、05品檢，中間三站不猜，用資料 location。
const STATION_NAMES: Record<string, string> = {
  M01: "01 · 碼頭",
  M02: "02",
  M03: "03",
  M04: "04",
  M05: "05 · 品檢",
};

function lampClass(status: string): string {
  if (status === "alarm") return "hh-lamp hh-lamp-alarm";
  if (status === "stopped") return "hh-lamp hh-lamp-stopped";
  return "hh-lamp hh-lamp-ready";
}

function lampText(status: string): string {
  if (status === "alarm") return "ALARM";
  if (status === "stopped") return "STOP";
  return "READY";
}

type AgvStatus = "idle" | "enroute" | "charging";

interface Agv {
  id: string;
  route: string;
  battery: number;
  status: AgvStatus;
  task: string;
}

// 4 台 AGV 初始狀態（全虛構示意數字，不控制真車）。
const AGV_INITIAL: Agv[] = [
  { id: "AGV-1", route: "Bay A → Bay B", battery: 76, status: "idle", task: "Standby at Bay A (demo)" },
  { id: "AGV-2", route: "Bay C loop", battery: 94, status: "charging", task: "Charging at Bay C dock (demo)" },
  { id: "AGV-3", route: "Bay B → Wash", battery: 61, status: "idle", task: "Standby at Bay B (demo)" },
  { id: "AGV-4", route: "WH → Bay A", battery: 55, status: "idle", task: "Standby at warehouse (demo)" },
];

interface Joint {
  joint: string;
  load: number; // %（虛構示意）
  temp: number; // °C（虛構示意）
}

// 手臂 J1–J6 初始值（虛構示意，非感測值）。
const JOINT_INITIAL: Joint[] = [
  { joint: "J1", load: 32, temp: 41.5 },
  { joint: "J2", load: 45, temp: 44.0 },
  { joint: "J3", load: 28, temp: 40.2 },
  { joint: "J4", load: 51, temp: 46.8 },
  { joint: "J5", load: 22, temp: 39.4 },
  { joint: "J6", load: 18, temp: 38.1 },
];

// F5 示範單號（全虛構，只做通訊錄明細示意，不對應真實工單／採購單）。
const DEMO_TICKETS = ["#TICKET-8902", "#TICKET-8905", "#TICKET-8911"];
const DEMO_POS = ["#PO-DEMO-0841", "#PO-DEMO-0842", "#PO-DEMO-0843"];

function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function Home() {
  const [funcKey, setFuncKey] = useState<FuncKey>("F1");
  const [muted, setMuted] = useState(false);
  const [talking, setTalking] = useState(false);
  const [voiceLine, setVoiceLine] = useState(
    "Hold the voice key and speak. This console shows a local waveform preview only.",
  );
  const [clock, setClock] = useState("");
  // F1：點選機台看明細。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // F2：4 台 AGV 派車狀態（本機）。
  const [agvs, setAgvs] = useState<Agv[]>(AGV_INITIAL);
  const [agvMsg, setAgvMsg] = useState("Tap Dispatch on an idle AGV (console preview only, no vehicle is controlled).");
  // F3：J1–J6 本機跳動。
  const [joints, setJoints] = useState<Joint[]>(JOINT_INITIAL);
  const [jointTick, setJointTick] = useState("");
  // F4：S45C 催料旗標（本機、未連線）。
  const [urged, setUrged] = useState<Record<string, string>>({});
  // F6：重置回綠（只清本頁預覽）。
  const [resetMsg, setResetMsg] = useState("Console status: preview only. Press Reset to clear this page.");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  const talkingRef = useRef(false);

  const alarmByCode = useCallback((code: string | null) => {
    if (!code) return undefined;
    return alarms.find((a) => a.code === code);
  }, []);

  const alarmCount = machines.filter((m) => m.status === "alarm").length;

  // Clock (console header only).
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      setClock(`${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  // Physical F1–F6 keys switch screens (prevent browser help on F1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, FuncKey> = {
        F1: "F1",
        F2: "F2",
        F3: "F3",
        F4: "F4",
        F5: "F5",
        F6: "F6",
      };
      const target = map[e.key];
      if (target) {
        e.preventDefault();
        setFuncKey(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Waveform preview: local canvas animation only (no audio captured here).
  useEffect(() => {
    talkingRef.current = talking;
  }, [talking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bars = 48;
    let phase = 0;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#101315";
      ctx.fillRect(0, 0, w, h);
      const active = talkingRef.current && !muted;
      phase += active ? 0.55 : 0.05;
      for (let i = 0; i < bars; i++) {
        const base = active
          ? Math.abs(Math.sin(phase + i * 0.45)) * (h * 0.42) + 3
          : 3;
        const x = (w / bars) * i + 1;
        ctx.fillStyle = active ? "#7CFC9A" : "#3a4147";
        ctx.fillRect(x, h / 2 - base / 2, w / bars - 2, base);
      }
      // Center line.
      ctx.fillStyle = "#565e66";
      ctx.fillRect(0, h / 2, w, 1);
      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [muted]);

  // F3: J1–J6 本機即時跳動（示意數字，非感測值；切到別頁也繼續跑，耗電極低）。
  useEffect(() => {
    const id = setInterval(() => {
      setJoints((prev) =>
        prev.map((j) => {
          const load = Math.min(95, Math.max(5, j.load + (Math.random() * 6 - 3)));
          const temp = Math.min(72, Math.max(30, j.temp + (Math.random() * 1.2 - 0.6)));
          return {
            joint: j.joint,
            load: Math.round(load * 10) / 10,
            temp: Math.round(temp * 10) / 10,
          };
        }),
      );
      setJointTick(nowTime());
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const startTalk = useCallback(() => {
    if (muted) {
      setVoiceLine("Console is muted (F6). Unmute before the voice preview.");
      return;
    }
    setTalking(true);
    setVoiceLine("Listening (local preview)… release the key to finish.");
  }, [muted]);

  const stopTalk = useCallback(() => {
    setTalking((was) => {
      if (was) {
        // Demo preview text built from existing data (M03 / 414), no voice logic touched.
        setVoiceLine(
          "Preview: “Machine three has an alarm” → M03 / alarm 414 (Spindle load abnormal (demo)). Real voice demo runs on /operator.",
        );
      }
      return false;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", stopTalk);
    window.addEventListener("touchend", stopTalk);
    return () => {
      window.removeEventListener("mouseup", stopTalk);
      window.removeEventListener("touchend", stopTalk);
    };
  }, [stopTalk]);

  // F2 派車／召回（本機狀態）。
  const dispatchAgv = useCallback((id: string) => {
    setAgvs((prev) =>
      prev.map((a) =>
        a.id === id && a.status === "idle"
          ? { ...a, status: "enroute", task: `Blanks to M04 queue, dispatched ${nowTime()} (demo)` }
          : a,
      ),
    );
    setAgvMsg(`${id} dispatched to M04 queue at ${nowTime()} (demo preview, no vehicle is controlled).`);
  }, []);

  const recallAgv = useCallback((id: string) => {
    setAgvs((prev) =>
      prev.map((a) =>
        a.id === id && a.status === "enroute"
          ? { ...a, status: "idle", task: `Returned to standby ${nowTime()} (demo)` }
          : a,
      ),
    );
    setAgvMsg(`${id} recalled to standby (demo).`);
  }, []);

  // F4 催料（本機旗標，未連線）。
  const urgeOne = useCallback((id: string) => {
    setUrged((prev) => ({ ...prev, [id]: nowTime() }));
  }, []);

  const urgeAllLow = useCallback(() => {
    const t = nowTime();
    setUrged((prev) => {
      const next = { ...prev };
      for (const m of machines) {
        if (m.material_left < 50) next[m.id] = t;
      }
      return next;
    });
  }, []);

  // F6 重置回綠（只清本頁預覽狀態，不碰單子、不碰機台資料）。
  const resetConsole = useCallback(() => {
    setAgvs(AGV_INITIAL);
    setJoints(JOINT_INITIAL);
    setUrged({});
    setSelectedId(null);
    setMuted(false);
    setAgvMsg("Tap Dispatch on an idle AGV (console preview only, no vehicle is controlled).");
    setVoiceLine("Hold the voice key and speak. This console shows a local waveform preview only.");
    setResetMsg(`Console reset at ${nowTime()} — status lamp back to green (preview only).`);
  }, []);

  const technicians = Array.from(new Set(maintenanceRecords.map((r) => r.technician)));
  const alarm414 = alarms.find((a) => a.code === "414");
  const otherAlarms = alarms.filter((a) => a.code !== "414").slice(0, 3);
  const selected = machines.find((m) => m.id === selectedId);
  const selectedAlarm = alarmByCode(selected?.current_alarm ?? null);
  const selectedJobs = selected ? maintenanceRecords.filter((r) => r.machine_id === selected.id).slice(0, 2) : [];
  const lowStations = machines.filter((m) => m.material_left < 50);
  const dispatchedCount = agvs.filter((a) => a.status === "enroute").length;
  const servoJoints = joints.slice(0, 3);
  const alarmMachine = machines.find((m) => m.status === "alarm");
  const voiceState = muted ? "已靜音" : talking ? "錄音中" : "待命中";

  return (
    <main className="hh-root">
      <style>{`
        :root {
          --hh-bg: #c9d0db;
          --hh-panel: #dce2ec;
        }
        .hh-root { background: var(--hh-bg); color: #16191c; min-height: 100%; display: flex; flex-direction: column; }
        .hh-topbar { background: #23282d; color: #eef1f4; display: flex; align-items: center; gap: 16px; padding: 10px 16px; border-bottom: 4px solid #0f1113; }
        .hh-brand { font-weight: 800; letter-spacing: 0.04em; font-size: 20px; white-space: nowrap; }
        .hh-console { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; color: #c7d2dc; }
        .hh-auto { background: #2fbf5f; color: #06130a; font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: 4px; border: 2px solid #0b2b16; letter-spacing: 0.06em; }
        .hh-lamps { display: flex; gap: 8px; margin-left: auto; align-items: center; }
        .hh-lamp { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; border: 2px solid #0f1113; color: #0f1113; background: #8b939c; white-space: nowrap; }
        .hh-lamp::before { content: ""; width: 10px; height: 10px; border-radius: 999px; background: #4a5158; }
        .hh-lamp-ready { background: #2fbf5f; color: #06130a; }
        .hh-lamp-ready::before { background: #d6ffe2; box-shadow: 0 0 6px #d6ffe2; }
        .hh-lamp-alarm { background: #e5484d; color: #fff; animation: hh-blink 1s steps(2) infinite; }
        .hh-lamp-alarm::before { background: #fff; box-shadow: 0 0 8px #fff; }
        .hh-lamp-stopped { background: #f5a524; color: #241500; }
        .hh-lamp-stopped::before { background: #fff7e6; }
        @keyframes hh-blink { 50% { filter: brightness(0.75); } }
        .hh-main { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; flex: 1; }
        .hh-screen { background: var(--hh-panel); color: #16191c; border: 3px solid #0f1113; border-radius: 8px; padding: 14px; box-shadow: 0 2px 0 #0f1113; }
        .hh-screen-dark { background: #1b1f23; color: #e8edf1; }
        .hh-screen h2 { font-size: 14px; color: #4c555e; margin: 0 0 10px; font-weight: 700; letter-spacing: 0.06em; }
        .hh-screen-dark h2 { color: #9fb0bd; }
        .hh-card { background: #242a30; border: 1px solid #3a424b; border-radius: 6px; padding: 10px 12px; color: #e8edf1; }
        .hh-card-light { background: #f4f6f9; border: 1px solid #9aa3ad; color: #16191c; }
        .hh-card h3 { margin: 0 0 4px; font-size: 15px; }
        .hh-card-click { cursor: pointer; }
        .hh-card-click[aria-pressed="true"] { border-color: #7CFC9A; box-shadow: 0 0 0 2px #7CFC9A; }
        .hh-alarm-frame { border: 3px solid #e5484d; box-shadow: 0 0 0 2px #e5484d, 0 0 12px rgba(229,72,77,0.55); }
        .hh-meta { font-size: 12px; color: #aeb9c4; }
        .hh-card-light .hh-meta { color: #4c555e; }
        .hh-grid5 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
        .hh-midrow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
        @media (max-width: 760px) { .hh-midrow { grid-template-columns: 1fr; } }
        .hh-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .hh-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .hh-table th, .hh-table td { border: 1px solid #3a424b; padding: 6px 8px; text-align: left; }
        .hh-table th { background: #2b3239; color: #c7d2dc; }
        .hh-low { color: #ff8a8e; font-weight: 800; }
        .hh-card-light .hh-low { color: #c81e2b; }
        .hh-ok { color: #7CFC9A; font-weight: 800; }
        .hh-card-light .hh-ok { color: #137a3a; }
        .hh-fkeys { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
        @media (max-width: 760px) { .hh-fkeys { grid-template-columns: repeat(3, 1fr); } }
        .hh-softkey { background: linear-gradient(#f2f4f6, #c3c9d0); border: 2px solid #0f1113; border-bottom-width: 5px; border-radius: 8px; padding: 10px 8px; text-align: left; cursor: pointer; color: #14171a; min-height: 64px; }
        .hh-softkey small { display: block; font-size: 11px; color: #4c555e; }
        .hh-softkey strong { font-size: 15px; }
        .hh-softkey[aria-pressed="true"] { background: linear-gradient(#3a424b, #23282d); color: #fff; }
        .hh-softkey[aria-pressed="true"] small { color: #aeb9c4; }
        .hh-mini { background: #2fbf5f; border: 2px solid #0b2b16; border-bottom-width: 4px; border-radius: 6px; font-weight: 700; font-size: 13px; padding: 6px 10px; cursor: pointer; color: #06130a; margin-top: 8px; }
        .hh-mini:disabled { background: #6b7280; border-color: #374151; color: #e5e7eb; cursor: not-allowed; }
        .hh-mini-ghost { background: #39414a; border-color: #14181c; color: #e8edf1; }
        .hh-voice-wrap { display: flex; justify-content: center; }
        .hh-voice-card { width: 340px; max-width: 100%; background: #23282d; border: 3px solid #0f1113; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; align-items: center; gap: 10px; box-shadow: 0 2px 0 #0f1113; }
        .hh-talk-round { width: 108px; height: 108px; border-radius: 50%; background: #2fbf5f; border: 3px solid #0b2b16; border-bottom-width: 8px; font-weight: 800; font-size: 14px; cursor: pointer; color: #06130a; user-select: none; touch-action: none; }
        .hh-talk-round:active, .hh-talk-round[data-on="true"] { background: #e5484d; color: #fff; border-color: #4d0f12; }
        .hh-voice-state { color: #d7dee5; font-size: 13px; font-weight: 700; letter-spacing: 0.08em; }
        .wave-bar { width: 100%; height: 64px; border: 2px solid #0f1113; border-radius: 6px; display: block; background: #101315; }
        .hh-voiceline { color: #d7dee5; font-size: 12px; min-height: 18px; text-align: center; }
        .hh-statusbar { background: #23282d; color: #eef1f4; display: flex; align-items: center; gap: 10px; padding: 8px 16px; border-top: 4px solid #0f1113; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
        .hh-statusbar .hh-clock { margin-left: auto; font-size: 12px; color: #aeb6bf; font-variant-numeric: tabular-nums; }
        .hh-links { display: flex; gap: 10px; flex-wrap: wrap; font-size: 13px; padding: 0 16px 12px; background: var(--hh-bg); }
        .hh-links a { background: #fff; border: 2px solid #0f1113; border-radius: 6px; padding: 6px 10px; color: #14171a; font-weight: 600; text-decoration: none; }
        .hh-note { font-size: 12px; color: #3c444c; padding: 0 16px 16px; background: var(--hh-bg); }
        .hh-clock { font-size: 12px; color: #aeb6bf; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="hh-topbar">
        <div className="hh-brand">VoiceAndon</div>
        <div className="hh-console">
          Smart Factory Console
          <span className="hh-auto">AUTO RUN</span>
        </div>
        <div className="hh-lamps" role="status" aria-label="Shop status">
          <span className="hh-clock">{clock}</span>
          <span className={alarmCount > 0 ? "hh-lamp hh-lamp-alarm" : "hh-lamp hh-lamp-ready"}>
            {alarmCount > 0 ? `ALARM ×${alarmCount}` : "READY"}
          </span>
        </div>
      </div>

      <div className="hh-main">
        <section className="hh-screen hh-screen-dark" aria-label={`${funcKey} screen`} aria-live="polite">
          {funcKey === "F1" && (
            <div>
              <h2>F1 · OVERVIEW — 5 STATIONS (TAP A CARD)</h2>
              <div className="hh-grid5">
                {machines.map((m) => (
                  <div
                    key={m.id}
                    className={`hh-card hh-card-click${m.status === "alarm" ? " hh-alarm-frame" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedId === m.id}
                    onClick={() => setSelectedId((prev) => (prev === m.id ? null : m.id))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId((prev) => (prev === m.id ? null : m.id));
                      }
                    }}
                  >
                    <div className="hh-row">
                      <span className={lampClass(m.status)}>{lampText(m.status)}</span>
                      <h3>{STATION_NAMES[m.id] ?? m.id}</h3>
                    </div>
                    <div className="hh-meta">{m.id} · {m.name}</div>
                    <div className="hh-meta">{m.location}</div>
                    <div className="hh-meta">
                      Material left: {m.material_left}%{m.current_alarm ? ` · Alarm ${m.current_alarm}` : ""}
                    </div>
                    {m.current_alarm && (
                      <div className="hh-meta">
                        {alarmByCode(m.current_alarm)?.title ?? "Unknown alarm"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {selected ? (
                <div className="hh-card" style={{ marginTop: 10 }}>
                  <h3>
                    {selected.id} · {selected.name} — {selected.status.toUpperCase()}
                  </h3>
                  <div className="hh-meta">{selected.location} · Material left {selected.material_left}%</div>
                  {selectedAlarm ? (
                    <div style={{ marginTop: 6 }}>
                      <div className="hh-meta">
                        Alarm {selectedAlarm.code} · {selectedAlarm.title} · severity {selectedAlarm.severity}
                        {selectedAlarm.needs_technician ? " · needs technician" : ""}
                      </div>
                      <ol style={{ fontSize: 13, margin: "8px 0 0", paddingLeft: 18 }}>
                        {selectedAlarm.first_checks.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  ) : (
                    <div className="hh-meta" style={{ marginTop: 6 }}>
                      No active alarm on this station (demo data).
                    </div>
                  )}
                  {selectedJobs.length > 0 && (
                    <div className="hh-meta" style={{ marginTop: 6 }}>
                      Latest care: {selectedJobs.map((r) => `${r.date} ${r.item} (${r.technician})`).join(" · ")}
                    </div>
                  )}
                </div>
              ) : (
                <p className="hh-meta" style={{ marginTop: 8 }}>
                  Tap a station card to see its alarm detail and latest care (from demo data).
                </p>
              )}
              {alarm414 && (
                <div className="hh-card" style={{ marginTop: 10 }}>
                  <h3>Alarm 414 · {alarm414.title}</h3>
                  <div className="hh-meta">{alarm414.likely_causes}</div>
                  <ol style={{ fontSize: 13, margin: "8px 0 0", paddingLeft: 18 }}>
                    {alarm414.first_checks.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="hh-midrow">
                <div className="hh-card">
                  <h3>Servo monitor · J1–J3 (demo figures{jointTick ? ` · ${jointTick}` : ""})</h3>
                  {servoJoints.map((j) => (
                    <div key={j.joint} className="hh-row" style={{ marginTop: 4 }}>
                      <span className="hh-meta" style={{ width: 28 }}>{j.joint}</span>
                      <span className={j.load >= 70 ? "hh-low" : "hh-ok"}>Load {j.load.toFixed(1)}%</span>
                      <span className={j.temp >= 60 ? "hh-low" : ""} style={{ color: j.temp >= 60 ? undefined : "#aeb9c4" }}>
                        {j.temp.toFixed(1)}°C
                      </span>
                    </div>
                  ))}
                  <div className="hh-meta" style={{ marginTop: 6 }}>
                    Local random-walk preview — not sensor readings.
                  </div>
                </div>
                <div className="hh-card">
                  <h3>AI summary · CLOSED-LOOP (demo)</h3>
                  <div className="hh-meta">
                    {alarmMachine
                      ? `Open alarm on ${alarmMachine.id} (${alarmMachine.current_alarm ?? "—"}). Suggested loop: acknowledge → first checks → confirm → ticket.`
                      : "No open alarms. Loop closed: all 5 stations reporting normal (demo data)."}
                  </div>
                  <div className="hh-meta" style={{ marginTop: 4 }}>
                    Low stock stations: {lowStations.length === 0 ? "none" : lowStations.map((m) => m.id).join(", ")} (demo).
                  </div>
                </div>
              </div>
            </div>
          )}

          {funcKey === "F2" && (
            <div>
              <h2>F2 · TRANSPORT — 4 AGVs (TAP DISPATCH · DEMO ONLY)</h2>
              <div className="hh-grid5">
                {agvs.map((a) => (
                  <div key={a.id} className="hh-card">
                    <div className="hh-row">
                      <span className={a.status === "enroute" ? "hh-lamp hh-lamp-ready" : a.status === "charging" ? "hh-lamp hh-lamp-stopped" : "hh-lamp"}>
                        {a.status === "enroute" ? "ENROUTE" : a.status === "charging" ? "CHARGING" : "IDLE"}
                      </span>
                      <h3>{a.id}</h3>
                    </div>
                    <div className="hh-meta">{a.route}</div>
                    <div className="hh-meta">Battery {a.battery}% (demo figure)</div>
                    <div className="hh-meta">{a.task}</div>
                    {a.status === "idle" ? (
                      <button type="button" className="hh-mini" onClick={() => dispatchAgv(a.id)}>
                        Dispatch {a.id} → M04
                      </button>
                    ) : a.status === "enroute" ? (
                      <button type="button" className="hh-mini hh-mini-ghost" onClick={() => recallAgv(a.id)}>
                        Recall {a.id}
                      </button>
                    ) : (
                      <button type="button" className="hh-mini" disabled>
                        Charging… (demo)
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="hh-meta" style={{ marginTop: 8 }}>
                {agvMsg} Enroute now: {dispatchedCount} / 4. Positions are a static demo illustration, not live vehicle data; nothing here drives a real vehicle.
              </p>
            </div>
          )}

          {funcKey === "F3" && (
            <div>
              <h2>F3 · ARM J1–J6 — LOAD / TEMP (LIVE DEMO TICK{jointTick ? ` · UPDATED ${jointTick}` : ""})</h2>
              <table className="hh-table">
                <thead>
                  <tr>
                    <th>Joint</th>
                    <th>Load %</th>
                    <th>Temp °C</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {joints.map((j) => (
                    <tr key={j.joint}>
                      <td>{j.joint} · DEMO-ARM-01</td>
                      <td className={j.load >= 70 ? "hh-low" : ""}>{j.load.toFixed(1)}</td>
                      <td className={j.temp >= 60 ? "hh-low" : ""}>{j.temp.toFixed(1)}</td>
                      <td className={j.load >= 70 || j.temp >= 60 ? "hh-low" : "hh-ok"}>
                        {j.load >= 70 || j.temp >= 60 ? "HIGH (demo)" : "normal (demo)"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hh-meta" style={{ marginTop: 8 }}>
                Numbers tick every 1.5 s from a local random walk for the console layout only — not sensor readings, not connected to any machine.
              </p>
            </div>
          )}

          {funcKey === "F4" && (
            <div>
              <h2>F4 · STOCK — S45C ROUND BAR (FROM DEMO DATA · &lt;50 IN RED)</h2>
              <table className="hh-table">
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>S45C left</th>
                    <th>Note</th>
                    <th>Urge</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.map((m) => {
                    const low = m.material_left < 50;
                    return (
                      <tr key={m.id}>
                        <td>{m.id} · {m.name}</td>
                        <td className={low ? "hh-low" : ""}>
                          {m.material_left}%{low ? " ▼ LOW" : ""}
                        </td>
                        <td className={low ? "hh-low" : ""}>
                          {m.material_left === 0 ? "Empty — refill demo queue" : low ? "Below 50 — urge material (demo)" : "OK (demo)"}
                        </td>
                        <td>
                          {low ? (
                            urged[m.id] ? (
                              <span className="hh-ok">PO-DEMO-{m.id} sent {urged[m.id]} (demo)</span>
                            ) : (
                              <button type="button" className="hh-mini" onClick={() => urgeOne(m.id)}>
                                Urge {m.id}
                              </button>
                            )
                          ) : (
                            <span className="hh-meta">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="hh-row" style={{ marginTop: 10 }}>
                <button type="button" className="hh-mini" onClick={urgeAllLow} disabled={lowStations.length === 0}>
                  {lowStations.length === 0 ? "Nothing below 50 (demo)" : `Urge all ${lowStations.length} low stations at once`}
                </button>
                <span className="hh-meta">One tap marks every station below 50 as urged (local flag only, nothing is ordered).</span>
              </div>
            </div>
          )}

          {funcKey === "F5" && (
            <div>
              <h2>F5 · CONTACTS — SHOP TECHNICIANS (FICTIONAL · DEMO TICKETS / POs)</h2>
              <div className="hh-grid5">
                {technicians.map((t, i) => (
                  <div key={t} className="hh-card">
                    <h3>{t} (demo)</h3>
                    <div className="hh-meta">Maintenance · ext. 8{t.length}0{t.length} (demo)</div>
                    <div className="hh-meta">
                      Latest job: {maintenanceRecords.find((r) => r.technician === t)?.item ?? "—"}
                    </div>
                    <div className="hh-meta">Open ticket: {DEMO_TICKETS[i % DEMO_TICKETS.length]} (demo)</div>
                    <div className="hh-meta">Last PO: {DEMO_POS[i % DEMO_POS.length]} (demo)</div>
                  </div>
                ))}
              </div>
              {otherAlarms.length > 0 && (
                <div className="hh-card" style={{ marginTop: 10 }}>
                  <h3>Call a technician for (demo table)</h3>
                  <div className="hh-meta">
                    {otherAlarms
                      .filter((a) => a.needs_technician)
                      .map((a) => `${a.code} ${a.title}`)
                      .join(" · ") || "No technician-required demo alarms in this shortlist."}
                  </div>
                  <div className="hh-meta" style={{ marginTop: 4 }}>
                    Escalation demo trail: {DEMO_TICKETS[0]} → {DEMO_POS[0]} → on-site visit (all demo numbers, no real order).
                  </div>
                </div>
              )}
            </div>
          )}

          {funcKey === "F6" && (
            <div>
              <h2>F6 · MUTE / RESET — BACK TO GREEN (CONSOLE ONLY)</h2>
              <div className="hh-grid5">
                <div className="hh-card">
                  <div className="hh-row">
                    <span className={muted ? "hh-lamp hh-lamp-stopped" : "hh-lamp hh-lamp-ready"}>
                      {muted ? "MUTED" : "GREEN · ON"}
                    </span>
                    <h3>Console sound</h3>
                  </div>
                  <div className="hh-meta">Mute only affects this page preview, not /operator.</div>
                  <button
                    type="button"
                    className="hh-softkey"
                    style={{ marginTop: 8, minHeight: 0 }}
                    aria-pressed={muted}
                    onClick={() => setMuted((v) => !v)}
                  >
                    <strong>{muted ? "Unmute" : "Mute"}</strong>
                    <small>toggle preview sound flag</small>
                  </button>
                </div>
                <div className="hh-card">
                  <div className="hh-row">
                    <span className="hh-lamp hh-lamp-ready">GREEN</span>
                    <h3>Reset preview</h3>
                  </div>
                  <div className="hh-meta">Clears voice line, AGV dispatches, urge flags and selection on this page only. Repair tickets on /dashboard are untouched. Real station states stay as in F1.</div>
                  <button
                    type="button"
                    className="hh-softkey"
                    style={{ marginTop: 8, minHeight: 0 }}
                    onClick={resetConsole}
                  >
                    <strong>Reset — back to green</strong>
                    <small>clear this page preview</small>
                  </button>
                </div>
              </div>
              <p className="hh-meta" style={{ marginTop: 8 }}>{resetMsg}</p>
            </div>
          )}
        </section>

        <nav className="hh-fkeys" aria-label="Function keys">
          {FUNC_KEYS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="hh-softkey"
              aria-pressed={funcKey === f.key}
              onClick={() => setFuncKey(f.key)}
            >
              <strong>{f.key} · {f.label}</strong>
              <small>{f.hint} — click or press {f.key}</small>
            </button>
          ))}
        </nav>

        <div className="hh-voice-wrap">
          <div className="hh-voice-card" aria-label="Voice dispatch card">
            <button
              type="button"
              className="hh-talk-round"
              data-on={talking}
              aria-label="Hold to talk (demo preview)"
              onMouseDown={startTalk}
              onTouchStart={startTalk}
              onMouseUp={stopTalk}
              onMouseLeave={stopTalk}
            >
              {talking ? "● TALKING… release" : "HOLD TO TALK"}
            </button>
            <div className="hh-voice-state">{voiceState}</div>
            <canvas ref={canvasRef} className="wave-bar" width={300} height={64} aria-label="Voice waveform preview" />
            <div className="hh-voiceline" aria-live="polite">{muted ? "Console muted." : voiceLine}</div>
          </div>
        </div>
      </div>

      <div className="hh-statusbar" role="status" aria-label="Console status">
        <span className={alarmCount > 0 ? "hh-lamp hh-lamp-alarm" : "hh-lamp hh-lamp-ready"}>
          {alarmCount > 0 ? `STATUS · ALARM ×${alarmCount}` : "STATUS · READY"}
        </span>
        <span>{alarmMachine ? `${alarmMachine.id} / alarm ${alarmMachine.current_alarm ?? "—"} (demo)` : "All stations normal (demo)"}</span>
        <span className="hh-clock">{clock}</span>
      </div>

      <div className="hh-links">
        <Link href="/operator">Try the demo (/operator)</Link>
        <Link href="/dashboard">Supervisor board (/dashboard)</Link>
        <Link href="/pitch">Pitch (/pitch)</Link>
      </div>
      <p className="hh-note">
        All machines, alarm codes, maintenance records, AGV / arm figures, stock levels, names, ticket numbers
        ({DEMO_TICKETS.join(", ")}) and PO numbers ({DEMO_POS.join(", ")}) on this console are fictional sample data written
        for this project — not from any manufacturer manual, and describing no real machine, brand or company.
        Voice wiring on /operator is owned by the voice line; this page changes no voice logic.
      </p>
    </main>
  );
}
