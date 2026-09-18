// 語音線：收音＋播放（規格書 §4.4，不連線、不花錢的純前端模組）
//
// 白話：麥克風收到的聲音太「大包」（瀏覽器預設取樣率），這裡把它切成
// 小塊、轉成 AssemblyAI 要的格式（PCM16、單聲道、24kHz、base64），再送出。
// 助理回的話（reply.audio）先排隊再播；操作員一插話就立刻停掉並清空。
//
// 內嵌字串做法（已定案，不放 public/voice/）：AudioWorklet 的程式寫成字串，
// 用 Blob 網址載入，跟官方範本 server.mjs 同一招。

// §4.4 收音設定：回音消除開、瀏覽器降噪關（交給伺服器的 voice_focus）、自動音量開。
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
  },
};

// AssemblyAI 要的聲音規格（結論 ①）。
export const SAMPLE_RATE = 24000;
export const WORKLET_NAME = "voiceandon-capture";

// AudioWorklet 處理器（內嵌字串）：只負責把麥克風的 Float32 音框轉交出來，
// 降取樣＋轉 PCM16＋轉 base64 在主執行緒做（好單測，不用開瀏覽器也能測）。
export const CAPTURE_WORKLET_SRC = `
class VoiceAndonCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs && inputs[0] && inputs[0][0];
    if (ch && ch.length > 0) {
      this.port.postMessage(ch.slice(0));
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(WORKLET_NAME)}, VoiceAndonCapture);
`;

// ---- 純函式（Node 也能跑，node --test 直接測） ----

// 把任意取樣率的 Float32 單聲道音訊降（或升）取樣到 24kHz（線性內插，夠 Demo 用）。
export function resampleTo24k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SAMPLE_RATE) return input.slice(0);
  if (input.length === 0) return new Float32Array(0);
  const outLen = Math.max(1, Math.round((input.length * SAMPLE_RATE) / fromRate));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = (i * (input.length - 1)) / Math.max(1, outLen - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(input.length - 1, lo + 1);
    out[i] = input[lo] + (input[hi] - input[lo]) * (pos - lo);
  }
  return out;
}

// Float32（-1～1）→ PCM16（小端整數）。
export function floatToPCM16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return pcm;
}

// PCM16 → base64（瀏覽器和 Node 都能跑）。
export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// base64 → PCM16（播放排隊解碼用；瀏覽器和 Node 都能跑）。
export function base64ToPCM16(b64: string): Int16Array {
  let bytes: Uint8Array;
  if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(b64, "base64"));
  } else {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  const even = bytes.length - (bytes.length % 2);
  return new Int16Array(bytes.buffer, bytes.byteOffset, even / 2);
}

// 一步到位：麥克風 Float32 音框＋當時的取樣率 → input.audio 要送的 base64。
export function encodeMicChunk(frame: Float32Array, fromRate: number): string {
  return pcm16ToBase64(floatToPCM16(resampleTo24k(frame, fromRate)));
}

// 測試音：正弦波一句話長度的 base64（給無麥克風的連線測試用，不是真人聲）。
export function makeTestToneB64(freqHz: number, seconds: number): string {
  const n = Math.max(1, Math.round(SAMPLE_RATE * seconds));
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = 0.3 * Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE);
  }
  return pcm16ToBase64(floatToPCM16(samples));
}

// ---- 瀏覽器才有的部分（Node 測不到，由 Chrome 實測） ----

// 開麥克風（一定要 localhost 或 https，否則瀏覽器不給）。
export async function createMicStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
}

export interface CaptureHandle {
  stop: () => void;
}

// 開始收音：worklet 吐小碎框，這裡累積到約 100 毫秒再一次編碼送出
// （碎框直接送會變成每秒幾百個 WebSocket 訊息，太吵）。
export async function startCapture(
  ctx: AudioContext,
  stream: MediaStream,
  onChunk: (audioB64: string) => void,
  framesPerChunk = 4800,
): Promise<CaptureHandle> {
  const blobUrl = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET_SRC], { type: "application/javascript" }),
  );
  try {
    await ctx.audioWorklet.addModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, WORKLET_NAME);
  let pending: Float32Array[] = [];
  let pendingLen = 0;
  node.port.onmessage = (event: MessageEvent) => {
    const frame = event.data as Float32Array;
    if (!frame || frame.length === 0) return;
    pending.push(frame);
    pendingLen += frame.length;
    if (pendingLen >= framesPerChunk) {
      const merged = new Float32Array(pendingLen);
      let off = 0;
      for (const f of pending) {
        merged.set(f, off);
        off += f.length;
      }
      pending = [];
      pendingLen = 0;
      onChunk(encodeMicChunk(merged, ctx.sampleRate));
    }
  };
  source.connect(node);
  return {
    stop: () => {
      try {
        source.disconnect();
      } catch {
        // 已經斷開就不用再斷。
      }
      try {
        node.disconnect();
      } catch {
        // 同上。
      }
    },
  };
}

// 播放排隊用到的最小 AudioContext 形狀（只列真的會用到的，方便 Node 用假物件單測）。
export interface MinimalAudioContext {
  readonly sampleRate: number;
  readonly destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): {
    getChannelData(channel: number): Float32Array;
  };
  createBufferSource(): MinimalSourceNode;
}

// 播放用的最小聲音節點形狀（onended 各家簽名不同，只當未知屬性搬運）。
export interface MinimalSourceNode {
  connect(dest: unknown): void;
  start(): void;
  stop(): void;
  buffer: unknown;
  onended: unknown;
}

function setOnEnded(node: MinimalSourceNode, fn: (() => void) | null): void {
  (node as unknown as { onended: (() => void) | null }).onended = fn;
}

export interface PlaybackQueue {
  // 收到 reply.audio 就排進來；回傳目前排了幾個（含正在播的）。
  enqueue(audioB64: string): number;
  // 插話時呼叫：立刻停掉正在播的並清空排隊；回傳清掉幾個。
  stopAndClear(): number;
  dispose(): void;
}

// 收到 reply.audio 就排隊播放（§4.4）。播完一個自動播下一個，
// 全部播完呼叫 onEmpty（畫面切回 listening）。
export function createPlaybackQueue(
  ctx: MinimalAudioContext,
  onEmpty: () => void,
): PlaybackQueue {
  const waiting: string[] = [];
  let current: MinimalSourceNode | null = null;
  let disposed = false;

  function pump() {
    if (disposed || current) return;
    const next = waiting.shift();
    if (next === undefined) {
      onEmpty();
      return;
    }
    const pcm = base64ToPCM16(next);
    const buf = ctx.createBuffer(1, Math.max(1, pcm.length), SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    current = src;
    setOnEnded(src, () => {
      if (current === src) current = null;
      pump();
    });
    src.start();
  }

  return {
    enqueue(audioB64: string): number {
      if (disposed) return 0;
      waiting.push(audioB64);
      pump();
      return waiting.length + (current ? 1 : 0);
    },
    stopAndClear(): number {
      const dropped = waiting.length + (current ? 1 : 0);
      waiting.length = 0;
      const playing = current;
      current = null;
      if (playing) {
        setOnEnded(playing, null);
        try {
          playing.stop();
        } catch {
          // 已經停了就不用再停。
        }
      }
      return dropped;
    },
    dispose() {
      disposed = true;
      waiting.length = 0;
      const playing = current;
      current = null;
      if (playing) {
        setOnEnded(playing, null);
        try {
          playing.stop();
        } catch {
          // 收尾，忽略。
        }
      }
    },
  };
}
