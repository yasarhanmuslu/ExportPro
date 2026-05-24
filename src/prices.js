import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// Global Hafıza Nesneleri
let globalPrices = [];
let globalCustomers = [];

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    // 1. Ortak Navbar Modülünü Yükle ('prices' aktif)
    await renderNavbar('prices');

    // 2. Müşteri İlişkilerini ve Kayıtlı Özel Fiyatları Çek
    await Promise.all([fetchCustomersForPrices(), fetchCustomerPrices()]);

    // 3. Fiyat Robotu Dinleyicilerini Kur
    initPriceEventListeners();
});

// --- VERİ ÇEKME OPERASYONLARI ---
async function fetchCustomersForPrices() {
    try {
        const { data: customers, error } = await supabase
            .from('customers')
            .select('id, company_name, country')
            .order('company_name', { ascending: true });

        if (error) throw error;
        globalCustomers = customers;

        const select = document.getElementById('price-customer-select');
        select.innerHTML = '<option value="">-- Müşteri Seçiniz --</option>';
        customers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.company_name} (${c.country})`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Müşteri listesi entegrasyon hatası:", err.message);
    }
}

async function fetchCustomerPrices() {
    try {
        const { data: prices, error } = await supabase
            .from('customer_prices')
            .select(`
                *,
                customers ( company_name )
            `)
            .order('product_name', { ascending: true });

        if (error) throw error;
        globalPrices = prices;

        renderPricesTable(prices);
    } catch (err) {
        console.error("Fiyat listesi çekilemedi:", err.message);
        document.getElementById('prices-table-body').innerHTML = `<tr><td colspan="6" class="text-center text-rose-400 py-4">Fiyat verileri çekilirken hata oluştu.</td></tr>`;
    }
}

// --- TABLO OLUŞTURMA VE UI GÖSTERİMİ ---
function renderPricesTable(pricesList) {
    const tbody = document.getElementById('prices-table-body');
    const recordBadge = document.getElementById('total-price-records');
    tbody.innerHTML = '';

    recordBadge.textContent = `${pricesList.length} Tanım`;

    if (pricesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-slate-500 py-8">Kayıtlı özel müşteri fiyatı/iskontosu bulunamadı.</td></tr>`;
        return;
    }

    pricesList.forEach(p => {
        const compName = p.customers ? p.customers.company_name : 'Bilinmeyen Müşteri';
        const discRate = p.discount_rate ? parseFloat(p.discount_rate).toFixed(3) : "0.000";

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold text-slate-200">${escapeHtml(compName)}</td>
            <td class="text-slate-300">${escapeHtml(p.product_name)}</td>
            <td class="text-right font-mono text-slate-400 whitespace-nowrap">${parseFloat(p.list_price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}&nbsp;€</td>
            <td class="text-center font-mono text-amber-400 font-medium bg-amber-950/10">% ${discRate}</td>
            <td class="text-right font-mono text-emerald-400 font-bold whitespace-nowrap">${parseFloat(p.net_price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}&nbsp;€</td>
            <td class="text-center">
                <button class="btn-edit-price-trigger text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 px-2.5 py-1.5 rounded-lg text-emerald-400 transition-colors" data-id="${p.id}">
                    <i class="fa-solid fa-calculator"></i> Robotu Aç
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-price-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openModalForPriceEdit(e.currentTarget.getAttribute('data-id'));
        });
    });
}

// --- ROBOTİK ÇİFT YÖNLÜ HESAPLAMA SİMÜLASYONU VE EVENTLER ---
function initPriceEventListeners() {
    document.getElementById('btn-open-price-modal').addEventListener('click', openModalForPriceCreate);
    document.getElementById('btn-close-price-modal').addEventListener('click', closePriceModal);
    document.getElementById('btn-price-cancel').addEventListener('click', closePriceModal);
    document.getElementById('price-form').addEventListener('submit', handlePriceSubmit);
    document.getElementById('btn-delete-price').addEventListener('click', handleDeletePrice);

    document.getElementById('price-search-input').addEventListener('input', applyPriceFilters);
    document.getElementById('btn-export-prices').addEventListener('click', exportPricesToCSV);

    const listInput = document.getElementById('list_price');
    const discountInput = document.getElementById('discount_rate');
    const netInput = document.getElementById('net_price');

    // ROBOTİK ADIM A: İskonto değiştiğinde Net Fiyatı Hesapla
    discountInput.addEventListener('input', () => {
        const listPrice = parseTurkishFloat(listInput.value);
        const discountRate = parseTurkishFloat(discountInput.value);

        if (listPrice > 0) {
            const calculatedNet = listPrice * (1 - (discountRate / 100));
            // Kullanıcıyı engellememek için geçici ondalık nokta formatında basıyoruz
            netInput.value = calculatedNet.toFixed(2).replace('.', ',');
        }
    });

    // ROBOTİK ADIM B: Net Fiyat manuel girildiğinde 3 haneli İskontoyu Tersten Hesapla
    netInput.addEventListener('input', () => {
        const listPrice = parseTurkishFloat(listInput.value);
        const netPrice = parseTurkishFloat(netInput.value);

        if (listPrice > 0 && netPrice <= listPrice) {
            const calculatedDiscount = ((listPrice - netPrice) / listPrice) * 100;
            // İhracat kurallarına göre tam 3 basamak hassasiyet
            discountInput.value = calculatedDiscount.toFixed(3).replace('.', ',');
        }
    });
}

// --- MODAL YÖNETİMLERİ ---
function openModalForPriceCreate() {
    document.getElementById('price-form').reset();
    document.getElementById('price-id').value = '';
    document.getElementById('price-modal-title').innerHTML = `<i class="fa-solid fa-calculator text-emerald-500"></i> Yeni Fiyat / İskonto Tanımla`;
    document.getElementById('btn-delete-price').classList.add('hidden');
    document.getElementById('price-modal').classList.remove('hidden');
}

function openModalForPriceEdit(id) {
    const p = globalPrices.find(price => price.id === id);
    if (!p) return;

    document.getElementById('price-id').value = p.id;
    document.getElementById('price-customer-select').value = p.customer_id;
    document.getElementById('product_name').value = p.product_name;
    
    document.getElementById('list_price').value = p.list_price.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('discount_rate').value = p.discount_rate.toLocaleString('tr-TR', { minimumFractionDigits: 3 });
    document.getElementById('net_price').value = p.net_price.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    document.getElementById('price-modal-title').innerHTML = `<i class="fa-solid fa-robot text-amber-400"></i> Robotik Fiyat Düzenleme`;
    document.getElementById('btn-delete-price').classList.remove('hidden');
    document.getElementById('price-modal').classList.remove('hidden');
}

function closePriceModal() {
    document.getElementById('price-modal').classList.add('hidden');
}

// --- CRUD: KAYDETME VE SİLME ---
async function handlePriceSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('price-id').value;
    const customer_id = document.getElementById('price-customer-select').value;
    const product_name = document.getElementById('product_name').value.trim();
    
    const list_price = parseTurkishFloat(document.getElementById('list_price').value);
    const discount_rate = parseTurkishFloat(document.getElementById('discount_rate').value);
    const net_price = parseTurkishFloat(document.getElementById('net_price').value);

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session.user.id;

        const payload = { customer_id, product_name, list_price, discount_rate, net_price };

        if (id) {
            const { error } = await supabase
                .from('customer_prices')
                .update(payload)
                .eq('id', id)
                .eq('user_id', userId);
            if (error) throw error;
        } else {
            payload.user_id = userId;
            const { error } = await supabase
                .from('customer_prices')
                .insert([payload]);
            if (error) throw error;
        }

        closePriceModal();
        await fetchCustomerPrices();
    } catch (err) {
        alert("Fiyatlama kaydı hatası: " + err.message);
    }
}

async function handleDeletePrice() {
    const id = document.getElementById('price-id').value;
    if (!id || !confirm("Bu müşteri özel fiyat tanımını silmek istediğinize emin misiniz?")) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase
            .from('customer_prices')
            .delete()
            .eq('id', id)
            .eq('user_id', session.user.id);

        if (error) throw error;
        closePriceModal();
        await fetchCustomerPrices();
    } catch (err) {
        console.error(err.message);
    }
}

// --- YARDIMCI FİLTRE VE PARSE METOTLARI ---
function parseTurkishFloat(value) {
    if (!value) return 0;
    let clean = value.toString().trim();
    if (clean.includes('.') && clean.includes(',')) {
        clean = clean.replace(/\./g, '').replace(/,/g, '.');
    } else if (clean.includes(',')) {
        clean = clean.replace(/,/g, '.');
    }
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
}

function applyPriceFilters() {
    const searchVal = document.getElementById('price-search-input').value.toLowerCase();
    const filtered = globalPrices.filter(p => {
        const compName = p.customers ? p.customers.company_name.toLowerCase() : '';
        const prodName = p.product_name.toLowerCase();
        return compName.includes(searchVal) || prodName.includes(searchVal);
    });
    renderPricesTable(filtered);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function exportPricesToCSV() {
    if (globalPrices.length === 0) {
        alert("Aktarılacak veri yok.");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,\\uFEFFMusteri;Urun Adi;Liste Fiyati;Iskonto Orani;Net Fiyat\n";
    globalPrices.forEach(p => {
        const compName = p.customers ? p.customers.company_name : 'Bilinmeyen Müşteri';
        csvContent += `"${compName}";"${p.product_name}";"${p.list_price}";"%${p.discount_rate}";"${p.net_price}"\n`;
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `Export_Fiyat_Robotu_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}