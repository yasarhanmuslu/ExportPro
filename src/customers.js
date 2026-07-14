// ════════════════════════════════════════════════════════════════
//  customers.js — Müşteri Kartı Modülü (Aşama 3 - Revizyon)
//  Düz liste · Sekmeli modal · Dinamik notlar · Akıllı UPSERT import
// ════════════════════════════════════════════════════════════════
//
//  ┌────────────────────────────────────────────────────────────┐
//  │  GEREKLİ SQL — Supabase SQL Editor'e yapıştırıp çalıştırın  │
//  │  (yeni 2. yetkili alanları + jsonb not yapısı için)         │
//  └────────────────────────────────────────────────────────────┘
//
//  ALTER TABLE customers
//      ADD COLUMN IF NOT EXISTS contact_name_2 text,
//      ADD COLUMN IF NOT EXISTS email_2        text,
//      ADD COLUMN IF NOT EXISTS phone_2        text,
//      ADD COLUMN IF NOT EXISTS history_notes  jsonb;
//
// ════════════════════════════════════════════════════════════════
import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';

// Global Müşteri Hafızası
let globalCustomers = [];
// Dinamik geçmiş notları (array of objects): [{ date, note }]
let historyNotes = [];
let ctx = null;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'customers'))) return;
    await renderNavbar('customers', ctx);
    await fetchCustomers();
    initEventListeners();
    initTabs();
    applyEditLock(ctx, 'customers');
});

// ════════════════════════════════════════════════════════════════
//  VERİ ÇEKME
// ════════════════════════════════════════════════════════════════
async function fetchCustomers() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data: customers, error } = await supabase
            .from('customers')
            .select('*')
            .eq('user_id', ctx.ownerId)
            .order('country', { ascending: true })
            .order('company_name', { ascending: true });   // Ülke → Firma A→Z

        if (error) throw error;

        globalCustomers = customers || [];
        populateCountryFilter(globalCustomers);
        populateOwnerFilter(globalCustomers);
        renderCustomersList(globalCustomers);

    } catch (error) {
        console.error("Müşteri listesi çekilemedi:", error.message);
        await showAlertDialog("Müşteri verileri yüklenirken hata oluştu.", { variant: 'danger', title: 'Hata' });
    }
}

// ════════════════════════════════════════════════════════════════
//  LİSTELEME — Akordeon kaldırıldı, tek tablo (A→Z)
// ════════════════════════════════════════════════════════════════
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
    summaryEl.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px;';
    const card = (label, value, color) => `
        <div style="background:var(--surface,#fff);border:1px solid var(--porc-border);border-radius:12px;padding:16px 18px;">
            <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:var(--porc-ink-3);font-weight:600;margin-bottom:6px;">${label}</div>
            <div style="font-size:26px;font-weight:700;color:${color};line-height:1;">${value}</div>
        </div>`;
    summaryEl.innerHTML =
        card('Toplam Müşteri', isFiltered ? totalFiltered + ' / ' + totalAll : totalAll, 'var(--porc-ink)') +
        card('Aktif', isFiltered ? filteredActive + ' / ' + totalActive : totalActive, '#2D7D5A') +
        card('Pasif', isFiltered ? (totalFiltered - filteredActive) + ' / ' + (totalAll - totalActive) : (totalAll - totalActive), 'var(--porc-ink-3)');
    container.appendChild(summaryEl);

    if (customersList.length === 0) {
        const empty = document.createElement('div');
        empty.className = "text-center py-12 rounded-xl";
        empty.style.cssText = 'background:var(--surface,#fff);border:1px dashed var(--porc-border);';
        empty.innerHTML = `
            <i class="fa-solid fa-users-slash text-3xl mb-3" style="color:var(--porc-ink-3);"></i>
            <p class="text-sm" style="color:var(--porc-ink-2);">Kriterlere uygun müşteri kaydı bulunamadı.</p>`;
        container.appendChild(empty);
        return;
    }

    // Tek tablo
    const tableWrap = document.createElement('div');
    tableWrap.className = "custom-table-container";
    tableWrap.innerHTML = `
        <table class="custom-table">
            <thead>
                <tr>
                    <th>Firma Ünvanı</th>
                    <th>Ülke</th>
                    <th>Yetkili</th>
                    <th>E-Posta / Telefon</th>
                    <th>Web Sitesi</th>
                    <th>Müşteri Tipi</th>
                    <th>Sorumlu</th>
                    <th>Ödeme / Birim</th>
                    <th>Durum</th>
                    <th style="text-align:right;padding-right:1rem;">İşlem</th>
                </tr>
            </thead>
            <tbody>
                ${customersList.map(cust => {
                    const noteRaw = cust.short_info || '';
                    const noteTxt = noteRaw.length > 40 ? noteRaw.slice(0, 40) + '…' : noteRaw;
                    const noteHtml = noteRaw
                        ? `<div class="firm-note" data-note="${escapeHtml(noteRaw)}" title="${escapeHtml(noteRaw)}">
                               <i class="fa-solid fa-note-sticky"></i><span>${escapeHtml(noteTxt)}</span>
                           </div>`
                        : '';
                    return `
                    <tr>
                        <td class="cell-strong">
                            ${escapeHtml(cust.company_name)}
                            ${noteHtml}
                        </td>
                        <td>${escapeHtml(getCanonicalCountry(cust.country))}</td>
                        <td>${escapeHtml(cust.contact_name || '—')}</td>
                        <td>
                            <div class="text-xs">${escapeHtml(cust.email || '—')}</div>
                            <div class="text-xs cell-muted">${escapeHtml(cust.phone || '')}</div>
                        </td>
                        <td>${renderWebsite(cust.website)}</td>
                        <td>
                            <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${getGroupBadgeClass(cust.client_group)}">
                                ${cust.client_group || 'Toptancı'}
                            </span>
                        </td>
                        <td class="text-xs">${escapeHtml((cust.account_owner && cust.account_owner !== 'Atanmadı') ? cust.account_owner : '—')}</td>
                        <td class="text-xs">
                            <div>${escapeHtml(cust.payment_term || '—')}</div>
                            <div class="cell-muted">${escapeHtml(cust.incoterms || '—')} · ${escapeHtml(cust.currency || '—')}</div>
                        </td>
                        <td>
                            <span class="px-2 py-0.5 rounded text-xs font-semibold ${getStatusBadgeClass(cust.status)}">
                                ${cust.status || 'Aktif'}
                            </span>
                        </td>
                        <td class="text-right">
                            <button class="btn-edit-trigger text-xs px-3 py-1.5 rounded-md transition-colors" data-id="${cust.id}" style="background:var(--surface,#fff);border:1px solid var(--porc-border);color:var(--porc-accent);">
                                <i class="fa-solid fa-pen-to-square"></i> Düzenle
                            </button>
                        </td>
                    </tr>
                `;
                }).join('')}
            </tbody>
        </table>
    `;
    container.appendChild(tableWrap);

    container.querySelectorAll('.btn-edit-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openModalForEdit(e.currentTarget.getAttribute('data-id'));
        });
    });

    container.querySelectorAll('.firm-note').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            showAlertDialog(el.getAttribute('data-note'), { title: 'Kısa Bilgi', variant: 'info' });
        });
    });
}

// Web sitesini tıklanabilir link olarak göster
function renderWebsite(url) {
    if (!url) return '<span class="cell-muted">—</span>';
    const clean = url.trim();
    const href = /^https?:\/\//i.test(clean) ? clean : 'https://' + clean;
    const label = clean.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-xs underline" style="color:var(--porc-accent);">${escapeHtml(label)}</a>`;
}

// ════════════════════════════════════════════════════════════════
//  SEKME (TAB) YÖNETİMİ
// ════════════════════════════════════════════════════════════════
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('tab-active', b.getAttribute('data-tab') === tabId));
    document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('tab-panel-active', p.id === tabId));
}

// ════════════════════════════════════════════════════════════════
//  OLAY DİNLEYİCİLER
// ════════════════════════════════════════════════════════════════
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
    document.getElementById('filter-status').addEventListener('change', applyFilters);
    document.getElementById('filter-owner').addEventListener('change', applyFilters);
    document.getElementById('btn-export-excel').addEventListener('click', exportToCSV);
    document.getElementById('btn-add-note').addEventListener('click', () => addHistoryRow());
    document.getElementById('import-file-input').addEventListener('change', handleImportFile);

    // Title Case yalnızca firma adı + 2 yetkili alanında
    applyTitleCaseListeners();

    // Ülke yazıldıkça bölgeyi otomatik doldur
    const countryInput = document.getElementById('country');
    if (countryInput) {
        countryInput.addEventListener('input', () => {
            document.getElementById('region').value = getRegion(countryInput.value);
        });
    }
}

// ════════════════════════════════════════════════════════════════
//  MODAL YÖNETİMİ
// ════════════════════════════════════════════════════════════════
function openModalForCreate() {
    document.getElementById('customer-form').reset();
    document.getElementById('customer-id').value = '';
    // Yeni kayıtta mantıklı varsayılanlar
    document.getElementById('currency').value = 'EUR';
    document.getElementById('incoterms').value = 'FOB';
    document.getElementById('payment_term').value = 'Peşin';
    document.getElementById('acquisition_source').value = 'Diğer';
    document.getElementById('region').value = '';
    historyNotes = [];
    renderHistoryRows();
    document.getElementById('modal-title').innerHTML = `<i class="fa-solid fa-user-plus" style="color:var(--porc-accent);"></i> Yeni Müşteri Kaydı`;
    document.getElementById('btn-delete-customer').classList.add('hidden');
    switchTab('tab-general');
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
    // 2. Yetkili
    document.getElementById('contact_name_2').value = customer.contact_name_2 || '';
    document.getElementById('email_2').value = customer.email_2 || '';
    document.getElementById('phone_2').value = customer.phone_2 || '';

    document.getElementById('website').value = customer.website || '';
    document.getElementById('client_group').value = customer.client_group || 'Toptancı';
    document.getElementById('status').value = customer.status || 'Aktif';

    // Ticari (null ise boş option seçili gelir)
    document.getElementById('currency').value = customer.currency || '';
    document.getElementById('incoterms').value = customer.incoterms || '';
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

    document.getElementById('region').value = customer.region || getRegion(customer.country) || '';
    document.getElementById('short_info').value = customer.short_info || '';

    // Dinamik geçmiş notları yükle
    historyNotes = parseHistoryNotes(customer.history_notes);
    renderHistoryRows();

    document.getElementById('modal-title').innerHTML = `<i class="fa-solid fa-pen-to-square" style="color:#B26B33;"></i> Müşteri Kaydını Düzenle`;
    document.getElementById('btn-delete-customer').classList.remove('hidden');
    switchTab('tab-general');
    document.getElementById('customer-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('customer-modal').classList.add('hidden');
}

// ════════════════════════════════════════════════════════════════
//  DİNAMİK GEÇMİŞ NOTLARI
// ════════════════════════════════════════════════════════════════
// DB'den gelen history_notes değerini güvenli şekilde diziye çevirir.
function parseHistoryNotes(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function renderHistoryRows() {
    const wrap = document.getElementById('history-rows');
    wrap.innerHTML = '';
    if (historyNotes.length === 0) {
        wrap.innerHTML = `<p class="text-xs" style="color:var(--porc-ink-3);">Henüz not eklenmedi. "Yeni Not Ekle" ile başlayın.</p>`;
        return;
    }
    historyNotes.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'history-row';
        row.innerHTML = `
            <input type="date" data-idx="${idx}" data-field="date" value="${escapeAttr(item.date || '')}">
            <textarea data-idx="${idx}" data-field="note" rows="2" placeholder="Not">${escapeHtml(item.note || '')}</textarea>
            <button type="button" class="btn-remove-note" data-idx="${idx}" title="Satırı sil">
                <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
        `;
        wrap.appendChild(row);
    });

    // Değişiklikleri diziye yansıt + textarea auto-grow
    wrap.querySelectorAll('input, textarea').forEach(inp => {
        if (inp.tagName === 'TEXTAREA') autoGrow(inp); // ilk açılışta yüksekliği ayarla
        inp.addEventListener('input', (e) => {
            const i = +e.target.getAttribute('data-idx');
            const f = e.target.getAttribute('data-field');
            historyNotes[i][f] = e.target.value;
            if (e.target.tagName === 'TEXTAREA') autoGrow(e.target);
        });
    });
    wrap.querySelectorAll('.btn-remove-note').forEach(btn => {
        btn.addEventListener('click', (e) => {
            historyNotes.splice(+e.currentTarget.getAttribute('data-idx'), 1);
            renderHistoryRows();
        });
    });
}

// Textarea'yı içeriğe göre dikey büyüt (max 160px, sonrası scroll)
function autoGrow(el) {
    const MAX = 160;
    el.style.height = 'auto';
    const target = Math.max(58, el.scrollHeight);
    el.style.height = Math.min(target, MAX) + 'px';
    el.style.overflowY = target > MAX ? 'auto' : 'hidden';
}

function addHistoryRow() {
    historyNotes.push({ date: '', note: '' });
    renderHistoryRows();
}

// ════════════════════════════════════════════════════════════════
//  FORM GÖNDERİMİ (INSERT / UPDATE)
// ════════════════════════════════════════════════════════════════
async function handleFormSubmit(e) {
    e.preventDefault();

    if (!canEdit(ctx, 'customers')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }

    const id = document.getElementById('customer-id').value;

    // Title Case: yalnızca firma adı + 1./2. yetkili adı
    const tc = (id) => {
        const v = document.getElementById(id).value.trim();
        return v ? toTitleCase(v) : null;
    };
    // Ham string (formatlama yok), boşsa null
    const raw = (id) => {
        const v = document.getElementById(id).value.trim();
        return v || null;
    };
    // Sayısal alan, boşsa null
    const num = (id) => {
        const v = document.getElementById(id).value.trim();
        if (v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const companyName = tc('company_name');
    const countryVal = tc('country');   // Ülke de Title Case

    // ── Zorunlu alan kontrolü: eksikleri topla ve listele ──
    const requiredFields = {
        'Ülke': countryVal,
        'Firma Adı': companyName,
        'Durum': document.getElementById('status').value,
        'Ödeme Koşulu': document.getElementById('payment_term').value,
        'Teslim Şekli (Incoterms)': document.getElementById('incoterms').value,
        'Para Birimi': document.getElementById('currency').value,
    };
    const missing = Object.entries(requiredFields)
        .filter(([, val]) => !val || String(val).trim() === '')
        .map(([label]) => label);

    if (missing.length > 0) {
        await showAlertDialog("Lütfen aşağıdaki zorunlu alanları doldurun:\n\n• " + missing.join("\n• "), { variant: 'warn', title: 'Eksik Bilgi' });
        return;
    }

    // ── Madde 5: Mükerrer kayıt engelleme (yalnızca yeni kayıtta) ──
    if (!id) {
        const exists = globalCustomers.some(c =>
            (c.company_name || '').trim().toLocaleLowerCase('tr-TR') ===
            companyName.trim().toLocaleLowerCase('tr-TR'));
        if (exists) {
            await showAlertDialog("Bu firma ismiyle daha önce bir kayıt oluşturulmuş!", { variant: 'warn', title: 'Mükerrer Kayıt' });
            return;
        }
    }

    // Boş notları temizle (hem tarih hem not boşsa atla)
    const cleanedNotes = historyNotes.filter(n => (n.date && n.date.trim()) || (n.note && n.note.trim()));

    const payload = {
        company_name: companyName,
        country:      countryVal,
        contact_name: tc('contact_name'),
        email:        raw('email'),
        phone:        raw('phone'),
        // 2. Yetkili
        contact_name_2: tc('contact_name_2'),
        email_2:        raw('email_2'),
        phone_2:        raw('phone_2'),

        website:      raw('website'),
        client_group: document.getElementById('client_group').value,
        status:       document.getElementById('status').value,
        short_info:   raw('short_info'),

        // Ticari (zorunlu)
        currency:           document.getElementById('currency').value,
        incoterms:          document.getElementById('incoterms').value,
        payment_term:       document.getElementById('payment_term').value,
        acquisition_source: document.getElementById('acquisition_source').value,
        account_owner:      raw('account_owner') || 'Atanmadı',
        vat_number:         raw('vat_number'),

        // Segmentasyon & Risk
        region:               getRegion(countryVal),
        language:             document.getElementById('language').value || null,
        risk_score:           num('risk_score'),
        credit_limit:         num('credit_limit'),
        annual_volume_target: num('annual_volume_target'),
        product_interests:    raw('product_interests'),
        first_order_date:     document.getElementById('first_order_date').value || null,
        last_order_date:      document.getElementById('last_order_date').value || null,

        // Dinamik geçmiş notları (JSON)
        history_notes: cleanedNotes.length ? JSON.stringify(cleanedNotes) : null,

        updated_at: new Date().toISOString(),
    };

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Oturum bulunamadı.");
        const userId = ctx.ownerId;

        if (id) {
            const { error } = await supabase
                .from('customers')
                .update(payload)
                .eq('id', id)
                .eq('user_id', userId);
            if (error) throw error;
            logChange({ ctx, moduleId: 'customers', action: 'update', summary: `Müşteri güncellendi: ${payload.company_name}` });
        } else {
            const { error } = await supabase
                .from('customers')
                .insert([{ ...payload, user_id: userId }]);
            if (error) throw error;
            logChange({ ctx, moduleId: 'customers', action: 'create', summary: `Müşteri oluşturuldu: ${payload.company_name}` });
        }

        closeModal();
        await fetchCustomers();

    } catch (error) {
        console.error("Müşteri kaydedilemedi:", error.message);
        await showAlertDialog("Kayıt sırasında bir hata oluştu: " + error.message, { variant: 'danger', title: 'Hata' });
    }
}

// ════════════════════════════════════════════════════════════════
//  KAYIT SİLME
// ════════════════════════════════════════════════════════════════
async function handleDeleteCustomer() {
    if (!canEdit(ctx, 'customers')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }

    const id = document.getElementById('customer-id').value;
    if (!id) return;

    const companyName = document.getElementById('company_name')?.value || id;

    const ok = await showConfirmDialog(
        "Bu müşteriyi silmek istediğinize emin misiniz? Bu işlem müşteriye bağlı tüm sipariş ve fiyat ilişkilerini de etkileyebilir!",
        { variant: 'danger', title: 'Müşteriyi Sil', confirmText: 'Sil' }
    );
    if (ok) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const { error } = await supabase
                .from('customers')
                .delete()
                .eq('id', id)
                .eq('user_id', ctx.ownerId);
            if (error) throw error;
            logChange({ ctx, moduleId: 'customers', action: 'delete', summary: `Müşteri silindi: ${companyName}` });
            closeModal();
            await fetchCustomers();
        } catch (error) {
            console.error("Müşteri silinemedi:", error.message);
            if (error.code === '23503') {
                await showAlertDialog("Bu müşteri silinemez!\nMüşteriye ait sipariş, özel fiyat veya credit note kaydı bulunmaktadır.\nÖnce ilgili kayıtları siliniz.", { variant: 'danger', title: 'Silinemedi' });
            } else {
                await showAlertDialog("Silme işlemi başarısız oldu: " + error.message, { variant: 'danger', title: 'Hata' });
            }
        }
    }
}

// ════════════════════════════════════════════════════════════════
//  AKILLI EXCEL / CSV IMPORT (UPSERT)
//  Firma adı varsa update, yoksa insert. Mevcut veriyi silmez.
// ════════════════════════════════════════════════════════════════
async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!canEdit(ctx, 'customers')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        e.target.value = '';
        return;
    }

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (!rows.length) {
            await showAlertDialog("Dosyada içe aktarılacak satır bulunamadı.", { variant: 'warn', title: 'Uyarı' });
            e.target.value = '';
            return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Oturum bulunamadı.");
        const userId = ctx.ownerId;

        // Mevcut firmaları isimle eşle (TR küçük harf normalizasyon)
        const byName = {};
        globalCustomers.forEach(c => {
            byName[(c.company_name || '').trim().toLocaleLowerCase('tr-TR')] = c;
        });

        let inserted = 0, updated = 0, skipped = 0;

        for (const row of rows) {
            const rec = mapImportRow(row);
            if (!rec.company_name) { skipped++; continue; }

            const key = rec.company_name.trim().toLocaleLowerCase('tr-TR');
            const existing = byName[key];

            if (existing) {
                // UPDATE — sadece dolu gelen alanları üzerine yaz
                const patch = {};
                Object.keys(rec).forEach(k => {
                    if (rec[k] !== null && rec[k] !== '') patch[k] = rec[k];
                });
                patch.updated_at = new Date().toISOString();
                const { error } = await supabase
                    .from('customers')
                    .update(patch)
                    .eq('id', existing.id)
                    .eq('user_id', userId);
                if (error) throw error;
                updated++;
            } else {
                // INSERT
                const { error } = await supabase
                    .from('customers')
                    .insert([{ ...rec, region: getRegion(rec.country), user_id: userId, updated_at: new Date().toISOString() }]);
                if (error) throw error;
                inserted++;
            }
        }

        logChange({ ctx, moduleId: 'customers', action: 'update', summary: `Toplu içe aktarma: ${inserted} yeni, ${updated} güncelleme, ${skipped} atlanan` });
        await showAlertDialog(`İçe aktarma tamamlandı.\nYeni eklenen: ${inserted}\nGüncellenen: ${updated}\nAtlanan (firma adı boş): ${skipped}`, { variant: 'success', title: 'İçe Aktarma Tamamlandı' });
        await fetchCustomers();

    } catch (error) {
        console.error("İçe aktarma hatası:", error.message);
        await showAlertDialog("İçe aktarma sırasında bir hata oluştu: " + error.message, { variant: 'danger', title: 'Hata' });
    } finally {
        e.target.value = '';   // aynı dosya tekrar seçilebilsin
    }
}

// Excel başlıklarını DB kolonlarına eşle (esnek başlık adları)
function mapImportRow(row) {
    const g = (...keys) => {
        for (const k of keys) {
            const found = Object.keys(row).find(h => h.trim().toLocaleLowerCase('tr-TR') === k.toLocaleLowerCase('tr-TR'));
            if (found && String(row[found]).trim() !== '') return String(row[found]).trim();
        }
        return '';
    };
    const numOrNull = (v) => { const n = Number(v); return v !== '' && Number.isFinite(n) ? n : null; };

    const company = g('Firma Adı', 'Firma Ünvanı', 'company_name');
    return {
        company_name: company ? toTitleCase(company) : '',
        country:      g('Ülke', 'country') || null,
        contact_name: (() => { const v = g('Yetkili', 'Yetkili Ad Soyad', 'contact_name'); return v ? toTitleCase(v) : null; })(),
        email:        g('E-Posta', 'Email', 'email') || null,
        phone:        g('Telefon', 'phone') || null,
        website:      g('Web', 'Web Sitesi', 'website') || null,
        client_group: g('Müşteri Tipi', 'client_group') || 'Toptancı',
        account_owner: g('Sorumlu', 'account_owner') || 'Atanmadı',
        currency:     g('Para Birimi', 'currency') || null,
        incoterms:    g('Incoterms', 'Teslim Şekli', 'incoterms') || null,
        payment_term: g('Ödeme Koşulu', 'payment_term') || 'Peşin',
        acquisition_source: g('Edinme Kaynağı', 'acquisition_source') || 'Diğer',
        vat_number:   g('Vergi No', 'VAT', 'vat_number') || null,
        language:     g('Dil', 'language') || null,
        risk_score:   numOrNull(g('Risk Skoru', 'risk_score')),
        credit_limit: numOrNull(g('Kredi Limiti', 'credit_limit')),
        annual_volume_target: numOrNull(g('Yıllık Hedef', 'annual_volume_target')),
        product_interests: g('Ürün İlgi', 'product_interests') || null,
        status:       g('Durum', 'status') || 'Aktif',
        short_info:   g('Kısa Bilgi', 'short_info') || null,
    };
}

// ════════════════════════════════════════════════════════════════
//  BÖLGE HARİTASI
// ════════════════════════════════════════════════════════════════
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
    const normalized = country.trim().toLocaleUpperCase('tr-TR');
    return REGION_MAP[normalized] || 'Diğer';
}

// ════════════════════════════════════════════════════════════════
//  FİLTRELEME — Durum filtresi eklendi
// ════════════════════════════════════════════════════════════════
function applyFilters() {
    const searchVal  = document.getElementById('search-input').value.toLocaleLowerCase('tr-TR');
    const regionVal  = document.getElementById('filter-region').value;
    const countryVal = document.getElementById('filter-country').value;
    const groupVal    = document.getElementById('filter-group').value;
    const statusVal   = document.getElementById('filter-status').value;
    const ownerVal    = document.getElementById('filter-owner').value;

    const filtered = globalCustomers.filter(c => {
        const matchSearch =
            (c.company_name || '').toLocaleLowerCase('tr-TR').includes(searchVal) ||
            (c.country || '').toLocaleLowerCase('tr-TR').includes(searchVal) ||
            (c.contact_name || '').toLocaleLowerCase('tr-TR').includes(searchVal);
        const matchRegion  = regionVal  === "" || getRegion(c.country) === regionVal;
        const matchCountry = countryVal === "" || getCanonicalCountry(c.country) === countryVal;
        const matchGroup   = groupVal   === "" || c.client_group === groupVal;
        const matchStatus  = statusVal  === "" || (c.status || 'Aktif') === statusVal;
        const matchOwner   = ownerVal   === "" || (c.account_owner || '') === ownerVal;
        return matchSearch && matchRegion && matchCountry && matchGroup && matchStatus && matchOwner;
    });

    renderCustomersList(filtered);
}

// ════════════════════════════════════════════════════════════════
//  FİLTRE DOLDURUCULAR
// ════════════════════════════════════════════════════════════════
// Ülke adını filtre/karşılaştırma için kanonik biçime getir:
// NFC (birleşik/ayrık aksanları tek biçime indir) + görünmez karakterleri sil
// + iç boşlukları teke indir + trim + tamamen TR büyük harf.
// Bu, Excel import'tan gelen "gizli" farklar yüzünden aynı ülkenin iki kez
// görünmesini engeller.
function getCanonicalCountry(countryStr) {
    if (!countryStr) return 'BELİRTİLMEDİ';
    return String(countryStr)
        .normalize('NFC')                              // aksan birleşik/ayrık farkını gider
        .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u0307]/g, '') // sıfır-genişlikli & görünmez + birleşik nokta (İ kalıntısı)
        .replace(/\s+/g, ' ')                          // tüm boşluk türlerini teke indir
        .trim()
        .toLocaleUpperCase('tr-TR');
}

function populateCountryFilter(customers) {
    const filterSelect = document.getElementById('filter-country');
    const savedValue = filterSelect.value;

    // getCanonicalCountry ile normalize → Set ile teke düşür
    const normalized = customers
        .map(c => getCanonicalCountry(c.country))
        .filter(c => c && c !== 'BELİRTİLMEDİ');
    const countries = [...new Set(normalized)].sort((a, b) => a.localeCompare(b, 'tr'));

    filterSelect.innerHTML = '<option value="">Tüm Ülkeler (Filtrele)</option>';
    countries.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        filterSelect.appendChild(opt);
    });
    filterSelect.value = countries.includes(savedValue) ? savedValue : '';
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
        opt.value = o; opt.textContent = o;
        filterSelect.appendChild(opt);
    });
    filterSelect.value = savedValue;
}

// ════════════════════════════════════════════════════════════════
//  BADGE SINIFLARI
// ════════════════════════════════════════════════════════════════
function getGroupBadgeClass(group) {
    switch(group) {
        case 'Distribütör': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
        case 'Toptancı':    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'Bayi':        return 'bg-teal-50 text-teal-700 border-teal-200';
        case 'Üretici':     return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'Perakendeci': return 'bg-violet-50 text-violet-700 border-violet-200';
        case 'Projeci':     return 'bg-sky-50 text-sky-700 border-sky-200';
        case 'OEM':         return 'bg-rose-50 text-rose-700 border-rose-200';
        default:            return 'bg-stone-100 text-stone-600 border-stone-200';
    }
}

function getStatusBadgeClass(status) {
    switch(status) {
        case 'Aktif':      return 'bg-emerald-50 text-emerald-700';
        case 'Pasif':      return 'bg-stone-100 text-stone-500';
        case 'Potansiyel': return 'bg-amber-50 text-amber-700';
        case 'Kara Liste': return 'bg-rose-50 text-rose-700';
        default:           return 'bg-emerald-50 text-emerald-700';
    }
}

// ════════════════════════════════════════════════════════════════
//  METİN BİÇİMLENDİRME
// ════════════════════════════════════════════════════════════════
// Title Case (Türkçe uyumlu): her kelime büyük harfle başlar, devamı küçük.
function toTitleCase(str) {
    if (!str) return str;
    // Önce kalıntıları temizle: NFC + görünmez karakterler + "İ" küçültme kalıntısı (U+0307).
    // Böylece dışarıdan yapıştırılan kirli metin kaynakta düzgün saklanır.
    str = String(str)
        .normalize('NFC')
        .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u0307]/g, '');
    return str
        .split(/(\s+)/) // boşlukları koru
        .map(token => {
            if (!token.trim()) return token;
            const first = token.charAt(0).toLocaleUpperCase('tr-TR');
            const rest  = token.slice(1).toLocaleLowerCase('tr-TR');
            return first + rest;
        })
        .join('');
}

// Title Case yalnızca şu alanlarda: ülke, firma adı, 1./2. yetkili adı
function applyTitleCaseListeners() {
    const TITLE_CASE_IDS = ['country', 'company_name', 'contact_name', 'contact_name_2'];
    TITLE_CASE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function () {
            const start = this.selectionStart, end = this.selectionEnd;
            const original = this.value;
            const converted = toTitleCase(original);
            if (original !== converted) {
                this.value = converted;
                this.setSelectionRange(start, end);
            }
        });
    });
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function escapeAttr(str) {
    return escapeHtml(str);
}

// ════════════════════════════════════════════════════════════════
//  CSV DIŞA AKTARMA
// ════════════════════════════════════════════════════════════════
async function exportToCSV() {
    if (globalCustomers.length === 0) {
        await showAlertDialog("Dışa aktarılacak veri bulunamadı.", { variant: 'warn', title: 'Uyarı' });
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "Firma Adı;Ülke;Bölge;Yetkili;E-Posta;Telefon;Yetkili 2;E-Posta 2;Telefon 2;Web;Müşteri Tipi;Sorumlu;Para Birimi;Incoterms;Ödeme Koşulu;Edinme Kaynağı;Vergi No;Dil;Risk Skoru;Kredi Limiti;Yıllık Hedef;Ürün İlgi;İlk İşlem;Son İşlem;Durum;Kısa Bilgi\n";

    globalCustomers.forEach(c => {
        const q = v => `"${(v == null ? '' : v).toString().replace(/"/g, '""')}"`;
        csvContent += [
            q(c.company_name), q(c.country), q(c.region || getRegion(c.country)), q(c.contact_name),
            q(c.email), q(c.phone),
            q(c.contact_name_2), q(c.email_2), q(c.phone_2),
            q(c.website),
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
