import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

let globalOrders = [];
let globalCustomers = [];
let globalProducts = [];
let currentOrderId = null;
let orderItemsBuffer = []; // Düzenleme sırasındaki kalem buffer'ı

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    await renderNavbar('orders');
    await Promise.all([fetchCustomersData(), fetchOrdersData(), fetchProductsData()]);
    initOrderEventListeners();
});

// --- VERİ ÇEKME ---
async function fetchCustomersData() {
    try {
        const { data: customers, error } = await supabase
            .from('customers')
            .select('id, company_name, country, status')
            .eq('status', 'Aktif')
            .order('company_name', { ascending: true });
        if (error) throw error;
        globalCustomers = customers;
        initCustomerSearchDropdown(customers);
    } catch (err) {
        console.error("Müşteri listesi yüklenemedi:", err.message);
    }
}

function initCustomerSearchDropdown(customers) {
    const wrapper = document.getElementById('customer-dropdown-wrapper');
    if (!wrapper) return;

    const searchInput  = document.getElementById('customer-search-input');
    const hiddenSelect = document.getElementById('order-customer-select');
    const dropdown     = document.getElementById('customer-dropdown-list');

    function renderList(filterText) {
        const q = filterText.toLowerCase();
        const filtered = customers.filter(c =>
            c.company_name.toLowerCase().includes(q) ||
            (c.country || '').toLowerCase().includes(q)
        );
        dropdown.innerHTML = '';
        if (filtered.length === 0) {
            dropdown.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:#968B7A;">Sonuç bulunamadı</div>`;
        } else {
            filtered.forEach(c => {
                const item = document.createElement('div');
                item.className = 'customer-dropdown-item';
                item.dataset.id = c.id;
                item.dataset.label = `${c.company_name} (${c.country})`;
                item.innerHTML = `<span style="font-weight:600;color:#1C1A17;">${escapeHtml(c.company_name)}</span>
                    <span style="font-size:11px;color:#968B7A;margin-left:6px;text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(c.country||'')}</span>`;
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    hiddenSelect.value = c.id;
                    searchInput.value  = item.dataset.label;
                    dropdown.classList.add('hidden');
                    searchInput.style.borderColor = '#2D4A3E';
                });
                dropdown.appendChild(item);
            });
        }
        dropdown.classList.remove('hidden');
    }

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    searchInput.addEventListener('focus', () => renderList(searchInput.value));
    searchInput.addEventListener('blur',  () => setTimeout(() => dropdown.classList.add('hidden'), 150));

    // Düzenleme modunda dışarıdan set etmek için yardımcı
    wrapper._setCustomer = (id, label) => {
        hiddenSelect.value = id;
        searchInput.value  = label;
    };
}

async function fetchProductsData() {
    try {
        const { data: products, error } = await supabase
            .from('products')
            .select('id, product_code, product_name, product_group')
            .order('product_name', { ascending: true });
        if (error) throw error;
        globalProducts = products || [];
    } catch (err) {
        console.error("Ürün listesi yüklenemedi:", err.message);
    }
}

async function fetchOrdersData() {
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select(`*, customers!orders_customer_id_fkey ( company_name, country )`)
            .order('order_date', { ascending: false });
        if (error) throw error;
        globalOrders = orders;
        renderOrdersTable(orders);
    } catch (err) {
        console.error("Sipariş verileri yüklenemedi:", err.message);
        document.getElementById('orders-table-body').innerHTML = `<tr><td colspan="9" class="text-center text-[#9F3D3D] py-4">Veriler çekilirken bir hata oluştu.</td></tr>`;
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
        console.error("Sipariş kalemleri yüklenemedi:", err.message);
        return [];
    }
}

// --- TABLO ÇİZİMİ ---
function renderOrdersTable(ordersList) {
    const tbody = document.getElementById('orders-table-body');
    const countBadge = document.getElementById('total-filtered-count');
    tbody.innerHTML = '';
    countBadge.textContent = `${ordersList.length} Sipariş`;

    if (ordersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-[#968B7A] py-8">Kriterlere uygun sipariş bulunamadı.</td></tr>`;
        return;
    }

    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };

    ordersList.forEach(order => {
        const symbol = currencySymbols[order.currency] || order.currency;
        const compName = order.customers ? order.customers.company_name : 'Bilinmeyen Müşteri';
        const country = order.customers ? order.customers.country : '';

        const prodColors = {
            'Bekliyor': 'bg-[#FBF8F1] text-[#6B655B]',
            'Üretimde': 'bg-blue-950/60 text-blue-400',
            'Hazır': 'bg-emerald-950/60 text-[#3D6E50]',
            'Sevk Edildi': 'bg-[#E8EEEA] text-[#2D4A3E]'
        };
        const payColors = {
            'Ödenmedi': 'bg-rose-950/60 text-[#9F3D3D]',
            'Kısmen Ödendi': 'bg-amber-950/60 text-[#B26B33]',
            'Ödendi': 'bg-emerald-950/60 text-[#3D6E50]'
        };

        const prodStatus = order.production_status || 'Bekliyor';
        const payStatus = order.payment_status || 'Ödenmedi';

        let rowClass = 'row-beyaz';
        const remaining = parseFloat(order.remaining_balance || 0);
        const total = parseFloat(order.total_amount || 0);
        if (payStatus === 'Ödendi') rowClass = 'row-yesil';
        else if (remaining > 0 && remaining < total) rowClass = 'row-sari';
        else if (remaining >= total && payStatus !== 'Ödenmedi') rowClass = 'row-kirmizi';

        const tr = document.createElement('tr');
        tr.className = rowClass;
        tr.innerHTML = `
            <td>
                <span class="w-2.5 h-2.5 rounded-full inline-block ${rowClass === 'row-yesil' ? 'bg-emerald-400' : rowClass === 'row-sari' ? 'bg-yellow-400' : rowClass === 'row-kirmizi' ? 'bg-rose-400' : 'bg-slate-500'}"></span>
            </td>
            <td>
                <div class="text-[#6B655B] text-xs font-mono">${order.order_date ? new Date(order.order_date).toLocaleDateString('tr-TR') : '-'}</div>
                <div class="text-xs text-[#968B7A] font-mono mt-0.5">${escapeHtml(order.order_number || '')}</div>
                ${order.shipment_date ? `<div class="text-xs text-[#2D4A3E] font-mono">Sevk: ${new Date(order.shipment_date).toLocaleDateString('tr-TR')}</div>` : ''}
                ${order.due_date ? `<div class="text-xs text-[#9F3D3D] font-mono">Vade: ${new Date(order.due_date).toLocaleDateString('tr-TR')}</div>` : ''}
            </td>
            <td>
                <div class="font-semibold text-[#1C1A17]">${escapeHtml(compName)}</div>
                ${country ? `<div class="text-xs text-[#968B7A] uppercase tracking-widest mt-0.5">${escapeHtml(country)}</div>` : ''}
                ${order.order_notes ? `<div class="text-xs text-[#968B7A] italic mt-0.5 truncate max-w-[160px]">${escapeHtml(order.order_notes)}</div>` : ''}
            </td>
            <td class="text-right font-mono font-medium">${parseFloat(order.total_amount||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-right font-mono text-[#3D6E50]">${parseFloat(order.advance_payment||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-right font-mono text-[#B26B33]">${parseFloat(order.remaining_balance||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-center">
                <span class="text-xs px-2 py-1 rounded-full font-semibold ${prodColors[prodStatus] || prodColors['Bekliyor']}">${prodStatus}</span>
            </td>
            <td class="text-center">
                <span class="text-xs px-2 py-1 rounded-full font-semibold ${payColors[payStatus] || payColors['Ödenmedi']}">${payStatus}</span>
            </td>
            <td class="text-center">
                <button class="btn-edit-order-trigger text-xs bg-[#FBF8F1] hover:bg-[#FBF8F1] border border-[#EFEAE0] hover:border-[#E4DDCE] px-2.5 py-1.5 rounded-lg text-orange-400 transition-colors" data-id="${order.id}">
                    <i class="fa-solid fa-file-pen"></i> Yönet
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-order-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => openModalForOrderEdit(e.currentTarget.getAttribute('data-id')));
    });
}

// --- OLAY DİNLEYİCİLERİ ---
function initOrderEventListeners() {
    document.getElementById('btn-open-order-modal').addEventListener('click', openModalForOrderCreate);
    document.getElementById('btn-close-order-modal').addEventListener('click', closeOrderModal);
    document.getElementById('btn-order-cancel').addEventListener('click', closeOrderModal);
    document.getElementById('order-form').addEventListener('submit', handleOrderSubmit);
    document.getElementById('btn-delete-order').addEventListener('click', handleDeleteOrder);

    document.getElementById('order-search-input').addEventListener('input', applyOrderFilters);
    document.getElementById('filter-order-currency').addEventListener('change', applyOrderFilters);
    document.getElementById('filter-production-status').addEventListener('change', applyOrderFilters);
    document.getElementById('filter-payment-status').addEventListener('change', applyOrderFilters);

    const totalInput = document.getElementById('total_amount');
    const advanceInput = document.getElementById('advance_payment');
    [totalInput, advanceInput].forEach(input => {
        input.addEventListener('input', () => {
            const remaining = parseTurkishFloat(totalInput.value) - parseTurkishFloat(advanceInput.value);
            document.getElementById('live-remaining-balance').textContent = remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        });
    });

    document.getElementById('btn-export-orders').addEventListener('click', exportOrdersToCSV);

    // Sekme geçiş
    document.getElementById('tab-general').addEventListener('click', () => switchTab('general'));
    document.getElementById('tab-items').addEventListener('click', () => switchTab('items'));

    // Kalem ekle butonu
    document.getElementById('btn-add-item-row').addEventListener('click', addItemRow);
}

// --- SEKME GEÇİŞİ ---
function switchTab(tab) {
    const generalPanel = document.getElementById('panel-general');
    const itemsPanel = document.getElementById('panel-items');
    const tabGeneral = document.getElementById('tab-general');
    const tabItems = document.getElementById('tab-items');

    if (tab === 'general') {
        generalPanel.classList.remove('hidden');
        itemsPanel.classList.add('hidden');
        tabGeneral.classList.add('tab-active');
        tabItems.classList.remove('tab-active');
    } else {
        generalPanel.classList.add('hidden');
        itemsPanel.classList.remove('hidden');
        tabGeneral.classList.remove('tab-active');
        tabItems.classList.add('tab-active');
        renderItemsTable();
    }
}

// --- KALEM TABLOSU ---
function renderItemsTable() {
    const tbody = document.getElementById('items-table-body');
    tbody.innerHTML = '';

    if (orderItemsBuffer.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-slate-500 py-6 text-sm">Henüz sipariş kalemi eklenmedi. "Satır Ekle" butonunu kullanın.</td></tr>`;
    } else {
        orderItemsBuffer.forEach((item, idx) => {
            const productOptions = globalProducts.map(p =>
                `<option value="${p.id}" data-code="${escapeHtml(p.product_code||'')}" data-name="${escapeHtml(p.product_name)}" ${item.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.product_name)}</option>`
            ).join('');

            const tr = document.createElement('tr');
            tr.dataset.idx = idx;
            tr.innerHTML = `
                <td style="min-width:200px;">
                    <select class="item-product-select" data-idx="${idx}" style="height:34px;font-size:12px;">
                        <option value="">-- Ürün Seç --</option>
                        ${productOptions}
                    </select>
                    <input type="text" class="item-product-name mt-1" data-idx="${idx}" value="${escapeHtml(item.product_name||'')}" placeholder="veya serbest metin" style="height:30px;font-size:11px;">
                </td>
                <td style="min-width:110px;">
                    <input type="text" class="item-product-code" data-idx="${idx}" value="${escapeHtml(item.product_code||'')}" placeholder="Ürün kodu" style="height:34px;font-size:12px;">
                </td>
                <td style="min-width:90px;">
                    <input type="number" class="item-quantity" data-idx="${idx}" value="${item.quantity||''}" placeholder="0" step="any" style="height:34px;font-size:12px;text-align:right;">
                </td>
                <td style="min-width:120px;">
                    <input type="number" class="item-unit-price" data-idx="${idx}" value="${item.unit_price||''}" placeholder="0.00" step="any" style="height:34px;font-size:12px;text-align:right;">
                </td>
                <td class="text-right font-mono text-emerald-400 text-sm item-amount" data-idx="${idx}">
                    ${calcAmount(item.quantity, item.unit_price)}
                </td>
                <td class="text-center">
                    <button class="btn-remove-item text-rose-400 hover:text-rose-300 px-2 py-1 text-xs" data-idx="${idx}">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                    <input type="text" class="item-notes" data-idx="${idx}" value="${escapeHtml(item.notes||'')}" placeholder="Not" style="height:28px;font-size:11px;margin-top:4px;display:block;">
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Bind item events
    tbody.querySelectorAll('.item-product-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const opt = e.target.selectedOptions[0];
            if (opt && opt.value) {
                orderItemsBuffer[idx].product_id = opt.value;
                orderItemsBuffer[idx].product_name = opt.dataset.name || '';
                orderItemsBuffer[idx].product_code = opt.dataset.code || '';
                // Update name input
                const nameInput = tbody.querySelector(`.item-product-name[data-idx="${idx}"]`);
                const codeInput = tbody.querySelector(`.item-product-code[data-idx="${idx}"]`);
                if (nameInput) nameInput.value = opt.dataset.name || '';
                if (codeInput) codeInput.value = opt.dataset.code || '';
            }
        });
    });

    tbody.querySelectorAll('.item-product-name').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            orderItemsBuffer[idx].product_name = e.target.value;
        });
    });

    tbody.querySelectorAll('.item-product-code').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            orderItemsBuffer[idx].product_code = e.target.value;
        });
    });

    tbody.querySelectorAll('.item-quantity').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            orderItemsBuffer[idx].quantity = parseFloat(e.target.value) || null;
            updateItemAmount(tbody, idx);
            updateItemsTotal();
        });
    });

    tbody.querySelectorAll('.item-unit-price').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            orderItemsBuffer[idx].unit_price = parseFloat(e.target.value) || null;
            updateItemAmount(tbody, idx);
            updateItemsTotal();
        });
    });

    tbody.querySelectorAll('.item-notes').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            orderItemsBuffer[idx].notes = e.target.value;
        });
    });

    tbody.querySelectorAll('.btn-remove-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.idx);
            orderItemsBuffer.splice(idx, 1);
            renderItemsTable();
            updateItemsTotal();
        });
    });

    updateItemsTotal();
}

function calcAmount(qty, price) {
    const q = parseFloat(qty) || 0;
    const p = parseFloat(price) || 0;
    return (q * p).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
}

function updateItemAmount(tbody, idx) {
    const item = orderItemsBuffer[idx];
    const amountCell = tbody.querySelector(`.item-amount[data-idx="${idx}"]`);
    if (amountCell) {
        amountCell.textContent = calcAmount(item.quantity, item.unit_price);
    }
}

function updateItemsTotal() {
    const total = orderItemsBuffer.reduce((sum, item) => {
        return sum + ((parseFloat(item.quantity)||0) * (parseFloat(item.unit_price)||0));
    }, 0);

    document.getElementById('items-total').textContent = total.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    // Sipariş tutarıyla karşılaştır
    const orderTotal = parseTurkishFloat(document.getElementById('total_amount').value);
    const warningEl = document.getElementById('items-total-warning');
    if (orderTotal > 0 && Math.abs(total - orderTotal) > 0.01) {
        warningEl.classList.remove('hidden');
        warningEl.textContent = `⚠ Kalem toplamı (${total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}) sipariş tutarından (${orderTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}) farklı!`;
    } else {
        warningEl.classList.add('hidden');
    }
}

function addItemRow() {
    orderItemsBuffer.push({
        id: null,
        product_id: null,
        product_name: '',
        product_code: '',
        quantity: null,
        unit_price: null,
        notes: ''
    });
    // Ensure items tab is active
    switchTab('items');
}

// --- MODAL KONTROL ---
function openModalForOrderCreate() {
    document.getElementById('order-form').reset();
    document.getElementById('order-id').value = '';
    document.getElementById('customer-search-input').value = '';
    document.getElementById('order-customer-select').value = '';
    document.getElementById('order_date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('live-remaining-balance').textContent = '0,00';
    document.getElementById('order-modal-title').innerHTML = `<i class="fa-solid fa-cart-plus text-[#2D4A3E]"></i> Yeni Sipariş Girişi`;
    document.getElementById('btn-delete-order').classList.add('hidden');
    currentOrderId = null;
    orderItemsBuffer = [];
    switchTab('general');
    document.getElementById('order-modal').classList.remove('hidden');
}

async function openModalForOrderEdit(id) {
    const order = globalOrders.find(o => o.id === id);
    if (!order) return;

    currentOrderId = id;

    document.getElementById('order-id').value = order.id;

    // Müşteri arama dropdown'ını set et
    const wrapper = document.getElementById('customer-dropdown-wrapper');
    const cust = globalCustomers.find(c => c.id === order.customer_id);
    const label = cust
        ? `${cust.company_name} (${cust.country})`
        : (order.customers ? `${order.customers.company_name} (${order.customers.country})` : '');
    if (wrapper && wrapper._setCustomer) {
        wrapper._setCustomer(order.customer_id, label);
    } else {
        document.getElementById('order-customer-select').value = order.customer_id;
    }

    document.getElementById('order_date').value = order.order_date;
    document.getElementById('currency').value = order.currency;
    document.getElementById('order_number').value = order.order_number || '';
    document.getElementById('shipment_date').value = order.shipment_date || '';
    document.getElementById('due_date').value = order.due_date || '';
    document.getElementById('total_amount').value = parseFloat(order.total_amount||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('advance_payment').value = parseFloat(order.advance_payment||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('live-remaining-balance').textContent = parseFloat(order.remaining_balance||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('production_status').value = order.production_status || 'Bekliyor';
    document.getElementById('payment_status').value = order.payment_status || 'Ödenmedi';
    document.getElementById('order_quantity').value = order.order_quantity || '';
    document.getElementById('order_notes').value = order.order_notes || '';

    document.getElementById('order-modal-title').innerHTML = `<i class="fa-solid fa-file-pen text-amber-500"></i> Sipariş Düzenleme & Güncelleme`;
    document.getElementById('btn-delete-order').classList.remove('hidden');

    // Kalemleri yükle
    const existingItems = await fetchOrderItems(id);
    orderItemsBuffer = existingItems.map(item => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        product_code: item.product_code,
        quantity: item.quantity,
        unit_price: item.unit_price,
        notes: item.notes
    }));

    switchTab('general');
    document.getElementById('order-modal').classList.remove('hidden');
}

function closeOrderModal() {
    document.getElementById('order-modal').classList.add('hidden');
    orderItemsBuffer = [];
    currentOrderId = null;
}

// --- KAYDETME ---
async function handleOrderSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('order-id').value;
    const total_amount = parseTurkishFloat(document.getElementById('total_amount').value);
    const advance_payment = parseTurkishFloat(document.getElementById('advance_payment').value);
    const remaining_balance = total_amount - advance_payment;

    if (isNaN(total_amount) || total_amount <= 0) {
        alert("Lütfen geçerli bir toplam sipariş tutarı giriniz.");
        return;
    }

    const orderPayload = {
        customer_id: document.getElementById('order-customer-select').value,
        order_date: document.getElementById('order_date').value,
        currency: document.getElementById('currency').value,
        total_amount,
        advance_payment,
        remaining_balance,
        order_number: document.getElementById('order_number').value || null,
        shipment_date: document.getElementById('shipment_date').value || null,
        due_date: document.getElementById('due_date').value || null,
        production_status: document.getElementById('production_status').value,
        payment_status: document.getElementById('payment_status').value,
        order_quantity: document.getElementById('order_quantity').value || null,
        order_notes: document.getElementById('order_notes').value || null,
    };

    try {
        const { data: { session } } = await supabase.auth.getSession();
        let orderId = id;

        if (id) {
            const { error } = await supabase.from('orders').update(orderPayload).eq('id', id).eq('user_id', session.user.id);
            if (error) throw error;
        } else {
            orderPayload.user_id = session.user.id;
            const { data, error } = await supabase.from('orders').insert([orderPayload]).select().single();
            if (error) throw error;
            orderId = data.id;
        }

        // --- ORDER ITEMS KAYDET ---
        await saveOrderItems(orderId, session.user.id);

        closeOrderModal();
        await fetchOrdersData();
    } catch (err) {
        console.error("Sipariş kaydedilemedi:", err.message);
        alert("Hata: " + err.message);
    }
}

async function saveOrderItems(orderId, userId) {
    // Mevcut kalemleri çek (veritabanındakiler)
    const existingItems = currentOrderId ? await fetchOrderItems(orderId) : [];
    const existingIds = existingItems.map(i => i.id);
    const bufferIds = orderItemsBuffer.filter(i => i.id).map(i => i.id);

    // Silinmesi gerekenler
    const toDelete = existingIds.filter(eid => !bufferIds.includes(eid));
    if (toDelete.length > 0) {
        const { error } = await supabase.from('order_items').delete().in('id', toDelete);
        if (error) throw error;
    }

    // Yeni veya güncellenenler
    for (const item of orderItemsBuffer) {
        if (!item.product_name) continue; // boş satır atla

        const payload = {
            order_id: orderId,
            user_id: userId,
            product_id: item.product_id || null,
            product_name: item.product_name,
            product_code: item.product_code || null,
            quantity: item.quantity || null,
            unit_price: item.unit_price || null,
            currency: document.getElementById('currency').value,
            notes: item.notes || null,
        };

        if (item.id) {
            // Güncelle
            const { error } = await supabase.from('order_items').update(payload).eq('id', item.id);
            if (error) throw error;
        } else {
            // Yeni ekle
            const { error } = await supabase.from('order_items').insert([payload]);
            if (error) throw error;
        }
    }
}

// --- SİLME ---
async function handleDeleteOrder() {
    const id = document.getElementById('order-id').value;
    if (!id || !confirm("Bu ihracat siparişini kalıcı olarak silmek istediğinize emin misiniz?")) return;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase.from('orders').delete().eq('id', id).eq('user_id', session.user.id);
        if (error) throw error;
        closeOrderModal();
        await fetchOrdersData();
    } catch (err) {
        console.error("Sipariş silinemedi:", err.message);
        if (err.code === '23503') {
            alert("Bu sipariş silinemez!\nSiparişe bağlı credit note veya sipariş kalemi kaydı bulunmaktadır.\nÖnce ilgili kayıtları siliniz.");
        } else {
            alert("Silme işlemi başarısız oldu: " + err.message);
        }
    }
}

// --- FİLTRELEME ---
function applyOrderFilters() {
    const searchVal = document.getElementById('order-search-input').value.toLowerCase();
    const currencyVal = document.getElementById('filter-order-currency').value;
    const prodVal = document.getElementById('filter-production-status').value;
    const payVal = document.getElementById('filter-payment-status').value;

    const filtered = globalOrders.filter(o => {
        const compName = o.customers ? o.customers.company_name.toLowerCase() : '';
        const orderNo = (o.order_number || '').toLowerCase();
        const matchSearch = compName.includes(searchVal) || orderNo.includes(searchVal);
        const matchCurrency = currencyVal === "" || o.currency === currencyVal;
        const matchProd = prodVal === "" || o.production_status === prodVal;
        const matchPay = payVal === "" || o.payment_status === payVal;
        return matchSearch && matchCurrency && matchProd && matchPay;
    });

    renderOrdersTable(filtered);
}

// --- YARDIMCI FONKSİYONLAR ---
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
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- CSV EXPORT ---
function exportOrdersToCSV() {
    if (globalOrders.length === 0) { alert("Aktarılacak sipariş verisi yok."); return; }
    let csv = "data:text/csv;charset=utf-8,\uFEFF";
    csv += "Siparis Tarihi;Siparis No;Musteri;Ulke;Para Birimi;Toplam Tutar;Avans;Kalan Bakiye;Uretim Durumu;Odeme Durumu;Adet;Notlar\n";
    globalOrders.forEach(o => {
        const compName = o.customers ? o.customers.company_name : '';
        const country = o.customers ? o.customers.country : '';
        csv += `"${o.order_date}";"${o.order_number||''}";"${compName}";"${country}";"${o.currency}";"${o.total_amount}";"${o.advance_payment}";"${o.remaining_balance}";"${o.production_status||''}";"${o.payment_status||''}";"${o.order_quantity||''}";"${(o.order_notes||'').replace(/"/g,'""')}"\n`;
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `Export_Siparisler_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
