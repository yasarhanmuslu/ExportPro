// ─── EXPORT PRO - THEME MANAGER ───────────────────────────────
// localStorage'da 'ep-theme' key: 'dark' | 'light'
// <html> elementine 'dark' class'ı ekler/kaldırır
// Tailwind dark: prefix'i kullanır

export function getTheme() {
    return localStorage.getItem('ep-theme') || 'dark';
}

export function setTheme(theme) {
    localStorage.setItem('ep-theme', theme);
    applyTheme(theme);
}

export function applyTheme(theme) {
    const html = document.documentElement;
    if (theme === 'light') {
        html.classList.remove('dark');
        html.classList.add('light');
    } else {
        html.classList.remove('light');
        html.classList.add('dark');
    }
}

export function toggleTheme() {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    return next;
}

// Sayfa yüklenince hemen uygula - flash önlemek için
applyTheme(getTheme());
