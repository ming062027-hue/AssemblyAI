"use client";

// 語音線：操作員語音頁（靜態版，未連線實測；V1 密語門：按開始前先過伺服器檢查）
// 按開始 → 先打 /api/voice-token 只驗密語（只看狀態碼，不讀 token、不開 WebSocket）。
// 密語錯顯示英文提示；通過才走 mock 事件。真連線時把 mock 換成：
// 拿 token → wss → session.update（inline 設定）。
// 規格見方案/完整規格書_v1_2026-09-17.md §4.5、交接/線_語音.md 步驟 4。

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
  const [passcodeError, setPasscodeError] = useState("");
  const [checking, setChecking] = useState(false);
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

  async function startCall() {
    // V1 密語門：先請伺服器驗密語。只看狀態碼，不讀 token、不開 WebSocket。
    if (!passcode) {
      setPasscodeError("Please enter the demo passcode first.");
      return;
    }
    setChecking(true);
    setPasscodeError("");
    let res: Response;
    try {
      res = await fetch(
        "/api/voice-token?passcode=" + encodeURIComponent(passcode),
        { cache: "no-store" },
      );
    } catch {
      setPasscodeError(
        "Could not reach the token server. Is the dev server running?",
      );
      setChecking(false);
      return;
    }
    setChecking(false);
    if (res.status === 401) {
      setPasscodeError("Wrong passcode. Please try again.");
      return;
    }
    if (res.status === 500) {
      setPasscodeError("Demo passcode is not configured on the server.");
      return;
    }
    if (res.status === 403) {
      setPasscodeError("Request blocked. Please open this page directly.");
      return;
    }
    // 靜態版：密語通過（或開發模式沒設密語）後，只走一遍 mock 事件形狀。
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
            Demo passcode (required, checked by the server before starting)
          </span>
          <input
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              setPasscodeError("");
            }}
            placeholder="passcode"
            autoComplete="off"
            className="rounded-lg border border-black/10 bg-transparent px-3 py-2 dark:border-white/15"
          />
          {passcodeError ? (
            <span className="text-sm text-red-600 dark:text-red-400">
              {passcodeError}
            </span>
          ) : null}
        </label>

        <div className="flex flex-wrap gap-2">
          {status === "idle" || status === "ended" ? (
            <button
              onClick={status === "ended" ? reset : startCall}
              disabled={checking}
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              {checking
                ? "Checking passcode..."
                : status === "ended"
                  ? "Start again"
                  : "Start call (mock)"}
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
