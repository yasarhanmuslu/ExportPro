// priceFlags.js — "Fiyat Notu" işaretleri (Bedelsiz / CN Fiyatı)
// Sipariş ve Teklif modüllerinin ORTAK kalem işaretleme arayüzü.
// (proformaPdf.js gibi: iki modüle kopyalanmaz, buradan kullanılır.)
//
// NEDEN
// Bedelsiz gönderim faturasal olarak 0 tutarla yapılamadığı için kalem, liste
// fiyatının %99 iskontolusuyla girilir. Girilen tutar GERÇEKTİR — fatura ve
// kalem toplamı ona göre oluşur — ama bir pazarlık fiyatı DEĞİLDİR. İşaret
// yalnızca bunu söyler; fiyat alanını ne sıfırlar ne kilitler. İşaretli
// satırlar fiyat istatistiklerinin dışında tutulur (profitability.js,
// client-prices.js), ciro/adet toplamlarında kalmaya devam eder.
//
// İkinci işaret bunun devamı: bedelsiz kalemin tutarı bazen başka bir kalemden
// düşülür. Müşteri Sabit Fiyatlar'da gerçek fiyat korunduğu için (bilinçli
// tercih) fark yalnız o kalemde kalır; o satır da anlaşılan fiyatı temsil etmez.
//
// Kolonlar SQL 016 (order_items) ve 020 (quotation_items) ile gelir. Kolon
// yoksa arayüz kendini gizler ve hiçbir yazma işlemine alan eklenmez.

export const PRICE_FLAGS = [
    {
        field: 'is_free', cls: 'on-free', icon: 'fa-gift', label: 'BEDELSİZ', showPct: true,
        title: "Bedelsiz gönderim — birim fiyat faturasal zorunluluk nedeniyle girilmiş temsili tutardır (liste fiyatının ~%1'i).\nTutar olduğu gibi kalır; satır fiyat istatistiklerine katılmaz.",
    },
    {
        field: 'cn_adjusted', cls: 'on-cn', icon: 'fa-file-invoice-dollar', label: 'CN FİYATI',
        title: 'Fiyat bir Credit Note nedeniyle elle düzenlendi (ör. bedelsiz kalemin tutarı bu satırdan düşüldü).\nAnlaşılan fiyat değildir; satır fiyat istatistiklerine katılmaz.',
    },
];

// Kalem tamponundaki bir satır için boş alan taşımayan payload eki.
export function flagPayload(item, enabled) {
    if (!enabled) return {};
    return { is_free: item.is_free === true, cn_adjusted: item.cn_adjusted === true };
}

// Tampona yeni satır eklerken / okurken kullanılacak varsayılanlar.
export function flagDefaults(row = {}) {
    return { is_free: row.is_free === true, cn_adjusted: row.cn_adjusted === true };
}

/**
 * Bir modül için işaret arayüzü kurar.
 *
 * @param {string}   opts.table       Kolonun yoklanacağı tablo ('order_items' / 'quotation_items')
 * @param {object}   opts.supabase    Supabase istemcisi
 * @param {function} opts.getBuffer   Güncel kalem tamponunu döndüren fonksiyon
 * @param {string}   opts.sqlHint     Kolon yoksa konsola yazılacak script adı
 */
export function createPriceFlags({ table, supabase, getBuffer, sqlHint }) {
    let enabled = false;

    // Kolonlar var mı? Bir kez yoklanır. Başlık ve alt toplam hücresi BİRLİKTE
    // gizlenir; yalnız biri gizlenirse table-layout:fixed tabloda hayalet bir
    // sütun kalır.
    async function probe() {
        const { error } = await supabase.from(table).select('is_free, cn_adjusted').limit(1);
        enabled = !error;
        if (!enabled) {
            console.info(`${table}.is_free/cn_adjusted kolonları yok — ${sqlHint} çalıştırılmamış. "Fiyat Notu" sütunu gizlendi.`);
        }
        ['th-price-flags', 'tf-price-flags'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = enabled ? '' : 'none';
        });
        return enabled;
    }

    const isEnabled = () => enabled;

    // İşaretli satırda, aynı belgedeki aynı ürünün normal fiyatına göre iskonto
    // yüzdesi — yanlış tuşlanmış temsili tutarı yakalamak için. Çipin BAŞLIĞINA
    // eklenir: çipin içine yazılınca sütunun en geniş hali ~234px oluyor ve
    // işaretsiz satırlarda sağda ~59px ölü alan kalıyordu.
    // Referans satır yoksa hiç üretilmez — liste fiyatı bu ekranda tutulmuyor.
    function discountPct(item) {
        const price = parseFloat(item.unit_price) || 0;
        if (price <= 0 || !item.product_code) return '';
        const ref = getBuffer().reduce((max, o) => {
            if (o === item || o.product_code !== item.product_code) return max;
            if (o.is_free || o.cn_adjusted) return max;
            return Math.max(max, parseFloat(o.unit_price) || 0);
        }, 0);
        if (ref <= price) return '';
        const pct = (1 - price / ref) * 100;
        const n = v => v.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        return `\n\nAynı belgedeki aynı ürünün normal fiyatı ${ref.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} — bu satır %${n(pct)} iskontolu.`;
    }

    function chips(item, idx) {
        return PRICE_FLAGS.map(f => {
            const on = item[f.field] === true;
            const tip = f.title + (on && f.showPct ? discountPct(item) : '');
            return `<span class="flag-chip${on ? ' ' + f.cls : ''}" data-flag="${f.field}" data-idx="${idx}" title="${escapeAttr(tip)}" role="button" tabindex="0">
                        <i class="fa-solid ${on ? f.icon : 'fa-plus'}"></i>${f.label}
                    </span>`;
        }).join('');
    }

    // Satırın <td>'si. Kolon yoksa boş string — sütun zaten gizli.
    function cell(item, idx) {
        if (!enabled) return '';
        return `<td style="width:188px;">
                    <div class="flag-cell" data-idx="${idx}">${chips(item, idx)}</div>
                </td>`;
    }

    // Bir satırın fiyatı değişince referans olarak kullanıldığı DİĞER satırların
    // iskonto yüzdesi de bayatlar — hepsi birden tazelenir. Tablo yeniden
    // çizilmez, kullanıcı yazarken odak kaybolmasın.
    function refresh(tbody) {
        tbody.querySelectorAll('.flag-cell').forEach(el => {
            const idx = parseInt(el.dataset.idx);
            const item = getBuffer()[idx];
            if (item) el.innerHTML = chips(item, idx);
        });
    }

    // Çipler olay delegasyonuyla dinlenir: hücre, fiyat yazılırken yeniden
    // çiziliyor — tek tek bağlanan dinleyiciler o çizimde kaybolurdu. tbody her
    // render'da korunduğu için bağlama YALNIZ BİR KEZ yapılır; aksi halde
    // dinleyiciler üst üste binip tek tıkta iki kez toggle ederdi.
    function bind(tbody) {
        if (tbody.dataset.flagsBound === '1') return;
        tbody.dataset.flagsBound = '1';

        const toggle = el => {
            const idx = parseInt(el.dataset.idx);
            const item = getBuffer()[idx];
            if (!item) return;
            item[el.dataset.flag] = !item[el.dataset.flag];
            refresh(tbody);
        };
        tbody.addEventListener('click', e => {
            const chip = e.target.closest('.flag-chip');
            if (chip) toggle(chip);
        });
        tbody.addEventListener('keydown', e => {
            const chip = e.target.closest('.flag-chip');
            if (chip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(chip); }
        });
    }

    return { probe, isEnabled, cell, chips, bind, refresh, discountPct };
}

function escapeAttr(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
