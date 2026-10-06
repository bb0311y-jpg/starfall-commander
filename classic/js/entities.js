'use strict';
/* ═══════════ 艦艇實體：移動 AI、鎖敵、武器射控 ═══════════ */

let SHIP_UID = 1;

class Ship {
  constructor(cls, team, x, y, angle, rank = 0, opts = {}) {
    const def = SHIPS[cls];
    this.uid = SHIP_UID++;
    this.cls = cls; this.def = def; this.team = team;
    this.x = x; this.y = y; this.angle = angle;
    this.vx = 0; this.vy = 0;
    this.rank = rank;
    this.dmgMul = 1 + 0.12 * rank;
    this.maxHull = Math.round(def.hull * (1 + 0.08 * rank));
    this.hull = this.maxHull;
    this.maxShield = def.shield; this.shield = def.shield;
    this.radius = def.radius;
    this.alive = true;
    this.target = null; this.order = null;
    this.lastHit = -99; this.lastHitAngle = 0; this.hitFlash = 0;
    this.surgeT = 0;
    this.retargetT = U.rand(0.4);
    this.spawnT = opts.warp ? 0.6 : 0;
    this.temp = !!opts.temp;       // 躍遷增援：戰後不保留
    this.parent = opts.parent || null;
    this.battleKills = 0;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.orbitPhase = U.rand(U.TAU);
    this.hangT = def.hangar ? U.rand(1, def.hangar.cd) : 0;
    this.engT = 0; this.thrusting = 0;
    this.trail = def.small ? [] : null;
    this.weapons = def.weapons.map(wd => ({
      d: wd, cd: wd.delay !== undefined ? wd.delay : U.rand(0.2, Math.max(0.4, wd.cd || 1)),
      state: 'idle', t: 0, lock: null,
    }));
    /* 主武器理想接戰距離 */
    let mainRange = 250;
    for (const wd of def.weapons) if (wd.t !== 'pd') { mainRange = wd.range; break; }
    this.prefRange = def.small ? 185 : mainRange * 0.72;
  }

  get value() { return this.def.cost; }

  update(dt, B) {
    const def = this.def;
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.surgeT > 0) this.surgeT -= dt;

    /* 護盾再生（受擊 3 秒後開始） */
    if (this.shield < this.maxShield && B.time - this.lastHit > 3) {
      this.shield = Math.min(this.maxShield, this.shield + def.regen * (this.surgeT > 0 ? 4 : 1) * dt);
    }

    /* 鎖定目標 */
    this.retargetT -= dt;
    if (this.retargetT <= 0) { this.retargetT = 0.35 + Math.random() * 0.25; this.acquire(B); }
    if (this.target && !this.target.alive) this.target = null;

    /* ── 移動決策 ── */
    let thrust = 0, wantA = this.angle;
    if (this.order && this.order.type === 'move') {
      const o = this.order;
      const d = U.dist(this.x, this.y, o.x, o.y);
      if (d < 46 + this.radius) this.order = null;
      else { wantA = U.angTo(this.x, this.y, o.x, o.y); thrust = 1; }
    } else {
      const t = this.target;
      if (t) {
        const d = U.dist(this.x, this.y, t.x, t.y);
        if (def.small) {
          /* 戰機：環繞目標纏鬥 */
          this.orbitPhase += this.orbitDir * dt * (def.speed / (this.prefRange * 0.85));
          const ox = t.x + Math.cos(this.orbitPhase) * this.prefRange * 0.8;
          const oy = t.y + Math.sin(this.orbitPhase) * this.prefRange * 0.8;
          wantA = d > this.prefRange * 2.4
            ? U.angTo(this.x, this.y, t.x, t.y)
            : U.angTo(this.x, this.y, ox, oy);
          thrust = 1;
        } else {
          /* 主力艦：逼近到理想射程後保持 */
          wantA = U.angTo(this.x, this.y, t.x, t.y);
          if (d > this.prefRange) thrust = 1;
          else if (d < this.prefRange * 0.55) thrust = -0.35;
          else thrust = 0.12;
        }
      } else {
        /* 無目標：推進到敵方艦隊方向 */
        const c = B.enemyCentroid(this.team);
        if (c) {
          const d = U.dist(this.x, this.y, c.x, c.y);
          if (d > 420) { wantA = U.angTo(this.x, this.y, c.x, c.y); thrust = 0.85; }
        }
      }
    }

    /* ── 整合運動 ── */
    if (def.speed > 0) {
      this.angle = U.turnToward(this.angle, wantA, def.turn * dt);
      if (thrust !== 0) {
        const acc = def.speed * 1.75 * thrust;
        this.vx += Math.cos(this.angle) * acc * dt;
        this.vy += Math.sin(this.angle) * acc * dt;
      } else {
        const dr = Math.pow(0.45, dt);
        this.vx *= dr; this.vy *= dr;
      }
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > def.speed) { this.vx *= def.speed / sp; this.vy *= def.speed / sp; }
      this.x += this.vx * dt; this.y += this.vy * dt;
      const dO = Math.hypot(this.x, this.y);
      if (dO > 4300) { this.x *= 4300 / dO; this.y *= 4300 / dO; }
    }
    this.thrusting = Math.abs(thrust);

    /* 小型艦光尾 */
    if (this.trail) {
      this.engT -= dt;
      if (this.engT <= 0) {
        this.engT = 0.03;
        this.trail.push(this.x, this.y);
        if (this.trail.length > 40) this.trail.splice(0, 2);
      }
    }

    /* ── 武器射控 ── */
    for (const w of this.weapons) {
      const wd = w.d;
      if (wd.t === 'doom') { this._doom(w, wd, dt, B); continue; }
      w.cd -= dt;
      if (w.cd > 0) continue;
      let tgt = null;
      if (wd.t === 'pd') tgt = B.pdTarget(this, wd.range);
      else {
        const t = this.target;
        if (t && t.alive && U.dist2(this.x, this.y, t.x, t.y) <= wd.range * wd.range) tgt = t;
      }
      if (!tgt) { w.cd = 0.13; continue; }
      if (wd.t === 'gun' && def.small) {
        const aim = U.angTo(this.x, this.y, tgt.x, tgt.y);
        if (Math.abs(U.angDiff(this.angle, aim)) > 0.42) { w.cd = 0.07; continue; }
      }
      switch (wd.t) {
        case 'gun': case 'pd': B.fireGun(this, wd, tgt); break;
        case 'missile': B.fireMissileSalvo(this, wd, tgt); break;
        case 'plasma': B.firePlasma(this, wd, tgt); break;
        case 'beam': B.spawnBeamFrom(this, wd, tgt); break;
      }
      w.cd = wd.cd * U.rand(0.92, 1.12);
    }

    /* ── 航母機庫 ── */
    if (def.hangar) {
      this.hangT -= dt;
      if (this.hangT <= 0) {
        this.hangT = def.hangar.cd;
        if (B.countDrones(this) < def.hangar.max) B.spawnDrone(this);
      }
    }
  }

  /* 毀滅主炮：充能 → 鎖定光束 */
  _doom(w, wd, dt, B) {
    if (w.state === 'charge') {
      w.t -= dt;
      if (!w.lock || !w.lock.alive) { w.state = 'idle'; w.cd = wd.cd * 0.35; w.lock = null; }
      else if (w.t <= 0) {
        B.spawnBeam(this, w.lock, wd.dps * this.dmgMul, wd.dur, true);
        SFX.beam();
        w.state = 'idle'; w.cd = wd.cd; w.lock = null;
      }
      return;
    }
    w.cd -= dt;
    if (w.cd <= 0 && this.target && this.target.alive
        && U.dist2(this.x, this.y, this.target.x, this.target.y) <= wd.range * wd.range) {
      w.state = 'charge'; w.t = wd.charge; w.lock = this.target;
      SFX.alarm();
    }
  }

  acquire(B) {
    if (this.order && this.order.type === 'attack') {
      const t = this.order.target;
      if (t && t.alive) { this.target = t; return; }
      this.order = null;
    }
    const acq = B.acqRange;
    if (this.target && this.target.alive
        && U.dist2(this.x, this.y, this.target.x, this.target.y) < acq * acq * 1.6) return;
    const enemies = B.teamShips(1 - this.team);
    let best = null, bs = Infinity;
    for (const e of enemies) {
      if (!e.alive || e.spawnT > 0) continue;
      let d2 = U.dist2(this.x, this.y, e.x, e.y);
      if (d2 > acq * acq) continue;
      /* 目標偏好：戰機互咬、飛彈艦與主力艦偏好大目標 */
      if (this.def.small && e.def.small) d2 *= 0.55;
      if (!this.def.small && this.def.group === 2 && e.def.group >= 3) d2 *= 0.6;
      if (this.def.group >= 3 && !e.def.small) d2 *= 0.7;
      if (d2 < bs) { bs = d2; best = e; }
    }
    this.target = best;
  }

  damage(amount, src, B, fromX, fromY) {
    if (!this.alive || this.spawnT > 0) return;
    this.lastHit = B.time;
    this.hitFlash = 0.12;
    if (fromX !== undefined) this.lastHitAngle = U.angTo(this.x, this.y, fromX, fromY);
    let dealt = 0;
    if (this.shield > 0) {
      const a = Math.min(this.shield, amount);
      this.shield -= a; amount -= a; dealt += a;
      if (a > 0.5) SFX.hitShield();
    }
    if (amount > 0) {
      const a = Math.min(this.hull, amount);
      this.hull -= amount; dealt += a;
    }
    if (B.stats) {
      if (this.team === 1) B.stats.dmgDealt += dealt;
      else B.stats.dmgTaken += dealt;
    }
    if (this.hull <= 0) this.die(B, src);
  }

  die(B, src) {
    if (!this.alive) return;
    this.alive = false;
    if (src && src.alive && src.team !== this.team) src.battleKills++;
    B.onShipDeath(this, src);
  }

  nose() {
    return {
      x: this.x + Math.cos(this.angle) * this.radius * 0.95,
      y: this.y + Math.sin(this.angle) * this.radius * 0.95,
    };
  }
}
