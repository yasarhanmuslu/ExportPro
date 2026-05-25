import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// Global Hafıza Yapıları
let globalCreditNotes = [];
let globalCustomers = [];

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    // 1. Ortak Navbar'ı Çalıştır ('credit-notes' aktif)
    await renderNavbar('credit-notes');

    // 2. Müşteri Bilgilerini ve Credit Note Dosyalarını Çek
    await Promise.all([fetchCustomersForCN(), fetchCreditNotesData()]);

    // 3. Etkinlik Dinleyicilerini Başlat
    initCNEventListeners();
});

// --- VERİ ÇEKME METOTLARI ---
async function fetchCustomersForCN() {
    try {
        const { data: customers, error } = await supabase
            .from('customers')
            .select('id, company_name, country')
            .order('company_name', { ascending: true });

        if (error) throw error;
        globalCustomers = customers;

        const select = document.getElementById('cn-customer-select');
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

async function fetchCreditNotesData() {
    try {
        // Master tablosu ile birlikte ilişkili Detail öğelerini ve Müşteri ismini tek sorguda (nested join) çekiyoruz
        const { data: notes, error } = await supabase
            .from('credit_notes')
            .select(`
                *,
                customers!credit_notes_customer_id_fkey ( company_name ),
                credit_note_items ( * )
            `)
            .order('cn_date', { ascending: false });

        if (error) throw error;
        globalCreditNotes = notes;

        renderCNTable(notes);
    } catch (err) {
        console.error("Credit Note verileri yüklenemedi:", err.message);
        document.getElementById('cn-table-body').innerHTML = `<tr><td colspan="5" class="text-center text-[#9F3D3D] py-4">Veriler yüklenirken hata oluştu.</td></tr>`;
    }
}

// --- ANA LİSTE TABLOSUNU ÇİZMEK ---
function renderCNTable(notesList) {
    const tbody = document.getElementById('cn-table-body');
    const badge = document.getElementById('total-cn-records');
    tbody.innerHTML = '';

    badge.textContent = `${notesList.length} Dosya`;

    if (notesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-[#968B7A] py-8">Kayıtlı Credit Note / Kalite şikayet dosyası bulunamadı.</td></tr>`;
        return;
    }

    notesList.forEach(note => {
        const compName = note.customers ? note.customers.company_name : 'Bilinmeyen Müşteri';
        
        // Şikayet konusu olan ürün isimlerini yan yana birleştirip özetliyoruz
        const itemsSummary = note.credit_note_items && note.credit_note_items.length > 0
            ? note.credit_note_items.map(i => escapeHtml(i.product_name)).join(', ')
            : '<span class="text-slate-600 italic">Ürün kalemi girilmemiş</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="text-[#6B655B] text-xs font-mono">${new Date(note.cn_date).toLocaleDateString('tr-TR')}</td>
            <td class="font-semibold text-[#1C1A17]">${escapeHtml(compName)}</td>
            <td class="text-[#6B655B] text-xs max-w-xs truncate">${itemsSummary}</td>
            <td>
                <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${getStatusBadgeClass(note.process_status)}">
                    ${note.process_status || 'İncelemede'}
                </span>
            </td>
            <td class="text-center">
                <button class="btn-edit-cn-trigger text-xs bg-[#FBF8F1] hover:bg-[#FBF8F1] border border-[#EFEAE0] hover:border-[#E4DDCE] px-3 py-1.5 rounded-lg text-[#9F3D3D] transition-colors" data-id="${note.id}">
                    <i class="fa-solid fa-folder-open"></i> Dosyayı Aç
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-cn-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openModalForCNEdit(e.currentTarget.getAttribute('data-id'));
        });
    });
}

// --- EVENT LISTENERLAR VE DİNAMİK SATIR YÖNETİMİ ---
function initCNEventListeners() {
    document.getElementById('btn-open-cn-modal').addEventListener('click', openModalForCNCreate);
    document.getElementById('btn-close-cn-modal').addEventListener('click', closeCNModal);
    document.getElementById('btn-cn-cancel').addEventListener('click', closeCNModal);
    document.getElementById('cn-form').addEventListener('submit', handleCNSubmit);
    document.getElementById('btn-delete-cn').addEventListener('click', handleDeleteCN);

    document.getElementById('cn-search-input').addEventListener('input', applyCNFilters);
    document.getElementById('filter-cn-status').addEventListener('change', applyCNFilters);

    // Dinamik Yeni Ürün Satırı Ekleme Butonu Tetikleyicisi
    document.getElementById('btn-add-item-row').addEventListener('click', () => {
        addItemRow();
    });

    document.getElementById('btn-export-cn').addEventListener('click', exportCNToCSV);
}

// --- DİNAMİK SATIR EKLEME/ÇIKARMA FONKSİYONU (DETAIL) ---
function addItemRow(data = {}) {
    const container = document.getElementById('cn-items-container');
    const rowId = 'row-' + Math.random().toString(36).substring(2, 9);

    const itemRow = document.createElement('div');
    itemRow.id = rowId;
    itemRow.className = "cn-item-row bg-[#F6F3EC] p-4 border border-[#EFEAE0]/80 rounded-xl space-y-4 relative pt-10 md:pt-4";

    itemRow.innerHTML = `
        <button type="button" class="btn-remove-row absolute top-3 right-3 text-[#968B7A] hover:text-[#9F3D3D] transition-colors" title="Satırı Çıkar">
            <i class="fa-solid fa-trash-can text-sm"></i>
        </button>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Ürün Adı *</label>
                <input type="text" class="item-product-name w-full text-xs" required placeholder="Örn: X Profili" value="${data.product_name || ''}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Ürün Kodu</label>
                <input type="text" class="item-product-code w-full text-xs" placeholder="Örn: ALM-202" value="${data.product_code || ''}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Şikayet (Complaint) ID</label>
                <input type="text" class="item-complaint-id w-full text-xs" placeholder="Örn: COMP-881" value="${data.complaint_id || ''}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Karar / Sonuç</label>
                <input type="text" class="item-decision w-full text-xs" placeholder="Örn: Yenisi Üretilecek" value="${data.decision || ''}">
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-900/60 pt-3">
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">İlişkili Hedef Sipariş / Fatura</label>
                <input type="text" class="item-target-order w-full text-xs" placeholder="Örn: Order #4512" value="${data.target_order || ''}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Hata/Problem Tanımı</label>
                <input type="text" class="item-desc-1 w-full text-xs" placeholder="Örn: Yüzeyde çizik ve deformasyon" value="${data.description_1 || ''}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Kök Neden / Aksiyon Notu</label>
                <input type="text" class="item-desc-2 w-full text-xs" placeholder="Örn: Paketleme hattındaki rulo değişti" value="${data.description_2 || ''}">
            </div>
        </div>
    `;

    // Satır içindeki silme butonunu yapılandır
    itemRow.querySelector('.btn-remove-row').addEventListener('click', () => {
        // Eğer formda tek satır kaldıysa tamamen boşaltılmasına izin vermeyelim (UX)
        if (container.querySelectorAll('.cn-item-row').length > 1) {
            itemRow.remove();
        } else {
            alert("Bir Credit Note dosyasında en az bir ürün detayı bulunmalıdır.");
        }
    });

    container.appendChild(itemRow);
}

// --- MODAL AÇMA / KAPAMA ---
function openModalForCNCreate() {
    document.getElementById('cn-form').reset();
    document.getElementById('cn-id').value = '';
    document.getElementById('cn_date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cn-items-container').innerHTML = '';
    
    // Yeni kayıtlarda varsayılan olarak bir adet boş satır getiriyoruz
    addItemRow();

    document.getElementById('cn-modal-title').innerHTML = `<i class="fa-solid fa-file-medical text-rose-500"></i> Yeni Credit Note Dosyası Aç`;
    document.getElementById('btn-delete-cn').classList.add('hidden');
    document.getElementById('cn-modal').classList.remove('hidden');
}

function openModalForCNEdit(id) {
    const note = globalCreditNotes.find(n => n.id === id);
    if (!note) return;

    document.getElementById('cn-id').value = note.id;
    document.getElementById('cn-customer-select').value = note.customer_id;
    document.getElementById('cn_date').value = note.cn_date;
    document.getElementById('process_status').value = note.process_status || 'İncelemede';

    // Mevcut ilişkili detay satırlarını temizle ve veritabanındakileri çiz
    const container = document.getElementById('cn-items-container');
    container.innerHTML = '';

    if (note.credit_note_items && note.credit_note_items.length > 0) {
        note.credit_note_items.forEach(item => {
            addItemRow(item);
        });
    } else {
        addItemRow();
    }

    document.getElementById('cn-modal-title').innerHTML = `<i class="fa-solid fa-folder-open text-amber-500"></i> Dosya ve Kalite Süreç Yönetimi`;
    document.getElementById('btn-delete-cn').classList.remove('hidden');
    document.getElementById('cn-modal').classList.remove('hidden');
}

function closeCNModal() {
    document.getElementById('cn-modal').classList.add('hidden');
}

// --- MASTER-DETAIL KAYDETME SÜRECİ (TRANSACTIONAL ASENKRON CRUD) ---
async function handleCNSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('cn-id').value;
    const customer_id = document.getElementById('cn-customer-select').value;
    const cn_date = document.getElementById('cn_date').value;
    const process_status = document.getElementById('process_status').value;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session.user.id;

        let targetCnId = id;

        const masterPayload = { customer_id, cn_date, process_status };

        if (id) {
            // 1. MASTER GÜNCELLEME (UPDATE)
            const { error: masterErr } = await supabase
                .from('credit_notes')
                .update(masterPayload)
                .eq('id', id)
                .eq('user_id', userId);
            if (masterErr) throw masterErr;

            // Güncelleme mantığında en temiz mimari yöntem: Eski detail satırlarını silip yenilerini toplu basmaktır
            const { error: deleteItemsErr } = await supabase
                .from('credit_note_items')
                .delete()
                .eq('credit_note_id', id);
            if (deleteItemsErr) throw deleteItemsErr;

        } else {
            // 2. MASTER EKLEME (INSERT)
            masterPayload.user_id = userId;
            const { data: newMaster, error: insertMasterErr } = await supabase
                .from('credit_notes')
                .insert([masterPayload])
                .select()
                .single();
            
            if (insertMasterErr) throw insertMasterErr;
            targetCnId = newMaster.id;
        }

        // 3. DETAIL SATIRLARINI TOPLAMAK VE TOPLU EKLEMEK (BULK INSERT)
        const rowElements = document.querySelectorAll('.cn-item-row');
        const bulkItemsPayload = [];

        rowElements.forEach(row => {
            bulkItemsPayload.push({
                credit_note_id: targetCnId,
                product_name: row.querySelector('.item-product-name').value.trim(),
                product_code: row.querySelector('.item-product-code').value.trim() || null,
                complaint_id: row.querySelector('.item-complaint-id').value.trim() || null,
                decision: row.querySelector('.item-decision').value.trim() || null,
                target_order: row.querySelector('.item-target-order').value.trim() || null,
                description_1: row.querySelector('.item-desc-1').value.trim() || null,
                description_2: row.querySelector('.item-desc-2').value.trim() || null
            });
        });

        const { error: bulkInsertErr } = await supabase
            .from('credit_note_items')
            .insert(bulkItemsPayload);

        if (bulkInsertErr) throw bulkInsertErr;

        closeCNModal();
        await fetchCreditNotesData();

    } catch (err) {
        console.error("Master-Detail kayıt hatası:", err.message);
        alert("Dosya kaydedilirken hata meydana geldi: " + err.message);
    }
}

// --- CREDIT NOTE SİLME (MASTER SİLİNİNCE DETAYLAR CASCADE SİLİNİR) ---
async function handleDeleteCN() {
    const id = document.getElementById('cn-id').value;
    if (!id || !confirm("Bu Credit Note dosyasını sildiğinizde altındaki tüm ürün şikayet detayları da kalıcı olarak silinecektir! Emin misiniz?")) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase
            .from('credit_notes')
            .delete()
            .eq('id', id)
            .eq('user_id', session.user.id);

        if (error) throw error;
        closeCNModal();
        await fetchCreditNotesData();
    } catch (err) {
        console.error(err.message);
        if (err.code === '23503') {
            alert("Bu Credit Note silinemez!\nBağlı ürün detay kayıtları bulunmaktadır.");
        } else {
            alert("Silme işlemi başarısız oldu: " + err.message);
        }
    }
}

// --- YARDIMCI GÖRSEL VE FİLTRE FONKSİYONLARI ---
function getStatusBadgeClass(status) {
    switch(status) {
        case 'Onaylandı': return 'bg-emerald-950/40 text-[#3D6E50] border-emerald-900/50';
        case 'Mahsup Edildi': return 'bg-blue-950/40 text-blue-400 border-blue-900/50';
        case 'Reddedildi': return 'bg-rose-950/40 text-[#9F3D3D] border-rose-900/50';
        default: return 'bg-amber-950/40 text-[#B26B33] border-amber-900/50'; // İncelemede
    }
}

function applyCNFilters() {
    const searchVal = document.getElementById('cn-search-input').value.toLowerCase();
    const statusVal = document.getElementById('filter-cn-status').value;

    const filtered = globalCreditNotes.filter(n => {
        const compName = n.customers ? n.customers.company_name.toLowerCase() : '';
        const matchSearch = compName.includes(searchVal);
        const matchStatus = statusVal === "" || n.process_status === statusVal;
        return matchSearch && matchStatus;
    });

    renderCNTable(filtered);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- MASTER-DETAIL DETAYLI CSV EXPORT SÜRECİ ---
function exportCNToCSV() {
    if (globalCreditNotes.length === 0) {
        alert("Dışa aktarılacak veri yok.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\\uFEFFTarih;Musteri;Surec Durumu;Urun Adi;Urun Kodu;Complaint ID;Karar;Hedef Siparis;Hata Tanimi\n";

    globalCreditNotes.forEach(n => {
        const compName = n.customers ? n.customers.company_name : 'Bilinmeyen Müşteri';
        
        if (n.credit_note_items && n.credit_note_items.length > 0) {
            n.credit_note_items.forEach(i => {
                csvContent += `"${n.cn_date}";"${compName}";"${n.process_status}";"${i.product_name}";"${i.product_code || ''}";"${i.complaint_id || ''}";"${i.decision || ''}";"${i.target_order || ''}";"${i.description_1 || ''}"\n`;
            });
        } else {
            csvContent += `"${n.cn_date}";"${compName}";"${n.process_status}";"";"";"";"";"";""\n`;
        }
    });

    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `Export_Credit_Notes_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}