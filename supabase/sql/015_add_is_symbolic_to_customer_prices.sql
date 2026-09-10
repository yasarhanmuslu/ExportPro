-- Müşteri Sabit Fiyatlar — "Bedelsiz / Numune" işareti
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- GEREKÇE
-- Bazı fiyat kartı satırları gerçek bir pazarlık fiyatı değil, bedelsiz ya da
-- numune verilen ürün için girilmiş TEMSİLİ tutarlardır (ürün değerinin ~%1'i,
-- ör. 44,50 € yerine 1,00 €). Satış & Fiyat Analizi'nin "Müşteriler Arası Fiyat
-- Tutarsızlığı" bölümü bunları gerçek fiyat sanıp "%98 fark" gibi sahte bulgular
-- üretiyordu.
--
-- Modül şu an bunu SEZGİSEL olarak buluyor: ürünün medyan anlaşılan fiyatının
-- %20'sinin altındaki kayıtları sembolik sayıyor. Eşik canlı veriden seçildi
-- (%15 ile %25 arasında sonuç birebir aynı: 8 kayıt / 5 müşteri), ama sezgisel
-- kural her zaman yaklaşıktır. Bu kolon işaretlemeyi KESİN hale getirir:
-- işaretli satırlar istatistik dışı tutulur, sezgisel kurala gerek kalmaz.
--
-- NOT: Bu kolon YOKKEN de modül çalışır (sezgisel kurala düşer). Scripti
-- çalıştırdıktan sonra Müşteri Sabit Fiyatlar'daki "Bedelsiz / Numune"
-- kutucuğu kullanılabilir hale gelir.

-- ============================================================
-- 1) is_symbolic kolonu
--    Mevcut satırların hepsi false olur — hiçbir kayıt otomatik olarak
--    bedelsiz işaretlenmez. İşaretleme kullanıcının kararıdır.
-- ============================================================
alter table customer_prices
    add column if not exists is_symbolic boolean not null default false;

comment on column customer_prices.is_symbolic is
    'true ise bu satır gerçek pazarlık fiyatı değil, bedelsiz/numune için girilmiş temsili tutardır; fiyat istatistiklerine katılmaz.';

-- ============================================================
-- 2) İndeks — analiz sorguları bu kolona göre filtreliyor
-- ============================================================
create index if not exists customer_prices_is_symbolic_idx
    on customer_prices(is_symbolic)
    where is_symbolic;

-- ============================================================
-- 3) OPSİYONEL — modülün bugün sezgisel olarak bulduğu 8 kaydı işaretle
--    VARSAYILAN OLARAK KAPALI. Önce aşağıdaki select ile listeyi görün,
--    doğru olduğuna karar verirseniz update'i açıp çalıştırın.
--
--    Bu kayıtlar 2026-09-10 itibarıyla şunlardı (medyanın %20'sinin altı):
--      Elasan  · Alfa Duvara Sıfır Klozet Rimless…   =    91,32 TRY (medyan 2.648,99)
--      Ergüden · Nova Duvara Sıfır Klozet Rimless…   =     5,00 TRY (medyan 1.232,50)
--      Qbik    · Asma Klozet İçin Gizli Montaj Seti  =     0,50 EUR (medyan     4,50)
--      Qbik    · Alfa/Rondo İnce Duroplast Kapak     =     0,50 EUR (medyan    14,44)
--      Qbik    · Alfa/Halley/Nova Rezervuar          =     1,00 EUR (medyan    12,78)
--      Fiss    · Slim Merkür Dolap Uyumlu Lavabo     =     0,80 EUR (medyan     9,36)
--      Siko    · Alfa Asma Klozet Rimless            =     1,00 EUR (medyan    24,00)
--      Siko    · Halley Asma Klozet Rimless          =     1,00 EUR (medyan    13,00)
-- ============================================================

-- ÖNCE ÇALIŞTIRIN (sadece listeler, hiçbir şey değiştirmez):
--
-- with gecerli as (
--     select cp.*,
--            coalesce(nullif(cp.net_price_2, 0), cp.net_price) as guncel_fiyat
--     from customer_prices cp
-- ),
-- medyan as (
--     select coalesce(product_id::text, product_name) as urun_anahtari,
--            currency,
--            percentile_cont(0.5) within group (order by guncel_fiyat) as med,
--            count(*) as musteri_sayisi
--     from gecerli
--     where guncel_fiyat > 0
--     group by 1, 2
--     having count(*) >= 2
-- )
-- select c.company_name, g.product_name, g.currency,
--        g.guncel_fiyat, round(m.med::numeric, 2) as medyan
-- from gecerli g
-- join medyan m
--   on m.urun_anahtari = coalesce(g.product_id::text, g.product_name)
--  and m.currency = g.currency
-- join customers c on c.id = g.customer_id
-- where g.guncel_fiyat > 0
--   and g.guncel_fiyat < m.med * 0.20
-- order by c.company_name, g.product_name;

-- LİSTE DOĞRUYSA bu update'i açın (yukarıdaki with bloğunu aynen kullanır):
--
-- with gecerli as (
--     select cp.id, cp.product_id, cp.product_name, cp.currency,
--            coalesce(nullif(cp.net_price_2, 0), cp.net_price) as guncel_fiyat
--     from customer_prices cp
-- ),
-- medyan as (
--     select coalesce(product_id::text, product_name) as urun_anahtari,
--            currency,
--            percentile_cont(0.5) within group (order by guncel_fiyat) as med
--     from gecerli
--     where guncel_fiyat > 0
--     group by 1, 2
--     having count(*) >= 2
-- )
-- update customer_prices cp
--    set is_symbolic = true
--   from gecerli g
--   join medyan m
--     on m.urun_anahtari = coalesce(g.product_id::text, g.product_name)
--    and m.currency = g.currency
--  where cp.id = g.id
--    and g.guncel_fiyat > 0
--    and g.guncel_fiyat < m.med * 0.20;

-- ============================================================
-- 4) Kontrol
-- ============================================================
-- select is_symbolic, count(*) from customer_prices group by 1;
