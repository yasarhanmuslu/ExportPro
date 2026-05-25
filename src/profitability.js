import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// ── Global veri depoları ──────────────────────────────────────────────────────
let globalPrices = [];       // customer_prices + customers join
let globalOrders = [];       // orders (customer_id, total_amount)
let globalCustomerMap = {};  // { customerId: { company_name, prices[], totalOrders } }
let discountChart = null;

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    await renderNavbar('profitability');

    // Yenile butonu
    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
        const icon = document.querySelector('#btn-refresh i');
        icon?.classList.add('fa-spin');
        await loadAllData();
        icon?.classList.remove('fa-spin');
    });

    // Modal kapat
    document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
    document.getElementById('customer-detail-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('customer-detail-modal')) closeModal();
    });

    await loadAllData();
});

// ── Ana veri yükleme ─────────────────────────────────────────────────────────
async function loadAllData() {
    try {
        await Promise.all([fetchCustomerPrices(), fetchOrders()]);
        buildCustomerMap();
        renderKPIs();
        renderCustomerTable();
        renderDiscountChart();
        renderProductPriceAnalysis();
    } catch (err) {
        console.error('Karlılık analizi yükleme hatası:', err.message);
    }
}

// ── VERİ ÇEKME ───────────────────────────────────────────────────────────────

async function fetchCustomerPrices() {
    const { data, error } = await supabase
        .from('customer_prices')
        .select(`
            id, customer_id, product_name, list_price, discount_rate, net_price,
            customers ( id, company_name, country )
        `)
        .order('customer_id', { ascending: true });

    if (error) throw error;
    globalPrices = data || [];
}

async function fetchOrders() {
    const { data, error } = await supabase
        .from('orders')
        .select('customer_id, total_amount, currency')
        .order('customer_id', { ascending: true });

    if (error) throw error;
    globalOrders = data || [];
}

// ── VERİ BİRLEŞTİRME ─────────────────────────────────────────────────────────

function buildCustomerMap() {
    globalCustomerMap = {};

    // Müşteri fiyat kayıtlarını grupla
    globalPrices.forEach(p => {
        const cid = p.customer_id;
        if (!cid) return;
        if (!globalCustomerMap[cid]) {
            globalCustomerMap[cid] = {
                id: cid,
                company_name: p.customers?.company_name || 'Bilinmeyen',
                country: p.customers?.country || '',
                prices: [],
                totalOrders: 0
            };
        }
        globalCustomerMap[cid].prices.push(p);
    });

    // Sipariş toplamlarını müşteri bazında ekle
    globalOrders.forEach(o => {
        const cid = o.customer_id;
        if (cid && globalCustomerMap[cid]) {
            globalCustomerMap[cid].totalOrders += (o.total_amount || 0);
        }
    });
}

// ── KPI Hesaplama Yardımcıları ────────────────────────────────────────────────

function avgOf(arr, key) {
    if (!arr.length) return 0;
    return arr.reduce((s, x) => s + (parseFloat(x[key]) || 0), 0) / arr.length;
}

function sumOrders(orders) {
    return orders.reduce((s, o) => s + (o.total_amount || 0), 0);
}

function calcScore(avgDiscount, totalOrders, maxOrders) {
    if (maxOrders === 0) return 0;
    const weight = maxOrders > 0 ? totalOrders / maxOrders : 0;
    return Math.round((100 - avgDiscount) * (0.5 + 0.5 * weight));
}

function formatCurrency(val) {
    if (val >= 1_000_000) return (val / 1_000_000).toFixed(2) + ' M';
    if (val >= 1_000) return (val / 1_000).toFixed(1) + ' K';
    return val.toFixed(2);
}

function scoreClass(score) {
    if (score > 80) return 'score-green';
    if (score >= 60) return 'score-yellow';
    return 'score-red';
}

// ── A) KPI KARTLARI ──────────────────────────────────────────────────────────

function renderKPIs() {
    const allDiscounts = globalPrices.map(p => parseFloat(p.discount_rate) || 0);
    const avgDiscount = allDiscounts.length
        ? allDiscounts.reduce((a, b) => a + b, 0) / allDiscounts.length
        : 0;

    // En yüksek iskonto alan müşteri
    let maxDiscCustomer = '—';
    let maxDiscRate = 0;
    Object.values(globalCustomerMap).forEach(c => {
        const avg = avgOf(c.prices, 'discount_rate');
        if (avg > maxDiscRate) {
            maxDiscRate = avg;
            maxDiscCustomer = c.company_name;
        }
    });

    // Toplam net satış
    const totalSales = sumOrders(globalOrders);

    // Aktif müşteri sayısı (en az 1 siparişi olan)
    const activeCustomerIds = new Set(globalOrders.map(o => o.customer_id).filter(Boolean));
    const activeCount = activeCustomerIds.size;

    // DOM güncelle
    document.getElementById('kpi-avg-discount').textContent = avgDiscount.toFixed(1) + ' %';
    document.getElementById('kpi-avg-discount-sub').textContent =
        `${globalPrices.length} fiyat kaydı üzerinden`;

    document.getElementById('kpi-max-discount-customer').textContent = maxDiscCustomer;
    document.getElementById('kpi-max-discount-rate').textContent =
        maxDiscRate > 0 ? `% ${maxDiscRate.toFixed(1)} ortalama iskonto` : '—';
    document.getElementById('kpi-max-discount-rate').style.color = '#9F3D3D';

    document.getElementById('kpi-total-sales').textContent = formatCurrency(totalSales);
    document.getElementById('kpi-active-customers').textContent = activeCount;
}

// ── B) MÜŞTERİ TABLOSU ───────────────────────────────────────────────────────

function renderCustomerTable() {
    const tbody = document.getElementById('customer-discount-tbody');
    const countBadge = document.getElementById('customer-table-count');

    const customers = Object.values(globalCustomerMap);

    if (!customers.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#968B7A;">Fiyat kaydı bulunamadı.</td></tr>`;
        countBadge.textContent = '0 müşteri';
        return;
    }

    // Skor hesapla ve sırala
    const maxOrders = Math.max(...customers.map(c => c.totalOrders), 1);
    const rows = customers.map(c => {
        const avgDisc = avgOf(c.prices, 'discount_rate');
        const avgList = avgOf(c.prices, 'list_price');
        const avgNet  = avgOf(c.prices, 'net_price');
        const score   = calcScore(avgDisc, c.totalOrders, maxOrders);
        return { ...c, avgDisc, avgList, avgNet, score };
    }).sort((a, b) => b.score - a.score);

    countBadge.textContent = `${rows.length} müşteri`;

    tbody.innerHTML = rows.map(r => `
        <tr onclick="window.openCustomerModal('${r.id}')" title="Detay için tıklayın">
            <td>
                <div style="font-weight:500;color:#1C1A17;">${escHtml(r.company_name)}</div>
                ${r.country ? `<div style="font-size:11px;color:#968B7A;">${escHtml(r.country)}</div>` : ''}
            </td>
            <td style="text-align:right;font-family:monospace;font-size:12px;">${r.prices.length}</td>
            <td style="text-align:right;font-family:monospace;font-size:12px;">${r.avgList.toFixed(2)}</td>
            <td style="text-align:right;">
                <span style="font-weight:600;color:${r.avgDisc > 20 ? '#9F3D3D' : r.avgDisc > 10 ? '#B26B33' : '#3D6E50'};">
                    % ${r.avgDisc.toFixed(1)}
                </span>
            </td>
            <td style="text-align:right;font-family:monospace;font-size:12px;">${r.avgNet.toFixed(2)}</td>
            <td style="text-align:right;font-weight:500;color:#2D4A3E;">${formatCurrency(r.totalOrders)}</td>
            <td style="text-align:center;">
                <span class="score-badge ${scoreClass(r.score)}">${r.score}</span>
            </td>
        </tr>
    `).join('');
}

// ── C) İSKONTO DAĞILIMI GRAFİĞİ ──────────────────────────────────────────────

function renderDiscountChart() {
    const customers = Object.values(globalCustomerMap)
        .map(c => ({
            name: c.company_name.length > 14 ? c.company_name.substring(0, 12) + '…' : c.company_name,
            avgDisc: avgOf(c.prices, 'discount_rate')
        }))
        .filter(c => c.avgDisc > 0)
        .sort((a, b) => b.avgDisc - a.avgDisc);

    if (!customers.length) return;

    const ctx = document.getElementById('chart-discount-distribution')?.getContext('2d');
    if (!ctx) return;

    if (discountChart) {
        discountChart.destroy();
        discountChart = null;
    }

    const colors = customers.map(c => {
        if (c.avgDisc > 20) return 'rgba(159,61,61,0.75)';
        if (c.avgDisc > 10) return 'rgba(178,107,51,0.75)';
        return 'rgba(61,110,80,0.75)';
    });

    discountChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: customers.map(c => c.name),
            datasets: [{
                label: 'Ort. İskonto %',
                data: customers.map(c => parseFloat(c.avgDisc.toFixed(1))),
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace('0.75', '1')),
                borderWidth: 1,
                borderRadius: 4,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1C1A17',
                    titleFont: { family: 'DM Sans', size: 11 },
                    bodyFont: { family: 'DM Sans', size: 12 },
                    padding: 10,
                    callbacks: {
                        label: ctx => ` % ${ctx.raw} iskonto`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { family: 'DM Sans', size: 10 },
                        color: '#968B7A',
                        maxRotation: 35,
                        minRotation: 20
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#F4F0E8' },
                    ticks: {
                        font: { family: 'DM Sans', size: 10 },
                        color: '#968B7A',
                        callback: v => `%${v}`
                    }
                }
            }
        }
    });
}

// ── D) ÜRÜN BAZINDA NET FİYAT ANALİZİ ────────────────────────────────────────

function renderProductPriceAnalysis() {
    const container = document.getElementById('product-price-list');
    const incBadge = document.getElementById('product-inconsistency-count');

    // Ürün adına göre grupla
    const productMap = {};
    globalPrices.forEach(p => {
        const name = p.product_name?.trim() || 'Bilinmeyen';
        if (!productMap[name]) productMap[name] = [];
        productMap[name].push(parseFloat(p.net_price) || 0);
    });

    const products = Object.entries(productMap)
        .filter(([, prices]) => prices.length >= 2)
        .map(([name, prices]) => {
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
            const spread = max > 0 ? ((max - min) / max) * 100 : 0;
            return { name, min, max, avg, spread, count: prices.length };
        })
        .sort((a, b) => b.spread - a.spread);

    const inconsistentCount = products.filter(p => p.spread > 15).length;

    if (inconsistentCount > 0) {
        incBadge.textContent = `${inconsistentCount} tutarsız ürün`;
        incBadge.style.display = 'inline-flex';
    }

    if (!products.length) {
        container.innerHTML = `<div style="text-align:center;padding:24px;color:#968B7A;font-size:12px;">
            Karşılaştırılacak yeterli fiyat kaydı yok (en az 2 müşteri gerekli).
        </div>`;
        return;
    }

    // Tüm max değerlerin en büyüğü — bar görsel ölçekleme için
    const globalMax = Math.max(...products.map(p => p.max), 1);

    container.innerHTML = products.map(p => {
        const isInconsistent = p.spread > 15;
        const barLeft  = ((p.min / globalMax) * 100).toFixed(1);
        const barWidth = (((p.max - p.min) / globalMax) * 100).toFixed(1);
        const shortName = p.name.length > 26 ? p.name.substring(0, 24) + '…' : p.name;

        return `
        <div class="product-price-row">
            <div style="flex:0 0 160px;min-width:0;">
                <div style="font-size:12px;font-weight:500;color:#1C1A17;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(p.name)}">${escHtml(shortName)}</div>
                <div style="font-size:10px;color:#968B7A;margin-top:1px;">${p.count} müşteri</div>
            </div>
            <div class="price-range-bar">
                <div class="price-range-fill" style="left:${barLeft}%;width:${Math.max(parseFloat(barWidth),1)}%;"></div>
            </div>
            <div style="flex:0 0 auto;text-align:right;min-width:120px;">
                <div style="font-size:11px;font-family:monospace;color:#6B655B;">
                    <span style="color:#3D6E50;">${p.min.toFixed(2)}</span>
                    <span style="color:#968B7A;margin:0 3px;">—</span>
                    <span style="color:#9F3D3D;">${p.max.toFixed(2)}</span>
                </div>
                <div style="font-size:10px;color:#968B7A;">ort: ${p.avg.toFixed(2)}</div>
            </div>
            <span class="tag-badge ${isInconsistent ? 'tag-inconsistent' : 'tag-consistent'}" style="flex-shrink:0;">
                ${isInconsistent
                    ? `<i class="fa-solid fa-triangle-exclamation" style="font-size:9px;"></i> % ${p.spread.toFixed(0)} fark`
                    : `<i class="fa-solid fa-check" style="font-size:9px;"></i> tutarlı`
                }
            </span>
        </div>`;
    }).join('');
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

window.openCustomerModal = function(customerId) {
    const c = globalCustomerMap[customerId];
    if (!c) return;

    const avgDisc = avgOf(c.prices, 'discount_rate');
    const maxOrders = Math.max(...Object.values(globalCustomerMap).map(x => x.totalOrders), 1);
    const score = calcScore(avgDisc, c.totalOrders, maxOrders);

    document.getElementById('modal-customer-name').textContent = c.company_name;
    document.getElementById('modal-avg-discount').textContent = `% ${avgDisc.toFixed(1)}`;
    document.getElementById('modal-total-orders').textContent = formatCurrency(c.totalOrders);

    const scoreEl = document.getElementById('modal-score');
    scoreEl.textContent = score;
    scoreEl.style.color = score > 80 ? '#3D6E50' : score >= 60 ? '#B26B33' : '#9F3D3D';

    // Ürün tablosu
    const tbody = document.getElementById('modal-products-tbody');
    if (!c.prices.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:#968B7A;">Fiyat kaydı bulunamadı.</td></tr>`;
    } else {
        const sorted = [...c.prices].sort((a, b) =>
            (a.product_name || '').localeCompare(b.product_name || '', 'tr'));
        tbody.innerHTML = sorted.map(p => `
            <tr>
                <td style="font-weight:500;">${escHtml(p.product_name || '—')}</td>
                <td style="text-align:right;font-family:monospace;font-size:12px;">${parseFloat(p.list_price || 0).toFixed(2)}</td>
                <td style="text-align:right;">
                    <span style="font-weight:600;color:${parseFloat(p.discount_rate)>20?'#9F3D3D':parseFloat(p.discount_rate)>10?'#B26B33':'#3D6E50'};">
                        % ${parseFloat(p.discount_rate || 0).toFixed(1)}
                    </span>
                </td>
                <td style="text-align:right;font-family:monospace;font-size:12px;font-weight:600;color:#2D4A3E;">
                    ${parseFloat(p.net_price || 0).toFixed(2)}
                </td>
            </tr>
        `).join('');
    }

    document.getElementById('customer-detail-modal').classList.add('active');
};

function closeModal() {
    document.getElementById('customer-detail-modal')?.classList.remove('active');
}

// ── YARDIMCILAR ───────────────────────────────────────────────────────────────

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
