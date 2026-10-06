'use strict';
/* ═══════════ 合批繪圖（效能） ═══════════
   問題：每艘船的船殼、引擎光點、噴焰、護盾罩各自一個 draw call，500 艘就兩千多個，
        瀏覽器光是「叫顯示卡畫」的次數就吃掉一幀的時間。
   做法：原本的物件全部保留（位置、點選、遊戲邏輯照舊），只把它們移到 camera 不畫的 layer 1，
        每幀開畫前（scene.onBeforeRender）把同類物件的位置收集起來，
        網格 → InstancedMesh（同幾何＋同材質一組），光點 Sprite → 一個 Points。
   物件的 visible 仍代表「要不要顯示」；離開場景（被 remove）的物件自動從清單剔除。 */

const Batch = {
  LAYER: 1,
  enabled: true,
  /* LOD：船殼離鏡頭超過這個距離就改用簡版模型（mesh.userData.lod）；0＝關閉 */
  LOD_DIST: 1800,
  stats: { lodFar: 0, lodNear: 0 },
  meshes: new Set(), glows: new Set(),
  buckets: new Map(),            // geometry.uuid|material.uuid → { im, cap, list }
  scene: null,

  init(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    /* 光點：自訂 Points 著色器，每點自帶大小與顏色（Sprite 的世界尺寸 → 螢幕像素） */
    this.gCap = 2048;
    this.gGeo = new THREE.BufferGeometry();
    this.gGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.gCap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.gGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(this.gCap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.gGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(this.gCap), 1).setUsage(THREE.DynamicDrawUsage));
    this.gMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: Models.glowTex }, uScale: { value: 300 } },
      vertexShader: `
        attribute float aSize; attribute vec3 aColor; varying vec3 vC; uniform float uScale;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vC;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vC * t.rgb, t.a);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.gPoints = new THREE.Points(this.gGeo, this.gMat);
    this.gPoints.frustumCulled = false;
    this.gPoints.renderOrder = 10;
    scene.add(this.gPoints);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    this._v = new THREE.Vector3();
    scene.onBeforeRender = (r, s, cam) => { if (this.enabled) this.sync(cam); };
  },

  /* 註冊：網格（同幾何＋同材質的會被合成一批）／光點 Sprite */
  addMesh(m) { if (!this.scene) return; m.layers.set(this.LAYER); this.meshes.add(m); },
  addGlow(s) { if (!this.scene) return; s.layers.set(this.LAYER); this.glows.add(s); },

  /* 物件與所有祖先都 visible、且確實掛在場景上，才算要畫；不在場景上＝已被移除，剔除 */
  _live(o, set) {
    let p = o, shown = true;
    while (p) {
      if (!p.visible) shown = false;
      if (p === this.scene) return shown;
      p = p.parent;
    }
    set.delete(o);
    return false;
  },

  _bucket(geo, mat) {
    const key = geo.uuid + '|' + mat.uuid;
    let b = this.buckets.get(key);
    if (!b) { b = { geo, mat, cap: 0, im: null, n: 0 }; this.buckets.set(key, b); }
    return b;
  },
  _grow(b, need) {
    let cap = Math.max(32, b.cap);
    while (cap < need) cap *= 2;
    if (b.im) { this.scene.remove(b.im); b.im.dispose(); }
    b.im = new THREE.InstancedMesh(b.geo, b.mat, cap);
    b.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    b.im.setColorAt(0, this._c.setRGB(1, 1, 1));
    b.im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    b.im.frustumCulled = false;
    this.scene.add(b.im);
    b.cap = cap;
  },

  sync(cam) {
    /* 不用再 updateMatrixWorld：renderer.render 在呼叫 onBeforeRender 之前已更新過整個場景 */
    /* ── 網格 → InstancedMesh ── */
    for (const b of this.buckets.values()) b.n = 0;
    const live = [];
    for (const m of this.meshes) if (this._live(m, this.meshes)) live.push(m);
    /* 每個網格這一幀用哪組（幾何,材質）：遠的船殼換 LOD 簡版 */
    const cp = cam.position, L2 = this.LOD_DIST * this.LOD_DIST;
    let far = 0;
    for (const m of live) {
      const lod = m.userData.lod;
      if (lod && this.LOD_DIST > 0) {
        const e = m.matrixWorld.elements, dx = e[12] - cp.x, dy = e[13] - cp.y, dz = e[14] - cp.z;
        m._b = (dx * dx + dy * dy + dz * dz > L2) ? (far++, this._bucket(lod.geo, lod.mat)) : this._bucket(m.geometry, m.material);
      } else m._b = this._bucket(m.geometry, m.material);
      m._b.n++;
    }
    this.stats.lodFar = far; this.stats.lodNear = live.length - far;
    for (const b of this.buckets.values()) { if (b.n > b.cap) this._grow(b, b.n); b.i = 0; }
    for (const m of live) {
      const b = m._b;
      b.im.setMatrixAt(b.i, m.matrixWorld);
      /* 每實例亮度：instK（護盾罩淡出用）或受擊閃白 */
      const ud = m.userData;
      let k = ud.instK !== undefined ? ud.instK : 1;
      const ent = m.parent && m.parent.userData.ent;
      if (ent && ent._flash && ud.hull) k = 2.6;
      b.im.setColorAt(b.i, this._c.setRGB(k, k, k));
      b.i++;
    }
    /* 閒置太久的批次（例如採空小行星淡出後留下的專屬材質）整批釋放，避免長局越積越多 */
    for (const [key, b] of this.buckets) {
      b.idle = b.n ? 0 : (b.idle || 0) + 1;
      if (b.idle > 900) { if (b.im) { this.scene.remove(b.im); b.im.dispose(); } this.buckets.delete(key); }
    }
    for (const b of this.buckets.values()) {
      if (!b.im) continue;
      b.im.count = b.n;
      b.im.visible = b.n > 0;
      b.im.instanceMatrix.needsUpdate = true;
      b.im.instanceColor.needsUpdate = true;
    }
    /* ── 光點 Sprite → Points ── */
    const pos = this.gGeo.attributes.position.array, col = this.gGeo.attributes.aColor.array, sz = this.gGeo.attributes.aSize.array;
    let n = 0;
    for (const s of this.glows) {
      if (!this._live(s, this.glows)) continue;
      if (n >= this.gCap) break;
      const op = s.material.opacity;
      if (op <= 0.001) continue;
      this._v.setFromMatrixPosition(s.matrixWorld);
      pos[n * 3] = this._v.x; pos[n * 3 + 1] = this._v.y; pos[n * 3 + 2] = this._v.z;
      const c = s.material.color;
      col[n * 3] = c.r * op; col[n * 3 + 1] = c.g * op; col[n * 3 + 2] = c.b * op;
      /* 世界縮放（含父層，例如縮小中的殘骸）取 X 軸長度 */
      sz[n] = this._v.setFromMatrixScale(s.matrixWorld).x;
      n++;
    }
    this.gGeo.setDrawRange(0, n);
    this.gGeo.attributes.position.needsUpdate = true;
    this.gGeo.attributes.aColor.needsUpdate = true;
    this.gGeo.attributes.aSize.needsUpdate = true;
    /* Sprite 的世界尺寸是整張貼圖的寬 → 像素直徑 = 尺寸 × 畫面高/2 × 投影 [1][1] / 深度 */
    const h = this.renderer.getDrawingBufferSize(this._v2 || (this._v2 = new THREE.Vector2())).y;
    this.gMat.uniforms.uScale.value = h * 0.5 * cam.projectionMatrix.elements[5];
  },
};
