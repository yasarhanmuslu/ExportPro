import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// Global Müşteri Hafızası (Arama ve filtreleme işlemlerinde performansı korumak için)
let globalCustomers = [];

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    // 1. Ortak Navbar'ı Yükle ('customers' aktif)
    await renderNavbar('customers');

    // 2. İlk Veri Çekimini Yap
    await fetchCustomers();

    // 3. Olay Dinleyicilerini (Event Listeners) Tanımla
    initEventListeners();
});

// --- VERİ ÇEKME FONKSİYONU ---
async function fetchCustomers() {
    try {
        // Oturum açan kullanıcının ID'sini çek
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Supabase'den müşterileri getir (RLS otomatik olarak sadece kullanıcıya ait verileri döner)
        const { data: customers, error } = await supabase
            .from('customers')
            .select('*')
            .order('country', { ascending: true })
            .order('company_name', { ascending: true });

        if (error) throw error;

        globalCustomers = customers;

        // Filtre kutularındaki ülke seçeneklerini dinamik güncelle
        populateCountryFilter(customers);

        // Arayüzü Çiz
        renderCustomersList(customers);

    } catch (error) {
        console.error("Müşteri listesi çekilemedi:", error.message);
        alert("Müşteri verileri yüklenirken hata oluştu.");
    }
}

// --- ARAYÜZ LİSTELEME VE ÜLKE GRUPLAMA FONKSİYONU ---
function renderCustomersList(customersList) {
    const container = document.getElementById('customers-list-container');
    container.innerHTML = '';

    if (customersList.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 bg-slate-900/20 border border-slate-800 border-dashed rounded-xl">
                <i class="fa-solid fa-users-slash text-slate-600 text-3xl mb-3"></i>
                <p class="text-slate-500 text-sm">Kriterlere uygun müşteri kaydı bulunamadı.</p>
            </div>`;
        return;
    }

    // Ülkelere göre grupla (Örn: {"Almanya": [...], "Fransa": [...]})
    const grouped = {};
    customersList.forEach(cust => {
        const countryKey = cust.country.trim();
        if (!grouped[countryKey]) grouped[countryKey] = [];
        grouped[countryKey].push(cust);
    });

    // Her ülke grubu için akordeon arayüz kartı oluştur
    Object.keys(grouped).forEach(country => {
        const itemCount = grouped[country].length;
        
        const groupCard = document.createElement('div');
        groupCard.className = "bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden shadow-md";
        
        groupCard.innerHTML = `
            <div class="bg-slate-900/80 px-6 py-4 flex items-center justify-between cursor-pointer border-b border-slate-800/60 select-none toggle-group-btn">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-chevron-down text-xs text-slate-500 transition-transform duration-200"></i>
                    <span class="font-bold text-white tracking-wide">${country.toUpperCase()}</span>
                    <span class="px-2 py-0.5 bg-blue-950 text-blue-400 text-[11px] font-semibold border border-blue-900/50 rounded-full">${itemCount} Müşteri</span>
                </div>
            </div>
            <div class="custom-table-container border-0 rounded-none transition-all duration-200">
                <table class="custom-table">
                    <thead>
                        <tr>
                            <th>Firma Ünvanı</th>
                            <th>Müşteri Grubu</th>
                            <th>Kayıt Tarihi</th>
                            <th class="text-right">İşlem</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${grouped[country].map(cust => `
                            <tr>
                                <td class="font-medium text-slate-200">${escapeHtml(cust.company_name)}</td>
                                <td>
                                    <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${getGroupBadgeClass(cust.client_group)}">
                                        ${cust.client_group || 'Standart'}
                                    </span>
                                </td>
                                <td class="text-slate-400 text-xs">${new Date(cust.created_at).toLocaleDateString('tr-TR')}</td>
                                <td class="text-right">
                                    <button class="btn-edit-trigger text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 px-3 py-1.5 rounded-md text-blue-400 transition-colors" data-id="${cust.id}">
                                        <i class="fa-solid fa-pen-to-square"></i> Düzenle
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        container.appendChild(groupCard);
    });

    // Akordeon Açma/Kapama İşlevselliği
    container.querySelectorAll('.toggle-group-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const content = btn.nextElementSibling;
            const icon = btn.querySelector('.fa-chevron-down');
            content.classList.toggle('hidden');
            icon.classList.toggle('-rotate-90');
        });
    });

    // Satır içi düzenle butonlarını tetikle
    container.querySelectorAll('.btn-edit-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openModalForEdit(id);
        });
    });
}

// --- OLAY DİNLEYİCİLER (EVENTS) ---
function initEventListeners() {
    // Modal Açma/Kapama
    document.getElementById('btn-open-modal').addEventListener('click', () => openModalForCreate());
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);

    // Form Gönderimi (Ekleme ve Güncelleme)
    document.getElementById('customer-form').addEventListener('submit', handleFormSubmit);

    // Kayıt Silme Olayı
    document.getElementById('btn-delete-customer').addEventListener('click', handleDeleteCustomer);

    // Canlı Arama ve Filtreleme Filtreleri
    document.getElementById('search-input').addEventListener('input', applyFilters);
    document.getElementById('filter-country').addEventListener('change', applyFilters);
    document.getElementById('filter-group').addEventListener('change', applyFilters);

    // Excel Export
    document.getElementById('btn-export-excel').addEventListener('click', exportToCSV);
}

// --- MODAL YÖNETİMİ ---
function openModalForCreate() {
    document.getElementById('customer-form').reset();
    document.getElementById('customer-id').value = '';
    document.getElementById('modal-title').innerHTML = `<i class="fa-solid fa-user-plus text-blue-500"></i> Yeni Müşteri Kaydı`;
    document.getElementById('btn-delete-customer').classList.add('hidden');
    document.getElementById('customer-modal').classList.remove('hidden');
}

function openModalForEdit(id) {
    const customer = globalCustomers.find(c => c.id === id);
    if (!customer) return;

    document.getElementById('customer-id').value = customer.id;
    document.getElementById('company_name').value = customer.company_name;
    document.getElementById('country').value = customer.country;
    document.getElementById('client_group').value = customer.client_group || 'Standart';

    document.getElementById('modal-title').innerHTML = `<i class="fa-solid fa-pen-to-square text-amber-500"></i> Müşteri Kaydını Düzenle`;
    document.getElementById('btn-delete-customer').classList.remove('hidden');
    document.getElementById('customer-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('customer-modal').classList.add('hidden');
}

// --- FORM GÖNDERİMİ (INSERT / UPDATE) ---
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('customer-id').value;
    const company_name = document.getElementById('company_name').value.trim();
    const country = document.getElementById('country').value.trim();
    const client_group = document.getElementById('client_group').value;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Oturum bulunamadı.");

        const userId = session.user.id;

        if (id) {
            // GÜNCELLEME İŞLEMİ (UPDATE)
            const { error } = await supabase
                .from('customers')
                .update({ company_name, country, client_group, updated_at: new Date().toISOString() })
                .eq('id', id)
                .eq('user_id', userId); // RLS Ek Güvenlik Önlemi

            if (error) throw error;
        } else {
            // EKLEME İŞLEMİ (INSERT)
            const { error } = await supabase
                .from('customers')
                .insert([{ user_id: userId, company_name, country, client_group }]);

            if (error) throw error;
        }

        closeModal();
        await fetchCustomers(); // Listeyi yenile

    } catch (error) {
        console.error("Müşteri kaydedilemedi:", error.message);
        alert("Kayıt sırasında bir hata oluştu: " + error.message);
    }
}

// --- KAYIT SİLME İŞLEMİ (DELETE) ---
async function handleDeleteCustomer() {
    const id = document.getElementById('customer-id').value;
    if (!id) return;

    if (confirm("Bu müşteriyi silmek istediğinize emin misiniz? Bu işlem müşteriye bağlı tüm sipariş ve fiyat ilişkilerini de etkileyebilir!")) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const { error } = await supabase
                .from('customers')
                .delete()
                .eq('id', id)
                .eq('user_id', session.user.id);

            if (error) throw error;

            closeModal();
            await fetchCustomers();

        } catch (error) {
            console.error("Müşteri silinemedi:", error.message);
            alert("Silme işlemi başarısız oldu.");
        }
    }
}

// --- FİLTRELEME MANTIĞI ---
function applyFilters() {
    const searchVal = document.getElementById('search-input').value.toLowerCase();
    const countryVal = document.getElementById('filter-country').value;
    const groupVal = document.getElementById('filter-group').value;

    const filtered = globalCustomers.filter(c => {
        const matchSearch = c.company_name.toLowerCase().includes(searchVal) || c.country.toLowerCase().includes(searchVal);
        const matchCountry = countryVal === "" || c.country === countryVal;
        const matchGroup = groupVal === "" || c.client_group === groupVal;
        return matchSearch && matchCountry && matchGroup;
    });

    renderCustomersList(filtered);
}

// --- YARDIMCI METOTLAR ---
function populateCountryFilter(customers) {
    const filterSelect = document.getElementById('filter-country');
    const savedValue = filterSelect.value;
    
    // Benzersiz ülkeleri ayıkla
    const countries = [...new Set(customers.map(c => c.country))].sort();
    
    filterSelect.innerHTML = '<option value="">Tüm Ülkeler (Filtrele)</option>';
    countries.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        filterSelect.appendChild(opt);
    });

    filterSelect.value = savedValue;
}

function getGroupBadgeClass(group) {
    switch(group) {
        case 'VIP': return 'bg-amber-950/40 text-amber-400 border-amber-900/50';
        case 'Stratejik': return 'bg-purple-950/40 text-purple-400 border-purple-900/50';
        case 'Potansiyel': return 'bg-rose-950/40 text-rose-400 border-rose-900/50';
        default: return 'bg-slate-800 text-slate-400 border-slate-700/60';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- EXCEL/CSV METNİNE AKTARMA SÜRECİ ---
function exportToCSV() {
    if (globalCustomers.length === 0) {
        alert("Dışa aktarılacak veri bulunamadı.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\\uFEFF";
    csvContent += "Firma Adi;Ulke;Musteri Grubu;Kayit Tarihi\n";

    globalCustomers.forEach(c => {
        const regDate = new Date(c.created_at).toLocaleDateString('tr-TR');
        csvContent += `"${c.company_name.replace(/"/g, '""')}";"${c.country.replace(/"/g, '""')}";"${c.client_group || 'Standart'}";"${regDate}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Export_Musteri_Arsivi_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}