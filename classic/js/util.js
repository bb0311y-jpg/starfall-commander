'use strict';
/* 通用小工具 */
const U = {
  TAU: Math.PI * 2,
  rand(a = 1, b) { return b === undefined ? Math.random() * a : a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(U.rand(a, b + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  dist2(ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
  dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },
  angTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },
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
};
