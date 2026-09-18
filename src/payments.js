// payments.js — Ödeme Takibi
// Sistemdeki siparişlerin fatura bazlı alacakları, tahsilat defteri, yaşlandırma ve Eximbank.
// Kapsam (patron kararı, 17.09.2026): YALNIZCA sistemdeki siparişler. Sistemde olmayan eski
// alacaklar İnci Hanım'ın kendi kayıtlarında; burada tutulmaz (bkz. SQL 032).
// Veri modeli: supabase/sql/022 (tahsilat defteri), 023 (Eximbank/plan/çek), 027-029 (faturalar).
// Hesaplar: src/utils/receivables.js
import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { showAlertDialog, showConfirmDialog, showPromptDialog } from './utils/dialogs.js';
import { logChange } from './utils/auditLog.js';
import {
    todayIso, addDays, daysBetween, round2, buildReceivables, sumByCurrency, eximbankInfo, agingBucket,
    isCancelled, installmentStatus, AGING_BUCKETS, EXIMBANK_WARN_DAYS, termDays,
} from './utils/receivables.js';

const MODULE = 'payments';
const CURRENCIES = ['EUR', 'USD', 'TRY', 'GBP'];
const SYM = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
const WRITE_OFF_TYPES = ['Banka Kesintisi', 'Küsurat', 'Kur Farkı', 'CN Mahsubu', 'Diğer'];

let ctx = null;
let EDIT = false;
const TODAY = todayIso();

const S = {
    customers: [], orders: [], invoices: [], payments: [], allocations: [],
    notices: [], plans: [], reminders: [],
    items: [], pending: [],
    custById: new Map(), orderById: new Map(),
};

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, MODULE))) return;
    EDIT = canEdit(ctx, MODULE);

    await renderNavbar(MODULE, ctx);
    initTabs();
    initFilters();
    initModals();
    applyEditLock(ctx, MODULE);
    await loadData();
});

// ═══════════════════════════════════════════════════════════════════════════
// YARDIMCILAR
// ═══════════════════════════════════════════════════════════════════════════
function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function fmtNum(n, digits = 2) {
    return (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function money(n, cur) {
    return `${fmtNum(n)} ${SYM[cur] || cur || ''}`.trim();
}

function dateTr(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}.${m}.${y}`;
}

// "17.752" -> 17752 · "17.752,50" -> 17752.5 · "46,4935" -> 46.4935 · "46.4935" -> 46.4935
function parseNum(v) {
    let s = String(v ?? '').trim().replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
    if (!s || s === '-') return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return Number(s);
}

function currencyLines(obj, { emptyText = '—', cls = '' } = {}) {
    const entries = CURRENCIES.filter(c => Math.abs(obj[c] || 0) > 0.005).map(c => [c, obj[c]]);
    Object.keys(obj).filter(c => !CURRENCIES.includes(c) && Math.abs(obj[c]) > 0.005).forEach(c => entries.push([c, obj[c]]));
    if (!entries.length) return `<div class="muted ${cls}">${emptyText}</div>`;
    return entries.map(([c, v]) => `<div class="${cls}">${money(v, c)}</div>`).join('');
}

function toast(message, variant = 'ok') {
    const el = document.createElement('div');
    const color = variant === 'ok' ? 'var(--ok)' : variant === 'warn' ? 'var(--warn)' : 'var(--danger)';
    el.style.cssText = `position:fixed;right:24px;bottom:24px;z-index:400;background:var(--surface);border:1px solid var(--border);
        border-left:4px solid ${color};border-radius:8px;padding:12px 16px;font-size:13px;color:var(--ink-1);
        box-shadow:0 10px 30px rgba(0,0,0,.12);max-width:380px;`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 2600);
    setTimeout(() => el.remove(), 3000);
}

function dueCell(item) {
    if (!item.dueDate) {
        const age = item.docDate ? daysBetween(item.docDate, TODAY) : null;
        return `<span class="pill neutral">Vadesiz</span>${age !== null ? `<div class="muted" style="font-size:11px;margin-top:3px;">faturadan ${age} gün</div>` : ''}`;
    }
    const d = item.overdueDays;
    let pill = '';
    if (d > 0) pill = `<span class="pill danger">${d} gün gecikti</span>`;
    else if (d === 0) pill = `<span class="pill warn">Bugün</span>`;
    else if (d >= -7) pill = `<span class="pill warn">${-d} gün kaldı</span>`;
    else pill = `<span class="pill neutral">${-d} gün kaldı</span>`;
    const plan = item.planNote ? `<div class="muted" style="font-size:10.5px;margin-top:3px;">${esc(item.planNote)}</div>` : '';
    return `<div class="nowrap">${dateTr(item.dueDate)}</div><div style="margin-top:3px;">${pill}</div>${plan}`;
}

function docCell(item) {
    const fx = item.fxRate ? `<div class="muted" style="font-size:11px;">${money(item.invoiceAmount, item.invoiceCurrency)} @ ${fmtNum(item.fxRate, 4)}</div>` : '';
    const doc = item.kind === 'order'
        ? `<div class="muted" style="font-size:11px;">Faturası girilmemiş sevk</div>`
        : `<div class="muted" style="font-size:11px;">${esc(item.docNo || '')}</div>`;
    return `<div class="strong">Sipariş ${esc(item.orderNumber || '—')}</div>${doc}${fx}`;
}

function sevClass(item) {
    if (item.overdueDays > 0) return 'sev-danger';
    if (item.dueDate && item.overdueDays >= -7) return 'sev-warn';
    return '';
}

function lastReminder(item) {
    const list = S.reminders.filter(r => r.order_id === item.orderId);
    return list.sort((a, b) => (b.reminder_date || '').localeCompare(a.reminder_date || ''))[0] || null;
}

function findItem(key) {
    return S.items.find(i => i.key === key) || S.pending.find(p => p.key === key);
}

// ═══════════════════════════════════════════════════════════════════════════
// VERİ
// ═══════════════════════════════════════════════════════════════════════════
async function loadData() {
    const owner = ctx.ownerId;
    try {
        const results = await Promise.all([
            supabase.from('customers').select('id, company_name, country, eximbank_insured, eximbank_customer_no, eximbank_limit, eximbank_limit_currency, eximbank_term_days').eq('user_id', owner).order('company_name'),
            supabase.from('orders').select('*').eq('user_id', owner),
            supabase.from('order_invoices').select('*').eq('user_id', owner),
            supabase.from('payments').select('*').eq('user_id', owner).order('payment_date', { ascending: false, nullsFirst: false }),
            supabase.from('payment_allocations').select('*'),
            supabase.from('eximbank_notices').select('*').eq('user_id', owner).order('notice_date', { ascending: false }),
            supabase.from('payment_plans').select('*, payment_plan_installments(*)').eq('user_id', owner),
            supabase.from('collection_reminders').select('*').eq('user_id', owner).order('reminder_date', { ascending: false }),
        ]);
        const err = results.find(r => r.error)?.error;
        if (err) throw err;

        [S.customers, S.orders, S.invoices, S.payments, S.allocations, S.notices, S.plans, S.reminders] =
            results.map(r => r.data || []);

        S.custById = new Map(S.customers.map(c => [c.id, c]));
        S.orderById = new Map(S.orders.map(o => [o.id, o]));

        const built = buildReceivables({
            orders: S.orders, invoices: S.invoices, customers: S.customers, today: TODAY,
        });
        S.items = built.items;
        S.pending = built.pending;
        applyPaymentPlans();
        splitManualTracking();

        renderAll();
    } catch (e) {
        console.error('Ödeme Takibi veri hatası:', e);
        document.getElementById('kpi-grid').innerHTML =
            `<div class="kpi-card accent-danger" style="grid-column:1/-1;color:var(--danger);">
                <i class="fa-solid fa-triangle-exclamation"></i> Veriler yüklenemedi: ${esc(e.message)}
                <div class="hint" style="margin-top:6px;">022, 023 ve 027 numaralı SQL dosyaları çalıştırılmış olmalı.</div>
             </div>`;
    }
}

// Ödeme planı olan siparişte vade artık siparişin eski vadesi değil, planın ödenmemiş
// ilk taksitidir (ör. Sulav 2024-02: vade 16.08.2023 yerine 10.10.2026). Aksi hâlde
// yeniden yapılandırılmış borç "1128 gün gecikti" görünür.
function applyPaymentPlans() {
    S.plans.filter(p => p.status === 'Aktif' && p.order_id).forEach(plan => {
        const next = installmentStatus(plan.payment_plan_installments || [], planPaidAmount(plan), TODAY)
            .find(i => i.state !== 'paid');
        if (!next) return;
        S.items.filter(i => i.orderId === plan.order_id).forEach(item => {
            item.dueDate = next.due_date;
            item.overdueDays = daysBetween(next.due_date, TODAY);
            item.bucket = agingBucket(next.due_date, TODAY);
            item.planNote = `Ödeme planı: ${next.seq}. taksit ${money(next.open, plan.currency)}`;
        });
    });
}

// Manuel takibe alınmış siparişler (SQL 034) Açık Alacaklar'dan ve vade panellerinden çıkar,
// Manuel Alacaklar sekmesinde izlenir. Eximbank sekmesi sigorta süreleri kaçmasın diye hepsini görür.
function splitManualTracking() {
    const manual = id => !!S.orderById.get(id)?.manual_tracking;
    S.openItems     = S.items.filter(i => !manual(i.orderId));
    S.manualItems   = S.items.filter(i => manual(i.orderId));
    S.openPending   = S.pending.filter(p => !manual(p.orderId));
    S.manualPending = S.pending.filter(p => manual(p.orderId));
}

function renderAll() {
    renderDashboard();
    renderOpen();
    renderPayments();
    renderEximbank();
    renderManual();
    fillCurrencyFilter();
}

// ═══════════════════════════════════════════════════════════════════════════
// SEKMELER & FİLTRELER
// ═══════════════════════════════════════════════════════════════════════════
function initTabs() {
    const tabs = document.querySelectorAll('.pt-tab');
    const show = id => {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
        document.querySelectorAll('.pt-panel').forEach(p => { p.hidden = p.id !== `panel-${id}`; });
        try { localStorage.setItem('payments-tab', id); } catch { /* yok say */ }
    };
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    let saved = null;
    try { saved = localStorage.getItem('payments-tab'); } catch { /* yok say */ }
    if (saved && document.getElementById(`panel-${saved}`)) show(saved);
    window.__showPaymentsTab = show;
}

const F = {
    openSearch: '', openCurrency: '', openKind: '', openBucket: '', openSort: 'overdue',
    paySearch: '', payFrom: '', payTo: '', payShowOpening: false, payExpanded: new Set(),
    manSearch: '', manExpanded: new Set(),
};

function initFilters() {
    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
    on('open-search', 'input', e => { F.openSearch = e.target.value.toLocaleLowerCase('tr-TR'); renderOpen(); });
    on('open-currency', 'change', e => { F.openCurrency = e.target.value; renderOpen(); });
    on('open-kind', 'change', e => { F.openKind = e.target.value; renderOpen(); });
    chipGroup('open-bucket', v => { F.openBucket = v; renderOpen(); });
    on('open-sort', 'change', e => { F.openSort = e.target.value; renderOpen(); });
    on('man-search', 'input', e => { F.manSearch = e.target.value.toLocaleLowerCase('tr-TR'); renderManual(); });

    on('pay-search', 'input', e => { F.paySearch = norm(e.target.value.trim()); renderPayments(); });
    on('pay-toggle-all', 'click', () => {
        if (F.payExpanded.size) F.payExpanded.clear(); else (F.payGroupKeys || []).forEach(k => F.payExpanded.add(k));
        renderPayments();
    });
    on('pay-from', 'change', e => { F.payFrom = e.target.value; renderPayments(); });
    on('pay-to', 'change', e => { F.payTo = e.target.value; renderPayments(); });
    on('pay-show-opening', 'change', e => { F.payShowOpening = e.target.checked; renderPayments(); });

    on('btn-refresh', 'click', async () => {
        const i = document.querySelector('#btn-refresh i');
        i?.classList.add('fa-spin');
        await loadData();
        i?.classList.remove('fa-spin');
    });
    on('btn-new-payment', 'click', () => openPaymentModal({}));

    // Tablo içi butonlar (event delegation)
    document.body.addEventListener('click', e => {
        const card = e.target.closest('[data-kpi]');
        if (card) { openKpiModal(card.dataset.kpi); return; }

        const b = e.target.closest('[data-act]');
        if (!b) return;
        const { act, key, id } = b.dataset;
        // Panel detay penceresinden bir işlem açılıyorsa önce o pencere kapansın.
        if (b.closest('#kpi-modal')) closeModal('kpi-modal');
        if (act === 'pay')      openPaymentModal({ item: findItem(key) });
        if (act === 'remind')   openReminderModal(findItem(key));
        if (act === 'notice')   openNoticeModal(findItem(key));
        if (act === 'allocate') openPaymentModal({ payment: S.payments.find(p => p.id === id) });
        if (act === 'del-pay')  deletePayment(id);
        if (act === 'goto-open') { window.__showPaymentsTab('open'); }
        if (act === 'to-manual')   moveToManual(findItem(key));
        if (act === 'from-manual') moveFromManual(id);
        if (act === 'plan')        openPlanModal(id);
        if (act === 'invoices')    openInvoiceModal(id);
        if (act === 'edit-note')   editManualNote(id);
        if (act === 'toggle-cust') { F.payExpanded.has(id) ? F.payExpanded.delete(id) : F.payExpanded.add(id); renderPayments(); }
        if (act === 'date-pay')    { closeModal('payment-modal'); openDateModal(id); }
        if (act === 'toggle-plan') { F.manExpanded.has(id) ? F.manExpanded.delete(id) : F.manExpanded.add(id); renderManual(); }
    });
}

function chipGroup(id, onChange) {
    const g = document.getElementById(id);
    g?.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
        g.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        onChange(btn.dataset.v);
    }));
}

function fillCurrencyFilter() {
    const sel = document.getElementById('open-currency');
    const present = CURRENCIES.filter(c => S.openItems.some(i => i.currency === c));
    const cur = sel.value;
    sel.innerHTML = `<option value="">Tümü</option>` + present.map(c => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// GENEL BAKIŞ
// ═══════════════════════════════════════════════════════════════════════════
function renderDashboard() {
    const live = S.openItems;
    const overdue = live.filter(i => i.overdueDays > 0);
    const upcoming = live.filter(i => i.dueDate && i.overdueDays <= 0 && i.overdueDays >= -30);

    const monthStart = TODAY.slice(0, 8) + '01';
    const monthPays = S.payments.filter(p => !p.is_opening && p.payment_date && p.payment_date >= monthStart && p.payment_date <= TODAY);
    const monthPayIds = new Set(monthPays.map(p => p.id));
    const monthCharges = {};
    S.allocations.filter(a => monthPayIds.has(a.payment_id) && a.write_off_type === 'Banka Kesintisi' && Number(a.write_off_amount))
        .forEach(a => {
            const cur = S.payments.find(p => p.id === a.payment_id)?.currency;
            monthCharges[cur] = round2((monthCharges[cur] || 0) + Number(a.write_off_amount));
        });

    const oldest = overdue.reduce((m, i) => Math.max(m, i.overdueDays), 0);
    const chargeTxt = Object.keys(monthCharges).length
        ? ' · kesinti ' + Object.entries(monthCharges).map(([c, v]) => money(v, c)).join(', ')
        : '';

    // Panel detay penceresi (openKpiModal) aynı listeleri kullanır.
    S.kpi = { open: live, overdue, upcoming, month: monthPays, pending: S.openPending };

    const kpi = (id, title, icon, color, body, sub, accent = '') => `
        <div class="kpi-card ${accent}" data-kpi="${id}" title="Detay için tıklayın">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <i class="fa-solid ${icon}" style="color:${color};font-size:13px;"></i>
                <div class="label-caps">${title}</div>
            </div>
            <div class="kpi-lines">${body}</div>
            <div class="kpi-sub">${sub}</div>
            <div class="kpi-more">Siparişleri göster →</div>
        </div>`;

    document.getElementById('kpi-grid').innerHTML = [
        kpi('open', 'Açık alacak', 'fa-wallet', 'var(--accent)', currencyLines(sumByCurrency(live)),
            `${live.length} fatura / sevk`),
        kpi('overdue', 'Vadesi geçen', 'fa-circle-exclamation', 'var(--danger)', currencyLines(sumByCurrency(overdue)),
            overdue.length ? `${overdue.length} kalem · en eski ${oldest} gün` : 'Vadesi geçen alacak yok', 'accent-danger'),
        kpi('upcoming', '30 gün içinde vadesi gelecek', 'fa-calendar-day', 'var(--warn)', currencyLines(sumByCurrency(upcoming)),
            `${upcoming.length} kalem`, 'accent-warn'),
        kpi('month', 'Bu ay tahsilat', 'fa-circle-check', 'var(--ok)', currencyLines(sumByCurrency(monthPays, 'amount')),
            `${monthPays.length} tahsilat${chargeTxt}`, 'accent-ok'),
        kpi('pending', 'Henüz faturalanmamış', 'fa-hourglass-half', 'var(--info)', currencyLines(sumByCurrency(S.openPending)),
            `${S.openPending.length} sipariş · alacak değil`),
        kpi('manual', 'Manuel takip', 'fa-book', 'var(--bronze)', currencyLines(sumByCurrency([...S.manualItems, ...S.manualPending])),
            `${new Set([...S.manualItems, ...S.manualPending].map(i => i.orderId)).size} sipariş · serbest takip`),
    ].join('');

    document.getElementById('cnt-open').textContent = live.length;
    const cntOpen = document.getElementById('cnt-open');
    cntOpen.classList.toggle('danger', overdue.length > 0);

    // Eximbank — dikkat gereken
    const exim = eximbankRows().filter(r => r.info && r.info.stage !== 'not-due');
    const eximCnt = document.getElementById('cnt-exim');
    eximCnt.textContent = exim.length;
    eximCnt.classList.toggle('danger', exim.some(r => ['warn', 'vgab-late', 'lost'].includes(r.info.stage)));
    document.getElementById('dash-exim').innerHTML = exim.length
        ? miniTable(exim.sort((a, b) => a.info.vgab.localeCompare(b.info.vgab)).map(r => `
            <tr class="${['warn', 'vgab-late', 'lost'].includes(r.info.stage) ? 'sev-danger' : 'sev-warn'}">
                <td><div class="strong">${esc(r.item.customerName)}</div><div class="muted" style="font-size:11px;">Sipariş ${esc(r.item.orderNumber)} · vade ${dateTr(r.item.dueDate)}</div></td>
                <td class="num">${money(r.item.open, r.item.currency)}</td>
                <td>${eximStagePill(r)}</td>
            </tr>`), ['Müşteri', 'Açık', 'Durum'])
        : `<div class="empty"><i class="fa-solid fa-check" style="color:var(--ok);"></i> Eximbank kapsamında vadesi geçen alacak yok.</div>`;

    // Vadesi geçenler
    document.getElementById('dash-overdue').innerHTML = overdue.length
        ? miniTable(overdue.sort((a, b) => b.overdueDays - a.overdueDays).slice(0, 8).map(i => `
            <tr class="sev-danger">
                <td><div class="strong">${esc(i.customerName)}</div><div class="muted" style="font-size:11px;">Sipariş ${esc(i.orderNumber)}</div></td>
                <td class="nowrap">${dateTr(i.dueDate)}<div><span class="pill danger">${i.overdueDays} gün</span></div></td>
                <td class="num">${money(i.open, i.currency)}</td>
            </tr>`), ['Müşteri', 'Vade', 'Açık'], overdue.length > 8 ? `+${overdue.length - 8} kalem daha` : '')
        : `<div class="empty"><i class="fa-solid fa-check" style="color:var(--ok);"></i> Vadesi geçen alacak yok.</div>`;

    // Yaklaşan
    document.getElementById('dash-upcoming').innerHTML = upcoming.length
        ? miniTable(upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8).map(i => `
            <tr class="${i.overdueDays >= -7 ? 'sev-warn' : ''}">
                <td><div class="strong">${esc(i.customerName)}</div><div class="muted" style="font-size:11px;">Sipariş ${esc(i.orderNumber)}${i.eximbank ? ' · Eximbank' : ''}</div></td>
                <td class="nowrap">${dateTr(i.dueDate)}<div class="muted" style="font-size:11px;">${-i.overdueDays} gün kaldı</div></td>
                <td class="num">${money(i.open, i.currency)}</td>
            </tr>`), ['Müşteri', 'Vade', 'Açık'], upcoming.length > 8 ? `+${upcoming.length - 8} kalem daha` : '')
        : `<div class="empty">Önümüzdeki 30 günde vadesi gelen alacak yok.</div>`;

    // Planlar & sözler
    document.getElementById('dash-plans').innerHTML = renderPlansAndPromises();
}

// Üstteki panellere tıklanınca: panelin rakamını oluşturan siparişlerin listesi.
function openKpiModal(id) {
    if (id === 'manual') { window.__showPaymentsTab('manual'); window.scrollTo(0, 0); return; }
    const list = S.kpi?.[id];
    if (!list) return;
    const title = {
        open:     ['fa-wallet', 'var(--accent)', 'Açık alacak'],
        overdue:  ['fa-circle-exclamation', 'var(--danger)', 'Vadesi geçen alacaklar'],
        upcoming: ['fa-calendar-day', 'var(--warn)', '30 gün içinde vadesi gelecek alacaklar'],
        month:    ['fa-circle-check', 'var(--ok)', 'Bu ay yapılan tahsilatlar'],
        pending:  ['fa-hourglass-half', 'var(--info)', 'Henüz faturalanmamış sipariş bakiyeleri'],
    }[id];
    document.getElementById('km-title').innerHTML = `<i class="fa-solid ${title[0]}" style="color:${title[1]};"></i> ${title[2]} <span class="pill neutral">${list.length}</span>`;

    const body = document.getElementById('km-body');
    const summary = document.getElementById('km-summary');

    if (id === 'month') {
        summary.innerHTML = `<span>Toplam:</span> ${Object.entries(sumByCurrency(list, 'amount')).map(([c, v]) => `<b>${money(v, c)}</b>`).join(' · ') || '<b>—</b>'}`;
        body.innerHTML = list.length ? `<table class="data-table">
            <thead><tr><th>Tarih</th><th>Müşteri</th><th>Sipariş</th><th>Yol</th><th>Referans</th><th class="num">Tutar</th></tr></thead>
            <tbody>${list.slice().sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || '')).map(p => {
                const orders = paymentAllocations(p.id).map(a => S.orderById.get(a.order_id)?.order_number).filter(Boolean);
                return `<tr>
                    <td class="nowrap">${dateTr(p.payment_date)}</td>
                    <td class="strong">${esc(S.custById.get(p.customer_id)?.company_name || '—')}</td>
                    <td>${orders.map(esc).join(', ') || '<span class="muted">dağıtılmadı</span>'}</td>
                    <td style="font-size:12px;">${esc(p.method || '')}</td>
                    <td style="font-size:12px;">${esc(p.reference_no || '')}</td>
                    <td class="num strong">${money(p.amount, p.currency)}</td>
                </tr>`;
            }).join('')}</tbody></table>` : `<div class="empty">Bu ay tahsilat yok.</div>`;
        openModal('kpi-modal');
        return;
    }

    if (id === 'pending') {
        summary.innerHTML = `<span>Tahsil edilmemiş:</span> ${Object.entries(sumByCurrency(list)).map(([c, v]) => `<b>${money(v, c)}</b>`).join(' · ') || '<b>—</b>'}
            <span class="muted">Bunlar alacak değil — sipariş henüz (tamamen) faturalanmadı.</span>`;
        body.innerHTML = list.length ? `<table class="data-table">
            <thead><tr><th>Müşteri</th><th>Sipariş</th><th>Sipariş tarihi</th><th>Durum</th><th class="num">Sipariş tutarı</th><th class="num">Faturalanmamış</th><th class="num">Tahsil edilmemiş</th></tr></thead>
            <tbody>${list.slice().sort((a, b) => byCustomer(a, b) || (a.orderNumber || '').localeCompare(b.orderNumber || '')).map(p => `<tr>
                <td class="strong">${esc(p.customerName)}</td>
                <td>${esc(p.orderNumber)}</td>
                <td class="nowrap">${dateTr(p.orderDate)}</td>
                <td>${(p.tags || []).filter(t => t !== 'Gecikme').map(t => `<span class="pill neutral" style="margin:1px;">${esc(t)}</span>`).join('')}</td>
                <td class="num">${money(p.total, p.currency)}</td>
                <td class="num">${money(p.uninvoiced, p.currency)}</td>
                <td class="num strong">${money(p.open, p.currency)}</td>
            </tr>`).join('')}</tbody></table>` : `<div class="empty">Faturalanmamış bakiye yok.</div>`;
        openModal('kpi-modal');
        return;
    }

    const rows = sortItems(list.slice(), id === 'upcoming' ? 'due-asc' : id === 'overdue' ? 'overdue' : 'customer');
    summary.innerHTML = `<span>Açık toplam:</span> ${Object.entries(sumByCurrency(rows)).map(([c, v]) => `<b>${money(v, c)}</b>`).join(' · ') || '<b>—</b>'}`;
    body.innerHTML = rows.length ? `<table class="data-table">
        <thead><tr><th>Müşteri</th><th>Sipariş / Fatura</th><th>Fatura tarihi</th><th>Vade</th><th class="num">Tutar</th><th class="num">Açık</th><th></th></tr></thead>
        <tbody>${rows.map(i => `<tr class="${sevClass(i)}">
            <td><div class="strong">${esc(i.customerName)}</div>${i.eximbank ? '<span class="pill info" style="margin-top:3px;">Eximbank</span>' : ''}</td>
            <td>${docCell(i)}</td>
            <td class="nowrap">${dateTr(i.docDate)}</td>
            <td>${dueCell(i)}</td>
            <td class="num">${money(i.amount, i.currency)}</td>
            <td class="num strong">${money(i.open, i.currency)}</td>
            <td class="nowrap" style="text-align:right;">${EDIT ? `<button class="pt-btn sm" data-act="pay" data-key="${i.key}"><i class="fa-solid fa-plus"></i> Tahsilat</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>` : `<div class="empty">Kayıt yok.</div>`;
    openModal('kpi-modal');
}

function miniTable(rows, headers, footer = '') {
    return `<div class="pt-table-wrap"><table class="data-table">
        <thead><tr>${headers.map((h, i) => `<th class="${i === headers.length - 1 && h !== 'Durum' ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>
        ${footer ? `<div class="hint" style="margin-top:8px;text-align:right;"><a href="javascript:void(0)" data-act="goto-open" style="color:var(--accent);">${footer} →</a></div>` : ''}`;
}

// Plana yapılan ödeme = plan tutarı − siparişin bugünkü kalan bakiyesi.
// (Siparişin toplam tahsilatı değil: plan öncesi ödemeler — Sulav'da ilk 5.000 USD — taksit kapatmaz.)
// 1 birimin altı yuvarlama sayılır (Sulav belgesi 45.689, sistem 45.688,50).
function planPaidAmount(plan) {
    const o = S.orderById.get(plan.order_id);
    const planTotal = Number(plan.total_amount) ||
        (plan.payment_plan_installments || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const paid = Math.max(0, planTotal - (Number(o?.remaining_balance) || 0));
    return paid < 1 ? 0 : paid;
}

function renderPlansAndPromises() {
    const rows = [];
    S.plans.filter(p => p.status === 'Aktif').forEach(plan => {
        const insts = installmentStatus(plan.payment_plan_installments || [], planPaidAmount(plan), TODAY);
        const next = insts.filter(i => i.state !== 'paid');
        const who = S.custById.get(plan.customer_id)?.company_name || '';
        next.filter(i => i.late || i.daysToDue <= 45).forEach(i => {
            rows.push({
                sort: i.due_date,
                html: `<tr class="${i.late ? 'sev-danger' : i.daysToDue <= 7 ? 'sev-warn' : ''}">
                    <td><div class="strong">${esc(who)}</div><div class="muted" style="font-size:11px;">${esc(plan.title || 'Ödeme planı')} · ${i.seq}. taksit</div></td>
                    <td class="nowrap">${dateTr(i.due_date)}<div>${i.late ? `<span class="pill danger">${-i.daysToDue} gün gecikti</span>` : `<span class="pill ${i.daysToDue <= 7 ? 'warn' : 'neutral'}">${i.daysToDue} gün kaldı</span>`}</div></td>
                    <td class="num">${money(i.open, plan.currency)}${i.state === 'partial' ? '<div class="muted" style="font-size:11px;">kısmi ödendi</div>' : ''}</td>
                </tr>`,
            });
        });
        if (!next.length) return;
    });

    // Söz verilen tarihi geçmiş ve hâlâ açık olan hatırlatmalar (her belge için en son kayıt)
    const seen = new Set();
    S.reminders.forEach(r => {
        const k = r.order_id || r.customer_id;
        if (seen.has(k)) return;
        seen.add(k);
        if (!r.promised_date || r.promised_date >= TODAY) return;
        const stillOpen = S.items.some(i => r.order_id && i.orderId === r.order_id);
        if (!stillOpen) return;
        const who = S.custById.get(r.customer_id)?.company_name || '';
        const ord = r.order_id ? S.orderById.get(r.order_id)?.order_number : null;
        rows.push({
            sort: r.promised_date,
            html: `<tr class="sev-danger">
                <td><div class="strong">${esc(who)}</div><div class="muted" style="font-size:11px;">Söz verilen ödeme${ord ? ' · Sipariş ' + esc(ord) : ''}</div></td>
                <td class="nowrap">${dateTr(r.promised_date)}<div><span class="pill danger">söz tutulmadı</span></div></td>
                <td class="num muted" style="font-size:11px;">${esc(r.channel || '')}</td>
            </tr>`,
        });
    });

    if (!rows.length) return `<div class="empty">Önümüzdeki 45 günde taksit ya da tutulmamış ödeme sözü yok.</div>`;
    return miniTable(rows.sort((a, b) => a.sort.localeCompare(b.sort)).map(r => r.html), ['Müşteri', 'Tarih', 'Tutar']);
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇIK ALACAKLAR
// ═══════════════════════════════════════════════════════════════════════════
const byCustomer = (a, b) => (a.customerName || '').localeCompare(b.customerName || '', 'tr');

function sortItems(list, mode) {
    const cmp = {
        'overdue':      (a, b) => (b.overdueDays ?? -99999) - (a.overdueDays ?? -99999) || byCustomer(a, b),
        'invoice-desc': (a, b) => (b.docDate || '').localeCompare(a.docDate || '') || byCustomer(a, b),
        'invoice-asc':  (a, b) => (a.docDate || '9999').localeCompare(b.docDate || '9999') || byCustomer(a, b),
        'due-asc':      (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || byCustomer(a, b),
        'customer':     (a, b) => byCustomer(a, b) || (a.docDate || '').localeCompare(b.docDate || ''),
    }[mode] || ((a, b) => 0);
    return list.sort(cmp);
}

function renderOpen() {
    renderAging();

    let list = S.openItems.slice();
    if (F.openCurrency) list = list.filter(i => i.currency === F.openCurrency);
    if (F.openKind) list = list.filter(i => i.kind === F.openKind);
    if (F.openBucket === 'overdue') list = list.filter(i => i.overdueDays > 0);
    if (F.openBucket === 'current') list = list.filter(i => i.dueDate && i.overdueDays <= 0);
    if (F.openBucket === 'nodue') list = list.filter(i => !i.dueDate);
    if (F.openSearch) {
        list = list.filter(i => [i.customerName, i.orderNumber, i.docNo]
            .some(v => String(v || '').toLocaleLowerCase('tr-TR').includes(F.openSearch)));
    }
    sortItems(list, F.openSort);

    const el = document.getElementById('open-table');
    if (!list.length) {
        el.innerHTML = `<div class="empty">Kriterlere uyan açık alacak yok.</div>`;
    } else {
        const totals = sumByCurrency(list);
        el.innerHTML = `<table class="data-table">
            <thead><tr>
                <th>Müşteri</th><th>Belge</th><th>Fatura tarihi</th><th>Vade</th>
                <th class="num">Tutar</th><th class="num">Açık</th><th>Son hatırlatma</th><th></th>
            </tr></thead>
            <tbody>${list.map(i => {
                const rem = lastReminder(i);
                return `<tr class="${sevClass(i)}">
                    <td><div class="strong">${esc(i.customerName)}</div>${i.eximbank ? '<span class="pill info" style="margin-top:3px;">Eximbank</span>' : ''}</td>
                    <td>${docCell(i)}</td>
                    <td class="nowrap">${dateTr(i.docDate)}</td>
                    <td>${dueCell(i)}</td>
                    <td class="num">${money(i.amount, i.currency)}</td>
                    <td class="num strong">${money(i.open, i.currency)}</td>
                    <td style="font-size:11.5px;">${rem
                        ? `${dateTr(rem.reminder_date)} · ${esc(rem.channel || '')}${rem.promised_date ? `<div class="muted">söz: ${dateTr(rem.promised_date)}</div>` : ''}`
                        : '<span class="muted">—</span>'}</td>
                    <td class="nowrap" style="text-align:right;">
                        ${EDIT ? `<button class="pt-btn sm" data-act="pay" data-key="${i.key}" title="Tahsilat gir"><i class="fa-solid fa-plus"></i> Tahsilat</button>
                                  <button class="pt-btn sm icon" data-act="remind" data-key="${i.key}" title="Hatırlatma kaydet"><i class="fa-solid fa-bell"></i></button>
                                  <button class="pt-btn sm icon" data-act="to-manual" data-key="${i.key}" title="Manuel Alacaklar'a taşı"><i class="fa-solid fa-folder-open"></i></button>
                                  <button class="pt-btn sm icon" data-act="invoices" data-id="${i.orderId}" title="Sipariş faturaları"><i class="fa-solid fa-file-invoice"></i></button>` : ''}
                    </td>
                </tr>`;
            }).join('')}</tbody>
            <tfoot><tr><td colspan="5">${list.length} kalem</td><td class="num">${currencyLines(totals)}</td><td colspan="2"></td></tr></tfoot>
        </table>`;
    }

    // Faturalanmamış bakiyeler
    const pend = S.openPending.slice().sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''));
    document.getElementById('pending-table').innerHTML = pend.length ? `<table class="data-table">
        <thead><tr><th>Müşteri</th><th>Sipariş</th><th>Sipariş tarihi</th><th>Durum</th>
            <th class="num">Sipariş tutarı</th><th class="num">Faturalanmamış</th><th class="num">Tahsil edilmemiş</th><th></th></tr></thead>
        <tbody>${pend.map(p => `<tr>
            <td class="strong">${esc(p.customerName)}</td>
            <td>${esc(p.orderNumber)}</td>
            <td class="nowrap">${dateTr(p.orderDate)}</td>
            <td>${(p.tags || []).filter(t => t !== 'Gecikme').map(t => `<span class="pill neutral" style="margin:1px;">${esc(t)}</span>`).join('')}</td>
            <td class="num">${money(p.total, p.currency)}</td>
            <td class="num">${money(p.uninvoiced, p.currency)}</td>
            <td class="num strong">${money(p.open, p.currency)}</td>
            <td class="nowrap" style="text-align:right;">${EDIT ? `<button class="pt-btn sm" data-act="invoices" data-id="${p.orderId}"><i class="fa-solid fa-file-invoice"></i> Fatura ekle</button>` : ''}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6">${pend.length} sipariş</td><td class="num">${currencyLines(sumByCurrency(pend))}</td><td></td></tr></tfoot>
    </table>` : `<div class="empty">Faturalanmamış bakiye yok.</div>`;
}

function renderAging() {
    const table = {};
    S.openItems.forEach(i => {
        const col = i.bucket;
        table[i.currency] = table[i.currency] || {};
        table[i.currency][col] = round2((table[i.currency][col] || 0) + i.open);
    });
    const cols = AGING_BUCKETS;
    const curs = CURRENCIES.filter(c => table[c]);
    if (!curs.length) {
        document.getElementById('aging-table').innerHTML = `<div class="empty">Açık alacak yok.</div>`;
        return;
    }
    document.getElementById('aging-table').innerHTML = `<table class="data-table">
        <thead><tr><th>Para birimi</th>${cols.map(c => `<th class="num">${c.label}</th>`).join('')}<th class="num">Toplam</th></tr></thead>
        <tbody>${curs.map(cur => {
            const row = table[cur];
            const total = Object.values(row).reduce((s, v) => s + v, 0);
            return `<tr>
                <td class="strong">${cur}</td>
                ${cols.map(c => {
                    const v = row[c.id] || 0;
                    const danger = ['31-60', '61-90', '90+'].includes(c.id) && v > 0.005;
                    return `<td class="num ${danger ? 'strong' : ''}" style="${danger ? 'color:var(--danger);' : ''}">${v > 0.005 ? fmtNum(v) : '<span class="muted">—</span>'}</td>`;
                }).join('')}
                <td class="num strong">${fmtNum(total)}</td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAHSİLATLAR
// ═══════════════════════════════════════════════════════════════════════════
function paymentAllocations(paymentId) {
    return S.allocations.filter(a => a.payment_id === paymentId);
}

// Türkçe harf farkları aramayı bozmasın: "otomotiv" yazınca "Otomotıv" da bulunsun.
function norm(s) {
    return String(s || '').toLocaleLowerCase('tr-TR')
        .replace(/i̇/g, 'i').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
        .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

function renderPayments() {
    let list = S.payments.slice();
    if (!F.payShowOpening) list = list.filter(p => !p.is_opening);
    if (F.payFrom) list = list.filter(p => p.payment_date && p.payment_date >= F.payFrom);
    if (F.payTo) list = list.filter(p => p.payment_date && p.payment_date <= F.payTo);

    // Sipariş bazında grupla. Bir tahsilat birden çok siparişe dağıtılmışsa (tek SWIFT ile
    // iki sipariş, fazla ödeme mahsubu) her siparişin altında o siparişe düşen tutarla görünür.
    // Hiçbir siparişe dağıtılmamış kısım firmanın "müşteri avansı" başlığına düşer.
    const groups = new Map();
    const group = (key, init) => { if (!groups.has(key)) groups.set(key, { key, entries: [], ...init }); return groups.get(key); };

    list.forEach(p => {
        const allocs = paymentAllocations(p.id);
        const cash = allocs.reduce((s, a) => s + (Number(a.amount) || 0), 0);
        const unallocated = round2((Number(p.amount) || 0) - cash);
        const custName = S.custById.get(p.customer_id)?.company_name || '—';
        allocs.forEach(a => {
            const o = S.orderById.get(a.order_id);
            if (!o) return;
            group(o.id, { kind: 'order', order: o, custName }).entries.push({ p, a, amount: Number(a.amount) || 0, writeOff: Number(a.write_off_amount) || 0, shared: allocs.length > 1 });
        });
        if (unallocated > 0.005 && !p.is_opening) {
            group(`unalloc:${p.customer_id}`, { kind: 'unalloc', custName, currency: p.currency })
                .entries.push({ p, a: null, amount: unallocated, writeOff: 0, shared: allocs.length > 0 });
        }
    });

    let list2 = [...groups.values()];
    if (F.paySearch) {
        list2 = list2.filter(g => [g.custName, g.order?.order_number, ...g.entries.flatMap(e => [e.p.reference_no, e.p.notes, e.p.bank_account])]
            .some(v => norm(v).includes(F.paySearch)));
    }
    list2.forEach(g => {
        g.entries.sort((x, y) => (y.p.payment_date || '0000').localeCompare(x.p.payment_date || '0000'));
        g.last = g.entries.find(e => e.p.payment_date)?.p.payment_date || null;
        g.currency = g.order?.currency || g.currency;
        g.total = round2(g.entries.reduce((s, e) => s + e.amount + e.writeOff, 0));
    });
    list2.sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.custName.localeCompare(b.custName, 'tr')
        || (b.order?.order_number || '').localeCompare(a.order?.order_number || ''));
    F.payGroupKeys = list2.map(g => g.key);

    const el = document.getElementById('payments-table');
    if (!list2.length) {
        el.innerHTML = `<div class="empty">
            ${F.payShowOpening || F.paySearch ? 'Kayıt yok.' : 'Henüz tarihli tahsilat yok. Geçmiş ödemeler "tarihsiz" kayıt olarak duruyor — görmek ve tarihlerini girmek için yukarıdaki kutuyu işaretleyin.'}
        </div>`;
        return;
    }

    const expandAll = !!F.paySearch;
    const paymentCount = new Set(list2.flatMap(g => g.entries.map(e => e.p.id))).size;

    el.innerHTML = `<table class="data-table">
        <thead><tr>
            <th style="width:34px;"></th><th>Müşteri / Sipariş</th><th>Ödeme tarihi</th><th class="num">Tutar</th>
            <th>Yol / Banka</th><th>Referans / Not</th><th class="num">Sipariş kalanı</th><th></th>
        </tr></thead>
        <tbody>${list2.map(g => {
            const open = expandAll || F.payExpanded.has(g.key);
            const cur = g.currency;
            const title = g.kind === 'order'
                ? `<span class="strong">${esc(g.custName)}</span> · Sipariş <span class="strong">${esc(g.order.order_number)}</span>`
                : `<span class="strong">${esc(g.custName)}</span> · <span class="pill warn">Dağıtılmamış — müşteri avansı</span>`;
            const remaining = g.kind === 'order' ? Number(g.order.remaining_balance) || 0 : null;
            const head = `<tr class="grp-head" data-act="toggle-cust" data-id="${esc(g.key)}">
                <td><i class="fa-solid fa-chevron-${open ? 'down' : 'right'}" style="font-size:10px;color:var(--ink-3);"></i></td>
                <td>${title} <span class="pill neutral">${g.entries.length} ödeme</span></td>
                <td class="muted" style="font-size:11.5px;">${g.last ? 'son ' + dateTr(g.last) : 'tarihsiz'}</td>
                <td class="num strong">${money(g.total, cur)}${g.kind === 'order' ? `<div class="muted" style="font-size:10.5px;font-weight:400;">sipariş ${money(g.order.total_amount, cur)}</div>` : ''}</td>
                <td colspan="2"></td>
                <td class="num">${remaining === null ? '' : remaining > 0.005 ? `<span class="pill warn">${money(remaining, cur)}</span>` : '<span class="pill ok">Kapandı</span>'}</td>
                <td></td>
            </tr>`;
            if (!open) return head;
            return head + g.entries.map(e => {
                const p = e.p;
                const fx = p.received_currency ? `<div class="muted" style="font-size:11px;">gelen ${money(p.received_amount, p.received_currency)}${p.fx_rate ? ' @ ' + fmtNum(p.fx_rate, 4) : ''}</div>` : '';
                const allocs = paymentAllocations(p.id);
                const cash = allocs.reduce((s, a) => s + (Number(a.amount) || 0), 0);
                const unallocated = round2((Number(p.amount) || 0) - cash);
                const others = allocs.filter(a => a !== e.a).map(a => S.orderById.get(a.order_id)?.order_number).filter(Boolean);
                const sharedNote = e.shared || Math.abs(Number(p.amount) - e.amount) > 0.005
                    ? `<div class="muted" style="font-size:10.5px;">tahsilatın tamamı ${money(p.amount, p.currency)}${others.length ? ' · diğer: ' + others.map(esc).join(', ') : ''}</div>` : '';
                const datable = p.is_opening && p.method !== 'Mahsup' && allocs.length === 1 && !Number(allocs[0].write_off_amount);
                return `<tr class="grp-row">
                    <td></td>
                    <td></td>
                    <td class="nowrap">${p.is_opening ? '<span class="pill neutral">Tarihsiz</span>' : dateTr(p.payment_date)}</td>
                    <td class="num strong">${money(e.amount, g.currency)}${e.writeOff ? `<div class="muted" style="font-size:10.5px;">+${money(e.writeOff, g.currency)} ${esc(e.a?.write_off_type || '')}</div>` : ''}${sharedNote}${fx}</td>
                    <td style="font-size:12px;">${esc(p.method || '')}${p.bank_account ? `<div class="muted" style="font-size:11px;">${esc(p.bank_account)}</div>` : ''}</td>
                    <td style="font-size:12px;">${esc(p.reference_no || '')}${p.notes ? `<div class="muted" style="font-size:11px;">${esc(p.notes)}</div>` : ''}</td>
                    <td class="num">${g.kind === 'unalloc' ? `<span class="pill warn">${money(e.amount, g.currency)}</span>` : ''}</td>
                    <td class="nowrap" style="text-align:right;">
                        ${EDIT && datable ? `<button class="pt-btn sm" data-act="date-pay" data-id="${p.id}"><i class="fa-solid fa-calendar-plus"></i> Tarih gir</button>` : ''}
                        ${EDIT && !p.is_opening && unallocated > 0.005 ? `<button class="pt-btn sm" data-act="allocate" data-id="${p.id}"><i class="fa-solid fa-diagram-project"></i> Dağıt</button>` : ''}
                        ${EDIT && !p.is_opening ? `<button class="pt-btn sm icon danger" data-act="del-pay" data-id="${p.id}" title="Tahsilatı sil"><i class="fa-solid fa-trash"></i></button>` : ''}
                    </td>
                </tr>`;
            }).join('');
        }).join('')}</tbody>
        <tfoot><tr><td colspan="3">${list2.filter(g => g.kind === 'order').length} sipariş · ${paymentCount} tahsilat</td>
            <td class="num">${currencyLines(sumByCurrency(list2.map(g => ({ currency: g.currency, open: g.total }))))}</td><td colspan="4"></td></tr></tfoot>
    </table>`;
}

async function deletePayment(id) {
    const p = S.payments.find(x => x.id === id);
    if (!p) return;
    const cust = S.custById.get(p.customer_id)?.company_name || '';
    const ok = await showConfirmDialog(
        `${cust} · ${dateTr(p.payment_date)} · ${money(p.amount, p.currency)}\n\nBu tahsilat ve dağıtımları silinecek; ilgili siparişlerin bakiyesi yeniden açılacak.`,
        { title: 'Tahsilatı sil', variant: 'danger', confirmText: 'Sil' });
    if (!ok) return;
    const { error } = await supabase.from('payments').delete().eq('id', id);
    if (error) { await showAlertDialog('Silinemedi: ' + error.message, { variant: 'danger' }); return; }
    logChange({ ctx, moduleId: MODULE, action: 'delete', summary: `Tahsilat silindi: ${cust} ${money(p.amount, p.currency)} (${dateTr(p.payment_date)})`, details: { payment: p } });
    toast('Tahsilat silindi.');
    await loadData();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXIMBANK
// ═══════════════════════════════════════════════════════════════════════════
function eximbankRows() {
    return S.items
        .filter(i => i.eximbank && i.orderId)
        .map(item => ({
            item,
            info: eximbankInfo(item.dueDate, TODAY),
            notices: S.notices.filter(n => n.order_id === item.orderId),
        }));
}

function eximStagePill(r) {
    const { info, notices } = r;
    const vgabDone = notices.some(n => n.notice_type === 'V.G.A.B');
    const claimDone = notices.some(n => n.notice_type === 'Tazminat Başvurusu');
    if (!info) return `<span class="pill neutral">Vade yok</span>`;
    if (claimDone) return `<span class="pill ok">Tazminat başvurusu yapıldı</span>`;
    switch (info.stage) {
        case 'not-due':  return `<span class="pill neutral">Vadeye ${-info.overdueDays} gün</span>`;
        case 'overdue':  return vgabDone ? `<span class="pill ok">V.G.A.B yapıldı</span>`
                                         : `<span class="pill warn">${info.overdueDays} gün gecikti · iç son güne ${info.daysToWarn} gün</span>`;
        case 'warn':     return vgabDone ? `<span class="pill ok">V.G.A.B yapıldı</span>`
                                         : `<span class="pill danger">BİLDİRİM YAP · V.G.A.B'ye ${info.daysToVgab} gün</span>`;
        case 'vgab-late':return vgabDone ? `<span class="pill warn">Tazminat başvurusuna ${info.daysToClaim} gün</span>`
                                         : `<span class="pill danger">V.G.A.B süresi geçti!</span>`;
        default:         return `<span class="pill danger">Tazminat süresi geçti</span>`;
    }
}

function renderEximbank() {
    const insured = S.customers.filter(c => c.eximbank_insured);
    const limitsEl = document.getElementById('exim-limits');
    if (!insured.length) {
        limitsEl.innerHTML = `<div class="empty">Eximbank anlaşmalı müşteri tanımlı değil (SQL 023).</div>`;
    } else {
        limitsEl.innerHTML = insured.map(c => {
            const cur = c.eximbank_limit_currency || 'EUR';
            const limit = Number(c.eximbank_limit) || 0;
            const used = round2(S.items.filter(i => i.customerId === c.id && i.eximbank && i.currency === cur).reduce((s, i) => s + i.open, 0));
            const pend = round2(S.pending.filter(p => p.customerId === c.id && p.currency === cur).reduce((s, p) => s + p.open, 0));
            const other = S.items.filter(i => i.customerId === c.id && i.eximbank && i.currency !== cur);
            const pctUsed = limit ? Math.min(100, used / limit * 100) : 0;
            const pctPend = limit ? Math.min(100 - pctUsed, pend / limit * 100) : 0;
            const projected = limit ? (used + pend) / limit * 100 : 0;
            const color = projected > 100 ? 'var(--danger)' : projected > 85 ? 'var(--warn)' : 'var(--ok)';
            return `<div class="kpi-card" style="padding:16px 18px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div><div class="strong">${esc(c.company_name)}</div><div class="muted" style="font-size:11px;">No ${esc(c.eximbank_customer_no || '—')} · ${c.eximbank_term_days || '—'} gün</div></div>
                    <div style="text-align:right;"><div class="label-caps">Limit</div><div class="strong">${money(limit, cur)}</div></div>
                </div>
                <div class="limit-bar"><span style="width:${pctUsed}%;background:${color};"></span><span style="width:${pctPend}%;background:${color};opacity:.35;"></span></div>
                <div style="display:flex;justify-content:space-between;font-size:11.5px;">
                    <span>Faturalanmış açık: <b>${money(used, cur)}</b></span><span class="muted">%${fmtNum(limit ? used / limit * 100 : 0, 0)}</span>
                </div>
                ${pend > 0.005 ? `<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-top:2px;">
                    <span class="muted">+ sevk bekleyen: ${money(pend, cur)}</span>
                    <span style="color:${color};font-weight:600;">%${fmtNum(projected, 0)}</span></div>` : ''}
                ${projected > 100 ? `<div style="margin-top:8px;"><span class="pill danger">Sevk sonrası limit aşılır</span></div>` : projected > 85 ? `<div style="margin-top:8px;"><span class="pill warn">Limit dolmak üzere</span></div>` : ''}
                ${other.length ? `<div class="hint" style="margin-top:6px;">Limit dışı para biriminde ${other.length} kalem var.</div>` : ''}
            </div>`;
        }).join('');
    }

    const rows = eximbankRows().sort((a, b) => (a.item.dueDate || '9').localeCompare(b.item.dueDate || '9'));
    const el = document.getElementById('exim-table');
    if (!rows.length) { el.innerHTML = `<div class="empty">Eximbank kapsamında açık fatura yok.</div>`; return; }
    el.innerHTML = `<table class="data-table">
        <thead><tr>
            <th>Müşteri</th><th>Belge</th><th class="num">Açık</th><th>Vade</th>
            <th>İç son gün (+${EXIMBANK_WARN_DAYS})</th><th>V.G.A.B son (+60)</th><th>Tazminat son (+90)</th>
            <th>Durum</th><th>Bildirimler</th><th></th>
        </tr></thead>
        <tbody>${rows.map(r => {
            const { item, info, notices } = r;
            const sev = !info ? '' : ['warn', 'vgab-late', 'lost'].includes(info.stage) ? 'sev-danger' : info.stage === 'overdue' ? 'sev-warn' : '';
            const dateCell = (d, passed) => `<td class="nowrap" style="${passed ? 'color:var(--danger);font-weight:600;' : ''}">${dateTr(d)}</td>`;
            return `<tr class="${sev}">
                <td class="strong">${esc(item.customerName)}</td>
                <td>${docCell(item)}</td>
                <td class="num strong">${money(item.open, item.currency)}</td>
                <td>${dueCell(item)}</td>
                ${info ? dateCell(info.warn, TODAY > info.warn) + dateCell(info.vgab, TODAY > info.vgab) + dateCell(info.claim, TODAY > info.claim) : '<td>—</td><td>—</td><td>—</td>'}
                <td>${eximStagePill(r)}</td>
                <td style="font-size:11.5px;">${notices.length ? notices.map(n => `${esc(n.notice_type)} · ${dateTr(n.notice_date)}${n.reference_no ? ' · ' + esc(n.reference_no) : ''}${n.outcome ? ` <span class="muted">(${esc(n.outcome)})</span>` : ''}`).join('<br>') : '<span class="muted">—</span>'}</td>
                <td class="nowrap" style="text-align:right;">
                    ${EDIT && info && info.stage !== 'not-due' ? `<button class="pt-btn sm" data-act="notice" data-key="${item.key}"><i class="fa-solid fa-flag"></i> Bildirim kaydet</button>` : ''}
                    ${EDIT ? `<button class="pt-btn sm icon" data-act="remind" data-key="${item.key}" title="Hatırlatma"><i class="fa-solid fa-bell"></i></button>` : ''}
                </td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODALLAR — ortak
// ═══════════════════════════════════════════════════════════════════════════
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function initModals() {
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
    document.querySelectorAll('.modal-backdrop').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m.id); }));
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => closeModal(m.id));
    });

    // Tahsilat modalı
    initCustomerCombo();
    initDateModal();
    document.getElementById('pm-currency').addEventListener('change', () => { PM.currency = document.getElementById('pm-currency').value; pmBuildRows(); });
    document.getElementById('pm-amount').addEventListener('input', pmSummary);
    document.getElementById('pm-amount').addEventListener('blur', e => { const n = parseNum(e.target.value); if (!isNaN(n)) e.target.value = fmtNum(n); pmSummary(); });
    document.getElementById('pm-fifo').addEventListener('click', pmFifo);
    document.getElementById('pm-clear').addEventListener('click', () => { PM.rows.forEach(r => { r.alloc = 0; r.writeOff = 0; }); pmRenderRows(); });
    document.getElementById('pm-fx-toggle').addEventListener('change', e => { document.getElementById('pm-fx-box').hidden = !e.target.checked; });
    ['pm-fx-amount', 'pm-fx-rate'].forEach(id => document.getElementById(id).addEventListener('input', pmFxCalc));
    document.getElementById('pm-save').addEventListener('click', pmSave);

    document.getElementById('nm-save').addEventListener('click', saveNotice);
    document.getElementById('rm-save').addEventListener('click', saveReminder);
    initPlanModal();
    initInvoiceModal();
}

// ── Müşteri arama kutusu (serbest yazı; select'in "baş harfe atla" davranışı yerine) ──
function initCustomerCombo() {
    const input = document.getElementById('pm-customer-input');
    const listEl = document.getElementById('pm-customer-list');
    let active = -1;

    const openIds = () => new Set(S.orders.filter(o => !isCancelled(o) && Number(o.remaining_balance) > 0.005).map(o => o.customer_id));

    const render = () => {
        const q = norm(input.value.trim());
        const ids = openIds();
        let matches = S.customers.filter(c => !q || norm(c.company_name).includes(q) || norm(c.country).includes(q));
        matches.sort((a, b) => (ids.has(b.id) - ids.has(a.id)) || a.company_name.localeCompare(b.company_name, 'tr'));
        matches = matches.slice(0, 60);
        active = matches.length ? 0 : -1;
        listEl.innerHTML = matches.length
            ? matches.map((c, k) => `<div class="cb-item${k === 0 ? ' active' : ''}" data-cid="${c.id}">
                <span>${esc(c.company_name)}${c.country ? ` <span class="muted">(${esc(c.country)})</span>` : ''}</span>
                ${ids.has(c.id) ? '<span class="pill warn" style="font-size:9.5px;">açık bakiye</span>' : ''}
              </div>`).join('')
            : `<div class="cb-empty">Eşleşen müşteri yok.</div>`;
        listEl.hidden = false;
    };
    const choose = id => {
        listEl.hidden = true;
        setPmCustomer(id, true);
    };
    const move = d => {
        const items = [...listEl.querySelectorAll('.cb-item')];
        if (!items.length) return;
        active = (active + d + items.length) % items.length;
        items.forEach((it, k) => it.classList.toggle('active', k === active));
        items[active].scrollIntoView({ block: 'nearest' });
    };

    input.addEventListener('focus', () => { input.select(); render(); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (listEl.hidden) render(); else move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            const it = listEl.querySelectorAll('.cb-item')[active];
            if (it) choose(it.dataset.cid);
        } else if (e.key === 'Escape') { listEl.hidden = true; e.stopPropagation(); }
    });
    listEl.addEventListener('mousedown', e => {
        const it = e.target.closest('.cb-item');
        if (it) { e.preventDefault(); choose(it.dataset.cid); }
    });
    input.addEventListener('blur', () => {
        setTimeout(() => {
            listEl.hidden = true;
            // Yazılan metin bir müşteri değilse seçili müşterinin adına geri dön.
            const c = S.custById.get(PM.customerId);
            input.value = c ? c.company_name : '';
        }, 120);
    });
}

function setPmCustomer(id, rebuild) {
    PM.customerId = id || null;
    const c = S.custById.get(PM.customerId);
    document.getElementById('pm-customer-input').value = c ? c.company_name : '';
    if (rebuild) { pmPickCurrency(); pmBuildRows(); }
}

// ═══════════════════════════════════════════════════════════════════════════
// TAHSİLAT MODALI
// ═══════════════════════════════════════════════════════════════════════════
const PM = { mode: 'new', payment: null, customerId: null, currency: 'EUR', rows: [] };

function openPaymentModal({ item = null, payment = null }) {
    if (!EDIT) return;
    PM.mode = payment ? 'allocate' : 'new';
    PM.payment = payment;

    const header = document.getElementById('pm-header-fields');
    const existing = document.getElementById('pm-existing');

    if (payment) {
        const allocs = paymentAllocations(payment.id);
        const unallocated = round2(Number(payment.amount) - allocs.reduce((s, a) => s + (Number(a.amount) || 0), 0));
        PM.customerId = payment.customer_id;
        PM.currency = payment.currency;
        header.hidden = true;
        existing.hidden = false;
        existing.innerHTML = `<div class="alloc-summary" style="margin:0;">
            <span>Müşteri: <b>${esc(S.custById.get(payment.customer_id)?.company_name || '—')}</b></span>
            <span>Tahsilat: <b>${dateTr(payment.payment_date)} · ${money(payment.amount, payment.currency)}</b></span>
            <span>Dağıtılmamış (müşteri avansı): <b>${money(unallocated, payment.currency)}</b></span>
        </div>`;
        document.getElementById('pm-title').innerHTML = `<i class="fa-solid fa-diagram-project" style="color:var(--accent);"></i> Avansı dağıt / mahsup et`;
        document.getElementById('pm-amount').value = fmtNum(unallocated);
    } else {
        header.hidden = false;
        existing.hidden = true;
        document.getElementById('pm-title').innerHTML = `<i class="fa-solid fa-money-bill-transfer" style="color:var(--accent);"></i> Tahsilat Gir`;
        PM.customerId = item?.customerId || null;
        PM.currency = item?.currency || 'EUR';
        setPmCustomer(PM.customerId, false);
        document.getElementById('pm-date').value = TODAY;
        document.getElementById('pm-currency').value = PM.currency;
        document.getElementById('pm-amount').value = item ? fmtNum(item.open) : '';
        document.getElementById('pm-method').value = 'T/T';
        document.getElementById('pm-bank').value = '';
        document.getElementById('pm-ref').value = '';
        document.getElementById('pm-notes').value = '';
        document.getElementById('pm-fx-toggle').checked = false;
        document.getElementById('pm-fx-box').hidden = true;
        ['pm-fx-amount', 'pm-fx-rate', 'pm-fx-note'].forEach(id => { document.getElementById(id).value = ''; });
        const banks = [...new Set(S.payments.map(p => p.bank_account).filter(Boolean))];
        document.getElementById('pm-bank-list').innerHTML = banks.map(b => `<option value="${esc(b)}">`).join('');
        if (!item && PM.customerId) pmPickCurrency();
    }

    pmBuildRows();
    if (item) {
        const row = PM.rows.find(r => r.orderId === item.orderId);
        if (row) row.alloc = Math.min(row.open, item.open);
        pmRenderRows();
    }
    openModal('payment-modal');
}

function pmPickCurrency() {
    if (!PM.customerId) return;
    const counts = {};
    S.orders.filter(o => o.customer_id === PM.customerId && !isCancelled(o) && Number(o.remaining_balance) > 0.005)
        .forEach(o => { counts[o.currency] = (counts[o.currency] || 0) + 1; });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) { PM.currency = best; document.getElementById('pm-currency').value = best; }
}

function pmBuildRows() {
    const rows = [];
    if (PM.customerId) {
        S.orders
            .filter(o => o.customer_id === PM.customerId && o.currency === PM.currency && !isCancelled(o) && Number(o.remaining_balance) > 0.005)
            .forEach(o => {
                const its = S.items.filter(i => i.orderId === o.id);
                const pend = S.pending.find(p => p.orderId === o.id);
                const due = its.map(i => i.dueDate).filter(Boolean).sort()[0] || o.due_date || null;
                const docs = its.filter(i => i.docNo).map(i => i.docNo);
                const sub = [docs.length ? docs.join(', ') : (its.length ? 'faturası girilmemiş sevk' : ''), pend ? 'faturalanmamış bakiye var' : ''].filter(Boolean).join(' · ');
                rows.push({ key: `o:${o.id}`, orderId: o.id, label: `Sipariş ${o.order_number || '—'}`, sub, due, docDate: its[0]?.docDate || o.order_date, open: round2(Number(o.remaining_balance)), alloc: 0, writeOff: 0, writeOffType: 'Banka Kesintisi' });
            });
    }
    rows.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.docDate || '').localeCompare(b.docDate || ''));
    PM.rows = rows;
    pmRenderRows();
    pmRenderArchive();
}

function pmRenderRows() {
    const el = document.getElementById('pm-alloc');
    if (!PM.customerId) {
        el.innerHTML = `<div class="empty">Önce müşteri seçin.</div>`;
        pmSummary();
        return;
    }
    if (!PM.rows.length) {
        el.innerHTML = `<div class="empty">Bu müşterinin ${PM.currency} cinsinden açık bakiyesi yok. Kaydederseniz tutarın tamamı müşteri avansı olarak bekler.</div>`;
        pmSummary();
        return;
    }
    el.innerHTML = `<table class="data-table alloc-table">
        <thead><tr><th>Belge</th><th>Vade</th><th class="num">Açık</th><th class="num" style="width:140px;">Nakit dağıt</th><th class="num" style="width:120px;">Kesinti</th><th style="width:150px;">Kesinti türü</th><th class="num">Kalan</th></tr></thead>
        <tbody>${PM.rows.map((r, idx) => {
            const left = round2(r.open - r.alloc - r.writeOff);
            const overdue = r.due && r.due < TODAY;
            return `<tr>
                <td><div class="strong">${esc(r.label)}</div>${r.sub ? `<div class="muted" style="font-size:11px;">${esc(r.sub)}</div>` : ''}</td>
                <td class="nowrap" style="${overdue ? 'color:var(--danger);' : ''}">${r.due ? dateTr(r.due) : '<span class="muted">vadesiz</span>'}</td>
                <td class="num">${fmtNum(r.open)}</td>
                <td><input class="pt-input num" data-row="${idx}" data-f="alloc" value="${r.alloc ? fmtNum(r.alloc) : ''}" placeholder="0,00"></td>
                <td><input class="pt-input num" data-row="${idx}" data-f="writeOff" value="${r.writeOff ? fmtNum(r.writeOff) : ''}" placeholder="0,00"></td>
                <td><select class="pt-select" data-row="${idx}" data-f="writeOffType">${WRITE_OFF_TYPES.map(t => `<option ${t === r.writeOffType ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
                <td class="num ${left < -0.005 ? '' : 'muted'}" style="${left < -0.005 ? 'color:var(--danger);font-weight:600;' : ''}" data-left="${idx}">${fmtNum(left)}</td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
    el.querySelectorAll('[data-row]').forEach(inp => {
        const handler = () => {
            const r = PM.rows[Number(inp.dataset.row)];
            if (inp.dataset.f === 'writeOffType') { r.writeOffType = inp.value; return; }
            const n = parseNum(inp.value);
            r[inp.dataset.f] = isNaN(n) ? 0 : round2(n);
            const leftCell = el.querySelector(`[data-left="${inp.dataset.row}"]`);
            const left = round2(r.open - r.alloc - r.writeOff);
            leftCell.textContent = fmtNum(left);
            leftCell.style.color = left < -0.005 ? 'var(--danger)' : '';
            pmSummary();
        };
        inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', handler);
        if (inp.tagName !== 'SELECT') inp.addEventListener('blur', () => { const n = parseNum(inp.value); inp.value = isNaN(n) || !n ? '' : fmtNum(n); });
    });
    pmSummary();
}

function pmAmount() {
    const n = parseNum(document.getElementById('pm-amount').value);
    return isNaN(n) ? 0 : round2(n);
}

function pmSummary() {
    const amount = pmAmount();
    const cash = round2(PM.rows.reduce((s, r) => s + r.alloc, 0));
    const wo = round2(PM.rows.reduce((s, r) => s + r.writeOff, 0));
    const rest = round2(amount - cash);
    const cur = PM.currency;
    document.getElementById('pm-summary').innerHTML = `
        <span>${PM.mode === 'allocate' ? 'Dağıtılacak avans' : 'Tahsilat'}: <b>${money(amount, cur)}</b></span>
        <span>Nakit dağıtılan: <b>${money(cash, cur)}</b></span>
        <span>Kesinti (bakiyeyi kapatan): <b>${money(wo, cur)}</b></span>
        <span style="${rest < -0.005 ? 'color:var(--danger);' : ''}">Dağıtılmayan${rest > 0.005 ? ' (müşteri avansı)' : ''}: <b>${money(rest, cur)}</b></span>`;
}

function pmFifo() {
    let left = pmAmount();
    PM.rows.forEach(r => {
        const room = Math.max(0, round2(r.open - r.writeOff));
        const give = Math.max(0, Math.min(room, left));
        r.alloc = round2(give);
        left = round2(left - give);
    });
    pmRenderRows();
}

function pmFxCalc() {
    const recv = parseNum(document.getElementById('pm-fx-amount').value);
    const rate = parseNum(document.getElementById('pm-fx-rate').value);
    if (!isNaN(recv) && !isNaN(rate) && rate > 0) {
        document.getElementById('pm-amount').value = fmtNum(round2(recv / rate));
        pmSummary();
    }
}

async function pmSave() {
    const btn = document.getElementById('pm-save');
    const amount = pmAmount();
    const cur = PM.currency;
    const allocRows = PM.rows.filter(r => Math.abs(r.alloc) > 0.005 || Math.abs(r.writeOff) > 0.005);
    const cash = round2(allocRows.reduce((s, r) => s + r.alloc, 0));

    // ── Doğrulama ──
    if (PM.mode === 'new') {
        if (!PM.customerId) return showAlertDialog('Lütfen müşteri seçin.', { variant: 'warn', title: 'Eksik bilgi' });
        if (!document.getElementById('pm-date').value) return showAlertDialog('Valör tarihi gerekli.', { variant: 'warn', title: 'Eksik bilgi' });
        if (!amount) return showAlertDialog('Tahsilat tutarı girin.', { variant: 'warn', title: 'Eksik bilgi' });
    } else if (amount <= 0) {
        return showAlertDialog('Dağıtılacak tutar yok.', { variant: 'warn' });
    }
    if (amount > 0 && cash - amount > 0.005) {
        return showAlertDialog(`Dağıtılan nakit (${money(cash, cur)}) tahsilat tutarını (${money(amount, cur)}) aşıyor.`, { variant: 'warn', title: 'Dağıtım hatası' });
    }
    const over = allocRows.find(r => r.alloc > 0 && round2(r.alloc + r.writeOff) - r.open > 0.005);
    if (over) {
        return showAlertDialog(`${over.label}: dağıtılan + kesinti (${money(over.alloc + over.writeOff, cur)}) açık bakiyeyi (${money(over.open, cur)}) aşıyor.`, { variant: 'warn', title: 'Dağıtım hatası' });
    }
    const rest = round2(amount - cash);
    if (amount > 0 && rest > 0.005) {
        const ok = await showConfirmDialog(
            `${money(rest, cur)} hiçbir belgeye dağıtılmadı.\n\nBu tutar müşteri avansı olarak bekleyecek; sonra Tahsilatlar sekmesinden "Dağıt" ile sonraki siparişe mahsup edebilirsiniz.`,
            { title: 'Dağıtılmayan tutar', variant: 'warn', confirmText: 'Böyle kaydet' });
        if (!ok) return;
    }

    btn.disabled = true;
    try {
        let paymentId = PM.payment?.id;
        let paymentRow = PM.payment;

        if (PM.mode === 'new') {
            const fxOn = document.getElementById('pm-fx-toggle').checked;
            const fxAmount = parseNum(document.getElementById('pm-fx-amount').value);
            const fxRate = parseNum(document.getElementById('pm-fx-rate').value);
            const payload = {
                user_id: ctx.ownerId,
                customer_id: PM.customerId,
                payment_date: document.getElementById('pm-date').value,
                currency: cur,
                amount,
                method: document.getElementById('pm-method').value || null,
                bank_account: document.getElementById('pm-bank').value.trim() || null,
                reference_no: document.getElementById('pm-ref').value.trim() || null,
                notes: document.getElementById('pm-notes').value.trim() || null,
                received_currency: fxOn ? document.getElementById('pm-fx-currency').value : null,
                received_amount: fxOn && !isNaN(fxAmount) ? round2(fxAmount) : null,
                fx_rate: fxOn && !isNaN(fxRate) ? fxRate : null,
                fx_note: fxOn ? (document.getElementById('pm-fx-note').value.trim() || null) : null,
                created_by: ctx.userId,
            };
            const { data, error } = await supabase.from('payments').insert([payload]).select().single();
            if (error) throw error;
            paymentId = data.id;
            paymentRow = data;
        }

        if (allocRows.length) {
            const allocPayload = allocRows.map(r => ({
                payment_id: paymentId,
                order_id: r.orderId,
                amount: round2(r.alloc),
                write_off_amount: round2(r.writeOff),
                write_off_type: Math.abs(r.writeOff) > 0.005 ? r.writeOffType : null,
            }));
            const { error } = await supabase.from('payment_allocations').insert(allocPayload);
            if (error) {
                // Yeni tahsilatta dağıtım yazılamadıysa yarım kayıt bırakma.
                if (PM.mode === 'new') await supabase.from('payments').delete().eq('id', paymentId);
                throw error;
            }
        }

        const custName = S.custById.get(paymentRow.customer_id)?.company_name || '';
        const targets = allocRows.map(r => `${r.label} ${fmtNum(r.alloc)}${r.writeOff ? ` (+${fmtNum(r.writeOff)} ${r.writeOffType})` : ''}`).join(', ');
        logChange({
            ctx, moduleId: MODULE, action: PM.mode === 'new' ? 'create' : 'update',
            summary: PM.mode === 'new'
                ? `Tahsilat: ${custName} ${money(amount, cur)} (${dateTr(paymentRow.payment_date)})${targets ? ' → ' + targets : ''}`
                : `Avans dağıtıldı: ${custName} ${money(cash, cur)} → ${targets}`,
            details: { payment_id: paymentId, allocations: allocRows },
        });

        closeModal('payment-modal');
        toast(PM.mode === 'new' ? 'Tahsilat kaydedildi.' : 'Avans dağıtıldı.');
        await loadData();
    } catch (e) {
        console.error(e);
        showAlertDialog('Kaydedilemedi: ' + e.message, { variant: 'danger', title: 'Hata' });
    } finally {
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXIMBANK BİLDİRİM MODALI
// ═══════════════════════════════════════════════════════════════════════════
let NM_ITEM = null;

function openNoticeModal(item) {
    if (!item || !EDIT) return;
    NM_ITEM = item;
    const info = eximbankInfo(item.dueDate, TODAY);
    const hasVgab = S.notices.some(n => n.order_id === item.orderId && n.notice_type === 'V.G.A.B');
    document.getElementById('nm-context').innerHTML = `
        <b>${esc(item.customerName)}</b> · Sipariş ${esc(item.orderNumber)} ${item.docNo ? '· ' + esc(item.docNo) : ''}<br>
        Açık: <b>${money(item.open, item.currency)}</b> · Vade ${dateTr(item.dueDate)}
        ${info ? `· V.G.A.B son günü <b>${dateTr(info.vgab)}</b> · Tazminat son günü <b>${dateTr(info.claim)}</b>` : ''}`;
    document.getElementById('nm-type').value = hasVgab || info?.stage === 'vgab-late' ? 'Tazminat Başvurusu' : 'V.G.A.B';
    document.getElementById('nm-date').value = TODAY;
    document.getElementById('nm-ref').value = '';
    document.getElementById('nm-outcome').value = 'Beklemede';
    document.getElementById('nm-notes').value = '';
    openModal('notice-modal');
}

async function saveNotice() {
    const item = NM_ITEM;
    if (!item) return;
    const date = document.getElementById('nm-date').value;
    if (!date) return showAlertDialog('Bildirim tarihi gerekli.', { variant: 'warn' });
    const payload = {
        user_id: ctx.ownerId,
        order_id: item.orderId,
        notice_type: document.getElementById('nm-type').value,
        notice_date: date,
        reference_no: document.getElementById('nm-ref').value.trim() || null,
        amount: item.open,
        currency: item.currency,
        outcome: document.getElementById('nm-outcome').value || null,
        notes: document.getElementById('nm-notes').value.trim() || null,
    };
    const { error } = await supabase.from('eximbank_notices').insert([payload]);
    if (error) return showAlertDialog('Kaydedilemedi: ' + error.message, { variant: 'danger' });
    logChange({ ctx, moduleId: MODULE, action: 'create', summary: `Eximbank ${payload.notice_type}: ${item.customerName} sipariş ${item.orderNumber} (${money(item.open, item.currency)})`, details: payload });
    closeModal('notice-modal');
    toast('Eximbank bildirimi kaydedildi.');
    await loadData();
}

// ═══════════════════════════════════════════════════════════════════════════
// HATIRLATMA MODALI
// ═══════════════════════════════════════════════════════════════════════════
let RM_ITEM = null;

function openReminderModal(item) {
    if (!item || !EDIT) return;
    RM_ITEM = item;
    document.getElementById('rm-context').innerHTML = `<b>${esc(item.customerName)}</b> · Sipariş ${esc(item.orderNumber)}
        · Açık <b>${money(item.open, item.currency)}</b>${item.dueDate ? ` · Vade ${dateTr(item.dueDate)}` : ''}`;
    document.getElementById('rm-date').value = TODAY;
    document.getElementById('rm-channel').value = 'E-posta';
    document.getElementById('rm-promised').value = '';
    document.getElementById('rm-next').value = addDays(TODAY, 7);
    document.getElementById('rm-summary').value = '';

    const history = S.reminders.filter(r => r.order_id === item.orderId);
    document.getElementById('rm-history').innerHTML = history.length ? `
        <div class="section-title" style="margin-bottom:6px;"><i class="fa-solid fa-clock-rotate-left"></i> Önceki hatırlatmalar</div>
        ${history.map(r => `<div style="font-size:12px;padding:7px 0;border-top:1px solid var(--border-soft);">
            <b>${dateTr(r.reminder_date)}</b> · ${esc(r.channel || '')}${r.promised_date ? ` · söz: <b>${dateTr(r.promised_date)}</b>` : ''}
            ${r.summary ? `<div class="muted">${esc(r.summary)}</div>` : ''}
        </div>`).join('')}` : '';
    openModal('reminder-modal');
}

async function saveReminder() {
    const item = RM_ITEM;
    if (!item) return;
    const payload = {
        user_id: ctx.ownerId,
        customer_id: item.customerId,
        order_id: item.orderId,
        reminder_date: document.getElementById('rm-date').value || TODAY,
        channel: document.getElementById('rm-channel').value || null,
        summary: document.getElementById('rm-summary').value.trim() || null,
        promised_date: document.getElementById('rm-promised').value || null,
        next_action_date: document.getElementById('rm-next').value || null,
        created_by: ctx.userId,
    };
    const { error } = await supabase.from('collection_reminders').insert([payload]);
    if (error) return showAlertDialog('Kaydedilemedi: ' + error.message, { variant: 'danger' });
    logChange({ ctx, moduleId: MODULE, action: 'create', summary: `Hatırlatma: ${item.customerName} sipariş ${item.orderNumber} (${payload.channel || ''})`, details: payload });
    closeModal('reminder-modal');
    toast('Hatırlatma kaydedildi.');
    await loadData();
}

// ═══════════════════════════════════════════════════════════════════════════
// MANUEL ALACAKLAR — manuel takibe alınmış sistem siparişleri (SQL 034)
// ═══════════════════════════════════════════════════════════════════════════
function renderManual() {
    const groups = new Map();
    [...S.manualItems, ...S.manualPending].forEach(x => {
        if (!groups.has(x.orderId)) groups.set(x.orderId, { items: [], pending: null });
        const g = groups.get(x.orderId);
        if (x.key.startsWith('pend:')) g.pending = x; else g.items.push(x);
    });
    document.getElementById('cnt-manual').textContent = groups.size;

    let list = [...groups.entries()].map(([orderId, g]) => {
        const o = S.orderById.get(orderId);
        const first = g.items[0] || g.pending;
        const plan = S.plans.find(p => p.order_id === orderId && p.status === 'Aktif') || null;
        const open = round2(g.items.reduce((s, i) => s + i.open, 0) + (g.pending?.open || 0));
        // Ödeme tarihi belli değil: vade yerine alacağın ne kadar süredir beklediği gösterilir.
        const since = g.items.map(i => i.docDate).filter(Boolean).sort()[0] || o.shipment_date || o.order_date;
        const lastRem = S.reminders.filter(x => x.order_id === orderId)
            .sort((a, b) => (b.reminder_date || '').localeCompare(a.reminder_date || ''))[0] || null;
        return { orderId, o, g, first, plan, open, since, lastRem, currency: o.currency, customerName: first.customerName };
    });
    if (F.manSearch) {
        list = list.filter(r => [r.customerName, r.o.order_number, r.o.manual_tracking_note, ...r.g.items.map(i => i.docNo)]
            .some(v => String(v || '').toLocaleLowerCase('tr-TR').includes(F.manSearch)));
    }
    list.sort((a, b) => byCustomer(a, b) || (a.o.order_number || '').localeCompare(b.o.order_number || ''));

    const el = document.getElementById('manual-list');
    if (!list.length) {
        el.innerHTML = `<div class="section-card"><div class="empty">Manuel takipte sipariş yok.</div></div>`;
        return;
    }

    el.innerHTML = `<div class="section-card"><div class="pt-table-wrap"><table class="data-table">
        <thead><tr>
            <th>Müşteri / Sipariş</th><th>Belgeler</th><th>Bekliyor</th><th class="num">Açık bakiye</th>
            <th style="min-width:220px;">Not</th><th>Son hatırlatma</th><th></th>
        </tr></thead>
        <tbody>${list.map(manualRow).join('')}</tbody>
        <tfoot><tr><td colspan="3">${list.length} sipariş</td><td class="num">${currencyLines(sumByCurrency(list))}</td><td colspan="3"></td></tr></tfoot>
    </table></div></div>`;
}

function manualRow(r) {
    const { o, g, first, plan, lastRem } = r;
    const cur = o.currency;
    const waited = r.since ? daysBetween(r.since, TODAY) : null;

    const docs = [
        ...g.items.map(i => i.kind === 'order'
            ? `<div class="muted">Faturası girilmemiş sevk</div>`
            : `<div>${esc(i.docNo || '')} <span class="muted">· ${dateTr(i.docDate)}</span></div>`),
        g.pending ? `<div><span class="pill neutral">Faturalanmamış ${money(g.pending.open, cur)}</span></div>` : '',
    ].join('');

    let planCell = '';
    if (plan) {
        const insts = installmentStatus(plan.payment_plan_installments || [], planPaidAmount(plan), TODAY);
        const next = insts.find(i => i.state !== 'paid');
        const expanded = F.manExpanded.has(o.id);
        planCell = `<div style="margin-top:6px;">
            <a href="javascript:void(0)" data-act="toggle-plan" data-id="${o.id}" class="pill info" style="text-decoration:none;">
                <i class="fa-solid fa-list-ol"></i> Ödeme planı${next ? ` · ${next.seq}. taksit ${dateTr(next.due_date)} · ${money(next.open, cur)}` : ' · tamamlandı'}
                <i class="fa-solid fa-chevron-${expanded ? 'up' : 'down'}" style="font-size:9px;"></i>
            </a></div>`;
    }

    const row = `<tr>
        <td><div class="strong">${esc(r.customerName)}</div><div class="muted" style="font-size:11.5px;">Sipariş ${esc(o.order_number)}</div>${planCell}</td>
        <td style="font-size:12px;">${docs}</td>
        <td class="nowrap">${waited !== null ? `${waited} gün` : '—'}<div class="muted" style="font-size:11px;">${dateTr(r.since)}'den beri</div></td>
        <td class="num strong">${money(r.open, cur)}</td>
        <td style="font-size:12px;white-space:pre-line;">${o.manual_tracking_note ? esc(o.manual_tracking_note) : '<span class="muted">—</span>'}</td>
        <td style="font-size:11.5px;">${lastRem
            ? `${dateTr(lastRem.reminder_date)} · ${esc(lastRem.channel || '')}${lastRem.promised_date ? `<div class="muted">söz: ${dateTr(lastRem.promised_date)}</div>` : ''}${lastRem.summary ? `<div class="muted">${esc(lastRem.summary)}</div>` : ''}`
            : '<span class="muted">—</span>'}</td>
        <td class="nowrap" style="text-align:right;">${EDIT ? `
            <button class="pt-btn sm" data-act="pay" data-key="${first.key}" title="Tahsilat gir"><i class="fa-solid fa-plus"></i> Tahsilat</button>
            <button class="pt-btn sm icon" data-act="invoices" data-id="${o.id}" title="Sipariş faturaları"><i class="fa-solid fa-file-invoice"></i></button>
            <button class="pt-btn sm icon" data-act="edit-note" data-id="${o.id}" title="Notu düzenle"><i class="fa-solid fa-pen"></i></button>
            <button class="pt-btn sm icon" data-act="remind" data-key="${first.key}" title="Hatırlatma kaydet"><i class="fa-solid fa-bell"></i></button>
            <button class="pt-btn sm icon" data-act="plan" data-id="${o.id}" title="${plan ? 'Ödeme planını düzenle' : 'Ödeme planı ekle (isteğe bağlı)'}"><i class="fa-solid fa-list-ol"></i></button>
            <button class="pt-btn sm icon" data-act="from-manual" data-id="${o.id}" title="Açık Alacaklar'a geri al"><i class="fa-solid fa-rotate-left"></i></button>` : ''}
        </td>
    </tr>`;

    if (!plan || !F.manExpanded.has(o.id)) return row;

    const insts = installmentStatus(plan.payment_plan_installments || [], planPaidAmount(plan), TODAY);
    const statePill = i => i.state === 'paid' ? '<span class="pill ok">Ödendi</span>'
        : i.late ? `<span class="pill danger">${-i.daysToDue} gün gecikti</span>`
        : i.state === 'partial' ? '<span class="pill warn">Kısmi</span>'
        : i.daysToDue <= 30 ? `<span class="pill warn">${i.daysToDue} gün kaldı</span>`
        : '<span class="pill neutral">Bekliyor</span>';
    return row + `<tr><td colspan="7" style="background:var(--surface-2);padding:10px 18px 14px !important;">
        <div class="muted" style="font-size:11.5px;margin-bottom:6px;"><b>${esc(plan.title || 'Ödeme planı')}</b>${plan.agreed_date ? ' · anlaşma ' + dateTr(plan.agreed_date) : ''}${plan.notes ? ' · ' + esc(plan.notes) : ''}</div>
        <table class="data-table" style="max-width:640px;background:var(--surface);">
            <thead><tr><th>#</th><th>Vade</th><th class="num">Taksit</th><th class="num">Kalan</th><th>Durum</th></tr></thead>
            <tbody>${insts.map(i => `<tr>
                <td>${i.seq}</td><td class="nowrap">${dateTr(i.due_date)}</td>
                <td class="num">${money(i.amount, cur)}</td>
                <td class="num ${i.open > 0.005 ? 'strong' : 'muted'}">${money(i.open, cur)}</td>
                <td>${statePill(i)}</td>
            </tr>`).join('')}</tbody>
        </table>
    </td></tr>`;
}

async function editManualNote(orderId) {
    const o = S.orderById.get(orderId);
    if (!o || !EDIT) return;
    const name = S.custById.get(o.customer_id)?.company_name || '';
    const note = await showPromptDialog(`${name} · Sipariş ${o.order_number}`, o.manual_tracking_note || '', { title: 'Not', confirmText: 'Kaydet' });
    if (note === null) return;
    const { error } = await supabase.rpc('set_order_manual_tracking', { p_order_id: orderId, p_on: true, p_note: note.trim() });
    if (error) return showAlertDialog('Kaydedilemedi: ' + error.message, { variant: 'danger' });
    logChange({ ctx, moduleId: MODULE, action: 'update', summary: `Manuel takip notu: ${name} sipariş ${o.order_number} — ${note.trim() || '(silindi)'}` });
    toast('Not kaydedildi.');
    await loadData();
}

async function moveToManual(item) {
    if (!item || !EDIT) return;
    const note = await showPromptDialog(
        `${item.customerName} · Sipariş ${item.orderNumber}\n\nAlacak, ödeme tarihi belli olmayan alacakların serbest takibine (Manuel Alacaklar) taşınacak; vade uyarıları bu sipariş için kapanır. İsterseniz kısa bir not yazın.`,
        '', { title: "Manuel Alacaklar'a taşı", confirmText: 'Taşı' });
    if (note === null) return;
    const { error } = await supabase.rpc('set_order_manual_tracking', { p_order_id: item.orderId, p_on: true, p_note: note.trim() || null });
    if (error) return showAlertDialog('Taşınamadı: ' + error.message + '\n\n(SQL 034 çalıştırılmış olmalı.)', { variant: 'danger' });
    logChange({ ctx, moduleId: MODULE, action: 'update', summary: `Manuel takibe alındı: ${item.customerName} sipariş ${item.orderNumber}${note.trim() ? ' — ' + note.trim() : ''}` });
    toast("Manuel Alacaklar'a taşındı.");
    await loadData();
}

async function moveFromManual(orderId) {
    const o = S.orderById.get(orderId);
    if (!o || !EDIT) return;
    const name = S.custById.get(o.customer_id)?.company_name || '';
    const ok = await showConfirmDialog(`${name} · Sipariş ${o.order_number}\n\nSipariş normal vade takibine (Açık Alacaklar) geri dönecek. Ödeme planı varsa silinmez.`,
        { title: "Açık Alacaklar'a geri al", confirmText: 'Geri al' });
    if (!ok) return;
    const { error } = await supabase.rpc('set_order_manual_tracking', { p_order_id: orderId, p_on: false, p_note: null });
    if (error) return showAlertDialog('İşlem yapılamadı: ' + error.message, { variant: 'danger' });
    logChange({ ctx, moduleId: MODULE, action: 'update', summary: `Manuel takipten çıkarıldı: ${name} sipariş ${o.order_number}` });
    toast("Açık Alacaklar'a geri alındı.");
    await loadData();
}

// ═══════════════════════════════════════════════════════════════════════════
// ÖDEME PLANI MODALI
// ═══════════════════════════════════════════════════════════════════════════
const PL = { order: null, plan: null, rows: [] };

function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, last));
    return target.toISOString().slice(0, 10);
}

function initPlanModal() {
    document.getElementById('pl-generate').addEventListener('click', () => {
        const total = parseNum(document.getElementById('pl-gen-total').value);
        const count = parseInt(document.getElementById('pl-gen-count').value, 10);
        const first = document.getElementById('pl-gen-first').value;
        if (isNaN(total) || total <= 0 || !count || count < 1 || !first) {
            return showAlertDialog('Toplam tutar, taksit sayısı ve ilk taksit tarihi gerekli.', { variant: 'warn', title: 'Eksik bilgi' });
        }
        const each = Math.floor(total / count * 100) / 100;
        const firstAmount = round2(total - each * (count - 1));
        PL.rows = Array.from({ length: count }, (_, k) => ({ due_date: addMonths(first, k), amount: k === 0 ? firstAmount : each }));
        plRenderRows();
    });
    document.getElementById('pl-add-row').addEventListener('click', () => {
        const last = PL.rows[PL.rows.length - 1];
        PL.rows.push({ due_date: last ? addMonths(last.due_date, 1) : TODAY, amount: last ? last.amount : 0 });
        plRenderRows();
    });
    document.getElementById('pl-save').addEventListener('click', savePlan);
    document.getElementById('pl-delete').addEventListener('click', deletePlan);
}

function openPlanModal(orderId) {
    if (!EDIT) return;
    const o = S.orderById.get(orderId);
    if (!o) return;
    PL.order = o;
    PL.plan = S.plans.find(p => p.order_id === orderId && p.status === 'Aktif') || null;
    PL.rows = (PL.plan?.payment_plan_installments || [])
        .slice().sort((a, b) => a.seq - b.seq)
        .map(i => ({ due_date: i.due_date, amount: Number(i.amount) }));

    const name = S.custById.get(o.customer_id)?.company_name || '';
    document.getElementById('pl-context').innerHTML = `
        <span>Müşteri: <b>${esc(name)}</b></span>
        <span>Sipariş: <b>${esc(o.order_number)}</b></span>
        <span>Sipariş tutarı: <b>${money(o.total_amount, o.currency)}</b></span>
        <span>Açık bakiye: <b>${money(o.remaining_balance, o.currency)}</b></span>`;
    document.getElementById('pl-title').value = PL.plan?.title || `${name.toLocaleUpperCase('tr-TR')} ÖDEME PLANI`;
    document.getElementById('pl-agreed').value = PL.plan?.agreed_date || TODAY;
    document.getElementById('pl-notes').value = PL.plan?.notes || '';
    document.getElementById('pl-gen-total').value = fmtNum(o.remaining_balance);
    document.getElementById('pl-gen-first').value = addMonths(TODAY, 1);
    document.getElementById('pl-delete').hidden = !PL.plan;
    plRenderRows();
    openModal('plan-modal');
}

function plRenderRows() {
    const cur = PL.order.currency;
    const el = document.getElementById('pl-rows');
    el.innerHTML = PL.rows.length ? `<table class="data-table alloc-table">
        <thead><tr><th style="width:50px;">#</th><th>Vade</th><th class="num">Tutar (${cur})</th><th style="width:40px;"></th></tr></thead>
        <tbody>${PL.rows.map((r, k) => `<tr>
            <td>${k + 1}</td>
            <td><input type="date" class="pt-input" data-pl="${k}" data-f="due_date" value="${r.due_date || ''}"></td>
            <td><input class="pt-input num" data-pl="${k}" data-f="amount" value="${fmtNum(r.amount)}"></td>
            <td><button class="pt-btn sm icon danger" data-pl-del="${k}" title="Sil"><i class="fa-solid fa-xmark"></i></button></td>
        </tr>`).join('')}</tbody></table>` : `<div class="empty">Henüz taksit yok. Yukarıdan otomatik oluşturun ya da "Taksit ekle" ile tek tek girin.</div>`;

    el.querySelectorAll('[data-pl]').forEach(inp => inp.addEventListener(inp.type === 'date' ? 'change' : 'input', () => {
        const row = PL.rows[Number(inp.dataset.pl)];
        if (inp.dataset.f === 'due_date') row.due_date = inp.value;
        else { const n = parseNum(inp.value); row.amount = isNaN(n) ? 0 : round2(n); }
        plSummary();
    }));
    el.querySelectorAll('[data-pl]').forEach(inp => {
        if (inp.dataset.f === 'amount') inp.addEventListener('blur', () => { inp.value = fmtNum(PL.rows[Number(inp.dataset.pl)].amount); });
    });
    el.querySelectorAll('[data-pl-del]').forEach(b => b.addEventListener('click', () => {
        PL.rows.splice(Number(b.dataset.plDel), 1);
        plRenderRows();
    }));
    plSummary();
}

function plSummary() {
    const cur = PL.order.currency;
    const total = round2(PL.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const open = round2(Number(PL.order.remaining_balance) || 0);
    const diff = round2(total - open);
    document.getElementById('pl-summary').innerHTML = `
        <span>Taksit sayısı: <b>${PL.rows.length}</b></span>
        <span>Taksit toplamı: <b>${money(total, cur)}</b></span>
        <span>Siparişin açık bakiyesi: <b>${money(open, cur)}</b></span>
        <span style="${Math.abs(diff) >= 1 ? 'color:var(--warn);' : ''}">Fark: <b>${money(diff, cur)}</b>${Math.abs(diff) >= 1 ? ' — plan açık bakiyeyle tutmuyor' : ''}</span>`;
}

async function savePlan() {
    const o = PL.order;
    const rows = PL.rows.filter(r => r.due_date && Number(r.amount) > 0)
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
    if (!rows.length) return showAlertDialog('En az bir taksit (tarih + tutar) girin.', { variant: 'warn', title: 'Eksik bilgi' });
    if (rows.length !== PL.rows.length) {
        const ok = await showConfirmDialog('Tarihi ya da tutarı boş olan taksitler kaydedilmeyecek. Devam edilsin mi?', { variant: 'warn' });
        if (!ok) return;
    }
    const total = round2(rows.reduce((s, r) => s + Number(r.amount), 0));
    const open = round2(Number(o.remaining_balance) || 0);
    if (Math.abs(total - open) >= 1) {
        const ok = await showConfirmDialog(
            `Taksit toplamı (${money(total, o.currency)}) siparişin açık bakiyesinden (${money(open, o.currency)}) farklı.\n\nYine de kaydedilsin mi?`,
            { title: 'Plan tutmuyor', variant: 'warn', confirmText: 'Kaydet' });
        if (!ok) return;
    }

    const btn = document.getElementById('pl-save');
    btn.disabled = true;
    try {
        const header = {
            title: document.getElementById('pl-title').value.trim() || null,
            agreed_date: document.getElementById('pl-agreed').value || null,
            notes: document.getElementById('pl-notes').value.trim() || null,
            currency: o.currency,
            total_amount: total,
        };
        let planId = PL.plan?.id;
        if (planId) {
            const { error } = await supabase.from('payment_plans').update(header).eq('id', planId);
            if (error) throw error;
            const { error: delErr } = await supabase.from('payment_plan_installments').delete().eq('plan_id', planId);
            if (delErr) throw delErr;
        } else {
            const { data, error } = await supabase.from('payment_plans')
                .insert([{ ...header, user_id: ctx.ownerId, customer_id: o.customer_id, order_id: o.id, status: 'Aktif' }])
                .select().single();
            if (error) throw error;
            planId = data.id;
        }
        const { error: insErr } = await supabase.from('payment_plan_installments')
            .insert(rows.map((r, k) => ({ plan_id: planId, seq: k + 1, due_date: r.due_date, amount: round2(r.amount) })));
        if (insErr) throw insErr;

        const name = S.custById.get(o.customer_id)?.company_name || '';
        logChange({ ctx, moduleId: MODULE, action: PL.plan ? 'update' : 'create',
            summary: `Ödeme planı ${PL.plan ? 'güncellendi' : 'oluşturuldu'}: ${name} sipariş ${o.order_number} — ${rows.length} taksit, ${money(total, o.currency)}`,
            details: { plan_id: planId, installments: rows } });
        closeModal('plan-modal');
        toast('Ödeme planı kaydedildi.');
        await loadData();
    } catch (e) {
        console.error(e);
        showAlertDialog('Kaydedilemedi: ' + e.message, { variant: 'danger', title: 'Hata' });
    } finally {
        btn.disabled = false;
    }
}

async function deletePlan() {
    const plan = PL.plan;
    if (!plan) return;
    const ok = await showConfirmDialog(`"${plan.title || 'Ödeme planı'}" ve tüm taksitleri silinecek. Siparişin tahsilatları etkilenmez.`,
        { title: 'Ödeme planını sil', variant: 'danger', confirmText: 'Sil' });
    if (!ok) return;
    const { error } = await supabase.from('payment_plans').delete().eq('id', plan.id);
    if (error) return showAlertDialog('Silinemedi: ' + error.message, { variant: 'danger' });
    logChange({ ctx, moduleId: MODULE, action: 'delete', summary: `Ödeme planı silindi: ${plan.title || ''} (sipariş ${PL.order.order_number})`, details: plan });
    closeModal('plan-modal');
    toast('Ödeme planı silindi.');
    await loadData();
}

// Seçili müşterinin tarihsiz açılış tahsilatları: kapanmış siparişlerin ödeme tarihini
// arşiv için sonradan girmek (Tahsilat Gir'de kapanmış sipariş listelenmez — doğru, çünkü
// yeni tahsilat girmek ödemeyi iki kez sayardı).
function pmRenderArchive() {
    const el = document.getElementById('pm-archive');
    if (PM.mode !== 'new' || !PM.customerId) { el.innerHTML = ''; return; }
    const opening = S.payments.filter(p => p.customer_id === PM.customerId && p.is_opening && p.method !== 'Mahsup');
    if (!opening.length) { el.innerHTML = ''; return; }
    const rows = opening.map(p => {
        const allocs = paymentAllocations(p.id);
        const nos = allocs.map(a => S.orderById.get(a.order_id)?.order_number).filter(Boolean);
        const datable = allocs.length === 1 && !Number(allocs[0].write_off_amount);
        return { p, nos, datable };
    }).sort((a, b) => (b.nos[0] || '').localeCompare(a.nos[0] || ''));
    el.innerHTML = `<details class="fx-box" style="margin-top:16px;" ${PM.rows.length ? '' : 'open'}>
        <summary style="cursor:pointer;font-size:12.5px;color:var(--ink-2);">
            <i class="fa-solid fa-box-archive" style="color:var(--info);"></i>
            <b>Arşiv:</b> kapanmış siparişlerin tarihsiz ödemeleri (${rows.length}) — geçmiş ödeme tarihini girmek için
        </summary>
        <div class="pt-table-wrap" style="margin-top:10px;"><table class="data-table alloc-table">
            <thead><tr><th>Sipariş</th><th class="num">Tahsil edilen</th><th></th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td class="strong">${r.nos.map(esc).join(', ') || '—'}</td>
                <td class="num">${money(r.p.amount, r.p.currency)}</td>
                <td style="text-align:right;">${r.datable
                    ? `<button class="pt-btn sm" data-act="date-pay" data-id="${r.p.id}"><i class="fa-solid fa-calendar-plus"></i> Tarih gir</button>`
                    : '<span class="muted" style="font-size:11px;">mahsup edilmiş kayıt</span>'}</td>
            </tr>`).join('')}</tbody>
        </table></div>
    </details>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GEÇMİŞ ÖDEMEYİ TARİHLENDİR (SQL 035)
// ═══════════════════════════════════════════════════════════════════════════
const DT = { payment: null, rows: [] };

function openDateModal(paymentId) {
    if (!EDIT) return;
    const p = S.payments.find(x => x.id === paymentId);
    if (!p) return;
    DT.payment = p;
    DT.rows = [{ payment_date: '', amount: Number(p.amount), method: 'T/T', bank_account: '', reference_no: '' }];
    const nos = paymentAllocations(p.id).map(a => S.orderById.get(a.order_id)?.order_number).filter(Boolean);
    document.getElementById('dt-context').innerHTML = `
        <span>Müşteri: <b>${esc(S.custById.get(p.customer_id)?.company_name || '—')}</b></span>
        <span>Sipariş: <b>${nos.map(esc).join(', ') || '—'}</b></span>
        <span>Tarihsiz tahsilat: <b>${money(p.amount, p.currency)}</b></span>`;
    const banks = [...new Set(S.payments.map(x => x.bank_account).filter(Boolean))];
    document.getElementById('dt-bank-list').innerHTML = banks.map(b => `<option value="${esc(b)}">`).join('');
    dtRender();
    openModal('date-modal');
}

function dtRender() {
    const p = DT.payment;
    const methods = ['T/T', 'Havale/EFT', 'Akreditif (LC)', 'Vesaik (CAD)', 'Çek', 'Nakit'];
    document.getElementById('dt-rows').innerHTML = `<table class="data-table alloc-table">
        <thead><tr><th>Ödeme tarihi *</th><th class="num">Tutar (${p.currency}) *</th><th>Ödeme yolu</th><th>Banka hesabı</th><th>Referans</th><th></th></tr></thead>
        <tbody>${DT.rows.map((r, k) => `<tr>
            <td><input type="date" class="pt-input" data-dt="${k}" data-f="payment_date" value="${r.payment_date}"></td>
            <td><input class="pt-input num" data-dt="${k}" data-f="amount" value="${fmtNum(r.amount)}"></td>
            <td><select class="pt-select" data-dt="${k}" data-f="method">${methods.map(m => `<option ${m === r.method ? 'selected' : ''}>${m}</option>`).join('')}</select></td>
            <td><input class="pt-input" data-dt="${k}" data-f="bank_account" list="dt-bank-list" value="${esc(r.bank_account)}"></td>
            <td><input class="pt-input" data-dt="${k}" data-f="reference_no" value="${esc(r.reference_no)}"></td>
            <td>${DT.rows.length > 1 ? `<button class="pt-btn sm icon danger" data-dt-del="${k}" title="Sil"><i class="fa-solid fa-xmark"></i></button>` : ''}</td>
        </tr>`).join('')}</tbody>
    </table>`;
    document.querySelectorAll('#dt-rows [data-dt]').forEach(inp => {
        const ev = inp.tagName === 'SELECT' || inp.type === 'date' ? 'change' : 'input';
        inp.addEventListener(ev, () => {
            const row = DT.rows[Number(inp.dataset.dt)];
            if (inp.dataset.f === 'amount') { const n = parseNum(inp.value); row.amount = isNaN(n) ? 0 : round2(n); }
            else row[inp.dataset.f] = inp.value;
            dtSummary();
        });
        if (inp.dataset.f === 'amount') inp.addEventListener('blur', () => { inp.value = fmtNum(DT.rows[Number(inp.dataset.dt)].amount); });
    });
    document.querySelectorAll('#dt-rows [data-dt-del]').forEach(b => b.addEventListener('click', () => {
        DT.rows.splice(Number(b.dataset.dtDel), 1);
        dtRender();
    }));
    dtSummary();
}

function dtSummary() {
    const p = DT.payment;
    const total = round2(DT.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const rest = round2(Number(p.amount) - total);
    document.getElementById('dt-summary').innerHTML = `
        <span>Tarihsiz tutar: <b>${money(p.amount, p.currency)}</b></span>
        <span>Tarihlendirilen: <b>${money(total, p.currency)}</b></span>
        <span style="${rest < -0.005 ? 'color:var(--danger);' : ''}">${rest < -0.005 ? 'Fazla girildi' : 'Tarihsiz kalacak'}: <b>${money(Math.abs(rest), p.currency)}</b></span>`;
}

function initDateModal() {
    document.getElementById('dt-add-row').addEventListener('click', () => {
        const total = DT.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const rest = Math.max(0, round2(Number(DT.payment.amount) - total));
        DT.rows.push({ payment_date: '', amount: rest, method: DT.rows[DT.rows.length - 1]?.method || 'T/T', bank_account: '', reference_no: '' });
        dtRender();
    });
    document.getElementById('dt-save').addEventListener('click', saveDates);
}

async function saveDates() {
    const p = DT.payment;
    const rows = DT.rows.map(r => ({ ...r, amount: round2(r.amount) }));
    if (rows.some(r => !r.payment_date || !(r.amount > 0))) {
        return showAlertDialog('Her satırda ödeme tarihi ve tutar olmalı.', { variant: 'warn', title: 'Eksik bilgi' });
    }
    if (rows.some(r => r.payment_date > TODAY)) {
        return showAlertDialog('Geçmiş ödeme tarihi bugünden ileri olamaz.', { variant: 'warn', title: 'Tarih hatası' });
    }
    const total = round2(rows.reduce((s, r) => s + r.amount, 0));
    if (total - Number(p.amount) > 0.005) {
        return showAlertDialog(`Girilen toplam (${money(total, p.currency)}) tarihsiz tutarı (${money(p.amount, p.currency)}) aşıyor.`, { variant: 'warn', title: 'Tutar hatası' });
    }
    const btn = document.getElementById('dt-save');
    btn.disabled = true;
    try {
        const { error } = await supabase.rpc('date_opening_payment', { p_payment_id: p.id, p_rows: rows });
        if (error) throw error;
        const name = S.custById.get(p.customer_id)?.company_name || '';
        const nos = paymentAllocations(p.id).map(a => S.orderById.get(a.order_id)?.order_number).filter(Boolean).join(', ');
        logChange({ ctx, moduleId: MODULE, action: 'update',
            summary: `Geçmiş ödeme tarihlendirildi: ${name} sipariş ${nos} — ${rows.map(r => `${dateTr(r.payment_date)} ${money(r.amount, p.currency)}`).join(', ')}`,
            details: { payment_id: p.id, rows } });
        closeModal('date-modal');
        toast('Ödeme tarihi kaydedildi.');
        await loadData();
    } catch (e) {
        console.error(e);
        showAlertDialog('Kaydedilemedi: ' + e.message + (/date_opening_payment/.test(e.message) ? '\n\n(SQL 035 çalıştırılmış olmalı.)' : ''), { variant: 'danger', title: 'Hata' });
    } finally {
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SİPARİŞ FATURALARI (order_invoices, SQL 027/029)
// Alacak faturayla doğar ve vade faturadan işler. Kısmi sevkiyatta bir siparişin
// birden çok faturası olur; ihraç kayıtlı satışta fatura TL, sipariş USD olabilir.
// Fatura kaydedilince siparişin vadesi en erken fatura vadesine eşitlenir (SQL 037).
// ═══════════════════════════════════════════════════════════════════════════
const IV = { order: null, editId: null, dueTouched: false };

// Vade hafta sonuna denk gelirse bir sonraki Pazartesi (patron: "26'sı Cumartesiye geliyor, 28'i girdim").
function nextBusinessDay(iso) {
    if (!iso) return iso;
    const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
    return dow === 6 ? addDays(iso, 2) : dow === 0 ? addDays(iso, 1) : iso;
}

function ivSuggestDue(invoiceDate) {
    const term = termDays(IV.order?.payment_method);
    return term > 0 && invoiceDate ? nextBusinessDay(addDays(invoiceDate, term)) : '';
}

function openInvoiceModal(orderId) {
    if (!EDIT) return;
    const o = S.orderById.get(orderId);
    if (!o) return;
    IV.order = o;
    ivRenderList();
    ivResetForm(null);
    openModal('invoice-modal');
}

function orderInvoices(orderId) {
    return S.invoices.filter(i => i.order_id === orderId)
        .sort((a, b) => (a.invoice_date || '').localeCompare(b.invoice_date || '') || (a.invoice_no || '').localeCompare(b.invoice_no || ''));
}

function ivRenderList() {
    const o = IV.order;
    const cur = o.currency;
    const invs = orderInvoices(o.id);
    const invoiced = round2(invs.reduce((s, i) => s + (Number(i.amount_order_currency ?? i.amount) || 0), 0));
    const rest = round2((Number(o.total_amount) || 0) - invoiced);
    document.getElementById('iv-context').innerHTML = `
        <span>Müşteri: <b>${esc(S.custById.get(o.customer_id)?.company_name || '—')}</b></span>
        <span>Sipariş: <b>${esc(o.order_number)}</b> · ${esc(o.payment_method || 'ödeme şekli yok')}</span>
        <span>Sipariş tutarı: <b>${money(o.total_amount, cur)}</b></span>
        <span>Faturalanan: <b>${money(invoiced, cur)}</b></span>
        <span style="${rest < -0.05 ? 'color:var(--danger);' : ''}">${rest < -0.05 ? 'Fazla faturalanan' : 'Faturalanmamış'}: <b>${money(Math.abs(rest), cur)}</b></span>`;

    document.getElementById('iv-list').innerHTML = invs.length ? `<table class="data-table alloc-table">
        <thead><tr><th>Fatura no</th><th>Tarih</th><th class="num">Tutar</th><th class="num">Sipariş karşılığı</th><th>Vade</th><th>Not</th><th></th></tr></thead>
        <tbody>${invs.map(i => `<tr>
            <td class="strong">${esc(i.invoice_no || '—')}</td>
            <td class="nowrap">${dateTr(i.invoice_date)}</td>
            <td class="num">${money(i.amount, i.currency)}${i.fx_rate ? `<div class="muted" style="font-size:10.5px;">kur ${fmtNum(i.fx_rate, 4)}</div>` : ''}</td>
            <td class="num">${i.fx_rate ? money(i.amount_order_currency, cur) : '<span class="muted">—</span>'}</td>
            <td class="nowrap">${i.due_date ? dateTr(i.due_date) : '<span class="muted">vadesiz</span>'}</td>
            <td style="font-size:11px;max-width:220px;" class="muted">${esc((i.notes || '').slice(0, 120))}</td>
            <td class="nowrap" style="text-align:right;">
                <button class="pt-btn sm icon" data-iv-edit="${i.id}" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
                <button class="pt-btn sm icon danger" data-iv-del="${i.id}" title="Sil"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="empty">Bu siparişin sistemde faturası yok.</div>`;

    document.querySelectorAll('#iv-list [data-iv-edit]').forEach(b => b.addEventListener('click', () =>
        ivResetForm(S.invoices.find(i => i.id === b.dataset.ivEdit))));
    document.querySelectorAll('#iv-list [data-iv-del]').forEach(b => b.addEventListener('click', () =>
        deleteInvoice(S.invoices.find(i => i.id === b.dataset.ivDel))));
}

function ivResetForm(inv) {
    const o = IV.order;
    IV.editId = inv?.id || null;
    IV.dueTouched = !!inv;
    document.getElementById('iv-form-title').textContent = inv ? `Faturayı düzenle — ${inv.invoice_no || ''}` : 'Yeni fatura';
    document.getElementById('iv-no').value = inv?.invoice_no || '';
    document.getElementById('iv-date').value = inv?.invoice_date || '';
    document.getElementById('iv-currency').value = inv?.currency || o.currency;
    const invoicedSoFar = orderInvoices(o.id).filter(i => i.id !== inv?.id)
        .reduce((s, i) => s + (Number(i.amount_order_currency ?? i.amount) || 0), 0);
    const suggested = round2(Math.max(0, (Number(o.total_amount) || 0) - invoicedSoFar));
    document.getElementById('iv-amount').value = inv ? fmtNum(inv.amount) : (suggested ? fmtNum(suggested) : '');
    document.getElementById('iv-rate').value = inv?.fx_rate ? fmtNum(inv.fx_rate, 4) : '';
    document.getElementById('iv-oc').value = inv?.amount_order_currency ? fmtNum(inv.amount_order_currency) : (inv ? '' : (suggested ? fmtNum(suggested) : ''));
    document.getElementById('iv-due').value = inv?.due_date || '';
    document.getElementById('iv-notes').value = inv?.notes || '';
    ivToggleFx();
    ivDueHint();
}

function ivToggleFx() {
    const fx = document.getElementById('iv-currency').value !== IV.order.currency;
    document.getElementById('iv-fx').hidden = !fx;
    document.getElementById('iv-oc-label').textContent = `Sipariş karşılığı (${IV.order.currency})`;
}

function ivDueHint() {
    const term = termDays(IV.order.payment_method);
    document.getElementById('iv-due-hint').textContent = term > 0
        ? `Ödeme şekli "${IV.order.payment_method}": vade = fatura tarihi + ${term} gün (hafta sonuna gelirse Pazartesi). Değiştirebilirsiniz.`
        : `Ödeme şekli "${IV.order.payment_method || '—'}": vadesiz. Gerekirse elle girin.`;
}

function initInvoiceModal() {
    document.getElementById('iv-date').addEventListener('change', e => {
        if (!IV.dueTouched) document.getElementById('iv-due').value = ivSuggestDue(e.target.value);
    });
    document.getElementById('iv-due').addEventListener('change', () => { IV.dueTouched = true; });
    document.getElementById('iv-currency').addEventListener('change', ivToggleFx);
    const calcOc = () => {
        const a = parseNum(document.getElementById('iv-amount').value);
        const r = parseNum(document.getElementById('iv-rate').value);
        if (!isNaN(a) && !isNaN(r) && r > 0) document.getElementById('iv-oc').value = fmtNum(round2(a / r));
    };
    document.getElementById('iv-rate').addEventListener('input', calcOc);
    document.getElementById('iv-amount').addEventListener('input', () => {
        if (document.getElementById('iv-currency').value !== IV.order.currency) calcOc();
        else document.getElementById('iv-oc').value = document.getElementById('iv-amount').value;
    });
    ['iv-amount', 'iv-oc'].forEach(id => document.getElementById(id).addEventListener('blur', e => {
        const n = parseNum(e.target.value); if (!isNaN(n)) e.target.value = fmtNum(n);
    }));
    document.getElementById('iv-new').addEventListener('click', () => ivResetForm(null));
    document.getElementById('iv-save').addEventListener('click', saveInvoice);
}

async function saveInvoice() {
    const o = IV.order;
    const no = document.getElementById('iv-no').value.trim();
    const date = document.getElementById('iv-date').value;
    const amount = parseNum(document.getElementById('iv-amount').value);
    const currency = document.getElementById('iv-currency').value;
    const fx = currency !== o.currency;
    const rate = fx ? parseNum(document.getElementById('iv-rate').value) : null;
    const oc = fx ? parseNum(document.getElementById('iv-oc').value) : null;
    const due = document.getElementById('iv-due').value || null;

    if (!no || !date || isNaN(amount) || !amount) {
        return showAlertDialog('Fatura no, tarih ve tutar gerekli.', { variant: 'warn', title: 'Eksik bilgi' });
    }
    if (fx && (isNaN(rate) || rate <= 0 || isNaN(oc) || !oc)) {
        return showAlertDialog(`Fatura ${currency}, sipariş ${o.currency}. Kur ve sipariş para birimindeki karşılığı girin.`, { variant: 'warn', title: 'Eksik bilgi' });
    }
    if (due && due < date) {
        return showAlertDialog('Vade, fatura tarihinden önce olamaz.', { variant: 'warn', title: 'Tarih hatası' });
    }
    const others = orderInvoices(o.id).filter(i => i.id !== IV.editId)
        .reduce((s, i) => s + (Number(i.amount_order_currency ?? i.amount) || 0), 0);
    const newTotal = round2(others + (fx ? oc : amount));
    if (newTotal - Number(o.total_amount) > 0.05) {
        const ok = await showConfirmDialog(
            `Faturaların toplamı (${money(newTotal, o.currency)}) sipariş tutarını (${money(o.total_amount, o.currency)}) aşıyor.\n\nYine de kaydedilsin mi?`,
            { title: 'Fazla faturalama', variant: 'warn', confirmText: 'Kaydet' });
        if (!ok) return;
    }

    const payload = {
        invoice_no: no, invoice_date: date, amount: round2(amount), currency,
        fx_rate: fx ? rate : null, amount_order_currency: fx ? round2(oc) : null,
        due_date: due, notes: document.getElementById('iv-notes').value.trim() || null,
    };
    const btn = document.getElementById('iv-save');
    btn.disabled = true;
    try {
        let error;
        if (IV.editId) ({ error } = await supabase.from('order_invoices').update(payload).eq('id', IV.editId));
        else ({ error } = await supabase.from('order_invoices').insert([{ ...payload, user_id: ctx.ownerId, order_id: o.id }]));
        if (error) {
            if (error.code === '23505') throw new Error(`"${no}" numaralı fatura zaten kayıtlı.`);
            throw error;
        }
        const name = S.custById.get(o.customer_id)?.company_name || '';
        logChange({ ctx, moduleId: MODULE, action: IV.editId ? 'update' : 'create',
            summary: `Fatura ${IV.editId ? 'güncellendi' : 'eklendi'}: ${name} sipariş ${o.order_number} — ${no} ${dateTr(date)} ${money(amount, currency)}${due ? ' · vade ' + dateTr(due) : ''}`,
            details: payload });
        toast(IV.editId ? 'Fatura güncellendi.' : 'Fatura eklendi.');
        await loadData();
        IV.order = S.orderById.get(o.id);
        ivRenderList();
        ivResetForm(null);
    } catch (e) {
        console.error(e);
        showAlertDialog('Kaydedilemedi: ' + e.message, { variant: 'danger', title: 'Hata' });
    } finally {
        btn.disabled = false;
    }
}

async function deleteInvoice(inv) {
    if (!inv) return;
    const ok = await showConfirmDialog(`${inv.invoice_no || ''} · ${dateTr(inv.invoice_date)} · ${money(inv.amount, inv.currency)}\n\nFatura kaydı silinecek. Tahsilatlar etkilenmez; bu tutar yeniden "faturalanmamış" görünür.`,
        { title: 'Faturayı sil', variant: 'danger', confirmText: 'Sil' });
    if (!ok) return;
    const { error } = await supabase.from('order_invoices').delete().eq('id', inv.id);
    if (error) return showAlertDialog('Silinemedi: ' + error.message, { variant: 'danger' });
    logChange({ ctx, moduleId: MODULE, action: 'delete', summary: `Fatura silindi: ${inv.invoice_no || ''} (sipariş ${IV.order.order_number})`, details: inv });
    toast('Fatura silindi.');
    await loadData();
    IV.order = S.orderById.get(IV.order.id);
    ivRenderList();
    ivResetForm(null);
}
