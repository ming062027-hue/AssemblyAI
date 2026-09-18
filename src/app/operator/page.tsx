"use client";

// 語音線：操作員語音頁（開發模式連 mock＋模擬講話輸入框；正式模式留給 P3 真系統）
// - 開發模式（npm run dev）：連 ws://localhost:8787（scripts/mock-agent.mjs），
//   用「模擬講話」輸入框送 mock.say；收到 tool.call 就呼叫 src/tools 的真函式，
//   把結果包成 tool.result（result 先轉 JSON 字串）送回去；單子經 BroadcastChannel
//   即時出現在右半邊的 LiveBoard compact。結束一定先送 session.end（閒置也算錢）。
// - 正式模式：不連 mock，真連線（拿 token → wss → inline session.update）等 P3，
//   現在只驗密語、不假裝通話。
// 規格見方案/完整規格書_v1_2026-09-17.md §2.4、§4.4、§4.6。

import { useEffect, useRef, useState } from "react";
import LiveBoard from "@/board/LiveBoard";
import {
  createConfirmedSessionUpdate,
  createInitialSessionUpdate,
} from "@/voice/session";
import {
  create_repair_ticket,
  get_machine_status,
  get_maintenance_history,
  lookup_alarm,
} from "@/tools/handlers";

// 跟 LiveBoard 同一招：正式站才算 production，開發模式多 mock 工具。
const isDev = process.env.NODE_ENV !== "production";
const MOCK_URL = "ws://localhost:8787";

// §2.4 Demo 主線 5 句（照順序送，看板出現 1 張單，狀態最後 ended）
const MAIN_LINE = [
  "Machine three has an alarm.",
  "What does alarm four one four mean?",
  "I checked. Still noisy. Open a repair ticket.",
  "Yes, confirm.",
  "That's all, thanks.",
];

type Status =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

const STATUS_TEXT: Record<Status, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking (running tool…)",
  speaking: "Assistant speaking",
  ended: "Call ended",
  error: "Connection error",
};

interface ChatLine {
  who: "you" | "agent";
  text: string;
}

function runTool(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (name) {
    case "get_machine_status":
      return get_machine_status(args as { machine_id: string }) as unknown as Record<
        string,
        unknown
      >;
    case "lookup_alarm":
      return lookup_alarm(
        args as { alarm_code: string | number; machine_id?: string },
      ) as unknown as Record<string, unknown>;
    case "get_maintenance_history":
      return get_maintenance_history(
        args as { machine_id: string; limit?: number },
      ) as unknown as Record<string, unknown>;
    case "create_repair_ticket":
      return create_repair_ticket(
        args as {
          machine_id: string;
          symptom: string;
          severity: string;
          can_keep_running: string;
          operator_confirmed: string;
        },
      ) as unknown as Record<string, unknown>;
    // end_conversation 由瀏覽器端處理（送 session.end，見 §4.4）：先回空結果，
    // 等 reply.done 後送 session.end。
    case "end_conversation":
      return { ended: true };
    default:
      return {
        error: `Unknown tool ${name}. Do not guess; ask the operator to say it again.`,
      };
  }
}

export default function OperatorPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  const [checking, setChecking] = useState(false);
  const [connError, setConnError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [finalSeconds, setFinalSeconds] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [draft, setDraft] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const ws = useRef<WebSocket | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number>(0);
  const s1Sent = useRef(false);
  const pendingEnd = useRef(false);
  const statusRef = useRef<Status>("idle");
  statusRef.current = status;

  function push(line: string) {
    setLog((prev) => [...prev.slice(-29), line]);
  }

  function stopTimer(): number {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return startedAt.current
      ? Math.round((Date.now() - startedAt.current) / 1000)
      : 0;
  }

  function closeSocket() {
    const sock = ws.current;
    ws.current = null;
    if (sock) {
      try {
        sock.close();
      } catch {
        // 關連線失敗不用再報一次，狀態已經是 ended。
      }
    }
  }

  // 結束一定先送 session.end（閒置也算錢），收到 session.ended 才算結束。
  function sendSessionEnd() {
    const sock = ws.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      try {
        sock.send(JSON.stringify({ type: "session.end" }));
        push("up: session.end");
      } catch {
        setStatus("ended");
        closeSocket();
      }
    } else {
      setStatus("ended");
      closeSocket();
    }
  }

  function handleMessage(raw: string) {
    let msg: {
      type?: string;
      text?: string;
      session_id?: string;
      call_id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      push("down: (non-JSON, ignored)");
      return;
    }
    const sock = ws.current;

    if (msg.type === "session.ready") {
      if (msg.session_id) setSessionId(msg.session_id);
      push(`down: session.ready, session_id=${msg.session_id ?? "(none)"}`);
      // S1 升級也會回 session.ready：已經在通話中就只記錄，不重置狀態。
      if (statusRef.current === "connecting") setStatus("listening");
      return;
    }
    if (msg.type === "transcript.user") {
      setChat((prev) => [...prev, { who: "you", text: String(msg.text ?? "") }]);
      push(`down: transcript.user ${JSON.stringify(msg.text ?? "")}`);
      return;
    }
    if (msg.type === "transcript.agent") {
      setChat((prev) => [
        ...prev,
        { who: "agent", text: String(msg.text ?? "") },
      ]);
      push(`down: transcript.agent ${JSON.stringify(msg.text ?? "")}`);
      return;
    }
    if (msg.type === "tool.call") {
      setStatus("thinking");
      push(`down: tool.call ${msg.name} ${JSON.stringify(msg.arguments ?? {})}`);
      const result = runTool(String(msg.name ?? ""), msg.arguments ?? {});
      const payload: Record<string, unknown> = {
        type: "tool.result",
        call_id: msg.call_id,
        result: JSON.stringify(result),
      };
      if (typeof result.error === "string") payload.is_error = true;
      try {
        sock?.send(JSON.stringify(payload));
      } catch {
        setConnError("Failed to send the tool result.");
        setStatus("error");
        return;
      }
      push(
        `up: tool.result ${String(msg.call_id ?? "")} ${JSON.stringify(result).slice(0, 120)}`,
      );
      // 機台確認了 → 換 S1（提示詞＋寫入工具一起換，見 §4.4）。
      if (
        !s1Sent.current &&
        (msg.name === "get_machine_status" || msg.name === "lookup_alarm") &&
        typeof result.error !== "string"
      ) {
        s1Sent.current = true;
        try {
          sock?.send(JSON.stringify(createConfirmedSessionUpdate()));
          push("up: session.update (S1, machine confirmed)");
        } catch {
          // S1 送不出去不致命：mock 照樣走完全程，真系統才需要。
          push("up: session.update (S1) failed, staying on S0");
        }
      }
      if (msg.name === "end_conversation") pendingEnd.current = true;
      return;
    }
    if (msg.type === "reply.audio") {
      // mock 只送 0.2 秒靜音（省流量）；真系統這裡要排隊播放。
      setStatus("speaking");
      push("down: reply.audio (mock silence, skipped playback)");
      return;
    }
    if (msg.type === "reply.done") {
      push("down: reply.done");
      // end_conversation：等助理把再見說完（reply.done）再送 session.end。
      if (pendingEnd.current) {
        pendingEnd.current = false;
        sendSessionEnd();
      } else {
        setStatus("listening");
      }
      return;
    }
    if (msg.type === "session.ended") {
      const secs = stopTimer();
      setFinalSeconds(secs);
      // §4.4：每通在主控台印 session_id 和秒數（不印 token／金鑰）。
      console.log(`[operator] session ${msg.session_id ?? ""} ended after ${secs}s`);
      push(`down: session.ended (${secs}s)`);
      setStatus("ended");
      closeSocket();
      return;
    }
    push(`down: (unknown ${msg.type}, ignored)`);
  }

  function connectMock() {
    setConnError("");
    setChat([]);
    setLog([]);
    setFinalSeconds(null);
    setSessionId("");
    setSeconds(0);
    s1Sent.current = false;
    pendingEnd.current = false;
    setStatus("connecting");
    let sock: WebSocket;
    try {
      sock = new WebSocket(MOCK_URL);
    } catch {
      setConnError(`Could not open ${MOCK_URL}.`);
      setStatus("error");
      return;
    }
    ws.current = sock;
    startedAt.current = Date.now();
    setSeconds(0);
    timer.current = setInterval(
      () =>
        setSeconds(Math.round((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    sock.onopen = () => {
      sock.send(JSON.stringify(createInitialSessionUpdate()));
      push("up: session.update (S0, inline config)");
    };
    sock.onmessage = (event) => handleMessage(String(event.data));
    sock.onerror = () => {
      if (statusRef.current === "connecting") {
        stopTimer();
        setConnError(
          `Could not reach the mock server at ${MOCK_URL}. Is scripts/mock-agent.mjs running?`,
        );
        setStatus("error");
        closeSocket();
      }
    };
    sock.onclose = () => {
      if (statusRef.current !== "ended" && statusRef.current !== "error") {
        const secs = stopTimer();
        setFinalSeconds(secs);
        setStatus("ended");
        push(`down: socket closed (${secs}s)`);
      }
    };
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
    // 密語通過。開發模式接 mock；正式模式真連線等 P3，現在不假裝通話。
    if (isDev) {
      connectMock();
    } else {
      push("passcode ok. Live AssemblyAI wiring lands in P3 (needs API key).");
    }
  }

  function endCall() {
    sendSessionEnd();
  }

  function reset() {
    closeSocket();
    stopTimer();
    setStatus("idle");
    setSeconds(0);
    setFinalSeconds(null);
    setSessionId("");
    setConnError("");
    setDraft("");
    setChat([]);
    setLog([]);
  }

  function sendSay(text: string) {
    const line = text.trim();
    if (!line) return;
    const sock = ws.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      setConnError("Not connected. Press Start first.");
      return;
    }
    sock.send(JSON.stringify({ type: "mock.say", text: line }));
    push(`up: mock.say ${JSON.stringify(line)}`);
    setDraft("");
  }

  // 關分頁也要先送 session.end（不然多算 30 秒，見 §4.4）。
  useEffect(() => {
    const onHide = () => {
      const sock = ws.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        try {
          sock.send(JSON.stringify({ type: "session.end" }));
        } catch {
          // 關閉中，忽略。
        }
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (timer.current) clearInterval(timer.current);
      if (ws.current) {
        try {
          ws.current.close();
        } catch {
          // 收尾，忽略。
        }
        ws.current = null;
      }
    };
  }, []);

  const onCall =
    status === "listening" || status === "thinking" || status === "speaking";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-black/60 dark:text-white/60">
          Operator voice page
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Talk to the shop-floor assistant
        </h1>
        <p className="text-sm leading-6 text-black/70 dark:text-white/70">
          {isDev
            ? "Dev mode: talks to the mock server (no key, no charge). Press ①–⑤ to run the demo main line."
            : "Live mode: the AssemblyAI connection lands in P3. Nothing is faked here."}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/15">
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-semibold">Status</span>
              <span className="rounded-full bg-black/5 px-3 py-1 text-sm dark:bg-white/10">
                {STATUS_TEXT[status]}
                {status === "listening" ||
                status === "thinking" ||
                status === "speaking" ||
                status === "connecting"
                  ? ` · ${seconds}s`
                  : ""}
                {status === "ended" && finalSeconds !== null
                  ? ` · ${finalSeconds}s`
                  : ""}
              </span>
            </div>
            {sessionId ? (
              <p className="font-mono text-xs text-black/60 dark:text-white/60">
                session_id={sessionId}
              </p>
            ) : null}
            {connError ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {connError}
              </p>
            ) : null}

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-black/70 dark:text-white/70">
                Demo passcode (required, checked by the server before
                starting)
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
              {status === "idle" ||
              status === "ended" ||
              status === "error" ? (
                <button
                  onClick={status === "ended" ? reset : startCall}
                  disabled={checking}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
                >
                  {checking
                    ? "Checking passcode..."
                    : status === "ended"
                      ? "Start again"
                      : isDev
                        ? "Start call (mock)"
                        : "Check passcode"}
                </button>
              ) : (
                <button
                  onClick={endCall}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
                >
                  End call (session.end)
                </button>
              )}
            </div>
          </section>

          {isDev ? (
            <section className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/15">
              <h2 className="text-lg font-semibold">Simulate speech</h2>
              <p className="text-sm text-black/60 dark:text-white/60">
                Dev only: sends mock.say to the mock server. Or run the
                demo main line in order:
              </p>
              <div className="flex flex-wrap gap-2">
                {MAIN_LINE.map((line, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => sendSay(line)}
                    disabled={!onCall}
                    className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
                  >
                    {["①", "②", "③", "④", "⑤"][i]} Send line {i + 1}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendSay(draft);
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type what the operator says…"
                  autoComplete="off"
                  disabled={!onCall}
                  className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
                />
                <button
                  type="submit"
                  disabled={!onCall}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  Send
                </button>
              </form>
            </section>
          ) : null}

          <section className="flex flex-col gap-2 rounded-xl border border-black/10 p-5 dark:border-white/15">
            <h2 className="text-lg font-semibold">Transcript</h2>
            {chat.length === 0 ? (
              <p className="text-sm text-black/60 dark:text-white/60">
                No speech yet.
                {isDev ? " Press Start, then ①–⑤." : ""}
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm leading-6">
                {chat.map((line, i) => (
                  <li key={i}>
                    <span className="font-medium">
                      {line.who === "you" ? "Operator: " : "Assistant: "}
                    </span>
                    {line.text}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-black/10 p-5 dark:border-white/15">
            <h2 className="text-lg font-semibold">
              Event log{isDev ? " (mock)" : ""}
            </h2>
            {log.length === 0 ? (
              <p className="text-sm text-black/60 dark:text-white/60">
                No events yet. Press “Start”.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 font-mono text-xs leading-5">
                {log.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <LiveBoard compact />
        </div>
      </div>
    </main>
  );
}
