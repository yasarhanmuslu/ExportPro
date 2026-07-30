-- ════════════════════════════════════════════════════════════════
--  005_assign_omer_customers.sql
--  TEK SEFERLİK — Ekli Excel listesindeki 215 müşterinin
--  "Müşteri Sorumlusu" (account_owner / account_owner_id) alanını
--  "Ömer Faruk Uçan" olarak günceller.
--
--  Kullanıcı onayı: normal form validasyonu (Ülke / Ödeme Koşulu /
--  Incoterms / Para Birimi zorunlu alanları) BYPASS edilerek yalnızca
--  sorumlu alanı değiştirilir. Başka hiçbir kolona dokunulmaz.
--
--  Kaynak: "Yeni Microsoft Excel Çalışma Sayfası.xlsx" (Firma Adı / Ülke)
--  Excel satırı: 217  •  Tekil firma: 215  •  Mükerrer (atlandı): 2
--
--  Supabase SQL Editor'e yapıştırıp BİR KERE çalıştırın.
--  İdempotenttir: tekrar çalıştırmak veriyi bozmaz.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1) GÜVENLİK KONTROLÜ
--    Ömer'in app_users satırı yoksa account_owner_id NULL kalır ve
--    call-rotation ekranı ona hiçbir müşteri göstermez. Bu yüzden
--    satır yoksa script hata verip durur (önce bir kez giriş yapmalı).
-- ────────────────────────────────────────────────────────────────
do $$
begin
    if not exists (
        select 1 from app_users where lower(email) = lower('omerucan025@icloud.com')
    ) then
        raise exception 'app_users tablosunda omerucan025@icloud.com bulunamadi. Once Omer bir kez giris yapmali, sonra 004_call_rotation.sql calistirilmali.';
    end if;
end $$;

-- ────────────────────────────────────────────────────────────────
-- 2) HEDEF LİSTE
--    key = firma adının normalize hâli:
--    Türkçe harfler sadeleştirilir (İ/I/ı→i, Ş/ş→s, Ğ/ğ→g, Ü/ü→u,
--    Ö/ö→o, Ç/ç→c), küçük harfe çevrilir, harf-rakam dışındaki her
--    şey (boşluk, nokta, kesme işareti, U+0307 kalıntısı) atılır.
--    Böylece Excel ile DB arasındaki yazım/aksan farkları eşleşir.
-- ────────────────────────────────────────────────────────────────
drop table if exists tmp_omer_customers;
create temp table tmp_omer_customers (name text, key text);

insert into tmp_omer_customers (name, key) values
    ('Aliyev Ilkin', 'aliyevilkin'),                                                                         -- Azerbaycan
    ('Kontinent Construction', 'kontinentconstruction'),                                                     -- Azerbaycan
    ('Abc Ceramics', 'abcceramics'),                                                                         -- B.a.e
    ('Al Bab Al Mumtaz Group', 'albabalmumtazgroup'),                                                        -- B.a.e
    ('Al Bustan Building Materials', 'albustanbuildingmaterials'),                                           -- B.a.e
    ('Al Furaat', 'alfuraat'),                                                                               -- B.a.e
    ('Al Maha Intl.', 'almahaintl'),                                                                         -- B.a.e
    ('Al Meydan', 'almeydan'),                                                                               -- B.a.e
    ('Al Mutaz Ceramic', 'almutazceramic'),                                                                  -- B.a.e
    ('Al Satari Trading', 'alsataritrading'),                                                                -- B.a.e
    ('Al Shamsi', 'alshamsi'),                                                                               -- B.a.e
    ('Al Wakil Bldg Mat Tr', 'alwakilbldgmattr'),                                                            -- B.a.e
    ('Allied Arab Trading Co', 'alliedarabtradingco'),                                                       -- B.a.e
    ('Amoriah Sanitary Ware', 'amoriahsanitaryware'),                                                        -- B.a.e
    ('Arte Casa', 'artecasa'),                                                                               -- B.a.e
    ('Arteco Ceramics L.l.c.', 'artecoceramicsllc'),                                                         -- B.a.e
    ('Azizi', 'azizi'),                                                                                      -- B.a.e
    ('Bathline Designer Bathrooms', 'bathlinedesignerbathrooms'),                                            -- B.a.e
    ('Bianca & Bianco', 'biancabianco'),                                                                     -- B.a.e
    ('Capital Bath & Kitchen', 'capitalbathkitchen'),                                                        -- B.a.e
    ('Danube', 'danube'),                                                                                    -- B.a.e
    ('European Corner', 'europeancorner'),                                                                   -- B.a.e
    ('Force 10', 'force10'),                                                                                 -- B.a.e
    ('Gardina Contracting', 'gardinacontracting'),                                                           -- B.a.e
    ('German Home', 'germanhome'),                                                                           -- B.a.e
    ('Golden Line', 'goldenline'),                                                                           -- B.a.e
    ('Gothenburg Building Materials', 'gothenburgbuildingmaterials'),                                        -- B.a.e
    ('Hope Line General Trading L.l.c', 'hopelinegeneraltradingllc'),                                        -- B.a.e
    ('Imery Ceramics', 'imeryceramics'),                                                                     -- B.a.e
    ('Italian Home', 'italianhome'),                                                                         -- B.a.e
    ('Kayan Ceramic', 'kayanceramic'),                                                                       -- B.a.e
    ('La Maison Mondiale', 'lamaisonmondiale'),                                                              -- B.a.e
    ('Memon Abdul Aziz Trading Co.', 'memonabdulaziztradingco'),                                             -- B.a.e
    ('Mi Casa Building Materials', 'micasabuildingmaterials'),                                               -- B.a.e
    ('Omis Building Materials L.l.c', 'omisbuildingmaterialsllc'),                                           -- B.a.e
    ('Progetti Building', 'progettibuilding'),                                                               -- B.a.e
    ('S. S. Lootah Trading', 'sslootahtrading'),                                                             -- B.a.e
    ('Sabouh Building Material', 'sabouhbuildingmaterial'),                                                  -- B.a.e
    ('Sas International', 'sasinternational'),                                                               -- B.a.e
    ('Sobha Passion At Work', 'sobhapassionatwork'),                                                         -- B.a.e
    ('Sultaco', 'sultaco'),                                                                                  -- B.a.e
    ('Total Bathroom Solutions', 'totalbathroomsolutions'),                                                  -- B.a.e
    ('Toyomaster', 'toyomaster'),                                                                            -- B.a.e
    ('World Star Global Star', 'worldstarglobalstar'),                                                       -- B.a.e
    ('Ajm Kooheji Group', 'ajmkoohejigroup'),                                                                -- Bahreyn
    ('Almeer Group B.s.c.', 'almeergroupbsc'),                                                               -- Bahreyn
    ('Maxis Trading', 'maxistrading'),                                                                       -- Bahreyn
    ('Blue Bath', 'bluebath'),                                                                               -- Bangladeş
    ('Reza Marble & Granite', 'rezamarblegranite'),                                                          -- Bangladeş
    ('Tilottoma Bangla Group', 'tilottomabanglagroup'),                                                      -- Bangladeş
    ('Al Samiya Bldg.', 'alsamiyabldg'),                                                                     -- Cezayir
    ('B.a. Plaza', 'baplaza'),                                                                               -- Cezayir
    ('Ceram Decor', 'ceramdecor'),                                                                           -- Cezayir
    ('Ceramic Essalem', 'ceramicessalem'),                                                                   -- Cezayir
    ('Eurl Agial Ceramique', 'eurlagialceramique'),                                                          -- Cezayir
    ('Eurl Deluxe Baths', 'eurldeluxebaths'),                                                                -- Cezayir
    ('Tracon Trading Plc', 'tracontradingplc'),                                                              -- Etiyopya
    ('Amir', 'amir'),                                                                                        -- Fas
    ('Ensemble Pour Mieux Construire', 'ensemblepourmieuxconstruire'),                                       -- Fas
    ('Floor Design', 'floordesign'),                                                                         -- Fas
    ('Glory Plast S.a.r.l.', 'gloryplastsarl'),                                                              -- Fas
    ('Kmb Inspired&Commited', 'kmbinspiredcommited'),                                                        -- Fas
    ('Nafrim', 'nafrim'),                                                                                    -- Fas
    ('Newmat S.a.r.l.', 'newmatsarl'),                                                                       -- Fas
    ('Nouvel''r', 'nouvelr'),                                                                                -- Fas
    ('Porcelanor', 'porcelanor'),                                                                            -- Fas
    ('Rif Machine S.a.r.l', 'rifmachinesarl'),                                                               -- Fas
    ('Sanicrops', 'sanicrops'),                                                                              -- Fas
    ('Sanitaire Chawki', 'sanitairechawki'),                                                                 -- Fas
    ('Sarabo', 'sarabo'),                                                                                    -- Fas
    ('Seram Art', 'seramart'),                                                                               -- Fas
    ('Societe Gretafsarl', 'societegretafsarl'),                                                             -- Fas
    ('Societe Sanitem', 'societesanitem'),                                                                   -- Fas
    ('Sogea Maroc', 'sogeamaroc'),                                                                           -- Fas
    ('Standard Hydrolique', 'standardhydrolique'),                                                           -- Fas
    ('Ste Sanitradis S.a.r.l', 'stesanitradissarl'),                                                         -- Fas
    ('Swan Co.', 'swanco'),                                                                                  -- Fas
    ('Systherm', 'systherm'),                                                                                -- Fas
    ('Tanger Carreaux S.a.r.l', 'tangercarreauxsarl'),                                                       -- Fas
    ('Valencerame', 'valencerame'),                                                                          -- Fas
    ('Dsp Architectes', 'dsparchitectes'),                                                                   -- Fildişi Sahili
    ('Phenicia', 'phenicia'),                                                                                -- Fildişi Sahili
    ('Al Jaber', 'aljaber'),                                                                                 -- Filistin
    ('Ceramica Luna Ltd', 'ceramicalunaltd'),                                                                -- Filistin
    ('Lates Home Sanitary Ware', 'lateshomesanitaryware'),                                                   -- Filistin
    ('2ag Otomotıv', '2agotomotiv'),                                                                         -- Gabon
    ('Gadon Building', 'gadonbuilding'),                                                                     -- Gana
    ('Porcer Ghana Ltd.', 'porcerghanaltd'),                                                                 -- Gana
    ('Societte Guinee Gomba', 'societteguineegomba'),                                                        -- Gine
    ('Demasi', 'demasi'),                                                                                    -- Gürcistan
    ('Gorgia', 'gorgia'),                                                                                    -- Gürcistan
    ('Jaokeni', 'jaokeni'),                                                                                  -- Gürcistan
    ('Next Group', 'nextgroup'),                                                                             -- Gürcistan
    ('Peani Ltd', 'peaniltd'),                                                                               -- Gürcistan
    ('Zodi', 'zodi'),                                                                                        -- Gürcistan
    ('Ashoka Enterprise', 'ashokaenterprise'),                                                               -- Hindistan
    ('Cera Sanitaryware Limited', 'cerasanitarywarelimited'),                                                -- Hindistan
    ('Micasa Admire Luxuries', 'micasaadmireluxuries'),                                                      -- Hindistan
    ('The House Of Admire Bathrooms', 'thehouseofadmirebathrooms'),                                          -- Hindistan
    ('Al Mufeed Ali Baraa', 'almufeedalibaraa'),                                                             -- Irak
    ('Al Omran Group', 'alomrangroup'),                                                                      -- Irak
    ('Andalus', 'andalus'),                                                                                  -- Irak
    ('Aree Jamal Ahmad Co.', 'areejamalahmadco'),                                                            -- Irak
    ('Ashtti Ceramics', 'ashtticeramics'),                                                                   -- Irak
    ('Baraka Capital', 'barakacapital'),                                                                     -- Irak
    ('Co. Colors', 'cocolors'),                                                                              -- Irak
    ('Khatmir. Co', 'khatmirco'),                                                                            -- Irak
    ('Regal Structure Construction & Consultant', 'regalstructureconstructionconsultant'),                   -- Irak
    ('Sakar Company', 'sakarcompany'),                                                                       -- Irak
    ('Spanish House', 'spanishhouse'),                                                                       -- Irak
    ('Maison Dg Sarl', 'maisondgsarl'),                                                                      -- Kamerun
    ('Rimex', 'rimex'),                                                                                      -- Kamerun
    ('Socoicam Sarl', 'socoicamsarl'),                                                                       -- Kamerun
    ('Al Hattab Holding', 'alhattabholding'),                                                                -- Katar
    ('Ansar Group', 'ansargroup'),                                                                           -- Katar
    ('Capital Al Asema Building', 'capitalalasemabuilding'),                                                 -- Katar
    ('Ggc All Building Supplies', 'ggcallbuildingsupplies'),                                                 -- Katar
    ('Grand Royal Group Of Companies', 'grandroyalgroupofcompanies'),                                        -- Katar
    ('Gulf Style', 'gulfstyle'),                                                                             -- Katar
    ('Julphar Co Contracting', 'julpharcocontracting'),                                                      -- Katar
    ('Kafood', 'kafood'),                                                                                    -- Katar
    ('New Vision', 'newvision'),                                                                             -- Katar
    ('Pearl Marble & Granite Company', 'pearlmarblegranitecompany'),                                         -- Katar
    ('Sanilux W.l.l', 'saniluxwll'),                                                                         -- Katar
    ('Sultan Obaidan Trading Co. Wll', 'sultanobaidantradingcowll'),                                         -- Katar
    ('Aba-Husaain', 'abahusaain'),                                                                           -- Kuveyt
    ('Abyat Home Of Homes', 'abyathomeofhomes'),                                                             -- Kuveyt
    ('Al Amal Kuwaiti', 'alamalkuwaiti'),                                                                    -- Kuveyt
    ('Casa Boutique', 'casaboutique'),                                                                       -- Kuveyt
    ('Ciramas Ceramics Co.', 'ciramasceramicsco'),                                                           -- Kuveyt
    ('Everest Global', 'everestglobal'),                                                                     -- Kuveyt
    ('Gresland Company', 'greslandcompany'),                                                                 -- Kuveyt
    ('Hassan Abul', 'hassanabul'),                                                                           -- Kuveyt
    ('Midas Sanitary Ware Co.', 'midassanitarywareco'),                                                      -- Kuveyt
    ('Nasser Al Rumaih Commercial Center', 'nasseralrumaihcommercialcenter'),                                -- Kuveyt
    ('National İndustrial Ceramics', 'nationalindustrialceramics'),                                          -- Kuveyt
    ('Ajyad Libya Company', 'ajyadlibyacompany'),                                                            -- Libya
    ('Alanoar Allibya', 'alanoarallibya'),                                                                   -- Libya
    ('Alghazala Company', 'alghazalacompany'),                                                               -- Libya
    ('Alrraseka', 'alrraseka'),                                                                              -- Libya
    ('Ceramikos', 'ceramikos'),                                                                              -- Libya
    ('Resaan', 'resaan'),                                                                                    -- Libya
    ('Shajarat Al- Dekour Co.', 'shajarataldekourco'),                                                       -- Libya
    ('A.s. Contracting', 'ascontracting'),                                                                   -- Lübnan
    ('Al Sultan For Sanitary Tools', 'alsultanforsanitarytools'),                                            -- Lübnan
    ('Bahnam Ceramics', 'bahnamceramics'),                                                                   -- Lübnan
    ('Bain Show Bath & Design', 'bainshowbathdesign'),                                                       -- Lübnan
    ('Elias Jawiche & Co.', 'eliasjawicheco'),                                                               -- Lübnan
    ('Hassan Massri Sanitary', 'hassanmassrisanitary'),                                                      -- Lübnan
    ('Hijazi Ceramica Group', 'hijaziceramicagroup'),                                                        -- Lübnan
    ('İl Bagno Sanitary And Wares', 'ilbagnosanitaryandwares'),                                              -- Lübnan
    ('Jinani', 'jinani'),                                                                                    -- Lübnan
    ('Joumaa Trading Est.', 'joumaatradingest'),                                                             -- Lübnan
    ('Khafajah Stores For Trading', 'khafajahstoresfortrading'),                                             -- Lübnan
    ('Khalil Boussi & Sons', 'khalilboussisons'),                                                            -- Lübnan
    ('Moussawi For İndustry & General Trade', 'moussawiforindustrygeneraltrade'),                            -- Lübnan
    ('Pexico', 'pexico'),                                                                                    -- Lübnan
    ('Saad For Trading & Constracting', 'saadfortradingconstracting'),                                       -- Lübnan
    ('Sanitary&More', 'sanitarymore'),                                                                       -- Lübnan
    ('Shreif For General Trading', 'shreifforgeneraltrading'),                                               -- Lübnan
    ('Fixon', 'fixon'),                                                                                      -- Mauritius
    ('Asli Jamal Sons Co. Ltd', 'aslijamalsonscoltd'),                                                       -- Misir
    ('Beroia Decor', 'beroiadecor'),                                                                         -- Misir
    ('Ceramica Shalaby', 'ceramicashalaby'),                                                                 -- Misir
    ('Hammada Group', 'hammadagroup'),                                                                       -- Misir
    ('Centrum Properties Limited', 'centrumpropertieslimited'),                                              -- Nijerya
    ('Forstech', 'forstech'),                                                                                -- Nijerya
    ('İbalex Nigeria Limited', 'ibalexnigerialimited'),                                                      -- Nijerya
    ('Procurement Of Architectural Systems And Solutions', 'procurementofarchitecturalsystemsandsolutions'), -- Nijerya
    ('Sahar Continental Limited', 'saharcontinentallimited'),                                                -- Nijerya
    ('Abdullah Tiles', 'abdullahtiles'),                                                                     -- Pakistan
    ('Azaad Properties', 'azaadproperties'),                                                                 -- Pakistan
    ('Shafique Sons', 'shafiquesons'),                                                                       -- Pakistan
    ('Europa Ceramique', 'europaceramique'),                                                                 -- Senegal
    ('Horizon Ceramique', 'horizonceramique'),                                                               -- Senegal
    ('Mondial Carreaux', 'mondialcarreaux'),                                                                 -- Senegal
    ('Paksa Puntland Limited', 'paksapuntlandlimited'),                                                      -- Somali
    ('Shaafici Trading Company', 'shaaficitradingcompany'),                                                  -- Somali
    ('Abu Al Fadil United', 'abualfadilunited'),                                                             -- Sudan
    ('Ahmed Fatah El Rahman Taha İmport & Export', 'ahmedfatahelrahmantahaimportexport'),                    -- Sudan
    ('Al Oroba For Sanitary Wares', 'alorobaforsanitarywares'),                                              -- Suudi Arabistan
    ('Alghamdi Company', 'alghamdicompany'),                                                                 -- Suudi Arabistan
    ('Alkhomasiah Real Estate Developments', 'alkhomasiahrealestatedevelopments'),                           -- Suudi Arabistan
    ('Alnokhba Ceramic', 'alnokhbaceramic'),                                                                 -- Suudi Arabistan
    ('Azem Al-Enjaz For Sanitary Ware', 'azemalenjazforsanitaryware'),                                       -- Suudi Arabistan
    ('Bayt Alebaa', 'baytalebaa'),                                                                           -- Suudi Arabistan
    ('Dmu Real Estate And Constrachion', 'dmurealestateandconstrachion'),                                    -- Suudi Arabistan
    ('İnterior Design Network', 'interiordesignnetwork'),                                                    -- Suudi Arabistan
    ('Nesma Orbit', 'nesmaorbit'),                                                                           -- Suudi Arabistan
    ('Sama Miza Est. For Trading', 'samamizaestfortrading'),                                                 -- Suudi Arabistan
    ('Sidc', 'sidc'),                                                                                        -- Suudi Arabistan
    ('Promodar', 'promodar'),                                                                                -- Tunus
    ('Sanimode', 'sanimode'),                                                                                -- Tunus
    ('Societe İmmobiliere Les Pyramides', 'societeimmobilierelespyramides'),                                 -- Tunus
    ('Time Ceram', 'timeceram'),                                                                             -- Tunus
    ('Tunisace', 'tunisace'),                                                                                -- Tunus
    ('Abuzaki Traiding', 'abuzakitraiding'),                                                                 -- Umman
    ('Al Najjar Intl.', 'alnajjarintl'),                                                                     -- Umman
    ('Al-Bustan United Llc.', 'albustanunitedllc'),                                                          -- Umman
    ('Al-Hezel', 'alhezel'),                                                                                 -- Umman
    ('Aldar Almudhee''a Trade & Contracting', 'aldaralmudheeatradecontracting'),                             -- Umman
    ('Alraqi Ceramics', 'alraqiceramics'),                                                                   -- Umman
    ('Hempel', 'hempel'),                                                                                    -- Umman
    ('Nizwa Ceramics Center', 'nizwaceramicscenter'),                                                        -- Umman
    ('Quartz', 'quartz'),                                                                                    -- Umman
    ('Venus Building Material Asso.', 'venusbuildingmaterialasso'),                                          -- Umman
    ('Al Rezaz', 'alrezaz'),                                                                                 -- Ürdün
    ('Ceramica Prima', 'ceramicaprima'),                                                                     -- Ürdün
    ('Comfort Systems', 'comfortsystems'),                                                                   -- Ürdün
    ('Constraction Trade Sanitary', 'constractiontradesanitary'),                                            -- Ürdün
    ('İtimat For Sanitary Trade', 'itimatforsanitarytrade'),                                                 -- Ürdün
    ('Nabulsi&Amad', 'nabulsiamad'),                                                                         -- Ürdün
    ('Subhi Abu Ghallous', 'subhiabughallous'),                                                              -- Ürdün
    ('Trust Sanitary Ware Equipments', 'trustsanitarywareequipments'),                                       -- Ürdün
    ('Villa Roza', 'villaroza');                                                                             -- Ürdün

-- ────────────────────────────────────────────────────────────────
-- 3) GÜNCELLEME — yalnızca account_owner + account_owner_id
-- ────────────────────────────────────────────────────────────────
update customers c
set account_owner    = 'Ömer Faruk Uçan',
    account_owner_id = (select id from app_users where lower(email) = lower('omerucan025@icloud.com')),
    updated_at       = now()
where c.user_id = (select id from app_users where lower(email) = lower('yasarhan.m@gmail.com'))
  and regexp_replace(
          lower(translate(coalesce(c.company_name, ''), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')),
          '[^a-z0-9]', '', 'g'
      ) in (select key from tmp_omer_customers);

-- ────────────────────────────────────────────────────────────────
-- 4) RAPOR — Excel'de olup DB'de KARŞILIĞI BULUNAMAYAN firmalar
--    Boş dönerse 215 firmanın tamamı güncellenmiştir.
--    Satır dönerse: o firmalar müşteri arşivinde yok ya da adı farklı
--    yazılmış demektir; UI'dan tek tek kontrol edilmelidir.
-- ────────────────────────────────────────────────────────────────
select w.name as "Excel'de var, DB'de bulunamadi"
from tmp_omer_customers w
where not exists (
    select 1 from customers c
    where c.user_id = (select id from app_users where lower(email) = lower('yasarhan.m@gmail.com'))
      and regexp_replace(
              lower(translate(coalesce(c.company_name, ''), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')),
              '[^a-z0-9]', '', 'g'
          ) = w.key
)
order by 1;
