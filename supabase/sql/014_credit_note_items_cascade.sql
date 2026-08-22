-- 014_credit_note_items_cascade.sql
-- credit_note_items -> credit_notes bağlantısını ON DELETE CASCADE yapar.
-- Bu dosyayı Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
-- ── NEDEN ─────────────────────────────────────────────────────────────────────
-- LOVABLE_MIGRATION_PROMPT.md (bölüm 5.14) bu FK'yı "on delete cascade" diye
-- tarif ediyor ve 013 numaralı script de bu varsayımla yazılmıştı. Ancak canlı
-- veritabanındaki gerçek kısıt (fk_credit_note_items_cn) cascade DEĞİL: kalemi
-- olan bir Credit Note silinmeye çalışıldığında
--
--   update or delete on table "credit_notes" violates foreign key constraint
--   "fk_credit_note_items_cn" on table "credit_note_items"
--
-- hatası dönüyor. Yani modüldeki "Dosyayı Sil" düğmesi ve toplu içe aktarmadaki
-- "önce mevcut kayıtları sil" seçeneği, kalemli kayıtlarda çalışmıyordu.
--
-- Uygulama kodu artık kalemleri her hâlükârda önce siliyor (bu script
-- çalıştırılmadan da doğru davranır); bu migration ise kısıtı belgelenen
-- davranışa getirir, böylece doğrudan SQL ile yapılan silmeler de tutarlı olur.

do $$
declare
    c record;
begin
    -- credit_note_id üzerindeki mevcut FK'ları (adı ne olursa olsun) bul ve düşür.
    for c in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        where rel.relname = 'credit_note_items'
          and con.contype = 'f'
          and pg_get_constraintdef(con.oid) ilike '%references credit_notes%'
    loop
        execute format('alter table credit_note_items drop constraint %I', c.conname);
    end loop;

    -- Öksüz kalem varsa (üst kaydı silinmiş) temizle, aksi halde FK kurulamaz.
    delete from credit_note_items i
    where not exists (select 1 from credit_notes n where n.id = i.credit_note_id);

    alter table credit_note_items
        add constraint fk_credit_note_items_cn
        foreign key (credit_note_id) references credit_notes(id) on delete cascade;
end $$;

-- ============================================================
-- Doğrulama — "ON DELETE CASCADE" içermeli
-- ============================================================
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'credit_note_items'::regclass and contype = 'f';
