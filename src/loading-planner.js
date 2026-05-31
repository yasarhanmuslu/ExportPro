import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
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

// ── Operasyonel pay (padding) cm — palet etrafı boşluk ──────
const DEFAULT_PADDING = { left: 2, right: 2, front: 2, back: 2 };

const PAL_PALETTE = [
  '#2D4A3E','#B58858','#3F5C7A','#9F3D3D','#5A6E3A',
  '#7A4F3F','#3D5A6E','#6B4E7A','#4E7A5A','#7A6B3D'
];

// ── Durum ───────────────────────────────────────────────────
let session = null;
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
  await renderNavbar('loading-planner');
  buildUI();
  await fetchPallets();
});

async function fetchPallets() {
  const { data, error } = await supabase
    .from('pallet_definitions')
    .select('*')
    .eq('user_id', session.user.id)
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
//  3D BIN PACKING MOTORU (v2 — Maximal Rectangles + ön-istifleme)
//  Hedef: maksimum doluluk.
//  Kısıtlar:
//   - Paletler dik (Z sabit). Tabanda 90° döndürme serbest.
//   - Padding footprint'e eklenir.
//   - Yalnız stackable paletler üst üste; strength düşük (1) = altta/ağır,
//     üstteki strength >= alttaki, üst ağırlık <= alt ağırlık.
//   - Ağırlar zemine homojen dağıtılır; hafifler arkaya (kapıya) yönlendirilir.
//   - Tek nokta boşaltım — LIFO yok.
// ════════════════════════════════════════════════════════════

// ---- Adım 1: Paletleri dikey "kolonlara" (istif yığını) grupla ----
// Her kolon: tabanı zemine oturan 1+ palet. Footprint = en geniş tabanın
// footprint'i. Üst paletler taban footprint'ine sığmalı.
function buildColumns(items, vehicle, pad) {
  const padW = pad.left + pad.right;
  const padL = pad.front + pad.back;

  // Ağır + güçlü (strength küçük) önce → taban adayı.
  const pool = items.slice().sort((a, b) => {
    if (a.strength !== b.strength) return a.strength - b.strength; // güçlü taban
    return b.kg - a.kg;                                            // ağır önce
  });

  const used = new Array(pool.length).fill(false);
  const columns = [];

  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    const base = pool[i];
    used[i] = true;

    // taban footprint (padding dahil) — iki oryantasyon en küçük alanı seçmez,
    // yerleşim aşaması rotasyonu zaten dener; burada palet öz ölçüsünü tutarız.
    const col = {
      baseW: base.W, baseL: base.L,
      fpW: base.W + padW, fpL: base.L + padL,
      stack: [base],
      topZ: base.H,
      totalKg: base.kg,
      minStrengthTop: base.strength,   // en üstteki paletin strength'i
      topKg: base.kg,
      bottomStrength: base.strength,
    };

    // Taban istiflenebilir değilse kolon tek paletten ibaret.
    if (base.stackable) {
      // Üste eklenebilecek paletleri ara: footprint <= taban, strength >= üst,
      // ağırlık <= üsttekinden hafif veya eşit, yükseklik sınırı.
      let added = true;
      while (added) {
        added = false;
        let bestIdx = -1, bestScore = -Infinity;
        for (let j = 0; j < pool.length; j++) {
          if (used[j]) continue;
          const c = pool[j];
          if (!c.stackable) continue;
          // strength: üste konan >= alttaki (sayı büyüdükçe zayıf/üst)
          if (c.strength < col.minStrengthTop) continue;
          // ağırlık: üst <= alt
          if (c.kg > col.topKg + 0.01) continue;
          // footprint taban içine sığmalı (her iki oryantasyon)
          const fits =
            (c.W <= col.baseW + 0.01 && c.L <= col.baseL + 0.01) ||
            (c.L <= col.baseW + 0.01 && c.W <= col.baseL + 0.01);
          if (!fits) continue;
          // yükseklik
          if (col.topZ + c.H > vehicle.H + 0.01) continue;
          // skor: footprint tabana ne kadar yakınsa (boşluk az) o kadar iyi
          const area = c.W * c.L;
          const score = area - Math.abs(c.strength - col.minStrengthTop) * 1000;
          if (score > bestScore) { bestScore = score; bestIdx = j; }
        }
        if (bestIdx >= 0) {
          const c = pool[bestIdx];
          used[bestIdx] = true;
          col.stack.push(c);
          col.topZ += c.H;
          col.totalKg += c.kg;
          col.minStrengthTop = c.strength;
          col.topKg = c.kg;
          added = true;
        }
      }
    }
    columns.push(col);
  }
  return columns;
}

// ---- Adım 2: 2D yerleşim (çok-stratejili, en iyi sonucu seç) ----
// Araç tabanı L(uzunluk) × W(genişlik). Kolon tabanları en sık biçimde
// yerleştirilir. Üç strateji denenir, en çok kolon yerleştiren kazanır:
//   (a) Bottom-Left-Fill, büyük→küçük
//   (b) Bottom-Left-Fill, küçük→büyük
//   (c) Maximal-Rectangles (Best Short Side Fit)
// ════════════════════════════════════════════════════════════
//  GELİŞMİŞ SEZGİSEL YERLEŞİM MOTORU
//  Felsefe: hız değil, maksimum hacim/denge optimizasyonu.
//  Çok-başlangıçlı arama (multi-start) — birden çok sıralama tohumu ×
//  birden çok yerleştirici × her kolon için her iki rotasyon denenir;
//  en iyi skorlu çözüm seçilir. Birkaç saniye sürebilir.
//  Yerleştiriciler:
//    - Wall-Building (duvar örme): konteyner yüklemenin endüstri standardı
//    - Maximal-Rectangles (Best Short Side Fit)
//    - Bottom-Left-Fill (skyline aday noktaları)
// ════════════════════════════════════════════════════════════

// Bir çözümün kalite skoru: önce yerleşen palet sayısı, sonra taban
// doluluğu, sonra ağırlık dengesi (COM %50'ye yakınlık).
function scoreSolution(placedCols, leftover, vehicle) {
  const placedPallets = placedCols.reduce((s, pc) => s + pc.col.stack.length, 0);
  const lostPallets   = leftover.reduce((s, c) => s + c.stack.length, 0);
  const usedFloor = placedCols.reduce((s, pc) => s + pc.w * pc.h, 0);
  const floorArea = vehicle.L * vehicle.W;
  const floorPct  = floorArea > 0 ? usedFloor / floorArea : 0;

  const totalKg = placedCols.reduce((s, pc) => s + pc.col.totalKg, 0);
  let com = 0;
  if (totalKg > 0) {
    com = placedCols.reduce((s, pc) => s + (pc.x + pc.w / 2) * pc.col.totalKg, 0) / totalKg;
  }
  const comPct = vehicle.L > 0 ? com / vehicle.L : 0.5;
  const balancePenalty = Math.abs(comPct - 0.5); // 0 ideal .. 0.5 kötü

  // Ağırlıklı skor — palet sayısı baskın, sonra doluluk, sonra denge.
  return (placedPallets * 1e6)
       - (lostPallets   * 1e6)
       + (floorPct      * 1e3)
       - (balancePenalty * 50);
}

function placeColumns2D(columns, vehicle) {
  // Sıralama tohumları — kolonları farklı kriterlere göre dizer.
  const seeds = {
    'alan-azalan':      (a, b) => (b.fpW * b.fpL) - (a.fpW * a.fpL),
    'uzunkenar-azalan': (a, b) => Math.max(b.fpW, b.fpL) - Math.max(a.fpW, a.fpL) || (b.fpW * b.fpL) - (a.fpW * a.fpL),
    'uzunluk-azalan':   (a, b) => b.fpL - a.fpL || b.fpW - a.fpW,
    'genislik-azalan':  (a, b) => b.fpW - a.fpW || b.fpL - a.fpL,
    'agir-once':        (a, b) => b.totalKg - a.totalKg || (b.fpW * b.fpL) - (a.fpW * a.fpL),
    'yuksek-once':      (a, b) => b.topZ - a.topZ || (b.fpW * b.fpL) - (a.fpW * a.fpL),
  };
  const placers = [placeWallBuilding, placeMaxRects, placeBLF];

  let best = null;
  for (const [seedName, seedFn] of Object.entries(seeds)) {
    const ordered = columns.slice().sort(seedFn);
    for (const placer of placers) {
      const res = placer(ordered, vehicle);
      const sc = scoreSolution(res.placedCols, res.leftover, vehicle);
      if (!best || sc > best.score) best = { ...res, score: sc, seedName, placer: placer.name };
    }
  }
  return { placedCols: best.placedCols, leftover: best.leftover,
           strategy: `${best.placer} · ${best.seedName}` };
}

// ---- WALL-BUILDING ----
// Araç uzunluğu (X) boyunca art arda "duvarlar" örülür. Her duvar, derinliği
// (X kalınlığı) o duvardaki en derin kolona eşit bir dilimdir; duvar içinde
// kolonlar genişlik (Y) ekseninde alt-sol prensibiyle, her iki rotasyon
// denenerek olabildiğince sık dizilir. Bir kolon mevcut duvara sığmazsa
// yeni duvar açılır. Bu, derinliğin sabit kalması sorununu çözer: her duvar
// için derinlik bağımsız seçilir ve rotasyon serbestçe değerlendirilir.
function placeWallBuilding(orderedCols, vehicle) {
  const L = vehicle.L, W = vehicle.W;
  const placedCols = [], leftover = [];
  const remaining = orderedCols.slice();
  let wallX = 0; // mevcut duvarın başlangıç X'i

  while (remaining.length && wallX < L - 0.01) {
    // Duvar derinliğini, kalan ilk (öncelikli) kolonun en iyi oryantasyonuyla aç.
    // Her iki rotasyonu deneyip duvara en uygun derinliği seçeriz.
    const seed = remaining[0];
    // Duvar derinliği adayları: kolonun iki oryantasyonundan X-derinliği.
    const depthOpts = [
      Math.min(seed.fpL, seed.fpW),
      Math.max(seed.fpL, seed.fpW),
    ].filter(d => wallX + d <= L + 0.01);
    if (!depthOpts.length) { // sığmıyor
      leftover.push(remaining.shift());
      continue;
    }

    // Her derinlik adayı için duvarı doldurmayı dene, en çok dolduranı seç.
    let bestWall = null;
    for (const depth of depthOpts) {
      const trial = fillWall(remaining, vehicle, wallX, depth);
      if (!bestWall ||
          trial.filled.length > bestWall.filled.length ||
          (trial.filled.length === bestWall.filled.length && trial.usedArea > bestWall.usedArea)) {
        bestWall = { ...trial, depth };
      }
    }

    if (!bestWall || bestWall.filled.length === 0) {
      leftover.push(remaining.shift());
      continue;
    }

    // Yerleşenleri kaydet, remaining'den çıkar.
    const placedSet = new Set(bestWall.filled.map(f => f.colRef));
    bestWall.filled.forEach(f => placedCols.push(f.placed));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (placedSet.has(remaining[i])) remaining.splice(i, 1);
    }
    wallX += bestWall.depth;
  }
  // Kalanlar sığmadı.
  remaining.forEach(c => leftover.push(c));
  return { placedCols, leftover };
}

// Tek bir duvarı (wallX..wallX+depth, tüm genişlik) verilen kolonlardan doldur.
// Genişlik ekseninde alt-sol; her kolon için iki rotasyon, X-derinliği ≤ depth olan.
function fillWall(cols, vehicle, wallX, depth) {
  const W = vehicle.W;
  const filled = [];
  let usedArea = 0;
  // duvar içi serbest Y aralıkları (skyline benzeri): basit alt-sol imleç + raf.
  // Çok sıkı paketleme için duvar içinde küçük bir 2B BLF uygularız (Y×kalanX).
  const rects = []; // duvar içindeki yerleşimler {x,y,w,h}
  for (const col of cols) {
    // bu kolon zaten yerleşmişse atla (set kontrolü çağıran tarafta)
    const cands = [];
    // oryantasyon A
    if (col.fpL <= depth + 0.01) cands.push({ dx: col.fpL, dy: col.fpW, rot: false });
    // oryantasyon B (90°)
    if (col.fpW <= depth + 0.01) cands.push({ dx: col.fpW, dy: col.fpL, rot: true });
    if (!cands.length) continue;

    // aday noktalar: duvar tabanı + yerleşmişlerin köşeleri
    const points = [{ x: wallX, y: 0 }];
    rects.forEach(r => { points.push({ x: r.x, y: r.y + r.h }); points.push({ x: r.x + r.w, y: r.y }); });
    points.sort((p, q) => (p.y - q.y) || (p.x - q.x));

    let spot = null;
    outer:
    for (const pt of points) {
      for (const cd of cands) {
        if (pt.x + cd.dx > wallX + depth + 0.01) continue;
        if (pt.y + cd.dy > W + 0.01) continue;
        const test = { x: pt.x, y: pt.y, w: cd.dx, h: cd.dy };
        if (rects.some(r => rectsOverlap(r, test))) continue;
        spot = { ...test, rot: cd.rot };
        break outer;
      }
    }
    if (!spot) continue;
    rects.push({ x: spot.x, y: spot.y, w: spot.w, h: spot.h });
    usedArea += spot.w * spot.h;
    filled.push({
      colRef: col,
      placed: { col, x: spot.x, y: spot.y, w: spot.w, h: spot.h, rot: spot.rot },
    });
  }
  return { filled, usedArea };
}

// ---- MAXIMAL RECTANGLES (Best Short Side Fit) ----
function placeMaxRects(orderedCols, vehicle) {
  const W = vehicle.W, L = vehicle.L;
  let free = [{ x: 0, y: 0, w: L, h: W }];
  const placedCols = [], leftover = [];
  for (const col of orderedCols) {
    let best = null;
    for (const fr of free) {
      const cands = [
        { w: col.fpL, h: col.fpW, rot: false },
        { w: col.fpW, h: col.fpL, rot: true },
      ];
      for (const cd of cands) {
        if (cd.w <= fr.w + 0.01 && cd.h <= fr.h + 0.01) {
          const lw = fr.w - cd.w, lh = fr.h - cd.h;
          const s1 = Math.min(lw, lh), s2 = Math.max(lw, lh);
          if (!best || s1 < best.s1 || (s1 === best.s1 && s2 < best.s2)) {
            best = { x: fr.x, y: fr.y, w: cd.w, h: cd.h, rot: cd.rot, s1, s2 };
          }
        }
      }
    }
    if (!best) { leftover.push(col); continue; }
    placedCols.push({ col, x: best.x, y: best.y, w: best.w, h: best.h, rot: best.rot });
    const used = { x: best.x, y: best.y, w: best.w, h: best.h };
    const next = [];
    for (const fr of free) {
      if (!rectsOverlap(fr, used)) { next.push(fr); continue; }
      if (used.x > fr.x) next.push({ x: fr.x, y: fr.y, w: used.x - fr.x, h: fr.h });
      if (used.x + used.w < fr.x + fr.w) next.push({ x: used.x + used.w, y: fr.y, w: (fr.x + fr.w) - (used.x + used.w), h: fr.h });
      if (used.y > fr.y) next.push({ x: fr.x, y: fr.y, w: fr.w, h: used.y - fr.y });
      if (used.y + used.h < fr.y + fr.h) next.push({ x: fr.x, y: used.y + used.h, w: fr.w, h: (fr.y + fr.h) - (used.y + used.h) });
    }
    free = pruneFree(next);
  }
  return { placedCols, leftover };
}

// ---- BOTTOM-LEFT-FILL ----
function placeBLF(orderedCols, vehicle) {
  const L = vehicle.L, W = vehicle.W;
  const placedCols = [], leftover = [];
  const rects = [];
  for (const col of orderedCols) {
    const cands = [
      { w: col.fpL, h: col.fpW, rot: false },
      { w: col.fpW, h: col.fpL, rot: true },
    ];
    const points = [{ x: 0, y: 0 }];
    rects.forEach(r => { points.push({ x: r.x + r.w, y: r.y }); points.push({ x: r.x, y: r.y + r.h }); });
    points.sort((p, q) => (p.y - q.y) || (p.x - q.x));
    let spot = null;
    outer:
    for (const pt of points) {
      for (const cd of cands) {
        if (pt.x + cd.w > L + 0.01 || pt.y + cd.h > W + 0.01) continue;
        const test = { x: pt.x, y: pt.y, w: cd.w, h: cd.h };
        if (rects.some(r => rectsOverlap(r, test))) continue;
        spot = { ...test, rot: cd.rot };
        break outer;
      }
    }
    if (!spot) { leftover.push(col); continue; }
    rects.push({ x: spot.x, y: spot.y, w: spot.w, h: spot.h });
    placedCols.push({ col, x: spot.x, y: spot.y, w: spot.w, h: spot.h, rot: spot.rot });
  }
  return { placedCols, leftover };
}

function rectsOverlap(a, b) {
  return !(b.x >= a.x + a.w - 0.01 || b.x + b.w <= a.x + 0.01 ||
           b.y >= a.y + a.h - 0.01 || b.y + b.h <= a.y + 0.01);
}
function pruneFree(list) {
  const out = list.filter(r => r.w > 0.5 && r.h > 0.5);
  const keep = [];
  for (let i = 0; i < out.length; i++) {
    let contained = false;
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue;
      const a = out[i], b = out[j];
      if (a.x >= b.x - 0.01 && a.y >= b.y - 0.01 &&
          a.x + a.w <= b.x + b.w + 0.01 && a.y + a.h <= b.y + b.h + 0.01) { contained = true; break; }
    }
    if (!contained) keep.push(out[i]);
  }
  return keep;
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

function packVehicle(vehicle, items, pad) {
  const columns = buildColumns(items, vehicle, pad);
  const placement = placeColumns2D(columns, vehicle);
  const { placedCols, leftover } = placement;
  rebalance(placedCols);

  const placed = [];
  const unplaced = [];
  leftover.forEach(col => col.stack.forEach(it => unplaced.push(it)));

  placedCols.forEach(pc => {
    const col = pc.col;
    let z0 = 0;
    col.stack.forEach((it) => {
      const cx = pc.x + pc.w / 2;
      const cy = pc.y + pc.h / 2;
      placed.push(makePlaced(it, cx, cy, z0, pc.rot, pad));
      z0 += it.H;
    });
  });

  const totalKg = placed.reduce((s, p) => s + p.kg, 0);
  const usedVol = placed.reduce((s, p) => s + (p.W * p.L * p.H), 0);
  const vehVol  = vehicle.L * vehicle.W * vehicle.H;
  const com = totalKg > 0 ? placed.reduce((s, p) => s + p.cx * p.kg, 0) / totalKg : 0;
  const floorArea = vehicle.L * vehicle.W;
  const usedFloor = placedCols.reduce((s, pc) => s + pc.w * pc.h, 0);

  return {
    vehicle, placed, unplaced,
    totalKg,
    volPct: vehVol > 0 ? (usedVol / vehVol) * 100 : 0,
    floorPct: floorArea > 0 ? (usedFloor / floorArea) * 100 : 0,
    columnCount: placedCols.length,
    strategy: placement.strategy,
    com, comPct: vehicle.L > 0 ? (com / vehicle.L) * 100 : 0,
  };
}

function makePlaced(it, cx, cy, z0, rot, pad) {
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
    <div style="display:grid;grid-template-columns:320px 1fr;gap:18px;align-items:start;">
      <!-- SOL PANEL -->
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="lp-card" style="padding:16px;">
          <label style="font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;">Taşıyıcı Araç</label>
          <select id="lp-vehicle" style="width:100%;margin-top:8px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--ink-1);font-size:13px;">
            ${VEHICLES.map(v => `<option value="${v.id}">${v.name}</option>`).join('')}
          </select>
          <div id="lp-veh-dims" style="margin-top:10px;font-size:12px;color:var(--ink-2);"></div>
          <div id="lp-custom-box" class="hidden" style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${['L','W','H','maxKg'].map(k => `
              <label style="font-size:11px;color:var(--ink-2);">${({L:'Boy (cm)',W:'En (cm)',H:'Yük. (cm)',maxKg:'Max (kg)'})[k]}
                <input id="lp-c-${k}" type="number" class="lp-qty" style="width:100%;margin-top:3px;" />
              </label>`).join('')}
          </div>
        </div>

        <div class="lp-card" style="padding:16px;">
          <label style="font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;">Operasyonel Pay — Padding (cm)</label>
          <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${['left','right','front','back'].map(k => `
              <label style="font-size:11px;color:var(--ink-2);">${({left:'Sol',right:'Sağ',front:'Ön',back:'Arka'})[k]}
                <input id="lp-pad-${k}" type="number" value="${DEFAULT_PADDING[k]}" class="lp-qty" style="width:100%;margin-top:3px;" />
              </label>`).join('')}
          </div>
        </div>

        <div class="lp-card" style="padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;">Paletler</label>
            <button id="lp-refresh" class="lp-chip" title="Yenile"><i class="fa-solid fa-rotate"></i></button>
          </div>
          <div id="lp-pallet-list" style="margin-top:10px;max-height:340px;overflow:auto;"></div>
        </div>

        <button id="lp-calc" style="padding:12px;border:none;border-radius:11px;background:var(--accent);color:#fff;font-size:14px;font-weight:700;cursor:pointer;">
          <i class="fa-solid fa-cubes-stacked"></i>&nbsp; Yerleşimi Hesapla
        </button>
      </div>

      <!-- SAĞ PANEL -->
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div id="lp-stats" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;"></div>
        <div id="lp-strategy" style="font-size:11px;color:var(--ink-2);padding:0 2px;"></div>
        <div class="lp-card" style="position:relative;padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <span class="lp-legend"><i style="background:#9F3D3D;"></i>Ağır</span>
              <span class="lp-legend"><i style="background:#B58858;"></i>Orta</span>
              <span class="lp-legend"><i style="background:#5A6E3A;"></i>Hafif</span>
              <span class="lp-legend"><i style="background:rgba(45,74,62,.18);"></i>Araç gövdesi</span>
            </div>
            <button id="lp-reset-cam" class="lp-chip"><i class="fa-solid fa-arrows-to-dot"></i> Kamerayı sıfırla</button>
          </div>
          <div style="position:relative;height:560px;background:var(--bg);border-radius:12px;overflow:hidden;">
            <canvas id="lp-canvas"></canvas>
            <div id="lp-tip" class="lp-tip"></div>
            <div id="lp-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--ink-2);font-size:14px;text-align:center;padding:20px;">
              Palet seçip <b>&nbsp;Yerleşimi Hesapla&apos;ya&nbsp;</b> basın.
            </div>
          </div>
          <div id="lp-unplaced" style="margin-top:10px;"></div>
        </div>
      </div>
    </div>`;

  document.getElementById('lp-vehicle').addEventListener('change', onVehicleChange);
  document.getElementById('lp-refresh').addEventListener('click', fetchPallets);
  document.getElementById('lp-calc').addEventListener('click', onCalculate);
  document.getElementById('lp-reset-cam').addEventListener('click', resetCamera);
  ['L','W','H','maxKg'].forEach(k =>
    document.getElementById(`lp-c-${k}`).addEventListener('input', readCustom));
  onVehicleChange();
}

function onVehicleChange() {
  const id = document.getElementById('lp-vehicle').value;
  const v = VEHICLES.find(x => x.id === id);
  curVehicle = { ...v };
  document.getElementById('lp-custom-box').classList.toggle('hidden', id !== 'custom');
  if (id === 'custom') {
    ['L','W','H','maxKg'].forEach(k => { document.getElementById(`lp-c-${k}`).value = v[k]; });
  }
  document.getElementById('lp-veh-dims').textContent =
    `İç ölçü: ${v.L} × ${v.W} × ${v.H} cm · Max ${(v.maxKg/1000).toLocaleString('tr-TR')} ton`;
}
function readCustom() {
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

function onCalculate() {
  padding = {
    left:  Number(document.getElementById('lp-pad-left').value)  || 0,
    right: Number(document.getElementById('lp-pad-right').value) || 0,
    front: Number(document.getElementById('lp-pad-front').value) || 0,
    back:  Number(document.getElementById('lp-pad-back').value)  || 0,
  };
  // seçimi fiziksel palet örneklerine çoğalt
  const items = [];
  allPallets.forEach(p => {
    const q = selection[p.id] || 0;
    for (let i = 0; i < q; i++) items.push({ ...p });
  });
  if (!items.length) { alert('Lütfen en az bir palet adedi girin.'); return; }

  const btn = document.getElementById('lp-calc');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '.7';
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>&nbsp; Optimize ediliyor…';

  // UI'nin "optimize ediliyor" durumunu boyamasına izin ver, sonra hesapla.
  setTimeout(() => {
    const t0 = performance.now();
    lastResult = packVehicle(curVehicle, items, padding);
    lastResult.elapsedMs = Math.round(performance.now() - t0);
    renderStats(lastResult);
    renderUnplaced(lastResult);
    draw3D(lastResult);
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.innerHTML = orig;
  }, 30);
}

function renderStats(r) {
  const placedN = r.placed.length, totalN = placedN + r.unplaced.length;
  const remKg = r.vehicle.maxKg - r.totalKg;
  const wPct = r.vehicle.maxKg > 0 ? (r.totalKg / r.vehicle.maxKg) * 100 : 0;
  const balanced = Math.abs(r.comPct - 50) <= 12;
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
      <div class="v" style="color:${balanced?'#3D6E50':'#B58858'}">%${r.comPct.toFixed(0)}</div>
      <div class="l">Ağırlık Merkezi (boy) ${balanced?'· Dengeli':'· Kontrol et'}</div>
    </div>`;
  const note = document.getElementById('lp-strategy');
  if (note) {
    note.innerHTML = `<i class="fa-solid fa-microchip"></i> En iyi strateji: <b>${esc(r.strategy||'—')}</b>
      · ${r.elapsedMs!=null?r.elapsedMs+' ms':''} · çok-başlangıçlı sezgisel arama (duvar örme · maksimal dikdörtgen · alt-sol)`;
  }
}

function renderUnplaced(r) {
  const el = document.getElementById('lp-unplaced');
  if (!r.unplaced.length) { el.innerHTML = ''; return; }
  const byName = {};
  r.unplaced.forEach(u => byName[u.name] = (byName[u.name]||0)+1);
  el.innerHTML = `<div style="font-size:12px;color:#9F3D3D;background:#9F3D3D14;border:1px solid #9F3D3D33;border-radius:9px;padding:9px 12px;">
    <i class="fa-solid fa-triangle-exclamation"></i> Sığmayan ${r.unplaced.length} palet: ${
      Object.entries(byName).map(([n,c])=>`${esc(n)} ×${c}`).join(', ')}</div>`;
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
