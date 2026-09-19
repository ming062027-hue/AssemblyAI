// 看板/操作員頁共用的 CNC-640 深色頁尾，帶版本號（家規 §八：版本號要看得到）。

import { SITE_NAME, SITE_VERSION, SITE_YEAR } from "@/config/site";

export default function ConsoleFooter() {
  return (
    <footer className="bg-[#202731] text-slate-400 text-xs px-6 py-2 flex justify-between items-center border-t border-slate-700 font-mono">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-slate-200 font-bold">STATUS:</span>
        <span>ALL SENSORS SYNCHRONIZED · Demo data is fictional</span>
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <span>
          © {SITE_YEAR} {SITE_NAME}
        </span>
        <span className="text-amber-300 font-bold" data-testid="site-version">
          {SITE_VERSION}
        </span>
      </div>
    </footer>
  );
}
