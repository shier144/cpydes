<?php
// 后台管理入口
// 复用主站 api.php 的会话认证体系（settings_authenticated）
// 共享库：session / 用户 / 角色权限
require_once dirname(__DIR__) . '/lib/json_store.php';
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/helpers.php';

// 必须在引入 settings.php 前定义常量，否则其顶部的常量守卫会 403 退出
define('SITE_ROOT', dirname(__DIR__) . DIRECTORY_SEPARATOR);
define('DATA_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'copywriting.json');
define('LIBRARY_SETTINGS_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'library_settings.json');
define('PWD_HASH_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . '.pwd_hash');
define('LIB_PWD_HASH_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . '.lib_pwd_hash');

require_once dirname(__DIR__) . '/lib/settings.php';

cpydes_timezone_init();

// 启动 session（与 api.php 共享）
cpydes_session_start();

// 判断是否已通过后台认证（复用主站 settings_authenticated 会话，超时由 libraryAuthTimeout 统一控制）
$_lib_timeout = getLibraryAuthTimeout();
$is_admin_authed = !empty($_SESSION['settings_authenticated'])
    && $_SESSION['settings_authenticated'] === true
    && ($_lib_timeout === 0 || (time() - ($_SESSION['settings_auth_time'] ?? 0)) <= $_lib_timeout);
unset($_lib_timeout);

// 续期
if ($is_admin_authed) {
    $_SESSION['settings_auth_time'] = time();
}

// 检测是否需要首次设置密码（与 api.php 的 needsPasswordSetup 逻辑一致）
$env_pwd = getenv('SETTINGS_PASSWORD');
$pwd_hash_file = __DIR__ . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . '.pwd_hash';
$needs_pwd_setup = ($env_pwd === false || $env_pwd === '')
    && (!file_exists($pwd_hash_file) || trim((string)file_get_contents($pwd_hash_file)) === '');

// 后台固定使用多用户模式
$auth_mode = 'multi-user';

// 获取当前用户信息与有效权限（复用 lib/auth.php，与 admin/api.php 逻辑一致）
// 后台固定使用多用户模式：settings_authenticated 不足以代表后台已登录，
// 还必须存在 current_user_id 且对应用户处于 active 状态，
// 否则视为未登录（回退到登录视图，避免显示无权限的空后台）
$current_user = null;
$current_user_permissions = [];
if ($is_admin_authed && isset($_SESSION['current_user_id'])) {
    $current_user = cpydes_find_user_by_id($_SESSION['current_user_id']);
    if ($current_user && (isset($current_user['status']) ? $current_user['status'] === 'active' : true)) {
        $current_user_permissions = cpydes_get_user_effective_permissions($current_user);
    } else {
        // 用户已被删除/禁用/封禁，清除会话并回退到登录视图
        unset($_SESSION['settings_authenticated'], $_SESSION['settings_auth_time'], $_SESSION['current_user_id']);
        $current_user = null;
        $is_admin_authed = false;
    }
} elseif ($is_admin_authed) {
    // settings_authenticated 为 true 但缺少 current_user_id（如前台设置密码登录），
    // 后台多用户模式下视为未登录
    unset($_SESSION['settings_authenticated'], $_SESSION['settings_auth_time']);
    $is_admin_authed = false;
}

function php_has_permission($perm, $permissions) {
    if (in_array('*', $permissions, true)) return true;
    return in_array($perm, $permissions, true);
}

// 站点根目录（用于前端 fetch 相对路径）
$site_root = rtrim(dirname(__FILE__), '\\/') . DIRECTORY_SEPARATOR;

// 静态资源版本号：基于 filemtime 实现浏览器缓存破坏
function asset_v($path) {
    $f = __DIR__ . '/' . $path;
    return $path . '?v=' . (is_file($f) ? filemtime($f) : '1');
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>Cpydes文案库 管理后台</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%236366f1' width='100' height='100' rx='20'/%3E%3Ctext x='50' y='68' font-size='52' text-anchor='middle' fill='white'%3E%E7%AE%A1%3C/text%3E%3C/svg%3E">
    <link rel="stylesheet" href="<?php echo asset_v('../css/editor.css'); ?>">
    <link rel="stylesheet" href="<?php echo asset_v('css/admin.css'); ?>">
    <script src="<?php echo asset_v('../js/feather.min.js'); ?>" defer></script>
    <script src="<?php echo asset_v('../js/shared-utils.js'); ?>" defer></script>
    <script>
        // 主题早期初始化（FOUC 防闪烁，必须在首次绘制前同步执行）
        // refreshFeatherIcons / escapeHtml / sanitizeColor 等工具由 shared-utils.js 提供
        (function() {
            try {
                var t = localStorage.getItem('cpydes_theme');
                if (t === 'dark') {
                    document.documentElement.classList.add('dark-mode');
                } else if (t !== 'light') {
                    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                        document.documentElement.classList.add('dark-mode');
                    }
                }
            } catch(e) {}
            // 后台专属：恢复侧边栏分组展开/收起状态（避免闪烁）
            try {
                var navState = localStorage.getItem('cpydes_admin_nav_state');
                if (navState) {
                    var state = JSON.parse(navState);
                    var groups = ['content', 'users', 'stats', 'system'];
                    for (var i = 0; i < groups.length; i++) {
                        var key = groups[i];
                        if (state[key] === false) {
                            document.documentElement.setAttribute('data-nav-' + key, 'closed');
                        } else if (state[key] === true) {
                            document.documentElement.setAttribute('data-nav-' + key, 'open');
                        }
                    }
                }
            } catch(e) {}
        })();
    </script>
</head>
<body data-authed="<?php echo $is_admin_authed ? '1' : '0'; ?>">

<!-- ============ 登录视图 ============ -->
<div class="login-view" id="loginView"<?php echo $is_admin_authed ? ' style="display:none;"' : ''; ?>>
    <div class="login-card">
        <div class="login-brand">
            <div class="login-logo">
                <span class="logo-letter">C</span>
                <span class="logo-glow"></span>
            </div>
            <div>
                <div class="login-title">Cpydes 管理后台</div>
                <div class="login-sub" id="loginSub"><?php echo $auth_mode === 'multi-user' ? '请输入用户名和密码登录' : '请输入管理密码以继续'; ?></div>
            </div>
        </div>
        <form id="loginForm" class="login-form" autocomplete="off">
            <div class="form-group">
                <label class="form-label">用户名</label>
                <input type="text" id="loginUsername" class="form-input"
                       placeholder="请输入用户名..." autocomplete="username"
                       required>
            </div>
            <div class="form-group">
                <label class="form-label">密码</label>
                <input type="password" id="loginPwd" class="form-input"
                       placeholder="请输入密码..." autocomplete="current-password"
                       required>
            </div>
            <div class="login-error" id="loginError" style="display:none;"></div>
            <button type="submit" class="btn btn-primary btn-block" id="loginBtn">
                <span class="btn-text" id="loginBtnText"><i data-feather="lock" style="width:16px;height:16px;"></i> 登录</span>
                <span class="btn-loading" style="display:none;">处理中...</span>
            </button>
        </form>
        <div class="login-foot">
            <a href="../index.php" class="login-back"><i data-feather="arrow-left" style="width:12px;height:12px;"></i> 返回前台</a>
        </div>
    </div>
</div>

<!-- ============ 后台主界面 ============ -->
<div class="admin-shell" id="adminShell"<?php echo $is_admin_authed ? ' style="display:flex;"' : ' style="display:none;"'; ?>>

    <!-- 侧边栏 -->
    <aside class="admin-sidebar">
        <div class="admin-brand">
            <div class="admin-logo">
                <span class="logo-letter">C</span>
                <span class="logo-glow"></span>
            </div>
            <div>
                <div class="admin-brand-title">Cpydes 后台</div>
                <div class="admin-brand-sub">管理中心</div>
            </div>
        </div>
        <nav class="admin-nav">
            <?php if (php_has_permission('view.dashboard', $current_user_permissions)): ?>
            <a class="nav-item active" data-view="dashboard" onclick="switchView('dashboard')">
                <span class="nav-ico"><i data-feather="bar-chart-2"></i></span><span>仪表盘</span>
            </a>
            <?php endif; ?>

            <?php if (php_has_permission('view.content', $current_user_permissions) || php_has_permission('view.categories', $current_user_permissions) || php_has_permission('view.images', $current_user_permissions) || php_has_permission('view.dedup', $current_user_permissions) || php_has_permission('view.shares', $current_user_permissions) || php_has_permission('view.announcements', $current_user_permissions) || php_has_permission('announcements.manage', $current_user_permissions)): ?>
            <div class="nav-group" data-group="content">
                <div class="nav-group-header" onclick="toggleNavGroup(this)">
                    <span class="nav-group-icon"><i data-feather="archive"></i></span>
                    <span class="nav-group-title">内容管理</span>
                    <span class="nav-group-arrow"><i data-feather="chevron-down"></i></span>
                </div>
                <div class="nav-group-items">
                    <?php if (php_has_permission('view.content', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="content" onclick="switchView('content')">
                        <span class="nav-ico"><i data-feather="file-text"></i></span><span>文案管理</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('view.categories', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="categories" onclick="switchView('categories')">
                        <span class="nav-ico"><i data-feather="folder"></i></span><span>分类管理</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('view.images', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="images" onclick="switchView('images')">
                        <span class="nav-ico"><i data-feather="image"></i></span><span>图片管理</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('view.dedup', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="dedup" onclick="switchView('dedup')">
                        <span class="nav-ico"><i data-feather="search"></i></span><span>查重分析</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('view.shares', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="shares" onclick="switchView('shares')">
                        <span class="nav-ico"><i data-feather="share-2"></i></span><span>分享管理</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('view.announcements', $current_user_permissions) || php_has_permission('announcements.manage', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="announcements" onclick="switchView('announcements')">
                        <span class="nav-ico"><i data-feather="bell"></i></span><span>公告管理</span>
                    </a>
                    <?php endif; ?>
                </div>
            </div>
            <?php endif; ?>

            <?php if (php_has_permission('view.drive', $current_user_permissions)): ?>
            <a class="nav-item" data-view="drive" onclick="switchView('drive')">
                <span class="nav-ico"><i data-feather="hard-drive"></i></span><span>数据网盘</span>
            </a>
            <?php endif; ?>

            <?php if (php_has_permission('view.users', $current_user_permissions) || php_has_permission('view.roles', $current_user_permissions)): ?>
            <a class="nav-item" data-view="userManage" onclick="switchView('userManage')">
                <span class="nav-ico"><i data-feather="users"></i></span><span>用户管理</span>
            </a>
            <?php endif; ?>

            <?php if (php_has_permission('view.appearance', $current_user_permissions) || php_has_permission('view.access', $current_user_permissions)): ?>
            <a class="nav-item" data-view="basicSettings" onclick="switchView('basicSettings')">
                <span class="nav-ico"><i data-feather="sliders"></i></span><span>基础设置</span>
            </a>
            <?php endif; ?>

            <?php if (php_has_permission('view.onlineUsers', $current_user_permissions) || php_has_permission('view.activityLog', $current_user_permissions) || php_has_permission('view.usageStats', $current_user_permissions) || php_has_permission('view.serverMonitor', $current_user_permissions) || php_has_permission('view.auditLog', $current_user_permissions) || php_has_permission('settings.manage', $current_user_permissions) || php_has_permission('view.backup', $current_user_permissions) || php_has_permission('view.system', $current_user_permissions)): ?>
            <div class="nav-group" data-group="system">
                <div class="nav-group-header" onclick="toggleNavGroup(this)">
                    <span class="nav-group-icon"><i data-feather="settings"></i></span>
                    <span class="nav-group-title">系统设置</span>
                    <span class="nav-group-arrow"><i data-feather="chevron-down"></i></span>
                </div>
                <div class="nav-group-items">
                    <?php if (php_has_permission('view.onlineUsers', $current_user_permissions) || php_has_permission('view.activityLog', $current_user_permissions) || php_has_permission('view.usageStats', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="statsAnalysis" onclick="switchView('statsAnalysis')">
                        <span class="nav-ico"><i data-feather="activity"></i></span><span>统计分析</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('view.serverMonitor', $current_user_permissions) || php_has_permission('view.auditLog', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="systemMonitor" onclick="switchView('systemMonitor')">
                        <span class="nav-ico"><i data-feather="monitor"></i></span><span>系统监控</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('settings.manage', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="aiManage" onclick="switchView('aiManage')">
                        <span class="nav-ico"><i data-feather="cpu"></i></span><span>AI 管理</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('view.backup', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="backup" onclick="switchView('backup')">
                        <span class="nav-ico"><i data-feather="database"></i></span><span>备份恢复</span>
                    </a>
                    <?php endif; ?>
                    <?php if (php_has_permission('view.system', $current_user_permissions)): ?>
                    <a class="nav-item nav-sub-item" data-view="system" onclick="switchView('system')">
                        <span class="nav-ico"><i data-feather="info"></i></span><span>系统信息</span>
                    </a>
                    <?php endif; ?>
                </div>
            </div>
            <?php endif; ?>
        </nav>
        <div class="admin-sidebar-foot">
            <a href="../index.php" class="nav-item" target="_blank">
                <span class="nav-ico"><i data-feather="external-link"></i></span><span>访问前台</span>
            </a>
            <a class="nav-item nav-logout" onclick="adminLogout()">
                <span class="nav-ico"><i data-feather="log-out"></i></span><span>退出登录</span>
            </a>
        </div>
    </aside>

    <!-- 主内容区 -->
    <main class="admin-main">
        <header class="admin-topbar">
            <button class="topbar-menu" onclick="toggleAdminSidebar()" aria-label="菜单"><i data-feather="menu" style="width:20px;height:20px;"></i></button>
            <div class="topbar-title" id="topbarTitle">仪表盘</div>
            <div class="topbar-actions">
                <button class="btn btn-default btn-sm topbar-theme-btn" onclick="toggleAdminTheme()" title="切换主题" id="adminThemeBtn"><i data-feather="moon" style="width:16px;height:16px;"></i></button>
                <button class="btn btn-default btn-sm" onclick="refreshAdminData()"><i data-feather="refresh-cw" style="width:14px;height:14px;"></i> 刷新</button>
                <div class="topbar-user-dropdown">
                    <button class="btn btn-default btn-sm topbar-user-btn" id="topbarUser" onclick="toggleUserDropdown()"><i data-feather="user" style="width:14px;height:14px;"></i> <span id="topbarUsername">管理员</span> <i data-feather="chevron-down" style="width:12px;height:12px;"></i></button>
                    <div class="user-dropdown-menu" id="userDropdownMenu" style="display:none;">
                        <div class="user-dropdown-item" onclick="openChangeUsername()">
                            <i data-feather="edit-3" style="width:14px;height:14px;"></i> 修改用户名
                        </div>
                        <div class="user-dropdown-item" onclick="openChangePassword()">
                            <i data-feather="key" style="width:14px;height:14px;"></i> 修改密码
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <section class="admin-content" id="adminContent">
            <!-- 视图动态注入 -->
        </section>
    </main>
</div>

<!-- ============ 通用模态框 ============ -->
<div class="modal-overlay" id="modalOverlay" style="display:none;">
    <div class="modal-backdrop"></div>
    <div class="modal-dialog">
        <div class="modal-head">
            <div class="modal-title" id="modalTitle"></div>
            <div class="modal-head-meta" id="modalHeadMeta"></div>
            <button class="modal-close" onclick="closeModal()"><i data-feather="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="modal-body" id="modalBody"></div>
        <div class="modal-foot" id="modalFoot"></div>
    </div>
</div>

<!-- ============ 确认框 ============ -->
<div class="confirm-overlay" id="confirmOverlay" style="display:none;">
    <div class="confirm-box">
        <div class="confirm-icon" id="confirmIcon"><i data-feather="alert-triangle"></i></div>
        <div class="confirm-msg" id="confirmMsg"></div>
        <div class="confirm-actions">
            <button class="btn btn-default" onclick="closeConfirm(false)">取消</button>
            <button class="btn btn-primary" onclick="closeConfirm(true)">确定</button>
        </div>
    </div>
</div>

<!-- ============ 查重富信息确认框 ============ -->
<div class="dedup-confirm-overlay" id="dedupConfirmOverlay" style="display:none;">
    <div class="dedup-confirm-box" id="dedupConfirmBox">
        <div class="dedup-confirm-head">
            <div class="dedup-confirm-icon" id="dedupConfirmIcon"><i data-feather="alert-triangle"></i></div>
            <div class="dedup-confirm-title">检测到内容重复</div>
        </div>
        <div class="dedup-confirm-body">
            <div class="dedup-confirm-target">
                <span class="dedup-confirm-label">与现有文案：</span>
                <span class="dedup-confirm-link" id="dedupConfirmLink" title="该文案已存在于文案库"></span>
            </div>
            <div class="dedup-confirm-stats">
                <div class="dedup-stat-item">
                    <div class="dedup-stat-num" id="dedupConfirmSim">0%</div>
                    <div class="dedup-stat-name">重复率</div>
                </div>
                <div class="dedup-stat-item">
                    <div class="dedup-stat-num" id="dedupConfirmChars">0 字</div>
                    <div class="dedup-stat-name">重复字数</div>
                </div>
            </div>
            <div class="dedup-confirm-bar">
                <div class="dedup-confirm-bar-fill" id="dedupConfirmBarFill"></div>
            </div>
            <div class="dedup-confirm-snip" id="dedupConfirmSnip"></div>
            <div class="dedup-confirm-hint">建议先查看重复文案，确认是否仍需保存为新条目。</div>
        </div>
        <div class="dedup-confirm-actions">
            <button class="btn btn-default" onclick="closeDedupConfirm('cancel')">取消</button>
            <button class="btn btn-default" onclick="closeDedupConfirm('view')">查看该文案</button>
            <button class="btn btn-primary" onclick="closeDedupConfirm('save')">仍然保存</button>
        </div>
    </div>
</div>

<!-- ============ Toast ============ -->
<div class="toast-container" id="toastContainer"></div>

<script>
    // 暴露给 JS 的初始状态
    window.ADMIN_AUTHED = <?php echo $is_admin_authed ? 'true' : 'false'; ?>;
    // 是否需要首次设置密码
    window.NEEDS_PWD_SETUP = <?php echo $needs_pwd_setup ? 'true' : 'false'; ?>;
    // 主站 API 路径
    window.API_BASE = '../api.php';
</script>
<script src="<?php echo asset_v('../js/modules/dedup.js'); ?>" defer></script>
<script>
    // 为统一编辑器配置后台上下文（必须在 editor.js 加载前设置）
    // 注意：editor.js 会通过 ensureCsrf() + X-CSRF-Token header 自行处理 CSRF，
    // 所以 apiFetch 直接透传 fetch 即可（不能用 adminApiFetch/apiFetch，
    // 因为它们期望第一个参数是 action 而非完整 URL，会错误拼接）
    window.EDITOR_CONTEXT = {
        imagePathPrefix: '../',
        uploadUrl: '../api.php?action=uploadImage',
        proxyUrl: '../api.php?action=proxyImage',
        withCsrf: true,
        hasPermission: function (perm) {
            return (typeof hasPermission === 'function') ? hasPermission(perm) : true;
        },
        onImageClick: function (src) {
            if (typeof previewImage === 'function') previewImage(src);
        },
        apiFetch: function (url, opts) {
            return fetch(url, opts);
        },
        ensureCsrf: function () {
            return (typeof ensureCsrf === 'function') ? ensureCsrf() : Promise.resolve(null);
        },
        showToast: function (msg, type) {
            if (typeof showToast === 'function') showToast(msg, type);
        }
    };
</script>
<script src="<?php echo asset_v('../js/modules/editor.js'); ?>" defer></script>
<!-- admin.js 已按功能区块机械拆分为 7 个模块，依赖顺序加载（core 必须最先） -->
<script src="<?php echo asset_v('js/admin-core.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/admin-content.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/admin-images.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/admin-users.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/admin-system.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/admin-drive.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/admin-ai.js'); ?>" defer></script>
<script src="<?php echo asset_v('js/admin-announcements.js'); ?>" defer></script>
<script>
    // defer 脚本在 DOMContentLoaded 前执行完毕，此时 feather 必已就绪
    document.addEventListener('DOMContentLoaded', function () {
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    });
</script>
</body>
</html>