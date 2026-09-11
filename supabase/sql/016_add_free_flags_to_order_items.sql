-- Sipariş kalemleri — "Bedelsiz" ve "CN sebebiyle düzenlenmiş fiyat" işaretleri
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- GEREKÇE
-- Bedelsiz ürün gönderimi faturasal olarak 0 tutarla yapılamıyor; bu yüzden
-- kalem liste fiyatının %99 iskontolusuyla girilir (ör. 218,00 $ liste ->
-- 2,00 $). Girilen tutar GERÇEKTİR — fatura ve kalem toplamı ona göre oluşur,
-- bu yüzden sıfırlanamaz. Ama bir PAZARLIK FİYATI DEĞİLDİR; fiyat istatistiğine
-- girdiğinde aynı üründe %96-99 sapma üretir.
--
-- Aynı şekilde, bedelsiz kalemin tutarı bazen siparişin BAŞKA bir kaleminden
-- düşülür. O kalemin birim fiyatı da artık anlaşılan fiyat değildir. Müşteri
-- Sabit Fiyatlar'da gerçek fiyat korunduğu için (bilinçli tercih) fark yalnız
-- sipariş kaleminde kalır ve yine sahte sapma üretir.
--
-- İki durum ayrı işaretlenir: biri "bu satır bedelsiz gönderim", diğeri "bu
-- satırın fiyatı bir CN yüzünden elle düzenlendi". İkisi de fiyat
-- istatistiklerinden çıkarılır, ama ciro/adet toplamlarında kalır — o para
-- fiilen faturalanmıştır.
--
-- Sezgisel kural (fiyat < listenin %X'i) bilerek KULLANILMADI: uygulamada
-- iskonto %99'a tam sabitlenmiyor (218,00 -> 2,00 = %99,08; sabit fiyat
-- kartlarında 2.648,99 -> 91,32 = %96,6). Eşik er geç ya gerçek bir ucuz
-- kalemi bedelsiz sanar ya da gevşek girilmiş bedelsizi kaçırır. İşaret
-- kullanıcının kararıdır.
--
-- NOT: Bu kolonlar YOKKEN de modüller çalışır — orders.js kolonu yoklar,
-- bulamazsa işaret kutucuklarını gizler ve hiçbir yazma işlemine bu alanları
-- eklemez. Script çalıştıktan sonra Kalemler sekmesindeki "Fiyat Notu"
-- sütunu kullanılabilir hale gelir.

-- ============================================================
-- 1) Kolonlar
--    Mevcut satırların hepsi false olur — hiçbir kalem otomatik olarak
--    bedelsiz işaretlenmez. İşaretleme kullanıcının kararıdır.
-- ============================================================
alter table order_items
    add column if not exists is_free boolean not null default false;

alter table order_items
    add column if not exists cn_adjusted boolean not null default false;

comment on column order_items.is_free is
    'true ise bu kalem bedelsiz gönderimdir; unit_price faturasal zorunluluk nedeniyle girilmiş temsili tutardır (liste fiyatının ~%1''i) ve fiyat istatistiklerine katılmaz.';

comment on column order_items.cn_adjusted is
    'true ise bu kalemin birim fiyatı bir Credit Note nedeniyle elle düzenlenmiştir (ör. bedelsiz kalemin tutarı buradan düşülmüştür); anlaşılan fiyat değildir, fiyat istatistiklerine katılmaz.';

-- ============================================================
-- 2) İndeksler — analiz sorguları bu kolonlara göre eliyor
-- ============================================================
create index if not exists order_items_is_free_idx
    on order_items(is_free)
    where is_free;

create index if not exists order_items_cn_adjusted_idx
    on order_items(cn_adjusted)
    where cn_adjusted;

-- ============================================================
-- 3) Kontrol
-- ============================================================
-- select is_free, cn_adjusted, count(*) from order_items group by 1, 2;

-- ============================================================
-- 4) GERİYE DÖNÜK TARAMA — sadece listeler, hiçbir şey değiştirmez.
--    Aynı siparişte aynı ürün kodunun iki farklı fiyattan girildiği satırlar:
--    ucuz olan büyük ihtimalle işaretlenmemiş bir bedelsiz kalemdir.
--    Listeyi gördükten sonra işaretlemeyi ekrandan tek tek yapın.
-- ============================================================
-- with ayni_urun as (
--     select oi.order_id,
--            oi.product_code,
--            max(oi.unit_price) as en_yuksek,
--            min(oi.unit_price) as en_dusuk,
--            count(*)           as satir_sayisi
--     from order_items oi
--     where oi.product_code is not null
--       and oi.unit_price > 0
--     group by oi.order_id, oi.product_code
--     having count(*) > 1
--        and min(oi.unit_price) < max(oi.unit_price) * 0.20
-- )
-- select c.company_name,
--        o.order_number,
--        o.order_date,
--        oi.product_code,
--        oi.product_name,
--        oi.quantity,
--        oi.unit_price,
--        a.en_yuksek as ayni_siparisteki_normal_fiyat,
--        round((1 - oi.unit_price / a.en_yuksek) * 100, 1) as iskonto_yuzde
-- from order_items oi
-- join ayni_urun a
--   on a.order_id = oi.order_id
--  and a.product_code = oi.product_code
-- join orders o on o.id = oi.order_id
-- join customers c on c.id = o.customer_id
-- where oi.unit_price < a.en_yuksek * 0.20
--   and oi.is_free = false
-- order by c.company_name, o.order_date desc, oi.product_code;
