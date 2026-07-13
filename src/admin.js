import { renderNavbar } from './components/navbar.js';
import { requireAuth } from './auth/auth.js';
import { supabase } from './utils/supabaseClient.js';
import { getAccessContext, isOwner, MODULES } from './utils/permissions.js';
import { logChange } from './utils/auditLog.js';
import { showAlertDialog, showConfirmDialog } from './utils/dialogs.js';

let ctx = null;
let users = [];
let permsMap = {};
let pendingChanges = {};
let auditRows = [];

function moduleLabel(id) {
    if (id === 'admin') return 'Yönetici Paneli';
    if (id === 'dashboard') return 'Dashboard';
    return (MODULES.find(m => m.id === id) || {}).label || id;
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;

    ctx = await getAccessContext();
    if (!isOwner(ctx)) {
        window.location.href = 'index.html';
        return;
    }

    await renderNavbar('admin', ctx);

    const initialTab = window.location.hash === '#audit' ? 'audit' : 'users';
    await loadUsersData();
    await loadAuditData();
    renderShell(initialTab);
});

async function loadUsersData() {
    const { data: userRows } = await supabase
        .from('app_users')
        .select('id, email, display_name, last_seen_at')
        .eq('role', 'user')
        .order('email');
    users = userRows || [];

    const { data: permRows } = await supabase
        .from('module_permissions')
        .select('user_id, module_id, access_level');

    permsMap = {};
    (permRows || []).forEach(p => {
        if (!permsMap[p.user_id]) permsMap[p.user_id] = {};
        permsMap[p.user_id][p.module_id] = p.access_level;
    });
}

async function loadAuditData() {
    const { data } = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
    auditRows = data || [];
}

function unreadCount() {
    return auditRows.filter(r => !r.read_at).length;
}

function renderShell(activeTab) {
    const container = document.getElementById('admin-container');
    container.innerHTML = `
        <div style="padding:24px 32px;border-bottom:1px solid var(--border-soft,#EFEAE0);">
            <h1 style="font-size:20px;font-weight:600;margin-bottom:4px;">Yönetici</h1>
            <p style="font-size:12.5px;color:var(--ink-2,#6B655B);">Kullanıcı yetkileri ve denetim kaydı</p>
        </div>
        <div style="display:flex;gap:24px;padding:0 32px;border-bottom:1px solid var(--border-soft,#EFEAE0);">
            <button class="admin-tab-btn" data-tab="users" style="padding:12px 4px;font-size:13px;">Kullanıcı Yetkileri</button>
            <button class="admin-tab-btn" data-tab="audit" style="padding:12px 4px;font-size:13px;">
                Denetim Kaydı${unreadCount() > 0 ? ` <span style="background:var(--danger,#9F3D3D);color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;">${unreadCount()}</span>` : ''}
            </button>
        </div>
        <div id="admin-tab-content" style="padding:24px 32px;flex:1;"></div>
    `;

    container.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });

    setActiveTab(activeTab);
}

function setActiveTab(tab) {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'users') renderUsersTab();
    else renderAuditTab();
}

function renderUsersTab() {
    const content = document.getElementById('admin-tab-content');
    if (!users.length) {
        content.innerHTML = `<p style="font-size:13px;color:var(--ink-2,#6B655B);">Henüz kayıtlı kullanıcı yok. Bir kullanıcı login.html üzerinden bir kez giriş yaptıktan sonra burada görünür.</p>`;
        return;
    }

    const headerCells = MODULES.map(m => `<th>${m.label}${m.note ? ` <span style="font-weight:400;color:var(--ink-3,#968B7A);">(${m.note})</span>` : ''}</th>`).join('');

    const rows = users.map(u => {
        const cells = MODULES.map(m => {
            const current = (permsMap[u.id] && permsMap[u.id][m.id]) || 'none';
            return `
                <td>
                    <select data-user="${u.id}" data-module="${m.id}" style="font-size:11px;padding:3px 4px;border:1px solid var(--border,#E4DDCE);border-radius:4px;background:var(--surface,#fff);color:var(--ink-1,#1C1A17);">
                        <option value="none" ${current === 'none' ? 'selected' : ''}>Yok</option>
                        <option value="view" ${current === 'view' ? 'selected' : ''}>Görüntüle</option>
                        <option value="edit" ${current === 'edit' ? 'selected' : ''}>Düzenle</option>
                    </select>
                </td>`;
        }).join('');
        return `<tr><td>${u.email}</td>${cells}</tr>`;
    }).join('');

    content.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
            <button id="btn-save-perms" style="background:var(--ink-1,#1C1A17);color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:12.5px;cursor:pointer;font-family:Verdana, Geneva, sans-serif;">Değişiklikleri Kaydet</button>
        </div>
        <div class="perm-table-wrap">
            <table class="perm-table">
                <thead><tr><th>Kullanıcı</th>${headerCells}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    pendingChanges = {};
    content.querySelectorAll('select[data-user]').forEach(sel => {
        sel.addEventListener('change', () => {
            pendingChanges[`${sel.dataset.user}|${sel.dataset.module}`] = {
                userId: sel.dataset.user,
                moduleId: sel.dataset.module,
                level: sel.value,
            };
        });
    });

    document.getElementById('btn-save-perms').addEventListener('click', savePermissionChanges);
}

async function savePermissionChanges() {
    const changes = Object.values(pendingChanges);
    if (!changes.length) {
        await showAlertDialog('Kaydedilecek bir değişiklik yok.', { variant: 'info' });
        return;
    }

    const ok = await showConfirmDialog(`${changes.length} kullanıcı/modül yetkisi güncellenecek. Devam edilsin mi?`, {
        title: 'Yetkileri Kaydet',
        confirmText: 'Kaydet',
    });
    if (!ok) return;

    try {
        const upsertRows = changes.map(c => ({
            user_id: c.userId,
            module_id: c.moduleId,
            access_level: c.level,
            updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase.from('module_permissions').upsert(upsertRows, { onConflict: 'user_id,module_id' });
        if (error) throw error;

        const levelLabel = { none: 'Yok', view: 'Görüntüle', edit: 'Düzenle' };
        const summary = changes.map(c => {
            const user = users.find(u => u.id === c.userId);
            return `${user ? user.email : c.userId} → ${moduleLabel(c.moduleId)}: ${levelLabel[c.level]}`;
        }).join('; ');

        await logChange({ ctx, moduleId: 'admin', action: 'update', summary: `Yetki güncellendi: ${summary}` });

        await showAlertDialog('Yetkiler kaydedildi.', { variant: 'success', title: 'Başarılı' });
        await loadUsersData();
        renderUsersTab();
    } catch (err) {
        console.error(err);
        await showAlertDialog('Yetkiler kaydedilirken bir hata oluştu: ' + err.message, { variant: 'danger' });
    }
}

function renderAuditTab() {
    const content = document.getElementById('admin-tab-content');
    const moduleOptions = ['all', ...new Set(auditRows.map(r => r.module_id).filter(Boolean))];

    content.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
            <input id="audit-filter-email" placeholder="E-posta filtrele..." style="font-size:12px;padding:6px 10px;border:1px solid var(--border,#E4DDCE);border-radius:6px;background:var(--surface,#fff);color:var(--ink-1,#1C1A17);">
            <select id="audit-filter-module" style="font-size:12px;padding:6px 10px;border:1px solid var(--border,#E4DDCE);border-radius:6px;background:var(--surface,#fff);color:var(--ink-1,#1C1A17);">
                ${moduleOptions.map(m => `<option value="${m}">${m === 'all' ? 'Tüm Modüller' : moduleLabel(m)}</option>`).join('')}
            </select>
            <div style="flex:1;"></div>
            <button id="btn-mark-all-read" style="background:transparent;border:1px solid var(--border,#E4DDCE);border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;color:var(--ink-2,#6B655B);font-family:Verdana, Geneva, sans-serif;">Tümünü Okundu İşaretle</button>
        </div>
        <div style="overflow-x:auto;">
            <table style="border-collapse:collapse;width:100%;">
                <thead>
                    <tr>
                        <th style="text-align:left;font-size:11px;color:var(--ink-2,#6B655B);padding:8px 10px;">Tarih</th>
                        <th style="text-align:left;font-size:11px;color:var(--ink-2,#6B655B);padding:8px 10px;">Kullanıcı</th>
                        <th style="text-align:left;font-size:11px;color:var(--ink-2,#6B655B);padding:8px 10px;">Modül</th>
                        <th style="text-align:left;font-size:11px;color:var(--ink-2,#6B655B);padding:8px 10px;">Aksiyon</th>
                        <th style="text-align:left;font-size:11px;color:var(--ink-2,#6B655B);padding:8px 10px;">Özet</th>
                    </tr>
                </thead>
                <tbody id="audit-tbody"></tbody>
            </table>
        </div>
    `;

    const renderRows = () => {
        const emailFilter = document.getElementById('audit-filter-email').value.trim().toLowerCase();
        const moduleFilter = document.getElementById('audit-filter-module').value;
        const filtered = auditRows.filter(r =>
            (!emailFilter || (r.user_email || '').toLowerCase().includes(emailFilter)) &&
            (moduleFilter === 'all' || r.module_id === moduleFilter)
        );

        const actionLabel = { create: 'Oluşturuldu', update: 'Güncellendi', delete: 'Silindi' };
        document.getElementById('audit-tbody').innerHTML = filtered.map(r => `
            <tr class="audit-row ${!r.read_at ? 'unread' : ''}">
                <td>${new Date(r.created_at).toLocaleString('tr-TR')}</td>
                <td>${r.user_email || '—'}</td>
                <td>${moduleLabel(r.module_id)}</td>
                <td>${actionLabel[r.action] || r.action}</td>
                <td>${r.summary || ''}</td>
            </tr>
        `).join('') || `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--ink-3,#968B7A);">Kayıt bulunamadı.</td></tr>`;
    };

    document.getElementById('audit-filter-email').addEventListener('input', renderRows);
    document.getElementById('audit-filter-module').addEventListener('change', renderRows);
    document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
        const { error } = await supabase.from('audit_log').update({ read_at: new Date().toISOString() }).is('read_at', null);
        if (error) {
            await showAlertDialog('İşaretlenirken hata oluştu: ' + error.message, { variant: 'danger' });
            return;
        }
        await loadAuditData();
        renderShell('audit');
    });

    renderRows();
}
