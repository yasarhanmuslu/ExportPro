// quotations.js — V: 1.0.84
import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { showAlertDialog, showConfirmDialog, showPromptDialog } from './utils/dialogs.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';

// ── DURUM LİSTESİ ─────────────────────────────────────────────────────────────
const STATUS_LIST = [
    { value: 'Bekliyor',         cls: 'stag-devam'      },
    { value: 'Kabul',            cls: 'stag-odeme'      },
    { value: 'Red',              cls: 'stag-iptal'      },
    { value: 'Süresi Doldu',     cls: 'stag-gecikme'    },
    { value: 'Sipariş Dönüştü',  cls: 'stag-teslim'     },
];

const STATUS_CLS = Object.fromEntries(STATUS_LIST.map(s => [s.value, s.cls]));

const STATUS_BAR_COLOR = {
    'Bekliyor':        '#94a3b8',
    'Kabul':           '#22c55e',
    'Red':             '#ef4444',
    'Süresi Doldu':    '#ef4444',
    'Sipariş Dönüştü': '#22c55e',
};

let globalQuotations  = [];
let globalCustomers   = [];
let globalProducts    = [];
let currentQuotationId = null;
let quotationItemsBuffer = [];
let ctx = null;

// ── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'quotations'))) return;
    await renderNavbar('quotations', ctx);
    await Promise.all([fetchCustomersData(), fetchQuotationsData(), fetchProductsData()]);
    initEventListeners();
    applyEditLock(ctx, 'quotations');
});

// ── VERİ ÇEKME ───────────────────────────────────────────────────────────────
async function fetchCustomersData() {
    try {
        const { data, error } = await supabase
            .from('customers')
            .select('id, company_name, country, status')
            .order('company_name', { ascending: true });
        if (error) throw error;
        globalCustomers = data || [];
        initCustomerSearchDropdown(globalCustomers);
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

async function fetchQuotationsData() {
    try {
        const { data, error } = await supabase
            .from('quotations')
            .select(`*, customers ( company_name, country )`)
            .order('quotation_date', { ascending: false });
        if (error) throw error;

        // Geçerlilik tarihi geçmiş & hâlâ Bekliyor olanları görsel olarak "Süresi Doldu" göster
        const today = new Date().toISOString().slice(0, 10);
        globalQuotations = (data || []).map(q => {
            if (q.status === 'Bekliyor' && q.valid_until && q.valid_until < today) {
                return { ...q, status: 'Süresi Doldu', _expired: true };
            }
            return q;
        });
        renderQuotationsList(globalQuotations);
    } catch (err) {
        console.error('Teklif verileri yüklenemedi:', err.message);
        document.getElementById('quotations-card-list').innerHTML =
            `<div style="text-align:center;color:#9F3D3D;padding:32px;">Veriler çekilirken hata oluştu.</div>`;
    }
}

async function fetchQuotationItems(quotationId) {
    try {
        const { data, error } = await supabase
            .from('quotation_items')
            .select('*')
            .eq('quotation_id', quotationId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Teklif kalemleri yüklenemedi:', err.message);
        return [];
    }
}

// ── SATIRLARI RENDER ET ───────────────────────────────────────────────────────
function renderQuotationsList(list) {
    const container  = document.getElementById('quotations-card-list');
    const countBadge = document.getElementById('total-filtered-count');
    container.innerHTML = '';
    countBadge.textContent = `${list.length} Teklif`;

    if (list.length === 0) {
        container.innerHTML = `<div style="text-align:center;color:#968B7A;padding:40px;">Kriterlere uygun teklif bulunamadı.</div>`;
        return;
    }

    const sym = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
    const today = new Date(); today.setHours(0,0,0,0);

    list.forEach(q => {
        const s        = sym[q.currency] || q.currency;
        const compName = q.customers?.company_name || 'Bilinmeyen Müşteri';
        const country  = q.customers?.country || '';
        const status   = q.status || 'Bekliyor';
        const barColor = STATUS_BAR_COLOR[status] || '#94a3b8';

        const fmt     = n  => parseFloat(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
        const fmtDate = d  => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR') : null;

        // Geçerlilik uyarısı
        let validTxt = '—';
        let validWarn = false;
        if (q.valid_until) {
            const vd = new Date(q.valid_until + 'T00:00:00');
            validTxt  = vd.toLocaleDateString('tr-TR');
            validWarn = vd < today && status !== 'Kabul' && status !== 'Sipariş Dönüştü';
        }

        const statusBadge = `<span class="stag ${STATUS_CLS[status] || 'stag-default'}">${escapeHtml(status)}</span>`;

        const noteRaw  = q.notes || '';
        const noteTxt  = noteRaw.length > 60 ? noteRaw.slice(0, 60) + '\u2026' : noteRaw;
        const noteHtml = noteRaw
            ? `<div class="row-note"><i class="fa-solid fa-note-sticky" style="font-size:10px;margin-right:4px;opacity:0.6;"></i>${escapeHtml(noteTxt)}</div>`
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
                        <div class="row-tags">${statusBadge}</div>
                    </div>
                    ${noteHtml}
                </div>
                <div class="row-col-dates">
                    <div class="dates-grid" style="grid-template-columns:repeat(3,1fr);">
                        <div class="d-cell"><span class="d-lbl">Teklif No</span><span class="d-val">${escapeHtml(q.quotation_number || '\u2014')}</span></div>
                        <div class="d-cell"><span class="d-lbl">Tarih</span><span class="d-val">${fmtDate(q.quotation_date) || '\u2014'}</span></div>
                        <div class="d-cell"><span class="d-lbl">Geçerlilik</span><span class="${validWarn ? 'd-warn' : 'd-val'}">${escapeHtml(validTxt)}${validWarn ? ' \u26a0' : ''}</span></div>
                    </div>
                </div>
                <div class="row-col-fin">
                    <div class="fin-r"><span class="fin-lbl">Toplam</span><span class="fin-val">${fmt(q.total_amount)} ${s}</span></div>
                </div>
                <div class="row-col-act">
                    <button class="btn-yonet btn-edit-quotation-trigger" data-id="${q.id}">
                        <i class="fa-solid fa-file-pen"></i> Y\u00f6net
                    </button>
                </div>
            </div>
        `;
        container.appendChild(row);
    });

    container.querySelectorAll('.btn-edit-quotation-trigger').forEach(btn => {
        btn.addEventListener('click', e => openModalForEdit(e.currentTarget.dataset.id));
    });
}

// ── CUSTOMER DROPDOWN ─────────────────────────────────────────────────────────
function initCustomerSearchDropdown(customers) {
    const wrapper     = document.getElementById('customer-dropdown-wrapper');
    const searchInput = document.getElementById('customer-search-input');
    const hiddenSel   = document.getElementById('quotation-customer-select');
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
                item.addEventListener('mousedown', async e => {
                    e.preventDefault();
                    if (c.status === 'Kara Liste') {
                        dropdown.classList.add('hidden');
                        const ok = await showConfirmDialog(
                            'Bu müşteri kara listede, teklif oluşturmak istediğinize emin misiniz?',
                            { title: 'Kara Liste Uyarısı', variant: 'danger', confirmText: 'Evet, Devam Et' }
                        );
                        if (!ok) return;
                    }
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

// ── MÜŞTERİ DURUMU OTOMATİK GEÇİŞLERİ ────────────────────────────────────────
// Sadece belirtilen fromStatus -> toStatus geçişini tetikler; müşterinin güncel
// durumu DB'den taze okunur (cache'e güvenilmez), eşleşmezse hiçbir şey yapılmaz.
// Aktif durumundaki müşteriler fromStatus olarak asla geçmediğinden bu fonksiyon
// Aktif müşterilere hiç dokunmaz.
function parseHistoryNotesLocal(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function maybeUpdateCustomerStatus(customerId, fromStatus, toStatus, noteText) {
    try {
        const { data: cust, error } = await supabase
            .from('customers')
            .select('status, history_notes, company_name')
            .eq('id', customerId)
            .single();
        if (error || !cust || cust.status !== fromStatus) return;

        const notes = parseHistoryNotesLocal(cust.history_notes);
        notes.push({ date: new Date().toISOString().slice(0, 10), note: `[Sistem] ${noteText}` });

        const { error: updErr } = await supabase
            .from('customers')
            .update({
                status: toStatus,
                history_notes: JSON.stringify(notes),
                updated_at: new Date().toISOString(),
            })
            .eq('id', customerId);
        if (updErr) throw updErr;

        logChange({ ctx, moduleId: 'customers', action: 'update', summary: `[Sistem] ${cust.company_name}: ${fromStatus} → ${toStatus} (${noteText})` });

        const c = globalCustomers.find(gc => gc.id === customerId);
        if (c) c.status = toStatus;
    } catch (err) {
        console.error('Müşteri durumu otomatik güncellenemedi:', err.message);
    }
}

// ── MODAL KONTROL ─────────────────────────────────────────────────────────────
function openModalForCreate() {
    document.getElementById('quotation-form').reset();
    document.getElementById('quotation-id').value = '';
    document.getElementById('customer-search-input').value = '';
    document.getElementById('quotation-customer-select').value = '';
    document.getElementById('quotation_date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('q_status').value = 'Bekliyor';
    document.getElementById('quotation-modal-title').textContent = 'Yeni Teklif Girişi';
    document.querySelector('#quotation-modal .modal-title i').className = 'fa-solid fa-file-circle-plus';
    document.querySelector('#quotation-modal .modal-title i').style.color = '#2D4A3E';

    const delBtn = document.getElementById('btn-delete-quotation');
    delBtn.classList.add('hidden'); delBtn.style.display = 'none';
    const convBtn = document.getElementById('btn-send-to-order');
    convBtn.classList.add('hidden'); convBtn.style.display = 'none';

    currentQuotationId = null;
    quotationItemsBuffer = [];
    switchTab('general');
    document.getElementById('quotation-modal').classList.remove('hidden');
}

async function openModalForEdit(id) {
    const q = globalQuotations.find(x => x.id === id);
    if (!q) return;
    currentQuotationId = id;

    document.getElementById('quotation-form').reset();
    document.getElementById('quotation-id').value = q.id;

    const custLabel = q.customers ? `${q.customers.company_name} (${q.customers.country})` : '';
    document.getElementById('customer-search-input').value = custLabel;
    document.getElementById('quotation-customer-select').value = q.customer_id || '';

    document.getElementById('quotation_number').value = q.quotation_number || '';
    document.getElementById('quotation_date').value   = q.quotation_date || '';
    document.getElementById('valid_until').value      = q.valid_until || '';
    document.getElementById('order_type').value        = q.order_type || '';
    document.getElementById('currency').value          = q.currency || 'EUR';
    document.getElementById('total_amount').value      = parseFloat(q.total_amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
    document.getElementById('order_quantity').value    = q.order_quantity || '';
    document.getElementById('payment_method').value    = q.payment_method || '';
    document.getElementById('q_status').value           = q.status || 'Bekliyor';
    document.getElementById('quotation_notes').value    = q.notes || '';

    document.getElementById('quotation-modal-title').textContent = 'Teklif Düzenleme & Güncelleme';
    document.querySelector('#quotation-modal .modal-title i').className = 'fa-solid fa-file-pen';
    document.querySelector('#quotation-modal .modal-title i').style.color = '#B26B33';

    const delBtn = document.getElementById('btn-delete-quotation');
    delBtn.classList.remove('hidden'); delBtn.style.display = 'flex';

    const convBtn = document.getElementById('btn-send-to-order');
    if (q.status === 'Sipariş Dönüştü') {
        convBtn.classList.add('hidden'); convBtn.style.display = 'none';
    } else {
        convBtn.classList.remove('hidden'); convBtn.style.display = 'flex';
    }

    const existingItems = await fetchQuotationItems(id);
    quotationItemsBuffer = existingItems.map(item => ({
        id: item.id, product_id: item.product_id,
        product_name: item.product_name, product_code: item.product_code,
        quantity: item.quantity, unit_price: item.unit_price, notes: item.notes
    }));

    switchTab('general');
    document.getElementById('quotation-modal').classList.remove('hidden');
}

function closeQuotationModal() {
    document.getElementById('quotation-modal').classList.add('hidden');
    quotationItemsBuffer = [];
    currentQuotationId   = null;
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
async function handleQuotationSubmit(e) {
    e.preventDefault();
    if (!canEdit(ctx, 'quotations')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const customerId = document.getElementById('quotation-customer-select').value;
    if (!customerId) { await showAlertDialog('Lütfen bir müşteri / firma seçiniz.', { variant: 'warn', title: 'Eksik Bilgi' }); return; }

    const total_amount = parseTurkishFloat(document.getElementById('total_amount').value);
    if (isNaN(total_amount) || total_amount <= 0) {
        await showAlertDialog('Lütfen geçerli bir toplam teklif tutarı giriniz.', { variant: 'warn', title: 'Eksik Bilgi' });
        return;
    }

    const payload = {
        customer_id:      customerId,
        quotation_number: document.getElementById('quotation_number').value || null,
        quotation_date:   document.getElementById('quotation_date').value || null,
        valid_until:      document.getElementById('valid_until').value || null,
        order_type:       document.getElementById('order_type').value || null,
        currency:         document.getElementById('currency').value,
        total_amount,
        order_quantity:   document.getElementById('order_quantity').value || null,
        payment_method:   document.getElementById('payment_method').value || null,
        status:           document.getElementById('q_status').value || 'Bekliyor',
        notes:            document.getElementById('quotation_notes').value || null,
    };

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = ctx.ownerId;
        let quotationId = currentQuotationId;
        const isNewQuotation = !currentQuotationId;

        // Not: Teklif No müşteri bazında MÜKERRER OLABİLİR — kasıtlı iş akışı.
        // Bir müşteriye aynı numarayla birden fazla teklif gönderilebilir (ör. "2026-01"
        // ile 3 farklı teklif); hangisi onaylanırsa o siparişe dönüştürülür, kalanlar
        // aynı numarayla teklif listesinde durmaya devam eder. Bu yüzden burada
        // teklif no için mükerrer kontrolü YAPILMAZ. Mükerrerlik kontrolü yalnızca
        // "Siparişe Gönder" adımında, orders tablosu için uygulanır.

        if (currentQuotationId) {
            const { error } = await supabase.from('quotations').update(payload).eq('id', currentQuotationId).eq('user_id', userId);
            if (error) throw error;
            logChange({ ctx, moduleId: 'quotations', action: 'update', summary: `Teklif güncellendi: ${payload.quotation_number || quotationId}` });
        } else {
            payload.user_id = userId;
            const { data, error } = await supabase.from('quotations').insert([payload]).select().single();
            if (error) throw error;
            quotationId = data.id;
            logChange({ ctx, moduleId: 'quotations', action: 'create', summary: `Teklif oluşturuldu: ${payload.quotation_number || quotationId}` });
        }

        await saveQuotationItems(quotationId, userId);

        if (isNewQuotation) {
            await maybeUpdateCustomerStatus(
                customerId, 'Pasif', 'Potansiyel',
                'Teklif oluşturulduğu için durum Pasif\'ten Potansiyel\'e güncellendi.'
            );
        }

        closeQuotationModal();
        await fetchQuotationsData();
    } catch (err) {
        console.error('Teklif kaydedilemedi:', err.message);
        await showAlertDialog('Hata: ' + err.message, { variant: 'danger', title: 'Hata' });
    }
}

async function saveQuotationItems(quotationId, userId) {
    const existingItems = currentQuotationId ? await fetchQuotationItems(quotationId) : [];
    const existingIds   = existingItems.map(i => i.id);
    const bufferIds     = quotationItemsBuffer.filter(i => i.id).map(i => i.id);
    const toDelete      = existingIds.filter(eid => !bufferIds.includes(eid));

    if (toDelete.length > 0) {
        const { error } = await supabase.from('quotation_items').delete().in('id', toDelete);
        if (error) throw error;
    }

    for (const item of quotationItemsBuffer) {
        if (!item.product_name) continue;
        const itemPayload = {
            quotation_id: quotationId,
            product_id: item.product_id || null,
            product_name: item.product_name,
            product_code: item.product_code || null,
            quantity: item.quantity || null,
            unit_price: item.unit_price || null,
            currency: document.getElementById('currency').value,
        };
        if (item.id) {
            const { error } = await supabase.from('quotation_items').update(itemPayload).eq('id', item.id);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('quotation_items').insert([itemPayload]);
            if (error) throw error;
        }
    }
}

// ── SİLME ─────────────────────────────────────────────────────────────────────
async function handleDeleteQuotation() {
    if (!canEdit(ctx, 'quotations')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const id = document.getElementById('quotation-id').value;
    if (!id) return;
    const quotationNumber = document.getElementById('quotation_number')?.value || id;
    const ok = await showConfirmDialog('Bu teklifi kalıcı olarak silmek istediğinize emin misiniz?', {
        title: 'Teklifi Sil', variant: 'danger', confirmText: 'Sil'
    });
    if (!ok) return;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        await supabase.from('quotation_items').delete().eq('quotation_id', id);
        const { error } = await supabase.from('quotations').delete().eq('id', id).eq('user_id', ctx.ownerId);
        if (error) throw error;
        logChange({ ctx, moduleId: 'quotations', action: 'delete', summary: `Teklif silindi: ${quotationNumber}` });
        closeQuotationModal();
        await fetchQuotationsData();
    } catch (err) {
        console.error('Teklif silinemedi:', err.message);
        await showAlertDialog('Silme başarısız: ' + err.message, { variant: 'danger', title: 'Hata' });
    }
}

// ── SİPARİŞE GÖNDER ───────────────────────────────────────────────────────────
async function handleSendToOrder() {
    if (!currentQuotationId) return;
    if (!canEdit(ctx, 'quotations')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const q = globalQuotations.find(x => x.id === currentQuotationId);
    if (!q) return;

    if (q.status === 'Sipariş Dönüştü') {
        await showAlertDialog('Bu teklif zaten siparişe dönüştürülmüş.', { variant: 'warn', title: 'Uyarı' });
        return;
    }

    const customerId = document.getElementById('quotation-customer-select').value;
    if (!customerId) { await showAlertDialog('Lütfen bir müşteri / firma seçiniz.', { variant: 'warn', title: 'Eksik Bilgi' }); return; }

    const total_amount = parseTurkishFloat(document.getElementById('total_amount').value);
    const currency     = document.getElementById('currency').value;
    const quotationNumber = document.getElementById('quotation_number').value || null;
    const notes = document.getElementById('quotation_notes').value || '';
    const orderType      = document.getElementById('order_type').value || null;
    const paymentMethod  = document.getElementById('payment_method').value || null;
    const manualQuantity = document.getElementById('order_quantity').value || null;

    const confirmSend = await showConfirmDialog(
        `"${quotationNumber || q.id}" teklifi SİPARİŞE gönderilecek ve teklif modülünden kalıcı olarak silinecektir.\n\nDevam etmek istiyor musunuz?`,
        { title: 'Siparişe Gönder', confirmText: 'Siparişe Gönder' }
    );
    if (!confirmSend) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = ctx.ownerId;

        // ── SİPARİŞ NO ÇÖZÜMLEME (müşteri bazlı) ────────────────────────────
        // Teklif no müşteri bazında mükerrer olabilir (ör. aynı müşteriye 3 farklı
        // teklif "2026-01" numarasıyla gönderilmiş olabilir), ama SİPARİŞ NO
        // mükerrer OLAMAZ. Bu yüzden burada durup uyarı vermek yerine, teklif
        // numarasından yola çıkarak o müşteri için ilk müsait numarayı buluyoruz
        // (2026-01 doluysa 2026-02, o da doluysa 2026-03 ...) ve kullanıcıya
        // onaya sunuyoruz.
        const isRealNum = val => val && val !== '-' && val !== '—' && String(val).trim() !== '';
        let orderNumber = quotationNumber;

        if (isRealNum(orderNumber)) {
            const resolved = await resolveNextAvailableOrderNumber(customerId, orderNumber, userId);
            if (resolved === null) {
                // Otomatik artırılamadı (numara formatı "...-NN" değil) — kullanıcıdan elle iste
                const manual = await showPromptDialog(
                    `Sipariş No "${orderNumber}" bu müşteri için sipariş modülünde zaten kayıtlı ve otomatik artırılamadı (numara "...-01" formatında değil).\n\nLütfen bu sipariş için yeni bir numara girin:`,
                    orderNumber,
                    { title: 'Yeni Sipariş No' }
                );
                if (!manual || !manual.trim()) { await showAlertDialog('Sipariş no girilmediği için işlem iptal edildi.', { variant: 'warn', title: 'İşlem İptal Edildi' }); return; }
                const manualTrimmed = manual.trim();
                const { data: manualDup } = await supabase.from('orders').select('id')
                    .eq('user_id', userId).eq('order_number', manualTrimmed).eq('customer_id', customerId);
                if (manualDup && manualDup.length > 0) {
                    await showAlertDialog(`"${manualTrimmed}" numarası da bu müşteri için zaten kullanımda. İşlem iptal edildi, lütfen sipariş modülünden elle düzenleyin.`, { variant: 'danger', title: 'Numara Kullanımda' });
                    return;
                }
                orderNumber = manualTrimmed;
            } else if (resolved !== orderNumber) {
                const okResolved = await showConfirmDialog(
                    `Sipariş No "${orderNumber}" bu müşteri için zaten kullanımda (muhtemelen aynı teklif numarasıyla gönderilmiş başka bir teklif zaten siparişe dönüştürülmüş).\n\nBu sipariş "${resolved}" numarasıyla oluşturulacak. Onaylıyor musunuz?`,
                    { title: 'Sipariş No Çakışması' }
                );
                if (!okResolved) return;
                orderNumber = resolved;
            }
        }

        // Kalem miktarları toplamı (order_quantity için)
        const totalQty = quotationItemsBuffer.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);

        const orderPayload = {
            user_id:            userId,
            customer_id:        customerId,
            order_number:       orderNumber,
            order_date:         new Date().toISOString().slice(0, 10),
            order_type:         orderType,
            currency,
            total_amount,
            advance_payment:    0,
            remaining_balance:  total_amount,
            payment_method:     paymentMethod,
            order_status:       'Yeni Müşteri',
            status_tags:        ['Yeni Müşteri'],
            order_quantity:     manualQuantity || (totalQty > 0 ? String(totalQty) : null),
            order_notes:        `Teklif ${quotationNumber || q.id} üzerinden oluşturuldu.${notes ? ' ' + notes : ''}`.trim(),
        };

        const { data: orderData, error: oErr } = await supabase.from('orders').insert([orderPayload]).select().single();
        if (oErr) throw oErr;

        await maybeUpdateCustomerStatus(
            customerId, 'Potansiyel', 'Aktif',
            'Sipariş oluşturulduğu için durum Potansiyel\'ten Aktif\'e güncellendi.'
        );

        // Teklif kalemlerini sipariş kalemlerine kopyala
        const orderItems = quotationItemsBuffer
            .filter(item => item.product_name)
            .map(item => ({
                order_id: orderData.id,
                user_id: userId,
                product_id: item.product_id || null,
                product_name: item.product_name,
                product_code: item.product_code || null,
                quantity: item.quantity || null,
                unit_price: item.unit_price || null,
                currency,
                notes: item.notes || null,
            }));

        if (orderItems.length > 0) {
            const { error: iErr } = await supabase.from('order_items').insert(orderItems);
            if (iErr) throw iErr;
        }

        // Teklifi kalıcı olarak sil (kalemler dahil)
        await supabase.from('quotation_items').delete().eq('quotation_id', currentQuotationId);
        const { error: delErr } = await supabase.from('quotations').delete().eq('id', currentQuotationId).eq('user_id', userId);
        if (delErr) throw delErr;

        logChange({ ctx, moduleId: 'orders', action: 'create', summary: `Teklif ${quotationNumber || q.id} siparişe dönüştürüldü: ${orderData.order_number || orderData.id}` });
        logChange({ ctx, moduleId: 'quotations', action: 'delete', summary: `Teklif siparişe dönüştürülüp silindi: ${quotationNumber || q.id}` });

        await showAlertDialog(`Sipariş oluşturuldu: ${orderData.order_number || orderData.id}\nTeklif, teklif listesinden kaldırıldı.`, { variant: 'success', title: 'Başarılı' });
        closeQuotationModal();
        await fetchQuotationsData();
    } catch (err) {
        console.error('Siparişe gönderilemedi:', err.message);
        await showAlertDialog('Hata: ' + err.message + '\n\nSipariş oluşturulmuş olabilir, lütfen sipariş modülünü kontrol edin.', { variant: 'danger', title: 'Hata' });
    }
}

// ── SİPARİŞ NO OTOMATİK ARTIRMA ───────────────────────────────────────────────
// "PREFIX-NN" formatındaki bir numaranın, verilen müşteri için ilk müsait
// halini bulur. Format uymuyorsa null döner (çağıran taraf elle sormalı).
async function resolveNextAvailableOrderNumber(customerId, baseNumber, userId) {
    const { data: existing, error } = await supabase
        .from('orders')
        .select('order_number')
        .eq('customer_id', customerId)
        .eq('user_id', userId);
    if (error) throw error;

    const usedSet = new Set((existing || []).map(o => o.order_number).filter(Boolean));
    if (!usedSet.has(baseNumber)) return baseNumber; // zaten müsait

    const match = baseNumber.match(/^(.*-)(\d+)$/);
    if (!match) return null; // "...-NN" formatında değil, otomatik artırılamaz

    const prefix = match[1];
    const pad    = match[2].length;
    let num      = parseInt(match[2], 10);
    let candidate;
    let guard = 0;
    do {
        num += 1;
        candidate = prefix + String(num).padStart(pad, '0');
        guard++;
    } while (usedSet.has(candidate) && guard < 1000);

    return candidate;
}

// ── FİLTRELEME ───────────────────────────────────────────────────────────────
function applyFilters() {
    const search       = document.getElementById('quotation-search-input').value.toLocaleLowerCase('tr-TR');
    const currency     = document.getElementById('filter-quotation-currency').value;
    const statusFilter = document.getElementById('filter-quotation-status').value;

    const filtered = globalQuotations.filter(q => {
        const compName = (q.customers?.company_name || '').toLocaleLowerCase('tr-TR');
        const qNo      = (q.quotation_number || '').toLocaleLowerCase('tr-TR');
        const matchSearch   = compName.includes(search) || qNo.includes(search);
        const matchCurrency = !currency || q.currency === currency;
        const matchStatus   = !statusFilter || q.status === statusFilter;
        return matchSearch && matchCurrency && matchStatus;
    });

    renderQuotationsList(filtered);
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

function currentQuotationCurrencySymbol() {
    const sym = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
    const code = document.getElementById('currency')?.value || 'EUR';
    return sym[code] || code;
}

function updateItemsColumnHeaders() {
    const s = currentQuotationCurrencySymbol();
    const priceTh  = document.getElementById('th-unit-price');
    const amountTh = document.getElementById('th-amount');
    if (priceTh)  priceTh.textContent  = `Birim Fiyat (${s})`;
    if (amountTh) amountTh.textContent = `Tutar (${s})`;
}

function renderItemsTable() {
    const tbody = document.getElementById('items-table-body');
    tbody.innerHTML = '';
    updateItemsColumnHeaders();

    if (quotationItemsBuffer.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#968B7A;padding:24px;font-size:13px;">Henüz teklif kalemi eklenmedi. "Satır Ekle" butonunu kullanın.</td></tr>`;
        updateItemsTotal();
        return;
    }

    quotationItemsBuffer.forEach((item, idx) => {
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
                        quotationItemsBuffer[idx].product_id   = prod.id;
                        quotationItemsBuffer[idx].product_name = prod.stok_adi_1;
                        quotationItemsBuffer[idx].product_code = prod.stok_kodu || '';
                        renderItemsTable();
                    });
                });
            }, 120);
        });

        inp.addEventListener('blur', () => setTimeout(() => dd.classList.add('hidden'), 150));
        inp.addEventListener('focus', () => { if (inp.value.length >= 1) inp.dispatchEvent(new Event('input')); });
        inp.addEventListener('change', () => {
            if (!quotationItemsBuffer[idx].product_id) quotationItemsBuffer[idx].product_name = inp.value.trim();
        });
    });

    tbody.querySelectorAll('.item-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            quotationItemsBuffer[idx].product_id   = null;
            quotationItemsBuffer[idx].product_name = '';
            quotationItemsBuffer[idx].product_code = '';
            renderItemsTable();
            const inp = tbody.querySelector(`.item-search[data-idx="${idx}"]:not(.hidden)`);
            if (inp) inp.focus();
        });
    });

    tbody.querySelectorAll('.item-product-code').forEach(inp => {
        inp.addEventListener('input', e => { quotationItemsBuffer[parseInt(e.target.dataset.idx)].product_code = e.target.value; });
    });
    tbody.querySelectorAll('.item-quantity').forEach(inp => {
        inp.addEventListener('input', e => {
            const idx = parseInt(e.target.dataset.idx);
            quotationItemsBuffer[idx].quantity = parseFloat(e.target.value) || null;
            updateItemAmount(tbody, idx); updateItemsTotal();
        });
    });
    tbody.querySelectorAll('.item-unit-price').forEach(inp => {
        inp.addEventListener('input', e => {
            const idx = parseInt(e.target.dataset.idx);
            quotationItemsBuffer[idx].unit_price = parseFloat(e.target.value) || null;
            updateItemAmount(tbody, idx); updateItemsTotal();
        });
    });
    tbody.querySelectorAll('.btn-remove-item').forEach(btn => {
        btn.addEventListener('click', e => {
            quotationItemsBuffer.splice(parseInt(e.currentTarget.dataset.idx), 1);
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
    if (cell) cell.textContent = calcAmount(quotationItemsBuffer[idx].quantity, quotationItemsBuffer[idx].unit_price);
}

// Kalem toplamı ile genel toplam arasındaki fark, bilinen bir KDV oranına (%1/%8/%10/%18/%20)
// denk geliyorsa kullanıcıyı bilgilendir — aksi halde "yanlış kayıt" sanılabilir.
function vatMismatchHint(itemsTotal, targetTotal) {
    if (itemsTotal <= 0) return '';
    const ratio = targetTotal / itemsTotal;
    const vatRates = [0.20, 0.18, 0.10, 0.08, 0.01];
    for (const rate of vatRates) {
        if (Math.abs(ratio - (1 + rate)) < 0.005) {
            return ` Muhtemel sebep: PDF'deki kalem fiyatları KDV hariç, genel toplam ise %${Math.round(rate * 100)} KDV dahil görünüyor — kayıt hatası olmayabilir.`;
        }
    }
    return '';
}

function updateItemsTotal() {
    const total = quotationItemsBuffer.reduce((s, i) =>
        s + ((parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0)), 0);
    document.getElementById('items-total').textContent = total.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    const qtyTotal = quotationItemsBuffer.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);
    document.getElementById('items-qty-total').textContent = qtyTotal.toLocaleString('tr-TR');

    const qTotal = parseTurkishFloat(document.getElementById('total_amount').value);
    const warn = document.getElementById('items-total-warning');
    if (qTotal > 0 && Math.abs(total - qTotal) > 0.01) {
        warn.classList.remove('hidden');
        warn.textContent = `⚠ Kalem toplamı (${total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}) teklif tutarından (${qTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}) farklı!${vatMismatchHint(total, qTotal)}`;
    } else {
        warn.classList.add('hidden');
    }
}

function addItemRow() {
    quotationItemsBuffer.push({ id: null, product_id: null, product_name: '', product_code: '', quantity: null, unit_price: null, notes: '' });
    switchTab('items');
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
// Değeri (tam sayı, "2,0" gibi ondalık, ya da bomboş sütun için tek başına "-") hiç kullanılmıyor,
// sadece atlanıyor: bu modülde palet hesabı kapsam dışı.
// Ürün kodu ya bizim standart tireli formatımız (SETK3104-2615-165-1-6000, 53-01-04-031) ya da
// tireli olmayan tek parça bir kod (örn. tedarikçiden alınıp tek seferlik satılan bir ürünün kodu,
// TM00415 gibi — büyük harf + rakam, boşluksuz) olabilir.
// Satır sonunda ($) durmuyor: bazı şablonlarda TUTAR'dan sonra Net/Gross Weight, Palet Ölçüleri gibi
// ek sütunlar aynı satırda devam ediyor — TUTAR'ı yakalayınca durmak yeterli, satırın gerisini görmezden gel.
// Bazı şablonlarda NET FİYAT'tan önce LİSTE FİYATI + İSKONTO % sütunları da var
// (örn. "278,00 € 76,00% 66,72 € 400,32 €" → liste fiyatı, iskonto, NET FİYAT, TUTAR).
// İskonto her zaman "%" ile bitişik yazıldığından bu iki fazladan sütun, sadece bu şablonlarda
// devreye giren opsiyonel bir blokla atlanıyor — NET FİYAT ve TUTAR her zaman doğru yakalanıyor.
const PDF_ITEM_LINE_RE = /((?:[A-Za-z0-9]+\s*-\s*){2,}[A-Za-z0-9]+|\b[A-Z]{2,8}\d{2,8}\b)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:pcs|ad|adet)\.?\s+(?:(?:\d+(?:[.,]\d+)?|-)\s+)?(?:[\d.,]+\s*\S{0,2}\s+[\d.,]+%\s+)?([\d.,]+)\s*\S{0,2}\s+([\d.,]+)\s*\S{0,2}/gim;

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
            // Boş RENK/DELİK sütunları için PDF'de bırakılan "-" işaretleri satır sonunda kalabiliyor.
            description: m[2].trim().replace(/(?:\s+-)+$/, '').trim(),
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

        // Ürün kodu eşleştirme — sistemde kayıtlı olmayan kod varsa, ürün kartı açmadan
        // serbest metin olarak içe aktarmak isteyip istemediği sorulur (tek seferlik ürünler için).
        const productByCode = new Map();
        for (const it of items) {
            const prod = globalProducts.find(p =>
                (p.stok_kodu || '').trim().toLocaleUpperCase('tr-TR') === it.code.toLocaleUpperCase('tr-TR')
            );
            if (prod) productByCode.set(it.code, prod);
        }
        const unmatched = items.filter(it => !productByCode.has(it.code));

        if (unmatched.length > 0) {
            const list = unmatched.map(u => `• ${u.code} — ${u.description}`).join('\n');
            const importAsFreeText = await showConfirmDialog(
                `Aşağıdaki ürün kodları sistemde (Ürün Kartları) kayıtlı değil:\n\n${list}\n\nBu kalemleri ürün kartı oluşturmadan, PDF'deki kod/açıklama ile serbest metin olarak içe aktarayım mı?`,
                { title: 'Eşleşmeyen Ürün Kodları', variant: 'warn', confirmText: 'Serbest Metin Olarak Aktar' }
            );
            if (!importAsFreeText) return;
        }

        if (quotationItemsBuffer.length > 0) {
            const ok = await showConfirmDialog(
                'Kalem tablosunda zaten satırlar var. PDF içe aktarma, mevcut tüm kalem satırlarının yerine PDF\'deki satırları koyacak. Devam edilsin mi?',
                { title: 'Mevcut Kalemler Değiştirilecek', variant: 'warn', confirmText: 'Değiştir ve Devam Et' }
            );
            if (!ok) return;
        }

        // Teklif No / Teklif Tarihi alanlarını doldur (mevcut değer varsa onay iste)
        const quotationNoInput   = document.getElementById('quotation_number');
        const quotationDateInput = document.getElementById('quotation_date');

        if (piNo) {
            if (quotationNoInput.value && quotationNoInput.value !== piNo) {
                const ok = await showConfirmDialog(
                    `Teklif No alanı zaten "${quotationNoInput.value}" olarak dolu. PDF'deki PI NO değeri "${piNo}" ile değiştirilsin mi?`,
                    { title: 'Teklif No Çakışması', variant: 'warn', confirmText: 'Değiştir' }
                );
                if (ok) quotationNoInput.value = piNo;
            } else {
                quotationNoInput.value = piNo;
            }
        }
        if (piDate) {
            if (quotationDateInput.value && quotationDateInput.value !== piDate) {
                const ok = await showConfirmDialog(
                    `Teklif Tarihi alanı zaten dolu. PDF'deki PI DATE değeri ile değiştirilsin mi?`,
                    { title: 'Teklif Tarihi Çakışması', variant: 'warn', confirmText: 'Değiştir' }
                );
                if (ok) quotationDateInput.value = piDate;
            } else {
                quotationDateInput.value = piDate;
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

        // Kalem tablosunu PDF'deki kalemlerle değiştir (eşleşen ürünler kart bilgisiyle,
        // eşleşmeyenler PDF'deki kod/açıklama ile serbest metin olarak)
        quotationItemsBuffer = items.map(it => {
            const prod = productByCode.get(it.code);
            return {
                id: null,
                product_id: prod ? prod.id : null,
                product_name: prod ? prod.stok_adi_1 : it.description,
                product_code: prod ? prod.stok_kodu : it.code,
                quantity: it.quantity,
                unit_price: it.netPrice,
                notes: null,
            };
        });

        switchTab('items');

        // Adet x Net Fiyat ile PDF'deki AMOUNT tutarı uyuşmuyorsa uyar (parsing kontrolü)
        const mismatches = items.filter(it => Math.abs(it.quantity * it.netPrice - it.amount) > 0.05);
        const freeTextNote = unmatched.length > 0 ? ` (${unmatched.length} tanesi serbest metin olarak, ürün kartı olmadan)` : '';
        if (mismatches.length > 0) {
            const list = mismatches.map(u => `• ${u.code}: ${u.quantity} x ${u.netPrice} ≠ ${u.amount}`).join('\n');
            await showAlertDialog(
                `${items.length} kalem içe aktarıldı${freeTextNote}, ancak şu satırlarda Adet x Net Fiyat, PDF'deki AMOUNT ile uyuşmuyor — lütfen kontrol edin:\n\n${list}`,
                { variant: 'warn', title: 'Kontrol Gerekli' }
            );
        } else {
            await showAlertDialog(`${items.length} ürün kalemi PDF'den başarıyla içe aktarıldı${freeTextNote}.`, { variant: 'success', title: 'İçe Aktarma Tamamlandı' });
        }
    } catch (err) {
        console.error('PDF kalem import hatası:', err.message);
        await showAlertDialog('PDF işlenirken hata oluştu: ' + err.message, { variant: 'danger', title: 'Hata' });
    }
}

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────
function initEventListeners() {
    document.getElementById('btn-open-quotation-modal').addEventListener('click', openModalForCreate);
    document.getElementById('btn-close-quotation-modal').addEventListener('click', closeQuotationModal);
    document.getElementById('btn-quotation-cancel').addEventListener('click', closeQuotationModal);
    document.getElementById('quotation-form').addEventListener('submit', handleQuotationSubmit);
    document.getElementById('btn-delete-quotation').addEventListener('click', handleDeleteQuotation);
    document.getElementById('btn-send-to-order').addEventListener('click', handleSendToOrder);
    document.getElementById('quotation-search-input').addEventListener('input', applyFilters);
    document.getElementById('filter-quotation-currency').addEventListener('change', applyFilters);
    document.getElementById('filter-quotation-status').addEventListener('change', applyFilters);
    document.getElementById('btn-add-item-row').addEventListener('click', addItemRow);
    document.getElementById('currency').addEventListener('change', updateItemsColumnHeaders);
    document.getElementById('tab-general').addEventListener('click', () => switchTab('general'));
    document.getElementById('tab-items').addEventListener('click', () => switchTab('items'));

    document.getElementById('total_amount').addEventListener('input', updateItemsTotal);

    // PDF'den kalem içe aktarma
    const pdfItemInput = document.getElementById('pdf-item-import-input');
    document.getElementById('btn-import-pdf-items').addEventListener('click', () => pdfItemInput.click());
    pdfItemInput.addEventListener('change', () => {
        if (pdfItemInput.files[0]) handlePdfItemFileSelect(pdfItemInput.files[0]);
        pdfItemInput.value = '';
    });
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
