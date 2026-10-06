'use strict';
/* ═══════════ 遊戲資料定義 ═══════════ */

const TEAMS = [
  { name: '曙光聯隊', hull: '#26384e', acc: '#41d9ff', eng: '#6fe3ff',
    bullet: '#aee9ff', trail: '150,220,255', shield: '#59c8ff' },
  { name: '赤紅兵團', hull: '#452a28', acc: '#ff5a3c', eng: '#ffa25e',
    bullet: '#ffc09a', trail: '255,150,105', shield: '#ff8a66' },
];

const PD = { t: 'pd', dmg: 4, cd: 0.11, range: 310, spd: 950 };

/* 艦種定義
   pow/tough/spd = 卡片上顯示的 0~10 評分
   group: 1快攻 2飛彈 3主力 4重艦（用於分隊）
   unlock: 從第幾關開始可購買 */
const SHIPS = {
  int: {
    name: '螢火式攔截機', role: '快速纏鬥・狼群戰術', cost: 80,
    hull: 85, shield: 25, regen: 5, speed: 175, turn: 3.6, radius: 9,
    unlock: 1, group: 1, small: true, pow: 2, tough: 1, spd: 10,
    weapons: [{ t: 'gun', dmg: 5, cd: 0.14, range: 360, spd: 820, spread: 0.07 }],
  },
  cor: {
    name: '蜂刺式護衛艦', role: '飛彈齊射・遠程壓制', cost: 220,
    hull: 260, shield: 95, regen: 8, speed: 92, turn: 1.6, radius: 14,
    unlock: 1, group: 2, pow: 4, tough: 3, spd: 5,
    weapons: [{ t: 'missile', dmg: 40, cd: 3.5, range: 900, spd: 430, turnR: 2.7, salvo: 3 }],
  },
  des: {
    name: '裂光式驅逐艦', role: '光束打擊・攔截飛彈與敵機', cost: 430,
    hull: 500, shield: 230, regen: 12, speed: 72, turn: 1.2, radius: 18,
    unlock: 2, group: 3, pow: 5, tough: 5, spd: 4,
    weapons: [{ t: 'beam', dps: 88, dur: 0.7, cd: 2.7, range: 640 }, PD],
  },
  cru: {
    name: '霜巨式巡洋艦', role: '重型電漿主炮・裝甲核心', cost: 820,
    hull: 1050, shield: 510, regen: 16, speed: 52, turn: 0.9, radius: 24,
    unlock: 3, group: 3, pow: 7, tough: 7, spd: 3,
    weapons: [
      { t: 'plasma', dmg: 95, cd: 2.3, range: 730, spd: 300 },
      { t: 'plasma', dmg: 95, cd: 2.3, range: 730, spd: 300, delay: 1.15 },
      PD,
    ],
  },
  car: {
    name: '蜂巢式航空母艦', role: '持續放出無人機蜂群', cost: 1150,
    hull: 1300, shield: 460, regen: 13, speed: 42, turn: 0.7, radius: 28,
    unlock: 4, group: 4, max: 2, pow: 6, tough: 8, spd: 2,
    hangar: { unit: 'drone', max: 6, cd: 3.6 },
    weapons: [PD, PD],
  },
  bat: {
    name: '不朽級戰列艦', role: '旗艦・毀滅級主炮群', cost: 2100,
    hull: 2600, shield: 1150, regen: 21, speed: 36, turn: 0.55, radius: 34,
    unlock: 5, group: 4, max: 1, pow: 10, tough: 10, spd: 1,
    weapons: [
      { t: 'beam', dps: 240, dur: 1.1, cd: 6.5, range: 840, heavy: true },
      { t: 'plasma', dmg: 110, cd: 2.6, range: 760, spd: 300, delay: 0.8 },
      { t: 'missile', dmg: 40, cd: 5, range: 900, spd: 430, turnR: 2.4, salvo: 3, delay: 2 },
      PD, PD,
    ],
  },
  drone: {
    name: '蜂群無人機', role: '航母艦載機', cost: 0,
    hull: 40, shield: 0, regen: 0, speed: 200, turn: 4.2, radius: 6,
    group: 1, small: true, noBuy: true, pow: 1, tough: 1, spd: 10,
    weapons: [{ t: 'gun', dmg: 3.5, cd: 0.17, range: 300, spd: 780, spread: 0.09 }],
  },
  sta: {
    name: '堡壘防衛站', role: '固定式重型火力平台', cost: 0,
    hull: 3400, shield: 1150, regen: 26, speed: 0, turn: 0, radius: 44,
    group: 4, noBuy: true, stationary: true, pow: 8, tough: 10, spd: 0,
    weapons: [
      { t: 'plasma', dmg: 110, cd: 2.0, range: 880, spd: 320 },
      { t: 'missile', dmg: 40, cd: 4.5, range: 950, spd: 430, turnR: 2.4, salvo: 3, delay: 1.5 },
      PD, PD, PD,
    ],
  },
  boss: {
    name: '隕星號', role: '敵方超級旗艦', cost: 0,
    hull: 7000, shield: 2100, regen: 32, speed: 26, turn: 0.4, radius: 52,
    group: 4, noBuy: true, isBoss: true, pow: 10, tough: 10, spd: 1,
    hangar: { unit: 'drone', max: 4, cd: 5 },
    weapons: [
      { t: 'doom', dps: 400, range: 1050, cd: 12, charge: 1.7, dur: 2.3 },
      { t: 'missile', dmg: 38, cd: 6, range: 950, spd: 420, turnR: 2.2, salvo: 8, delay: 3 },
      { t: 'plasma', dmg: 120, cd: 2.2, range: 800, spd: 310 },
      { t: 'plasma', dmg: 120, cd: 2.2, range: 800, spd: 310, delay: 1.1 },
      PD, PD, PD,
    ],
  },
};

/* 戰役任務 */
const MISSIONS = [
  { id: 1, name: '哨戒接觸', reward: 420, budget: 300, expected: 550,
    weights: { int: 6, cor: 1 }, waves: 1,
    brief: '邊境哨站偵測到不明艦隊訊號。率領你的第一支艦隊前往查證，殲滅所有來犯者。' },
  { id: 2, name: '邊境衝突', reward: 650, budget: 680, expected: 950,
    weights: { int: 5, cor: 2 }, waves: 1,
    brief: '赤紅兵團正式越境。他們的攔截機蜂群數量驚人——部署具備攔截火力的驅逐艦是明智之選。' },
  { id: 3, name: '護航截擊', reward: 950, budget: 1150, expected: 1550,
    weights: { int: 3, cor: 2, des: 2, cru: 1 }, waves: 1,
    brief: '敵方巡洋艦隊正在集結。電漿主炮能一擊重創輕型艦艇——保持機動、集中火力逐一擊破。' },
  { id: 4, name: '深空伏擊', reward: 1300, budget: 1650, expected: 2250,
    weights: { int: 3, cor: 3, des: 2, cru: 1 }, waves: 2,
    brief: '情報顯示這是一個陷阱——敵人將分批躍遷抵達。留意躍遷警報，保存實力應對第二波攻勢。' },
  { id: 5, name: '星雲交鋒', reward: 1700, budget: 2250, expected: 3050,
    weights: { int: 4, cor: 2, des: 3, cru: 2 }, waves: 1, mod: 'nebula',
    brief: '紫晶星雲干擾所有感測器，雙方偵測距離大幅縮短。這將是一場短兵相接的近距離混戰。' },
  { id: 6, name: '破曉行動', reward: 2200, budget: 2850, expected: 3900,
    weights: { int: 2, cor: 3, des: 2, cru: 2, car: 2 }, waves: 2,
    brief: '敵方航母戰鬥群現身，無人機會源源不絕地湧出。直搗母艦本體，才是止血之道。' },
  { id: 7, name: '鐵幕防線', reward: 2800, budget: 3450, expected: 4700,
    weights: { int: 4, cor: 3, des: 3, cru: 2, car: 1 }, waves: 3, station: true,
    brief: '堡壘防衛站是這片星域最後的屏障。敵人將發動三波總攻——防衛站絕對不能陷落。' },
  { id: 8, name: '隕星之心', reward: 4200, budget: 3300, expected: 5300,
    weights: { int: 3, cor: 3, des: 3, cru: 2, car: 1 }, waves: 2, boss: true,
    brief: '敵方超級旗艦「隕星號」現身。它的主炮足以蒸發一切…在它完成充能之前擊沉它。這是最終決戰。' },
];

const FORMATIONS = [
  { id: 'wedge', name: '楔形突擊', desc: '重艦居中前壓、兩翼向後展開，正面突破用' },
  { id: 'line',  name: '戰列橫隊', desc: '所有火力攤開成正面一線，齊射壓制用' },
  { id: 'orb',   name: '球形護衛', desc: '輕艦環繞重艦佈防，保護核心艦用' },
];

const ABILITIES = [
  { id: 'strike', key: 'Q', icon: '☄', name: '軌道打擊', cd: 26,
    desc: '標記座標，衛星光束轟炸該區域' },
  { id: 'surge', key: 'W', icon: '🛡', name: '護盾湧流', cd: 32,
    desc: '全艦隊護盾立即回復 60%，並短暫強化再生' },
  { id: 'warp', key: 'E', icon: '✦', name: '躍遷增援', cd: 45,
    desc: '呼叫 3 架攔截機躍遷支援（戰後解編）' },
];

/* 依預算與權重隨機生成一支艦隊（回傳艦種代號陣列） */
function genFleetList(budget, weights) {
  const list = [];
  let b = budget, guard = 0;
  const counts = {};
  while (b >= 80 && guard++ < 300) {
    const aff = Object.entries(weights).filter(([c]) => {
      const d = SHIPS[c];
      if (!d || d.cost > b) return false;
      if (d.max && (counts[c] || 0) >= d.max) return false;
      return true;
    });
    if (!aff.length) break;
    const tot = aff.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * tot, cls = aff[aff.length - 1][0];
    for (const [c, w] of aff) { r -= w; if (r <= 0) { cls = c; break; } }
    list.push(cls);
    counts[cls] = (counts[cls] || 0) + 1;
    b -= SHIPS[cls].cost;
  }
  return list;
}

/* 將艦隊清單切成 n 波（第一波最大） */
function splitWaves(list, n) {
  if (n <= 1) return [list];
  const sorted = list.slice().sort(() => Math.random() - 0.5);
  const first = Math.max(1, Math.round(sorted.length * 0.5));
  const waves = [sorted.slice(0, first)];
  const rest = sorted.slice(first);
  const per = Math.max(1, Math.ceil(rest.length / (n - 1)));
  for (let i = 0; i < n - 1; i++) {
    const w = rest.slice(i * per, (i + 1) * per);
    if (w.length) waves.push(w);
  }
  return waves;
}
