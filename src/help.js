import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// ── Sayfa açıklamaları ────────────────────────────────────────────────────────
const pages = [
    {
        id: 'general',
        label: 'Genel Kurallar',
        icon: 'fa-book-open',
        href: null,
        color: '#5A4A3A',
        short: 'Tüm modüllerde geçerli temel kurallar',
        desc: `
            <p>Aşağıdaki kurallar uygulamanın tamamında geçerlidir. Bir rakam beklediğiniz gibi çıkmıyorsa önce buraya bakın.</p>
            <h4>Para birimleri</h4>
            <ul>
                <li>Siparişler EUR, USD, TRY ya da GBP olabilir. Farklı para birimleri <strong>asla toplanmaz</strong>; her toplam para birimi bazında ayrı gösterilir.</li>
                <li>Kur çevrimi yalnızca Fiyat Robotu'nda (TCMB kuru) ve ihraç kayıtlı satışların fatura/tahsilat kaydında yapılır.</li>
            </ul>
            <h4>İptal ve bedelsiz siparişler</h4>
            <ul>
                <li><strong>İptal</strong> etiketli siparişler ciroya, alacağa ve analizlere girmez.</li>
                <li><strong>Bedelsiz</strong> ödeme şekilli siparişler faturasal zorunluluk nedeniyle temsili tutarlıdır; tahsil edilmez, ciro ve fiyat istatistiklerine girmez.</li>
                <li>Normal bir siparişin içindeki tek bir bedelsiz kalem, kalemde <em>BEDELSİZ</em> işaretiyle ayrılır.</li>
            </ul>
            <h4>Tarihler ve yıllar</h4>
            <ul>
                <li>Bir siparişin "yılı" <strong>sipariş tarihine</strong> göre belirlenir, sipariş numarasına göre değil (ör. 2026-02 numaralı ama 25.12.2025 tarihli sipariş 2025 siparişidir).</li>
                <li>Alacak ve vade ise <strong>fatura tarihine</strong> göre işler (bkz. Ödeme Takibi).</li>
                <li>Kartlardaki <em>2026</em> / <em>Tüm yıllar</em> etiketi, o rakamın hangi dönemi kapsadığını gösterir.</li>
            </ul>
            <h4>Otomatik güncellenen alanlar</h4>
            <ul>
                <li>Siparişin Tahsil Edilen / Kalan Bakiye tutarları ve "Bakiye Bekliyor", "Ödeme Tamamlandı", "Gecikme" etiketleri tahsilatlardan otomatik hesaplanır.</li>
                <li>Müşteri durumu teklif ve siparişle otomatik ilerler: Pasif → Potansiyel → Aktif.</li>
            </ul>
            <h4>Yetkiler</h4>
            <p>Her kullanıcı yalnızca yetkisi olan modülleri görür. Görüntüleme yetkisinde kayıt değiştirilemez. Yetkiler Yönetici ekranından verilir; tüm değişiklikler kayıt altına alınır.</p>
        `
    },
    {
        id: 'dashboard',
        label: 'Dashboard',
        icon: 'fa-chart-pie',
        href: 'index.html',
        color: '#2D4A3E',
        short: 'Genel bakış ve KPI özeti',
        desc: `
            <p>Uygulamanın ana kontrol panelidir. Buradan tüm operasyonun anlık durumunu bir bakışta görebilirsiniz.</p>
            <h4>Görebilecekleriniz</h4>
            <ul>
                <li><strong>Finans kartları:</strong> Sipariş Cirosu (altında Faturalanan), Tahsil Edilen, Vadeli Bakiye, Gecikmiş Borç (ayrıntısı aşağıda).</li>
                <li><strong>Bakiye Köprüsü:</strong> Dört kartın birbirine nasıl bağlandığını gösteren mutabakat tablosu.</li>
                <li><strong>Operasyon kartları:</strong> Aktif sipariş, bekleyen teklif, açık şikayet, sevk bekleyen sipariş.</li>
                <li><strong>Grafikler:</strong> Aylık sipariş hacmi ve döviz dağılımı.</li>
                <li><strong>Döviz Kuru Bandı:</strong> Güncel USD/TRY ve EUR/TRY kurları.</li>
            </ul>
            <p>Her kartın başlığındaki etiket (<em>2026</em> ya da <em>Tüm yıllar</em>) o kartın hangi dönemi gösterdiğini söyler. Yıl seçici yalnızca yıl etiketli kartları değiştirir.</p>

            <h4>Finans kartları neyi gösterir?</h4>
            <ul>
                <li><strong>Sipariş Cirosu (seçili yıl):</strong> Seçili yılda <em>sipariş tarihi</em> olan siparişlerin toplam tutarı. İptal ve bedelsiz siparişler dahil değildir. Kartın altındaki <strong>Faturalanan</strong> satırı aynı yılda <em>fatura tarihi</em> olan faturaların toplamıdır (2026 ve sonrası; fark aşağıda).</li>
                <li><strong>Tahsil Edilen (seçili yıl):</strong> Aynı siparişlere bugüne kadar yapılan tahsilatların toplamı (tahsilat hangi yıl gelmiş olursa olsun).</li>
                <li><strong>Vadeli Bakiye (tüm yıllar):</strong> <em>Faturası kesilmiş</em>, açık ve vadesi henüz gelmemiş alacaklar.</li>
                <li><strong>Gecikmiş Borç (tüm yıllar):</strong> <em>Faturası kesilmiş</em>, açık ve vadesi geçmiş alacaklar.</li>
            </ul>
            <p>Vadeli Bakiye ve Gecikmiş Borç, Ödeme Takibi modülüyle aynı hesaptan gelir: <strong>alacak faturayla doğar</strong>, vade fatura tarihinden işler.</p>

            <h4>Sipariş Cirosu ile Faturalanan arasındaki fark</h4>
            <p>İkisi farklı soruları cevaplar:</p>
            <table class="help-table" style="width:100%;border-collapse:collapse;font-size:12px;margin:6px 0 10px;">
                <thead><tr>
                    <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #EFEAE0;"></th>
                    <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #EFEAE0;">Sipariş Cirosu (ana rakam)</th>
                    <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #EFEAE0;">Faturalanan (alt satır)</th>
                </tr></thead>
                <tbody>
                    <tr><td style="padding:4px 6px;font-weight:600;">Neyi ölçer?</td><td style="padding:4px 6px;">Bu yıl ne kadar <strong>iş aldık</strong> (satış performansı)</td><td style="padding:4px 6px;">Bu yıl ne kadar <strong>mal gönderip faturaladık</strong> (muhasebe cirosuna yakın)</td></tr>
                    <tr><td style="padding:4px 6px;font-weight:600;">Hangi tarihe bakar?</td><td style="padding:4px 6px;">Sipariş tarihi</td><td style="padding:4px 6px;">Fatura tarihi</td></tr>
                    <tr><td style="padding:4px 6px;font-weight:600;">Faturası kesilmemiş siparişler</td><td style="padding:4px 6px;">Dahil</td><td style="padding:4px 6px;">Dahil değil</td></tr>
                    <tr><td style="padding:4px 6px;font-weight:600;">Yıl sonu siparişleri</td><td style="padding:4px 6px;">Siparişin alındığı yılda sayılır</td><td style="padding:4px 6px;">Faturanın kesildiği yılda sayılır</td></tr>
                    <tr><td style="padding:4px 6px;font-weight:600;">Muhasebe rakamıyla</td><td style="padding:4px 6px;">Tutmaz (amaç bu değil)</td><td style="padding:4px 6px;">Büyük ölçüde tutar</td></tr>
                    <tr><td style="padding:4px 6px;font-weight:600;">Geçmiş yıllar</td><td style="padding:4px 6px;">Tam — tüm siparişler sistemde</td><td style="padding:4px 6px;">Gösterilmez — faturalar sisteme 2026'da aktarıldı, önceki yıllar eksik</td></tr>
                    <tr><td style="padding:4px 6px;font-weight:600;">Veri girişine bağımlılık</td><td style="padding:4px 6px;">Sipariş girilince hemen yansır</td><td style="padding:4px 6px;">Fatura Ödeme Takibi'ne girilmezse görünmez</td></tr>
                </tbody>
            </table>
            <p><strong>Örnek:</strong> Paffoni 2026-02 siparişi 25.12.2025'te alındı, faturası 02.07.2026'da kesildi. Sipariş Cirosu'nda <em>2025</em>'te, Faturalanan'da <em>2026</em>'da görünür. Vadesi fatura tarihinden işlediği için (31.08.2026) Gecikmiş Borç kartında yer alır.</p>
            <p>Ana rakam olarak Sipariş Cirosu kullanılır: verisi tüm yıllar için eksiksizdir ve Tahsil Edilen kartıyla aynı siparişleri kapsar. Kesin muhasebe cirosu için muhasebe programı esas alınır.</p>

            <h4>Neden "Ciro − Tahsil" ≠ "Vadeli + Gecikmiş"?</h4>
            <p>Çünkü iki kart grubu farklı şeyleri ölçer:</p>
            <ol>
                <li><strong>Dönem farkı:</strong> Ciro/Tahsil sadece <em>sipariş tarihi</em> seçili yılda olan siparişlerdir (sipariş numarası değil); Vadeli/Gecikmiş ise diğer yıllardan kalan açıkları da içerir.</li>
                <li><strong>Faturalanmamış siparişler:</strong> Henüz sevk edilip faturalanmamış siparişin kalan tutarı ciroda vardır ama <em>alacak değildir</em>; Vadeli/Gecikmiş kartlarına girmez.</li>
                <li><strong>Manuel takip:</strong> Ödemesinin ne zaman geleceği belli olmayan siparişler (Ödeme Takibi › Manuel Alacaklar) vade uyarısı üretmez; Vadeli/Gecikmiş kartlarına bilerek dahil edilmez.</li>
                <li><strong>Fazla ödeme / yuvarlama:</strong> Müşterinin fazla ödemesi (avans) bir sonraki siparişe mahsup edilene kadar küçük farklar oluşturabilir.</li>
            </ol>
            <p><strong>Örnek (EUR, 2026, 18.09.2026 itibarıyla):</strong></p>
            <ul>
                <li>Ciro 353.114,80 − Tahsil 266.588,04 = <strong>86.526,76</strong> (2026 siparişlerinin açığı). Bu tutar şöyle dağılır:
                    <ul>
                        <li>22.169,36 — faturalandı, vadesi gelmedi → <em>Vadeli Bakiye</em></li>
                        <li>0,00 — faturalandı, vadesi geçti</li>
                        <li>59.497,40 — henüz faturalanmadı (sevk bekliyor)</li>
                        <li>4.860,00 — manuel takipte (Ptp Usprom 2026-01 / 2026-02)</li>
                    </ul>
                </li>
                <li><em>Gecikmiş Borç</em>taki 19.293,16 EUR, <strong>Paffoni 2026-02</strong> siparişidir (fatura IHR2026000000038, 02.07.2026; vade 31.08.2026). Siparişin numarası 2026 olsa da <em>sipariş tarihi</em> 25.12.2025 olduğu için Ciro'da 2025 siparişleri arasında sayılır; bu yüzden köprüde "diğer yıllar" satırında görünür.</li>
                <li>Önceki yıllardan 70.584,81 EUR manuel takipte (Ptp Usprom 2025-03, Alvano 2023-01, Roccaforte 2025-01).</li>
            </ul>
            <p>Aynı mantık USD ve TRY için de geçerlidir; güncel rakamlar Dashboard'daki <strong>Bakiye Köprüsü</strong> tablosunda her zaman para birimi bazında görünür.</p>

            <h4>Manuel Alacaklar Dashboard'da görünüyor mu?</h4>
            <p>Finans kartlarında <strong>görünmez</strong> (vadesi belirsiz olduğu için "vadeli" ya da "gecikmiş" sayılamaz). Toplamları Bakiye Köprüsü'nün en alt satırında, <em>Manuel takip toplamı</em> olarak gösterilir. Ayrıntı: Ödeme Takibi › Manuel Alacaklar.</p>

            <h4>Önemli kurallar</h4>
            <ul>
                <li>Para birimleri (EUR, USD, TRY, GBP) <strong>asla toplanmaz</strong>; her biri ayrı satırda gösterilir.</li>
                <li>İptal ve bedelsiz siparişler ne ciroya ne alacağa girer.</li>
            </ul>
            <h4>Nasıl Kullanılır?</h4>
            <p>Operasyon kartları, Ödeme Durumu, Top Müşteriler ve alttaki modül kartları tıklanınca ilgili modülü açar; "Tümü →" bağlantıları tam listeye götürür. Döviz kurları TCMB'den alınır; bandın sağında son kur tarihi yazar.</p>
        `
    },
    {
        id: 'order-timeline',
        label: 'Takip Takvimi',
        icon: 'fa-calendar-check',
        href: 'order-timeline.html',
        color: '#3B6E8C',
        short: 'Sevk ve vade tarihleri takvimde',
        desc: `
            <p>Siparişlerin <strong>sevk</strong> ve <strong>vade</strong> tarihlerini takvim ya da liste hâlinde gösterir. Günlük işlerin "bugün ne sevk ediliyor, hangi ödemenin vadesi geliyor?" sorusuna cevap verir.</p>
            <h4>Görünümler</h4>
            <ul>
                <li><strong>Takvim:</strong> Aylık görünüm. 🚢 sevk tarihi, 📅 vade tarihi, 📌 elle eklenen not. Güne tıklayarak not ekleyebilir, düzenleyebilir, silebilirsiniz.</li>
                <li><strong>Liste:</strong> Durum etiketi, ödeme durumu (Ödendi / Kısmi / Ödeme Bekliyor) filtreleri ve sevk, vade, sipariş tarihi ya da firma adına göre sıralama.</li>
                <li><strong>Hızlı filtreler:</strong> Tümü · Aktif · Geciken · Bu Ay.</li>
            </ul>
            <h4>Geciken siparişler</h4>
            <p>Üstteki kırmızı uyarı, vadesi geçmiş ve bakiyesi açık siparişleri sayar. Kural Ödeme Takibi ile aynıdır: iptal, bedelsiz ve <em>manuel takipteki</em> siparişler geciken sayılmaz.</p>
        `
    },
    {
        id: 'customers',
        label: 'Müşteri Kartları',
        icon: 'fa-id-card',
        href: 'customers.html',
        color: '#1A6B5A',
        short: 'Müşteri arşivi ve iletişim bilgileri',
        desc: `
            <p>Tüm müşteri ve aday firmaların kaydını tuttuğunuz arşivdir. Diğer modüllerin (sipariş, teklif, fiyat kartı, credit note) müşteri listesi buradan gelir.</p>
            <h4>Kart sekmeleri</h4>
            <ul>
                <li><strong>Genel Bilgiler:</strong> Ülke, firma adı, müşteri tipi (Distribütör, Toptancı, Bayi …), durum, web sitesi, iki yetkili. Bölge ülkeden otomatik belirlenir.</li>
                <li><strong>Ticari &amp; Risk:</strong> Para birimi, teslim şekli (Incoterms), ödeme koşulu, edinme kaynağı, müşteri sorumlusu, vergi no, iletişim dili, risk skoru, kredi limiti, yıllık hedef hacim, ilgilenilen ürün grupları.</li>
                <li><strong>Geçmiş Notlar:</strong> Tarihli görüşme notları. Günlük Arama Listesi'nden eklenen notlar da buraya düşer.</li>
            </ul>
            <h4>Müşteri durumu</h4>
            <ul>
                <li><strong>Aktif · Pasif · Potansiyel · Kara Liste.</strong></li>
                <li>Otomatik geçişler: Pasif bir müşteriye teklif hazırlanınca <em>Potansiyel</em>, Potansiyel bir müşterinin teklifi siparişe dönünce <em>Aktif</em> olur.</li>
            </ul>
            <h4>Diğer</h4>
            <ul>
                <li><strong>Filtreler:</strong> Bölge, ülke, müşteri grubu, durum, sorumlu.</li>
                <li><strong>İçe Aktar:</strong> Excel'den toplu giriş; aynı firma varsa güncellenir, yoksa eklenir.</li>
                <li><strong>Excel'e Aktar:</strong> Filtrelenmiş listeyi indirir.</li>
            </ul>
        `
    },
    {
        id: 'products',
        label: 'Ürün Kartları',
        icon: 'fa-box',
        href: 'products.html',
        color: '#2D4A3E',
        short: 'Ürün ana verisi',
        desc: `
            <p>Tüm ürünlerin ana veri merkezidir. Sipariş, teklif, fiyat kartı ve Fiyat Robotu ürün adlarını buradan alır.</p>
            <h4>Kartta neler var?</h4>
            <ul>
                <li><strong>Kimlik:</strong> Stok kodu, seri adı, Türkçe ve İngilizce stok adı, ürün görseli (JPG/PNG, en fazla 8 MB).</li>
                <li><strong>Sınıflandırma:</strong> Birim, paketleme, ürün grubu, ürün türü.</li>
                <li><strong>Özellikler:</strong> Üç fonksiyon özelliği, boyut, renk, kalite, net ağırlık.</li>
                <li><strong>Palet bilgisi:</strong> Net/brüt ağırlık, palet adedi, ölçüler, palet cinsi.</li>
                <li><strong>Geçmiş:</strong> Kartta yapılan değişikliklerin kaydı.</li>
            </ul>
            <h4>İpuçları</h4>
            <ul>
                <li>Listede kırmızı <strong>"Kod"</strong> rozeti, stok kodu ile renk/seri gibi özelliklerin birbirini tutmadığını gösterir; kartı kontrol edin.</li>
                <li>İçe Aktar ile Excel/CSV'den toplu güncelleme yapılır. "Mevcut tüm ürünleri sil" seçeneği geri alınamaz.</li>
            </ul>
        `
    },
    {
        id: 'pallet-defs',
        label: 'Palet Tanımları',
        icon: 'fa-pallet',
        href: 'pallet-definitions.html',
        color: '#6B5A2D',
        short: 'Yüklemeye hazır palet reçeteleri',
        desc: `
            <p>Ürünlerden oluşan, taşımaya hazır palet tanımlarını tutar. Yükleme Planlayıcı bu tanımlarla çalışır.</p>
            <h4>Bir palet tanımında</h4>
            <ul>
                <li><strong>Ölçüler:</strong> En × Boy × Yükseklik (cm).</li>
                <li><strong>Palet cinsi:</strong> EUR1 (dara 25 kg), EUR3 (dara 35 kg), Non-Euro, Diğer.</li>
                <li><strong>İstif:</strong> İstiflenebilir mi ve hangi katmanda durabileceği (1 = en dayanıklı / alt, 3 = en hafif / üst).</li>
                <li><strong>İçerik:</strong> Ürün Kartları'ndan ürün ve adet. Ürün ağırlığı + dara = toplam ağırlık otomatik hesaplanır; gerekirse elle değiştirilebilir ("Elle değiştirildi" işareti çıkar).</li>
            </ul>
        `
    },
    {
        id: 'call-rotation',
        label: 'Günlük Arama Listesi',
        icon: 'fa-phone-volume',
        href: 'call-rotation.html',
        color: '#3F5C7A',
        short: 'Bugün aranacak 5 müşteri',
        desc: `
            <p>Her temsilciye, kendi portföyünden (Müşteri Kartları'ndaki <em>Müşteri Sorumlusu</em>) seçtiği bölgede, <strong>en uzun süredir aranmamış 3 Pasif + 2 Aktif</strong> müşteriyi günlük yapılacaklar listesi olarak sunar.</p>
            <h4>Nasıl çalışır?</h4>
            <ul>
                <li>Önce bölge seçin. Liste gün boyunca aynı kalır; sayfayı yenilemek listeyi değiştirmez.</li>
                <li>Görüşmeden sonra "Yeni Not Ekle" ile not girin. Bugün not eklenen müşteri <em>Bugün Arandı</em> (ya da <em>Bugün Mesaj Gönderildi</em>) rozetini alır ve gün sonuna kadar listede kalır. Not, müşteri kartının <em>Geçmiş Notlar</em> sekmesine yazılır.</li>
                <li>Yönetici tüm temsilcilerin listelerini birlikte görür; her müşterinin sorumlusu ayrıca yazılır.</li>
                <li>"Müşteri Kartı" düğmesi ilgili kartı doğrudan notlar sekmesinde açar.</li>
            </ul>
        `
    },
    {
        id: 'orders',
        label: 'Siparişler',
        icon: 'fa-boxes-stacked',
        href: 'orders.html',
        color: '#3B5998',
        short: 'Sipariş girişi ve takibi',
        desc: `
            <p>Tüm siparişlerin girildiği ve takip edildiği ana modüldür. Dashboard, Ödeme Takibi, Takip Takvimi ve analiz ekranları bu veriyi kullanır.</p>
            <h4>Sipariş formu</h4>
            <ul>
                <li><strong>Temel bilgiler:</strong> Müşteri, sipariş no, İDEVİT ve İDEAL sipariş numaraları, sipariş türü (İhracat / İhraç Kayıt / KDV), sipariş, sevk ve vade tarihleri.</li>
                <li><strong>Finansal:</strong> Para birimi, toplam tutar, ödeme şekli (Peşin, T/T, Mal Mukabili, Bedelsiz, 30–120 Gün Vade).</li>
                <li><strong>Tahsil Edilen / Kalan Bakiye:</strong> Elle girilmez; <em>Ödeme Takibi</em>'ndeki tahsilatlardan otomatik hesaplanır.</li>
                <li><strong>Kalemler:</strong> Ürün, kod, renk, fonksiyon, adet, birim fiyat. "PDF'den İçe Aktar" ile proforma PDF'i okunur (RENK / DELİK / SERİ sütunları kontrol edilir).</li>
                <li><strong>Fatura Altı İndirim:</strong> Kalem toplamından düşülen indirim; sipariş toplamı buna göre oluşur.</li>
                <li><strong>Fiyat Notu işaretleri:</strong> <em>BEDELSİZ</em> (faturasal zorunlulukla girilen temsili fiyat) ve <em>CN FİYATI</em> (Credit Note nedeniyle düzenlenmiş fiyat). İşaretli satırlar fiyat istatistiklerine girmez.</li>
            </ul>
            <h4>Durum etiketleri</h4>
            <ul>
                <li>Bir siparişe birden fazla etiket verilebilir: Devam Ediyor, Üretime Hazır, Üretimde, Sevke Hazır, Sevk Edildi, Teslim Edildi, İptal, Yeni Müşteri.</li>
                <li><strong>Otomatik etiketler:</strong> "Bakiye Bekliyor" / "Ödeme Tamamlandı" tahsilata göre, "Gecikme" vade geçince eklenir ve ödeme gelince kalkar.</li>
                <li>Kartta <strong>Credit Note</strong> etiketi, o siparişe uygulanacak CN olduğunu gösterir; tıklayınca Credit Notes'ta açılır.</li>
            </ul>
            <h4>Diğer</h4>
            <ul>
                <li><strong>Filtreler:</strong> Para birimi, durum etiketi, sevk ayı; sevk tarihine göre sıralama.</li>
                <li><strong>Excel Import / Dışa Aktar:</strong> Toplu giriş ve liste çıktısı. Import, tahsilat tutarlarını değiştirmez.</li>
                <li><strong>Silme:</strong> Onay penceresi siparişe bağlı kayıtları (fatura, tahsilat, CN) listeler.</li>
            </ul>
        `
    },
    {
        id: 'quotations',
        label: 'Teklifler',
        icon: 'fa-file-contract',
        href: 'quotations.html',
        color: '#7C4F2A',
        short: 'Teklif hazırlama ve siparişe aktarım',
        desc: `
            <p>Müşteri tekliflerinin hazırlandığı ve takip edildiği modüldür. Form yapısı Siparişler ile aynıdır (kalemler, PDF'den içe aktarma, fatura altı indirim, fiyat notu işaretleri).</p>
            <h4>Teklif durumları</h4>
            <ul>
                <li><strong>Bekliyor · Kabul · Red</strong> — elle seçilir.</li>
                <li><strong>Süresi Doldu</strong> — geçerlilik tarihi geçmiş ve hâlâ "Bekliyor" olan teklifler otomatik bu şekilde gösterilir.</li>
                <li><strong>Sipariş Dönüştü</strong> — "Siparişe Gönder" ile otomatik verilir.</li>
            </ul>
            <h4>Siparişe gönderme</h4>
            <p>Teklif formundaki <strong>Siparişe Gönder</strong> düğmesi teklifi, kalemleriyle birlikte yeni bir siparişe aktarır; veri tekrar girilmez.</p>
            <h4>Müşteri durumuna etkisi</h4>
            <ul>
                <li>Pasif bir müşteriye teklif hazırlanınca müşteri <em>Potansiyel</em> olur.</li>
                <li>Potansiyel bir müşterinin teklifi siparişe dönünce müşteri <em>Aktif</em> olur.</li>
            </ul>
        `
    },
    {
        id: 'client-prices',
        label: 'Müşteri Sabit Fiyatlar',
        icon: 'fa-tags',
        href: 'client-prices.html',
        color: '#7C3AED',
        short: 'Müşterilerle anlaşılmış fiyatlar',
        desc: `
            <p>Her müşteriyle anlaşılmış ürün fiyatlarının listesidir. Liste bilinçli olarak <strong>elle</strong> tutulur; Satış &amp; Fiyat Analizi gerçek satışları bu fiyatlarla karşılaştırır.</p>
            <h4>Fiyat kartı</h4>
            <ul>
                <li>Her müşterinin tek bir kartı ve kartın tek bir <strong>para birimi</strong> vardır.</li>
                <li>Satırlar: stok kodu, ürün adı, liste fiyatı (Fiyat Robotu'ndan otomatik), iskonto %, <strong>Net v.1</strong> ve <strong>Net v.2</strong> (eski ve güncel net fiyat, tarihleriyle), fark %.</li>
                <li><strong>Bedelsiz / Numune</strong> işaretli satırlar istatistiklere katılmaz.</li>
                <li>Ürün adları TR ya da EN gösterilebilir.</li>
            </ul>
            <h4>Araçlar</h4>
            <ul>
                <li><strong>Siparişlerden Getir:</strong> Sipariş kalemlerinden müşteri + ürün + para birimi bazında net fiyatları türetir. Bir üründe birden fazla fiyat varsa satır sarı işaretlenir, doğru fiyatı listeden seçersiniz. İptal ve bedelsiz siparişler hariçtir.</li>
                <li><strong>Karşılaştır:</strong> Seçilen müşterilerin aynı ürünlerdeki güncel net fiyatlarını yan yana gösterir.</li>
                <li>Müşteriye satılmış ama kartında olmayan ürünler kartta uyarı olarak görünür.</li>
            </ul>
        `
    },
    {
        id: 'credit-notes',
        label: 'Credit Notes',
        icon: 'fa-file-invoice',
        href: 'credit-notes.html',
        color: '#9F3D3D',
        short: 'Şikayet alacak dekontları',
        desc: `
            <p>Müşteri şikayetlerinde verilen alacak dekontlarını (Credit Note) ve bunların <strong>hangi siparişte uygulandığını</strong> takip eder. Amacı, verilmiş bir kararın siparişe işlenmeyi unutulmamasıdır.</p>
            <h4>Bir Credit Note'ta</h4>
            <ul>
                <li><strong>Başlık:</strong> CN no, belge tarihi, müşteri, para birimi, uygulanacak sipariş, süreç durumu.</li>
                <li><strong>Kalemler:</strong> Ürün, ürün ID / müşteri referansı, karar, hata kategorisi, adet, birim fiyat, telafi şekli (<em>Mahsup</em> = tutar düşülecek, <em>Bedelsiz</em> = ürün gönderilecek).</li>
            </ul>
            <h4>Kararlar</h4>
            <ul>
                <li><strong>Alacak yazılanlar:</strong> Onaylandı, Onaylandı - Kırık, %50 İskonto - Tolerans.</li>
                <li><strong>Alacak yazılmayanlar:</strong> Reddedildi, Reddedildi - Kırık, Reddedildi - Tolerans, Resim Bekleniliyor.</li>
                <li><strong>%50 tolerans:</strong> Belgedeki birim fiyat zaten yarıya indirilmiş fiyattır; tutar ayrıca yarıya bölünmez. Satırdaki "½" düğmesi fiyatı tek tıkla yarıya indirir.</li>
            </ul>
            <h4>Süreç durumu</h4>
            <ul>
                <li><strong>İncelemede</strong> → <strong>Belge Gönderildi</strong> (karar verildi, henüz siparişe işlenmedi) → <strong>Siparişe İşlendi</strong>. Ayrıca <strong>İptal</strong>.</li>
                <li>Üstteki "Siparişe İşlenmeyi Bekleyenler" paneli, sipariş bazında gruplanmış bekleyen mahsup tutarını ve bedelsiz ürün adedini gösterir.</li>
            </ul>
            <h4>Veri girişi</h4>
            <ul>
                <li><strong>Belgeden Aktar:</strong> Word (.docx) Credit Note belgesini okuyup formu doldurur.</li>
                <li><strong>Excel'den Toplu Aktar:</strong> CREDIT NOTE TAKIP.xlsx dosyası.</li>
                <li>Aynı ürün ID daha önce başka bir CN'de işlenmişse uyarı verilir.</li>
            </ul>
        `
    },
    {
        id: 'payments',
        label: 'Ödeme Takibi',
        icon: 'fa-circle-dollar-to-slot',
        href: 'payments.html',
        color: '#2D4A8C',
        short: 'Fatura bazlı alacaklar, tahsilat, vade ve Eximbank',
        desc: `
            <p>Sistemdeki siparişlerin tahsilatını takip ettiğiniz sayfadır. Alacak <strong>faturayla</strong> doğar; vade faturanın tarihinden işler. Henüz faturalanmamış sipariş bakiyesi alacak sayılmaz, ayrıca gösterilir.</p>
            <h4>Sekmeler</h4>
            <ul>
                <li><strong>Genel Bakış:</strong> Açık alacak, vadesi geçen, 30 gün içinde vadesi gelecek, bu ay tahsilat, faturalanmamış bakiye ve manuel takip — hepsi para birimi bazında ayrı. Panellere tıklayınca ilgili siparişler listelenir.</li>
                <li><strong>Açık Alacaklar:</strong> Yaşlandırma tablosu ve fatura bazlı liste. Satırdaki butonlar: Tahsilat, Hatırlatma, Manuel Alacaklar'a taşı, Sipariş faturaları.</li>
                <li><strong>Tahsilatlar:</strong> Gelen ödemeler sipariş bazında gruplanır. "Tarihsiz" kayıtlar sistem öncesi ödemelerdir; "Tarih gir" ile arşiv için tarihlendirilebilir. Dağıtılmamış tutar müşteri avansıdır; "Dağıt" ile sonraki siparişe mahsup edilir.</li>
                <li><strong>Eximbank:</strong> Limit kullanımı (faturalı + sevk bekleyen) ve her fatura için iç son gün (vade + 45), V.G.A.B son günü (vade + 60), tazminat başvurusu son günü (vade + 90). Bildirimi yaptığınızda "Bildirim kaydet".</li>
                <li><strong>Manuel Alacaklar:</strong> Ödemesinin ne zaman geleceği belli olmayan siparişlerin serbest takibi (not, hatırlatma). İsteğe bağlı ödeme planı eklenebilir.</li>
            </ul>
            <h4>Tahsilat nasıl girilir?</h4>
            <p>"Tahsilat Gir" → firma adının herhangi bir kısmını yazın → tutar ve valör tarihini girin → "En eski vadeden dağıt". SWIFT masrafı gibi eksik gelen küçük tutarları <strong>Kesinti</strong> sütununa yazın; sipariş tam kapanır, masraf ayrıca raporlanır. İhraç kayıtlı satışta TL ödemeyi "Para farklı birimde geldi" ile kur girerek kaydedin.</p>
            <h4>Fatura nasıl girilir?</h4>
            <p>Açık Alacaklar'da satırdaki <i class="fa-solid fa-file-invoice"></i> butonu ya da "Henüz faturalanmamış" tablosundaki "Fatura ekle". Vade ödeme şeklinden önerilir (hafta sonuna gelirse Pazartesi); siparişin vadesi de faturadan güncellenir. Kısmi sevkiyatta her faturayı ayrı girin.</p>
            <h4>Otomatik olanlar</h4>
            <ul>
                <li>Siparişin "Tahsil" ve "Kalan" tutarları tahsilatlardan hesaplanır; Siparişler ekranında elle değiştirilmez.</li>
                <li>Etiketler: bakiye kapanınca "Ödeme Tamamlandı", açılınca "Bakiye Bekliyor"; "Gecikme" vade geçince eklenir, ödeme gelince kalkar.</li>
                <li>Bedelsiz ve iptal siparişler alacak sayılmaz.</li>
            </ul>
        `
    },
    {
        id: 'prices',
        label: 'Fiyat Robotu',
        icon: 'fa-calculator',
        href: 'prices.html',
        color: '#8B5E2A',
        short: 'Liste fiyatları ve iskonto hesabı',
        desc: `
            <p>Güncel <strong>2026 TL</strong> liste fiyatlarını <strong>2022-3 EUR/USD</strong> döviz listeleriyle karşılaştırır ve anlık iskonto hesabı yapar. Maliyet ya da kâr marjı hesaplamaz.</p>
            <h4>Nasıl hesaplar?</h4>
            <ul>
                <li><strong>TL iskonto zinciri:</strong> Liste × (1 − i1) × (1 − i2) × (1 − i3) × (1 − i4) = TL net.</li>
                <li>TL net, güncel TCMB kuruyla EUR'ya (ya da USD'ye) çevrilir.</li>
                <li><strong>Euro fiyat iskontosu:</strong> 2022-3 EUR liste × (1 − iskonto) = EUR net.</li>
                <li><strong>Fark (TL/EUR):</strong> İki net fiyat arasındaki fark; hangi listenin müşteri için daha avantajlı olduğunu gösterir.</li>
                <li>Üstteki düğmelerle TL–EURO ya da TL–USD karşılaştırmasına geçilir.</li>
            </ul>
            <h4>Diğer</h4>
            <ul>
                <li>Ürünler katalog sırasına göre gruplanır; grup filtresi vardır.</li>
                <li>Ürün adları Ürün Kartları'ndan gelir; kodu Ürün Kartları'nda olmayan ürün uyarı verir.</li>
                <li><strong>Listeyi Aktar / İçe Aktar:</strong> Excel'e indirip düzeltip geri yükleyin. "Kayıt ID" doluysa satır güncellenir, boşsa yeni ürün eklenir.</li>
                <li>Müşteri Sabit Fiyatlar'daki liste fiyatları bu tablodan otomatik doldurulur.</li>
            </ul>
        `
    },
    {
        id: 'profitability',
        label: 'Satış & Fiyat Analizi',
        icon: 'fa-scale-balanced',
        href: 'profitability.html',
        color: '#1A6B5A',
        short: 'Gerçekleşen satışlar ve fiyat sapmaları',
        desc: `
            <p>Gerçekte ne sattığınızı ve anlaştığınız fiyatın ne kadar dışına çıkıldığını gösterir. Sipariş kalemleri (gerçek satış) ile Müşteri Sabit Fiyatlar (anlaşılan fiyat) karşılaştırılır.</p>
            <p><strong>Not:</strong> Bu sayfa kâr/marj hesaplamaz; sistemde ürün maliyeti tutulmuyor.</p>
            <h4>Bölümler</h4>
            <ul>
                <li><strong>Gerçek Satış Performansı:</strong> Ürün bazında gerçekleşen adet ve ciro; her para birimi ayrı gruplanır, kur çevrimi yapılmaz.</li>
                <li><strong>Fiyat Sapma Raporu:</strong> Anlaşılan fiyat ile fiili ortalama satış fiyatı arasındaki fark ve para etkisi.</li>
                <li><strong>Müşteriler Arası Tutarsızlık:</strong> Aynı ürün için farklı müşterilerle anlaşılan fiyatların aralığı.</li>
            </ul>
            <h4>Filtreler ve kapsam</h4>
            <ul>
                <li>Yıl, para birimi ve "1 adetlik satırları hariç tut" (numune / yedek parça).</li>
                <li>İptal ve bedelsiz siparişler ile <em>BEDELSİZ</em> / <em>CN FİYATI</em> işaretli kalemler hesaba girmez.</li>
            </ul>
        `
    },
    {
        id: 'complaints',
        label: 'Şikayet Panosu',
        icon: 'fa-triangle-exclamation',
        href: 'complaints.html',
        color: '#9F5A2A',
        short: 'Credit Note verisinden şikayet analizi',
        desc: `
            <p>Şikayetleri ürün, müşteri, karar ve zaman bazında analiz eder. Veri <strong>Credit Notes</strong> modülünden gelir; bu ekran salt okunurdur, kayıt Credit Notes'ta girilir.</p>
            <h4>Görebilecekleriniz</h4>
            <ul>
                <li><strong>Kartlar:</strong> Toplam şikayet (kalem sayısı), kabul edilen ve oranı, reddedilen ve oranı, siparişe işlenmemiş CN'ler.</li>
                <li><strong>Ürün Bazında Şikayet:</strong> Ürüne tıklayınca tüm şikayet kalemleri açılır.</li>
                <li><strong>Müşteri Bazında Şikayet:</strong> En çok şikayet eden müşteri üstte; kabul/red ve ilk/son tarih.</li>
                <li><strong>Karar Dağılımı</strong> ve <strong>Aylık Şikayet Trendi</strong> grafikleri.</li>
            </ul>
            <h4>Filtreler</h4>
            <p>Tarih aralığı, müşteri, ürün kodu, karar ve hata kategorisi.</p>
            <h4>Hata Kataloğu</h4>
            <p>Kalite kontrolün kullandığı 12 hata kategorisinin tanımları (ve varsa örnek görselleri). Credit Note kalemlerinde bu kategoriler seçilir.</p>
            <p><strong>Açık şikayet</strong> (Dashboard'da da): siparişe işlenmemiş ve iptal edilmemiş Credit Note.</p>
        `
    },
    {
        id: 'customer-score',
        label: 'Müşteri Skoru',
        icon: 'fa-ranking-star',
        href: 'customer-score.html',
        color: '#6B3A8C',
        short: 'Dört kritere göre müşteri puanlaması',
        desc: `
            <p>Müşterileri dört kritere göre 100 üzerinden puanlar ve A / B / C sınıfına ayırır. Satırdaki müşteriye tıklayınca her kriterin puanı ve gerekçesi görünür.</p>
            <h4>Dönem</h4>
            <p>Son 24 ay; ancak en erken <strong>01.11.2025</strong>. Siparişler sisteme bu tarihten itibaren eksiksiz girildi, Credit Note'lar ise 2023'ten beri var. Pencere daha geriye uzansaydı eski şikayetler sayılır ama o dönemin siparişleri sayılmazdı. Pencere Kasım 2027'den itibaren kendiliğinden tam 24 ay olur. Dönemde siparişi olmayan müşteriler <strong>puanlanmaz</strong> ("Puanlanmadı" filtresi); bunlardan manuel takipte açık alacağı olanlar listenin başında işaretli görünür.</p>
            <h4>Kriterler</h4>
            <ul>
                <li><strong>Sipariş Hacmi (30):</strong> Dönemdeki sipariş tutarının <em>aynı para birimindeki</em> müşteriler arasındaki sırası. EUR müşteriler kendi aralarında, TL müşteriler kendi aralarında karşılaştırılır; kur çevrimi yapılmaz. En büyük müşteri 30 alır.</li>
                <li><strong>Ödeme Düzeni (35):</strong> Ödeme Takibi'ndeki <em>bugünkü</em> durum. Vadesi geçmiş fatura yoksa 35; en eski gecikme 1–15 gün 30, 16–30 gün 25, 31–60 gün 15, 61–90 gün 8, 90 günden fazla 0. Manuel takipte açık alacağı olan müşteri 0 alır.</li>
                <li><strong>Şikayet (20):</strong> Dönemdeki Credit Note sayısı ÷ sipariş sayısı. Hiç yoksa 20; sipariş başına en fazla 0,25 ise 16, 0,5 ise 12, 1 ise 8, 2 ise 4, daha fazlası 0. (Tutar değil adet kullanılır, çünkü bedelsiz kalemlerin fiyatı girilmiyor.)</li>
                <li><strong>Süreklilik (15):</strong> Dönemdeki sipariş sayısı (6+ → 10, 4–5 → 8, 3 → 6, 2 → 4, 1 → 2) + son siparişin yakınlığı (90 gün içinde 5, 180 gün 3, 1 yıl 1).</li>
            </ul>
            <h4>Sınıflar</h4>
            <ul>
                <li><strong>A · Stratejik:</strong> 75 ve üzeri <em>ve</em> dönemde en az 3 sipariş. Puanı 75'i geçen ama daha az siparişi olan müşteri B'de kalır (tek siparişlik temiz bir kayıt "stratejik" sayılmaz).</li>
                <li><strong>B · Geliştirilecek:</strong> 50–74.</li>
                <li><strong>C · Riskli / Takip Gerekli:</strong> 50'nin altı.</li>
            </ul>
            <h4>Hariç tutulanlar</h4>
            <p>İptal ve bedelsiz siparişler ile iptal edilmiş Credit Note'lar hesaba girmez. İskonto oranı artık bir kriter değildir; iskonto riski değil anlaşılan fiyat seviyesini gösterir.</p>
            <h4>Bilinen sınırlama</h4>
            <p>Çekle ödeyen ve faturasında vade olmayan müşterilerde (ör. Insteel) gecikme hesaplanamaz; ödeme puanları tam görünür.</p>
        `
    },
    {
        id: 'product-analysis',
        label: 'Ürün Analizi',
        icon: 'fa-boxes-stacked',
        href: 'product-analysis.html',
        color: '#2D4A3E',
        short: 'Yapım aşamasında',
        desc: `
            <p>Son 12 ayın sipariş kalemlerinden ürün bazlı satış analizi (en çok satan ürünler, grup bazlı dağılım, müşteri–ürün matrisi) göstermesi planlanan ekrandır.</p>
            <h4>Durum</h4>
            <p><strong>Yapım aşamasında</strong> — ekran şu an veri göstermiyor. Ürün bazında satış rakamları için <em>Satış &amp; Fiyat Analizi › Gerçek Satış Performansı</em> bölümünü kullanın.</p>
        `
    },
    {
        id: 'market-analysis',
        label: 'Pazar Analizi',
        icon: 'fa-globe',
        href: 'market-analysis.html',
        color: '#2A6B5A',
        short: 'Ülke bazlı ihracat görünümü',
        desc: `
            <p>Müşteri, sipariş ve credit note verilerinden ülke bazlı bir görünüm çıkarır.</p>
            <h4>Görebilecekleriniz</h4>
            <ul>
                <li><strong>Kartlar:</strong> İhracat yapılan ülke sayısı, en yüksek cirolu ülke, en yüksek şikayet oranlı ülke, bu yıl yeni eklenen ülkeler.</li>
                <li><strong>Ülke Performans Tablosu:</strong> Ülke başına müşteri, sipariş, ciro, şikayet, şikayet oranı ve yıllık büyüme.</li>
                <li><strong>Grafikler:</strong> İlk 15 ülke ve seçilen ülkenin son 3 yıllık aylık trendi.</li>
            </ul>
            <h4>Bilinen sınırlama</h4>
            <p>Ciro tutarları şu an <strong>para birimi ayrılmadan</strong> toplanıyor ve "USD" etiketiyle gösteriliyor (EUR, USD ve TL siparişler aynı toplamda). Ülke sıralamasını kaba bir fikir olarak kullanın; tutarlar için Dashboard ve Satış &amp; Fiyat Analizi esas alınır. Modül gözden geçirilecek.</p>
        `
    },
    {
        id: 'loading-planner',
        label: 'Yükleme Planlayıcı',
        icon: 'fa-truck-ramp-box',
        href: 'loading-planner.html',
        color: '#4A5A6B',
        short: '3D tır / konteyner yükleme planı',
        desc: `
            <p>Palet Tanımları'ndaki paletleri seçip taşıyıcı aracı belirlediğinizde 3 boyutlu yükleme planını otomatik çıkarır.</p>
            <h4>Adımlar</h4>
            <ol>
                <li><strong>Araç seçin:</strong> Standart Tenteli Tır, Mega Tenteli Tır, 40' HQ, 20' DC, 10 Teker Kamyon ya da ölçüleri elle girilen özel araç.</li>
                <li><strong>Operasyonel payı girin:</strong> Sağ, sol, ön ve arkada bırakılacak boşluk (cm).</li>
                <li><strong>Paletleri ve adetlerini seçin.</strong></li>
                <li><strong>Hesaplama türünü seçin:</strong>
                    <ul>
                        <li><em>Kusursuz Denge Hesabı</em> — ağırlık merkezini dengeler ve boşluğu azaltır.</li>
                        <li><em>En Az Boşluk Hesabı</em> — ağırlığı dikkate almaz, yalnızca hacim doluluğunu en üste çıkarır.</li>
                    </ul>
                </li>
            </ol>
            <p>Sonuçta doluluk ve ağırlık özetleri ile ağır / orta / hafif renkli 3D görünüm çıkar. Sığmayan paletler ayrıca listelenir.</p>
            <p>İstif kuralları (istiflenebilir mi, hangi katman) Palet Tanımları'ndan gelir.</p>
        `
    },
    {
        id: 'admin',
        label: 'Yönetici',
        icon: 'fa-user-shield',
        href: 'admin.html',
        color: '#1C1A17',
        short: 'Kullanıcı yetkileri ve değişiklik kaydı',
        desc: `
            <p>Yalnızca hesap sahibinin görebildiği yönetim ekranıdır.</p>
            <h4>Kullanıcılar ve yetkiler</h4>
            <ul>
                <li>Her kullanıcıya modül bazında <strong>Görüntüle</strong> ya da <strong>Düzenle</strong> yetkisi verilir. Yetkisi olmayan modül menüde görünmez.</li>
                <li>Değişiklikler "Yetkileri Kaydet" ile kaydedilir.</li>
                <li>Örnek: Ödeme Takibi'ni kullanacak bir kişiye yalnızca <em>Ödeme Takibi: Düzenle</em> yetkisi yeterlidir; sipariş bakiyeleri otomatik güncellenir.</li>
            </ul>
            <h4>Değişiklik kaydı</h4>
            <p>Kullanıcıların yaptığı her ekleme, güncelleme ve silme (kim, ne zaman, hangi modülde) listelenir; modüle göre filtrelenebilir.</p>
        `
    }
];

// ── showPage global fonksiyon ─────────────────────────────────────────────────
window.showPage = function(index) {
    const p = pages[index];

    document.querySelectorAll('.toc-item').forEach((el, i) => {
        el.style.background = i === index ? `${pages[i].color}12` : 'transparent';
        el.style.color = i === index ? pages[i].color : 'var(--ink-2,#6B655B)';
    });

    const detail = document.getElementById('help-detail');
    detail.innerHTML = `
        <div style="max-width:720px;">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px;">
                <div style="
                    width:52px;height:52px;border-radius:12px;
                    background:${p.color}15;color:${p.color};
                    display:flex;align-items:center;justify-content:center;
                    font-size:20px;flex-shrink:0;
                "><i class="fa-solid ${p.icon}"></i></div>
                <div>
                    <h2 style="font-family:Verdana, Geneva, sans-serif;font-size:26px;font-weight:500;color:var(--ink-1,#1C1A17);margin:0 0 4px;">${p.label}</h2>
                    <p style="margin:0;font-size:13px;color:var(--ink-3,#968B7A);">${p.short}</p>
                </div>
            </div>
            <div class="help-content" style="font-family:Verdana, Geneva, sans-serif;font-size:14px;line-height:1.75;color:var(--ink-2,#6B655B);">
                ${p.desc}
            </div>
            ${p.href ? `
            <div style="margin-top:32px;">
                <a href="${p.href}" style="
                    display:inline-flex;align-items:center;gap:8px;
                    padding:10px 20px;border-radius:8px;
                    background:${p.color};color:#fff;
                    font-family:Verdana, Geneva, sans-serif;font-size:13px;font-weight:500;
                    text-decoration:none;transition:opacity 0.15s;
                " onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                    <i class="fa-solid fa-arrow-right" style="font-size:11px;"></i>
                    ${p.label} sayfasını aç
                </a>
            </div>
            ` : ''}
        </div>
    `;

    detail.querySelectorAll('.help-content h4').forEach(h => {
        h.style.cssText = `font-family:Verdana, Geneva, sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${p.color};font-weight:600;margin:24px 0 10px;`;
    });
    detail.querySelectorAll('.help-content p').forEach(el => { el.style.cssText = 'margin:0 0 14px;'; });
    detail.querySelectorAll('.help-content ol').forEach(el => { el.style.cssText = 'margin:0 0 14px;padding-left:22px;list-style:decimal;display:flex;flex-direction:column;gap:6px;'; });
    detail.querySelectorAll('.help-content ul').forEach(el => { el.style.cssText = 'margin:0 0 14px;padding-left:20px;display:flex;flex-direction:column;gap:6px;'; });
    detail.querySelectorAll('.help-content strong').forEach(el => { el.style.cssText = 'color:var(--ink-1,#1C1A17);font-weight:600;'; });
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await requireAuth();
    await renderNavbar('help');

    const container = document.getElementById('help-container');
    if (!container) return;

    container.innerHTML = `
        <div style="display:flex;gap:0;min-height:calc(100vh - 40px);">
            <aside id="help-toc" style="
                width:270px;flex-shrink:0;
                background:var(--surface,#fff);
                border-right:1px solid var(--sidebar-border,#EFEAE0);
                padding:24px 0;
                position:sticky;top:0;height:100vh;overflow-y:auto;
            ">
                <div style="padding:0 18px 16px;border-bottom:1px solid var(--sidebar-border,#EFEAE0);margin-bottom:12px;">
                    <div style="font-family:Verdana, Geneva, sans-serif;font-size:20px;font-weight:500;color:var(--ink-1,#1C1A17);line-height:1.2;">Kullanım Kılavuzu</div>
                    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3,#968B7A);margin-top:3px;">Export Suite — Tüm Sayfalar</div>
                </div>
                <nav style="display:flex;flex-direction:column;gap:1px;padding:0 10px;">
                    ${pages.map((p, i) => `
                        <button class="toc-item" data-index="${i}" onclick="showPage(${i})" style="
                            display:flex;align-items:center;gap:10px;
                            width:100%;text-align:left;
                            padding:9px 10px;border-radius:7px;
                            border:none;background:transparent;cursor:pointer;
                            font-family:Verdana, Geneva, sans-serif;font-size:13px;
                            color:var(--ink-2,#6B655B);
                            transition:background 0.15s,color 0.15s;
                        ">
                            <span style="
                                display:inline-flex;align-items:center;justify-content:center;
                                width:28px;height:28px;border-radius:6px;flex-shrink:0;
                                background:${p.color}18;color:${p.color};font-size:11px;
                            "><i class="fa-solid ${p.icon}"></i></span>
                            <span style="line-height:1.25;">
                                <span style="display:block;font-weight:500;">${p.label}</span>
                                <span style="font-size:11px;color:var(--ink-3,#968B7A);">${p.short}</span>
                            </span>
                        </button>
                    `).join('')}
                </nav>
            </aside>
            <main id="help-detail" style="flex:1;padding:40px 15px 40px 15px;overflow-y:auto;"></main>
        </div>
    `;

    showPage(0);
});
