-- 029_invoice_decisions_export_registered.sql
-- "FATURA AKTARIMI - Karar Bekleyen 13 Satır" kararlarının uygulanması.
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent: aynı fatura numarası
-- ikinci kez girilmez.
-- ÖN KOŞUL: 027 ve 028 çalıştırılmış olmalı.
--
--   1) order_invoices'a İHRAÇ KAYITLI satış alanları (kur + sipariş para birimi karşılığı)
--   2) Karar verilen faturalar
--   3) Bu script'in DOKUNMADIĞI iki konu (en altta)

-- ============================================================
-- 1) İHRAÇ KAYITLI SATIŞ — kur alanları
--
-- Karar (17.09.2026): Sipariş USD olarak kalır. Fatura, anlaşılan banka kuruyla
-- TL kesilir ve müşteri TL öder. Yani:
--     fatura tutarı  = TL (belgede yazan)
--     alacağın özü   = sipariş para birimi (USD) — kur o faturaya sabitlenmiştir
--
-- amount_order_currency: faturanın sipariş para birimindeki karşılığı.
--   Siparişin "faturalanan / henüz faturalanmayan" hesabı bu alanla yapılır;
--   TL ile USD asla toplanmaz.
-- Fatura para birimi sipariş para birimiyle AYNIYSA bu iki alan boş kalır.
-- ============================================================
alter table order_invoices
    add column if not exists fx_rate               numeric(14,6),
    add column if not exists amount_order_currency numeric(14,2);

comment on column order_invoices.fx_rate is
    'İhraç kayıtlı satışta faturanın kesildiği anlaşmalı kur (1 birim sipariş para birimi = fx_rate birim fatura para birimi). Aynı para biriminde boş.';
comment on column order_invoices.amount_order_currency is
    'Faturanın sipariş para birimindeki karşılığı. Faturalanan/faturalanmayan hesabı bu alanla yapılır. Aynı para biriminde boş (= amount).';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'order_invoices_fx_pair_chk') then
        alter table order_invoices add constraint order_invoices_fx_pair_chk
            check ((fx_rate is null) = (amount_order_currency is null));
    end if;
end $$;

-- ============================================================
-- 2) FATURALAR
--
-- İhraç kayıtlı siparişlerde:
--   • Tek faturalı siparişte karşılık = sipariş tutarı (kur yuvarlaması
--     "faturalanmamış 0,15 USD" gibi sahte bir kalıntı bırakmasın diye).
--   • Çok faturalı siparişte karşılık = TL / kur; SON fatura kalan kuruşu
--     üstlenir, toplam sipariş tutarına tam eşit olur.
-- ============================================================
with src (ideal, invoice_no, invoice_date, amount, currency, fx_rate, amount_oc, due_date, notes) as (
    values
    -- ── İhraç kayıtlı, tek fatura ──
    ('8680', 'IDL2026000001260', date '2026-06-24', 24495.44::numeric, 'TRY', 46.4935::numeric, 527.00::numeric, null::date,
     'İhraç kayıtlı: 46,4935 kur karşılığı TL ödeme. Sipariş 527 USD.'),
    ('8672', 'IDL2026000001211', date '2026-06-18', 55554.96, 'TRY', 46.1549, 1200.00, null,
     'İhraç kayıtlı: 46,1549 kur karşılığı TL ödeme. Sipariş 1.200 USD (TL/kur = 1.203,66; sipariş tutarı esas).'),
    ('8573', 'IDL2026000001167', date '2026-06-11', 880335.49, 'TRY', 46.1549, 19073.50, null,
     'İhraç kayıtlı: 46,1549 kur karşılığı TL ödeme. Sipariş 19.073,50 USD.'),

    -- ── İhraç kayıtlı, Garanti Girişim 2026-01: 2 sevk, toplam 39.780 USD ──
    ('8681', 'IDL2026000001247-48', date '2026-06-23', 1009934.82, 'TRY', 46.4808,
     round(1009934.82 / 46.4808, 2), null,
     '1. sevk (IDL2026000001247 + IDL2026000001248, iki fatura tek tutar). İhraç kayıtlı: 46,4808 kur.'),
    ('8681', 'IDL2026000001267', date '2026-06-25', 839300.66, 'TRY', 46.4935,
     39780.00 - round(1009934.82 / 46.4808, 2), null,
     '2. sevk. İhraç kayıtlı: 46,4935 kur. Fatura no patron tarafından düzeltildi (tabloda IDL2026000001274-75 yazıyordu); tarih tablodan.'),

    -- ── İhraç kayıtlı, Çağdaş 2026-01: 3 sevk, toplam 67.026,50 USD ──
    -- Yalnızca 1. fatura giriliyor; 2. ve 3. faturanın TARİHİ bilinmiyor (tabloda yok).
    -- Tarihler gelince 2. fatura TL/kur, 3. fatura kalan kuruşu üstlenecek şekilde girilecek.
    ('8778', 'IDL2026000001548', date '2026-08-07', 1632683.87, 'TRY', 47.6133,
     round(1632683.87 / 47.6133, 2), null,
     '1. sevk. İhraç kayıtlı: 47,6133 kur. Sipariş 3 faturayla sevk edildi (IDL2026000001555: 1.511.093,79 TL @47,6085; IDL2026000001556: 47.418,07 TL @47,6085) — o ikisinin tarihi bekleniyor.'),

    -- ── Para birimi düzeltildi (sistemde EUR -> USD yapıldı) ──
    ('8037', 'IHR2026000000031', date '2026-05-22', 1466.88, 'USD', null, null, null, null),

    -- ── Fatura no tekrarı çözüldü ──
    ('8020', 'IHR2026000000006', date '2026-02-12', 9172.92, 'EUR', null, null, date '2026-05-13', null),
    ('8016', 'IHR2026000000007', date '2026-02-18', 18938.54, 'EUR', null, null, null,
     'Fatura no tabloda yanlışlıkla IHR2026000000006 yazılmıştı (Fiss 2026-01 ile aynı); patron düzeltti.'),

    -- ── Fiss 2025-06: İdeal no 0006966 -> 0007603 düzeltildi ──
    ('7603', 'IHR2025000000089', date '2025-12-10', 4399.66, 'EUR', null, null, date '2026-03-10', null),

    -- ── Tutar farkı: sistemdeki sipariş tutarı doğru (patron kararı) ──
    ('6775', 'IHR2026000000019', date '2026-04-01', 1812.00, 'EUR', null, null, null,
     'Tabloda 1.825,65 EUR yazıyordu; fatura tutarı 1.812,00 EUR (patron teyidi).'),
    ('8518', 'IHR2026000000033', date '2026-06-12', 7260.38, 'EUR', null, null, date '2026-09-10',
     'Tabloda 7.255,44 EUR yazıyordu; fatura tutarı 7.260,38 EUR (patron teyidi).'),
    ('8370', 'IHR2026000000029', date '2026-05-07', 18624.00, 'USD', null, null, null,
     'Tabloda 18.468,00 USD yazıyordu; fatura tutarı 18.624,00 USD (patron teyidi).')
)
insert into order_invoices
    (user_id, order_id, invoice_no, invoice_date, amount, currency, fx_rate, amount_order_currency, due_date, notes)
select o.user_id, o.id, s.invoice_no, s.invoice_date, s.amount, s.currency, s.fx_rate, s.amount_oc, s.due_date,
       coalesce(s.notes || ' | ', '') || 'Karar listesinden girildi (17.09.2026)'
  from src s
  join orders o
    on ltrim(regexp_replace(coalesce(o.ideal_order_no, ''), '\D', '', 'g'), '0') = s.ideal
on conflict (user_id, invoice_no) where invoice_no is not null do nothing;

-- ============================================================
-- 3) BU SCRIPT'İN DOKUNMADIĞI İKİ KONU
--
-- 3a) Çağdaş 2026-01 — 2. ve 3. faturanın tarihleri bekleniyor
--     IDL2026000001555  1.511.093,79 TL  @47,6085
--     IDL2026000001556     47.418,07 TL  @47,6085
--
-- 3b) FIS DOO — IHR2025000000089 için MÜKERRER ALACAK
--     024, bu faturayı sistemde siparişi yok sanıp manuel alacak olarak aldı
--     (1.081,37 EUR, "kısmi geldi"), çünkü o gün Fiss 2025-06'nın İdeal no'su
--     yanlıştı. Artık fatura siparişe bağlandı, ama sipariş sistemde KAPALI
--     (kalan 0) — manuel alacak ise 1.081,37 EUR AÇIK görünüyor.
--     Hangisinin doğru olduğuna göre ya manuel alacak kapatılacak ya da
--     sipariş bakiyesi açılacak.
-- ============================================================

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Toplam fatura: 88 + 13 = 101
-- select count(*) from order_invoices;

-- 2) İhraç kayıtlı siparişler: faturaların USD karşılığı toplamı = sipariş tutarı
--    (Çağdaş 2026-01 hariç — 2 faturası eksik)
-- select c.company_name, o.order_number, o.currency, o.total_amount,
--        sum(coalesce(i.amount_order_currency, i.amount)) as faturalanan
--   from orders o
--   join customers c on c.id = o.customer_id
--   join order_invoices i on i.order_id = o.id
--  where i.fx_rate is not null
--  group by c.company_name, o.order_number, o.currency, o.total_amount;
