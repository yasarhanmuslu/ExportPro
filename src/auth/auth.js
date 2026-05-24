import { supabase } from '../utils/supabaseClient.js';

// Her sayfanın başında çağır - session yoksa login'e yönlendir
export async function requireAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return null;
    }
    return session;
}
