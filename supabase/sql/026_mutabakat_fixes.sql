-- 026_mutabakat_fixes.sql
-- "MUTABAKAT - Excel vs Sistem (57 kalem)" çalışmasının sonucu.
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
-- 56 kalemin kararı:
--   • 53 kalem "SİSTEM DOĞRU"  -> sistemde değişiklik YOK. Bu kalemlerde İnci Hanım'ın
--     Excel'i geride kalmış (tahsilat gelmiş, tabloya işlenmemiş). Takip artık
--     Ödeme Takibi modülünden yürüyeceği için Excel'i düzeltmeye gerek yok.
--   • 1 kalem "EXCEL DOĞRU" ve düzeltilebilir  -> aşağıdaki 1. blok (Siko 2026-01).
--   • 2 kalem beklemede: Insteel 2026-25 ve Ptp Usprom 2025-03 (aşağıda 2. bölümde
--     neden beklediği yazılı) — karar gelince ayrı script ile düzeltilecek.

-- ============================================================
-- 1) SIKO 2026-01 — sipariş yanlışlıkla kapalı görünüyor
--
-- Sipariş tutarı 11.268,50 €. Sistem "tamamı tahsil edildi" diyordu, oysa
-- İnci Hanım'ın kaydına göre 7.888,60 € hâlâ açık. Doğrusu:
--     tahsil edilen = 11.268,50 - 7.888,60 = 3.379,90 €
--
-- 022'nin açtığı tarihsiz "Açılış" kaydının tutarı düzeltiliyor; bakiyeyi
-- trigger kendisi yeniden hesaplıyor. Ödeme tarihi zaten bilinmiyordu, o yüzden
-- kayıt açılış kaydı olarak kalıyor.
-- ============================================================
do $$
declare
    v_order   uuid;
    v_total   numeric(14,2);
    v_pay     uuid;
    v_alloc   uuid;
    v_dogru   numeric(14,2);
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

    v_dogru := round(v_total - 7888.60, 2);   -- 3.379,90

    select a.id, a.payment_id into v_alloc, v_pay
      from payment_allocations a
      join payments p on p.id = a.payment_id
     where a.order_id = v_order
       and p.is_opening
     limit 1;

    if v_alloc is null then
        raise notice 'Siko 2026-01 için açılış kaydı yok — elle kontrol edin.';
        return;
    end if;

    update payment_allocations
       set amount = v_dogru,
           notes  = 'Mutabakat düzeltmesi (16.09.2026): sipariş yanlışlıkla kapalı görünüyordu, '
                 || 'açık bakiye 7.888,60 EUR olarak düzeltildi.'
     where id = v_alloc;

    update payments
       set amount = v_dogru,
           notes  = coalesce(notes, '') || ' | Mutabakat düzeltmesi 16.09.2026'
     where id = v_pay;

    raise notice 'Siko 2026-01 düzeltildi: tahsil edilen %, açık bakiye 7888.60 EUR', v_dogru;
end $$;

-- ============================================================
-- 2) KARAR BEKLEYEN İKİ KALEM — bu script bunlara DOKUNMUYOR
--
-- 2a) Insteel 2026-25 (İdeal 8931)
--     Sistem: 677.828,40 ₺ sipariş, tamamı açık.
--     Excel : 280.483,20 ₺ açık (iki fatura: 133.291,20 + 147.192,00).
--     Karar : "EXCEL DOĞRU".
--     Soru  : Sipariş tutarı mı yanlış, yoksa siparişin yalnızca 280.483,20 ₺'lik
--             kısmı mı faturalandı (kalanı henüz sevk edilmedi)? İkincisi ise
--             sistemde hata yok: 280.483,20 ₺ "açık alacak", 397.345,20 ₺ ise
--             henüz sevk edilmemiş bakiye. Modül bu ikisini zaten ayrı gösterecek.
--
-- 2b) Ptp Usprom 2025-03 (İdeal 7392)
--     Sistem: 46.706,00 € açık.  Excel: 29.073,12 € açık.  Karar sütunu BOŞ.
--     Not   : Sipariş "Sevke Hazır" durumunda — yani mal henüz çıkmamış olabilir.
--             Aradaki 17.632,88 € için İnci Hanım'a sorulmalı.
-- ============================================================

-- ============================================================
-- KONTROL
-- ============================================================
-- select o.order_number, o.total_amount, o.advance_payment, o.remaining_balance
--   from orders o join customers c on c.id = o.customer_id
--  where lower(c.company_name) like 'siko%' and o.order_number = '2026-01';
-- Beklenen: total 11268.50 | advance 3379.90 | remaining 7888.60
