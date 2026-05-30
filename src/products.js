// ============================================================
// src/products.js — Ürün Tanımlama Kartı
// Export Pro V: 1.0.23
// ============================================================

import { renderNavbar } from './components/navbar.js';
import { requireAuth }  from './auth/auth.js';
import { supabase }     from './utils/supabaseClient.js';

// ── State ────────────────────────────────────────────────────
let session           = null;
let globalProducts    = [];
let filteredProducts  = [];
let currentPage       = 1;
const PAGE_SIZE       = 20;
let deletingId        = null;
let editingPriceProductId = null;
let missingCurrency   = null;   // 'EUR' | 'USD' | 'TRY' | null

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  renderNavbar('products');
  session = await requireAuth();
  if (!session) return;
  bindEvents();
  await fetchProducts();
});

// ── Veri Çekme ───────────────────────────────────────────────
async function fetchProducts() {
  try {
    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', session.user.id)
      .order('product_group', { ascending: true })
      .order('product_name',  { ascending: true });

    if (pErr) throw pErr;

    const { data: prices, error: prErr } = await supabase
      .from('product_prices')
      .select('*')
      .eq('user_id', session.user.id);

    if (prErr) throw prErr;

    const priceMap = {};
    (prices || []).forEach(p => {
      if (!priceMap[p.product_id]) priceMap[p.product_id] = [];
      priceMap[p.product_id].push(p);
    });

    globalProducts = (products || []).map(p => ({
      ...p,
      prices: priceMap[p.id] || []
    }));

    updateStats();
    populateGroupFilter();
    applyFilters();

  } catch (err) {
    console.error('fetchProducts error:', err);
    alert('Ürünler yüklenirken hata oluştu: ' + err.message);
  }
}

// ── Eksik Fiyat Buton Stilleri ────────────────────────────────
function updateMissingBtnStyles() {
  const colorMap = {
    EUR: { ring: 'ring-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/60' },
    USD: { ring: 'ring-amber-500',   bg: 'bg-amber-500/10',   border: 'border-amber-500/60'   },
    TRY: { ring: 'ring-sky-500',     bg: 'bg-sky-500/10',     border: 'border-sky-500/60'     },
  };
  document.querySelectorAll('.stat-missing-btn').forEach(btn => {
    const currency = btn.dataset.currency;
    const cls = colorMap[currency];
    if (missingCurrency === currency) {
      btn.classList.add('ring-2', cls.ring, cls.bg, cls.border);
      btn.classList.remove('border-[var(--border)]');
      // İkon her zaman görünür
      const icon = btn.querySelector('.fa-triangle-exclamation');
      if (icon) icon.classList.remove('opacity-0');
    } else {
      btn.classList.remove('ring-2', cls.ring, cls.bg, cls.border);
      btn.classList.add('border-[var(--border)]');
      const icon = btn.querySelector('.fa-triangle-exclamation');
      if (icon) icon.classList.add('opacity-0');
    }
  });
}

// ── İstatistikler ─────────────────────────────────────────────
function updateStats() {
  const year = new Date().getFullYear();
  document.getElementById('stat-total').textContent  = globalProducts.length;
  const groups = new Set(globalProducts.map(p => p.product_group).filter(Boolean));
  document.getElementById('stat-groups').textContent = groups.size;

  // Eksik fiyat sayıları (cari yıl için)
  const missingEur = globalProducts.filter(p => !p.prices.some(pr => pr.currency === 'EUR' && pr.price_year === year)).length;
  const missingUsd = globalProducts.filter(p => !p.prices.some(pr => pr.currency === 'USD' && pr.price_year === year)).length;
  const missingTry = globalProducts.filter(p => !p.prices.some(pr => pr.currency === 'TRY' && pr.price_year === year)).length;
  document.getElementById('stat-eur').textContent = missingEur;
  document.getElementById('stat-usd').textContent = missingUsd;
  document.getElementById('stat-try').textContent = missingTry;
}

// ── Grup Filtresi ─────────────────────────────────────────────
function populateGroupFilter() {
  const select = document.getElementById('filter-group');
  const groups = [...new Set(globalProducts.map(p => p.product_group).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML = '<option value="">Tüm Gruplar</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    if (g === current) opt.selected = true;
    select.appendChild(opt);
  });
}

// ── Filtreleme ────────────────────────────────────────────────
function applyFilters() {
  const search = document.getElementById('search-input').value.trim().toLowerCase();
  const group  = document.getElementById('filter-group').value;
  const year   = new Date().getFullYear();

  // Clear butonu görünürlüğü
  const clearBtn = document.getElementById('btn-search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !search);

  filteredProducts = globalProducts
    .filter(p => {
      const matchSearch = !search ||
        p.product_name.toLowerCase().includes(search) ||
        p.product_code.toLowerCase().includes(search);
      const matchGroup = !group || p.product_group === group;
      const matchMissing = !missingCurrency ||
        !p.prices.some(pr => pr.currency === missingCurrency && pr.price_year === year);
      return matchSearch && matchGroup && matchMissing;
    })
    .sort((a, b) => {
      const gA = (a.product_group || '').toLowerCase();
      const gB = (b.product_group || '').toLowerCase();
      if (gA < gB) return -1;
      if (gA > gB) return 1;
      const nA = (a.product_name || '').toLowerCase();
      const nB = (b.product_name || '').toLowerCase();
      return nA < nB ? -1 : nA > nB ? 1 : 0;
    });

  // Sonuç badge'i
  const badge   = document.getElementById('search-result-badge');
  const countEl = document.getElementById('search-result-count');
  if (badge && countEl) {
    const isFiltered = search || group || missingCurrency;
    if (isFiltered) {
      badge.classList.remove('hidden');
      badge.classList.add('flex');
      const label = missingCurrency ? `${missingCurrency} fiyatı eksik` : 'sonuç';
      countEl.textContent = `${filteredProducts.length} ${label}`;
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  }

  currentPage = 1;
  renderTable();
}

// ── Tablo Render ──────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('product-table-body');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filteredProducts.slice(start, start + PAGE_SIZE);

  if (page.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-[var(--text-secondary)] py-16">
          <i class="fa-solid fa-box-open text-2xl mb-3 block opacity-40"></i>
          Ürün bulunamadı
        </td>
      </tr>`;
    updatePagination();
    return;
  }

  let lastGroup = null;
  tbody.innerHTML = page.map(p => {
    const groupHeader = p.product_group !== lastGroup
      ? `<tr class="bg-[var(--bg-primary)]">
           <td colspan="11" class="px-4 py-2 text-xs font-semibold text-[#2D4A3E] uppercase tracking-widest border-t border-[var(--border)]">
             <i class="fa-solid fa-layer-group mr-1.5 opacity-60"></i>${escHtml(p.product_group || 'Grupsuz')}
           </td>
         </tr>`
      : '';
    lastGroup = p.product_group;

    const eur2026 = p.prices.find(pr => pr.currency === 'EUR' && pr.price_year === 2026);
    const usd2026 = p.prices.find(pr => pr.currency === 'USD' && pr.price_year === 2026);
    const try2026 = p.prices.find(pr => pr.currency === 'TRY' && pr.price_year === 2026);
    const fmtEur  = v => v != null ? '€' + Number(v).toFixed(2) : '<span class="text-[#968B7A]">—</span>';
    const fmtUsd  = v => v != null ? '$' + Number(v).toFixed(2) : '<span class="text-[#968B7A]">—</span>';
    const fmtTry  = v => v != null ? '₺' + Number(v).toFixed(2) : '<span class="text-[#968B7A]">—</span>';
    const fmtKg   = v => v != null ? Number(v).toFixed(2) : '—';
    const metaParts = [];
    if (p.color)    metaParts.push(escHtml(p.color));
    if (p.function) metaParts.push(escHtml(p.function));
    const metaLine = metaParts.length
      ? `<div class="text-xs text-[var(--text-secondary)] truncate">${metaParts.join(' · ')}</div>`
      : '';

    return groupHeader + `
      <tr class="border-t border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
        <td class="px-4 py-3">
          <span class="font-mono text-xs bg-[#E8EEEA] text-[#2D4A3E] px-2 py-0.5 rounded">
            ${escHtml(p.product_code)}
          </span>
        </td>
        <td class="px-4 py-3 text-sm font-medium text-[var(--text-primary)] max-w-xs">
          <div class="truncate" title="${escHtml(p.product_name)}">${escHtml(p.product_name)}</div>
          ${metaLine}
        </td>
        <td class="px-4 py-3">
          <span class="text-xs bg-slate-700/50 text-[#6B655B] px-2 py-0.5 rounded-full">
            ${escHtml(p.product_group || '—')}
          </span>
        </td>
        <td class="px-4 py-3 text-right text-xs text-[var(--text-secondary)] whitespace-nowrap">
          ${fmtKg(p.net_weight)} / ${fmtKg(p.gross_weight)}
        </td>
        <td class="px-4 py-3 text-right text-sm text-[var(--text-primary)]">${fmtEur(eur2026?.list_price)}</td>
        <td class="px-4 py-3 text-right text-sm font-semibold text-[#3D6E50]">${fmtEur(eur2026?.net_price)}</td>
        <td class="px-4 py-3 text-right text-sm text-[var(--text-primary)]">${fmtUsd(usd2026?.list_price)}</td>
        <td class="px-4 py-3 text-right text-sm font-semibold text-[#B26B33]">${fmtUsd(usd2026?.net_price)}</td>
        <td class="px-4 py-3 text-right text-sm text-[var(--text-primary)]">${fmtTry(try2026?.list_price)}</td>
        <td class="px-4 py-3 text-right text-sm font-semibold text-sky-400">${fmtTry(try2026?.net_price)}</td>
        <td class="px-4 py-3 text-center">
          <div class="flex items-center justify-center gap-2">
            <button onclick="openPriceModal('${p.id}')"
              title="Fiyat Yönetimi"
              class="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[#B26B33] hover:bg-amber-400/10 transition-colors">
              <i class="fa-solid fa-tag text-sm"></i>
            </button>
            <button onclick="openEditProduct('${p.id}')"
              title="Düzenle"
              class="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[#2D4A3E] hover:bg-[#E8EEEA]/10 transition-colors">
              <i class="fa-solid fa-pen text-sm"></i>
            </button>
            <button onclick="openDeleteModal('${p.id}')"
              title="Sil"
              class="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[#9F3D3D] hover:bg-rose-400/10 transition-colors">
              <i class="fa-solid fa-trash text-sm"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  updatePagination();
}

function updatePagination() {
  const total = filteredProducts.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, total);
  document.getElementById('pagination-info').textContent =
    total === 0 ? '' : `${start}–${end} / ${total} ürün`;
  document.getElementById('btn-prev').disabled = currentPage <= 1;
  document.getElementById('btn-next').disabled = currentPage >= pages;
}

// ── Ürün Modal ────────────────────────────────────────────────
function openAddProduct() {
  document.getElementById('product-id').value          = '';
  document.getElementById('product-code').value        = '';
  document.getElementById('product-name').value        = '';
  document.getElementById('product-group').value       = '';
  document.getElementById('product-color').value        = '';
  document.getElementById('product-function').value     = '';
  document.getElementById('product-net-weight').value   = '';
  document.getElementById('product-gross-weight').value = '';
  document.getElementById('product-description').value = '';
  document.getElementById('modal-product-title').textContent = 'Yeni Ürün';
  showModal('modal-product');
}

window.openEditProduct = function(id) {
  const p = globalProducts.find(x => x.id === id);
  if (!p) return;
  document.getElementById('product-id').value          = p.id;
  document.getElementById('product-code').value        = p.product_code;
  document.getElementById('product-name').value        = p.product_name;
  document.getElementById('product-group').value       = p.product_group || '';
  document.getElementById('product-color').value        = p.color    || '';
  document.getElementById('product-function').value     = p.function || '';
  document.getElementById('product-net-weight').value   = p.net_weight   != null ? p.net_weight   : '';
  document.getElementById('product-gross-weight').value = p.gross_weight != null ? p.gross_weight : '';
  document.getElementById('product-description').value = p.description  || '';
  document.getElementById('modal-product-title').textContent = 'Ürün Düzenle';
  showModal('modal-product');
};

async function saveProduct() {
  const id   = document.getElementById('product-id').value.trim();
  const code = document.getElementById('product-code').value.trim();
  const name = document.getElementById('product-name').value.trim();
  const grp  = document.getElementById('product-group').value.trim();
  const color = document.getElementById('product-color').value.trim();
  const func  = document.getElementById('product-function').value.trim();
  const desc = document.getElementById('product-description').value.trim();

  if (!code) { alert('Ürün kodu zorunludur.'); return; }
  if (!name) { alert('Ürün adı zorunludur.'); return; }

  // ── Ağırlık doğrulama ──
  const netW   = validateWeight('product-net-weight', 'Net ağırlık');
  if (netW === false) return;
  const grossW = validateWeight('product-gross-weight', 'Brüt ağırlık');
  if (grossW === false) return;

  try {
    const payload = {
      user_id:       session.user.id,
      product_code:  code,
      product_name:  name,
      product_group: grp  || null,
      color:         color || null,
      function:      func  || null,
      net_weight:    netW,
      gross_weight:  grossW,
      description:   desc || null,
    };

    if (id) {
      const { error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', id)
        .eq('user_id', session.user.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('products')
        .insert(payload);
      if (error) throw error;
    }

    hideModal('modal-product');
    await fetchProducts();

  } catch (err) {
    console.error('saveProduct error:', err);
    alert('Kayıt hatası: ' + err.message);
  }
}

// ── Silme Modal ───────────────────────────────────────────────
window.openDeleteModal = function(id) {
  deletingId = id;
  const p = globalProducts.find(x => x.id === id);
  document.getElementById('delete-confirm-text').textContent =
    `"${p?.product_name}" ürünü ve tüm fiyat kayıtları silinecek. Emin misiniz?`;
  showModal('modal-delete');
};

async function confirmDelete() {
  if (!deletingId) return;
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', deletingId)
      .eq('user_id', session.user.id);
    if (error) throw error;
    hideModal('modal-delete');
    deletingId = null;
    await fetchProducts();
  } catch (err) {
    console.error('deleteProduct error:', err);
    if (err.code === '23503') {
      alert('Bu ürün silinemez!\nÜrüne ait fiyat kaydı bulunmaktadır.\nÖnce ürün fiyatlarını siliniz.');
    } else {
      alert('Silme hatası: ' + err.message);
    }
  }
}

// ── Fiyat Modal ───────────────────────────────────────────────
window.openPriceModal = function(productId) {
  editingPriceProductId = productId;
  const p = globalProducts.find(x => x.id === productId);
  document.getElementById('price-modal-product-name').textContent =
    `${p.product_code} — ${p.product_name}`;
  resetPriceForm();
  renderPriceList(p.prices);
  showModal('modal-prices');
};

function renderPriceList(prices) {
  const container = document.getElementById('price-list');
  if (!prices || prices.length === 0) {
    container.innerHTML = `<p class="text-sm text-[var(--text-secondary)] text-center py-4">Henüz fiyat kaydı yok.</p>`;
    return;
  }
  const sorted = [...prices].sort((a, b) =>
    b.price_year - a.price_year || a.currency.localeCompare(b.currency)
  );
  container.innerHTML = sorted.map(pr => {
    const disc    = pr.discount_rate != null ? `%${Number(pr.discount_rate).toFixed(2)}` : '—';
    const sym      = pr.currency === 'EUR' ? '€' : pr.currency === 'USD' ? '$' : '₺';
    const colorCls = pr.currency === 'EUR' ? 'text-[#3D6E50]' : pr.currency === 'USD' ? 'text-[#B26B33]' : 'text-sky-400';
    return `
      <div class="flex items-center justify-between bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-4 py-3 gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-xs font-semibold px-2 py-0.5 rounded ${pr.currency === 'EUR' ? 'bg-emerald-500/10 text-[#3D6E50]' : pr.currency === 'USD' ? 'bg-amber-500/10 text-[#B26B33]' : 'bg-sky-500/10 text-sky-400'}">
            ${pr.price_year} ${pr.currency}
          </span>
          <div class="text-sm min-w-0">
            <span class="text-[var(--text-secondary)]">Liste:</span>
            <span class="font-medium ml-1">${sym}${Number(pr.list_price || 0).toFixed(2)}</span>
            <span class="text-[var(--text-secondary)] ml-3">Net:</span>
            <span class="font-semibold ml-1 ${colorCls}">${sym}${Number(pr.net_price || 0).toFixed(2)}</span>
            <span class="text-[var(--text-secondary)] ml-3">İsk:</span>
            <span class="ml-1 text-[#9F3D3D] font-medium">${disc}</span>
          </div>
        </div>
        <div class="flex gap-1.5 flex-shrink-0">
          <button onclick="startEditPrice('${pr.id}')"
            class="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[#2D4A3E] hover:bg-[#E8EEEA]/10 transition-colors">
            <i class="fa-solid fa-pen text-xs"></i>
          </button>
          <button onclick="deletePrice('${pr.id}')"
            class="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[#9F3D3D] hover:bg-rose-400/10 transition-colors">
            <i class="fa-solid fa-trash text-xs"></i>
          </button>
        </div>
      </div>`;
  }).join('');
}

window.startEditPrice = function(priceId) {
  const p  = globalProducts.find(x => x.id === editingPriceProductId);
  const pr = p?.prices.find(x => x.id === priceId);
  if (!pr) return;
  document.getElementById('price-edit-id').value    = pr.id;
  document.getElementById('price-year').value       = pr.price_year;
  document.getElementById('price-currency').value   = pr.currency;
  document.getElementById('price-list').value       = pr.list_price || '';
  document.getElementById('price-net').value        = pr.net_price  || '';
  calcDiscount();
  document.getElementById('btn-price-save-label').textContent = 'Güncelle';
  document.getElementById('btn-price-cancel-edit').classList.remove('hidden');
};

function resetPriceForm() {
  document.getElementById('price-edit-id').value  = '';
  document.getElementById('price-year').value     = new Date().getFullYear();
  document.getElementById('price-currency').value = 'EUR';
  document.getElementById('price-list').value     = '';
  document.getElementById('price-net').value      = '';
  document.getElementById('price-discount').value = '';
  document.getElementById('btn-price-save-label').textContent = 'Ekle';
  document.getElementById('btn-price-cancel-edit').classList.add('hidden');
}

function calcDiscount() {
  const list = parseFloat(document.getElementById('price-list').value);
  const net  = parseFloat(document.getElementById('price-net').value);
  if (list > 0 && net >= 0) {
    document.getElementById('price-discount').value = ((1 - net / list) * 100).toFixed(2);
  } else {
    document.getElementById('price-discount').value = '';
  }
}

async function savePrice() {
  const editId   = document.getElementById('price-edit-id').value;
  const year     = parseInt(document.getElementById('price-year').value);
  const currency = document.getElementById('price-currency').value;
  const listVal  = parseFloat(document.getElementById('price-list').value);
  const netVal   = parseFloat(document.getElementById('price-net').value);
  const discVal  = parseFloat(document.getElementById('price-discount').value);

  if (!year || !currency) { alert('Yıl ve döviz zorunludur.'); return; }

  try {
    const payload = {
      user_id:       session.user.id,
      product_id:    editingPriceProductId,
      price_year:    year,
      currency,
      list_price:    isNaN(listVal) ? null : listVal,
      net_price:     isNaN(netVal)  ? null : netVal,
      discount_rate: isNaN(discVal) ? null : discVal,
    };

    if (editId) {
      const { error } = await supabase
        .from('product_prices')
        .update(payload)
        .eq('id', editId)
        .eq('user_id', session.user.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('product_prices')
        .insert(payload);
      if (error) throw error;
    }

    await fetchProducts();
    const updated = globalProducts.find(x => x.id === editingPriceProductId);
    renderPriceList(updated.prices);
    resetPriceForm();

  } catch (err) {
    console.error('savePrice error:', err);
    alert('Fiyat kayıt hatası: ' + err.message);
  }
}

window.deletePrice = async function(priceId) {
  if (!confirm('Bu fiyat kaydı silinecek. Emin misiniz?')) return;
  try {
    const { error } = await supabase
      .from('product_prices')
      .delete()
      .eq('id', priceId)
      .eq('user_id', session.user.id);
    if (error) throw error;
    await fetchProducts();
    const updated = globalProducts.find(x => x.id === editingPriceProductId);
    renderPriceList(updated.prices);
  } catch (err) {
    console.error('deletePrice error:', err);
    if (err.code === '23503') {
      alert('Bu fiyat kaydı silinemez!\nBağlı kayıtlar bulunmaktadır.');
    } else {
      alert('Silme hatası: ' + err.message);
    }
  }
};

// ── Event Binding ─────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-add-product').onclick           = openAddProduct;
  document.getElementById('modal-product-save').onclick        = saveProduct;
  document.getElementById('modal-product-cancel').onclick      = () => hideModal('modal-product');
  document.getElementById('modal-product-close').onclick       = () => hideModal('modal-product');
  document.getElementById('modal-prices-close').onclick        = () => hideModal('modal-prices');
  document.getElementById('btn-price-save').onclick            = savePrice;
  document.getElementById('btn-price-cancel-edit').onclick     = resetPriceForm;
  document.getElementById('price-list').oninput                = calcDiscount;
  document.getElementById('price-net').oninput                 = calcDiscount;
  document.getElementById('btn-delete-confirm').onclick        = confirmDelete;
  document.getElementById('btn-delete-cancel').onclick         = () => hideModal('modal-delete');
  document.getElementById('search-input').oninput              = applyFilters;
  document.getElementById('btn-search-clear').onclick          = () => {
    document.getElementById('search-input').value = '';
    applyFilters();
    document.getElementById('search-input').focus();
  };
  document.getElementById('filter-group').onchange             = applyFilters;

  // Eksik fiyat filtre kartları
  document.querySelectorAll('.stat-missing-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const currency = btn.dataset.currency;
      missingCurrency = missingCurrency === currency ? null : currency;
      updateMissingBtnStyles();
      applyFilters();
    });
  });
  document.getElementById('btn-prev').onclick = () => { currentPage--; renderTable(); };
  document.getElementById('btn-next').onclick = () => { currentPage++; renderTable(); };

  ['modal-product', 'modal-prices', 'modal-delete'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) hideModal(id);
    });
  });
}

// ── Ağırlık Doğrulama ─────────────────────────────────────────
// Dönüş: null (boş) | number (geçerli) | false (geçersiz/iptal — kayıt durmalı)
function validateWeight(elementId, label) {
  const el  = document.getElementById(elementId);
  const raw = el.value.trim();
  if (raw === '') return null;

  let val = parseFloat(raw.replace(',', '.'));
  if (isNaN(val)) {
    alert(`${label} geçerli bir sayı olmalıdır.`);
    el.focus();
    return false;
  }
  if (val < 0) {
    alert(`${label} negatif değer olamaz.`);
    el.focus();
    return false;
  }

  // 2 hane hassasiyet
  val = Math.round(val * 100) / 100;

  // 75 kg üzeri onay
  if (val > 75) {
    const ok = confirm(`${label} ${val.toFixed(2)} kg olarak girildi (75 kg üzeri).\nDeğer doğru mu? Onaylıyor musunuz?`);
    if (!ok) {
      // Onay yok → değer düzeltilsin
      el.value = '';
      el.focus();
      return false;
    }
  }

  el.value = val.toFixed(2);
  return val;
}

// ── Modal Yardımcıları ────────────────────────────────────────
function showModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.classList.add('flex');
}
function hideModal(id) {
  const el = document.getElementById(id);
  el.classList.add('hidden');
  el.classList.remove('flex');
}

// ── XSS Koruma ───────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
