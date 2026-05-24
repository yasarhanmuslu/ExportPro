import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';

// Global Grafik Değişkenleri (Yeniden çizimlerde çakışmayı önlemek için)
let monthlyChartInstance = null;
let currencyChartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Ortak Navbar'ı Yükle ('dashboard' aktif)
    await renderNavbar('dashboard');
    
    // 2. Yıl Seçim Kutusunu Hazırla ve Verileri Çek
    initYearSelector();
});

function initYearSelector() {
    const yearSelect = document.getElementById('year-select');
    const currentYear = new Date().getFullYear();
    
    // Son 5 yılı dinamik olarak ekle
    for (let i = 0; i < 5; i++) {
        const option = document.createElement('option');
        option.value = currentYear - i;
        option.textContent = currentYear - i;
        yearSelect.appendChild(option);
    }

    // Yıl değiştiğinde verileri güncelle
    yearSelect.addEventListener('change', () => {
        fetchAndRenderDashboardData(parseInt(yearSelect.value));
    });

    // İlk açılışta güncel yılı tetikle
    fetchAndRenderDashboardData(currentYear);
}

async function fetchAndRenderDashboardData(selectedYear) {
    try {
        // Supabase'den giriş yapmış kullanıcının siparişlerini getir (RLS otomatik süzer)
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .order('order_date', { ascending: true });

        if (error) throw error;

        // Filtreleme: Sadece seçilen yıla ait verileri ayıkla
        const filteredOrders = orders.filter(order => {
            const orderYear = new Date(order.order_date).getFullYear();
            return orderYear === selectedYear;
        });

        // 1. KPI Hesaplamalarını Yap ve Bas
        calculateKPIs(filteredOrders);

        // 2. Grafikleri Hazırla ve Çiz
        renderCharts(filteredOrders);

    } catch (error) {
        console.error("Dashboard veri çekme hatası:", error.message);
        alert("Veriler yüklenirken bir sorun oluştu. Lütfen bağlantınızı kontrol edin.");
    }
}

function calculateKPIs(orders) {
    // Para birimlerine göre kırılım nesneleri
    const summary = {};

    orders.forEach(order => {
        const curr = order.currency || 'EUR';
        const total = parseFloat(order.total_amount) || 0;
        const advance = parseFloat(order.advance_payment) || 0;
        const remaining = parseFloat(order.remaining_balance) || 0;

        if (!summary[curr]) {
            summary[curr] = { total: 0, advance: 0, remaining: 0 };
        }

        summary[curr].total += total;
        summary[curr].advance += advance;
        summary[curr].remaining += remaining;
    });

    const ciroContainer = document.getElementById('kpi-ciro-container');
    const avansContainer = document.getElementById('kpi-avans-container');
    const bakiyeContainer = document.getElementById('kpi-bakiye-container');

    // Temizlik
    ciroContainer.innerHTML = '';
    avansContainer.innerHTML = '';
    bakiyeContainer.innerHTML = '';

    const currencies = Object.keys(summary);

    if (currencies.length === 0) {
        ciroContainer.innerHTML = `<div class="text-slate-500 text-sm font-normal">Kayıt bulunamadı</div>`;
        avansContainer.innerHTML = `<div class="text-slate-500 text-sm font-normal">--</div>`;
        bakiyeContainer.innerHTML = `<div class="text-slate-500 text-sm font-normal">--</div>`;
        return;
    }

    // Para birimi simge haritası
    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };

    currencies.forEach(curr => {
        const symbol = currencySymbols[curr] || curr;
        
        // Ciro Satırı
        const ciroRow = document.createElement('div');
        ciroRow.className = "flex justify-between items-center border-b border-slate-800/40 pb-1 last:border-0";
        ciroRow.innerHTML = `<span>${summary[curr].total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span> <span class="text-xs text-purple-400 font-semibold">${symbol}</span>`;
        ciroContainer.appendChild(ciroRow);

        // Avans Satırı
        const avansRow = document.createElement('div');
        avansRow.className = "flex justify-between items-center border-b border-slate-800/40 pb-1 last:border-0";
        avansRow.innerHTML = `<span>${summary[curr].advance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span> <span class="text-xs text-emerald-400 font-semibold">${symbol}</span>`;
        avansContainer.appendChild(avansRow);

        // Bakiye Satırı
        const bakiyeRow = document.createElement('div');
        bakiyeRow.className = "flex justify-between items-center border-b border-slate-800/40 pb-1 last:border-0";
        bakiyeRow.innerHTML = `<span>${summary[curr].remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span> <span class="text-xs text-amber-400 font-semibold">${symbol}</span>`;
        bakiyeContainer.appendChild(bakiyeRow);
    });
}

function renderCharts(orders) {
    // --- 1. AYLIK SİPARİŞ ADET DAĞILIMI VERİSİ ---
    const monthlyCounts = Array(12).fill(0);
    orders.forEach(order => {
        const month = new Date(order.order_date).getMonth(); // 0 - 11
        monthlyCounts[month]++;
    });

    const ctxMonthly = document.getElementById('chart-monthly-performance').getContext('2d');
    if (monthlyChartInstance) monthlyChartInstance.destroy();
    
    monthlyChartInstance = new Chart(ctxMonthly, {
        type: 'line',
        data: {
            labels: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
            datasets: [{
                label: 'Sipariş Adedi',
                data: monthlyCounts,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
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

    // --- 2. PARA BİRİMİ DAĞILIM VERİSİ ---
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