import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

let monthlyChartInstance = null;
let currencyChartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
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
    yearSelect.addEventListener('change', () => fetchAndRenderDashboardData(parseInt(yearSelect.value)));
    fetchAndRenderDashboardData(currentYear);
}

async function fetchAndRenderDashboardData(selectedYear) {
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .order('order_date', { ascending: true });

        if (error) throw error;

        const filteredOrders = orders.filter(order =>
            new Date(order.order_date).getFullYear() === selectedYear
        );

        calculateKPIs(filteredOrders);
        renderCharts(filteredOrders);
    } catch (error) {
        console.error('Dashboard veri çekme hatası:', error.message);
    }
}

function calculateKPIs(orders) {
    const summary = {};
    orders.forEach(order => {
        const curr = order.currency || 'EUR';
        if (!summary[curr]) summary[curr] = { total: 0, advance: 0, remaining: 0 };
        summary[curr].total += parseFloat(order.total_amount) || 0;
        summary[curr].advance += parseFloat(order.advance_payment) || 0;
        summary[curr].remaining += parseFloat(order.remaining_balance) || 0;
    });

    const ciroContainer = document.getElementById('kpi-ciro-container');
    const avansContainer = document.getElementById('kpi-avans-container');
    const bakiyeContainer = document.getElementById('kpi-bakiye-container');
    ciroContainer.innerHTML = '';
    avansContainer.innerHTML = '';
    bakiyeContainer.innerHTML = '';

    const currencies = Object.keys(summary);
    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };

    if (currencies.length === 0) {
        ciroContainer.innerHTML = `<div class="text-slate-500 text-sm">Henüz sipariş yok</div>`;
        avansContainer.innerHTML = `<div class="text-slate-500 text-sm">--</div>`;
        bakiyeContainer.innerHTML = `<div class="text-slate-500 text-sm">--</div>`;
        return;
    }

    currencies.forEach(curr => {
        const symbol = currencySymbols[curr] || curr;
        const fmt = (v) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        ciroContainer.innerHTML += `<div class="flex justify-between"><span>${fmt(summary[curr].total)}</span><span class="text-xs text-purple-400 font-semibold">${symbol}</span></div>`;
        avansContainer.innerHTML += `<div class="flex justify-between"><span>${fmt(summary[curr].advance)}</span><span class="text-xs text-emerald-400 font-semibold">${symbol}</span></div>`;
        bakiyeContainer.innerHTML += `<div class="flex justify-between"><span>${fmt(summary[curr].remaining)}</span><span class="text-xs text-amber-400 font-semibold">${symbol}</span></div>`;
    });
}

function renderCharts(orders) {
    const monthlyCounts = Array(12).fill(0);
    orders.forEach(order => {
        monthlyCounts[new Date(order.order_date).getMonth()]++;
    });

    const ctxMonthly = document.getElementById('chart-monthly-performance').getContext('2d');
    if (monthlyChartInstance) monthlyChartInstance.destroy();
    monthlyChartInstance = new Chart(ctxMonthly, {
        type: 'line',
        data: {
            labels: ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'],
            datasets: [{
                label: 'Sipariş Adedi',
                data: monthlyCounts,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99,102,241,0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#818cf8',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8', stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });

    const currencyCounts = {};
    orders.forEach(order => {
        const curr = order.currency || 'EUR';
        currencyCounts[curr] = (currencyCounts[curr] || 0) + 1;
    });

    const ctxCurrency = document.getElementById('chart-currency-distribution').getContext('2d');
    if (currencyChartInstance) currencyChartInstance.destroy();
    currencyChartInstance = new Chart(ctxCurrency, {
        type: 'doughnut',
        data: {
            labels: Object.keys(currencyCounts),
            datasets: [{
                data: Object.values(currencyCounts),
                backgroundColor: ['#a855f7', '#10b981', '#f97316', '#3b82f6'],
                borderWidth: 2,
                borderColor: '#0f172a'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { size: 12 }, padding: 20 }
                }
            }
        }
    });
}
