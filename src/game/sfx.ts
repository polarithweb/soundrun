class ProceduralSfx {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(
    startFreq: number,
    endFreq: number,
    durationSec: number,
    type: OscillatorType,
    volume: number,
    delaySec = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + durationSec);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  jump(power: number): void {
    const base = 260 + power * 140;
    this.playTone(base, base * 2.05, 0.16, 'triangle', 0.12);
  }

  vault(): void {
    this.playTone(340, 580, 0.09, 'sine', 0.08);
  }

  coin(): void {
    this.playTone(987.77, 987.77, 0.06, 'sine', 0.09, 0);
    this.playTone(1318.51, 1318.51, 0.16, 'sine', 0.09, 0.055);
  }

  starCoin(): void {
    this.playTone(783.99, 783.99, 0.08, 'triangle', 0.11, 0);
    this.playTone(987.77, 987.77, 0.08, 'triangle', 0.11, 0.07);
    this.playTone(1318.51, 1567.98, 0.24, 'triangle', 0.12, 0.14);
  }

  bonk(): void {
    this.playTone(220, 440, 0.1, 'square', 0.07);
  }

  spring(): void {
    this.playTone(240, 880, 0.24, 'triangle', 0.12);
  }

  stomp(): void {
    this.playTone(300, 120, 0.11, 'sawtooth', 0.08);
  }

  damage(): void {
    this.playTone(260, 85, 0.25, 'sawtooth', 0.12);
  }

  flagpole(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, n, 0.18, 'triangle', 0.12, idx * 0.11);
    });
  }

  dispose(): void {
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close();
    }
    this.ctx = null;
  }
}

export const gameSfx = new ProceduralSfx();
