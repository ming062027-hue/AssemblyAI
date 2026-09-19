"use client";

// 看板資料線：首頁＝ app/public/preview-cnc640.html（604 行、大銘定稿）的忠實 JSX 移植。
// - 文字／版式一字不加一字不減（HEIDENHAIN→CNC-640 的差別為零，該檔本來已是 CNC-640）。
// - 圖示照原稿用 lucide CDN（next/script 載入），不換文字符號。
// - onclick 內聯函式改為同名 React 回呼，行為與原稿 <script> 一致（含 alert、訊息自動隱藏、隨機示範句）。
// - 不接 machines.json／alarms.json、不 POST /api/voice-stream、不加語言下拉與 INTENT 框、不加底部 M01 條與警報對應條。

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

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

const SAMPLE_PHRASES = [
  "「請 AGV 2 號前往 1 號手臂區補送中碳鋼物料。」",
  "「Robot station 2 is running out of raw parts, send AGV immediately.」",
  "「2 號機械手臂卡阻，立刻指派原廠維修。」",
];

export default function Home() {
  const [view, setView] = useState<ViewKey>("f1");
  const [isAlarm, setIsAlarm] = useState(true);
  const [clock, setClock] = useState("13:15:00");
  const [agvMsg, setAgvMsg] = useState<string | null>(null);
  const [supplierMsg, setSupplierMsg] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [speechText, setSpeechText] = useState(SAMPLE_PHRASES[0]);
  const [voiceStatus, setVoiceStatus] = useState("待命中 (STANDBY)");
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setClock(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      if (msgTimer.current) clearTimeout(msgTimer.current);
    },
    [],
  );

  const refreshIcons = useCallback(() => {
    window.lucide?.createIcons();
  }, []);

  useEffect(() => {
    refreshIcons();
  }, [view, isRecordingVoice, isAlarm, refreshIcons]);

  const switchTab = useCallback((key: ViewKey) => {
    setView(key);
  }, []);

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

  const resetAlarm = useCallback(() => {
    if (isAlarm) {
      setIsAlarm(false);
      alert("已靜音全廠廣播，並重置系統報警狀態為正常待命。");
    } else {
      window.location.reload();
    }
  }, [isAlarm]);

  const toggleVoiceRecording = useCallback(() => {
    if (!isRecordingVoice) {
      setIsRecordingVoice(true);
      setVoiceStatus("語音辨識中...");
      setSpeechText("正在聆聽語音輸入...");
      return;
    }
    setIsRecordingVoice(false);
    setVoiceStatus("AI 語意解析完成");
    const randomText =
      SAMPLE_PHRASES[Math.floor(Math.random() * SAMPLE_PHRASES.length)];
    setSpeechText(randomText);
  }, [isRecordingVoice]);

  return (
    <main className="min-h-full flex flex-col select-none">
      <Script
        src="https://unpkg.com/lucide@latest"
        strategy="afterInteractive"
        onLoad={refreshIcons}
      />
      <style>{`
        :root {
          --hh-bg: #c9d0db;
          --hh-panel: #dce2ec;
          --hh-border: #7e889b;
          --hh-blue: #0056b3;
          --hh-text: #14181f;
        }
        .hh-card {
          background-color: var(--hh-panel);
          border: 1.5px solid var(--hh-border);
          box-shadow: inset 1px 1px 0px rgba(255,255,255,0.7), 2px 2px 5px rgba(0,0,0,0.08);
        }
        .hh-softkey {
          background: linear-gradient(180deg, #eef2f7 0%, #cbd3e0 100%);
          border: 1px solid #727c8d;
          box-shadow: inset 1px 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.15);
          transition: all 0.1s ease;
        }
        .hh-softkey:active {
          background: linear-gradient(180deg, #b8c2d1 0%, #d8dfea 100%);
          transform: translateY(1px);
        }
        .hh-softkey.active {
          border: 2px solid #0056b3;
          background: #e1ebf7;
        }
        .cam-overlay {
          background: repeating-linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.15),
            rgba(0, 0, 0, 0.15) 1px,
            transparent 1px,
            transparent 2px
          );
        }
        .wave-bar {
          display: inline-block;
          width: 3px;
          height: 10px;
          background-color: #0056b3;
          border-radius: 2px;
          animation: wave 1s ease-in-out infinite;
        }
        .wave-bar:nth-child(2) { animation-delay: 0.15s; }
        .wave-bar:nth-child(3) { animation-delay: 0.3s; }
        .wave-bar:nth-child(4) { animation-delay: 0.45s; }
        @keyframes wave {
          0%, 100% { height: 4px; }
          50% { height: 18px; }
        }
      `}</style>

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
          <div className={view === "f1" ? "space-y-4" : "space-y-4 hidden"}>
            <section className="hh-card rounded-lg p-4">
              <div className="flex justify-between items-center pb-2 mb-3 border-b border-[#9aa3b4]">
                <h2 className="text-sm font-bold flex items-center gap-2 text-[#202731]">
                  <i data-lucide="git-branch" className="w-4 h-4 text-[#0056b3]" />
                  自動化製程全節點即時監控
                </h2>
                <span className="text-xs font-mono font-semibold text-slate-600">STATIONS: 5 ACTIVE</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 font-sans">
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col justify-between">
                  <div className="flex justify-between text-[11px] font-mono font-bold">
                    <span>01 碼頭進貨</span><span className="text-emerald-700">● 正常</span>
                  </div>
                  <div className="my-3 text-center">
                    <i data-lucide="truck" className="w-7 h-7 mx-auto text-slate-700 mb-1" />
                    <div className="text-xs font-bold">卡車到貨卸料</div>
                    <div className="text-[10px] text-slate-500">批號 #TK-882</div>
                  </div>
                  <div className="text-[10px] p-1.5 rounded bg-slate-100 border text-center font-mono">進貨驗收完成</div>
                </div>
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col justify-between">
                  <div className="flex justify-between text-[11px] font-mono font-bold">
                    <span>02 下料 AGV</span><span className="text-blue-700">● 搬運中</span>
                  </div>
                  <div className="my-3 text-center">
                    <i data-lucide="bot" className="w-7 h-7 mx-auto text-[#0056b3] mb-1" />
                    <div className="text-xs font-bold">下料入庫登記</div>
                    <div className="text-[10px] text-slate-500">品名/數量/材質/廠商</div>
                  </div>
                  <div className="text-[10px] p-1.5 rounded bg-slate-100 border text-center font-mono">WMS 自動寫入</div>
                </div>
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col justify-between">
                  <div className="flex justify-between text-[11px] font-mono font-bold">
                    <span>03 取料 AGV</span><span className="text-amber-700">● 待命中</span>
                  </div>
                  <div className="my-3 text-center">
                    <i data-lucide="package-search" className="w-7 h-7 mx-auto text-amber-700 mb-1" />
                    <div className="text-xs font-bold">補料出庫調度</div>
                    <div className="text-[10px] text-slate-500">支援語音/缺料觸發</div>
                  </div>
                  <div className="text-[10px] p-1.5 rounded bg-slate-100 border text-center font-mono">排程調度中</div>
                </div>
                <div className="p-3 rounded flex flex-col justify-between bg-rose-50 border-2 border-rose-600 shadow-sm">
                  <div className="flex justify-between text-[11px] font-mono font-bold text-rose-800">
                    <span>04 手臂加工區</span><span className="animate-pulse font-black">● 警報</span>
                  </div>
                  <div className="my-3 text-center">
                    <i data-lucide="alert-triangle" className="w-7 h-7 mx-auto text-rose-600 mb-1" />
                    <div className="text-xs font-black text-rose-900">2號手臂：E-402</div>
                    <div className="text-[10px] text-rose-700">物料區 → 自檢 → 成品區</div>
                  </div>
                  <div className="text-[10px] p-1.5 rounded bg-rose-100 border border-rose-300 text-center font-mono font-bold text-rose-900">
                    J2 伺服過載 142%
                  </div>
                </div>
                <div className="p-3 bg-white/70 border border-[#9aa3b4] rounded flex flex-col justify-between">
                  <div className="flex justify-between text-[11px] font-mono font-bold">
                    <span>05 品檢入庫</span><span className="text-emerald-700">● 正常</span>
                  </div>
                  <div className="my-3 text-center">
                    <i data-lucide="check-check" className="w-7 h-7 mx-auto text-emerald-700 mb-1" />
                    <div className="text-xs font-bold">視覺品檢自檢</div>
                    <div className="text-[10px] text-slate-500">良率 99.4%</div>
                  </div>
                  <div className="text-[10px] p-1.5 rounded bg-slate-100 border text-center font-mono">自動入庫立體倉</div>
                </div>
              </div>
            </section>
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
          </div>

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

          <div className={view === "f3" ? "hh-card rounded-lg p-5 space-y-4" : "hidden hh-card rounded-lg p-5 space-y-4"}>
            <div className="flex justify-between items-center border-b border-[#9aa3b4] pb-2">
              <h2 className="text-base font-bold text-[#202731] flex items-center gap-2">
                <i data-lucide="activity" className="w-5 h-5 text-[#0056b3]" />
                六軸機械手臂精細數據與扭矩頻譜分析 (ROBOT-02)
              </h2>
              <span className="text-xs font-mono font-bold text-rose-700 bg-rose-100 border border-rose-300 px-2 py-0.5 rounded">
                E-402 OVER-TORQUE
              </span>
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
                J2 軸伺服扭矩於 13:10:02 發生階躍型過載（峰值達 142% 額定扭矩），系統已觸發硬體煞車安全連鎖。AI 研判內部減速機或導軌異物卡阻，已完成原廠緊急報修，工單單號：#TICKET-8902。
              </p>
            </div>
          </div>

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
            <button type="button" onClick={resetAlarm} className="py-3 px-3.5 rounded-lg text-left text-xs font-bold bg-[#b71c1c] hover:bg-[#c62828] text-white border border-[#7f0000] shadow-md flex justify-between items-center transition">
              <span className="font-mono text-sm font-bold">F6: 警報靜音 / 重置</span>
              <i data-lucide="bell-off" className="w-4 h-4 text-rose-200" />
            </button>
          </div>
          <div className="hh-card rounded-lg p-3 text-center flex flex-col items-center mt-auto border-2 border-slate-400">
            <div className="w-full text-left pb-1 mb-1 border-b border-[#9aa3b4] flex justify-between items-center">
              <span className="text-xs font-bold text-[#202731] flex items-center gap-1">
                <i data-lucide="mic" className="w-3.5 h-3.5 text-[#0056b3]" /> 語音調度
              </span>
              <div className={isRecordingVoice ? "flex items-center gap-1" : "hidden items-center gap-1"}>
                <span className="wave-bar" /><span className="wave-bar" /><span className="wave-bar" /><span className="wave-bar" />
              </div>
            </div>
            <button
              type="button"
              onClick={toggleVoiceRecording}
              aria-pressed={isRecordingVoice}
              className={`w-20 h-20 my-2 rounded-full hh-softkey flex flex-col items-center justify-center border-2 border-[#596579] active:scale-95 shadow-md transition${isRecordingVoice ? " border-rose-500 bg-rose-100" : ""}`}
            >
              <i data-lucide="mic" className={`w-7 h-7 ${isRecordingVoice ? "text-rose-600" : "text-[#0056b3]"}`} />
              <span className={`text-[10px] font-bold mt-1 ${isRecordingVoice ? "text-rose-800" : "text-slate-800"}`}>
                {isRecordingVoice ? "停止辨識" : "點擊說話"}
              </span>
            </button>
            <div className={`text-[11px] font-mono font-bold ${isRecordingVoice ? "text-rose-600 animate-pulse" : voiceStatus === "AI 語意解析完成" ? "text-emerald-700" : "text-slate-600"}`}>
              {voiceStatus}
            </div>
            <div className="w-full mt-2 text-left">
              <div className="text-[10px] font-mono text-slate-500 mb-0.5">剛剛說話內容紀錄 (TRANSCRIPT)：</div>
              <div className="w-full min-h-[48px] p-2 bg-white rounded border border-slate-400 text-xs font-sans text-slate-800 leading-snug">
                {speechText}
              </div>
            </div>
          </div>
        </aside>
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
        </div>
      </footer>
    </main>
  );
}
