import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';
import { getAccessContext, guardModuleAccess, applyEditLock, canEdit } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';

// Global veriler
let globalCustomers = [];
let globalClientPrices = []; // { customer_id, company_name, currency, products: [{product_name, list_price, discount_rate, net_price, id?}] }
let tempProducts = []; // Modal içi geçici ürün listesi
let globalProductOptions = []; // urunler'den: { id, stok_kodu, stok_adi_1 } - ürün seçimi için
let ctx = null;

// Para birimi: sabit fiyatlar müşteriye göre farklı para biriminde olabilir.
// Kart bazlı tutulur (bir müşterinin kartındaki tüm satırlar aynı para birimi),
// ama veritabanında satır bazında saklanır ki diğer modüller güvenle gruplayabilsin.
const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
const DEFAULT_CURRENCY = 'EUR';

function currencySymbol(code) {
    return CURRENCY_SYMBOLS[code] || code || '';
}

function formatMoney(value, code) {
    const n = parseFloat(value) || 0;
    return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencySymbol(code)}`;
}

// Modal içindeki tüm para birimi sembollerini seçili para birimine göre günceller
function refreshCurrencySymbols() {
    const code = document.getElementById('cp-currency-select').value || DEFAULT_CURRENCY;
    document.querySelectorAll('.cp-cur-sym').forEach(el => { el.textContent = currencySymbol(code); });
    renderTempProducts();
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'client-prices'))) return;
    await renderNavbar('client-prices', ctx);
    await Promise.all([fetchCustomers(), fetchClientPrices(), fetchProductOptions()]);
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
        globalCustomers = data;

        const select = document.getElementById('cp-customer-select');
        select.innerHTML = '<option value="">-- Müşteri Seçiniz --</option>';
        data.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.company_name} (${c.country})`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Müşteri listesi yüklenemedi:", err.message);
    }
}

// Ürün seçimi için ürün listesini çek (datalist autocomplete)
// Not: önceden var olmayan bir 'products' tablosunu sorguluyordu (her zaman boş
// dönüyordu, autocomplete hiç çalışmıyordu) — gerçek ürün kataloğu 'urunler'.
async function fetchProductOptions() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data, error } = await supabase
            .from('urunler')
            .select('id, stok_kodu, stok_adi_1')
            .order('stok_adi_1', { ascending: true });
        if (error) throw error;
        globalProductOptions = data || [];

        const dl = document.getElementById('cp-product-options');
        if (dl) {
            dl.innerHTML = '';
            globalProductOptions.forEach(p => {
                const opt = document.createElement('option');
                // Görünür değer: ürün adı; kod varsa parantez içinde ipucu
                opt.value = p.stok_adi_1;
                opt.label = p.stok_kodu ? `${p.stok_kodu} — ${p.stok_adi_1}` : p.stok_adi_1;
                dl.appendChild(opt);
            });
        }
    } catch (err) {
        console.error("Ürün listesi yüklenemedi:", err.message);
    }
}

// Girilen ürün adı/koduna karşılık gelen product_id'yi bul (eşleşme yoksa null)
function resolveProductId(nameOrCode) {
    if (!nameOrCode) return null;
    const v = nameOrCode.trim().toLowerCase();
    const match = globalProductOptions.find(p =>
        (p.stok_adi_1 && p.stok_adi_1.toLowerCase() === v) ||
        (p.stok_kodu && p.stok_kodu.toLowerCase() === v)
    );
    return match ? match.id : null;
}

async function fetchClientPrices() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase
            .from('customer_prices')
            .select(`*, customers!fk_customer_prices_customer ( company_name, country )`)
            .eq('user_id', ctx.ownerId)
            .order('product_name', { ascending: true });
        if (error) throw error;

        // Müşteri bazında grupla
        const grouped = {};
        data.forEach(p => {
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

// ─── KART / AKORDEONرنگ ──────────────────────────────────────
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

        card.innerHTML = `
            <div class="px-6 py-4 flex items-center justify-between cursor-pointer border-b border-[#EFEAE0]/60 select-none toggle-cp-btn" data-uid="${uid}">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-chevron-down text-xs text-[#968B7A] transition-transform duration-200 cp-chevron"></i>
                    <span class="font-bold text-[#1C1A17]">${escapeHtml(group.company_name)}</span>
                    ${group.country ? `<span class="text-xs text-[#968B7A] uppercase tracking-widest">${escapeHtml(group.country)}</span>` : ''}
                    <span class="px-2 py-0.5 bg-[#E8EEEA] text-[#2D4A3E] text-[11px] font-semibold border border-indigo-900/50 rounded-full">${group.products.length} Ürün</span>
                    <span class="px-2 py-0.5 bg-[#FBEEE6] text-[#B5651D] text-[11px] font-semibold border border-[#E4DDCE] rounded-full">${escapeHtml(group.currency)} ${currencySymbol(group.currency)}</span>
                </div>
                <button class="btn-edit-cp text-xs bg-[#FBF8F1] hover:bg-[#FBF8F1] border border-[#E4DDCE] px-3 py-1.5 rounded-lg text-[#2D4A3E] transition-colors cursor-pointer" data-customerid="${group.customer_id}">
                    <i class="fa-solid fa-pen"></i> Düzenle
                </button>
            </div>
            <div class="accordion-content" id="${uid}">
                <table class="w-full border-collapse text-xs">
                    <thead>
                        <tr class="bg-[#F6F3EC]/60">
                            <th class="px-6 py-2 text-left text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Ürün / Kod</th>
                            <th class="px-4 py-2 text-right text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">Liste (${currencySymbol(group.currency)})</th>
                            <th class="px-4 py-2 text-center text-[#968B7A] font-bold uppercase tracking-wider text-[10px]">İskonto %</th>
                            <th class="px-4 py-2 text-right text-[#2D4A3E] font-bold uppercase tracking-wider text-[10px]">Net (${currencySymbol(group.currency)})</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${group.products.map(p => `
                            <tr class="border-t border-[#EFEAE0]/40 hover:bg-[#FBF8F1]/20">
                                <td class="px-6 py-2.5 text-[#6B655B] font-medium">${escapeHtml(p.product_name)}</td>
                                <td class="px-4 py-2.5 text-right text-[#6B655B] font-mono">${formatMoney(p.list_price, group.currency)}</td>
                                <td class="px-4 py-2.5 text-center text-[#B26B33] font-mono font-bold">% ${parseFloat(p.discount_rate||0).toFixed(2)}</td>
                                <td class="px-4 py-2.5 text-right text-[#2D4A3E] font-mono font-bold">${formatMoney(p.net_price, group.currency)}</td>
                            </tr>`).join('')}
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
}

// ─── MODAL ────────────────────────────────────────────────────
function openModalForCreate() {
    document.getElementById('cp-customer-id').value = '';
    document.getElementById('cp-customer-select').value = '';
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

    document.getElementById('cp-customer-id').value = customerId;
    document.getElementById('cp-customer-select').value = customerId;
    document.getElementById('cp-currency-select').value = group.currency || DEFAULT_CURRENCY;
    document.getElementById('cp-currency-hint').textContent = '';
    document.getElementById('cp-modal-title').innerHTML = `<i class="fa-solid fa-folder-open text-amber-500"></i> ${escapeHtml(group.company_name)} - Fiyat Kartı`;
    document.getElementById('btn-delete-cp').classList.remove('hidden');
    tempProducts = group.products.map(p => ({ ...p }));
    resetProductForm();
    refreshCurrencySymbols();
    document.getElementById('cp-modal').classList.remove('hidden');
}

// Müşteri seçilince o müşterinin kartındaki para birimini öner.
// Zaten kayıtlı bir fiyat kartı varsa onun para birimi, yoksa müşteri
// kartındaki (customers.currency) varsayılan kullanılır.
function onCustomerChanged() {
    const customerId = document.getElementById('cp-customer-select').value;
    const hint = document.getElementById('cp-currency-hint');
    if (!customerId) { hint.textContent = ''; return; }

    const existing = globalClientPrices.find(g => g.customer_id === customerId);
    if (existing) {
        document.getElementById('cp-currency-select').value = existing.currency || DEFAULT_CURRENCY;
        hint.textContent = 'Mevcut fiyat kartından alındı';
    } else {
        const customer = globalCustomers.find(c => c.id === customerId);
        const fromCard = customer && CURRENCY_SYMBOLS[customer.currency] ? customer.currency : null;
        document.getElementById('cp-currency-select').value = fromCard || DEFAULT_CURRENCY;
        hint.textContent = fromCard ? 'Müşteri kartından alındı' : 'Müşteri kartında tanımsız — varsayılan';
    }
    refreshCurrencySymbols();
}

function closeModal() {
    document.getElementById('cp-modal').classList.add('hidden');
}

// ─── TEMP ÜRÜN LİSTESİ ───────────────────────────────────────
function renderTempProducts() {
    const tbody = document.getElementById('cp-temp-product-list');
    if (tempProducts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-slate-600 py-4 text-xs">Henüz ürün eklenmedi.</td></tr>`;
        return;
    }
    const sym = currencySymbol(document.getElementById('cp-currency-select').value || DEFAULT_CURRENCY);
    tbody.innerHTML = '';
    tempProducts.forEach((p, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-4 py-2 text-[#6B655B] font-medium text-xs">${escapeHtml(p.product_name)}</td>
            <td class="px-4 py-2 text-right text-[#6B655B] font-mono text-xs">${parseFloat(p.list_price||0).toFixed(2)} ${sym}</td>
            <td class="px-4 py-2 text-center text-[#B26B33] font-mono text-xs font-bold">% ${parseFloat(p.discount_rate||0).toFixed(2)}</td>
            <td class="px-4 py-2 text-right text-[#2D4A3E] font-mono text-xs font-bold">${parseFloat(p.net_price||0).toFixed(2)} ${sym}</td>
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
    const productName = document.getElementById('cp-temp-product').value.trim();
    const listPrice = parseFloat(document.getElementById('cp-temp-list').value) || 0;
    const netPrice = parseFloat(document.getElementById('cp-temp-net').value) || 0;
    const discountRate = parseFloat(document.getElementById('cp-temp-discount').value) || (listPrice > 0 ? ((listPrice - netPrice) / listPrice * 100) : 0);

    if (!productName) { await showAlertDialog("Lütfen ürün adını giriniz.", { variant: 'warn' }); return; }

    const editIdx = document.getElementById('cp-edit-product-idx').value;
    const productId = resolveProductId(productName); // eşleşme yoksa null (serbest metin)
    const product = { product_id: productId, product_name: productName, list_price: listPrice, net_price: netPrice, discount_rate: discountRate };

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
    document.getElementById('cp-temp-product').value = p.product_name;
    document.getElementById('cp-temp-list').value = p.list_price || '';
    document.getElementById('cp-temp-net').value = p.net_price || '';
    document.getElementById('cp-temp-discount').value = parseFloat(p.discount_rate||0).toFixed(2);
    document.getElementById('cp-edit-product-idx').value = idx;
    document.getElementById('cp-product-form-title').textContent = 'Ürünü Güncelle';
    document.getElementById('btn-cancel-product-edit').classList.remove('hidden');
    document.getElementById('cp-btn-icon').className = 'fa-solid fa-check text-sm';
}

function resetProductForm() {
    ['cp-temp-product','cp-temp-list','cp-temp-net','cp-temp-discount'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cp-edit-product-idx').value = '';
    document.getElementById('cp-product-form-title').textContent = '2. Ürün / Fiyat Ekle';
    document.getElementById('btn-cancel-product-edit').classList.add('hidden');
    document.getElementById('cp-btn-icon').className = 'fa-solid fa-plus text-sm';
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
    });
    discInput.addEventListener('input', () => {
        const list = parseFloat(listInput.value) || 0;
        const disc = parseFloat(discInput.value) || 0;
        if (list > 0) netInput.value = (list * (1 - disc / 100)).toFixed(2);
    });
    netInput.addEventListener('input', () => {
        const list = parseFloat(listInput.value) || 0;
        const net = parseFloat(netInput.value) || 0;
        if (list > 0 && net > 0) discInput.value = ((list - net) / list * 100).toFixed(2);
    });
}

// ─── KAYDETME ─────────────────────────────────────────────────
async function saveClientPrices() {
    if (!canEdit(ctx, 'client-prices')) {
        await showAlertDialog('Bu modülde düzenleme yetkiniz yok.', { variant: 'warn' });
        return;
    }
    const customerId = document.getElementById('cp-customer-select').value;
    const currency = document.getElementById('cp-currency-select').value || DEFAULT_CURRENCY;
    if (!customerId) { await showAlertDialog("Lütfen bir müşteri seçiniz.", { variant: 'warn' }); return; }
    if (tempProducts.length === 0) { await showAlertDialog("Lütfen en az bir ürün fiyatı ekleyiniz.", { variant: 'warn' }); return; }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = ctx.ownerId;

        // Önce bu müşteriye ait mevcut fiyatları sil
        await supabase.from('customer_prices').delete().eq('customer_id', customerId).eq('user_id', userId);

        // Yeni fiyatları toplu ekle
        const inserts = tempProducts.map(p => ({
            user_id: userId,
            customer_id: customerId,
            product_id: p.product_id || null,   // ← eklendi (nullable)
            product_name: p.product_name,
            currency,                            // kart bazlı, tüm satırlara yazılır
            list_price: parseFloat(p.list_price) || 0,
            net_price: parseFloat(p.net_price) || 0,
            discount_rate: parseFloat(p.discount_rate) || 0,
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
        const { data: { session } } = await supabase.auth.getSession();
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
function applySearch() {
    const searchVal = document.getElementById('cp-search-input').value.toLowerCase();
    const filtered = globalClientPrices.filter(g =>
        g.company_name.toLowerCase().includes(searchVal) ||
        g.products.some(p => p.product_name.toLowerCase().includes(searchVal))
    );
    renderClientPriceCards(filtered);
}

// ─── CSV EXPORT ───────────────────────────────────────────────
async function exportToCSV() {
    if (globalClientPrices.length === 0) {
        await showAlertDialog("Aktarılacak fiyat verisi yok.", { variant: 'warn' });
        return;
    }
    let csv = "data:text/csv;charset=utf-8,\uFEFF";
    csv += "Musteri;Ulke;Para Birimi;Urun Adi;Liste Fiyati;Iskonto %;Net Fiyat\n";
    globalClientPrices.forEach(g => {
        g.products.forEach(p => {
            csv += `"${g.company_name}";"${g.country}";"${g.currency}";"${p.product_name}";"${parseFloat(p.list_price).toFixed(2)}";"${parseFloat(p.discount_rate||0).toFixed(2)}";"${parseFloat(p.net_price).toFixed(2)}"\n`;
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
    document.getElementById('cp-customer-select').addEventListener('change', onCustomerChanged);
    document.getElementById('cp-currency-select').addEventListener('change', refreshCurrencySymbols);
    wireCalculator();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
