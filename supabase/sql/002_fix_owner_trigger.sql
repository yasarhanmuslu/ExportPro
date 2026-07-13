-- DÜZELTME: 001_admin_module.sql'deki trigger, SQL Editor'den yapılan
-- owner atamasını da (auth.uid() orada NULL olduğu için) sessizce geri alıyordu.
-- Bu dosyayı SQL Editor'de BİR KERE çalıştırın.

-- 1) Trigger'ı düzelt: sadece uygulama içi (gerçek oturum) rol değişikliklerini kısıtla
create or replace function app_users_protect_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is not null then
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

-- 2) Owner'ı şimdi doğrudan tekrar ata (önceki seed bu bug yüzünden geri alınmıştı)
update app_users set role = 'owner' where lower(email) = lower('yasarhan.m@gmail.com');

-- 3) Doğrulama: aşağıdaki sorgu 'owner' dönmeli
select id, email, role from app_users where lower(email) = lower('yasarhan.m@gmail.com');
