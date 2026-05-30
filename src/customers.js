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
            .eq('user_id', session.user.id)
            .order('country', { ascending: true })
            .order('company_name', { ascending: true });

        if (error) throw error;

        globalCustomers = customers;
        populateCountryFilter(customers);
        populateOwnerFilter(customers);
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

    // Özet banner
    const totalAll = globalCustomers.length;
    const totalActive = globalCustomers.filter(c => c.status === 'Aktif').length;
    const totalFiltered = customersList.length;
    const filteredActive = customersList.filter(c => c.status === 'Aktif').length;
    const isFiltered = totalFiltered !== totalAll;

    const summaryEl = document.createElement('div');
    summaryEl.style.cssText = 'display:flex;align-items:center;gap:16px;padding:10px 16px;background:var(--surface);border:1px solid var(--border-soft);border-radius:8px;margin-bottom:16px;font-size:12px;';
    summaryEl.innerHTML = `
        <span style="color:var(--ink-3);">
            <i class="fa-solid fa-users" style="margin-right:5px;"></i>
            Toplam: <strong style="color:var(--ink-1);">${isFiltered ? totalFiltered + ' / ' + totalAll : totalAll}</strong>
        </span>
        <span style="width:1px;height:16px;background:var(--border);"></span>
        <span style="color:var(--ok);">
            <i class="fa-solid fa-circle-check" style="margin-right:5px;"></i>
            Aktif: <strong>${isFiltered ? filteredActive + ' / ' + totalActive : totalActive}</strong>
        </span>
        <span style="width:1px;height:16px;background:var(--border);"></span>
        <span style="color:var(--ink-3);">
            <i class="fa-solid fa-circle-minus" style="margin-right:5px;"></i>
            Pasif: <strong>${isFiltered ? (totalFiltered - filteredActive) + ' / ' + (totalAll - totalActive) : (totalAll - totalActive)}</strong>
        </span>
    `;
    container.appendChild(summaryEl);

    if (customersList.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 bg-[#FBF8F1]/20 border border-[#EFEAE0] border-dashed rounded-xl">
                <i class="fa-solid fa-users-slash text-slate-600 text-3xl mb-3"></i>
                <p class="text-[#968B7A] text-sm">Kriterlere uygun müşteri kaydı bulunamadı.</p>
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
        groupCard.className = "bg-[#FBF8F1]/40 border border-[#EFEAE0] rounded-xl overflow-hidden shadow-md";

        groupCard.innerHTML = `
            <div class="bg-[#FBF8F1]/80 px-6 py-4 flex items-center justify-between cursor-pointer border-b border-[#EFEAE0]/60 select-none toggle-group-btn">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-chevron-down text-xs text-[#968B7A] transition-transform duration-200"></i>
                    <span class="font-bold text-[#1C1A17] tracking-wide">${country.toUpperCase()}</span>
                    <span class="px-2 py-0.5 text-[11px] font-semibold border rounded-full" style="background:var(--accent-soft);color:var(--accent);border-color:rgba(45,74,62,0.20);">${itemCount} Müşteri</span>
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
                            <th>Sorumlu</th>
                            <th>Ödeme / Birim</th>
                            <th>Durum</th>
                            <th>Kısa Bilgi</th>
                            <th style="text-align:right;padding-right:1rem;">İşlem</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${grouped[country].map(cust => `
                            <tr>
                                <td class="font-medium text-[#1C1A17]">${escapeHtml(cust.company_name)}</td>
                                <td class="text-[#6B655B]">${escapeHtml(cust.contact_name || '—')}</td>
                                <td>
                                    <div class="text-xs">${escapeHtml(cust.email || '—')}</div>
                                    <div class="text-xs text-[#968B7A]">${escapeHtml(cust.phone || '')}</div>
                                </td>
                                <td>
                                    <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${getGroupBadgeClass(cust.client_group)}">
                                        ${cust.client_group || 'Toptancı'}
                                    </span>
                                </td>
                                <td class="text-[#6B655B] text-xs">${escapeHtml((cust.account_owner && cust.account_owner !== 'Atanmadı') ? cust.account_owner : '—')}</td>
                                <td class="text-xs">
                                    <div class="text-[#6B655B]">${escapeHtml(cust.payment_term || '—')}</div>
                                    <div class="text-[#968B7A]">${escapeHtml(cust.incoterms || '')} · ${escapeHtml(cust.currency || '')}</div>
                                </td>
                                <td>
                                    <span class="px-2 py-0.5 rounded text-xs font-semibold ${getStatusBadgeClass(cust.status)}">
                                        ${cust.status || 'Aktif'}
                                    </span>
                                </td>
                                <td class="text-[#6B655B] text-xs max-w-[200px]">
                                    <span class="block truncate" title="${escapeHtml(cust.short_info || '')}">${escapeHtml(cust.short_info || '—')}</span>
                                </td>
                                <td class="text-right">
                                    <button class="btn-edit-trigger text-xs bg-[#FBF8F1] hover:bg-slate-700 border border-[#E4DDCE] hover:border-slate-600 px-3 py-1.5 rounded-md text-blue-400 transition-colors" data-id="${cust.id}">
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
    document.getElementById('filter-region').addEventListener('change', applyFilters);
    document.getElementById('filter-country').addEventListener('change', applyFilters);
    document.getElementById('filter-group').addEventListener('change', applyFilters);
    document.getElementById('filter-owner').addEventListener('change', applyFilters);
    document.getElementById('btn-export-excel').addEventListener('click', exportToCSV);

    // Metin alanlarına otomatik sentence-case uygula (email hariç)
    applySentenceCaseListeners();

    // Ülke yazıldıkça/değiştikçe bölgeyi otomatik doldur
    const countryInput = document.getElementById('country');
    if (countryInput) {
        countryInput.addEventListener('input', () => {
            document.getElementById('region').value = getRegion(countryInput.value);
        });
    }
}

// --- MODAL YÖNETİMİ ---
function openModalForCreate() {
    document.getElementById('customer-form').reset();
    document.getElementById('customer-id').value = '';
    // Yeni kayıtta mantıklı varsayılanlar
    document.getElementById('currency').value = 'EUR';
    document.getElementById('incoterms').value = 'FOB';
    document.getElementById('payment_term').value = 'Peşin';
    document.getElementById('acquisition_source').value = 'Diğer';
    document.getElementById('region').value = '';
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
    document.getElementById('client_group').value = customer.client_group || 'Toptancı';
    document.getElementById('status').value = customer.status || 'Aktif';

    // Ticari Bilgiler (BI - zorunlu)
    document.getElementById('currency').value = customer.currency || 'EUR';
    document.getElementById('incoterms').value = customer.incoterms || 'FOB';
    document.getElementById('payment_term').value = customer.payment_term || 'Peşin';
    document.getElementById('acquisition_source').value = customer.acquisition_source || 'Diğer';
    document.getElementById('account_owner').value = (customer.account_owner && customer.account_owner !== 'Atanmadı') ? customer.account_owner : '';
    document.getElementById('vat_number').value = customer.vat_number || '';

    // Segmentasyon & Risk
    document.getElementById('language').value = customer.language || '';
    document.getElementById('risk_score').value = customer.risk_score != null ? String(customer.risk_score) : '';
    document.getElementById('credit_limit').value = customer.credit_limit != null ? customer.credit_limit : '';
    document.getElementById('annual_volume_target').value = customer.annual_volume_target != null ? customer.annual_volume_target : '';
    document.getElementById('product_interests').value = customer.product_interests || '';
    document.getElementById('first_order_date').value = customer.first_order_date || '';
    document.getElementById('last_order_date').value = customer.last_order_date || '';

    // Bölge: kayıttaki değer yoksa ülkeden türet
    document.getElementById('region').value = customer.region || getRegion(customer.country) || '';

    // Geçmiş alanları
    document.getElementById('history_date_1').value = customer.history_date_1 || '';
    document.getElementById('history_note_1').value = customer.history_note_1 || '';
    document.getElementById('history_date_2').value = customer.history_date_2 || '';
    document.getElementById('history_note_2').value = customer.history_note_2 || '';
    document.getElementById('history_date_3').value = customer.history_date_3 || '';
    document.getElementById('history_note_3').value = customer.history_note_3 || '';
    document.getElementById('short_info').value = customer.short_info || '';

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

    // Yardımcı: ham string (sentence-case uygulamadan), boşsa null
    const raw = (id) => {
        const v = document.getElementById(id).value.trim();
        return v || null;
    };

    // Yardımcı: sayısal alan, boşsa null
    const num = (id) => {
        const v = document.getElementById(id).value.trim();
        if (v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const countryVal = sc('country');

    const payload = {
        company_name: sc('company_name'),
        country:      countryVal,
        contact_name: sc('contact_name'),
        email:        document.getElementById('email').value.trim() || null,
        phone:        sc('phone'),
        website:      sc('website'),
        client_group: document.getElementById('client_group').value,
        status:       document.getElementById('status').value,
        short_info:   document.getElementById('short_info').value.trim() || null,

        // --- Ticari Bilgiler (BI - zorunlu) ---
        currency:           document.getElementById('currency').value,
        incoterms:          document.getElementById('incoterms').value,
        payment_term:       document.getElementById('payment_term').value,
        acquisition_source: document.getElementById('acquisition_source').value,
        account_owner:      sc('account_owner') || 'Atanmadı',
        vat_number:         raw('vat_number'),

        // --- Segmentasyon & Risk ---
        region:               getRegion(countryVal),
        language:             document.getElementById('language').value || null,
        risk_score:           num('risk_score'),
        credit_limit:         num('credit_limit'),
        annual_volume_target: num('annual_volume_target'),
        product_interests:    sc('product_interests'),
        first_order_date:     document.getElementById('first_order_date').value || null,
        last_order_date:      document.getElementById('last_order_date').value || null,

        // --- Geçmiş / Notlar ---
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
            if (error.code === '23503') {
                alert("Bu müşteri silinemez!\nMüşteriye ait sipariş, özel fiyat veya credit note kaydı bulunmaktadır.\nÖnce ilgili kayıtları siliniz.");
            } else {
                alert("Silme işlemi başarısız oldu: " + error.message);
            }
        }
    }
}

// --- BÖLGE HARİTASI ---
const REGION_MAP = {
    // AVRUPA
    'ALMANYA': 'Avrupa', 'ARNAVUTLUK': 'Avrupa', 'AVUSTRALYA': 'Avrupa',
    'AVUSTURYA': 'Avrupa', 'BOSNA HERSEK': 'Avrupa',
    'BULGARİSTAN': 'Avrupa', 'ÇEKYA': 'Avrupa', 'ESTONYA': 'Avrupa',
    'FRANSA': 'Avrupa', 'HIRVATİSTAN': 'Avrupa', 'İNGİLTERE': 'Avrupa',
    'İTALYA': 'Avrupa', 'KARADAĞ': 'Avrupa', 'KOSOVA': 'Avrupa',
    'LİTVANYA': 'Avrupa', 'MACARİSTAN': 'Avrupa', 'MAKEDONYA': 'Avrupa',
    'MOLDOVA': 'Avrupa', 'ROMANYA': 'Avrupa', 'SIRBİSTAN': 'Avrupa',
    'YUNANİSTAN': 'Avrupa',
    // ASYA
    'AZERBAYCAN': 'Asya', 'GÜRCİSTAN': 'Asya', 'TÜRKİYE': 'Asya',
    'TÜRKMENİSTAN': 'Asya', 'KIBRIS': 'Asya', 'RUSYA': 'Asya',
    'BANGLADEŞ': 'Asya', 'HİNDİSTAN': 'Asya', 'PAKİSTAN': 'Asya',
    // ORTA DOĞU
    'B.A.E': 'Orta Doğu', 'BAHREYN': 'Orta Doğu',
    'FİLİSTİN': 'Orta Doğu', 'IRAK': 'Orta Doğu',
    'İRAN': 'Orta Doğu', 'İSRAİL': 'Orta Doğu',
    'KATAR': 'Orta Doğu', 'KUVEYT': 'Orta Doğu', 'LÜBNAN': 'Orta Doğu',
    'SUUDİ ARABİSTAN': 'Orta Doğu', 'UMMAN': 'Orta Doğu', 'ÜRDÜN': 'Orta Doğu',
    // AFRİKA
    'CEZAYİR': 'Afrika', 'ETİYOPYA': 'Afrika', 'FAS': 'Afrika',
    'FİLDİŞİ SAHİLİ': 'Afrika', 'GANA': 'Afrika', 'GİNE': 'Afrika',
    'KAMERUN': 'Afrika', 'LİBYA': 'Afrika',
    'MAURİTİUS': 'Afrika', 'MISIR': 'Afrika', 'NİJERYA': 'Afrika',
    'SENEGAL': 'Afrika', 'SOMALİ': 'Afrika', 'SUDAN': 'Afrika',
    'TUNUS': 'Afrika',
};

function getRegion(country) {
    if (!country) return 'Diğer';
    // Normalize: trim + uppercase TR
    const normalized = country.trim().toLocaleUpperCase('tr-TR');
    return REGION_MAP[normalized] || 'Diğer';
}

// --- FİLTRELEME ---
function applyFilters() {
    const searchVal  = document.getElementById('search-input').value.toLowerCase();
    const regionVal  = document.getElementById('filter-region').value;
    const countryVal = document.getElementById('filter-country').value;
    const groupVal   = document.getElementById('filter-group').value;
    const ownerVal   = document.getElementById('filter-owner').value;

    const filtered = globalCustomers.filter(c => {
        const matchSearch =
            c.company_name.toLowerCase().includes(searchVal) ||
            c.country.toLowerCase().includes(searchVal) ||
            (c.contact_name || '').toLowerCase().includes(searchVal);
        const matchRegion  = regionVal  === "" || getRegion(c.country) === regionVal;
        const matchCountry = countryVal === "" || c.country === countryVal;
        const matchGroup   = groupVal   === "" || c.client_group === groupVal;
        const matchOwner   = ownerVal   === "" || (c.account_owner || '') === ownerVal;
        return matchSearch && matchRegion && matchCountry && matchGroup && matchOwner;
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

function populateOwnerFilter(customers) {
    const filterSelect = document.getElementById('filter-owner');
    if (!filterSelect) return;
    const savedValue = filterSelect.value;
    const owners = [...new Set(
        customers.map(c => c.account_owner).filter(o => o && o !== 'Atanmadı')
    )].sort();
    filterSelect.innerHTML = '<option value="">Tüm Sorumlular (Filtrele)</option>';
    owners.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        filterSelect.appendChild(opt);
    });
    filterSelect.value = savedValue;
}

function getGroupBadgeClass(group) {
    switch(group) {
        case 'Distribütör': return 'bg-[#DCE7F0] text-[#2C4A6E] border-[#B0C6DE]';
        case 'Toptancı':    return 'bg-[#E8EEEA] text-[#2D4A3E] border-[#C5D5CC]';
        case 'Bayi':        return 'bg-[#E6EFE9] text-[#3D6E50] border-[#BCD4C4]';
        case 'Üretici':     return 'bg-[#F2E9DA] text-[#B58858] border-[#E4CCAA]';
        case 'Perakendeci': return 'bg-[#EAE6F0] text-[#5A4A7A] border-[#C8BEE0]';
        case 'Projeci':     return 'bg-[#E0E6EE] text-[#3F5C7A] border-[#B8C8DC]';
        case 'OEM':         return 'bg-[#F0E6E6] text-[#7A4A4A] border-[#DEBEBE]';
        default:            return 'bg-[#FBF8F1] text-[#6B655B] border-[#E4DDCE]/60';
    }
}

function getStatusBadgeClass(status) {
    switch(status) {
        case 'Aktif': return 'bg-emerald-950/50 text-[#3D6E50]';
        case 'Pasif': return 'bg-[#FBF8F1] text-[#968B7A]';
        case 'Potansiyel': return 'bg-amber-950/40 text-[#B26B33]';
        default: return 'bg-emerald-950/50 text-[#3D6E50]';
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
    csvContent += "Firma Adı;Ülke;Bölge;Yetkili;E-Posta;Telefon;Web;Müşteri Tipi;Sorumlu;Para Birimi;Incoterms;Ödeme Koşulu;Edinme Kaynağı;Vergi No;Dil;Risk Skoru;Kredi Limiti;Yıllık Hedef;Ürün İlgi;İlk İşlem;Son İşlem;Durum;Kısa Bilgi\n";

    globalCustomers.forEach(c => {
        const q = v => `"${(v == null ? '' : v).toString().replace(/"/g, '""')}"`;
        csvContent += [
            q(c.company_name), q(c.country), q(c.region || getRegion(c.country)), q(c.contact_name),
            q(c.email), q(c.phone), q(c.website),
            q(c.client_group || 'Toptancı'),
            q((c.account_owner && c.account_owner !== 'Atanmadı') ? c.account_owner : ''),
            q(c.currency), q(c.incoterms), q(c.payment_term), q(c.acquisition_source),
            q(c.vat_number), q(c.language), q(c.risk_score), q(c.credit_limit),
            q(c.annual_volume_target), q(c.product_interests),
            q(c.first_order_date), q(c.last_order_date),
            q(c.status || 'Aktif'), q(c.short_info)
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
