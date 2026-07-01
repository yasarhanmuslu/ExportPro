// quotations.js — V: 1.0.84
import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

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

// ── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    await renderNavbar('quotations');
    await Promise.all([fetchCustomersData(), fetchQuotationsData(), fetchProductsData()]);
    initEventListeners();
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
        const aktifCustomers = globalCustomers.filter(c => c.status === 'Aktif');
        initCustomerSearchDropdown(aktifCustomers);
    } catch (err) {
        console.error('Müşteri listesi yüklenemedi:', err.message);
    }
}

async function fetchProductsData() {
    try {
        const { data, error } = await supabase
            .from('urunler')
            .select('id, stok_kodu, stok_adi_1')
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
                item.addEventListener('mousedown', e => {
                    e.preventDefault();
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
    document.getElementById('currency').value          = q.currency || 'EUR';
    document.getElementById('total_amount').value      = parseFloat(q.total_amount || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
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
    const customerId = document.getElementById('quotation-customer-select').value;
    if (!customerId) { alert('Lütfen bir müşteri / firma seçiniz.'); return; }

    const total_amount = parseTurkishFloat(document.getElementById('total_amount').value);
    if (isNaN(total_amount) || total_amount <= 0) {
        alert('Lütfen geçerli bir toplam teklif tutarı giriniz.');
        return;
    }

    const payload = {
        customer_id:      customerId,
        quotation_number: document.getElementById('quotation_number').value || null,
        quotation_date:   document.getElementById('quotation_date').value || null,
        valid_until:      document.getElementById('valid_until').value || null,
        currency:         document.getElementById('currency').value,
        total_amount,
        status:           document.getElementById('q_status').value || 'Bekliyor',
        notes:            document.getElementById('quotation_notes').value || null,
    };

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session.user.id;
        let quotationId = currentQuotationId;

        // Not: Teklif No müşteri bazında MÜKERRER OLABİLİR — kasıtlı iş akışı.
        // Bir müşteriye aynı numarayla birden fazla teklif gönderilebilir (ör. "2026-01"
        // ile 3 farklı teklif); hangisi onaylanırsa o siparişe dönüştürülür, kalanlar
        // aynı numarayla teklif listesinde durmaya devam eder. Bu yüzden burada
        // teklif no için mükerrer kontrolü YAPILMAZ. Mükerrerlik kontrolü yalnızca
        // "Siparişe Gönder" adımında, orders tablosu için uygulanır.

        if (currentQuotationId) {
            const { error } = await supabase.from('quotations').update(payload).eq('id', currentQuotationId).eq('user_id', userId);
            if (error) throw error;
        } else {
            payload.user_id = userId;
            const { data, error } = await supabase.from('quotations').insert([payload]).select().single();
            if (error) throw error;
            quotationId = data.id;
        }

        await saveQuotationItems(quotationId, userId);
        closeQuotationModal();
        await fetchQuotationsData();
    } catch (err) {
        console.error('Teklif kaydedilemedi:', err.message);
        alert('Hata: ' + err.message);
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
            notes: item.notes || null,
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
    const id = document.getElementById('quotation-id').value;
    if (!id || !confirm('Bu teklifi kalıcı olarak silmek istediğinize emin misiniz?')) return;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        await supabase.from('quotation_items').delete().eq('quotation_id', id);
        const { error } = await supabase.from('quotations').delete().eq('id', id).eq('user_id', session.user.id);
        if (error) throw error;
        closeQuotationModal();
        await fetchQuotationsData();
    } catch (err) {
        console.error('Teklif silinemedi:', err.message);
        alert('Silme başarısız: ' + err.message);
    }
}

// ── SİPARİŞE GÖNDER ───────────────────────────────────────────────────────────
async function handleSendToOrder() {
    if (!currentQuotationId) return;
    const q = globalQuotations.find(x => x.id === currentQuotationId);
    if (!q) return;

    if (q.status === 'Sipariş Dönüştü') {
        alert('Bu teklif zaten siparişe dönüştürülmüş.');
        return;
    }

    const customerId = document.getElementById('quotation-customer-select').value;
    if (!customerId) { alert('Lütfen bir müşteri / firma seçiniz.'); return; }

    const total_amount = parseTurkishFloat(document.getElementById('total_amount').value);
    const currency     = document.getElementById('currency').value;
    const quotationNumber = document.getElementById('quotation_number').value || null;
    const notes = document.getElementById('quotation_notes').value || '';

    if (!confirm(`"${quotationNumber || q.id}" teklifi SİPARİŞE gönderilecek ve teklif modülünden kalıcı olarak silinecektir.\n\nDevam etmek istiyor musunuz?`)) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session.user.id;

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
                const manual = prompt(
                    `Sipariş No "${orderNumber}" bu müşteri için sipariş modülünde zaten kayıtlı ve otomatik artırılamadı (numara "...-01" formatında değil).\n\nLütfen bu sipariş için yeni bir numara girin:`,
                    orderNumber
                );
                if (!manual || !manual.trim()) { alert('Sipariş no girilmediği için işlem iptal edildi.'); return; }
                const manualTrimmed = manual.trim();
                const { data: manualDup } = await supabase.from('orders').select('id')
                    .eq('user_id', userId).eq('order_number', manualTrimmed).eq('customer_id', customerId);
                if (manualDup && manualDup.length > 0) {
                    alert(`"${manualTrimmed}" numarası da bu müşteri için zaten kullanımda. İşlem iptal edildi, lütfen sipariş modülünden elle düzenleyin.`);
                    return;
                }
                orderNumber = manualTrimmed;
            } else if (resolved !== orderNumber) {
                if (!confirm(`Sipariş No "${orderNumber}" bu müşteri için zaten kullanımda (muhtemelen aynı teklif numarasıyla gönderilmiş başka bir teklif zaten siparişe dönüştürülmüş).\n\nBu sipariş "${resolved}" numarasıyla oluşturulacak. Onaylıyor musunuz?`)) {
                    return;
                }
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
            currency,
            total_amount,
            advance_payment:    0,
            remaining_balance:  total_amount,
            order_status:       'Yeni Müşteri',
            status_tags:        ['Yeni Müşteri'],
            order_quantity:     totalQty > 0 ? String(totalQty) : null,
            order_notes:        `Teklif ${quotationNumber || q.id} üzerinden oluşturuldu.${notes ? ' ' + notes : ''}`.trim(),
        };

        const { data: orderData, error: oErr } = await supabase.from('orders').insert([orderPayload]).select().single();
        if (oErr) throw oErr;

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

        alert(`Sipariş oluşturuldu: ${orderData.order_number || orderData.id}\nTeklif, teklif listesinden kaldırıldı.`);
        closeQuotationModal();
        await fetchQuotationsData();
    } catch (err) {
        console.error('Siparişe gönderilemedi:', err.message);
        alert('Hata: ' + err.message + '\n\nSipariş oluşturulmuş olabilir, lütfen sipariş modülünü kontrol edin.');
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
function renderItemsTable() {
    const tbody = document.getElementById('items-table-body');
    tbody.innerHTML = '';

    if (quotationItemsBuffer.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#968B7A;padding:24px;font-size:13px;">Henüz teklif kalemi eklenmedi. "Satır Ekle" butonunu kullanın.</td></tr>`;
        updateItemsTotal();
        return;
    }

    quotationItemsBuffer.forEach((item, idx) => {
        const productOptions = globalProducts.map(p =>
            `<option value="${p.id}" data-code="${escapeHtml(p.stok_kodu || '')}" data-name="${escapeHtml(p.stok_adi_1)}" ${item.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.stok_adi_1)}</option>`
        ).join('');

        const tr = document.createElement('tr');
        tr.dataset.idx = idx;
        tr.innerHTML = `
            <td style="min-width:200px;">
                <select class="item-product-select" data-idx="${idx}" style="height:34px;font-size:12px;">
                    <option value="">-- Ürün Seç --</option>${productOptions}
                </select>
                <input type="text" class="item-product-name mt-1" data-idx="${idx}" value="${escapeHtml(item.product_name || '')}" placeholder="veya serbest metin" style="height:30px;font-size:11px;margin-top:4px;">
            </td>
            <td style="min-width:110px;">
                <input type="text" class="item-product-code" data-idx="${idx}" value="${escapeHtml(item.product_code || '')}" placeholder="Ürün kodu" style="height:34px;font-size:12px;">
            </td>
            <td style="min-width:90px;">
                <input type="number" class="item-quantity" data-idx="${idx}" value="${item.quantity || ''}" placeholder="0" step="any" style="height:34px;font-size:12px;text-align:right;">
            </td>
            <td style="min-width:120px;">
                <input type="number" class="item-unit-price" data-idx="${idx}" value="${item.unit_price || ''}" placeholder="0.00" step="any" style="height:34px;font-size:12px;text-align:right;">
            </td>
            <td style="text-align:right;font-weight:600;font-size:13px;color:#2D4A3E;" class="item-amount" data-idx="${idx}">
                ${calcAmount(item.quantity, item.unit_price)}
            </td>
            <td style="text-align:center;">
                <button class="btn-remove-item" data-idx="${idx}" style="background:none;border:none;cursor:pointer;color:#9F3D3D;font-size:13px;padding:4px 8px;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
                <input type="text" class="item-notes" data-idx="${idx}" value="${escapeHtml(item.notes || '')}" placeholder="Not" style="height:28px;font-size:11px;margin-top:4px;display:block;">
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.item-product-select').forEach(sel => {
        sel.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.idx);
            const opt = e.target.selectedOptions[0];
            if (opt?.value) {
                quotationItemsBuffer[idx].product_id   = opt.value;
                quotationItemsBuffer[idx].product_name = opt.dataset.name || '';
                quotationItemsBuffer[idx].product_code = opt.dataset.code || '';
                const nameInp = tbody.querySelector(`.item-product-name[data-idx="${idx}"]`);
                const codeInp = tbody.querySelector(`.item-product-code[data-idx="${idx}"]`);
                if (nameInp) nameInp.value = opt.dataset.name || '';
                if (codeInp) codeInp.value = opt.dataset.code || '';
            }
        });
    });
    tbody.querySelectorAll('.item-product-name').forEach(inp => {
        inp.addEventListener('input', e => { quotationItemsBuffer[parseInt(e.target.dataset.idx)].product_name = e.target.value; });
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
    tbody.querySelectorAll('.item-notes').forEach(inp => {
        inp.addEventListener('input', e => { quotationItemsBuffer[parseInt(e.target.dataset.idx)].notes = e.target.value; });
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

function updateItemsTotal() {
    const total = quotationItemsBuffer.reduce((s, i) =>
        s + ((parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0)), 0);
    document.getElementById('items-total').textContent = total.toLocaleString('tr-TR', { minimumFractionDigits: 2 });

    const qTotal = parseTurkishFloat(document.getElementById('total_amount').value);
    const warn = document.getElementById('items-total-warning');
    if (qTotal > 0 && Math.abs(total - qTotal) > 0.01) {
        warn.classList.remove('hidden');
        warn.textContent = `⚠ Kalem toplamı (${total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}) teklif tutarından (${qTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}) farklı!`;
    } else {
        warn.classList.add('hidden');
    }
}

function addItemRow() {
    quotationItemsBuffer.push({ id: null, product_id: null, product_name: '', product_code: '', quantity: null, unit_price: null, notes: '' });
    switchTab('items');
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
    document.getElementById('tab-general').addEventListener('click', () => switchTab('general'));
    document.getElementById('tab-items').addEventListener('click', () => switchTab('items'));

    document.getElementById('total_amount').addEventListener('input', updateItemsTotal);
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
