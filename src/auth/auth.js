import { supabase } from '../utils/supabaseClient.js';

export async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session && !window.location.pathname.includes('login.html')) {
        window.location.href = 'login.html';
    }
    return session;
}

export async function logout() {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
}
