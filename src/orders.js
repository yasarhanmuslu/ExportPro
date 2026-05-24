import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

let globalOrders = [];
let globalCustomers = [];

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    await renderNavbar('orders');
    await Promise.all([fetchCustomersData(), fetchOrdersData()]);
    initOrderEventListeners();
});

// --- VERİ ÇEKME ---
async function fetchCustomersData() {
    try {
        const { data: customers, error } = await supabase
            .from('customers')
            .select('id, company_name, country')
            .order('company_name', { ascending: true });
        if (error) throw error;
        globalCustomers = customers;

        const select = document.getElementById('order-customer-select');
        select.innerHTML = '<option value="">-- Müşteri Seçiniz --</option>';
        customers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.company_name} (${c.country})`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Müşteri listesi yüklenemedi:", err.message);
    }
}

async function fetchOrdersData() {
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select(`*, customers ( company_name, country )`)
            .order('order_date', { ascending: false });
        if (error) throw error;
        globalOrders = orders;
        renderOrdersTable(orders);
    } catch (err) {
        console.error("Sipariş verileri yüklenemedi:", err.message);
        document.getElementById('orders-table-body').innerHTML = `<tr><td colspan="9" class="text-center text-rose-400 py-4">Veriler çekilirken bir hata oluştu.</td></tr>`;
    }
}

// --- TABLO ÇİZİMİ ---
function renderOrdersTable(ordersList) {
    const tbody = document.getElementById('orders-table-body');
    const countBadge = document.getElementById('total-filtered-count');
    tbody.innerHTML = '';
    countBadge.textContent = `${ordersList.length} Sipariş`;

    if (ordersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-slate-500 py-8">Kriterlere uygun sipariş bulunamadı.</td></tr>`;
        return;
    }

    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };

    ordersList.forEach(order => {
        const symbol = currencySymbols[order.currency] || order.currency;
        const compName = order.customers ? order.customers.company_name : 'Bilinmeyen Müşteri';
        const country = order.customers ? order.customers.country : '';

        // Üretim durum rengi
        const prodColors = {
            'Bekliyor': 'bg-slate-800 text-slate-400',
            'Üretimde': 'bg-blue-950/60 text-blue-400',
            'Hazır': 'bg-emerald-950/60 text-emerald-400',
            'Sevk Edildi': 'bg-purple-950/60 text-purple-400'
        };
        const payColors = {
            'Ödenmedi': 'bg-rose-950/60 text-rose-400',
            'Kısmen Ödendi': 'bg-amber-950/60 text-amber-400',
            'Ödendi': 'bg-emerald-950/60 text-emerald-400'
        };

        const prodStatus = order.production_status || 'Bekliyor';
        const payStatus = order.payment_status || 'Ödenmedi';

        // Satır durum rengi (kalan bakiyeye göre)
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
                <div class="text-slate-400 text-xs font-mono">${order.order_date ? new Date(order.order_date).toLocaleDateString('tr-TR') : '-'}</div>
                <div class="text-xs text-slate-500 font-mono mt-0.5">${escapeHtml(order.order_number || '')}</div>
                ${order.shipment_date ? `<div class="text-xs text-purple-400 font-mono">Sevk: ${new Date(order.shipment_date).toLocaleDateString('tr-TR')}</div>` : ''}
                ${order.due_date ? `<div class="text-xs text-rose-400 font-mono">Vade: ${new Date(order.due_date).toLocaleDateString('tr-TR')}</div>` : ''}
            </td>
            <td>
                <div class="font-semibold text-slate-200">${escapeHtml(compName)}</div>
                ${country ? `<div class="text-xs text-slate-500 uppercase tracking-widest mt-0.5">${escapeHtml(country)}</div>` : ''}
                ${order.order_notes ? `<div class="text-xs text-slate-500 italic mt-0.5 truncate max-w-[160px]">${escapeHtml(order.order_notes)}</div>` : ''}
            </td>
            <td class="text-right font-mono font-medium">${parseFloat(order.total_amount||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-right font-mono text-emerald-400">${parseFloat(order.advance_payment||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-right font-mono text-amber-400">${parseFloat(order.remaining_balance||0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-center">
                <span class="text-xs px-2 py-1 rounded-full font-semibold ${prodColors[prodStatus] || prodColors['Bekliyor']}">${prodStatus}</span>
            </td>
            <td class="text-center">
                <span class="text-xs px-2 py-1 rounded-full font-semibold ${payColors[payStatus] || payColors['Ödenmedi']}">${payStatus}</span>
            </td>
            <td class="text-center">
                <button class="btn-edit-order-trigger text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 px-2.5 py-1.5 rounded-lg text-orange-400 transition-colors" data-id="${order.id}">
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
}

// --- MODAL KONTROL ---
function openModalForOrderCreate() {
    document.getElementById('order-form').reset();
    document.getElementById('order-id').value = '';
    document.getElementById('order_date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('live-remaining-balance').textContent = '0,00';
    document.getElementById('order-modal-title').innerHTML = `<i class="fa-solid fa-cart-plus text-orange-500"></i> Yeni Sipariş Girişi`;
    document.getElementById('btn-delete-order').classList.add('hidden');
    document.getElementById('order-modal').classList.remove('hidden');
}

function openModalForOrderEdit(id) {
    const order = globalOrders.find(o => o.id === id);
    if (!order) return;

    document.getElementById('order-id').value = order.id;
    document.getElementById('order-customer-select').value = order.customer_id;
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
    document.getElementById('order-modal').classList.remove('hidden');
}

function closeOrderModal() {
    document.getElementById('order-modal').classList.add('hidden');
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
        if (id) {
            const { error } = await supabase.from('orders').update(orderPayload).eq('id', id).eq('user_id', session.user.id);
            if (error) throw error;
        } else {
            orderPayload.user_id = session.user.id;
            const { error } = await supabase.from('orders').insert([orderPayload]);
            if (error) throw error;
        }
        closeOrderModal();
        await fetchOrdersData();
    } catch (err) {
        console.error("Sipariş kaydedilemedi:", err.message);
        alert("Hata: " + err.message);
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
