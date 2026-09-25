"use client";

// 語音線：操作員語音頁（規格書 §2.4、§4.4、§4.6）
// - 開發模式（npm run dev）：連 ws://localhost:8787（scripts/mock-agent.mjs），
//   用「模擬講話」輸入框送 mock.say；收到 tool.call 就呼叫 src/tools 的真函式，
//   把結果包成 tool.result（result 先轉 JSON 字串）送回去；單子經 BroadcastChannel
//   即時出現在右半邊的 LiveBoard compact。結束一定先送 session.end（閒置也算錢）。
// - 正式模式：拿 token → wss 連 AssemblyAI → 送 S0 session.update → 收到
//   session.ready 才開麥克風送聲音；reply.audio 排隊播放，插話立刻停播清空；
//   機台確認後送 S1 session.update；結束先送 session.end、收到 session.ended 才關。
// 共用流程判斷（S1 切換、插話、tool.result 形狀、英文錯誤）放在 src/voice/client.ts，
// 收音播放（getUserMedia 設定、內嵌 worklet、排隊）放在 src/voice/audio.ts。

import { useEffect, useRef, useState } from "react";
import LiveBoard from "@/board/LiveBoard";
import ConsoleHeader from "@/components/ConsoleHeader";
import ConsoleFooter from "@/components/ConsoleFooter";
import {
  SAMPLE_RATE,
  base64ToPCM16,
  createMicStream,
  createPlaybackQueue,
  replyAudioOf,
  startCapture,
  type CaptureHandle,
  type PlaybackQueue,
} from "@/voice/audio";
import {
  buildInputAudioMessage,
  buildToolResult,
  buildWsUrl,
  confirmedUpdate,
  englishErrorForClose,
  englishErrorForSessionError,
  initialUpdate,
  isInterruptionMessage,
  isNormalReplyDone,
  shouldUpgradeToS1,
  type IncomingMessage,
} from "@/voice/client";
import {
  create_repair_ticket,
  get_machine_status,
  get_maintenance_history,
  lookup_alarm,
  resolve_repair_ticket,
} from "@/tools/handlers";
import {
  startFactoryNoise,
  stopFactoryNoise,
} from "@/voice/noiseSimulator";

// 跟 LiveBoard 同一招：正式站才算 production，開發模式多 mock 工具。
const isDev = process.env.NODE_ENV !== "production";
const MOCK_URL = "ws://localhost:8787";

// §2.4 Demo 主線 6 句（含開單＋技師完工解除閉環，看板出現 RT-1001 並更新為 RESOLVED）
const MAIN_LINE = [
  "Machine three has an alarm.",
  "What does alarm four one four mean?",
  "I checked. Still noisy. Open a repair ticket.",
  "Yes, confirm.",
  "Ticket RT-1001 is resolved, maintenance complete.",
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
    case "resolve_repair_ticket":
      return resolve_repair_ticket(
        args as { ticket_id: string },
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
  const [noiseActive, setNoiseActive] = useState(false);
  const [activeMachine, setActiveMachine] = useState<string | null>(null);
  const [activeAlarm, setActiveAlarm] = useState<{
    code: string;
    title: string;
    likely_causes: string;
    first_checks: string[];
  } | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    type: "ticket" | "resolve" | "alarm";
  } | null>(null);

  function toggleNoise() {
    if (noiseActive) {
      stopFactoryNoise();
      setNoiseActive(false);
    } else {
      const ok = startFactoryNoise(0.35);
      if (ok) setNoiseActive(true);
    }
  }

  const ws = useRef<WebSocket | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number>(0);
  const s1Sent = useRef(false);
  const pendingEnd = useRef(false);
  const statusRef = useRef<Status>("idle");
  statusRef.current = status;
  // 真連線才用的聲音資源（mock 不用麥克風也不播音）。
  const liveRef = useRef(false);
  const audioCtx = useRef<AudioContext | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const capture = useRef<CaptureHandle | null>(null);
  const playback = useRef<PlaybackQueue | null>(null);
  const micStarting = useRef(false);

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

  function stopAudio() {
    if (capture.current) {
      try {
        capture.current.stop();
      } catch {
        // 已經停了就不用再停。
      }
      capture.current = null;
    }
    if (playback.current) {
      playback.current.dispose();
      playback.current = null;
    }
    if (micStream.current) {
      for (const track of micStream.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // 已經停了就不用再停。
        }
      }
      micStream.current = null;
    }
    if (audioCtx.current) {
      const ctx = audioCtx.current;
      audioCtx.current = null;
      void ctx.close().catch(() => {
        // 關閉中，忽略。
      });
    }
    micStarting.current = false;
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

  function finishCall(endedSessionId: string) {
    const secs = stopTimer();
    setFinalSeconds(secs);
    // §4.4：每通在主控台印 session_id 和秒數（不印 token／金鑰）。
    console.log(`[operator] session ${endedSessionId} ended after ${secs}s`);
    push(`down: session.ended (${secs}s)`);
    setStatus("ended");
    stopAudio();
    closeSocket();
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
        stopAudio();
        closeSocket();
      }
    } else {
      setStatus("ended");
      stopAudio();
      closeSocket();
    }
  }

  // 真連線：收到 session.ready 才開麥克風（§4.4 連線順序第 4 步）。
  async function startLiveAudio() {
    if (!liveRef.current || micStarting.current || capture.current) return;
    micStarting.current = true;
    try {
      const stream = await createMicStream();
      if (!liveRef.current) {
        for (const track of stream.getTracks()) track.stop();
        micStarting.current = false;
        return;
      }
      micStream.current = stream;
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      playback.current = createPlaybackQueue(ctx, () => {
        if (statusRef.current === "speaking") setStatus("listening");
      });
      capture.current = await startCapture(ctx, stream, (audioB64) => {
        const sock = ws.current;
        if (sock && sock.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify(buildInputAudioMessage(audioB64)));
        }
      });
      push("audio: mic capturing (24kHz PCM16), playback queue ready");
    } catch {
      setConnError("Could not open the microphone. Please allow access and try again.");
      setStatus("error");
      stopAudio();
      closeSocket();
    } finally {
      micStarting.current = false;
    }
  }

  function handleMessage(raw: string) {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(raw) as IncomingMessage;
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
      if (liveRef.current) void startLiveAudio();
      return;
    }
    if (msg.type === "session.error") {
      const text = englishErrorForSessionError(msg);
      setConnError(text);
      push(`down: session.error ${JSON.stringify(msg.message ?? "")}`);
      setStatus("error");
      stopAudio();
      closeSocket();
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
      const toolName = String(msg.name ?? "");
      if (toolName === "get_machine_status" && msg.arguments?.machine_id) {
        setActiveMachine(String(msg.arguments.machine_id));
      }
      if (toolName === "lookup_alarm" && !("error" in result)) {
        setActiveAlarm(
          result as unknown as {
            code: string;
            title: string;
            likely_causes: string;
            first_checks: string[];
          },
        );
        if (msg.arguments?.machine_id) {
          setActiveMachine(String(msg.arguments.machine_id));
        }
      }
      if (toolName === "create_repair_ticket" && !("error" in result)) {
        const ticketRes = result as unknown as { ticket_id: string };
        setToast({
          text: `Repair ticket ${ticketRes.ticket_id} created for ${String(msg.arguments?.machine_id ?? "machine")}!`,
          type: "ticket",
        });
      }
      if (toolName === "resolve_repair_ticket" && !("error" in result)) {
        const resTicket = result as unknown as { ticket_id: string };
        setToast({
          text: `Repair ticket ${resTicket.ticket_id} marked as RESOLVED!`,
          type: "resolve",
        });
        setActiveAlarm(null);
      }
      try {
        sock?.send(JSON.stringify(buildToolResult(String(msg.call_id ?? ""), result)));
      } catch {
        setConnError("Failed to send the tool result.");
        setStatus("error");
        return;
      }
      push(
        `up: tool.result ${String(msg.call_id ?? "")} ${JSON.stringify(result).slice(0, 120)}`,
      );
      // 機台確認了 → 換 S1（提示詞＋寫入工具一起換，見 §4.4）。
      if (!s1Sent.current && shouldUpgradeToS1(String(msg.name ?? ""), result)) {
        s1Sent.current = true;
        try {
          sock?.send(JSON.stringify(confirmedUpdate()));
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
      // §4.4 插話／播放：真連線排隊播放；mock 只送 0.2 秒靜音，跳過播放。
      // 聲音本體：真系統在 data 欄位、舊 mock 在 audio 欄位（replyAudioOf 兩個都收）。
      const rawAudio = replyAudioOf(msg);
      if (playback.current && rawAudio) {
        const pcm = base64ToPCM16(rawAudio);
        if (pcm.length > 0) {
          setStatus("speaking");
          playback.current.enqueue(rawAudio);
          push("down: reply.audio (queued for playback)");
          return;
        }
      }
      setStatus("speaking");
      push("down: reply.audio (mock silence, skipped playback)");
      return;
    }
    if (isInterruptionMessage(msg)) {
      // §4.4：操作員插話 → 立刻停播並清空排隊。
      const dropped = playback.current ? playback.current.stopAndClear() : 0;
      push(`down: interrupted, stopped playback (dropped ${dropped})`);
      pendingEnd.current = false;
      setStatus("listening");
      return;
    }
    if (isNormalReplyDone(msg)) {
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
      finishCall(msg.session_id ?? "");
      return;
    }
    push(`down: (unknown ${msg.type}, ignored)`);
  }

  function openSocket(url: string, live: boolean) {
    liveRef.current = live;
    setStatus("connecting");
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch {
      setConnError(
        live
          ? "Could not open the AssemblyAI connection."
          : `Could not open ${MOCK_URL}.`,
      );
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
      sock.send(JSON.stringify(initialUpdate()));
      push("up: session.update (S0, inline config)");
    };
    sock.onmessage = (event) => handleMessage(String(event.data));
    sock.onerror = () => {
      if (statusRef.current === "connecting") {
        stopTimer();
        setConnError(
          live
            ? "Could not reach AssemblyAI. Please check the network and try again."
            : `Could not reach the mock server at ${MOCK_URL}. Is scripts/mock-agent.mjs running?`,
        );
        setStatus("error");
        stopAudio();
        closeSocket();
      }
    };
    sock.onclose = (event) => {
      if (statusRef.current !== "ended" && statusRef.current !== "error") {
        if (statusRef.current === "connecting" || live) {
          setConnError(englishErrorForClose(event.code));
          setStatus("error");
        } else {
          const secs = stopTimer();
          setFinalSeconds(secs);
          setStatus("ended");
          push(`down: socket closed (${secs}s)`);
        }
        stopAudio();
        closeSocket();
      }
    };
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
    openSocket(MOCK_URL, false);
  }

  // 真連線（正式模式）：拿一次 token → 連 wss → 之後流程跟 mock 共用 handleMessage。
  async function connectLive(existingToken?: string) {
    setConnError("");
    setChat([]);
    setLog([]);
    setFinalSeconds(null);
    setSessionId("");
    setSeconds(0);
    s1Sent.current = false;
    pendingEnd.current = false;
    setStatus("connecting");
    let token = existingToken || "";
    if (!token) {
      try {
        const res = await fetch(
          "/api/voice-token?passcode=" + encodeURIComponent(passcode),
          { cache: "no-store" },
        );
        if (!res.ok) {
          setConnError(
            res.status === 401
              ? "Wrong passcode. Please try again."
              : "Could not get a voice token. Please try again.",
          );
          setStatus("error");
          return;
        }
        const data = (await res.json()) as { token?: unknown };
        if (typeof data.token !== "string" || data.token.length === 0) {
          setConnError("Could not get a voice token. Please try again.");
          setStatus("error");
          return;
        }
        token = data.token;
      } catch {
        setConnError("Could not reach the token server. Please try again.");
        setStatus("error");
        return;
      }
    }
    // token 只用一次，不存、不印。
    push("token ok, opening AssemblyAI connection…");
    openSocket(buildWsUrl(token), true);
    token = "";
  }

  async function startCall() {
    // V1 密語門：先請伺服器驗密語。
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
    // 密語通過。開發模式接 mock；正式模式走真連線（直接複用驗證時已發放的 token，不重複要 token）。
    if (isDev) {
      connectMock();
    } else {
      let token = "";
      try {
        const data = (await res.json()) as { token?: unknown };
        if (typeof data.token === "string") token = data.token;
      } catch {
        // 若解析失敗，connectLive 會自動重新取得
      }
      void connectLive(token);
    }
  }

  function endCall() {
    sendSessionEnd();
  }

  function reset() {
    closeSocket();
    stopAudio();
    stopTimer();
    stopFactoryNoise();
    setNoiseActive(false);
    setActiveMachine(null);
    setActiveAlarm(null);
    setToast(null);
    liveRef.current = false;
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
      stopAudio();
      stopFactoryNoise();
      if (ws.current) {
        try {
          ws.current.close();
        } catch {
          // 收尾，忽略。
        }
        ws.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCall =
    status === "listening" || status === "thinking" || status === "speaking";

  return (
    <div className="min-h-full flex flex-col select-none">
      <ConsoleHeader
        title="操作員語音頁 · Operator"
        subtitle="VIEW: 現場語音助理"
      />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
        <p className="text-sm leading-6 text-slate-700">
          {isDev
            ? "Dev mode: talks to the mock server (no key, no charge). Press ①–⑤ to run the demo main line."
            : "Live mode: talks to AssemblyAI over an encrypted connection. Please allow the microphone when asked."}
        </p>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3 hh-card rounded-lg p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-bold text-[#202731]">Status</span>
              <span className="rounded bg-slate-100 border border-slate-300 px-3 py-1 text-xs font-mono font-bold text-[#202731]">
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
              <p className="font-mono text-xs text-slate-600">
                session_id={sessionId}
              </p>
            ) : null}
            {connError ? (
              <p className="text-sm text-rose-600">
                {connError}
              </p>
            ) : null}

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-700">
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
                className="rounded border border-slate-400 bg-white px-3 py-2 text-[#14181f]"
              />
              {passcodeError ? (
                <span className="text-sm text-rose-600">
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
                    className="rounded bg-[#0056b3] px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {checking
                      ? "Checking passcode..."
                      : status === "ended"
                        ? "Start again"
                        : isDev
                          ? "Start call (mock)"
                          : "Start call"}
                  </button>
                ) : (
                  <button
                    onClick={endCall}
                    className="rounded bg-[#b71c1c] px-4 py-2 text-sm font-bold text-white hover:bg-[#c62828]"
                  >
                    End call (session.end)
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleNoise}
                  className={`rounded px-3 py-2 text-sm font-bold border transition-colors flex items-center gap-1.5 ${
                    noiseActive
                      ? "bg-amber-600 text-white border-amber-700 shadow-sm animate-pulse"
                      : "bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200"
                  }`}
                  title="Play synthesized 75dB CNC shopfloor noise to test AssemblyAI Voice Focus noise suppression"
                >
                  <span>{noiseActive ? "🔊 Factory Noise: 75dB (ON)" : "🔈 Simulate Noise (75dB)"}</span>
                </button>
              </div>
            </section>

            {isDev ? (
              <section className="flex flex-col gap-3 hh-card rounded-lg p-4">
                <h2 className="text-base font-bold text-[#202731]">Simulate speech</h2>
                <p className="text-sm text-slate-600">
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
                      className="hh-softkey rounded px-3 py-1.5 text-sm font-bold text-[#202731] disabled:opacity-40"
                    >
                      {["①", "②", "③", "④", "⑤", "⑥"][i]} Send line {i + 1}
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
                    className="flex-1 rounded border border-slate-400 bg-white px-3 py-2 text-sm text-[#14181f]"
                  />
                  <button
                    type="submit"
                    disabled={!onCall}
                    className="rounded bg-[#0056b3] px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    Send
                  </button>
                </form>
              </section>
            ) : null}

            <section className="flex flex-col gap-2 hh-card rounded-lg p-4">
              <h2 className="text-base font-bold text-[#202731]">Transcript</h2>
              {chat.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No speech yet.
                  {isDev ? " Press Start, then ①–⑥." : " Press Start and speak."}
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

            <section className="flex flex-col gap-2 hh-card rounded-lg p-4">
              <h2 className="text-base font-bold text-[#202731]">
                Event log{isDev ? " (mock)" : ""}
              </h2>
              {log.length === 0 ? (
                <p className="text-sm text-slate-600">
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

          <div className="flex flex-col gap-6">
            {/* Active Telemetry Focus */}
            {activeMachine || activeAlarm ? (
              <section className="hh-card rounded-lg p-4 border-l-4 border-l-[#b71c1c] bg-rose-50/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-800 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-rose-600 animate-ping" />
                    Target: {activeMachine ?? "M03"} (CNC Lathe)
                  </span>
                  {activeAlarm ? (
                    <span className="rounded bg-rose-100 border border-rose-300 px-2 py-0.5 font-mono text-xs font-bold text-rose-900">
                      ALARM {activeAlarm.code}
                    </span>
                  ) : (
                    <span className="rounded bg-slate-100 border border-slate-300 px-2 py-0.5 text-xs text-slate-700">
                      STATUS CHECK
                    </span>
                  )}
                </div>
                {activeAlarm ? (
                  <div className="mt-2 space-y-2 text-xs">
                    <div className="font-semibold text-slate-900">
                      {activeAlarm.title}
                    </div>
                    <div className="text-slate-600">
                      <span className="font-medium text-slate-700">Cause: </span>
                      {activeAlarm.likely_causes}
                    </div>
                    <div className="rounded border border-slate-200 bg-white p-2.5 shadow-xs">
                      <div className="font-bold text-slate-800 mb-1">
                        First 3 Checks (On-site protocol):
                      </div>
                      <ol className="list-decimal list-inside space-y-1 text-slate-600">
                        {activeAlarm.first_checks.map((check, idx) => (
                          <li key={idx}>{check}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* Toast Notification */}
            {toast ? (
              <div
                className={`rounded-lg border px-4 py-3 text-sm font-semibold flex items-center justify-between shadow-xs ${
                  toast.type === "resolve"
                    ? "bg-emerald-50 text-emerald-900 border-emerald-300"
                    : "bg-blue-50 text-blue-900 border-blue-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{toast.type === "resolve" ? "✅" : "🔔"}</span>
                  <span>{toast.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setToast(null)}
                  className="text-xs opacity-60 hover:opacity-100 font-bold ml-2"
                >
                  ✕
                </button>
              </div>
            ) : null}

            <div className="hh-card rounded-lg p-4">
              <LiveBoard compact />
            </div>
          </div>
        </div>
      </main>
      <ConsoleFooter />
    </div>
  );
}
