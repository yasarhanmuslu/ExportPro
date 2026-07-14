import { supabase } from './supabaseClient.js';
import { showAlertDialog } from './dialogs.js';

// Yönetici panelinde yönetilen modüller (dashboard hariç - o her zaman erişilebilir).
// id değerleri navbar.js MENU ve sayfa .js dosyalarındaki moduleId'lerle birebir eşleşir.
export const MODULES = [
    { id: 'order-timeline',   label: 'Takip Takvimi',           href: 'order-timeline.html' },
    { id: 'customers',        label: 'Müşteri Kartları',        href: 'customers.html' },
    { id: 'products',         label: 'Ürün Kartları',           href: 'products.html' },
    { id: 'pallet-defs',      label: 'Palet Tanımları',         href: 'pallet-definitions.html' },
    { id: 'orders',           label: 'Siparişler',              href: 'orders.html' },
    { id: 'quotations',       label: 'Teklifler',               href: 'quotations.html' },
    { id: 'credit-notes',     label: 'Credit Notes',            href: 'credit-notes.html' },
    { id: 'prices',           label: 'Fiyat Robotu',            href: 'prices.html' },
    { id: 'profitability',    label: 'Karlılık Analizi',        href: 'profitability.html' },
    { id: 'complaints',       label: 'Şikayet Panosu',          href: 'complaints.html' },
    { id: 'payments',         label: 'Ödeme Takibi',            href: 'payments.html' },
    { id: 'customer-score',   label: 'Müşteri Skoru',           href: 'customer-score.html' },
    { id: 'product-analysis', label: 'Ürün Analizi',            href: 'product-analysis.html' },
    { id: 'market-analysis',  label: 'Pazar Analizi',           href: 'market-analysis.html' },
    { id: 'loading-planner',  label: 'Yükleme Planlayıcı',      href: 'loading-planner.html' },
    { id: 'shipments',        label: 'Sevkiyatlar',             href: 'shipments.html',        note: 'menüde yok' },
    { id: 'client-prices',    label: 'Müşteri Fiyatları',       href: 'client-prices.html',    note: 'menüde yok' },
];
// Not: presentation.html kimlik doğrulaması/navbar olmayan bağımsız bir tanıtım
// sayfasıdır (requireAuth/renderNavbar/supabase sorgusu hiç kullanmıyor) - yönetici
// panelinin ve modül izinlerinin kapsamı dışında tutuldu.

let cachedCtx = null;

// requireAuth()'tan sonra çağrılır. app_users satırını self-upsert eder,
// kendi module_permissions kayıtlarını çeker ve sayfa ömrü boyunca cache'ler.
export async function getAccessContext() {
    if (cachedCtx) return cachedCtx;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const user = session.user;

    const { data: existing } = await supabase
        .from('app_users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    let role = 'user';
    if (existing) {
        role = existing.role;
        await supabase.from('app_users')
            .update({ last_seen_at: new Date().toISOString(), email: user.email })
            .eq('id', user.id);
    } else {
        await supabase.from('app_users').insert([{ id: user.id, email: user.email }]);
    }

    const permissions = new Map();
    let ownerId = role === 'owner' ? user.id : null;
    if (role !== 'owner') {
        const { data: perms } = await supabase
            .from('module_permissions')
            .select('module_id, access_level')
            .eq('user_id', user.id);
        (perms || []).forEach(p => permissions.set(p.module_id, p.access_level));

        const { data: owner } = await supabase
            .from('app_users')
            .select('id')
            .eq('role', 'owner')
            .limit(1)
            .maybeSingle();
        ownerId = owner ? owner.id : user.id;
    }

    cachedCtx = { userId: user.id, ownerId, email: user.email, role, permissions };
    return cachedCtx;
}

export function isOwner(ctx) {
    return !!ctx && ctx.role === 'owner';
}

export function accessLevel(ctx, moduleId) {
    if (isOwner(ctx)) return 'edit';
    return (ctx && ctx.permissions.get(moduleId)) || 'none';
}

export function canView(ctx, moduleId) {
    return accessLevel(ctx, moduleId) !== 'none';
}

export function canEdit(ctx, moduleId) {
    return accessLevel(ctx, moduleId) === 'edit';
}

// Sayfanın en başında çağrılır. Yetki yoksa uyarı gösterip dashboard'a yönlendirir.
// Not: 'dashboard' moduleId'i için bu fonksiyon hiç çağrılmamalı (her zaman erişilebilir),
// aksi halde yetkisiz kullanıcı index.html <-> index.html arasında sonsuz döngüye girer.
export async function guardModuleAccess(ctx, moduleId) {
    if (canView(ctx, moduleId)) return true;
    await showAlertDialog('Bu modüle erişim yetkiniz yok. Yetki için yöneticinizle iletişime geçin.', {
        title: 'Erişim Engellendi',
        variant: 'danger',
    });
    window.location.href = 'index.html';
    return false;
}

// Düzenleme yetkisi yoksa [data-requires-edit] ile işaretlenmiş tüm elemanları kilitler.
export function applyEditLock(ctx, moduleId) {
    if (canEdit(ctx, moduleId)) return;
    document.querySelectorAll('[data-requires-edit]').forEach(el => {
        el.disabled = true;
        el.setAttribute('title', 'Bu modülde düzenleme yetkiniz yok');
        el.style.opacity = '0.5';
        el.style.cursor = 'not-allowed';
        el.style.pointerEvents = 'none';
    });
}
