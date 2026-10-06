'use strict';
/* 程序化音效：全部用 WebAudio 即時合成，不需要任何音檔 */
const SFX = {
  ctx: null, master: null, musicGain: null,
  on: true, last: {},

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 0.55 : 0;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.14;
      this.musicGain.connect(this.master);
      this._startMusic();
    } catch (e) { this.ctx = null; }
  },
  resume() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) {} },
  setOn(v) {
    this.on = v;
    if (this.master) this.master.gain.value = v ? 0.55 : 0;
  },
  _thr(key, ms) {
    const t = performance.now();
    if (this.last[key] && t - this.last[key] < ms) return true;
    this.last[key] = t;
    return false;
  },
  /* 振盪器音效：type、起始頻率、結束頻率、長度、音量 */
  _osc(type, f0, f1, dur, vol, key, thrMs) {
    if (!this.ctx || !this.on) return;
    if (key && this._thr(key, thrMs)) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, f0), t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (e) {}
  },
  /* 雜訊音效：爆炸、飛彈噴射 */
  _noise(dur, vol, f0, f1, key, thrMs, type = 'lowpass', q = 0.8) {
    if (!this.ctx || !this.on) return;
    if (key && this._thr(key, thrMs)) return;
    try {
      const t = this.ctx.currentTime, sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(Math.max(40, f0), t);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.05);
    } catch (e) {}
  },

  shoot()  { this._osc('square', 720, 170, 0.08, 0.042, 'sh', 40); },
  pd()     { this._osc('square', 1300, 480, 0.045, 0.02, 'pd', 55); },
  missile(){ this._noise(0.5, 0.09, 380, 1500, 'mi', 130, 'bandpass', 1.4); },
  plasma() { this._osc('sine', 175, 48, 0.3, 0.15, 'pl', 95); },
  beam()   { this._osc('sawtooth', 130, 55, 0.5, 0.09, 'bm', 220); },
  explS()  { this._noise(0.38, 0.2, 900, 110, 'es', 75); },
  explB()  {
    this._noise(0.95, 0.38, 620, 55, 'eb', 160);
    this._osc('sine', 92, 27, 0.85, 0.28, 'ebs', 160);
  },
  warp()   { this._osc('sawtooth', 90, 950, 0.42, 0.11, 'wp', 110); },
  click()  { this._osc('sine', 740, 520, 0.06, 0.1, 'ui', 35); },
  alarm()  {
    this._osc('square', 520, 500, 0.13, 0.09, 'al', 350);
    setTimeout(() => this._osc('square', 390, 380, 0.15, 0.09, 'al2', 0), 150);
  },
  ability(){ this._osc('triangle', 280, 920, 0.32, 0.14, 'ab', 120); },
  hitShield(){ this._osc('triangle', 900, 300, 0.06, 0.02, 'hs', 90); },

  /* 環境音樂：慢速和弦墊音 */
  _chordIdx: 0,
  _startMusic() {
    const chords = [
      [110.0, 130.81, 164.81],  // Am
      [87.31, 110.0, 130.81],   // F
      [130.81, 164.81, 196.0],  // C
      [98.0, 123.47, 146.83],   // G
    ];
    const playChord = () => {
      if (!this.ctx || !this.on) return;
      try {
        const notes = chords[this._chordIdx % chords.length];
        this._chordIdx++;
        const t = this.ctx.currentTime;
        for (const f of notes) {
          for (const det of [1, 1.004]) {
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            const lp = this.ctx.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = 420;
            o.type = 'sawtooth'; o.frequency.value = f * det;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.028, t + 3.2);
            g.gain.linearRampToValueAtTime(0.0001, t + 8.2);
            o.connect(lp); lp.connect(g); g.connect(this.musicGain);
            o.start(t); o.stop(t + 8.4);
          }
        }
      } catch (e) {}
    };
    playChord();
    setInterval(playChord, 8000);
  },
};
/* 瀏覽器規定：要有使用者互動後才能啟動音訊 */
window.addEventListener('pointerdown', () => { SFX.init(); SFX.resume(); });
window.addEventListener('keydown', () => { SFX.init(); SFX.resume(); });
