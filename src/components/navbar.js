import { supabase } from '../utils/supabaseClient.js';

const APP_VERSION = 'V: 1.0.14';

export async function renderNavbar(activeTab) {
    const navbarTarget = document.getElementById('navbar-target');
    if (!navbarTarget) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const userEmail = session?.user?.email ?? '';

    const tabs = [
        { id: 'dashboard',     label: 'Dashboard',      icon: 'fa-chart-pie',    href: 'index.html' },
        { id: 'orders',        label: 'Siparişler',      icon: 'fa-boxes-stacked',href: 'orders.html' },
        { id: 'customers',     label: 'Müşteriler',      icon: 'fa-users',        href: 'customers.html' },
        { id: 'prices',        label: 'Fiyat Robotu',    icon: 'fa-calculator',   href: 'prices.html' },
        { id: 'client-prices', label: 'Müşteri Fiyat',   icon: 'fa-tags',         href: 'client-prices.html' },
        { id: 'credit-notes',  label: 'Credit Notes',    icon: 'fa-file-invoice', href: 'credit-notes.html' },
    ];

    const menuItems = tabs.map(tab => {
        const isActive    = tab.id === activeTab;
        const activeClass = isActive
            ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
            : 'text-slate-400 hover:bg-slate-800 hover:text-white border border-transparent';
        return `
            <a href="${tab.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${activeClass}">
                <i class="fa-solid ${tab.icon} w-4 text-center"></i>
                ${tab.label}
            </a>`;
    }).join('');

    navbarTarget.innerHTML = `
        <aside class="fixed inset-y-0 left-0 w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between z-50">
            <div class="p-5">
                <div class="flex items-center gap-3 px-2 mb-8">
                    <i class="fa-solid fa-earth-americas text-2xl text-orange-500"></i>
                    <span class="text-lg font-bold text-white tracking-wider">EXPORT PRO</span>
                </div>
                <nav class="space-y-1">${menuItems}</nav>
            </div>
            <div class="flex flex-col border-t border-slate-800">
                <div class="px-4 py-3 bg-slate-950/50 flex items-center justify-between text-xs text-slate-400">
                    <span class="truncate max-w-[140px]">
                        <i class="fa-solid fa-user text-slate-500 mr-1"></i> ${userEmail}
                    </span>
                    <button id="btn-logout" class="text-rose-400 hover:text-rose-300 transition-colors cursor-pointer" title="Çıkış Yap">
                        <i class="fa-solid fa-right-from-bracket"></i>
                    </button>
                </div>
                <div class="px-4 py-2 bg-slate-950/80 text-center">
                    <span class="text-[10px] font-mono text-slate-600 tracking-widest">${APP_VERSION}</span>
                </div>
            </div>
        </aside>`;

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
}
