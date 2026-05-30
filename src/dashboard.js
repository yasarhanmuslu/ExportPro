import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

let monthlyChartInstance = null;
let currencyChartInstance = null;
let currentSession = null;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    currentSession = session;
    await renderNavbar('dashboard');
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

// ── ANA YÜKLEME ────────────────────────────────────────────────────────────────
async function loadAllDashboardData(selectedYear) {
    const uid = currentSession.user.id;
    try {
        const [
            ordersRes,
            quotationsRes,
            complaintsRes,
            shipmentsRes,
            customerScoreRes,
            profitabilityRes
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
            supabase.from('shipments')
                .select('id, estimated_date, actual_date, orders(order_date)')
                .eq('user_id', uid),
            supabase.from('customers')
                .select('id, company_name, country, status')
                .eq('user_id', uid),
            supabase.from('customer_prices')
                .select('customer_id, discount_rate, customers!fk_customer_prices_customer(company_name)')
                .eq('user_id', uid)
        ]);

        const orders      = ordersRes.data      || [];
        const quotations  = quotationsRes.data   || [];
        const complaints  = complaintsRes.data   || [];
        const shipments   = shipmentsRes.data    || [];
        const customers   = customerScoreRes.data || [];
        const prices      = profitabilityRes.data || [];

        const yearOrders = orders.filter(o => new Date(o.order_date).getFullYear() === selectedYear);

        renderFinanceKPIs(yearOrders, orders);
        renderOperationalCards(yearOrders, quotations, complaints, shipments);
        renderRecentOrders(yearOrders.slice(0, 5));
        renderRecentQuotations(quotations.slice(0, 5));
        renderPaymentStatus(orders);
        renderTopCustomers(orders, customers);
        renderSecondaryModules(orders, complaints, prices, customers);
    	renderCustomerSummary(customers);
        renderCharts(yearOrders);

    } catch (err) {
        console.error('Dashboard veri çekme hatası:', err.message);
    }
}

// ── FİNANS KPI ────────────────────────────────────────────────────────────────
function renderFinanceKPIs(yearOrders, allOrders) {
    const summary = {};
    yearOrders.forEach(order => {
        const curr = order.currency || 'EUR';
        if (!summary[curr]) summary[curr] = { total: 0, advance: 0, remaining: 0 };
        summary[curr].total     += parseFloat(order.total_amount)    || 0;
        summary[curr].advance   += parseFloat(order.advance_payment) || 0;
        summary[curr].remaining += parseFloat(order.remaining_balance) || 0;
    });

    // Bekleyen ödemeler (tüm yıllar, remaining > 0)
    const pendingPay = {};
    const today = new Date();
    allOrders.forEach(o => {
        const bal = parseFloat(o.remaining_balance) || 0;
        if (bal <= 0) return;
        const due = o.due_date ? new Date(o.due_date) : null;
        if (due && due < today) {
            const c = o.currency || 'EUR';
            pendingPay[c] = (pendingPay[c] || 0) + bal;
        }
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

    const ciroData     = Object.fromEntries(Object.entries(summary).map(([k,v]) => [k, v.total]));
    const avansData    = Object.fromEntries(Object.entries(summary).map(([k,v]) => [k, v.advance]));
    const bakiyeData   = Object.fromEntries(Object.entries(summary).map(([k,v]) => [k, v.remaining]));

    fillKPI('kpi-ciro-container',   ciroData,   'text-purple-500');
    fillKPI('kpi-avans-container',  avansData,  'text-[#3D6E50]');
    fillKPI('kpi-bakiye-container', bakiyeData, 'text-[#B26B33]');
    fillKPI('kpi-pending-container', pendingPay, 'text-[#9F3D3D]');
}

// ── OPERASYONEL KARTLAR ────────────────────────────────────────────────────────
function renderOperationalCards(yearOrders, quotations, complaints, shipments) {
    const today = new Date();

    // Aktif siparişler (üretimde veya bekliyor)
    const activeOrders = yearOrders.filter(o =>
        o.production_status === 'Üretimde' || o.production_status === 'Bekliyor'
    ).length;

    // Bekleyen teklifler
    const pendingQuotations = quotations.filter(q => q.status === 'Bekliyor').length;

    // Açık şikayetler
    const openComplaints = complaints.filter(c => c.process_status === 'İncelemede').length;

    // Geciken sevkiyatlar (estimated_date < today ve actual_date yok)
    const delayedShipments = shipments.filter(s => {
        if (s.actual_date) return false;
        if (!s.estimated_date) return false;
        return new Date(s.estimated_date) < today;
    }).length;

    setEl('op-active-orders',   activeOrders);
    setEl('op-pending-quotes',  pendingQuotations);
    setEl('op-open-complaints', openComplaints);
    setEl('op-delayed-ships',   delayedShipments);
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
function renderPaymentStatus(orders) {
    const today = new Date();
    let totalRem = 0, overdueRem = 0, paidCount = 0, openCount = 0;

    orders.forEach(o => {
        const bal = parseFloat(o.remaining_balance || 0);
        const total = parseFloat(o.total_amount || 0);
        if (bal <= 0 && total > 0) { paidCount++; return; }
        if (bal > 0) {
            openCount++;
            totalRem += bal;
            if (o.due_date && new Date(o.due_date) < today) overdueRem += bal;
        }
    });

    const pct = totalRem > 0 ? Math.round((overdueRem / totalRem) * 100) : 0;

    const el = document.getElementById('payment-status-widget');
    if (!el) return;
    el.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <span class="text-xs text-[#968B7A]">Açık Bakiye (${openCount} sipariş)</span>
            <span class="text-xs font-semibold text-[#9F3D3D]">${pct}% vadesi geçmiş</span>
        </div>
        <div class="w-full h-1.5 rounded-full bg-[#F0EBE0] overflow-hidden mb-2">
            <div class="h-full rounded-full bg-[#9F3D3D] transition-all" style="width:${pct}%"></div>
        </div>
        <div class="flex justify-between text-[10px] text-[#968B7A]">
            <span>Kapanmış: <strong class="text-[#3D6E50]">${paidCount}</strong></span>
            <span>Vadeli Açık: <strong class="text-[#B26B33]">${openCount}</strong></span>
        </div>
    `;
}

// ── TOP MÜŞTERİLER ─────────────────────────────────────────────────────────────
function renderTopCustomers(orders, customers) {
    const el = document.getElementById('top-customers-widget');
    if (!el) return;

    // Müşteri bazında toplam ciro (EUR bazlı basit)
    const custTotals = {};
    orders.forEach(o => {
        const cid = o.customer_id;
        if (!cid) return;
        custTotals[cid] = (custTotals[cid] || 0) + (parseFloat(o.total_amount) || 0);
    });

    const custMap = {};
    customers.forEach(c => { custMap[c.id] = c; });

    const sorted = Object.entries(custTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    if (sorted.length === 0) {
        el.innerHTML = `<div class="text-xs text-[#968B7A]">Veri yok</div>`;
        return;
    }

    const maxVal = sorted[0][1];
    el.innerHTML = sorted.map(([cid, total], i) => {
        const name = custMap[cid]?.company_name || 'Bilinmiyor';
        const country = custMap[cid]?.country || '';
        const pct = maxVal > 0 ? Math.round((total / maxVal) * 100) : 0;
        const colors = ['#2D4A3E', '#B58858', '#3F5C7A'];
        const fmt = total.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        return `<div class="mb-2">
            <div class="flex justify-between items-center mb-0.5">
                <span class="text-xs text-[#1C1A17] font-medium truncate max-w-[120px]">${i+1}. ${name}</span>
                <span class="text-[10px] text-[#968B7A]">${country} · ${fmt}</span>
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
    const open  = complaints.filter(c => c.process_status === 'İncelemede').length;
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
