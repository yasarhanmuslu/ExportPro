-- ============================================================
-- 038 — app_users okuma yetkisini daralt
-- ============================================================
-- SORUN (18.09.2026 güvenlik kontrolü):
--   001'deki app_users_select politikası "using (true)" idi ve rol kısıtı yoktu.
--   Sonuç: giriş YAPMAMIŞ biri bile, yalnızca herkese açık anon anahtarla
--   (koddadır, GitHub'da da görünür) tüm kullanıcıların e-posta ve rollerini
--   okuyabiliyordu. Test: anon REST isteği app_users'tan 3 satır döndürdü.
--
-- YENİ KURAL — sadece oturum açmış kullanıcı ve yalnızca:
--   • kendi satırı                         (permissions.js: rol okuma)
--   • sahip (owner) satırı                 (permissions.js: ownerId çözümü)
--   • sahip ise herkes                     (admin.js: kullanıcı listesi)
--   • en az bir modül yetkisi olan ekip üyesi ise diğer ekip üyeleri
--                                          (customers.js: "Müşteri Sorumlusu" eşlemesi)
--   Yeni kayıt olmuş, henüz yetki verilmemiş bir hesap diğer kullanıcıları göremez.
--
-- Çalıştırdıktan sonra: aşağıdaki doğrulama sorgusu 1 satır dönmeli.
-- ============================================================

drop policy if exists app_users_select on app_users;

create policy app_users_select on app_users
    for select
    to authenticated
    using (
        id = auth.uid()
        or role = 'owner'
        or is_owner()
        or exists (
            select 1 from module_permissions mp
            where mp.user_id = auth.uid()
              and mp.access_level <> 'none'
        )
    );

-- Doğrulama:
-- select policyname, roles, qual from pg_policies
--  where tablename = 'app_users' and policyname = 'app_users_select';
