'use strict';
/* ═══════════ 主程式：三維場景、流程、主迴圈 ═══════════ */

const Game = {
  state: 'menu',           // menu | play | over
  paused: false, speed: 1, slowT: 0,
  fog: true,               // 戰爭迷霧（主選單開關，預設開；開局時抄給 World.fog）
  scene: null, camera: null, renderer: null, grid: null,

  boot() {
    const canvas = U.el('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x04060d);
    /* 全片調色：ACES 電影級色調映射＋sRGB 輸出（高光柔和滾降、飽和度提升） */
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.scene = new THREE.Scene();
    /* 深度霧：遠處自然沒入深空（額外的 additive 特效也會隨距離優雅變暗） */
    this.scene.fog = new THREE.FogExp2(0x04060d, 0.00007);
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 5, 40000);

    /* 光照（配合 sRGB 輸出重新配平：方向光主導，立體感更強） */
    this.scene.add(new THREE.HemisphereLight(0x8fb8d8, 0x0c1018, 0.55));
    const dir = new THREE.DirectionalLight(0xcfe0ff, 1.0);
    dir.position.set(2000, 3200, 1200);
    this.scene.add(dir);
    this.scene.add(new THREE.AmbientLight(0x25344a, 0.35));

    Models.init();
    Batch.init(this.scene, this.renderer);   // 合批繪圖：要在 FX.init 之前（FX 的光點池會來註冊）
    FX.init(this.scene);
    Fog.init(this.scene);    // 戰爭迷霧地面遮罩（js/fog.js）
    this._makeBackdrop();

    /* 戰術網格 */
    const gs = MAP.W * 2 + 200;
    this.grid = new THREE.GridHelper(gs, Math.round(gs / 283), 0x16324e, 0x0b1a2b);   // 格距維持約 283
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.42;
    this.grid.position.y = -44;
    this.scene.add(this.grid);
    /* 地圖邊界 */
    const bd = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-MAP.W, -40, -MAP.H), new THREE.Vector3(MAP.W, -40, -MAP.H),
      new THREE.Vector3(MAP.W, -40, MAP.H), new THREE.Vector3(-MAP.W, -40, MAP.H),
    ]);
    this.scene.add(new THREE.LineLoop(bd, new THREE.LineBasicMaterial({ color: 0x1b3a58, transparent: true, opacity: 0.6 })));

    UI.init();
    Input.init(canvas, this.camera);
    window.addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    /* 主選單背景場景 */
    World.init(this.scene, 'normal');
    Cam.cinematic = true;
    Cam.target.set(-MAP.baseX, 0, 0);
    Cam.dist = 1500; Cam.pitch = 0.5;
    UI.showScreen('menu-screen');

    this._last = performance.now();
    const loop = t => {
      const dt = Math.min(0.05, (t - this._last) / 1000 || 0.016);
      this._last = t;
      if (this.state === 'play' && !this.paused) {
        let ts = this.speed;
        if (this.slowT > 0) { this.slowT -= dt; ts *= 0.3; }  /* hit-stop 慢動作 */
        World.update(dt * ts);
        Input.update(dt);
      } else if (this.state === 'play') {
        Input.update(dt);  // 暫停中仍可操作鏡頭與下令
      } else if (this.state === 'over') {
        World.update(dt * 0.4);  // 終局慢動作
        Cam.update(dt);          // 終局運鏡（_animTo）在 over 狀態也要動
      }
      FX.update(dt);
      SFX.update(dt);
      Cam.apply(this.camera, dt, this.state !== 'menu' ? World.shakeAmt : 0);
      this.grid.material.opacity = 0.42 * U.clamp((Cam.dist - 260) / 700, 0, 1);  /* 近景網格淡出 */
      UI.update(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  /* 星空與星雲背景 */
  _makeBackdrop() {
    /* 遠景（星野／銀河帶／星雲／行星）整組按地圖比例放大，免得船飛到邊緣會穿進星空 */
    const sky = new THREE.Group();
    sky.scale.setScalar(MAP.W / 3300);
    this.scene.add(sky);
    const scene = this.scene;
    this.scene = sky;   // 下面沿用原本 this.scene.add 的寫法，暫時指到遠景組
    for (const [n, size, r0, r1, col] of [
      [1700, 1.7, 6500, 11000, 0xcdd8ea],
      [800, 2.6, 5800, 10000, 0x9fb8dd],
    ]) {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = U.rand(U.TAU), b = Math.acos(U.rand(-1, 1));
        const r = U.rand(r0, r1);
        pos[i * 3] = Math.sin(b) * Math.cos(a) * r;
        pos[i * 3 + 1] = Math.cos(b) * r * 0.6;
        pos[i * 3 + 2] = Math.sin(b) * Math.sin(a) * r;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({
        color: col, size, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, fog: false,
      })));
    }
    /* 銀河帶：沿傾斜大圓密撒微星，帶心最密、往外羽化，藍白摻暖橘 */
    const gn = 2600, gp = new Float32Array(gn * 3), gc = new Float32Array(gn * 3);
    const cA = new THREE.Color(0x9fc4ff), cB = new THREE.Color(0xffd9b0);
    for (let i = 0; i < gn; i++) {
      const a = U.rand(U.TAU), r = U.rand(8500, 10500);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = x * 0.35 + Math.pow(U.rand(1), 2.2) * (Math.random() < 0.5 ? 1 : -1) * 1600;
      gp[i * 3] = x; gp[i * 3 + 1] = y; gp[i * 3 + 2] = z;
      const c = Math.random() < 0.75 ? cA : cB, k = U.rand(0.25, 1);
      gc[i * 3] = c.r * k; gc[i * 3 + 1] = c.g * k; gc[i * 3 + 2] = c.b * k;
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
    this.scene.add(new THREE.Points(gg, new THREE.PointsMaterial({
      vertexColors: true, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false, fog: false,
    })));
    /* 星雲：半數沿銀河帶擺，跟星野同構 */
    const nebCols = [0x1c3f8a, 0x5a2d8a, 0x155a70, 0x7a2545, 0x28527a];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.SpriteMaterial({
        map: Models.glowTex, color: U.pick(nebCols), blending: THREE.AdditiveBlending,
        transparent: true, opacity: U.rand(0.07, 0.13), depthWrite: false, fog: false,
      });
      const s = new THREE.Sprite(m);
      const a = U.rand(U.TAU);
      const px = Math.cos(a) * U.rand(4000, 8000), pz = Math.sin(a) * U.rand(4000, 8000);
      const py = i < 4 ? px * 0.35 + U.rand(-900, 900) : U.rand(-2500, 2500);
      s.position.set(px, py, pz);
      const sc = U.rand(5000, 9000);
      s.scale.set(sc, sc, 1);
      this.scene.add(s);
    }
    this.scene = scene;   // 遠景組結束，回到主場景
    /* 近景太空塵埃視差層：sizeAttenuation 開啟＝近大遠小，移動鏡頭時的「太空感」主來源（範圍＝整張地圖） */
    const dn = 1500, dp = new Float32Array(dn * 3);
    for (let i = 0; i < dn; i++) {
      dp[i * 3] = U.rand(-MAP.W - 300, MAP.W + 300);
      dp[i * 3 + 1] = U.rand(-160, 260);
      dp[i * 3 + 2] = U.rand(-MAP.H - 300, MAP.H + 300);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.scene.add(new THREE.Points(dg, new THREE.PointsMaterial({
      color: 0x5f7d9a, size: 2.4, sizeAttenuation: true, transparent: true, opacity: 0.45, depthWrite: false,
    })));
    /* 遠景行星：程序化條紋＋大氣光暈，固定地標兼方位參考 */
    const pc = document.createElement('canvas');
    pc.width = 256; pc.height = 128;
    const pg = pc.getContext('2d');
    const base = pg.createLinearGradient(0, 0, 0, 128);
    base.addColorStop(0, '#31486b'); base.addColorStop(1, '#1a2438');
    pg.fillStyle = base; pg.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 18; i++) {
      pg.fillStyle = `rgba(${140 + U.randInt(0, 60)},${170 + U.randInt(0, 50)},${210 + U.randInt(0, 40)},${U.rand(0.04, 0.1)})`;
      pg.fillRect(0, U.rand(0, 128), 256, U.rand(2, 9));
    }
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 18),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(pc), roughness: 1, metalness: 0, fog: false }));
    planet.position.set(-7000, -1800, 9000);
    this.scene.add(planet);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: Models.glowTex, color: 0x6fb4ff, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.35, depthWrite: false, fog: false,
    }));
    halo.position.copy(planet.position);
    halo.scale.set(2600, 2600, 1);
    this.scene.add(halo);
    /* 行星也按地圖比例推遠放大（跟遠景組一致） */
    const ks = MAP.W / 3300;
    planet.position.multiplyScalar(ks); planet.scale.setScalar(ks);
    halo.position.copy(planet.position); halo.scale.multiplyScalar(ks);
  },

  /* ── 流程 ── */
  start(diffKey, mode) {
    this.mode = mode === 'tri' ? 'tri' : 'duel';
    World.fog = this.fog;
    World.init(this.scene, diffKey, this.mode);
    Input.stopPlace();
    Input.groups = {};
    UI._hintFlags = {};
    this.state = 'play';
    this.paused = false;
    this.speed = 1;
    this.slowT = 0;
    this._syncBtns();
    Cam.cinematic = false;
    Cam.follow = false;
    Cam.target.set(World.playerBase.pos.x + 250, 0, World.playerBase.pos.z);
    /* 開場俯衝：從高空滑入指揮視角（玩家一操作鏡頭就取消） */
    Cam.yaw = Math.PI * 0.8; Cam.pitch = 1.3; Cam.dist = 5200;
    Cam.snap();
    Cam._animTo = { pitch: 0.62, dist: 1050, yaw: Math.PI, t: 0, rate: 1.2 };
    UI.showScreen('hud');
    U.el('diff-label').textContent = World.diff.name + (this.mode === 'tri' ? '・三方混戰' : '');
  },
  toMenu() {
    this.state = 'menu';
    Cam.cinematic = true;
    UI.showScreen('menu-screen');
  },

  /* 短暫慢動作（主力艦擊殺 hit-stop） */
  slowMo(sec) { if (this.state === 'play') this.slowT = Math.max(this.slowT, sec); },

  togglePause() {
    if (this.state !== 'play') return;
    this.paused = !this.paused;
    this._syncBtns();
  },
  toggleSpeed() {
    this.speed = this.speed === 1 ? 2 : 1;
    this._syncBtns();
    SFX.click();
  },
  toggleSound() {
    SFX.setOn(!SFX.on);
    this._syncBtns();
  },
  _syncBtns() {
    U.el('hb-pause').classList.toggle('on', this.paused);
    U.el('hb-speed').textContent = this.speed + '×';
    U.el('hb-sound').classList.toggle('off', !SFX.on);
  },
};

window.addEventListener('DOMContentLoaded', () => Game.boot());
