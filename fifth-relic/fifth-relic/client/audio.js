// Procedural audio — every sound is synthesized at runtime (no third-party samples).
export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null; this.started = false;
    this.danger = 0; this.region = 'wilds'; this.rain = 0;
  }
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC(); this.started = true;
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.music = c.createGain(); this.music.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    this.applyVolumes();
    // Noise buffer reused by rain, wind, impacts.
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // Rain bed.
    this.rainSrc = this.loopNoise(); const rf = c.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1400;
    this.rainGain = c.createGain(); this.rainGain.gain.value = 0;
    this.rainSrc.connect(rf).connect(this.rainGain).connect(this.amb);
    // Wind / room tone.
    this.windSrc = this.loopNoise(); const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380;
    this.windGain = c.createGain(); this.windGain.gain.value = 0.05;
    this.windSrc.connect(wf).connect(this.windGain).connect(this.amb);
    // Music: drone pad + log-drum pulse whose density follows danger.
    this.pad = [];
    this.padGain = c.createGain(); this.padGain.gain.value = 0.0; this.padGain.connect(this.music);
    const pf = c.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 900; pf.connect(this.padGain);
    this.padFilter = pf;
    for (const [f, det] of [[55, 0], [82.4, 4], [110, -5], [164.8, 3]]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const g = c.createGain(); g.gain.value = 0.05; o.connect(g).connect(pf); o.start(); this.pad.push(o);
    }
    this.nextBeat = c.currentTime + 0.5; this.step = 0;
    this.nextBird = c.currentTime + 2;
  }
  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.vol;
    this.music.gain.value = this.settings.music;
  }
  loopNoise() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(); return s; }

  // Called each frame with environment state.
  update(env) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    this.danger += ((env.danger || 0) - this.danger) * 0.02;
    this.rainGain.gain.setTargetAtTime(env.rain * 0.22, now, 0.5);
    this.windGain.gain.setTargetAtTime(env.wind * 0.12 + 0.03, now, 0.8);
    this.padGain.gain.setTargetAtTime(env.inGame ? 0.25 + this.danger * 0.25 : 0.18, now, 1.0);
    this.padFilter.frequency.setTargetAtTime(500 + this.danger * 1600, now, 0.6);
    const key = { wilds: 1, ravine: 1, ruins: 1.122, peaks: 0.891, heart: 0.944 }[env.region] || 1;
    this.pad.forEach((o, i) => o.frequency.setTargetAtTime([55, 82.4, 110, 164.8][i] * key, now, 2));
    // Percussion scheduler.
    while (this.nextBeat < now + 0.2) {
      const bpm = 84 + this.danger * 48, spb = 60 / bpm / 2;
      const pat = this.danger > 0.5 ? [1, 0, 1, 1, 0, 1, 1, 0] : this.danger > 0.15 ? [1, 0, 0, 1, 0, 0, 1, 0] : [1, 0, 0, 0, 0, 0, 0, 0];
      if (env.inGame && pat[this.step % 8]) this.drum(this.nextBeat, this.step % 4 === 0 ? 70 : 110, 0.35 + this.danger * 0.3);
      this.step++; this.nextBeat += spb;
    }
    // Birds and insects in the jungle.
    if (env.region === 'wilds' && now > this.nextBird) { this.nextBird = now + 1.5 + Math.random() * 4; this.bird(); }
  }
  env(gain, t, a, d) { gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(a, t + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, t + d); }
  drum(t, f, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    this.env(g, t, vol, 0.35); o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.4);
  }
  bird() {
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner();
    const f = 1800 + Math.random() * 2400; p.pan.value = Math.random() * 2 - 1;
    o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    for (let i = 0; i < 3; i++) o.frequency.linearRampToValueAtTime(f * (i % 2 ? 0.7 : 1.25), t + 0.06 * (i + 1));
    this.env(g, t, 0.05, 0.25); o.connect(g).connect(p).connect(this.amb); o.start(t); o.stop(t + 0.3);
  }
  // Positional one-shot: pan by bearing, attenuate by distance.
  play(name, opts = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = c.createGain(), pan = c.createStereoPanner();
    out.gain.value = (opts.vol ?? 1) * Math.max(0, 1 - (opts.dist || 0) / 60);
    pan.pan.value = Math.max(-1, Math.min(1, opts.pan || 0));
    out.connect(pan).connect(this.sfx);
    const noiseHit = (dur, fType, freq, vol, q = 1) => {
      const s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = fType; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); this.env(g, t, vol, dur); s.connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
      return f;
    };
    const tone = (type, f0, f1, dur, vol, delay = 0) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type;
      o.frequency.setValueAtTime(f0, t + delay); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      this.env(g, t + delay, vol, dur); o.connect(g).connect(out); o.start(t + delay); o.stop(t + delay + dur + 0.05);
    };
    switch (name) {
      case 'swing': noiseHit(0.18, 'bandpass', 900, 0.25, 0.8); break;
      case 'hit': noiseHit(0.12, 'lowpass', 700, 0.5); tone('square', 160, 60, 0.1, 0.15); break;
      case 'blocked': tone('triangle', 900, 700, 0.12, 0.2); noiseHit(0.08, 'highpass', 3000, 0.2); break;
      case 'shot': noiseHit(0.22, 'lowpass', 2400, 0.55); tone('sawtooth', 240, 50, 0.12, 0.2); break;
      case 'hurt': tone('sawtooth', 220, 90, 0.25, 0.25); noiseHit(0.15, 'lowpass', 500, 0.4); break;
      case 'roar': noiseHit(0.7, 'bandpass', 300, 0.5, 2); tone('sawtooth', 90, 55, 0.7, 0.25); break;
      case 'quake': noiseHit(0.9, 'lowpass', 160, 0.9); tone('sine', 50, 30, 0.9, 0.5); break;
      case 'death': [440, 349, 262, 196].forEach((f, i) => tone('triangle', f, 0, 0.5, 0.25, i * 0.18)); break;
      case 'heal': [523, 659, 784].forEach((f, i) => tone('sine', f, 0, 0.4, 0.15, i * 0.07)); break;
      case 'ability': tone('triangle', 330, 660, 0.25, 0.2); break;
      case 'pickup': [880, 1320].forEach((f, i) => tone('sine', f, 0, 0.2, 0.15, i * 0.06)); break;
      case 'ui': tone('triangle', 660, 0, 0.06, 0.12); break;
      case 'gate': noiseHit(1.6, 'lowpass', 220, 0.7); tone('sine', 70, 50, 1.6, 0.3); break;
      case 'chime': tone('sine', opts.f || 523, 0, 1.4, 0.35); tone('sine', (opts.f || 523) * 2, 0, 0.8, 0.1); break;
      case 'discord': tone('sawtooth', 233, 0, 0.8, 0.2); tone('sawtooth', 247, 0, 0.8, 0.2); break;
      case 'thunder': noiseHit(2.5, 'lowpass', 120, 1.0); break;
      case 'beam': tone('sawtooth', 120, 900, 0.5, 0.3); noiseHit(0.5, 'highpass', 2000, 0.3); break;
      case 'warp': tone('sine', 200, 1600, 1.6, 0.3); tone('sine', 203, 1610, 1.6, 0.3); noiseHit(1.6, 'bandpass', 1200, 0.2, 4); break;
      case 'steward': tone('sine', 392, 0, 0.12, 0.08); tone('sine', 523, 0, 0.12, 0.06, 0.1); break;
      case 'curator': tone('sawtooth', 98, 92, 0.4, 0.12); break;
      case 'evade': noiseHit(0.15, 'highpass', 2500, 0.2); break;
      case 'empty': tone('square', 180, 0, 0.05, 0.15); break;
      default: break;
    }
  }
  // Optional synthesized speech for dialogue (browser voice; content is original).
  speak(speaker, text) {
    if (!this.settings.voice || !window.speechSynthesis || !speaker || speaker === 'TEAM') return;
    const u = new SpeechSynthesisUtterance(text.replace(/[—()]/g, ' '));
    u.rate = speaker === 'STEWARD' ? 0.92 : 1.0; u.pitch = speaker === 'CURATOR' ? 0.5 : speaker === 'STEWARD' ? 1.25 : 1;
    u.volume = Math.min(1, this.settings.vol * 1.2);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}
