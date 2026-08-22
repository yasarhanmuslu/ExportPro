import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';
import { DEFECTS, defectLabel, matchDefect } from './utils/defectCatalog.js';
import {
    parseCreditNoteFile,
    matchCustomer as matchCustomerIn,
    matchCustomerDetailed,
    findExcelHeader,
    groupExcelRows,
} from './utils/creditNoteImport.js';
import {
    DECISIONS, PROCESS_STATUSES, COMPENSATION_TYPES, CURRENCIES,
    getDecision, decisionLabel, normalizeDecision, isCredited, isHalfPriceDecision,
    lineAmount, calcTotal, calcFreeGoodsQty, effectiveTotal,
    parseProductIdCell, serialKey, customerRefKey,
    formatMoney, parseAmount,
} from './utils/creditNoteRules.js';

// ── Global hafıza ────────────────────────────────────────────────────────────
let globalCreditNotes = [];
let globalCustomers   = [];
let globalProducts    = [];   // urunler kataloğu
let globalOrders      = [];
let ctx = null;

// Ürün ID / müşteri referansı -> hangi CN'lerde geçtiği.
// "Aynı ürünü daha sonradan yeniden işleme almamak" kontrolünün veri kaynağı.
let usageIndex = new Map();

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'credit-notes'))) return;

    await renderNavbar('credit-notes', ctx);
    fillStaticSelects();

    await Promise.all([fetchCustomers(), fetchProducts(), fetchOrders()]);
    await fetchCreditNotes();

    initEventListeners();
    applyEditLock(ctx, 'credit-notes');

    // Siparişler ekranındaki Credit Note etiketinden gelinmişse o siparişi filtrele.
    const orderParam = new URLSearchParams(window.location.search).get('order');
    if (orderParam) {
        document.getElementById('cn-search-input').value = orderParam;
        renderAll();
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// VERİ ÇEKME
// ═════════════════════════════════════════════════════════════════════════════
async function fetchCustomers() {
    // currency: CN'nin para birimi varsayılanı müşteri kartından gelir —
    // her şeyi EUR saymak yanlış tutar üretiyordu (ör. Waterships USD).
    const { data, error } = await supabase
        .from('customers')
        .select('id, company_name, country, currency')
        .order('company_name', { ascending: true });
    if (error) { console.error('Müşteriler yüklenemedi:', error.message); return; }
    globalCustomers = data || [];

    document.getElementById('filter-cn-customer').innerHTML =
        '<option value="">Tüm Müşteriler</option>' + globalCustomers
            .map(c => `<option value="${c.id}">${escapeHtml(c.company_name)}${c.country ? ' (' + escapeHtml(c.country) + ')' : ''}</option>`)
            .join('');
}

// ── Müşteri arama açılır listesi (orders.js ile aynı kalıp) ──────────────────
function initCustomerDropdown() {
    const search = document.getElementById('cn-customer-search');
    const hidden = document.getElementById('cn-customer-select');
    const list   = document.getElementById('cn-customer-list');

    const render = filterText => {
        const q = (filterText || '').toLocaleLowerCase('tr-TR');
        const filtered = globalCustomers.filter(c =>
            (c.company_name || '').toLocaleLowerCase('tr-TR').includes(q) ||
            (c.country || '').toLocaleLowerCase('tr-TR').includes(q));

        list.innerHTML = filtered.length === 0
            ? `<div style="padding:10px 14px;font-size:12px;color:var(--ink-3);">Sonuç bulunamadı</div>`
            : filtered.slice(0, 200).map(c => `
                <div class="cn-customer-item" data-id="${c.id}">
                    <span style="font-weight:600;color:var(--ink-1);">${escapeHtml(c.company_name)}</span>
                    <span style="font-size:11px;color:var(--ink-3);margin-left:6px;text-transform:uppercase;">${escapeHtml(c.country || '')}</span>
                </div>`).join('');

        list.querySelectorAll('.cn-customer-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                selectCustomer(item.dataset.id, { applyCurrency: true });
                list.classList.add('hidden');
            });
        });
        list.classList.remove('hidden');
    };

    search.addEventListener('input', () => render(search.value));
    search.addEventListener('focus', () => render(search.value));
    search.addEventListener('blur',  () => setTimeout(() => list.classList.add('hidden'), 150));
}

function selectCustomer(id, { applyCurrency = false } = {}) {
    const c = globalCustomers.find(x => x.id === id);
    document.getElementById('cn-customer-select').value = id || '';
    document.getElementById('cn-customer-search').value =
        c ? `${c.company_name}${c.country ? ' (' + c.country + ')' : ''}` : '';

    // Müşterinin kendi para birimi varsa CN'e uygula (elle değiştirilebilir).
    if (applyCurrency && c && CURRENCIES.includes(c.currency)) {
        document.getElementById('cn_currency').value = c.currency;
    }
    refreshOrderOptions();
    document.querySelectorAll('.cn-item-row').forEach(checkRowDuplicates);
    refreshTotals();
}

// Gerçek ürün kataloğu `urunler`. (Eski kod var olmayan bir `products` tablosunu
// sorguluyordu; bu yüzden ürün seçimi hiç çalışmıyordu.)
async function fetchProducts() {
    const { data, error } = await supabase
        .from('urunler')
        .select('id, stok_kodu, stok_adi_1, stok_adi_2')
        .order('stok_kodu', { ascending: true });
    if (error) { console.error('Ürün kataloğu yüklenemedi:', error.message); return; }
    globalProducts = data || [];
}

async function fetchOrders() {
    const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, order_date, customer_id, currency')
        .order('order_date', { ascending: false });
    if (error) { console.error('Siparişler yüklenemedi:', error.message); return; }
    globalOrders = data || [];
}

async function fetchCreditNotes() {
    try {
        const { data, error } = await supabase
            .from('credit_notes')
            .select(`
                *,
                customers!fk_credit_notes_customer ( company_name, country ),
                credit_note_items ( * )
            `)
            .order('cn_date', { ascending: false });
        if (error) throw error;

        globalCreditNotes = (data || []).map(n => ({
            ...n,
            credit_note_items: (n.credit_note_items || [])
                .slice()
                .sort((a, b) => (a.line_no ?? 9999) - (b.line_no ?? 9999)),
        }));

        buildUsageIndex();
        populateYearFilter();
        renderAll();
    } catch (err) {
        console.error('Credit Note verileri yüklenemedi:', err.message);
        document.getElementById('cn-table-body').innerHTML =
            `<tr><td colspan="9" style="text-align:center;color:var(--danger);padding:24px;">
                Veriler yüklenirken hata oluştu: ${escapeHtml(err.message)}
             </td></tr>`;
    }
}

// Ürün ID ve müşteri referanslarının hangi CN'lerde geçtiğini indeksler.
function buildUsageIndex() {
    usageIndex = new Map();
    const add = (key, entry) => {
        if (!key) return;
        if (!usageIndex.has(key)) usageIndex.set(key, []);
        usageIndex.get(key).push(entry);
    };
    globalCreditNotes.forEach(n => {
        const entry = {
            cnId:      n.id,
            cnNo:      n.cn_no,
            cnDate:    n.cn_date,
            customer:  n.customers?.company_name || '—',
        };
        (n.credit_note_items || []).forEach(i => {
            add(serialKey(i.product_serial), { ...entry, itemId: i.id });
            add(customerRefKey(n.customer_id, i.customer_ref), { ...entry, itemId: i.id });
        });
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// STATİK SEÇENEKLER
// ═════════════════════════════════════════════════════════════════════════════
function fillStaticSelects() {
    document.getElementById('cn_currency').innerHTML =
        CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');

    document.getElementById('cn_process_status').innerHTML =
        PROCESS_STATUSES.map(s => `<option value="${s.value}" title="${escapeHtml(s.hint)}">${s.value}</option>`).join('');

    document.getElementById('filter-cn-status').innerHTML =
        '<option value="">Tüm Süreç Durumları</option>' +
        PROCESS_STATUSES.map(s => `<option value="${s.value}">${s.value}</option>`).join('');

    document.getElementById('filter-cn-decision').innerHTML =
        '<option value="">Tüm Kararlar</option>' +
        DECISIONS.map(d => `<option value="${d.value}">${d.tr}</option>`).join('');
}

function populateYearFilter() {
    const years = [...new Set(globalCreditNotes.map(n => (n.cn_date || '').slice(0, 4)).filter(Boolean))]
        .sort().reverse();
    const sel = document.getElementById('filter-cn-year');
    const current = sel.value;
    sel.innerHTML = '<option value="">Tüm Yıllar</option>' +
        years.map(y => `<option value="${y}">${y}</option>`).join('');
    if (years.includes(current)) sel.value = current;
}

// ═════════════════════════════════════════════════════════════════════════════
// RENDER
// ═════════════════════════════════════════════════════════════════════════════
function renderAll() {
    const filtered = applyFilters();
    renderKPIs();
    renderPendingPanel();
    renderTable(filtered);
}

function applyFilters() {
    const q        = document.getElementById('cn-search-input').value.trim().toLocaleLowerCase('tr-TR');
    const custId   = document.getElementById('filter-cn-customer').value;
    const status   = document.getElementById('filter-cn-status').value;
    const decision = document.getElementById('filter-cn-decision').value;
    const year     = document.getElementById('filter-cn-year').value;

    return globalCreditNotes.filter(n => {
        if (custId && n.customer_id !== custId) return false;
        if (status && n.process_status !== status) return false;
        if (year   && !(n.cn_date || '').startsWith(year)) return false;
        if (decision && !(n.credit_note_items || []).some(i => i.decision === decision)) return false;
        if (!q) return true;

        const haystack = [
            n.customers?.company_name, n.customers?.country,
            n.cn_no, n.target_order_text, n.notes,
            ...(n.credit_note_items || []).flatMap(i =>
                [i.product_name, i.product_code, i.product_serial, i.customer_ref, i.description]),
        ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');

        return haystack.includes(q);
    });
}

// Bekleyen = kararı verilmiş ama siparişe işlenmemiş (asıl takip edilmesi gerekenler).
function isPendingNote(n) {
    return n.process_status === 'İncelemede' || n.process_status === 'Belge Gönderildi';
}

function renderKPIs() {
    const pending = globalCreditNotes.filter(isPendingNote);

    document.getElementById('kpi-pending-count').textContent = pending.length.toLocaleString('tr-TR');
    const sent = pending.filter(n => n.process_status === 'Belge Gönderildi').length;
    document.getElementById('kpi-pending-sub').textContent =
        `${sent} belge gönderildi · ${pending.length - sent} incelemede`;

    // Para birimleri asla toplanmaz — her biri ayrı gösterilir.
    const byCurrency = {};
    pending.forEach(n => {
        const cur = n.currency || 'EUR';
        byCurrency[cur] = (byCurrency[cur] || 0) + effectiveTotal(n);
    });
    const entries = Object.entries(byCurrency).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
    document.getElementById('kpi-pending-amount').innerHTML =
        entries.length ? formatMoney(entries[0][1], entries[0][0]) : '—';
    document.getElementById('kpi-pending-amount-sub').textContent =
        entries.length > 1
            ? entries.slice(1).map(([c, v]) => formatMoney(v, c)).join(' · ')
            : (entries.length ? 'mahsup edilmeyi bekliyor' : 'bekleyen mahsup yok');

    const freeQty = pending.reduce((s, n) => s + calcFreeGoodsQty(n.credit_note_items), 0);
    document.getElementById('kpi-free-goods').textContent = freeQty.toLocaleString('tr-TR');

    document.getElementById('kpi-total-cn').textContent = globalCreditNotes.length.toLocaleString('tr-TR');
    const itemCount = globalCreditNotes.reduce((s, n) => s + (n.credit_note_items?.length || 0), 0);
    document.getElementById('kpi-total-cn-sub').textContent = `${itemCount.toLocaleString('tr-TR')} ürün kalemi`;
}

// Siparişe işlenmeyi bekleyen CN'ler — sipariş bazında gruplanır.
function renderPendingPanel() {
    const panel = document.getElementById('pending-panel');
    const list  = document.getElementById('pending-list');
    const pending = globalCreditNotes.filter(isPendingNote);

    if (pending.length === 0) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');

    const groups = new Map();
    pending.forEach(n => {
        const key = orderLabel(n) || '(sipariş atanmadı)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
    });

    const sorted = [...groups.entries()].sort((a, b) => {
        if (a[0] === '(sipariş atanmadı)') return 1;
        if (b[0] === '(sipariş atanmadı)') return -1;
        return a[0].localeCompare(b[0], 'tr');
    });

    list.innerHTML = sorted.map(([order, notes]) => {
        const byCurrency = {};
        notes.forEach(n => {
            const cur = n.currency || 'EUR';
            byCurrency[cur] = (byCurrency[cur] || 0) + effectiveTotal(n);
        });
        const money = Object.entries(byCurrency)
            .filter(([, v]) => v > 0.005)
            .map(([c, v]) => formatMoney(v, c)).join(' · ');
        const freeQty = notes.reduce((s, n) => s + calcFreeGoodsQty(n.credit_note_items), 0);
        const customers = [...new Set(notes.map(n => n.customers?.company_name).filter(Boolean))];

        const parts = [];
        if (money)   parts.push(`<strong style="color:var(--warn);">${money}</strong> mahsup`);
        if (freeQty) parts.push(`<strong style="color:var(--warn);">${freeQty}</strong> adet bedelsiz`);
        if (!parts.length) parts.push('<span style="color:var(--ink-3);">tutar girilmemiş</span>');

        return `
        <div class="cn-alert-row">
            <div style="min-width:0;">
                <div style="font-weight:700;color:var(--ink-1);">
                    <i class="fa-solid fa-boxes-packing" style="margin-right:6px;color:var(--warn);"></i>${escapeHtml(order)}
                </div>
                <div style="color:var(--ink-2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${escapeHtml(customers.join(', '))} — ${notes.length} Credit Note
                </div>
            </div>
            <div style="text-align:right;white-space:nowrap;">
                <div>${parts.join(' · ')}</div>
                <button class="btn-soft pending-jump" data-order="${escapeHtml(order)}"
                        style="padding:3px 9px;font-size:11px;margin-top:4px;">
                    <i class="fa-solid fa-arrow-down"></i> Listede göster
                </button>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.pending-jump').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('cn-search-input').value =
                btn.dataset.order === '(sipariş atanmadı)' ? '' : btn.dataset.order;
            document.getElementById('filter-cn-status').value = 'Belge Gönderildi';
            renderAll();
        });
    });
}

function orderLabel(n) {
    if (n.target_order_id) {
        const o = globalOrders.find(x => x.id === n.target_order_id);
        if (o) return o.order_number || '(no yok)';
    }
    return (n.target_order_text || '').trim();
}

function renderTable(notes) {
    const tbody = document.getElementById('cn-table-body');

    if (notes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--ink-3);padding:32px;">
            Kayıt bulunamadı.</td></tr>`;
        document.getElementById('cn-result-count').textContent = '0 kayıt';
        return;
    }

    tbody.innerHTML = notes.map(n => {
        const items = n.credit_note_items || [];
        const itemSummary = summarizeItems(items);
        const decisionChips = summarizeDecisions(items);
        const total = effectiveTotal(n);
        const freeQty = calcFreeGoodsQty(items);
        const stated = n.total_amount !== null && n.total_amount !== undefined;

        let amountCell = total > 0.005 ? formatMoney(total, n.currency) : '—';
        if (stated && Math.abs(Number(n.total_amount) - calcTotal(items)) > 0.05) {
            amountCell += `<i class="fa-solid fa-circle-info" style="margin-left:4px;color:var(--ink-3);"
                title="Belgede yazan tutar (${formatMoney(n.total_amount, n.currency)}) kalem toplamından (${formatMoney(calcTotal(items), n.currency)}) farklı."></i>`;
        }
        if (freeQty) {
            amountCell += `<div class="cn-kpi-sub">+${freeQty} ad. bedelsiz</div>`;
        }

        const st = PROCESS_STATUSES.find(s => s.value === n.process_status);
        const order = orderLabel(n);

        return `
        <tr data-id="${n.id}" style="cursor:pointer;">
            <td style="font-weight:700;color:var(--ink-1);">${n.cn_no ?? '—'}</td>
            <td style="white-space:nowrap;">${formatDate(n.cn_date)}</td>
            <td>
                <div style="font-weight:600;color:var(--ink-1);">${escapeHtml(n.customers?.company_name || 'Bilinmeyen')}</div>
                <div class="cn-kpi-sub">${escapeHtml(n.customers?.country || '')}</div>
            </td>
            <td style="max-width:280px;">
                <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(itemSummary.full)}">
                    ${escapeHtml(itemSummary.short)}
                </div>
                <div class="cn-kpi-sub">${items.length} kalem</div>
            </td>
            <td>${decisionChips}</td>
            <td class="cn-num" style="font-weight:600;color:var(--ink-1);">${amountCell}</td>
            <td>${order ? `<span class="badge badge-muted">${escapeHtml(order)}</span>` : '<span class="muted">—</span>'}</td>
            <td><span class="badge badge-${st ? st.tone : 'muted'}">${escapeHtml(n.process_status || '—')}</span></td>
            <td style="text-align:center;">
                <button class="btn-soft btn-open-cn" data-id="${n.id}" style="padding:5px 9px;">
                    <i class="fa-solid fa-folder-open" style="color:var(--bronze);"></i>
                </button>
            </td>
        </tr>`;
    }).join('');

    // Klasör simgesi -> düzenleme; satırın herhangi bir yeri -> salt okunur detay.
    tbody.querySelectorAll('.btn-open-cn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); openModalForEdit(btn.dataset.id); });
    });
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.addEventListener('click', () => openDetail(tr.dataset.id));
    });

    document.getElementById('cn-result-count').textContent =
        `${notes.length} kayıt gösteriliyor (toplam ${globalCreditNotes.length})`;
}

function summarizeItems(items) {
    const names = [...new Set(items.map(i => i.product_name || i.product_code).filter(Boolean))];
    return {
        short: names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : ''),
        full:  names.join(', '),
    };
}

function summarizeDecisions(items) {
    const counts = new Map();
    items.forEach(i => {
        const key = i.decision || '(karar yok)';
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    const chips = [...counts.entries()].map(([value, count]) => {
        const d = getDecision(value);
        const tone = d ? d.tone : 'muted';
        const label = d ? d.tr : 'Karar yok';
        return `<span class="badge badge-${tone}" title="${escapeHtml(label)}">${count}× ${escapeHtml(shortDecision(label))}</span>`;
    }).join('');
    // Rozetler flex + gap ile ayrılır; yan yana yazınca birbirine değiyorlardı.
    return `<div class="badge-stack">${chips}</div>`;
}

function shortDecision(tr) {
    return tr
        .replace('Onaylandı - Kırık', 'Onay/Kırık')
        .replace('Reddedildi - Kırık', 'Red/Kırık')
        .replace('Reddedildi - Tolerans', 'Red/Tol.')
        .replace('%50 İskonto - Tolerans', '%50 Tol.')
        .replace('Resim Bekleniliyor', 'Resim bekl.');
}

// ═════════════════════════════════════════════════════════════════════════════
// CN DETAY PENCERESİ (SALT OKUNUR)
// ═════════════════════════════════════════════════════════════════════════════
// Listede satıra tıklanınca kalemler açılır pencerede gösterilir; düzenleme
// modalı yalnızca klasör simgesinden açılır (Siparişler'deki not penceresi gibi).
let detailCnId = null;

function openDetail(id) {
    const n = globalCreditNotes.find(x => x.id === id);
    if (!n) return;
    detailCnId = id;

    const st = PROCESS_STATUSES.find(s => s.value === n.process_status);
    const order = orderLabel(n);
    const items = n.credit_note_items || [];
    const total = effectiveTotal(n);
    const freeQty = calcFreeGoodsQty(items);

    document.getElementById('cn-detail-title').innerHTML = `
        <div style="font-size:16px;font-weight:600;color:var(--ink-1);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <i class="fa-solid fa-file-invoice-dollar" style="color:var(--danger);"></i>
            Credit Note ${n.cn_no ?? '(numarasız)'}
            <span style="color:var(--ink-2);font-weight:500;">— ${escapeHtml(n.customers?.company_name || '')}</span>
            <span class="badge badge-${st ? st.tone : 'muted'}">${escapeHtml(n.process_status || '')}</span>
        </div>
        <div class="muted mt-1">
            ${formatDate(n.cn_date)} · ${escapeHtml(n.customers?.country || '')}
            ${order ? ' · Sipariş: <strong>' + escapeHtml(order) + '</strong>' : ''}
        </div>`;

    document.getElementById('cn-detail-meta').innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="cn-card" style="background:var(--surface-2);padding:12px;">
                <div class="cn-kpi-label">Mahsup Tutarı</div>
                <div style="font-size:18px;font-weight:600;color:var(--ink-1);">${total > 0.005 ? escapeHtml(formatMoney(total, n.currency)) : '—'}</div>
            </div>
            <div class="cn-card" style="background:var(--surface-2);padding:12px;">
                <div class="cn-kpi-label">Bedelsiz Ürün</div>
                <div style="font-size:18px;font-weight:600;color:var(--ink-1);">${freeQty || '—'}${freeQty ? ' ad.' : ''}</div>
            </div>
            <div class="cn-card" style="background:var(--surface-2);padding:12px;">
                <div class="cn-kpi-label">Kalem</div>
                <div style="font-size:18px;font-weight:600;color:var(--ink-1);">${items.length}</div>
            </div>
            <div class="cn-card" style="background:var(--surface-2);padding:12px;">
                <div class="cn-kpi-label">Para Birimi</div>
                <div style="font-size:18px;font-weight:600;color:var(--ink-1);">${escapeHtml(n.currency || '—')}</div>
            </div>
        </div>`;

    document.getElementById('cn-detail-body').innerHTML = items.map((i, idx) => {
        const ids = [i.product_serial, i.customer_ref].filter(Boolean);
        const amt = lineAmount(i);
        const known = !!findProductByCode(i.product_code);
        return `
        <tr>
            <td style="color:var(--ink-3);">${idx + 1}</td>
            <td>
                <div style="color:var(--ink-1);font-weight:600;">${escapeHtml(i.product_name || '—')}</div>
                <div class="mono" style="color:var(--ink-3);">${escapeHtml(i.product_code || '')}
                    ${i.product_code && !known ? '<span class="badge badge-warn" style="margin-left:4px;">katalogda yok</span>' : ''}</div>
                ${i.description ? `<div class="muted" style="margin-top:2px;">${escapeHtml(i.description)}</div>` : ''}
            </td>
            <td class="mono">${ids.length ? ids.map(escapeHtml).join('<br>') : '<span class="muted">—</span>'}</td>
            <td>${decisionChip(i.decision)}</td>
            <td>${escapeHtml(i.defect_category ? defectLabel(i.defect_category) : '—')}</td>
            <td class="cn-num">${Number(i.quantity) || 1}</td>
            <td class="cn-num">${i.unit_price === null || i.unit_price === undefined ? '—' : escapeHtml(formatMoney(i.unit_price, n.currency))}</td>
            <td class="cn-num" style="font-weight:600;color:var(--ink-1);">
                ${i.compensation_type === 'Bedelsiz'
                    ? (isCredited(i.decision) ? `${Number(i.quantity) || 1} ad. bedelsiz` : '—')
                    : (amt > 0.005 ? escapeHtml(formatMoney(amt, n.currency)) : '—')}
                ${i.target_order_text_override ? `<div class="muted">sipariş: ${escapeHtml(i.target_order_text_override)}</div>` : ''}
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--ink-3);padding:20px;">Kalem yok</td></tr>`;

    document.getElementById('cn-detail-notes').innerHTML = n.notes
        ? `<div class="cn-card" style="background:var(--surface-2);">
               <div class="cn-kpi-label mb-1">Notlar</div>
               <div style="font-size:12px;color:var(--ink-2);white-space:pre-wrap;">${escapeHtml(n.notes)}</div>
           </div>`
        : '';

    document.getElementById('cn-detail-modal').classList.remove('hidden');
}

function decisionChip(value) {
    const d = getDecision(value);
    return `<span class="badge badge-${d ? d.tone : 'muted'}">${escapeHtml(d ? d.tr : 'Karar yok')}</span>`;
}

function closeDetail() {
    document.getElementById('cn-detail-modal').classList.add('hidden');
    detailCnId = null;
}

// ═════════════════════════════════════════════════════════════════════════════
// MODAL — KALEM SATIRLARI
// ═════════════════════════════════════════════════════════════════════════════
function ensureProductDatalist() {
    if (document.getElementById('urun-code-list')) return;
    // Katalog binlerce satır olabildiği için <select> yerine datalist kullanılıyor
    // (tarayıcı yalnızca yazılan öneki eşleştirir, DOM'a bir kez basılır).
    const dl = document.createElement('datalist');
    dl.id = 'urun-code-list';
    dl.innerHTML = globalProducts
        .map(p => `<option value="${escapeHtml(p.stok_kodu || '')}">${escapeHtml(p.stok_adi_1 || '')}</option>`)
        .join('');
    document.body.appendChild(dl);
}

function findProductByCode(code) {
    const key = (code || '').trim().toLocaleUpperCase('tr-TR');
    if (!key) return null;
    return globalProducts.find(p => (p.stok_kodu || '').trim().toLocaleUpperCase('tr-TR') === key) || null;
}

function addItemRow(data = {}) {
    ensureProductDatalist();
    const container = document.getElementById('cn-items-container');

    const row = document.createElement('div');
    row.className = 'cn-item-row';

    const decisionOpts = ['<option value="">-- Karar --</option>']
        .concat(DECISIONS.map(d =>
            `<option value="${d.value}" title="${escapeHtml(d.hint)}" ${data.decision === d.value ? 'selected' : ''}>${d.tr}</option>`))
        .join('');

    const defectOpts = ['<option value="">-- Hata Kategorisi --</option>']
        .concat(DEFECTS.map(d =>
            `<option value="${d.id}" title="${escapeHtml(d.definition)}" ${data.defect_category === d.id ? 'selected' : ''}>${d.name}</option>`))
        .join('');

    const compOpts = COMPENSATION_TYPES.map(c =>
        `<option value="${c.value}" ${(data.compensation_type || 'Mahsup') === c.value ? 'selected' : ''}>${c.label}</option>`).join('');

    row.innerHTML = `
        <span class="cn-item-no"></span>
        <button type="button" class="btn-remove-row" title="Satırı çıkar"
            style="position:absolute;top:8px;right:8px;border:none;background:transparent;color:var(--ink-3);cursor:pointer;">
            <i class="fa-solid fa-trash-can" style="font-size:12px;"></i>
        </button>

        <div class="grid grid-cols-2 md:grid-cols-12 gap-2" style="padding-right:24px;">
            <div class="md:col-span-3">
                <label class="field-label">Ürün Kodu</label>
                <input type="text" class="item-product-code" list="urun-code-list"
                       placeholder="K2801-0755-001-1-0000" value="${escapeAttr(data.product_code)}">
                <input type="hidden" class="item-product-id" value="${escapeAttr(data.product_id)}">
                <span class="code-note hidden"></span>
            </div>
            <div class="md:col-span-4">
                <label class="field-label">Ürün Adı *</label>
                <input type="text" class="item-product-name" required
                       placeholder="Vega Furniture Washbasin (50x75)" value="${escapeAttr(data.product_name)}">
            </div>
            <div class="md:col-span-2">
                <label class="field-label">Ürün ID (barkod)</label>
                <input type="text" class="item-serial" placeholder="3109358632" value="${escapeAttr(data.product_serial)}">
                <span class="dup-note hidden"></span>
            </div>
            <div class="md:col-span-3">
                <label class="field-label">Müşteri Referansı</label>
                <input type="text" class="item-customer-ref" placeholder="IDVT17082026116 / Claim 41"
                       value="${escapeAttr(data.customer_ref)}">
                <span class="dup-note ref hidden"></span>
            </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-12 gap-2 mt-2" style="padding-top:8px;border-top:1px solid var(--border);">
            <div class="md:col-span-3">
                <label class="field-label">Karar</label>
                <select class="item-decision">${decisionOpts}</select>
            </div>
            <div class="md:col-span-2">
                <label class="field-label">Hata Kategorisi</label>
                <select class="item-defect">${defectOpts}</select>
            </div>
            <div class="md:col-span-2">
                <label class="field-label">Telafi</label>
                <select class="item-compensation">${compOpts}</select>
            </div>
            <div class="md:col-span-1">
                <label class="field-label">Adet</label>
                <input type="number" step="0.01" min="0" class="item-qty" value="${data.quantity ?? 1}">
            </div>
            <div class="md:col-span-2">
                <label class="field-label">Birim Fiyat</label>
                <div style="display:flex;gap:4px;">
                    <input type="number" step="0.01" min="0" class="item-price" value="${data.unit_price ?? ''}">
                    <button type="button" class="btn-half hidden" title="Fiyatı yarıya indir (%50 tolerans)">½</button>
                </div>
            </div>
            <div class="md:col-span-2">
                <label class="field-label">Farklı Sipariş</label>
                <input type="text" class="item-order-override" placeholder="boşsa CN siparişi"
                       value="${escapeAttr(data.target_order_text_override)}">
            </div>
        </div>

        <div class="mt-2">
            <label class="field-label">Açıklama</label>
            <input type="text" class="item-description" placeholder="Serbest not..."
                   value="${escapeAttr(data.description)}">
        </div>

        <div class="mt-2 flex items-center justify-between" style="font-size:11px;color:var(--ink-3);">
            <span class="item-decision-hint"></span>
            <span class="item-line-total" style="font-weight:700;color:var(--ink-1);"></span>
        </div>
    `;

    container.appendChild(row);
    wireItemRow(row);
    renumberItemRows();
    return row;
}

// Kalem satırlarının sıra numarasını yeniden yazar (ekleme/çıkarma sonrası).
function renumberItemRows() {
    document.querySelectorAll('#cn-items-container .cn-item-row').forEach((row, idx) => {
        row.querySelector('.cn-item-no').textContent = idx + 1;
    });
}

// Ürün kodu katalogda (urunler) yoksa uyarı gösterir. Kayıt ENGELLENMEZ:
// takip tablosunda kart açılmamış ürünler var (ör. 50-06-11-001) ve bunlar
// serbest metin olarak saklanır — product_id boş kalır, ürün adı yine tutulur.
function syncRowProductCode(row) {
    const input = row.querySelector('.item-product-code');
    const note  = row.querySelector('.code-note');
    const code  = input.value.trim();
    const prod  = findProductByCode(code);

    row.querySelector('.item-product-id').value = prod ? prod.id : '';
    input.classList.toggle('code-unknown', !!code && !prod);
    note.classList.toggle('hidden', !code || !!prod);
    if (code && !prod) {
        note.innerHTML = '<i class="fa-solid fa-circle-info"></i> Ürün kartlarında yok — serbest metin olarak kaydedilecek';
    }
    return prod;
}

function wireItemRow(row) {
    const $ = sel => row.querySelector(sel);

    // Ürün kodu -> katalogdan ad/ID doldur (yoksa uyarı göster)
    $('.item-product-code').addEventListener('change', () => {
        const prod = syncRowProductCode(row);
        if (prod && !$('.item-product-name').value.trim()) {
            $('.item-product-name').value = prod.stok_adi_1 || '';
        }
    });

    $('.btn-remove-row').addEventListener('click', async () => {
        const container = document.getElementById('cn-items-container');
        if (container.querySelectorAll('.cn-item-row').length > 1) {
            row.remove();
            renumberItemRows();
            refreshTotals();
        } else {
            await showAlertDialog('Bir Credit Note en az bir ürün kalemi içermelidir.', { variant: 'warn' });
        }
    });

    $('.btn-half').addEventListener('click', () => {
        const input = $('.item-price');
        const v = parseAmount(input.value);
        if (v !== null) { input.value = (v / 2).toFixed(2); refreshTotals(); }
    });

    $('.item-decision').addEventListener('change', () => { syncRowDecision(row); refreshTotals(); });
    $('.item-compensation').addEventListener('change', () => { syncRowCompensation(row); refreshTotals(); });
    ['.item-qty', '.item-price'].forEach(s => $(s).addEventListener('input', refreshTotals));
    $('.item-serial').addEventListener('input', () => checkRowDuplicates(row));
    $('.item-customer-ref').addEventListener('input', () => checkRowDuplicates(row));

    syncRowDecision(row);
    syncRowCompensation(row);
    syncRowProductCode(row);
    checkRowDuplicates(row);
}

function syncRowDecision(row) {
    const value = row.querySelector('.item-decision').value;
    const d = getDecision(value);
    row.querySelector('.item-decision-hint').textContent = d ? d.hint : '';
    row.querySelector('.btn-half').classList.toggle('hidden', !isHalfPriceDecision(value));
}

// Bedelsiz kalemlerde birim fiyat anlamsızdır (para değil mal olarak telafi edilir).
function syncRowCompensation(row) {
    const isFree = row.querySelector('.item-compensation').value === 'Bedelsiz';
    const price = row.querySelector('.item-price');
    price.disabled = isFree;
    price.style.opacity = isFree ? '0.45' : '1';
    if (isFree) price.value = '';
}

// "Aynı ürünü daha sonradan yeniden işleme almamak" kontrolü.
// Uyarır ama engellemez — meşru tekrarlar (yeniden değerlendirme) olabiliyor.
function checkRowDuplicates(row) {
    const customerId = document.getElementById('cn-customer-select').value;
    const currentCnId = document.getElementById('cn-id').value;

    const check = (noteSel, key) => {
        const note = row.querySelector(noteSel);
        const hits = (usageIndex.get(key) || []).filter(h => h.cnId !== currentCnId);
        if (!key || hits.length === 0) {
            note.classList.add('hidden');
            note.textContent = '';
            return false;
        }
        const where = hits.slice(0, 2)
            .map(h => `CN ${h.cnNo ?? '?'} · ${formatDate(h.cnDate)} · ${h.customer}`)
            .join(' | ');
        note.classList.remove('hidden');
        note.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Daha önce işlendi: ${escapeHtml(where)}` +
            (hits.length > 2 ? ` (+${hits.length - 2})` : '');
        return true;
    };

    const serial = row.querySelector('.item-serial').value.trim();
    const ref    = row.querySelector('.item-customer-ref').value.trim();

    const dupSerial = check('.dup-note:not(.ref)', serialKey(serial));
    const dupRef    = customerId ? check('.dup-note.ref', customerRefKey(customerId, ref)) : false;

    row.classList.toggle('is-dup', dupSerial || dupRef);
    return dupSerial || dupRef;
}

function collectItemsFromForm() {
    return Array.from(document.querySelectorAll('.cn-item-row')).map((row, idx) => {
        const $ = s => row.querySelector(s);
        const comp = $('.item-compensation').value || 'Mahsup';
        return {
            line_no:          idx + 1,
            product_id:       $('.item-product-id').value || null,
            product_code:     $('.item-product-code').value.trim() || null,
            product_name:     $('.item-product-name').value.trim() || null,
            product_serial:   $('.item-serial').value.trim() || null,
            customer_ref:     $('.item-customer-ref').value.trim() || null,
            decision:         $('.item-decision').value || null,
            defect_category:  $('.item-defect').value || null,
            compensation_type: comp,
            quantity:         parseAmount($('.item-qty').value) ?? 1,
            unit_price:       comp === 'Bedelsiz' ? null : parseAmount($('.item-price').value),
            target_order_text_override: $('.item-order-override').value.trim() || null,
            description:      $('.item-description').value.trim() || null,
        };
    });
}

function refreshTotals() {
    const items = collectItemsFromForm();
    const currency = document.getElementById('cn_currency').value;
    const total = calcTotal(items);
    const freeQty = calcFreeGoodsQty(items);

    document.getElementById('cn-calc-total').textContent = formatMoney(total, currency);
    document.getElementById('cn-free-goods-sub').textContent =
        freeQty ? `+ ${freeQty} adet bedelsiz ürün` : 'bedelsiz ürün yok';

    // Satır bazlı tutarlar
    document.querySelectorAll('.cn-item-row').forEach((row, idx) => {
        const item = items[idx];
        const el = row.querySelector('.item-line-total');
        if (item.compensation_type === 'Bedelsiz') {
            el.textContent = isCredited(item.decision) ? `${item.quantity} ad. bedelsiz` : '—';
        } else {
            const amt = lineAmount(item);
            el.textContent = amt > 0 ? formatMoney(amt, currency)
                : (item.decision && !isCredited(item.decision) ? 'alacak yazılmaz' : '—');
        }
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// MODAL — AÇ / KAPAT
// ═════════════════════════════════════════════════════════════════════════════
function nextCnNo() {
    const nums = globalCreditNotes.map(n => Number(n.cn_no)).filter(n => isFinite(n) && n > 0);
    return nums.length ? Math.max(...nums) + 1 : 1;
}

function openModalForCreate() {
    document.getElementById('cn-form').reset();
    document.getElementById('cn-id').value = '';
    document.getElementById('cn-customer-search').value = '';
    document.getElementById('cn-customer-select').value = '';
    document.getElementById('cn_no').value = nextCnNo();
    document.getElementById('cn_date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cn_currency').value = 'EUR';
    document.getElementById('cn_process_status').value = 'İncelemede';
    document.getElementById('cn_total_amount').value = '';
    document.getElementById('cn_notes').value = '';
    document.getElementById('cn_target_order_text').value = '';

    refreshOrderOptions();
    document.getElementById('cn-items-container').innerHTML = '';
    addItemRow();
    refreshTotals();

    document.getElementById('cn-modal-title').innerHTML =
        `<i class="fa-solid fa-file-circle-plus" style="color:var(--danger);"></i> Yeni Credit Note`;
    document.getElementById('btn-delete-cn').classList.add('hidden');
    document.getElementById('cn-modal').classList.remove('hidden');
}

function openModalForEdit(id) {
    const note = globalCreditNotes.find(n => n.id === id);
    if (!note) return;

    document.getElementById('cn-id').value = note.id;
    document.getElementById('cn_no').value = note.cn_no ?? '';
    document.getElementById('cn_date').value = note.cn_date || '';
    selectCustomer(note.customer_id);           // para birimini EZMEZ, kayıttaki kalır
    document.getElementById('cn_currency').value = note.currency || 'EUR';
    document.getElementById('cn_process_status').value = note.process_status || 'İncelemede';
    document.getElementById('cn_total_amount').value = note.total_amount ?? '';
    document.getElementById('cn_notes').value = note.notes || '';
    document.getElementById('cn_target_order_text').value = note.target_order_text || '';

    refreshOrderOptions();
    document.getElementById('cn_target_order').value = note.target_order_id || '';

    const container = document.getElementById('cn-items-container');
    container.innerHTML = '';
    if (note.credit_note_items?.length) note.credit_note_items.forEach(addItemRow);
    else addItemRow();
    refreshTotals();

    document.getElementById('cn-modal-title').innerHTML =
        `<i class="fa-solid fa-folder-open" style="color:var(--bronze);"></i> Credit Note ${note.cn_no ?? ''} — ${escapeHtml(note.customers?.company_name || '')}`;
    document.getElementById('btn-delete-cn').classList.remove('hidden');
    document.getElementById('cn-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('cn-modal').classList.add('hidden');
}

// Sipariş listesi seçili müşteriye göre daraltılır (yanlış siparişe bağlamayı önler).
function refreshOrderOptions() {
    const customerId = document.getElementById('cn-customer-select').value;
    const sel = document.getElementById('cn_target_order');
    const current = sel.value;

    const list = customerId
        ? globalOrders.filter(o => o.customer_id === customerId)
        : globalOrders;

    sel.innerHTML = '<option value="">-- Sipariş Seçiniz --</option>' +
        list.map(o => `<option value="${o.id}">${escapeHtml(o.order_number || '(no yok)')} — ${formatDate(o.order_date)}</option>`).join('');

    if (list.some(o => o.id === current)) sel.value = current;
}

// ═════════════════════════════════════════════════════════════════════════════
// KAYDET / SİL
// ═════════════════════════════════════════════════════════════════════════════
async function handleSubmit(e) {
    e.preventDefault();
    if (!canEdit(ctx, 'credit-notes')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }

    const id = document.getElementById('cn-id').value;
    const items = collectItemsFromForm().filter(i => i.product_name || i.product_code);

    if (items.length === 0) {
        await showAlertDialog('En az bir ürün kalemi girmelisiniz.', { variant: 'warn' });
        return;
    }
    const missingName = items.some(i => !i.product_name);
    if (missingName) {
        await showAlertDialog('Her kalemde ürün adı zorunludur.', { variant: 'warn' });
        return;
    }

    const dupRows = Array.from(document.querySelectorAll('.cn-item-row.is-dup')).length;
    if (dupRows > 0) {
        const ok = await showConfirmDialog(
            `${dupRows} kalemde daha önce işlenmiş Ürün ID / müşteri referansı var. Yine de kaydedilsin mi?`,
            { title: 'Tekrar Eden Ürün', variant: 'warn', confirmText: 'Yine de Kaydet' });
        if (!ok) return;
    }

    const cnNoRaw = document.getElementById('cn_no').value;
    const totalRaw = document.getElementById('cn_total_amount').value;

    const master = {
        cn_no:             cnNoRaw === '' ? null : parseInt(cnNoRaw, 10),
        customer_id:       document.getElementById('cn-customer-select').value,
        cn_date:           document.getElementById('cn_date').value,
        currency:          document.getElementById('cn_currency').value,
        process_status:    document.getElementById('cn_process_status').value,
        target_order_id:   document.getElementById('cn_target_order').value || null,
        target_order_text: document.getElementById('cn_target_order_text').value.trim() || null,
        total_amount:      totalRaw === '' ? null : parseAmount(totalRaw),
        notes:             document.getElementById('cn_notes').value.trim() || null,
    };

    try {
        const targetId = await saveCreditNote(id, master, items);
        logChange({
            ctx, moduleId: 'credit-notes', action: id ? 'update' : 'create',
            summary: `Credit Note ${master.cn_no ?? ''} ${id ? 'güncellendi' : 'oluşturuldu'} (${items.length} kalem)`,
        });
        closeModal();
        await fetchCreditNotes();
        void targetId;
    } catch (err) {
        console.error('Credit Note kaydedilemedi:', err);
        await showAlertDialog('Kayıt sırasında hata: ' + friendlyError(err), { variant: 'danger' });
    }
}

// Master + kalemler. Kalemler her kayıtta silinip yeniden yazılır (diff değil) —
// projedeki diğer master-detail modülleriyle (customer_prices, pallet_items) aynı desen.
async function saveCreditNote(id, master, items) {
    const userId = ctx.ownerId;
    let targetId = id;

    if (id) {
        const { error } = await supabase.from('credit_notes')
            .update(master).eq('id', id).eq('user_id', userId);
        if (error) throw error;

        const { error: delErr } = await supabase.from('credit_note_items')
            .delete().eq('credit_note_id', id);
        if (delErr) throw delErr;
    } else {
        const { data, error } = await supabase.from('credit_notes')
            .insert([{ ...master, user_id: userId }]).select().single();
        if (error) throw error;
        targetId = data.id;
    }

    const payload = items.map(i => ({ ...i, credit_note_id: targetId }));
    const { error: itemErr } = await supabase.from('credit_note_items').insert(payload);
    if (itemErr) throw itemErr;

    return targetId;
}

async function handleDelete() {
    if (!canEdit(ctx, 'credit-notes')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const id = document.getElementById('cn-id').value;
    if (!id) return;

    const ok = await showConfirmDialog(
        'Bu Credit Note ve altındaki tüm ürün kalemleri kalıcı olarak silinecek. Emin misiniz?',
        { title: 'Credit Note Sil', variant: 'danger', confirmText: 'Sil' });
    if (!ok) return;

    try {
        // Kalemler ÖNCE silinir. Migration dokümanı bu FK'yı ON DELETE CASCADE
        // diye tarif ediyordu ama veritabanındaki gerçek kısıt
        // (fk_credit_note_items_cn) cascade DEĞİL — kalemli bir CN'i doğrudan
        // silmek 23503 veriyor. 014 numaralı script cascade'i kuruyor; buradaki
        // açık silme her iki durumda da doğru çalışır.
        const { error: itemErr } = await supabase.from('credit_note_items')
            .delete().eq('credit_note_id', id);
        if (itemErr) throw itemErr;

        const { error } = await supabase.from('credit_notes')
            .delete().eq('id', id).eq('user_id', ctx.ownerId);
        if (error) throw error;

        logChange({ ctx, moduleId: 'credit-notes', action: 'delete', summary: `Credit Note silindi (${id})` });
        closeModal();
        await fetchCreditNotes();
    } catch (err) {
        console.error(err);
        await showAlertDialog('Silme başarısız: ' + friendlyError(err), { variant: 'danger' });
    }
}

function friendlyError(err) {
    const msg = err?.message || String(err);
    if (err?.code === '23505' && /cn_no/.test(msg)) {
        return 'Bu CN No zaten kullanılıyor. Farklı bir sıra numarası girin.';
    }
    return msg;
}

// ═════════════════════════════════════════════════════════════════════════════
// BELGEDEN İÇE AKTARMA (.docx / .pdf)
// ═════════════════════════════════════════════════════════════════════════════
let pendingDocImport = null;

async function handleDocFileSelected(file) {
    try {
        const parsed = await parseCreditNoteFile(file);
        pendingDocImport = parsed;
        showDocPreview(parsed);
    } catch (err) {
        console.error('Belge okunamadı:', err);
        await showAlertDialog(err.message || String(err), { title: 'Belge Okunamadı', variant: 'danger' });
    }
}

function showDocPreview(parsed) {
    const { meta, items, currency, warnings, sourceName } = parsed;
    const matchedCustomer = meta.buyer ? matchCustomer(meta.buyer) : null;
    const total = calcTotal(items);

    document.getElementById('doc-preview-summary').innerHTML = `
        <div class="cn-card" style="background:var(--surface-2);">
            <div class="grid grid-cols-2 gap-3" style="font-size:12.5px;">
                <div><span class="field-label">Dosya</span>${escapeHtml(sourceName)}</div>
                <div><span class="field-label">Belge Tarihi</span>${meta.cnDate ? formatDate(meta.cnDate) : '<span class="muted">okunamadı</span>'}</div>
                <div><span class="field-label">Müşteri</span>${escapeHtml(meta.buyer || '—')}
                     ${matchedCustomer
                        ? `<span class="badge badge-ok" style="margin-left:6px;">eşleşti: ${escapeHtml(matchedCustomer.company_name)}</span>`
                        : `<span class="badge badge-warn" style="margin-left:6px;">eşleşmedi — elle seçin</span>`}</div>
                <div><span class="field-label">Sipariş</span>${escapeHtml(meta.targetOrder || '—')}</div>
                <div><span class="field-label">Kalem Sayısı</span><strong>${items.length}</strong></div>
                <div><span class="field-label">Hesaplanan Toplam</span><strong>${formatMoney(total, currency || 'EUR')}</strong>
                     ${meta.totalAmount !== null && Math.abs(meta.totalAmount - total) > 0.05
                        ? `<span class="badge badge-warn" style="margin-left:6px;">belgede: ${formatMoney(meta.totalAmount, currency || 'EUR')}</span>`
                        : ''}</div>
            </div>
        </div>`;

    const log = document.getElementById('doc-preview-log');
    const lines = [];
    warnings.forEach(w => lines.push(`<div class="log-warn">⚠ ${escapeHtml(w)}</div>`));
    if (!matchedCustomer && meta.buyer) {
        lines.push(`<div class="log-warn">⚠ "${escapeHtml(meta.buyer)}" müşteri kartlarında bulunamadı — formda elle seçmelisiniz.</div>`);
    }
    items.forEach((i, idx) => {
        const dup = (usageIndex.get(serialKey(i.product_serial)) || []).length > 0;
        const cls = dup ? 'log-err' : 'log-info';
        lines.push(`<div class="${cls}">${idx + 1}. ${escapeHtml(i.product_code || '')} — ${escapeHtml(i.product_name || '')}
            ${i.product_serial ? `[ID ${escapeHtml(i.product_serial)}]` : ''}
            ${i.customer_ref ? `[${escapeHtml(i.customer_ref)}]` : ''}
            → ${escapeHtml(decisionLabel(i.decision))}
            ${i.unit_price !== null ? formatMoney(i.unit_price, currency || 'EUR') : (i.compensation_type === 'Bedelsiz' ? `${i.quantity} ad. bedelsiz` : '')}
            ${dup ? ' ← DAHA ÖNCE İŞLENDİ' : ''}</div>`);
    });
    log.innerHTML = lines.join('') || '<div class="log-warn">Okunacak kalem bulunamadı.</div>';

    document.getElementById('doc-preview-modal').classList.remove('hidden');
}

// Belgedeki/Excel'deki firma adını müşteri kartlarıyla eşleştirir.
// Asıl mantık creditNoteImport.js'te (saf ve test edilebilir); burada yalnızca
// yüklü müşteri listesi bağlanıyor.
function matchCustomer(rawName) {
    return matchCustomerIn(rawName, globalCustomers);
}

function applyDocImportToForm() {
    if (!pendingDocImport) return;
    const { meta, items, currency } = pendingDocImport;

    // Modal kapalıysa yeni kayıt olarak aç
    if (document.getElementById('cn-modal').classList.contains('hidden')) openModalForCreate();

    if (meta.cnDate) document.getElementById('cn_date').value = meta.cnDate;
    if (currency)    document.getElementById('cn_currency').value = currency;

    const matched = meta.buyer ? matchCustomer(meta.buyer) : null;
    // Belgedeki para birimi (yukarıda okundu) belgeden geldiği için müşteri
    // kartındakinden önceliklidir — bu yüzden applyCurrency verilmiyor.
    if (matched) selectCustomer(matched.id, { applyCurrency: !currency });

    if (meta.targetOrder) {
        document.getElementById('cn_target_order_text').value = meta.targetOrder;
        // Sipariş numarası sistemde varsa gerçek kayda da bağla.
        const bare = meta.targetOrder.replace(/\s*v\.?\s*\d+$/i, '').trim();
        const order = globalOrders.find(o =>
            (o.order_number || '').trim() === bare &&
            (!matched || o.customer_id === matched.id));
        if (order) document.getElementById('cn_target_order').value = order.id;
    }

    if (meta.totalAmount !== null && meta.totalAmount !== undefined) {
        document.getElementById('cn_total_amount').value = meta.totalAmount;
    }
    document.getElementById('cn_process_status').value = 'Belge Gönderildi';

    const container = document.getElementById('cn-items-container');
    container.innerHTML = '';
    items.forEach(i => {
        const prod = findProductByCode(i.product_code);
        addItemRow({
            ...i,
            product_id: prod ? prod.id : null,
            defect_category: matchDefect(i.defect_text),
        });
    });
    if (!items.length) addItemRow();
    refreshTotals();

    document.getElementById('doc-preview-modal').classList.add('hidden');
    pendingDocImport = null;
}

// ═════════════════════════════════════════════════════════════════════════════
// EXCEL'DEN TOPLU İÇE AKTARMA (CREDIT NOTE TAKIP.xlsx)
// ═════════════════════════════════════════════════════════════════════════════
let importFileData = null;

function logMsg(msg, type = 'info') {
    const log = document.getElementById('import-log');
    log.insertAdjacentHTML('beforeend', `<div class="log-${type}">${msg}</div>`);
    log.scrollTop = log.scrollHeight;
}

async function handleImportRun() {
    if (!importFileData) return;
    if (!canEdit(ctx, 'credit-notes')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }

    const runBtn = document.getElementById('btn-import-run');
    runBtn.disabled = true;
    document.getElementById('import-log').innerHTML = '';
    document.getElementById('import-log-wrap').classList.remove('hidden');

    try {
        // `cellDates` BİLEREK kullanılmıyor: tarihleri bir gün geri kaydırıyor.
        // Gerekçe ve doğru çevrim için creditNoteImport.js > excelDate().
        const wb = XLSX.read(importFileData, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

        const header = findExcelHeader(rows);
        if (!header) throw new Error('Başlık satırı bulunamadı (MÜŞTERİ / TARİH / ÜRÜN KODU sütunları aranıyor).');
        const { headerRow, map } = header;
        logMsg(`✓ Başlık satırı: ${headerRow + 1}. satır`, 'ok');

        // "AÇIKLAMA" iki sütuna yayılmış (K = adet/fiyat, L = serbest not).
        const amountCol = map.note;
        const noteCol   = map.note !== undefined ? map.note + 1 : undefined;

        const dataRows = rows.slice(headerRow + 1);
        const groups = groupExcelRows(dataRows, map);
        logMsg(`✓ ${dataRows.length} satır → ${groups.length} Credit Note grubu`, 'ok');

        const clearFirst = document.getElementById('import-clear-first').checked;
        if (clearFirst) {
            const ok = await showConfirmDialog(
                'Mevcut TÜM Credit Note kayıtları silinecek. Bu geri alınamaz. Devam edilsin mi?',
                { title: 'Mevcut Kayıtları Sil', variant: 'danger', confirmText: 'Sil ve Aktar' });
            if (!ok) { runBtn.disabled = false; return; }

            // Kalemler önce silinir — FK cascade değil (bkz. handleDeleteCN notu).
            const { data: existing, error: listErr } = await supabase
                .from('credit_notes').select('id').eq('user_id', ctx.ownerId);
            if (listErr) throw listErr;
            const existingIds = (existing || []).map(n => n.id);
            if (existingIds.length) {
                const { error: itemErr } = await supabase
                    .from('credit_note_items').delete().in('credit_note_id', existingIds);
                if (itemErr) throw itemErr;
            }
            const { error } = await supabase.from('credit_notes').delete().eq('user_id', ctx.ownerId);
            if (error) throw error;
            logMsg(`✓ Mevcut ${existingIds.length} kayıt silindi`, 'ok');
        }

        let created = 0, skipped = 0, itemCount = 0;
        const unmatchedCustomers = new Set();
        const nearMatches = new Map();   // Excel adı -> eşleştirilen müşteri adı
        const aliasMatches = new Map();
        const duplicateNos = [];         // Excel'de aynı No'yu paylaşan CN'ler
        const borrowedDates = [];        // tarihi komşusundan alınan CN'ler
        const currencyFromCustomer = new Set();   // EUR dışı para birimi kullanılanlar
        let lastDate = null;             // takip tablosu kronolojik: son geçerli tarih

        for (const g of groups) {
            const { customer, how } = matchCustomerDetailed(g.customer, globalCustomers);
            if (!customer) {
                unmatchedCustomers.add(g.customer);
                skipped++;
                continue;
            }
            // Yaklaşık/takma ad eşleşmeleri görünür olsun — yanlış müşteriye
            // yazılmışsa kullanıcı günlükten fark edip düzeltebilsin.
            if (how === 'near')  nearMatches.set(g.customer, customer.company_name);
            if (how === 'alias') aliasMatches.set(g.customer, customer.company_name);

            // Tarih hücresi boş ya da "YOK" yazıyor olabilir (CN 40 / ERGÜDEN).
            // cn_date NOT NULL olduğu için kaydı atlamak yerine, takip tablosu
            // kronolojik olduğundan bir önceki CN'in tarihi ödünç alınır ve durum
            // hem nota hem günlüğe yazılır — veri kaybetmektense işaretlemek yeğdir.
            let cnDate = g.date;
            let dateBorrowed = false;
            if (!cnDate) {
                if (!lastDate) {
                    logMsg(`⚠ CN ${g.no ?? '?'} (${escapeHtml(g.customer)}): tarih yok ve öncesinde tarihli kayıt yok — atlandı`, 'warn');
                    skipped++;
                    continue;
                }
                cnDate = lastDate;
                dateBorrowed = true;
                borrowedDates.push(`CN ${g.no ?? '?'} (${customer.company_name})`);
            } else {
                lastDate = cnDate;
            }

            const items = [];
            const noteLines = [];
            const orderCounts = new Map();
            let statedTotal = null;

            for (const row of g.rows) {
                const cellOf = f => map[f] === undefined ? '' : String(row[map[f]] ?? '').trim();
                const name = cellOf('product');
                const code = cellOf('code');

                const noteVal = noteCol !== undefined ? String(row[noteCol] ?? '').trim() : '';
                if (noteVal) {
                    const asNum = parseAmount(noteVal);
                    // Sadece salt sayı olan hücre belge toplamı adayıdır; "3 ad. Halley"
                    // gibi metinler nottur.
                    if (asNum !== null && /^[\d.,]+$/.test(noteVal) && statedTotal === null) statedTotal = asNum;
                    else if (!noteLines.includes(noteVal)) noteLines.push(noteVal);
                }

                if (!name && !code) continue;   // yalnızca not içeren satır

                const amountRaw = amountCol !== undefined ? String(row[amountCol] ?? '').trim() : '';
                let compensation_type = 'Mahsup', quantity = 1, unit_price = null;
                const qtyMatch = amountRaw.match(/(\d+(?:[.,]\d+)?)\s*(?:ad\.?|adet|pcs)\b/i);
                if (qtyMatch) {
                    compensation_type = 'Bedelsiz';
                    quantity = parseAmount(qtyMatch[1]) ?? 1;
                } else {
                    const p = parseAmount(amountRaw);
                    // "xx" / "XXX" gibi doldurulmamış hücreler sayıya çevrilmez.
                    if (p !== null && /\d/.test(amountRaw)) unit_price = p;
                }

                const { serial, customerRef } = parseProductIdCell(cellOf('serial'));
                const orderVal = cellOf('order');
                if (orderVal) orderCounts.set(orderVal, (orderCounts.get(orderVal) || 0) + 1);

                const prod = findProductByCode(code);
                items.push({
                    line_no: items.length + 1,
                    product_id: prod ? prod.id : null,
                    product_code: code || null,
                    product_name: name || code || null,
                    product_serial: serial,
                    customer_ref: customerRef,
                    decision: normalizeDecision(cellOf('decision')),
                    defect_category: null,
                    compensation_type,
                    quantity,
                    unit_price,
                    target_order_text_override: null,
                    description: null,
                    _order: orderVal || null,
                });
            }

            if (items.length === 0) { skipped++; continue; }

            // CN'nin ana siparişi = kalemlerde en sık geçen sipariş; farklı olanlar
            // kalem bazında "farklı sipariş" olarak işaretlenir.
            const mainOrder = [...orderCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
            items.forEach(i => {
                i.target_order_text_override = (i._order && i._order !== mainOrder) ? i._order : null;
                delete i._order;
            });

            const linkedOrder = mainOrder
                ? globalOrders.find(o => (o.order_number || '').trim() === mainOrder && o.customer_id === customer.id)
                : null;

            if (dateBorrowed) {
                noteLines.unshift(`⚠ Belge tarihi takip tablosunda boştu ("YOK"); bir önceki kaydın tarihi (${cnDate}) kullanıldı — doğru tarihi girin.`);
            }

            // Takip tablosunda döviz sütunu yok; müşteri kartındaki para birimi
            // esas alınır (kartta yoksa EUR). Hepsini EUR saymak Waterways (USD)
            // ve Ekvator (TRY) gibi kayıtlarda yanlış tutar üretiyordu.
            const cnCurrency = CURRENCIES.includes(customer.currency) ? customer.currency : 'EUR';
            if (cnCurrency !== 'EUR') currencyFromCustomer.add(`${customer.company_name} → ${cnCurrency}`);

            const master = {
                user_id:           ctx.ownerId,
                cn_no:             g.no,
                customer_id:       customer.id,
                cn_date:           cnDate,
                currency:          cnCurrency,
                process_status:    'Siparişe İşlendi',
                target_order_id:   linkedOrder ? linkedOrder.id : null,
                target_order_text: mainOrder,
                total_amount:      statedTotal,
                notes:             noteLines.length ? noteLines.join('\n') : null,
            };

            try {
                let inserted;
                const first = await supabase.from('credit_notes').insert([master]).select().single();

                if (first.error && first.error.code === '23505' && master.cn_no !== null) {
                    // Takip tablosunda aynı CN No iki FARKLI müşteride kullanılmış
                    // (ör. No 22 hem PAFFONI hem TEHNOMARKET'te, No 33 hem HERC hem
                    // TEHNOMARKET'te). Numara benzersiz olmak zorunda olduğundan kaydı
                    // atlamak yerine numarasız aktarılır ve kullanıcıya bildirilir.
                    const retryMaster = {
                        ...master,
                        cn_no: null,
                        notes: [`⚠ Takip tablosunda CN No ${master.cn_no} başka bir müşteride de kullanılmış; bu kayıt numarasız aktarıldı — yeni bir numara verin.`]
                            .concat(noteLines).join('\n'),
                    };
                    const retry = await supabase.from('credit_notes').insert([retryMaster]).select().single();
                    if (retry.error) throw retry.error;
                    inserted = retry.data;
                    duplicateNos.push(`No ${master.cn_no} → ${customer.company_name} (${cnDate})`);
                } else if (first.error) {
                    throw first.error;
                } else {
                    inserted = first.data;
                }

                const { error: itemErr } = await supabase.from('credit_note_items')
                    .insert(items.map(i => ({ ...i, credit_note_id: inserted.id })));
                if (itemErr) throw itemErr;

                created++;
                itemCount += items.length;
            } catch (err) {
                logMsg(`✗ CN ${g.no ?? '?'} (${escapeHtml(g.customer)}): ${escapeHtml(friendlyError(err))}`, 'err');
                skipped++;
            }
        }

        if (nearMatches.size) {
            logMsg(`⚠ ${nearMatches.size} firma YAKLAŞIK eşleştirildi (yazım farkı) — kontrol edin:`, 'warn');
            nearMatches.forEach((dbName, xlName) =>
                logMsg(`&nbsp;&nbsp;&nbsp;"${escapeHtml(xlName)}" → "${escapeHtml(dbName)}"`, 'warn'));
        }
        if (aliasMatches.size) {
            logMsg(`ℹ ${aliasMatches.size} firma takma addan eşleştirildi:`, 'info');
            aliasMatches.forEach((dbName, xlName) =>
                logMsg(`&nbsp;&nbsp;&nbsp;"${escapeHtml(xlName)}" → "${escapeHtml(dbName)}"`, 'info'));
        }
        if (duplicateNos.length) {
            logMsg(`⚠ ${duplicateNos.length} kayıtta CN No çakıştı (takip tablosunda aynı numara iki müşteride) — NUMARASIZ aktarıldı:`, 'warn');
            duplicateNos.forEach(d => logMsg(`&nbsp;&nbsp;&nbsp;${escapeHtml(d)}`, 'warn'));
        }
        if (borrowedDates.length) {
            logMsg(`⚠ ${borrowedDates.length} kayıtta belge tarihi boştu, komşu kayıttan alındı — düzeltin:`, 'warn');
            borrowedDates.forEach(d => logMsg(`&nbsp;&nbsp;&nbsp;${escapeHtml(d)}`, 'warn'));
        }
        if (unmatchedCustomers.size) {
            logMsg(`✗ Müşteri kartı bulunamayan ${unmatchedCustomers.size} firma ATLANDI — bu kayıtlar aktarılmadı:`, 'err');
            [...unmatchedCustomers].forEach(n => logMsg(`&nbsp;&nbsp;&nbsp;${escapeHtml(n)}`, 'err'));
            logMsg('ℹ Bu firmalar için Müşteri Kartları modülünde kayıt açıp aktarımı tekrarlayın.', 'info');
        }
        logMsg(`✓ Tamamlandı — ${created} Credit Note, ${itemCount} kalem aktarıldı, ${skipped} grup atlandı.`, 'ok');
        if (currencyFromCustomer.size) {
            logMsg(`ℹ Para birimi müşteri kartından alındı — EUR dışı olanlar:`, 'info');
            [...currencyFromCustomer].forEach(c => logMsg(`&nbsp;&nbsp;&nbsp;${escapeHtml(c)}`, 'info'));
        } else {
            logMsg('ℹ Para birimi müşteri kartından alındı (Excel\'de döviz sütunu yok); tümü EUR çıktı.', 'info');
        }
        logMsg('ℹ Süreç durumu "Siparişe İşlendi" olarak aktarıldı (geçmiş kayıtlar). Açık olanları elle güncelleyin.', 'info');

        logChange({
            ctx, moduleId: 'credit-notes', action: 'create',
            summary: `Excel'den ${created} Credit Note içe aktarıldı (${itemCount} kalem)`,
        });
        await fetchCreditNotes();
    } catch (err) {
        console.error(err);
        logMsg('✗ ' + escapeHtml(err.message || String(err)), 'err');
    } finally {
        runBtn.disabled = false;
    }
}

function openImportModal() {
    importFileData = null;
    document.getElementById('import-file-input').value = '';
    document.getElementById('import-log-wrap').classList.add('hidden');
    document.getElementById('import-log').innerHTML = '';
    document.getElementById('import-clear-first').checked = false;
    document.getElementById('btn-import-run').disabled = true;
    document.getElementById('import-drop-zone').innerHTML = `
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:26px;color:var(--ink-3);"></i>
        <p style="font-size:13px;color:var(--ink-1);margin-top:8px;font-weight:600;">Dosyayı buraya sürükleyin</p>
        <p class="muted">veya tıklayarak seçin (.xlsx, .xls)</p>
        <input type="file" id="import-file-input" accept=".xlsx,.xls" style="display:none;">`;
    wireImportDropZone();
    document.getElementById('import-modal').classList.remove('hidden');
}

function wireImportDropZone() {
    const zone = document.getElementById('import-drop-zone');
    const input = document.getElementById('import-file-input');

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) readImportFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) readImportFile(input.files[0]); });
}

function readImportFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
        importFileData = new Uint8Array(e.target.result);
        document.getElementById('import-drop-zone').innerHTML = `
            <i class="fa-solid fa-file-excel" style="font-size:26px;color:var(--ok);"></i>
            <p style="font-size:13px;color:var(--ink-1);margin-top:8px;font-weight:600;">${escapeHtml(file.name)}</p>
            <p class="muted">${(file.size / 1024).toFixed(0)} KB — aktarmaya hazır</p>`;
        document.getElementById('btn-import-run').disabled = false;
    };
    reader.readAsArrayBuffer(file);
}

// ═════════════════════════════════════════════════════════════════════════════
// EXCEL'E AKTARMA
// ═════════════════════════════════════════════════════════════════════════════
function exportToExcel() {
    if (globalCreditNotes.length === 0) {
        showAlertDialog('Dışa aktarılacak kayıt yok.', { variant: 'warn' });
        return;
    }
    const notes = applyFilters();
    const rows = [[
        'No', 'Ülke', 'Müşteri', 'Tarih', 'Ürün', 'Ürün Kodu', 'Ürün ID', 'Müşteri Ref',
        'Karar', 'Hata Kategorisi', 'Telafi', 'Adet', 'Birim Fiyat', 'Tutar', 'Döviz',
        'Sipariş', 'Süreç Durumu', 'Açıklama', 'CN Notu',
    ]];

    notes.forEach(n => {
        const order = orderLabel(n);
        (n.credit_note_items || []).forEach(i => {
            rows.push([
                n.cn_no ?? '', n.customers?.country || '', n.customers?.company_name || '', n.cn_date || '',
                i.product_name || '', i.product_code || '', i.product_serial || '', i.customer_ref || '',
                i.decision ? decisionLabel(i.decision) : '', i.defect_category ? defectLabel(i.defect_category) : '',
                i.compensation_type || '', Number(i.quantity) || 0,
                i.unit_price === null || i.unit_price === undefined ? '' : Number(i.unit_price),
                lineAmount(i) || '', n.currency || '',
                i.target_order_text_override || order, n.process_status || '',
                i.description || '', n.notes || '',
            ]);
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
        { wch: 6 }, { wch: 14 }, { wch: 22 }, { wch: 11 }, { wch: 34 }, { wch: 22 }, { wch: 14 },
        { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 7 }, { wch: 11 }, { wch: 11 },
        { wch: 7 }, { wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 28 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Credit Notes');
    XLSX.writeFile(wb, `Credit_Notes_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ═════════════════════════════════════════════════════════════════════════════
// OLAY DİNLEYİCİLERİ
// ═════════════════════════════════════════════════════════════════════════════
function initEventListeners() {
    document.getElementById('btn-open-cn-modal').addEventListener('click', openModalForCreate);
    document.getElementById('btn-close-cn-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cn-cancel').addEventListener('click', closeModal);
    document.getElementById('cn-form').addEventListener('submit', handleSubmit);
    document.getElementById('btn-delete-cn').addEventListener('click', handleDelete);
    document.getElementById('btn-add-item-row').addEventListener('click', () => { addItemRow(); refreshTotals(); });

    initCustomerDropdown();
    document.getElementById('cn_currency').addEventListener('change', refreshTotals);

    // CN detay penceresi
    ['btn-close-cn-detail', 'btn-cn-detail-close'].forEach(id =>
        document.getElementById(id).addEventListener('click', closeDetail));
    document.getElementById('cn-detail-modal').addEventListener('click', e => {
        if (e.target.id === 'cn-detail-modal') closeDetail();
    });
    document.getElementById('btn-cn-detail-edit').addEventListener('click', () => {
        const id = detailCnId;
        closeDetail();
        if (id) openModalForEdit(id);
    });

    // Filtreler
    document.getElementById('cn-search-input').addEventListener('input', renderAll);
    ['filter-cn-customer', 'filter-cn-status', 'filter-cn-decision', 'filter-cn-year']
        .forEach(id => document.getElementById(id).addEventListener('change', renderAll));

    // Bekleyenler paneli aç/kapa
    document.getElementById('btn-toggle-pending').addEventListener('click', e => {
        const list = document.getElementById('pending-list');
        const hidden = list.classList.toggle('hidden');
        e.currentTarget.innerHTML = hidden
            ? '<i class="fa-solid fa-chevron-down"></i> Göster'
            : '<i class="fa-solid fa-chevron-up"></i> Gizle';
    });

    // Belgeden içe aktarma
    const docInput = document.getElementById('doc-import-input');
    const triggerDoc = () => docInput.click();
    document.getElementById('btn-import-doc').addEventListener('click', triggerDoc);
    document.getElementById('btn-import-doc-inline').addEventListener('click', triggerDoc);
    docInput.addEventListener('change', () => {
        if (docInput.files[0]) handleDocFileSelected(docInput.files[0]);
        docInput.value = '';
    });
    document.getElementById('btn-doc-apply').addEventListener('click', applyDocImportToForm);
    ['btn-close-doc-preview', 'btn-doc-cancel'].forEach(id =>
        document.getElementById(id).addEventListener('click', () => {
            document.getElementById('doc-preview-modal').classList.add('hidden');
            pendingDocImport = null;
        }));

    // Excel toplu içe aktarma
    document.getElementById('btn-import-excel').addEventListener('click', openImportModal);
    document.getElementById('btn-import-run').addEventListener('click', handleImportRun);
    ['btn-close-import-modal', 'btn-import-cancel'].forEach(id =>
        document.getElementById(id).addEventListener('click', () =>
            document.getElementById('import-modal').classList.add('hidden')));
    wireImportDropZone();

    document.getElementById('btn-export-cn').addEventListener('click', exportToExcel);

    // Arka plana tıklayınca modalı kapat
    document.getElementById('cn-modal').addEventListener('click', e => {
        if (e.target.id === 'cn-modal') closeModal();
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// YARDIMCILAR
// ═════════════════════════════════════════════════════════════════════════════
function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return escapeHtml(str);
}
