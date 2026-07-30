-- ════════════════════════════════════════════════════════════════
--  007_remove_duplicate_customers.sql
--  Mükerrer müşteri kaydı temizliği — her firmadan BİR kayıt kalır.
--
--    Alghamdi Company (Suudi Arabistan) — 2 kayıt -> 1
--    Casa Boutique    (Kuveyt)          — 2 kayıt -> 1
--
--  Bu iki firma, müşteri arşivine mükerrer girilmiş; ikisi de "Pasif"
--  ve hiçbirine bağlı sipariş / teklif / özel fiyat / credit note yok
--  (kullanıcı tarafından sorgu ile doğrulandı).
--
--  GÜVENLİK: Silme yalnızca aşağıda ID'si açıkça yazılan 4 satırla
--  sınırlıdır — sorgu başka hiçbir müşteriye dokunamaz. Ayrıca silmeden
--  önce bağlı kayıt kontrolü tekrar yapılır; bir tanesi bile çıkarsa
--  script hata verip durur ve HİÇBİR ŞEY silinmez.
--
--  Supabase SQL Editor'e yapıştırıp çalıştırın.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) SON KONTROL — bağlı kayıt var mı?
--    Arada bir sipariş/teklif girilmiş olabilir; o yüzden silme anında
--    tekrar bakılır. Sıfır değilse işlem iptal edilir.
-- ────────────────────────────────────────────────────────────────
do $$
declare
    ids uuid[] := array[
        '17705385-f9a5-4da2-9737-aa8aa7f2acf9',  -- Alghamdi Company
        '3b66f019-4543-407c-a006-39174f4b2d3c',  -- Alghamdi Company
        '25cbf6d6-d383-4ef1-9500-ff5094b8b233',  -- Casa Boutique
        '92333bcc-9026-47b3-ae76-468639c34b82'   -- Casa Boutique
    ]::uuid[];
    n_satir  int;
    n_bagli  int;
begin
    select count(*) into n_satir from customers where id = any(ids);
    if n_satir <> 4 then
        raise exception 'Beklenen 4 satir yerine % satir bulundu. Kayitlar degismis olabilir, silme iptal edildi.', n_satir;
    end if;

    select (select count(*) from orders          where customer_id = any(ids))
         + (select count(*) from quotations      where customer_id = any(ids))
         + (select count(*) from customer_prices where customer_id = any(ids))
         + (select count(*) from credit_notes    where customer_id = any(ids))
      into n_bagli;

    if n_bagli > 0 then
        raise exception 'Bu kayitlara bagli % adet siparis/teklif/ozel fiyat/credit note var. Silme iptal edildi.', n_bagli;
    end if;
end $$;

-- ────────────────────────────────────────────────────────────────
-- 2) SİLME — her firma çiftinden yalnızca biri gider
--    Hangisinin KALACAĞI otomatik seçilir:
--      1. önce dolu alan sayısı en fazla olan (daha zengin kayıt),
--      2. eşitse en son güncellenen,
--      3. o da eşitse id sırasına göre ilki.
--    Böylece e-posta/telefon/yetkili bilgisi dolu olan kayıt korunur,
--    boş olan silinir.
-- ────────────────────────────────────────────────────────────────
with aday as (
    select c.id,
           c.updated_at,
           regexp_replace(
               lower(translate(coalesce(c.company_name, ''), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')),
               '[^a-z0-9]', '', 'g'
           ) as anahtar,
           (select count(*)
              from jsonb_each_text(to_jsonb(c)) as e(k, v)
             where v is not null and btrim(v) <> '') as dolu_alan
    from customers c
    where c.id in (
        '17705385-f9a5-4da2-9737-aa8aa7f2acf9',
        '3b66f019-4543-407c-a006-39174f4b2d3c',
        '25cbf6d6-d383-4ef1-9500-ff5094b8b233',
        '92333bcc-9026-47b3-ae76-468639c34b82'
    )
),
siralanmis as (
    select id,
           row_number() over (
               partition by anahtar
               order by dolu_alan desc, updated_at desc nulls last, id
           ) as sira
    from aday
)
delete from customers
where id in (select id from siralanmis where sira > 1);

-- ────────────────────────────────────────────────────────────────
-- 3) DOĞRULAMA — her firmadan tek satır kalmalı (toplam 2 satır)
-- ────────────────────────────────────────────────────────────────
select id, company_name, country, status, account_owner, email, phone, contact_name
from customers
where regexp_replace(
          lower(translate(coalesce(company_name, ''), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')),
          '[^a-z0-9]', '', 'g'
      ) in ('casaboutique', 'alghamdicompany')
order by company_name;
