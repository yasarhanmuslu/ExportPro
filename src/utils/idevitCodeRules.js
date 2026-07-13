// idevitCodeRules.js — İdevit "Konuşan Kod" doğrulama + üretim kural seti
// Kaynak: Berkant ile 646 kartlık gerçek stok verisinden geri-çözümlenen kural seti (2026-07).
//
// Kural katmanları:
//   ERROR   -> kod/öznitelik deterministik olarak çelişiyor (kayda izin verme)
//   WARNING -> heuristik veya haritası belirsiz eksen (uyar, engelleme)
//
// DÜRÜST SINIR:
//   - Kod<->öznitelik (BB, kalite, renk, dekor) = GARANTİLİ (hard).
//   - Kod<->isim = HEURİSTİK (soft): isimde tür anahtar kelimesi var mı.
//   - AA (seri) ve CCDD = DOĞRULANAMAZ: haritası belirsiz/eksik. Sadece "bilinen
//     değer mi" uyarısı verilir; asla ERROR üretmez.

/* ----------------------------------------------------------------------- *
 * 1) SÖZLÜKLER  (sahada fiilen kullanılan değerler)
 * ----------------------------------------------------------------------- */

const PREFIXES = ['', 'K', 'SET', 'SETK'];   // 'k' küçük harf = HATA, normalize et

// BB (segment1[2:4]) -> izinli ürün türleri
const BB_TO_TURU = {
    '01': ['Lavabo'],
    '02': ['Kolon Ayak'],
    '03': ['Yarım Ayak'],
    '04': ['Klozet', 'Set'],
    '05': ['Rezervuar'],
    '06': ['Bide'],
    '07': ['Pisuar'],
    '08': ['Helataşı'],
    '09': ['Ayak Yıkama'],
    '15': ['Aksesuar', 'Aksesuarlar'],
};

// F (segment4) -> kalite
const F_TO_KALITE = { '1': '1.Kalite', '2': '2.Kalite' };

// EEE[0:2] (renk hanesi) -> renk.  00 hem Beyaz hem Dekorlu taşır; dekor GGGG'de ayrışır.
const RENK2_TO_RENK = {
    '00': ['Beyaz', 'Dekorlu'],
    '07': ['Siyah'],
    '14': ['Mat Siyah'],
    '15': ['Mat Beyaz'],
    '16': ['Mat Gri'],
};

// İsimde aranacak tür anahtar kelimeleri (küçük harf).  Set için özel: "+" işareti.
const TURU_KEYWORD = {
    'Lavabo': ['lavabo'],
    'Klozet': ['klozet'],
    'Bide': ['bide'],
    'Rezervuar': ['rezervuar'],
    'Pisuar': ['pisuar'],
    'Helataşı': ['hela'],
    'Kolon Ayak': ['kolon'],
    'Yarım Ayak': ['yarım'],
    'Ayak Yıkama': ['ayak yıkama'],
    'Set': ['+'],           // set isimleri bileşenleri "+" ile birleştirir
    'Aksesuar': [],         // isim serbest, kontrol yok
    'Aksesuarlar': [],
};

// AA -> baskın seri (SADECE bilgilendirme; doğrulama için kullanılmaz)
const AA_TO_SERI = {
    '00':'Hilton/Tek Parça/Güneş','01':'Tezgah Üstü','02':'Merkür/Hera/Myra',
    '05':'Afacan','06':'Bedensel Engelli','10':'Samanyolu','17':'Gökkuşağı',
    '22':'Bedensel Engelli','28':'Vega','29':'Rena','31':'Alfa','32':'Halley',
    '33':'Neo Classic','35':'Nova','36':'Kare','37':'Rondo','60':'Tezgah Üstü',
    '61':'Mialuce Manta',
};

const KNOWN_AA = new Set(Object.keys(AA_TO_SERI));

// Parça/aksesuar gramerindeki grup önekleri (2-2-2-3 formatı)
const ACC_GROUP = { '50':'İç Takım / Mekanizma', '53':'Kapak / Aksesuar' };

/* ----------------------------------------------------------------------- *
 * 2) PARSER
 * ----------------------------------------------------------------------- */

const RE_MAIN = /^(SETK|SET|K|k)?(\d{2})(\d{2})-(\d{2})(\d{2})-(\d{3})-(\d)-(\d{4})$/;
const RE_ACC  = /^(\d{2})-(\d{2})-(\d{2})-(\d{3})$/;

function parse(codeRaw) {
    const code = String(codeRaw || '').trim();
    let m = code.match(RE_MAIN);
    if (m) {
        return {
            ok: true, format: 'main', code,
            prefix: m[1] || '',
            AA: m[2], BB: m[3],           // segment 1
            CC: m[4], DD: m[5],           // segment 2
            EEE: m[6], renk2: m[6].slice(0, 2), yuzey: m[6].slice(2),
            F: m[7],
            GGGG: m[8], gggg2: m[8].slice(0, 2), decorTail: m[8].slice(2), // son2 "71"=dekor
        };
    }
    m = code.match(RE_ACC);
    if (m) {
        return { ok: true, format: 'accessory', code, a1: m[1], a2: m[2], a3: m[3], seq: m[4] };
    }
    return { ok: false, format: null, code, error: 'FORMAT' };
}

/* ----------------------------------------------------------------------- *
 * 3) YARDIMCILAR
 * ----------------------------------------------------------------------- */

const norm = s => String(s == null ? '' : s).trim();
const lc   = s => norm(s).toLocaleLowerCase('tr-TR');
const eq   = (a, b) => lc(a) === lc(b);

function issue(level, rule, message, hint) {
    return { level, rule, message, hint: hint || null };
}

/* ----------------------------------------------------------------------- *
 * 4) DOĞRULAMA
 *   validate(code, name, attrs)
 *   attrs = { turu, renk, kalite }  (hepsi opsiyonel; verilirse kontrol edilir)
 *   Dönüş: { valid, hasError, issues: [ {level, rule, message, hint} ] }
 * ----------------------------------------------------------------------- */

function validate(codeRaw, name = '', attrs = {}) {
    const issues = [];
    const p = parse(codeRaw);

    /* --- 4.0 FORMAT (hard) --- */
    if (!p.ok) {
        issues.push(issue('ERROR', 'FORMAT',
            'Kod hiçbir bilinen gramere uymuyor.',
            'Beklenen: AABB-CCDD-EEE-F-GGGG (ana) veya AA-BB-CC-DDD (parça).'));
        return finalize(issues);
    }

    /* --- Parça/aksesuar formatı: sınırlı kontrol --- */
    if (p.format === 'accessory') {
        if (!ACC_GROUP[p.a1]) {
            issues.push(issue('WARNING', 'ACC_GROUP',
                `Parça grup öneki "${p.a1}" tanımlı değil (bilinen: 50, 53).`));
        }
        return finalize(issues);
    }

    /* --- 4.1 ÖN EK (hard) --- */
    if (String(codeRaw).trim().startsWith('k')) {
        issues.push(issue('ERROR', 'PREFIX_CASE',
            'Ön ek küçük harf "k" ile başlıyor — büyük "K" olmalı.',
            'ERP sıralama/eşleşmesinde sessiz hataya yol açar. Otomatik düzelt: k → K.'));
    } else if (!PREFIXES.includes(p.prefix)) {
        issues.push(issue('ERROR', 'PREFIX',
            `Geçersiz ön ek "${p.prefix}" (izinli: boş, K, SET, SETK).`));
    }

    /* --- 4.2 BB <-> Ürün Türü (hard, GARANTİLİ) --- */
    const allowedTuru = BB_TO_TURU[p.BB];
    if (!allowedTuru) {
        issues.push(issue('ERROR', 'BB_UNKNOWN',
            `Ürün türü kodu "${p.BB}" tanımlı değil.`));
    } else if (attrs.turu != null && norm(attrs.turu) !== '') {
        const okTuru = allowedTuru.some(t => eq(t, attrs.turu));
        if (!okTuru) {
            issues.push(issue('ERROR', 'BB_TURU',
                `Kod "${p.BB}" = ${allowedTuru.join('/')} diyor; öznitelik "${attrs.turu}".`,
                'Kod ile ürün adı genelde doğru; önce "Ürün Türü" hücresini kontrol et.'));
        }
    }

    /* --- 4.3 F <-> Kalite (hard, GARANTİLİ) --- */
    if (!F_TO_KALITE[p.F]) {
        issues.push(issue('ERROR', 'KALITE_UNKNOWN',
            `Kalite kodu "${p.F}" kullanımda değil (sahada yalnızca 1, 2).`));
    } else if (attrs.kalite != null && norm(attrs.kalite) !== '') {
        if (!eq(F_TO_KALITE[p.F], attrs.kalite)) {
            issues.push(issue('ERROR', 'F_KALITE',
                `Kod kalite "${F_TO_KALITE[p.F]}" diyor; öznitelik "${attrs.kalite}".`));
        }
    }

    /* --- 4.4 RENK + DEKOR (hard, GARANTİLİ) --- */
    const isDecor = p.decorTail === '71';           // GGGG son2 = 71 -> Dekorlu
    const renkList = RENK2_TO_RENK[p.renk2];
    if (!renkList) {
        issues.push(issue('WARNING', 'RENK_UNKNOWN',
            `Renk hanesi "${p.renk2}" bilinen renklere eşlenmiyor (00,07,14,15,16).`));
    } else if (attrs.renk != null && norm(attrs.renk) !== '') {
        if (isDecor) {
            if (!eq(attrs.renk, 'Dekorlu')) {
                issues.push(issue('ERROR', 'DEKOR',
                    `GGGG "…${p.decorTail}" dekor işareti taşıyor; renk "Dekorlu" olmalı, "${attrs.renk}" girilmiş.`));
            }
        } else {
            // dekor değil: renk EEE hanesinden gelmeli (00 -> yalnız Beyaz)
            const expected = p.renk2 === '00' ? ['Beyaz'] : renkList;
            if (!expected.some(r => eq(r, attrs.renk))) {
                issues.push(issue('ERROR', 'RENK',
                    `Kod renk "${expected.join('/')}" diyor; öznitelik "${attrs.renk}".`));
            }
        }
    } else if (isDecor && attrs.renk == null) {
        // bilgi: renk verilmemiş ama kod dekor diyor
        issues.push(issue('WARNING', 'DEKOR_INFO', 'Kod dekorlu ürünü işaret ediyor (GGGG …71).'));
    }

    /* --- 4.5 İSİM <-> Ürün Türü (soft/heuristik) --- */
    const nm = lc(name);
    if (nm !== '') {
        const turuForKw = attrs.turu != null && norm(attrs.turu) !== ''
            ? norm(attrs.turu)
            : (allowedTuru ? allowedTuru[0] : null);
        const kws = turuForKw ? (TURU_KEYWORD[turuForKw] || []) : [];
        if (kws.length && !kws.some(k => nm.includes(k))) {
            issues.push(issue('WARNING', 'NAME_TURU',
                `Ürün adında "${turuForKw}" türünü doğrulayan anahtar kelime bulunamadı.`,
                'Heuristik kontrol; isimlendirme farklıysa yok sayılabilir.'));
        }
    }

    /* --- 4.6 SET tutarlılığı (soft) --- */
    const prefixIsSet = p.prefix === 'SET' || p.prefix === 'SETK';
    const nameLooksSet = nm.includes('+');
    if (prefixIsSet && nm !== '' && !nameLooksSet) {
        issues.push(issue('WARNING', 'SET_NAME',
            'Ön ek SET/SETK ama ürün adı birleşik (set) görünmüyor ("+" yok).'));
    }
    if (!prefixIsSet && eq(attrs.turu, 'Set')) {
        issues.push(issue('WARNING', 'SET_PREFIX',
            'Öznitelik "Set" ama ön ek SET/SETK değil.'));
    }

    /* --- 4.7 AA (seri) — DOĞRULANAMAZ, sadece bilinirlik uyarısı --- */
    if (!KNOWN_AA.has(p.AA)) {
        issues.push(issue('WARNING', 'AA_UNKNOWN',
            `Seri kodu "${p.AA}" bilinen listede yok. Seri eşlemesi doğrulanamaz.`,
            'AA↔seri haritası belirsiz; yeni seri ise sözlüğe eklenmeli.'));
    }

    return finalize(issues);
}

function finalize(issues) {
    const hasError = issues.some(i => i.level === 'ERROR');
    return { valid: !hasError, hasError, issues };
}

/* ----------------------------------------------------------------------- *
 * 5) TERSİNE OKUMA  describe(code) -> kodun "söylediği" insan-okur özet
 * ----------------------------------------------------------------------- */

function describe(codeRaw) {
    const p = parse(codeRaw);
    if (!p.ok) return { ok: false, error: 'FORMAT' };
    if (p.format === 'accessory') {
        return { ok: true, format: 'accessory', grup: ACC_GROUP[p.a1] || '(bilinmiyor)' };
    }
    const isDecor = p.decorTail === '71';
    return {
        ok: true, format: 'main',
        onEk: p.prefix || '(yok)',
        seri: AA_TO_SERI[p.AA] || '(bilinmiyor)',
        turu: (BB_TO_TURU[p.BB] || ['(bilinmiyor)']).join(' / '),
        renk: isDecor ? 'Dekorlu' : ((RENK2_TO_RENK[p.renk2] || ['(bilinmiyor)'])[0]),
        yuzey: p.yuzey === '5' ? 'Mat' : (p.yuzey === '1' ? 'Parlak' : p.yuzey),
        kalite: F_TO_KALITE[p.F] || '(bilinmiyor)',
        set: (p.prefix === 'SET' || p.prefix === 'SETK') || p.gggg2 !== '00',
    };
}

/* ----------------------------------------------------------------------- *
 * 6) ÜRETİM  buildCode(parts) -> özniteliklerden kod kur (tutarsızlık girilemez)
 *    parts = { prefix, AA, BB, CC, DD, renk2, yuzey('1'|'5'), F, GGGG }
 * ----------------------------------------------------------------------- */

function buildCode(parts = {}) {
    const req = ['AA', 'BB', 'CC', 'DD', 'renk2', 'yuzey', 'F', 'GGGG'];
    for (const k of req) {
        if (parts[k] == null || String(parts[k]) === '') {
            return { ok: false, error: `Eksik alan: ${k}` };
        }
    }
    const pre = parts.prefix || '';
    if (!PREFIXES.includes(pre)) return { ok: false, error: `Geçersiz ön ek: ${pre}` };
    if (!BB_TO_TURU[parts.BB])   return { ok: false, error: `Geçersiz tür kodu: ${parts.BB}` };
    if (!F_TO_KALITE[parts.F])   return { ok: false, error: `Geçersiz kalite: ${parts.F}` };
    const pad = (v, n) => String(v).padStart(n, '0').slice(-n);
    const code = `${pre}${pad(parts.AA,2)}${pad(parts.BB,2)}-${pad(parts.CC,2)}${pad(parts.DD,2)}-${pad(parts.renk2,2)}${parts.yuzey}-${parts.F}-${pad(parts.GGGG,4)}`;
    // kendi ürettiğini doğrula (savunma)
    const v = validate(code);
    return { ok: !v.hasError, code, issues: v.issues };
}

export const IdevitCode = {
    parse, validate, describe, buildCode,
    DICT: { PREFIXES, BB_TO_TURU, F_TO_KALITE, RENK2_TO_RENK, AA_TO_SERI, ACC_GROUP },
};
