-- 003_module_scoped_rls.sql
-- Mevcut RLS her tabloda yalnızca "auth.uid() = user_id" idi: bir kullanıcı sadece
-- KENDİ satırlarını görebiliyordu. module_permissions (Yönetici > Kullanıcılar sekmesi)
-- bugüne kadar yalnızca menü/sayfa görünürlüğünü kontrol ediyordu, gerçek veri erişimini
-- DEĞİL — bu yüzden bir takım üyesine "Görüntüle" verilse bile, kendi hesabında hiç
-- kayıt olmadığından tüm modüller (dashboard dahil) boş görünüyordu.
--
-- Bu migration:
--  1) Takım üyelerinin, yöneticinin (role='owner') verisini kendilerine tanımlanan
--     modül izinlerine göre okuyup/düzenleyebilmesini sağlar.
--  2) "Görüntüle" yetkisi olmayan bir modülün verisi (ör. Credit Notes) dashboard
--     gibi çapraz-modül ekranlarda da sızmaz — SELECT, ilgili sorguyu tetikleyen
--     modüllerin izinlerine göre satır satır filtrelenir.
--  3) customers ve urunler (ürün kataloğu) referans/ortak veri kabul edilir: en az
--     bir modülde izni olan herhangi bir aktif takım üyesi bunları okuyabilir
--     (aksi halde sipariş/teklif/credit note oluşturmak için müşteri-ürün seçimi
--     imkansız hale gelirdi); DÜZENLEME yine 'customers'/'products' modülüne özeldir.
--
-- Bu dosyayı Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.

-- ============================================================
-- 1) Yardımcı fonksiyonlar
-- ============================================================

-- target_user_id genelde owner'ın id'sidir (uygulama artık tüm iş verisini owner'ın
-- user_id'si altında tutuyor). Erişim var mı: kendi satırın mı, yoksa hedef owner'ın
-- satırına module_ids listesinden en az birinde p_min_level (view/edit) yetkin mi var mı?
create or replace function has_module_access(target_user_id uuid, module_ids text[], p_min_level text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        auth.uid() = target_user_id
        or (
            exists (select 1 from app_users where id = target_user_id and role = 'owner')
            and (
                is_owner()
                or exists (
                    select 1 from module_permissions mp
                    where mp.user_id = auth.uid()
                      and mp.module_id = any(module_ids)
                      and (
                          (p_min_level = 'view' and mp.access_level in ('view', 'edit'))
                          or (p_min_level = 'edit' and mp.access_level = 'edit')
                      )
                )
            )
        )
$$;

-- Referans tabloları (customers, urunler) için geniş okuma: hedef owner'ın satırı,
-- herhangi bir modülde en az 'view' yetkisi olan aktif bir takım üyesi tarafından okunabilir.
create or replace function has_reference_read_access(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        auth.uid() = target_user_id
        or (
            exists (select 1 from app_users where id = target_user_id and role = 'owner')
            and (
                is_owner()
                or exists (
                    select 1 from module_permissions mp
                    where mp.user_id = auth.uid() and mp.access_level in ('view', 'edit')
                )
            )
        )
$$;

-- ============================================================
-- 2) customers, urunler — referans tabloları
-- ============================================================
drop policy if exists customers_all on customers;
drop policy if exists customers_select on customers;
drop policy if exists customers_insert on customers;
drop policy if exists customers_update on customers;
drop policy if exists customers_delete on customers;

create policy customers_select on customers for select
    using (has_reference_read_access(user_id));
create policy customers_insert on customers for insert
    with check (has_module_access(user_id, array['customers'], 'edit'));
-- 'quotations' burada da var: quotations.js -> maybeUpdateCustomerStatus() teklif
-- kabul/red akışında müşteri durumunu (Pasif/Potansiyel/Aktif) otomatik günceller.
create policy customers_update on customers for update
    using (has_module_access(user_id, array['customers','quotations'], 'edit'))
    with check (has_module_access(user_id, array['customers','quotations'], 'edit'));
create policy customers_delete on customers for delete
    using (has_module_access(user_id, array['customers'], 'edit'));

drop policy if exists urunler_select_own on urunler;
drop policy if exists urunler_insert_own on urunler;
drop policy if exists urunler_update_own on urunler;
drop policy if exists urunler_delete_own on urunler;

create policy urunler_select on urunler for select
    using (has_reference_read_access(user_id));
create policy urunler_insert on urunler for insert
    with check (has_module_access(user_id, array['products'], 'edit'));
create policy urunler_update on urunler for update
    using (has_module_access(user_id, array['products'], 'edit'))
    with check (has_module_access(user_id, array['products'], 'edit'));
create policy urunler_delete on urunler for delete
    using (has_module_access(user_id, array['products'], 'edit'));

-- ============================================================
-- 3) orders, order_items
-- ============================================================
drop policy if exists orders_all on orders;
create policy orders_select on orders for select
    using (has_module_access(user_id,
        array['orders','payments','quotations','customer-score','market-analysis','profitability','order-timeline'],
        'view'));
create policy orders_insert on orders for insert
    with check (has_module_access(user_id, array['orders','quotations'], 'edit'));
create policy orders_update on orders for update
    using (has_module_access(user_id, array['orders','quotations'], 'edit'))
    with check (has_module_access(user_id, array['orders','quotations'], 'edit'));
create policy orders_delete on orders for delete
    using (has_module_access(user_id, array['orders'], 'edit'));

drop policy if exists user_order_items on order_items;
create policy order_items_select on order_items for select
    using (has_module_access(user_id,
        array['orders','payments','quotations','customer-score','market-analysis','profitability','order-timeline'],
        'view'));
create policy order_items_insert on order_items for insert
    with check (has_module_access(user_id, array['orders','quotations'], 'edit'));
create policy order_items_update on order_items for update
    using (has_module_access(user_id, array['orders','quotations'], 'edit'))
    with check (has_module_access(user_id, array['orders','quotations'], 'edit'));
create policy order_items_delete on order_items for delete
    using (has_module_access(user_id, array['orders','quotations'], 'edit'));

-- ============================================================
-- 4) quotations, quotation_items
-- ============================================================
drop policy if exists user_quotations on quotations;
create policy quotations_select on quotations for select
    using (has_module_access(user_id, array['quotations'], 'view'));
create policy quotations_insert on quotations for insert
    with check (has_module_access(user_id, array['quotations'], 'edit'));
create policy quotations_update on quotations for update
    using (has_module_access(user_id, array['quotations'], 'edit'))
    with check (has_module_access(user_id, array['quotations'], 'edit'));
create policy quotations_delete on quotations for delete
    using (has_module_access(user_id, array['quotations'], 'edit'));

drop policy if exists user_quotation_items on quotation_items;
create policy quotation_items_select on quotation_items for select
    using (exists (
        select 1 from quotations q
        where q.id = quotation_items.quotation_id
          and has_module_access(q.user_id, array['quotations'], 'view')
    ));
create policy quotation_items_insert on quotation_items for insert
    with check (exists (
        select 1 from quotations q
        where q.id = quotation_items.quotation_id
          and has_module_access(q.user_id, array['quotations'], 'edit')
    ));
create policy quotation_items_update on quotation_items for update
    using (exists (
        select 1 from quotations q
        where q.id = quotation_items.quotation_id
          and has_module_access(q.user_id, array['quotations'], 'edit')
    ))
    with check (exists (
        select 1 from quotations q
        where q.id = quotation_items.quotation_id
          and has_module_access(q.user_id, array['quotations'], 'edit')
    ));
create policy quotation_items_delete on quotation_items for delete
    using (exists (
        select 1 from quotations q
        where q.id = quotation_items.quotation_id
          and has_module_access(q.user_id, array['quotations'], 'edit')
    ));

-- ============================================================
-- 5) credit_notes, credit_note_items
-- ============================================================
drop policy if exists credit_notes_all on credit_notes;
create policy credit_notes_select on credit_notes for select
    using (has_module_access(user_id,
        array['credit-notes','complaints','customer-score','market-analysis'], 'view'));
create policy credit_notes_insert on credit_notes for insert
    with check (has_module_access(user_id, array['credit-notes'], 'edit'));
create policy credit_notes_update on credit_notes for update
    using (has_module_access(user_id, array['credit-notes'], 'edit'))
    with check (has_module_access(user_id, array['credit-notes'], 'edit'));
create policy credit_notes_delete on credit_notes for delete
    using (has_module_access(user_id, array['credit-notes'], 'edit'));

drop policy if exists cn_items_all on credit_note_items;
create policy credit_note_items_select on credit_note_items for select
    using (exists (
        select 1 from credit_notes cn
        where cn.id = credit_note_items.credit_note_id
          and has_module_access(cn.user_id, array['credit-notes','complaints','customer-score','market-analysis'], 'view')
    ));
create policy credit_note_items_insert on credit_note_items for insert
    with check (exists (
        select 1 from credit_notes cn
        where cn.id = credit_note_items.credit_note_id
          and has_module_access(cn.user_id, array['credit-notes'], 'edit')
    ));
create policy credit_note_items_update on credit_note_items for update
    using (exists (
        select 1 from credit_notes cn
        where cn.id = credit_note_items.credit_note_id
          and has_module_access(cn.user_id, array['credit-notes'], 'edit')
    ))
    with check (exists (
        select 1 from credit_notes cn
        where cn.id = credit_note_items.credit_note_id
          and has_module_access(cn.user_id, array['credit-notes'], 'edit')
    ));
create policy credit_note_items_delete on credit_note_items for delete
    using (exists (
        select 1 from credit_notes cn
        where cn.id = credit_note_items.credit_note_id
          and has_module_access(cn.user_id, array['credit-notes'], 'edit')
    ));

-- ============================================================
-- 6) customer_prices
-- ============================================================
drop policy if exists customer_prices_all on customer_prices;
create policy customer_prices_select on customer_prices for select
    using (has_module_access(user_id, array['client-prices','profitability','customer-score'], 'view'));
create policy customer_prices_insert on customer_prices for insert
    with check (has_module_access(user_id, array['client-prices'], 'edit'));
create policy customer_prices_update on customer_prices for update
    using (has_module_access(user_id, array['client-prices'], 'edit'))
    with check (has_module_access(user_id, array['client-prices'], 'edit'));
create policy customer_prices_delete on customer_prices for delete
    using (has_module_access(user_id, array['client-prices'], 'edit'));

-- ============================================================
-- 7) shipments
-- ============================================================
drop policy if exists user_shipments on shipments;
create policy shipments_select on shipments for select
    using (has_module_access(user_id, array['shipments'], 'view'));
create policy shipments_insert on shipments for insert
    with check (has_module_access(user_id, array['shipments'], 'edit'));
create policy shipments_update on shipments for update
    using (has_module_access(user_id, array['shipments'], 'edit'))
    with check (has_module_access(user_id, array['shipments'], 'edit'));
create policy shipments_delete on shipments for delete
    using (has_module_access(user_id, array['shipments'], 'edit'));

-- ============================================================
-- 8) pallet_definitions, pallet_items
--    (product-analysis.js şu an pallet-defs ile aynı tabloları kullanıyor — bilinen
--    bir modül/tablo eşleşme tutarsızlığı, ayrıca ele alınacak; bu migration mevcut
--    davranışı bozmamak için product-analysis'e de yazma/okuma izni tanır.)
-- ============================================================
drop policy if exists pallet_def_own_rows on pallet_definitions;
create policy pallet_definitions_select on pallet_definitions for select
    using (has_module_access(user_id, array['pallet-defs','product-analysis','loading-planner'], 'view'));
create policy pallet_definitions_insert on pallet_definitions for insert
    with check (has_module_access(user_id, array['pallet-defs','product-analysis'], 'edit'));
create policy pallet_definitions_update on pallet_definitions for update
    using (has_module_access(user_id, array['pallet-defs','product-analysis'], 'edit'))
    with check (has_module_access(user_id, array['pallet-defs','product-analysis'], 'edit'));
create policy pallet_definitions_delete on pallet_definitions for delete
    using (has_module_access(user_id, array['pallet-defs','product-analysis'], 'edit'));

drop policy if exists pallet_items_own_rows on pallet_items;
create policy pallet_items_select on pallet_items for select
    using (has_module_access(user_id, array['pallet-defs','product-analysis','loading-planner'], 'view'));
create policy pallet_items_insert on pallet_items for insert
    with check (has_module_access(user_id, array['pallet-defs','product-analysis'], 'edit'));
create policy pallet_items_update on pallet_items for update
    using (has_module_access(user_id, array['pallet-defs','product-analysis'], 'edit'))
    with check (has_module_access(user_id, array['pallet-defs','product-analysis'], 'edit'));
create policy pallet_items_delete on pallet_items for delete
    using (has_module_access(user_id, array['pallet-defs','product-analysis'], 'edit'));

-- ============================================================
-- 9) price_list
-- ============================================================
drop policy if exists "Users see own data" on price_list;
create policy price_list_select on price_list for select
    using (has_module_access(user_id, array['prices'], 'view'));
create policy price_list_insert on price_list for insert
    with check (has_module_access(user_id, array['prices'], 'edit'));
create policy price_list_update on price_list for update
    using (has_module_access(user_id, array['prices'], 'edit'))
    with check (has_module_access(user_id, array['prices'], 'edit'));
create policy price_list_delete on price_list for delete
    using (has_module_access(user_id, array['prices'], 'edit'));

-- ============================================================
-- 10) calendar_notes
-- ============================================================
drop policy if exists calendar_notes_select_own on calendar_notes;
drop policy if exists calendar_notes_insert_own on calendar_notes;
drop policy if exists calendar_notes_update_own on calendar_notes;
drop policy if exists calendar_notes_delete_own on calendar_notes;

create policy calendar_notes_select on calendar_notes for select
    using (has_module_access(user_id, array['order-timeline'], 'view'));
create policy calendar_notes_insert on calendar_notes for insert
    with check (has_module_access(user_id, array['order-timeline'], 'edit'));
create policy calendar_notes_update on calendar_notes for update
    using (has_module_access(user_id, array['order-timeline'], 'edit'))
    with check (has_module_access(user_id, array['order-timeline'], 'edit'));
create policy calendar_notes_delete on calendar_notes for delete
    using (has_module_access(user_id, array['order-timeline'], 'edit'));

-- order-timeline.js ayrıca 'orders' tablosunu takvim görünümü için okuyor;
-- bu zaten orders_select politikasında 'order-timeline' modülü listeye eklenerek kapsandı.
