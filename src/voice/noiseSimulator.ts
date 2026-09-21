// Web Audio API based factory ambient noise simulator.
// Simulates realistic CNC milling, coolant spray, and spindle motor rumble
// with ZERO external audio file dependencies and zero bandwidth overhead.
// Designed for testing AssemblyAI Voice Focus noise suppression live.

let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let noiseSource: AudioBufferSourceNode | null = null;
let humOscillator: OscillatorNode | null = null;
let humGain: GainNode | null = null;
let isRunning = false;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// Generate a 3-second buffer of pink-filtered mechanical rush noise
function createCncNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const bufferSize = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    // Pink noise filter algorithm (Paul Kellet's method)
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    data[i] = pink * 0.08; // scale down
  }

  return buffer;
}

/**
 * Start simulating 75dB factory background noise (CNC spindle + coolant air).
 * @param volume Initial volume level (0.0 to 1.0, default 0.35 roughly ~75dB equivalent).
 */
export function startFactoryNoise(volume = 0.35): boolean {
  if (typeof window === "undefined") return false;
  if (isRunning) return true;

  try {
    const ctx = getAudioContext();

    // 1. Master Gain
    gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(volume, 0.01), ctx.currentTime + 0.5);
    gainNode.connect(ctx.destination);

    // 2. High/Mid cut filter to simulate shopfloor enclosure / machine cabin
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, ctx.currentTime);
    filter.connect(gainNode);

    // 3. Pink noise source (coolant rush + cutting hiss)
    const buffer = createCncNoiseBuffer(ctx);
    noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;
    noiseSource.connect(filter);
    noiseSource.start();

    // 4. Low hum oscillator (60Hz CNC spindle motor rotation)
    humOscillator = ctx.createOscillator();
    humOscillator.type = "triangle";
    humOscillator.frequency.setValueAtTime(62, ctx.currentTime); // ~3720 RPM spindle harmonic

    humGain = ctx.createGain();
    humGain.gain.setValueAtTime(0.2, ctx.currentTime);

    humOscillator.connect(humGain);
    humGain.connect(gainNode);
    humOscillator.start();

    isRunning = true;
    return true;
  } catch (err) {
    console.error("Failed to start factory noise simulator:", err);
    return false;
  }
}

/**
 * Stop the factory background noise with a smooth fade-out.
 */
export function stopFactoryNoise(): void {
  if (!isRunning || !gainNode || !audioCtx) {
    isRunning = false;
    return;
  }

  try {
    const ctx = audioCtx;
    // Fade out over 250ms to prevent clicking
    gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);

    setTimeout(() => {
      try {
        noiseSource?.stop();
        noiseSource?.disconnect();
        humOscillator?.stop();
        humOscillator?.disconnect();
        noiseSource = null;
        humOscillator = null;
        gainNode?.disconnect();
        gainNode = null;
      } catch {
        // ignore cleanup errors
      }
    }, 280);
  } catch {
    // ignore
  } finally {
    isRunning = false;
  }
}

/**
 * Set the noise volume dynamically (0.0 to 1.0).
 */
export function setFactoryNoiseVolume(volume: number): void {
  if (!gainNode || !audioCtx) return;
  const clamped = Math.max(0.001, Math.min(1.0, volume));
  gainNode.gain.setValueAtTime(clamped, audioCtx.currentTime);
}

/**
 * Check if the noise simulator is currently active.
 */
export function isFactoryNoiseActive(): boolean {
  return isRunning;
}
