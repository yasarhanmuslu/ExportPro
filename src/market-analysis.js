// Pazar Analizi — ülke / bölge bazında satış görünümü
//
// Soru: "Hangi pazarlara, kaç müşteriye, ne kadar satıyoruz; hangi ürün
// türleri nereye gidiyor; müşterisi olup sipariş gelmeyen pazarlar hangileri?"
//
// Kapsam ve ölçüler diğer modüllerle aynı:
//   • Ciro = sipariş tutarı (orders.total_amount) — Dashboard Toplam Ciro ve
//     Müşteri Skoru ile aynı; iptal ve bedelsiz siparişler hariç (receivables.js).
//     Para birimleri asla toplanmaz, kur çevrimi yok.
//   • Adet ve ürün türü kırılımı sipariş kalemlerinden (order_items), ürün
//     kataloğuna productIdentity.js ile bağlanarak — Ürün Analizi ile aynı.
//   • Bölge customerHelpers.getRegion (Müşteriler / Arama Rotasyonu ile aynı
//     harita); yalnız Türkiye burada "İç Piyasa" olarak ayrı tutulur.
//   • Credit Note: iptal edilenler hariç, cn_date yılına göre.
//
// NOT (05.10.2026): Eski sürüm para birimlerini toplayıp "USD" yazıyordu ve
// var olmayan customers.history_date kolonunu sorguladığı için hiç açılmıyordu.

import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess } from './utils/permissions.js';
import { getRegion } from './utils/customerHelpers.js';
import { isCancelled, isFreeShipment, orderTags } from './utils/receivables.js';
import { buildProductIndex, resolveProduct, productKey } from './utils/productIdentity.js';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
const CURRENCY_ORDER   = ['EUR', 'USD', 'TRY', 'GBP'];

const DOMESTIC_KEY    = 'TÜRKİYE';
const DOMESTIC_REGION = 'İç Piyasa';
const NO_COUNTRY      = '(Ülke girilmemiş)';
const NOT_IN_CATALOG  = '(Katalogda yok)';
const UNSPECIFIED     = '(Belirtilmemiş)';

const REGION_ORDER = ['Avrupa', 'Orta Doğu', 'Afrika', 'Asya', DOMESTIC_REGION, 'Diğer'];

const MAX_MONTHS = 24;

// Siparişler sisteme fiilen Kasım 2025'ten itibaren girildi (Müşteri Skoru ile aynı tarih).
// İlk tam yılın (2026) bütün pazarları "yeni" görünür; "yeni pazar" ancak sonraki
// yıllarda anlamlı, o yüzden 2027'den önce gösterilmez.
const ORDER_DATA_START = '2025-11-01';
const FIRST_COMPARABLE_YEAR = String(Number(ORDER_DATA_START.slice(0, 4)) + 2);

const GROUPINGS = {
    country: { label: 'Ülke' },
    region:  { label: 'Bölge → Ülke' },
};

const STATUS_BADGE = { Aktif: 'b-ok', Potansiyel: 'b-info', Pasif: 'b-muted' };

// ── Durum ────────────────────────────────────────────────────────────────────

let ctx = null;
let raw = { orders: [], items: [], products: [], customers: [], creditNotes: [] };
let productIndex = null;
let customerById = new Map();
let orderById = new Map();
let itemsByOrder = new Map();
let lastOrderEver = new Map();   // ülke anahtarı -> en son sipariş tarihi (tüm yıllar)
let custLastOrder = new Map();   // müşteri -> en son sipariş tarihi (tüm yıllar)
let filters = { year: 'ALL', currency: 'ALL', grouping: 'country', hideDomestic: false };

// ── Detay penceresi (Ürün Analizi ile aynı yığın mantığı) ────────────────────

let detailRegistry = new Map();
let detailSeq = 0;
let detailStack = [];

function regDetail(payload) {
    const id = 'd' + (++detailSeq);
    detailRegistry.set(id, payload);
    return id;
}

function showDetail(payload) {
    document.getElementById('detail-title').textContent = payload.title || '';
    document.getElementById('detail-sub').innerHTML = payload.subtitle || '';
    document.getElementById('detail-body').innerHTML =
        typeof payload.html === 'function' ? payload.html() : (payload.html || '');
    document.getElementById('detail-body').scrollTop = 0;
    document.getElementById('detail-back').classList.toggle('show', detailStack.length > 1);
    document.getElementById('detail-overlay').classList.add('active');
}

function openDetail(payload) {
    detailStack.push(payload);
    showDetail(payload);
}

function backDetail() {
    if (detailStack.length < 2) return;
    detailStack.pop();
    showDetail(detailStack[detailStack.length - 1]);
}

function closeDetail() {
    detailStack = [];
    document.getElementById('detail-overlay')?.classList.remove('active');
}

function initDetailUI() {
    document.getElementById('detail-close')?.addEventListener('click', closeDetail);
    document.getElementById('detail-back')?.addEventListener('click', backDetail);
    document.getElementById('detail-overlay')?.addEventListener('click', e => {
        if (e.target.id === 'detail-overlay') closeDetail();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
    document.addEventListener('click', e => {
        const toggle = e.target.closest('[data-toggle]');
        if (toggle && !e.target.closest('[data-detail]')) {
            toggleGroup(toggle);
            return;
        }
        const el = e.target.closest('[data-detail]');
        if (!el) return;
        const payload = detailRegistry.get(el.dataset.detail);
        if (payload) openDetail(payload);
    });
}

function toggleGroup(row) {
    const id = row.dataset.toggle;
    const open = !row.classList.contains('open');
    row.classList.toggle('open', open);
    document.querySelectorAll(`tr[data-parent="${id}"]`).forEach(tr => tr.classList.toggle('hidden-row', !open));
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'market-analysis'))) return;

    await renderNavbar('market-analysis', ctx);
    initDetailUI();

    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
        const icon = document.querySelector('#btn-refresh i');
        icon?.classList.add('fa-spin');
        await loadAllData();
        icon?.classList.remove('fa-spin');
    });

    document.getElementById('f-year')?.addEventListener('change', e => {
        filters.year = e.target.value;
        renderAll();
    });

    document.getElementById('f-domestic')?.addEventListener('change', e => {
        filters.hideDomestic = e.target.checked;
        renderAll();
    });

    buildGroupingOptions();
    await loadAllData();
});

// ── Veri çekme ───────────────────────────────────────────────────────────────

// PostgREST sorgu başına 1000 satırda sessizce keser — tüm okumalar sayfalanır.
async function fetchAll(table, columns, { owned = true } = {}) {
    const PAGE = 1000;
    let from = 0;
    let out = [];
    for (;;) {
        let q = supabase.from(table).select(columns);
        if (owned) q = q.eq('user_id', ctx.ownerId);
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data || [];
        out = out.concat(batch);
        if (batch.length < PAGE) break;
        from += PAGE;
    }
    return out;
}

async function loadAllData() {
    hideError();
    try {
        const [orders, items, products, customers, creditNotes] = await Promise.all([
            fetchAll('orders', 'id, customer_id, order_date, order_number, total_amount, currency, payment_method, status_tags, order_status'),
            fetchAll('order_items', 'id, order_id, product_id, product_name, product_code, quantity, unit_price, currency'),
            fetchAll('urunler', 'id, stok_kodu, stok_adi_1, urun_turu, seri_adi', { owned: false }),
            fetchAll('customers', 'id, company_name, country, region, status, client_group'),
            fetchAll('credit_notes', 'id, customer_id, cn_date, cn_no, process_status'),
        ]);

        raw = { orders, items, products, customers, creditNotes };
        customerById = new Map(customers.map(c => [c.id, c]));
        orderById = new Map(orders.map(o => [o.id, o]));
        productIndex = buildProductIndex(products);
        itemsByOrder = new Map();
        items.forEach(it => {
            if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
            itemsByOrder.get(it.order_id).push(it);
        });

        // "Son sipariş" — filtreden bağımsız (siparişsiz pazarlarda ne zamandır sessiz?)
        lastOrderEver = new Map();
        custLastOrder = new Map();
        orders.forEach(o => {
            if (isCancelled(o) || isFreeShipment(o)) return;
            const d = isoDate(o.order_date);
            if (!d) return;
            const k = countryOf(customerById.get(o.customer_id)).key;
            if (!lastOrderEver.has(k) || d > lastOrderEver.get(k)) lastOrderEver.set(k, d);
            if (!custLastOrder.has(o.customer_id) || d > custLastOrder.get(o.customer_id)) custLastOrder.set(o.customer_id, d);
        });

        buildFilterOptions();
        renderAll();
    } catch (err) {
        console.error('Pazar Analizi yükleme hatası:', err);
        showError(err.message || String(err));
    }
}

// ── Filtreler ────────────────────────────────────────────────────────────────

function buildFilterOptions() {
    const years = [...new Set(raw.orders.map(o => isoDate(o.order_date).slice(0, 4)).filter(Boolean))].sort().reverse();
    if (filters.year !== 'ALL' && !years.includes(filters.year)) filters.year = 'ALL';

    const yearSel = document.getElementById('f-year');
    if (yearSel) {
        yearSel.innerHTML = `<option value="ALL">Tüm yıllar</option>` +
            years.map(y => `<option value="${y}">${y}</option>`).join('');
        yearSel.value = filters.year;
    }

    const used = new Set(raw.orders.map(o => o.currency || 'EUR'));
    const currencies = sortCurrencies([...used]);
    if (filters.currency !== 'ALL' && !currencies.includes(filters.currency)) filters.currency = 'ALL';

    const curWrap = document.getElementById('f-currency');
    if (curWrap) {
        curWrap.innerHTML = ['ALL', ...currencies].map(c => `
            <button type="button" data-cur="${c}" class="${filters.currency === c ? 'active' : ''}">
                ${c === 'ALL' ? 'Tümü' : `${c} ${CURRENCY_SYMBOLS[c] || ''}`}
            </button>`).join('');
        curWrap.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                filters.currency = btn.dataset.cur;
                curWrap.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
                renderAll();
            });
        });
    }
}

function buildGroupingOptions() {
    const wrap = document.getElementById('f-group');
    if (!wrap) return;
    wrap.innerHTML = Object.entries(GROUPINGS).map(([id, g]) => `
        <button type="button" data-grp="${id}" class="${filters.grouping === id ? 'active' : ''}">${escHtml(g.label)}</button>`).join('');
    wrap.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            filters.grouping = btn.dataset.grp;
            wrap.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
            renderAll();
        });
    });
}

// Ülke anahtarı Türkçe büyük harfle (İ/ı doğru katlansın), görünen ad kayıttaki hâli.
function countryOf(customer) {
    const name = String(customer?.country || '').trim();
    if (!name) return { key: NO_COUNTRY, name: NO_COUNTRY };
    return { key: name.toLocaleUpperCase('tr-TR'), name };
}

function regionOf(countryKey, customer) {
    if (countryKey === DOMESTIC_KEY) return DOMESTIC_REGION;
    if (countryKey === NO_COUNTRY) return 'Diğer';
    const r = getRegion(customer?.country);
    return r !== 'Diğer' ? r : (customer?.region || 'Diğer');
}

function inScopeCountry(key) {
    return !(filters.hideDomestic && key === DOMESTIC_KEY);
}

function orderEligible(o) {
    if (!o || isCancelled(o) || isFreeShipment(o)) return false;
    if (filters.year !== 'ALL' && isoDate(o.order_date).slice(0, 4) !== filters.year) return false;
    if (filters.currency !== 'ALL' && (o.currency || 'EUR') !== filters.currency) return false;
    return inScopeCountry(countryOf(customerById.get(o.customer_id)).key);
}

function cnEligible(cn) {
    if (cn.process_status === 'İptal') return false;
    if (filters.year !== 'ALL' && isoDate(cn.cn_date).slice(0, 4) !== filters.year) return false;
    return inScopeCountry(countryOf(customerById.get(cn.customer_id)).key);
}

// ── Toplama ──────────────────────────────────────────────────────────────────

function newAgg() {
    return {
        orders: [], customers: new Set(), revenue: new Map(), qty: 0,
        lines: [], cns: [], first: null, last: null,
    };
}

function addOrder(agg, o) {
    const cur = o.currency || 'EUR';
    agg.orders.push(o);
    if (o.customer_id) agg.customers.add(o.customer_id);
    agg.revenue.set(cur, (agg.revenue.get(cur) || 0) + (Number(o.total_amount) || 0));
    const d = isoDate(o.order_date);
    if (d) {
        if (!agg.last || d > agg.last) agg.last = d;
        if (!agg.first || d < agg.first) agg.first = d;
    }
    (itemsByOrder.get(o.id) || []).forEach(it => {
        const qty = Number(it.quantity) || 0;
        const unitPrice = Number(it.unit_price) || 0;
        agg.qty += qty;
        agg.lines.push({
            qty,
            revenue: qty * unitPrice,
            currency: it.currency || cur,
            product: resolveProduct(productIndex, it),
            key: productKey(productIndex, it),
        });
    });
}

function mergeAgg(target, src) {
    target.orders.push(...src.orders);
    src.customers.forEach(c => target.customers.add(c));
    src.revenue.forEach((v, c) => target.revenue.set(c, (target.revenue.get(c) || 0) + v));
    target.qty += src.qty;
    target.lines.push(...src.lines);
    target.cns.push(...src.cns);
    if (src.last && (!target.last || src.last > target.last)) target.last = src.last;
    if (src.first && (!target.first || src.first < target.first)) target.first = src.first;
}

// Ülke kayıtları: kayıtlı müşteriler + dönem siparişleri + credit note'lar.
function buildMarkets() {
    const markets = new Map();
    const get = (customer) => {
        const { key, name } = countryOf(customer);
        if (!markets.has(key)) {
            markets.set(key, { key, name, region: regionOf(key, customer), registered: [], agg: newAgg() });
        }
        return markets.get(key);
    };

    raw.customers.forEach(c => {
        const m = get(c);
        if (inScopeCountry(m.key)) m.registered.push(c);
    });
    raw.orders.forEach(o => {
        if (!orderEligible(o)) return;
        addOrder(get(customerById.get(o.customer_id)).agg, o);
    });
    raw.creditNotes.forEach(cn => {
        if (!cnEligible(cn)) return;
        get(customerById.get(cn.customer_id)).agg.cns.push(cn);
    });

    const all = [...markets.values()].filter(m => inScopeCountry(m.key));
    return {
        active: all.filter(m => m.agg.orders.length > 0),
        idle:   all.filter(m => m.agg.orders.length === 0 && m.registered.length > 0),
    };
}

// Pay ölçüsü: tek para birimi seçiliyse o para birimindeki ciro, "Tümü"de adet
// (adet para biriminden bağımsızdır; ciro toplanamaz).
function measure(agg) {
    return filters.currency === 'ALL' ? agg.qty : (agg.revenue.get(filters.currency) || 0);
}

function sortMarkets(list) {
    return list.sort((a, b) =>
        measure(b.agg) - measure(a.agg) ||
        b.agg.orders.length - a.agg.orders.length ||
        a.name.localeCompare(b.name, 'tr'));
}

// Siparişsiz ülkeler de bölgenin kayıtlı müşteri ve CN sayısına girer (satır olarak değil).
function buildRegions(active, idle) {
    const regions = new Map();
    active.forEach(m => {
        if (!regions.has(m.region)) regions.set(m.region, { name: m.region, markets: [], idleCount: 0, registered: [], agg: newAgg() });
        const r = regions.get(m.region);
        r.markets.push(m);
        r.registered.push(...m.registered);
        mergeAgg(r.agg, m.agg);
    });
    idle.forEach(m => {
        const r = regions.get(m.region);
        if (!r) return;
        r.idleCount++;
        r.registered.push(...m.registered);
        mergeAgg(r.agg, m.agg);
    });
    return [...regions.values()]
        .map(r => ({ ...r, markets: sortMarkets(r.markets) }))
        .sort((a, b) => measure(b.agg) - measure(a.agg) ||
            REGION_ORDER.indexOf(a.name) - REGION_ORDER.indexOf(b.name));
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
    detailRegistry = new Map();
    detailSeq = 0;
    closeDetail();

    const { active, idle } = buildMarkets();
    sortMarkets(active);

    const total = newAgg();
    active.forEach(m => mergeAgg(total, m.agg));

    renderFilterSummary(total);
    renderStats(active, idle, total);
    renderTable(active, idle, total);
    renderIdle(idle);
}

function renderFilterSummary(total) {
    const el = document.getElementById('filter-summary');
    if (el) el.textContent = `${total.orders.length.toLocaleString('tr-TR')} sipariş · ${total.lines.length.toLocaleString('tr-TR')} kalem`;
    const hint = document.getElementById('share-hint');
    if (hint) {
        hint.innerHTML = filters.currency === 'ALL'
            ? '<strong>Pay</strong> çubuğu adede göredir (para birimleri karışmasın diye); tek para birimi seçince ciroya göre olur.'
            : `<strong>Pay</strong> çubuğu ${escHtml(filters.currency)} ciroya göredir.`;
    }
}

function renderStats(active, idle, total) {
    const el = document.getElementById('stats');
    if (!el) return;

    const regions = new Set(active.map(m => m.region));
    const registeredCountries = active.length + idle.length;

    // Yeni pazar: ilk siparişi (tüm yıllar, iptal/bedelsiz hariç) seçili yılda olan ülke.
    let newMarkets = null;
    if (filters.year !== 'ALL' && filters.year >= FIRST_COMPARABLE_YEAR) {
        const firstEver = new Map();
        raw.orders.forEach(o => {
            if (isCancelled(o) || isFreeShipment(o)) return;
            const d = isoDate(o.order_date);
            if (!d) return;
            const k = countryOf(customerById.get(o.customer_id)).key;
            if (!firstEver.has(k) || d < firstEver.get(k)) firstEver.set(k, d);
        });
        newMarkets = active.filter(m => (firstEver.get(m.key) || '').slice(0, 4) === filters.year);
    }

    // Para birimi başına en büyük pazar
    const leaders = sortCurrencies([...total.revenue.keys()]).map(cur => {
        let best = null;
        active.forEach(m => {
            const v = m.agg.revenue.get(cur) || 0;
            if (v > 0 && (!best || v > best.v)) best = { m, v };
        });
        if (!best) return '';
        const pct = (best.v / total.revenue.get(cur)) * 100;
        return `<div>${escHtml(cur)}: <b>${escHtml(best.m.name)}</b> %${trNum(pct, 0)}</div>`;
    }).join('');

    const cnTop = [...active, ...idle].filter(m => m.agg.cns.length)
        .sort((a, b) => b.agg.cns.length - a.agg.cns.length)[0];
    const cnTotal = [...active, ...idle].reduce((s, m) => s + m.agg.cns.length, 0);

    el.innerHTML = `
        <div class="stat">
            <div class="stat-label">Aktif Pazar</div>
            <div class="stat-value">${active.length} <small>/ ${registeredCountries} ülke</small></div>
            <div class="stat-sub">${regions.size} bölge · ${idle.length} ülkede müşteri var, sipariş yok${newMarkets
                ? `<br>${newMarkets.length} yeni pazar (ilk siparişi ${filters.year})` : ''}</div>
        </div>
        <div class="stat">
            <div class="stat-label">Sipariş / Müşteri</div>
            <div class="stat-value">${total.orders.length} <small>/ ${total.customers.size}</small></div>
            <div class="stat-sub">${fmtDate(total.first)} – ${fmtDate(total.last)}<br>${total.qty.toLocaleString('tr-TR')} adet</div>
        </div>
        <div class="stat">
            <div class="stat-label">Ciro (para birimi bazında)</div>
            <div class="stat-money">${moneyLines(total.revenue) || '—'}</div>
        </div>
        <div class="stat">
            <div class="stat-label">En Büyük Pazar</div>
            <div class="stat-lines">${leaders || '—'}</div>
        </div>
        <div class="stat">
            <div class="stat-label">Credit Note</div>
            <div class="stat-value">${cnTotal}</div>
            <div class="stat-sub">${cnTop ? `En çok: ${escHtml(cnTop.name)} (${cnTop.agg.cns.length})` : 'Dönemde kayıt yok'}</div>
        </div>`;
}

function renderTable(active, idle, total) {
    const body = document.getElementById('mk-body');
    const count = document.getElementById('mk-count');
    if (count) count.textContent = `${active.length} pazar`;
    if (!active.length) {
        body.innerHTML = `<div class="empty">Seçili filtrelerde sipariş yok.</div>`;
        return;
    }

    const totalMeasure = active.reduce((s, m) => s + measure(m.agg), 0);
    const rows = [];

    if (filters.grouping === 'region') {
        buildRegions(active, idle).forEach((r, ri) => {
            const gid = 'r' + ri;
            const detailId = regDetail(marketPayload({
                title: r.name, kind: 'region', agg: r.agg, registered: r.registered, markets: r.markets,
            }));
            rows.push(`
                <tr class="l1" data-toggle="${gid}">
                    <td>
                        <span class="caret"><i class="fa-solid fa-chevron-right"></i></span>
                        <span class="g-name">${escHtml(r.name)}</span><span class="g-meta">${r.markets.length} ülke${r.idleCount ? ` · +${r.idleCount} siparişsiz` : ''}</span>
                    </td>
                    ${metricCells(r.agg, r.registered.length, totalMeasure, total)}
                    <td style="text-align:right;">
                        <button type="button" class="icon-btn" data-detail="${detailId}" title="Bölge detayı">
                            <i class="fa-solid fa-magnifying-glass"></i> Detay
                        </button>
                    </td>
                </tr>`);
            r.markets.forEach(m => {
                rows.push(`
                    <tr class="l2 hidden-row" data-parent="${gid}" data-detail="${regDetail(countryPayload(m))}">
                        <td><span class="g-name">${escHtml(m.name)}</span></td>
                        ${metricCells(m.agg, m.registered.length, totalMeasure, total)}
                        <td style="text-align:right;"><i class="fa-solid fa-chevron-right" style="font-size:9px;color:var(--ink-3);"></i></td>
                    </tr>`);
            });
        });
    } else {
        active.forEach(m => {
            rows.push(`
                <tr class="l1" data-detail="${regDetail(countryPayload(m))}">
                    <td>
                        <span class="g-name">${escHtml(m.name)}</span>
                        <span class="g-meta">${escHtml(m.region)}</span>
                    </td>
                    ${metricCells(m.agg, m.registered.length, totalMeasure, total)}
                    <td style="text-align:right;"><i class="fa-solid fa-chevron-right" style="font-size:9px;color:var(--ink-3);"></i></td>
                </tr>`);
        });
    }

    const shareLabel = filters.currency === 'ALL' ? 'Pay (adet)' : `Pay (${filters.currency})`;
    body.innerHTML = `
        <table class="mk-table">
            <thead><tr>
                <th>${filters.grouping === 'region' ? 'Bölge <span style="text-transform:none;letter-spacing:0;font-weight:400;">› Ülke</span>' : 'Ülke'}</th>
                <th class="r" title="Dönemde sipariş veren / kayıtlı müşteri">Müşteri</th>
                <th class="r">Sipariş</th>
                <th class="r">Adet</th>
                <th>${shareLabel}</th>
                <th class="r">Ciro</th>
                <th class="r" title="İptal edilmemiş Credit Note sayısı">CN</th>
                <th class="r">Son Sipariş</th>
                <th></th>
            </tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>`;
}

function metricCells(agg, registeredCount, totalMeasure, total) {
    const pct = totalMeasure > 0 ? (measure(agg) / totalMeasure) * 100 : 0;
    return `
        <td class="num">${agg.customers.size} <span style="color:var(--ink-3);">/ ${registeredCount}</span></td>
        <td class="num" style="font-weight:600;">${agg.orders.length}</td>
        <td class="num">${agg.qty.toLocaleString('tr-TR')}</td>
        <td>
            <div class="share">
                <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%;"></div></div>
                <span class="share-pct">%${trNum(pct, 1)}</span>
            </div>
        </td>
        <td class="num money-lines">${moneyLines(agg.revenue, '<br>', total.revenue)}</td>
        <td class="num">${agg.cns.length ? `<span class="badge b-warn">${agg.cns.length}</span>` : '<span style="color:var(--ink-3);">—</span>'}</td>
        <td class="num" style="color:var(--ink-3);">${fmtDate(agg.last)}</td>`;
}

// Kayıtlı müşterisi olup dönemde siparişi olmayan pazarlar.
function renderIdle(idle) {
    const wrap = document.getElementById('idle-wrap');
    if (!wrap) return;
    if (!idle.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    idle.sort((a, b) => b.registered.length - a.registered.length || a.name.localeCompare(b.name, 'tr'));
    document.getElementById('idle-label').textContent =
        `Müşterisi olup bu dönemde siparişi olmayan ${idle.length} pazar (${idle.reduce((s, m) => s + m.registered.length, 0)} müşteri)`;

    document.getElementById('idle-body').innerHTML = detailTable(
        [{ t: 'Ülke' }, { t: 'Bölge' }, { t: 'Kayıtlı', right: true }, { t: 'Aktif', right: true },
         { t: 'Potansiyel', right: true }, { t: 'Pasif', right: true }, { t: 'CN', right: true }, { t: 'Son Sipariş', right: true }],
        idle.map(m => {
            const st = statusCounts(m.registered);
            return `<tr data-detail="${regDetail(countryPayload(m))}">
                <td style="font-weight:500;color:var(--ink-1);">${escHtml(m.name)}</td>
                <td style="color:var(--ink-3);">${escHtml(m.region)}</td>
                <td class="num" style="font-weight:600;">${m.registered.length}</td>
                <td class="num">${st.Aktif || '—'}</td>
                <td class="num">${st.Potansiyel || '—'}</td>
                <td class="num" style="color:var(--ink-3);">${st.Pasif || '—'}</td>
                <td class="num">${m.agg.cns.length || '—'}</td>
                <td class="num" style="color:var(--ink-3);">${lastOrderEver.has(m.key) ? fmtDate(lastOrderEver.get(m.key)) : 'hiç'}</td>
            </tr>`;
        }));
}

// ── Detay: ülke / bölge ──────────────────────────────────────────────────────

function countryPayload(m) {
    return marketPayload({ title: m.name, kind: 'country', region: m.region, agg: m.agg, registered: m.registered });
}

function marketPayload({ title, kind, region, agg, registered, markets }) {
    const st = statusCounts(registered);
    const subtitle = [
        kind === 'region' ? `${markets.length} ülke` : escHtml(region || ''),
        `${agg.orders.length} sipariş`,
        `${agg.customers.size} / ${registered.length} müşteri`,
        moneyLines(agg.revenue, ' · ') || null,
    ].filter(Boolean).join(' · ');

    return {
        title,
        subtitle,
        html: () => {
            let html = `
                <div class="d-section">Özet</div>
                <div class="attr-row">
                    <span class="attr"><b>Kayıtlı müşteri</b>${registered.length}</span>
                    ${['Aktif', 'Potansiyel', 'Pasif'].map(s => st[s] ? `<span class="attr"><b>${s}</b>${st[s]}</span>` : '').join('')}
                    <span class="attr"><b>Adet</b>${agg.qty.toLocaleString('tr-TR')}</span>
                    <span class="attr"><b>Credit Note</b>${agg.cns.length}</span>
                    <span class="attr"><b>İlk / son sipariş</b>${fmtDate(agg.first)} – ${fmtDate(agg.last)}</span>
                </div>`;

            if (kind === 'region') {
                html += `<div class="d-section">Ülkeler</div>${countryTable(markets)}`;
            }
            if (agg.orders.length) {
                html += `
                    <div class="d-section">Aylık Sipariş</div>
                    ${monthlyBars(agg.orders)}
                    <div class="d-section">Müşteriler</div>
                    ${customerTable(agg)}
                    <div class="d-section">Ürün Türleri</div>
                    ${productTypeTable(agg.lines)}
                    <div class="d-section">Siparişler</div>
                    ${ordersTable(agg.orders, { showCustomer: true })}`;
            }
            const silent = registered.filter(c => !agg.customers.has(c.id));
            if (silent.length) {
                html += agg.orders.length
                    ? `<details class="sub"><summary>Bu dönemde siparişi olmayan ${silent.length} kayıtlı müşteri</summary>
                         <div class="sub-body">${silentTable(silent, agg)}</div></details>`
                    : `<div class="d-section">Kayıtlı Müşteriler (dönemde sipariş yok)</div>${silentTable(silent, agg)}`;
            }
            return html;
        },
    };
}

function countryTable(markets) {
    const totalQty = markets.reduce((s, m) => s + m.agg.qty, 0);
    return detailTable(
        [{ t: 'Ülke' }, { t: 'Müşteri', right: true }, { t: 'Sipariş', right: true }, { t: 'Adet', right: true },
         { t: 'Pay', right: true }, { t: 'Ciro', right: true }, { t: 'Son Sipariş', right: true }],
        markets.map(m => `<tr data-detail="${regDetail(countryPayload(m))}">
            <td style="font-weight:500;">${escHtml(m.name)}</td>
            <td class="num">${m.agg.customers.size} <span style="color:var(--ink-3);">/ ${m.registered.length}</span></td>
            <td class="num" style="font-weight:600;">${m.agg.orders.length}</td>
            <td class="num">${m.agg.qty.toLocaleString('tr-TR')}</td>
            <td class="num" style="color:var(--ink-3);">%${trNum(totalQty ? (m.agg.qty / totalQty) * 100 : 0, 1)}</td>
            <td class="num money-lines">${moneyLines(m.agg.revenue)}</td>
            <td class="num" style="color:var(--ink-3);">${fmtDate(m.agg.last)}</td>
        </tr>`));
}

function customerTable(agg) {
    const map = new Map();
    agg.orders.forEach(o => {
        if (!map.has(o.customer_id)) map.set(o.customer_id, newAgg());
        addOrder(map.get(o.customer_id), o);
    });
    agg.cns.forEach(cn => map.get(cn.customer_id)?.cns.push(cn));

    const rows = [...map.entries()]
        .sort((a, b) => measure(b[1]) - measure(a[1]) || b[1].orders.length - a[1].orders.length)
        .map(([cid, ca]) => {
            const c = customerById.get(cid);
            return `<tr data-detail="${regDetail(customerPayload(c, ca))}">
                <td style="font-weight:500;color:var(--ink-1);">${escHtml(c?.company_name || 'Bilinmeyen müşteri')}</td>
                <td>${statusBadge(c?.status)}</td>
                <td style="color:var(--ink-3);">${escHtml(c?.client_group || '—')}</td>
                <td class="num" style="font-weight:600;">${ca.orders.length}</td>
                <td class="num">${ca.qty.toLocaleString('tr-TR')}</td>
                <td class="num money-lines">${moneyLines(ca.revenue, '<br>', agg.revenue)}</td>
                <td class="num">${ca.cns.length || '—'}</td>
                <td class="num" style="color:var(--ink-3);">${fmtDate(ca.last)}</td>
            </tr>`;
        });
    return detailTable(
        [{ t: 'Müşteri' }, { t: 'Durum' }, { t: 'Grup' }, { t: 'Sipariş', right: true }, { t: 'Adet', right: true },
         { t: 'Ciro', right: true }, { t: 'CN', right: true }, { t: 'Son Sipariş', right: true }],
        rows);
}

function silentTable(customers, agg) {
    const cnByCust = new Map();
    agg.cns.forEach(cn => cnByCust.set(cn.customer_id, (cnByCust.get(cn.customer_id) || 0) + 1));
    const rank = { Aktif: 0, Potansiyel: 1, Pasif: 2 };
    const sorted = [...customers].sort((a, b) =>
        (rank[a.status] ?? 3) - (rank[b.status] ?? 3) ||
        String(custLastOrder.get(b.id) || '').localeCompare(String(custLastOrder.get(a.id) || '')) ||
        String(a.company_name || '').localeCompare(String(b.company_name || ''), 'tr'));
    return detailTable(
        [{ t: 'Müşteri' }, { t: 'Durum' }, { t: 'Grup' }, { t: 'CN', right: true }, { t: 'Son Sipariş (tüm yıllar)', right: true }],
        sorted.map(c => `<tr>
            <td>${escHtml(c.company_name || '—')}</td>
            <td>${statusBadge(c.status)}</td>
            <td style="color:var(--ink-3);">${escHtml(c.client_group || '—')}</td>
            <td class="num">${cnByCust.get(c.id) || '—'}</td>
            <td class="num" style="color:var(--ink-3);">${custLastOrder.has(c.id) ? fmtDate(custLastOrder.get(c.id)) : 'hiç'}</td>
        </tr>`));
}

// ── Detay: müşteri ───────────────────────────────────────────────────────────

function customerPayload(c, agg) {
    const { name } = countryOf(c);
    return {
        title: c?.company_name || 'Bilinmeyen müşteri',
        subtitle: `${escHtml(name)} · ${agg.orders.length} sipariş · ${moneyLines(agg.revenue, ' · ')}`,
        html: () => `
            <div class="d-section">Özet</div>
            <div class="attr-row">
                <span class="attr"><b>Durum</b>${escHtml(c?.status || '—')}</span>
                <span class="attr"><b>Grup</b>${escHtml(c?.client_group || '—')}</span>
                <span class="attr"><b>Adet</b>${agg.qty.toLocaleString('tr-TR')}</span>
                <span class="attr"><b>Credit Note</b>${agg.cns.length}</span>
                <span class="attr"><b>İlk / son sipariş</b>${fmtDate(agg.first)} – ${fmtDate(agg.last)}</span>
            </div>
            <div class="d-section">Ürün Türleri</div>
            ${productTypeTable(agg.lines)}
            <div class="d-section">Siparişler</div>
            ${ordersTable(agg.orders, { showCustomer: false })}
            ${agg.cns.length ? `<div class="d-section">Credit Note'lar</div>${cnTable(agg.cns)}` : ''}`,
    };
}

// ── Ortak detay tabloları ────────────────────────────────────────────────────

// Ürün türü (urunler.urun_turu) kırılımı — adet + para birimi bazında kalem cirosu.
function productTypeTable(lines) {
    if (!lines.length) return '<div class="empty">Bu siparişlere kalem girilmemiş.</div>';
    const map = new Map();
    lines.forEach(l => {
        const t = !l.product ? NOT_IN_CATALOG
            : (String(l.product.urun_turu || '').trim() || UNSPECIFIED);
        if (!map.has(t)) map.set(t, { qty: 0, revenue: new Map(), products: new Set() });
        const g = map.get(t);
        g.qty += l.qty;
        g.revenue.set(l.currency, (g.revenue.get(l.currency) || 0) + l.revenue);
        g.products.add(l.key);
    });
    const total = lines.reduce((s, l) => s + l.qty, 0);
    const rank = n => (n === NOT_IN_CATALOG ? 2 : n === UNSPECIFIED ? 1 : 0);
    const rows = [...map.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].qty - a[1].qty)
        .map(([t, g]) => {
            const pct = total ? (g.qty / total) * 100 : 0;
            return `<tr>
                <td style="font-weight:500;">${escHtml(t)}</td>
                <td class="num" style="font-weight:600;">${g.qty.toLocaleString('tr-TR')}</td>
                <td><div class="share"><div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%;"></div></div>
                    <span class="share-pct">%${trNum(pct, 1)}</span></div></td>
                <td class="num">${g.products.size}</td>
                <td class="num money-lines">${moneyLines(g.revenue)}</td>
            </tr>`;
        });
    return detailTable(
        [{ t: 'Ürün Türü' }, { t: 'Adet', right: true }, { t: 'Pay' }, { t: 'Çeşit', right: true }, { t: 'Kalem Tutarı', right: true }],
        rows) + `<div class="hint" style="margin:6px 0 0;">Kalem tutarı = adet × birim fiyat (Ürün Analizi ile aynı); sipariş tutarından KDV, fatura altı indirim ve kalemi girilmemiş siparişler kadar farklı olabilir.</div>`;
}

function ordersTable(orders, { showCustomer }) {
    const sorted = [...orders].sort((a, b) => isoDate(b.order_date).localeCompare(isoDate(a.order_date)));
    const headers = [{ t: 'Tarih' }, { t: 'Sipariş No' }];
    if (showCustomer) headers.push({ t: 'Müşteri' });
    headers.push({ t: 'Ödeme' }, { t: 'Durum' }, { t: 'Adet', right: true }, { t: 'Tutar', right: true });
    return detailTable(headers, sorted.map(o => {
        const qty = (itemsByOrder.get(o.id) || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        return `<tr>
            <td style="white-space:nowrap;">${fmtDate(o.order_date)}</td>
            <td style="font-family:monospace;font-size:11px;">${escHtml(o.order_number || '—')}</td>
            ${showCustomer ? `<td>${escHtml(customerById.get(o.customer_id)?.company_name || 'Bilinmeyen müşteri')}</td>` : ''}
            <td style="color:var(--ink-3);font-size:11px;">${escHtml(o.payment_method || '—')}</td>
            <td>${orderTags(o).map(t => `<span class="badge b-muted">${escHtml(t)}</span>`).join(' ') || '—'}</td>
            <td class="num">${qty ? qty.toLocaleString('tr-TR') : '<span style="color:var(--ink-3);" title="Kalem girilmemiş">—</span>'}</td>
            <td class="num" style="font-weight:600;">${fmtMoney(o.total_amount, o.currency || 'EUR')}</td>
        </tr>`;
    }));
}

function cnTable(cns) {
    const sorted = [...cns].sort((a, b) => isoDate(b.cn_date).localeCompare(isoDate(a.cn_date)));
    return detailTable([{ t: 'Tarih' }, { t: 'CN No' }, { t: 'Süreç' }],
        sorted.map(cn => `<tr>
            <td style="white-space:nowrap;">${fmtDate(cn.cn_date)}</td>
            <td style="font-family:monospace;font-size:11px;">${escHtml(cn.cn_no || '—')}</td>
            <td>${escHtml(cn.process_status || '—')}</td>
        </tr>`));
}

// Aylık sipariş sayısı (para biriminden bağımsız); ipucunda ay cirosu para birimi bazında.
function monthlyBars(orders) {
    const byMonth = new Map();
    orders.forEach(o => {
        const m = isoDate(o.order_date).slice(0, 7);
        if (!m) return;
        if (!byMonth.has(m)) byMonth.set(m, { n: 0, revenue: new Map() });
        const b = byMonth.get(m);
        b.n++;
        const cur = o.currency || 'EUR';
        b.revenue.set(cur, (b.revenue.get(cur) || 0) + (Number(o.total_amount) || 0));
    });
    if (!byMonth.size) return '<div class="empty">Tarihli kayıt yok.</div>';

    const first = [...byMonth.keys()].sort()[0];
    const now = new Date();
    let end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (filters.year !== 'ALL' && filters.year < end.slice(0, 4)) end = `${filters.year}-12`;
    let months = [];
    let [y, m] = first.split('-').map(Number);
    for (;;) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        months.push(key);
        if (key >= end) break;
        m++; if (m > 12) { m = 1; y++; }
    }
    let note = '';
    if (months.length > MAX_MONTHS) {
        const hidden = months.slice(0, months.length - MAX_MONTHS);
        const hiddenN = hidden.reduce((s, k) => s + (byMonth.get(k)?.n || 0), 0);
        months = months.slice(-MAX_MONTHS);
        note = `<div class="hint" style="margin-top:6px;">Son ${MAX_MONTHS} ay gösteriliyor; öncesinde ${hiddenN} sipariş daha var.</div>`;
    }
    const max = Math.max(...months.map(k => byMonth.get(k)?.n || 0), 1);
    const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

    return `<div class="months">${months.map(k => {
        const b = byMonth.get(k);
        const v = b?.n || 0;
        const [yy, mm] = k.split('-');
        const tip = `${MONTHS_TR[Number(mm) - 1]} ${yy}: ${v} sipariş${b ? ' · ' + moneyLines(b.revenue, ' · ') : ''}`;
        return `<div class="month" title="${escHtml(tip)}">
            <div class="month-val">${v || ''}</div>
            <div class="month-bar${v ? '' : ' zero'}" style="height:${v ? Math.max((v / max) * 100, 2) : 1}%;"></div>
            <div class="month-lbl">${MONTHS_TR[Number(mm) - 1]} ${yy.slice(2)}</div>
        </div>`;
    }).join('')}</div>${note}`;
}

// ── Yardımcılar ──────────────────────────────────────────────────────────────

function statusCounts(customers) {
    const out = {};
    customers.forEach(c => { const s = c.status || '—'; out[s] = (out[s] || 0) + 1; });
    return out;
}

function statusBadge(status) {
    if (!status) return '<span style="color:var(--ink-3);">—</span>';
    return `<span class="badge ${STATUS_BADGE[status] || 'b-muted'}">${escHtml(status)}</span>`;
}

function detailTable(headers, bodyRows) {
    if (!bodyRows.length) return '<div class="empty">Kayıt yok.</div>';
    return `
    <div class="scroll-x">
        <table class="data-table">
            <thead><tr>${headers.map(h =>
                `<th${h.right ? ' style="text-align:right;"' : ''}>${escHtml(h.t)}</th>`).join('')}</tr></thead>
            <tbody>${bodyRows.join('')}</tbody>
        </table>
    </div>`;
}

// Para birimi bazında tutar, her biri ayrı satırda. Asla toplanmaz.
// totals verilirse yanına o para birimindeki toplamdaki payı yazılır.
function moneyLines(revenueMap, sep = '<br>', totals = null) {
    return sortCurrencies([...revenueMap.keys()])
        .map(c => {
            const v = revenueMap.get(c);
            const t = totals?.get(c);
            const pct = t ? `<span class="money-pct">%${trNum((v / t) * 100, 0)}</span>` : '';
            return fmtMoney(v, c) + pct;
        })
        .join(sep);
}

function sortCurrencies(list) {
    return [...list].sort((a, b) => {
        const ia = CURRENCY_ORDER.indexOf(a);
        const ib = CURRENCY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
}

function isoDate(v) {
    return v ? String(v).slice(0, 10) : '';
}

function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return (d && m && y) ? `${d}.${m}.${y}` : String(iso);
}

// Tutarlar her zaman tam yazılır (Satış & Fiyat Analizi ile aynı kural).
function fmtMoney(value, currency) {
    const n = Number(value);
    if (!isFinite(n)) return '—';
    return trNum(n, 2) + ' ' + (CURRENCY_SYMBOLS[currency] || currency || '');
}

function trNum(n, digits) {
    return n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function showError(message) {
    const text = document.getElementById('error-text');
    if (text) text.textContent = message;
    document.getElementById('error-banner')?.classList.add('show');
    const body = document.getElementById('mk-body');
    if (body) body.innerHTML = `<div class="empty">Veri yüklenemedi.</div>`;
    const count = document.getElementById('mk-count');
    if (count) count.textContent = '—';
}

function hideError() {
    document.getElementById('error-banner')?.classList.remove('show');
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
