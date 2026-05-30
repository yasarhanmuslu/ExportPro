import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

let globalQuotations = [];
let globalCustomers  = [];
let globalProducts   = [];
let currentItemIndex = 0;
let editingQuotationId = null;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    await renderNavbar('quotations');
    await Promise.all([fetchCustomers(session), fetchProducts(session), fetchQuotations(session)]);
    initEventListeners(session);
    computeKPIs();
});

// ─────────────────────────────────────────────
// VERİ ÇEKME
// ─────────────────────────────────────────────
async function fetchCustomers(session) {
    const { data, error } = await supabase
        .from('customers')
        .select('id, company_name, country')
        .eq('user_id', session.user.id)
        .order('company_name', { ascending: true });
    if (error) { console.error('Müşteriler yüklenemedi:', error.message); return; }
    globalCustomers = data;

    const sel = document.getElementById('q-customer');
    sel.innerHTML = '<option value="">-- Müşteri Seçin --</option>';
    data.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.company_name} (${c.country})`;
        sel.appendChild(opt);
    });
}

async function fetchProducts(session) {
    const { data, error } = await supabase
        .from('products')
        .select('id, product_code, product_name, product_group')
        .eq('user_id', session.user.id)
        .order('product_name', { ascending: true });
    if (error) { console.error('Ürünler yüklenemedi:', error.message); return; }
    globalProducts = data || [];
}

async function fetchQuotations(session) {
    const { data, error } = await supabase
        .from('quotations')
        .select(`*, customers!quotations_customer_id_fkey(company_name, country), quotation_items(*)`)
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

    if (error) { console.error('Teklifler yüklenemedi:', error.message); return; }

    // Geçerlilik tarihi geçmiş & hâlâ Bekliyor olanları görsel olarak "Süresi Doldu" göster
    const today = new Date().toISOString().split('T')[0];
    globalQuotations = data.map(q => {
        if (q.status === 'Bekliyor' && q.valid_until && q.valid_until < today) {
            return { ...q, status: 'Süresi Doldu', _expired: true };
        }
        return q;
    });
    renderTable(globalQuotations);
    computeKPIs();
}

// ─────────────────────────────────────────────
// TABLO
// ─────────────────────────────────────────────
function renderTable(list) {
    const tbody = document.getElementById('quotations-table-body');
    const countBadge = document.getElementById('total-filtered-count');
    countBadge.textContent = `${list.length} Teklif`;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8" style="color:rgb(100 116 139);">Teklif bulunamadı.</td></tr>`;
        return;
    }

    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };

    tbody.innerHTML = list.map(q => {
        const cust = q.customers ? q.customers.company_name : '—';
        const sym  = currencySymbols[q.currency] || q.currency || '';
        const amt  = q.total_amount != null ? `${sym} ${Number(q.total_amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '—';
        const badge = statusBadge(q.status);
        const isExpired = q._expired;
        const today = new Date().toISOString().split('T')[0];
        const validClass = q.valid_until && q.valid_until < today && q.status !== 'Kabul' && q.status !== 'Sipariş Dönüştü'
            ? 'style="color:rgb(251 146 60);"' : '';

        return `<tr style="cursor:pointer;" onclick="window._openEdit('${q.id}')">
            <td style="font-weight:600;color:rgb(226 232 240);font-family:Verdana, Geneva, sans-serif;">${q.quotation_number || '—'}</td>
            <td>${cust}</td>
            <td>${formatDate(q.quotation_date)}</td>
            <td ${validClass}>${formatDate(q.valid_until)}</td>
            <td style="font-weight:600;">${amt}</td>
            <td>${badge}</td>
            <td>
                <button onclick="event.stopPropagation();window._openEdit('${q.id}')"
                    style="font-size:11px;padding:4px 10px;border-radius:5px;border:1px solid rgb(30 41 59);background:none;color:rgb(148 163 184);cursor:pointer;font-family:Verdana, Geneva, sans-serif;">
                    <i class="fa-solid fa-pen-to-square"></i> Düzenle
                </button>
            </td>
        </tr>`;
    }).join('');
}

function statusBadge(status) {
    const map = {
        'Bekliyor':        '<span class="badge-bekliyor">Bekliyor</span>',
        'Kabul':           '<span class="badge-kabul">Kabul</span>',
        'Red':             '<span class="badge-red">Red</span>',
        'Sipariş Dönüştü': '<span class="badge-donustu">Sipariş Dönüştü</span>',
        'Süresi Doldu':    '<span class="badge-doldu">Süresi Doldu</span>',
    };
    return map[status] || `<span class="badge-bekliyor">${status}</span>`;
}

function formatDate(d) {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
}

// ─────────────────────────────────────────────
// KPI HESAPLAMA
// ─────────────────────────────────────────────
function computeKPIs() {
    if (!globalQuotations.length) return;

    // Açık teklifler (Bekliyor)
    const open = globalQuotations.filter(q => q.status === 'Bekliyor');
    document.getElementById('kpi-open-count').textContent = open.length;
    const openAmt = open.reduce((s, q) => s + (Number(q.total_amount) || 0), 0);
    document.getElementById('kpi-open-amount').textContent =
        `$${openAmt.toLocaleString('tr-TR', { minimumFractionDigits: 0 })} toplam tutar`;

    // Bu ay dönüşüm oranı
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonthAll = globalQuotations.filter(q => (q.quotation_date || '').startsWith(thisMonth));
    const thisMonthKabul = thisMonthAll.filter(q => q.status === 'Kabul' || q.status === 'Sipariş Dönüştü');
    const convRate = thisMonthAll.length > 0
        ? Math.round((thisMonthKabul.length / thisMonthAll.length) * 100)
        : 0;
    document.getElementById('kpi-conversion').textContent = `%${convRate}`;

    // Ortalama kapanma süresi (Kabul edilenler)
    const accepted = globalQuotations.filter(q => (q.status === 'Kabul' || q.status === 'Sipariş Dönüştü') && q.quotation_date && q.updated_at);
    if (accepted.length > 0) {
        const avgDays = accepted.reduce((s, q) => {
            const created = new Date(q.quotation_date);
            const closed  = new Date(q.updated_at);
            return s + Math.max(0, Math.round((closed - created) / (1000 * 60 * 60 * 24)));
        }, 0) / accepted.length;
        document.getElementById('kpi-avg-days').textContent = Math.round(avgDays) + ' gün';
    } else {
        document.getElementById('kpi-avg-days').textContent = '—';
    }
}

// ─────────────────────────────────────────────
// MODAL — AÇMA / KAPAMA
// ─────────────────────────────────────────────
function openModal(quotation = null) {
    const modal = document.getElementById('quotation-modal');
    const form  = document.getElementById('quotation-form');
    form.reset();
    document.getElementById('items-container').innerHTML = '';
    currentItemIndex = 0;
    editingQuotationId = null;

    document.getElementById('btn-delete-quotation').style.display = 'none';
    document.getElementById('btn-convert-order').style.display = 'none';
    document.getElementById('q-total-display').textContent = '0.00';

    if (quotation) {
        // Düzenleme modu
        editingQuotationId = quotation.id;
        document.getElementById('modal-title').textContent = 'Teklif Düzenle';
        document.getElementById('q-id').value = quotation.id;
        document.getElementById('q-number').value = quotation.quotation_number || '';
        document.getElementById('q-customer').value = quotation.customer_id || '';
        document.getElementById('q-date').value = quotation.quotation_date || '';
        document.getElementById('q-valid-until').value = quotation.valid_until || '';
        document.getElementById('q-currency').value = quotation.currency || 'USD';
        document.getElementById('q-notes').value = quotation.notes || '';

        // Durum: _expired ise göster Süresi Doldu
        const displayStatus = quotation._expired ? 'Süresi Doldu' : quotation.status;
        // Süresi Doldu seçeneğini ekle
        const sel = document.getElementById('q-status');
        if (!Array.from(sel.options).find(o => o.value === 'Süresi Doldu')) {
            const opt = document.createElement('option');
            opt.value = 'Süresi Doldu'; opt.textContent = 'Süresi Doldu';
            sel.appendChild(opt);
        }
        sel.value = displayStatus;

        // Ürün satırları
        const items = quotation.quotation_items || [];
        items.forEach(item => addItemRow(item));
        if (items.length === 0) addItemRow();

        document.getElementById('btn-delete-quotation').style.display = 'block';

        // Siparişe dönüştür butonu: sadece Kabul ise ve henüz dönüşmemişse
        if ((quotation.status === 'Kabul') && !quotation.converted_order_id) {
            document.getElementById('btn-convert-order').style.display = 'block';
        }

        updateTotal();
    } else {
        // Yeni teklif modu
        document.getElementById('modal-title').textContent = 'Yeni Teklif';
        document.getElementById('q-date').value = new Date().toISOString().split('T')[0];
        // Otomatik numara
        generateQuotationNumber();
        addItemRow();
    }

    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('quotation-modal').classList.add('hidden');
    editingQuotationId = null;
}

// ─────────────────────────────────────────────
// TEKLIF NO — OTOMATİK
// ─────────────────────────────────────────────
async function generateQuotationNumber() {
    const year = new Date().getFullYear();
    const { data } = await supabase
        .from('quotations')
        .select('quotation_number')
        .like('quotation_number', `QT-${year}-%`)
        .order('quotation_number', { ascending: false })
        .limit(1);

    let nextNum = 1;
    if (data && data.length > 0 && data[0].quotation_number) {
        const parts = data[0].quotation_number.split('-');
        const last = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(last)) nextNum = last + 1;
    }
    document.getElementById('q-number').value = `QT-${year}-${String(nextNum).padStart(3, '0')}`;
}

// ─────────────────────────────────────────────
// ÜRÜN SATIRI
// ─────────────────────────────────────────────
function addItemRow(item = null) {
    const container = document.getElementById('items-container');
    const idx = currentItemIndex++;
    const div = document.createElement('div');
    div.className = 'item-row';
    div.dataset.idx = idx;

    const productOptions = globalProducts.map(p =>
        `<option value="${p.id}" data-code="${(p.product_code||'').replace(/"/g,'&quot;')}" data-name="${(p.product_name||'').replace(/"/g,'&quot;')}" ${item && item.product_id === p.id ? 'selected' : ''}>${p.product_name}</option>`
    ).join('');

    div.innerHTML = `
        <div class="grid grid-cols-12 gap-2 items-center">
            <div class="col-span-4">
                <label style="font-size:10px;color:rgb(100 116 139);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:3px;">Ürün Adı</label>
                <select class="item-product-select" onchange="window._onProductSelect(this)">
                    <option value="">-- Ürün Seç --</option>
                    ${productOptions}
                </select>
                <input type="hidden" class="item-product-id" value="${item ? (item.product_id || '') : ''}">
                <input type="text" class="item-product-name mt-1" placeholder="veya serbest metin" value="${item ? (item.product_name || '') : ''}" oninput="window._updateTotal()">
            </div>
            <div class="col-span-2">
                <label style="font-size:10px;color:rgb(100 116 139);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:3px;">Ürün Kodu</label>
                <input type="text" class="item-product-code" placeholder="Kod" value="${item ? (item.product_code || '') : ''}">
            </div>
            <div class="col-span-2">
                <label style="font-size:10px;color:rgb(100 116 139);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:3px;">Miktar</label>
                <input type="number" class="item-quantity" placeholder="0" min="0" step="any" value="${item ? (item.quantity || '') : ''}" oninput="window._updateTotal()">
            </div>
            <div class="col-span-3">
                <label style="font-size:10px;color:rgb(100 116 139);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:3px;">Birim Fiyat</label>
                <input type="number" class="item-unit-price" placeholder="0.00" min="0" step="0.01" value="${item ? (item.unit_price || '') : ''}" oninput="window._updateTotal()">
            </div>
            <div class="col-span-1 flex items-end justify-center" style="padding-bottom:2px;">
                <button type="button" onclick="window._removeItem(this)"
                    style="width:30px;height:30px;border-radius:6px;border:1px solid rgba(248,113,113,0.3);background:rgba(248,113,113,0.1);color:rgb(248 113 113);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>`;
    container.appendChild(div);
}

function updateTotal() {
    const rows = document.querySelectorAll('.item-row');
    let total = 0;
    rows.forEach(row => {
        const qty   = parseFloat(row.querySelector('.item-quantity')?.value || 0) || 0;
        const price = parseFloat(row.querySelector('.item-unit-price')?.value || 0) || 0;
        total += qty * price;
    });
    const curr = document.getElementById('q-currency')?.value || 'USD';
    const sym = { 'USD': '$', 'EUR': '€', 'GBP': '£', 'TRY': '₺' }[curr] || '';
    document.getElementById('q-total-display').textContent =
        `${sym} ${total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
    return total;
}

// Expose global helpers for inline handlers
window._updateTotal  = updateTotal;
window._onProductSelect = (sel) => {
    const opt = sel.selectedOptions[0];
    const row = sel.closest('.item-row');
    if (opt && opt.value) {
        row.querySelector('.item-product-id').value = opt.value;
        row.querySelector('.item-product-name').value = opt.dataset.name || '';
        row.querySelector('.item-product-code').value = opt.dataset.code || '';
    } else {
        row.querySelector('.item-product-id').value = '';
    }
    updateTotal();
};
window._removeItem   = (btn) => { btn.closest('.item-row').remove(); updateTotal(); };
window._openEdit     = (id) => {
    const q = globalQuotations.find(x => x.id === id);
    if (q) openModal(q);
};

// ─────────────────────────────────────────────
// KAYIT
// ─────────────────────────────────────────────
async function saveQuotation(session) {
    const total = updateTotal();

    const payload = {
        user_id:          session.user.id,
        customer_id:      document.getElementById('q-customer').value,
        quotation_number: document.getElementById('q-number').value.trim(),
        quotation_date:   document.getElementById('q-date').value || null,
        valid_until:      document.getElementById('q-valid-until').value || null,
        currency:         document.getElementById('q-currency').value,
        status:           document.getElementById('q-status').value,
        notes:            document.getElementById('q-notes').value.trim() || null,
        total_amount:     total,
    };

    if (!payload.customer_id) { alert('Lütfen müşteri seçiniz.'); return; }

    let quotationId = editingQuotationId;

    if (editingQuotationId) {
        const { error } = await supabase.from('quotations').update(payload).eq('id', editingQuotationId);
        if (error) { alert('Hata: ' + error.message); return; }
    } else {
        const { data, error } = await supabase.from('quotations').insert(payload).select().single();
        if (error) { alert('Hata: ' + error.message); return; }
        quotationId = data.id;
    }

    // Ürün kalemleri — önce mevcutları sil, sonra yeniden ekle
    if (editingQuotationId) {
        await supabase.from('quotation_items').delete().eq('quotation_id', quotationId);
    }

    const rows = document.querySelectorAll('.item-row');
    const items = [];
    const curr = document.getElementById('q-currency').value;
    rows.forEach(row => {
        const name = row.querySelector('.item-product-name')?.value?.trim();
        const code = row.querySelector('.item-product-code')?.value?.trim();
        const pid  = row.querySelector('.item-product-id')?.value || null;
        const qty  = parseFloat(row.querySelector('.item-quantity')?.value) || null;
        const up   = parseFloat(row.querySelector('.item-unit-price')?.value) || null;
        if (name || qty || up) {
            items.push({ quotation_id: quotationId, product_id: pid, product_name: name || null, product_code: code || null, quantity: qty, unit_price: up, currency: curr });
        }
    });

    if (items.length > 0) {
        const { error: iErr } = await supabase.from('quotation_items').insert(items);
        if (iErr) console.error('Kalem kayıt hatası:', iErr.message);
    }

    closeModal();
    const { data: { session: s } } = await supabase.auth.getSession();
    await fetchQuotations(s);
}

// ─────────────────────────────────────────────
// SİLME
// ─────────────────────────────────────────────
async function deleteQuotation() {
    if (!editingQuotationId) return;
    if (!confirm('Bu teklif silinecek. Emin misiniz?')) return;

    // Önce kalemleri sil
    const { error: iErr } = await supabase.from('quotation_items').delete().eq('quotation_id', editingQuotationId);
    if (iErr && iErr.code !== '23503') { alert('Kalem silinemedi: ' + iErr.message); return; }

    const { error } = await supabase.from('quotations').delete().eq('id', editingQuotationId);
    if (error) { alert('Silinemedi: ' + error.message); return; }

    closeModal();
    const { data: { session } } = await supabase.auth.getSession();
    await fetchQuotations(session);
}

// ─────────────────────────────────────────────
// SİPARİŞE DÖNÜŞTÜR
// ─────────────────────────────────────────────
async function convertToOrder() {
    if (!editingQuotationId) return;
    const quotation = globalQuotations.find(q => q.id === editingQuotationId);
    if (!quotation) return;

    if (!confirm(`"${quotation.quotation_number}" teklifini siparişe dönüştürmek istiyor musunuz?`)) return;

    const { data: { session } } = await supabase.auth.getSession();

    // orders tablosuna kayıt
    const orderPayload = {
        user_id:           session.user.id,
        customer_id:       quotation.customer_id,
        order_number:      quotation.quotation_number?.replace('QT-', 'ORD-') || null,
        order_date:        new Date().toISOString().split('T')[0],
        total_amount:      quotation.total_amount,
        currency:          quotation.currency,
        advance_payment:   0,
        remaining_balance: quotation.total_amount,
        production_status: 'Bekliyor',
        payment_status:    'Ödenmedi',
        order_notes:       `Teklif: ${quotation.quotation_number}. ${quotation.notes || ''}`.trim(),
    };

    const { data: orderData, error: oErr } = await supabase.from('orders').insert(orderPayload).select().single();
    if (oErr) { alert('Sipariş oluşturulamadı: ' + oErr.message); return; }

    // quotation güncelle
    const { error: qErr } = await supabase.from('quotations').update({
        status: 'Sipariş Dönüştü',
        converted_order_id: orderData.id
    }).eq('id', editingQuotationId);

    if (qErr) { alert('Teklif durumu güncellenemedi: ' + qErr.message); return; }

    alert(`Sipariş oluşturuldu: ${orderData.order_number || orderData.id}`);
    closeModal();
    await fetchQuotations(session);
}

// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────
function initEventListeners(session) {
    document.getElementById('btn-new-quotation').addEventListener('click', () => openModal());
    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-q-cancel').addEventListener('click', closeModal);
    document.getElementById('btn-add-item').addEventListener('click', () => addItemRow());
    document.getElementById('btn-delete-quotation').addEventListener('click', deleteQuotation);
    document.getElementById('btn-convert-order').addEventListener('click', convertToOrder);
    document.getElementById('q-currency').addEventListener('change', updateTotal);

    document.getElementById('quotation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveQuotation(session);
    });

    // Filtreler
    const applyFilter = () => {
        const search = document.getElementById('filter-search').value.toLowerCase();
        const status = document.getElementById('filter-status').value;
        const filtered = globalQuotations.filter(q => {
            const cust = q.customers?.company_name?.toLowerCase() || '';
            const num  = (q.quotation_number || '').toLowerCase();
            const matchSearch = !search || cust.includes(search) || num.includes(search);
            const matchStatus = !status || q.status === status;
            return matchSearch && matchStatus;
        });
        renderTable(filtered);
    };
    document.getElementById('filter-search').addEventListener('input', applyFilter);
    document.getElementById('filter-status').addEventListener('change', applyFilter);

    // Modal dışı tıklama
    document.getElementById('quotation-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('quotation-modal')) closeModal();
    });
}
