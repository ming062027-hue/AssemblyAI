"use client";

// 語音線：操作員語音頁（靜態版，未連線實測）
// 第二輪派工：按鈕、狀態顯示、session.end 接 mock，不連線；V1 密語位先留。
// 真連線時把 mock 換成：拿 /api/voice-token 的 token → wss → session.update（inline 設定）。
// 規格見交接/線_語音.md 步驟 4。

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "live" | "ended";

const STATUS_TEXT: Record<Status, string> = {
  idle: "Not connected",
  live: "On call (mock, no connection)",
  ended: "Call ended (mock)",
};

export default function OperatorPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [passcode, setPasscode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function push(line: string) {
    setLog((prev) => [...prev.slice(-19), line]);
  }

  function startCall() {
    // 靜態版：不拿 token、不開 WebSocket，只走一遍事件形狀。
    setStatus("live");
    setSeconds(0);
    push("up: session.update (mock, inline config, no connection)");
    push("down: session.ready (mock), session_id=mock-0000");
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  function endCall() {
    // 靜態版：直接記 mock 的 session.end。真版閒置也算錢，結束一定要先送 session.end。
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    push("up: session.end (mock)");
    push("down: session.ended (mock)");
    setStatus("ended");
  }

  function reset() {
    setStatus("idle");
    setSeconds(0);
    setLog([]);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-black/60 dark:text-white/60">
          Operator voice page
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Talk to the shop-floor assistant
        </h1>
        <p className="text-sm leading-6 text-black/70 dark:text-white/70">
          Static version: buttons and status only, no connection. Live voice
          needs an API key (see .env.example).
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/15">
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-semibold">Status</span>
          <span className="rounded-full bg-black/5 px-3 py-1 text-sm dark:bg-white/10">
            {STATUS_TEXT[status]}
            {status === "live" ? ` · ${seconds}s` : ""}
          </span>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-black/70 dark:text-white/70">
            Demo passcode (reserved for V1 protection, not checked in static
            version)
          </span>
          <input
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="passcode"
            autoComplete="off"
            className="rounded-lg border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {status === "idle" || status === "ended" ? (
            <button
              onClick={status === "ended" ? reset : startCall}
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              {status === "ended" ? "Start again" : "Start call (mock)"}
            </button>
          ) : (
            <button
              onClick={endCall}
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              End call (mock session.end)
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-lg font-semibold">Event log (mock)</h2>
        {log.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            No events yet. Press “Start call”.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 font-mono text-xs leading-5">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
