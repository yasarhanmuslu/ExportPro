import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// Global Müşteri Hafızası
let globalCustomers = [];

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    await renderNavbar('customers');
    await fetchCustomers();
    initEventListeners();
});

// --- VERİ ÇEKME ---
async function fetchCustomers() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data: customers, error } = await supabase
            .from('customers')
            .select('*')
            .order('country', { ascending: true })
            .order('company_name', { ascending: true });

        if (error) throw error;

        globalCustomers = customers;
        populateCountryFilter(customers);
        renderCustomersList(customers);

    } catch (error) {
        console.error("Müşteri listesi çekilemedi:", error.message);
        alert("Müşteri verileri yüklenirken hata oluştu.");
    }
}

// --- LİSTELEME ---
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

    const grouped = {};
    customersList.forEach(cust => {
        const countryKey = cust.country.trim();
        if (!grouped[countryKey]) grouped[countryKey] = [];
        grouped[countryKey].push(cust);
    });

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
                            <th>Yetkili</th>
                            <th>E-Posta / Telefon</th>
                            <th>Müşteri Tipi</th>
                            <th>Durum</th>
                            <th>Kayıt Tarihi</th>
                            <th class="text-right">İşlem</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${grouped[country].map(cust => `
                            <tr>
                                <td class="font-medium text-slate-200">${escapeHtml(cust.company_name)}</td>
                                <td class="text-slate-300">${escapeHtml(cust.contact_name || '—')}</td>
                                <td>
                                    <div class="text-xs">${escapeHtml(cust.email || '—')}</div>
                                    <div class="text-xs text-slate-500">${escapeHtml(cust.phone || '')}</div>
                                </td>
                                <td>
                                    <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${getGroupBadgeClass(cust.client_group)}">
                                        ${cust.client_group || 'Standart'}
                                    </span>
                                </td>
                                <td>
                                    <span class="px-2 py-0.5 rounded text-xs font-semibold ${getStatusBadgeClass(cust.status)}">
                                        ${cust.status || 'Aktif'}
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

    container.querySelectorAll('.toggle-group-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const content = btn.nextElementSibling;
            const icon = btn.querySelector('.fa-chevron-down');
            content.classList.toggle('hidden');
            icon.classList.toggle('-rotate-90');
        });
    });

    container.querySelectorAll('.btn-edit-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openModalForEdit(id);
        });
    });
}

// --- OLAY DİNLEYİCİLER ---
function initEventListeners() {
    document.getElementById('btn-open-modal').addEventListener('click', () => openModalForCreate());
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    document.getElementById('customer-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('btn-delete-customer').addEventListener('click', handleDeleteCustomer);
    document.getElementById('search-input').addEventListener('input', applyFilters);
    document.getElementById('filter-country').addEventListener('change', applyFilters);
    document.getElementById('filter-group').addEventListener('change', applyFilters);
    document.getElementById('btn-export-excel').addEventListener('click', exportToCSV);

    // Metin alanlarına otomatik sentence-case uygula (email hariç)
    applySentenceCaseListeners();
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
    document.getElementById('company_name').value = customer.company_name || '';
    document.getElementById('country').value = customer.country || '';
    document.getElementById('contact_name').value = customer.contact_name || '';
    document.getElementById('email').value = customer.email || '';
    document.getElementById('phone').value = customer.phone || '';
    document.getElementById('website').value = customer.website || '';
    document.getElementById('client_group').value = customer.client_group || 'Standart';
    document.getElementById('status').value = customer.status || 'Aktif';

    // Geçmiş alanları
    document.getElementById('history_date_1').value = customer.history_date_1 || '';
    document.getElementById('history_note_1').value = customer.history_note_1 || '';
    document.getElementById('history_date_2').value = customer.history_date_2 || '';
    document.getElementById('history_note_2').value = customer.history_note_2 || '';
    document.getElementById('history_date_3').value = customer.history_date_3 || '';
    document.getElementById('history_note_3').value = customer.history_note_3 || '';

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

    // Yardımcı: string alanları trim + sentence-case uygula (email hariç)
    const sc = (id) => {
        const v = document.getElementById(id).value.trim();
        return v ? toSentenceCase(v) : null;
    };

    const payload = {
        company_name: sc('company_name'),
        country:      sc('country'),
        contact_name: sc('contact_name'),
        email:        document.getElementById('email').value.trim() || null,
        phone:        sc('phone'),
        website:      sc('website'),
        client_group: document.getElementById('client_group').value,
        status:       document.getElementById('status').value,
        history_date_1: document.getElementById('history_date_1').value || null,
        history_note_1: sc('history_note_1'),
        history_date_2: document.getElementById('history_date_2').value || null,
        history_note_2: sc('history_note_2'),
        history_date_3: document.getElementById('history_date_3').value || null,
        history_note_3: sc('history_note_3'),
        updated_at:   new Date().toISOString(),
    };

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Oturum bulunamadı.");
        const userId = session.user.id;

        if (id) {
            const { error } = await supabase
                .from('customers')
                .update(payload)
                .eq('id', id)
                .eq('user_id', userId);
            if (error) throw error;
        } else {
            const { error } = await supabase
                .from('customers')
                .insert([{ ...payload, user_id: userId }]);
            if (error) throw error;
        }

        closeModal();
        await fetchCustomers();

    } catch (error) {
        console.error("Müşteri kaydedilemedi:", error.message);
        alert("Kayıt sırasında bir hata oluştu: " + error.message);
    }
}

// --- KAYIT SİLME ---
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

// --- FİLTRELEME ---
function applyFilters() {
    const searchVal = document.getElementById('search-input').value.toLowerCase();
    const countryVal = document.getElementById('filter-country').value;
    const groupVal = document.getElementById('filter-group').value;

    const filtered = globalCustomers.filter(c => {
        const matchSearch =
            c.company_name.toLowerCase().includes(searchVal) ||
            c.country.toLowerCase().includes(searchVal) ||
            (c.contact_name || '').toLowerCase().includes(searchVal);
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
        case 'Stratejik': return 'bg-[rgba(228,90,128,0.12)] text-[#E45A80] border-[rgba(228,90,128,0.25)]';
        case 'Potansiyel': return 'bg-rose-950/40 text-rose-400 border-rose-900/50';
        default: return 'bg-slate-800 text-slate-400 border-slate-700/60';
    }
}

function getStatusBadgeClass(status) {
    switch(status) {
        case 'Aktif': return 'bg-emerald-950/50 text-emerald-400';
        case 'Pasif': return 'bg-slate-800 text-slate-500';
        case 'Potansiyel': return 'bg-amber-950/40 text-amber-400';
        default: return 'bg-emerald-950/50 text-emerald-400';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- SENTENCE CASE (Türkçe uyumlu) ---
// Tüm metni önce küçük harfe çevirir, sonra ilk harfi büyük yapar.
// Bu sayede CAPS LOCK, copy-paste, tümü büyük girişler düzgün normalize edilir.
function toSentenceCase(str) {
    if (!str) return str;
    const lower = str.toLocaleLowerCase('tr-TR');
    return lower.charAt(0).toLocaleUpperCase('tr-TR') + lower.slice(1);
}

// Belirtilen input ID'lerinde anlık sentence-case uygular.
// Cursor pozisyonu korunur (ortadan silip yazarken bozulmasın).
function applySentenceCaseListeners() {
    const CAPITALIZE_IDS = ['company_name', 'country', 'contact_name', 'phone', 'website',
                            'history_note_1', 'history_note_2', 'history_note_3'];

    CAPITALIZE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function () {
            const start = this.selectionStart;
            const end   = this.selectionEnd;
            const original = this.value;
            const converted = toSentenceCase(original);
            if (original !== converted) {
                this.value = converted;
                // Cursor'u eski pozisyona geri taşı
                this.setSelectionRange(start, end);
            }
        });
    });
}

// --- EXCEL/CSV AKTARMA ---
function exportToCSV() {
    if (globalCustomers.length === 0) {
        alert("Dışa aktarılacak veri bulunamadı.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "Firma Adı;Ülke;Yetkili;E-Posta;Telefon;Web;Müşteri Tipi;Durum;Kayıt Tarihi\n";

    globalCustomers.forEach(c => {
        const regDate = new Date(c.created_at).toLocaleDateString('tr-TR');
        const q = v => `"${(v || '').toString().replace(/"/g, '""')}"`;
        csvContent += [
            q(c.company_name), q(c.country), q(c.contact_name),
            q(c.email), q(c.phone), q(c.website),
            q(c.client_group || 'Standart'), q(c.status || 'Aktif'), q(regDate)
        ].join(';') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Export_Musteri_Arsivi_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
