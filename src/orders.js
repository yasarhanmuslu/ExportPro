// orders.js — V: 1.0.85
import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';

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
    { value: 'Yeni Müşteri',    cls: 'stag-yenimusteri'},
];

// Sol bar rengi — ilk etikete göre
const TAG_PRIORITY = [
    'İptal', 'Gecikme',
    'Teslim Edildi', 'Ödeme Tamamlandı',
    'Bakiye Bekliyor',
    'Sevk Edildi', 'Sevke Hazır',
    'Üretimde', 'Üretime Hazır',
    'Yeni Müşteri', 'Devam Ediyor',
];

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
    'Yeni Müşteri':    '#0ea5e9',
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
    'Yeni Müşteri':    'stag-yenimusteri',
};

let globalOrders   = [];
let globalCustomers = [];
let globalProducts  = [];
let currentOrderId  = null;
let orderItemsBuffer = [];
let ctx = null;

// ── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'orders'))) return;
    await renderNavbar('orders', ctx);
    renderStatusTagCheckboxes();
    await Promise.all([fetchCustomersData(), fetchOrdersData(), fetchProductsData()]);
    initEventListeners();
    applyEditLock(ctx, 'orders');
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
            .select('id, stok_kodu, stok_adi_1, stok_adi_2, renk, fonksiyon_1, fonksiyon_2, fonksiyon_3')
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
        await autoApplyGecikmeTags(globalOrders);
        renderOrdersList(globalOrders);
    } catch (err) {
        console.error('Sipariş verileri yüklenemedi:', err.message);
        document.getElementById('orders-card-list').innerHTML =
            `<div style="text-align:center;color:#9F3D3D;padding:32px;">Veriler çekilirken hata oluştu.</div>`;
    }
}

// Vadesi geçmiş (ve bakiyesi kalan) siparişlere otomatik "Gecikme" etiketi ekler ve DB'ye yazar.
// Sadece ekleme yapar — mevcut etiketleri veya order_status'u değiştirmez, elle kaldırılan/eklenen etiketlere dokunmaz.
async function autoApplyGecikmeTags(orders) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const updates = [];

    orders.forEach(o => {
        const isOverdue = o.due_date
            && parseFloat(o.remaining_balance || 0) > 0
            && new Date(o.due_date + 'T00:00:00') < today;
        if (!isOverdue) return;

        const currentTags = (o.status_tags && o.status_tags.length > 0)
            ? o.status_tags
            : (o.order_status ? [o.order_status] : []);
        if (currentTags.includes('Gecikme')) return;

        const newTags = [...currentTags, 'Gecikme'];
        o.status_tags = newTags;
        updates.push({ id: o.id, status_tags: newTags });
    });

    if (updates.length === 0) return;
    await Promise.all(updates.map(u =>
        supabase.from('orders').update({ status_tags: u.status_tags }).eq('id', u.id)
    ));
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

        const dominantTag = TAG_PRIORITY.find(p => tags.includes(p)) || tags[0];
        const barColor = TAG_BAR_COLOR[dominantTag] || '#94a3b8';

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
            ? `<div class="row-note" data-note="${escapeHtml(noteRaw)}" title="${escapeHtml(noteRaw)}" style="cursor:pointer;"><i class="fa-solid fa-note-sticky" style="font-size:10px;margin-right:4px;opacity:0.6;"></i>${escapeHtml(noteTxt)}</div>`
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

    container.querySelectorAll('.row-note').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            showAlertDialog(el.getAttribute('data-note'), { title: 'Sipariş Notu', variant: 'info' });
        });
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
    if (!canEdit(ctx, 'orders')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const customerId = document.getElementById('order-customer-select').value;
    if (!customerId) { await showAlertDialog('Lütfen bir müşteri / firma seçiniz.', { variant: 'warn', title: 'Eksik Bilgi' }); return; }

    const total_amount     = parseTurkishFloat(document.getElementById('total_amount').value);
    const advance_payment  = parseTurkishFloat(document.getElementById('advance_payment').value);
    const remaining_balance = total_amount - advance_payment;

    if (isNaN(total_amount) || total_amount <= 0) {
        await showAlertDialog('Lütfen geçerli bir toplam sipariş tutarı giriniz.', { variant: 'warn', title: 'Eksik Bilgi' });
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
        const userId = ctx.ownerId;
        let orderId = currentOrderId;

        // ── MÜKERRER NUMARA KONTROLÜ ─────────────────────────────────────────
        const orderNumberVal  = payload.order_number;
        const idevitNumberVal = payload.idevit_order_no;
        const idealNumberVal  = payload.ideal_order_no;
        const customerIdVal   = payload.customer_id || customerId;

        // Düzenleme modunda kendi ID'sini hariç tut
        const excludeId = currentOrderId || null;
        // Tire / boş değerleri gerçek numara sayma
        const isRealNum = val => val && val !== '-' && val !== '—' && String(val).trim() !== '';

        const duplicateErrors = [];

        // Sipariş No: müşteri bazlı unique (composite key)
        if (isRealNum(orderNumberVal) && customerIdVal) {
            let q = supabase.from('orders').select('id').eq('user_id', userId)
                .eq('order_number', orderNumberVal).eq('customer_id', customerIdVal);
            if (excludeId) q = q.neq('id', excludeId);
            const { data: dup } = await q;
            if (dup && dup.length > 0) duplicateErrors.push(`• Sipariş No "${orderNumberVal}" bu müşteri için zaten kayıtlı.`);
        }

        // İdevit No: global unique, tire/boş hariç
        if (isRealNum(idevitNumberVal)) {
            let q = supabase.from('orders').select('id').eq('user_id', userId).eq('idevit_order_no', idevitNumberVal);
            if (excludeId) q = q.neq('id', excludeId);
            const { data: dup } = await q;
            if (dup && dup.length > 0) duplicateErrors.push(`• İdevit Sipariş No "${idevitNumberVal}" zaten kayıtlı.`);
        }

        // İdeal No: global unique, tire/boş hariç
        if (isRealNum(idealNumberVal)) {
            let q = supabase.from('orders').select('id').eq('user_id', userId).eq('ideal_order_no', idealNumberVal);
            if (excludeId) q = q.neq('id', excludeId);
            const { data: dup } = await q;
            if (dup && dup.length > 0) duplicateErrors.push(`• İdeal Sipariş No "${idealNumberVal}" zaten kayıtlı.`);
        }

        if (duplicateErrors.length > 0) {
            await showAlertDialog(
                'Aşağıdaki numara(lar) sistemde zaten mevcut:\n\n' + duplicateErrors.join('\n') + '\n\nLütfen numara(ları) kontrol edip tekrar deneyin.',
                { variant: 'warn', title: 'Mükerrer Numara Uyarısı' }
            );
            return;
        }
        // ─────────────────────────────────────────────────────────────────────

        if (currentOrderId) {
            const { error } = await supabase.from('orders').update(payload).eq('id', currentOrderId).eq('user_id', userId);
            if (error) throw error;
            logChange({ ctx, moduleId: 'orders', action: 'update', summary: `Sipariş güncellendi: ${payload.order_number || orderId}` });
        } else {
            payload.user_id = userId;
            const { data, error } = await supabase.from('orders').insert([payload]).select().single();
            if (error) throw error;
            orderId = data.id;
            logChange({ ctx, moduleId: 'orders', action: 'create', summary: `Sipariş oluşturuldu: ${payload.order_number || orderId}` });
        }

        await saveOrderItems(orderId, userId);
        closeOrderModal();
        await fetchOrdersData();
    } catch (err) {
        console.error('Sipariş kaydedilemedi:', err.message);
        await showAlertDialog('Hata: ' + err.message, { variant: 'danger', title: 'Hata' });
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
    if (!canEdit(ctx, 'orders')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const id = document.getElementById('order-id').value;
    if (!id) return;
    const orderNumber = document.getElementById('order_number')?.value || id;
    const ok = await showConfirmDialog('Bu siparişi kalıcı olarak silmek istediğinize emin misiniz?', {
        title: 'Siparişi Sil', variant: 'danger', confirmText: 'Sil'
    });
    if (!ok) return;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase.from('orders').delete().eq('id', id).eq('user_id', ctx.ownerId);
        if (error) throw error;
        logChange({ ctx, moduleId: 'orders', action: 'delete', summary: `Sipariş silindi: ${orderNumber}` });
        closeOrderModal();
        await fetchOrdersData();
    } catch (err) {
        console.error('Sipariş silinemedi:', err.message);
        if (err.code === '23503') {
            await showAlertDialog('Bu sipariş silinemez!\nBağlı credit note veya kalem kaydı var.\nÖnce ilgili kayıtları siliniz.', { variant: 'danger', title: 'Silinemedi' });
        } else {
            await showAlertDialog('Silme başarısız: ' + err.message, { variant: 'danger', title: 'Hata' });
        }
    }
}

// ── FİLTRELEME ───────────────────────────────────────────────────────────────
function applyFilters() {
    const search        = document.getElementById('order-search-input').value.toLocaleLowerCase('tr-TR');
    const currency      = document.getElementById('filter-order-currency').value;
    const statusFilter  = document.getElementById('filter-order-status').value;
    const shipMonthFilter = document.getElementById('filter-shipment-month').value;
    const sortShipDate  = document.getElementById('sort-shipment-date').value; // '', 'asc', 'desc'

    let filtered = globalOrders.filter(o => {
        const compName   = (o.customers?.company_name || '').toLocaleLowerCase('tr-TR');
        const orderNo    = (o.order_number || '').toLocaleLowerCase('tr-TR');
        const idevitNo   = (o.idevit_order_no || '').toLocaleLowerCase('tr-TR');
        const idealNo    = (o.ideal_order_no || '').toLocaleLowerCase('tr-TR');
        const matchSearch   = compName.includes(search) || orderNo.includes(search)
            || idevitNo.includes(search) || idealNo.includes(search);
        const matchCurrency = !currency || o.currency === currency;
        const tags = (o.status_tags && o.status_tags.length > 0) ? o.status_tags : [o.order_status || ''];
        const matchStatus   = !statusFilter || tags.includes(statusFilter);

        // Sevk ayı filtresi: shipment_date'in ayı ile karşılaştır
        let matchShipMonth = true;
        if (shipMonthFilter) {
            if (!o.shipment_date) {
                matchShipMonth = false;
            } else {
                const month = o.shipment_date.slice(5, 7); // YYYY-MM-DD → MM
                matchShipMonth = month === shipMonthFilter;
            }
        }

        return matchSearch && matchCurrency && matchStatus && matchShipMonth;
    });

    // Sevk Tarihine göre sıralama (Excel mantığı — tarihi olmayanlar her zaman en sona)
    if (sortShipDate) {
        filtered = filtered.slice().sort((a, b) => {
            if (!a.shipment_date && !b.shipment_date) return 0;
            if (!a.shipment_date) return 1;
            if (!b.shipment_date) return -1;
            return sortShipDate === 'asc'
                ? a.shipment_date.localeCompare(b.shipment_date)
                : b.shipment_date.localeCompare(a.shipment_date);
        });
    }

    renderOrdersList(filtered);
}

// ── KALEM TABLOSU ─────────────────────────────────────────────────────────────

// Ürünün fonksiyon_1/2/3 alanlarından, müşteriye gönderilen proformalarda kullanılan
// sadeleştirilmiş Türkçe "Fonksiyon" etiketini bulur (hangi fonksiyon slotunda olduğuna bakmaksızın).
const FONKSIYON_LABEL_RULES = [
    { values: ['kanalsız delikli', 'kanallı delikli'], label: 'Taharet Delikli' },
    { values: ['kanalsız deliksiz', 'kanallı deliksiz'], label: 'Taharet Deliksiz' },
    { values: ['delikli', 'sağdan delikli', 'soldan delikli'], label: 'Armatür Delikli' },
    { values: ['deliksiz'], label: 'Armatür Deliksiz' },
];

function resolveFonksiyonLabel(product) {
    if (!product) return '';
    const fields = [product.fonksiyon_1, product.fonksiyon_2, product.fonksiyon_3];
    for (const raw of fields) {
        if (!raw) continue;
        const norm = raw.trim().toLocaleLowerCase('tr-TR');
        const rule = FONKSIYON_LABEL_RULES.find(r => r.values.includes(norm));
        if (rule) return rule.label;
    }
    return '';
}

function currentOrderCurrencySymbol() {
    const sym = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
    const code = document.getElementById('currency')?.value || 'EUR';
    return sym[code] || code;
}

function updateItemsColumnHeaders() {
    const s = currentOrderCurrencySymbol();
    const priceTh  = document.getElementById('th-unit-price');
    const amountTh = document.getElementById('th-amount');
    if (priceTh)  priceTh.textContent  = `Birim Fiyat (${s})`;
    if (amountTh) amountTh.textContent = `Tutar (${s})`;
}

function renderItemsTable() {
    const tbody = document.getElementById('items-table-body');
    tbody.innerHTML = '';
    updateItemsColumnHeaders();

    if (orderItemsBuffer.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#968B7A;padding:24px;font-size:13px;">Henüz sipariş kalemi eklenmedi. "Satır Ekle" butonunu kullanın.</td></tr>`;
        updateItemsTotal();
        return;
    }

    orderItemsBuffer.forEach((item, idx) => {
        const product   = item.product_id ? globalProducts.find(p => p.id === item.product_id) : null;
        const isSelected = !!item.product_id;
        const renk      = product?.renk || '';
        const fonksiyon = resolveFonksiyonLabel(product);

        const productCell = isSelected
            ? `<div style="display:flex;align-items:flex-start;gap:6px;border:1px solid #E4DDCE;border-radius:6px;padding:6px 8px;background:#F6F3EC;min-height:34px;">
                   <div style="flex:1;font-size:12px;line-height:1.35;color:#1C1A17;">${escapeHtml(item.product_name || '')}</div>
                   <button type="button" class="item-clear-btn" data-idx="${idx}" title="Ürünü kaldır / değiştir" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:#968B7A;font-size:11px;padding:2px;">
                       <i class="fa-solid fa-xmark"></i>
                   </button>
               </div>
               <input type="text" class="item-search hidden" data-idx="${idx}" autocomplete="off" value="">`
            : `<input type="text" class="item-search" data-idx="${idx}" autocomplete="off" placeholder="Ürün ara (kod / TR / EN) veya serbest metin" value="${escapeHtml(item.product_name || '')}" style="height:34px;font-size:12px;">`;

        const tr = document.createElement('tr');
        tr.dataset.idx = idx;
        tr.innerHTML = `
            <td style="position:relative;">
                ${productCell}
                <div class="ac-dropdown hidden" data-idx="${idx}"
                    style="position:absolute;top:100%;left:0;right:0;z-index:60;max-height:220px;overflow-y:auto;
                           background:#fff;border:1px solid #E4DDCE;border-radius:6px;margin-top:2px;box-shadow:0 4px 16px rgba(0,0,0,.12);"></div>
            </td>
            <td style="width:230px;">
                <input type="text" class="item-product-code" data-idx="${idx}" value="${escapeHtml(item.product_code || '')}" placeholder="Ürün kodu" style="height:34px;font-size:11.5px;white-space:nowrap;">
            </td>
            <td style="width:70px;">
                <div style="height:34px;display:flex;align-items:center;font-size:12px;color:#6B655B;">${escapeHtml(renk) || '&mdash;'}</div>
            </td>
            <td style="width:135px;">
                <div style="height:34px;display:flex;align-items:center;font-size:12px;color:#6B655B;">${escapeHtml(fonksiyon) || '&mdash;'}</div>
            </td>
            <td style="width:100px;">
                <input type="number" class="item-quantity" data-idx="${idx}" value="${item.quantity || ''}" placeholder="0" step="any" style="height:34px;font-size:12px;text-align:right;padding:0 6px;">
            </td>
            <td style="width:100px;">
                <input type="number" class="item-unit-price" data-idx="${idx}" value="${item.unit_price || ''}" placeholder="0.00" step="any" style="height:34px;font-size:12px;text-align:right;padding:0 6px;">
            </td>
            <td style="text-align:right;font-weight:600;font-size:13px;color:#2D4A3E;width:95px;" class="item-amount" data-idx="${idx}">
                ${calcAmount(item.quantity, item.unit_price)}
            </td>
            <td style="text-align:center;width:40px;">
                <button class="btn-remove-item" data-idx="${idx}" style="background:none;border:none;cursor:pointer;color:#9F3D3D;font-size:13px;padding:4px 8px;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // ── Ürün autocomplete — sadece görünür arama input'larına bağla ──
    tbody.querySelectorAll('.item-search').forEach(inp => {
        if (inp.classList.contains('hidden')) return;

        const idx = parseInt(inp.dataset.idx);
        const dd  = tbody.querySelector(`.ac-dropdown[data-idx="${idx}"]`);
        let debounce = null;

        inp.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                const q = inp.value.toLocaleLowerCase('tr-TR').trim();
                if (q.length < 1) { dd.classList.add('hidden'); return; }

                const matches = globalProducts.filter(p => {
                    const hay = [p.stok_kodu || '', p.stok_adi_1 || '', p.stok_adi_2 || '']
                        .join(' ').toLocaleLowerCase('tr-TR');
                    return q.split(/\s+/).every(w => hay.includes(w));
                }).slice(0, 30);

                dd.innerHTML = matches.length === 0
                    ? `<div style="padding:8px 10px;font-size:11px;color:#968B7A;">Sonuç yok</div>`
                    : matches.map(p => `
                        <div class="ac-option" data-pid="${p.id}" style="padding:7px 10px;cursor:pointer;border-bottom:1px solid #F0EDE4;">
                            <div style="font-size:11px;font-weight:600;color:#1C1A17;">${escapeHtml(p.stok_adi_1)}</div>
                            ${p.stok_adi_2 ? `<div style="font-size:10px;color:#6B655B;">${escapeHtml(p.stok_adi_2)}</div>` : ''}
                            <div style="font-size:10px;color:#968B7A;margin-top:2px;">${escapeHtml(p.stok_kodu || '')}${p.renk ? ' &middot; ' + escapeHtml(p.renk) : ''}</div>
                        </div>`).join('');
                dd.classList.remove('hidden');

                dd.querySelectorAll('.ac-option').forEach(opt => {
                    opt.addEventListener('mouseenter', () => opt.style.background = '#F6F3EC');
                    opt.addEventListener('mouseleave', () => opt.style.background = '');
                    opt.addEventListener('mousedown', e => {
                        e.preventDefault();
                        const prod = globalProducts.find(p => p.id === opt.dataset.pid);
                        if (!prod) return;
                        orderItemsBuffer[idx].product_id   = prod.id;
                        orderItemsBuffer[idx].product_name = prod.stok_adi_1;
                        orderItemsBuffer[idx].product_code = prod.stok_kodu || '';
                        renderItemsTable();
                    });
                });
            }, 120);
        });

        inp.addEventListener('blur', () => setTimeout(() => dd.classList.add('hidden'), 150));
        inp.addEventListener('focus', () => { if (inp.value.length >= 1) inp.dispatchEvent(new Event('input')); });
        inp.addEventListener('change', () => {
            if (!orderItemsBuffer[idx].product_id) orderItemsBuffer[idx].product_name = inp.value.trim();
        });
    });

    tbody.querySelectorAll('.item-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            orderItemsBuffer[idx].product_id   = null;
            orderItemsBuffer[idx].product_name = '';
            orderItemsBuffer[idx].product_code = '';
            renderItemsTable();
            const inp = tbody.querySelector(`.item-search[data-idx="${idx}"]:not(.hidden)`);
            if (inp) inp.focus();
        });
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

    const qtyTotal = orderItemsBuffer.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);
    document.getElementById('items-qty-total').textContent = qtyTotal.toLocaleString('tr-TR');

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
    if (!canEdit(ctx, 'orders')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const runBtn = document.getElementById('btn-import-run');
    runBtn.disabled = true;
    runBtn.textContent = 'İşleniyor...';

    document.getElementById('import-log').innerHTML = '';
    document.getElementById('import-log-wrap').classList.remove('hidden');

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = ctx.ownerId;

        // XLSX parse
        const XLSX = window.XLSX;
        if (!XLSX) { logMsg('XLSX kütüphanesi yüklenemedi.', 'err'); return; }

        const wb = XLSX.read(importFileData, { type: 'array' });

        // "Siparisler" adlı sheet'i ara, yoksa ilk sheet'i kullan
        const targetSheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'siparisler')
            || wb.SheetNames[0];
        logMsg(`📋 Okunan sheet: "${targetSheetName}" (toplam ${wb.SheetNames.length} sheet)`, 'ok');

        const ws   = wb.Sheets[targetSheetName];
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

            // Tarih parse: DD.MM.YYYY veya Excel serial number → YYYY-MM-DD
            const parseDateTR = (val) => {
                if (!val) return null;
                const s = String(val).trim();
                // YYYY-MM-DD formatı — doğrudan kullan
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                // DD.MM.YYYY formatı
                const parts = s.split('.');
                if (parts.length === 3 && parts[2].length === 4) {
                    return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
                }
                // Excel serial number (sayısal): XLSX.js bazen DD.MM.YYYY yerine bunu verir
                const num = parseFloat(s);
                if (!isNaN(num) && num > 1000 && num < 100000) {
                    // Excel epoch: 1900-01-01 = 1, ancak Excel'in hatalı artık yıl düzeltmesi için -1
                    const excelEpoch = new Date(1899, 11, 30);
                    const date = new Date(excelEpoch.getTime() + num * 86400000);
                    if (!isNaN(date.getTime())) {
                        return date.toISOString().slice(0, 10);
                    }
                }
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

            // Upsert: aynı siparis_no + customer_id + user_id varsa güncelle
            // (siparis_no her müşteri için bağımsız sequence — composite key şart)
            const { data: existing } = await supabase
                .from('orders')
                .select('id')
                .eq('order_number', siparisNo)
                .eq('customer_id', cust.id)
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
        logChange({ ctx, moduleId: 'orders', action: 'update', summary: `Toplu içe aktarma${clearFirst ? ' (önce temizlendi)' : ''}: ${inserted} eklendi, ${updated} güncellendi, ${errored} hata` });

        await fetchOrdersData();

        runBtn.disabled = false;
        runBtn.style.background = '#2D4A3E';
        runBtn.style.color = '#fff';
        runBtn.style.cursor = 'pointer';
        runBtn.innerHTML = '<i class="fa-solid fa-check"></i> Tamamlandı — Kapat';
        // Import bitti — butonu yeniden çalıştırma yerine modalı kapat
        runBtn.replaceWith(runBtn.cloneNode(true)); // eski event listener'ı temizle
        document.getElementById('btn-import-run').addEventListener('click', closeImportModal);

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

// ── EXCEL EXPORT ──────────────────────────────────────────────────────────────
const EXPORT_STATUS_COLORS = {
    'İptal':             { bg: 'FECACA', fg: '991B1B' },
    'Gecikme':           { bg: 'FECACA', fg: '991B1B' },
    'Bakiye Bekliyor':   { bg: 'FEF08A', fg: '854D0E' },
    'Sevke Hazır':       { bg: 'BFDBFE', fg: '1E40AF' },
    'Sevk Edildi':       { bg: 'BFDBFE', fg: '1E40AF' },
    'Üretimde':          { bg: 'E9D5FF', fg: '6B21A8' },
    'Üretime Hazır':     { bg: 'DDD6FE', fg: '5B21B6' },
    'Ödeme Tamamlandı':  { bg: 'BBF7D0', fg: '166534' },
    'Teslim Edildi':     { bg: 'BBF7D0', fg: '166534' },
    'Yeni Müşteri':      { bg: 'E0F2FE', fg: '0369A1' },
    'Devam Ediyor':      { bg: 'E2E8F0', fg: '475569' },
};
const EXPORT_STATUS_PRIORITY = ['İptal', 'Gecikme', 'Bakiye Bekliyor', 'Sevke Hazır', 'Sevk Edildi', 'Üretimde', 'Üretime Hazır', 'Ödeme Tamamlandı', 'Teslim Edildi', 'Yeni Müşteri', 'Devam Ediyor'];

function pickExportStatusColor(tags) {
    for (const key of EXPORT_STATUS_PRIORITY) { if (tags.includes(key)) return EXPORT_STATUS_COLORS[key]; }
    return EXPORT_STATUS_COLORS['Devam Ediyor'];
}

async function exportOrdersToExcel() {
    if (globalOrders.length === 0) { await showAlertDialog('Aktarılacak sipariş verisi yok.', { variant: 'warn', title: 'Uyarı' }); return; }
    const XLSX = window.XLSX;
    if (!XLSX) { await showAlertDialog('XLSX kütüphanesi yüklenemedi.', { variant: 'err', title: 'Hata' }); return; }
    const HEADER_BG  = '2D4A3E';
    const HEADER_FG  = 'FFFFFF';
    const SUBHDR_BG  = '5C7A6B';
    const BORDER_RGB = 'D9D2C2';
    const ZEBRA_BG   = 'F6F3EC';

    const HEADERS = ['Sipari\u015F Tarihi', 'Sipari\u015F No', '\u0130devit Sip No', '\u0130deal Sip No', 'Sipari\u015F T\u00FCr\u00FC', 'M\u00FC\u015Fteri', '\u00DClke', 'Para Birimi', 'Toplam Tutar', 'Avans', 'Kalan Bakiye', 'Sevk Tarihi', 'Vade Tarihi', '\u00D6deme \u015Eekli', 'Durum', 'Adet', 'Notlar'];
    const COL_COUNT = HEADERS.length;
    const toDate = s => s ? new Date(s + 'T00:00:00') : null;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Para birimine g\u00F6re \u00F6zet
    const summary = {};
    globalOrders.forEach(o => {
        const cur = o.currency || '\u2014';
        if (!summary[cur]) summary[cur] = { count: 0, total: 0, remaining: 0 };
        summary[cur].count++;
        summary[cur].total     += parseFloat(o.total_amount) || 0;
        summary[cur].remaining += parseFloat(o.remaining_balance) || 0;
    });
    const currencies = Object.keys(summary).sort();

    const aoa = [];
    aoa.push(['EXPORT SUITE \u2014 S\u0130PAR\u0130\u015E L\u0130STES\u0130']);
    aoa.push([`Olu\u015Fturma Tarihi: ${new Date().toLocaleDateString('tr-TR')}   \u2022   Toplam Kay\u0131t: ${globalOrders.length}`]);
    aoa.push([]);
    aoa.push(['\u00D6ZET (Para Birimine G\u00F6re)']);
    const summaryHeaderRow = aoa.length;
    aoa.push(['Para Birimi', 'Sipari\u015F Say\u0131s\u0131', 'Toplam Tutar', 'Kalan Bakiye']);
    currencies.forEach(cur => aoa.push([cur, summary[cur].count, summary[cur].total, summary[cur].remaining]));
    aoa.push([]);
    const tableHeaderRow = aoa.length;
    aoa.push(HEADERS);
    const dataStartRow = aoa.length;

    globalOrders.forEach(o => {
        const compName = o.customers?.company_name || '';
        const country  = o.customers?.country || '';
        const tags     = (o.status_tags && o.status_tags.length > 0) ? o.status_tags : [o.order_status || ''];
        const qty      = parseFloat(o.order_quantity);
        aoa.push([
            toDate(o.order_date),
            o.order_number || '',
            o.idevit_order_no || '',
            o.ideal_order_no || '',
            o.order_type || '',
            compName,
            country,
            o.currency || '',
            parseFloat(o.total_amount) || 0,
            parseFloat(o.advance_payment) || 0,
            parseFloat(o.remaining_balance) || 0,
            toDate(o.shipment_date),
            toDate(o.due_date),
            o.payment_method || '',
            tags.join(', '),
            Number.isFinite(qty) ? qty : (o.order_quantity || ''),
            o.order_notes || '',
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: COL_COUNT - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: COL_COUNT - 1 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: COL_COUNT - 1 } },
    ];
    ws['!cols'] = [
        { wch: 13 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 13 },
        { wch: 24 }, { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 12 },
        { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 28 }, { wch: 9 }, { wch: 36 },
    ];
    ws['!rows'] = [];
    ws['!rows'][0] = { hpt: 26 };
    ws['!rows'][tableHeaderRow] = { hpt: 22 };
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: tableHeaderRow, c: 0 }, e: { r: dataStartRow + globalOrders.length - 1, c: COL_COUNT - 1 } }) };

    const setStyle = (r, c, style) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!ws[ref]) ws[ref] = { t: 's', v: '' };
        ws[ref].s = style;
        if (style.numFmt) ws[ref].z = style.numFmt;
    };
    const thin = { style: 'thin', color: { rgb: BORDER_RGB } };
    const fullBorder = { top: thin, bottom: thin, left: thin, right: thin };

    setStyle(0, 0, { font: { bold: true, sz: 16, color: { rgb: HEADER_FG } }, fill: { patternType: 'solid', fgColor: { rgb: HEADER_BG } }, alignment: { horizontal: 'center', vertical: 'center' } });
    setStyle(1, 0, { font: { italic: true, sz: 10, color: { rgb: '6B6656' } }, alignment: { horizontal: 'center' } });
    setStyle(3, 0, { font: { bold: true, sz: 11, color: { rgb: HEADER_BG } } });

    for (let c = 0; c < 4; c++) {
        setStyle(summaryHeaderRow, c, { font: { bold: true, color: { rgb: HEADER_FG } }, fill: { patternType: 'solid', fgColor: { rgb: SUBHDR_BG } }, border: fullBorder, alignment: { horizontal: 'center' } });
    }
    currencies.forEach((cur, i) => {
        const r = summaryHeaderRow + 1 + i;
        for (let c = 0; c < 4; c++) {
            const style = { border: fullBorder, alignment: { horizontal: c === 0 ? 'center' : 'right' }, font: { sz: 10 } };
            if (c >= 2) style.numFmt = '#,##0.00';
            setStyle(r, c, style);
        }
    });

    for (let c = 0; c < COL_COUNT; c++) {
        setStyle(tableHeaderRow, c, { font: { bold: true, sz: 10, color: { rgb: HEADER_FG } }, fill: { patternType: 'solid', fgColor: { rgb: HEADER_BG } }, border: fullBorder, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } });
    }

    const dateCols  = [0, 11, 12];
    const moneyCols = [8, 9, 10];
    globalOrders.forEach((o, idx) => {
        const r         = dataStartRow + idx;
        const tags      = (o.status_tags && o.status_tags.length > 0) ? o.status_tags : [o.order_status || ''];
        const zebra     = idx % 2 === 1 ? ZEBRA_BG : 'FFFFFF';
        const stColor   = pickExportStatusColor(tags);
        const isOverdue = o.due_date && parseFloat(o.remaining_balance || 0) > 0 && new Date(o.due_date + 'T00:00:00') < today;

        for (let c = 0; c < COL_COUNT; c++) {
            const style = {
                border: fullBorder,
                fill: { patternType: 'solid', fgColor: { rgb: zebra } },
                font: { sz: 10 },
                alignment: { vertical: 'center', wrapText: c === 16 },
            };
            if (dateCols.includes(c))  { style.numFmt = 'dd.mm.yyyy'; style.alignment.horizontal = 'center'; }
            if (moneyCols.includes(c)) { style.numFmt = '#,##0.00'; style.alignment.horizontal = 'right'; }
            if (c === 15) { style.numFmt = '#,##0'; style.alignment.horizontal = 'right'; }
            if (c === 7)  { style.alignment.horizontal = 'center'; }
            if (c === 12 && isOverdue) { style.font = { sz: 10, bold: true, color: { rgb: '991B1B' } }; }
            if (c === 14) {
                style.fill = { patternType: 'solid', fgColor: { rgb: stColor.bg } };
                style.font = { sz: 10, bold: true, color: { rgb: stColor.fg } };
                style.alignment.horizontal = 'center';
            }
            setStyle(r, c, style);
        }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sipari\u015Fler');
    XLSX.writeFile(wb, `Export_Siparisler_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
    document.getElementById('btn-export-orders').addEventListener('click', exportOrdersToExcel);
    document.getElementById('filter-shipment-month').addEventListener('change', applyFilters);
    document.getElementById('sort-shipment-date').addEventListener('change', applyFilters);
    document.getElementById('btn-add-item-row').addEventListener('click', addItemRow);
    document.getElementById('currency').addEventListener('change', updateItemsColumnHeaders);
    document.getElementById('tab-general').addEventListener('click', () => switchTab('general'));
    document.getElementById('tab-items').addEventListener('click', () => switchTab('items'));

    // PDF'den kalem içe aktarma
    const pdfItemInput = document.getElementById('pdf-item-import-input');
    document.getElementById('btn-import-pdf-items').addEventListener('click', () => pdfItemInput.click());
    pdfItemInput.addEventListener('change', () => {
        if (pdfItemInput.files[0]) handlePdfItemFileSelect(pdfItemInput.files[0]);
        pdfItemInput.value = '';
    });

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

// ── PDF'DEN KALEM İÇE AKTARMA ────────────────────────────────────────────────
// Proforma fatura PDF'inden PI NO, PI DATE, genel toplam ve ürün kalemlerini (kod/adet/net fiyat) okur.
// Büyük x-boşlukları (aynı satırdaki farklı tablo sütunları) '\t' ile ayrılır; normal kelime
// boşlukları tek boşluk olarak korunur. '\t' de bir \s karakteri olduğundan mevcut regex'leri bozmaz.
function reconstructPdfLines(items) {
    const tolY = 2;
    const colGapThreshold = 20;
    const rows = new Map();
    for (const item of items) {
        const y = item.transform[5];
        let key = null;
        for (const k of rows.keys()) {
            if (Math.abs(k - y) <= tolY) { key = k; break; }
        }
        if (key === null) key = y;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(item);
    }
    const sortedKeys = Array.from(rows.keys()).sort((a, b) => b - a);
    const lines = [];
    for (const k of sortedKeys) {
        const rowItems = rows.get(k).slice().sort((a, b) => a.transform[4] - b.transform[4]);
        let line = '';
        let lastEndX = null;
        for (const it of rowItems) {
            const x = it.transform[4];
            if (lastEndX !== null) {
                const gap = x - lastEndX;
                if (gap > colGapThreshold) line += '\t';
                else if (gap > 1) line += ' ';
            }
            line += it.str;
            lastEndX = x + (it.width || 0);
        }
        lines.push(line.trim());
    }
    return lines.join('\n');
}

// Genel toplam satırını bulur — örn: "EX-WORKS / ISTANBUL : 5.086,80 EUR".
// Etiket (Incoterm) sabit kodlanmaz: önce "DELIVERY TERMS :" (İngilizce) veya "TESLİM ŞEKLİ :" (Türkçe)
// değeri okunur (örn. "EX-WORKS / ISTANBUL"), sonra aynı metnin ": <tutar> <para birimi>" ile tekrar
// geçtiği hücre aranır (bu, teslim şekli ne olursa olsun çalışır).
function extractTotalAmount(fullText) {
    const termMatch =
        fullText.match(/DE+LIVERY\s*TERMS\s*:\s*([^\t\n]+?)\s*(?:\t|\n|$)/i) ||
        fullText.match(/TESL[İIiı]M\s*ŞEKL[İIiı]\s*:\s*([^\t\n]+?)\s*(?:\t|\n|$)/i);
    if (!termMatch) return null;
    const term = termMatch[1].trim();
    if (!term) return null;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const totalRe = new RegExp(escaped + '\\s*:\\s*([\\d.,]+)\\s*([A-Z]{2,3})?', 'i');
    const totalMatch = fullText.match(totalRe);
    if (!totalMatch) return null;
    return { amount: parseTurkishFloat(totalMatch[1]), currency: totalMatch[2] || null };
}

// Satır formatı: <...> <ÜRÜN KODU> <AÇIKLAMA> <ADET> pcs./ad./adet <PALET (opsiyonel)> <NET FİYAT><para birimi> <TUTAR><para birimi>
// Palet sütunu her proforma şablonunda yok (bazı siparişler paletsiz) — bu yüzden opsiyonel.
// Değeri (tam sayı ya da "2,0" gibi ondalık) hiç kullanılmıyor, sadece atlanıyor: bu modülde palet hesabı kapsam dışı.
const PDF_ITEM_LINE_RE = /((?:[A-Za-z0-9]+\s*-\s*){2,}[A-Za-z0-9]+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:pcs|ad|adet)\.?\s+(?:\d+(?:[.,]\d+)?\s+)?([\d.,]+)\s*\S{0,2}\s+([\d.,]+)\s*\S{0,2}\s*$/gim;

function parsePdfProformaText(fullText) {
    const piNoMatch   = fullText.match(/PI\s*NO\s*:?\s*([0-9]{2,4}-[0-9]{1,4})/i);
    const piDateMatch = fullText.match(/PI\s*DATE\s*:?\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})/i);
    const total       = extractTotalAmount(fullText);

    const items = [];
    let m;
    PDF_ITEM_LINE_RE.lastIndex = 0;
    while ((m = PDF_ITEM_LINE_RE.exec(fullText)) !== null) {
        items.push({
            code: m[1].replace(/\s+/g, ''),
            description: m[2].trim(),
            quantity: parseTurkishFloat(m[3]),
            netPrice: parseTurkishFloat(m[4]),
            amount: parseTurkishFloat(m[5]),
        });
    }

    return {
        piNo: piNoMatch ? piNoMatch[1] : null,
        piDate: piDateMatch ? piDateToIso(piDateMatch[1]) : null,
        totalAmount: total ? total.amount : null,
        totalCurrency: total ? total.currency : null,
        items,
    };
}

function piDateToIso(str) {
    const parts = str.split('.');
    if (parts.length !== 3) return null;
    let [d, mo, y] = parts;
    if (y.length === 2) y = '20' + y;
    d = d.padStart(2, '0');
    mo = mo.padStart(2, '0');
    return `${y}-${mo}-${d}`;
}

async function handlePdfItemFileSelect(file) {
    if (!window.pdfjsLib) {
        await showAlertDialog('PDF kütüphanesi yüklenemedi. Sayfayı yenileyip tekrar deneyin.', { variant: 'danger', title: 'Hata' });
        return;
    }
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            fullText += reconstructPdfLines(content.items) + '\n';
        }

        const { piNo, piDate, totalAmount, items } = parsePdfProformaText(fullText);

        if (items.length === 0) {
            await showAlertDialog('PDF içinde ürün kalemi satırı bulunamadı. Dosya formatını kontrol edin.', { variant: 'warn', title: 'Kalem Bulunamadı' });
            return;
        }

        // Ürün kodu eşleştirme — sistemde kayıtlı olmayan kod varsa import tamamen durdurulur.
        const matched   = [];
        const unmatched = [];
        for (const it of items) {
            const prod = globalProducts.find(p =>
                (p.stok_kodu || '').trim().toLocaleUpperCase('tr-TR') === it.code.toLocaleUpperCase('tr-TR')
            );
            if (prod) matched.push({ ...it, product: prod });
            else unmatched.push(it);
        }

        if (unmatched.length > 0) {
            const list = unmatched.map(u => `• ${u.code} — ${u.description}`).join('\n');
            await showAlertDialog(
                `Aşağıdaki ürün kodları sistemde (Ürün Kartları) kayıtlı değil:\n\n${list}\n\nİçe aktarma durduruldu. Lütfen önce "Ürünler" sayfasından bu ürün kartlarını oluşturun, ardından tekrar deneyin.`,
                { variant: 'danger', title: 'Eşleşmeyen Ürün Kodları' }
            );
            return;
        }

        if (orderItemsBuffer.length > 0) {
            const ok = await showConfirmDialog(
                'Kalem tablosunda zaten satırlar var. PDF içe aktarma, mevcut tüm kalem satırlarının yerine PDF\'deki satırları koyacak. Devam edilsin mi?',
                { title: 'Mevcut Kalemler Değiştirilecek', variant: 'warn', confirmText: 'Değiştir ve Devam Et' }
            );
            if (!ok) return;
        }

        // Sipariş No / Sipariş Tarihi alanlarını doldur (mevcut değer varsa onay iste)
        const orderNoInput   = document.getElementById('order_number');
        const orderDateInput = document.getElementById('order_date');

        if (piNo) {
            if (orderNoInput.value && orderNoInput.value !== piNo) {
                const ok = await showConfirmDialog(
                    `Sipariş No alanı zaten "${orderNoInput.value}" olarak dolu. PDF'deki PI NO değeri "${piNo}" ile değiştirilsin mi?`,
                    { title: 'Sipariş No Çakışması', variant: 'warn', confirmText: 'Değiştir' }
                );
                if (ok) orderNoInput.value = piNo;
            } else {
                orderNoInput.value = piNo;
            }
        }
        if (piDate) {
            if (orderDateInput.value && orderDateInput.value !== piDate) {
                const ok = await showConfirmDialog(
                    `Sipariş Tarihi alanı zaten dolu. PDF'deki PI DATE değeri ile değiştirilsin mi?`,
                    { title: 'Sipariş Tarihi Çakışması', variant: 'warn', confirmText: 'Değiştir' }
                );
                if (ok) orderDateInput.value = piDate;
            } else {
                orderDateInput.value = piDate;
            }
        }

        // Toplam Tutar alanını doldur (mevcut değer varsa onay iste)
        if (totalAmount !== null) {
            const totalAmountInput = document.getElementById('total_amount');
            const formattedTotal   = totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
            const currentTotal     = parseTurkishFloat(totalAmountInput.value);
            let applyTotal = true;
            if (totalAmountInput.value && Math.abs(currentTotal - totalAmount) > 0.01) {
                applyTotal = await showConfirmDialog(
                    `Toplam Tutar alanı zaten "${totalAmountInput.value}" olarak dolu. PDF'deki genel toplam "${formattedTotal}" ile değiştirilsin mi?`,
                    { title: 'Toplam Tutar Çakışması', variant: 'warn', confirmText: 'Değiştir' }
                );
            }
            if (applyTotal) {
                totalAmountInput.value = formattedTotal;
                const remaining = totalAmount - parseTurkishFloat(document.getElementById('advance_payment').value);
                document.getElementById('live-remaining-balance').textContent = remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
            }
        }

        // Adet / Miktar alanını doldur (kalemlerin adet toplamı — mevcut değer varsa onay iste)
        const totalQuantity = items.reduce((s, it) => s + (parseFloat(it.quantity) || 0), 0);
        if (totalQuantity > 0) {
            const quantityInput = document.getElementById('order_quantity');
            const formattedQuantity = totalQuantity.toLocaleString('tr-TR');
            let applyQuantity = true;
            if (quantityInput.value && quantityInput.value !== formattedQuantity) {
                applyQuantity = await showConfirmDialog(
                    `Adet / Miktar alanı zaten "${quantityInput.value}" olarak dolu. PDF'deki kalemlerin adet toplamı "${formattedQuantity}" ile değiştirilsin mi?`,
                    { title: 'Adet / Miktar Çakışması', variant: 'warn', confirmText: 'Değiştir' }
                );
            }
            if (applyQuantity) {
                quantityInput.value = formattedQuantity;
            }
        }

        // Kalem tablosunu PDF'deki kalemlerle değiştir
        orderItemsBuffer = matched.map(it => ({
            id: null,
            product_id: it.product.id,
            product_name: it.product.stok_adi_1,
            product_code: it.product.stok_kodu,
            quantity: it.quantity,
            unit_price: it.netPrice,
            notes: null,
        }));

        switchTab('items');

        // Adet x Net Fiyat ile PDF'deki AMOUNT tutarı uyuşmuyorsa uyar (parsing kontrolü)
        const mismatches = matched.filter(it => Math.abs(it.quantity * it.netPrice - it.amount) > 0.05);
        if (mismatches.length > 0) {
            const list = mismatches.map(u => `• ${u.code}: ${u.quantity} x ${u.netPrice} ≠ ${u.amount}`).join('\n');
            await showAlertDialog(
                `${matched.length} kalem içe aktarıldı, ancak şu satırlarda Adet x Net Fiyat, PDF'deki AMOUNT ile uyuşmuyor — lütfen kontrol edin:\n\n${list}`,
                { variant: 'warn', title: 'Kontrol Gerekli' }
            );
        } else {
            await showAlertDialog(`${matched.length} ürün kalemi PDF'den başarıyla içe aktarıldı.`, { variant: 'success', title: 'İçe Aktarma Tamamlandı' });
        }
    } catch (err) {
        console.error('PDF kalem import hatası:', err.message);
        await showAlertDialog('PDF işlenirken hata oluştu: ' + err.message, { variant: 'danger', title: 'Hata' });
    }
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
