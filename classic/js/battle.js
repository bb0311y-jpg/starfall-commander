'use strict';
/* ═══════════ 戰鬥引擎 ═══════════ */

let _starLayers = null;
function getStarLayers() {
  if (_starLayers) return _starLayers;
  const make = (n, size, bright) => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      const r = U.rand(0.6, size), a = U.rand(bright * 0.35, bright);
      const tint = Math.random();
      g.fillStyle = tint < 0.12 ? `rgba(255,200,160,${a})`
        : tint < 0.24 ? `rgba(160,190,255,${a})` : `rgba(210,225,255,${a})`;
      g.fillRect(x, y, r, r);
    }
    return c;
  };
  _starLayers = [
    { c: make(110, 1.5, 0.5), p: 0.12 },
    { c: make(80, 2.0, 0.75), p: 0.26 },
    { c: make(42, 2.7, 1.0), p: 0.5 },
  ];
  return _starLayers;
}

function blobCanvas(rgb, alpha) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, `rgba(${rgb},${alpha})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return c;
}

class Battle {
  constructor(cfg) {
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.attract = cfg.mode === 'attract';
    this.time = 0;
    this.state = 'fight'; this.endT = 0; this.ended = false;
    this.ships = []; this.projectiles = []; this.beams = [];
    this.particles = []; this.rings = []; this.markers = [];
    this.strikes = []; this.delayed = [];
    this._teams = [[], []]; this._cent = [null, null];
    this._missiles = [[], []];
    this.stats = { kills: 0, losses: 0, dmgDealt: 0, dmgTaken: 0, time: 0, waves: 0, killedValue: 0, lostValue: 0 };
    this.acqRange = cfg.mod === 'nebula' ? 950 : 2600;
    this.cam = { x: -600, y: 0, z: 0.5, follow: true, shake: 0 };
    this.selection = new Set();
    this.squads = { 1: [], 2: [], 3: [], 4: [] };
    this.abl = ABILITIES.map(a => ({ d: a, cd: 0 }));
    this.aiming = null;
    this.mouse = { x: 0, y: 0 };
    this.selStart = null; this.selRect = null; this.panning = null;
    this.waveSpawning = false; this.waveTimer = 0;
    this.endlessWave = 0;
    this.stationShip = null;

    /* 星雲背景 */
    this.nebula = [];
    const cols = ['30,60,130', '90,50,150', '20,90,120', '130,50,80'];
    const n = cfg.mod === 'nebula' ? 13 : 7;
    for (let i = 0; i < n; i++) {
      const rgb = cfg.mod === 'nebula' && i >= 7 ? '110,60,180' : U.pick(cols);
      this.nebula.push({
        c: blobCanvas(rgb, cfg.mod === 'nebula' ? 0.2 : 0.13),
        x: U.rand(-2400, 2400), y: U.rand(-1600, 1600), r: U.rand(380, 820),
      });
    }

    /* 觀賞模式：自動生成雙方艦隊 */
    if (this.attract) {
      const bud = U.rand(1500, 2600);
      const w = { int: 4, cor: 3, des: 2, cru: 1 };
      cfg.playerFleet = genFleetList(bud, w).map(c => ({ c, r: 0 }));
      cfg.enemyWaves = [genFleetList(bud, w)];
      cfg.formation = U.pick(['wedge', 'line', 'orb']);
    }

    /* 我方艦隊 */
    const pf = cfg.playerFleet || [];
    const offs = this._formOffsets(pf.map(f => f.c), cfg.formation || 'wedge');
    pf.forEach((f, i) => {
      const o = offs[i];
      const s = new Ship(f.c, 0, -1500 + o.x + U.rand(-12, 12), o.y + U.rand(-12, 12), 0, f.r || 0);
      this.ships.push(s);
      this.squads[s.def.group].push(s);
    });
    if (cfg.station) {
      const st = new Ship('sta', 0, -1980, 0, 0, 0);
      this.ships.push(st);
      this.squads[4].push(st);
      this.stationShip = st;
    }

    /* 敵方：第一波即時出現，其餘待命 */
    this.pendingWaves = (cfg.enemyWaves || []).map(w => w.slice());
    if (this.mode !== 'endless' && this.pendingWaves.length) {
      const first = this.pendingWaves.shift();
      const eoffs = this._formOffsets(first, U.pick(['wedge', 'line']));
      first.forEach((c, i) => {
        const o = eoffs[i];
        this.ships.push(new Ship(c, 1, 1500 - o.x + U.rand(-12, 12), o.y + U.rand(-12, 12), Math.PI, 0));
      });
    }
    this._rebuildTeams();
  }

  /* ── 陣型佈局 ── */
  _formOffsets(list, form) {
    const groups = { 1: [], 2: [], 3: [], 4: [] };
    list.forEach((c, i) => groups[SHIPS[c].group].push(i));
    const out = new Array(list.length);
    const col = (idxs, x, gap) => idxs.forEach((idx, k) => {
      out[idx] = { x, y: (k - (idxs.length - 1) / 2) * gap };
    });
    if (form === 'orb') {
      col(groups[4], 0, 150);
      const ring = (idxs, r) => idxs.forEach((idx, k) => {
        const a = (k / Math.max(1, idxs.length)) * U.TAU + 0.4;
        out[idx] = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
      ring(groups[3], 230); ring(groups[2], 330); ring(groups[1], 440);
    } else {
      col(groups[4], -150, 165);
      col(groups[3], 0, 112);
      col(groups[2], -270, 84);
      col(groups[1], 155, 58);
      if (form === 'wedge') for (const o of out) if (o) o.x -= Math.abs(o.y) * 0.45;
    }
    for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = { x: 0, y: 0 };
    return out;
  }

  _rebuildTeams() {
    this._teams[0].length = 0; this._teams[1].length = 0;
    let sx0 = 0, sy0 = 0, sx1 = 0, sy1 = 0;
    for (const s of this.ships) {
      if (!s.alive) continue;
      this._teams[s.team].push(s);
      if (s.team === 0) { sx0 += s.x; sy0 += s.y; } else { sx1 += s.x; sy1 += s.y; }
    }
    const n0 = this._teams[0].length, n1 = this._teams[1].length;
    this._cent[0] = n0 ? { x: sx0 / n0, y: sy0 / n0 } : null;
    this._cent[1] = n1 ? { x: sx1 / n1, y: sy1 / n1 } : null;
  }

  teamShips(t) { return this._teams[t]; }
  enemyCentroid(myTeam) { return this._cent[1 - myTeam]; }
  pendingCount() { return this.pendingWaves.reduce((s, w) => s + w.length, 0); }

  /* ═══════ 更新 ═══════ */
  update(dt) {
    if (this.ended) return;
    this.time += dt;

    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const d = this.delayed[i];
      d.t -= dt;
      if (d.t <= 0) { this.delayed.splice(i, 1); try { d.fn(); } catch (e) {} }
    }

    this._rebuildTeams();
    this._missiles[0].length = 0; this._missiles[1].length = 0;
    for (const p of this.projectiles) if (p.t === 'missile' && p.alive) this._missiles[p.team].push(p);

    for (const s of this.ships) if (s.alive) s.update(dt, this);
    this._separate(dt);
    this._updateProjectiles(dt);
    this._updateBeams(dt);
    this._updateFx(dt);
    this._updateStrikes(dt);

    for (const a of this.abl) if (a.cd > 0) a.cd -= dt;

    /* 清理陣亡 */
    this.ships = this.ships.filter(s => s.alive);
    if (this.selection.size) for (const s of [...this.selection]) if (!s.alive) this.selection.delete(s);
    for (const k in this.squads) this.squads[k] = this.squads[k].filter(s => s.alive);

    this._waves(dt);
    this._checkEnd(dt);
    this._updateCam(dt);
    this.stats.time = this.time;
  }

  _separate(dt) {
    const A = this.ships, k = Math.min(2, dt * 60) * 9;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.alive || a.spawnT > 0) continue;
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j];
        if (!b.alive || b.spawnT > 0) continue;
        const md = a.radius + b.radius + 9;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= md * md || d2 < 0.01) continue;
        const d = Math.sqrt(d2), push = ((md - d) / md) * k;
        const nx = dx / d, ny = dy / d;
        if (!a.def.stationary) { a.x -= nx * push; a.y -= ny * push; }
        if (!b.def.stationary) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  /* ═══════ 開火 ═══════ */
  fireGun(ship, wd, tgt) {
    const n = ship.nose();
    const d = U.dist(n.x, n.y, tgt.x, tgt.y);
    const tl = d / wd.spd;
    const tx = tgt.x + (tgt.vx || 0) * tl, ty = tgt.y + (tgt.vy || 0) * tl;
    const sp = wd.spread || 0.02;
    const a = U.angTo(n.x, n.y, tx, ty) + U.rand(-sp, sp);
    this.projectiles.push({
      t: 'bullet', team: ship.team, x: n.x, y: n.y,
      vx: Math.cos(a) * wd.spd, vy: Math.sin(a) * wd.spd,
      dmg: wd.dmg * ship.dmgMul, life: (wd.range / wd.spd) * 1.25, r: 2,
      alive: true, src: ship, anti: wd.t === 'pd',
    });
    if (wd.t === 'pd') SFX.pd(); else SFX.shoot();
  }

  fireMissileSalvo(ship, wd, tgt) {
    const n = wd.salvo || 1;
    for (let i = 0; i < n; i++) {
      this.delayed.push({
        t: i * 0.16,
        fn: () => {
          if (!ship.alive) return;
          const t2 = (tgt && tgt.alive) ? tgt : ship.target;
          if (t2 && t2.alive) this._launchMissile(ship, wd, t2);
        },
      });
    }
  }

  _launchMissile(ship, wd, tgt) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const a = ship.angle + side * U.rand(0.5, 1.6);
    this.projectiles.push({
      t: 'missile', team: ship.team, x: ship.x, y: ship.y,
      heading: a, spd: 150, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150,
      dmg: wd.dmg * ship.dmgMul, life: 6.5, r: 4, turnR: wd.turnR, maxSpd: wd.spd,
      wob: U.rand(U.TAU), target: tgt, trail: [], tt: 0, alive: true, src: ship,
    });
    SFX.missile();
  }

  firePlasma(ship, wd, tgt) {
    const n = ship.nose();
    const d = U.dist(n.x, n.y, tgt.x, tgt.y);
    const tl = d / wd.spd;
    const a = U.angTo(n.x, n.y, tgt.x + (tgt.vx || 0) * tl, tgt.y + (tgt.vy || 0) * tl) + U.rand(-0.03, 0.03);
    this.projectiles.push({
      t: 'plasma', team: ship.team, x: n.x, y: n.y,
      vx: Math.cos(a) * wd.spd, vy: Math.sin(a) * wd.spd,
      dmg: wd.dmg * ship.dmgMul, life: (wd.range / wd.spd) * 1.3, r: 6,
      alive: true, src: ship,
    });
    SFX.plasma();
  }

  spawnBeamFrom(ship, wd, tgt) {
    this.spawnBeam(ship, tgt, wd.dps * ship.dmgMul, wd.dur, !!wd.heavy);
    SFX.beam();
  }
  spawnBeam(src, tgt, dps, dur, heavy) {
    this.beams.push({ src, tgt, dps, t: dur, max: dur, heavy, tick: 0 });
  }

  pdTarget(ship, range) {
    let best = null, bs = range * range;
    for (const m of this._missiles[1 - ship.team]) {
      if (!m.alive) continue;
      const d2 = U.dist2(ship.x, ship.y, m.x, m.y);
      if (d2 < bs) { bs = d2; best = m; }
    }
    if (best) return best;
    bs = range * range;
    for (const e of this._teams[1 - ship.team]) {
      if (!e.def.small || e.spawnT > 0) continue;
      const d2 = U.dist2(ship.x, ship.y, e.x, e.y);
      if (d2 < bs) { bs = d2; best = e; }
    }
    return best;
  }

  countDrones(parent) {
    let n = 0;
    for (const s of this.ships) if (s.alive && s.cls === 'drone' && s.parent === parent) n++;
    return n;
  }
  spawnDrone(parent) {
    const a = parent.angle + Math.PI + U.rand(-0.6, 0.6);
    const s = new Ship('drone', parent.team,
      parent.x + Math.cos(a) * parent.radius * 1.4,
      parent.y + Math.sin(a) * parent.radius * 1.4,
      parent.angle, 0, { temp: true, parent });
    this.ships.push(s);
    if (parent.team === 0) this.squads[1].push(s);
  }

  /* ═══════ 彈道與碰撞 ═══════ */
  _updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }

      if (p.t === 'missile') {
        if (p.target && !p.target.alive) p.target = null;
        if (p.target) {
          const want = U.angTo(p.x, p.y, p.target.x, p.target.y);
          p.heading = U.turnToward(p.heading, want, p.turnR * dt);
        }
        p.heading += Math.sin(this.time * 3.1 + p.wob) * 1.65 * dt;
        p.spd = Math.min(p.maxSpd, p.spd + 340 * dt);
        p.vx = Math.cos(p.heading) * p.spd;
        p.vy = Math.sin(p.heading) * p.spd;
        p.tt -= dt;
        if (p.tt <= 0) {
          p.tt = 0.016;
          p.trail.push(p.x, p.y);
          if (p.trail.length > 76) p.trail.splice(0, 2);
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;

      const foes = this._teams[1 - p.team];
      for (const s of foes) {
        if (s.spawnT > 0) continue;
        const rr = s.radius + p.r + 1;
        if (U.dist2(p.x, p.y, s.x, s.y) <= rr * rr) {
          s.damage(p.dmg, p.src, this, p.x, p.y);
          this._hitFx(p);
          p.alive = false;
          break;
        }
      }
      if (!p.alive) continue;

      /* 攔截火炮 vs 飛彈 */
      if (p.anti) {
        for (const m of this._missiles[1 - p.team]) {
          if (!m.alive) continue;
          const rr = m.r + p.r + 3;
          if (U.dist2(p.x, p.y, m.x, m.y) <= rr * rr) {
            m.alive = false; p.alive = false;
            this.spawnExplosion(m.x, m.y, 9, m.team);
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.alive);
  }

  _hitFx(p) {
    const n = p.t === 'missile' ? 8 : p.t === 'plasma' ? 8 : 3;
    const col = TEAMS[p.team].bullet;
    for (let i = 0; i < n; i++) {
      this.spawnParticle(p.x, p.y, U.rand(U.TAU), U.rand(30, 210), U.rand(0.12, 0.4), col, U.rand(1.5, 3));
    }
    if (p.t === 'missile') { this.spawnExplosion(p.x, p.y, 13, p.team); SFX.explS(); }
  }

  _updateBeams(dt) {
    for (const b of this.beams) {
      b.t -= dt;
      if (b.t <= 0 || !b.src.alive || !b.tgt.alive) { b.dead = true; continue; }
      b.tgt.damage(b.dps * dt, b.src, this, b.src.x, b.src.y);
      b.tick -= dt;
      if (b.tick <= 0 && b.tgt.alive) {
        b.tick = 0.05;
        const ang = U.angTo(b.tgt.x, b.tgt.y, b.src.x, b.src.y);
        const ix = b.tgt.x + Math.cos(ang) * b.tgt.radius * 0.75;
        const iy = b.tgt.y + Math.sin(ang) * b.tgt.radius * 0.75;
        this.spawnParticle(ix, iy, U.rand(U.TAU), U.rand(40, 190), U.rand(0.1, 0.32), TEAMS[b.src.team].bullet, 2);
      }
    }
    this.beams = this.beams.filter(b => !b.dead);
  }

  /* ═══════ 特效 ═══════ */
  spawnParticle(x, y, ang, spd, life, color, size, flash) {
    if (this.particles.length > 2600) return;
    this.particles.push({
      x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life, max: life, color, size, flash: !!flash,
    });
  }

  spawnExplosion(x, y, size, team) {
    const T = TEAMS[team] || TEAMS[1];
    this.spawnParticle(x, y, 0, 0, 0.22, '#ffffff', size * 1.5, true);
    const n = U.clamp(Math.round(size * 0.9), 6, 30);
    const cols = [T.acc, '#ffd166', '#ffffff', T.bullet];
    for (let i = 0; i < n; i++) {
      this.spawnParticle(x, y, U.rand(U.TAU), U.rand(40, 60 + size * 9),
        U.rand(0.3, 0.9), U.pick(cols), U.rand(1.5, 3.5));
    }
    this.rings.push({ x, y, r: 4, vr: 90 + size * 8, life: 0.5, max: 0.5, col: team === 1 ? '255,140,90' : '130,215,255' });
    if (size >= 24) this.cam.shake = Math.min(15, this.cam.shake + size * 0.28);
  }

  _updateFx(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.985; p.vy *= 0.985;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const r of this.rings) { r.life -= dt; r.r += r.vr * dt; }
    this.rings = this.rings.filter(r => r.life > 0);
    for (const m of this.markers) m.t -= dt;
    this.markers = this.markers.filter(m => m.t > 0);
  }

  _updateStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      if (!s.fired) {
        s.t -= dt;
        if (s.t <= 0) {
          s.fired = true; s.beamT = 0.38;
          this.spawnExplosion(s.x, s.y, 44, 1);
          SFX.explB();
          this.cam.shake = Math.min(16, this.cam.shake + 10);
          for (const e of this._teams[1]) {
            const d = U.dist(e.x, e.y, s.x, s.y);
            if (d < 210) e.damage(U.lerp(520, 190, d / 210), null, this, s.x, s.y);
          }
        }
      } else {
        s.beamT -= dt;
        if (s.beamT <= 0) this.strikes.splice(i, 1);
      }
    }
  }

  onShipDeath(ship, src) {
    const big = ship.radius >= 22;
    this.spawnExplosion(ship.x, ship.y, ship.radius * 1.4, ship.team);
    if (big) SFX.explB(); else SFX.explS();
    if (ship.team === 1) {
      this.stats.kills++;
      this.stats.killedValue += ship.def.cost;
    } else if (!ship.temp && ship.cls !== 'drone') {
      this.stats.losses++;
      this.stats.lostValue += ship.def.cost;
    }
    if (ship.def.isBoss) {
      this.cam.shake = 20;
      for (let i = 1; i <= 6; i++) {
        const bx = ship.x, by = ship.y;
        this.delayed.push({
          t: i * 0.22,
          fn: () => { this.spawnExplosion(bx + U.rand(-70, 70), by + U.rand(-70, 70), 38, 1); SFX.explB(); },
        });
      }
    }
  }

  /* ═══════ 波次 ═══════ */
  _spawnEnemyWave(list, warp) {
    list.forEach((c, i) => {
      const x = 1850 + Math.floor(i / 6) * 110 + U.rand(-30, 30);
      const y = ((i % 6) - 2.5) * 170 + U.rand(-40, 40);
      this.ships.push(new Ship(c, 1, x, y, Math.PI, 0, { warp: !!warp }));
    });
  }

  _waves(dt) {
    if (this.state !== 'fight') return;
    const alive = this._teams[1].length;
    if (this.mode === 'endless') {
      if (alive === 0 && !this.waveSpawning) {
        this.waveSpawning = true;
        if (this.endlessWave > 0) this.stats.waves = this.endlessWave;
        this.endlessWave++;
        const budget = Math.round(650 * Math.pow(1.27, this.endlessWave - 1));
        const w = { int: 4, cor: 3, des: 2, cru: 2, car: this.endlessWave >= 3 ? 1 : 0, bat: this.endlessWave >= 5 ? 1 : 0 };
        const list = genFleetList(Math.max(300, budget), w);
        UI.waveBanner(`第 ${this.endlessWave} 波 敵艦躍遷抵達`);
        SFX.warp();
        this.delayed.push({ t: 1.7, fn: () => { this._spawnEnemyWave(list, true); this.waveSpawning = false; } });
      }
      return;
    }
    if (!this.pendingWaves.length || this.waveSpawning) return;
    this.waveTimer += dt;
    const timed = this.cfg.station && this.waveTimer > 72;
    if (alive === 0 || timed) {
      this.waveSpawning = true;
      this.waveTimer = 0;
      UI.waveBanner('⚠ 偵測到躍遷訊號 — 敵方增援抵達 ⚠');
      SFX.alarm(); SFX.warp();
      this.delayed.push({
        t: 1.8,
        fn: () => {
          const list = this.pendingWaves.shift() || [];
          this._spawnEnemyWave(list, true);
          this.waveSpawning = false;
        },
      });
    }
  }

  /* ═══════ 勝負 ═══════ */
  _checkEnd(dt) {
    if (this.state !== 'fight') {
      this.endT += dt;
      if (this.endT > 1.5 && !this.ended) {
        this.ended = true;
        if (this.cfg.onEnd) this.cfg.onEnd(this._result());
      }
      return;
    }
    const p = this._teams[0].length;
    const e = this._teams[1].length + this.pendingCount();
    if (this.cfg.station && this.stationShip && !this.stationShip.alive) { this._finish(false); return; }
    if (p === 0) { this._finish(false); return; }
    if (this.mode !== 'endless' && e === 0 && !this.waveSpawning) this._finish(true);
  }

  _finish(won) {
    this.state = won ? 'won' : 'lost';
    this.endT = 0;
    this.selection.clear();
    this.aiming = null;
  }

  _result() {
    const survivors = this.ships.filter(s =>
      s.alive && s.team === 0 && !s.temp && !s.def.noBuy && s.cls !== 'drone');
    return {
      won: this.state === 'won',
      stats: this.stats,
      survivors,
      mode: this.mode,
      missionIdx: this.cfg.missionIdx,
      endlessWave: Math.max(0, this.endlessWave - 1),
    };
  }

  /* ═══════ 技能 ═══════ */
  useAbility(i) {
    if (this.state !== 'fight' || this.attract) return;
    const a = this.abl[i];
    if (!a || a.cd > 0) return;
    const id = a.d.id;
    if (id === 'strike') {
      this.aiming = this.aiming === 'strike' ? null : 'strike';
      SFX.click();
      return;
    }
    if (id === 'surge') {
      a.cd = a.d.cd;
      for (const s of this._teams[0]) {
        s.shield = Math.min(s.maxShield, s.shield + s.maxShield * 0.6);
        s.surgeT = 5;
        this.rings.push({ x: s.x, y: s.y, r: s.radius, vr: 160, life: 0.5, max: 0.5, col: '130,215,255' });
      }
      SFX.ability();
      UI.toast('護盾湧流啟動——全艦隊護盾回復', 'cyan');
    }
    if (id === 'warp') {
      a.cd = a.d.cd;
      const c = this._cent[0] || { x: -1200, y: 0 };
      for (let k = 0; k < 3; k++) {
        const s = new Ship('int', 0, c.x + U.rand(-160, 160), c.y + U.rand(-160, 160), 0, 0, { warp: true, temp: true });
        this.ships.push(s);
        this.squads[1].push(s);
      }
      SFX.warp();
      UI.toast('躍遷增援抵達——3 架攔截機加入戰場', 'cyan');
    }
  }

  confirmStrike(wx, wy) {
    const a = this.abl.find(x => x.d.id === 'strike');
    if (!a || a.cd > 0) { this.aiming = null; return; }
    a.cd = a.d.cd;
    this.aiming = null;
    this.strikes.push({ x: wx, y: wy, t: 0.9, fired: false, beamT: 0 });
    SFX.alarm();
  }

  /* ═══════ 鏡頭 ═══════ */
  _updateCam(dt) {
    const c = this.cam;
    if (this.attract) {
      const all = this.ships;
      if (all.length) {
        let sx = 0, sy = 0;
        for (const s of all) { sx += s.x; sy += s.y; }
        c.x = U.lerp(c.x, sx / all.length, Math.min(1, dt * 0.9));
        c.y = U.lerp(c.y, sy / all.length, Math.min(1, dt * 0.9));
      }
      c.z = 0.42 + Math.sin(this.time * 0.07) * 0.07;
      return;
    }
    if (c.follow) {
      let t = null;
      if (this.selection.size) {
        let sx = 0, sy = 0;
        for (const s of this.selection) { sx += s.x; sy += s.y; }
        t = { x: sx / this.selection.size, y: sy / this.selection.size };
      } else t = this._cent[0] || this._cent[1];
      if (t) {
        c.x = U.lerp(c.x, t.x, Math.min(1, dt * 2.2));
        c.y = U.lerp(c.y, t.y, Math.min(1, dt * 2.2));
      }
    }
    c.shake = Math.max(0, c.shake - 30 * dt);
  }

  panKeys(dt, keys) {
    const c = this.cam, v = 560 / c.z * dt;
    let mx = 0, my = 0;
    if (keys.has('arrowleft')) mx -= 1;
    if (keys.has('arrowright')) mx += 1;
    if (keys.has('arrowup')) my -= 1;
    if (keys.has('arrowdown')) my += 1;
    if (mx || my) { c.x += mx * v; c.y += my * v; c.follow = false; }
  }

  /* ═══════ 輸入 ═══════ */
  screenToWorld(sx, sy, view) {
    const c = this.cam;
    return { x: (sx - view.w / 2) / c.z + c.x, y: (sy - view.h / 2) / c.z + c.y };
  }

  pointerDown(btn, sx, sy, view, shift) {
    if (this.attract || this.state !== 'fight') return;
    if (this.aiming === 'strike') {
      if (btn === 0) { const w = this.screenToWorld(sx, sy, view); this.confirmStrike(w.x, w.y); }
      else this.aiming = null;
      return;
    }
    if (btn === 0) { this.selStart = { x: sx, y: sy }; this.selRect = null; }
    else if (btn === 1) this.panning = { x: sx, y: sy };
    else if (btn === 2) this._order(sx, sy, view);
  }

  pointerMove(sx, sy, view) {
    this.mouse = { x: sx, y: sy };
    if (this.selStart) {
      const dx = sx - this.selStart.x, dy = sy - this.selStart.y;
      if (this.selRect || Math.abs(dx) + Math.abs(dy) > 8) {
        this.selRect = { x1: this.selStart.x, y1: this.selStart.y, x2: sx, y2: sy };
      }
    }
    if (this.panning) {
      this.cam.x -= (sx - this.panning.x) / this.cam.z;
      this.cam.y -= (sy - this.panning.y) / this.cam.z;
      this.cam.follow = false;
      this.panning = { x: sx, y: sy };
    }
  }

  pointerUp(btn, sx, sy, view, shift) {
    if (btn === 1) { this.panning = null; return; }
    if (btn !== 0) return;
    if (this.selRect) {
      const a = this.screenToWorld(this.selRect.x1, this.selRect.y1, view);
      const b = this.screenToWorld(this.selRect.x2, this.selRect.y2, view);
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
      const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      if (!shift) this.selection.clear();
      for (const s of this._teams[0]) {
        if (s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2) this.selection.add(s);
      }
      if (this.selection.size) SFX.click();
    } else if (this.selStart) {
      const hit = this._pickShip(sx, sy, view, 0);
      if (hit) {
        if (shift) { this.selection.has(hit) ? this.selection.delete(hit) : this.selection.add(hit); }
        else { this.selection.clear(); this.selection.add(hit); }
        SFX.click();
      } else if (!shift) this.selection.clear();
    }
    this.selStart = null; this.selRect = null;
  }

  dblClick(sx, sy, view) {
    if (this.attract) return;
    const hit = this._pickShip(sx, sy, view, 0);
    if (hit) {
      this.selection.clear();
      for (const s of this._teams[0]) if (s.cls === hit.cls) this.selection.add(s);
      SFX.click();
    }
  }

  _pickShip(sx, sy, view, team) {
    const w = this.screenToWorld(sx, sy, view);
    const slack = 12 / this.cam.z;
    let best = null, bs = Infinity;
    for (const s of this._teams[team]) {
      const d = U.dist(w.x, w.y, s.x, s.y);
      if (d < s.radius + slack && d < bs) { bs = d; best = s; }
    }
    return best;
  }

  _order(sx, sy, view) {
    if (!this.selection.size) return;
    const enemy = this._pickShip(sx, sy, view, 1);
    const w = this.screenToWorld(sx, sy, view);
    if (enemy) {
      for (const s of this.selection) {
        s.order = { type: 'attack', target: enemy };
        s.target = enemy;
      }
      this.markers.push({ x: enemy.x, y: enemy.y, t: 0.7, type: 'atk', ship: enemy });
    } else {
      const arr = [...this.selection];
      arr.forEach((s, i) => {
        const r = 30 * Math.sqrt(i), a2 = i * 2.4;
        s.order = { type: 'move', x: w.x + Math.cos(a2) * r, y: w.y + Math.sin(a2) * r };
      });
      this.markers.push({ x: w.x, y: w.y, t: 0.7, type: 'move' });
    }
    SFX.click();
  }

  selectSquad(n, focus) {
    const list = this.squads[n];
    if (!list || !list.length) return;
    this.selection.clear();
    for (const s of list) this.selection.add(s);
    if (focus) {
      let sx = 0, sy = 0;
      for (const s of list) { sx += s.x; sy += s.y; }
      this.cam.x = sx / list.length; this.cam.y = sy / list.length;
      this.cam.follow = true;
    }
    SFX.click();
  }

  zoom(deltaY, sx, sy, view) {
    const c = this.cam;
    const f = deltaY > 0 ? 1 / 1.13 : 1.13;
    const before = this.screenToWorld(sx, sy, view);
    c.z = U.clamp(c.z * f, 0.3, 2.6);
    const after = this.screenToWorld(sx, sy, view);
    c.x += before.x - after.x;
    c.y += before.y - after.y;
  }

  /* ═══════ 繪製 ═══════ */
  render(ctx, view) {
    const { w, h } = view;
    const c = this.cam;
    ctx.fillStyle = '#04060d';
    ctx.fillRect(0, 0, w, h);

    /* 星空（螢幕空間視差） */
    for (const l of getStarLayers()) {
      const o = 512;
      const sx = ((-c.x * l.p) % o + o) % o - o;
      const sy = ((-c.y * l.p) % o + o) % o - o;
      for (let x = sx; x < w; x += o) for (let y = sy; y < h; y += o) ctx.drawImage(l.c, x, y);
    }

    const shx = c.shake ? U.rand(-c.shake, c.shake) : 0;
    const shy = c.shake ? U.rand(-c.shake, c.shake) : 0;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(c.z, c.z);
    ctx.translate(-(c.x + shx), -(c.y + shy));

    for (const nb of this.nebula) ctx.drawImage(nb.c, nb.x - nb.r, nb.y - nb.r, nb.r * 2, nb.r * 2);
    this._drawMarkers(ctx);

    ctx.globalCompositeOperation = 'lighter';
    this._drawFlamesTrails(ctx);
    this._drawBeams(ctx);
    ctx.globalCompositeOperation = 'source-over';

    for (const s of this.ships) this._drawShip(ctx, s);

    ctx.globalCompositeOperation = 'lighter';
    this._drawShields(ctx);
    this._drawParticlesRings(ctx);
    this._drawStrikes(ctx);
    this._drawTelegraphs(ctx);
    ctx.globalCompositeOperation = 'source-over';

    if (!this.attract) this._drawShipUI(ctx);
    ctx.restore();

    if (!this.attract) this._drawScreenUI(ctx, view);
  }

  _drawFlamesTrails(ctx) {
    /* 小型艦引擎光尾 */
    for (const s of this.ships) {
      if (!s.trail || s.trail.length < 6) continue;
      const T = TEAMS[s.team];
      ctx.strokeStyle = `rgba(${T.trail},0.13)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.trail[0], s.trail[1]);
      for (let i = 2; i < s.trail.length; i += 2) ctx.lineTo(s.trail[i], s.trail[i + 1]);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    /* 引擎尾焰 */
    for (const s of this.ships) {
      if (s.spawnT > 0 || !s.thrusting || s.def.stationary) continue;
      const T = TEAMS[s.team];
      const L = s.radius * (1.15 + 0.45 * Math.sin(this.time * 26 + s.uid * 2.1)) * s.thrusting;
      const bx = s.x - Math.cos(s.angle) * s.radius * 0.92;
      const by = s.y - Math.sin(s.angle) * s.radius * 0.92;
      const px = -Math.sin(s.angle), py = Math.cos(s.angle);
      const ww = s.radius * 0.34;
      ctx.fillStyle = `rgba(${T.trail},0.3)`;
      ctx.beginPath();
      ctx.moveTo(bx + px * ww, by + py * ww);
      ctx.lineTo(bx - px * ww, by - py * ww);
      ctx.lineTo(bx - Math.cos(s.angle) * L, by - Math.sin(s.angle) * L);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(bx + px * ww * 0.4, by + py * ww * 0.4);
      ctx.lineTo(bx - px * ww * 0.4, by - py * ww * 0.4);
      ctx.lineTo(bx - Math.cos(s.angle) * L * 0.55, by - Math.sin(s.angle) * L * 0.55);
      ctx.closePath(); ctx.fill();
    }
    /* 飛彈軌跡與彈頭、砲彈曳光 */
    for (const p of this.projectiles) {
      const T = TEAMS[p.team];
      if (p.t === 'missile') {
        const tr = p.trail;
        if (tr.length >= 6) {
          ctx.strokeStyle = `rgba(${T.trail},0.15)`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(tr[0], tr[1]);
          for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          const mid = Math.max(0, tr.length - 18);
          ctx.strokeStyle = `rgba(${T.trail},0.5)`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(tr[mid], tr[mid + 1]);
          for (let i = mid + 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, U.TAU); ctx.fill();
      } else if (p.t === 'plasma') {
        ctx.fillStyle = `rgba(${T.trail},0.2)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.6, 0, U.TAU); ctx.fill();
        ctx.fillStyle = T.bullet;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, U.TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.45, 0, U.TAU); ctx.fill();
      } else {
        ctx.strokeStyle = T.bullet;
        ctx.lineWidth = p.anti ? 1.2 : 1.8;
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  _drawBeams(ctx) {
    for (const b of this.beams) {
      if (!b.src.alive || !b.tgt.alive) continue;
      const T = TEAMS[b.src.team];
      const n = b.src.nose();
      const al = U.clamp(b.t / b.max, 0, 1);
      const wob = Math.sin(this.time * 40) * 1.5;
      const tx = b.tgt.x + wob, ty = b.tgt.y + wob;
      const base = b.heavy ? 15 : 7;
      ctx.strokeStyle = `rgba(${T.trail},${0.13 * al})`;
      ctx.lineWidth = base;
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = T.acc;
      ctx.globalAlpha = 0.4 * al;
      ctx.lineWidth = base * 0.45;
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalAlpha = 0.95 * al;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawShip(ctx, s) {
    if (s.spawnT > 0.3) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${TEAMS[s.team].trail},${s.spawnT})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius * (2.5 - s.spawnT * 2), 0, U.TAU);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const spr = Sprites.get(s.cls, s.team);
    if (!spr) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    if (s.spawnT > 0) ctx.globalAlpha = 1 - s.spawnT / 0.3;
    ctx.drawImage(spr.c, -spr.w / 2, -spr.w / 2, spr.w, spr.w);
    ctx.restore();
  }

  _drawShields(ctx) {
    for (const s of this.ships) {
      const since = this.time - s.lastHit;
      if (since > 0.35 || s.shield <= 0) continue;
      const al = (1 - since / 0.35) * 0.85;
      ctx.strokeStyle = TEAMS[s.team].shield;
      ctx.globalAlpha = al;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius * 1.4, s.lastHitAngle - 0.9, s.lastHitAngle + 0.9);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawParticlesRings(ctx) {
    for (const p of this.particles) {
      const al = U.clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = al;
      ctx.fillStyle = p.color;
      if (p.flash) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (2 - al), 0, U.TAU);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      ctx.strokeStyle = `rgba(${r.col},${(r.life / r.max) * 0.7})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, U.TAU); ctx.stroke();
    }
  }

  _drawStrikes(ctx) {
    for (const s of this.strikes) {
      if (!s.fired) {
        const pr = 1 - s.t / 0.9;
        ctx.strokeStyle = `rgba(255,209,102,${0.5 + 0.4 * Math.sin(this.time * 24)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 210 * (1.4 - pr * 0.4), 0, U.TAU); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 26, s.y); ctx.lineTo(s.x + 26, s.y);
        ctx.moveTo(s.x, s.y - 26); ctx.lineTo(s.x, s.y + 26);
        ctx.stroke();
      } else {
        const al = s.beamT / 0.38;
        ctx.fillStyle = `rgba(200,240,255,${al * 0.25})`;
        ctx.fillRect(s.x - 30, s.y - 1500, 60, 1500);
        ctx.fillStyle = `rgba(255,255,255,${al * 0.85})`;
        ctx.fillRect(s.x - 8, s.y - 1500, 16, 1500);
      }
    }
  }

  _drawTelegraphs(ctx) {
    for (const s of this.ships) {
      if (s.team !== 1) continue;
      for (const w of s.weapons) {
        if (w.d.t !== 'doom' || w.state !== 'charge' || !w.lock || !w.lock.alive) continue;
        const al = 0.35 + 0.3 * Math.sin(this.time * 22);
        ctx.strokeStyle = `rgba(255,70,50,${al})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([16, 10]);
        const n = s.nose();
        ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(w.lock.x, w.lock.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(w.lock.x, w.lock.y, w.lock.radius * 1.8, 0, U.TAU); ctx.stroke();
      }
    }
  }

  _drawMarkers(ctx) {
    for (const m of this.markers) {
      const al = m.t / 0.7;
      const x = m.type === 'atk' && m.ship && m.ship.alive ? m.ship.x : m.x;
      const y = m.type === 'atk' && m.ship && m.ship.alive ? m.ship.y : m.y;
      const r = 14 + (1 - al) * 16;
      ctx.strokeStyle = m.type === 'atk' ? `rgba(255,90,60,${al})` : `rgba(120,230,255,${al})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
      ctx.closePath(); ctx.stroke();
    }
  }

  _drawShipUI(ctx) {
    const z = this.cam.z;
    /* 被集火目標標記 */
    const focused = new Set();
    for (const s of this.selection) {
      if (s.order && s.order.type === 'attack' && s.order.target.alive) focused.add(s.order.target);
    }
    for (const t of focused) {
      ctx.strokeStyle = 'rgba(255,90,60,0.9)';
      ctx.lineWidth = 2 / z;
      const r = t.radius * 1.5, g = r * 0.45;
      for (let q = 0; q < 4; q++) {
        const a = q * Math.PI / 2 + Math.PI / 4 + this.time * 1.5;
        const cx = t.x + Math.cos(a) * r, cy = t.y + Math.sin(a) * r;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, a - 0.3, a + 0.3);
        ctx.stroke();
      }
    }
    for (const s of this.ships) {
      if (s.spawnT > 0) continue;
      const sel = this.selection.has(s);
      /* 選取圈 */
      if (sel) {
        ctx.strokeStyle = 'rgba(120,230,255,0.85)';
        ctx.lineWidth = 1.6 / z;
        ctx.setLineDash([6 / z, 5 / z]);
        ctx.lineDashOffset = -this.time * 24;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.radius * 1.45 + 3, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      /* 血條 */
      const damaged = s.hull < s.maxHull - 0.5 || s.shield < s.maxShield - 0.5;
      if (!damaged && !sel) continue;
      if (z < 0.45 && !sel && s.radius < 20) continue;
      const bw = Math.max(26, s.radius * 2.2), bh = 3.4 / z;
      const bx = s.x - bw / 2, by = s.y - s.radius - 13 / z;
      ctx.fillStyle = 'rgba(6,10,18,0.75)';
      ctx.fillRect(bx, by, bw, bh * 2 + 1.5 / z);
      if (s.maxShield > 0) {
        ctx.fillStyle = TEAMS[s.team].shield;
        ctx.fillRect(bx, by, bw * (s.shield / s.maxShield), bh * 0.85);
      }
      ctx.fillStyle = s.team === 0 ? '#7ef29a' : '#ff8a66';
      ctx.fillRect(bx, by + bh, bw * U.clamp(s.hull / s.maxHull, 0, 1), bh);
      /* 星級 */
      if (s.rank > 0 && s.team === 0) {
        ctx.fillStyle = '#ffd166';
        ctx.font = `${10 / z}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('★'.repeat(s.rank), s.x, by - 4 / z);
      }
    }
  }

  _drawScreenUI(ctx, view) {
    /* 框選矩形 */
    if (this.selRect) {
      const r = this.selRect;
      ctx.strokeStyle = 'rgba(120,230,255,0.9)';
      ctx.fillStyle = 'rgba(120,230,255,0.08)';
      ctx.lineWidth = 1.2;
      const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2);
      const w2 = Math.abs(r.x2 - r.x1), h2 = Math.abs(r.y2 - r.y1);
      ctx.fillRect(x, y, w2, h2);
      ctx.strokeRect(x, y, w2, h2);
    }
    /* 軌道打擊瞄準 */
    if (this.aiming === 'strike') {
      const m = this.mouse;
      ctx.strokeStyle = `rgba(255,209,102,${0.6 + 0.35 * Math.sin(this.time * 16)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(m.x, m.y, 210 * this.cam.z, 0, U.TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(m.x - 18, m.y); ctx.lineTo(m.x + 18, m.y);
      ctx.moveTo(m.x, m.y - 18); ctx.lineTo(m.x, m.y + 18);
      ctx.stroke();
      ctx.font = '12px sans-serif';
      ctx.fillStyle = 'rgba(255,209,102,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('點擊目標區域 · 右鍵取消', m.x, m.y + 230 * this.cam.z + 16);
    }
    /* 敵艦隊方向指示 */
    const ec = this._cent[1];
    if (ec && this.state === 'fight') {
      const c = this.cam;
      const sx = (ec.x - c.x) * c.z + view.w / 2;
      const sy = (ec.y - c.y) * c.z + view.h / 2;
      if (sx < -20 || sx > view.w + 20 || sy < -20 || sy > view.h + 20) {
        const cx = view.w / 2, cy = view.h / 2;
        const a = Math.atan2(sy - cy, sx - cx);
        const ex = U.clamp(sx, 46, view.w - 46), ey = U.clamp(sy, 66, view.h - 86);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(a);
        ctx.fillStyle = `rgba(255,90,60,${0.55 + 0.3 * Math.sin(this.time * 6)})`;
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-8, 8); ctx.lineTo(-4, 0); ctx.lineTo(-8, -8);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  /* 小地圖 */
  renderMinimap(mm) {
    const g = mm.getContext('2d');
    const W = mm.width, H = mm.height, half = 2700;
    g.clearRect(0, 0, W, H);
    const k = H / (half * 2);
    const ox = (W - half * 2 * k) / 2, oy = 0;
    const px = x => ox + (x + half) * k;
    const py = y => oy + (y + half) * k;
    for (const s of this.ships) {
      if (s.spawnT > 0) continue;
      const sz = s.radius >= 24 ? 4 : s.radius >= 14 ? 3 : 2;
      if (s.cls === 'sta') {
        g.fillStyle = '#7ef29a';
        g.fillRect(px(s.x) - 3, py(s.y) - 3, 6, 6);
        continue;
      }
      g.fillStyle = s.team === 0
        ? (this.selection.has(s) ? '#ffffff' : '#41d9ff')
        : '#ff5a3c';
      g.fillRect(px(s.x) - sz / 2, py(s.y) - sz / 2, sz, sz);
    }
    const c = this.cam, vw = window.innerWidth / c.z, vh = window.innerHeight / c.z;
    g.strokeStyle = 'rgba(200,230,255,0.5)';
    g.lineWidth = 1;
    g.strokeRect(px(c.x - vw / 2), py(c.y - vh / 2), vw * k, vh * k);
  }

  minimapClick(mx, my, mm) {
    const W = mm.width, H = mm.height, half = 2700;
    const k = H / (half * 2);
    const ox = (W - half * 2 * k) / 2;
    this.cam.x = (mx - ox) / k - half;
    this.cam.y = my / k - half;
    this.cam.follow = false;
  }
}
