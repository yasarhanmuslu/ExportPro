-- Geriye dönük bedelsiz kalem işaretleme
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- ÖNKOŞUL: supabase/sql/016_add_free_flags_to_order_items.sql çalıştırılmış olmalı.
-- İdempotent: tekrar çalıştırmak zarar vermez (zaten true olanı true yapar).
--
-- GEREKÇE
-- SQL 016'nın işaretleri eklendiğinde mevcut kayıtların hepsi false başladı.
-- İki tarama yapıldı (2026-09-11):
--   1) Aynı siparişte aynı ürün kodunun iki farklı fiyattan girildiği satırlar.
--   2) Kalem fiyatı, o ürünün tüm siparişlerdeki medyan fiyatının %20'sinin
--      altında olan satırlar (iptal ve bedelsiz siparişler hariç).
-- Toplam 11 aday çıktı; kullanıcı tek tek inceledi.
--
-- İŞARETLENMEYENLER — bilinçli karar:
--   Aldex / 2025-02 · 53-02-05-026 · 15 ad × 1,50 € (iki satır, medyan 8,00 €)
--   Gerçek satıştır, bedelsiz değildir. Fiyat istatistiğinde kalması DOĞRUdur;
--   sapma raporunda görünmeye devam edecek, bu bir hata değil.
--
-- Sezgisel kural KULLANILMIYOR: aşağıdaki 9 satır id ile tek tek yazılmıştır.
-- Eşleşme firma + sipariş no + ürün kodu + adet + birim fiyat ile doğrulandı,
-- her satır tam olarak bir kayda denk geldi.

-- ============================================================
-- 1) ÖNCE ÇALIŞTIRIN — ne değişeceğini gösterir, hiçbir şey değiştirmez
-- ============================================================
-- select c.company_name, o.order_number, oi.product_code,
--        oi.quantity, oi.unit_price, oi.currency, oi.is_free
-- from order_items oi
-- join orders o    on o.id = oi.order_id
-- join customers c on c.id = o.customer_id
-- where oi.id in (
--     'ce1a0aa9-1142-439d-a1ce-ab2badc53fe3',
--     '06f1cdb1-cb67-492d-b9f3-7dcdda4aa980',
--     'e22f65dd-9363-4373-ac28-ead162a5a6a0',
--     '805d793d-1bd3-43ff-ad57-738e540fc1ef',
--     '47c5a17b-c3bf-48f8-8ef4-80840463c8d9',
--     '67dfc83f-3b02-47d9-96ff-4c832c95cadd',
--     'e51c9dd7-dde6-4111-8e69-c9d840eb1899',
--     '5da8ee7e-41aa-47c8-b9d7-4f34a325c1b0',
--     '3b259bee-c04b-492b-9433-5670ef928127'
-- )
-- order by c.company_name, o.order_number, oi.product_code;

-- ============================================================
-- 2) İŞARETLEME — 9 satır
--    Birim fiyatlara DOKUNULMAZ. Tutarlar faturasal olarak doğrudur;
--    işaret yalnızca "bu tutar pazarlık fiyatı değildir" der.
-- ============================================================
update order_items
   set is_free = true
 where id in (
    'ce1a0aa9-1142-439d-a1ce-ab2badc53fe3',  -- Elasan  / 2026-01 · SETK3104-0315-001-1-6200 · 1 ad x    91,32 TRY (medyan 2.648,98)
    '06f1cdb1-cb67-492d-b9f3-7dcdda4aa980',  -- Elasan  / 2026-01 · SETK3104-2615-001-1-6000 · 1 ad x    51,22 TRY (medyan 2.854,46)
    'e22f65dd-9363-4373-ac28-ead162a5a6a0',  -- Ergüden / 2026-01 · 53-02-06-009             · 8 ad x     1,00 TRY (medyan   425,50)
    '805d793d-1bd3-43ff-ad57-738e540fc1ef',  -- Ergüden / 2026-01 · K3504-0315-001-1-0000    · 1 ad x     5,00 TRY (medyan 1.232,50)
    '47c5a17b-c3bf-48f8-8ef4-80840463c8d9',  -- Fiss    / 2026-02 · K0201-3505-001-1-0000    · 1 ad x     0,80 EUR (medyan     9,36)
    '67dfc83f-3b02-47d9-96ff-4c832c95cadd',  -- Qbik    / 2026-01 · 53-02-06-007             · 1 ad x     0,50 EUR (medyan    14,88)
    'e51c9dd7-dde6-4111-8e69-c9d840eb1899',  -- Qbik    / 2026-01 · 50-06-02-022             · 1 ad x     0,50 EUR (medyan     4,50)
    '5da8ee7e-41aa-47c8-b9d7-4f34a325c1b0',  -- Siko    / 2026-01 · K3204-2616-001-1-0000    · 1 ad x     1,00 EUR (medyan    13,00)
    '3b259bee-c04b-492b-9433-5670ef928127'   -- Siko    / 2026-01 · K3104-2616-001-1-0000    · 1 ad x     1,00 EUR (medyan    33,25)
 );

-- ============================================================
-- 3) KONTROL — 9 dönmeli
-- ============================================================
-- select count(*) from order_items where is_free;

-- ============================================================
-- 4) NOT — aynı gönderimlerin fiyat kartı tarafı
-- Bu 9 kaydın çoğunun Müşteri Sabit Fiyatlar karşılığı da temsili tutarla
-- duruyor (SQL 015'in yorumundaki liste: Elasan, Ergüden, Qbik, Fiss, Siko).
-- Orası ayrı bir kolon (customer_prices.is_symbolic) ve ayrı bir karardır;
-- bu script ona dokunmaz.
-- ============================================================
