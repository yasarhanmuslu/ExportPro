-- Teklif kalemleri — "Bedelsiz" ve "CN sebebiyle düzenlenmiş fiyat" işaretleri
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- GEREKÇE
-- SQL 016 aynı işaretleri order_items'a eklemişti. Teklif kalemleri de aynı
-- mantıkla giriliyor: bedelsiz verilecek ürün, faturasal zorunluluk nedeniyle
-- liste fiyatının %99 iskontolusuyla yazılıyor.
--
-- Asıl sebep aktarım: teklif siparişe dönüştürüldüğünde kalemler birebir
-- order_items'a kopyalanıyor (quotations.js). İşaretler teklif tarafında
-- tutulmazsa dönüşümde kayboluyor ve kullanıcı aynı satırları sipariş
-- ekranında yeniden işaretlemek zorunda kalıyordu.
--
-- Alanlar tutarı DEĞİŞTİRMEZ. Ne sıfırlarlar ne kilitlerler; yalnızca "bu tutar
-- pazarlık fiyatı değildir" derler.
--
-- NOT: Kolonlar YOKKEN de modül çalışır — quotations.js kolonu yoklar,
-- bulamazsa "Fiyat Notu" sütununu gizler ve payload'a alan eklemez.

-- ============================================================
-- 1) Kolonlar
--    Mevcut satırların hepsi false olur — otomatik işaretleme yok.
-- ============================================================
alter table quotation_items
    add column if not exists is_free boolean not null default false;

alter table quotation_items
    add column if not exists cn_adjusted boolean not null default false;

comment on column quotation_items.is_free is
    'true ise bu kalem bedelsiz verilecektir; unit_price faturasal zorunluluk nedeniyle girilmiş temsili tutardır ve fiyat istatistiklerine katılmaz. Siparişe dönüşümde order_items.is_free olarak taşınır.';

comment on column quotation_items.cn_adjusted is
    'true ise bu kalemin birim fiyatı bir Credit Note nedeniyle düzenlenmiştir; anlaşılan fiyat değildir. Siparişe dönüşümde order_items.cn_adjusted olarak taşınır.';

-- ============================================================
-- 2) İndeksler
-- ============================================================
create index if not exists quotation_items_is_free_idx
    on quotation_items(is_free)
    where is_free;

create index if not exists quotation_items_cn_adjusted_idx
    on quotation_items(cn_adjusted)
    where cn_adjusted;

-- ============================================================
-- 3) Kontrol
-- ============================================================
-- select is_free, cn_adjusted, count(*) from quotation_items group by 1, 2;

-- ============================================================
-- 4) Geriye dönük tarama YOK — bilerek.
-- order_items için 018/019'da yapılan tarama, kalemi aynı belgedeki ya da
-- aynı ürünün diğer siparişlerdeki fiyatlarla karşılaştırıyordu. Teklif
-- kalemleri henüz satış değil; yanlış işaretlemenin bedeli, teklif siparişe
-- döndüğünde sipariş verisine taşınması olur. Mevcut teklifler azdır ve
-- ekrandan tek tek işaretlenebilir.
-- ============================================================
