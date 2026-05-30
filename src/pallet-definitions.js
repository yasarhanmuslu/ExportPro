import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// ─────────────────────────────────────────────
// SABİTLER
// ─────────────────────────────────────────────
const TARE_BY_TYPE = { 'EUR1': 25, 'EUR3': 35, 'Non-Euro': 0, 'Diğer': 0 };

// ─────────────────────────────────────────────
// DURUM
// ─────────────────────────────────────────────
let globalPallets  = [];
let globalProducts = [];
let itemsBuffer    = [];      // { product_id, product_name, product_code, quantity, unit_gross_weight }
let editingId      = null;
let weightOverride = false;   // kullanıcı toplam ağırlığı elle değiştirdi mi
let sessionRef     = null;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    sessionRef = session;
    await renderNavbar('pallet-defs');
    await Promise.all([fetchProducts(session), fetchPallets(session)]);
    initEvents();
});

// ─────────────────────────────────────────────
// VERİ ÇEKME
// ─────────────────────────────────────────────
async function fetchProducts(session) {
    const { data, error } = await supabase
        .from('products')
        .select('id, product_code, product_name, gross_weight')
        .eq('user_id', session.user.id)
        .order('product_name', { ascending: true });
    if (error) { console.error('Ürünler yüklenemedi:', error.message); return; }
    globalProducts = data || [];
}

async function fetchPallets(session) {
    const { data, error } = await supabase
        .from('pallet_definitions')
        .select('*, pallet_items(*)')
        .eq('user_id', session.user.id)
        .order('name', { ascending: true });
    if (error) { console.error('Paletler yüklenemedi:', error.message); return; }
    globalPallets = data || [];
    renderTable();
    computeStats();
}

// ─────────────────────────────────────────────
// YARDIMCILAR
// ─────────────────────────────────────────────
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtKg   = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
const fmtNum  = (n) => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 1 });

// ─────────────────────────────────────────────
// TABLO RENDER
// ─────────────────────────────────────────────
function renderTable() {
    const tbody = document.getElementById('pallet-table-body');
    const search = (document.getElementById('search-input').value || '').trim().toLowerCase();
    const typeF  = document.getElementById('filter-type').value;

    let rows = globalPallets.filter(p => {
        const matchSearch = !search ||
            (p.name || '').toLowerCase().includes(search) ||
            (p.pallet_type || '').toLowerCase().includes(search);
        const matchType = !typeF || p.pallet_type === typeF;
        return matchSearch && matchType;
    });

    document.getElementById('btn-search-clear').classList.toggle('hidden', !search);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-[var(--text-secondary)] py-12">Kayıt bulunamadı.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(p => {
        const dims = [p.width_cm, p.length_cm, p.height_cm].map(fmtNum).join(' × ');
        const variety = (p.pallet_items || []).length;
        const stackBadge = p.stackable
            ? `<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-[#3D6E50]"><i class="fa-solid fa-layer-group text-[10px]"></i>Evet</span>`
            : `<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-500/10 text-[var(--text-secondary)]">Hayır</span>`;
        const layer = (p.stackable && p.stack_strength) ? p.stack_strength : '—';
        return `
        <tr class="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
            <td class="px-4 py-3 font-medium text-[var(--text-primary)]">${escHtml(p.name)}</td>
            <td class="px-4 py-3 text-[var(--text-secondary)]">${escHtml(p.pallet_type)}</td>
            <td class="px-4 py-3 text-right text-[var(--text-secondary)]">${dims}</td>
            <td class="px-4 py-3 text-center">${stackBadge}</td>
            <td class="px-4 py-3 text-center text-[var(--text-secondary)]">${layer}</td>
            <td class="px-4 py-3 text-right text-[var(--text-secondary)]">${variety} çeşit</td>
            <td class="px-4 py-3 text-right font-medium text-[var(--text-primary)]">${fmtKg(p.total_weight)}</td>
            <td class="px-4 py-3 text-center">
                <button class="btn-edit text-[var(--text-secondary)] hover:text-[#2D4A3E] transition-colors px-2" data-id="${p.id}" title="Düzenle">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-edit').forEach(b =>
        b.addEventListener('click', () => openEdit(b.dataset.id)));
}

function computeStats() {
    const total = globalPallets.length;
    const stackable = globalPallets.filter(p => p.stackable).length;
    const euro = globalPallets.filter(p => p.pallet_type === 'EUR1' || p.pallet_type === 'EUR3').length;
    const weights = globalPallets.map(p => Number(p.total_weight)).filter(n => !isNaN(n) && n > 0);
    const avg = weights.length ? (weights.reduce((a, b) => a + b, 0) / weights.length) : 0;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-stackable').textContent = stackable;
    document.getElementById('stat-euro').textContent = euro;
    document.getElementById('stat-avg-weight').textContent = avg ? avg.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '—';
}

// ─────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────
function openCreate() {
    editingId = null;
    weightOverride = false;
    itemsBuffer = [];
    document.getElementById('modal-pallet-title').textContent = 'Yeni Palet';
    document.getElementById('pallet-id').value = '';
    document.getElementById('pallet-name').value = '';
    document.getElementById('pallet-w').value = '';
    document.getElementById('pallet-l').value = '';
    document.getElementById('pallet-h').value = '';
    document.getElementById('pallet-type').value = 'EUR1';
    document.getElementById('pallet-stackable').checked = true;
    document.getElementById('pallet-stack-strength').value = '1';
    document.getElementById('pallet-total-weight').value = '';
    document.getElementById('pallet-notes').value = '';
    document.getElementById('modal-pallet-delete').classList.add('hidden');
    syncStackUI();
    renderItems();
    recalcWeight(true);
    showModal();
}

function openEdit(id) {
    const p = globalPallets.find(x => x.id === id);
    if (!p) return;
    editingId = id;
    weightOverride = !!p.weight_override;
    itemsBuffer = (p.pallet_items || []).map(it => ({
        product_id: it.product_id || null,
        product_name: it.product_name || '',
        product_code: it.product_code || '',
        quantity: Number(it.quantity) || 0,
        unit_gross_weight: it.unit_gross_weight != null ? Number(it.unit_gross_weight) : null,
    }));
    document.getElementById('modal-pallet-title').textContent = 'Palet Düzenle';
    document.getElementById('pallet-id').value = p.id;
    document.getElementById('pallet-name').value = p.name || '';
    document.getElementById('pallet-w').value = p.width_cm ?? '';
    document.getElementById('pallet-l').value = p.length_cm ?? '';
    document.getElementById('pallet-h').value = p.height_cm ?? '';
    document.getElementById('pallet-type').value = p.pallet_type || 'EUR1';
    document.getElementById('pallet-stackable').checked = !!p.stackable;
    document.getElementById('pallet-stack-strength').value = String(p.stack_strength || 1);
    document.getElementById('pallet-total-weight').value = p.total_weight ?? '';
    document.getElementById('pallet-notes').value = p.notes || '';
    document.getElementById('modal-pallet-delete').classList.remove('hidden');
    syncStackUI();
    renderItems();
    updateWeightSummary();   // mevcut toplamı koru, override durumunu yansıt
    showModal();
}

function showModal() {
    const m = document.getElementById('modal-pallet');
    m.classList.remove('hidden'); m.classList.add('flex');
}
function closeModal() {
    const m = document.getElementById('modal-pallet');
    m.classList.add('hidden'); m.classList.remove('flex');
}

// İstiflenebilir checkbox -> katman alanını aç/kapat
function syncStackUI() {
    const on = document.getElementById('pallet-stackable').checked;
    document.getElementById('pallet-stackable-label').textContent = on ? 'Evet' : 'Hayır';
    document.getElementById('stack-strength-wrap').style.opacity = on ? '1' : '0.4';
    document.getElementById('pallet-stack-strength').disabled = !on;
}

// ─────────────────────────────────────────────
// ÜRÜN KALEMLERİ
// ─────────────────────────────────────────────
function renderItems() {
    const container = document.getElementById('items-container');
    const empty = document.getElementById('items-empty');
    empty.classList.toggle('hidden', itemsBuffer.length > 0);

    container.innerHTML = itemsBuffer.map((it, idx) => {
        const opts = globalProducts.map(p =>
            `<option value="${p.id}" ${it.product_id === p.id ? 'selected' : ''}>${escHtml(p.product_name)}${p.product_code ? ' ('+escHtml(p.product_code)+')' : ''}</option>`
        ).join('');
        const lineW = (Number(it.unit_gross_weight) || 0) * (Number(it.quantity) || 0);
        return `
        <div class="item-row grid grid-cols-12 gap-2 items-center bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-2" data-idx="${idx}">
            <div class="col-span-6">
                <select class="item-product w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs focus:outline-none" data-idx="${idx}">
                    <option value="">-- Ürün Seç --</option>
                    ${opts}
                </select>
                <input type="text" class="item-name w-full mt-1 px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-[11px] focus:outline-none" placeholder="veya serbest metin" value="${escHtml(it.product_name)}" data-idx="${idx}">
            </div>
            <div class="col-span-2">
                <input type="number" min="0" step="any" class="item-qty w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs text-right focus:outline-none" placeholder="Adet" value="${it.quantity || ''}" data-idx="${idx}">
            </div>
            <div class="col-span-2">
                <input type="number" min="0" step="0.01" class="item-uw w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs text-right focus:outline-none" placeholder="Br.kg" value="${it.unit_gross_weight ?? ''}" data-idx="${idx}" title="Birim brüt ağırlık (kg)">
            </div>
            <div class="col-span-1 text-right text-[11px] text-[var(--text-secondary)] font-mono">${lineW ? lineW.toLocaleString('tr-TR', {maximumFractionDigits:2}) : '—'}</div>
            <div class="col-span-1 text-center">
                <button type="button" class="item-remove text-[#9F3D3D] hover:opacity-70 transition-opacity px-1" data-idx="${idx}"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>`;
    }).join('');

    // Ürün seçimi -> isim/kod/birim ağırlık otomatik doldur
    container.querySelectorAll('.item-product').forEach(sel => sel.addEventListener('change', e => {
        const idx = +e.target.dataset.idx;
        const prod = globalProducts.find(p => p.id === e.target.value);
        if (prod) {
            itemsBuffer[idx].product_id = prod.id;
            itemsBuffer[idx].product_name = prod.product_name;
            itemsBuffer[idx].product_code = prod.product_code || '';
            itemsBuffer[idx].unit_gross_weight = prod.gross_weight != null ? Number(prod.gross_weight) : null;
        } else {
            itemsBuffer[idx].product_id = null;
        }
        renderItems();
        recalcWeight();
    }));
    container.querySelectorAll('.item-name').forEach(inp => inp.addEventListener('input', e => {
        itemsBuffer[+e.target.dataset.idx].product_name = e.target.value;
    }));
    container.querySelectorAll('.item-qty').forEach(inp => inp.addEventListener('input', e => {
        itemsBuffer[+e.target.dataset.idx].quantity = parseFloat(e.target.value) || 0;
        updateLineAndWeight();
    }));
    container.querySelectorAll('.item-uw').forEach(inp => inp.addEventListener('input', e => {
        itemsBuffer[+e.target.dataset.idx].unit_gross_weight = e.target.value === '' ? null : (parseFloat(e.target.value) || 0);
        updateLineAndWeight();
    }));
    container.querySelectorAll('.item-remove').forEach(btn => btn.addEventListener('click', e => {
        itemsBuffer.splice(+e.target.closest('.item-remove').dataset.idx, 1);
        renderItems();
        recalcWeight();
    }));
}

function addItem() {
    itemsBuffer.push({ product_id: null, product_name: '', product_code: '', quantity: 1, unit_gross_weight: null });
    renderItems();
}

// Adet/birim ağırlık değişince satır toplamlarını ve genel ağırlığı tazele (re-render etmeden)
function updateLineAndWeight() {
    renderItems();
    recalcWeight();
}

// ─────────────────────────────────────────────
// AĞIRLIK HESABI
//   ürün ağırlığı = Σ(birim_brüt × adet)
//   dara          = palet cinsine göre (EUR1=25, EUR3=35, diğer=0)
//   toplam        = ürün + dara  (override yoksa otomatik yazılır)
// ─────────────────────────────────────────────
function productsWeight() {
    return itemsBuffer.reduce((sum, it) =>
        sum + (Number(it.unit_gross_weight) || 0) * (Number(it.quantity) || 0), 0);
}
function tareWeight() {
    const type = document.getElementById('pallet-type').value;
    return TARE_BY_TYPE[type] ?? 0;
}

// force=true: override'ı sıfırlayıp zorla otomatik yaz (yeni palet / "yeniden hesapla" butonu)
function recalcWeight(force = false) {
    const products = productsWeight();
    const tare = tareWeight();
    const total = products + tare;
    if (force) weightOverride = false;
    if (!weightOverride) {
        document.getElementById('pallet-total-weight').value = total.toFixed(2);
    }
    paintSummary(products, tare);
}

// Sadece özet kutularını ve not durumunu güncelle (toplam alanına dokunmadan)
function updateWeightSummary() {
    paintSummary(productsWeight(), tareWeight());
}

function paintSummary(products, tare) {
    document.getElementById('sum-products').textContent = products.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
    document.getElementById('sum-tare').textContent = tare.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
    document.getElementById('weight-override-note').classList.toggle('hidden', !weightOverride);
}

// ─────────────────────────────────────────────
// KAYDET / SİL
// ─────────────────────────────────────────────
async function savePallet() {
    const name = document.getElementById('pallet-name').value.trim();
    if (!name) { alert('Lütfen palet adı giriniz.'); return; }

    const stackable = document.getElementById('pallet-stackable').checked;
    const type = document.getElementById('pallet-type').value;
    const totalRaw = document.getElementById('pallet-total-weight').value;

    const payload = {
        user_id: sessionRef.user.id,
        name,
        width_cm:  parseFloat(document.getElementById('pallet-w').value) || null,
        length_cm: parseFloat(document.getElementById('pallet-l').value) || null,
        height_cm: parseFloat(document.getElementById('pallet-h').value) || null,
        stackable,
        stack_strength: stackable ? (parseInt(document.getElementById('pallet-stack-strength').value) || null) : null,
        pallet_type: type,
        tare_weight: tareWeight(),
        total_weight: totalRaw === '' ? null : (parseFloat(totalRaw) || 0),
        weight_override: weightOverride,
        notes: document.getElementById('pallet-notes').value.trim() || null,
    };

    try {
        let palletId = editingId;
        if (editingId) {
            const { error } = await supabase.from('pallet_definitions').update(payload).eq('id', editingId);
            if (error) throw error;
            await supabase.from('pallet_items').delete().eq('pallet_id', editingId);
        } else {
            const { data, error } = await supabase.from('pallet_definitions').insert(payload).select().single();
            if (error) throw error;
            palletId = data.id;
        }

        const itemRows = itemsBuffer
            .filter(it => it.product_name && it.product_name.trim())
            .map(it => ({
                user_id: sessionRef.user.id,
                pallet_id: palletId,
                product_id: it.product_id || null,
                product_name: it.product_name.trim(),
                product_code: it.product_code || null,
                quantity: Number(it.quantity) || 0,
                unit_gross_weight: it.unit_gross_weight != null ? Number(it.unit_gross_weight) : null,
            }));
        if (itemRows.length > 0) {
            const { error: iErr } = await supabase.from('pallet_items').insert(itemRows);
            if (iErr) throw iErr;
        }

        closeModal();
        await fetchPallets(sessionRef);
    } catch (err) {
        console.error('Palet kaydedilemedi:', err.message);
        if (err.code === '23505') {
            alert('Bu isimde bir palet zaten var. Lütfen benzersiz bir ad girin.');
        } else {
            alert('Hata: ' + err.message);
        }
    }
}

async function deletePallet() {
    if (!editingId) return;
    if (!confirm('Bu palet tanımı silinecek. Emin misiniz?')) return;
    try {
        const { error } = await supabase.from('pallet_definitions').delete().eq('id', editingId);
        if (error) throw error;
        closeModal();
        await fetchPallets(sessionRef);
    } catch (err) {
        console.error('Palet silinemedi:', err.message);
        if (err.code === '23503') {
            alert('Bu palet silinemez; sipariş veya yükleme planında kullanılıyor olabilir.');
        } else {
            alert('Silme hatası: ' + err.message);
        }
    }
}

// ─────────────────────────────────────────────
// EVENTLER
// ─────────────────────────────────────────────
function initEvents() {
    document.getElementById('btn-add-pallet').addEventListener('click', openCreate);
    document.getElementById('modal-pallet-close').addEventListener('click', closeModal);
    document.getElementById('modal-pallet-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-pallet-save').addEventListener('click', savePallet);
    document.getElementById('modal-pallet-delete').addEventListener('click', deletePallet);
    document.getElementById('btn-add-item').addEventListener('click', addItem);

    document.getElementById('pallet-stackable').addEventListener('change', syncStackUI);
    document.getElementById('pallet-type').addEventListener('change', () => recalcWeight());
    document.getElementById('btn-recalc-weight').addEventListener('click', () => recalcWeight(true));

    // Kullanıcı toplam ağırlığı elle değiştirirse override moduna geç
    document.getElementById('pallet-total-weight').addEventListener('input', () => {
        weightOverride = true;
        document.getElementById('weight-override-note').classList.remove('hidden');
    });

    document.getElementById('search-input').addEventListener('input', renderTable);
    document.getElementById('filter-type').addEventListener('change', renderTable);
    document.getElementById('btn-search-clear').addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        renderTable();
    });

    // Modal dışına tıklayınca kapat
    document.getElementById('modal-pallet').addEventListener('click', (e) => {
        if (e.target.id === 'modal-pallet') closeModal();
    });
}
