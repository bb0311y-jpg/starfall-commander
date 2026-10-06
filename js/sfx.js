'use strict';
/* 音效：CC0 素材（js/assets_sfx.js 內嵌 base64 OGG，來源見 _素材包/SFX/manifest.json，
   python debug/build_sfx_assets.py 產生）優先；素材不存在或解碼失敗就走原本的程序化合成（WebAudio 即時合成）當 fallback。 */
const SFX = {
  ctx: null, master: null, musicGain: null,
  on: true, last: {},
  ready: false, _buf: {}, _decodeErr: 0,

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 0.62 : 0;
      /* 母帶 compressor 當安全網：音量放心推大也不爆音，戰鬥時音樂自動退讓 */
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18; this.comp.knee.value = 24;
      this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
      this.master.connect(this.comp);
      this.comp.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.13;
      this.musicGain.connect(this.master);
      this._startMusic();
      this._loadAssets();
    } catch (e) { this.ctx = null; }
  },
  resume() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) {} },
  setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.62 : 0; },
  _thr(key, ms) {
    const t = performance.now();
    if (this.last[key] && t - this.last[key] < ms) return true;
    this.last[key] = t;
    return false;
  },
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

  /* ---------- 素材層 ---------- */
  _loadAssets() {
    if (typeof SFX_ASSETS === 'undefined' || !this.ctx) return;
    const keys = Object.keys(SFX_ASSETS);
    let left = keys.length;
    const fin = () => { if (--left === 0) { this.ready = Object.keys(this._buf).length > 0; this._startLoops(); } };
    for (const k of keys) {
      let settled = false;
      const ok = buf => { if (settled) return; settled = true; this._seamFix(k, buf); this._buf[k] = buf; fin(); };
      const bad = () => { if (settled) return; settled = true; this._decodeErr++; fin(); };
      try {
        const s = SFX_ASSETS[k], bin = atob(s.slice(s.indexOf(',') + 1));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const pr = this.ctx.decodeAudioData(u8.buffer, ok, bad);
        if (pr && pr.catch) pr.catch(bad);
      } catch (e) { bad(); }
    }
  },
  /* 循環接縫修補：有損壓縮讓 loopStart 與 loopEnd 兩處內容不完全相同（實測差 0.03～0.08）→
     把 loopEnd 前 ~21ms 交叉淡化成 loopStart 前的墊片內容（同一段環形延續），循環跳回時樣本就連續 */
  _seamFix(k, buf) {
    if (typeof SFX_LOOP_PTS === 'undefined' || !SFX_LOOP_PTS[k]) return;
    try {
      const sr = buf.sampleRate, a = Math.round(SFX_LOOP_PTS[k][0] * sr), e = Math.round(SFX_LOOP_PTS[k][1] * sr);
      const N = Math.min(1024, a);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < N; i++) { const t = (i + 1) / N; d[e - N + i] = d[e - N + i] * (1 - t) + d[a - N + i] * t; }
      }
    } catch (e) {}
  },
  _pick(keys) {
    const ok = keys.filter(k => this._buf[k]);
    return ok.length ? ok[(Math.random() * ok.length) | 0] : null;
  },
  /* 播素材：o = { vol, rate, pan, loop, lp(低通 Hz), jitter(預設 ±6% 隨機變速), dest }
     回傳 {src, g}；回 null＝素材沒載入，呼叫端改走程序化 */
  _play(key, o = {}) {
    if (!this.ctx || !this._buf[key]) return null;
    if (!this.on && !o.loop) return null;
    try {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this._buf[key];
      src.loop = !!o.loop;
      /* 循環素材頭尾有環形墊片（編解碼邊緣失真），只循環中段才不會「喀」一聲 */
      if (o.loop && typeof SFX_LOOP_PTS !== 'undefined' && SFX_LOOP_PTS[key]) {
        src.loopStart = SFX_LOOP_PTS[key][0]; src.loopEnd = SFX_LOOP_PTS[key][1];
      }
      const j = o.jitter === undefined ? 0.06 : o.jitter;
      src.playbackRate.value = (o.rate || 1) * (1 + (Math.random() * 2 - 1) * j);
      let node = src;
      let f = null;
      if (o.lp) { f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.7; node.connect(f); node = f; }
      const g = ctx.createGain(); g.gain.value = o.vol === undefined ? 1 : o.vol;
      node.connect(g); node = g;
      if (o.pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan));
        node.connect(p); node = p;
      }
      node.connect(o.dest || this.master);
      if (o.loop && src.loopStart) src.start(0, src.loopStart); else src.start();
      return { src, g, f };
    } catch (e) { return null; }
  },
  _playAny(keys, o) { const k = this._pick(keys); return k ? this._play(k, o) : null; },

  /* 常駐循環層：交火密度床兩層＋大艦引擎兩種，起始音量 0，由 update() 平滑調整 */
  _loops: {},
  _startLoops() {
    for (const k of ['fire_bed1', 'fire_bed2', 'rumble1', 'rumble2']) {
      if (this._loops[k] || !this._buf[k]) continue;
      const h = this._play(k, { loop: true, vol: 0, jitter: 0, lp: 12000 });
      if (h) this._loops[k] = h;
    }
  },
  _ramp(k, v, tau) {
    const h = this._loops[k];
    if (!h) return;
    try { h.g.gain.setTargetAtTime(v, this.ctx.currentTime, tau); } catch (e) {}
  },

  /* 交火密度：每次開火（節流／漏播前就算）加「距離權重」clamp(1−d/5000, 0.1, 1)，舊無位置呼叫算 1；
     update 每 0.25 秒收一格，4 格＝最近 1 秒 */
  _shotAcc: 0, _shotRaw: 0, _posAcc: 0, _shotWin: [0, 0, 0, 0], _rawWin: [0, 0, 0, 0], _posWin: [0, 0, 0, 0], _winT: 0, density: 0,
  _clock: 0, _scanT: 0, _flyT: -9, flybys: 0, rumbleGain: 0, bedGain: 0, bedLp: 12000,

  /* 主迴圈每幀呼叫（main.js）：交火床、戰機掠過、大艦重低音 */
  update(dt) {
    if (!this.ctx || !(dt > 0)) return;
    dt = Math.min(dt, 0.25);
    this._clock += dt;
    const playing = typeof Game !== 'undefined' && (Game.state === 'play' || Game.state === 'over');
    /* 交火密度床：最近 1 秒 >8 發就淡入，越密越大聲；>22 發再疊重砲層 */
    this._winT += dt;
    if (this._winT >= 0.25) {
      this._winT -= 0.25;
      this._shotWin.shift(); this._shotWin.push(this._shotAcc); this._shotAcc = 0;
      this._rawWin.shift(); this._rawWin.push(this._shotRaw); this._shotRaw = 0;
      this._posWin.shift(); this._posWin.push(this._posAcc); this._posAcc = 0;
      const n = this._shotWin[0] + this._shotWin[1] + this._shotWin[2] + this._shotWin[3];
      const raw = this._rawWin[0] + this._rawWin[1] + this._rawWin[2] + this._rawWin[3];
      this.density = n;
      /* 交火床越遠越悶：帶位置開火的平均距離權重 1（就在鏡頭前）→ 12 kHz，0.1（很遠）→ ~1.6 kHz；
         沒有帶位置的開火（舊呼叫）時用 0.5 當中間值 */
      const pos = this._posWin[0] + this._posWin[1] + this._posWin[2] + this._posWin[3];
      const w = raw > 0 ? Math.min(1, pos / raw) : 0.5;
      this.bedLp = 1500 + 10500 * w * w;
      for (const k of ['fire_bed1', 'fire_bed2']) {
        const h = this._loops[k];
        if (h && h.f) try { h.f.frequency.setTargetAtTime(this.bedLp, this.ctx.currentTime, 0.3); } catch (e) {}
      }
      const zf = this._camCut();  /* 交火床是遠方大戰的主體，俯瞰時只跟著整體降 35%，不像近景音降到 1/4 */
      const nearCut = 1 - 0.45 * w * w;  /* 鏡頭就在戰場裡：單發已一聲聲播，交火床退後最多 45% */
      const g1 = playing && n > 8 ? Math.min(1, (n - 8) / 30) * 0.3 * zf * nearCut : 0;
      const g2 = playing && n > 22 ? Math.min(1, (n - 22) / 40) * 0.26 * zf * nearCut : 0;
      this.bedGain = g1;
      this._ramp('fire_bed1', g1, g1 > 0 ? 0.35 : 0.8);
      this._ramp('fire_bed2', g2, g2 > 0 ? 0.45 : 0.9);
    }
    /* 掠過＋大艦引擎：每 0.1 秒掃一次 */
    this._scanT += dt;
    if (this._scanT < 0.1) return;
    this._scanT = 0;
    if (!playing || typeof World === 'undefined' || typeof Cam === 'undefined') {
      this.rumbleGain = 0; this._ramp('rumble1', 0, 0.3); this._ramp('rumble2', 0, 0.3); return;
    }
    const tx = Cam.target.x, tz = Cam.target.z, zf = this._zoomK();
    const fogOn = World.fog && typeof Fog !== 'undefined' && Fog.hiddenAt;
    let big = null, bigD = 700, fly = null, flyD = 350;
    for (const e of World.ents) {
      if (!e.alive || e.kind !== 'ship' || !e.def) continue;
      const dx = e.pos.x - tx, dz = e.pos.z - tz;
      if (dx > 700 || dx < -700 || dz > 700 || dz < -700) continue;
      const d = Math.hypot(dx, dz);
      if (fogOn && e.team !== 0 && Fog.hiddenAt(e.pos)) continue;
      if (e.radius >= 28 && e.thrusting > 0.1 && d < bigD) { big = e; bigD = d; }
      if (e.def.small && d < flyD && e.vel && Math.hypot(e.vel.x, e.vel.z) > 180) { fly = e; flyD = d; }
    }
    /* 大艦重低音：radius ≥ 40 換更沉的 rumble2 */
    const rg = big ? 0.35 * Math.pow(1 - bigD / 700, 1.3) * Math.min(1, 0.4 + big.thrusting) * zf : 0;
    this.rumbleGain = rg;
    const heavy = !!(big && big.radius >= 40 && this._loops.rumble2);
    this._ramp(heavy ? 'rumble2' : 'rumble1', rg, 0.3);
    this._ramp(heavy ? 'rumble1' : 'rumble2', 0, 0.3);
    /* 戰機掠過：1.2 秒內只播一次，左右聲道依相對鏡頭位置 */
    if (fly && this._clock - this._flyT >= 1.2) {
      this._flyT = this._clock;
      this.flybys++;
      this.flyby(this._panOf(fly.pos), (1 - flyD / 350 * 0.6) * zf);
    }
  },
  /* 鏡頭拉遠時近景音（掠過／引擎／交火床）變小：dist ≤1000 ≈ 1、俯瞰 4000 以上 0.25 */
  _zoomK() {
    const d = typeof Cam !== 'undefined' ? (Cam._s ? Cam._s.dist : Cam.dist) : 950;
    return Math.max(0.25, Math.min(1, 1.25 - d / 4000));
  },
  _panV: null,
  _panOf(p) {
    try {
      if (!this._panV) this._panV = new THREE.Vector3();
      this._panV.setFromMatrixColumn(Game.camera.matrixWorld, 0);  /* 鏡頭右方向 */
      const dx = p.x - Cam.target.x, dz = p.z - Cam.target.z;
      return Math.max(-0.85, Math.min(0.85, (dx * this._panV.x + dz * this._panV.z) / 500));
    } catch (e) { return 0; }
  },
  flyby(pan = 0, vol = 1) {
    if (!this.ctx || !this.on) return;
    if (!this._playAny(['whoosh1', 'whoosh2', 'whoosh3'], { vol: 0.42 * vol, pan, jitter: 0.08 }))
      this._noise(0.9, 0.06 * vol, 400, 2400, 'fb', 1200, 'bandpass', 1.2);
  },

  /* ---------- 戰鬥音 ----------
     兩層 API：
     ① 舊呼叫 SFX.shoot() 等「不帶位置」→ 維持舊行為（素材優先、固定節流、失敗走程序化）
     ② 帶位置 SFX.at(key, pos) 或 SFX.shoot(pos)／explodeSized(size, pos)／explS(pos)／explB(pos)
        → 依「位置到鏡頭目標點」距離 d 決定：音量 base×(1−d/R)^1.5、播放機率（近處 <near 必播，越遠越稀疏，
          再乘同類 100ms 內已播次數衰減 1/(1+n×0.5)）、低通（近處全頻，遠處 12k→1.5kHz）、左右聲道 ±0.8；
          d ≥ R 不播。被「漏播」的遠方開火仍以距離權重計入交火密度 → 由交火環境層補成一片悶悶的背景。 */
  AT: {
    shoot:     { keys: ['gun1', 'gun2', 'gun3'], vol: 0.3, R: 1400, fire: 1 },
    pd:        { keys: ['pd'], vol: 0.14, rate: 1.1, R: 1400, fire: 1 },
    plasma:    { keys: ['plasma'], vol: 0.42, R: 1400, fire: 1 },
    beam:      { keys: ['beam'], vol: 0.27, R: 1400, fire: 1 },
    missile:   { keys: ['missile'], vol: 0.28, R: 1400, fire: 1 },
    hitShield: { keys: ['hitShield'], vol: 0.08, R: 1200, jitter: 0.1 },
    hitHull:   { keys: ['hitHull'], vol: 0.16, R: 1200, jitter: 0.1 },
    exS:       { keys: ['exS1', 'exS2'], vol: 0.55, lp: 1800, R: 1800, near: 600 },
    exM:       { keys: ['exM1', 'exM2'], vol: 0.85, lp: 1300, R: 2600, near: 900, jitter: 0.08 },
    exL:       { keys: ['exL1', 'exL2'], vol: 1.15, lp: 900, R: 4000, near: 1500, rate: 0.95, jitter: 0.07 },
  },
  _recent: {},
  atStats: { played: 0, skipped: 0 },
  at(key, pos, o) {
    const s = this.AT[key];
    if (!s) return false;
    if (!pos) { this._legacy(key); return true; }
    const hasCam = typeof Cam !== 'undefined' && Cam.target;
    const d = hasCam ? Math.hypot(pos.x - Cam.target.x, pos.z - Cam.target.z) : 0;
    if (s.fire) { const w = Math.max(0.1, Math.min(1, 1 - d / 5000)); this._shotAcc += w; this._posAcc += w; this._shotRaw++; }
    if (!this.ctx || !this.on) return false;
    if (d >= s.R) { this.atStats.skipped++; return false; }
    const k = 1 - d / s.R;
    const now = performance.now(), arr = this._recent[key] || (this._recent[key] = []);
    while (arr.length && now - arr[0] > 100) arr.shift();
    let p = d < (s.near || 400) ? 1 : Math.max(0.08, k);
    p /= 1 + arr.length * 0.5;
    if (arr.length >= 10 || Math.random() > p) { this.atStats.skipped++; return false; }
    arr.push(now);
    this.atStats.played++;
    const vol = Math.pow(k, 1.5) * this._camCut() * ((o && o.vol) || 1);
    let lp = d <= (s.near || 400) * 0.5 ? 0 : 12000 * Math.pow(1500 / 12000, Math.min(1, d / s.R));
    if (s.lp) lp = lp ? Math.min(lp, s.lp) : s.lp;
    const pan = hasCam ? this._panOf(pos) * 0.94 : 0;
    if (!this._playAny(s.keys, { vol: s.vol * vol, lp, rate: s.rate, jitter: s.jitter, pan })) this._proc(key, vol);
    return true;
  },
  /* 鏡頭拉高俯瞰時，帶位置的戰鬥音整體再降：dist ≤1200 不降、≥6000 降 35% */
  _camCut() {
    const d = typeof Cam !== 'undefined' ? (Cam._s ? Cam._s.dist : Cam.dist) : 950;
    return 1 - 0.35 * Math.max(0, Math.min(1, (d - 1200) / 4800));
  },
  /* 舊呼叫（無位置）：素材優先、固定節流 */
  _LEG_THR: { shoot: ['sh', 45], pd: ['pd', 60], missile: ['mi', 140], plasma: ['pl', 100], beam: ['bm', 230],
    hitShield: ['hs', 100], hitHull: ['hh', 70], exS: ['es', 80], exM: ['em', 120], exL: ['eb', 170] },
  _legacy(key) {
    const s = this.AT[key];
    if (s.fire) this._shotAcc++;  /* 無位置：權重 1，但不參與遠近平均 */
    if (!this.ctx || !this.on) return;
    const t = this._LEG_THR[key];
    if (t && this._thr(t[0], t[1])) return;
    if (!this._playAny(s.keys, { vol: s.vol, lp: s.lp, rate: s.rate, jitter: s.jitter })) this._proc(key, 1);
  },
  /* 程序化 fallback（k＝音量倍率） */
  _proc(key, k) {
    switch (key) {
      case 'shoot': return this._osc('square', 720, 170, 0.08, 0.055 * k);
      case 'pd': return this._osc('square', 1300, 480, 0.045, 0.022 * k);
      case 'missile': return this._noise(0.5, 0.08 * k, 380, 1500, null, 0, 'bandpass', 1.4);
      case 'plasma': return this._osc('sine', 175, 48, 0.3, 0.16 * k);
      case 'beam': return this._osc('sawtooth', 130, 55, 0.5, 0.08 * k);
      case 'hitShield': return this._osc('triangle', 900, 300, 0.06, 0.03 * k);
      case 'hitHull': return this._noise(0.09, 0.06 * k, 480, 130, null, 0, 'bandpass', 1.1);
      case 'exS': return this._noise(0.38, 0.26 * k, 900, 110);
      case 'exM': this._noise(0.7, 0.34 * k, 750, 70); return this._osc('sine', 80, 30, 0.6, 0.2 * k);
      case 'exL':
        this._noise(0.95, 0.42 * k, 620, 55);
        this._osc('sine', 92, 27, 0.85, 0.25 * k);
        return this._osc('sine', 54, 24, 0.6, 0.42 * k);  /* 50Hz 沉底層：爆炸的胸口感 */
    }
  },
  _sized(size) { return size < 14 ? 'exS' : size < 30 ? 'exM' : 'exL'; },

  shoot(pos)     { this.at('shoot', pos); },
  pd(pos)        { this.at('pd', pos); },
  missile(pos)   { this.at('missile', pos); },
  plasma(pos)    { this.at('plasma', pos); },
  beam(pos)      { this.at('beam', pos); },
  hitShield(pos) { this.at('hitShield', pos); },
  hitHull(pos)   { this.at('hitHull', pos); },
  /* 太空爆炸（悶聲）：size <14 小、<30 中、其餘大（大的音量高＋低通 900Hz 更悶、2 秒低頻尾巴） */
  explodeSized(size = 10, pos) { this.at(this._sized(size), pos); },
  explS(pos) { this.explodeSized(10, pos); },  /* 舊名轉接：小 */
  explB(pos) { this.explodeSized(40, pos); },  /* 舊名轉接：大 */
  kill()   { this._osc('square', 660, 990, 0.07, 0.07, 'kl', 180); setTimeout(() => this._osc('square', 990, 1480, 0.09, 0.06, 'kl2', 0), 60); },
  /* 經營 */
  click()  { this._osc('sine', 740, 520, 0.06, 0.09, 'ui', 35); },
  place()  { this._osc('triangle', 240, 90, 0.22, 0.16, 'plc', 120); },
  done()   { this._osc('sine', 523, 523, 0.09, 0.12, 'dn', 150); setTimeout(() => this._osc('sine', 784, 784, 0.14, 0.12, 'dn2', 0), 100); },
  research(){ this._osc('sine', 392, 392, 0.09, 0.1, 'rs', 150); setTimeout(() => this._osc('sine', 523, 523, 0.09, 0.1, 'rs2', 0), 90); setTimeout(() => this._osc('sine', 659, 659, 0.16, 0.1, 'rs3', 0), 180); },
  mine()   { this._osc('triangle', 1400, 900, 0.05, 0.012, 'mn', 220); },
  unload() { this._osc('sine', 660, 880, 0.1, 0.06, 'ul', 300); },
  warp()   { this._osc('sawtooth', 90, 950, 0.42, 0.1, 'wp', 120); },
  alarm()  {
    this._osc('square', 520, 500, 0.14, 0.1, 'al', 2500);
    setTimeout(() => this._osc('square', 390, 380, 0.16, 0.1, 'al2', 0), 170);
    setTimeout(() => this._osc('square', 520, 500, 0.14, 0.1, 'al3', 0), 340);
  },
  win()    { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._osc('sine', f, f, 0.3, 0.14, 'w' + i, 0), i * 160)); },
  lose()   { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this._osc('sawtooth', f, f * 0.97, 0.4, 0.1, 'l' + i, 0), i * 200)); },

  _chordIdx: 0,
  _startMusic() {
    const chords = [
      [110.0, 130.81, 164.81], [87.31, 110.0, 130.81],
      [130.81, 164.81, 196.0], [98.0, 123.47, 146.83],
    ];
    const playChord = () => {
      if (!this.ctx || !this.on) return;
      try {
        const notes = chords[this._chordIdx % chords.length];
        this._chordIdx++;
        const t = this.ctx.currentTime;
        for (const f of notes) for (const det of [1, 1.004]) {
          const o = this.ctx.createOscillator(), g = this.ctx.createGain();
          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 420;
          o.type = 'sawtooth'; o.frequency.value = f * det;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.024, t + 3.2);
          g.gain.linearRampToValueAtTime(0.0001, t + 8.2);
          o.connect(lp); lp.connect(g); g.connect(this.musicGain);
          o.start(t); o.stop(t + 8.4);
        }
      } catch (e) {}
    };
    playChord();
    setInterval(playChord, 8000);
  },
};
window.addEventListener('pointerdown', () => { SFX.init(); SFX.resume(); });
window.addEventListener('keydown', () => { SFX.init(); SFX.resume(); });
