-- 030_cagdas_invoices_fisdoo_duplicate.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
-- ÖN KOŞUL: 029 çalıştırılmış olmalı (order_invoices.fx_rate / amount_order_currency
-- alanları ve Çağdaş'ın 1. faturası 029'da geliyor).
--
--   1) Çağdaş İç ve Dış 2026-01 — 2. ve 3. sevk faturaları
--   2) Fis Doo IHR2025000000089 — mükerrer manuel alacak iptal

-- ============================================================
-- 1) ÇAĞDAŞ İÇ VE DIŞ 2026-01 — 3 SEVK, TOPLAM 67.026,50 USD
--    Tarihler patrondan (17.09.2026):
--      IDL2026000001548  07.08.2026  1.632.683,87 TL @47,6133   (029 ile girildi)
--      IDL2026000001555  08.08.2026  1.511.093,79 TL @47,6085
--      IDL2026000001556  08.08.2026     47.418,07 TL @47,6085   (kalan kuruşu üstlenir)
--    Son faturanın USD karşılığı, üç faturanın toplamı sipariş tutarına TAM
--    eşit olacak şekilde yazılır (TL/kur 996,00; yazılan ~995,97).
-- ============================================================
with o as (
    select id, user_id
      from orders
     where ltrim(regexp_replace(coalesce(ideal_order_no, ''), '\D', '', 'g'), '0') = '8778'
     limit 1
),
src (invoice_no, invoice_date, amount, fx_rate, amount_oc, notes) as (
    values
    ('IDL2026000001555', date '2026-08-08', 1511093.79::numeric, 47.6085::numeric,
     round(1511093.79 / 47.6085, 2),
     '2. sevk. İhraç kayıtlı: 47,6085 kur karşılığı TL ödeme.'),
    ('IDL2026000001556', date '2026-08-08', 47418.07, 47.6085,
     67026.50 - round(1632683.87 / 47.6133, 2) - round(1511093.79 / 47.6085, 2),
     '3. sevk. İhraç kayıtlı: 47,6085 kur. USD karşılığı, 3 faturanın toplamı sipariş tutarına (67.026,50 USD) tam eşit olacak şekilde yazıldı.')
)
insert into order_invoices
    (user_id, order_id, invoice_no, invoice_date, amount, currency, fx_rate, amount_order_currency, notes)
select o.user_id, o.id, s.invoice_no, s.invoice_date, s.amount, 'TRY', s.fx_rate, s.amount_oc,
       s.notes || ' | Tarih patrondan (17.09.2026)'
  from src s cross join o
on conflict (user_id, invoice_no) where invoice_no is not null do nothing;

-- 029'daki 1. fatura notunda "tarihleri bekleniyor" yazıyordu — güncelle.
update order_invoices
   set notes = '1. sevk. İhraç kayıtlı: 47,6133 kur. Sipariş 3 faturayla sevk edildi (IDL2026000001548, IDL2026000001555, IDL2026000001556). | Karar listesinden girildi (17.09.2026)'
 where invoice_no = 'IDL2026000001548'
   and notes like '%tarihi bekleniyor%';

-- ============================================================
-- 2) FIS DOO — IHR2025000000089 MÜKERRER MANUEL ALACAK
--
-- 024 çalıştığında Fiss 2025-06'nın İdeal no'su yanlış girilmişti (0006966;
-- o numara sistemde olmayan 2025-05 siparişine ait). Bu yüzden İnci Hanım'ın
-- tablosundaki IHR2025000000089 faturası "siparişi yok" sanılıp manuel alacak
-- olarak alındı.
--
-- Patron teyidi (17.09.2026): IHR2025000000089 = Fiss 2025-06 siparişi,
-- fatura tutarı 4.399,66 EUR. Fatura 029 ile siparişe bağlandı; alacak artık
-- sipariş üzerinden takip ediliyor. Manuel kayıt aynı faturanın ikinci kopyası.
--
-- Kayıt SİLİNMİYOR, "İptal" yapılıyor: İnci Hanım'ın tablosundaki
-- "1.081,37 EUR kısmi geldi" bilgisi notta iz olarak kalsın.
-- ============================================================
update manual_receivables
   set status      = 'İptal',
       description = description
                  || ' | İPTAL (17.09.2026): Mükerrer kayıt. Bu fatura Fiss 2025-06 siparişine ait '
                  || '(İdeal no 0007603, fatura tutarı 4.399,66 EUR); alacak sipariş üzerinden takip ediliyor. '
                  || 'Tablodaki 1.081,37 EUR kalan bilgisi burada iz olarak bırakıldı.'
 where doc_no = 'IHR2025000000089'
   and status <> 'İptal';

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Çağdaş 2026-01: 3 fatura, USD karşılığı toplamı 67.026,50
-- select i.invoice_no, i.invoice_date, i.amount, i.fx_rate, i.amount_order_currency
--   from order_invoices i
--   join orders o on o.id = i.order_id
--  where ltrim(regexp_replace(coalesce(o.ideal_order_no, ''), '\D', '', 'g'), '0') = '8778'
--  order by i.invoice_date, i.invoice_no;
-- select sum(amount_order_currency) from order_invoices i join orders o on o.id = i.order_id
--  where ltrim(regexp_replace(coalesce(o.ideal_order_no, ''), '\D', '', 'g'), '0') = '8778';

-- 2) Toplam fatura: 103 (028 sonrası 88 + 029'dan 13 + bu script'ten 2)
-- select count(*) from order_invoices;

-- 3) Fis Doo manuel kaydı İptal olmalı
-- select doc_no, amount, status from manual_receivables where doc_no = 'IHR2025000000089';
