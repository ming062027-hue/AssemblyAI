// 語音線：免接觸「嘿宇宙」喚醒模組 (Hands-Free Wake-Word Detector)
// 就像 iPhone 的 Siri，操作員雙手沾滿切削油、戴厚手套時，
// 只要對著空氣喊「嘿宇宙」或「宇宙」，系統立即響起高科技雙頻音效、
// 語音回答「我在，請說！」，並自動開啟聆聽與執行指令。

import { useCallback, useEffect, useRef } from "react";

// Web Audio 高科技雙音合成（叮咚 Chime：520Hz -> 780Hz），零外部檔案依賴
export function playWakeChime(): void {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // 第一音 (520Hz - 中頻短音)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(520, now);
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    // 第二音 (784Hz - G5 清脆高音)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(784, now + 0.12);
    gain2.gain.setValueAtTime(0.3, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.45);

    setTimeout(() => {
      void ctx.close();
    }, 600);
  } catch (err) {
    console.warn("Wake chime audio failed:", err);
  }
}

// 喚醒詞匹配正則（支援繁中、簡中與英文）
const WAKE_WORD_RE =
  /(?:嘿|嗨|hey|hi)?\s*(?:宇宙|小宇宙|model\s*宇宙|管家|universe)/i;

export interface WakeWordOptions {
  enabled: boolean;
  onWake: () => void;
  onCommand?: (command: string) => void;
}

export function useWakeWordListener({
  enabled,
  onWake,
  onCommand,
}: WakeWordOptions): {
  isListeningWake: boolean;
} {
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const activeRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  const startListener = useCallback(() => {
    if (typeof window === "undefined" || !enabled) return;
    const w = window as any;
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRec) return;

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }

      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "zh-TW";

      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcript = String(res[0]?.transcript ?? "").trim();
          if (!transcript) continue;

          // 檢查是否包含喚醒詞
          const match = transcript.match(WAKE_WORD_RE);
          if (match) {
            playWakeChime();
            onWakeRef.current?.();

            // 檢查喚醒詞後方是否連帶了指令（例如：「嘿宇宙查 414 警報」）
            const afterWake = transcript
              .slice((match.index ?? 0) + match[0].length)
              .replace(/^[，,。.！？!?\s]+/, "")
              .trim();

            if (afterWake && onCommandRef.current) {
              setTimeout(() => {
                onCommandRef.current?.(afterWake);
              }, 400);
            }
            break;
          }
        }
      };

      rec.onerror = (e: any) => {
        // 連續監聽遇到 no-speech 或 network 錯誤時自動重啟
        if (activeRef.current && e.error !== "aborted") {
          setTimeout(() => {
            if (activeRef.current) {
              try {
                rec.start();
              } catch {
                // ignore
              }
            }
          }, 1000);
        }
      };

      rec.onend = () => {
        // 瀏覽器逾時結束時，只要 enabled 就自動重新啟動保持常時監聽
        if (activeRef.current) {
          setTimeout(() => {
            if (activeRef.current) {
              try {
                rec.start();
              } catch {
                // ignore
              }
            }
          }, 300);
        }
      };

      recognitionRef.current = rec;
      rec.start();
      activeRef.current = true;
    } catch (err) {
      console.warn("Wake word listener initialization failed:", err);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      activeRef.current = true;
      startListener();
    } else {
      activeRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    }

    return () => {
      activeRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, [enabled, startListener]);

  return {
    isListeningWake: enabled && activeRef.current,
  };
}
