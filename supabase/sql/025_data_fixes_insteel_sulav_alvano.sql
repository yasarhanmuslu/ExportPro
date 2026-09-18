-- 025_data_fixes_insteel_sulav_alvano.sql
-- Ödeme Takibi öncesi veri düzeltmeleri. Supabase SQL Editor'de BİR KERE çalıştırın.
-- İdempotent: her blok kendi koşulunu kontrol eder, tekrar çalıştırmak veriyi bozmaz.
--
-- ÖNCE 022 (tahsilat defteri) çalıştırılmış olmalı. 024'ten bağımsızdır.
--
-- İÇİNDEKİLER
--   1) Fiss 2026-01 İdeal no düzeltmesi (0008019 -> 0008020)
--   2) Insteel: ödeme şekli "Mal Mukabili", çek yazılmamış siparişlerin vadesi temizlenir
--   3) Sulav 2024-02 ve Alvano 2023-01: kalemsiz borç kayıtları cari hesaba devredilir

-- ============================================================
-- 1) FISS 2026-01 — İDEAL NO
-- İnci Hanım'ın tablosunda bu faturanın numarası 0008020; sistemde 0008019 yazılmış
-- (0008019 hiçbir kayda karşılık gelmiyor). Düzeltilince iki liste birebir eşleşiyor.
-- ============================================================
update orders o
   set ideal_order_no = '0008020'
  from customers c
 where c.id = o.customer_id
   and lower(c.company_name) like 'fiss%'
   and o.order_number = '2026-01'
   and o.ideal_order_no = '0008019';

-- ============================================================
-- 2) INSTEEL — ÖDEME ŞEKLİ VE VADE
--
-- Insteel çek ile ödüyor ama her sevkiyatta çek yazmıyor; birkaç sevkiyat birikip
-- alacak belli bir tutara ulaşınca tek çek yazıyor ve 60 günlük vade ÇEKİN
-- yazıldığı tarihten işlemeye başlıyor.
--
-- Bu yüzden "60/90 Gün Vade" yanlış: sevk tarihine 60 gün eklenerek hesaplanmış
-- vadeler gerçek değil. Ödeme şekli "Mal Mukabili" yapılıyor ve HENÜZ KAPANMAMIŞ
-- (bakiyesi olan) siparişlerin vadesi siliniyor — çek yazıldığında modül üzerinden
-- çekin vadesi girilecek.
--
-- Kapanmış siparişlerin vadelerine DOKUNULMUYOR: geçmişte o tarihlerde tahsilat
-- yapıldı, kaydı bozmanın anlamı yok.
-- ============================================================

-- 2a) Önce ne değişeceğini görmek isterseniz (çalıştırmadan önce):
-- select o.order_number, o.order_date, o.shipment_date, o.due_date,
--        o.payment_method, o.currency, o.total_amount, o.remaining_balance
--   from orders o join customers c on c.id = o.customer_id
--  where lower(c.company_name) like 'insteel%'
--  order by o.order_date;

update orders o
   set payment_method = 'Mal Mukabili'
  from customers c
 where c.id = o.customer_id
   and lower(c.company_name) like 'insteel%'
   and coalesce(o.payment_method, '') <> 'Mal Mukabili';

update orders o
   set due_date = null
  from customers c
 where c.id = o.customer_id
   and lower(c.company_name) like 'insteel%'
   and o.due_date is not null
   and coalesce(o.remaining_balance, 0) > 0.005;

-- Vadesi silinen siparişlerdeki "Gecikme" etiketi de anlamsız kaldı (vade yoksa
-- gecikme de yok). Sadece bakiyesi olan ve artık vadesi olmayan Insteel
-- siparişlerinden kaldırılıyor.
update orders o
   set status_tags = array_remove(o.status_tags, 'Gecikme')
  from customers c
 where c.id = o.customer_id
   and lower(c.company_name) like 'insteel%'
   and o.due_date is null
   and o.status_tags @> array['Gecikme'];

-- ============================================================
-- 3) SULAV 2024-02 ve ALVANO 2023-01 — CARİ HESABA DEVİR
--
-- Bu iki kayıt gerçek bir sipariş gibi durmuyor: hiç kalemi yok (0 satır), biri
-- 2022 tarihli, ikisi de yalnızca "şu kadar borcu var" demek için açılmış.
-- İnci Hanım da bunları kendi cari listesinde takip ediyor, sevkiyat tablosunda yok.
--
-- Yapılan: açık bakiye tutarında bir MANUEL ALACAK kaydı açılır (asıl takip artık
-- orada olur) ve siparişin bakiyesi "Cari hesaba devir" açıklamalı bir kapatma
-- satırıyla sıfırlanır.
--
-- Sipariş SİLİNMİYOR: 2022-2023 cirosu ve satış geçmişi olduğu gibi kalsın diye.
-- Sonuç: borç tek yerde (manuel alacak), sipariş listesinde mükerrer açık bakiye yok.
-- ============================================================
do $$
declare
    r          record;
    v_pay      uuid;
    v_new      uuid;
begin
    for r in
        select o.id, o.user_id, o.customer_id, o.order_number, o.order_date,
               o.currency, o.remaining_balance, c.company_name
          from orders o
          join customers c on c.id = o.customer_id
         where ((lower(c.company_name) like 'sulav%' and o.order_number = '2024-02')
             or (lower(c.company_name) like 'alvano%' and o.order_number = '2023-01'))
           and coalesce(o.remaining_balance, 0) > 0.005
           and not exists (select 1 from order_items i where i.order_id = o.id)
    loop
        -- Aynı kayıt ikinci kez açılmasın
        if exists (
            select 1 from manual_receivables mr
             where mr.customer_id = r.customer_id
               and mr.doc_no = r.order_number
               and mr.description like 'Sipariş kaydından devredildi%'
        ) then
            raise notice '% % zaten devredilmiş, atlandı.', r.company_name, r.order_number;
            continue;
        end if;

        insert into manual_receivables
            (user_id, customer_id, customer_text, doc_no, doc_date, currency, amount, status, description)
        values
            (r.user_id, r.customer_id, r.company_name, r.order_number, r.order_date,
             r.currency, round(r.remaining_balance, 2), 'Açık',
             'Sipariş kaydından devredildi (' || r.order_number || '). Kalemi olmayan borç kaydıydı; '
             || 'İnci Hanım''ın cari takibinde. Sipariş kaydı satış geçmişi için duruyor.')
        returning id into v_new;

        -- Siparişin bakiyesini kapat: nakit girmedi, alacak cari hesaba taşındı.
        insert into payments (user_id, customer_id, payment_date, is_opening, currency, amount, method, notes)
        values (r.user_id, r.customer_id, null, true, r.currency, round(r.remaining_balance, 2), 'Mahsup',
                'Cari hesaba devir — ' || r.order_number || ' bakiyesi manuel alacak kaydına taşındı')
        returning id into v_pay;

        insert into payment_allocations
            (payment_id, order_id, amount, write_off_amount, write_off_type, notes)
        values
            (v_pay, r.id, 0, round(r.remaining_balance, 2), 'Diğer',
             'Cari hesaba devir — takip manuel alacak kaydından sürüyor');

        raise notice '% % devredildi: % %', r.company_name, r.order_number, r.remaining_balance, r.currency;
    end loop;
end $$;

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Fiss düzeldi mi? (0008020 dönmeli)
-- select o.order_number, o.ideal_order_no from orders o join customers c on c.id = o.customer_id
--  where lower(c.company_name) like 'fiss%' and o.order_number = '2026-01';

-- 2) Insteel: bakiyesi olanlarda vade boş, ödeme şekli Mal Mukabili olmalı
-- select o.order_number, o.payment_method, o.due_date, o.remaining_balance, o.status_tags
--   from orders o join customers c on c.id = o.customer_id
--  where lower(c.company_name) like 'insteel%' order by o.order_date;

-- 3) Devredilen iki kayıt: sipariş bakiyesi 0, manuel alacak açık olmalı
-- select c.company_name, o.order_number, o.total_amount, o.remaining_balance
--   from orders o join customers c on c.id = o.customer_id
--  where (lower(c.company_name) like 'sulav%' and o.order_number = '2024-02')
--     or (lower(c.company_name) like 'alvano%' and o.order_number = '2023-01');
-- select customer_text, doc_no, currency, amount, status from manual_receivables
--  where description like 'Sipariş kaydından devredildi%';
