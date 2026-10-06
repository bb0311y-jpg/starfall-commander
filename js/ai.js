'use strict';
/* ═══════════ 敵方 AI 指揮官 ═══════════ */

/* AI 是「工廠＋實例清單」：每個敵方勢力（team 1、三方模式再加 team 2）各建一個實例，
   狀態（錢、想造的艦、攻勢計時、home…）都是實例自己的。World 只呼叫 initAll／updateAll。 */
const AI = {
  all: [],
  initAll(W) {
    this.all = [];
    for (let t = 1; t < W.teamsN; t++) this.all.push(this.create(W, t));
  },
  updateAll(W, dt) {
    for (const ai of this.all) if (!ai.dead) ai.update(W, dt);
  },
  of(team) { return this.all.find(a => a.team === team) || null; },
  create(W, team) {
    const ai = Object.create(AI._proto);
    ai.init(W, team);
    return ai;
  },
};

AI._proto = {
  team: 1, credits: 0, buildQ: null, raidT: 0, raidN: 0, warned: false,
  yard: null, growthMul: 1, allIn: false, dead: false,

  init(W, team) {
    this.team = team;
    this.credits = 400;
    this.spare = 0;
    this.buildQ = null;
    this.want = null;
    this.raidT = W.diff.firstRaid;
    this.raidN = 0;
    this.warned = false;
    this.allIn = false;
    this.dead = false;
    this.nextTgt = null;
    this._harvCd = 0;
    this.built = 0;
    this.home = { x: W.homes[team].x, z: W.homes[team].z };
    this.base = W.bases[team];
    /* 自家座標系：f＝朝地圖中央的方向；team 1 時 f=(-1,0)，換算結果與舊版逐點相同 */
    const yaw = W.teamYaw(team);
    this.yaw = yaw;
    this.fx = Math.cos(yaw); this.fz = Math.sin(yaw);
    if (Math.abs(this.fx) < 1e-9) this.fx = 0;
    if (Math.abs(this.fz) < 1e-9) this.fz = 0;
    /* 敵方基地群（舊佈局以 x=2500 為母艦設計：fwd＝2500−x 往中央、side＝z） */
    const T = team, P = (x, z) => this.L(2500 - x, z);
    let q;
    q = P(2280, -260); this.yard = W.mkBld('yard', T, q.x, q.z, true);
    q = P(2620, 300); W.mkBld('lab', T, q.x, q.z, true);
    q = P(2100, 520); W.mkBld('ref', T, q.x, q.z, true);
    q = P(2050, -60); W.mkBld('tur', T, q.x, q.z, true);
    q = P(2200, 620); W.mkBld('tur', T, q.x, q.z, true);
    q = P(2320, -640); W.mkBld('tur', T, q.x, q.z, true);
    /* 敵方採礦船（增添生氣） */
    for (let i = 0; i < 3; i++) {
      q = P(2350, -100 + i * 120);
      const h = W.mkShip('harv', T, q.x, q.z);
      h.state = 'toField';
    }
    /* 起始守軍 */
    q = P(2150, 150); W.mkShip('int', T, q.x, q.z);
    q = P(2150, -150); W.mkShip('int', T, q.x, q.z);
    q = P(2260, 0); W.mkShip('cor', T, q.x, q.z);
  },

  /* 自家座標 → 世界座標：fwd 往地圖中央、side 往側邊（team 1：x＝home.x−fwd、z＝side） */
  L(fwd, side) {
    return { x: this.home.x + this.fx * fwd + this.fz * side, z: this.home.z + this.fz * fwd - this.fx * side };
  },
  /* 守備集結點（舊版：home.x−350±200、z ±500） */
  _guardPos() { return this.L(350 + U.rand(-200, 200), U.rand(-500, 500)); },

  _fleet(W) {
    return W.teams[this.team].filter(s => !s.def.eco && s.cls !== 'drone');
  },

  /* 攻擊對象：最近的敵對勢力（母艦還在的）。三方模式距離乘 ±25% 隨機，距離相近時不會永遠打同一家 */
  _pickTarget(W) {
    let best = null, bs = Infinity;
    for (let t = 0; t < W.teamsN; t++) {
      if (t === this.team || !W.bases[t] || !W.bases[t].alive) continue;
      let d = U.distXZ(this.home, W.bases[t].pos);
      if (W.teamsN > 2) d *= U.rand(0.75, 1.25);
      if (d < bs) { bs = d; best = t; }
    }
    return best === null ? 0 : best;
  },
  _tgtBasePos(W, t) {
    const b = W.bases[t];
    return b && b.alive ? b.pos : W.homes[t];
  },

  /* 攻勢目標：預設直搗母艦；ecoRaid 機率改襲擾目標勢力最前線建築或採礦船質心 */
  _raidTarget(W, base, tgtTeam) {
    if (this.raidN % 2 === 1 || Math.random() >= (W.diff.ecoRaid || 0)) return { pos: base, eco: false };
    let best = null, bs = Infinity;
    for (const b of W.blds[tgtTeam]) {
      if (b.cls === 'base' || !b.alive) continue;
      const d2 = U.dist2XZ(b.pos, this.home);
      if (d2 < bs) { bs = d2; best = b; }
    }
    if (best) return { pos: best.pos, eco: true };
    let hx = 0, hz = 0, nH = 0;
    for (const s of W.teams[tgtTeam]) if (s.def.eco) { hx += s.pos.x; hz += s.pos.z; nH++; }
    if (nH) return { pos: { x: hx / nH, z: hz / nH }, eco: true };
    return { pos: base, eco: false };
  },

  _startBuild(cls) {
    this.credits -= SHIPS[cls].cost;
    this.buildQ = { cls, t: SHIPS[cls].bt * 0.85 };
  },

  update(W, dt) {
    const D = W.diff, me = this.team, tri = W.teamsN > 2;
    /* 收入掛鉤自家採礦船與精煉站：被騷擾＝真的變窮（3船+精煉站健在=100%） */
    const eff = (AI_ECO.floor + AI_ECO.perHarv * Math.min(3, W.harvCount(me))) *
      (W.blds[me].some(b => b.cls === 'ref' && b.alive) ? 1 : AI_ECO.noRef);
    const inc = D.inc * eff * dt;
    this.credits += inc;
    this.spare = Math.min(AI_SPARE.cap, this.spare + inc * AI_SPARE.frac);
    this.growthMul = 1 + D.growth * (W.time / 60);

    /* ── 補採礦船：優先於造戰艦、每 20 秒最多 1 艘（獵殺敵礦船=實質減收） ── */
    if (W.harvCount(me) < 3 && this.credits >= SHIPS.harv.cost && W.time > this._harvCd) {
      this._harvCd = W.time + AI_ECO.harvCd;
      this.credits -= SHIPS.harv.cost;
      const hp = this.L(150, U.rand(-150, 150));
      const h = W.mkShip('harv', me, hp.x, hp.z);
      h.state = 'toField';
    }

    /* ── 造艦 ── */
    const yardOk = this.yard && this.yard.alive;
    if (this.buildQ) {
      this.buildQ.t -= dt;
      if (this.buildQ.t <= 0) {
        const cls = this.buildQ.cls;
        this.buildQ = null;
        if (yardOk) {
          const yr = this.yard.radius + 40, off = U.rand(-50, 50);
          const s = W.mkShip(cls, me, this.yard.pos.x + this.fx * yr + this.fz * off,
            this.yard.pos.z + this.fz * yr - this.fx * off, this.growthMul);
          s.yaw = this.yaw;
          this.built++;
          /* 守備位置 */
          const gp = this._guardPos();
          s.order = { t: 'amove', x: gp.x, z: gp.z };
        }
      }
    } else if (yardOk && this.want) {
      /* 先決定「想造什麼」再存錢等買得起（舊版只從買得起的挑 → 錢一進來就買最便宜的攔截機，永遠存不到大船） */
      const sc = AI_SPARE.cls;
      if (this.credits >= SHIPS[this.want].cost) {
        const cls = this.want;
        this.want = null;
        this._startBuild(cls);
      } else if (this.want !== sc && this.spare >= SHIPS[sc].cost && this.credits >= SHIPS[sc].cost) {
        /* 存大船的空檔：「零頭帳」夠就先補一艘便宜的（零頭帳只佔收入一部分，大船照樣存得到） */
        this.spare -= SHIPS[sc].cost;
        this._startBuild(sc);
      }
    }
    if (!this.buildQ && !this.want && yardOk) {
      /* 挑下一艘想造的：加權隨機 + 上限／時間門檻控管（不看當下錢夠不夠） */
      const aff = Object.entries(AI_WEIGHTS).filter(([c]) => {
        if (c === 'bat' && W.countCls(me, 'bat') >= 1) return false;
        if (c === 'car' && W.countCls(me, 'car') >= 2) return false;
        if (c === 'dread' && (W.countCls(me, 'dread') >= 1 || W.time < 900)) return false;   // 無畏艦：15 分鐘後、最多 1 艘
        if (c === 'arty' && (W.countCls(me, 'arty') >= 4 || W.time < 480)) return false;
        if ((c === 'car' || c === 'bat') && W.time < 420) return false;
        if (c === 'cru' && W.time < 240) return false;
        return true;
      });
      if (aff.length) {
        const tot = aff.reduce((s, [, w]) => s + w, 0);
        let r = Math.random() * tot, cls = aff[aff.length - 1][0];
        for (const [c, w] of aff) { r -= w; if (r <= 0) { cls = c; break; } }
        this.want = cls;   // 下一輪錢夠了才真的下單
      }
    }

    /* ── 進攻警告（只有目標是玩家才廣播） ── */
    if (!this.warned && this.raidT < 24) {
      this.warned = true;
      this.nextTgt = this._pickTarget(W);
      if (this.nextTgt === 0) {
        UI.alertMsg(tri ? `📡 長程感測：${TEAMS[me].name}艦隊正在集結…` : '📡 長程感測：敵方艦隊正在集結…');
        if (!W._hintedDef) {
          W._hintedDef = true;
          UI.hint('🛡 敵軍即將來襲——快蓋 2~3 座<b>哨衛砲塔 (T)</b> 護住母艦，戰艦 <b>Ctrl+1</b> 編隊、按 <b>1</b> 快速召回！', 14);
        }
      }
    }

    /* ── 發動攻勢（目標多樣化：直搗母艦 / 襲擾經濟；hard 雙叉鉗形） ── */
    this.raidT -= dt;
    if (this.raidT <= 0) {
      this.raidN++;
      this.raidT = D.raidGap;
      this.warned = false;
      let tgtTeam = this.nextTgt;
      if (tgtTeam === null || !W.bases[tgtTeam] || !W.bases[tgtTeam].alive) tgtTeam = this._pickTarget(W);
      this.nextTgt = null;
      this.lastTgt = tgtTeam;
      const fleet = this._fleet(W).filter(s => !s._raiding);
      const share = Math.min(1, 0.4 + this.raidN * 0.12);
      const n = Math.max(2, Math.round(fleet.length * share));
      const base = this._tgtBasePos(W, tgtTeam);
      const tgtInfo = this._raidTarget(W, base, tgtTeam);
      const prong = D.prong || 1;
      fleet.slice(0, n).forEach((s, i) => {
        s._raiding = true;
        const t2 = (prong === 2 && i % 2 === 1) ? base : tgtInfo.pos;
        s.order = { t: 'amove', x: t2.x + U.rand(-260, 260), z: t2.z + U.rand(-260, 260) };
      });
      if (n >= 2 && tgtTeam === 0) {
        SFX.alarm();
        if (tri) UI.alertMsg(tgtInfo.eco ? `🚨 ${TEAMS[me].name}艦隊撲向我方採礦線！` : `🚨 ${TEAMS[me].name}艦隊來襲！注意防禦！`);
        else UI.alertMsg(tgtInfo.eco ? '🚨 敵艦隊撲向我方採礦線！' : '🚨 敵方艦隊來襲！注意防禦！');
      }
    }

    /* ── raid 存活艦返航：無指令且無目標＝該波結束，歸隊參與回防與下波攻勢 ── */
    if (!this.allIn) {
      for (const s of this._fleet(W)) {
        if (s._raiding && !s.order && !s.target) {
          s._raiding = false;
          const gp = this._guardPos();
          s.order = { t: 'amove', x: gp.x, z: gp.z };
        }
      }
    }

    /* ── 基地防衛：敵對勢力（玩家／另一家 AI／星盜 team 3）的戰艦接近 → 全軍回防 ── */
    if (!this.allIn) {
      let intruder = null;
      for (let t = 0; t < W.teams.length && !intruder; t++) {
        if (t === me) continue;
        for (const s of W.teams[t]) {
          if (s.def.eco) continue;
          if (U.dist2XZ(s.pos, this.home) < 1250 * 1250) { intruder = s; break; }
        }
      }
      if (intruder) {
        for (const s of this._fleet(W)) {
          if (s._raiding) continue;
          if (!s.order || s.order.t !== 'attack') s.order = { t: 'amove', x: intruder.pos.x, z: intruder.pos.z };
        }
      }
    }

    /* ── 決死總攻（自家母艦血量 < 55%） ── */
    if (!this.allIn && this.base && this.base.hull < this.base.maxHull * 0.55) {
      this.allIn = true;
      const tgtTeam = this._pickTarget(W);
      const tgt = this._tgtBasePos(W, tgtTeam);
      for (const s of this._fleet(W)) {
        s._raiding = true;
        s.order = { t: 'amove', x: tgt.x + U.rand(-300, 300), z: tgt.z + U.rand(-300, 300) };
      }
      if (tgtTeam === 0) {
        UI.alertMsg(tri ? `🚨 ${TEAMS[me].name}發動決死總攻！` : '🚨 敵方發動決死總攻！');
        SFX.alarm();
      }
    }
  },
};
