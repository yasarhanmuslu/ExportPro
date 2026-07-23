// call-rotation.js — Günlük Arama Listesi
// Her temsilcinin kendi portföyünden, seçtiği bölgede, en uzun süredir
// aranmamış 3 Pasif + 2 Aktif müşteriyi günlük to-do olarak sunar.
import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { showAlertDialog, showPromptDialog } from './utils/dialogs.js';
import { getAccessContext, guardModuleAccess, canEdit, isOwner } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';
import { getRegion, parseHistoryNotes } from './utils/customerHelpers.js';

const JITTER_RANGE_MS = 3 * 24 * 60 * 60 * 1000; // ±3 gün

let ctx = null;
let currentItems = []; // o günkü listede gösterilen müşteriler (canlı, aksiyon sonrası yerinde güncellenir)
let poolPasif = []; // bölgedeki tüm uygun Pasif müşteriler (sıralı) — "Ek Müşteri Ekle" için yedek havuz
let poolAktif = []; // bölgedeki tüm uygun Aktif müşteriler (sıralı)

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'customers'))) return;
    await renderNavbar('call-rotation', ctx);

    const regionSelect = document.getElementById('region-select');
    const defaultRegion = (ctx.email || '').toLowerCase() === 'omerucan025@icloud.com' ? 'Orta Doğu' : '';
    regionSelect.value = defaultRegion;
    regionSelect.addEventListener('change', () => drawTodayList(regionSelect.value));

    if (defaultRegion) await drawTodayList(defaultRegion);
});

// ════════════════════════════════════════════════════════════════
//  DETERMİNİSTİK "GÜNLÜK KURA" — sayfa yenilense de aynı gün aynı liste
// ════════════════════════════════════════════════════════════════
function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(seed) {
    let t = seed;
    return function () {
        t |= 0; t = (t + 0x6D2B79F5) | 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// "Hiç aranmamış" ve "bugün aranmış" aynı (en öncelikli) grupta sabit kalır,
// böylece bugün "Arandı" işaretlenen müşteri listeden anında düşmez.
// Gerçek geçmiş tarihler olduğu gibi kullanılır (daha eski = daha öncelikli).
function baseSortMs(lastCalledAt, todayStr) {
    if (!lastCalledAt) return 0;
    return lastCalledAt.slice(0, 10) === todayStr ? 0 : new Date(lastCalledAt).getTime();
}

function jitterMs(seedStr) {
    const rnd = mulberry32(hashSeed(seedStr))();
    return (rnd - 0.5) * 2 * JITTER_RANGE_MS;
}

// ════════════════════════════════════════════════════════════════
//  HAVUZ ÇEKME
// ════════════════════════════════════════════════════════════════
async function drawTodayList(region) {
    const container = document.getElementById('call-rotation-container');
    if (!region) {
        container.innerHTML = emptyState('Listeyi görmek için önce bir bölge seçin.', 'fa-map-location-dot');
        return;
    }

    container.innerHTML = `<p class="text-sm" style="color:var(--porc-ink-2);">Yükleniyor…</p>`;

    try {
        // İstisna: yönetici (owner) tüm temsilcilerin havuzuna erişir — bölgeye göre filtrelenir
        // ama account_owner_id'ye göre kısıtlanmaz. Diğer temsilciler yalnızca kendi portföyünü görür.
        let query = supabase
            .from('customers')
            .select('id, company_name, contact_name, phone, email, status, last_called_at, history_notes, country, region, account_owner')
            .eq('user_id', ctx.ownerId)
            .in('status', ['Aktif', 'Pasif']);
        if (!isOwner(ctx)) {
            query = query.eq('account_owner_id', ctx.userId);
        }
        const { data: customers, error } = await query;
        if (error) throw error;

        const pool = (customers || []).filter(c => (c.region || getRegion(c.country)) === region);
        const ids = pool.map(c => c.id);

        let openQuoteIds = new Set();
        let openOrderIds = new Set();

        if (ids.length > 0) {
            const [{ data: quotes, error: qErr }, { data: orders, error: oErr }] = await Promise.all([
                supabase.from('quotations').select('customer_id, status, valid_until')
                    .eq('user_id', ctx.ownerId).in('customer_id', ids),
                supabase.from('orders').select('customer_id, status_tags')
                    .eq('user_id', ctx.ownerId).in('customer_id', ids),
            ]);
            if (qErr) throw qErr;
            if (oErr) throw oErr;

            const today = new Date().toISOString().slice(0, 10);
            openQuoteIds = new Set(
                (quotes || [])
                    .filter(q => q.status === 'Bekliyor' && (!q.valid_until || q.valid_until >= today))
                    .map(q => q.customer_id)
            );
            openOrderIds = new Set(
                (orders || [])
                    .filter(o => {
                        const tags = o.status_tags || [];
                        return !tags.includes('Sevk Edildi') && !tags.includes('İptal');
                    })
                    .map(o => o.customer_id)
            );
        }

        const eligible = pool.filter(c => !openQuoteIds.has(c.id) && !openOrderIds.has(c.id));

        const todayStr = new Date().toISOString().slice(0, 10);
        const seedBase = `${todayStr}|${region}|${ctx.userId}`;
        const ranked = eligible
            .map(c => ({ ...c, _sortKey: baseSortMs(c.last_called_at, todayStr) + jitterMs(`${seedBase}|${c.id}`) }))
            .sort((a, b) => a._sortKey - b._sortKey);

        poolPasif = ranked.filter(c => c.status === 'Pasif');
        poolAktif = ranked.filter(c => c.status === 'Aktif');

        currentItems = [...poolPasif.slice(0, 3), ...poolAktif.slice(0, 2)];
        renderList();

    } catch (error) {
        console.error('Günlük liste çekilemedi:', error.message);
        container.innerHTML = emptyState('Liste yüklenirken bir hata oluştu: ' + error.message, 'fa-triangle-exclamation');
    }
}

function emptyState(text, icon) {
    return `
        <div class="text-center py-12 rounded-xl" style="background:var(--surface,#fff);border:1px dashed var(--porc-border);">
            <i class="fa-solid ${icon} text-3xl mb-3" style="color:var(--porc-ink-3);"></i>
            <p class="text-sm" style="color:var(--porc-ink-2);">${text}</p>
        </div>`;
}

// ════════════════════════════════════════════════════════════════
//  LİSTELEME
// ════════════════════════════════════════════════════════════════
function sectionHtml(label, statusValue, items, pool, todayStr) {
    const hasMore = pool.length > items.length;
    let html = `<div class="section-label">${label} (${items.length})</div>`;
    if (items.length > 0) {
        html += items.map(c => cardHtml(c, todayStr)).join('');
    } else {
        html += emptyState(`Bu bölgede uygun ${statusValue} müşteri yok.`, 'fa-circle-info');
    }
    if (hasMore) {
        html += `
            <button type="button" class="btn-add-extra" data-status="${statusValue}">
                <i class="fa-solid fa-plus"></i> Ek ${statusValue} Müşteri Ekle
            </button>`;
    }
    return html;
}

function renderList() {
    const container = document.getElementById('call-rotation-container');
    const todayStr = new Date().toISOString().slice(0, 10);

    if (poolPasif.length === 0 && poolAktif.length === 0) {
        container.innerHTML = emptyState('Bu bölgede uygun müşteri bulunamadı (tümü teklif/sipariş sürecinde olabilir).', 'fa-circle-check');
        return;
    }

    const pasifItems = currentItems.filter(c => c.status === 'Pasif');
    const aktifItems = currentItems.filter(c => c.status === 'Aktif');

    let html = '';
    html += sectionHtml('Pasif Müşteriler', 'Pasif', pasifItems, poolPasif, todayStr);
    html += sectionHtml('Aktif Müşteriler', 'Aktif', aktifItems, poolAktif, todayStr);
    container.innerHTML = html;

    container.querySelectorAll('.btn-mark-called').forEach(btn => {
        btn.addEventListener('click', () => markCustomerContacted(btn.getAttribute('data-id'), 'called'));
    });
    container.querySelectorAll('.btn-mark-message').forEach(btn => {
        btn.addEventListener('click', () => markCustomerContacted(btn.getAttribute('data-id'), 'message'));
    });
    container.querySelectorAll('.btn-add-extra').forEach(btn => {
        btn.addEventListener('click', () => addExtraCustomer(btn.getAttribute('data-status')));
    });
}

// Havuzda gösterilenlerin dışında henüz listeye alınmamış bir sonraki müşteriyi ekler
// (bugün için 5'ten fazla firmayla iletişime geçmek isteyen temsilci için).
function addExtraCustomer(statusValue) {
    const pool = statusValue === 'Pasif' ? poolPasif : poolAktif;
    const shownIds = new Set(currentItems.map(c => c.id));
    const next = pool.find(c => !shownIds.has(c.id));
    if (!next) {
        showAlertDialog(`Bu bölgede eklenecek başka uygun ${statusValue} müşteri kalmadı.`, { variant: 'info', title: 'Havuz Tükendi' });
        return;
    }
    currentItems.push(next);
    renderList();
}

function isCalledToday(customer, todayStr) {
    return !!customer.last_called_at && customer.last_called_at.slice(0, 10) === todayStr;
}

// Bugün eklenen son notu döndürür (yoksa null). Rozet (Arandı/Mesaj Gönderildi)
// ve kartta gösterilecek not metni bu tek kayıttan türetilir.
function getTodayNote(customer, todayStr) {
    const notes = parseHistoryNotes(customer.history_notes);
    const todays = notes.filter(n => n.date === todayStr);
    return todays.length ? todays[todays.length - 1] : null;
}

// "[Mesaj] " veya "[Arama - GG.AA.YYYY] " önekini temizleyip yalnızca serbest metni döndürür.
function stripNotePrefix(note) {
    return (note || '').replace(/^\[[^\]]*\]\s*/, '');
}

function cardHtml(c, todayStr) {
    const done = isCalledToday(c, todayStr);
    const todayNote = done ? getTodayNote(c, todayStr) : null;
    const isMessage = todayNote && todayNote.note && todayNote.note.startsWith('[Mesaj]');
    const badgeClass = c.status === 'Aktif' ? 'call-badge-aktif' : 'call-badge-pasif';
    const contactLine = [c.contact_name, c.phone, c.email].filter(Boolean).join(' · ') || '—';
    const lastCalledLine = c.last_called_at
        ? `Son arama: ${formatDate(c.last_called_at)}`
        : 'Daha önce hiç aranmamış';

    // Yönetici tüm temsilcilerin havuzunu birlikte görüyor — hangi müşterinin kime ait
    // olduğu karışmasın diye sorumlu ismi ayrıca gösterilir (temsilcinin kendi görünümünde gereksiz).
    const ownerLine = (isOwner(ctx) && c.account_owner && c.account_owner !== 'Atanmadı')
        ? `<div class="text-xs" style="color:var(--porc-ink-3);"><i class="fa-solid fa-user"></i> ${escapeHtml(c.account_owner)}</div>`
        : '';

    const doneLabel = isMessage
        ? '<i class="fa-solid fa-comment-dots"></i> Bugün Mesaj Gönderildi'
        : '<i class="fa-solid fa-check"></i> Bugün Arandı';

    // Orta sütun: bugüne ait not varsa göster, yoksa boş (— ile işaretlenir).
    const noteColHtml = todayNote
        ? `<i class="fa-solid fa-note-sticky"></i><span>${escapeHtml(stripNotePrefix(todayNote.note))}</span>`
        : '';

    // Sağ sütun: tamamlanmışsa durum rozeti, değilse iki aksiyon butonu.
    const actionsHtml = done
        ? `<span class="call-badge call-done-badge" style="background:#E1EEE5;color:#3D6E50;">${doneLabel}</span>`
        : `
            <button type="button" class="btn-call-action btn-call-primary btn-mark-called" data-id="${c.id}">
                <i class="fa-solid fa-phone"></i> Arandı
            </button>
            <button type="button" class="btn-call-action btn-mark-message" data-id="${c.id}">
                <i class="fa-solid fa-comment-dots"></i> Ulaşılamadı, Mesaj Gönderildi
            </button>`;

    return `
        <div class="call-card ${done ? 'done' : ''}" data-id="${c.id}">
            <div class="call-card-info">
                <div class="text-sm font-semibold" style="color:var(--porc-ink);">
                    ${escapeHtml(c.company_name)}
                    <span class="call-badge ${badgeClass}">${escapeHtml(c.status)}</span>
                </div>
                <div class="text-xs" style="color:var(--porc-ink-2);">${escapeHtml(contactLine)}</div>
                <div class="text-xs" style="color:var(--porc-ink-3);">${lastCalledLine}</div>
                ${ownerLine}
            </div>
            <div class="call-card-note-col${todayNote ? '' : ' empty'}">${noteColHtml}</div>
            <div class="call-card-actions">${actionsHtml}</div>
        </div>`;
}

// ════════════════════════════════════════════════════════════════
//  AKSİYONLAR — Arandı / Mesaj Gönderildi
// ════════════════════════════════════════════════════════════════
async function markCustomerContacted(customerId, kind) {
    if (!canEdit(ctx, 'customers')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }

    const item = currentItems.find(c => c.id === customerId);
    if (!item) return;

    const promptLabel = kind === 'message' ? 'Gönderilen mesajla ilgili not girin:' : 'Görüşme notu girin:';
    const noteText = await showPromptDialog(promptLabel, '', { title: 'Not Ekle' });
    if (noteText === null) return; // vazgeçildi, kayıt yapılmadı

    const now = new Date();
    const prefix = kind === 'message' ? '[Mesaj] ' : `[Arama - ${formatDate(now.toISOString())}] `;
    const notes = parseHistoryNotes(item.history_notes);
    notes.push({ date: now.toISOString().slice(0, 10), note: prefix + noteText });
    const nowIso = now.toISOString();

    try {
        const { error } = await supabase
            .from('customers')
            .update({ history_notes: JSON.stringify(notes), last_called_at: nowIso, updated_at: nowIso })
            .eq('id', item.id)
            .eq('user_id', ctx.ownerId);
        if (error) throw error;

        logChange({
            ctx, moduleId: 'customers', action: 'update',
            summary: `Arama rotasyonu: ${item.company_name} — ${kind === 'message' ? 'mesaj gönderildi' : 'arandı'}`,
        });

        // Sadece ilgili kaydı yerinde güncelle — liste yeniden çekilmez,
        // günün 5 müşterisi sabit kalır.
        item.history_notes = JSON.stringify(notes);
        item.last_called_at = nowIso;
        renderList();

    } catch (error) {
        console.error('Not kaydedilemedi:', error.message);
        await showAlertDialog('Kayıt sırasında bir hata oluştu: ' + error.message, { variant: 'danger', title: 'Hata' });
    }
}

// ════════════════════════════════════════════════════════════════
//  YARDIMCI
// ════════════════════════════════════════════════════════════════
function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
