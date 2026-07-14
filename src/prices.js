import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess, canEdit, applyEditLock } from './utils/permissions.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';

// ── Global State ──────────────────────────────────────────────
let globalProducts = [];   // DB'den gelen price_list satırları (+ _displayName/_matched)
let urunlerMap = new Map(); // normalize(stok_kodu) -> { id, code, name, grup } — Ürün Kartları
let currentTab = 'eur';    // 'eur' | 'usd'
let eurRate = null;
let usdRate = null;
let ctx = null;
let editingId = null;      // null = yeni ürün, uuid = düzenleme
let pendingImportRows = []; // içe aktarma önizleme satırları

// ── Başlangıç ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'prices'))) return;

    await renderNavbar('prices', ctx);
    await Promise.all([fetchRates(), fetchUrunlerMap()]);
    await fetchProducts();
    initEventListeners();
    applyEditLock(ctx, 'prices');
    renderTable();
});

// ── TCMB Döviz Kuru ───────────────────────────────────────────
async function fetchRates() {
    try {
        // exchangerate-api üzerinden kur çekme (ücretsiz, CORS yok)
        const res = await fetch('https://open.er-api.com/v6/latest/TRY');
        const json = await res.json();

        if (json && json.rates) {
            // TRY bazlı: 1 TRY = X EUR/USD → ters çevir: 1 EUR/USD = ? TRY
            eurRate = json.rates['EUR'] ? parseFloat((1 / json.rates['EUR']).toFixed(4)) : null;
            usdRate = json.rates['USD'] ? parseFloat((1 / json.rates['USD']).toFixed(4)) : null;
        }

        if (eurRate) {
            document.getElementById('eur-kur-display').textContent = eurRate.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('eur-kur-time').textContent = 'Canlı Kur';
        }
        if (usdRate) {
            document.getElementById('usd-kur-display').textContent = usdRate.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            document.getElementById('usd-kur-time').textContent = 'Canlı Kur';
        }
    } catch (err) {
        console.error('Döviz kuru çekilemedi:', err.message);
        document.getElementById('eur-kur-display').textContent = '—';
        document.getElementById('usd-kur-display').textContent = '—';
    }
}

// ── Ürün Kartları (urunler) haritası — tek doğruluk kaynağı ────
function normCode(v) {
    return (v || '').toString().trim().toUpperCase();
}

async function fetchUrunlerMap() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data, error } = await supabase
            .from('urunler')
            .select('id, stok_kodu, stok_adi_1, urun_grubu')
            .eq('user_id', ctx.ownerId);
        if (error) throw error;

        urunlerMap = new Map();
        (data || []).forEach(u => {
            const key = normCode(u.stok_kodu);
            if (key && !urunlerMap.has(key)) {
                urunlerMap.set(key, { id: u.id, code: u.stok_kodu, name: u.stok_adi_1, grup: u.urun_grubu });
            }
        });
    } catch (err) {
        console.error('Ürün Kartları çekilemedi:', err.message);
    }
}

// Her price_list satırına canlı Ürün Kartları verisini iliştirir.
// product_name veritabanında değişmez — sadece eşleşme yoksa yedek olarak kullanılır.
function enrichProducts() {
    globalProducts.forEach(p => {
        const match = urunlerMap.get(normCode(p.product_code));
        p._matched = !!match;
        p._displayName = match ? match.name : (p.product_name || '');
    });
}

// ── Veri Çekme ────────────────────────────────────────────────
async function fetchProducts() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase
            .from('price_list')
            .select('*')
            .eq('user_id', ctx.ownerId)
            .order('group_name', { ascending: true })
            .order('product_name', { ascending: true });

        if (error) throw error;
        globalProducts = data || [];
        enrichProducts();

        // Grup filtresini doldur
        populateGroupFilter();

    } catch (err) {
        console.error('Ürün listesi çekilemedi:', err.message);
        document.getElementById('price-table-body').innerHTML =
            `<tr class="loading-row"><td colspan="9" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>Veri çekilirken hata oluştu.</td></tr>`;
    }
}

function populateGroupFilter() {
    const groups = [...new Set(globalProducts.map(p => p.group_name).filter(Boolean))].sort();
    const sel = document.getElementById('group-filter');
    const prevVal = sel.value;
    sel.innerHTML = '<option value="">Tüm Gruplar</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        sel.appendChild(opt);
    });
    if (groups.includes(prevVal)) sel.value = prevVal;
}

// ── Sekme Geçişi ─────────────────────────────────────────────
window.switchTab = function(tab) {
    currentTab = tab;

    document.getElementById('tab-eur').classList.toggle('active', tab === 'eur');
    document.getElementById('tab-usd').classList.toggle('active', tab === 'usd');

    // Kur paneli
    document.getElementById('panel-eur-kur').style.display = tab === 'eur' ? '' : 'none';
    document.getElementById('panel-usd-kur').style.display = tab === 'usd' ? '' : 'none';

    // Tablo başlığı
    document.getElementById('th-tl-net-doviz').textContent = tab === 'eur' ? '2026 TL Net (EUR)' : '2026 TL Net (USD)';
    document.getElementById('th-doviz-liste').textContent = tab === 'eur' ? '2022-3 EUR Liste' : '2022-3 USD Liste';
    document.getElementById('th-doviz-net').textContent   = tab === 'eur' ? '2022-3 EUR Net'   : '2022-3 USD Net';
    document.getElementById('doviz-iskonto-label').textContent = tab === 'eur' ? 'Euro Fiyat İskontosu (%)' : 'USD Fiyat İskontosu (%)';

    renderTable();
};

// ── Hesaplama Fonksiyonları ───────────────────────────────────

// TL zincir iskonto hesabı: Liste × (1-d1) × (1-d2) × (1-d3) × (1-d4)
function calcTlNet(listPrice) {
    if (!listPrice) return null;
    const d1 = parseFloat(document.getElementById('tl-d1').value) / 100 || 0;
    const d2 = parseFloat(document.getElementById('tl-d2').value) / 100 || 0;
    const d3 = parseFloat(document.getElementById('tl-d3').value) / 100 || 0;
    const d4 = parseFloat(document.getElementById('tl-d4').value) / 100 || 0;
    return listPrice * (1 - d1) * (1 - d2) * (1 - d3) * (1 - d4);
}

// Döviz net: Liste × (1 - iskonto%)
function calcDovizNet(listPrice) {
    if (!listPrice) return null;
    const d = parseFloat(document.getElementById('doviz-iskonto').value) / 100 || 0;
    return listPrice * (1 - d);
}

// TL net'i dövize çevir
function tlNetToDoviz(tlNet) {
    const rate = currentTab === 'eur' ? eurRate : usdRate;
    if (!rate || !tlNet) return null;
    return tlNet / rate;
}

// Fark hesabı (Excel formülü ile aynı):
// Eğer TL/Kur < DövizNet → ((DövizNet / TL_Kur) - 1)  → pozitif
// Eğer TL/Kur >= DövizNet → (1 - (TL_Kur / DövizNet)) → negatif
function calcFark(tlNet, dovizNet) {
    const rate = currentTab === 'eur' ? eurRate : usdRate;
    if (!tlNet || !dovizNet || !rate) return null;
    const tlInDoviz = tlNet / rate;
    if (tlInDoviz < dovizNet) {
        return (dovizNet / tlInDoviz) - 1;
    } else {
        return 1 - (tlInDoviz / dovizNet);
    }
}

// ── Filtreleme (tablo ve export ortak kullanır) ────────────────
function getFilteredProducts() {
    const searchVal = document.getElementById('price-search').value.toLowerCase();
    const groupVal  = document.getElementById('group-filter').value;

    return globalProducts.filter(p => {
        const nameMatch = (p._displayName || '').toLowerCase().includes(searchVal);
        const codeMatch = (p.product_code || '').toLowerCase().includes(searchVal);
        const groupMatch = !groupVal || p.group_name === groupVal;
        return (nameMatch || codeMatch) && groupMatch;
    });
}

// ── Tablo Render ─────────────────────────────────────────────
function renderTable() {
    const tbody = document.getElementById('price-table-body');
    const filtered = getFilteredProducts();

    document.getElementById('total-count').textContent = filtered.length;
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr class="loading-row"><td colspan="9" style="color:var(--ink-3);">Sonuç bulunamadı.</td></tr>`;
        return;
    }

    // Gruplu render
    let lastGroup = '__INIT__';

    filtered.forEach(p => {
        // Grup başlık satırı
        if (p.group_name !== lastGroup) {
            lastGroup = p.group_name;
            const gtr = document.createElement('tr');
            gtr.className = 'group-row';
            gtr.innerHTML = `<td colspan="9">${escapeHtml(p.group_name || 'Diğer')}</td>`;
            tbody.appendChild(gtr);
        }

        const dovizListe = currentTab === 'eur' ? p.list_price_eur : p.list_price_usd;
        const tlListe    = p.list_price_tl;

        const tlNet    = calcTlNet(tlListe);
        const dovizNet = calcDovizNet(dovizListe);
        const fark     = calcFark(tlNet, dovizNet);

        const badgeHtml = p._matched
            ? ''
            : `<span class="match-badge warn" title="Bu kod Ürün Kartları modülünde bulunamadı"><i class="fa-solid fa-triangle-exclamation" style="font-size:8px;"></i> Eşleşmedi</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="td-code">${escapeHtml(p.product_code || '—')}</td>
            <td class="td-name">${escapeHtml(p._displayName || '')}${badgeHtml}</td>
            <td class="td-num td-tl">${fmtTL(tlListe)}</td>
            <td class="td-num td-net">${fmtTL(tlNet)}</td>
            <td class="td-num" style="color:var(--ink-2);font-weight:500;">${fmtDoviz(tlNetToDoviz(tlNet))}</td>
            <td class="td-num td-eur-liste">${fmtDoviz(dovizListe)}</td>
            <td class="td-num td-eur-net">${fmtDoviz(dovizNet)}</td>
            <td class="td-num">${fmtFark(fark)}</td>
            <td>
                <div class="row-actions">
                    <button class="row-action-btn" data-requires-edit title="Düzenle" onclick="window._priceApp.openEdit('${p.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="row-action-btn danger" data-requires-edit title="Sil" onclick="window._priceApp.confirmDelete('${p.id}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    applyEditLock(ctx, 'prices');
}

// ── Format Yardımcıları ───────────────────────────────────────
function fmtTL(val) {
    if (val === null || val === undefined) return '<span class="empty-price">—</span>';
    return val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

function fmtDoviz(val) {
    if (val === null || val === undefined) return '<span class="empty-price">—</span>';
    const sym = currentTab === 'eur' ? ' €' : ' $';
    return val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + sym;
}

function fmtFark(val) {
    if (val === null || val === undefined) return '<span class="diff-zero">—</span>';
    const pct = (val * 100).toFixed(1);
    if (val > 0.001) {
        return `<span class="diff-pos"><i class="fa-solid fa-arrow-up" style="font-size:9px;margin-right:2px;"></i>+${pct}%</span>`;
    } else if (val < -0.001) {
        return `<span class="diff-neg"><i class="fa-solid fa-arrow-down" style="font-size:9px;margin-right:2px;"></i>${pct}%</span>`;
    } else {
        return `<span class="diff-zero">0.0%</span>`;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function parseNum(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
}

// ── Modal Yardımcıları ───────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Ekle / Düzenle ─────────────────────────────────────────────
function resetPriceForm() {
    document.getElementById('pf-code').value = '';
    document.getElementById('pf-name').value = '';
    document.getElementById('pf-group').value = '';
    document.getElementById('pf-tl').value = '';
    document.getElementById('pf-eur').value = '';
    document.getElementById('pf-usd').value = '';
    document.getElementById('pf-code-error').style.display = 'none';
}

function onPriceCodeInput() {
    const codeInput = document.getElementById('pf-code');
    const nameInput = document.getElementById('pf-name');
    const groupInput = document.getElementById('pf-group');
    const match = urunlerMap.get(normCode(codeInput.value));
    if (match) {
        nameInput.value = match.name;
        document.getElementById('pf-code-error').style.display = 'none';
        if (!groupInput.value && match.grup) groupInput.value = match.grup;
    } else {
        nameInput.value = '';
    }
}

// Ürün Kartları içinde kod/ad üzerinden arama yapan zengin öneri listesi
// (pallet-definitions.js'teki ürün autocomplete deseniyle aynı yaklaşım).
function renderCodeDropdown(query) {
    const dd = document.getElementById('pf-code-dropdown');
    const q = query.toLocaleLowerCase('tr-TR').trim();
    if (!q) { dd.classList.add('hidden'); dd.innerHTML = ''; return; }

    const words = q.split(/\s+/);
    const matches = [];
    urunlerMap.forEach(v => {
        const hay = `${v.code} ${v.name}`.toLocaleLowerCase('tr-TR');
        if (words.every(w => hay.includes(w))) matches.push(v);
    });
    matches.sort((a, b) => a.code.localeCompare(b.code, 'tr'));
    const top = matches.slice(0, 30);

    dd.innerHTML = top.length === 0
        ? `<div class="ac-empty">Sonuç yok</div>`
        : top.map(v => `
            <div class="ac-option" data-code="${escapeHtml(v.code)}">
                <div class="ac-option-name">${escapeHtml(v.name)}</div>
                <div class="ac-option-meta"><span class="code">${escapeHtml(v.code)}</span>${v.grup ? ' · ' + escapeHtml(v.grup) : ''}</div>
            </div>`).join('');

    dd.classList.remove('hidden');
    dd.querySelectorAll('.ac-option').forEach(opt => {
        opt.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.getElementById('pf-code').value = opt.dataset.code;
            onPriceCodeInput();
            dd.classList.add('hidden');
        });
    });
}

function openAddPrice() {
    editingId = null;
    resetPriceForm();
    document.getElementById('price-form-title').textContent = 'Yeni Ürün Ekle';
    openModal('modal-price-form');
    document.getElementById('pf-code').focus();
}

function openEditPrice(id) {
    const p = globalProducts.find(x => x.id === id);
    if (!p) return;
    editingId = id;
    resetPriceForm();
    document.getElementById('pf-code').value = p.product_code || '';
    document.getElementById('pf-group').value = p.group_name || '';
    document.getElementById('pf-tl').value = p.list_price_tl ?? '';
    document.getElementById('pf-eur').value = p.list_price_eur ?? '';
    document.getElementById('pf-usd').value = p.list_price_usd ?? '';
    onPriceCodeInput();
    document.getElementById('price-form-title').textContent = 'Ürünü Düzenle';
    openModal('modal-price-form');
}

async function savePriceRow() {
    if (!canEdit(ctx, 'prices')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }

    const errBox = document.getElementById('pf-code-error');
    const codeRaw = document.getElementById('pf-code').value.trim();
    if (!codeRaw) {
        errBox.textContent = 'Ürün kodu zorunludur.';
        errBox.style.display = 'block';
        return;
    }
    const match = urunlerMap.get(normCode(codeRaw));
    if (!match) {
        errBox.textContent = 'Bu kod Ürün Kartları modülünde bulunamadı.';
        errBox.style.display = 'block';
        return;
    }
    errBox.style.display = 'none';

    const payload = {
        product_code: match.code,
        product_name: match.name,
        group_name: document.getElementById('pf-group').value.trim() || null,
        list_price_tl: parseNum(document.getElementById('pf-tl').value),
        list_price_eur: parseNum(document.getElementById('pf-eur').value),
        list_price_usd: parseNum(document.getElementById('pf-usd').value),
    };

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return showAlertDialog('Oturum bulunamadı.', { variant: 'danger' });

        if (editingId) {
            const { error } = await supabase
                .from('price_list')
                .update(payload)
                .eq('id', editingId)
                .eq('user_id', ctx.ownerId);
            if (error) throw error;
        } else {
            payload.user_id = ctx.ownerId;
            const { error } = await supabase.from('price_list').insert(payload);
            if (error) throw error;
        }

        closeModal('modal-price-form');
        await fetchProducts();
        renderTable();
    } catch (err) {
        console.error('savePriceRow:', err);
        showAlertDialog('Kayıt hatası: ' + err.message, { title: 'Hata', variant: 'danger' });
    }
}

// ── Sil ─────────────────────────────────────────────────────────
async function confirmDeleteRow(id) {
    const p = globalProducts.find(x => x.id === id);
    if (!p) return;

    const ok = await showConfirmDialog(
        `"${p.product_code || '—'} — ${p._displayName || ''}" kalıcı olarak silinecektir.`,
        { title: 'Ürünü Sil', variant: 'danger', confirmText: 'Evet, Sil' }
    );
    if (!ok) return;

    if (!canEdit(ctx, 'prices')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { error } = await supabase
            .from('price_list')
            .delete()
            .eq('id', id)
            .eq('user_id', ctx.ownerId);
        if (error) throw error;

        await fetchProducts();
        renderTable();
    } catch (err) {
        console.error('confirmDeleteRow:', err);
        showAlertDialog('Silme hatası: ' + err.message, { title: 'Hata', variant: 'danger' });
    }
}

// ── Excel Dışa Aktar (ekranda görünen/filtrelenmiş liste) ───────
// Kayıt ID sütunu opsiyoneldir: doluysa "Listeyi İçe Aktar" o satırı günceller,
// boş bırakılırsa (yeni eklenen satırlar) geçerli bir Ürün Kodu ile yeni ürün olarak eklenir.
const ID_HEADER = 'Kayıt ID (opsiyonel — boş = yeni ürün)';

// Renk paleti ExportPro_Siparis_Import_Sablonu.xlsx ile birebir aynı:
// koyu yeşil / zeytin yeşili iki tonlu başlık, krem veri zemini, ince gri kenarlık, zebra yok.
// Not: SheetJS'in ücretsiz sürümü hücre stillerini (font/dolgu/kenarlık) dosyaya YAZMIYOR
// (yalnızca okurken destekliyor) — bu yüzden export burada ExcelJS ile üretiliyor; içe
// aktarma (dosya okuma) tarafı hâlâ XLSX/SheetJS kullanıyor, o taraf zaten sorunsuz çalışıyordu.
const XL_HEADER_BG   = 'FF2D4A3E'; // ana alanlar (kod, ad, grup)
const XL_HEADER_BG_2 = 'FF4A6741'; // ikincil alanlar (fiyat/hesap/durum)
const XL_HEADER_FG   = 'FFFFFFFF';
const XL_BORDER      = 'FFD6D2C9';
const XL_ROW_BG       = 'FFF6F3EC';
const XL_TEXT         = 'FF1C1A17';
const XL_OK_BG      = 'FFE1EBE4';
const XL_OK_FG      = 'FF3D6E50';
const XL_DANGER_BG  = 'FFF1DDD9';
const XL_DANGER_FG  = 'FF9F3D3D';

function xlBorder() {
    const side = { style: 'thin', color: { argb: XL_BORDER } };
    return { top: side, bottom: side, left: side, right: side };
}

async function exportExcel() {
    const filtered = getFilteredProducts();
    if (filtered.length === 0) {
        showAlertDialog('Aktarılacak veri yok.', { variant: 'warn' });
        return;
    }

    const dovizKol = currentTab === 'eur' ? 'EUR' : 'USD';
    const headers = [
        'Ürün Kodu', 'Ürün Adı', 'Grup',
        '2026 TL Liste', '2026 TL Net', `2026 TL Net (${dovizKol})`,
        `2022-3 ${dovizKol} Liste`, `2022-3 ${dovizKol} Net`, 'Fark (%)',
        'Eşleşme Durumu', ID_HEADER,
    ];
    const PRIMARY_COLS = 3; // Ürün Kodu, Ürün Adı, Grup — koyu yeşil başlık

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fiyat Robotu');
    ws.columns = [
        { width: 16 }, { width: 34 }, { width: 16 }, { width: 13 }, { width: 13 },
        { width: 15 }, { width: 13 }, { width: 13 }, { width: 9 }, { width: 12 }, { width: 32 },
    ];

    const headerRow = ws.addRow(headers);
    headerRow.height = 36;
    headerRow.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: XL_HEADER_FG } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNumber <= PRIMARY_COLS ? XL_HEADER_BG : XL_HEADER_BG_2 } };
        cell.border = xlBorder();
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    filtered.forEach(p => {
        const dovizListe = currentTab === 'eur' ? p.list_price_eur : p.list_price_usd;
        const tlNet      = calcTlNet(p.list_price_tl);
        const dovizNet   = calcDovizNet(dovizListe);
        const fark       = calcFark(tlNet, dovizNet);
        const tlNetDoviz = tlNetToDoviz(tlNet);

        const row = ws.addRow([
            p.product_code || '',
            p._displayName || '',
            p.group_name || '',
            p.list_price_tl ?? null,
            tlNet !== null ? Number(tlNet.toFixed(2)) : null,
            tlNetDoviz !== null ? Number(tlNetDoviz.toFixed(2)) : null,
            dovizListe ?? null,
            dovizNet !== null ? Number(dovizNet.toFixed(2)) : null,
            fark !== null ? Number((fark * 100).toFixed(1)) : null,
            p._matched ? 'Eşleşti' : 'Eşleşmedi',
            p.id,
        ]);
        row.height = 25.5;
        row.eachCell((cell, colNumber) => {
            cell.font = { name: 'Arial', size: 10, color: { argb: XL_TEXT } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_ROW_BG } };
            cell.border = xlBorder();
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
            if ([4, 5, 6, 7, 8].includes(colNumber)) { cell.numFmt = '#,##0.00'; cell.alignment.horizontal = 'right'; }
            if (colNumber === 9) { cell.numFmt = '0.0"%"'; cell.alignment.horizontal = 'right'; }
            if (colNumber === 10) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: p._matched ? XL_OK_BG : XL_DANGER_BG } };
                cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: p._matched ? XL_OK_FG : XL_DANGER_FG } };
                cell.alignment.horizontal = 'center';
            }
            if (colNumber === 11) { cell.alignment.horizontal = 'center'; }
        });
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `FiyatRobotu_${currentTab.toUpperCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ── Excel İçe Aktar (Ürün Kodu ile güncelleme, Kayıt ID boşsa yeni ürün) ─
function rowGet(r, ...keys) {
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(r, k) && String(r[k]).trim() !== '') {
            return { present: true, value: String(r[k]).trim() };
        }
        if (Object.prototype.hasOwnProperty.call(r, k)) {
            return { present: true, value: '' };
        }
    }
    return { present: false, value: '' };
}

function rowGetNum(r, ...keys) {
    const g = rowGet(r, ...keys);
    if (!g.present) return { present: false, value: null };
    if (g.value === '') return { present: true, value: null };
    const n = Number(g.value);
    return { present: true, value: isNaN(n) ? null : n };
}

function mapImportRow(r) {
    const codeG = rowGet(r, 'Ürün Kodu', 'product_code');
    if (!codeG.value) return { valid: false, reason: 'Ürün Kodu boş satır — atlandı.' };

    const match = urunlerMap.get(normCode(codeG.value));
    if (!match) return { valid: false, reason: `"${codeG.value}" kodu Ürün Kartları'nda bulunamadı — atlandı.` };

    const groupG = rowGet(r, 'Grup', 'group_name');
    const tlG  = rowGetNum(r, '2026 TL Liste', 'list_price_tl');
    const eurG = rowGetNum(r, '2022-3 EUR Liste', 'list_price_eur');
    const usdG = rowGetNum(r, '2022-3 USD Liste', 'list_price_usd');

    const payload = { product_code: match.code, product_name: match.name };
    if (groupG.present) payload.group_name = groupG.value || null;
    if (tlG.present && tlG.value !== null) payload.list_price_tl = tlG.value;
    if (eurG.present && eurG.value !== null) payload.list_price_eur = eurG.value;
    if (usdG.present && usdG.value !== null) payload.list_price_usd = usdG.value;

    const idG = rowGet(r, ID_HEADER, 'Kayıt ID (Değiştirmeyin)', 'Kayıt ID', 'id');
    if (!idG.value) {
        return { valid: true, mode: 'insert', payload, label: `${match.code} — ${match.name} (yeni)` };
    }

    const existing = globalProducts.find(p => p.id === idG.value);
    if (!existing) return { valid: false, reason: `Kayıt ID bulunamadı: ${idG.value} — satır atlandı.` };

    return { valid: true, mode: 'update', id: idG.value, payload, label: `${match.code} — ${match.name}` };
}

function handlePriceFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];

            const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            let headerRow = 0;
            for (let i = 0; i < Math.min(matrix.length, 5); i++) {
                const cells = matrix[i].map(c => String(c).trim());
                if (cells.includes('Ürün Kodu')) { headerRow = i; break; }
            }

            const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRow });
            if (rows.length === 0) {
                showAlertDialog('Dosyada veri bulunamadı.', { variant: 'warn' });
                return;
            }

            pendingImportRows = rows.map(mapImportRow);
            renderImportPreview();
        } catch (err) {
            console.error('handlePriceFile:', err);
            showAlertDialog('Dosya okunamadı: ' + err.message, { title: 'Hata', variant: 'danger' });
        }
    };
    reader.readAsArrayBuffer(file);
}

function renderImportPreview() {
    const updateRows = pendingImportRows.filter(r => r.valid && r.mode === 'update');
    const insertRows = pendingImportRows.filter(r => r.valid && r.mode === 'insert');
    const invalidRows = pendingImportRows.filter(r => !r.valid);
    const totalValid = updateRows.length + insertRows.length;

    const box = document.getElementById('price-import-summary');
    box.style.display = 'block';
    const errList = invalidRows.slice(0, 30).map(r => `<div class="err-line">• ${escapeHtml(r.reason)}</div>`).join('');
    const moreLine = invalidRows.length > 30 ? `<div class="err-line">…ve ${invalidRows.length - 30} satır daha</div>` : '';

    box.innerHTML = `
        <div style="margin-bottom:8px;">
            <strong style="color:var(--info);">${updateRows.length}</strong> satır güncellenecek,
            <strong style="color:var(--ok);">${insertRows.length}</strong> yeni satır eklenecek${invalidRows.length ? `, <strong style="color:var(--danger)">${invalidRows.length}</strong> satır atlanacak` : ''}.
        </div>
        ${errList}${moreLine}
    `;

    const btn = document.getElementById('btn-price-import-confirm');
    btn.disabled = totalValid === 0;
    document.getElementById('import-count-label').textContent = totalValid > 0 ? `${totalValid} Satır Yükle` : 'Yükle';
}

async function executeImportConfirm() {
    if (!canEdit(ctx, 'prices')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const validRows = pendingImportRows.filter(r => r.valid);
    if (validRows.length === 0) return;

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return showAlertDialog('Oturum bulunamadı.', { variant: 'danger' });
        const uid = ctx.ownerId;

        let updated = 0;
        let inserted = 0;
        const failures = [];
        for (const row of validRows) {
            if (row.mode === 'update') {
                const { error } = await supabase
                    .from('price_list')
                    .update(row.payload)
                    .eq('id', row.id)
                    .eq('user_id', uid);
                if (error) failures.push(`${row.label}: ${error.message}`);
                else updated++;
            } else {
                const { error } = await supabase
                    .from('price_list')
                    .insert({ ...row.payload, user_id: uid });
                if (error) failures.push(`${row.label}: ${error.message}`);
                else inserted++;
            }
        }

        document.getElementById('btn-price-import-confirm').disabled = true;
        document.getElementById('price-import-summary').innerHTML = `
            <div style="margin-bottom:8px;">
                <strong style="color:var(--ok);">${updated}</strong> satır güncellendi,
                <strong style="color:var(--ok);">${inserted}</strong> yeni satır eklendi.
            </div>
            ${failures.map(f => `<div class="err-line">• ${escapeHtml(f)}</div>`).join('')}
        `;
        pendingImportRows = [];

        await fetchProducts();
        renderTable();
    } catch (err) {
        console.error('executeImportConfirm:', err);
        showAlertDialog('İçe aktarma hatası: ' + err.message, { title: 'Hata', variant: 'danger' });
    }
}

function resetImportModal() {
    pendingImportRows = [];
    document.getElementById('price-import-summary').style.display = 'none';
    document.getElementById('price-import-summary').innerHTML = '';
    document.getElementById('price-file-input').value = '';
    document.getElementById('btn-price-import-confirm').disabled = true;
    document.getElementById('import-count-label').textContent = 'Yükle';
}

// ── Event Listeners ───────────────────────────────────────────
function initEventListeners() {
    // İskonto paneli — her değişiklik tabloyu yeniler
    ['tl-d1','tl-d2','tl-d3','tl-d4','doviz-iskonto'].forEach(id => {
        document.getElementById(id).addEventListener('input', renderTable);
    });

    // Arama ve grup filtresi
    document.getElementById('price-search').addEventListener('input', renderTable);
    document.getElementById('group-filter').addEventListener('change', renderTable);

    // Excel dışa aktar
    document.getElementById('btn-export-prices').addEventListener('click', exportExcel);

    // Yeni ürün ekle / kaydet
    document.getElementById('btn-add-price').addEventListener('click', openAddPrice);
    document.getElementById('btn-price-save').addEventListener('click', savePriceRow);

    const pfCode = document.getElementById('pf-code');
    const pfCodeDropdown = document.getElementById('pf-code-dropdown');
    pfCode.addEventListener('input', () => {
        onPriceCodeInput();
        renderCodeDropdown(pfCode.value);
    });
    pfCode.addEventListener('focus', () => {
        if (pfCode.value.trim()) renderCodeDropdown(pfCode.value);
    });
    pfCode.addEventListener('blur', () => {
        setTimeout(() => pfCodeDropdown.classList.add('hidden'), 150);
    });

    // İçe aktarma
    document.getElementById('btn-import-prices').addEventListener('click', () => {
        resetImportModal();
        openModal('modal-price-import');
    });
    document.getElementById('btn-price-import-confirm').addEventListener('click', executeImportConfirm);

    const dropZone = document.getElementById('price-drop-zone');
    const fileInput = document.getElementById('price-file-input');
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handlePriceFile(fileInput.files[0]));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handlePriceFile(e.dataTransfer.files[0]);
    });

    // Modal kapatma
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    ['modal-price-form', 'modal-price-import'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeModal(id);
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            ['modal-price-form', 'modal-price-import'].forEach(id => {
                if (document.getElementById(id).classList.contains('open')) closeModal(id);
            });
        }
    });
}

// ── Global API (onclick'ler için) ───────────────────────────────
window._priceApp = {
    openEdit: openEditPrice,
    confirmDelete: confirmDeleteRow,
};
