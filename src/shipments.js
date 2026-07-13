import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';

// ── Global veri depoları ──────────────────────────────────────────────────────
let globalShipments = [];
let globalOrders    = [];
let editingId       = null;
let ctx = null;

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'shipments'))) return;

    await renderNavbar('shipments', ctx);
    initEventListeners();
    await loadData(session);
    applyEditLock(ctx, 'shipments');
});

// ── Olay Dinleyicileri ────────────────────────────────────────────────────────
function initEventListeners() {
    // Yenile
    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
        const icon = document.querySelector('#btn-refresh i');
        icon?.classList.add('fa-spin');
        const { data: { session } } = await supabase.auth.getSession();
        await loadData(session);
        setTimeout(() => icon?.classList.remove('fa-spin'), 400);
    });

    // Yeni sevkiyat aç
    document.getElementById('btn-new')?.addEventListener('click', () => openModal());

    // Modal kapat
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-overlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('modal-overlay')) closeModal();
    });

    // Silme modalı
    document.getElementById('delete-cancel')?.addEventListener('click', closeDeleteModal);
    document.getElementById('delete-overlay')?.addEventListener('click', e => {
        if (e.target === document.getElementById('delete-overlay')) closeDeleteModal();
    });
    document.getElementById('delete-confirm')?.addEventListener('click', confirmDelete);

    // Form kaydet
    document.getElementById('shipment-form')?.addEventListener('submit', handleFormSubmit);

    // Filtreler
    document.getElementById('filter-carrier')?.addEventListener('change', applyFilters);
    document.getElementById('filter-port')?.addEventListener('change', applyFilters);
    document.getElementById('filter-date-from')?.addEventListener('change', applyFilters);
    document.getElementById('filter-date-to')?.addEventListener('change', applyFilters);
    document.getElementById('btn-clear-filters')?.addEventListener('click', clearFilters);
}

// ── Veri Yükleme ─────────────────────────────────────────────────────────────
async function loadData(session) {
    try {
        // orders↔customers arasında birden fazla FK olabileceğinden embed kullanmıyoruz;
        // payments.js ile aynı pattern: her tabloyu ayrı çek, JS'de birleştir.
        const [
            { data: shipments, error: shipErr },
            { data: orders,    error: ordErr  },
            { data: customers, error: custErr }
        ] = await Promise.all([
            supabase
                .from('shipments')
                .select('*')
                .eq('user_id', session.user.id)
                .order('created_at', { ascending: false }),
            supabase
                .from('orders')
                .select('id, order_number, customer_id')
                .eq('user_id', session.user.id)
                .order('order_number', { ascending: false }),
            supabase
                .from('customers')
                .select('id, company_name, country')
                .eq('user_id', session.user.id)
        ]);

        if (shipErr) throw shipErr;
        if (ordErr)  throw ordErr;
        if (custErr) throw custErr;

        // Müşteri map'i: customer_id → { company_name, country }
        const custMap = {};
        (customers || []).forEach(c => { custMap[c.id] = c; });

        // Order map'i oluştur: order_id → { order_number, company_name, country }
        globalOrders = orders || [];
        const orderMap = {};
        globalOrders.forEach(o => {
            const cust = custMap[o.customer_id] || {};
            orderMap[o.id] = {
                order_number: o.order_number,
                company_name: cust.company_name || '—',
                country:      cust.country      || ''
            };
        });

        globalShipments = (shipments || []).map(s => ({
            ...s,
            _order: orderMap[s.order_id] || { order_number: '?', company_name: '—', country: '' }
        }));

        populateOrderDropdown(custMap);
        populateFilterDropdowns();
        renderKPIs();
        renderTable(globalShipments);

    } catch (err) {
        console.error('Sevkiyat veri hatası:', err.message);
        showError('Veriler yüklenirken hata: ' + err.message);
    }
}

// ── Sipariş Dropdown ─────────────────────────────────────────────────────────
function populateOrderDropdown(custMap) {
    const sel = document.getElementById('form-order-id');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Sipariş Seçiniz —</option>';
    globalOrders.forEach(o => {
        const cust = custMap[o.customer_id] || {};
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `${o.order_number} — ${cust.company_name || '?'} (${cust.country || ''})`;
        sel.appendChild(opt);
    });
}

// ── Filtre Dropdown'larını Doldur ─────────────────────────────────────────────
function populateFilterDropdowns() {
    const carriers = [...new Set(globalShipments.map(s => s.carrier).filter(Boolean))].sort();
    const ports    = [...new Set([
        ...globalShipments.map(s => s.port_of_loading),
        ...globalShipments.map(s => s.port_of_discharge)
    ].filter(Boolean))].sort();

    const carrierSel = document.getElementById('filter-carrier');
    const portSel    = document.getElementById('filter-port');

    if (carrierSel) {
        const cur = carrierSel.value;
        carrierSel.innerHTML = '<option value="">Tüm Taşıyıcılar</option>';
        carriers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            if (c === cur) opt.selected = true;
            carrierSel.appendChild(opt);
        });
    }
    if (portSel) {
        const cur = portSel.value;
        portSel.innerHTML = '<option value="">Tüm Limanlar</option>';
        ports.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p; opt.textContent = p;
            if (p === cur) opt.selected = true;
            portSel.appendChild(opt);
        });
    }
}

// ── KPI Kartları ──────────────────────────────────────────────────────────────
function renderKPIs() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Aktif sevkiyat (ETA > bugün)
    const active = globalShipments.filter(s => s.eta && new Date(s.eta) > today).length;

    // 2. Bu ay navlun (USD bazında — basit toplam, USD kabulü)
    const thisMonth = today.getMonth();
    const thisYear  = today.getFullYear();
    let monthlyFreight = 0;
    globalShipments.forEach(s => {
        if (!s.etd) return;
        const d = new Date(s.etd);
        if (d.getMonth() === thisMonth && d.getFullYear() === thisYear && s.freight_cost) {
            monthlyFreight += parseFloat(s.freight_cost) || 0;
        }
    });

    // 3. Ortalama transit süresi (ETA - ETD, gün)
    const transits = globalShipments
        .filter(s => s.etd && s.eta)
        .map(s => (new Date(s.eta) - new Date(s.etd)) / 86400000)
        .filter(d => d > 0);
    const avgTransit = transits.length
        ? Math.round(transits.reduce((a, b) => a + b, 0) / transits.length)
        : 0;

    document.getElementById('kpi-active').textContent  = active;
    document.getElementById('kpi-freight').textContent = '$' + monthlyFreight.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    document.getElementById('kpi-transit').textContent = avgTransit + ' gün';
    document.getElementById('kpi-total').textContent   = globalShipments.length;
}

// ── Filtre Uygula ─────────────────────────────────────────────────────────────
function applyFilters() {
    const carrier  = document.getElementById('filter-carrier')?.value  || '';
    const port     = document.getElementById('filter-port')?.value     || '';
    const dateFrom = document.getElementById('filter-date-from')?.value || '';
    const dateTo   = document.getElementById('filter-date-to')?.value   || '';

    let list = globalShipments;

    if (carrier)  list = list.filter(s => s.carrier === carrier);
    if (port)     list = list.filter(s => s.port_of_loading === port || s.port_of_discharge === port);
    if (dateFrom) list = list.filter(s => s.etd && s.etd >= dateFrom);
    if (dateTo)   list = list.filter(s => s.etd && s.etd <= dateTo);

    renderTable(list);
}

function clearFilters() {
    document.getElementById('filter-carrier').value   = '';
    document.getElementById('filter-port').value      = '';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value   = '';
    renderTable(globalShipments);
}

// ── Tablo Render ──────────────────────────────────────────────────────────────
function renderTable(list) {
    const tbody = document.getElementById('shipments-tbody');
    const badge = document.getElementById('shipments-count');
    if (!tbody) return;

    badge && (badge.textContent = `${list.length} Kayıt`);

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10" style="color:#968B7A;">Kayıt bulunamadı.</td></tr>`;
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currSym = { USD: '$', EUR: '€', TRY: '₺', GBP: '£' };

    tbody.innerHTML = list.map(s => {
        const etaDate = s.eta ? new Date(s.eta) : null;
        const etdDate = s.etd ? new Date(s.etd) : null;
        const isActive  = etaDate && etaDate > today;
        const isPast    = etaDate && etaDate <= today;

        let statusBadge = '';
        if (isActive)  statusBadge = `<span class="badge badge-active">Aktif</span>`;
        else if (isPast) statusBadge = `<span class="badge badge-done">Tamamlandı</span>`;
        else             statusBadge = `<span class="badge badge-grey">Tarih Yok</span>`;

        const transitDays = etdDate && etaDate
            ? Math.round((etaDate - etdDate) / 86400000)
            : '—';

        const freightStr = s.freight_cost
            ? `${currSym[s.freight_currency] || s.freight_currency || ''}${parseFloat(s.freight_cost).toLocaleString('tr-TR')}`
            : '—';

        return `<tr>
            <td>${statusBadge}</td>
            <td>
                <div style="font-weight:600;color:#1C1A17;font-size:13px;">${s._order.company_name}</div>
                <div style="font-size:11px;color:#968B7A;">${s._order.country}</div>
            </td>
            <td style="font-weight:600;color:#2D4A3E;">${s._order.order_number || '—'}</td>
            <td style="font-size:12px;color:#3A3530;">${s.bl_number || '—'}</td>
            <td style="font-size:12px;color:#3A3530;">${s.carrier || '—'}</td>
            <td style="font-size:12px;color:#3A3530;">${s.container_number || '—'}</td>
            <td style="font-size:12px;">
                <div style="color:#3A3530;">${fmtDate(s.etd)}</div>
                <div style="font-size:11px;color:#968B7A;">ETD</div>
            </td>
            <td style="font-size:12px;">
                <div style="color:#3A3530;">${fmtDate(s.eta)}</div>
                <div style="font-size:11px;color:#968B7A;">ETA — ${transitDays !== '—' ? transitDays + 'g' : '—'}</div>
            </td>
            <td style="font-size:12px;color:#3A3530;">${freightStr}</td>
            <td>
                <div style="display:flex;gap:6px;justify-content:center;">
                    <button onclick="openModal('${s.id}')"
                        style="width:28px;height:28px;border-radius:6px;border:1px solid #E4DDCE;background:#fff;color:#6B655B;cursor:pointer;font-size:11px;">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="openDeleteModal('${s.id}')"
                        style="width:28px;height:28px;border-radius:6px;border:1px solid #FECACA;background:#FEF2F2;color:#9F3D3D;cursor:pointer;font-size:11px;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── Modal Aç/Kapat ────────────────────────────────────────────────────────────
window.openModal = function(id = null) {
    editingId = id;
    const overlay = document.getElementById('modal-overlay');
    const title   = document.getElementById('modal-title');
    const form    = document.getElementById('shipment-form');

    form.reset();

    if (id) {
        const s = globalShipments.find(x => x.id === id);
        if (!s) return;
        title.textContent = 'Sevkiyat Düzenle';
        document.getElementById('form-order-id').value         = s.order_id || '';
        document.getElementById('form-bl-number').value        = s.bl_number || '';
        document.getElementById('form-carrier').value          = s.carrier || '';
        document.getElementById('form-container').value        = s.container_number || '';
        document.getElementById('form-etd').value              = s.etd || '';
        document.getElementById('form-eta').value              = s.eta || '';
        document.getElementById('form-freight-cost').value     = s.freight_cost || '';
        document.getElementById('form-freight-currency').value = s.freight_currency || 'USD';
        document.getElementById('form-port-loading').value     = s.port_of_loading || '';
        document.getElementById('form-port-discharge').value   = s.port_of_discharge || '';
        document.getElementById('form-notes').value            = s.notes || '';
    } else {
        title.textContent = 'Yeni Sevkiyat';
        document.getElementById('form-freight-currency').value = 'USD';
    }

    overlay.classList.remove('hidden');
};

function closeModal() {
    document.getElementById('modal-overlay')?.classList.add('hidden');
    editingId = null;
}

// ── Silme Modal ───────────────────────────────────────────────────────────────
let deletingId = null;
window.openDeleteModal = function(id) {
    deletingId = id;
    document.getElementById('delete-overlay')?.classList.remove('hidden');
};
function closeDeleteModal() {
    deletingId = null;
    document.getElementById('delete-overlay')?.classList.add('hidden');
}
async function confirmDelete() {
    if (!deletingId) return;
    if (!canEdit(ctx, 'shipments')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    try {
        const { error } = await supabase.from('shipments').delete().eq('id', deletingId);
        if (error) throw error;
        logChange({ ctx, moduleId: 'shipments', action: 'delete', summary: `Sevkiyat kaydı silindi (${deletingId})` });
        closeDeleteModal();
        const { data: { session } } = await supabase.auth.getSession();
        await loadData(session);
    } catch (err) {
        await showAlertDialog('Silme hatası: ' + err.message, { variant: 'danger' });
    }
}

// ── Form Submit ───────────────────────────────────────────────────────────────
async function handleFormSubmit(e) {
    e.preventDefault();
    if (!canEdit(ctx, 'shipments')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const btn = document.getElementById('form-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor...';

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const payload = {
            user_id:           session.user.id,
            order_id:          document.getElementById('form-order-id').value,
            bl_number:         document.getElementById('form-bl-number').value.trim()    || null,
            carrier:           document.getElementById('form-carrier').value.trim()       || null,
            container_number:  document.getElementById('form-container').value.trim()    || null,
            etd:               document.getElementById('form-etd').value                 || null,
            eta:               document.getElementById('form-eta').value                 || null,
            freight_cost:      parseFloat(document.getElementById('form-freight-cost').value) || null,
            freight_currency:  document.getElementById('form-freight-currency').value    || 'USD',
            port_of_loading:   document.getElementById('form-port-loading').value.trim() || null,
            port_of_discharge: document.getElementById('form-port-discharge').value.trim()|| null,
            notes:             document.getElementById('form-notes').value.trim()        || null,
        };

        if (!payload.order_id) {
            await showAlertDialog('Lütfen sipariş seçiniz.', { variant: 'warn' });
            return;
        }

        let error;
        if (editingId) {
            ({ error } = await supabase.from('shipments').update(payload).eq('id', editingId));
            if (!error) logChange({ ctx, moduleId: 'shipments', action: 'update', summary: `Sevkiyat güncellendi: ${payload.bl_number || editingId}` });
        } else {
            ({ error } = await supabase.from('shipments').insert([payload]));
            if (!error) logChange({ ctx, moduleId: 'shipments', action: 'create', summary: `Sevkiyat oluşturuldu: ${payload.bl_number || payload.order_id}` });
        }

        if (error) throw error;
        closeModal();
        await loadData(session);
    } catch (err) {
        await showAlertDialog('Kayıt hatası: ' + err.message, { variant: 'danger' });
    } finally {
        btn.disabled = false;
        btn.textContent = 'Kaydet';
    }
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function fmtDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
}

function showError(msg) {
    const tbody = document.getElementById('shipments-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6" style="color:#9F3D3D;">${msg}</td></tr>`;
}
