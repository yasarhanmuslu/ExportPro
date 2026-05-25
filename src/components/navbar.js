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
        { id: 'dashboard',    label: 'Dashboard',      icon: 'fa-chart-pie',        href: 'index.html' },
        { id: 'orders',       label: 'Siparişler',      icon: 'fa-boxes-stacked',    href: 'orders.html' },
        { id: 'customers',    label: 'Müşteriler',      icon: 'fa-users',            href: 'customers.html' },
        { id: 'prices',       label: 'Fiyat Robotu',    icon: 'fa-calculator',       href: 'prices.html' },
        { id: 'credit-notes', label: 'Credit Notes',    icon: 'fa-file-invoice',     href: 'credit-notes.html' },
        { id: 'products',     label: 'Ürün Kartları',   icon: 'fa-box',              href: 'products.html' },
    ];

    const menuItems = tabs.map(tab => {
        const isActive = tab.id === activeTab;
        const activeStyle = isActive
            ? 'style="background:rgba(228,90,128,0.10);color:#E45A80;border-color:rgba(228,90,128,0.25);"'
            : '';
        const activeClass = isActive
            ? 'border border-transparent'
            : 'text-slate-400 hover:bg-slate-800 hover:text-white border border-transparent';
        return `
            <a href="${tab.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${activeClass}" ${activeStyle}>
                <i class="fa-solid ${tab.icon} w-4 text-center"></i>
                ${tab.label}
            </a>`;
    }).join('');

    // Theme toggle logic
    const currentTheme = localStorage.getItem('ep-theme') || 'dark';
    const themeIcon   = currentTheme === 'dark' ? 'fa-sun text-amber-400' : 'fa-moon" style="color:#E45A80';
    const themeLabel  = currentTheme === 'dark' ? 'Light Mode' : 'Dark Mode';

    navbarTarget.innerHTML = `
        <aside id="main-sidebar" class="fixed inset-y-0 left-0 w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between z-50">
            <div class="p-5">
                <div class="flex items-center gap-3 px-2 mb-8">
                    <div style="width:32px;height:32px;border-radius:8px;background:#E45A80;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fa-solid fa-earth-americas text-sm text-white"></i>
                    </div>
                    <span class="text-lg font-bold text-white tracking-wider">EXPORT PRO</span>
                </div>
                <nav class="space-y-1">
                    ${menuItems}
                </nav>
            </div>
            <div class="p-4 border-t border-slate-800 bg-slate-950/50">
                <div class="flex items-center justify-between text-xs text-slate-400 mb-3">
                    <div class="flex flex-col gap-0.5 min-w-0">
                        <span class="truncate max-w-[140px]"><i class="fa-solid fa-user text-slate-500 mr-1"></i> ${userEmail}</span>
                        <span class="text-slate-600 text-[10px] font-mono">${APP_VERSION}</span>
                    </div>
                    <button id="btn-logout" class="text-rose-400 hover:text-rose-300 transition-colors" title="Çıkış Yap">
                        <i class="fa-solid fa-right-from-bracket"></i>
                    </button>
                </div>
                <button id="btn-theme-sidebar"
                    class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer"
                    style="background:transparent;">
                    <i class="fa-solid ${themeIcon}"></i>
                    <span>${themeLabel}</span>
                </button>
            </div>
        </aside>
    `;

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });

    document.getElementById('btn-theme-sidebar')?.addEventListener('click', () => {
        const t = localStorage.getItem('ep-theme') || 'dark';
        const n = t === 'dark' ? 'light' : 'dark';
        localStorage.setItem('ep-theme', n);
        document.documentElement.classList.remove('dark', 'light');
        document.documentElement.classList.add(n);
        const btn = document.getElementById('btn-theme-sidebar');
        if (btn) {
            if (n === 'dark') {
                btn.innerHTML = '<i class="fa-solid fa-sun text-amber-400"></i><span>Light Mode</span>';
            } else {
                btn.innerHTML = '<i class="fa-solid fa-moon" style="color:#E45A80"></i><span>Dark Mode</span>';
            }
        }
    });
}
