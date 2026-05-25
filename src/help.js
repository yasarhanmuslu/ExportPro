import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';

await requireAuth();
await renderNavbar('help');

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
                <li><strong>KPI Kartları:</strong> Toplam sipariş sayısı, açık teklifler, tahsilat durumu ve aktif müşteri sayısı.</li>
                <li><strong>Aylık Gelir Grafiği:</strong> Geçmiş aylara ait gelir trendini görsel olarak izleyin.</li>
                <li><strong>Döviz Kuru Bandı:</strong> Güncel USD/TRY ve EUR/TRY kurları canlı olarak güncellenir.</li>
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
        label: 'Karlılık Analizi',
        icon: 'fa-chart-line',
        href: 'profitability.html',
        color: '#1A6B5A',
        short: 'Ürün ve müşteri bazlı kâr analizi',
        desc: `
            <p>Sipariş, ürün ve müşteri bazında gerçek kârlılığı hesaplayıp görselleştirdiğiniz analiz sayfasıdır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Kâr Marjı Tablosu:</strong> Her ürün veya müşteri için gelir, maliyet ve net kâr satır satır listelenir.</li>
                <li><strong>Grafik Görünümü:</strong> Kârlılığı çubuk veya çizgi grafikleriyle karşılaştırın.</li>
                <li><strong>Tarih Filtresi:</strong> Belirli dönem aralıklarını seçerek dönemsel kârlılık analizi yapın.</li>
                <li><strong>Döviz Bazlı Hesaplama:</strong> Tüm hesaplamalar seçili para birimine göre yeniden hesaplanır.</li>
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
        short: 'Alacak ve ödeme takvimleri',
        desc: `
            <p>Müşterilerden beklenen ödemeleri ve gerçekleşen tahsilatları takip ettiğiniz finansal sayfadır.</p>
            <h4>Temel Özellikler</h4>
            <ul>
                <li><strong>Beklenen Ödemeler:</strong> Vade tarihine göre sıralanmış tahsilat takvimi.</li>
                <li><strong>Gecikmiş Ödemeler:</strong> Vadesi geçen alacaklar ayrı renk ve uyarıyla gösterilir.</li>
                <li><strong>Tahsilat Kaydı:</strong> Gelen ödemeleri sisteme işleyerek bakiyeleri güncelleyin.</li>
                <li><strong>Özet Grafikler:</strong> Aylık tahsilat vs. beklenti grafiğiyle nakit akışını izleyin.</li>
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

// ── Sayfa render ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('help-container');
    if (!container) return;

    // İçindekiler + detay paneli render
    container.innerHTML = `
        <div id="help-layout" style="display:flex;gap:0;min-height:calc(100vh - 40px);">

            <!-- Sol panel: İçindekiler -->
            <aside id="help-toc" style="
                width:270px;flex-shrink:0;
                background:var(--surface,#fff);
                border-right:1px solid var(--sidebar-border,#EFEAE0);
                padding:24px 0;
                position:sticky;top:0;height:calc(100vh);overflow-y:auto;
            ">
                <div style="padding:0 18px 16px;border-bottom:1px solid var(--sidebar-border,#EFEAE0);margin-bottom:12px;">
                    <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:500;color:var(--ink-1,#1C1A17);line-height:1.2;">Kullanım Kılavuzu</div>
                    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3,#968B7A);margin-top:3px;">Export Suite — Tüm Sayfalar</div>
                </div>
                <nav id="toc-nav" style="display:flex;flex-direction:column;gap:1px;padding:0 10px;">
                    ${pages.map((p, i) => `
                        <button
                            class="toc-item"
                            data-index="${i}"
                            onclick="showPage(${i})"
                            style="
                                display:flex;align-items:center;gap:10px;
                                width:100%;text-align:left;
                                padding:9px 10px;border-radius:7px;
                                border:none;background:transparent;cursor:pointer;
                                font-family:'DM Sans',sans-serif;font-size:13px;
                                color:var(--ink-2,#6B655B);
                                transition:background 0.15s,color 0.15s;
                            "
                        >
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

            <!-- Sağ panel: Detay -->
            <main id="help-detail" style="flex:1;padding:40px 48px;overflow-y:auto;"></main>
        </div>
    `;

    // İlk sayfayı göster
    showPage(0);
});

// Global: toc item tıklandığında sayfayı göster
window.showPage = function(index) {
    const p = pages[index];

    // Aktif sınıf güncelle
    document.querySelectorAll('.toc-item').forEach((el, i) => {
        el.style.background = i === index ? `${pages[i].color}12` : 'transparent';
        el.style.color = i === index ? pages[i].color : 'var(--ink-2,#6B655B)';
        el.style.fontWeight = i === index ? '600' : 'normal';
    });

    // Detay panelini güncelle
    const detail = document.getElementById('help-detail');
    detail.innerHTML = `
        <div style="max-width:720px;">
            <!-- Başlık -->
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px;">
                <div style="
                    width:52px;height:52px;border-radius:12px;
                    background:${p.color}15;color:${p.color};
                    display:flex;align-items:center;justify-content:center;
                    font-size:20px;flex-shrink:0;
                "><i class="fa-solid ${p.icon}"></i></div>
                <div>
                    <h2 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;font-weight:500;color:var(--ink-1,#1C1A17);margin:0 0 4px;">${p.label}</h2>
                    <p style="margin:0;font-size:13px;color:var(--ink-3,#968B7A);">${p.short}</p>
                </div>
            </div>

            <!-- Açıklama içeriği -->
            <div class="help-content" style="
                font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.75;
                color:var(--ink-2,#6B655B);
            ">
                ${p.desc}
            </div>

            <!-- Sayfaya Git düğmesi -->
            <div style="margin-top:32px;">
                <a href="${p.href}" style="
                    display:inline-flex;align-items:center;gap:8px;
                    padding:10px 20px;border-radius:8px;
                    background:${p.color};color:#fff;
                    font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;
                    text-decoration:none;
                    transition:opacity 0.15s;
                " onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                    <i class="fa-solid fa-arrow-right" style="font-size:11px;"></i>
                    ${p.label} sayfasını aç
                </a>
            </div>
        </div>
    `;

    // Yardım içerik stilleri
    detail.querySelectorAll('.help-content h4').forEach(h => {
        h.style.cssText = `font-family:'DM Sans',sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${p.color};font-weight:600;margin:24px 0 10px;`;
    });
    detail.querySelectorAll('.help-content p').forEach(el => {
        el.style.cssText = 'margin:0 0 14px;';
    });
    detail.querySelectorAll('.help-content ul').forEach(el => {
        el.style.cssText = 'margin:0 0 14px;padding-left:20px;display:flex;flex-direction:column;gap:6px;';
    });
    detail.querySelectorAll('.help-content li').forEach(el => {
        el.style.cssText = 'line-height:1.6;';
    });
    detail.querySelectorAll('.help-content strong').forEach(el => {
        el.style.cssText = `color:var(--ink-1,#1C1A17);font-weight:600;`;
    });
};
