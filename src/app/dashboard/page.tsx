import type { Metadata } from "next";
import Link from "next/link";
import LiveBoard from "@/board/LiveBoard";

export const metadata: Metadata = {
  title: "Supervisor dashboard",
};

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-black/60 hover:underline dark:text-white/60"
        >
          ← Home
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Supervisor dashboard
        </h1>
        <p className="text-black/70 dark:text-white/70">
          Tickets opened by voice appear here in real time.
        </p>
      </header>

      <LiveBoard />
    </main>
  );
}
