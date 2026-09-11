-- Tekliflere "fatura altı indirim" alanı
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.
--
-- GEREKÇE
-- SQL 017 aynı alanları orders'a eklemişti. Teklif tarafında da gerekiyor:
-- kalem fiyatlarına dokunmadan, toplamdan toplu bir düşüm yapılan teklifler
-- var. Alan olmadığında kalem toplamı ile quotations.total_amount kasıtlı
-- olarak farklı kalıyor ve ekran "Kalem toplamı teklif tutarından farklı!"
-- diye uyarıyor — kayıt doğru olduğu halde hata sanılıyor.
--
-- Asıl sebep yine aktarım: teklif siparişe dönüştürüldüğünde alan
-- order_items/orders'a taşınır (quotations.js). Teklif tarafında tutulmazsa
-- dönüşümde kayboluyor ve sipariş ekranı aynı uyarıyı baştan veriyor.
--
-- Alan farkı AÇIKLAR, hesaplamaz: total_amount zaten indirim sonrası tutardır.
--
-- NOT: Kolonlar YOKKEN de modül çalışır — quotations.js kolonu yoklar,
-- bulamazsa alanı gizler ve payload'a eklemez.

-- ============================================================
-- 1) Kolonlar
-- ============================================================
alter table quotations
    add column if not exists invoice_deduction numeric(14,2) not null default 0;

alter table quotations
    add column if not exists invoice_deduction_note text;

comment on column quotations.invoice_deduction is
    'Fatura altı indirim: kalem toplamından düşülüp total_amount''a ulaşılan tutar. total_amount ZATEN bu indirim sonrasıdır — bu kolon farkı açıklar, yeniden hesaplamaz. Siparişe dönüşümde orders.invoice_deduction olarak taşınır.';

comment on column quotations.invoice_deduction_note is
    'Fatura altı indirimin sebebi.';

-- ============================================================
-- 2) İndeks
-- ============================================================
create index if not exists quotations_invoice_deduction_idx
    on quotations(invoice_deduction)
    where invoice_deduction <> 0;

-- ============================================================
-- 3) ADAY TEKLİFLER — sadece listeler, hiçbir şey değiştirmez.
--    Kalem toplamı teklif tutarından FAZLA olan teklifler. KDV kaynaklı
--    farklar (oran 1,20) hariç tutuldu — onlar indirim değil.
-- ============================================================
-- with kalem as (
--     select quotation_id, sum(quantity * unit_price) as kalem_toplami
--     from quotation_items
--     group by quotation_id
-- )
-- select c.company_name,
--        q.quotation_number,
--        q.quotation_date,
--        q.currency,
--        k.kalem_toplami,
--        q.total_amount,
--        round((k.kalem_toplami - q.total_amount)::numeric, 2) as fark
-- from quotations q
-- join kalem k     on k.quotation_id = q.id
-- join customers c on c.id = q.customer_id
-- where k.kalem_toplami - q.total_amount > 0.5
--   and q.invoice_deduction = 0
--   and abs(q.total_amount / nullif(k.kalem_toplami, 0) - 1.20) > 0.005
-- order by c.company_name, q.quotation_date desc;

-- ============================================================
-- 4) Kontrol
-- ============================================================
-- select count(*) filter (where invoice_deduction <> 0) as indirimli,
--        count(*) as toplam
-- from quotations;
