-- Günlük Arama Rotasyonu (Call Rotation) — şema desteği
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.

-- ============================================================
-- 1) customers: son arama tarihi + gerçek sorumlu (app_users FK)
-- ============================================================
alter table customers add column if not exists last_called_at timestamptz;
alter table customers add column if not exists account_owner_id uuid references app_users(id);

create index if not exists customers_account_owner_id_idx on customers(account_owner_id);
create index if not exists customers_last_called_at_idx on customers(last_called_at);

-- ============================================================
-- 2) app_users.display_name backfill — iki bilinen satış temsilcisi
--    (her ikisi de en az bir kez giriş yapmış olmalı, aksi halde
--    auth.users'ta satır bulunamaz ve bu adım sessizce atlanır)
-- ============================================================
update app_users set display_name = 'Yaşarhan Muslu'
where lower(email) = lower('yasarhan.m@gmail.com');

update app_users set display_name = 'Ömer Faruk Uçan'
where lower(email) = lower('omerucan025@icloud.com');

-- ============================================================
-- 3) Tek seferlik: TÜM mevcut müşterileri Yaşarhan'a ata
--    (kullanıcı onayıyla, normal form validasyonu bypass edilerek —
--     Ömer daha sonra kendi müşterilerini kendisi UI üzerinden
--     "Müşteri Sorumlusu" alanından değiştirecek)
-- ============================================================
update customers
set account_owner_id = (select id from app_users where lower(email) = lower('yasarhan.m@gmail.com')),
    account_owner    = 'Yaşarhan Muslu';
