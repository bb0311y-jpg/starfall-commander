'use strict';
/* ═══════════ 程序化 3D 模型工廠 ═══════════
   每艘艦 = 2 個合併網格（實體 + 自發光），加上少量動態零件 */

const Models = {
  geoCache: {}, astCache: [],
  matSolid: null, matGlow: null, glowTex: null,
  engineMats: [], ghostMats: null,

  init() {
    /* 程序化 env cubemap：艦體才有真正的金屬反光（+Y 天頂亮斑對應主方向光） */
    const faces = [];
    for (let i = 0; i < 6; i++) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const cg = cv.getContext('2d');
      const grd = cg.createLinearGradient(0, 0, 0, 32);
      grd.addColorStop(0, '#1a2c44'); grd.addColorStop(0.5, '#060a14'); grd.addColorStop(1, '#02040a');
      cg.fillStyle = grd; cg.fillRect(0, 0, 32, 32);
      if (i === 2) {
        const rg = cg.createRadialGradient(16, 16, 1, 16, 16, 14);
        rg.addColorStop(0, 'rgba(210,230,255,.9)'); rg.addColorStop(1, 'rgba(210,230,255,0)');
        cg.fillStyle = rg; cg.fillRect(0, 0, 32, 32);
      }
      faces.push(cv);
    }
    const envTex = new THREE.CubeTexture(faces);
    envTex.needsUpdate = true;
    this.matSolid = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.5, metalness: 0.35, envMap: envTex, envMapIntensity: 0.45,
    });
    if (this.USE_PANELS && typeof PANEL_TEX !== 'undefined') this.matBld = this._makeBldMat();
    this.matGlow = new THREE.MeshBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.95, depthWrite: false,
    });
    /* 光暈貼圖（引擎、爆閃、電漿共用） */
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.glowTex = new THREE.CanvasTexture(c);
    this.engineMats = TEAMS.map(T => new THREE.SpriteMaterial({
      map: this.glowTex, color: T.hex, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0.9,
    }));
    /* 引擎噴焰錐共用材質（採礦船金色） */
    /* 噴焰：FLAME_STYLE＝'soft'（柔和尾焰，預設）／'cone'（舊版實心圓錐）／'off'（不畫，只留噴口光點） */
    const mkFlame = hex => this.FLAME_STYLE === 'cone'
      ? new THREE.MeshBasicMaterial({ color: hex, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
      : this._softFlameMat(hex);
    this.flameMats = TEAMS.map(T => mkFlame(T.hex));
    this.flameGold = mkFlame(0xffc94d);
    this.ghostMats = {
      ok: new THREE.MeshBasicMaterial({ color: 0x41d9ff, transparent: true, opacity: 0.32, depthWrite: false }),
      bad: new THREE.MeshBasicMaterial({ color: 0xff4433, transparent: true, opacity: 0.32, depthWrite: false }),
    };
    /* 受擊閃白共享材質（hit-flash 疊層） */
    this.hitFlashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.65, depthWrite: false,
    });
    this.selRingGeo = new THREE.RingGeometry(1, 1.12, 36);
    this.selRingGeo.rotateX(-Math.PI / 2);
    if (this.USE_ROCKS && typeof ROCK_ASSETS !== 'undefined') this._initRocks();   // 月岩貼圖同樣預載
    /* 開機就把所有素材船貼圖載好：否則某艦種第一次出場那一瞬間會是黑的 */
    for (const cls in this.SHIP_MODEL) {
      if (!this._assetSrc(this.SHIP_MODEL[cls])) continue;          // 該素材檔沒載入（例如沒掛 assets_pirates.js）就跳過
      for (let team = 0; team < TEAMS.length; team++) this._shipAssetMat(this.SHIP_MODEL[cls], team);
    }
  },

  FLAME_STYLE: 'soft',
  /* 柔和尾焰：沿長度漸淡（噴口偏白最亮 → 尾端消失），側邊依視角羽化，不再是硬邊實心錐。
     幾何是尖端在 -X、噴口在 x=0 的單位圓錐，所以 -position.x 就是「離噴口多遠」(0~1)。
     合批時是 InstancedMesh，要自己乘 instanceMatrix */
  _softFlameMat(hex) {
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(hex) } },
      vertexShader: `
        varying float vT; varying float vFace;
        void main() {
          vT = clamp(-position.x, 0.0, 1.0);
          mat4 im = mat4(1.0);
          #ifdef USE_INSTANCING
            im = instanceMatrix;
          #endif
          vec4 mv = modelViewMatrix * im * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * mat3(im) * normal);
          vFace = abs(dot(n, normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 color; varying float vT; varying float vFace;
        void main() {
          float a = pow(1.0 - vT, 2.2) * smoothstep(0.05, 0.85, vFace) * 0.75;
          vec3 c = mix(vec3(1.0), color, smoothstep(0.0, 0.35, vT));   // 噴口白熱、往後轉陣營色
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  },

  /* ── 幾何合併 ── */
  _color(key, T) {
    if (typeof key === 'number') return key;
    switch (key) {
      case 'hull': return T.hull;
      case 'dark': return T.dark;
      case 'acc': return T.hex;
      case 'glass': return 0xcfeaff;
      case 'white': return 0xb8c8d8;
      default: return 0xffffff;
    }
  },
  _merge(parts, team) {
    const T = TEAMS[team] || TEAMS[0];
    const solids = [], glows = [];
    const e = new THREE.Euler(), q = new THREE.Quaternion();
    const v = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Matrix4();
    for (const p of parts) {
      let geo = p.g.index ? p.g.toNonIndexed() : p.g.clone();
      e.set(p.rx || 0, p.ry || 0, p.rz || 0);
      q.setFromEuler(e);
      v.set(p.x || 0, p.y || 0, p.z || 0);
      s.set(p.sx || 1, p.sy || 1, p.sz || 1);
      m.compose(v, q, s);
      geo.applyMatrix4(m);
      const isGlow = p.c === 'acc' || p.c === 'glass' || p.glow;
      /* 設定色以 sRGB 看待→轉線性，配 sRGB 輸出管線才不會整體發白 */
      const col = new THREE.Color(this._color(p.c, T)).convertSRGBToLinear();
      const n = geo.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      (isGlow ? glows : solids).push(geo);
    }
    return { solid: this._concat(solids), glow: this._concat(glows) };
  },
  _concat(list) {
    if (!list.length) return null;
    let total = 0;
    for (const g of list) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let off = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      col.set(g.attributes.color.array, off * 3);
      off += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  },

  /* 快捷幾何 */
  _box(w, h, d) { return new THREE.BoxGeometry(w, h, d); },
  _cone(r, h, n) { const g = new THREE.ConeGeometry(r, h, n); g.rotateZ(-Math.PI / 2); return g; },  // 朝 +X
  _cyl(r1, r2, h, n) { return new THREE.CylinderGeometry(r1, r2, h, n); },
  _cylX(r, h, n) { const g = new THREE.CylinderGeometry(r, r, h, n); g.rotateZ(Math.PI / 2); return g; },  // 沿 X

  /* ── 各艦種零件配方 ── */
  /* 星盜艦種沒有自己的程序化外型：借用同級艦的（LOD 遠景與素材縮放的長度基準都用它） */
  PROC_ALIAS: { pir_int: 'int', pir_raid: 'int', pir_gun: 'cor', pir_pat: 'cor' },
  _shipParts(cls) {
    const B = (g, c, o = {}) => Object.assign({ g, c }, o);
    cls = this.PROC_ALIAS[cls] || cls;
    switch (cls) {
      case 'int': return [
        B(this._cone(3.5, 10, 6), 'hull', { x: 7 }),
        B(this._box(11, 3.5, 5), 'hull'),
        B(this._box(8, 0.9, 9), 'dark', { x: -2, z: 6, ry: -0.45 }),
        B(this._box(8, 0.9, 9), 'dark', { x: -2, z: -6, ry: 0.45 }),
        B(this._box(4, 4, 0.9), 'hull', { x: -4.5, y: 2 }),
        B(this._box(3, 1.4, 2.6), 'glass', { x: 2.6, y: 1.8 }),
        B(this._box(3.2, 0.5, 1.4), 'acc', { x: -4.5, z: 8.6, ry: -0.45 }),
        B(this._box(3.2, 0.5, 1.4), 'acc', { x: -4.5, z: -8.6, ry: 0.45 }),
        B(this._box(1.6, 2.2, 3.4), 'acc', { x: -6.4 }),
      ];
      case 'harv': return [
        /* 工作船：金色識別塗裝 */
        B(this._box(17, 9, 11), 'hull'),
        B(this._cylX(4, 13, 8), 'dark', { z: 8, y: -1 }),
        B(this._cylX(4, 13, 8), 'dark', { z: -8, y: -1 }),
        B(this._box(6, 2.2, 2.2), 'hull', { x: 11, z: 3.5, ry: -0.3 }),
        B(this._box(6, 2.2, 2.2), 'hull', { x: 11, z: -3.5, ry: 0.3 }),
        B(this._box(2.4, 3.4, 6.5), 'glass', { x: 8, y: 3 }),
        B(this._box(10, 0.8, 1.2), 0xffc94d, { y: 5, x: -2, glow: true }),
        B(this._box(14, 0.7, 1), 0xffc94d, { z: 6, y: 2.5, glow: true }),
        B(this._box(14, 0.7, 1), 0xffc94d, { z: -6, y: 2.5, glow: true }),
        B(this._box(2, 2.6, 4), 0xffc94d, { x: -9.5, glow: true }),
      ];
      case 'cor': return [
        B(this._box(23, 4.5, 7.5), 'hull'),
        B(this._cone(3.2, 9, 4), 'hull', { x: 15 }),
        B(this._box(9, 3.2, 4.2), 'dark', { z: 6.4, y: 1 }),
        B(this._box(9, 3.2, 4.2), 'dark', { z: -6.4, y: 1 }),
        B(this._box(0.8, 2.2, 3.2), 'acc', { x: 4.6, z: 6.4, y: 1 }),
        B(this._box(0.8, 2.2, 3.2), 'acc', { x: 4.6, z: -6.4, y: 1 }),
        B(this._box(2.6, 1.4, 2.4), 'glass', { x: 8, y: 2.6 }),
        B(this._box(14, 0.6, 1), 'acc', { x: -3, y: -2.4 }),
        B(this._box(2, 2.6, 4.5), 'acc', { x: -12.5 }),
      ];
      case 'des': return [
        B(this._box(32, 5.5, 9.5), 'hull'),
        B(this._cone(4.2, 11, 4), 'hull', { x: 21, ry: Math.PI / 4 }),
        B(this._box(11, 7, 1.2), 'hull', { x: -5, y: 5 }),
        B(this._box(20, 2.5, 3), 'dark', { z: 6, y: -0.5 }),
        B(this._box(20, 2.5, 3), 'dark', { z: -6, y: -0.5 }),
        B(this._box(25, 0.7, 1), 'acc', { z: 5.2, y: 2 }),
        B(this._box(25, 0.7, 1), 'acc', { z: -5.2, y: 2 }),
        B(this._box(1, 5, 0.7), 'acc', { x: -9.5, y: 6 }),
        B(this._box(3.4, 1.6, 3), 'glass', { x: 9, y: 3.4 }),
        B(this._box(2.2, 3, 3), 'acc', { x: -17, z: 3 }),
        B(this._box(2.2, 3, 3), 'acc', { x: -17, z: -3 }),
      ];
      case 'cru': return [
        B(this._box(36, 9, 17), 'hull'),
        B(this._cone(6.5, 13, 4), 'hull', { x: 24, ry: Math.PI / 4 }),
        B(this._box(27, 6.5, 7), 'dark', { z: 11, ry: -0.1 }),
        B(this._box(27, 6.5, 7), 'dark', { z: -11, ry: 0.1 }),
        B(this._cyl(4.5, 5.5, 3.5, 8), 'hull', { x: 7, y: 6 }),
        B(this._cylX(1.4, 12, 6), 'dark', { x: 13, y: 6.5 }),
        B(this._cyl(4.5, 5.5, 3.5, 8), 'hull', { x: -6, y: 6 }),
        B(this._cylX(1.4, 12, 6), 'dark', { x: 0, y: 6.5 }),
        B(this._box(30, 0.8, 1.4), 'acc', { z: 9, y: 3.5 }),
        B(this._box(30, 0.8, 1.4), 'acc', { z: -9, y: 3.5 }),
        B(this._box(2.6, 4, 5), 'acc', { x: -19, z: 5 }),
        B(this._box(2.6, 4, 5), 'acc', { x: -19, z: -5 }),
      ];
      case 'car': return [
        B(this._box(46, 8, 24), 'hull'),
        B(this._box(32, 6, 6), 'dark', { z: 14, y: 1 }),
        B(this._box(32, 6, 6), 'dark', { z: -14, y: 1 }),
        B(this._box(7, 9, 5.5), 'hull', { x: -13, y: 8 }),
        B(this._box(26, 1, 1), 'acc', { z: 14, y: 4.4 }),
        B(this._box(26, 1, 1), 'acc', { z: -14, y: 4.4 }),
        B(this._box(30, 0.5, 2.4), 'acc', { y: 4.3 }),
        B(this._box(2.6, 2, 3), 'glass', { x: -13, y: 12 }),
        B(this._box(2.8, 3.6, 5), 'acc', { x: -24, z: 7 }),
        B(this._box(2.8, 3.6, 5), 'acc', { x: -24, z: -7 }),
        B(this._box(2.8, 3.6, 5), 'acc', { x: -24 }),
      ];
      case 'bat': return [
        B(this._box(60, 10, 15), 'hull'),
        B(this._box(36, 13, 24), 'hull', { x: -7 }),
        B(this._cone(7.5, 17, 4), 'hull', { x: 37, ry: Math.PI / 4 }),
        B(this._cylX(2.4, 24, 8), 'dark', { x: 24, y: 3.5 }),
        B(this._box(2.5, 3, 3), 'acc', { x: 37, y: 3.5 }),
        B(this._box(21, 3.5, 11), 'dark', { x: -18, z: 15 }),
        B(this._box(21, 3.5, 11), 'dark', { x: -18, z: -15 }),
        B(this._cyl(5, 6, 4, 8), 'hull', { x: 6, y: 7.5 }),
        B(this._cylX(1.6, 13, 6), 'dark', { x: 13, y: 8 }),
        B(this._cyl(5, 6, 4, 8), 'hull', { x: -10, y: 7.5 }),
        B(this._cylX(1.6, 13, 6), 'dark', { x: -3, y: 8 }),
        B(this._box(48, 0.9, 1.6), 'acc', { z: 8.5, y: 4 }),
        B(this._box(48, 0.9, 1.6), 'acc', { z: -8.5, y: 4 }),
        B(this._box(16, 0.9, 1.6), 'acc', { x: -18, z: 20.5 }),
        B(this._box(16, 0.9, 1.6), 'acc', { x: -18, z: -20.5 }),
        B(this._box(3.4, 4.5, 6), 'acc', { x: -26, z: 6 }),
        B(this._box(3.4, 4.5, 6), 'acc', { x: -26, z: -6 }),
        B(this._box(3.4, 4.5, 6), 'acc', { x: -26 }),
      ];
      /* 新艦種的程序化外型：同時是素材模型的「長度基準」與遠景 LOD */
      case 'bomb': return [
        B(this._box(13, 3.2, 6), 'hull'),
        B(this._cone(3, 7, 4), 'hull', { x: 9.5 }),
        B(this._box(7, 0.9, 16), 'dark', { x: -2 }),
        B(this._box(3, 1.6, 2.4), 'glass', { x: 4, y: 2 }),
        B(this._box(1.6, 2.4, 4), 'acc', { x: -7 }),
        B(this._box(4, 1.2, 1.4), 'acc', { x: -1, z: 8, y: -1 }),
        B(this._box(4, 1.2, 1.4), 'acc', { x: -1, z: -8, y: -1 }),
      ];
      case 'arty': return [
        B(this._box(44, 6, 10), 'hull'),
        B(this._cylX(2.6, 40, 8), 'dark', { x: 26, y: 2.5 }),
        B(this._box(16, 8, 18), 'hull', { x: -16 }),
        B(this._box(10, 4, 6), 'dark', { x: -6, y: 6 }),
        B(this._box(2.6, 1.6, 3), 'glass', { x: -6, y: 9 }),
        B(this._box(36, 0.7, 1.2), 'acc', { x: 2, z: 5.4, y: 1 }),
        B(this._box(36, 0.7, 1.2), 'acc', { x: 2, z: -5.4, y: 1 }),
        B(this._box(2.6, 4, 6), 'acc', { x: -25, z: 4 }),
        B(this._box(2.6, 4, 6), 'acc', { x: -25, z: -4 }),
      ];
      case 'dread': return [
        B(this._box(96, 14, 30), 'hull'),
        B(this._box(54, 18, 40), 'hull', { x: -18 }),
        B(this._cone(12, 26, 4), 'hull', { x: 60, ry: Math.PI / 4 }),
        B(this._box(36, 6, 12), 'dark', { x: -22, z: 26 }),
        B(this._box(36, 6, 12), 'dark', { x: -22, z: -26 }),
        B(this._box(16, 16, 14), 'hull', { x: -24, y: 16 }),
        B(this._box(4, 2.4, 10), 'glass', { x: -16, y: 23 }),
        B(this._cylX(3.2, 30, 8), 'dark', { x: 28, y: 9, z: 7 }),
        B(this._cylX(3.2, 30, 8), 'dark', { x: 28, y: 9, z: -7 }),
        B(this._box(80, 1.2, 2), 'acc', { x: 4, z: 15.5, y: 5 }),
        B(this._box(80, 1.2, 2), 'acc', { x: 4, z: -15.5, y: 5 }),
        B(this._box(4.5, 7, 9), 'acc', { x: -46, z: 10 }),
        B(this._box(4.5, 7, 9), 'acc', { x: -46, z: -10 }),
        B(this._box(4.5, 7, 9), 'acc', { x: -46 }),
      ];
      case 'drone': return [
        B(this._cone(2.4, 6, 4), 'hull', { x: 3 }),
        B(this._box(5, 1.8, 4.5), 'hull', { x: -1 }),
        B(this._box(1.2, 1.2, 2.2), 'acc', { x: -3.8 }),
      ];
    }
    return [B(this._box(10, 10, 10), 'hull')];
  },

  /* ── 建築配方 ── */
  _bldParts(cls) {
    const B = (g, c, o = {}) => Object.assign({ g, c }, o);
    switch (cls) {
      case 'ref': return [
        B(this._cyl(9, 10, 28, 10), 'hull', { x: -14, z: -9, y: 8 }),
        B(this._cyl(9, 10, 28, 10), 'hull', { x: 14, z: -9, y: 8 }),
        B(this._cyl(9, 10, 28, 10), 'hull', { z: 14, y: 8 }),
        B(this._box(34, 3, 3), 'dark', { y: 16, z: -9 }),
        B(this._box(3, 3, 26), 'dark', { x: 7, y: 16, z: 2, ry: 0.5 }),
        B(this._box(3, 3, 26), 'dark', { x: -7, y: 16, z: 2, ry: -0.5 }),
        B(this._cyl(11, 11, 1.6, 10), 'acc', { x: -14, z: -9, y: 15 }),
        B(this._cyl(11, 11, 1.6, 10), 'acc', { x: 14, z: -9, y: 15 }),
        B(this._cyl(11, 11, 1.6, 10), 'acc', { z: 14, y: 15 }),
        B(this._cyl(20, 24, 5, 8), 'dark', { y: -3 }),
      ];
      case 'yard': return [
        B(this._box(7, 30, 7), 'hull', { x: -34, z: -24, y: 8 }),
        B(this._box(7, 30, 7), 'hull', { x: 34, z: -24, y: 8 }),
        B(this._box(7, 30, 7), 'hull', { x: -34, z: 24, y: 8 }),
        B(this._box(7, 30, 7), 'hull', { x: 34, z: 24, y: 8 }),
        B(this._box(75, 5, 7), 'dark', { y: 21, z: -24 }),
        B(this._box(75, 5, 7), 'dark', { y: 21, z: 24 }),
        B(this._box(7, 5, 55), 'dark', { x: -34, y: 21 }),
        B(this._box(7, 5, 55), 'dark', { x: 34, y: 21 }),
        B(this._box(66, 0.8, 2), 'acc', { y: 24, z: -24 }),
        B(this._box(66, 0.8, 2), 'acc', { y: 24, z: 24 }),
        B(this._box(56, 1.5, 34), 'acc', { y: -4, c: 'acc' }),
        B(this._box(5, 12, 5), 'hull', { x: 34, z: 24, y: 30 }),
        B(this._box(1.2, 6, 1.2), 'acc', { x: 34, z: 24, y: 39 }),
      ];
      case 'lab': return [
        B(this._cyl(13, 17, 9, 8), 'hull', { y: 0 }),
        B(new THREE.SphereGeometry(15, 14, 10), 'white', { y: 16 }),
        /* 環改為 makeBld 動態零件（會旋轉） */
        B(this._box(1.6, 22, 1.6), 'hull', { y: 34 }),
        B(new THREE.SphereGeometry(2.4, 6, 5), 'acc', { y: 46 }),
        B(this._box(8, 2, 8), 'dark', { y: 8 }),
      ];
      case 'outpost': {
        /* 六角平台＋三支對接臂（臂端有燈）＋中央塔樓、桅杆與碟形天線；燈只點在邊角，不做整片發光 */
        const P = [
          B(this._cyl(30, 34, 7, 6), 'hull', { y: -4 }),
          B(this._cyl(16, 21, 16, 6), 'dark', { y: 7 }),
          B(this._cyl(10, 12, 8, 6), 'hull', { y: 19 }),
          B(this._cyl(2, 2.6, 34, 6), 'hull', { y: 38 }),
          B(this._cyl(15, 3, 5, 12), 'white', { y: 50, x: 3, rz: 0.45 }),
        ];
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3;
          P.push(B(this._box(30, 4, 7), 'hull', { x: Math.cos(a) * 38, z: Math.sin(a) * 38, y: -2, ry: -a }));
          P.push(B(this._box(5, 5, 9), 'dark', { x: Math.cos(a) * 54, z: Math.sin(a) * 54, y: -2, ry: -a }));
          P.push(B(this._box(2.2, 2.2, 2.2), 'acc', { x: Math.cos(a) * 57, z: Math.sin(a) * 57, y: 1.5 }));
        }
        for (let i = 0; i < 6; i++) {
          const a = (i + 0.5) * Math.PI / 3;
          P.push(B(this._box(2, 1.6, 2), 'acc', { x: Math.cos(a) * 31, z: Math.sin(a) * 31, y: 0 }));
        }
        return P;
      }
      case 'sat': {
        /* 偵察衛星：小主艙＋左右兩片太陽能板（深藍＋淺色格線）＋底座；碟形天線是會轉的動態零件（_satExtras） */
        const P = [
          B(this._cyl(9, 11, 3, 8), 'dark', { y: -3 }),
          B(this._cyl(4.5, 6, 11, 8), 'hull', { y: 5 }),
          B(this._box(46, 1.2, 1.6), 'dark', { y: 7 }),
          B(this._cyl(0.9, 0.9, 12, 6), 'hull', { y: 15 }),
        ];
        for (const sx of [-1, 1]) {
          P.push(B(this._box(15, 0.7, 10), 0x1f3f86, { x: sx * 17, y: 7 }));
          for (const gz of [-2.5, 2.5]) P.push(B(this._box(15.2, 0.8, 0.5), 0x7d9cc8, { x: sx * 17, y: 7, z: gz }));
          P.push(B(this._box(0.5, 0.8, 10.2), 0x7d9cc8, { x: sx * 17, y: 7 }));
        }
        P.push(B(this._box(2, 1.4, 2), 'acc', { y: 0.5, x: 6 }));
        return P;
      }
      case 'tur': return [
        B(this._cyl(13, 17, 9, 8), 'hull', { y: -2 }),
        B(this._cyl(5, 6, 7, 8), 'dark', { y: 4 }),
      ];
      case 'base': return [
        B(this._cyl(27, 32, 26, 8), 'hull'),
        B(this._cyl(20, 24, 10, 8), 'dark', { y: 17 }),
        B(this._cone(11, 26, 6), 'hull', { y: 30, rz: Math.PI / 2 }),  // 朝上尖塔
        B(new THREE.SphereGeometry(3.4, 8, 6), 'acc', { y: 46 }),
        B(this._box(60, 2.5, 2.5), 'dark', { y: -6, ry: Math.PI / 4 }),
        B(this._box(60, 2.5, 2.5), 'dark', { y: -6, ry: -Math.PI / 4 }),
        B(this._box(2, 1.6, 26), 'acc', { y: 6, x: 30, ry: 0 }),
        B(this._box(2, 1.6, 26), 'acc', { y: 6, x: -30 }),
        B(this._box(26, 1.6, 2), 'acc', { y: 6, z: 30 }),
        B(this._box(26, 1.6, 2), 'acc', { y: 6, z: -30 }),
        B(this._cyl(33, 33, 2, 8), 'acc', { y: -12 }),
      ];
    }
    return [B(this._box(20, 20, 20), 'hull')];
  },

  /* ── Kenney Space Kit（CC0；資料在 js/assets_kenney.js）：建築與小行星 ──
     Kenney 模型只有材質名沒有貼圖，這裡依材質名換成陣營配色 */
  USE_KENNEY: false,  // true＝建築與小行星改用 Kenney（2026-10-05 試過：方塊感重、不如原版，預設關；戰艦不受影響）
  _useKenney() { return this.USE_KENNEY && typeof KENNEY_ASSETS !== 'undefined'; },
  KENNEY_BLD: { ref: 'machine_generatorLarge', yard: 'hangar_largeA', lab: 'satelliteDish_large', tur: 'turret_double' },
  KENNEY_ROCKS: ['rock_crystals', 'rock_crystalsLargeA', 'rock_crystalsLargeB'],
  /* 攤平成 [{geo, mat, node}]，幾何已套用節點變換；skipNode 底下的節點略過、onlyNode 只取該節點 */
  _kenneyPrims(name, opt = {}) {
    const A = KENNEY_ASSETS[name];
    const out = [];
    const walk = (ni, parentM, inside) => {
      const n = A.nodes[ni];
      if (opt.skipNode && n.name === opt.skipNode) return;
      const local = new THREE.Matrix4();
      const isOnly = opt.onlyNode && n.name === opt.onlyNode;
      /* onlyNode 本身的變換不套（頭部在自己的座標系裡轉） */
      if (!isOnly) {
        const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
        local.compose(new THREE.Vector3(...t), new THREE.Quaternion(...r), new THREE.Vector3(...s));
      }
      const m = parentM.clone().multiply(local);
      const take = !opt.onlyNode || inside || isOnly;
      if (take && n.mesh !== undefined) {
        for (const p of A.meshes[n.mesh]) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(this._decode(p.pos, Float32Array), 3));
          g.setAttribute('normal', new THREE.BufferAttribute(this._decode(p.nor, Float32Array), 3));
          g.setIndex(new THREE.BufferAttribute(this._decode(p.idx, Uint32Array), 1));
          g.applyMatrix4(m);
          out.push({ geo: g.toNonIndexed(), mat: p.mat, node: n.name });
        }
      }
      for (const c of (n.children || [])) walk(c, isOnly ? new THREE.Matrix4() : m, inside || isOnly);
    };
    for (const r of A.roots) walk(r, new THREE.Matrix4(), false);
    return out;
  },
  _kenneyNodeT(name, node) {
    const n = KENNEY_ASSETS[name].nodes.find(x => x.name === node);
    return new THREE.Vector3(...(n.translation || [0, 0, 0]));
  },
  /* 依材質名上色並分實體／發光兩組（metalRed＝陣營色發光條） */
  _kenneyMerge(prims, team) {
    const T = TEAMS[team] || TEAMS[0];
    const colOf = { metal: 0x7d8ea3, metalDark: T.hull, dark: T.dark };
    const solids = [], glows = [];
    for (const p of prims) {
      const glow = p.mat === 'metalRed';
      const col = new THREE.Color(glow ? T.hex : (colOf[p.mat] || 0x8899aa)).convertSRGBToLinear();
      const n = p.geo.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
      p.geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      (glow ? glows : solids).push(p.geo);
    }
    return { solid: this._concat(solids), glow: this._concat(glows) };
  },
  /* 把 Kenney 建築縮放到跟舊程序化建築一樣寬（佔地與點選範圍不變），底部對齊 */
  _kenneyBldFit(cls) {
    if (!this._kFit) this._kFit = {};
    if (this._kFit[cls]) return this._kFit[cls];
    const name = this.KENNEY_BLD[cls];
    const all = this._kenneyPrims(name);
    const box = new THREE.Box3();
    for (const p of all) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
    const old = this._merge(this._bldParts(cls), 0).solid;
    old.computeBoundingBox();
    const ob = old.boundingBox;
    const k = Math.max(ob.max.x - ob.min.x, ob.max.z - ob.min.z) / Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const c = new THREE.Vector3(); box.getCenter(c);
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2)          // 素材朝 +Z → 遊戲朝 +X
      .multiply(new THREE.Matrix4().makeScale(k, k, k))
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
    const fit = { m, k, yOff: ob.min.y };
    m.premultiply(new THREE.Matrix4().makeTranslation(0, ob.min.y, 0));
    return (this._kFit[cls] = fit);
  },
  _kenneyBldGeo(cls, team) {
    const fit = this._kenneyBldFit(cls);
    const prims = this._kenneyPrims(this.KENNEY_BLD[cls], cls === 'tur' ? { skipNode: 'turret' } : {});
    for (const p of prims) p.geo.applyMatrix4(fit.m);
    return this._kenneyMerge(prims, team);
  },

  /* ── 對外 API ── */
  _getGeo(kind, cls, team) {
    const key = kind + cls + team;
    if (!this.geoCache[key]) {
      if (kind === 'b' && this._useKenney() && this.KENNEY_BLD[cls]) {
        this.geoCache[key] = this._kenneyBldGeo(cls, team);
      } else {
        const parts = kind === 's' ? this._shipParts(cls) : this._bldParts(cls);
        this.geoCache[key] = this._merge(parts, team);
      }
    }
    return this.geoCache[key];
  },

  _assemble(geos) {
    const g = new THREE.Group();
    if (geos.solid) g.add(new THREE.Mesh(geos.solid, this.matSolid));
    if (geos.glow) g.add(new THREE.Mesh(geos.glow, this.matGlow));
    return g;
  },
  /* 建築版：實體部分改用帶科幻面板紋路的材質 */
  _assembleB(geos) {
    const g = this._assemble(geos);
    if (this.matBld) for (const o of g.children) if (o.material === this.matSolid) o.material = this.matBld;
    return g;
  },

  /* ── 建築科幻面板（ambientCG CC0；資料在 js/assets_panels.js）──
     程序化建築沒有 UV，改用「三平面投影」：依表面朝向從 X/Y/Z 三個方向投影灰階貼圖，乘在陣營色上。
     面板＝小尺度接縫紋路，鏽蝕＝大尺度明暗髒污；用物件座標，所以建築轉動時紋路黏在表面上 */
  USE_PANELS: true,
  _makeBldMat() {
    const loader = new THREE.TextureLoader();
    const tex = url => { const t = loader.load(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
    const m = this.matSolid.clone();
    const uni = { uTpPanel: { value: tex(PANEL_TEX.panel) }, uTpGrime: { value: tex(PANEL_TEX.grime) } };
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = 'varying vec3 vTpPos;\nvarying vec3 vTpNrm;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\n  vTpPos = position; vTpNrm = normal;');
      sh.fragmentShader = 'uniform sampler2D uTpPanel;\nuniform sampler2D uTpGrime;\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;\n' +
        sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 bw = pow(abs(normalize(vTpNrm)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
    vec3 pp = vTpPos / 58.0, pg = vTpPos / 160.0;
    float pn = texture2D(uTpPanel, pp.yz).r * bw.x + texture2D(uTpPanel, pp.xz).r * bw.y + texture2D(uTpPanel, pp.xy).r * bw.z;
    float gr = texture2D(uTpGrime, pg.yz).r * bw.x + texture2D(uTpGrime, pg.xz).r * bw.y + texture2D(uTpGrime, pg.xy).r * bw.z;
    diffuseColor.rgb *= mix(0.5, 1.75, pn) * mix(0.7, 1.2, gr);
  }`);
    };
    m.customProgramCacheKey = () => 'bldTriplanar';
    return m;
  },

  /* ── 素材包戰艦（Quaternius Ultimate Spaceships, CC0；資料在 js/assets_ships.js） ──
     每個艦種對應一款模型；縮放成跟舊程序化模型一樣長，射程/碰撞/引擎位置都不用改 */
  SHIP_MODEL: {
    harv: 'Bob', int: 'Striker', cor: 'Spitfire', des: 'Dispatcher',
    cru: 'Insurgent', car: 'Pancake', bat: 'Imperial', drone: 'Zenith',
    bomb: 'Challenger', arty: 'Omen', dread: 'Executioner',
    /* 星盜（第四方事件）：Polyy Pack 2 紅色船，資料在 js/assets_pirates.js（PIRATE_ASSETS） */
    pir_int: 'p2-twin_boom_interceptor', pir_raid: 'p2-split_nose_raider',
    pir_gun: 'p2-chin_turret_gunship', pir_pat: 'p2-sponson_patrol',
  },
  /* 素材查表：先 SHIP_ASSETS（Quaternius）再 PIRATE_ASSETS（Polyy）；都沒有回 null → 走程序化外型 */
  _assetSrc(model) {
    if (!model) return null;
    if (typeof SHIP_ASSETS !== 'undefined' && SHIP_ASSETS[model]) return SHIP_ASSETS[model];
    if (typeof PIRATE_ASSETS !== 'undefined' && PIRATE_ASSETS[model]) return PIRATE_ASSETS[model];
    return null;
  },
  _assetGeo: {}, _assetMat: {},
  _decode(s, T) {
    const b = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    return new T(b.buffer);
  },
  _shipAssetGeo(cls) {
    if (this._assetGeo[cls]) return this._assetGeo[cls];
    const a = this._assetSrc(this.SHIP_MODEL[cls]);
    const g = new THREE.BufferGeometry();
    if (a.q) {
      /* 量化格式（assets_pirates.js）：pos＝Int16（lo + (q+32767)/65534*span）、nor＝Int8/127、uv＝Uint16（uvLo + q/65535*uvSpan）。
         解碼成 Float32 再交給後面的旋轉／縮放（量化值不能直接 rotate/scale） */
      const qp = this._decode(a.pos, Int16Array), qn = this._decode(a.nor, Int8Array), qu = this._decode(a.uv, Uint16Array);
      const P = new Float32Array(qp.length), N = new Float32Array(qn.length), UV = new Float32Array(qu.length);
      for (let i = 0; i < qp.length; i++) { const c = i % 3; P[i] = a.lo[c] + (qp[i] + 32767) / 65534 * a.span[c]; N[i] = qn[i] / 127; }
      for (let i = 0; i < qu.length; i++) { const c = i & 1; UV[i] = a.uvLo[c] + qu[i] / 65535 * a.uvSpan[c]; }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    } else {
      g.setAttribute('position', new THREE.BufferAttribute(this._decode(a.pos, Float32Array), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(this._decode(a.nor, Float32Array), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(this._decode(a.uv, Float32Array), 2));
    }
    g.setIndex(new THREE.BufferAttribute(this._decode(a.idx, a.idx32 ? Uint32Array : Uint16Array), 1));
    g.rotateY(Math.PI / 2);                       // 素材船頭朝 +Z → 遊戲船頭朝 +X
    /* 對齊舊模型：長度相同、中心相同 */
    const old = this._getGeo('s', cls, 0).solid;
    old.computeBoundingBox(); g.computeBoundingBox();
    const ob = old.boundingBox, nb = g.boundingBox;
    const k = (ob.max.x - ob.min.x) / (nb.max.x - nb.min.x);
    const oc = new THREE.Vector3(), nc = new THREE.Vector3();
    ob.getCenter(oc); nb.getCenter(nc);
    g.translate(-nc.x, -nc.y, -nc.z);
    g.scale(k, k, k);
    g.translate(oc.x, oc.y, oc.z);
    return (this._assetGeo[cls] = g);
  },
  TEAM_TEX: ['Blue', 'Red', 'Green', 'Red'],   // team 3 星盜：Polyy 是固定塗裝，Blue/Red 同圖，用 Red
  _shipAssetMat(model, team) {
    const key = model + team;
    if (this._assetMat[key]) return this._assetMat[key];
    /* 貼圖配色依陣營查表（Quaternius 原檔有 Blue/Red/Green…多套塗裝；缺色時退回紅） */
    const texs = this._assetSrc(model).tex;
    const tex = new THREE.TextureLoader().load(texs[this.TEAM_TEX[team]] || texs.Red);
    tex.encoding = THREE.sRGBEncoding;
    tex.flipY = false;                            // glTF 的 UV 原點在左上
    tex.anisotropy = 4;
    return (this._assetMat[key] = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.55, metalness: 0.3,
      envMap: this.matSolid.envMap, envMapIntensity: 0.45,
      /* 太空場景光線暗，帶一點自發光讓塗裝遠看也認得出陣營色 */
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12,
    }));
  },

  /* ── 3D Warehouse 素材（General Model License；資料在 js/assets_warehouse.js，debug/build_warehouse_assets.py 產生）──
     5 座建築＋2 艘主力艦。模型沒貼圖，顏色已烘進頂點色（sRGB Uint8）；
     陣營色＝載入時把「飽和度高」的頂點色換成陣營色，白灰船殼保留。關掉 USE_WAREHOUSE 就完全回到原本外型 */
  USE_WAREHOUSE: true,
  WAREHOUSE_MODEL: { base: 'W60', outpost: 'W15', ref: 'W56', yard: 'W21', lab: 'W17', dread: 'W2', arty: 'W10' },
  WH_SAT: 0.45,      // 飽和度門檻（HSV 的 S）：超過就算「彩色飾件」→ 換陣營色
  WH_TINT: 0.25,     // 白灰船殼往陣營色偏的比例（0＝原色），遠看也分得出敵我
  WH_BLD_FIT: { lab: 2.0 },
  _whCode(cls) {
    if (!this.USE_WAREHOUSE || typeof WAREHOUSE_ASSETS === 'undefined') return null;
    const c = this.WAREHOUSE_MODEL[cls];
    return c && WAREHOUSE_ASSETS[c] ? c : null;
  },
  _whCache: {},
  /* 解碼成 Float32 座標／法線＋索引（每個模型一次） */
  _whDecode(code) {
    const k = 'raw' + code;
    if (this._whCache[k]) return this._whCache[k];
    const A = WAREHOUSE_ASSETS[code];
    const q = this._decode(A.pos, Int16Array), qn = this._decode(A.nor, Int8Array);
    const n = q.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) {
      pos[i * 3 + j] = A.lo[j] + (q[i * 3 + j] + 32767) / 65534 * A.span[j];
      nor[i * 3 + j] = qn[i * 3 + j] / 127;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(this._decode(A.idx, A.idx32 ? Uint32Array : Uint16Array), 1));
    g.normalizeNormals();
    return (this._whCache[k] = { g, col: this._decode(A.col, Uint8Array) });
  },
  /* 每個艦種／建築：縮放、對齊後的幾何（座標與法線），陣營之間共用 */
  _whFitted(cls) {
    const k = 'fit' + cls;
    if (this._whCache[k]) return this._whCache[k];
    const g = this._whDecode(this._whCode(cls)).g.clone();
    g.computeBoundingBox();
    const nb = g.boundingBox, nc = new THREE.Vector3();
    nb.getCenter(nc);
    const ob = this._oldBox(cls), oc = new THREE.Vector3();
    ob.getCenter(oc);
    let s;
    if (this.BLDS_KIND(cls)) {
      /* 建築：最長的水平邊＝碰撞半徑 × WH_BLD_FIT（≈直徑），所以碰撞／可建範圍圈／選取框都跟外型對得上；
         母艦 1.8×95＝171，剛好等於舊版旋轉環外徑。研究站（W17）細長，給 2.0 */
      const target = (this.WH_BLD_FIT[cls] || 1.8) * BLDS[cls].radius;
      s = target / Math.max(nb.max.x - nb.min.x, nb.max.z - nb.min.z);
    } else {
      g.rotateY(Math.PI / 2);                       // 素材船頭朝 +Z → 遊戲船頭朝 +X
      g.computeBoundingBox(); g.boundingBox.getCenter(nc);
      s = (ob.max.x - ob.min.x) / (g.boundingBox.max.x - g.boundingBox.min.x);   // 跟舊模型一樣長
    }
    g.translate(-nc.x, -nc.y, -nc.z);
    g.scale(s, s, s);
    g.translate(oc.x, oc.y, oc.z);
    g.computeBoundingBox();
    return (this._whCache[k] = g);
  },
  BLDS_KIND(cls) { return typeof BLDS !== 'undefined' && !!BLDS[cls]; },
  /* 舊程序化外型的包圍盒（含母艦旋轉環、研究站環這些動態零件） */
  _oldBox(cls) {
    const isB = this.BLDS_KIND(cls);
    const geos = this._getGeo(isB ? 'b' : 's', cls, 0);
    const box = new THREE.Box3();
    for (const gg of [geos.solid, geos.glow]) if (gg) { gg.computeBoundingBox(); box.union(gg.boundingBox); }
    if (cls === 'base') box.union(new THREE.Box3(new THREE.Vector3(-85, -5, -85), new THREE.Vector3(85, 5, 85)));       // 旋轉環 r80+5
    if (cls === 'lab') box.union(new THREE.Box3(new THREE.Vector3(-21.6, 14, -21.6), new THREE.Vector3(21.6, 18, 21.6)));  // 研究環 r20+1.6
    return box;
  },
  /* 陣營版本：共用座標／法線／索引，只換頂點色 */
  _whGeo(cls, team) {
    const k = 'geo' + cls + team;
    if (this._whCache[k]) return this._whCache[k];
    const base = this._whFitted(cls), src = this._whDecode(this._whCode(cls)).col;
    const T = TEAMS[team] || TEAMS[0];
    const tc = new THREE.Color(T.hex);           // sRGB
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    const n = src.length / 3, col = new Float32Array(n * 3), th = this.WH_SAT;
    const ti = this.WH_TINT, tr = 1 - ti + ti * tc.r, tg = 1 - ti + ti * tc.g, tb = 1 - ti + ti * tc.b;
    for (let i = 0; i < n; i++) {
      const r = src[i * 3], gg = src[i * 3 + 1], b = src[i * 3 + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      if (mx > 60 && (mx - mn) / mx > th) {
        /* 彩色飾件 → 陣營色（保留一點原本明暗） */
        const k2 = 0.75 + 0.25 * mx / 255;
        col[i * 3] = lut[Math.round(tc.r * 255 * k2)]; col[i * 3 + 1] = lut[Math.round(tc.g * 255 * k2)]; col[i * 3 + 2] = lut[Math.round(tc.b * 255 * k2)];
      } else {
        col[i * 3] = lut[Math.round(r * tr)]; col[i * 3 + 1] = lut[Math.round(gg * tg)]; col[i * 3 + 2] = lut[Math.round(b * tb)];
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setIndex(base.index);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.boundingBox = base.boundingBox.clone();
    g.computeBoundingSphere();
    g.userData.shared = true;
    return (this._whCache[k] = g);
  },
  _whMat() {
    /* SketchUp 模型常有反面 → 雙面；其餘跟程序化船殼同一套金屬感 */
    return this.matWh || (this.matWh = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide,
      envMap: this.matSolid.envMap, envMapIntensity: 0.45,
    }));
  },

  makeShip(cls, team, radius) {
    const wh = this._whCode(cls);
    const useAsset = wh || !!this._assetSrc(this.SHIP_MODEL[cls]);
    const g = wh
      ? (() => { const gr = new THREE.Group(); gr.add(new THREE.Mesh(this._whGeo(cls, team), this._whMat())); return gr; })()
      : useAsset
      ? (() => { const gr = new THREE.Group(); gr.add(new THREE.Mesh(this._shipAssetGeo(cls), this._shipAssetMat(this.SHIP_MODEL[cls], team))); return gr; })()
      : this._assemble(this._getGeo('s', cls, team));
    /* 引擎光點（採礦船用金色，一眼識別工作船） */
    if (cls === 'harv' && !this._goldEngine) {
      this._goldEngine = new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xffc94d, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0.9,
      });
    }
    const spr = new THREE.Sprite(cls === 'harv' ? this._goldEngine : this.engineMats[team]);
    const len = radius * 1.1;
    spr.position.set(-len, 0, 0);
    spr.scale.set(radius * 1.3, radius * 1.3, 1);
    g.add(spr);
    g.userData.engine = spr;
    /* 引擎噴焰錐：推進時往後噴的方向性火舌（尖端朝 -X，底部在噴口） */
    if (!this._flameGeo) {
      this._flameGeo = new THREE.ConeGeometry(0.5, 1, 14, 4, true);   // 多切幾段，漸層與羽化才平滑
      this._flameGeo.rotateZ(Math.PI / 2);
      this._flameGeo.translate(-0.5, 0, 0);
    }
    const flame = new THREE.Mesh(this._flameGeo, cls === 'harv' ? this.flameGold : this.flameMats[team]);
    if (this.FLAME_STYLE === 'off') flame.userData.off = true;
    flame.position.set(-radius * 0.92, 0, 0);
    flame.visible = false;
    g.add(flame);
    g.userData.flame = flame;
    /* 合批：船殼、引擎光點、噴焰都交給 Batch 一次畫（見 batch.js） */
    if (typeof Batch !== 'undefined') {
      for (const c of g.children) if (c.isMesh && c !== flame) { c.userData.hull = true; Batch.addMesh(c); }
      /* LOD：離鏡頭遠時改畫舊版程序化模型（同長度、同中心、陣營色，三角形約少 20~50 倍） */
      if (useAsset) g.children[0].userData.lod = { geo: this._getGeo('s', cls, team).solid, mat: this.matSolid };
      Batch.addGlow(spr);
      Batch.addMesh(flame);
    }
    return g;
  },

  /* 動態零件的合併幾何也要快取：原本每蓋一座就重做一份且從不釋放（每局重開 +2 幾何的洩漏，10-05 修） */
  _partGeo(key, team, partsFn) {
    const k = 'p' + key + team;
    return this.geoCache[k] || (this.geoCache[k] = this._merge(partsFn(), team));
  },

  /* 3D Warehouse 建築：外型已縮放成跟舊建築同樣佔地（見 _whFitted），母艦旋轉環／研究環／精煉塔脈動光
     這些對著舊外型擺的動態零件不加；前哨站與船塢的信標燈移到模型頂端 */
  _makeBldWh(cls, team) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(this._whGeo(cls, team), this._whMat());
    g.add(m);
    if (typeof Batch !== 'undefined') { m.userData.hull = true; Batch.addMesh(m); }   // 受擊閃白走 e._flash
    if (cls === 'outpost' || cls === 'yard') {
      const bb = this._whFitted(cls).boundingBox, c = new THREE.Vector3();
      bb.getCenter(c);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xffd166, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0.9,
      }));
      s.position.set(c.x, bb.max.y + 4, c.z);
      s.scale.set(cls === 'outpost' ? 16 : 10, cls === 'outpost' ? 16 : 10, 1);
      g.add(s);
      g.userData.beacon = s;
    }
    return g;
  },

  makeBld(cls, team) {
    const g = this._makeBldBody(cls, team);
    this._addBldGlow(g, cls, team);
    return g;
  },
  _makeBldBody(cls, team) {
    if (cls !== 'tur' && this._whCode(cls)) return this._makeBldWh(cls, team);
    const g = this._assembleB(this._getGeo('b', cls, team));
    if (cls === 'base') {
      /* 旋轉環 */
      const ring = new THREE.Group();
      ring.add(this._assembleB(this._partGeo('ring', team, () => {
        const rParts = [
          { g: new THREE.TorusGeometry(80, 5, 8, 44), c: 'hull', rx: Math.PI / 2 },
        ];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          rParts.push({ g: this._box(16, 6, 11), c: 'dark', x: Math.cos(a) * 80, z: Math.sin(a) * 80, ry: -a });
          rParts.push({ g: this._box(17, 1.4, 3), c: 'acc', x: Math.cos(a) * 80, z: Math.sin(a) * 80, y: 4, ry: -a });
        }
        return rParts;
      })));
      g.add(ring);
      g.userData.ring = ring;
    }
    if (cls === 'lab') {
      /* 旋轉研究環 */
      const ring = this._assembleB(this._partGeo('labring', team, () => [
        { g: new THREE.TorusGeometry(20, 1.6, 6, 28), c: 'acc', rx: Math.PI / 2 },
      ]));
      ring.position.y = 16;
      ring.rotation.z = 0.12;
      g.add(ring);
      g.userData.spin = ring;
    }
    if (cls === 'outpost') {
      /* 桅杆頂信標（金色）：一眼看出是延伸據點 */
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xffd166, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0.9,
      }));
      s.position.set(0, 57, 0);
      s.scale.set(16, 16, 1);
      g.add(s);
      g.userData.beacon = s;
    }
    if (cls === 'yard') {
      /* 桅杆頂信標燈 */
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xffd166, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0.9,
      }));
      s.position.set(34, 44, 24);
      s.scale.set(10, 10, 1);
      g.add(s);
      g.userData.beacon = s;
    }
    if (cls === 'ref') {
      /* 三座塔頂脈動光 */
      g.userData.pulse = [[-14, -9], [14, -9], [0, 14]].map(([px2, pz2]) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.glowTex, color: 0x8ef5d8, blending: THREE.AdditiveBlending,
          transparent: true, depthWrite: false, opacity: 0.45,
        }));
        s.position.set(px2, 24, pz2);
        s.scale.set(12, 12, 1);
        g.add(s);
        return s;
      });
    }
    if (cls === 'sat') this._satExtras(g, team);
    if (cls === 'tur' && this._useKenney()) {
      /* Kenney 雙管砲塔：砲塔頭是獨立節點，拿出來當可旋轉零件 */
      const name = this.KENNEY_BLD.tur, fit = this._kenneyBldFit('tur');
      if (!this._kHead) this._kHead = {};
      if (!this._kHead[team]) {
        const prims = this._kenneyPrims(name, { onlyNode: 'turret' });
        const rs = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeScale(fit.k, fit.k, fit.k));
        for (const p of prims) p.geo.applyMatrix4(rs);
        this._kHead[team] = this._kenneyMerge(prims, team);
      }
      const head = this._assembleB(this._kHead[team]);
      head.position.copy(this._kenneyNodeT(name, 'turret').applyMatrix4(fit.m));
      g.add(head);
      g.userData.head = head;
    } else if (cls === 'tur') {
      /* 可旋轉砲塔頭 */
      const head = this._assembleB(this._partGeo('turhead', team, () => [
        { g: this._box(15, 6.5, 9), c: 'hull' },
        { g: this._cylX(1.3, 17, 6), c: 'dark', x: 11, z: 2.6 },
        { g: this._cylX(1.3, 17, 6), c: 'dark', x: 11, z: -2.6 },
        { g: this._box(2, 2, 2.2), c: 'acc', x: 19, z: 2.6 },
        { g: this._box(2, 2, 2.2), c: 'acc', x: 19, z: -2.6 },
      ]));
      head.position.y = 10;
      g.add(head);
      g.userData.head = head;
    }
    return g;
  },

  /* 偵察衛星的動態零件：慢轉的碟形天線（userData.spin，world 的建築動畫會轉它）＋青色閃爍信標 */
  _satExtras(g, team) {
    const dish = this._assembleB(this._partGeo('satdish', team, () => [
      { g: this._cyl(8, 1.5, 2.6, 16), c: 'white', y: 0, x: 3, rz: 0.75 },
      { g: this._cyl(0.5, 0.5, 6, 5), c: 'hull', y: 2, x: 4.4, rz: 0.75 },
      { g: this._box(1.4, 1.4, 1.4), c: 'acc', y: 4.2, x: 6.6 },
    ]));
    dish.position.y = 22;
    g.add(dish);
    g.userData.spin = dish;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0x8ef5d8, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0.9,
    }));
    s.position.set(0, 30, 0);
    s.scale.set(11, 11, 1);
    g.add(s);
    g.userData.beacon = s;
  },

  makeGhost(cls) {
    const g = new THREE.Group();
    if (cls !== 'tur' && this._whCode(cls)) { g.add(new THREE.Mesh(this._whFitted(cls), this.ghostMats.ok)); return g; }
    const geos = this._getGeo('b', cls, 0);
    if (geos.solid) g.add(new THREE.Mesh(geos.solid, this.ghostMats.ok));
    if (geos.glow) g.add(new THREE.Mesh(geos.glow, this.ghostMats.ok));
    return g;
  },
  setGhostValid(g, ok) {
    const m = ok ? this.ghostMats.ok : this.ghostMats.bad;
    g.traverse(o => { if (o.isMesh) o.material = m; });
  },

  makeAsteroid(size) {
    if (!this.astMatS) {
      this.astMatS = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x6b635a).convertSRGBToLinear(), roughness: 0.95, metalness: 0.05, flatShading: true });
      /* 礦晶：不透明自發光青綠（疊加混色在亮色月岩上會變白看不見） */
      this.astMatC = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35e6c4).convertSRGBToLinear() });
    }
    if (this._useKenney()) return this._kenneyAsteroid(size);
    if (this.USE_ROCKS && typeof ROCK_ASSETS !== 'undefined') return this._rockAsteroid(size);
    const geo = new THREE.IcosahedronGeometry(size, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = U.rand(0.72, 1.32);
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * U.rand(0.6, 1.1) * k, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, this.astMatS));
    this._addCrystals(g, size);
    return g;
  },
  /* 礦晶：散在石頭表面的發光八面體，採空時整組隱藏 */
  _addCrystals(g, size) {
    const nC = U.randInt(3, 5);
    const crystals = new THREE.Group();
    /* 共用單位八面體、靠 scale 決定大小 → 全場礦晶由 Batch 合成一次畫完 */
    if (!this._crystalGeo) { this._crystalGeo = new THREE.OctahedronGeometry(1); this._crystalGeo.userData.shared = true; }
    for (let i = 0; i < nC; i++) {
      const cm = new THREE.Mesh(this._crystalGeo, this.astMatC);
      cm.scale.setScalar(size * U.rand(0.12, 0.22));
      const a = U.rand(U.TAU), b = U.rand(-0.5, 0.9);
      cm.position.set(Math.cos(a) * size * 0.85, Math.sin(b) * size * 0.6, Math.sin(a) * size * 0.85);
      cm.rotation.set(U.rand(3), U.rand(3), U.rand(3));
      crystals.add(cm);
      if (typeof Batch !== 'undefined') Batch.addMesh(cm);
    }
    g.add(crystals);
    g.userData.crystals = crystals;
  },

  /* ── Poly Haven 月岩（CC0；資料在 js/assets_rocks.js）──
     7 種真實掃描岩石輪流用。幾何共用（userData.shared，world 端 dispose 會跳過），
     材質每種一份；扁長的岩石會往短軸拉一點，比較像一顆「小行星」而不是一片石板 */
  USE_ROCKS: true,
  _rockAsteroid(size) {
    this._initRocks();
    const src = U.pick(this._rocks);
    const g = new THREE.Group();
    const rock = new THREE.Mesh(src.g, src.mat);
    rock.scale.setScalar(size);
    g.add(rock);
    if (typeof Batch !== 'undefined') Batch.addMesh(rock);   // 同種月岩合成一批（採空／殘骸換材質後自動分到別批）
    this._addCrystals(g, size);
    return g;
  },
  _initRocks() {
    if (!this._rocks) {
      const loader = new THREE.TextureLoader();
      this._rocks = Object.values(ROCK_ASSETS).map(a => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this._decode(a.pos, Float32Array), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(this._decode(a.nor, Float32Array), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(this._decode(a.uv, Float32Array), 2));
        g.setIndex(new THREE.BufferAttribute(this._decode(a.idx, a.idx32 ? Uint32Array : Uint16Array), 1));
        g.computeBoundingBox();
        const c = new THREE.Vector3(), sz = new THREE.Vector3();
        g.boundingBox.getCenter(c); g.boundingBox.getSize(sz);
        const mx = Math.max(sz.x, sz.y, sz.z);
        g.translate(-c.x, -c.y, -c.z);
        /* 正規化成最長邊 2.2（乘上 size 後跟舊版尺寸相當），短軸最多補拉 1.6 倍 */
        const k = 2.2 / mx, f = v => k * Math.min(1.6, Math.sqrt(mx / v));
        g.scale(f(sz.x), f(sz.y), f(sz.z));
        g.computeVertexNormals();
        g.userData.shared = true;
        const map = loader.load(a.diff), nmap = loader.load(a.nor_map);
        map.encoding = THREE.sRGBEncoding;
        map.flipY = nmap.flipY = false;               // glTF 的 UV 原點在左上
        const mat = new THREE.MeshStandardMaterial({
          map, normalMap: nmap, normalScale: new THREE.Vector2(2, 2),
          /* 太空場景光很暗：不壓色、加一點環境反光，掃描表面的凹凸才看得出來（10-05 實測 0x8c8780 全黑一塊） */
          color: new THREE.Color(0xc8c2ba).convertSRGBToLinear(), roughness: 0.88, metalness: 0.05,
          envMap: this.matSolid.envMap, envMapIntensity: 0.45,
        });
        return { g, mat };
      });
    }
  },

  /* Kenney 礦晶岩：岩石＝第 0 個子網格（殘骸換材質靠這個順序），礦晶另成一組（採空時隱藏）。
     每顆各自複製幾何——世界重開局／殘骸消失時會 dispose 小行星幾何，不能共用 */
  _kenneyAsteroid(size) {
    if (!this._kRock) {
      this._kRock = this.KENNEY_ROCKS.map(name => {
        const prims = this._kenneyPrims(name);
        const box = new THREE.Box3();
        for (const p of prims) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
        const c = new THREE.Vector3(), sz = new THREE.Vector3();
        box.getCenter(c); box.getSize(sz);
        const k = 2.2 / Math.max(sz.x, sz.y, sz.z);       // 正規化成直徑 2.2（再乘 size，跟舊版尺寸相當）
        const m = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
        for (const p of prims) p.geo.applyMatrix4(m);
        const cat = list => {
          if (!list.length) return null;
          let n = 0; for (const g of list) n += g.attributes.position.count;
          const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
          let o = 0;
          for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
          const out = new THREE.BufferGeometry();
          out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
          return out;
        };
        return {
          rock: cat(prims.filter(p => p.mat !== 'crystal').map(p => p.geo)),
          crystal: cat(prims.filter(p => p.mat === 'crystal').map(p => p.geo)),
        };
      });
    }
    const src = U.pick(this._kRock);
    const sx = size * U.rand(0.9, 1.15), sy = size * U.rand(0.75, 1.05);
    const g = new THREE.Group();
    const rock = new THREE.Mesh(src.rock.clone(), this.astMatS);
    rock.scale.set(sx, sy, sx);
    rock.rotation.y = U.rand(U.TAU);
    g.add(rock);
    const crystals = new THREE.Group();
    if (src.crystal) {
      const cm = new THREE.Mesh(src.crystal.clone(), this.astMatC);
      cm.scale.copy(rock.scale); cm.rotation.copy(rock.rotation);
      crystals.add(cm);
    }
    g.add(crystals);
    g.userData.crystals = crystals;
    return g;
  },

  /* ── 建築常駐陣營色光暈（10-07 試玩回饋：小建築在太空地圖上幾乎看不到）──
     底部貼地淡光環（共用平面幾何＋每陣營一個材質 → Batch 合成每陣營 1 個 draw call）
     ＋頂部一盞陣營色光點（Batch.addGlow，併進全場光點那一批）。
     亮度走 userData.instK（選取／滑過時由 Input 調亮）；鏡頭拉遠時由 Input.updBldGlow 放大。 */
  BLD_GLOW_SMALL: { tur: 1, lab: 1, ref: 1, outpost: 1 },
  _bldGlowInit() {
    if (this._bgGeo) return;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.10)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.16)');
    gr.addColorStop(0.78, 'rgba(255,255,255,1)');
    gr.addColorStop(0.86, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    this._bgTex = new THREE.CanvasTexture(c);
    this._bgGeo = new THREE.PlaneGeometry(2, 2);
    this._bgGeo.rotateX(-Math.PI / 2);
    this._bgGeo.userData.shared = true;
    this._bgMats = TEAMS.map(T => new THREE.MeshBasicMaterial({
      map: this._bgTex, color: T.hex, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.42, depthWrite: false, fog: false,
    }));
    this._bgDotMats = TEAMS.map(T => new THREE.SpriteMaterial({
      map: this.glowTex, color: T.hex, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0.95, fog: false,
    }));
    this._bgTop = {};
  },
  _addBldGlow(g, cls, team) {
    this._bldGlowInit();
    const ti = Math.max(0, Math.min(TEAMS.length - 1, team));
    const R = (typeof BLDS !== 'undefined' && BLDS[cls]) ? BLDS[cls].radius : 40;
    const small = !!this.BLD_GLOW_SMALL[cls];
    if (this._bgTop[cls] === undefined) {
      /* 模型頂端高度（只算網格，每種建築算一次） */
      const bb = new THREE.Box3(), tmp = new THREE.Box3();
      g.updateMatrixWorld(true);
      g.traverse(o => {
        if (!o.isMesh) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        bb.union(tmp);
      });
      this._bgTop[cls] = bb.isEmpty() ? 30 : bb.max.y;
    }
    const ring = new THREE.Mesh(this._bgGeo, this._bgMats[ti]);
    const rs = R * (small ? 1.75 : 1.3);
    ring.position.y = 1.5;
    ring.scale.set(rs, 1, rs);
    ring.renderOrder = 2;
    ring.userData.bldGlow = true;
    ring.userData.baseS = rs;
    ring.userData.instK = 1;
    g.add(ring);
    const dot = new THREE.Sprite(this._bgDotMats[ti]);
    const ds = cls === 'base' ? 34 : small ? 24 : 20;
    dot.position.y = this._bgTop[cls] + 8;
    dot.scale.set(ds, ds, 1);
    dot.userData.baseS = ds;
    g.add(dot);
    g.userData.glowRing = ring;
    g.userData.glowDot = dot;
    if (typeof Batch !== 'undefined') { Batch.addMesh(ring); Batch.addGlow(dot); }
  },

  /* ── 滑過／選取外框光（邊緣光殼）──
     沿法線把本體幾何往外推一點、只畫背面、越靠輪廓越亮 → 單位外面一圈陣營色光邊。
     殼是本體網格的子物件（共用幾何、不複製），數量少（滑過 1 個＋選取最多 12 個）不進 Batch；
     每個殼一個材質，移除時 dispose（著色器程式共用，不會累積）。 */
  makeOutlineMat(hex) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(hex).convertSRGBToLinear() },
        uAlpha: { value: 0.35 }, uThick: { value: 2 },
      },
      vertexShader: `
        uniform float uThick; varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 wn = normalize(mat3(modelMatrix) * normal);
          wp.xyz += wn * uThick;
          vN = wn; vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float a = uAlpha * (0.35 + 0.65 * rim);
          gl_FragColor = vec4(uColor * a * 2.2, a);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
      side: THREE.BackSide, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    });
  },

  makeSelRing(color) {
    const m = new THREE.Mesh(this.selRingGeo, new THREE.MeshBasicMaterial({
      color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
    }));
    return m;
  },
};
