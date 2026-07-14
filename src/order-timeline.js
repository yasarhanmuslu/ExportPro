// order-timeline.js — V: 1.0.83
import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';
import { showAlertDialog } from './utils/dialogs.js';

// ── State
let session = null;
let ctx = null;
let allOrders = [];
let allNotes = [];
let currentFilter = 'all';
let currentView = 'calendar';
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based

// ── Başlat
async function init() {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s) { window.location.href = 'login.html'; return false; }
    session = s;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'order-timeline'))) return false;
    await renderNavbar('order-timeline', ctx);
    applyEditLock(ctx, 'order-timeline');
    return true;
}

// ── Supabase'den siparişleri çek
async function loadOrders() {
    const { data, error } = await supabase
        .from('orders')
        .select('*, customers!fk_orders_customer(company_name)')
        .eq('user_id', ctx.ownerId)
        .order('shipment_date', { ascending: true });

    if (error) { console.error('Orders load error:', error); return; }
    allOrders = data || [];
    updateOverdueAlert();
    render();
}

// ── Supabase'den takvim notlarını çek
async function loadNotes() {
    const { data, error } = await supabase
        .from('calendar_notes')
        .select('*')
        .eq('user_id', ctx.ownerId);
    if (error) { console.error('Notlar yüklenemedi:', error); return; }
    allNotes = data || [];
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ── Geciken sipariş uyarısı
function updateOverdueAlert() {
    const today = new Date(); today.setHours(0,0,0,0);
    const CLOSED_TAGS = ['Ödeme Tamamlandı', 'Teslim Edildi', 'İptal'];
    const isClosed = (o) => {
        const tags = (o.status_tags && o.status_tags.length > 0) ? o.status_tags : [o.order_status || ''];
        return tags.some(t => CLOSED_TAGS.includes(t));
    };
    const overdue = allOrders.filter(o => {
        if (!o.due_date) return false;
        if (isClosed(o)) return false;
        return new Date(o.due_date) < today;
    });
    const alertEl = document.getElementById('alert-overdue');
    document.getElementById('overdue-count').textContent = overdue.length;
    alertEl.style.display = overdue.length > 0 ? 'flex' : 'none';
}

// ── Filtre uygula
function getFiltered() {
    const today = new Date(); today.setHours(0,0,0,0);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth()+1, 0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const CLOSED_TAGS = ['Ödeme Tamamlandı', 'Teslim Edildi', 'İptal'];
    const isClosed = (o) => {
        const tags = (o.status_tags && o.status_tags.length > 0) ? o.status_tags : [o.order_status || ''];
        return tags.some(t => CLOSED_TAGS.includes(t));
    };

    return allOrders.filter(o => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'active') {
            return !isClosed(o);
        }
        if (currentFilter === 'overdue') {
            if (!o.due_date) return false;
            if (isClosed(o)) return false;
            return new Date(o.due_date) < today;
        }
        if (currentFilter === 'thismonth') {
            const dates = [o.order_date, o.shipment_date, o.due_date].filter(Boolean);
            return dates.some(d => {
                const dt = new Date(d);
                return dt >= startOfMonth && dt <= endOfMonth;
            });
        }
        return true;
    });
}

// ── Ana render
function render() {
    if (currentView === 'calendar') renderCalendar();
    else renderList();
}

// ══════════════════════════════
//  TAKVİM GÖRÜNÜMÜ
// ══════════════════════════════
function renderCalendar() {
    const label = document.getElementById('cal-month-label');
    const container = document.getElementById('calendar-container');

    const monthNames = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
                        'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    label.textContent = `${monthNames[calMonth]} ${calYear}`;

    const filtered = getFiltered();
    const today = new Date(); today.setHours(0,0,0,0);

    // Ay içindeki event map: "YYYY-MM-DD" → [{type, order}]
    const eventMap = {};
    const addEvent = (dateStr, type, order) => {
        if (!dateStr) return;
        const d = dateStr.slice(0,10);
        if (!eventMap[d]) eventMap[d] = [];
        eventMap[d].push({ type, order });
    };

    filtered.forEach(o => {
        addEvent(o.shipment_date, 'shipment', o);
        addEvent(o.due_date, 'due', o);
    });

    // Ay içindeki manuel notlar: "YYYY-MM-DD" → [{id, note_text}]
    const noteMap = {};
    allNotes.forEach(n => {
        const d = n.note_date;
        if (!noteMap[d]) noteMap[d] = [];
        noteMap[d].push(n);
    });

    // Ayın 1. günü hangi gün?
    const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
    const startOffset = (firstDay === 0) ? 6 : firstDay - 1; // Mon-based
    const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
    const prevDays = new Date(calYear, calMonth, 0).getDate();

    const dayLabels = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

    let html = `<div class="calendar-grid">`;
    dayLabels.forEach(d => { html += `<div class="cal-header-cell">${d}</div>`; });

    // Önceki ay gri hücreleri
    for (let i = 0; i < startOffset; i++) {
        const day = prevDays - startOffset + i + 1;
        html += `<div class="cal-day-cell other-month"><div class="cal-day-number">${day}</div></div>`;
    }

    // Bu ayın günleri
    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(calYear, calMonth, d);
        const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday = dateObj.getTime() === today.getTime();
        const events = eventMap[dateStr] || [];
        const dayNotes = noteMap[dateStr] || [];

        html += `<div class="cal-day-cell${isToday?' today':''}">`;
        html += `<div class="cal-day-number-row">
            <div class="cal-day-number">${d}</div>
            <button type="button" class="cal-add-note-btn" data-note-date="${dateStr}" title="Not ekle"><i class="fa-solid fa-plus"></i></button>
        </div>`;

        const visible = events.slice(0, 3);
        visible.forEach(ev => {
            const name = ev.order.customers?.company_name || 'Müşteri';
            const shortName = name.length > 14 ? name.slice(0,13)+'…' : name;

            // Status tags'e göre badge rengi belirle
            const tags = (ev.order.status_tags && ev.order.status_tags.length > 0)
                ? ev.order.status_tags
                : (ev.order.order_status ? [ev.order.order_status] : ['Devam Ediyor']);
            const primaryTag = tags[0];

            // Öncelik sırası: en kritik / en ileri aşama kazanır
            const TAG_PRIORITY = [
                'İptal', 'Gecikme',
                'Teslim Edildi', 'Ödeme Tamamlandı',
                'Bakiye Bekliyor',
                'Sevk Edildi', 'Sevke Hazır',
                'Üretimde', 'Üretime Hazır',
                'Yeni Müşteri', 'Devam Ediyor',
            ];
            const TAG_BADGE = {
                'Devam Ediyor':    'badge-tag-devam',
                'Üretimde':        'badge-tag-uretim',
                'Üretime Hazır':   'badge-tag-uretim',
                'Sevke Hazır':     'badge-tag-sevkhazir',
                'Sevk Edildi':     'badge-tag-sevkedildi',
                'Bakiye Bekliyor': 'badge-tag-bakiye',
                'Ödeme Tamamlandı':'badge-tag-odeme',
                'Teslim Edildi':   'badge-tag-teslim',
                'İptal':           'badge-tag-iptal',
                'Gecikme':         'badge-tag-gecikme',
                'Yeni Müşteri':    'badge-tag-yenimusteri',
            };
            const TAG_ICON = {
                'Devam Ediyor':    'fa-rotate',
                'Üretimde':        'fa-industry',
                'Üretime Hazır':   'fa-box-open',
                'Sevke Hazır':     'fa-dolly',
                'Sevk Edildi':     'fa-truck',
                'Bakiye Bekliyor': 'fa-clock',
                'Ödeme Tamamlandı':'fa-circle-check',
                'Teslim Edildi':   'fa-circle-check',
                'İptal':           'fa-ban',
                'Gecikme':         'fa-triangle-exclamation',
                'Yeni Müşteri':    'fa-user-plus',
            };

            // Birden fazla etiket varsa en öncelikli olanı seç
            const dominantTag = TAG_PRIORITY.find(p => tags.includes(p)) || primaryTag;
            const cls  = TAG_BADGE[dominantTag] || 'badge-tag-devam';
            const icon = TAG_ICON[dominantTag]  || 'fa-circle';

            // Tip göstergesi: sevk=kamyon, vade=saat — küçük ek ikon
            const typeIcon = ev.type === 'shipment' ? '🚢' : '📅';
            const tagLabel = tags.slice(0, 2).join(' · ');
            const tooltipText = `${name} | ${ev.order.order_number || '—'} | ${tagLabel}`;

            html += `<span class="cal-event-badge ${cls}"
                data-tooltip="${tooltipText}"
                data-date="${dateStr}"
                data-type="${ev.type}"
                style="font-size:8.5px;">${typeIcon} <i class="fa-solid ${icon}" style="font-size:6px;margin-right:2px;"></i>${shortName}</span>`;
        });
        if (events.length > 3) {
            html += `<span style="font-size:9px;color:var(--ink-3,#968B7A);font-family:Verdana, Geneva, sans-serif;padding:1px 4px;">+${events.length-3} daha</span>`;
        }

        dayNotes.forEach(note => {
            html += `<div class="cal-note-badge" data-note-id="${note.id}" data-note-text="${escapeHtml(note.note_text)}">📌 ${escapeHtml(note.note_text)}</div>`;
        });

        html += `</div>`;
    }

    // Sonraki ay gri hücreleri
    const totalCells = startOffset + daysInMonth;
    const remainder = totalCells % 7;
    const nextCount = remainder === 0 ? 0 : 7 - remainder;
    for (let i = 1; i <= nextCount; i++) {
        html += `<div class="cal-day-cell other-month"><div class="cal-day-number">${i}</div></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Tooltip
    const tooltip = document.getElementById('event-tooltip');
    container.querySelectorAll('[data-tooltip]').forEach(el => {
        el.addEventListener('mouseenter', () => {
            tooltip.textContent = el.getAttribute('data-tooltip');
            tooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', (e) => {
            const ttWidth  = tooltip.offsetWidth;
            const ttHeight = tooltip.offsetHeight;
            const margin = 8;

            let left = e.clientX + 12;
            let top  = e.clientY - 28;

            // Sağ kenardan taşıyorsa imlecin soluna al
            if (left + ttWidth > window.innerWidth - margin) {
                left = e.clientX - ttWidth - 12;
            }
            if (left < margin) left = margin;

            // Üst/alt kenardan taşmasın
            if (top < margin) top = margin;
            if (top + ttHeight > window.innerHeight - margin) {
                top = window.innerHeight - ttHeight - margin;
            }

            tooltip.style.left = left + 'px';
            tooltip.style.top  = top + 'px';
        });
        el.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    });

    // Not ekleme butonu → popover aç
    container.querySelectorAll('.cal-add-note-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openNotePopover({ mode: 'add', dateStr: btn.dataset.noteDate }, btn);
        });
    });

    // Mevcut nota tıklayınca düzenleme/silme popover'ı aç
    container.querySelectorAll('.cal-note-badge').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            openNotePopover({
                mode: 'edit',
                noteId: el.dataset.noteId,
                text: el.dataset.noteText,
            }, el);
        });
    });
}

// ══════════════════════════════
//  NOT POPOVER (Ekle / Düzenle / Sil)
// ══════════════════════════════
let notePopoverState = null; // { mode: 'add'|'edit', dateStr?, noteId? }

function openNotePopover({ mode, dateStr, noteId, text }, anchorEl) {
    notePopoverState = { mode, dateStr, noteId };

    const popover  = document.getElementById('note-popover');
    const textarea = document.getElementById('note-popover-input');
    const deleteBtn = document.getElementById('note-popover-delete');
    const titleEl  = document.getElementById('note-popover-title');

    textarea.value = text || '';
    titleEl.textContent = mode === 'edit' ? 'Notu Düzenle' : 'Not Ekle';
    deleteBtn.classList.toggle('hidden', mode !== 'edit');

    popover.classList.remove('hidden');
    positionNotePopover(popover, anchorEl);
    textarea.focus();
}

function closeNotePopover() {
    document.getElementById('note-popover').classList.add('hidden');
    notePopoverState = null;
}

function positionNotePopover(popover, anchorEl) {
    const rect   = anchorEl.getBoundingClientRect();
    const margin = 8;
    const pw = popover.offsetWidth  || 240;
    const ph = popover.offsetHeight || 140;

    let left = rect.left;
    let top  = rect.bottom + 6;

    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
    if (left < margin) left = margin;

    if (top + ph > window.innerHeight - margin) {
        top = rect.top - ph - 6; // sığmazsa yukarı aç
        if (top < margin) top = margin;
    }

    popover.style.left = left + 'px';
    popover.style.top  = top + 'px';
}

async function saveNotePopover() {
    if (!notePopoverState) return;
    if (!canEdit(ctx, 'order-timeline')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const textarea = document.getElementById('note-popover-input');
    const value = textarea.value.trim();
    if (!value) { textarea.focus(); return; }

    const isAdd = notePopoverState.mode === 'add';
    if (isAdd) {
        const { error } = await supabase.from('calendar_notes').insert([{
            user_id: ctx.ownerId,
            note_date: notePopoverState.dateStr,
            note_text: value,
        }]);
        if (error) { console.error('Not eklenemedi:', error); await showAlertDialog('Not eklenemedi: ' + error.message, { variant: 'danger' }); return; }
    } else {
        const { error } = await supabase.from('calendar_notes')
            .update({ note_text: value })
            .eq('id', notePopoverState.noteId)
            .eq('user_id', ctx.ownerId);
        if (error) { console.error('Not güncellenemedi:', error); await showAlertDialog('Not güncellenemedi: ' + error.message, { variant: 'danger' }); return; }
    }
    logChange({ ctx, moduleId: 'order-timeline', action: isAdd ? 'create' : 'update', summary: `Takvim notu ${isAdd ? 'eklendi' : 'güncellendi'}: ${value.slice(0, 60)}` });
    closeNotePopover();
    await loadNotes();
    renderCalendar();
}

async function deleteNotePopover() {
    if (!notePopoverState || notePopoverState.mode !== 'edit') return;
    if (!canEdit(ctx, 'order-timeline')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const { error } = await supabase.from('calendar_notes')
        .delete().eq('id', notePopoverState.noteId).eq('user_id', ctx.ownerId);
    if (error) { console.error('Not silinemedi:', error); await showAlertDialog('Not silinemedi: ' + error.message, { variant: 'danger' }); return; }
    logChange({ ctx, moduleId: 'order-timeline', action: 'delete', summary: `Takvim notu silindi` });
    closeNotePopover();
    await loadNotes();
    renderCalendar();
}

document.getElementById('note-popover-save').addEventListener('click', saveNotePopover);
document.getElementById('note-popover-delete').addEventListener('click', deleteNotePopover);
document.getElementById('note-popover-cancel').addEventListener('click', closeNotePopover);

document.getElementById('note-popover-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNotePopover(); }
    if (e.key === 'Escape') closeNotePopover();
});

document.addEventListener('click', (e) => {
    const popover = document.getElementById('note-popover');
    if (popover.classList.contains('hidden')) return;
    if (popover.contains(e.target)) return;
    if (e.target.closest('.cal-add-note-btn') || e.target.closest('.cal-note-badge')) return;
    closeNotePopover();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNotePopover();
});

// ══════════════════════════════
//  LİSTE GÖRÜNÜMÜ
// ══════════════════════════════
function renderList() {
    const body = document.getElementById('list-body');
    const empty = document.getElementById('list-empty');
    const today = new Date(); today.setHours(0,0,0,0);
    const in7 = new Date(today); in7.setDate(in7.getDate()+7);

    const filtered = getFiltered();

    if (filtered.length === 0) {
        body.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    const fmt = (dateStr) => {
        if (!dateStr) return '<span style="color:var(--ink-3,#968B7A);">—</span>';
        const d = new Date(dateStr);
        return d.toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'numeric' });
    };

    const CLOSED_TAGS_LIST = ['Ödeme Tamamlandı', 'Teslim Edildi', 'İptal'];
    const dueBadge = (dateStr, o) => {
        if (!dateStr) return '<span style="color:var(--ink-3);">—</span>';
        const d = new Date(dateStr); d.setHours(0,0,0,0);
        const tags = (o.status_tags && o.status_tags.length > 0) ? o.status_tags : [o.order_status || ''];
        const isDone = tags.some(t => CLOSED_TAGS_LIST.includes(t));
        if (isDone) return `<span class="status-badge status-ok"><i class="fa-solid fa-check" style="font-size:8px;"></i> Kapandı</span>`;
        if (d < today) return `<span class="status-badge status-danger"><i class="fa-solid fa-circle-exclamation" style="font-size:8px;"></i> Gecikiyor</span>`;
        if (d <= in7) return `<span class="status-badge status-warn"><i class="fa-solid fa-clock" style="font-size:8px;"></i> Yaklaşıyor</span>`;
        return `<span class="status-badge status-ok"><i class="fa-solid fa-circle-check" style="font-size:8px;"></i> Zamanında</span>`;
    };

    const getOrderTags = (o) => (o.status_tags && o.status_tags.length > 0)
        ? o.status_tags : [o.order_status || 'Devam Ediyor'];

    const TAG_PRIORITY_LIST = [
        'İptal', 'Gecikme',
        'Teslim Edildi', 'Ödeme Tamamlandı',
        'Bakiye Bekliyor',
        'Sevk Edildi', 'Sevke Hazır',
        'Üretimde', 'Üretime Hazır',
        'Yeni Müşteri', 'Devam Ediyor',
    ];
    const tagBadgeClass = (tag) => {
        const map = {
            'Devam Ediyor':    'status-info',
            'Üretimde':        'status-bronze',
            'Üretime Hazır':   'status-bronze',
            'Sevke Hazır':     'status-info',
            'Sevk Edildi':     'status-info',
            'Bakiye Bekliyor': 'status-warn',
            'Ödeme Tamamlandı':'status-ok',
            'Teslim Edildi':   'status-ok',
            'İptal':           'status-danger',
            'Gecikme':         'status-danger',
            'Yeni Müşteri':    'status-info',
        };
        return map[tag] || 'status-info';
    };

    const orderBadge = (o) => {
        const tags = getOrderTags(o);
        // Dominant tag önce göster, diğerleri ardından
        const dominant = TAG_PRIORITY_LIST.find(p => tags.includes(p)) || tags[0];
        const sorted = [dominant, ...tags.filter(t => t !== dominant)];
        return sorted.map(t =>
            `<span class="status-badge ${tagBadgeClass(t)}" style="margin-right:2px;">${t}</span>`
        ).join('');
    };

    body.innerHTML = filtered.map(o => {
        const company = o.customers?.company_name || '—';
        return `<div class="timeline-row" style="font-size:12px;color:var(--ink-2,#6B655B);">
            <div>
                <div style="font-weight:600;color:var(--ink-1,#1C1A17);font-size:12px;">${company}</div>
                <div style="font-size:10px;color:var(--ink-3,#968B7A);margin-top:1px;">${o.order_number||'—'}</div>
            </div>
            <div>${fmt(o.order_date)}</div>
            <div>${fmt(o.shipment_date)}</div>
            <div>${fmt(o.due_date)}</div>
            <div>${dueBadge(o.due_date, o)}</div>
            <div>${orderBadge(o)}</div>
        </div>`;
    }).join('');
}

// ══════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════

document.getElementById('btn-view-calendar').addEventListener('click', () => {
    currentView = 'calendar';
    document.getElementById('view-calendar').style.display = 'block';
    document.getElementById('view-list').style.display = 'none';
    document.getElementById('btn-view-calendar').classList.add('active');
    document.getElementById('btn-view-list').classList.remove('active');
    render();
});
document.getElementById('btn-view-list').addEventListener('click', () => {
    currentView = 'list';
    document.getElementById('view-calendar').style.display = 'none';
    document.getElementById('view-list').style.display = 'block';
    document.getElementById('btn-view-list').classList.add('active');
    document.getElementById('btn-view-calendar').classList.remove('active');
    render();
});

document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
});

document.getElementById('filter-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
});

document.getElementById('btn-show-overdue').addEventListener('click', () => {
    currentFilter = 'overdue';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-filter="overdue"]')?.classList.add('active');
    currentView = 'list';
    document.getElementById('view-calendar').style.display = 'none';
    document.getElementById('view-list').style.display = 'block';
    document.getElementById('btn-view-list').classList.add('active');
    document.getElementById('btn-view-calendar').classList.remove('active');
    render();
});

// ── Başlat
init().then(async (ok) => {
    if (!ok) return;
    await loadNotes();
    await loadOrders();
});
