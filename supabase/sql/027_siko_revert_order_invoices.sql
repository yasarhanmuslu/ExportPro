-- 027_siko_revert_order_invoices.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
-- ÖN KOŞUL: 022 ve 026 çalıştırılmış olmalı.
--
--   1) Siko 2026-01: 026'daki düzeltme GERİ ALINIR (kullanıcı kararı: sistem doğru)
--   2) order_invoices: bir siparişin birden çok faturası (kısmi sevkiyat)
--   3) Insteel 2026-25'in iki faturası girilir

-- ============================================================
-- 1) SIKO 2026-01 — 026 GERİ ALINIYOR
--
-- Mutabakatta "EXCEL DOĞRU" işaretlenmişti, 026 bu yüzden 7.888,60 € açık bakiye
-- yazdı. Sonradan karar değişti (16.09.2026): müşteriye göre alacak/verecek yok,
-- hata büyük ihtimalle İnci Hanım'ın manuel kaydında; patron kişisel olarak
-- inceleyecek. Sistem eski hâline döner: sipariş tamamen tahsil edilmiş.
--
-- Not: 026 iki kez çalıştırıldığı için açıklama notuna düzeltme metni iki kez
-- eklenmişti; not burada temiz hâline getiriliyor.
-- ============================================================
do $$
declare
    v_order uuid;
    v_total numeric(14,2);
    v_alloc uuid;
    v_pay   uuid;
begin
    select o.id, o.total_amount into v_order, v_total
      from orders o
      join customers c on c.id = o.customer_id
     where lower(c.company_name) like 'siko%'
       and o.order_number = '2026-01'
     limit 1;

    if v_order is null then
        raise notice 'Siko 2026-01 bulunamadı — atlandı.';
        return;
    end if;

    select a.id, a.payment_id into v_alloc, v_pay
      from payment_allocations a
      join payments p on p.id = a.payment_id
     where a.order_id = v_order and p.is_opening
     limit 1;

    if v_alloc is null then
        raise notice 'Siko 2026-01 açılış kaydı yok — atlandı.';
        return;
    end if;

    update payment_allocations
       set amount = v_total,
           notes  = 'Mutabakat 16.09.2026: 026 düzeltmesi geri alındı — sistem doğru kabul edildi, '
                 || 'Excel''deki 7.888,60 EUR açık kaydı patron tarafından ayrıca incelenecek.'
     where id = v_alloc;

    update payments
       set amount = v_total,
           notes  = 'Açılış bakiyesi — 2026-01 (ödeme tarihi sistemde tutulmuyordu)'
     where id = v_pay;

    raise notice 'Siko 2026-01 eski hâline döndü: tahsil edilen %, açık bakiye 0', v_total;
end $$;

-- ============================================================
-- 2) order_invoices — SİPARİŞİN FATURALARI
--
-- 022'de siparişe tek bir invoice_date / invoice_no alanı eklenmişti. Insteel
-- 2026-25 bunun yetmediğini gösterdi:
--     Sipariş toplamı 677.828,40 ₺
--       1. sevk faturası 133.291,20 ₺
--       2. sevk faturası 150.105,60 ₺
--       kalan 394.431,60 ₺ henüz sevk edilmedi
--
-- Muhasebe açısından alacak FATURA ile doğar ve vade her faturanın kendi
-- tarihinden işler. Kısmi sevkiyatlı bir siparişte tek vade tarihi yanlıştır —
-- Eximbank'lı bir müşteride bu, V.G.A.B tarihinin yanlış hesaplanması demektir.
--
-- Bu tablo ile modül şunu ayırt edebilecek:
--     faturalanmış açık alacak   = fatura toplamı - tahsilat   (vadesi, Eximbank tarihi var)
--     henüz sevk edilmemiş kısım = sipariş toplamı - fatura toplamı   (alacak değil)
--
-- Tek faturalı siparişlerde de aynı tablo kullanılır (tek satır). 022'deki
-- orders.invoice_date / invoice_no alanları hiç doldurulmadı, iki ayrı veri
-- kaynağı olmasın diye kaldırılıyor.
-- ============================================================
create table if not exists order_invoices (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null,
    order_id      uuid not null references orders(id) on delete cascade,
    invoice_no    text,
    invoice_date  date not null,
    amount        numeric(14,2) not null,
    currency      text not null,

    -- Vade bu faturanın tarihinden işler. Boşsa uygulama siparişin ödeme
    -- şeklindeki gün sayısıyla hesaplar (60 Gün Vade -> invoice_date + 60).
    -- Insteel gibi çekle ödeyen müşteride boş kalır; vade çekin vadesidir.
    due_date      date,

    notes         text,
    created_at    timestamptz not null default now(),

    constraint order_invoices_currency_chk check (currency in ('EUR','USD','TRY','GBP')),
    constraint order_invoices_amount_chk   check (amount <> 0)
);

comment on table order_invoices is
    'Siparişin kestiğimiz faturaları (kısmi sevkiyatta birden çok). Alacak ve vade fatura bazında doğar; siparişin faturalanmamış kısmı alacak değildir.';

create index if not exists order_invoices_order_idx on order_invoices (order_id, invoice_date);
create index if not exists order_invoices_due_idx   on order_invoices (user_id, due_date) where due_date is not null;
create unique index if not exists order_invoices_no_uidx
    on order_invoices (user_id, invoice_no) where invoice_no is not null;

alter table order_invoices enable row level security;

drop policy if exists order_invoices_select on order_invoices;
create policy order_invoices_select on order_invoices for select
    using (has_module_access(user_id,
        array['orders','payments','customer-score','profitability','order-timeline'], 'view'));
drop policy if exists order_invoices_insert on order_invoices;
create policy order_invoices_insert on order_invoices for insert
    with check (has_module_access(user_id, array['orders','payments'], 'edit'));
drop policy if exists order_invoices_update on order_invoices;
create policy order_invoices_update on order_invoices for update
    using (has_module_access(user_id, array['orders','payments'], 'edit'))
    with check (has_module_access(user_id, array['orders','payments'], 'edit'));
drop policy if exists order_invoices_delete on order_invoices;
create policy order_invoices_delete on order_invoices for delete
    using (has_module_access(user_id, array['orders','payments'], 'edit'));

-- 022'nin tek fatura alanları: SADECE hiç doldurulmamışsa kaldırılır.
do $$
begin
    if exists (select 1 from information_schema.columns
                where table_name = 'orders' and column_name = 'invoice_date') then
        if exists (select 1 from orders where invoice_date is not null or invoice_no is not null) then
            raise notice 'orders.invoice_date/invoice_no dolu kayıt içeriyor — KALDIRILMADI, elle kontrol edin.';
        else
            alter table orders drop column if exists invoice_date;
            alter table orders drop column if exists invoice_no;
            drop index if exists orders_invoice_date_idx;
            raise notice 'orders.invoice_date / invoice_no kaldırıldı (order_invoices kullanılacak).';
        end if;
    end if;
end $$;

-- ============================================================
-- 3) INSTEEL 2026-25 — iki sevk faturası
-- Tutarlar patronun verdiği rakamlar (16.09.2026). Fatura no ve tarihleri
-- İnci Hanım'ın tablosundan (İdeal 8931).
-- 2. faturada İnci Hanım'ın tablosu 147.192,00 ₺ yazıyor, patron 150.105,60 ₺
-- dedi — patronun rakamı esas alındı, fark (2.913,60 ₺) nota yazıldı.
-- Insteel çekle ödediği için due_date boş: vade çek yazılınca belli olacak.
-- ============================================================
do $$
declare
    v_order uuid;
    v_user  uuid;
begin
    select o.id, o.user_id into v_order, v_user
      from orders o
      join customers c on c.id = o.customer_id
     where lower(c.company_name) like 'insteel%'
       and o.order_number = '2026-25'
     limit 1;

    if v_order is null then
        raise notice 'Insteel 2026-25 bulunamadı — atlandı.';
        return;
    end if;

    if exists (select 1 from order_invoices where order_id = v_order) then
        raise notice 'Insteel 2026-25 faturaları zaten girilmiş — atlandı.';
        return;
    end if;

    insert into order_invoices (user_id, order_id, invoice_no, invoice_date, amount, currency, notes)
    values
        (v_user, v_order, 'IDL2026000001622',    date '2026-08-19', 133291.20, 'TRY',
         '1. sevk'),
        (v_user, v_order, 'IDL2026000001746-47', date '2026-09-09', 150105.60, 'TRY',
         '2. sevk. İnci Hanım''ın tablosunda 147.192,00 TRY yazıyor; patronun verdiği 150.105,60 TRY esas alındı (fark 2.913,60 TRY).');

    raise notice 'Insteel 2026-25: 2 fatura girildi (283.396,80 TRY faturalandı, 394.431,60 TRY sevk bekliyor).';
end $$;

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Siko 2026-01: total 11268.50 | advance 11268.50 | remaining 0
-- select o.order_number, o.total_amount, o.advance_payment, o.remaining_balance
--   from orders o join customers c on c.id = o.customer_id
--  where lower(c.company_name) like 'siko%' and o.order_number = '2026-01';

-- 2) Insteel 2026-25: faturalanan / sevk bekleyen
-- select o.order_number, o.total_amount,
--        sum(i.amount) as faturalanan,
--        o.total_amount - sum(i.amount) as sevk_bekleyen,
--        o.remaining_balance as odenmemis
--   from orders o join order_invoices i on i.order_id = o.id
--  group by o.id, o.order_number, o.total_amount, o.remaining_balance;
