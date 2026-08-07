function showToast(msg, type = 'info', duration = 3000, opts = {}) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    const typeClass = type === 'success' ? 'toast-ok' : type === 'error' ? 'toast-err' : type === 'warning' ? 'toast-warn' : '';
    toast.className = 'toast ' + typeClass;
    const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'x-circle' : type === 'warning' ? 'alert-triangle' : 'info';
    const toastIcons = {
        success: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M9 12l2 2 4-4"/>',
        error: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>',
        warning: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v6"/><path d="M12 18h.01"/>',
        info: '<path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 14v-4"/><path d="M12 18h.01"/>'
    };
    const iconPaths = toastIcons[type] || toastIcons.info;
    // 文字样式覆盖：直接应用到 toast 元素，文字和图标都继承变色
    // textColor / fontSize 经 sanitizeColor / 整数校验，防 CSS 注入
    if (opts && opts.textColor && typeof window.sanitizeColor === 'function') {
        const c = window.sanitizeColor(opts.textColor);
        if (c) toast.style.color = c;
    }
    if (opts && opts.fontSize && Number.isFinite(opts.fontSize) && opts.fontSize >= 11 && opts.fontSize <= 24) {
        toast.style.fontSize = Math.round(opts.fontSize) + 'px';
    }
    toast.innerHTML = `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">${iconPaths}</svg></span><span>${escapeHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ========== Confirm Dialog ==========
let confirmCallback = null;

function showConfirm(msg, icon, opts) {
    icon = icon || 'alert-triangle';
    // 图标名白名单过滤，防止属性注入
    icon = String(icon).replace(/[^a-z0-9-]/gi, '');
    opts = opts || {};
    // 重入时先释放旧 Promise，避免永挂
    if (confirmCallback) confirmCallback(false);
    return new Promise(resolve => {
        const iconEl = document.getElementById('confirmIcon');
        const msgEl = document.getElementById('confirmMsg');
        const overlay = document.getElementById('confirmOverlay');
        if (!iconEl || !msgEl || !overlay) { resolve(false); return; }
        iconEl.innerHTML = '<i data-feather="' + icon + '"></i>';
        msgEl.textContent = msg;
        // 文字样式覆盖（重入时清空，避免上次样式残留）
        if (opts.textColor && typeof window.sanitizeColor === 'function') {
            const c = window.sanitizeColor(opts.textColor);
            msgEl.style.color = c || '';
        } else {
            msgEl.style.color = '';
        }
        if (opts.fontSize && Number.isFinite(opts.fontSize) && opts.fontSize >= 11 && opts.fontSize <= 24) {
            msgEl.style.fontSize = Math.round(opts.fontSize) + 'px';
        } else {
            msgEl.style.fontSize = '';
        }
        overlay.classList.add('show');

        setTimeout(function() {
            if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
        }, 10);

        confirmCallback = resolve;
    });
}

function closeConfirm(result) {
    const overlay = document.getElementById('confirmOverlay');
    if (overlay) overlay.classList.remove('show');
    if (confirmCallback) { confirmCallback(result); confirmCallback = null; }
}

// ========== Input Dialog (自定义输入框) ==========
let inputDialogCallback = null;

async function showInputDialog(message, options) {
    options = options || {};
    var icon = options.icon || 'edit-3';
    // 图标名白名单过滤
    icon = String(icon).replace(/[^a-z0-9-]/gi, '');
    var placeholder = options.placeholder || '请输入...';
    var defaultValue = options.defaultValue || '';

    // 重入时先释放旧 Promise，避免永挂
    if (inputDialogCallback) inputDialogCallback(null);

    return new Promise(function(resolve) {
        const iconEl = document.getElementById('inputDialogIcon');
        const titleEl = document.getElementById('inputDialogTitle');
        const inputEl = document.getElementById('inputDialogInput');
        const overlay = document.getElementById('inputDialogOverlay');
        if (!iconEl || !titleEl || !inputEl || !overlay) { resolve(null); return; }

        iconEl.innerHTML = '<i data-feather="' + icon + '"></i>';
        titleEl.textContent = message;
        inputEl.placeholder = placeholder;
        inputEl.value = defaultValue;

        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';

        setTimeout(function() {
            if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
        }, 10);

        inputDialogCallback = resolve;
        setTimeout(function() { inputEl.focus(); }, 100);
    });
}

function submitInputDialog() {
    const inputEl = document.getElementById('inputDialogInput');
    if (!inputEl) return;
    const value = inputEl.value.trim();
    closeInputDialog(value);
}

function closeInputDialog(value) {
    const overlay = document.getElementById('inputDialogOverlay');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
    if (inputDialogCallback) {
        inputDialogCallback(value);
        inputDialogCallback = null;
    }
}

// ========== Dedup Confirm Dialog (查重富信息确认框) ==========
let _dedupConfirmResolver = null;

/**
 * 显示查重富信息确认框
 * @param {object} dup - findDuplicateContent 返回值（含 title/similarity/duplicateChars/snippet/itemId）
 * @returns {Promise<'save'|'cancel'|'view'>}
 */
function showDedupConfirm(dup) {
    return new Promise(resolve => {
        // 重入时先释放旧 Promise，避免永挂
        if (_dedupConfirmResolver) _dedupConfirmResolver('cancel');

        const pct = Math.round((dup.similarity || 0) * 100);
        const link = document.getElementById('dedupConfirmLink');
        if (link) {
            link.textContent = dup.title && dup.title.length > 40 ? dup.title.substring(0, 40) + '…' : (dup.title || '(无标题)');
        }
        const simEl = document.getElementById('dedupConfirmSim');
        if (simEl) simEl.textContent = pct + '%';
        const charsEl = document.getElementById('dedupConfirmChars');
        if (charsEl) charsEl.textContent = (dup.duplicateChars || 0) + ' 字';
        const barFill = document.getElementById('dedupConfirmBarFill');
        if (barFill) barFill.style.width = pct + '%';
        const snipEl = document.getElementById('dedupConfirmSnip');
        if (snipEl) {
            if (dup.snippet) {
                snipEl.style.display = 'block';
                snipEl.textContent = '“' + dup.snippet + '”';
            } else {
                snipEl.style.display = 'none';
            }
        }
        // 根据相似度调整顶部图标和配色提示
        const iconEl = document.getElementById('dedupConfirmIcon');
        const box = document.getElementById('dedupConfirmBox');
        if (iconEl && box) {
            if (pct >= 80) { iconEl.innerHTML = '<i data-feather="alert-octagon"></i>'; box.className = 'dedup-confirm-box dedup-sev-high'; }
            else if (pct >= 50) { iconEl.innerHTML = '<i data-feather="alert-triangle"></i>'; box.className = 'dedup-confirm-box dedup-sev-mid'; }
            else { iconEl.innerHTML = '<i data-feather="info"></i>'; box.className = 'dedup-confirm-box dedup-sev-low'; }
        }
        const overlay = document.getElementById('dedupConfirmOverlay');
        if (overlay) overlay.classList.add('show');

        setTimeout(function() {
            if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
        }, 10);

        _dedupConfirmResolver = resolve;
    });
}

function closeDedupConfirm(action) {
    const overlay = document.getElementById('dedupConfirmOverlay');
    if (overlay) overlay.classList.remove('show');
    if (_dedupConfirmResolver) { _dedupConfirmResolver(action || 'cancel'); _dedupConfirmResolver = null; }
}
