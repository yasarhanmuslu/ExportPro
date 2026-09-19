// Ürün Analizi — sipariş kalemlerinin ürün kataloğu niteliklerine göre dağılımı
//
// Soru: "Hangi ürün türlerini / serileri / renkleri satıyoruz, kaç müşteriye,
// ve kataloğun ne kadarı gerçekten satılıyor?"
//
// Satış & Fiyat Analizi (profitability.js) ile farkı: orası ürün × para birimi
// ciroyu ve fiyat sapmasını gösterir; burası aynı kalemleri urunler tablosunun
// urun_turu / seri_adi / renk / kalite alanlarıyla gruplar. Ana ölçü ADETTİR —
// adet para biriminden bağımsızdır, ciro ise her zaman para birimi içinde kalır
// (bkz. feedback: para birimleri asla toplanmaz).
//
// NOT (19.09.2026): Bu dosya daha önce Palet Tanımları'nın bir kopyasıydı.
// Palet işleri pallet-definitions.js'te; yetkiler SQL 039 ile ayrıldı.

import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess } from './utils/permissions.js';
import { buildProductIndex, resolveProduct, productKey, productLabel } from './utils/productIdentity.js';
import { buildOrderReconciliation, renderOrderReconciliation } from './utils/orderReconciliation.js';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
const CURRENCY_ORDER   = ['EUR', 'USD', 'TRY', 'GBP'];

// Satış & Fiyat Analizi ve Müşteri Sabit Fiyatlar ile aynı hariç tutma kuralı.
const EXCLUDED_PAYMENT = 'Bedelsiz';
const EXCLUDED_STATUS  = 'İptal';

const NOT_IN_CATALOG = '(Katalogda yok)';
const UNSPECIFIED    = '(Belirtilmemiş)';

// Ürün kartındaki aylık grafikte gösterilecek en fazla ay.
const MAX_MONTHS = 24;

const GROUPINGS = {
    'type-series': { label: 'Tür → Seri', l1Name: 'Ürün Türü', l1: 'urun_turu', l2: 'seri_adi',  l2Name: 'Seri' },
    'series-type': { label: 'Seri → Tür', l1Name: 'Seri',      l1: 'seri_adi',  l2: 'urun_turu', l2Name: 'Ürün Türü' },
    'color':       { label: 'Renk',       l1Name: 'Renk',      l1: 'renk',      l2: null },
    'quality':     { label: 'Kalite',     l1Name: 'Kalite',    l1: 'kalite',    l2: null },
};

// ── Durum ────────────────────────────────────────────────────────────────────

let raw = { orders: [], items: [], products: [], customers: [] };
let productIndex = null;
let orderById = new Map();
let customerById = new Map();
let filters = { year: 'ALL', currency: 'ALL', grouping: 'type-series', hideSingles: true };

// ── Detay penceresi ──────────────────────────────────────────────────────────
// Grup → ürün listesi → ürün kartı şeklinde iç içe açılır; "Geri" bir önceki
// görünüme döner. Payload'lar render sırasında kaydedilir, html bir fonksiyon
// olarak saklanır ki pencere açılana kadar hesaplanmasın.

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
    const ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'product-analysis'))) return;

    await renderNavbar('product-analysis', ctx);
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

    document.getElementById('f-singles')?.addEventListener('change', e => {
        filters.hideSingles = e.target.checked;
        renderAll();
    });

    buildGroupingOptions();
    await loadAllData();
});

// ── Veri çekme ───────────────────────────────────────────────────────────────

// PostgREST sorgu başına 1000 satırda sessizce keser — tüm okumalar sayfalanır.
async function fetchAll(table, columns) {
    const PAGE = 1000;
    let from = 0;
    let out = [];
    for (;;) {
        const { data, error } = await supabase
            .from(table)
            .select(columns)
            .range(from, from + PAGE - 1);
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
        const [orders, items, products, customers] = await Promise.all([
            // '*': invoice_deduction (SQL 017) mutabakat köprüsünde okunuyor.
            fetchAll('orders', '*'),
            // '*': is_free / cn_adjusted (SQL 016) kolonları eski kurulumlarda olmayabilir.
            fetchAll('order_items', '*'),
            fetchAll('urunler', 'id, stok_kodu, stok_adi_1, urun_turu, urun_grubu, seri_adi, renk, kalite, birim, fonksiyon_1, fonksiyon_2, fonksiyon_3'),
            fetchAll('customers', 'id, company_name, country'),
        ]);

        raw = { orders, items, products, customers };
        orderById = new Map(orders.map(o => [o.id, o]));
        customerById = new Map(customers.map(c => [c.id, c]));
        productIndex = buildProductIndex(products);

        buildFilterOptions();
        renderAll();
    } catch (err) {
        console.error('Ürün Analizi yükleme hatası:', err);
        showError(err.message || String(err));
    }
}

// ── Filtreler ────────────────────────────────────────────────────────────────

function buildFilterOptions() {
    const years = [...new Set(raw.orders.map(orderYear).filter(Boolean))].sort().reverse();
    if (filters.year !== 'ALL' && !years.includes(filters.year)) filters.year = 'ALL';

    const yearSel = document.getElementById('f-year');
    if (yearSel) {
        yearSel.innerHTML = `<option value="ALL">Tüm yıllar</option>` +
            years.map(y => `<option value="${y}">${y}</option>`).join('');
        yearSel.value = filters.year;
    }

    const used = new Set();
    raw.items.forEach(i => used.add(lineCurrency(i)));
    const currencies = CURRENCY_ORDER.filter(c => used.has(c));
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

function orderYear(o) {
    return o?.order_date ? String(o.order_date).slice(0, 4) : null;
}

function lineCurrency(item) {
    return item.currency || orderById.get(item.order_id)?.currency || 'EUR';
}

function orderEligible(o) {
    if (!o) return false;
    if ((o.payment_method || '') === EXCLUDED_PAYMENT) return false;
    if (Array.isArray(o.status_tags) && o.status_tags.includes(EXCLUDED_STATUS)) return false;
    if (filters.year !== 'ALL' && orderYear(o) !== filters.year) return false;
    return true;
}

// ── Görünüm hesaplama ────────────────────────────────────────────────────────

// Filtrelerden geçen kalemler, katalog ürününe bağlanmış hâlde.
function buildLines() {
    const lines = [];
    let singles = 0;
    raw.items.forEach(it => {
        const o = orderById.get(it.order_id);
        if (!orderEligible(o)) return;
        const currency = lineCurrency(it);
        if (filters.currency !== 'ALL' && currency !== filters.currency) return;
        const qty = Number(it.quantity) || 0;
        if (filters.hideSingles && qty === 1) { singles++; return; }

        // Tutar = adet × birim fiyat (Satış & Fiyat Analizi ve mutabakat köprüsüyle aynı).
        const unitPrice = Number(it.unit_price) || 0;
        const amount = qty * unitPrice;
        lines.push({
            orderId: it.order_id,
            orderDate: o.order_date,
            customerId: o.customer_id,
            qty,
            unitPrice,
            revenue: Number.isFinite(amount) ? amount : 0,
            currency,
            product: resolveProduct(productIndex, it),
            key: productKey(productIndex, it),
            label: productLabel(productIndex, it),
            isFree: it.is_free === true,
            cnAdjusted: it.cn_adjusted === true,
        });
    });
    return { lines, singles };
}

function attrValue(product, field) {
    if (!product) return NOT_IN_CATALOG;
    const v = product[field];
    return (v == null || String(v).trim() === '') ? UNSPECIFIED : String(v).trim();
}

// Ortak toplayıcı: adet, para birimi bazında ciro, sipariş/müşteri/ürün kümeleri.
function newAgg() {
    return { qty: 0, revenue: new Map(), orders: new Set(), customers: new Set(), products: new Set(), lines: [], last: null, first: null };
}

function addToAgg(agg, l) {
    agg.qty += l.qty;
    agg.revenue.set(l.currency, (agg.revenue.get(l.currency) || 0) + l.revenue);
    agg.orders.add(l.orderId);
    if (l.customerId) agg.customers.add(l.customerId);
    agg.products.add(l.key);
    agg.lines.push(l);
    if (l.orderDate) {
        if (!agg.last || l.orderDate > agg.last) agg.last = l.orderDate;
        if (!agg.first || l.orderDate < agg.first) agg.first = l.orderDate;
    }
}

// Katalogdaki ürünlerin gruplara dağılımı — "çeşit" sütununun paydası.
function catalogMatches(l1Value, l2Value) {
    const g = GROUPINGS[filters.grouping];
    if (l1Value === NOT_IN_CATALOG) return [];
    return raw.products.filter(p =>
        attrValue(p, g.l1) === l1Value &&
        (l2Value == null || attrValue(p, g.l2) === l2Value));
}

function buildGroups(lines) {
    const g = GROUPINGS[filters.grouping];
    const groups = new Map();
    lines.forEach(l => {
        const v1 = attrValue(l.product, g.l1);
        if (!groups.has(v1)) groups.set(v1, { name: v1, agg: newAgg(), children: new Map() });
        const grp = groups.get(v1);
        addToAgg(grp.agg, l);
        if (g.l2 && l.product) {
            const v2 = attrValue(l.product, g.l2);
            if (!grp.children.has(v2)) grp.children.set(v2, { name: v2, agg: newAgg() });
            addToAgg(grp.children.get(v2).agg, l);
        }
    });

    // Gerçek gruplar adede göre, "(Belirtilmemiş)" / "(Katalogda yok)" en sonda.
    const rank = n => (n === NOT_IN_CATALOG ? 2 : n === UNSPECIFIED ? 1 : 0);
    const sorter = (a, b) => rank(a.name) - rank(b.name) || b.agg.qty - a.agg.qty || a.name.localeCompare(b.name, 'tr');
    return [...groups.values()]
        .map(x => ({ ...x, children: [...x.children.values()].sort(sorter) }))
        .sort(sorter);
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
    detailRegistry = new Map();
    detailSeq = 0;
    closeDetail();

    const { lines, singles } = buildLines();
    renderFilterSummary(lines, singles);
    renderStats(lines);
    renderPortfolio(lines);
    renderReconciliation(lines);
}

// Dashboard / Siparişler sipariş kapağındaki tutarı, bu sayfa kalemleri toplar.
// Aradaki fark adım adım: KDV dahil girilmiş tutarlar, kalemi girilmemiş
// siparişler, fatura altı indirim, gizlenen 1 adetlik satırlar...
function renderReconciliation(lines) {
    const wrap  = document.getElementById('recon-wrap');
    const label = document.getElementById('recon-label');
    const body  = document.getElementById('recon-body');
    if (!wrap) return;

    const shown = new Map();
    lines.forEach(l => shown.set(l.currency, (shown.get(l.currency) || 0) + l.revenue));

    const blocks = buildOrderReconciliation({
        orders: raw.orders, items: raw.items, year: filters.year,
        currencyAllowed: c => filters.currency === 'ALL' || c === filters.currency,
        hideSingles: filters.hideSingles, shownByCurrency: shown,
    });
    const out = renderOrderReconciliation(blocks, {
        regDetail,
        customerName: id => customerById.get(id)?.company_name || 'Bilinmeyen müşteri',
        renderLines: pairs => linesTable(pairs.map(({ item, order }) => {
            const qty = Number(item.quantity) || 0;
            const unitPrice = Number(item.unit_price) || 0;
            return {
                orderId: order.id, orderDate: order.order_date, customerId: order.customer_id,
                qty, unitPrice, revenue: qty * unitPrice, currency: item.currency || order.currency,
                label: productLabel(productIndex, item),
                isFree: item.is_free === true, cnAdjusted: item.cn_adjusted === true,
            };
        }), { showProduct: true }),
    });
    if (!out) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    label.textContent = out.label;
    body.innerHTML = out.html;
}

function renderFilterSummary(lines, singles) {
    const el = document.getElementById('filter-summary');
    if (!el) return;
    const bits = [`${lines.length.toLocaleString('tr-TR')} kalem`];
    if (filters.hideSingles && singles) bits.push(`${singles} tek adetlik satır gizli`);
    el.textContent = bits.join(' · ');
}

function renderStats(lines) {
    const el = document.getElementById('stats');
    if (!el) return;
    const agg = newAgg();
    lines.forEach(l => addToAgg(agg, l));

    const linkedIds = new Set(lines.filter(l => l.product).map(l => l.product.id));
    const unlinked = lines.filter(l => !l.product);
    const unlinkedKeys = new Set(unlinked.map(l => l.key));

    el.innerHTML = `
        <div class="stat">
            <div class="stat-label">Satılan Adet</div>
            <div class="stat-value">${agg.qty.toLocaleString('tr-TR')}</div>
            <div class="stat-sub">${lines.length.toLocaleString('tr-TR')} sipariş kaleminden</div>
        </div>
        <div class="stat">
            <div class="stat-label">Sipariş / Müşteri</div>
            <div class="stat-value">${agg.orders.size} <small>/ ${agg.customers.size}</small></div>
            <div class="stat-sub">${fmtDate(agg.first)} – ${fmtDate(agg.last)}</div>
        </div>
        <div class="stat">
            <div class="stat-label">Satılan Ürün Çeşidi</div>
            <div class="stat-value">${linkedIds.size} <small>/ ${raw.products.length} katalog</small></div>
            <div class="stat-sub">${unlinkedKeys.size
                ? `+ ${unlinkedKeys.size} katalogda olmayan kalem türü`
                : 'Tüm kalemler kataloğa bağlı'}</div>
        </div>
        <div class="stat">
            <div class="stat-label">Ciro (para birimi bazında)</div>
            <div class="stat-money">${moneyLines(agg.revenue) || '—'}</div>
        </div>`;
}

function renderPortfolio(lines) {
    const body = document.getElementById('pf-body');
    const count = document.getElementById('pf-count');
    const g = GROUPINGS[filters.grouping];
    const groups = buildGroups(lines);
    const totalQty = groups.reduce((s, x) => s + x.agg.qty, 0);

    if (count) count.textContent = `${groups.length} ${g.l1Name.toLocaleLowerCase('tr-TR')}`;
    if (!groups.length) {
        body.innerHTML = `<div class="empty">Seçili filtrelerde satış kaydı yok.</div>`;
        return;
    }

    const rows = [];
    groups.forEach((grp, gi) => {
        const gid = 'g' + gi;
        const hasChildren = grp.children.length > 0;
        const listId = regDetail(groupListPayload(grp, null));
        const catalog = catalogMatches(grp.name, null).length;

        rows.push(`
            <tr class="l1" ${hasChildren ? `data-toggle="${gid}"` : `data-detail="${listId}"`}>
                <td>
                    ${hasChildren ? '<span class="caret"><i class="fa-solid fa-chevron-right"></i></span>' : '<span class="caret"></span>'}
                    <span class="g-name">${escHtml(grp.name)}</span>
                </td>
                ${metricCells(grp.agg, totalQty, catalog, grp.name === NOT_IN_CATALOG)}
                <td style="text-align:right;">
                    <button type="button" class="icon-btn" data-detail="${listId}" title="Bu gruptaki ürünleri listele">
                        <i class="fa-solid fa-list"></i> Ürünler
                    </button>
                </td>
            </tr>`);

        grp.children.forEach(ch => {
            const chId = regDetail(groupListPayload(grp, ch));
            const chCatalog = catalogMatches(grp.name, ch.name).length;
            rows.push(`
                <tr class="l2 hidden-row" data-parent="${gid}" data-detail="${chId}">
                    <td><span class="g-name">${escHtml(ch.name)}</span></td>
                    ${metricCells(ch.agg, totalQty, chCatalog, false)}
                    <td style="text-align:right;"><i class="fa-solid fa-chevron-right" style="font-size:9px;color:var(--ink-3);"></i></td>
                </tr>`);
        });
    });

    body.innerHTML = `
        <table class="pf-table">
            <thead><tr>
                <th>${escHtml(g.l1Name)}${g.l2 ? ` <span style="text-transform:none;letter-spacing:0;font-weight:400;">› ${escHtml(g.l2Name)}</span>` : ''}</th>
                <th class="r">Adet</th>
                <th>Pay</th>
                <th class="r" title="Satılan ürün sayısı / katalogdaki ürün sayısı">Çeşit</th>
                <th class="r">Sipariş</th>
                <th class="r">Müşteri</th>
                <th class="r">Ciro</th>
                <th class="r">Son Satış</th>
                <th></th>
            </tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>`;
}

function metricCells(agg, totalQty, catalogCount, notInCatalog) {
    const pct = totalQty > 0 ? (agg.qty / totalQty) * 100 : 0;
    return `
        <td class="num" style="font-weight:600;">${agg.qty.toLocaleString('tr-TR')}</td>
        <td>
            <div class="share">
                <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%;"></div></div>
                <span class="share-pct">%${trNum(pct, 1)}</span>
            </div>
        </td>
        <td class="num">${agg.products.size}${notInCatalog ? '' : ` <span style="color:var(--ink-3);">/ ${catalogCount}</span>`}</td>
        <td class="num">${agg.orders.size}</td>
        <td class="num">${agg.customers.size}</td>
        <td class="num money-lines">${moneyLines(agg.revenue)}</td>
        <td class="num" style="color:var(--ink-3);">${fmtDate(agg.last)}</td>`;
}

// ── Detay: grup → ürün listesi ───────────────────────────────────────────────

function groupListPayload(grp, child) {
    const g = GROUPINGS[filters.grouping];
    const agg = child ? child.agg : grp.agg;
    const title = child ? `${grp.name} › ${child.name}` : grp.name;
    return {
        title,
        subtitle: `${escHtml(g.l1Name)}${child ? ' › ' + escHtml(g.l2Name) : ''} · `
            + `${agg.qty.toLocaleString('tr-TR')} adet · ${agg.products.size} ürün · ${agg.customers.size} müşteri`,
        html: () => productListHtml(agg.lines, catalogMatches(grp.name, child ? child.name : null)),
    };
}

function aggregateByProduct(lines) {
    const map = new Map();
    lines.forEach(l => {
        if (!map.has(l.key)) map.set(l.key, { key: l.key, label: l.label, product: l.product, agg: newAgg() });
        addToAgg(map.get(l.key).agg, l);
    });
    return [...map.values()].sort((a, b) => b.agg.qty - a.agg.qty);
}

function productListHtml(lines, catalogProducts) {
    const prods = aggregateByProduct(lines);
    const totalQty = prods.reduce((s, p) => s + p.agg.qty, 0);

    const rows = prods.map(p => {
        const id = regDetail(productCardPayload(p));
        const pct = totalQty > 0 ? (p.agg.qty / totalQty) * 100 : 0;
        return `<tr data-detail="${id}">
            <td>
                <div style="font-weight:500;color:var(--ink-1);">${escHtml(p.label.name)}</div>
                <div style="font-size:10px;color:var(--ink-3);margin-top:2px;">
                    ${escHtml(p.label.code || '—')}${attrBadges(p.product, p.label)}
                </div>
            </td>
            <td class="num" style="font-weight:600;">${p.agg.qty.toLocaleString('tr-TR')}</td>
            <td class="num" style="color:var(--ink-3);">%${trNum(pct, 1)}</td>
            <td class="num">${p.agg.orders.size}</td>
            <td class="num">${p.agg.customers.size}</td>
            <td class="num money-lines">${moneyLines(p.agg.revenue)}</td>
            <td class="num" style="color:var(--ink-3);">${fmtDate(p.agg.last)}</td>
        </tr>`;
    });

    let html = detailTable(
        [{ t: 'Ürün' }, { t: 'Adet', right: true }, { t: 'Pay', right: true }, { t: 'Sipariş', right: true },
         { t: 'Müşteri', right: true }, { t: 'Ciro', right: true }, { t: 'Son Satış', right: true }],
        rows);

    // Katalogda olup seçili filtrelerde hiç satılmamış ürünler — portföyün boş kalan kısmı.
    const soldIds = new Set(prods.filter(p => p.product).map(p => p.product.id));
    const unsold = catalogProducts.filter(p => !soldIds.has(p.id))
        .sort((a, b) => String(a.stok_adi_1 || '').localeCompare(String(b.stok_adi_1 || ''), 'tr'));
    if (unsold.length) {
        html += `
        <details class="sub">
            <summary>Katalogda olup bu dönemde satılmayan ${unsold.length} ürün</summary>
            <div style="margin-top:10px;">
                ${detailTable([{ t: 'Ürün' }, { t: 'Stok Kodu' }, { t: 'Nitelik' }],
                    unsold.map(p => `<tr>
                        <td>${escHtml(p.stok_adi_1 || '—')}</td>
                        <td style="font-family:monospace;font-size:11px;white-space:nowrap;">${escHtml(p.stok_kodu || '—')}</td>
                        <td>${attrBadges(p, null)}</td>
                    </tr>`))}
            </div>
        </details>`;
    }
    return html;
}

function attrBadges(product, label) {
    const bits = [];
    if (product) {
        if (product.renk && product.renk !== 'Beyaz') bits.push(`<span class="badge b-muted">${escHtml(product.renk)}</span>`);
        if (product.kalite && product.kalite !== '1.Kalite') bits.push(`<span class="badge b-warn">${escHtml(product.kalite)}</span>`);
    } else if (label) {
        bits.push(label.ambiguous
            ? `<span class="badge b-warn" title="Bu ad katalogda birden fazla üründe (1./2. Kalite) geçiyor; hangisi olduğu bilinemiyor.">kalite?</span>`
            : `<span class="badge b-muted">katalogda yok</span>`);
    }
    return bits.length ? ' ' + bits.join(' ') : '';
}

// ── Detay: ürün kartı ────────────────────────────────────────────────────────

function productCardPayload(p) {
    return {
        title: p.label.name,
        subtitle: escHtml(p.label.code || 'Stok kodu yok')
            + ` · ${p.agg.qty.toLocaleString('tr-TR')} adet · ${p.agg.orders.size} sipariş · ${p.agg.customers.size} müşteri`,
        html: () => productCardHtml(p),
    };
}

function productCardHtml(p) {
    const prod = p.product;
    const attrs = prod ? [
        ['Tür', prod.urun_turu], ['Seri', prod.seri_adi], ['Grup', prod.urun_grubu],
        ['Renk', prod.renk], ['Kalite', prod.kalite], ['Birim', prod.birim],
        ['Fonksiyon', [prod.fonksiyon_1, prod.fonksiyon_2, prod.fonksiyon_3].filter(Boolean).join(' · ')],
    ].filter(([, v]) => v) : [];

    const attrHtml = prod
        ? `<div class="attr-row">${attrs.map(([k, v]) => `<span class="attr"><b>${k}</b>${escHtml(v)}</span>`).join('')}</div>`
        : `<div class="hint" style="margin:0;">Bu kalem ürün kataloğuna bağlanamadı${p.label.ambiguous
            ? ' — ad katalogda birden fazla üründe (1./2. Kalite) geçiyor'
            : ' (yedek parça, sarf malzemesi ya da katalog dışı ürün olabilir)'}.</div>`;

    return `
        <div class="d-section">Nitelikler</div>
        ${attrHtml}
        <div class="attr-row" style="margin-top:8px;">
            <span class="attr"><b>İlk satış</b>${fmtDate(p.agg.first)}</span>
            <span class="attr"><b>Son satış</b>${fmtDate(p.agg.last)}</span>
            <span class="attr"><b>Ciro</b>${moneyLines(p.agg.revenue, ' · ')}</span>
        </div>

        <div class="d-section">Aylık Adet</div>
        ${monthlyBars(p.agg.lines)}

        <div class="d-section">Müşteriler</div>
        ${customerTable(p.agg.lines)}

        <div class="d-section">Sipariş Kalemleri</div>
        ${linesTable(p.agg.lines)}`;
}

function monthlyBars(lines) {
    const byMonth = new Map();
    lines.forEach(l => {
        const m = String(l.orderDate || '').slice(0, 7);
        if (m) byMonth.set(m, (byMonth.get(m) || 0) + l.qty);
    });
    if (!byMonth.size) return '<div class="empty">Tarihli kayıt yok.</div>';

    // Ürünün ilk satış ayından bugüne (ya da seçili yılın sonuna) kadar — boş aylar da görünsün.
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
        const hiddenQty = hidden.reduce((s, k) => s + (byMonth.get(k) || 0), 0);
        months = months.slice(-MAX_MONTHS);
        note = `<div class="hint" style="margin-top:6px;">Son ${MAX_MONTHS} ay gösteriliyor; öncesinde ${hiddenQty.toLocaleString('tr-TR')} adet daha var.</div>`;
    }
    const max = Math.max(...months.map(k => byMonth.get(k) || 0), 1);
    const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

    return `<div class="months">${months.map(k => {
        const v = byMonth.get(k) || 0;
        const [yy, mm] = k.split('-');
        return `<div class="month" title="${MONTHS_TR[Number(mm) - 1]} ${yy}: ${v.toLocaleString('tr-TR')} adet">
            <div class="month-val">${v ? v.toLocaleString('tr-TR') : ''}</div>
            <div class="month-bar${v ? '' : ' zero'}" style="height:${v ? Math.max((v / max) * 100, 2) : 1}%;"></div>
            <div class="month-lbl">${MONTHS_TR[Number(mm) - 1]} ${yy.slice(2)}</div>
        </div>`;
    }).join('')}</div>${note}`;
}

function customerTable(lines) {
    const map = new Map();
    lines.forEach(l => {
        const k = l.customerId || '—';
        if (!map.has(k)) map.set(k, newAgg());
        addToAgg(map.get(k), l);
    });
    const total = lines.reduce((s, l) => s + l.qty, 0);
    const rows = [...map.entries()]
        .sort((a, b) => b[1].qty - a[1].qty)
        .map(([cid, agg]) => {
            const c = customerById.get(cid);
            const pct = total > 0 ? (agg.qty / total) * 100 : 0;
            return `<tr>
                <td style="font-weight:500;">${escHtml(c?.company_name || 'Bilinmeyen müşteri')}</td>
                <td style="color:var(--ink-3);">${escHtml(c?.country || '—')}</td>
                <td class="num" style="font-weight:600;">${agg.qty.toLocaleString('tr-TR')}</td>
                <td class="num" style="color:var(--ink-3);">%${trNum(pct, 1)}</td>
                <td class="num">${agg.orders.size}</td>
                <td class="num money-lines">${moneyLines(agg.revenue)}</td>
                <td class="num" style="color:var(--ink-3);">${fmtDate(agg.last)}</td>
            </tr>`;
        });
    return detailTable(
        [{ t: 'Müşteri' }, { t: 'Ülke' }, { t: 'Adet', right: true }, { t: 'Pay', right: true },
         { t: 'Sipariş', right: true }, { t: 'Ciro', right: true }, { t: 'Son Sipariş', right: true }],
        rows);
}

function linesTable(lines, { showProduct = false } = {}) {
    const sorted = [...lines].sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || '')));
    const headers = [{ t: 'Tarih' }, { t: 'Sipariş No' }, { t: 'Müşteri' }];
    if (showProduct) headers.push({ t: 'Ürün' });
    headers.push({ t: 'Adet', right: true }, { t: 'Birim Fiyat', right: true }, { t: 'Tutar', right: true });
    return detailTable(headers,
        sorted.map(l => {
            const o = orderById.get(l.orderId);
            const flag = l.isFree
                ? ' <span class="badge b-muted" title="Bedelsiz gönderim — temsili fiyat">bedelsiz</span>'
                : l.cnAdjusted
                    ? ' <span class="badge b-info" title="Fiyatı Credit Note nedeniyle düzenlendi">CN</span>'
                    : '';
            return `<tr>
                <td style="white-space:nowrap;">${fmtDate(l.orderDate)}</td>
                <td style="font-family:monospace;font-size:11px;">${escHtml(o?.order_number || '—')}</td>
                <td>${escHtml(customerById.get(l.customerId)?.company_name || 'Bilinmeyen müşteri')}</td>
                ${showProduct ? `<td>${escHtml(l.label.name)}<div style="font-size:10px;color:var(--ink-3);">${escHtml(l.label.code || '')}</div></td>` : ''}
                <td class="num">${l.qty.toLocaleString('tr-TR')}</td>
                <td class="num">${fmtMoney(l.unitPrice, l.currency)}${flag}</td>
                <td class="num" style="font-weight:600;">${fmtMoney(l.revenue, l.currency)}</td>
            </tr>`;
        }));
}

// ── Yardımcılar ──────────────────────────────────────────────────────────────

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

// Para birimi bazında ciro, her biri ayrı satırda. Asla toplanmaz.
function moneyLines(revenueMap, sep = '<br>') {
    return sortCurrencies([...revenueMap.keys()])
        .map(c => fmtMoney(revenueMap.get(c), c))
        .join(sep);
}

function sortCurrencies(list) {
    return [...list].sort((a, b) => {
        const ia = CURRENCY_ORDER.indexOf(a);
        const ib = CURRENCY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
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
    const body = document.getElementById('pf-body');
    if (body) body.innerHTML = `<div class="empty">Veri yüklenemedi.</div>`;
    const count = document.getElementById('pf-count');
    if (count) count.textContent = '—';
}

function hideError() {
    document.getElementById('error-banner')?.classList.remove('show');
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
