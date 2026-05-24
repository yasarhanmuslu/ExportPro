// src/components/navbar.js
import { supabase } from '../utils/supabaseClient.js';

export async function renderNavbar(activeTab) {
    // 1. Güvenli Oturum Kontrolü
    const { data: { session } } = await supabase.auth.getSession();
    
    // Eğer oturum yoksa ve kullanıcı zaten login sayfasında değilse koruma sağla
    if (!session) {
        if (!window.location.pathname.includes('login.html')) {
            window.location.href = '/login.html';
            return;
        }
    }

    const navbarTarget = document.getElementById('navbar-target');
    if (!navbarTarget) return;

    // Oturum varsa güvenle kullanıcı e-postasını al, yoksa misafir modu göster
    const userEmail = session && session.user ? session.user.email : 'Giriş Yapılmadı';

    // Menü şablonunu çizmeye devam et...
    navbarTarget.innerHTML = `
        <aside class="fixed inset-y-0 left-0 w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between z-50">
            <div class="p-6">
                <div class="flex items-center gap-3 px-2 mb-8">
                    <i class="fa-solid fa-earth-americas text-2xl text-orange-500 animate-spin-slow"></i>
                    <span class="text-lg font-bold text-white tracking-wider">EXPORT PRO</span>
                </div>
                </div>
            <div class="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between text-xs text-slate-400">
                <span class="truncate max-w-[140px]"><i class="fa-solid fa-user text-slate-500 mr-1"></i> ${userEmail}</span>
                <button id="btn-logout" class="text-rose-400 hover:text-rose-300 transition-colors">
                    <i class="fa-solid fa-right-from-bracket"></i>
                </button>
            </div>
        </aside>
    `;

    // Çıkış butonu olay dinleyicisi
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = '/login.html';
    });
}