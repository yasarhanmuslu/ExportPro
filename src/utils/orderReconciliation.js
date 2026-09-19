// orderReconciliation.js — "Sipariş tutarlarıyla mutabakat" köprüsü.
//
// Siparişler ekranı ve Dashboard, sipariş kapağına elle girilen `total_amount`
// alanını toplar. Satış & Fiyat Analizi ve Ürün Analizi ise fiilen girilmiş
// `order_items` kalemlerini toplar. İki rakam bu projede FİİLEN uyuşmuyor
// (KDV dahil girilmiş tutarlar, kalemi girilmemiş siparişler, fatura altı
// indirim, gizlenen 1 adetlik satırlar...). Bu köprü farkı adım adım gösterir.
//
// Hesap ve görünüm tek yerde: iki modül aynı köprüyü göstermeli, kopyalar
// zamanla birbirinden koparlar.

export const VAT_RATE = 0.20;
// Sipariş tutarı, kalem toplamının tam 1,20 katıysa fark KDV'dir, veri hatası
// değil. Canlı veride TRY siparişlerinin tamamı böyle girilmiş.
export const VAT_TOLERANCE = 0.005;   // oranda ±%0,5

const EXCLUDED_PAYMENT = 'Bedelsiz';
const EXCLUDED_STATUS  = 'İptal';
const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
const CURRENCY_ORDER   = ['EUR', 'USD', 'TRY', 'GBP'];

const lineAmount = it => (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0);

// orders / items: ham tablolar. year: 'ALL' ya da '2026'. currencyAllowed(cur).
// shownByCurrency: Map(cur -> sayfanın gösterdiği ciro) — köprünün son satırı.
// Dönen adımlardaki `lines` ham { item, order } çiftleridir; sayfa kendi kalem
// tablosuyla çizer.
export function buildOrderReconciliation({ orders, items, year, currencyAllowed, hideSingles, shownByCurrency }) {
    const itemsByOrder = new Map();
    items.forEach(it => {
        if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
        itemsByOrder.get(it.order_id).push(it);
    });
    const orderYear = o => (o.order_date ? String(o.order_date).slice(0, 4) : null);

    const currencies = sortCurrencies([...new Set(
        orders.map(o => o.currency).filter(c => c && currencyAllowed(c))
    )]);

    return currencies.map(cur => {
        // Yıl filtresi uygulanmış, ama İptal/Bedelsiz HENÜZ çıkarılmamış küme.
        const base = orders.filter(o => o.currency === cur && (year === 'ALL' || orderYear(o) === year));
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
                    if ((parseFloat(it.quantity) || 0) === 1) { singles += amt; singleLines.push({ item: it, order: o }); }
                } else {
                    itemsOther += amt;
                    otherCurLines.push({ item: it, order: o });
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

        const sumDiff = list => list.reduce((sum, o) => {
            const tot = (itemsByOrder.get(o.id) || []).reduce((t, it) => t + lineAmount(it), 0);
            return sum + (tot - (parseFloat(o.total_amount) || 0));
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
        if (hideSingles && singles > 0.005) { running -= singles; steps.push({ t: 'Gizlenen 1 adetlik satırlar', v: -singles, lines: singleLines }); }

        const shown = shownByCurrency.get(cur) || 0;
        return { cur, start, steps, end: running, shown, ok: Math.abs(running - shown) < 0.05, itemsByOrder };
    }).filter(Boolean);
}

// Köprüyü çizer. regDetail: sayfanın detay penceresi kaydı; customerName(id);
// renderLines(pairs, cur): { item, order } çiftlerini sayfanın kalem tablosuyla çizer.
// Dönüş: { label, html } — boşsa null.
export function renderOrderReconciliation(blocks, { regDetail, customerName, renderLines }) {
    blocks = blocks.filter(b => b.steps.length);
    if (!blocks.length) return null;

    const warnCount = blocks.reduce((n, b) => n + b.steps.filter(x => x.warn).length, 0);
    const label = `Sipariş tutarlarıyla mutabakat${warnCount ? ` — ${warnCount} veri uyuşmazlığı` : ''}`;

    const html = `
        <div class="hint" style="margin-bottom:8px;">
            Siparişler ekranı ve Dashboard, sipariş kapağına elle girilen <em>tutar</em> alanını toplar.
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
                                ? ordersTable(st.orders, b.cur, b.itemsByOrder, customerName, { showItemsTotal: !!st.withItemsTotal })
                                : renderLines(st.lines, b.cur),
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

    return { label, html };
}

// Mutabakat adımlarının arkasındaki siparişler.
function ordersTable(orders, currency, itemsByOrder, customerName, { showItemsTotal = false } = {}) {
    if (!orders.length) return '<div class="empty">Kayıt yok.</div>';
    const sorted = [...orders].sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || '')));
    const headers = ['Tarih', 'Sipariş No', 'Müşteri', '>Sipariş Tutarı'];
    if (showItemsTotal) headers.push('>Kalem Toplamı', '>Fark', '>Oran');

    const rows = sorted.map(o => {
        const tot = parseFloat(o.total_amount) || 0;
        const itemsTot = (itemsByOrder.get(o.id) || []).reduce((sum, it) => sum + lineAmount(it), 0);
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
    });

    return `
    <div class="scroll-x">
        <table class="data-table">
            <thead><tr>${headers.map(h => h.startsWith('>')
                ? `<th style="text-align:right;">${escHtml(h.slice(1))}</th>`
                : `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>
    </div>`;
}

function sortCurrencies(list) {
    return [...list].sort((a, b) => {
        const ia = CURRENCY_ORDER.indexOf(a);
        const ib = CURRENCY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
}

function fmtMoney(value, currency) {
    const n = Number(value);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        + ' ' + (CURRENCY_SYMBOLS[currency] || currency || '');
}

function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return (d && m && y) ? `${d}.${m}.${y}` : String(iso);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
