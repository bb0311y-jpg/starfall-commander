'use strict';
/* ═══════════ UI 介面層 ═══════════ */

const UI = {
  diffKey: 'normal',
  _panelT: 0, _hintFlags: {}, _alertT: 0,
  floats: [],

  /* 世界座標飄字（卸礦入帳等） */
  addFloat(pos, txt, color) {
    if (Fog.hiddenAt(pos)) return;   // 戰爭迷霧：看不到的地方不飄字
    if (this.floats.length > 20) this.floats.shift();
    this.floats.push({ p: pos.clone(), txt, t: 0, color: color || '#ffd166' });
  },

  init() {
    /* 建造列 */
    const bar = U.el('build-bar');
    for (const cls of BUILD_BAR) {
      const d = BLDS[cls];
      const b = document.createElement('button');
      b.className = 'bbtn';
      b.id = 'bb-' + cls;
      b.innerHTML = `<b>${d.name}</b><span>💎${d.cost}<i>${d.hotkey}</i></span>`;
      b.title = d.tip;
      b.onclick = () => Input.startPlace(cls);
      bar.appendChild(b);
    }
    /* 選取面板動作（事件代理） */
    U.el('sel-panel').addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const [op, arg] = act.dataset.act.split(':');
      const sel = [...World.selection];
      const bld = sel.find(x => x.kind === 'bld');
      if (op === 'ship' && bld) {
        const n = e.shiftKey ? 5 : 1;
        for (let i = 0; i < n; i++) if (!World.queueShip(bld, arg)) break;
      }
      else if (op === 'res' && bld) World.startResearch(bld, arg);
      else if (op === 'sell' && bld) {
        /* 變賣要點兩次：第一次變「再點一次確認」，3 秒內再點才真的拆（避免誤觸） */
        if (act.dataset.armed && performance.now() - +act.dataset.armed < 3000) { World.sellBld(bld); }
        else { act.dataset.armed = performance.now(); act.classList.add('armed'); act.querySelector('b').textContent = '再點一次確認拆除'; SFX.click(); }
      }
      else if (op === 'form') Input.setFormation(arg);
      else if (op === 'pick') {
        /* 多選面板點艦種 chip：只保留該型 */
        const keep = [...World.selection].filter(x => x.cls === arg);
        World.selection.clear();
        keep.forEach(x => World.selection.add(x));
        SFX.click();
      }
      else if (op === 'cq' && bld) {
        const i = +arg;
        if (bld.queue[i]) {
          World.credits += SHIPS[bld.queue[i].cls].cost;
          bld.queue.splice(i, 1);
          SFX.click();
        }
      }
    });
    /* 頂列按鈕 */
    U.el('hb-pause').onclick = () => Game.togglePause();
    U.el('hb-speed').onclick = () => Game.toggleSpeed();
    U.el('hb-sound').onclick = () => Game.toggleSound();
    U.el('hb-help').onclick = () => this.help(true);
    U.el('hb-menu').onclick = () => this.toggleMenu();
    /* 主選單 */
    for (const k of ['easy', 'normal', 'hard']) {
      U.el('diff-' + k).onclick = () => {
        this.diffKey = k;
        for (const k2 of ['easy', 'normal', 'hard']) U.el('diff-' + k2).classList.toggle('sel', k2 === k);
        SFX.click();
      };
    }
    /* 模式：雙方對決（預設）／三方混戰 */
    this.modeKey = 'duel';
    for (const m of ['duel', 'tri']) {
      U.el('mode-' + m).onclick = () => {
        this.modeKey = m;
        for (const m2 of ['duel', 'tri']) U.el('mode-' + m2).classList.toggle('sel', m2 === m);
        U.el('mode-note').textContent = m === 'tri'
          ? '三方混戰：赤紅兵團與翠環同盟彼此也是敵人——擊沉兩艘敵方母艦才算勝利。'
          : '雙方對決：擊沉赤紅兵團的母艦即獲勝。';
        SFX.click();
      };
    }
    this._initFogToggle();
    U.el('btn-start').onclick = () => { SFX.click(); Game.start(this.diffKey, this.modeKey); };
    U.el('btn-menu-help').onclick = () => { SFX.click(); this.help(true); };
    U.el('btn-help-close').onclick = () => this.help(false);
    /* 結束畫面 */
    U.el('btn-end-again').onclick = () => { SFX.click(); Game.start(this.diffKey, this.modeKey); };
    U.el('btn-end-menu').onclick = () => { SFX.click(); Game.toMenu(); };
    /* Esc 選單 */
    U.el('btn-p-resume').onclick = () => this.toggleMenu();
    U.el('btn-p-help').onclick = () => this.help(true);
    U.el('btn-p-sound').onclick = () => { Game.toggleSound(); U.el('btn-p-sound').textContent = '音效：' + (SFX.on ? '開' : '關'); };
    U.el('btn-p-restart').onclick = () => { this.toggleMenu(); Game.start(this.diffKey, Game.mode); };
    U.el('btn-p-quit').onclick = () => { this.toggleMenu(); Game.toMenu(); };
    /* 小地圖：左鍵跳視角、右鍵下令（Ctrl＝攻擊移動） */
    const mmPos = e => {
      const mm = U.el('minimap');
      const k = Math.min(mm.width / (MAP.W * 2), mm.height / (MAP.H * 2));
      const ox = (mm.width - (MAP.W * 2) * k) / 2, oy = (mm.height - (MAP.H * 2) * k) / 2;
      return { x: (e.offsetX - ox) / k - MAP.W, z: (e.offsetY - oy) / k - MAP.H };
    };
    U.el('minimap').addEventListener('mousedown', e => {
      const p = mmPos(e);
      if (e.button === 2) {
        const sel = [...World.selection].filter(x => x.team === 0 && x.kind === 'ship');
        if (sel.length && Input.cmdMode === 'patrol') {
          /* P 巡邏模式：小地圖右鍵也能設巡邏點 */
          Input.patrolAt(sel, p.x, p.z, e.shiftKey);
          if (!e.shiftKey) Input.cmdMode = null;
        } else if (sel.length) {
          World.issueOrder(sel, e.ctrlKey ? 'amove' : 'move', p);
          FX.ping({ x: p.x, z: p.z }, e.ctrlKey ? 0xffa14d : 0x41d9ff);
        }
        return;
      }
      Cam.target.x = U.clamp(p.x, -MAP.W, MAP.W);
      Cam.target.z = U.clamp(p.z, -MAP.H, MAP.H);
      Cam.follow = false;
    });
    U.el('minimap').addEventListener('contextmenu', e => e.preventDefault());
    /* 警報橫幅可點擊：跳至遇襲點 */
    U.el('alert').onclick = () => {
      const ap = World.jumpTarget();
      if (ap) { Cam.target.x = ap.x; Cam.target.z = ap.z; Cam.follow = false; SFX.click(); }
    };
    /* 閒置採礦船徽章：點擊全選並跳轉 */
    U.el('res-idle').onclick = () => {
      const idle = World.teams[0].filter(s => s.def.eco && (s.state === 'idle' || (s.manualT || 0) > 5));
      if (!idle.length) return;
      World.selection.clear();
      idle.forEach(s => World.selection.add(s));
      Cam.target.x = idle[0].pos.x; Cam.target.z = idle[0].pos.z; Cam.follow = false;
      SFX.click();
    };
    this.overlay = U.el('overlay');
    this.octx = this.overlay.getContext('2d');
  },

  /* 主選單「戰爭迷霧 開／關」（Game.fog，預設開） */
  _initFogToggle() {
    const sync = () => {
      U.el('fog-on').classList.toggle('sel', Game.fog);
      U.el('fog-off').classList.toggle('sel', !Game.fog);
    };
    U.el('fog-on').onclick = () => { Game.fog = true; sync(); SFX.click(); };
    U.el('fog-off').onclick = () => { Game.fog = false; sync(); SFX.click(); };
    sync();
  },

  /* ══ 訊息 ══ */
  toast(msg, type) {
    const box = U.el('toasts');
    const d = document.createElement('div');
    d.className = 'toast' + (type === 'gold' ? ' gold' : type === 'red' ? ' red' : '');
    d.textContent = msg;
    box.appendChild(d);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, 4000);
  },
  alertMsg(msg) {
    const a = U.el('alert');
    a.textContent = msg;
    a.classList.remove('hidden');
    a.style.animation = 'none';
    void a.offsetWidth;
    a.style.animation = '';
    clearTimeout(this._alt);
    this._alt = setTimeout(() => a.classList.add('hidden'), 4200);
  },
  hint(msg, secs) {
    const h = U.el('hint');
    h.innerHTML = msg;
    h.classList.remove('hidden');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => h.classList.add('hidden'), (secs || 11) * 1000);
  },

  help(open) { U.el('modal-help').classList.toggle('hidden', !open); },
  toggleMenu() {
    const m = U.el('modal-pause');
    const opening = m.classList.contains('hidden');
    m.classList.toggle('hidden', !opening);
    Game.paused = opening;
    U.el('btn-p-sound').textContent = '音效：' + (SFX.on ? '開' : '關');
  },
  closeModals() {
    U.el('modal-help').classList.add('hidden');
    if (!U.el('modal-pause').classList.contains('hidden')) this.toggleMenu();
  },

  showScreen(id) {
    for (const s of ['menu-screen', 'end-screen', 'hud']) {
      U.el(s).classList.toggle('hidden', s !== id);
    }
  },

  showEnd(won) {
    Game.state = 'over';
    Input.stopPlace();
    const t = U.el('end-title');
    t.textContent = won ? '勝　利' : '敗　北';
    t.className = won ? 'win' : 'lose';
    const tri = World.teamsN > 2;
    U.el('end-sub').textContent = won
      ? (tri ? '赤紅兵團與翠環同盟的母艦都已化為星塵——三方混戰，曙光聯隊笑到最後。'
        : '敵方母艦已化為星塵——這片星域屬於曙光聯隊了。')
      : (tri ? '曙光號沉沒了…兩面受敵不好打，重整旗鼓，再次出擊吧。'
        : '曙光號沉沒了…重整旗鼓，再次出擊吧。');
    const s = World.stats;
    U.el('end-stats').innerHTML = `
      <div class="rs"><b>${U.mmss(World.time)}</b><span>作戰時間</span></div>
      <div class="rs"><b>${s.kills}</b><span>擊毀敵軍</span></div>
      <div class="rs"><b>${s.losses}</b><span>我方損失</span></div>
      <div class="rs"><b>${U.fmt(s.mined)}</b><span>開採星礦</span></div>
      <div class="rs"><b>${s.built}</b><span>建造設施</span></div>`;
    this.showScreen('end-screen');
  },

  /* ══ 每幀更新 ══ */
  update(dt) {
    if (Game.state !== 'play') {
      if (this._ovDirty) {
        this._ovDirty = false;
        this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      }
      return;
    }
    this._ovDirty = true;
    /* 頂列 */
    U.el('res-credits').textContent = U.fmt(World.credits);
    U.el('res-income').textContent = '+' + (World.incomeShown > 0 ? World.incomeShown.toFixed(1) : '0') + '/s';
    U.el('res-supply').textContent = World.supply() + '/' + World.supplyCap() + '｜✈ ' + World.supplyFighters() + '/' + World.fighterCap();
    /* 採礦隊狀態計數：一眼看出幾艘在幹活 */
    let mining = 0, haul = 0, hidle = 0, tot = 0;
    for (const s of World.teams[0]) if (s.def.eco) {
      tot++;
      if (s.state === 'mining') mining++;
      else if (s.state === 'toBase') haul++;
      else if (s.state === 'idle') hidle++;
    }
    const hv = U.el('res-harv');
    const htxt = (mining + haul) + '/' + tot;
    if (hv.textContent !== htxt) hv.textContent = htxt;
    const hw = U.el('res-harv-wrap');
    hw.title = `採礦中 ${mining}｜運返 ${haul}｜趕路 ${tot - mining - haul - hidle}｜閒置 ${hidle}`;
    hw.classList.toggle('warn', hidle > 0 && tot > 0);
    U.el('res-time').textContent = U.mmss(World.time);
    /* 閒置/迷航採礦船警示徽章 */
    let idleN = 0;
    for (const s of World.teams[0]) if (s.def.eco && (s.state === 'idle' || (s.state === 'manual' && (s.manualT || 0) > 5))) idleN++;
    const ri = U.el('res-idle');
    ri.classList.toggle('hidden', !idleN);
    if (idleN) {
      const t = '⛏ ' + idleN + ' 艘採礦船閒置';
      if (ri.textContent !== t) ri.textContent = t;
    }
    /* 建造列狀態 */
    for (const cls of BUILD_BAR) {
      const b = U.el('bb-' + cls);
      b.classList.toggle('off', World.credits < BLDS[cls].cost);
      b.classList.toggle('active', Input.placing === cls);
    }
    /* 面板節流 */
    this._panelT -= dt;
    if (this._panelT <= 0) { this._panelT = 0.1; this._renderPanel(); }
    this._minimap();
    this._overlay(dt);
    this._hints();
  },

  /* ══ 選取面板 ══
     只有「結構」變動時才重建 DOM（否則點到一半的按鈕會被換掉）；
     數值與進度條用 data-b 綁定每幀就地更新。 */
  _panelSig(sel) {
    if (!sel.length) return 'none';
    if (sel.length > 1) return 'multi:' + sel.map(e => e.id).join(',');
    const e = sel[0];
    let s = 'one:' + e.id;
    if (e.kind === 'bld') {
      s += e.buildT > 0 ? ':c' : ':b';
      if (e.queue) s += ':q' + e.queue.map(q => q.cls).join('');
      if (e.def.lab) s += ':r' + (e.research ? e.research.id : '-') + ':' + World.researchDone.size;
      if (e.def.builds) s += ':u' + (World.researchDone.has('cap1') ? 1 : 0) + (World.researchDone.has('cap2') ? 1 : 0) + World.bldCount(0, 'lab');
    }
    return s;
  },

  _renderPanel() {
    const p = U.el('sel-panel');
    const sel = [...World.selection].filter(e => e.alive);
    const sig = this._panelSig(sel);
    if (sig === 'none') { p.classList.add('hidden'); this._sig = sig; return; }
    p.classList.remove('hidden');
    if (sig !== this._sig) {
      this._sig = sig;
      p.innerHTML = this._panelHTML(sel);
    }
    this._panelTick(sel);
  },

  _panelHTML(sel) {
    const e = sel[0];
    if (sel.length > 1) {
      const byCls = {};
      for (const s of sel) { if (!byCls[s.cls]) byCls[s.cls] = { n: 0, name: s.name }; byCls[s.cls].n++; }
      return `<h3>已選 ${sel.length} 個單位</h3><div class="comp">` +
        Object.entries(byCls).map(([c, o]) => `<span class="chip btn" data-act="pick:${c}" title="點擊只保留此艦種">${o.name} ×${o.n}</span>`).join('') +
        '</div><div class="comp form-row"><span class="form-lbl">陣型</span>' +
        Object.entries(FORM.names).map(([f, nm], i) => `<span class="chip btn" data-act="form:${f}" title="快捷鍵 F${i + 1}">${nm} <i>F${i + 1}</i></span>`).join('') +
        '</div><p class="tip">點艦種＝只保留該型｜X 停止｜H 駐守｜P 巡邏（再右鍵點地圖，Shift 加點）</p>';
    }
    if (e.kind === 'ast') {
      return `<h3>小行星</h3>
        <div class="statline">星礦蘊藏 <b data-b="ore"></b></div>
        <div class="pbar"><i data-b="orebar" style="background:#8ef5d8"></i></div>
        <p class="tip">右鍵派採礦船前來開採</p>`;
    }
    let html = `<h3>${e.name}</h3>
      <div class="statline">${e.team > 0 ? `<span class="foe"${World.teamsN > 2 || e.team >= World.teamsN ? ` style="color:${TEAMS[e.team].css}"` : ''}>${World.teamsN > 2 || e.team >= World.teamsN ? TEAMS[e.team].name : '敵方'}</span> ` : ''}船體 <b data-b="hull"></b></div>
      <div class="pbar"><i data-b="hullbar"></i></div>`;
    if (e.maxShield) {
      html += `<div class="statline">護盾 <b data-b="shield"></b></div>
        <div class="pbar"><i data-b="shieldbar" style="background:#59c8ff"></i></div>`;
    }
    if (e.def.tip) html += `<p class="tip">${e.def.tip}</p>`;
    if (e.kind === 'ship' && e.def.cargo) {
      html += `<div class="statline">礦艙 <b data-b="cargo"></b></div>
        <div class="pbar"><i data-b="cargobar" style="background:#ffc94d"></i></div>`;
    }
    if (e.kind === 'bld' && e.team === 0) {
      if (e.buildT > 0) {
        html += `<div class="statline">建造中…</div>
          <div class="pbar"><i data-b="consbar" style="background:#ffd166"></i></div>`;
      } else {
        if (e.def.builds) html += this._prodHTML(e);
        if (e.def.lab) html += this._labHTML(e);
      }
      if (e.cls !== 'base') {
        html += `<button class="pbtn sellbtn" data-act="sell" title="退還造價 ${Math.round(SELL.refund * 100)}% × 船體剩餘比例；佇列與研究中項目全額退款">
          <b>拆除變賣</b><span>+💎<i data-b="sellval"></i></span></button>`;
      }
    }
    return html;
  },

  _prodHTML(e) {
    let html = '<h4>生產</h4><div class="prod">';
    for (const cls of e.def.builds) {
      const d = SHIPS[cls];
      let lock = '';
      if (d.needLab && !World.bldCount(0, 'lab')) lock = '需要研究站';
      if (d.needCap && !World.researchDone.has('cap1')) lock = '需要「主力艦授權」';
      if (d.needCap2 && !World.researchDone.has('cap2')) lock = '需要「無畏艦授權」';
      if (d.max && World.countCls(0, cls) >= d.max) lock = '已達上限';
      if (d.limit && World.countCls(0, cls) >= d.limit) lock = '已達上限';
      html += `<button class="pbtn${lock ? ' lock' : ''}" data-act="ship:${cls}" data-cost="${d.cost}"
        title="${d.tip}${lock ? '｜' + lock : ''}">
        <b>${d.name.slice(0, 3)}</b><span>💎${d.cost}</span>${lock ? '<em>🔒</em>' : ''}</button>`;
    }
    html += '</div><p class="tip">Shift+點擊＝連下 5 艘</p>';
    if (e.queue.length) {
      html += '<h4>佇列（點擊取消退款）</h4><div class="queue">';
      e.queue.forEach((q, i) => {
        html += `<div class="qitem" data-act="cq:${i}">
          ${SHIPS[q.cls].name.slice(0, 3)}
          <div class="pbar mini"><i ${i === 0 ? 'data-b="q0bar"' : ''} style="background:#ffd166"></i></div></div>`;
      });
      html += '</div>';
    }
    return html;
  },

  _labHTML(e) {
    let html = '<h4>研究</h4><div class="reslist">';
    for (const u of UPGRADES) {
      const done = World.researchDone.has(u.id);
      const cur = e.research && e.research.id === u.id;
      const locked = u.prereq && !World.researchDone.has(u.prereq);
      if (done) { html += `<div class="ritem done">✔ ${u.name}</div>`; continue; }
      if (locked) { html += `<div class="ritem lock">🔒 ${u.name}</div>`; continue; }
      if (cur) {
        html += `<div class="ritem cur">${u.name}<div class="pbar mini"><i data-b="resbar" style="background:#c792ff"></i></div></div>`;
        continue;
      }
      html += `<div class="ritem btn${e.research ? ' busy' : ''}" data-act="res:${u.id}" data-cost="${u.cost}" title="${u.desc}">
        ${u.name} <span>💎${u.cost}</span></div>`;
    }
    return html + '</div>';
  },

  /* 每幀就地更新數值（不動 DOM 結構） */
  _panelTick(sel) {
    const p = U.el('sel-panel');
    const e = sel[0];
    const set = (key, txt) => {
      const el = p.querySelector(`[data-b="${key}"]`);
      if (el && el.textContent !== txt) el.textContent = txt;
    };
    const bar = (key, pct) => {
      const el = p.querySelector(`[data-b="${key}"]`);
      if (el) el.style.width = U.clamp(pct, 0, 100).toFixed(0) + '%';
    };
    if (sel.length > 1) {
      /* 目前陣型高亮（就地切 class，不重建 DOM） */
      for (const el of p.querySelectorAll('[data-act^="form:"]')) {
        const on = el.dataset.act === 'form:' + World.formation;
        if (el.classList.contains('on') !== on) el.classList.toggle('on', on);
      }
    }
    if (sel.length === 1) {
      if (e.kind === 'ast') {
        set('ore', `${U.fmt(e.ore)} / ${U.fmt(e.oreMax)}`);
        bar('orebar', e.ore / e.oreMax * 100);
      } else {
        set('hull', `${Math.ceil(e.hull)} / ${e.maxHull}`);
        if (e.kind === 'bld' && e.team === 0 && e.cls !== 'base') set('sellval', String(World.sellRefund(e)));
        bar('hullbar', e.hull / e.maxHull * 100);
        if (e.maxShield) {
          set('shield', `${Math.ceil(e.shield)} / ${e.maxShield}`);
          bar('shieldbar', e.shield / e.maxShield * 100);
        }
        if (e.def.cargo) {
          const cap = World.cargoCap(e);
          set('cargo', `${Math.floor(e.cargo)} / ${Math.round(cap)}`);
          bar('cargobar', e.cargo / cap * 100);
        }
        if (e.kind === 'bld') {
          if (e.buildT > 0) bar('consbar', (1 - e.buildT / e.buildTotal) * 100);
          if (e.queue && e.queue.length) bar('q0bar', (1 - e.queue[0].t / e.queue[0].total) * 100);
          if (e.research) bar('resbar', (1 - e.research.t / e.research.total) * 100);
        }
      }
    }
    /* 買不起的按鈕變暗（不重建 DOM） */
    for (const b of p.querySelectorAll('[data-cost]')) {
      b.classList.toggle('off', World.credits < +b.dataset.cost || b.classList.contains('busy'));
    }
  },

  /* ══ 小地圖 ══ */
  _minimap() {
    const mm = U.el('minimap');
    const g = mm.getContext('2d');
    g.clearRect(0, 0, mm.width, mm.height);
    const k = Math.min(mm.width / (MAP.W * 2), mm.height / (MAP.H * 2));
    const ox = (mm.width - (MAP.W * 2) * k) / 2, oy = (mm.height - (MAP.H * 2) * k) / 2;
    const px = x => ox + (x + MAP.W) * k, py = z => oy + (z + MAP.H) * k;
    for (const a of World.asts) {
      g.fillStyle = a.wreck ? '#ffd166' : (a.ore > 0 ? '#5f7a72' : '#3a4148');
      g.fillRect(px(a.pos.x) - 1.5, py(a.pos.z) - 1.5, 3, 3);
    }
    Fog.drawMinimap(g, ox, oy, k);   // 戰爭迷霧：遮罩＋記憶中的敵方建築
    /* 富礦隕石：感測器標記，畫在迷霧之上。還有礦就一直是金色大點；標記期內外加脈動 ☄ 圈 */
    for (const a of World.asts) {
      if (!a.comet || !a.alive || a.ore <= 0) continue;
      const x = px(a.pos.x), y = py(a.pos.z);
      g.fillStyle = '#ffc24d';
      g.fillRect(x - 2.5, y - 2.5, 5, 5);
      const cm = World.cometMark;
      if (cm && cm.ast === a && World.time < cm.until) {
        const ph = performance.now() / 220;
        g.strokeStyle = 'rgba(255,200,80,' + (0.5 + 0.5 * Math.sin(ph)).toFixed(2) + ')';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 7 + 2.5 * Math.sin(ph), 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#ffe9b0'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center';
        g.fillText('☄', x, y - 9);
      }
    }
    for (const e of World.ents) {
      if (!e.alive || e.kind === 'ast' || Fog.hiddenEnt(e)) continue;
      const isBase = e.cls === 'base';
      const sz = isBase ? 7 : e.kind === 'bld' ? 4 : e.radius >= 24 ? 3.5 : 2.2;
      /* 各勢力用自己的陣營色（TEAMS[].css）；我方被選取的畫白 */
      g.fillStyle = e.team === 0 && World.selection.has(e) ? '#ffffff' : (TEAMS[e.team] || TEAMS[1]).css;
      if (e.pirate) {
        /* 星盜：大一號的菱形＋黑邊，和紅方方點分得開 */
        const x = px(e.pos.x), y = py(e.pos.z), r = 3.2;
        g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
        g.fill(); g.strokeStyle = '#1a0d05'; g.lineWidth = 1; g.stroke();
        continue;
      }
      g.fillRect(px(e.pos.x) - sz / 2, py(e.pos.z) - sz / 2, sz, sz);
      if (isBase) {
        g.strokeStyle = g.fillStyle;
        g.strokeRect(px(e.pos.x) - 5.5, py(e.pos.z) - 5.5, 11, 11);
      }
    }
    /* 視野框 */
    const pts = [];
    for (const [sx, sy] of [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]]) {
      const p = Input.groundPoint(sx, sy);
      if (p) pts.push([px(U.clamp(p.x, -MAP.W, MAP.W)), py(U.clamp(p.z, -MAP.H, MAP.H))]);
    }
    if (pts.length === 4) {
      g.strokeStyle = 'rgba(210,235,255,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
      g.closePath();
      g.stroke();
    }
    /* 敵襲紅圈閃爍 */
    const ap = World.alarmPos;
    if (ap && World.time < ap.until) {
      const ph = performance.now() / 160;
      g.strokeStyle = 'rgba(255,90,60,' + (0.55 + 0.45 * Math.sin(ph)).toFixed(2) + ')';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px(ap.x), py(ap.z), 7 + 2 * Math.sin(ph), 0, Math.PI * 2);
      g.stroke();
    }
  },

  /* ══ 螢幕浮層（血條 / 框選 / 提示字） ══ */
  _overlay(dt) {
    const cv = this.overlay, g = this.octx;
    if (cv.width !== innerWidth || cv.height !== innerHeight) {
      cv.width = innerWidth; cv.height = innerHeight;
    }
    g.clearRect(0, 0, cv.width, cv.height);
    const v = new THREE.Vector3();
    const camPos = Game.camera.position;
    /* 富礦隕石浮標：還有礦就顯示 ☄＋剩餘礦量，標記期內字更亮 */
    for (const a of World.asts) {
      if (!a.comet || !a.alive || a.ore <= 0) continue;
      v.copy(a.pos).project(Game.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
      const cm = World.cometMark, hot = cm && cm.ast === a && World.time < cm.until;
      const bob = Math.sin(performance.now() / 300) * 3;
      g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
      g.fillStyle = 'rgba(5,10,18,0.7)';
      const label = '☄ 富礦隕石 ' + U.fmt(a.ore);
      const tw = g.measureText(label).width;
      g.fillRect(sx - tw / 2 - 6, sy - 46 + bob, tw + 12, 20);
      g.fillStyle = hot ? '#ffe9b0' : '#ffc24d';
      g.fillText(label, sx, sy - 31 + bob);
      g.strokeStyle = hot ? 'rgba(255,220,120,0.9)' : 'rgba(255,194,77,0.5)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(sx, sy - 26 + bob); g.lineTo(sx, sy - 12); g.stroke();
    }
    for (const e of World.ents) {
      if (!e.alive || e.kind === 'ast' || Fog.hiddenEnt(e)) continue;
      const damaged = e.hull < e.maxHull - 1 || (e.maxShield && e.shield < e.maxShield - 1);
      const show = damaged || World.selection.has(e) || Input.hover === e || e.buildT > 0 || (e.queue && e.queue.length);
      if (!show) continue;
      v.copy(e.pos).project(Game.camera);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * innerWidth;
      const sy = (1 - v.y) / 2 * innerHeight;
      const dist = camPos.distanceTo(e.pos);
      const w = U.clamp(e.radius * 1100 / dist, 22, 110);
      const yOff = U.clamp(e.radius * 900 / dist, 16, 90);
      const x = sx - w / 2, y = sy - yOff - 8;
      g.fillStyle = 'rgba(5,10,18,0.72)';
      g.fillRect(x - 1, y - 1, w + 2, 7);
      if (e.maxShield > 0) {
        g.fillStyle = '#59c8ff';
        g.fillRect(x, y, w * U.clamp(e.shield / e.maxShield, 0, 1), 2.4);
      }
      g.fillStyle = e.team === 0 ? '#7ef29a' : '#ff8a66';
      g.fillRect(x, y + 3, w * U.clamp(e.hull / e.maxHull, 0, 1), 2.4);
      /* 施工 / 生產進度 */
      let prog = -1, col = '#ffd166';
      if (e.buildT > 0) prog = 1 - e.buildT / e.buildTotal;
      else if (e.queue && e.queue.length) prog = 1 - e.queue[0].t / e.queue[0].total;
      else if (e.research) { prog = 1 - e.research.t / e.research.total; col = '#c792ff'; }
      if (prog >= 0) {
        g.fillStyle = 'rgba(5,10,18,0.72)';
        g.fillRect(x - 1, y + 7, w + 2, 4);
        g.fillStyle = col;
        g.fillRect(x, y + 8, w * prog, 2);
      }
      /* 佇列深度徽章：不點面板也看得到還排幾艘 */
      if (e.queue && e.queue.length > 1) {
        g.font = '10px "Microsoft JhengHei", sans-serif';
        g.fillStyle = '#ffd166';
        g.fillText('×' + e.queue.length, x + w + 5, y + 12);
      }
      /* 選取單位名牌（幫助辨識艦種） */
      if (World.selection.has(e) && World.selection.size <= 10) {
        g.font = '11px "Microsoft JhengHei", sans-serif';
        g.textAlign = 'center';
        g.fillStyle = e.def.eco ? '#ffd97a' : '#a8dcf2';
        g.fillText('★'.repeat(e.vet || 0) + e.name, sx, y - 5);
        g.textAlign = 'left';
      }
    }
    /* 入帳飄字 */
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt || 0.016;
      if (f.t > 1.5) { this.floats.splice(i, 1); continue; }
      v.copy(f.p).project(Game.camera);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * innerWidth;
      const sy = (1 - v.y) / 2 * innerHeight - 26 - f.t * 34;
      g.font = 'bold 13px "Microsoft JhengHei", sans-serif';
      g.textAlign = 'center';
      g.globalAlpha = U.clamp(1.3 - f.t, 0, 1);
      g.fillStyle = f.color;
      g.fillText(f.txt, sx, sy);
      g.globalAlpha = 1;
      g.textAlign = 'left';
    }
    /* 指令持續回饋：目的地旗標／攻擊鎖定四角框／採礦標記／集結點 */
    if (Game.state === 'play' && World.selection.size && World.selection.size <= 24) {
      const seen = new Set(), now = performance.now();
      const flag = (dx, dy, col) => {
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(dx, dy); g.lineTo(dx, dy - 16); g.stroke();
        g.beginPath(); g.moveTo(dx, dy - 16); g.lineTo(dx + 10, dy - 12); g.lineTo(dx, dy - 8); g.closePath(); g.fill();
        g.beginPath(); g.arc(dx, dy, 3, 0, U.TAU); g.stroke();
      };
      for (const s of World.selection) {
        if (!s.alive) continue;
        if (s.kind === 'bld' && s.rally) {
          const rp = s.rally.ast ? s.rally.ast.pos : s.rally;
          v.set(rp.x, 0, rp.z).project(Game.camera);
          if (v.z <= 1) flag((v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, 'rgba(255,209,102,.9)');
          continue;
        }
        if (s.kind !== 'ship' || s.team !== 0) continue;
        const o = s.order;
        if (o && (o.t === 'move' || o.t === 'amove')) {
          v.set(o.x, 0, o.z).project(Game.camera);
          if (v.z > 1) continue;
          const dx = (v.x + 1) / 2 * innerWidth, dy = (1 - v.y) / 2 * innerHeight;
          const key = Math.round(dx / 48) + ':' + Math.round(dy / 48) + o.t;
          if (seen.has(key)) continue;
          seen.add(key);
          flag(dx, dy, o.t === 'amove' ? 'rgba(255,161,77,.95)' : 'rgba(65,217,255,.95)');
        } else {
          const tgt = (o && o.t === 'attack' && o.ent && o.ent.alive) ? o.ent
            : (s.def.eco && s.mineTarget && (s.state === 'toField' || s.state === 'mining')) ? s.mineTarget : null;
          if (!tgt) continue;
          const key = 'T' + tgt.id;
          if (seen.has(key)) continue;
          seen.add(key);
          v.copy(tgt.pos).project(Game.camera);
          if (v.z > 1) continue;
          const tx = (v.x + 1) / 2 * innerWidth, ty = (1 - v.y) / 2 * innerHeight;
          const r = U.clamp(tgt.radius * 1300 / camPos.distanceTo(tgt.pos), 14, 70) * (1 + 0.08 * Math.sin(now / 130));
          g.strokeStyle = s.def.eco ? 'rgba(142,245,216,.9)' : 'rgba(255,90,60,.95)';
          g.lineWidth = 1.8;
          const c = r * 0.45;
          for (const [mx, mz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            g.beginPath();
            g.moveTo(tx + mx * r, ty + mz * (r - c));
            g.lineTo(tx + mx * r, ty + mz * r);
            g.lineTo(tx + mx * (r - c), ty + mz * r);
            g.stroke();
          }
        }
      }
    }
    /* 巡邏路線：選取中的巡邏艦畫整群共用路線（虛線＋菱形航點；同一群只畫一次，不受 24 艘上限） */
    if (Game.state === 'play' && World.selection.size) {
      const drawn = new Set();
      const proj = (x, z) => { v.set(x, 0, z).project(Game.camera); return v.z > 1 ? null : [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
      for (const s of World.selection) {
        const o = s.order;
        if (!s.alive || s.kind !== 'ship' || s.team !== 0 || !o || o.t !== 'patrol' || drawn.has(o.base)) continue;
        drawn.add(o.base);
        const sp = o.base.map(b => proj(b.x, b.z));
        g.strokeStyle = 'rgba(126,242,154,.8)'; g.lineWidth = 1.6;
        g.setLineDash([7, 6]); g.lineDashOffset = -performance.now() / 60;
        g.beginPath();
        let pen = false;
        for (const q of sp) {
          if (!q) { pen = false; continue; }
          pen ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
          pen = true;
        }
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(126,242,154,.95)';
        sp.forEach((q, i) => {
          if (!q) return;
          const r = i === 0 ? 3.5 : 5.5;
          g.beginPath(); g.moveTo(q[0], q[1] - r); g.lineTo(q[0] + r, q[1]); g.lineTo(q[0], q[1] + r); g.lineTo(q[0] - r, q[1]); g.closePath();
          i === 0 ? g.stroke() : g.fill();
        });
      }
    }
    /* 巡邏模式游標提示 */
    if (Input.cmdMode === 'patrol' && Game.state === 'play') {
      g.font = '13px "Microsoft JhengHei", sans-serif';
      g.fillStyle = '#7ef29a';
      g.textAlign = 'center';
      g.fillText('巡邏：右鍵點地圖 · Shift＋右鍵連加多點 · Esc 取消', Input.mouse.x, Input.mouse.y + 42);
      g.textAlign = 'left';
    }
    /* 框選矩形 */
    if (Input.dragRect) {
      const r = Input.dragRect;
      g.strokeStyle = 'rgba(120,230,255,0.9)';
      g.fillStyle = 'rgba(120,230,255,0.08)';
      g.lineWidth = 1.2;
      const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2);
      g.fillRect(x, y, Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1));
      g.strokeRect(x, y, Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1));
    }
    /* hover 提示 */
    const h = Input.hover;
    if (h && !Input.dragRect && !Input.placing) {
      let txt = '★'.repeat(h.vet || 0) + h.name;
      if (h.kind === 'ast') txt += `｜星礦 ${U.fmt(h.ore)}`;
      else if (h.team > 0) txt += World.teamsN > 2 || h.team >= World.teamsN ? `（${TEAMS[h.team].name}）` : '（敵方）';
      g.font = '12px "Microsoft JhengHei", sans-serif';
      const tw = g.measureText(txt).width;
      const mx = Input.mouse.x + 16, my = Input.mouse.y + 22;
      g.fillStyle = 'rgba(6,12,22,0.85)';
      g.fillRect(mx - 5, my - 13, tw + 10, 19);
      g.strokeStyle = 'rgba(65,217,255,0.35)';
      g.strokeRect(mx - 5, my - 13, tw + 10, 19);
      g.fillStyle = '#cfe8f7';
      g.fillText(txt, mx, my);
    }
    /* 放置提示 */
    if (Input.placing) {
      g.font = '13px "Microsoft JhengHei", sans-serif';
      g.fillStyle = Input.placeOK ? '#8ef5d8' : '#ff8a66';
      g.textAlign = 'center';
      g.fillText(Input.placeOK ? '左鍵放置 · 右鍵取消' : '此處無法建造（需靠近我方建築且不重疊）',
        Input.mouse.x, Input.mouse.y + 42);
      g.textAlign = 'left';
    }
    /* 暫停標示 */
    if (Game.paused && U.el('modal-pause').classList.contains('hidden')) {
      g.font = '15px "Microsoft JhengHei", sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(159,232,255,' + (0.5 + 0.4 * Math.sin(performance.now() / 300)) + ')';
      g.fillText('⏸ 戰術暫停中 — 仍可下達指令（空白鍵繼續）', innerWidth / 2, 86);
      g.textAlign = 'left';
    }
  },

  /* ══ 教學提示 ══ */
  _hints() {
    const F = this._hintFlags, W = World;
    if (!F.h1 && W.time > 1) {
      F.h1 = true;
      this.hint('⛏ 採礦船已自動開工。<b>滾輪</b>縮放｜<b>中鍵拖曳</b>平移｜<b>Q / E</b> 旋轉視角｜<b>V</b> 切換視角預設', 12);
    }
    if (!F.h2 && W.time > 14 && !W.bldCount(0, 'yard') && W.credits >= 650) {
      F.h2 = true;
      this.hint('🔧 星礦充足了——用下方建造列蓋一座<b>軌道船塢 (Y)</b>，開始生產戰艦！', 12);
    }
    if (!F.h3 && W.bldCount(0, 'yard') && W.blds[0].some(b => b.cls === 'yard' && b.buildT <= 0)) {
      F.h3 = true;
      this.hint('⚔ 船塢完工——<b>點選船塢</b>，在右側面板生產攔截機與護衛艦。<b>Ctrl+1</b> 可編隊', 12);
    }
    if (!F.h4 && W.bldCount(0, 'lab') && W.blds[0].some(b => b.cls === 'lab' && b.buildT <= 0)) {
      F.h4 = true;
      this.hint('🔬 研究站就緒——點選它研發<b>武器 / 裝甲升級</b>，並解鎖<b>主力艦</b>', 12);
    }
    if (!F.h5 && W.time > 60 && !W.bldCount(0, 'ref')) {
      F.h5 = true;
      this.hint('💡 在礦區旁蓋<b>精煉站 (R)</b>能大幅縮短採礦船的往返時間', 11);
    }
    if (!F.h6 && W.time > 150) {
      F.h6 = true;
      this.hint('🔧 受損艦開回<b>母艦/精煉站</b>旁會自動付費維修｜擊毀敵艦掉<b>殘料</b>可回收｜打敵方採礦船會讓它<b>真的變窮</b>', 13);
    }
    /* 礦脈枯竭警報：把隱形賽末計時告訴玩家 */
    if (W.oreTotal) {
      if (!F.ore25 && W.oreLeft() < W.oreTotal * 0.25) {
        F.ore25 = true;
        this.alertMsg('⚠ 星域礦脈剩不到 1/4——搶佔剩餘礦區，準備決戰！');
        SFX.alarm();
      }
      if (!F.ore10 && W.oreLeft() < W.oreTotal * 0.10) {
        F.ore10 = true;
        this.alertMsg('⛏ 礦脈即將枯竭——省著花，是時候發動總攻了');
      }
    }
  },
};
