import type {
  AudioCalibration,
  AudioTelemetry,
  NoiseEnvironmentLabel,
} from './types';

export const MIN_MOVE_SPEED = 1.35;
export const MAX_RUN_SPEED = 11.4;
export const JUMP_THRESHOLD_OFFSET = 0.3;
export const JUMP_MIN_VELOCITY = 11.2;
export const JUMP_MAX_VELOCITY = 19.0;
export const JUMP_COOLDOWN_MS = 185;
export const AUTO_CAL_SETTLE_MS = 220;
export const AUTO_CAL_SCAN_MS = 1600;

/**
 * Computes root-mean-square amplitude (0..1) from unsigned 8-bit time-domain PCM samples
 * (centered at 128) or normalized Float32 PCM samples (-1..1).
 */
export function computeRmsFromBytes(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const centered = (samples[i] - 128) / 128;
    sumSq += centered * centered;
  }
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Scales raw RMS by calibration sensitivity into a smooth 0..1 meter reading.
 * Uses a mild perceptual curve so soft voices/sounds register cleanly.
 */
export function normalizeSoundLevel(rawRms: number, sensitivity: number): number {
  if (!Number.isFinite(rawRms) || rawRms <= 0) return 0;
  const safeSens = Math.min(3.0, Math.max(0.5, sensitivity));
  const boosted = Math.pow(rawRms * safeSens * 2.4, 0.78);
  return Math.min(1, Math.max(0, boosted));
}

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p)),
  );
  return sorted[idx];
}

export interface AutoCalibrationResult {
  calibration: AudioCalibration;
  ambientNoisePct: number;
  environmentLabel: NoiseEnvironmentLabel;
}

/**
 * Computes optimal Move Border threshold (and sensitivity adjustment in very loud rooms)
 * from sampled ambient raw RMS values. Uses the 90th percentile so steady background noise
 * (fans, AC, room hum) is completely blocked while isolated transient spikes don't ruin calibration.
 */
export function computeAutoCalibrationFromSamples(
  rawRmsSamples: number[],
  currentSensitivity = 1.5,
): AutoCalibrationResult {
  const valid = rawRmsSamples
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);

  let sensitivity = Math.min(
    3.0,
    Math.max(0.5, Number.isFinite(currentSensitivity) ? currentSensitivity : 1.5),
  );

  if (valid.length === 0) {
    return {
      calibration: {
        threshold: 0.12,
        sensitivity: Math.round(sensitivity * 10) / 10,
        autoCalibrate: true,
      },
      ambientNoisePct: 0,
      environmentLabel: 'Quiet',
    };
  }

  const p50 = percentileSorted(valid, 0.5);
  const p90 = percentileSorted(valid, 0.9);

  // If the room is loud enough that p90 exceeds 30% of the meter, dial down sensitivity
  // automatically so the player retains generous dynamic range for sprinting and jumping.
  const maxAmbientNormTarget = 0.3;
  let normP90 = normalizeSoundLevel(p90, sensitivity);
  if (normP90 > maxAmbientNormTarget && p90 > 0) {
    const targetLinear = Math.pow(maxAmbientNormTarget, 1 / 0.78);
    const idealSens = targetLinear / (p90 * 2.4);
    sensitivity = Math.min(3.0, Math.max(0.5, Math.round(idealSens * 10) / 10));
    normP90 = normalizeSoundLevel(p90, sensitivity);
  } else {
    sensitivity = Math.round(sensitivity * 10) / 10;
  }

  const normP50 = normalizeSoundLevel(p50, sensitivity);
  const normSpread = Math.max(0, normP90 - normP50);
  // Headroom margin above ambient p90 so quiet moments stay dead still
  const margin = Math.min(0.12, Math.max(0.055, 0.055 + normSpread * 0.65));
  const rawThreshold = normP90 + margin;
  const threshold = Math.round(Math.min(0.46, Math.max(0.06, rawThreshold)) * 100) / 100;

  const ambientNoisePct = Math.round(normP90 * 100);
  const environmentLabel: NoiseEnvironmentLabel =
    ambientNoisePct < 10 ? 'Quiet' : ambientNoisePct < 24 ? 'Moderate' : 'Noisy';

  return {
    calibration: {
      threshold,
      sensitivity,
      autoCalibrate: true,
    },
    ambientNoisePct,
    environmentLabel,
  };
}

/**
 * Stateful 1.8s environment noise scanner (skips initial button-tap transient).
 */
export class AmbientNoiseCalibrator {
  private active = false;
  private startMs = 0;
  private samples: number[] = [];
  private baseSensitivity = 1.5;

  start(nowMs: number, currentSensitivity: number): void {
    this.active = true;
    this.startMs = nowMs;
    this.samples = [];
    this.baseSensitivity = currentSensitivity;
  }

  cancel(): void {
    this.active = false;
    this.samples = [];
  }

  isScanning(): boolean {
    return this.active;
  }

  pushSample(
    rawRms: number,
    nowMs: number,
  ): { progress: number; result: AutoCalibrationResult | null } {
    if (!this.active) {
      return { progress: 0, result: null };
    }

    const elapsed = Math.max(0, nowMs - this.startMs);
    const totalMs = AUTO_CAL_SETTLE_MS + AUTO_CAL_SCAN_MS;

    // Ignore the first 220ms so mouse click / tap noise doesn't inflate the noise floor
    if (elapsed >= AUTO_CAL_SETTLE_MS && Number.isFinite(rawRms) && rawRms >= 0) {
      this.samples.push(rawRms);
    }

    const progress = Math.min(1, elapsed / totalMs);
    if (elapsed >= totalMs && this.samples.length >= 6) {
      this.active = false;
      const result = computeAutoCalibrationFromSamples(
        this.samples,
        this.baseSensitivity,
      );
      this.samples = [];
      return { progress: 1, result };
    }

    return { progress, result: null };
  }
}

/**
 * Derives the loud Jump Threshold from the quieter Move Gate.
 * Below moveThreshold: stationary. Between moveThreshold and jumpThreshold: walk -> sprint.
 * At or above jumpThreshold: sprint + jump!
 */
export function computeJumpThreshold(moveThreshold: number): number {
  const safeMove = Math.min(0.48, Math.max(0.04, moveThreshold));
  return Math.min(0.82, safeMove + JUMP_THRESHOLD_OFFSET);
}

/**
 * Returns 0 when sound is below moveThreshold (character stands completely still),
 * and scales smoothly from 0.01..1.0 as sound grows louder toward jumpThreshold.
 */
export function computeMoveSpeedRatio(
  normalizedLevel: number,
  moveThreshold: number,
): number {
  const safeMove = Math.min(0.48, Math.max(0.04, moveThreshold));
  if (!Number.isFinite(normalizedLevel) || normalizedLevel < safeMove) {
    return 0;
  }
  const jumpThreshold = computeJumpThreshold(safeMove);
  const span = Math.max(0.08, jumpThreshold - safeMove);
  const linear = Math.min(1, Math.max(0, (normalizedLevel - safeMove) / span));
  return Math.max(0.01, Math.pow(linear, 1.15));
}

/**
 * Converts live sound level into exact horizontal run speed (units/sec).
 * Returns strictly 0 without sound above moveThreshold.
 */
export function soundLevelToRunSpeed(
  normalizedLevel: number,
  moveThreshold: number,
  maxRunSpeed = MAX_RUN_SPEED,
): number {
  const ratio = computeMoveSpeedRatio(normalizedLevel, moveThreshold);
  if (ratio <= 0) return 0;
  return MIN_MOVE_SPEED + (maxRunSpeed - MIN_MOVE_SPEED) * ratio;
}

/**
 * Maps normalized sound level above jumpThreshold to a jump power (0..1),
 * or null if the sound is below the jump point.
 */
export function computeJumpPower(
  normalizedLevel: number,
  moveThreshold: number,
): number | null {
  const jumpThreshold = computeJumpThreshold(moveThreshold);
  if (!Number.isFinite(normalizedLevel) || normalizedLevel < jumpThreshold) {
    return null;
  }
  const span = Math.max(0.12, 1 - jumpThreshold);
  const ratio = Math.min(1, Math.max(0, (normalizedLevel - jumpThreshold) / span));
  // Smooth curve so crossing the jump point gives a crisp hop and shouting soars
  return Math.pow(ratio, 0.85);
}

export function jumpPowerToVelocity(power: number): number {
  const p = Math.min(1, Math.max(0, power));
  return JUMP_MIN_VELOCITY + (JUMP_MAX_VELOCITY - JUMP_MIN_VELOCITY) * p;
}

export function describeJumpPower(power: number): string {
  if (power < 0.3) return 'Soft Hop';
  if (power < 0.68) return 'Mid Leap';
  return 'Power Soar';
}

export function describeSoundState(
  normalizedLevel: number,
  moveThreshold: number,
): string {
  const jumpPower = computeJumpPower(normalizedLevel, moveThreshold);
  if (jumpPower !== null) {
    return describeJumpPower(jumpPower);
  }
  const ratio = computeMoveSpeedRatio(normalizedLevel, moveThreshold);
  if (ratio <= 0) return 'Still';
  if (ratio < 0.25) return 'Creep';
  if (ratio < 0.55) return 'Walk';
  if (ratio < 0.82) return 'Run';
  return 'Sprint';
}

export class MicInputController {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private sampleBuffer: Uint8Array<ArrayBuffer> | null = null;
  private isMicActive = false;
  private isRequesting = false;
  private micError: string | null = null;
  private peakLevel = 0;
  private lastTriggerMs = 0;

  async start(): Promise<boolean> {
    if (this.isMicActive) return true;
    if (this.isRequesting) return false;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      this.micError = 'Microphone capture is not supported in this browser.';
      return false;
    }

    this.isRequesting = true;
    this.micError = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });

      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) {
        stream.getTracks().forEach((t) => t.stop());
        this.micError = 'Web Audio API is unavailable in this browser.';
        this.isRequesting = false;
        return false;
      }

      const audioCtx = new AudioContextCtor();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.25;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      this.stream = stream;
      this.audioCtx = audioCtx;
      this.analyser = analyser;
      this.source = source;
      this.sampleBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      this.isMicActive = true;
      this.isRequesting = false;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/denied|notallowed|permission/i.test(msg)) {
        this.micError =
          'Microphone permission was denied. Allow mic access in your browser settings and tap Retry Microphone.';
      } else if (/notfound|devicenotfound/i.test(msg)) {
        this.micError =
          'No microphone was detected on this device. Connect a microphone and tap Retry Microphone.';
      } else {
        this.micError = 'Could not access microphone. Please check permissions and retry.';
      }
      this.isMicActive = false;
      this.isRequesting = false;
      return false;
    }
  }

  sample(calibration: AudioCalibration, nowMs: number, dt: number): AudioTelemetry {
    const jumpThreshold = computeJumpThreshold(calibration.threshold);

    if (!this.isMicActive || !this.analyser || !this.sampleBuffer) {
      this.peakLevel = Math.max(0, this.peakLevel - dt * 1.4);
      return {
        isMicActive: this.isMicActive,
        isRequesting: this.isRequesting,
        micError: this.micError,
        rawRms: 0,
        normalizedLevel: 0,
        peakLevel: this.peakLevel,
        moveSpeedRatio: 0,
        jumpThreshold,
        soundStateLabel: 'Still',
        triggeredThisFrame: false,
        predictedJumpPower: 0,
      };
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }

    this.analyser.getByteTimeDomainData(this.sampleBuffer);
    const rawRms = computeRmsFromBytes(this.sampleBuffer);
    const normalizedLevel = normalizeSoundLevel(rawRms, calibration.sensitivity);
    this.peakLevel = Math.max(normalizedLevel, Math.max(0, this.peakLevel - dt * 1.1));

    const moveSpeedRatio = computeMoveSpeedRatio(normalizedLevel, calibration.threshold);
    const soundStateLabel = describeSoundState(normalizedLevel, calibration.threshold);
    const power = computeJumpPower(normalizedLevel, calibration.threshold);
    let triggeredThisFrame = false;
    let predictedJumpPower = power ?? 0;

    if (power !== null && nowMs - this.lastTriggerMs >= JUMP_COOLDOWN_MS) {
      triggeredThisFrame = true;
      this.lastTriggerMs = nowMs;
      predictedJumpPower = power;
    }

    return {
      isMicActive: this.isMicActive,
      isRequesting: this.isRequesting,
      micError: this.micError,
      rawRms,
      normalizedLevel,
      peakLevel: this.peakLevel,
      moveSpeedRatio,
      jumpThreshold,
      soundStateLabel,
      triggeredThisFrame,
      predictedJumpPower,
    };
  }

  getStatus(): Pick<AudioTelemetry, 'isMicActive' | 'isRequesting' | 'micError'> {
    return {
      isMicActive: this.isMicActive,
      isRequesting: this.isRequesting,
      micError: this.micError,
    };
  }

  dispose(): void {
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.analyser?.disconnect();
    } catch {
      // ignore
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close();
    }
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.audioCtx = null;
    this.sampleBuffer = null;
    this.isMicActive = false;
  }
}
