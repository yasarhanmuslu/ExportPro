-- ============================================================
-- 039 — Ürün Analizi (product-analysis) yetkilerini gerçek içeriğine göre düzelt
-- ============================================================
-- SORUN:
--   product-analysis.js eskiden Palet Tanımları'nın bir kopyasıydı; 003 bu
--   yüzden modüle pallet_definitions / pallet_items üzerinde OKUMA ve YAZMA
--   izni vermişti. Buna karşılık orders / order_items okuma listesinde yoktu.
--
--   19.09.2026'da modül baştan yazıldı: artık yalnızca sipariş kalemlerini
--   ürün kataloğu nitelikleriyle (tür / seri / renk / kalite) gruplayıp
--   OKUYOR. Hiçbir tabloya yazmıyor.
--
-- DEĞİŞİKLİK:
--   • orders_select, order_items_select → 'product-analysis' eklendi
--   • pallet_definitions / pallet_items politikalarından 'product-analysis'
--     çıkarıldı (palet işleri Palet Tanımları modülünde)
--   • customers / urunler zaten has_reference_read_access ile okunuyor,
--     değişiklik gerekmez.
--
-- Sahip (owner) hesabı her durumda erişebildiği için ekranda fark yalnızca
-- "Ürün Analizi: Görüntüle" yetkisi verilmiş ekip üyelerinde görülür.
-- ============================================================

-- ── orders / order_items: okuma ──────────────────────────────
drop policy if exists orders_select on orders;
create policy orders_select on orders for select
    using (has_module_access(user_id,
        array['orders','payments','quotations','customer-score','market-analysis','profitability','order-timeline','product-analysis'],
        'view'));

drop policy if exists order_items_select on order_items;
create policy order_items_select on order_items for select
    using (has_module_access(user_id,
        array['orders','payments','quotations','customer-score','market-analysis','profitability','order-timeline','product-analysis'],
        'view'));

-- ── pallet_definitions ───────────────────────────────────────
drop policy if exists pallet_definitions_select on pallet_definitions;
create policy pallet_definitions_select on pallet_definitions for select
    using (has_module_access(user_id, array['pallet-defs','loading-planner'], 'view'));
drop policy if exists pallet_definitions_insert on pallet_definitions;
create policy pallet_definitions_insert on pallet_definitions for insert
    with check (has_module_access(user_id, array['pallet-defs'], 'edit'));
drop policy if exists pallet_definitions_update on pallet_definitions;
create policy pallet_definitions_update on pallet_definitions for update
    using (has_module_access(user_id, array['pallet-defs'], 'edit'))
    with check (has_module_access(user_id, array['pallet-defs'], 'edit'));
drop policy if exists pallet_definitions_delete on pallet_definitions;
create policy pallet_definitions_delete on pallet_definitions for delete
    using (has_module_access(user_id, array['pallet-defs'], 'edit'));

-- ── pallet_items ─────────────────────────────────────────────
drop policy if exists pallet_items_select on pallet_items;
create policy pallet_items_select on pallet_items for select
    using (has_module_access(user_id, array['pallet-defs','loading-planner'], 'view'));
drop policy if exists pallet_items_insert on pallet_items;
create policy pallet_items_insert on pallet_items for insert
    with check (has_module_access(user_id, array['pallet-defs'], 'edit'));
drop policy if exists pallet_items_update on pallet_items;
create policy pallet_items_update on pallet_items for update
    using (has_module_access(user_id, array['pallet-defs'], 'edit'))
    with check (has_module_access(user_id, array['pallet-defs'], 'edit'));
drop policy if exists pallet_items_delete on pallet_items;
create policy pallet_items_delete on pallet_items for delete
    using (has_module_access(user_id, array['pallet-defs'], 'edit'));

-- Doğrulama: 6 satır dönmeli; orders/order_items qual'ında 'product-analysis'
-- GEÇMELİ, pallet_* satırlarında GEÇMEMELİ.
-- select tablename, policyname, qual, with_check from pg_policies
--  where policyname in ('orders_select','order_items_select',
--                       'pallet_definitions_select','pallet_definitions_insert',
--                       'pallet_items_select','pallet_items_insert');
