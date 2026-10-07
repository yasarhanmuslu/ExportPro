import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { getAccessContext, guardModuleAccess } from './utils/permissions.js';
import { showAlertDialog } from './utils/dialogs.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ════════════════════════════════════════════════════════════
//  YÜKLEME PLANLAYICI — 3D Bin Packing
//  Veri kaynağı: pallet_definitions (+ pallet_items)
// ════════════════════════════════════════════════════════════

// ── Taşıyıcı araçlar (net iç ölçüler cm, max ton kg) ────────
const VEHICLES = [
  { id: 'std',   name: 'Standart Tenteli Tır',  L: 1360, W: 245, H: 270, maxKg: 24000 },
  { id: 'mega',  name: 'Mega Tenteli Tır',       L: 1360, W: 245, H: 300, maxKg: 24000 },
  { id: '40hq',  name: "40' HQ Konteyner",        L: 1203, W: 235, H: 269, maxKg: 26500 },
  { id: '20dc',  name: "20' DC Konteyner",        L: 590,  W: 235, H: 239, maxKg: 21700 },
  { id: 'kamyon',name: '10 Teker Kamyon',         L: 750,  W: 245, H: 240, maxKg: 12000 },
  { id: 'custom',name: 'Özel (elle gir)',         L: 1360, W: 245, H: 270, maxKg: 24000 },
];

// ── Duvar payı cm — araç duvarlarına bırakılan boşluk ───────
// 245 cm tırda 120+120 = 240 dizilimi için sol+sağ toplamı ≤ 5 cm olmalı.
const DEFAULT_PADDING = { left: 2, right: 2, front: 0, back: 0 };
const DEFAULT_GAP = 0;        // palet arası boşluk (cm)

const PAL_PALETTE = [
  '#2D4A3E','#B58858','#3F5C7A','#9F3D3D','#5A6E3A',
  '#7A4F3F','#3D5A6E','#6B4E7A','#4E7A5A','#7A6B3D'
];

// ── Durum ───────────────────────────────────────────────────
let session = null;
let ctx = null;
let allPallets = [];          // pallet_definitions
let selection = {};           // { palletId: qty }
let curVehicle = { ...VEHICLES[0] };
let padding = { ...DEFAULT_PADDING };
let lastResult = null;        // son packing sonucu

// 3D
let scene, camera, renderer, controls, raycaster, pointer;
let palletMeshGroup = null, hovered = null, animId = null;

// ── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session: s } } = await supabase.auth.getSession();
  if (!s) { window.location.href = 'login.html'; return; }
  session = s;
  ctx = await getAccessContext();
  if (!(await guardModuleAccess(ctx, 'loading-planner'))) return;
  await renderNavbar('loading-planner', ctx);
  buildUI();
  await fetchPallets();
});

async function fetchPallets() {
  const { data, error } = await supabase
    .from('pallet_definitions')
    .select('*')
    .eq('user_id', ctx.ownerId)
    .order('name', { ascending: true });
  if (error) { console.error('Paletler yüklenemedi:', error.message); }
  allPallets = (data || []).map((p, i) => ({
    id: p.id,
    name: p.name,
    type: p.pallet_type || 'Diğer',
    W: Number(p.width_cm)  || 80,
    L: Number(p.length_cm) || 120,
    H: Number(p.height_cm) || 100,
    kg: Number(p.total_weight) || 0,
    stackable: !!p.stackable,
    strength: p.stack_strength == null ? 1 : Number(p.stack_strength),
    color: PAL_PALETTE[i % PAL_PALETTE.length],
  }));
  renderPalletList();
}

// ════════════════════════════════════════════════════════════
//  YERLEŞİM MOTORU (v3 — şerit yerleşimi + genetik yedek)
//  Ölçüler:
//   - Duvar payı (sol/sağ/ön/arka) aracın iç ölçüsünden düşülür.
//   - Palet arası boşluk her paletin footprint'ine bir kez eklenir;
//     kullanılabilir ölçüye de bir kez eklenir ki son paletin arkasında
//     boşluk aranmasın.
//  Kısıtlar:
//   - Paletler dik (Z sabit). Tabanda 90° döndürme serbest.
//   - Yalnız stackable paletler üst üste; strength düşük (1) = altta/ağır,
//     üstteki strength >= alttaki, üst ağırlık <= alt ağırlık.
//   - Araçtan yüksek paletler ve ağırlık sınırını aşan paletler yüklenmez.
//   - Ağırlar öne (ön dingil), hafifler kapıya.
// ════════════════════════════════════════════════════════════

// ---- Adım 1: Paletleri dikey "kolonlara" (istif yığını) grupla ----
// Her kolon: tabanı zemine oturan 1..maxStack palet. Üst paletler taban
// footprint'ine sığmalı. stackBudget: başka paletin üstüne konabilecek
// toplam palet sayısı (denge modunda yalnızca gerektiği kadar istif).
function buildColumns(items, vehicle, gap, maxStack, stackBudget = Infinity) {
  // Güçlü (strength küçük) + ağır önce → taban adayı.
  const pool = items.slice().sort((a, b) => (a.strength - b.strength) || (b.kg - a.kg));
  const used = new Array(pool.length).fill(false);
  const columns = [];

  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    const base = pool[i];
    used[i] = true;

    const col = {
      baseW: base.W, baseL: base.L,
      fpW: base.W + gap, fpL: base.L + gap,
      stack: [base],
      topZ: base.H,
      totalKg: base.kg,
      minStrengthTop: base.strength,   // en üstteki paletin strength'i
      topKg: base.kg,
    };

    // Taban istiflenebilir değilse kolon tek paletten ibaret.
    if (base.stackable) {
      while (col.stack.length < maxStack && stackBudget > 0) {
        let bestIdx = -1, bestScore = -Infinity;
        for (let j = 0; j < pool.length; j++) {
          if (used[j]) continue;
          const c = pool[j];
          if (!c.stackable) continue;
          if (c.strength < col.minStrengthTop) continue;     // üst >= alt strength
          if (c.kg > col.topKg + 0.01) continue;             // üst <= alt ağırlık
          const fits =
            (c.W <= col.baseW + 0.01 && c.L <= col.baseL + 0.01) ||
            (c.L <= col.baseW + 0.01 && c.W <= col.baseL + 0.01);
          if (!fits) continue;
          if (col.topZ + c.H > vehicle.H + 0.01) continue;   // yükseklik sınırı
          const score = c.W * c.L - Math.abs(c.strength - col.minStrengthTop) * 1000;
          if (score > bestScore) { bestScore = score; bestIdx = j; }
        }
        if (bestIdx < 0) break;
        const c = pool[bestIdx];
        used[bestIdx] = true;
        stackBudget--;
        col.stack.push(c);
        col.topZ += c.H;
        col.totalKg += c.kg;
        col.minStrengthTop = c.strength;
        col.topKg = c.kg;
      }
    }
    columns.push(col);
  }
  return columns;
}

// ---- Adım 2a: Şerit (sıra) yerleşimi — sahadaki yükleme pratiği ----
// Araç genişliği boyuna "şeritlere" bölünür; her şeritte paletler önden
// kapıya art arda dizilir. Örnekler:
//   245 cm tır, 80×120 / 100×120 → 120 + 120 = 240 (kısa kenar boyuna)
//   235 cm konteyner → 120+120 sığmaz → 120 + 80 (bir ters bir düz);
//   euro palette bu, 3 ters (80 derin) : 2 düz (120 derin) dizilime denk gelir.
// Tüm şerit kombinasyonları denenir; en çok paleti yerleştiren, eşitlikte
// uzun kenarı enine koyan (sahadaki tercih) kombinasyon seçilir.
function laneConfigs(columns, usableW, singleRow) {
  const sides = [...new Set(columns.flatMap(c => [c.fpW, c.fpL]).map(v => Math.round(v * 10) / 10))]
    .filter(s => s <= usableW + 0.01)
    .sort((a, b) => b - a);
  const out = [];
  (function rec(start, acc, sum) {
    if (out.length >= 2000) return;   // çok sayıda farklı ölçüde patlamayı önle
    let extended = false;
    if (!singleRow || acc.length === 0) {
      for (let i = start; i < sides.length; i++) {
        if (sum + sides[i] > usableW + 0.01) continue;
        extended = true;
        rec(i, acc.concat(sides[i]), sum + sides[i]);
      }
    }
    if (!extended && acc.length) out.push(acc);
  })(0, [], 0);
  return out;
}

// Kolonları sırayla şeritlere dağıt: her kolon, onu en az uzatan şeride
// (eşitlikte en az genişlik firesi, sonra en hafif şerit) ve o şeritte
// en kısa derinliği veren yönle girer. wasteFirst: önce fire, sonra uzunluk
// (karma ölçülerde euro paletin 100'lük şeride kaçmasını önler).
function fillLanes(order, laneWs, usableL, wasteFirst) {
  const lanes = laneWs.map(w => ({ w, len: 0, kg: 0, cols: [] }));
  const leftover = [];
  for (const col of order) {
    let best = null;
    for (const ln of lanes) {
      for (const o of [{ across: col.fpW, depth: col.fpL, rot: false },
                       { across: col.fpL, depth: col.fpW, rot: true }]) {
        if (o.across > ln.w + 0.01 || ln.len + o.depth > usableL + 0.01) continue;
        const k = wasteFirst
          ? [ln.w - o.across, ln.len + o.depth, ln.kg]
          : [ln.len + o.depth, ln.w - o.across, ln.kg];
        const better = !best ||
          k[0] < best.k[0] - 0.01 ||
          (Math.abs(k[0] - best.k[0]) <= 0.01 &&
            (k[1] < best.k[1] - 0.01 || (Math.abs(k[1] - best.k[1]) <= 0.01 && k[2] < best.k[2])));
        if (better) best = { ln, o, k };
      }
    }
    if (!best) { leftover.push(col); continue; }
    best.ln.cols.push({ col, ...best.o });
    best.ln.len += best.o.depth;
    best.ln.kg  += col.totalKg;
  }
  return { lanes, leftover };
}

function laneScore(res) {
  const placed = res.lanes.reduce((s, ln) => s + ln.cols.reduce((a, c) => a + c.col.stack.length, 0), 0);
  const longAcross = res.lanes.reduce((s, ln) => s + ln.cols.filter(c => c.across >= c.depth - 0.01).length, 0);
  const maxLen = Math.max(0, ...res.lanes.map(ln => ln.len));
  const kgs = res.lanes.map(ln => ln.kg);
  const kgSpread = kgs.length > 1 ? Math.max(...kgs) - Math.min(...kgs) : 0;
  return { placed, longAcross, maxLen, kgSpread };
}

// a, b'den iyi mi? Önce yerleşen palet, sonra uzun kenarı enine konan kolon
// sayısı; sonra denge modunda sağ/sol ağırlık farkı, boşluk modunda yük boyu.
function betterLane(a, b, mode) {
  if (a.placed !== b.placed) return a.placed > b.placed;
  if (a.longAcross !== b.longAcross) return a.longAcross > b.longAcross;
  if (mode === 'volume') {
    if (Math.abs(a.maxLen - b.maxLen) > 0.01) return a.maxLen < b.maxLen;
    return a.kgSpread < b.kgSpread;
  }
  if (Math.abs(a.kgSpread - b.kgSpread) > 0.01) return a.kgSpread < b.kgSpread;
  return a.maxLen < b.maxLen;
}

function placeLanes(columns, usableL, usableW, mode, singleRow) {
  const orders = [
    columns.slice().sort((a, b) => b.totalKg - a.totalKg),
    columns.slice().sort((a, b) =>
      (Math.max(b.fpW, b.fpL) - Math.max(a.fpW, a.fpL)) || (b.fpW * b.fpL - a.fpW * a.fpL)),
    columns.slice().sort((a, b) => (a.fpW * a.fpL - b.fpW * b.fpL) || (b.totalKg - a.totalKg)),
    // Araç dolduğunda çok katlı kolonlar önce → daha çok palet sığar.
    columns.slice().sort((a, b) => (b.stack.length - a.stack.length) || (a.fpW * a.fpL - b.fpW * b.fpL)),
  ];
  let best = null;
  for (const cfg of laneConfigs(columns, usableW, singleRow)) {
    for (const ord of orders) {
      for (const wasteFirst of [false, true]) {
        const res = fillLanes(ord, cfg, usableL, wasteFirst);
        const sc = laneScore(res);
        if (!best || betterLane(sc, best.sc, mode)) best = { res, sc, cfg };
      }
    }
  }
  return best;
}

// Şerit sonucunu araç koordinatlarına çevir. Şeritler duvarlara yaslanır,
// artan genişlik aralara dağılır; tek şerit parsiyelde sol duvara, değilse
// ortaya. Her şeritte ağır kolon öne (ön dingil), hafif kapıya.
function lanePositions(best, pad, gap, usableW, singleRow) {
  const lanes = best.res.lanes;
  const total = lanes.reduce((s, ln) => s + ln.w, 0);
  const free = Math.max(0, usableW - total);
  const between = lanes.length > 1 ? free / (lanes.length - 1) : 0;
  let y = pad.left + (lanes.length === 1 && !singleRow ? free / 2 : 0);
  const out = [];
  for (const ln of lanes) {
    ln.cols.sort((a, b) => b.col.totalKg - a.col.totalKg);
    let x = pad.front;
    for (const c of ln.cols) {
      out.push({ col: c.col, rot: c.rot, cx: x + (c.depth - gap) / 2, cy: y + (ln.w - gap) / 2 });
      x += c.depth;
    }
    y += ln.w + between;
  }
  return out;
}

// ---- Adım 2b: Serbest yerleşim (genetik algoritma) — yedek ----
// Şerit düzeni tüm paletleri alamadığında devreye girer; daha çok palet
// sığdırırsa onun sonucu kullanılır.
// Bir çözümün kalite skoru: önce yerleşen palet sayısı, sonra taban
// doluluğu, sonra ağırlık dengesi (COM %50'ye yakınlık).
function scoreSolution(placedCols, leftover, vehicle, mode = 'balance') {
  const placedPallets = placedCols.reduce((s, pc) => s + pc.col.stack.length, 0);
  const lostPallets   = leftover.reduce((s, c) => s + c.stack.length, 0);
  const usedFloor = placedCols.reduce((s, pc) => s + pc.w * pc.h, 0);
  const floorArea = vehicle.L * vehicle.W;
  const floorPct  = floorArea > 0 ? usedFloor / floorArea : 0;

  // Hacim doluluğu (gerçek istif hacmi / araç hacmi) — "en az boşluk" metriği.
  const usedVol = placedCols.reduce((s, pc) =>
    s + pc.col.stack.reduce((a, it) => a + it.W * it.L * it.H, 0), 0);
  const vehVol = vehicle.L * vehicle.W * vehicle.H;
  const volPct = vehVol > 0 ? usedVol / vehVol : 0;

  if (mode === 'volume') {
    // ── EN AZ BOŞLUK MODU ──
    // Ağırlık/denge tamamen yok sayılır. Yerleşen palet sayısı baskın,
    // sonra hacim doluluğu, sonra taban doluluğu. Hiçbir denge cezası yok.
    return (placedPallets * 1e7)
         - (lostPallets   * 1e7)
         + (volPct        * 2e5)
         + (floorPct      * 1e5);
  }

  // ── KUSURSUZ DENGE MODU (varsayılan — DEĞİŞTİRİLMEDİ) ──
  const totalKg = placedCols.reduce((s, pc) => s + pc.col.totalKg, 0);
  let com = 0;
  if (totalKg > 0) {
    com = placedCols.reduce((s, pc) => s + (pc.x + pc.w / 2) * pc.col.totalKg, 0) / totalKg;
  }
  const comPct = vehicle.L > 0 ? com / vehicle.L : 0.5;
  const balancePenalty = Math.abs(comPct - 0.5); // 0 ideal .. 0.5 kötü

  // Ağırlıklı skor — palet sayısı baskın, sonra taban doluluğu (güçlü),
  // sonra denge. floorPct katsayısı yüksek tutuldu ki aynı palet sayısında
  // daha sıkı paketleyen strateji net kazansın.
  return (placedPallets * 1e7)
       - (lostPallets   * 1e7)
       + (floorPct      * 1e5)
       - (balancePenalty * 100);
}

// ════════════════════════════════════════════════════════════
//  GENETİK ALGORİTMA YERLEŞİM MOTORU
//  Kromozom = kolonların yerleştirme sırası (permütasyon) + her kolon için
//             rotasyon biti (0° / 90°).
//  Decoder  = kromozomu, "önden alt-sol" (front-bottom-left) yerleştirici ile
//             fiziksel yerleşime çevirir.
//  Fitness  = yerleşen palet ↑, taban doluluğu ↑, ağırlık dengesi ↑.
//  Evrim    = seçilim (turnuva) → çaprazlama (sıralı OX + rotasyon karışımı)
//             → mutasyon (swap + rotasyon flip) → elitizm.
//  Başlangıç popülasyonu deterministik sezgisellerle TOHUMLANIR; böylece GA
//  asla mevcut kaliteden kötü sonuç vermez, sadece iyileştirir.
// ════════════════════════════════════════════════════════════

// Sezgisel tohumlar: farklı sıralama kriterleri (deterministik başlangıç).
function seedOrders(columns) {
  const seeds = {
    'alan-azalan':      (a, b) => (b.fpW * b.fpL) - (a.fpW * a.fpL),
    'uzunkenar-azalan': (a, b) => Math.max(b.fpW, b.fpL) - Math.max(a.fpW, a.fpL) || (b.fpW * b.fpL) - (a.fpW * a.fpL),
    'uzunluk-azalan':   (a, b) => b.fpL - a.fpL || b.fpW - a.fpW,
    'genislik-azalan':  (a, b) => b.fpW - a.fpW || b.fpL - a.fpL,
    'agir-once':        (a, b) => b.totalKg - a.totalKg || (b.fpW * b.fpL) - (a.fpW * a.fpL),
    'yuksek-once':      (a, b) => b.topZ - a.topZ || (b.fpW * b.fpL) - (a.fpW * a.fpL),
  };
  return Object.entries(seeds).map(([name, fn]) => {
    const idx = columns.map((_, i) => i).sort((i, j) => fn(columns[i], columns[j]));
    return { order: idx, name };
  });
}

// DECODER: bir kromozomu (order + rot[]) fiziksel yerleşime çevirir.
// "Önden alt-sol": aday noktaları küçük-x (ön) sonra küçük-y önceliğiyle gezer,
// böylece yük aracın önünden başlar (ağırlık merkezi öne gelir).
function decode(chromosome, columns, vehicle) {
  const L = vehicle.L, W = vehicle.W;
  const placedCols = [], leftover = [];
  const rects = [];
  for (const ci of chromosome.order) {
    const col = columns[ci];
    const rot = chromosome.rot[ci];
    // kromozomun istediği rotasyonu önce dene; sığmazsa diğerini dene.
    const orient = rot
      ? [{ w: col.fpW, h: col.fpL, r: true }, { w: col.fpL, h: col.fpW, r: false }]
      : [{ w: col.fpL, h: col.fpW, r: false }, { w: col.fpW, h: col.fpL, r: true }];
    // aday noktalar
    const points = [{ x: 0, y: 0 }];
    rects.forEach(rr => { points.push({ x: rr.x + rr.w, y: rr.y }); points.push({ x: rr.x, y: rr.y + rr.h }); });
    points.sort((p, q) => (p.x - q.x) || (p.y - q.y)); // ÖN (küçük x) öncelik
    let spot = null;
    outer:
    for (const pt of points) {
      for (const o of orient) {
        if (pt.x + o.w > L + 0.01 || pt.y + o.h > W + 0.01) continue;
        const test = { x: pt.x, y: pt.y, w: o.w, h: o.h };
        if (rects.some(rr => rectsOverlap(rr, test))) continue;
        spot = { ...test, rot: o.r };
        break outer;
      }
    }
    if (!spot) { leftover.push(col); continue; }
    rects.push({ x: spot.x, y: spot.y, w: spot.w, h: spot.h });
    placedCols.push({ col, x: spot.x, y: spot.y, w: spot.w, h: spot.h, rot: spot.rot });
  }
  return { placedCols, leftover };
}

// Kromozomun fitness'ı (yüksek = iyi).
function fitness(chromosome, columns, vehicle, mode) {
  if (chromosome._fit != null) return chromosome._fit;
  const dec = decode(chromosome, columns, vehicle);
  chromosome._dec = dec;
  chromosome._fit = scoreSolution(dec.placedCols, dec.leftover, vehicle, mode);
  return chromosome._fit;
}

function placeColumns2D(columns, vehicle, opts = {}) {
  const mode = opts.mode || 'balance';
  const n = columns.length;
  if (n === 0) return { placedCols: [], leftover: [], strategy: 'boş' };

  // GA parametreleri — "süre uzasa da optimize" tercihine göre bonkör.
  const POP = Math.min(120, 40 + n * 4);
  const GENERATIONS = n <= 20 ? 120 : (n <= 60 ? 80 : 50);
  const ELITE = Math.max(2, Math.round(POP * 0.10));
  const TOURNEY = 4;
  const MUT_RATE = 0.25;

  const rnd = mulberry32(0x9e3779b9 ^ (n * 2654435761));
  const randInt = (m) => Math.floor(rnd() * m);

  // ---- Başlangıç popülasyonu ----
  const pop = [];
  // 1) Sezgisel tohumlar (rotasyon: tümü 0°, ve tümü "uzun kenar derinliğe")
  const seeds = seedOrders(columns);
  for (const s of seeds) {
    pop.push({ order: s.order.slice(), rot: new Array(n).fill(false), src: s.name });
    // aynı tohumun "akıllı rotasyon" varyantı: dar kenarı derinliğe koy
    const smartRot = columns.map(c => c.fpW < c.fpL); // genişlik<uzunluk ise döndür
    pop.push({ order: s.order.slice(), rot: smartRot.slice(), src: s.name + '+rot' });
  }
  // 2) Geri kalanı rastgele permütasyon + rastgele rotasyon
  while (pop.length < POP) {
    const order = shuffled(n, randInt);
    const rot = Array.from({ length: n }, () => rnd() < 0.5);
    pop.push({ order, rot, src: 'rastgele' });
  }

  // ---- Evrim döngüsü ----
  let best = null;
  let stale = 0;                       // kaç nesildir iyileşme yok
  const STALL_LIMIT = Math.max(15, Math.round(GENERATIONS * 0.35));
  for (let g = 0; g < GENERATIONS; g++) {
    pop.forEach(ch => fitness(ch, columns, vehicle, mode));
    pop.sort((a, b) => b._fit - a._fit);
    if (!best || pop[0]._fit > best._fit + 1e-6) { best = pop[0]; stale = 0; }
    else stale++;
    if (stale >= STALL_LIMIT) break;   // erken durma: yakınsadı

    const next = [];
    // elitizm: en iyileri doğrudan taşı
    for (let i = 0; i < ELITE; i++) next.push(cloneChrom(pop[i]));
    // üreme
    while (next.length < POP) {
      const p1 = tournament(pop, TOURNEY, randInt);
      const p2 = tournament(pop, TOURNEY, randInt);
      let child = crossover(p1, p2, n, randInt, rnd);
      if (rnd() < MUT_RATE) mutate(child, n, randInt, rnd);
      next.push(child);
    }
    pop.length = 0;
    Array.prototype.push.apply(pop, next);
  }
  pop.forEach(ch => fitness(ch, columns, vehicle, mode));
  pop.sort((a, b) => b._fit - a._fit);
  if (!best || pop[0]._fit > best._fit) best = pop[0];

  const dec = best._dec || decode(best, columns, vehicle);
  return {
    placedCols: dec.placedCols,
    leftover: dec.leftover,
    strategy: `${mode === 'volume' ? 'en az boşluk' : 'kusursuz denge'} · genetik algoritma (pop ${POP} · ${GENERATIONS} nesil · tohum: ${best.src || 'evrim'})`,
  };
}

// ---- GA yardımcıları ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(n, randInt) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function cloneChrom(ch) { return { order: ch.order.slice(), rot: ch.rot.slice(), src: ch.src }; }
function tournament(pop, k, randInt) {
  let best = pop[randInt(pop.length)];
  for (let i = 1; i < k; i++) { const c = pop[randInt(pop.length)]; if (c._fit > best._fit) best = c; }
  return best;
}
// Sıralı çaprazlama (Order Crossover, OX) + rotasyon bitlerinin karışımı.
function crossover(p1, p2, n, randInt, rnd) {
  const a = randInt(n), b = randInt(n);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const childOrder = new Array(n).fill(-1);
  const taken = new Set();
  for (let i = lo; i <= hi; i++) { childOrder[i] = p1.order[i]; taken.add(p1.order[i]); }
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const gene = p2.order[i];
    if (taken.has(gene)) continue;
    while (childOrder[idx] !== -1) idx++;
    childOrder[idx] = gene;
  }
  // rotasyon: her gen için iki ebeveynden rastgele miras
  const rot = new Array(n);
  for (let i = 0; i < n; i++) rot[i] = (rnd() < 0.5 ? p1.rot[i] : p2.rot[i]);
  return { order: childOrder, rot, src: 'çapraz' };
}
function mutate(ch, n, randInt, rnd) {
  // swap mutasyonu (sıra)
  const i = randInt(n), j = randInt(n);
  [ch.order[i], ch.order[j]] = [ch.order[j], ch.order[i]];
  // rotasyon flip (1-2 gen)
  const flips = 1 + randInt(2);
  for (let f = 0; f < flips; f++) { const k = randInt(n); ch.rot[k] = !ch.rot[k]; }
  ch._fit = null; ch._dec = null;
}

function rectsOverlap(a, b) {
  return !(b.x >= a.x + a.w - 0.01 || b.x + b.w <= a.x + 0.01 ||
           b.y >= a.y + a.h - 0.01 || b.y + b.h <= a.y + 0.01);
}

// ---- Ağırlık dengeleme: hafif kolonları kapıya (max X) doğru ----
// Aynı footprint ölçüsündeki kolonların X-slotlarını ağırlığa göre yeniden
// atar: ağır kolon küçük X (ön/dingil), hafif kolon büyük X (arka/kapı).
// Aynı footprint grubunda Y bağımsız olduğundan X-takası çakışma yaratmaz.
function rebalance(placedCols) {
  const groups = {};
  placedCols.forEach(pc => {
    const key = `${Math.round(pc.w)}x${Math.round(pc.h)}x${Math.round(pc.y)}`;
    (groups[key] ||= []).push(pc);
  });
  Object.values(groups).forEach(g => {
    if (g.length < 2) return;
    const xs = g.map(pc => pc.x).sort((a, b) => a - b);
    g.sort((a, b) => b.col.totalKg - a.col.totalKg); // ağır önce
    g.forEach((pc, i) => { pc.x = xs[i]; });          // ağır → küçük X
  });
}

function placeGA(columns, usableL, usableW, pad, gap, mode) {
  const p = placeColumns2D(columns, { L: usableL, W: usableW }, { mode });
  if (mode !== 'volume') rebalance(p.placedCols);
  // Genişlik (Y) ekseninde yükü ortala.
  let minY = Infinity, maxY = -Infinity;
  p.placedCols.forEach(pc => { minY = Math.min(minY, pc.y); maxY = Math.max(maxY, pc.y + pc.h); });
  const shiftY = p.placedCols.length ? (usableW - (maxY - minY)) / 2 - minY : 0;
  return {
    positions: p.placedCols.map(pc => ({
      col: pc.col, rot: pc.rot,
      cx: pad.front + pc.x + (pc.w - gap) / 2,
      cy: pad.left + pc.y + shiftY + (pc.h - gap) / 2,
    })),
    leftover: p.leftover,
    strategy: p.strategy,
  };
}

const countPallets = (arr) => arr.reduce((s, x) => s + (x.col || x).stack.length, 0);

// opts.mode: 'balance' → hepsini sığdıran EN ALÇAK istif (yük tabana yayılır)
//            'volume'  → olabildiğince yüksek istif (yük öne toplanır, kapı
//                        tarafında boş yer kalır)
// opts.noStack: istif yok · opts.singleRow: tek sıra (parsiyel)
function packVehicle(vehicle, items, pad, gap, opts = {}) {
  const { mode = 'balance', noStack = false, singleRow = false } = opts;
  const usableL = vehicle.L - pad.front - pad.back + gap;
  const usableW = vehicle.W - pad.left - pad.right + gap;

  const unplaced = [];   // { name, reason }
  const fitH = [];
  items.forEach(it => (it.H > vehicle.H + 0.01 ? unplaced.push({ name: it.name, reason: 'height' }) : fitH.push(it)));

  const depths = noStack ? [1]
    : mode === 'volume' ? [Infinity]
    : Array.from({ length: fitH.length }, (_, i) => i + 1);
  let best = null, prevCols = -1, floorFit = 0;
  const tryPack = (k, budget) => {
    const columns = buildColumns(fitH, vehicle, gap, k, budget);
    const lane = placeLanes(columns, usableL, usableW, mode, singleRow);
    return { columns, lane, k, placedN: lane ? lane.sc.placed : 0 };
  };
  for (const k of depths) {
    const res = tryPack(k);
    if (res.columns.length === prevCols) break;      // daha derin istif mümkün değil
    prevCols = res.columns.length;
    if (k === 1) floorFit = res.placedN;
    if (!best || res.placedN > best.placedN) best = res;
    if (res.placedN === fitH.length) break;
  }
  // Denge: hepsi sığıyorsa yalnızca gerektiği kadar palet istiflenir
  // (ör. tırda 42 euro → 34 tabanda, 8 üstte; hepsi çift kat değil).
  if (mode === 'balance' && best && best.k > 1 && best.placedN === fitH.length) {
    for (let budget = Math.max(1, fitH.length - floorFit); budget < fitH.length; budget++) {
      const res = tryPack(best.k, budget);
      if (res.placedN === fitH.length) { best = res; break; }
    }
  }

  const modeName = mode === 'volume' ? 'en az boşluk' : 'kusursuz denge';
  let positions = [], leftover = best ? best.columns : [], strategy = modeName;
  if (best && best.lane) {
    positions = lanePositions(best.lane, pad, gap, usableW, singleRow);
    leftover = best.lane.res.leftover;
    const cfg = best.lane.cfg.map(w => Math.round(w - gap)).join(' + ');
    strategy = `${modeName} · şerit yerleşimi (${best.lane.cfg.length} sıra: ${cfg} cm)`;
  }
  // Parsiyel tek sırada serbest yerleşim yapılmaz.
  if (best && leftover.length && !singleRow) {
    const ga = placeGA(best.columns, usableL, usableW, pad, gap, mode);
    if (countPallets(ga.positions) > countPallets(positions)) {
      positions = ga.positions; leftover = ga.leftover; strategy = ga.strategy;
    }
  }

  let placed = [];
  positions.forEach(ps => {
    let z0 = 0;
    ps.col.stack.forEach(it => {
      placed.push(makePlaced(it, ps.cx, ps.cy, z0, ps.rot));
      z0 += it.H;
    });
  });
  leftover.forEach(col => col.stack.forEach(it => unplaced.push({ name: it.name, reason: 'space' })));

  // Ağırlık sınırı: aşılıyorsa kapı tarafından, en üstteki paletten başlayarak indir.
  let totalKg = placed.reduce((s, p) => s + p.kg, 0);
  if (vehicle.maxKg > 0 && totalKg > vehicle.maxKg + 0.01) {
    const drop = new Set();
    for (const p of placed.slice().sort((a, b) => (b.cx - a.cx) || (b.z0 - a.z0))) {
      if (totalKg <= vehicle.maxKg + 0.01) break;
      drop.add(p);
      totalKg -= p.kg;
      unplaced.push({ name: p.name, reason: 'weight' });
    }
    placed = placed.filter(p => !drop.has(p));
  }

  const maxLayer = Math.max(0, ...positions.map(ps => ps.col.stack.length));
  if (placed.length) strategy += ` · istif en fazla ${maxLayer} kat`;

  const floorPallets = placed.filter(p => p.z0 === 0);
  const usedVol = placed.reduce((s, p) => s + (p.W * p.L * p.H), 0);
  const usedFloor = floorPallets.reduce((s, p) => s + p.W * p.L, 0);
  const vehVol  = vehicle.L * vehicle.W * vehicle.H;
  const floorArea = vehicle.L * vehicle.W;
  const com = totalKg > 0 ? placed.reduce((s, p) => s + p.cx * p.kg, 0) / totalKg : 0;

  return {
    vehicle, placed, unplaced,
    totalKg,
    volPct: vehVol > 0 ? (usedVol / vehVol) * 100 : 0,
    floorPct: floorArea > 0 ? (usedFloor / floorArea) * 100 : 0,
    columnCount: floorPallets.length,
    strategy,
    com, comPct: vehicle.L > 0 ? (com / vehicle.L) * 100 : 0,
  };
}

function makePlaced(it, cx, cy, z0, rot) {
  return {
    ref: it.id, name: it.name, type: it.type,
    kg: it.kg, stackable: it.stackable, strength: it.strength, color: it.color,
    W: it.W, L: it.L, H: it.H, rot,
    cx, cy, z0,
  };
}

// ════════════════════════════════════════════════════════════
//  UI İSKELET
// ════════════════════════════════════════════════════════════
function buildUI() {
  const root = document.getElementById('planner-root');
  root.innerHTML = `
    <div class="lp-layout" style="display:grid;grid-template-columns:320px 1fr;gap:18px;align-items:start;">
      <!-- SOL PANEL -->
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="lp-card" style="padding:16px;">
          <label style="font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;">Taşıyıcı Araç</label>
          <select id="lp-vehicle" style="width:100%;margin-top:8px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--ink-1);font-size:13px;">
            ${VEHICLES.map(v => `<option value="${v.id}">${v.name}</option>`).join('')}
          </select>
          <div id="lp-veh-dims" style="margin-top:10px;font-size:12px;color:var(--ink-2);"></div>
          <div id="lp-custom-box" style="margin-top:10px;display:none;grid-template-columns:1fr 1fr;gap:8px;">
            ${['L','W','H','maxKg'].map(k => `
              <label style="font-size:11px;color:var(--ink-2);">${({L:'Boy (cm)',W:'En (cm)',H:'Yük. (cm)',maxKg:'Max (kg)'})[k]}
                <input id="lp-c-${k}" type="number" class="lp-qty" style="width:100%;margin-top:3px;" />
              </label>`).join('')}
          </div>
        </div>

        <div class="lp-card" style="padding:16px;">
          <label style="font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;">Duvar Payı (cm)</label>
          <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${['left','right','front','back'].map(k => `
              <label style="font-size:11px;color:var(--ink-2);">${({left:'Sol',right:'Sağ',front:'Ön',back:'Arka'})[k]}
                <input id="lp-pad-${k}" type="number" min="0" value="${DEFAULT_PADDING[k]}" class="lp-qty" style="width:100%;margin-top:3px;" />
              </label>`).join('')}
            <label style="font-size:11px;color:var(--ink-2);grid-column:1 / -1;">Palet arası boşluk
              <input id="lp-gap" type="number" min="0" value="${DEFAULT_GAP}" class="lp-qty" style="width:100%;margin-top:3px;" />
            </label>
          </div>
          <p style="font-size:11px;color:var(--ink-2);margin-top:8px;line-height:1.5;">
            Pay araç duvarlarına bırakılır. 245 cm tırda 120 + 120 dizilimi için sol + sağ toplamı en fazla 5 cm olmalı.
          </p>
        </div>

        <div class="lp-card" style="padding:16px;display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;">Yükleme Seçenekleri</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-1);cursor:pointer;">
            <input id="lp-nostack" type="checkbox" /> İstif yapma
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-1);cursor:pointer;">
            <input id="lp-singlerow" type="checkbox" /> Tek sıra (parsiyel yükleme)
          </label>
        </div>

        <div class="lp-card" style="padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;">Paletler</label>
            <button id="lp-refresh" class="lp-chip" title="Yenile"><i class="fa-solid fa-rotate"></i></button>
          </div>
          <div id="lp-pallet-list" style="margin-top:10px;max-height:340px;overflow:auto;"></div>
        </div>

        <button id="lp-calc" style="padding:12px;border:none;border-radius:11px;background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;">
          <i class="fa-solid fa-scale-balanced"></i>&nbsp; Kusursuz Denge Hesabı
        </button>
        <button id="lp-calc-vol" style="padding:12px;border:1px solid var(--accent);border-radius:11px;background:var(--surface,#fff);color:var(--accent);font-size:14px;font-weight:700;cursor:pointer;">
          <i class="fa-solid fa-cubes-stacked"></i>&nbsp; En Az Boşluk Hesabı
        </button>
        <p style="font-size:11px;color:var(--ink-2);margin-top:-4px;line-height:1.5;">
          Paletler sıra sıra dizilir (tırda 120 + 120, sığmazsa bir ters bir düz); ağır paletler öne (ön dingil).<br>
          <b>Kusursuz Denge:</b> yükü tabana yayar, mümkün olan en alçak istifi kullanır.<br>
          <b>En Az Boşluk:</b> olabildiğince yüksek istifler, yükü öne toplar; kapı tarafında boş yer kalır.
        </p>
      </div>

      <!-- SAĞ PANEL -->
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div id="lp-stats" class="lp-stats" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;"></div>
        <div id="lp-strategy" style="font-size:11px;color:var(--ink-2);padding:0 2px;"></div>
        <div class="lp-card" style="position:relative;padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <span class="lp-legend"><i style="background:#7A2E2E;"></i>Ağır</span>
              <span class="lp-legend"><i style="background:#7C5F40;"></i>Orta</span>
              <span class="lp-legend"><i style="background:#7E9152;"></i>Hafif</span>
              <span class="lp-legend"><i style="background:rgba(45,74,62,.18);"></i>Araç gövdesi</span>
            </div>
            <button id="lp-reset-cam" class="lp-chip"><i class="fa-solid fa-arrows-to-dot"></i> Kamerayı sıfırla</button>
          </div>
          <div style="position:relative;height:560px;background:var(--bg);border-radius:12px;overflow:hidden;">
            <canvas id="lp-canvas"></canvas>
            <div id="lp-tip" class="lp-tip"></div>
            <div id="lp-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--ink-2);font-size:14px;text-align:center;padding:20px;">
              <span>Palet adetlerini girip <b>Kusursuz Denge</b> ya da <b>En Az Boşluk</b> hesabına basın.</span>
            </div>
          </div>
          <div id="lp-unplaced" style="margin-top:10px;"></div>
        </div>
      </div>
    </div>`;

  document.getElementById('lp-vehicle').addEventListener('change', onVehicleChange);
  document.getElementById('lp-refresh').addEventListener('click', fetchPallets);
  document.getElementById('lp-calc').addEventListener('click', () => onCalculate('balance'));
  document.getElementById('lp-calc-vol').addEventListener('click', () => onCalculate('volume'));
  document.getElementById('lp-reset-cam').addEventListener('click', resetCamera);
  ['L','W','H','maxKg'].forEach(k =>
    document.getElementById(`lp-c-${k}`).addEventListener('input', readCustom));
  onVehicleChange();
}

function onVehicleChange() {
  const id = document.getElementById('lp-vehicle').value;
  const v = VEHICLES.find(x => x.id === id);
  curVehicle = { ...v };
  // Kutunun satır içi display'i Tailwind .hidden'ı ezdiği için doğrudan display.
  document.getElementById('lp-custom-box').style.display = id === 'custom' ? 'grid' : 'none';
  if (id === 'custom') {
    ['L','W','H','maxKg'].forEach(k => { document.getElementById(`lp-c-${k}`).value = v[k]; });
  }
  document.getElementById('lp-veh-dims').textContent =
    `İç ölçü: ${v.L} × ${v.W} × ${v.H} cm · Max ${(v.maxKg/1000).toLocaleString('tr-TR')} ton`;
}
function readCustom() {
  if (document.getElementById('lp-vehicle').value !== 'custom') return;
  ['L','W','H','maxKg'].forEach(k => {
    const val = Number(document.getElementById(`lp-c-${k}`).value);
    if (val > 0) curVehicle[k] = val;
  });
  document.getElementById('lp-veh-dims').textContent =
    `İç ölçü: ${curVehicle.L} × ${curVehicle.W} × ${curVehicle.H} cm · Max ${(curVehicle.maxKg/1000).toLocaleString('tr-TR')} ton`;
}

function renderPalletList() {
  const box = document.getElementById('lp-pallet-list');
  if (!allPallets.length) {
    box.innerHTML = `<p style="font-size:12px;color:var(--ink-2);padding:10px 0;">Tanımlı palet yok. Önce <b>Palet Tanımları</b> ekranından palet ekleyin.</p>`;
    return;
  }
  box.innerHTML = allPallets.map(p => `
    <div class="lp-row">
      <span style="width:12px;height:28px;border-radius:4px;background:${p.color};flex:none;"></span>
      <div style="flex:1;min-width:0;">
        <div class="nm">${esc(p.name)}</div>
        <div class="meta">${p.W}×${p.L}×${p.H} cm · ${fmtKg(p.kg)} · ${p.stackable ? 'İstif L'+p.strength : 'İstifsiz'}</div>
      </div>
      <input type="number" min="0" value="${selection[p.id]||0}" class="lp-qty" data-id="${p.id}" />
    </div>`).join('');
  box.querySelectorAll('input[data-id]').forEach(inp =>
    inp.addEventListener('input', () => {
      const q = Math.max(0, parseInt(inp.value) || 0);
      selection[inp.dataset.id] = q;
    }));
}

async function onCalculate(mode = 'balance') {
  const num = (id) => Math.max(0, Number(document.getElementById(id).value) || 0);
  padding = {
    left:  num('lp-pad-left'),
    right: num('lp-pad-right'),
    front: num('lp-pad-front'),
    back:  num('lp-pad-back'),
  };
  const gap = num('lp-gap');
  const opts = {
    mode,
    noStack:   document.getElementById('lp-nostack').checked,
    singleRow: document.getElementById('lp-singlerow').checked,
  };
  // seçimi fiziksel palet örneklerine çoğalt
  const items = [];
  allPallets.forEach(p => {
    const q = selection[p.id] || 0;
    for (let i = 0; i < q; i++) items.push({ ...p });
  });
  if (!items.length) {
    await showAlertDialog('Lütfen en az bir palet adedi girin.', { variant: 'warn' });
    return;
  }

  const btn  = document.getElementById(mode === 'volume' ? 'lp-calc-vol' : 'lp-calc');
  const btn2 = document.getElementById(mode === 'volume' ? 'lp-calc' : 'lp-calc-vol');
  const orig = btn.innerHTML;
  btn.disabled = true; btn2.disabled = true;
  btn.style.opacity = '.7'; btn2.style.opacity = '.5';
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp; Hesaplanıyor…';

  // UI'nin durumu boyamasına izin ver (yedek GA birkaç saniye sürebilir), sonra hesapla.
  setTimeout(() => {
    const t0 = performance.now();
    lastResult = packVehicle(curVehicle, items, padding, gap, opts);
    lastResult.elapsedMs = Math.round(performance.now() - t0);
    lastResult.mode = mode;
    renderStats(lastResult);
    renderUnplaced(lastResult);
    draw3D(lastResult);
    btn.disabled = false; btn2.disabled = false;
    btn.style.opacity = '1'; btn2.style.opacity = '1';
    btn.innerHTML = orig;
  }, 30);
}

function renderStats(r) {
  const placedN = r.placed.length, totalN = placedN + r.unplaced.length;
  const remKg = r.vehicle.maxKg - r.totalKg;
  const wPct = r.vehicle.maxKg > 0 ? (r.totalKg / r.vehicle.maxKg) * 100 : 0;
  // Tercih ön dingil: yükün önde toplanması normal; arkaya kayması uyarılır.
  const comOk = r.comPct <= 55;
  const comLabel = !r.placed.length ? '' : r.comPct > 55 ? '· Arkada, kontrol et' : r.comPct < 38 ? '· Önde (ön dingil)' : '· Dengeli';
  document.getElementById('lp-stats').innerHTML = `
    <div class="lp-stat"><div class="v">${placedN}<span style="font-size:13px;color:var(--ink-2);">/${totalN}</span></div><div class="l">Yerleşen Palet · ${r.columnCount} kolon</div></div>
    <div class="lp-stat">
      <div class="v">%${r.floorPct.toFixed(1)}</div><div class="l">Taban Doluluk</div>
      <div class="lp-bar" style="margin-top:8px;"><span style="width:${Math.min(100,r.floorPct)}%"></span></div>
    </div>
    <div class="lp-stat">
      <div class="v">%${r.volPct.toFixed(1)}</div><div class="l">Hacim Doluluk</div>
      <div class="lp-bar" style="margin-top:8px;"><span style="width:${Math.min(100,r.volPct)}%"></span></div>
    </div>
    <div class="lp-stat">
      <div class="v">${fmtKg(r.totalKg)}</div>
      <div class="l">Toplam / Kalan ${fmtKg(remKg)}</div>
      <div class="lp-bar" style="margin-top:8px;"><span style="width:${Math.min(100,wPct)}%;background:${wPct>100?'#9F3D3D':'var(--accent)'}"></span></div>
    </div>
    <div class="lp-stat">
      <div class="v" style="color:${comOk?'#3D6E50':'#B58858'}">%${r.comPct.toFixed(0)}</div>
      <div class="l">Ağırlık Merkezi (boy) ${comLabel}</div>
    </div>`;
  const note = document.getElementById('lp-strategy');
  if (note) {
    note.innerHTML = `<i class="fa-solid fa-microchip"></i> Yerleşim: <b>${esc(r.strategy||'—')}</b>
      ${r.elapsedMs!=null?'· '+r.elapsedMs+' ms':''}`;
  }
}

const UNPLACED_REASONS = {
  space:  'Yer yetmedi',
  height: 'Araçtan yüksek',
  weight: 'Ağırlık sınırı aşılıyor',
};

function renderUnplaced(r) {
  const el = document.getElementById('lp-unplaced');
  if (!r.unplaced.length) { el.innerHTML = ''; return; }
  const groups = {};
  r.unplaced.forEach(u => {
    const g = (groups[u.reason] ||= {});
    g[u.name] = (g[u.name] || 0) + 1;
  });
  el.innerHTML = `<div style="font-size:12px;color:#9F3D3D;background:#9F3D3D14;border:1px solid #9F3D3D33;border-radius:9px;padding:9px 12px;display:flex;flex-direction:column;gap:4px;">
    <div><i class="fa-solid fa-triangle-exclamation"></i> <b>Yüklenemeyen ${r.unplaced.length} palet</b></div>
    ${Object.entries(groups).map(([reason, byName]) => `<div><b>${UNPLACED_REASONS[reason]}:</b> ${
      Object.entries(byName).map(([n, c]) => `${esc(n)} ×${c}`).join(', ')}</div>`).join('')}
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  THREE.JS SAHNE
// ════════════════════════════════════════════════════════════
function ensureScene() {
  if (renderer) return;
  const canvas = document.getElementById('lp-canvas');
  const wrap = canvas.parentElement;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(800, 1400, 900);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dir2.position.set(-600, 600, -800);
  scene.add(dir2);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  canvas.addEventListener('mousemove', onPointerMove);
  canvas.addEventListener('mouseleave', () => hideTip());

  const ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  function loop() {
    animId = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  loop();
}

function resize() {
  if (!renderer) return;
  const wrap = renderer.domElement.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function draw3D(r) {
  document.getElementById('lp-empty').style.display = 'none';
  ensureScene();
  resize();

  // temizle
  if (palletMeshGroup) { scene.remove(palletMeshGroup); disposeGroup(palletMeshGroup); }
  // önceki araç çerçevesi
  const old = scene.getObjectByName('vehicleGroup');
  if (old) { scene.remove(old); disposeGroup(old); }

  const V = r.vehicle;
  // Three: X = uzunluk(L), Y = yükseklik(H), Z = genişlik(W)
  // Merkezi orijine alalım.
  const offX = -V.L / 2, offZ = -V.W / 2;

  // ── Araç gövdesi (yarı şeffaf + wireframe) ──
  const vg = new THREE.Group(); vg.name = 'vehicleGroup';
  const boxGeo = new THREE.BoxGeometry(V.L, V.H, V.W);
  const shell = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({
    color: 0x2D4A3E, transparent: true, opacity: 0.06, depthWrite: false }));
  shell.position.set(0, V.H/2, 0);
  vg.add(shell);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({ color: 0x2D4A3E, transparent:true, opacity:0.55 }));
  edges.position.set(0, V.H/2, 0);
  vg.add(edges);
  // zemin grid
  const grid = new THREE.GridHelper(Math.max(V.L,V.W), 24, 0xB58858, 0xE4DDCE);
  grid.position.y = 0.5;
  vg.add(grid);
  // kapı işareti (arka = +X ucu)
  const doorMat = new THREE.MeshBasicMaterial({ color:0xB58858, transparent:true, opacity:0.25, side:THREE.DoubleSide });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(V.W, V.H), doorMat);
  door.rotation.y = Math.PI/2;
  door.position.set(V.L/2, V.H/2, 0);
  vg.add(door);
  scene.add(vg);

  // ── Paletler ──
  palletMeshGroup = new THREE.Group();
  r.placed.forEach((p, idx) => {
    const fl = p.rot ? p.W : p.L;   // X yönü (uzunluk kapladığı)
    const fw = p.rot ? p.L : p.W;   // Z yönü (genişlik kapladığı)
    const geo = new THREE.BoxGeometry(fl, p.H, fw);
    const col = weightColor(p.kg, r);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    // p.cx = uzunluk merkezi (0..L), p.cy = genişlik merkezi (0..W), p.z0 = taban
    mesh.position.set(offX + p.cx, p.z0 + p.H/2, offZ + p.cy);
    mesh.userData = { p, baseColor: col, idx: idx+1 };
    const eg = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent:true, opacity:0.18 }));
    mesh.add(eg);
    palletMeshGroup.add(mesh);
  });
  scene.add(palletMeshGroup);

  resetCamera();
}

function weightColor(kg, r) {
  const maxK = Math.max(...r.placed.map(p=>p.kg), 1);
  const t = kg / maxK;            // 0 hafif .. 1 ağır
  // hafif (açık zeytin) → ağır (koyu kiremit)
  const light = new THREE.Color('#7E9152');
  const heavy = new THREE.Color('#7A2E2E');
  return light.clone().lerp(heavy, t).getHex();
}

function resetCamera() {
  if (!camera || !lastResult) return;
  const V = lastResult.vehicle;
  const d = Math.max(V.L, V.W, V.H);
  camera.position.set(V.L*0.75, V.H*1.6 + d*0.4, V.W*1.9 + d*0.3);
  controls.target.set(0, V.H/2, 0);
  controls.update();
}

// ── Hover / tooltip ──
function onPointerMove(e) {
  if (!palletMeshGroup) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(palletMeshGroup.children, false);
  if (hovered) { hovered.material.emissive?.setHex(0x000000); hovered = null; }
  if (hits.length) {
    const m = hits[0].object;
    hovered = m;
    m.material.emissive = new THREE.Color(0xffffff);
    m.material.emissiveIntensity = 0.18;
    const p = m.userData.p;
    showTip(e, `<b>#${m.userData.idx} · ${esc(p.name)}</b><br>
      Tip: ${esc(p.type)}<br>
      Ebat: ${p.W}×${p.L}×${p.H} cm${p.rot?' (90° döndürülmüş)':''}<br>
      Ağırlık: ${fmtKg(p.kg)}<br>
      ${p.stackable?('İstiflenebilir · Katman '+p.strength):'İstiflenemez'}`);
  } else hideTip();
}
function showTip(e, html) {
  const tip = document.getElementById('lp-tip');
  const rect = renderer.domElement.getBoundingClientRect();
  tip.innerHTML = html;
  tip.style.opacity = '1';
  let x = e.clientX - rect.left + 14, y = e.clientY - rect.top + 14;
  if (x + 250 > rect.width) x = rect.width - 250;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip(){ const t=document.getElementById('lp-tip'); if(t) t.style.opacity='0'; }

function disposeGroup(g){ g.traverse(o=>{ o.geometry?.dispose?.(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose()); } }); }

// ── Yardımcılar ──
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtKg = (n) => (n==null||isNaN(n)) ? '—' : Number(n).toLocaleString('tr-TR',{maximumFractionDigits:1})+' kg';
