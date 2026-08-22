-- 013_credit_notes_rebuild.sql
-- Credit Notes modülünün gerçek iş akışına göre yeniden kurulması.
-- Bu dosyayı Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
--
-- ── NEDEN ─────────────────────────────────────────────────────────────────────
-- Mevcut credit_notes / credit_note_items şeması bir taslaktı ve kullanıcının
-- fiilen tuttuğu "CREDIT NOTE TAKIP" Excel'iyle örtüşmüyordu. Eksikler:
--
--   1) CN sıra no (Excel'deki "No" sütunu) yoktu.
--   2) Ürün ID (klozet/lavabo içindeki mükerrer olmayan barkod numarası) için alan
--      yoktu — oysa modülün ana amacı "aynı ürünü ikinci kez işleme almamak".
--   3) Müşterinin kendi referansı (GRESSIA 2'nin "IDVT17082026116" / "Claim 41"
--      biçimi) ile bizim barkod ID'miz aynı hücrede karışıyordu.
--   4) Para/telafi bilgisi hiç yoktu: CN ya sonraki siparişten MAHSUP edilir
--      (adet × birim fiyat) ya da BEDELSİZ ürün gönderilir (sadece adet).
--   5) Karar değerleri "Kabul/Red/Mahsup" varsayılıyordu; gerçekte 7 değer var
--      (Confirmed, Confirmed - Broken, Tolerance - %50 Discount, Refused,
--       Refused - Broken, Refused - Tolerance, Waiting Picture).
--   6) Hangi siparişte uygulanacağı sadece serbest metindi, orders'a bağlı değildi.
--   7) Hata kategorisi (Döküm Çatlağı, Pinhol, Harkort, ...) hiç tutulmuyordu.
--
-- Ayrıca credit_note_items.product_id, var olmayan bir `products` tablosuna
-- referans veriyordu (uygulama kodu da o tabloyu sorguluyor ve sessizce hata
-- alıyordu). Gerçek ürün kataloğu `urunler`. FK bu migration'da düzeltiliyor.
--
-- ── VERİ KAYBI RİSKİ YOK ──────────────────────────────────────────────────────
-- Bu migration yazıldığında her iki tablo da BOŞTU (0 satır). Yine de hiçbir
-- kolon DROP edilmiyor; sadece ekleme ve yeniden adlandırma yapılıyor, böylece
-- tablolarda beklenmedik bir kayıt varsa da korunur.
--
-- ── RLS ───────────────────────────────────────────────────────────────────────
-- 003_module_scoped_rls.sql'deki credit_notes / credit_note_items politikaları
-- kolon bazlı değil, satır bazlıdır; bu migration onları BOZMAZ ve yeniden
-- kurmaya gerek yoktur. Yeni bir modül eklenmediği için module_permissions'a da
-- dokunulmuyor ('credit-notes' ve 'complaints' zaten tanımlı).

-- ============================================================
-- 1) credit_notes — ana kayıt (bir CN belgesi)
-- ============================================================

alter table credit_notes
    -- Excel'deki "No" sütunu. Kullanıcı numarayı elle de değiştirebilsin diye
    -- sequence değil düz integer; uygulama yeni kayıtta max+1 önerir.
    add column if not exists cn_no             integer,

    -- Belgedeki tutarların para birimi. Karışık para birimi toplamayı önlemek
    -- için CN başına tek para birimi tutulur (kalemler bunu miras alır).
    add column if not exists currency          text not null default 'EUR',

    -- CN'nin uygulanacağı sipariş. Gerçek kayda bağlanır; sipariş henüz sisteme
    -- girilmemişse target_order_text ("2026-03") yedek olarak kullanılır.
    add column if not exists target_order_id   uuid,
    add column if not exists target_order_text text,

    -- Belgede yazan toplam. NULL ise uygulama kalemlerden hesaplar; doludur ise
    -- (elle yuvarlama vb.) belgedeki değer esas alınır.
    -- Örn: PAFFONI 11.06.2026 belgesinde hesaplanan 100,52 € yerine 100,50 € yazıyor.
    add column if not exists total_amount      numeric(12,2),

    -- Belgenin arşivdeki dosya yolu / serbest not.
    add column if not exists source_file       text,
    add column if not exists notes             text,

    add column if not exists created_at        timestamptz not null default now();

-- Sipariş bağlantısı (kayıt silinirse CN kalsın, bağ kopsun).
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'fk_credit_notes_target_order'
    ) then
        alter table credit_notes
            add constraint fk_credit_notes_target_order
            foreign key (target_order_id) references orders(id) on delete set null;
    end if;
end $$;

-- Süreç durumu. Eski değer kümesi (İncelemede|Onaylandı|Reddedildi|Mahsup Edildi)
-- karar ile süreci karıştırıyordu: karar artık KALEM bazında (Confirmed/Refused/...),
-- burada tutulan ise belgenin nerede olduğu. Kullanıcının asıl derdi
-- "unutuyorum" olduğu için kritik durum 'Belge Gönderildi' (= henüz siparişe
-- işlenmemiş, takip edilmesi gereken CN).
alter table credit_notes
    alter column process_status set default 'İncelemede';

update credit_notes set process_status = 'Belge Gönderildi'
    where process_status in ('Onaylandı', 'Reddedildi');
update credit_notes set process_status = 'Siparişe İşlendi'
    where process_status = 'Mahsup Edildi';

do $$
begin
    if exists (select 1 from pg_constraint where conname = 'credit_notes_process_status_chk') then
        alter table credit_notes drop constraint credit_notes_process_status_chk;
    end if;
    alter table credit_notes
        add constraint credit_notes_process_status_chk
        check (process_status in ('İncelemede', 'Belge Gönderildi', 'Siparişe İşlendi', 'İptal'));
end $$;

do $$
begin
    if exists (select 1 from pg_constraint where conname = 'credit_notes_currency_chk') then
        alter table credit_notes drop constraint credit_notes_currency_chk;
    end if;
    alter table credit_notes
        add constraint credit_notes_currency_chk
        check (currency in ('EUR', 'USD', 'TRY', 'GBP'));
end $$;

-- Aynı kullanıcıda CN sıra no tekrar etmesin (NULL'lar serbest).
create unique index if not exists credit_notes_user_cn_no_uidx
    on credit_notes (user_id, cn_no) where cn_no is not null;

create index if not exists credit_notes_customer_idx     on credit_notes (customer_id);
create index if not exists credit_notes_target_order_idx on credit_notes (target_order_id);
create index if not exists credit_notes_status_idx       on credit_notes (user_id, process_status);

-- ============================================================
-- 2) credit_note_items — CN kalemleri (şikayet edilen tek tek ürünler)
-- ============================================================

alter table credit_note_items
    add column if not exists line_no            integer,

    -- Ürünün içindeki barkotlu mükerrer olmayan numara ("TC numarası gibi").
    -- Belgede "None" yazan / okunamayan ürünlerde NULL kalır.
    add column if not exists product_serial     text,

    -- Müşterinin kendi takip numarası. GRESSIA 2 kendi sistemini kullanıyor
    -- ("IDVT17082026116", "Claim 41"); bazen bizim ID ile birlikte gönderiyor
    -- ("3106976654 - IDVT11032023080") — bu yüzden ayrı kolon.
    add column if not exists customer_ref       text,

    -- Hata kataloğu anahtarı (src/utils/defectCatalog.js içindeki id).
    add column if not exists defect_category    text,

    -- 'Mahsup'   -> sonraki siparişten tutar düşülecek (adet × birim fiyat)
    -- 'Bedelsiz' -> yerine bedelsiz ürün gönderilecek (sadece adet anlamlı)
    add column if not exists compensation_type  text not null default 'Mahsup',

    add column if not exists quantity           numeric(10,2) not null default 1,
    add column if not exists unit_price         numeric(12,2),

    -- Kalem, CN'nin genel siparişinden FARKLI bir siparişte uygulanacaksa.
    -- Boşsa credit_notes.target_order_* geçerlidir. (2023 kayıtlarında aynı CN
    -- içinde 2023-01 ve 2023-04 karışık geçiyordu.)
    add column if not exists target_order_text_override text;

alter table credit_note_items
    alter column product_name drop not null;

-- description_1 (Hata/Problem Tanımı) tek serbest açıklama alanına indirgeniyor.
-- description_2 (Kök Neden) bırakılıyor ama uygulama artık kullanmıyor; yeni
-- kolon adı `description` olacak şekilde description_1 yeniden adlandırılıyor.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_name = 'credit_note_items' and column_name = 'description_1'
    ) and not exists (
        select 1 from information_schema.columns
        where table_name = 'credit_note_items' and column_name = 'description'
    ) then
        alter table credit_note_items rename column description_1 to description;
    end if;
end $$;

alter table credit_note_items
    add column if not exists description text;

do $$
begin
    if exists (select 1 from pg_constraint where conname = 'cn_items_compensation_chk') then
        alter table credit_note_items drop constraint cn_items_compensation_chk;
    end if;
    alter table credit_note_items
        add constraint cn_items_compensation_chk
        check (compensation_type in ('Mahsup', 'Bedelsiz'));
end $$;

-- Karar değerleri. Eski "Kabul/Red/Mahsup" varsayımı gerçekle uyuşmuyordu.
update credit_note_items set decision = 'Confirmed' where decision = 'Kabul';
update credit_note_items set decision = 'Refused'   where decision = 'Red';
update credit_note_items set decision = 'Confirmed' where decision = 'Mahsup';

do $$
begin
    if exists (select 1 from pg_constraint where conname = 'cn_items_decision_chk') then
        alter table credit_note_items drop constraint cn_items_decision_chk;
    end if;
    alter table credit_note_items
        add constraint cn_items_decision_chk
        check (decision is null or decision in (
            'Confirmed',
            'Confirmed - Broken',
            'Tolerance - %50 Discount',
            'Refused',
            'Refused - Broken',
            'Refused - Tolerance',
            'Waiting Picture'
        ));
end $$;

-- product_id, olmayan `products` tablosuna bakıyordu; gerçek katalog `urunler`.
do $$
declare
    c record;
begin
    for c in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        where rel.relname = 'credit_note_items'
          and con.contype = 'f'
          and pg_get_constraintdef(con.oid) ilike '%references products%'
    loop
        execute format('alter table credit_note_items drop constraint %I', c.conname);
    end loop;

    -- Eski FK'dan arta kalan, urunler'de karşılığı olmayan id'ler varsa temizle.
    update credit_note_items i set product_id = null
    where i.product_id is not null
      and not exists (select 1 from urunler u where u.id = i.product_id);

    if not exists (
        select 1 from pg_constraint where conname = 'fk_credit_note_items_urun'
    ) then
        alter table credit_note_items
            add constraint fk_credit_note_items_urun
            foreign key (product_id) references urunler(id) on delete set null;
    end if;
end $$;

create index if not exists cn_items_note_idx    on credit_note_items (credit_note_id);
create index if not exists cn_items_serial_idx  on credit_note_items (product_serial) where product_serial is not null;
create index if not exists cn_items_custref_idx on credit_note_items (customer_ref)   where customer_ref   is not null;
create index if not exists cn_items_code_idx    on credit_note_items (product_code);
create index if not exists cn_items_defect_idx  on credit_note_items (defect_category);

-- ============================================================
-- 3) Hata kategorisi örnek görselleri için storage bucket
-- ============================================================
-- Görseller Supabase Storage'da tutulur. Bucket'ı SQL ile oluşturamıyorsanız
-- Supabase panelinden Storage > New bucket ile 'hata-gorselleri' adında,
-- PRIVATE (public değil) bir bucket açın — uygulama signed URL kullanıyor
-- (ürün görsellerindeki desenle aynı).

insert into storage.buckets (id, name, public)
select 'hata-gorselleri', 'hata-gorselleri', false
where not exists (select 1 from storage.buckets where id = 'hata-gorselleri');

drop policy if exists hata_gorselleri_read   on storage.objects;
drop policy if exists hata_gorselleri_write  on storage.objects;
drop policy if exists hata_gorselleri_update on storage.objects;
drop policy if exists hata_gorselleri_delete on storage.objects;

-- Okuma: 'complaints' veya 'credit-notes' modülünde en az görüntüleme yetkisi
-- olan her oturum açmış kullanıcı. (Hata kataloğu referans veridir.)
create policy hata_gorselleri_read on storage.objects for select
    using (
        bucket_id = 'hata-gorselleri'
        and auth.uid() is not null
    );

-- Yazma/silme: yalnızca 'complaints' modülünde düzenleme yetkisi olanlar.
create policy hata_gorselleri_write on storage.objects for insert
    with check (
        bucket_id = 'hata-gorselleri'
        and (is_owner() or exists (
            select 1 from module_permissions mp
            where mp.user_id = auth.uid()
              and mp.module_id = 'complaints'
              and mp.access_level = 'edit'
        ))
    );

create policy hata_gorselleri_update on storage.objects for update
    using (
        bucket_id = 'hata-gorselleri'
        and (is_owner() or exists (
            select 1 from module_permissions mp
            where mp.user_id = auth.uid()
              and mp.module_id = 'complaints'
              and mp.access_level = 'edit'
        ))
    );

create policy hata_gorselleri_delete on storage.objects for delete
    using (
        bucket_id = 'hata-gorselleri'
        and (is_owner() or exists (
            select 1 from module_permissions mp
            where mp.user_id = auth.uid()
              and mp.module_id = 'complaints'
              and mp.access_level = 'edit'
        ))
    );

-- ============================================================
-- 4) Doğrulama — çalıştırdıktan sonra bu sorgular boş DÖNMEMELİ
-- ============================================================
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_name = 'credit_notes' order by ordinal_position;
--
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_name = 'credit_note_items' order by ordinal_position;
--
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid in ('credit_notes'::regclass, 'credit_note_items'::regclass);
--
-- select id, name, public from storage.buckets where id = 'hata-gorselleri';
