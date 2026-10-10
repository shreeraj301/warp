export type WarpAudio = {
  resume: () => void;
  update: (speedNorm: number, boost: number, enabled: boolean) => void;
  suspend: () => void;
};

export function createWarpAudio(): WarpAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let drone: GainNode | null = null;
  let air: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let low: OscillatorNode | null = null;
  let high: OscillatorNode | null = null;

  function ensure() {
    if (ctx) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    low = ctx.createOscillator();
    high = ctx.createOscillator();
    low.type = "sine";
    high.type = "sine";
    low.frequency.value = 52;
    high.frequency.value = 104;
    drone = ctx.createGain();
    drone.gain.value = 0.07;
    low.connect(drone);
    high.connect(drone);
    drone.connect(master);
    low.start();
    high.start();

    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x1234567;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.65;
    air = ctx.createGain();
    air.gain.value = 0;
    noise.connect(filter);
    filter.connect(air);
    air.connect(master);
    noise.start();
  }

  return {
    resume() {
      ensure();
      if (!ctx || !master) return;
      void ctx.resume();
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.linearRampToValueAtTime(0.9, t + 0.35);
    },
    update(speedNorm, boost, enabled) {
      if (!ctx || !master || !filter || !air || !drone || !low || !high) return;
      const t = ctx.currentTime;
      master.gain.setTargetAtTime(enabled ? 0.85 : 0, t, 0.08);
      const norm = Math.max(0, Math.min(1, speedNorm));
      filter.frequency.setTargetAtTime(260 + norm * 1100 + boost * 800, t, 0.12);
      air.gain.setTargetAtTime(enabled ? 0.012 + norm * 0.04 + boost * 0.05 : 0, t, 0.1);
      drone.gain.setTargetAtTime(enabled ? 0.045 + boost * 0.03 : 0, t, 0.12);
      low.frequency.setTargetAtTime(48 + boost * 18 + norm * 10, t, 0.15);
      high.frequency.setTargetAtTime(96 + boost * 40 + norm * 20, t, 0.15);
    },
    suspend() {
      void ctx?.suspend();
    },
  };
}
