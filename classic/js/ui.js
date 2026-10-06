'use strict';
/* ═══════════ UI 介面層 ═══════════ */

const UI = {
  screens: ['scr-title', 'scr-fleet', 'scr-result'],
  fleetMode: 'mission',
  selMission: 1,
  formation: 'wedge',
  skTemp: [], skMy: 2000, skEn: 2000,

  show(id) {
    for (const s of this.screens) U.el(s).classList.toggle('hidden', s !== id);
    U.el('hud').classList.toggle('hidden', id !== null);
  },
  battleUI(on) {
    for (const s of this.screens) U.el(s).classList.add('hidden');
    U.el('hud').classList.toggle('hidden', !on);
  },

  toast(msg, type) {
    const box = U.el('toasts');
    const d = document.createElement('div');
    d.className = 'toast' + (type === 'gold' ? ' gold' : type === 'red' ? ' red' : '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, 4200);
  },

  waveBanner(txt) {
    const b = U.el('wave-banner');
    b.textContent = txt;
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.add('hidden'), 3500);
  },

  showHint(html, secs) {
    const h = U.el('hint-bar');
    h.innerHTML = html;
    h.classList.remove('hidden');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => h.classList.add('hidden'), (secs || 12) * 1000);
  },
  hideHint() { U.el('hint-bar').classList.add('hidden'); clearTimeout(this._ht); },

  /* ══════ 艦隊整備 ══════ */
  openFleet(mode) {
    this.fleetMode = mode;
    U.el('fleet-title').textContent = mode === 'mission' ? '戰役 — 艦隊整備' : '遭遇戰 — 艦隊配置';
    U.el('mission-panel').classList.toggle('hidden', mode !== 'mission');
    U.el('skirmish-panel').classList.toggle('hidden', mode !== 'skirmish');
    if (mode === 'mission') {
      const s = App.save;
      this.selMission = Math.min(s.unlocked, 8);
      if (s.unlocked > 8) this.selMission = 9;
      /* 緊急撥款：艦隊全滅又買不起船時 */
      if (!s.fleet.length && s.credits < 80) {
        s.credits = Math.max(s.credits, 500);
        App.persist();
        this.toast('司令部緊急撥款 — 星幣補充至 500', 'gold');
      }
    } else if (!this.skTemp.length) {
      this.skTemp = genFleetList(this.skMy, { int: 4, cor: 3, des: 2, cru: 1 }).map(c => ({ c, r: 0 }));
    }
    this.renderFleet();
    this.show('scr-fleet');
  },

  _fleet() { return this.fleetMode === 'mission' ? App.save.fleet : this.skTemp; },
  _credits() {
    if (this.fleetMode === 'mission') return App.save.credits;
    return this.skMy - this.skTemp.reduce((s, f) => s + SHIPS[f.c].cost, 0);
  },
  _unlocked(cls) {
    if (this.fleetMode === 'skirmish') return true;
    return (SHIPS[cls].unlock || 1) <= App.save.unlocked;
  },

  renderFleet() {
    const fleet = this._fleet(), credits = this._credits();
    U.el('fleet-credits').textContent = U.fmt(credits);

    /* 艦船目錄 */
    const cat = U.el('catalog');
    cat.innerHTML = '';
    for (const cls of ['int', 'cor', 'des', 'cru', 'car', 'bat']) {
      const def = SHIPS[cls];
      const count = fleet.filter(f => f.c === cls).length;
      const unlocked = this._unlocked(cls);
      const card = document.createElement('div');
      card.className = 'card' + (unlocked ? '' : ' locked');
      const canBuy = unlocked && credits >= def.cost && fleet.length < 24
        && (!def.max || count < def.max);
      card.innerHTML = `
        <canvas class="card-icon" width="64" height="64"></canvas>
        <div class="card-mid">
          <div class="card-name">${def.name}<span class="card-cost">☉ ${def.cost}</span></div>
          <div class="card-role">${unlocked ? def.role : ''}</div>
          ${unlocked ? `
          <div class="bars">
            <div class="bar b-pow"><i style="width:${def.pow * 10}%"></i></div>
            <div class="bar"><i style="width:${def.tough * 10}%"></i></div>
            <div class="bar b-spd"><i style="width:${def.spd * 10}%"></i></div>
          </div>` : `<div class="lock-tag">🔒 於第 ${def.unlock} 關解鎖</div>`}
        </div>
        <div class="card-ctrl">
          <button class="mini" data-a="+" ${canBuy ? '' : 'disabled'}>＋</button>
          <b class="cnt">${count}</b>
          <button class="mini" data-a="-" ${count > 0 ? '' : 'disabled'}>−</button>
        </div>`;
      Sprites.icon(cls, 0, card.querySelector('.card-icon'));
      card.querySelector('[data-a="+"]').onclick = () => this.buy(cls);
      card.querySelector('[data-a="-"]').onclick = () => this.sell(cls);
      cat.appendChild(card);
    }

    /* 任務清單 */
    if (this.fleetMode === 'mission') {
      const ml = U.el('mission-list');
      ml.innerHTML = '';
      for (const m of MISSIONS) {
        const locked = m.id > App.save.unlocked;
        const done = m.id < App.save.unlocked;
        const row = document.createElement('div');
        row.className = 'mission-row' + (locked ? ' locked' : '') + (done ? ' done' : '')
          + (this.selMission === m.id ? ' sel' : '');
        row.innerHTML = `<span class="m-no">${String(m.id).padStart(2, '0')}</span>
          <span class="m-name">${m.name}</span>
          <span class="m-st">${locked ? '🔒' : done ? '✔ 已克復' : '☉ ' + m.reward}</span>`;
        if (!locked) row.onclick = () => { this.selMission = m.id; this.renderFleet(); SFX.click(); };
        ml.appendChild(row);
      }
      if (App.save.unlocked > 8) {
        const row = document.createElement('div');
        row.className = 'mission-row' + (this.selMission === 9 ? ' sel' : '');
        row.innerHTML = `<span class="m-no">∞</span><span class="m-name">無盡遠征</span>
          <span class="m-st">最佳 ${App.save.best} 波</span>`;
        row.onclick = () => { this.selMission = 9; this.renderFleet(); SFX.click(); };
        ml.appendChild(row);
      }
      const brief = this.selMission === 9
        ? '無盡的敵軍波次，一波比一波兇猛。每清一波都有星幣獎勵，看看你的艦隊能撐到第幾波。'
        : (MISSIONS.find(m => m.id === this.selMission) || {}).brief || '';
      U.el('mission-brief').textContent = brief;
    } else {
      U.el('sk-my-v').textContent = this.skMy;
      U.el('sk-en-v').textContent = this.skEn;
    }

    /* 陣型 */
    const fl = U.el('formation-list');
    fl.innerHTML = '';
    for (const f of FORMATIONS) {
      const b = document.createElement('button');
      b.className = 'form-btn' + (this.formation === f.id ? ' sel' : '');
      b.innerHTML = `<b>${f.name}</b><span>${f.desc}</span>`;
      b.onclick = () => { this.formation = f.id; this.renderFleet(); SFX.click(); };
      fl.appendChild(b);
    }

    /* 出擊序列摘要 */
    const sum = U.el('fleet-summary');
    sum.innerHTML = '';
    const byCls = {};
    for (const f of fleet) {
      byCls[f.c] = byCls[f.c] || { n: 0, stars: 0 };
      byCls[f.c].n++;
      byCls[f.c].stars += f.r || 0;
    }
    for (const [c, v] of Object.entries(byCls)) {
      const chip = document.createElement('span');
      chip.className = 'fs-chip';
      chip.innerHTML = `${SHIPS[c].name.slice(0, 3)} ×${v.n}` + (v.stars ? ` <span class="st">★${v.stars}</span>` : '');
      sum.appendChild(chip);
    }
    if (!fleet.length) sum.innerHTML = '<span class="dim">尚未配置任何艦艇</span>';
    U.el('fleet-count').textContent = `（${fleet.length} / 24 艘）`;
    U.el('fleet-value').textContent = U.fmt(fleet.reduce((s, f) => s + SHIPS[f.c].cost, 0));
    U.el('fleet-hint').textContent = '';
  },

  buy(cls) {
    const fleet = this._fleet(), def = SHIPS[cls];
    if (this._credits() < def.cost || fleet.length >= 24) return;
    fleet.push({ c: cls, r: 0 });
    if (this.fleetMode === 'mission') { App.save.credits -= def.cost; App.persist(); }
    SFX.click();
    this.renderFleet();
  },
  sell(cls) {
    const fleet = this._fleet();
    let idx = -1, lowR = 99;
    fleet.forEach((f, i) => { if (f.c === cls && (f.r || 0) < lowR) { lowR = f.r || 0; idx = i; } });
    if (idx < 0) return;
    fleet.splice(idx, 1);
    if (this.fleetMode === 'mission') { App.save.credits += SHIPS[cls].cost; App.persist(); }
    SFX.click();
    this.renderFleet();
  },

  launch() {
    const fleet = this._fleet();
    if (!fleet.length) {
      U.el('fleet-hint').textContent = '⚠ 請先配置至少一艘艦艇';
      return;
    }
    SFX.ability();
    if (this.fleetMode === 'mission') {
      if (this.selMission === 9) App.startEndless();
      else App.startMission(this.selMission);
    } else {
      App.startSkirmish();
    }
  },

  /* ══════ 戰鬥 HUD ══════ */
  buildHUD(B) {
    const ab = U.el('abilities');
    ab.innerHTML = '';
    B.abl.forEach((a, i) => {
      const d = document.createElement('div');
      d.className = 'abl';
      d.innerHTML = `<div class="ic">${a.d.icon}</div><span class="ky">${a.d.key}</span>
        <span class="nm">${a.d.name}</span><div class="cd"></div><div class="cdt"></div>`;
      d.title = `${a.d.name}（${a.d.key}）：${a.d.desc}`;
      d.onclick = () => B.useAbility(i);
      ab.appendChild(d);
    });
    const sq = U.el('squads');
    sq.innerHTML = '';
    const names = { 1: '快攻中隊', 2: '飛彈支隊', 3: '主力戰隊', 4: '重艦編組' };
    for (let n = 1; n <= 4; n++) {
      const d = document.createElement('div');
      d.className = 'squad';
      d.dataset.n = n;
      d.innerHTML = `<span class="sq-key">${n}</span> ${names[n]} <span class="sq-n"></span>`;
      d.onclick = () => B.selectSquad(n, false);
      d.ondblclick = () => B.selectSquad(n, true);
      sq.appendChild(d);
    }
  },

  updateHUD(B) {
    /* 目標欄 */
    let obj = B.cfg.label || '殲滅所有敵艦';
    if (B.mode === 'endless') {
      obj = `無盡遠征 — 第 ${Math.max(1, B.endlessWave)} 波｜擊破 ${B.stats.kills}`;
    } else {
      const rem = B._teams[1].length + B.pendingCount();
      obj += `｜敵艦剩餘 ${rem}`;
      if (B.stationShip) {
        const pct = Math.max(0, Math.round((B.stationShip.hull / B.stationShip.maxHull) * 100));
        obj += `｜🛡 防衛站 ${pct}%`;
      }
    }
    const objEl = U.el('obj-text');
    if (objEl.textContent !== obj) objEl.textContent = obj;

    /* 分隊 */
    for (const el of U.el('squads').children) {
      const n = +el.dataset.n;
      const list = B.squads[n];
      el.querySelector('.sq-n').textContent = list.length;
      el.classList.toggle('dead', !list.length);
      const allSel = list.length > 0 && list.every(s => B.selection.has(s));
      el.classList.toggle('sel', allSel);
    }

    /* 技能 */
    const abEls = U.el('abilities').children;
    B.abl.forEach((a, i) => {
      const el = abEls[i];
      if (!el) return;
      const pct = U.clamp(a.cd / a.d.cd, 0, 1);
      el.querySelector('.cd').style.height = (pct * 100) + '%';
      el.querySelector('.cdt').textContent = a.cd > 0.2 ? Math.ceil(a.cd) : '';
      el.classList.toggle('ready', a.cd <= 0);
      el.classList.toggle('aiming', B.aiming === 'strike' && a.d.id === 'strike');
    });

    /* 選取資訊 */
    const si = U.el('sel-info');
    const txt = B.selection.size ? `已選 ${B.selection.size} 艘 — 右鍵下令` : '';
    if (si.textContent !== txt) si.textContent = txt;

    B.renderMinimap(U.el('minimap'));
  },

  /* ══════ 結算 ══════ */
  showResult(r) {
    const t = U.el('res-title');
    t.textContent = r.won ? '勝　利' : '敗　北';
    t.className = r.won ? 'win' : 'lose';
    U.el('res-sub').textContent = r.subtitle || '';
    const st = r.stats;
    const mins = Math.floor(st.time / 60), secs = Math.floor(st.time % 60);
    U.el('res-stats').innerHTML = `
      <div class="rs"><b>${st.kills}</b><span>擊毀敵艦</span></div>
      <div class="rs"><b>${st.losses}</b><span>我方損失</span></div>
      <div class="rs"><b>${U.fmt(st.dmgDealt)}</b><span>造成傷害</span></div>
      <div class="rs"><b>${U.fmt(st.dmgTaken)}</b><span>承受傷害</span></div>
      <div class="rs"><b>${mins}:${String(secs).padStart(2, '0')}</b><span>作戰時間</span></div>
      ${r.mode === 'endless' ? `<div class="rs"><b>${r.endlessWave}</b><span>撐過波次</span></div>` : ''}`;
    U.el('res-earn').textContent = r.earnText || '';
    U.el('res-promo').innerHTML = r.promoText || '';
    U.el('btn-res-next').classList.toggle('hidden', !r.showNext);
    U.el('btn-res-retry').classList.toggle('hidden', r.mode === 'attract');
    U.el('btn-res-fleet').classList.toggle('hidden', false);
    this.show('scr-result');
  },

  /* ══════ 彈窗 ══════ */
  help(open) { U.el('modal-help').classList.toggle('hidden', !open); },
  pauseMenu(open) {
    U.el('modal-pause').classList.toggle('hidden', !open);
    U.el('btn-p-sound').textContent = '音效：' + (SFX.on ? '開' : '關');
  },

  updateTitleProfile() {
    const s = App.save;
    const prog = s.unlocked > 8 ? '戰役完成 ✔' : `戰役進度 ${s.unlocked - 1} / 8`;
    U.el('title-profile').textContent =
      `指揮官檔案 — ☉ ${U.fmt(s.credits)} 星幣 · 麾下艦艇 ${s.fleet.length} 艘 · ${prog}`
      + (s.best > 0 ? ` · 無盡最佳 ${s.best} 波` : '');
  },
};
