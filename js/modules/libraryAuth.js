// ========== 文案库访问密码保护 ==========
// 控制前台文案库的访问权限：支持访问码和账户密码两种验证方式

// 提交中（防重复点击）- 仍用局部变量，因为这是瞬态 UI 状态
let _libAuthSubmitting = false;

/**
 * 页面加载时检查文案库访问状态
 */
async function checkLibraryAccess() {
    const gate = document.getElementById('libraryGate');
    const gateIcon = document.getElementById('libGateIcon');
    const gateText = document.getElementById('libGateText');
    const gateSub = document.getElementById('libGateSub');
    const gateBtn = document.getElementById('libGateBtn');

    // 显示加载状态
    if (gate) gate.classList.add('loading');
    if (gateText) gateText.textContent = '加载中...';
    if (gateSub) gateSub.textContent = '正在初始化';
    if (gateBtn) gateBtn.style.display = 'none';
    if (gateIcon && gateIcon.querySelector('i')) {
        gateIcon.querySelector('i').setAttribute('data-feather', 'loader');
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }

    try {
        const r = await fetch('api.php?action=getLibraryAccessStatus');
        const contentType = r.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await r.text();
            console.error('期望 JSON 响应但收到了:', contentType, '-', text.substring(0, 500));
            throw new Error('服务器返回了非 JSON 响应');
        }
        const j = await r.json();
        if (j.success) {
            appState.setState('auth.protectionEnabled', !!j.protectionEnabled);
            appState.setState('auth.authenticated', !!j.authenticated);
            appState.setState('auth.allowGuestAccess', !!j.allowGuestAccess);
            appState.setState('auth.registrationEnabled', !!j.registrationEnabled);

            if (j.guestPermissions && Array.isArray(j.guestPermissions)) {
                appState.setState('auth.guestPermissions', j.guestPermissions);
            }

            if (j.user) {
                appState.setState('auth.user', j.user);
                // 已登录用户：从云端同步收藏（跨设备数据一致）
                if (j.authenticated && typeof loadCloudFavorites === 'function') {
                    loadCloudFavorites();
                }
            }

            if (!appState.getState('auth.protectionEnabled')) {
                showAppContent();
                // 保护关闭：未登录显示登录按钮，已登录显示注销登录按钮
                if (appState.getState('auth.user')) {
                    showLibraryLockBtn('logout');
                } else {
                    showLibraryLockBtn('login');
                }
                applyPermissionGating();
                return true;
            }

            // 保护开启 + 允许访客访问（未登录）：显示内容并应用访客权限限制，显示登录按钮
            if (appState.getState('auth.allowGuestAccess') && !appState.getState('auth.user')) {
                showAppContent();
                showLibraryLockBtn('login');
                applyPermissionGating();
                return true;
            }

            if (appState.getState('auth.authenticated')) {
                showAppContent();
                showLibraryLockBtn('logout');
                applyPermissionGating();
                return true;
            }

            showLibraryGate();
            return false;
        }
    } catch (e) {
        console.error('检查文案库访问状态失败:', e);
        // 安全修复：网络错误时不应放行访问，否则会绕过文案库密码保护
        // 显示错误状态而不是直接显示应用内容
        if (gate) gate.classList.remove('loading');
        if (gateText) gateText.textContent = '连接失败';
        if (gateSub) gateSub.textContent = '无法连接服务器，请检查网络后重试';
        if (gateBtn) {
            gateBtn.style.display = '';
            gateBtn.textContent = '重试';
            gateBtn.onclick = function() { location.reload(); };
        }
        if (gateIcon && gateIcon.querySelector('i')) {
            gateIcon.querySelector('i').setAttribute('data-feather', 'wifi-off');
            if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
        }
    }
    return false;
}

/**
 * 打开密码验证弹窗
 */
function openLibraryAuth() {
    const overlay = document.getElementById('libraryAuthOverlay');
    if (!overlay) return;
    overlay.classList.add('show');
    showLoginForm();
    document.body.style.overflow = 'hidden';
    const userInput = document.getElementById('libUsernameInput');
    setTimeout(function() { if (userInput) userInput.focus(); }, 100);
}

/**
 * 切换到登录模式（重置输入与错误）
 */
function showLoginForm() {
    const modeAccount = document.getElementById('libAuthModeAccount');
    const modeRegister = document.getElementById('libAuthModeRegister');
    if (modeAccount) modeAccount.style.display = '';
    if (modeRegister) modeRegister.style.display = 'none';

    const userInput = document.getElementById('libUsernameInput');
    const pwdInput = document.getElementById('libPasswordInput');
    if (userInput) userInput.value = '';
    if (pwdInput) pwdInput.value = '';
    hideLibAuthAccountError();

    // 根据后台是否开启注册，控制"立即注册"链接显示
    const regLink = document.getElementById('libAuthRegisterLink');
    if (regLink) {
        regLink.style.display = appState.getState('auth.registrationEnabled') ? '' : 'none';
    }

    const titleEl = document.getElementById('libAuthTitle');
    const subEl = document.getElementById('libAuthSub');
    if (titleEl) titleEl.textContent = '文案库访问验证';
    if (subEl) subEl.textContent = '请使用账户登录以查看文案库内容';
}

/**
 * 切换到注册模式（重置输入与错误）
 */
function showRegisterForm() {
    const modeAccount = document.getElementById('libAuthModeAccount');
    const modeRegister = document.getElementById('libAuthModeRegister');
    if (modeAccount) modeAccount.style.display = 'none';
    if (modeRegister) modeRegister.style.display = '';

    const userInput = document.getElementById('libRegUsernameInput');
    const pwdInput = document.getElementById('libRegPasswordInput');
    const confirmInput = document.getElementById('libRegConfirmInput');
    if (userInput) userInput.value = '';
    if (pwdInput) pwdInput.value = '';
    if (confirmInput) confirmInput.value = '';
    hideLibAuthRegisterError();

    const titleEl = document.getElementById('libAuthTitle');
    const subEl = document.getElementById('libAuthSub');
    if (titleEl) titleEl.textContent = '注册新账户';
    if (subEl) subEl.textContent = '注册后将自动登录并以默认身份访问文案库';

    if (userInput) userInput.focus();
}

/**
 * 打开注册模式（外部入口）
 */
function openRegisterForm() {
    showRegisterForm();
}

/**
 * 返回登录模式（外部入口）
 */
function closeRegisterForm() {
    showLoginForm();
    const userInput = document.getElementById('libUsernameInput');
    if (userInput) userInput.focus();
}

/**
 * 关闭密码验证弹窗（不退出验证状态）
 */
function closeLibraryAuth() {
    const overlay = document.getElementById('libraryAuthOverlay');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
}

/**
 * 取消按钮：关闭弹窗，仅在需要时显示加密占位
 */
function cancelLibraryAuth() {
    closeLibraryAuth();
    // 只有在"保护开启 + 不允许访客"时才显示加密页面
    const protectionEnabled = appState.getState('auth.protectionEnabled');
    const allowGuestAccess = appState.getState('auth.allowGuestAccess');
    if (protectionEnabled && !allowGuestAccess) {
        showLibraryGate();
    }
}

/**
 * 显示加密占位遮罩
 */
function showLibraryGate() {
    const gate = document.getElementById('libraryGate');
    const gateIcon = document.getElementById('libGateIcon');
    const gateText = document.getElementById('libGateText');
    const gateSub = document.getElementById('libGateSub');
    const gateBtn = document.getElementById('libGateBtn');

    if (gate) {
        gate.style.display = 'flex';
        gate.classList.remove('loading');
    }
    if (gateIcon && gateIcon.querySelector('i')) {
        gateIcon.querySelector('i').setAttribute('data-feather', 'shield');
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }
    if (gateText) gateText.textContent = '文案库已加密';
    if (gateSub) gateSub.textContent = '请登录账户以查看内容';
    if (gateBtn) gateBtn.style.display = '';
}

/**
 * 隐藏加密占位遮罩
 */
function hideLibraryGate() {
    const gate = document.getElementById('libraryGate');
    if (gate) gate.style.display = 'none';
}

/**
 * 隐藏应用主内容（未验证时）
 */
function hideAppContent() {
    const container = document.getElementById('appContainer');
    if (container) container.style.display = 'none';
    showLibraryGate();
}

/**
 * 显示应用主内容（验证成功后）
 */
function showAppContent() {
    hideLibraryGate();
    const container = document.getElementById('appContainer');
    if (container) container.style.display = '';
    document.body.classList.remove('app-loading');
    document.body.classList.add('app-loaded');
}

/**
 * 显示/隐藏登录按钮
 * @param {boolean|string} state - false=隐藏, 'login'=显示登录按钮, 'logout'=显示注销登录按钮
 */
function showLibraryLockBtn(state) {
    const btn = document.getElementById('libraryLockBtn');
    if (!btn) return;
    if (!state) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';
    if (state === 'login') {
        btn.innerHTML = '<i data-feather="log-in" style="width:14px;height:14px;"></i> 登录';
        btn.title = '账户登录';
        btn.onclick = openLibraryAuth;
    } else if (state === 'logout') {
        // 显示当前用户名（点击后注销登录）
        const user = appState.getState('auth.user');
        const username = user ? user.username : '用户';
        btn.innerHTML = '<span>' + escapeHtml(username) + '</span> <i data-feather="log-out" style="width:14px;height:14px;"></i>';
        btn.title = '点击注销登录';
        btn.onclick = libraryLogout;
    }
    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
}

/**
 * 退出文案库访问（主动登出）
 */
async function libraryLogout() {
    if (typeof showConfirm === 'function') {
        const ok = await showConfirm('退出后将需要重新登录账户访问文案库，确定退出吗？', 'lock');
        if (!ok) return;
    }
    if (typeof _accountLockoutTimer !== 'undefined' && _accountLockoutTimer) { clearInterval(_accountLockoutTimer); _accountLockoutTimer = null; }
    try {
        await apiFetch('api.php?action=libraryLogout', { method: 'POST' });
    } catch (e) { /* 忽略网络错误 */ }
    appState.setState('auth.authenticated', false);
    appState.setState('auth.user', null);

    const protectionEnabled = appState.getState('auth.protectionEnabled');
    const allowGuestAccess = appState.getState('auth.allowGuestAccess');

    if (protectionEnabled && !allowGuestAccess) {
        // 保护开启 + 不允许访客：显示加密页面
        hideAppContent();
        showLibraryGate();
    } else {
        // 保护关闭 或 允许访客：显示内容，显示登录按钮
        showAppContent();
        showLibraryLockBtn('login');
        applyPermissionGating();
    }

    if (typeof showToast === 'function') {
        showToast('已退出登录', 'info', 1500);
    }
}

/**
 * 显示账户密码模式的错误信息
 */
function showLibAuthAccountError(msg) {
    const el = document.getElementById('libAuthAccountError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
    const input = document.getElementById('libUsernameInput');
    if (input) {
        input.style.animation = 'none';
        input.offsetHeight;
        input.style.animation = 'shake 0.4s ease';
        input.value = '';
        input.focus();
    }
}

function hideLibAuthAccountError() {
    const el = document.getElementById('libAuthAccountError');
    if (el) el.style.display = 'none';
}

/**
 * 账户密码模式登录
 */
async function verifyUserLogin() {
    if (_libAuthSubmitting) return;

    const usernameInput = document.getElementById('libUsernameInput');
    const passwordInput = document.getElementById('libPasswordInput');
    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username) {
        showLibAuthAccountError('请输入用户名');
        return;
    }
    if (!password) {
        showLibAuthAccountError('请输入密码');
        return;
    }

    _libAuthSubmitting = true;
    const btn = document.getElementById('libAuthAccountSubmitBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '登录中...';
    }
    hideLibAuthAccountError();

    try {
        const r = await fetch('api.php?action=verifyUserLogin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (r.status === 429) {
            const j = await r.json();
            const waitSec = j.lockout || 900;
            const waitMin = Math.ceil(waitSec / 60);
            showLibAuthAccountError('尝试次数过多，已锁定 ' + waitMin + ' 分钟');
            if (btn) { btn.disabled = true; btn.textContent = '已锁定'; }
            startAccountLockoutCountdown(waitSec);
            return;
        }

        const j = await r.json();
        if (j.success) {
            appState.setState('auth.authenticated', true);
            closeLibraryAuth();
            showAppContent();
            showLibraryLockBtn('logout');
            if (j.user) {
                appState.setState('auth.user', j.user);
                // 登录成功：从云端同步收藏（跨设备数据一致）
                if (typeof loadCloudFavorites === 'function') {
                    loadCloudFavorites();
                }
            }
            applyPermissionGating();
            if (typeof loadData === 'function') {
                loadData();
            }
            if (typeof showToast === 'function') {
                showToast('登录成功', 'success', 1500);
            }
        } else {
            const remaining = typeof j.remaining === 'number' ? j.remaining : null;
            if (remaining !== null && remaining > 0) {
                showLibAuthAccountError('用户名或密码错误，剩余 ' + remaining + ' 次尝试机会');
            } else if (remaining === 0) {
                showLibAuthAccountError('用户名或密码错误，即将锁定');
            } else {
                showLibAuthAccountError(j.error || '用户名或密码错误');
            }
        }
    } catch (e) {
        console.error('账户登录失败:', e);
        showLibAuthAccountError('登录请求失败，请重试');
    } finally {
        _libAuthSubmitting = false;
        if (btn && btn.textContent !== '已锁定') {
            btn.disabled = false;
            btn.textContent = '登录';
        }
    }
}

/**
 * 显示注册模式的错误信息
 */
function showLibAuthRegisterError(msg) {
    const el = document.getElementById('libAuthRegisterError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
    // 抖动第一个有值的输入框
    const inputs = ['libRegUsernameInput', 'libRegPasswordInput', 'libRegConfirmInput'];
    for (const id of inputs) {
        const input = document.getElementById(id);
        if (input) {
            input.style.animation = 'none';
            input.offsetHeight;
            input.style.animation = 'shake 0.4s ease';
            break;
        }
    }
}

function hideLibAuthRegisterError() {
    const el = document.getElementById('libAuthRegisterError');
    if (el) el.style.display = 'none';
}

/**
 * 提交注册
 */
async function registerUser() {
    if (_libAuthSubmitting) return;

    const usernameInput = document.getElementById('libRegUsernameInput');
    const passwordInput = document.getElementById('libRegPasswordInput');
    const confirmInput = document.getElementById('libRegConfirmInput');
    if (!usernameInput || !passwordInput || !confirmInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;

    if (!username) {
        showLibAuthRegisterError('请输入用户名');
        return;
    }
    if (!password) {
        showLibAuthRegisterError('请设置密码');
        return;
    }
    if (!confirmPassword) {
        showLibAuthRegisterError('请再次输入密码');
        return;
    }
    if (password !== confirmPassword) {
        showLibAuthRegisterError('两次输入的密码不一致');
        return;
    }

    _libAuthSubmitting = true;
    const btn = document.getElementById('libAuthRegisterSubmitBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '注册中...';
    }
    hideLibAuthRegisterError();

    try {
        const r = await fetch('api.php?action=registerUser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, confirmPassword })
        });

        if (r.status === 429) {
            const j = await r.json();
            const waitSec = j.lockout || 900;
            const waitMin = Math.ceil(waitSec / 60);
            showLibAuthRegisterError('尝试次数过多，已锁定 ' + waitMin + ' 分钟，请稍后再试');
            if (btn) { btn.disabled = true; btn.textContent = '已锁定'; }
            return;
        }

        const j = await r.json();
        if (j.success) {
            appState.setState('auth.authenticated', true);
            closeLibraryAuth();
            showAppContent();
            showLibraryLockBtn('logout');
            if (j.user) {
                appState.setState('auth.user', j.user);
                // 注册后从云端同步收藏（与登录一致）
                if (typeof loadCloudFavorites === 'function') {
                    loadCloudFavorites();
                }
            }
            applyPermissionGating();
            if (typeof loadData === 'function') {
                loadData();
            }
            if (typeof showToast === 'function') {
                showToast('注册成功，已自动登录', 'success', 1500);
            }
        } else {
            const remaining = typeof j.remaining === 'number' ? j.remaining : null;
            if (remaining !== null && remaining > 0) {
                showLibAuthRegisterError((j.error || '注册失败') + '，剩余 ' + remaining + ' 次尝试机会');
            } else {
                showLibAuthRegisterError(j.error || '注册失败');
            }
        }
    } catch (e) {
        console.error('注册失败:', e);
        showLibAuthRegisterError('注册请求失败，请重试');
    } finally {
        _libAuthSubmitting = false;
        if (btn && btn.textContent !== '已锁定') {
            btn.disabled = false;
            btn.textContent = '注册';
        }
    }
}

/**
 * 账户模式锁定倒计时
 */
let _accountLockoutTimer = null;
function startAccountLockoutCountdown(seconds) {
    if (_accountLockoutTimer) clearInterval(_accountLockoutTimer);
    let remaining = seconds;
    const btn = document.getElementById('libAuthAccountSubmitBtn');
    const errorEl = document.getElementById('libAuthAccountError');
    _accountLockoutTimer = setInterval(function() {
        remaining--;
        if (remaining <= 0) {
            clearInterval(_accountLockoutTimer);
            _accountLockoutTimer = null;
            if (btn) { btn.disabled = false; btn.textContent = '登录'; }
            hideLibAuthAccountError();
            const input = document.getElementById('libUsernameInput');
            if (input) input.focus();
        } else {
            const min = Math.floor(remaining / 60);
            const sec = remaining % 60;
            if (errorEl) {
                errorEl.textContent = '锁定中，剩余 ' + min + ':' + (sec < 10 ? '0' : '') + sec;
                errorEl.style.display = '';
            }
        }
    }, 1000);
}

/**
 * 根据当前用户权限隐藏/禁用 UI 元素
 */
function applyPermissionGating() {
    _gateEl('.app-actions .btn-primary', 'content.create');
    _gateEl('.sidebar-footer .add-cat-btn', 'categories.manage');
    _gateEl('.sidebar-footer .add-sub-cat-btn', 'categories.manage');
    _gateEl('.top-add-cat-btn', 'categories.manage');
    // AI 入口：需要账户登录且拥有 ai.use 权限
    _gateEl('.ai-entry-btn', 'ai.use');
}

function _gateEl(selector, permission) {
    const hasPerm = hasPermission(permission);
    document.querySelectorAll(selector).forEach(el => {
        // 有权限：清除内联 display，恢复 CSS 默认显示；无权限：隐藏
        el.style.display = hasPerm ? '' : 'none';
    });
}
