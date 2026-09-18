-- 033_rounding_insteel_bedelsiz.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
--   1) Küsurat farkları (9 sipariş)
--   2) Insteel 2026-22 — bedelsiz gönderim (025'in ezdiği ödeme şekli geri alınıyor)
--   3) Insteel 2026-18 — çek ile ödendi

-- ============================================================
-- 1) KÜSURAT FARKLARI
--
-- İnci Hanım'ın tablosundan aktarılan fatura tutarları ile sistemdeki sipariş
-- tutarları arasında kuruş farkları vardı (tablodaki yuvarlama). Sipariş tamamen
-- tahsil edildiği hâlde faturada 0,09–0,38 "açık" görünüyordu; Roccaforte'de
-- ise tersine siparişte 0,34 EUR "faturalanmamış" kalıyordu.
--
-- Karar (patron, 17.09.2026): küsuratlar silinsin. Fatura kaydının tutarı
-- sipariş tutarına eşitleniyor; tablodaki tutar notta iz olarak kalıyor.
-- Sipariş tutarlarına ve kalemlere DOKUNULMUYOR (satış analizleri etkilenmez).
--
--   Sipariş               Tablodaki fatura   Sipariş tutarı   Fark
--   Roccaforte  2025-01      16.463,66 EUR     16.464,00      -0,34
--   Elasan      2026-02     138.631,54 TRY    138.631,40      +0,14
--   Insteel     2026-11      23.133,80 TRY     23.133,66      +0,14
--   Insteel     2025-22     243.994,35 TRY    243.994,20      +0,15
--   Insteel     2025-20     172.177,02 TRY    172.176,64      +0,38
--   Siko        2026-01      11.268,60 EUR     11.268,50      +0,10
--   Td Unicoop  2026-01       1.840,13 EUR      1.840,04      +0,09
--   Tzx Dis Tic 2026-01       4.388,40 TRY      4.388,10      +0,30
--   Regata      2026-02      84.750,62 TRY     84.750,40      +0,22   (listede yoktu, aynı tür)
--
-- Not: patronun listesindeki "Insteel 2026-20 (0,38)" ve "2026-22 (0,15)"
-- aslında 2025-20 ve 2025-22 siparişleri.
-- ============================================================
with hedef (musteri, siparis) as (
    values ('roccaforte', '2025-01'), ('elasan', '2026-02'), ('insteel', '2026-11'),
           ('insteel', '2025-22'), ('insteel', '2025-20'), ('siko', '2026-01'),
           ('td unicoop', '2026-01'), ('tzx', '2026-01'), ('regata', '2026-02')
)
update order_invoices i
   set notes  = coalesce(i.notes || ' | ', '')
             || 'Küsurat silindi (17.09.2026): tablodaki tutar ' || i.amount
             || ', sipariş tutarına (' || o.total_amount || ') eşitlendi.',
       amount = o.total_amount
  from orders o
  join customers c on c.id = o.customer_id
  join hedef h on lower(c.company_name) like h.musteri || '%' and o.order_number = h.siparis
 where i.order_id = o.id
   and i.fx_rate is null
   and i.amount <> o.total_amount
   and abs(i.amount - o.total_amount) < 1
   and (select count(*) from order_invoices x where x.order_id = o.id) = 1;

-- ============================================================
-- 2) INSTEEL 2026-22 — BEDELSİZ GÖNDERİM
--
-- Bu sipariş bedelsiz gönderim (faturasal zorunluluk nedeniyle temsili tutarlı).
-- 025, Insteel'in tüm siparişlerini "Mal Mukabili" yaparken bunun "Bedelsiz"
-- ödeme şeklini de değiştirmişti — HATAYDI, geri alınıyor.
--
-- Bakiye, diğer bedelsiz siparişlerle (Woodstock, Gk, Aldex) aynı şekilde
-- kapatılıyor: tarihsiz "Mahsup" kaydı. Nakit tahsilat değildir; açılış kaydı
-- olduğu için aylık tahsilat rakamlarına girmez.
-- ============================================================
update orders o
   set payment_method = 'Bedelsiz'
  from customers c
 where c.id = o.customer_id
   and lower(c.company_name) like 'insteel%'
   and o.order_number = '2026-22'
   and coalesce(o.payment_method, '') <> 'Bedelsiz';

do $$
declare
    r     record;
    v_pay uuid;
begin
    for r in
        select o.id, o.user_id, o.customer_id, o.currency, o.remaining_balance, o.order_number
          from orders o
          join customers c on c.id = o.customer_id
         where lower(c.company_name) like 'insteel%'
           and o.order_number in ('2026-22', '2026-18')
           and coalesce(o.remaining_balance, 0) > 0.005
    loop
        if r.order_number = '2026-22' then
            insert into payments (user_id, customer_id, payment_date, is_opening, currency, amount, method, notes)
            values (r.user_id, r.customer_id, null, true, r.currency, round(r.remaining_balance, 2), 'Mahsup',
                    'Bedelsiz gönderim — Insteel 2026-22. Tahsilat yok, bakiye kapatma kaydı (17.09.2026).')
            returning id into v_pay;
        else
            -- ============================================================
            -- 3) INSTEEL 2026-18 — ÇEK İLE ÖDENDİ
            -- Patron teyidi (17.09.2026): Insteel'in 2026-23'ten önceki siparişlerinde
            -- alacağı yok, hepsi çekle ödendi. Açık kalan tek sipariş 2026-18 (648 TRY)
            -- idi. Çekin tarihi/numarası bilinmediği için tarihsiz kayıt.
            -- ============================================================
            insert into payments (user_id, customer_id, payment_date, is_opening, currency, amount, method, notes)
            values (r.user_id, r.customer_id, null, true, r.currency, round(r.remaining_balance, 2), 'Çek',
                    'Insteel 2026-18 — çek ile ödendi (patron teyidi 17.09.2026; çek tarihi/no bilinmiyor).')
            returning id into v_pay;
        end if;

        insert into payment_allocations (payment_id, order_id, amount)
        values (v_pay, r.id, round(r.remaining_balance, 2));
    end loop;
end $$;

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Küsurat kalmadı mı? (9 satır, fark hep 0)
-- select c.company_name, o.order_number, o.total_amount, i.amount, o.total_amount - i.amount as fark
--   from order_invoices i join orders o on o.id = i.order_id join customers c on c.id = o.customer_id
--  where i.notes like '%Küsurat silindi%';

-- 2) Insteel 2026-18 ve 2026-22 kapalı, 2026-22 "Bedelsiz" olmalı
-- select o.order_number, o.payment_method, o.total_amount, o.advance_payment, o.remaining_balance
--   from orders o join customers c on c.id = o.customer_id
--  where lower(c.company_name) like 'insteel%' and o.order_number in ('2026-18', '2026-22');
