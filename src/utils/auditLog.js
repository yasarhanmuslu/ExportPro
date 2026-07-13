import { supabase } from './supabaseClient.js';

// Her create/update/delete sonrası çağrılır. Kullanıcı akışını bloklamaz -
// hata olursa sessizce konsola loglanır, denetim kaydı bir işlemi asla geriye almaz.
export async function logChange({ ctx, moduleId, action, summary, details = null }) {
    if (!ctx) return;
    try {
        await supabase.from('audit_log').insert([{
            user_id: ctx.userId,
            user_email: ctx.email,
            module_id: moduleId,
            action,
            summary,
            details,
        }]);
    } catch (err) {
        console.error('audit_log insert failed:', err);
    }
}
