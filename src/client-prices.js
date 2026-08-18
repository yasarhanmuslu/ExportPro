import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';

// Global veriler
let globalCustomers = [];
let globalClientPrices = []; // { customer_id, company_name, currency, products: [...] }
let tempProducts = []; // Modal içi geçici ürün listesi
let globalProductOptions = []; // urunler: { id, stok_kodu, stok_adi_1, stok_adi_2, resim_path }
let productById = new Map();   // urunler.id       -> ürün
let productByCode = new Map(); // normCode(kod)    -> ürün
let priceListByCode = new Map(); // normCode(kod)  -> price_list satırı
let imageUrlCache = new Map();   // resim_path      -> signed URL
let ctx = null;

// Para birimi: sabit fiyatlar müşteriye göre farklı para biriminde olabilir.
// Kart bazlı tutulur (bir müşterinin kartındaki tüm satırlar aynı para birimi),
// ama veritabanında satır bazında saklanır ki diğer modüller güvenle gruplayabilsin.
const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
const DEFAULT_CURRENCY = 'EUR';

// Fiyat Robotu (price_list) tablosundaki aktif liste kolonları.
// İleride yeni fiyat listelerine geçilirse SADECE burayı güncellemek yeterli;
// geçmiş müşteri fiyat kartlarına dokunulmaz, yalnızca yeni kayıtlarda
// otomatik doldurma bu listelerden gelir.
const PRICE_LISTS = {
    TRY: { field: 'list_price_tl',  label: '2026 TL Liste' },
    EUR: { field: 'list_price_eur', label: '2022-3 EUR Liste' },
    USD: { field: 'list_price_usd', label: '2022-3 USD Liste' },
    GBP: null, // GBP için Fiyat Robotu'nda liste yok — manuel giriş
};

const BUCKET_URUN_RESIM = 'urun-resimleri';

// Ürün adı dili: TR = stok_adi_1, EN = stok_adi_2. İkisi aynı anda gösterilmez.
let nameLang = localStorage.getItem('ep-cp-name-lang') === 'en' ? 'en' : 'tr';

// Forma yüklenen ürünün orijinal değerleri — fiyat değişince tarihi
// bugüne çekmek için karşılaştırma referansı.
let formOriginal = null;

function normCode(v) {
    return (v || '').toString().trim().toUpperCase();
}

function currencySymbol(code) {
    return CURRENCY_SYMBOLS[code] || code || '';
}

function formatMoney(value, code) {
    const n = parseFloat(value) || 0;
    return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencySymbol(code)}`;
}

// İki net fiyat arasındaki yüzde fark. v.2 girilmemişse null.
function diffPercent(net1, net2) {
    const a = parseFloat(net1) || 0;
    const b = parseFloat(net2);
    if (!a || b === null || b === undefined || isNaN(b) || b === 0) return null;
    return ((b - a) / a) * 100;
}

function formatDiff(net1, net2) {
    const d = diffPercent(net1, net2);
    if (d === null) return '—';
    const sign = d > 0 ? '+' : '';
    return `${sign}${d.toFixed(2)}%`;
}

// Güncel fiyat: v.2 girilmişse o, yoksa v.1
function currentNet(row) {
    const n2 = parseFloat(row.net_price_2);
    return (!isNaN(n2) && n2 > 0) ? n2 : (parseFloat(row.net_price) || 0);
}

function hasNet2(row) {
    const n2 = parseFloat(row.net_price_2);
    return !isNaN(n2) && n2 > 0;
}

// Listede yalnızca GÜNCEL fiyatın tarihi gösterilir.
// v.2 varsa v.2'nin kendi tarihi gösterilir; o boşsa v.1'in tarihine DÜŞÜLMEZ —
// v.1'in tarihini güncel fiyatın tarihiymiş gibi göstermek yanlış bilgi olur.
// (012 öncesi girilmiş v.2 satırlarında bu alan boş; kullanıcı doldurmalı.)
function currentDate(row) {
    return hasNet2(row) ? row.net_price_2_date : row.price_date;
}

// İki fiyat arasındaki süreyi hücre ipucunda göster
function dateTooltip(row) {
    if (!hasNet2(row)) return row.price_date ? `Net v.1 tarihi: ${formatDate(row.price_date)}` : 'Tarih girilmemiş';
    const d1 = row.price_date, d2 = row.net_price_2_date;
    const base = `Net v.1: ${formatDate(d1)}  →  Net v.2: ${formatDate(d2)}`;
    if (!d2) return `${base}\nNet v.2 tarihi girilmemiş — Düzenle'den ekleyebilirsiniz.`;
    if (!d1) return base;
    const days = Math.round((new Date(d2) - new Date(d1)) / 86400000);
    if (isNaN(days)) return base;
    const months = Math.floor(Math.abs(days) / 30);
    const span = months >= 1 ? `${Math.abs(days)} gün (~${months} ay)` : `${Math.abs(days)} gün`;
    return `${base}\nArada: ${span}`;
}

// Excel / karşılaştırma için seçili müşteri kartları
let selectedCustomerIds = new Set();

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return (y && m && d) ? `${d}.${m}.${y}` : '—';
}

// Bir customer_prices satırı için canlı Ürün Kartları kaydını bulur.
// product_id varsa onu kullanır; yoksa saklanan ada göre kod eşleşmesi dener.
function productForRow(row) {
    if (row.product_id && productById.has(row.product_id)) return productById.get(row.product_id);
    return null;
}

// Ekranda gösterilecek ürün adı (seçili dile göre).
// EN adı boşsa TR'ye düşer — boş hücre göstermek yerine.
function displayName(row) {
    const p = productForRow(row);
    if (!p) return row.product_name || '—';
    if (nameLang === 'en') return p.stok_adi_2 || p.stok_adi_1 || row.product_name || '—';
    return p.stok_adi_1 || row.product_name || '—';
}

function displayCode(row) {
    const p = productForRow(row);
    return p ? (p.stok_kodu || '—') : '—';
}

// Seçili para birimi için aktif liste adı (etiketlerde kullanılır)
function listLabelFor(code) {
    const cfg = PRICE_LISTS[code];
    return cfg ? cfg.label : `Liste (${currencySymbol(code)})`;
}

// Modal içindeki para birimine bağlı tüm etiketleri günceller
function refreshCurrencySymbols() {
    const code = document.getElementById('cp-currency-select').value || DEFAULT_CURRENCY;
    document.querySelectorAll('.cp-cur-sym').forEach(el => { el.textContent = currencySymbol(code); });
    document.getElementById('cp-list-price-label').textContent = listLabelFor(code);
    renderTempProducts();
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'client-prices'))) return;
    await renderNavbar('client-prices', ctx);
    await Promise.all([fetchCustomers(), fetchProductOptions(), fetchPriceList()]);
    await fetchClientPrices();
    initEventListeners();
    applyEditLock(ctx, 'client-prices');
});

// ─── VERİ ÇEKME ───────────────────────────────────────────────
async function fetchCustomers() {
    try {
        const { data, error } = await supabase
            .from('customers')
            .select('id, company_name, country, currency')
            .order('company_name', { ascending: true });
        if (error) throw error;
        globalCustomers = data || [];

        // Yazılabilir/filtrelenebilir müşteri seçimi (native select'te yazı yazılamıyordu)
        const dl = document.getElementById('cp-customer-options');
        dl.innerHTML = '';
        globalCustomers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = customerLabel(c);
            dl.appendChild(opt);
        });
    } catch (err) {
        console.error("Müşteri listesi yüklenemedi:", err.message);
    }
}

function customerLabel(c) {
    return c.country ? `${c.company_name} (${c.country})` : c.company_name;
}

// Girilen metinden müşteriyi çözer (tam etiket veya sadece firma adı)
function resolveCustomer(text) {
    const v = (text || '').trim().toLowerCase();
    if (!v) return null;
    return globalCustomers.find(c => customerLabel(c).toLowerCase() === v)
        || globalCustomers.find(c => (c.company_name || '').toLowerCase() === v)
        || null;
}

// Ürün kataloğu — Ürün Kartları (urunler) tek doğruluk kaynağı.
async function fetchProductOptions() {
    try {
        const { data, error } = await supabase
            .from('urunler')
            .select('id, stok_kodu, stok_adi_1, stok_adi_2, resim_path')
            .eq('user_id', ctx.ownerId)
            .order('stok_kodu', { ascending: true });
        if (error) throw error;
        globalProductOptions = data || [];

        productById = new Map();
        productByCode = new Map();
        globalProductOptions.forEach(p => {
            productById.set(p.id, p);
            const key = normCode(p.stok_kodu);
            if (key && !productByCode.has(key)) productByCode.set(key, p);
        });

        // Datalist: değer "KOD — AD". Aynı ürün adı birden fazla stok kodunda
        // olabildiği için (1.Kalite / 2.Kalite) seçimin kod üzerinden yapılması şart.
        const dl = document.getElementById('cp-product-options');
        if (dl) {
            dl.innerHTML = '';
            globalProductOptions.forEach(p => {
                const opt = document.createElement('option');
                opt.value = productPickerLabel(p);
                dl.appendChild(opt);
            });
        }
    } catch (err) {
        console.error("Ürün listesi yüklenemedi:", err.message);
    }
}

function productPickerLabel(p) {
    const name = p.stok_adi_1 || p.stok_adi_2 || '';
    return p.stok_kodu ? `${p.stok_kodu} — ${name}` : name;
}

// Fiyat Robotu liste fiyatları — otomatik doldurma kaynağı
async function fetchPriceList() {
    try {
        const { data, error } = await supabase
            .from('price_list')
            .select('product_code, list_price_tl, list_price_eur, list_price_usd')
            .eq('user_id', ctx.ownerId);
        if (error) throw error;

        priceListByCode = new Map();
        (data || []).forEach(r => {
            const key = normCode(r.product_code);
            if (key && !priceListByCode.has(key)) priceListByCode.set(key, r);
        });
    } catch (err) {
        console.error("Fiyat Robotu listesi yüklenemedi:", err.message);
    }
}

// Girilen metinden ürünü çözer: "KOD — AD", sadece kod, ya da tam ad.
function resolveProduct(text) {
    const raw = (text || '').trim();
    if (!raw) return null;

    // "KOD — AD" biçimi
    const dashIdx = raw.indexOf('—');
    if (dashIdx > 0) {
        const byCode = productByCode.get(normCode(raw.slice(0, dashIdx)));
        if (byCode) return byCode;
    }
    // Sadece stok kodu
    const direct = productByCode.get(normCode(raw));
    if (direct) return direct;

    // Tam ad (TR veya EN) — birden fazla eşleşme olabilir, ilkini alır
    const v = raw.toLowerCase();
    return globalProductOptions.find(p =>
        (p.stok_adi_1 && p.stok_adi_1.toLowerCase() === v) ||
        (p.stok_adi_2 && p.stok_adi_2.toLowerCase() === v)
    ) || null;
}

async function fetchClientPrices() {
    try {
        const { data, error } = await supabase
            .from('customer_prices')
            .select(`*, customers!fk_customer_prices_customer ( company_name, country )`)
            .eq('user_id', ctx.ownerId)
            .order('product_name', { ascending: true });
        if (error) throw error;

        // Müşteri bazında grupla
        const grouped = {};
        (data || []).forEach(p => {
            const cid = p.customer_id;
            if (!grouped[cid]) {
                grouped[cid] = {
                    customer_id: cid,
                    company_name: p.customers ? p.customers.company_name : 'Bilinmeyen',
                    country: p.customers ? p.customers.country : '',
                    // Kart bazlı para birimi: aynı karttaki satırlar aynı kodu taşır,
                    // ilk satırdakini temsili alıyoruz (009 öncesi kayıtlarda EUR).
                    currency: p.currency || DEFAULT_CURRENCY,
                    products: []
                };
            }
            grouped[cid].products.push(p);
        });

        globalClientPrices = Object.values(grouped);
        renderClientPriceCards(globalClientPrices);
    } catch (err) {
        console.error("Müşteri fiyatları yüklenemedi:", err.message);
    }
}

// ─── ÜRÜN GÖRSELLERİ ─────────────────────────────────────────
// Ürün Kartları modülüyle aynı yaklaşım: storage'dan imzalı URL alınır.
async function resolveThumbnails(rows) {
    const paths = [...new Set(rows.map(r => {
        const p = productForRow(r);
        return p ? p.resim_path : null;
    }).filter(Boolean))].filter(p => !imageUrlCache.has(p));

    if (paths.length > 0) {
        try {
            const { data, error } = await supabase.storage
                .from(BUCKET_URUN_RESIM).createSignedUrls(paths, 3600);
            if (error) throw error;
            (data || []).forEach(item => {
                if (item.signedUrl) imageUrlCache.set(item.path, item.signedUrl);
            });
        } catch (err) {
            console.error('resolveThumbnails:', err);
        }
    }

    document.querySelectorAll('#cp-cards-container img.cp-thumb[data-path]').forEach(img => {
        const url = imageUrlCache.get(img.dataset.path);
        if (url) img.src = url;
    });
}

// ─── KART / AKORDEON ─────────────────────────────────────────
function renderClientPriceCards(groups) {
    const container = document.getElementById('cp-cards-container');
    const badge = document.getElementById('total-cp-records');
    container.innerHTML = '';
    badge.textContent = `${groups.length} Müşteri`;

    if (groups.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 bg-[#FBF8F1]/20 border border-[#EFEAE0] border-dashed rounded-xl">
                <i class="fa-solid fa-tags text-slate-600 text-3xl mb-3"></i>
                <p class="text-[#968B7A] text-sm">Henüz müşteri fiyat kartı tanımlanmamış.</p>
            </div>`;
        return;
    }

    groups.forEach(group => {
        const card = document.createElement('div');
        card.className = "bg-[#FBF8F1]/40 border border-[#EFEAE0] rounded-xl overflow-hidden shadow-md";
        const uid = `cp-acc-${group.customer_id}`;
        const sym = currencySymbol(group.currency);

        card.innerHTML = `
            <div class="px-6 py-4 flex items-center justify-between cursor-pointer border-b border-[#EFEAE0]/60 select-none toggle-cp-btn" data-uid="${uid}">
                <div class="flex items-center gap-3">
                    <input type="checkbox" class="cp-card-check" data-customerid="${group.customer_id}"
                           ${selectedCustomerIds.has(group.customer_id) ? 'checked' : ''}
                           title="Excel / karşılaştırma için seç" style="width:auto;height:auto;cursor:pointer;">
                    <i class="fa-solid fa-chevron-down text-xs text-[#968B7A] transition-transform duration-200 cp-chevron"></i>
                    <span class="font-bold text-[#1C1A17]">${escapeHtml(group.company_name)}</span>
                    ${group.country ? `<span class="text-xs text-[#968B7A] uppercase tracking-widest">${escapeHtml(group.country)}</span>` : ''}
                    <span class="px-2 py-0.5 bg-[#E8EEEA] text-[#2D4A3E] text-[11px] font-semibold border border-indigo-900/50 rounded-full">${group.products.length} Ürün</span>
                    <span class="px-2 py-0.5 bg-[#FBEEE6] text-[#B5651D] text-[11px] font-semibold border border-[#E4DDCE] rounded-full">${escapeHtml(group.currency)} ${sym}</span>
                </div>
                <button class="btn-edit-cp text-xs bg-[#FBF8F1] hover:bg-[#FBF8F1] border border-[#E4DDCE] px-3 py-1.5 rounded-lg text-[#2D4A3E] transition-colors cursor-pointer" data-customerid="${group.customer_id}">
                    <i class="fa-solid fa-pen"></i> Düzenle
                </button>
            </div>
            <div class="accordion-content" id="${uid}">
              <div style="overflow-x:auto;">
                <table class="w-full border-collapse text-xs" style="min-width:900px;">
                    <thead>
                        <tr class="bg-[#F6F3EC]/60">
                            <th class="px-4 py-2 text-left text-[#968B7A] font-bold uppercase tracking-wider text-[10px] w-[56px]">Görsel</th>
                            <th class="px-4 py-2 text-left text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Stok Kodu</th>
                            <th class="px-4 py-2 text-left text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Stok Adı (${nameLang === 'en' ? 'EN' : 'TR'})</th>
                            <th class="px-4 py-2 text-right text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">${escapeHtml(listLabelFor(group.currency))}</th>
                            <th class="px-4 py-2 text-center text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">İskonto %</th>
                            <th class="px-4 py-2 text-right text-[#2D4A3E] font-bold uppercase tracking-wider text-[10px]">Net v.1 (${sym})</th>
                            <th class="px-4 py-2 text-right text-[#B5651D] font-bold uppercase tracking-wider text-[10px]">Net v.2 (${sym})</th>
                            <th class="px-4 py-2 text-center text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Fark %</th>
                            <th class="px-4 py-2 text-center text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Fiyat Tarihi</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${group.products.map(p => {
                            const prod = productForRow(p);
                            const thumb = prod && prod.resim_path
                                ? `<img class="cp-thumb" data-path="${escapeHtml(prod.resim_path)}" alt="">`
                                : `<div class="cp-thumb-empty"><i class="fa-solid fa-image"></i></div>`;
                            const n2 = parseFloat(p.net_price_2);
                            const hasV2 = !isNaN(n2) && n2 > 0;
                            const d = diffPercent(p.net_price, p.net_price_2);
                            const diffCls = d === null ? 'text-[#968B7A]' : (d > 0 ? 'text-[#9F3D3D]' : 'text-[#2D4A3E]');
                            return `
                            <tr class="border-t border-[#EFEAE0]/40 hover:bg-[#FBF8F1]/20">
                                <td class="px-4 py-2">${thumb}</td>
                                <td class="px-4 py-2.5 text-[#6B655B] font-mono text-[11px] cp-nowrap">${escapeHtml(displayCode(p))}</td>
                                <td class="px-4 py-2.5 text-[#6B655B] font-medium">${escapeHtml(displayName(p))}</td>
                                <td class="px-4 py-2.5 text-right text-[#6B655B] font-mono cp-nowrap">${formatMoney(p.list_price, group.currency)}</td>
                                <td class="px-4 py-2.5 text-center text-[#B26B33] font-mono font-bold cp-nowrap">% ${parseFloat(p.discount_rate||0).toFixed(2)}</td>
                                <td class="px-4 py-2.5 text-right font-mono cp-nowrap ${hasV2 ? 'text-[#968B7A]' : 'text-[#2D4A3E] font-bold'}">${formatMoney(p.net_price, group.currency)}</td>
                                <td class="px-4 py-2.5 text-right font-mono cp-nowrap ${hasV2 ? 'text-[#2D4A3E] font-bold' : 'text-[#968B7A]'}">${hasV2 ? formatMoney(p.net_price_2, group.currency) : '—'}</td>
                                <td class="px-4 py-2.5 text-center font-mono text-[11px] font-bold cp-nowrap ${diffCls}">${formatDiff(p.net_price, p.net_price_2)}</td>
                                <td class="px-4 py-2.5 text-center text-[#968B7A] font-mono text-[11px] cp-nowrap" title="${escapeHtml(dateTooltip(p))}">${formatDate(currentDate(p))}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
              </div>
            </div>
        `;
        container.appendChild(card);
    });

    // Akordeon toggle
    container.querySelectorAll('.toggle-cp-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.closest('.btn-edit-cp')) return;
            const uid = btn.getAttribute('data-uid');
            const content = document.getElementById(uid);
            const icon = btn.querySelector('.cp-chevron');
            content.classList.toggle('open');
            icon.style.transform = content.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
        });
    });

    // Düzenle butonları
    container.querySelectorAll('.btn-edit-cp').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openModalForEdit(btn.getAttribute('data-customerid'));
        });
    });

    // Kart seçim kutuları (Excel / karşılaştırma)
    container.querySelectorAll('.cp-card-check').forEach(cb => {
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
            const id = cb.getAttribute('data-customerid');
            if (cb.checked) selectedCustomerIds.add(id); else selectedCustomerIds.delete(id);
            updateSelectionLabel();
        });
    });
    updateSelectionLabel();

    // Görselleri arka planda çöz
    resolveThumbnails(groups.flatMap(g => g.products));
}

// ─── ÜRÜN ADI DİLİ (TR / EN) ─────────────────────────────────
function setNameLang(lang) {
    nameLang = lang === 'en' ? 'en' : 'tr';
    localStorage.setItem('ep-cp-name-lang', nameLang);
    document.getElementById('btn-lang-tr').classList.toggle('active', nameLang === 'tr');
    document.getElementById('btn-lang-en').classList.toggle('active', nameLang === 'en');
    applySearch();          // mevcut filtreyi koruyarak yeniden çiz
    renderTempProducts();   // modal açıksa oradaki liste de güncellensin
}

// ─── MODAL ────────────────────────────────────────────────────
function openModalForCreate() {
    document.getElementById('cp-customer-id').value = '';
    document.getElementById('cp-customer-input').value = '';
    document.getElementById('cp-customer-hint').textContent = '';
    document.getElementById('cp-currency-select').value = DEFAULT_CURRENCY;
    document.getElementById('cp-currency-hint').textContent = '';
    document.getElementById('cp-modal-title').innerHTML = `<i class="fa-solid fa-tags text-[#2D4A3E]"></i> Yeni Müşteri Fiyat Kartı`;
    document.getElementById('btn-delete-cp').classList.add('hidden');
    tempProducts = [];
    resetProductForm();
    refreshCurrencySymbols();
    document.getElementById('cp-modal').classList.remove('hidden');
}

function openModalForEdit(customerId) {
    const group = globalClientPrices.find(g => g.customer_id === customerId);
    if (!group) return;

    const customer = globalCustomers.find(c => c.id === customerId);
    document.getElementById('cp-customer-id').value = customerId;
    document.getElementById('cp-customer-input').value = customer ? customerLabel(customer) : group.company_name;
    document.getElementById('cp-customer-hint').textContent = '';
    document.getElementById('cp-currency-select').value = group.currency || DEFAULT_CURRENCY;
    document.getElementById('cp-currency-hint').textContent = '';
    document.getElementById('cp-modal-title').innerHTML = `<i class="fa-solid fa-folder-open text-amber-500"></i> ${escapeHtml(group.company_name)} - Fiyat Kartı`;
    document.getElementById('btn-delete-cp').classList.remove('hidden');
    tempProducts = group.products.map(p => ({ ...p }));
    resetProductForm();
    refreshCurrencySymbols();
    document.getElementById('cp-modal').classList.remove('hidden');
}

// Müşteri yazıldığında/seçildiğinde id'yi çöz ve para birimini öner.
function onCustomerChanged() {
    const input = document.getElementById('cp-customer-input');
    const hint = document.getElementById('cp-customer-hint');
    const customer = resolveCustomer(input.value);

    if (!customer) {
        document.getElementById('cp-customer-id').value = '';
        hint.textContent = input.value.trim() ? 'Müşteri bulunamadı — listeden seçin' : '';
        hint.style.color = input.value.trim() ? 'var(--danger, #9F3D3D)' : '';
        return;
    }

    document.getElementById('cp-customer-id').value = customer.id;
    hint.style.color = '';
    input.value = customerLabel(customer);

    // Para birimi: varsa mevcut fiyat kartından, yoksa müşteri kartından
    const existing = globalClientPrices.find(g => g.customer_id === customer.id);
    const curHint = document.getElementById('cp-currency-hint');
    if (existing) {
        document.getElementById('cp-currency-select').value = existing.currency || DEFAULT_CURRENCY;
        curHint.textContent = 'Mevcut fiyat kartından alındı';
    } else {
        const fromCard = CURRENCY_SYMBOLS[customer.currency] ? customer.currency : null;
        document.getElementById('cp-currency-select').value = fromCard || DEFAULT_CURRENCY;
        curHint.textContent = fromCard ? 'Müşteri kartından alındı' : 'Müşteri kartında tanımsız — varsayılan';
    }
    hint.textContent = '';
    refreshCurrencySymbols();
}

function closeModal() {
    document.getElementById('cp-modal').classList.add('hidden');
}

// ─── TEMP ÜRÜN LİSTESİ ───────────────────────────────────────
function renderTempProducts() {
    const tbody = document.getElementById('cp-temp-product-list');
    if (!tbody) return;
    if (tempProducts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-slate-600 py-4 text-xs">Henüz ürün eklenmedi.</td></tr>`;
        return;
    }
    const sym = currencySymbol(document.getElementById('cp-currency-select').value || DEFAULT_CURRENCY);
    tbody.innerHTML = '';
    tempProducts.forEach((p, i) => {
        const n2 = parseFloat(p.net_price_2);
        const hasV2 = !isNaN(n2) && n2 > 0;
        const d = diffPercent(p.net_price, p.net_price_2);
        const diffCls = d === null ? 'text-[#968B7A]' : (d > 0 ? 'text-[#9F3D3D]' : 'text-[#2D4A3E]');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-4 py-2 text-[#6B655B] font-mono text-[11px] cp-nowrap">${escapeHtml(displayCode(p))}</td>
            <td class="px-4 py-2 text-[#6B655B] font-medium text-xs wrap-ok">${escapeHtml(displayName(p))}</td>
            <td class="px-4 py-2 text-right text-[#6B655B] font-mono text-xs cp-nowrap">${parseFloat(p.list_price||0).toFixed(2)} ${sym}</td>
            <td class="px-4 py-2 text-center text-[#B26B33] font-mono text-xs font-bold cp-nowrap">% ${parseFloat(p.discount_rate||0).toFixed(2)}</td>
            <td class="px-4 py-2 text-right font-mono text-xs cp-nowrap ${hasV2 ? 'text-[#968B7A]' : 'text-[#2D4A3E] font-bold'}">${parseFloat(p.net_price||0).toFixed(2)} ${sym}</td>
            <td class="px-4 py-2 text-right font-mono text-xs cp-nowrap ${hasV2 ? 'text-[#2D4A3E] font-bold' : 'text-[#968B7A]'}">${hasV2 ? n2.toFixed(2) + ' ' + sym : '—'}</td>
            <td class="px-4 py-2 text-center font-mono text-[11px] font-bold cp-nowrap ${diffCls}">${formatDiff(p.net_price, p.net_price_2)}</td>
            <td class="px-4 py-2 text-center text-[#968B7A] font-mono text-[11px] cp-nowrap" title="${escapeHtml(dateTooltip(p))}">${formatDate(currentDate(p))}</td>
            <td class="px-4 py-2 text-center whitespace-nowrap">
                <button type="button" data-idx="${i}" class="btn-edit-temp-product text-[#2D4A3E] hover:text-[#2D4A3E] mr-2 cursor-pointer"><i class="fa-solid fa-pen text-xs"></i></button>
                <button type="button" data-idx="${i}" class="btn-remove-temp-product text-[#968B7A] hover:text-[#9F3D3D] cursor-pointer"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit-temp-product').forEach(btn => {
        btn.addEventListener('click', () => loadProductToForm(parseInt(btn.getAttribute('data-idx'))));
    });
    tbody.querySelectorAll('.btn-remove-temp-product').forEach(btn => {
        btn.addEventListener('click', () => {
            tempProducts.splice(parseInt(btn.getAttribute('data-idx')), 1);
            renderTempProducts();
        });
    });
}

async function addOrUpdateProduct() {
    const rawInput = document.getElementById('cp-temp-product').value.trim();
    const listPrice = parseFloat(document.getElementById('cp-temp-list').value) || 0;
    const netPrice = parseFloat(document.getElementById('cp-temp-net').value) || 0;
    const net2Raw = parseFloat(document.getElementById('cp-temp-net2').value);
    const netPrice2 = (!isNaN(net2Raw) && net2Raw > 0) ? net2Raw : null;
    const discountRate = parseFloat(document.getElementById('cp-temp-discount').value) || (listPrice > 0 ? ((listPrice - netPrice) / listPrice * 100) : 0);
    const priceDate = document.getElementById('cp-temp-date').value || null;
    // v.2 tarihi yalnızca v.2 fiyatı varsa anlamlı
    const priceDate2 = netPrice2 !== null ? (document.getElementById('cp-temp-date2').value || null) : null;

    if (!rawInput) { await showAlertDialog("Lütfen ürün adını veya stok kodunu giriniz.", { variant: 'warn' }); return; }

    const editIdx = document.getElementById('cp-edit-product-idx').value;
    const matched = resolveProduct(rawInput);

    // product_name olarak DAİMA Türkçe adı sakla: Karlılık Analizi bu alanı
    // order_items.product_name ile metin bazlı eşleştiriyor.
    const product = {
        product_id: matched ? matched.id : null,
        product_name: matched ? (matched.stok_adi_1 || matched.stok_adi_2 || rawInput) : rawInput,
        list_price: listPrice,
        net_price: netPrice,
        net_price_2: netPrice2,
        discount_rate: discountRate,
        price_date: priceDate,
        net_price_2_date: priceDate2,
    };

    if (editIdx !== '') {
        tempProducts[parseInt(editIdx)] = { ...tempProducts[parseInt(editIdx)], ...product };
    } else {
        tempProducts.push(product);
    }

    resetProductForm();
    renderTempProducts();
}

function loadProductToForm(idx) {
    const p = tempProducts[idx];
    const prod = productForRow(p);
    document.getElementById('cp-temp-product').value = prod ? productPickerLabel(prod) : (p.product_name || '');
    document.getElementById('cp-temp-list').value = p.list_price || '';
    document.getElementById('cp-temp-net').value = p.net_price || '';
    document.getElementById('cp-temp-net2').value = (p.net_price_2 !== null && p.net_price_2 !== undefined && p.net_price_2 !== '') ? p.net_price_2 : '';
    document.getElementById('cp-temp-discount').value = parseFloat(p.discount_rate||0).toFixed(2);
    refreshDiffDisplay();
    document.getElementById('cp-temp-date').value = p.price_date ? String(p.price_date).slice(0, 10) : '';
    document.getElementById('cp-temp-date2').value = p.net_price_2_date ? String(p.net_price_2_date).slice(0, 10) : '';
    document.getElementById('cp-edit-product-idx').value = idx;
    document.getElementById('cp-product-form-title').textContent = 'Ürünü Güncelle';
    document.getElementById('btn-cancel-product-edit').classList.remove('hidden');
    document.getElementById('cp-btn-icon').className = 'fa-solid fa-check text-sm';
    document.getElementById('cp-autofill-hint').textContent = '';

    // Fiyat değişirse tarihi bugüne çekebilmek için referansı sakla
    formOriginal = {
        list: parseFloat(p.list_price) || 0,
        net: parseFloat(p.net_price) || 0,
        net2: parseFloat(p.net_price_2) || 0,
        discount: parseFloat(p.discount_rate) || 0,
        date: p.price_date ? String(p.price_date).slice(0, 10) : '',
        date2: p.net_price_2_date ? String(p.net_price_2_date).slice(0, 10) : '',
    };
}

// Net v.1 → v.2 arasındaki % farkı salt okunur alanda gösterir
function refreshDiffDisplay() {
    const n1 = document.getElementById('cp-temp-net').value;
    const n2 = document.getElementById('cp-temp-net2').value;
    const el = document.getElementById('cp-temp-diff');
    const d = diffPercent(n1, n2);
    el.value = d === null ? '' : `${d > 0 ? '+' : ''}${d.toFixed(2)} %`;
    el.style.color = d === null ? '' : (d > 0 ? '#9F3D3D' : '#2D4A3E');
}

function resetProductForm() {
    ['cp-temp-product','cp-temp-list','cp-temp-net','cp-temp-net2','cp-temp-discount','cp-temp-diff'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cp-temp-date').value = todayISO();
    document.getElementById('cp-temp-date2').value = '';
    document.getElementById('cp-edit-product-idx').value = '';
    document.getElementById('cp-product-form-title').textContent = '2. Ürün / Fiyat Ekle';
    document.getElementById('btn-cancel-product-edit').classList.add('hidden');
    document.getElementById('cp-btn-icon').className = 'fa-solid fa-plus text-sm';
    document.getElementById('cp-autofill-hint').textContent = '';
    formOriginal = null;
}

// ─── FİYAT ROBOTU'NDAN OTOMATİK LİSTE FİYATI ─────────────────
// Girilen ürün Fiyat Robotu'nda varsa seçili para biriminin liste fiyatını
// doldurur. Yoksa (Mat ürünler, rezervuar vb.) alan manuel kalır.
function autofillListPrice({ silent = false } = {}) {
    const hint = document.getElementById('cp-autofill-hint');
    const currency = document.getElementById('cp-currency-select').value || DEFAULT_CURRENCY;
    const cfg = PRICE_LISTS[currency];
    const matched = resolveProduct(document.getElementById('cp-temp-product').value);

    if (!matched) { if (!silent) hint.textContent = ''; return; }

    if (!cfg) {
        hint.textContent = `${currency} için Fiyat Robotu'nda liste yok — liste fiyatını elle girin.`;
        return;
    }

    const row = priceListByCode.get(normCode(matched.stok_kodu));
    const value = row ? row[cfg.field] : null;

    if (value === null || value === undefined || value === '') {
        hint.textContent = `${matched.stok_kodu} için ${cfg.label} bulunamadı — elle girin.`;
        return;
    }

    const listInput = document.getElementById('cp-temp-list');
    listInput.value = parseFloat(value).toFixed(2);
    hint.textContent = `${cfg.label} otomatik dolduruldu (${matched.stok_kodu}). Gerekirse değiştirebilirsiniz.`;

    // Liste değişti — iskonto girilmişse net'i, net girilmişse iskontoyu yenile
    recalcFromList();
}

function recalcFromList() {
    const list = parseFloat(document.getElementById('cp-temp-list').value) || 0;
    const disc = parseFloat(document.getElementById('cp-temp-discount').value) || 0;
    const net  = parseFloat(document.getElementById('cp-temp-net').value) || 0;
    if (list <= 0) return;
    if (disc > 0) {
        document.getElementById('cp-temp-net').value = (list * (1 - disc / 100)).toFixed(2);
    } else if (net > 0) {
        document.getElementById('cp-temp-discount').value = ((list - net) / list * 100).toFixed(2);
    }
}

// ─── CANLI HESAPLAMA (Liste → İskonto → Net) ─────────────────
function wireCalculator() {
    const listInput = document.getElementById('cp-temp-list');
    const netInput = document.getElementById('cp-temp-net');
    const discInput = document.getElementById('cp-temp-discount');

    listInput.addEventListener('input', () => {
        const list = parseFloat(listInput.value) || 0;
        const disc = parseFloat(discInput.value) || 0;
        if (list > 0 && disc > 0) netInput.value = (list * (1 - disc / 100)).toFixed(2);
        bumpDateIfPriceChanged();
    });
    discInput.addEventListener('input', () => {
        const list = parseFloat(listInput.value) || 0;
        const disc = parseFloat(discInput.value) || 0;
        if (list > 0) netInput.value = (list * (1 - disc / 100)).toFixed(2);
        bumpDateIfPriceChanged();
    });
    netInput.addEventListener('input', () => {
        const list = parseFloat(listInput.value) || 0;
        const net = parseFloat(netInput.value) || 0;
        if (list > 0 && net > 0) discInput.value = ((list - net) / list * 100).toFixed(2);
        refreshDiffDisplay();
        bumpDateIfPriceChanged();
    });

    // Net v.2 iskonto hesabına karışmaz — yalnızca fark yüzdesini etkiler.
    // İskonto (discount_rate) bilerek v.1'e bağlı kalıyor; Karlılık Analizi
    // ve Müşteri Skoru bu alanı o anlamda okuyor.
    document.getElementById('cp-temp-net2').addEventListener('input', () => {
        refreshDiffDisplay();
        bumpDateIfPriceChanged();
    });
}

// Mevcut bir ürünün fiyatı değiştirildiyse fiyat tarihini bugüne çeker.
// Kullanıcı tarih alanını sonradan elle düzeltebilir.
function bumpDateIfPriceChanged() {
    const net2Input  = document.getElementById('cp-temp-net2');
    const date2Input = document.getElementById('cp-temp-date2');
    const hint = document.getElementById('cp-autofill-hint');
    const net2 = parseFloat(net2Input.value) || 0;

    // v.2 fiyatı varsa tarihi zorunlu gibi davran: boşsa bugünü koy.
    // v.2 silinirse tarihi de temizle — sahipsiz tarih kalmasın.
    if (net2 > 0 && !date2Input.value) date2Input.value = todayISO();
    if (net2 <= 0 && date2Input.value) date2Input.value = '';

    if (!formOriginal) return; // yeni ürün — v.1 tarihi zaten bugün

    const list = parseFloat(document.getElementById('cp-temp-list').value) || 0;
    const net  = parseFloat(document.getElementById('cp-temp-net').value) || 0;
    const disc = parseFloat(document.getElementById('cp-temp-discount').value) || 0;
    const dateInput = document.getElementById('cp-temp-date');

    // v.1 tarafı (liste / iskonto / net v.1) değiştiyse v.1 tarihini bugüne çek
    const v1Changed = list !== formOriginal.list || net !== formOriginal.net
        || Math.abs(disc - formOriginal.discount) > 0.005;
    if (v1Changed) {
        if (dateInput.value === formOriginal.date) {
            dateInput.value = todayISO();
            hint.textContent = 'Net v.1 değişti — v.1 tarihi bugüne güncellendi.';
        }
    } else if (dateInput.value === todayISO() && formOriginal.date) {
        dateInput.value = formOriginal.date;
        hint.textContent = '';
    }

    // v.2 değiştiyse v.2 tarihini bugüne çek
    if (net2 > 0 && net2 !== (formOriginal.net2 || 0)
        && (!date2Input.value || date2Input.value === formOriginal.date2)) {
        date2Input.value = todayISO();
        hint.textContent = 'Net v.2 değişti — v.2 tarihi bugüne güncellendi.';
    }
}

// ─── KAYDETME ─────────────────────────────────────────────────
async function saveClientPrices() {
    if (!canEdit(ctx, 'client-prices')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    // Gizli id normalde blur/change ile dolar; kullanıcı yazıp doğrudan
    // Kaydet'e basarsa diye burada da metinden çözmeyi dene.
    let customerId = document.getElementById('cp-customer-id').value;
    if (!customerId) {
        const fallback = resolveCustomer(document.getElementById('cp-customer-input').value);
        if (fallback) customerId = fallback.id;
    }
    const currency = document.getElementById('cp-currency-select').value || DEFAULT_CURRENCY;
    if (!customerId) { await showAlertDialog("Lütfen listeden bir müşteri seçiniz.", { variant: 'warn' }); return; }
    if (tempProducts.length === 0) { await showAlertDialog("Lütfen en az bir ürün fiyatı ekleyiniz.", { variant: 'warn' }); return; }

    try {
        const userId = ctx.ownerId;

        // Önce bu müşteriye ait mevcut fiyatları sil
        await supabase.from('customer_prices').delete().eq('customer_id', customerId).eq('user_id', userId);

        // Yeni fiyatları toplu ekle
        const inserts = tempProducts.map(p => ({
            user_id: userId,
            customer_id: customerId,
            product_id: p.product_id || null,
            product_name: p.product_name,
            currency,                            // kart bazlı, tüm satırlara yazılır
            list_price: parseFloat(p.list_price) || 0,
            net_price: parseFloat(p.net_price) || 0,
            net_price_2: (p.net_price_2 === null || p.net_price_2 === undefined || p.net_price_2 === '')
                ? null : (parseFloat(p.net_price_2) || null),
            discount_rate: parseFloat(p.discount_rate) || 0,
            price_date: p.price_date || null,    // ürün bazlı; boşsa NULL
            net_price_2_date: p.net_price_2_date || null,
        }));

        const { error } = await supabase.from('customer_prices').insert(inserts);
        if (error) throw error;

        const customerName = globalCustomers.find(c => c.id === customerId)?.company_name || customerId;
        logChange({ ctx, moduleId: 'client-prices', action: 'update', summary: `Müşteri fiyat kartı kaydedildi: ${customerName} (${inserts.length} ürün, ${currency})` });

        closeModal();
        await fetchClientPrices();
    } catch (err) {
        console.error("Fiyat kartı kaydedilemedi:", err.message);
        await showAlertDialog("Hata: " + err.message, { variant: 'danger' });
    }
}

// ─── SİLME ───────────────────────────────────────────────────
async function deleteClientPrices() {
    if (!canEdit(ctx, 'client-prices')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const customerId = document.getElementById('cp-customer-id').value;
    if (!customerId) return;
    const ok = await showConfirmDialog("Bu müşteriye ait tüm fiyat kayıtları silinecektir. Emin misiniz?", { title: 'Fiyat Kartını Sil', variant: 'danger', confirmText: 'Sil' });
    if (!ok) return;
    try {
        const { error } = await supabase.from('customer_prices').delete().eq('customer_id', customerId).eq('user_id', ctx.ownerId);
        if (error) throw error;
        const customerName = globalCustomers.find(c => c.id === customerId)?.company_name || customerId;
        logChange({ ctx, moduleId: 'client-prices', action: 'delete', summary: `Müşteri fiyat kartı silindi: ${customerName}` });
        closeModal();
        await fetchClientPrices();
    } catch (err) {
        console.error("Silme işlemi başarısız:", err.message);
        await showAlertDialog("Silme işlemi başarısız oldu: " + err.message, { variant: 'danger' });
    }
}

// ─── FİLTRELEME ──────────────────────────────────────────────
// Firma adı, stok kodu veya ürün adı (TR/EN) üzerinden arar.
function applySearch() {
    const searchVal = document.getElementById('cp-search-input').value.toLowerCase();
    if (!searchVal) { renderClientPriceCards(globalClientPrices); return; }

    const filtered = globalClientPrices.filter(g =>
        g.company_name.toLowerCase().includes(searchVal) ||
        g.products.some(p => {
            const prod = productForRow(p);
            return (p.product_name || '').toLowerCase().includes(searchVal)
                || (prod && (prod.stok_kodu || '').toLowerCase().includes(searchVal))
                || (prod && (prod.stok_adi_1 || '').toLowerCase().includes(searchVal))
                || (prod && (prod.stok_adi_2 || '').toLowerCase().includes(searchVal));
        })
    );
    renderClientPriceCards(filtered);
}

// ─── EXCEL DIŞA AKTARMA ───────────────────────────────────────
// Renk paleti ve stil kalıbı Fiyat Robotu (prices.js) ile birebir aynı.
const XL_HEADER_BG   = 'FF2D4A3E';
const XL_HEADER_BG_2 = 'FF4A6741';
const XL_HEADER_FG   = 'FFFFFFFF';
const XL_BORDER      = 'FFD6D2C9';
const XL_ROW_BG      = 'FFF6F3EC';
const XL_TEXT        = 'FF1C1A17';
const XL_ACCENT_FG   = 'FFB5651D';

function xlBorder() {
    const side = { style: 'thin', color: { argb: XL_BORDER } };
    return { top: side, bottom: side, left: side, right: side };
}

// Excel sayfa adı kısıtları: 31 karakter, : \ / ? * [ ] yasak
function safeSheetName(name, used) {
    let base = (name || 'Musteri').replace(/[:\\\/\?\*\[\]]/g, '-').slice(0, 28).trim() || 'Musteri';
    let candidate = base, i = 2;
    while (used.has(candidate)) { candidate = `${base.slice(0, 26)}_${i++}`; }
    used.add(candidate);
    return candidate;
}

function styleHeaderRow(row, primaryCols) {
    row.height = 34;
    row.eachCell((cell, col) => {
        cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: XL_HEADER_FG } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col <= primaryCols ? XL_HEADER_BG : XL_HEADER_BG_2 } };
        cell.border = xlBorder();
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
}

function downloadWorkbook(wb, filename) {
    return wb.xlsx.writeBuffer().then(buffer => {
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });
}

// Seçili müşteriler varsa yalnızca onlar, yoksa tümü.
// Her müşteri ayrı sayfa — birden fazla müşteri seçilse de tek dosya.
async function exportToExcel() {
    const groups = selectedCustomerIds.size > 0
        ? globalClientPrices.filter(g => selectedCustomerIds.has(g.customer_id))
        : globalClientPrices;

    if (groups.length === 0) {
        await showAlertDialog("Aktarılacak fiyat verisi yok.", { variant: 'warn' });
        return;
    }

    const headers = [
        'Stok Kodu', 'Ürün Adı (TR)', 'Ürün Adı (EN)',
        'Liste', 'İskonto %', 'Net v.1', 'v.1 Tarihi', 'Net v.2', 'v.2 Tarihi',
        'Fark %', 'Güncel Fiyat',
    ];
    const PRIMARY_COLS = 3;

    const wb = new ExcelJS.Workbook();
    const used = new Set();

    groups.forEach(group => {
        const ws = wb.addWorksheet(safeSheetName(group.company_name, used));
        ws.columns = [
            { width: 24 }, { width: 38 }, { width: 38 }, { width: 12 }, { width: 11 },
            { width: 12 }, { width: 13 }, { width: 12 }, { width: 13 }, { width: 10 }, { width: 14 },
        ];

        // Başlık bloğu
        const title = ws.addRow([`${group.company_name}${group.country ? ' — ' + group.country : ''}`]);
        ws.mergeCells(title.number, 1, title.number, headers.length);
        title.height = 26;
        title.getCell(1).font = { name: 'Arial', bold: true, size: 13, color: { argb: XL_HEADER_BG } };
        title.getCell(1).alignment = { vertical: 'middle' };

        const sub = ws.addRow([`Para birimi: ${group.currency} · ${group.products.length} ürün · Aktarım: ${new Date().toLocaleDateString('tr-TR')}`]);
        ws.mergeCells(sub.number, 1, sub.number, headers.length);
        sub.getCell(1).font = { name: 'Arial', size: 9, color: { argb: XL_ACCENT_FG } };
        ws.addRow([]);

        styleHeaderRow(ws.addRow(headers), PRIMARY_COLS);

        group.products.forEach(p => {
            const prod = productForRow(p);
            const d = diffPercent(p.net_price, p.net_price_2);
            const row = ws.addRow([
                prod ? (prod.stok_kodu || '') : '',
                prod ? (prod.stok_adi_1 || p.product_name || '') : (p.product_name || ''),
                prod ? (prod.stok_adi_2 || '') : '',
                parseFloat(p.list_price) || null,
                parseFloat(p.discount_rate) || null,
                parseFloat(p.net_price) || null,
                p.price_date ? new Date(p.price_date) : null,
                hasNet2(p) ? parseFloat(p.net_price_2) : null,
                (hasNet2(p) && p.net_price_2_date) ? new Date(p.net_price_2_date) : null,
                d === null ? null : Number(d.toFixed(2)),
                currentNet(p) || null,
            ]);
            row.height = 22;
            row.eachCell((cell, col) => {
                cell.font = { name: 'Arial', size: 10, color: { argb: XL_TEXT } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_ROW_BG } };
                cell.border = xlBorder();
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
                if ([4, 6, 8, 11].includes(col)) { cell.numFmt = '#,##0.00'; cell.alignment.horizontal = 'right'; }
                if (col === 5) { cell.numFmt = '0.00"%"'; cell.alignment.horizontal = 'right'; }
                if (col === 10) { cell.numFmt = '+0.00"%";-0.00"%"'; cell.alignment.horizontal = 'right'; }
                if ([7, 9].includes(col)) { cell.numFmt = 'dd.mm.yyyy'; cell.alignment.horizontal = 'center'; }
                if (col === 11) { cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: XL_HEADER_BG } }; }
            });
        });

        ws.views = [{ state: 'frozen', ySplit: 4 }];
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const name = groups.length === 1
        ? `Fiyat_${groups[0].company_name.replace(/[^\wÇĞİÖŞÜçğıöşü -]/g, '')}_${stamp}.xlsx`
        : `Musteri_Sabit_Fiyatlar_${groups.length}_Musteri_${stamp}.xlsx`;
    await downloadWorkbook(wb, name);
}

// ─── MÜŞTERİ KARŞILAŞTIRMA ────────────────────────────────────
// Seçili müşterilerin GÜNCEL net fiyatlarını ürün × müşteri matrisinde
// yan yana gösterir. Para birimleri farklıysa Min/Maks/Fark hesaplanmaz —
// farklı para birimlerini tek sayıda harmanlamak anlamsız olurdu.
let compareState = null;

function compareProductKey(row) {
    if (row.product_id) return `id:${row.product_id}`;
    return `name:${(row.product_name || '').trim().toLowerCase()}`;
}

async function openCompareModal() {
    const groups = globalClientPrices.filter(g => selectedCustomerIds.has(g.customer_id));
    if (groups.length < 2) {
        await showAlertDialog(
            'Karşılaştırma için en az 2 müşteri seçin. Müşteri kartlarının solundaki kutucukları işaretleyebilirsiniz.',
            { variant: 'warn', title: 'Yetersiz Seçim' }
        );
        return;
    }

    const currencies = [...new Set(groups.map(g => g.currency))];
    const mixed = currencies.length > 1;

    const rowMap = new Map();
    groups.forEach(g => {
        g.products.forEach(p => {
            const key = compareProductKey(p);
            if (!rowMap.has(key)) {
                const prod = productForRow(p);
                rowMap.set(key, {
                    code: prod ? (prod.stok_kodu || '') : '',
                    nameTr: prod ? (prod.stok_adi_1 || p.product_name || '') : (p.product_name || ''),
                    nameEn: prod ? (prod.stok_adi_2 || '') : '',
                    byCustomer: new Map(),
                });
            }
            rowMap.get(key).byCustomer.set(g.customer_id, currentNet(p));
        });
    });

    const rows = [...rowMap.values()].sort((a, b) =>
        String(a.code).localeCompare(String(b.code), 'tr') || a.nameTr.localeCompare(b.nameTr, 'tr'));

    compareState = { groups, rows, mixed, currency: mixed ? null : currencies[0] };

    const warn = document.getElementById('cp-compare-warning');
    if (mixed) {
        warn.classList.remove('hidden');
        warn.style.color = 'var(--accent, #B5651D)';
        warn.textContent = `Seçili müşteriler farklı para birimlerinde (${currencies.join(', ')}). `
            + 'Fiyatlar kendi para birimleriyle gösteriliyor; Min / Maks / Fark hesaplanmadı.';
    } else {
        warn.classList.add('hidden');
    }

    document.getElementById('cp-compare-search').value = '';
    document.getElementById('cp-compare-only-shared').checked = false;
    document.getElementById('cp-compare-modal').classList.remove('hidden');
    renderCompare();
}

function visibleCompareRows() {
    if (!compareState) return [];
    const q = document.getElementById('cp-compare-search').value.toLowerCase();
    const onlyShared = document.getElementById('cp-compare-only-shared').checked;
    const n = compareState.groups.length;
    return compareState.rows.filter(r => {
        if (onlyShared && r.byCustomer.size < n) return false;
        if (!q) return true;
        return (r.code || '').toLowerCase().includes(q)
            || (r.nameTr || '').toLowerCase().includes(q)
            || (r.nameEn || '').toLowerCase().includes(q);
    });
}

function compareStats(row) {
    if (!compareState || compareState.mixed) return null;
    const vals = [...row.byCustomer.values()].filter(v => v > 0);
    if (vals.length < 2) return null;
    const min = Math.min(...vals), max = Math.max(...vals);
    return { min, max, spread: max - min, spreadPct: min > 0 ? ((max - min) / min * 100) : 0 };
}

function renderCompare() {
    if (!compareState) return;
    const { groups, mixed } = compareState;
    const rows = visibleCompareRows();

    const head = document.getElementById('cp-compare-head');
    head.innerHTML = `
        <tr>
            <th>Stok Kodu</th>
            <th class="wrap-ok">Ürün Adı</th>
            ${groups.map(g => `<th class="text-right">${escapeHtml(g.company_name)}<br><span style="font-weight:400;opacity:.7;">${escapeHtml(g.currency)}</span></th>`).join('')}
            ${mixed ? '' : `
                <th class="text-right">Min</th>
                <th class="text-right">Maks</th>
                <th class="text-right">Fark</th>
                <th class="text-right">Fark %</th>`}
        </tr>`;

    document.getElementById('cp-compare-count').textContent =
        `${rows.length} ürün · ${groups.length} müşteri`;

    const body = document.getElementById('cp-compare-body');
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="${groups.length + (mixed ? 2 : 6)}" class="text-center text-slate-600 py-6 text-xs">Gösterilecek ürün yok.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map(r => {
        const st = compareStats(r);
        const cells = groups.map(g => {
            const v = r.byCustomer.get(g.customer_id);
            if (v === undefined) return `<td class="text-right text-[#968B7A]">—</td>`;
            let cls = '';
            if (st && st.spread > 0) {
                if (Math.abs(v - st.min) < 0.005) cls = 'color:#2D4A3E;font-weight:700;';
                else if (Math.abs(v - st.max) < 0.005) cls = 'color:#9F3D3D;font-weight:700;';
            }
            return `<td class="text-right font-mono cp-nowrap" style="${cls}">${v.toFixed(2)} ${currencySymbol(g.currency)}</td>`;
        }).join('');

        const statCells = mixed ? '' : (st
            ? `<td class="text-right font-mono cp-nowrap">${st.min.toFixed(2)}</td>
               <td class="text-right font-mono cp-nowrap">${st.max.toFixed(2)}</td>
               <td class="text-right font-mono cp-nowrap">${st.spread.toFixed(2)}</td>
               <td class="text-right font-mono cp-nowrap font-bold" style="color:${st.spreadPct > 0 ? '#B5651D' : '#968B7A'};">${st.spreadPct.toFixed(2)}%</td>`
            : `<td class="text-right text-[#968B7A]">—</td><td class="text-right text-[#968B7A]">—</td>
               <td class="text-right text-[#968B7A]">—</td><td class="text-right text-[#968B7A]">—</td>`);

        return `<tr>
            <td class="font-mono text-[11px] cp-nowrap">${escapeHtml(r.code || '—')}</td>
            <td class="text-xs wrap-ok">${escapeHtml(nameLang === 'en' ? (r.nameEn || r.nameTr) : r.nameTr)}</td>
            ${cells}${statCells}
        </tr>`;
    }).join('');
}

async function exportCompareToExcel() {
    if (!compareState) return;
    const { groups, mixed } = compareState;
    const rows = visibleCompareRows();
    if (rows.length === 0) {
        await showAlertDialog('Aktarılacak satır yok.', { variant: 'warn' });
        return;
    }

    const headers = ['Stok Kodu', 'Ürün Adı (TR)', 'Ürün Adı (EN)',
        ...groups.map(g => `${g.company_name} (${g.currency})`),
        ...(mixed ? [] : ['Min', 'Maks', 'Fark', 'Fark %'])];
    const PRIMARY_COLS = 3;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Karşılaştırma');
    ws.columns = [{ width: 24 }, { width: 36 }, { width: 36 },
        ...groups.map(() => ({ width: 16 })),
        ...(mixed ? [] : [{ width: 12 }, { width: 12 }, { width: 12 }, { width: 11 }])];

    const title = ws.addRow([`Müşteri Fiyat Karşılaştırma — ${groups.length} müşteri`]);
    ws.mergeCells(title.number, 1, title.number, headers.length);
    title.height = 26;
    title.getCell(1).font = { name: 'Arial', bold: true, size: 13, color: { argb: XL_HEADER_BG } };

    const sub = ws.addRow([mixed
        ? `Farklı para birimleri (${[...new Set(groups.map(g => g.currency))].join(', ')}) — Min/Maks/Fark hesaplanmadı.`
        : `Para birimi: ${compareState.currency} · Gösterilen fiyat her müşterinin güncel net fiyatıdır.`]);
    ws.mergeCells(sub.number, 1, sub.number, headers.length);
    sub.getCell(1).font = { name: 'Arial', size: 9, color: { argb: XL_ACCENT_FG } };
    ws.addRow([]);

    styleHeaderRow(ws.addRow(headers), PRIMARY_COLS);

    rows.forEach(r => {
        const st = compareStats(r);
        const values = [
            r.code || '', r.nameTr || '', r.nameEn || '',
            ...groups.map(g => r.byCustomer.get(g.customer_id) ?? null),
            ...(mixed ? [] : st
                ? [Number(st.min.toFixed(2)), Number(st.max.toFixed(2)), Number(st.spread.toFixed(2)), Number(st.spreadPct.toFixed(2))]
                : [null, null, null, null]),
        ];
        const row = ws.addRow(values);
        row.height = 22;
        row.eachCell((cell, col) => {
            cell.font = { name: 'Arial', size: 10, color: { argb: XL_TEXT } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_ROW_BG } };
            cell.border = xlBorder();
            cell.alignment = { horizontal: col <= PRIMARY_COLS ? 'left' : 'right', vertical: 'middle' };
            if (col > PRIMARY_COLS) cell.numFmt = '#,##0.00';
            if (!mixed && col === headers.length) cell.numFmt = '0.00"%"';
        });
    });

    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 4 }];
    await downloadWorkbook(wb, `Fiyat_Karsilastirma_${groups.length}_Musteri_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── KART SEÇİMİ ─────────────────────────────────────────────
function updateSelectionLabel() {
    const el = document.getElementById('cp-selected-count');
    if (!el) return;
    el.textContent = selectedCustomerIds.size > 0 ? `· ${selectedCustomerIds.size} seçili` : '';
}

function toggleAllCards() {
    const boxes = [...document.querySelectorAll('.cp-card-check')];
    const allSelected = boxes.length > 0 && boxes.every(b => b.checked);
    boxes.forEach(b => {
        b.checked = !allSelected;
        const id = b.getAttribute('data-customerid');
        if (b.checked) selectedCustomerIds.add(id); else selectedCustomerIds.delete(id);
    });
    updateSelectionLabel();
}

// ─── SİPARİŞLERDEN FİYAT TÜRETME ─────────────────────────────
// Amaç: order_items'ta girilmiş gerçek satış fiyatlarından müşteri bazlı
// sabit fiyat listesi önermek — tek tek manuel giriş yapmayı önlemek.
//
// Hariç tutulanlar:
//   • payment_method = 'Bedelsiz'  → bedelsiz gönderim, fiyat temsili değil
//   • status_tags içinde 'İptal'   → iptal sipariş
//   • unit_price boş veya <= 0     → fiyatsız kalem
//
// Credit Note kaynaklı sapmalar otomatik ayıklanamıyor (credit_note_items
// içindeki hedef sipariş serbest metin, gerçek FK değil). Bunun yerine aynı
// üründe birden fazla farklı fiyat varsa satır "çoklu fiyat" olarak
// işaretlenir ve doğru fiyatı kullanıcı seçer.

let importRows = [];

const EXCLUDED_PAYMENT = 'Bedelsiz';
const EXCLUDED_STATUS = 'İptal';

async function fetchOrdersAndItems() {
    const [ordersRes, itemsRes] = await Promise.all([
        supabase.from('orders')
            .select('id, customer_id, order_date, currency, payment_method, status_tags')
            .eq('user_id', ctx.ownerId),
        supabase.from('order_items')
            .select('order_id, product_id, product_name, product_code, quantity, unit_price, currency')
            .eq('user_id', ctx.ownerId),
    ]);
    if (ordersRes.error) throw ordersRes.error;
    if (itemsRes.error) throw itemsRes.error;
    return { orders: ordersRes.data || [], items: itemsRes.data || [] };
}

// Bir kalem için ürün kimliği: product_id > stok kodu > normalize ad
function itemProductKey(it) {
    if (it.product_id && productById.has(it.product_id)) return `id:${it.product_id}`;
    const byCode = productByCode.get(normCode(it.product_code));
    if (byCode) return `id:${byCode.id}`;
    if (it.product_code) return `code:${normCode(it.product_code)}`;
    return `name:${(it.product_name || '').trim().toLowerCase()}`;
}

function itemProduct(it) {
    if (it.product_id && productById.has(it.product_id)) return productById.get(it.product_id);
    return productByCode.get(normCode(it.product_code)) || null;
}

function deriveFromOrders(orders, items) {
    const orderMap = new Map(orders.map(o => [o.id, o]));
    const groups = new Map();

    items.forEach(it => {
        const o = orderMap.get(it.order_id);
        if (!o) return;
        if ((o.payment_method || '') === EXCLUDED_PAYMENT) return;
        if (Array.isArray(o.status_tags) && o.status_tags.includes(EXCLUDED_STATUS)) return;

        const price = parseFloat(it.unit_price);
        if (!price || price <= 0) return;

        const currency = it.currency || o.currency || DEFAULT_CURRENCY;
        const pKey = itemProductKey(it);
        const key = `${o.customer_id}|${pKey}|${currency}`;

        if (!groups.has(key)) {
            const prod = itemProduct(it);
            groups.set(key, {
                customerId: o.customer_id,
                productKey: pKey,
                productId: prod ? prod.id : null,
                productCode: prod ? prod.stok_kodu : (it.product_code || ''),
                productName: prod ? (prod.stok_adi_1 || it.product_name) : it.product_name,
                currency,
                orderIds: new Set(),
                byPrice: new Map(), // fiyat -> { count, lastDate }
            });
        }
        const g = groups.get(key);
        g.orderIds.add(o.id);

        const rounded = Math.round(price * 100) / 100;
        if (!g.byPrice.has(rounded)) g.byPrice.set(rounded, { count: 0, lastDate: null });
        const slot = g.byPrice.get(rounded);
        slot.count += 1;
        if (!slot.lastDate || (o.order_date && o.order_date > slot.lastDate)) slot.lastDate = o.order_date;
    });

    // Müşteri bazlı kart para birimi: mevcut kart varsa onunki,
    // yoksa o müşteride en çok satır üreten para birimi.
    const currencyVotes = new Map();
    groups.forEach(g => {
        if (!currencyVotes.has(g.customerId)) currencyVotes.set(g.customerId, new Map());
        const m = currencyVotes.get(g.customerId);
        m.set(g.currency, (m.get(g.currency) || 0) + 1);
    });
    const cardCurrency = new Map();
    currencyVotes.forEach((m, cid) => {
        const existing = globalClientPrices.find(c => c.customer_id === cid);
        if (existing) { cardCurrency.set(cid, existing.currency || DEFAULT_CURRENCY); return; }
        let best = DEFAULT_CURRENCY, bestN = -1;
        m.forEach((n, cur) => { if (n > bestN) { best = cur; bestN = n; } });
        cardCurrency.set(cid, best);
    });

    const rows = [];
    groups.forEach(g => {
        // Fiyat adayları: en sık kullanılan önce, eşitlikte en güncel
        const prices = [...g.byPrice.entries()]
            .map(([price, s]) => ({ price, count: s.count, lastDate: s.lastDate }))
            .sort((a, b) => (b.count - a.count) || String(b.lastDate || '').localeCompare(String(a.lastDate || '')));

        const customer = globalCustomers.find(c => c.id === g.customerId);
        const card = globalClientPrices.find(c => c.customer_id === g.customerId);
        const existingRow = card ? card.products.find(p => {
            if (g.productId && p.product_id === g.productId) return true;
            return !g.productId && (p.product_name || '').trim().toLowerCase() === (g.productName || '').trim().toLowerCase();
        }) : null;

        const suggested = prices[0].price;
        const expectedCur = cardCurrency.get(g.customerId);
        const currencyMismatch = g.currency !== expectedCur;

        let status;
        if (currencyMismatch)      status = 'currency';
        else if (!existingRow)     status = 'new';
        else if (Math.abs(currentNet(existingRow) - suggested) < 0.005) status = 'same';
        else                       status = 'diff';

        rows.push({
            customerId: g.customerId,
            customerName: customer ? customer.company_name : 'Bilinmeyen',
            country: customer ? (customer.country || '') : '',
            productId: g.productId,
            productCode: g.productCode || '',
            productName: g.productName || '',
            currency: g.currency,
            cardCurrency: expectedCur,
            orderCount: g.orderIds.size,
            prices,
            chosen: suggested,
            existingRow,
            existingNet: existingRow ? currentNet(existingRow) : null,
            hasVariance: prices.length > 1,
            status,
            // Aynı fiyat zaten karttaysa veya para birimi uyuşmuyorsa varsayılan kapalı
            selected: status === 'new' || status === 'diff',
        });
    });

    rows.sort((a, b) =>
        a.customerName.localeCompare(b.customerName, 'tr') ||
        String(a.productCode).localeCompare(String(b.productCode), 'tr'));
    return rows;
}

async function openImportModal() {
    if (!canEdit(ctx, 'client-prices')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    document.getElementById('cp-import-modal').classList.remove('hidden');
    document.getElementById('cp-import-body').innerHTML =
        `<tr><td colspan="9" class="text-center text-slate-600 py-6 text-xs">Sipariş kalemleri okunuyor...</td></tr>`;

    try {
        const { orders, items } = await fetchOrdersAndItems();
        importRows = deriveFromOrders(orders, items);
        renderImportRows();
    } catch (err) {
        console.error('Siparişlerden türetme başarısız:', err.message);
        document.getElementById('cp-import-body').innerHTML =
            `<tr><td colspan="9" class="text-center text-[#9F3D3D] py-6 text-xs">Hata: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function visibleImportRows() {
    const q = document.getElementById('cp-import-search').value.toLowerCase();
    const filter = document.getElementById('cp-import-filter').value;
    return importRows.filter(r => {
        if (filter === 'new' && r.status !== 'new') return false;
        if (filter === 'conflict' && r.status !== 'diff') return false;
        if (filter === 'variance' && !r.hasVariance) return false;
        if (!q) return true;
        return r.customerName.toLowerCase().includes(q)
            || (r.productCode || '').toLowerCase().includes(q)
            || (r.productName || '').toLowerCase().includes(q);
    });
}

const IMPORT_STATUS = {
    new:      { label: 'Yeni',            cls: 'text-[#2D4A3E]' },
    same:     { label: 'Kartla aynı',     cls: 'text-[#968B7A]' },
    diff:     { label: 'Karttan farklı',  cls: 'text-[#9F3D3D]' },
    currency: { label: 'Para birimi uyuşmuyor', cls: 'text-[#B5651D]' },
};

function renderImportRows() {
    const tbody = document.getElementById('cp-import-body');
    const rows = visibleImportRows();

    document.getElementById('cp-import-count').textContent =
        `${rows.length} satır görünüyor · ${importRows.filter(r => r.selected).length} seçili`;

    const counts = importRows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    document.getElementById('cp-import-summary').textContent =
        `Toplam ${importRows.length} satır — ${counts.new || 0} yeni, ${counts.diff || 0} farklı, ${counts.same || 0} aynı, ${counts.currency || 0} para birimi uyuşmayan.`;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-slate-600 py-6 text-xs">Bu filtreye uyan satır yok.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    rows.forEach(r => {
        const idx = importRows.indexOf(r);
        const st = IMPORT_STATUS[r.status];
        const sym = currencySymbol(r.currency);
        const disabled = r.status === 'currency';

        // Çoklu fiyat varsa kullanıcı seçsin
        const priceCell = r.hasVariance
            ? `<select data-idx="${idx}" class="imp-price" style="height:30px;font-size:11px;width:auto;min-width:150px;">
                   ${r.prices.map(p => `<option value="${p.price}" ${p.price === r.chosen ? 'selected' : ''}>${p.price.toFixed(2)} ${sym} · ${p.count} kalem</option>`).join('')}
               </select>`
            : `<span class="font-mono">${r.chosen.toFixed(2)} ${sym}</span>`;

        const tr = document.createElement('tr');
        if (r.hasVariance) tr.style.background = 'rgba(181,101,29,0.07)';
        tr.innerHTML = `
            <td><input type="checkbox" class="imp-check" data-idx="${idx}" ${r.selected ? 'checked' : ''} ${disabled ? 'disabled' : ''} style="width:auto;height:auto;"></td>
            <td class="text-xs">${escapeHtml(r.customerName)}${r.country ? ` <span class="text-[#968B7A]">(${escapeHtml(r.country)})</span>` : ''}</td>
            <td class="font-mono text-[11px]">${escapeHtml(r.productCode || '—')}</td>
            <td class="text-xs">${escapeHtml(r.productName)}</td>
            <td class="text-center text-[11px] font-mono">${escapeHtml(r.currency)}</td>
            <td class="text-center text-[11px]">${r.orderCount}</td>
            <td class="text-right">${priceCell}</td>
            <td class="text-right font-mono text-[11px]">${r.existingNet !== null ? r.existingNet.toFixed(2) + ' ' + currencySymbol(r.cardCurrency) : '—'}</td>
            <td class="text-[11px] ${st.cls}">${st.label}${r.hasVariance ? ` · <span class="text-[#B5651D]">${r.prices.length} farklı fiyat</span>` : ''}${r.status === 'currency' ? ` (kart ${escapeHtml(r.cardCurrency)})` : ''}</td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.imp-check').forEach(cb => {
        cb.addEventListener('change', () => {
            importRows[parseInt(cb.dataset.idx)].selected = cb.checked;
            document.getElementById('cp-import-count').textContent =
                `${rows.length} satır görünüyor · ${importRows.filter(x => x.selected).length} seçili`;
        });
    });
    tbody.querySelectorAll('.imp-price').forEach(sel => {
        sel.addEventListener('change', () => {
            const r = importRows[parseInt(sel.dataset.idx)];
            r.chosen = parseFloat(sel.value);
            // Seçim değişince kartla karşılaştırma durumu da değişebilir
            if (r.status !== 'currency') {
                if (!r.existingRow) r.status = 'new';
                else r.status = Math.abs(r.existingNet - r.chosen) < 0.005 ? 'same' : 'diff';
            }
            renderImportRows();
        });
    });
}

function closeCompareModal() {
    document.getElementById('cp-compare-modal').classList.add('hidden');
}

function closeImportModal() {
    document.getElementById('cp-import-modal').classList.add('hidden');
}

// Görünen (filtrelenmiş) satırların seçimini topluca açar/kapatır
function toggleVisibleSelection() {
    const rows = visibleImportRows().filter(r => r.status !== 'currency');
    const allSelected = rows.length > 0 && rows.every(r => r.selected);
    rows.forEach(r => { r.selected = !allSelected; });
    renderImportRows();
}

async function saveImportSelection() {
    if (!canEdit(ctx, 'client-prices')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const selected = importRows.filter(r => r.selected && r.status !== 'currency');
    if (selected.length === 0) {
        await showAlertDialog('Kaydedilecek satır seçilmedi.', { variant: 'warn' });
        return;
    }

    const customerIds = [...new Set(selected.map(r => r.customerId))];
    const ok = await showConfirmDialog(
        `${selected.length} ürün fiyatı, ${customerIds.length} müşterinin fiyat kartına yazılacak. ` +
        `Karttaki mevcut diğer ürünler korunur. Devam edilsin mi?`,
        { title: 'Siparişlerden İçe Aktar', confirmText: 'Kaydet' }
    );
    if (!ok) return;

    try {
        const userId = ctx.ownerId;

        for (const cid of customerIds) {
            const card = globalClientPrices.find(c => c.customer_id === cid);
            const currency = card ? (card.currency || DEFAULT_CURRENCY)
                                  : selected.find(r => r.customerId === cid).currency;

            // Mevcut satırlardan başla, seçilenleri üzerine uygula
            const merged = card ? card.products.map(p => ({ ...p })) : [];

            selected.filter(r => r.customerId === cid).forEach(r => {
                const lastDate = r.prices.find(p => p.price === r.chosen)?.lastDate || null;
                const listRow = priceListByCode.get(normCode(r.productCode));
                const cfg = PRICE_LISTS[currency];
                const listPrice = (listRow && cfg && listRow[cfg.field] != null)
                    ? parseFloat(listRow[cfg.field]) : 0;
                const discount = listPrice > 0 ? ((listPrice - r.chosen) / listPrice * 100) : 0;

                const existing = merged.find(p => {
                    if (r.productId && p.product_id === r.productId) return true;
                    return !r.productId && (p.product_name || '').trim().toLowerCase() === (r.productName || '').trim().toLowerCase();
                });

                if (existing) {
                    // Mevcut satırın net fiyatını siparişten gelenle güncelle.
                    // Elle girilmiş liste fiyatının ÜZERİNE YAZMA — yalnızca boşsa
                    // Fiyat Robotu'ndan doldur. net_price_2 de bilerek ellenmez:
                    // o alan kullanıcının kendi fiyat güncellemesi için.
                    const curList = parseFloat(existing.list_price) || 0;
                    const effectiveList = curList > 0 ? curList : listPrice;
                    existing.list_price = effectiveList;
                    existing.net_price = r.chosen;
                    existing.discount_rate = effectiveList > 0
                        ? ((effectiveList - r.chosen) / effectiveList * 100)
                        : (parseFloat(existing.discount_rate) || 0);
                    existing.price_date = lastDate || existing.price_date;
                } else {
                    merged.push({
                        product_id: r.productId || null,
                        product_name: r.productName,
                        list_price: listPrice,
                        net_price: r.chosen,
                        net_price_2: null,
                        discount_rate: discount,
                        price_date: lastDate,
                    });
                }
            });

            await supabase.from('customer_prices').delete().eq('customer_id', cid).eq('user_id', userId);
            const inserts = merged.map(p => ({
                user_id: userId,
                customer_id: cid,
                product_id: p.product_id || null,
                product_name: p.product_name,
                currency,
                list_price: parseFloat(p.list_price) || 0,
                net_price: parseFloat(p.net_price) || 0,
                net_price_2: (p.net_price_2 === null || p.net_price_2 === undefined || p.net_price_2 === '')
                    ? null : (parseFloat(p.net_price_2) || null),
                discount_rate: parseFloat(p.discount_rate) || 0,
                price_date: p.price_date || null,
                net_price_2_date: p.net_price_2_date || null,
            }));
            const { error } = await supabase.from('customer_prices').insert(inserts);
            if (error) throw error;
        }

        logChange({
            ctx, moduleId: 'client-prices', action: 'update',
            summary: `Siparişlerden fiyat aktarıldı: ${customerIds.length} müşteri, ${selected.length} ürün`
        });

        document.getElementById('cp-import-modal').classList.add('hidden');
        await fetchClientPrices();
        await showAlertDialog(`${selected.length} ürün fiyatı ${customerIds.length} müşteri kartına aktarıldı.`, { variant: 'success' });
    } catch (err) {
        console.error('İçe aktarma başarısız:', err.message);
        await showAlertDialog('İçe aktarma başarısız: ' + err.message, { variant: 'danger' });
    }
}

// ─── OLAY DİNLEYİCİLERİ ─────────────────────────────────────
function initEventListeners() {
    document.getElementById('btn-open-cp-modal').addEventListener('click', openModalForCreate);
    document.getElementById('btn-close-cp-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-cp').addEventListener('click', closeModal);
    document.getElementById('btn-save-cp').addEventListener('click', saveClientPrices);
    document.getElementById('btn-delete-cp').addEventListener('click', deleteClientPrices);
    document.getElementById('btn-add-cp-product').addEventListener('click', addOrUpdateProduct);
    document.getElementById('btn-cancel-product-edit').addEventListener('click', resetProductForm);
    document.getElementById('cp-search-input').addEventListener('input', applySearch);
    document.getElementById('btn-export-client-prices').addEventListener('click', exportToExcel);
    document.getElementById('btn-select-all-cards').addEventListener('click', toggleAllCards);

    // Karşılaştırma
    document.getElementById('btn-compare-customers').addEventListener('click', openCompareModal);
    document.getElementById('btn-close-compare-modal').addEventListener('click', closeCompareModal);
    document.getElementById('btn-close-compare').addEventListener('click', closeCompareModal);
    document.getElementById('btn-export-compare').addEventListener('click', exportCompareToExcel);
    document.getElementById('cp-compare-search').addEventListener('input', renderCompare);
    document.getElementById('cp-compare-only-shared').addEventListener('change', renderCompare);
    document.getElementById('cp-customer-input').addEventListener('change', onCustomerChanged);
    document.getElementById('cp-customer-input').addEventListener('blur', onCustomerChanged);
    document.getElementById('cp-currency-select').addEventListener('change', () => {
        refreshCurrencySymbols();
        autofillListPrice({ silent: true });
    });

    // Ürün seçilince liste fiyatını Fiyat Robotu'ndan doldur
    document.getElementById('cp-temp-product').addEventListener('change', () => autofillListPrice());
    document.getElementById('cp-temp-product').addEventListener('blur', () => autofillListPrice());

    // Siparişlerden getir
    document.getElementById('btn-import-from-orders').addEventListener('click', openImportModal);
    document.getElementById('btn-close-import-modal').addEventListener('click', closeImportModal);
    document.getElementById('btn-cancel-import').addEventListener('click', closeImportModal);
    document.getElementById('btn-save-import').addEventListener('click', saveImportSelection);
    document.getElementById('cp-import-search').addEventListener('input', renderImportRows);
    document.getElementById('cp-import-filter').addEventListener('change', renderImportRows);
    document.getElementById('btn-import-select-all').addEventListener('click', toggleVisibleSelection);
    document.getElementById('cp-import-check-all').addEventListener('change', toggleVisibleSelection);

    // Ürün adı dili
    document.getElementById('btn-lang-tr').addEventListener('click', () => setNameLang('tr'));
    document.getElementById('btn-lang-en').addEventListener('click', () => setNameLang('en'));
    document.getElementById('btn-lang-tr').classList.toggle('active', nameLang === 'tr');
    document.getElementById('btn-lang-en').classList.toggle('active', nameLang === 'en');

    wireCalculator();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
