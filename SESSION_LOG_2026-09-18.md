# Oturum Özeti — Ödeme Takibi Modülü (15–18.09.2026)

Yeni oturumda bu dosyayı ver ve şunu söyle: **"SESSION_LOG_2026-09-18.md'yi oku, Ödeme Takibi'nden devam edelim."**

---

## 1. Durum (18.09.2026 sabahı)

- Ödeme Takibi modülü (payments.html / src/payments.js) baştan yazıldı; çalışıyor, Chrome'da test edildi.
- **SQL 037 HENÜZ ÇALIŞTIRILMADI** — ilk iş bu (aşağıda).
- **Hiçbir şey commit edilmedi.** Patron onayıyla sürüm **1.1.25** yapılıp commit edilecek (navbar.js `APP_VERSION`).
- İnci Hanım (Operasyon, ödeme takibi) sisteme dahil edilecek → Yönetici → Kullanıcılar → **Ödeme Takibi: Düzenle** yetkisi yeterli (orders yetkisi gerekmez; bakiye/etiket DB tarafında güncelleniyor, taşıma işlemleri security definer RPC ile).

## 2. Patron kararları (değişmez kurallar)

- **Kapsam: YALNIZCA sistemdeki siparişler** (şu an 122) + gelecekte eklenecekler. Sistemde siparişi olmayan eski alacaklar İnci Hanım'ın kendi kayıtlarında kalır; uygulamaya alınmaz. `manual_receivables` tablosu boş, kullanılmıyor.
- **Alacak faturayla doğar**, vade **fatura tarihinden** işler. Faturalanmamış sipariş bakiyesi alacak değildir ("henüz faturalanmamış").
- **Eximbank:** iç son gün = vade **+45**, V.G.A.B son günü = vade **+60**, tazminat başvurusu = vade **+90**. Eximbank'lı müşteriler: Paffoni, Herc, Arthema, Roper Rhodes, Fiss (limit EUR), Abid Med (limit USD).
- **Manuel Alacaklar** = ödemesinin ne zaman geleceği belli olmayan sistem siparişlerinin **serbest takibi** (not, hatırlatma; vade/gecikme uyarısı yok). Ödeme planı **isteğe bağlı** ektir (şu an sadece Sulav). Manuel takipte: Sulav 2024-02, Alvano 2023-01, Ptp Usprom (2025-03, 2026-01, 2026-02), Roccaforte 2025-01, Artvit (2025-03, 2025-04).
- **Banka kesintisi** (SWIFT 15–20 EUR/USD) müşteriden talep edilmez → tahsilatta "Kesinti" olarak kapatılır, ayrıca raporlanır.
- **Fazla ödeme** sonraki siparişe mahsup edilir (dağıtılmayan tutar = müşteri avansı → "Dağıt").
- **İhraç kayıtlı satış:** sipariş USD kalır, fatura anlaşmalı kurla TL kesilir, müşteri TL öder (fatura kaydında kur + sipariş para birimi karşılığı).
- **Insteel:** çekle öder, birkaç sevkte bir tek çek; ödeme şekli "Mal Mukabili", çek yazılana kadar vade yok. 2026-23 ve sonrası açık.
- **Vade hafta sonuna gelirse Pazartesi** (fatura penceresi bunu öneriyor).
- **Bedelsiz** ve **iptal** siparişler alacak sayılmaz.
- Para birimleri **asla toplanmaz**, her zaman para birimi bazında ayrı gösterilir.
- Toplu veri düzeltmeleri numaralı SQL scriptleriyle (`supabase/sql/`) yapılır, patron SQL Editor'de çalıştırır.

## 3. SQL scriptleri (supabase/sql)

| No | İçerik | Durum |
|---|---|---|
| 022 | Tahsilat defteri (payments, payment_allocations), bakiye trigger'ı, açılış bakiyeleri | ✅ |
| 023 | Eximbank alanları + 6 müşteri, bildirimler, ödeme planı (SULAV), çek tabloları, hatırlatma günlüğü | ✅ |
| 024 | İnci'nin tablosundan manuel alacaklar | ✅ (032 ile geri alındı) |
| 025 | Fiss ideal no, Insteel Mal Mukabili, Sulav/Alvano devri | ✅ (devir 032 ile geri alındı) |
| 026 / 027 | Siko düzeltmesi / geri alma + `order_invoices` tablosu | ✅ |
| 028–030 | Fatura aktarımı (103 fatura), ihraç kayıtlı kur alanları | ✅ |
| 031 | Fis Doo eski kalemler | ✅ |
| 032 | Manuel alacakların silinmesi, Sulav/Alvano devrinin geri alınması | ✅ |
| 033 | Küsuratlar, Insteel 2026-22 Bedelsiz, 2026-18 çekle ödendi | ✅ |
| 034 | `orders.manual_tracking` + RPC `set_order_manual_tracking`, Tehnomarket/Ltd Modus mahsupları | ✅ |
| 035 | RPC `date_opening_payment` (tarihsiz ödemeyi tarihlendir) | ✅ |
| 036 | Graniti tahsilat para birimi EUR→USD | ✅ |
| **037** | **Etiketlerin tahsilatla otomatik eşitlenmesi, fatura→sipariş vadesi trigger'ı, para birimi değişikliği trigger'ı, Elallar iadesi + notu, Insteel 2026-01 notu, Roper Rhodes vadesi 28.09.2026, bir kerelik etiket/vade eşitlemesi** | ⏳ **ÇALIŞTIRILMADI** |

## 4. Kod — değişen / yeni dosyalar (commit edilmedi)

- `src/utils/receivables.js` **(yeni)** — ortak hesap: `buildReceivables`, `eximbankInfo`, `installmentStatus`, `isOrderOverdue`, `termDays`, `ROUNDING_TOLERANCE` (0,05).
- `payments.html`, `src/payments.js` — 5 sekme: Genel Bakış (tıklanabilir KPI panelleri), Açık Alacaklar (yaşlandırma, sıralama, taşı/fatura butonları), Tahsilatlar (**sipariş bazında** gruplu, arşiv "Tarih gir"), Eximbank (limit kartları), Manuel Alacaklar (serbest tablo + isteğe bağlı plan). Pencereler: Tahsilat Gir (serbest yazılı firma arama, en eski vadeden dağıt, kesinti, TL/kur), Sipariş faturaları, Ödeme planı, Tarih gir, Eximbank bildirimi, Hatırlatma.
- `src/orders.js`, `orders.html` — Avans alanı salt-okunur ("Tahsil"), form/Excel içe aktarma bakiye yazmaz (`recalc_order_payment_totals` RPC), "Gecikme" etiketi ekle/kaldır, iptal kartında "İptal", silme onayında bağlı kayıtlar.
- `src/dashboard.js` — Vadeli Bakiye / Gecikmiş Borç / Ödeme Durumu Ödeme Takibi hesabından.
- `src/order-timeline.js` — gecikme `isOrderOverdue` ile.
- `src/customer-score.js` — olmayan `payment_status` yerine `isOrderOverdue` (modül yeniden çalışıyor).
- `src/help.js` — Ödeme Takibi kılavuzu yeniden yazıldı.
- `supabase/sql/022…037`.

## 5. Açık işler / sıradakiler

1. **037'yi çalıştır** → sonra Chrome'da kontrol: etiketler, Elallar/Insteel notları, Roper Rhodes vadesi.
2. **Commit** (sürüm 1.1.25) — patron onayı ile.
3. İnci Hanım'a yetki.
4. **Müşteri Skoru hacim puanı para birimlerini karıştırıyor** (TRY'li Insteel en üstte, TRY tutar "$" ile gösteriliyor, iptal Elallar hacme giriyor) — patrona söylendi, düzeltilmedi.
5. Menü: Ödeme Takibi "BI Raporları" altında → "Müşteri İşlemleri"ne taşıma önerildi, cevap bekleniyor.
6. Tarihlendirilemeyen 9 geçmiş ödeme (patron karar verecek): Roko Yapı 2026-01 (notta 18.12.2026 — muhtemelen 18.06), Fiss 2025-06, Tzx 2026-01, Abid Med 2025-02, Amco 2025-02, Aldex 2023-03, Gk İhracat 2026-03, Tehnomarket 2026-02 ve Ltd Modus 2026-01 (mahsuplu — ekrandan tarihlendirilemez, SQL gerekir).
7. Faturası sistemde olmayan sevkli siparişler (manuel takipte): Sulav 2024-02, Alvano 2023-01, Ptp Usprom 2026-01/02 — fatura penceresinden girilebilir.
8. İleride (Faz 2): çek takibi ekranı (Insteel), müşteri cari ekstresi Excel çıktısı.

## 5b. 18.09.2026 öğleden sonra

- **037 çalıştırıldı ve doğrulandı** (Elallar/Insteel notları, Roper Rhodes 2026-02 vadesi 28.09.2026, etiket–bakiye uyumsuzluğu 0).
- Dashboard: Ciro/Tahsil'den iptal + bedelsiz çıkarıldı; **Bakiye Köprüsü** paneli eklendi (Ciro − Tahsil → vadeli / gecikmiş / faturalanmamış / manuel / diğer yıllar; manuel takip toplamı). Yardım › Dashboard açıklaması yazıldı.
- Paffoni 2026-01/02 sipariş tarihleri 25.12.2025 — patron: DOĞRU (2025 cirosunda kalır; gecikmiş 19.293,16 EUR = Paffoni 2026-02).
- Menü: Ödeme Takibi "Müşteri İşlemleri" altına taşındı. Sürüm 1.1.25, commit edildi.
- 9 tarihsiz ödeme: sonraya bırakıldı.
- Müşteri Skoru: teşhis yapıldı (hacimde para birimi karışıyor, siparişsiz 416 müşteri B alıyor, şikayet hacme oranlanmıyor, iskonto kriteri tartışmalı). Patron: Ödeme Takibi bitince dönülecek.

## 6. Teknik notlar

- Uygulama: `http://localhost:5173/` (Vite). Patronun Chrome'unda Claude eklentisi oturum açık; veri kontrolleri sayfada `await import('/src/utils/supabaseClient.js')` ile yapılıyor. Konsol çıktısı ~1000 karakterde kesiliyor → sonucu `window.__x`'e yazıp parça parça oku.
- İnci Hanım'ın tablosu: `Masaüstü\2026 İHRACAT SEVKİYATLAR .S.....xlsx` (adı değişebiliyor, glob ile bul), sayfa "ödeme takip"; İDEAL no ↔ `orders.ideal_order_no` birebir eşleşir.
- Uzun Python/SQL üretimini bash heredoc ile yapma (tırnaklı uzun gövdede kırılıyor) → Write ile dosya yaz, çalıştır.
- Tüm diyaloglar `src/utils/dialogs.js` (native alert/confirm yok). Denetim kaydı `src/utils/auditLog.js`.
- Ayrıntılı geçmiş hafızada: `project_exportpro_payments_module.md`.
