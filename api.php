<?php
// 禁止 PHP 错误输出到响应中（防止 HTML 错误混入 JSON）
ini_set('display_errors', 'Off');
ini_set('log_errors', 'On');
error_reporting(E_ALL);

// 注册全局错误处理器，确保所有错误都记录到日志而不输出到响应
set_exception_handler(function($exception) {
    error_log('Unhandled exception: ' . $exception->getMessage() . ' in ' . $exception->getFile() . ':' . $exception->getLine());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => '服务器内部错误']);
    exit;
});

set_error_handler(function($errno, $errstr, $errfile, $errline) {
    error_log("Error: [$errno] $errstr in $errfile on line $errline");
    // 不输出错误信息，避免破坏 JSON 响应
    return true;
});

// 共享库（含 mb_* polyfill、JSON 原子读写、通用辅助函数）
require_once __DIR__ . '/lib/json_store.php';
require_once __DIR__ . '/lib/helpers.php';

// 显式设置时区，消除日志/统计时间偏差
cpydes_timezone_init();

// 启动 Session（用于设置中心密码验证）
// 测试模式下跳过 session_start（PHPUnit 已有输出，headers 已发送）
if ((!defined('PHPUNIT_TESTING') || !PHPUNIT_TESTING) && (!defined('TASK_WORKER') || !TASK_WORKER)) {
    if (session_status() !== PHP_SESSION_ACTIVE) {
        // 设置 session cookie 路径为根目录，确保与后台共享 session
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https'),
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
        session_start();
    }
}

// 检查是否是favicon请求
$request_uri = $_SERVER['REQUEST_URI'] ?? '';
if (strpos($request_uri, 'favicon.ico') !== false) {
    header('Content-Type: image/svg+xml');
    echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#6366f1" width="100" height="100" rx="20"/><text x="50" y="65" font-size="50" text-anchor="middle" fill="white">文</text></svg>';
    exit;
}

// 图片代理接口（必须在 JSON 头之前处理，因为返回的是图片二进制数据）
$action = $_GET['action'] ?? '';
if ($action === 'proxyImage') {
    $rawPath = $_GET['path'] ?? '';
    $decodedPath = urldecode($rawPath);

    // 移除 file:// 前缀
    $localPath = preg_replace('/^file:\/\//i', '', $decodedPath);

    // 统一路径分隔符为系统格式
    $localPath = str_replace('/', DIRECTORY_SEPARATOR, $localPath);

    // 安全检查：路径穿越防护
    $realPath = realpath($localPath);
    if ($realPath === false || !is_file($realPath)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=utf-8');
        // 信息泄露修复：不返回 path 字段
        echo json_encode(['success' => false, 'error' => '文件不存在']);
        exit;
    }

    // 安全修复：扩展名白名单（仅允许图片扩展名），防止读取敏感配置文件
    $allowedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
    $ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowedExts, true)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => '禁止访问该文件类型']);
        exit;
    }

    // 限制只能代理允许目录下的图片（防止路径穿越读取系统敏感文件）
    // 白名单：项目 img/、ai-output/ 目录，以及用户主目录（用于代理本地 file:// 图片）
    $allowedBases = [];
    $imgBase = realpath(__DIR__ . '/img');
    $aiBase = realpath(__DIR__ . '/ai-output');
    if ($imgBase) $allowedBases[] = $imgBase;
    if ($aiBase) $allowedBases[] = $aiBase;
    $homeDir = getenv('USERPROFILE') ?: (getenv('HOME') ?: ($_SERVER['USERPROFILE'] ?? ''));
    if ($homeDir !== '') {
        $homeBase = realpath($homeDir);
        if ($homeBase) $allowedBases[] = $homeBase;
    }
    $inAllowed = false;
    foreach ($allowedBases as $base) {
        if ($realPath === $base || strpos($realPath, $base . DIRECTORY_SEPARATOR) === 0) {
            $inAllowed = true;
            break;
        }
    }
    if (!$inAllowed) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => '禁止访问该路径（超出允许范围）']);
        exit;
    }

    // 检查是否为图片类型
    if (function_exists('finfo_open')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $realPath);
        finfo_close($finfo);
        if (strpos($mime, 'image/') !== 0) {
            http_response_code(400);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['success' => false, 'error' => '不是图片文件']);
            exit;
        }
    } else {
        // finfo 扩展不可用时，按扩展名推断
        $extMime = [
            'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
            'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml',
        ];
        $mime = isset($extMime[$ext]) ? $extMime[$ext] : 'application/octet-stream';
        if (strpos($mime, 'image/') !== 0) {
            http_response_code(400);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['success' => false, 'error' => '不是图片文件']);
            exit;
        }
    }

    header('Content-Type: ' . $mime);
    header('Cache-Control: max-age=86400');
    header('X-Content-Type-Options: nosniff');

    // 安全修复：SVG 文件需要移除内嵌脚本（防止存储型 XSS）
    if ($ext === 'svg' || $mime === 'image/svg+xml') {
        $svgContent = file_get_contents($realPath);
        // stripSvgScripts 定义在文件后部，PHP 会自动提升顶层函数声明
        if (function_exists('stripSvgScripts')) {
            $svgContent = stripSvgScripts($svgContent);
        }
        echo $svgContent;
        exit;
    }

    readfile($realPath);
    exit;
}

// 测试模式跳过 HTTP 头输出（PHPUnit 已有输出，headers 已发送）
if (!defined('PHPUNIT_TESTING') || !PHPUNIT_TESTING) {
    header('Content-Type: application/json; charset=utf-8');

    // CORS 收紧：仅允许白名单 Origin，默认 Same-Origin
    $allowedOrigins = array_filter(array_map('trim', explode(',', getenv('ALLOWED_ORIGINS') ?: '')));
    $requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($requestOrigin && in_array($requestOrigin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $requestOrigin);
        header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
        header('Vary: Origin');
    }

    if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(200);
        exit;
    }
}

if (!defined('SITE_ROOT')) define('SITE_ROOT', __DIR__ . '/');
if (!defined('DATA_FILE')) define('DATA_FILE', __DIR__ . '/data/copywriting.json');
if (!defined('AI_CONFIG_FILE')) define('AI_CONFIG_FILE', __DIR__ . '/data/ai-config.json');
// 文案库运行配置（从 copywriting.json 拆离，避免业务数据膨胀影响配置写入性能）
if (!defined('LIBRARY_SETTINGS_FILE')) define('LIBRARY_SETTINGS_FILE', __DIR__ . '/data/library_settings.json');
if (!defined('IMG_DIR')) define('IMG_DIR', __DIR__ . '/img');
if (!defined('AI_OUTPUT_DIR')) {
    define('AI_OUTPUT_DIR', __DIR__ . '/ai-output');
    if (!file_exists(AI_OUTPUT_DIR)) {
        mkdir(AI_OUTPUT_DIR, 0755, true);
        $htaccess = AI_OUTPUT_DIR . '/.htaccess';
        if (!file_exists($htaccess)) {
            file_put_contents($htaccess, "Allow from all\n");
        }
        $index = AI_OUTPUT_DIR . '/index.html';
        if (!file_exists($index)) {
            file_put_contents($index, '');
        }
    }
}

// 设置中心密码哈希文件路径
if (!defined('PWD_HASH_FILE')) define('PWD_HASH_FILE', __DIR__ . '/data/.pwd_hash');
// 文案库访问密码哈希文件路径（独立于管理密码）
if (!defined('LIB_PWD_HASH_FILE')) define('LIB_PWD_HASH_FILE', __DIR__ . '/data/.lib_pwd_hash');
// 分享链接数据文件路径
if (!defined('SHARES_FILE')) define('SHARES_FILE', __DIR__ . '/data/shares.json');
// 分享操作专用锁文件路径（用于串行化创建/撤销等写操作，防止并发覆盖）
if (!defined('SHARES_LOCK_FILE')) define('SHARES_LOCK_FILE', __DIR__ . '/data/.shares.lock');
// 用户收藏数据文件路径（按用户ID隔离，云端同步）
if (!defined('FAVORITES_FILE')) define('FAVORITES_FILE', __DIR__ . '/data/favorites.json');
// 收藏写入专用锁文件路径（防止并发覆盖）
if (!defined('FAVORITES_LOCK_FILE')) define('FAVORITES_LOCK_FILE', __DIR__ . '/data/.favorites.lock');
// 弹窗公告数据文件路径（独立小文件，避免污染业务数据）
if (!defined('ANNOUNCEMENTS_FILE')) define('ANNOUNCEMENTS_FILE', __DIR__ . '/data/announcements.json');

function ensureDataFile() {
    if (!file_exists(DATA_FILE)) {
        file_put_contents(DATA_FILE, json_encode([
            'categories' => [],
            'items' => []
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    }
}

// ============ 函数库（由本文件机械拆分至 lib/） ============
require_once __DIR__ . '/lib/settings.php';
require_once __DIR__ . '/lib/shares.php';
require_once __DIR__ . '/lib/ai.php';
require_once __DIR__ . '/lib/announcements.php';
require_once __DIR__ . '/lib/sync.php';

/**
 * 加载数据文件（请求内缓存 + 防御性处理）
 * 说明：settings 已拆离至独立文件 library_settings.json，由 loadLibrarySettings() 负责
 * 这里仅在返回结构里合并 settings，保证 getAll 等接口对前端透明兼容
 * @param bool $reload 强制重新读取（保存后刷新缓存）
 * @return array 总是返回 ['categories'=>[], 'items'=>[], 'settings'=>[]] 结构
 */
function loadData($reload = false) {
    static $cache = null;
    if ($cache !== null && !$reload) return $cache;
    ensureDataFile();
    // 防御性：读取/解析失败时兜底为空结构（统一走共享库）
    $data = cpydes_json_load(DATA_FILE, ['categories' => [], 'items' => []]);
    $cache = [
        'categories' => is_array($data['categories'] ?? null) ? $data['categories'] : [],
        'items' => is_array($data['items'] ?? null) ? $data['items'] : [],
        'settings' => loadLibrarySettings($reload),
    ];
    return $cache;
}

/** @var bool 是否启用 Pretty Print（仅开发/调试时开启） */
define('JSON_PRETTY', false);

/**
 * 原子化保存 JSON 文件（薄包装，委托共享库实现；失败时保留原文件）
 * @param string $targetPath 目标路径
 * @param array $data 数据
 * @param int $flags json_encode 标志
 * @return bool
 */
function saveJsonFile($targetPath, $data, $flags = JSON_UNESCAPED_UNICODE) {
    return cpydes_json_save_atomic($targetPath, $data, $flags);
}

// 向后兼容：saveData 调用 saveJsonFile
// 注意：$data 中若含 settings，会被拆分写入 LIBRARY_SETTINGS_FILE，不再写回 copywriting.json
function saveData($data) {
    $flags = JSON_UNESCAPED_UNICODE;
    if (JSON_PRETTY) $flags |= JSON_PRETTY_PRINT;
    // 拆离 settings（避免业务数据写盘时连配置一起重写）
    $settingsToSave = null;
    if (array_key_exists('settings', $data)) {
        $settingsToSave = is_array($data['settings']) ? $data['settings'] : [];
        unset($data['settings']);
    }
    $ok = saveJsonFile(DATA_FILE, $data, $flags);
    if ($ok && $settingsToSave !== null) {
        saveLibrarySettings($settingsToSave);
    }
    if ($ok) loadData(true); // 刷新缓存
    return $ok;
}


// 安全验证颜色值，只允许 #hex 和 rgb() 格式
function sanitizeColor($color) {
    if (!is_string($color)) return null;
    $color = trim($color);
    if (preg_match('/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/', $color)) {
        return $color;
    }
    if (preg_match('/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i', $color)) {
        return $color;
    }
    if (preg_match('/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/i', $color)) {
        return $color;
    }
    return null;
}

// 递归验证分类数据，清除非法字段和验证颜色值
function sanitizeCategories($categories) {
    if (!is_array($categories)) return [];
    $result = [];
    foreach ($categories as $cat) {
        if (!is_array($cat)) continue;
        $cleanCat = [];
        $cleanCat['id'] = isset($cat['id']) && is_string($cat['id']) ? substr($cat['id'], 0, 100) : '';
        $cleanCat['name'] = isset($cat['name']) && is_string($cat['name']) ? substr($cat['name'], 0, 200) : '';
        $cleanCat['color'] = sanitizeColor($cat['color'] ?? '') ?: '#6366f1';
        if (isset($cat['children']) && is_array($cat['children'])) {
            $cleanChildren = [];
            foreach ($cat['children'] as $child) {
                if (!is_array($child)) continue;
                $cleanChild = [];
                $cleanChild['id'] = isset($child['id']) && is_string($child['id']) ? substr($child['id'], 0, 100) : '';
                $cleanChild['name'] = isset($child['name']) && is_string($child['name']) ? substr($child['name'], 0, 200) : '';
                $cleanChild['color'] = sanitizeColor($child['color'] ?? '') ?: '#6366f1';
                $cleanChild['parentId'] = $cleanCat['id'];
                $cleanChildren[] = $cleanChild;
            }
            $cleanCat['children'] = $cleanChildren;
        }
        $result[] = $cleanCat;
    }
    return $result;
}

/**
 * CSRF Token 管理
 */
function getCsrfToken() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function verifyCsrfToken($token) {
    return !empty($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

function isCsrfExempt($action) {
    return in_array($action, ['verifySettingsPassword', 'verifyUserLogin', 'registerUser', 'getCsrfToken', 'getLibraryAccessStatus', 'driveShareInfo', 'driveShareDownload'], true);
}

/**
 * 校验 CSRF Token，不匹配则 403
 */
function requireCsrfCheck($action) {
    if (isCsrfExempt($action)) return;
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    // Also support CSRF token via POST field (for FormData uploads)
    if ($token === '' && isset($_POST['_csrf'])) {
        $token = $_POST['_csrf'];
    }
    if (!verifyCsrfToken($token)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'CSRF 校验失败']);
        exit;
    }
}

/**
 * 清洗 SVG 内容，移除脚本与危险节点
 * @param string $svgContent
 * @return string
 */
function stripSvgScripts($svgContent) {
    return cpydes_strip_svg_scripts($svgContent);
}

/**
 * 验证上传文件的 MIME 类型与扩展名一致
 * @param string $filepath
 * @param string $ext
 * @return bool
 */
function verifyImageMime($filepath, $ext) {
    $mimeMap = [
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'svg' => 'image/svg+xml',
    ];
    if (!isset($mimeMap[$ext])) return false;

    if (!function_exists('finfo_open')) return false; // finfo 不可用时拒绝（防止伪装文件上传）
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $actualMime = finfo_file($finfo, $filepath);
    finfo_close($finfo);

    // SVG 的 MIME 检测在不同 PHP 版本可能返回 text/xml，特殊处理
    if ($ext === 'svg') {
        return $actualMime === 'image/svg+xml' || $actualMime === 'text/xml' || $actualMime === 'application/xml';
    }

    return $actualMime === $mimeMap[$ext];
}

/**
 * 生成安全随机文件名
 * @param string $ext
 * @return string
 */
function generateSecureFilename($ext) {
    return 'img_' . time() . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
}

/**
 * 加载用户数据（请求级缓存：同一请求内多次调用只读一次文件）
 */
function loadUsers() {
    static $cache = null;
    if ($cache !== null) return $cache;
    $usersFile = __DIR__ . '/data/users.json';
    if (!file_exists($usersFile)) {
        return $cache = ['users' => []];
    }
    $raw = @file_get_contents($usersFile);
    if ($raw === false) return $cache = ['users' => []];
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['users'])) return $cache = ['users' => []];
    return $cache = $data;
}

/** 用户数据文件路径常量 */
define('USERS_FILE', __DIR__ . '/data/users.json');
define('ROLES_FILE', __DIR__ . '/data/roles.json');

/**
 * 保存用户数据（复用通用 saveJsonFile）
 */
function saveUsers($data) {
    return saveJsonFile(USERS_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

/**
 * 获取当前登录用户信息
 * 从 session 读取用户 ID，再到 users.json 中加载完整用户记录。
 * 未登录、会话过期或用户被禁用时返回 null。
 */
function getCurrentUser() {
    if (empty($_SESSION['current_user_id'])) {
        return null;
    }
    // 会话必须仍然有效（覆盖文案库保护超时与用户登录共享的会话）
    if (!isLibraryAuthed()) {
        // 会话已过期：清理残留的用户标记，避免后续请求误判
        unset($_SESSION['current_user_id'], $_SESSION['current_user_role']);
        return null;
    }
    $userId = $_SESSION['current_user_id'];
    $usersData = loadUsers();
    foreach ($usersData['users'] as $user) {
        if ($user['id'] === $userId) {
            // 被禁用的用户视为未登录
            if (isset($user['status']) && $user['status'] !== 'active') {
                return null;
            }
            // 不返回密码哈希
            unset($user['passwordHash']);
            return $user;
        }
    }
    // 用户已被删除
    return null;
}

/**
 * 获取认证模式
 */
function getAuthMode() {
    $settings = loadLibrarySettings();
    return isset($settings['authMode']) ? $settings['authMode'] : 'multi-user';
}

/**
 * 加载角色数据
 */
function loadRoles() {
    static $cache = null;
    if ($cache !== null) return $cache;
    if (!file_exists(ROLES_FILE)) {
        return $cache = ['roles' => []];
    }
    $raw = @file_get_contents(ROLES_FILE);
    if ($raw === false) return $cache = ['roles' => []];
    $data = json_decode($raw, true);
    return $cache = (is_array($data['roles'] ?? null) ? ['roles' => $data['roles']] : ['roles' => []]);
}

/**
 * 根据角色ID获取角色信息
 */
function getRoleById($roleId) {
    $rolesData = loadRoles();
    foreach ($rolesData['roles'] as $role) {
        if ($role['id'] === $roleId) {
            return $role;
        }
    }
    return null;
}

/**
 * 角色默认权限（支持动态角色和向后兼容旧角色名）
 */
function getRoleDefaultPermissions($role) {
    // 先尝试从动态角色表中查找
    $roleData = getRoleById($role);
    if ($roleData && isset($roleData['permissions']) && is_array($roleData['permissions'])) {
        return $roleData['permissions'];
    }
    
    // 向后兼容：旧的角色名 admin/editor/viewer
    $compatMap = [
        'admin' => 'role_admin',
        'editor' => 'role_editor',
        'viewer' => 'role_viewer',
    ];
    if (isset($compatMap[$role])) {
        $compatRole = getRoleById($compatMap[$role]);
        if ($compatRole && isset($compatRole['permissions'])) {
            return $compatRole['permissions'];
        }
    }
    
    // 兜底：使用硬编码的默认值
    $fallbackMap = [
        'admin' => ['*'],
        'editor' => [
            'content.create', 'content.edit', 'content.delete', 'content.sort', 'content.share',
            'categories.manage',
            'images.upload', 'images.delete',
        ],
        'viewer' => [],
    ];
    return $fallbackMap[$role] ?? [];
}

/**
 * 数组按指定键去重
 */
function array_unique_by(array $array, string $key): array {
    $seen = [];
    $result = [];
    foreach ($array as $item) {
        if (!in_array($item[$key] ?? null, $seen, true)) {
            $seen[] = $item[$key];
            $result[] = $item;
        }
    }
    return $result;
}

function getUserEffectivePermissions($user) {
    if (isset($user['permissions']) && is_array($user['permissions']) && !empty($user['permissions'])) {
        return $user['permissions'];
    }
    return getRoleDefaultPermissions($user['role'] ?? 'viewer');
}

/**
 * 检查当前用户是否拥有指定权限
 * 仅支持账户登录：使用用户权限；未登录则按访客权限配置
 * 访问保护关闭时：未登录用户按访客权限配置控制
 * 访问保护开启 + 允许访客访问：未登录用户按访客权限配置控制
 */
function hasUserPermission($permission) {
    $currentUser = getCurrentUser();
    if (!$currentUser) {
        // 未登录账户：保护关闭时按访客权限配置
        if (!isLibraryProtectionEnabled()) {
            return guestHasPermission($permission);
        }
        // 保护开启：仅当允许访客访问时按访客权限配置，否则无权限
        if (isAllowGuestAccess()) {
            return guestHasPermission($permission);
        }
        return false;
    }
    // 检查是否是 admin 角色（包括 role_admin）
    $role = $currentUser['role'] ?? '';
    if ($role === 'admin' || $role === 'role_admin') return true;
    $permissions = getUserEffectivePermissions($currentUser);
    if (in_array('*', $permissions, true)) return true;
    if (is_array($permission)) {
        foreach ($permission as $p) {
            if (in_array($p, $permissions, true)) return true;
        }
        return false;
    }
    return in_array($permission, $permissions, true);
}

/**
 * 要求当前用户拥有指定权限，否则 403
 */
function requireUserPermission($permission) {
    if (!hasUserPermission($permission)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => '权限不足，需要: ' . $permission]);
        exit;
    }
}

// 测试模式守卫：函数定义完毕后返回，不执行请求处理
if (defined('PHPUNIT_TESTING') && PHPUNIT_TESTING) {
    return;
}

// 被 task_worker.php CLI 进程包含时：加载完函数定义即返回，不执行 HTTP 路由逻辑
if (defined('TASK_WORKER')) {
    return;
}

$method = $_SERVER['REQUEST_METHOD'];
// $action 已在第 53 行赋值（proxyImage 早期分支需要），此处无需重复赋值

try {
    header('Content-Type: application/json; charset=utf-8');
    if ($method === 'GET') {
        if ($action === 'getAll') {
            // 文案库密码保护：未验证则拒绝
            requireLibraryAuth();
            $data = loadData();
            // 加载用户列表用于显示创建人
            $usersData = loadUsers();
            $userList = [];
            foreach ($usersData['users'] as $u) {
                $userList[] = [
                    'id' => $u['id'],
                    'username' => $u['username'],
                    'role' => $u['role'] ?? ''
                ];
            }
            $data['users'] = $userList;
            echo json_encode(['success' => true, 'data' => $data]);
            exit;
        } elseif ($action === 'getCsrfToken') {
            // 获取 CSRF Token（无需认证）
            echo json_encode(['success' => true, 'token' => getCsrfToken()]);
            exit;
        } elseif ($action === 'getLibraryAccessStatus') {
            // 公开接口：返回文案库密码保护状态（不泄露密码）
            $enabled = isLibraryProtectionEnabled();
            $allowGuest = $enabled ? isAllowGuestAccess() : false;
            $currentUser = getCurrentUser();
            $userPayload = null;
            if ($currentUser) {
                $permissions = getUserEffectivePermissions($currentUser);
                $userPayload = [
                    'id' => $currentUser['id'],
                    'username' => $currentUser['username'],
                    'role' => $currentUser['role'],
                    'permissions' => $permissions
                ];
            }
            // authenticated: 保护关闭=true; 保护开启+已登录=true; 保护开启+允许访客=true
            $authenticated = (!$enabled) || isLibraryAuthed() || $allowGuest;
            echo json_encode([
                'success' => true,
                'protectionEnabled' => $enabled,
                'authenticated' => $authenticated,
                'allowGuestAccess' => $allowGuest,
                'needsSetup' => $enabled && needsLibraryPasswordSetup(),
                'authTimeout' => getLibraryAuthTimeout(),
                'user' => $userPayload,
                'authMode' => getAuthMode(),
                'guestPermissions' => getGuestPermissions(),
                'registrationEnabled' => isRegistrationEnabled(),
            ]);
            exit;
        } elseif ($action === 'getActiveAnnouncements') {
            // 公开接口：返回当前对访客有效的弹窗公告
            // 遵循 library_settings 的访问保护语义——保护开启且未通过验证时，仅登录用户可见
            $isLoggedIn = false;
            if (function_exists('getCurrentUser')) {
                $isLoggedIn = getCurrentUser() !== null;
            } elseif (!empty($_SESSION['current_user_id'])) {
                $isLoggedIn = true;
            }
            // 文案库保护开启 + 不允许访客 + 未通过验证：不泄露任何公告
            if (isLibraryProtectionEnabled() && !isAllowGuestAccess() && !isLibraryAuthed()) {
                echo json_encode(['success' => true, 'announcements' => []]);
                exit;
            }
            $all = cpydes_load_announcements();
            $list = cpydes_filter_announcements_for_user($all['announcements'], $isLoggedIn);
            // 仅暴露前台必需字段，剔除管理元数据
            $payload = array_map('cpydes_public_announcement_payload', $list);
            echo json_encode(['success' => true, 'announcements' => $payload]);
            exit;
        } elseif ($action === 'getSyncVersion') {
            // 实时同步版本接口：遵循文案库访问保护（允许访客时放行），CSRF 豁免
            requireLibraryAuth();
            $cfg = cpydes_get_sync_config();
            echo json_encode([
                'success' => true,
                'version' => cpydes_get_sync_version(),
                'syncEnabled' => $cfg['enabled'],
                'syncInterval' => $cfg['interval'],
            ]);
            exit;
        } elseif ($action === 'getData') {
            // 增量拉取接口：按 type 仅返回变化的数据切片，避免全量 getAll
            requireLibraryAuth();
            $type = isset($_GET['type']) ? $_GET['type'] : '';
            if ($type === 'content') {
                $data = loadData();
                echo json_encode(['success' => true, 'data' => [
                    'categories' => $data['categories'],
                    'items' => $data['items'],
                ]]);
                exit;
            } elseif ($type === 'settings') {
                $data = loadData();
                echo json_encode(['success' => true, 'data' => ['settings' => $data['settings']]]);
                exit;
            } elseif ($type === 'announcements') {
                $isLoggedIn = getCurrentUser() !== null;
                if (isLibraryProtectionEnabled() && !isAllowGuestAccess() && !isLibraryAuthed()) {
                    echo json_encode(['success' => true, 'announcements' => []]);
                    exit;
                }
                $all = cpydes_load_announcements();
                $list = cpydes_filter_announcements_for_user($all['announcements'], $isLoggedIn);
                $payload = array_map('cpydes_public_announcement_payload', $list);
                echo json_encode(['success' => true, 'announcements' => $payload]);
                exit;
            }
            echo json_encode(['success' => false, 'error' => '无效的 type 参数']);
            exit;
        } elseif ($action === 'export') {
            // 文案库密码保护：未验证则拒绝
            requireLibraryAuth();
            $data = loadData();
            header('Content-Disposition: attachment; filename="copywriting.json"');
            echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            exit;
        } elseif ($action === 'fullExport') {
            // 全量备份需要密码验证
            requireSettingsAuth();
            // 全量备份：数据 + 图片(base64)
            try {
                ini_set('memory_limit', '512M');
                set_time_limit(120);
                $data = loadData();
                $images = [];

                if (is_dir(IMG_DIR)) {
                    $files = array_merge(
                        glob(IMG_DIR . '/*') ?: [],
                        glob(IMG_DIR . '/*/*') ?: [],
                        glob(IMG_DIR . '/*/*/*') ?: []
                    );
                    foreach ($files as $filepath) {
                        if (is_dir($filepath)) continue;
                        $relPath = str_replace('\\', '/', substr($filepath, strlen(__DIR__) + 1));
                        $imgData = @file_get_contents($filepath);
                        if ($imgData !== false && strlen($imgData) > 0) {
                            $ext = strtolower(pathinfo($filepath, PATHINFO_EXTENSION));
                            $mimeMap = ['png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg',
                                        'gif'=>'image/gif','webp'=>'image/webp','svg'=>'image/svg+xml'];
                            $mime = isset($mimeMap[$ext]) ? $mimeMap[$ext] : 'application/octet-stream';
                            $images[$relPath] = 'data:' . $mime . ';base64,' . base64_encode($imgData);
                        }
                    }
                }

                echo json_encode([
                    'success' => true,
                    'backup' => [
                        'version' => '1.0',
                        'exportedAt' => date('c'),
                        'app' => 'Cpydes 文案库',
                        'data' => $data,
                        'images' => $images,
                        'imageCount' => count($images)
                    ]
                ], JSON_UNESCAPED_UNICODE);
                exit;
            } catch (Exception $e) {
                error_log('fullExport error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
                http_response_code(500);
                echo json_encode(['success' => false, 'error' => '备份失败: ' . $e->getMessage()]);
                exit;
            }
        } elseif ($action === 'listShares') {
            // 列出当前用户创建的分享链接
            requireLibraryAuth();
            requireUserPermission('content.share');
            $currentUser = getCurrentUser();
            $userId = $currentUser ? $currentUser['id'] : '';
            $sharesData = loadShares();
            // 优化：只在需要展示 item 标题时才加载全量数据
            // 普通访问码模式（userId 为空）下，shares 通常 < 100，O(N*M) 可接受
            // 多用户模式下仍按需加载（避免每次列分享都读整个 data 文件）
            $itemMap = [];
            $shares = [];
            foreach ($sharesData['shares'] as $s) {
                // 仅返回当前用户创建的分享（访问码模式 userId 为空时返回全部）
                if ($userId !== '' && isset($s['createdBy']) && $s['createdBy'] !== $userId) continue;
                $itemId = $s['itemId'];
                // 懒加载 itemMap：仅当第一次需要某 item 标题时才加载 data
                if (!isset($itemMap[$itemId]) && !empty($itemId)) {
                    $itemMap[$itemId] = null; // 标记已尝试，避免重复 IO
                    $data = loadData();
                    foreach ($data['items'] as $it) {
                        $itemMap[$it['id']] = $it;
                        // 同时填充所有 item（单次 IO 就够）
                    }
                }
                $item = $itemMap[$itemId] ?? null;
                $shares[] = [
                    'token' => $s['token'],
                    'itemId' => $itemId,
                    'itemTitle' => $item ? $item['title'] : '(文案已删除)',
                    'itemExists' => $item !== null,
                    'createdAt' => $s['createdAt'],
                    'expiresAt' => $s['expiresAt'] ?? null,
                    'maxViews' => $s['maxViews'] ?? null,
                    'viewCount' => $s['viewCount'] ?? 0,
                    'lastViewAt' => $s['lastViewAt'] ?? null,
                    'hasPassword' => !empty($s['password']),
                    'createdBy' => $s['createdBy'] ?? '',
                ];
            }
            usort($shares, function($a, $b) { return strcmp($b['createdAt'], $a['createdAt']); });
            echo json_encode(['success' => true, 'shares' => $shares]);
            exit;
        } elseif ($action === 'getFavorites') {
            // 获取当前登录用户的云端收藏（需要账户登录）
            requireLibraryAuth();
            $currentUser = getCurrentUser();
            if (!$currentUser) {
                echo json_encode(['success' => false, 'error' => '需要账户登录才能使用云端收藏', 'needsLogin' => true]);
                exit;
            }
            $favoritesData = loadFavorites();
            $userFavs = isset($favoritesData['favorites'][$currentUser['id']])
                ? $favoritesData['favorites'][$currentUser['id']]
                : [];
            echo json_encode(['success' => true, 'favorites' => $userFavs]);
            exit;
        } elseif ($action === 'getAiSettings') {
            // 获取 AI 设置：后台管理员可获取完整配置；前端用户需账户登录且拥有 ai.use 权限
            if (!requireAiAccess()) exit;
            $aiSettings = loadAiConfig();
            // 仅后台管理员可获取完整 AI 设置（含 API Key 等敏感信息）
            // 前端用户仅返回脱敏后的非敏感字段
            if (!isBackendAuthed()) {
                $safeSettings = [
                    'enabled' => $aiSettings['enabled'],
                    'defaultModel' => isset($aiSettings['defaultModel']) ? $aiSettings['defaultModel'] : '',
                    'defaultImageModel' => isset($aiSettings['defaultImageModel']) ? $aiSettings['defaultImageModel'] : '',
                    'defaultVideoModel' => isset($aiSettings['defaultVideoModel']) ? $aiSettings['defaultVideoModel'] : '',
                    'models' => []
                ];
                foreach ($aiSettings['models'] as $model) {
                    $safeSettings['models'][] = [
                        'id' => $model['id'],
                        'name' => $model['name'],
                        'desc' => $model['desc'] ?? '',
                        'modelName' => $model['modelName'] ?? '',
                        'type' => $model['type'] ?? 'chat',
                        'maxTokens' => $model['maxTokens'] ?? 8192,
                        'temperature' => $model['temperature'] ?? 0.7
                    ];
                }
                echo json_encode(['success' => true, 'settings' => $safeSettings]);
            } else {
                echo json_encode(['success' => true, 'settings' => $aiSettings]);
            }
            exit;
        } elseif ($action === 'aiImageStatus') {
            // 查询图片生成任务状态（轮询）：只读接口，需要 ai.use 权限
            if (!requireAiAccess()) exit;

            $taskId = isset($_GET['taskId']) ? $_GET['taskId'] : '';
            if (empty($taskId)) {
                echo json_encode(['success' => false, 'error' => '缺少任务 ID']);
                exit;
            }
            handleAiImageStatus($taskId);
            exit;
        } elseif ($action === 'aiVideoStatus') {
            // 查询视频生成任务状态（轮询）：只读接口，需要 ai.use 权限
            if (!requireAiAccess()) exit;
            $aiSettings = getEnabledAiSettings();
            if ($aiSettings === null) exit;

            $model = isset($_GET['model']) ? $_GET['model'] : '';
            $taskId = isset($_GET['taskId']) ? $_GET['taskId'] : '';
            $videoId = isset($_GET['videoId']) ? $_GET['videoId'] : '';
            if (empty($taskId) && empty($videoId)) {
                echo json_encode(['success' => false, 'error' => '缺少任务 ID']);
                exit;
            }
            $modelConfig = findAiModelConfig($aiSettings, $model);
            if (!$modelConfig) {
                echo json_encode(['success' => false, 'error' => '未配置视频生成模型']);
                exit;
            }
            handleAiVideoPoll($modelConfig, $taskId, $videoId);
            exit;
        } elseif ($action === 'aiTaskList') {
            // 获取所有后台 AI 任务列表：只读接口，需要 ai.use 权限
            if (!requireAiAccess()) exit;
            handleAiTaskList();
            exit;
        } elseif ($action === 'aiCancelTask') {
            // 取消 AI 任务：需要 ai.use 权限
            if (!requireAiAccess()) exit;

            $taskId = isset($_GET['taskId']) ? $_GET['taskId'] : '';
            if (empty($taskId)) {
                echo json_encode(['success' => false, 'error' => '缺少任务 ID']);
                exit;
            }
            handleAiCancelTask($taskId);
            exit;
        } else {
            echo json_encode(['success' => false, 'error' => '未知操作']);
            exit;
        }
    } elseif ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;

        // CSRF 校验（requireCsrfCheck 内部已处理豁免逻辑）
        requireCsrfCheck($action);

        // 文案库密码保护：认证相关接口豁免，其余写操作需通过文案库验证
        $libAuthExempt = in_array($action, ['verifySettingsPassword', 'verifyUserLogin', 'registerUser', 'libraryLogout', 'saveLibrarySettings', 'saveSettings', 'saveAiSettings', 'testAiModel', 'aiChat', 'aiGenerateImage', 'aiVideoCreate', 'fullImport', 'fullExport', 'driveShareInfo', 'driveShareDownload'], true);
        if (!$libAuthExempt) {
            requireLibraryAuth();
        }

        if ($action === 'verifySettingsPassword') {
            // 设置中心密码验证
            checkRateLimit();

            // 首次设置密码场景
            if (needsPasswordSetup() && !empty($input['newPassword'])) {
                if (setNewPassword($input['newPassword'])) {
                    echo json_encode(['success' => true, 'message' => '密码已设置']);
                } else {
                    echo json_encode(['success' => false, 'error' => '密码设置失败（需 6-72 位）']);
                }
                exit;
            }

            $password = isset($input['password']) ? $input['password'] : '';
            if (verifySettingsPassword($password)) {
                // 登录成功：重置限流 + session regenerate + 设置认证状态
                clearFailedAttempts();
                session_regenerate_id(true);
                $_SESSION['settings_authenticated'] = true;
                $_SESSION['settings_auth_time'] = time();
                // 重新生成 CSRF Token（防止 Session Fixation 后旧 token 复用）
                $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
                echo json_encode(['success' => true, 'needsPasswordSetup' => needsPasswordSetup()]);
            } else {
                recordFailedAttempt();
                echo json_encode(['success' => false, 'error' => '密码错误']);
            }
            exit;
        }

        if ($action === 'libraryLogout') {
            // 文案库访问登出（同步清除后台认证状态，实现双向登出）
            unset($_SESSION['library_authenticated'], $_SESSION['library_auth_time']);
            unset($_SESSION['current_user_id'], $_SESSION['current_user_role']);
            unset($_SESSION['settings_authenticated'], $_SESSION['settings_auth_time']);
            echo json_encode(['success' => true]);
            exit;
        }

        // 修改当前用户用户名
        if ($action === 'updateCurrentUsername') {
            $currentUser = getCurrentUser();
            if (!$currentUser) {
                http_response_code(401);
                echo json_encode(['success' => false, 'error' => '未登录']);
                exit;
            }

            $newUsername = isset($input['username']) ? trim($input['username']) : '';
            if ($newUsername === '') {
                echo json_encode(['success' => false, 'error' => '用户名不能为空']);
                exit;
            }

            // 用户名长度限制
            if (mb_strlen($newUsername) < 2 || mb_strlen($newUsername) > 50) {
                echo json_encode(['success' => false, 'error' => '用户名长度需为 2-50 位']);
                exit;
            }

            // 用户名格式验证（只允许中文、字母、数字、下划线）
            if (!preg_match('/^[\x{4e00}-\x{9fa5}a-zA-Z0-9_]+$/u', $newUsername)) {
                echo json_encode(['success' => false, 'error' => '用户名只能包含中文、字母、数字、下划线']);
                exit;
            }

            // 检查用户名是否已被使用（排除自己）
            $usersData = loadUsers();
            foreach ($usersData['users'] as $user) {
                if ($user['username'] === $newUsername && $user['id'] !== $currentUser['id']) {
                    echo json_encode(['success' => false, 'error' => '用户名已存在']);
                    exit;
                }
            }

            // 更新用户名
            foreach ($usersData['users'] as &$user) {
                if ($user['id'] === $currentUser['id']) {
                    $user['username'] = $newUsername;
                    $user['updatedAt'] = date('c');
                    break;
                }
            }
            unset($user);
            saveUsers($usersData);

            echo json_encode(['success' => true, 'username' => $newUsername]);
            exit;
        }

        // 多用户模式登录
        if ($action === 'verifyUserLogin') {
            $authMode = getAuthMode();
            if ($authMode !== 'multi-user') {
                echo json_encode(['success' => false, 'error' => '当前不是多用户模式']);
                exit;
            }

            checkLibRateLimit();

            $username = isset($input['username']) ? trim($input['username']) : '';
            $password = isset($input['password']) ? $input['password'] : '';

            if ($username === '' || $password === '') {
                echo json_encode(['success' => false, 'error' => '用户名和密码不能为空']);
                exit;
            }

            $usersData = loadUsers();
            $foundUser = null;
            foreach ($usersData['users'] as $user) {
                if ($user['username'] === $username) {
                    $foundUser = $user;
                    break;
                }
            }

            if (!$foundUser || !password_verify($password, $foundUser['passwordHash'])) {
                recordLibFailedAttempt();
                $attempts = isset($_SESSION['lib_pwd_attempts']) ? $_SESSION['lib_pwd_attempts'] : ['count' => 0, 'lockout' => 0];
                $remaining = max(0, 5 - $attempts['count']);
                echo json_encode(['success' => false, 'error' => '用户名或密码错误', 'remaining' => $remaining]);
                exit;
            }

            // 更新最后登录时间
            foreach ($usersData['users'] as &$user) {
                if ($user['id'] === $foundUser['id']) {
                    $user['lastLogin'] = date('c');
                    break;
                }
            }
            unset($user);
            saveUsers($usersData);

            // 设置会话
            clearLibFailedAttempts();
            $_SESSION['library_authenticated'] = true;
            $_SESSION['library_auth_time'] = time();
            $_SESSION['current_user_id'] = $foundUser['id'];
            $_SESSION['current_user_role'] = $foundUser['role'];
            // 同步设置后台认证状态，前台登录后后台无需重新登录（与 admin/api.php 登录逻辑对称）
            $_SESSION['settings_authenticated'] = true;
            $_SESSION['settings_auth_time'] = time();

            unset($foundUser['passwordHash']);
            $foundUser['permissions'] = getUserEffectivePermissions($foundUser);
            echo json_encode([
                'success' => true,
                'user' => [
                    'id' => $foundUser['id'],
                    'username' => $foundUser['username'],
                    'role' => $foundUser['role'],
                    'permissions' => $foundUser['permissions']
                ]
            ]);
            exit;
        }

        // 用户自主注册（公开接口，受后台 registrationEnabled 开关控制）
        if ($action === 'registerUser') {
            $authMode = getAuthMode();
            if ($authMode !== 'multi-user') {
                echo json_encode(['success' => false, 'error' => '当前不支持账户注册']);
                exit;
            }
            if (!isRegistrationEnabled()) {
                echo json_encode(['success' => false, 'error' => '管理员已关闭用户注册']);
                exit;
            }

            // 复用登录限流（防止注册接口被刷）
            checkLibRateLimit();

            $username = isset($input['username']) ? trim($input['username']) : '';
            $password = isset($input['password']) ? $input['password'] : '';
            $confirm = isset($input['confirmPassword']) ? $input['confirmPassword'] : '';

            if ($username === '') {
                echo json_encode(['success' => false, 'error' => '用户名不能为空']);
                exit;
            }

            // 用户名长度限制（2-50 位）
            if (mb_strlen($username) < 2 || mb_strlen($username) > 50) {
                echo json_encode(['success' => false, 'error' => '用户名长度需为 2-50 位']);
                exit;
            }

            // 用户名格式验证（只允许中文、字母、数字、下划线）
            if (!preg_match('/^[\x{4e00}-\x{9fa5}a-zA-Z0-9_]+$/u', $username)) {
                echo json_encode(['success' => false, 'error' => '用户名只能包含中文、字母、数字、下划线']);
                exit;
            }

            if (strlen($password) < 6 || strlen($password) > 72) {
                echo json_encode(['success' => false, 'error' => '密码长度需为 6-72 位']);
                exit;
            }

            if ($password !== $confirm) {
                echo json_encode(['success' => false, 'error' => '两次输入的密码不一致']);
                exit;
            }

            // 注册默认角色校验（必须为已存在的非超管角色）
            $defaultRole = getDefaultRegisterRole();
            $rolesData = loadRoles();
            $roleExists = false;
            $isProtectedRole = false;
            foreach ($rolesData['roles'] as $r) {
                if ($r['id'] === $defaultRole) {
                    $roleExists = true;
                    // 超级管理员角色不允许作为注册默认角色，防止越权
                    $permList = isset($r['permissions']) && is_array($r['permissions']) ? $r['permissions'] : [];
                    if (in_array('*', $permList, true)) {
                        $isProtectedRole = true;
                    }
                    break;
                }
            }
            if (!$roleExists || $isProtectedRole) {
                // 配置异常时回退到 role_viewer，避免阻断注册
                $defaultRole = 'role_viewer';
            }

            $usersData = loadUsers();

            // 检查用户名是否已存在
            foreach ($usersData['users'] as $user) {
                if ($user['username'] === $username) {
                    recordLibFailedAttempt();
                    echo json_encode(['success' => false, 'error' => '用户名已存在']);
                    exit;
                }
            }

            $newUser = [
                'id' => 'usr_' . bin2hex(random_bytes(8)),
                'username' => $username,
                'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
                'role' => $defaultRole,
                'permissions' => null,
                'createdAt' => date('c'),
                'updatedAt' => date('c'),
                'lastLogin' => null,
                'notes' => null,
                'status' => 'active',
                'loginCount' => 0,
            ];

            $usersData['users'][] = $newUser;
            saveUsers($usersData);

            // 注册成功后自动登录
            clearLibFailedAttempts();
            $_SESSION['library_authenticated'] = true;
            $_SESSION['library_auth_time'] = time();
            $_SESSION['current_user_id'] = $newUser['id'];
            $_SESSION['current_user_role'] = $newUser['role'];
            // 同步设置后台认证状态，注册后后台无需重新登录
            $_SESSION['settings_authenticated'] = true;
            $_SESSION['settings_auth_time'] = time();

            // 更新登录计数与最后登录时间
            foreach ($usersData['users'] as &$u) {
                if ($u['id'] === $newUser['id']) {
                    $u['lastLogin'] = date('c');
                    $u['loginCount'] = ($u['loginCount'] ?? 0) + 1;
                    $newUser['lastLogin'] = $u['lastLogin'];
                    $newUser['loginCount'] = $u['loginCount'];
                    break;
                }
            }
            unset($u);
            saveUsers($usersData);

            unset($newUser['passwordHash']);
            $newUser['permissions'] = getUserEffectivePermissions($newUser);
            echo json_encode([
                'success' => true,
                'user' => [
                    'id' => $newUser['id'],
                    'username' => $newUser['username'],
                    'role' => $newUser['role'],
                    'permissions' => $newUser['permissions']
                ]
            ]);
            exit;
        }

        // 获取当前用户登录状态
        if ($action === 'getUserLoginStatus') {
            $authMode = getAuthMode();
            $currentUser = getCurrentUser();

            if ($currentUser) {
                $permissions = getUserEffectivePermissions($currentUser);
                echo json_encode([
                    'success' => true,
                    'authMode' => $authMode,
                    'authenticated' => isLibraryAuthed(),
                    'user' => [
                        'id' => $currentUser['id'],
                        'username' => $currentUser['username'],
                        'role' => $currentUser['role'],
                        'permissions' => $permissions
                    ]
                ]);
            } else {
                echo json_encode([
                    'success' => true,
                    'authMode' => $authMode,
                    'authenticated' => isLibraryAuthed(),
                    'user' => null
                ]);
            }
            exit;
        }

        if ($action === 'saveLibrarySettings') {
            // 文案库密码保护配置（需管理员认证）
            requireSettingsAuth();
            $settings = loadLibrarySettings();
            if (!is_array($settings)) $settings = [];

            // 开关
            if (isset($input['enabled'])) {
                $settings['libraryPasswordEnabled'] = !empty($input['enabled']);
            }

            // 访问有效期（秒，0=永不超时）
            if (isset($input['authTimeout'])) {
                $t = (int)$input['authTimeout'];
                if ($t >= 0) {
                    $settings['libraryAuthTimeout'] = $t;
                }
            }

            // 默认菜单布局（sidebar / top-tabs）
            if (isset($input['layout'])) {
                $layout = $input['layout'];
                if (in_array($layout, ['sidebar', 'top-tabs'], true)) {
                    $settings['layout'] = $layout;
                    // 版本号：前台检测到变更后重置用户的本地布局偏好
                    $settings['layoutVersion'] = time();
                }
            }

            // 设置新密码（可选）
            if (!empty($input['newPassword'])) {
                if (strlen($input['newPassword']) < 6 || strlen($input['newPassword']) > 72) {
                    echo json_encode(['success' => false, 'error' => '密码长度需为 6-72 位']);
                    exit;
                }
                if (!setNewLibraryPassword($input['newPassword'])) {
                    echo json_encode(['success' => false, 'error' => '密码设置失败']);
                    exit;
                }
            }

            saveLibrarySettings($settings);
            loadData(true); // 刷新缓存
            echo json_encode([
                'success' => true,
                'protectionEnabled' => !empty($settings['libraryPasswordEnabled']),
                'hasPassword' => !needsLibraryPasswordSetup(),
                'authTimeout' => getLibraryAuthTimeout(),
                'layout' => isset($settings['layout']) ? $settings['layout'] : 'sidebar'
            ]);
            exit;
        }

        if ($action === 'saveItem') {
            $data = loadData();
            $item = isset($input['item']) ? $input['item'] : [];

            // 权限检查
            if (isset($item['_delete']) && $item['_delete']) {
                requireUserPermission('content.delete');
            } elseif (isset($item['id']) && !empty($item['id'])) {
                requireUserPermission('content.edit');
            } else {
                requireUserPermission('content.create');
            }

            // 输入校验
            if (isset($item['title']) && is_string($item['title'])) {
                // 使用 mb_substr 安全处理 UTF-8 多字节字符，避免截断到半个字符
                if (mb_strlen($item['title'], 'UTF-8') > 200) {
                    $item['title'] = mb_substr($item['title'], 0, 200, 'UTF-8');
                }
            }
            if (isset($item['content']) && is_string($item['content']) && strlen($item['content']) > 1048576) {
                echo json_encode(['success' => false, 'error' => '内容过大，最大允许 1MB']);
                exit;
            }
            // id 格式校验
            if (isset($item['id']) && is_string($item['id']) && !preg_match('/^itm_[a-z0-9_]+$/', $item['id'])) {
                echo json_encode(['success' => false, 'error' => '无效的条目 ID']);
                exit;
            }

            if (isset($item['_delete']) && $item['_delete']) {
                $id = isset($item['id']) ? $item['id'] : '';
                $data['items'] = array_values(array_filter($data['items'], function($i) use ($id) {
                    return $i['id'] !== $id;
                }));
                saveData($data);
                echo json_encode(['success' => true]);
                exit;
            }

            $item['id'] = isset($item['id']) ? $item['id'] : 'itm_' . time() . '_' . bin2hex(random_bytes(4));
            $item['updatedAt'] = date('Y-m-d\TH:i:s\Z');

            $found = false;
            foreach ($data['items'] as &$existing) {
                if ($existing['id'] === $item['id']) {
                    if (!isset($item['createdAt'])) {
                        $item['createdAt'] = $existing['createdAt'];
                    }
                    if (!isset($item['createdBy'])) {
                        $item['createdBy'] = isset($existing['createdBy']) ? $existing['createdBy'] : '';
                    }
                    $existing = $item;
                    $found = true;
                    break;
                }
            }
            unset($existing);
            if (!$found) {
                $item['createdAt'] = isset($item['createdAt']) ? $item['createdAt'] : date('Y-m-d\TH:i:s\Z');
                $currentUser = getCurrentUser();
                $item['createdBy'] = $currentUser ? $currentUser['id'] : '';
                array_unshift($data['items'], $item);
            }

            saveData($data);
            echo json_encode(['success' => true, 'item' => $item]);
            exit;
        } elseif ($action === 'deleteItem') {
            requireUserPermission('content.delete');
            $data = loadData();
            $id = isset($input['id']) ? $input['id'] : '';

            $data['items'] = array_values(array_filter($data['items'], function($i) use ($id) {
                return $i['id'] !== $id;
            }));

            saveData($data);
            echo json_encode(['success' => true]);
            exit;
        } elseif ($action === 'deleteImages') {
            requireUserPermission('images.delete');
            $paths = isset($input['paths']) ? $input['paths'] : [];
            if (!is_array($paths)) $paths = [$paths];
            $deleted = 0;
            $failed = [];
            $imgDir = realpath(IMG_DIR);
            foreach ($paths as $path) {
                // 安全检查：路径必须以 img/ 开头且不含 .. 路径穿越符
                $normalizedPath = str_replace('\\', '/', $path);
                if (strpos($normalizedPath, 'img/') !== 0 || strpos($normalizedPath, '..') !== false) {
                    $failed[] = basename($path) . '(路径无效或不在img目录)';
                    continue;
                }
                // 安全检查：只允许删除 img/ 目录下的文件
                $fullPath = dirname(__FILE__) . '/' . $path;
                $realPath = realpath($fullPath);
                // 使用 DIRECTORY_SEPARATOR 后缀防止前缀混淆（如 /site/img 与 /site/imgsecret）
                if ($realPath && $imgDir && $realPath !== $imgDir && strpos($realPath, $imgDir . DIRECTORY_SEPARATOR) === 0 && is_file($realPath)) {
                    if (@unlink($realPath)) {
                        $deleted++;
                    } else {
                        $failed[] = basename($path) . '(删除失败)';
                    }
                } else {
                    $failed[] = basename($path) . '(路径无效或不在img目录)';
                }
            }
            echo json_encode([
                'success' => true,
                'deleted' => $deleted,
                'failed' => $failed,
                'failedCount' => count($failed)
            ]);
            exit;
        } elseif ($action === 'saveCategories') {
            requireUserPermission('categories.manage');
            $data = loadData();
            $newCategories = isset($input['categories']) ? $input['categories'] : [];
            if (is_array($newCategories)) {
                // 递归验证分类数据，特别是颜色值
                $newCategories = sanitizeCategories($newCategories);
                $data['categories'] = $newCategories;
            }
            saveData($data);
            echo json_encode(['success' => true, 'categories' => $data['categories']]);
            exit;
        } elseif ($action === 'saveItemsOrder') {
            requireUserPermission('content.sort');
            $data = loadData();
            $newItems = isset($input['items']) ? $input['items'] : $data['items'];
            // 数组结构校验
            if (!is_array($newItems)) {
                echo json_encode(['success' => false, 'error' => '无效的排序数据']);
                exit;
            }
            $data['items'] = $newItems;
            saveData($data);
            echo json_encode(['success' => true]);
            exit;
        } elseif ($action === 'saveSettings') {
            requireSettingsAuth();
            $settings = isset($input['settings']) && is_array($input['settings']) ? $input['settings'] : [];
            $ok = saveLibrarySettings($settings);
            if (!$ok) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }
            loadData(true); // 刷新缓存
            echo json_encode(['success' => true, 'settings' => $settings]);
            exit;
        } elseif ($action === 'uploadImage') {
            requireUserPermission('images.upload');
            $maxSize = 10 * 1024 * 1024; // 10MB 限制
            $allowedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

            if (isset($_FILES['image'])) {
                if ($_FILES['image']['error'] !== UPLOAD_ERR_OK) {
                    $errorMap = [
                        UPLOAD_ERR_INI_SIZE  => '文件过大，超出服务器限制（请检查 php.ini 的 upload_max_filesize）',
                        UPLOAD_ERR_FORM_SIZE => '文件过大，超出表单限制',
                        UPLOAD_ERR_PARTIAL   => '文件只上传了一部分，请重试',
                        UPLOAD_ERR_NO_FILE   => '没有上传文件',
                        UPLOAD_ERR_NO_TMP_DIR=> '服务器临时目录不可用',
                        UPLOAD_ERR_CANT_WRITE=> '文件写入失败',
                        UPLOAD_ERR_EXTENSION => '服务器扩展阻止了文件上传',
                    ];
                    $code = $_FILES['image']['error'];
                    $errorMsg = isset($errorMap[$code]) ? $errorMap[$code] : '上传失败（错误码: ' . $code . '）';
                    echo json_encode(['success' => false, 'error' => $errorMsg]);
                    exit;
                }
                $file = $_FILES['image'];

                // 文件大小检查
                if ($file['size'] > $maxSize) {
                    echo json_encode(['success' => false, 'error' => '文件过大，最大允许 10MB']);
                    exit;
                }

                // 文件类型白名单检查
                $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
                if (!in_array($ext, $allowedExts, true)) {
                    echo json_encode(['success' => false, 'error' => '不支持的文件格式，仅允许: ' . implode(', ', $allowedExts)]);
                    exit;
                }

                // 真实 MIME 校验
                if (!verifyImageMime($file['tmp_name'], $ext)) {
                    echo json_encode(['success' => false, 'error' => '文件类型与扩展名不匹配']);
                    exit;
                }

                $filename = generateSecureFilename($ext);
                $filepath = IMG_DIR . '/' . $filename;

                if (move_uploaded_file($file['tmp_name'], $filepath)) {
                    // SVG 上传后清洗脚本
                    if ($ext === 'svg') {
                        $svgContent = file_get_contents($filepath);
                        $cleaned = stripSvgScripts($svgContent);
                        if ($cleaned !== $svgContent) {
                            file_put_contents($filepath, $cleaned);
                        }
                    }
                    echo json_encode(['success' => true, 'url' => 'img/' . $filename]);
                    exit;
                } else {
                    echo json_encode(['success' => false, 'error' => '文件保存失败']);
                    exit;
                }
            } elseif (isset($input['base64'])) {
                $base64 = $input['base64'];
                if (preg_match('/^data:image\/(\w+);base64,(.+)$/s', $base64, $matches)) {
                    $ext = strtolower($matches[1]);
                    if ($ext === 'jpeg') $ext = 'jpg';

                    // 文件类型白名单
                    if (!in_array($ext, $allowedExts, true)) {
                        echo json_encode(['success' => false, 'error' => '不支持的图片格式']);
                        exit;
                    }

                    $imgData = base64_decode($matches[2]);

                    // 大小检查
                    if (strlen($imgData) > $maxSize) {
                        echo json_encode(['success' => false, 'error' => '图片数据过大，最大允许 10MB']);
                        exit;
                    }

                    $filename = generateSecureFilename($ext);
                    $filepath = IMG_DIR . '/' . $filename;

                    if (file_put_contents($filepath, $imgData)) {
                        // 真实 MIME 校验（写入后检查）
                        if (!verifyImageMime($filepath, $ext)) {
                            @unlink($filepath);
                            echo json_encode(['success' => false, 'error' => '文件类型与扩展名不匹配']);
                            exit;
                        }
                        // SVG 清洗
                        if ($ext === 'svg') {
                            $cleaned = stripSvgScripts($imgData);
                            if ($cleaned !== $imgData) {
                                file_put_contents($filepath, $cleaned);
                            }
                        }
                        echo json_encode(['success' => true, 'url' => 'img/' . $filename]);
                        exit;
                    } else {
                        echo json_encode(['success' => false, 'error' => '文件保存失败']);
                        exit;
                    }
                } else {
                    echo json_encode(['success' => false, 'error' => '无效的base64数据']);
                    exit;
                }
            } else {
                echo json_encode(['success' => false, 'error' => '没有上传文件']);
                exit;
            }
        } elseif ($action === 'clearAll') {
            // 清空所有数据需要密码验证
            requireSettingsAuth();
            // 清空业务数据（categories + items），保留运行配置 settings 不受影响
            $data = ['categories' => [], 'items' => []];
            saveData($data);

            // 清空所有用户的云端收藏（文案已全部删除，收藏引用已失效）
            if (file_exists(FAVORITES_FILE)) {
                @file_put_contents(FAVORITES_FILE, json_encode(['favorites' => []], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
            }

            // 删除所有上传的图片（使用 glob 兼容所有平台和 PHP 版本）
            $deletedImages = 0;
            $errors = [];
            if (is_dir(IMG_DIR)) {
                // 匹配 img/ 下所有文件（包括子目录中的文件）
                $files = array_merge(
                    glob(IMG_DIR . '/*') ?: [],
                    glob(IMG_DIR . '/*/*') ?: [],
                    glob(IMG_DIR . '/*/*/*') ?: []
                );
                foreach ($files as $filepath) {
                    if (is_file($filepath)) {
                        if (@unlink($filepath)) {
                            $deletedImages++;
                        } else {
                            $errors[] = basename($filepath) . '(权限不足)';
                        }
                    }
                }
            }

            echo json_encode([
                'success' => true,
                'deletedImages' => $deletedImages,
                'errors' => $errors ? count($errors) . '个文件删除失败: ' . implode(', ', $errors) : null
            ]);
            exit;

        } elseif ($action === 'fullImport') {
            // 全量恢复需要密码验证
            requireSettingsAuth();
            // 全量恢复：数据 + 图片
            $backup = isset($input['backup']) ? $input['backup'] : null;
            if (!$backup || !isset($backup['data']) || !isset($backup['images'])) {
                echo json_encode(['success' => false, 'error' => '无效的备份文件格式']);
                exit;
            }

            // 1. 恢复数据
            $backupData = $backup['data'];
            if (!is_array($backupData) || !isset($backupData['items']) || !isset($backupData['categories'])) {
                echo json_encode(['success' => false, 'error' => '备份数据结构不正确']);
                exit;
            }
            if (!is_array($backupData['items']) || !is_array($backupData['categories'])) {
                echo json_encode(['success' => false, 'error' => '备份数据格式不正确']);
                exit;
            }
            // 清洗导入的分类数据
            $backupData['categories'] = sanitizeCategories($backupData['categories']);
            saveData($backupData);

            // 2. 恢复图片
            $restoredImages = 0;
            $imgDir = realpath(IMG_DIR);
            $allowedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
            foreach ($backup['images'] as $relPath => $base64Data) {
                // 安全检查路径：必须以 img/ 开头
                if (strpos($relPath, 'img/') !== 0) continue;
                // 安全检查：防止路径穿越
                if (strpos($relPath, '..') !== false) continue;
                // 安全检查：文件扩展名必须是图片类型（从 pathinfo 取，不从 base64 头取）
                $ext = strtolower(pathinfo($relPath, PATHINFO_EXTENSION));
                if (!in_array($ext, $allowedExts, true)) continue;

                if (preg_match('/^data:image\/(\w+);base64,(.+)$/s', $base64Data, $matches)) {
                    $imgBin = base64_decode($matches[2]);
                    if ($imgBin) {
                        $filepath = __DIR__ . '/' . $relPath;
                        $dir = dirname($filepath);
                        // realpath false 处理：先 mkdir 再 realpath
                        if (!is_dir($dir)) {
                            @mkdir($dir, 0755, true);
                        }
                        $realDirPath = realpath($dir);
                        if ($realDirPath === false) {
                            // 目录创建失败，跳过此文件
                            continue;
                        }
                        $realFilePath = $realDirPath . '/' . basename($filepath);
                        // 再次验证最终路径在 img 目录内（用分隔符后缀防前缀混淆）
                        if ($imgDir && $realFilePath !== $imgDir && strpos($realFilePath, $imgDir . DIRECTORY_SEPARATOR) !== 0) continue;
                        @file_put_contents($filepath, $imgBin);
                        $restoredImages++;
                    }
                }
            }

            echo json_encode([
                'success' => true,
                'message' => "已恢复 {$restoredImages} 张图片"
            ]);
            exit;

        } elseif ($action === 'import') {
            requireUserPermission('content.create');
            $json = isset($input['json']) ? $input['json'] : '';
            $importData = json_decode($json, true);
            if ($importData && isset($importData['items'])) {
                $data = loadData();
                foreach ($importData['items'] as $item) {
                    $item['id'] = 'itm_' . time() . '_' . bin2hex(random_bytes(4));
                    $item['createdAt'] = date('Y-m-d\TH:i:s\Z');
                    $item['updatedAt'] = date('Y-m-d\TH:i:s\Z');
                    array_unshift($data['items'], $item);
                }
                if (isset($importData['categories']) && !empty($importData['categories'])) {
                    // 清洗导入的分类数据
                    $data['categories'] = sanitizeCategories($importData['categories']);
                }
                saveData($data);
                echo json_encode(['success' => true]);
                exit;
            } else {
                echo json_encode(['success' => false, 'error' => '无效的JSON数据']);
                exit;
            }
        } elseif ($action === 'createShare') {
            // 创建分享链接
            requireUserPermission('content.share');
            $itemId = isset($input['itemId']) ? trim($input['itemId']) : '';
            $expiresAt = isset($input['expiresAt']) && $input['expiresAt'] ? $input['expiresAt'] : null;
            $maxViews = isset($input['maxViews']) && $input['maxViews'] ? (int)$input['maxViews'] : null;
            $password = isset($input['password']) && $input['password'] ? $input['password'] : null;

            if ($itemId === '') {
                echo json_encode(['success' => false, 'error' => '缺少文案ID']);
                exit;
            }
            // 校验文案存在
            $data = loadData();
            $itemExists = false;
            foreach ($data['items'] as $it) {
                if ($it['id'] === $itemId) { $itemExists = true; break; }
            }
            if (!$itemExists) {
                echo json_encode(['success' => false, 'error' => '文案不存在']);
                exit;
            }
            // 校验过期时间
            if ($expiresAt !== null && strtotime($expiresAt) <= time()) {
                echo json_encode(['success' => false, 'error' => '过期时间必须晚于当前时间']);
                exit;
            }
            // 校验查看次数
            if ($maxViews !== null && $maxViews <= 0) {
                echo json_encode(['success' => false, 'error' => '查看次数必须大于0']);
                exit;
            }

            $currentUser = getCurrentUser();

            // 加排他锁，防止并发创建分享时互相覆盖数据
            $lockFp = acquireSharesLock();
            if (!$lockFp) {
                echo json_encode(['success' => false, 'error' => '系统繁忙，请稍后重试']);
                exit;
            }
            try {
                // 锁内加载当前分享数据
                $sharesData = loadShares();
                // 锁内生成唯一 token（内存查重，避免重复 IO）
                $token = generateShareToken($sharesData);
                // 追加新分享
                $sharesData['shares'][] = [
                    'token' => $token,
                    'itemId' => $itemId,
                    'createdAt' => date('c'),
                    'expiresAt' => $expiresAt,
                    'maxViews' => $maxViews,
                    'viewCount' => 0,
                    'lastViewAt' => null,
                    'password' => $password ? password_hash($password, PASSWORD_DEFAULT) : null,
                    'createdBy' => $currentUser ? $currentUser['id'] : '',
                ];
                saveShares($sharesData);
            } finally {
                releaseSharesLock($lockFp);
            }

            // 构建分享 URL
            $shareUrl = buildShareUrl($token);

            echo json_encode(['success' => true, 'token' => $token, 'url' => $shareUrl]);
            exit;
        } elseif ($action === 'deleteShare') {
            // 撤销分享链接
            requireUserPermission('content.share');
            $token = isset($input['token']) ? trim($input['token']) : '';
            if ($token === '') {
                echo json_encode(['success' => false, 'error' => '缺少分享 token']);
                exit;
            }
            $lockFp = acquireSharesLock();
            if (!$lockFp) {
                echo json_encode(['success' => false, 'error' => '系统繁忙，请稍后重试']);
                exit;
            }
            try {
                $sharesData = loadShares();
                $found = false;
                $sharesData['shares'] = array_values(array_filter($sharesData['shares'], function($s) use ($token, &$found) {
                    if ($s['token'] === $token) { $found = true; return false; }
                    return true;
                }));
                if (!$found) {
                    echo json_encode(['success' => false, 'error' => '分享链接不存在']);
                    exit;
                }
                saveShares($sharesData);
            } finally {
                releaseSharesLock($lockFp);
            }
            echo json_encode(['success' => true]);
            exit;
        } elseif ($action === 'updateShare') {
            // 更新分享链接配置
            requireUserPermission('content.share');
            $token = isset($input['token']) ? trim($input['token']) : '';
            if ($token === '') {
                echo json_encode(['success' => false, 'error' => '缺少分享 token']);
                exit;
            }
            $lockFp = acquireSharesLock();
            if (!$lockFp) {
                echo json_encode(['success' => false, 'error' => '系统繁忙，请稍后重试']);
                exit;
            }
            try {
                $sharesData = loadShares();
                $found = false;
                foreach ($sharesData['shares'] as &$s) {
                    if ($s['token'] === $token) {
                        $found = true;
                        if (isset($input['expiresAt'])) $s['expiresAt'] = $input['expiresAt'] ?: null;
                        if (isset($input['maxViews'])) $s['maxViews'] = $input['maxViews'] ? (int)$input['maxViews'] : null;
                        if (isset($input['password']) && $input['password']) $s['password'] = password_hash($input['password'], PASSWORD_DEFAULT);
                        if (array_key_exists('clearPassword', $input) && $input['clearPassword']) $s['password'] = null;
                        break;
                    }
                }
                unset($s);
                if (!$found) {
                    echo json_encode(['success' => false, 'error' => '分享链接不存在']);
                    exit;
                }
                saveShares($sharesData);
            } finally {
                releaseSharesLock($lockFp);
            }
            echo json_encode(['success' => true]);
            exit;
        } elseif ($action === 'saveFavorites') {
            // 保存当前登录用户的云端收藏（全量替换）
            requireLibraryAuth();
            $currentUser = getCurrentUser();
            if (!$currentUser) {
                echo json_encode(['success' => false, 'error' => '需要账户登录才能使用云端收藏', 'needsLogin' => true]);
                exit;
            }
            $ids = isset($input['favorites']) ? $input['favorites'] : [];
            $cleanIds = sanitizeFavoritesIds($ids);

            $lockFp = acquireFavoritesLock();
            if (!$lockFp) {
                echo json_encode(['success' => false, 'error' => '系统繁忙，请稍后重试']);
                exit;
            }
            try {
                $favoritesData = loadFavorites();
                $favoritesData['favorites'][$currentUser['id']] = $cleanIds;
                saveFavoritesData($favoritesData);
            } finally {
                releaseFavoritesLock($lockFp);
            }
            echo json_encode(['success' => true, 'count' => count($cleanIds)]);
            exit;
        } elseif ($action === 'driveShareInfo') {
            $token = isset($input['token']) ? trim($input['token']) : '';
            if ($token === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }
            $driveFile = SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'drive.json';
            if (!file_exists($driveFile)) {
                echo json_encode(['success' => false, 'error' => '分享不存在']);
                exit;
            }
            $raw = @file_get_contents($driveFile);
            $data = json_decode($raw, true);
            if (!is_array($data) || !isset($data['shares'])) {
                echo json_encode(['success' => false, 'error' => '分享不存在']);
                exit;
            }
            $share = null;
            foreach ($data['shares'] as $s) {
                if ($s['token'] === $token) { $share = $s; break; }
            }
            if (!$share) {
                echo json_encode(['success' => false, 'error' => '分享不存在或已失效']);
                exit;
            }
            // Check expiration
            if (!empty($share['expiresAt']) && strtotime($share['expiresAt']) < time()) {
                echo json_encode(['success' => false, 'error' => '分享已过期']);
                exit;
            }
            // Check download limit
            if ($share['maxDownloads'] !== null && (int)$share['downloadCount'] >= (int)$share['maxDownloads']) {
                echo json_encode(['success' => false, 'error' => '下载次数已用完']);
                exit;
            }
            echo json_encode([
                'success' => true,
                'fileName' => $share['fileName'],
                'fileSize' => $share['fileSize'],
                'hasPassword' => !empty($share['hasPassword']),
                'expiresAt' => $share['expiresAt'],
                'downloadCount' => $share['downloadCount'],
                'maxDownloads' => $share['maxDownloads'],
            ]);
            exit;
        } elseif ($action === 'driveShareDownload') {
            $token = isset($input['token']) ? trim($input['token']) : '';
            $password = isset($input['password']) ? $input['password'] : '';
            if ($token === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }
            $driveFile = SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'drive.json';
            if (!file_exists($driveFile)) {
                echo json_encode(['success' => false, 'error' => '分享不存在']);
                exit;
            }
            $raw = @file_get_contents($driveFile);
            $data = json_decode($raw, true);
            if (!is_array($data) || !isset($data['shares'])) {
                echo json_encode(['success' => false, 'error' => '分享不存在']);
                exit;
            }
            $share = null;
            $shareIdx = -1;
            foreach ($data['shares'] as $i => $s) {
                if ($s['token'] === $token) { $share = $s; $shareIdx = $i; break; }
            }
            if (!$share) {
                echo json_encode(['success' => false, 'error' => '分享不存在']);
                exit;
            }
            // Check expiration
            if (!empty($share['expiresAt']) && strtotime($share['expiresAt']) < time()) {
                echo json_encode(['success' => false, 'error' => '分享已过期']);
                exit;
            }
            // Check download limit
            if ($share['maxDownloads'] !== null && (int)$share['downloadCount'] >= (int)$share['maxDownloads']) {
                echo json_encode(['success' => false, 'error' => '下载次数已用完']);
                exit;
            }
            // Check password
            if (!empty($share['hasPassword'])) {
                // 安全修复：为网盘分享下载添加速率限制，防止密码暴力破解
                // 使用 token 哈希作为 key，避免不同分享之间相互影响
                $tokenHash = md5($token);
                $rateKey = 'drive_dl_attempts_' . $tokenHash;
                $attempts = isset($_SESSION[$rateKey]) ? $_SESSION[$rateKey] : ['count' => 0, 'lockout' => 0];
                if ($attempts['lockout'] > time()) {
                    http_response_code(429);
                    $waitMin = ceil(($attempts['lockout'] - time()) / 60);
                    echo json_encode(['success' => false, 'error' => "尝试过多，请 {$waitMin} 分钟后再试", 'needPassword' => true, 'lockout' => $attempts['lockout'] - time()]);
                    exit;
                }
                if ($password === '' || !password_verify($password, $share['password'])) {
                    $attempts['count']++;
                    if ($attempts['count'] >= 5) {
                        $attempts['lockout'] = time() + 900; // 15 分钟锁定
                        $attempts['count'] = 0;
                    }
                    $_SESSION[$rateKey] = $attempts;
                    $remaining = 5 - $attempts['count'];
                    echo json_encode(['success' => false, 'error' => '密码错误', 'needPassword' => true, 'remaining' => max(0, $remaining)]);
                    exit;
                }
                // 密码验证成功，清除该 token 的失败计数
                unset($_SESSION[$rateKey]);
            }
            // Find file - 安全检查：路径必须解析到 drive/ 目录内
            $filePath = $share['filePath'];
            $absPath = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $filePath);
            $realAbsPath = realpath($absPath);
            $driveRoot = realpath(SITE_ROOT . 'drive');
            if ($realAbsPath === false || $driveRoot === false ||
                $realAbsPath !== $driveRoot && strpos($realAbsPath, $driveRoot . DIRECTORY_SEPARATOR) !== 0) {
                echo json_encode(['success' => false, 'error' => '文件不存在']);
                exit;
            }
            if (!file_exists($realAbsPath)) {
                echo json_encode(['success' => false, 'error' => '文件不存在']);
                exit;
            }
            // 原子化更新下载计数（失败时保留原文件）
            $data['shares'][$shareIdx]['downloadCount'] = (int)$data['shares'][$shareIdx]['downloadCount'] + 1;
            cpydes_json_save_atomic($driveFile, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

            // Stream file
            $fileName = $share['fileName'];
            $fileSize = filesize($realAbsPath);
            $mimeType = $share['mimeType'] ?? 'application/octet-stream';

            // 安全修复：下载前重新校验文件 MIME 类型，防止存储型 XSS
            if (function_exists('finfo_open')) {
                $finfo = finfo_open(FILEINFO_MIME_TYPE);
                $actualMime = finfo_file($finfo, $realAbsPath);
                finfo_close($finfo);
                if ($actualMime && strpos($actualMime, 'image/') === 0) {
                    $mimeType = $actualMime;
                }
            }

            header('Content-Type: ' . $mimeType);
            $filenameEncoded = rawurlencode($fileName);
            header('Content-Disposition: attachment; filename="' . $filenameEncoded . '"; filename*=UTF-8\'\'' . $filenameEncoded);
            header('Content-Length: ' . $fileSize);
            header('Cache-Control: no-cache, must-revalidate');
            header('X-Content-Type-Options: nosniff');
            readfile($realAbsPath);
            exit;
        } elseif ($action === 'saveAiSettings') {
            // 保存 AI 设置（需要后台管理员认证，与 saveSettings/saveLibrarySettings 保持一致）
            requireSettingsAuth();
            $aiSettings = isset($input['settings']) ? $input['settings'] : [];
            // 验证和清理 AI 设置
            $validatedSettings = validateAiSettings($aiSettings);
            // 保留 modelDetections
            if (!isset($validatedSettings['modelDetections'])) {
                $currentConfig = loadAiConfig();
                $validatedSettings['modelDetections'] = $validatedSettings['modelDetections']
                    ?? (isset($currentConfig['modelDetections']) ? $currentConfig['modelDetections'] : []);
            }
            saveAiConfig($validatedSettings);
            echo json_encode(['success' => true, 'settings' => $validatedSettings]);
            exit;
        } elseif ($action === 'testAiModel') {
            // 测试 AI 模型连接并获取可用模型列表（需要后台管理员认证）
            requireSettingsAuth();
            $apiUrl = isset($input['apiUrl']) ? trim($input['apiUrl']) : '';
            $apiKey = isset($input['apiKey']) ? trim($input['apiKey']) : '';
            
            if (empty($apiUrl) || empty($apiKey)) {
                echo json_encode(['success' => false, 'error' => 'API 地址和密钥不能为空']);
                exit;
            }
            
            // 规范化 URL：支持完整端点路径或基础 URL
            $baseApiUrl = rtrim($apiUrl, '/');
            // 若用户填写了完整端点路径，提取基础 URL 用于 /models 探测
            $knownEndpoints = ['/chat/completions', '/images/generations', '/videos'];
            foreach ($knownEndpoints as $ep) {
                if (substr($baseApiUrl, -strlen($ep)) === $ep) {
                    $baseApiUrl = substr($baseApiUrl, 0, -strlen($ep));
                    break;
                }
            }
            if (!str_ends_with($baseApiUrl, '/v1')) {
                $baseApiUrl .= '/v1';
            }
            
            // 提前加载当前配置，用于获取模型列表
            $currentConfig = loadAiConfig();

            // 尝试获取模型列表
            $models = [];
            $supportedTypes = ['chat', 'image', 'video'];
            
            foreach ($supportedTypes as $type) {
                $endpoint = $baseApiUrl . '/models';
                $ch = curl_init($endpoint);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_TIMEOUT, 10);
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
                curl_setopt($ch, CURLOPT_HTTPHEADER, [
                    'Authorization: Bearer ' . $apiKey,
                    'Content-Type: application/json'
                ]);
                $response = curl_exec($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $curlError = curl_error($ch);
                curl_close($ch);
                
                if ($httpCode === 200 && $response) {
                    $decoded = json_decode($response, true);
                    if (isset($decoded['data']) && is_array($decoded['data'])) {
                        foreach ($decoded['data'] as $m) {
                            $modelId = $m['id'] ?? '';
                            if (!empty($modelId)) {
                                $models[] = [
                                    'id' => $modelId,
                                    'type' => $type,
                                ];
                            }
                        }
                        break; // 成功获取后不再重试
                    }
                }
            }
            
            // 补充 models 数组（从之前 /models 接口获取的）
            $finalModels = [];
            foreach ($models as $m) {
                $finalModels[] = ['id' => $m['id'], 'type' => $m['type']];
            }
            
            $connected = !empty($models);
            
            echo json_encode([
                'success' => true,
                'connected' => $connected,
                'models' => array_unique_by($finalModels, 'id'),
            ]);
            
            // 保存检测结果到 AI 配置：按 model.id 分别保存
            if ($connected) {
                $currentConfig = loadAiConfig();
                if (!isset($currentConfig['modelDetections'])) $currentConfig['modelDetections'] = [];
                
                foreach ($currentConfig['models'] ?? [] as $m) {
                    if (isset($m['apiUrl']) && isset($m['apiKey']) && 
                        rtrim($m['apiUrl'], '/') === $baseApiUrl && 
                        $m['apiKey'] === $apiKey) {
                        $currentConfig['modelDetections'][$m['id']] = [
                            'timestamp' => time() * 1000,
                            'models' => isset($finalModels[0]) ? array_map(fn($mdl) => ['id' => $mdl['id'], 'type' => $mdl['type']], $finalModels) : []
                        ];
                    }
                }
                
                saveAiConfig($currentConfig);
            }
            exit;
        } elseif ($action === 'aiChat') {
            // AI 对话 SSE 流式接口：后台管理员可直接使用；前端用户需账户登录且拥有 ai.use 权限
            if (!requireAiAccess()) exit;
            // 获取 AI 设置
            $aiSettings = loadAiConfig();
            if (empty($aiSettings['enabled'])) {
                echo json_encode(['success' => false, 'error' => 'AI 功能未启用']);
                exit;
            }
            $messages = isset($input['messages']) ? $input['messages'] : [];
            $model = isset($input['model']) ? $input['model'] : 'default';
            if (empty($messages) || !is_array($messages)) {
                echo json_encode(['success' => false, 'error' => '消息不能为空']);
                exit;
            }
            // 查找对应模型配置
            $modelConfig = null;
            $models = isset($aiSettings['models']) ? $aiSettings['models'] : [];
            foreach ($models as $m) {
                if ($m['id'] === $model) {
                    $modelConfig = $m;
                    break;
                }
            }
            if (!$modelConfig && !empty($models)) {
                $modelConfig = $models[0]; // 使用第一个模型作为默认
            }
            if (!$modelConfig) {
                echo json_encode(['success' => false, 'error' => '未配置 AI 模型']);
                exit;
            }
            // 调用 AI API 并流式返回
            handleAiChatStream($modelConfig, $messages, $aiSettings);
            exit;
        } elseif ($action === 'aiGenerateImage') {
            // AI 图片生成接口（同步）：需要 ai.use 权限
            if (!requireAiAccess()) exit;
            $aiSettings = getEnabledAiSettings();
            if ($aiSettings === null) exit;

            $prompt = isset($input['prompt']) ? trim($input['prompt']) : '';
            $model = isset($input['model']) ? $input['model'] : '';
            $size = isset($input['size']) ? $input['size'] : '';
            $n = isset($input['n']) ? max(1, min(4, (int)$input['n'])) : 1;
            if (empty($prompt)) {
                echo json_encode(['success' => false, 'error' => '提示词不能为空']);
                exit;
            }
            $modelConfig = findAiModelConfig($aiSettings, $model);
            if (!$modelConfig) {
                echo json_encode(['success' => false, 'error' => '未配置图片生成模型']);
                exit;
            }
            handleAiImageGeneration($modelConfig, $prompt, $size, $n);
            exit;
        } elseif ($action === 'aiVideoCreate') {
            // AI 视频生成接口（创建异步任务）：需要 ai.use 权限
            if (!requireAiAccess()) exit;
            $aiSettings = getEnabledAiSettings();
            if ($aiSettings === null) exit;

            $prompt = isset($input['prompt']) ? trim($input['prompt']) : '';
            $model = isset($input['model']) ? $input['model'] : '';
            $imageUrl = isset($input['imageUrl']) ? trim($input['imageUrl']) : '';
            if (empty($prompt)) {
                echo json_encode(['success' => false, 'error' => '提示词不能为空']);
                exit;
            }
            $modelConfig = findAiModelConfig($aiSettings, $model);
            if (!$modelConfig) {
                echo json_encode(['success' => false, 'error' => '未配置视频生成模型']);
                exit;
            }
            handleAiVideoGeneration($modelConfig, $prompt, $imageUrl);
            exit;
        } else {
            echo json_encode(['success' => false, 'error' => '未知操作']);
            exit;
        }
    } elseif ($method === 'DELETE') {
        parse_str(file_get_contents('php://input'), $input);

        // DELETE 方法也需 CSRF 校验
        requireCsrfCheck($action);

        // 文案库密码保护：DELETE 写操作需通过文案库验证
        requireLibraryAuth();

        if ($action === 'deleteItem') {
            requireUserPermission('content.delete');
            $data = loadData();
            $id = isset($input['id']) ? $input['id'] : '';
            $data['items'] = array_values(array_filter($data['items'], function($i) use ($id) {
                return $i['id'] !== $id;
            }));
            saveData($data);
            echo json_encode(['success' => true]);
            exit;
        } else {
            echo json_encode(['success' => false, 'error' => '未知操作']);
            exit;
        }
    } else {
        echo json_encode(['success' => false, 'error' => '不支持的请求方法']);
        exit;
    }
} catch (Exception $e) {
    // 信息泄露修复：不向客户端暴露 $e->getMessage()
    error_log('api.php error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    echo json_encode(['success' => false, 'error' => '服务器内部错误']);
}
?>
