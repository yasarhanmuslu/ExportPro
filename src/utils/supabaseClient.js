const { createClient } = window.supabase;

export const supabase = createClient(
    'https://rotquydzejivrhhkjkps.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdHF1eWR6ZWppdnJoaGtqa3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjI4NzksImV4cCI6MjA5NTE5ODg3OX0.iSnCVTuIObT7G3hWfEyJ-kXEBumRbHSIV7QDN-WWWes',
    {
        auth: {
            persistSession: true,
            storageKey: 'sb-rotquydzejivrhhkjkps-auth-token'
        }
    }
);
