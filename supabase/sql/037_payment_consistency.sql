-- 037_payment_consistency.sql
-- Ödeme Takibi ile diğer modüller arasındaki tutarsızlıkların giderilmesi.
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
-- ÖN KOŞUL: 022–036 çalıştırılmış olmalı.
--
--   1) Sipariş etiketleri tahsilata göre OTOMATİK
--      (Ödeme Tamamlandı / Bakiye Bekliyor / Gecikme)
--   2) Fatura girilince siparişin vadesi faturadan güncellenir
--   3) Siparişin para birimi değişince tahsilat ve fatura kayıtları da değişir
--   4) Veri: Elallar 2025-01 iadesi, Insteel 2026-01 notu, Roper Rhodes vadesi
--   5) Tüm siparişlerde bir kerelik etiket / vade eşitlemesi

-- ============================================================
-- 1) ETİKETLER TAHSİLATA GÖRE
--
-- Önceden etiketler elle yönetiliyordu: tahsilat girildiğinde sipariş
-- "Bakiye Bekliyor" kalıyor, Takip Takvimi de gecikmeyi bu etikete bakarak
-- gösteriyordu. Artık bakiye her yeniden hesaplandığında:
--   • Bakiye kapandıysa  -> "Ödeme Tamamlandı" eklenir; "Bakiye Bekliyor" ve
--                           "Gecikme" kaldırılır.
--   • Bakiye açıksa ve sipariş "Ödeme Tamamlandı" görünüyorsa -> o etiket
--     kaldırılır, "Bakiye Bekliyor" eklenir.
--   • İptal ve bedelsiz siparişlerin etiketlerine dokunulmaz.
-- Diğer etiketler (Üretimde, Sevk Edildi ...) hiç değişmez.
-- "Gecikme" etiketini Siparişler sayfası vadeye göre ekler/kaldırır.
-- ============================================================
create or replace function payment_sync_tags(p_tags text[], p_status text, p_remaining numeric, p_total numeric, p_method text)
returns text[]
language plpgsql
immutable
as $$
declare
    v text[] := coalesce(nullif(p_tags, '{}'::text[]), case when p_status is not null then array[p_status] else '{}'::text[] end);
begin
    if 'İptal' = any(v) or coalesce(p_method, '') ilike '%bedelsiz%' then
        return v;
    end if;
    if coalesce(p_total, 0) > 0 and coalesce(p_remaining, 0) <= 0.05 then
        v := array_remove(array_remove(v, 'Bakiye Bekliyor'), 'Gecikme');
        if not ('Ödeme Tamamlandı' = any(v)) then v := v || 'Ödeme Tamamlandı'::text; end if;
    elsif coalesce(p_remaining, 0) > 0.05 and 'Ödeme Tamamlandı' = any(v) then
        v := array_remove(v, 'Ödeme Tamamlandı');
        if not ('Bakiye Bekliyor' = any(v)) then v := v || 'Bakiye Bekliyor'::text; end if;
    end if;
    if coalesce(array_length(v, 1), 0) = 0 then v := array['Devam Ediyor']; end if;
    return v;
end;
$$;

create or replace function recalc_order_payment_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_paid  numeric(14,2);
    v_total numeric(14,2);
    v_rem   numeric(14,2);
    v_tags  text[];
begin
    if p_order_id is null then return; end if;

    select coalesce(sum(amount + write_off_amount), 0)
      into v_paid
      from payment_allocations
     where order_id = p_order_id;

    select coalesce(total_amount, 0) into v_total from orders where id = p_order_id;
    v_rem := round(v_total - v_paid, 2);

    select payment_sync_tags(status_tags, order_status, v_rem, v_total, payment_method)
      into v_tags
      from orders where id = p_order_id;

    update orders
       set advance_payment   = v_paid,
           remaining_balance = v_rem,
           status_tags       = v_tags,
           order_status      = v_tags[1]
     where id = p_order_id;
end;
$$;

-- ============================================================
-- 2) FATURA VADESİ -> SİPARİŞ VADESİ
--
-- Ödeme Takibi vadeyi faturadan hesaplıyor; Siparişler, Takip Takvimi ve
-- Dashboard ise siparişin vade alanına bakıyor. Fatura eklendiğinde / değiştiğinde
-- siparişin vadesi, vadesi dolu faturaların EN ERKEN vadesine eşitlenir.
-- Vadesi olmayan faturalar (peşin, mal mukabili, Insteel çek) siparişin vadesine
-- dokunmaz.
-- ============================================================
create or replace function order_invoices_sync_due()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order uuid := coalesce(new.order_id, old.order_id);
    v_due   date;
begin
    select min(due_date) into v_due from order_invoices where order_id = v_order and due_date is not null;
    if v_due is not null then
        update orders set due_date = v_due where id = v_order and due_date is distinct from v_due;
    end if;
    return null;
end;
$$;

drop trigger if exists order_invoices_sync_due_trg on order_invoices;
create trigger order_invoices_sync_due_trg
    after insert or update or delete on order_invoices
    for each row execute function order_invoices_sync_due();

-- ============================================================
-- 3) SİPARİŞ PARA BİRİMİ DEĞİŞİNCE
--
-- Graniti Building 2026-01'de olduğu gibi: sipariş EUR -> USD düzeltildi ama
-- tahsilat kaydı EUR kaldı. Artık para birimi değişince siparişe ait tahsilatlar
-- ve (ihraç kayıtlı olmayan) faturalar da aynı birime çevrilir. Tahsilat başka bir
-- siparişle ortaksa (tek SWIFT iki sipariş, mahsup) değişiklik reddedilir.
-- ============================================================
create or replace function orders_currency_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.currency is distinct from old.currency then
        if exists (
            select 1
              from payment_allocations a
              join payment_allocations b on b.payment_id = a.payment_id and b.id <> a.id
             where a.order_id = new.id
               and b.order_id is distinct from new.id
        ) then
            raise exception 'Bu siparişin tahsilatlarından biri başka bir siparişle ortak (mahsup). Para birimi değiştirilemez — önce Ödeme Takibi''nde dağıtımı düzeltin.';
        end if;
        update payments
           set currency = new.currency
         where id in (select payment_id from payment_allocations where order_id = new.id)
           and currency is distinct from new.currency;
        update order_invoices
           set currency = new.currency
         where order_id = new.id and fx_rate is null and currency is distinct from new.currency;
    end if;
    return new;
end;
$$;

drop trigger if exists orders_currency_sync_trg on orders;
create trigger orders_currency_sync_trg
    after update of currency on orders
    for each row execute function orders_currency_sync();

-- ============================================================
-- 4) VERİ DÜZELTMELERİ (patron, 18.09.2026)
-- ============================================================

-- 4a) Elallar 2025-01 — iptal; 20.000 USD avans finans tarafından iade edildi.
--     İade, eksi tutarlı tarihsiz bir tahsilat olarak kayda geçer; siparişin
--     tahsil edilen tutarı 0'a iner. İptal siparişler hiçbir bakiye hesabına girmez.
do $$
declare
    v_order uuid; v_user uuid; v_cust uuid; v_pay uuid;
begin
    select o.id, o.user_id, o.customer_id into v_order, v_user, v_cust
      from orders o join customers c on c.id = o.customer_id
     where lower(c.company_name) like 'elallar%' and o.order_number = '2025-01'
     limit 1;
    if v_order is null then raise notice 'Elallar 2025-01 bulunamadı.'; return; end if;

    if not exists (select 1 from payment_allocations a join payments p on p.id = a.payment_id
                    where a.order_id = v_order and p.method = 'İade') then
        insert into payments (user_id, customer_id, payment_date, is_opening, currency, amount, method, notes)
        values (v_user, v_cust, null, true, 'USD', -20000, 'İade',
                'Avans iadesi — sipariş iptal edildi, 20.000 USD finans departmanı tarafından müşteriye iade edildi (tarih bilinmiyor).')
        returning id into v_pay;
        insert into payment_allocations (payment_id, order_id, amount, notes)
        values (v_pay, v_order, -20000, 'Avans iadesi');
    end if;

    update orders
       set order_notes = trim(both ' ' from coalesce(order_notes || E'\n', '') ||
           'Sipariş, müşterinin kendi müşterisi ile ödeme konusunda anlaşamadığı için iptali gerçekleştirildi ve 20.000 $ avans geri iade edildi.'),
           status_tags = case when 'İptal' = any(coalesce(status_tags, '{}')) then status_tags else array['İptal'] end,
           order_status = 'İptal'
     where id = v_order
       and coalesce(order_notes, '') not like '%20.000 $ avans geri iade edildi%';
end $$;

-- 4b) Insteel 2026-01 — yanlış ürün siparişi, ürünler iade edildi, iade faturası kesildi.
update orders o
   set order_notes = trim(both ' ' from coalesce(o.order_notes || E'\n', '') || 'Yanlış ürün siparişi sonucu iade edildi. - Alacak verecek yok'),
       status_tags = case when 'İptal' = any(coalesce(o.status_tags, '{}')) then o.status_tags else array['İptal'] end,
       order_status = 'İptal'
  from customers c
 where c.id = o.customer_id
   and lower(c.company_name) like 'insteel%'
   and o.order_number = '2026-01'
   and coalesce(o.order_notes, '') not like '%Yanlış ürün siparişi sonucu iade edildi%';

-- 4c) Roper Rhodes 2026-02 — fatura vadesi 26.09.2026 Cumartesi; patron siparişte
--     28.09.2026 (Pazartesi) olarak girmişti. Fatura vadesi de 28.09.2026 yapılıyor.
update order_invoices i
   set due_date = date '2026-09-28',
       notes = coalesce(i.notes || ' | ', '') || 'Vade 26.09.2026 Cumartesi -> 28.09.2026 Pazartesi (patron, 18.09.2026)'
  from orders o join customers c on c.id = o.customer_id
 where i.order_id = o.id
   and lower(c.company_name) like 'roper%'
   and o.order_number = '2026-02'
   and i.due_date = date '2026-09-26';

-- ============================================================
-- 5) BİR KERELİK EŞİTLEME
-- ============================================================
-- 5a) Bakiye + etiket: tüm siparişler yeni kurala göre yeniden hesaplanır.
select recalc_order_payment_totals(id) from orders;

-- 5b) Geçersiz "Gecikme" etiketleri: bakiyesi kapalı, manuel takipte, vadesi
--     olmayan ya da vadesi henüz gelmemiş siparişlerden kaldırılır.
update orders
   set status_tags  = array_remove(status_tags, 'Gecikme'),
       order_status = (array_remove(status_tags, 'Gecikme'))[1]
 where 'Gecikme' = any(coalesce(status_tags, '{}'))
   and (   coalesce(remaining_balance, 0) <= 0.05
        or manual_tracking
        or due_date is null
        or due_date >= current_date
        or coalesce(payment_method, '') ilike '%bedelsiz%'
        or 'İptal' = any(status_tags));

-- 5c) Vade: faturası olan siparişlerde vade = en erken fatura vadesi.
update orders o
   set due_date = x.due
  from (select order_id, min(due_date) as due from order_invoices where due_date is not null group by order_id) x
 where x.order_id = o.id and o.due_date is distinct from x.due;

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Bakiyesi kapalı ama "Ödeme Tamamlandı" olmayan / açık ama "Ödeme Tamamlandı" olan (0 satır)
-- select c.company_name, o.order_number, o.remaining_balance, o.status_tags
--   from orders o join customers c on c.id = o.customer_id
--  where not ('İptal' = any(coalesce(o.status_tags,'{}'))) and coalesce(o.payment_method,'') not ilike '%bedelsiz%'
--    and ((o.remaining_balance <= 0.05 and o.total_amount > 0 and not ('Ödeme Tamamlandı' = any(coalesce(o.status_tags,'{}'))))
--      or (o.remaining_balance > 0.05 and 'Ödeme Tamamlandı' = any(coalesce(o.status_tags,'{}'))));

-- 2) Elallar ve Insteel 2026-01
-- select c.company_name, o.order_number, o.advance_payment, o.remaining_balance, o.status_tags, o.order_notes
--   from orders o join customers c on c.id = o.customer_id
--  where (lower(c.company_name) like 'elallar%' and o.order_number = '2025-01')
--     or (lower(c.company_name) like 'insteel%' and o.order_number = '2026-01');
