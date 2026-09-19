import type { Metadata } from "next";
import Link from "next/link";
import LiveBoard from "@/board/LiveBoard";
import ConsoleHeader from "@/components/ConsoleHeader";
import ConsoleFooter from "@/components/ConsoleFooter";

export const metadata: Metadata = {
  title: "Supervisor dashboard",
};

export default function DashboardPage() {
  return (
    <div className="min-h-full flex flex-col select-none">
      <ConsoleHeader
        title="主管看板 · Supervisor Dashboard"
        subtitle="VIEW: 語音開單即時看板"
      />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs font-mono text-[#0056b3] hover:underline"
          >
            ← 回總覽 Home
          </Link>
          <span className="text-xs font-mono font-semibold text-slate-600">
            TICKETS · LIVE
          </span>
        </div>

        <section className="hh-card rounded-lg p-4">
          <div className="flex justify-between items-center pb-2 mb-3 border-b border-[#9aa3b4]">
            <h2 className="text-sm font-bold text-[#202731]">
              語音開單即時看板
            </h2>
            <span className="text-xs font-mono font-semibold text-slate-600">
              操作員用講的開單，這裡即時出現
            </span>
          </div>
          <LiveBoard />
        </section>
      </main>

      <ConsoleFooter />
    </div>
  );
}
