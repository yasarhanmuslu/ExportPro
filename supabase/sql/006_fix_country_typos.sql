-- ════════════════════════════════════════════════════════════════
--  006_fix_country_typos.sql
--  Müşteri Kartları — hatalı yazılmış ülke adlarının düzeltilmesi
--
--  Sorun: Türkçe "ı/i" farkı yüzünden bu ülkeler REGION_MAP ile
--  eşleşmiyor, bölge "Diğer" olarak hesaplanıyor ve Ülke filtresinde
--  doğru isimle görünmüyorlar.
--    'Hirvatistan' -> 'Hırvatistan' / Avrupa
--    'Misir'       -> 'Mısır'       / Afrika
--    'Sirbistan'   -> 'Sırbistan'   / Avrupa
--    'Gabon'       -> yazımı doğru, REGION_MAP'te yoktu / Afrika
--        (kod tarafı: src/utils/customerHelpers.js -> 'GABON': 'Afrika')
--
--  Eşleştirme, yazım varyantlarını yakalamak için normalize anahtar
--  üzerinden yapılır (İ/I/ı->i, Ş/ş->s, Ğ/ğ->g, Ü/ü->u, Ö/ö->o,
--  Ç/ç->c; ardından küçük harf ve harf-rakam dışı karakterlerin
--  atılması). Bu sayede hem hatalı hem doğru yazım eşleşir, script
--  ikinci kez çalıştırıldığında da aynı sonucu verir (idempotent).
--
--  Supabase SQL Editor'e yapıştırıp çalıştırın.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) ÖNİZLEME — düzeltmeden önce etkilenecek kayıtlar
--    (isterseniz önce yalnızca bu sorguyu çalıştırıp kontrol edin)
-- ────────────────────────────────────────────────────────────────
select country, region, count(*) as adet
from customers
where regexp_replace(
          lower(translate(coalesce(country, ''), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')),
          '[^a-z0-9]', '', 'g'
      ) in ('hirvatistan', 'misir', 'sirbistan', 'gabon')
group by country, region
order by country;

-- ────────────────────────────────────────────────────────────────
-- 2) DÜZELTME — ülke adı + bölge
-- ────────────────────────────────────────────────────────────────
update customers
set country    = v.dogru_ad,
    region     = v.bolge,
    updated_at = now()
from (values
    ('hirvatistan', 'Hırvatistan', 'Avrupa'),
    ('misir',       'Mısır',       'Afrika'),
    ('sirbistan',   'Sırbistan',   'Avrupa'),
    ('gabon',       'Gabon',       'Afrika')
) as v(anahtar, dogru_ad, bolge)
where regexp_replace(
          lower(translate(coalesce(customers.country, ''), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')),
          '[^a-z0-9]', '', 'g'
      ) = v.anahtar
  and (customers.country is distinct from v.dogru_ad
       or customers.region is distinct from v.bolge);

-- ────────────────────────────────────────────────────────────────
-- 3) DOĞRULAMA — hepsi doğru ad ve bölgeyle görünmeli
-- ────────────────────────────────────────────────────────────────
select country, region, count(*) as adet
from customers
where country in ('Hırvatistan', 'Mısır', 'Sırbistan', 'Gabon')
group by country, region
order by country;

-- ────────────────────────────────────────────────────────────────
-- 4) TARAMA (opsiyonel) — hâlâ "Diğer"e düşen başka ülke var mı?
--    Çıkan her satır ya yeni bir yazım hatasıdır ya da REGION_MAP'e
--    (src/utils/customerHelpers.js) eklenmemiş bir ülkedir.
--    Bu sorgu hiçbir şeyi değiştirmez, yalnızca raporlar.
-- ────────────────────────────────────────────────────────────────
select country, count(*) as adet
from customers
where coalesce(region, 'Diğer') = 'Diğer'
group by country
order by adet desc, country;
