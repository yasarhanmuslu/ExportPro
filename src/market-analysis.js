import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// ── Flag emoji haritası ──────────────────────────────────────────────────────
const countryFlags = {
    'Germany': '🇩🇪', 'France': '🇫🇷', 'USA': '🇺🇸', 'United States': '🇺🇸',
    'United Kingdom': '🇬🇧', 'UK': '🇬🇧', 'Italy': '🇮🇹', 'Spain': '🇪🇸',
    'Netherlands': '🇳🇱', 'Belgium': '🇧🇪', 'Poland': '🇵🇱', 'Switzerland': '🇨🇭',
    'Austria': '🇦🇹', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰',
    'Finland': '🇫🇮', 'Portugal': '🇵🇹', 'Greece': '🇬🇷', 'Czech Republic': '🇨🇿',
    'Romania': '🇷🇴', 'Hungary': '🇭🇺', 'Slovakia': '🇸🇰', 'Bulgaria': '🇧🇬',
    'Croatia': '🇭🇷', 'Slovenia': '🇸🇮', 'Serbia': '🇷🇸', 'Ukraine': '🇺🇦',
    'Russia': '🇷🇺', 'Turkey': '🇹🇷', 'Türkiye': '🇹🇷',
    'Saudi Arabia': '🇸🇦', 'UAE': '🇦🇪', 'United Arab Emirates': '🇦🇪',
    'Qatar': '🇶🇦', 'Kuwait': '🇰🇼', 'Bahrain': '🇧🇭', 'Oman': '🇴🇲',
    'Egypt': '🇪🇬', 'Morocco': '🇲🇦', 'Tunisia': '🇹🇳', 'Algeria': '🇩🇿',
    'South Africa': '🇿🇦', 'Nigeria': '🇳🇬', 'Kenya': '🇰🇪', 'Ethiopia': '🇪🇹',
    'China': '🇨🇳', 'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'India': '🇮🇳',
    'Indonesia': '🇮🇩', 'Malaysia': '🇲🇾', 'Thailand': '🇹🇭', 'Vietnam': '🇻🇳',
    'Singapore': '🇸🇬', 'Philippines': '🇵🇭', 'Pakistan': '🇵🇰',
    'Brazil': '🇧🇷', 'Argentina': '🇦🇷', 'Mexico': '🇲🇽', 'Colombia': '🇨🇴',
    'Chile': '🇨🇱', 'Peru': '🇵🇪', 'Canada': '🇨🇦', 'Australia': '🇦🇺',
    'New Zealand': '🇳🇿', 'Israel': '🇮🇱', 'Jordan': '🇯🇴', 'Lebanon': '🇱🇧',
    'Iraq': '🇮🇶', 'Iran': '🇮🇷', 'Kazakhstan': '🇰🇿', 'Azerbaijan': '🇦🇿',
    'Georgia': '🇬🇪', 'Armenia': '🇦🇲', 'Belarus': '🇧🇾', 'Lithuania': '🇱🇹',
    'Latvia': '🇱🇻', 'Estonia': '🇪🇪', 'Luxembourg': '🇱🇺', 'Ireland': '🇮🇪',
    'Iceland': '🇮🇸', 'Malta': '🇲🇹', 'Cyprus': '🇨🇾', 'Albania': '🇦🇱',
    'Bosnia': '🇧🇦', 'North Macedonia': '🇲🇰', 'Montenegro': '🇲🇪',
    'Kosovo': '🇽🇰', 'Moldova': '🇲🇩', 'Libya': '🇱🇾', 'Sudan': '🇸🇩',
    'Ghana': '🇬🇭', 'Tanzania': '🇹🇿', 'Uganda': '🇺🇬',
};

function getFlag(country) {
    return countryFlags[country] || '🌐';
}

function fmt(n) {
    return (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Chart instances (destroy before re-render)
let chartCiro = null;
let chartTrend = null;

// Global data store for trend chart
let globalOrdersByCountry = {};

// ── Entry point ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    await renderNavbar('market-analysis');

    const thisYear = new Date().getFullYear();
    document.getElementById('data-year').textContent = `${thisYear - 2} – ${thisYear} Yılları`;

    await loadMarketData(session);

    document.getElementById('loading-overlay').style.display = 'none';
});

// ── Ana veri yükleme ─────────────────────────────────────────────────────────
async function loadMarketData(session) {
    const uid = session.user.id;
    const thisYear = new Date().getFullYear();
    const thisMonth = new Date().getMonth() + 1; // 1-12

    // 1) Tüm müşteriler
    const { data: customers, error: custErr } = await supabase
        .from('customers')
        .select('id, company_name, country, history_date')
        .eq('user_id', uid);

    if (custErr) { console.error('customers:', custErr.message); return; }

    // 2) Tüm siparişler
    const { data: orders, error: ordErr } = await supabase
        .from('orders')
        .select('id, customer_id, order_date, total_amount, currency')
        .eq('user_id', uid);

    if (ordErr) { console.error('orders:', ordErr.message); return; }

    // 3) Tüm credit_notes (şikayetler)
    const { data: creditNotes, error: cnErr } = await supabase
        .from('credit_notes')
        .select('id, customer_id, cn_date')
        .eq('user_id', uid);

    if (cnErr) { console.error('credit_notes:', cnErr.message); return; }

    // ── Müşteri ID → Ülke haritası ────────────────────────────────────────────
    const custMap = {};
    customers.forEach(c => {
        custMap[c.id] = { country: c.country || 'Belirtilmemiş', name: c.company_name, history_date: c.history_date };
    });

    // ── Ülke bazında gruplama ─────────────────────────────────────────────────
    const countryData = {}; // { country: { customers: Set, orders: [], creditNotes: [] } }

    customers.forEach(c => {
        const co = c.country || 'Belirtilmemiş';
        if (!countryData[co]) countryData[co] = { customers: new Set(), orders: [], creditNotes: [], historyDates: [] };
        countryData[co].customers.add(c.id);
        if (c.history_date) countryData[co].historyDates.push(c.history_date);
    });

    orders.forEach(o => {
        const cust = custMap[o.customer_id];
        if (!cust) return;
        const co = cust.country;
        if (!countryData[co]) countryData[co] = { customers: new Set(), orders: [], creditNotes: [], historyDates: [] };
        countryData[co].orders.push(o);
    });

    creditNotes.forEach(cn => {
        const cust = custMap[cn.customer_id];
        if (!cust) return;
        const co = cust.country;
        if (!countryData[co]) countryData[co] = { customers: new Set(), orders: [], creditNotes: [], historyDates: [] };
        countryData[co].creditNotes.push(cn);
    });

    // ── Her ülke için metrikler ───────────────────────────────────────────────
    const rows = [];

    // Cari yıl ayı filtresi için
    const startThisYear = `${thisYear}-01-01`;
    const endThisYearSoFar = `${thisYear}-${String(thisMonth).padStart(2,'0')}-31`;
    const startPrevYear = `${thisYear - 1}-01-01`;
    const endPrevYearSamePeriod = `${thisYear - 1}-${String(thisMonth).padStart(2,'0')}-31`;

    Object.entries(countryData).forEach(([country, data]) => {
        const totalOrders = data.orders.length;
        const totalRevenue = data.orders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
        const totalComplaints = data.creditNotes.length;
        const complaintRate = totalOrders > 0 ? (totalComplaints / totalOrders * 100) : 0;

        // YoY büyüme: bu yılın ilk X ayı vs geçen yılın aynı dönemi
        const revenueThisYear = data.orders
            .filter(o => o.order_date >= startThisYear && o.order_date <= endThisYearSoFar)
            .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);

        const revenuePrevYear = data.orders
            .filter(o => o.order_date >= startPrevYear && o.order_date <= endPrevYearSamePeriod)
            .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);

        let yoy = null;
        if (revenuePrevYear > 0) {
            yoy = ((revenueThisYear - revenuePrevYear) / revenuePrevYear) * 100;
        } else if (revenueThisYear > 0) {
            yoy = 100; // Yeni pazar
        }

        // Bu yıl yeni eklenen ülke kontrolü (customers.history_date)
        const isNewThisYear = data.historyDates.some(d => d && d.startsWith(String(thisYear)));

        rows.push({
            country,
            customerCount: data.customers.size,
            totalOrders,
            totalRevenue,
            totalComplaints,
            complaintRate,
            yoy,
            isNewThisYear,
            customerIds: [...data.customers],
        });
    });

    // Ciroya göre azalan sıralama
    rows.sort((a, b) => b.totalRevenue - a.totalRevenue);

    // ── KPI HESAPLAMALARI ─────────────────────────────────────────────────────
    const totalCountries = rows.filter(r => r.totalOrders > 0 || r.totalRevenue > 0).length;

    const topCountry = rows[0] || null;

    const complaintRows = rows.filter(r => r.totalOrders > 0 && r.totalComplaints > 0);
    complaintRows.sort((a, b) => b.complaintRate - a.complaintRate);
    const topComplaintCountry = complaintRows[0] || null;

    const newCountriesThisYear = rows.filter(r => r.isNewThisYear).length;

    // KPI güncelle
    document.getElementById('kpi-country-count').textContent = totalCountries;
    if (topCountry) {
        document.getElementById('kpi-top-country').textContent = `${getFlag(topCountry.country)} ${topCountry.country}`;
        document.getElementById('kpi-top-amount').textContent = `$${fmt(topCountry.totalRevenue)} USD`;
    }
    if (topComplaintCountry) {
        document.getElementById('kpi-complaint-country').textContent = `${getFlag(topComplaintCountry.country)} ${topComplaintCountry.country}`;
        document.getElementById('kpi-complaint-rate').textContent = `%${topComplaintCountry.complaintRate.toFixed(1)} şikayet oranı`;
    } else {
        document.getElementById('kpi-complaint-country').textContent = '—';
        document.getElementById('kpi-complaint-rate').textContent = 'Şikayet kaydı yok';
    }
    document.getElementById('kpi-new-countries').textContent = newCountriesThisYear;

    // ── TABLO ─────────────────────────────────────────────────────────────────
    renderTable(rows, custMap, customers);

    // ── GRAFİKLER ─────────────────────────────────────────────────────────────
    renderCiroChart(rows.slice(0, 15));

    // Trend için ülke dropdown
    globalOrdersByCountry = {};
    rows.forEach(r => {
        globalOrdersByCountry[r.country] = countryData[r.country].orders;
    });
    populateTrendDropdown(rows);
}

// ── TABLO RENDER ─────────────────────────────────────────────────────────────
function renderTable(rows, custMap, allCustomers) {
    const tbody = document.getElementById('country-table-body');

    if (rows.length === 0) {
        document.getElementById('country-table').style.display = 'none';
        document.getElementById('table-empty').classList.remove('hidden');
        return;
    }

    const maxComplaintRate = Math.max(...rows.map(r => r.complaintRate), 1);

    tbody.innerHTML = rows.map(row => {
        const flag = getFlag(row.country);
        const yoyHtml = row.yoy === null
            ? `<span class="growth-neu">—</span>`
            : row.yoy > 0
                ? `<span class="growth-pos"><i class="fa-solid fa-arrow-trend-up" style="font-size:10px;"></i> +${row.yoy.toFixed(1)}%</span>`
                : row.yoy < 0
                    ? `<span class="growth-neg"><i class="fa-solid fa-arrow-trend-down" style="font-size:10px;"></i> ${row.yoy.toFixed(1)}%</span>`
                    : `<span class="growth-neu">0%</span>`;

        const barWidth = maxComplaintRate > 0 ? (row.complaintRate / maxComplaintRate * 100) : 0;

        return `<tr data-country="${encodeURIComponent(row.country)}">
            <td>
                <span style="font-size:16px;margin-right:6px;">${flag}</span>
                <strong style="color:#1C1A17;">${row.country}</strong>
            </td>
            <td style="color:#3D3A34;">${row.customerCount}</td>
            <td style="color:#3D3A34;">${row.totalOrders}</td>
            <td style="font-weight:600;color:#2D4A3E;">$${fmt(row.totalRevenue)}</td>
            <td style="color:#C97B4B;">${row.totalComplaints}</td>
            <td>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div class="complaint-bar-bg">
                        <div class="complaint-bar-fill" style="width:${barWidth}%;"></div>
                    </div>
                    <span style="font-size:11px;color:#968B7A;">%${row.complaintRate.toFixed(1)}</span>
                </div>
            </td>
            <td>${yoyHtml}</td>
        </tr>`;
    }).join('');

    // Tıklama → modal
    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            const country = decodeURIComponent(tr.dataset.country);
            openCountryModal(country, custMap, allCustomers);
        });
    });
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openCountryModal(country, custMap, allCustomers) {
    const flag = getFlag(country);
    document.getElementById('modal-title').textContent = `${flag} ${country}`;

    const countryCusts = allCustomers.filter(c => (c.country || 'Belirtilmemiş') === country);
    document.getElementById('modal-subtitle').textContent = `${countryCusts.length} müşteri`;

    const bodyHtml = countryCusts.length === 0
        ? `<p style="color:#968B7A;font-size:13px;text-align:center;padding:24px;">Bu ülkede müşteri kaydı yok.</p>`
        : `<table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
                <tr style="border-bottom:2px solid #EFEAE0;">
                    <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#968B7A;">Firma Adı</th>
                    <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#968B7A;">Statü</th>
                    <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#968B7A;">İlk Kayıt</th>
                </tr>
            </thead>
            <tbody>
                ${countryCusts.map(c => `
                    <tr style="border-bottom:1px solid #F0EBE1;">
                        <td style="padding:9px 10px;color:#1C1A17;font-weight:500;">${c.company_name || '—'}</td>
                        <td style="padding:9px 10px;">
                            <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;
                                background:${c.status === 'active' ? '#E8F5E9' : '#FBF8F1'};
                                color:${c.status === 'active' ? '#2D6A4F' : '#968B7A'};">
                                ${c.status || 'Bilinmiyor'}
                            </span>
                        </td>
                        <td style="padding:9px 10px;color:#968B7A;font-size:11px;">${c.history_date ? new Date(c.history_date).toLocaleDateString('tr-TR') : '—'}</td>
                    </tr>`).join('')}
            </tbody>
        </table>`;

    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.add('open');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('modal-close')?.addEventListener('click', () => {
        document.getElementById('modal-overlay').classList.remove('open');
    });
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('modal-overlay')) {
            document.getElementById('modal-overlay').classList.remove('open');
        }
    });
});

// ── C) CİRO GRAFİĞİ (Horizontal Bar) ────────────────────────────────────────
function renderCiroChart(rows) {
    const labels = rows.map(r => `${getFlag(r.country)} ${r.country}`);
    const data   = rows.map(r => r.totalRevenue);

    const ctx = document.getElementById('chart-ciro').getContext('2d');
    if (chartCiro) chartCiro.destroy();

    chartCiro = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Ciro (USD)',
                data,
                backgroundColor: data.map((_, i) =>
                    i === 0 ? 'rgba(45,74,62,0.85)' :
                    i < 3   ? 'rgba(45,74,62,0.60)' :
                              'rgba(45,74,62,0.35)'
                ),
                borderColor: 'rgba(45,74,62,0.8)',
                borderWidth: 1,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` $${fmt(ctx.parsed.x)} USD`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#F0EBE1' },
                    ticks: {
                        font: { family: 'Verdana', size: 10 },
                        color: '#968B7A',
                        callback: v => `$${(v/1000).toFixed(0)}K`
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { family: 'Verdana', size: 11 }, color: '#3D3A34' }
                }
            }
        }
    });
}

// ── D) TREND GRAFİĞİ ─────────────────────────────────────────────────────────
function populateTrendDropdown(rows) {
    const select = document.getElementById('trend-country-select');
    rows.forEach(r => {
        if (r.totalOrders > 0) {
            const opt = document.createElement('option');
            opt.value = r.country;
            opt.textContent = `${getFlag(r.country)} ${r.country}`;
            select.appendChild(opt);
        }
    });

    select.addEventListener('change', () => {
        const country = select.value;
        if (!country) return;
        renderTrendChart(country);
    });
}

function renderTrendChart(country) {
    const orders = globalOrdersByCountry[country] || [];
    const thisYear = new Date().getFullYear();
    const years = [thisYear - 2, thisYear - 1, thisYear];
    const months = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];

    // Her yıl için aylık ciro
    const datasets = years.map((year, idx) => {
        const monthlyRevenue = Array(12).fill(0);
        orders.forEach(o => {
            if (!o.order_date) return;
            const d = new Date(o.order_date);
            if (d.getFullYear() === year) {
                monthlyRevenue[d.getMonth()] += parseFloat(o.total_amount) || 0;
            }
        });
        const colors = [
            'rgba(45,74,62,0.35)',
            'rgba(45,74,62,0.60)',
            'rgba(45,74,62,0.95)',
        ];
        return {
            label: String(year),
            data: monthlyRevenue,
            borderColor: colors[idx],
            backgroundColor: colors[idx].replace(')', ',0.08)').replace('rgba','rgba'),
            borderWidth: idx === 2 ? 2.5 : 1.5,
            tension: 0.4,
            fill: idx === 2,
            pointRadius: 3,
            pointHoverRadius: 5,
        };
    });

    document.getElementById('trend-empty').style.display = 'none';

    const ctx = document.getElementById('chart-trend').getContext('2d');
    if (chartTrend) chartTrend.destroy();

    chartTrend = new Chart(ctx, {
        type: 'line',
        data: { labels: months, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { font: { family: 'Verdana', size: 11 }, color: '#3D3A34', boxWidth: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: $${fmt(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#F0EBE1' },
                    ticks: { font: { family: 'Verdana', size: 10 }, color: '#968B7A' }
                },
                y: {
                    grid: { color: '#F0EBE1' },
                    ticks: {
                        font: { family: 'Verdana', size: 10 },
                        color: '#968B7A',
                        callback: v => `$${(v/1000).toFixed(0)}K`
                    }
                }
            }
        }
    });
}
