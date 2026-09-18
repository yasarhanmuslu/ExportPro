-- 028_import_order_invoices.sql
-- Sistemdeki siparişlerin FATURALARI, İnci Hanım'ın "ödeme takip" tablosundan.
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent: faturası zaten olan
-- siparişe ve zaten kayıtlı fatura numarasına dokunmaz.
-- ÖN KOŞUL: 027 (order_invoices tablosu) çalıştırılmış olmalı.
--
-- ── KAPSAM ────────────────────────────────────────────────────────────────────
-- Sistemdeki 117 siparişten İdeal no'su olan 113'ünün hepsi tabloda bulundu.
-- Tabloda bu siparişlere ait 101 fatura satırı var (no + tarih + tutar dolu).
--   • 86 fatura AKTARILIYOR:
--       - 74'ü birebir uyumlu (para birimi, tutar, vade),
--       - 11'inde yalnızca vade farklı: sistemdeki vade sevk tarihinden elle
--         hesaplanmıştı, burada FATURA tarihinden hesaplanmış vade yazılıyor
--         (kural bu). Çoğunda fark 1-3 gün; Artvit 2025-04'te 46 gün (fatura
--         sevkten 47 gün sonra kesilmiş).
--       - 1'inde 1,16 TRY yuvarlama farkı (Regata 2026-01).
--   • 13 satır BEKLİYOR (bu script almıyor): tutar farkı, fatura no tekrarı,
--     para birimi uyuşmazlığı (ihraç kayıtlı). Liste masaüstünde:
--     "FATURA AKTARIMI - Karar Bekleyen 13 Satır.xlsx"
--   • 2 satır ATLANDI: Insteel 2026-25'in iki faturası 027 ile girildi.
--
-- Tablonun en altındaki fatura no/tarihi OLMAYAN satırlar fatura değil; henüz
-- faturalanmamış siparişlerin takip satırları. Alınmadı. Bu siparişler (Tumpex,
-- Owadan, Paffoni 2026-04, Insteel 2026-27, 2ag 2026-02 ...) modülde doğru olarak
-- "henüz faturalanmadı" görünecek.
--
-- Vade: tablonun "vade son tarih" sütunu. Boş olanlarda (peşin, mal mukabili,
-- Insteel çek) due_date boş kalır.
--
-- Toplam aktarılan: EUR 371,341.56, TRY 5,719,799.68, USD 162,674.78

with src (ideal, invoice_no, invoice_date, amount, currency, due_date, excel_row) as (
    values
        ('3474', 'IHR2023000000075', date '2023-08-18', 3456.22, 'EUR', date '2023-11-16', 289),
        ('6495', 'IHR2025000000027', date '2025-04-14', 16463.66, 'EUR', date '2025-06-13', 502),
        ('7287', 'IHR2025000000070', date '2025-09-02', 15355.52, 'EUR', date '2025-11-01', 569),
        ('7221', 'IHR2025000000072', date '2025-09-03', 13446.00, 'USD', null, 571),
        ('7478', 'IHR2025000000082', date '2025-11-12', 10108.80, 'EUR', date '2026-01-11', 588),
        ('7454', 'IHR2025000000084', date '2025-11-19', 8208.00, 'USD', date '2026-01-18', 589),
        ('7845', 'IDL2025000002575-76', date '2025-12-24', 172177.02, 'TRY', null, 598),
        ('7858', 'IDL2025000002574', date '2025-12-24', 243994.35, 'TRY', null, 599),
        ('7857', 'IDL2025000002577', date '2025-12-24', 58445.96, 'TRY', null, 600),
        ('7753', 'IHR2026000000001', date '2026-01-21', 8192.55, 'EUR', null, 601),
        ('7992', 'IDL2026000000142', date '2026-01-26', 12818.03, 'TRY', null, 602),
        ('7991', 'IDL2026000000141', date '2026-01-26', 2229.00, 'TRY', null, 603),
        ('7917', 'IDL2026000000166-67', date '2026-01-29', 666047.64, 'TRY', null, 604),
        ('7849', 'IHR2026000000002', date '2026-01-29', 10108.80, 'EUR', date '2026-03-29', 605),
        ('8029', 'IDL2026000000200', date '2026-02-02', 22573.79, 'TRY', null, 606),
        ('7885', 'IHR2026000000003', date '2026-02-03', 364728.21, 'TRY', null, 607),
        ('7726', 'IHR2026000000005', date '2026-02-09', 26986.40, 'USD', date '2026-05-07', 608),
        ('7929', 'AID2026000000018', date '2026-02-12', 34496.00, 'USD', null, 610),
        ('8116', 'IDL2026000000361', date '2026-02-19', 316.00, 'USD', null, 612),
        ('7892', 'IHR2026000000008', date '2026-02-20', 17938.84, 'EUR', date '2026-04-21', 613),
        ('8136', 'IDL2026000000375', date '2026-02-20', 2933.79, 'TRY', null, 614),
        ('8079', 'IHR2026000000009', date '2026-02-23', 1630.32, 'EUR', date '2026-04-24', 615),
        ('8018', 'IHR2026000000010', date '2026-02-25', 5710.00, 'EUR', null, 616),
        ('8121', 'IHR2026000000011', date '2026-02-25', 9198.00, 'EUR', date '2026-04-26', 617),
        ('8177', 'IHR2026000000012', date '2026-02-27', 155.00, 'EUR', null, 618),
        ('8118', 'IHR2026000000013', date '2026-03-03', 1840.13, 'EUR', null, 619),
        ('8123', 'IHR2026000000014', date '2026-03-09', 4428.00, 'EUR', date '2026-05-08', 620),
        ('8207', 'IHR2026000000015', date '2026-03-09', 1650.88, 'EUR', date '2026-05-08', 621),
        ('8111', 'IHR2026000000016', date '2026-03-10', 26596.84, 'EUR', null, 622),
        ('8271', 'IDL2026000000578', date '2026-03-17', 6327.08, 'TRY', null, 623),
        ('8187', 'IHR2026000000017', date '2026-03-18', 5940.00, 'EUR', null, 624),
        ('8261', 'IDL2026000000587', date '2026-03-18', 3497.82, 'TRY', null, 625),
        ('8051', 'IDL2026000000603', date '2026-03-25', 138631.54, 'TRY', null, 626),
        ('8304', 'IHR2026000000018', date '2026-04-01', 9300.00, 'EUR', null, 627),
        ('7615', 'IHR2026000000020', date '2026-04-01', 3705.50, 'EUR', null, 629),
        ('8206', 'IHR2026000000021', date '2026-04-01', 15955.85, 'EUR', date '2026-05-31', 630),
        ('8312', 'IDL2026000000683', date '2026-04-03', 139467.45, 'TRY', null, 631),
        ('8313', 'IDL2026000000684', date '2026-04-03', 22398.27, 'TRY', null, 632),
        ('8363', 'IDL2026000000723', date '2026-04-07', 3740.58, 'TRY', null, 633),
        ('8386', 'IDL2026000000773', date '2026-04-13', 4388.40, 'TRY', null, 634),
        ('8112', 'IHR2026000000023', date '2026-04-14', 39118.20, 'EUR', null, 635),
        ('7687', 'IHR2026000000024', date '2026-04-16', 13334.80, 'EUR', null, 636),
        ('8399', 'IDL2026000000823', date '2026-04-20', 21793.45, 'TRY', null, 637),
        ('8414', 'IDL2026000000824', date '2026-04-20', 23133.80, 'TRY', null, 638),
        ('8329', 'IHR2026000000026', date '2026-04-24', 18654.90, 'EUR', null, 639),
        ('8268', 'IHR2026000000027', date '2026-04-28', 10108.80, 'EUR', date '2026-06-27', 640),
        ('8463', 'IDL2026000000891', date '2026-04-29', 2576.00, 'USD', null, 641),
        ('8411', 'IHR2026000000028', date '2026-05-04', 7287.60, 'EUR', null, 642),
        ('8249', 'IHR2026000000030', date '2026-05-15', 9632.04, 'USD', null, 644),
        ('8561', 'IDL2026000001065', date '2026-05-20', 1380.83, 'TRY', null, 645),
        ('8475', 'IDL2026000001115', date '2026-06-03', 18032.00, 'USD', null, 647),
        ('8487', 'IHR2026000000032', date '2026-06-04', 978146.08, 'TRY', null, 648),
        ('8589', 'IDL2026000001146', date '2026-06-09', 150123.88, 'TRY', null, 649),
        ('8586', 'IDL2026000001166', date '2026-06-11', 84750.62, 'TRY', null, 650),
        ('8628', 'IDL2026000001168', date '2026-06-11', 87487.33, 'TRY', null, 652),
        ('8602', 'IHR2026000000034', date '2026-06-17', 16362.00, 'EUR', null, 654),
        ('8585', 'IDL2026000001210', date '2026-06-18', 74.00, 'USD', null, 656),
        ('8666', 'IDL2026000001222', date '2026-06-19', 32744.36, 'TRY', null, 657),
        ('8550', 'IHR2026000000035', date '2026-06-23', 118.00, 'EUR', null, 658),
        ('8644', 'IHR2026000000036', date '2026-06-25', 4791.12, 'EUR', null, 662),
        ('8667', 'IDL2026000001275', date '2026-06-26', 97251.00, 'TRY', null, 663),
        ('8687', 'IDL2026000001295', date '2026-06-29', 261904.80, 'TRY', null, 664),
        ('8664', 'IHR2026000000037', date '2026-07-02', 3791.57, 'EUR', null, 665),
        ('7893', 'IHR2026000000038', date '2026-07-02', 19293.16, 'EUR', date '2026-08-31', 666),
        ('8695', 'IHR2026000000039', date '2026-07-10', 18694.54, 'EUR', null, 667),
        ('8779', 'IDL2026000001392', date '2026-07-13', 58520.00, 'TRY', null, 668),
        ('8788', 'IDL2026000001398', date '2026-07-14', 648.00, 'TRY', null, 669),
        ('8751', 'IHR2026000000040', date '2026-07-17', 4909.00, 'EUR', null, 670),
        ('8608', 'IHR2026000000041', date '2026-07-17', 5086.80, 'EUR', date '2026-10-15', 671),
        ('8564', 'IHR2026000000042', date '2026-07-21', 11268.60, 'EUR', null, 672),
        ('8447', 'IHR2026000000043', date '2026-07-21', 29480.34, 'USD', date '2026-10-19', 673),
        ('8797', 'IDL2026000001435', date '2026-07-21', 141051.00, 'TRY', null, 674),
        ('8798', 'IDL2026000001453', date '2026-07-23', 434184.00, 'TRY', null, 675),
        ('8828', 'IDL2026000001469', date '2026-07-27', 7120.80, 'TRY', null, 676),
        ('8668', 'IHR2026000000044', date '2026-07-28', 10108.80, 'EUR', date '2026-09-26', 677),
        ('8696', 'IHR2026000000045-46', date '2026-07-28', 11969.00, 'EUR', null, 678),
        ('8848', 'IDL2026000001503', date '2026-07-30', 33120.00, 'TRY', null, 679),
        ('8807', 'IHR2026000000047', date '2026-08-05', 1652.00, 'EUR', null, 680),
        ('8822', 'IHR2026000000048', date '2026-08-13', 18828.00, 'USD', null, 683),
        ('8759', 'IHR2026000000049', date '2026-08-20', 6557.76, 'EUR', date '2026-11-18', 685),
        ('8819', 'IHR2026000000050', date '2026-08-20', 1216340.00, 'TRY', null, 686),
        ('8957', 'IDL2026000001687', date '2026-08-31', 44808.00, 'TRY', null, 687),
        ('8896', 'IDL2026000001686', date '2026-08-31', 158064.00, 'TRY', null, 688),
        ('8947', 'IHR2026000000051', date '2026-09-01', 500.00, 'EUR', null, 689),
        ('8897', 'IDL2026000001745', date '2026-09-09', 22828.80, 'TRY', null, 690),
        ('9043', 'IDL2026000001777', date '2026-09-15', 600.00, 'USD', null, 693)
),
eslesen as (
    select o.id as order_id, o.user_id, s.*
      from src s
      join orders o
        on ltrim(regexp_replace(coalesce(o.ideal_order_no, ''), '\D', '', 'g'), '0') = s.ideal
     where not exists (select 1 from order_invoices i where i.order_id = o.id)
)
insert into order_invoices (user_id, order_id, invoice_no, invoice_date, amount, currency, due_date, notes)
select user_id, order_id, invoice_no, invoice_date, amount, currency, due_date,
       'İnci Hanım''ın ödeme takip tablosundan aktarıldı (satır ' || excel_row || ')'
  from eslesen
on conflict (user_id, invoice_no) where invoice_no is not null do nothing;

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Kaç fatura girdi? (86 + Insteel'in 2'si = 88 olmalı)
-- select count(*) as fatura, count(distinct order_id) as siparis from order_invoices;

-- 2) Faturası olmayan siparişler
--    (beklenen: henüz faturalanmamışlar + bekleyen 13 satırdaki siparişler)
-- select c.company_name, o.order_number, o.order_date, o.currency, o.total_amount, o.status_tags
--   from orders o join customers c on c.id = o.customer_id
--  where not exists (select 1 from order_invoices i where i.order_id = o.id)
--  order by o.order_date desc;

-- 3) Fatura toplamı sipariş tutarından farklı olanlar (kısmi sevkiyat ya da tutar hatası)
-- select c.company_name, o.order_number, o.currency, o.total_amount,
--        sum(i.amount) as faturalanan, round(o.total_amount - sum(i.amount), 2) as fark
--   from orders o
--   join customers c on c.id = o.customer_id
--   join order_invoices i on i.order_id = o.id
--  group by c.company_name, o.order_number, o.currency, o.total_amount
-- having abs(o.total_amount - sum(i.amount)) > 2
--  order by c.company_name;
