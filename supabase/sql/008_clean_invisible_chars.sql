-- ════════════════════════════════════════════════════════════════
--  008_clean_invisible_chars.sql
--  Müşteri metin alanlarındaki görünmez karakter kalıntılarının temizliği
--
--  Sorun: Excel, Türkçe "İ" harfini küçültürken "i" + U+0307 (birleşik
--  nokta) üretiyor. Eski toplu import'lardan gelen kayıtlarda bu kalıntı
--  saklı kalmış: "Casa Bouti̇que", "Alghamdi̇ Company", "Ali̇yev Ilkin"...
--  Ekranda fazladan nokta olarak görünüyor, Excel dışa aktarımına da
--  aynen gidiyor. Tespit edilen: 130 kayıt (company_name).
--
--  src/customers.js -> toTitleCase() bu temizliği zaten yapıyor, ancak
--  yalnızca kayıt UI'dan düzenlendiğinde çalışıyor; eski satırlara hiç
--  dokunulmamış. Bu script o boşluğu tek seferde kapatır.
--
--  KAPSAM: yalnızca görünmez karakterler silinir. Harf büyük/küçüklüğü,
--  boşluklar ve noktalama AYNEN korunur — yani "S. S. Lootah Trading"
--  gibi isimler yeniden biçimlendirilmez. toTitleCase'in yaptığı
--  yeniden büyük/küçük harfleme burada BİLEREK uygulanmaz.
--
--  Temizlenen kolonlar (toTitleCase'in yönettiği dört alan):
--      company_name · country · contact_name · contact_name_2
--
--  Supabase SQL Editor'e yapıştırıp çalıştırın. İdempotenttir.
-- ════════════════════════════════════════════════════════════════
--
--  NOT: normalize(text, NFC) PostgreSQL 13+ gerektirir (Supabase 15+
--  ile gelir). "function normalize does not exist" hatası alırsanız
--  bana söyleyin, normalize'sız sürümünü yazayım.
--
--  Neden önce NFC? Metinde "I" + U+0307 (ayrışmış İ) varsa NFC bunu
--  tek karakterlik "İ"ye birleştirir; ardından U+0307 silinince gerçek
--  İ harfi korunmuş olur. Sıra ters olsaydı İ'nin noktası silinip
--  harf "I"ya dönerdi.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) ÖNİZLEME — hangi kolonda kaç kayıt etkilenecek?
-- ────────────────────────────────────────────────────────────────
select
    count(*) filter (where company_name   ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]') as company_name,
    count(*) filter (where country        ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]') as country,
    count(*) filter (where contact_name   ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]') as contact_name,
    count(*) filter (where contact_name_2 ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]') as contact_name_2
from customers;

-- ────────────────────────────────────────────────────────────────
-- 2) ÖRNEK — temizlik öncesi / sonrası ilk 20 kayıt
--    (hiçbir şeyi değiştirmez, sadece ne olacağını gösterir)
-- ────────────────────────────────────────────────────────────────
select company_name as simdi,
       regexp_replace(normalize(company_name, NFC),
                      '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]', '', 'g') as sonra
from customers
where company_name ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]'
order by company_name
limit 20;

-- ────────────────────────────────────────────────────────────────
-- 3) TEMİZLİK
-- ────────────────────────────────────────────────────────────────
update customers
set company_name   = regexp_replace(normalize(company_name, NFC),
                         '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]', '', 'g'),
    country        = regexp_replace(normalize(country, NFC),
                         '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]', '', 'g'),
    contact_name   = regexp_replace(normalize(contact_name, NFC),
                         '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]', '', 'g'),
    contact_name_2 = regexp_replace(normalize(contact_name_2, NFC),
                         '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]', '', 'g'),
    updated_at     = now()
where company_name   ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]'
   or country        ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]'
   or contact_name   ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]'
   or contact_name_2 ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]';

-- ────────────────────────────────────────────────────────────────
-- 4) DOĞRULAMA — dördü de 0 dönmeli
-- ────────────────────────────────────────────────────────────────
select
    count(*) filter (where company_name   ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]') as company_name,
    count(*) filter (where country        ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]') as country,
    count(*) filter (where contact_name   ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]') as contact_name,
    count(*) filter (where contact_name_2 ~ '[\u0307\u200B-\u200D\uFEFF\u00AD\u2060]') as contact_name_2
from customers;

-- ────────────────────────────────────────────────────────────────
-- 5) MÜKERRER TARAMASI — temizlik sonrası açığa çıkan çift kayıtlar
--    Örn. "Ali̇yev Ilkin" ile "Aliyev Ilkin" ayrı satırlarda duruyorsa,
--    temizlikten sonra ikisi de aynı isme sahip olur ve burada görünür.
--    Bu sorgu hiçbir şeyi silmez — çıkan satır olursa bana iletin,
--    007'deki gibi güvenli bir temizlik script'i hazırlarım.
-- ────────────────────────────────────────────────────────────────
select company_name,
       country,
       count(*)                  as kayit_sayisi,
       array_agg(id order by id) as id_listesi
from customers
group by company_name, country
having count(*) > 1
order by kayit_sayisi desc, company_name;
