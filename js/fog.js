'use strict';
/* ═══════════ 戰爭迷霧 ═══════════
   三種狀態：未探索（全黑）／已探索但目前沒視野（灰暗，留地形與「上次看到的敵方建築殘影」，不顯示敵船）／
   目前有視野（正常）。我方自己的單位永遠可見；AI 不受迷霧影響（全圖視野）。

   做法：
   - 視野格子 NX×NZ（data.js 的 FOG）蓋住整張地圖。每 FOG.tick 秒把我方每個單位／建築的視野圓「蓋章」到 vis，
     explored 取歷史最大值。同一格同半徑的單位只蓋一次（艦隊擠在一起時幾乎免費）。
   - 每幀（World.update 末尾）對所有非我方實體查一次所在格 → e.seen；e.mesh.visible 跟著它，
     Batch 合批會沿父層 visible 自動略過（船殼、噴焰、引擎光點、護盾罩都跟著隱藏）。
   - 敵方建築：看得到時記下狀態；看不到時藏起真物件、改顯示凍結的殘影（另建一份模型，不更新動畫）；
     建築在玩家沒看到時被摧毀，殘影保留到再次看到那一格為止。
   - 地面：一張 NX×NZ 的 canvas 貼圖畫在 y=0 的平面上（不做深度測試，所以浮在上面的東西也一起被壓暗）。
   - 特效／彈道／光尾／飄字：以「位置在不在視野內」決定要不要畫（FX、UI 呼叫 Fog.hiddenAt）。
   - 我方被攻擊時，攻擊者現形 FOG.reveal 秒。 */

const Fog = {
  on: false,            // 本局是否啟用（Game.fog → World.fog → reset）
  vis: null, exp: null, // Uint8：0～255（羽化邊緣），≥128 算看得到
  mem: new Map(),       // 敵方建築記憶：ent.id → { e, x, z, yaw, sy, headRot, ghost }
  _t: 0,
  lastMs: 0,            // 最近一次視野蓋章耗時（效能統計）

  /* 開機一次：建立地面遮罩平面與貼圖 */
  init(scene) {
    this.scene = scene;
    const NX = FOG.NX, NZ = FOG.NZ;
    this.canvas = document.createElement('canvas');
    this.canvas.width = NX; this.canvas.height = NZ;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(NX, NZ);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.encoding = THREE.sRGBEncoding;   // canvas 顏色是 sRGB；不標的話 sRGB 輸出會把暗色提亮成灰藍
    const geo = new THREE.PlaneGeometry(MAP.W * 2, MAP.H * 2);
    geo.rotateX(-Math.PI / 2);
    /* 不做深度測試＋不寫深度＋不吃場景霧（FogExp2）＋不做色調映射：純粹一層半透明暗幕 */
    this.plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    }));
    this.plane.renderOrder = 5;          // 在一般透明物件之後、特效光點（10）之前
    this.plane.frustumCulled = false;
    this.plane.visible = false;
    scene.add(this.plane);
    this.cx = MAP.W * 2 / NX; this.cz = MAP.H * 2 / NZ;
  },

  /* 每局開始（World.init 末尾）：on＝本局是否開迷霧 */
  reset(on) {
    this.on = !!on;
    for (const m of this.mem.values()) this._dropGhost(m);
    this.mem.clear();
    const N = FOG.NX * FOG.NZ;
    this.vis = new Uint8Array(N);
    this.exp = new Uint8Array(N);
    this._t = 0;
    if (this.plane) this.plane.visible = this.on;
    if (this.on) this.update(0, true);
  },

  /* ── 查詢 ── */
  _cell(x, z) {
    const ix = Math.floor((x + MAP.W) / this.cx), iz = Math.floor((z + MAP.H) / this.cz);
    if (ix < 0 || iz < 0 || ix >= FOG.NX || iz >= FOG.NZ) return -1;
    return iz * FOG.NX + ix;
  },
  visXZ(x, z) { const c = this._cell(x, z); return c >= 0 && this.vis[c] >= 128; },
  expXZ(x, z) { const c = this._cell(x, z); return c >= 0 && this.exp[c] >= 128; },
  /* 這個位置的東西要不要藏起來（迷霧關閉時永遠 false） */
  hiddenAt(p) { return this.on && !this.visXZ(p.x, p.z); },
  /* 這個實體玩家看不看得到（點選／框選／血條／小地圖用） */
  hiddenEnt(e) {
    if (!this.on || !e) return false;
    if (e.team === 0) return false;
    if (e.kind === 'ast') return !this.expXZ(e.pos.x, e.pos.z);   // 小行星：探索過就記得
    return !e.seen;
  },
  visionOf(e) {
    let r = e.def.vision || FOG.shipVision;
    if (e.cls === 'outpost' && e.team === 0 && World.upgrades) r += FOG.outpVision * (World.upgrades.outp || 0);
    return r;
  },

  /* ── 我方被打：攻擊者現形 2 秒；採礦船被打或被迷霧中的敵人偷襲時也響警報 ── */
  onPlayerHit(e, src) {
    if (!this.on || !src || src.team === 0 || src.team < 0 || !src.alive) return;
    const wasHidden = !src.seen;
    src._revealT = World.time + FOG.reveal;
    if (wasHidden) this._applyEnt(src);
    if (e.kind === 'ship' && (e.def.eco || wasHidden)) {
      World.alarmPos = { x: e.pos.x, z: e.pos.z, until: World.time + 6 };
      if (World.time - World._alarmT > 12) {
        World._alarmT = World.time;
        SFX.alarm();
        UI.alertMsg(e.def.eco ? '⚠ 採礦船遭受攻擊！（按 N 前往）' : '⚠ 我方艦艇遭到迷霧中的敵軍攻擊！（按 N 前往）');
      }
    }
  },

  /* ── 每幀（World.update 末尾）：到時間就重算視野，然後把可見狀態套到實體上 ── */
  update(dt, force) {
    if (!this.on) return;
    this._t -= dt;
    if (this._t <= 0 || force) {
      this._t = FOG.tick;
      this._stamp();
      this._paint();
    }
    for (const e of World.ents) if (e.alive && e.team !== 0 && e.team >= 0) this._applyEnt(e);
    this._updMem();
    /* 選取中的敵方單位走進迷霧就取消選取 */
    if (World.selection.size) for (const s of World.selection) if (s.team !== 0 && this.hiddenEnt(s)) World.selection.delete(s);
    if (typeof Input !== 'undefined' && Input.hover && this.hiddenEnt(Input.hover)) Input.hover = null;
  },

  _applyEnt(e) {
    const seen = this.visXZ(e.pos.x, e.pos.z) || (e._revealT !== undefined && World.time < e._revealT);
    e.seen = seen;
    if (e.mesh && e.mesh.visible !== seen) e.mesh.visible = seen;
    if (e.kind === 'bld') {
      let m = this.mem.get(e.id);
      if (seen) {
        if (!m) this.mem.set(e.id, m = { e, ghost: null });
        m.x = e.pos.x; m.z = e.pos.z; m.yaw = e.yaw; m.sy = e.mesh.scale.y;
        const hd = e.mesh.userData.head;
        m.headRot = hd ? hd.rotation.y : 0;
        if (m.ghost) m.ghost.visible = false;
      } else if (m) this._showGhost(m);
    }
  },

  /* 記憶中的建築：死掉的那些，玩家重新看到那一格才忘掉 */
  _updMem() {
    for (const [id, m] of this.mem) {
      if (m.e.alive) continue;
      if (this.visXZ(m.x, m.z)) { this._dropGhost(m); this.mem.delete(id); }
      else this._showGhost(m);
    }
  },
  _showGhost(m) {
    if (!m.ghost) {
      const g = Models.makeBld(m.e.cls, m.e.team);
      g.traverse(o => {
        if (o.isSprite) o.visible = false;              // 信標燈／脈動光不留
        if (o.isMesh) o.userData.instK = 0.6;          // 合批的建築再暗一點（程序化建築靠地面遮罩壓暗）
      });
      g.userData.fogGhost = true;
      this.scene.add(g);
      m.ghost = g;
    }
    const g = m.ghost;
    g.position.set(m.x, 0, m.z);
    g.rotation.y = -m.yaw;
    g.scale.y = m.sy;
    if (g.userData.head) g.userData.head.rotation.y = m.headRot;
    g.visible = true;
  },
  _dropGhost(m) {
    if (!m.ghost) return;
    this.scene.remove(m.ghost);
    /* 幾何都是快取共用的，只釋放每次 makeBld 新建的 Sprite 材質 */
    m.ghost.traverse(o => { if (o.isSprite) o.material.dispose(); });
    m.ghost = null;
  },

  /* ── 視野蓋章 ── */
  _stamp() {
    const t0 = performance.now();
    const NX = FOG.NX, NZ = FOG.NZ, vis = this.vis, exp = this.exp;
    vis.fill(0);
    const done = this._done || (this._done = new Set());
    done.clear();
    const F = FOG.feather;
    const stampOne = e => {
      if (!e.alive) return;
      const R = this.visionOf(e);
      const c = this._cell(e.pos.x, e.pos.z);
      const key = c * 4096 + Math.round(R / 50);
      if (c >= 0) { if (done.has(key)) return; done.add(key); }
      const cx = (e.pos.x + MAP.W) / this.cx, cz = (e.pos.z + MAP.H) / this.cz;
      const rx = R / this.cx, rz = R / this.cz;
      const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(NX - 1, Math.floor(cx + rx));
      const z0 = Math.max(0, Math.floor(cz - rz)), z1 = Math.min(NZ - 1, Math.floor(cz + rz));
      const R2 = R * R, Ri = Math.max(0, R - F), Ri2 = Ri * Ri;
      for (let iz = z0; iz <= z1; iz++) {
        const dz = (iz + 0.5 - cz) * this.cz, dz2 = dz * dz, row = iz * NX;
        for (let ix = x0; ix <= x1; ix++) {
          const dx = (ix + 0.5 - cx) * this.cx, d2 = dx * dx + dz2;
          if (d2 >= R2) continue;
          const i = row + ix;
          if (d2 <= Ri2) { vis[i] = 255; continue; }
          const v = Math.round(255 * (R - Math.sqrt(d2)) / F);
          if (v > vis[i]) vis[i] = v;
        }
      }
    };
    for (const s of World.teams[0]) stampOne(s);
    for (const b of World.blds[0]) stampOne(b);
    for (let i = 0; i < vis.length; i++) if (vis[i] > exp[i]) exp[i] = vis[i];
    this.lastMs = performance.now() - t0;
  },

  /* 遮罩貼圖：未探索＝純黑 alphaU；已探索＝灰藍薄霧 alphaE（看得出「去過」）；有視野＝0（中間平滑過渡） */
  _paint() {
    const d = this.img.data, vis = this.vis, exp = this.exp;
    const U = FOG.alphaU * 255, E = FOG.alphaE * 255, H = FOG.haze;
    for (let i = 0, n = vis.length; i < n; i++) {
      const ex = exp[i] / 255, a = U - (U - E) * ex - E * vis[i] / 255;
      const j = i * 4;
      d[j] = H[0] * ex; d[j + 1] = H[1] * ex; d[j + 2] = H[2] * ex; d[j + 3] = a;
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.tex.needsUpdate = true;
  },

  /* ── 小地圖：在小行星之後、單位之前呼叫——疊遮罩，再畫記憶中的敵方建築殘影 ── */
  drawMinimap(g, ox, oy, k) {
    if (!this.on) return;
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.canvas, ox, oy, MAP.W * 2 * k, MAP.H * 2 * k);
    g.restore();
    for (const m of this.mem.values()) {
      if (m.e.alive && m.e.seen) continue;           // 看得到的照一般單位畫
      const isBase = m.e.cls === 'base', sz = isBase ? 7 : 4;
      const x = ox + (m.x + MAP.W) * k, y = oy + (m.z + MAP.H) * k;
      g.globalAlpha = 0.5;
      g.fillStyle = (TEAMS[m.e.team] || TEAMS[1]).css;
      g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      g.globalAlpha = 1;
    }
  },

  /* ── 統計（測試用） ── */
  stats() {
    let v = 0, x = 0;
    for (let i = 0; i < this.vis.length; i++) { if (this.vis[i] >= 128) v++; if (this.exp[i] >= 128) x++; }
    let foes = 0, seen = 0;
    for (const e of World.ents) if (e.alive && e.kind === 'ship' && e.team > 0) { foes++; if (e.seen) seen++; }
    return { visCells: v, expCells: x, cells: this.vis.length, explored: +(x / this.vis.length).toFixed(3),
      foeShips: foes, foeSeen: seen, ghosts: [...this.mem.values()].filter(m => m.ghost && m.ghost.visible).length, ms: +this.lastMs.toFixed(3) };
  },
};
