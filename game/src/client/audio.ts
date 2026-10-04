// Synthesised street sound: no audio files to download. A filtered-noise
// traffic bed that swells with nearby vehicles, a faint city murmur, and
// positional horns ("pin pin" for danfos and kekes, a thin beep for okadas).

export class StreetAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bed!: GainNode;
  private noise!: AudioBuffer;
  private engine: { oscs: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode; skid: GainNode } | null = null;
  muted = false;

  /** Must be called from a user gesture (browsers block autoplay). */
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // Brown noise: integrated white noise, the low rumble of engines.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    this.noise = noise;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    this.bed = ctx.createGain();
    this.bed.gain.value = 0;
    src.connect(lp).connect(this.bed).connect(this.master);

    // Constant distant city murmur.
    const murmur = ctx.createBufferSource();
    murmur.buffer = noise;
    murmur.loop = true;
    murmur.playbackRate.value = 1.7;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    const mg = ctx.createGain();
    mg.gain.value = 0.05;
    murmur.connect(bp).connect(mg).connect(this.master);
    src.start();
    murmur.start();
  }

  /** Engine note while driving: rpm 0..1, throttle 0..1, slip 0..1 (tyre squeal). */
  drive(on: boolean, kind: "car" | "danfo", rpm: number, throttle: number, slip: number, speed: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!on) {
      if (this.engine) {
        const e = this.engine;
        e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        e.skid.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        setTimeout(() => e.oscs.forEach((o) => o.stop()), 400);
        this.engine = null;
      }
      return;
    }
    if (!this.engine) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 600;
      filter.connect(gain).connect(this.master);
      const oscs = [0, 1].map((i) => {
        const o = ctx.createOscillator();
        o.type = i ? "square" : "sawtooth";
        o.connect(filter);
        o.start();
        return o;
      });
      // Tyre squeal: band-passed noise.
      const skidSrc = ctx.createBufferSource();
      skidSrc.buffer = this.noise;
      skidSrc.loop = true;
      skidSrc.playbackRate.value = 3.2;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      bp.Q.value = 4;
      const skid = ctx.createGain();
      skid.gain.value = 0;
      skidSrc.connect(bp).connect(skid).connect(this.master);
      skidSrc.start();
      oscs.push(skidSrc as unknown as OscillatorNode);
      this.engine = { oscs, gain, filter, skid };
    }
    const e = this.engine;
    const t = ctx.currentTime;
    // Diesel danfo idles low and rough; the car revs higher and smoother.
    const base = kind === "danfo" ? 32 : 46;
    const span = kind === "danfo" ? 95 : 170;
    const f = base + rpm * span;
    e.oscs[0].frequency.setTargetAtTime(f, t, 0.04);
    e.oscs[1].frequency.setTargetAtTime(f * (kind === "danfo" ? 0.5 : 1.003), t, 0.04);
    e.filter.frequency.setTargetAtTime(380 + rpm * 900 + throttle * 500, t, 0.05);
    e.gain.gain.setTargetAtTime(0.05 + throttle * 0.07 + rpm * 0.03, t, 0.06);
    e.skid.gain.setTargetAtTime(Math.min(0.12, slip * Math.min(1, speed / 10) * 0.14), t, 0.05);
  }

  /** Short low thump for collisions; strength 0..1. */
  crash(strength: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted || strength < 0.05) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300 + strength * 900;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.9, 0.25 + strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + strength * 0.3);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, 0.7);
  }

  /** Indicator relay: "tick" when the lamp lights, softer "tock" when it goes out. */
  tick(on: boolean) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = on ? 1900 : 1300;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(on ? 0.09 : 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.025);
    o.connect(hp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.03);
  }

  /** Wiper blade reaching the end of its sweep: a soft rubbery thunk. */
  wipe() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, 0.15);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  /** Traffic bed level from the number of nearby vehicles. */
  traffic(nearby: number) {
    if (!this.ctx) return;
    this.bed.gain.setTargetAtTime(Math.min(0.35, 0.04 + nearby * 0.03), this.ctx.currentTime, 0.5);
  }

  /**
   * Horn from a vehicle at (dx, dz) relative to the listener, with the
   * listener facing `yaw`. Danfo/keke: two-tone "pin pin"; okada: thin beep.
   */
  horn(dx: number, dz: number, yaw: number, kind: string) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const dist = Math.hypot(dx, dz);
    if (dist > 120) return;
    const vol = 0.32 / (1 + dist / 12);
    // Pan: project onto the listener's right vector.
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const pan = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / (dist || 1)) * 0.9));
    const out = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      out.connect(panner).connect(this.master);
    } else out.connect(this.master);
    const t0 = ctx.currentTime + 0.02;
    const okada = kind === "okada";
    const beeps = okada ? 2 : Math.random() < 0.5 ? 2 : 3;
    for (let i = 0; i < beeps; i++) {
      const start = t0 + i * (okada ? 0.14 : 0.2);
      const len = okada ? 0.09 : 0.15;
      for (const f of okada ? [880] : [415, 520]) {
        const osc = ctx.createOscillator();
        osc.type = okada ? "triangle" : "square";
        osc.frequency.value = f * (0.98 + Math.random() * 0.04);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(vol * (okada ? 0.6 : 0.35), start + 0.01);
        g.gain.setValueAtTime(vol * (okada ? 0.6 : 0.35), start + len - 0.02);
        g.gain.linearRampToValueAtTime(0, start + len);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 2400;
        osc.connect(lp).connect(g).connect(out);
        osc.start(start);
        osc.stop(start + len + 0.02);
      }
    }
  }
}
