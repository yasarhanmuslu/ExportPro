import { supabase } from '../utils/supabaseClient.js';

// Oturum Koruma Kontrolü
export async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    
    // Eğer oturum yoksa ve kullanıcı login sayfasında değilse login'e yönlendir
    if (!session && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
    }
    return session;
}

// Çıkış Yapma Fonksiyonu
export async function logout() {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
}