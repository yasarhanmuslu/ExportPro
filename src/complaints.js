import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess } from './utils/permissions.js';

// ── Global veri depoları ──────────────────────────────────────────────────────
let rawData = [];          // Tüm credit_notes (items + customers dahil)
let filteredItems = [];    // Aktif filtreye göre credit_note_items (düzleştirilmiş)
let decisionChart = null;
let monthlyChart  = null;

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    const ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'complaints'))) return;

    await renderNavbar('complaints', ctx);
    await loadData(session);
    initEventListeners();
});

// ── Veri yükleme ─────────────────────────────────────────────────────────────
async function loadData(session) {
    try {
        // 1) credit_notes — SADECE kendi alanları, join YOK (FK belirsizliğini önler)
        const { data: notes, error: notesErr } = await supabase
            .from('credit_notes')
            .select('id, customer_id, cn_date, process_status, user_id')
            .eq('user_id', session.user.id)
            .order('cn_date', { ascending: false });
        if (notesErr) throw notesErr;

        const cnIds      = (notes || []).map(n => n.id);
        const customerIds = [...new Set((notes || []).map(n => n.customer_id).filter(Boolean))];

        // 2) customers — doğrudan customers tablosundan çek
        let customerMap = {}; // { customer_id: { company_name, country } }
        if (customerIds.length > 0) {
            const { data: customers, error: custErr } = await supabase
                .from('customers')
                .select('id, company_name, country')
                .in('id', customerIds);
            if (custErr) throw custErr;
            (customers || []).forEach(c => { customerMap[c.id] = c; });
        }

        // 3) credit_note_items — ayrı sorgu
        let itemsMap = {}; // { credit_note_id: [items] }
        if (cnIds.length > 0) {
            const { data: items, error: itemsErr } = await supabase
                .from('credit_note_items')
                .select('*')
                .in('credit_note_id', cnIds);
            if (itemsErr) throw itemsErr;
            (items || []).forEach(item => {
                if (!itemsMap[item.credit_note_id]) itemsMap[item.credit_note_id] = [];
                itemsMap[item.credit_note_id].push(item);
            });
        }

        // 4) Manuel birleştir
        rawData = (notes || []).map(cn => ({
            ...cn,
            customers:         customerMap[cn.customer_id] || null,
            credit_note_items: itemsMap[cn.id] || []
        }));

        populateFilterOptions();
        applyFiltersAndRender();

    } catch (err) {
        console.error('Sikayet verisi yuklenemedi:', err.message);
        showError('Veriler yuklenirken bir hata olustu: ' + err.message);
    }
}

// ── Filtre seçeneklerini doldur ───────────────────────────────────────────────
function populateFilterOptions() {
    // Müşteri listesi
    const customerSelect = document.getElementById('filter-customer');
    const customers = [...new Map(
        rawData
            .filter(cn => cn.customers)
            .map(cn => [cn.customer_id, cn.customers.company_name])
    ).entries()].sort((a, b) => a[1].localeCompare(b[1]));

    customerSelect.innerHTML = '<option value="">Tüm Müşteriler</option>';
    customers.forEach(([id, name]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        customerSelect.appendChild(opt);
    });

    // Ürün kodu listesi
    const productSelect = document.getElementById('filter-product-code');
    const codes = [...new Set(
        rawData.flatMap(cn => (cn.credit_note_items || []).map(i => i.product_code).filter(Boolean))
    )].sort();

    productSelect.innerHTML = '<option value="">Tüm Ürünler</option>';
    codes.forEach(code => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = code;
        productSelect.appendChild(opt);
    });
}

// ── Filtreleri uygula ve render ───────────────────────────────────────────────
function applyFiltersAndRender() {
    const dateStart    = document.getElementById('filter-date-start').value;
    const dateEnd      = document.getElementById('filter-date-end').value;
    const customerId   = document.getElementById('filter-customer').value;
    const productCode  = document.getElementById('filter-product-code').value;
    const decision     = document.getElementById('filter-decision').value;

    // Önce credit_notes filtrele
    let filteredNotes = rawData.filter(cn => {
        if (dateStart && cn.cn_date < dateStart) return false;
        if (dateEnd   && cn.cn_date > dateEnd)   return false;
        if (customerId && cn.customer_id !== customerId) return false;
        return true;
    });

    // Sonra item'ları düzleştir ve filtrele
    filteredItems = filteredNotes.flatMap(cn =>
        (cn.credit_note_items || [])
            .filter(item => {
                if (productCode && item.product_code !== productCode) return false;
                if (decision    && item.decision      !== decision)    return false;
                return true;
            })
            .map(item => ({
                ...item,
                cn_date:        cn.cn_date,
                process_status: cn.process_status,
                company_name:   cn.customers?.company_name || '—',
                country:        cn.customers?.country      || '—',
                customer_id:    cn.customer_id,
                // credit_note_items içinde user_id'ye bağlı olarak CN id'si zaten var
            }))
    );

    // Bekleyen CN sayısı (item filtresinden bağımsız, CN seviyesinde)
    const pendingCNCount = filteredNotes.filter(cn => cn.process_status === 'İncelemede').length;

    // Sayı göster
    document.getElementById('filter-result-count').textContent = filteredItems.length.toLocaleString('tr-TR');

    renderKPIs(pendingCNCount);
    renderProductRanking();
    renderCustomerRanking();
    renderDecisionChart();
    renderMonthlyChart();
}

// ── A) KPI'lar ────────────────────────────────────────────────────────────────
function renderKPIs(pendingCNCount) {
    const total    = filteredItems.length;
    const accepted = filteredItems.filter(i => i.decision === 'Kabul').length;
    const rejected = filteredItems.filter(i => i.decision === 'Red').length;

    document.getElementById('kpi-total').textContent    = total.toLocaleString('tr-TR');
    document.getElementById('kpi-accepted').textContent = accepted.toLocaleString('tr-TR');
    document.getElementById('kpi-rejected').textContent = rejected.toLocaleString('tr-TR');
    document.getElementById('kpi-pending').textContent  = (pendingCNCount || 0).toLocaleString('tr-TR');

    const acceptRate = total > 0 ? ((accepted / total) * 100).toFixed(1) : '0.0';
    const rejectRate = total > 0 ? ((rejected / total) * 100).toFixed(1) : '0.0';
    document.getElementById('kpi-accepted-rate').textContent = `%${acceptRate} kabul oranı`;
    document.getElementById('kpi-rejected-rate').textContent = `%${rejectRate} red oranı`;
}

// ── B) Ürün Bazında Sıralama ──────────────────────────────────────────────────
function renderProductRanking() {
    const tbody = document.getElementById('product-ranking-body');

    // Ürün kodu bazında grupla
    const productMap = {};
    filteredItems.forEach(item => {
        const code = item.product_code || '(Belirsiz)';
        const name = item.product_name || '—';
        if (!productMap[code]) {
            productMap[code] = { code, name, items: [] };
        }
        productMap[code].items.push(item);
    });

    const products = Object.values(productMap)
        .sort((a, b) => b.items.length - a.items.length);

    if (products.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#968B7A;padding:24px;">Gösterilecek veri yok</td></tr>`;
        return;
    }

    tbody.innerHTML = products.map(p => {
        const count    = p.items.length;
        const accepted = p.items.filter(i => i.decision === 'Kabul').length;
        const rate     = count > 0 ? ((accepted / count) * 100).toFixed(0) : 0;
        const lastDate = p.items
            .map(i => i.cn_date)
            .sort()
            .reverse()[0] || '—';

        const barColor = rate >= 70 ? '#9F3D3D' : rate >= 40 ? '#B26B33' : '#3D6E50';

        return `
        <tr data-product-code="${escapeHtml(p.code)}" class="product-row" style="cursor:pointer;">
            <td>
                <div style="font-size:12px;font-weight:600;color:#1C1A17;">${escapeHtml(p.code)}</div>
                <div style="font-size:11px;color:#968B7A;">${escapeHtml(p.name)}</div>
            </td>
            <td class="text-center">
                <span style="font-weight:700;font-size:15px;color:#1C1A17;">${count}</span>
            </td>
            <td>
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="progress-bar-bg" style="flex:1;">
                        <div class="progress-bar-fill" style="width:${rate}%;background:${barColor};"></div>
                    </div>
                    <span style="font-size:11px;color:${barColor};font-weight:600;min-width:32px;">%${rate}</span>
                </div>
            </td>
            <td style="font-size:11px;color:#968B7A;">${formatDate(lastDate)}</td>
        </tr>`;
    }).join('');

    // Tıklama olayı
    tbody.querySelectorAll('.product-row').forEach(row => {
        row.addEventListener('click', () => {
            const code = row.dataset.productCode;
            openProductModal(code);
        });
    });
}

// ── C) Müşteri Bazında Sıralama ───────────────────────────────────────────────
function renderCustomerRanking() {
    const tbody = document.getElementById('customer-ranking-body');

    const customerMap = {};
    filteredItems.forEach(item => {
        const key = item.customer_id || item.company_name;
        if (!customerMap[key]) {
            customerMap[key] = {
                name: item.company_name,
                country: item.country,
                items: []
            };
        }
        customerMap[key].items.push(item);
    });

    const customers = Object.values(customerMap)
        .sort((a, b) => b.items.length - a.items.length);

    if (customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#968B7A;padding:24px;">Gösterilecek veri yok</td></tr>`;
        return;
    }

    tbody.innerHTML = customers.map(c => {
        const total    = c.items.length;
        const accepted = c.items.filter(i => i.decision === 'Kabul').length;
        const rejected = c.items.filter(i => i.decision === 'Red').length;
        const dates    = c.items.map(i => i.cn_date).filter(Boolean).sort();
        const firstDate = dates[0] || '—';
        const lastDate  = dates[dates.length - 1] || '—';

        return `
        <tr>
            <td>
                <div style="font-size:12.5px;font-weight:600;color:#1C1A17;">${escapeHtml(c.name)}</div>
                <div style="font-size:11px;color:#968B7A;">${escapeHtml(c.country)}</div>
            </td>
            <td class="text-center">
                <span style="font-weight:700;font-size:15px;color:#1C1A17;">${total}</span>
            </td>
            <td class="text-center">
                <span class="badge badge-kabul">${accepted}</span>
                <span style="color:#E4DDCE;margin:0 2px;">/</span>
                <span class="badge badge-red">${rejected}</span>
            </td>
            <td>
                <div style="font-size:10.5px;color:#968B7A;">${formatDate(firstDate)}</div>
                <div style="font-size:10.5px;color:#1C1A17;">${formatDate(lastDate)}</div>
            </td>
        </tr>`;
    }).join('');
}

// ── D) Karar Dağılımı Doughnut ────────────────────────────────────────────────
function renderDecisionChart() {
    const kabul    = filteredItems.filter(i => i.decision === 'Kabul').length;
    const red      = filteredItems.filter(i => i.decision === 'Red').length;
    const mahsup   = filteredItems.filter(i => i.decision === 'Mahsup').length;
    const bekliyor = filteredItems.filter(i => !['Kabul','Red','Mahsup'].includes(i.decision)).length;

    const ctx = document.getElementById('chart-decision-doughnut').getContext('2d');

    if (decisionChart) {
        decisionChart.data.datasets[0].data = [kabul, red, bekliyor, mahsup];
        decisionChart.update();
    } else {
        decisionChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Kabul', 'Red', 'Bekliyor', 'Mahsup'],
                datasets: [{
                    data: [kabul, red, bekliyor, mahsup],
                    backgroundColor: ['#3D6E50', '#9F3D3D', '#B26B33', '#3F5C7A'],
                    borderColor: '#fff',
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
                            label: ctx => {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                                return ` ${ctx.parsed} adet (%${pct})`;
                            }
                        }
                    }
                }
            }
        });
    }

    // Custom legend
    const legend = document.getElementById('chart-decision-legend');
    const colors = ['#3D6E50', '#9F3D3D', '#B26B33', '#3F5C7A'];
    const labels = ['Kabul', 'Red', 'Bekliyor', 'Mahsup'];
    const values = [kabul, red, bekliyor, mahsup];
    const total  = values.reduce((a, b) => a + b, 0);

    legend.innerHTML = labels.map((label, i) => `
        <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${colors[i]};display:inline-block;"></span>
            <span style="font-size:11px;color:#6B655B;font-family:Verdana, Geneva, sans-serif;">
                ${label}: <strong>${values[i]}</strong>
                ${total > 0 ? `<span style="color:#968B7A;">(%${((values[i]/total)*100).toFixed(0)})</span>` : ''}
            </span>
        </div>
    `).join('');
}

// ── E) Zaman Serisi (Son 12 Ay) ───────────────────────────────────────────────
function renderMonthlyChart() {
    // Son 12 ayı hesapla
    const now    = new Date();
    const months = [];
    const counts = [];

    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push(d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }));
        const cnt = filteredItems.filter(item => {
            if (!item.cn_date) return false;
            return item.cn_date.startsWith(key);
        }).length;
        counts.push(cnt);
    }

    // Trend hesapla (son 3 ay vs önceki 3 ay)
    const recent = counts.slice(-3).reduce((a, b) => a + b, 0);
    const prev   = counts.slice(-6, -3).reduce((a, b) => a + b, 0);
    const trendBadge = document.getElementById('trend-badge');
    if (recent > prev * 1.1) {
        trendBadge.innerHTML = `<span class="trend-up"><i class="fa-solid fa-arrow-trend-up" style="margin-right:4px;"></i>Artıyor</span>`;
    } else if (recent < prev * 0.9) {
        trendBadge.innerHTML = `<span class="trend-down"><i class="fa-solid fa-arrow-trend-down" style="margin-right:4px;"></i>Azalıyor</span>`;
    } else {
        trendBadge.innerHTML = `<span class="trend-flat"><i class="fa-solid fa-minus" style="margin-right:4px;"></i>Sabit</span>`;
    }

    const ctx = document.getElementById('chart-monthly-line').getContext('2d');

    if (monthlyChart) {
        monthlyChart.data.labels = months;
        monthlyChart.data.datasets[0].data = counts;
        monthlyChart.update();
    } else {
        monthlyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: 'Şikayet Adedi',
                    data: counts,
                    borderColor: '#2D4A3E',
                    backgroundColor: 'rgba(45,74,62,0.08)',
                    pointBackgroundColor: '#2D4A3E',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.parsed.y} şikayet`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: '#EFEAE0' },
                        ticks: { color: '#968B7A', font: { size: 10, family: 'Verdana' } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: '#EFEAE0' },
                        ticks: {
                            color: '#968B7A',
                            font: { size: 10, family: 'Verdana' },
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }
}

// ── Ürün Detay Modal ──────────────────────────────────────────────────────────
function openProductModal(productCode) {
    const items = filteredItems.filter(i => (i.product_code || '(Belirsiz)') === productCode);
    const productName = items[0]?.product_name || productCode;

    document.getElementById('product-modal-title').innerHTML = `
        <i class="fa-solid fa-box" style="color:#B26B33;"></i>
        <span>${escapeHtml(productCode)} — ${escapeHtml(productName)}</span>
        <span style="font-size:13px;background:#F3E5D2;color:#B26B33;padding:2px 10px;border-radius:999px;margin-left:6px;">${items.length} şikayet</span>
    `;

    const tbody = document.getElementById('product-modal-table-body');
    tbody.innerHTML = items.map(item => `
        <tr>
            <td style="font-size:12px;">${formatDate(item.cn_date)}</td>
            <td style="font-size:12px;">${escapeHtml(item.company_name)}</td>
            <td style="font-size:12px;color:#968B7A;">${escapeHtml(item.complaint_id || '—')}</td>
            <td>${decisionBadge(item.decision)}</td>
            <td style="font-size:12px;color:#6B655B;">${escapeHtml(item.target_order || '—')}</td>
            <td style="font-size:12px;color:#6B655B;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                title="${escapeHtml(item.description_1 || '')}">${escapeHtml(item.description_1 || '—')}</td>
        </tr>
    `).join('');

    document.getElementById('product-detail-modal').classList.remove('hidden');
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function initEventListeners() {
    // Filtre değişiklikleri
    ['filter-date-start','filter-date-end','filter-customer','filter-product-code','filter-decision']
        .forEach(id => {
            document.getElementById(id)?.addEventListener('change', applyFiltersAndRender);
        });

    // Filtreleri temizle
    document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
        document.getElementById('filter-date-start').value = '';
        document.getElementById('filter-date-end').value   = '';
        document.getElementById('filter-customer').value   = '';
        document.getElementById('filter-product-code').value = '';
        document.getElementById('filter-decision').value   = '';
        applyFiltersAndRender();
    });

    // Yenile butonu
    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
        const icon = document.querySelector('#btn-refresh i');
        icon?.classList.add('fa-spin');
        const session = await requireAuth();
        if (session) await loadData(session);
        icon?.classList.remove('fa-spin');
    });

    // Modal kapat
    document.getElementById('btn-close-product-modal')?.addEventListener('click', closeProductModal);
    document.getElementById('btn-close-product-modal-footer')?.addEventListener('click', closeProductModal);
    document.getElementById('product-detail-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('product-detail-modal')) closeProductModal();
    });
}

function closeProductModal() {
    document.getElementById('product-detail-modal').classList.add('hidden');
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function decisionBadge(decision) {
    const map = {
        'Kabul':  'badge-kabul',
        'Red':    'badge-red',
        'Mahsup': 'badge-mahsup',
    };
    const cls = map[decision] || 'badge-bekliyor';
    return `<span class="badge ${cls}">${escapeHtml(decision || 'Bekliyor')}</span>`;
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'numeric' });
    } catch { return dateStr; }
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showError(msg) {
    const sections = ['product-ranking-body','customer-ranking-body'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#9F3D3D;padding:24px;">${msg}</td></tr>`;
    });
}
