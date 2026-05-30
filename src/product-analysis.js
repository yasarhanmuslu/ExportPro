import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    await renderNavbar('product-analysis');
    await loadAnalysis(session);
    document.getElementById('loading-overlay').style.display = 'none';
});

async function loadAnalysis(session) {
    const since12m = new Date();
    since12m.setMonth(since12m.getMonth() - 12);
    const sinceISO = since12m.toISOString().slice(0, 10);

    document.getElementById('data-period').textContent =
        `${since12m.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })} — Bugün`;

    // order_items → join orders → join customers + products
    const { data: items, error } = await supabase
        .from('order_items')
        .select(`
            id, product_name, product_code, quantity, unit_price, amount, currency,
            orders!inner(order_date, customer_id,
                customers!fk_orders_customer(id, company_name)
            ),
            products(product_group)
        `)
        .eq('user_id', session.user.id)
        .gte('orders.order_date', sinceISO);

    if (error) {
        console.error('Analiz verisi çekilemedi:', error.message);
        return;
    }

    if (!items || items.length === 0) {
        document.getElementById('kpi-total-items').textContent = '0';
        document.getElementById('kpi-unique-products').textContent = '0';
        document.getElementById('kpi-total-revenue').textContent = '0,00';
        document.getElementById('kpi-customer-count').textContent = '0';
        document.getElementById('matrix-table').style.display = 'none';
        document.getElementById('matrix-empty').classList.remove('hidden');
        return;
    }

    // ── KPI ──────────────────────────────────────────────────
    const uniqueProducts = new Set(items.map(i => i.product_name)).size;
    const uniqueCustomers = new Set(items.map(i => i.orders?.customer_id).filter(Boolean)).size;
    const totalRevenue = items.reduce((s, i) => {
        const amt = parseFloat(i.amount) || (parseFloat(i.quantity||0) * parseFloat(i.unit_price||0));
        return s + amt;
    }, 0);

    document.getElementById('kpi-total-items').textContent = items.length.toLocaleString('tr-TR');
    document.getElementById('kpi-unique-products').textContent = uniqueProducts.toLocaleString('tr-TR');
    document.getElementById('kpi-total-revenue').textContent = totalRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('kpi-customer-count').textContent = uniqueCustomers.toLocaleString('tr-TR');

    // ── En Çok Satan 10 Ürün ─────────────────────────────────
    const productMap = {};
    items.forEach(i => {
        const name = i.product_name || 'Belirtilmemiş';
        const amt = parseFloat(i.amount) || (parseFloat(i.quantity||0) * parseFloat(i.unit_price||0));
        if (!productMap[name]) productMap[name] = { qty: 0, amount: 0 };
        productMap[name].qty += parseFloat(i.quantity || 0);
        productMap[name].amount += amt;
    });

    const top10 = Object.entries(productMap)
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 10);

    renderTopProductsChart(top10);

    // ── Ürün Grubu Ciro ──────────────────────────────────────
    const groupMap = {};
    items.forEach(i => {
        const group = i.products?.product_group || 'Diğer';
        const amt = parseFloat(i.amount) || (parseFloat(i.quantity||0) * parseFloat(i.unit_price||0));
        groupMap[group] = (groupMap[group] || 0) + amt;
    });

    renderGroupChart(groupMap);

    // ── Müşteri-Ürün Matrisi ─────────────────────────────────
    renderMatrix(items);
}

function renderTopProductsChart(top10) {
    const ctx = document.getElementById('chart-top-products').getContext('2d');
    const labels = top10.map(([name]) => name.length > 28 ? name.slice(0, 28) + '…' : name);
    const data = top10.map(([, v]) => v.amount);

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Ciro',
                data,
                backgroundColor: 'rgba(52,211,153,0.7)',
                borderColor: 'rgb(52,211,153)',
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
                        label: ctx => ' ' + ctx.parsed.x.toLocaleString('tr-TR', { minimumFractionDigits: 2 })
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: 'rgb(100,116,139)', font: { size: 10 }, callback: v => v.toLocaleString('tr-TR') },
                    grid: { color: 'rgba(30,41,59,0.7)' }
                },
                y: {
                    ticks: { color: 'rgb(148,163,184)', font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });
}

const PALETTE = [
    'rgba(52,211,153,0.8)', 'rgba(249,115,22,0.8)', 'rgba(96,165,250,0.8)',
    'rgba(251,191,36,0.8)', 'rgba(167,139,250,0.8)', 'rgba(244,63,94,0.8)',
    'rgba(34,211,238,0.8)', 'rgba(163,230,53,0.8)', 'rgba(248,113,113,0.8)',
    'rgba(251,146,60,0.8)'
];

function renderGroupChart(groupMap) {
    const ctx = document.getElementById('chart-group-revenue').getContext('2d');
    const labels = Object.keys(groupMap);
    const data = Object.values(groupMap);
    const total = data.reduce((s, v) => s + v, 0);

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: PALETTE.slice(0, labels.length),
                borderColor: 'rgb(15,23,42)',
                borderWidth: 2,
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
                        label: ctx => {
                            const pct = ((ctx.parsed / total) * 100).toFixed(1);
                            return ` ${ctx.label}: ${ctx.parsed.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    // Legend
    const legendEl = document.getElementById('group-legend');
    legendEl.innerHTML = labels.map((label, i) => {
        const pct = ((data[i] / total) * 100).toFixed(1);
        return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:rgb(148,163,184);">
            <span style="width:10px;height:10px;border-radius:2px;background:${PALETTE[i]};flex-shrink:0;display:inline-block;"></span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>
            <span style="font-family:monospace;color:rgb(100,116,139);">${pct}%</span>
        </div>`;
    }).join('');
}

function renderMatrix(items) {
    // Ürün listesi (max 20)
    const productCount = {};
    items.forEach(i => {
        productCount[i.product_name] = (productCount[i.product_name] || 0) + 1;
    });
    const topProducts = Object.entries(productCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([name]) => name);

    // Müşteri listesi (max 15)
    const customerMap = {};
    items.forEach(i => {
        const cust = i.orders?.customers;
        if (cust) customerMap[cust.id] = cust.company_name;
    });
    const customers = Object.entries(customerMap).slice(0, 15);

    if (topProducts.length === 0 || customers.length === 0) {
        document.getElementById('matrix-table').style.display = 'none';
        document.getElementById('matrix-empty').classList.remove('hidden');
        return;
    }

    // Matrix data: product → set of customer_ids
    const matrix = {};
    items.forEach(i => {
        const custId = i.orders?.customer_id;
        if (!custId) return;
        if (!matrix[i.product_name]) matrix[i.product_name] = new Set();
        matrix[i.product_name].add(custId);
    });

    // Render header
    const thead = document.getElementById('matrix-thead');
    thead.innerHTML = `<tr>
        <th style="min-width:160px;">Ürün Adı</th>
        ${customers.map(([, name]) => `<th style="min-width:80px;writing-mode:vertical-lr;transform:rotate(180deg);height:80px;padding:4px 6px;">${name.length > 14 ? name.slice(0, 14) + '…' : name}</th>`).join('')}
    </tr>`;

    // Render body
    const tbody = document.getElementById('matrix-tbody');
    tbody.innerHTML = topProducts.map(product => {
        const custSet = matrix[product] || new Set();
        return `<tr>
            <td style="font-size:11px;color:rgb(203,213,225);font-weight:500;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${product}">${product}</td>
            ${customers.map(([custId]) =>
                `<td class="text-center">${custSet.has(custId) ? '<span class="dot" title="Satın aldı"></span>' : '<span class="dot-empty"></span>'}</td>`
            ).join('')}
        </tr>`;
    }).join('');
}
