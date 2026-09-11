// Satış & Fiyat Analizi (sayfa/modül kimliği tarihsel olarak 'profitability')
//
// KAPSAM NOTU: Bu modül KÂR ÖLÇMEZ. Projede hiçbir yerde ürün maliyeti
// tutulmuyor, dolayısıyla marj hesaplanamaz. Modülün cevapladığı soru şudur:
// "gerçekte ne sattık ve anlaştığımız fiyatın ne kadar dışına çıktık?"
// Maliyet verisi bir gün girilirse buraya 4. bölüm olarak marj eklenebilir.
//
// Üç bölüm:
//   1) Gerçek Satış Performansı        — order_items (gerçek adet × birim fiyat)
//   2) Fiyat Sapma Raporu              — customer_prices (anlaşılan) vs order_items (fiili)
//   3) Müşteriler Arası Tutarsızlık    — customer_prices'ın kendi içinde
//
// Kaldırılan bölümler (v1.1.21): KPI kartları, müşteri iskonto tablosu ve
// iskonto grafiği. Müşteri skorlamasını customer-score.js zaten dört boyutlu
// (hacim / ödeme / şikayet / iskonto) yapıyor; buradaki tek boyutlu skor onun
// zayıf bir kopyasıydı ve boş fiyat kartı olan müşterileri tepeye taşıyordu.

import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess } from './utils/permissions.js';
import { buildProductIndex, productKey, productLabel, identityKeys } from './utils/productIdentity.js';

// ── Sabitler ─────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
const CURRENCY_ORDER   = ['EUR', 'USD', 'TRY', 'GBP'];

// client-prices.js'teki "Siparişlerden Getir" ile aynı hariç tutma kuralları:
// bedelsiz gönderimlerde fiyat temsili değildir, iptal siparişler hiç olmamıştır.
const EXCLUDED_PAYMENT = 'Bedelsiz';
const EXCLUDED_STATUS  = 'İptal';

// Sapma raporunda gürültü eşiği — yuvarlama farklarını listelemenin anlamı yok.
const DEVIATION_MIN_PCT = 1;

// Tutarsızlık bölümünde "dikkat" eşiği.
const SPREAD_WARN_PCT = 15;

// Sipariş tutarı, kalem toplamının tam bu oranıysa aradaki fark KDV'dir,
// veri hatası değil. Canlı veride 21 uyuşmazlığın 16'sı kuruşu kuruşuna 1,20:
// TRY siparişlerin 15'inin 15'i, USD'nin 1'i. Bunları "hata" diye raporlamak
// gerçek 5 uyuşmazlığı gürültüde boğuyordu.
const VAT_RATE = 0.20;
const VAT_TOLERANCE = 0.005;   // oranda ±%0,5

// Sembolik fiyat eşiği: ürünün medyan anlaşılan fiyatının bu oranının altındaki
// kayıtlar bedelsiz/numune kabul edilir ve istatistiğe katılmaz.
// Değer canlı veriden seçildi: %15 ile %25 arasında sonuç kümesi BİREBİR aynı
// (8 kayıt / 5 müşteri) — yani gerçek pazarlık fiyatlarıyla sembolik kayıtlar
// arasında bu aralıkta net bir boşluk var. %20 o boşluğun ortası.
// KALICI ÇÖZÜM: customer_prices'a bir "bedelsiz/numune" işareti eklenirse bu
// sezgisel kural bırakılıp doğrudan o alan okunmalı.
const SYMBOLIC_RATIO = 0.20;

// ── Durum ────────────────────────────────────────────────────────────────────

let raw = { prices: [], orders: [], items: [], products: [], customers: [] };
let productIndex = null;
let customerNameCache = new Map();
let orderById = new Map();
let filters = { year: 'ALL', currency: 'ALL', hideSingles: true };

// ── Detay penceresi ──────────────────────────────────────────────────────────
// Modüldeki her özet satır, arkasındaki ham kayıtları açabilmeli: "5 siparişte
// kalem toplamı tutmuyor" satırı hangi 5 sipariş olduğunu, "1 ürün · USD" satırı
// hangi ürün olduğunu söylemeli. Kayıtlar render sırasında burada saklanır.

let detailRegistry = new Map();
let detailSeq = 0;

function regDetail(payload) {
    const id = 'd' + (++detailSeq);
    detailRegistry.set(id, payload);
    return id;
}

function openDetail({ title, subtitle, html }) {
    document.getElementById('detail-title').textContent = title || '';
    document.getElementById('detail-sub').innerHTML = subtitle || '';
    document.getElementById('detail-body').innerHTML = typeof html === 'function' ? html() : (html || '');
    document.getElementById('detail-overlay').classList.add('active');
}

function closeDetail() {
    document.getElementById('detail-overlay')?.classList.remove('active');
}

function initDetailUI() {
    document.getElementById('detail-close')?.addEventListener('click', closeDetail);
    document.getElementById('detail-overlay')?.addEventListener('click', e => {
        if (e.target.id === 'detail-overlay') closeDetail();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
    document.addEventListener('click', e => {
        const el = e.target.closest('[data-detail]');
        if (!el) return;
        const payload = detailRegistry.get(el.dataset.detail);
        if (payload) openDetail(payload);
    });
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    const ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'profitability'))) return;

    await renderNavbar('profitability', ctx);
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

    await loadAllData();
});

// ── Veri çekme ───────────────────────────────────────────────────────────────

// PostgREST varsayılan olarak sorgu başına 1000 satır döndürür ve bunu sessizce
// yapar. order_items büyüdükçe rapor uyarısız eksik veri gösterirdi; bu yüzden
// tüm okumalar sayfalanır.
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
        const [prices, orders, items, products, customers] = await Promise.all([
            // Kolonlar tek tek yazılmıyor: SQL 015 (is_symbolic) henüz
            // çalıştırılmamış olabilir; '*' ile kolon eksikse alan sadece
            // undefined olur, sorgu hata vermez.
            fetchAll('customer_prices',
                '*, customers!fk_customer_prices_customer ( id, company_name, country )'),
            // orders da '*': invoice_deduction kolonu SQL 017 ile geliyor,
            // henüz çalıştırılmamış olabilir.
            fetchAll('orders', '*'),
            // order_items da '*': is_free / cn_adjusted kolonları SQL 016 ile
            // geliyor, henüz çalıştırılmamış olabilir.
            fetchAll('order_items', '*'),
            fetchAll('urunler', 'id, stok_kodu, stok_adi_1'),
            fetchAll('customers', 'id, company_name, country'),
        ]);

        raw = { prices, orders, items, products, customers };
        orderById = new Map(orders.map(o => [o.id, o]));
        productIndex = buildProductIndex(products);
        customerNameCache = new Map(customers.map(c => [c.id, c.company_name]));

        buildFilterOptions();
        renderAll();
    } catch (err) {
        console.error('Satış & Fiyat Analizi yükleme hatası:', err);
        showError(err.message || String(err));
    }
}

// ── Filtreler ────────────────────────────────────────────────────────────────

function buildFilterOptions() {
    // Yıl seçenekleri sipariş tarihlerinden türetilir.
    const years = [...new Set(raw.orders.map(orderYear).filter(Boolean))].sort().reverse();
    if (filters.year !== 'ALL' && !years.includes(filters.year)) filters.year = 'ALL';

    const yearSel = document.getElementById('f-year');
    if (yearSel) {
        yearSel.innerHTML = `<option value="ALL">Tüm yıllar</option>` +
            years.map(y => `<option value="${y}">${y}</option>`).join('');
        yearSel.value = filters.year;
    }

    // Para birimi seçenekleri fiilen kullanılanlarla sınırlı tutulur.
    const used = new Set();
    raw.orders.forEach(o => { if (o.currency) used.add(o.currency); });
    raw.items.forEach(i => { if (i.currency) used.add(i.currency); });
    raw.prices.forEach(p => used.add(p.currency || 'EUR'));
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

function orderYear(o) {
    return o?.order_date ? String(o.order_date).slice(0, 4) : null;
}

function currencyAllowed(cur) {
    return filters.currency === 'ALL' || cur === filters.currency;
}

// ── Görünüm hesaplama ────────────────────────────────────────────────────────

// Bir siparişin analize girip girmeyeceği. Hariç tutma kuralları client-prices
// ile birebir aynı; yıl filtresi de burada uygulanır.
function orderEligible(o) {
    if (!o) return false;
    if ((o.payment_method || '') === EXCLUDED_PAYMENT) return false;
    if (Array.isArray(o.status_tags) && o.status_tags.includes(EXCLUDED_STATUS)) return false;
    if (filters.year !== 'ALL' && orderYear(o) !== filters.year) return false;
    return true;
}

// Güncel anlaşılan fiyat: ikinci fiyat girilmişse o geçerlidir, yoksa birincisi.
// (SQL 011 — net_price_2 doluysa net_price artık ÖNCEKİ fiyattır.)
function currentAgreedPrice(card) {
    const v2 = parseFloat(card.net_price_2);
    if (isFinite(v2) && v2 > 0) return v2;
    return parseFloat(card.net_price) || 0;
}

// Bir siparişin TARİHİNDE geçerli olan anlaşılan fiyat.
//
// NEDEN: anlaşılan fiyat zamanla değişir. Bugünkü fiyatı geçmişteki satışlarla
// karşılaştırmak sahte sapma üretir — canlı örnek: Insteel/N.S.G Kolon Ayak,
// kart 622,00 ₺ (13.08.2026); 622'ye geçtikten sonraki her satış tam 622'den
// yapılmış ama tüm dönemin ortalaması (594,06) alınınca "%4,5 altında sattın,
// 31.855 ₺ kayıp" gibi görünüyordu. Yanlıştı.
//
// Dönemler: price_date → net_price başlangıcı, net_price_2_date → net_price_2
// başlangıcı. Sipariş, kartın başlangıcından ÖNCEYSE o tarihte hangi fiyatın
// geçerli olduğunu bilmiyoruz — tahmin etmek yerine karşılaştırma dışı bırakılır.
function agreedPriceAt(card, orderDate) {
    const row  = card.row;
    const v1   = parseFloat(row.net_price) || 0;
    const v2raw = parseFloat(row.net_price_2);
    const hasV2 = isFinite(v2raw) && v2raw > 0;
    const d1 = row.price_date || null;
    const d2 = row.net_price_2_date || null;
    const day = orderDate || null;

    // v.2 dönemi
    if (hasV2 && d2 && day && day >= d2) {
        return { price: v2raw, since: d2, version: 2, dated: true };
    }
    // v.2 var ama tarihi yok: hangi dönemin hangisi olduğu bilinmiyor,
    // güncel fiyat kabul edilir ve satır "tarihsiz" işaretlenir.
    if (hasV2 && !d2) {
        return { price: v2raw, since: null, version: 2, dated: false };
    }
    // v.1 dönemi
    if (v1 <= 0) return null;
    if (d1 && day && day < d1) return null;   // kart bu tarihte henüz yoktu
    return { price: v1, since: d1, version: 1, dated: !!d1 };
}

// Filtrelenmiş sipariş kalemleri + sayaçlar.
function buildItemView() {
    const orderById = new Map(raw.orders.map(o => [o.id, o]));
    const eligibleOrders = raw.orders.filter(orderEligible);
    const eligibleIds = new Set(eligibleOrders.map(o => o.id));

    const items = [];
    let singlesFound = 0;
    let unlinked = 0;
    let ambiguous = 0;

    raw.items.forEach(it => {
        const order = orderById.get(it.order_id);
        if (!order || !eligibleIds.has(order.id)) return;

        const currency = it.currency || order.currency;
        if (!currency || !currencyAllowed(currency)) return;

        const qty   = parseFloat(it.quantity) || 0;
        const price = parseFloat(it.unit_price) || 0;
        if (qty <= 0 || price <= 0) return;

        // 1 adetlik satırlar tipik olarak numune ya da yedek parçadır
        // (canlı veride 1 adetlik kalemlerin fiyatı çoğu kez listenin %1'i).
        if (qty === 1) {
            singlesFound++;
            if (filters.hideSingles) return;
        }

        const label = productLabel(productIndex, it);
        if (!label.linked) unlinked++;
        if (label.ambiguous) ambiguous++;

        // SQL 016 işaretleri: bedelsiz gönderim ya da bedelsiz kalemin tutarının
        // düşüldüğü satır. Tutar gerçektir (fatura ona göre kesilmiştir) — bu
        // yüzden ciro ve adet toplamlarında KALIR. Ama pazarlık fiyatı değildir,
        // bu yüzden fiyat sapma raporuna girmez (bkz. buildDeviations).
        const priceless = it.is_free === true || it.cn_adjusted === true;

        items.push({
            key: productKey(productIndex, it),
            keys: identityKeys(productIndex, it),
            label,
            orderId: order.id,
            orderDate: order.order_date || null,
            customerId: order.customer_id,
            currency,
            qty,
            unitPrice: price,
            revenue: qty * price,
            priceless,
            isFree: it.is_free === true,
            cnAdjusted: it.cn_adjusted === true,
        });
    });

    return { eligibleOrders, items, singlesFound, unlinked, ambiguous };
}

// Filtrelenmiş fiyat kartları.
function buildCardView() {
    return raw.prices
        .map(p => ({
            row: p,
            key: productKey(productIndex, p),
            keys: identityKeys(productIndex, p),
            label: productLabel(productIndex, p),
            customerId: p.customer_id,
            companyName: p.customers?.company_name || 'Bilinmeyen',
            currency: p.currency || 'EUR',
            agreed: currentAgreedPrice(p),
            listPrice: parseFloat(p.list_price) || 0,
            // SQL 015 çalıştırıldıysa kullanıcının kendi işareti; yoksa undefined
            // ve aşağıdaki sezgisel kurala düşülür.
            markedSymbolic: p.is_symbolic === true,
        }))
        .filter(c => currencyAllowed(c.currency));
}

// ── Render orkestrasyonu ─────────────────────────────────────────────────────

function renderAll() {
    detailRegistry = new Map();
    detailSeq = 0;
    const itemView = buildItemView();
    const cardView = buildCardView();

    renderFilterSummary(itemView);
    renderSales(itemView);
    renderReconciliation(itemView);
    renderDeviations(itemView, cardView);
    renderSpread(cardView);
}

function renderFilterSummary(view) {
    const el = document.getElementById('filter-summary');
    if (!el) return;
    const bits = [];
    if (view.singlesFound) {
        bits.push(filters.hideSingles
            ? `${view.singlesFound} tekil satır gizlendi`
            : `${view.singlesFound} tekil satır dahil`);
    }
    if (view.unlinked) bits.push(`${view.unlinked} kalem katalogda bulunamadı`);
    if (view.ambiguous) bits.push(`${view.ambiguous} kalemde kalite ayrılamadı`);
    el.textContent = bits.join(' · ');
}

// ── 1) GERÇEK SATIŞ PERFORMANSI ──────────────────────────────────────────────

function renderSales(view) {
    const body  = document.getElementById('sales-body');
    const badge = document.getElementById('sales-coverage');
    if (!body) return;

    // Kapsama, kalem satırlarından değil sipariş kimliklerinden sayılır.
    const eligibleIds = new Set(view.eligibleOrders.map(o => o.id));
    const ordersWithItems = new Set(
        raw.items.filter(i => eligibleIds.has(i.order_id)).map(i => i.order_id)
    );
    if (badge) {
        badge.textContent = view.eligibleOrders.length
            ? `${ordersWithItems.size} / ${view.eligibleOrders.length} siparişte kalem girildi`
            : '0 sipariş';
    }

    // ürün + para birimi bazında grupla
    const groups = new Map();
    view.items.forEach(it => {
        const gk = `${it.key}|${it.currency}`;
        if (!groups.has(gk)) {
            groups.set(gk, {
                label: it.label, currency: it.currency,
                qty: 0, revenue: 0, customers: new Set(), lines: [],
            });
        }
        const g = groups.get(gk);
        g.qty += it.qty;
        g.revenue += it.revenue;
        g.customers.add(it.customerId);
        g.lines.push(it);
    });

    if (!groups.size) {
        body.innerHTML = `<div class="empty">Bu filtrelerle gösterilecek satış kalemi yok.</div>`;
        return;
    }

    // para birimine göre böl
    const byCurrency = new Map();
    groups.forEach(g => {
        if (!byCurrency.has(g.currency)) byCurrency.set(g.currency, []);
        byCurrency.get(g.currency).push(g);
    });

    body.innerHTML = sortCurrencies([...byCurrency.keys()]).map(cur => {
        const list = byCurrency.get(cur).sort((a, b) => b.revenue - a.revenue);
        const total = list.reduce((s, g) => s + g.revenue, 0);
        const max = Math.max(...list.map(g => g.revenue), 1);

        return `
        <div class="cur-block">
            <div class="cur-head">
                <span class="cur-name">${cur} ${CURRENCY_SYMBOLS[cur] || ''}</span>
                <span class="cur-total">${fmtMoney(total, cur)}</span>
                <span class="cur-meta">${list.length} ürün</span>
            </div>
            ${list.map(g => {
                const did = regDetail({
                    title: g.label.name,
                    subtitle: `${g.label.code ? escHtml(g.label.code) + ' &middot; ' : ''}${g.customers.size} müşteri &middot; ${g.qty.toLocaleString('tr-TR')} adet &middot; ${fmtMoney(g.revenue, cur)}`,
                    html: () => linesTable(g.lines, cur, { showProduct: false }),
                });
                return `
            <div class="prow" data-detail="${did}">
                <div style="flex:0 0 230px;min-width:0;">
                    <div class="prow-name" title="${escHtml(g.label.name)}">${escHtml(g.label.name)}</div>
                    <div class="prow-sub">
                        ${g.label.code ? escHtml(g.label.code) + ' &middot; ' : ''}${g.customers.size} müşteri &middot; ${g.qty.toLocaleString('tr-TR')} adet
                    </div>
                </div>
                ${qualityBadge(g.label)}
                <div class="bar"><div class="bar-fill" style="width:${Math.max((g.revenue / max) * 100, 1).toFixed(1)}%;"></div></div>
                <div style="flex:0 0 auto;text-align:right;min-width:150px;">
                    <div class="num" style="font-weight:600;color:var(--accent);">${fmtMoney(g.revenue, cur)}</div>
                    <div class="prow-sub">ort: ${fmtMoney(g.revenue / g.qty, cur)}<i class="fa-solid fa-chevron-right go"></i></div>
                </div>
            </div>`;
            }).join('')}
        </div>`;
    }).join('');
}

// ── MUTABAKAT: sipariş tutarı toplamı → gösterilen ciro ──────────────────────
// Kullanıcı haklı olarak "Siparişler'de 301.105,18 € yazıyor, burada 296.016,66"
// diye sordu. İki sayı farklı şeyi ölçüyor: orders.total_amount sipariş kapağına
// elle girilen tutar, bu modül ise fiilen girilmiş kalemleri topluyor. Farkın
// nereden geldiği artık ekranda adım adım gösteriliyor.
function buildReconciliation(itemView) {
    const itemsByOrder = new Map();
    raw.items.forEach(it => {
        if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
        itemsByOrder.get(it.order_id).push(it);
    });

    const lineAmount = it => (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0);

    // Detay penceresinin beklediği satır biçimi (buildItemView'inkiyle aynı alanlar).
    const reconLine = (it, o) => ({
        orderId: o.id, orderDate: o.order_date || null,
        label: productLabel(productIndex, it),
        qty: parseFloat(it.quantity) || 0,
        unitPrice: parseFloat(it.unit_price) || 0,
        revenue: lineAmount(it),
        priceless: it.is_free === true || it.cn_adjusted === true,
        isFree: it.is_free === true,
        cnAdjusted: it.cn_adjusted === true,
    });

    // Gösterilen ciro: bölüm 1'in topladığı rakamın aynısı.
    const shown = new Map();
    itemView.items.forEach(it => shown.set(it.currency, (shown.get(it.currency) || 0) + it.revenue));

    const currencies = sortCurrencies([...new Set(
        raw.orders.map(o => o.currency).filter(c => c && currencyAllowed(c))
    )]);

    return currencies.map(cur => {
        // Yıl filtresi uygulanmış, ama İptal/Bedelsiz HENÜZ çıkarılmamış küme.
        const base = raw.orders.filter(o =>
            o.currency === cur && (filters.year === 'ALL' || orderYear(o) === filters.year));
        if (!base.length) return null;

        const steps = [];
        const sumTot = list => list.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);

        let running = sumTot(base);
        const start = running;

        const iptal = base.filter(o => Array.isArray(o.status_tags) && o.status_tags.includes(EXCLUDED_STATUS));
        if (iptal.length) { running -= sumTot(iptal); steps.push({ t: `İptal edilen ${iptal.length} sipariş`, v: -sumTot(iptal), orders: iptal }); }

        const r1 = base.filter(o => !iptal.includes(o));
        const bedelsiz = r1.filter(o => (o.payment_method || '') === EXCLUDED_PAYMENT);
        if (bedelsiz.length) { running -= sumTot(bedelsiz); steps.push({ t: `Bedelsiz ${bedelsiz.length} sipariş`, v: -sumTot(bedelsiz), orders: bedelsiz }); }

        const r2 = r1.filter(o => !bedelsiz.includes(o));
        const noItems = r2.filter(o => !(itemsByOrder.get(o.id) || []).length);
        if (noItems.length) {
            running -= sumTot(noItems);
            steps.push({ t: `Hiç kalem girilmemiş ${noItems.length} sipariş`, v: -sumTot(noItems), warn: true, orders: noItems });
        }

        const r3 = r2.filter(o => (itemsByOrder.get(o.id) || []).length);
        let itemsSame = 0, itemsOther = 0, singles = 0;
        const mismatched = [];
        const vatOrders = [];
        const deductionOrders = [];   // fatura altı indirim uygulanmış (SQL 017)
        const otherCurLines = [];
        const singleLines = [];
        r3.forEach(o => {
            let orderItemsTotal = 0;
            (itemsByOrder.get(o.id) || []).forEach(it => {
                const amt = lineAmount(it);
                orderItemsTotal += amt;
                if ((it.currency || o.currency) === cur) {
                    itemsSame += amt;
                    if ((parseFloat(it.quantity) || 0) === 1) { singles += amt; singleLines.push(reconLine(it, o)); }
                } else {
                    itemsOther += amt;
                    otherCurLines.push(reconLine(it, o));
                }
            });
            const tot = parseFloat(o.total_amount) || 0;
            if (Math.abs(orderItemsTotal - tot) > 0.5) {
                const ratio = orderItemsTotal > 0 ? tot / orderItemsTotal : 0;
                const deduction = parseFloat(o.invoice_deduction) || 0;
                // Fatura altı indirim girilmişse fark AÇIKLANMIŞTIR: kalem
                // fiyatlarına dokunulmadan CN tutarı faturadan düşülmüştür.
                if (deduction > 0 && Math.abs(orderItemsTotal - deduction - tot) <= 0.5) deductionOrders.push(o);
                else if (Math.abs(ratio - (1 + VAT_RATE)) <= VAT_TOLERANCE) vatOrders.push(o);
                else mismatched.push(o);
            }
        });

        // Farkı ayır: KDV kaynaklı olan (normal) ve gerçekten uyuşmayan.
        const sumDiff = list => list.reduce((sum, o) => {
            const items = (itemsByOrder.get(o.id) || []).reduce((t, it) => t + lineAmount(it), 0);
            return sum + (items - (parseFloat(o.total_amount) || 0));
        }, 0);

        const vatDelta = sumDiff(vatOrders);
        if (vatOrders.length) {
            running += vatDelta;
            steps.push({
                t: `${vatOrders.length} siparişin tutarı KDV dahil girilmiş (%${VAT_RATE * 100})`,
                v: vatDelta, orders: vatOrders, withItemsTotal: true,
            });
        }

        const deductionDelta = sumDiff(deductionOrders);
        if (deductionOrders.length) {
            running += deductionDelta;
            steps.push({
                t: `${deductionOrders.length} siparişte fatura altı indirim uygulanmış`,
                v: deductionDelta, orders: deductionOrders, withItemsTotal: true,
            });
        }

        const mismatchDelta = sumDiff(mismatched);
        if (mismatched.length) {
            running += mismatchDelta;
            steps.push({
                t: `${mismatched.length} siparişte kalem toplamı sipariş tutarını tutmuyor`,
                v: mismatchDelta, warn: true, orders: mismatched, withItemsTotal: true,
            });
        }

        // Kalan bakiye (yuvarlama). Normalde sıfır olmalı.
        const delta = (itemsSame + itemsOther) - sumTot(r3) - vatDelta - deductionDelta - mismatchDelta;
        if (Math.abs(delta) > 0.005) {
            running += delta;
            steps.push({ t: 'Diğer küçük farklar', v: delta });
        }
        if (itemsOther > 0.005) { running -= itemsOther; steps.push({ t: 'Farklı para birimindeki kalemler', v: -itemsOther, lines: otherCurLines }); }
        if (filters.hideSingles && singles > 0.005) { running -= singles; steps.push({ t: 'Gizlenen 1 adetlik satırlar', v: -singles, lines: singleLines }); }

        const shownVal = shown.get(cur) || 0;
        return { cur, start, steps, end: running, shown: shownVal, ok: Math.abs(running - shownVal) < 0.05, itemsByOrder };
    }).filter(Boolean);
}

function renderReconciliation(itemView) {
    const wrap  = document.getElementById('recon-wrap');
    const label = document.getElementById('recon-label');
    const body  = document.getElementById('recon-body');
    if (!wrap) return;

    const blocks = buildReconciliation(itemView).filter(b => b.steps.length);
    if (!blocks.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    const warnCount = blocks.reduce((n, b) => n + b.steps.filter(x => x.warn).length, 0);
    label.textContent = `Sipariş tutarlarıyla mutabakat${warnCount ? ` — ${warnCount} veri uyuşmazlığı` : ''}`;

    body.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">
            Siparişler ekranındaki toplam, sipariş kapağına elle girilen <em>tutar</em> alanını toplar.
            Bu sayfa ise fiilen girilmiş <em>kalemleri</em> toplar. Aradaki fark adım adım aşağıda.
        </div>
        ${blocks.map(b => `
        <div class="cur-block">
            <div class="cur-head">
                <span class="cur-name">${b.cur} ${CURRENCY_SYMBOLS[b.cur] || ''}</span>
                <span class="cur-meta">${b.ok ? '' : 'köprü tutmuyor — lütfen bildir'}</span>
            </div>
            <table class="data-table">
                <tbody>
                    <tr>
                        <td>Sipariş tutarları toplamı</td>
                        <td class="num" style="font-weight:600;">${fmtMoney(b.start, b.cur)}</td>
                    </tr>
                    ${b.steps.map(st => {
                        const did = (st.orders || st.lines) ? regDetail({
                            title: st.t,
                            subtitle: `${b.cur} &middot; ${st.v > 0 ? '+' : ''}${fmtMoney(st.v, b.cur)}`
                                + (st.withItemsTotal ? ' &middot; "Fark" kolonu, kalem toplamının sipariş tutarından ne kadar saptığını gösterir.' : ''),
                            html: () => st.orders
                                ? ordersTable(st.orders, b.cur, b.itemsByOrder, { showItemsTotal: !!st.withItemsTotal })
                                : linesTable(st.lines, b.cur),
                        }) : null;
                        return `
                    <tr${did ? ` data-detail="${did}"` : ''}>
                        <td style="color:var(--ink-2);padding-left:18px;">
                            ${st.warn ? '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warn);font-size:10px;margin-right:5px;"></i>' : ''}${escHtml(st.t)}${did ? '<i class="fa-solid fa-chevron-right go"></i>' : ''}
                        </td>
                        <td class="num" style="color:${st.v < 0 ? 'var(--danger)' : 'var(--ok)'};">
                            ${st.v > 0 ? '+' : ''}${fmtMoney(st.v, b.cur)}
                        </td>
                    </tr>`;
                    }).join('')}
                    <tr>
                        <td style="font-weight:600;">Bu sayfada gösterilen</td>
                        <td class="num" style="font-weight:600;color:var(--accent);">${fmtMoney(b.shown, b.cur)}</td>
                    </tr>
                </tbody>
            </table>
        </div>`).join('')}`;
}

function qualityBadge(label) {
    if (label.ambiguous) {
        return `<span class="badge b-warn" title="Aynı ürün adı katalogda birden fazla kalitede var; bu satır stok koduna bağlanamadığı için kaliteler karışmış olabilir.">
            <i class="fa-solid fa-circle-question" style="font-size:8px;"></i> kalite?</span>`;
    }
    if (!label.linked) {
        return `<span class="badge b-muted" title="Bu satır ürün kataloğundaki (urunler) hiçbir karta bağlanamadı.">katalog dışı</span>`;
    }
    if (label.quality === '2.Kalite') {
        return `<span class="badge b-info">2. Kalite</span>`;
    }
    return `<span class="badge b-muted" style="visibility:hidden;">—</span>`;
}

// ── 2) FİYAT SAPMA RAPORU ────────────────────────────────────────────────────

// Her sipariş kalemi, KENDİ TARİHİNDE geçerli olan anlaşılan fiyatla eşleşir.
// Aynı müşteri+ürün için fiyat dönem değiştirdiyse (v.1 → v.2) dönemler ayrı
// satır olur — tek bir ortalamada birleştirmek sahte sapma üretiyordu.
function buildDeviations(itemView, cardView) {
    // Kart, sahip olduğu HER kimlikle indekslenir; kalem de kendi kimliklerinden
    // biriyle eşleşirse kart bulunmuş sayılır (bkz. identityKeys açıklaması).
    const cardBy = new Map();
    cardView.forEach(c => {
        c.keys.forEach(k => {
            const idx = `${c.customerId}|${k}|${c.currency}`;
            if (!cardBy.has(idx)) cardBy.set(idx, c);
        });
    });
    const findCard = it => {
        for (const k of it.keys) {
            const hit = cardBy.get(`${it.customerId}|${k}|${it.currency}`);
            if (hit) return hit;
        }
        return null;
    };

    const groups = new Map();   // müşteri|ürün|para|dönem -> toplam
    const noCard = new Map();   // fiyat kartı hiç yok
    const beforeCard = new Map(); // satış, kartın başlangıç tarihinden önce

    let excluded = 0;

    itemView.items.forEach(it => {
        // Bedelsiz / CN nedeniyle düzenlenmiş kalemler anlaşılan fiyatla
        // karşılaştırılamaz: tutarları bilerek temsilidir, karşılaştırıldığında
        // %96-99'luk sahte sapma üretirler.
        if (it.priceless) { excluded++; return; }

        const k = `${it.customerId}|${it.key}|${it.currency}`;
        const card = findCard(it);

        const bucket = (map, extra = {}) => {
            if (!map.has(k)) {
                map.set(k, {
                    key: it.key, label: it.label, customerId: it.customerId,
                    currency: it.currency, qty: 0, revenue: 0, lines: [],
                    firstSale: null, lastSale: null, ...extra,
                });
            }
            const b = map.get(k);
            b.qty += it.qty;
            b.revenue += it.revenue;
            b.lines.push(it);
            const d = it.orderDate;
            if (d) {
                if (!b.firstSale || d < b.firstSale) b.firstSale = d;
                if (!b.lastSale  || d > b.lastSale)  b.lastSale  = d;
            }
            return b;
        };

        if (!card || card.agreed <= 0) { bucket(noCard); return; }

        const at = agreedPriceAt(card, it.orderDate);
        if (!at) {
            // Kartın geçerlilik başlangıcından önceki satış: o tarihte hangi
            // fiyatın anlaşıldığı sistemde yok, karşılaştırma yapılamaz.
            const b = bucket(beforeCard, { companyName: card.companyName, since: card.row.price_date || null });
            b.since = card.row.price_date || b.since;
            return;
        }

        const gk = `${k}|${at.price}|${at.since || 'tarihsiz'}`;
        if (!groups.has(gk)) {
            groups.set(gk, {
                companyName: card.companyName,
                label: it.label,
                currency: it.currency,
                agreed: at.price,
                since: at.since,
                version: at.version,
                dated: at.dated,
                listPrice: card.listPrice,
                qty: 0, revenue: 0, lines: [],
            });
        }
        const g = groups.get(gk);
        g.qty += it.qty;
        g.revenue += it.revenue;
        g.lines.push(it);
    });

    const rows = [];
    groups.forEach(g => {
        const actualAvg = g.revenue / g.qty;
        const diffPct = ((actualAvg - g.agreed) / g.agreed) * 100;
        if (Math.abs(diffPct) < DEVIATION_MIN_PCT) return;
        rows.push({ ...g, actualAvg, diffPct, money: (actualAvg - g.agreed) * g.qty });
    });

    rows.sort((a, b) => a.money - b.money);
    const noCardList = [...noCard.values()].sort((a, b) => b.revenue - a.revenue);
    const beforeList = [...beforeCard.values()].sort((a, b) => b.revenue - a.revenue);

    return { rows, noCard: noCardList, beforeCard: beforeList, excluded };
}

function renderDeviations(itemView, cardView) {
    const body    = document.getElementById('dev-body');
    const badge   = document.getElementById('dev-count');
    const summary = document.getElementById('dev-summary');
    if (!body) return;

    const { rows, noCard, beforeCard, excluded } = buildDeviations(itemView, cardView);
    if (badge) badge.textContent = `${rows.length} sapma`;

    // Para birimi başına net etki özeti
    if (summary) {
        const totals = new Map();
        rows.forEach(r => {
            if (!totals.has(r.currency)) totals.set(r.currency, { neg: 0, pos: 0 });
            const t = totals.get(r.currency);
            if (r.money < 0) t.neg += r.money; else t.pos += r.money;
        });
        const noCardChip = noCard.length ? (() => {
            const did = regDetail({
                title: 'Anlaşılan fiyatı olmayan satışlar',
                subtitle: `${noCard.length} ürün/müşteri kombinasyonu — en son satılan en üstte. `
                    + `Bu ürünler için Müşteri Sabit Fiyatlar'da fiyat kartı açılmalı.`,
                html: () => productsTable(
                    noCard.map(e => ({ ...e, label: { ...e.label, name: `${customerName(e.customerId)} — ${e.label.name}` } })),
                    noCard[0].currency),
            });
            return `<div data-detail="${did}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:8px;background:var(--warn-soft);border:1px solid var(--warn);color:var(--warn);font-size:11px;font-weight:600;">
                <i class="fa-solid fa-circle-exclamation" style="font-size:11px;"></i>
                ${noCard.length} üründe anlaşılan fiyat yok
                <i class="fa-solid fa-chevron-right" style="font-size:9px;opacity:.7;"></i>
            </div>`;
        })() : '';

        // Elenen işaretli kalemler sessizce kaybolmasın — raporun neyi
        // kapsamadığı ekranda yazsın.
        const flaggedChip = excluded ? `<div title="Bedelsiz gönderim ya da fiyatı bir Credit Note nedeniyle düzenlenmiş kalemler. Tutarları temsilidir; anlaşılan fiyatla karşılaştırılmazlar. Ciro toplamlarında yer almaya devam ederler." style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-soft);color:var(--ink-3);font-size:11px;font-weight:600;">
                <i class="fa-solid fa-gift" style="font-size:10px;"></i>
                ${excluded} kalem işaretli olduğu için sapma dışı
            </div>` : '';

        summary.innerHTML = (totals.size || noCardChip || flaggedChip)
            ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">` + noCardChip + flaggedChip +
              sortCurrencies([...totals.keys()]).map(cur => {
                  const t = totals.get(cur);
                  return `<div style="display:flex;align-items:baseline;gap:8px;padding:7px 12px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-soft);">
                      <span class="cur-name">${cur}</span>
                      <span class="num" style="color:var(--danger);font-weight:600;">${fmtMoney(t.neg, cur)}</span>
                      <span style="font-size:10px;color:var(--ink-3);">altında</span>
                      <span class="num" style="color:var(--ok);font-weight:600;">+${fmtMoney(t.pos, cur)}</span>
                      <span style="font-size:10px;color:var(--ink-3);">üstünde</span>
                  </div>`;
              }).join('') + `</div>`
            : '';
    }

    if (!rows.length) {
        body.innerHTML = `<div class="empty">
            Bu filtrelerle anlaşılan fiyattan %${DEVIATION_MIN_PCT}'den fazla sapma bulunamadı.
        </div>`;
    } else {
        body.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Müşteri</th>
                    <th>Ürün</th>
                    <th>Geçerli Dönem</th>
                    <th style="text-align:right;">Anlaşılan</th>
                    <th style="text-align:right;">Gerçek Ort.</th>
                    <th style="text-align:right;">Fark</th>
                    <th style="text-align:right;">Adet</th>
                    <th style="text-align:right;">Para Etkisi</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => {
                    const under = r.money < 0;
                    const color = under ? 'var(--danger)' : 'var(--ok)';
                    const did = regDetail({
                        title: `${r.companyName} — ${r.label.name}`,
                        subtitle: `Anlaşılan ${fmtMoney(r.agreed, r.currency)}${r.since ? ` (${fmtDate(r.since)}'den beri)` : ''}`
                            + ` &middot; gerçekleşen ortalama ${fmtMoney(r.actualAvg, r.currency)}`
                            + ` &middot; ${r.qty.toLocaleString('tr-TR')} adet &middot; para etkisi ${r.money > 0 ? '+' : ''}${fmtMoney(r.money, r.currency)}`,
                        html: () => linesTable(r.lines, r.currency, { showProduct: false, showCustomer: false }),
                    });
                    return `
                    <tr data-detail="${did}">
                        <td style="font-weight:500;">${escHtml(r.companyName)}<i class="fa-solid fa-chevron-right go"></i></td>
                        <td>
                            <div>${escHtml(r.label.name)}</div>
                            ${r.label.code ? `<div class="prow-sub">${escHtml(r.label.code)}</div>` : ''}
                        </td>
                        <td style="font-size:11px;color:var(--ink-2);white-space:nowrap;">
                            ${r.since
                                ? `${fmtDate(r.since)}'den beri${r.version === 2 ? ' <span class="badge b-info">v.2</span>' : ''}`
                                : `<span class="badge b-warn" title="Fiyat kartında tarih girilmemiş — hangi dönemi kapsadığı bilinmiyor, karşılaştırma yaklaşıktır.">tarihsiz</span>`}
                        </td>
                        <td class="num">${fmtMoney(r.agreed, r.currency)}</td>
                        <td class="num">${fmtMoney(r.actualAvg, r.currency)}</td>
                        <td class="num" style="color:${color};font-weight:600;">
                            ${r.diffPct > 0 ? '+' : ''}${r.diffPct.toFixed(1)} %
                        </td>
                        <td class="num">${r.qty.toLocaleString('tr-TR')}</td>
                        <td class="num" style="color:${color};font-weight:600;">
                            ${under ? '<i class="fa-solid fa-arrow-down" style="font-size:9px;margin-right:3px;"></i>' : ''}${r.money > 0 ? '+' : ''}${fmtMoney(r.money, r.currency)}
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
    }

    renderNoCardList(noCard);
    renderBeforeCardList(beforeCard);
    renderMissingListPrices(cardView);
}

// Satışı olan ama anlaşılan fiyatı bulunmayan kombinasyonlar — "fiyat kartı aç"
// listesi. Kartın para birimi satışınkinden farklıysa da buraya düşer.
function renderNoCardList(noCard) {
    const wrap  = document.getElementById('dev-nocard-wrap');
    const label = document.getElementById('dev-nocard-label');
    const body  = document.getElementById('dev-nocard-body');
    if (!wrap) return;

    if (!noCard.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    const byCustomer = new Map();
    noCard.forEach(e => {
        const k = `${e.customerId}|${e.currency}`;
        if (!byCustomer.has(k)) {
            byCustomer.set(k, {
                name: customerName(e.customerId), currency: e.currency,
                revenue: 0, entries: [], lastSale: null,
            });
        }
        const c = byCustomer.get(k);
        c.revenue += e.revenue;
        c.entries.push(e);
        if (e.lastSale && (!c.lastSale || e.lastSale > c.lastSale)) c.lastSale = e.lastSale;
    });

    // EN SON SATIŞA göre sıralanır (ciroya değil): amaç "hangi müşteriye yeni bir
    // ürün satılmış ama fiyat kartı açılmamış" sorusunu en üstte göstermek.
    const list = [...byCustomer.values()]
        .sort((a, b) => String(b.lastSale || '').localeCompare(String(a.lastSale || '')));
    label.textContent = `Anlaşılan fiyatı olmayan satışlar — ${noCard.length} ürün/müşteri kombinasyonu`;

    body.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">
            Bu satışlar için Müşteri Sabit Fiyatlar'da eşleşen bir fiyat kartı yok
            (kart hiç açılmamış ya da kartın para birimi satıştan farklı). Sapma raporuna giremezler.
            <strong>En son satılan en üstte</strong> — bir müşteriye yeni bir ürün satıldığında burada belirir.
            Satıra tıklayarak hangi ürün olduğunu görebilirsiniz.
        </div>
        ${list.map(c => {
            const did = regDetail({
                title: `${c.name} — anlaşılan fiyatı olmayan ürünler`,
                subtitle: `${c.entries.length} ürün &middot; ${c.currency} &middot; toplam ${fmtMoney(c.revenue, c.currency)}`
                    + ` &middot; bu ürünler için Müşteri Sabit Fiyatlar'da ${c.currency} kartı açılmalı`,
                html: () => productsTable(c.entries, c.currency, { addForCustomer: c.entries[0]?.customerId }),
            });
            return `
        <div class="prow" data-detail="${did}">
            <div style="flex:1;min-width:0;">
                <div class="prow-name">${escHtml(c.name)}<i class="fa-solid fa-chevron-right go"></i></div>
                <div class="prow-sub">${c.entries.length} ürün &middot; ${c.currency}${c.lastSale ? ` &middot; son satış ${fmtDate(c.lastSale)}` : ''}</div>
            </div>
            <div class="num" style="font-weight:600;">${fmtMoney(c.revenue, c.currency)}</div>
        </div>`;
        }).join('')}`;
}

// Fiyat kartının geçerlilik tarihinden ÖNCEKİ satışlar. O tarihte hangi fiyatın
// anlaşıldığı sistemde tutulmuyor, bu yüzden sapma hesabına giremezler —
// bugünkü fiyatla karşılaştırmak sahte kayıp üretirdi.
function renderBeforeCardList(list) {
    const wrap  = document.getElementById('dev-before-wrap');
    const label = document.getElementById('dev-before-label');
    const body  = document.getElementById('dev-before-body');
    if (!wrap) return;

    if (!list.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    label.textContent = `Fiyat kartı yürürlüğe girmeden önceki satışlar — ${list.length} ürün/müşteri kombinasyonu`;
    body.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">
            Bu satışlar, ilgili fiyat kartının geçerlilik tarihinden öncesine ait. O tarihte hangi fiyatın
            anlaşıldığı sistemde tutulmadığı için sapma hesabına dahil edilmediler — bugünkü fiyatla
            karşılaştırmak yanlış olurdu.
        </div>
        ${list.map(b => {
            const who = b.companyName || customerName(b.customerId);
            const did = regDetail({
                title: `${who} — ${b.label.name}`,
                subtitle: `${b.qty.toLocaleString('tr-TR')} adet &middot; ${fmtMoney(b.revenue, b.currency)}`
                    + (b.since ? ` &middot; fiyat kartı ${fmtDate(b.since)} tarihinden geçerli, aşağıdaki satışlar bu tarihten önce` : ''),
                html: () => linesTable(b.lines, b.currency, { showProduct: false, showCustomer: false }),
            });
            return `
        <div class="prow" data-detail="${did}">
            <div style="flex:1;min-width:0;">
                <div class="prow-name">${escHtml(who)} &middot; ${escHtml(b.label.name)}<i class="fa-solid fa-chevron-right go"></i></div>
                <div class="prow-sub">${b.qty.toLocaleString('tr-TR')} adet${b.since ? ` &middot; kart ${fmtDate(b.since)}'den geçerli` : ''}</div>
            </div>
            <div class="num" style="font-weight:600;">${fmtMoney(b.revenue, b.currency)}</div>
        </div>`;
        }).join('')}`;
}

// Liste fiyatı 0 olan kartlar: iskonto yüzdesi hesaplanamaz, Fiyat Robotu'nda
// da karşılığı yok demektir. Sapma hesabını engellemez ama eksiktir.
function renderMissingListPrices(cardView) {
    const wrap  = document.getElementById('dev-nolist-wrap');
    const label = document.getElementById('dev-nolist-label');
    const body  = document.getElementById('dev-nolist-body');
    if (!wrap) return;

    const missing = cardView.filter(c => c.listPrice <= 0);
    if (!missing.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    const byCustomer = new Map();
    missing.forEach(c => {
        if (!byCustomer.has(c.customerId)) byCustomer.set(c.customerId, { name: c.companyName, count: 0 });
        byCustomer.get(c.customerId).count += 1;
    });
    const list = [...byCustomer.values()].sort((a, b) => b.count - a.count);

    label.textContent = `Liste fiyatı girilmemiş fiyat kartları — ${missing.length} satır, ${list.length} müşteri`;
    body.innerHTML = `
        <div class="hint" style="margin-bottom:8px;">
            Bu satırlarda liste fiyatı 0 olduğu için iskonto yüzdesi hesaplanamıyor.
            Sapma raporu yine de çalışır (anlaşılan net fiyat üzerinden), ama iskonto karşılaştırması yapılamaz.
        </div>
        ${list.map(c => `
        <div class="prow">
            <div style="flex:1;">${escHtml(c.name)}</div>
            <div class="num">${c.count} satır</div>
        </div>`).join('')}`;
}

// ── 3) MÜŞTERİLER ARASI FİYAT TUTARSIZLIĞI ───────────────────────────────────

function renderSpread(cardView) {
    const body  = document.getElementById('spread-body');
    const badge = document.getElementById('spread-count');
    if (!body) return;

    const groups = new Map();
    cardView.forEach(c => {
        if (c.agreed <= 0) return;
        const gk = `${c.key}|${c.currency}`;
        if (!groups.has(gk)) groups.set(gk, { label: c.label, currency: c.currency, entries: [] });
        groups.get(gk).entries.push({
            customerId: c.customerId, name: c.companyName,
            price: c.agreed, marked: c.markedSymbolic,
        });
    });

    const rows = [];
    let symbolicOnly = 0;   // sembolik dışında tek fiyatı olan ürün sayısı
    groups.forEach(g => {
        // aynı müşterinin birden fazla satırı varsa tek sayılır
        const byCustomer = new Map();
        g.entries.forEach(e => {
            if (!byCustomer.has(e.customerId)) byCustomer.set(e.customerId, e);
        });
        if (byCustomer.size < 2) return;

        const list = [...byCustomer.values()];
        const marked = list.filter(e => e.marked);
        const prices = list.map(e => e.price);

        // SEMBOLİK FİYATLAR: medyanın onda birinin altındaki bir kayıt pazarlık
        // sonucu değildir — bedelsiz/numune verilen ürünler için girilen temsili
        // tutarlar (1,00 € gibi) ya da ondalık hatası (104,00 yerine 1,04).
        // İstatistiği tamamen bozuyorlardı, bu yüzden min/max/ort/fark hesabının
        // DIŞINDA tutulur ama satırda görünür kalırlar.
        // Kullanıcı "Bedelsiz / Numune" işaretlediyse sezgisel kurala hiç
        // gerek yok — işaret kesin bilgidir, eşik ise yaklaşıktır.
        const median = medianOf(prices);
        const symbolic = marked.length
            ? marked
            : (median > 0 ? list.filter(e => e.price < median * SYMBOLIC_RATIO) : []);
        const symbolicSource = marked.length ? 'isaret' : 'esik';
        const effective = list.filter(e => !symbolic.includes(e));

        // Sembolikler çıkınca geriye tek gerçek fiyat kalıyorsa ortada bir
        // TUTARSIZLIK yoktur — o ürünün tek anlaşılan fiyatı var, yanındaki
        // 1,00 € bedelsiz kaydı. Böyle satırlar listeye hiç girmez, yoksa
        // "%96 fark" diye sahte bir bulgu üretiyorlardı.
        if (effective.length < 2) { symbolicOnly += symbolic.length ? 1 : 0; return; }

        const useList = effective;
        const usePrices = useList.map(e => e.price);

        const uMin = Math.min(...usePrices);
        const uMax = Math.max(...usePrices);
        const uAvg = usePrices.reduce((a, b) => a + b, 0) / usePrices.length;
        const uSpread = uMax > 0 ? ((uMax - uMin) / uMax) * 100 : 0;

        rows.push({
            label: g.label, currency: g.currency,
            min: uMin, max: uMax, avg: uAvg, spread: uSpread, count: useList.length,
            minName: useList.find(e => e.price === uMin)?.name || '',
            maxName: useList.find(e => e.price === uMax)?.name || '',
            symbolic, symbolicSource,
            statsExcludeSymbolic: effective.length >= 2 && symbolic.length > 0,
            all: list,
        });
    });

    const flagged = rows.filter(r => r.spread > SPREAD_WARN_PCT).length;
    const symbolicCount = rows.filter(r => r.symbolic.length).length;
    if (badge) {
        badge.textContent = rows.length
            ? `${flagged} / ${rows.length} ürün eşiğin üstünde`
              + (symbolicCount ? ` · ${symbolicCount} üründe sembolik fiyat` : '')
              + (symbolicOnly ? ` · ${symbolicOnly} ürün listelenmedi` : '')
            : '0 ürün';
    }

    if (!rows.length) {
        body.innerHTML = `<div class="empty">
            Karşılaştırılacak yeterli kayıt yok — aynı ürün için en az iki müşteride anlaşılan fiyat gerekli.
        </div>`;
        return;
    }

    const byCurrency = new Map();
    rows.forEach(r => {
        if (!byCurrency.has(r.currency)) byCurrency.set(r.currency, []);
        byCurrency.get(r.currency).push(r);
    });

    body.innerHTML = sortCurrencies([...byCurrency.keys()]).map(cur => {
        const list = byCurrency.get(cur).sort((a, b) => b.spread - a.spread);
        const max = Math.max(...list.map(r => r.max), 1);
        const curFlagged = list.filter(r => r.spread > SPREAD_WARN_PCT).length;

        return `
        <div class="cur-block">
            <div class="cur-head">
                <span class="cur-name">${cur} ${CURRENCY_SYMBOLS[cur] || ''}</span>
                <span class="cur-meta">${list.length} ürün · ${curFlagged} tanesi %${SPREAD_WARN_PCT} üstü</span>
            </div>
            ${list.map(r => {
                const bad = r.spread > SPREAD_WARN_PCT;
                const left  = ((r.min / max) * 100).toFixed(1);
                const width = Math.max(((r.max - r.min) / max) * 100, 1).toFixed(1);
                const did = regDetail({
                    title: r.label.name,
                    subtitle: `${r.label.code ? escHtml(r.label.code) + ' &middot; ' : ''}${r.all.length} müşteride anlaşılan fiyat &middot; ${cur}`
                        + (r.statsExcludeSymbolic
                            ? ` &middot; ${r.symbolic.length} ${r.symbolicSource === 'isaret' ? 'bedelsiz işaretli' : 'sembolik'} kayıt istatistiğe dahil edilmedi`
                            : ''),
                    html: () => spreadCustomersTable(r, cur),
                });
                return `
                <div class="prow" data-detail="${did}">
                    <div style="flex:0 0 210px;min-width:0;">
                        <div class="prow-name" title="${escHtml(r.label.name)}">${escHtml(r.label.name)}<i class="fa-solid fa-chevron-right go"></i></div>
                        <div class="prow-sub">${r.count} müşteri${r.label.code ? ' &middot; ' + escHtml(r.label.code) : ''}</div>
                    </div>
                    <div class="bar" style="position:relative;">
                        <div class="bar-fill" style="position:absolute;left:${left}%;width:${width}%;"></div>
                    </div>
                    <div style="flex:0 0 auto;text-align:right;min-width:190px;">
                        <div class="num">
                            <span style="color:var(--ok);" title="${escHtml(r.minName)}">${fmtMoney(r.min, cur)}</span>
                            <span style="color:var(--ink-3);margin:0 3px;">—</span>
                            <span style="color:var(--danger);" title="${escHtml(r.maxName)}">${fmtMoney(r.max, cur)}</span>
                        </div>
                        <div class="prow-sub">ort: ${fmtMoney(r.avg, cur)}</div>
                    </div>
                    ${r.symbolic.length ? `
                    <span class="badge b-muted" title="Diğerlerinin çok altında kalan temsili fiyatlar (bedelsiz/numune ya da ondalık hatası): ${escHtml(r.symbolic.map(e => `${e.name} (${fmtMoney(e.price, cur)})`).join(', '))}${r.statsExcludeSymbolic ? ' — aşağıdaki min/max/ort hesabına DAHİL EDİLMEDİ' : ''}">
                        <i class="fa-solid fa-gift" style="font-size:8px;"></i> ${r.symbolic.length} ${r.symbolicSource === 'isaret' ? 'bedelsiz' : 'sembolik'}
                    </span>` : ''}
                    <span class="badge ${bad ? 'b-bad' : 'b-ok'}">
                        ${bad
                            ? `<i class="fa-solid fa-triangle-exclamation" style="font-size:8px;"></i> % ${r.spread.toFixed(0)} fark`
                            : `<i class="fa-solid fa-check" style="font-size:8px;"></i> tutarlı`}
                    </span>
                </div>`;
            }).join('')}
        </div>`;
    }).join('');
}

// ── Yardımcılar ──────────────────────────────────────────────────────────────

// ── Detay penceresi tablo kurucuları ────────────────────────────────────────

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

function orderRef(orderId) {
    const o = orderById.get(orderId);
    if (!o) return { no: '—', date: null, customer: '—' };
    return {
        no: o.order_number || '—',
        date: o.order_date || null,
        customer: customerName(o.customer_id),
    };
}

// Sipariş kalemi listesi — sapma / satış satırlarının arkasındaki ham kayıtlar.
function linesTable(lines, currency, { showProduct = true, showCustomer = true } = {}) {
    const sorted = [...lines].sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || '')));
    const headers = [{ t: 'Tarih' }, { t: 'Sipariş No' }];
    if (showCustomer) headers.push({ t: 'Müşteri' });
    if (showProduct)  headers.push({ t: 'Ürün' });
    headers.push({ t: 'Adet', right: true }, { t: 'Birim Fiyat', right: true }, { t: 'Tutar', right: true });

    return detailTable(headers, sorted.map(l => {
        const ref = orderRef(l.orderId);
        return `<tr>
            <td style="white-space:nowrap;">${fmtDate(l.orderDate)}</td>
            <td style="font-family:monospace;font-size:11px;">${escHtml(ref.no)}</td>
            ${showCustomer ? `<td>${escHtml(ref.customer)}</td>` : ''}
            ${showProduct ? `<td>${escHtml(l.label.name)}${l.label.code ? `<div class="prow-sub">${escHtml(l.label.code)}</div>` : ''}</td>` : ''}
            <td class="num">${l.qty.toLocaleString('tr-TR')}</td>
            <td class="num">${fmtMoney(l.unitPrice, currency)}${linePriceFlag(l)}</td>
            <td class="num" style="font-weight:600;">${fmtMoney(l.revenue, currency)}</td>
        </tr>`;
    }));
}

// Ciro tablosunda işaretli satır: rakam doğru ama pazarlık fiyatı değil.
// Ürünün "ort." fiyatını aşağı çekmesinin sebebi burada görünsün.
function linePriceFlag(l) {
    if (!l.priceless) return '';
    const txt = l.isFree ? 'bedelsiz' : 'CN fiyatı';
    const tip = l.isFree
        ? 'Bedelsiz gönderim — birim fiyat temsilidir, fiyat sapma raporuna katılmaz.'
        : 'Fiyat bir Credit Note nedeniyle düzenlenmiş — fiyat sapma raporuna katılmaz.';
    return `<div class="prow-sub" title="${escHtml(tip)}" style="color:var(--ink-3);">${txt}</div>`;
}

// Sipariş listesi — mutabakat adımlarının arkasındaki siparişler.
function ordersTable(orders, currency, itemsByOrder, { showItemsTotal = false } = {}) {
    const sorted = [...orders].sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || '')));
    const headers = [{ t: 'Tarih' }, { t: 'Sipariş No' }, { t: 'Müşteri' }, { t: 'Sipariş Tutarı', right: true }];
    if (showItemsTotal) headers.push({ t: 'Kalem Toplamı', right: true }, { t: 'Fark', right: true }, { t: 'Oran', right: true });

    return detailTable(headers, sorted.map(o => {
        const tot = parseFloat(o.total_amount) || 0;
        const itemsTot = (itemsByOrder.get(o.id) || [])
            .reduce((sum, it) => sum + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0);
        const diff = itemsTot - tot;
        return `<tr>
            <td style="white-space:nowrap;">${fmtDate(o.order_date)}</td>
            <td style="font-family:monospace;font-size:11px;">${escHtml(o.order_number || '—')}</td>
            <td>${escHtml(customerName(o.customer_id))}</td>
            <td class="num">${fmtMoney(tot, currency)}</td>
            ${showItemsTotal ? `
            <td class="num">${fmtMoney(itemsTot, currency)}</td>
            <td class="num" style="font-weight:600;color:${diff < 0 ? 'var(--danger)' : 'var(--ok)'};">
                ${diff > 0 ? '+' : ''}${fmtMoney(diff, currency)}
            </td>
            <td class="num" title="Sipariş tutarı ÷ kalem toplamı. 1,2000 = KDV dahil girilmiş.">
                ${itemsTot > 0 ? (tot / itemsTot).toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '—'}
            </td>` : ''}
        </tr>`;
    }));
}

// Ürün kırılımı — "anlaşılan fiyatı olmayan satışlar" gibi müşteri satırları için.
// Müşteri Sabit Fiyatlar'da o müşterinin kartını açıp bu ürünü forma doldurur.
// Fiyat kartı eksik bir ürünü görüp aynı yerden eklemek için — modülü terk edip
// müşteriyi ve ürünü elle aramak gerekmiyor.
function clientPriceLink(customerId, entry, currency) {
    const params = new URLSearchParams({ customer: customerId, currency });
    if (entry.label.code) params.set('code', entry.label.code);
    else params.set('name', entry.label.name);
    if (entry.qty > 0) params.set('net', (entry.revenue / entry.qty).toFixed(2));
    return `client-prices.html?${params.toString()}`;
}

function productsTable(entries, currency, { addForCustomer = null } = {}) {
    const sorted = [...entries].sort((a, b) => String(b.lastSale || '').localeCompare(String(a.lastSale || '')));
    const headers = [{ t: 'Ürün' }, { t: 'Stok Kodu' }, { t: 'Adet', right: true }, { t: 'Ort. Fiyat', right: true },
                     { t: 'Ciro', right: true }, { t: 'İlk Satış' }, { t: 'Son Satış' }];
    if (addForCustomer) headers.push({ t: '' });

    return detailTable(headers, sorted.map(e => {
        const cid = addForCustomer || e.customerId;
        return `<tr>
            <td style="font-weight:500;">${escHtml(e.label.name)}</td>
            <td style="font-family:monospace;font-size:11px;">${escHtml(e.label.code || '—')}</td>
            <td class="num">${e.qty.toLocaleString('tr-TR')}</td>
            <td class="num">${fmtMoney(e.revenue / e.qty, currency)}</td>
            <td class="num" style="font-weight:600;">${fmtMoney(e.revenue, currency)}</td>
            <td style="white-space:nowrap;">${fmtDate(e.firstSale)}</td>
            <td style="white-space:nowrap;">${fmtDate(e.lastSale)}</td>
            ${addForCustomer ? `<td style="white-space:nowrap;">
                <a href="${clientPriceLink(cid, e, currency)}" target="_blank" rel="noopener"
                   style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;
                          border:1px solid var(--accent);background:var(--accent-soft);color:var(--accent);
                          font-size:10px;font-weight:600;text-decoration:none;white-space:nowrap;">
                    <i class="fa-solid fa-plus" style="font-size:9px;"></i> Sabit Fiyatlara ekle
                </a>
            </td>` : ''}
        </tr>`;
    }));
}

function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return (d && m && y) ? `${d}.${m}.${y}` : String(iso);
}

// Bir ürün için müşteri × anlaşılan fiyat kırılımı.
function spreadCustomersTable(r, currency) {
    const sorted = [...r.all].sort((a, b) => b.price - a.price);
    const isSymbolic = e => r.symbolic.includes(e);
    return detailTable(
        [{ t: 'Müşteri' }, { t: 'Anlaşılan Fiyat', right: true }, { t: 'Ortalamadan Fark', right: true }, { t: '' }],
        sorted.map(e => {
            const diff = r.avg > 0 ? ((e.price - r.avg) / r.avg) * 100 : 0;
            const sym = isSymbolic(e);
            return `<tr>
                <td style="font-weight:500;">${escHtml(e.name)}</td>
                <td class="num" style="font-weight:600;">${fmtMoney(e.price, currency)}</td>
                <td class="num" style="color:${sym ? 'var(--ink-3)' : (diff < 0 ? 'var(--danger)' : 'var(--ok)')};">
                    ${sym ? '—' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)} %`}
                </td>
                <td>${sym
                    ? `<span class="badge b-muted"><i class="fa-solid fa-gift" style="font-size:8px;"></i> ${e.marked ? 'bedelsiz işaretli' : 'sembolik (tahmin)'} — istatistik dışı</span>`
                    : ''}</td>
            </tr>`;
        }));
}

function medianOf(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sortCurrencies(list) {
    return [...list].sort((a, b) => {
        const ia = CURRENCY_ORDER.indexOf(a);
        const ib = CURRENCY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
}

// Müşteri adları customers tablosundan gelir: "fiyat kartı olmayan satışlar"
// listesindeki müşterilerin tanımı gereği customer_prices'ta karşılığı yoktur.
function customerName(customerId) {
    return customerNameCache.get(customerId) || 'Bilinmeyen müşteri';
}

// Tutarlar HER ZAMAN tam yazılır. Aynı sütunda "10,1 B" ile "9.992,16"nın yan
// yana gelmesi okumayı zorlaştırıyordu; bu bir muhasebe raporu, kısaltma değil
// kesinlik istiyor.
function fmtMoney(value, currency) {
    const n = Number(value);
    if (!isFinite(n)) return '—';
    return trNum(n, 2) + ' ' + sym(currency);
}

function trNum(n, digits) {
    return n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function sym(currency) {
    return CURRENCY_SYMBOLS[currency] || currency || '';
}

function showError(message) {
    const banner = document.getElementById('error-banner');
    const text = document.getElementById('error-text');
    if (text) text.textContent = message;
    banner?.classList.add('show');
    // Bölümlerdeki sonsuz spinner'ları temizle.
    ['sales-body', 'dev-body', 'spread-body'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<div class="empty">Veri yüklenemedi.</div>`;
    });
    ['sales-coverage', 'dev-count', 'spread-count'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
    });
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
