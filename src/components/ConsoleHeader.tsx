"use client";

// 看板/操作員/簡報頁共用的 CNC-640 深色頂欄（首頁自帶完整頂欄，不用這個）。
// title 由各頁傳入；時鐘用固定初值避免 SSR/CSR hydration 不一致，掛載後每秒更新。
// 手機版（<640px）：隱藏 AUTO RUN／READY 裝飾，標題可截斷，時鐘一定看得到、不爆版。

import { useEffect, useState } from "react";

export default function ConsoleHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="bg-[#202731] text-white px-4 sm:px-6 py-2.5 flex justify-between items-center gap-2 border-b-2 border-[#12161c] shadow-md">
      <div className="flex items-center gap-3 min-w-0">
        <div className="bg-[#0056b3] text-white font-black text-sm px-3 py-1 tracking-wider uppercase rounded-sm border border-blue-400 shrink-0">
          CNC-640
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm sm:text-base tracking-wide truncate">
              {title}
            </span>
            <span className="hidden sm:inline-block text-xs px-2 py-0.5 rounded bg-emerald-900/80 text-emerald-300 font-mono font-semibold border border-emerald-600 shrink-0">
              AUTO RUN
            </span>
          </div>
          {subtitle ? (
            <div className="text-[11px] text-slate-400 font-mono truncate">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3 font-mono text-xs shrink-0">
        <div className="hidden sm:flex items-center gap-1.5 bg-[#14181f] px-3 py-1.5 rounded border border-slate-700">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-emerald-400 font-bold">READY</span>
        </div>
        <div className="bg-black/60 px-3 py-1.5 rounded border border-slate-700 text-amber-300 font-bold text-sm tracking-wider">
          {clock}
        </div>
      </div>
    </header>
  );
}
