-- Müşteri Sabit Fiyatlar — ürün bazlı fiyat tarihi
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- Gerekçe: bir müşterinin ürün fiyatının hangi tarihten beri geçerli olduğu
-- bilinmiyordu. Tarih müşteri bazında değil ÜRÜN bazında tutuluyor, çünkü
-- aynı müşterinin bazı ürünlerinin fiyatı zaman içinde değişip bazıları
-- sabit kalabiliyor.

-- ============================================================
-- 1) price_date kolonu
--    Mevcut satırlarda NULL kalır — arayüzde "—" görünür ve kullanıcı
--    düzenleyerek gerçek tarihi (örn. 2024) girebilir. Bilmediğimiz bir
--    tarihi bugünle doldurmak yanlış bilgi üretmek olurdu.
-- ============================================================
alter table customer_prices
    add column if not exists price_date date;

create index if not exists customer_prices_price_date_idx
    on customer_prices(price_date);

-- ============================================================
-- 2) price_list okuma izni — Müşteri Sabit Fiyatlar için
--
--    Müşteri Sabit Fiyatlar modülü artık liste fiyatını Fiyat Robotu'nun
--    price_list tablosundan otomatik dolduruyor. Ancak 003_module_scoped_rls
--    içindeki select politikası SADECE 'prices' (Fiyat Robotu) yetkisine
--    bakıyordu; bu yüzden yalnızca 'client-prices' yetkisi olan bir kullanıcıda
--    sorgu sessizce 0 satır dönüyor ve otomatik doldurma hiç çalışmıyordu.
--
--    Sahip (owner) kullanıcı bundan etkilenmiyordu — sorun yalnızca yetkisi
--    modül bazında sınırlandırılmış kullanıcılarda görülür.
--
--    Not: yalnızca SELECT genişletiliyor. price_list'e yazma hakkı hâlâ
--    sadece 'prices' modülünde düzenleme yetkisi olanlarda.
-- ============================================================
drop policy if exists price_list_select on price_list;
create policy price_list_select on price_list for select
    using (has_module_access(user_id, array['prices','client-prices'], 'view'));

-- ============================================================
-- 3) Doğrulama — çalıştırdıktan sonra
-- ============================================================
-- select count(*) filter (where price_date is null) as tarihsiz,
--        count(*) filter (where price_date is not null) as tarihli
--   from customer_prices;
