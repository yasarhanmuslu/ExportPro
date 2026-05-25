import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// ── Global veri depoları ──────────────────────────────────────────────────────
let globalOrders = [];        // orders + customers join
let currentFilter = 'all';    // filtre durumu
let currentSearch = '';       // arama durumu

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    await renderNavbar('payments');
    initEventListeners();
    await loadData(session);
});

// ── Olay Dinleyicileri ────────────────────────────────────────────────────────
function initEventListeners() {
    // Yenile butonu
    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
        const icon = document.querySelector('#btn-refresh i');
        icon?.classList.add('fa-spin');
        const { data: { session } } = await supabase.auth.getSession();
        await loadData(session);
        icon?.classList.remove('fa-spin');
    });

    // Filtre butonları
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderAllOpenTable();
        });
    });

    // Arama
    document.getElementById('search-input')?.addEventListener('input', e => {
        currentSearch = e.target.value.toLowerCase();
        renderAllOpenTable();
    });

    // Modal kapat
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('order-detail-modal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('order-detail-modal')) closeModal();
    });
}

// ── Veri Yükleme ─────────────────────────────────────────────────────────────
async function loadData(session) {
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                id, order_number, order_date, due_date, shipment_date,
                total_amount, advance_payment, remaining_balance,
                currency, payment_status, production_status,
                order_quantity, order_notes, customer_id,
                customers ( id, company_name, country, client_group )
            `)
            .eq('user_id', session.user.id)
            .order('due_date', { ascending: true });

        if (error) throw error;

        globalOrders = orders || [];
        renderKPIs();
        renderOverdueList();
        renderAllOpenTable();
        renderCustomerTable();
    } catch (err) {
        console.error('Ödeme takibi veri hatası:', err.message);
        showError('Veriler yüklenirken bir hata oluştu: ' + err.message);
    }
}

// ── Yardımcı Fonksiyonlar ─────────────────────────────────────────────────────
function today() {
    return new Date(new Date().toDateString());
}

function getPaymentStatus(order) {
    const bal = parseFloat(order.remaining_balance) || 0;
    if (bal <= 0) return 'paid';

    if (!order.due_date) return 'month'; // vade yoksa bu ay gibi kabul et

    const dueDate = new Date(order.due_date);
    const now = today();
    const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'overdue';
    if (diffDays >= 0 && diffDays <= 7) return 'week';
    if (diffDays > 7 && diffDays <= 30) return 'month';
    return 'future'; // 30 günden fazra
}

function daysOverdue(order) {
    if (!order.due_date) return 0;
    const dueDate = new Date(order.due_date);
    const now = today();
    return Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
}

function formatMoney(amount, currency) {
    const symbols = { 'USD': '$', 'EUR': '€', 'TRY': '₺', 'GBP': '£' };
    const sym = symbols[currency] || currency || '';
    const num = parseFloat(amount) || 0;
    return sym + num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('tr-TR');
}

function statusBadge(status) {
    const map = {
        overdue: { label: 'Vadesi Geçmiş', cls: 'badge-danger', icon: 'fa-circle-exclamation' },
        week:    { label: 'Bu Hafta Vadeli', cls: 'badge-warning', icon: 'fa-clock' },
        month:   { label: 'Bu Ay Vadeli', cls: 'badge-yellow', icon: 'fa-calendar' },
        future:  { label: 'İleri Vadeli', cls: '', icon: 'fa-calendar-plus' },
        paid:    { label: 'Tahsil Edildi', cls: 'badge-success', icon: 'fa-check-circle' },
    };
    const s = map[status] || map.future;
    return `<span class="badge ${s.cls}"><i class="fa-solid ${s.icon}" style="font-size:9px;"></i>${s.label}</span>`;
}

function rowClass(status) {
    const map = { overdue: 'row-overdue', week: 'row-week', month: 'row-month', paid: 'row-paid' };
    return map[status] || '';
}

// ── A) KPI KARTLARI ───────────────────────────────────────────────────────────
function renderKPIs() {
    const openOrders = globalOrders.filter(o => (parseFloat(o.remaining_balance) || 0) > 0);
    const overdueOrders = globalOrders.filter(o => getPaymentStatus(o) === 'overdue');
    const weekOrders = globalOrders.filter(o => getPaymentStatus(o) === 'week');

    // Açık bakiye para birimi bazında grupla
    const openByCurrency = {};
    openOrders.forEach(o => {
        const cur = o.currency || 'USD';
        openByCurrency[cur] = (openByCurrency[cur] || 0) + (parseFloat(o.remaining_balance) || 0);
    });

    // Vadesi geçmiş bakiye para birimi bazında
    const overdueByCurrency = {};
    overdueOrders.forEach(o => {
        const cur = o.currency || 'USD';
        overdueByCurrency[cur] = (overdueByCurrency[cur] || 0) + (parseFloat(o.remaining_balance) || 0);
    });

    // Bu hafta vadeli bakiye
    const weekByCurrency = {};
    weekOrders.forEach(o => {
        const cur = o.currency || 'USD';
        weekByCurrency[cur] = (weekByCurrency[cur] || 0) + (parseFloat(o.remaining_balance) || 0);
    });

    // Bu ay tahsil edilen
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const collectedOrders = globalOrders.filter(o => {
        if (o.payment_status !== 'Ödendi') return false;
        const d = new Date(o.order_date);
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const collectedByCurrency = {};
    collectedOrders.forEach(o => {
        const cur = o.currency || 'USD';
        collectedByCurrency[cur] = (collectedByCurrency[cur] || 0) + (parseFloat(o.total_amount) || 0);
    });

    const formatCurrencyBlock = (byC) => {
        const entries = Object.entries(byC);
        if (entries.length === 0) return '<span style="font-size:20px;font-weight:600;color:#968B7A;">—</span>';
        return entries.map(([cur, amt]) =>
            `<div style="font-size:20px;font-weight:600;color:#1C1A17;letter-spacing:-0.02em;">${formatMoney(amt, cur)}</div>`
        ).join('');
    };

    document.getElementById('kpi-grid').innerHTML = `
        <!-- Toplam Açık Bakiye -->
        <div class="kpi-card">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="width:32px;height:32px;border-radius:8px;background:#F0F4F2;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-wallet" style="color:#2D4A3E;font-size:14px;"></i>
                </div>
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;font-weight:600;">Toplam Açık Bakiye</div>
            </div>
            ${formatCurrencyBlock(openByCurrency)}
            <div style="font-size:11px;color:#968B7A;margin-top:4px;">${openOrders.length} açık sipariş</div>
        </div>

        <!-- Vadesi Geçmiş -->
        <div class="kpi-card" style="border-left:3px solid #EF4444;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="width:32px;height:32px;border-radius:8px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-circle-exclamation" style="color:#EF4444;font-size:14px;"></i>
                </div>
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;font-weight:600;">Vadesi Geçmiş</div>
            </div>
            ${formatCurrencyBlock(overdueByCurrency)}
            <div style="font-size:11px;color:#9F3D3D;margin-top:4px;">${overdueOrders.length} sipariş kritik</div>
        </div>

        <!-- Bu Hafta Vadeli -->
        <div class="kpi-card" style="border-left:3px solid #F97316;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="width:32px;height:32px;border-radius:8px;background:#FFF7ED;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-clock" style="color:#F97316;font-size:14px;"></i>
                </div>
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;font-weight:600;">Bu Hafta Vadeli</div>
            </div>
            ${formatCurrencyBlock(weekByCurrency)}
            <div style="font-size:11px;color:#92600A;margin-top:4px;">${weekOrders.length} sipariş yaklaşıyor</div>
        </div>

        <!-- Bu Ay Tahsil Edilen -->
        <div class="kpi-card" style="border-left:3px solid #22C55E;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="width:32px;height:32px;border-radius:8px;background:#F0FDF4;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-check-circle" style="color:#22C55E;font-size:14px;"></i>
                </div>
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;font-weight:600;">Bu Ay Tahsil</div>
            </div>
            ${formatCurrencyBlock(collectedByCurrency)}
            <div style="font-size:11px;color:#166534;margin-top:4px;">${collectedOrders.length} sipariş tamamlandı</div>
        </div>
    `;
}

// ── B) KRİTİK UYARI LİSTESİ ──────────────────────────────────────────────────
function renderOverdueList() {
    const overdueOrders = globalOrders
        .filter(o => getPaymentStatus(o) === 'overdue')
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    document.getElementById('overdue-count').textContent = overdueOrders.length;

    const tbody = document.getElementById('overdue-tbody');
    if (overdueOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8" style="color:#22C55E;">
            <i class="fa-solid fa-check-circle" style="margin-right:6px;"></i>Vadesi geçmiş sipariş bulunmuyor.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = overdueOrders.map(order => {
        const compName = order.customers?.company_name || '—';
        const days = daysOverdue(order);
        const bal = parseFloat(order.remaining_balance) || 0;
        return `
            <tr class="row-overdue" style="cursor:pointer;" onclick="showOrderDetail(${JSON.stringify(JSON.stringify(order))})">
                <td style="font-weight:500;">${compName}</td>
                <td style="font-family:'DM Mono',monospace;font-size:12px;">${order.order_number || '—'}</td>
                <td>${formatDate(order.due_date)}</td>
                <td><span class="badge badge-danger"><i class="fa-solid fa-clock" style="font-size:9px;"></i>${days} Gün Gecikti</span></td>
                <td style="font-weight:600;color:#9F3D3D;">${formatMoney(bal, order.currency)}</td>
                <td><span style="font-size:11px;font-weight:600;color:#6B655B;">${order.currency || '—'}</span></td>
            </tr>`;
    }).join('');
}

// ── C) TÜM AÇIK BAKİYE TABLOSU ───────────────────────────────────────────────
function renderAllOpenTable() {
    let filtered = globalOrders.filter(o => {
        // Ödendi ise gösterme (filter=all bile olsa sadece açık + tahsil edilmiş bu ay değil, tüm açık bakiyeler)
        const status = getPaymentStatus(o);
        if (currentFilter === 'all') return status !== 'paid' && status !== 'future';
        if (currentFilter === 'overdue') return status === 'overdue';
        if (currentFilter === 'week')    return status === 'week';
        if (currentFilter === 'month')   return status === 'month';
        return true;
    });

    // Arama filtresi
    if (currentSearch) {
        filtered = filtered.filter(o => {
            const compName = (o.customers?.company_name || '').toLowerCase();
            const orderNum = (o.order_number || '').toLowerCase();
            return compName.includes(currentSearch) || orderNum.includes(currentSearch);
        });
    }

    // Sıralama: önce vadesi geçmiş, sonra bu hafta, sonra bu ay
    const statusOrder = { overdue: 0, week: 1, month: 2, future: 3, paid: 4 };
    filtered.sort((a, b) => {
        const sa = statusOrder[getPaymentStatus(a)] ?? 9;
        const sb = statusOrder[getPaymentStatus(b)] ?? 9;
        if (sa !== sb) return sa - sb;
        return new Date(a.due_date) - new Date(b.due_date);
    });

    const tbody = document.getElementById('all-open-tbody');
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8" style="color:#968B7A;">Kriterlere uygun kayıt bulunamadı.</td></tr>`;
        document.getElementById('table-summary').textContent = '';
        return;
    }

    // Özet satırı
    const totalByCur = {};
    filtered.forEach(o => {
        const cur = o.currency || 'USD';
        totalByCur[cur] = (totalByCur[cur] || 0) + (parseFloat(o.remaining_balance) || 0);
    });
    const summaryStr = Object.entries(totalByCur)
        .map(([cur, amt]) => formatMoney(amt, cur))
        .join(' + ');
    document.getElementById('table-summary').textContent = `${filtered.length} kayıt · Toplam: ${summaryStr}`;

    tbody.innerHTML = filtered.map(order => {
        const status = getPaymentStatus(order);
        const compName = order.customers?.company_name || '—';
        const bal  = parseFloat(order.remaining_balance) || 0;
        const paid = parseFloat(order.advance_payment) || 0;
        const total = parseFloat(order.total_amount) || 0;
        return `
            <tr class="${rowClass(status)}" style="cursor:pointer;" onclick="showOrderDetail(${JSON.stringify(JSON.stringify(order))})">
                <td>${statusBadge(status)}</td>
                <td style="font-weight:500;">${compName}</td>
                <td style="font-family:'DM Mono',monospace;font-size:12px;">${order.order_number || '—'}</td>
                <td>${formatDate(order.due_date)}</td>
                <td>${formatMoney(total, order.currency)}</td>
                <td style="color:#166534;">${formatMoney(paid, order.currency)}</td>
                <td style="font-weight:600;color:${status === 'overdue' ? '#9F3D3D' : '#1C1A17'};">${formatMoney(bal, order.currency)}</td>
                <td><span style="font-size:11px;font-weight:600;color:#6B655B;">${order.currency || '—'}</span></td>
                <td style="text-align:center;">
                    <button style="background:none;border:none;cursor:pointer;color:#2D4A3E;font-size:13px;" title="Detay">
                        <i class="fa-solid fa-arrow-right-to-bracket"></i>
                    </button>
                </td>
            </tr>`;
    }).join('');
}

// ── D) MÜŞTERİ BAZINDA TOPLAM AÇIK BAKİYE ────────────────────────────────────
function renderCustomerTable() {
    // Sadece açık bakiyeli siparişler
    const openOrders = globalOrders.filter(o => (parseFloat(o.remaining_balance) || 0) > 0);

    // Müşteri bazında grupla
    const customerMap = {};
    openOrders.forEach(o => {
        const cid = o.customer_id;
        const compName = o.customers?.company_name || 'Bilinmeyen';
        if (!customerMap[cid]) {
            customerMap[cid] = {
                company_name: compName,
                orders: [],
                oldestDue: null,
                byCurrency: {}
            };
        }
        customerMap[cid].orders.push(o);
        const cur = o.currency || 'USD';
        customerMap[cid].byCurrency[cur] = (customerMap[cid].byCurrency[cur] || 0) + (parseFloat(o.remaining_balance) || 0);
        if (o.due_date) {
            const d = new Date(o.due_date);
            if (!customerMap[cid].oldestDue || d < customerMap[cid].oldestDue) {
                customerMap[cid].oldestDue = d;
            }
        }
    });

    // ABC sınıflandırması: USD bakiyeye göre (EUR varsa 1:1 kabul)
    function totalUSD(byCur) {
        return (byCur['USD'] || 0) + (byCur['EUR'] || 0) * 1.08 + (byCur['GBP'] || 0) * 1.27;
    }

    function abcClass(byCur) {
        const usd = totalUSD(byCur);
        if (usd > 10000) return 'A';
        if (usd >= 1000) return 'B';
        return 'C';
    }

    const rows = Object.values(customerMap)
        .sort((a, b) => totalUSD(b.byCurrency) - totalUSD(a.byCurrency));

    const tbody = document.getElementById('customer-tbody');
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8" style="color:#968B7A;">Açık bakiyeli sipariş bulunamadı.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(row => {
        const abc = abcClass(row.byCurrency);
        const abcCls = { A: 'abc-a', B: 'abc-b', C: 'abc-c' }[abc];
        const usdBal  = row.byCurrency['USD'] ? formatMoney(row.byCurrency['USD'], 'USD') : '—';
        const eurBal  = row.byCurrency['EUR'] ? formatMoney(row.byCurrency['EUR'], 'EUR') : '—';
        const otherKeys = Object.keys(row.byCurrency).filter(c => c !== 'USD' && c !== 'EUR');
        const otherStr = otherKeys.map(c => formatMoney(row.byCurrency[c], c)).join(', ') || '—';

        // En eski vade rengi
        let dueColor = '#1C1A17';
        if (row.oldestDue) {
            const diff = Math.ceil((row.oldestDue - today()) / (1000 * 60 * 60 * 24));
            if (diff < 0) dueColor = '#9F3D3D';
            else if (diff <= 7) dueColor = '#92600A';
        }

        return `
            <tr>
                <td><span class="badge ${abcCls}">${abc}</span></td>
                <td style="font-weight:500;">${row.company_name}</td>
                <td style="text-align:center;">${row.orders.length}</td>
                <td style="color:${dueColor};">${row.oldestDue ? row.oldestDue.toLocaleDateString('tr-TR') : '—'}</td>
                <td style="font-weight:500;">${usdBal}</td>
                <td style="font-weight:500;">${eurBal}</td>
                <td style="color:#968B7A;">${otherStr}</td>
            </tr>`;
    }).join('');
}

// ── SİPARİŞ DETAY MODALİ ─────────────────────────────────────────────────────
window.showOrderDetail = function(orderJson) {
    const order = JSON.parse(orderJson);
    const compName = order.customers?.company_name || '—';
    const status = getPaymentStatus(order);
    const bal = parseFloat(order.remaining_balance) || 0;
    const paid = parseFloat(order.advance_payment) || 0;
    const total = parseFloat(order.total_amount) || 0;
    const payPct = total > 0 ? Math.round((paid / total) * 100) : 0;

    document.getElementById('modal-order-title').textContent = `${compName} — ${order.order_number || 'Sipariş Detayı'}`;

    document.getElementById('modal-body').innerHTML = `
        <!-- Sol sütun -->
        <div style="display:flex;flex-direction:column;gap:16px;">
            <div>
                <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#968B7A;margin-bottom:6px;">Durum</div>
                ${statusBadge(status)}
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:3px;">Sipariş Tarihi</div>
                    <div style="font-size:14px;color:#1C1A17;">${formatDate(order.order_date)}</div>
                </div>
                <div>
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:3px;">Vade Tarihi</div>
                    <div style="font-size:14px;color:${status === 'overdue' ? '#9F3D3D' : '#1C1A17'};font-weight:${status === 'overdue' ? '600' : '400'};">${formatDate(order.due_date)}</div>
                </div>
                <div>
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:3px;">Sevk Tarihi</div>
                    <div style="font-size:14px;color:#1C1A17;">${formatDate(order.shipment_date)}</div>
                </div>
                <div>
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:3px;">Para Birimi</div>
                    <div style="font-size:14px;font-weight:600;color:#1C1A17;">${order.currency || '—'}</div>
                </div>
            </div>
            ${status === 'overdue' ? `
            <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-triangle-exclamation" style="color:#EF4444;"></i>
                <div style="font-size:13px;color:#9F3D3D;font-weight:500;">${daysOverdue(order)} gün vadesi geçti!</div>
            </div>` : ''}
            ${order.order_notes ? `
            <div>
                <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:6px;">Sipariş Notu</div>
                <div style="font-size:13px;color:#6B655B;background:#FDFAF5;border:1px solid #EFEAE0;border-radius:6px;padding:10px;">${order.order_notes}</div>
            </div>` : ''}
        </div>

        <!-- Sağ sütun -->
        <div style="display:flex;flex-direction:column;gap:16px;">
            <!-- Finansal özet -->
            <div style="background:#FDFAF5;border:1px solid #EFEAE0;border-radius:10px;padding:16px;">
                <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#968B7A;margin-bottom:12px;">Finansal Özet</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;color:#6B655B;">Toplam Tutar</span>
                    <span style="font-size:15px;font-weight:600;color:#1C1A17;">${formatMoney(total, order.currency)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;color:#6B655B;">Ödenen</span>
                    <span style="font-size:15px;font-weight:600;color:#166534;">${formatMoney(paid, order.currency)}</span>
                </div>
                <div style="height:1px;background:#EFEAE0;margin:10px 0;"></div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <span style="font-size:13px;font-weight:600;color:#1C1A17;">Kalan Bakiye</span>
                    <span style="font-size:18px;font-weight:700;color:${status === 'overdue' ? '#9F3D3D' : '#2D4A3E'};">${formatMoney(bal, order.currency)}</span>
                </div>
                <!-- Progress bar -->
                <div style="height:6px;background:#EFEAE0;border-radius:999px;overflow:hidden;">
                    <div style="height:100%;width:${payPct}%;background:#22C55E;border-radius:999px;transition:width .3s;"></div>
                </div>
                <div style="font-size:11px;color:#968B7A;margin-top:4px;text-align:right;">%${payPct} tahsil edildi</div>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div style="background:#F0F4F2;border-radius:8px;padding:12px;">
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:4px;">Üretim Durumu</div>
                    <div style="font-size:13px;font-weight:500;color:#2D4A3E;">${order.production_status || '—'}</div>
                </div>
                <div style="background:#F0F4F2;border-radius:8px;padding:12px;">
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:4px;">Ödeme Durumu</div>
                    <div style="font-size:13px;font-weight:500;color:#2D4A3E;">${order.payment_status || '—'}</div>
                </div>
                <div style="background:#F0F4F2;border-radius:8px;padding:12px;">
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:4px;">Sipariş Adedi</div>
                    <div style="font-size:13px;font-weight:500;color:#1C1A17;">${order.order_quantity || '—'}</div>
                </div>
                <div style="background:#F0F4F2;border-radius:8px;padding:12px;">
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:4px;">Müşteri Grubu</div>
                    <div style="font-size:13px;font-weight:500;color:#1C1A17;">${order.customers?.client_group || '—'}</div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('order-detail-modal').classList.remove('hidden');
};

function closeModal() {
    document.getElementById('order-detail-modal').classList.add('hidden');
}

// ── Hata mesajı ───────────────────────────────────────────────────────────────
function showError(msg) {
    document.getElementById('kpi-grid').innerHTML = `
        <div class="kpi-card" style="grid-column:1/-1;color:#9F3D3D;text-align:center;">
            <i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>${msg}
        </div>`;
}
