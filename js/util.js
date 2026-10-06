'use strict';
/* 通用工具 */
const U = {
  TAU: Math.PI * 2,
  rand(a = 1, b) { return b === undefined ? Math.random() * a : a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(U.rand(a, b + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  distXZ(a, b) { const dx = b.x - a.x, dz = b.z - a.z; return Math.sqrt(dx * dx + dz * dz); },
  dist2XZ(a, b) { const dx = b.x - a.x, dz = b.z - a.z; return dx * dx + dz * dz; },
  yawTo(a, b) { return Math.atan2(b.z - a.z, b.x - a.x); },
  angDiff(a, b) {
    let d = (b - a) % U.TAU;
    if (d > Math.PI) d -= U.TAU;
    if (d < -Math.PI) d += U.TAU;
    return d;
  },
  turnToward(cur, want, maxStep) {
    const d = U.angDiff(cur, want);
    if (Math.abs(d) <= maxStep) return want;
    return cur + Math.sign(d) * maxStep;
  },
  fmt(n) { return Math.round(n).toLocaleString('en-US'); },
  el(id) { return document.getElementById(id); },
  mmss(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + String(s).padStart(2, '0');
  },
};
