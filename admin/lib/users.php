<?php
// 由 admin/api.php 机械拆分而来，用户清理/认证网关 + 当前用户/角色权限 + 活动日志/在线用户/审计日志；仅供 admin/api.php 引入
if (!defined('SITE_ROOT')) { http_response_code(403); exit; }

/**
 * 清理指定用户的云端收藏数据（用户删除时调用）
 * @param string $userId
 */
function cleanupUserFavorites($userId) {
    if ($userId === '' || !file_exists(FAVORITES_FILE)) return;
    $lockFp = fopen(FAVORITES_LOCK_FILE, 'c');
    if (!$lockFp) return;
    if (!flock($lockFp, LOCK_EX)) {
        fclose($lockFp);
        return;
    }
    try {
        $raw = @file_get_contents(FAVORITES_FILE);
        if ($raw === false) return;
        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['favorites']) || !is_array($data['favorites'])) return;
        if (!isset($data['favorites'][$userId])) return;
        unset($data['favorites'][$userId]);
        // 原子写入（失败时保留原文件）
        cpydes_json_save_atomic(FAVORITES_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    } finally {
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
    }
}

// 合法的页面视图标识白名单（用于心跳 page 参数校验）
$VALID_PAGES = [
    'dashboard', 'content', 'dedup', 'categories', 'images', 'backup',
    'access', 'appearance', 'system', 'users', 'onlineUsers', 'activityLog',
    'usageStats', 'shares', 'serverMonitor', 'auditLog', 'drive',
];

/**
 * 校验管理员会话（复用主站 settings_authenticated，超时由后台 libraryAuthTimeout 统一控制）
 */
function requireAdminAuth() {
    if (empty($_SESSION['settings_authenticated']) || $_SESSION['settings_authenticated'] !== true) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => '未授权，请先登录']);
        exit;
    }
    $authTime = isset($_SESSION['settings_auth_time']) ? $_SESSION['settings_auth_time'] : 0;
    $timeout = getLibraryAuthTimeout();
    if ($timeout > 0 && (time() - $authTime) > $timeout) {
        unset($_SESSION['settings_authenticated']);
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => '会话已过期，请重新登录']);
        exit;
    }
    $_SESSION['settings_auth_time'] = time();
}

/**
 * 判断 action 是否豁免 CSRF 校验
 */
function isAdminCsrfExempt($action) {
    return in_array($action, ['heartbeat'], true);
}

/**
 * CSRF 校验（与主站共享 session 中的 csrf_token）
 */
function requireAdminCsrf($action = '') {
    if ($action !== '' && isAdminCsrfExempt($action)) return;
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    // Also support CSRF token via POST field (for FormData uploads)
    if ($token === '' && isset($_POST['_csrf'])) {
        $token = $_POST['_csrf'];
    }
    if (empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $token)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'CSRF 校验失败']);
        exit;
    }
}


/**
 * 获取当前登录用户信息（走共享库缓存，每请求只读一次盘）
 * 后台固定多用户模式：current_user_id 缺失或用户不可用时，
 * 同步清除 settings_authenticated，避免后续接口误判为已认证
 */
function getCurrentUser() {
    if (empty($_SESSION['current_user_id'])) {
        // current_user_id 缺失但 settings_authenticated 可能仍存在（如前台设置密码登录），
        // 后台多用户模式下视为未登录，清除残留认证标记
        if (!empty($_SESSION['settings_authenticated'])) {
            unset($_SESSION['settings_authenticated'], $_SESSION['settings_auth_time']);
        }
        return null;
    }
    $user = cpydes_find_user_by_id($_SESSION['current_user_id']);
    if (!$user) {
        // 用户已被删除，彻底清除会话
        unset($_SESSION['current_user_id'], $_SESSION['current_user_role'], $_SESSION['settings_authenticated'], $_SESSION['settings_auth_time']);
        return null;
    }
    // 校验账号状态：非 active 的用户（禁用/封禁）立即清除会话
    $userStatus = isset($user['status']) ? $user['status'] : 'active';
    if ($userStatus !== 'active') {
        unset($_SESSION['current_user_id'], $_SESSION['current_user_role'], $_SESSION['settings_authenticated'], $_SESSION['settings_auth_time']);
        return null;
    }
    // 剔除敏感字段
    unset($user['passwordHash']);
    return $user;
}

/**
 * 获取认证模式（后台固定为多用户模式）
 */
function getAuthMode() {
    return 'multi-user';
}

/**
 * 所有权限点列表
 */
function getAllPermissionPoints() {
    return [
        'view.dashboard', 'view.content', 'view.dedup', 'view.categories',
        'view.images', 'view.backup', 'view.access', 'view.appearance',
        'view.system', 'view.users', 'view.onlineUsers', 'view.activityLog', 'view.usageStats',
        'view.shares', 'view.serverMonitor', 'view.auditLog', 'view.roles',
        'view.announcements',
        'content.create', 'content.edit', 'content.delete', 'content.sort', 'content.share',
        'categories.manage',
        'images.upload', 'images.delete', 'images.scan',
        'dedup.view', 'dedup.config',
        'backup.create', 'backup.delete', 'backup.restore', 'backup.clear',
        'access.manage', 'appearance.manage',
        'users.manage', 'roles.manage',
        'activity.cleanup', 'stats.export',
        'shares.manage',
        'audit.manage',
        'view.drive', 'drive.upload', 'drive.delete', 'drive.rename', 'drive.move', 'drive.folder', 'drive.share', 'drive.manage',
        'ai.use',
        'announcements.manage',
    ];
}

/**
 * 加载角色数据（委托共享库，含请求级缓存）
 */
function loadRoles() {
    return cpydes_load_roles();
}

/**
 * 保存角色数据（原子写入，失败时保留原文件）
 */
function saveRoles($data) {
    $ok = cpydes_json_save_atomic(ROLES_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($ok) cpydes_load_roles(true); // 刷新请求级缓存
    return $ok;
}

/**
 * 根据角色ID获取角色信息
 */
function getRoleById($roleId) {
    return cpydes_get_role_by_id($roleId);
}

/**
 * 角色默认权限（支持动态角色和向后兼容旧角色名）
 */
function getRoleDefaultPermissions($role) {
    return cpydes_get_role_default_permissions($role);
}

/**
 * 获取用户有效权限列表
 */
function getUserEffectivePermissions($user) {
    return cpydes_get_user_effective_permissions($user);
}

/**
 * 检查当前用户是否拥有指定权限
 */
function hasPermission($permission) {
    return cpydes_user_has_permission(getCurrentUser(), $permission);
}

/**
 * 要求当前用户拥有指定权限，否则返回 403
 */
function requirePermission($permission) {
    if (!hasPermission($permission)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => '权限不足，需要: ' . $permission]);
        exit;
    }
}

/**
 * 检查当前用户是否为超级管理员（admin/role_admin 角色）
 * 超级管理员可以看到所有数据，非管理员只能看到自己的独立数据
 * @return bool
 */
function isSuperAdmin() {
    $currentUser = getCurrentUser();
    if (!$currentUser) return false;
    $role = $currentUser['role'] ?? '';
    return $role === 'admin' || $role === 'role_admin';
}

/**
 * 获取当前用户 ID（用于数据隔离过滤）
 * @return string|null
 */
function getCurrentUserId() {
    $currentUser = getCurrentUser();
    return $currentUser ? ($currentUser['id'] ?? null) : null;
}

/* ========== 活动日志与在线用户 ========== */

/**
 * 安全读取活动日志
 */
function loadActivity() {
    return cpydes_json_load(ACTIVITY_FILE, ['logs' => [], 'settings' => ['maxLogs' => 10000, 'retentionDays' => 90]]);
}

/**
 * 原子化写入活动日志（大 JSON 不使用 PRETTY_PRINT，减小体积与解析开销）
 */
function saveActivity($data) {
    return cpydes_json_save_atomic(ACTIVITY_FILE, $data, JSON_UNESCAPED_UNICODE);
}

/**
 * 安全读取在线用户数据
 */
function loadOnline() {
    return cpydes_json_load(ONLINE_FILE, ['sessions' => [], 'peakConcurrent' => 0, 'peakConcurrentTime' => null]);
}

/**
 * 原子化写入在线用户数据
 */
function saveOnline($data) {
    return cpydes_json_save_atomic(ONLINE_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

/**
 * 页面访问统计：加载 page_views.json
 */
function loadPageViews() {
    return cpydes_json_load(PAGE_VIEWS_FILE, ['views' => [], 'lastUpdated' => null]);
}

/**
 * 页面访问统计：原子化写入
 */
function savePageViews($data) {
    return cpydes_json_save_atomic(PAGE_VIEWS_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

/**
 * 记录一次页面访问（按 page + 日期维度计数）
 */
function recordPageView($page) {
    $lockFile = dirname(PAGE_VIEWS_FILE) . '/.page_views.lock';
    $lock = cpydes_lock_acquire($lockFile);
    $data = loadPageViews();
    $today = date('Y-m-d');
    if (!isset($data['views'][$page]) || !is_array($data['views'][$page])) {
        $data['views'][$page] = [];
    }
    if (!isset($data['views'][$page][$today])) {
        $data['views'][$page][$today] = 0;
    }
    $data['views'][$page][$today]++;
    $data['lastUpdated'] = date('c');
    // 只保留近 90 天数据，避免无限增长
    $cutoff = date('Y-m-d', time() - 90 * 86400);
    foreach ($data['views'] as $p => &$days) {
        foreach ($days as $d => $cnt) {
            if ($d < $cutoff) unset($days[$d]);
        }
        if (empty($days)) unset($data['views'][$p]);
    }
    unset($days);
    savePageViews($data);
    cpydes_lock_release($lock);
}

/**
 * 解析 User-Agent 为简短字符串
 */
function parseUserAgent($ua) {
    if (empty($ua)) return 'Unknown';
    $browser = 'Unknown';
    $os = '';
    if (preg_match('/Edg\/(\d+)/', $ua, $m)) $browser = 'Edge ' . $m[1];
    elseif (preg_match('/Chrome\/(\d+)/', $ua, $m) && !preg_match('/Edg\//', $ua)) $browser = 'Chrome ' . $m[1];
    elseif (preg_match('/Firefox\/(\d+)/', $ua, $m)) $browser = 'Firefox ' . $m[1];
    elseif (preg_match('/Safari\/(\d+)/', $ua, $m) && !preg_match('/Chrome\//', $ua)) $browser = 'Safari';
    if (preg_match('/Windows NT (\d+\.\d+)/', $ua, $m)) {
        $os = strpos($m[1], '10') === 0 ? 'Windows 10/11' : 'Windows';
    } elseif (preg_match('/Mac OS X (\d+[._]\d+)/', $ua, $m)) $os = 'macOS';
    elseif (preg_match('/Linux/', $ua)) $os = 'Linux';
    elseif (preg_match('/iPhone|iPad/', $ua)) $os = 'iOS';
    elseif (preg_match('/Android/', $ua)) $os = 'Android';
    return $os ? $browser . ' / ' . $os : $browser;
}

/**
 * 记录一条活动日志
 */
function recordActivity($userId, $username, $action, $detail, $success = true) {
    $lockFile = dirname(ACTIVITY_FILE) . '/.activity.lock';
    $lock = cpydes_lock_acquire($lockFile);
    $data = loadActivity();
    $maxLogs = isset($data['settings']['maxLogs']) ? (int)$data['settings']['maxLogs'] : 10000;
    $log = [
        'id' => 'log_' . bin2hex(random_bytes(6)),
        'userId' => $userId ?: '',
        'username' => $username ?: '',
        'action' => $action,
        'detail' => $detail,
        'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
        'userAgent' => parseUserAgent($_SERVER['HTTP_USER_AGENT'] ?? ''),
        'success' => $success,
        'timestamp' => date('c'),
    ];
    array_unshift($data['logs'], $log);
    // 超限裁剪
    if (count($data['logs']) > $maxLogs) {
        $data['logs'] = array_slice($data['logs'], 0, $maxLogs);
    }
    saveActivity($data);
    cpydes_lock_release($lock);
}

/* ========== 操作审计日志（记录关键操作的详细回溯信息） ========== */

/**
 * 审计日志操作类型常量
 */
function auditActionTypes() {
    return [
        'backup.create'   => '创建备份',
        'backup.delete'   => '删除备份',
        'backup.restore'  => '恢复备份',
        'backup.clear'    => '清空备份',

        'content.create'  => '创建文案',
        'content.edit'    => '编辑文案',
        'content.delete'  => '删除文案',
        'content.bulkDelete' => '批量删除文案',
        'content.batchTag' => '批量标签操作',
        'content.sort'    => '排序文案',
        'categories.manage' => '管理分类',
        'images.delete'   => '删除图片',
        'images.scan'     => '扫描图片',
        'images.bulkDelete' => '批量删除图片',
        'users.create'    => '创建用户',
        'users.edit'      => '编辑用户',
        'users.delete'    => '删除用户',
        'users.roleChange' => '修改用户角色',
        'users.permChange' => '修改用户权限',
        'users.passwordChange' => '修改用户密码',
        'users.login'     => '用户登录',
        'users.logout'    => '用户登出',
        'users.kick'      => '踢出用户',
        'shares.create'   => '创建分享',
        'shares.edit'     => '编辑分享',
        'shares.delete'   => '撤销分享',
        'shares.view'     => '查看分享',
        'config.change'   => '修改配置',
        'access.change'   => '修改访问控制',
        'appearance.change' => '修改外观',
        'dedup.config'    => '查重配置',
        'audit.clear'     => '清空审计日志',
        'announcement.create' => '创建公告',
        'announcement.update' => '更新公告',
        'announcement.delete' => '删除公告',
    ];
}

/**
 * 安全读取审计日志
 */
function loadAuditLog() {
    return cpydes_json_load(AUDIT_FILE, ['logs' => [], 'settings' => ['maxLogs' => 5000, 'retentionDays' => 180]]);
}

/**
 * 原子化写入审计日志（大 JSON 不使用 PRETTY_PRINT，减小体积与解析开销）
 */
function saveAuditLog($data) {
    return cpydes_json_save_atomic(AUDIT_FILE, $data, JSON_UNESCAPED_UNICODE);
}

/**
 * 记录一条审计日志（包含详细上下文用于回溯）
 * @param string $action  操作类型（见 auditActionTypes）
 * @param string $target   操作对象描述（如 "文案 #123 / 标题前 20 字"）
 * @param array  $detail   详细信息（如 before/after 快照、影响数量、原因等）
 * @param bool   $success  是否成功
 */
function recordAudit($action, $target = '', $detail = [], $success = true) {
    $data = loadAuditLog();
    $maxLogs = isset($data['settings']['maxLogs']) ? (int)$data['settings']['maxLogs'] : 5000;
    $retentionDays = isset($data['settings']['retentionDays']) ? (int)$data['settings']['retentionDays'] : 180;

    $user = getCurrentUser();
    $log = [
        'id' => 'aud_' . bin2hex(random_bytes(6)),
        'action' => $action,
        'actionLabel' => isset(auditActionTypes()[$action]) ? auditActionTypes()[$action] : $action,
        'target' => is_string($target) ? (function_exists('mb_substr') ? mb_substr($target, 0, 500) : substr($target, 0, 500)) : '',
        'detail' => is_array($detail) ? $detail : [],
        'userId' => $user['id'] ?? '',
        'username' => $user['username'] ?? '',
        'role' => $user['role'] ?? '',
        'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
        'userAgent' => parseUserAgent($_SERVER['HTTP_USER_AGENT'] ?? ''),
        'success' => $success,
        'timestamp' => date('c'),
    ];
    array_unshift($data['logs'], $log);
    // 超限裁剪
    if (count($data['logs']) > $maxLogs) {
        $data['logs'] = array_slice($data['logs'], 0, $maxLogs);
    }
    // 过期清理
    $threshold = time() - $retentionDays * 86400;
    $data['logs'] = array_values(array_filter($data['logs'], function($l) use ($threshold) {
        $ts = isset($l['timestamp']) ? strtotime($l['timestamp']) : 0;
        return $ts >= $threshold;
    }));
    saveAuditLog($data);
    return $log['id'];
}

/**
 * 注册在线会话（登录时调用）
 */
function registerOnlineSession($userId, $username, $role) {
    $data = loadOnline();
    $sessionId = session_id();
    // 移除同用户的旧会话（同浏览器重登）
    $data['sessions'] = array_values(array_filter($data['sessions'], function($s) use ($sessionId, $userId) {
        return $s['sessionId'] !== $sessionId && $s['userId'] !== $userId;
    }));
    $data['sessions'][] = [
        'sessionId' => $sessionId,
        'userId' => $userId,
        'username' => $username,
        'role' => $role,
        'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
        'userAgent' => parseUserAgent($_SERVER['HTTP_USER_AGENT'] ?? ''),
        'loginAt' => date('c'),
        'lastHeartbeat' => date('c'),
        'currentPage' => 'dashboard',
        'kicked' => false,
    ];
    // 更新峰值
    $currentCount = count($data['sessions']);
    if ($currentCount > $data['peakConcurrent']) {
        $data['peakConcurrent'] = $currentCount;
        $data['peakConcurrentTime'] = date('c');
    }
    saveOnline($data);
}

/**
 * 移除在线会话（登出/踢出时调用）
 */
function unregisterOnlineSession($sessionId = null) {
    $data = loadOnline();
    if ($sessionId === null) $sessionId = session_id();
    $data['sessions'] = array_values(array_filter($data['sessions'], function($s) use ($sessionId) {
        return $s['sessionId'] !== $sessionId;
    }));
    saveOnline($data);
}

/**
 * 清除过期在线会话（心跳超时 > 5分钟）
 */
function cleanupExpiredOnline(&$onlineData = null) {
    if ($onlineData === null) $onlineData = loadOnline();
    $threshold = time() - 300;
    $onlineData['sessions'] = array_values(array_filter($onlineData['sessions'], function($s) use ($threshold) {
        $hb = isset($s['lastHeartbeat']) ? strtotime($s['lastHeartbeat']) : 0;
        return $hb > $threshold;
    }));
}

/**
 * 刷新心跳
 */
function refreshHeartbeat($page = 'dashboard') {
    global $VALID_PAGES;
    // 页面标识白名单校验，非法值回退为 dashboard
    if (!in_array($page, $VALID_PAGES, true)) {
        $page = 'dashboard';
    }
    $data = loadOnline();
    $sessionId = session_id();
    $kicked = false;
    foreach ($data['sessions'] as &$s) {
        if ($s['sessionId'] === $sessionId) {
            if (!empty($s['kicked'])) {
                $kicked = true;
            } else {
                $oldPage = isset($s['currentPage']) ? $s['currentPage'] : 'dashboard';
                $s['lastHeartbeat'] = date('c');
                $s['currentPage'] = $page;
                // 页面切换时记录一次访问
                if ($oldPage !== $page) {
                    recordPageView($page);
                }
            }
            break;
        }
    }
    unset($s);
    // 顺带清理过期会话
    cleanupExpiredOnline($data);
    // 更新峰值
    $currentCount = count($data['sessions']);
    if ($currentCount > $data['peakConcurrent']) {
        $data['peakConcurrent'] = $currentCount;
        $data['peakConcurrentTime'] = date('c');
    }
    saveOnline($data);
    return ['kicked' => $kicked, 'onlineCount' => $currentCount];
}