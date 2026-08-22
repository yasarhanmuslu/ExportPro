// Credit Note belgelerinden (.docx / .pdf) ve takip Excel'inden kalem okuma.
//
// ── NEDEN .docx ÖNCELİKLİ ────────────────────────────────────────────────────
// Arşivdeki Credit Note PDF'lerinin neredeyse tamamı Word'den "yazdır/görüntü"
// yoluyla üretilmiş, METİN KATMANI OLMAYAN taranmış görüntülerdir (örneklenen
// 200 PDF'in 191'inde hiç metin yok). Bu yüzden asıl içe aktarma yolu .docx'tir;
// PDF yalnızca metin katmanı olan az sayıdaki belge için desteklenir ve metin
// bulunamazsa kullanıcıya net bir mesaj verilir (sessizce boş sonuç DÖNMEZ).
//
// ── SÜTUN SIRASI SABİT DEĞİL ─────────────────────────────────────────────────
// Şablonlar müşteriye göre farklı sütun sırası kullanıyor:
//   TEHNOMARKET : No | PRODUCT | CODE | ID | DECISION | PRICE
//   PAFFONI     : Product Code | Product Name | Product ID | Decision | Price
// Bu yüzden sütunlar konuma göre değil, BAŞLIK ADINA göre eşleştirilir.
//
// Buradaki fonksiyonlar saftır (DOM/Supabase bağımlılığı yok) — gerçek arşiv
// dosyalarına karşı test edilebilsinler diye sayfa script'inden ayrı tutuldu.

import { normalizeDecision, parseAmount, parseProductIdCell, CURRENCY_BY_SYMBOL } from './creditNoteRules.js';

// ── Türkçe metin katlama ─────────────────────────────────────────────────────
// Regex'in `i` bayrağı Türkçe İ için YETMEZ: /müşteri/i deseni "MÜŞTERİ" ile
// eşleşmez, çünkü Unicode basit büyük-küçük katlaması U+0130 (İ) ile "i"yi aynı
// saymaz. Excel başlıkları büyük harfle yazıldığından ("MÜŞTERİ", "TARİH") bu,
// başlık satırının hiç bulunamamasına yol açıyordu. Bu yüzden metin, desenle
// karşılaştırılmadan ÖNCE buradan geçirilir ve desenler düz ASCII yazılır.
export function foldTr(raw) {
    return (raw || '')
        .replace(/[İIı]/g, 'i')                                // noktalı/noktasız I ayrımını kaldır
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')      // ş→s, ğ→g, ü→u, ö→o, ç→c
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Firma adı eşleştirme ─────────────────────────────────────────────────────
// Belgede ve Excel'de firma adı tam ticari unvanla ve BÜYÜK HARFLE yazılıyor
// ("TEHNOMARKET-Piric d.o.o", "PAFFONI"), müşteri kartında ise başlık biçiminde
// kısa ad var ("Tehnomarket", "Paffoni"). Karşılaştırma yalnızca eşleştirme
// amaçlıdır; gösterilen ad her zaman müşteri kartındaki hâliyle kalır.
export function normalizeCompanyName(raw) {
    return foldTr(raw)
        .replace(/\b(d\.?o\.?o\.?|ltd|l\.t\.d|s\.r\.l|a\.?s\.?|gmbh|s\.a|inc|llc|sh\.p\.k)\b/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

// ── Takma adlar ──────────────────────────────────────────────────────────────
// Bazı müşteriler takip tablosunda müşteri kartındakinden BAŞKA bir unvanla
// geçiyor; metin benzerliği olmadığı için hiçbir kademe bunları yakalayamaz.
// Anahtar ve değer normalizeCompanyName()'den geçmiş biçimdedir.
//
//   creadivo -> imgravena : "CREADIVO", Gravena firmasının farklı bir unvanı
//   (kullanıcı doğruladı). Kartlarda iki Gravena var — "Im Gravena" (Moldova) ve
//   "Gravena" (Romanya); takip tablosundaki CREADIVO satırlarının ülkesi MOLDOVA
//   olduğu için Moldova kaydına bağlandı.
const CUSTOMER_ALIASES = {
    creadivo: 'imgravena',
};

// Tek harflik fark var mı? (ekleme / silme / değiştirme — Levenshtein ≤ 1)
// Tam mesafe hesabı gerekmiyor, yalnızca "en fazla 1" sorusu yanıtlanıyor.
function isOneEditApart(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    const [s, t] = a.length >= b.length ? [a, b] : [b, a];
    let i = 0, j = 0, edits = 0;
    while (i < s.length && j < t.length) {
        if (s[i] === t[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (s.length === t.length) { i++; j++; } else { i++; }
    }
    return edits + (s.length - i) + (t.length - j) <= 1;
}

// Firma adını müşteri kartlarıyla eşleştirir.
// Kademeli: birebir → önek → içerme → tek harf farkı.
//
// Birden çok aday çıkarsa ada uzunluğu en yakın olan seçilir; aksi halde "FIS",
// dizide önce gelen "Fisnik Mullaj"a takılıp yanlış müşteriye yazardı ("Fiss"
// yerine).
//
// Son basamak (`near`) yazım farklarını yakalar — kullanıcının Excel'i ile müşteri
// kartları arasında fiilen var olan farklar: "GRESSİA 2" ↔ "Gresia 2",
// "İKAY M. GENC" ↔ "İlkay M. Genc". Yalnızca TEK bir aday varsa uygulanır
// (birden çok aday belirsizdir, eşleştirilmez) ve çağıran tarafa `how: 'near'`
// olarak bildirilir ki içe aktarma günlüğünde açıkça görünsün — sessizce
// yaklaşık eşleştirme yapmak yanlış müşteriye veri yazma riskidir.
export function matchCustomerDetailed(rawName, customers) {
    const raw = normalizeCompanyName(rawName);
    if (!raw || !customers?.length) return { customer: null, how: null };

    const alias  = CUSTOMER_ALIASES[raw] || null;
    const target = alias || raw;

    const scored = customers.map(c => ({ c, n: normalizeCompanyName(c.company_name) })).filter(x => x.n);

    const exact = scored.filter(x => x.n === target);
    if (exact.length) return { customer: exact[0].c, how: alias ? 'alias' : 'exact' };

    const pick = list => list.length
        ? list.slice().sort((a, b) =>
            Math.abs(a.n.length - target.length) - Math.abs(b.n.length - target.length))[0].c
        : null;

    const prefix = pick(scored.filter(x =>
        x.n.length >= 4 && (target.startsWith(x.n) || x.n.startsWith(target))));
    if (prefix) return { customer: prefix, how: 'prefix' };

    const contains = pick(scored.filter(x =>
        x.n.length >= 5 && (target.includes(x.n) || x.n.includes(target))));
    if (contains) return { customer: contains, how: 'contains' };

    const near = scored.filter(x => x.n.length >= 5 && isOneEditApart(x.n, target));
    if (near.length === 1) return { customer: near[0].c, how: 'near' };

    return { customer: null, how: null };
}

export function matchCustomer(rawName, customers) {
    return matchCustomerDetailed(rawName, customers).customer;
}

// ── Belge tablosu başlık eşleme ──────────────────────────────────────────────
// Desenler foldTr()'den geçmiş metne uygulanır, bu yüzden düz ASCII ve `i`
// bayrağı olmadan yazılır. Sıra önemli: "Product ID" başlığı `code`/`name`
// desenlerine takılmasın diye her desen kendi anahtar kelimesini zorunlu tutar.
const HEADER_PATTERNS = [
    { field: 'lineNo',   re: /^(no|n[o°]\.?|#|s\.?\s*no|sira)$/ },
    { field: 'serial',   re: /^(product\s*|urun\s*)?id(\s*no)?$/ },
    { field: 'code',     re: /code|kod/ },
    { field: 'name',     re: /product\s*name|^products?$|description|urun|name/ },
    { field: 'decision', re: /decision|karar|result|sonuc/ },
    { field: 'qty',      re: /^(qty|quantity|adet|pcs|pieces|miktar)\.?$/ },
    { field: 'price',    re: /price|fiyat|amount|tutar|value/ },
    { field: 'defect',   re: /defect|complaint|hata|problem|reason|neden/ },
    { field: 'order',    re: /^(order|siparis)(\s*no)?$/ },
    { field: 'note',     re: /note|remark|aciklama|comment/ },
];

// Bir başlık satırını { field: sütunIndeksi } haritasına çevirir.
//
// Kabul ölçütü: bir ÜRÜN sütunu (kod ya da ad) VE en az bir veri sütunu
// (karar / ID / fiyat / adet) bulunmalı. Ölçüt bilerek gevşek tutuldu, çünkü
// arşivdeki eski şablonlarda karar sütunu hiç yok ("PRODUCT | CODE | ID") ya da
// yalnızca finansal sütunlar var ("Product Code | Quantity | Net Price | Amount").
//
// Buna karşılık ürün sütunu olmayan tablolar elenir — yıllık bonus/ciro prim
// yazıları ("DATE | INVOICE NO | AMOUNT", "TARİH | SİPARİŞ NO | TUTAR") da
// Credit Note klasörlerinde duruyor ama ürün şikayeti değiller.
export function mapHeaderRow(cells) {
    const map = {};
    (cells || []).forEach((cell, idx) => {
        const text = foldTr(cell);
        if (!text) return;
        for (const { field, re } of HEADER_PATTERNS) {
            if (map[field] !== undefined) continue;
            if (re.test(text)) { map[field] = idx; return; }
        }
    });
    const hasProduct = map.code !== undefined || map.name !== undefined;
    const hasData    = map.decision !== undefined || map.serial !== undefined
                    || map.price   !== undefined || map.qty    !== undefined;
    if (!hasProduct || !hasData) return null;
    return map;
}

// ── Bir tablo satırını kaleme çevirir ────────────────────────────────────────
// Fiyat hücresi para değilse ("16 Adet", "1 ad.") kalem BEDELSİZ telafi sayılır:
// bu durumda hücredeki sayı adet olarak okunur. "xx" / "XXX" gibi doldurulmamış
// hücrelerde tutar da adet de yazılmaz (reddedilen kalemlerde sık görülüyor).
const QTY_UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(?:ad\.?|adet|pcs|pieces|kom)\b/i;

export function rowToItem(cells, map, ctx = {}) {
    const cell = f => (map[f] === undefined ? '' : (cells[map[f]] || '').replace(/\s+/g, ' ').trim());

    const name = cell('name');
    const code = cell('code');
    if (!name && !code) return null;

    const { serial, customerRef } = parseProductIdCell(cell('serial'));
    const decision = normalizeDecision(cell('decision'));

    const priceRaw = cell('price');
    const qtyRaw   = cell('qty');

    let compensation_type = 'Mahsup';
    let unit_price = null;
    let quantity = 1;

    if (qtyRaw) {
        const q = parseAmount(qtyRaw);
        if (q !== null && q > 0) quantity = q;
    }

    if (priceRaw) {
        const qtyMatch = priceRaw.match(QTY_UNIT_RE);
        const hasCurrency = /[€$₺£]|eur|usd|try|gbp|tl\b/i.test(priceRaw);
        if (qtyMatch && !hasCurrency) {
            // "16 Adet" → para değil, bedelsiz gönderilecek adet
            compensation_type = 'Bedelsiz';
            const q = parseAmount(qtyMatch[1]);
            if (q !== null && q > 0) quantity = q;
        } else {
            const p = parseAmount(priceRaw);
            if (p !== null) unit_price = p;
        }
    }

    return {
        line_no:           map.lineNo !== undefined ? (parseAmount(cell('lineNo')) ?? null) : null,
        product_code:      code || null,
        product_name:      name || null,
        product_serial:    serial,
        customer_ref:      customerRef,
        decision,
        defect_category:   null,
        defect_text:       cell('defect') || null,
        compensation_type,
        quantity,
        unit_price,
        target_order_text_override: cell('order') || null,
        description:       cell('note') || null,
        _currencyHint:     detectCurrency(priceRaw),
        _sourceRow:        ctx.rowIndex ?? null,
    };
}

function detectCurrency(text) {
    for (const ch of String(text || '')) {
        if (CURRENCY_BY_SYMBOL[ch]) return CURRENCY_BY_SYMBOL[ch];
    }
    const m = String(text || '').match(/\b(EUR|USD|TRY|GBP|TL)\b/i);
    if (m) return m[1].toUpperCase() === 'TL' ? 'TRY' : m[1].toUpperCase();
    return null;
}

// ── Belge başlığı / dipnotu ──────────────────────────────────────────────────
// Örnek dipnot:
//   "The mentioned confirmed products amount (183,76 €) will be be deducted by
//    IDEVIT from TEHNOMARKET's 2026-03 order amount."
// "will be be" gibi yazım hataları belgelerde fiilen var; desenler buna toleranslı.
export function parseDocumentMeta(fullText) {
    const text = String(fullText || '').replace(/ /g, ' ');

    let cnDate = null;
    const dm = text.match(/\bdate\s*:?\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/i)
            || text.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/);
    if (dm) {
        const [, d, m, y] = dm;
        cnDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    let buyer = null;
    const bm = text.match(/buyer\s*:?\s*([^\n]+?)(?:\s{2,}|\s*address\s*:|\n|$)/i);
    if (bm) buyer = bm[1].trim().replace(/\s+/g, ' ') || null;

    let totalAmount = null;
    let currency = null;
    const tm = text.match(/amount\s*\(\s*([\d.,]+)\s*([€$₺£])?\s*\)/i);
    if (tm) {
        totalAmount = parseAmount(tm[1]);
        if (tm[2]) currency = CURRENCY_BY_SYMBOL[tm[2]] || null;
    }

    // "... from PAFFONI D.O.O's 2026-02 v.5 order amount."
    let targetOrder = null;
    const om = text.match(/\b(\d{4}\s*-\s*\d{1,2}(?:\s*v\.?\s*\d+)?)\s+order\b/i)
            || text.match(/\b(\d{4}\s*-\s*\d{1,2})\s+sipariş/i);
    if (om) targetOrder = om[1].replace(/\s+/g, ' ').replace(/\s*-\s*/, '-').trim();

    // Bedelsiz gönderim belgeleri "will be sent free of charge" der.
    const freeOfCharge = /free\s+of\s+charge|bedelsiz/i.test(text);

    return { cnDate, buyer, totalAmount, currency, targetOrder, freeOfCharge };
}

// ═════════════════════════════════════════════════════════════════════════════
// DOCX OKUMA
// ═════════════════════════════════════════════════════════════════════════════
// .docx bir ZIP arşividir. Projede JSZip gibi bir bağımlılık yok; tarayıcının
// yerleşik DecompressionStream('deflate-raw') API'si ile arşiv elle açılıyor
// (yalnızca `word/document.xml` çıkarılıyor).

async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('Tarayıcınız .docx açmak için gereken DecompressionStream API\'sini desteklemiyor. Güncel Chrome/Edge kullanın.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ZIP merkezi dizinini okuyup istenen girdiyi çıkarır.
// (Yerel başlıktaki boyutlar "data descriptor" kullanan arşivlerde 0 olabildiği
//  için boyutlar her zaman merkezi dizinden alınır.)
async function zipExtract(arrayBuffer, entryName) {
    const u8 = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);

    // End of Central Directory imzasını sondan geriye doğru ara.
    let eocd = -1;
    const minStart = Math.max(0, u8.length - 22 - 65535);
    for (let i = u8.length - 22; i >= minStart; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Dosya geçerli bir .docx (ZIP) arşivi değil.');

    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');

    for (let n = 0; n < count; n++) {
        if (dv.getUint32(off, true) !== 0x02014b50) break;
        const method     = dv.getUint16(off + 10, true);
        const compSize   = dv.getUint32(off + 20, true);
        const nameLen    = dv.getUint16(off + 28, true);
        const extraLen   = dv.getUint16(off + 30, true);
        const commentLen = dv.getUint16(off + 32, true);
        const localOff   = dv.getUint32(off + 42, true);
        const name       = decoder.decode(u8.subarray(off + 46, off + 46 + nameLen));

        if (name === entryName) {
            const lNameLen  = dv.getUint16(localOff + 26, true);
            const lExtraLen = dv.getUint16(localOff + 28, true);
            const start = localOff + 30 + lNameLen + lExtraLen;
            const raw = u8.subarray(start, start + compSize);
            if (method === 0) return raw;
            if (method === 8) return await inflateRaw(raw);
            throw new Error(`Desteklenmeyen ZIP sıkıştırma yöntemi (${method}).`);
        }
        off += 46 + nameLen + extraLen + commentLen;
    }
    return null;
}

function cellText(node) {
    // w:t metin düğümleri; w:tab ve w:br boşluk/satır sonu üretir.
    let out = '';
    const walk = el => {
        for (const child of el.childNodes) {
            if (child.nodeType !== 1) continue;
            const tag = child.nodeName;
            if (tag === 'w:t') out += child.textContent;
            else if (tag === 'w:tab') out += ' ';
            else if (tag === 'w:br' || tag === 'w:cr') out += '\n';
            else walk(child);
        }
    };
    walk(node);
    return out;
}

function directChildren(el, tagName) {
    return Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.nodeName === tagName);
}

// .docx → { text, tables }
// text   : tüm paragrafların düz metni (başlık/dipnot ayrıştırması için)
// tables : [ [ [hücre, ...], ... ], ... ]
export async function readDocx(arrayBuffer) {
    const xmlBytes = await zipExtract(arrayBuffer, 'word/document.xml');
    if (!xmlBytes) throw new Error('.docx içinde word/document.xml bulunamadı.');

    const xml = new TextDecoder('utf-8').decode(xmlBytes);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('.docx içeriği okunamadı (bozuk XML).');

    const paragraphs = [];
    for (const p of doc.getElementsByTagName('w:p')) {
        const t = cellText(p).replace(/\s+/g, ' ').trim();
        if (t) paragraphs.push(t);
    }

    const tables = [];
    for (const tbl of doc.getElementsByTagName('w:tbl')) {
        const rows = [];
        for (const tr of directChildren(tbl, 'w:tr')) {
            rows.push(directChildren(tr, 'w:tc').map(tc => cellText(tc).replace(/\s+/g, ' ').trim()));
        }
        if (rows.length) tables.push(rows);
    }

    return { text: paragraphs.join('\n'), tables };
}

// ═════════════════════════════════════════════════════════════════════════════
// PDF OKUMA (yalnızca metin katmanı olan belgeler)
// ═════════════════════════════════════════════════════════════════════════════
// Aynı satırdaki farklı tablo sütunları büyük x-boşluklarıyla ayrıldığı için
// '\t' ile bölünür; normal kelime boşlukları korunur. (orders.js'teki proforma
// okuyucusuyla aynı yaklaşım.)
function reconstructPdfLines(items) {
    const tolY = 2;
    const colGapThreshold = 20;
    const rows = new Map();
    for (const item of items) {
        const y = item.transform[5];
        let key = null;
        for (const k of rows.keys()) { if (Math.abs(k - y) <= tolY) { key = k; break; } }
        if (key === null) key = y;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(item);
    }
    const lines = [];
    for (const k of Array.from(rows.keys()).sort((a, b) => b - a)) {
        const rowItems = rows.get(k).slice().sort((a, b) => a.transform[4] - b.transform[4]);
        let line = '', lastEndX = null;
        for (const it of rowItems) {
            const x = it.transform[4];
            if (lastEndX !== null) {
                const gap = x - lastEndX;
                if (gap > colGapThreshold) line += '\t';
                else if (gap > 1) line += ' ';
            }
            line += it.str;
            lastEndX = x + (it.width || 0);
        }
        lines.push(line.trim());
    }
    return lines;
}

// PDF → { text, tables }. Metin katmanı yoksa açıklayıcı hata fırlatır.
export async function readPdf(arrayBuffer) {
    if (!window.pdfjsLib) throw new Error('PDF okuyucu yüklenemedi (pdf.js). Sayfayı yenileyip tekrar deneyin.');

    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allLines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        allLines.push(...reconstructPdfLines(content.items));
    }

    const text = allLines.join('\n');
    if (text.replace(/\s/g, '').length < 20) {
        throw new Error(
            'Bu PDF taranmış bir görüntü — içinde metin katmanı yok, bu yüzden otomatik okunamıyor. ' +
            'Aynı Credit Note\'un .docx dosyasını kullanın (arşivdeki PDF\'lerin neredeyse tamamı bu türden).'
        );
    }

    // Sekmeyle ayrılmış satırları tablo satırı gibi ele al; başlık satırı
    // mapHeaderRow ile bulunacağından tek bir "tablo" yeterli.
    const rows = allLines.map(l => l.split('\t').map(c => c.trim()));
    return { text, tables: [rows] };
}

// ═════════════════════════════════════════════════════════════════════════════
// TEK BELGE İÇE AKTARMA — ORTAK GİRİŞ NOKTASI
// ═════════════════════════════════════════════════════════════════════════════
// Dosyayı okur, başlık satırını bulur ve kalemleri döndürür.
// Dönen `warnings` kullanıcıya gösterilir — sessiz veri kaybı olmaz.
export async function parseCreditNoteFile(file) {
    const buf = await file.arrayBuffer();
    const isDocx = /\.docx$/i.test(file.name);
    const isPdf  = /\.pdf$/i.test(file.name);

    if (/\.doc$/i.test(file.name)) {
        throw new Error('Eski .doc biçimi okunamıyor. Word\'de "Farklı Kaydet → .docx" ile dönüştürün.');
    }
    if (!isDocx && !isPdf) throw new Error('Yalnızca .docx ve .pdf dosyaları okunabilir.');

    const { text, tables } = isDocx ? await readDocx(buf) : await readPdf(buf);
    const meta = parseDocumentMeta(text);
    const warnings = [];

    // Kalem tablosunu bul: başlık satırı tanınan ilk tablo.
    let items = [];
    let headerMap = null;
    for (const rows of tables) {
        for (let h = 0; h < Math.min(rows.length, 5); h++) {
            const map = mapHeaderRow(rows[h]);
            if (!map) continue;
            headerMap = map;
            for (let r = h + 1; r < rows.length; r++) {
                const item = rowToItem(rows[r], map, { rowIndex: r });
                if (item) items.push(item);
            }
            break;
        }
        if (headerMap) break;
    }

    if (!headerMap) {
        throw new Error(
            'Belgede ürün tablosu bulunamadı. Tablonun ilk satırında sütun başlıkları ' +
            '(Product / Code / ID / Decision / Price) yer almalı. ' +
            'Bonus/prim yazıları ve şirket içi yazışmalar bu modüle aktarılamaz.'
        );
    }
    if (items.length === 0) warnings.push('Tablo bulundu ama okunabilir ürün satırı yok.');

    // Karar sütunu hiç yoksa (eski "PRODUCT | CODE | ID" şablonu) bu bir okuma
    // hatası değildir — kullanıcı kararları elle girecek. Sütun VARSA ve değer
    // tanınmadıysa gerçek bir uyarıdır.
    if (headerMap.decision === undefined) {
        warnings.push('Bu şablonda karar (Decision) sütunu yok — kalemlerin kararını elle seçin.');
    } else {
        const missing = items.filter(i => !i.decision).length;
        if (missing > 0) warnings.push(`${missing} kalemde karar değeri tanınamadı — elle seçmeniz gerekiyor.`);
    }
    if (headerMap.price === undefined && headerMap.qty === undefined) {
        warnings.push('Bu şablonda fiyat/adet sütunu yok — telafi tutarını elle girin.');
    }

    // Para birimi: kalemlerdeki sembollerden en çok geçeni; yoksa dipnottaki.
    const counts = {};
    items.forEach(i => { if (i._currencyHint) counts[i._currencyHint] = (counts[i._currencyHint] || 0) + 1; });
    const topCurrency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const currency = (topCurrency && topCurrency[0]) || meta.currency || null;

    items.forEach(i => { delete i._currencyHint; });

    return { meta, items, currency, warnings, sourceName: file.name };
}

// ═════════════════════════════════════════════════════════════════════════════
// EXCEL TAKİP TABLOSU ("CREDIT NOTE TAKIP.xlsx")
// ═════════════════════════════════════════════════════════════════════════════
// Kullanıcının yıllardır elle tuttuğu takip tablosunun toplu aktarımı.

// Excel başlıklarını sütun indekslerine eşler. Başlık satırı ilk 12 satırda aranır.
// Desenler foldTr()'den geçmiş metne uygulandığı için düz ASCII yazılır
// ("MÜŞTERİ" -> "musteri"); doğrudan /müşteri/i yazmak Türkçe İ yüzünden kaçırırdı.
// Sıra önemli: 'urun kodu' / 'urun id', daha genel 'urunler'den önce denenmeli.
const XL_HEADERS = [
    { field: 'no',       re: /^no$/ },
    { field: 'country',  re: /ulke/ },
    { field: 'customer', re: /musteri/ },
    { field: 'date',     re: /tarih/ },
    { field: 'code',     re: /urun\s*kodu/ },
    { field: 'serial',   re: /urun\s*id/ },
    { field: 'product',  re: /urunler|^urun$/ },
    { field: 'decision', re: /karar/ },
    { field: 'order',    re: /siparis/ },
    { field: 'note',     re: /aciklama/ },
];

export function findExcelHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
        const map = {};
        (rows[r] || []).forEach((cell, idx) => {
            const text = foldTr(String(cell ?? ''));
            if (!text) return;
            for (const { field, re } of XL_HEADERS) {
                if (map[field] !== undefined) continue;
                if (re.test(text)) { map[field] = idx; return; }
            }
        });
        if (map.customer !== undefined && map.date !== undefined && map.code !== undefined) {
            return { headerRow: r, map };
        }
    }
    return null;
}

// Excel tarih hücresi: seri numarası (tercih edilen) ya da Date nesnesi olabilir.
//
// DİKKAT — bir gün kayması: SheetJS'i `cellDates: true` ile okumak tarihleri
// yerel saate çevirirken bir önceki güne kaydırabiliyor (Europe/Istanbul'da
// 13.02.2023 hücresi "Sun Feb 12 2023 23:59:04 GMT+0300" olarak geliyordu ve
// hem yerel hem UTC bileşenleri 12 Şubat veriyordu). Bu yüzden çağıran taraf
// `cellDates` KULLANMAZ; hücre ham seri numarası olarak okunur ve aşağıdaki
// UTC tabanlı formülle çevrilir — saat diliminden bağımsız ve tam doğru.
// Yine de bir Date gelirse en yakın gün başına yuvarlanarak kayma giderilir.
export function excelDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        const shifted = value.getTime() - value.getTimezoneOffset() * 60000;
        return new Date(Math.round(shifted / 86400000) * 86400000).toISOString().slice(0, 10);
    }
    if (typeof value === 'number') {
        const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
        return isNaN(d) ? null : d.toISOString().slice(0, 10);
    }
    const s = String(value).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
}

// Satırları Credit Note gruplarına böler.
//
// "No" sütunu bir grubun her satırında YAZILI DEĞİL (eski kayıtlarda grubun
// yalnızca bir satırında geçiyor), bu yüzden tek başına gruplama anahtarı olamaz.
// Kullanılan kural: müşteri değişince YENİ grup başlar; ayrıca aynı müşteride
// iki farklı No arka arkaya geliyorsa orada da bölünür. Tarih tek başına bölme
// ölçütü DEĞİLDİR — aynı CN'de farklı tarihli satırlar bulunabiliyor (CN 66).
export function groupExcelRows(rows, map) {
    const groups = [];
    let current = null;

    const val = (row, f) => map[f] === undefined ? '' : String(row[map[f]] ?? '').trim();

    for (const row of rows) {
        const customer = val(row, 'customer');
        const noRaw    = val(row, 'no');
        const no       = noRaw === '' ? null : parseInt(noRaw, 10);
        const hasAny   = [...Object.values(map)].some(idx => String(row[idx] ?? '').trim() !== '');
        if (!hasAny) continue;
        if (!customer) continue;

        const customerChanged = !current || current.customer !== customer;
        const noChanged = current && no !== null && current.no !== null && no !== current.no;

        if (customerChanged || noChanged) {
            current = {
                no,
                customer,
                country: val(row, 'country'),
                date: null,
                rows: [],
                noteLines: [],
            };
            groups.push(current);
        }
        if (no !== null && current.no === null) current.no = no;
        if (!current.date) current.date = excelDate(row[map.date]);

        current.rows.push(row);
    }
    return groups;
}
