"use client";

// Reusable Voice Agent Bridge hook.
// Connects UI components (like the CNC-640 Model Universe or Operator page)
// to AssemblyAI Voice Agent API (or local mock agent in dev mode).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  base64ToPCM16,
  createPlaybackQueue,
  startCapture,
  type CaptureHandle,
  type PlaybackQueue,
} from "./audio";
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
} from "./client";

export type AgentStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

export interface ChatMessage {
  who: "you" | "agent";
  text: string;
}

export interface VoiceAgentBridgeOptions {
  isDev?: boolean;
  mockUrl?: string;
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  onSessionReady?: (sessionId: string) => void;
  onSessionEnd?: () => void;
}

export function useVoiceAgentBridge(options: VoiceAgentBridgeOptions = {}) {
  const isDev = options.isDev ?? process.env.NODE_ENV !== "production";
  const mockUrl = options.mockUrl ?? "ws://localhost:8787";

  const [status, setStatus] = useState<AgentStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [lastAgentSay, setLastAgentSay] = useState("");
  const [lastUserSay, setLastUserSay] = useState("");
  const [error, setError] = useState("");
  const [isLiveMode, setIsLiveMode] = useState(!isDev);

  const ws = useRef<WebSocket | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number>(0);
  const s1Sent = useRef(false);
  const pendingEnd = useRef(false);
  const liveRef = useRef(false);

  // Audio capture and playback
  const audioCtx = useRef<AudioContext | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const capture = useRef<CaptureHandle | null>(null);
  const playback = useRef<PlaybackQueue | null>(null);

  const onToolCallRef = useRef(options.onToolCall);
  onToolCallRef.current = options.onToolCall;

  const onSessionReadyRef = useRef(options.onSessionReady);
  onSessionReadyRef.current = options.onSessionReady;

  const onSessionEndRef = useRef(options.onSessionEnd);
  onSessionEndRef.current = options.onSessionEnd;

  const stopTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const stopAudio = useCallback(() => {
    if (capture.current) {
      try {
        capture.current.stop();
      } catch {
        // ignore
      }
      capture.current = null;
    }
    if (micStream.current) {
      micStream.current.getTracks().forEach((t) => t.stop());
      micStream.current = null;
    }
    if (playback.current) {
      try {
        playback.current.dispose();
      } catch {
        // ignore
      }
      playback.current = null;
    }
    if (audioCtx.current && audioCtx.current.state !== "closed") {
      try {
        void audioCtx.current.close();
      } catch {
        // ignore
      }
      audioCtx.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    if (ws.current) {
      try {
        ws.current.close();
      } catch {
        // ignore
      }
      ws.current = null;
    }
  }, []);

  const endCall = useCallback(() => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      try {
        ws.current.send(JSON.stringify({ type: "session.end" }));
      } catch {
        // ignore
      }
    }
  }, []);

  const reset = useCallback(() => {
    closeSocket();
    stopAudio();
    stopTimer();
    liveRef.current = false;
    setStatus("idle");
    setSeconds(0);
    setSessionId("");
    setError("");
    setChat([]);
    setLastAgentSay("");
    setLastUserSay("");
  }, [closeSocket, stopAudio, stopTimer]);

  const sendSay = useCallback((text: string) => {
    const line = text.trim();
    if (!line) return;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      if (!liveRef.current) {
        ws.current.send(JSON.stringify({ type: "mock.say", text: line }));
      }
      setLastUserSay(line);
    }
  }, []);

  const handleMessage = useCallback(
    async (raw: string) => {
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(raw) as IncomingMessage;
      } catch {
        return;
      }

      if (isInterruptionMessage(msg)) {
        playback.current?.stopAndClear();
        setStatus("listening");
        return;
      }

      if (msg.type === "session.ready") {
        const sid = String(msg.session_id ?? "");
        setSessionId(sid);
        setStatus("listening");
        startedAt.current = Date.now();
        timer.current = setInterval(() => {
          setSeconds(Math.round((Date.now() - startedAt.current) / 1000));
        }, 1000);
        onSessionReadyRef.current?.(sid);

        // Start mic capture if in live mode
        if (liveRef.current && !capture.current) {
          try {
            if (!audioCtx.current || audioCtx.current.state === "closed") {
              const AudioCtx =
                window.AudioContext ||
                (window as unknown as { webkitAudioContext: typeof AudioContext })
                  .webkitAudioContext;
              audioCtx.current = new AudioCtx();
            }
            const ctx = audioCtx.current;
            if (ctx.state === "suspended") {
              await ctx.resume();
            }
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            });
            micStream.current = stream;
            capture.current = await startCapture(ctx, stream, (b64) => {
              if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify(buildInputAudioMessage(b64)));
              }
            });
          } catch (err) {
            console.error("Mic access failed:", err);
            setError("Microphone permission was denied.");
            setStatus("error");
          }
        }
        return;
      }

      if (msg.type === "transcript.user") {
        const text = String(msg.text ?? "");
        setLastUserSay(text);
        setChat((prev) => [...prev, { who: "you", text }]);
        return;
      }

      if (msg.type === "transcript.agent") {
        const text = String(msg.text ?? "");
        setLastAgentSay(text);
        setChat((prev) => [...prev, { who: "agent", text }]);
        return;
      }

      if (msg.type === "tool.call") {
        setStatus("thinking");
        const callName = String(msg.name ?? "");
        const callArgs = msg.arguments ?? {};
        let result: Record<string, unknown> = {};

        if (onToolCallRef.current) {
          try {
            result = await onToolCallRef.current(callName, callArgs);
          } catch (err) {
            result = { error: String(err) };
          }
        }

        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(
            JSON.stringify(buildToolResult(String(msg.call_id ?? ""), result)),
          );
        }

        // Upgrade to S1 if needed
        if (!s1Sent.current && shouldUpgradeToS1(callName, result)) {
          s1Sent.current = true;
          try {
            ws.current?.send(JSON.stringify(confirmedUpdate()));
          } catch {
            // ignore
          }
        }

        if (callName === "end_conversation") {
          pendingEnd.current = true;
        }
        return;
      }

      if (msg.type === "reply.audio") {
        const rawAudio = (msg as unknown as { audio?: unknown }).audio;
        if (playback.current && typeof rawAudio === "string") {
          const pcm = base64ToPCM16(rawAudio);
          if (pcm.length > 0) {
            setStatus("speaking");
            playback.current.enqueue(rawAudio);
          }
        }
        return;
      }

      if (isNormalReplyDone(msg)) {
        setStatus("listening");
        if (pendingEnd.current) {
          pendingEnd.current = false;
          endCall();
        }
        return;
      }

      if (msg.type === "session.ended") {
        stopTimer();
        stopAudio();
        setStatus("ended");
        onSessionEndRef.current?.();
        return;
      }

      if (msg.type === "session.error") {
        setError(englishErrorForSessionError(msg));
        setStatus("error");
      }
    },
    [endCall, stopAudio, stopTimer],
  );

  const startCall = useCallback(
    async (passcode?: string, forceLive?: boolean): Promise<boolean> => {
      const useLive = forceLive !== undefined ? forceLive : !isDev;
      setIsLiveMode(useLive);
      liveRef.current = useLive;
      reset();
      setStatus("connecting");
      s1Sent.current = false;
      pendingEnd.current = false;

      let wsUrl = mockUrl;

      if (useLive) {
        if (!passcode) {
          setError("Demo passcode is required for live voice agent mode.");
          setStatus("error");
          return false;
        }
        try {
          const tokenRes = await fetch(
            "/api/voice-token?passcode=" + encodeURIComponent(passcode),
            { cache: "no-store" },
          );
          if (!tokenRes.ok) {
            setError(`Token authentication failed (${tokenRes.status}).`);
            setStatus("error");
            return false;
          }
          const tokenData = (await tokenRes.json()) as { token?: string };
          if (!tokenData.token) {
            setError("No token returned from server.");
            setStatus("error");
            return false;
          }
          wsUrl = buildWsUrl(tokenData.token);
        } catch (err) {
          setError("Could not reach token service: " + String(err));
          setStatus("error");
          return false;
        }

        // Initialize audio playback context
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const ctx = new AudioCtx();
          audioCtx.current = ctx;
          playback.current = createPlaybackQueue(ctx, () => {
            setStatus((s) => (s === "speaking" ? "listening" : s));
          });
        } catch (err) {
          console.warn("Playback init failed:", err);
        }
      }

      try {
        const sock = new WebSocket(wsUrl);
        ws.current = sock;

        sock.onopen = () => {
          // Send S0 configuration
          sock.send(JSON.stringify(initialUpdate()));
        };

        sock.onmessage = (event) => {
          void handleMessage(String(event.data));
        };

        sock.onerror = () => {
          setError(
            useLive
              ? "Failed to connect to AssemblyAI Voice Agent."
              : "Could not connect to mock agent (ws://localhost:8787).",
          );
          setStatus("error");
        };

        sock.onclose = (event) => {
          stopTimer();
          stopAudio();
          if (event.code !== 1000) {
            setError(englishErrorForClose(event.code));
            setStatus("error");
          } else {
            setStatus("ended");
          }
        };

        return true;
      } catch (err) {
        setError(String(err));
        setStatus("error");
        return false;
      }
    },
    [handleMessage, isDev, mockUrl, reset, stopAudio, stopTimer],
  );

  // Clean unmount
  useEffect(() => {
    return () => {
      stopTimer();
      stopAudio();
      closeSocket();
    };
  }, [closeSocket, stopAudio, stopTimer]);

  return {
    status,
    seconds,
    sessionId,
    chat,
    lastAgentSay,
    lastUserSay,
    error,
    isLiveMode,
    startCall,
    endCall,
    reset,
    sendSay,
  };
}
