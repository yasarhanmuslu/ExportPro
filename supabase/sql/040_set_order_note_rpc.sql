-- ============================================================
-- 040 — Ödeme Takibi'nden sipariş notu yazma (set_order_note)
-- ============================================================
-- İHTİYAÇ (19.09.2026, patron):
--   Tahsilatlar sekmesinden geçmiş bir siparişe not düşebilmek
--   (ör. "iade edildi", "çekle ödendi", "müşteri 3 taksit istedi").
--
--   Not, Siparişler modülündeki aynı alana yazılır: orders.order_notes.
--   (037 de Elallar / Insteel notlarını oraya yazmıştı — tek not kaynağı.)
--
-- NEDEN FONKSİYON:
--   orders tablosunu güncelleme yetkisi Siparişler modülüne ait (003).
--   Yalnızca Ödeme Takibi yetkisi olan kullanıcı (İnci Hanım) da not
--   yazabilsin diye fonksiyon security definer; yetkiyi kendisi kontrol eder
--   ve siparişin SADECE order_notes alanına dokunur. Aynı desen: 034
--   set_order_manual_tracking.
-- ============================================================

create or replace function set_order_note(p_order_id uuid, p_note text)
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
       set order_notes = nullif(trim(coalesce(p_note, '')), '')
     where id = p_order_id;
end;
$$;

revoke all on function set_order_note(uuid, text) from public, anon;
grant execute on function set_order_note(uuid, text) to authenticated;

-- Doğrulama: 1 satır dönmeli, security_definer = true.
-- select proname, prosecdef as security_definer from pg_proc where proname = 'set_order_note';
