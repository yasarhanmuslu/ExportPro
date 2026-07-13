-- Yönetici Modülü: kullanıcı rolleri, modül izinleri ve denetim kaydı
-- Bu dosyayı Supabase projesinde SQL Editor'de BİR KERE çalıştırın.
-- İdempotent yazıldı: tekrar çalıştırmak hata vermez / veriyi bozmaz.

-- ============================================================
-- 1) app_users: her Supabase Auth kullanıcısı için rol kaydı
-- ============================================================
create table if not exists app_users (
    id            uuid primary key references auth.users(id) on delete cascade,
    email         text not null,
    display_name  text,
    role          text not null default 'user' check (role in ('owner', 'user')),
    created_at    timestamptz not null default now(),
    last_seen_at  timestamptz not null default now()
);

-- ============================================================
-- 2) module_permissions: kullanıcı x modül -> erişim seviyesi
-- ============================================================
create table if not exists module_permissions (
    user_id       uuid not null references app_users(id) on delete cascade,
    module_id     text not null,
    access_level  text not null default 'none' check (access_level in ('none', 'view', 'edit')),
    updated_at    timestamptz not null default now(),
    primary key (user_id, module_id)
);

-- ============================================================
-- 3) audit_log: her değişiklik kaydı
-- ============================================================
create table if not exists audit_log (
    id          bigint generated always as identity primary key,
    created_at  timestamptz not null default now(),
    user_id     uuid references app_users(id) on delete set null,
    user_email  text,
    module_id   text,
    action      text not null check (action in ('create', 'update', 'delete')),
    summary     text,
    details     jsonb,
    read_at     timestamptz
);

create index if not exists audit_log_created_at_idx on audit_log (created_at desc);
create index if not exists audit_log_unread_idx on audit_log (read_at) where read_at is null;

-- ============================================================
-- 4) is_owner(): oturum sahibinin owner olup olmadığını kontrol eder
-- ============================================================
create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists(
        select 1 from app_users where id = auth.uid() and role = 'owner'
    );
$$;

-- ============================================================
-- 5) Rol yükseltme koruması: owner olmayan biri kendi satırında
--    role alanını değiştiremesin (insert/update'te zorla eskisine sabitlenir).
--    Yalnızca UYGULAMA İÇİNDEN (gerçek Supabase Auth oturumu, auth.uid() dolu)
--    gelen değişiklikleri kısıtlar. SQL Editor / migration / service-role
--    üzerinden yapılan işlemlerde auth.uid() NULL'dur ve bu koruma devre dışı
--    kalır — aksi halde SQL Editor'den yapılan owner ataması bile bu trigger
--    tarafından sessizce geri alınır (yaşanan gerçek bug buydu).
-- ============================================================
create or replace function app_users_protect_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is not null then
        -- OLD, INSERT tetiklemelerinde atanmamıştır; TG_OP'a göre ayrı ele alınır.
        if TG_OP = 'INSERT' then
            if not is_owner() then
                new.role := 'user';
            end if;
        else
            if not is_owner() then
                new.role := old.role;
            end if;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_protect_role on app_users;
create trigger trg_protect_role
    before insert or update on app_users
    for each row execute function app_users_protect_role();

-- ============================================================
-- 6) RLS
-- ============================================================
alter table app_users enable row level security;
alter table module_permissions enable row level security;
alter table audit_log enable row level security;

drop policy if exists app_users_select on app_users;
create policy app_users_select on app_users
    for select using (true);

drop policy if exists app_users_self_insert on app_users;
create policy app_users_self_insert on app_users
    for insert with check (id = auth.uid());

drop policy if exists app_users_self_or_owner_update on app_users;
create policy app_users_self_or_owner_update on app_users
    for update using (id = auth.uid() or is_owner());

drop policy if exists module_permissions_select on module_permissions;
create policy module_permissions_select on module_permissions
    for select using (user_id = auth.uid() or is_owner());

drop policy if exists module_permissions_owner_write on module_permissions;
create policy module_permissions_owner_write on module_permissions
    for all using (is_owner()) with check (is_owner());

drop policy if exists audit_log_self_insert on audit_log;
create policy audit_log_self_insert on audit_log
    for insert with check (user_id = auth.uid());

drop policy if exists audit_log_owner_select on audit_log;
create policy audit_log_owner_select on audit_log
    for select using (is_owner());

drop policy if exists audit_log_owner_update on audit_log;
create policy audit_log_owner_update on audit_log
    for update using (is_owner());

-- ============================================================
-- 7) İlk owner kaydı
--    (yasarhan.m@gmail.com daha önce en az bir kez giriş yapmış olmalı)
-- ============================================================
insert into app_users (id, email, role)
select id, email, 'owner'
from auth.users
where lower(email) = lower('yasarhan.m@gmail.com')
on conflict (id) do update set role = 'owner';
