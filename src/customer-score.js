import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess } from './utils/permissions.js';

// ─── Global State ───────────────────────────────────────────────────────────
let allScores = [];       // Tüm müşteri skorları
let filteredScores = [];  // Filtreli liste
let abcChart = null;      // Chart.js instance
let activeClass = 'all';  // Aktif sınıf filtresi
let activeCountry = '';   // Aktif ülke filtresi
let ctx = null;

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'customer-score'))) return;
    await renderNavbar('customer-score', ctx);
    await loadAndComputeScores();
    initFilters();
    initModal();
    initExport();
});

// ─── Veri Yükleme & Skor Hesaplama ───────────────────────────────────────────
async function loadAndComputeScores() {
    try {
        const uid = ctx.ownerId;

        // 1. Müşteriler
        const { data: customers, error: cErr } = await supabase
            .from('customers')
            .select('id, company_name, country')
            .eq('user_id', uid)
            .order('company_name');
        if (cErr) throw cErr;

        // 2. Siparişler (toplam tutar + gecikme)
        const { data: orders, error: oErr } = await supabase
            .from('orders')
            .select('customer_id, total_amount, due_date, payment_status')
            .eq('user_id', uid);
        if (oErr) throw oErr;

        // 3. Credit Notes (şikayet sayısı)
        const { data: creditNotes, error: cnErr } = await supabase
            .from('credit_notes')
            .select('customer_id')
            .eq('user_id', uid);
        if (cnErr) throw cnErr;

        // 4. Müşteri Özel Fiyatlar (iskonto oranı)
        const { data: prices, error: pErr } = await supabase
            .from('customer_prices')
            .select('customer_id, discount_rate')
            .eq('user_id', uid);
        if (pErr) throw pErr;

        // ── Müşteri bazında agregasyon ────────────────────────────────
        const orderMap   = buildOrderMap(orders);
        const cnMap      = buildCnMap(creditNotes);
        const priceMap   = buildPriceMap(prices);

        // En yüksek sipariş tutarı (normalize için)
        const maxVolume = Math.max(...Object.values(orderMap).map(o => o.totalAmount), 1);

        // Skorları hesapla
        const today = new Date();
        allScores = customers.map(cust => {
            const om = orderMap[cust.id]  || { totalAmount: 0, overdueCount: 0 };
            const cn = cnMap[cust.id]     || 0;
            const pr = priceMap[cust.id]  || null;

            // 1. Sipariş Hacmi (30 puan)
            const volumeScore = maxVolume > 0
                ? Math.round((om.totalAmount / maxVolume) * 30)
                : 0;

            // 2. Ödeme Düzeni (30 puan)
            let paymentScore;
            const overdue = om.overdueCount;
            if      (overdue === 0) paymentScore = 30;
            else if (overdue === 1) paymentScore = 20;
            else if (overdue === 2) paymentScore = 10;
            else                    paymentScore = 0;

            // 3. Şikayet (20 puan)
            let complaintScore;
            if      (cn === 0) complaintScore = 20;
            else if (cn === 1) complaintScore = 15;
            else if (cn === 2) complaintScore = 10;
            else if (cn === 3) complaintScore = 5;
            else               complaintScore = 0;

            // 4. İskonto Avantajı (20 puan)
            let discountScore;
            const avgDiscount = pr !== null ? pr : 0;
            if      (avgDiscount < 10)  discountScore = 20;
            else if (avgDiscount < 20)  discountScore = 15;
            else if (avgDiscount < 30)  discountScore = 10;
            else                         discountScore = 5;

            const total = volumeScore + paymentScore + complaintScore + discountScore;

            // Sınıf
            let cls;
            if      (total >= 75) cls = 'A';
            else if (total >= 50) cls = 'B';
            else                  cls = 'C';

            return {
                id: cust.id,
                name: cust.company_name,
                country: cust.country || '—',
                totalAmount: om.totalAmount,
                overdueCount: overdue,
                complaintCount: cn,
                avgDiscount,
                volumeScore,
                paymentScore,
                complaintScore,
                discountScore,
                total,
                cls
            };
        });

        // En yüksek skora göre sırala
        allScores.sort((a, b) => b.total - a.total);

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

// ─── Yardımcı Aggregation Fonksiyonları ──────────────────────────────────────
function buildOrderMap(orders) {
    const map = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const o of orders) {
        if (!map[o.customer_id]) map[o.customer_id] = { totalAmount: 0, overdueCount: 0 };
        map[o.customer_id].totalAmount += parseFloat(o.total_amount || 0);

        // Vadesi geçmiş: due_date geçmiş VE ödeme tamamlanmamış
        if (o.due_date) {
            const due = new Date(o.due_date);
            due.setHours(0, 0, 0, 0);
            const notPaid = !o.payment_status || o.payment_status.toLowerCase() !== 'ödendi';
            if (due < today && notPaid) {
                map[o.customer_id].overdueCount++;
            }
        }
    }
    return map;
}

function buildCnMap(creditNotes) {
    const map = {};
    for (const cn of creditNotes) {
        map[cn.customer_id] = (map[cn.customer_id] || 0) + 1;
    }
    return map;
}

function buildPriceMap(prices) {
    // Her müşteri için ortalama iskonto
    const raw = {};
    for (const p of prices) {
        if (!raw[p.customer_id]) raw[p.customer_id] = { sum: 0, count: 0 };
        raw[p.customer_id].sum   += parseFloat(p.discount_rate || 0);
        raw[p.customer_id].count += 1;
    }
    const map = {};
    for (const [cid, v] of Object.entries(raw)) {
        map[cid] = v.count > 0 ? v.sum / v.count : 0;
    }
    return map;
}

// ─── Filtreler ────────────────────────────────────────────────────────────────
function populateCountryFilter() {
    const sel = document.getElementById('country-filter');
    const countries = [...new Set(allScores.map(s => s.country))].sort();
    sel.innerHTML = '<option value="">Tüm Ülkeler</option>' +
        countries.map(c => `<option value="${c}">${c}</option>`).join('');
}

function initFilters() {
    // Sınıf butonları
    document.querySelectorAll('.filter-btn[data-class]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn[data-class]').forEach(b => {
                b.className = 'filter-btn';
            });
            activeClass = btn.dataset.class;
            const classMap = { all: 'active', A: 'active-a', B: 'active-b', C: 'active-c' };
            btn.classList.add(classMap[activeClass] || 'active');
            applyFilters();
        });
    });

    // Ülke filtresi
    document.getElementById('country-filter').addEventListener('change', (e) => {
        activeCountry = e.target.value;
        applyFilters();
    });
}

function applyFilters() {
    filteredScores = allScores.filter(s => {
        const classOk   = activeClass === 'all' || s.cls === activeClass;
        const countryOk = !activeCountry || s.country === activeCountry;
        return classOk && countryOk;
    });
    renderTable();
    updateKPIs();
}

// ─── Tablo Render ─────────────────────────────────────────────────────────────
function renderTable() {
    const tbody = document.getElementById('score-tbody');
    const count = document.getElementById('table-count');
    count.textContent = `${filteredScores.length} kayıt`;

    if (filteredScores.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="8" style="text-align:center;padding:40px;color:#968B7A;">
                <i class="fa-solid fa-magnifying-glass mr-2"></i>Kriterlere uygun müşteri bulunamadı.
            </td></tr>`;
        return;
    }

    tbody.innerHTML = filteredScores.map((s, idx) => {
        const badgeClass = { A: 'score-badge-a', B: 'score-badge-b', C: 'score-badge-c' }[s.cls];
        const barColor   = { A: '#065F46',        B: '#92400E',       C: '#991B1B'       }[s.cls];
        const barPct     = s.total;

        return `
        <tr data-idx="${idx}" style="cursor:pointer;">
            <td>
                <span style="font-weight:500;color:#1C1A17;">${escHtml(s.name)}</span>
            </td>
            <td style="color:#6B655B;font-size:12px;">${escHtml(s.country)}</td>
            <td style="text-align:right;font-size:12px;font-family:monospace;color:#2D4A3E;">
                ${formatCurrency(s.totalAmount)}
            </td>
            <td style="text-align:center;">
                ${s.overdueCount > 0
                    ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;background:#FEE2E2;color:#991B1B;font-size:11px;font-weight:600;">
                        <i class="fa-solid fa-exclamation" style="font-size:8px;"></i>${s.overdueCount}
                       </span>`
                    : `<span style="color:#065F46;font-size:11px;"><i class="fa-solid fa-check"></i></span>`}
            </td>
            <td style="text-align:center;">
                ${s.complaintCount > 0
                    ? `<span style="padding:2px 8px;border-radius:99px;background:#FEF3C7;color:#92400E;font-size:11px;font-weight:600;">${s.complaintCount}</span>`
                    : `<span style="color:#065F46;font-size:11px;"><i class="fa-solid fa-check"></i></span>`}
            </td>
            <td style="text-align:center;font-size:12px;color:#7C3AED;font-weight:500;">
                %${s.avgDiscount.toFixed(1)}
            </td>
            <td style="text-align:center;">
                <div style="display:flex;align-items:center;gap:8px;justify-content:center;">
                    <div class="score-bar-wrap">
                        <div class="score-bar-fill" style="background:${barColor};width:${barPct}%;"></div>
                    </div>
                    <span style="font-weight:700;font-size:13px;color:${barColor};min-width:28px;">${s.total}</span>
                </div>
            </td>
            <td style="text-align:center;">
                <span class="${badgeClass}" style="display:inline-block;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:0.05em;">
                    ${s.cls}
                </span>
            </td>
        </tr>`;
    }).join('');

    // Row click → Modal
    tbody.querySelectorAll('tr[data-idx]').forEach(row => {
        row.addEventListener('click', () => {
            const idx = parseInt(row.dataset.idx);
            openDetailModal(filteredScores[idx]);
        });
    });
}

// ─── KPI Güncelle ─────────────────────────────────────────────────────────────
function updateKPIs() {
    const counts = { A: 0, B: 0, C: 0 };
    allScores.forEach(s => counts[s.cls]++);
    document.getElementById('kpi-a').textContent = counts.A;
    document.getElementById('kpi-b').textContent = counts.B;
    document.getElementById('kpi-c').textContent = counts.C;
}

// ─── Chart.js Dağılım Grafiği ─────────────────────────────────────────────────
function renderChart() {
    const counts = { A: 0, B: 0, C: 0 };
    allScores.forEach(s => counts[s.cls]++);

    const ctx = document.getElementById('chart-abc').getContext('2d');
    if (abcChart) abcChart.destroy();

    abcChart = new Chart(ctx, {
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
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.label}: ${ctx.raw} müşteri`
                    }
                }
            }
        }
    });

    // Legend
    const legend = document.getElementById('chart-legend');
    const total  = allScores.length || 1;
    legend.innerHTML = [
        { cls:'A', color:'#065F46', bg:'#D1FAE5', label:'A Sınıfı · Stratejik', count: counts.A },
        { cls:'B', color:'#92400E', bg:'#FEF3C7', label:'B Sınıfı · Geliştirilecek', count: counts.B },
        { cls:'C', color:'#991B1B', bg:'#FEE2E2', label:'C Sınıfı · Riskli', count: counts.C },
    ].map(item => `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:8px;">
                <div style="width:10px;height:10px;border-radius:3px;background:${item.color};"></div>
                <span style="font-size:11px;color:#6B655B;">${item.label}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:12px;font-weight:600;color:${item.color};">${item.count}</span>
                <span style="font-size:10px;color:#968B7A;">(${Math.round(item.count/total*100)}%)</span>
            </div>
        </div>`).join('');
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

    // Banner renk
    const colors = {
        A: { bg: '#D1FAE5', color: '#065F46', badge: '#065F46', badgeTxt: '#fff', label: 'A Sınıfı — Stratejik Müşteri' },
        B: { bg: '#FEF3C7', color: '#92400E', badge: '#92400E', badgeTxt: '#fff', label: 'B Sınıfı — Geliştirilecek' },
        C: { bg: '#FEE2E2', color: '#991B1B', badge: '#991B1B', badgeTxt: '#fff', label: 'C Sınıfı — Riskli / Az Karlı' },
    }[s.cls];

    const banner = document.getElementById('modal-score-banner');
    banner.style.background = colors.bg;
    banner.style.color = colors.color;
    document.getElementById('modal-total-score').textContent = `${s.total} / 100`;
    document.getElementById('modal-total-score').style.color = colors.color;

    const badge = document.getElementById('modal-class-badge');
    badge.textContent = colors.label;
    badge.style.background = colors.badge;
    badge.style.color = colors.badgeTxt;

    // Bileşenler
    setComponent('volume',    s.volumeScore,    30, `${formatCurrency(s.totalAmount)}`);
    setComponent('payment',   s.paymentScore,   30, `${s.overdueCount} gecikmiş sipariş`);
    setComponent('complaint', s.complaintScore, 20, `${s.complaintCount} credit note`);
    setComponent('discount',  s.discountScore,  20, `Ort. %${s.avgDiscount.toFixed(1)} iskonto`);

    document.getElementById('detail-modal').classList.add('open');
}

function setComponent(key, score, max, detail) {
    document.getElementById(`modal-score-${key}`).textContent = `${score}`;
    document.getElementById(`modal-bar-${key}`).style.width   = `${(score / max) * 100}%`;
    document.getElementById(`modal-detail-${key}`).textContent = detail;
}

function closeModal() {
    document.getElementById('detail-modal').classList.remove('open');
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function initExport() {
    document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
}

function exportCsv() {
    const headers = ['Müşteri Adı','Ülke','Toplam Sipariş (USD)','Gecikme','Şikayet','İskonto%','Hacim Puanı','Ödeme Puanı','Şikayet Puanı','İskonto Puanı','Toplam Skor','Sınıf'];
    const rows = filteredScores.map(s => [
        `"${s.name.replace(/"/g,'""')}"`,
        `"${s.country}"`,
        s.totalAmount.toFixed(2),
        s.overdueCount,
        s.complaintCount,
        s.avgDiscount.toFixed(1),
        s.volumeScore,
        s.paymentScore,
        s.complaintScore,
        s.discountScore,
        s.total,
        s.cls
    ].join(','));

    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `musteri-skor-raporu-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Yardımcı Fonksiyonlar ────────────────────────────────────────────────────
function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatCurrency(val) {
    if (!val) return '—';
    return parseFloat(val).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' $';
}
