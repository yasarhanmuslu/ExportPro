-- 024_inci_open_receivables.sql
-- İnci Hanım'ın "ödeme takip" Excel'indeki, SİSTEMDE SİPARİŞİ OLMAYAN açık alacaklar.
-- Bu dosyayı Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent: manual_receivables
-- tablosunda kayıt varsa blok hiç çalışmaz.
--
-- ── KAYNAK ────────────────────────────────────────────────────────────────────
-- "2026 İHRACAT SEVKİYATLAR ......xlsx" / "ödeme takip" sayfası, 730 fatura satırı.
--   • 185 satır gerçekten açık (durum "gelmedi"/"kısmi geldi" ya da kalan > 100).
--   • Bunların 57'si sistemde SİPARİŞ olarak zaten var (İDEAL no ile eşleşti) —
--     buraya ALINMADI, mükerrer borç oluşmasın diye. Onlar için ayrı mutabakat
--     listesi çıkarıldı (39 kalemde Excel ile sistem farklı).
--   • 128'inin sistemde karşılığı yok. Bunlardan:
--       - 300 birimin altındaki 30 kalem ALINMADI (toplam 3123.57);
--         bunlar borç değil, SWIFT/muhabir banka kesintisi artığı.
--       - Kalan 98 kalem aşağıda aktarılıyor.
--
-- ── DURUM ─────────────────────────────────────────────────────────────────────
--   'Açık'    (51 kalem) : 2024 ve sonrası + Insteel yurt içi faturaları — canlı takip.
--   'Şüpheli' (47 kalem) : 2023 ve öncesi ya da Excel'de fatura tarihi olmayan
--               kalemler. Silinmedi ki kaybolmasın; İnci Hanım tek tek gözden
--               geçirip 'Açık' veya 'Kapandı' yapabilir.
--
-- Toplam aktarılan: {'EUR': 259483.4, 'USD': 276685.21, 'TRY': 2456654.14}
--
-- NOT: Bunlar SİPARİŞ DEĞİL, cari alacak kaydıdır. Bilerek böyle: bu kalemlerde
-- yapılacak tek iş tahsilat; geriye dönük sipariş açmak satış/ürün istatistiklerini
-- ve ciro karşılaştırmalarını bozardı.

do $$
declare
    v_owner uuid;
    v_eslesen integer;
begin
    if exists (select 1 from manual_receivables) then
        raise notice 'manual_receivables dolu — aktarım atlandı.';
        return;
    end if;

    select id into v_owner from app_users where role = 'owner' limit 1;
    if v_owner is null then
        raise exception 'owner kullanıcı bulunamadı (app_users.role = owner).';
    end if;

    insert into manual_receivables
        (user_id, customer_text, doc_no, doc_date, due_date, currency, amount, status, description)
    values
    (v_owner, 'FIS DOO', 'IHR2021000000163', '2021-11-16', '2022-02-17', 'EUR', 792.8, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: geldi | Sorumlu: Yaşarhan | Fatura tutarı: 4117.02 | Not: 17.02.2022 3.324,22 eur ödeme geldi, 792,80 eur 1 yılın sonunda %2 komisyon bedelidir.'),
    (v_owner, 'BIOUT ALEAZ', 'IHR2022000000013', '2022-01-27', '2022-01-27', 'USD', 2908.56, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: geldi | Sorumlu: Haluk | Fatura tutarı: 44418.56 | Not: 11.12.2021 25000 USD / 28.01.2022 16.510,00 usd elden alındı kalan %3 son 2 sevkiyat prim ödemesi Nura Tekstil'),
    (v_owner, 'ENTREPRENEUR ILMURADOV', 'IHR2022000000016', '2022-02-02', null, 'USD', 2021.8, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | Sorumlu: Haluk | Fatura tutarı: 7261.8 | Not: 5.240 USD GELDİ'),
    (v_owner, 'EMOTION WARENHANDELS GmbH', 'IHR2022000000017', '2022-02-02', null, 'EUR', 334.0, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | Sorumlu: Yaşarhan | Fatura tutarı: 6365.76 | Not: 6.031,76 EURO ÖDEME GELDİ'),
    (v_owner, 'ONE BATH GmbH', 'IHR2022000000018', '2022-02-02', '2022-03-02', 'EUR', 1777.4, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: kısmi geldi | İdevit: Asma Klozet Kanalsız + PP S | Sorumlu: Yaşarhan | Fatura tutarı: 65443.0 | Not: 18.11.2022 10.350,00 EURO KUTU PARASI PEŞİN ALINDI, 30.03.2022 tarihinde 53.315,60 euro ödeme geldi'),
    (v_owner, 'ONE BATH GmbH', 'IHR2022000000028', '2022-02-18', '2022-03-18', 'EUR', 10019.76, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: kısmi geldi | İdevit: -14245.45 | Sorumlu: Yaşarhan | Fatura tutarı: 38525.76 | Not: 28.04.2022 tarihinde 28.526.00 eur ödeme geldi B. Kes. 20.00 eur.'),
    (v_owner, 'LTD MODUS', 'IHR2022000000038', '2022-03-09', '2022-03-09', 'USD', 680.0, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: geldi | Sorumlu: Haluk | Fatura tutarı: 26624.26 | Not: 20.000 USD ödeme geldi, kalan 6.624,26 usd / 09.03.2022 5.966,66 USD ödeme geldi'),
    (v_owner, 'ONE BATH GmbH', 'IHR2022000000067', '2022-04-29', '2022-05-29', 'EUR', 609.76, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | Sorumlu: Zafer | Fatura tutarı: 609.76'),
    (v_owner, 'ALVONA LLC', 'IHR2022000000085', '2022-06-06', '2022-09-06', 'EUR', 3680.26, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: kısmi geldi | İdeal: *0000469 | İdevit: *0000065 | Sorumlu: Yaşarhan | Fatura tutarı: 23623.26 | Not: 05.09.2023 tarihinde 9.968,00 euro / 28.12.2023 tarihinde 9.975,00 euro ödeme geldi'),
    (v_owner, 'SIKO KOUPELNY', 'IHR2022000000091', '2022-06-21', '2022-07-21', 'EUR', 2648.72, 'Şüpheli', 'Ödeme şekli: %30 peşin %70 mal teslim edildikten sonra | Excel durumu: kısmi geldi | İdeal: *0000870 | İdevit: *0000097 | Sorumlu: Yaşarhan | Fatura tutarı: 64315.16 | Not: 16.06.2022 42.892,20 EUR ödemenin 16.866,83 EUR tutarı bu sevkiyatındır.08.07.2022 44.799,61 eur ödeme geldi (YIL SONU CARİ HESAPLAŞMA OLACAK)'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2022000000099', '2022-07-06', '2022-09-04', 'EUR', 26818.9, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: kısmi geldi | İdeal: *0000907 | İdevit: *0000101 | Sorumlu: Yaşarhan | Fatura tutarı: 35090.32 | Not: 21.07.2022 10.000 kalan 2.977,11 euro elden ödeme bu sevkiyata sayıldı.'),
    (v_owner, 'ALVONA LLC', 'IHR2022000000100', '2022-07-07', '2022-09-06', 'EUR', 702.24, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0001089 | İdevit: *0000111 | Sorumlu: Yaşarhan | Fatura tutarı: 702.24'),
    (v_owner, 'LLC LİFE', 'IHR2022000000101', '2022-07-18', null, 'USD', 1022.8, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0000765 | İdevit: *0000086 | Sorumlu: Haluk | Fatura tutarı: 41488.19 | Not: 04.05.2022 17.990,00 usd / 15.06.2022 18451,63 usd / 11.07.2022 4.023,76 usd ödeme geldi'),
    (v_owner, 'ALVONA LLC', 'IHR2022000000113', '2022-08-22', '2022-11-20', 'EUR', 3089.31, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0001340 | İdevit: *0000129 | Sorumlu: Yaşarhan | Fatura tutarı: 3089.31'),
    (v_owner, 'OPAL ALJADIDA - LİBYA', 'IHR2022000000114', '2022-08-29', null, 'USD', 1257.44, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: geldi | İdeal: *0001317 | İdevit: *0000128 | Sorumlu: Haluk | Fatura tutarı: 41903.44 | Not: 02.09.2022 tarihinde 40.646 usd ödeme elden alınmıştır 1257,44 usd %3 komisyon bedelidir.'),
    (v_owner, 'FIS DOO', 'IHR2022000000124', '2022-10-07', '2023-01-05', 'EUR', 381.76, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: geldi | İdeal: *0001614 | İdevit: *0000150 | Sorumlu: Yaşarhan | Fatura tutarı: 6972.48 | Not: 29.12.2022 6.590,72 eur ödeme geldi'),
    (v_owner, 'ES TURKMEN YMARAT', 'IHR2022000000132', '2022-10-21', null, 'USD', 509.65, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0001679 | İdevit: *0000157 | Sorumlu: Haluk | Fatura tutarı: 13978.45 | Not: 04.10.2022 5.434,80 USD/ 06.09.2023 tarihinde elden 2.250,00 usd +30 usd elden ödeme yapmıştır.'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2022000000137', '2022-10-27', '2022-12-26', 'EUR', 24743.76, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0001567 | İdevit: *0000146 | Sorumlu: Yaşarhan | Fatura tutarı: 24743.76'),
    (v_owner, 'FENTINOVA LIFESTYLE', 'IHR2022000000138', '2022-11-18', null, 'EUR', 2318.5, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0001817 | İdevit: *0000169 | Sorumlu: Yaşarhan | Fatura tutarı: 13593.38 | Not: 16.11.2022 12.800,00 EUR ödeme geldi'),
    (v_owner, 'NOVA LTD', 'IHR2022000000149', '2022-12-23', null, 'USD', 665.48, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0001692 | İdevit: *0000161 | Sorumlu: Haluk | Fatura tutarı: 29556.48 | Not: 18.10.2022 tarihinde 8.891,00 usd / 30.11.2022 tarihinde 20.000 usd ödeme geldi'),
    (v_owner, 'FIS DOO', 'IHR2023000000006', '2023-01-16', '2023-04-16', 'EUR', 749.89, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: geldi | İdeal: *0002031 | İdevit: *0000181 | Sorumlu: Yaşarhan | Fatura tutarı: 4514.0 | Not: yıl sonu toplam satışından %2 prim alıyor. 750,00 euro 2022 yılı satış primidir.'),
    (v_owner, 'SULAV', 'IHR2023000000018-19', '2023-02-17', null, 'USD', 50688.5, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0001744 | İdevit: *0000164 | Sorumlu: Yaşarhan | Fatura tutarı: 50688.5 | Not: Nuri Bey''in arkadaşı, açık hesap (bir sevkiyat yapıldıktan sonra 2. sevkiyattan önce 1. sevkiyatın ödemesini yapacak)'),
    (v_owner, 'İDEAL TANASA', null, null, null, 'USD', 52127.61, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *000 | İdevit: *0000170 | Sorumlu: Yaşarhan | Fatura tutarı: 52127.61'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2023000000023', '2023-02-24', null, 'EUR', 5195.91, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: kısmi geldi | İdeal: *0001966 | İdevit: *0000180 | Sorumlu: Yaşarhan | Fatura tutarı: 25195.91 | Not: 03.03.2023 20.000 euro ödeme geldi'),
    (v_owner, 'INSTEEL ÇELİK', 'IDL2023000000427', '2023-03-10', null, 'TRY', 12122.98, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: geldi | İdeal: *0002477 | Sorumlu: Yaşarhan | Fatura tutarı: 14918.98'),
    (v_owner, 'FENTINOVA LIFESTYLE', 'IHR2023000000028', '2023-03-10', null, 'EUR', 464.84, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0002422 | İdevit: *0000203 | Sorumlu: Yaşarhan | Fatura tutarı: 23464.84 | Not: 08.03.2023 tarihinde 23.000 euro ödeme geldi'),
    (v_owner, 'INSTEEL MERSİN', 'IDL2023000000676', '2023-04-13', null, 'TRY', 2294.4, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: geldi | İdeal: *0002722 | Sorumlu: Yaşarhan | Fatura tutarı: 2294.4'),
    (v_owner, 'E.GRECH CRISTAL / MALTA', 'IHR2023000000041', '2023-04-26', '2023-06-25', 'EUR', 524.06, 'Şüpheli', 'Ödeme şekli: 50 PEŞİN 50 MAL MUKABİLİ | Excel durumu: geldi | İdeal: *0002394 | İdevit: *0000201 | Sorumlu: Haluk | Fatura tutarı: 16762.82 | Not: 26.04.2023 tarihinde 8.931,50 euro / 01.08.2023 tarihinde 5.334,26 euro/01.09.2023 tarihinde 1.973,00 euro ödeme geldi'),
    (v_owner, 'ES GYRAT TÜRKMENİSTAN', 'IHR2023000000045', '2023-05-09', null, 'USD', 4094.54, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0002623 | İdevit: *0000215 | Sorumlu: Haluk | Fatura tutarı: 40196.54 | Not: 17.04.2023 36.102,00 USD ödeme geldi'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2023000000049', '2023-05-23', null, 'EUR', 24198.32, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0002900 | İdevit: *0000232 | Sorumlu: Yaşarhan | Fatura tutarı: 24198.32'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'HURDA', '2023-06-06', null, 'EUR', 523.8, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0003028 | İdevit: *0000235 | Sorumlu: Yaşarhan | Fatura tutarı: 523.8'),
    (v_owner, 'INSTEEL ADIYAMAN 1.PROJE', 'IDL2023000001046', '2023-06-09', null, 'TRY', 92834.94, 'Açık', 'Ödeme şekli: BARTIR KONTEYNER KARŞILIĞI | Excel durumu: geldi | İdeal: *0002771 | Sorumlu: Yaşarhan | Fatura tutarı: 92834.94'),
    (v_owner, 'INSTEEL MERSİN 5.PROJE', 'IDL2023000001184', '2023-07-04', null, 'TRY', 29185.46, 'Açık', 'Ödeme şekli: BARTIR KONTEYNER KARŞILIĞI | Excel durumu: geldi | İdeal: *0003080 | Sorumlu: Yaşarhan | Fatura tutarı: 29185.46 | Not: BARTIR KONTEYNER karşılığında satıştır.'),
    (v_owner, 'INSTEEL MUĞLA 3. PROJE', 'IDL2023000001219', null, null, 'TRY', 14990.91, 'Açık', 'Ödeme şekli: BARTIR KONTEYNER KARŞILIĞI | Excel durumu: geldi | İdeal: *0003081 | Sorumlu: Yaşarhan | Fatura tutarı: 14990.91 | Excel fatura tarihi: 07.07:2023'),
    (v_owner, 'INSTEEL ANTALYA 1. PROJE', 'IDL2023000001386', '2023-07-31', null, 'TRY', 1151.86, 'Açık', 'Ödeme şekli: BARTIR KONTEYNER KARŞILIĞINDA | Excel durumu: geldi | İdeal: *0003345 | Sorumlu: Yaşarhan | Fatura tutarı: 1151.86'),
    (v_owner, 'INSTEEL ADIYAMAN 2.PROJE', 'IDL2023000001403', '2023-08-03', null, 'TRY', 71803.58, 'Açık', 'Ödeme şekli: BARTIR KONTEYNER KARŞILIĞINDA | Excel durumu: geldi | İdeal: *0002770 | Sorumlu: Yaşarhan | Fatura tutarı: 71803.58'),
    (v_owner, 'INSTEEL GAZİANTEP', 'IDL2023000001402', '2023-08-03', null, 'TRY', 53187.84, 'Açık', 'Ödeme şekli: BARTIR KONTEYNER KARŞILIĞINDA | Excel durumu: geldi | İdeal: *0002769 | Sorumlu: Yaşarhan | Fatura tutarı: 53187.84'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2023000000072', '2023-08-10', null, 'EUR', 27222.08, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0003155 | İdevit: *0000243 | Sorumlu: Yaşarhan | Fatura tutarı: 27222.08'),
    (v_owner, 'INSTEEL GAZİANTEP 3. PROJE', 'IDL2023000001607', '2023-08-29', null, 'TRY', 24388.7, 'Açık', 'Ödeme şekli: BARTIR KONTEYNER KARŞILIĞINDA | Excel durumu: geldi | İdeal: *0003469 | Sorumlu: Yaşarhan | Fatura tutarı: 24388.7'),
    (v_owner, 'FENTINOVA LIFESTYLE', 'IHR2023000000079', '2023-09-07', null, 'EUR', 2243.46, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0002899 | İdevit: *0000231 | Sorumlu: Yaşarhan | Fatura tutarı: 25243.46 | Not: 06.09.2023 Tarihinde 23.000 euro ödeme geldi kalan tutar sorunlu ürünler saptandıktan sonra varsa ödenecek'),
    (v_owner, 'FIS DOO', 'IHR2023000000097', '2023-10-30', '2024-01-28', 'EUR', 774.32, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: geldi | İdeal: *0003796 | İdevit: *0000277 | Sorumlu: Yaşarhan | Fatura tutarı: 7123.68 | Not: 24.01.2024 tarihinde 6.349,36 euro ödeme geldi'),
    (v_owner, 'INSTEEL ADIYAMAN 3.PROJE', 'IDL2023000002063', '2023-10-31', null, 'TRY', 2738.74, 'Açık', 'Ödeme şekli: BARTIR KONTEYNER KARŞILIĞINDA | Excel durumu: geldi | İdeal: *0003883 | Sorumlu: Yaşarhan | Fatura tutarı: 2738.74'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'X', '2023-11-14', null, 'EUR', 589.98, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0003938 | İdevit: *0000286 | Sorumlu: Yaşarhan | Fatura tutarı: 589.98'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2023000000113', '2023-12-23', null, 'EUR', 25378.11, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0003823 | İdevit: *0000279 | Sorumlu: Yaşarhan | Fatura tutarı: 25378.11'),
    (v_owner, 'GOLDEN LINE', 'IHR2024000000001', '2024-01-17', '2024-04-16', 'USD', 2890.5, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: kısmi geldi | İdeal: *0003743 | İdevit: *0000273 | Sorumlu: Haluk | Fatura tutarı: 21190.5 | Not: 22.12.2023 tarihinde 10.000 usd ödeme geldi kalan eximbank 90 gün vadelidir. 17.05.2024 tarihinde 8.251,00 usd ödeme geldi kalan 2.890,50 usd hasarlı ürünlere sayılacaktır.'),
    (v_owner, 'INSTEEL ÇELİK', 'IDL2024000000558', '2024-03-30', '2024-05-29', 'TRY', 265613.68, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0004692 | Sorumlu: Yaşarhan | Fatura tutarı: 265613.68'),
    (v_owner, 'INSTEEL 2024-02', 'IDL2024000000586', '2024-04-04', null, 'TRY', 6689.18, 'Açık', 'İdeal: *0004740 | Sorumlu: Yaşarhan | Fatura tutarı: 6689.18'),
    (v_owner, 'INSTEEL ÇELİK', 'IDL2024000000758', '2024-05-10', null, 'TRY', 47100.0, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0004863 | Sorumlu: Yaşarhan | Fatura tutarı: 47100.0'),
    (v_owner, 'ERGÜDEN KIBRIS', 'IHR2024000000037', '2024-05-14', null, 'TRY', 110596.8, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: geldi | İdeal: *0004507 | İdevit: *0000319 | Sorumlu: Haluk | Fatura tutarı: 290449.2 | Not: 10.03.2023 tarihinde gelen 314.404,45 tl ödemenin 19.205,59 tl tutarı / 04.03.2024 tarihinde 125.896,68 TL/ 14.05.2024 tarihinde 53.955,72 TL ödeme geldi'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2024000000040', '2024-05-26', null, 'EUR', 503.99, 'Açık', 'Ödeme şekli: BEDELSİZ NUMUNE | Excel durumu: gelmedi | İdeal: *0004988 | İdevit: *0000341 | Sorumlu: Yaşarhan | Fatura tutarı: 503.99'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2024000000052', '2024-07-05', '2024-10-03', 'EUR', 24555.22, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0004464 | İdevit: *0000318 | Sorumlu: Yaşarhan | Fatura tutarı: 24555.22'),
    (v_owner, 'INSTEEL ÇELİK', 'IDL2024000001474', '2024-09-19', null, 'TRY', 214218.57, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0005455 | Sorumlu: Yaşarhan | Fatura tutarı: 214218.57'),
    (v_owner, 'INSTEEL ÇELİK -İ. KAYITLI', 'IDL2024000001574', '2024-10-08', null, 'TRY', 374113.87, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0005559 | Sorumlu: Yaşarhan | Fatura tutarı: 374113.87'),
    (v_owner, 'BIOUT ALEAZ LİBYA', 'IHR2024000000079', '2024-10-23', null, 'USD', 890.35, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: kısmi geldi | İdeal: *0005463 | İdevit: *0000370 | Sorumlu: Yaşarhan | Fatura tutarı: 29980.35 | Not: 01.10.2024 tarihinde 10.000 / 24.10.2024 19.090 usd elden ödeme geldi.'),
    (v_owner, 'INSTEEL ÇELİK İ.KAYITLI 2024-04', 'IDL2024000001776', '2024-11-14', null, 'TRY', 4066.02, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0005749 | Sorumlu: Yaşarhan | Fatura tutarı: 4066.02'),
    (v_owner, 'EKVATOR', 'IDL2024000001862', '2024-11-28', null, 'TRY', 9416.29, 'Açık', 'Ödeme şekli: BEDELSİZ NUMUNE | Excel durumu: gelmedi | İdeal: *0005744 | Sorumlu: Yaşarhan | Fatura tutarı: 9416.29'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', 'IHR2024000000089', '2024-12-02', null, 'EUR', 755.98, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: geldi | İdeal: *0005848 | İdevit: *0000387 | Sorumlu: Yaşarhan | Fatura tutarı: 755.98'),
    (v_owner, 'INSTEEL ÇELİK İ. KAYITLI 2024-05', 'IDL2024000001948', '2024-12-11', null, 'TRY', 6502.33, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0005888 | Sorumlu: Yaşarhan | Fatura tutarı: 6502.33'),
    (v_owner, 'USPROM PTP', 'IHR2024000000093', '2024-12-17', '2025-02-15', 'EUR', 26782.11, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0005374 | İdevit: *0000366 | Sorumlu: Yaşarhan | Fatura tutarı: 26782.11'),
    (v_owner, 'INSTEEL ÇELİK ROMANYA', 'IDL2024000002071', '2024-12-27', null, 'TRY', 89940.35, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0005977 | Sorumlu: Yaşarhan | Fatura tutarı: 89940.35'),
    (v_owner, 'INSTEEL ÇELİK RLİBYA', 'IDL2024000002072', '2024-12-27', null, 'TRY', 3228.72, 'Açık', 'İdeal: *0006000 | Sorumlu: Yaşarhan | Fatura tutarı: 3228.72'),
    (v_owner, 'FIS DOO', 'IHR2025000000003', '2024-01-07', '2025-04-07', 'EUR', 906.63, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: geldi | İdeal: *0005902 | İdevit: *0000389 | Sorumlu: Yaşarhan | Fatura tutarı: 6693.84 | Not: 02.04.2025 tarihinde 5.787,21 euro ödeme gelmiştir. 906,63 euro 2024 yılı puantajına karşılık gelmektedir.'),
    (v_owner, 'BIOUT ALEAZ', 'IHR2025000000006', '2025-01-13', null, 'USD', 881.0, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: geldi | İdeal: *0005950 | İdevit: *0000392 | Sorumlu: Yaşarhan | Fatura tutarı: 29366.0 | Not: 14.01.2025 tarihinde 28.485,00 usd elden ödeme alınmıştır'),
    (v_owner, 'INSTEEL ÇELİK cezayir İ. KAYITLI', 'IDL2025000000256', '2025-02-11', null, 'TRY', 174949.94, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0006202 | Sorumlu: Yaşarhan | Fatura tutarı: 174949.94'),
    (v_owner, 'INSTEEL ÇELİK cezayir İ. KAYITLI', 'IDL2025000000255', '2025-02-11', null, 'TRY', 9255.36, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0006209 | Sorumlu: Yaşarhan | Fatura tutarı: 9255.36'),
    (v_owner, 'İNSTEEL ÇELİK', 'IDL2025000000442', '2025-03-12', null, 'TRY', 4580.15, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0006373 | Sorumlu: Yaşarhan | Fatura tutarı: 4580.15'),
    (v_owner, 'AKKURT', 'IHR2025000000017', '2025-03-12', null, 'EUR', 4080.0, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0006307 | İdevit: *0000414 | Sorumlu: Yaşarhan | Fatura tutarı: 4080.0'),
    (v_owner, 'SK TAOOIBAT FAS i. Kayıtlı', 'IDL2025000000518', '2025-03-22', null, 'TRY', 2243.0, 'Açık', 'Ödeme şekli: BEDELSİZ NUMUNE | Excel durumu: geldi | İdeal: *0006450 | Sorumlu: Selçuk | Fatura tutarı: 2243.0'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000000898', '2025-05-20', null, 'TRY', 5044.82, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0006747 | Sorumlu: Yaşarhan | Fatura tutarı: 5044.82'),
    (v_owner, 'REGATA', 'IDL2025000001007', '2025-06-04', null, 'TRY', 32472.45, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: geldi | İdeal: *0006759 | Sorumlu: Yaşarhan | Fatura tutarı: 74201.31 | Not: 23.05.2025 tarihinde 41.728,86 tl ödeme geldi'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000001022', '2025-06-12', null, 'TRY', 5533.57, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0006834 | Sorumlu: Yaşarhan | Fatura tutarı: 5533.57'),
    (v_owner, 'E. GRECH CRISTAL', 'ADV2025000000001', '2025-06-19', null, 'EUR', 320.0, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0006766 | İdevit: *0000439 | Sorumlu: Yaşarhan | Fatura tutarı: 320.0'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000001137', '2025-06-28', null, 'TRY', 16600.7, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0006878 | Sorumlu: Yaşarhan | Fatura tutarı: 16600.7'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000001359', null, null, 'TRY', 25843.27, 'Açık', 'İdeal: *0007072 | Sorumlu: Yaşarhan | Fatura tutarı: 25843.27 | Excel fatura tarihi: 28.07.025'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000001543', '2025-08-19', null, 'TRY', 182890.43, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0006933 | Sorumlu: Yaşarhan | Fatura tutarı: 182890.43'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000001542', '2025-08-19', null, 'TRY', 31131.73, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0007199 | Sorumlu: Yaşarhan | Fatura tutarı: 31131.73'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ - iade oldu', 'IDL2025000001659', '2025-09-03', null, 'TRY', 8346.03, 'Açık', 'İdeal: *0007297 | Sorumlu: Yaşarhan | Fatura tutarı: 8346.03'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000001670', '2025-09-04', null, 'TRY', 2483.75, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0007312 | Sorumlu: Yaşarhan | Fatura tutarı: 2483.75'),
    (v_owner, 'TALA 1 LETONYA', 'IHR2025000000073', '2025-09-05', null, 'EUR', 650.0, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0007245 | İdevit: *0000466 | Sorumlu: Yaşarhan | Fatura tutarı: 650.0'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000001788', '2025-09-23', null, 'TRY', 48000.0, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0007356 | Sorumlu: Yaşarhan | Fatura tutarı: 48000.0'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000001909', '2025-10-08', null, 'TRY', 141478.6, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0007447 | Sorumlu: Yaşarhan | Fatura tutarı: 141478.6'),
    (v_owner, 'İNSTEEL ÇELİK İ.KAYITLI LİBYA', 'IDL2025000002353', '2025-12-04', null, 'TRY', 172177.02, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0007711 | Sorumlu: Yaşarhan | Fatura tutarı: 172177.02'),
    (v_owner, 'İNSTEEL ÇELİK KDV''Lİ', 'IDL2025000002354', '2025-12-04', null, 'TRY', 4721.39, 'Açık', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0007712 | Sorumlu: Yaşarhan | Fatura tutarı: 4721.39'),
    (v_owner, 'FIS DOO', 'IHR2025000000089', '2025-12-10', '2026-03-10', 'EUR', 1081.37, 'Açık', 'Ödeme şekli: EXİMBANK MAL MUKABİLİ | Excel durumu: kısmi geldi | İdeal: *0007603 | İdevit: *0000483 | Sorumlu: Yaşarhan | Fatura tutarı: 4399.66 | Not: 11.03.2026 tarihinde 3.318,29 euro ödeme geldi'),
    (v_owner, 'İBRAHİEM ALNASSER', 'IHR2026000000052', '2026-09-14', null, 'USD', 1799.0, 'Açık', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0009056 | İdevit: *0000537 | Sorumlu: ömer | Fatura tutarı: 1799.0'),
    (v_owner, 'RUSYA', null, null, null, 'USD', 12628.9, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0001099 | İdevit: * | Sorumlu: Haluk | Fatura tutarı: 12628.9'),
    (v_owner, 'MURAT MATBAACILIK', null, null, null, 'USD', 25794.12, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0001096 | İdevit: * | Sorumlu: Haluk | Fatura tutarı: 25794.12'),
    (v_owner, 'ALVONA LLC', null, null, '2024-07-29', 'EUR', 2533.44, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0001341 | İdevit: *0000130 | Sorumlu: Yaşarhan | Fatura tutarı: 2533.44'),
    (v_owner, 'ESSA ABEDULFATTAH', null, null, null, 'USD', 88475.84, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0002712 | İdevit: *0000219 | Sorumlu: Haluk | Fatura tutarı: 88475.84'),
    (v_owner, 'İDEAL TANASA', null, null, null, 'USD', 9469.54, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: geldi | İdeal: *0003391 | İdevit: *0000253 | Sorumlu: Yaşarhan | Fatura tutarı: 9469.54 | Not: 02.08.2023 tarihinde 9.400,00 usd ödeme elden alındı.'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', null, null, null, 'EUR', 28673.43, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0004017 | İdevit: *0000290 | Sorumlu: Yaşarhan | Fatura tutarı: 28673.43'),
    (v_owner, 'KESKİN İNŞAAT', null, null, null, 'TRY', 126910.76, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: Kısmi geldi | İdeal: *0005943 | Sorumlu: Yaşarhan | Fatura tutarı: 176910.76 | Not: 19.12.2024 Tarihinde 50.000 TL ödeme geldi'),
    (v_owner, 'ALİYEEV İLKİN', null, null, null, 'USD', 8889.79, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0006038 | İdevit: *0000400 | Sorumlu: Selçuk | Fatura tutarı: 8889.79'),
    (v_owner, 'ALİYEV İLKİN', null, null, null, 'USD', 8989.79, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0006038 | İdevit: *0000400 | Sorumlu: Selçuk | Fatura tutarı: 8989.79'),
    (v_owner, 'TZX DIŞ TİCARET ALMANYA', null, null, null, 'TRY', 25805.95, 'Şüpheli', 'Ödeme şekli: PEŞİN | Excel durumu: gelmedi | İdeal: *0006358 | Sorumlu: Yaşarhan | Fatura tutarı: 25805.95'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', null, null, null, 'EUR', 503.99, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0006724 | İdevit: *0000437 | Sorumlu: Yaşarhan | Fatura tutarı: 503.99'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', null, null, null, 'EUR', 915.3, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0007203 | İdevit: *0000463 | Sorumlu: Yaşarhan | Fatura tutarı: 915.3'),
    (v_owner, 'PTP-USPROM USTREF TETOVO DOOEL', null, null, null, 'EUR', 1440.0, 'Şüpheli', 'Ödeme şekli: MAL MUKABİLİ | Excel durumu: gelmedi | İdeal: *0007532 | İdevit: *0000479 | Sorumlu: Yaşarhan | Fatura tutarı: 1440.0');

    -- Müşteri kartı eşleştirme: önce birebir ad, sonra ilk 6 harf.
    update manual_receivables mr
       set customer_id = c.id
      from customers c
     where mr.customer_id is null
       and lower(c.company_name) = lower(mr.customer_text);

    update manual_receivables mr
       set customer_id = c.id
      from customers c
     where mr.customer_id is null
       and length(mr.customer_text) >= 6
       and lower(left(c.company_name, 6)) = lower(left(mr.customer_text, 6));

    select count(*) into v_eslesen from manual_receivables where customer_id is not null;
    raise notice 'Aktarım tamam. Müşteri kartına bağlanan kayıt: %', v_eslesen;
end $$;

-- ============================================================
-- KONTROL
-- ============================================================
-- 1) Durum ve para birimi bazında toplam
-- select status, currency, count(*) adet, sum(amount) toplam
--   from manual_receivables group by status, currency order by status, currency;

-- 2) Müşteri kartına bağlanamayanlar (modülden elle bağlanacak)
-- select customer_text, count(*), sum(amount)
--   from manual_receivables where customer_id is null
--  group by customer_text order by sum(amount) desc;

-- 3) En büyük açık alacaklar
-- select customer_text, doc_no, doc_date, due_date, currency, amount, status
--   from manual_receivables where status = 'Açık'
--  order by amount desc limit 20;
