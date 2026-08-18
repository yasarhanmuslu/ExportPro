-- Müşteri Sabit Fiyatlar — ikinci net fiyat (fiyat güncellemesi takibi)
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- Gerekçe: bir müşteriyle anlaşılan fiyat zaman içinde güncellenebiliyor
-- (örn. Fero Term'e %5 zam: 42,50 € → 44,50 €). Eski fiyatı kaybetmeden
-- yeni fiyatı görebilmek ve aradaki % farkı analiz edebilmek için ikinci
-- bir net fiyat alanı tutuluyor.
--
-- Anlam:
--   net_price_2 BOŞ  -> güncel fiyat = net_price
--   net_price_2 DOLU -> güncel fiyat = net_price_2, net_price ise önceki fiyat
--
-- Not: iskonto (discount_rate) bilerek net_price (v.1) üzerinden hesaplanmaya
-- devam ediyor — Karlılık Analizi ve Müşteri Skoru bu alanı bu anlamda
-- kullanıyor, anlamını değiştirmek o modülleri sessizce bozardı.

-- ============================================================
-- 1) net_price_2 kolonu
-- ============================================================
alter table customer_prices
    add column if not exists net_price_2 numeric;

-- ============================================================
-- 2) Doğrulama — çalıştırdıktan sonra
-- ============================================================
-- select count(*) filter (where net_price_2 is null)     as tek_fiyatli,
--        count(*) filter (where net_price_2 is not null) as guncellenmis
--   from customer_prices;
