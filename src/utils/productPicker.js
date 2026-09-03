// productPicker.js — Sipariş/Teklif kalem satırlarındaki ürün arama (autocomplete) listesi.
//
// Neden gövdeye taşınan tek bir açılır liste?
// Kalem tablosu `overflow-x:auto` olan bir sarmalayıcının içinde duruyor. CSS'te
// overflow-x:auto verilen bir kutuda overflow-y "visible" kalamaz; tarayıcı onu da
// auto'ya çevirir. Bu yüzden satırın içine `position:absolute` ile basılan açılır liste
// sarmalayıcının alt kenarında kırpılıyor ve pratikte tek satırlık bir şeride sıkışıyordu.
// Çözüm: liste `position:fixed` olarak <body> altında tek bir öğe hâlinde tutulur ve
// input'un ekran koordinatlarına göre konumlanır — hiçbir sarmalayıcı onu kırpamaz.
//
// Modülü kullanan taraf yalnızca `.item-search` input'larını (data-idx ile) render eder;
// satır HTML'ine açılır liste kabı koymaya gerek yoktur.

let ddEl = null;          // tekil açılır liste öğesi
let activeInput = null;   // listenin bağlı olduğu input
let activeIdx = -1;       // klavye ile seçili seçenek

function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function ensureDropdown() {
    if (ddEl) return ddEl;
    ddEl = document.createElement('div');
    ddEl.className = 'product-picker-dd';
    ddEl.style.cssText = [
        'position:fixed', 'z-index:9999', 'display:none', 'overflow-y:auto',
        'background:var(--surface,#fff)', 'border:1px solid var(--border,#E4DDCE)',
        'border-radius:8px', 'box-shadow:0 10px 30px rgba(28,26,23,.18)',
        'font-family:inherit',
    ].join(';');
    document.body.appendChild(ddEl);

    // Liste açıkken sayfa/kapsayıcı kaydırılırsa veya pencere boyutlanırsa yeniden konumlan.
    window.addEventListener('scroll', () => { if (isOpen()) positionDropdown(); }, true);
    window.addEventListener('resize', () => { if (isOpen()) positionDropdown(); });
    return ddEl;
}

function isOpen() {
    return !!ddEl && ddEl.style.display === 'block';
}

export function closeProductPicker() {
    if (!ddEl) return;
    ddEl.style.display = 'none';
    ddEl.innerHTML = '';
    activeInput = null;
    activeIdx = -1;
}

// Açılır listeyi input'un altına yerleştirir; alta sığmıyorsa üstüne alır.
function positionDropdown() {
    if (!activeInput || !ddEl) return;
    const r = activeInput.getBoundingClientRect();

    // Girdi kaydırma sonucu görünür alandan tamamen çıktıysa listeyi kapat.
    if (r.bottom < 0 || r.top > window.innerHeight) { closeProductPicker(); return; }

    const margin = 8;
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;

    const maxH = Math.max(120, Math.min(320, (openUp ? spaceAbove : spaceBelow) - gap));
    ddEl.style.maxHeight = maxH + 'px';

    // Dar sütunlarda ürün adları okunamıyordu; liste en az 340px genişlikte açılır.
    const width = Math.min(Math.max(r.width, 340), window.innerWidth - 2 * margin);
    ddEl.style.width = width + 'px';

    let left = r.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    if (left < margin) left = margin;
    ddEl.style.left = left + 'px';

    ddEl.style.top = openUp
        ? Math.max(margin, r.top - ddEl.offsetHeight - gap) + 'px'
        : (r.bottom + gap) + 'px';
}

function defaultRenderOption(p) {
    return `
        <div style="font-size:11.5px;font-weight:600;color:var(--ink-1,#1C1A17);line-height:1.35;">${escHtml(p.stok_adi_1)}</div>
        ${p.stok_adi_2 ? `<div style="font-size:10.5px;color:var(--ink-2,#6B655B);line-height:1.3;">${escHtml(p.stok_adi_2)}</div>` : ''}
        <div style="font-size:10px;color:var(--ink-3,#968B7A);margin-top:2px;">${escHtml(p.stok_kodu || '')}${p.renk ? ' &middot; ' + escHtml(p.renk) : ''}</div>`;
}

function setActiveOption(next) {
    const opts = ddEl.querySelectorAll('.ac-option');
    if (opts.length === 0) return;
    if (activeIdx >= 0 && opts[activeIdx]) opts[activeIdx].style.background = '';
    activeIdx = (next + opts.length) % opts.length;
    const el = opts[activeIdx];
    el.style.background = 'var(--surface-2,#F6F3EC)';
    el.scrollIntoView({ block: 'nearest' });
}

/**
 * Bir kalem tablosundaki görünür `.item-search` input'larına ürün arama listesi bağlar.
 *
 * @param {HTMLElement} root          Satırların bulunduğu kap (tbody / div)
 * @param {Function}    getProducts   () => ürün dizisi (her render'da güncel liste)
 * @param {Function}    onSelect      (product, idx) => void — seçim yapıldığında
 * @param {Function}    [renderOption] (product) => HTML — seçenek gövdesi
 * @param {number}      [limit=30]    Gösterilecek en fazla sonuç
 */
export function attachProductAutocomplete({ root, getProducts, onSelect, renderOption, limit = 30 }) {
    const dd = ensureDropdown();
    const render = renderOption || defaultRenderOption;

    root.querySelectorAll('.item-search').forEach(inp => {
        if (inp.classList.contains('hidden')) return;
        const idx = parseInt(inp.dataset.idx, 10);
        let debounce = null;

        const runSearch = () => {
            const q = inp.value.toLocaleLowerCase('tr-TR').trim();
            if (q.length < 1) { if (activeInput === inp) closeProductPicker(); return; }

            const words = q.split(/\s+/);
            const matches = (getProducts() || []).filter(p => {
                const hay = [p.stok_kodu || '', p.stok_adi_1 || '', p.stok_adi_2 || '']
                    .join(' ').toLocaleLowerCase('tr-TR');
                return words.every(w => hay.includes(w));
            }).slice(0, limit);

            activeInput = inp;
            activeIdx = -1;

            dd.innerHTML = matches.length === 0
                ? `<div style="padding:10px 12px;font-size:11px;color:var(--ink-3,#968B7A);">Sonuç yok</div>`
                : matches.map(p => `
                    <div class="ac-option" data-pid="${escHtml(p.id)}"
                         style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-soft,#F0EDE4);transition:background .1s;">
                        ${render(p)}
                    </div>`).join('');

            dd.style.display = 'block';
            dd.scrollTop = 0;
            positionDropdown();

            dd.querySelectorAll('.ac-option').forEach((opt, i) => {
                opt.addEventListener('mouseenter', () => setActiveOption(i));
                opt.addEventListener('mousedown', e => {
                    e.preventDefault(); // input blur olup listeyi kapatmasın
                    const prod = (getProducts() || []).find(p => String(p.id) === opt.dataset.pid);
                    closeProductPicker();
                    if (prod) onSelect(prod, idx);
                });
            });
        };

        inp.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(runSearch, 120);
        });
        inp.addEventListener('focus', () => { if (inp.value.trim().length >= 1) runSearch(); });
        inp.addEventListener('blur', () => setTimeout(() => { if (activeInput === inp) closeProductPicker(); }, 150));

        inp.addEventListener('keydown', e => {
            if (!isOpen() || activeInput !== inp) return;
            if (e.key === 'ArrowDown')      { e.preventDefault(); setActiveOption(activeIdx + 1); }
            else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveOption(activeIdx - 1); }
            else if (e.key === 'Escape')    { closeProductPicker(); }
            else if (e.key === 'Enter' && activeIdx >= 0) {
                e.preventDefault();
                const opt = dd.querySelectorAll('.ac-option')[activeIdx];
                if (!opt) return;
                const prod = (getProducts() || []).find(p => String(p.id) === opt.dataset.pid);
                closeProductPicker();
                if (prod) onSelect(prod, idx);
            }
        });
    });
}
