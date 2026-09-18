import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess } from './utils/permissions.js';
import { buildReceivables, isCancelled, isFreeShipment, addDays, daysBetween, todayIso } from './utils/receivables.js';

// ─── Skor modeli (patron kararı 18.09.2026) ──────────────────────────────────
// Dönem: son 24 ay. Ancak siparişler sisteme fiilen Kasım 2025'ten itibaren
// girildi; Credit Note'lar ise 2023'ten beri var. Pencere bu tarihten önceye
// uzanırsa şikayetler sayılır ama o dönemin siparişleri sayılmaz ve müşteri
// haksız yere düşer. Bu yüzden pencere en erken ORDER_DATA_START'tan başlar;
// Kasım 2027'den itibaren kendiliğinden tam 24 ay olur.
//
//   Hacim      30  — dönemdeki sipariş tutarının KENDİ PARA BİRİMİNDEKİ müşteriler
//                    arasındaki sırası (kur çevrimi yok; para birimleri karışmaz).
//   Ödeme      35  — Ödeme Takibi'ndeki bugünkü durum: vadesi geçmiş en eski fatura
//                    kaç gün gecikmiş; manuel takipte açık alacak = 0.
//   Şikayet    20  — dönemdeki Credit Note sayısı / sipariş sayısı. (CN'lerin yarısında
//                    tutar yok — bedelsiz kalemlerin fiyatı girilmiyor — o yüzden adet.)
//   Süreklilik 15  — dönemdeki sipariş sayısı (10) + son siparişin yakınlığı (5).
//
// Dönemde siparişi olmayan müşteri puanlanmaz ("Puanlanmadı").
// İskonto kriteri kaldırıldı: iskonto oranı riski değil anlaşılan fiyat seviyesini gösterir.
const WINDOW_DAYS = 730;
const ORDER_DATA_START = '2025-11-01';

const MAX = { volume: 30, payment: 35, complaint: 20, continuity: 15 };

function paymentPoints(maxOverdueDays, manualOpen) {
    if (manualOpen)            return 0;
    if (maxOverdueDays <= 0)   return 35;
    if (maxOverdueDays <= 15)  return 30;
    if (maxOverdueDays <= 30)  return 25;
    if (maxOverdueDays <= 60)  return 15;
    if (maxOverdueDays <= 90)  return 8;
    return 0;
}

function complaintPoints(perOrder) {
    if (perOrder === 0)   return 20;
    if (perOrder <= 0.25) return 16;
    if (perOrder <= 0.5)  return 12;
    if (perOrder <= 1)    return 8;
    if (perOrder <= 2)    return 4;
    return 0;
}

function continuityPoints(orderCount, daysSinceLast) {
    let freq;
    if      (orderCount >= 6) freq = 10;
    else if (orderCount >= 4) freq = 8;
    else if (orderCount === 3) freq = 6;
    else if (orderCount === 2) freq = 4;
    else                       freq = 2;
    let rec;
    if      (daysSinceLast <= 90)  rec = 5;
    else if (daysSinceLast <= 180) rec = 3;
    else if (daysSinceLast <= 365) rec = 1;
    else                           rec = 0;
    return { total: freq + rec, freq, rec };
}

// A = stratejik: puan yetse bile dönemde en az 3 sipariş şartı (patron kararı 18.09.2026).
// Kaydı temiz tek siparişlik müşteri ödeme + şikayetten doğrudan 55 puan alıyor; "stratejik" değil.
const A_MIN_ORDERS = 3;

function classOf(total, orderCount) {
    if (total >= 75 && orderCount >= A_MIN_ORDERS) return 'A';
    if (total >= 50) return 'B';
    return 'C';
}

// ─── Global State ───────────────────────────────────────────────────────────
let allScores = [];       // Tüm müşteriler (puanlanan + puanlanmayan)
let filteredScores = [];
let abcChart = null;
let activeClass = 'all';  // 'all' = yalnız puanlananlar
let activeCountry = '';
let ctx = null;
let windowStart = null;

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'customer-score'))) return;
    await renderNavbar('customer-score', ctx);
    renderMethodology();
    await loadAndComputeScores();
    initFilters();
    initModal();
    initExport();
});

// ─── Veri Yükleme ────────────────────────────────────────────────────────────
async function loadAndComputeScores() {
    try {
        const uid = ctx.ownerId;
        const [custRes, orderRes, cnRes, invRes] = await Promise.all([
            supabase.from('customers').select('id, company_name, country').eq('user_id', uid).order('company_name'),
            supabase.from('orders')
                .select('*')
                .eq('user_id', uid),
            supabase.from('credit_notes').select('customer_id, cn_date, process_status').eq('user_id', uid),
            // Ödeme Takibi yetkisi olmayan kullanıcıda boş döner; hesap sipariş vadesiyle yapılır.
            supabase.from('order_invoices').select('*').eq('user_id', uid),
        ]);
        if (custRes.error) throw custRes.error;
        if (orderRes.error) throw orderRes.error;
        if (cnRes.error) throw cnRes.error;

        allScores = computeScores({
            customers: custRes.data || [],
            orders: orderRes.data || [],
            creditNotes: cnRes.data || [],
            invoices: invRes.error ? [] : (invRes.data || []),
        });

        const fmtD = iso => iso.split('-').reverse().join('.');
        document.getElementById('score-window').textContent =
            `Dönem: ${fmtD(windowStart)} – ${fmtD(todayIso())} · Ödeme puanı bugünkü açık alacaklara göre.`;

        populateCountryFilter();
        applyFilters();
        renderChart();
    } catch (err) {
        console.error('Skor hesaplama hatası:', err.message);
        document.getElementById('score-tbody').innerHTML = `
            <tr><td colspan="8" style="text-align:center;padding:40px;color:#991B1B;">
                <i class="fa-solid fa-circle-exclamation mr-2"></i>Veriler yüklenirken hata oluştu.
            </td></tr>`;
    }
}

// ─── Skor Hesabı ─────────────────────────────────────────────────────────────
function computeScores({ customers, orders, creditNotes, invoices }) {
    const today = todayIso();
    const w = addDays(today, -WINDOW_DAYS);
    windowStart = w > ORDER_DATA_START ? w : ORDER_DATA_START;

    // Dönem siparişleri (iptal / bedelsiz hariç)
    const byCust = new Map();
    orders.forEach(o => {
        if (isCancelled(o) || isFreeShipment(o)) return;
        const d = String(o.order_date || '').slice(0, 10);
        if (!d || d < windowStart) return;
        if (!byCust.has(o.customer_id)) byCust.set(o.customer_id, { count: 0, last: '', volume: {} });
        const r = byCust.get(o.customer_id);
        r.count++;
        if (d > r.last) r.last = d;
        const cur = o.currency || 'EUR';
        r.volume[cur] = (r.volume[cur] || 0) + (Number(o.total_amount) || 0);
    });

    // Hacim sırası — her para birimi kendi içinde
    const rankByCur = {};
    byCust.forEach((r, cid) => {
        Object.entries(r.volume).forEach(([cur, v]) => {
            if (v <= 0) return;
            (rankByCur[cur] = rankByCur[cur] || []).push({ cid, v });
        });
    });
    const volumePct = {};   // cid -> { cur, pct, rank, n }
    Object.entries(rankByCur).forEach(([cur, list]) => {
        const n = list.length;
        list.forEach(item => {
            const below = list.filter(x => x.v < item.v).length;
            const pct = (below + 1) / n;
            const rank = n - below;
            const prev = volumePct[item.cid];
            if (!prev || pct > prev.pct) volumePct[item.cid] = { cur, pct, rank, n };
        });
    });

    // Ödeme — Ödeme Takibi'nin alacak kalemleri (tüm yıllar, bugünkü durum)
    const manualIds = new Set(orders.filter(o => o.manual_tracking).map(o => o.id));
    const recv = buildReceivables({ orders, invoices, customers, today });
    const payByCust = new Map();
    const payOf = cid => {
        if (!payByCust.has(cid)) payByCust.set(cid, { maxOverdue: 0, overdueCount: 0, manualOpen: 0, worst: null });
        return payByCust.get(cid);
    };
    recv.items.forEach(i => {
        const p = payOf(i.customerId);
        if (manualIds.has(i.orderId)) { p.manualOpen++; return; }
        if (i.overdueDays > 0) {
            p.overdueCount++;
            if (i.overdueDays > p.maxOverdue) { p.maxOverdue = i.overdueDays; p.worst = i; }
        }
    });
    recv.pending.forEach(i => { if (manualIds.has(i.orderId)) payOf(i.customerId).manualOpen++; });

    // Şikayet — dönemdeki Credit Note sayısı (iptal hariç)
    const cnCount = new Map();
    creditNotes.forEach(cn => {
        if (cn.process_status === 'İptal') return;
        const d = String(cn.cn_date || '').slice(0, 10);
        if (!d || d < windowStart) return;
        cnCount.set(cn.customer_id, (cnCount.get(cn.customer_id) || 0) + 1);
    });

    return customers.map(cust => {
        const base = { id: cust.id, name: cust.company_name, country: cust.country || '—' };
        const r = byCust.get(cust.id);
        if (!r) {
            const pay = payByCust.get(cust.id) || { maxOverdue: 0, overdueCount: 0, manualOpen: 0, worst: null };
            return { ...base, cls: 'none', total: null, volume: {}, orderCount: 0, pay, complaintCount: cnCount.get(cust.id) || 0 };
        }

        const vp = volumePct[cust.id];
        const volumeScore = vp ? Math.round(MAX.volume * vp.pct) : 0;

        const pay = payByCust.get(cust.id) || { maxOverdue: 0, overdueCount: 0, manualOpen: 0, worst: null };
        const paymentScore = paymentPoints(pay.maxOverdue, pay.manualOpen > 0);

        const complaintCount = cnCount.get(cust.id) || 0;
        const perOrder = complaintCount / r.count;
        const complaintScore = complaintPoints(perOrder);

        const daysSinceLast = daysBetween(r.last, today);
        const cont = continuityPoints(r.count, daysSinceLast);

        const total = volumeScore + paymentScore + complaintScore + cont.total;
        return {
            ...base,
            cls: classOf(total, r.count),
            aCapped: total >= 75 && r.count < A_MIN_ORDERS,
            total,
            volume: r.volume,
            volumeRank: vp || null,
            orderCount: r.count,
            lastOrder: r.last,
            daysSinceLast,
            pay,
            complaintCount,
            perOrder,
            volumeScore,
            paymentScore,
            complaintScore,
            continuityScore: cont.total,
            cont,
        };
    });
}

// ─── Metodoloji kartı ─────────────────────────────────────────────────────────
function renderMethodology() {
    const rows = [
        ['Sipariş Hacmi', MAX.volume, 'Dönemdeki sipariş tutarının aynı para birimindeki müşteriler arasındaki sırası.'],
        ['Ödeme Düzeni', MAX.payment, 'Bugün vadesi geçmiş fatura yoksa tam puan; gecikme gününe göre azalır. Manuel takipte açık alacak: 0.'],
        ['Şikayet', MAX.complaint, 'Dönemdeki Credit Note sayısı / sipariş sayısı.'],
        ['Süreklilik', MAX.continuity, 'Sipariş sayısı (10) + son siparişin yakınlığı (5).'],
    ];
    document.getElementById('method-list').innerHTML = rows.map(([label, pts, hint]) => `
        <div>
            <div style="display:flex;justify-content:space-between;">
                <span style="font-weight:600;color:#1C1A17;">${label}</span>
                <span style="font-weight:600;color:#2D4A3E;">${pts} puan</span>
            </div>
            <div style="font-size:10px;color:#968B7A;">${hint}</div>
        </div>`).join('') + `
        <div style="border-top:1px solid #E4DDCE;padding-top:8px;display:flex;justify-content:space-between;">
            <span style="font-size:12px;font-weight:600;color:#1C1A17;">Toplam</span>
            <span style="font-size:12px;font-weight:600;color:#1C1A17;">100 puan</span>
        </div>
        <div style="font-size:10px;color:#968B7A;">A sınıfı için dönemde en az ${A_MIN_ORDERS} sipariş gerekir. Ayrıntı: Yardım &amp; Kılavuz › Müşteri Skoru.</div>`;
}

// ─── Filtreler ────────────────────────────────────────────────────────────────
function populateCountryFilter() {
    const sel = document.getElementById('country-filter');
    const countries = [...new Set(allScores.map(s => s.country))].sort((a, b) => a.localeCompare(b, 'tr'));
    sel.innerHTML = '<option value="">Tüm Ülkeler</option>' +
        countries.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
}

function initFilters() {
    document.querySelectorAll('.filter-btn[data-class]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn[data-class]').forEach(b => { b.className = 'filter-btn'; });
            activeClass = btn.dataset.class;
            const classMap = { all: 'active', A: 'active-a', B: 'active-b', C: 'active-c', none: 'active-none' };
            btn.classList.add(classMap[activeClass] || 'active');
            applyFilters();
        });
    });
    document.getElementById('country-filter').addEventListener('change', (e) => {
        activeCountry = e.target.value;
        applyFilters();
    });
}

function applyFilters() {
    filteredScores = allScores.filter(s => {
        const classOk = activeClass === 'all' ? s.cls !== 'none' : s.cls === activeClass;
        const countryOk = !activeCountry || s.country === activeCountry;
        return classOk && countryOk;
    });
    const risky = s => (s.pay.manualOpen || s.pay.maxOverdue > 0) ? 1 : 0;
    if (activeClass === 'none') filteredScores.sort((a, b) => risky(b) - risky(a) || a.name.localeCompare(b.name, 'tr'));
    else filteredScores.sort((a, b) => b.total - a.total);
    renderTable();
    updateKPIs();
}

// ─── Tablo ────────────────────────────────────────────────────────────────────
const BADGE = { A: 'score-badge-a', B: 'score-badge-b', C: 'score-badge-c', none: 'score-badge-none' };
const BAR   = { A: '#065F46', B: '#92400E', C: '#991B1B' };

function paymentCell(s) {
    if (s.pay.manualOpen) return `<span class="pill pill-red" title="Ödeme tarihi belirsiz (Ödeme Takibi › Manuel Alacaklar)">Manuel takip</span>`;
    if (s.pay.maxOverdue > 0) return `<span class="pill pill-red" title="${s.pay.overdueCount} vadesi geçmiş fatura">${s.pay.maxOverdue} gün gecikme</span>`;
    return `<span style="color:#065F46;font-size:11px;"><i class="fa-solid fa-check"></i></span>`;
}

function renderTable() {
    const tbody = document.getElementById('score-tbody');
    document.getElementById('table-count').textContent = `${filteredScores.length} kayıt`;

    if (filteredScores.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="8" style="text-align:center;padding:40px;color:#968B7A;">
                <i class="fa-solid fa-magnifying-glass mr-2"></i>Kriterlere uygun müşteri bulunamadı.
            </td></tr>`;
        return;
    }

    tbody.innerHTML = filteredScores.map((s, idx) => {
        if (s.cls === 'none') {
            return `
            <tr data-idx="${idx}" style="cursor:default;">
                <td><span style="font-weight:500;color:#6B655B;">${escHtml(s.name)}</span></td>
                <td style="color:#968B7A;font-size:12px;">${escHtml(s.country)}</td>
                <td colspan="5" style="font-size:11px;color:#968B7A;">Dönem içinde sipariş yok${s.complaintCount ? ` · ${s.complaintCount} credit note` : ''}
                    ${s.pay.manualOpen || s.pay.maxOverdue > 0 ? ` &nbsp;${paymentCell(s)}` : ''}</td>
                <td style="text-align:center;"><span class="score-badge-none" style="display:inline-block;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:700;">—</span></td>
            </tr>`;
        }
        return `
        <tr data-idx="${idx}" style="cursor:pointer;">
            <td><span style="font-weight:500;color:#1C1A17;">${escHtml(s.name)}</span></td>
            <td style="color:#6B655B;font-size:12px;">${escHtml(s.country)}</td>
            <td style="text-align:right;font-size:12px;font-family:monospace;color:#2D4A3E;white-space:nowrap;">${volumeText(s.volume, '<br>')}</td>
            <td style="text-align:center;font-size:12px;color:#6B655B;">${s.orderCount}</td>
            <td style="text-align:center;">${paymentCell(s)}</td>
            <td style="text-align:center;">
                ${s.complaintCount > 0
                    ? `<span class="pill pill-amber" title="${s.complaintCount} credit note / ${s.orderCount} sipariş">${s.complaintCount}</span>`
                    : `<span style="color:#065F46;font-size:11px;"><i class="fa-solid fa-check"></i></span>`}
            </td>
            <td style="text-align:center;">
                <div style="display:flex;align-items:center;gap:8px;justify-content:center;">
                    <div class="score-bar-wrap"><div class="score-bar-fill" style="background:${BAR[s.cls]};width:${s.total}%;"></div></div>
                    <span style="font-weight:700;font-size:13px;color:${BAR[s.cls]};min-width:28px;">${s.total}</span>
                </div>
            </td>
            <td style="text-align:center;">
                <span class="${BADGE[s.cls]}" style="display:inline-block;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:0.05em;">${s.cls}</span>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-idx]').forEach(row => {
        const s = filteredScores[parseInt(row.dataset.idx)];
        if (s.cls === 'none') return;
        row.addEventListener('click', () => openDetailModal(s));
    });
}

// ─── KPI ──────────────────────────────────────────────────────────────────────
function classCounts() {
    const counts = { A: 0, B: 0, C: 0, none: 0 };
    allScores.forEach(s => counts[s.cls]++);
    return counts;
}

function updateKPIs() {
    const c = classCounts();
    document.getElementById('kpi-a').textContent = c.A;
    document.getElementById('kpi-b').textContent = c.B;
    document.getElementById('kpi-c').textContent = c.C;
    document.getElementById('kpi-none').textContent = c.none;
}

// ─── Grafik ───────────────────────────────────────────────────────────────────
function renderChart() {
    const counts = classCounts();
    const canvas = document.getElementById('chart-abc').getContext('2d');
    if (abcChart) abcChart.destroy();

    abcChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['A Sınıfı', 'B Sınıfı', 'C Sınıfı'],
            datasets: [{
                data: [counts.A, counts.B, counts.C],
                backgroundColor: ['#065F46', '#92400E', '#991B1B'],
                borderColor: ['#D1FAE5', '#FEF3C7', '#FEE2E2'],
                borderWidth: 3,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw} müşteri` } }
            }
        }
    });

    const scored = (counts.A + counts.B + counts.C) || 1;
    document.getElementById('chart-legend').innerHTML = [
        { color: '#065F46', label: 'A Sınıfı · Stratejik', count: counts.A },
        { color: '#92400E', label: 'B Sınıfı · Geliştirilecek', count: counts.B },
        { color: '#991B1B', label: 'C Sınıfı · Riskli / Takip Gerekli', count: counts.C },
    ].map(item => `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:8px;">
                <div style="width:10px;height:10px;border-radius:3px;background:${item.color};"></div>
                <span style="font-size:11px;color:#6B655B;">${item.label}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:12px;font-weight:600;color:${item.color};">${item.count}</span>
                <span style="font-size:10px;color:#968B7A;">(${Math.round(item.count / scored * 100)}%)</span>
            </div>
        </div>`).join('') + `
        <div style="font-size:10px;color:#968B7A;margin-top:4px;">Oranlar yalnızca puanlanan ${scored} müşteri üzerinden. Puanlanmayan: ${counts.none}.</div>`;
}

// ─── Detay Modalı ─────────────────────────────────────────────────────────────
function initModal() {
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('detail-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

function openDetailModal(s) {
    document.getElementById('modal-customer-name').textContent = s.name;

    const colors = {
        A: { bg: '#D1FAE5', color: '#065F46', label: 'A Sınıfı — Stratejik Müşteri' },
        B: { bg: '#FEF3C7', color: '#92400E', label: 'B Sınıfı — Geliştirilecek' },
        C: { bg: '#FEE2E2', color: '#991B1B', label: 'C Sınıfı — Riskli / Takip Gerekli' },
    }[s.cls];

    const banner = document.getElementById('modal-score-banner');
    banner.style.background = colors.bg;
    banner.style.color = colors.color;
    const totalEl = document.getElementById('modal-total-score');
    totalEl.textContent = `${s.total} / 100`;
    totalEl.style.color = colors.color;
    const badge = document.getElementById('modal-class-badge');
    badge.textContent = colors.label + (s.aCapped ? ` (A için en az ${A_MIN_ORDERS} sipariş)` : '');
    badge.style.background = colors.color;
    badge.style.color = '#fff';

    const vr = s.volumeRank;
    const volumeDetail = vr
        ? `${volumeText(s.volume, ' · ')} — ${vr.cur} müşterileri arasında ${vr.rank}. (${vr.n} müşteri)`
        : volumeText(s.volume, ' · ');

    let payDetail;
    if (s.pay.manualOpen) payDetail = `Manuel takipte açık alacak var (ödeme tarihi belirsiz)`;
    else if (s.pay.maxOverdue > 0) {
        const w = s.pay.worst;
        payDetail = `${s.pay.overdueCount} vadesi geçmiş fatura; en eskisi ${s.pay.maxOverdue} gün (${w.orderNumber || ''}${w.docNo ? ' · ' + w.docNo : ''})`;
    } else payDetail = 'Vadesi geçmiş fatura yok';

    const complaintDetail = s.complaintCount
        ? `${s.complaintCount} credit note / ${s.orderCount} sipariş = sipariş başına ${s.perOrder.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`
        : 'Dönemde credit note yok';

    const contDetail = `${s.orderCount} sipariş (${s.cont.freq}/10) · son sipariş ${s.daysSinceLast} gün önce (${s.cont.rec}/5)`;

    const comps = [
        { icon: 'fa-boxes-stacked', color: '#2D4A3E', label: 'Sipariş Hacmi', score: s.volumeScore, max: MAX.volume, detail: volumeDetail },
        { icon: 'fa-clock', color: '#3F5C7A', label: 'Ödeme Düzeni', score: s.paymentScore, max: MAX.payment, detail: payDetail },
        { icon: 'fa-triangle-exclamation', color: '#B26B33', label: 'Şikayet', score: s.complaintScore, max: MAX.complaint, detail: complaintDetail },
        { icon: 'fa-arrows-rotate', color: '#7C3AED', label: 'Süreklilik', score: s.continuityScore, max: MAX.continuity, detail: contDetail },
    ];
    document.getElementById('modal-components').innerHTML = comps.map(c => `
        <div style="padding:12px 16px;background:#F6F3EC;border-radius:8px;">
            <div style="display:flex;align-items:center;margin-bottom:6px;">
                <i class="fa-solid ${c.icon}" style="color:${c.color};width:16px;font-size:12px;"></i>
                <span style="font-size:12px;font-weight:600;color:#1C1A17;margin-left:8px;">${c.label}</span>
                <span style="margin-left:auto;font-size:11px;color:#968B7A;">max ${c.max} puan</span>
            </div>
            <div style="display:flex;align-items:center;">
                <span style="font-size:18px;font-weight:600;color:${c.color};min-width:36px;">${c.score}</span>
                <div class="comp-bar-wrap"><div class="comp-bar-fill" style="background:${c.color};width:${(c.score / c.max) * 100}%;"></div></div>
            </div>
            <div style="font-size:11px;color:#6B655B;margin-top:4px;">${escHtml(c.detail)}</div>
        </div>`).join('');

    document.getElementById('detail-modal').classList.add('open');
}

function closeModal() {
    document.getElementById('detail-modal').classList.remove('open');
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function initExport() {
    document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
}

function exportCsv() {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = ['Müşteri Adı', 'Ülke', 'Sipariş Tutarı', 'Sipariş Adedi', 'Son Sipariş', 'En Uzun Gecikme (gün)', 'Manuel Takip',
        'Credit Note', 'Hacim Puanı', 'Ödeme Puanı', 'Şikayet Puanı', 'Süreklilik Puanı', 'Toplam Skor', 'Sınıf'];
    const rows = filteredScores.map(s => s.cls === 'none'
        ? [q(s.name), q(s.country), q(''), 0, q(''), q(''), q(''), s.complaintCount, '', '', '', '', '', q('Puanlanmadı')].join(';')
        : [q(s.name), q(s.country), q(volumeText(s.volume, ' + ')), s.orderCount, q(s.lastOrder), s.pay.maxOverdue,
           q(s.pay.manualOpen ? 'Evet' : ''), s.complaintCount, s.volumeScore, s.paymentScore, s.complaintScore,
           s.continuityScore, s.total, q(s.cls)].join(';'));

    const csv = '﻿' + [headers.map(q).join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `musteri-skor-raporu-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────────
const SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };

// Para birimleri ayrı satırda — asla toplanmaz.
function volumeText(volume, sep) {
    const parts = Object.entries(volume || {})
        .filter(([, v]) => v > 0)
        .map(([cur, v]) => `${v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} ${SYMBOLS[cur] || cur}`);
    return parts.join(sep) || '—';
}

function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
