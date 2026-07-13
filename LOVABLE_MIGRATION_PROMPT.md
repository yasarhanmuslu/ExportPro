# EXPORT SUITE — Lovable.dev Migrasyon Promptu

> Bu doküman, mevcut "Export Suite" (ExportPro) uygulamasının **tamamının** — veritabanı şeması, iş kuralları, hesaplama motorları ve arayüzün her ayrıntısıyla — Lovable.dev üzerinde sıfırdan yeniden inşa edilmesi için hazırlanmış tek parça bir prompttur. Lovable'a doğrudan bu dokümanın tamamını (veya bölüm bölüm, aşağıdaki sıraya göre) yapıştırabilirsiniz.
>
> Kaynak uygulama: vanilla JS + Vite (çok-sayfalı/MPA) + Supabase. Hedef: React + TypeScript + Tailwind + Supabase (Lovable'ın doğal stack'i), tek sayfa uygulama (SPA) + React Router.

---

## 0. Genel Talimat (Lovable'a doğrudan hitap)

Sen bir **"Kurumsal İhracat Yönetim Sistemi"** (export/dış ticaret ERP'si) inşa ediyorsun. Uygulama adı **"Export Suite"**. Kullanıcı kitlesi: seramik/sağlık gereçleri gibi fiziksel ürün ihraç eden bir üretici firmanın ihracat departmanı (sipariş, teklif, müşteri, sevkiyat, fiyatlandırma, kalite/şikayet ve karlılık süreçlerini tek yerden yönetiyorlar).

Mimari kurallar:
- **Çok kullanıcılı, kullanıcı-bazlı izolasyon (multi-tenant, per-user)** — paylaşımlı takım/organizasyon modeli DEĞİL. Her tabloya `user_id uuid references auth.users(id)` kolonu ekle; her sorguyu ve her RLS politikasını `auth.uid() = user_id` ile sınırla (aşağıda tablo bazında istisnalar/alt-tablo RLS notları var, dikkatle uygula).
- Kimlik doğrulama: Supabase Auth, **e-posta + şifre**. Kayıt (sign up) herkese açık, davet kodu/departman kısıtlaması yok. E-posta doğrulama Supabase varsayılanına bırakılabilir.
- Tüm arayüz metinleri **Türkçe**. Sayı/para formatı `tr-TR` locale (virgül ondalık ayracı, nokta binlik ayracı: `15.000,00`).
- Bu bir **SPA** olacak (React Router ile), ama orijinal uygulama çok-sayfalı (MPA) bir yapıya sahipti — aşağıdaki "Sayfa" başlıkları senin route'ların olacak (örn. `/orders`, `/quotations`).
- Tasarım dili, renk paleti, tipografi ve bileşen görünümleri **Bölüm 3'te tanımlanan tasarım sistemine harfiyen uy** — bu bir "AI şablonu" değil, bilinçli olarak tasarlanmış minimal/porselen/kurumsal bir estetik.

---

## 1. Proje Özeti ve Modüller

Sol tarafta sabit (230px) bir kenar çubuğu menüsü var, aşağıdaki gruplama ve sırayla:

```
Export Suite (logo + "İHRACAT YÖNETİMİ" alt başlık)
├─ Dashboard                     /
├─ Takip Takvimi                 /order-timeline
├─ Tanımlar (accordion)
│   ├─ Müşteri Kartları          /customers
│   ├─ Ürün Kartları             /products
│   └─ Palet Tanımları           /pallet-definitions
├─ Müşteri İşlemleri (accordion)
│   ├─ Siparişler                /orders
│   ├─ Teklifler                 /quotations
│   ├─ Müşteri Sabit Fiyatlar    (devre dışı, "yakında" rozeti — /client-prices sayfası kodda var ama menüde pasif gösteriliyor; sen aktif menü linki olarak ekle, "yakında" rozetini KALDIR çünkü sayfa gerçekte çalışıyor)
│   └─ Credit Notes               /credit-notes
├─ Fiyat Robotu                  /prices
├─ BI Raporları (accordion)
│   ├─ Karlılık Analizi           /profitability
│   ├─ Şikayet Panosu             /complaints
│   ├─ Ödeme Takibi               /payments
│   ├─ Müşteri Skoru              /customer-score
│   ├─ Ürün Analizi               /product-analysis
│   └─ Pazar Analizi              /market-analysis
├─ Yükleme Planlayıcı            /loading-planner
└─ ─────────────
   Yardım & Kılavuz              /help
```

Akordeon davranışı: aynı anda sadece bir grup açık olabilir; aktif sayfa hangi gruptaysa o grup otomatik açık gelir.

Alt kısımda (sidebar footer): kullanıcı e-postası, sürüm etiketi, Tema değiştir butonu (Koyu/Açık, ay/güneş ikonu), Çıkış Yap butonu.

Tüm sayfa gövdeleri `margin-left: 230px` ile kaydırılır, üst kısımda başlık + açıklama + aksiyon butonları (sayfaya özel: Excel Import, Dışa Aktar, Yeni Kayıt vb.) bulunan bir `<header>` bloğu ile başlar.

---

## 2. Teknoloji Gereksinimleri

- React 18 + TypeScript, React Router (SPA).
- Tailwind CSS — ama **Bölüm 3'teki custom CSS değişkenlerini** (design tokens) `tailwind.config` ve/veya global CSS içinde birebir tanımla; Tailwind'in varsayılan renk paletini KULLANMA, aşağıdaki custom paleti kullan.
- Supabase (Auth + Postgres + Storage — ürün görselleri için 1 bucket gerekiyor: `urun-resimleri`).
- Grafikler: Chart.js (line, bar, doughnut, horizontal bar) — orijinal uygulamada birebir bu kütüphane kullanılıyor.
- Excel içe/dışa aktarma: `xlsx` (veya `xlsx-js-style` eşdeğeri, stilli export gerekiyor — hücre renkleri, kalın başlıklar).
- PDF'den kalem içe aktarma: `pdfjs-dist` (orders modülünde proforma fatura PDF parse özelliği var, Bölüm 7.1'de tam detay).
- 3D görselleştirme: **Three.js** + OrbitControls — Yükleme Planlayıcı modülünde tır/konteyner içi 3D paletleme görselleştirmesi var (Bölüm 7.16, kritik özellik).
- Font: **Verdana, Geneva, sans-serif** — tüm uygulamada, başlıklar dahil (Google Fonts kullanma, sistem fontu).
- Native `alert()/confirm()/prompt()` KULLANMA — özel temalı modal dialog bileşenleri kullan (Bölüm 3.5'te tanımlanan stil).

---

## 3. Tasarım Sistemi ("Porselen Tasarım Sistemi")

Estetik ilkesi: **Minimal · Seramik · Kurumsal · Hassas**. Kartlar beyaz/krem zemin üzerinde ince border'lı, gölgesiz veya çok hafif gölgeli; renk paleti toprak tonları + koyu yeşil aksan.

### 3.1 Renk Token'ları (Açık Tema — varsayılan)

```css
--bg:           #F6F3EC;  /* sayfa arka planı */
--surface:      #FFFFFF;  /* kart/panel zemini */
--surface-2:    #FBF8F1;  /* ikincil zemin (tablo başlığı, sidebar footer) */
--border:       #E4DDCE;
--border-soft:  #EFEAE0;

--ink-1:        #1C1A17;  /* ana metin */
--ink-2:        #6B655B;  /* ikincil metin */
--ink-3:        #968B7A;  /* etiket/placeholder/muted */

--accent:       #2D4A3E;  /* koyu yeşil — birincil marka rengi, aktif durumlar, primary butonlar */
--accent-soft:  #E8EEEA;
--bronze:       #B58858;  /* vurgu/eyebrow rengi */
--bronze-soft:  #F2E9DA;

--ok:           #3D6E50;  --ok-soft:     #E1EBE4;
--warn:         #B26B33;  --warn-soft:   #F3E5D2;
--danger:       #9F3D3D;  --danger-soft: #F1DDD9;
--info:         #3F5C7A;  --info-soft:   #E0E6EE;

--sidebar-bg: #FFFFFF; --sidebar-border: #EFEAE0; --sidebar-w: 230px;
```

### 3.2 Renk Token'ları (Koyu Tema — "Antrasit Seramik")

```css
--bg:           #1C1A17;  --surface:  #252320;  --surface-2: #2A2724;
--border:       #3A3630;  --border-soft: #302D28;

--ink-1:        #F0EDE6;  --ink-2:    #A8A097;  --ink-3:     #6B6458;

--accent:       #5A8A72;  --accent-soft: rgba(90,138,114,0.15);
--bronze:       #C9A06A;  --bronze-soft: rgba(181,136,88,0.18);

--ok:      #5A8A72; --ok-soft: rgba(61,110,80,0.20);
--warn:    #C98A4A; --warn-soft: rgba(178,107,51,0.20);
--danger:  #C05A5A; --danger-soft: rgba(159,61,61,0.20);
--info:    #6A8EAA; --info-soft: rgba(63,92,122,0.20);

--sidebar-bg: #1F1D1A; --sidebar-border: #302D28;
```

Tema değişimi `<html>` üzerine `class="light"`/`class="dark"` ekleyerek yapılır, `localStorage` key: `ep-theme`. Tüm renk geçişleri `transition: background-color .25s ease, border-color .25s ease, color .2s ease` ile yumuşak.

### 3.3 Tipografi

```css
--font-base: Verdana, Geneva, sans-serif;
--text-page-title: 24px;  --weight-page-title: 500;   /* her sayfanın h2'si */
--text-card-title: 16px;  --weight-card-title: 600;
--text-kpi-lg: 28px;      --weight-kpi: 600;          /* ≤4 KPI kartı yan yana */
--text-kpi-sm: 22px;                                   /* ≥5 KPI kartı yan yana */
--text-label-caps: 10px;  --weight-label-caps: 600; --ls-label-caps: 0.12em; /* uppercase etiket */
--text-body: 13px;
--text-caption: 11px;
--text-table-header: 10px; --ls-table-header: 0.12em; /* uppercase tablo th */
```

Body font-size 14px, line-height 1.55. `h1-h4` letter-spacing: -0.01em.

### 3.4 Bileşen Kalıpları

- **`.kpi-card` / `.section-card` / `.chart-card` / `.stat-card`**: `background: var(--surface); border: 1px solid var(--border-soft); border-radius: 8-10px; padding: 18-22px;` hover'da border rengi koyulaşır, hafif gölge.
- **`.data-table`**: th'ler `var(--surface-2)` zemin, uppercase, 10px, `letter-spacing:.12em`, `color: var(--ink-3)`; td'ler 13px `var(--ink-2)`; satır hover'da `var(--surface-2)`.
- **Input/select/textarea**: `height: 38px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface);` focus'ta `border-color: var(--accent)` + `box-shadow: 0 0 0 3px rgba(45,74,62,0.08)`. Select'lerde custom chevron ikonu (SVG data-uri, sağda).
- **Butonlar**: varsayılan `background: var(--surface); border: 1px solid var(--border);`. Primary/kaydet butonları `background: var(--ink-1)` (siyaha yakın) veya modüle göre `var(--accent)` (koyu yeşil), `color: #fff`. Height 36-40px, border-radius 6px, font 12.5-13px 600-700 weight.
- **Modal**: `.modal-backdrop` = tam ekran, `background: rgba(28,26,23,0.5); backdrop-filter: blur(4px);`. `.modal-content` = `background: var(--surface); border-radius: 10-12px; max-width` içeriğe göre 24rem (dialog) — 62rem (form modal); `box-shadow: 0 8px 32px rgba(28,26,23,.12)` (koyu temada `0 8px 40px rgba(0,0,0,.5)`).
- **Sekmeli modal** deseni (Siparişler/Teklifler/Ürünler/Müşteriler modallarında tekrar eder): üstte `.modal-tabs` (yatay sekme butonları, aktifte `border-bottom: 2px solid var(--accent); color: var(--accent)`), altta kaydırılabilir `.modal-scroll-body`, en altta sabit buton satırı (Sil solda / İptal + Kaydet sağda).
- **Rozet/badge (`.pill`)**: `border-radius: 999px; padding: 3px 9px; font-size: 11px; font-weight: 500;` durum renklerine göre `*-soft` arka plan + koyu ton yazı (örn. Aktif → `ok-soft` bg + `ok` text).
- **KPI kartı**: üstte uppercase mini etiket (`ink-3`, 10px), altında büyük sayı (28-30px, 500-600 weight, `ink-1`), bazen alt satırda karşılaştırma/oran (`ok`/`warn` renkli, ok ikonlu).

### 3.5 Özel Dialog Sistemi (native alert/confirm/prompt yerine)

Üç fonksiyon, Promise tabanlı, tüm modüllerde ortak kullanılıyor — Lovable'da bunu bir `useDialog()` hook / context olarak kur, her sayfa/bileşen bunu import edip kullansın:

- `showAlertDialog(message, {title, variant, okText})` → tek "Tamam" butonlu bilgi/hata kutusu.
- `showConfirmDialog(message, {title, variant, confirmText, cancelText})` → "Vazgeç"/"Devam Et" iki butonlu, `boolean` resolve eder.
- `showPromptDialog(message, defaultValue, {title, confirmText, cancelText})` → tek metin input'lu, `string | null` resolve eder.

`variant`: `info` (yeşil ikon), `success` (yeşil), `warn` (turuncu), `danger` (kırmızı) — her biri kendi ikon+renk setiyle üstte ikon rozeti + başlık + mesaj gösterir. Escape tuşu / backdrop tıklaması iptal sayılır (alert'te Enter/Escape ikisi de kapatır).

**Kural: Uygulamanın hiçbir yerinde native `window.alert/confirm/prompt` kullanılmayacak.**

---

## 4. Kimlik Doğrulama

- Giriş sayfası: e-posta + şifre formu, alttan "Kayıt Olun" / "Giriş Yapın" toggle'ı ile aynı form hem login hem signup modunda çalışır (`supabase.auth.signInWithPassword` / `supabase.auth.signUp`).
- Oturum yoksa her korumalı route login'e yönlendirir; oturum varsa login sayfası otomatik ana sayfaya yönlendirir.
- Login sayfası tasarımı: ortalanmış kart, üstte logo rozeti + "Export Suite" başlığı + "Kurumsal İhracat Yönetim Sistemi" alt yazı, kartın üstünde bronz renkli uppercase "Hesabınıza Giriş Yapın" eyebrow etiketi. **Arka planda hareketli "constellation" (yıldız haritası) canvas animasyonu** — rastgele hareket eden noktalar birbirine ve fare imlecine yakınlığa göre çizgilerle bağlanıyor, tema rengine göre renklenıyor (bunu bir dekoratif React canvas bileşeni olarak birebir uygula, kullanıcı deneyimi açısından önemli bir marka detayı). Sağ üstte tema değiştir butonu.
- Çıkış: `supabase.auth.signOut()` → login'e yönlendir.

---

## 5. Veritabanı Şeması (Supabase / Postgres)

> Her tabloda RLS **açık** olacak. Aksi belirtilmedikçe standart politika:
> ```sql
> create policy "user_isolation" on <table>
>   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
> ```
> `user_id` kolonu **olmayan** alt tablolar (aşağıda özellikle işaretli) için RLS, üst tablo üzerinden `exists (select 1 from parent where parent.id = child.parent_id and parent.user_id = auth.uid())` şeklinde kurulmalı.

### 5.1 `customers` — Müşteri Kartları

```sql
create table customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  company_name text not null,
  country text not null,
  region text,                          -- DERIVED, kullanıcı düzenlemez (bkz. 7.3 iş kuralı)
  contact_name text,
  email text,
  phone text,
  contact_name_2 text,
  email_2 text,
  phone_2 text,
  website text,
  client_group text default 'Toptancı', -- enum aşağıda
  status text not null default 'Aktif', -- enum: Aktif | Pasif | Potansiyel | Kara Liste
  short_info text,
  currency text not null default 'EUR', -- enum: EUR|USD|TRY|GBP
  incoterms text not null default 'FOB',-- enum: EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP
  payment_term text not null default 'Peşin', -- enum aşağıda
  acquisition_source text default 'Diğer',    -- enum aşağıda
  account_owner text default 'Atanmadı',
  vat_number text,
  language text,           -- enum: İngilizce|Almanca|Fransızca|Arapça|Rusça|İspanyolca|Türkçe|Diğer
  risk_score int,          -- 1-5
  credit_limit numeric,
  annual_volume_target numeric,
  product_interests text,
  first_order_date date,
  last_order_date date,
  history_notes jsonb default '[]'::jsonb,  -- [{date, note}, ...]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on customers(user_id);
```

Enum sözlükleri:
- `client_group`: Distribütör, Toptancı, Bayi, Perakendeci, Projeci, Üretici, OEM
- `payment_term`: Peşin, Akreditif (LC), Vesaik (CAD), Mal Mukabili, Avans + Bakiye, Vadeli (30/60/90 gün)
- `acquisition_source`: Fuar, Web Sitesi, Referans, Pazar Araştırması, Sosyal Medya, Ticaret Müşaviri, Diğer

### 5.2 `urunler` — Ürün Kartları (ana ürün kataloğu)

```sql
create table urunler (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  stok_kodu text not null,          -- app seviyesinde tekillik kontrolü var, DB constraint YOK (bkz not)
  stok_adi_1 text not null,         -- Türkçe ad
  stok_adi_2 text,                  -- İngilizce/2. ad
  seri_adi text,
  birim text,                       -- enum: Adet|Set|Metre
  paketleme text,                   -- enum: Kutulu|Kutusuz|Poşet|Koli|Naylon
  urun_grubu text,
  urun_turu text,
  fonksiyon_1 text, fonksiyon_2 text, fonksiyon_3 text,
  boyut_ozelligi text,
  renk text,
  kalite text,                      -- enum: 1.Kalite|2.Kalite
  agirlik_net numeric,              -- kg
  agirlik_brut numeric,             -- kg
  palet_adedi numeric,
  en_cm numeric, boy_cm numeric, yukseklik_cm numeric,
  palet_cinsi text,                 -- enum: EUR1|EUR3|Euro Palet|Standart Palet|Ahşap Kafes
  resim_path text,                  -- Storage: bucket 'urun-resimleri', path {userId}/{productId}-{ts}.jpg
  created_at timestamptz not null default now()
);
create index on urunler(user_id);
```

> **ÖNEMLİ**: `stok_kodu` üzerinde DB-seviyesinde UNIQUE constraint YOKTU orijinal uygulamada (mükerrer kodlar sayfa üzerinde bir uyarı/KPI olarak gösteriliyordu, engel değil). Migrasyonda bunu birebir koru (unique constraint EKLEME) — sayfa hâlâ mükerrer kod sayısını KPI olarak göstermeli ve satırda "⚠ Nx" rozeti basmalı.

### 5.3 `urun_gecmisi` — Ürün Denetim Kaydı (audit log, trigger ile dolar)

```sql
create table urun_gecmisi (
  id uuid primary key default gen_random_uuid(),
  urun_id uuid not null references urunler(id) on delete cascade,
  islem_zamani timestamptz not null default now(),
  islem text not null,     -- INSERT | UPDATE | DELETE
  alan text,                -- değişen kolon adı (UPDATE'te dolu, diğerlerinde null)
  eski_deger text,
  yeni_deger text
);
```

Bu tablo **uygulama tarafından hiç yazılmaz** — `urunler` tablosu üzerinde bir Postgres trigger (`AFTER INSERT/UPDATE/DELETE`) her satır değişikliğini otomatik loglamalı: INSERT'te tek satır (`islem='INSERT'`, alan/eski/yeni null), DELETE'te tek satır (`islem='DELETE'`), UPDATE'te **her değişen kolon için ayrı bir satır** (`alan` = kolon adı, `eski_deger`/`yeni_deger` = eski/yeni metin karşılığı) — sadece gerçekten değişen alanlar için satır üret, değişmeyenler için üretme. Ürün Kartları modülünde "Geçmiş" sekmesi bu tabloyu `urun_id` ile filtreleyip `islem_zamani desc` sırayla, 200 kayıt limitiyle gösterir.

Alan adı → Türkçe etiket sözlüğü (UI'da göster): stok_kodu, stok_adi_1, stok_adi_2, birim, paketleme, seri_adi, urun_grubu, urun_turu, fonksiyon_1/2/3, boyut_ozelligi, renk, kalite, agirlik_net, agirlik_brut, palet_adedi, en_cm, boy_cm, yukseklik_cm, palet_cinsi — hepsinin Türkçe karşılığı var, kendi başlıklarıyla eşle.

### 5.4 `products` — İkincil/Sade Ürün Tablosu (SADECE Fiyat Kartları + Credit Notes için)

```sql
create table products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  product_name text not null,
  product_code text,
  product_group text
);
```

> **BİLİNEN TEKNİK BORÇ — bilinçli olarak koru**: Orijinal uygulamada `urunler` (tam katalog) ile bu `products` (sade tablo) birbirinden bağımsız, senkronize OLMAYAN iki ayrı tablo. `products` sadece Müşteri Sabit Fiyatlar (`customer_prices.product_id`) ve Credit Notes (`credit_note_items.product_id`) modüllerinde kullanılıyor; `urunler` ise Siparişler/Teklifler/Palet Tanımları/Ürün Kartları modüllerinde. Bunu **birleştirmeden**, aynen iki ayrı tablo olarak kur (kullanıcı ileride birleştirme kararını ayrıca verecek). `products.user_id` bazı sorgularda filtrelenmiyor (credit-notes.js tüm kullanıcıların ürünlerini çekiyor) — sen tutarlılık için RLS ile `user_id = auth.uid()` uygula (bu daha güvenli varsayılan).

### 5.5 `orders` — Siparişler

```sql
create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  customer_id uuid not null references customers(id),  -- FK adı: fk_orders_customer
  order_number text,             -- (customer_id, order_number) birlikte "mantıksal" unique (app seviyesi kontrol)
  idevit_order_no text,          -- kullanıcı bazında global unique (app seviyesi kontrol)
  ideal_order_no text,           -- kullanıcı bazında global unique (app seviyesi kontrol)
  order_type text,               -- enum: İhracat|İhraç Kayıt|KDV
  order_date date not null default current_date,
  shipment_date date,
  due_date date,
  currency text not null default 'EUR',   -- enum: EUR|USD|TRY|GBP
  total_amount numeric not null check (total_amount > 0),
  advance_payment numeric default 0,
  remaining_balance numeric not null default 0,  -- = total_amount - advance_payment, uygulama hesaplar
  payment_method text,           -- enum: Peşin|100% T/T|Mal Mukabili|Bedelsiz|30/60/90/120 Gün Vade
  order_status text not null default 'Devam Ediyor',   -- legacy tekil alan, status_tags[0] ile senkron tutulur
  status_tags text[] not null default array['Devam Ediyor'],
  order_quantity text,
  order_notes text,
  created_at timestamptz not null default now()
);
alter table orders add constraint fk_orders_customer foreign key (customer_id) references customers(id);
create index on orders(user_id);
create index on orders(customer_id);
```

`status_tags` / `order_status` enum listesi (çoklu seçilebilir):
`Devam Ediyor, Üretimde, Üretime Hazır, Sevke Hazır, Sevk Edildi, Bakiye Bekliyor, Ödeme Tamamlandı, Teslim Edildi, İptal, Gecikme, Yeni Müşteri`

> `Gecikme` etiketi UI'da manuel seçilebilir bir checkbox olsa da, normalde **sistem tarafından otomatik eklenir** (bkz. 7.1 iş kuralı) — asla otomatik kaldırılmaz.

Silme davranışı: `order_items` (bkz 5.6) veya diğer bağlı kayıtlar varsa DB `ON DELETE RESTRICT` (varsayılan) — uygulama Postgres hata kodu `23503`'ü yakalayıp "Bu sipariş silinemez! Bağlı credit note veya kalem kaydı var." mesajı gösteriyor. Bunu birebir koru.

### 5.6 `order_items` — Sipariş Kalemleri

```sql
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  product_id uuid references urunler(id),   -- nullable, serbest metin ürünlere izin var
  product_name text not null,
  product_code text,
  quantity numeric,
  unit_price numeric,
  currency text not null,     -- kaydedilirken üst siparişin para biriminden kopyalanır
  notes text,
  created_at timestamptz not null default now()
);
create index on order_items(order_id);
```

`amount` (tutar) **kolon olarak saklanmaz** — her yerde `quantity * unit_price` client-side hesaplanır ve gösterilir.

### 5.7 `quotations` — Teklifler

```sql
create table quotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  customer_id uuid not null references customers(id),  -- default FK adı: quotations_customer_id_fkey
  quotation_number text,    -- BİLEREK unique DEĞİL — aynı teklif no birden fazla kayıtta tekrar edebilir
  quotation_date date not null default current_date,
  valid_until date,
  order_type text,          -- enum: İhracat|İhraç Kayıt|KDV
  currency text not null default 'EUR',
  total_amount numeric not null check (total_amount > 0),
  order_quantity text,
  payment_method text,      -- orders ile aynı enum
  status text not null default 'Bekliyor',  -- enum: Bekliyor|Kabul|Red|Süresi Doldu|Sipariş Dönüştü
  notes text,
  created_at timestamptz not null default now()
);
create index on quotations(user_id);
```

`Sipariş Dönüştü` durumu **UI'da manuel seçilemez** (select'te disabled) — sadece "Siparişe Gönder" aksiyonu ile sistem tarafından set edilir.

### 5.8 `quotation_items` — Teklif Kalemleri

```sql
create table quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  product_id uuid references urunler(id),
  product_name text not null,
  product_code text,
  quantity numeric,
  unit_price numeric,
  currency text not null,
  notes text,
  created_at timestamptz not null default now()
);
create index on quotation_items(quotation_id);
```

> **DİKKAT — RLS özel durum**: Bu tabloda `user_id` kolonu YOK (bilinçli olarak orijinalde de yok). RLS politikası üst tablo üzerinden kurulmalı:
> ```sql
> create policy "quotation_items_isolation" on quotation_items for all
>   using (exists (select 1 from quotations q where q.id = quotation_items.quotation_id and q.user_id = auth.uid()));
> ```

### 5.9 `calendar_notes` — Takip Takvimi Notları

```sql
create table calendar_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  note_date date not null,
  note_text text not null check (char_length(note_text) <= 500),
  created_at timestamptz not null default now()
);
create index on calendar_notes(user_id, note_date);
```

Bir tarihe birden fazla not eklenebilir (liste olarak render edilir). Sipariş kaydına bağlı DEĞİL — sadece tarih bazlı serbest yapışkan not.

### 5.10 `shipments` — Sevkiyatlar

```sql
create table shipments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  order_id uuid not null references orders(id),
  bl_number text,
  carrier text,
  container_number text,
  etd date,
  eta date,
  freight_cost numeric,
  freight_currency text default 'USD',   -- enum: USD|EUR|GBP|TRY
  port_of_loading text,
  port_of_discharge text,
  notes text,
  created_at timestamptz not null default now()
);
create index on shipments(user_id);
create index on shipments(order_id);
```

### 5.11 `pallet_definitions` — Palet Tanımları

```sql
create table pallet_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  width_cm numeric, length_cm numeric, height_cm numeric,
  stackable boolean not null default true,
  stack_strength int default 1,       -- 1(en dayanıklı/alt)-2(orta)-3(en hafif/üst), stackable=false ise null
  pallet_type text not null default 'EUR1',  -- enum: EUR1|EUR3|Non-Euro|Diğer
  tare_weight numeric,                -- EUR1→25, EUR3→35, diğer→0 (kaydederken hesaplanıp yazılır)
  total_weight numeric,               -- auto = Σ(item.unit_gross_weight*qty) + tare_weight, weight_override=true ise korunur
  weight_override boolean default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
```

### 5.12 `pallet_items` — Palet İçerik Kalemleri

```sql
create table pallet_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  pallet_id uuid not null references pallet_definitions(id) on delete cascade,
  product_id uuid references urunler(id),
  product_name text not null,
  product_code text,
  quantity numeric default 0,
  unit_net_weight numeric,     -- bilgi amaçlı, üründen kopyalanır (readonly)
  unit_gross_weight numeric    -- editable, üründen ön-doldurulur
);
```

Kaydetme davranışı: her düzenlemede o `pallet_id`'ye ait **tüm** `pallet_items` silinip form üzerindeki güncel liste yeniden eklenir (diff değil, tam değiştirme).

Palet tanımı silme: başka bir tablo (örn. gelecekte eklenecek "yükleme planı kaydı" veya siparişler) bu palete referans veriyorsa `23503` hatası yakalanıp "Bu palet silinemez; sipariş veya yükleme planında kullanılıyor olabilir." gösterilir — FK'yı `ON DELETE RESTRICT` bırak.

### 5.13 `credit_notes` — Credit Note Ana Kayıt

```sql
create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  customer_id uuid not null references customers(id),  -- FK adı: fk_credit_notes_customer
  cn_date date not null default current_date,
  process_status text not null default 'İncelemede'   -- enum: İncelemede|Onaylandı|Reddedildi|Mahsup Edildi
);
```

### 5.14 `credit_note_items` — Credit Note Kalemleri (Şikayet Detayları)

```sql
create table credit_note_items (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references credit_notes(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  product_code text,
  complaint_id text,       -- serbest metin (örn "COMP-881") — gerçek FK değil
  decision text,           -- serbest metin ama fiilen "Kabul"/"Red"/"Mahsup" değerleri anlamlı kabul edilir, diğerleri "Bekliyor" sayılır
  target_order text,       -- serbest metin, orders tablosuna GERÇEK FK değil (sadece açıklayıcı)
  description_1 text,      -- Hata/Problem Tanımı
  description_2 text       -- Kök Neden / Aksiyon Notu
);
```

> RLS notu: bu tabloda da `user_id` yok — `credit_notes` üzerinden join'li politika kur (5.8'deki quotation_items ile aynı desen).
>
> Silme: master (`credit_notes`) silinirken uygulama kodu hem "cascade siliniyor" yorumunu hem de `23503` hata yakalamasını birlikte içeriyordu (orijinal kodda tutarsızlık). Migrasyonda net bir karar ver: **`on delete cascade` kullan** (yukarıdaki DDL'de zaten öyle) ve `23503` özel hata mesajını KALDIR — bu daha temiz ve gerçek DB davranışıyla tutarlı.

### 5.15 `price_list` — Fiyat Robotu Liste Fiyatları (salt okunur referans veri)

```sql
create table price_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  group_name text,
  product_name text,
  product_code text,
  list_price_tl numeric,
  list_price_eur numeric,
  list_price_usd numeric
);
```

Bu tabloya sadece admin/manuel veri girişi/import yapılır; Fiyat Robotu sayfası SADECE okur, hiç yazmaz — tüm hesaplama client-side.

### 5.16 `customer_prices` — Müşteri Sabit Fiyatları

```sql
create table customer_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  customer_id uuid not null references customers(id),  -- FK adı: fk_customer_prices_customer
  product_id uuid references products(id),   -- nullable, serbest metin ürünler için
  product_name text not null,
  list_price numeric not null default 0,
  net_price numeric not null default 0,
  discount_rate numeric not null default 0   -- yüzde, 0-100
);
```

> Kaydetme davranışı: **tam değiştirme** — bir müşterinin fiyat kartı kaydedilirken o `customer_id`'ye ait tüm satırlar silinip yeni liste toplu eklenir (id'ler her kayıtta değişir). Bunu birebir koru (diff/upsert YAPMA).

---

## 6. Ortak Cross-Table Kurallar

- Tüm tablolarda `user_id` filtrelemesi RLS ile garanti altına alınmalı; uygulama kodu ayrıca `.eq('user_id', ...)` da eklesin (defense-in-depth, orijinal davranış böyle).
- **Para birimi dönüşümü YOK** — Dashboard, Pazar Analizi, Karlılık Analizi, Ödeme Takibi, Müşteri Skoru gibi tüm toplam/KPI hesaplamaları farklı para birimlerindeki tutarları **doğrudan topluyor** (FX çevrimi yapmıyor), sadece Ödeme Takibi'ndeki ABC sınıflandırmasında kaba bir sabit kur (`EUR×1.08, GBP×1.27`) kullanılıyor. Bunu **birebir koru** (gerçek bir kısıtlama/borç olduğunu kullanıcı biliyor, düzeltme kapsamında değil) — para birimi bazında ayrı ayrı toplamlar göster, tek bir "toplam" satırına asla farklı para birimlerini otomatik çevirip toplama.
- Silme işlemlerinde her yerde Postgres FK-violation kodu (`23503`) yakalanıp kullanıcı dostu "bağlı kayıt var, önce onları silin/temizleyin" mesajı gösteriliyor — bu paternİ genel bir hata-yakalama yardımcı fonksiyonu olarak kur ve her silme aksiyonunda kullan.
- Tarihler DB'de `date` tipinde saklanıyor, UI'da `DD.MM.YYYY` formatında gösteriliyor, input'larda native `<input type="date">` kullanılıyor.
- Para tutarları text input olarak girilip `parseTurkishFloat` ile parse ediliyor (nokta=binlik, virgül=ondalık); gösterimde `toLocaleString('tr-TR', {minimumFractionDigits:2})`.

---

## 7. Sayfa Bazlı Fonksiyonel Spesifikasyon

### 7.1 Siparişler (`/orders`) — En kompleks modül

**Liste görünümü**: Kart/satır listesi (klasik tablo değil) — her sipariş 4 bölümlü tek satır:
1. Firma bloğu: şirket adı, ülke rozeti, sipariş türü rozeti, durum etiketleri (çoklu, baskın etikete göre soldaki renkli bar), not önizlemesi (60 karakter kesilmiş).
2. Tarih bloğu: Sip. No, Tarih, Sevk, Vade (gecikmişse "⚠" uyarısı), İdevit No, İdeal No — 6 sütunlu grid, tek satır.
3. Finansal blok: Toplam, Avans, Kalan Bakiye (sıfırsa soluk), Adet, Ödeme durumu.
4. Aksiyon: "Yönet" butonu.

Soldaki renk barı, `status_tags` içindeki en yüksek öncelikli etikete göre belirlenir. Öncelik sırası (yüksekten düşüğe): `İptal, Gecikme, Teslim Edildi, Ödeme Tamamlandı, Bakiye Bekliyor, Sevk Edildi, Sevke Hazır, Üretimde, Üretime Hazır, Yeni Müşteri, Devam Ediyor`.

**Filtreler**: serbest arama (firma/sip.no/idevit/ideal no), para birimi, durum (tekli), sevk ayı (Ocak-Aralık), sevk tarihine göre sıralama (artan/azalan, tarihsiz olanlar her zaman en sona).

**Modal — 2 sekme**:
- *Genel Bilgiler*: 3 kart bölümü — (1) Temel Bilgiler: müşteri arama/autocomplete dropdown, Sipariş No, İdevit/İdeal No, Sipariş Türü, Sipariş/Sevk/Vade tarihleri; (2) Finansal Bilgiler: para birimi, toplam tutar, avans, canlı kalan bakiye göstergesi, adet, ödeme şekli; (3) Durum Etiketleri: çoklu seçim checkbox grid. Altta açıklama/not textarea.
- *Sipariş Kalemleri*: ürün seç (dropdown) veya serbest metin + kod + adet + birim fiyat + otomatik hesaplanan tutar + not, satır ekle/sil. Altta kalem toplamı; sipariş toplamıyla 0.01'den fazla farkı varsa sarı uyarı banner'ı.

**İş kuralları**:
- **Otomatik "Gecikme" etiketleme**: sayfa her yüklendiğinde, `due_date` dolu + `remaining_balance>0` + `due_date < bugün` olan siparişlere `Gecikme` etiketi otomatik eklenir (yoksa) ve kaydedilir. Asla otomatik kaldırılmaz, idempotent.
- **Mükerrer numara kontrolü** (kaydet öncesi): `order_number` → `(customer_id, order_number)` bazında tekil (farklı müşteride aynı no OK); `idevit_order_no`/`ideal_order_no` → kullanıcı genelinde tekil. `-`/`—`/boş değerler kontrol dışı. Düzenlemede kendi id'si hariç tutulur. Herhangi bir çakışma varsa TÜM çakışmalar tek bir uyarıda listelenip kayıt durdurulur.
- **Canlı kalan bakiye**: toplam/avans alanları her tuş vuruşunda `kalan = toplam - avans` hesaplayıp gösterir; kayıtta bu değer DB'ye yazılır (trigger değil, app hesabı).
- **Silme**: onay diyaloğu; `23503` hatasında özel mesaj.
- **Kalem senkronizasyonu**: kayıt anında bellekteki kalem listesinde olmayan ama DB'de olan `order_items` satırları silinir (tam diff-sync, append-only değil). `product_name` boş satırlar atlanır.

**Excel Import** (mevcut sipariş listesine toplu içe aktarma):
- Sheet adı "Siparisler" (büyük/küçük harf duyarsız) aranır, yoksa ilk sheet kullanılır.
- Beklenen kolonlar: `musteri_adi, siparis_no, idevit_sip_no, ideal_sip_no, siparis_tarihi, para_birimi, toplam_tutar, avans, sevk_tarihi, vade_tarihi, siparis_turu, odeme_sekli, status_tags (virgülle ayrık), toplam_adet, notlar`.
- **İki aşamalı**: önce tam validasyon geçişi (müşteri kartı var mı + Aktif mi, mükerrer no kontrolü DB+dosya içi) — herhangi bir hata varsa TÜM import durur, hiçbir satır yazılmaz. Geçerse ikinci aşamada gerçek upsert (eşleşme anahtarı: `order_number+customer_id+user_id`, varsa update yoksa insert).
- "Mevcut verileri sil" checkbox'ı işaretlenirse önce kullanıcının TÜM siparişleri silinir (ilk toplu yükleme senaryosu), bu modda DB-bazlı mükerrer kontrolü atlanır.
- Tarih formatları: `YYYY-MM-DD`, `DD.MM.YYYY`, Excel seri tarih sayısı (epoch 1899-12-30) hepsi desteklenmeli.
- Log paneli: renkli (yeşil ok/turuncu uyarı/kırmızı hata) satır satır işlem kaydı.

**Excel Export**: stilli çok bölümlü workbook — başlık, para birimi özet tablosu, tam veri tablosu; satırlar baskın duruma göre renklendirilir; gecikmiş vade hücresi kalın+kırmızı.

**PDF'den Kalem İçe Aktarma** (proforma fatura PDF'i okuyup sipariş kalemlerini otomatik doldurma — Sipariş Kalemleri sekmesinde "PDF'den İçe Aktar" butonu):
- `pdfjs-dist` ile PDF metni glyph x/y konumlarına göre satırlara ve (büyük x-boşluklarında) sütunlara ayrıştırılır (basit tek-satır metin birleştirme YETMEZ, proforma faturalarda çok-sütunlu tablo/blok yerleşimi var).
- Regex ile ayrıştırılan alanlar: **PI NO** (`PI\s*NO\s*:?\s*([0-9]{2,4}-[0-9]{1,4})`), **PI DATE** (`DD.MM.YYYY` → ISO), **genel toplam tutar** (teslim şekli etiketi — "DELIVERY TERMS :" değeri okunup, aynı metnin "`<terim>` : `<tutar>` `<para birimi>`" şeklinde tekrar geçtiği satır bulunarak — sabit "EX-WORKS" değil, hangi Incoterm olursa olsun çalışmalı), ve kalem satırları: `ÜRÜN KODU  AÇIKLAMA  ADET pcs.  PALET  NET_FİYAT  TUTAR` deseni.
- Her ayrıştırılan ürün kodu `urunler.stok_kodu` ile eşleştirilir; **eşleşmeyen kod varsa TÜM içe aktarma durdurulur**, eksik kodlar listelenip önce Ürün Kartları'ndan oluşturulması istenir.
- Kalem tablosu zaten doluysa, PDF'deki satırlarla **tamamen değiştirileceği** konusunda onay istenir.
- Sipariş No / Sipariş Tarihi / Toplam Tutar alanları PDF'den doldurulur; alan zaten doluysa ve farklı bir değer varsa üzerine yazmadan önce onay istenir.
- İçe aktarma sonrası her kalem için `adet × net fiyat` ile PDF'deki tutar karşılaştırılır, 0.05'ten fazla fark varsa uyarı (import'u engellemez, sadece bilgilendirir).

### 7.2 Teklifler (`/quotations`)

Siparişler ile neredeyse aynı liste/modal deseni, farkları:
- Tarih grid'i 3 sütun (Teklif No, Tarih, Geçerlilik), tekli durum rozeti (çoklu etiket yok).
- `Süresi Doldu` durumu: `status==='Bekliyor'` ve `valid_until < bugün` olan teklifler ekranda **görsel olarak** "Süresi Doldu" gösterilir (DB'ye otomatik yazılmaz, sadece render-time flag).
- `quotation_number` **kasıtlı olarak tekil değil**.
- **Müşteri durumu otomasyonu**: yeni teklif oluşturulurken müşterinin güncel (taze okunmuş) durumu tam olarak `Pasif` ise → `Potansiyel`'e otomatik geçer (history_notes'a sistem notu eklenir). Sadece yeni kayıtta, düzenlemede değil.
- **Kara Liste** müşteri seçilirse onay diyaloğu ile uyarılır (seçime izin verilir ama uyarıyla).
- **"Siparişe Gönder"** aksiyonu (sadece düzenleme modunda, `status !== 'Sipariş Dönüştü'` iken görünür):
  1. Teklif numarasından sipariş numarası türetilir: aynı müşteride bu numara boşsa direkt kullanılır; doluysa ve format `PREFIX-NN` ise sayısal kısmı otomatik artırılarak boş bir slot bulunur (max 1000 deneme); format uymuyorsa kullanıcıya manuel numara sorulur (tekillik tekrar kontrol edilir).
  2. Yeni sipariş: `order_status/status_tags=['Yeni Müşteri']`, `advance_payment=0`, `remaining_balance=total_amount`, not alanı `"Teklif {no} üzerinden oluşturuldu."` ile başlar, adet = manuel alan doluysa o, değilse kalemlerin toplamı.
  3. Tüm `quotation_items` yeni `order_items`'a 1:1 kopyalanır.
  4. Kaynak teklif ve kalemleri **kalıcı olarak silinir** (Teklifler modülünden tamamen kaybolur — flag değil, gerçek silme).
  5. Müşteri durumu `Potansiyel → Aktif` otomatik geçer (yine taze-okuma guard'ı ile).
- Silme: önce `quotation_items`, sonra `quotations` (manuel cascade sırası).
- Kalem-toplamı/teklif-toplamı uyuşmazlığı uyarısı — Siparişler ile aynı mantık.

### 7.3 Müşteri Kartları (`/customers`)

**Üst banner**: 3 istatistik kartı (Toplam Müşteri, Aktif, Pasif) — filtre aktifse "filtrelenen/toplam" formatı.

**Tablo**: tek düz tablo (akordeon yok), Ülke→Firma Adı sıralı. Kolonlar: Firma Ünvanı, Ülke, Yetkili, E-posta/Telefon, Web Sitesi (tıklanabilir link, `https://` otomatik eklenir), Müşteri Tipi (renkli rozet), Sorumlu, Ödeme/Birim (ödeme koşulu+incoterm+para birimi üst üste), Durum (renkli rozet), İşlem.

**Filtreler**: arama (firma/ülke/yetkili), bölge, ülke (dinamik doldurulur), müşteri tipi, durum, sorumlu (dinamik).

**Modal — 3 sekme**: Genel Bilgiler (firma + 2 kontak kişisi) / Ticari & Risk (zorunlu ticari alanlar + segmentasyon/risk + kısa bilgi notu) / Geçmiş Notlar (tarih+not satırları dinamik ekle/sil, textarea 160px'e kadar otomatik büyür).

**İş kuralları**:
- **Zorunlu alan kontrolü**: Ülke, Firma Adı, Durum, Ödeme Koşulu, Incoterms, Para Birimi — eksikse hepsi tek uyarıda listelenir.
- **Mükerrer firma adı** sadece yeni kayıtta engellenir (case-insensitive, tr-TR locale).
- **Bölge otomatik türetme**: `country` alanından ~50 ülkelik sabit bir haritalama ile (Avrupa/Asya/Orta Doğu/Afrika/Diğer) her kayıtta yeniden hesaplanır — kullanıcı bu alanı DÜZENLEYEMEZ (readonly).
- **Title Case otomatik biçimlendirme**: `country`, `company_name`, `contact_name`, `contact_name_2` alanlarına yazarken canlı olarak (imleç konumu korunarak) uygulanır.
- **Excel/CSV import**: `company_name` bazlı upsert (case-insensitive eşleşme); var olan kayıt → sadece dolu gelen alanlar patch'lenir (`updated_at` güncellenir); yeni kayıt → tüm alanlar + hesaplanan bölge + boşsa varsayılanlar (`client_group/payment_term/acquisition_source/status`). Esnek kolon başlığı eşleştirme (birden fazla Türkçe alias desteklenmeli).
- **CSV export**: 26 kolonlu, noktalı virgülle ayrık, BOM'lu, hesaplanan bölge dahil.
- Silme: `23503` → "bağlı sipariş/fiyat/credit note var" mesajı.

### 7.4 Ürün Kartları (`/products`)

**KPI şeridi**: Toplam Ürün, Ürün Grubu (distinct sayım), Seri Sayısı (distinct sayım), Mükerrer Kod (sayım, renk warn/ok).

**Tablo**: sayfalanmış (50/sayfa, çok sayfa varsa `...` ile kısaltılmış sayfa numaraları). Arama (debounce 180ms, kod+ad1+ad2 üzerinde çok-kelimeli AND eşleşme), grup ve seri dropdown filtreleri. Satır: küçük resim (yoksa placeholder ikon), sıra no, kod+mükerrer rozeti, adlar, birim, paketleme, grup, renk, kalite, sil butonu.

**Modal — 3 sekme**: Ürün Bilgileri (kimlik+sınıflandırma+fonksiyon+renk/kalite/net ağırlık+görsel yükleme) / Palet Tanımları (palet ağırlık/adet/ölçü/palet cinsi — net ağırlık alanı bu sekmedeki ile "Ürün Bilgileri" sekmesindeki aynı alanla canlı senkron) / Geçmiş (sadece düzenleme modunda, `urun_gecmisi` tablosundan 200 kayıt, en yeni üstte).

**Görsel yükleme iş kuralı** (önemli — birebir uygula):
- Sadece image mimetype, max 8MB.
- **Client-side otomatik kırpma/sıkıştırma**: ürünün kendi arka plan rengini kenar piksellerinden örnekleyerek tespit et, o renge göre bounding-box bul, %12 padding ile kırp, max 640px'e ölçekle, tespit edilen arka plan rengiyle dolgulu kare canvas'a yerleştir, JPEG q=0.85 olarak dışa aktar.
- Storage path: `{userId}/{productId}-{timestamp}.jpg`, bucket `urun-resimleri`; yeni görsel başarıyla yüklendikten sonra eski görsel storage'dan silinir.
- Thumbnail'ler signed URL (1 saat geçerli, path bazlı bellek içi cache) ile çözülür — hem tekli hem toplu (batch) signed URL üretimi kullanılmalı (liste sayfasında performans için batch).
- Görsel kaldırma: `resim_path=null` + storage objesi silinir.

**Excel/CSV Import — 2 mod**:
1. *Sıfırla*: kullanıcının TÜM ürünlerini siler, dosyayı 500'lük gruplar halinde toplu ekler (yıkıcı aksiyon onayı gerekir).
2. *Akıllı upsert*: `stok_kodu → id` haritası kurulur; var olan kod → update (user_id patch'e dahil edilmez); yeni kod → tek tek insert (aynı import dosyası içindeki tekrar eden yeni kodları da yakalayabilmek için, ilk görülen anında insert edilip id'si haritaya eklenir, sonraki tekrarlar update'e döner) — mevcut kodlar batch(500), yeni kodlar sıralı insert.
- Header satırı otomatik tespiti: ilk 5 satır taranıp "Stok Kodu" literalini içeren satır header kabul edilir (üstte başlık satırı olan dosyaları destekler).
- `-` değerleri `null`'a normalize edilir.

**Excel Export**: 21 kolon, tüm alanlar, otomatik sütun genişliği.

Silme: satır silinir, storage görseli best-effort (bloklamayan) silinir.

### 7.5 Palet Tanımları (`/pallet-definitions`)

**Filtre/istatistik**: arama (ad/tip substring), Cins ve İstif Durumu dropdown filtreleri; 3 tıklanabilir KPI kartı aynı zamanda filtre kısayolu (Toplam Palet → filtre sıfırla; İstiflenebilir/İstiflenemez → istif filtresini toggle'lar; EUR1/EUR3 → cins filtresini döngüler).

**Tablo**: Palet Adı, Cins, Ölçü (WxLxH), İstif (rozet), Katman (stack_strength veya "—"), Ürün Çeşidi (distinct pallet_items sayısı), Ağırlık, Notlar (sticky-note ikonu → viewport'a göre otomatik konumlanan, dışarı tıklayınca kapanan popover), İşlem.

**Modal**: ad, 2×4 grid (W/L/H/palet-tipi), istiflenebilir checkbox + koşullu katman select (istiflenemezse soluk/disabled), dinamik ürün-kalem satırları (autocomplete arama → seçilince readonly "chip" olur, × ile temizlenip yeniden seçilebilir, adet, net ağırlık readonly, brüt ağırlık editable, satır toplamı), ağırlık özet paneli (Ürün Ağırlığı / Palet Darası / Toplam Ağırlık + manuel override + yeniden hesapla butonu + override durumunda not).

**İş kuralları**:
- Dara ağırlığı: `EUR1→25kg, EUR3→35kg, Non-Euro/Diğer→0kg`.
- `total_weight = Σ(unit_gross_weight×quantity) + tare` — override edilene kadar her değişiklikte otomatik güncellenir; kullanıcı toplam alanına doğrudan yazarsa override moduna geçer, "yeniden hesapla" butonu override'ı kapatıp yeniden hesaplar.
- Ürün seçildiğinde: net/brüt ağırlık otomatik doldurulur (brüt editable); palet W/L/H **sadece boşsa** üründen otomatik doldurulur (asla kullanıcı girdisinin üzerine yazmaz); palet tipi de ürünün `palet_cinsi`'nden otomatik gelir ama SADECE kullanıcı palet-tipi dropdown'ına daha önce hiç dokunmadıysa (dropdown'ın her zaman bir varsayılan değeri olduğu için "boşluk" testi yetmez, ayrı bir "dokunuldu mu" flag'i gerekir).
- Autocomplete: kod/ad1/ad2 üzerinde çok-kelimeli AND substring eşleşme, max 30 sonuç, 120ms debounce.
- Kaydetme: düzenlemede önce tüm `pallet_items` silinir, form üzerindeki güncel liste yeniden eklenir (tam değiştirme).
- Aynı isimde palet varsa unique-violation (`23505`) → "Bu isimde bir palet zaten var."
- Silme: `23503` → "sipariş veya yükleme planında kullanılıyor olabilir."

### 7.6 Yükleme Planlayıcı (`/loading-planner`) — 3D Tır/Konteyner Paketleme

Bu sayfa **hiçbir veri yazmaz**, sadece `pallet_definitions`'ı okur ve tamamen client-side bir 3D bin-packing hesaplaması yapar; sonuç sadece bellekte tutulur, kaydedilmez.

**Araç kataloğu** (sabit, iç ölçüler cm, max kg):

| id | Ad | Uzunluk | Genişlik | Yükseklik | Max kg |
|---|---|---|---|---|---|
| std | Standart Tenteli Tır | 1360 | 245 | 270 | 24000 |
| mega | Mega Tenteli Tır | 1360 | 245 | 300 | 24000 |
| 40hq | 40' HQ Konteyner | 1203 | 235 | 269 | 26500 |
| 20dc | 20' DC Konteyner | 590 | 235 | 239 | 21700 |
| kamyon | 10 Teker Kamyon | 750 | 245 | 240 | 12000 |
| custom | Özel (elle gir) | kullanıcı girer | | | |

Varsayılan operasyonel boşluk (padding): sol/sağ/ön/arka 2cm, kullanıcı düzenleyebilir; her paletin ayak izine eklenir.

**İki hesaplama modu** (ayrı butonlar): "Kusursuz Denge" (ağırlık merkezini dengeleyip boşluğu minimize eder) ve "En Az Boşluk" (sadece hacim/taban doluluğunu maksimize eder, ağırlık/denge önemsiz).

**Algoritma — birebir uygula**:
1. **Kolon oluşturma**: paletler önce `stack_strength` artan (düşük sayı=güçlü=alta), sonra ağırlık azalan sırayla dizilir. Taban kolon kapasitesi tahmini (ortalama ayak izinden araç taban alanına göre) ile max yığın derinliği hesaplanır. Her kolon bir taban paletle başlar; istiflenebilirse üstüne uygun aday paletler greedy eklenir — aday: istiflenebilir olmalı, güç seviyesi mevcut üstteki katmandan büyük/eşit olmalı, ağırlığı üstteki katmandan fazla olmamalı, taban ayak izine (0°/90° döndürmeyle) sığmalı, araç yüksekliğini aşmamalı; skor = `alan - |güç_farkı|×1000` (güç eşleşmesi önce, sonra büyük alan).
2. **2D taban yerleşimi — Genetik Algoritma** (ana motor): kromozom = kolon sırası + her kolon için 0°/90° döndürme biti. Decoder: bottom-left/skyline yerleşim (x sonra y artan sırayla aday nokta tarama), önden-arkaya ağırlık dağılımı önceliği. Fitness: `mode:volume` → yerleştirilen×1e7 − kaybedilen×1e7 + hacim%×2e5 + taban%×1e5; `mode:balance` → aynı ama ağırlık-merkezi cezası da eklenir (`|ağırlık merkezi % − 0.5|×100` çıkarılır). Popülasyon `min(120, 40+kolon×4)`, jenerasyon 50-120 (kolon sayısına göre), elitizm %10, turnuva boyutu 4, mutasyon oranı %25, `max(15, jenerasyon×0.35)` durağanlıktan sonra erken durdurma. 6 sezgisel tohum (alan/uzun kenar/uzunluk/genişlik/ağırlık/yükseklik azalan sıralı + "akıllı döndürme" varyantı) + rastgele popülasyon. Order Crossover (OX) + rastgele swap mutasyon. Seeded PRNG (mulberry32) ile tekrarlanabilirlik.
3. **Son işlem**: aynı boyuttaki kolon gruplarını ağırlığa göre yeniden sıralayıp ağır olanları öne (araç ön aksına yakın) alma (rebalance, sadece balance modunda); kullanılan Y-aralığını araç genişliğine ortala.

**Çıktı metrikleri**: yerleştirilen/yerleştirilemeyen palet listeleri, toplam kg, hacim doluluk %, taban doluluk %, kolon sayısı, kazanan strateji açıklaması, ağırlık merkezi konumu/%.

**Görselleştirme — Three.js zorunlu**: yarı saydam tel kafes araç gövdesi + taban grid + arka "kapı" düzlemi vurgusu; her yerleştirilen palet renkli kutu olarak konumlanır (renk gradyanı: hafif=açık zeytin `#7E9152` → ağır=koyu kiremit `#7A2E2E`); mouse hover'da raycasting ile tooltip (palet adı/tipi/ölçü/ağırlık/döndürme notu); "Kamerayı sıfırla" butonu, OrbitControls, ResizeObserver ile responsive canvas.

**UI**: sol panel (araç seçimi, padding, palet listesi+adet girişleri, 2 hesapla butonu — hesaplama sırasında ikisi de disable + dönen DNA ikonu), sağ panel (5 istatistik kutusu + ilerleme çubukları, ağırlık limitini aşarsa kırmızı, denge % "Dengeli"/"Kontrol et" etiketi), yerleştirilemeyen palet uyarı banner'ı, renk lejantı, hesaplama öncesi boş durum mesajı.

### 7.7 Fiyat Robotu (`/prices`)

Salt okunur `price_list` tablosu üzerinde, tamamen client-side canlı hesaplama aracı.

**Canlı kur**: `https://open.er-api.com/v6/latest/TRY` — `eurRate = 1/rates.EUR`, `usdRate = 1/rates.USD` (4 ondalık), yanıp sönen yeşil "Canlı Kur" noktası, hata durumunda "—".

**TL zincir iskonto** (4 ardışık yüzde, varsayılan 50/5/5/5):
```
tlNet = listeTL × (1-d1/100) × (1-d2/100) × (1-d3/100) × (1-d4/100)
```

**Döviz net** (tek iskonto, varsayılan 75%): `dovizNet = listeDoviz × (1-iskonto/100)`

**Fark formülü** (TL fiyatın döviz karşılığı ile ayrı döviz liste fiyatı karşılaştırması):
```
tlInDoviz = tlNet / kur
eğer tlInDoviz < dovizNet: fark = (dovizNet/tlInDoviz) - 1     // pozitif = TL daha ucuz
değilse: fark = 1 - (tlInDoviz/dovizNet)                        // sıfır/negatif
```
`|fark| ≤ 0.001` ise tam "0.0%" göster; ok ikonlu ±% olarak render et.

**İki sekme** (EUR/USD karşılaştırma) — aktif kur, kolon başlıkları ve iskonto paneli etiketi tabına göre değişir.

Tablo: `group_name`'e göre gruplanmış (görsel grup başlığı satırları), arama (ad/kod) + grup dropdown filtresi, her iskonto input değişiminde canlı yeniden hesaplama.

CSV export: **filtrelenmemiş tam veri seti**, `;` ayraçlı, BOM'lu, dosya adı `FiyatRobotu_{TAB}_{tarih}.csv`.

### 7.8 Müşteri Sabit Fiyatlar (`/client-prices`)

Akordeon kart listesi, müşteri başına bir kart (ürün sayısı rozeti, genişlet/daralt).

**Yeni kart modalı**: müşteri seç + mini "ürün ekle" formu (canlı 3-yönlü hesap makinesi: Liste veya İskonto değişince → `Net=Liste×(1-İskonto/100)`; Net değişince → `İskonto%=(Liste-Net)/Liste×100`) + datalist tabanlı ürün autocomplete + oturum içi eklenen ürünlerin tablosu (satır düzenle/sil).

Ürün eşleştirme: yazılan ad/kod case-insensitive `products` tablosuyla eşleştirilir; eşleşme yoksa `product_id=null`, serbest metin olarak saklanır.

Kaydetme = **tam değiştirme** (müşterinin tüm `customer_prices` satırları silinip yeniden eklenir).

Arama: firma adı VEYA o kart içindeki herhangi bir ürün adı. CSV export: her müşteri×ürün satırı ayrı satır (`Musteri;Ulke;Urun Adi;Liste Fiyati;Iskonto%;Net Fiyat`).

### 7.9 Credit Notes (`/credit-notes`)

Master-detail form: müşteri, tarih, süreç durumu (İncelemede/Onaylandı/Reddedildi/Mahsup Edildi) + dinamik ekle/silinebilir ürün-şikayet kalem satırları (her satır: ürün dropdown → otomatik ad/kod doldurma + hâlâ serbest metin editable, complaint ID, karar, hedef sipariş [serbest metin, gerçek FK değil], 2 açıklama alanı). En az 1 kalem satırı kalmalı (son satır silinemez).

Kaydetme: düzenlemede master update + tüm kalemler silinip yeniden eklenir; yeni kayıtta master insert (id al) + kalemler insert.

Filtre: firma adı arama + süreç durumu dropdown. Liste tablosunda "Şikayetli Kalemler" kolonu bağlı ürün adlarını virgülle birleştirir.

CSV export: kalem bazında satır (`Tarih;Musteri;Surec Durumu;Urun Adi;Urun Kodu;Complaint ID;Karar;Hedef Siparis;Hata Tanimi`).

### 7.10 Şikayet Panosu (`/complaints`) — Salt Okunur Analitik

Bu sayfa `credit_notes`+`credit_note_items` üzerinde **kayıt oluşturma/düzenleme arayüzü YOK** — sadece raporlama.

**Filtreler**: tarih aralığı, müşteri, ürün kodu, karar durumu (Kabul/Red/Bekliyor/Mahsup) — Kabul/Red/Mahsup dışındaki her `decision` değeri "Bekliyor" kovasına düşer.

**4 KPI**: Toplam Şikayet (kalem sayısı), Kabul Edilen (+oran), Reddedilen (+oran), Bekleyen CN'ler (`process_status='İncelemede'` olan credit note sayısı — kalem değil, master bazında).

**Ürün Bazında Şikayet tablosu**: `product_code`'a göre gruplanmış şikayet sayısı + kabul oranı (yüksek kabul oranı = kötü sinyal, kırmızı `≥70%` / turuncu `≥40%` / yeşil `<40%` renk kodlu bar) + en son şikayet tarihi; satıra tıklayınca o ürünün tüm şikayet detaylarını listeleyen modal açılır.

**Müşteri Bazında Şikayet tablosu**: müşteri başına toplam/kabul/red sayıları + ilk/son şikayet tarihleri.

**Karar Dağılımı doughnut grafiği** (Kabul/Red/Bekliyor/Mahsup, özel HTML lejant) + **Aylık Şikayet Trendi çizgi grafiği** (son 12 ay, dolgulu alan; son 3 ay vs önceki 3 ay karşılaştırmasıyla "Artıyor"(kırmızı)/"Azalıyor"(yeşil)/"Sabit" trend rozeti).

### 7.11 Ödeme Takibi (`/payments`) — Salt Okunur

**Durum sınıflandırma** (her sipariş için, bugüne göre):
```
remaining_balance <= 0                          → 'paid'
due_date yok                                     → 'month'
due_date < bugün                                 → 'overdue'
0 ≤ (due_date-bugün) ≤ 7 gün                     → 'week'
7 < (due_date-bugün) ≤ 30 gün                    → 'month'
else                                             → 'future'
```

**4 KPI** (her biri para birimi bazında ayrı satır): Toplam Açık Bakiye (tüm `remaining_balance>0`), Vadesi Geçmiş (status=overdue), Bu Hafta Vadeli (status=week), Bu Ay Tahsil Edilen (`payment_status==='Ödendi'` tam eşleşme + `order_date` bu ay içinde → `total_amount` toplamı).

**Kritik Uyarı listesi**: overdue siparişler, vade tarihine göre artan sıra, tıklanınca detay modalı.

**Açık Bakiye tablosu**: 4 filtre sekmesi (`all`=paid+future hariç hepsi, `overdue`, `week`, `month`) + arama; sıralama önceliği `overdue<week<month<future<paid`, sonra vade tarihi artan; sol kenar renk kodu; filtrelenmiş toplamın para birimi bazlı özeti.

**ABC Müşteri Sınıflandırması** (sadece `remaining_balance>0` olan siparişler üzerinden):
```
totalUSD = bakiye[USD] + bakiye[EUR]×1.08 + bakiye[GBP]×1.27
A: totalUSD > 10.000   |   B: 1.000 ≤ totalUSD ≤ 10.000   |   C: totalUSD < 1.000
```

**Sipariş detay modalı**: durum rozeti, tarihler, para birimi, not, finansal özet + ilerleme çubuğu (`avans/toplam×100`), üretim/ödeme durumu, adet, müşterinin `client_group`.

### 7.12 Müşteri Skoru (`/customer-score`) — A/B/C Segmentasyon

En detaylı skorlama motoru — 4 alt tabloyu (`customers`, `orders`, `credit_notes`, `customer_prices`) tek seferde toplayıp birleştirir, hiçbir yazma yapmaz.

**Veri toplama** (müşteri bazında): `totalAmount` = tüm siparişlerin toplamı (para birimi çevrimi yok); `overdueCount` = `due_date < bugün` VE (`payment_status` boş veya `≠'ödendi'` case-insensitive) olan sipariş sayısı; `cnCount` = credit note satır sayısı; `avgDiscount` = `customer_prices.discount_rate` ortalaması.

**4 bileşenli 100 puanlık skor**:
1. **Hacim Puanı** (max 30, sürekli): `round((totalAmount/maxVolume)×30)` — `maxVolume` = tüm müşteriler arası en yüksek hacim.
2. **Ödeme Puanı** (max 30, kademeli): `0 gecikme→30, 1→20, 2→10, 3+→0`.
3. **Şikayet Puanı** (max 20, kademeli): `0→20, 1→15, 2→10, 3→5, 4+→0`.
4. **İskonto Puanı** (max 20, kademeli): `<%10→20, <%20→15, <%30→10, ≥%30→5`.

```
toplam = hacim + odeme + sikayet + iskonto
A (Stratejik Müşteri): toplam ≥ 75
B (Geliştirilecek): 50 ≤ toplam < 75
C (Riskli/Az Karlı): toplam < 50
```

**UI**: sınıf filtre butonları (Tümü/A/B/C) + ülke dropdown (AND birleşimi); 3 KPI (A/B/C sayıları); skor barlı+rozetli tablo (skora göre azalan sıralı); doughnut grafik (özel lejant); statik "Skor Metodolojisi" bilgi kartı (4 ağırlığı açıklayan); satır tıklayınca 4 bileşenli detay modalı (her biri progress bar + bağlamsal açıklama); CSV export.

### 7.13 Ürün Analizi (`/product-analysis`)

> **NOT**: Orijinal koddaki `product-analysis.js` yanlışlıkla `pallet-definitions.js` içeriğiyle ezilmiş durumdaydı (gerçek bir prod hatası) — aşağıdaki spesifikasyon, git geçmişinden kurtarılan **orijinal, doğru** mantıktır; Lovable'da bunu uygula (bozuk versiyonu değil).

Veri kaynağı: son 12 ay içindeki `order_items` (siparişin `order_date`'i son 12 ay içinde olanlar), `urunler` ile join edilerek ürün grubu bilgisi alınır (orijinaldeki eski `products(product_group)` join'i yerine, güncel şemada **`urunler.urun_grubu` üzerinden grupla** — bkz Bölüm 9).

**4 KPI**: Toplam Kalem (satır sayısı), Ürün Çeşidi (distinct ad sayısı), Toplam Ciro (Σ tutar, `amount` yoksa `adet×fiyat` fallback), Müşteri Sayısı (distinct müşteri).

**Grafik 1 — En Çok Satan 10 Ürün**: yatay bar, ürün adına göre gruplanmış toplam tutar, azalan sıralı ilk 10, etiket 28 karakterde kesilir.

**Grafik 2 — Grup Bazlı Ciro Dağılımı**: doughnut (`%68` cutout), `urun_grubu`'na göre gruplanmış tutar (boşsa "Diğer"), özel HTML lejant (yüzde dahil).

**Müşteri × Ürün Matrisi**: satırlar = işlem sayısına göre ilk 20 ürün, sütunlar = ilk karşılaşılan 15 müşteri; hücre = o müşteri o ürünü aldıysa dolu yeşil nokta, almadıysa boş nokta. Sütun başlıkları dikey döndürülmüş metin.

### 7.14 Pazar Analizi (`/market-analysis`)

Veri kaynağı: `customers` + `orders` + `credit_notes`, `customer_id` üzerinden client-side birleştirilir (ülke yoksa "Belirtilmemiş").

**Ülke bazlı metrikler**: müşteri sayısı, sipariş sayısı, toplam ciro (FX çevrimi yok), toplam şikayet (`credit_notes` sayısı proxy), şikayet oranı (`şikayet/sipariş×100`), **YoY büyüme** (bu yıl 1 Ocak–bugün vs geçen yıl aynı aralık; önceki yıl 0 ve bu yıl >0 ise "Yeni Pazar" = %100; ikisi de 0 ise "—"), **bu yıl yeni** flag'i (o ülkedeki herhangi bir müşterinin ilk kayıt tarihi bu yıl mı).

**4 KPI**: İhracat Pazarı Sayısı, En Yüksek Ciro (ülke+tutar), En Yüksek Şikayet Oranı (ülke+oran, sipariş VE şikayeti olan ülkeler arasından), Bu Yıl Yeni (ülke sayısı).

**Ülke Performans Tablosu**: bayrak+ülke, müşteri/sipariş/ciro/şikayet sayıları, şikayet oranı barı (en yükseğe göre orantılı), YoY büyüme (yeşil▲/kırmızı▼/gri 0%/—). Satır tıklanınca o ülkenin müşteri listesi modalı açılır (firma, statü rozeti, ilk kayıt tarihi).

**Grafik — İlk 15 Ülke Toplam Ciro**: yatay bar, opaklık kademeli (1.=en koyu, 2-3.=orta, gerisi=soluk); eksen `$XXK` formatlı.

**Trend Grafiği**: ülke dropdown seçimiyle tetiklenir — son 3 yıl, her yıl ayrı çizgi (12 ay x-ekseni), eski yıl soluk/ince, güncel yıl belirgin/dolgulu; y-ekseni `$XXK`.

**Ülke bayrak haritası**: ~90 ülke adı → emoji bayrak sabit sözlüğü (Türkçe varyantlar dahil, örn. "Türkiye"), eşleşmeyen 🌐.

### 7.15 Sevkiyatlar (`/shipments`)

`orders`+`customers` ile (PostgREST embed DEĞİL, olası çoklu FK belirsizliğinden kaçınmak için) manuel client-side join.

**Durum türetme** (saklanmaz): `eta > bugün` → Aktif (yeşil); `eta ≤ bugün` → Tamamlandı (gri); `eta` yok → Tarih Yok (gri). Transit gün sayısı = `eta-etd` (ikisi de varsa).

**4 KPI**: Aktif Sevkiyat, Bu Ay Navlun (bu ayki `etd`'lerin `freight_cost` toplamı, USD varsayımıyla — çevrim yok), Ortalama Transit Süresi, Toplam Sevkiyat.

**Filtreler**: taşıyıcı, liman (yükleme veya boşaltma limanı eşleşirse), ETD tarih aralığı — dropdown seçenekleri veri setinden dinamik türetilir.

**Modal**: sipariş bağlantısı (dropdown, `"{sip.no} — {firma} ({ülke})"` etiketli), BL no/taşıyıcı/konteyner, ETD/ETA, navlun tutar+para birimi, yükleme/boşaltma limanı, not.

### 7.16 Karlılık Analizi (`/profitability`)

**Skor formülü** (müşteri×sipariş hacmi ağırlıklı, iskontodan bağımsız ayrı bir skor — Müşteri Skoru modülündekinden farklı):
```
weight = musterininSiparisSayisi / enCokSiparisiOlanMusterininSayisi
skor = round((100 - ortalamaIskonto%) × (0.5 + 0.5×weight))
```
Renk eşiği: `>80` yeşil, `60-80` sarı, `<60` kırmızı.

**4 KPI**: Ortalama İskonto (tüm `customer_prices` satırları düz ortalaması — müşteri bazında önce ortalama alınmaz), En Yüksek İskonto (müşteri bazlı ortalamalar arasından en yükseği), Toplam Net Satış (tüm siparişler, FX çevrimi yok), Aktif Müşteri (siparişi olan distinct müşteri sayısı).

**Ürün Fiyat Tutarsızlığı analizi**: aynı `product_name` için en az 2 farklı müşteri fiyatı varsa `spread% = (max-min)/max×100`; `>15%` "tutarsız" flag'i; min-max aralık barı, global max'a göre ölçekli.

**Grafik**: müşteri bazlı ortalama iskonto bar grafiği (kırmızı `>20%`, turuncu `>10%`, yeşil altı; 0 iskontolular gizli).

**Detay modalı**: müşterinin ort. iskontosu, toplam sipariş sayısı, skor, tüm ürün fiyat tablosu (alfabetik).

### 7.17 Takip Takvimi (`/order-timeline`)

`orders`+`customers` salt okunur (yazma yok), `calendar_notes` tam CRUD.

**Kapalı/terminal etiketler**: `Ödeme Tamamlandı, Teslim Edildi, İptal` — bunlardan biri varsa sipariş "kapalı" sayılır.

**Gecikme tanımı**: `due_date` var + kapalı değil + `due_date<bugün` → kırmızı uyarı banner'ı ("N sipariş vadesini geçti!") + "Geciken" filtre kısayolu.

**Filtreler**: Tümü / Aktif (kapalı olmayan) / Geciken / Bu Ay (order/shipment/due tarihlerinden herhangi biri bu ay içinde).

**Takvim görünümü**: Pazartesi başlangıçlı aylık grid, her gün hücresinde max 3 rozet (sevk 🚢 / vade 📅 olayları) + "+N daha" taşma göstergesi, manuel notlar (📌) + hover'da "not ekle" butonu. Rozet rengi/ikon, `TAG_PRIORITY` baskın-etiket mantığıyla aynı (bu sayfada bağımsız tekrar implemente edilir).

**Liste görünümü**: satır başına hesaplanmış vade rozeti — Kapandı (kapalıysa) / Gecikiyor (vadesi geçmiş) / Yaklaşıyor (7 gün içinde) / Zamanında; tam durum-etiket rozet zinciri (baskın etiket önde).

**Not ekleme/düzenleme**: tıklanan hücreye/rozete göre konumlanan (viewport taşmasını önleyen, gerekirse yukarı dönen) yüzen popover; Ctrl/Cmd+Enter kaydet, Escape/dışarı tıklama kapat; max 500 karakter.

### 7.18 Yardım & Kılavuz (`/help`)

Tamamen statik, Supabase bağlantısı yok. Sol sabit TOC (16 modül, ikon+başlık+kısa açıklama, tıklanınca sağdaki detay paneli güncellenir + aktif TOC rengi o modülün kendi rengiyle ~%7 opaklıkta vurgulanır), sağ detay paneli ("Temel Özellikler"/"Nasıl Kullanılır?"/"İpucu" bölümleriyle zengin metin) + o modüle giden gerçek link butonu. Varsayılan: Dashboard sayfası seçili açılır.

Bu sayfayı statik içerik olarak, yukarıdaki her modülün gerçek özelliklerini özetleyen bir "yardım metni" ile doldur (16 modül: Dashboard, Siparişler, Teklifler, Müşteriler, Fiyat Robotu, Credit Notes, Ürün Kartları, Takip Takvimi, Karlılık Analizi, Şikayet Panosu, Ödeme Takibi, Sevkiyat, Müşteri Skoru, Ürün Analizi, Pazar Analizi, + Yükleme Planlayıcı).

### 7.19 Dashboard (`/`)

Yıl seçici (mevcut yıl + önceki 4 yıl) tüm widget'ları yeniden yükletir. Bazı widget'lar seçili yıla göre filtrelenir (`yearOrders`), bazıları tüm-zamanlar (`allOrders`) — aşağıda her biri işaretli.

**FX Banner** (üstte, tüm sayfalarda ortak bileşen olabilir): canlı USD/TRY ve EUR/TRY kuru (`@fawazahmed0/currency-api` CDN'i), Türk iş günü + TCMB işlem saatleri (09:30-17:30) mantığıyla "Canlı" (yeşil nokta, yanıp söner) veya "Son Kur" (gri nokta, tarih) gösterir; hafta sonu/7 sabit Türkiye resmi tatili + mesai saati dışında en son iş gününe geri gider. Bu bir Supabase tablosu DEĞİL, doğrudan dış API çağrısı — birebir koru.

**4 ana KPI**:
1. **Toplam Ciro** — SADECE seçili yıl (`yearOrders`), para birimi bazında ayrı satır, `total_amount` toplamı.
2. **Tahsil Edilen/Avans** — sadece seçili yıl, `advance_payment` toplamı, para birimi bazlı.
3. **Vadeli Bakiye** — TÜM ZAMANLAR (`allOrders`), `remaining_balance>0` VE (`due_date` yok VEYA `due_date≥bugün`), para birimi bazlı.
4. **Gecikmiş Borç** — TÜM ZAMANLAR, `remaining_balance>0` VE `due_date<bugün`, para birimi bazlı.

**Operasyonel mini-kartlar (4 adet)**: Aktif Sipariş (`yearOrders.length`) · Bekleyen Teklif (tüm zamanlar, `status='Bekliyor'`) · Açık Şikayet (tüm zamanlar, `process_status='İncelemede'`) · Geciken Sevkiyat (tüm zamanlar, `actual_date` yok + `estimated_date<bugün`).

**Son Siparişler**: seçili yılın ilk 5 siparişi (tarihe göre zaten azalan sıralı). **Son Teklifler**: tüm-zamanların en son oluşturulan 5 teklifi (yıl filtresiz).

**Ödeme Durumu widget'ı** (tüm zamanlar): kapanmış (`bakiye≤0 ve toplam>0`) vs açık (`bakiye>0`) sayaç + açık bakiyenin ne kadarı vadesi geçmiş (`%`, kırmızı ilerleme çubuğu).

**Top 3 Müşteri** (tüm zamanlar, `customer_id` bazında `total_amount` toplamı, FX çevrimi yok): sıra+firma+ülke+orantılı bar (renkler sabit: 1.=koyu yeşil, 2.=bronz, 3.=mavi-gri).

**4 ikincil modül özeti**: Karlılık (tüm zamanlar ort. iskonto), Pazar (seçili yıldaki distinct sipariş-veren ülke sayısı), Şikayetler (tüm zamanlar açık/toplam), Müşteri Arşivi (tüm zamanlar toplam/aktif/pasif).

**Grafik 1 — Aylık Sipariş Hacmi**: çizgi, dolgulu alan, seçili yılın 12 ayı, **sipariş SAYISI** (tutar değil).

**Grafik 2 — Döviz Dağılımı**: doughnut, seçili yılın para birimi bazında sipariş sayısı dağılımı.

---

## 8. Bilinen Sınırlamalar / Migrasyonda Bilinçli Olarak Korunacak Davranışlar

Bunlar "bug" değil — orijinal uygulamanın kabul edilmiş sınırlamaları, kullanıcı bilerek bu şekilde bırakıyor, **düzeltme, birebir kopyala**:

1. **Para birimi çevrimi hiçbir yerde yok** (Dashboard, Pazar/Ürün/Karlılık Analizi, Ödeme Takibi'nin genel KPI'ları) — farklı kur cinslerindeki tutarlar ayrı ayrı gösterilir, asla otomatik toplanmaz/çevrilmez. Tek istisna: Ödeme Takibi'ndeki ABC sınıflandırması, sabit kabaca kur (`EUR×1.08, GBP×1.27`) kullanıyor — bunu da aynen koru.
2. **İki ayrı ürün tablosu** (`urunler` tam katalog vs `products` sade tablo) — birleştirilmeden ikisi de aynen kurulacak.
3. **`urunler.stok_kodu` üzerinde DB unique constraint yok**, sadece uygulama içi uyarı/rozet var.
4. **`customer_prices` ve `credit_note_items`'ta kaydetme = sil+yeniden ekle** (diff/upsert değil) — id'ler her düzenlemede değişir, bunu koru.

## 9. Migrasyon Sırasında Düzeltilecek Bilinen Hatalar

1. **Ürün Analizi sayfası kaynak kodda kırık** — `product-analysis.js` yanlışlıkla `pallet-definitions.js` içeriğiyle değiştirilmiş, sayfa prod'da çalışmıyor. Yukarıdaki Bölüm 7.13'teki (git geçmişinden kurtarılmış) doğru mantığı uygula.
2. **Ürün Analizi'nin eski `products(product_group)` join'i güncel şemayla uyuşmuyor** — `order_items.product_id` artık `urunler.id`'ye işaret ediyor, eski sade `products` tablosuna değil. Grup bazlı ciro grafiğini `urunler.urun_grubu` üzerinden kur.
3. **Credit Notes silme davranışı tutarsız** — kod hem "cascade siliniyor" yorumu hem `23503` (RESTRICT) hata yakalaması içeriyordu. Net karar: `credit_note_items.credit_note_id` → `ON DELETE CASCADE`, özel hata mesajını kaldır (Bölüm 5.14'te DDL zaten böyle).

## 10. Kapsam Dışı / Statik Sayfalar

- **`/presentation`** (varsa dahil et): Supabase'e hiç bağlanmayan, tamamen sahte/mock verilerle çalışan interaktif bir tanıtım turu (5 adım: Dashboard/Yükleme Planlayıcı/Takip Takvimi/Fiyat-Karlılık/Müşteri Skoru simülasyonları + otomatik anlatımlı oynatma). Gerçek veriye ihtiyacı yok, tamamen statik/mock React bileşenleri olarak kurulabilir — **düşük öncelik**, isteğe bağlı.
- **`/help`**: yukarıda 7.18'de tanımlandığı gibi statik içerik sayfası.

---

## 11. Son Kontrol Listesi (Lovable'a build sırasında hatırlat)

- [ ] Her tabloda RLS açık, `user_id`'siz alt tablolarda (`quotation_items`, `credit_note_items`) üst tablo üzerinden politika.
- [ ] Native alert/confirm/prompt YOK, özel themed dialog sistemi her yerde.
- [ ] Tüm para/sayı gösterimleri `tr-TR` locale.
- [ ] Açık/Koyu tema `localStorage.ep-theme`, tüm sayfalarda tutarlı.
- [ ] Sidebar akordeon davranışı + aktif sayfa otomatik grup açma.
- [ ] Three.js 3D görselleştirme (Yükleme Planlayıcı) ve Chart.js grafikleri (tüm BI sayfaları) çalışır durumda.
- [ ] Excel import/export ve PDF kalem-import özellikleri (Siparişler modülü) uçtan uca test edilmiş.
- [ ] FX banner dış API entegrasyonu (Dashboard) çalışıyor.
