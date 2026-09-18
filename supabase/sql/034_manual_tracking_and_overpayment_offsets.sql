-- 034_manual_tracking_and_overpayment_offsets.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
--   1) Siparişe "manuel takip" işareti (Manuel Alacaklar sekmesi)
--   2) İşareti koyan/kaldıran güvenli fonksiyon
--   3) Fazla ödeme mahsupları: Tehnomarket ve Ltd Modus
--   4) Sulav, Roccaforte ve Ptp Usprom siparişleri manuel takibe alınıyor

-- ============================================================
-- 1) MANUEL TAKİP İŞARETİ
--
-- Karar (patron, 17.09.2026): "Manuel Alacaklar" sistem DIŞI kayıt değildir.
-- Sistemdeki bir siparişin alacağı normal vade takibinden çıkarılıp özel takibe
-- alınır: ödeme planı yapılmış (Sulav), uzun süredir cari hesapta bekleyen
-- (Roccaforte, Ptp Usprom) alacaklar. Sipariş, faturaları ve tahsilatları
-- olduğu gibi kalır; sadece hangi listede izlendiği değişir.
-- ============================================================
alter table orders
    add column if not exists manual_tracking       boolean not null default false,
    add column if not exists manual_tracking_note  text,
    add column if not exists manual_tracking_since date;

comment on column orders.manual_tracking is
    'true: alacak Ödeme Takibi > Manuel Alacaklar sekmesinde izlenir (ödeme planı / cari takip). Açık Alacaklar listesinden ve vade panellerinden çıkar.';

create index if not exists orders_manual_tracking_idx on orders (manual_tracking) where manual_tracking;

-- ============================================================
-- 2) set_order_manual_tracking — Ödeme Takibi'nden işaret koyma/kaldırma
--
-- orders tablosunu güncelleme yetkisi Siparişler modülüne ait (003). İnci Hanım
-- gibi yalnızca Ödeme Takibi yetkisi olan kullanıcı da bu işareti değiştirebilsin
-- diye fonksiyon security definer; yetkiyi kendisi kontrol eder ve siparişin
-- SADECE bu üç alanına dokunur.
-- ============================================================
create or replace function set_order_manual_tracking(p_order_id uuid, p_on boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    select user_id into v_user from orders where id = p_order_id;
    if v_user is null then
        raise exception 'Sipariş bulunamadı.';
    end if;
    if not has_module_access(v_user, array['payments', 'orders'], 'edit') then
        raise exception 'Bu işlem için Ödeme Takibi düzenleme yetkisi gerekli.';
    end if;

    update orders
       set manual_tracking       = p_on,
           manual_tracking_note  = case when p_on then coalesce(p_note, manual_tracking_note) else manual_tracking_note end,
           manual_tracking_since = case when p_on then coalesce(manual_tracking_since, current_date) else null end
     where id = p_order_id;
end;
$$;

revoke all on function set_order_manual_tracking(uuid, boolean, text) from public, anon;
grant execute on function set_order_manual_tracking(uuid, boolean, text) to authenticated;

-- ============================================================
-- 3) FAZLA ÖDEME MAHSUPLARI
--
-- Müşteri bir siparişte fazla ödedi, fazlası bir sonraki siparişte kapandı.
-- Tahsilat defterinde bu mahsup yoktu: ilk sipariş eksi bakiye, ikincisi açık
-- bakiye gösteriyordu. Fazla ödeme, AYNI tahsilat kaydından sonraki siparişe
-- dağıtılıyor — yeni para girişi yok, toplam tahsilat değişmiyor.
--
--   Tehnomarket  2026-02 (−144,00 EUR)  ->  2026-03 (+144,00 EUR)
--   Ltd Modus    2026-01 (−500,00 USD)  ->  2026-02 (+500,00 USD)
--     (patron "2026-02 -> 2026-03" dedi; sistemde fazla ödeme 2026-01'de,
--      açık bakiye 2026-02'de — sistemdeki kayıtlar esas alındı)
-- ============================================================
do $$
declare
    r          record;
    v_src      uuid;
    v_src_rem  numeric;
    v_dst      uuid;
    v_dst_rem  numeric;
    v_alloc    uuid;
    v_pay      uuid;
begin
    for r in
        select * from (values
            ('tehnomarket', '2026-02', '2026-03', 144.00::numeric),
            ('ltd modus',   '2026-01', '2026-02', 500.00::numeric)
        ) v(musteri, kaynak, hedef, tutar)
    loop
        select o.id, o.remaining_balance into v_src, v_src_rem
          from orders o join customers c on c.id = o.customer_id
         where lower(c.company_name) like r.musteri || '%' and o.order_number = r.kaynak
         limit 1;
        select o.id, o.remaining_balance into v_dst, v_dst_rem
          from orders o join customers c on c.id = o.customer_id
         where lower(c.company_name) like r.musteri || '%' and o.order_number = r.hedef
         limit 1;

        if v_src is null or v_dst is null then
            raise notice '% % / % bulunamadı — atlandı.', r.musteri, r.kaynak, r.hedef;
            continue;
        end if;
        if abs(v_src_rem + r.tutar) > 0.01 or abs(v_dst_rem - r.tutar) > 0.01 then
            raise notice '% mahsup atlandı (zaten yapılmış ya da bakiyeler değişmiş: % / %).', r.musteri, v_src_rem, v_dst_rem;
            continue;
        end if;

        select a.id, a.payment_id into v_alloc, v_pay
          from payment_allocations a
         where a.order_id = v_src and a.amount >= r.tutar
         order by a.amount desc
         limit 1;

        update payment_allocations
           set amount = amount - r.tutar,
               notes  = coalesce(notes || ' | ', '') || 'Fazla ödeme ' || r.tutar || ' -> ' || r.hedef || ' siparişine mahsup edildi (17.09.2026)'
         where id = v_alloc;

        insert into payment_allocations (payment_id, order_id, amount, notes)
        values (v_pay, v_dst, r.tutar, 'Mahsup: ' || r.kaynak || ' siparişindeki fazla ödeme (17.09.2026)');

        raise notice '% : % fazla ödemesi % siparişine mahsup edildi.', r.musteri, r.tutar, r.hedef;
    end loop;
end $$;

-- ============================================================
-- 4) MANUEL TAKİBE ALINAN SİPARİŞLER
--   Sulav 2024-02         — ödeme planı (SULAV ÖDEME PLANI, 15.09.2026)
--   Roccaforte 2025-01    — cari takip
--   Ptp Usprom (açık tüm siparişleri: 2025-03, 2026-01, 2026-02) — cari takip
-- ============================================================
update orders o
   set manual_tracking = true,
       manual_tracking_since = coalesce(o.manual_tracking_since, current_date),
       manual_tracking_note = coalesce(o.manual_tracking_note,
           case when lower(c.company_name) like 'sulav%' then 'Ödeme planı — SULAV ÖDEME PLANI (15.09.2026), 9 taksit'
                else 'Cari takip — İnci Hanım' end)
  from customers c
 where c.id = o.customer_id
   and o.manual_tracking = false
   and coalesce(o.remaining_balance, 0) > 0.005
   and (   (lower(c.company_name) like 'sulav%'      and o.order_number = '2024-02')
        or (lower(c.company_name) like 'roccaforte%' and o.order_number = '2025-01')
        or  lower(c.company_name) like 'ptp%');

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Mahsuplar: dört siparişin kalanı 0 olmalı
-- select c.company_name, o.order_number, o.total_amount, o.advance_payment, o.remaining_balance
--   from orders o join customers c on c.id = o.customer_id
--  where (lower(c.company_name) like 'tehnomarket%' and o.order_number in ('2026-02','2026-03'))
--     or (lower(c.company_name) like 'ltd modus%'   and o.order_number in ('2026-01','2026-02'));

-- 2) Manuel takipteki siparişler (5 satır)
-- select c.company_name, o.order_number, o.currency, o.remaining_balance, o.manual_tracking_note
--   from orders o join customers c on c.id = o.customer_id
--  where o.manual_tracking order by c.company_name, o.order_number;
