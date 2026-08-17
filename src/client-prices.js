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
                <table class="w-full border-collapse text-xs">
                    <thead>
                        <tr class="bg-[#F6F3EC]/60">
                            <th class="px-4 py-2 text-left text-[#968B7A] font-bold uppercase tracking-wider text-[10px] w-[56px]">Görsel</th>
                            <th class="px-4 py-2 text-left text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Stok Kodu</th>
                            <th class="px-4 py-2 text-left text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Stok Adı (${nameLang === 'en' ? 'EN' : 'TR'})</th>
                            <th class="px-4 py-2 text-right text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">${escapeHtml(listLabelFor(group.currency))}</th>
                            <th class="px-4 py-2 text-center text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">İskonto %</th>
                            <th class="px-4 py-2 text-right text-[#2D4A3E] font-bold uppercase tracking-wider text-[10px]">Net (${sym})</th>
                            <th class="px-4 py-2 text-center text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Fiyat Tarihi</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${group.products.map(p => {
                            const prod = productForRow(p);
                            const thumb = prod && prod.resim_path
                                ? `<img class="cp-thumb" data-path="${escapeHtml(prod.resim_path)}" alt="">`
                                : `<div class="cp-thumb-empty"><i class="fa-solid fa-image"></i></div>`;
                            return `
                            <tr class="border-t border-[#EFEAE0]/40 hover:bg-[#FBF8F1]/20">
                                <td class="px-4 py-2">${thumb}</td>
                                <td class="px-4 py-2.5 text-[#6B655B] font-mono text-[11px]">${escapeHtml(displayCode(p))}</td>
                                <td class="px-4 py-2.5 text-[#6B655B] font-medium">${escapeHtml(displayName(p))}</td>
                                <td class="px-4 py-2.5 text-right text-[#6B655B] font-mono">${formatMoney(p.list_price, group.currency)}</td>
                                <td class="px-4 py-2.5 text-center text-[#B26B33] font-mono font-bold">% ${parseFloat(p.discount_rate||0).toFixed(2)}</td>
                                <td class="px-4 py-2.5 text-right text-[#2D4A3E] font-mono font-bold">${formatMoney(p.net_price, group.currency)}</td>
                                <td class="px-4 py-2.5 text-center text-[#968B7A] font-mono text-[11px]">${formatDate(p.price_date)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
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
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-slate-600 py-4 text-xs">Henüz ürün eklenmedi.</td></tr>`;
        return;
    }
    const sym = currencySymbol(document.getElementById('cp-currency-select').value || DEFAULT_CURRENCY);
    tbody.innerHTML = '';
    tempProducts.forEach((p, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-4 py-2 text-[#6B655B] font-mono text-[11px]">${escapeHtml(displayCode(p))}</td>
            <td class="px-4 py-2 text-[#6B655B] font-medium text-xs">${escapeHtml(displayName(p))}</td>
            <td class="px-4 py-2 text-right text-[#6B655B] font-mono text-xs">${parseFloat(p.list_price||0).toFixed(2)} ${sym}</td>
            <td class="px-4 py-2 text-center text-[#B26B33] font-mono text-xs font-bold">% ${parseFloat(p.discount_rate||0).toFixed(2)}</td>
            <td class="px-4 py-2 text-right text-[#2D4A3E] font-mono text-xs font-bold">${parseFloat(p.net_price||0).toFixed(2)} ${sym}</td>
            <td class="px-4 py-2 text-center text-[#968B7A] font-mono text-[11px]">${formatDate(p.price_date)}</td>
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
    const discountRate = parseFloat(document.getElementById('cp-temp-discount').value) || (listPrice > 0 ? ((listPrice - netPrice) / listPrice * 100) : 0);
    const priceDate = document.getElementById('cp-temp-date').value || null;

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
        discount_rate: discountRate,
        price_date: priceDate,
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
    document.getElementById('cp-temp-discount').value = parseFloat(p.discount_rate||0).toFixed(2);
    document.getElementById('cp-temp-date').value = p.price_date ? String(p.price_date).slice(0, 10) : '';
    document.getElementById('cp-edit-product-idx').value = idx;
    document.getElementById('cp-product-form-title').textContent = 'Ürünü Güncelle';
    document.getElementById('btn-cancel-product-edit').classList.remove('hidden');
    document.getElementById('cp-btn-icon').className = 'fa-solid fa-check text-sm';
    document.getElementById('cp-autofill-hint').textContent = '';

    // Fiyat değişirse tarihi bugüne çekebilmek için referansı sakla
    formOriginal = {
        list: parseFloat(p.list_price) || 0,
        net: parseFloat(p.net_price) || 0,
        discount: parseFloat(p.discount_rate) || 0,
        date: p.price_date ? String(p.price_date).slice(0, 10) : '',
    };
}

function resetProductForm() {
    ['cp-temp-product','cp-temp-list','cp-temp-net','cp-temp-discount'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cp-temp-date').value = todayISO();
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
        bumpDateIfPriceChanged();
    });
}

// Mevcut bir ürünün fiyatı değiştirildiyse fiyat tarihini bugüne çeker.
// Kullanıcı tarih alanını sonradan elle düzeltebilir.
function bumpDateIfPriceChanged() {
    if (!formOriginal) return; // yeni ürün — tarih zaten bugün
    const list = parseFloat(document.getElementById('cp-temp-list').value) || 0;
    const net  = parseFloat(document.getElementById('cp-temp-net').value) || 0;
    const disc = parseFloat(document.getElementById('cp-temp-discount').value) || 0;

    const changed = list !== formOriginal.list || net !== formOriginal.net
        || Math.abs(disc - formOriginal.discount) > 0.005;

    const dateInput = document.getElementById('cp-temp-date');
    const hint = document.getElementById('cp-autofill-hint');
    if (changed) {
        if (dateInput.value === formOriginal.date) {
            dateInput.value = todayISO();
            hint.textContent = 'Fiyat değişti — fiyat tarihi bugüne güncellendi.';
        }
    } else if (dateInput.value === todayISO() && formOriginal.date) {
        dateInput.value = formOriginal.date;
        hint.textContent = '';
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
            discount_rate: parseFloat(p.discount_rate) || 0,
            price_date: p.price_date || null,    // ürün bazlı; boşsa NULL
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

// ─── CSV EXPORT ───────────────────────────────────────────────
async function exportToCSV() {
    if (globalClientPrices.length === 0) {
        await showAlertDialog("Aktarılacak fiyat verisi yok.", { variant: 'warn' });
        return;
    }
    let csv = "data:text/csv;charset=utf-8,﻿";
    csv += "Musteri;Ulke;Para Birimi;Stok Kodu;Urun Adi (TR);Urun Adi (EN);Liste Fiyati;Iskonto %;Net Fiyat;Fiyat Tarihi\n";
    globalClientPrices.forEach(g => {
        g.products.forEach(p => {
            const prod = productForRow(p);
            const code = prod ? (prod.stok_kodu || '') : '';
            const nameTr = prod ? (prod.stok_adi_1 || p.product_name || '') : (p.product_name || '');
            const nameEn = prod ? (prod.stok_adi_2 || '') : '';
            const dateStr = p.price_date ? String(p.price_date).slice(0, 10) : '';
            csv += `"${g.company_name}";"${g.country}";"${g.currency}";"${code}";"${nameTr}";"${nameEn}";"${parseFloat(p.list_price).toFixed(2)}";"${parseFloat(p.discount_rate||0).toFixed(2)}";"${parseFloat(p.net_price).toFixed(2)}";"${dateStr}"\n`;
        });
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `Musteri_Sabit_Fiyatlar_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    document.getElementById('btn-export-client-prices').addEventListener('click', exportToCSV);
    document.getElementById('cp-customer-input').addEventListener('change', onCustomerChanged);
    document.getElementById('cp-customer-input').addEventListener('blur', onCustomerChanged);
    document.getElementById('cp-currency-select').addEventListener('change', () => {
        refreshCurrencySymbols();
        autofillListPrice({ silent: true });
    });

    // Ürün seçilince liste fiyatını Fiyat Robotu'ndan doldur
    document.getElementById('cp-temp-product').addEventListener('change', () => autofillListPrice());
    document.getElementById('cp-temp-product').addEventListener('blur', () => autofillListPrice());

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
