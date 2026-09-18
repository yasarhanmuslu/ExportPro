-- 036_graniti_payment_currency.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
-- Graniti Building 2026-01: sipariş para birimi patron tarafından EUR -> USD
-- düzeltilmişti (fatura aktarımı karar listesi, 17.09.2026). Ancak 022'nin açtığı
-- tarihsiz tahsilat kaydı eski para birimiyle (EUR) kalmıştı: USD siparişe EUR
-- tahsilat dağıtılmış görünüyordu. Tutar aynı (1.466,88), sadece birim yanlış.
--
-- Aynı anda ödeme tarihi de giriliyor: İnci Hanım'ın tablosundaki not
-- "22.05.2026 tarihinde 1.457,88 usd" (9 USD banka kesintisi farkı; sipariş
-- zaten tamamen tahsil edilmiş kabul ediliyor, tutar değişmiyor).
--
-- Tarih girme işi normalde uygulamadaki date_opening_payment fonksiyonuyla yapılır;
-- o fonksiyon oturum açmış kullanıcı istediği için SQL Editor'den çağrılamıyor,
-- bu yüzden bu tek kayıt burada doğrudan güncelleniyor (tek sipariş, tek dağıtım).

update payments p
   set currency     = 'USD',
       payment_date = date '2026-05-22',
       is_opening   = false,
       method       = null,
       notes        = 'Geçmiş ödeme — tarih İnci Hanım''ın ödeme takip tablosundan (açıklama notu). Para birimi EUR -> USD düzeltildi (sipariş USD).'
 where p.is_opening
   and p.currency = 'EUR'
   and p.id in (
        select a.payment_id
          from payment_allocations a
          join orders o on o.id = a.order_id
          join customers c on c.id = o.customer_id
         where lower(c.company_name) like 'graniti%'
           and o.order_number = '2026-01'
           and o.currency = 'USD'
   )
   and (select count(*) from payment_allocations x where x.payment_id = p.id) = 1;

-- ============================================================
-- KONTROL — tahsilatın para birimi siparişle aynı olmayan kayıt kalmamalı (0 satır)
-- ============================================================
-- select c.company_name, o.order_number, o.currency as siparis, p.currency as tahsilat, p.amount
--   from payments p
--   join payment_allocations a on a.payment_id = p.id
--   join orders o on o.id = a.order_id
--   join customers c on c.id = o.customer_id
--  where o.currency <> p.currency;
