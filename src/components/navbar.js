import { supabase } from '../utils/supabaseClient.js';

const APP_VERSION = 'V: 1.0.16';

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
        { id: 'dashboard',    label: 'Dashboard',      icon: 'fa-chart-pie',     href: 'index.html' },
        { id: 'orders',       label: 'Siparişler',      icon: 'fa-boxes-stacked', href: 'orders.html' },
        { id: 'customers',    label: 'Müşteriler',      icon: 'fa-users',         href: 'customers.html' },
        { id: 'prices',       label: 'Fiyat Robotu',    icon: 'fa-calculator',    href: 'prices.html' },
        { id: 'credit-notes', label: 'Credit Notes',    icon: 'fa-file-invoice',  href: 'credit-notes.html' },
        { id: 'products',     label: 'Ürün Kartları',   icon: 'fa-box',           href: 'products.html' },
    ];

    const menuItems = tabs.map(tab => {
        const isActive = tab.id === activeTab;
        return `
            <a href="${tab.href}"
               class="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-150 ${isActive ? 'nav-active' : ''}"
               style="border-radius:6px;">
                <i class="fa-solid ${tab.icon}" style="width:14px;text-align:center;font-size:11px;"></i>
                ${tab.label}
            </a>`;
    }).join('');

    // Meridyen-küre SVG ikonu
    const globeSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`;

    navbarTarget.innerHTML = `
        <aside id="main-sidebar" style="position:fixed;inset-block:0;left:0;width:230px;display:flex;flex-direction:column;justify-content:space-between;z-index:50;border-right:1px solid #EFEAE0;background:#fff;">
            <div style="padding:20px 14px 0;">
                <!-- Marka bloğu -->
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;padding:0 4px;">
                    <div style="width:32px;height:32px;border-radius:7px;background:#1C1A17;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        ${globeSvg}
                    </div>
                    <div>
                        <div class="brand-title" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:20px;font-weight:500;color:#1C1A17;line-height:1.1;letter-spacing:-0.01em;">Export Suite</div>
                        <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#968B7A;font-family:'DM Sans',sans-serif;font-weight:500;">İhracat Yönetimi</div>
                    </div>
                </div>
                <!-- Nav -->
                <nav style="display:flex;flex-direction:column;gap:2px;">
                    ${menuItems}
                </nav>
            </div>
            <!-- Alt kısım -->
            <div style="padding:14px;border-top:1px solid #EFEAE0;background:#FBF8F1;">
                <div style="font-size:12px;color:#6B655B;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    <i class="fa-solid fa-user" style="font-size:10px;margin-right:4px;color:#968B7A;"></i>${userEmail}
                </div>
                <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#968B7A;font-family:'DM Sans',sans-serif;margin-bottom:10px;">${APP_VERSION}</div>
                <button id="btn-logout"
                    style="width:100%;height:32px;border-radius:6px;border:1px solid #E4DDCE;background:#fff;color:#9F3D3D;font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background 0.15s;"
                    onmouseover="this.style.background='#F1DDD9'"
                    onmouseout="this.style.background='#fff'"
                    title="Çıkış Yap">
                    <i class="fa-solid fa-right-from-bracket"></i> Çıkış Yap
                </button>
            </div>
        </aside>
    `;

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
}
