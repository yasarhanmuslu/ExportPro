// productIdentity.js — Sipariş kalemlerini ve müşteri fiyat kartlarını aynı
// ürün kimliğine bağlamak için ortak yardımcılar.
//
// NEDEN GEREKLİ: urunler tablosunda AYNI stok_adi_1 iki farklı stok_kodu ile
// bulunabiliyor — stok kodunun 4. segmenti kaliteyi taşır (-1- = 1.Kalite,
// -2- = 2.Kalite) ve kalite NET satış fiyatını değiştirir (liste fiyatını
// değil). Bu yüzden ürün eşleştirmesi isimle DEĞİL, elde olan en güçlü
// kimlikle yapılmalıdır:
//
//     product_id  >  stok_kodu  >  normalize edilmiş ad (son çare)
//
// İsimle eşleşme, aday tekse kabul edilir. Aynı ad iki kalitede birden varsa
// hangisi olduğu bilinemez; tahmin etmek yanlış fiyat/iskonto üretir, bu
// yüzden satır "kalite belirsiz" olarak işaretlenir.
//
// NOT: src/client-prices.js içinde bu mantığın yerel bir kopyası var
// (itemProductKey / itemProduct). İleride o da buraya taşınmalı.

import { IdevitCode } from './idevitCodeRules.js';

export function normCode(c) {
    return String(c || '').trim().toUpperCase();
}

// Türkçe İ/I/ı ayrımını KASITLI olarak düzler: ürün adları serbest metin ve
// farklı kaynaklardan geliyor, "İnce" ile "Ince" aynı ürünü göstermeli.
// (toLocaleLowerCase('tr-TR') bunları ayrı bırakır — projede bilinen tuzak.)
export function normName(s) {
    return String(s || '')
        .trim()
        .replace(/[İIı]/g, 'i')
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

// urunler listesinden arama indeksi kurar.
export function buildProductIndex(urunler = []) {
    const byId = new Map();
    const byCode = new Map();
    const byName = new Map();   // normalize ad -> [ürün, ...]

    urunler.forEach(p => {
        if (p.id) byId.set(p.id, p);
        const code = normCode(p.stok_kodu);
        if (code) byCode.set(code, p);
        const name = normName(p.stok_adi_1);
        if (name) {
            if (!byName.has(name)) byName.set(name, []);
            byName.get(name).push(p);
        }
    });

    return { byId, byCode, byName };
}

// Bir satırı (sipariş kalemi ya da fiyat kartı) katalog ürününe bağlar.
// Bağlanamazsa null döner — bu bir hata değil, katalogda olmayan satırlar var
// (yedek parça, makine sarf malzemesi, serbest metin girilmiş kalemler).
export function resolveProduct(index, row) {
    if (!index || !row) return null;

    if (row.product_id && index.byId.has(row.product_id)) {
        return index.byId.get(row.product_id);
    }
    const byCode = index.byCode.get(normCode(row.product_code));
    if (byCode) return byCode;

    const candidates = index.byName.get(normName(row.product_name));
    return (candidates && candidates.length === 1) ? candidates[0] : null;
}

// Aynı ad birden fazla katalog ürününe (tipik olarak 1. ve 2. Kalite) denk
// geliyor mu? Bu satırlar isimle gruplanmak zorunda kalır ve kaliteleri karışır.
export function isAmbiguousByName(index, row) {
    if (!index || !row) return false;
    if (row.product_id && index.byId.has(row.product_id)) return false;
    if (index.byCode.has(normCode(row.product_code))) return false;
    const candidates = index.byName.get(normName(row.product_name));
    return !!(candidates && candidates.length > 1);
}

// Bir satırın SAHİP OLDUĞU tüm kimlikler. Eşleştirme tek anahtarla değil, bu
// listelerin KESİŞİMİYLE yapılmalı.
//
// Neden: fiyat kartı satırında stok kodu kolonu yok (yalnızca product_id + ad)
// ve bazı kartlar İngilizce adla, product_id boş kaydedilmiş. Sipariş kaleminde
// ise stok kodu var ama product_id boş. Katalogda o kod hiç yoksa iki taraf da
// çözülemez ve biri `name:<ingilizce>`, diğeri `code:<kod>` anahtarına düşer —
// aynı ürün oldukları hâlde asla eşleşmezler. Canlı veride Temax, Roccaforte ve
// Essa'da tam olarak bu oluyordu ve ürünler yanlışlıkla "fiyat kartı yok" diye
// raporlanıyordu.
export function identityKeys(index, row) {
    const keys = [];
    const prod = resolveProduct(index, row);
    if (prod) {
        keys.push('id:' + prod.id);
        if (prod.stok_kodu) keys.push('code:' + normCode(prod.stok_kodu));
        const pn = normName(prod.stok_adi_1);
        if (pn) keys.push('name:' + pn);
    }
    if (row.product_id) keys.push('id:' + row.product_id);
    const code = normCode(row.product_code);
    if (code) keys.push('code:' + code);
    const name = normName(row.product_name);
    if (name) keys.push('name:' + name);
    return [...new Set(keys)];
}

// Gruplama anahtarı. Katalogda olmayan satırlar da gruplanabilmeli, bu yüzden
// son çare olarak koda, o da yoksa normalize ada düşer.
export function productKey(index, row) {
    const prod = resolveProduct(index, row);
    if (prod) return 'id:' + prod.id;
    const code = normCode(row.product_code);
    if (code) return 'code:' + code;
    return 'name:' + normName(row.product_name);
}

// Kalite, stok kodunun 4. segmentidir. Aksesuar formatındaki kodlarda yoktur.
export function qualityOf(stokKodu) {
    const parsed = IdevitCode.parse(stokKodu);
    if (!parsed.ok || parsed.format !== 'main') return null;
    return IdevitCode.DICT.F_TO_KALITE[parsed.F] || null;
}

// Ekranda gösterilecek ürün etiketi. Katalog adı varsa o tercih edilir —
// sipariş kalemine elle yazılmış ad yazım farkı taşıyabilir.
export function productLabel(index, row) {
    const prod = resolveProduct(index, row);
    return {
        name:      (prod && prod.stok_adi_1) || row.product_name || 'Bilinmeyen',
        code:      (prod && prod.stok_kodu) || row.product_code || '',
        quality:   prod ? qualityOf(prod.stok_kodu) : null,
        linked:    !!prod,
        ambiguous: isAmbiguousByName(index, row),
    };
}
