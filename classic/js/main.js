'use strict';
/* ═══════════ 主程式：流程、存檔、輸入、主迴圈 ═══════════ */

const SAVE_KEY = 'starfall_v1';

const App = {
  save: null,
  state: 'title',          // title | fleet | battle | result
  battle: null, attract: null,
  view: { w: 0, h: 0 }, dpr: 1,
  speed: 1, paused: false,
  keys: new Set(),
  canvas: null, ctx: null,
  lastMode: null, lastMissionId: null,
  firstBattleHint: true,
  _lastSquad: { n: 0, t: 0 },

  /* ── 存檔 ── */
  defaultSave() {
    return {
      v: 1, credits: 600, unlocked: 1,
      fleet: [{ c: 'int', r: 0 }, { c: 'int', r: 0 }, { c: 'int', r: 0 }, { c: 'cor', r: 0 }],
      best: 0, sfxOn: true,
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === 1 && Array.isArray(s.fleet)) {
          s.fleet = s.fleet.filter(f => SHIPS[f.c] && !SHIPS[f.c].noBuy);
          return s;
        }
      }
    } catch (e) {}
    return this.defaultSave();
  },
  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) {}
  },

  /* ── 啟動 ── */
  boot() {
    this.canvas = U.el('game');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    Sprites.build();
    this.save = this.load();
    SFX.on = this.save.sfxOn !== false;
    this.wire();
    this.showTitle();
    this._loopB = t => this._loop(t);
    requestAnimationFrame(this._loopB);
  },

  resize() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.floor(innerWidth * dpr);
    this.canvas.height = Math.floor(innerHeight * dpr);
    this.canvas.style.width = innerWidth + 'px';
    this.canvas.style.height = innerHeight + 'px';
    this.view = { w: innerWidth, h: innerHeight };
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  /* ── 主迴圈 ── */
  _lt: 0,
  _loop(t) {
    const dt = Math.min(0.05, (t - this._lt) / 1000 || 0.016);
    this._lt = t;
    const B = (this.state === 'battle' || this.state === 'result') ? this.battle : this.attract;
    if (B) {
      let sdt = dt;
      if (B === this.battle) {
        sdt = this.paused ? 0 : dt * this.speed;
        if (B.state !== 'fight') sdt = dt * 0.3;   // 終局慢動作
        if (this.state === 'battle' && !this.paused) B.panKeys(dt, this.keys);
      }
      B.update(sdt);
      B.render(this.ctx, this.view);
      if (B === this.battle && this.state === 'battle') UI.updateHUD(B);
    }
    requestAnimationFrame(this._loopB);
  },

  /* ── 畫面流程 ── */
  showTitle() {
    this.state = 'title';
    UI.show('scr-title');
    UI.updateTitleProfile();
    if (!this.attract || this.attract.ended) this.attract = this.makeAttract();
  },
  makeAttract() {
    return new Battle({
      mode: 'attract',
      onEnd: () => {
        setTimeout(() => {
          if (this.state !== 'battle' && this.state !== 'result') this.attract = this.makeAttract();
        }, 1500);
      },
    });
  },

  /* ── 開戰 ── */
  startMission(id) {
    const m = MISSIONS.find(x => x.id === id);
    if (!m) return;
    const fleet = this.save.fleet.map(f => ({ ...f }));
    const pv = fleet.reduce((s, f) => s + SHIPS[f.c].cost, 0) + (m.station ? 700 : 0);
    const scale = U.clamp(pv / m.expected, 0.72, 1.35);
    const list = genFleetList(Math.round(m.budget * scale), m.weights);
    const waves = splitWaves(list, m.waves || 1);
    if (m.boss) {
      if (waves.length < 2) waves.push([]);
      waves[waves.length - 1].push('boss');
    }
    this.lastMode = 'mission'; this.lastMissionId = id;
    this._begin({
      mode: 'mission', missionIdx: id,
      playerFleet: fleet, enemyWaves: waves,
      formation: UI.formation, mod: m.mod, station: m.station,
      label: `第 ${id} 關 ${m.name}`,
      onEnd: res => this.onBattleEnd(res),
    });
  },

  startSkirmish() {
    this.lastMode = 'skirmish';
    const list = genFleetList(UI.skEn, { int: 4, cor: 3, des: 2, cru: 2, car: 1, bat: 1 });
    this._begin({
      mode: 'skirmish',
      playerFleet: UI.skTemp.map(f => ({ ...f })),
      enemyWaves: [list],
      formation: UI.formation,
      label: '遭遇戰',
      onEnd: res => this.onBattleEnd(res),
    });
  },

  startEndless() {
    this.lastMode = 'endless';
    this._begin({
      mode: 'endless',
      playerFleet: this.save.fleet.map(f => ({ ...f })),
      enemyWaves: [],
      formation: UI.formation,
      label: '無盡遠征',
      onEnd: res => this.onBattleEnd(res),
    });
  },

  _begin(cfg) {
    this.battle = new Battle(cfg);
    this.state = 'battle';
    this.paused = false; this.speed = 1;
    this._syncBtns();
    UI.battleUI(true);
    UI.buildHUD(this.battle);
    UI.pauseMenu(false); UI.help(false);
    if (this.firstBattleHint) {
      this.firstBattleHint = false;
      UI.showHint('🎯 <b>快速上手</b>：左鍵框選艦艇 → 右鍵點敵艦＝集火、點空處＝移動<br>空白鍵＝戰術暫停 · Q / W / E＝指揮官技能 · 滾輪縮放 · 艦艇不下令也會自動接戰', 16);
    }
  },

  /* ── 戰後結算 ── */
  onBattleEnd(res) {
    if (res.mode === 'attract') return;
    let earnText = '', promoText = '', subtitle = '', showNext = false;

    if (res.mode === 'mission') {
      const m = MISSIONS.find(x => x.id === res.missionIdx);
      const promoted = [];
      for (const s of res.survivors) {
        if (s.battleKills >= 2 && s.rank < 3) { s.rank++; promoted.push(`${s.def.name} ★${s.rank}`); }
      }
      this.save.fleet = res.survivors.map(s => ({ c: s.cls, r: s.rank }));
      if (res.won) {
        const replay = m.id < this.save.unlocked;
        let reward = m.reward + Math.round(res.stats.killedValue * 0.1);
        if (replay) reward = Math.round(reward * 0.35);
        this.save.credits += reward;
        subtitle = `${m.name} — 任務完成`;
        earnText = `獲得 ☉ ${U.fmt(reward)} 星幣` + (replay ? '（已克復區域，補給有限）' : '');
        if (!replay) {
          this.save.unlocked = Math.max(this.save.unlocked, m.id + 1);
          for (const d of Object.values(SHIPS)) {
            if (!d.noBuy && d.unlock === this.save.unlocked) UI.toast(`新艦種解鎖 — ${d.name}`, 'gold');
          }
          if (m.id === 8) {
            subtitle = '最終決戰告捷 — 星域光復';
            UI.toast('戰役完成！「無盡遠征」模式已解鎖', 'gold');
          }
        }
        showNext = m.id < 8;
      } else if (res.retreated) {
        subtitle = `${m.name} — 戰術撤退`;
        earnText = '已撤退，存活艦艇全數保留';
      } else {
        const sal = Math.round(res.stats.lostValue * 0.25);
        if (sal > 0) { this.save.credits += sal; earnText = `殘骸回收 +☉ ${U.fmt(sal)}`; }
        subtitle = `${m.name} — 艦隊全滅`;
      }
      if (promoted.length) {
        promoText = '艦艇晉升：' + promoted.map(p => `<span class="pr">${p}</span>`).join('　');
      }
      this.persist();
    } else if (res.mode === 'endless') {
      const w = res.endlessWave;
      const reward = Math.round(160 * w * (1 + w * 0.12));
      if (reward > 0) this.save.credits += reward;
      this.save.best = Math.max(this.save.best, w);
      subtitle = '無盡遠征 — 模擬演習結束';
      earnText = `撐過 ${w} 波 — 獲得 ☉ ${U.fmt(reward)} 星幣（演習模式，艦隊無損）`;
      this.persist();
    } else {
      subtitle = res.won ? '遭遇戰 — 完勝' : '遭遇戰 — 敗退';
    }

    this.state = 'result';
    UI.showResult({ ...res, earnText, promoText, subtitle, showNext });
    UI.updateTitleProfile();
  },

  retreat() {
    if (!this.battle || this.battle.state !== 'fight') return;
    this.battle.retreated = true;
    const orig = this.battle._result.bind(this.battle);
    this.battle._result = () => ({ ...orig(), retreated: true });
    this.battle._finish(false);
    this.paused = false;
    UI.pauseMenu(false);
    this._syncBtns();
  },

  /* ── 控制列同步 ── */
  _syncBtns() {
    U.el('hb-pause').classList.toggle('on', this.paused);
    U.el('pause-tint').classList.toggle('hidden', !this.paused || this.state !== 'battle');
    U.el('hb-speed').textContent = this.speed === 2 ? '2×' : this.speed === 0.5 ? '½×' : '1×';
    U.el('hb-sound').classList.toggle('off', !SFX.on);
  },
  togglePause() {
    if (this.state !== 'battle') return;
    this.paused = !this.paused;
    this._syncBtns();
  },
  cycleSpeed() {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1;
    this._syncBtns();
    SFX.click();
  },
  toggleSound() {
    SFX.setOn(!SFX.on);
    this.save.sfxOn = SFX.on;
    this.persist();
    this._syncBtns();
  },

  /* ── 事件綁定 ── */
  wire() {
    const cv = this.canvas;

    /* 主選單 */
    U.el('btn-campaign').onclick = () => { SFX.click(); this.state = 'fleet'; UI.openFleet('mission'); };
    U.el('btn-skirmish').onclick = () => { SFX.click(); this.state = 'fleet'; UI.openFleet('skirmish'); };
    U.el('btn-help').onclick = () => { SFX.click(); UI.help(true); };
    U.el('btn-reset').onclick = () => {
      if (confirm('確定要清除所有進度（星幣、艦隊、關卡）？')) {
        this.save = this.defaultSave();
        this.persist();
        UI.updateTitleProfile();
        UI.toast('進度已重置');
      }
    };

    /* 艦隊整備 */
    U.el('btn-fleet-back').onclick = () => { SFX.click(); this.showTitle(); };
    U.el('btn-launch').onclick = () => UI.launch();
    U.el('sk-my').oninput = e => { UI.skMy = +e.target.value; UI.renderFleet(); };
    U.el('sk-en').oninput = e => { UI.skEn = +e.target.value; UI.renderFleet(); };
    for (const b of document.querySelectorAll('[data-preset]')) {
      b.onclick = () => {
        const w = b.dataset.preset === 'swarm' ? { int: 8, cor: 2 }
          : b.dataset.preset === 'heavy' ? { des: 2, cru: 3, car: 1, bat: 2 }
          : { int: 4, cor: 3, des: 2, cru: 2, car: 1, bat: 1 };
        UI.skTemp = genFleetList(UI.skMy, w).map(c => ({ c, r: 0 }));
        UI.renderFleet();
        SFX.click();
      };
    }

    /* 結算 */
    U.el('btn-res-next').onclick = () => { SFX.click(); this.state = 'fleet'; UI.openFleet('mission'); };
    U.el('btn-res-retry').onclick = () => {
      SFX.click();
      if (this.lastMode === 'mission') {
        if (!this.save.fleet.length) { this.state = 'fleet'; UI.openFleet('mission'); UI.toast('艦隊已全滅，請先重建艦隊', 'red'); }
        else this.startMission(this.lastMissionId);
      } else if (this.lastMode === 'endless') {
        if (!this.save.fleet.length) { this.state = 'fleet'; UI.openFleet('mission'); }
        else this.startEndless();
      } else this.startSkirmish();
    };
    U.el('btn-res-fleet').onclick = () => {
      SFX.click(); this.state = 'fleet';
      UI.openFleet(this.lastMode === 'skirmish' ? 'skirmish' : 'mission');
    };
    U.el('btn-res-title').onclick = () => { SFX.click(); this.showTitle(); };

    /* HUD */
    U.el('hb-pause').onclick = () => this.togglePause();
    U.el('hb-speed').onclick = () => this.cycleSpeed();
    U.el('hb-sound').onclick = () => this.toggleSound();
    U.el('hb-menu').onclick = () => { this.paused = true; this._syncBtns(); UI.pauseMenu(true); };

    /* 彈窗 */
    U.el('btn-help-close').onclick = () => { SFX.click(); UI.help(false); };
    U.el('btn-p-resume').onclick = () => { SFX.click(); this.paused = false; this._syncBtns(); UI.pauseMenu(false); };
    U.el('btn-p-help').onclick = () => { SFX.click(); UI.help(true); };
    U.el('btn-p-sound').onclick = () => { this.toggleSound(); UI.pauseMenu(true); };
    U.el('btn-p-quit').onclick = () => { SFX.click(); this.retreat(); };

    /* 小地圖 */
    U.el('minimap').addEventListener('mousedown', e => {
      if (this.state === 'battle' && this.battle) {
        this.battle.minimapClick(e.offsetX, e.offsetY, U.el('minimap'));
      }
    });

    /* 戰場滑鼠 */
    cv.addEventListener('mousedown', e => {
      if (this.state !== 'battle' || !this.battle) return;
      if (e.button === 1) e.preventDefault();
      this.battle.pointerDown(e.button, e.clientX, e.clientY, this.view, e.shiftKey);
    });
    window.addEventListener('mousemove', e => {
      if (this.battle) this.battle.pointerMove(e.clientX, e.clientY, this.view);
    });
    window.addEventListener('mouseup', e => {
      if (this.state !== 'battle' || !this.battle) return;
      this.battle.pointerUp(e.button, e.clientX, e.clientY, this.view, e.shiftKey);
    });
    cv.addEventListener('dblclick', e => {
      if (this.state === 'battle' && this.battle) this.battle.dblClick(e.clientX, e.clientY, this.view);
    });
    cv.addEventListener('wheel', e => {
      if (this.state === 'battle' && this.battle) {
        e.preventDefault();
        this.battle.zoom(e.deltaY, e.clientX, e.clientY, this.view);
      }
    }, { passive: false });
    cv.addEventListener('contextmenu', e => e.preventDefault());

    /* 鍵盤 */
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k);
        if (this.state === 'battle') e.preventDefault();
        return;
      }
      if (this.state !== 'battle' || !this.battle) {
        if (k === 'escape') UI.help(false);
        return;
      }
      const B = this.battle;
      if (k === ' ') { this.togglePause(); e.preventDefault(); }
      else if (k === 'f') { B.cam.follow = !B.cam.follow; UI.toast(B.cam.follow ? '鏡頭跟隨：開' : '鏡頭跟隨：關'); }
      else if (k >= '1' && k <= '4') {
        const n = +k, now = performance.now();
        const dbl = this._lastSquad.n === n && now - this._lastSquad.t < 450;
        B.selectSquad(n, dbl);
        this._lastSquad = { n, t: now };
      }
      else if (k === 'q') B.useAbility(0);
      else if (k === 'w') B.useAbility(1);
      else if (k === 'e') B.useAbility(2);
      else if (k === 'escape') {
        if (B.aiming) B.aiming = null;
        else if (!U.el('modal-help').classList.contains('hidden')) UI.help(false);
        else if (U.el('modal-pause').classList.contains('hidden')) {
          this.paused = true; this._syncBtns(); UI.pauseMenu(true);
        } else {
          this.paused = false; this._syncBtns(); UI.pauseMenu(false);
        }
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
  },
};

App.boot();
