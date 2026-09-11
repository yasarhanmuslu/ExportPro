-- Siparişlere "fatura altı indirim" alanı
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- GEREKÇE
-- Bedelsiz/CN telafisi iki yoldan biriyle yapılıyor:
--   (a) Kalem bazında — bedelsiz satır eklenir ya da bir kalemin fiyatı düşürülür.
--       Bunlar SQL 016'daki order_items.is_free / cn_adjusted ile işaretleniyor.
--   (b) FATURA ALTI — kalem fiyatlarına hiç dokunulmaz, CN tutarı faturanın
--       altından toplu olarak düşülür.
--
-- (b) durumunda kalem toplamı ile orders.total_amount kasıtlı olarak farklıdır:
--   Gresia 2 / 2026-02 → kalem toplamı 5.460,00 €, sipariş tutarı 4.791,12 €,
--   aradaki 668,88 € o siparişe işlenmiş Credit Note'un tutarı.
--
-- Bu fark bugün sistemde bir YERE YAZILMIYOR. Sonuçları:
--   • Sipariş ekranı "Kalem toplamı sipariş tutarından farklı!" diye uyarıyor —
--     kayıt doğru olduğu halde hata sanılıyor.
--   • Satış & Fiyat Analizi mutabakatı bu siparişi "kalem toplamı tutmuyor"
--     kutusuna atıyor (warn), gerçek veri hatalarının arasında kayboluyor.
--
-- Alan bu farkı AÇIKLAR; hesaplamaz. total_amount zaten indirim SONRASI tutardır
-- ve öyle kalır — remaining_balance hesabı değişmez.
--
-- NOT: Kolonlar YOKKEN de modüller çalışır (orders.js kolonu yoklar, bulamazsa
-- alanı gizler ve payload'a eklemez).

-- ============================================================
-- 1) Kolonlar
-- ============================================================
alter table orders
    add column if not exists invoice_deduction numeric(14,2) not null default 0;

alter table orders
    add column if not exists invoice_deduction_note text;

comment on column orders.invoice_deduction is
    'Fatura altı indirim: kalem toplamından düşülüp total_amount''a ulaşılan tutar (genellikle siparişe işlenmiş Credit Note). total_amount ZATEN bu indirim sonrasıdır — bu kolon farkı açıklar, yeniden hesaplamaz.';

comment on column orders.invoice_deduction_note is
    'Fatura altı indirimin sebebi — ör. "CN 62 mahsubu".';

-- ============================================================
-- 2) İndeks — mutabakat sorguları sıfırdan farklı olanları arıyor
-- ============================================================
create index if not exists orders_invoice_deduction_idx
    on orders(invoice_deduction)
    where invoice_deduction <> 0;

-- ============================================================
-- 3) Kontrol
-- ============================================================
-- select count(*) filter (where invoice_deduction <> 0) as indirimli,
--        count(*) as toplam
-- from orders;

-- ============================================================
-- 4) ADAY SİPARİŞLER — sadece listeler, hiçbir şey değiştirmez.
--    Kalem toplamı sipariş tutarından FAZLA olan ve aradaki farkın tam olarak
--    o siparişe işlenmiş bir Credit Note tutarına eşit olduğu siparişler.
--    Bunlar fatura altı indirim uygulanmış siparişlerdir; listeyi görüp
--    alanı ekrandan doldurabilirsiniz.
-- ============================================================
-- with kalem as (
--     select order_id, sum(quantity * unit_price) as kalem_toplami
--     from order_items
--     group by order_id
-- ),
-- cn as (
--     select target_order_id, sum(coalesce(total_amount, 0)) as cn_toplami
--     from credit_notes
--     where target_order_id is not null
--       and process_status <> 'İptal'
--     group by target_order_id
-- )
-- select c.company_name,
--        o.order_number,
--        o.order_date,
--        o.currency,
--        k.kalem_toplami,
--        o.total_amount,
--        round((k.kalem_toplami - o.total_amount)::numeric, 2) as fark,
--        cn.cn_toplami
-- from orders o
-- join kalem k on k.order_id = o.id
-- join customers c on c.id = o.customer_id
-- left join cn on cn.target_order_id = o.id
-- where k.kalem_toplami - o.total_amount > 0.5
--   and o.invoice_deduction = 0
--   and abs(k.kalem_toplami - o.total_amount - coalesce(cn.cn_toplami, 0)) < 0.5
-- order by c.company_name, o.order_date desc;
