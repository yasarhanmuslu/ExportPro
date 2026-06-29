// orders.js — V: 1.0.78
import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// ── DURUM ETİKETLERİ ────────────────────────────────────────────────────────
const STATUS_TAGS_LIST = [
    { value: 'Devam Ediyor',    cls: 'stag-devam'      },
    { value: 'Üretimde',        cls: 'stag-uretimde'   },
    { value: 'Üretime Hazır',   cls: 'stag-uretehazir' },
    { value: 'Sevke Hazır',     cls: 'stag-sevkhazir'  },
    { value: 'Sevk Edildi',     cls: 'stag-sevkedildi' },
    { value: 'Bakiye Bekliyor', cls: 'stag-bakiye'     },
    { value: 'Ödeme Tamamlandı',cls: 'stag-odeme'      },
    { value: 'Teslim Edildi',   cls: 'stag-teslim'     },
    { value: 'İptal',           cls: 'stag-iptal'      },
    { value: 'Gecikme',         cls: 'stag-gecikme'    },
];

// Sol bar rengi — ilk etikete göre
const TAG_BAR_COLOR = {
    'Devam Ediyor':    '#94a3b8',
    'Üretimde':        '#a855f7',
    'Üretime Hazır':   '#a855f7',
    'Sevke Hazır':     '#3b82f6',
    'Sevk Edildi':     '#3b82f6',
    'Bakiye Bekliyor': '#eab308',
    'Ödeme Tamamlandı':'#22c55e',
    'Teslim Edildi':   '#22c55e',
    'İptal':           '#ef4444',
    'Gecikme':         '#ef4444',
};

const TAG_CLS = {
    'Devam Ediyor':    'stag-devam',
    'Üretimde':        'stag-uretimde',
    'Üretime Hazır':   'stag-uretehazir',
    'Sevke Hazır':     'stag-sevkhazir',
    'Sevk Edildi':     'stag-sevkedildi',
    'Bakiye Bekliyor': 'stag-bakiye',
    'Ödeme Tamamlandı':'stag-odeme',
    'Teslim Edildi':   'stag-teslim',
    'İptal':           'stag-iptal',
    'Gecikme':         'stag-gecikme',
};

let globalOrders   = [];
let globalCustomers = [];
let globalProducts  = [];
let currentOrderId  = null;
let orderItemsBuffer = [];

// ── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    await renderNavbar('orders');
    renderStatusTagCheckboxes();
    await Promise.all([fetchCustomersData(), fetchOrdersData(), fetchProductsData()]);
    initEventListeners();
});

// ── VERİ ÇEKME ───────────────────────────────────────────────────────────────
async function fetchCustomersData() {
    try {
        const { data, error } = await supabase
            .from('customers')
            .select('id, company_name, country, status')
            .order('company_name', { ascending: true });
        if (error) throw error;
        globalCustomers = data || [];  // Tüm müşteriler — import validasyonu için
        const aktifCustomers = globalCustomers.filter(c => c.status === 'Aktif');
        initCustomerSearchDropdown(aktifCustomers);  // Dropdown: yalnızca Aktif
    } catch (err) {
        console.error('Müşteri listesi yüklenemedi:', err.message);
    }
}

async function fetchProductsData() {
    try {
        const { data, error } = await supabase
            .from('urunler')
            .select('id, stok_kodu, stok_adi_1')
            .order('stok_adi_1', { ascending: true });
        if (error) throw error;
        globalProducts = data || [];
    } catch (err) {
        console.error('Ürün listesi yüklenemedi:', err.message);
    }
}

async function fetchOrdersData() {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`*, customers!fk_orders_customer ( company_name, country )`)
            .order('order_date', { ascending: false });
        if (error) throw error;
        globalOrders = data || [];
        renderOrdersList(globalOrders);
    } catch (err) {
        console.error('Sipariş verileri yüklenemedi:', err.message);
        document.getElementById('orders-card-list').innerHTML =
            `<div style="text-align:center;color:#9F3D3D;padding:32px;">Veriler çekilirken hata oluştu.</div>`;
    }
}

async function fetchOrderItems(orderId) {
    try {
        const { data, error } = await supabase
            .from('order_items')
            .select('*')
            .eq('order_id', orderId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Sipariş kalemleri yüklenemedi:', err.message);
        return [];
    }
}

// ── SATIRLARI RENDER ET ───────────────────────────────────────────────────────
function renderOrdersList(list) {
    const container  = document.getElementById('orders-card-list');
    const countBadge = document.getElementById('total-filtered-count');
    container.innerHTML = '';
    countBadge.textContent = `${list.length} Sipariş`;

    if (list.length === 0) {
        container.innerHTML = `<div style="text-align:center;color:#968B7A;padding:40px;">Kriterlere uygun sipariş bulunamadı.</div>`;
        return;
    }

    const sym = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
    const today = new Date(); today.setHours(0,0,0,0);

    list.forEach(order => {
        const s        = sym[order.currency] || order.currency;
        const compName = order.customers?.company_name || 'Bilinmeyen Müşteri';
        const country  = order.customers?.country || '';

        // status_tags array — fallback to order_status
        const tags = (order.status_tags && order.status_tags.length > 0)
            ? order.status_tags
            : (order.order_status ? [order.order_status] : ['Devam Ediyor']);

        const barColor = TAG_BAR_COLOR[tags[0]] || '#94a3b8';

        const fmt     = n  => parseFloat(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        const fmtDate = d  => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR') : null;

        // Vade uyarısı
        let vadeTxt = '—';
        let vadeWarn = false;
        if (order.due_date) {
            const dueD = new Date(order.due_date + 'T00:00:00');
            vadeTxt  = dueD.toLocaleDateString('tr-TR');
            vadeWarn = dueD < today;
        }

        const remaining = parseFloat(order.remaining_balance || 0);
        const kalanHtml = remaining === 0
            ? `<span class="fin-sifir">0,00 ${s}</span>`
            : `<span class="fin-kalan">${fmt(remaining)} ${s}</span>`;

        // Sipariş türü badge
        const typeMap = { 'İhracat': 'type-ihracat', 'İhraç Kayıt': 'type-ihrac', 'KDV': 'type-kdv' };
        const typeBadge = order.order_type
            ? `<span class="${typeMap[order.order_type] || 'type-ihracat'}">${escapeHtml(order.order_type)}</span>`
            : '';

        // Status tag badge'leri
        const tagBadges = tags.map(t =>
            `<span class="stag ${TAG_CLS[t] || 'stag-default'}">${escapeHtml(t)}</span>`
        ).join('');

        // Not (max 60 karakter)
        const noteRaw  = order.order_notes || '';
        const noteTxt  = noteRaw.length > 60 ? noteRaw.slice(0, 60) + '\u2026' : noteRaw;
        const noteHtml = noteRaw
            ? `<div class="row-note"><i class="fa-solid fa-note-sticky" style="font-size:10px;margin-right:4px;opacity:0.6;"></i>${escapeHtml(noteTxt)}</div>`
            : '';

        const row = document.createElement('div');
        row.className = 'order-row';
        row.innerHTML = `
            <div class="row-bar" style="background:${barColor};"></div>
            <div class="row-body">
                <div class="row-col-firm">
                    <div class="row-firm">${escapeHtml(compName)}</div>
                    <div class="row-firm-sub">
                        <span class="row-country">${escapeHtml(country.toLocaleUpperCase('tr-TR'))}</span>
                        ${typeBadge}
                        <div class="row-tags">${tagBadges}</div>
                    </div>
                    ${noteHtml}
                </div>
                <div class="row-col-dates">
                    <div class="dates-grid">
                        <div class="d-cell"><span class="d-lbl">Sip. No</span><span class="d-val">${escapeHtml(order.order_number || '\u2014')}</span></div>
                        <div class="d-cell"><span class="d-lbl">Tarih</span><span class="d-val">${fmtDate(order.order_date) || '\u2014'}</span></div>
                        <div class="d-cell"><span class="d-lbl">Sevk</span><span class="d-val">${fmtDate(order.shipment_date) || '\u2014'}</span></div>
                        <div class="d-cell"><span class="d-lbl">Vade</span><span class="${vadeWarn ? 'd-warn' : 'd-val'}">${escapeHtml(vadeTxt)}${vadeWarn ? ' \u26a0' : ''}</span></div>
                        <div class="d-cell"><span class="d-lbl">\u0130devit No</span><span class="d-val">${escapeHtml(order.idevit_order_no || '\u2014')}</span></div>
                        <div class="d-cell"><span class="d-lbl">\u0130deal No</span><span class="d-val">${escapeHtml(order.ideal_order_no || '\u2014')}</span></div>
                    </div>
                </div>
                <div class="row-col-fin">
                    <div class="fin-r"><span class="fin-lbl">Toplam</span><span class="fin-val">${fmt(order.total_amount)} ${s}</span></div>
                    <div class="fin-divider"></div>
                    <div class="fin-r"><span class="fin-lbl">Avans</span><span class="fin-sub">${fmt(order.advance_payment)} ${s}</span></div>
                    <div class="fin-r"><span class="fin-lbl">Kalan</span>${kalanHtml}</div>
                    <div class="fin-divider"></div>
                    <div class="fin-r"><span class="fin-lbl">Adet</span><span class="fin-sub">${escapeHtml(order.order_quantity || '\u2014')}</span><span style="width:6px;display:inline-block;"></span><span class="fin-lbl">\u00d6deme</span><span class="fin-sub">${escapeHtml(order.payment_method || '\u2014')}</span></div>
                </div>
                <div class="row-col-act">
                    <button class="btn-yonet btn-edit-order-trigger" data-id="${order.id}">
                        <i class="fa-solid fa-file-pen"></i> Y\u00f6net
                    </button>
                </div>
            </div>
        `;
        container.appendChild(row);
    });

    container.querySelectorAll('.btn-edit-order-trigger').forEach(btn => {
        btn.addEventListener('click', e => openModalForEdit(e.currentTarget.dataset.id));
    });
}

// ── STATUS TAG CHECKBOX ───────────────────────────────────────────────────────
function renderStatusTagCheckboxes() {
    const wrap = document.getElementById('status-tags-container');
    if (!wrap) return;
    wrap.innerHTML = STATUS_TAGS_LIST.map(t => `
        <div>
            <input type="checkbox" class="tag-cb-wrap" id="stag_${t.value}" value="${t.value}">
            <label class="tag-cb-label" for="stag_${t.value}">${escapeHtml(t.value)}</label>
        </div>
    `).join('');
}

function getSelectedTags() {
    return Array.from(document.querySelectorAll('.tag-cb-wrap:checked')).map(cb => cb.value);
}

function setSelectedTags(tags) {
    document.querySelectorAll('.tag-cb-wrap').forEach(cb => {
        cb.checked = tags.includes(cb.value);
    });
}

// ── CUSTOMER DROPDOWN ─────────────────────────────────────────────────────────
function initCustomerSearchDropdown(customers) {
    const wrapper     = document.getElementById('customer-dropdown-wrapper');
    const searchInput = document.getElementById('customer-search-input');
    const hiddenSel   = document.getElementById('order-customer-select');
    const dropdown    = document.getElementById('customer-dropdown-list');
    if (!wrapper) return;

    function renderList(filterText) {
        const q = filterText.toLocaleLowerCase('tr-TR');
        const filtered = customers.filter(c =>
            c.company_name.toLocaleLowerCase('tr-TR').includes(q) ||
            (c.country || '').toLocaleLowerCase('tr-TR').includes(q)
        );
        dropdown.innerHTML = '';
        if (filtered.length === 0) {
            dropdown.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:#968B7A;">Sonuç bulunamadı</div>`;
        } else {
            filtered.forEach(c => {
                const item = document.createElement('div');
                item.className = 'customer-dropdown-item';
                item.dataset.id    = c.id;
                item.dataset.label = `${c.company_name} (${c.country})`;
                item.innerHTML = `<span style="font-weight:600;color:#1C1A17;">${escapeHtml(c.company_name)}</span>
                    <span style="font-size:11px;color:#968B7A;margin-left:6px;text-transform:uppercase;">${escapeHtml(c.country || '')}</span>`;
                item.addEventListener('mousedown', e => {
                    e.preventDefault();
                    hiddenSel.value   = c.id;
                    searchInput.value = item.dataset.label;
                    dropdown.classList.add('hidden');
                    searchInput.style.borderColor = '#2D4A3E';
                });
                dropdown.appendChild(item);
            });
        }
        dropdown.classList.remove('hidden');
    }

    searchInput.addEventListener('input',  () => renderList(searchInput.value));
    searchInput.addEventListener('focus',  () => renderList(searchInput.value));
    searchInput.addEventListener('blur',   () => setTimeout(() => dropdown.classList.add('hidden'), 150));

    wrapper._setCustomer = (id, label) => {
        hiddenSel.value   = id;
        searchInput.value = label;
    };
}

// ── MODAL KONTROL ─────────────────────────────────────────────────────────────
function openModalForCreate() {
    document.getElementById('order-form').reset();
    document.getElementById('order-id').value = '';
    document.getElementById('customer-search-input').value = '';
    document.getElementById('order-customer-select').value = '';
    document.getElementById('order_date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('live-remaining-balance').textContent = '0,00';
    document.getElementById('order-modal-title').textContent = 'Yeni Sipariş Girişi';
    document.querySelector('#order-modal .modal-title i').className = 'fa-solid fa-cart-plus';
    document.querySelector('#order-modal .modal-title i').style.color = '#2D4A3E';
    const delBtn = document.getElementById('btn-delete-order');
    delBtn.classList.add('hidden'); delBtn.style.display = 'none';
    setSelectedTags(['Devam Ediyor']);
    currentOrderId  = null;
    orderItemsBuffer = [];
    switchTab('general');
    document.getElementById('order-modal').classList.remove('hidden');
}

async function openModalForEdit(id) {
    const order = globalOrders.find(o => o.id === id);
    if (!order) return;
    currentOrderId = id;

    document.getElementById('order-id').value = order.id;

    const wrapper = document.getElementById('customer-dropdown-wrapper');
    const cust    = globalCustomers.find(c => c.id === order.customer_id);
    const label   = cust
        ? `${cust.company_name} (${cust.country})`
        : (order.customers ? `${order.customers.company_name} (${order.customers.country})` : '');
    if (wrapper?._setCustomer) wrapper._setCustomer(order.customer_id, label);
    else document.getElementById('order-customer-select').value = order.customer_id;

    document.getElementById('order_number').value      = order.order_number || '';
    document.getElementById('idevit_order_no').value   = order.idevit_order_no || '';
    document.getElementById('ideal_order_no').value    = order.ideal_order_no || '';
    document.getElementById('order_type').value        = order.order_type || '';
    document.getElementById('order_date').value        = order.order_date || '';
    document.getElementById('shipment_date').value     = order.shipment_date || '';
    document.getElementById('due_date').value          = order.due_date || '';
    document.getElementById('currency').value          = order.currency || 'EUR';
    document.getElementById('total_amount').value      = parseFloat(order.total_amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('advance_payment').value   = parseFloat(order.advance_payment || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('live-remaining-balance').textContent = parseFloat(order.remaining_balance || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('order_quantity').value    = order.order_quantity || '';
    document.getElementById('payment_method').value   = order.payment_method || '';
    document.getElementById('order_notes').value       = order.order_notes || '';

    // Status tags
    const tags = (order.status_tags && order.status_tags.length > 0)
        ? order.status_tags
        : (order.order_status ? [order.order_status] : ['Devam Ediyor']);
    setSelectedTags(tags);

    document.getElementById('order-modal-title').textContent = 'Sipariş Düzenleme & Güncelleme';
    document.querySelector('#order-modal .modal-title i').className = 'fa-solid fa-file-pen';
    document.querySelector('#order-modal .modal-title i').style.color = '#B26B33';
    const delBtn = document.getElementById('btn-delete-order');
    delBtn.classList.remove('hidden'); delBtn.style.display = 'flex';

    const existingItems = await fetchOrderItems(id);
    orderItemsBuffer = existingItems.map(item => ({
        id: item.id, product_id: item.product_id,
        product_name: item.product_name, product_code: item.product_code,
        quantity: item.quantity, unit_price: item.unit_price, notes: item.notes
    }));

    switchTab('general');
    document.getElementById('order-modal').classList.remove('hidden');
}

function closeOrderModal() {
    document.getElementById('order-modal').classList.add('hidden');
    orderItemsBuffer = [];
    currentOrderId   = null;
}

// ── SEKME GEÇİŞİ ─────────────────────────────────────────────────────────────
function switchTab(tab) {
    const gPanel = document.getElementById('panel-general');
    const iPanel = document.getElementById('panel-items');
    const gTab   = document.getElementById('tab-general');
    const iTab   = document.getElementById('tab-items');
    if (tab === 'general') {
        gPanel.style.display = 'flex'; iPanel.classList.add('hidden');
        gTab.classList.add('tab-active'); iTab.classList.remove('tab-active');
    } else {
        gPanel.style.display = 'none'; iPanel.classList.remove('hidden');
        gTab.classList.remove('tab-active'); iTab.classList.add('tab-active');
        renderItemsTable();
    }
}

// ── KAYDETME ──────────────────────────────────────────────────────────────────
async function handleOrderSubmit(e) {
    e.preventDefault();
    const customerId = document.getElementById('order-customer-select').value;
    if (!customerId) { alert('Lütfen bir müşteri / firma seçiniz.'); return; }

    const total_amount     = parseTurkishFloat(document.getElementById('total_amount').value);
    const advance_payment  = parseTurkishFloat(document.getElementById('advance_payment').value);
    const remaining_balance = total_amount - advance_payment;

    if (isNaN(total_amount) || total_amount <= 0) {
        alert('Lütfen geçerli bir toplam sipariş tutarı giriniz.');
        return;
    }

    const selectedTags = getSelectedTags();

    const payload = {
        customer_id:     customerId,
        order_date:      document.getElementById('order_date').value,
        currency:        document.getElementById('currency').value,
        total_amount,
        advance_payment,
        remaining_balance,
        order_number:    document.getElementById('order_number').value || null,
        idevit_order_no: document.getElementById('idevit_order_no').value || null,
        ideal_order_no:  document.getElementById('ideal_order_no').value || null,
        order_type:      document.getElementById('order_type').value || null,
        payment_method:  document.getElementById('payment_method').value || null,
        shipment_date:   document.getElementById('shipment_date').value || null,
        due_date:        document.getElementById('due_date').value || null,
        order_status:    selectedTags[0] || 'Devam Ediyor',
        status_tags:     selectedTags.length > 0 ? selectedTags : ['Devam Ediyor'],
        order_quantity:  document.getElementById('order_quantity').value || null,
        order_notes:     document.getElementById('order_notes').value || null,
    };

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session.user.id;
        let orderId = currentOrderId;

        // ── MÜKERRER NUMARA KONTROLÜ ─────────────────────────────────────────
        const orderNumberVal  = payload.order_number;
        const idevitNumberVal = payload.idevit_order_no;
        const idealNumberVal  = payload.ideal_order_no;

        // Düzenleme modunda kendi ID'sini hariç tut
        const excludeId = currentOrderId || null;

        const duplicateErrors = [];

        if (orderNumberVal) {
            let q = supabase.from('orders').select('id, order_number').eq('user_id', userId).eq('order_number', orderNumberVal);
            if (excludeId) q = q.neq('id', excludeId);
            const { data: dup } = await q;
            if (dup && dup.length > 0) duplicateErrors.push(`• Sipariş No "${orderNumberVal}" zaten kayıtlı.`);
        }

        if (idevitNumberVal) {
            let q = supabase.from('orders').select('id, idevit_order_no').eq('user_id', userId).eq('idevit_order_no', idevitNumberVal);
            if (excludeId) q = q.neq('id', excludeId);
            const { data: dup } = await q;
            if (dup && dup.length > 0) duplicateErrors.push(`• İdevit Sipariş No "${idevitNumberVal}" zaten kayıtlı.`);
        }

        if (idealNumberVal) {
            let q = supabase.from('orders').select('id, ideal_order_no').eq('user_id', userId).eq('ideal_order_no', idealNumberVal);
            if (excludeId) q = q.neq('id', excludeId);
            const { data: dup } = await q;
            if (dup && dup.length > 0) duplicateErrors.push(`• İdeal Sipariş No "${idealNumberVal}" zaten kayıtlı.`);
        }

        if (duplicateErrors.length > 0) {
            alert('⚠ Mükerrer Numara Uyarısı\n\nAşağıdaki numara(lar) sistemde zaten mevcut:\n\n' + duplicateErrors.join('\n') + '\n\nLütfen numara(ları) kontrol edip tekrar deneyin.');
            return;
        }
        // ─────────────────────────────────────────────────────────────────────

        if (currentOrderId) {
            const { error } = await supabase.from('orders').update(payload).eq('id', currentOrderId).eq('user_id', userId);
            if (error) throw error;
        } else {
            payload.user_id = userId;
            const { data, error } = await supabase.from('orders').insert([payload]).select().single();
            if (error) throw error;
            orderId = data.id;
        }

        await saveOrderItems(orderId, userId);
        closeOrderModal();
        await fetchOrdersData();
    } catch (err) {
        console.error('Sipariş kaydedilemedi:', err.message);
        alert('Hata: ' + err.message);
    }
}

async function saveOrderItems(orderId, userId) {
    const existingItems = currentOrderId ? await fetchOrderItems(orderId) : [];
    const existingIds   = existingItems.map(i => i.id);
    const bufferIds     = orderItemsBuffer.filter(i => i.id).map(i => i.id);
    const toDelete      = existingIds.filter(eid => !bufferIds.includes(eid));

    if (toDelete.length > 0) {
        const { error } = await supabase.from('order_items').delete().in('id', toDelete);
        if (error) throw error;
    }

    for (const item of orderItemsBuffer) {
        if (!item.product_name) continue;
        const itemPayload = {
            order_id: orderId, user_id: userId,
            product_id: item.product_id || null,
            product_name: item.product_name,
            product_code: item.product_code || null,
            quantity: item.quantity || null,
            unit_price: item.unit_price || null,
            currency: document.getElementById('currency').value,
            notes: item.notes || null,
        };
        if (item.id) {
            const { error } = await supabase.from('order_items').update(itemPayload).eq('id', item.id);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('order_items').insert([itemPayload]);
            if (error) throw error;
        }
    }
}

// ── SİLME ─────────────────────────────────────────────────────────────────────
async function handleDeleteOrder() {
    const id = document.getElementById('order-id').value;
    if (!id || !confirm('Bu siparişi kalıcı olarak silmek istediğinize emin misiniz?')) return;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase.from('orders').delete().eq('id', id).eq('user_id', session.user.id);
        if (error) throw error;
        closeOrderModal();
        await fetchOrdersData();
    } catch (err) {
        console.error('Sipariş silinemedi:', err.message);
        if (err.code === '23503') {
            alert('Bu sipariş silinemez!\nBağlı credit note veya kalem kaydı var.\nÖnce ilgili kayıtları siliniz.');
        } else {
            alert('Silme başarısız: ' + err.message);
        }
    }
}

// ── FİLTRELEME ───────────────────────────────────────────────────────────────
function applyFilters() {
    const search     = document.getElementById('order-search-input').value.toLocaleLowerCase('tr-TR');
    const currency   = document.getElementById('filter-order-currency').value;
    const statusFilter = document.getElementById('filter-order-status').value;

    const filtered = globalOrders.filter(o => {
        const compName = (o.customers?.company_name || '').toLocaleLowerCase('tr-TR');
        const orderNo  = (o.order_number || '').toLocaleLowerCase('tr-TR');
        const matchSearch   = compName.includes(search) || orderNo.includes(search);
        const matchCurrency = !currency || o.currency === currency;
        const tags = (o.status_tags && o.status_tags.length > 0) ? o.status_tags : [o.order_status || ''];
        const matchStatus   = !statusFilter || tags.includes(statusFilter);
        return matchSearch && matchCurrency && matchStatus;
    });

    renderOrdersList(filtered);
}

// ── KALEM TABLOSU ─────────────────────────────────────────────────────────────
function renderItemsTable() {
    const tbody = document.getElementById('items-table-body');
    tbody.innerHTML = '';

    if (orderItemsBuffer.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#968B7A;padding:24px;font-size:13px;">Henüz sipariş kalemi eklenmedi. "Satır Ekle" butonunu kullanın.</td></tr>`;
        updateItemsTotal();
        return;
    }

    orderItemsBuffer.forEach((item, idx) => {
        const productOptions = globalProducts.map(p =>
            `<option value="${p.id}" data-code="${escapeHtml(p.stok_kodu || '')}" data-name="${escapeHtml(p.stok_adi_1)}" ${item.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.stok_adi_1)}</option>`
        ).join('');

        const tr = document.createElement('tr');
        tr.dataset.idx = idx;
        tr.innerHTML = `
            <td style="min-width:200px;">
                <select class="item-product-select" data-idx="${idx}" style="height:34px;font-size:12px;">
                    <option value="">-- Ürün Seç --</option>${productOptions}
                </select>
                <input type="text" class="item-product-name mt-1" data-idx="${idx}" value="${escapeHtml(item.product_name || '')}" placeholder="veya serbest metin" style="height:30px;font-size:11px;margin-top:4px;">
            </td>
            <td style="min-width:110px;">
                <input type="text" class="item-product-code" data-idx="${idx}" value="${escapeHtml(item.product_code || '')}" placeholder="Ürün kodu" style="height:34px;font-size:12px;">
            </td>
            <td style="min-width:90px;">
                <input type="number" class="item-quantity" data-idx="${idx}" value="${item.quantity || ''}" placeholder="0" step="any" style="height:34px;font-size:12px;text-align:right;">
            </td>
            <td style="min-width:120px;">
                <input type="number" class="item-unit-price" data-idx="${idx}" value="${item.unit_price || ''}" placeholder="0.00" step="any" style="height:34px;font-size:12px;text-align:right;">
            </td>
            <td style="text-align:right;font-weight:600;font-size:13px;color:#2D4A3E;" class="item-amount" data-idx="${idx}">
                ${calcAmount(item.quantity, item.unit_price)}
            </td>
            <td style="text-align:center;">
                <button class="btn-remove-item" data-idx="${idx}" style="background:none;border:none;cursor:pointer;color:#9F3D3D;font-size:13px;padding:4px 8px;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
                <input type="text" class="item-notes" data-idx="${idx}" value="${escapeHtml(item.notes || '')}" placeholder="Not" style="height:28px;font-size:11px;margin-top:4px;display:block;">
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Events
    tbody.querySelectorAll('.item-product-select').forEach(sel => {
        sel.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.idx);
            const opt = e.target.selectedOptions[0];
            if (opt?.value) {
                orderItemsBuffer[idx].product_id   = opt.value;
                orderItemsBuffer[idx].product_name = opt.dataset.name || '';
                orderItemsBuffer[idx].product_code = opt.dataset.code || '';
                const nameInp = tbody.querySelector(`.item-product-name[data-idx="${idx}"]`);
                const codeInp = tbody.querySelector(`.item-product-code[data-idx="${idx}"]`);
                if (nameInp) nameInp.value = opt.dataset.name || '';
                if (codeInp) codeInp.value = opt.dataset.code || '';
            }
        });
    });
    tbody.querySelectorAll('.item-product-name').forEach(inp => {
        inp.addEventListener('input', e => { orderItemsBuffer[parseInt(e.target.dataset.idx)].product_name = e.target.value; });
    });
    tbody.querySelectorAll('.item-product-code').forEach(inp => {
        inp.addEventListener('input', e => { orderItemsBuffer[parseInt(e.target.dataset.idx)].product_code = e.target.value; });
    });
    tbody.querySelectorAll('.item-quantity').forEach(inp => {
        inp.addEventListener('input', e => {
            const idx = parseInt(e.target.dataset.idx);
            orderItemsBuffer[idx].quantity = parseFloat(e.target.value) || null;
            updateItemAmount(tbody, idx); updateItemsTotal();
        });
    });
    tbody.querySelectorAll('.item-unit-price').forEach(inp => {
        inp.addEventListener('input', e => {
            const idx = parseInt(e.target.dataset.idx);
            orderItemsBuffer[idx].unit_price = parseFloat(e.target.value) || null;
            updateItemAmount(tbody, idx); updateItemsTotal();
        });
    });
    tbody.querySelectorAll('.item-notes').forEach(inp => {
        inp.addEventListener('input', e => { orderItemsBuffer[parseInt(e.target.dataset.idx)].notes = e.target.value; });
    });
    tbody.querySelectorAll('.btn-remove-item').forEach(btn => {
        btn.addEventListener('click', e => {
            orderItemsBuffer.splice(parseInt(e.currentTarget.dataset.idx), 1);
            renderItemsTable();
        });
    });

    updateItemsTotal();
}

function calcAmount(qty, price) {
    return ((parseFloat(qty) || 0) * (parseFloat(price) || 0))
        .toLocaleString('tr-TR', { minimumFractionDigits: 2 });
}

function updateItemAmount(tbody, idx) {
    const cell = tbody.querySelector(`.item-amount[data-idx="${idx}"]`);
    if (cell) cell.textContent = calcAmount(orderItemsBuffer[idx].quantity, orderItemsBuffer[idx].unit_price);
}

function updateItemsTotal() {
    const total = orderItemsBuffer.reduce((s, i) =>
        s + ((parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0)), 0);
    document.getElementById('items-total').textContent = total.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    const orderTotal = parseTurkishFloat(document.getElementById('total_amount').value);
    const warn = document.getElementById('items-total-warning');
    if (orderTotal > 0 && Math.abs(total - orderTotal) > 0.01) {
        warn.classList.remove('hidden');
        warn.textContent = `⚠ Kalem toplamı (${total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}) sipariş tutarından (${orderTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}) farklı!`;
    } else {
        warn.classList.add('hidden');
    }
}

function addItemRow() {
    orderItemsBuffer.push({ id: null, product_id: null, product_name: '', product_code: '', quantity: null, unit_price: null, notes: '' });
    switchTab('items');
}

// ── EXCEL IMPORT ──────────────────────────────────────────────────────────────
let importFileData = null;

function openImportModal() {
    importFileData = null;
    document.getElementById('import-file-input').value = '';
    document.getElementById('import-log-wrap').classList.add('hidden');
    document.getElementById('import-log').innerHTML = '';
    document.getElementById('import-clear-first').checked = false;
    const runBtn = document.getElementById('btn-import-run');
    runBtn.disabled = true;
    runBtn.style.background = '#D6D2C9';
    runBtn.style.color = '#6B655B';
    runBtn.style.cursor = 'not-allowed';
    document.getElementById('import-modal').classList.remove('hidden');
}

function closeImportModal() {
    document.getElementById('import-modal').classList.add('hidden');
    importFileData = null;
}

function logMsg(msg, type = 'ok') {
    const wrap = document.getElementById('import-log-wrap');
    const log  = document.getElementById('import-log');
    wrap.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = `log-${type}`;
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

async function handleImportRun() {
    if (!importFileData) return;
    const runBtn = document.getElementById('btn-import-run');
    runBtn.disabled = true;
    runBtn.textContent = 'İşleniyor...';

    document.getElementById('import-log').innerHTML = '';
    document.getElementById('import-log-wrap').classList.remove('hidden');

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session.user.id;

        // XLSX parse
        const XLSX = window.XLSX;
        if (!XLSX) { logMsg('XLSX kütüphanesi yüklenemedi.', 'err'); return; }

        const wb   = XLSX.read(importFileData, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (rows.length === 0) { logMsg('Excel dosyası boş veya okunamadı.', 'err'); return; }

        // ── AŞAMA 1: ÖN DOĞRULAMA GEÇIŞI ────────────────────────────────────
        logMsg('⏳ Validasyon kontrolleri yapılıyor...', 'warn');

        const unknownFirms   = new Set();  // müşteri kartında hiç olmayan firmalar
        const passiveFirms   = new Set();  // kayıtlı ama pasif firmalar
        const duplicateNums  = [];         // mükerrer numara uyarıları

        // Mevcut DB numaralarını çek (sadece bu kullanıcıya ait)
        const { data: existingOrders } = await supabase
            .from('orders')
            .select('order_number, idevit_order_no, ideal_order_no, customer_id')
            .eq('user_id', userId);

        // Sipariş No: müşteri bazlı unique → composite key "customer_id|order_number"
        const dbOrderNums  = new Set(
            (existingOrders || [])
                .filter(o => o.order_number && o.customer_id)
                .map(o => `${o.customer_id}|${o.order_number}`)
        );
        // İdevit & İdeal No: global unique (tüm siparişlerde tekil olmalı)
        const dbIdevitNums = new Set((existingOrders || []).map(o => o.idevit_order_no).filter(Boolean));
        const dbIdealNums  = new Set((existingOrders || []).map(o => o.ideal_order_no).filter(Boolean));

        // Import içi mükerrer takibi — sipariş no: "musteriAdi|siparisNo" composite
        const importOrderNums  = new Set();
        const importIdevitNums = new Set();
        const importIdealNums  = new Set();

        // clearFirst modunda DB'deki numaralar geçerli değil — seti boşalt
        const clearFirst = document.getElementById('import-clear-first').checked;
        if (clearFirst) {
            dbOrderNums.clear(); dbIdevitNums.clear(); dbIdealNums.clear();
        }

        for (const row of rows) {
            if (!row['musteri_adi'] && !row['siparis_no']) continue;

            const musteriAdi = String(row['musteri_adi'] || '').trim();
            const siparisNo  = String(row['siparis_no']  || '').trim();
            const idevitNo   = String(row['idevit_sip_no'] || '').trim();
            const idealNo    = String(row['ideal_sip_no']  || '').trim();

            if (!musteriAdi || !siparisNo) continue;

            // Müşteri kartı kontrolü — kayıtlı mı? Pasif mi?
            const cust = globalCustomers.find(c =>
                c.company_name.toLocaleLowerCase('tr-TR') === musteriAdi.toLocaleLowerCase('tr-TR')
            );
            if (!cust) {
                unknownFirms.add(musteriAdi);
            } else if (cust.status !== 'Aktif') {
                passiveFirms.add(musteriAdi);
            }

            // Boş / tire değerlerini numara olarak sayma — "-" girilmişse boş sayılır
            const isRealNum = val => val && val !== '-' && val !== '—' && val.trim() !== '';

            // Sipariş No mükerrer kontrolü — composite key: müşteri + sipariş no
            // (2026-01 her müşteri için ayrı sequence, farklı müşterilerde aynı no olabilir)
            if (isRealNum(siparisNo) && cust) {
                const orderKey = `${cust.id}|${siparisNo}`;
                if (dbOrderNums.has(orderKey)) {
                    duplicateNums.push(`• Sipariş No "${siparisNo}" (${musteriAdi}) — bu müşteri için DB'de zaten mevcut`);
                } else if (importOrderNums.has(orderKey)) {
                    duplicateNums.push(`• Sipariş No "${siparisNo}" (${musteriAdi}) — bu müşteri için dosyada mükerrer`);
                } else {
                    importOrderNums.add(orderKey);
                }
            }

            // İdevit No mükerrer kontrolü
            if (isRealNum(idevitNo)) {
                if (dbIdevitNums.has(idevitNo)) {
                    duplicateNums.push(`• İdevit No "${idevitNo}" (${musteriAdi}) — DB'de zaten mevcut`);
                } else if (importIdevitNums.has(idevitNo)) {
                    duplicateNums.push(`• İdevit No "${idevitNo}" (${musteriAdi}) — dosyada mükerrer`);
                } else {
                    importIdevitNums.add(idevitNo);
                }
            }

            // İdeal No mükerrer kontrolü
            if (isRealNum(idealNo)) {
                if (dbIdealNums.has(idealNo)) {
                    duplicateNums.push(`• İdeal No "${idealNo}" (${musteriAdi}) — DB'de zaten mevcut`);
                } else if (importIdealNums.has(idealNo)) {
                    duplicateNums.push(`• İdeal No "${idealNo}" (${musteriAdi}) — dosyada mükerrer`);
                } else {
                    importIdealNums.add(idealNo);
                }
            }
        }

        // Validasyon sonuçları — hata varsa durdur
        let hasValidationError = false;

        if (passiveFirms.size > 0) {
            hasValidationError = true;
            logMsg('─────────────────────────────', 'warn');
            logMsg('⚠ PASİF STATÜDEKI FİRMALAR:', 'warn');
            for (const firm of passiveFirms) {
                logMsg(`   ⚠ "${firm}" — müşteri kartında kayıtlı fakat şu an PASİF`, 'warn');
            }
            logMsg('➡ Lütfen yukarıdaki firmaları Müşteri Kartları sayfasında önce AKTİF yapın.', 'warn');
        }

        if (unknownFirms.size > 0) {
            hasValidationError = true;
            logMsg('─────────────────────────────', 'err');
            logMsg('🚫 MÜŞTERI KARTI BULUNAMAYAN FİRMALAR:', 'err');
            for (const firm of unknownFirms) {
                logMsg(`   ✗ "${firm}" — müşteri kartında kayıtlı değil`, 'err');
            }
            logMsg('➡ Lütfen yukarıdaki firmaları önce Müşteri Kartları sayfasına ekleyin.', 'err');
        }

        if (duplicateNums.length > 0) {
            hasValidationError = true;
            logMsg('─────────────────────────────', 'err');
            logMsg('🚫 MÜKERRER NUMARA UYARILARI:', 'err');
            for (const msg of duplicateNums) {
                logMsg(`   ${msg}`, 'err');
            }
            if (!clearFirst) {
                logMsg('➡ İpucu: Güncelleme yapmak istiyorsanız aynı siparis_no üzerinden upsert gerçekleşir.', 'warn');
                logMsg('➡ Sıfırdan yüklemek istiyorsanız "Mevcut verileri sil" seçeneğini işaretleyin.', 'warn');
            }
        }

        if (hasValidationError) {
            logMsg('─────────────────────────────', 'err');
            logMsg('❌ Import durduruldu — lütfen yukarıdaki hataları düzeltin ve tekrar deneyin.', 'err');
            runBtn.disabled = false;
            runBtn.style.background = '#9F3D3D';
            runBtn.style.color = '#fff';
            runBtn.style.cursor = 'pointer';
            runBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Hata — Tekrar Dene';
            return;
        }

        logMsg('✓ Validasyon geçti — import başlıyor...', 'ok');
        logMsg('─────────────────────────────', 'ok');
        // ─────────────────────────────────────────────────────────────────────

        // İlk toplu giriş — sıfırla
        if (clearFirst) {
            logMsg('Mevcut siparişler siliniyor...', 'warn');
            const { error: delErr } = await supabase.from('orders').delete().eq('user_id', userId);
            if (delErr) throw delErr;
            logMsg('Mevcut veriler temizlendi.', 'warn');
        }

        let inserted = 0, updated = 0, errored = 0;

        for (const row of rows) {
            // Başlık satırı veya boş satır atla
            if (!row['musteri_adi'] && !row['siparis_no']) continue;

            const musteriAdi  = String(row['musteri_adi'] || '').trim();
            const siparisNo   = String(row['siparis_no']  || '').trim();

            if (!musteriAdi || !siparisNo) {
                logMsg(`⚠ Satır atlandı — musteri_adi veya siparis_no boş.`, 'warn');
                errored++;
                continue;
            }

            // Müşteri bul (validasyondan geçti, kesinlikle bulunacak)
            const cust = globalCustomers.find(c =>
                c.company_name.toLocaleLowerCase('tr-TR') === musteriAdi.toLocaleLowerCase('tr-TR')
            );
            if (!cust) {
                logMsg(`✗ "${musteriAdi}" — Müşteri bulunamadı (beklenmedik hata), satır atlandı.`, 'err');
                errored++;
                continue;
            }

            // Tarih parse: DD.MM.YYYY → YYYY-MM-DD
            const parseDateTR = (val) => {
                if (!val) return null;
                const s = String(val).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                const parts = s.split('.');
                if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
                return null;
            };

            // status_tags parse
            const tagsRaw   = String(row['status_tags'] || '').trim();
            const statusTags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : ['Devam Ediyor'];

            const totalAmount   = parseFloat(String(row['toplam_tutar'] || '0').replace(',', '.')) || 0;
            const avans         = parseFloat(String(row['avans']        || '0').replace(',', '.')) || 0;
            const kalanBakiye   = totalAmount - avans;

            const payload = {
                user_id:         userId,
                customer_id:     cust.id,
                order_number:    siparisNo,
                order_date:      parseDateTR(row['siparis_tarihi']) || new Date().toISOString().slice(0, 10),
                currency:        String(row['para_birimi'] || 'EUR').trim(),
                total_amount:    totalAmount,
                advance_payment: avans,
                remaining_balance: kalanBakiye,
                idevit_order_no: String(row['idevit_sip_no'] || '').trim() || null,
                ideal_order_no:  String(row['ideal_sip_no']  || '').trim() || null,
                order_type:      String(row['siparis_turu']   || '').trim() || null,
                payment_method:  String(row['odeme_sekli']    || '').trim() || null,
                shipment_date:   parseDateTR(row['sevk_tarihi'])  || null,
                due_date:        parseDateTR(row['vade_tarihi'])   || null,
                order_status:    statusTags[0] || 'Devam Ediyor',
                status_tags:     statusTags,
                order_quantity:  String(row['toplam_adet'] || '').trim() || null,
                order_notes:     String(row['notlar']       || '').trim() || null,
            };

            // Upsert: aynı siparis_no + user_id varsa güncelle
            const { data: existing } = await supabase
                .from('orders')
                .select('id')
                .eq('order_number', siparisNo)
                .eq('user_id', userId)
                .maybeSingle();

            if (existing) {
                const { error } = await supabase.from('orders').update(payload).eq('id', existing.id);
                if (error) { logMsg(`✗ "${siparisNo}" güncellenemedi: ${error.message}`, 'err'); errored++; }
                else { logMsg(`↺ "${siparisNo}" — ${musteriAdi} güncellendi.`, 'warn'); updated++; }
            } else {
                const { error } = await supabase.from('orders').insert([payload]);
                if (error) { logMsg(`✗ "${siparisNo}" eklenemedi: ${error.message}`, 'err'); errored++; }
                else { logMsg(`✓ "${siparisNo}" — ${musteriAdi} eklendi.`, 'ok'); inserted++; }
            }
        }

        logMsg(`─────────────────────────────`, 'ok');
        logMsg(`Tamamlandı: ${inserted} eklendi, ${updated} güncellendi, ${errored} hata.`, inserted > 0 || updated > 0 ? 'ok' : 'warn');

        await fetchOrdersData();

        runBtn.disabled = false;
        runBtn.style.background = '#2D4A3E';
        runBtn.style.color = '#fff';
        runBtn.style.cursor = 'pointer';
        runBtn.innerHTML = '<i class="fa-solid fa-check"></i> Tamamlandı';

    } catch (err) {
        console.error('Import hatası:', err);
        logMsg('Import sırasında hata: ' + err.message, 'err');
        runBtn.disabled = false;
        runBtn.style.background = '#2D4A3E';
        runBtn.style.color = '#fff';
        runBtn.style.cursor = 'pointer';
        runBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Import Başlat';
    }
}

// ── CSV EXPORT ────────────────────────────────────────────────────────────────
function exportOrdersToCSV() {
    if (globalOrders.length === 0) { alert('Aktarılacak sipariş verisi yok.'); return; }
    let csv = 'data:text/csv;charset=utf-8,\uFEFF';
    csv += 'Siparis Tarihi;Siparis No;Idevit Sip No;Ideal Sip No;Siparis Turu;Musteri;Ulke;Para Birimi;Toplam Tutar;Avans;Kalan Bakiye;Odeme Sekli;Durum Etiketleri;Adet;Notlar\n';
    globalOrders.forEach(o => {
        const compName = o.customers?.company_name || '';
        const country  = o.customers?.country || '';
        const tags     = (o.status_tags || [o.order_status || '']).join('|');
        csv += `"${o.order_date}";"${o.order_number||''}";"${o.idevit_order_no||''}";"${o.ideal_order_no||''}";"${o.order_type||''}";"${compName}";"${country}";"${o.currency}";"${o.total_amount}";"${o.advance_payment}";"${o.remaining_balance}";"${o.payment_method||''}";"${tags}";"${o.order_quantity||''}";"${(o.order_notes||'').replace(/"/g,'""')}"\n`;
    });
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `Export_Siparisler_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────
function initEventListeners() {
    document.getElementById('btn-open-order-modal').addEventListener('click', openModalForCreate);
    document.getElementById('btn-close-order-modal').addEventListener('click', closeOrderModal);
    document.getElementById('btn-order-cancel').addEventListener('click', closeOrderModal);
    document.getElementById('order-form').addEventListener('submit', handleOrderSubmit);
    document.getElementById('btn-delete-order').addEventListener('click', handleDeleteOrder);
    document.getElementById('order-search-input').addEventListener('input', applyFilters);
    document.getElementById('filter-order-currency').addEventListener('change', applyFilters);
    document.getElementById('filter-order-status').addEventListener('change', applyFilters);
    document.getElementById('btn-export-orders').addEventListener('click', exportOrdersToCSV);
    document.getElementById('btn-add-item-row').addEventListener('click', addItemRow);
    document.getElementById('tab-general').addEventListener('click', () => switchTab('general'));
    document.getElementById('tab-items').addEventListener('click', () => switchTab('items'));

    // Canlı kalan bakiye hesabı
    ['total_amount', 'advance_payment'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            const remaining = parseTurkishFloat(document.getElementById('total_amount').value)
                - parseTurkishFloat(document.getElementById('advance_payment').value);
            document.getElementById('live-remaining-balance').textContent =
                remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        });
    });

    // Import modal
    document.getElementById('btn-import-excel').addEventListener('click', openImportModal);
    document.getElementById('btn-close-import-modal').addEventListener('click', closeImportModal);
    document.getElementById('btn-import-cancel').addEventListener('click', closeImportModal);
    document.getElementById('btn-import-run').addEventListener('click', handleImportRun);

    // Drop zone
    const dropZone  = document.getElementById('import-drop-zone');
    const fileInput = document.getElementById('import-file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
    });
}

function handleFileSelect(file) {
    const reader = new FileReader();
    reader.onload = e => {
        importFileData = new Uint8Array(e.target.result);
        document.getElementById('import-drop-zone').innerHTML = `
            <i class="fa-solid fa-file-excel" style="font-size:28px;color:#166534;margin-bottom:8px;display:block;"></i>
            <p style="font-size:13px;font-weight:600;color:#1C1A17;margin-bottom:4px;">${escapeHtml(file.name)}</p>
            <p style="font-size:12px;color:#968B7A;">Dosya hazır — "Import Başlat" butonuna tıklayın</p>
        `;
        const runBtn = document.getElementById('btn-import-run');
        runBtn.disabled = false;
        runBtn.style.background = '#2D4A3E';
        runBtn.style.color = '#fff';
        runBtn.style.cursor = 'pointer';
        runBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Import Başlat';
    };
    reader.readAsArrayBuffer(file);
}

// ── YARDIMCI ──────────────────────────────────────────────────────────────────
function parseTurkishFloat(value) {
    if (!value) return 0;
    let clean = value.toString().trim();
    if (clean.includes('.') && clean.includes(',')) clean = clean.replace(/\./g, '').replace(/,/g, '.');
    else if (clean.includes(',')) clean = clean.replace(/,/g, '.');
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
