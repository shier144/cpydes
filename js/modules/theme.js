const THEME_KEY = 'cpydes_theme';

function initTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'dark') {
            appState.setState('ui.isDark', true);
        } else if (saved === 'light') {
            appState.setState('ui.isDark', false);
        }
    } catch (e) {
        console.warn('读取主题设置失败:', e);
    }
    applyTheme();
}

function applyTheme() {
    const isDark = appState.getState('ui.isDark');
    document.documentElement.classList.toggle('dark-mode', isDark);
    const btn = document.querySelector('.theme-toggle');
    if (btn) {
        btn.innerHTML = isDark ? '<i data-feather="sun"></i>' : '<i data-feather="moon"></i>';
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }
    updateThemeMenuActive();
}

function toggleTheme() {
    appState.setState('ui.isDark', !appState.getState('ui.isDark'));
    try {
        localStorage.setItem(THEME_KEY, appState.getState('ui.isDark') ? 'dark' : 'light');
    } catch (e) {
        console.warn('保存主题设置失败:', e);
    }
    applyTheme();
}

function toggleThemeMenu() {
    const dropdown = document.getElementById('themeDropdown');
    if (!dropdown) return;
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        updateThemeMenuActive();
        setTimeout(() => {
            document.addEventListener('click', closeThemeMenuOutside, { once: true });
        }, 0);
    }
}

function closeThemeMenuOutside(e) {
    const wrap = document.querySelector('.theme-menu-wrap');
    if (wrap && !wrap.contains(e.target)) {
        const dropdown = document.getElementById('themeDropdown');
        if (dropdown) dropdown.style.display = 'none';
    } else {
        document.addEventListener('click', closeThemeMenuOutside, { once: true });
    }
}

function updateThemeMenuActive() {
    const dropdown = document.getElementById('themeDropdown');
    if (!dropdown) return;

    const items = dropdown.querySelectorAll('.theme-option-item');
    items.forEach(item => item.classList.remove('active'));

    const isDark = appState.getState('ui.isDark');
    const currentMode = isDark ? 'dark' : 'light';
    // 通过 data-theme/data-layout 属性匹配，避免依赖 DOM 顺序
    items.forEach(item => {
        if (item.dataset.theme === currentMode) item.classList.add('active');
        if (item.dataset.layout && item.dataset.layout === currentLayout) item.classList.add('active');
    });
}

function quickToggleTheme(mode) {
    appState.setState('ui.isDark', mode === 'dark');
    try {
        localStorage.setItem(THEME_KEY, mode);
    } catch (e) {
        console.warn('保存主题设置失败:', e);
    }
    applyTheme();
}

function quickToggleLayout(layout) {
    appState.setState('ui.currentLayout', layout);
    saveLayoutLocal(layout);
    // 标记用户本次选择对应当前后台版本，避免下次加载被误判为"后台已变更"而重置
    const bv = (appData && appData.settings && appData.settings.layoutVersion) ? appData.settings.layoutVersion : 0;
    if (bv) {
        try { localStorage.setItem(LAYOUT_VERSION_KEY, String(bv)); } catch {}
    }
    applyLayout(layout);
    updateThemeMenuActive();
    showToast('已切换为' + (layout === 'top-tabs' ? '顶部标签' : '侧边栏') + '布局（本地设置）', 'success', 1500);
}
