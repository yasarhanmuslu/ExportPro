import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.43.4/+esm';

const supabaseUrl = 'https://rotquydzejivrhhkjkps.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdHF1eWR6ZWppdnJoaGtqa3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjI4NzksImV4cCI6MjA5NTE5ODg3OX0.iSnCVTuIObT7G3hWfEyJ-kXEBumRbHSIV7QDN-WWWes';

// Singleton pattern: tüm modüller aynı instance'ı kullanır
if (!window._supabaseInstance) {
    window._supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'exportpro-auth'
        }
    });
}

export const supabase = window._supabaseInstance;
