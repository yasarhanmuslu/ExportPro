// topCustomers.js — "Top Müşteriler" sıralaması (Dashboard + Müşteri Skoru)
//
// Ciro her para biriminde AYRI sıralanır. Karışık toplandığında TRY tutarları
// büyüklük olarak her zaman öne geçiyor ve EUR/USD müşteriler listeye hiç
// giremiyordu (bkz. para birimleri asla toplanmaz kuralı).
// Kapsam Dashboard'daki Toplam Ciro ile aynı: iptal ve bedelsiz siparişler hariç.

import { isCancelled, isFreeShipment } from './receivables.js';

// orders → { currencies: ['EUR', ...] (sipariş sayısına göre), byCurrency: { EUR: [{ customerId, total, orders }] } }
export function buildTopCustomers(orders = []) {
    const totals = {};       // cur -> Map(cid -> { total, orders })
    const orderCounts = {};  // cur -> sipariş sayısı (sekme sırası)
    orders.forEach(o => {
        if (!o.customer_id || isCancelled(o) || isFreeShipment(o)) return;
        const cur = o.currency || 'EUR';
        if (!totals[cur]) totals[cur] = new Map();
        const row = totals[cur].get(o.customer_id) || { customerId: o.customer_id, total: 0, orders: 0 };
        row.total += Number(o.total_amount) || 0;
        row.orders++;
        totals[cur].set(o.customer_id, row);
        orderCounts[cur] = (orderCounts[cur] || 0) + 1;
    });

    const byCurrency = {};
    Object.entries(totals).forEach(([cur, map]) => {
        byCurrency[cur] = [...map.values()].filter(r => r.total > 0).sort((a, b) => b.total - a.total);
    });
    const currencies = Object.keys(byCurrency)
        .filter(c => byCurrency[c].length)
        .sort((a, b) => orderCounts[b] - orderCounts[a]);
    return { currencies, byCurrency };
}
