-- Müşteri Sabit Fiyatlar — para birimi desteği
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- Gerekçe: customer_prices tablosunda para birimi kolonu yoktu; modül arayüzü
-- ve Karlılık Analizi tüm fiyatların EUR olduğunu varsayıyordu. Müşterilerin
-- anlaşmalı fiyatları müşteriye göre farklı para biriminde olabildiği için
-- para birimi artık satır bazında saklanıyor.

-- ============================================================
-- 1) currency kolonu
--    Mevcut satırlar 'EUR' olur. Bu KASITLI: bugüne kadar arayüz her fiyatı
--    € olarak gösterdi, dolayısıyla girilen veriler EUR anlamı taşıyor.
--    Otomatik olarak customers.currency'ye çevirmek geçmiş veriyi yeniden
--    yorumlamak olurdu — bu yüzden yapılmıyor (bkz. adım 3).
-- ============================================================
alter table customer_prices
    add column if not exists currency text not null default 'EUR';

-- ============================================================
-- 2) Geçerli para birimi kısıtı (orders/customers ile aynı küme)
-- ============================================================
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'customer_prices_currency_check'
    ) then
        alter table customer_prices
            add constraint customer_prices_currency_check
            check (currency in ('EUR', 'USD', 'TRY', 'GBP'));
    end if;
end $$;

create index if not exists customer_prices_currency_idx
    on customer_prices(currency);

-- ============================================================
-- 3) OPSİYONEL BACKFILL — VARSAYILAN OLARAK KAPALI
--
--    Eğer mevcut fiyat kayıtlarının aslında müşterinin kendi para biriminde
--    girildiğini (ama arayüzde yanlışlıkla € olarak gösterildiğini) teyit
--    ederseniz, aşağıdaki bloğun yorumunu kaldırıp çalıştırın.
--
--    DİKKAT: Bu, geçmiş veriyi yeniden yorumlar ve Karlılık Analizi ile
--    Müşteri Skoru sonuçlarını değiştirir. Önce bir müşteri üzerinde
--    doğrulamanız önerilir.
--
--    Etkilenecek satırları önizlemek için (bu sorgu hiçbir şeyi değiştirmez):
--
--    select cp.currency as mevcut, c.currency as olacak, count(*)
--    from customer_prices cp
--    join customers c on c.id = cp.customer_id
--    where c.currency is not null and c.currency <> '' and c.currency <> cp.currency
--    group by 1, 2;
--
-- ------------------------------------------------------------
-- update customer_prices cp
--    set currency = c.currency
--   from customers c
--  where c.id = cp.customer_id
--    and c.currency in ('EUR', 'USD', 'TRY', 'GBP');
-- ------------------------------------------------------------

-- ============================================================
-- 4) Doğrulama — çalıştırdıktan sonra dağılımı görmek için
-- ============================================================
-- select currency, count(*) from customer_prices group by 1 order by 2 desc;
