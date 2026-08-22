// proformaPdf.js — Proforma fatura PDF'i okuma + ürün kartı tutarlılık kontrolü
//
// Teklif (quotations) ve Sipariş (orders) modüllerinin ikisi de proforma PDF'inden kalem
// içe aktarıyor. Kod iki dosyada kopyalanmış olduğu için zamanla ayrıştı (renk kontrolü
// yalnızca siparişlere eklenmişti). Tek kaynak burası: her iki modül de bu dosyayı kullanır.
//
// ── NEDEN SÜTUN KOORDİNATI ───────────────────────────────────────────────────
// PDF metni satır satır düzleştirildiğinde tablo hücreleri satır sınırlarına yayılıyor.
// Gerçek bir örnek (TEHNOMARKET 2026-04) — DELİK sütunu üç ayrı satıra bölünmüş:
//
//     y=1050   ...Wall Hung WC Pan Rimless +          Without      <- kalem satırının ÜSTÜ
//     y=1044   SETK3204-2615-001-1-6000 ...  White    ...          <- kalem satırı
//     y=997    ...Seat Cover                          Bidet Hole   <- kalem satırının ALTI
//
// Düz metinde kalem satırında "Without Bidet Hole" diye bir şey YOK; bu yüzden delik
// kontrolü satır bazlı regex ile yapılamaz. Sütunlar ancak x koordinatı ile ayrılabilir:
// başlık satırından (COLOUR | HOLE | QUANTITY ...) sütun bantları çıkarılır, her hücre en çok
// örtüştüğü banda atanır, sonra en yakın kalem satırına bağlanır.

import { IdevitCode } from './idevitCodeRules.js';

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 0) SAYI
 * ═══════════════════════════════════════════════════════════════════════════ */

export function parseTurkishFloat(value) {
    if (!value) return 0;
    let clean = value.toString().trim();
    if (clean.includes('.') && clean.includes(',')) clean = clean.replace(/\./g, '').replace(/,/g, '.');
    else if (clean.includes(',')) clean = clean.replace(/,/g, '.');
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 1) SAYFA → SATIR + HÜCRE MODELİ
 * ═══════════════════════════════════════════════════════════════════════════ */

// Aynı satırda bu kadar x boşluğu = farklı tablo sütunu.
const COL_GAP = 20;

// Bir sayfanın metin parçalarını satırlara böler.
//   row.text  : düzleştirilmiş satır — büyük boşluklar '\t', normal kelime boşlukları ' '.
//               (Kalem/toplam regex'leri bunun üzerinde çalışır; biçimi bilerek korunuyor.)
//   row.cells : x aralığı bilinen hücreler — sütun eşleştirmesi bunun üzerinden yapılır.
// Boş (yalnız boşluk) parçalar row.text'e dahildir ama hücre sınırı hesabında yok sayılır:
// PDF'ler sütun aralarını boş metin parçalarıyla dolduruyor, bunlar hücreleri yapıştırırdı.
function buildRows(textItems) {
    const tolY = 2;
    const groups = new Map();
    for (const item of textItems) {
        const y = item.transform[5];
        let key = null;
        for (const k of groups.keys()) {
            if (Math.abs(k - y) <= tolY) { key = k; break; }
        }
        if (key === null) key = y;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }

    const rows = [];
    for (const k of Array.from(groups.keys()).sort((a, b) => b - a)) {
        const rowItems = groups.get(k).slice().sort((a, b) => a.transform[4] - b.transform[4]);

        let line = '';
        let lastEndX = null;
        const cells = [];
        let cell = null;

        for (const it of rowItems) {
            const x = it.transform[4];
            const endX = x + (it.width || 0);

            if (lastEndX !== null) {
                const gap = x - lastEndX;
                if (gap > COL_GAP) line += '\t';
                else if (gap > 1) line += ' ';
            }
            line += it.str;
            lastEndX = endX;

            if (!it.str.trim()) continue;
            if (cell && x - cell.x1 > COL_GAP) { cells.push(cell); cell = null; }
            if (!cell) cell = { x0: x, x1: endX, text: it.str };
            else { cell.text += (x - cell.x1 > 1 ? ' ' : '') + it.str; cell.x1 = endX; }
        }
        if (cell) cells.push(cell);

        rows.push({
            y: k,
            text: line.trim(),
            cells: cells.map(c => ({ x0: c.x0, x1: c.x1, text: c.text.trim() })).filter(c => c.text),
        });
    }
    return rows;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 2) SÜTUN MODELİ
 * ═══════════════════════════════════════════════════════════════════════════ */

// Başlık hücresi → sütun anahtarı. Sıra önemli: "PRODUCT CODE" başlığı "PRODUCT" (ürün tipi)
// kuralından önce denenmeli. Türkçe ve İngilizce şablonların ikisi de destekleniyor.
const COLUMN_DEFS = [
    { key: 'code',        re: /(PRODUCT\s*CODE|[ÜU]R[ÜU]N\s*KODU|STOK\s*KODU)/i },
    { key: 'description', re: /(DESCRIPTION|TANIM|A[ÇC]IKLAMA)/i },
    { key: 'color',       re: /^(COLOU?R|RENK)\b/i },
    { key: 'hole',        re: /^(HOLE|DEL[İI]K)\b/i },
    { key: 'quantity',    re: /^(QUANTITY|QTY|ADET|M[İI]KTAR)\b/i },
    { key: 'series',      re: /^(SERIES?|SER[İI])\b/i },
    { key: 'productType', re: /^(PRODUCT|[ÜU]R[ÜU]N)\b/i },
];

function headerHasColumn(cells, key) {
    const def = COLUMN_DEFS.find(d => d.key === key);
    return cells.some(c => def.re.test(c.text));
}

// Tablo başlığı: RENK ve DELİK başlıklarının ikisini birden taşıyan satır. İkisi birden
// yoksa sütun modeli kurulmaz (bu şablonda delik sütunu yok demektir) ve delik kontrolü
// sessizce atlanır — yanlış uyarı üretmektense kontrol etmemek tercih edilir.
function buildColumnModel(rows) {
    const header = rows.find(r =>
        r.cells.length >= 4 && headerHasColumn(r.cells, 'color') && headerHasColumn(r.cells, 'hole'));
    if (!header) return null;

    // Bant sınırları BÜTÜN başlık hücrelerinden hesaplanır (tanımadıklarımız da ayırıcıdır).
    const cells = header.cells;
    const bands = cells.map((c, i) => ({
        left:  i === 0 ? -Infinity : (cells[i - 1].x1 + c.x0) / 2,
        right: i === cells.length - 1 ? Infinity : (c.x1 + cells[i + 1].x0) / 2,
    }));

    const columns = {};
    cells.forEach((c, i) => {
        const def = COLUMN_DEFS.find(d => !columns[d.key] && d.re.test(c.text));
        if (def) columns[def.key] = bands[i];
    });

    return { headerY: header.y, columns };
}

// Hücreyi en çok örtüştüğü sütuna atar. Uzun ürün tanımları komşu sütunun içine taşabildiği
// için "başlangıç x'i" veya "orta nokta" değil, örtüşme uzunluğu ölçülür.
function columnOfCell(cell, columns) {
    let best = null;
    for (const [key, band] of Object.entries(columns)) {
        const overlap = Math.min(cell.x1, band.right) - Math.max(cell.x0, band.left);
        if (overlap > 0 && (!best || overlap > best.overlap)) best = { key, overlap };
    }
    return best ? best.key : null;
}

// Bir hücrenin bir kaleme bağlanabileceği en büyük dikey mesafe: iki kalem satırı arasındaki
// en dar boşluğun yarısı. Böylece başlık satırı ve TOTAL satırı kendiliğinden kapsam dışında
// kalır (ikisi de kalem satırlarına bu mesafeden uzaktır).
function maxRowDistance(itemYs, rows) {
    if (itemYs.length >= 2) {
        let minGap = Infinity;
        for (let i = 1; i < itemYs.length; i++) minGap = Math.min(minGap, Math.abs(itemYs[i - 1] - itemYs[i]));
        return minGap / 2;
    }
    // Tek kalemli proforma: satır aralığının 3 katı kadar yukarı/aşağı bakılır.
    const steps = [];
    for (let i = 1; i < rows.length; i++) steps.push(Math.abs(rows[i - 1].y - rows[i].y));
    steps.sort((a, b) => a - b);
    const median = steps.length ? steps[Math.floor(steps.length / 2)] : 10;
    return Math.max(3 * median, 12);
}

// Sayfadaki her kalem satırı için, istenen sütunun (renk/delik/seri) hücre metnini toplar.
// Bir hücre en yakın kalem satırına bağlanır; satırlar yukarıdan aşağıya işlendiğinden
// çok satıra bölünmüş değerler doğru sırada birleşir ("Without" + "Bidet Hole").
function collectColumnText(rows, itemYs, model, key) {
    const parts = new Map(itemYs.map(y => [y, []]));
    const band = model.columns[key];
    const result = new Map();
    if (!band) {
        itemYs.forEach(y => result.set(y, ''));
        return result;
    }

    const maxDist = maxRowDistance(itemYs, rows);

    for (const row of rows) {
        if (row.y >= model.headerY - 1) continue;   // başlık satırı ve üstü tabloya dahil değil

        let nearest = null;
        for (const y of itemYs) {
            const d = Math.abs(row.y - y);
            if (!nearest || d < nearest.d) nearest = { y, d };
        }
        if (!nearest || nearest.d > maxDist) continue;

        for (const cell of row.cells) {
            if (columnOfCell(cell, model.columns) === key) parts.get(nearest.y).push(cell.text);
        }
    }

    for (const [y, list] of parts) result.set(y, list.join(' ').replace(/\s+/g, ' ').trim());
    return result;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 3) BAŞLIK ALANLARI (PI NO / TARİH / TOPLAM / DÖVİZ)
 * ═══════════════════════════════════════════════════════════════════════════ */

// Genel toplam satırını bulur — örn: "EX-WORKS / ISTANBUL : 5.086,80 EUR".
// Etiket (Incoterm) sabit kodlanmaz: önce "DELIVERY TERMS :" (İngilizce) veya "TESLİM ŞEKLİ :"
// (Türkçe) değeri okunur (örn. "EX-WORKS / ISTANBUL"), sonra aynı metnin ": <tutar> <para birimi>"
// ile tekrar geçtiği hücre aranır (bu, teslim şekli ne olursa olsun çalışır).
function extractTotalAmount(fullText) {
    const termMatch =
        fullText.match(/DE+LIVERY\s*TERMS\s*:\s*([^\t\n]+?)\s*(?:\t|\n|$)/i) ||
        fullText.match(/TESL[İIiı]M\s*ŞEKL[İIiı]\s*:\s*([^\t\n]+?)\s*(?:\t|\n|$)/i);
    if (!termMatch) return null;
    const term = termMatch[1].trim();
    if (!term) return null;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const totalRe = new RegExp(escaped + '\\s*:\\s*([\\d.,]+)\\s*([A-Z]{2,3})?', 'i');
    const totalMatch = fullText.match(totalRe);
    if (!totalMatch) return null;
    return { amount: parseTurkishFloat(totalMatch[1]), currency: totalMatch[2] || null };
}

// Proformanın döviz cinsi. Önce genel toplam satırının yanındaki kod okunur ("15.212,50 USD");
// bazı şablonlarda toplamın yanında kod yerine yalnızca sembol yazıldığından, kod okunamazsa
// metindeki para birimi sembolleri sayılır ve en çok geçen sembolün kodu alınır (kalem
// satırlarındaki NET FİYAT / TUTAR sütunları sembolle yazılıyor: "118,00 $").
// Hiçbiri bulunamazsa null döner ve formdaki döviz alanına dokunulmaz.
const PDF_CURRENCY_BY_SYMBOL = { '€': 'EUR', '$': 'USD', '₺': 'TRY', '£': 'GBP' };
const PDF_CURRENCY_BY_CODE   = { EUR: 'EUR', USD: 'USD', TRY: 'TRY', GBP: 'GBP', TL: 'TRY' };

function resolvePdfCurrency(fullText, totalCurrencyCode) {
    // Toplam satırındaki kod her zaman para birimi olmayabilir (şablona göre yanına başka
    // bir kelime gelebiliyor), bu yüzden yalnızca tanınan kodlar kabul edilir.
    const code = PDF_CURRENCY_BY_CODE[(totalCurrencyCode || '').trim().toUpperCase()];
    if (code) return code;

    const counts = {};
    for (const ch of fullText) {
        const cur = PDF_CURRENCY_BY_SYMBOL[ch];
        if (cur) counts[cur] = (counts[cur] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
}

function piDateToIso(str) {
    const parts = str.split('.');
    if (parts.length !== 3) return null;
    let [d, mo, y] = parts;
    if (y.length === 2) y = '20' + y;
    d = d.padStart(2, '0');
    mo = mo.padStart(2, '0');
    return `${y}-${mo}-${d}`;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 4) KALEM SATIRI
 * ═══════════════════════════════════════════════════════════════════════════ */

// Satır formatı: <...> <ÜRÜN KODU> <AÇIKLAMA> <ADET> pcs./ad./adet <PALET (opsiyonel)> <NET FİYAT><para birimi> <TUTAR><para birimi>
// Palet sütunu her proforma şablonunda yok (bazı siparişler paletsiz) — bu yüzden opsiyonel.
// Değeri (tam sayı, "2,0" gibi ondalık, ya da bomboş sütun için tek başına "-") hiç kullanılmıyor,
// sadece atlanıyor: bu modülde palet hesabı kapsam dışı.
// Ürün kodu ya bizim standart tireli formatımız (SETK3104-2615-165-1-6000, 53-01-04-031) ya da
// tireli olmayan tek parça bir kod (örn. tedarikçiden alınıp tek seferlik satılan bir ürünün kodu,
// TM00415 gibi — büyük harf + rakam, boşluksuz) olabilir.
// Satır sonunda ($) durmuyor: bazı şablonlarda TUTAR'dan sonra Net/Gross Weight, Palet Ölçüleri gibi
// ek sütunlar aynı satırda devam ediyor — TUTAR'ı yakalayınca durmak yeterli, satırın gerisini görmezden gel.
// Bazı şablonlarda NET FİYAT'tan önce LİSTE FİYATI + İSKONTO % sütunları da var
// (örn. "278,00 € 76,00% 66,72 € 400,32 €" → liste fiyatı, iskonto, NET FİYAT, TUTAR).
// İskonto her zaman "%" ile bitişik yazıldığından bu iki fazladan sütun, sadece bu şablonlarda
// devreye giren opsiyonel bir blokla atlanıyor — NET FİYAT ve TUTAR her zaman doğru yakalanıyor.
const PDF_ITEM_LINE_RE = /((?:[A-Za-z0-9]+\s*-\s*){2,}[A-Za-z0-9]+|\b[A-Z]{2,8}\d{2,8}\b)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:pcs|ad|adet)\.?\s+(?:(?:\d+(?:[.,]\d+)?|-)\s+)?(?:[\d.,]+\s*\S{0,2}\s+[\d.,]+%\s+)?([\d.,]+)\s*\S{0,2}\s+([\d.,]+)\s*\S{0,2}/gim;

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 5) RENK SÖZLÜĞÜ
 * ═══════════════════════════════════════════════════════════════════════════ */

// İngilizce proformalarda RENK sütunu "COLOUR" başlığıyla geliyor ve değerleri de İngilizce
// yazılıyor ("White", "Matt Black"). Değerlerin ürün kartındaki Türkçe renklerle
// karşılaştırılabilmesi için karşılığına çevrilmesi gerekiyor. Arşivdeki İngilizce
// proformalarda fiilen "Mat"/"Matt" yazımlarının ikisi de kullanıldığından her iki biçim de listede.
// Belirsiz değerler bilerek listeye ALINMADI — ör. tek başına "Chrome", ürün kartındaki
// "Mat Krom" mu "Parlak Krom" mu olduğunu söylemiyor. Listede olmayan değer yakalanmaz,
// kontrol sessizce atlanır: yanlış uyarı üretmektense kontrol etmemek tercih edildi.
const COLOR_SYNONYMS_EN = {
    'white': 'beyaz',
    'black': 'siyah',
    'mat black':  'mat siyah',  'matt black':  'mat siyah',
    'mat white':  'mat beyaz',  'matt white':  'mat beyaz',
    'mat grey':   'mat gri',    'matt grey':   'mat gri',
    'mat gray':   'mat gri',    'matt gray':   'mat gri',
    'mat chrome': 'mat krom',   'matt chrome': 'mat krom',
    'bright chrome': 'parlak krom', 'polished chrome': 'parlak krom',
    'gold plated':     'altın kaplama',  'gold decor':     'altın dekor',
    'platinum plated': 'platin kaplama', 'platinum decor': 'platin dekor',
    'decor': 'dekorlu', 'decorated': 'dekorlu',
};

// Renkleri karşılaştırılabilir tek bir biçime indirger; İngilizce değerler Türkçe karşılığına
// çevrilir. Türkçe küçültme ("I"->"ı") İngilizce kelimeleri bozduğundan ("WHITE"->"whıte"),
// eş anlamlı araması hem düz hem Türkçe küçültülmüş biçimle yapılır.
export function normalizeColor(value) {
    const raw = (value || '').toString().trim().replace(/\s+/g, ' ');
    const tr  = raw.toLocaleLowerCase('tr-TR');
    const en  = raw.toLowerCase();
    return COLOR_SYNONYMS_EN[en] || COLOR_SYNONYMS_EN[tr] || tr;
}

// Bilinen renk adları sözlüğü. İki kaynaktan kurulur:
//   1) Kod kuralları (RENK2_TO_RENK / PLATING_GGGG) — kod hanesinden türetilebilen renkler,
//   2) Ürün kartlarındaki mevcut renkler — "Mat Krom" gibi aksesuar renkleri kod hanesinden
//      türetilemediği için yalnızca burada bulunur.
function buildKnownColorSet(products) {
    const set = new Set();
    const add = v => { const n = normalizeColor(v); if (n) set.add(n); };
    Object.values(IdevitCode.DICT.RENK2_TO_RENK).forEach(list => list.forEach(add));
    Object.values(IdevitCode.DICT.PLATING_GGGG).forEach(map => Object.values(map).forEach(add));
    (products || []).forEach(p => add(p.renk));
    return set;
}

// Metindeki kelime öbeklerinden bilinen bir renk adı ayıklar. Tablo sütun sırası
// ÜRÜN TANIMI | RENK | DELİK olduğundan EN SAĞDAKİ eşleşme alınır — böylece ürün tanımında
// renk kelimesi geçse bile RENK sütunu kazanır. Eşit konumda en uzun eşleşme öncelikli
// ("Mat Siyah", "Siyah"a tercih edilir). Hiç renk bulunmazsa null döner.
function extractKnownColor(segment, knownColors) {
    const tokens = (segment || '').split(/\s+/).filter(Boolean);
    let best = null;
    for (let start = 0; start < tokens.length; start++) {
        for (let end = start + 1; end <= Math.min(start + 4, tokens.length); end++) {
            const phrase = tokens.slice(start, end).join(' ');
            if (!knownColors.has(normalizeColor(phrase))) continue;
            const better = !best || end > best.end || (end === best.end && start < best.start);
            if (better) best = { start, end, phrase };
        }
    }
    return best ? best.phrase : null;
}

// Kalemin "olması gereken" rengi: önce ürün kartı (aksesuar kodlarını da kapsar),
// kart yoksa ya da rengi boşsa kodun renk hanesinden türetilir.
function resolveExpectedColor(code, prod) {
    if (prod && (prod.renk || '').trim()) return { color: prod.renk.trim(), source: 'Ürün kartı' };
    const d = IdevitCode.describe(code);
    if (d.ok && d.format === 'main' && d.renk && d.renk !== '(bilinmiyor)') {
        return { color: d.renk, source: 'Ürün kodu' };
    }
    return null;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 6) DELİK (TAHARET / ARMATÜR) SÖZLÜĞÜ
 * ═══════════════════════════════════════════════════════════════════════════ */

// Ürün kartındaki fonksiyon alanlarının sözlüğü. Sahadaki 654 kartın tamamında:
//   fonksiyon_2 = klozet taharet deliği  (Kanallı/Kanalsız + Delikli/Deliksiz)
//   fonksiyon_3 = lavabo armatür deliği  (Delikli / Deliksiz / Sağdan Delikli / Soldan Delikli)
// Değerler iki alan arasında hiç karışmadığı için hangi slotta olduğuna bakılmaksızın
// yalnızca değere göre eşleştirmek güvenli.
const FONKSIYON_HOLE_RULES = [
    { values: ['kanalsız delikli', 'kanallı delikli'],         kind: 'taharet', hasHole: true  },
    { values: ['kanalsız deliksiz', 'kanallı deliksiz'],       kind: 'taharet', hasHole: false },
    { values: ['delikli', 'sağdan delikli', 'soldan delikli'], kind: 'armatur', hasHole: true  },
    { values: ['deliksiz'],                                    kind: 'armatur', hasHole: false },
];

const HOLE_KIND_LABEL = { taharet: 'Taharet', armatur: 'Armatür' };

export function holeLabel(hole) {
    if (!hole) return '';
    const suffix = hole.hasHole ? 'Delikli' : 'Deliksiz';
    return hole.kind ? `${HOLE_KIND_LABEL[hole.kind]} ${suffix}` : suffix;
}

// Ürün kartının fonksiyon_1/2/3 alanlarından delik bilgisini çıkarır.
export function resolveProductHole(product) {
    if (!product) return null;
    for (const raw of [product.fonksiyon_1, product.fonksiyon_2, product.fonksiyon_3]) {
        if (!raw) continue;
        const norm = raw.trim().toLocaleLowerCase('tr-TR');
        const rule = FONKSIYON_HOLE_RULES.find(r => r.values.includes(norm));
        if (rule) return { kind: rule.kind, hasHole: rule.hasHole };
    }
    return null;
}

// Müşteriye gönderilen proformalarda kullanılan sadeleştirilmiş Türkçe "Fonksiyon" etiketi.
export function resolveFonksiyonLabel(product) {
    return holeLabel(resolveProductHole(product));
}

// PDF'in DELİK sütunundaki metni çözer. Hem İngilizce ("Without Bidet Hole", "With Mixer Hole")
// hem Türkçe ("Taharet Deliksiz", "Armatür Delikli", tek başına "Delikli") şablonlar desteklenir.
// Var/yok bilgisi okunamıyorsa null döner ve kontrol sessizce atlanır.
export function parsePdfHole(value) {
    const raw = (value || '').toString().trim();
    if (!raw) return null;
    const tr = ' ' + raw.toLocaleLowerCase('tr-TR').replace(/[^0-9a-zçğıöşü]+/gi, ' ').trim() + ' ';
    const en = ' ' + raw.toLowerCase().replace(/[^0-9a-z]+/gi, ' ').trim() + ' ';

    let hasHole = null;
    if (/ deliksiz /.test(tr) || / without /.test(en) || / no /.test(en)) hasHole = false;
    else if (/ delikli /.test(tr) || / with /.test(en)) hasHole = true;
    if (hasHole === null) return null;

    let kind = null;
    if (/ (bidet|shattaf) /.test(en) || / (taharet|kanallı|kanalsız) /.test(tr)) kind = 'taharet';
    else if (/ (mixer|tap|faucet) /.test(en) || / (armatür|batarya) /.test(tr)) kind = 'armatur';

    return { kind, hasHole };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 7) SERİ SÖZLÜĞÜ
 * ═══════════════════════════════════════════════════════════════════════════ */

// Ürün kartlarındaki seri adları ("Halley", "Vega", "Alfa/Halley/Nova" gibi çoklu değerler
// '/' ile ayrılır). PDF'in SERIE NAME sütunundaki değer bu sözlükte YOKSA kontrol atlanır —
// İngilizce yazılmış ya da yeni bir seri adına yanlış uyarı verilmesin.
function buildKnownSeriesSet(products) {
    const set = new Set();
    for (const p of products || []) {
        for (const part of String(p.seri_adi || '').split('/')) {
            const n = part.trim().toLocaleLowerCase('tr-TR');
            if (n) set.add(n);
        }
    }
    return set;
}

function extractKnownSeries(segment, knownSeries) {
    const tokens = (segment || '').split(/\s+/).filter(Boolean);
    for (let len = Math.min(3, tokens.length); len >= 1; len--) {
        for (let start = 0; start + len <= tokens.length; start++) {
            const phrase = tokens.slice(start, start + len).join(' ');
            if (knownSeries.has(phrase.toLocaleLowerCase('tr-TR'))) return phrase;
        }
    }
    return null;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 8) ANA GİRİŞ — PDF'İ OKU
 * ═══════════════════════════════════════════════════════════════════════════ */

export async function parseProformaPdf(arrayBuffer, products = []) {
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        pages.push(buildRows(content.items));
    }

    // Tüm sayfaların satırları tek dizide; fullText satır bazlı regex'lerin beklediği biçimde.
    const allRows = pages.flat();
    const fullText = allRows.map(r => r.text).join('\n') + '\n';
    const pageOfRow = new Map();
    pages.forEach((rows, i) => rows.forEach(r => pageOfRow.set(r, i)));

    const knownColors = buildKnownColorSet(products);
    const knownSeries = buildKnownSeriesSet(products);

    // Kalem satırları — eşleşmenin BAŞLADIĞI satır, kalemin tablo satırıdır.
    const matches = [];
    let m;
    PDF_ITEM_LINE_RE.lastIndex = 0;
    while ((m = PDF_ITEM_LINE_RE.exec(fullText)) !== null) {
        const lineIdx = (fullText.slice(0, m.index).match(/\n/g) || []).length;
        matches.push({ m, row: allRows[lineIdx] || null });
    }

    // Sütun değerleri sayfa sayfa toplanır (her sayfanın kendi başlığı ve koordinatları var).
    const colText = { color: new Map(), hole: new Map(), series: new Map() };
    pages.forEach((rows, pageIdx) => {
        const itemRows = matches.filter(x => x.row && pageOfRow.get(x.row) === pageIdx).map(x => x.row);
        if (itemRows.length === 0) return;
        const model = buildColumnModel(rows);
        if (!model) return;
        const ys = itemRows.map(r => r.y);
        for (const key of ['color', 'hole', 'series']) {
            const byY = collectColumnText(rows, ys, model, key);
            for (const row of itemRows) colText[key].set(row, byY.get(row.y) || '');
        }
    });

    const items = matches.map(({ m, row }) => {
        const segment = m[2];
        // RENK: önce sütun hücresi (kesin konum), oradan bilinen bir renk çıkmazsa eski
        // davranışa dön ve ürün tanımı metnini tara.
        const colorCell = row ? colText.color.get(row) : null;
        return {
            code: m[1].replace(/\s+/g, ''),
            // Boş RENK/DELİK sütunları için PDF'de bırakılan "-" işaretleri satır sonunda kalabiliyor.
            description: segment.trim().replace(/(?:\s+-)+$/, '').trim(),
            color: extractKnownColor(colorCell, knownColors) || extractKnownColor(segment, knownColors),
            hole: (row ? colText.hole.get(row) : '') || null,
            series: extractKnownSeries(row ? colText.series.get(row) : '', knownSeries),
            quantity: parseTurkishFloat(m[3]),
            netPrice: parseTurkishFloat(m[4]),
            amount: parseTurkishFloat(m[5]),
        };
    });

    const piNoMatch   = fullText.match(/PI\s*NO\s*:?\s*([0-9]{2,4}-[0-9]{1,4})/i);
    const piDateMatch = fullText.match(/PI\s*DATE\s*:?\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})/i);
    const total       = extractTotalAmount(fullText);

    return {
        piNo: piNoMatch ? piNoMatch[1] : null,
        piDate: piDateMatch ? piDateToIso(piDateMatch[1]) : null,
        totalAmount: total ? total.amount : null,
        currency: resolvePdfCurrency(fullText, total ? total.currency : null),
        items,
    };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 9) TUTARLILIK KONTROLÜ
 * ═══════════════════════════════════════════════════════════════════════════ */

// PDF'in bilgi sütunlarını (RENK / DELİK / SERİ) sistemdeki ürün bilgisiyle karşılaştırır.
// Proformaya yanlış ürün kodu yazıldığında kodun anlattığı ürün ile satırda yazan tarif
// birbirini tutmaz; yakalanan her fark burada raporlanır.
//
// Karşılaştırılamayan hiçbir şey uyarı üretmez (PDF sütunu boş, ürün kartı yok, değer
// sözlükte yok): yanlış uyarı, uyarı vermemekten daha zararlı.
export function findItemMismatches(items, productByCode) {
    const out = [];

    for (const it of items) {
        const prod = productByCode.get(it.code) || null;

        // ── RENK ──
        if (it.color) {
            const expected = resolveExpectedColor(it.code, prod);
            if (expected && normalizeColor(expected.color) !== normalizeColor(it.color)) {
                out.push({ code: it.code, field: 'RENK', pdfValue: it.color, expected: expected.color, source: expected.source });
            }
        }

        // ── DELİK (taharet / armatür) ──
        const pdfHole  = parsePdfHole(it.hole);
        const cardHole = resolveProductHole(prod);
        if (pdfHole && cardHole) {
            const kindClash = pdfHole.kind && cardHole.kind && pdfHole.kind !== cardHole.kind;
            if (kindClash || pdfHole.hasHole !== cardHole.hasHole) {
                out.push({
                    code: it.code, field: 'DELİK',
                    pdfValue: `${it.hole.trim()} (${holeLabel(pdfHole)})`,
                    expected: holeLabel(cardHole), source: 'Ürün kartı',
                });
            }
        }

        // ── SERİ ──
        if (it.series && prod) {
            const cardSeries = String(prod.seri_adi || '').split('/').map(s => s.trim()).filter(Boolean);
            const pdfSeries  = it.series.toLocaleLowerCase('tr-TR');
            if (cardSeries.length && !cardSeries.some(s => s.toLocaleLowerCase('tr-TR') === pdfSeries)) {
                out.push({ code: it.code, field: 'SERİ', pdfValue: it.series, expected: cardSeries.join(' / '), source: 'Ürün kartı' });
            }
        }
    }

    return out;
}

// Uyarı diyaloğunun gövdesi — kalem kalem gruplanmış fark listesi.
export function formatMismatchList(mismatches) {
    const byCode = new Map();
    for (const mm of mismatches) {
        if (!byCode.has(mm.code)) byCode.set(mm.code, []);
        byCode.get(mm.code).push(mm);
    }
    return Array.from(byCode.entries()).map(([code, list]) =>
        `• ${code}\n` + list.map(mm =>
            `    ${mm.field} — PDF'de: "${mm.pdfValue}"  ≠  ${mm.source}: "${mm.expected}"`
        ).join('\n')
    ).join('\n');
}
