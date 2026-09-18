-- 031_fisdoo_close_old_receivables.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
-- Patron teyidi (17.09.2026): Fiss'in 2026-03, 2026-04 ve 2026-05 siparişleri
-- dışında bekleyen alacağı YOK; geçmişe ait alacak/verecek yok.
--
-- 024, İnci Hanım'ın tablosundan Fis Doo adına 5 eski kalem almıştı. Beşi de
-- tabloda "geldi" (ödeme geldi) işaretli, altlarında 380–900 EUR arası kalan
-- görünüyordu. 2021 satırının notuna göre bu kalanlar borç değil
-- ("792,80 eur 1 yılın sonunda %2 komisyon bedelidir"): tahsilat yapılmış,
-- aradaki fark komisyon/kesinti.
--
--   IHR2021000000163   792,80 EUR   Şüpheli
--   IHR2022000000124   381,76 EUR   Şüpheli
--   IHR2023000000006   749,89 EUR   Şüpheli
--   IHR2023000000097   774,32 EUR   Şüpheli
--   IHR2025000000003   906,63 EUR   Açık
--
-- Hepsi "Kapandı" yapılıyor ve Fiss müşteri kartına bağlanıyor (024 isim
-- farkı yüzünden bağlayamamıştı: tabloda "FIS DOO", kartta "Fiss").
-- 030'da iptal edilen IHR2025000000089 de karta bağlanıyor, durumu değişmiyor.

update manual_receivables mr
   set customer_id = c.id
  from customers c
 where lower(c.company_name) = 'fiss'
   and mr.customer_id is null
   and upper(mr.customer_text) = 'FIS DOO';

update manual_receivables
   set status      = 'Kapandı',
       description = description
                  || ' | KAPANDI (17.09.2026): Patron teyidi — Fiss''in geçmişe ait alacağı yok. '
                  || 'Tahsilat yapılmış; tablodaki kalan komisyon/kesinti farkı, borç değil.'
 where upper(customer_text) = 'FIS DOO'
   and doc_no in ('IHR2021000000163', 'IHR2022000000124', 'IHR2023000000006',
                  'IHR2023000000097', 'IHR2025000000003')
   and status in ('Açık', 'Şüpheli');

-- ============================================================
-- KONTROL — 6 satır, hepsi Fiss kartına bağlı; 5 Kapandı + 1 İptal
-- ============================================================
-- select mr.doc_no, mr.amount, mr.status, c.company_name
--   from manual_receivables mr left join customers c on c.id = mr.customer_id
--  where upper(mr.customer_text) = 'FIS DOO'
--  order by mr.doc_date;
