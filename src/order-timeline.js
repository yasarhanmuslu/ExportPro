import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';

// ── Auth kontrolü
const { data: { session } } = await supabase.auth.getSession();
if (!session) { window.location.href = 'login.html'; }
await renderNavbar('order-timeline');

// ── State
let allOrders = [];
let currentFilter = 'all';
let currentView = 'calendar';
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based

// ── Supabase'den siparişleri çek
async function loadOrders() {
    const { data, error } = await supabase
        .from('orders')
        .select('*, customers(company_name)')
        .eq('user_id', session.user.id)
        .order('due_date', { ascending: true });

    if (error) { console.error('Orders load error:', error); return; }
    allOrders = data || [];
    updateOverdueAlert();
    render();
}

// ── Geciken sipariş uyarısı
function updateOverdueAlert() {
    const today = new Date(); today.setHours(0,0,0,0);
    const overdue = allOrders.filter(o => {
        if (!o.due_date) return false;
        if (o.production_status === 'Tamamlandı') return false;
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

    return allOrders.filter(o => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'active') {
            return o.production_status !== 'Tamamlandı' && o.production_status !== 'Sevk Edildi';
        }
        if (currentFilter === 'overdue') {
            if (!o.due_date) return false;
            if (o.production_status === 'Tamamlandı') return false;
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
        addEvent(o.order_date, 'order', o);
        addEvent(o.shipment_date, 'shipment', o);
        addEvent(o.due_date, 'due', o);
    });

    // Ayın 1. günü hangi gün?
    const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
    const startOffset = (firstDay === 0) ? 6 : firstDay - 1; // Mon-based
    const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
    const prevDays = new Date(calYear, calMonth, 0).getDate();

    const dayLabels = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

    let html = `<div class="calendar-grid">`;
    // Header
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

        html += `<div class="cal-day-cell${isToday?' today':''}">`;
        html += `<div class="cal-day-number">${d}</div>`;

        // Max 3 event göster
        const visible = events.slice(0, 3);
        visible.forEach(ev => {
            const name = ev.order.customers?.company_name || 'Müşteri';
            const shortName = name.length > 14 ? name.slice(0,13)+'…' : name;
            const isOverdue = ev.type === 'due' && new Date(ev.order.due_date) < today && ev.order.production_status !== 'Tamamlandı';
            let cls = 'badge-order';
            let icon = 'fa-circle';
            if (ev.type === 'shipment') { cls = 'badge-shipment'; icon = 'fa-truck'; }
            if (ev.type === 'due') { cls = isOverdue ? 'badge-due' : 'badge-due-ok'; icon = 'fa-clock'; }
            const tooltipText = `${name} | ${ev.order.order_number || '—'}`;
            html += `<span class="cal-event-badge ${cls}"
                data-tooltip="${tooltipText}"
                data-date="${dateStr}"
                data-type="${ev.type}"
                style="font-size:8.5px;"><i class="fa-solid ${icon}" style="font-size:6px;margin-right:2px;"></i>${shortName}</span>`;
        });
        if (events.length > 3) {
            html += `<span style="font-size:9px;color:var(--ink-3,#968B7A);font-family:'DM Sans',sans-serif;padding:1px 4px;">+${events.length-3} daha</span>`;
        }

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
        el.addEventListener('mouseenter', (e) => {
            tooltip.textContent = el.getAttribute('data-tooltip');
            tooltip.style.display = 'block';
        });
        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = (e.clientX + 12) + 'px';
            tooltip.style.top  = (e.clientY - 28) + 'px';
        });
        el.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    });
}

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

    const dueBadge = (dateStr, productionStatus) => {
        if (!dateStr) return '<span style="color:var(--ink-3);">—</span>';
        const d = new Date(dateStr); d.setHours(0,0,0,0);
        const isDone = productionStatus === 'Tamamlandı' || productionStatus === 'Sevk Edildi';
        if (isDone) return `<span class="status-badge status-ok"><i class="fa-solid fa-check" style="font-size:8px;"></i> Zamanında</span>`;
        if (d < today) return `<span class="status-badge status-danger"><i class="fa-solid fa-circle-exclamation" style="font-size:8px;"></i> Gecikiyor</span>`;
        if (d <= in7) return `<span class="status-badge status-warn"><i class="fa-solid fa-clock" style="font-size:8px;"></i> Yaklaşıyor</span>`;
        return `<span class="status-badge status-ok"><i class="fa-solid fa-circle-check" style="font-size:8px;"></i> Zamanında</span>`;
    };

    const prodBadge = (s) => {
        const map = {
            'Bekliyor':    'status-info',
            'Üretimde':    'status-bronze',
            'Hazır':       'status-warn',
            'Sevk Edildi': 'status-ok',
            'Tamamlandı':  'status-ok',
        };
        return `<span class="status-badge ${map[s]||'status-info'}">${s||'—'}</span>`;
    };

    const payBadge = (s) => {
        const map = {
            'Ödenmedi':       'status-danger',
            'Kısmen Ödendi':  'status-warn',
            'Ödendi':         'status-ok',
        };
        return `<span class="status-badge ${map[s]||'status-info'}">${s||'—'}</span>`;
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
            <div>${dueBadge(o.due_date, o.production_status)}</div>
            <div>${prodBadge(o.production_status)}</div>
            <div>${payBadge(o.payment_status)}</div>
        </div>`;
    }).join('');
}

// ══════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════

// Görünüm toggle
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

// Takvim navigasyon
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

// Filtre butonları
document.getElementById('filter-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
});

// Geciken göster butonu
document.getElementById('btn-show-overdue').addEventListener('click', () => {
    currentFilter = 'overdue';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-filter="overdue"]')?.classList.add('active');
    // Liste görünümüne geç
    currentView = 'list';
    document.getElementById('view-calendar').style.display = 'none';
    document.getElementById('view-list').style.display = 'block';
    document.getElementById('btn-view-list').classList.add('active');
    document.getElementById('btn-view-calendar').classList.remove('active');
    render();
});

// ── Başlat
await loadOrders();
