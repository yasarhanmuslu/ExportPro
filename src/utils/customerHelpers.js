// customerHelpers.js — customers.js'in sayfa yan etkilerinden (DOMContentLoaded bootstrap)
// bağımsız, saf/paylaşılabilir yardımcılar. Birden fazla sayfa (customers.js, call-rotation.js, ...)
// bu dosyadan import eder; customers.js'i doğrudan import etmeyin — o bir sayfa script'idir.

export const REGION_MAP = {
    // AVRUPA
    'ALMANYA': 'Avrupa', 'ARNAVUTLUK': 'Avrupa', 'AVUSTRALYA': 'Avrupa',
    'AVUSTURYA': 'Avrupa', 'BOSNA HERSEK': 'Avrupa',
    'BULGARİSTAN': 'Avrupa', 'ÇEKYA': 'Avrupa', 'ESTONYA': 'Avrupa',
    'FRANSA': 'Avrupa', 'HIRVATİSTAN': 'Avrupa', 'İNGİLTERE': 'Avrupa',
    'İTALYA': 'Avrupa', 'KARADAĞ': 'Avrupa', 'KOSOVA': 'Avrupa',
    'LİTVANYA': 'Avrupa', 'MACARİSTAN': 'Avrupa', 'MAKEDONYA': 'Avrupa',
    'MOLDOVA': 'Avrupa', 'ROMANYA': 'Avrupa', 'SIRBİSTAN': 'Avrupa',
    'YUNANİSTAN': 'Avrupa',
    // ASYA
    'AZERBAYCAN': 'Asya', 'GÜRCİSTAN': 'Asya', 'TÜRKİYE': 'Asya',
    'TÜRKMENİSTAN': 'Asya', 'KIBRIS': 'Asya', 'RUSYA': 'Asya',
    'BANGLADEŞ': 'Asya', 'HİNDİSTAN': 'Asya', 'PAKİSTAN': 'Asya',
    // ORTA DOĞU
    'B.A.E': 'Orta Doğu', 'BAHREYN': 'Orta Doğu',
    'FİLİSTİN': 'Orta Doğu', 'IRAK': 'Orta Doğu',
    'İRAN': 'Orta Doğu', 'İSRAİL': 'Orta Doğu',
    'KATAR': 'Orta Doğu', 'KUVEYT': 'Orta Doğu', 'LÜBNAN': 'Orta Doğu',
    'SUUDİ ARABİSTAN': 'Orta Doğu', 'UMMAN': 'Orta Doğu', 'ÜRDÜN': 'Orta Doğu',
    // AFRİKA
    'CEZAYİR': 'Afrika', 'ETİYOPYA': 'Afrika', 'FAS': 'Afrika',
    'FİLDİŞİ SAHİLİ': 'Afrika', 'GANA': 'Afrika', 'GİNE': 'Afrika',
    'KAMERUN': 'Afrika', 'LİBYA': 'Afrika',
    'MAURİTİUS': 'Afrika', 'MISIR': 'Afrika', 'NİJERYA': 'Afrika',
    'SENEGAL': 'Afrika', 'SOMALİ': 'Afrika', 'SUDAN': 'Afrika',
    'TUNUS': 'Afrika',
};

export function getRegion(country) {
    if (!country) return 'Diğer';
    const normalized = country.trim().toLocaleUpperCase('tr-TR');
    return REGION_MAP[normalized] || 'Diğer';
}

// DB'den gelen history_notes değerini güvenli şekilde diziye çevirir.
export function parseHistoryNotes(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
