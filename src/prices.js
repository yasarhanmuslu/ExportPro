import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { getAccessContext, guardModuleAccess } from './utils/permissions.js';

// ── Global State ──────────────────────────────────────────────
let globalProducts = [];   // DB'den gelen ham veri
let currentTab = 'eur';    // 'eur' | 'usd'
let eurRate = null;
let usdRate = null;

// ── Başlangıç ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    const ctx = await getAccessContext();
    if (!(await guardModuleAccess(ctx, 'prices'))) return;

    await renderNavbar('prices', ctx);
    await Promise.all([fetchRates(), fetchProducts()]);
    initEventListeners();
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

// ── Veri Çekme ────────────────────────────────────────────────
async function fetchProducts() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase
            .from('price_list')
            .select('*')
            .eq('user_id', session.user.id)
            .order('group_name', { ascending: true })
            .order('product_name', { ascending: true });

        if (error) throw error;
        globalProducts = data || [];

        // Grup filtresini doldur
        populateGroupFilter();

    } catch (err) {
        console.error('Ürün listesi çekilemedi:', err.message);
        document.getElementById('price-table-body').innerHTML =
            `<tr class="loading-row"><td colspan="7" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>Veri çekilirken hata oluştu.</td></tr>`;
    }
}

function populateGroupFilter() {
    const groups = [...new Set(globalProducts.map(p => p.group_name).filter(Boolean))].sort();
    const sel = document.getElementById('group-filter');
    sel.innerHTML = '<option value="">Tüm Gruplar</option>';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        sel.appendChild(opt);
    });
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

// ── Tablo Render ─────────────────────────────────────────────
function renderTable() {
    const tbody = document.getElementById('price-table-body');
    const searchVal = document.getElementById('price-search').value.toLowerCase();
    const groupVal  = document.getElementById('group-filter').value;

    // Filtre uygula
    let filtered = globalProducts.filter(p => {
        const nameMatch = (p.product_name || '').toLowerCase().includes(searchVal);
        const codeMatch = (p.product_code || '').toLowerCase().includes(searchVal);
        const groupMatch = !groupVal || p.group_name === groupVal;
        return (nameMatch || codeMatch) && groupMatch;
    });

    document.getElementById('total-count').textContent = filtered.length;
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr class="loading-row"><td colspan="7" style="color:var(--ink-3);">Sonuç bulunamadı.</td></tr>`;
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
            gtr.innerHTML = `<td colspan="7">${escapeHtml(p.group_name || 'Diğer')}</td>`;
            tbody.appendChild(gtr);
        }

        const dovizListe = currentTab === 'eur' ? p.list_price_eur : p.list_price_usd;
        const tlListe    = p.list_price_tl;

        const tlNet    = calcTlNet(tlListe);
        const dovizNet = calcDovizNet(dovizListe);
        const fark     = calcFark(tlNet, dovizNet);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="td-code">${escapeHtml(p.product_code || '—')}</td>
            <td class="td-name">${escapeHtml(p.product_name || '')}</td>
            <td class="td-num td-tl">${fmtTL(tlListe)}</td>
            <td class="td-num td-net">${fmtTL(tlNet)}</td>
            <td class="td-num" style="color:var(--ink-2);font-weight:500;">${fmtDoviz(tlNetToDoviz(tlNet))}</td>
            <td class="td-num td-eur-liste">${fmtDoviz(dovizListe)}</td>
            <td class="td-num td-eur-net">${fmtDoviz(dovizNet)}</td>
            <td class="td-num">${fmtFark(fark)}</td>
        `;
        tbody.appendChild(tr);
    });
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

// ── Event Listeners ───────────────────────────────────────────
function initEventListeners() {
    // İskonto paneli — her değişiklik tabloyu yeniler
    ['tl-d1','tl-d2','tl-d3','tl-d4','doviz-iskonto'].forEach(id => {
        document.getElementById(id).addEventListener('input', renderTable);
    });

    // Arama ve grup filtresi
    document.getElementById('price-search').addEventListener('input', renderTable);
    document.getElementById('group-filter').addEventListener('change', renderTable);

    // CSV Export
    document.getElementById('btn-export-prices').addEventListener('click', exportCSV);
}

// ── CSV Export ────────────────────────────────────────────────
function exportCSV() {
    if (globalProducts.length === 0) { alert('Aktarılacak veri yok.'); return; }

    const dovizKol = currentTab === 'eur' ? 'EUR' : 'USD';
    let csv = `\uFEFFUrun Kodu;Urun Adi;Grup;2026 TL Liste;2026 TL Net;2026 TL Net (${dovizKol});2022-3 ${dovizKol} Liste;2022-3 ${dovizKol} Net;Fark\n`;

    globalProducts.forEach(p => {
        const dovizListe = currentTab === 'eur' ? p.list_price_eur : p.list_price_usd;
        const tlNet    = calcTlNet(p.list_price_tl);
        const dovizNet = calcDovizNet(dovizListe);
        const fark     = calcFark(tlNet, dovizNet);
        const farkStr  = fark !== null ? (fark * 100).toFixed(1) + '%' : '';

        csv += `"${p.product_code||''}";`;
        csv += `"${p.product_name||''}";`;
        csv += `"${p.group_name||''}";`;
        csv += `"${p.list_price_tl||''}";`;
        csv += `"${tlNet !== null ? tlNet.toFixed(2) : ''}";`;
	csv += `"${tlNetToDoviz(tlNet) !== null ? tlNetToDoviz(tlNet).toFixed(2) : ''}";`;
        csv += `"${dovizListe||''}";`;
        csv += `"${dovizNet !== null ? dovizNet.toFixed(2) : ''}";`;
        csv += `"${farkStr}"\n`;
    });

    const link = document.createElement('a');
    link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv));
    link.setAttribute('download', `FiyatRobotu_${currentTab.toUpperCase()}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
