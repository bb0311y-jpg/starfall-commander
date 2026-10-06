'use strict';
/* ═══════════ 世界模擬：經濟、建造、戰鬥 ═══════════ */

let ENT_ID = 1;

/* 艦隊陣型（只決定目的地分配，不影響 _separate 防碰撞）
   keep＝保持出發時相對質心的隊形；line＝橫列（垂直前進方向）；wedge＝楔形（大船居中、小船兩翼） */
const FORM = {
  names: { keep: '保持隊形', line: '橫列', wedge: '楔形' },
  rowSingle: 20,   // ≤20 艘排一排，超過就分多排
  rowN: 16,        // 多排時每排上限（實際平均分配）
  armN: 8,         // 楔形每翼上限，超過就在後方再排一個 V
  keepBase: 200, keepPer: 60,   // 保持隊形的最大半徑＝base+per×√n（散太開就等比收攏）
};
/* 巡邏：路線附近才接戰（start），追離路線超過 leash 就放棄、冷卻 cool 秒後回路線 */
const PATROL = { engage: 850, start: 750, leash: 1150, cool: 3, arrive: 60 };

const World = {
  scene: null, pickRoot: null,
  ents: [], projectiles: [], beams: [],
  teams: [[], [], [], []], blds: [[], [], [], []], asts: [],
  teamsN: 2, mode: 'duel', homes: null, bases: null, teamKills: null,
  credits: 700, mined: 0, incomeShown: 0,
  upgrades: null, researchDone: null,
  selection: new Set(),
  stats: null, time: 0, over: false, won: false,
  diff: null, playerBase: null, enemyBase: null,
  shakeAmt: 0,
  fog: false,              // 本局是否開戰爭迷霧（Game.start 設定；邏輯在 js/fog.js）
  _incTrack: { t: 0, last: 700 },
  _alarmT: 0,

  init(scene, diffKey, mode) {
    this.scene = scene;
    /* 清空舊局 */
    if (FX.scene) FX.reset();
    clearTimeout(this._endTimer);
    if (this.pickRoot) {
      /* 釋放上一局的獨有 GPU 幾何（小行星/礦晶/護盾光罩）；共用快取不碰 */
      for (const a of this.asts) a.mesh.traverse(o => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
      for (const e of this.ents) {
        if (e.shieldMesh) e.shieldMesh = null;   // 幾何與材質共用，不 dispose
      }
      scene.remove(this.pickRoot);
    }
    this.pickRoot = new THREE.Group();
    scene.add(this.pickRoot);
    this.ents = []; this.projectiles = []; this.beams = [];
    /* 上一局還在「臨終閃爍」的巨艦網格（大爆階段①延後移除）一併拿掉 */
    for (const b of this.booms || []) if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
    this.booms = []; this.salvos = [];
    /* 勢力數：雙方（預設，舊行為）或三方混戰；玩家永遠是 team 0 */
    this.mode = mode === 'tri' ? 'tri' : 'duel';
    this.teamsN = this.mode === 'tri' ? 3 : 2;
    this.teams = []; this.blds = [];
    /* 陣列一律建到 TEAMS.length（含第四方星盜 team 3）；teamsN 只管 AI 數量／勝負／選單 */
    for (let t = 0; t < TEAMS.length; t++) { this.teams.push([]); this.blds.push([]); }
    this.asts = [];
    this.homes = [{ x: -MAP.baseX, z: 0 }, { x: MAP.baseX, z: 0 }, { x: MAP.base3.x, z: MAP.base3.z }].slice(0, this.teamsN);
    this.fields = this.mode === 'tri' ? MAP.fields3 : MAP.fields;
    this.teamKills = new Array(TEAMS.length).fill(0);
    this.selection.clear();
    this.credits = 700; this.mined = 0; this.time = 0;
    this.over = false; this.won = false;
    this.upgrades = { wpn: 0, arm: 0, mine: 0, eng: 0, cap: 0, fleet: 0, shd: 0, rep: 0, ref: 0, def: 0, outp: 0 };
    this.researchDone = new Set();
    this.stats = { kills: 0, losses: 0, mined: 0, built: 0 };
    this.diff = DIFFS[diffKey] || DIFFS.normal;
    this._incTrack = { t: 0, last: this.credits };
    this._earnAcc = 0;
    this._alarmT = 0;
    this.alarmPos = null;
    this.cometMark = null;   // 富礦隕石標記（小地圖金色 ☄＋N 鍵跳轉）
    this._cometT = EVENTS.cometFirst;
    this._pirInit();

    /* ── 地圖佈局 ── */
    this.bases = this.homes.map((h, t) => this.mkBld('base', t, h.x, h.z, true));
    while (this.bases.length < TEAMS.length) this.bases.push(null);   // 沒出場的勢力／星盜＝無母艦
    this.playerBase = this.bases[0];
    this.enemyBase = this.bases[1];
    /* 小行星帶（佈局與肥沃度在 data.js 的 MAP；三方模式用 fields3） */
    for (const [fx, fz, n, rich] of this.fields) {
      for (let i = 0; i < n; i++) {
        const a = U.rand(U.TAU), r = U.rand(40, 330);
        const size = U.rand(26, 52);
        this.mkAst(fx + Math.cos(a) * r, fz + Math.sin(a) * r * 0.8, size, Math.round(size * U.rand(45, 65) * ORE_MUL * (rich || 1)));
      }
    }
    this.oreTotal = this.asts.reduce((s, a) => s + a.ore, 0);
    /* 我方起始單位 */
    for (let i = 0; i < 3; i++) {
      const h = this.mkShip('harv', 0, -MAP.baseX + 150 + U.rand(-40, 40), -160 + i * 160);
      h.state = 'toField';
    }
    this.mkShip('int', 0, -MAP.baseX + 200, -260);
    this.mkShip('int', 0, -MAP.baseX + 200, 260);
    /* 敵方基地群（每個敵方勢力一個 AI 實例） */
    AI.initAll(this);
    this._rebuild();
    /* 戰爭迷霧：World.fog 由 Game.start 依主選單開關設定（選單背景局＝關） */
    if (typeof Fog !== 'undefined') Fog.reset(this.fog);
  },

  /* ══════ 實體建立 ══════ */
  _baseEnt(kind, cls, def, team, x, z) {
    return {
      id: ENT_ID++, kind, cls, def, team,
      name: def.name,
      pos: new THREE.Vector3(x, 0, z),
      yaw: this.teamYaw(team),
      radius: def.radius,
      maxHull: def.hull, hull: def.hull,
      maxShield: def.shield || 0, shield: def.shield || 0,
      regen: def.regen || 0,
      alive: true, lastHit: -99, dmgMul: 1,
      weapons: (def.weapons || []).map(wd => ({
        d: wd, cd: wd.delay !== undefined ? wd.delay : U.rand(0.3, Math.max(0.5, wd.cd || 1)),
      })),
    };
  },

  mkShip(cls, team, x, z, growth) {
    const def = SHIPS[cls];
    const e = this._baseEnt('ship', cls, def, team, x, z);
    e.vel = { x: 0, z: 0 };
    e.order = null; e.target = null;
    e.retargetT = U.rand(0.4);
    e.bob = U.rand(U.TAU);
    e.thrusting = 0;
    e.baseY = def.small ? U.rand(14, 30) : U.rand(2, 8);
    e.orbitDir = Math.random() < 0.5 ? 1 : -1;
    e.orbitPhase = U.rand(U.TAU);
    e.battleKills = 0;
    if (def.cargo) { e.cargo = 0; e.state = 'idle'; e.mineTarget = null; e.mineFx = null; }
    if (def.hangar) { e.hangT = U.rand(1, def.hangar.cd); }
    let mainRange = 250;
    for (const wd of (def.weapons || [])) if (wd.t !== 'pd') { mainRange = wd.range; break; }
    e.prefRange = def.small ? 175 : mainRange * 0.72;
    /* 升級加成 */
    if (team === 0) {
      e.dmgMul = 1 + 0.12 * this.upgrades.wpn;
      const am = 1 + 0.12 * this.upgrades.arm;
      e.maxHull = Math.round(e.maxHull * am); e.hull = e.maxHull;
      e.maxShield = Math.round(e.maxShield * am); e.shield = e.maxShield;
      e.spdMul = 1 + 0.1 * this.upgrades.eng;
    } else {
      const g = growth || 1;
      e.dmgMul = g;
      e.maxHull = Math.round(e.maxHull * g); e.hull = e.maxHull;
      e.maxShield = Math.round(e.maxShield * g); e.shield = e.maxShield;
      e.spdMul = 1;
    }
    e.mesh = Models.makeShip(cls, team, def.radius);
    e.mesh.rotation.order = 'YXZ';
    e.mesh.userData.ent = e;
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = -e.yaw;
    this.pickRoot.add(e.mesh);
    if (def.small) e.ribbon = FX.ribbonAcquire(TEAMS[team].hex, 26, 0.9);
    this.ents.push(e);
    return e;
  },

  mkBld(cls, team, x, z, built) {
    const def = BLDS[cls];
    const e = this._baseEnt('bld', cls, def, team, x, z);
    e.buildT = built ? 0 : def.bt;
    e.buildTotal = def.bt;
    e.queue = [];
    e.research = null;
    e.rally = null;
    e.headYaw = e.yaw; e.target = null; e.retargetT = U.rand(0.4);
    if (team === 0 && this.upgrades && this.upgrades.def) {
      const k = this._defMul(0);
      e.maxHull = Math.round(def.hull * k); e.hull = e.maxHull; e.dmgMul = k;
    }
    e.mesh = Models.makeBld(cls, team);
    e.mesh.userData.ent = e;
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = -e.yaw;
    if (!built) {
      e.mesh.scale.y = 0.15;
      e.hull = Math.round(e.maxHull * 0.25);
    }
    this.pickRoot.add(e.mesh);
    this.ents.push(e);
    return e;
  },

  mkAst(x, z, size, ore) {
    const e = {
      id: ENT_ID++, kind: 'ast', cls: 'ast', team: -1,
      name: '小行星', def: { name: '小行星' },
      pos: new THREE.Vector3(x, U.rand(-20, 30), z),
      yaw: 0, radius: size, ore, oreMax: ore,
      alive: true, spinA: U.rand(0.05, 0.25) * (Math.random() < 0.5 ? 1 : -1),
      hull: 1, maxHull: 1, shield: 0, maxShield: 0, weapons: [],
    };
    e.mesh = Models.makeAsteroid(size);
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.set(U.rand(3), U.rand(3), U.rand(3));
    e.mesh.userData.ent = e;
    this.pickRoot.add(e.mesh);
    this.ents.push(e);
    this.asts.push(e);
    return e;
  },

  /* 各勢力「面向地圖中央」的朝向：team 0＝0、team 1＝π（與舊版相同），第三勢力朝下方中央 */
  teamYaw(team) {
    if (team <= 0) return 0;
    const h = this.homes && this.homes[team];
    if (!h) return Math.PI;
    return Math.atan2(0 - h.z, 0 - h.x);
  },

  _rebuild() {
    for (let t = 0; t < TEAMS.length; t++) { this.teams[t].length = 0; this.blds[t].length = 0; }
    for (const e of this.ents) {
      if (!e.alive || e.team < 0) continue;
      if (e.kind === 'ship') this.teams[e.team].push(e);
      else if (e.kind === 'bld') this.blds[e.team].push(e);
    }
  },

  /* 可攻擊目標清單（艦 + 已建成建築） */
  /* N 鍵／點警報橫幅要跳去哪：進行中的敵襲優先，否則標記期內的富礦隕石，最後退回上次敵襲點 */
  jumpTarget() {
    const ap = this.alarmPos, cm = this.cometMark;
    if (ap && this.time < ap.until) return ap;
    if (cm && cm.ast.alive && cm.ast.ore > 0 && this.time < cm.until) return cm;
    return ap;
  },

  hostilesOf(team) {
    const out = [];
    for (let t = 0; t < TEAMS.length; t++) {
      if (t === team) continue;
      for (const s of this.teams[t]) out.push(s);
      for (const b of this.blds[t]) if (b.buildT <= 0) out.push(b);
    }
    return out;
  },
  /* 敵對勢力的艦艇（不含建築）逐一回呼：PD／砲塔鎖敵用，免建暫時陣列 */
  _eachHostileShip(team, fn) {
    for (let t = 0; t < TEAMS.length; t++) {
      if (t === team) continue;
      for (const s of this.teams[t]) fn(s);
    }
  },

  /* ══════ 玩家操作 API ══════ */
  /* 艦隊與戰機分開算上限（戰機＝small 且可建造；無人機不計） */
  isFighter(def) { return !!def.small && !def.noBuild; },
  supply(team = 0) {
    let n = 0;
    for (const e of this.teams[team]) if (!e.def.eco && e.cls !== 'drone' && !this.isFighter(e.def)) n++;
    return n;
  },
  supplyFighters(team = 0) {
    let n = 0;
    for (const e of this.teams[team]) if (this.isFighter(e.def)) n++;
    return n;
  },
  supplyCap() { return CAPS.fleet + CAPS.fleetPerUp * this.upgrades.fleet; },
  fighterCap() { return CAPS.fighters + CAPS.fighterPerUp * this.upgrades.fleet; },
  oreLeft() { let s = 0; for (const a of this.asts) s += a.ore; return s; },
  /* 採礦增效研究同時加大礦艙（否則收益被運輸時間吃掉，是陷阱研究） */
  cargoCap(e) { return e.def.cargo * (1 + (e.team === 0 ? 0.25 * this.upgrades.mine : 0)); },
  harvCount(team) {
    let n = 0;
    for (const e of this.teams[team]) if (e.def.eco) n++;
    return n;
  },
  countCls(team, cls) {
    let n = 0;
    for (const e of this.teams[team]) if (e.cls === cls) n++;
    for (const b of this.blds[team]) {
      if (b.cls === cls) n++;
      for (const q of b.queue) if (q.cls === cls) n++;
    }
    return n;
  },
  bldCount(team, cls) {
    let n = 0;
    for (const b of this.blds[team]) if (b.cls === cls) n++;
    return n;
  },

  buildRangeOf(b) {
    if (b.def.noExpand) return 0;   // 偵察衛星不提供建造範圍
    return b.def.buildRange ? b.def.buildRange + 700 * (b.team === 0 ? this.upgrades.outp : 0) : BUILD_RANGE;
  },
  /* 防禦工事：我方建築船體／火力倍率 */
  _defMul(team) { return team === 0 ? 1 + 0.25 * this.upgrades.def : 1; },
  /* 護盾再生倍率（我方） */
  _shdMul(team) { return team === 0 ? 1 + 0.4 * this.upgrades.shd : 1; },

  canPlace(cls, x, z) {
    if (Math.abs(x) > MAP.W - 200 || Math.abs(z) > MAP.H - 200) return false;
    const def = BLDS[cls];
    if (def.limit && this.bldCount(0, cls) >= def.limit) return false;
    /* 需靠近我方建築 */
    let near = false;
    for (const b of this.blds[0]) {
      if (U.distXZ(b.pos, { x, z }) < this.buildRangeOf(b)) { near = true; break; }
    }
    if (!near) return false;
    /* 不可重疊 */
    for (const e of this.ents) {
      if (!e.alive || e.kind === 'ship') continue;
      if (U.distXZ(e.pos, { x, z }) < e.radius + def.radius + 26) return false;
    }
    return true;
  },
  place(cls, x, z) {
    const def = BLDS[cls];
    if (this.credits < def.cost || !this.canPlace(cls, x, z)) return false;
    this.credits -= def.cost;
    this.mkBld(cls, 0, x, z, false);
    this.stats.built++;
    SFX.place();
    this._rebuild();
    return true;
  },

  queueShip(bld, cls) {
    const def = SHIPS[cls];
    if (!def) return false;
    if (bld.queue.length >= QUEUE_MAX) { if (bld.team === 0) UI.toast('生產佇列已滿（上限 ' + QUEUE_MAX + '）', 'red'); return false; }
    if (this.credits < def.cost) { if (bld.team === 0) UI.toast('星礦不足', 'red'); return false; }
    if (def.needLab && !this.bldCount(0, 'lab')) return false;
    if (def.needCap && !this.researchDone.has('cap1')) return false;
    if (def.needCap2 && !this.researchDone.has('cap2')) return false;
    if (def.max && this.countCls(0, cls) >= def.max) return false;
    if (def.limit && this.countCls(0, cls) >= def.limit) return false;
    /* 佇列中的也算進去，免得一次連下超過上限 */
    let queued = 0;
    for (const b of this.blds[0]) for (const q of b.queue) if (!SHIPS[q.cls].eco && this.isFighter(SHIPS[q.cls]) === this.isFighter(def)) queued++;
    if (this.isFighter(def)) {
      if (this.supplyFighters() + queued >= this.fighterCap()) { UI.toast('戰機已達上限 ' + this.fighterCap() + ' 架（可研究「艦隊編制」擴編）', 'red'); return false; }
    } else if (!def.eco && this.supply() + queued >= this.supplyCap()) { UI.toast('艦隊已達上限 ' + this.supplyCap() + ' 艘（可研究「艦隊編制」擴編）', 'red'); return false; }
    this.credits -= def.cost;
    bld.queue.push({ cls, t: def.bt, total: def.bt });
    SFX.click();
    return true;
  },

  /* 拆除變賣：退款＝造價 × SELL.refund × 船體剩餘比例；船塢佇列全額退、研究中項目全額退 */
  sellRefund(b) {
    if (b.buildT > 0) return Math.round((b.def.cost || 0) * SELL.building);   // 建造中取消：建造中血量從 25% 起跳，照血量算太吃虧
    return Math.round((b.def.cost || 0) * SELL.refund * U.clamp(b.hull / b.maxHull, 0, 1));
  },
  sellBld(b) {
    if (!b || !b.alive || b.kind !== 'bld' || b.team !== 0 || b.cls === 'base') return false;
    let refund = this.sellRefund(b);
    for (const q of (b.queue || [])) refund += SHIPS[q.cls].cost;
    if (b.research) { const up = UPGRADES.find(u => u.id === b.research.id); if (up) refund += up.cost; }
    this.credits += refund;
    b.queue = []; b.research = null;
    b._sold = true;
    this.kill(b, null);
    UI.addFloat(b.pos, `+${refund} 💎 變賣`, '#ffd166');
    SFX.unload();
    return true;
  },

  startResearch(lab, id) {
    const up = UPGRADES.find(u => u.id === id);
    if (!up || lab.research || this.researchDone.has(id) || this.credits < up.cost) return false;
    if (up.prereq && !this.researchDone.has(up.prereq)) return false;
    this.credits -= up.cost;
    lab.research = { id, t: up.time, total: up.time };
    SFX.click();
    return true;
  },

  issueOrder(ents, type, data) {
    const arr = [...ents].filter(e => e.alive && e.kind === 'ship' && e.team === 0);
    if (!arr.length) return;
    if (type === 'move' || type === 'amove') {
      /* 依目前陣型分配各艦目的地（攻擊移動：沿途自動接敵；採礦船則視為一般移動） */
      const slots = this.formationSlots(arr, data.x, data.z);
      for (const e of arr) {
        const { x, z } = slots.get(e);
        if (e.def.eco) { e.order = { t: 'move', x, z }; e.state = 'manual'; e.manualT = 0; this._stopMining(e); }
        else e.order = { t: type, x, z };
      }
    } else if (type === 'patrol') {
      /* 巡邏：只給戰鬥艦（採礦船不接受）；data.add＝在現有路線尾端加點（Shift） */
      const war = arr.filter(e => !e.def.eco);
      if (!war.length) return;
      const fresh = data.add ? war.filter(e => !(e.order && e.order.t === 'patrol')) : war;
      const bases = new Set();
      for (const e of war) {
        if (fresh.includes(e)) continue;
        const o = e.order;
        o.pts.push({ x: data.x + o.off.x, z: data.z + o.off.z });
        if (!bases.has(o.base)) { bases.add(o.base); o.base.push({ x: data.x, z: data.z }); }
      }
      if (fresh.length) {
        const slots = this.formationSlots(fresh, data.x, data.z);
        let cx = 0, cz = 0;
        for (const e of fresh) { cx += e.pos.x; cz += e.pos.z; }
        /* base＝整群共用的路線（畫標記用，同一群只畫一次）；pts＝各艦自己的路線（含陣型偏移） */
        const base = [{ x: cx / fresh.length, z: cz / fresh.length }, { x: data.x, z: data.z }];
        for (const e of fresh) {
          const sl = slots.get(e);
          e.order = { t: 'patrol', pts: [{ x: e.pos.x, z: e.pos.z }, { x: sl.x, z: sl.z }], i: 1, dir: 1,
            off: { x: sl.x - data.x, z: sl.z - data.z }, base, cool: 0, engaged: false, best: Infinity, st: 0 };
        }
      }
    } else if (type === 'stop') {
      /* 停止：戰鬥艦原地待命；採礦船立刻恢復自動採礦（玩家的手動解卡鍵） */
      for (const e of arr) {
        e.order = null; e.target = null;
        if (e.def.eco) { this._stopMining(e); e.state = 'toField'; e.manualT = 0; }
      }
    } else if (type === 'attack') {
      for (const e of arr) {
        if (e.def.eco) { e.order = { t: 'move', x: data.ent.pos.x, z: data.ent.pos.z }; continue; }
        e.order = { t: 'attack', ent: data.ent };
        e.target = data.ent;
      }
    } else if (type === 'mine') {
      arr.forEach((e, i) => {
        if (e.def.eco) {
          e.mineTarget = data.ast;
          e.state = 'toField';
          e.order = null;
          e.manualT = 0;
          this._stopMining(e);
        } else {
          const r = 60 + 30 * Math.sqrt(i), a = i * 2.4;
          e.order = { t: 'move', x: data.ast.pos.x + Math.cos(a) * r, z: data.ast.pos.z + Math.sin(a) * r };
        }
      });
    }
    SFX.click();
  },

  /* ══════ 艦隊陣型：回傳 Map(艦 → 目的地 {x,z}) ══════ */
  formation: 'keep',
  setFormation(f) { if (FORM.names[f]) this.formation = f; },
  formationSlots(arr, tx, tz, mode) {
    mode = mode || this.formation;
    const out = new Map(), n = arr.length;
    if (n === 1) { out.set(arr[0], { x: tx, z: tz }); return out; }
    let cx = 0, cz = 0;
    for (const e of arr) { cx += e.pos.x; cz += e.pos.z; }
    cx /= n; cz /= n;
    /* 前進方向 f（質心→目的地）、右側方向 s */
    let fx = tx - cx, fz = tz - cz;
    const fl = Math.hypot(fx, fz);
    if (fl < 1) { fx = 1; fz = 0; } else { fx /= fl; fz /= fl; }
    const sx = -fz, sz = fx;
    const put = (e, along, side) => out.set(e, { x: tx + fx * along + sx * side, z: tz + fz * along + sz * side });
    const sideOf = e => (e.pos.x - cx) * sx + (e.pos.z - cz) * sz;
    const fwdOf = e => (e.pos.x - cx) * fx + (e.pos.z - cz) * fz;

    if (mode === 'line') {
      const rows = n <= FORM.rowSingle ? 1 : Math.ceil(n / FORM.rowN);
      const per = Math.ceil(n / rows);
      let maxR = 0;
      for (const e of arr) maxR = Math.max(maxR, e.radius);
      const rowGap = 2 * maxR + 24;
      /* 原本在前面的排前排、左右照原本左右順序 → 路線不交叉 */
      const byF = [...arr].sort((a, b) => fwdOf(b) - fwdOf(a));
      for (let r = 0; r < rows; r++) {
        const row = byF.slice(r * per, (r + 1) * per).sort((a, b) => sideOf(a) - sideOf(b));
        let rr = 0;
        for (const e of row) rr = Math.max(rr, e.radius);
        const sp = 2 * rr + 16;
        row.forEach((e, k) => put(e, -r * rowGap, (k - (row.length - 1) / 2) * sp));
      }
      return out;
    }
    if (mode === 'wedge') {
      /* 中軸：最多 3 艘最大的非小型艦（沒有大船就由最大那艘當箭頭）；其餘依大小排兩翼，大的靠近箭頭 */
      const bySize = [...arr].sort((a, b) => b.radius - a.radius);
      let center = bySize.filter(e => !e.def.small).slice(0, 3);
      if (!center.length) center = [bySize[0]];
      const wings = bySize.filter(e => !center.includes(e));
      let rC = 0, rW = 0;
      for (const e of center) rC = Math.max(rC, e.radius);
      for (const e of wings) rW = Math.max(rW, e.radius);
      const cGap = 2 * rC + 20;
      center.forEach((e, k) => put(e, -k * cGap, 0));
      const sGap = 2 * rW + 18, bGap = sGap * 1.15;
      const perV = FORM.armN * 2;
      const vDepth = Math.max(FORM.armN * bGap + 2 * rW + 30, center.length * cGap);
      for (let v = 0; v * perV < wings.length; v++) {
        const grp = wings.slice(v * perV, (v + 1) * perV);
        for (let j = 0; j * 2 < grp.length; j++) {
          const pair = grp.slice(j * 2, j * 2 + 2).sort((a, b) => sideOf(a) - sideOf(b));
          const lat = rC + rW + 10 + j * sGap, back = v * vDepth + (j + 1) * bGap;
          if (pair.length === 2) { put(pair[0], -back, -lat); put(pair[1], -back, lat); }
          else put(pair[0], -back, sideOf(pair[0]) < 0 ? -lat : lat);
        }
      }
      return out;
    }
    /* keep：相對質心偏移照搬；散得太開（例如跨半張地圖）就等比收攏 */
    let maxD = 0;
    for (const e of arr) maxD = Math.max(maxD, Math.hypot(e.pos.x - cx, e.pos.z - cz));
    const lim = FORM.keepBase + FORM.keepPer * Math.sqrt(n);
    const k = maxD > lim ? lim / maxD : 1;
    for (const e of arr) out.set(e, { x: tx + (e.pos.x - cx) * k, z: tz + (e.pos.z - cz) * k });
    return out;
  },

  /* ══════ 傷害與死亡 ══════ */
  damage(e, amt, src) {
    if (!e.alive || e.kind === 'ast') return;
    e.lastHit = this.time;
    /* 戰爭迷霧：我方被打＝攻擊者現形；迷霧裡的交火聽不到 */
    const fogged = typeof Fog !== 'undefined' && Fog.on;
    if (fogged && e.team === 0 && src) Fog.onPlayerHit(e, src);
    const heard = !fogged || !Fog.hiddenAt(e.pos);
    const dealt = amt;
    if (e.shield > 0) {
      const a = Math.min(e.shield, amt);
      e.shield -= a; amt -= a;
      if (a > 0.5 && heard) SFX.hitShield(e.pos);
    }
    if (amt > 0) { e.hull -= amt; e.hullHitT = this.time; if (amt > 1 && heard) SFX.hitHull(e.pos); }
    /* 傷害飄字：每實體 0.45s 聚合一次（敵方金色＝輸出爽感；我方橘紅＝警覺） */
    e._dmgAcc = (e._dmgAcc || 0) + dealt;
    if (e._dmgFloatT === undefined || this.time - e._dmgFloatT > 0.45) {
      e._dmgFloatT = this.time;
      if (e._dmgAcc >= 1) UI.addFloat(e.pos, '−' + Math.round(e._dmgAcc), e.team !== 0 ? '#ffd166' : '#ff8a66');
      e._dmgAcc = 0;
    }
    /* 我方基地遇襲警報＋可導航的遇襲座標（N 鍵／點警報跳轉） */
    if (e.team === 0 && e.kind === 'bld') {
      this.alarmPos = { x: e.pos.x, z: e.pos.z, until: this.time + 6 };
      if (this.time - this._alarmT > 12) {
        this._alarmT = this.time;
        SFX.alarm();
        UI.alertMsg('⚠ 我方設施遭受攻擊！（按 N 前往）');
      }
    }
    if (e.hull <= 0) this.kill(e, src);
  },

  kill(e, src) {
    if (!e.alive) return;
    e.alive = false;
    this._deadDirty = true;
    /* 老兵系統：3 殺★老兵、6 殺★★王牌（+10%傷害/級、護盾再生+50%/級，敵我對等） */
    if (src && src.alive && src.kind === 'ship' && src.team !== e.team && e.cls !== 'drone') {
      src.battleKills = (src.battleKills || 0) + 1;
      const lv = src.battleKills >= 6 ? 2 : src.battleKills >= 3 ? 1 : 0;
      if (lv > (src.vet || 0)) {
        src.vet = lv;
        if (src.team === 0) UI.addFloat(src.pos, lv === 2 ? '★★ 王牌！' : '★ 老兵', '#ffd166');
      }
    }
    const big = e.radius >= 24;
    /* 10-07 分級爆炸（依體積，size≈radius×1.3）：小 <14 一閃；中 14～30 火球＋環＋碎片；
       大 30～80 多階段（①船身連環小爆＋閃白抖動 → ②核心白熱火團 → ③炸開衝擊波＋煙塵 → ④餘燼）；
       超大 ≥80（母艦）同大再放大＋全螢幕白閃。大爆同時最多 FX.BLAST.maxBig 場，滿了降級成中。 */
    const fxSize = e.radius * (e.kind === 'bld' ? 1.15 : 1.3);
    const hex = TEAMS[Math.max(0, e.team)].hex;
    /* 鏡頭震動：trauma 制＋距離衰減（螢幕外的爆炸不震手） */
    const att = this._shakeAtt(e.pos);
    const unseen = typeof Fog !== 'undefined' && Fog.hiddenAt(e.pos);   // 迷霧中的爆炸：不出聲、不震
    let tier = fxSize < 14 ? 0 : fxSize < 30 ? 1 : fxSize >= 80 ? 3 : 2;
    if (unseen) tier = Math.min(tier, 1);
    if (tier === 2 && !FX.canBig()) tier = 1;
    const staged = tier >= 2;
    if (!staged) {
      if (tier === 0) FX.explode(e.pos, fxSize, hex); else FX.blastMid(e.pos, fxSize, hex);
      if (unseen) { /* 靜默 */ }
      else { this._explSnd(fxSize, e.pos); if (big) this.shakeAmt = Math.min(1.2, this.shakeAmt + (0.22 + e.radius * 0.012) * att); }
    } else this._stageBlast(e, fxSize, hex, tier === 3, att);
    if (src && src.team >= 0 && src.team !== e.team && e.cls !== 'drone' && this.teamKills) this.teamKills[src.team]++;
    if (e.pirate) this._pirOnKill(e, src);
    /* 我方戰績：雙方模式＝敵方折損全算（舊行為）；三方模式與星盜只算我方打下的 */
    if (e.team > 0 && e.cls !== 'drone' && ((this.teamsN === 2 && !e.pirate) || (src && src.team === 0))) {
      this.stats.kills++;
      UI.addFloat(e.pos, '✖ 擊毀 ' + e.name, '#7ef29a');
      SFX.kill();
      if (e.def.eco) UI.toast('💥 敵方採礦船被毀——敵方收入下降', 'gold');
      else if (e.cls === 'ref') UI.toast('🏭 敵方精煉站被毀——敵方經濟重創', 'gold');
    } else if (e.team === 0 && e.cls !== 'drone' && !e._sold) this.stats.losses++;   // 變賣不算損失
    /* 戰場殘骸：擊毀的艦掉落可回收殘料（採礦船會自動去撿，戰鬥勝利接回經濟） */
    /* 星盜（def.salvageMul）一律掉殘骸且量 ×salvageMul，不受 minCost 限制 */
    const salMul = e.def.salvageMul || 1;
    if (e.kind === 'ship' && e.cls !== 'drone' && (e.def.cost >= SALVAGE.minCost || e.def.salvageMul) && !this.over) {
      let nW = 0;
      for (const a of this.asts) if (a.wreck && a.alive && a.ore > 0) nW++;
      if (nW < SALVAGE.maxWrecks) {
        const w = this.mkAst(e.pos.x + U.rand(-20, 20), e.pos.z + U.rand(-20, 20),
          U.clamp(e.radius * 0.9, 14, 26), Math.round(e.def.cost * SALVAGE.frac * salMul));
        if (e.pirate) this.pirStats.wrecks++;
        w.wreck = true; w.wreckT = SALVAGE.life;
        w.name = '艦骸殘料'; w.def = { name: '艦骸殘料' };
        /* 殘骸：沿用石頭本身材質（月岩有貼圖）但染成冷灰藍，一眼跟礦石區分 */
        const wr = w.mesh.children[0];
        wr.material = wr.material.clone();
        wr.material.color.setHex(0x5a6a7d).convertSRGBToLinear();
        w.wreckMat = wr.material;
        /* 大爆：殘骸等階段③炸開那一刻才出現（不然會先浮在火團裡） */
        if (staged) { w.mesh.visible = false; e._wreck = w; }
      }
    }
    if (e.ribbon) { e.ribbon.release(); e.ribbon = null; }
    if (e.mineFx) { FX.mineBeamRelease(e.mineFx); e.mineFx = null; }
    this.selection.delete(e);
    /* 大爆：網格留到階段②核心火團那一刻才移除（臨終閃白＋抖動由 booms 'hull' 驅動） */
    if (!staged) { this.scene.remove(e.mesh); this.pickRoot.remove(e.mesh); }
    if (e.shieldMesh) e.shieldMesh = null;   // 幾何與材質共用，不 dispose
    /* 主力艦擊殺 hit-stop：0.35 秒慢動作儀式感（大爆改在階段②核心火團瞬間觸發） */
    if (!staged && e.kind === 'ship' && e.radius >= 28) Game.slowMo(0.35);
    /* 勝負：自家母艦沉＝敗；所有敵方母艦都沉＝勝（三方模式先沉的那家退出戰局） */
    if (e === this.playerBase) this._end(false, e);
    else if (e.kind === 'bld' && e.cls === 'base' && e.team > 0) {
      if (this.bases.every((b, t) => t === 0 || !b || !b.alive)) this._end(true, e);
      else if (!this.over) {
        const ai = AI.of(e.team);
        if (ai) ai.dead = true;
        UI.alertMsg(`💥 ${TEAMS[e.team].name}的母艦被摧毀——該勢力退出戰局！`);
        SFX.alarm();
      }
    }
  },

  /* ══════ 星盜事件（第四方 team 3：無基地、敵對所有人、不佔 CAPS、不進 AI 經濟；常數在 data.js 的 PIRATES） ══════ */
  PIR_TEAM: 3,
  _pirInit() {
    this._pirT = PIRATES.first;
    this._pirTick = 0;
    this.pirWaves = [];
    this.pirStats = { waves: 0, spawned: 0, killed: 0, killedBy: new Array(TEAMS.length).fill(0), retreated: 0,
      pirKills: 0, wrecks: 0, lockPlayer: 0, lockAI: 0, log: [] };
  },
  /* 生成點：地圖四邊外緣隨機一點，避開所有基地 avoid 範圍 */
  _pirSpawnPt() {
    const P = PIRATES, W = MAP.W + P.spawnOut, H = MAP.H + P.spawnOut;
    let best = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const side = Math.floor(Math.random() * 4);
      const pt = side === 0 ? { x: -W, z: U.rand(-H, H) } : side === 1 ? { x: W, z: U.rand(-H, H) }
        : side === 2 ? { x: U.rand(-W, W), z: -H } : { x: U.rand(-W, W), z: H };
      let dMin = Infinity;
      for (const h of this.homes) dMin = Math.min(dMin, U.distXZ(pt, h));
      if (dMin > P.avoid) return pt;
      if (dMin > bestD) { bestD = dMin; best = pt; }
    }
    return best;
  },
  /* 挑目標勢力：權重＝1＋0.5×採礦船相對數＋0.5×距離近的程度（各家在 1～2 倍之間：玩家不被特別針對也不被忽略） */
  _pirPickTarget(sp) {
    const cand = [];
    let maxH = 1, maxD = 1;
    for (let t = 0; t < this.teamsN; t++) {
      const b = this.bases[t];
      if (!b || !b.alive) continue;
      const hv = this.harvCount(t), d = U.distXZ(sp, this.homes[t]);
      cand.push({ t, hv, d });
      maxH = Math.max(maxH, hv); maxD = Math.max(maxD, d);
    }
    if (!cand.length) return null;
    let sum = 0;
    for (const c of cand) { c.w = 1 + 0.5 * c.hv / maxH + 0.5 * (1 - c.d / maxD); sum += c.w; }
    let r = Math.random() * sum, pick = cand[cand.length - 1];
    for (const c of cand) { r -= c.w; if (r <= 0) { pick = c; break; } }
    const t = pick.t, home = this.homes[t];
    /* 60% 打採礦線（離生成點最近的前 3 艘採礦船挑一）；否則打前線建築（離自家母艦最遠的非母艦建築）；都沒有就母艦 */
    const harvs = this.teams[t].filter(s => s.def.eco);
    if (harvs.length && Math.random() < 0.6) {
      harvs.sort((a, b) => U.dist2XZ(a.pos, sp) - U.dist2XZ(b.pos, sp));
      const h = harvs[Math.floor(Math.random() * Math.min(3, harvs.length))];
      return { team: t, x: h.pos.x, z: h.pos.z, what: 'mine' };
    }
    let far = null, fd = -1;
    for (const b of this.blds[t]) {
      if (b.cls === 'base') continue;
      const d = U.dist2XZ(b.pos, home);
      if (d > fd) { fd = d; far = b; }
    }
    const tg = far || this.bases[t];
    return { team: t, x: tg.pos.x, z: tg.pos.z, what: far ? 'front' : 'base' };
  },
  _pirSpawnWave() {
    const P = PIRATES, T = this.time;
    const sp = this._pirSpawnPt();
    const tg = sp && this._pirPickTarget(sp);
    if (!tg) return;
    const n = P.base + Math.floor(T / 300);
    const growth = Math.min(P.growthMax, 1 + T / P.growthDiv);
    const wave = { id: this.pirStats.waves + 1, t: T, n, team: tg.team, what: tg.what, ships: [], comp: {}, playerKilled: 0, done: false };
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let cls = Math.random() < 0.5 ? 'pir_int' : 'pir_raid';
      if (T >= P.patAt && r < P.patFrac) cls = 'pir_pat';
      else if (T >= P.gunAt && r < (T >= P.patAt ? P.patFrac : 0) + P.gunFrac) cls = 'pir_gun';
      const a = U.rand(U.TAU), rr = U.rand(20, 140);
      const s = this.mkShip(cls, this.PIR_TEAM, sp.x + Math.cos(a) * rr, sp.z + Math.sin(a) * rr, growth);
      s.pirate = wave; s.pirBorn = T;
      s.yaw = U.yawTo(s.pos, { x: tg.x, z: tg.z });
      s.order = { t: 'amove', x: tg.x + U.rand(-150, 150), z: tg.z + U.rand(-150, 150) };
      wave.ships.push(s);
      wave.comp[cls] = (wave.comp[cls] || 0) + 1;
    }
    this._rebuild();
    this.pirWaves.push(wave);
    const st = this.pirStats;
    st.waves++; st.spawned += n;
    st.log.push({ t: Math.round(T), n, comp: wave.comp, team: tg.team, what: tg.what, growth: +growth.toFixed(2) });
    if (tg.team === 0 && typeof Fog !== 'undefined' && Fog.on) {
      /* 戰爭迷霧：海盜還在迷霧裡就不預警，等第一次被我方看到（_updPirates）才響 */
      st.lockPlayer++;
      wave.alarmPending = true;
    } else if (tg.team === 0) {
      st.lockPlayer++;
      this.alarmPos = { x: tg.x, z: tg.z, until: T + 10 };
      this._alarmT = T;
      SFX.alarm();
      UI.alertMsg(`☠ 星盜來襲！${n} 艘海盜正撲向我方${tg.what === 'mine' ? '採礦線' : '設施'}（按 N 前往）`);
    } else st.lockAI++;
  },
  _pirOnKill(e, src) {
    const st = this.pirStats, w = e.pirate;
    st.killed++;
    if (src && src.team >= 0) st.killedBy[src.team]++;
    if (src && src.team === 0) w.playerKilled++;
  },
  /* 壽命到期撤退離場：不爆炸、不掉殘骸、不算擊殺 */
  _pirRemove(e) {
    e.alive = false;
    this._deadDirty = true;
    if (e.ribbon) { e.ribbon.release(); e.ribbon = null; }
    this.selection.delete(e);
    this.pickRoot.remove(e.mesh);
    this.pirStats.retreated++;
  },
  _updPirates(dt) {
    if (!PIRATES.enabled) return;
    this._pirT -= dt;
    if (this._pirT <= 0) {
      this._pirT = U.rand(PIRATES.every[0], PIRATES.every[1]);
      this._pirSpawnWave();
    }
    if (!this.pirWaves.length) return;
    this._pirTick -= dt;
    if (this._pirTick > 0) return;
    this._pirTick = 0.5;
    const T = this.time;
    let any = false;
    for (const w of this.pirWaves) {
      let alive = 0, cx = 0, cz = 0, seenN = 0;
      for (const s of w.ships) {
        if (!s.alive) continue;
        if (s.seen) seenN++;
        if (T - s.pirBorn > PIRATES.life) {
          /* 壽命到：往最近的地圖邊緣撤退，貼邊就移除 */
          const ex = MAP.W - Math.abs(s.pos.x), ez = MAP.H - Math.abs(s.pos.z);
          if (Math.min(ex, ez) < 90) { this._pirRemove(s); continue; }
          s.retreat = true;
          s.target = null;
          if (!s.order || s.order.t !== 'move') {
            s.order = ex < ez ? { t: 'move', x: Math.sign(s.pos.x || 1) * (MAP.W + 300), z: s.pos.z }
              : { t: 'move', x: s.pos.x, z: Math.sign(s.pos.z || 1) * (MAP.H + 300) };
          }
          continue;
        }
        alive++; cx += s.pos.x; cz += s.pos.z;
        /* 到達後沒目標：找最近的任何敵對單位，攻擊移動過去 */
        if (!s.order && !s.target) {
          let best = null, bd = Infinity;
          for (const h of this.hostilesOf(this.PIR_TEAM)) {
            const d2 = U.dist2XZ(s.pos, h.pos);
            if (d2 < bd) { bd = d2; best = h; }
          }
          if (best) s.order = { t: 'amove', x: best.pos.x, z: best.pos.z };
        }
      }
      /* 盯上玩家的波次：警報座標跟著海盜群走（小地圖敵襲圈＋N 鍵跳轉） */
      const fogOn = typeof Fog !== 'undefined' && Fog.on;
      if (alive && w.team === 0 && (!fogOn || seenN)) this.alarmPos = { x: cx / alive, z: cz / alive, until: T + 3 };
      if (w.alarmPending && seenN && alive) {
        w.alarmPending = false;
        this._alarmT = T;
        SFX.alarm();
        UI.alertMsg(`☠ 發現星盜！${alive} 艘海盜正撲向我方${w.what === 'mine' ? '採礦線' : '設施'}（按 N 前往）`);
      }
      if (!w.ships.some(s => s.alive)) {
        w.done = true; any = true;
        if (w.playerKilled > 0 && !w.ships.some(s => s.retreat)) UI.toast('☠ 星盜劫掠隊已被擊潰——殘骸可回收（1.5 倍）', 'gold');
      }
    }
    if (any) this.pirWaves = this.pirWaves.filter(w => !w.done);
  },

  _end(won, fb) {
    if (this.over) return;
    this.over = true; this.won = won;
    if (won) SFX.win(); else SFX.lose();
    /* 終局運鏡：鏡頭滑向沉沒的母艦，緩慢環繞（配慢動作與連環爆） */
    fb = fb || (won ? this.enemyBase : this.playerBase);
    if (fb && typeof Cam !== 'undefined') {
      Cam.follow = false;
      Cam.target.set(fb.pos.x, 0, fb.pos.z);
      Cam._animTo = { pitch: 0.5, dist: 760, t: 0, rate: 1.5 };
      Cam.cinematic = true;
    }
    /* 防競態：1.8 秒內重開一局，殘留 timer 不得把舊結算蓋到新局上 */
    clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => { if (this.over) UI.showEnd(this.won); }, 1800);
  },

  /* ══════ 開火 ══════ */
  _nose(e) {
    return new THREE.Vector3(
      e.pos.x + Math.cos(e.yaw) * e.radius * 0.95,
      e.pos.y + (e.kind === 'bld' ? 12 : 0),
      e.pos.z + Math.sin(e.yaw) * e.radius * 0.95);
  },

  fireGun(e, wd, tgt) {
    const n = this._nose(e);
    const d = n.distanceTo(tgt.pos);
    const tl = d / wd.spd;
    const aim = new THREE.Vector3(
      tgt.pos.x + (tgt.vel ? tgt.vel.x * tl : 0),
      tgt.pos.y,
      tgt.pos.z + (tgt.vel ? tgt.vel.z * tl : 0));
    const dir = aim.sub(n).normalize();
    const sp = wd.spread || 0.02;
    dir.x += U.rand(-sp, sp); dir.y += U.rand(-sp, sp) * 0.4; dir.z += U.rand(-sp, sp);
    dir.normalize().multiplyScalar(wd.spd);
    this.projectiles.push({
      t: 'bullet', team: e.team, pos: n, vel: dir,
      dmg: wd.dmg * e.dmgMul * (1 + 0.1 * (e.vet || 0)), life: (wd.range / wd.spd) * 1.25, r: 2,
      alive: true, src: e, anti: wd.t === 'pd',
    });
    if (wd.t !== 'pd') FX.muzzle(n, TEAMS[e.team].hex, 7 + e.radius * 0.3);
    if (wd.t === 'pd') SFX.pd(n); else SFX.shoot(n);   // 帶位置：依離鏡頭距離決定音量／播放密度（sfx.js SFX.at）
  },

  firePlasma(e, wd, tgt) {
    const n = this._nose(e);
    const d = n.distanceTo(tgt.pos);
    const tl = d / wd.spd;
    const aim = new THREE.Vector3(
      tgt.pos.x + (tgt.vel ? tgt.vel.x * tl : 0), tgt.pos.y,
      tgt.pos.z + (tgt.vel ? tgt.vel.z * tl : 0));
    const dir = aim.sub(n).normalize().multiplyScalar(wd.spd);
    this.projectiles.push({
      t: 'plasma', team: e.team, pos: n, vel: dir,
      dmg: wd.dmg * e.dmgMul * (1 + 0.1 * (e.vet || 0)), life: (wd.range / wd.spd) * 1.3, r: 6,
      alive: true, src: e,
    });
    FX.muzzle(n, TEAMS[e.team].hex, 16);
    SFX.plasma(n);
  },

  /* 齊射走遊戲時間佇列：暫停凍結不丟彈、2×速節奏正確、重開局自動歸零 */
  fireMissiles(e, wd, tgt) {
    this.salvos.push({ e, wd, tgt, left: wd.salvo || 1, t: 0 });
  },
  _updSalvos(dt) {
    for (const s of this.salvos) {
      s.t -= dt;
      if (s.t > 0) continue;
      if (!s.e.alive) { s.left = 0; continue; }
      const t2 = (s.tgt && s.tgt.alive) ? s.tgt : s.e.target;
      if (!t2 || !t2.alive) { s.left = 0; continue; }
      this._spawnMissile(s.e, s.wd, t2);
      s.left--; s.t = 0.16;
    }
    this.salvos = this.salvos.filter(s => s.left > 0);
  },
  _spawnMissile(e, wd, t2) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const yaw = e.yaw + side * U.rand(0.5, 1.6);
    const p = {
      t: 'missile', team: e.team,
      pos: new THREE.Vector3(e.pos.x, e.pos.y + 4, e.pos.z),
      vel: new THREE.Vector3(),
      yaw, spd: 150, maxSpd: wd.spd, turnR: wd.turnR,
      dmg: wd.dmg * e.dmgMul * (1 + 0.1 * (e.vet || 0)), life: 6.5, r: 4, hp: 1,
      wob: U.rand(U.TAU), target: t2, alive: true, src: e,
      ribbon: FX.ribbonAcquire(TEAMS[e.team].hex, 40, 0.8), rt: 0,
    };
    this.projectiles.push(p);
    SFX.missile(e.pos);
  },

  fireBeam(e, wd, tgt) {
    const fx = FX.beamAcquire();
    this.beams.push({
      src: e, tgt, dps: wd.dps * e.dmgMul * (1 + 0.1 * (e.vet || 0)), t: wd.dur, max: wd.dur,
      heavy: !!wd.heavy, fx, tick: 0,
    });
    SFX.beam(e.pos);
  },

  pdTarget(e, range) {
    let best = null, bs = range * range;
    for (const p of this.projectiles) {
      if (p.t !== 'missile' || !p.alive || p.team === e.team) continue;
      const d2 = U.dist2XZ(e.pos, p.pos);
      if (d2 < bs) { bs = d2; best = p; }
    }
    if (best) return best;
    bs = range * range;
    for (let t = 0; t < TEAMS.length; t++) {
      if (t === e.team) continue;
      for (const s of this.teams[t]) {
        if (!s.def.small) continue;
        const d2 = U.dist2XZ(e.pos, s.pos);
        if (d2 < bs) { bs = d2; best = s; }
      }
    }
    return best;
  },

  /* ══════ 主更新 ══════ */
  update(dt) {
    if (this.over) dt *= 0.35;
    this.time += dt;
    this._rebuild();

    /* 經濟（收入顯示＝真收入：被動＋卸礦入帳，不再被支出歸零） */
    const passive = (this.playerBase && this.playerBase.alive ? BLDS.base.income : 0) * dt;
    this.credits += passive;
    this._earnAcc += passive;
    this._incTrack.t += dt;
    if (this._incTrack.t >= 2) {
      this.incomeShown = this._earnAcc / this._incTrack.t;
      this._earnAcc = 0;
      this._incTrack.t = 0;
    }

    for (const e of this.ents) {
      if (!e.alive) continue;
      if (e.kind === 'ship') this._updShip(e, dt);
      else if (e.kind === 'bld') this._updBld(e, dt);
      else if (e.kind === 'ast') {
        e.mesh.rotation.y += e.spinA * dt;
        e.mesh.rotation.x += e.spinA * 0.37 * dt;
        if (e.depleted) this._updDepleted(e, dt);
        /* 殘骸：限時存在，末段縮小消失 */
        if (e.wreck) {
          e.wreckT -= dt;
          if (e.wreckT < 8) e.mesh.scale.setScalar(Math.max(0.15, e.wreckT / 8));
          if (e.wreckT <= 0 || e.ore <= 0) {
            e.alive = false;
            this.selection.delete(e);
            this.pickRoot.remove(e.mesh);
            e.mesh.traverse(o => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
            if (e.wreckMat) e.wreckMat.dispose();
            this._deadDirty = true;
          }
        }
      }
    }
    this._separate(dt);
    this._updProjectiles(dt);
    this._updBeams(dt);
    this._updSalvos(dt);
    this._updBooms(dt);
    if (!this.over) AI.updateAll(this, dt);
    if (this._deadDirty) {
      this._deadDirty = false;
      this.ents = this.ents.filter(e => e.alive);
      this.asts = this.asts.filter(a => a.alive);
    }
    /* 中盤事件：富礦隕石（小地圖會自動標記） */
    if (!this.over) {
      this._cometT -= dt;
      if (this._cometT <= 0) {
        this._cometT = EVENTS.cometGap;
        const f = U.pick(this.fields);
        const a2 = U.rand(U.TAU);
        const w = this.mkAst(f[0] + Math.cos(a2) * U.rand(150, 380), f[1] + Math.sin(a2) * U.rand(120, 300), 46, EVENTS.cometOre);
        this.oreTotal += EVENTS.cometOre;
        /* 10-07 修：原本訊息說「已標記於小地圖」但從沒畫過標記。現在：隕石掛 comet 旗標（小地圖金色大點＋浮標、
           標記期 120 秒內小地圖脈動 ☄ 圈、N 鍵可跳轉；感測器偵測，不受迷霧遮蔽） */
        w.comet = true; w.name = '富礦隕石'; w.def = { name: '富礦隕石' };
        this.cometMark = { x: w.pos.x, z: w.pos.z, ast: w, until: this.time + EVENTS.cometMarkSecs };
        UI.alertMsg('☄ 感測器：富礦隕石落點已標記（小地圖金色 ☄）——按 N 前往！');
        UI.toast('☄ 富礦隕石 ' + U.fmt(EVENTS.cometOre) + ' 星礦落在小地圖金色 ☄ 處（橫幅若被敵襲蓋掉，看這裡）', 'gold');   // 橫幅常被同時發生的敵襲警報蓋掉，toast 多留一份
        FX.explode(w.pos, 30, 0x8ef5d8);
      }
    }
    if (!this.over) this._updPirates(dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - 1.6 * dt);

    if (typeof Fog !== 'undefined') Fog.update(dt);   // 戰爭迷霧：視野蓋章（每 0.2 秒）＋敵方可見狀態（要在 FX 同步彈道之前）
    FX.syncBullets(this.projectiles);
    FX.syncProjectileSprites(this.projectiles);
  },

  /* ── 艦艇更新 ── */
  _updShip(e, dt) {
    const def = e.def;
    /* 護盾再生（老兵 +50%/級） */
    if (e.shield < e.maxShield && this.time - e.lastHit > 3) {
      e.shield = Math.min(e.maxShield, e.shield + e.regen * (1 + 0.5 * (e.vet || 0)) * this._shdMul(e.team) * dt);
    }
    /* 回港維修：脫戰 5 秒後靠近母艦/精煉站自動付費修理（撤退的報酬＋後期錢坑） */
    if (e.team === 0 && e.hull < e.maxHull && this.time - e.lastHit > REPAIR.delay && this.credits > 0) {
      const dk = this._nearestDropoff(e);
      if (dk) {
        const rr = dk.radius + REPAIR.range;
        if (U.dist2XZ(e.pos, dk.pos) < rr * rr) {
          const rk = this.upgrades.rep ? 1.6 : 1, ck = this.upgrades.rep ? 0.6 : 1;   // 維修工程
          const unitCost = e.def.cost > 0 ? REPAIR.costMul * ck * e.def.cost / e.def.hull : 0;
          const heal = Math.min(e.maxHull * REPAIR.rate * rk * dt, e.maxHull - e.hull,
            unitCost > 0 ? this.credits / unitCost : e.maxHull);
          e.hull += heal;
          this.credits -= heal * unitCost;
          if (Math.random() < dt * 3) FX.burst(e.pos.clone().setY(e.pos.y + 6), 2, 0x7ef29a, 60);
        }
      }
    }
    if (def.eco) { this._updHarv(e, dt); this._syncMesh(e, dt); return; }

    /* 鎖敵 */
    e.retargetT -= dt;
    if (e.retargetT <= 0) { e.retargetT = 0.4 + Math.random() * 0.25; this._acquire(e); }
    if (e.target && !e.target.alive) e.target = null;

    let thrust = 0, wantYaw = e.yaw;
    const ord = e.order;
    if (ord && ord.t === 'move') {
      const d = U.distXZ(e.pos, ord);
      if (d < 50 + e.radius || this._stalled(e, ord, d, dt)) e.order = null;
      else { wantYaw = U.yawTo(e.pos, ord); thrust = this._brake(e, d) ? 0 : 1; }
    } else if (ord && ord.t === 'amove') {
      if (e.target && U.distXZ(e.pos, e.target.pos) < 850) {
        const r2 = this._engage(e, dt);
        wantYaw = r2.yaw; thrust = r2.thrust;
      } else {
        const d = U.distXZ(e.pos, ord);
        if (d < 120 + e.radius || this._stalled(e, ord, d, dt)) e.order = null;
        else { wantYaw = U.yawTo(e.pos, ord); thrust = this._brake(e, d) ? 0 : 1; }
      }
    } else if (ord && ord.t === 'patrol') {
      /* 巡邏：路線附近有敵人就接戰；追離路線超過 leash 就放棄、冷卻幾秒，回路線續巡 */
      const prev = ord.pts[ord.i - ord.dir] || ord.pts[ord.i];
      const off = this._segDist(e.pos, prev, ord.pts[ord.i]);
      if (ord.cool > 0) ord.cool -= dt;
      let fight = false;
      if (e.target && ord.cool <= 0 && U.distXZ(e.pos, e.target.pos) < PATROL.engage) {
        if (off < (ord.engaged ? PATROL.leash : PATROL.start)) fight = true;
        else if (ord.engaged) { ord.cool = PATROL.cool; e.target = null; }
      }
      ord.engaged = fight;
      if (fight) {
        const r2 = this._engage(e, dt);
        wantYaw = r2.yaw; thrust = r2.thrust;
        ord.best = Infinity;
      } else {
        const p = ord.pts[ord.i];
        const d = U.distXZ(e.pos, p);
        /* 卡住判定不能用共用的 _stalled（2 秒）：掉頭時距離會先變大，慢船掉頭要 π/turn 秒，
           會被誤判成「到了」而提早折返。這裡給 3 秒＋掉頭時間 */
        if (!(d < ord.best - 1)) ord.st = (ord.st || 0) + dt;
        else { ord.best = d; ord.st = 0; }
        if (d < PATROL.arrive + e.radius || ord.st > 3 + Math.PI / def.turn) {
          /* 來回：走到路線盡頭就反向 */
          ord.i += ord.dir;
          if (ord.i >= ord.pts.length) { ord.dir = -1; ord.i = ord.pts.length - 2; }
          else if (ord.i < 0) { ord.dir = 1; ord.i = 1; }
          ord.best = Infinity; ord.st = 0;
        }
        wantYaw = U.yawTo(e.pos, ord.pts[ord.i]); thrust = 1;
      }
    } else if (ord && ord.t === 'hold') {
      /* 駐守：被推離錨點 120 才走回去，其餘只轉向開火、絕不追擊 */
      if (U.distXZ(e.pos, ord) > 120) { wantYaw = U.yawTo(e.pos, ord); thrust = 1; }
      else if (e.target) { wantYaw = U.yawTo(e.pos, e.target.pos); thrust = 0; }
    } else if (e.target) {
      const r2 = this._engage(e, dt);
      wantYaw = r2.yaw; thrust = r2.thrust;
    } else {
      /* 待命：減速漂浮 */
      thrust = 0;
    }

    /* 運動整合 */
    const spd = def.speed * (e.spdMul || 1);
    e.yaw = U.turnToward(e.yaw, wantYaw, def.turn * dt);
    if (thrust !== 0) {
      const acc = spd * 1.8 * thrust;
      e.vel.x += Math.cos(e.yaw) * acc * dt;
      e.vel.z += Math.sin(e.yaw) * acc * dt;
    } else {
      const dr = Math.pow(0.4, dt);
      e.vel.x *= dr; e.vel.z *= dr;
    }
    const cur = Math.hypot(e.vel.x, e.vel.z);
    if (cur > spd) { e.vel.x *= spd / cur; e.vel.z *= spd / cur; }
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    e.pos.x = U.clamp(e.pos.x, -MAP.W, MAP.W);
    e.pos.z = U.clamp(e.pos.z, -MAP.H, MAP.H);
    e.thrusting = Math.abs(thrust);

    /* 武器 */
    for (const w of e.weapons) {
      const wd = w.d;
      w.cd -= dt;
      if (w.cd > 0) continue;
      let tgt = null;
      if (wd.t === 'pd') tgt = this.pdTarget(e, wd.range);
      else if (e.target && e.target.alive) {
        const rr = wd.range + (e.target.kind === 'bld' ? e.target.radius : 0);
        if (U.dist2XZ(e.pos, e.target.pos) <= rr * rr) tgt = e.target;
      }
      if (!tgt) { w.cd = 0.13; continue; }
      if (wd.t === 'gun' && def.small) {
        const aim = U.yawTo(e.pos, tgt.pos);
        if (Math.abs(U.angDiff(e.yaw, aim)) > 0.45) { w.cd = 0.07; continue; }
      }
      switch (wd.t) {
        case 'gun': case 'pd': this.fireGun(e, wd, tgt); break;
        case 'plasma': this.firePlasma(e, wd, tgt); break;
        case 'missile': this.fireMissiles(e, wd, tgt); break;
        case 'beam': this.fireBeam(e, wd, tgt); break;
      }
      w.cd = wd.cd * U.rand(0.92, 1.12);
    }

    /* 航母機庫 */
    if (def.hangar) {
      e.hangT -= dt;
      if (e.hangT <= 0) {
        e.hangT = def.hangar.cd;
        let drones = 0;
        for (const s of this.teams[e.team]) if (s.cls === 'drone' && s.parent === e) drones++;
        if (drones < def.hangar.max) {
          const d = this.mkShip('drone', e.team, e.pos.x - Math.cos(e.yaw) * 30, e.pos.z - Math.sin(e.yaw) * 30);
          d.parent = e;
          this._rebuild();
        }
      }
    }
    this._syncMesh(e, dt);
  },

  _engage(e, dt) {
    const t = e.target, def = e.def;
    const d = U.distXZ(e.pos, t.pos);
    if (def.small) {
      e.orbitPhase += e.orbitDir * dt * (def.speed / (e.prefRange * 0.85));
      const ox = t.pos.x + Math.cos(e.orbitPhase) * e.prefRange * 0.8;
      const oz = t.pos.z + Math.sin(e.orbitPhase) * e.prefRange * 0.8;
      return {
        yaw: d > e.prefRange * 2.4 ? U.yawTo(e.pos, t.pos) : U.yawTo(e.pos, { x: ox, z: oz }),
        thrust: 1,
      };
    }
    const pref = e.prefRange + (t.kind === 'bld' ? t.radius * 0.7 : 0);
    let thrust = 0;
    if (d > pref) thrust = 1;
    else if (d < pref * 0.55) thrust = -0.35;
    else thrust = 0.12;
    return { yaw: U.yawTo(e.pos, t.pos), thrust };
  },

  _acquire(e) {
    if (e.order && e.order.t === 'attack') {
      const t = e.order.ent;
      if (t && t.alive) { e.target = t; return; }
      e.order = null;
    }
    const acq = 1500;
    if (e.target && e.target.alive && U.dist2XZ(e.pos, e.target.pos) < acq * acq * 1.7) return;
    let best = null, bs = Infinity;
    for (const h of this.hostilesOf(e.team)) {
      let d2 = U.dist2XZ(e.pos, h.pos);
      if (d2 > acq * acq) continue;
      if (h.kind === 'bld') d2 *= (h.cls === 'tur' ? 1.15 : 1.7);
      else {
        if (e.def.small && h.def.small) d2 *= 0.6;
        /* 攔截機剋採礦船（tip 寫的相剋這次是真的） */
        if (h.def.eco) d2 *= (e.def.small ? 0.45 : 0.8);
      }
      if (d2 < bs) { bs = d2; best = h; }
    }
    e.target = best;
  },

  /* 繞石：前方路線上有小行星擋住，就把航向往側邊偏（偏向離石頭較遠那一側）。
     沒有這個，直線衝刺＋分離推力會互相抵銷，船就卡在石頭前面不動 */
  _avoidRocks(e, tx, tz, d, ignore) {
    let dx = tx - e.pos.x, dz = tz - e.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    let sx = 0, sz = 0;
    const look = Math.min(d, 220);
    for (const a of this.asts) {
      if (!a.alive || a.depleted || a === ignore) continue;
      const ax = a.pos.x - e.pos.x, az = a.pos.z - e.pos.z;
      const proj = ax * dx + az * dz;                // 沿航線的前方距離
      if (proj <= 0 || proj > look + a.radius) continue;
      const lat = ax * dz - az * dx;                 // 側向距離；>0＝石頭在左法向 (-dz,dx) 的反側
      const clear = e.radius + a.radius + 30;
      if (Math.abs(lat) >= clear) continue;
      const w = (1 - Math.abs(lat) / clear) * (1.4 - 0.8 * Math.min(1, proj / (look + a.radius)));
      const side = lat >= 0 ? 1 : -1;               // 往石頭的反側偏
      sx += -dz * side * w; sz += dx * side * w;
    }
    return Math.atan2(dz + sz * 1.8, dx + sx * 1.8);
  },
  /* 繞路選邊：航線左右兩側 300 內，哪邊擋路的石頭少走哪邊；一樣多就看船 id 固定偏好 */
  _openSide(e, dx, dz, ignore) {
    let l = 0, r = 0;
    for (const a of this.asts) {
      if (!a.alive || a.depleted || a === ignore) continue;
      const ax = a.pos.x - e.pos.x, az = a.pos.z - e.pos.z;
      if (ax * ax + az * az > 300 * 300) continue;
      if (-ax * dz + az * dx > 0) l += a.radius; else r += a.radius;
    }
    if (Math.abs(l - r) < 5) return e.id % 2 ? 1 : -1;
    return l < r ? 1 : -1;                          // +1＝往左法向 (-dz,dx) 繞
  },
  /* ── 採礦船 ── */
  _stopMining(e) {
    if (e.mineFx) { FX.mineBeamRelease(e.mineFx); e.mineFx = null; }
  },
  _updHarv(e, dt) {
    const rate = e.def.mineRate * (1 + 0.3 * this.upgrades.mine) * (e.team !== 0 ? 0.8 : 1);
    if (e.state === 'manual') {
      /* 手動移動中 */
      if (!e.order) { e.state = 'toField'; e.manualT = 0; }
    }
    if (e.state === 'idle' || e.state === 'toField') {
      if (!e.mineTarget || !e.mineTarget.alive || e.mineTarget.ore <= 0) {
        e.mineTarget = this._nearestOre(e);
      }
      if (!e.mineTarget) { e.state = 'idle'; this._drift(e, dt); this._syncMesh(e, dt); return; }
      e.state = 'toField';
      const t = e.mineTarget;
      const d = this._moveToward(e, t.pos.x, t.pos.z, dt, t.radius + 42, t);
      /* 門檻 +80：第二圈（分離地板 size+74）也採得到，不會擠不進去乾瞪眼 */
      if (d < t.radius + 80) { e.state = 'mining'; e.vel.x *= 0.2; e.vel.z *= 0.2; }
    } else if (e.state === 'mining') {
      const t = e.mineTarget;
      if (!t || t.ore <= 0) { this._stopMining(e); e.state = 'toField'; e.mineTarget = null; }
      else {
        e.yaw = U.turnToward(e.yaw, U.yawTo(e.pos, t.pos), 2 * dt);
        e.thrusting = 0;
        if (!e.mineFx) e.mineFx = FX.mineBeamAcquire();
        if (e.mineFx) FX.mineBeamSet(e.mineFx, this._nose(e), t.pos);
        const take = Math.min(rate * dt, t.ore, this.cargoCap(e) - e.cargo);
        t.ore -= take; e.cargo += take;
        SFX.mine();
        if (Math.random() < dt * 8) FX.burst(t.pos.clone().add(new THREE.Vector3(U.rand(-10, 10), U.rand(0, 14), U.rand(-10, 10))), 2, 0x8ef5d8, 70);
        if (t.ore <= 0) this._depleteAst(t);
        if (e.cargo >= this.cargoCap(e) - 0.5 || t.ore <= 0) {
          this._stopMining(e);
          e.state = 'toBase';
        }
      }
    } else if (e.state === 'toBase') {
      const drop = this._nearestDropoff(e);
      if (!drop) { this._drift(e, dt); this._syncMesh(e, dt); return; }
      const d = this._moveToward(e, drop.pos.x, drop.pos.z, dt, drop.radius + 50);
      if (d < drop.radius + 56) {
        if (e.team === 0) {
          const gain = e.cargo * (1 + 0.2 * this.upgrades.ref);   // 精煉效率
          this.credits += gain;
          this._earnAcc += gain;
          this.mined += e.cargo;
          this.stats.mined += e.cargo;
          SFX.unload();
          if (typeof UI !== 'undefined') UI.addFloat(drop.pos, `+${Math.round(e.cargo)} 💎`);
        }
        e.cargo = 0;
        e.state = 'toField';
      }
    } else {
      /* manual：執行移動指令（停滯自動解除，防點到建築/礦上永久卡死） */
      if (e.order && e.order.t === 'move') {
        e.manualT = (e.manualT || 0) + dt;
        const d = this._moveToward(e, e.order.x, e.order.z, dt, 40);
        if (d < 50 || this._stalled(e, e.order, d, dt)) { e.order = null; e.state = 'toField'; e.manualT = 0; }
      }
    }
  },
  /* 到站煞車：關推力後阻尼 0.4^t 的滑行距離＝速度×1/ln2.5≈1.09×速度。
     剩餘距離小於滑行距離就提早收油，否則快船會衝過目的地 150+、陣型全亂 */
  _brake(e, d) {
    const v = Math.hypot(e.vel.x, e.vel.z);
    return d < v * 1.09;
  },
  /* 點到線段（XZ）的距離：巡邏 leash 用 */
  _segDist(p, a, b) {
    const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
    let t = L > 0 ? ((p.x - a.x) * vx + (p.z - a.z) * vz) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p.x - a.x - vx * t, p.z - a.z - vz * t);
  },
  /* 停滯偵測：同一張指令連續 ~2 秒沒有更接近目標＝視同到達。
     以 order 物件身份當 key，換新指令自動歸零，不需外部重置。 */
  _stalled(e, ord, d, dt) {
    if (e._stOrd !== ord || d < e._stBest - 1) {
      e._stOrd = ord; e._stBest = d; e._stT = 0;
      return false;
    }
    e._stT += dt;
    return e._stT > 2;
  },
  _nearestOre(e) {
    /* 佔用懲罰：已有人採的礦，距離平方 ×(1+2×人數)，讓船群自動散開 */
    let best = null, bs = Infinity;
    for (const a of this.asts) {
      if (a.ore <= 0) continue;
      let occ = 0;
      for (const s of this.teams[e.team]) {
        if (s !== e && s.def.eco && s.mineTarget === a) occ++;
      }
      const d2 = U.dist2XZ(e.pos, a.pos) * (1 + 2 * occ);
      if (d2 < bs) { bs = d2; best = a; }
    }
    return best;
  },
  _nearestDropoff(e) {
    let best = null, bs = Infinity;
    for (const b of this.blds[e.team]) {
      if (!b.def.dropoff || b.buildT > 0) continue;
      const d2 = U.dist2XZ(e.pos, b.pos);
      if (d2 < bs) { bs = d2; best = b; }
    }
    return best;
  },
  /* 採空：礦晶熄滅、岩石變暗並縮小、碰撞範圍跟著縮（不再擋路），DEPLETE.life 秒後淡出移除 */
  _depleteAst(a) {
    a.ore = 0;
    if (a.mesh.userData.crystals) a.mesh.userData.crystals.visible = false;
    if (a.wreck || a.depleted) return;           // 殘骸另有自己的消失流程
    a.depleted = true; a.depT = 0;
    a.radius *= DEPLETE.shrink;
    a.depS0 = a.mesh.scale.x;
    const rock = a.mesh.children[0];
    if (rock && rock.isMesh) {
      rock.material = rock.material.clone();     // 各顆自己的材質，才能各自淡出
      rock.material.color.setHex(0x52565c).convertSRGBToLinear();   // 暗灰（0x2c3036 在月岩上變全黑一塊）
      rock.material.transparent = true;
      a.depMat = rock.material;
    }
  },
  _updDepleted(e, dt) {
    e.depT += dt;
    const L = DEPLETE.life, F = DEPLETE.fade;
    /* 前 1.2 秒縮到 shrink 倍，最後 F 秒再縮小＋淡出 */
    let k = 1 - (1 - DEPLETE.shrink) * Math.min(1, e.depT / 1.2);
    if (e.depT > L) {
      const f = Math.min(1, (e.depT - L) / F);
      k *= 1 - 0.7 * f;
      if (e.depMat) e.depMat.opacity = 1 - f;
    }
    e.mesh.scale.setScalar(e.depS0 * k);
    if (e.depT > L + F) {
      e.alive = false;
      this.selection.delete(e);
      this.pickRoot.remove(e.mesh);
      e.mesh.traverse(o => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
      if (e.depMat) e.depMat.dispose();
      this._deadDirty = true;
    }
  },
  _drift(e, dt) {
    const dr = Math.pow(0.4, dt);
    e.vel.x *= dr; e.vel.z *= dr;
    e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt;
    e.thrusting = 0;
  },
  /* ignore＝目的地本身的小行星（要靠近它，不能繞開它） */
  _moveToward(e, tx, tz, dt, stopAt, ignore) {
    const d = U.distXZ(e.pos, { x: tx, z: tz });
    const spd = e.def.speed * (e.spdMul || 1);
    /* 卡住自動繞路：「在推進、速度卻幾乎是零」連續 0.8 秒＝被石牆擋住（掉頭轉向時有速度，不會誤判）。
       沿著牆往同一側找繞路點；同一目的地連續卡住就一次比一次繞得更遠，真的前進了就歸零 */
    if (e._mvTx !== tx || e._mvTz !== tz) { e._mvTx = tx; e._mvTz = tz; e._mvBest = d; e._mvT = 0; e._detN = 0; e.detour = null; }
    if (d < e._mvBest - 60) { e._mvBest = d; e._detN = 0; }
    /* 用「上一幀到這一幀實際位移」量速度：被石頭推回去時 vel 仍是滿的，只有實際位移看得出卡住 */
    const realSpd = e._lpx === undefined ? spd : Math.hypot(e.pos.x - e._lpx, e.pos.z - e._lpz) / Math.max(dt, 1e-4);
    const blocked = d > stopAt + 20 && realSpd < spd * 0.2;
    e._lpx = e.pos.x; e._lpz = e.pos.z;   // 每幀開頭記位置：兩幀開頭相減＝自己推進＋被推回的淨位移
    e._mvT = blocked ? e._mvT + dt : 0;
    if (e.detour) {
      e.detour.t -= dt;
      if (e.detour.t <= 0 || U.distXZ(e.pos, e.detour) < 30) { e.detour = null; e._mvBest = Math.min(e._mvBest, d); }
    }
    if (!e.detour && e._mvT > 0.8) {
      const dx = (tx - e.pos.x) / (d || 1), dz = (tz - e.pos.z) / (d || 1);
      if (!e._detN) e._detSide = this._openSide(e, dx, dz, ignore);
      e._detN++;
      const off = 140 + 90 * e._detN, side = e._detSide;
      e.detour = { x: e.pos.x - dz * side * off + dx * 40, z: e.pos.z + dx * side * off + dz * 40, t: 2.2 };
      e._mvT = 0;
    }
    const gx = e.detour ? e.detour.x : tx, gz = e.detour ? e.detour.z : tz;
    const steer = this._avoidRocks(e, gx, gz, e.detour ? U.distXZ(e.pos, e.detour) : d, ignore);
    e.yaw = U.turnToward(e.yaw, steer, e.def.turn * dt);
    if (d > stopAt) {
      e.vel.x += Math.cos(e.yaw) * spd * 1.8 * dt;
      e.vel.z += Math.sin(e.yaw) * spd * 1.8 * dt;
      e.thrusting = 1;
    } else {
      const dr = Math.pow(0.25, dt);
      e.vel.x *= dr; e.vel.z *= dr;
      e.thrusting = 0.2;
    }
    const cur = Math.hypot(e.vel.x, e.vel.z);
    if (cur > spd) { e.vel.x *= spd / cur; e.vel.z *= spd / cur; }
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    return d;
  },

  /* ── 建築更新 ── */
  _updBld(e, dt) {
    /* 施工 */
    if (e.buildT > 0) {
      e.buildT -= dt;
      e.hull = Math.min(e.maxHull, e.hull + (e.maxHull * 0.75 / e.buildTotal) * dt);
      e.mesh.scale.y = 0.15 + 0.85 * (1 - e.buildT / e.buildTotal);
      if (e.buildT <= 0) {
        e.mesh.scale.y = 1;
        SFX.done();
        if (e.team === 0) UI.toast(`${e.name} 建造完成`);
        FX.burst(e.pos.clone().setY(20), 14, TEAMS[e.team].hex, 120);
      }
      return;
    }
    if (e.shield < e.maxShield && this.time - e.lastHit > 3) {
      e.shield = Math.min(e.maxShield, e.shield + e.regen * this._shdMul(e.team) * dt);
    }
    /* 生產佇列 */
    if (e.queue.length) {
      const q = e.queue[0];
      q.t -= dt;
      if (q.t <= 0) {
        e.queue.shift();
        /* 從船塢「面向地圖中央」那側出廠（team 0 朝 +x、team 1 朝 -x，與舊版相同） */
        const fy = this.teamYaw(e.team), fx = Math.cos(fy), fz = Math.sin(fy), off = U.rand(-40, 40);
        const s = this.mkShip(q.cls, e.team, e.pos.x + fx * (e.radius + 45) - fz * off, e.pos.z + fz * (e.radius + 45) + fx * off);
        s.yaw = fy;
        if (q.cls === 'harv') s.state = 'toField';
        /* 集結點：戰鬥艦攻擊移動前往；採礦船直奔指定礦（走 mineTarget 狀態機，不會卡） */
        if (e.rally) {
          if (s.def.eco) { if (e.rally.ast && e.rally.ast.alive && e.rally.ast.ore > 0) s.mineTarget = e.rally.ast; }
          else if (e.rally.x !== undefined) s.order = { t: 'amove', x: e.rally.x + U.rand(-40, 40), z: e.rally.z + U.rand(-40, 40) };
        }
        if (e.team === 0) { SFX.done(); UI.toast(`${SHIPS[q.cls].name} 出廠`); }
        this._rebuild();
      }
    }
    /* 研究 */
    if (e.research) {
      e.research.t -= dt;
      if (e.research.t <= 0) {
        const id = e.research.id;
        e.research = null;
        this.researchDone.add(id);
        this._applyUpgrade(id);
        SFX.research();
        UI.toast(`研究完成 — ${UPGRADES.find(u => u.id === id).name}`, 'gold');
      }
    }
    /* 砲塔 / 基地 PD */
    if (e.weapons.length) {
      e.retargetT -= dt;
      if (e.retargetT <= 0) {
        e.retargetT = 0.5;
        let best = null, bs = 800 * 800;
        this._eachHostileShip(e.team, h => {
          const d2 = U.dist2XZ(e.pos, h.pos);
          if (d2 < bs) { bs = d2; best = h; }
        });
        e.target = best;
      }
      if (e.target && !e.target.alive) e.target = null;
      if (e.target && e.mesh.userData.head) {
        e.headYaw = U.turnToward(e.headYaw, U.yawTo(e.pos, e.target.pos), 2.6 * dt);
        e.mesh.userData.head.rotation.y = -e.headYaw - e.mesh.rotation.y;
      }
      for (const w of e.weapons) {
        const wd = w.d;
        w.cd -= dt;
        if (w.cd > 0) continue;
        let tgt = null;
        if (wd.t === 'pd') tgt = this.pdTarget(e, wd.range);
        else if (e.target && e.target.alive && U.dist2XZ(e.pos, e.target.pos) <= wd.range * wd.range) tgt = e.target;
        if (!tgt) { w.cd = 0.15; continue; }
        const save = e.yaw;
        e.yaw = e.headYaw !== undefined ? e.headYaw : U.yawTo(e.pos, tgt.pos);
        if (wd.t === 'plasma') this.firePlasma(e, wd, tgt);
        else this.fireGun(e, wd, tgt);
        e.yaw = save;
        w.cd = wd.cd * U.rand(0.92, 1.12);
      }
    }
    /* 建築運轉動畫：母艦環/研究環旋轉、船塢信標閃爍、精煉站脈動 */
    const ud = e.mesh.userData;
    if (ud.ring) ud.ring.rotation.y += 0.1 * dt;
    if (ud.spin) ud.spin.rotation.y += 0.8 * dt;
    if (ud.beacon) ud.beacon.visible = (this.time * 1.4 + e.id * 0.37) % 1 < 0.55;
    if (ud.pulse) {
      const k2 = 1 + Math.sin(this.time * 2.6 + e.id) * 0.3;
      for (const s of ud.pulse) s.scale.set(12 * k2, 12 * k2, 1);
    }
    /* 重損冒火花 */
    const hr = e.hull / e.maxHull;
    if (hr < 0.45 && Math.random() < dt * (1 - hr) * 14) {
      const a3 = U.rand(U.TAU), rr = e.radius * 0.6;
      FX.spark(new THREE.Vector3(e.pos.x + Math.cos(a3) * rr, e.pos.y + U.rand(6, 20), e.pos.z + Math.sin(a3) * rr),
        U.rand(8, 30), U.rand(0.3, 0.8), FX._ember || (FX._ember = new THREE.Color(0xff8844)));
    }
    this._hitFlashSync(e);
  },

  _applyUpgrade(id) {
    const u = this.upgrades;
    if (id.startsWith('wpn')) { u.wpn++; for (const s of this.teams[0]) s.dmgMul = 1 + 0.12 * u.wpn; }
    else if (id.startsWith('arm')) {
      u.arm++;
      for (const s of this.teams[0]) {
        const kH = s.hull / s.maxHull, kS = s.maxShield ? s.shield / s.maxShield : 0;
        s.maxHull = Math.round(SHIPS[s.cls].hull * (1 + 0.12 * u.arm));
        s.maxShield = Math.round((SHIPS[s.cls].shield || 0) * (1 + 0.12 * u.arm));
        s.hull = s.maxHull * kH; s.shield = s.maxShield * kS;
      }
    }
    else if (id.startsWith('mine')) u.mine++;
    else if (id.startsWith('fleet')) u.fleet++;
    else if (id.startsWith('eng')) { u.eng++; for (const s of this.teams[0]) s.spdMul = 1 + 0.1 * u.eng; }
    else if (id === 'cap1') u.cap = 1;
    else if (id === 'cap2') u.cap = 2;
    else if (id.startsWith('shd')) u.shd++;
    else if (id === 'rep1') u.rep = 1;
    else if (id === 'ref1') u.ref = 1;
    else if (id === 'outp1') u.outp = 1;
    else if (id.startsWith('def')) {
      u.def++;
      const k = this._defMul(0);
      for (const b of this.blds[0]) {
        const kH = b.hull / b.maxHull;
        b.maxHull = Math.round(b.def.hull * k); b.hull = b.maxHull * kH; b.dmgMul = k;
      }
    }
  },

  /* 受擊閃白：本體幾何疊一層 additive 白模，受擊 0.09 秒內顯示 */
  _hitFlashSync(e) {
    const hs = this.time - (e.hullHitT === undefined ? -9 : e.hullHitT);
    /* 合批的船：閃白改由 Batch 把該實例調亮，不另建白模（省 draw call） */
    const hull0 = e.mesh.children.find(o => o.isMesh);
    if (hull0 && hull0.userData.hull) { e._flash = hs < 0.09; return; }
    if (hs < 0.09) {
      if (!e.flashMesh) {
        const solid = e.mesh.children.find(o => o.isMesh);
        if (!solid) return;
        e.flashMesh = new THREE.Mesh(solid.geometry, Models.hitFlashMat);
        e.flashMesh.scale.setScalar(1.02);
        e.mesh.add(e.flashMesh);
      }
      e.flashMesh.visible = true;
    } else if (e.flashMesh) e.flashMesh.visible = false;
  },

  /* ── 網格同步 ── */
  _syncMesh(e, dt) {
    e.bob += dt;
    const y = e.baseY + Math.sin(e.bob * 1.4) * (e.def.small ? 6 : 2.5);
    e.pos.y = y;
    e.mesh.position.set(e.pos.x, y, e.pos.z);
    this._hitFlashSync(e);
    const hs = this.time - (e.hullHitT === undefined ? -9 : e.hullHitT);
    if (hs < 0.09) {
      /* 受擊抖動：mesh.position 每幀由 e.pos 重設，抖動不會累積 */
      const j = Math.min(3, e.radius * 0.12);
      e.mesh.position.x += U.rand(-j, j);
      e.mesh.position.z += U.rand(-j, j);
    }
    const bank = U.clamp(-U.angDiff(e.yaw, e._lastYaw === undefined ? e.yaw : e._lastYaw) * 26, -0.55, 0.55);
    e._lastYaw = e.yaw;
    e.mesh.rotation.y = -e.yaw;
    e.mesh.rotation.z = U.lerp(e.mesh.rotation.z, bank, Math.min(1, dt * 6));
    const eng = e.mesh.userData.engine;
    if (eng) {
      const k = 0.4 + e.thrusting * (0.8 + Math.sin(this.time * 26 + e.id) * 0.25);
      eng.scale.set(e.radius * 1.3 * k, e.radius * 1.3 * k, 1);
    }
    /* 引擎噴焰錐：加速時拖出抖動火舌、巡航短、漂浮熄 */
    const fl = e.mesh.userData.flame;
    if (fl) {
      fl.visible = e.thrusting > 0.05 && !fl.userData.off;
      if (fl.visible) {
        const flick = 0.75 + Math.sin(this.time * 31 + e.id * 1.7) * 0.25;
        const lenK = e.def.small ? 2.4 : 1.8;
        fl.scale.set(e.radius * (1.2 + lenK * e.thrusting) * flick, e.radius * 0.55, e.radius * 0.55);
      }
    }
    /* 重損冒火花：殘血單位看起來「快死了」，兼作戰場資訊 */
    const hr = e.hull / e.maxHull;
    if (hr < 0.45 && Math.random() < dt * (1 - hr) * 14) {
      const a3 = U.rand(U.TAU), rr = e.radius * 0.6;
      FX.spark(new THREE.Vector3(e.pos.x + Math.cos(a3) * rr, y + U.rand(0, 6), e.pos.z + Math.sin(a3) * rr),
        U.rand(8, 30), U.rand(0.3, 0.8), FX._ember || (FX._ember = new THREE.Color(0xff8844)));
    }
    /* 護盾受擊光罩 */
    const since = this.time - e.lastHit;
    if (since < 0.3 && e.maxShield > 0 && e.shield > 0) {
      if (!e.shieldMesh) {
        /* 共用單位球＋每陣營一份材質（合批：同一批畫完），大小靠 scale，淡出靠 instK */
        if (!this._shGeo) {
          this._shGeo = new THREE.SphereGeometry(1, 14, 10);
          this._shMat = TEAMS.map(T => new THREE.MeshBasicMaterial({
            color: T.hex, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.18, depthWrite: false,
          }));
        }
        e.shieldMesh = new THREE.Mesh(this._shGeo, this._shMat[e.team]);
        e.shieldMesh.scale.setScalar(e.radius * 1.35);
        e.mesh.add(e.shieldMesh);
        if (typeof Batch !== 'undefined') Batch.addMesh(e.shieldMesh);
      }
      e.shieldMesh.visible = true;
      e.shieldMesh.userData.instK = 1 - since / 0.3;
    } else if (e.shieldMesh) e.shieldMesh.visible = false;
    /* 小型艦光尾 */
    if (e.ribbon && e.thrusting > 0.1) {
      e._rt = (e._rt || 0) - dt;
      if (e._rt <= 0) { e._rt = 0.04; e.ribbon.push(e.pos.x - Math.cos(e.yaw) * e.radius, y, e.pos.z - Math.sin(e.yaw) * e.radius); }
    }
  },

  /* ── 彈道 ── */
  _updProjectiles(dt) {
    /* 敵表提升到迴圈外：大混戰時每顆彈每幀複製陣列是最大 GC 熱點 */
    /* 命中判定用格子：每顆彈只查附近的敵人，不再掃全部（每個勢力一張，用到才建；含星盜 team 3） */
    const foeGrid = new Array(TEAMS.length).fill(null);
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; if (p.ribbon) p.ribbon.release(); continue; }
      if (p.t === 'missile') {
        if (p.target && !p.target.alive) p.target = null;
        if (p.target) {
          p.yaw = U.turnToward(p.yaw, U.yawTo(p.pos, p.target.pos), p.turnR * dt);
          p.pos.y += (p.target.pos.y + 4 - p.pos.y) * Math.min(1, dt * 2.2);
        }
        p.yaw += Math.sin(this.time * 3.1 + p.wob) * 1.6 * dt;
        p.spd = Math.min(p.maxSpd, p.spd + 340 * dt);
        p.vel.set(Math.cos(p.yaw) * p.spd, 0, Math.sin(p.yaw) * p.spd);
        p.rt -= dt;
        if (p.rt <= 0) { p.rt = 0.022; p.ribbon.push(p.pos.x, p.pos.y, p.pos.z); }
        /* 飛彈煙尾：灰白煙＋偶爾一點火星 */
        p.st = (p.st || 0) - dt;
        if (p.st <= 0) {
          p.st = 0.03;
          FX.trail(p.pos, this._smokeC || (this._smokeC = new THREE.Color(0x8a8f99)), U.rand(0.5, 0.9), 2);
          if (Math.random() < 0.35) FX.trail(p.pos, this._fireC || (this._fireC = new THREE.Color(0xffa040)), 0.2, 1);
        }
      } else if (p.t === 'plasma') {
        /* 電漿光尾：陣營色殘光 */
        p.st = (p.st || 0) - dt;
        if (p.st <= 0) {
          p.st = 0.018;
          const tc = this._plasC || (this._plasC = TEAMS.map(T => new THREE.Color(T.hex)));
          FX.trail(p.pos, tc[p.team], U.rand(0.25, 0.4), 4);
        }
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;

      /* 命中判定 */
      const fg = foeGrid[p.team] || (foeGrid[p.team] = this._gridBuild(this.hostilesOf(p.team)));
      this._gridNear(fg, p.pos.x, p.pos.z, h => {
        if (!h.alive) return false;
        const rr = h.radius + p.r + 2;
        if (U.dist2XZ(p.pos, h.pos) <= rr * rr && Math.abs(p.pos.y - h.pos.y) < h.radius + 26) {
          /* 先記下護盾狀態再扣血：決定命中特效是「護盾漣漪」還是「船體火花」 */
          const shielded = (h.shield || 0) > 1;
          this.damage(h, p.dmg, p.src);
          FX.impact(p.pos, shielded, TEAMS[h.team].hex, p.t !== 'bullet');
          const pHeard = typeof Fog === 'undefined' || !Fog.hiddenAt(p.pos);
          if (p.t === 'plasma') { FX.explode(p.pos, 9, TEAMS[p.team].hex); if (pHeard) this._explSnd(9, p.pos); }
          if (p.t === 'missile') { FX.explode(p.pos, 11, TEAMS[p.team].hex); if (pHeard) this._explSnd(11, p.pos); }
          p.alive = false;
          return true;
        }
        return false;
      });
      if (!p.alive) { if (p.ribbon) p.ribbon.release(); continue; }
      /* 攔截火炮 vs 飛彈 */
      if (p.anti) {
        for (const m of this.projectiles) {
          if (m.t !== 'missile' || !m.alive || m.team === p.team) continue;
          const rr = m.r + p.r + 4;
          if (U.dist2XZ(p.pos, m.pos) <= rr * rr) {
            m.alive = false; p.alive = false;
            if (m.ribbon) m.ribbon.release();
            FX.explode(m.pos, 8, TEAMS[m.team].hex);
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.alive);
  },

  /* 爆炸音效接點：sfx.js 有分級版就用，沒有就退回大／小兩種 */
  _explSnd(size, pos) {
    if (SFX.explodeSized) SFX.explodeSized(size, pos); else (size >= 30 ? SFX.explB() : SFX.explS());
  },
  _shakeAtt(p) {
    const d3 = (typeof Game !== 'undefined' && Game.camera) ? Game.camera.position.distanceTo(p) : 2000;
    return U.clamp(1.25 - d3 / 2800, 0, 1);
  },

  /* 大／超大爆炸排程（全部走遊戲時間佇列：暫停凍結、hit-stop 與終局慢動作一起變慢、不洩漏進新局）
     ① 0～T1：船身隨機點連環小爆、船體閃白脈動＋越抖越兇（T1：大 0.5～1.2 秒依體積、超大 1.5 秒）
     ② T1：核心白熱火團＋強點光＋hit-stop＋大震；網格此時移除
     ③ T1+0.35：炸開——衝擊波 radius×7、碎片、火星、煙塵；④ 餘燼閃光由 FX 延遲雲朵接續 2～4 秒 */
  _stageBlast(e, size, hex, huge, att) {
    const R = e.radius, o = e.pos.clone();
    const k = U.clamp((size - 30) / 30, 0, 1);
    const T1 = huge ? 1.5 : 0.5 + 0.7 * k;
    FX.reserveBig(T1 + 3.5);
    this.booms.push({ kind: 'hull', e, mesh: e.mesh, o, t: T1, T: T1, beat: 0 });
    const np = huge ? 10 : 4 + Math.round(k * 5);
    for (let i = 0; i < np; i++) {
      const a = U.rand(U.TAU), d = U.rand(0.2, 0.85) * R;
      this.booms.push({
        kind: 'pop', snd: i % 2 === 0,
        p: new THREE.Vector3(o.x + Math.cos(a) * d, o.y + U.rand(-0.2, 0.4) * R, o.z + Math.sin(a) * d),
        t: i === 0 ? 1e-4 : U.rand(0.06, T1 - 0.06), s: U.clamp(R * 0.32, 8, huge ? 22 : 13),
      });
    }
    this.booms.push({ kind: 'core', p: o, t: T1, size, r: R, hex, huge, slow: e.kind === 'ship' && R >= 28 });
    this.booms.push({ kind: 'burst', p: o, t: T1 + 0.35, size, r: R, hex, huge, e });
    this.shakeAmt = Math.min(1.2, this.shakeAmt + 0.08 * att);
  },

  /* 階段①臨終：船體閃白脈動（越接近爆心越快）＋抖動（越來越兇）；時間到移除網格 */
  _dyingHull(b, dt) {
    const m = b.mesh, e = b.e;
    if (b.t <= 0) { if (m.parent) m.parent.remove(m); e._flash = false; return; }
    const k = 1 - b.t / b.T;
    const j = e.radius * (0.015 + 0.06 * k);
    m.position.set(b.o.x + U.rand(-j, j), b.o.y + U.rand(-j, j) * 0.5, b.o.z + U.rand(-j, j));
    b.beat -= dt;
    if (b.beat <= 0) { b.beat = 0.22 - 0.15 * k; e.hullHitT = this.time; }
    this._hitFlashSync(e);
  },

  _updBooms(dt) {
    for (const b of this.booms) {
      b.t -= dt;
      if (b.kind === 'hull') { this._dyingHull(b, dt); continue; }
      if (b.t > 0) continue;
      const heard = typeof Fog === 'undefined' || !Fog.hiddenAt(b.p);
      if (b.kind === 'pop') {
        FX.blastPop(b.p, b.s);
        if (heard && b.snd) this._explSnd(b.s, b.p);
      } else if (b.kind === 'core') {
        FX.blastCore(b.p, b.size, b.hex, b.r, b.huge);
        if (heard) {
          this._explSnd(b.size, b.p);
          const att = this._shakeAtt(b.p);
          this.shakeAmt = Math.min(b.huge ? 1.4 : 1.2, this.shakeAmt + (0.25 + b.size * 0.012 + (b.huge ? 0.9 : 0)) * att);
        }
        if (b.slow) Game.slowMo(0.35);
      } else if (b.kind === 'burst') {
        FX.blastBurst(b.p, b.size, b.hex, b.r, b.huge);
        if (b.e && b.e._wreck) { b.e._wreck.mesh.visible = true; b.e._wreck = null; }
        if (heard && b.huge) this._explSnd(b.size * 0.8, b.p);
      } else { FX.explode(b.p, 40, b.hex); if (heard) this._explSnd(40, b.p); }
    }
    this.booms = this.booms.filter(b => b.t > 0);
  },

  _updBeams(dt) {
    for (const b of this.beams) {
      b.t -= dt;
      if (b.t <= 0 || !b.src.alive || !b.tgt.alive) {
        FX.beamRelease(b.fx);
        b.dead = true;
        continue;
      }
      this.damage(b.tgt, b.dps * dt, b.src);
      if (b.fx) {
        FX.beamSet(b.fx, this._nose(b.src), b.tgt.pos, TEAMS[b.src.team].hex, b.heavy, U.clamp(b.t / b.max, 0, 1));
      }
      b.tick -= dt;
      if (b.tick <= 0 && b.tgt.alive) {
        b.tick = 0.06;
        FX.burst(b.tgt.pos.clone().add(new THREE.Vector3(U.rand(-8, 8), U.rand(-4, 10), U.rand(-8, 8))), 2, TEAMS[b.src.team].hex, 140);
      }
    }
    this.beams = this.beams.filter(b => !b.dead);
  },

  /* ── 空間格子 ──
     地圖切成 GRID 單位的方格，每個物件只跟自己＋周圍 8 格比對，計算量不再隨數量平方暴增。
     GRID 必須 ≥ 任兩物件的最大互動距離（最大：戰列艦 34＋母艦 95＋間距 22 = 151；命中判定 95+6+2）。 */
  GRID: 180,
  _gridBuild(list) {
    const G = this.GRID, m = new Map();
    for (const e of list) {
      const k = Math.floor(e.pos.x / G) * 4096 + Math.floor(e.pos.z / G);
      let c = m.get(k);
      if (!c) m.set(k, c = []);
      c.push(e);
    }
    return m;
  },
  /* 對 (x,z) 周圍 3×3 格裡的每個物件呼叫 fn；fn 回傳 true 就提早結束 */
  _gridNear(m, x, z, fn) {
    const G = this.GRID, ix = Math.floor(x / G), iz = Math.floor(z / G);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = m.get((ix + dx) * 4096 + iz + dz);
      if (!c) continue;
      for (let i = 0; i < c.length; i++) if (fn(c[i])) return true;
    }
    return false;
  },

  _separate(dt) {
    const k = Math.min(2, dt * 60) * 8;
    const all = this.ents;
    /* 參與者：活著的船、所有小行星（含剛死、與原規則一致）、建築；採空的石頭不擋路 */
    const list = [];
    for (let i = 0; i < all.length; i++) {
      const b = all[i];
      if ((!b.alive && b.kind !== 'ast') || b.depleted) continue;
      b._si = i;
      list.push(b);
    }
    const grid = this._gridBuild(list);
    for (const a of list) {
      if (!a.alive || a.kind !== 'ship') continue;
      this._gridNear(grid, a.pos.x, a.pos.z, b => {
        if (b === a) return;
        if (b.kind === 'ship' && b._si < a._si) return;   // 船對船每對只算一次（同原本 j<i 跳過）
        const md = a.radius + b.radius + (b.kind === 'ship' ? 10 : 22);
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= md * md || d2 < 0.01) return;
        const d = Math.sqrt(d2), push = ((md - d) / md) * k;
        const nx = dx / d, nz = dz / d;
        if (b.kind === 'ship') {
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        } else {
          a.pos.x -= nx * push * 2; a.pos.z -= nz * push * 2;
        }
      });
    }
  },

};
