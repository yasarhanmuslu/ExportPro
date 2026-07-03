import { supabase } from '../utils/supabaseClient.js';

const APP_VERSION = 'V: 1.0.88';

// MENU MODELI
//   type: 'link'  -> dogrudan sayfa
//   type: 'group' -> akordeon baslik + children
//   soon: true    -> henuz yok, pasif "yakinda" rozeti
const MENU = [
    { type: 'link', id: 'dashboard',      label: 'Dashboard',           icon: 'fa-chart-pie',      href: 'index.html' },
    { type: 'link', id: 'order-timeline', label: 'Takip Takvimi',       icon: 'fa-calendar-check', href: 'order-timeline.html' },
    {
        type: 'group', id: 'grp-defs', label: 'Tanımlar', icon: 'fa-folder-tree',
        children: [
            { id: 'customers',     label: 'Müşteri Kartları', icon: 'fa-id-card', href: 'customers.html' },
            { id: 'products',      label: 'Ürün Kartları',    icon: 'fa-box',     href: 'products.html' },
            { id: 'pallet-defs',   label: 'Palet Tanımları',  icon: 'fa-pallet',  href: 'pallet-definitions.html' },
        ]
    },
    {
        type: 'group', id: 'grp-customer', label: 'Müşteri İşlemleri', icon: 'fa-users',
        children: [
            { id: 'orders',        label: 'Siparişler',              icon: 'fa-boxes-stacked', href: 'orders.html' },
            { id: 'quotations',    label: 'Teklifler',               icon: 'fa-file-contract', href: 'quotations.html' },
            { id: 'fixed-prices',  label: 'Müşteri Sabit Fiyatlar',  icon: 'fa-tags',          href: '#', soon: true },
            { id: 'credit-notes',  label: 'Credit Notes',            icon: 'fa-file-invoice',  href: 'credit-notes.html' },
        ]
    },
    { type: 'link', id: 'prices',   label: 'Fiyat Robotu',  icon: 'fa-calculator', href: 'prices.html' },
    {
        type: 'group', id: 'grp-bi', label: 'BI Raporları', icon: 'fa-chart-simple',
        children: [
            { id: 'profitability',    label: 'Karlılık Analizi', icon: 'fa-chart-line',           href: 'profitability.html' },
            { id: 'complaints',       label: 'Şikayet Panosu',   icon: 'fa-triangle-exclamation', href: 'complaints.html' },
            { id: 'payments',         label: 'Ödeme Takibi',     icon: 'fa-circle-dollar-to-slot',href: 'payments.html' },
            { id: 'customer-score',   label: 'Müşteri Skoru',    icon: 'fa-ranking-star',         href: 'customer-score.html' },
            { id: 'product-analysis', label: 'Ürün Analizi',     icon: 'fa-boxes-stacked',        href: 'product-analysis.html' },
            { id: 'market-analysis',  label: 'Pazar Analizi',    icon: 'fa-globe',                href: 'market-analysis.html' },
        ]
    },
    { type: 'link', id: 'loading-planner', label: 'Yükleme Planlayıcı', icon: 'fa-truck-ramp-box', href: 'loading-planner.html' },
];

const HELP_TAB = { id: 'help', label: 'Yardım & Kılavuz', icon: 'fa-circle-question', href: 'help.html' };

export async function renderNavbar(activeTab) {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        if (!window.location.pathname.includes('login.html')) {
            window.location.href = 'login.html';
            return;
        }
    }

    const navbarTarget = document.getElementById('navbar-target');
    if (!navbarTarget) return;

    const userEmail = session && session.user ? session.user.email : 'Giriş Yapılmadı';

    // Aktif sekmenin hangi gruba ait oldugunu bul (otomatik acik gelsin)
    let activeGroupId = null;
    for (const node of MENU) {
        if (node.type === 'group' && node.children.some(c => c.id === activeTab)) { activeGroupId = node.id; break; }
    }

    const linkRow = (tab, isChild) => {
        const isActive = tab.id === activeTab;
        const pad = isChild ? 'padding-left:34px;' : '';
        const badge = tab.soon
            ? `<span style="font-size:9px;background:var(--accent-soft,#FBEEE6);color:var(--accent,#B5651D);padding:1px 6px;border-radius:5px;margin-left:6px;font-family:Verdana,Geneva,sans-serif;">yakında</span>`
            : '';
        const href = tab.soon ? 'javascript:void(0)' : tab.href;
        return `
            <a href="${href}" data-id="${tab.id}" class="nav-row ${isActive ? 'nav-active' : ''} ${tab.soon ? 'soon' : ''}"
               style="display:flex;align-items:center;gap:10px;padding:8px 10px;${pad}font-size:${isChild ? '12.5px' : '13px'};border-radius:6px;transition:background .12s,color .2s;${tab.soon ? 'opacity:.55;cursor:default;pointer-events:none;' : ''}">
                <i class="fa-solid ${tab.icon}" style="width:14px;text-align:center;font-size:11px;"></i>
                <span>${tab.label}</span>${badge}
            </a>`;
    };

    const groupBlock = (node) => {
        const isOpen = node.id === activeGroupId;
        const childHtml = node.children.map(c => linkRow(c, true)).join('');
        return `
            <button type="button" class="nav-group-head" data-group="${node.id}"
                style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:8px 10px;font-size:13px;font-weight:600;border:none;background:transparent;color:var(--ink-1,#1C1A17);border-radius:6px;cursor:pointer;font-family:inherit;transition:background .12s,color .2s;">
                <span style="display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid ${node.icon}" style="width:14px;text-align:center;font-size:11px;"></i>${node.label}
                </span>
                <i class="fa-solid fa-chevron-down nav-chev" style="font-size:10px;transition:transform .18s;${isOpen ? 'transform:rotate(180deg);' : ''}"></i>
            </button>
            <div class="nav-group-panel" data-panel="${node.id}"
                style="overflow:hidden;max-height:0;transition:max-height .22s ease;display:flex;flex-direction:column;gap:1px;">
                ${childHtml}
            </div>`;
    };

    const menuHtml = MENU.map(node =>
        node.type === 'group' ? groupBlock(node) : linkRow(node, false)
    ).join('');

    const helpHtml = `
        <div style="height:1px;background:var(--sidebar-border,#EFEAE0);margin:6px 4px;"></div>
        ${linkRow(HELP_TAB, false)}`;

    const globeSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`;

    const currentTheme = localStorage.getItem('ep-theme') || 'light';
    const themeLabel   = currentTheme === 'dark' ? 'Açık Tema' : 'Koyu Tema';
    const themeIcon    = currentTheme === 'dark' ? 'fa-sun' : 'fa-moon';

    navbarTarget.innerHTML = `
        <aside id="main-sidebar" style="
            position:fixed; inset-block:0; left:0; width:230px;
            display:flex; flex-direction:column; justify-content:space-between;
            z-index:50;
            background: var(--sidebar-bg, #fff);
            border-right: 1px solid var(--sidebar-border, #EFEAE0);
            transition: background 0.25s, border-color 0.25s;
        ">
            <div style="padding:20px 14px 0; overflow-y:auto; flex:1;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;padding:0 4px;">
                    <div style="width:32px;height:32px;border-radius:7px;background:var(--ink-1,#1C1A17);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.25s;">
                        ${globeSvg}
                    </div>
                    <div>
                        <div style="font-family:Verdana, Geneva, sans-serif;font-size:20px;font-weight:500;color:var(--ink-1,#1C1A17);line-height:1.1;letter-spacing:-0.01em;transition:color 0.2s;">Export Suite</div>
                        <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-3,#968B7A);font-family:Verdana, Geneva, sans-serif;font-weight:500;transition:color 0.2s;">İhracat Yönetimi</div>
                    </div>
                </div>
                <nav style="display:flex;flex-direction:column;gap:2px;">
                    ${menuHtml}
                    ${helpHtml}
                </nav>
            </div>

            <div style="padding:14px;border-top:1px solid var(--sidebar-border,#EFEAE0);background:var(--surface-2,#FBF8F1);transition:background 0.25s,border-color 0.25s;flex-shrink:0;">
                <div style="font-size:11px;color:var(--ink-2,#6B655B);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color 0.2s;">
                    <i class="fa-solid fa-user" style="font-size:9px;margin-right:4px;color:var(--ink-3,#968B7A);"></i>${userEmail}
                </div>
                <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3,#968B7A);font-family:Verdana, Geneva, sans-serif;margin-bottom:10px;transition:color 0.2s;">${APP_VERSION}</div>

                <button id="btn-theme-sidebar"
                    style="width:100%;height:32px;border-radius:6px;border:1px solid var(--border,#E4DDCE);background:var(--surface,#fff);color:var(--ink-2,#6B655B);font-size:11px;font-family:Verdana, Geneva, sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:6px;transition:background 0.15s,border-color 0.25s,color 0.2s;">
                    <i class="fa-solid ${themeIcon}" style="font-size:11px;"></i>
                    <span>${themeLabel}</span>
                </button>

                <button id="btn-logout"
                    style="width:100%;height:32px;border-radius:6px;border:1px solid var(--border,#E4DDCE);background:transparent;color:var(--danger,#9F3D3D);font-size:11px;font-family:Verdana, Geneva, sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background 0.15s,color 0.2s;">
                    <i class="fa-solid fa-right-from-bracket" style="font-size:11px;"></i>
                    Çıkış Yap
                </button>
            </div>
        </aside>
    `;

    // Akordeon: ayni anda tek grup acik
    const panels = navbarTarget.querySelectorAll('.nav-group-panel');
    const setOpen = (panel, open) => {
        const head = navbarTarget.querySelector(`.nav-group-head[data-group="${panel.dataset.panel}"]`);
        const chev = head ? head.querySelector('.nav-chev') : null;
        panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '0';
        if (chev) chev.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
    };

    navbarTarget.querySelectorAll('.nav-group-head').forEach(head => {
        head.addEventListener('click', () => {
            const id = head.dataset.group;
            const target = navbarTarget.querySelector(`.nav-group-panel[data-panel="${id}"]`);
            const willOpen = target.style.maxHeight === '0px' || target.style.maxHeight === '';
            panels.forEach(p => setOpen(p, p === target ? willOpen : false));
        });
    });

    panels.forEach(p => setOpen(p, p.dataset.panel === activeGroupId));

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });

    document.getElementById('btn-theme-sidebar')?.addEventListener('click', () => {
        const current = localStorage.getItem('ep-theme') || 'light';
        const next    = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem('ep-theme', next);
        document.documentElement.classList.remove('dark', 'light');
        document.documentElement.classList.add(next);

        const btn = document.getElementById('btn-theme-sidebar');
        if (btn) {
            const icon  = btn.querySelector('i');
            const label = btn.querySelector('span');
            if (next === 'dark') {
                icon.className  = 'fa-solid fa-sun';
                label.textContent = 'Açık Tema';
            } else {
                icon.className  = 'fa-solid fa-moon';
                label.textContent = 'Koyu Tema';
            }
        }
    });
}
