'use strict';
/* ═══════════ 鏡頭與操作 ═══════════ */

const Cam = {
  target: new THREE.Vector3(-4600, 0, 0),
  yaw: Math.PI, pitch: 0.62, dist: 950,
  follow: false, cinematic: false,

  /* 螢幕方向對應的地面向量（右、上） */
  axes() {
    return {
      right: new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
      fwd: new THREE.Vector3(-Math.cos(this.yaw), 0, -Math.sin(this.yaw)),
    };
  },

  apply(camera, dt, shake) {
    if (this.cinematic) this.yaw += dt * 0.06;
    if (this.follow) {
      const sel = [...World.selection].filter(e => e.alive);
      let tx, tz;
      if (sel.length) {
        tx = 0; tz = 0;
        for (const e of sel) { tx += e.pos.x; tz += e.pos.z; }
        tx /= sel.length; tz /= sel.length;
      } else if (World.playerBase && World.playerBase.alive) {
        tx = World.playerBase.pos.x; tz = World.playerBase.pos.z;
      }
      if (tx !== undefined) {
        this.target.x = U.lerp(this.target.x, tx, Math.min(1, dt * 3));
        this.target.z = U.lerp(this.target.z, tz, Math.min(1, dt * 3));
      }
    }
    this.target.x = U.clamp(this.target.x, -MAP.W - 100, MAP.W + 100);
    this.target.z = U.clamp(this.target.z, -MAP.H - 100, MAP.H + 100);
    this.pitch = U.clamp(this.pitch, 0.15, 1.5);
    this.dist = U.clamp(this.dist, 220, 12500);   // 地圖 3 倍後要能拉到看見全圖
    /* 平滑層：目標值→顯示值（縮放滑行、環繞阻尼、平移微濾），操作手感電影化 */
    if (!this._s) this._s = { yaw: this.yaw, pitch: this.pitch, dist: this.dist, tx: this.target.x, tz: this.target.z };
    const s = this._s;
    const kR = 1 - Math.pow(0.00005, dt), kD = 1 - Math.pow(0.008, dt), kT = 1 - Math.pow(1e-8, dt);
    s.yaw += U.angDiff(s.yaw, this.yaw) * kR;
    s.pitch += (this.pitch - s.pitch) * kR;
    s.dist += (this.dist - s.dist) * kD;
    s.tx += (this.target.x - s.tx) * kT;
    s.tz += (this.target.z - s.tz) * kT;
    const h = Math.cos(s.pitch) * s.dist;
    /* trauma 制震動：強度=trauma²（猛起快收），roll 旋轉震才有「被衝擊波掃到」的體感 */
    const tr = shake ? shake * shake : 0;
    const mag = tr * 26;
    const sx = mag ? U.rand(-mag, mag) : 0;
    const sy = mag ? U.rand(-mag, mag) : 0;
    camera.position.set(
      s.tx + Math.cos(s.yaw) * h + sx,
      this.target.y + Math.sin(s.pitch) * s.dist + sy * 0.5,
      s.tz + Math.sin(s.yaw) * h + sx * 0.6);
    camera.lookAt(s.tx, this.target.y, s.tz);
    if (tr > 0.003) camera.rotation.z += U.rand(-1, 1) * tr * 0.018;
  },
  /* 瞬移鏡頭（開新局等場合）：清掉平滑殘留 */
  snap() { this._s = null; },

  preset(i) {
    const P = [
      { pitch: 1.32, dist: 9000 },   // 高空俯瞰（全局，配合 3 倍地圖）
      { pitch: 0.62, dist: 1050 },   // 指揮視角
      { pitch: 0.26, dist: 430 },    // 艦橋低角
    ][i % 3];
    this._animTo = { ...P, t: 0 };
  },
  update(dt) {
    if (this._animTo) {
      const a = this._animTo;
      a.t += dt * (a.rate || 3);
      const k = Math.min(1, dt * (a.rate || 3) * 1.7);
      this.pitch = U.lerp(this.pitch, a.pitch, k);
      this.dist = U.lerp(this.dist, a.dist, k);
      if (a.yaw !== undefined) this.yaw += U.angDiff(this.yaw, a.yaw) * k;
      if (a.t > 1.4) {
        /* 結束時補到定位（顯示層的平滑器會把殘餘距離滑順帶完） */
        this.pitch = a.pitch; this.dist = a.dist;
        if (a.yaw !== undefined) this.yaw = a.yaw;
        this._animTo = null;
      }
    }
  },
};

const Input = {
  ray: new THREE.Raycaster(),
  plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  mouse: { x: 0, y: 0 },
  edgeScroll: true, mouseIn: false,   // 滑鼠貼邊捲動地圖
  hover: null, hoverT: 0,
  dragStart: null, dragRect: null, panning: null,
  placing: null, ghost: null, placeOK: false,
  cmdMode: null,   // 'patrol'＝按了 P、等右鍵點巡邏點
  groups: {}, _lastGroup: { n: 0, t: 0 },
  presetIdx: 1,
  keys: new Set(),

  init(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.ray.layers.enableAll();   // 合批的物件在 layer 1（camera 不畫），點選仍要打得到

    canvas.addEventListener('mousedown', e => this._down(e));
    window.addEventListener('mousemove', e => { this.mouseIn = true; this._move(e); });
    /* 滑鼠離開視窗／切走視窗就停止邊緣捲動 */
    document.documentElement.addEventListener('mouseleave', () => { this.mouseIn = false; });
    window.addEventListener('blur', () => { this.mouseIn = false; });
    window.addEventListener('mouseup', e => this._up(e));
    canvas.addEventListener('dblclick', e => this._dbl(e));
    canvas.addEventListener('wheel', e => { e.preventDefault(); this._wheel(e); }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this._key(e, true));
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
  },

  groundPoint(sx, sy) {
    const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out) ? out : null;
  },

  /* ── 拾取（10-07 改）：射線最近實體，不再對網格做 raycast ──
     試玩回饋「研究站點不到、很多單位不好點」：W17 研究站是桁架鏤空、中心點下去射線直接穿過；
     小船只有 8 單位半徑。改成每個實體一顆「拾取球」：
       船 半徑×1.6（至少 16）、建築 半徑×1.8（至少 40）、小行星 半徑×1.0（避免右鍵移動被吃成採礦）；
     射線到球心距離 ≤ 拾取半徑，或螢幕像素距離 ≤ PICK_PX（遠距離縮小時的第二道保險）就算候選。
     多個候選取「螢幕距離＋0.25×自身半徑」最小者 → 同樣靠近時小單位優先（大母艦不會蓋住旁邊的研究站）。
     隱藏中的實體（mesh 或祖先 visible=false，例如戰爭迷霧）不可點。左鍵選取、雙擊、右鍵下令全部共用。 */
  PICK_PX: 18,
  pickRadius(e) {
    const r = e.radius || 10;
    if (e.kind === 'ship') return Math.max(r * 1.6, 16);
    if (e.kind === 'bld') return Math.max(r * 1.8, 40);
    if (e.kind === 'ast') return r;
    return r * 1.4;
  },
  _pickShown(m) {
    for (let o = m; o; o = o.parent) {
      if (!o.visible) return false;
      if (o === World.pickRoot) return true;
    }
    return false;
  },
  pickEnt(sx, sy) {
    if (!World.pickRoot) return null;
    const cam = this.camera;
    const ndc = this._pNdc || (this._pNdc = new THREE.Vector2());
    ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, cam);
    const ray = this.ray.ray;
    const c = this._pC || (this._pC = new THREE.Vector3());
    const vi = cam.matrixWorldInverse.elements;
    /* 深度 1 處每世界單位幾個像素（透視相機） */
    const pxK = innerHeight * 0.5 * cam.projectionMatrix.elements[5];
    let best = null, bestKey = Infinity;
    for (const e of World.ents) {
      if (e.alive === false || !e.mesh || !this._pickShown(e.mesh)) continue;
      if (typeof Fog !== 'undefined' && Fog.hiddenEnt(e)) continue;   // 迷霧中的敵人點不到
      c.set(e.pos.x, e.pos.y + (e.kind === 'bld' ? e.radius * 0.3 : 0), e.pos.z);
      const depth = -(vi[2] * c.x + vi[6] * c.y + vi[10] * c.z + vi[14]);
      if (depth <= 1) continue;
      const d = Math.sqrt(ray.distanceSqToPoint(c));
      const ppu = pxK / depth;
      if (d > this.pickRadius(e) && d * ppu > this.PICK_PX) continue;
      const key = (d + 0.25 * (e.radius || 10)) * ppu;
      if (key < bestKey) { bestKey = key; best = e; }
    }
    return best;
  },

  _down(e) {
    if (Game.state !== 'play') return;
    this.mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 1) { e.preventDefault(); this.panning = { x: e.clientX, y: e.clientY }; return; }
    if (this.placing) {
      if (e.button === 0 && this.placeOK) {
        const p = this.groundPoint(e.clientX, e.clientY);
        if (p && World.place(this.placing, p.x, p.z)) this.stopPlace();
      } else if (e.button === 2) this.stopPlace();
      return;
    }
    if (e.button === 0) { this.cmdMode = null; this.dragStart = { x: e.clientX, y: e.clientY }; this.dragRect = null; }
    else if (e.button === 2) {
      /* 家園式：右鍵拖曳＝球形環繞；右鍵點擊＝下令（放開時判定） */
      this.rmb = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    }
  },

  _move(e) {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.panning) {
      const dx = e.clientX - this.panning.x, dy = e.clientY - this.panning.y;
      this.panning = { x: e.clientX, y: e.clientY };
      this._pan(dx, dy);
      return;
    }
    if (this.rmb) {
      const dx = e.clientX - this.rmb.x, dy = e.clientY - this.rmb.y;
      if (this.rmb.moved || Math.abs(e.clientX - this.rmb.sx) + Math.abs(e.clientY - this.rmb.sy) > 7) {
        this.rmb.moved = true;
        Cam._animTo = null;
        Cam.yaw += dx * 0.0052;
        Cam.pitch += dy * 0.0042;
      }
      this.rmb.x = e.clientX; this.rmb.y = e.clientY;
      return;
    }
    if (this.dragStart) {
      const dx = e.clientX - this.dragStart.x, dy = e.clientY - this.dragStart.y;
      if (this.dragRect || Math.abs(dx) + Math.abs(dy) > 9) {
        this.dragRect = { x1: this.dragStart.x, y1: this.dragStart.y, x2: e.clientX, y2: e.clientY };
      }
    }
  },

  /* 中鍵平移：「抓住地圖」手感——畫面內容跟著游標走 */
  _pan(dx, dy) {
    Cam._animTo = null;
    const k = Cam.dist * 0.0016;
    const { right, fwd } = Cam.axes();
    Cam.target.addScaledVector(right, -dx * k);
    Cam.target.addScaledVector(fwd, dy * k);
    Cam.follow = false;
  },

  _up(e) {
    if (e.button === 1) { this.panning = null; return; }
    if (e.button === 2) {
      const wasOrbit = this.rmb && this.rmb.moved;
      this.rmb = null;
      if (!wasOrbit && Game.state === 'play' && !this.placing) this._order(e.clientX, e.clientY, e);
      return;
    }
    if (e.button !== 0 || Game.state !== 'play') return;
    if (this.dragRect) {
      /* 框選（投影到螢幕座標判定） */
      const r = this.dragRect;
      const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2);
      const y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2);
      if (!e.shiftKey) World.selection.clear();
      const v = new THREE.Vector3();
      for (const s of World.teams[0]) {
        v.copy(s.pos).project(this.camera);
        if (v.z > 1) continue;
        const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
        if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) World.selection.add(s);
      }
      if (!e.shiftKey) {
        /* 智慧過濾：戰鬥艦＋採礦船混選時排除採礦船（SC2 慣例，避免拉工人上戰場） */
        const selA = [...World.selection];
        if (selA.some(x => !x.def.eco) && selA.some(x => x.def.eco)) {
          for (const x of selA) if (x.def.eco) World.selection.delete(x);
        }
        /* 空框：撿框內第一座我方建築（框選本來選不到建築） */
        if (!World.selection.size) {
          for (const b of World.blds[0]) {
            if (!b.alive) continue;
            v.copy(b.pos).project(this.camera);
            if (v.z > 1) continue;
            const bx = (v.x + 1) / 2 * innerWidth, by = (1 - v.y) / 2 * innerHeight;
            if (bx >= x1 && bx <= x2 && by >= y1 && by <= y2) { World.selection.add(b); break; }
          }
        }
      }
      if (World.selection.size) SFX.click();
    } else if (this.dragStart) {
      const ent = this.pickEnt(e.clientX, e.clientY);
      if (ent) {
        if (e.shiftKey && ent.team === 0) {
          World.selection.has(ent) ? World.selection.delete(ent) : World.selection.add(ent);
        } else {
          World.selection.clear();
          World.selection.add(ent);
        }
        SFX.click();
      } else if (!e.shiftKey) World.selection.clear();
    }
    this.dragStart = null; this.dragRect = null;
  },

  _dbl(e) {
    if (Game.state !== 'play') return;
    const ent = this.pickEnt(e.clientX, e.clientY);
    if (ent && ent.team === 0 && ent.kind === 'ship') {
      World.selection.clear();
      for (const s of World.teams[0]) if (s.cls === ent.cls) World.selection.add(s);
      SFX.click();
    }
  },

  _order(sx, sy, ev) {
    const sel = [...World.selection].filter(x => x.team === 0 && x.kind === 'ship');
    if (!sel.length) {
      /* 沒選船、但選著生產建築 → 右鍵＝設定集結點 */
      const bld = [...World.selection].find(x => x.team === 0 && x.kind === 'bld' && x.def.builds && x.alive);
      if (bld) {
        const ent2 = this.pickEnt(sx, sy);
        if (ent2 === bld) { bld.rally = null; UI.toast('集結點已清除'); SFX.click(); return; }
        if (ent2 && ent2.kind === 'ast' && ent2.ore > 0) bld.rally = { ast: ent2 };
        else {
          const p = this.groundPoint(sx, sy);
          if (p) bld.rally = { x: p.x, z: p.z };
        }
        if (bld.rally) {
          FX.ping(bld.rally.ast ? bld.rally.ast.pos : { x: bld.rally.x, z: bld.rally.z }, 0xffd166);
          UI.toast(bld.rally.ast ? '集結點：出廠採礦船將直奔此礦' : '已設定集結點（右鍵點建築自身＝清除）');
          SFX.click();
        }
      }
      return;
    }
    /* P 巡邏模式：右鍵點地圖＝設巡邏點（Shift＝加點並保持模式）；
       沒進 P 模式時，選取中有艦在巡邏、Shift+右鍵點空地＝在路線尾端加點 */
    const patrolling = sel.some(s => s.order && s.order.t === 'patrol');
    if (this.cmdMode === 'patrol' || (ev && ev.shiftKey && patrolling && !this.pickEnt(sx, sy))) {
      const p = this.groundPoint(sx, sy);
      if (p) this.patrolAt(sel, p.x, p.z, !!(ev && ev.shiftKey));
      if (!(ev && ev.shiftKey)) this.cmdMode = null;
      return;
    }
    /* Ctrl+右鍵＝攻擊移動 */
    if (ev && ev.ctrlKey) {
      const p = this.groundPoint(sx, sy);
      if (p) { World.issueOrder(sel, 'amove', { x: p.x, z: p.z }); FX.ping(p, 0xffa14d); }
      return;
    }
    const ent = this.pickEnt(sx, sy);
    if (ent && ent.team > 0) {
      World.issueOrder(sel, 'attack', { ent });
      FX.ping(ent.pos, 0xff5a3c);
    } else if (ent && ent.kind === 'ast' && ent.ore > 0) {
      World.issueOrder(sel, 'mine', { ast: ent });
      FX.ping(ent.pos, 0x8ef5d8);
    } else {
      const p = this.groundPoint(sx, sy);
      if (p) {
        World.issueOrder(sel, 'move', { x: p.x, z: p.z });
        FX.ping(p, 0x41d9ff);
      }
    }
  },

  /* 下巡邏指令（地圖右鍵與小地圖右鍵共用）；add＝加在現有路線尾端 */
  patrolAt(sel, x, z, add) {
    const war = sel.filter(s => s.team === 0 && s.kind === 'ship' && !s.def.eco);
    if (!war.length) { UI.toast('採礦船不能巡邏', 'red'); return false; }
    World.issueOrder(war, 'patrol', { x, z, add });
    FX.ping({ x, z }, 0x7ef29a);
    return true;
  },
  setFormation(f) {
    World.setFormation(f);
    UI.toast(`陣型：${FORM.names[f]}（多艘一起移動時生效）`);
    SFX.click();
  },

  _wheel(e) {
    if (Game.state !== 'play' && Game.state !== 'menu') return;
    Cam._animTo = null;
    const f = e.deltaY > 0 ? 1.13 : 1 / 1.13;
    Cam.dist *= f;
    if (e.deltaY < 0) {
      const p = this.groundPoint(e.clientX, e.clientY);
      if (p) {
        Cam.target.x = U.lerp(Cam.target.x, p.x, 0.22);
        Cam.target.z = U.lerp(Cam.target.z, p.z, 0.22);
      }
    }
  },

  _key(e, down) {
    const k = e.key.toLowerCase();
    /* Ctrl+A：全選所有戰鬥艦（不含採礦船）；不記進 keys，免得順便往左平移 */
    if (k === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (Game.state !== 'play') return;
      World.selection.clear();
      for (const s of World.ents) if (s.alive && s.team === 0 && s.kind === 'ship' && !s.def.eco && s.cls !== 'drone') World.selection.add(s);
      UI.toast(World.selection.size ? `全選戰鬥艦：${World.selection.size} 艘` : '目前沒有戰鬥艦');
      SFX.click();
      return;
    }
    this.keys.add(k);
    if (Game.state !== 'play') {
      if (k === 'escape') UI.closeModals();
      return;
    }
    /* 彈窗開啟時只允許 Esc */
    if (!U.el('modal-pause').classList.contains('hidden') || !U.el('modal-help').classList.contains('hidden')) {
      if (k === 'escape') UI.closeModals();
      return;
    }
    /* F1~F3 陣型：保持／橫列／楔形（擋掉瀏覽器說明、搜尋等預設行為） */
    if (k === 'f1' || k === 'f2' || k === 'f3') {
      e.preventDefault();
      this.setFormation(['keep', 'line', 'wedge'][+k[1] - 1]);
      return;
    }
    if (k === ' ') { e.preventDefault(); Game.togglePause(); }
    else if (k === 'f') { Cam.follow = !Cam.follow; UI.toast(Cam.follow ? '鏡頭跟隨：開' : '鏡頭跟隨：關'); }
    else if (k === 'v') { this.presetIdx = (this.presetIdx + 1) % 3; Cam.preset(this.presetIdx); SFX.click(); }
    else if (k === 'g') { Game.grid.visible = !Game.grid.visible; }
    else if (k === 'b') {
      if (World.playerBase && World.playerBase.alive) {
        World.selection.clear(); World.selection.add(World.playerBase);
        Cam.target.x = World.playerBase.pos.x; Cam.target.z = World.playerBase.pos.z;
        Cam.follow = false;
      }
    }
    else if (k === 'x') {
      this.cmdMode = null;
      if (World.selection.size) { World.issueOrder([...World.selection], 'stop'); SFX.click(); }
    }
    else if (k === 'p') {
      /* 巡邏模式：接著右鍵點地圖（採礦船不接受巡邏） */
      const selP = [...World.selection].filter(s => s.alive && s.team === 0 && s.kind === 'ship' && !s.def.eco);
      if (selP.length) { this.cmdMode = 'patrol'; UI.toast('巡邏：右鍵點地圖設巡邏點（Shift＋右鍵連加多點，Esc 取消）'); SFX.click(); }
      else if (World.selection.size) UI.toast('採礦船不能巡邏', 'red');
    }
    else if (k === 'h') {
      /* 駐守：原地開火不追擊 */
      const selH = [...World.selection].filter(s => s.team === 0 && s.kind === 'ship' && !s.def.eco);
      if (selH.length) {
        for (const s of selH) s.order = { t: 'hold', x: s.pos.x, z: s.pos.z };
        UI.toast('駐守中——原地防禦不追擊，再下指令解除');
        SFX.click();
      }
    }
    else if (k === 'n') {
      const ap = World.jumpTarget();
      if (ap) { Cam.target.x = ap.x; Cam.target.z = ap.z; Cam.follow = false; SFX.click(); }
    }
    else if (k >= '1' && k <= '4') {
      const n = +k;
      if (e.ctrlKey) {
        this.groups[n] = [...World.selection].filter(x => x.team === 0);
        UI.toast(`已編入第 ${n} 隊（${this.groups[n].length} 單位）`);
        e.preventDefault();
      } else {
        const g = (this.groups[n] || []).filter(x => x.alive);
        if (g.length) {
          World.selection.clear();
          g.forEach(x => World.selection.add(x));
          const now = performance.now();
          if (this._lastGroup.n === n && now - this._lastGroup.t < 450) {
            let tx = 0, tz = 0;
            g.forEach(x => { tx += x.pos.x; tz += x.pos.z; });
            Cam.target.x = tx / g.length; Cam.target.z = tz / g.length;
          }
          this._lastGroup = { n, t: now };
          SFX.click();
        }
      }
    }
    else if (k === 'escape') {
      if (this.cmdMode) this.cmdMode = null;
      else if (this.placing) this.stopPlace();
      else if (World.selection.size) World.selection.clear();
      else UI.toggleMenu();
    }
    /* 建造快捷鍵 */
    else if (k === 'r' && !e.ctrlKey) this.startPlace('ref');
    else if (k === 'y') this.startPlace('yard');
    else if (k === 'l') this.startPlace('lab');
    else if (k === 't') this.startPlace('tur');
    else if (k === 'o') this.startPlace('outpost');
    else if (k === 'k') this.startPlace('sat');
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  },

  startPlace(cls) {
    if (Game.state !== 'play') return;
    const def = BLDS[cls];
    if (!def || World.credits < def.cost) { UI.toast('星礦不足', 'red'); return; }
    if (def.limit && World.bldCount(0, cls) >= def.limit) { UI.toast('已達數量上限', 'red'); return; }
    this.stopPlace();
    this.cmdMode = null;
    this.placing = cls;
    this.ghost = Models.makeGhost(cls);
    Game.scene.add(this.ghost);
    /* 可建造範圍：每座我方建築畫一圈（前哨站的圈比較大），大地圖上才知道能蓋到哪 */
    /* 可建造範圍：把所有建築的範圍圓「聯集」成一塊區域（淡底色＋一條外緣線），不再每座一個圈
       （10-07 試玩回饋：砲塔一多滿地都是圓圈很干擾）。做法＝低解析 canvas 畫聯集後貼在地面平面上 */
    this._rangeRings = this._buildRangeArea();
    Game.scene.add(this._rangeRings);
    SFX.click();
  },
  _buildRangeArea() {
    const SCALE = 8;                                   // 每像素 8 個世界單位（地圖 11400×8000 → 1425×1000 px）
    const cw = Math.ceil(MAP.W * 2 / SCALE), ch = Math.ceil(MAP.H * 2 / SCALE);
    const px = x => (x + MAP.W) / SCALE, py = z => (z + MAP.H) / SCALE;
    const items = [];
    for (const b of World.blds[0]) {
      if (b.def.noExpand) continue;                    // 偵察衛星不提供建造範圍
      items.push({ x: px(b.pos.x), y: py(b.pos.z), r: (b.def.buildRange || BUILD_RANGE) / SCALE, op: !!b.def.buildRange });
    }
    const circles = (g, grow) => { for (const it of items) { g.beginPath(); g.arc(it.x, it.y, it.r + grow, 0, Math.PI * 2); g.fill(); } };
    /* 圖層 1：聯集填色（每點只畫一次，不會重疊加深） */
    const fill = document.createElement('canvas'); fill.width = cw; fill.height = ch;
    let g = fill.getContext('2d'); g.fillStyle = '#41d9ff'; circles(g, 0);
    /* 圖層 2：外緣線＝(半徑+線寬) 的聯集 挖掉 半徑 的聯集；前哨站的範圍金色、一般青色 */
    const edge = document.createElement('canvas'); edge.width = cw; edge.height = ch;
    g = edge.getContext('2d');
    for (const it of items) { g.fillStyle = it.op ? '#ffd166' : '#41d9ff'; g.beginPath(); g.arc(it.x, it.y, it.r + 2.2, 0, Math.PI * 2); g.fill(); }
    g.globalCompositeOperation = 'destination-out'; circles(g, 0);
    /* 合成 */
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    g = cv.getContext('2d');
    g.globalAlpha = 0.10; g.drawImage(fill, 0, 0);
    g.globalAlpha = 0.75; g.drawImage(edge, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
    const geo = new THREE.PlaneGeometry(MAP.W * 2, MAP.H * 2); geo.rotateX(-Math.PI / 2);   // 平面 +y → 世界 -z，對應 canvas 上緣＝z=-H
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, -38, 0); m.renderOrder = 6;        // 在迷霧平面（renderOrder 5）之上
    m.userData.dispose = () => { tex.dispose(); mat.dispose(); geo.dispose(); };
    Game.scene.add(m);
    return m;
  },
  stopPlace() {
    this.placing = null;
    if (this.ghost) { Game.scene.remove(this.ghost); this.ghost = null; }
    if (this._rangeRings) { Game.scene.remove(this._rangeRings); if (this._rangeRings.userData.dispose) this._rangeRings.userData.dispose(); this._rangeRings = null; }
  },

  update(dt) {
    /* 連續按鍵：平移（畫面方向）/ 旋轉 */
    const v = 780 * dt * (Cam.dist / 950);
    const ax = Cam.axes();
    let moved = false;
    if (this.keys.has('w') || this.keys.has('arrowup')) { Cam.target.addScaledVector(ax.fwd, v); moved = true; }
    if (this.keys.has('s') || this.keys.has('arrowdown')) { Cam.target.addScaledVector(ax.fwd, -v); moved = true; }
    if (this.keys.has('a') || this.keys.has('arrowleft')) { Cam.target.addScaledVector(ax.right, -v); moved = true; }
    if (this.keys.has('d') || this.keys.has('arrowright')) { Cam.target.addScaledVector(ax.right, v); moved = true; }
    /* 邊緣捲動：滑鼠貼著視窗邊緣就平移（RTS 慣例）；拖曳框選、中鍵平移、視窗失焦時不動 */
    if (this.edgeScroll && this.mouseIn && document.hasFocus() && !this.panning && Game.state === 'play') {
      const m = 14, mx = this.mouse.x, my = this.mouse.y;
      if (mx <= m) { Cam.target.addScaledVector(ax.right, -v); moved = true; }
      else if (mx >= innerWidth - m) { Cam.target.addScaledVector(ax.right, v); moved = true; }
      if (my <= m) { Cam.target.addScaledVector(ax.fwd, v); moved = true; }
      else if (my >= innerHeight - m) { Cam.target.addScaledVector(ax.fwd, -v); moved = true; }
    }
    if (moved) Cam.follow = false;
    if (this.keys.has('q')) Cam.yaw -= 1.4 * dt;
    if (this.keys.has('e')) Cam.yaw += 1.4 * dt;

    /* hover 節流偵測 */
    this.hoverT -= dt;
    if (this.hoverT <= 0 && Game.state === 'play') {
      this.hoverT = 0.07;
      this.hover = (this.dragRect || this.panning || this.rmb) ? null : this.pickEnt(this.mouse.x, this.mouse.y);
      /* 巡邏模式中選取沒有戰鬥艦了（死光／被換掉）就自動取消 */
      if (this.cmdMode && ![...World.selection].some(s => s.alive && s.kind === 'ship' && s.team === 0 && !s.def.eco)) this.cmdMode = null;
      this.canvas.style.cursor = (this.placing || this.cmdMode) ? 'crosshair' : (this.hover ? 'pointer' : 'default');
    }

    /* 選取光圈 */
    this._syncRings(dt);
    /* 建築光環（選取／滑過變亮、拉遠放大）＋外框光殼 */
    this.updBldGlow();
    this._syncOutlines(dt);

    /* 建築幽靈跟隨 */
    if (this.placing && this.ghost) {
      const p = this.groundPoint(this.mouse.x, this.mouse.y);
      if (p) {
        this.ghost.position.set(p.x, 0, p.z);
        const ok = this.canPlaceNow(p.x, p.z);
        if (ok !== this.placeOK) {
          this.placeOK = ok;
          Models.setGhostValid(this.ghost, ok);
        }
      }
    }
    Cam.update(dt);
  },
  canPlaceNow(x, z) {
    return World.canPlace(this.placing, x, z) && World.credits >= BLDS[this.placing].cost;
  },

  /* ── 建築常駐光環：選取變亮、滑過微亮、建造中變暗；鏡頭 dist > 3000 時光環／光點放大（不消失） ── */
  updBldGlow() {
    const dist = Cam._s ? Cam._s.dist : Cam.dist;
    const far = 1 + U.clamp((dist - 3000) / 4000, 0, 1) * 0.9;
    for (const list of World.blds) for (const b of list) {
      const ud = b.mesh && b.mesh.userData;
      if (!ud || !ud.glowRing) continue;
      const ring = ud.glowRing, dot = ud.glowDot;
      const sel = World.selection.has(b);
      ring.userData.instK = b.buildT > 0 ? 0.55 : sel ? 2.4 : this.hover === b ? 1.5 : 1;
      const rs = ring.userData.baseS * far;
      ring.scale.set(rs, 1, rs);
      if (dot) { const ds = dot.userData.baseS * far; dot.scale.set(ds, ds, 1); }
    }
  },

  /* ── 滑過／選取外框光殼（Models.makeOutlineMat）：滑過的實體＋選取中前 12 個 ── */
  OUTLINE_MAX_SEL: 12,
  _outlines: new Map(),
  _outlineParts(e) {
    const ud = e.mesh.userData, out = [];
    e.mesh.traverse(o => {
      if (!o.isMesh || o.userData.outline || o.userData.bldGlow) return;
      if (o === ud.flame || o === e.flashMesh || o === e.shieldMesh) return;
      if (!o.geometry || !o.geometry.attributes.normal) return;
      if (o.material && o.material.blending === THREE.AdditiveBlending) return;
      out.push(o);
    });
    return out;
  },
  _syncOutlines(dt) {
    const want = new Map();
    if (Game.state === 'play') {
      const h = this.hover;
      if (h && h.alive !== false && h.mesh) want.set(h, 'hover');
      let n = 0;
      for (const s of World.selection) {
        if (n >= this.OUTLINE_MAX_SEL) break;
        if (!s.alive || !s.mesh) continue;
        want.set(s, want.has(s) ? 'both' : 'sel');
        n++;
      }
    }
    /* 移除不再需要／已離場的殼 */
    for (const [e, o] of this._outlines) {
      if (want.has(e) && e.alive !== false && this._pickShown(e.mesh)) continue;
      for (const m of o.shells) if (m.parent) m.parent.remove(m);
      o.mat.dispose();
      this._outlines.delete(e);
    }
    this._olT = (this._olT || 0) + dt;
    const dist = Cam._s ? Cam._s.dist : Cam.dist;
    for (const [e, mode] of want) {
      if (!this._pickShown(e.mesh)) continue;
      let o = this._outlines.get(e);
      if (!o) {
        const hex = e.team >= 0 ? TEAMS[e.team].hex : 0x8ef5d8;
        const mat = Models.makeOutlineMat(hex);
        const shells = this._outlineParts(e).map(src => {
          const m = new THREE.Mesh(src.geometry, mat);
          m.userData.outline = true;
          m.renderOrder = 3;
          m.frustumCulled = false;
          src.add(m);
          return m;
        });
        o = { mat, shells };
        this._outlines.set(e, o);
      }
      const u = o.mat.uniforms;
      /* 粗細：依單位大小＋鏡頭距離（拉遠時邊仍有幾個像素寬） */
      u.uThick.value = U.clamp((e.radius || 10) * 0.14, 2, 8) + dist * 0.003;
      const pulse = 0.85 + 0.15 * Math.sin(this._olT * 6);
      u.uAlpha.value = mode === 'hover' ? 0.35 * pulse : mode === 'both' ? 0.42 * pulse : 0.26;
    }
  },

  /* ── 選取 / 滑過 光圈 ── */
  _syncRings(dt) {
    if (!this.selRings) {
      this.selRings = [];
      for (let i = 0; i < 44; i++) {
        const m = Models.makeSelRing(0x7fe7ff);
        m.visible = false;
        Game.scene.add(m);
        this.selRings.push(m);
      }
      this.hoverRing = Models.makeSelRing(0xffffff);
      this.hoverRing.material.opacity = 0.28;
      this.hoverRing.visible = false;
      Game.scene.add(this.hoverRing);
    }
    const sel = Game.state === 'play' ? [...World.selection].filter(x => x.alive) : [];
    for (let i = 0; i < this.selRings.length; i++) {
      const m = this.selRings[i];
      if (i < sel.length) {
        const e = sel[i];
        const r = e.radius * 1.55;
        m.position.set(e.pos.x, 2.5, e.pos.z);
        m.scale.set(r, r, r);
        m.visible = true;
      } else m.visible = false;
    }
    const h = this.hover;
    if (h && h.alive !== false && Game.state === 'play' && !World.selection.has(h)) {
      const r = h.radius * 1.5;
      this.hoverRing.position.set(h.pos.x, 2.2, h.pos.z);
      this.hoverRing.scale.set(r, r, r);
      this.hoverRing.visible = true;
    } else this.hoverRing.visible = false;
  },
};
