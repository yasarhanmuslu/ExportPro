// ═══════════════════════════════════════════════════════════════
// ExportPro — Palet Tanımları — pallet-definitions.js
// V: 1.0.71
// FIX: select kolon adları en_cm/boy_cm/yukseklik_cm (liste boş gelme hatası giderildi)
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
let itemsBuffer    = [];   // { product_id, product_name, product_code, quantity, unit_gross_weight }
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
        .select('id, stok_kodu, stok_adi_1, stok_adi_2, agirlik_net, agirlik_brut, en_cm, boy_cm, yukseklik_cm, palet_cinsi')
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

    container.innerHTML = itemsBuffer.map((it, idx) => {
        const isSelected = !!it.product_id;
        const lineW = (Number(it.unit_gross_weight) || 0) * (Number(it.quantity) || 0);

        // ── FIX Problem 3: Seçili ürün için chip (word-wrap, tam isim) ──
        // Seçilmemişse normal arama input'u göster
        const productArea = isSelected
            ? `<!-- Seçili ürün: chip görünümü (satır kırma aktif, tam isim okunabilir) -->
               <div class="flex items-start gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 min-h-[32px]">
                   <div class="flex-1 text-xs leading-snug" style="white-space:normal;word-break:break-word;line-height:1.4;">
                       <span class="font-medium text-[var(--text-primary)]">${escHtml(it.product_name)}</span>
                       ${it.product_code ? `<span class="text-[var(--text-secondary)] text-[10px] ml-1">${escHtml(it.product_code)}</span>` : ''}
                   </div>
                   <button type="button" class="item-clear-btn flex-shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center text-[var(--text-secondary)] hover:text-[#9F3D3D] transition-colors" data-idx="${idx}" title="Ürünü kaldır / değiştir">
                       <i class="fa-solid fa-xmark text-[10px]"></i>
                   </button>
               </div>
               <!-- Gizli input: event binding için gerekli, görünmez -->
               <input type="text" class="item-search hidden" data-idx="${idx}" autocomplete="off" value="" />`
            : `<!-- Boş satır: arama input -->
               <input type="text" class="item-search w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs focus:outline-none"
                   placeholder="Ürün ara (kod / TR / EN)…"
                   value="${escHtml(it.product_name || '')}"
                   data-idx="${idx}" autocomplete="off" />`;

        return `
        <div class="item-row grid grid-cols-12 gap-2 items-start bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-2" data-idx="${idx}">
            <div class="col-span-6" style="position:relative;">
                ${productArea}
                <div class="ac-dropdown hidden" data-idx="${idx}"
                    style="position:absolute;top:100%;left:0;right:0;z-index:60;max-height:200px;overflow-y:auto;
                           background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;
                           margin-top:2px;box-shadow:0 4px 16px rgba(0,0,0,.12);">
                </div>
            </div>
            <div class="col-span-2">
                <input type="number" min="0" step="any"
                    class="item-qty w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs text-right focus:outline-none"
                    placeholder="Adet" value="${it.quantity || ''}" data-idx="${idx}">
            </div>
            <div class="col-span-2">
                <input type="number" min="0" step="0.01"
                    class="item-uw w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs text-right focus:outline-none"
                    placeholder="Br.kg"
                    value="${it.unit_gross_weight != null ? it.unit_gross_weight : ''}"
                    data-idx="${idx}" title="Birim brüt ağırlık (kg) — elle değiştirebilirsiniz">
            </div>
            <div class="col-span-1 text-right text-[11px] text-[var(--text-secondary)] font-mono pt-2">
                ${lineW ? lineW.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '—'}
            </div>
            <div class="col-span-1 text-center pt-1">
                <button type="button" class="item-remove text-[#9F3D3D] hover:opacity-70 transition-opacity px-1" data-idx="${idx}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    // ── FIX Problem 2a: Autocomplete — sadece görünür (seçilmemiş) input'lara bağla ──
    container.querySelectorAll('.item-search').forEach(inp => {
        // Gizli input'ları atla (seçili ürünün hidden input'u)
        if (inp.classList.contains('hidden')) return;

        const idx = +inp.dataset.idx;
        const dd = container.querySelector(`.ac-dropdown[data-idx="${idx}"]`);
        let debounce = null;

        inp.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                const q = inp.value.toLocaleLowerCase('tr-TR').trim();
                if (q.length < 1) { dd.classList.add('hidden'); return; }

                // FIX Problem 2a: BİLİNGUAL ARAMA — stok_kodu + stok_adi_1 (TR) + stok_adi_2 (EN)
                const matches = globalProducts.filter(p => {
                    const hay = [
                        p.stok_kodu  || '',
                        p.stok_adi_1 || '',
                        p.stok_adi_2 || ''   // ← EN isim de aranıyor
                    ].join(' ').toLocaleLowerCase('tr-TR');
                    return q.split(/\s+/).every(w => hay.includes(w));
                }).slice(0, 30);

                if (matches.length === 0) {
                    dd.innerHTML = `<div style="padding:8px 10px;font-size:11px;color:var(--text-secondary);">Sonuç yok</div>`;
                } else {
                    // FIX: Dropdown'da hem TR hem EN isim göster + ağırlık bilgisi
                    dd.innerHTML = matches.map(p => {
                        // Brüt varsa brüt, yoksa net, yoksa hiçbir şey gösterme
                        const weightLabel = p.agirlik_brut != null
                            ? `<span style="color:var(--text-secondary);font-size:10px;margin-left:4px;">${p.agirlik_brut} kg</span>`
                            : p.agirlik_net != null
                                ? `<span style="color:#B26B33;font-size:10px;margin-left:4px;">${p.agirlik_net} kg (net)</span>`
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
                                    ${weightLabel}
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

                        // FIX Problem 2b-c: Ağırlık mantığı
                        // agirlik_brut varsa önce onu kullan,
                        // yoksa agirlik_net'i kullan (646 üründe net dolu, brüt boş)
                        // ikisi de yoksa null bırak — kullanıcı elle girer
                        const usedWeight = prod.agirlik_brut != null
                            ? Number(prod.agirlik_brut)
                            : prod.agirlik_net != null
                                ? Number(prod.agirlik_net)
                                : null;

                        itemsBuffer[idx].product_id        = prod.id;
                        itemsBuffer[idx].product_name      = prod.stok_adi_1;
                        itemsBuffer[idx].product_code      = prod.stok_kodu || '';
                        itemsBuffer[idx].unit_gross_weight = usedWeight;

                        // ── FIX REV2: Palet ölçülerini SADECE BOŞSA doldur ──
                        // Kullanıcı elle girdiyse veya karma palette 2./3. ürün
                        // ekleniyorsa mevcut değerlerin üzerine yazma.
                        fillPalletDimsIfEmpty(prod);

                        // Render + hesaplama tetikle
                        renderItems();
                        recalcWeight();
                    });
                });
            }, 120);
        });

        inp.addEventListener('blur', () => setTimeout(() => dd.classList.add('hidden'), 150));
        inp.addEventListener('focus', () => { if (inp.value.length >= 1) inp.dispatchEvent(new Event('input')); });

        // Serbest metin: listeden seçilmemişse, yazılanı product_name kaydet
        inp.addEventListener('change', () => {
            if (!itemsBuffer[idx].product_id) {
                itemsBuffer[idx].product_name = inp.value.trim();
            }
        });
    });

    // ── FIX Problem 3: Chip "×" — ürün seçimini sıfırla / değiştir ──
    container.querySelectorAll('.item-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = +btn.dataset.idx;
            itemsBuffer[idx].product_id        = null;
            itemsBuffer[idx].product_name      = '';
            itemsBuffer[idx].product_code      = '';
            itemsBuffer[idx].unit_gross_weight = null;
            renderItems();
            recalcWeight();
            // Yeni render sonrası arama input'una odaklan
            const inp = container.querySelector(`.item-search[data-idx="${idx}"]:not(.hidden)`);
            if (inp) inp.focus();
        });
    });

    // Adet değişince yeniden hesapla
    container.querySelectorAll('.item-qty').forEach(inp => inp.addEventListener('input', e => {
        itemsBuffer[+e.target.dataset.idx].quantity = parseFloat(e.target.value) || 0;
        updateLineAndWeight();
    }));

    // Birim ağırlık değişince yeniden hesapla (manuel override)
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
    itemsBuffer.push({ product_id: null, product_name: '', product_code: '', quantity: 1, unit_gross_weight: null });
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
    document.getElementById('btn-search-clear').addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        renderTable();
    });

    document.getElementById('modal-pallet').addEventListener('click', (e) => {
        if (e.target.id === 'modal-pallet') closeModal();
    });
}
