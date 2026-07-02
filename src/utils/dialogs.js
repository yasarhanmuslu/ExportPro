// dialogs.js — native alert()/confirm()/prompt() yerine tema uyumlu modal pencereler
// Tüm modüllerde (quotations.js, orders.js, customers.js, ...) ortak kullanım için.

const VARIANT_STYLE = {
    info:    { color: '#2D4A3E', bg: '#E7EEE9', icon: 'fa-circle-info' },
    success: { color: '#3D6E50', bg: '#E1EEE5', icon: 'fa-circle-check' },
    warn:    { color: '#B26B33', bg: '#F5E6D8', icon: 'fa-triangle-exclamation' },
    danger:  { color: '#9F3D3D', bg: '#F1DDD9', icon: 'fa-triangle-exclamation' },
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function buildBackdrop(innerHtml) {
    const backdrop = document.createElement('div');
    // "open" sınıfı da eklenir: bazı sayfalarda (ör. products.html) .modal-backdrop
    // varsayılan gizlidir ve yalnızca .open ile görünür olur.
    backdrop.className = 'modal-backdrop open';
    backdrop.style.zIndex = '300';
    backdrop.innerHTML = innerHtml;
    document.body.appendChild(backdrop);
    return backdrop;
}

function iconHeader(title, message, variant) {
    const v = VARIANT_STYLE[variant] || VARIANT_STYLE.info;
    return `
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:18px;">
            <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${v.bg};">
                <i class="fa-solid ${v.icon}" style="color:${v.color};font-size:15px;"></i>
            </div>
            <div style="min-width:0;">
                <div style="font-size:15px;font-weight:700;color:#1C1A17;margin-bottom:4px;">${escapeHtml(title)}</div>
                <div style="font-size:13px;line-height:1.5;color:#6B655B;white-space:pre-line;">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
}

// ── ALERT (tek buton, native alert() yerine) ─────────────────────────────────
export function showAlertDialog(message, { title = 'Bilgi', variant = 'info', okText = 'Tamam' } = {}) {
    return new Promise(resolve => {
        const v = VARIANT_STYLE[variant] || VARIANT_STYLE.info;
        const backdrop = buildBackdrop(`
            <div class="modal-content" style="max-width:24rem;padding:1.5rem;">
                ${iconHeader(title, message, variant)}
                <div style="display:flex;justify-content:flex-end;">
                    <button type="button" class="da-ok" style="height:36px;padding:0 18px;border-radius:6px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;border:none;background:${v.color};">${escapeHtml(okText)}</button>
                </div>
            </div>
        `);
        const finish = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(); };
        const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') finish(); };
        backdrop.querySelector('.da-ok').addEventListener('click', finish);
        backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) finish(); });
        document.addEventListener('keydown', onKey);
        backdrop.querySelector('.da-ok').focus();
    });
}

// ── CONFIRM (Tamam/Vazgeç, native confirm() yerine) ──────────────────────────
export function showConfirmDialog(message, { title = 'Onay', variant = 'info', confirmText = 'Devam Et', cancelText = 'Vazgeç' } = {}) {
    return new Promise(resolve => {
        const v = VARIANT_STYLE[variant] || VARIANT_STYLE.info;
        const backdrop = buildBackdrop(`
            <div class="modal-content" style="max-width:24rem;padding:1.5rem;">
                ${iconHeader(title, message, variant)}
                <div style="display:flex;justify-content:flex-end;gap:10px;">
                    <button type="button" class="cd-cancel" style="height:36px;padding:0 16px;border-radius:6px;font-size:13px;font-weight:600;background:#FFFFFF;border:1px solid #E4DDCE;color:#6B655B;cursor:pointer;">${escapeHtml(cancelText)}</button>
                    <button type="button" class="cd-confirm" style="height:36px;padding:0 18px;border-radius:6px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;border:none;background:${v.color};">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `);
        const finish = result => { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(result); };
        const onKey = e => { if (e.key === 'Escape') finish(false); };
        backdrop.querySelector('.cd-cancel').addEventListener('click', () => finish(false));
        backdrop.querySelector('.cd-confirm').addEventListener('click', () => finish(true));
        backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) finish(false); });
        document.addEventListener('keydown', onKey);
        backdrop.querySelector('.cd-confirm').focus();
    });
}

// ── PROMPT (metin girişi, native prompt() yerine) ────────────────────────────
export function showPromptDialog(message, defaultValue = '', { title = 'Girdi Gerekli', confirmText = 'Tamam', cancelText = 'Vazgeç' } = {}) {
    return new Promise(resolve => {
        const v = VARIANT_STYLE.info;
        const backdrop = buildBackdrop(`
            <div class="modal-content" style="max-width:24rem;padding:1.5rem;">
                ${iconHeader(title, message, 'info')}
                <input type="text" class="pd-input" value="${escapeHtml(defaultValue)}" style="width:100%;height:38px;padding:0 12px;border:1px solid #E4DDCE;border-radius:6px;font-size:13px;font-family:Verdana, Geneva, sans-serif;color:#1C1A17;margin-bottom:18px;">
                <div style="display:flex;justify-content:flex-end;gap:10px;">
                    <button type="button" class="pd-cancel" style="height:36px;padding:0 16px;border-radius:6px;font-size:13px;font-weight:600;background:#FFFFFF;border:1px solid #E4DDCE;color:#6B655B;cursor:pointer;">${escapeHtml(cancelText)}</button>
                    <button type="button" class="pd-confirm" style="height:36px;padding:0 18px;border-radius:6px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;border:none;background:${v.color};">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `);
        const input = backdrop.querySelector('.pd-input');
        const finish = result => { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(result); };
        const onKey = e => {
            if (e.key === 'Escape') finish(null);
            if (e.key === 'Enter') finish(input.value);
        };
        backdrop.querySelector('.pd-cancel').addEventListener('click', () => finish(null));
        backdrop.querySelector('.pd-confirm').addEventListener('click', () => finish(input.value));
        backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) finish(null); });
        document.addEventListener('keydown', onKey);
        input.focus();
        input.select();
    });
}
