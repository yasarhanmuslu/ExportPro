// 2026 İdevit Fiyat Kataloğu bölüm sırası — Fiyat Robotu listelemesi bu sıraya göre gruplanır.
//
// price_list.group_name değerleri fiyat çalışması dosyasından geldiği için katalog
// başlıklarından daha detaylıdır (ör. "ALFA KAPAK", "HALLEY KAPAK" → "Klozet Kapakları").
// Burada ham grup adı DEĞİŞTİRİLMEZ; yalnızca hangi katalog başlığı altında ve hangi
// sırada görüneceği çözümlenir. Böylece veritabanı tek doğruluk kaynağı olarak kalır.

// ── Katalog başlıkları (kataloğun içindekiler sırası) ─────────
export const CATALOG_SECTIONS = [
    'Halley Serisi',
    'Alfa Serisi',
    'Nova Serisi',
    'Manta Serisi',
    'Neo Classic Serisi',
    'Rena Serisi',
    'Vega Serisi',
    'Rondo Serisi',
    'Kare Serisi',
    'Gökkuşağı Serisi',
    'Afacan Serisi',
    'Bedensel Engelli Serisi',
    'Dolap Uyumlu Lavabolar',
    'Tezgah Üstü / Dolap Uyumlu Lavabolar',
    'Tezgah Altı Lavabolar',
    'Aksesuarlar',
    'Tek Parçalar',
    'Pisuarlar',
    'Helataşları',
    'Gömme Rezervuarlar',
    'İç Takımlar / Montaj Malzemeleri',
    'Klozet Kapakları',
    'Dekorlu ve Kaplamalı Ürünler',
];

// Katalog dışı / tanınmayan gruplar için ortak başlık.
export const OTHER_SECTION = 'Diğer';

// ── Ham grup adı → katalog başlığı ────────────────────────────
// Dizideki sıra, aynı katalog başlığı altındaki alt grupların sırasını da belirler
// (ör. "Klozet Kapakları" içinde önce MANTA, sonra NOVA... katalog sayfa düzeni gibi).
const GROUP_MAP = [
    ['HALLEY SERİSİ',                         'Halley Serisi'],
    ['ALFA SERİSİ',                           'Alfa Serisi'],
    ['NOVA SERİSİ',                           'Nova Serisi'],
    ['MANTA SERİSİ',                          'Manta Serisi'],
    ['NEOCLASSIC SERİSİ',                     'Neo Classic Serisi'],
    ['NEO CLASSIC SERİSİ',                    'Neo Classic Serisi'],
    ['RENA SERİSİ',                           'Rena Serisi'],
    ['VEGA SERİSİ',                           'Vega Serisi'],
    ['RONDO SERİSİ',                          'Rondo Serisi'],
    ['KARE SERİSİ',                           'Kare Serisi'],
    ['GÖKKUŞAĞI SERİSİ',                      'Gökkuşağı Serisi'],
    ['AFACAN SERİSİ',                         'Afacan Serisi'],
    ['ENGELLİ SERİSİ',                        'Bedensel Engelli Serisi'],
    ['BEDENSEL ENGELLİ SERİSİ',               'Bedensel Engelli Serisi'],

    // Dolap uyumlu lavabolar — katalog s.64-67
    ['VEGA DOLAP UYUMLU LAVABO',              'Dolap Uyumlu Lavabolar'],
    ['MERKÜR DOLAP UYUMLU LAVABO',            'Dolap Uyumlu Lavabolar'],
    ['HERA DOLAP UYUMLU LAVABO',              'Dolap Uyumlu Lavabolar'],

    // Tezgah üstü / dolap uyumlu — katalog s.68-73
    ['TEZGAHÜSTÜ LAVABOLAR',                  'Tezgah Üstü / Dolap Uyumlu Lavabolar'],
    ['TEZGAHÜSTÜ/DOLAP UYUMLU LAVABOLAR',     'Tezgah Üstü / Dolap Uyumlu Lavabolar'],
    ['NEO CLASSİC DOLAP UYUMLU LAVABOLAR',    'Tezgah Üstü / Dolap Uyumlu Lavabolar'],
    ['LARA DOLAP UYUMLU LAVABOLAR',           'Tezgah Üstü / Dolap Uyumlu Lavabolar'],
    ['MYRA TEZGAHÜSTÜ/DOLAP UYUMLU LAVABOLAR','Tezgah Üstü / Dolap Uyumlu Lavabolar'],

    // Tezgah altı — katalog s.74 (Hilton kodları 0001-xxxx)
    ['HİLTON LAVABOLAR',                      'Tezgah Altı Lavabolar'],

    ['AKSESUARLAR',                           'Aksesuarlar'],

    // Tek parçalar — katalog s.76-82 (seri lavaboları ve tek klozetler burada listelenir)
    ['GÖKKUŞAĞI LAVABOLAR',                   'Tek Parçalar'],
    ['NOVA LAVABOLAR',                        'Tek Parçalar'],
    ['RONDO LAVABOLAR',                       'Tek Parçalar'],
    ['HALLEY LAVABOLAR',                      'Tek Parçalar'],
    ['TEK PARÇALAR',                          'Tek Parçalar'],

    ['PİSUARLAR VE ARA BÖLME',                'Pisuarlar'],
    ['HELATAŞLARI',                           'Helataşları'],
    ['GÖMME REZERVUARLAR',                    'Gömme Rezervuarlar'],
    ['İÇ TAKIMLAR',                           'İç Takımlar / Montaj Malzemeleri'],

    // Klozet kapakları — katalog s.94-99
    ['MANTA KAPAK',                           'Klozet Kapakları'],
    ['NOVA KAPAK',                            'Klozet Kapakları'],
    ['NEOCLASSIC KAPAK',                      'Klozet Kapakları'],
    ['ALFA KAPAK',                            'Klozet Kapakları'],
    ['VEGA KAPAK',                            'Klozet Kapakları'],
    ['HALLEY KAPAK',                          'Klozet Kapakları'],
    ['RONDO KAPAK',                           'Klozet Kapakları'],
    ['RENA KAPAK',                            'Klozet Kapakları'],
    ['BEDENSEL ENGELLİ KAPAK',                'Klozet Kapakları'],
    ['KARE KAPAK',                            'Klozet Kapakları'],
    ['GÖKKUŞAĞI KAPAK / BEDENSEL ENGELLİ',    'Klozet Kapakları'],
    ['AFACAN KAPAK',                          'Klozet Kapakları'],

    // Dekorlu ve kaplamalı — katalog s.100+
    ['ALFA KAPLAMA SERİSİ',                   'Dekorlu ve Kaplamalı Ürünler'],
    ['HALLEY KAPLAMA SERİSİ',                 'Dekorlu ve Kaplamalı Ürünler'],
    ['NEOCLASSIC KAPLAMA SERİSİ',             'Dekorlu ve Kaplamalı Ürünler'],
];

// Haritada olmayan / sonradan eklenen grup adları için anahtar kelime kuralları.
// Sıra önemli: "ALFA KAPAK" önce KAPAK kuralına takılmalı, ALFA serisine değil.
const KEYWORD_RULES = [
    [/KAPLAMA|DEKOR/,                'Dekorlu ve Kaplamalı Ürünler'],
    [/KAPAK/,                        'Klozet Kapakları'],
    [/IC TAKIM|MONTAJ/,              'İç Takımlar / Montaj Malzemeleri'],
    [/REZERVUAR/,                    'Gömme Rezervuarlar'],
    [/HELA/,                         'Helataşları'],
    [/PISUAR/,                       'Pisuarlar'],
    [/AKSESUAR/,                     'Aksesuarlar'],
    [/TEK PARCA/,                    'Tek Parçalar'],
    [/TEZGAH ?ALTI|T A LAVABO|HILTON/, 'Tezgah Altı Lavabolar'],
    [/TEZGAH ?USTU/,                 'Tezgah Üstü / Dolap Uyumlu Lavabolar'],
    [/DOLAP UYUMLU/,                 'Dolap Uyumlu Lavabolar'],
    [/BEDENSEL|ENGELLI/,             'Bedensel Engelli Serisi'],
    [/AFACAN|COCUK/,                 'Afacan Serisi'],
    [/GOKKUSAGI/,                    'Gökkuşağı Serisi'],
    [/NEO ?CLASSIC/,                 'Neo Classic Serisi'],
    [/HALLEY/,                       'Halley Serisi'],
    [/ALFA/,                         'Alfa Serisi'],
    [/NOVA/,                         'Nova Serisi'],
    [/MANTA/,                        'Manta Serisi'],
    [/RENA/,                         'Rena Serisi'],
    [/VEGA/,                         'Vega Serisi'],
    [/RONDO/,                        'Rondo Serisi'],
    [/KARE/,                         'Kare Serisi'],
];

// ── Normalizasyon ─────────────────────────────────────────────
// NOT: toUpperCase() Türkçe'de i→I yapar (İ değil). Bu yüzden önce elle katlıyoruz.
// Ayrıca aksanları da sadeleştiriyoruz ki "NEO CLASSİC" ile "NEO CLASSIC" eşleşsin.
const FOLD = { 'Ç': 'C', 'Ğ': 'G', 'İ': 'I', 'Ö': 'O', 'Ş': 'S', 'Ü': 'U' };

function fold(value) {
    return (value || '')
        .toString()
        .replace(/i/g, 'İ')
        .replace(/ı/g, 'I')
        .toUpperCase()
        .replace(/[ÇĞİÖŞÜ]/g, ch => FOLD[ch])
        .replace(/[^0-9A-Z]+/g, ' ')
        .trim();
}

// Boşlukları da atan sıkı anahtar — "TEZGAHÜSTÜ" ile "TEZGAH ÜSTÜ" aynı anahtara düşer.
function tightKey(value) {
    return fold(value).replace(/ /g, '');
}

const GROUP_INDEX = new Map();   // tightKey → { section, order }
GROUP_MAP.forEach(([raw, section], order) => {
    const key = tightKey(raw);
    if (!GROUP_INDEX.has(key)) GROUP_INDEX.set(key, { section, order });
});

const SECTION_INDEX = new Map(CATALOG_SECTIONS.map((s, i) => [s, i]));

// ── Genel API ─────────────────────────────────────────────────

/**
 * Ham grup adını katalog başlığına çözer.
 * @returns {{ section: string, sectionIndex: number, groupOrder: number, known: boolean }}
 *          Tanınmayan gruplar OTHER_SECTION altında, listenin sonunda toplanır.
 */
export function resolveCatalogSection(groupName) {
    const key = tightKey(groupName);
    if (key) {
        const hit = GROUP_INDEX.get(key);
        if (hit) {
            return { section: hit.section, sectionIndex: SECTION_INDEX.get(hit.section), groupOrder: hit.order, known: true };
        }
        const folded = fold(groupName);
        for (const [pattern, section] of KEYWORD_RULES) {
            if (pattern.test(folded)) {
                return { section, sectionIndex: SECTION_INDEX.get(section), groupOrder: GROUP_MAP.length, known: true };
            }
        }
    }
    return { section: OTHER_SECTION, sectionIndex: CATALOG_SECTIONS.length, groupOrder: GROUP_MAP.length, known: false };
}

/** Sadece başlık adı gerektiğinde kısayol. */
export function catalogSectionOf(groupName) {
    return resolveCatalogSection(groupName).section;
}

/**
 * İki grup adını katalog sırasına göre karşılaştırır:
 * önce katalog bölümü, sonra bölüm içi alt grup sırası, en son grup adı (tr).
 */
export function compareCatalogGroups(groupA, groupB) {
    const a = resolveCatalogSection(groupA);
    const b = resolveCatalogSection(groupB);
    if (a.sectionIndex !== b.sectionIndex) return a.sectionIndex - b.sectionIndex;
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    return (groupA || '').localeCompare(groupB || '', 'tr');
}

/** Bir grup adı listesini katalog sırasına göre benzersiz başlık listesine çevirir. */
export function orderedCatalogSections(groupNames) {
    const seen = new Map();
    (groupNames || []).forEach(g => {
        const { section, sectionIndex } = resolveCatalogSection(g);
        if (!seen.has(section)) seen.set(section, sectionIndex);
    });
    return [...seen.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([section]) => section);
}
