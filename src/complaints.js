import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess, canEdit } from './utils/permissions.js';
import { showAlertDialog } from './utils/dialogs.js';
import {
    DECISIONS, getDecision, isCredited, lineAmount, formatMoney,
} from './utils/creditNoteRules.js';
import { DEFECTS, defectLabel, DEFECT_IMAGE_BUCKET, defectImagePrefix } from './utils/defectCatalog.js';

// ── Global veri depoları ──────────────────────────────────────────────────────
let rawData = [];          // Tüm credit_notes (items + customers dahil)
let filteredItems = [];    // Aktif filtreye göre credit_note_items (düzleştirilmiş)
let decisionChart = null;
let monthlyChart  = null;
let ctx = null;

// Hata kataloğu görselleri: defect id -> { path, url }
let defectImages = new Map();

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'complaints'))) return;

    await renderNavbar('complaints', ctx);
    fillStaticFilters();
    await loadData();
    initEventListeners();
});

// Karar ve hata kategorisi seçenekleri tek kaynaktan (creditNoteRules / defectCatalog)
// doldurulur — HTML'de sabit yazılınca Credit Notes modülüyle ayrışıyordu.
function fillStaticFilters() {
    document.getElementById('filter-decision').innerHTML =
        '<option value="">Tüm Kararlar</option>' +
        DECISIONS.map(d => `<option value="${d.value}">${d.tr}</option>`).join('');

    document.getElementById('filter-defect').innerHTML =
        '<option value="">Tüm Hatalar</option>' +
        DEFECTS.map(d => `<option value="${d.id}">${d.name}</option>`).join('') +
        '<option value="__none__">(Kategori girilmemiş)</option>';
}

// ── Veri yükleme ─────────────────────────────────────────────────────────────
async function loadData() {
    try {
        // 1) credit_notes — SADECE kendi alanları, join YOK (FK belirsizliğini önler)
        const { data: notes, error: notesErr } = await supabase
            .from('credit_notes')
            .select('id, cn_no, customer_id, cn_date, process_status, currency, total_amount, target_order_text, user_id')
            .eq('user_id', ctx.ownerId)
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
    const defect       = document.getElementById('filter-defect').value;

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
                if (defect === '__none__' && item.defect_category)     return false;
                if (defect && defect !== '__none__' && item.defect_category !== defect) return false;
                return true;
            })
            .map(item => ({
                ...item,
                cn_no:          cn.cn_no,
                cn_date:        cn.cn_date,
                process_status: cn.process_status,
                currency:       cn.currency || 'EUR',
                target_order:   cn.target_order_text || '',
                company_name:   cn.customers?.company_name || '—',
                country:        cn.customers?.country      || '—',
                customer_id:    cn.customer_id,
            }))
    );

    // Bekleyen CN sayısı: kararı verilmiş olsun olmasın, henüz bir siparişte
    // uygulanmamış (ya da iptal edilmemiş) Credit Note'lar.
    const pendingCNCount = filteredNotes.filter(
        cn => cn.process_status !== 'Siparişe İşlendi' && cn.process_status !== 'İptal'
    ).length;

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
    // "Kabul" = müşteriye alacak yazılan kararlar (Confirmed, Confirmed - Broken,
    // %50 Tolerans). "Red" = Refused ailesi. Resim bekleyenler ikisine de girmez.
    const accepted = filteredItems.filter(i => isCredited(i.decision)).length;
    const rejected = filteredItems.filter(i => {
        const d = getDecision(i.decision);
        return !!d && !d.credited && !d.pending;
    }).length;

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
        const accepted = p.items.filter(i => isCredited(i.decision)).length;
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
        const accepted = c.items.filter(i => isCredited(i.decision)).length;
        const rejected = c.items.filter(i => {
            const d = getDecision(i.decision);
            return !!d && !d.credited && !d.pending;
        }).length;
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
                <span class="badge badge-ok">${accepted}</span>
                <span style="color:#E4DDCE;margin:0 2px;">/</span>
                <span class="badge badge-danger">${rejected}</span>
            </td>
            <td>
                <div style="font-size:10.5px;color:#968B7A;">${formatDate(firstDate)}</div>
                <div style="font-size:10.5px;color:#1C1A17;">${formatDate(lastDate)}</div>
            </td>
        </tr>`;
    }).join('');
}

// ── D) Karar Dağılımı Doughnut ────────────────────────────────────────────────
// Karar tonundan grafik rengi. Aynı tondaki kararlar (ör. üç farklı "Refused")
// birbirinden ayrılabilsin diye ton içinde hafif açılan varyantlar kullanılıyor.
const DECISION_COLORS = {
    'Confirmed':                '#3D6E50',
    'Confirmed - Broken':       '#6E9B7E',
    'Tolerance - %50 Discount': '#B26B33',
    'Refused':                  '#9F3D3D',
    'Refused - Broken':         '#C07070',
    'Refused - Tolerance':      '#D9A0A0',
    'Waiting Picture':          '#3F5C7A',
    '(Karar yok)':              '#C9C1B2',
};

// Grafikte gösterilecek karar dizisi: sabit sıra + hiç kullanılmayanları eleme.
function decisionBreakdown() {
    const rows = DECISIONS.map(d => ({
        label: d.tr,
        key:   d.value,
        count: filteredItems.filter(i => i.decision === d.value).length,
    }));
    const noDecision = filteredItems.filter(i => !getDecision(i.decision)).length;
    if (noDecision) rows.push({ label: 'Karar yok', key: '(Karar yok)', count: noDecision });
    return rows.filter(r => r.count > 0);
}

function renderDecisionChart() {
    const rows   = decisionBreakdown();
    const labels = rows.map(r => r.label);
    const values = rows.map(r => r.count);
    const colors = rows.map(r => DECISION_COLORS[r.key] || '#C9C1B2');

    const ctx = document.getElementById('chart-decision-doughnut').getContext('2d');

    if (decisionChart) {
        decisionChart.data.labels = labels;
        decisionChart.data.datasets[0].data = values;
        decisionChart.data.datasets[0].backgroundColor = colors;
        decisionChart.update();
    } else {
        decisionChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
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
    const total  = values.reduce((a, b) => a + b, 0);

    legend.innerHTML = rows.length === 0
        ? '<span style="font-size:11px;color:#968B7A;font-family:Verdana, Geneva, sans-serif;">Gösterilecek veri yok</span>'
        : rows.map((r, i) => `
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="width:10px;height:10px;border-radius:50%;background:${colors[i]};display:inline-block;"></span>
                <span style="font-size:11px;color:#6B655B;font-family:Verdana, Geneva, sans-serif;">
                    ${escapeHtml(r.label)}: <strong>${r.count}</strong>
                    ${total > 0 ? `<span style="color:#968B7A;">(%${((r.count / total) * 100).toFixed(0)})</span>` : ''}
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
    tbody.innerHTML = items.map(item => {
        // Bizim barkod ID'miz ve müşterinin kendi referansı ayrı alanlarda tutulur;
        // ikisi de dolu olabiliyor (ör. "3106976654" + "IDVT11032023080").
        const ids = [item.product_serial, item.customer_ref].filter(Boolean);
        const amount = lineAmount(item);
        return `
        <tr>
            <td style="font-size:12px;white-space:nowrap;">${formatDate(item.cn_date)}
                ${item.cn_no ? `<div style="font-size:10px;color:#968B7A;">CN ${item.cn_no}</div>` : ''}</td>
            <td style="font-size:12px;">${escapeHtml(item.company_name)}</td>
            <td style="font-size:11.5px;color:#6B655B;font-family:ui-monospace,Consolas,monospace;">
                ${ids.length ? ids.map(escapeHtml).join('<br>') : '<span style="color:#968B7A;">—</span>'}</td>
            <td>${decisionBadge(item.decision)}</td>
            <td style="font-size:12px;color:#6B655B;">${escapeHtml(item.defect_category ? defectLabel(item.defect_category) : '—')}</td>
            <td style="font-size:12px;color:#6B655B;white-space:nowrap;">
                ${escapeHtml(item.target_order_text_override || item.target_order || '—')}
                ${amount > 0 ? `<div style="font-size:10px;color:#968B7A;">${escapeHtml(formatMoney(amount, item.currency))}</div>` : ''}
                ${item.compensation_type === 'Bedelsiz' && isCredited(item.decision)
                    ? `<div style="font-size:10px;color:#B26B33;">${item.quantity} ad. bedelsiz</div>` : ''}</td>
            <td style="font-size:12px;color:#6B655B;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                title="${escapeHtml(item.description || '')}">${escapeHtml(item.description || '—')}</td>
        </tr>`;
    }).join('');

    document.getElementById('product-detail-modal').classList.remove('hidden');
}

// ── Hata Kataloğu ─────────────────────────────────────────────────────────────
// Tanımlar defectCatalog.js'te sabittir; örnek görseller Supabase Storage'daki
// `hata-gorselleri` bucket'ından (private) signed URL ile okunur.

async function loadDefectImages() {
    defectImages = new Map();
    try {
        const { data, error } = await supabase.storage.from(DEFECT_IMAGE_BUCKET).list('defects', { limit: 200 });
        if (error) throw error;

        const paths = (data || [])
            .filter(f => f.name && !f.name.startsWith('.'))
            .map(f => 'defects/' + f.name);
        if (paths.length === 0) return;

        const { data: signed, error: signErr } =
            await supabase.storage.from(DEFECT_IMAGE_BUCKET).createSignedUrls(paths, 3600);
        if (signErr) throw signErr;

        (signed || []).forEach(s => {
            if (!s.signedUrl) return;
            // "defects/<id>.<uzanti>" -> <id>
            const id = s.path.replace(/^defects\//, '').replace(/\.[^.]+$/, '');
            defectImages.set(id, { path: s.path, url: s.signedUrl });
        });
    } catch (err) {
        // Bucket henüz oluşturulmadıysa katalog yine de tanımlarla çalışsın.
        console.warn('Hata görselleri yüklenemedi:', err.message);
    }
}

function renderDefectCatalog() {
    const grid = document.getElementById('defect-grid');
    const editable = canEdit(ctx, 'complaints');

    // Hangi kategoriden kaç şikayet var (aktif filtreye göre)
    const counts = new Map();
    filteredItems.forEach(i => {
        if (!i.defect_category) return;
        counts.set(i.defect_category, (counts.get(i.defect_category) || 0) + 1);
    });

    grid.innerHTML = DEFECTS.map(d => {
        const img = defectImages.get(d.id);
        const count = counts.get(d.id) || 0;
        return `
        <div class="defect-card">
            <div class="defect-figure">
                ${img
                    ? `<img src="${img.url}" alt="${escapeHtml(d.name)} örnek görseli" loading="lazy">`
                    : `<div class="placeholder">
                         <i class="fa-solid fa-image" style="font-size:18px;display:block;margin-bottom:6px;"></i>
                         örnek görsel bekleniyor
                       </div>`}
            </div>
            <div class="defect-body">
                <div class="defect-name">${escapeHtml(d.name)}</div>
                <div class="defect-en">${escapeHtml(d.en)}</div>
                <div class="defect-def">${escapeHtml(d.definition)}</div>
            </div>
            <div class="defect-foot">
                <span class="defect-count">${count} şikayet kalemi</span>
                ${editable
                    ? `<button class="defect-upload-btn" data-defect="${d.id}">
                         <i class="fa-solid fa-upload" style="margin-right:4px;"></i>${img ? 'Değiştir' : 'Görsel Yükle'}
                       </button>`
                    : ''}
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.defect-upload-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById('defect-image-input');
            input.dataset.defect = btn.dataset.defect;
            input.click();
        });
    });
}

async function handleDefectImageUpload(file, defectId) {
    if (!canEdit(ctx, 'complaints')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    if (!file.type.startsWith('image/')) {
        await showAlertDialog('Yalnızca görsel dosyası yükleyebilirsiniz.', { variant: 'warn' });
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        await showAlertDialog('Görsel en fazla 5 MB olabilir.', { variant: 'warn' });
        return;
    }

    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
    const path = `${defectImagePrefix(defectId)}.${ext}`;

    try {
        const { error } = await supabase.storage
            .from(DEFECT_IMAGE_BUCKET)
            .upload(path, file, { upsert: true, contentType: file.type });
        if (error) throw error;

        // Aynı kategoride farklı uzantılı eski bir görsel kalmışsın diye temizle.
        const old = defectImages.get(defectId);
        if (old && old.path !== path) {
            await supabase.storage.from(DEFECT_IMAGE_BUCKET).remove([old.path]);
        }

        await loadDefectImages();
        renderDefectCatalog();
    } catch (err) {
        console.error('Görsel yüklenemedi:', err);
        await showAlertDialog('Görsel yüklenemedi: ' + err.message, { variant: 'danger' });
    }
}

async function openDefectCatalog() {
    document.getElementById('defect-catalog-modal').classList.remove('hidden');
    renderDefectCatalog();          // önce tanımlarla göster
    await loadDefectImages();       // görseller gelince tazele
    renderDefectCatalog();
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function initEventListeners() {
    // Filtre değişiklikleri
    ['filter-date-start','filter-date-end','filter-customer','filter-product-code','filter-decision','filter-defect']
        .forEach(id => {
            document.getElementById(id)?.addEventListener('change', applyFiltersAndRender);
        });

    // Filtreleri temizle
    document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
        ['filter-date-start','filter-date-end','filter-customer','filter-product-code','filter-decision','filter-defect']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        applyFiltersAndRender();
    });

    // Hata Kataloğu
    document.getElementById('btn-open-defect-catalog')?.addEventListener('click', openDefectCatalog);
    ['btn-close-defect-catalog', 'btn-close-defect-catalog-footer'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () =>
            document.getElementById('defect-catalog-modal').classList.add('hidden'));
    });
    document.getElementById('defect-catalog-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('defect-catalog-modal')) {
            document.getElementById('defect-catalog-modal').classList.add('hidden');
        }
    });
    const defectInput = document.getElementById('defect-image-input');
    defectInput?.addEventListener('change', async () => {
        const file = defectInput.files[0];
        const defectId = defectInput.dataset.defect;
        defectInput.value = '';
        if (file && defectId) await handleDefectImageUpload(file, defectId);
    });

    // Yenile butonu
    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
        const icon = document.querySelector('#btn-refresh i');
        icon?.classList.add('fa-spin');
        const session = await requireAuth();
        if (session) await loadData();
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
    const d = getDecision(decision);
    const cls = d ? `badge-${d.tone}` : 'badge-muted';
    const label = d ? d.tr : (decision || 'Karar yok');
    return `<span class="badge ${cls}" title="${escapeHtml(d ? d.hint : '')}">${escapeHtml(label)}</span>`;
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
