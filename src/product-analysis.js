// ═══════════════════════════════════════════════════════════════
// ExportPro — Palet Tanımları — pallet-definitions.js
// V: 1.0.75
// FIX-A2: Ana ekran tasarım revizyonu — KPI 3'lü, İstif filtresi, Notlar kolonu
// ═══════════════════════════════════════════════════════════════

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
let itemsBuffer    = [];   // { product_id, product_name, product_code, quantity, unit_net_weight, unit_gross_weight, palet_adedi }
let editingId      = null;
let weightOverride = false;
let sessionRef     = null;
let palletTypeTouched = false;  // FIX REV2: kullanıcı palet cinsine elle dokundu mu

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
    // FIX: stok_adi_2 + agirlik_net (bilingual arama + net fallback)
    // FIX: DB kolon adları en_cm/boy_cm/yukseklik_cm (information_schema ile doğrulandı)
    const { data, error } = await supabase
        .from('urunler')
        .select('id, stok_kodu, stok_adi_1, stok_adi_2, agirlik_net, agirlik_brut, en_cm, boy_cm, yukseklik_cm, palet_cinsi, palet_adedi')
        .eq('user_id', session.user.id)
        .order('stok_adi_1', { ascending: true });
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
    const stackF = document.getElementById('filter-stack').value;

    let rows = globalPallets.filter(p => {
        const matchSearch = !search ||
            (p.name || '').toLowerCase().includes(search) ||
            (p.pallet_type || '').toLowerCase().includes(search);
        const matchType = !typeF || p.pallet_type === typeF;
        const matchStack = !stackF ||
            (stackF === 'yes' && p.stackable) ||
            (stackF === 'no' && !p.stackable);
        return matchSearch && matchType && matchStack;
    });

    document.getElementById('btn-search-clear').classList.toggle('hidden', !search);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-[var(--text-secondary)] py-12">Kayıt bulunamadı.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(p => {
        const dims = [p.width_cm, p.length_cm, p.height_cm].map(fmtNum).join(' × ');
        const variety = (p.pallet_items || []).length;
        const stackBadge = p.stackable
            ? `<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-[#3D6E50]"><i class="fa-solid fa-layer-group text-[10px]"></i>Evet</span>`
            : `<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-500/10 text-[var(--text-secondary)]">Hayır</span>`;
        const layer = (p.stackable && p.stack_strength) ? p.stack_strength : '—';
        // Notlar: varsa ikon + hover popover, yoksa boş
        const notesCell = (p.notes && p.notes.trim())
            ? `<div class="group relative inline-block">
                   <i class="fa-solid fa-sticky-note text-[var(--text-secondary)] group-hover:text-[#B26B33] transition-colors cursor-pointer"></i>
                   <div class="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 rounded-lg shadow-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] leading-relaxed"
                        style="pointer-events:none;">
                       <div class="font-semibold text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Not</div>
                       ${escHtml(p.notes.trim())}
                       <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-0 h-0" style="border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid var(--border);"></div>
                   </div>
               </div>`
            : '';
        return `
        <tr class="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
            <td class="px-4 py-3 font-medium text-[var(--text-primary)]">${escHtml(p.name)}</td>
            <td class="px-4 py-3 text-[var(--text-secondary)]">${escHtml(p.pallet_type)}</td>
            <td class="px-4 py-3 text-right text-[var(--text-secondary)]">${dims}</td>
            <td class="px-4 py-3 text-center">${stackBadge}</td>
            <td class="px-4 py-3 text-center text-[var(--text-secondary)]">${layer}</td>
            <td class="px-4 py-3 text-right text-[var(--text-secondary)]">${variety} çeşit</td>
            <td class="px-4 py-3 text-right font-medium text-[var(--text-primary)]">${fmtKg(p.total_weight)}</td>
            <td class="px-4 py-3 text-center">${notesCell}</td>
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
    const notStackable = total - stackable;
    const eur1 = globalPallets.filter(p => p.pallet_type === 'EUR1').length;
    const eur3 = globalPallets.filter(p => p.pallet_type === 'EUR3').length;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-stackable').textContent = `${stackable} / ${notStackable}`;
    document.getElementById('stat-euro').textContent = `${eur1} / ${eur3}`;
}

// ─────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────
function openCreate() {
    editingId = null;
    weightOverride = false;
    palletTypeTouched = false;  // FIX REV2: yeni palette cins henüz dokunulmadı
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
    palletTypeTouched = true;  // FIX REV2: mevcut palette ölçüler zaten dolu, otomatik doldurma yapma
    itemsBuffer = (p.pallet_items || []).map(it => {
        // DB'den gelen brüt ağırlık
        const savedGross = it.unit_gross_weight != null ? Number(it.unit_gross_weight) : null;
        // Net ağırlık ve palet adedi: pallet_items'ta varsa al, yoksa globalProducts'tan eşleştir
        let savedNet = it.unit_net_weight != null ? Number(it.unit_net_weight) : null;
        let paletAdedi = null;
        if (it.product_id) {
            const prod = globalProducts.find(pr => pr.id === it.product_id);
            if (prod) {
                if (savedNet == null && prod.agirlik_net != null) savedNet = Number(prod.agirlik_net);
                if (prod.palet_adedi != null) paletAdedi = Number(prod.palet_adedi);
            }
        }
        return {
            product_id: it.product_id || null,
            product_name: it.product_name || '',
            product_code: it.product_code || '',
            quantity: Number(it.quantity) || 0,
            unit_net_weight: savedNet,
            unit_gross_weight: savedGross,
            palet_adedi: paletAdedi,
        };
    });
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
    updateWeightSummary();
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

    // ── Başlık satırı (kalemler varsa göster) ──
    const headerHtml = itemsBuffer.length > 0
        ? `<div class="grid gap-2 items-center px-2 mb-1" style="grid-template-columns: 5fr 1fr 1.4fr 1.4fr 1fr 28px;">
               <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Ürün</span>
               <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium text-right">Adet</span>
               <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium text-right">Net kg</span>
               <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium text-right">Brüt kg</span>
               <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium text-right">Satır kg</span>
               <span></span>
           </div>`
        : '';

    const rowsHtml = itemsBuffer.map((it, idx) => {
        const isSelected = !!it.product_id;
        const lineW = (Number(it.unit_gross_weight) || 0) * (Number(it.quantity) || 0);

        // ── Ürün alanı: seçiliyse chip, değilse arama input ──
        const paletAdetiHint = (isSelected && it.palet_adedi)
            ? `<div style="font-size:10px;color:#B26B33;margin-top:2px;line-height:1.2;">
                   <i class="fa-solid fa-layer-group" style="font-size:9px;margin-right:3px;"></i>Std. Palet Adedi: ${Number(it.palet_adedi).toLocaleString('tr-TR')}
               </div>`
            : '';

        const productArea = isSelected
            ? `<div class="flex items-start gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 min-h-[32px]">
                   <div class="flex-1 text-xs leading-snug" style="white-space:normal;word-break:break-word;line-height:1.4;">
                       <span class="font-medium text-[var(--text-primary)]">${escHtml(it.product_name)}</span>
                       ${it.product_code ? `<span class="text-[var(--text-secondary)] text-[10px] ml-1">${escHtml(it.product_code)}</span>` : ''}
                       ${paletAdetiHint}
                   </div>
                   <button type="button" class="item-clear-btn flex-shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center text-[var(--text-secondary)] hover:text-[#9F3D3D] transition-colors" data-idx="${idx}" title="Ürünü kaldır / değiştir">
                       <i class="fa-solid fa-xmark text-[10px]"></i>
                   </button>
               </div>
               <input type="text" class="item-search hidden" data-idx="${idx}" autocomplete="off" value="" />`
            : `<input type="text" class="item-search w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs focus:outline-none"
                   placeholder="Ürün ara (kod / TR / EN)…"
                   value="${escHtml(it.product_name || '')}"
                   data-idx="${idx}" autocomplete="off" />`;

        // Net ağırlık: readonly, bilgi amaçlı
        const netVal = it.unit_net_weight != null ? it.unit_net_weight : '';
        // Brüt ağırlık: düzenlenebilir
        const grossVal = it.unit_gross_weight != null ? it.unit_gross_weight : '';

        return `
        <div class="item-row grid gap-2 items-start bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-2"
             data-idx="${idx}"
             style="grid-template-columns: 5fr 1fr 1.4fr 1.4fr 1fr 28px;">
            <div style="position:relative;">
                ${productArea}
                <div class="ac-dropdown hidden" data-idx="${idx}"
                    style="position:absolute;top:100%;left:0;right:0;z-index:60;max-height:200px;overflow-y:auto;
                           background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;
                           margin-top:2px;box-shadow:0 4px 16px rgba(0,0,0,.12);">
                </div>
            </div>
            <!-- Adet -->
            <input type="number" min="0" step="any"
                class="item-qty w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs text-right focus:outline-none"
                placeholder="Adet" value="${it.quantity || ''}" data-idx="${idx}">
            <!-- Net Ağırlık (readonly, bilgi amaçlı) -->
            <input type="number" step="0.01" readonly tabindex="-1"
                class="item-nw w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] text-xs text-right cursor-default opacity-70"
                placeholder="—" value="${netVal}" data-idx="${idx}"
                title="Net ağırlık (kg) — ürün kartından gelir, salt okunur">
            <!-- Brüt Ağırlık (düzenlenebilir) -->
            <input type="number" min="0" step="0.01"
                class="item-uw w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs text-right focus:outline-none"
                placeholder="Br.kg"
                value="${grossVal}"
                data-idx="${idx}" title="Birim brüt ağırlık (kg) — düzenlenebilir">
            <!-- Satır toplam (brüt × adet) -->
            <div class="line-total text-right text-[11px] text-[var(--text-secondary)] font-mono pt-2">
                ${lineW ? lineW.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '—'}
            </div>
            <!-- Sil -->
            <div class="text-center pt-1">
                <button type="button" class="item-remove text-[#9F3D3D] hover:opacity-70 transition-opacity px-1" data-idx="${idx}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = headerHtml + rowsHtml;

    // ── Autocomplete — sadece görünür input'lara bağla ──
    container.querySelectorAll('.item-search').forEach(inp => {
        if (inp.classList.contains('hidden')) return;

        const idx = +inp.dataset.idx;
        const dd = container.querySelector(`.ac-dropdown[data-idx="${idx}"]`);
        let debounce = null;

        inp.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                const q = inp.value.toLocaleLowerCase('tr-TR').trim();
                if (q.length < 1) { dd.classList.add('hidden'); return; }

                const matches = globalProducts.filter(p => {
                    const hay = [
                        p.stok_kodu  || '',
                        p.stok_adi_1 || '',
                        p.stok_adi_2 || ''
                    ].join(' ').toLocaleLowerCase('tr-TR');
                    return q.split(/\s+/).every(w => hay.includes(w));
                }).slice(0, 30);

                if (matches.length === 0) {
                    dd.innerHTML = `<div style="padding:8px 10px;font-size:11px;color:var(--text-secondary);">Sonuç yok</div>`;
                } else {
                    dd.innerHTML = matches.map(p => {
                        const grossLabel = p.agirlik_brut != null
                            ? `<span style="color:var(--text-secondary);font-size:10px;margin-left:4px;">${p.agirlik_brut} kg brüt</span>`
                            : '';
                        const netLabel = p.agirlik_net != null
                            ? `<span style="color:#B26B33;font-size:10px;margin-left:4px;">${p.agirlik_net} kg net</span>`
                            : '';
                        return `
                            <div class="ac-option" data-pid="${p.id}"
                                style="padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--border-soft);transition:background .1s;">
                                <div style="font-size:11px;font-weight:500;color:var(--text-primary);
                                            white-space:normal;word-break:break-word;line-height:1.3;">
                                    ${escHtml(p.stok_adi_1)}
                                </div>
                                ${p.stok_adi_2
                                    ? `<div style="font-size:10px;color:var(--text-secondary);
                                                  white-space:normal;word-break:break-word;line-height:1.2;margin-top:1px;">
                                           ${escHtml(p.stok_adi_2)}
                                       </div>`
                                    : ''}
                                <div style="margin-top:2px;">
                                    <span style="font-size:10px;color:var(--text-secondary);">${escHtml(p.stok_kodu)}</span>
                                    ${netLabel}${grossLabel}
                                </div>
                            </div>`;
                    }).join('');
                }
                dd.classList.remove('hidden');

                dd.querySelectorAll('.ac-option').forEach(opt => {
                    opt.addEventListener('mouseenter', () => opt.style.background = 'var(--bg-hover, var(--surface-2))');
                    opt.addEventListener('mouseleave', () => opt.style.background = '');
                    opt.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        const prod = globalProducts.find(p => p.id === opt.dataset.pid);
                        if (!prod) return;

                        // Net ağırlık: her zaman ürün kartından (readonly)
                        const netW = prod.agirlik_net != null ? Number(prod.agirlik_net) : null;
                        // Brüt ağırlık: DB'de varsa otomatik doldur, yoksa null (kullanıcı girer)
                        const grossW = prod.agirlik_brut != null ? Number(prod.agirlik_brut) : null;

                        itemsBuffer[idx].product_id        = prod.id;
                        itemsBuffer[idx].product_name      = prod.stok_adi_1;
                        itemsBuffer[idx].product_code      = prod.stok_kodu || '';
                        itemsBuffer[idx].unit_net_weight   = netW;
                        itemsBuffer[idx].unit_gross_weight = grossW;
                        itemsBuffer[idx].palet_adedi       = prod.palet_adedi != null ? Number(prod.palet_adedi) : null;

                        // Palet ölçülerini SADECE BOŞSA doldur
                        fillPalletDimsIfEmpty(prod);

                        renderItems();
                        recalcWeight();
                    });
                });
            }, 120);
        });

        inp.addEventListener('blur', () => setTimeout(() => dd.classList.add('hidden'), 150));
        inp.addEventListener('focus', () => { if (inp.value.length >= 1) inp.dispatchEvent(new Event('input')); });

        inp.addEventListener('change', () => {
            if (!itemsBuffer[idx].product_id) {
                itemsBuffer[idx].product_name = inp.value.trim();
            }
        });
    });

    // ── Chip "×" — ürün seçimini sıfırla ──
    container.querySelectorAll('.item-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = +btn.dataset.idx;
            itemsBuffer[idx].product_id        = null;
            itemsBuffer[idx].product_name      = '';
            itemsBuffer[idx].product_code      = '';
            itemsBuffer[idx].unit_net_weight   = null;
            itemsBuffer[idx].unit_gross_weight = null;
            itemsBuffer[idx].palet_adedi       = null;
            renderItems();
            recalcWeight();
            const inp = container.querySelector(`.item-search[data-idx="${idx}"]:not(.hidden)`);
            if (inp) inp.focus();
        });
    });

    // Adet değişince yeniden hesapla
    container.querySelectorAll('.item-qty').forEach(inp => inp.addEventListener('input', e => {
        itemsBuffer[+e.target.dataset.idx].quantity = parseFloat(e.target.value) || 0;
        updateLineAndWeight();
    }));

    // Birim brüt ağırlık değişince yeniden hesapla
    container.querySelectorAll('.item-uw').forEach(inp => inp.addEventListener('input', e => {
        itemsBuffer[+e.target.dataset.idx].unit_gross_weight =
            e.target.value === '' ? null : (parseFloat(e.target.value) || 0);
        updateLineAndWeight();
    }));

    // Satır sil
    container.querySelectorAll('.item-remove').forEach(btn => btn.addEventListener('click', e => {
        itemsBuffer.splice(+e.target.closest('.item-remove').dataset.idx, 1);
        renderItems();
        recalcWeight();
    }));
}

function addItem() {
    itemsBuffer.push({ product_id: null, product_name: '', product_code: '', quantity: 1, unit_net_weight: null, unit_gross_weight: null, palet_adedi: null });
    renderItems();
}

// ── FIX REV2: Ürün seçilince palet ölçü alanlarını SADECE BOŞSA doldur ──
// "Boş" = '' veya null. Kullanıcının girdiği değerler korunur (üzerine yazılmaz).
// Palet cinsi değiştiğinde dara da değişeceği için recalcWeight çağrılır.
function fillPalletDimsIfEmpty(prod) {
    const elW    = document.getElementById('pallet-w');
    const elL    = document.getElementById('pallet-l');
    const elH    = document.getElementById('pallet-h');
    const elType = document.getElementById('pallet-type');

    const isEmpty = (el) => el.value === '' || el.value == null;

    // En → genişlik (width_cm)
    if (isEmpty(elW) && prod.en_cm != null)        elW.value = prod.en_cm;
    // Boy → uzunluk (length_cm)
    if (isEmpty(elL) && prod.boy_cm != null)       elL.value = prod.boy_cm;
    // Yükseklik → height_cm
    if (isEmpty(elH) && prod.yukseklik_cm != null) elH.value = prod.yukseklik_cm;

    // Palet cinsi: select'te eşleşen option varsa ve kullanıcı henüz
    // bilinçli bir seçim yapmadıysa doldur. Select varsayılan 'EUR1' ile
    // açıldığı için "boş" kabulü yapamayız; bu yüzden yalnızca ürünün
    // palet_cinsi geçerli bir option ise ve mevcut değerden farklıysa,
    // KULLANICI henüz cins'e dokunmadıysa (palletTypeTouched=false) yaz.
    if (prod.palet_cinsi && !palletTypeTouched) {
        const opt = [...elType.options].find(o => o.value === prod.palet_cinsi);
        if (opt) {
            elType.value = prod.palet_cinsi;
            recalcWeight(); // cins değişti → dara güncellensin
        }
    }
}

// ── IN-PLACE satır toplam güncelleme (DOM yeniden yaratılmaz, focus korunur) ──
function updateLineAndWeight() {
    const container = document.getElementById('items-container');
    itemsBuffer.forEach((it, idx) => {
        const lineW = (Number(it.unit_gross_weight) || 0) * (Number(it.quantity) || 0);
        const row = container.querySelector(`.item-row[data-idx="${idx}"]`);
        if (!row) return;
        // Satır toplam alanını bul (grid'deki 5. child → index 4, 0-based)
        const lineTotal = row.querySelector('.line-total');
        if (lineTotal) {
            lineTotal.textContent = lineW ? lineW.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '—';
        }
    });
    recalcWeight();
}

// ─────────────────────────────────────────────
// AĞIRLIK HESABI
//   ürün ağırlığı = Σ(birim_brüt × adet)
//   dara          = palet cinsine göre (EUR1=25, EUR3=35, diğer=0)
//   toplam        = ürün ağırlığı + dara  (override yoksa otomatik yazılır)
//   NOT: Brüt ağırlık = net + ambalaj olduğu için ayrıca net eklenmez
// ─────────────────────────────────────────────
function productsWeight() {
    return itemsBuffer.reduce((sum, it) =>
        sum + (Number(it.unit_gross_weight) || 0) * (Number(it.quantity) || 0), 0);
}
function tareWeight() {
    const type = document.getElementById('pallet-type').value;
    return TARE_BY_TYPE[type] ?? 0;
}

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

function updateWeightSummary() {
    paintSummary(productsWeight(), tareWeight());
}

function paintSummary(products, tare) {
    document.getElementById('sum-products').textContent =
        products.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
    document.getElementById('sum-tare').textContent =
        tare.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
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
                unit_net_weight: it.unit_net_weight != null ? Number(it.unit_net_weight) : null,
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
    document.getElementById('pallet-type').addEventListener('change', () => {
        palletTypeTouched = true;  // FIX REV2: kullanıcı cinsi elle değiştirdi
        recalcWeight();
    });
    document.getElementById('btn-recalc-weight').addEventListener('click', () => recalcWeight(true));

    document.getElementById('pallet-total-weight').addEventListener('input', () => {
        weightOverride = true;
        document.getElementById('weight-override-note').classList.remove('hidden');
    });

    document.getElementById('search-input').addEventListener('input', renderTable);
    document.getElementById('filter-type').addEventListener('change', renderTable);
    document.getElementById('filter-stack').addEventListener('change', renderTable);
    document.getElementById('btn-search-clear').addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        renderTable();
    });

    // ── KPI panel tıklama → ilgili filtreyi tetikle ──
    document.getElementById('kpi-total').addEventListener('click', () => {
        // Tüm filtreleri sıfırla → tümünü göster
        document.getElementById('filter-type').value = '';
        document.getElementById('filter-stack').value = '';
        document.getElementById('search-input').value = '';
        renderTable();
    });
    document.getElementById('kpi-stackable').addEventListener('click', () => {
        // İstif filtresini toggle et
        const sel = document.getElementById('filter-stack');
        sel.value = sel.value === 'yes' ? '' : 'yes';
        renderTable();
    });
    document.getElementById('kpi-euro').addEventListener('click', () => {
        // EUR1 → EUR3 → hepsi toggle
        const sel = document.getElementById('filter-type');
        if (sel.value === '') sel.value = 'EUR1';
        else if (sel.value === 'EUR1') sel.value = 'EUR3';
        else sel.value = '';
        renderTable();
    });

    document.getElementById('modal-pallet').addEventListener('click', (e) => {
        if (e.target.id === 'modal-pallet') closeModal();
    });
}
