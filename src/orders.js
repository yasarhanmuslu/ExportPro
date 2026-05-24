import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';

// Global Veri Bellekleri
let globalOrders = [];
let globalCustomers = [];

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Ortak Menüyü Başlat ('orders' aktif)
    await renderNavbar('orders');

    // 2. Müşterileri ve Siparişleri Paralel Olarak Çek
    await Promise.all([fetchCustomersData(), fetchOrdersData()]);

    // 3. Form Olay Yapılandırmalarını Kur
    initOrderEventListeners();
});

// --- VERİ ÇEKME METOTLARI ---
async function fetchCustomersData() {
    try {
        const { data: customers, error } = await supabase
            .from('customers')
            .select('id, company_name, country')
            .order('company_name', { ascending: true });

        if (error) throw error;
        globalCustomers = customers;

        // Modal içindeki select elementini besle
        const select = document.getElementById('order-customer-select');
        select.innerHTML = '<option value="">-- Müşteri Seçiniz --</option>';
        customers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.company_name} (${c.country})`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Müşteri listesi ilişkisi kurulamadı:", err.message);
    }
}

async function fetchOrdersData() {
    try {
        // Siparişleri çekerken ilişkili müşteri tablosundan company_name alanını join ile alıyoruz
        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                *,
                customers ( company_name )
            `)
            .order('order_date', { ascending: false });

        if (error) throw error;
        globalOrders = orders;

        renderOrdersTable(orders);
    } catch (err) {
        console.error("Sipariş verileri yüklenemedi:", err.message);
        document.getElementById('orders-table-body').innerHTML = `<tr><td colspan="6" class="text-center text-rose-400 py-4">Veriler çekilirken bir hata oluştu.</td></tr>`;
    }
}

// --- TABLO ÇİZİM METODU ---
function renderOrdersTable(ordersList) {
    const tbody = document.getElementById('orders-table-body');
    const countBadge = document.getElementById('total-filtered-count');
    tbody.innerHTML = '';

    countBadge.textContent = `${ordersList.length} Sipariş`;

    if (ordersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-slate-500 py-8">Kayıtlı ihracat siparişi bulunamadı.</td></tr>`;
        return;
    }

    const currencySymbols = { 'EUR': '€', 'USD': '$', 'TRY': '₺', 'GBP': '£' };

    ordersList.forEach(order => {
        const symbol = currencySymbols[order.currency] || order.currency;
        const compName = order.customers ? order.customers.company_name : 'Bilinmeyen Müşteri';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="text-slate-400 text-xs font-mono">${new Date(order.order_date).toLocaleDateString('tr-TR')}</td>
            <td class="font-semibold text-slate-200">${escapeHtml(compName)}</td>
            <td class="text-right font-mono font-medium">${order.total_amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-right font-mono text-emerald-400">${order.advance_payment.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-right font-mono text-amber-400 bg-amber-950/5">${order.remaining_balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${symbol}</td>
            <td class="text-center">
                <button class="btn-edit-order-trigger text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 px-2.5 py-1.5 rounded-lg text-orange-400 transition-colors" data-id="${order.id}">
                    <i class="fa-solid fa-file-pen"></i> Yönet
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-order-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openModalForOrderEdit(e.currentTarget.getAttribute('data-id'));
        });
    });
}

// --- OLAY DİNLEYİCİLERİ VE CANLI HESAPLAMALAR ---
function initOrderEventListeners() {
    document.getElementById('btn-open-order-modal').addEventListener('click', openModalForOrderCreate);
    document.getElementById('btn-close-order-modal').addEventListener('click', closeOrderModal);
    document.getElementById('btn-order-cancel').addEventListener('click', closeOrderModal);
    document.getElementById('order-form').addEventListener('submit', handleOrderSubmit);
    document.getElementById('btn-delete-order').addEventListener('click', handleDeleteOrder);

    // Canlı Filtreleme Tetikleyicileri
    document.getElementById('order-search-input').addEventListener('input', applyOrderFilters);
    document.getElementById('filter-order-currency').addEventListener('change', applyOrderFilters);

    // TÜRKÇE PARASAL FORMAT & ANLIK CANLI BAKİYE HESAPLAMA TETİKLEYİCİSİ
    const totalInput = document.getElementById('total-amount');
    const advanceInput = document.getElementById('advance_payment');

    [totalInput, advanceInput].forEach(input => {
        input.addEventListener('input', () => {
            const total = parseTurkishFloat(totalInput.value);
            const advance = parseTurkishFloat(advanceInput.value);
            const remaining = total - advance;

            document.getElementById('live-remaining-balance').textContent = remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        });
    });

    // Excel Export
    document.getElementById('btn-export-orders').addEventListener('click', exportOrdersToCSV);
}

// --- MODAL KONTROLLERİ ---
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
    
    // Değerleri formda Türkçe formatta göster
    document.getElementById('total-amount').value = order.total_amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('advance_payment').value = order.advance_payment.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('live-remaining-balance').textContent = order.remaining_balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    document.getElementById('order-modal-title').innerHTML = `<i class="fa-solid fa-file-pen text-amber-500"></i> Sipariş Düzenleme & Güncelleme`;
    document.getElementById('btn-delete-order').classList.remove('hidden');
    document.getElementById('order-modal').classList.remove('hidden');
}

function closeOrderModal() {
    document.getElementById('order-modal').classList.add('hidden');
}

// --- FORM KAYDETME SÜRECİ (INSERT & UPDATE) ---
async function handleOrderSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('order-id').value;
    const customer_id = document.getElementById('order-customer-select').value;
    const order_date = document.getElementById('order_date').value;
    const currency = document.getElementById('currency').value;
    
    // Türkçe karakterleri temizleyerek güvenli sayıya dönüştür
    const total_amount = parseTurkishFloat(document.getElementById('total-amount').value);
    const advance_payment = parseTurkishFloat(document.getElementById('advance_payment').value);
    const remaining_balance = total_amount - advance_payment;

    if (isNaN(total_amount) || total_amount <= 0) {
        alert("Lütfen geçerli bir toplam sipariş tutarı giriniz.");
        return;
    }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session.user.id;

        const orderPayload = {
            customer_id,
            order_date,
            currency,
            total_amount,
            advance_payment,
            remaining_balance
        };

        if (id) {
            // GÜNCELLEME (UPDATE)
            const { error } = await supabase
                .from('orders')
                .update(orderPayload)
                .eq('id', id)
                .eq('user_id', userId);
            if (error) throw error;
        } else {
            // EKLEME (INSERT)
            orderPayload.user_id = userId;
            const { error } = await supabase
                .from('orders')
                .insert([orderPayload]);
            if (error) throw error;
        }

        closeOrderModal();
        await fetchOrdersData();

    } catch (err) {
        console.error("Sipariş veritabanına yazılamadı:", err.message);
        alert("Hata: " + err.message);
    }
}

// --- SİPARİŞ SİLME (DELETE) ---
async function handleDeleteOrder() {
    const id = document.getElementById('order-id').value;
    if (!id || !confirm("Bu ihracat siparişini sistemden kalıcı olarak silmek istediğinize emin misiniz?")) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase
            .from('orders')
            .delete()
            .eq('id', id)
            .eq('user_id', session.user.id);

        if (error) throw error;
        closeOrderModal();
        await fetchOrdersData();
    } catch (err) {
        console.error("Sipariş silinemedi:", err.message);
    }
}

// --- AMELİYATHANE DÜZEYİNDE PARSE-FLOAT (TÜRKÇE FORMAT SÜZÜCÜ) ---
function parseTurkishFloat(value) {
    if (!value) return 0;
    let clean = value.toString().trim();
    
    // Eğer girdi "1.250,50" biçimindeyse (Binlik nokta, ondalık virgül)
    if (clean.includes('.') && clean.includes(',')) {
        clean = clean.replace(/\./g, '').replace(/,/g, '.');
    } 
    // Eğer sadece virgül varsa ondalık kabul et "1250,50" -> "1250.50"
    else if (clean.includes(',')) {
        clean = clean.replace(/,/g, '.');
    }
    
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
}

// --- CANLI FİLTRELEME MANTIĞI ---
function applyOrderFilters() {
    const searchVal = document.getElementById('order-search-input').value.toLowerCase();
    const currencyVal = document.getElementById('filter-order-currency').value;

    const filtered = globalOrders.filter(o => {
        const compName = o.customers ? o.customers.company_name.toLowerCase() : '';
        const matchSearch = compName.includes(searchVal);
        const matchCurrency = currencyVal === "" || o.currency === currencyVal;
        return matchSearch && matchCurrency;
    });

    renderOrdersTable(filtered);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- CSV/EXCEL SİPARİŞ AKTARIM METODU ---
function exportOrdersToCSV() {
    if (globalOrders.length === 0) {
        alert("Aktarılacak sipariş verisi yok.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\\uFEFF";
    csvContent += "Siparis Tarihi;Musteri/Firma;Toplam Tutar;Para Birimi;Alinan Avans;Kalan Bakiye\n";

    globalOrders.forEach(o => {
        const compName = o.customers ? o.customers.company_name : 'Bilinmeyen Müşteri';
        csvContent += `"${o.order_date}";"${compName.replace(/"/g, '""')}";"${o.total_amount}";"${o.currency}";"${o.advance_payment}";"${o.remaining_balance}"\n`;
    });

    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `Export_Siparis_Takip_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}