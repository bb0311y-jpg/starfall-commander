'use strict';
/* ═══════════ 特效系統（物件池） ═══════════ */

const FX = {
  scene: null,
  ribbons: [], flashes: [], rings: [], beams: [], mineBeams: [], lights: [],
  plasmaSprites: [], missileSprites: [],

  init(scene) {
    this.scene = scene;

    /* 彈道曳光：一個 LineSegments 畫所有砲彈 */
    this.bulletCap = 600;
    const bPos = new Float32Array(this.bulletCap * 6);
    const bCol = new Float32Array(this.bulletCap * 6);
    this.bulletGeo = new THREE.BufferGeometry();
    this.bulletGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.bulletGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.bulletLines = new THREE.LineSegments(this.bulletGeo, new THREE.LineBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    this.bulletLines.frustumCulled = false;
    scene.add(this.bulletLines);
    /* 彈頭光點：每顆砲彈前端一顆發光點（同一個 Points 一次畫完） */
    this.headGeo = new THREE.BufferGeometry();
    this.headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.bulletCap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.headGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.bulletCap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.bulletHeads = new THREE.Points(this.headGeo, new THREE.PointsMaterial({
      size: 11, map: Models.glowTex, vertexColors: true, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, sizeAttenuation: true,
    }));
    this.bulletHeads.frustumCulled = false;
    scene.add(this.bulletHeads);

    /* 粒子池 */
    this.pCap = 2600;
    this.pPos = new Float32Array(this.pCap * 3);
    this.pVel = new Float32Array(this.pCap * 3);
    this.pLife = new Float32Array(this.pCap);
    this.pMax = new Float32Array(this.pCap);
    this.pBase = new Float32Array(this.pCap * 3);
    this.pCol = new Float32Array(this.pCap * 3);
    this.pFree = [];
    for (let i = 0; i < this.pCap; i++) { this.pFree.push(i); this.pPos[i * 3 + 1] = -99999; }
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    /* 粒子用圓形柔光貼圖（原本是方點，近看像像素方塊） */
    this.points = new THREE.Points(this.pGeo, new THREE.PointsMaterial({
      size: 8, map: Models.glowTex, vertexColors: true, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    /* 爆閃 Sprite 池（爆炸與砲口閃光共用，擴池防搶） */
    for (let i = 0; i < 40; i++) {
      const m = new THREE.SpriteMaterial({
        map: Models.glowTex, color: 0xffffff, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0,
      });
      const s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      Batch.addGlow(s);
      this.flashes.push({ s, t: 0, max: 1, size: 10 });
    }

    /* 衝擊波環池 */
    const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true,
        opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, t: 0, max: 1, grow: 100 });
    }

    /* 光束池（外暈 + 核心圓柱） */
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group();
      const mO = new THREE.MeshBasicMaterial({ color: 0x41d9ff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.25, depthWrite: false });
      const mC = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9, depthWrite: false });
      const outer = new THREE.Mesh(cylGeo, mO);
      const core = new THREE.Mesh(cylGeo, mC);
      g.add(outer); g.add(core);
      g.visible = false;
      scene.add(g);
      /* 命中點亮團：光束打在目標上那一端的強光 */
      const flare = new THREE.Sprite(new THREE.SpriteMaterial({
        map: Models.glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
      flare.visible = false;
      scene.add(flare);
      Batch.addGlow(flare);
      this.beams.push({ g, outer, core, mO, mC, flare, used: false });
    }

    /* 採礦光束池（細線） */
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x8ef5d8, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85, depthWrite: false,
      }));
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.mineBeams.push({ line, used: false });
    }

    /* 爆炸點光源池（素材船是金屬材質，爆炸光照到船身才有「被照亮」的臨場感） */
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 900, 2);
      scene.add(l);
      this.lights.push({ l, t: 0 });
    }

    /* 爆炸碎片池（共享幾何與材質，翻滾殘骸） */
    this.debris = [];
    const dGeo = new THREE.TetrahedronGeometry(1);
    const dMat = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.9, metalness: 0.25, flatShading: true });
    for (let i = 0; i < 72; i++) {
      const m = new THREE.Mesh(dGeo, dMat);
      m.visible = false;
      scene.add(m);
      Batch.addMesh(m);   // 10-07：碎片走合批（同幾何同材質 → 1 個 draw call；大爆一次甩 10+ 塊）
      this.debris.push({ m, t: 0, max: 1, vel: new THREE.Vector3(), rx: 0, ry: 0, size: 1 });
    }

    /* 電漿 / 飛彈頭光點池 */
    const mkSprites = (arr, n, size) => {
      for (let i = 0; i < n; i++) {
        const m = new THREE.SpriteMaterial({
          map: Models.glowTex, color: 0xffffff, blending: THREE.AdditiveBlending,
          transparent: true, depthWrite: false,
        });
        const s = new THREE.Sprite(m);
        s.scale.set(size, size, 1);
        s.visible = false;
        scene.add(s);
        Batch.addGlow(s);
        arr.push(s);
      }
    };
    mkSprites(this.plasmaSprites, 60, 26);
    mkSprites(this.missileSprites, 90, 15);
    this._initPuffs(scene);
  },

  /* 戰爭迷霧：這個位置玩家看不到 → 特效不畫（迷霧關閉時永遠 false） */
  _fogHid(p) { return typeof Fog !== 'undefined' && Fog.on && !Fog.visXZ(p.x, p.z); },

  /* 重開一局：清空所有暫存特效 */
  reset() {
    this.ribbons.length = 0;
    if (this._ribAll) this._ribAll.geometry.setDrawRange(0, 0);
    for (const b of this.beams) { b.used = false; b.g.visible = false; b.flare.visible = false; }
    for (const b of this.mineBeams) { b.used = false; b.line.visible = false; }
    for (const f of this.flashes) { f.t = 0; f.s.visible = false; }
    for (const r of this.rings) { r.t = 0; r.mesh.visible = false; }
    for (const li of this.lights) { li.t = 0; li.l.intensity = 0; }
    for (const d of this.debris) { d.t = 0; d.m.visible = false; }
    this.pFree.length = 0;
    for (let i = 0; i < this.pCap; i++) {
      this.pLife[i] = 0;
      this.pPos[i * 3 + 1] = -99999;
      this.pCol[i * 3] = this.pCol[i * 3 + 1] = this.pCol[i * 3 + 2] = 0;
      this.pFree.push(i);
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.bulletGeo.setDrawRange(0, 0);
    this.headGeo.setDrawRange(0, 0);
    for (const s of this.plasmaSprites) s.visible = false;
    for (const s of this.missileSprites) s.visible = false;
    this._resetPuffs();
  },

  /* ── 彩帶軌跡 ── */
  /* maxAge：每個點活多久（秒）。船停下來不再推新點時，舊點照樣到期消失，光尾不會凍在原地 */
  /* 合批：所有光尾每幀寫進同一條 LineSegments（_ribAll），一次畫完；rb 只存點與顏色梯度 */
  ribbonAcquire(teamHex, maxPts, maxAge) {
    const N = maxPts || 34;
    const colArr = new Float32Array(N * 3);
    const col = new THREE.Color(teamHex);
    for (let i = 0; i < N; i++) {
      const k = (i / (N - 1)) * 0.75;
      colArr[i * 3] = col.r * k; colArr[i * 3 + 1] = col.g * k; colArr[i * 3 + 2] = col.b * k;
    }
    if (!this._ribAll) {
      this._ribCap = 24000;                        // 線段上限（點 ×2）
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this._ribCap * 6), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this._ribCap * 6), 3).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      this._ribAll = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
      this._ribAll.frustumCulled = false;
      this.scene.add(this._ribAll);
    }
    const rb = { colArr, N, pts: [], ages: [], maxAge: maxAge || 1, dying: false };
    this.ribbons.push(rb);
    rb.push = (x, y, z) => {
      if (typeof Fog !== 'undefined' && Fog.on && !Fog.visXZ(x, z)) return;   // 迷霧中不留光尾
      rb.pts.push(x, y, z);
      rb.ages.push(0);
      if (rb.pts.length > rb.N * 3) { rb.pts.splice(0, 3); rb.ages.shift(); }
      rb.dirty = true;
    };
    rb.release = () => { rb.dying = true; };
    return rb;
  },

  /* ── 爆炸 ── */
  explode(pos, size, teamHex) {
    if (this._fogHid(pos)) return;
    /* 閃光 */
    const f = this.flashes.find(x => x.t <= 0);
    if (f) {
      f.t = 0.28; f.max = 0.28; f.size = size * 3.2;
      f.s.position.copy(pos);
      f.s.material.color.setHex(0xffffff);
      f.s.visible = true;
    }
    /* 粒子 */
    const col = new THREE.Color(teamHex);
    const gold = new THREE.Color(0xffd166);
    const n = U.clamp(Math.round(size * 1.1), 8, 42);
    for (let i = 0; i < n; i++) {
      const c = Math.random() < 0.45 ? gold : col;
      this.spark(pos, U.rand(30, 60 + size * 7), U.rand(0.4, 1.0), c);
    }
    /* 小爆（<14：飛彈／電漿／攔截機）：加一小團火、環短一點、餘燼少一點——快、小、乾淨 */
    const small = size < 14;
    if (small) this._miniFire(pos, size);
    /* 衝擊波 */
    const r = this.rings.find(x => x.t <= 0);
    if (r) {
      r.t = r.max = small ? 0.38 : 0.55; r.grow = 90 + size * 7; r.base = 6;
      r.mesh.position.set(pos.x, Math.max(4, pos.y), pos.z);
      r.mesh.scale.set(6, 6, 6);
      r.mesh.material.color.setHex(teamHex);
      r.mesh.visible = true;
    }
    /* 爆炸點光：大爆炸照亮一大片；飛彈／電漿命中這種小爆炸也短暫照亮附近船身 */
    if (size >= 9) {
      const li = this.lights.find(x => x.t <= 0);
      if (li) {
        const big = size >= 20;
        li.t = big ? 0.45 : 0.22;
        li.l.position.set(pos.x, pos.y + (big ? 30 : 14), pos.z);
        li.l.color.setHex(big ? 0xffaa66 : 0xffc890);
        li.l.distance = big ? 900 : 320;
        /* 非物理光照模式下強度是「主光源的幾倍」；舊值 size*90 會把會反光的素材船整艘照白 */
        li.l.intensity = big ? size * 0.1 : size * 0.15;
      }
    }
    /* 翻滾碎片（中大型爆炸才有） */
    if (size >= 16) {
      let nd = Math.min(6, 2 + Math.floor(size / 12));
      for (const d of this.debris) {
        if (d.t > 0 || nd <= 0) continue;
        nd--;
        d.t = d.max = U.rand(0.9, 1.8);
        d.size = U.rand(size * 0.1, size * 0.2);
        d.m.position.copy(pos);
        const a2 = U.rand(U.TAU), sp = U.rand(40, 90) + size * 1.5;
        d.vel.set(Math.cos(a2) * sp, U.rand(-0.3, 0.6) * sp * 0.5, Math.sin(a2) * sp);
        d.rx = U.rand(-5, 5); d.ry = U.rand(-5, 5);
        d.m.rotation.set(U.rand(3), U.rand(3), U.rand(3));
        d.m.scale.setScalar(d.size);
        d.m.visible = true;
      }
    }
    /* 長壽餘燼：爆炸後 1~2 秒的橘紅火星餘韻 */
    const ember = new THREE.Color(0xff8a44);
    for (let i = 0; i < Math.round(n * (small ? 0.25 : 0.5)); i++) this.spark(pos, U.rand(8, 40), U.rand(small ? 0.6 : 1.0, small ? 1.2 : 2.0), ember);
  },

  /* ═══════════ 分級爆炸（10-07，Homeworld 2 式「白熱火團→膨脹→炸開→餘燼」） ═══════════
     火團／煙塵用「雲朵 puff」：兩個 InstancedBufferGeometry 看板（火＝additive、煙＝normal），
     不論同時幾場爆炸都只有 2 個 draw call；每個 puff 有延遲、壽命、大小曲線、顏色漸變、自轉。
     分級（size≈radius×1.3）：小 <14、中 14～30、大 30～80、超大 ≥80（母艦）。
     大爆炸同時最多 BLAST.maxBig 場（以預約計），超過由 world 降級成中。 */
  BLAST: { maxBig: 4, fireCap: 400, smokeCap: 260 },

  _initPuffs(scene) {
    /* 程序化 128px 火焰雲貼圖：亂數柔光團疊出雲狀 alpha，再用徑向遮罩收邊 */
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    /* 大團打底＋小團起伏（固定亂數種子，每次開遊戲長一樣） */
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const blob = (x, y, r, al) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,' + al + ')');
      gr.addColorStop(0.5, 'rgba(255,255,255,' + al * 0.55 + ')');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (let i = 0; i < 7; i++) {
      const a = rnd() * U.TAU, d = 8 + rnd() * 24;
      blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 18 + rnd() * 12, 0.42);
    }
    for (let i = 0; i < 26; i++) {
      const a = rnd() * U.TAU, d = rnd() * 44;
      blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5 + rnd() * 11, 0.3 + rnd() * 0.3);
    }
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    m.addColorStop(0, 'rgba(255,255,255,1)');
    m.addColorStop(0.6, 'rgba(255,255,255,0.85)');
    m.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = m;
    g.fillRect(0, 0, 128, 128);
    this.cloudTex = new THREE.CanvasTexture(c);

    const vs = `
      attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iSRS;
      varying vec2 vUv; varying vec4 vC; varying float vSoft;
      void main() {
        vUv = uv; vC = iCol; vSoft = iSRS.z;
        vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
        float c = cos(iSRS.y), s = sin(iSRS.y);
        vec2 p = position.xy * iSRS.x;
        mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
        gl_Position = projectionMatrix * mv;
      }`;
    /* uHeat：火的稀薄處偏暗紅、濃處保持原色（溫度隨密度），雲團才有層次；煙不用 */
    const fs = `
      uniform sampler2D map; uniform sampler2D glow; uniform float uHeat;
      varying vec2 vUv; varying vec4 vC; varying float vSoft;
      void main() {
        float t = texture2D(map, vUv).a;
        float a = mix(t * t * (3.0 - 2.0 * t), texture2D(glow, vUv).a, vSoft);
        vec3 c = vC.rgb * mix(vec3(1.0), mix(vec3(0.9, 0.35, 0.12), vec3(1.0), a), uHeat * (1.0 - vSoft));
        gl_FragColor = vec4(c, vC.a * a);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`;
    const plane = new THREE.PlaneGeometry(1, 1);
    const mk = (cap, blending, order, fade) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = plane.index;
      geo.setAttribute('position', plane.attributes.position);
      geo.setAttribute('uv', plane.attributes.uv);
      const P = {
        cap, n: 0, geo, free: [], act: [], fade,
        iPos: new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage),
        iCol: new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage),
        iSRS: new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage),
        pos: new Float32Array(cap * 3), vel: new Float32Array(cap * 3),
        age: new Float32Array(cap), life: new Float32Array(cap), drag: new Float32Array(cap),
        s0: new Float32Array(cap), s1: new Float32Array(cap), rot: new Float32Array(cap), rv: new Float32Array(cap),
        c0: new Float32Array(cap * 3), c1: new Float32Array(cap * 3), a: new Float32Array(cap),
        fin: new Float32Array(cap), soft: new Float32Array(cap),
      };
      for (let i = cap - 1; i >= 0; i--) P.free.push(i);
      geo.setAttribute('iPos', P.iPos); geo.setAttribute('iCol', P.iCol); geo.setAttribute('iSRS', P.iSRS);
      geo.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.cloudTex }, glow: { value: Models.glowTex }, uHeat: { value: blending === THREE.AdditiveBlending ? 1 : 0 } },
        vertexShader: vs, fragmentShader: fs,
        blending, transparent: true, depthWrite: false,
      });
      P.mesh = new THREE.Mesh(geo, mat);
      P.mesh.frustumCulled = false;
      P.mesh.renderOrder = order;
      P.mesh.visible = false;
      scene.add(P.mesh);
      return P;
    };
    this.firePuffs = mk(this.BLAST.fireCap, THREE.AdditiveBlending, 12, 1.4);   // 火：亮得快退得快
    this.smokePuffs = mk(this.BLAST.smokeCap, THREE.NormalBlending, 11, 0.6);   // 煙：濃度撐久一點才散
    this._bigUntil = [];
    this._clock = 0;
    this._white = 0;
    this._whiteEl = document.getElementById('whiteflash');
  },

  /* 發一顆雲朵：o = {vx,vy,vz,life,delay,s0,s1,rot,rv,c0:[r,g,b],c1,a,fin,drag,soft} */
  _puff(P, x, y, z, o) {
    if (!P.free.length) return;
    const i = P.free.pop();
    P.act.push(i);
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = o.vx || 0; P.vel[i * 3 + 1] = o.vy || 0; P.vel[i * 3 + 2] = o.vz || 0;
    P.age[i] = -(o.delay || 0); P.life[i] = o.life;
    P.s0[i] = o.s0; P.s1[i] = o.s1;
    P.rot[i] = o.rot !== undefined ? o.rot : Math.random() * U.TAU; P.rv[i] = o.rv || 0;
    P.c0[i * 3] = o.c0[0]; P.c0[i * 3 + 1] = o.c0[1]; P.c0[i * 3 + 2] = o.c0[2];
    P.c1[i * 3] = o.c1[0]; P.c1[i * 3 + 1] = o.c1[1]; P.c1[i * 3 + 2] = o.c1[2];
    P.a[i] = o.a; P.fin[i] = o.fin || 0.04; P.drag[i] = o.drag !== undefined ? o.drag : 0.5;
    P.soft[i] = o.soft || 0;
  },

  _updPuffs(P, dt) {
    let n = 0;
    const ip = P.iPos.array, ic = P.iCol.array, is = P.iSRS.array, act = P.act;
    for (let j = act.length - 1; j >= 0; j--) {
      const i = act[j];
      P.age[i] += dt;
      const age = P.age[i];
      if (age >= P.life[i]) { act[j] = act[act.length - 1]; act.pop(); P.free.push(i); continue; }
      if (age < 0) continue;                       // 還在延遲（餘燼閃光用）
      const dr = Math.pow(P.drag[i], dt);
      P.vel[i * 3] *= dr; P.vel[i * 3 + 1] *= dr; P.vel[i * 3 + 2] *= dr;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      P.rot[i] += P.rv[i] * dt;
      const k = age / P.life[i];
      const e = 1 - (1 - k) * (1 - k) * (1 - k);   // 大小：先猛脹後趨緩
      const kc = Math.pow(k, 0.6);                  // 顏色：白熱很快退成黃橘
      const al = P.a[i] * Math.min(1, age / P.fin[i]) * Math.pow(1 - k, P.fade);
      const o3 = n * 3, o4 = n * 4;
      ip[o3] = P.pos[i * 3]; ip[o3 + 1] = P.pos[i * 3 + 1]; ip[o3 + 2] = P.pos[i * 3 + 2];
      ic[o4] = P.c0[i * 3] + (P.c1[i * 3] - P.c0[i * 3]) * kc;
      ic[o4 + 1] = P.c0[i * 3 + 1] + (P.c1[i * 3 + 1] - P.c0[i * 3 + 1]) * kc;
      ic[o4 + 2] = P.c0[i * 3 + 2] + (P.c1[i * 3 + 2] - P.c0[i * 3 + 2]) * kc;
      ic[o4 + 3] = al;
      is[o3] = P.s0[i] + (P.s1[i] - P.s0[i]) * e; is[o3 + 1] = P.rot[i]; is[o3 + 2] = P.soft[i];
      n++;
    }
    P.geo.instanceCount = n;
    P.mesh.visible = n > 0;
    if (n || P.n) { P.iPos.needsUpdate = true; P.iCol.needsUpdate = true; P.iSRS.needsUpdate = true; }
    P.n = n;
  },

  _resetPuffs() {
    for (const P of [this.firePuffs, this.smokePuffs]) {
      if (!P) continue;
      for (const i of P.act) P.free.push(i);
      P.act.length = 0; P.n = 0; P.geo.instanceCount = 0; P.mesh.visible = false;
    }
    this._bigUntil.length = 0;
    this._white = 0;
    if (this._whiteEl) this._whiteEl.style.opacity = 0;
  },

  /* 大爆炸名額：world 在擊毀瞬間預約（含連環爆前導＋煙塵期），滿了就降級成中爆 */
  canBig() {
    let n = 0;
    for (const t of this._bigUntil) if (t > this._clock) n++;
    return n < this.BLAST.maxBig;
  },
  reserveBig(sec) {
    this._bigUntil = this._bigUntil.filter(t => t > this._clock);
    this._bigUntil.push(this._clock + sec);
  },

  /* 小爆炸的一小團火（飛彈／電漿／攔截機）：快、小、乾淨 */
  _miniFire(pos, size) {
    this._puff(this.firePuffs, pos.x, pos.y, pos.z, {
      life: 0.28, s0: size * 1.4, s1: size * 3.4, c0: [2.2, 1.9, 1.3], c1: [1.2, 0.35, 0.06], a: 0.85, soft: 0.6, rv: U.rand(-2, 2),
    });
  },

  /* ── 中爆（護衛／驅逐／採礦船／小建築）：火球膨脹＋衝擊波＋碎片，約 0.8 秒 ── */
  blastMid(pos, size, hex) {
    if (this._fogHid(pos)) return;
    this.explode(pos, size, hex);
    const F = this.firePuffs, x = pos.x, y = pos.y, z = pos.z;
    this._puff(F, x, y, z, { life: 0.32, s0: size * 1.2, s1: size * 3.2, c0: [3, 2.9, 2.6], c1: [2, 1.3, 0.5], a: 1, soft: 1 });
    for (let i = 0; i < 3; i++) {
      this._puff(F, x + U.rand(-0.3, 0.3) * size, y + U.rand(-0.2, 0.3) * size, z + U.rand(-0.3, 0.3) * size, {
        life: U.rand(0.65, 0.9), s0: size * 1.6, s1: size * U.rand(4.6, 5.6),
        c0: [1.9, 1.4, 0.7], c1: [0.85, 0.2, 0.04], a: 0.9, rv: U.rand(-1, 1), soft: 0,
      });
    }
    const S = this.smokePuffs;
    for (let i = 0; i < 3; i++) {
      const a = U.rand(U.TAU), sp = size * U.rand(0.6, 1.4);
      this._puff(S, x, y, z, {
        vx: Math.cos(a) * sp, vy: U.rand(0, 0.5) * sp, vz: Math.sin(a) * sp,
        life: U.rand(1.1, 1.6), delay: 0.12, s0: size * 1.5, s1: size * U.rand(3.6, 4.6),
        c0: [0.45, 0.3, 0.19], c1: [0.16, 0.15, 0.16], a: 0.5, fin: 0.25, rv: U.rand(-0.4, 0.4),
      });
    }
  },

  /* ── 大爆 階段①：船身內部連環小爆（world 在船身隨機點呼叫） ── */
  blastPop(pos, size) {
    if (this._fogHid(pos)) return;
    /* 不走 explode：小爆不要衝擊波環（環會比船還大），只要一團亮火＋火星＋短暫打光 */
    const f = this.flashes.find(q => q.t <= 0);
    if (f) { f.t = f.max = 0.2; f.size = size * 4.5; f.s.position.copy(pos); f.s.material.color.setHex(0xffe2b0); f.s.visible = true; }
    this._puff(this.firePuffs, pos.x, pos.y, pos.z, {
      life: 0.5, s0: size * 2, s1: size * 5, c0: [2.8, 2.3, 1.5], c1: [1.2, 0.3, 0.05], a: 1, soft: 0.45, rv: U.rand(-1.5, 1.5),
    });
    const gold = this._gold || (this._gold = new THREE.Color(0xffd166));
    for (let i = 0; i < 10; i++) this.spark(pos, U.rand(60, 160 + size * 6), U.rand(0.3, 0.7), gold);
    const li = this.lights.find(q => q.t <= 0);
    if (li) {
      li.t = 0.2; li.l.position.set(pos.x, pos.y + 14, pos.z); li.l.color.setHex(0xffc890);
      li.l.distance = 320; li.l.intensity = size * 0.15;
    }
  },

  /* ── 大爆 階段②：核心白熱火團（約 0.4 秒內白→黃→橘脹到 radius×3～4）＋強點光 ── */
  blastCore(pos, size, hex, radius, huge) {
    if (this._fogHid(pos)) return;
    const F = this.firePuffs, x = pos.x, y = pos.y, z = pos.z, R = radius;
    const big = huge ? 1.25 : 1;
    /* 白熱核心（柔光）：最亮、最快 */
    this._puff(F, x, y, z, { life: 0.5 * big, s0: R * 1.4, s1: R * 4.4 * big, c0: [1.5, 1.4, 1.2], c1: [1.2, 0.7, 0.2], a: 1, soft: 1, fin: 0.02 });
    this._puff(F, x, y, z, { life: 0.3, s0: R * 0.7, s1: R * 2.0, c0: [2.4, 2.4, 2.3], c1: [1.8, 1.5, 0.9], a: 1, soft: 1, fin: 0.01 });
    /* 火焰雲 4～5 層：大小、旋轉、色相各異 */
    const nl = huge ? 5 : 4;
    for (let i = 0; i < nl; i++) {
      const hue = U.rand(-0.15, 0.15);
      this._puff(F, x + U.rand(-0.25, 0.25) * R, y + U.rand(-0.15, 0.25) * R, z + U.rand(-0.25, 0.25) * R, {
        life: U.rand(0.9, 1.3) * big, s0: R * U.rand(1.6, 2.2), s1: R * U.rand(6, 7.6) * big,
        c0: [1.6, 1.15 + hue * 0.5, 0.55 + hue * 0.4], c1: [0.8, 0.17 + hue * 0.2, 0.03], a: 0.75, soft: 0, fin: 0.05,
        rv: U.rand(-0.7, 0.7),
      });
    }
    /* 外圈暗橘紅雲 */
    this._puff(F, x, y, z, { life: 1.6 * big, s0: R * 2.6, s1: R * 9 * big, c0: [0.9, 0.36, 0.1], c1: [0.3, 0.04, 0.02], a: 0.55, soft: 0, fin: 0.15, rv: U.rand(-0.3, 0.3) });
    /* 爆閃（glow 批） */
    const f = this.flashes.find(q => q.t <= 0);
    if (f) {
      f.t = f.max = 0.4; f.size = R * 4.5 * big;
      f.s.position.copy(pos); f.s.material.color.setHex(0xb09070); f.s.visible = true;
    }
    /* 強點光：第二輪定的量級 size×0.1～0.15，這裡短暫 ×2（上限 24） */
    const li = this.lights.find(q => q.t <= 0) || this.lights[0];
    li.t = 0.8;
    li.l.position.set(x, y + R * 0.8, z);
    li.l.color.setHex(0xffc080);
    li.l.distance = R * 26;
    li.l.intensity = Math.min(size * 0.3, 24);
    /* 白熱火星 */
    const wc = this._wc || (this._wc = new THREE.Color(0xfff2c0));
    for (let i = 0; i < 24; i++) this.spark(pos, U.rand(R * 2, R * 6), U.rand(0.3, 0.7), wc);
    if (huge) this._white = 0.5;
  },

  /* ── 大爆 階段③＋④：炸開（衝擊波 radius×7＋碎片＋火星＋煙塵 2～3 秒）、餘燼零星閃光 2～4 秒 ── */
  blastBurst(pos, size, hex, radius, huge) {
    if (this._fogHid(pos)) return;
    const R = radius, x = pos.x, y = pos.y, z = pos.z, big = huge ? 1.3 : 1;
    /* 衝擊波：陣營色寬環＋橘白內環 */
    const rings = [[hex, 1.1 * big, R * 7 * big], [0xffc890, 0.7, R * 4.5 * big]];
    for (const [c, life, grow] of rings) {
      const r = this.rings.find(q => q.t <= 0);
      if (!r) break;
      r.t = r.max = life; r.grow = grow; r.base = R * 0.8;
      r.mesh.position.set(x, Math.max(4, y), z);
      r.mesh.scale.setScalar(r.base);
      r.mesh.material.color.setHex(c);
      r.mesh.visible = true;
    }
    /* 翻滾碎片 */
    let nd = huge ? 16 : Math.min(12, 5 + Math.floor(R / 6));
    for (const d of this.debris) {
      if (d.t > 0 || nd <= 0) continue;
      nd--;
      d.t = d.max = U.rand(1.6, 3.2);
      d.size = U.rand(R * 0.08, R * 0.2);
      d.m.position.set(x + U.rand(-0.4, 0.4) * R, y, z + U.rand(-0.4, 0.4) * R);
      const a2 = U.rand(U.TAU), sp = U.rand(60, 140) + R * 2.5;
      d.vel.set(Math.cos(a2) * sp, U.rand(-0.3, 0.7) * sp * 0.5, Math.sin(a2) * sp);
      d.rx = U.rand(-4, 4); d.ry = U.rand(-4, 4);
      d.m.rotation.set(U.rand(3), U.rand(3), U.rand(3));
      d.m.scale.setScalar(d.size);
      d.m.visible = true;
    }
    /* 火星：金／陣營色快速飛散＋長壽橘紅餘燼 */
    const col = this._tc || (this._tc = new THREE.Color());
    col.setHex(hex);
    const gold = this._gold || (this._gold = new THREE.Color(0xffd166));
    const ember = this._emb || (this._emb = new THREE.Color(0xff7a30));
    const ns = huge ? 110 : 70;
    for (let i = 0; i < ns; i++) this.spark(pos, U.rand(R * 3, R * 10), U.rand(0.5, 1.3), Math.random() < 0.55 ? gold : col);
    for (let i = 0; i < ns * 0.45; i++) this.spark(pos, U.rand(R * 0.5, R * 3), U.rand(2.0, 3.8), ember);
    /* 外甩的小火團 */
    const F = this.firePuffs;
    for (let i = 0; i < (huge ? 10 : 7); i++) {
      const a = U.rand(U.TAU), sp = R * U.rand(4, 8);
      this._puff(F, x, y, z, {
        vx: Math.cos(a) * sp, vy: U.rand(-0.2, 0.5) * sp, vz: Math.sin(a) * sp, drag: 0.2,
        life: U.rand(0.6, 1.0), s0: R * 0.8, s1: R * U.rand(1.8, 2.6), c0: [2.4, 1.6, 0.7], c1: [0.7, 0.14, 0.03], a: 0.85, rv: U.rand(-2, 2),
      });
    }
    /* 煙塵（normal blend，深灰偏橘，慢慢擴散 2～3 秒） */
    const S = this.smokePuffs;
    for (let i = 0; i < (huge ? 16 : 11); i++) {
      const a = U.rand(U.TAU), sp = R * U.rand(0.5, 1.6);
      this._puff(S, x + Math.cos(a) * R * 0.5, y + U.rand(-0.2, 0.4) * R, z + Math.sin(a) * R * 0.5, {
        vx: Math.cos(a) * sp, vy: U.rand(-0.1, 0.4) * sp, vz: Math.sin(a) * sp, drag: 0.45,
        life: U.rand(2.2, 3.2) * big, delay: U.rand(0, 0.2), s0: R * 2, s1: R * U.rand(5, 7) * big,
        c0: [0.5, 0.33, 0.2], c1: [0.2, 0.19, 0.2], a: 0.55, fin: 0.35, rv: U.rand(-0.25, 0.25),
      });
    }
    /* 餘燼：殘火團內零星閃光 */
    for (let i = 0; i < (huge ? 18 : 11); i++) {
      this._puff(F, x + U.rand(-1.6, 1.6) * R, y + U.rand(-0.4, 0.8) * R, z + U.rand(-1.6, 1.6) * R, {
        delay: U.rand(0.3, 3.4 * big), life: U.rand(0.25, 0.6), s0: R * 0.5, s1: R * U.rand(1.2, 2.0),
        c0: [2.6, 1.9, 0.9], c1: [1.0, 0.25, 0.04], a: 0.9, soft: 0.7, fin: 0.03,
      });
    }
    /* 殘火：中心低亮度暗紅雲慢慢熄 */
    this._puff(F, x, y, z, { delay: 0.2, life: 3.2 * big, s0: R * 3, s1: R * 5 * big, c0: [0.9, 0.3, 0.08], c1: [0.2, 0.03, 0.01], a: 0.4, fin: 0.4, rv: 0.15 });
    if (huge) this._white = Math.max(this._white, 0.35);
  },

  /* 砲口閃光 */
  muzzle(pos, colorHex, size) {
    if (this._fogHid(pos)) return;
    const f = this.flashes.find(x => x.t <= 0);
    if (!f) return;
    f.t = 0.07; f.max = 0.07; f.size = size;
    f.s.position.copy(pos);
    f.s.material.color.setHex(colorHex);
    f.s.visible = true;
  },

  /* 指令光圈標記 */
  ping(pos, colorHex) {
    const r = this.rings.find(x => x.t <= 0);
    if (!r) return;
    r.t = 0.6; r.max = 0.6; r.grow = -52; r.base = 60;
    r.mesh.position.set(pos.x, 3, pos.z);
    r.mesh.scale.set(56, 56, 56);
    r.mesh.material.color.setHex(colorHex);
    r.mesh.visible = true;
  },

  /* 命中特效：護盾擋下＝目標陣營色的漣漪閃光；打穿到船體＝橘色火花＋白閃 */
  impact(pos, shielded, hex, heavy) {
    if (this._fogHid(pos)) return;
    const f = this.flashes.find(x => x.t <= 0);
    if (f) {
      f.t = f.max = shielded ? 0.16 : 0.1;
      f.size = (heavy ? 30 : 13) * (shielded ? 1.3 : 1);
      f.s.position.copy(pos);
      f.s.material.color.setHex(shielded ? hex : 0xfff0d0);
      f.s.visible = true;
    }
    if (shielded) {
      if (heavy) {
        const r = this.rings.find(x => x.t <= 0);
        if (r) {
          r.t = r.max = 0.3; r.grow = 40; r.base = 8;
          r.mesh.position.copy(pos);
          r.mesh.scale.set(8, 8, 8);
          r.mesh.material.color.setHex(hex);
          r.mesh.visible = true;
        }
      }
      this.burst(pos, heavy ? 6 : 2, hex, 120);
    } else {
      const c = this._hullSpark || (this._hullSpark = new THREE.Color(0xffa040));
      for (let i = 0, n = heavy ? 10 : 4; i < n; i++) this.spark(pos, U.rand(60, 200), U.rand(0.2, 0.5), c);
    }
  },

  /* 彈道尾跡：幾乎不動、短命的粒子，連起來就是一道光尾／煙尾 */
  trail(pos, colorC, life, spread) {
    if (!this.pFree.length || this._fogHid(pos)) return;
    const i = this.pFree.pop();
    this.pPos[i * 3] = pos.x + U.rand(-spread, spread);
    this.pPos[i * 3 + 1] = pos.y + U.rand(-spread, spread);
    this.pPos[i * 3 + 2] = pos.z + U.rand(-spread, spread);
    this.pVel[i * 3] = U.rand(-6, 6); this.pVel[i * 3 + 1] = U.rand(-3, 6); this.pVel[i * 3 + 2] = U.rand(-6, 6);
    this.pLife[i] = this.pMax[i] = life;
    this.pBase[i * 3] = colorC.r; this.pBase[i * 3 + 1] = colorC.g; this.pBase[i * 3 + 2] = colorC.b;
    this.pUsed = true;
  },

  spark(pos, spd, life, colorC) {
    if (!this.pFree.length || this._fogHid(pos)) return;
    const i = this.pFree.pop();
    const a = U.rand(U.TAU), b = U.rand(-1, 1);
    const h = Math.sqrt(Math.max(0, 1 - b * b));
    this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
    this.pVel[i * 3] = Math.cos(a) * h * spd;
    this.pVel[i * 3 + 1] = b * spd * 0.55;
    this.pVel[i * 3 + 2] = Math.sin(a) * h * spd;
    this.pLife[i] = this.pMax[i] = life;
    this.pBase[i * 3] = colorC.r; this.pBase[i * 3 + 1] = colorC.g; this.pBase[i * 3 + 2] = colorC.b;
    this.pUsed = true;
  },

  burst(pos, n, colorHex, spd) {
    const c = new THREE.Color(colorHex);
    for (let i = 0; i < n; i++) this.spark(pos, U.rand(spd * 0.3, spd), U.rand(0.15, 0.45), c);
  },

  /* ── 光束 ── */
  beamAcquire() {
    const b = this.beams.find(x => !x.used);
    if (!b) return null;
    b.used = true;
    b.g.visible = true;
    return b;
  },
  beamSet(b, src, dst, teamHex, heavy, alpha) {
    /* 戰爭迷霧：兩端都在迷霧裡就整條藏起來 */
    const hid = this._fogHid(src) && this._fogHid(dst);
    b.g.visible = !hid;
    if (hid) { b.flare.visible = false; return; }
    const mid = b.g.position;
    mid.set((src.x + dst.x) / 2, (src.y + dst.y) / 2, (src.z + dst.z) / 2);
    const dir = new THREE.Vector3().subVectors(dst, src);
    const len = dir.length() || 1;
    b.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    /* 能量脈動：粗細隨時間抖動，光束才有「在燒」的感覺 */
    const pulse = 1 + Math.sin(performance.now() * 0.045) * 0.18 + U.rand(-0.08, 0.08);
    const w = (heavy ? 7 : 3.5) * pulse;
    b.outer.scale.set(w, len, w);
    b.core.scale.set(w * 0.32, len, w * 0.32);
    b.mO.color.setHex(teamHex);
    b.mO.opacity = 0.22 * alpha;
    b.mC.opacity = 0.85 * alpha;
    /* 命中端亮團 */
    b.flare.visible = true;
    b.flare.position.copy(dst);
    const fs = (heavy ? 46 : 24) * (0.8 + Math.random() * 0.4) * (0.4 + 0.6 * alpha);
    b.flare.scale.set(fs, fs, 1);
    b.flare.material.color.setHex(teamHex);
    b.flare.material.opacity = 0.9 * alpha;
  },
  beamRelease(b) { if (b) { b.used = false; b.g.visible = false; b.flare.visible = false; } },

  mineBeamAcquire() {
    const b = this.mineBeams.find(x => !x.used);
    if (!b) return null;
    b.used = true;
    b.line.visible = true;
    return b;
  },
  mineBeamSet(b, src, dst) {
    b.line.visible = !this._fogHid(src);
    const a = b.line.geometry.attributes.position;
    a.setXYZ(0, src.x, src.y, src.z);
    a.setXYZ(1, dst.x, dst.y, dst.z);
    a.needsUpdate = true;
    b.line.material.opacity = 0.5 + Math.random() * 0.45;
  },
  mineBeamRelease(b) { if (b) { b.used = false; b.line.visible = false; } },

  /* ── 每幀同步 ── */
  syncBullets(projectiles) {
    const pos = this.bulletGeo.attributes.position;
    const col = this.bulletGeo.attributes.color;
    const hp = this.headGeo.attributes.position, hc = this.headGeo.attributes.color;
    let n = 0;
    for (const p of projectiles) {
      if (p.t !== 'bullet' || n >= this.bulletCap || this._fogHid(p.pos)) continue;
      const i6 = n * 6;
      const k = p.anti ? 0.028 : 0.075;  /* 主砲長曳光、PD 短促，一眼可辨 */
      pos.array[i6] = p.pos.x - p.vel.x * k;
      pos.array[i6 + 1] = p.pos.y - p.vel.y * k;
      pos.array[i6 + 2] = p.pos.z - p.vel.z * k;
      pos.array[i6 + 3] = p.pos.x;
      pos.array[i6 + 4] = p.pos.y;
      pos.array[i6 + 5] = p.pos.z;
      const c = TEAMS[p.team].hex;
      const r = ((c >> 16) & 255) / 255, g2 = ((c >> 8) & 255) / 255, bl = (c & 255) / 255;
      col.array[i6] = r * 0.12; col.array[i6 + 1] = g2 * 0.12; col.array[i6 + 2] = bl * 0.12;  /* 暗尾亮頭 */
      col.array[i6 + 3] = 1; col.array[i6 + 4] = 1; col.array[i6 + 5] = 1;
      /* 彈頭：陣營色偏白的亮點（PD 暗一點，主砲亮一點） */
      const hk = p.anti ? 0.55 : 1;
      hp.array[n * 3] = p.pos.x; hp.array[n * 3 + 1] = p.pos.y; hp.array[n * 3 + 2] = p.pos.z;
      hc.array[n * 3] = (0.5 + r * 0.5) * hk; hc.array[n * 3 + 1] = (0.5 + g2 * 0.5) * hk; hc.array[n * 3 + 2] = (0.5 + bl * 0.5) * hk;
      n++;
    }
    this.bulletGeo.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.headGeo.setDrawRange(0, n);
    hp.needsUpdate = true;
    hc.needsUpdate = true;
  },

  syncProjectileSprites(projectiles) {
    let pi = 0, mi = 0;
    for (const p of projectiles) {
      if (this._fogHid(p.pos)) continue;
      if (p.t === 'plasma' && pi < this.plasmaSprites.length) {
        const s = this.plasmaSprites[pi++];
        s.position.copy(p.pos);
        s.material.color.setHex(TEAMS[p.team].hex);
        /* 電漿球脈動 */
        const ps = 26 * (1 + Math.sin(performance.now() * 0.03 + pi) * 0.22);
        s.scale.set(ps, ps, 1);
        s.visible = true;
      } else if (p.t === 'missile' && mi < this.missileSprites.length) {
        const s = this.missileSprites[mi++];
        s.position.copy(p.pos);
        s.material.color.setHex(0xffe2b0);
        const ms = 15 * (0.8 + Math.random() * 0.4);   // 推進火焰閃爍
        s.scale.set(ms, ms, 1);
        s.visible = true;
      }
    }
    for (let i = pi; i < this.plasmaSprites.length; i++) this.plasmaSprites[i].visible = false;
    for (let i = mi; i < this.missileSprites.length; i++) this.missileSprites[i].visible = false;
  },

  update(dt) {
    /* 分級爆炸的雲朵走「遊戲時間」：暫停凍結、hit-stop 慢動作、2× 加速都跟 world 的爆炸佇列同步 */
    const G = typeof Game !== 'undefined' ? Game : null;
    let ts = 1;
    if (G) {
      if (G.state === 'play') ts = G.paused ? 0 : (G.speed || 1) * (G.slowT > 0 ? 0.3 : 1);
      else if (G.state === 'over') ts = 0.4;
    }
    const gdt = dt * ts;
    this._clock += gdt;
    this._updPuffs(this.firePuffs, gdt);
    this._updPuffs(this.smokePuffs, gdt);
    /* 母艦爆炸全螢幕白閃（真實時間，約 0.15～0.2 秒退掉） */
    if (this._white > 0 || this._whiteOn) {
      this._white = Math.max(0, this._white - dt * 3);
      if (this._whiteEl) this._whiteEl.style.opacity = this._white.toFixed(3);
      this._whiteOn = this._white > 0;
    }
    /* 彩帶 */
    for (let i = this.ribbons.length - 1; i >= 0; i--) {
      const rb = this.ribbons[i];
      /* 點老化：超過 maxAge 的尾端點逐一移除 */
      for (let k = 0; k < rb.ages.length; k++) rb.ages[k] += dt;
      while (rb.ages.length && rb.ages[0] > rb.maxAge) { rb.ages.shift(); rb.pts.splice(0, 3); rb.dirty = true; }
      if (rb.dying) {
        rb.pts.splice(0, 9);
        rb.ages.splice(0, 3);
        rb.dirty = true;
        if (!rb.pts.length) {
          this.ribbons.splice(i, 1);
          continue;
        }
      }
    }
    /* 所有光尾寫進同一條 LineSegments：相鄰兩點一段，顏色沿用梯度（尾暗頭亮） */
    if (this._ribAll) {
      const ga = this._ribAll.geometry, P = ga.attributes.position.array, C = ga.attributes.color.array;
      let n = 0;
      for (const rb of this.ribbons) {
        const cnt = rb.pts.length / 3, off = rb.N - cnt, pts = rb.pts, ca = rb.colArr;
        for (let k = 0; k < cnt - 1 && n < this._ribCap; k++, n++) {
          const o = n * 6, a = k * 3, ca0 = (off + k) * 3;
          P[o] = pts[a]; P[o + 1] = pts[a + 1]; P[o + 2] = pts[a + 2];
          P[o + 3] = pts[a + 3]; P[o + 4] = pts[a + 4]; P[o + 5] = pts[a + 5];
          C[o] = ca[ca0]; C[o + 1] = ca[ca0 + 1]; C[o + 2] = ca[ca0 + 2];
          C[o + 3] = ca[ca0 + 3]; C[o + 4] = ca[ca0 + 4]; C[o + 5] = ca[ca0 + 5];
        }
      }
      ga.setDrawRange(0, n * 2);
      ga.attributes.position.needsUpdate = true;
      ga.attributes.color.needsUpdate = true;
    }
    /* 粒子 */
    let any = false;
    for (let i = 0; i < this.pCap; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -99999;
        this.pCol[i * 3] = this.pCol[i * 3 + 1] = this.pCol[i * 3 + 2] = 0;
        this.pFree.push(i);
        continue;
      }
      const dr = Math.pow(0.5, dt * 2);
      this.pVel[i * 3] *= dr; this.pVel[i * 3 + 1] *= dr; this.pVel[i * 3 + 2] *= dr;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      const k = this.pLife[i] / this.pMax[i];
      this.pCol[i * 3] = this.pBase[i * 3] * k;
      this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * k;
      this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * k;
    }
    if (any || this.pUsed) {
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.attributes.color.needsUpdate = true;
      this.pUsed = false;
    }
    /* 閃光 */
    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t -= dt;
      const k = Math.max(0, f.t / f.max);
      f.s.material.opacity = k;
      const sc = f.size * (1.4 - k * 0.7);
      f.s.scale.set(sc, sc, 1);
      if (f.t <= 0) f.s.visible = false;
    }
    /* 衝擊波 */
    for (const r of this.rings) {
      if (r.t <= 0) continue;
      r.t -= dt;
      const k = Math.max(0, r.t / r.max);
      const sc = Math.max(2, (r.base || 6) + (1 - k) * r.grow);
      r.mesh.scale.set(sc, sc, sc);
      r.mesh.material.opacity = k * 0.55;
      if (r.t <= 0) r.mesh.visible = false;
    }
    /* 點光 */
    for (const li of this.lights) {
      if (li.t <= 0) continue;
      li.t -= dt;
      li.l.intensity *= Math.pow(0.02, dt * 2.2);
      if (li.t <= 0) li.l.intensity = 0;
    }
    /* 碎片：翻滾＋減速＋末段縮小消失 */
    for (const d of this.debris) {
      if (d.t <= 0) continue;
      d.t -= dt;
      if (d.t <= 0) { d.m.visible = false; continue; }
      d.m.position.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(Math.pow(0.55, dt));
      d.m.rotation.x += d.rx * dt; d.m.rotation.y += d.ry * dt;
      d.m.scale.setScalar(d.size * Math.min(1, (d.t / d.max) * 4));
    }
  },
};
