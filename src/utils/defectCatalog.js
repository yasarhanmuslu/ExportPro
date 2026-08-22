// Seramik sağlık gereçleri hata (kalite kusuru) kataloğu.
//
// Tanımlar kalite kontrol biriminin kullandığı ifadelerdir; müşteriye giden
// Credit Note yazışmalarında da bu adlandırma esas alınıyor. Bir kalemin hangi
// hata yüzünden işleme alındığı credit_note_items.defect_category alanında bu
// listedeki `id` ile saklanır (serbest metin değil — Şikayet Panosu'ndaki
// kategori kırılımı buna dayanıyor).
//
// Örnek görseller Supabase Storage'daki `hata-gorselleri` bucket'ında,
// `defects/<id>.<uzantı>` yolunda tutulur. Görsel henüz yüklenmemiş kategoriler
// arayüzde "görsel bekleniyor" rozetiyle görünür — katalog eksik görselle de
// çalışır, tanım her zaman okunabilir.

export const DEFECT_IMAGE_BUCKET = 'hata-gorselleri';

export const DEFECTS = [
    {
        id: 'dokum-catlagi',
        name: 'Döküm Çatlağı',
        en: 'Casting Crack',
        definition: 'Sır ile örtülmemiş açıklık.',
        group: 'Bünye',
    },
    {
        id: 'pinhol',
        name: 'Pinhol',
        en: 'Pinhole',
        definition: 'Ürünün bünyesinden gaz açılması sonucu sır üstünde oluşan deliklenmeler.',
        group: 'Sır',
    },
    {
        id: 'hava',
        name: 'Hava',
        en: 'Air Bubble',
        definition: 'Sırlı yüzeylerde olan küçük kabarcıklar.',
        group: 'Sır',
    },
    {
        id: 'toplama',
        name: 'Toplama',
        en: 'Glaze Crawling',
        definition: 'Sır akması veya pistol hatası sonucu sır yüzeyinde oluşan açılmalar.',
        group: 'Sır',
    },
    {
        id: 'ince-sir',
        name: 'İnce Sır',
        en: 'Thin Glaze',
        definition: 'Renk farklılığı oluşturan, dalgalı ve zayıf sır yüzeyi.',
        group: 'Sır',
    },
    {
        id: 'kalin-sir',
        name: 'Kalın Sır (Sır Akması)',
        en: 'Thick Glaze',
        definition: 'Renk farklılığı oluşturan, daha çok sır toplanmış yüzey.',
        group: 'Sır',
    },
    {
        id: 'portakal-kabugu',
        name: 'Portakal Kabuğu',
        en: 'Orange Peel',
        definition: 'Bir çok pinholden oluşan, tam olgunlaşmamış bölge. Renk farklılığı oluşturan bir yüzeyi temsil eder.',
        group: 'Sır',
    },
    {
        id: 'kirik',
        name: 'Kırık',
        en: 'Broken',
        definition: 'Darbe sonucu kırılmış yüzey.',
        group: 'Kırılma',
    },
    {
        id: 'sok',
        name: 'Şok',
        en: 'Thermal Shock',
        definition: 'Ani sıcaklık değişimlerinden kaynaklanan kılcal kırılma problemidir. (Düz çizgi oluşur.)',
        group: 'Kırılma',
    },
    {
        id: 'harkort',
        name: 'Harkort',
        en: 'Harkort',
        definition: 'Çamurun su emmesinden kaynaklı zamanla meydana gelen kılcal kırılma problemidir. (Örümcek ağına benzer)',
        group: 'Kırılma',
    },
    {
        id: 'pec',
        name: 'Pec',
        en: 'Deformation',
        definition: 'Deformasyon şekil bozukluğu.',
        group: 'Bünye',
    },
    {
        id: 'taban-silme',
        name: 'Taban Silme',
        en: 'Base Grinding',
        definition: 'Ürünün tabanının gereğinden fazla taşlanması sonucu meydana gelen hata.',
        group: 'İşçilik',
    },
];

const DEFECT_BY_ID = new Map(DEFECTS.map(d => [d.id, d]));

export function getDefect(id) {
    return DEFECT_BY_ID.get((id || '').trim()) || null;
}

export function defectLabel(id) {
    const d = getDefect(id);
    return d ? d.name : (id || '—');
}

// Serbest metinden (eski kayıtlar, içe aktarılan açıklamalar) kategori tahmini.
// Yalnızca ad ya da İngilizce karşılık birebir/kısmi geçiyorsa eşleştirir;
// emin olunamayan metin null döner — yanlış kategori atamaktansa boş bırakılır.
export function matchDefect(text) {
    const s = (text || '').toLocaleLowerCase('tr-TR').trim();
    if (!s) return null;
    for (const d of DEFECTS) {
        if (s === d.id) return d.id;
        if (s.includes(d.name.toLocaleLowerCase('tr-TR'))) return d.id;
        if (d.en && s.includes(d.en.toLowerCase())) return d.id;
    }
    return null;
}

// Katalog görselinin storage yolu. Uzantı bilinmediğinden yükleme sırasında
// gerçek uzantı kullanılır; okuma tarafı bucket listesinden eşleştirir.
export function defectImagePrefix(id) {
    return `defects/${id}`;
}
