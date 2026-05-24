const { createClient } = window.supabase;

// Her module import'unda aynı instance'ı döndür
// window._sb zaten varsa yenisini oluşturma
if (!window._sb) {
    window._sb = createClient(
        'https://rotquydzejivrhhkjkps.supabase.co',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdHF1eWR6ZWppdnJoaGtqa3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjI4NzksImV4cCI6MjA5NTE5ODg3OX0.iSnCVTuIObT7G3hWfEyJ-kXEBumRbHSIV7QDN-WWWes',
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                storageKey: 'sb-rotquydzejivrhhkjkps-auth-token',
                storage: window.localStorage
            }
        }
    );
}

export const supabase = window._sb;
