// excelStyle.js — Tüm modüllerin Excel dışa aktarımlarında ortak görsel dil.
//
// Kalıp Fiyat Robotu (prices.js) ile başladı, Müşteri Sabit Fiyatlar'da (client-prices.js)
// oturdu: koyu yeşil / zeytin yeşili iki tonlu başlık, krem veri zemini, ince gri kenarlık,
// zebra yok. Yeni bir modüle export eklerken bu dosyayı import edin — palet ve yardımcıları
// kopyalamayın, aksi halde modüller zamanla birbirinden ayrışıyor.
//
// Not: SheetJS'in ücretsiz sürümü hücre stillerini (font/dolgu/kenarlık) dosyaya YAZMIYOR
// (yalnızca okurken destekliyor) — bu yüzden export tarafı ExcelJS ile üretiliyor. İçe
// aktarma (dosya okuma) tarafı XLSX/SheetJS kullanmaya devam edebilir.
//
// Kullanan sayfanın HTML'ine ExcelJS CDN'i eklenmiş olmalı:
//   <script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"></script>

export const XL_HEADER_BG   = 'FF2D4A3E'; // ana alanlar (kod, ad, grup)
export const XL_HEADER_BG_2 = 'FF4A6741'; // ikincil alanlar (fiyat/hesap/durum)
export const XL_HEADER_FG   = 'FFFFFFFF';
export const XL_BORDER      = 'FFD6D2C9';
export const XL_ROW_BG      = 'FFF6F3EC';
export const XL_TEXT        = 'FF1C1A17';
export const XL_ACCENT_FG   = 'FFB5651D';
export const XL_OK_BG       = 'FFE1EBE4';
export const XL_OK_FG       = 'FF3D6E50';
export const XL_DANGER_BG   = 'FFF1DDD9';
export const XL_DANGER_FG   = 'FF9F3D3D';
export const XL_WARN_BG     = 'FFF3E5D2';
export const XL_WARN_FG     = 'FFB26B33';

export const XL_FONT = 'Arial';

export function xlBorder() {
    const side = { style: 'thin', color: { argb: XL_BORDER } };
    return { top: side, bottom: side, left: side, right: side };
}

// Başlık satırı: ilk `primaryCols` sütun koyu yeşil, kalanı zeytin yeşili.
export function styleHeaderRow(row, primaryCols = 3) {
    row.height = 34;
    row.eachCell((cell, col) => {
        cell.font = { name: XL_FONT, bold: true, size: 10, color: { argb: XL_HEADER_FG } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col <= primaryCols ? XL_HEADER_BG : XL_HEADER_BG_2 } };
        cell.border = xlBorder();
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
}

// Veri satırı için ortak taban stil. Sayı/tarih biçimleri çağıran modülde,
// bu çağrıdan sonra tek tek hücrelere uygulanır.
export function styleDataRow(row, { height = 22 } = {}) {
    row.height = height;
    row.eachCell(cell => {
        cell.font = { name: XL_FONT, size: 10, color: { argb: XL_TEXT } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_ROW_BG } };
        cell.border = xlBorder();
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });
}

// Sayfanın üstündeki başlık + alt bilgi bloğu (client-prices kalıbı).
// Dönen değer: başlık satırlarının sayısı — ws.views dondurma hesabında kullanılır.
export function addTitleBlock(ws, { title, subtitle, colSpan }) {
    const titleRow = ws.addRow([title]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, colSpan);
    titleRow.height = 26;
    titleRow.getCell(1).font = { name: XL_FONT, bold: true, size: 13, color: { argb: XL_HEADER_BG } };
    titleRow.getCell(1).alignment = { vertical: 'middle' };

    if (subtitle) {
        const sub = ws.addRow([subtitle]);
        ws.mergeCells(sub.number, 1, sub.number, colSpan);
        sub.getCell(1).font = { name: XL_FONT, size: 9, color: { argb: XL_ACCENT_FG } };
    }
    ws.addRow([]);
    return subtitle ? 3 : 2;
}

// Excel sayfa adı kısıtları: 31 karakter, : \ / ? * [ ] yasak.
export function safeSheetName(name, used) {
    let base = (name || 'Sayfa').replace(/[:\\\/\?\*\[\]]/g, '-').slice(0, 28).trim() || 'Sayfa';
    let candidate = base, i = 2;
    while (used.has(candidate)) { candidate = `${base.slice(0, 26)}_${i++}`; }
    used.add(candidate);
    return candidate;
}

export function downloadWorkbook(wb, filename) {
    return wb.xlsx.writeBuffer().then(buffer => {
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });
}

// Dosya adında kullanılamayacak karakterleri temizler (Türkçe harfler korunur).
export function safeFileNamePart(text) {
    return (text || '').replace(/[^\wÇĞİÖŞÜçğıöşü -]/g, '').trim();
}
