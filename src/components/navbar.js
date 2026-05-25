import { supabase } from '../utils/supabaseClient.js';

const APP_VERSION = 'V: 1.0.27';

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

    const tabs = [
        { id: 'dashboard',    label: 'Dashboard',     icon: 'fa-chart-pie',     href: 'index.html' },
        { id: 'orders',       label: 'Siparişler',     icon: 'fa-boxes-stacked', href: 'orders.html' },
        { id: 'quotations',   label: 'Teklifler',       icon: 'fa-file-contract', href: 'quotations.html' },
        { id: 'customers',    label: 'Müşteriler',     icon: 'fa-users',         href: 'customers.html' },
        { id: 'prices',       label: 'Fiyat Robotu',   icon: 'fa-calculator',    href: 'prices.html' },
        { id: 'credit-notes', label: 'Credit Notes',   icon: 'fa-file-invoice',  href: 'credit-notes.html' },
        { id: 'products',     label: 'Ürün Kartları',  icon: 'fa-box',           href: 'products.html' },
        { id: 'order-timeline', label: 'Takip Takvimi', icon: 'fa-calendar-check', href: 'order-timeline.html' },
        { id: 'profitability', label: 'Karlılık Analizi', icon: 'fa-chart-line', href: 'profitability.html' },
        { id: 'complaints',   label: 'Şikayet Panosu',  icon: 'fa-triangle-exclamation', href: 'complaints.html' },
        { id: 'payments',     label: 'Ödeme Takibi',    icon: 'fa-circle-dollar-to-slot', href: 'payments.html' },
        { id: 'shipments',    label: 'Sevkiyat',         icon: 'fa-ship',                  href: 'shipments.html' },
        { id: 'customer-score', label: 'Müşteri Skoru', icon: 'fa-ranking-star', href: 'customer-score.html' },
        { id: 'product-analysis', label: 'Ürün Analizi', icon: 'fa-boxes-stacked', href: 'product-analysis.html' },
    ];

    const menuItems = tabs.map(tab => {
        const isActive = tab.id === activeTab;
        return `
            <a href="${tab.href}"
               class="flex items-center gap-2.5 px-3 py-2 text-sm transition-all duration-150 ${isActive ? 'nav-active' : ''}"
               style="border-radius:6px;">
                <i class="fa-solid ${tab.icon}" style="width:14px;text-align:center;font-size:11px;"></i>
                ${tab.label}
            </a>`;
    }).join('');

    const globeSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`;

    /* Mevcut tema */
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
            <div style="padding:20px 14px 0;">
                <!-- Marka -->
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;padding:0 4px;">
                    <div style="width:32px;height:32px;border-radius:7px;background:var(--ink-1,#1C1A17);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.25s;">
                        ${globeSvg}
                    </div>
                    <div>
                        <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:500;color:var(--ink-1,#1C1A17);line-height:1.1;letter-spacing:-0.01em;transition:color 0.2s;">Export Suite</div>
                        <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-3,#968B7A);font-family:'DM Sans',sans-serif;font-weight:500;transition:color 0.2s;">İhracat Yönetimi</div>
                    </div>
                </div>
                <!-- Nav -->
                <nav style="display:flex;flex-direction:column;gap:2px;">
                    ${menuItems}
                </nav>
            </div>

            <!-- Alt kısım -->
            <div style="padding:14px;border-top:1px solid var(--sidebar-border,#EFEAE0);background:var(--surface-2,#FBF8F1);transition:background 0.25s,border-color 0.25s;">
                <div style="font-size:11px;color:var(--ink-2,#6B655B);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color 0.2s;">
                    <i class="fa-solid fa-user" style="font-size:9px;margin-right:4px;color:var(--ink-3,#968B7A);"></i>${userEmail}
                </div>
                <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3,#968B7A);font-family:'DM Sans',sans-serif;margin-bottom:10px;transition:color 0.2s;">${APP_VERSION}</div>

                <!-- Tema Toggle -->
                <button id="btn-theme-sidebar"
                    style="width:100%;height:32px;border-radius:6px;border:1px solid var(--border,#E4DDCE);background:var(--surface,#fff);color:var(--ink-2,#6B655B);font-size:11px;font-family:'DM Sans',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:6px;transition:background 0.15s,border-color 0.25s,color 0.2s;">
                    <i class="fa-solid ${themeIcon}" style="font-size:11px;"></i>
                    <span>${themeLabel}</span>
                </button>

                <!-- Çıkış -->
                <button id="btn-logout"
                    style="width:100%;height:32px;border-radius:6px;border:1px solid var(--border,#E4DDCE);background:transparent;color:var(--danger,#9F3D3D);font-size:11px;font-family:'DM Sans',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background 0.15s,color 0.2s;">
                    <i class="fa-solid fa-right-from-bracket" style="font-size:11px;"></i>
                    Çıkış Yap
                </button>
            </div>
        </aside>
    `;

    /* Logout */
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });

    /* Tema toggle */
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
