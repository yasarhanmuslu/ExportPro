// window.supabase UMD olarak HTML'de yüklendi
// Her import'ta aynı instance'ı döndür

const STORAGE_KEY = 'sb-rotquydzejivrhhkjkps-auth-token';
const URL = 'https://rotquydzejivrhhkjkps.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdHF1eWR6ZWppdnJoaGtqa3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjI4NzksImV4cCI6MjA5NTE5ODg3OX0.iSnCVTuIObT7G3hWfEyJ-kXEBumRbHSIV7QDN-WWWes';

if (!window._sb) {
    const { createClient } = window.supabase;
    window._sb = createClient(URL, KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storage: window.localStorage,
            storageKey: STORAGE_KEY
        }
    });
}

export const supabase = window._sb;
