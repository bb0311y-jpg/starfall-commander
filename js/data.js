'use strict';
/* ═══════════ 遊戲資料 ═══════════ */

const TEAMS = [
  { name: '曙光聯隊', hex: 0x41d9ff, hull: 0x2a3c52, dark: 0x1a2534, css: '#41d9ff',
    trailCss: '150,220,255', bulletCss: '#aee9ff' },
  { name: '赤紅兵團', hex: 0xff5a3c, hull: 0x4a2d28, dark: 0x2e1b18, css: '#ff5a3c',
    trailCss: '255,150,105', bulletCss: '#ffc09a' },
  /* 第三勢力（只在「三方混戰」模式出場） */
  { name: '翠環同盟', hex: 0x6ee86e, hull: 0x2c4a30, dark: 0x1a2e1d, css: '#6ee86e',
    trailCss: '150,240,150', bulletCss: '#c4ffc0' },
  /* 第四方：星盜（事件用中立海盜，永遠敵對所有人；不參與 teamsN／勢力選單） */
  { name: '星盜', hex: 0xff8c3a, hull: 0x4a3222, dark: 0x2e1f15, css: '#ff8c3a',
    trailCss: '255,170,110', bulletCss: '#ffc999' },
];

const W_PD = { t: 'pd', dmg: 4, cd: 0.11, range: 300, spd: 950 };

/* 艦船（cost=星礦、bt=建造秒數） */
const SHIPS = {
  harv: {
    name: '工蜂式採礦船', tip: '自動採集小行星礦石並運回精煉站',
    cost: 250, bt: 10, hull: 240, shield: 90, regen: 6, speed: 100, turn: 2.0,
    radius: 14, vision: 400, eco: true, cargo: 200, mineRate: 42, max: 80, hotkey: 'H',
  },
  int: {
    name: '螢火式攔截機', tip: '快速纏鬥機，剋制採礦船與轟炸重艦',
    cost: 120, bt: 6, hull: 90, shield: 25, regen: 5, speed: 195, turn: 3.6,
    radius: 8, vision: 600, small: true, hotkey: 'A',
    weapons: [{ t: 'gun', dmg: 5, cd: 0.14, range: 330, spd: 850, spread: 0.07 }],
  },
  cor: {
    name: '蜂刺式護衛艦', tip: '遠程飛彈齊射，被攔截火炮剋制',
    cost: 300, bt: 10, hull: 280, shield: 100, regen: 8, speed: 95, turn: 1.7,
    radius: 14, vision: 650, hotkey: 'S',
    weapons: [{ t: 'missile', dmg: 40, cd: 3.5, range: 820, spd: 420, turnR: 2.7, salvo: 3 }],
  },
  des: {
    name: '裂光式驅逐艦', tip: '光束打擊 + 攔截敵方飛彈與戰機',
    cost: 600, bt: 16, hull: 520, shield: 240, regen: 12, speed: 74, turn: 1.25,
    radius: 18, vision: 650, hotkey: 'D',
    weapons: [{ t: 'beam', dps: 90, dur: 0.7, cd: 2.7, range: 600 }, W_PD],
  },
  cru: {
    name: '霜巨式巡洋艦', tip: '雙聯電漿重炮，需要研究站',
    cost: 1000, bt: 24, hull: 1100, shield: 520, regen: 16, speed: 54, turn: 0.95,
    radius: 24, vision: 600, needLab: true, hotkey: 'C',
    weapons: [
      { t: 'plasma', dmg: 95, cd: 2.3, range: 700, spd: 310 },
      { t: 'plasma', dmg: 95, cd: 2.3, range: 700, spd: 310, delay: 1.15 },
      W_PD,
    ],
  },
  car: {
    name: '蜂巢式航空母艦', tip: '持續放出無人機，需研究「主力艦授權」',
    cost: 1500, bt: 32, hull: 1350, shield: 480, regen: 13, speed: 44, turn: 0.75,
    radius: 28, vision: 650, needCap: true, hotkey: 'V',
    hangar: { unit: 'drone', max: 6, cd: 3.6 },
    weapons: [W_PD, W_PD],
  },
  bat: {
    name: '不朽級戰列艦', tip: '毀滅級主炮群旗艦（限 1 艘），需「主力艦授權」',
    cost: 2400, bt: 45, hull: 2700, shield: 1200, regen: 21, speed: 38, turn: 0.6,
    radius: 34, vision: 650, needCap: true, limit: 1, hotkey: 'B',
    weapons: [
      { t: 'beam', dps: 240, dur: 1.1, cd: 6.5, range: 800, heavy: true },
      { t: 'plasma', dmg: 110, cd: 2.6, range: 730, spd: 310, delay: 0.8 },
      { t: 'missile', dmg: 40, cd: 5, range: 850, spd: 420, turnR: 2.4, salvo: 3, delay: 2 },
      W_PD, W_PD,
    ],
  },
  bomb: {
    name: '鷹爪式轟炸機', tip: '戰機：慢速重型魚雷專打大型艦，但魚雷會被攔截火炮擊落',
    cost: 220, bt: 9, hull: 160, shield: 40, regen: 5, speed: 150, turn: 2.8,
    radius: 10, vision: 550, small: true,
    weapons: [{ t: 'missile', dmg: 130, cd: 6, range: 700, spd: 300, turnR: 1.7, salvo: 1 }],
  },
  arty: {
    name: '天穹式炮擊艦', tip: '超長射程電漿重炮（1250），航速慢、怕近身，需「主力艦授權」',
    cost: 1300, bt: 30, hull: 900, shield: 400, regen: 12, speed: 40, turn: 0.7,
    radius: 26, vision: 700, needCap: true,
    weapons: [{ t: 'plasma', dmg: 190, cd: 4.6, range: 1250, spd: 520 }, W_PD],
  },
  dread: {
    name: '無畏級主力艦', tip: '最高階旗艦：雙重光束＋電漿炮群＋飛彈群（限 2 艘），需「無畏艦授權」',
    cost: 4200, bt: 70, hull: 6200, shield: 2600, regen: 30, speed: 30, turn: 0.4,
    radius: 48, vision: 700, needCap2: true, limit: 2,
    weapons: [
      { t: 'beam', dps: 260, dur: 1.2, cd: 6, range: 850, heavy: true },
      { t: 'beam', dps: 260, dur: 1.2, cd: 6, range: 850, heavy: true, delay: 3 },
      { t: 'plasma', dmg: 120, cd: 2.4, range: 760, spd: 320, delay: 0.6 },
      { t: 'plasma', dmg: 120, cd: 2.4, range: 760, spd: 320, delay: 1.8 },
      { t: 'missile', dmg: 40, cd: 4.5, range: 900, spd: 420, turnR: 2.4, salvo: 4, delay: 1.2 },
      W_PD, W_PD, W_PD, W_PD,
    ],
  },
  /* ── 星盜艦種（事件專用：npc＝不可建造、不進 AI 造艦表、noBuild＝不計戰機 CAPS；
        salvageMul＝擊毀時殘骸掉落倍率，由事件邏輯讀取）。外型＝Polyy Pack 2 紅色船（js/assets_pirates.js） ── */
  pir_int: {
    name: '劫掠機', tip: '星盜纏鬥機：比攔截機略強',
    cost: 140, bt: 0, hull: 110, shield: 30, regen: 5, speed: 200, turn: 3.6,
    radius: 8, vision: 550, small: true, npc: true, noBuild: true, salvageMul: 1.5,
    weapons: [{ t: 'gun', dmg: 6, cd: 0.14, range: 330, spd: 850, spread: 0.07 }],
  },
  pir_raid: {
    name: '突襲機', tip: '星盜快艇：極速打帶跑，船體薄',
    cost: 110, bt: 0, hull: 75, shield: 20, regen: 4, speed: 240, turn: 4.0,
    radius: 8, vision: 550, small: true, npc: true, noBuild: true, salvageMul: 1.5,
    weapons: [{ t: 'gun', dmg: 4.5, cd: 0.12, range: 300, spd: 880, spread: 0.08 }],
  },
  pir_gun: {
    name: '星盜砲艇', tip: '護衛級機砲艇：近中距離持續火力',
    cost: 320, bt: 0, hull: 320, shield: 110, regen: 8, speed: 100, turn: 1.8,
    radius: 14, vision: 550, npc: true, noBuild: true, salvageMul: 1.5,
    weapons: [
      { t: 'gun', dmg: 9, cd: 0.18, range: 430, spd: 900, spread: 0.05 },
      { t: 'gun', dmg: 9, cd: 0.18, range: 430, spd: 900, spread: 0.05, delay: 0.09 },
    ],
  },
  pir_pat: {
    name: '星盜巡邏艦', tip: '護衛級飛彈艦：遠程飛彈齊射',
    cost: 340, bt: 0, hull: 300, shield: 120, regen: 8, speed: 92, turn: 1.7,
    radius: 14, vision: 600, npc: true, noBuild: true, salvageMul: 1.5,
    weapons: [{ t: 'missile', dmg: 38, cd: 3.4, range: 800, spd: 420, turnR: 2.7, salvo: 3 }],
  },
  drone: {
    name: '蜂群無人機', tip: '航母艦載機',
    cost: 0, bt: 0, hull: 42, shield: 0, regen: 0, speed: 205, turn: 4.2,
    radius: 6, vision: 450, small: true, noBuild: true,
    weapons: [{ t: 'gun', dmg: 3.5, cd: 0.17, range: 290, spd: 800, spread: 0.09 }],
  },
};

/* 建築 */
const BLDS = {
  base: {
    name: '母艦「曙光號」', tip: '你的指揮中樞——被摧毀即戰敗。可生產採礦船',
    cost: 0, bt: 0, hull: 6500, shield: 2200, regen: 26, radius: 95, vision: 1100,
    dropoff: true, builds: ['harv'], income: 2,
    /* 絕境火力：一門電漿主砲（略弱於哨衛砲塔），偷家與決戰都有還手戲 */
    weapons: [{ t: 'plasma', dmg: 80, cd: 2.2, range: 700, spd: 330 }, W_PD, W_PD, W_PD],
  },
  ref: {
    name: '精煉站', tip: '礦石卸貨點——蓋在礦區旁能大幅縮短運輸時間',
    cost: 500, bt: 18, hull: 1700, shield: 650, regen: 12, radius: 42, vision: 600,
    dropoff: true, hotkey: 'R',
  },
  yard: {
    name: '軌道船塢', tip: '生產所有戰鬥艦艇',
    cost: 700, bt: 24, hull: 2100, shield: 850, regen: 12, radius: 55, vision: 600,
    builds: ['int', 'bomb', 'cor', 'des', 'cru', 'arty', 'car', 'bat', 'dread'], hotkey: 'Y',
  },
  lab: {
    name: '研究站', tip: '研發升級科技、解鎖高階艦種',
    cost: 900, bt: 28, hull: 1500, shield: 550, regen: 10, radius: 38, vision: 600,
    lab: true, hotkey: 'L',
  },
  outpost: {
    name: '前哨站', tip: '遠方據點：採礦船卸貨＋回港維修＋周圍 1800 可建造（可一座接一座往外推）',
    cost: 600, bt: 22, hull: 1400, shield: 600, regen: 10, radius: 34, vision: 1300,
    dropoff: true, buildRange: 1800, hotkey: 'O',
    weapons: [W_PD],
  },
  tur: {
    name: '哨衛砲塔', tip: '固定式電漿防禦砲塔（上限 24 座）',
    cost: 450, bt: 14, hull: 1300, shield: 650, regen: 10, radius: 26, vision: 700,
    limit: 24, hotkey: 'T',
    weapons: [{ t: 'plasma', dmg: 90, cd: 2.0, range: 680, spd: 330 }, W_PD],
  },
  /* 偵察衛星（戰爭迷霧用）：便宜、無武裝、脆，視野極大；noExpand＝不提供可建造範圍（免得用便宜衛星一路鋪建造圈） */
  sat: {
    name: '偵察衛星', tip: '無武裝的感測衛星：周圍 1800 的大範圍視野（戰爭迷霧開啟時用來看遠方）；不提供建造範圍',
    cost: 150, bt: 8, hull: 220, shield: 60, regen: 4, radius: 16, vision: 1800,
    noExpand: true, limit: 30, hotkey: 'K',
  },
};

/* 研究項目（依 prereq 串成科技線） */
const UPGRADES = [
  { id: 'wpn1', name: '武器強化 I',   cost: 400,  time: 22, desc: '全艦傷害 +12%' },
  { id: 'wpn2', name: '武器強化 II',  cost: 700,  time: 32, desc: '全艦傷害再 +12%', prereq: 'wpn1' },
  { id: 'wpn3', name: '武器強化 III', cost: 1100, time: 42, desc: '全艦傷害再 +12%', prereq: 'wpn2' },
  { id: 'arm1', name: '裝甲強化 I',   cost: 400,  time: 22, desc: '全艦船體與護盾 +12%' },
  { id: 'arm2', name: '裝甲強化 II',  cost: 700,  time: 32, desc: '船體與護盾再 +12%', prereq: 'arm1' },
  { id: 'arm3', name: '裝甲強化 III', cost: 1100, time: 42, desc: '船體與護盾再 +12%', prereq: 'arm2' },
  { id: 'mine1', name: '採礦增效 I',  cost: 350,  time: 20, desc: '採礦速度 +30%、礦艙 +25%' },
  { id: 'mine2', name: '採礦增效 II', cost: 600,  time: 30, desc: '採礦速度再 +30%、礦艙再 +25%', prereq: 'mine1' },
  { id: 'mine3', name: '採礦增效 III', cost: 1000, time: 40, desc: '採礦速度再 +30%、礦艙再 +25%', prereq: 'mine2' },
  { id: 'ref1', name: '精煉效率',     cost: 700,  time: 30, desc: '採礦船卸貨收入 +20%', prereq: 'mine1' },
  { id: 'eng1', name: '引擎調校 I',   cost: 400,  time: 25, desc: '全艦航速 +10%' },
  { id: 'eng2', name: '引擎調校 II',  cost: 800,  time: 35, desc: '全艦航速再 +10%', prereq: 'eng1' },
  { id: 'shd1', name: '護盾再生 I',   cost: 500,  time: 26, desc: '我方艦艇與建築護盾回復 +40%' },
  { id: 'shd2', name: '護盾再生 II',  cost: 900,  time: 36, desc: '護盾回復再 +40%', prereq: 'shd1' },
  { id: 'rep1', name: '維修工程',     cost: 600,  time: 28, desc: '回港維修速度 ×1.6、費用 ×0.6' },
  { id: 'def1', name: '防禦工事 I',   cost: 600,  time: 28, desc: '我方建築船體與火力 +25%（砲塔／前哨站／母艦）' },
  { id: 'def2', name: '防禦工事 II',  cost: 1100, time: 40, desc: '建築船體與火力再 +25%', prereq: 'def1' },
  { id: 'outp1', name: '前哨網路',    cost: 800,  time: 32, desc: '前哨站可建造範圍 +700、視野 +400' },
  { id: 'cap1', name: '主力艦建造授權', cost: 800, time: 40, desc: '解鎖航空母艦與戰列艦' },
  { id: 'cap2', name: '無畏艦建造授權', cost: 1600, time: 55, desc: '解鎖無畏級主力艦（最高階艦種）', prereq: 'cap1' },
  { id: 'fleet1', name: '艦隊編制 I',  cost: 900,  time: 30, desc: '艦隊上限 +20、戰機上限 +30' },
  { id: 'fleet2', name: '艦隊編制 II', cost: 1400, time: 40, desc: '艦隊上限再 +20、戰機上限再 +30', prereq: 'fleet1' },
  { id: 'fleet3', name: '艦隊編制 III', cost: 2000, time: 50, desc: '艦隊上限再 +20、戰機上限再 +30', prereq: 'fleet2' },
];

/* 難度（ecoRaid=經濟襲擾波機率、prong=攻勢分叉數） */
const DIFFS = {
  easy:   { name: '輕鬆巡航', inc: 10, firstRaid: 290, raidGap: 205, growth: 0.024, ecoRaid: 0,   prong: 1 },
  normal: { name: '標準戰役', inc: 16, firstRaid: 215, raidGap: 168, growth: 0.038, ecoRaid: 0.5, prong: 1 },
  hard:   { name: '艱難死鬥', inc: 27, firstRaid: 155, raidGap: 128, growth: 0.060, ecoRaid: 0.5, prong: 2 },
};

/* 敵方造艦優先序（值=權重） */
const AI_WEIGHTS = { int: 5, bomb: 2, cor: 4, des: 2, cru: 2, arty: 1, car: 1, bat: 1, dread: 0.5 };

/* AI 經濟掛鉤：收入 = inc × (floor + perHarv×min(3,採礦船數)) × (無精煉站則 ×noRef)
   3 艘採礦船＋精煉站健在 = 100% 收入（與舊平衡等值）；被騷擾＝真的變窮 */
const AI_ECO = { floor: 0.25, perHarv: 0.25, noRef: 0.75, harvCd: 20 };

/* AI 零頭預算：收入的 spare 比例另記一本「零頭帳」，存大船（want）的空檔若零頭帳夠，
   先用它補一艘便宜的 spareCls（不然存錢期間船塢閒置、總艦數偏少）。spareCap＝零頭帳上限 */
const AI_SPARE = { frac: 0.35, cls: 'int', cap: 600 };

/* 戰場殘骸：擊毀 cost≥minCost 的艦掉落 cost×frac 的可回收殘料，維持 life 秒 */
const SALVAGE = { frac: 0.22, minCost: 250, life: 90, maxWrecks: 10 };

/* 回港維修：脫戰 delay 秒後在母艦/精煉站 range 內每秒回 rate×maxHull，
   費用 = 修復量 × costMul × 造價/血量（後期主要錢坑＋撤退的報酬） */
const REPAIR = { rate: 0.05, costMul: 0.4, range: 260, delay: 5 };

/* 地圖（10-05 放大為 3 倍面積）：W/H＝半寬/半高，baseX＝兩家母艦的 x 座標。
   礦區 [x, z, 顆數, 肥沃度]：左右對稱，家門口 → 中路 → 側翼 → 中央，越往中央越肥（搶中央有真報酬） */
const MAP = { W: 5700, H: 4000, baseX: 4600, fields: (() => {
  const half = [
    [3700, 1150, 7, 1.0], [3700, -1150, 7, 1.0],     // 家門口
    [2100, 0, 6, 1.1],                                // 中路
    [2300, 2500, 6, 1.1], [2300, -2500, 6, 1.1],     // 中線兩側
    [4000, 3200, 7, 1.2], [4000, -3200, 7, 1.2],     // 遠側翼
  ];
  const out = [];
  for (const [x, z, n, r] of half) { out.push([-x, z, n, r]); out.push([x, z, n, r]); }
  out.push([0, 1500, 9, 1.5], [0, -1500, 9, 1.5], [0, 3300, 8, 1.4], [0, -3300, 8, 1.4], [0, 0, 6, 1.3]);  // 中央
  return out;
})() };
/* 三方混戰：第三勢力母艦在上方中央 (0, -H×0.78)；原本 (0,-3300) 那片礦正好壓在它家，
   改成它家門口左右兩片（比照其他兩家「家門口」的距離與顆數） */
MAP.base3 = { x: 0, z: -Math.round(MAP.H * 0.78) };
MAP.fields3 = MAP.fields.filter(f => !(f[0] === 0 && f[1] === -3300))
  .concat([[-1150, MAP.base3.z + 900, 7, 1.0], [1150, MAP.base3.z + 900, 7, 1.0]]);

/* 艦隊上限：戰機（small）與其他艦艇分開算；研究「艦隊編制」每級各加 perUp */
/* 10-07 試玩回饋：生產佇列上限 5 太煩 → 20；單顆小行星礦量偏少 → ×1.6（只影響開局礦帶，殘骸／富礦隕石不變） */
const QUEUE_MAX = 20;
const ORE_MUL = 1.6;

const CAPS = { fleet: 100, fighters: 150, fleetPerUp: 20, fighterPerUp: 30 };

/* 建造列順序（UI 按鈕與快捷鍵提示） */
const BUILD_BAR = ['ref', 'yard', 'lab', 'tur', 'outpost', 'sat'];

/* 一般建築周圍可建造的範圍（前哨站另有 buildRange） */
const BUILD_RANGE = 1150;

/* 拆除變賣：退款＝造價 × refund × 船體剩餘比例（快被打爆才賣不划算）；還在建造中取消＝退 building */
const SELL = { refund: 0.5, building: 0.75 };

/* 中盤事件：富礦隕石 */
const EVENTS = { cometFirst: 300, cometGap: 210, cometOre: 3400, cometMarkSecs: 120 };   // cometMarkSecs＝小地圖脈動標記持續秒數

/* 星盜事件（第四方 TEAMS[3]，永遠敵對所有人、無基地）：first 秒後第一波，之後每 every[0]～every[1] 秒一波；
   每波 base + floor(時間/300) 艘；組成：gunAt 秒後混砲艇、patAt 秒後混巡邏艦（gunFrac／patFrac＝比例）；
   強度 growth＝1 + 時間/growthDiv（上限 growthMax）；存活超過 life 秒撤退離場；
   生成點在地圖邊外 spawnOut、離任一基地至少 avoid；擊毀掉 SALVAGE.frac × salvageMul 殘骸（不受 minCost 限制） */
const PIRATES = {
  enabled: true, first: 240, every: [150, 200], base: 3,
  gunAt: 300, patAt: 600, gunFrac: 0.3, patFrac: 0.2,
  growthDiv: 1200, growthMax: 1.8, life: 240, spawnOut: 200, avoid: 1500,
};

/* 採空的小行星：縮到 shrink 倍（碰撞範圍同比縮小、變暗），life 秒後 fade 秒內淡出消失 */
const DEPLETE = { shrink: 0.5, life: 30, fade: 4 };

/* 戰爭迷霧：視野以 grid 格（NX×NZ 覆蓋整張地圖）粗算，每 tick 秒更新一次；
   alphaU／alphaE＝未探索／已探索但沒視野的地面遮罩濃度（haze＝已探索區薄霧的 sRGB 顏色）；reveal＝我方被打時攻擊者現形秒數；
   outpVision＝研究「前哨網路」後前哨站視野加成。AI 不受迷霧影響（全圖視野）。 */
const FOG = { NX: 128, NZ: 90, tick: 0.2, feather: 160, alphaU: 0.95, alphaE: 0.6, haze: [17, 23, 34], reveal: 2, outpVision: 400, shipVision: 500 };
