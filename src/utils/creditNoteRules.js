// Credit Note alan adı sözlüğü ve hesap kuralları.
// credit-notes.js (kayıt) ve complaints.js (raporlama) aynı tanımları kullansın diye
// tek yerde toplandı — iki modülün karar değerleri geçmişte birbirinden ayrışmıştı.

// ── Karar (Decision) ─────────────────────────────────────────────────────────
// value    : Credit Note belgesinde (İngilizce) yazan değer — DB'de bu saklanır.
// tr       : Arayüzde gösterilen Türkçe karşılık.
// credited : Kalem tutarı müşteriye alacak yazılıyor mu?
// halfPrice: Belgeye yazılan birim fiyat, ürünün tam fiyatının YARISIDIR.
// pending  : Karar henüz verilmedi (görsel bekleniyor) — reddedilmiş sayılmaz.
//
// ÖNEMLİ — %50 tolerans nasıl hesaplanır:
// Arşivdeki 83 Credit Note belgesi üzerinde doğrulandı: "Tolerance - %50 Discount"
// kalemlerinde belgenin PRICE sütununa ZATEN yarıya indirilmiş fiyat yazılıyor
// (ör. Gökkuşağı 28x38'in tam fiyatı 6,50 € iken tolerans kalemine 3,25 € yazılmış)
// ve belgedeki genel toplam bu değerlerin DÜZ toplamı. Bu yüzden tutar hesabında
// ayrıca 0,5 ile çarpılmaz — çarpılsaydı iskonto iki kez uygulanmış olurdu.
// (Doğrulama: TD UNICOOP 14.05.2025 → 8,64 + 23,52 + 23,52 + 11,76 = 67,44 € ✓
//  belgede yazan tutarla birebir; 0,5 katsayısıyla 57,24 € çıkıyordu.)
// Girişte kolaylık olsun diye arayüz, tolerans seçilen satırda fiyatı tek tıkla
// yarıya indiren bir "½" düğmesi gösterir.
export const DECISIONS = [
    { value: 'Confirmed',                tr: 'Onaylandı',              credited: true,  tone: 'ok',
      hint: 'Hatanın onaylandığını bildirir.' },
    { value: 'Confirmed - Broken',       tr: 'Onaylandı - Kırık',      credited: true,  tone: 'ok',
      hint: 'Kırık ürün normalde müşteri hatasıdır; müşteri memnuniyeti için onaylandı ama kırık olduğu kayda geçer.' },
    { value: 'Tolerance - %50 Discount', tr: '%50 İskonto - Tolerans', credited: true,  tone: 'warn', halfPrice: true,
      hint: 'Hata kabul edildi ancak çok mikro / kullanımı etkilemiyor — sonraki siparişte yarı yarıya indirim. Fiyat alanına indirimli tutarı yazın.' },
    { value: 'Refused',                  tr: 'Reddedildi',             credited: false, tone: 'danger',
      hint: 'Hatanın reddedildiğini bildirir.' },
    { value: 'Refused - Broken',         tr: 'Reddedildi - Kırık',     credited: false, tone: 'danger',
      hint: 'Ürün kırık olduğu için reddedildi.' },
    { value: 'Refused - Tolerance',      tr: 'Reddedildi - Tolerans',  credited: false, tone: 'danger',
      hint: 'Hata toleranslar dahilinde olduğu için reddedildi.' },
    { value: 'Waiting Picture',          tr: 'Resim Bekleniliyor',     credited: false, tone: 'info', pending: true,
      hint: 'Hatanın incelenmesi için müşteriden görsel bekleniyor.' },
];

const DECISION_BY_VALUE = new Map(DECISIONS.map(d => [d.value, d]));

export function getDecision(value) {
    return DECISION_BY_VALUE.get((value || '').trim()) || null;
}

export function decisionLabel(value) {
    const d = getDecision(value);
    return d ? d.tr : (value || '—');
}

// Kalem müşteriye alacak yazılıyor mu? (Reddedilen ve karar bekleyenler hayır.)
export function isCredited(value) {
    const d = getDecision(value);
    return !!d && d.credited;
}

// Bu kararda belgeye yarıya indirilmiş fiyat yazılır mı? (Yalnızca arayüz ipucu.)
export function isHalfPriceDecision(value) {
    const d = getDecision(value);
    return !!d && !!d.halfPrice;
}

export function isConfirmed(value) {
    return isCredited(value);
}

export function isPending(value) {
    const d = getDecision(value);
    return !value || !d || !!d.pending;
}

// Karar sütunu belgeden belgeye serbest yazılmış: kelime sırası değişiyor
// ("Broken - Confirmed"), tire boşluksuz olabiliyor ("Refuse-Broken"), kök
// farklılaşıyor ("Tolerant" / "Tolerance", "Refuse" / "Refused") ve "Discount"
// kimi belgede hiç yazılmıyor ("Tolerance -%50"). Bu yüzden birebir metin
// karşılaştırması yerine anahtar kelime tespiti yapılır.
//
// Tanınmayan metin null döner: kalem yine de aktarılır, karar boş bırakılır ve
// kullanıcıya "elle seçin" uyarısı gösterilir — yanlış bir karar yazmak
// (özellikle Refused'ı Confirmed sanmak) doğrudan yanlış tutar üretirdi.
export function normalizeDecision(raw) {
    const s = (raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return null;

    // Önce kanonik değerler ve Türkçe karşılıkları
    const key = s.toLowerCase().replace(/\s*-\s*/g, ' - ');
    for (const d of DECISIONS) {
        if (d.value.toLowerCase() === key) return d.value;
        if (d.tr.toLowerCase() === s.toLowerCase()) return d.value;
    }

    const t          = s.toLowerCase();
    const refused    = /refus/.test(t) || /reddedil/.test(t);
    const confirmed  = /confirm/.test(t) || /onayland/.test(t);
    const broken     = /broken/.test(t) || /kırık|kirik/.test(t);
    const tolerance  = /toleran/.test(t);
    const fifty      = /50/.test(t);
    const waiting    = /waiting|bekleni/.test(t);

    if (waiting)              return 'Waiting Picture';
    if (refused && tolerance) return 'Refused - Tolerance';
    if (refused && broken)    return 'Refused - Broken';
    if (refused)              return 'Refused';
    if (confirmed && broken)  return 'Confirmed - Broken';
    if (confirmed)            return 'Confirmed';
    // "Tolerance -%50", "%50 - Tolerance", "Tolerant - %50 Discount"
    // Yalnız başına "Tolerance" belirsizdir (kabul mü red mi?) — eşleştirilmez.
    if (tolerance && fifty)   return 'Tolerance - %50 Discount';
    return null;
}

// ── Telafi tipi ──────────────────────────────────────────────────────────────
// Credit Note iki şekilde kapatılır: ya sonraki siparişin tutarından düşülür
// (Mahsup), ya da ürünün yenisi bedelsiz gönderilir.
export const COMPENSATION_TYPES = [
    { value: 'Mahsup',   label: 'Mahsup (tutar düşülecek)', icon: 'fa-percent' },
    { value: 'Bedelsiz', label: 'Bedelsiz ürün gönderilecek', icon: 'fa-gift' },
];

// ── Süreç durumu (CN belgesi nerede?) ────────────────────────────────────────
// Kritik durum 'Belge Gönderildi': karar verilmiş ama henüz siparişe işlenmemiş.
// Modülün varlık sebebi bunların unutulmaması.
export const PROCESS_STATUSES = [
    { value: 'İncelemede',       tone: 'info',   hint: 'Karar süreci devam ediyor / görsel bekleniyor.' },
    { value: 'Belge Gönderildi', tone: 'warn',   hint: 'Karar verildi, müşteriye bildirildi — HENÜZ siparişe işlenmedi.' },
    { value: 'Siparişe İşlendi', tone: 'ok',     hint: 'İlgili siparişte mahsup/bedelsiz olarak uygulandı.' },
    { value: 'İptal',            tone: 'muted',  hint: 'CN geçersiz kılındı.' },
];

export const CURRENCIES = ['EUR', 'USD', 'TRY', 'GBP'];

export const CURRENCY_SYMBOL = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };
export const CURRENCY_BY_SYMBOL = { '€': 'EUR', '$': 'USD', '₺': 'TRY', '£': 'GBP' };

// ── Tutar hesabı ─────────────────────────────────────────────────────────────
// Bedelsiz kalemler tutara girmez (para değil, mal olarak telafi edilir).
// Reddedilen ve karar bekleyen kalemler de girmez.
// %50 tolerans için ek çarpan YOKTUR — gerekçesi DECISIONS başlığındaki notta.
export function lineAmount(item) {
    if (!item || item.compensation_type === 'Bedelsiz') return 0;
    if (!isCredited(item.decision)) return 0;
    const qty   = Number(item.quantity);
    const price = Number(item.unit_price);
    if (!isFinite(qty) || !isFinite(price)) return 0;
    return qty * price;
}

// CN'nin kalemlerden hesaplanan mahsup toplamı.
export function calcTotal(items) {
    return (items || []).reduce((sum, i) => sum + lineAmount(i), 0);
}

// Bedelsiz gönderilecek toplam adet (onaylanmış kalemler).
export function calcFreeGoodsQty(items) {
    return (items || []).reduce((sum, i) => {
        if (i.compensation_type !== 'Bedelsiz' || !isConfirmed(i.decision)) return sum;
        const q = Number(i.quantity);
        return sum + (isFinite(q) ? q : 0);
    }, 0);
}

// Belgede yazan tutar varsa o esastır (elle yuvarlama olabiliyor: hesaplanan
// 100,52 € iken belgede 100,50 € yazması gibi), yoksa hesaplanan kullanılır.
export function effectiveTotal(note) {
    const stated = Number(note?.total_amount);
    if (note && note.total_amount !== null && note.total_amount !== undefined && isFinite(stated)) return stated;
    return calcTotal(note?.credit_note_items);
}

// ── Ürün ID hücresi ──────────────────────────────────────────────────────────
// Excel/belgelerde tek hücrede iki farklı numara olabiliyor:
//   "3105026677"                      -> bizim barkod ID'miz
//   "None"                            -> ID okunamadı / yok
//   "Claim 37"                        -> müşterinin kendi referansı
//   "None - IDVT13052025103"          -> ID yok, müşteri referansı var
//   "3106976654 - IDVT11032023080"    -> ikisi birden
// Bizim ID'miz ürünün içinde barkotlu, mükerrer olmayan uzun bir sayıdır.
export function parseProductIdCell(raw) {
    const s = (raw === null || raw === undefined ? '' : String(raw)).trim();
    if (!s) return { serial: null, customerRef: null };

    const parts = s.split(/\s+-\s+/).map(p => p.trim()).filter(Boolean);
    let serial = null;
    const refs = [];
    for (const p of parts) {
        if (/^none$/i.test(p) || p === '-') continue;
        if (/^\d{6,}$/.test(p)) { if (!serial) serial = p; else refs.push(p); }
        else refs.push(p);
    }
    return { serial, customerRef: refs.length ? refs.join(' - ') : null };
}

// Aynı ürünün ikinci kez işleme alınmasını yakalamak için karşılaştırma anahtarı.
// Müşteri referansları müşteriye özgü olduğundan (GRESSIA 2'nin "Claim 37"si ile
// başka bir müşterinin "Claim 37"si aynı ürün değildir) müşteri id'siyle birlikte
// anahtarlanır; bizim barkod ID'miz ise küresel olarak tektir.
export function serialKey(serial) {
    return serial ? 'S:' + String(serial).trim() : null;
}

export function customerRefKey(customerId, ref) {
    return ref ? 'C:' + customerId + ':' + String(ref).trim().toLowerCase() : null;
}

// ── Biçimlendirme ────────────────────────────────────────────────────────────
export function formatMoney(value, currency) {
    const n = Number(value);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
         + ' ' + (CURRENCY_SYMBOL[currency] || currency || '');
}

// "19,16 €" / "1.234,56" / "19.16" -> 19.16
// Belgelerde Türkçe (binlik ".", ondalık ",") ve İngilizce yazım birlikte geçebiliyor.
export function parseAmount(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return isFinite(raw) ? raw : null;
    let s = String(raw).replace(/[^\d.,-]/g, '').trim();
    if (!s) return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot   = s.lastIndexOf('.');
    if (lastComma > lastDot)      s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56
    else if (lastDot > lastComma) s = s.replace(/,/g, '');                      // 1,234.56
    else                          s = s.replace(',', '.');                      // 19,16
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
}
