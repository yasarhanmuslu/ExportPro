// ═══════════════════════════════════════════════════════════════
// ExportPro — Ürün Kartları (Master Data) — products.js
// V: 1.0.92  ← YENİ: Ürün listesinde kod↔öznitelik çelişkisi olan satırlar için kırmızı "Kod" uyarı rozeti
// ═══════════════════════════════════════════════════════════════

import { supabase } from './utils/supabaseClient.js';
import { requireAuth } from './auth/auth.js';
import { renderNavbar } from './components/navbar.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';
import { IdevitCode } from './utils/idevitCodeRules.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';
import './theme.js';

// ── State ───────────────────────────────────────────────────────
let allProducts = [];
let filteredProducts = [];
let duplicateCodes = {};      // { stok_kodu: count }
let currentPage = 1;
const PAGE_SIZE = 50;
let editingId = null;         // null = add mode, uuid = edit mode
let deleteTargetId = null;
let importRows = [];

// ── Ürün Görseli (Supabase Storage) ────────────────────────────
const BUCKET_URUN_RESIM = 'urun-resimleri';
let pendingImageFile = null;   // yeni seçilen (henüz yüklenmemiş) görsel
let currentImagePath = null;   // düzenlenen üründeki mevcut storage path
let removeImageFlag = false;   // "Kaldır" tıklandıysa
const imageUrlCache = new Map(); // storage path -> imzalı URL

// Dropdown seçenekleri (veriden türetilir)
let distinctGruplar = [];
let distinctSeriler = [];
let distinctRenkler = [];

// Her zaman sunulacak renk seçenekleri (üründe henüz kullanılmamış olsa da)
const BASE_RENKLER = ['Altın Dekor', 'Platin Dekor'];

// ── Init ────────────────────────────────────────────────────────
let ctx = null;

async function init() {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'products'))) return;
    await renderNavbar('products', ctx);
    await loadProducts();
    bindEvents();
    applyEditLock(ctx, 'products');
}
init();

// ── Data Loading ────────────────────────────────────────────────
async function loadProducts() {
    try {
        const { data, error } = await supabase
            .from('urunler')
            .select('*')
            .order('stok_kodu', { ascending: true });

        if (error) throw error;
        allProducts = data || [];

        // Mükerrer stok kodu tespiti
        duplicateCodes = {};
        const codeCount = {};
        allProducts.forEach(p => {
            codeCount[p.stok_kodu] = (codeCount[p.stok_kodu] || 0) + 1;
        });
        Object.entries(codeCount).forEach(([code, count]) => {
            if (count > 1) duplicateCodes[code] = count;
        });

        // Distinct değerler (dropdown'lar için)
        distinctGruplar = [...new Set(allProducts.map(p => p.urun_grubu).filter(Boolean))].sort();
        distinctSeriler = [...new Set(allProducts.map(p => p.seri_adi).filter(Boolean))].sort();
        distinctRenkler = [...new Set(allProducts.map(p => p.renk).filter(Boolean))].sort();

        populateFilterDropdowns();
        populateFormDropdowns();
        applyFilters();
        renderKPI();
    } catch (err) {
        console.error('loadProducts:', err);
        showAlertDialog('Ürünler yüklenirken hata: ' + err.message, { title: 'Hata', variant: 'danger' });
    }
}

// ── Dropdowns ───────────────────────────────────────────────────
function populateFilterDropdowns() {
    const grupSel = document.getElementById('fil-grup');
    const seriSel = document.getElementById('fil-seri');

    grupSel.innerHTML = '<option value="">Tüm Gruplar</option>' +
        distinctGruplar.map(g => `<option>${g}</option>`).join('');
    seriSel.innerHTML = '<option value="">Tüm Seriler</option>' +
        distinctSeriler.map(s => `<option>${s}</option>`).join('');
}

function populateFormDropdowns() {
    const grupSel = document.getElementById('f-urun-grubu');
    grupSel.innerHTML = '<option value="">Seçiniz</option>' +
        distinctGruplar.map(g => `<option>${g}</option>`).join('');

    const renkSel = document.getElementById('f-renk');
    const renkSecenekleri = [...new Set([...distinctRenkler, ...BASE_RENKLER])].sort();
    renkSel.innerHTML = '<option value="">Seçiniz</option>' +
        renkSecenekleri.map(r => `<option>${r}</option>`).join('');
}

// ── KPI ─────────────────────────────────────────────────────────
function renderKPI() {
    const total = allProducts.length;
    const grupCount = distinctGruplar.length;
    const seriCount = distinctSeriler.length;
    const dupCount = Object.keys(duplicateCodes).length;

    document.getElementById('kpi-strip').innerHTML = `
        <div class="kpi-card">
            <div class="label-caps">TOPLAM ÜRÜN</div>
            <div class="kpi-value" style="color:var(--ink-1);margin-top:4px;">${total}</div>
        </div>
        <div class="kpi-card">
            <div class="label-caps">ÜRÜN GRUBU</div>
            <div class="kpi-value" style="color:var(--accent);margin-top:4px;">${grupCount}</div>
        </div>
        <div class="kpi-card">
            <div class="label-caps">SERİ SAYISI</div>
            <div class="kpi-value" style="color:var(--bronze);margin-top:4px;">${seriCount}</div>
        </div>
        <div class="kpi-card">
            <div class="label-caps">MÜKERRER KOD</div>
            <div class="kpi-value" style="color:${dupCount > 0 ? 'var(--warn)' : 'var(--ok)'};margin-top:4px;">${dupCount}</div>
        </div>
    `;
}

// ── Search & Filter ─────────────────────────────────────────────
function applyFilters() {
    const query = (document.getElementById('txt-search').value || '').toLocaleLowerCase('tr-TR').trim();
    const grupFilter = document.getElementById('fil-grup').value;
    const seriFilter = document.getElementById('fil-seri').value;

    filteredProducts = allProducts.filter(p => {
        if (grupFilter && p.urun_grubu !== grupFilter) return false;
        if (seriFilter && p.seri_adi !== seriFilter) return false;
        if (query) {
            const haystack = [
                p.stok_kodu || '',
                p.stok_adi_1 || '',
                p.stok_adi_2 || ''
            ].join(' ').toLocaleLowerCase('tr-TR');
            const words = query.split(/\s+/);
            if (!words.every(w => haystack.includes(w))) return false;
        }
        return true;
    });

    currentPage = 1;
    renderTable();
}

let searchTimer = null;
function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 180);
}

// ── Table Render ────────────────────────────────────────────────
function renderTable() {
    const tbody = document.getElementById('table-body');
    const totalFiltered = filteredProducts.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filteredProducts.slice(start, start + PAGE_SIZE);

    if (totalFiltered === 0) {
        tbody.innerHTML = `<tr><td colspan="11">
            <div class="empty-state"><i class="fa-solid fa-box-open"></i>Sonuç bulunamadı</div>
        </td></tr>`;
        document.getElementById('pager').innerHTML = '';
        return;
    }

    tbody.innerHTML = pageItems.map((p, i) => {
        const rowNum = start + i + 1;
        const isDup = duplicateCodes[p.stok_kodu];
        const dupHtml = isDup ? `<span class="dup-badge"><i class="fa-solid fa-triangle-exclamation" style="font-size:8px;"></i> ${isDup}x</span>` : '';
        const codeCheck = IdevitCode.validate(p.stok_kodu, p.stok_adi_1, { turu: p.urun_turu, renk: p.renk, kalite: p.kalite });
        const codeWarnHtml = codeCheck.hasError
            ? `<span class="code-warn-badge" title="${esc(codeCheck.issues.filter(i => i.level === 'ERROR').map(i => i.message).join(' | '))}"><i class="fa-solid fa-triangle-exclamation" style="font-size:8px;"></i> Kod</span>`
            : '';
        const thumbHtml = p.resim_path
            ? `<img class="prod-thumb" data-path="${esc(p.resim_path)}" alt="">`
            : `<div class="prod-thumb-empty"><i class="fa-solid fa-image"></i></div>`;

        return `<tr data-id="${p.id}" onclick="window._ep.openEdit('${p.id}')">
            <td class="col-thumb">${thumbHtml}</td>
            <td style="color:var(--ink-3);font-size:11px;">${rowNum}</td>
            <td class="col-code">${esc(p.stok_kodu)}${dupHtml}${codeWarnHtml}</td>
            <td class="col-name" title="${esc(p.stok_adi_1)}">${esc(p.stok_adi_1)}</td>
            <td title="${esc(p.stok_adi_2 || '')}">${esc(p.stok_adi_2 || '-')}</td>
            <td>${esc(p.birim || '-')}</td>
            <td>${esc(p.paketleme || '-')}</td>
            <td>${esc(p.urun_grubu || '-')}</td>
            <td>${esc(p.renk || '-')}</td>
            <td>${esc(p.kalite || '-')}</td>
            <td>
                <button class="btn-action btn-danger" style="padding:4px 8px;font-size:11px;"
                    onclick="event.stopPropagation(); window._ep.confirmDelete('${p.id}','${esc(p.stok_kodu)}')">
                    <i class="fa-solid fa-trash" style="font-size:10px;"></i>
                </button>
            </td>
        </tr>`;
    }).join('');

    renderPager(totalFiltered, totalPages);
    resolveThumbnails(pageItems);
}

// ── Ürün Görseli: imzalı URL çözümleme ─────────────────────────
async function getSignedUrl(path) {
    if (!path) return null;
    const cached = imageUrlCache.get(path);
    if (cached) return cached;
    try {
        const { data, error } = await supabase.storage.from(BUCKET_URUN_RESIM).createSignedUrl(path, 3600);
        if (error) throw error;
        imageUrlCache.set(path, data.signedUrl);
        return data.signedUrl;
    } catch (err) {
        console.error('getSignedUrl:', err);
        return null;
    }
}

async function resolveThumbnails(pageItems) {
    const paths = [...new Set(pageItems.map(p => p.resim_path).filter(Boolean))]
        .filter(p => !imageUrlCache.has(p));

    if (paths.length > 0) {
        try {
            const { data, error } = await supabase.storage.from(BUCKET_URUN_RESIM).createSignedUrls(paths, 3600);
            if (error) throw error;
            (data || []).forEach(item => {
                if (item.signedUrl) imageUrlCache.set(item.path, item.signedUrl);
            });
        } catch (err) {
            console.error('resolveThumbnails:', err);
        }
    }

    document.querySelectorAll('#table-body img.prod-thumb[data-path]').forEach(img => {
        const url = imageUrlCache.get(img.dataset.path);
        if (url) img.src = url;
    });
}

function setImagePreview(url) {
    const img = document.getElementById('f-resim-preview');
    const placeholder = document.getElementById('f-resim-placeholder');
    const btnRemove = document.getElementById('btn-resim-kaldir');
    if (url) {
        img.src = url;
        img.style.display = 'block';
        placeholder.style.display = 'none';
        btnRemove.style.display = '';
    } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        placeholder.style.display = 'flex';
        btnRemove.style.display = 'none';
    }
}

// Hiçbir pikseli değiştirmez/silmez — sadece kenarlardan örneklenen asıl arka
// plan rengine göre ürünün sınır kutusunu bulur ve bolca pay bırakarak kırpma
// alanı döner. Böylece ürün detayı (gölge, oyuk vb.) asla kaybolmaz; sonuçta
// kalan boşluk, görselin kendi (beyaz/gri fark etmez) arka plan rengiyle doldurulur.
function detectContentCrop(ctx, width, height, threshold = 40, paddingRatio = 0.12) {
    const data = ctx.getImageData(0, 0, width, height).data;

    const samples = [];
    const sampleAt = (x, y) => {
        const i = (y * width + x) * 4;
        samples.push([data[i], data[i + 1], data[i + 2]]);
    };
    const stepX = Math.max(1, Math.floor(width / 50));
    const stepY = Math.max(1, Math.floor(height / 50));
    for (let x = 0; x < width; x += stepX) { sampleAt(x, 0); sampleAt(x, height - 1); }
    for (let y = 0; y < height; y += stepY) { sampleAt(0, y); sampleAt(width - 1, y); }
    const sum = samples.reduce((acc, s) => [acc[0] + s[0], acc[1] + s[1], acc[2] + s[2]], [0, 0, 0]);
    const bgR = sum[0] / samples.length, bgG = sum[1] / samples.length, bgB = sum[2] / samples.length;

    const isBg = (i) => {
        const dr = data[i] - bgR, dg = data[i + 1] - bgG, db = data[i + 2] - bgB;
        return Math.sqrt(dr * dr + dg * dg + db * db) <= threshold;
    };

    let top = height, bottom = -1, left = width, right = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (!isBg(i)) {
                if (y < top) top = y;
                if (y > bottom) bottom = y;
                if (x < left) left = x;
                if (x > right) right = x;
            }
        }
    }
    if (bottom < top || right < left) return { x: 0, y: 0, w: width, h: height, bgR, bgG, bgB };

    const padX = Math.round((right - left + 1) * paddingRatio);
    const padY = Math.round((bottom - top + 1) * paddingRatio);
    top = Math.max(0, top - padY);
    left = Math.max(0, left - padX);
    bottom = Math.min(height - 1, bottom + padY);
    right = Math.min(width - 1, right + padX);

    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1, bgR, bgG, bgB };
}

function compressImage(file, maxDim = 640) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
            try {
                // 1) Analiz/kırpma için makul bir çalışma boyutuna indir
                const workDim = 1000;
                const workScale = Math.min(1, workDim / Math.max(img.width, img.height));
                const workW = Math.max(1, Math.round(img.width * workScale));
                const workH = Math.max(1, Math.round(img.height * workScale));
                const workCanvas = document.createElement('canvas');
                workCanvas.width = workW;
                workCanvas.height = workH;
                const workCtx = workCanvas.getContext('2d');
                workCtx.drawImage(img, 0, 0, workW, workH);

                // 2) Ürünün sınır kutusunu tespit et (piksel değiştirilmez)
                const crop = detectContentCrop(workCtx, workW, workH);

                // 3) Son boyuta ölçekle; olası boşluk görselin KENDİ arka plan rengiyle
                //    doldurulur (beyazsa beyaz, griyse gri — asla ürün pikseli silinmez).
                //    Kanvas KARE yapılır: tablo/form kutuları kare olduğu için kısa kenarda
                //    kutunun kendi (beyaz) zemini görünmesin, hep görselin kendi rengiyle dolsun.
                const scale = Math.min(1, maxDim / Math.max(crop.w, crop.h));
                const contentW = Math.max(1, Math.round(crop.w * scale));
                const contentH = Math.max(1, Math.round(crop.h * scale));
                const canvasSize = Math.max(contentW, contentH);

                const outCanvas = document.createElement('canvas');
                outCanvas.width = canvasSize;
                outCanvas.height = canvasSize;
                const outCtx = outCanvas.getContext('2d');
                outCtx.fillStyle = `rgb(${Math.round(crop.bgR)}, ${Math.round(crop.bgG)}, ${Math.round(crop.bgB)})`;
                outCtx.fillRect(0, 0, canvasSize, canvasSize);

                const offsetX = Math.round((canvasSize - contentW) / 2);
                const offsetY = Math.round((canvasSize - contentH) / 2);
                outCtx.drawImage(workCanvas, crop.x, crop.y, crop.w, crop.h, offsetX, offsetY, contentW, contentH);

                outCanvas.toBlob(blob => {
                    URL.revokeObjectURL(objUrl);
                    if (!blob) return reject(new Error('Görsel işlenemedi.'));
                    resolve(blob);
                }, 'image/jpeg', 0.85);
            } catch (err) {
                URL.revokeObjectURL(objUrl);
                reject(err);
            }
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Görsel okunamadı.')); };
        img.src = objUrl;
    });
}

async function handleImageSelect(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showAlertDialog('Lütfen bir görsel dosyası seçin (JPG, PNG vb.).', { title: 'Geçersiz Dosya', variant: 'warn' });
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showAlertDialog('Görsel boyutu 8MB\'ı aşamaz.', { title: 'Dosya Çok Büyük', variant: 'warn' });
        return;
    }
    pendingImageFile = file;
    removeImageFlag = false;
    setImagePreview(URL.createObjectURL(file));
    document.getElementById('f-resim-input').value = '';
}

async function handleImageRemove() {
    const ok = await showConfirmDialog('Ürün görseli kaldırılacak. Devam edilsin mi?', {
        title: 'Görseli Kaldır', variant: 'warn', confirmText: 'Kaldır'
    });
    if (!ok) return;
    pendingImageFile = null;
    removeImageFlag = true;
    setImagePreview(null);
}

// Kaydet sırasında bekleyen görsel yükleme/kaldırma işlemini uygula.
async function persistImageChanges(productId, userId) {
    if (!pendingImageFile && !removeImageFlag) return;

    const oldPath = currentImagePath;

    if (pendingImageFile) {
        const blob = await compressImage(pendingImageFile);
        const newPath = `${userId}/${productId}-${Date.now()}.jpg`;

        const { error: upErr } = await supabase.storage.from(BUCKET_URUN_RESIM).upload(newPath, blob, {
            contentType: blob.type,
            upsert: false
        });
        if (upErr) throw upErr;

        const { error: dbErr } = await supabase.from('urunler')
            .update({ resim_path: newPath }).eq('id', productId).eq('user_id', userId);
        if (dbErr) throw dbErr;

        if (oldPath && oldPath !== newPath) {
            await supabase.storage.from(BUCKET_URUN_RESIM).remove([oldPath])
                .catch(err => console.warn('Eski görsel silinemedi:', err));
        }
        imageUrlCache.delete(newPath);
    } else if (removeImageFlag) {
        const { error: dbErr } = await supabase.from('urunler')
            .update({ resim_path: null }).eq('id', productId).eq('user_id', userId);
        if (dbErr) throw dbErr;

        if (oldPath) {
            await supabase.storage.from(BUCKET_URUN_RESIM).remove([oldPath])
                .catch(err => console.warn('Görsel silinemedi:', err));
            imageUrlCache.delete(oldPath);
        }
    }

    pendingImageFile = null;
    removeImageFlag = false;
    currentImagePath = null;
}

function renderPager(total, totalPages) {
    const pagerEl = document.getElementById('pager');
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);

    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        let s = Math.max(2, currentPage - 2);
        let e = Math.min(totalPages - 1, currentPage + 2);
        if (s > 2) pages.push('...');
        for (let i = s; i <= e; i++) pages.push(i);
        if (e < totalPages - 1) pages.push('...');
        pages.push(totalPages);
    }

    pagerEl.innerHTML = `
        <span>${start}–${end} / ${total} ürün</span>
        <div class="pager-btns">
            <button ${currentPage === 1 ? 'disabled' : ''} onclick="window._ep.goPage(${currentPage - 1})">
                <i class="fa-solid fa-chevron-left" style="font-size:10px;"></i>
            </button>
            ${pages.map(p => p === '...'
                ? `<button disabled style="border:none;background:none;color:var(--ink-3);">…</button>`
                : `<button class="${p === currentPage ? 'active' : ''}" onclick="window._ep.goPage(${p})">${p}</button>`
            ).join('')}
            <button ${currentPage === totalPages ? 'disabled' : ''} onclick="window._ep.goPage(${currentPage + 1})">
                <i class="fa-solid fa-chevron-right" style="font-size:10px;"></i>
            </button>
        </div>
    `;
}

// ── Modal Helpers ───────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function resetForm() {
    ['f-stok-kodu','f-adi-1','f-adi-2','f-seri-adi','f-birim','f-paketleme',
     'f-urun-grubu','f-urun-turu','f-fonk1','f-fonk2','f-fonk3','f-boyut',
     'f-renk','f-kalite','f-agirlik-net','f-agirlik-net-pallet','f-agirlik-brut','f-palet-adedi',
     'f-en','f-boy','f-yukseklik','f-palet-cinsi'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    pendingImageFile = null;
    currentImagePath = null;
    removeImageFlag = false;
    setImagePreview(null);
}

// ── DB kolon adları: en_cm / boy_cm / yukseklik_cm (information_schema ile doğrulandı) ──
function fillForm(p) {
    document.getElementById('f-stok-kodu').value = p.stok_kodu || '';
    document.getElementById('f-adi-1').value = p.stok_adi_1 || '';
    document.getElementById('f-adi-2').value = p.stok_adi_2 || '';
    document.getElementById('f-seri-adi').value = p.seri_adi || '';
    document.getElementById('f-birim').value = p.birim || '';
    document.getElementById('f-paketleme').value = p.paketleme || '';
    document.getElementById('f-urun-grubu').value = p.urun_grubu || '';
    document.getElementById('f-urun-turu').value = p.urun_turu || '';
    document.getElementById('f-fonk1').value = p.fonksiyon_1 || '';
    document.getElementById('f-fonk2').value = p.fonksiyon_2 || '';
    document.getElementById('f-fonk3').value = p.fonksiyon_3 || '';
    document.getElementById('f-boyut').value = p.boyut_ozelligi || '';
    document.getElementById('f-renk').value = p.renk || '';
    document.getElementById('f-kalite').value = p.kalite || '';
    document.getElementById('f-agirlik-net').value = p.agirlik_net ?? '';
    document.getElementById('f-agirlik-net-pallet').value = p.agirlik_net ?? '';  // Palet sekmesi senkron kopya
    document.getElementById('f-agirlik-brut').value = p.agirlik_brut ?? '';
    document.getElementById('f-palet-adedi').value = p.palet_adedi ?? '';
    document.getElementById('f-en').value = p.en_cm ?? '';
    document.getElementById('f-boy').value = p.boy_cm ?? '';
    document.getElementById('f-yukseklik').value = p.yukseklik_cm ?? '';
    document.getElementById('f-palet-cinsi').value = p.palet_cinsi || '';

    currentImagePath = p.resim_path || null;
    pendingImageFile = null;
    removeImageFlag = false;
    setImagePreview(null);
    if (currentImagePath) {
        getSignedUrl(currentImagePath).then(url => { if (url) setImagePreview(url); });
    }
}

function getFormData() {
    const val = (id) => document.getElementById(id).value.trim() || null;
    const num = (id) => { const v = document.getElementById(id).value.trim(); return v === '' ? null : Number(v); };
    // Net KG iki sekmede senkron; ikisinden dolu olanı al (event ile zaten eşitleniyor)
    const netKg = num('f-agirlik-net') ?? num('f-agirlik-net-pallet');
    return {
        stok_kodu:      val('f-stok-kodu'),
        stok_adi_1:     val('f-adi-1'),
        stok_adi_2:     val('f-adi-2'),
        seri_adi:       val('f-seri-adi'),
        birim:          val('f-birim'),
        paketleme:      val('f-paketleme'),
        urun_grubu:     val('f-urun-grubu'),
        urun_turu:      val('f-urun-turu'),
        fonksiyon_1:    val('f-fonk1'),
        fonksiyon_2:    val('f-fonk2'),
        fonksiyon_3:    val('f-fonk3'),
        boyut_ozelligi: val('f-boyut'),
        renk:           val('f-renk'),
        kalite:         val('f-kalite'),
        agirlik_net:    netKg,
        agirlik_brut:   num('f-agirlik-brut'),
        palet_adedi:    num('f-palet-adedi'),
        en_cm:          num('f-en'),
        boy_cm:         num('f-boy'),
        yukseklik_cm:   num('f-yukseklik'),
        palet_cinsi:    val('f-palet-cinsi'),
    };
}

// ── CRUD: Add ───────────────────────────────────────────────────
function openAdd() {
    editingId = null;
    resetForm();
    document.getElementById('modal-title').querySelector('span').textContent = 'Yeni Ürün';
    document.getElementById('tab-btn-history').style.display = 'none';
    switchTab('tab-detail');
    openModal('modal-form');
}

// ── CRUD: Edit ──────────────────────────────────────────────────
function openEdit(id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    editingId = id;
    resetForm();
    fillForm(p);
    document.getElementById('modal-title').querySelector('span').textContent = 'Ürün Düzenle';
    document.getElementById('tab-btn-history').style.display = '';
    switchTab('tab-detail');
    openModal('modal-form');
    loadHistory(id);
}

// ── CRUD: Save ──────────────────────────────────────────────────
async function saveProduct() {
    if (!canEdit(ctx, 'products')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const fd = getFormData();

    if (!fd.stok_kodu) return showAlertDialog('Stok Kodu zorunludur.', { variant: 'warn' });
    if (!fd.stok_adi_1) return showAlertDialog('Stok Adı (Türkçe) zorunludur.', { variant: 'warn' });

    // ── İdevit "Konuşan Kod" doğrulaması: kod ile tür/renk/kalite tutarlı mı ──
    const codeCheck = IdevitCode.validate(fd.stok_kodu, fd.stok_adi_1, {
        turu: fd.urun_turu, renk: fd.renk, kalite: fd.kalite,
    });
    if (codeCheck.hasError) {
        const msg = codeCheck.issues.filter(i => i.level === 'ERROR').map(i => '• ' + i.message).join('\n');
        await showAlertDialog('Stok kodu ile ürün öznitelikleri çelişiyor:\n\n' + msg, { title: 'Kod Uyuşmazlığı', variant: 'danger' });
        return;
    }
    const codeWarnings = codeCheck.issues.filter(i => i.level === 'WARNING');
    if (codeWarnings.length) {
        const msg = codeWarnings.map(i => '• ' + i.message).join('\n');
        const proceed = await showConfirmDialog(
            'Stok kodu kontrolünde uyarılar var:\n\n' + msg + '\n\nYine de kaydetmek istiyor musunuz?',
            { title: 'Kod Uyarısı', variant: 'warn', confirmText: 'Yine de Kaydet' }
        );
        if (!proceed) return;
    }

    // ── Mükerrer stok kodu kontrolü ──
    const inputCode = fd.stok_kodu.toString().trim();
    const existing = allProducts.find(p =>
        p.stok_kodu && p.stok_kodu.toString().trim() === inputCode
    );
    if (existing) {
        // Düzenleme modunda kendi kaydıysa sorun yok, başkasına aitse engelle
        if (!editingId || existing.id !== editingId) {
            showAlertDialog('Bu stok kodu ile kayıtlı bir ürün zaten mevcut!\n\nStok Kodu: ' + inputCode, { title: 'Mükerrer Kod', variant: 'warn' });
            return;
        }
    }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return showAlertDialog('Oturum bulunamadı.', { variant: 'danger' });

        let productId = editingId;

        if (editingId) {
            const { error } = await supabase
                .from('urunler')
                .update(fd)
                .eq('id', editingId)
                .eq('user_id', ctx.ownerId);
            if (error) throw error;
            logChange({ ctx, moduleId: 'products', action: 'update', summary: `Ürün güncellendi: ${fd.stok_kodu}` });
        } else {
            fd.user_id = ctx.ownerId;
            const { data, error } = await supabase
                .from('urunler')
                .insert(fd)
                .select('id')
                .single();
            if (error) throw error;
            productId = data.id;
            logChange({ ctx, moduleId: 'products', action: 'create', summary: `Ürün oluşturuldu: ${fd.stok_kodu}` });
        }

        await persistImageChanges(productId, ctx.ownerId);

        closeModal('modal-form');
        await loadProducts();
    } catch (err) {
        console.error('saveProduct:', err);
        showAlertDialog('Kayıt hatası: ' + err.message, { title: 'Hata', variant: 'danger' });
    }
}

// ── CRUD: Delete ────────────────────────────────────────────────
function confirmDelete(id, code) {
    deleteTargetId = id;
    document.getElementById('del-msg').innerHTML =
        `<strong>${esc(code)}</strong> kodlu ürün kalıcı olarak silinecektir.`;
    openModal('modal-delete');
}

async function executeDelete() {
    if (!deleteTargetId) return;
    if (!canEdit(ctx, 'products')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const product = allProducts.find(p => p.id === deleteTargetId);
        const { error } = await supabase
            .from('urunler')
            .delete()
            .eq('id', deleteTargetId)
            .eq('user_id', ctx.ownerId);
        if (error) throw error;
        logChange({ ctx, moduleId: 'products', action: 'delete', summary: `Ürün silindi: ${product ? product.stok_kodu : deleteTargetId}` });

        if (product && product.resim_path) {
            await supabase.storage.from(BUCKET_URUN_RESIM).remove([product.resim_path])
                .catch(err => console.warn('Görsel silinemedi:', err));
        }

        closeModal('modal-delete');
        deleteTargetId = null;
        await loadProducts();
    } catch (err) {
        console.error('deleteProduct:', err);
        showAlertDialog('Silme hatası: ' + err.message, { title: 'Hata', variant: 'danger' });
    }
}

// ── History (Audit Trail) ───────────────────────────────────────
async function loadHistory(urunId) {
    const container = document.getElementById('history-content');
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i>Yükleniyor...</div>';

    try {
        const { data, error } = await supabase
            .from('urun_gecmisi')
            .select('*')
            .eq('urun_id', urunId)
            .order('islem_zamani', { ascending: false })
            .limit(200);

        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i>Henüz değişiklik geçmişi yok</div>';
            return;
        }

        // DB kolon adları: en_cm/boy_cm/yukseklik_cm
        const alanMap = {
            stok_kodu: 'Stok Kodu', stok_adi_1: 'Stok Adı (TR)', stok_adi_2: 'Stok Adı (EN)',
            birim: 'Birim', paketleme: 'Paketleme', seri_adi: 'Seri Adı',
            urun_grubu: 'Ürün Grubu', urun_turu: 'Ürün Türü',
            fonksiyon_1: 'Fonk-1', fonksiyon_2: 'Fonk-2', fonksiyon_3: 'Fonk-3',
            boyut_ozelligi: 'Boyut', renk: 'Renk', kalite: 'Kalite',
            agirlik_net: 'Ağırlık Net', agirlik_brut: 'Ağırlık Brüt',
            palet_adedi: 'Palet Ad.',
            en_cm: 'En',
            boy_cm: 'Boy',
            yukseklik_cm: 'Yükseklik',
            palet_cinsi: 'Palet Cinsi'
        };

        container.innerHTML = `
            <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:6px;">
                <table class="hist-table">
                    <thead><tr>
                        <th>Tarih</th>
                        <th>İşlem</th>
                        <th>Alan</th>
                        <th>Eski Değer</th>
                        <th>Yeni Değer</th>
                    </tr></thead>
                    <tbody>
                        ${data.map(h => {
                            const dt = new Date(h.islem_zamani);
                            const dtStr = dt.toLocaleDateString('tr-TR') + ' ' + dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                            const opClass = h.islem === 'INSERT' ? 'op-insert' : h.islem === 'DELETE' ? 'op-delete' : 'op-update';
                            const opLabel = h.islem === 'INSERT' ? 'Eklendi' : h.islem === 'DELETE' ? 'Silindi' : 'Güncellendi';
                            const alanLabel = h.alan ? (alanMap[h.alan] || h.alan) : '-';
                            return `<tr>
                                <td style="white-space:nowrap;">${dtStr}</td>
                                <td><span class="${opClass}">${opLabel}</span></td>
                                <td>${alanLabel}</td>
                                <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;">${esc(h.eski_deger || '-')}</td>
                                <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;">${esc(h.yeni_deger || '-')}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        console.error('loadHistory:', err);
        container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i>Geçmiş yüklenemedi</div>';
    }
}

// ── Tab Switching ───────────────────────────────────────────────
function switchTab(tabId) {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
}

// ── Import (Excel/CSV) ─────────────────────────────────────────
function openImportModal() {
    importRows = [];
    document.getElementById('import-preview').style.display = 'none';
    document.getElementById('import-preview').innerHTML = '';
    document.getElementById('btn-import-confirm').disabled = true;
    document.getElementById('import-count').textContent = 'Yükle';
    document.getElementById('file-input').value = '';
    const clearBox = document.getElementById('chk-clear-before-import');
    if (clearBox) clearBox.checked = false;
    openModal('modal-import');
}

function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];

            // Başlık satırını otomatik tespit et:
            // İlk satır "Ürün Kartları" gibi gruplama başlığıysa gerçek başlıklar 2. satırdadır.
            const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            let headerRow = 0;
            for (let i = 0; i < Math.min(matrix.length, 5); i++) {
                const cells = matrix[i].map(c => String(c).trim());
                if (cells.includes('Stok Kodu')) { headerRow = i; break; }
            }

            const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRow });

            if (rows.length === 0) return showAlertDialog('Dosyada veri bulunamadı.', { variant: 'warn' });

            importRows = rows.map(r => mapImportRow(r)).filter(Boolean);

            const preview = document.getElementById('import-preview');
            preview.style.display = 'block';
            preview.innerHTML = `
                <div style="font-size:12px;color:var(--ink-1);margin-bottom:8px;">
                    <strong>${importRows.length}</strong> ürün algılandı (ilk 5 gösteriliyor)
                </div>
                <table class="hist-table" style="font-size:10px;">
                    <thead><tr><th>Stok Kodu</th><th>Stok Adı (TR)</th><th>Birim</th><th>Ürün Grubu</th></tr></thead>
                    <tbody>
                        ${importRows.slice(0, 5).map(r => `<tr>
                            <td>${esc(r.stok_kodu || '')}</td>
                            <td>${esc(r.stok_adi_1 || '')}</td>
                            <td>${esc(r.birim || '')}</td>
                            <td>${esc(r.urun_grubu || '')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            `;
            document.getElementById('btn-import-confirm').disabled = false;
            document.getElementById('import-count').textContent = `${importRows.length} Ürün Yükle`;
        } catch (err) {
            console.error('handleFile:', err);
            showAlertDialog('Dosya okunamadı: ' + err.message, { title: 'Hata', variant: 'danger' });
        }
    };
    reader.readAsArrayBuffer(file);
}

function mapImportRow(r) {
    const get = (...keys) => {
        for (const k of keys) {
            if (r[k] !== undefined && r[k] !== '') return String(r[k]).trim();
        }
        return null;
    };
    const getNum = (...keys) => {
        const v = get(...keys);
        if (!v || v === '-') return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
    };

    const stok_kodu = get('Stok Kodu', 'stok_kodu', 'StokKodu', 'SKU');
    const stok_adi_1 = get('Stok Adı-1 (Türkçe)', 'stok_adi_1', 'Stok Adı (TR)', 'StokAdi1');
    if (!stok_kodu || !stok_adi_1) return null;

    return {
        stok_kodu,
        stok_adi_1,
        stok_adi_2:     get('Stok Adı-2 (İngilizce)', 'stok_adi_2', 'Stok Adı (EN)', 'StokAdi2'),
        birim:          get('Birim', 'birim'),
        paketleme:      get('Paketleme', 'paketleme'),
        seri_adi:       get('Seri Adı', 'seri_adi', 'SeriAdi'),
        urun_grubu:     get('Ürün Grubu', 'urun_grubu', 'UrunGrubu'),
        urun_turu:      get('Ürün Türü', 'urun_turu', 'UrunTuru'),
        fonksiyon_1:    get('Fonksiyon Özelliği-1 / Klozet', 'fonksiyon_1', 'Fonk1'),
        fonksiyon_2:    get('Fonksiyon Özelliği-2 / Klozet', 'fonksiyon_2', 'Fonk2'),
        fonksiyon_3:    get('Fonksiyon Özelliği-3 / Lavabo', 'fonksiyon_3', 'Fonk3'),
        boyut_ozelligi: get('Boyut Özelliği', 'boyut_ozelligi', 'Boyut'),
        renk:           get('Renk', 'renk'),
        kalite:         get('Kalite', 'kalite'),
        agirlik_net:    getNum('Ürün Ağırlığı(Net Kg.)', 'agirlik_net'),
        agirlik_brut:   getNum('Ürün Ağırlığı(BrütKg.)', 'agirlik_brut'),
        palet_adedi:    getNum('Palet Adeti(Ad.)', 'palet_adedi'),
        en_cm:          getNum('En (Cm)', 'en_cm', 'en'),
        boy_cm:         getNum('Boy (Cm)', 'boy_cm', 'boy'),
        yukseklik_cm:   getNum('Yükseklik (Cm)', 'yukseklik_cm', 'yukseklik'),
        palet_cinsi:    get('Palet Cinsi', 'palet_cinsi'),
    };
}

function cleanDash(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return (s === '' || s === '-') ? null : s;
}

// stok_kodu normalize: görünmez boşlukları temizleyip string'e çevirir.
function normCode(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

async function executeImport() {
    if (importRows.length === 0) return;
    if (!canEdit(ctx, 'products')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return showAlertDialog('Oturum bulunamadı.', { variant: 'danger' });
        const uid = ctx.ownerId;

        // ── Onay kutusu: mevcut tüm ürünleri silip dosyadan sıfırla ──
        const clearBox = document.getElementById('chk-clear-before-import');
        const clearFirst = !!(clearBox && clearBox.checked);

        // ════════════════════════════════════════════════════════════
        // MOD 1 — SIFIRLA: tüm ürünleri sil, 646 satırı temiz INSERT et
        // ════════════════════════════════════════════════════════════
        if (clearFirst) {
            const ok = await showConfirmDialog(
                `DİKKAT: Mevcut tüm ürünleriniz silinecek ve dosyadaki ` +
                `${importRows.length} ürün sıfırdan yüklenecek.\n\nBu işlem geri alınamaz. Devam edilsin mi?`,
                { title: 'Sıfırdan Yükle', variant: 'danger', confirmText: 'Evet, Sıfırla' }
            );
            if (!ok) return;

            // 1) Kullanıcının tüm ürünlerini sil (RLS güvenlik şartı)
            const { error: delErr } = await supabase
                .from('urunler')
                .delete()
                .eq('user_id', uid);
            if (delErr) throw delErr;

            // 2) Temiz INSERT
            const rows = importRows.map(r => {
                const cleaned = {};
                Object.entries(r).forEach(([k, v]) => { cleaned[k] = cleanDash(v); });
                cleaned.stok_kodu = normCode(cleaned.stok_kodu) || null;
                cleaned.user_id = uid;
                return cleaned;
            });

            const batchSize = 500;
            for (let i = 0; i < rows.length; i += batchSize) {
                const { error } = await supabase.from('urunler').insert(rows.slice(i, i + batchSize));
                if (error) throw error;
            }

            logChange({ ctx, moduleId: 'products', action: 'update', summary: `Sıfırdan içe aktarma: ${rows.length} ürün` });
            closeModal('modal-import');
            showAlertDialog(`Sıfırdan yükleme tamamlandı.\n• Eklenen ürün: ${rows.length}`, { title: 'İçe Aktarma', variant: 'success' });
            importRows = [];
            await loadProducts();
            return;
        }

        // ════════════════════════════════════════════════════════════
        // MOD 2 — AKILLI UPSERT: koda göre güncelle / yoksa ekle
        // ════════════════════════════════════════════════════════════
        // DB'deki mevcut kayıtlar → normalize edilmiş stok_kodu -> id haritası
        const codeToId = {};
        allProducts.forEach(p => {
            const code = normCode(p.stok_kodu);
            if (code && codeToId[code] === undefined) {
                codeToId[code] = p.id;
            }
        });

        let insertedCount = 0;
        let updatedCount = 0;
        const batchSize = 500;
        let insertBuffer = [];

        const flushInserts = async () => {
            if (insertBuffer.length === 0) return;
            for (let i = 0; i < insertBuffer.length; i += batchSize) {
                const { error } = await supabase
                    .from('urunler')
                    .insert(insertBuffer.slice(i, i + batchSize));
                if (error) throw error;
            }
            insertedCount += insertBuffer.length;
            insertBuffer = [];
        };

        // Sıralı işleme: aynı dosyada tekrar eden kodlar yerel haritadan yakalanır
        for (const r of importRows) {
            const cleaned = {};
            Object.entries(r).forEach(([k, v]) => { cleaned[k] = cleanDash(v); });
            const code = normCode(cleaned.stok_kodu);
            cleaned.stok_kodu = code || null;

            if (code && codeToId[code] !== undefined) {
                // UPDATE — mevcut kayıt (user_id sahipliği korunur)
                const payload = { ...cleaned };
                delete payload.user_id;
                const { error } = await supabase
                    .from('urunler')
                    .update(payload)
                    .eq('id', codeToId[code])
                    .eq('user_id', uid);
                if (error) throw error;
                updatedCount++;
            } else {
                // INSERT — önce mevcut buffer'ı boşalt ki yeni ID'yi bekleyen
                // sonraki güncellemeler için kaydı tek tek ekleyip ID'sini alalım
                await flushInserts();
                cleaned.user_id = uid;
                const { data, error } = await supabase
                    .from('urunler')
                    .insert(cleaned)
                    .select('id')
                    .single();
                if (error) throw error;
                insertedCount++;
                // Yerel haritayı anlık güncelle → dosya içi tekrarlar update'e döner
                if (code && data && data.id) codeToId[code] = data.id;
            }
        }
        await flushInserts();

        logChange({ ctx, moduleId: 'products', action: 'update', summary: `Akıllı içe aktarma: ${insertedCount} yeni, ${updatedCount} güncelleme` });
        closeModal('modal-import');
        showAlertDialog(`İçe aktarma tamamlandı.\n• Yeni eklenen: ${insertedCount}\n• Güncellenen: ${updatedCount}`, { title: 'İçe Aktarma', variant: 'success' });
        importRows = [];
        await loadProducts();
    } catch (err) {
        console.error('executeImport:', err);
        showAlertDialog('İçe aktarma hatası: ' + err.message, { title: 'Hata', variant: 'danger' });
    }
}

// ── Export (Excel) ──────────────────────────────────────────────
function exportToExcel() {
    if (allProducts.length === 0) return showAlertDialog('Dışa aktarılacak ürün yok.', { variant: 'warn' });

    const headers = [
        'Stok Kodu', 'Stok Adı-1 (Türkçe)', 'Stok Adı-2 (İngilizce)', 'Birim', 'Paketleme',
        'Seri Adı', 'Ürün Grubu', 'Ürün Türü', 'Fonksiyon Özelliği-1', 'Fonksiyon Özelliği-2',
        'Fonksiyon Özelliği-3', 'Boyut Özelliği', 'Renk', 'Kalite', 'Ağırlık Net (Kg)',
        'Ağırlık Brüt (Kg)', 'Palet Adedi', 'En (Cm)', 'Boy (Cm)', 'Yükseklik (Cm)', 'Palet Cinsi'
    ];

    const rows = allProducts.map(p => [
        p.stok_kodu, p.stok_adi_1, p.stok_adi_2, p.birim, p.paketleme,
        p.seri_adi, p.urun_grubu, p.urun_turu, p.fonksiyon_1, p.fonksiyon_2,
        p.fonksiyon_3, p.boyut_ozelligi, p.renk, p.kalite, p.agirlik_net,
        p.agirlik_brut, p.palet_adedi,
        p.en_cm,
        p.boy_cm,
        p.yukseklik_cm,
        p.palet_cinsi
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((_, i) => ({ wch: i <= 2 ? 36 : 16 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ürün Kartları');
    XLSX.writeFile(wb, `Urun_Kartlari_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Event Bindings ──────────────────────────────────────────────
function bindEvents() {
    document.getElementById('txt-search').addEventListener('input', onSearchInput);
    document.getElementById('fil-grup').addEventListener('change', applyFilters);
    document.getElementById('fil-seri').addEventListener('change', applyFilters);

    // Net KG iki sekmede senkron: biri değişince diğerini eşitle
    const netMain = document.getElementById('f-agirlik-net');
    const netPallet = document.getElementById('f-agirlik-net-pallet');
    if (netMain && netPallet) {
        netMain.addEventListener('input', () => { netPallet.value = netMain.value; });
        netPallet.addEventListener('input', () => { netMain.value = netPallet.value; });
    }

    document.getElementById('btn-add').addEventListener('click', openAdd);
    document.getElementById('btn-import').addEventListener('click', openImportModal);
    document.getElementById('btn-export').addEventListener('click', exportToExcel);
    document.getElementById('btn-save').addEventListener('click', saveProduct);
    document.getElementById('btn-del-confirm').addEventListener('click', executeDelete);
    document.getElementById('btn-import-confirm').addEventListener('click', executeImport);

    document.getElementById('btn-resim-sec').addEventListener('click', () => document.getElementById('f-resim-input').click());
    document.getElementById('f-resim-input').addEventListener('change', (e) => handleImageSelect(e.target.files[0]));
    document.getElementById('btn-resim-kaldir').addEventListener('click', handleImageRemove);

    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });

    ['modal-form', 'modal-delete', 'modal-import'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeModal(id);
        });
    });

    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFile(e.dataTransfer.files[0]);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            ['modal-import', 'modal-delete', 'modal-form'].forEach(id => {
                if (document.getElementById(id).classList.contains('open')) {
                    closeModal(id);
                    e.stopPropagation();
                }
            });
        }
    });
}

// ── Utilities ───────────────────────────────────────────────────
function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Global API (onclick'ler için) ───────────────────────────────
window._ep = {
    openEdit,
    confirmDelete,
    goPage(n) { currentPage = n; renderTable(); }
};
