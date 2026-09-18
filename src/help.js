import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

// ── Sayfa açıklamaları ────────────────────────────────────────────────────────
const pages = [
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
                <li><strong>Finans kartları:</strong> Toplam Ciro, Tahsil Edilen, Vadeli Bakiye, Gecikmiş Borç (ayrıntısı aşağıda).</li>
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
            <p>Sol menüden doğrudan ilgili sayfaya geçmek için KPI kartlarına veya grafiklere tıklayabilirsiniz. Döviz kurları otomatik olarak güncellenir; piyasa açıkken yeşil, kapalıyken gri nokta görürsünüz.</p>
        `
    },
    {
        id: 'orders',
        label: 'Siparişler',
        icon: 'fa-boxes-stacked',
        href: 'orders.html',
        color: '#3B5998',
        short: 'Sipariş takibi ve yönetimi',
        desc: `
            <p>Tüm ihracat siparişlerinizi oluşturabileceğiniz, düzenleyebileceğiniz ve takip edebileceğiniz merkezi sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Sipariş Listesi:</strong> Müşteri, ürün, miktar, tutar, durum ve tarih bilgileriyle tüm siparişler.</li>
                <li><strong>Durum Filtreleme:</strong> Bekleyen, onaylanan, sevk edilen ve iptal edilen siparişleri filtreleyin.</li>
                <li><strong>Yeni Sipariş:</strong> "+ Yeni Sipariş" düğmesiyle form açılır; müşteri, ürün ve miktar girin.</li>
                <li><strong>Düzenleme / Silme:</strong> Satıra tıklayarak sipariş detaylarını güncelleyin veya silin.</li>
            </ul>
            <h4>Nasıl Kullanılır?</h4>
            <p>Üst arama çubuğunu kullanarak müşteri adı veya sipariş numarasına göre hızlıca arama yapabilirsiniz. Sütun başlıklarına tıklayarak sıralama değiştirebilirsiniz.</p>
        `
    },
    {
        id: 'quotations',
        label: 'Teklifler',
        icon: 'fa-file-contract',
        href: 'quotations.html',
        color: '#7C4F2A',
        short: 'Müşteri tekliflerini hazırlayın ve yönetin',
        desc: `
            <p>Müşterilerinize gönderilecek fiyat tekliflerini hazırlayıp kayıt altına aldığınız sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Teklif Listesi:</strong> Tüm teklifleri müşteri, tutar, para birimi ve duruma göre görüntüleyin.</li>
                <li><strong>Yeni Teklif:</strong> Müşteri seçimi, ürün ekleme ve fiyat girişiyle hızlı teklif oluşturun.</li>
                <li><strong>Durum Takibi:</strong> Taslak, gönderildi, kabul edildi, reddedildi gibi aşamaları takip edin.</li>
                <li><strong>Siparişe Dönüştürme:</strong> Kabul edilen teklifler tek tıkla siparişe dönüştürülebilir.</li>
            </ul>
            <h4>İpucu</h4>
            <p>Teklif listesinde "Kabul" durumundaki kayıtlar için "Siparişe Dönüştür" seçeneği belirir; bu sayede veri tekrarı olmadan siparişler sayfasına aktarım yapılır.</p>
        `
    },
    {
        id: 'customers',
        label: 'Müşteriler',
        icon: 'fa-users',
        href: 'customers.html',
        color: '#1A6B5A',
        short: 'Müşteri kayıtları ve iletişim bilgileri',
        desc: `
            <p>Tüm müşteri firmaların kayıtlarını tuttuğunuz ve yönettiğiniz sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Müşteri Listesi:</strong> Firma adı, ülke, sektör ve iletişim bilgileriyle tam liste.</li>
                <li><strong>Yeni Müşteri:</strong> Firma adı, adres, vergi no ve iletişim bilgilerini ekleyin.</li>
                <li><strong>Detay Sayfası:</strong> Müşteriye ait tüm siparişleri, teklifleri ve ödemeleri tek pencereden görün.</li>
                <li><strong>Arama ve Filtreleme:</strong> Ülke veya sektöre göre hızlı filtreleme.</li>
            </ul>
        `
    },
    {
        id: 'prices',
        label: 'Fiyat Robotu',
        icon: 'fa-calculator',
        href: 'prices.html',
        color: '#8B5E2A',
        short: 'Otomatik fiyat hesaplama ve maliyet analizi',
        desc: `
            <p>Ürün bazında maliyet, kur ve kâr marjı hesaplamalarını otomatikleştiren akıllı fiyatlama aracıdır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Maliyet Girişi:</strong> Ham madde, işçilik ve genel gider bileşenlerini girin.</li>
                <li><strong>Kur Entegrasyonu:</strong> Güncel döviz kurlarıyla TRY bazlı maliyetleri otomatik hesaplar.</li>
                <li><strong>Kâr Marjı Ayarı:</strong> İstediğiniz marjı yüzde olarak girerek önerilen satış fiyatını görün.</li>
                <li><strong>Kaydetme:</strong> Hesaplanan fiyatları ürün kartına veya teklife aktarın.</li>
            </ul>
            <h4>Nasıl Kullanılır?</h4>
            <p>Ürün seçin → bileşen maliyetlerini girin → hedef kâr marjını belirleyin → "Hesapla" düğmesine basın. Sonucu doğrudan teklif oluştururken kullanabilirsiniz.</p>
        `
    },
    {
        id: 'credit-notes',
        label: 'Credit Notes',
        icon: 'fa-file-invoice',
        href: 'credit-notes.html',
        color: '#9F3D3D',
        short: 'İade ve alacak notlarını yönetin',
        desc: `
            <p>Müşterilere kesilen iade belgelerini (credit note) takip ettiğiniz sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Credit Note Listesi:</strong> Tüm alacak notlarını tarih, müşteri ve tutara göre listeleyin.</li>
                <li><strong>Yeni Not Oluşturma:</strong> İlgili sipariş veya fatura seçilerek otomatik tutar hesaplaması yapılır.</li>
                <li><strong>Durum Takibi:</strong> Bekleyen ve takas edilmiş credit note'ları ayrı ayrı görüntüleyin.</li>
            </ul>
        `
    },
    {
        id: 'products',
        label: 'Ürün Kartları',
        icon: 'fa-box',
        href: 'products.html',
        color: '#2D4A3E',
        short: 'Ürün kataloğu ve teknik bilgiler',
        desc: `
            <p>Firmanızın ihraç ettiği tüm ürünlerin teknik ve ticari bilgilerini tuttuğunuz ürün kataloğudur.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Ürün Listesi:</strong> SKU, ürün adı, birim, birim fiyat ve HS kodu bilgileriyle tam katalog.</li>
                <li><strong>Ürün Ekleme:</strong> Yeni ürün formunda teknik özellikler, görseller ve barkod bilgisi girin.</li>
                <li><strong>Arama:</strong> Ürün adı veya SKU ile anlık arama yapın.</li>
                <li><strong>Kart Görünümü:</strong> Ürünleri görsel kart formatında veya liste formatında görüntüleyin.</li>
            </ul>
        `
    },
    {
        id: 'order-timeline',
        label: 'Takip Takvimi',
        icon: 'fa-calendar-check',
        href: 'order-timeline.html',
        color: '#3B6E8C',
        short: 'Siparişlerin zaman çizelgesinde takibi',
        desc: `
            <p>Siparişlerin üretim, sevkiyat ve teslimat aşamalarını takvim görünümünde izlediğiniz sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Gantt Takvimi:</strong> Her siparişin başlangıç ve bitiş tarihlerini görsel çubuklar halinde görün.</li>
                <li><strong>Aşama Renkleri:</strong> Üretim, yükleme ve teslimat aşamaları renk kodlarıyla ayrıştırılmıştır.</li>
                <li><strong>Gecikme Uyarısı:</strong> Bugünün tarihini geçen görevler kırmızıyla işaretlenir.</li>
                <li><strong>Ay Navigasyonu:</strong> İleri/geri düğmeleriyle aylara göre gezinin.</li>
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
            <p>Gerçekte ne sattığınızı ve anlaştığınız fiyatın ne kadar dışına çıkıldığını gösteren analiz sayfasıdır.
            Sipariş kalemleri (gerçek satış) ile Müşteri Sabit Fiyatlar (anlaşılan fiyat) karşılaştırılır.</p>
            <p><strong>Not:</strong> Bu sayfa kâr/marj hesaplamaz — sistemde ürün maliyeti tutulmuyor.
            Maliyet verisi girildiği gün marj bölümü buraya eklenebilir.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Gerçek Satış Performansı:</strong> Ürün bazında gerçekleşen adet ve ciro; her para birimi ayrı gruplanır, kur çevrimi yapılmaz.</li>
                <li><strong>Fiyat Sapma Raporu:</strong> Anlaşılan fiyat ile fiili ortalama satış fiyatı arasındaki fark, para etkisiyle birlikte listelenir.</li>
                <li><strong>Müşteriler Arası Tutarsızlık:</strong> Aynı ürün için farklı müşterilerle anlaşılan fiyatların aralığı.</li>
                <li><strong>Filtreler:</strong> Yıl, para birimi ve "1 adetlik satırları hariç tut" (numune / yedek parça) seçenekleri.</li>
                <li><strong>Hariç Tutulanlar:</strong> İptal edilmiş ve Bedelsiz siparişler hiçbir hesaba girmez.</li>
            </ul>
        `
    },
    {
        id: 'complaints',
        label: 'Şikayet Panosu',
        icon: 'fa-triangle-exclamation',
        href: 'complaints.html',
        color: '#9F5A2A',
        short: 'Müşteri şikayetlerini takip edin',
        desc: `
            <p>Müşterilerden gelen şikayetleri, iade taleplerini ve kalite sorunlarını kayıt altında tuttuğunuz panodur.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Şikayet Listesi:</strong> Müşteri, ürün, şikayet türü ve öncelik seviyesiyle kayıtlar.</li>
                <li><strong>Durum Yönetimi:</strong> Açık, incelemede ve kapandı durumlarına geçiş yapın.</li>
                <li><strong>Öncelik Sınıflandırması:</strong> Düşük, orta, yüksek ve kritik öncelik seviyelerini atayın.</li>
                <li><strong>Not Ekleme:</strong> Her şikayete çözüm notları ve aksiyon adımları ekleyin.</li>
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
        id: 'shipments',
        label: 'Sevkiyat',
        icon: 'fa-ship',
        href: 'shipments.html',
        color: '#1A4A6B',
        short: 'Yük ve konteyner sevkiyat takibi',
        desc: `
            <p>İhracat sevkiyatlarınızı, konteyner bilgilerini ve lojistik aşamalarını yönettiğiniz sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Sevkiyat Listesi:</strong> Konteyner no, gemi adı, yükleme ve tahmini varış tarihleriyle tam liste.</li>
                <li><strong>Aşama Takibi:</strong> Hazırlanıyor → Yüklendi → Yolda → Teslim Edildi aşamalarını güncelleyin.</li>
                <li><strong>Belge Takibi:</strong> Konşimento, sigorta ve gümrük belgelerinin durumunu işaretleyin.</li>
                <li><strong>Harita / Rota:</strong> Varış limanı bilgisiyle rota bilgisini görün.</li>
            </ul>
        `
    },
    {
        id: 'customer-score',
        label: 'Müşteri Skoru',
        icon: 'fa-ranking-star',
        href: 'customer-score.html',
        color: '#6B3A8C',
        short: 'Müşteri değerlendirme ve puanlama sistemi',
        desc: `
            <p>Müşterilerinizi sipariş hacmi, ödeme düzeni ve şikayet oranı gibi kriterlere göre otomatik puanlayan analiz sayfasıdır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Skor Tablosu:</strong> Her müşteri için toplam puan ve kategori (Altın / Gümüş / Bronz) görünümü.</li>
                <li><strong>Kriter Ağırlıkları:</strong> Puanlama kriterlerini ve ağırlıklarını özelleştirin.</li>
                <li><strong>Tarih Filtresi:</strong> Seçilen dönem için skor hesaplar; yıllık, çeyreklik karşılaştırmalar yapın.</li>
                <li><strong>Detay Modalı:</strong> Müşteriye tıklayarak kriter bazında puan dağılımını görün.</li>
            </ul>
        `
    },
    {
        id: 'product-analysis',
        label: 'Ürün Analizi',
        icon: 'fa-boxes-stacked',
        href: 'product-analysis.html',
        color: '#2D4A3E',
        short: 'Ürün performansı ve satış analizi',
        desc: `
            <p>Hangi ürünlerin ne kadar sattığını, hangi ürünlerin kârlılığını ve trend eğilimlerini analiz ettiğiniz sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Ürün Bazlı Gelir:</strong> Her ürünün toplam satış tutarını ve birim satış adedini görün.</li>
                <li><strong>En Çok Satanlar:</strong> Dönem bazında en fazla sipariş alan ürünler sıralanır.</li>
                <li><strong>Kâr Marjı:</strong> Ürün başına ortalama kâr marjı hesaplanarak gösterilir.</li>
                <li><strong>Dönem Karşılaştırması:</strong> Farklı dönemlerdeki performansı yan yana karşılaştırın.</li>
            </ul>
        `
    },
    {
        id: 'market-analysis',
        label: 'Pazar Analizi',
        icon: 'fa-globe',
        href: 'market-analysis.html',
        color: '#2A6B5A',
        short: 'Ülke ve bölge bazlı ihracat analizi',
        desc: `
            <p>İhracat yaptığınız ülkeleri ve bölgeleri analiz ederek pazar çeşitlendirme stratejinizi destekleyen sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Ülke Haritası:</strong> İhracat yaptığınız ülkeler dünya haritası üzerinde görselleştirilir.</li>
                <li><strong>Ülke Sıralaması:</strong> En fazla satış yapılan ülkeler hacim ve tutara göre sıralanır.</li>
                <li><strong>Bölge Dağılımı:</strong> AB, MENA, Asya gibi bölgelere göre satış dağılımını inceleyin.</li>
                <li><strong>Trend Analizi:</strong> Ülke bazında büyüme veya daralma eğilimlerini grafiklerle takip edin.</li>
            </ul>
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
        </div>
    `;

    detail.querySelectorAll('.help-content h4').forEach(h => {
        h.style.cssText = `font-family:Verdana, Geneva, sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${p.color};font-weight:600;margin:24px 0 10px;`;
    });
    detail.querySelectorAll('.help-content p').forEach(el => { el.style.cssText = 'margin:0 0 14px;'; });
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
