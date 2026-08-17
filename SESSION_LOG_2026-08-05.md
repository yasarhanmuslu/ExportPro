# Oturum Notu — 2026-08-05: Müşteri Sabit Fiyatlar

## Ne oldu

Modül aslında baştan beri yazılmıştı, sadece hiç bağlanmamıştı. Menüdeki giriş
`fixed-prices` id'siyle `href:'#'` ve "yakında" rozetiyle duruyordu; gerçek sayfanın
id'si `client-prices`. Sayfa ayrıca `vite.config.js` input listesinde olmadığı için
production build'de hiç üretilmiyordu.

Modülün amacı da netleşti: **elle tutulan anlaşma fiyatı kaydı**. `order_items`'tan
türetilmeyecek — çünkü Credit Note sebebiyle sipariş bazlı fiyat sapabilir ama
müşterinin anlaşılmış sabit fiyatı ayrı bir gerçektir.

## Yapılanlar (hepsi commit EDİLMEDİ — çalışma dizininde duruyor, branch: main)

- `src/components/navbar.js` — menü gerçek sayfaya bağlandı, "yakında" kalktı
- `vite.config.js` — `clientPrices` build input'u eklendi
- `src/utils/permissions.js` — modül listesine yerleşti, `note:'menüde yok'` kalktı
- `src/client-prices.js` — para birimi desteği + 2 native `alert()` → temalı dialog
- `client-prices.html` — para birimi seçimi, dinamik semboller, başlık
- `supabase/sql/009_add_currency_to_customer_prices.sql` — YENİ dosya

`npm run build` temiz geçti, `dist/client-prices.html` üretiliyor.

---

## KALDIĞIN YER — sırayla yapılacaklar

### 1. SQL'i çalıştır (ÖNCE BU — sıralama önemli)

`supabase/sql/009_add_currency_to_customer_prices.sql` dosyasını Supabase SQL
Editor'de çalıştır.

**Neden önce:** Kod artık `insert`'te `currency` alanı gönderiyor. Kolon yokken
fiyat kartı kaydetmeye çalışırsan hata alırsın.

Script mevcut satırları **EUR olarak bırakıyor** — bilerek. Bugüne kadar arayüz her
fiyatı € gösterdiği için girilen veriler EUR anlamı taşıyor. Eğer aslında müşteri
para biriminde girdiysen, script içinde yorumlu bir backfill bloğu ve önce etkiyi
görmen için bir önizleme sorgusu var.

### 2. Yetkileri ver

Modül artık admin panelindeki modül listesinde. Sahip dışındaki kullanıcılar için
görüntüleme/düzenleme yetkisini elle tanımla.

RLS tarafı zaten hazırdı — `003_module_scoped_rls.sql` `customer_prices` tablosunu
`client-prices` modülüne bağlamış, ek bir şey gerekmiyor.

### 3. Görsel kontrol

Sayfayı oturum açmış halde bir aç, modalı kontrol et. (Bu oturumda giriş
yapılamadığı için sadece kod ve build doğrulandı, görünüm doğrulanmadı.)

### 4. Karlılık Analizi'ni para birimi bazlı yap

`src/profitability.js:506` hâlâ "sabit fiyatlar her zaman EUR" varsayıyor ve EUR
olmayan sipariş kalemlerini karşılaştırmadan atıyor.

Bugün bir şey bozulmaz (tüm satırlar EUR). Ama **ilk EUR olmayan fiyat kartını
girdiğin anda Karlılık Analizi yanlış sonuç vermeye başlar.**

`customer-score.js` ve `dashboard.js` de bu tabloyu okuyor ama sadece
`discount_rate` (yüzde) kullanıyorlar — para biriminden bağımsızlar, dokunma.

---

## Sonraya bıraktıkların

Modüle ekleyeceğin ilave özellikler vardı, "durumu karmaşık hale getirmemek için"
sonraya bıraktın. Onlar hâlâ bekliyor.
