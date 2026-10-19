-- 041_insteel_2026_28_29_mal_mukabili.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
-- Insteel 2026-28 ve 2026-29 yanlışlıkla "60 Gün Vade" ile kaydedilmiş
-- (patron, 19.10.2026: "tamamen benim hatam, gözden kaçmış"). Insteel'in bütün
-- siparişleri Mal Mukabili'dir; vade çekin kendi vadesidir (bkz. 023, 025).
-- Bu iki sipariş 19.10.2026'da alınan çeklere (17.12.2026 ve 15.01.2027) dahil.
--
--   1) Önizleme (salt okunur)
--   2) Ödeme şekli Mal Mukabili, sipariş ve fatura vadeleri boş
--   3) Doğrulama
--
-- Not: order_invoices_sync_due (037) fatura vadesi boşalınca siparişin vadesini
-- SİLMEZ; bu yüzden orders.due_date de ayrıca boşaltılıyor.

-- ============================================================
-- 1) ÖNİZLEME
-- ============================================================
select o.order_number, o.payment_method, o.due_date as siparis_vadesi,
       i.invoice_no, i.invoice_date, i.due_date as fatura_vadesi
  from orders o
  join customers c on c.id = o.customer_id
  left join order_invoices i on i.order_id = o.id
 where lower(c.company_name) like 'insteel%'
   and o.order_number in ('2026-28', '2026-29')
 order by o.order_number;

-- ============================================================
-- 2) DÜZELTME
-- ============================================================
update order_invoices i
   set due_date = null
  from orders o
  join customers c on c.id = o.customer_id
 where i.order_id = o.id
   and lower(c.company_name) like 'insteel%'
   and o.order_number in ('2026-28', '2026-29')
   and i.due_date is not null;

update orders o
   set payment_method = 'Mal Mukabili',
       due_date       = null,
       status_tags    = array_remove(o.status_tags, 'Gecikme')
  from customers c
 where c.id = o.customer_id
   and lower(c.company_name) like 'insteel%'
   and o.order_number in ('2026-28', '2026-29')
   and (o.payment_method is distinct from 'Mal Mukabili' or o.due_date is not null);

-- ============================================================
-- 3) DOĞRULAMA — iki satır da "Mal Mukabili", vadeler boş olmalı
-- ============================================================
select o.order_number, o.payment_method, o.due_date as siparis_vadesi,
       i.invoice_no, i.due_date as fatura_vadesi
  from orders o
  join customers c on c.id = o.customer_id
  left join order_invoices i on i.order_id = o.id
 where lower(c.company_name) like 'insteel%'
   and o.order_number in ('2026-28', '2026-29')
 order by o.order_number;
