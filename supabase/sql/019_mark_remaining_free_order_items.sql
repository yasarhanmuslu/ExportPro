-- Geriye dönük bedelsiz kalem işaretleme — ikinci tur
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- ÖNKOŞUL: 016 ve 018 çalıştırılmış olmalı.
-- İdempotent: tekrar çalıştırmak zarar vermez.
--
-- GEREKÇE — 018'in kaçırdıkları
-- 018'i besleyen tarama, bir kalemi ürünün TÜM siparişlerdeki medyan fiyatıyla
-- karşılaştırıyordu ve karşılaştırma için ürünün en az iki fiyat kaydı olmasını
-- şart koşuyordu. Bir ürün sistemde yalnızca bir kez geçiyorsa (ki numune /
-- bedelsiz gönderimlerde sık oluyor) elekten hiç geçmiyordu. Kullanıcının
-- 018'den sonra elle işaretlediği 6 satırın tamamı bu sınıftandı.
--
-- Bu tur SİPARİŞ İÇİ karşılaştırma yapan bir tarama kullandı: kalem fiyatı,
-- aynı siparişteki işaretsiz kalemlerin medyanının %10'unun altındaysa aday.
-- Kural doğrulandı — o an işaretli 15 satırın 13'ünü kendi başına buldu.
--
-- 7 yeni aday çıktı, her biri ürünün BAŞKA siparişlerdeki fiyatıyla çapraz
-- kontrol edildi. 5'i onaylandı, 2'si elendi.
--
-- ELENENLER — sipariş içi medyan yanılttı, ikisi de GERÇEK FİYAT:
--   Aldex / 2023-03 · 53-01-02-001 · 24 ad x 3,67 EUR
--     Aynı ürün Aldex 2025-02'de 20 ad x 3,50 EUR. Sipariş medyanı 43,09 olduğu
--     için ucuz görünüyor; oysa bu kalem gerçekten ucuz bir iç takım.
--   Fisnik Mullaj / 2026-01 · 50-06-02-022 · 30 ad x 4,50 EUR
--     Aynı ürün Siko'da 5,45 EUR, Abid Med'de 5,00 USD. Gerçek fiyat.
--     (Qbik'in aynı üründen 1 ad x 0,50 EUR satırı bedelsiz olarak işaretli —
--      tutarlı: 4,50 normal, 0,50 sembolik.)
--
-- Bu iki satır bilerek işaretlenmiyor. Fiyat istatistiğinde kalmaları DOĞRU.

-- ============================================================
-- 1) ÖNCE ÇALIŞTIRIN — ne değişeceğini gösterir, hiçbir şey değiştirmez
-- ============================================================
-- select c.company_name, o.order_number, oi.product_code, oi.product_name,
--        oi.quantity, oi.unit_price, oi.currency, oi.is_free
-- from order_items oi
-- join orders o    on o.id = oi.order_id
-- join customers c on c.id = o.customer_id
-- where oi.id in (
--     'c824b6f0-057d-4542-beee-cf886e3d8890',
--     'ed2f7c4a-1e89-4501-a571-db44cb0d5ed3',
--     '8a4f05df-3d78-45f3-8db3-df9234de1ae0',
--     '85ba013d-f3c6-43d3-8a3c-a300e18a1287',
--     '3da0f6e5-847c-478f-a0c0-e012319b097a'
-- )
-- order by c.company_name, o.order_number;

-- ============================================================
-- 2) İŞARETLEME — 5 satır. Birim fiyatlara DOKUNULMAZ.
-- ============================================================
update order_items
   set is_free = true
 where id in (
    'c824b6f0-057d-4542-beee-cf886e3d8890',  -- Abid Med / 2026-01 · K2801-0505-001-1-0000 · Vega Lavabo (50x65)         · 1 ad x 1,04 USD (sipariş medyanı    15,50)
    'ed2f7c4a-1e89-4501-a571-db44cb0d5ed3',  -- Abid Med / 2026-01 · K0201-6805-001-1-0000 · Hera Semi-Countertop Lavabo · 1 ad x 1,22 USD (sipariş medyanı    15,50)
    '8a4f05df-3d78-45f3-8db3-df9234de1ae0',  -- Ergüden  / 2026-01 · K3205-0300-145-1-0000 · Alfa/Halley/Nova Rezervuar  · 1 ad x 2,00 TRY (sipariş medyanı 1.144,00)
    '85ba013d-f3c6-43d3-8a3c-a300e18a1287',  -- Ergüden  / 2026-01 · K3104-0315-145-1-0000 · Alfa Duvara Sıfır Klozet    · 1 ad x 5,00 TRY (sipariş medyanı 1.144,00)
    '3da0f6e5-847c-478f-a0c0-e012319b097a'   -- Qbik     / 2026-02 · K3205-0300-001-1-0000 · Alfa/Halley/Nova Rezervuar  · 1 ad x 1,00 EUR (sipariş medyanı    79,00)
 );

-- ============================================================
-- 3) KONTROL — 20 dönmeli (9 x 018 + 6 elle + 5 bu script)
-- ============================================================
-- select count(*) from order_items where is_free;

-- ============================================================
-- 4) NOT — Credit Notes tarafı bu işi besleyemiyor
-- Credit Notes'ta compensation_type = 'Bedelsiz' olan 27 kalem var, ama
-- 18'inin bağlı olduğu CN'de target_order_id boş ve çoğu 2023-2024
-- siparişlerine işaret ediyor; o siparişlerde hiç kalem girilmemiş.
-- Kalem eşleşmesi bulunabilen yalnızca 7 kalem var, onların da adayları
-- tam fiyatlı satırlar. Yani "CN'de bedelsiz denen kalemi siparişte bul"
-- otomasyonu bugünkü veriyle güvenilir çalışmaz; bedelsiz satır siparişe
-- girilirken ekrandan işaretlenmeli.
-- ============================================================
