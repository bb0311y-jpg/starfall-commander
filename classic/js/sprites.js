'use strict';
/* ═══════════ 艦船外觀：程式向量繪製 + 預先烘焙發光 ═══════════ */

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(U.lerp(r, t, p));
  g = Math.round(U.lerp(g, t, p));
  b = Math.round(U.lerp(b, t, p));
  return `rgb(${r},${g},${b})`;
}

/* 座標為單位半徑（+x 朝艦首）。f: hull船體 dark暗部 acc發光飾板 glass艙罩 line發光線 */
const SHAPES = {
  int: [
    { p: [[1.25, 0], [-0.55, 0.62], [-0.3, 0], [-0.55, -0.62]], f: 'hull' },
    { p: [[0.3, 0.12], [-0.45, 0.9], [-0.28, 0.28]], f: 'acc', mirror: true },
    { p: [[0.85, 0], [0.28, 0.15], [0.28, -0.15]], f: 'glass' },
  ],
  drone: [
    { p: [[1.05, 0], [-0.7, 0.72], [-0.35, 0], [-0.7, -0.72]], f: 'hull' },
    { p: [[0.45, 0], [-0.25, 0.3], [-0.25, -0.3]], f: 'acc' },
  ],
  cor: [
    { p: [[1.3, 0], [0.6, 0.3], [-0.85, 0.4], [-1.08, 0.18], [-1.08, -0.18], [-0.85, -0.4], [0.6, -0.3]], f: 'hull' },
    { p: [[0.25, 0.64], [-0.55, 0.64], [-0.62, 0.32], [0.18, 0.32]], f: 'dark', mirror: true },
    { p: [[0.18, 0.48], [-0.5, 0.48]], f: 'line', open: true, mirror: true },
    { p: [[1.0, 0], [0.55, 0.13], [0.55, -0.13]], f: 'glass' },
  ],
  des: [
    { p: [[1.42, 0], [0.85, 0.2], [-0.6, 0.3], [-1.05, 0.55], [-1.18, 0.2], [-1.18, -0.2], [-1.05, -0.55], [-0.6, -0.3], [0.85, -0.2]], f: 'hull' },
    { p: [[0.5, 0.3], [-0.5, 0.42], [-0.5, 0.24], [0.45, 0.16]], f: 'dark', mirror: true },
    { p: [[1.3, 0.05], [0.2, 0.12]], f: 'line', open: true, mirror: true },
    { p: [[-0.15, 0], [-0.75, 0.14], [-0.75, -0.14]], f: 'acc' },
    { p: [[0.9, 0], [0.5, 0.11], [0.5, -0.11]], f: 'glass' },
  ],
  cru: [
    { p: [[1.15, 0], [0.6, 0.5], [-0.55, 0.66], [-1.05, 0.34], [-1.05, -0.34], [-0.55, -0.66], [0.6, -0.5]], f: 'hull' },
    { p: [[0.55, 0.42], [-0.5, 0.56], [-0.85, 0.3], [-0.2, 0.28]], f: 'dark', mirror: true },
    { p: [[1.0, 0.06], [0.4, 0.3]], f: 'line', open: true, mirror: true },
    { p: [[0.35, 0], [0.05, 0.22], [-0.3, 0], [0.05, -0.22]], f: 'acc' },
    { p: [[-0.45, 0.14], [-0.75, 0.24], [-0.75, 0.04]], f: 'acc', mirror: true },
  ],
  car: [
    { p: [[1.0, 0.22], [1.12, 0], [1.0, -0.22], [-1.02, -0.46], [-1.12, 0], [-1.02, 0.46]], f: 'hull' },
    { p: [[0.6, 0.44], [-0.8, 0.56], [-0.8, 0.24], [0.6, 0.2]], f: 'dark', mirror: true },
    { p: [[0.55, 0.33], [-0.72, 0.42]], f: 'line', open: true, mirror: true },
    { p: [[0.9, 0], [0.55, 0.12], [0.55, -0.12]], f: 'glass' },
    { p: [[-0.2, 0.1], [-0.6, 0.1], [-0.6, -0.1], [-0.2, -0.1]], f: 'acc' },
  ],
  bat: [
    { p: [[1.5, 0], [1.0, 0.16], [0.4, 0.3], [-0.45, 0.42], [-1.0, 0.66], [-1.25, 0.26], [-1.25, -0.26], [-1.0, -0.66], [-0.45, -0.42], [0.4, -0.3], [1.0, -0.16]], f: 'hull' },
    { p: [[0.9, 0.16], [-0.4, 0.35], [-0.9, 0.55], [-0.6, 0.26], [0.4, 0.18]], f: 'dark', mirror: true },
    { p: [[1.35, 0], [0.1, 0.09], [-0.9, 0.09], [-0.9, -0.09], [0.1, -0.09]], f: 'acc' },
    { p: [[0.55, 0.2], [-0.55, 0.32]], f: 'line', open: true, mirror: true },
    { p: [[0.75, 0], [0.45, 0.1], [0.45, -0.1]], f: 'glass' },
  ],
  boss: [
    { p: [[1.6, 0], [1.05, 0.36], [0.45, 0.26], [0.22, 0.62], [-0.55, 0.78], [-1.15, 0.52], [-1.38, 0], [-1.15, -0.52], [-0.55, -0.78], [0.22, -0.62], [0.45, -0.26], [1.05, -0.36]], f: 'hull' },
    { p: [[1.0, 0.32], [0.2, 0.55], [-0.5, 0.68], [-0.4, 0.3], [0.4, 0.22]], f: 'dark', mirror: true },
    { p: [[1.45, 0], [0.3, 0.12], [-1.0, 0.12], [-1.0, -0.12], [0.3, -0.12]], f: 'acc' },
    { p: [[0.2, 0.5], [-0.45, 0.62]], f: 'line', open: true, mirror: true },
    { p: [[1.2, 0.12], [0.6, 0.3]], f: 'line', open: true, mirror: true },
  ],
};

const Sprites = {
  cache: {}, SS: 3,

  build() {
    for (const cls of Object.keys(SHIPS)) {
      for (let team = 0; team < 2; team++) this._make(cls, team);
    }
  },

  _make(cls, team) {
    const def = SHIPS[cls], S = def.radius * this.SS;
    const pad = 26, half = Math.ceil(S * 1.75) + pad;
    const c = document.createElement('canvas');
    c.width = c.height = half * 2;
    const g = c.getContext('2d');
    g.translate(half, half);
    g.lineJoin = 'round';
    if (cls === 'sta') this._station(g, team, S);
    else this._shapes(g, cls, team, S);
    this.cache[cls + team] = { c, w: c.width / this.SS };
  },

  _shapes(g, cls, team, S) {
    const T = TEAMS[team];
    for (const sh of SHAPES[cls]) {
      const flips = sh.mirror ? [1, -1] : [1];
      for (const fl of flips) {
        g.beginPath();
        sh.p.forEach(([x, y], i) => {
          const px = x * S, py = y * S * fl;
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        });
        if (!sh.open) g.closePath();
        this._paint(g, sh.f, T, S);
      }
    }
  },

  _paint(g, f, T, S) {
    switch (f) {
      case 'hull':
        g.fillStyle = T.hull; g.fill();
        g.strokeStyle = shade(T.hull, 0.38); g.lineWidth = Math.max(1, S * 0.045); g.stroke();
        break;
      case 'dark':
        g.fillStyle = shade(T.hull, -0.4); g.fill();
        break;
      case 'acc':
        g.shadowColor = T.acc; g.shadowBlur = S * 0.5;
        g.fillStyle = T.acc; g.globalAlpha = 0.92; g.fill();
        g.globalAlpha = 1; g.shadowBlur = 0;
        break;
      case 'glass':
        g.shadowColor = '#ffffff'; g.shadowBlur = S * 0.4;
        g.fillStyle = 'rgba(225,246,255,0.95)'; g.fill();
        g.shadowBlur = 0;
        break;
      case 'line':
        g.shadowColor = T.acc; g.shadowBlur = S * 0.45;
        g.strokeStyle = T.acc; g.lineWidth = Math.max(1, S * 0.07); g.stroke();
        g.shadowBlur = 0;
        break;
    }
  },

  /* 環形防衛站（致敬經典環形太空站造型） */
  _station(g, team, S) {
    const T = TEAMS[team];
    g.strokeStyle = shade(T.hull, 0.25); g.lineWidth = S * 0.2;
    g.beginPath(); g.arc(0, 0, S * 1.15, 0, U.TAU); g.stroke();
    g.shadowColor = T.acc; g.shadowBlur = S * 0.5;
    g.strokeStyle = T.acc; g.lineWidth = S * 0.24; g.lineCap = 'butt';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * U.TAU + 0.14;
      g.beginPath(); g.arc(0, 0, S * 1.15, a, a + 0.72); g.stroke();
    }
    g.shadowBlur = 0;
    g.strokeStyle = shade(T.hull, 0.1); g.lineWidth = S * 0.1;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      g.beginPath();
      g.moveTo(Math.cos(a) * S * 1.1, Math.sin(a) * S * 1.1);
      g.lineTo(-Math.cos(a) * S * 1.1, -Math.sin(a) * S * 1.1);
      g.stroke();
    }
    g.fillStyle = T.hull;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * U.TAU;
      const px = Math.cos(a) * S * 0.52, py = Math.sin(a) * S * 0.52;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill();
    g.strokeStyle = shade(T.hull, 0.35); g.lineWidth = Math.max(1, S * 0.05); g.stroke();
    g.shadowColor = T.acc; g.shadowBlur = S * 0.5;
    g.fillStyle = T.acc;
    g.beginPath(); g.arc(0, 0, S * 0.2, 0, U.TAU); g.fill();
    g.fillRect(S * 0.1, -S * 0.06, S * 0.55, S * 0.12);
    g.shadowBlur = 0;
  },

  get(cls, team) { return this.cache[cls + team]; },

  /* 給 UI 卡片畫縮圖 */
  icon(cls, team, canvasEl) {
    const spr = this.get(cls, team);
    if (!spr) return;
    const g = canvasEl.getContext('2d');
    const w = canvasEl.width, h = canvasEl.height;
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(-Math.PI / 2);
    const fit = (Math.min(w, h) * 0.92) / spr.c.width;
    const desired = Math.min(fit * 2.2, Math.min(w, h) * 0.92 / (SHIPS[cls].radius * 2 * this.SS) );
    const sc = Math.max(fit, Math.min(desired, fit * 3));
    g.scale(sc, sc);
    g.drawImage(spr.c, -spr.c.width / 2, -spr.c.height / 2);
    g.restore();
  },
};
