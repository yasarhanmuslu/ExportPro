// invoiceDeduction.js — "Fatura Altı İndirim" alanı
// Sipariş ve Teklif modüllerinin ORTAK arayüzü (bkz. priceFlags.js, proformaPdf.js).
//
// NEDEN
// Bedelsiz/CN telafisi bazen kalem fiyatlarına hiç dokunmadan yapılır: tutar
// belgenin altından toplu düşülür. O zaman kalem toplamı ile belge tutarı
// KASITLI olarak farklı olur ve ekran haksız yere "tutmuyor" uyarısı verir.
//
// Alan farkı AÇIKLAR, hesaplamaz: total_amount zaten indirim sonrası tutardır,
// kalan bakiye hesabı değişmez.
//
// Kolonlar SQL 017 (orders) ve 021 (quotations) ile gelir. Kolon yoksa alan
// gizlenir ve hiçbir yazma işlemine girmez.

const SYMBOLS = { EUR: '€', USD: '$', TRY: '₺', GBP: '£' };

export function fmtAmount(n) {
    return (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });
}

/**
 * @param {string}   opts.table      'orders' | 'quotations'
 * @param {object}   opts.supabase   Supabase istemcisi
 * @param {function} opts.parseAmount  Türkçe biçimli tutarı sayıya çeviren fonksiyon
 * @param {string}   opts.docLabel   Uyarı metninde geçecek belge adı ('sipariş' / 'teklif')
 * @param {string}   opts.sqlHint    Kolon yoksa konsola yazılacak script adı
 */
export function createInvoiceDeduction({ table, supabase, parseAmount, docLabel, sqlHint }) {
    let enabled = false;

    const amountEl = () => document.getElementById('invoice_deduction');
    const noteEl   = () => document.getElementById('invoice_deduction_note');

    async function probe() {
        const { error } = await supabase.from(table).select('invoice_deduction').limit(1);
        enabled = !error;
        if (!enabled) {
            console.info(`${table}.invoice_deduction kolonu yok — ${sqlHint} çalıştırılmamış. "Fatura Altı İndirim" alanı gizlendi.`);
            return false;
        }
        document.getElementById('deduction-row')?.classList.remove('hidden');
        return true;
    }

    const isEnabled = () => enabled;

    function value() {
        if (!enabled) return 0;
        const v = parseAmount(amountEl().value);
        return isFinite(v) && v > 0 ? v : 0;
    }

    function set(n) {
        if (!enabled) return;
        amountEl().value = n > 0 ? fmtAmount(n) : '';
    }

    function setNote(text) {
        if (!enabled) return;
        const el = noteEl();
        if (!el.value.trim()) el.value = text;
    }

    function fill(row) {
        if (!enabled) return;
        const d = parseFloat(row?.invoice_deduction || 0);
        amountEl().value = d > 0 ? fmtAmount(d) : '';
        noteEl().value   = row?.invoice_deduction_note || '';
    }

    function reset() {
        if (!enabled) return;
        amountEl().value = '';
        noteEl().value   = '';
    }

    function payload() {
        if (!enabled) return {};
        return {
            invoice_deduction:      value(),
            invoice_deduction_note: noteEl().value.trim() || null,
        };
    }

    /**
     * Denklem şeridini çizer ve uyarı metnini üretir.
     * Şerit yalnız indirim girildiğinde görünür — normal belgede ekranı
     * kalabalıklaştırmasın.
     * @returns {{ expected:number, ok:boolean, warning:string }}
     */
    function render({ itemsTotal, docTotal, currency }) {
        const deduction = value();
        const expected  = itemsTotal - deduction;
        const ok        = docTotal > 0 && Math.abs(expected - docTotal) <= 0.01;
        const cur       = SYMBOLS[currency] || currency || '';
        const eq        = document.getElementById('deduction-equation');

        if (eq) {
            if (deduction > 0) {
                eq.classList.remove('hidden');
                eq.innerHTML = `Kalem toplamı <strong>${fmtAmount(itemsTotal)}</strong> &minus; fatura altı indirim <strong>${fmtAmount(deduction)}</strong> = <strong>${fmtAmount(expected)} ${cur}</strong>`
                    + (docTotal > 0
                        ? (ok
                            ? ` <span style="color:#166534;font-weight:700;"><i class="fa-solid fa-check"></i> ${docLabel} tutarıyla uyuşuyor</span>`
                            : ` <span style="color:#9F3D3D;font-weight:700;">— ${docLabel} tutarı ${fmtAmount(docTotal)} ${cur}</span>`)
                        : '');
            } else {
                eq.classList.add('hidden');
                eq.innerHTML = '';
            }
        }

        const warning = (docTotal > 0 && !ok)
            ? `⚠ Kalem toplamı (${fmtAmount(itemsTotal)})`
              + (deduction > 0 ? ` (fatura altı indirim ${fmtAmount(deduction)} düşüldükten sonra ${fmtAmount(expected)})` : '')
              + ` ${docLabel} tutarından (${fmtAmount(docTotal)}) farklı!`
            : '';

        return { expected, ok, warning, deduction };
    }

    return { probe, isEnabled, value, set, setNote, fill, reset, payload, render };
}
