-- Müşteri Sabit Fiyatlar — ikinci net fiyatın tarihi
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- Gerekçe: 011 ile ikinci bir net fiyat (net_price_2) eklendi ama tek bir
-- tarih alanı vardı. İki fiyatın ne kadar süre arayla geçerli olduğunu
-- görebilmek için her fiyatın kendi tarihi tutuluyor.
--
-- Anlam:
--   price_date        -> net_price   (v.1, önceki/ilk anlaşılan fiyat) tarihi
--   net_price_2_date  -> net_price_2 (v.2, güncel fiyat) tarihi
--
-- Arayüzde listede yalnızca GÜNCEL fiyatın tarihi gösterilir; iki tarih
-- arasındaki süre hücrenin üzerine gelince ipucu olarak çıkar.

-- ============================================================
-- 1) net_price_2_date kolonu
-- ============================================================
alter table customer_prices
    add column if not exists net_price_2_date date;

-- ============================================================
-- 2) Doğrulama — çalıştırdıktan sonra
-- ============================================================
-- select count(*) filter (where net_price_2 is not null and net_price_2_date is null)
--            as tarihsiz_v2,
--        count(*) filter (where net_price_2_date is not null) as tarihli_v2
--   from customer_prices;
