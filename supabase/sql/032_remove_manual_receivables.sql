-- 032_remove_manual_receivables.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
-- KARAR (patron, 17.09.2026):
--   Ödeme Takibi YALNIZCA sistemdeki siparişleri (şu an 122) ve bundan sonra
--   eklenecek siparişleri takip eder. Sistemde siparişi olmayan eski alacakların
--   kaydı İnci Hanım'da zaten var; burada ikinci kez tutulmayacak.
--
-- Bu yüzden 024 / 025 / 030 / 031 ile açılan manuel alacak kayıtları kaldırılıyor:
--   • 024: İnci Hanım'ın tablosundan alınan 98 kalem
--   • 025: Sulav 2024-02 ve Alvano 2023-01'in "cari hesaba devri"
--
-- Sulav 2024-02 ve Alvano 2023-01 SİSTEMDE SİPARİŞ olduğu için takipten
-- çıkmıyor: 025'teki devir geri alınıyor, açık bakiyeleri yine siparişin
-- üzerinde görünüyor (Sulav 45.688,50 USD, Alvano 7.414,81 EUR).
-- SULAV ÖDEME PLANI da manuel kayıttan Sulav 2024-02 siparişine taşınıyor.
--
-- Kontrol edildi (17.09.2026): manuel alacaklara bağlı tahsilat, hatırlatma,
-- Eximbank bildirimi ya da çek YOK — silme başka hiçbir kaydı etkilemez.
-- manual_receivables TABLOSU kalıyor (boş), sadece içindeki kayıtlar siliniyor.

-- ============================================================
-- 1) SULAV ÖDEME PLANI -> Sulav 2024-02 siparişine
-- ============================================================
update payment_plans pp
   set order_id      = o.id,
       receivable_id = null,
       notes         = coalesce(pp.notes, '') || ' | 17.09.2026: manuel alacak kaydından Sulav 2024-02 siparişine taşındı.'
  from orders o
  join customers c on c.id = o.customer_id
 where pp.receivable_id is not null
   and pp.title = 'SULAV ÖDEME PLANI'
   and lower(c.company_name) like 'sulav%'
   and o.order_number = '2024-02';

-- ============================================================
-- 2) SULAV / ALVANO — 025'teki "cari hesaba devir" geri alınıyor
-- Devir tahsilatı silinince dağıtımı da silinir (cascade) ve trigger
-- siparişin bakiyesini yeniden hesaplar.
-- ============================================================
delete from payments p
 where p.method = 'Mahsup'
   and p.is_opening
   and p.notes like 'Cari hesaba devir — %';

-- ============================================================
-- 3) MANUEL ALACAKLAR — tüm kayıtlar
-- Güvenlik: bir kayda tahsilat dağıtılmışsa o kayıt SİLİNMEZ.
-- ============================================================
delete from manual_receivables mr
 where not exists (select 1 from payment_allocations a where a.receivable_id = mr.id)
   and not exists (select 1 from payment_plans pp where pp.receivable_id = mr.id);

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) 0 dönmeli
-- select count(*) from manual_receivables;

-- 2) Sulav 45688.50 USD, Alvano 7414.81 EUR açık olmalı
-- select c.company_name, o.order_number, o.total_amount, o.advance_payment, o.remaining_balance
--   from orders o join customers c on c.id = o.customer_id
--  where (lower(c.company_name) like 'sulav%' and o.order_number = '2024-02')
--     or (lower(c.company_name) like 'alvano%' and o.order_number = '2023-01');

-- 3) Plan siparişe bağlı olmalı (order_id dolu, receivable_id boş)
-- select title, order_id, receivable_id from payment_plans;
