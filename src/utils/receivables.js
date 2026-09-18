// receivables.js — Ödeme Takibi hesapları
// Alacak kalemleri, vade, yaşlandırma, Eximbank tarihleri ve taksit durumu.
//
// Saf fonksiyonlar: Supabase'e dokunmaz, sadece verilen satırları hesaplar.
// Ödeme Takibi dışında (Dashboard, Müşteri Skoru ...) aynı hesabı kullanmak için ayrı tutuldu.
//
// TEMEL KURALLAR (bkz. supabase/sql/022, 023, 027, 029)
//   • Alacak FATURA ile doğar. Siparişin faturalanmamış kısmı alacak değil,
//     "beklenen" bakiyedir (henüz sevk edilmedi).
//   • Siparişe yapılan tahsilat (orders.advance_payment, DB trigger'ı tutar)
//     faturalara en eskiden başlayarak dağıtılır.
//   • İhraç kayıtlı faturada tutar TL, alacağın özü sipariş para birimi:
//     hesaplar amount_order_currency ile yapılır, TL ile USD asla toplanmaz.
//   • Vade: faturanın kendi vadesi; yoksa fatura tarihi + ödeme şeklindeki gün
//     ("60 Gün Vade"). Peşin / Mal Mukabili faturalarda vade yoktur
//     (Insteel gibi çekle ödeyenlerde vade çekin vadesidir).
//   • Eximbank: iç uyarı vade+45 (patron kararı), V.G.A.B vade+60,
//     tazminat başvurusu vade+90 (V.G.A.B + 30).
//   • Kapsam yalnızca sistemdeki siparişler (patron kararı 17.09.2026, SQL 032).

export const EXIMBANK_WARN_DAYS  = 45;
export const EXIMBANK_VGAB_DAYS  = 60;
export const EXIMBANK_CLAIM_DAYS = 90;

const EPS = 0.005;
// Bu tutarın altındaki açık bakiye kuruş yuvarlaması sayılır, alacak kalemi üretmez
// (ör. sipariş 15.955,84 / fatura 15.955,85 -> 0,01 "açık").
export const ROUNDING_TOLERANCE = 0.05;

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── Tarih yardımcıları (ISO 'YYYY-MM-DD', saat dilimi kaymasız) ──────────────
export function todayIso() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isoToUtc(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

export function addDays(iso, n) {
    if (!iso) return null;
    const t = new Date(isoToUtc(iso) + n * 86400000);
    return t.toISOString().slice(0, 10);
}

// to - from, gün olarak. daysBetween('2026-08-31', '2026-09-16') = 16
export function daysBetween(fromIso, toIso) {
    if (!fromIso || !toIso) return null;
    return Math.round((isoToUtc(toIso) - isoToUtc(fromIso)) / 86400000);
}

// "60 Gün Vade" -> 60, "Peşin" -> 0
export function termDays(paymentMethod) {
    const m = /(\d+)\s*g[üu]n/i.exec(paymentMethod || '');
    return m ? Number(m[1]) : 0;
}

export function orderTags(order) {
    if (order.status_tags && order.status_tags.length) return order.status_tags;
    return order.order_status ? [order.order_status] : [];
}

export function isCancelled(order) {
    return orderTags(order).includes('İptal');
}

// Bedelsiz gönderim: faturasal zorunluluk nedeniyle temsili tutarlıdır, tahsil edilmez.
export function isFreeShipment(order) {
    return /bedelsiz/i.test(order.payment_method || '');
}

// Siparişin vade takibinde GECİKMİŞ sayılıp sayılmadığı. Siparişler ("Gecikme" etiketi),
// Takip Takvimi, Müşteri Skoru ve Dashboard aynı kuralı kullanır: bakiyesi açık, vadesi geçmiş,
// iptal / bedelsiz / manuel takip (ödemesi ne zaman geleceği belli olmayan) DEĞİL.
export function isOrderOverdue(order, today = todayIso()) {
    if (isCancelled(order) || isFreeShipment(order) || order.manual_tracking) return false;
    if ((Number(order.remaining_balance) || 0) <= ROUNDING_TOLERANCE) return false;
    return !!order.due_date && String(order.due_date).slice(0, 10) < today;
}

export function isShipped(order) {
    const t = orderTags(order);
    return !!order.shipment_date || t.includes('Sevk Edildi') || t.includes('Teslim Edildi');
}

// ── Yaşlandırma ──────────────────────────────────────────────────────────────
export const AGING_BUCKETS = [
    { id: 'current', label: 'Vadesi gelmedi' },
    { id: '1-30',    label: '1–30 gün' },
    { id: '31-60',   label: '31–60 gün' },
    { id: '61-90',   label: '61–90 gün' },
    { id: '90+',     label: '90+ gün' },
    { id: 'nodue',   label: 'Vadesiz' },
];

export function agingBucket(dueDate, today = todayIso()) {
    if (!dueDate) return 'nodue';
    const d = daysBetween(dueDate, today);
    if (d <= 0)  return 'current';
    if (d <= 30) return '1-30';
    if (d <= 60) return '31-60';
    if (d <= 90) return '61-90';
    return '90+';
}

// ── Eximbank ─────────────────────────────────────────────────────────────────
// stage: 'not-due'   vadesi gelmedi
//        'overdue'   vadesi geçti, iç uyarı (45. gün) henüz gelmedi
//        'warn'      45. gün geçti, V.G.A.B son günü (60) gelmedi  -> BİLDİRİM YAP
//        'vgab-late' V.G.A.B süresi geçti, tazminat süresi (90) içinde
//        'lost'      tazminat süresi de geçti
export function eximbankInfo(dueDate, today = todayIso()) {
    if (!dueDate) return null;
    const warn  = addDays(dueDate, EXIMBANK_WARN_DAYS);
    const vgab  = addDays(dueDate, EXIMBANK_VGAB_DAYS);
    const claim = addDays(dueDate, EXIMBANK_CLAIM_DAYS);
    const overdueDays = daysBetween(dueDate, today);
    let stage = 'not-due';
    if (overdueDays > 0) stage = 'overdue';
    if (today > warn)    stage = 'warn';
    if (today > vgab)    stage = 'vgab-late';
    if (today > claim)   stage = 'lost';
    return {
        dueDate, warn, vgab, claim, overdueDays, stage,
        daysToWarn:  daysBetween(today, warn),
        daysToVgab:  daysBetween(today, vgab),
        daysToClaim: daysBetween(today, claim),
    };
}

export function isEximbankCovered(order, customer) {
    if (order && order.eximbank_covered !== null && order.eximbank_covered !== undefined) return !!order.eximbank_covered;
    return !!(customer && customer.eximbank_insured);
}

// ── Alacak kalemleri ─────────────────────────────────────────────────────────
// Dönüş:
//   items   : tahsil edilecek kalemler (sipariş faturası / faturası girilmemiş sevk)
//   pending : henüz faturalanmamış (sevk edilmemiş) sipariş bakiyeleri — alacak değil
export function buildReceivables({ orders = [], invoices = [], customers = [], today = todayIso() }) {
    const custById = new Map(customers.map(c => [c.id, c]));
    const invByOrder = new Map();
    invoices.forEach(i => {
        if (!invByOrder.has(i.order_id)) invByOrder.set(i.order_id, []);
        invByOrder.get(i.order_id).push(i);
    });

    const items = [];
    const pending = [];

    for (const o of orders) {
        if (isCancelled(o) || isFreeShipment(o)) continue;
        const cust = custById.get(o.customer_id) || null;
        const base = {
            customerId: o.customer_id,
            customerName: cust?.company_name || '—',
            orderId: o.id,
            orderNumber: o.order_number,
            currency: o.currency || 'EUR',
            paymentMethod: o.payment_method || '',
            eximbank: isEximbankCovered(o, cust),
        };
        const total = Number(o.total_amount) || 0;
        const paid  = Number(o.advance_payment) || 0;
        const term  = termDays(o.payment_method);
        const invs  = (invByOrder.get(o.id) || []).slice().sort((a, b) =>
            (a.invoice_date || '').localeCompare(b.invoice_date || '') || (a.invoice_no || '').localeCompare(b.invoice_no || ''));

        if (invs.length) {
            let paidLeft = paid;
            let invoiced = 0;
            for (const inv of invs) {
                const value = Number(inv.amount_order_currency ?? inv.amount) || 0;
                invoiced += value;
                const applied = Math.max(0, Math.min(paidLeft, value));
                paidLeft -= applied;
                const open = round2(value - applied);
                if (open <= ROUNDING_TOLERANCE) continue;
                const due = inv.due_date || (term > 0 ? addDays(inv.invoice_date, term) : null);
                items.push({
                    ...base,
                    key: `inv:${inv.id}`,
                    kind: 'invoice',
                    invoiceId: inv.id,
                    docNo: inv.invoice_no,
                    docDate: inv.invoice_date,
                    dueDate: due,
                    amount: round2(value),
                    open,
                    invoiceAmount: Number(inv.amount) || 0,
                    invoiceCurrency: inv.currency,
                    fxRate: inv.fx_rate ? Number(inv.fx_rate) : null,
                });
            }
            const uninvoiced = round2(total - invoiced);
            const uninvoicedOpen = round2(uninvoiced - Math.max(0, paidLeft));
            if (uninvoicedOpen > ROUNDING_TOLERANCE) {
                pending.push({ ...base, key: `pend:${o.id}`, orderDate: o.order_date, total, uninvoiced, open: uninvoicedOpen, tags: orderTags(o) });
            }
            continue;
        }

        const remaining = Number(o.remaining_balance) || 0;
        if (remaining <= ROUNDING_TOLERANCE) continue;

        if (isShipped(o)) {
            // Faturası sisteme girilmemiş ama sevk edilmiş sipariş: siparişin kendisi alacak kalemi.
            items.push({
                ...base,
                key: `ord:${o.id}`,
                kind: 'order',
                docNo: null,
                docDate: o.shipment_date || o.order_date,
                dueDate: o.due_date || (term > 0 && o.shipment_date ? addDays(o.shipment_date, term) : null),
                amount: total,
                open: round2(remaining),
                noInvoice: true,
            });
        } else {
            pending.push({ ...base, key: `pend:${o.id}`, orderDate: o.order_date, total, uninvoiced: total, open: round2(remaining), tags: orderTags(o) });
        }
    }

    items.forEach(it => {
        it.bucket = agingBucket(it.dueDate, today);
        it.overdueDays = it.dueDate ? daysBetween(it.dueDate, today) : null;
    });

    return { items, pending };
}

// Para birimi bazında toplam — farklı para birimleri ASLA toplanmaz.
export function sumByCurrency(rows, field = 'open') {
    const out = {};
    rows.forEach(r => {
        const cur = r.currency || '—';
        out[cur] = round2((out[cur] || 0) + (Number(r[field]) || 0));
    });
    return out;
}

// ── Ödeme planı ──────────────────────────────────────────────────────────────
// paidAmount: planın bağlı olduğu belgeye (sipariş / manuel alacak) yapılan toplam tahsilat.
// Taksitler en eski vadeden başlayarak kapanır.
export function installmentStatus(installments, paidAmount, today = todayIso()) {
    let left = Number(paidAmount) || 0;
    return installments
        .slice()
        .sort((a, b) => (a.seq || 0) - (b.seq || 0))
        .map(inst => {
            const amount = Number(inst.amount) || 0;
            const applied = Math.max(0, Math.min(left, amount));
            left -= applied;
            const open = round2(amount - applied);
            let state = 'paid';
            if (open > EPS) state = applied > EPS ? 'partial' : 'open';
            const late = state !== 'paid' && inst.due_date < today;
            return { ...inst, amount, applied: round2(applied), open, state, late, daysToDue: daysBetween(today, inst.due_date) };
        });
}
