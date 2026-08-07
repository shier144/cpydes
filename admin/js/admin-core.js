/* ========== Cpydes 管理后台逻辑 ========== */
'use strict';

// refreshFeatherIcons / escapeHtml / escapeAttr / sanitizeColor 由 shared-utils.js 提供（head 中 defer 加载）
// 此处仅保留后台专用工具函数：truncate / stripHtml / formatDate / formatSize / normalizeImgPaths 等

// 全局状态
const AdminState = {
    authed: false,
    data: { categories: [], items: [], settings: {}, users: [] },
    csrfToken: null,
    currentView: 'dashboard',
    isDark: false,
    compareState: null,
    // 文案管理
    contentFilter: { keyword: '', categoryId: '', tag: '', sortField: 'updatedAt', sortDir: 'desc' },
    contentPage: 1,
    contentPageSize: 15,
    contentSelected: new Set(),
    contentAllTags: [],
    // 图片管理
    imageList: [],
    imageFilter: '',
    imageSelected: new Set(),
    imageFilterMode: 'all', // all | referenced | orphan
    imageSortField: 'modified', // modified | name | size | referenced
    imageSortDir: 'desc', // asc | desc
    imageTypeFilter: '', // '' | png | jpg | gif | webp | svg
    // 当前编辑项
    editingItem: null,
    // 查重分析
    dedupConfig: null,           // 当前已保存的查重策略
    dedupDraftConfig: null,      // 编辑中的策略草稿（未保存）
    dedupResults: null,          // 最近一次分析结果 { pairs, groups, scannedAt, itemCount }
    dedupAnalyzing: false,
    // 多用户系统
    currentUser: null,           // 当前登录用户 { id, username, role }
    // AI 设置
    aiSettings: null,            // AI 模型配置 { enabled, models, systemPrompt, defaultModel }
    authMode: 'multi-user', // 后台固定使用多用户模式
    users: [],                   // 已加载的用户列表（供 resetPassword/deleteUser 查找用户名）
    // 在线用户
    onlineRefreshTimer: null,
    onlineUsers: [],
    // 活动日志
    activityLogs: [],
    activityFilter: { user: '', action: '', success: '', dateFrom: '', dateTo: '' },
    activityPage: 1,
    activityPageSize: 20,
    activityActionTypes: [],
    activityTotal: 0,
    // 使用统计
    usageStats: null,
    // 操作审计日志
    auditFilter: { action: '', user: '', success: '', dateFrom: '', dateTo: '', keyword: '' },
    auditPage: 1,
    auditPageSize: 30,
    auditActionTypes: {},
    auditUserOptions: [],
    auditTotal: 0,
    auditStats: null,
    auditSettings: null,
    // 网盘
    driveParentId: null,
    driveView: 'list',  // 'list' or 'grid'
    driveSearch: '',
    driveSelected: [],
    drivePage: 1,
    drivePageSize: 12,
    // 公告管理
    announcements: [],          // 已加载的公告列表（管理视图用）
    announcementFilter: { keyword: '', status: 'all' },  // status: all | active | inactive
    announcementPage: 1,
    announcementPageSize: 15
};

const VIEW_TITLES = {
    dashboard: '仪表盘',
    content: '文案管理',
    dedup: '查重分析',
    categories: '分类管理',
    images: '图片管理',
    shares: '分享管理',
    announcements: '公告管理',
    drive: '数据网盘',
    // 合并后的新顶级页面
    userManage: '用户管理',
    basicSettings: '基础设置',
    statsAnalysis: '统计分析',
    systemMonitor: '系统监控',
    aiManage: 'AI 管理',
    backup: '备份恢复',
    system: '系统信息',
    // 以下旧 navId 保留兼容（直接访问时映射到合并页面）
    access: '访问控制',
    appearance: '外观设置',
    users: '用户管理',
    roles: '角色管理',
    onlineUsers: '在线用户',
    activityLog: '访问日志',
    usageStats: '使用统计',
    serverMonitor: '服务器监控',
    auditLog: '操作审计',
    aiSettings: 'AI 设置',
    aiTasks: 'AI 任务'
};

/* ========== 工具函数 ========== */
// escapeHtml / escapeAttr / sanitizeColor 已迁移至 js/shared-utils.js（前后台共享）

/**
 * 规范化图片路径：确保 img/ 前缀的 src 使用 ../img/ 以适配 admin/ 上下文
 */
function normalizeImgPaths(html) {
    if (!html) return '';
    // 匹配 src="img/xxx" 或 src='img/xxx'
    return html.replace(/src=["'](img\/[^"']+)["']/gi, (match, path) => {
        if (path.startsWith('../')) return match; // 已经是 ../img/ 格式，跳过
        return `src="../${path}"`;
    });
}

/**
 * 保存时还原 ../img/ 为 img/（与前端路径一致）
 */
function normalizeSaveImgPaths(html) {
    if (!html) return '';
    return html.replace(/src=["'](\.\.\/)(img\/[^"']+)["']/gi, 'src="$2"');
}

function truncate(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.substring(0, n) + '…' : s;
}

function stripHtml(html) {
    if (!html) return '';
    return String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function getSiteBaseUrl() {
    const path = location.pathname;
    const idx = path.lastIndexOf('/admin/');
    if (idx !== -1) {
        return location.origin + path.substring(0, idx);
    }
    const idx2 = path.lastIndexOf('/admin');
    if (idx2 !== -1 && idx2 + '/admin'.length === path.length) {
        return location.origin + path.substring(0, idx2);
    }
    return location.origin + path.replace(/\/[^\/]*$/, '');
}

/* ========== Toast ========== */
function showToast(msg, type = 'info', duration = 2800) {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'success' ? ' toast-ok' : type === 'error' ? ' toast-err' : type === 'warn' ? ' toast-warn' : '');
    const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'x-circle' : type === 'warn' ? 'alert-triangle' : 'info';
    t.innerHTML = `<span><i data-feather="${iconName}" style="width:16px;height:16px;"></i></span><span>${escapeHtml(msg)}</span>`;
    c.appendChild(t);
    refreshFeatherIcons();
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(20px)';
        t.style.transition = 'all 0.25s';
        setTimeout(() => t.remove(), 250);
    }, duration);
}

/* ========== 确认框 ========== */
let _confirmResolver = null;
function showConfirm(msg, icon = 'alert-triangle') {
    if (_confirmResolver) _confirmResolver(false);
    return new Promise((resolve) => {
        const iconEl = document.getElementById('confirmIcon');
        if (iconEl) {
            iconEl.innerHTML = `<i data-feather="${icon}" style="width:24px;height:24px;"></i>`;
        }
        document.getElementById('confirmMsg').innerHTML = escapeHtml(msg);
        document.getElementById('confirmOverlay').style.display = 'flex';
        refreshFeatherIcons();
        _confirmResolver = resolve;
    });
}
function closeConfirm(ok) {
    document.getElementById('confirmOverlay').style.display = 'none';
    if (_confirmResolver) { _confirmResolver(!!ok); _confirmResolver = null; }
}

/* ========== 查重富信息确认框 ========== */
let _dedupConfirmResolver = null;

/**
 * 显示查重富信息确认框
 * @param {object} dup - findDuplicateContent 返回值
 * @returns {Promise<'save'|'cancel'|'view'>}
 */
function showDedupConfirm(dup) {
    return new Promise((resolve) => {
        if (_dedupConfirmResolver) _dedupConfirmResolver('cancel');

        const pct = Math.round((dup.similarity || 0) * 100);
        const link = document.getElementById('dedupConfirmLink');
        if (link) {
            link.textContent = truncate(dup.title || '(无标题)', 40);
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
        const iconEl = document.getElementById('dedupConfirmIcon');
        const box = document.getElementById('dedupConfirmBox');
        if (iconEl && box) {
            if (pct >= 80) { iconEl.innerHTML = '<i data-feather="alert-octagon" style="width:28px;height:28px;"></i>'; box.className = 'dedup-confirm-box dedup-sev-high'; }
            else if (pct >= 50) { iconEl.innerHTML = '<i data-feather="alert-triangle" style="width:28px;height:28px;"></i>'; box.className = 'dedup-confirm-box dedup-sev-mid'; }
            else { iconEl.innerHTML = '<i data-feather="info" style="width:28px;height:28px;"></i>'; box.className = 'dedup-confirm-box dedup-sev-low'; }
            refreshFeatherIcons();
        }
        document.getElementById('dedupConfirmOverlay').style.display = 'flex';
        _dedupConfirmResolver = resolve;
    });
}

function closeDedupConfirm(action) {
    document.getElementById('dedupConfirmOverlay').style.display = 'none';
    if (_dedupConfirmResolver) { _dedupConfirmResolver(action || 'cancel'); _dedupConfirmResolver = null; }
}

/* ========== 模态框 ========== */
function openModal(title, bodyHtml, footHtml) {
    document.getElementById('modalTitle').innerHTML = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalFoot').innerHTML = footHtml || '<button class="btn btn-default" onclick="closeModal()">关闭</button>';
    document.getElementById('modalOverlay').style.display = 'flex';
    const modalCloseBtn = document.querySelector('.modal-close');
    if (modalCloseBtn) modalCloseBtn.onclick = closeModal;
    refreshFeatherIcons();
}
function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
    document.getElementById('modalBody').innerHTML = '';
    // 清空弹窗标题右侧的元信息容器（字数统计、最后更新时间）
    const headMetaEl = document.getElementById('modalHeadMeta');
    if (headMetaEl) headMetaEl.innerHTML = '';
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.remove('modal-narrow', 'modal-wide');
    // 注意：compareState 的清理由 closeCompare 专门负责；此处自动重开对比弹窗会导致
    // 从对比弹窗打开的编辑器在用户取消时被强制弹回对比窗，体验错乱。
    if (AdminState.compareState) {
        const { idA, idB } = AdminState.compareState;
        const itemA = (AdminState.data.items || []).find(x => x.id === idA);
        const itemB = (AdminState.data.items || []).find(x => x.id === idB);
        // 仅当两个文案都还在时才重开对比弹窗
        if (itemA && itemB && !window._compareStateLocked) {
            compareItems(idA, idB);
        } else {
            AdminState.compareState = null;
        }
    }
}

let _modalResolver = null;

function showModal(title, bodyHtml, onSave) {
    return new Promise((resolve) => {
        // 修复：如果上一个 modal 的 Promise 未解决，先以 false 解决它，避免内存泄漏
        if (_modalResolver) _modalResolver(false);
        openModal(
            title,
            bodyHtml,
            '<button class="btn btn-default" onclick="closeModalAndResolve(false)">取消</button>' +
            '<button class="btn btn-primary" onclick="handleModalSave()">保存</button>'
        );
        _modalResolver = resolve;
        window._modalOnSave = onSave;
    });
}

function closeModalAndResolve(result) {
    closeModal();
    if (_modalResolver) {
        _modalResolver(result);
        _modalResolver = null;
    }
    window._modalOnSave = null;
}

async function handleModalSave() {
    if (window._modalOnSave) {
        try {
            const result = await window._modalOnSave();
            if (result === true) {
                closeModalAndResolve(true);
            }
        } catch (e) {
            console.error('保存失败:', e);
            showToast(e.message || '保存失败，请重试', 'error');
        }
    }
}

function openChangePassword() {
    const bodyHtml = `
        <div class="form-group">
            <label class="form-label">当前密码</label>
            <input type="password" id="changePwdOld" class="form-input" placeholder="请输入当前密码..." autocomplete="off">
        </div>
        <div class="form-group">
            <label class="form-label">新密码</label>
            <input type="password" id="changePwdNew" class="form-input" placeholder="请输入新密码（至少4位）..." autocomplete="new-password">
        </div>
        <div class="form-group">
            <label class="form-label">确认新密码</label>
            <input type="password" id="changePwdConfirm" class="form-input" placeholder="请再次输入新密码..." autocomplete="new-password">
        </div>
        <div class="login-error" id="changePwdError" style="display:none;"></div>
    `;
    const footHtml = `
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="changeAdminPassword()">确认修改</button>
    `;
    openModal('<i data-feather="key" style="width:16px;height:16px;vertical-align:middle;"></i> 修改管理员密码', bodyHtml, footHtml);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
    setTimeout(() => { document.getElementById('changePwdOld')?.focus(); }, 100);
}

function toggleUserDropdown() {
    const menu = document.getElementById('userDropdownMenu');
    if (!menu) return;
    const isOpen = menu.style.display === 'block';
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        // 点击外部关闭
        const closeHandler = (e) => {
            const dropdown = document.querySelector('.topbar-user-dropdown');
            if (dropdown && !dropdown.contains(e.target)) {
                menu.style.display = 'none';
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }
}

function openChangeUsername() {
    // 关闭下拉菜单
    const menu = document.getElementById('userDropdownMenu');
    if (menu) menu.style.display = 'none';

    const currentUsername = AdminState.currentUser?.username || '';
    const bodyHtml = `
        <div class="form-group">
            <label class="form-label">当前用户名</label>
            <input type="text" class="form-input" value="${escapeHtml(currentUsername)}" disabled style="background:#f1f5f9;color:#94a3b8;">
        </div>
        <div class="form-group">
            <label class="form-label">新用户名</label>
            <input type="text" id="changeUsernameNew" class="form-input" placeholder="请输入新用户名..." autocomplete="off">
        </div>
        <div class="login-error" id="changeUsernameError" style="display:none;"></div>
    `;
    const footHtml = `
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="changeAdminUsername()">确认修改</button>
    `;
    openModal('<i data-feather="edit-3" style="width:16px;height:16px;vertical-align:middle;"></i> 修改用户名', bodyHtml, footHtml);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
    setTimeout(() => { document.getElementById('changeUsernameNew')?.focus(); }, 100);
}

async function changeAdminUsername() {
    const newUsername = document.getElementById('changeUsernameNew')?.value?.trim() || '';
    const errorEl = document.getElementById('changeUsernameError');

    if (!newUsername) {
        if (errorEl) { errorEl.textContent = '请输入新用户名'; errorEl.style.display = 'block'; }
        return;
    }

    if (newUsername.length < 2 || newUsername.length > 50) {
        if (errorEl) { errorEl.textContent = '用户名长度需为 2-50 位'; errorEl.style.display = 'block'; }
        return;
    }

    // 用户名格式验证
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(newUsername)) {
        if (errorEl) { errorEl.textContent = '用户名只能包含中文、字母、数字、下划线'; errorEl.style.display = 'block'; }
        return;
    }

    // 检查是否有修改
    if (AdminState.currentUser?.username === newUsername) {
        if (errorEl) { errorEl.textContent = '用户名未修改'; errorEl.style.display = 'block'; }
        return;
    }

    try {
        const r = await adminApiFetch('updateCurrentUsername', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: newUsername })
        });

        const j = await r.json();
        if (j.success) {
            // 更新本地状态
            if (AdminState.currentUser) {
                AdminState.currentUser.username = j.username;
            }
            // 更新顶部栏显示
            const usernameEl = document.getElementById('topbarUsername');
            if (usernameEl) usernameEl.textContent = j.username;

            closeModal();
            showToast('用户名已更新', 'success');
        } else {
            if (errorEl) { errorEl.textContent = j.error || '修改失败'; errorEl.style.display = 'block'; }
        }
    } catch (e) {
        console.error('修改用户名失败:', e);
        if (errorEl) { errorEl.textContent = '网络错误'; errorEl.style.display = 'block'; }
    }
}

async function changeAdminPassword() {
    const oldPwd = document.getElementById('changePwdOld')?.value || '';
    const newPwd = document.getElementById('changePwdNew')?.value || '';
    const confirmPwd = document.getElementById('changePwdConfirm')?.value || '';
    const errorEl = document.getElementById('changePwdError');

    if (!oldPwd) {
        showError(errorEl, '请输入当前密码');
        return;
    }
    if (!newPwd) {
        showError(errorEl, '请输入新密码');
        return;
    }
    if (newPwd !== confirmPwd) {
        showError(errorEl, '两次输入的新密码不一致');
        return;
    }
    if (newPwd.length < 6 || newPwd.length > 72) {
        showError(errorEl, '新密码长度需为 6-72 位');
        return;
    }

    hideError(errorEl);

    try {
        const r = await adminApiFetch('updateAdminPassword', {
            method: 'POST',
            body: JSON.stringify({
                oldPassword: oldPwd,
                newPassword: newPwd,
                confirmPassword: confirmPwd,
            }),
        });
        const j = await r.json();
        if (j.success) {
            closeModal();
            showToast('密码修改成功，请使用新密码重新登录', 'success');
            setTimeout(() => {
                AdminState.authed = false;
                AdminState.csrfToken = null;
                AdminState.data = { categories: [], items: [], settings: {} };
                location.reload();
            }, 2000);
        } else {
            showError(errorEl, j.error || '修改失败');
        }
    } catch (e) {
        showError(errorEl, '网络错误，请稍后重试');
    }
}

function showError(el, msg) {
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
    }
}

function hideError(el) {
    if (el) {
        el.textContent = '';
        el.style.display = 'none';
    }
}

/* ========== API 封装 ========== */
async function ensureCsrf() {
    if (AdminState.csrfToken) return AdminState.csrfToken;
    try {
        const r = await fetch(API_BASE + '?action=getCsrfToken');
        const contentType = r.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await r.text();
            console.error('获取 CSRF Token 失败 - 期望 JSON 但收到了:', contentType, '-', text.substring(0, 500));
            throw new Error('服务器返回了非 JSON 响应');
        }
        const j = await r.json();
        if (j.success) AdminState.csrfToken = j.token;
    } catch (e) { console.error(e); }
    return AdminState.csrfToken;
}

async function apiFetch(action, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const url = API_BASE + '?action=' + encodeURIComponent(action);
    if (method === 'GET') {
        return fetch(url, options);
    }
    const token = await ensureCsrf();
    options.headers = options.headers || {};
    if (!options.headers['Content-Type'] && options.body && typeof options.body === 'string') {
        options.headers['Content-Type'] = 'application/json';
    }
    if (token) options.headers['X-CSRF-Token'] = token;
    return fetch(url, options);
}

/**
 * 后台专用 API 请求（admin/api.php）
 * @param {string} action
 * @param {object} options
 */
async function adminApiFetch(action, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const qPos = action.indexOf('?');
    let url;
    if (qPos !== -1) {
        url = 'api.php?action=' + encodeURIComponent(action.substring(0, qPos)) + '&' + action.substring(qPos + 1);
    } else {
        url = 'api.php?action=' + encodeURIComponent(action);
    }
    if (method === 'GET') {
        return fetch(url, options);
    }
    const token = await ensureCsrf();
    const isFormData = options.body instanceof FormData;
    if (!isFormData) {
        options.headers = options.headers || {};
        if (!options.headers['Content-Type'] && options.body && typeof options.body === 'string') {
            options.headers['Content-Type'] = 'application/json';
        }
        if (token) options.headers['X-CSRF-Token'] = token;
    } else {
        // FormData: do NOT set headers object, let browser auto-set Content-Type with boundary
        // Pass CSRF token via FormData field instead of header
        if (token) options.body.append('_csrf', token);
    }
    return fetch(url, options);
}

/* ========== 登录 / 登出 ========== */
/**
 * 初始化登录视图
 * 后台固定使用多用户模式（账号密码登录）
 */
function initLoginView() {
    AdminState.authMode = 'multi-user';
}

async function handleLogin(e) {
    e.preventDefault();
    const errBox = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    errBox.style.display = 'none';

    btn.disabled = true;
    btn.querySelector('.btn-text').style.display = 'none';
    btn.querySelector('.btn-loading').style.display = 'inline';

    try {
        // 后台固定使用多用户模式
        const usernameInput = document.getElementById('loginUsername');
        const pwdInput = document.getElementById('loginPwd');
        const username = usernameInput.value.trim();
        const password = pwdInput.value;

        if (!username || !password) {
            errBox.textContent = '请输入用户名和密码';
            errBox.style.display = 'block';
            return;
        }

        const r = await adminApiFetch('userLogin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const j = await r.json();
        if (j.success) {
            AdminState.authed = true;
            AdminState.csrfToken = null;
            AdminState.currentUser = j.user;
            showToast('登录成功，正在进入后台...', 'success');
            // 登录后刷新页面，确保 PHP 重新渲染带权限的菜单列表
            // （菜单由 PHP 根据权限条件渲染，AJAX 登录后 DOM 中尚无菜单项）
            setTimeout(() => location.reload(), 300);
        } else {
            errBox.textContent = j.error || '用户名或密码错误';
            errBox.style.display = 'block';
        }
    } catch (e) {
        errBox.textContent = '网络错误，请重试';
        errBox.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.querySelector('.btn-text').style.display = 'inline';
        btn.querySelector('.btn-loading').style.display = 'none';
    }
}

async function adminLogout() {
    const ok = await showConfirm('确定要退出登录吗？', 'log-out');
    if (!ok) return;
    AdminState.authed = false;
    AdminState.csrfToken = null;
    AdminState.data = { categories: [], items: [], settings: {} };
    // 停止心跳
    if (AdminState.onlineRefreshTimer) {
        clearInterval(AdminState.onlineRefreshTimer);
        AdminState.onlineRefreshTimer = null;
    }
    try {
        await adminApiFetch('logout', { method: 'POST' });
    } catch (e) {}
    location.reload();
}

/* ========== 视图切换 ========== */
function showAdminShell() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('adminShell').style.display = 'flex';

    // 更新顶部栏用户名
    const user = AdminState.currentUser;
    if (user) {
        const usernameEl = document.getElementById('topbarUsername');
        if (usernameEl) {
            usernameEl.textContent = user.username;
        }
    }

    // 根据用户角色控制菜单可见性
    applyMenuPermissions();

    // 恢复菜单展开/收起状态
    restoreNavState();

    // 启动心跳（60秒间隔）
    if (!AdminState.onlineRefreshTimer) {
        sendHeartbeat();
        AdminState.onlineRefreshTimer = setInterval(sendHeartbeat, 60000);
    }
}

/* ========== 心跳机制 ========== */
async function sendHeartbeat() {
    try {
        const r = await adminApiFetch('heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: AdminState.currentView })
        });
        // 会话过期处理，与其他接口保持一致
        if (r.status === 401) {
            if (AdminState.onlineRefreshTimer) { clearInterval(AdminState.onlineRefreshTimer); AdminState.onlineRefreshTimer = null; }
            // 切换到登录视图，避免停留在无权限的空后台
            AdminState.authed = false;
            document.getElementById('adminShell').style.display = 'none';
            document.getElementById('loginView').style.display = 'flex';
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success && j.kicked) {
            showToast('你已被管理员强制下线', 'error');
            setTimeout(() => location.reload(), 2000);
        }
    } catch (e) {}
}

/**
 * 加载当前登录用户信息
 * @returns {Promise<boolean>} true 表示用户信息加载成功；false 表示需要跳转登录页（已触发 reload）
 */
async function loadCurrentUser() {
    try {
        const r = await adminApiFetch('getCurrentUser');
        if (r.status === 401) {
            // 会话已过期，跳转登录页
            AdminState.currentUser = null;
            AdminState.authed = false;
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return false;
        }
        const j = await r.json();
        if (j.success && j.user) {
            AdminState.currentUser = j.user;
            return true;
        }
        // 会话有效但用户不可用（已被禁用/删除/或非多用户登录），
        // 服务端 getCurrentUser 已清除 settings_authenticated，
        // 此处调用 logout 兜底清除残留会话后跳转登录页
        AdminState.currentUser = null;
        AdminState.authed = false;
        showToast('账号不可用，请重新登录', 'error');
        try { await adminApiFetch('logout', { method: 'POST' }); } catch (e) {}
        setTimeout(() => location.reload(), 1500);
        return false;
    } catch (e) {
        // 网络错误等非致命问题，保留认证状态（可能仅网络波动，恢复后可用）
        console.error('加载用户信息失败:', e);
        AdminState.currentUser = null;
        return false;
    }
}

/**
 * 检查当前用户是否拥有指定权限
 * @param {string|string[]} permission - 权限点或权限点数组（任一满足即可）
 * @returns {boolean}
 */
function hasPermission(permission) {
    const user = AdminState.currentUser;
    if (!user) return false; // 无用户信息时拒绝所有权限

    const perms = user.permissions || [];
    if (perms.includes('*')) return true; // admin 通配

    if (Array.isArray(permission)) {
        return permission.some(p => perms.includes(p));
    }
    return perms.includes(permission);
}

/**
 * 检查权限，不满足时隐藏/禁用元素
 * @param {string} permission
 * @param {string} selector - CSS 选择器
 * @param {string} mode - 'hide' | 'disable'
 */
function applyPermissionGate(permission, selector, mode = 'hide') {
    if (hasPermission(permission)) return;
    document.querySelectorAll(selector).forEach(el => {
        if (mode === 'hide') {
            el.style.display = 'none';
        } else if (mode === 'disable') {
            el.disabled = true;
            el.classList.add('disabled');
            el.title = '权限不足';
        }
    });
}

function applyMenuPermissions() {
    const user = AdminState.currentUser;
    if (!user) {
        document.querySelectorAll('.nav-item[data-view]').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.nav-group').forEach(group => { group.style.display = 'none'; });
        return;
    }

    // 视图与权限点的映射
    const viewPermissionMap = {
        dashboard: 'view.dashboard',
        content: 'view.content',
        dedup: 'view.dedup',
        categories: 'view.categories',
        images: 'view.images',
        backup: 'view.backup',
        access: 'view.access',
        appearance: 'view.appearance',
        system: 'view.system',
        users: 'view.users',
        roles: 'view.roles',
        onlineUsers: 'view.onlineUsers',
        activityLog: 'view.activityLog',
        usageStats: 'view.usageStats',
        shares: 'view.shares',
        serverMonitor: 'view.serverMonitor',
        auditLog: 'view.auditLog',
        drive: 'view.drive',
    };

    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
        const view = el.dataset.view;
        const perm = viewPermissionMap[view];
        if (!perm || hasPermission(perm)) {
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    });

    document.querySelectorAll('.nav-group').forEach(group => {
        const visibleItems = group.querySelectorAll('.nav-sub-item[data-view]');
        let hasVisible = false;
        visibleItems.forEach(item => {
            if (item.style.display !== 'none') {
                hasVisible = true;
            }
        });
        if (!hasVisible) {
            group.style.display = 'none';
        } else {
            group.style.display = '';
        }
    });
}

function switchView(view) {
    AdminState.currentView = view;
    // 停止旧的在线刷新定时器
    if (AdminState._onlineViewTimer) {
        clearInterval(AdminState._onlineViewTimer);
        AdminState._onlineViewTimer = null;
    }
    // 停止服务器监控定时器
    if (_serverMonitorTimer) {
        clearInterval(_serverMonitorTimer);
        _serverMonitorTimer = null;
    }
    // 离开文案管理时清空批量选择
    if (view !== 'content' && AdminState.contentSelected.size > 0) {
        AdminState.contentSelected.clear();
    }
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });
    const activeItem = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (activeItem && activeItem.classList.contains('nav-sub-item')) {
        const group = activeItem.closest('.nav-group');
        if (group) {
            const header = group.querySelector('.nav-group-header');
            const items = group.querySelector('.nav-group-items');
            if (header && items && items.style.display !== 'block') {
                header.classList.add('open');
                items.style.display = 'block';
                if (group.dataset.group) {
                    try {
                        const state = JSON.parse(localStorage.getItem('cpydes_admin_nav_state') || '{}');
                        state[group.dataset.group] = true;
                        localStorage.setItem('cpydes_admin_nav_state', JSON.stringify(state));
                    } catch (e) {}
                }
            }
        }
    }
    document.getElementById('topbarTitle').textContent = VIEW_TITLES[view] || view;
    // 关闭移动端侧边栏
    document.querySelector('.admin-sidebar').classList.remove('open');
    sendHeartbeat();
    renderView();
}

function toggleAdminSidebar() {
    document.querySelector('.admin-sidebar').classList.toggle('open');
}

function toggleNavGroup(header) {
    const group = header.closest('.nav-group');
    const items = header.nextElementSibling;
    const isOpen = items.style.display !== 'none';
    header.classList.toggle('open');
    items.style.display = isOpen ? 'none' : 'block';

    if (group && group.dataset.group) {
        try {
            const state = JSON.parse(localStorage.getItem('cpydes_admin_nav_state') || '{}');
            state[group.dataset.group] = !isOpen;
            localStorage.setItem('cpydes_admin_nav_state', JSON.stringify(state));
        } catch (e) {}
    }
}

function restoreNavState() {
    try {
        const state = JSON.parse(localStorage.getItem('cpydes_admin_nav_state') || '{}');
        const groups = document.querySelectorAll('.nav-group[data-group]');
        groups.forEach(group => {
            const key = group.dataset.group;
            const items = group.querySelector('.nav-group-items');
            const header = group.querySelector('.nav-group-header');
            if (!items || !header) return;

            if (state[key] === true) {
                items.style.display = 'block';
                header.classList.add('open');
            } else if (state[key] === false) {
                items.style.display = 'none';
                header.classList.remove('open');
            }
        });
    } catch (e) {}
}

/* ========== 数据加载 ========== */
async function loadAdminData() {
    try {
        const r = await adminApiFetch('getAll');
        if (r.status === 401) {
            // 会话已过期：切换到登录视图，避免停留在无权限的空后台
            AdminState.authed = false;
            document.getElementById('adminShell').style.display = 'none';
            document.getElementById('loginView').style.display = 'flex';
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        if (r.status === 403) {
            // 无内容视图权限：初始化空数据，让 renderView 显示权限不足提示
            AdminState.data = { categories: [], items: [], settings: {}, users: [] };
            renderView();
            return;
        }
        const j = await r.json();
        if (j.success) {
            AdminState.data = j.data || { categories: [], items: [], users: [] };
            if (!Array.isArray(AdminState.data.categories)) AdminState.data.categories = [];
            if (!Array.isArray(AdminState.data.items)) AdminState.data.items = [];
            if (!AdminState.data.settings) AdminState.data.settings = {};
            if (!Array.isArray(AdminState.data.users)) AdminState.data.users = [];
            // 从已加载的 settings 中同步 copyReminder 到全局（供编辑器计算文案失效提示）
            // getAll 已返回 settings.copyReminder（adminLoadData 合并了 library_settings），
            // 无需额外调用 getLibrarySettings（需要 view.access/view.appearance 权限）
            if (AdminState.data.settings.copyReminder && typeof AdminState.data.settings.copyReminder === 'object') {
                window.COPY_REMINDER = AdminState.data.settings.copyReminder;
            }
            // 同时加载查重策略（失败时使用默认配置，不阻塞主流程）
            loadDedupConfig().finally(renderView).catch(e => console.error(e));
        } else {
            showToast('加载数据失败', 'error');
            renderView();
        }
    } catch (e) {
        console.error(e);
        showToast('加载数据失败', 'error');
        renderView();
    }
}

/**
 * 从后台拉取查重策略并同步到 window.DEDUP_CONFIG（供 dedup.js 读取）
 * @returns {Promise<object>}
 */
async function loadDedupConfig() {
    try {
        const r = await adminApiFetch('getDedupConfig');
        if (r.status === 401) return getDedupConfig ? getDedupConfig() : null;
        const j = await r.json();
        if (j.success && j.config) {
            AdminState.dedupConfig = j.config;
            window.DEDUP_CONFIG = j.config;
            return j.config;
        }
    } catch (e) { console.error('加载查重策略失败:', e); }
    const fallback = (typeof getDedupConfig === 'function') ? getDedupConfig() : null;
    AdminState.dedupConfig = fallback;
    window.DEDUP_CONFIG = fallback;
    return fallback;
}

/**
 * 启动时加载复制提醒配置并同步到 window.COPY_REMINDER
 * 供编辑器底部状态条（UnifiedEditor.computeItemMetaInfo）计算文案失效提示
 * 与 loadCopyReminderConfig（仅打开 Tab 时调用）不同，本函数用于全局预加载
 * @returns {Promise<object|null>}
 */
async function loadCopyReminderConfigGlobal() {
    try {
        const r = await adminApiFetch('getLibrarySettings');
        if (r.status === 401) return null;
        const j = await r.json();
        if (j.success && j.copyReminder) {
            window.COPY_REMINDER = j.copyReminder;
            return j.copyReminder;
        }
    } catch (e) { console.error('加载复制提醒配置失败:', e); }
    return null;
}

async function refreshAdminData() {
    try {
        await loadAdminData();
        showToast('已刷新', 'success', 1500);
    } catch (e) {
        console.error('刷新失败:', e);
        showToast('刷新失败，请重试', 'error');
    }
}

/* ========== 视图渲染入口 ========== */
function renderView() {
    const c = document.getElementById('adminContent');

    // 视图权限映射（合并页面用数组表示"任一子权限即可访问"）
    const viewPermMap = {
        dashboard: 'view.dashboard',
        content: 'view.content',
        dedup: 'view.dedup',
        categories: 'view.categories',
        images: 'view.images',
        shares: 'view.shares',
        announcements: ['view.announcements', 'announcements.manage'],
        drive: 'view.drive',
        backup: 'view.backup',
        system: 'view.system',
        // 合并后的新顶级页面（任一子权限即可访问）
        userManage: ['view.users', 'view.roles'],
        basicSettings: ['view.appearance', 'view.access'],
        statsAnalysis: ['view.onlineUsers', 'view.activityLog', 'view.usageStats'],
        systemMonitor: ['view.serverMonitor', 'view.auditLog'],
        aiManage: 'settings.manage',
        // 旧 navId 保留兼容（直接访问时映射到合并页面对应 Tab）
        access: 'view.access',
        appearance: 'view.appearance',
        users: 'view.users',
        roles: 'view.roles',
        onlineUsers: 'view.onlineUsers',
        activityLog: 'view.activityLog',
        usageStats: 'view.usageStats',
        serverMonitor: 'view.serverMonitor',
        auditLog: 'view.auditLog',
        aiSettings: 'settings.manage',
        aiTasks: 'settings.manage',
    };

    const requiredPerm = viewPermMap[AdminState.currentView];
    if (requiredPerm && !hasPermission(requiredPerm)) {
        c.innerHTML = `<div class="empty-state">
            <div class="empty-icon"><i data-feather="lock" style="width:48px;height:48px;"></i></div>
            <div class="empty-text">权限不足，无法访问此页面</div>
        </div>`;
        refreshFeatherIcons();
        return;
    }

    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载中...</div>';
    switch (AdminState.currentView) {
        case 'dashboard': renderDashboard(); break;
        case 'content': renderContent(); break;
        case 'dedup': renderDedupAnalysis(); break;
        case 'categories': renderCategories(); break;
        case 'images': renderImages(); break;
        case 'shares': renderShares(); break;
        case 'announcements': renderAnnouncements(); break;
        case 'drive': renderDrive(); break;
        case 'backup': renderBackup(); break;
        case 'system': renderSystem(); break;
        // 合并后的新顶级页面
        case 'userManage': renderUserManage(null, AdminState.userManageTab); break;
        case 'basicSettings': renderBasicSettings(null, AdminState.basicSettingsTab); break;
        case 'statsAnalysis': renderStatsAnalysis(null, AdminState.statsAnalysisTab); break;
        case 'systemMonitor': renderSystemMonitorPage(null, AdminState.systemMonitorTab); break;
        case 'aiManage': renderAiManage(null, AdminState.aiManageTab); break;
        // 旧 navId 兼容映射（直接访问时重定向到合并页面对应 Tab）
        case 'access': renderBasicSettings(null, 'protection'); break;
        case 'appearance': renderBasicSettings(null, 'appearance'); break;
        case 'users': renderUserManage(null, 'users'); break;
        case 'roles': renderUserManage(null, 'roles'); break;
        case 'onlineUsers': renderStatsAnalysis(null, 'online'); break;
        case 'activityLog': renderStatsAnalysis(null, 'activity'); break;
        case 'usageStats': renderStatsAnalysis(null, 'usage'); break;
        case 'serverMonitor': renderSystemMonitorPage(null, 'server'); break;
        case 'auditLog': renderSystemMonitorPage(null, 'audit'); break;
        case 'aiSettings': renderAiManage(null, 'settings'); break;
        case 'aiTasks': renderAiManage(null, 'tasks'); break;
        default: renderDashboard();
    }
}


/* ========== 初始化 ========== */
function initAdminTheme() {
    try {
        const saved = localStorage.getItem('cpydes_theme');
        if (saved === 'dark') {
            AdminState.isDark = true;
        } else if (saved === 'light') {
            AdminState.isDark = false;
        } else {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                AdminState.isDark = true;
            }
        }
    } catch (e) {
        console.warn('读取主题设置失败:', e);
    }
    applyAdminTheme();
}

function applyAdminTheme() {
    document.documentElement.classList.toggle('dark-mode', AdminState.isDark);
    const btn = document.getElementById('adminThemeBtn');
    if (btn) {
        btn.innerHTML = AdminState.isDark
            ? '<i data-feather="sun" style="width:18px;height:18px;"></i>'
            : '<i data-feather="moon" style="width:18px;height:18px;"></i>';
        refreshFeatherIcons();
    }
}

function toggleAdminTheme() {
    AdminState.isDark = !AdminState.isDark;
    try {
        localStorage.setItem('cpydes_theme', AdminState.isDark ? 'dark' : 'light');
    } catch (e) {
        console.warn('保存主题设置失败:', e);
    }
    applyAdminTheme();
}

document.addEventListener('DOMContentLoaded', () => {
    initAdminTheme();
    // 绑定登录表单
    const form = document.getElementById('loginForm');
    if (form) form.addEventListener('submit', handleLogin);

    // 根据认证状态显示对应视图
    if (window.ADMIN_AUTHED === true || AdminState.authed) {
        AdminState.authed = true;
        // 加载当前用户信息（用于权限控制）
        loadCurrentUser().then((ok) => {
            if (ok) {
                // 用户信息加载成功，进入后台
                showAdminShell();
                loadAdminData();
            } else if (!AdminState.authed) {
                // 会话过期或账号不可用，loadCurrentUser 已触发 reload，
                // 先切换到登录视图，避免显示无权限的空后台残影
                document.getElementById('adminShell').style.display = 'none';
                document.getElementById('loginView').style.display = 'flex';
            } else {
                // 网络错误等非致命问题，仍尝试显示后台
                showAdminShell();
                loadAdminData();
            }
        }).catch((e) => {
            console.error('初始化失败:', e);
        });
    } else {
        document.getElementById('loginView').style.display = 'flex';
        document.getElementById('adminShell').style.display = 'none';
        initLoginView();
        const pwd = document.getElementById('loginPwd');
        if (pwd) pwd.focus();
    }

    // ESC 关闭弹窗（确认框、查重确认框和 AI 模型编辑框）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('confirmOverlay').style.display !== 'none') {
                closeConfirm(false);
            }
            if (document.getElementById('dedupConfirmOverlay').style.display !== 'none') {
                closeDedupConfirm('cancel');
            }
            if (document.getElementById('aiModelEditOverlay').style.display !== 'none') {
                closeAiModelEdit();
            }
        }
    });
});

