// @ts-check
// Synthesised sound effects and a looping tune (Web Audio, no files).
// From legacy/kitchen-race.html and brick-race.html, where the same tone()
// helper and "Bing!" were copied into each game.
//
// Browsers only allow audio after a user gesture, so call ensure() from a
// click or pointerdown. Every effect is a silent no-op before that.

/**
 * @param {{ defaultGain?: number }} [opts]
 *   defaultGain: kitchen-race used 0.22, brick-race 0.25 for the same effects.
 *   Each game passes its own so both sound exactly as before.
 */
export function createAudio({ defaultGain = 0.22 } = {}) {
  /** @type {AudioContext | null} */
  let ctx = null;

  function ensure() {
    if (!ctx) ctx = new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /**
   * One enveloped oscillator note.
   * @param {number} f frequency (Hz)  @param {number} start delay (s)  @param {number} dur length (s)
   * @param {OscillatorType} [type] @param {number} [gain] @param {number | null} [when] absolute start time
   */
  function tone(f, start, dur, type = "sine", gain = defaultGain, when = null) {
    if (!ctx) return;
    const t0 = (when ?? ctx.currentTime) + start, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /**
   * High-passed white-noise burst that fades out.
   * @param {number} dur @param {number} [gain] @param {number} [hp] high-pass cutoff (Hz) @param {number | null} [when]
   */
  function noise(dur, gain = 0.15, hp = 800, when = null) {
    if (!ctx) return;
    const t0 = when ?? ctx.currentTime, buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf; f.type = "highpass"; f.frequency.value = hp; g.gain.value = gain;
    s.connect(f).connect(g).connect(ctx.destination); s.start(t0);
  }

  const sfx = {
    bing: () => { tone(1046, 0, 0.5); tone(1568, 0.06, 0.6); },                          // every correct action
    chop: () => { tone(220, 0, 0.08, "square", 0.12); noise(0.06, 0.2, 2000); },
    swish: () => noise(0.12, 0.06, 1500),
    crack: () => { noise(0.05, 0.25, 3000); tone(330, 0, 0.1, "triangle", 0.15); },
    sizzle: () => noise(0.5, 0.08, 4000),
    shake: () => noise(0.04, 0.12, 5000),
    dingdong: () => { tone(659, 0, 0.35); tone(523, 0.18, 0.5); },
    fanfare: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.5)); tone(1318, 0.5, 0.9); },
    tick: () => tone(660, 0, 0.12, "square", 0.08),                                         // countdown
    go: () => tone(880, 0, 0.4, "square", 0.1),
    bonk: () => tone(160, 0, 0.18, "triangle", 0.2),                                        // wrong drop (bricks)
  };

  return { ensure, tone, noise, sfx, get ctx() { return ctx; } };
}

/**
 * Looping two-voice tune scheduled slightly ahead of time so it doesn't
 * stutter when the page is busy. From legacy/kitchen-race.html.
 * @param {ReturnType<typeof createAudio>} audio
 * @param {{ melody: number[], bass: number[], bpm: number }} song  0 = rest
 */
export function createLoop(audio, song) {
  let timer = /** @type {ReturnType<typeof setInterval> | null} */ (null), next = 0, step = 0;
  let bpm = song.bpm;
  function schedule() {
    const ctx = audio.ctx; if (!ctx) return;
    const len = 60 / bpm / 2;
    while (next < ctx.currentTime + 0.15) {
      const i = step % song.melody.length;
      if (song.melody[i]) audio.tone(song.melody[i], 0, len * 0.9, "square", 0.05, next);
      if (song.bass[i]) audio.tone(song.bass[i], 0, len * 1.6, "triangle", 0.12, next);
      if (i % 2 === 0) audio.noise(0.03, i % 4 === 0 ? 0.08 : 0.04, 6000, next);
      next += len; step++;
    }
  }
  return {
    start() { const ctx = audio.ensure(); step = 0; next = ctx.currentTime + 0.05; this.stop(); timer = setInterval(schedule, 60); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    get playing() { return !!timer; },
    get bpm() { return bpm; },
    set bpm(v) { bpm = v; },
  };
}
