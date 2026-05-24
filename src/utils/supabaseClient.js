import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = 'https://rotquydzejivrhhkjkps.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdHF1eWR6ZWppdnJoaGtqa3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjI4NzksImV4cCI6MjA5NTE5ODg3OX0.iSnCVTuIObT7G3hWfEyJ-kXEBumRbHSIV7QDN-WWWes';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
