import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext } from './utils/permissions.js';
import { buildReceivables, isCancelled, isFreeShipment, round2 } from './utils/receivables.js';

let monthlyChartInstance = null;
let currencyChartInstance = null;
let currentSession = null;
let accessCtx = null;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    currentSession = session;
    accessCtx = await getAccessContext();
    await renderNavbar('dashboard', accessCtx);
    initYearSelector();
});

function initYearSelector() {
    const yearSelect = document.getElementById('year-select');
    const currentYear = new Date().getFullYear();
    for (let i = 0; i < 5; i++) {
        const option = document.createElement('option');
        option.value = currentYear - i;
        option.textContent = currentYear - i;
        yearSelect.appendChild(option);
    }
    yearSelect.addEventListener('change', () => loadAllDashboardData(parseInt(yearSelect.value)));
    loadAllDashboardData(currentYear);
}

// ── ORTAK YARDIMCILAR ────────────────────────────────────────
const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
const sym = c => CURRENCY_SYMBOLS[c] || c || '';
const money = (v, digits = 2) =>
    (v || 0).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Açık şikayet tanımı — complaints.js ile BİREBİR AYNI olmak zorunda:
// henüz bir siparişe işlenmemiş ve iptal edilmemiş Credit Note'lar.
// (Pano önceden yalnızca 'İncelemede' sayıyordu; o değerde kayıt olmadığı için
//  kart kalıcı olarak 0 gösteriyordu.)
const isOpenComplaint = cn =>
    cn.process_status !== 'Siparişe İşlendi' && cn.process_status !== 'İptal';

// Her kartın hangi dönemi gösterdiği başlıkta yazılı olsun — yıl seçicisi panonun
// yalnızca bir kısmını etkiliyor, geri kalanı bilerek tüm yılları kapsıyor.
function renderScopeTags(selectedYear) {
    document.querySelectorAll('.scope-tag').forEach(el => {
        el.textContent = el.dataset.scope === 'year' ? String(selectedYear) : 'Tüm yıllar';
    });
}

// ── ANA YÜKLEME ────────────────────────────────────────────────────────────────
async function loadAllDashboardData(selectedYear) {
    const uid = accessCtx.ownerId;
    renderScopeTags(selectedYear);
    try {
        const [
            ordersRes,
            quotationsRes,
            complaintsRes,
            customerScoreRes,
            profitabilityRes,
            invoicesRes
        ] = await Promise.all([
            supabase.from('orders')
                .select('*, customers!fk_orders_customer(company_name, country)')
                .eq('user_id', uid)
                .order('order_date', { ascending: false }),
            supabase.from('quotations')
                .select('id, status, total_amount, currency, quotation_date, customers!quotations_customer_id_fkey(company_name)')
                .eq('user_id', uid)
                .order('created_at', { ascending: false }),
            supabase.from('credit_notes')
                .select('id, process_status, cn_date, customer_id')
                .eq('user_id', uid),
            supabase.from('customers')
                .select('id, company_name, country, status')
                .eq('user_id', uid),
            supabase.from('customer_prices')
                .select('customer_id, discount_rate, customers!fk_customer_prices_customer(company_name)')
                .eq('user_id', uid),
            // Alacak faturayla doğar — açık / gecikmiş bakiye Ödeme Takibi ile aynı hesaptan gelsin.
            // Yetkisi olmayan kullanıcıda boş döner; hesap o zaman sipariş vadesiyle yapılır.
            supabase.from('order_invoices').select('*').eq('user_id', uid)
        ]);

        const orders      = ordersRes.data      || [];
        const quotations  = quotationsRes.data   || [];
        const complaints  = complaintsRes.data   || [];
        const customers   = customerScoreRes.data || [];
        const prices      = profitabilityRes.data || [];

        const yearOrders = orders.filter(o => new Date(o.order_date).getFullYear() === selectedYear);

        // Ödeme Takibi ile aynı alacak hesabı: faturalanmış açık kalemler; iptal, bedelsiz ve
        // manuel takipteki (ödeme tarihi belli olmayan) siparişler vade rakamlarına girmez.
        const invoices = invoicesRes.error ? [] : (invoicesRes.data || []);
        const manualIds = new Set(orders.filter(o => o.manual_tracking).map(o => o.id));
        const receivables = buildReceivables({ orders, invoices, customers });
        const recv = receivables.items.filter(i => !manualIds.has(i.orderId));

        renderFinanceKPIs(yearOrders, orders, recv);
        renderInvoicedRevenue(orders, invoices, selectedYear, invoicesRes.error);
        renderBalanceBridge(orders, receivables, manualIds, selectedYear);
        renderOperationalCards(yearOrders, quotations, complaints, orders);
        renderRecentOrders(yearOrders.slice(0, 5));
        renderRecentQuotations(quotations.slice(0, 5));
        renderPaymentStatus(orders, recv);
        renderTopCustomers(orders, customers);
        renderSecondaryModules(orders, complaints, prices, customers);
    	renderCustomerSummary(customers);
        renderCharts(yearOrders);

    } catch (err) {
        console.error('Dashboard veri çekme hatası:', err.message);
    }
}

// ── FİNANS KPI ────────────────────────────────────────────────────────────────
// Ciro / Tahsil: iptal ve bedelsiz siparişler hariç — ikisi de gerçek satış/tahsilat değil
// (bedelsizde "tahsil" temsili tutarın kapatılmasıdır). Ödeme Takibi ile aynı kapsam.
const isRevenueOrder = o => !isCancelled(o) && !isFreeShipment(o);

function renderFinanceKPIs(yearOrders, allOrders, recv) {
    const summary = {};
    yearOrders.filter(isRevenueOrder).forEach(order => {
        const curr = order.currency || 'EUR';
        if (!summary[curr]) summary[curr] = { total: 0, advance: 0, remaining: 0 };
        summary[curr].total     += parseFloat(order.total_amount)    || 0;
        summary[curr].advance   += parseFloat(order.advance_payment) || 0;
        summary[curr].remaining += parseFloat(order.remaining_balance) || 0;
    });

    // Vadeli Bakiye / Gecikmiş Borç: TÜM yıllar, Ödeme Takibi'nin alacak kalemlerinden
    // (fatura vadesi; henüz faturalanmamış, iptal, bedelsiz ve manuel takip hariç).
    const vadeBakiye = {}, pendingPay = {};
    recv.forEach(i => {
        const target = i.overdueDays > 0 ? pendingPay : vadeBakiye;
        target[i.currency] = (target[i.currency] || 0) + i.open;
    });

    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };
    const fmt = (v) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    function fillKPI(containerId, data, colorClass) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const currencies = Object.keys(data);
        if (currencies.length === 0) {
            el.innerHTML = `<div class="text-[#968B7A] text-xs">—</div>`;
            return;
        }
        el.innerHTML = currencies.map(curr => {
            const symbol = currencySymbols[curr] || curr;
            return `<div class="flex justify-between items-baseline gap-2">
                <span style="font-family:Verdana, Geneva, sans-serif;font-size:20px;font-weight:500;">${fmt(data[curr])}</span>
                <span class="text-xs font-semibold ${colorClass}">${symbol}</span>
            </div>`;
        }).join('');
    }

    const ciroData  = Object.fromEntries(Object.entries(summary).map(([k,v]) => [k, v.total]));
    const avansData = Object.fromEntries(Object.entries(summary).map(([k,v]) => [k, v.advance]));

    fillKPI('kpi-ciro-container',    ciroData,   'text-purple-500');
    fillKPI('kpi-avans-container',   avansData,  'text-[#3D6E50]');
    fillKPI('kpi-bakiye-container',  vadeBakiye, 'text-[#B26B33]');
    fillKPI('kpi-pending-container', pendingPay, 'text-[#9F3D3D]');
}

// ── FATURALANAN (Sipariş Cirosu kartının alt satırı) ─────────────────────────
// Sipariş Cirosu = sipariş tarihine göre (bu yıl ne kadar iş aldık).
// Faturalanan   = fatura tarihine göre (bu yıl ne kadar mal gönderip faturaladık).
// Faturalar sisteme 2026'da aktarıldı; önceki yıllar eksik olduğu için gösterilmez.
const FIRST_FULL_INVOICE_YEAR = 2026;

function renderInvoicedRevenue(orders, invoices, selectedYear, invoicesError) {
    const el = document.getElementById('kpi-ciro-invoiced');
    if (!el) return;
    if (invoicesError || selectedYear < FIRST_FULL_INVOICE_YEAR) { el.style.display = 'none'; return; }

    const orderById = new Map(orders.map(o => [o.id, o]));
    const byCur = {};
    invoices.forEach(inv => {
        const o = orderById.get(inv.order_id);
        if (!o || !isRevenueOrder(o)) return;
        if (String(inv.invoice_date || '').slice(0, 4) !== String(selectedYear)) return;
        // İhraç kayıtlı faturada tutar TL; sipariş para birimi karşılığı kullanılır
        const cur = o.currency || 'EUR';
        byCur[cur] = round2((byCur[cur] || 0) + (Number(inv.amount_order_currency ?? inv.amount) || 0));
    });

    const order = ['EUR', 'USD', 'TRY', 'GBP'];
    const parts = Object.keys(byCur)
        .sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9))
        .map(c => `<span style="white-space:nowrap;font-family:monospace;color:#6B655B;">${money(byCur[c])} ${sym(c)}</span>`);
    el.innerHTML = `<span style="font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Faturalanan (fatura tarihine göre):</span> ${parts.join(' · ') || '—'}`;
    el.style.display = '';
}

// ── BAKİYE KÖPRÜSÜ ────────────────────────────────────────────────────────────
// Üstteki dört kart farklı kapsamlardadır: Ciro / Tahsil seçili yılın siparişleri,
// Vadeli / Gecikmiş ise TÜM yılların FATURALANMIŞ alacakları (manuel takip hariç).
// Bu tablo "Ciro − Tahsil" farkını parçalarına ayırıp kartlarla bağlar. Para birimleri ayrı.
function renderBalanceBridge(orders, receivables, manualIds, selectedYear) {
    const el = document.getElementById('balance-bridge-body');
    if (!el) return;

    const orderById = new Map(orders.map(o => [o.id, o]));
    const inYear = id => new Date(orderById.get(id)?.order_date).getFullYear() === selectedYear;
    const b = {};
    const add = (cur, key, v) => {
        const c = cur || 'EUR';
        if (!b[c]) b[c] = {};
        b[c][key] = round2((b[c][key] || 0) + v);
    };

    orders.filter(o => isRevenueOrder(o) && new Date(o.order_date).getFullYear() === selectedYear).forEach(o => {
        add(o.currency, 'ciro', parseFloat(o.total_amount) || 0);
        add(o.currency, 'tahsil', parseFloat(o.advance_payment) || 0);
    });
    receivables.items.forEach(i => {
        const scope = inYear(i.orderId) ? 'y' : 'o';
        const kind = manualIds.has(i.orderId) ? 'Manuel' : (i.overdueDays > 0 ? 'Gecikmis' : 'Vadeli');
        add(i.currency, scope + kind, i.open);
    });
    receivables.pending.forEach(i => {
        const scope = inYear(i.orderId) ? 'y' : 'o';
        add(i.currency, scope + (manualIds.has(i.orderId) ? 'Manuel' : 'Faturasiz'), i.open);
    });

    const order = ['EUR', 'USD', 'TRY', 'GBP'];
    const currencies = Object.keys(b).sort((x, y) => (order.indexOf(x) + 1 || 9) - (order.indexOf(y) + 1 || 9));
    if (!currencies.length) { el.innerHTML = `<div class="text-[#968B7A] text-xs">Veri yok</div>`; return; }

    currencies.forEach(c => {
        const d = b[c];
        d.acik = round2((d.ciro || 0) - (d.tahsil || 0));
        // Fazla ödeme (müşteri avansı) ve yuvarlama: açık bakiyenin kalemlere dağılmayan kısmı
        d.yFark = round2(d.acik - (d.yVadeli || 0) - (d.yGecikmis || 0) - (d.yFaturasiz || 0) - (d.yManuel || 0));
        d.kartVadeli = round2((d.yVadeli || 0) + (d.oVadeli || 0));
        d.kartGecikmis = round2((d.yGecikmis || 0) + (d.oGecikmis || 0));
        d.manuelToplam = round2((d.yManuel || 0) + (d.oManuel || 0));
    });

    const any = key => currencies.some(c => Math.abs(b[c][key] || 0) > 0.05);
    const Y = selectedYear;
    const rows = [
        { key: 'ciro',       label: `Sipariş Cirosu (${Y} siparişleri)`, style: 'strong' },
        { key: 'tahsil',     label: '− Tahsil Edilen', color: '#3D6E50' },
        { key: 'acik',       label: `= ${Y} siparişlerinin açık bakiyesi`, style: 'total' },
        { key: 'yVadeli',    label: 'Faturalandı, vadesi gelmedi → Vadeli Bakiye', color: '#B26B33', indent: true },
        { key: 'yGecikmis',  label: 'Faturalandı, vadesi geçti → Gecikmiş Borç', color: '#9F3D3D', indent: true },
        { key: 'yFaturasiz', label: 'Henüz faturalanmadı (sevk bekliyor) — alacak değil', color: '#6B655B', indent: true },
        { key: 'yManuel',    label: 'Manuel takipte (ödeme tarihi belirsiz)', color: '#3F5C7A', indent: true },
        { key: 'yFark',      label: 'Fazla ödeme / yuvarlama', color: '#968B7A', indent: true, optional: true },
        { key: 'sep',        label: `Sipariş tarihi diğer yıllarda olan açıklar (kartlara dahil)`, style: 'section' },
        { key: 'oVadeli',    label: 'Vadesi gelmedi → Vadeli Bakiye', color: '#B26B33', indent: true, optional: true },
        { key: 'oGecikmis',  label: 'Vadesi geçti → Gecikmiş Borç', color: '#9F3D3D', indent: true },
        { key: 'oFaturasiz', label: 'Henüz faturalanmadı', color: '#6B655B', indent: true, optional: true },
        { key: 'oManuel',    label: 'Manuel takipte', color: '#3F5C7A', indent: true },
        { key: 'sep2',       label: 'Kartlardaki tutarlar (tüm yıllar)', style: 'section' },
        { key: 'kartVadeli',   label: 'Vadeli Bakiye kartı', color: '#B26B33', style: 'strong' },
        { key: 'kartGecikmis', label: 'Gecikmiş Borç kartı', color: '#9F3D3D', style: 'strong' },
        { key: 'manuelToplam', label: 'Manuel takip toplamı (kartlarda YOK → Ödeme Takibi › Manuel Alacaklar)', color: '#3F5C7A', style: 'strong' },
    ].filter(r => !r.optional || any(r.key));

    const cell = (c, r) => {
        const v = b[c][r.key] || 0;
        if (Math.abs(v) <= 0.005) return `<span style="color:#C9C1B3;">—</span>`;
        return `${money(v)} <span style="font-size:10px;">${sym(c)}</span>`;
    };
    // Ağaç işaretleri gizlenen satırlara göre: grubun son girintili satırı └
    rows.forEach((r, idx) => {
        if (r.indent) r.label = (rows[idx + 1]?.indent ? '├ ' : '└ ') + r.label;
    });
    const tr = r => {
        if (r.style === 'section') {
            return `<tr><td colspan="${currencies.length + 1}" style="padding:8px 6px 3px;font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;border-top:1px solid #EFEAE0;">${r.label}</td></tr>`;
        }
        const weight = r.style === 'strong' || r.style === 'total' ? 600 : 400;
        const border = r.style === 'total' ? 'border-top:1px solid #1C1A17;' : '';
        return `<tr>
            <td style="padding:3px 6px;font-size:11px;color:${r.color || '#1C1A17'};font-weight:${weight};${border}${r.indent ? 'padding-left:18px;' : ''}">${r.label}</td>
            ${currencies.map(c => `<td style="padding:3px 6px;text-align:right;font-family:monospace;font-size:12px;white-space:nowrap;color:${r.color || '#1C1A17'};font-weight:${weight};${border}">${cell(c, r)}</td>`).join('')}
        </tr>`;
    };

    el.innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
            <thead><tr>
                <th></th>
                ${currencies.map(c => `<th style="padding:2px 6px;text-align:right;font-size:10px;color:#968B7A;font-weight:600;">${c}</th>`).join('')}
            </tr></thead>
            <tbody>${rows.map(tr).join('')}</tbody>
        </table>
        <div style="font-size:10px;color:#968B7A;margin-top:6px;">
            İptal ve bedelsiz siparişler ciroya da alacağa da girmez. Para birimleri hiçbir satırda toplanmaz.
            Ayrıntı: Yardım &amp; Kılavuz › Dashboard.
        </div>`;
}

// ── OPERASYONEL KARTLAR ────────────────────────────────────────────────────────
// Bir siparişi "kapanmış" sayan etiketler — bunlardan biri varsa sevkiyat
// beklenmiyor demektir.
const CLOSED_TAGS = ['Sevk Edildi', 'Teslim Edildi', 'İptal'];

// Sevk bekleyen siparişin bulunduğu aşama. Etiketler üst üste binebildiği için
// (ör. "Devam Ediyor · Üretimde") sipariş TEK bir kovaya öncelik sırasıyla
// yazılır; böylece dağılım toplamı kart sayısına eşit çıkar.
const STAGE_PRIORITY = ['Sevke Hazır', 'Üretime Hazır', 'Üretimde', 'Devam Ediyor'];

function shipmentStage(tags) {
    for (const stage of STAGE_PRIORITY) { if (tags.includes(stage)) return stage; }
    return 'Diğer';   // aşama etiketi işaretlenmemiş — kart bunu görünür kılsın
}

function renderOperationalCards(yearOrders, quotations, complaints, orders) {
    // Mevcut Sipariş: seçili yıla ait sipariş sayısı
    const activeOrders = yearOrders.length;

    // Bekleyen teklifler
    const pendingQuotations = quotations.filter(q => q.status === 'Bekliyor').length;

    // Açık şikayetler — tanım isOpenComplaint'te, complaints.js ile ortak
    const openComplaints = complaints.filter(isOpenComplaint).length;

    // Sevk bekleyen siparişler: kapanış etiketlerinden hiçbirini taşımayanlar.
    // (Eski "Geciken Sevkiyat" kartının yerini aldı — shipments tablosu etd/eta
    //  takibi yapılmadığı için boş, modül de menüde değil.)
    const pendingShipments = orders.filter(o => {
        const tags = o.status_tags || [];
        return !CLOSED_TAGS.some(t => tags.includes(t));
    });

    const stages = {};
    pendingShipments.forEach(o => {
        const st = shipmentStage(o.status_tags || []);
        stages[st] = (stages[st] || 0) + 1;
    });
    const breakdown = [...STAGE_PRIORITY, 'Diğer']
        .filter(st => stages[st])
        .map(st => `${st} ${stages[st]}`)
        .join(' · ');

    setEl('op-active-orders',   activeOrders);
    setEl('op-pending-quotes',  pendingQuotations);
    setEl('op-open-complaints', openComplaints);
    setEl('op-pending-ships',   pendingShipments.length);
    setEl('op-pending-ships-detail', breakdown || 'Bekleyen sipariş yok');
}

function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ── SON SİPARİŞLER ─────────────────────────────────────────────────────────────
function renderRecentOrders(orders) {
    const tbody = document.getElementById('recent-orders-body');
    if (!tbody) return;
    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-xs text-[#968B7A] py-3">Veri yok</td></tr>`;
        return;
    }
    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };
    tbody.innerHTML = orders.map(o => {
        const company = o.customers?.company_name || '—';
        const date    = o.order_date ? new Date(o.order_date).toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit' }) : '—';
        const amount  = parseFloat(o.total_amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0 });
        const symbol  = currencySymbols[o.currency] || o.currency || '';
        const prodBadge = getProdBadge(o.production_status);
        return `<tr class="border-b border-[#F0EBE0] hover:bg-[#FDFBF7] transition-colors cursor-pointer" onclick="window.location.href='orders.html'">
            <td class="py-1.5 pr-2 text-xs text-[#1C1A17] font-medium truncate max-w-[90px]">${company}</td>
            <td class="py-1.5 pr-2 text-xs text-[#968B7A] font-mono">${date}</td>
            <td class="py-1.5 pr-2 text-xs text-right font-mono text-[#2D4A3E]">${amount} <span class="text-[10px]">${symbol}</span></td>
            <td class="py-1.5 text-right">${prodBadge}</td>
        </tr>`;
    }).join('');
}

// ── SON TEKLİFLER ─────────────────────────────────────────────────────────────
function renderRecentQuotations(quotations) {
    const tbody = document.getElementById('recent-quotes-body');
    if (!tbody) return;
    if (quotations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-xs text-[#968B7A] py-3">Veri yok</td></tr>`;
        return;
    }
    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };
    tbody.innerHTML = quotations.map(q => {
        const company = q.customers?.company_name || '—';
        const date    = q.quotation_date ? new Date(q.quotation_date).toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit' }) : '—';
        const amount  = parseFloat(q.total_amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0 });
        const symbol  = currencySymbols[q.currency] || q.currency || '';
        const badge   = getQuoteBadge(q.status);
        return `<tr class="border-b border-[#F0EBE0] hover:bg-[#FDFBF7] transition-colors cursor-pointer" onclick="window.location.href='quotations.html'">
            <td class="py-1.5 pr-2 text-xs text-[#1C1A17] font-medium truncate max-w-[90px]">${company}</td>
            <td class="py-1.5 pr-2 text-xs text-[#968B7A] font-mono">${date}</td>
            <td class="py-1.5 pr-2 text-xs text-right font-mono text-[#2D4A3E]">${amount} <span class="text-[10px]">${symbol}</span></td>
            <td class="py-1.5 text-right">${badge}</td>
        </tr>`;
    }).join('');
}

// ── ÖDEME DURUMU ──────────────────────────────────────────────────────────────
// Açık bakiye TÜM yılları kapsar (vade yıla bağlanamaz). Tutarlar para birimine
// göre AYRI tutulur — EUR/USD/TRY toplamak anlamsız bir sayı üretir.
function renderPaymentStatus(orders, recv) {
    // Açık / gecikmiş tutarlar Ödeme Takibi'nin alacak kalemlerinden (bkz. loadAllDashboardData).
    const byCurrency = {};
    const openOrders = new Set();
    recv.forEach(i => {
        const c = i.currency || 'EUR';
        if (!byCurrency[c]) byCurrency[c] = { open: 0, overdue: 0, orders: new Set() };
        byCurrency[c].open += i.open;
        if (i.overdueDays > 0) byCurrency[c].overdue += i.open;
        byCurrency[c].orders.add(i.orderId);
        openOrders.add(i.orderId);
    });
    Object.values(byCurrency).forEach(d => { d.count = d.orders.size; });
    const openCount = openOrders.size;
    const paidCount = orders.filter(o => !isCancelled(o) && (parseFloat(o.total_amount) || 0) > 0
        && (parseFloat(o.remaining_balance) || 0) <= 0.05).length;

    const el = document.getElementById('payment-status-widget');
    if (!el) return;

    const currencies = Object.keys(byCurrency).sort((a, b) => byCurrency[b].count - byCurrency[a].count);
    if (currencies.length === 0) {
        el.innerHTML = `<div class="text-xs text-[#968B7A]">Açık bakiye yok</div>`;
        return;
    }

    const bars = currencies.map(c => {
        const d = byCurrency[c];
        const pct = d.open > 0 ? Math.round((d.overdue / d.open) * 100) : 0;
        return `
        <div style="margin-bottom:6px;">
            <div class="flex justify-between items-baseline gap-2 mb-1">
                <span style="font-size:10px;color:#968B7A;font-weight:600;">${sym(c)} <span style="color:#B26B33;">${d.count} sipariş</span></span>
                <span style="font-size:11px;font-family:monospace;color:#1C1A17;">${money(d.open)}</span>
            </div>
            <div class="w-full h-1.5 rounded-full bg-[#F0EBE0] overflow-hidden">
                <div class="h-full rounded-full bg-[#9F3D3D] transition-all" style="width:${pct}%"></div>
            </div>
            <div style="font-size:9px;color:#968B7A;margin-top:2px;">%${pct} vadesi geçmiş · ${money(d.overdue)} ${sym(c)}</div>
        </div>`;
    }).join('');

    el.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <span class="text-xs text-[#968B7A]">Açık Bakiye (${openCount} sipariş)</span>
        </div>
        ${bars}
        <div class="flex justify-between text-[10px] text-[#968B7A] pt-1" style="border-top:1px solid #F0EBE0;">
            <span>Kapanmış: <strong class="text-[#3D6E50]">${paidCount}</strong></span>
            <span>Vadeli Açık: <strong class="text-[#B26B33]">${openCount}</strong></span>
        </div>
    `;
}

// ── TOP MÜŞTERİLER ─────────────────────────────────────────────────────────────
// Ciro para birimine göre AYRI sıralanır. Karışık toplandığında TRY tutarları
// büyüklük olarak her zaman öne geçiyor ve EUR/USD müşteriler listeye hiç
// giremiyordu — bkz. aynı kural sipariş/kalem toplamlarında da geçerli.
let topCustomersData = null;
let topCustomersCurrency = null;

function renderTopCustomers(orders, customers) {
    const el = document.getElementById('top-customers-widget');
    if (!el) return;

    const custMap = {};
    customers.forEach(c => { custMap[c.id] = c; });

    // { currency: { customerId: toplam } }
    const byCurrency = {};
    const orderCounts = {};
    orders.forEach(o => {
        const cid = o.customer_id;
        if (!cid) return;
        const c = o.currency || 'EUR';
        if (!byCurrency[c]) byCurrency[c] = {};
        byCurrency[c][cid] = (byCurrency[c][cid] || 0) + (parseFloat(o.total_amount) || 0);
        orderCounts[c] = (orderCounts[c] || 0) + 1;
    });

    const currencies = Object.keys(byCurrency).sort((a, b) => orderCounts[b] - orderCounts[a]);
    if (currencies.length === 0) {
        el.innerHTML = `<div class="text-xs text-[#968B7A]">Veri yok</div>`;
        return;
    }

    topCustomersData = { byCurrency, custMap };
    if (!currencies.includes(topCustomersCurrency)) topCustomersCurrency = currencies[0];

    const tabs = currencies.map(c => `
        <button type="button" class="top-cur-tab${c === topCustomersCurrency ? ' is-active' : ''}" data-cur="${c}">${sym(c)} ${c}</button>
    `).join('');

    el.innerHTML = `<div class="top-cur-tabs">${tabs}</div><div id="top-customers-list"></div>`;

    el.querySelectorAll('.top-cur-tab').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();           // kart tıklaması customer-score.html'e gidiyor
            e.preventDefault();
            topCustomersCurrency = btn.dataset.cur;
            el.querySelectorAll('.top-cur-tab').forEach(b => b.classList.toggle('is-active', b === btn));
            renderTopCustomersList();
        });
    });

    renderTopCustomersList();
}

function renderTopCustomersList() {
    const el = document.getElementById('top-customers-list');
    if (!el || !topCustomersData) return;
    const { byCurrency, custMap } = topCustomersData;
    const totals = byCurrency[topCustomersCurrency] || {};

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (sorted.length === 0) {
        el.innerHTML = `<div class="text-xs text-[#968B7A]">Veri yok</div>`;
        return;
    }

    const maxVal = sorted[0][1];
    const colors = ['#2D4A3E', '#B58858', '#3F5C7A'];
    el.innerHTML = sorted.map(([cid, total], i) => {
        const name    = custMap[cid]?.company_name || 'Bilinmiyor';
        const country = custMap[cid]?.country || '';
        const pct     = maxVal > 0 ? Math.round((total / maxVal) * 100) : 0;
        return `<div class="mb-2">
            <div class="flex justify-between items-center mb-0.5">
                <span class="text-xs text-[#1C1A17] font-medium truncate max-w-[120px]">${i+1}. ${name}</span>
                <span class="text-[10px] text-[#968B7A]">${country} · ${money(total, 0)} ${sym(topCustomersCurrency)}</span>
            </div>
            <div class="w-full h-1 rounded-full bg-[#F0EBE0] overflow-hidden">
                <div class="h-full rounded-full transition-all" style="width:${pct}%;background:${colors[i]};"></div>
            </div>
        </div>`;
    }).join('');
}

// ── İKİNCİL MODÜLLER ──────────────────────────────────────────────────────────
function renderSecondaryModules(orders, complaints, prices, customers) {
    // Karlılık: ortalama iskonto oranı
    const avgDiscount = prices.length > 0
        ? (prices.reduce((s, p) => s + (parseFloat(p.discount_rate) || 0), 0) / prices.length).toFixed(1)
        : '—';
    setEl('sec-profitability-val', avgDiscount !== '—' ? `%${avgDiscount} ort. iskonto` : '—');

    // Pazar analizi: kaç farklı ülke
    const countries = new Set(orders.map(o => o.customers?.country).filter(Boolean));
    setEl('sec-market-val', `${countries.size} aktif pazar`);

    // Şikayet özeti
    const total = complaints.length;
    const open  = complaints.filter(isOpenComplaint).length;
    setEl('sec-complaints-val', `${open} açık / ${total} toplam`);
}

// ── GRAFİKLER ─────────────────────────────────────────────────────────────────
function renderCharts(orders) {
    const monthlyCounts = Array(12).fill(0);
    orders.forEach(order => {
        monthlyCounts[new Date(order.order_date).getMonth()]++;
    });

    const ctxMonthly = document.getElementById('chart-monthly-performance')?.getContext('2d');
    if (!ctxMonthly) return;
    if (monthlyChartInstance) monthlyChartInstance.destroy();
    monthlyChartInstance = new Chart(ctxMonthly, {
        type: 'line',
        data: {
            labels: ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'],
            datasets: [{
                label: 'Sipariş Adedi',
                data: monthlyCounts,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99,102,241,0.08)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#818cf8',
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: '#F0EBE0' }, ticks: { color: '#968B7A', stepSize: 1, font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { color: '#968B7A', font: { size: 10 } } }
            }
        }
    });

    const currencyCounts = {};
    orders.forEach(order => {
        const curr = order.currency || 'EUR';
        currencyCounts[curr] = (currencyCounts[curr] || 0) + 1;
    });

    const ctxCurrency = document.getElementById('chart-currency-distribution')?.getContext('2d');
    if (!ctxCurrency) return;
    if (currencyChartInstance) currencyChartInstance.destroy();
    currencyChartInstance = new Chart(ctxCurrency, {
        type: 'doughnut',
        data: {
            labels: Object.keys(currencyCounts),
            datasets: [{
                data: Object.values(currencyCounts),
                backgroundColor: ['#a855f7', '#10b981', '#f97316', '#3b82f6'],
                borderWidth: 2,
                borderColor: '#F6F3EC'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#968B7A', font: { size: 10 }, padding: 12 }
                }
            }
        }
    });
}

// ── BADGE HELPERS ─────────────────────────────────────────────────────────────
function getProdBadge(status) {
    const map = {
        'Üretimde':   { bg: '#EBF4EF', color: '#2D4A3E', label: 'Üretimde' },
        'Bekliyor':   { bg: '#FEF3C7', color: '#92400E', label: 'Bekliyor' },
        'Tamamlandı': { bg: '#F0F4FF', color: '#3F5C7A', label: 'Tamam' },
        'İptal':      { bg: '#FEE2E2', color: '#9F3D3D', label: 'İptal' },
    };
    const s = map[status] || { bg: '#F0EBE0', color: '#968B7A', label: status || '—' };
    return `<span style="background:${s.bg};color:${s.color};font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;letter-spacing:0.04em;">${s.label}</span>`;
}

function getQuoteBadge(status) {
    const map = {
        'Bekliyor':          { bg: '#FEF3C7', color: '#92400E' },
        'Kabul':             { bg: '#EBF4EF', color: '#2D4A3E' },
        'Sipariş Dönüştü':  { bg: '#F0F4FF', color: '#3F5C7A' },
        'Red':               { bg: '#FEE2E2', color: '#9F3D3D' },
        'Süresi Doldu':      { bg: '#F0EBE0', color: '#968B7A' },
    };
    const s = map[status] || { bg: '#F0EBE0', color: '#968B7A' };
    return `<span style="background:${s.bg};color:${s.color};font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;">${status || '—'}</span>`;
}
// ── MÜŞTERİ ÖZETİ ─────────────────────────────────────────────────────────────
function renderCustomerSummary(customers) {
    const el = document.getElementById('sec-customer-val');
    if (!el) return;
    const total  = customers.length;
    const active = customers.filter(c => c.status === 'Aktif').length;
    const pasif  = total - active;
    el.innerHTML = `
        <span style="font-size:16px;font-weight:500;color:var(--ink-1);">${total}</span>
        <span style="font-size:10px;color:var(--ink-3);margin-left:4px;">müşteri</span>
        <div style="margin-top:4px;display:flex;gap:8px;">
            <span style="font-size:10px;color:var(--ok);"><i class="fa-solid fa-circle-check" style="font-size:8px;margin-right:2px;"></i>${active} aktif</span>
            <span style="font-size:10px;color:var(--ink-3);"><i class="fa-solid fa-circle-minus" style="font-size:8px;margin-right:2px;"></i>${pasif} pasif</span>
        </div>
    `;
}
