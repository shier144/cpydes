<?php
/**
 * Cpydes 管理后台专用 API
 * 提供主站 api.php 不具备的管理员操作：
 *   - scanImages: 扫描 img/ 目录，标记引用状态和文件大小
 *   - deleteUnreferencedImages: 批量清理未引用的孤儿图片
 *   - systemInfo: 真实 PHP/服务器/磁盘信息
 *
 * 认证：复用主站 settings_authenticated 会话（30 分钟超时）
 */

// 启动输出缓冲，捕获任何意外输出
ob_start();

// 抑制PHP错误输出，确保只返回JSON
error_reporting(0);
ini_set('display_errors', 0);

// 全局异常和错误处理，确保始终返回JSON
set_exception_handler(function($e) {
    if (ob_get_level()) ob_clean();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => '服务器内部错误: ' . $e->getMessage()]);
    exit;
});

set_error_handler(function($errno, $errstr, $errfile, $errline) {
    // 尊重 @ 抑制符和 error_reporting(0) 设置
    // 当错误被 @ 抑制或 error_reporting 为 0 时，不转换为 500
    if (!(error_reporting() & $errno)) {
        return false; // 交由 PHP 默认处理（即抑制）
    }
    if (ob_get_level()) ob_clean();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'PHP错误: ' . $errstr]);
    exit;
});

register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (ob_get_level()) ob_clean();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => '致命错误: ' . $error['message']]);
    }
});

// 共享库（JSON 原子读写、认证/权限、通用辅助函数）
require_once dirname(__DIR__) . '/lib/json_store.php';
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/helpers.php';

// 显式设置时区，消除日志/统计时间偏差
cpydes_timezone_init();

// 设置 session cookie 路径为根目录，确保与前端共享 session
cpydes_session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

// 清空输出缓冲区，确保后续输出干净
ob_end_clean();

// CORS：仅同源
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// 路径常量（admin/ 是子目录，data/ 和 img/ 在上级站点根目录）
define('ADMIN_DIR', dirname(__FILE__) . DIRECTORY_SEPARATOR);
define('SITE_ROOT', dirname(ADMIN_DIR) . DIRECTORY_SEPARATOR);
define('DATA_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'copywriting.json');
define('AI_CONFIG_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'ai-config.json');
// 文案库运行配置（从 copywriting.json 拆离，避免业务数据膨胀影响配置写入性能）
define('LIBRARY_SETTINGS_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'library_settings.json');
define('IMG_DIR', SITE_ROOT . 'img');
define('PWD_HASH_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . '.pwd_hash');
define('LIB_PWD_HASH_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . '.lib_pwd_hash');
define('USERS_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'users.json');
define('ACTIVITY_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'user_activity.json');
define('ONLINE_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'user_online.json');
define('SHARES_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'shares.json');
define('SHARES_LOCK_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . '.shares.lock');
define('AUDIT_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'audit_log.json');
define('ROLES_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'roles.json');
define('BACKUPS_DIR', SITE_ROOT . 'backups');

define('PAGE_VIEWS_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'page_views.json');
define('DRIVE_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'drive.json');
define('DRIVE_DIR', SITE_ROOT . 'drive');
define('FAVORITES_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'favorites.json');
define('FAVORITES_LOCK_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . '.favorites.lock');
// 弹窗公告数据文件路径（与前台共享同一文件）
define('ANNOUNCEMENTS_FILE', SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'announcements.json');

// ============ 函数库（由本文件机械拆分至 admin/lib/） ============
require_once __DIR__ . '/lib/users.php';
require_once __DIR__ . '/lib/data.php';
require_once __DIR__ . '/lib/drive.php';
require_once __DIR__ . '/lib/backup.php';
// 引入文案库 settings 独立文件读写函数（loadLibrarySettings/saveLibrarySettings/updateLibrarySetting）
// 必须在 DATA_FILE / LIBRARY_SETTINGS_FILE 常量定义之后引入，否则 settings.php 顶部的常量守卫会 403 退出
require_once dirname(__DIR__) . '/lib/settings.php';
// 引入弹窗公告存储函数（cpydes_load_announcements 等）
// 必须在 ANNOUNCEMENTS_FILE 常量定义之后引入，否则 lib/announcements.php 会用兜底路径
require_once dirname(__DIR__) . '/lib/announcements.php';
require_once dirname(__DIR__) . '/lib/sync.php';

// ============ 请求处理 ============
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

try {
    // 公开接口：无需认证即可访问（登录、CSRF Token、登出）
    if ($action === 'userLogin' && $method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
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
            recordActivity('', $username, 'login.fail', '登录失败: 用户名或密码错误', false);
            echo json_encode(['success' => false, 'error' => '用户名或密码错误']);
            exit;
        }

        // 检查用户状态
        $userStatus = isset($foundUser['status']) ? $foundUser['status'] : 'active';
        if ($userStatus !== 'active') {
            $statusMsg = $userStatus === 'disabled' ? '该账号已被禁用' : '该账号已被封禁';
            recordActivity($foundUser['id'], $foundUser['username'], 'login.fail', $statusMsg, false);
            echo json_encode(['success' => false, 'error' => $statusMsg]);
            exit;
        }

        // 更新最后登录时间和登录次数
        foreach ($usersData['users'] as &$user) {
            if ($user['id'] === $foundUser['id']) {
                $user['lastLogin'] = date('c');
                $user['loginCount'] = isset($user['loginCount']) ? (int)$user['loginCount'] + 1 : 1;
                break;
            }
        }
        unset($user);
        saveUsers($usersData);

        // 设置会话
        $_SESSION['settings_authenticated'] = true;
        $_SESSION['settings_auth_time'] = time();
        $_SESSION['current_user_id'] = $foundUser['id'];
        $_SESSION['current_user_role'] = $foundUser['role'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        
        // 同时设置前端认证状态，后台登录后前端无需重新登录
        $_SESSION['library_authenticated'] = true;
        $_SESSION['library_auth_time'] = time();
        
        // 提交会话数据，确保写入存储
        session_commit();

        // 记录活动日志和注册在线会话
        recordActivity($foundUser['id'], $foundUser['username'], 'login', '登录成功');
        registerOnlineSession($foundUser['id'], $foundUser['username'], $foundUser['role']);
        recordAudit('users.login', '用户: ' . $foundUser['username'], ['userId' => $foundUser['id'], 'role' => $foundUser['role']], true);

        unset($foundUser['passwordHash']);
        $foundUser['permissions'] = getUserEffectivePermissions($foundUser);
        echo json_encode([
            'success' => true,
            'user' => $foundUser,
            'authMode' => getAuthMode()
        ]);
        exit;
    }

    if ($action === 'getCsrfToken' && $method === 'GET') {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        echo json_encode(['success' => true, 'token' => $_SESSION['csrf_token']]);
        exit;
    }

    // 公开接口：获取分享的文案（无需登录）
    if ($action === 'getShare' && $method === 'GET') {
        $token = isset($_GET['token']) ? trim($_GET['token']) : '';
        if ($token === '') {
            echo json_encode(['success' => false, 'error' => 'invalid', 'message' => '分享链接无效']);
            exit;
        }
        $sharesData = loadShares();
        $share = null;
        foreach ($sharesData['shares'] as $s) {
            if ($s['token'] === $token) { $share = $s; break; }
        }
        if (!$share) {
            echo json_encode(['success' => false, 'error' => 'invalid', 'message' => '分享链接不存在或已被撤销']);
            exit;
        }
        // 检查过期
        if (!empty($share['expiresAt']) && strtotime($share['expiresAt']) < time()) {
            echo json_encode(['success' => false, 'error' => 'expired', 'message' => '分享链接已过期']);
            exit;
        }
        // 检查查看次数上限
        if (!empty($share['maxViews']) && (int)$share['viewCount'] >= (int)$share['maxViews']) {
            echo json_encode(['success' => false, 'error' => 'view_limit', 'message' => '分享链接已达查看次数上限']);
            exit;
        }
        // 密码校验
        if (!empty($share['password'])) {
            // 安全修复：优先从请求头读取密码，避免密码出现在 URL/日志/Referer 中
            $pwdInput = '';
            if (isset($_SERVER['HTTP_X_SHARE_PASSWORD'])) {
                $pwdInput = $_SERVER['HTTP_X_SHARE_PASSWORD'];
            } elseif (isset($_GET['password'])) {
                // 向后兼容：保留 GET 参数支持（已弃用）
                $pwdInput = $_GET['password'];
            }
            if ($pwdInput === '' || !password_verify($pwdInput, $share['password'])) {
                echo json_encode(['success' => false, 'needPassword' => true, 'message' => $pwdInput === '' ? '请输入密码' : '密码错误，请重新输入']);
                exit;
            }
        }
        // 获取文案
        $data = adminLoadData();
        $item = null;
        foreach ($data['items'] as $it) {
            if ($it['id'] === $share['itemId']) { $item = $it; break; }
        }
        if (!$item) {
            echo json_encode(['success' => false, 'error' => 'deleted', 'message' => '分享的文案已被删除']);
            exit;
        }
        // 获取分类名与颜色
        $categoryName = '';
        $categoryColor = '#6366f1';
        foreach ($data['categories'] as $cat) {
            if ($cat['id'] === $item['categoryId']) {
                $categoryName = $cat['name'];
                $categoryColor = isset($cat['color']) ? $cat['color'] : '#6366f1';
                break;
            }
            if (!empty($cat['children'])) {
                foreach ($cat['children'] as $child) {
                    if ($child['id'] === $item['categoryId']) {
                        $categoryName = $child['name'];
                        $categoryColor = isset($child['color']) ? $child['color'] : '#818cf8';
                        break 2;
                    }
                }
            }
        }
        // 增加查看次数（加锁防止并发计数丢失与 TOCTOU 越限）
        $newViewCount = (int)$share['viewCount'] + 1;
        $lockFp = acquireSharesLock();
        if ($lockFp) {
            try {
                // 锁内重新加载，获取最新计数
                $freshShares = loadShares();
                $limitExceeded = false;
                foreach ($freshShares['shares'] as &$s) {
                    if ($s['token'] === $token) {
                        // 锁内重新校验查看次数上限（防止并发请求绕过限制）
                        if (!empty($s['maxViews']) && (int)$s['viewCount'] >= (int)$s['maxViews']) {
                            $limitExceeded = true;
                            $newViewCount = (int)$s['viewCount'];
                            break;
                        }
                        $newViewCount = (int)$s['viewCount'] + 1;
                        $s['viewCount'] = $newViewCount;
                        $s['lastViewAt'] = date('c');
                        break;
                    }
                }
                unset($s);
                if (!$limitExceeded) {
                    saveShares($freshShares);
                }
            } finally {
                releaseSharesLock($lockFp);
            }
        }

        // 读取文案库名称（来自独立配置文件 library_settings.json）
        $libSettings = loadLibrarySettings();
        $libraryName = isset($libSettings['libraryName']) ? $libSettings['libraryName'] : '文案库';
        // 读取"默认分段展示"配置，传递给分享页
        $previewSegmentDefault = !empty($libSettings['previewSegmentDefault']);

        // 返回分享的文案（扁平化结构，便于前端直接使用 res.data）
        echo json_encode([
            'success' => true,
            'data' => [
                'title' => $item['title'],
                'content' => $item['content'],
                'categoryId' => $item['categoryId'],
                'categoryName' => $categoryName,
                'categoryColor' => $categoryColor,
                'createdAt' => $item['createdAt'] ?? '',
                'updatedAt' => $item['updatedAt'] ?? '',
                'expireAt' => $share['expiresAt'] ?? null,
                'viewCount' => $newViewCount,
                'viewLimit' => $share['maxViews'] ?? 0,
                'libraryName' => $libraryName,
                'previewSegmentDefault' => $previewSegmentDefault,
            ]
        ]);
        exit;
    }

    // 所有其他接口均需认证
    requireAdminAuth();

    if ($action === 'logout') {
        // 登出操作需要 CSRF 校验（敏感操作）
        requireAdminCsrf($action);
        $currentUser = getCurrentUser();
        if ($currentUser) {
            recordActivity($currentUser['id'], $currentUser['username'], 'logout', '登出');
        }
        unregisterOnlineSession();
        unset($_SESSION['settings_authenticated']);
        unset($_SESSION['settings_auth_time']);
        unset($_SESSION['csrf_token']);
        session_destroy();
        echo json_encode(['success' => true]);
        exit;
    }

    if ($method === 'GET') {

        // 列出分享链接（需要管理员登录）
        if ($action === 'listShares') {
            requirePermission('view.shares');
            $sharesData = loadShares();
            $data = adminLoadData();
            $itemMap = [];
            foreach ($data['items'] as $it) $itemMap[$it['id']] = $it;
            // 构建 userId -> username 映射，用于解析分享人
            $usersData = loadUsers();
            $userMap = [];
            foreach ($usersData['users'] as $u) $userMap[$u['id']] = $u['username'];
            
            // 数据隔离：非超级管理员只能看到自己创建的分享
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                $sharesData['shares'] = array_values(array_filter($sharesData['shares'], function($s) use ($currentUserId) {
                    return ($s['createdBy'] ?? '') === $currentUserId;
                }));
            }
            
            $shares = [];
            foreach ($sharesData['shares'] as $s) {
                $item = $itemMap[$s['itemId']] ?? null;
                $creatorId = $s['createdBy'] ?? '';
                $shares[] = [
                    'token' => $s['token'],
                    'itemId' => $s['itemId'],
                    'itemTitle' => $item ? $item['title'] : '(文案已删除)',
                    'itemExists' => $item !== null,
                    'createdAt' => $s['createdAt'],
                    'expiresAt' => $s['expiresAt'] ?? null,
                    'maxViews' => $s['maxViews'] ?? null,
                    'viewCount' => $s['viewCount'] ?? 0,
                    'lastViewAt' => $s['lastViewAt'] ?? null,
                    'hasPassword' => !empty($s['password']),
                    'createdBy' => $creatorId,
                    'createdByName' => isset($userMap[$creatorId]) ? $userMap[$creatorId] : '',
                ];
            }
            // 按创建时间倒序
            usort($shares, function($a, $b) { return strcmp($b['createdAt'], $a['createdAt']); });
            echo json_encode(['success' => true, 'shares' => $shares]);
            exit;
        }

        if ($action === 'getAll') {
            // 需至少拥有一个内容相关视图权限才允许加载全量数据
            $contentViewPerms = ['view.dashboard', 'view.content', 'view.categories', 'view.dedup', 'view.images', 'view.shares'];
            $allowed = false;
            foreach ($contentViewPerms as $perm) {
                if (hasPermission($perm)) { $allowed = true; break; }
            }
            if (!$allowed) {
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => '权限不足，无法访问内容数据']);
                exit;
            }
            $data = adminLoadData();
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
        }

        if ($action === 'listBackups') {
            requirePermission('view.backup');
            $backups = listServerBackups();
            echo json_encode(['success' => true, 'backups' => $backups]);
            exit;
        }

        if ($action === 'downloadBackup') {
            requirePermission('backup.create');
            $backupId = isset($_GET['id']) ? $_GET['id'] : '';
            $backupId = basename($backupId);
            if (!preg_match('/^backup_\d{8}_\d{6}_[a-zA-Z0-9]{4}\.json$/', $backupId)) {
                echo json_encode(['success' => false, 'error' => '无效的备份文件名']);
                exit;
            }
            $filepath = BACKUPS_DIR . DIRECTORY_SEPARATOR . $backupId;
            if (!file_exists($filepath)) {
                echo json_encode(['success' => false, 'error' => '备份文件不存在']);
                exit;
            }
            header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="' . $backupId . '"');
            header('Content-Length: ' . filesize($filepath));
            readfile($filepath);
            exit;
        }

        if ($action === 'scanImages') {
            requirePermission('images.scan');
            $data = adminLoadData();
            $referenced = collectReferencedImages($data['items']);
            $files = scanImageDir();

            $images = [];
            $totalSize = 0;
            $referencedCount = 0;
            $orphanCount = 0;

            foreach ($files as $filepath) {
                // 转换为相对路径（正斜杠）
                $relPath = str_replace('\\', '/', substr($filepath, strlen(SITE_ROOT)));
                $size = @filesize($filepath);
                if ($size === false) $size = 0;
                $totalSize += $size;
                $isRef = isset($referenced[$relPath]);
                if ($isRef) $referencedCount++; else $orphanCount++;

                $images[] = [
                    'path' => $relPath,
                    'name' => basename($filepath),
                    'size' => $size,
                    'sizeText' => formatBytes($size),
                    'referenced' => $isRef,
                    'modified' => @filemtime($filepath),
                ];
            }

            // 按修改时间倒序
            usort($images, function($a, $b) {
                return ($b['modified'] ?? 0) - ($a['modified'] ?? 0);
            });

            echo json_encode([
                'success' => true,
                'images' => $images,
                'total' => count($images),
                'referencedCount' => $referencedCount,
                'orphanCount' => $orphanCount,
                'totalSize' => $totalSize,
                'totalSizeText' => formatBytes($totalSize),
            ]);
            exit;
        }

        if ($action === 'systemInfo') {
            requirePermission('view.system');
            $data = adminLoadData();
            $itemCount = count($data['items']);
            $catCount = count($data['categories']);
            $subCatCount = 0;
            foreach ($data['categories'] as $cat) {
                if (isset($cat['children']) && is_array($cat['children'])) {
                    $subCatCount += count($cat['children']);
                }
            }

            // 数据文件信息
            $dataSize = file_exists(DATA_FILE) ? @filesize(DATA_FILE) : 0;
            $dataMtime = file_exists(DATA_FILE) ? @filemtime(DATA_FILE) : 0;

            // img 目录信息
            $imgFiles = scanImageDir();
            $imgTotalSize = 0;
            foreach ($imgFiles as $f) {
                $s = @filesize($f);
                if ($s !== false) $imgTotalSize += $s;
            }

            // 磁盘空间
            $diskFree = @disk_free_space(SITE_ROOT);
            $diskTotal = @disk_total_space(SITE_ROOT);

            // 检查密码状态
            $envPwd = getenv('SETTINGS_PASSWORD');
            $hasPwdHash = file_exists(PWD_HASH_FILE) && trim((string)file_get_contents(PWD_HASH_FILE)) !== '';
            $pwdSource = ($envPwd !== false && $envPwd !== '') ? '环境变量' : ($hasPwdHash ? '哈希文件' : '未设置');

            echo json_encode([
                'success' => true,
                'info' => [
                    // 数据统计
                    'itemCount' => $itemCount,
                    'catCount' => $catCount,
                    'subCatCount' => $subCatCount,
                    'dataSize' => $dataSize,
                    'dataSizeText' => formatBytes($dataSize),
                    'dataMtime' => $dataMtime,
                    'dataMtimeText' => $dataMtime ? date('Y-m-d H:i:s', $dataMtime) : '-',
                    'imageCount' => count($imgFiles),
                    'imageTotalSize' => $imgTotalSize,
                    'imageTotalSizeText' => formatBytes($imgTotalSize),
                    // 服务器环境
                    'phpVersion' => PHP_VERSION,
                    'serverSoftware' => $_SERVER['SERVER_SOFTWARE'] ?? 'Unknown',
                    'serverOS' => PHP_OS,
                    'sapi' => PHP_SAPI,
                    'timezone' => date_default_timezone_get(),
                    // 磁盘
                    'diskFree' => $diskFree,
                    'diskTotal' => $diskTotal,
                    'diskFreeText' => $diskFree !== false ? formatBytes($diskFree) : '-',
                    'diskTotalText' => $diskTotal !== false ? formatBytes($diskTotal) : '-',
                    'diskUsedPercent' => ($diskTotal !== false && $diskTotal > 0 && $diskFree !== false)
                        ? round(($diskTotal - $diskFree) / $diskTotal * 100, 1) : null,
                    // 扩展
                    'extensions' => [
                        'fileinfo' => extension_loaded('fileinfo'),
                        'json' => extension_loaded('json'),
                        'mbstring' => extension_loaded('mbstring'),
                        'gd' => extension_loaded('gd'),
                        'curl' => extension_loaded('curl'),
                        'zip' => extension_loaded('zip'),
                    ],
                    // 安全
                    'pwdSource' => $pwdSource,
                    'csrfToken' => !empty($_SESSION['csrf_token']),
                    'sessionName' => session_name(),
                    'sessionId' => session_id(),
                    // 路径
                    'siteRoot' => SITE_ROOT,
                    'phpSelf' => $_SERVER['PHP_SELF'] ?? '',
                ],
            ]);
            exit;
        }

        if ($action === 'getServerStats') {
            /**
             * 检查路径是否在 open_basedir 允许的范围内
             * 在受 open_basedir 限制的服务器上，直接调用 is_readable('/proc/xxx')
             * 会触发 "open_basedir restriction in effect" 警告，即使路径确实存在。
             * 此函数先解析 open_basedir 配置，只有在路径位于允许范围内时才返回 true。
             */
            $isPathAllowedByBasedir = function($path) {
                $basedir = ini_get('open_basedir');
                if ($basedir === false || $basedir === '') {
                    return true; // 未设置 open_basedir，无限制
                }
                // Windows 用分号分隔，Linux 用冒号分隔
                $separator = (PHP_OS_FAMILY === 'Windows') ? ';' : ':';
                $allowedPaths = explode($separator, $basedir);
                // 注意：不要对 $path 调用 realpath() 或 is_readable()，
                // 这些函数在受限路径上本身就会触发 open_basedir 警告。
                // 直接用原始路径字符串做前缀匹配即可。
                $normalizedPath = str_replace('\\', '/', $path);
                foreach ($allowedPaths as $allowed) {
                    $allowed = rtrim(str_replace('\\', '/', $allowed), '/');
                    if ($allowed === '') continue;
                    // 路径等于允许目录，或以 "允许目录 + /" 开头
                    if ($normalizedPath === $allowed || strpos($normalizedPath, $allowed . '/') === 0) {
                        return true;
                    }
                }
                return false;
            };

            // 检查 shell 函数是否可用（未被 disable_functions 禁用）
            // 当 open_basedir 限制 /proc 访问时，通过 shell 命令作为回退方案
            $shellFuncAvailable = function($func) {
                if (!function_exists($func)) return false;
                $disabled = ini_get('disable_functions');
                if ($disabled) {
                    $disabledList = array_map('trim', explode(',', $disabled));
                    if (in_array($func, $disabledList, true)) return false;
                }
                return true;
            };

            // 安全执行 shell 命令的统一入口：依次尝试 shell_exec / exec / popen
            // 宝塔等面板通常禁用 shell_exec，但 popen 经常仍然可用
            $safeShellExec = function($cmd) use ($shellFuncAvailable) {
                // 方式1: shell_exec
                if ($shellFuncAvailable('shell_exec')) {
                    $out = @shell_exec($cmd . ' 2>/dev/null');
                    if ($out !== null && trim($out) !== '') return $out;
                }
                // 方式2: exec
                if ($shellFuncAvailable('exec')) {
                    $output = [];
                    $retCode = -1;
                    @exec($cmd . ' 2>/dev/null', $output, $retCode);
                    if ($retCode === 0 && !empty($output)) {
                        return implode("\n", $output);
                    }
                }
                // 方式3: popen（常被遗忘未禁用）
                if ($shellFuncAvailable('popen')) {
                    $handle = @popen($cmd . ' 2>/dev/null', 'r');
                    if ($handle !== false) {
                        $out = stream_get_contents($handle);
                        pclose($handle);
                        if ($out !== false && trim($out) !== '') return $out;
                    }
                }
                return null;
            };

            requirePermission('view.serverMonitor');
            $stats = ['success' => true, 'stats' => []];

            // PHP 内存使用
            $memUsage = function_exists('memory_get_usage') ? memory_get_usage(true) : 0;
            $memPeak = function_exists('memory_get_peak_usage') ? memory_get_peak_usage(true) : 0;
            $memLimit = ini_get('memory_limit');
            $memLimitBytes = parsePhpSize($memLimit);
            $stats['stats']['php'] = [
                'version' => PHP_VERSION,
                'sapi' => PHP_SAPI,
                'memoryUsage' => $memUsage,
                'memoryUsageText' => formatBytes($memUsage),
                'memoryPeak' => $memPeak,
                'memoryPeakText' => formatBytes($memPeak),
                'memoryLimit' => $memLimit,
                'memoryLimitText' => $memLimitBytes > 0 ? formatBytes($memLimitBytes) : $memLimit,
                'memoryUsedPercent' => ($memLimitBytes > 0) ? round($memUsage / $memLimitBytes * 100, 1) : null,
                'memoryPeakPercent' => ($memLimitBytes > 0) ? round($memPeak / $memLimitBytes * 100, 1) : null,
                'maxExecutionTime' => ini_get('max_execution_time'),
                'uploadMaxFilesize' => ini_get('upload_max_filesize'),
                'postMaxSize' => ini_get('post_max_size'),
                'opcacheEnabled' => function_exists('opcache_get_status') && !empty(opcache_get_status(false)['opcache_enabled']),
                'opcacheMemoryUsage' => null,
                'opcacheHitRate' => null,
            ];

            // OPcache 详情
            if (function_exists('opcache_get_status')) {
                $opStatus = @opcache_get_status(false);
                if (is_array($opStatus)) {
                    $opMemUsage = $opStatus['memory_usage'] ?? [];
                    $stats['stats']['php']['opcacheMemoryUsage'] = isset($opMemUsage['used_memory']) ? formatBytes($opMemUsage['used_memory']) : null;
                    $stats['stats']['php']['opcacheHitRate'] = isset($opStatus['opcache_statistics']['opcache_hit_rate'])
                        ? round($opStatus['opcache_statistics']['opcache_hit_rate'], 2) : null;
                }
            }

            // 磁盘空间
            $diskFree = @disk_free_space(SITE_ROOT);
            $diskTotal = @disk_total_space(SITE_ROOT);
            $stats['stats']['disk'] = [
                'free' => $diskFree,
                'total' => $diskTotal,
                'used' => ($diskFree !== false && $diskTotal !== false) ? ($diskTotal - $diskFree) : 0,
                'freeText' => $diskFree !== false ? formatBytes($diskFree) : '-',
                'totalText' => $diskTotal !== false ? formatBytes($diskTotal) : '-',
                'usedText' => ($diskFree !== false && $diskTotal !== false) ? formatBytes($diskTotal - $diskFree) : '-',
                'usedPercent' => ($diskTotal !== false && $diskTotal > 0 && $diskFree !== false)
                    ? round(($diskTotal - $diskFree) / $diskTotal * 100, 1) : null,
            ];

            // 系统负载
            $isWindows = PHP_OS_FAMILY === 'Windows';
            if (!$isWindows) {
                $loadAvg = function_exists('sys_getloadavg') ? @sys_getloadavg() : false;
                $stats['stats']['load'] = [
                    'available' => $loadAvg !== false && $loadAvg[0] !== false,
                    'load1' => ($loadAvg !== false && isset($loadAvg[0])) ? round($loadAvg[0], 2) : null,
                    'load5' => ($loadAvg !== false && isset($loadAvg[1])) ? round($loadAvg[1], 2) : null,
                    'load15' => ($loadAvg !== false && isset($loadAvg[2])) ? round($loadAvg[2], 2) : null,
                ];
            } else {
                // Windows: 获取 CPU 使用率（多种方式尝试）
                $cpuUsage = null;
                $canExec = function_exists('exec');

                // 方式1: wmic
                if ($canExec) {
                    $output = [];
                    @exec('wmic cpu get LoadPercentage /value 2>nul', $output, $retCode);
                    if ($retCode === 0 && !empty($output)) {
                        foreach ($output as $line) {
                            $line = trim($line);
                            if (preg_match('/^LoadPercentage\s*=\s*(\d+)/', $line, $m)) {
                                $cpuUsage = (int)$m[1];
                                break;
                            }
                        }
                    }
                }

                // 方式2: PowerShell
                if ($cpuUsage === null && $canExec) {
                    $psOut = @exec('powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty LoadPercentage" 2>nul', $out2, $psRet);
                    if ($psRet === 0 && $psOut !== false) {
                        $val = trim($psOut);
                        if (preg_match('/^\d+$/', $val)) {
                            $cpuUsage = (int)$val;
                        }
                    }
                }

                // 方式3: COM / WMI
                if ($cpuUsage === null && class_exists('COM')) {
                    try {
                        $wmi = new COM('WinMgmts:\\\\.');
                        $cpus = $wmi->ExecQuery('SELECT LoadPercentage FROM Win32_Processor');
                        if ($cpus && $cpus->Count() > 0) {
                            $totalLoad = 0; $count = 0;
                            foreach ($cpus as $cpu) {
                                if ($cpu->LoadPercentage !== null) {
                                    $totalLoad += $cpu->LoadPercentage;
                                    $count++;
                                }
                            }
                            if ($count > 0) {
                                $cpuUsage = round($totalLoad / $count);
                            }
                        }
                    } catch (\Exception $e) {}
                }

                // 方式4: shell_exec + PowerShell
                if ($cpuUsage === null && function_exists('shell_exec') && !in_array('shell_exec', array_map('trim', explode(',', ini_get('disable_functions'))))) {
                    $shOut = @shell_exec('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).LoadPercentage" 2>nul');
                    if ($shOut !== null) {
                        $val = trim($shOut);
                        if (preg_match('/^\d+$/', $val)) {
                            $cpuUsage = (int)$val;
                        }
                    }
                }

                $stats['stats']['load'] = [
                    'available' => $cpuUsage !== null,
                    'type' => 'cpuUsage',
                    'cpuUsage' => $cpuUsage,
                ];
            }

            // 内存信息
            $memInfo = ['available' => false];
            if ($isPathAllowedByBasedir('/proc/meminfo') && @is_readable('/proc/meminfo')) {
                $content = @file_get_contents('/proc/meminfo');
                if ($content) {
                    $parsed = [];
                    if (preg_match_all('/^([^:]+):\s+(\d+)\s*kB$/m', $content, $matches, PREG_SET_ORDER)) {
                        foreach ($matches as $m) {
                            $parsed[trim($m[1])] = (int)$m[2] * 1024; // 转换为字节
                        }
                    }
                    $total = $parsed['MemTotal'] ?? 0;
                    $available = $parsed['MemAvailable'] ?? ($parsed['MemFree'] ?? 0);
                    $free = $parsed['MemFree'] ?? 0;
                    if ($total > 0) {
                        $memInfo = [
                            'available' => true,
                            'total' => $total,
                            'totalText' => formatBytes($total),
                            'free' => $free,
                            'freeText' => formatBytes($free),
                            'availableBytes' => $available,
                            'availableText' => formatBytes($available),
                            'used' => $total - $available,
                            'usedText' => formatBytes($total - $available),
                            'usedPercent' => round(($total - $available) / $total * 100, 1),
                            'cached' => $parsed['Cached'] ?? 0,
                            'buffers' => $parsed['Buffers'] ?? 0,
                        ];
                    }
                }
            } elseif ($isWindows) {
                // Windows: 获取内存信息（多种方式尝试）
                $winTotal = null; $winFree = null;
                $canExec = function_exists('exec');

                // 方式1: wmic
                if ($canExec) {
                    $output = [];
                    @exec('wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /value 2>nul', $output, $retCode);
                    if ($retCode === 0 && !empty($output)) {
                        foreach ($output as $line) {
                            $line = trim($line);
                            if (preg_match('/^TotalVisibleMemorySize\s*=\s*(\d+)/', $line, $m)) {
                                $winTotal = (int)$m[1] * 1024; // KB → bytes
                            }
                            if (preg_match('/^FreePhysicalMemory\s*=\s*(\d+)/', $line, $m)) {
                                $winFree = (int)$m[1] * 1024; // KB → bytes
                            }
                        }
                    }
                }

                // 方式2: PowerShell
                if (($winTotal === null || $winFree === null) && $canExec) {
                    $psOut = @exec('powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json)" 2>nul', $psLines, $psRet);
                    if ($psRet === 0 && !empty($psLines)) {
                        $json = implode('', $psLines);
                        $d = @json_decode($json, true);
                        if (is_array($d)) {
                            if ($winTotal === null && isset($d['TotalVisibleMemorySize'])) {
                                $winTotal = (int)$d['TotalVisibleMemorySize'] * 1024;
                            }
                            if ($winFree === null && isset($d['FreePhysicalMemory'])) {
                                $winFree = (int)$d['FreePhysicalMemory'] * 1024;
                            }
                        }
                    }
                }

                // 方式3: COM / WMI
                if (($winTotal === null || $winFree === null) && class_exists('COM')) {
                    try {
                        $wmi = new COM('WinMgmts:\\\\.');
                        $osSet = $wmi->ExecQuery('SELECT TotalVisibleMemorySize,FreePhysicalMemory FROM Win32_OperatingSystem');
                        foreach ($osSet as $os) {
                            if ($winTotal === null && $os->TotalVisibleMemorySize !== null) {
                                $winTotal = (int)$os->TotalVisibleMemorySize * 1024;
                            }
                            if ($winFree === null && $os->FreePhysicalMemory !== null) {
                                $winFree = (int)$os->FreePhysicalMemory * 1024;
                            }
                        }
                    } catch (\Exception $e) {}
                }

                // 方式4: shell_exec + PowerShell
                if (($winTotal === null || $winFree === null) && function_exists('shell_exec')) {
                    $shOut = @shell_exec('powershell -NoProfile -Command "$o=Get-CimInstance Win32_OperatingSystem; Write-Output \"$($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)\"" 2>nul');
                    if ($shOut !== null) {
                        $parts = preg_split('/\s+/', trim($shOut));
                        if (count($parts) >= 2 && is_numeric($parts[0]) && is_numeric($parts[1])) {
                            if ($winTotal === null) $winTotal = (int)$parts[0] * 1024;
                            if ($winFree === null) $winFree = (int)$parts[1] * 1024;
                        }
                    }
                }
                if ($winTotal !== null && $winTotal > 0) {
                    $used = $winTotal - ($winFree ?? 0);
                    $memInfo = [
                        'available' => true,
                        'total' => $winTotal,
                        'totalText' => formatBytes($winTotal),
                        'free' => $winFree ?? 0,
                        'freeText' => formatBytes($winFree ?? 0),
                        'availableBytes' => $winFree ?? 0,
                        'availableText' => formatBytes($winFree ?? 0),
                        'used' => $used,
                        'usedText' => formatBytes($used),
                        'usedPercent' => round($used / $winTotal * 100, 1),
                        'cached' => null,
                        'buffers' => null,
                    ];
                }
            }
            // Linux 回退：open_basedir 限制 /proc 时，通过 free 命令获取内存信息
            if (!$memInfo['available'] && !$isWindows) {
                $freeOut = $safeShellExec('free -b');
                if ($freeOut) {
                    $lines = explode("\n", trim($freeOut));
                    $headers = [];
                    foreach ($lines as $line) {
                        if (preg_match('/^Mem:\s+(.+)/', $line, $m)) {
                            $vals = preg_split('/\s+/', trim($m[1]));
                            if (!empty($headers)) {
                                // 按 header 列名映射
                                $colMap = array_combine($headers, $vals);
                                $total = isset($colMap['total']) ? (int)$colMap['total'] : 0;
                                $avail = isset($colMap['available']) ? (int)$colMap['available'] : (isset($colMap['free']) ? (int)$colMap['free'] : 0);
                                $free = isset($colMap['free']) ? (int)$colMap['free'] : 0;
                            } else {
                                // 无 header 行，按固定位置: total used free shared buff/cache available
                                $total = isset($vals[0]) ? (int)$vals[0] : 0;
                                $avail = isset($vals[5]) ? (int)$vals[5] : (isset($vals[2]) ? (int)$vals[2] : 0);
                                $free = isset($vals[2]) ? (int)$vals[2] : 0;
                            }
                            if ($total > 0) {
                                $used = $total - $avail;
                                $memInfo = [
                                    'available' => true,
                                    'total' => $total,
                                    'totalText' => formatBytes($total),
                                    'free' => $free,
                                    'freeText' => formatBytes($free),
                                    'availableBytes' => $avail,
                                    'availableText' => formatBytes($avail),
                                    'used' => $used,
                                    'usedText' => formatBytes($used),
                                    'usedPercent' => round($used / $total * 100, 1),
                                    'cached' => null,
                                    'buffers' => null,
                                ];
                            }
                            break;
                        }
                        // 解析 header 行
                        if (preg_match('/^\s*(total|total\s+used)/i', $line) || preg_match('/^\s+total\s+/i', $line)) {
                            $headers = preg_split('/\s+/', trim($line));
                        }
                    }
                }
            }
            // 最终回退：通过 cat /proc/meminfo 读取（popen 子进程不受 open_basedir 限制）
            if (!$memInfo['available'] && !$isWindows) {
                $memContent = $safeShellExec('cat /proc/meminfo');
                if ($memContent) {
                    $parsed = [];
                    if (preg_match_all('/^([^:]+):\s+(\d+)\s*kB$/m', $memContent, $matches, PREG_SET_ORDER)) {
                        foreach ($matches as $m) {
                            $parsed[trim($m[1])] = (int)$m[2] * 1024;
                        }
                    }
                    $total = $parsed['MemTotal'] ?? 0;
                    $available = $parsed['MemAvailable'] ?? ($parsed['MemFree'] ?? 0);
                    $free = $parsed['MemFree'] ?? 0;
                    if ($total > 0) {
                        $memInfo = [
                            'available' => true,
                            'total' => $total,
                            'totalText' => formatBytes($total),
                            'free' => $free,
                            'freeText' => formatBytes($free),
                            'availableBytes' => $available,
                            'availableText' => formatBytes($available),
                            'used' => $total - $available,
                            'usedText' => formatBytes($total - $available),
                            'usedPercent' => round(($total - $available) / $total * 100, 1),
                            'cached' => $parsed['Cached'] ?? 0,
                            'buffers' => $parsed['Buffers'] ?? 0,
                        ];
                    }
                }
            }
            $stats['stats']['memory'] = $memInfo;

            // CPU 信息
            $cpu = ['available' => false];
            if ($isPathAllowedByBasedir('/proc/cpuinfo') && @is_readable('/proc/cpuinfo')) {
                $content = @file_get_contents('/proc/cpuinfo');
                if ($content) {
                    $cores = preg_match_all('/^processor\s*:/m', $content);
                    $modelName = '';
                    if (preg_match('/^model name\s*:\s*(.+)$/m', $content, $m)) {
                        $modelName = trim($m[1]);
                    }
                    if ($cores > 0) {
                        $cpu = [
                            'available' => true,
                            'cores' => $cores,
                            'modelName' => $modelName,
                        ];
                    }
                }
            } elseif ($isWindows) {
                $procCount = (int)getenv('NUMBER_OF_PROCESSORS');
                $winModelName = '';
                $canExec = function_exists('exec');

                // 方式1: wmic 获取 CPU 型号
                if ($canExec) {
                    $output = [];
                    @exec('wmic cpu get Name /value 2>nul', $output, $retCode);
                    if ($retCode === 0 && !empty($output)) {
                        foreach ($output as $line) {
                            $line = trim($line);
                            if (preg_match('/^Name\s*=\s*(.+)/', $line, $m)) {
                                $winModelName = trim($m[1]);
                                break;
                            }
                        }
                    }
                }

                // 方式2: PowerShell 获取 CPU 型号
                if ($winModelName === '' && $canExec) {
                    $psOut = @exec('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).Name" 2>nul', $psLines, $psRet);
                    if ($psRet === 0 && $psOut !== false) {
                        $val = trim($psOut);
                        if ($val !== '') {
                            $winModelName = $val;
                        }
                    }
                }

                // 方式3: COM / WMI 获取 CPU 型号
                if ($winModelName === '' && class_exists('COM')) {
                    try {
                        $wmi = new COM('WinMgmts:\\\\.');
                        $cpus = $wmi->ExecQuery('SELECT Name FROM Win32_Processor');
                        foreach ($cpus as $proc) {
                            if ($proc->Name) {
                                $winModelName = trim($proc->Name);
                                break;
                            }
                        }
                    } catch (\Exception $e) {}
                }

                // 方式4: shell_exec + PowerShell
                if ($winModelName === '' && function_exists('shell_exec')) {
                    $shOut = @shell_exec('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).Name" 2>nul');
                    if ($shOut !== null) {
                        $val = trim($shOut);
                        if ($val !== '') {
                            $winModelName = $val;
                        }
                    }
                }
                if ($procCount <= 0) {
                    $procCount = 1;
                }
                $cpu = [
                    'available' => true,
                    'cores' => $procCount,
                    'modelName' => $winModelName !== '' ? $winModelName : 'Windows 平台 CPU',
                ];
            }
            // Linux 回退：open_basedir 限制 /proc 时，通过 shell 命令获取 CPU 信息
            if (!$cpu['available'] && !$isWindows) {
                $linuxCores = 0;
                $linuxModel = '';

                // nproc 获取核心数
                $nprocOut = $safeShellExec('nproc');
                if ($nprocOut !== null) {
                    $nprocVal = trim($nprocOut);
                    if (is_numeric($nprocVal) && (int)$nprocVal > 0) {
                        $linuxCores = (int)$nprocVal;
                    }
                }
                // lscpu 获取 CPU 型号和核心数
                $lscpuOut = $safeShellExec('lscpu');
                if ($lscpuOut) {
                    if ($linuxModel === '' && preg_match('/^Model name:\s*(.+)$/m', $lscpuOut, $m)) {
                        $linuxModel = trim($m[1]);
                    }
                    if ($linuxCores <= 0 && preg_match('/^CPU\(s\):\s*(\d+)/m', $lscpuOut, $m)) {
                        $linuxCores = (int)$m[1];
                    }
                }
                // cat /proc/cpuinfo 作为最后手段（popen 子进程不受 open_basedir 限制）
                if ($linuxCores <= 0 || $linuxModel === '') {
                    $cpuinfoOut = $safeShellExec('cat /proc/cpuinfo');
                    if ($cpuinfoOut) {
                        if ($linuxCores <= 0) {
                            $linuxCores = preg_match_all('/^processor\s*:/m', $cpuinfoOut);
                        }
                        if ($linuxModel === '' && preg_match('/^model name\s*:\s*(.+)$/m', $cpuinfoOut, $m)) {
                            $linuxModel = trim($m[1]);
                        }
                    }
                }

                // 最终回退：即使 shell 不可用也至少返回基本信息
                if ($linuxCores <= 0) {
                    $linuxCores = 1;
                }
                if ($linuxModel === '') {
                    // php_uname('m') 返回架构（如 x86_64），php_uname('r') 返回内核版本
                    $arch = php_uname('m');
                    $kernel = php_uname('r');
                    $linuxModel = $arch . ($kernel ? ' (Linux ' . $kernel . ')' : '');
                }
                $cpu = [
                    'available' => true,
                    'cores' => $linuxCores,
                    'modelName' => $linuxModel,
                ];
            }
            $stats['stats']['cpu'] = $cpu;

            // 服务器时间
            $stats['stats']['server'] = [
                'time' => date('Y-m-d H:i:s'),
                'timestamp' => time(),
                'timezone' => date_default_timezone_get(),
                'os' => PHP_OS,
                'osFamily' => PHP_OS_FAMILY,
                'hostname' => function_exists('gethostname') ? gethostname() : 'unknown',
            ];

            echo json_encode($stats);
            exit;
        }

        if ($action === 'getLibrarySettings') {
            if (!hasPermission('view.access') && !hasPermission('view.appearance')) {
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => '权限不足']);
                exit;
            }
            $settings = loadLibrarySettings();
            $enabled = !empty($settings['libraryPasswordEnabled']);
            $allowGuest = !empty($settings['allowGuestAccess']);
            $authTimeout = isset($settings['libraryAuthTimeout']) ? (int)$settings['libraryAuthTimeout'] : 7200;
            $layout = isset($settings['layout']) ? $settings['layout'] : 'sidebar';
            $hasPwd = file_exists(LIB_PWD_HASH_FILE) && trim((string)file_get_contents(LIB_PWD_HASH_FILE)) !== '';
            $previewSegmentDefault = !empty($settings['previewSegmentDefault']);
            $greetingQuotes = isset($settings['greetingQuotes']) && is_array($settings['greetingQuotes'])
                ? array_values($settings['greetingQuotes'])
                : [];
            $guestPermissions = isset($settings['guestPermissions']) && is_array($settings['guestPermissions'])
                ? $settings['guestPermissions']
                : [
                    'content.create', 'content.edit', 'content.delete', 'content.sort', 'content.share',
                    'categories.manage',
                    'images.upload', 'images.delete',
                    'ai.use',
                    'drive.view', 'drive.upload', 'drive.delete', 'drive.rename', 'drive.move', 'drive.folder', 'drive.share',
                ];

            // 用户注册相关配置
            $registrationEnabled = !empty($settings['registrationEnabled']);
            $defaultRegisterRole = isset($settings['defaultRegisterRole']) ? (string)$settings['defaultRegisterRole'] : 'role_viewer';
            // 可选角色列表（排除拥有通配权限的超管角色，防止越权配置）
            $registerRoles = [];
            $rolesData = loadRoles();
            foreach ($rolesData['roles'] as $r) {
                $permList = isset($r['permissions']) && is_array($r['permissions']) ? $r['permissions'] : [];
                if (in_array('*', $permList, true)) continue;
                $registerRoles[] = ['id' => $r['id'], 'name' => $r['name']];
            }
            // 默认角色不在可选列表中（例如配置异常指向超管），补充进去避免下拉框无选项
            $inList = false;
            foreach ($registerRoles as $rr) {
                if ($rr['id'] === $defaultRegisterRole) { $inList = true; break; }
            }
            if (!$inList) {
                $registerRoles[] = ['id' => $defaultRegisterRole, 'name' => $defaultRegisterRole];
            }

            echo json_encode([
                'success' => true,
                'protectionEnabled' => $enabled,
                'allowGuestAccess' => $allowGuest,
                'hasPassword' => $hasPwd,
                'authTimeout' => $authTimeout,
                'layout' => $layout,
                'previewSegmentDefault' => $previewSegmentDefault,
                'greetingQuotes' => $greetingQuotes,
                'guestPermissions' => $guestPermissions,
                'registrationEnabled' => $registrationEnabled,
                'defaultRegisterRole' => $defaultRegisterRole,
                'registerRoles' => $registerRoles,
                'copyReminder' => normalizeCopyReminderConfig($settings['copyReminder'] ?? []),
                'sync' => cpydes_get_sync_config(),
            ]);
            exit;
        }

        if ($action === 'listAnnouncements') {
            // 查看公告管理列表：需要 view.announcements 权限
            if (!hasPermission('view.announcements') && !hasPermission('announcements.manage')) {
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => '权限不足']);
                exit;
            }
            $data = cpydes_load_announcements();
            $list = isset($data['announcements']) && is_array($data['announcements']) ? $data['announcements'] : [];
            // 按 createdAt 倒序（最新的在前）
            usort($list, function($a, $b) {
                $ta = isset($a['createdAt']) ? strtotime($a['createdAt']) : 0;
                $tb = isset($b['createdAt']) ? strtotime($b['createdAt']) : 0;
                return $tb - $ta;
            });
            echo json_encode(['success' => true, 'announcements' => $list]);
            exit;
        }

        if ($action === 'getDedupConfig') {
            requirePermission('dedup.view');
            $settings = loadLibrarySettings();
            $cfg = isset($settings['dedup']) ? $settings['dedup'] : [];
            echo json_encode([
                'success' => true,
                'config' => normalizeDedupConfig($cfg),
            ]);
            exit;
        }

        // 获取用户列表（需要用户管理权限）
        if ($action === 'getUsers') {
            requirePermission('users.manage');
            $usersData = loadUsers();
            
            // 数据隔离：非超级管理员只能看到自己的数据
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                $usersData['users'] = array_values(array_filter($usersData['users'], function($u) use ($currentUserId) {
                    return $u['id'] === $currentUserId;
                }));
            }
            
            // 移除密码哈希，不返回给前端
            $users = array_map(function($user) {
                unset($user['passwordHash']);
                return $user;
            }, $usersData['users']);
            echo json_encode([
                'success' => true,
                'users' => $users,
                'authMode' => getAuthMode(),
                'isSuperAdmin' => isSuperAdmin()
            ]);
            exit;
        }

        // 获取当前登录用户信息
        if ($action === 'getCurrentUser') {
            $currentUser = getCurrentUser();
            if ($currentUser) {
                unset($currentUser['passwordHash']);
                $currentUser['permissions'] = getUserEffectivePermissions($currentUser);
                echo json_encode([
                    'success' => true,
                    'user' => $currentUser,
                    'authMode' => getAuthMode()
                ]);
            } else {
                // 单一密码模式下的兼容处理
                echo json_encode([
                    'success' => true,
                    'user' => null,
                    'authMode' => getAuthMode()
                ]);
            }
            exit;
        }

        // 获取在线用户列表
        if ($action === 'getOnlineUsers') {
            requirePermission('view.onlineUsers');
            $onlineData = loadOnline();
            $beforeCount = count($onlineData['sessions']);
            cleanupExpiredOnline($onlineData);
            // 仅当清理移除了会话时才落盘，避免高频轮询时的磁盘写入
            if (count($onlineData['sessions']) < $beforeCount) {
                saveOnline($onlineData);
            }
            $usersData = loadUsers();
            $userMap = [];
            foreach ($usersData['users'] as $u) {
                $userMap[$u['id']] = $u;
            }
            
            // 数据隔离：非超级管理员只能看到自己的在线状态
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                $onlineData['sessions'] = array_values(array_filter($onlineData['sessions'], function($s) use ($currentUserId) {
                    return $s['userId'] === $currentUserId;
                }));
            }
            
            $sessions = array_map(function($s) use ($userMap) {
                $u = $userMap[$s['userId']] ?? null;
                $s['status'] = $u['status'] ?? 'active';
                return $s;
            }, $onlineData['sessions']);
            echo json_encode(['success' => true, 'sessions' => $sessions]);
            exit;
        }

        // 获取页面访问热力图数据（近 N 天，默认 7 天）
        if ($action === 'getPageViewsStats') {
            requirePermission('view.onlineUsers');
            $days = max(1, min(90, (int)($_GET['days'] ?? 7)));
            $data = loadPageViews();
            $views = $data['views'];
            // 构建日期轴
            $dates = [];
            for ($i = $days - 1; $i >= 0; $i--) {
                $dates[] = date('Y-m-d', time() - $i * 86400);
            }
            // 按 page 聚合，只返回白名单内的页面
            global $VALID_PAGES;
            $pageLabels = [
                'dashboard' => '仪表盘', 'content' => '文案管理', 'dedup' => '查重',
                'categories' => '分类管理', 'images' => '图片管理', 'backup' => '备份',
                'access' => '访问控制', 'appearance' => '外观设置', 'system' => '系统设置',
                'users' => '用户管理', 'onlineUsers' => '在线用户', 'activityLog' => '活动日志',
                'usageStats' => '使用统计', 'shares' => '分享管理',
                'serverMonitor' => '服务器监控', 'auditLog' => '审计日志',
            ];
            $rows = [];
            $maxVal = 0;
            foreach ($VALID_PAGES as $pg) {
                $dayCounts = [];
                $total = 0;
                foreach ($dates as $d) {
                    $cnt = isset($views[$pg][$d]) ? (int)$views[$pg][$d] : 0;
                    $dayCounts[] = ['date' => $d, 'count' => $cnt];
                    $total += $cnt;
                    if ($cnt > $maxVal) $maxVal = $cnt;
                }
                $rows[] = [
                    'page' => $pg,
                    'label' => isset($pageLabels[$pg]) ? $pageLabels[$pg] : $pg,
                    'total' => $total,
                    'days' => $dayCounts,
                ];
            }
            // 按总访问量降序
            usort($rows, function($a, $b) { return $b['total'] - $a['total']; });
            echo json_encode([
                'success' => true,
                'dates' => $dates,
                'rows' => $rows,
                'maxVal' => $maxVal,
                'lastUpdated' => isset($data['lastUpdated']) ? $data['lastUpdated'] : null,
            ]);
            exit;
        }

        // 获取活动日志
        if ($action === 'getActivityLog') {
            requirePermission('view.activityLog');

            $activityData = loadActivity();
            $logs = $activityData['logs'];

            // 数据隔离：非超级管理员只能看到自己的活动日志
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                $logs = array_values(array_filter($logs, function($l) use ($currentUserId) {
                    return ($l['userId'] ?? '') === $currentUserId;
                }));
                $activityData['logs'] = $logs;
            }

            $page = max(1, (int)($_GET['page'] ?? 1));
            $pageSize = min(100, max(1, (int)($_GET['pageSize'] ?? 20)));
            $filterUserId = $_GET['userId'] ?? '';
            // 注意：前端筛选字段名为 actionType，避免与 API 分派参数 action 冲突
            $filterAction = $_GET['actionType'] ?? '';
            $filterSuccess = $_GET['success'] ?? '';
            $filterDateFrom = $_GET['dateFrom'] ?? '';
            $filterDateTo = $_GET['dateTo'] ?? '';

            // 筛选：单次遍历完成全部条件过滤（避免对大日志做多次 array_filter）
            $fromTs = $filterDateFrom !== '' ? strtotime($filterDateFrom) : false;
            $toTs = $filterDateTo !== '' ? strtotime($filterDateTo . ' 23:59:59') : false;
            $successVal = $filterSuccess !== '' ? ($filterSuccess === 'true') : null;
            $filtered = [];
            foreach ($logs as $l) {
                if ($filterUserId !== '' && ($l['userId'] ?? '') !== $filterUserId) continue;
                if ($filterAction !== '' && ($l['action'] ?? '') !== $filterAction) continue;
                if ($successVal !== null && ($l['success'] ?? true) !== $successVal) continue;
                if ($fromTs !== false || $toTs !== false) {
                    $ts = strtotime($l['timestamp'] ?? '');
                    if ($fromTs !== false && $ts < $fromTs) continue;
                    if ($toTs !== false && $ts > $toTs) continue;
                }
                $filtered[] = $l;
            }
            $logs = $filtered;

            // 收集所有操作类型
            $allLogs = $activityData['logs'];
            $actionTypes = array_values(array_unique(array_map(function($l) { return $l['action']; }, $allLogs)));
            sort($actionTypes);

            // 收集可选用户列表（非超级管理员只能选择自己）
            $usersData = loadUsers();
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                $usersData['users'] = array_values(array_filter($usersData['users'], function($u) use ($currentUserId) {
                    return $u['id'] === $currentUserId;
                }));
            }
            $userOptions = array_map(function($u) {
                return ['id' => $u['id'], 'username' => $u['username']];
            }, $usersData['users']);
            usort($userOptions, function($a, $b) { return strcmp($a['username'], $b['username']); });

            $total = count($logs);
            $offset = ($page - 1) * $pageSize;
            $pageLogs = array_slice($logs, $offset, $pageSize);

            echo json_encode([
                'success' => true,
                'logs' => $pageLogs,
                'total' => $total,
                'page' => $page,
                'pageSize' => $pageSize,
                'actionTypes' => $actionTypes,
                'userOptions' => $userOptions,
            ]);
            exit;
        }

        // 获取操作审计日志（listAuditLog）
        if ($action === 'listAuditLog') {
            requirePermission('view.auditLog');

            $auditData = loadAuditLog();
            $logs = $auditData['logs'];

            // 数据隔离：非超级管理员只能看到自己的审计日志
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                $logs = array_values(array_filter($logs, function($l) use ($currentUserId) {
                    return ($l['userId'] ?? '') === $currentUserId;
                }));
                $auditData['logs'] = $logs;
            }

            $page = max(1, (int)($_GET['page'] ?? 1));
            $pageSize = min(200, max(1, (int)($_GET['pageSize'] ?? 30)));
            $filterAction = $_GET['auditAction'] ?? '';
            $filterUserId = $_GET['userId'] ?? '';
            $filterSuccess = $_GET['success'] ?? '';
            $filterDateFrom = $_GET['dateFrom'] ?? '';
            $filterDateTo = $_GET['dateTo'] ?? '';
            $filterKeyword = trim($_GET['keyword'] ?? '');

            // 筛选：单次遍历完成全部条件过滤（避免对大日志做多次 array_filter）
            $fromTs = $filterDateFrom !== '' ? strtotime($filterDateFrom) : false;
            $toTs = $filterDateTo !== '' ? strtotime($filterDateTo . ' 23:59:59') : false;
            $successVal = $filterSuccess !== '' ? ($filterSuccess === 'true') : null;
            $kw = $filterKeyword;
            $filtered = [];
            foreach ($logs as $l) {
                if ($filterAction !== '' && ($l['action'] ?? '') !== $filterAction) continue;
                if ($filterUserId !== '' && ($l['userId'] ?? '') !== $filterUserId) continue;
                if ($successVal !== null && ($l['success'] ?? true) !== $successVal) continue;
                if ($fromTs !== false || $toTs !== false) {
                    $ts = strtotime($l['timestamp'] ?? '');
                    if ($fromTs !== false && $ts < $fromTs) continue;
                    if ($toTs !== false && $ts > $toTs) continue;
                }
                if ($kw !== '') {
                    $haystack = ($l['target'] ?? '') . ' ' . ($l['username'] ?? '') . ' ' . ($l['action'] ?? '');
                    if ((function_exists('mb_stripos') ? mb_stripos($haystack, $kw) : stripos($haystack, $kw)) === false) continue;
                }
                $filtered[] = $l;
            }
            $logs = $filtered;

            // 收集可选用户列表（非超级管理员只能选择自己）
            $usersData = loadUsers();
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                $usersData['users'] = array_values(array_filter($usersData['users'], function($u) use ($currentUserId) {
                    return $u['id'] === $currentUserId;
                }));
            }
            $userOptions = array_map(function($u) {
                return ['id' => $u['id'], 'username' => $u['username']];
            }, $usersData['users']);
            usort($userOptions, function($a, $b) { return strcmp($a['username'], $b['username']); });

            // 统计概览
            $allLogs = $auditData['logs'];
            $now = time();
            $todayStart = strtotime(date('Y-m-d'));
            $weekStart = $now - 7 * 86400;
            $todayCount = 0;
            $weekCount = 0;
            $byType = [];
            foreach ($allLogs as $l) {
                $ts = strtotime($l['timestamp'] ?? '');
                if ($ts >= $todayStart) $todayCount++;
                if ($ts >= $weekStart) $weekCount++;
                $a = $l['action'] ?? 'unknown';
                if (!isset($byType[$a])) $byType[$a] = 0;
                $byType[$a]++;
            }
            arsort($byType);
            $byTypeTop = array_slice($byType, 0, 10, true);

            $total = count($logs);
            $offset = ($page - 1) * $pageSize;
            $pageLogs = array_slice($logs, $offset, $pageSize);
            // 对详情字段做截断（避免列表过大）
            foreach ($pageLogs as &$l) {
                if (isset($l['detail']) && is_array($l['detail'])) {
                    $det = json_encode($l['detail'], JSON_UNESCAPED_UNICODE);
                    if (strlen($det) > 2000) {
                        $l['detail'] = ['_truncated' => true, '_summary' => (function_exists('mb_substr') ? mb_substr($det, 0, 500) : substr($det, 0, 500)) . '...'];
                    }
                }
            }
            unset($l);

            echo json_encode([
                'success' => true,
                'logs' => $pageLogs,
                'total' => $total,
                'page' => $page,
                'pageSize' => $pageSize,
                'actionTypes' => auditActionTypes(),
                'userOptions' => $userOptions,
                'stats' => [
                    'total' => count($allLogs),
                    'today' => $todayCount,
                    'week' => $weekCount,
                    'byType' => $byTypeTop,
                ],
                'settings' => $auditData['settings'],
            ]);
            exit;
        }

        // 获取单条审计日志详情（getAuditDetail）
        if ($action === 'getAuditDetail') {
            requirePermission('view.auditLog');
            $id = $_GET['id'] ?? '';
            if ($id === '') {
                echo json_encode(['success' => false, 'error' => '缺少 id 参数']);
                exit;
            }
            $auditData = loadAuditLog();
            $found = null;
            foreach ($auditData['logs'] as $l) {
                if (($l['id'] ?? '') === $id) { $found = $l; break; }
            }
            if (!$found) {
                echo json_encode(['success' => false, 'error' => '未找到该审计记录']);
                exit;
            }
            echo json_encode(['success' => true, 'log' => $found]);
            exit;
        }

        // 导出审计日志（exportAuditLog）
        if ($action === 'exportAuditLog') {
            requirePermission('view.auditLog');
            $format = $_GET['format'] ?? 'json';
            $filterAction = $_GET['auditAction'] ?? '';
            $filterDateFrom = $_GET['dateFrom'] ?? '';
            $filterDateTo = $_GET['dateTo'] ?? '';

            $auditData = loadAuditLog();
            $logs = $auditData['logs'];
            if ($filterAction !== '') {
                $logs = array_filter($logs, function($l) use ($filterAction) { return ($l['action'] ?? '') === $filterAction; });
            }
            if ($filterDateFrom !== '') {
                $fromTs = strtotime($filterDateFrom);
                if ($fromTs !== false) {
                    $logs = array_filter($logs, function($l) use ($fromTs) { return strtotime($l['timestamp'] ?? '') >= $fromTs; });
                }
            }
            if ($filterDateTo !== '') {
                $toTs = strtotime($filterDateTo . ' 23:59:59');
                if ($toTs !== false) {
                    $logs = array_filter($logs, function($l) use ($toTs) { return strtotime($l['timestamp'] ?? '') <= $toTs; });
                }
            }
            $logs = array_values($logs);

            $filename = 'audit_log_' . date('Ymd_His');
            if ($format === 'csv') {
                header('Content-Type: text/csv; charset=utf-8');
                header('Content-Disposition: attachment; filename="' . $filename . '.csv"');
                echo "\xEF\xBB\xBF"; // UTF-8 BOM
                $out = fopen('php://output', 'w');
                fputcsv($out, ['时间', '操作类型', '操作标签', '操作对象', '用户', '角色', 'IP', '成功', '详细(JSON)']);
                foreach ($logs as $l) {
                    fputcsv($out, [
                        $l['timestamp'] ?? '',
                        $l['action'] ?? '',
                        $l['actionLabel'] ?? '',
                        $l['target'] ?? '',
                        $l['username'] ?? '',
                        $l['role'] ?? '',
                        $l['ip'] ?? '',
                        !empty($l['success']) ? '是' : '否',
                        json_encode($l['detail'] ?? [], JSON_UNESCAPED_UNICODE),
                    ]);
                }
                fclose($out);
                exit;
            }
            // 默认 JSON
            header('Content-Type: application/json; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $filename . '.json"');
            echo json_encode(['exportedAt' => date('c'), 'total' => count($logs), 'logs' => $logs], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            exit;
        }


        // 获取使用统计
        if ($action === 'getUsageStats') {
            requirePermission('view.usageStats');
            $usersData = loadUsers();
            $activityData = loadActivity();
            $onlineData = loadOnline();
            cleanupExpiredOnline($onlineData);

            $now = time();
            $allLogs = $activityData['logs'];
            $currentUserId = getCurrentUserId();

            // 数据隔离：非超级管理员只能看到自己的数据
            if (!isSuperAdmin()) {
                $allLogs = array_values(array_filter($allLogs, function($l) use ($currentUserId) {
                    return ($l['userId'] ?? '') === $currentUserId;
                }));
                $activityData['logs'] = $allLogs;

                // 用户统计（仅当前用户）
                $userStats = [];
                foreach ($usersData['users'] as $u) {
                    if ($u['id'] === $currentUserId) {
                        $loginCount = 0;
                        $actionCount7d = 0;
                        foreach ($allLogs as $l) {
                            if (($l['userId'] ?? '') === $currentUserId && $now - strtotime($l['timestamp']) <= 7 * 86400) {
                                $actionCount7d++;
                            }
                            if (($l['action'] ?? '') === 'login' && ($l['success'] ?? false) && ($l['userId'] ?? '') === $currentUserId) {
                                $loginCount++;
                            }
                        }
                        $userStats[] = [
                            'userId' => $u['id'],
                            'username' => $u['username'],
                            'role' => $u['role'],
                            'status' => $u['status'] ?? 'active',
                            'loginCount' => isset($u['loginCount']) ? (int)$u['loginCount'] : $loginCount,
                            'lastLogin' => $u['lastLogin'] ?? null,
                            'actionCount7d' => $actionCount7d,
                        ];
                        break;
                    }
                }

                // 登录统计
                $login7d = 0;
                $login30d = 0;
                foreach ($allLogs as $l) {
                    if (($l['action'] ?? '') === 'login' && ($l['success'] ?? false)) {
                        $ts = strtotime($l['timestamp']);
                        if ($now - $ts <= 7 * 86400) $login7d++;
                        if ($now - $ts <= 30 * 86400) $login30d++;
                    }
                }

                // 日活（个人）
                $dailyActive = [];
                for ($i = 6; $i >= 0; $i--) {
                    $day = date('Y-m-d', $now - $i * 86400);
                    $dayStart = strtotime($day);
                    $dayEnd = $dayStart + 86400;
                    $dayCount = 0;
                    foreach ($allLogs as $l) {
                        $ts = strtotime($l['timestamp']);
                        if ($ts >= $dayStart && $ts < $dayEnd && ($l['userId'] ?? '') === $currentUserId) {
                            $dayCount++;
                        }
                    }
                    $dailyActive[] = ['date' => $day, 'count' => $dayCount];
                }

                // 24小时操作分布
                $hourlyDist = array_fill(0, 24, 0);
                foreach ($allLogs as $l) {
                    $ts = strtotime($l['timestamp']);
                    if ($now - $ts <= 30 * 86400) {
                        $hour = (int)date('G', $ts);
                        $hourlyDist[$hour]++;
                    }
                }

                // 操作类型分布
                $actionDist = [];
                foreach ($allLogs as $l) {
                    if (($l['success'] ?? false)) {
                        $a = $l['action'];
                        $actionDist[$a] = ($actionDist[$a] ?? 0) + 1;
                    }
                }
                arsort($actionDist);

                // 近4周对比（个人）
                $weeklyComparison = [];
                for ($wi = 3; $wi >= 0; $wi--) {
                    $weekEnd = $now - $wi * 7 * 86400;
                    $weekStart = $weekEnd - 7 * 86400;
                    $weekActions = 0;
                    $weekLogins = 0;
                    foreach ($allLogs as $l) {
                        $ts = strtotime($l['timestamp']);
                        if ($ts > $weekStart && $ts <= $weekEnd) {
                            $weekActions++;
                            if (($l['action'] ?? '') === 'login' && ($l['success'] ?? false)) $weekLogins++;
                        }
                    }
                    $weeklyComparison[] = [
                        'label' => date('m/d', $weekStart) . '-' . date('m/d', $weekEnd),
                        'actions' => $weekActions,
                        'logins' => $weekLogins,
                        'uniqueUsers' => $weekActions > 0 ? 1 : 0,
                    ];
                }

                // 近6个月对比（个人）
                $monthlyComparison = [];
                for ($mi = 5; $mi >= 0; $mi--) {
                    $monthStart = strtotime(date('Y-m-01', strtotime("-$mi months", $now)));
                    $monthEnd = strtotime(date('Y-m-01', strtotime("+1 month", $monthStart)));
                    $monthActions = 0;
                    $monthLogins = 0;
                    foreach ($allLogs as $l) {
                        $ts = strtotime($l['timestamp']);
                        if ($ts >= $monthStart && $ts < $monthEnd) {
                            $monthActions++;
                            if (($l['action'] ?? '') === 'login' && ($l['success'] ?? false)) $monthLogins++;
                        }
                    }
                    $monthlyComparison[] = [
                        'label' => date('Y/m', $monthStart),
                        'actions' => $monthActions,
                        'logins' => $monthLogins,
                        'uniqueUsers' => $monthActions > 0 ? 1 : 0,
                    ];
                }

                echo json_encode([
                    'success' => true,
                    'isSuperAdmin' => false,
                    'overview' => [
                        'totalUsers' => 1,
                        'activeUsers' => 1,
                        'disabledUsers' => 0,
                        'bannedUsers' => 0,
                        'onlineNow' => count(array_filter($onlineData['sessions'], function($s) use ($currentUserId) {
                            return $s['userId'] === $currentUserId && empty($s['kicked']);
                        })),
                        'totalLogins7d' => $login7d,
                        'totalLogins30d' => $login30d,
                        'peakConcurrent' => 1,
                        'peakConcurrentTime' => null,
                    ],
                    'dailyActive' => $dailyActive,
                    'hourlyDistribution' => $hourlyDist,
                    'actionDistribution' => $actionDist,
                    'topUsers' => $userStats,
                    'userStats' => $userStats,
                    'weeklyComparison' => $weeklyComparison,
                    'monthlyComparison' => $monthlyComparison,
                ]);
            } else {
                // 超级管理员：完整统计数据
                $allUsers = $usersData['users'];
                $totalUsers = count($allUsers);
                $activeUsers = count(array_filter($allUsers, function($u) { return ($u['status'] ?? 'active') === 'active'; }));
                $disabledUsers = count(array_filter($allUsers, function($u) { return ($u['status'] ?? 'active') === 'disabled'; }));
                $bannedUsers = count(array_filter($allUsers, function($u) { return ($u['status'] ?? 'active') === 'banned'; }));
                $onlineNow = count($onlineData['sessions']);
                $logs = $allLogs;

                // 7天/30天登录次数
                $login7d = 0; $login30d = 0;
                foreach ($logs as $l) {
                    if ($l['action'] === 'login' && $l['success']) {
                        $ts = strtotime($l['timestamp']);
                        if ($now - $ts <= 7 * 86400) $login7d++;
                        if ($now - $ts <= 30 * 86400) $login30d++;
                    }
                }

                // 近7天日活
                $dailyActive = [];
                for ($i = 6; $i >= 0; $i--) {
                    $day = date('Y-m-d', $now - $i * 86400);
                    $dayStart = strtotime($day);
                    $dayEnd = $dayStart + 86400;
                    $userIds = [];
                    foreach ($logs as $l) {
                        $ts = strtotime($l['timestamp']);
                        if ($ts >= $dayStart && $ts < $dayEnd && !empty($l['userId'])) {
                            $userIds[$l['userId']] = true;
                        }
                    }
                    $dailyActive[] = ['date' => $day, 'count' => count($userIds)];
                }

                // 24小时操作分布
                $hourlyDist = array_fill(0, 24, 0);
                foreach ($logs as $l) {
                    $ts = strtotime($l['timestamp']);
                    if ($now - $ts <= 30 * 86400) {
                        $hour = (int)date('G', $ts);
                        $hourlyDist[$hour]++;
                    }
                }

                // 操作类型分布
                $actionDist = [];
                foreach ($logs as $l) {
                    if ($l['success']) {
                        $a = $l['action'];
                        $actionDist[$a] = ($actionDist[$a] ?? 0) + 1;
                    }
                }
                arsort($actionDist);

                // 用户活跃排行
                $userActionCount = [];
                foreach ($logs as $l) {
                    if ($now - strtotime($l['timestamp']) <= 30 * 86400 && !empty($l['userId'])) {
                        if (!isset($userActionCount[$l['userId']])) {
                            $userActionCount[$l['userId']] = ['userId' => $l['userId'], 'username' => $l['username'], 'loginCount' => 0, 'actionCount' => 0];
                        }
                        $userActionCount[$l['userId']]['actionCount']++;
                        if ($l['action'] === 'login' && $l['success']) {
                            $userActionCount[$l['userId']]['loginCount']++;
                        }
                    }
                }
                usort($userActionCount, function($a, $b) { return $b['actionCount'] - $a['actionCount']; });
                $topUsers = array_slice($userActionCount, 0, 10);

                // 每个用户的统计
                $userStats = [];
                foreach ($allUsers as $u) {
                    $uid = $u['id'];
                    $uStat = [
                        'userId' => $uid,
                        'username' => $u['username'],
                        'role' => $u['role'],
                        'status' => $u['status'] ?? 'active',
                        'loginCount' => $u['loginCount'] ?? 0,
                        'lastLogin' => $u['lastLogin'] ?? null,
                        'actionCount7d' => 0,
                    ];
                    foreach ($logs as $l) {
                        if ($l['userId'] === $uid && $now - strtotime($l['timestamp']) <= 7 * 86400) {
                            $uStat['actionCount7d']++;
                        }
                    }
                    $userStats[] = $uStat;
                }

                // 近 4 周对比
                $weeklyComparison = [];
                for ($wi = 3; $wi >= 0; $wi--) {
                    $weekEnd = $now - $wi * 7 * 86400;
                    $weekStart = $weekEnd - 7 * 86400;
                    $weekActions = 0;
                    $weekLogins = 0;
                    $weekUsers = [];
                    foreach ($logs as $l) {
                        $ts = strtotime($l['timestamp']);
                        if ($ts > $weekStart && $ts <= $weekEnd) {
                            $weekActions++;
                            if (!empty($l['userId'])) $weekUsers[$l['userId']] = true;
                            if ($l['action'] === 'login' && $l['success']) $weekLogins++;
                        }
                    }
                    $weeklyComparison[] = [
                        'label' => date('m/d', $weekStart) . '-' . date('m/d', $weekEnd),
                        'actions' => $weekActions,
                        'logins' => $weekLogins,
                        'uniqueUsers' => count($weekUsers),
                    ];
                }

                // 近 6 个月对比
                $monthlyComparison = [];
                for ($mi = 5; $mi >= 0; $mi--) {
                    $monthStart = strtotime(date('Y-m-01', strtotime("-$mi months", $now)));
                    $monthEnd = strtotime(date('Y-m-01', strtotime("+1 month", $monthStart)));
                    $monthActions = 0;
                    $monthLogins = 0;
                    $monthUsers = [];
                    foreach ($logs as $l) {
                        $ts = strtotime($l['timestamp']);
                        if ($ts >= $monthStart && $ts < $monthEnd) {
                            $monthActions++;
                            if (!empty($l['userId'])) $monthUsers[$l['userId']] = true;
                            if ($l['action'] === 'login' && $l['success']) $monthLogins++;
                        }
                    }
                    $monthlyComparison[] = [
                        'label' => date('Y/m', $monthStart),
                        'actions' => $monthActions,
                        'logins' => $monthLogins,
                        'uniqueUsers' => count($monthUsers),
                    ];
                }

                echo json_encode([
                    'success' => true,
                    'isSuperAdmin' => true,
                    'overview' => [
                        'totalUsers' => $totalUsers,
                        'activeUsers' => $activeUsers,
                        'disabledUsers' => $disabledUsers,
                        'bannedUsers' => $bannedUsers,
                        'onlineNow' => $onlineNow,
                        'totalLogins7d' => $login7d,
                        'totalLogins30d' => $login30d,
                        'peakConcurrent' => $onlineData['peakConcurrent'],
                        'peakConcurrentTime' => $onlineData['peakConcurrentTime'],
                    ],
                    'dailyActive' => $dailyActive,
                    'hourlyDistribution' => $hourlyDist,
                    'actionDistribution' => $actionDist,
                    'topUsers' => $topUsers,
                    'userStats' => $userStats,
                    'weeklyComparison' => $weeklyComparison,
                    'monthlyComparison' => $monthlyComparison,
                ]);
            }
            exit;
        }

        if ($action === 'exportUsageStats') {
            requirePermission('view.usageStats');
            $format = $_GET['format'] ?? 'csv';
            $usersData = loadUsers();
            $activityData = loadActivity();
            $allUsers = $usersData['users'];
            $logs = $activityData['logs'];
            $now = time();

            // 复用统计计算
            $overview = [
                'totalUsers' => count($allUsers),
                'onlineNow' => count(loadOnline()['sessions']),
            ];
            $login7d = 0; $login30d = 0;
            foreach ($logs as $l) {
                if ($l['action'] === 'login' && $l['success']) {
                    $ts = strtotime($l['timestamp']);
                    if ($now - $ts <= 7 * 86400) $login7d++;
                    if ($now - $ts <= 30 * 86400) $login30d++;
                }
            }

            if ($format === 'json') {
                header('Content-Type: application/json; charset=utf-8');
                header('Content-Disposition: attachment; filename="usage_stats_' . date('Ymd') . '.json"');
                echo json_encode([
                    'exportedAt' => date('c'),
                    'overview' => $overview,
                    'totalLogins7d' => $login7d,
                    'totalLogins30d' => $login30d,
                    'userStats' => array_map(function($u) use ($logs, $now) {
                        $uid = $u['id'];
                        $actionCount7d = 0;
                        foreach ($logs as $l) {
                            if ($l['userId'] === $uid && $now - strtotime($l['timestamp']) <= 7 * 86400) $actionCount7d++;
                        }
                        return [
                            'username' => $u['username'],
                            'role' => $u['role'],
                            'status' => $u['status'] ?? 'active',
                            'loginCount' => $u['loginCount'] ?? 0,
                            'lastLogin' => $u['lastLogin'] ?? null,
                            'actionCount7d' => $actionCount7d,
                        ];
                    }, $allUsers),
                ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
                exit;
            }

            // CSV 导出
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="usage_stats_' . date('Ymd') . '.csv"');
            $out = fopen('php://output', 'w');
            fprintf($out, "\xEF\xBB\xBF");
            // 概览部分
            fputcsv($out, ['使用统计导出 - ' . date('Y-m-d H:i:s')]);
            fputcsv($out, []);
            fputcsv($out, ['指标', '值']);
            fputcsv($out, ['总用户数', $overview['totalUsers']]);
            fputcsv($out, ['当前在线', $overview['onlineNow']]);
            fputcsv($out, ['7天登录次数', $login7d]);
            fputcsv($out, ['30天登录次数', $login30d]);
            fputcsv($out, []);
            // 用户统计
            fputcsv($out, ['用户统计明细']);
            fputcsv($out, ['用户名', '角色', '状态', '登录次数', '最近登录', '7天操作数']);
            foreach ($allUsers as $u) {
                $uid = $u['id'];
                $actionCount7d = 0;
                foreach ($logs as $l) {
                    if ($l['userId'] === $uid && $now - strtotime($l['timestamp']) <= 7 * 86400) $actionCount7d++;
                }
                fputcsv($out, [
                    $u['username'],
                    $u['role'],
                    $u['status'] ?? 'active',
                    $u['loginCount'] ?? 0,
                    $u['lastLogin'] ?? '从未',
                    $actionCount7d,
                ]);
            }
            fclose($out);
            recordAudit('data.export', '导出使用统计 (' . $format . ')', ['format' => $format], true);
            exit;
        }

        // 获取用户详情
        if ($action === 'getUserDetail') {
            requirePermission('view.users');
            $userId = $_GET['userId'] ?? '';
            if ($userId === '') {
                echo json_encode(['success' => false, 'error' => '缺少用户ID']);
                exit;
            }

            // 数据隔离：非超级管理员只能查看自己的详情
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                if ($userId !== $currentUserId) {
                    echo json_encode(['success' => false, 'error' => '无权查看其他用户详情']);
                    exit;
                }
            }

            $usersData = loadUsers();
            $user = null;
            foreach ($usersData['users'] as $u) {
                if ($u['id'] === $userId) { $user = $u; break; }
            }
            if (!$user) {
                echo json_encode(['success' => false, 'error' => '用户不存在']);
                exit;
            }
            unset($user['passwordHash']);
            $user['permissions'] = getUserEffectivePermissions($user);

            // 最近活动
            $activityData = loadActivity();
            $recentLogs = [];
            foreach ($activityData['logs'] as $l) {
                if ($l['userId'] === $userId) {
                    $recentLogs[] = $l;
                    if (count($recentLogs) >= 20) break;
                }
            }

            // 是否在线
            $onlineData = loadOnline();
            $isOnline = false;
            foreach ($onlineData['sessions'] as $s) {
                if ($s['userId'] === $userId && empty($s['kicked'])) { $isOnline = true; break; }
            }

            echo json_encode([
                'success' => true,
                'user' => $user,
                'recentActivity' => $recentLogs,
                'isOnline' => $isOnline,
            ]);
            exit;
        }

        if ($action === 'listDriveShares') {
            requirePermission('drive.share');
            $data = loadDriveData();
            $shares = $data['shares'];
            
            // 数据隔离：非超级管理员只能看到自己创建的分享
            if (!isSuperAdmin()) {
                $currentUserId = getCurrentUserId();
                $shares = array_values(array_filter($shares, function($s) use ($currentUserId) {
                    return ($s['createdBy'] ?? '') === $currentUserId;
                }));
                $data['shares'] = $shares;
            }
            
            // Remove sensitive info
            foreach ($shares as &$s) {
                unset($s['password']);
                unset($s['filePath']);
            }
            unset($s);
            echo json_encode(['success' => true, 'shares' => $shares]);
            exit;
        }

        // 列出所有角色
        if ($action === 'listRoles') {
            requirePermission('view.roles');
            $rolesData = loadRoles();
            foreach ($rolesData['roles'] as &$role) {
                $role['permissionCount'] = isset($role['permissions']) ? count($role['permissions']) : 0;
                // 统计使用该角色的用户数
                $usersData = loadUsers();
                $userCount = 0;
                foreach ($usersData['users'] as $user) {
                    if (($user['role'] ?? '') === $role['id']) {
                        $userCount++;
                    }
                }
                $role['userCount'] = $userCount;
            }
            unset($role);
            echo json_encode(['success' => true, 'roles' => $rolesData['roles']]);
            exit;
        }

        // 获取所有权限点列表
        if ($action === 'getAllPermissions') {
            requirePermission('view.roles');
            $permissions = getAllPermissionPoints();
            // 按模块分组
            $groups = [];
            foreach ($permissions as $perm) {
                $parts = explode('.', $perm);
                $group = $parts[0] ?? 'other';
                if (!isset($groups[$group])) {
                    $groups[$group] = [];
                }
                $groups[$group][] = $perm;
            }
            echo json_encode(['success' => true, 'permissions' => $permissions, 'groups' => $groups]);
            exit;
        }

        if ($action === 'getDriveSettings') {
            requirePermission('drive.manage');
            $data = loadDriveData();
            echo json_encode(['success' => true, 'settings' => $data['settings'] ?? []]);
            exit;
        }

        // ==================== AI 后台任务管理 ====================
        if ($action === 'aiTaskList') {
            $tasks = [];
            $taskDir = SITE_ROOT . '/data/tasks';
            if (is_dir($taskDir)) {
                foreach (glob($taskDir . '/*.json') as $file) {
                    // 跳过超过 24 小时的任务文件
                    if (filemtime($file) < time() - 86400) {
                        continue;
                    }
                    $content = file_get_contents($file);
                    $task = json_decode($content, true);
                    if ($task && isset($task['taskId'])) {
                        $tasks[] = $task;
                    }
                }
            }
            // 按创建时间倒序（最新的在前）
            usort($tasks, function($a, $b) {
                return ($b['startTime'] ?? 0) - ($a['startTime'] ?? 0);
            });
            
            echo json_encode([
                'success' => true,
                'count' => count($tasks),
                'tasks' => $tasks
            ]);
            exit;
        }

        if ($action === 'aiCancelTask') {
            $taskId = isset($_GET['taskId']) ? $_GET['taskId'] : '';
            if (empty($taskId)) {
                echo json_encode(['success' => false, 'error' => '缺少任务 ID']);
                exit;
            }

            $taskFile = SITE_ROOT . '/data/tasks/' . $taskId . '.json';
            $lockFile = SITE_ROOT . '/data/tasks/' . $taskId . '.lock';

            if (!file_exists($taskFile)) {
                echo json_encode(['success' => false, 'error' => '任务不存在']);
                exit;
            }

            $content = file_get_contents($taskFile);
            $task = json_decode($content, true);
            if (!$task) {
                echo json_encode(['success' => false, 'error' => '任务数据无效']);
                exit;
            }

            if ($task['status'] === 'completed' || $task['status'] === 'failed') {
                echo json_encode(['success' => false, 'error' => '任务已结束，无需取消']);
                exit;
            }

            // 更新任务状态为已取消（保留原有 prompt/modelId 等字段，仅追加 error 信息）
            $task['status'] = 'failed';
            if (!is_array($task['data'])) {
                $task['data'] = [];
            }
            $task['data']['error'] = '任务已取消';
            $task['endTime'] = time();
            $task['updatedAt'] = time();

            $lockFp = @fopen($lockFile, 'c');
            $ownLock = false;
            if ($lockFp !== false) {
                @flock($lockFp, LOCK_EX);
                $ownLock = true;
            }

            try {
                // 原子写入（失败时保留原文件）
                cpydes_json_save_atomic($taskFile, $task, JSON_UNESCAPED_UNICODE);
            } finally {
                if ($lockFp !== false && $ownLock) {
                    @flock($lockFp, LOCK_UN);
                    @fclose($lockFp);
                }
            }

            @unlink($lockFile);

            echo json_encode(['success' => true, 'message' => '任务已取消']);
            exit;
        }

        if ($action === 'aiDeleteTask') {
            $taskId = isset($_GET['taskId']) ? $_GET['taskId'] : '';
            if (empty($taskId)) {
                echo json_encode(['success' => false, 'error' => '缺少任务 ID']);
                exit;
            }

            // 安全校验：taskId 只允许字母数字下划线连字符，防止路径穿越
            if (!preg_match('/^[A-Za-z0-9_\-]+$/', $taskId)) {
                echo json_encode(['success' => false, 'error' => '任务 ID 格式非法']);
                exit;
            }

            $taskFile = SITE_ROOT . '/data/tasks/' . $taskId . '.json';
            $lockFile = SITE_ROOT . '/data/tasks/' . $taskId . '.lock';

            if (!file_exists($taskFile)) {
                echo json_encode(['success' => false, 'error' => '任务不存在']);
                exit;
            }

            // 读取任务信息，用于返回删除结果
            $content = file_get_contents($taskFile);
            $task = json_decode($content, true);

            $deleted = @unlink($taskFile);
            // 同时清理可能残留的锁文件
            if (file_exists($lockFile)) {
                @unlink($lockFile);
            }

            if ($deleted) {
                echo json_encode([
                    'success' => true,
                    'message' => '任务已删除',
                    'taskId' => $taskId,
                    'type' => $task['type'] ?? 'image'
                ]);
            } else {
                echo json_encode(['success' => false, 'error' => '删除任务文件失败']);
            }
            exit;
        }

        echo json_encode(['success' => false, 'error' => '未知操作']);
        exit;
    }

    if ($method === 'POST') {
        requireAdminCsrf($action);
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;

        // 心跳端点（已通过 requireAdminCsrf 的豁免机制处理）
        if ($action === 'heartbeat') {
            $page = isset($input['page']) ? $input['page'] : 'dashboard';
            $result = refreshHeartbeat($page);
            echo json_encode(['success' => true, 'onlineCount' => $result['onlineCount'], 'kicked' => $result['kicked']]);
            exit;
        }

        // 强制下线
        if ($action === 'forceLogout') {
            requirePermission('users.manage');
            $targetSessionId = isset($input['sessionId']) ? $input['sessionId'] : '';
            if ($targetSessionId === '') {
                echo json_encode(['success' => false, 'error' => '缺少会话ID']);
                exit;
            }
            $onlineData = loadOnline();
            $targetUsername = '';
            foreach ($onlineData['sessions'] as &$s) {
                if ($s['sessionId'] === $targetSessionId) {
                    $s['kicked'] = true;
                    $targetUsername = $s['username'];
                    break;
                }
            }
            unset($s);
            saveOnline($onlineData);
            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'user.forceLogout', '强制下线用户: ' . $targetUsername);
            }
            echo json_encode(['success' => true]);
            exit;
        }

        // 清空页面访问统计（POST + CSRF：状态变更操作）
        if ($action === 'clearPageViews') {
            requirePermission('users.manage');
            @unlink(PAGE_VIEWS_FILE);
            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'data.clear', '清空页面访问统计');
            }
            echo json_encode(['success' => true]);
            exit;
        }

        // 清理活动日志
        if ($action === 'cleanupActivity') {
            requirePermission('activity.cleanup');
            $retentionDays = isset($input['retentionDays']) ? (int)$input['retentionDays'] : 0;
            $maxLogs = isset($input['maxLogs']) ? (int)$input['maxLogs'] : 0;
            $data = loadActivity();
            $removed = 0;
            if ($retentionDays > 0) {
                $threshold = time() - $retentionDays * 86400;
                $before = count($data['logs']);
                $data['logs'] = array_values(array_filter($data['logs'], function($l) use ($threshold) {
                    return strtotime($l['timestamp']) > $threshold;
                }));
                $removed = $before - count($data['logs']);
            }
            if ($maxLogs > 0 && count($data['logs']) > $maxLogs) {
                $removed += count($data['logs']) - $maxLogs;
                $data['logs'] = array_slice($data['logs'], 0, $maxLogs);
            }
            if ($removed > 0) {
                saveActivity($data);
            }
            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'activity.cleanup', "清理了 {$removed} 条日志");
            }
            echo json_encode(['success' => true, 'removed' => $removed]);
            exit;
        }

        // 清空审计日志（clearAuditLog）
        if ($action === 'clearAuditLog') {
            requirePermission('audit.manage');
            $before = 0;
            $auditData = loadAuditLog();
            $before = count($auditData['logs']);
            // 先记录本次清理操作（在清空之前捕获）
            recordAudit('audit.clear', "清空审计日志，共 {$before} 条", ['removed' => $before], true);
            // 清空（保留本次清理记录）
            $auditData = loadAuditLog();
            $keep = [];
            foreach ($auditData['logs'] as $l) {
                if ($l['action'] === 'audit.clear') { $keep[] = $l; break; }
            }
            $auditData['logs'] = $keep;
            saveAuditLog($auditData);
            echo json_encode(['success' => true, 'removed' => $before]);
            exit;
        }

        // 更新审计日志设置（updateAuditSettings）
        if ($action === 'updateAuditSettings') {
            requirePermission('audit.manage');
            $maxLogs = isset($input['maxLogs']) ? (int)$input['maxLogs'] : 0;
            $retentionDays = isset($input['retentionDays']) ? (int)$input['retentionDays'] : 0;
            if ($maxLogs < 100 || $maxLogs > 100000) $maxLogs = 5000;
            if ($retentionDays < 7 || $retentionDays > 3650) $retentionDays = 180;
            $auditData = loadAuditLog();
            $oldSettings = $auditData['settings'];
            $auditData['settings'] = ['maxLogs' => $maxLogs, 'retentionDays' => $retentionDays];
            saveAuditLog($auditData);
            recordAudit('config.change', '审计日志设置', [
                'before' => $oldSettings,
                'after' => $auditData['settings'],
            ], true);
            echo json_encode(['success' => true, 'settings' => $auditData['settings']]);
            exit;
        }

        // 重置用户密码
        if ($action === 'resetPassword') {
            requirePermission('users.manage');
            $userId = isset($input['id']) ? $input['id'] : '';
            $newPassword = isset($input['newPassword']) ? $input['newPassword'] : '';
            if ($userId === '' || strlen($newPassword) < 6 || strlen($newPassword) > 72) {
                echo json_encode(['success' => false, 'error' => '参数无效，密码长度需为 6-72 位']);
                exit;
            }
            $usersData = loadUsers();
            $found = false;
            foreach ($usersData['users'] as &$user) {
                if ($user['id'] === $userId) {
                    $user['passwordHash'] = password_hash($newPassword, PASSWORD_DEFAULT);
                    $user['updatedAt'] = date('c');
                    $found = true;
                    $targetUsername = $user['username'];
                    break;
                }
            }
            unset($user);
            if (!$found) {
                echo json_encode(['success' => false, 'error' => '用户不存在']);
                exit;
            }
            saveUsers($usersData);
            // 如果要求强制重新登录，踢出该用户
            if (!empty($input['forceRelogin'])) {
                $onlineData = loadOnline();
                $onlineData['sessions'] = array_values(array_filter($onlineData['sessions'], function($s) use ($userId) {
                    return $s['userId'] !== $userId;
                }));
                saveOnline($onlineData);
            }
            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'user.passwordReset', '重置用户密码: ' . $targetUsername);
            }
            echo json_encode(['success' => true]);
            exit;
        }

        // 批量更新用户状态
        if ($action === 'bulkUpdateStatus') {
            requirePermission('users.manage');
            $userIds = isset($input['userIds']) ? $input['userIds'] : [];
            $status = isset($input['status']) ? $input['status'] : '';
            if (!is_array($userIds) || empty($userIds) || !in_array($status, ['active', 'disabled', 'banned'], true)) {
                echo json_encode(['success' => false, 'error' => '参数无效']);
                exit;
            }
            $usersData = loadUsers();
            $updated = 0;
            $skipped = 0;
            foreach ($usersData['users'] as &$user) {
                if (in_array($user['id'], $userIds, true)) {
                    // 不降级最后一个admin
                    if ($user['role'] === 'admin' && $status !== 'active') {
                        $adminCount = 0;
                        foreach ($usersData['users'] as $u) { if ($u['role'] === 'admin') $adminCount++; }
                        if ($adminCount <= 1) { $skipped++; continue; }
                    }
                    $user['status'] = $status;
                    $user['updatedAt'] = date('c');
                    $updated++;
                }
            }
            unset($user);
            saveUsers($usersData);
            // 如果禁用/封禁，批量踢出
            if ($status !== 'active') {
                $onlineData = loadOnline();
                $onlineData['sessions'] = array_values(array_filter($onlineData['sessions'], function($s) use ($userIds) {
                    return !in_array($s['userId'], $userIds, true);
                }));
                saveOnline($onlineData);
            }
            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'user.statusChange', "批量更新 {$updated} 个用户状态为: {$status}");
            }
            echo json_encode(['success' => true, 'updated' => $updated, 'skipped' => $skipped]);
            exit;
        }

        if ($action === 'deleteUnreferencedImages') {
            requirePermission('images.delete');
            $data = adminLoadData();
            $referenced = collectReferencedImages($data['items']);
            $files = scanImageDir();
            $imgDirReal = realpath(IMG_DIR);

            $deleted = 0;
            $failed = [];
            $freedBytes = 0;

            foreach ($files as $filepath) {
                $relPath = str_replace('\\', '/', substr($filepath, strlen(SITE_ROOT)));
                if (isset($referenced[$relPath])) continue; // 被引用，跳过

                $realPath = realpath($filepath);
                // 安全检查：必须在 img/ 目录内（追加 DIRECTORY_SEPARATOR 防止前缀混淆）
                if (!$realPath || !$imgDirReal || ($realPath !== $imgDirReal && strpos($realPath, $imgDirReal . DIRECTORY_SEPARATOR) !== 0)) {
                    $failed[] = basename($filepath) . '(路径无效)';
                    continue;
                }

                $size = @filesize($filepath);
                if ($size === false) $size = 0;

                if (@unlink($realPath)) {
                    $deleted++;
                    $freedBytes += $size;
                } else {
                    $failed[] = basename($filepath) . '(权限不足)';
                }
            }

            echo json_encode([
                'success' => true,
                'deleted' => $deleted,
                'freedBytes' => $freedBytes,
                'freedBytesText' => formatBytes($freedBytes),
                'failed' => $failed,
                'failedCount' => count($failed),
            ]);
            exit;
        }

        if ($action === 'deleteImagesBatch') {
            requirePermission('images.delete');
            $paths = $input['paths'] ?? [];
            if (!is_array($paths)) $paths = [$paths];
            $imgDirReal = realpath(IMG_DIR);

            $deleted = 0;
            $failed = [];
            $freedBytes = 0;

            foreach ($paths as $path) {
                if (!is_string($path)) continue;
                // 安全：路径必须以 img/ 开头
                if (strpos($path, 'img/') !== 0) {
                    $failed[] = basename($path) . '(路径非法)';
                    continue;
                }
                if (strpos($path, '..') !== false) {
                    $failed[] = basename($path) . '(路径非法)';
                    continue;
                }

                $fullPath = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $path);
                $realPath = realpath($fullPath);
                if (!$realPath || !$imgDirReal || strpos($realPath, $imgDirReal) !== 0 || !is_file($realPath)) {
                    $failed[] = basename($path) . '(路径无效)';
                    continue;
                }

                $size = @filesize($realPath);
                if ($size === false) $size = 0;

                if (@unlink($realPath)) {
                    $deleted++;
                    $freedBytes += $size;
                } else {
                    $failed[] = basename($path) . '(删除失败)';
                }
            }

            recordAudit('images.bulkDelete', '批量删除图片 ' . $deleted . ' 张', [
                'deleted' => $deleted,
                'failedCount' => count($failed),
                'freedBytes' => $freedBytes,
            ], true);
            echo json_encode([
                'success' => true,
                'deleted' => $deleted,
                'freedBytes' => $freedBytes,
                'freedBytesText' => formatBytes($freedBytes),
                'failed' => $failed,
                'failedCount' => count($failed),
            ]);
            exit;
        }

        if ($action === 'updateLibraryProtection') {
            requirePermission('access.manage');
            $enabled = !empty($input['enabled']);
            if (!updateLibrarySetting('libraryPasswordEnabled', $enabled)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            echo json_encode(['success' => true, 'protectionEnabled' => $enabled]);
            exit;
        }

        if ($action === 'updateAllowGuestAccess') {
            requirePermission('access.manage');
            $allowGuest = !empty($input['allowGuest']);
            if (!updateLibrarySetting('allowGuestAccess', $allowGuest)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            echo json_encode(['success' => true, 'allowGuestAccess' => $allowGuest]);
            exit;
        }

        if ($action === 'updateGuestPermissions') {
            requirePermission('access.manage');
            $permissions = isset($input['permissions']) && is_array($input['permissions'])
                ? array_values(array_filter(array_map('strval', $input['permissions'])))
                : [];
            // 白名单校验：只允许已知的前端权限项，防止注入
            $allowedPerms = [
                'content.create', 'content.edit', 'content.delete', 'content.sort', 'content.share',
                'categories.manage',
                'images.upload', 'images.delete',
                'ai.use',
                'drive.view', 'drive.upload', 'drive.delete', 'drive.rename', 'drive.move', 'drive.folder', 'drive.share',
            ];
            $permissions = array_values(array_intersect($permissions, $allowedPerms));

            if (!updateLibrarySetting('guestPermissions', $permissions)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            echo json_encode(['success' => true, 'guestPermissions' => $permissions]);
            exit;
        }

        // 开关用户自主注册
        if ($action === 'updateRegistrationEnabled') {
            requirePermission('access.manage');
            $enabled = !empty($input['enabled']);
            if (!updateLibrarySetting('registrationEnabled', $enabled)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            recordAudit('access.change', '用户注册开关', ['enabled' => $enabled], true);
            echo json_encode(['success' => true, 'registrationEnabled' => $enabled]);
            exit;
        }

        // 设置注册用户的默认角色
        if ($action === 'updateDefaultRegisterRole') {
            requirePermission('access.manage');
            $role = isset($input['role']) ? (string)$input['role'] : '';
            if ($role === '') {
                echo json_encode(['success' => false, 'error' => '角色不能为空']);
                exit;
            }
            // 校验角色存在且非通配权限角色（防止将注册默认角色设为超管）
            $rolesData = loadRoles();
            $valid = false;
            foreach ($rolesData['roles'] as $r) {
                if ($r['id'] === $role) {
                    $permList = isset($r['permissions']) && is_array($r['permissions']) ? $r['permissions'] : [];
                    if (!in_array('*', $permList, true)) {
                        $valid = true;
                    }
                    break;
                }
            }
            if (!$valid) {
                echo json_encode(['success' => false, 'error' => '无效的角色，不能选择超级管理员角色']);
                exit;
            }

            if (!updateLibrarySetting('defaultRegisterRole', $role)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            recordAudit('access.change', '注册默认角色', ['role' => $role], true);
            echo json_encode(['success' => true, 'defaultRegisterRole' => $role]);
            exit;
        }

        if ($action === 'updateLibraryPassword') {
            // 访问码功能已停用：系统仅支持账户密码登录
            echo json_encode(['success' => false, 'error' => '访问码功能已停用，请通过账户管理设置密码']);
            exit;
        }

        if ($action === 'updateLibraryTimeout') {
            requirePermission('access.manage');
            $timeout = isset($input['timeout']) ? (int)$input['timeout'] : 7200;
            if ($timeout < 0) {
                echo json_encode(['success' => false, 'error' => '无效的有效期']);
                exit;
            }
            if (!updateLibrarySetting('libraryAuthTimeout', $timeout)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            // 超时配置变更后，重置当前会话认证时间，让新超时立即生效
            // 其他在线用户下次请求时按新超时判断，可能需要重新登录一次
            $_SESSION['settings_auth_time'] = time();
            $_SESSION['library_auth_time'] = time();

            echo json_encode(['success' => true, 'authTimeout' => $timeout]);
            exit;
        }

        if ($action === 'updateAccessCodePermissions') {
            // 访问码功能已停用：系统仅支持账户密码登录
            echo json_encode(['success' => false, 'error' => '访问码功能已停用']);
            exit;
        }

        if ($action === 'updateLayout') {
            requirePermission('appearance.manage');
            $layout = isset($input['layout']) ? $input['layout'] : 'sidebar';
            if (!in_array($layout, ['sidebar', 'top-tabs'], true)) {
                echo json_encode(['success' => false, 'error' => '无效的布局类型']);
                exit;
            }
            // 单文件批量更新：先读再写，保证 layout 和 layoutVersion 同事务
            $settings = loadLibrarySettings();
            $settings['layout'] = $layout;
            // 版本号：前台检测到变更后重置用户的本地布局偏好，使新默认布局对所有用户生效
            $settings['layoutVersion'] = time();
            if (!saveLibrarySettings($settings)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            echo json_encode(['success' => true, 'layout' => $layout]);
            exit;
        }

        if ($action === 'updatePreviewSegmentDefault') {
            requirePermission('appearance.manage');
            $enabled = !empty($input['enabled']);
            if (!updateLibrarySetting('previewSegmentDefault', $enabled)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            recordAudit('appearance.manage', '默认分段展示', ['enabled' => $enabled], true);
            echo json_encode(['success' => true, 'previewSegmentDefault' => $enabled]);
            exit;
        }

        if ($action === 'updateGreetingQuotes') {
            requirePermission('appearance.manage');
            $quotes = isset($input['quotes']) && is_array($input['quotes']) ? $input['quotes'] : [];
            // 清洗：仅接受非空字符串，去首尾空白，单条限 60 字符，最多 50 条
            $clean = [];
            foreach ($quotes as $q) {
                if (!is_string($q)) continue;
                $q = trim($q);
                if ($q === '') continue;
                if (mb_strlen($q) > 60) $q = mb_substr($q, 0, 60);
                $clean[] = $q;
                if (count($clean) >= 50) break;
            }
            if (!updateLibrarySetting('greetingQuotes', $clean)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }

            recordAudit('appearance.manage', '更新问候语录（' . count($clean) . ' 条）', ['count' => count($clean)], true);
            echo json_encode(['success' => true, 'greetingQuotes' => $clean]);
            exit;
        }

        /* ========== 弹窗公告管理 ========== */

        if ($action === 'createAnnouncement') {
            requirePermission('announcements.manage');
            $title = isset($input['title']) ? trim((string)$input['title']) : '';
            if ($title === '') {
                echo json_encode(['success' => false, 'error' => '公告标题不能为空']);
                exit;
            }
            $data = cpydes_load_announcements();
            $user = getCurrentUser();
            $now = date('c');
            $ann = cpydes_normalize_announcement($input, []);
            $ann['id'] = cpydes_generate_announcement_id();
            $ann['version'] = 1;
            $ann['createdAt'] = $now;
            $ann['updatedAt'] = $now;
            $ann['createdBy'] = $user['id'] ?? '';
            $ann['createdByName'] = $user['username'] ?? '';
            // 默认值兜底
            if (!isset($ann['enabled'])) $ann['enabled'] = true;
            if (!isset($ann['dismissible'])) $ann['dismissible'] = true;
            if (!isset($ann['closeBehavior'])) $ann['closeBehavior'] = 'permanent';
            if (!isset($ann['audience'])) $ann['audience'] = 'all';
            if (!isset($ann['type'])) $ann['type'] = 'info';
            if (!isset($ann['startAt'])) $ann['startAt'] = null;
            if (!isset($ann['endAt'])) $ann['endAt'] = null;

            $data['announcements'][] = $ann;
            if (!cpydes_save_announcements($data['announcements'])) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }
            recordAudit('announcement.create', '创建公告：' . $ann['title'], ['id' => $ann['id']], true);
            echo json_encode(['success' => true, 'announcement' => $ann]);
            exit;
        }

        if ($action === 'updateAnnouncement') {
            requirePermission('announcements.manage');
            $id = isset($input['id']) ? (string)$input['id'] : '';
            if ($id === '') {
                echo json_encode(['success' => false, 'error' => '缺少公告 ID']);
                exit;
            }
            $data = cpydes_load_announcements();
            $idx = null;
            $existing = null;
            foreach ($data['announcements'] as $i => $a) {
                if (($a['id'] ?? '') === $id) { $idx = $i; $existing = $a; break; }
            }
            if ($existing === null) {
                echo json_encode(['success' => false, 'error' => '公告不存在']);
                exit;
            }
            $ann = cpydes_normalize_announcement($input, $existing);
            // 内容关键字段变更时自增 version，使前台"已读"标记失效
            $contentChanged = (
                (isset($input['title']) && $input['title'] !== ($existing['title'] ?? ''))
                || (isset($input['content']) && $input['content'] !== ($existing['content'] ?? ''))
                || (isset($input['type']) && $input['type'] !== ($existing['type'] ?? ''))
            );
            $ann['version'] = (int)($existing['version'] ?? 1) + ($contentChanged ? 1 : 0);
            $ann['updatedAt'] = date('c');
            // 保留不可变字段
            $ann['id'] = $existing['id'];
            $ann['createdAt'] = $existing['createdAt'] ?? date('c');
            $ann['createdBy'] = $existing['createdBy'] ?? '';
            $ann['createdByName'] = $existing['createdByName'] ?? '';

            $data['announcements'][$idx] = $ann;
            if (!cpydes_save_announcements($data['announcements'])) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }
            recordAudit('announcement.update', '更新公告：' . $ann['title'], ['id' => $ann['id'], 'version' => $ann['version']], true);
            echo json_encode(['success' => true, 'announcement' => $ann]);
            exit;
        }

        if ($action === 'deleteAnnouncement') {
            requirePermission('announcements.manage');
            $id = isset($input['id']) ? (string)$input['id'] : '';
            if ($id === '') {
                echo json_encode(['success' => false, 'error' => '缺少公告 ID']);
                exit;
            }
            $data = cpydes_load_announcements();
            $removed = null;
            $data['announcements'] = array_values(array_filter($data['announcements'], function($a) use ($id, &$removed) {
                if (($a['id'] ?? '') === $id) { $removed = $a; return false; }
                return true;
            }));
            if ($removed === null) {
                echo json_encode(['success' => false, 'error' => '公告不存在']);
                exit;
            }
            if (!cpydes_save_announcements($data['announcements'])) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }
            recordAudit('announcement.delete', '删除公告：' . ($removed['title'] ?? ''), ['id' => $id], true);
            echo json_encode(['success' => true, 'id' => $id]);
            exit;
        }

        if ($action === 'toggleAnnouncement') {
            requirePermission('announcements.manage');
            $id = isset($input['id']) ? (string)$input['id'] : '';
            $enabled = !empty($input['enabled']);
            if ($id === '') {
                echo json_encode(['success' => false, 'error' => '缺少公告 ID']);
                exit;
            }
            $data = cpydes_load_announcements();
            $target = null;
            foreach ($data['announcements'] as &$a) {
                if (($a['id'] ?? '') === $id) {
                    $a['enabled'] = $enabled;
                    $a['updatedAt'] = date('c');
                    $target = $a;
                    break;
                }
            }
            unset($a);
            if ($target === null) {
                echo json_encode(['success' => false, 'error' => '公告不存在']);
                exit;
            }
            if (!cpydes_save_announcements($data['announcements'])) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }
            recordAudit('announcement.update', ($enabled ? '启用' : '禁用') . '公告：' . ($target['title'] ?? ''), ['id' => $id, 'enabled' => $enabled], true);
            echo json_encode(['success' => true, 'id' => $id, 'enabled' => $enabled]);
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
            if (!saveUsers($usersData)) {
                echo json_encode(['success' => false, 'error' => '用户名保存失败']);
                exit;
            }

            recordActivity($currentUser['id'], $currentUser['username'], 'user.update', '修改用户名为: ' . $newUsername);
            recordAudit('users.edit', '用户: ' . $currentUser['username'] . ' → ' . $newUsername, ['userId' => $currentUser['id'], 'oldUsername' => $currentUser['username'], 'newUsername' => $newUsername], true);

            echo json_encode(['success' => true, 'username' => $newUsername]);
            exit;
        }

        if ($action === 'updateAdminPassword') {
            $envPwd = getenv('SETTINGS_PASSWORD');
            if ($envPwd !== false && $envPwd !== '') {
                echo json_encode(['success' => false, 'error' => '管理员密码已通过环境变量 SETTINGS_PASSWORD 设置，无法在后台修改']);
                exit;
            }

            $oldPwd = isset($input['oldPassword']) ? $input['oldPassword'] : '';
            $newPwd = isset($input['newPassword']) ? $input['newPassword'] : '';
            $confirmPwd = isset($input['confirmPassword']) ? $input['confirmPassword'] : '';

            // 登录验证基于 users.json，修改密码也必须校验当前登录用户的密码哈希
            $currentUser = getCurrentUser();
            if (!$currentUser || !isset($currentUser['passwordHash']) || $currentUser['passwordHash'] === '') {
                echo json_encode(['success' => false, 'error' => '当前登录用户信息异常，无法修改密码']);
                exit;
            }

            if (!password_verify($oldPwd, $currentUser['passwordHash'])) {
                echo json_encode(['success' => false, 'error' => '旧密码不正确']);
                exit;
            }

            if ($newPwd !== $confirmPwd) {
                echo json_encode(['success' => false, 'error' => '两次输入的新密码不一致']);
                exit;
            }

            if (strlen($newPwd) < 6 || strlen($newPwd) > 72) {
                echo json_encode(['success' => false, 'error' => '新密码长度需为 6-72 位']);
                exit;
            }

            $newHash = password_hash($newPwd, PASSWORD_DEFAULT);
            if ($newHash === false) {
                echo json_encode(['success' => false, 'error' => '密码加密失败']);
                exit;
            }

            // 更新 users.json 中当前用户的密码哈希
            $usersData = loadUsers();
            $updated = false;
            foreach ($usersData['users'] as &$user) {
                if ($user['id'] === $currentUser['id']) {
                    $user['passwordHash'] = $newHash;
                    $user['updatedAt'] = date('c');
                    $updated = true;
                    break;
                }
            }
            unset($user);
            if (!$updated) {
                echo json_encode(['success' => false, 'error' => '用户数据保存失败']);
                exit;
            }
            if (!saveUsers($usersData)) {
                echo json_encode(['success' => false, 'error' => '密码保存失败']);
                exit;
            }

            recordActivity($currentUser['id'], $currentUser['username'], 'user.passwordChange', '修改自身密码');
            recordAudit('users.passwordChange', '用户: ' . $currentUser['username'], ['userId' => $currentUser['id']], true);

            echo json_encode(['success' => true]);
            exit;
        }

        if ($action === 'updateDedupConfig') {
            requirePermission('dedup.config');
            $rawCfg = isset($input['config']) ? $input['config'] : [];
            $cfg = normalizeDedupConfig($rawCfg);
            if (!updateLibrarySetting('dedup', $cfg)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }
            recordAudit('dedup.config', '查重配置', ['config' => $cfg], true);
            echo json_encode(['success' => true, 'config' => $cfg]);
            exit;
        }

        if ($action === 'updateCopyReminderConfig') {
            // 复制文案时效提醒配置：复用基础设置管理权限
            requirePermission('settings.manage');
            $rawCfg = isset($input['config']) ? $input['config'] : [];
            $cfg = normalizeCopyReminderConfig($rawCfg);
            if (!updateLibrarySetting('copyReminder', $cfg)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }
            recordAudit('copyReminder.config', '复制时效提醒配置', ['config' => $cfg], true);
            echo json_encode(['success' => true, 'config' => $cfg]);
            exit;
        }

        if ($action === 'updateSyncSettings') {
            // 实时同步配置：复用基础设置管理权限
            requirePermission('settings.manage');
            $enabled = !empty($input['enabled']);
            $interval = isset($input['interval']) ? (int)$input['interval'] : 5;
            // 间隔范围 2~300 秒
            if ($interval < 2) $interval = 2;
            if ($interval > 300) $interval = 300;
            $cfg = ['enabled' => $enabled, 'interval' => $interval];
            if (!updateLibrarySetting('sync', $cfg)) {
                echo json_encode(['success' => false, 'error' => '保存失败']);
                exit;
            }
            recordAudit('sync.config', '实时同步配置', ['config' => $cfg], true);
            echo json_encode(['success' => true, 'config' => $cfg]);
            exit;
        }

        if ($action === 'saveItem') {
            $data = adminLoadData();
            $item = isset($input['item']) ? $input['item'] : [];

            // 根据操作类型检查权限
            if (isset($item['_delete']) && $item['_delete']) {
                requirePermission('content.delete');
            } elseif (isset($item['id']) && !empty($item['id'])) {
                requirePermission('content.edit');
            } else {
                requirePermission('content.create');
            }

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
            if (isset($item['id']) && is_string($item['id']) && !preg_match('/^itm_[a-z0-9_]+$/', $item['id'])) {
                echo json_encode(['success' => false, 'error' => '无效的条目 ID']);
                exit;
            }
            // 清洗 tags 字段（最多 20 个，每个最长 50 字）
            $cleanTags = [];
            if (isset($item['tags']) && is_array($item['tags'])) {
                foreach (array_slice($item['tags'], 0, 20) as $t) {
                    if (is_string($t) && trim($t) !== '') {
                        $cleanTags[] = substr(trim($t), 0, 50);
                    }
                }
            }
            $item['tags'] = array_values(array_unique($cleanTags));

            if (isset($item['_delete']) && $item['_delete']) {
                $id = isset($item['id']) ? $item['id'] : '';
                $data['items'] = array_values(array_filter($data['items'], function($i) use ($id) {
                    return $i['id'] !== $id;
                }));
                adminSaveData($data);
                $currentUser = getCurrentUser();
                if ($currentUser) recordActivity($currentUser['id'], $currentUser['username'], 'content.delete', '删除文案: ' . ($item['title'] ?? $id));
                recordAudit('content.delete', '文案: ' . ($item['title'] ?? $id), ['itemId' => $id], true);
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

            adminSaveData($data);
            $currentUser = getCurrentUser();
            if ($currentUser) {
                $actType = $found ? 'content.edit' : 'content.create';
                recordActivity($currentUser['id'], $currentUser['username'], $actType, ($found ? '编辑' : '创建') . '文案: ' . ($item['title'] ?? $item['id']));
            }
            recordAudit($found ? 'content.edit' : 'content.create', '文案: ' . ($item['title'] ?? $item['id']), [
                'itemId' => $item['id'],
                'isEdit' => $found,
            ], true);
            echo json_encode(['success' => true, 'item' => $item]);
            exit;
        }

        if ($action === 'deleteItem') {
            requirePermission('content.delete');
            $data = adminLoadData();
            $id = isset($input['id']) ? $input['id'] : '';
            $targetTitle = '';
            foreach ($data['items'] as $i) { if ($i['id'] === $id) { $targetTitle = $i['title'] ?? $id; break; } }
            $data['items'] = array_values(array_filter($data['items'], function($i) use ($id) {
                return $i['id'] !== $id;
            }));
            adminSaveData($data);
            recordAudit('content.delete', '文案: ' . $targetTitle, ['itemId' => $id], true);
            echo json_encode(['success' => true]);
            exit;
        }

        if ($action === 'batchDeleteItems') {
            requirePermission('content.delete');
            $data = adminLoadData();
            $ids = isset($input['ids']) && is_array($input['ids']) ? $input['ids'] : [];
            if (empty($ids)) {
                echo json_encode(['success' => false, 'error' => '未选择任何条目']);
                exit;
            }
            $idSet = [];
            foreach ($ids as $bid) {
                if (is_string($bid)) $idSet[$bid] = true;
            }
            $beforeCount = count($data['items']);
            $deletedTitles = [];
            foreach ($data['items'] as $it) {
                if (isset($idSet[$it['id']])) {
                    $deletedTitles[] = $it['title'] ?? $it['id'];
                }
            }
            $data['items'] = array_values(array_filter($data['items'], function($i) use ($idSet) {
                return !isset($idSet[$i['id']]);
            }));
            $deletedCount = $beforeCount - count($data['items']);
            adminSaveData($data);
            recordAudit('content.bulkDelete', '批量删除 ' . $deletedCount . ' 条文案', [
                'count' => $deletedCount,
                'titles' => array_slice($deletedTitles, 0, 10),
            ], true);
            echo json_encode(['success' => true, 'deleted' => $deletedCount]);
            exit;
        }

        if ($action === 'batchTagItems') {
            requirePermission('content.edit');
            $data = adminLoadData();
            $ids = isset($input['ids']) && is_array($input['ids']) ? $input['ids'] : [];
            $addTags = isset($input['addTags']) && is_array($input['addTags']) ? $input['addTags'] : [];
            $removeTags = isset($input['removeTags']) && is_array($input['removeTags']) ? $input['removeTags'] : [];
            $mode = isset($input['mode']) ? $input['mode'] : 'add'; // add | remove | replace
            if (empty($ids)) {
                echo json_encode(['success' => false, 'error' => '未选择任何条目']);
                exit;
            }
            // 清洗标签
            $cleanAdd = [];
            foreach (array_slice($addTags, 0, 20) as $t) {
                if (is_string($t) && trim($t) !== '') $cleanAdd[] = substr(trim($t), 0, 50);
            }
            $cleanRemove = [];
            foreach (array_slice($removeTags, 0, 20) as $t) {
                if (is_string($t) && trim($t) !== '') $cleanRemove[] = trim($t);
            }
            $idSet = [];
            foreach ($ids as $bid) { if (is_string($bid)) $idSet[$bid] = true; }
            $updatedCount = 0;
            foreach ($data['items'] as &$it) {
                if (!isset($idSet[$it['id']])) continue;
                $currentTags = isset($it['tags']) && is_array($it['tags']) ? $it['tags'] : [];
                if ($mode === 'replace') {
                    $newTags = $cleanAdd;
                } else {
                    $newTags = $currentTags;
                    if ($mode === 'add') {
                        foreach ($cleanAdd as $t) {
                            if (!in_array($t, $newTags, true)) $newTags[] = $t;
                        }
                    } elseif ($mode === 'remove') {
                        $newTags = array_values(array_filter($newTags, function($t) use ($cleanRemove) {
                            return !in_array($t, $cleanRemove, true);
                        }));
                    }
                }
                // 限制最多 20 个
                $newTags = array_slice($newTags, 0, 20);
                $it['tags'] = $newTags;
                $it['updatedAt'] = date('Y-m-d\TH:i:s\Z');
                $updatedCount++;
            }
            unset($it);
            adminSaveData($data);
            recordAudit('content.batchTag', '批量' . ($mode === 'replace' ? '替换' : ($mode === 'remove' ? '移除' : '添加')) . '标签到 ' . $updatedCount . ' 条文案', [
                'count' => $updatedCount,
                'mode' => $mode,
                'tags' => $mode === 'remove' ? $cleanRemove : $cleanAdd,
            ], true);
            echo json_encode(['success' => true, 'updated' => $updatedCount]);
            exit;
        }

        if ($action === 'saveCategories') {
            requirePermission('categories.manage');
            $data = adminLoadData();
            $oldCount = count($data['categories']);
            $newCategories = isset($input['categories']) ? $input['categories'] : [];
            if (is_array($newCategories)) {
                $data['categories'] = sanitizeCategories($newCategories);
            }
            adminSaveData($data);
            recordAudit('categories.manage', '分类管理', [
                'beforeCount' => $oldCount,
                'afterCount' => count($data['categories']),
            ], true);
            echo json_encode(['success' => true, 'categories' => $data['categories']]);
            exit;
        }

        if ($action === 'saveItemsOrder') {
            requirePermission('content.sort');
            $data = adminLoadData();
            $newItems = isset($input['items']) ? $input['items'] : $data['items'];
            if (is_array($newItems)) {
                $data['items'] = $newItems;
            }
            adminSaveData($data);
            recordAudit('content.sort', '排序文案', ['count' => count($data['items'])], true);
            echo json_encode(['success' => true]);
            exit;
        }

        if ($action === 'deleteImages') {
            requirePermission('images.delete');
            $paths = isset($input['paths']) ? $input['paths'] : [];
            if (!is_array($paths)) $paths = [$paths];
            $imgDirReal = realpath(IMG_DIR);
            $deleted = 0;
            $failed = [];
            $freedBytes = 0;

            foreach ($paths as $path) {
                if (!is_string($path)) continue;
                if (strpos($path, 'img/') !== 0) {
                    $failed[] = basename($path) . '(路径非法)';
                    continue;
                }
                if (strpos($path, '..') !== false) {
                    $failed[] = basename($path) . '(路径非法)';
                    continue;
                }
                $fullPath = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $path);
                $realPath = realpath($fullPath);
                if (!$realPath || !$imgDirReal || strpos($realPath, $imgDirReal) !== 0 || !is_file($realPath)) {
                    $failed[] = basename($path) . '(路径无效)';
                    continue;
                }
                $size = @filesize($realPath);
                if ($size === false) $size = 0;
                if (@unlink($realPath)) {
                    $deleted++;
                    $freedBytes += $size;
                } else {
                    $failed[] = basename($path) . '(删除失败)';
                }
            }

            recordAudit('images.delete', '删除图片 ' . $deleted . ' 张', [
                'deleted' => $deleted,
                'failedCount' => count($failed),
                'freedBytes' => $freedBytes,
            ], true);
            echo json_encode([
                'success' => true,
                'deleted' => $deleted,
                'freedBytes' => $freedBytes,
                'freedBytesText' => formatBytes($freedBytes),
                'failed' => $failed,
                'failedCount' => count($failed)
            ]);
            exit;
        }

        // 创建服务器端备份
        if ($action === 'createBackup') {
            requirePermission('backup.create');
            $includeImages = isset($input['includeImages']) ? (bool)$input['includeImages'] : true;
            $note = isset($input['note']) ? trim($input['note']) : '';
            if (mb_strlen($note) > 100) $note = mb_substr($note, 0, 100);
            $result = createServerBackup($includeImages, $note);
            if ($result['success']) {
                recordAudit('backup.create', '备份: ' . $result['backupId'], [
                    'backupId' => $result['backupId'],
                    'itemCount' => $result['itemCount'],
                    'imageCount' => $result['imageCount'],
                    'includeImages' => $includeImages,
                    'sizeText' => $result['sizeText'],
                ], true);
            }
            echo json_encode($result);
            exit;
        }

        // 从服务器端备份恢复
        if ($action === 'restoreBackup') {
            requirePermission('backup.restore');
            $backupId = isset($input['id']) ? trim($input['id']) : '';
            $restoreImages = isset($input['restoreImages']) ? (bool)$input['restoreImages'] : true;
            $restoreUsers = isset($input['restoreUsers']) ? (bool)$input['restoreUsers'] : false;
            $restoreShares = isset($input['restoreShares']) ? (bool)$input['restoreShares'] : false;
            $result = restoreServerBackup($backupId, $restoreImages, $restoreUsers, $restoreShares);
            if ($result['success']) {
                recordAudit('backup.restore', '恢复备份: ' . $backupId, [
                    'backupId' => $backupId,
                    'itemCount' => $result['itemCount'],
                    'restoredImages' => $result['restoredImages'],
                    'restoreUsers' => $restoreUsers,
                    'restoreShares' => $restoreShares,
                ], true);
            }
            echo json_encode($result);
            exit;
        }

        // 删除服务器端备份
        if ($action === 'deleteBackup') {
            requirePermission('backup.delete');
            $backupId = isset($input['id']) ? trim($input['id']) : '';
            $result = deleteServerBackup($backupId);
            if ($result['success']) {
                recordAudit('backup.delete', '删除备份: ' . $backupId, ['backupId' => $backupId], true);
            }
            echo json_encode($result);
            exit;
        }

        if ($action === 'clearAll') {
            requirePermission('backup.clear');
            $beforeData = adminLoadData();
            $beforeItems = count($beforeData['items']);
            $beforeCats = count($beforeData['categories']);
            $data = ['categories' => [], 'items' => []];
            adminSaveData($data);

            $deletedImages = 0;
            $errors = [];
            if (is_dir(IMG_DIR)) {
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
            recordAudit('backup.clear', '清空所有数据', [
                'beforeItems' => $beforeItems,
                'beforeCategories' => $beforeCats,
                'deletedImages' => $deletedImages,
            ], true);
            echo json_encode([
                'success' => true,
                'deletedImages' => $deletedImages,
                'errors' => $errors ? count($errors) . '个文件删除失败: ' . implode(', ', $errors) : null
            ]);
            exit;
        }

        if ($action === 'uploadImage') {
            requirePermission('images.upload');
            $maxSize = 10 * 1024 * 1024;
            $allowedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

            if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
                $file = $_FILES['image'];

                if ($file['size'] > $maxSize) {
                    echo json_encode(['success' => false, 'error' => '文件过大，最大允许 10MB']);
                    exit;
                }

                $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
                if (!in_array($ext, $allowedExts, true)) {
                    echo json_encode(['success' => false, 'error' => '不支持的文件格式，仅允许: ' . implode(', ', $allowedExts)]);
                    exit;
                }

                if (!verifyImageMime($file['tmp_name'], $ext)) {
                    echo json_encode(['success' => false, 'error' => '文件类型与扩展名不匹配']);
                    exit;
                }

                $filename = generateSecureFilename($ext);
                $filepath = IMG_DIR . '/' . $filename;

                if (move_uploaded_file($file['tmp_name'], $filepath)) {
                    if ($ext === 'svg') {
                        $svgContent = file_get_contents($filepath);
                        $cleaned = stripSvgScripts($svgContent);
                        if ($cleaned !== $svgContent) {
                            file_put_contents($filepath, $cleaned);
                        }
                    }
                    echo json_encode(['success' => true, 'url' => 'img/' . $filename]);
                } else {
                    echo json_encode(['success' => false, 'error' => '文件保存失败']);
                }
                exit;
            } elseif (isset($input['base64'])) {
                $base64 = $input['base64'];
                if (preg_match('/^data:image\/(\w+);base64,(.+)$/s', $base64, $matches)) {
                    $ext = strtolower($matches[1]);
                    if ($ext === 'jpeg') $ext = 'jpg';

                    if (!in_array($ext, $allowedExts, true)) {
                        echo json_encode(['success' => false, 'error' => '不支持的图片格式']);
                        exit;
                    }

                    $imgData = base64_decode($matches[2]);

                    if (strlen($imgData) > $maxSize) {
                        echo json_encode(['success' => false, 'error' => '图片数据过大，最大允许 10MB']);
                        exit;
                    }

                    $filename = generateSecureFilename($ext);
                    $filepath = IMG_DIR . '/' . $filename;

                    if (file_put_contents($filepath, $imgData)) {
                        if (!verifyImageMime($filepath, $ext)) {
                            @unlink($filepath);
                            echo json_encode(['success' => false, 'error' => '文件类型与扩展名不匹配']);
                            exit;
                        }
                        if ($ext === 'svg') {
                            $cleaned = stripSvgScripts($imgData);
                            if ($cleaned !== $imgData) {
                                file_put_contents($filepath, $cleaned);
                            }
                        }
                        echo json_encode(['success' => true, 'url' => 'img/' . $filename]);
                    } else {
                        echo json_encode(['success' => false, 'error' => '文件保存失败']);
                    }
                    exit;
                }
            }

            echo json_encode(['success' => false, 'error' => '未接收到文件']);
            exit;
        }

        // 创建用户（需要用户管理权限）
        if ($action === 'createUser') {
            requirePermission('users.manage');
            $username = isset($input['username']) ? trim($input['username']) : '';
            $password = isset($input['password']) ? $input['password'] : '';
            $role = isset($input['role']) ? $input['role'] : 'role_editor';

            if ($username === '') {
                echo json_encode(['success' => false, 'error' => '用户名不能为空']);
                exit;
            }

            if (strlen($username) > 50) {
                echo json_encode(['success' => false, 'error' => '用户名长度不能超过50个字符']);
                exit;
            }

            if (strlen($password) < 6 || strlen($password) > 72) {
                echo json_encode(['success' => false, 'error' => '密码长度需为 6-72 位']);
                exit;
            }

            // 验证角色是否存在（支持新角色ID和旧角色名兼容）
            $validRole = false;
            $rolesData = loadRoles();
            foreach ($rolesData['roles'] as $r) {
                if ($r['id'] === $role) {
                    $validRole = true;
                    break;
                }
            }
            // 向后兼容旧角色名
            $compatMap = ['admin' => 'role_admin', 'editor' => 'role_editor', 'viewer' => 'role_viewer'];
            if (!$validRole && isset($compatMap[$role])) {
                $role = $compatMap[$role];
                $validRole = true;
            }
            if (!$validRole) {
                echo json_encode(['success' => false, 'error' => '无效的角色类型']);
                exit;
            }

            $notes = isset($input['notes']) ? trim($input['notes']) : '';
            if ($notes !== '' && strlen($notes) > 500) {
                echo json_encode(['success' => false, 'error' => '备注长度不能超过500个字符']);
                exit;
            }

            $usersData = loadUsers();

            // 检查用户名是否已存在
            foreach ($usersData['users'] as $user) {
                if ($user['username'] === $username) {
                    echo json_encode(['success' => false, 'error' => '用户名已存在']);
                    exit;
                }
            }

            $newUser = [
                'id' => 'usr_' . bin2hex(random_bytes(8)),
                'username' => $username,
                'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
                'role' => $role,
                'permissions' => null,
                'createdAt' => date('c'),
                'updatedAt' => date('c'),
                'lastLogin' => null,
                'notes' => isset($input['notes']) ? trim($input['notes']) : null,
                'status' => 'active',
                'loginCount' => 0,
            ];

            $usersData['users'][] = $newUser;
            saveUsers($usersData);

            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'user.create', '创建用户: ' . $username);
            }
            recordAudit('users.create', '用户: ' . $username, [
                'userId' => $newUser['id'],
                'role' => $role,
            ], true);

            unset($newUser['passwordHash']);
            $newUser['permissions'] = getUserEffectivePermissions($newUser);
            echo json_encode([
                'success' => true,
                'user' => $newUser
            ]);
            exit;
        }

        // 更新用户（需要用户管理权限）
        if ($action === 'updateUser') {
            requirePermission('users.manage');
            $userId = isset($input['id']) ? $input['id'] : '';
            $username = isset($input['username']) ? trim($input['username']) : null;
            $password = isset($input['password']) ? $input['password'] : null;
            $role = isset($input['role']) ? $input['role'] : null;

            if ($userId === '') {
                echo json_encode(['success' => false, 'error' => '用户ID不能为空']);
                exit;
            }

            // 验证角色是否存在（支持新角色ID和旧角色名兼容）
            if ($role !== null) {
                $validRole = false;
                $rolesData = loadRoles();
                foreach ($rolesData['roles'] as $r) {
                    if ($r['id'] === $role) {
                        $validRole = true;
                        break;
                    }
                }
                // 向后兼容旧角色名
                $compatMap = ['admin' => 'role_admin', 'editor' => 'role_editor', 'viewer' => 'role_viewer'];
                if (!$validRole && isset($compatMap[$role])) {
                    $role = $compatMap[$role];
                    $validRole = true;
                }
                if (!$validRole) {
                    echo json_encode(['success' => false, 'error' => '无效的角色类型']);
                    exit;
                }
            }

            if ($username !== null && strlen($username) > 50) {
                echo json_encode(['success' => false, 'error' => '用户名长度不能超过50个字符']);
                exit;
            }

            if ($password !== null && (strlen($password) < 6 || strlen($password) > 72)) {
                echo json_encode(['success' => false, 'error' => '密码长度需为 6-72 位']);
                exit;
            }

            $usersData = loadUsers();
            $foundIndex = -1;

            foreach ($usersData['users'] as $index => $user) {
                if ($user['id'] === $userId) {
                    $foundIndex = $index;
                    break;
                }
            }

            if ($foundIndex === -1) {
                echo json_encode(['success' => false, 'error' => '用户不存在']);
                exit;
            }

            // 记录变更前的角色和权限用于审计
            $auditOldRole = $usersData['users'][$foundIndex]['role'] ?? '';
            $auditOldPerms = isset($usersData['users'][$foundIndex]['permissions']) ? json_encode($usersData['users'][$foundIndex]['permissions']) : 'null';

            // 检查用户名是否与其他用户冲突
            if ($username !== null) {
                foreach ($usersData['users'] as $index => $user) {
                    if ($index !== $foundIndex && $user['username'] === $username) {
                        echo json_encode(['success' => false, 'error' => '用户名已存在']);
                        exit;
                    }
                }
                $usersData['users'][$foundIndex]['username'] = $username;
            }

            if ($password !== null) {
                $usersData['users'][$foundIndex]['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
            }

            if ($role !== null) {
                // 不能将最后一个管理员降级
                $isAdminRole = function($r) {
                    return $r === 'admin' || $r === 'role_admin';
                };
                if (!$isAdminRole($role) && $isAdminRole($usersData['users'][$foundIndex]['role'])) {
                    $adminCount = 0;
                    foreach ($usersData['users'] as $user) {
                        if ($isAdminRole($user['role'])) $adminCount++;
                    }
                    if ($adminCount <= 1) {
                        echo json_encode(['success' => false, 'error' => '不能降级最后一个管理员']);
                        exit;
                    }
                }
                $usersData['users'][$foundIndex]['role'] = $role;
            }

            // 处理权限字段
            if (isset($input['permissions'])) {
                $permissions = $input['permissions'];
                if ($permissions === null) {
                    $usersData['users'][$foundIndex]['permissions'] = null;
                } elseif (is_array($permissions)) {
                    // 验证权限点是否合法
                    $validPermissions = getAllPermissionPoints();
                    $cleanPermissions = [];
                    foreach ($permissions as $perm) {
                        if (is_string($perm) && in_array($perm, $validPermissions, true)) {
                            $cleanPermissions[] = $perm;
                        }
                    }
                    $usersData['users'][$foundIndex]['permissions'] = $cleanPermissions;
                }
            }

            if (isset($input['notes'])) {
                $notes = trim($input['notes']);
                if ($notes !== '' && strlen($notes) > 500) {
                    echo json_encode(['success' => false, 'error' => '备注长度不能超过500个字符']);
                    exit;
                }
                $usersData['users'][$foundIndex]['notes'] = $notes ?: null;
            }
            if (isset($input['status'])) {
                $newStatus = $input['status'];
                if (!in_array($newStatus, ['active', 'disabled', 'banned'], true)) {
                    echo json_encode(['success' => false, 'error' => '无效的状态值']);
                    exit;
                }
                $oldStatus = $usersData['users'][$foundIndex]['status'] ?? 'active';
                $usersData['users'][$foundIndex]['status'] = $newStatus;
                // If status changed to disabled/banned, kick out the user
                if ($newStatus !== 'active' && $newStatus !== $oldStatus) {
                    $kickUserId = $usersData['users'][$foundIndex]['id'];
                    $onlineData = loadOnline();
                    $onlineData['sessions'] = array_values(array_filter($onlineData['sessions'], function($s) use ($kickUserId) {
                        return $s['userId'] !== $kickUserId;
                    }));
                    saveOnline($onlineData);
                }
            }

            $usersData['users'][$foundIndex]['updatedAt'] = date('c');
            saveUsers($usersData);

            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'user.update', '更新用户: ' . $usersData['users'][$foundIndex]['username']);
            }
            // 审计：角色或权限变更单独标记
            $auditNewRole = $usersData['users'][$foundIndex]['role'] ?? '';
            $auditNewPerms = isset($usersData['users'][$foundIndex]['permissions']) ? json_encode($usersData['users'][$foundIndex]['permissions']) : 'null';
            if ($auditOldRole !== $auditNewRole) {
                recordAudit('users.roleChange', '用户: ' . $usersData['users'][$foundIndex]['username'], [
                    'userId' => $userId,
                    'before' => $auditOldRole,
                    'after' => $auditNewRole,
                ], true);
            }
            if ($auditOldPerms !== $auditNewPerms) {
                recordAudit('users.permChange', '用户: ' . $usersData['users'][$foundIndex]['username'], [
                    'userId' => $userId,
                ], true);
            }
            recordAudit('users.edit', '用户: ' . $usersData['users'][$foundIndex]['username'], ['userId' => $userId], true);

            $updatedUser = $usersData['users'][$foundIndex];
            unset($updatedUser['passwordHash']);
            $updatedUser['permissions'] = getUserEffectivePermissions($updatedUser);
            echo json_encode([
                'success' => true,
                'user' => $updatedUser
            ]);
            exit;
        }

        // 删除用户（需要用户管理权限）
        if ($action === 'deleteUser') {
            requirePermission('users.manage');
            $userId = isset($input['id']) ? $input['id'] : '';

            if ($userId === '') {
                echo json_encode(['success' => false, 'error' => '用户ID不能为空']);
                exit;
            }

            $usersData = loadUsers();
            $foundIndex = -1;

            foreach ($usersData['users'] as $index => $user) {
                if ($user['id'] === $userId) {
                    $foundIndex = $index;
                    break;
                }
            }

            if ($foundIndex === -1) {
                echo json_encode(['success' => false, 'error' => '用户不存在']);
                exit;
            }

            // 不能删除自己
            if ($userId === $_SESSION['current_user_id']) {
                echo json_encode(['success' => false, 'error' => '不能删除当前登录的用户']);
                exit;
            }

            // 不能删除最后一个管理员
            $isAdminRole = function($r) {
                return $r === 'admin' || $r === 'role_admin';
            };
            if ($isAdminRole($usersData['users'][$foundIndex]['role'])) {
                $adminCount = 0;
                foreach ($usersData['users'] as $user) {
                    if ($isAdminRole($user['role'])) $adminCount++;
                }
                if ($adminCount <= 1) {
                    echo json_encode(['success' => false, 'error' => '不能删除最后一个管理员']);
                    exit;
                }
            }

            $deletedUsername = $usersData['users'][$foundIndex]['username'];
            array_splice($usersData['users'], $foundIndex, 1);
            saveUsers($usersData);

            // 清理被删除用户的云端收藏数据
            cleanupUserFavorites($userId);

            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'user.delete', '删除用户: ' . $deletedUsername);
            }
            recordAudit('users.delete', '用户: ' . $deletedUsername, ['userId' => $userId], true);

            echo json_encode(['success' => true]);
            exit;
        }

        // 创建角色
        if ($action === 'createRole') {
            requirePermission('roles.manage');
            $name = isset($input['name']) ? trim($input['name']) : '';
            $description = isset($input['description']) ? trim($input['description']) : '';
            $permissions = isset($input['permissions']) && is_array($input['permissions']) ? $input['permissions'] : [];

            if ($name === '') {
                echo json_encode(['success' => false, 'error' => '角色名称不能为空']);
                exit;
            }
            if (mb_strlen($name) > 50) {
                echo json_encode(['success' => false, 'error' => '角色名称长度不能超过50个字符']);
                exit;
            }
            if (mb_strlen($description) > 200) {
                echo json_encode(['success' => false, 'error' => '角色描述长度不能超过200个字符']);
                exit;
            }

            // 验证权限点
            $validPermissions = getAllPermissionPoints();
            $cleanPermissions = [];
            foreach ($permissions as $perm) {
                if (is_string($perm) && in_array($perm, $validPermissions, true)) {
                    $cleanPermissions[] = $perm;
                }
            }

            $rolesData = loadRoles();

            // 检查角色名是否重复
            foreach ($rolesData['roles'] as $role) {
                if ($role['name'] === $name) {
                    echo json_encode(['success' => false, 'error' => '角色名称已存在']);
                    exit;
                }
            }

            $newRole = [
                'id' => 'role_' . bin2hex(random_bytes(6)),
                'name' => $name,
                'description' => $description,
                'permissions' => $cleanPermissions,
                'isSystem' => false,
                'createdAt' => date('c'),
                'updatedAt' => date('c'),
            ];

            $rolesData['roles'][] = $newRole;
            saveRoles($rolesData);

            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'role.create', '创建角色: ' . $name);
            }
            recordAudit('roles.create', '角色: ' . $name, [
                'roleId' => $newRole['id'],
                'permissions' => $cleanPermissions,
            ], true);

            echo json_encode(['success' => true, 'role' => $newRole]);
            exit;
        }

        // 更新角色
        if ($action === 'updateRole') {
            requirePermission('roles.manage');
            $roleId = isset($input['id']) ? $input['id'] : '';
            $name = isset($input['name']) ? trim($input['name']) : null;
            $description = isset($input['description']) ? trim($input['description']) : null;
            $permissions = isset($input['permissions']) ? $input['permissions'] : null;

            if ($roleId === '') {
                echo json_encode(['success' => false, 'error' => '角色ID不能为空']);
                exit;
            }

            $rolesData = loadRoles();
            $foundIndex = -1;

            foreach ($rolesData['roles'] as $index => $role) {
                if ($role['id'] === $roleId) {
                    $foundIndex = $index;
                    break;
                }
            }

            if ($foundIndex === -1) {
                echo json_encode(['success' => false, 'error' => '角色不存在']);
                exit;
            }

            $isSystem = !empty($rolesData['roles'][$foundIndex]['isSystem']);

            if ($name !== null) {
                if ($name === '') {
                    echo json_encode(['success' => false, 'error' => '角色名称不能为空']);
                    exit;
                }
                if (mb_strlen($name) > 50) {
                    echo json_encode(['success' => false, 'error' => '角色名称长度不能超过50个字符']);
                    exit;
                }
                // 检查名称是否与其他角色重复
                foreach ($rolesData['roles'] as $index => $role) {
                    if ($index !== $foundIndex && $role['name'] === $name) {
                        echo json_encode(['success' => false, 'error' => '角色名称已存在']);
                        exit;
                    }
                }
                $rolesData['roles'][$foundIndex]['name'] = $name;
            }

            if ($description !== null) {
                if (mb_strlen($description) > 200) {
                    echo json_encode(['success' => false, 'error' => '角色描述长度不能超过200个字符']);
                    exit;
                }
                $rolesData['roles'][$foundIndex]['description'] = $description;
            }

            if ($permissions !== null) {
                if (!is_array($permissions)) {
                    echo json_encode(['success' => false, 'error' => '权限格式不正确']);
                    exit;
                }
                $validPermissions = getAllPermissionPoints();
                $cleanPermissions = [];
                foreach ($permissions as $perm) {
                    if (is_string($perm) && in_array($perm, $validPermissions, true)) {
                        $cleanPermissions[] = $perm;
                    }
                }
                $oldPerms = json_encode($rolesData['roles'][$foundIndex]['permissions'] ?? []);
                $newPerms = json_encode($cleanPermissions);
                $rolesData['roles'][$foundIndex]['permissions'] = $cleanPermissions;
                
                if ($oldPerms !== $newPerms) {
                    $currentUser = getCurrentUser();
                    recordAudit('roles.permChange', '角色: ' . $rolesData['roles'][$foundIndex]['name'], [
                        'roleId' => $roleId,
                    ], true);
                }
            }

            $rolesData['roles'][$foundIndex]['updatedAt'] = date('c');
            saveRoles($rolesData);

            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'role.update', '更新角色: ' . $rolesData['roles'][$foundIndex]['name']);
            }
            recordAudit('roles.edit', '角色: ' . $rolesData['roles'][$foundIndex]['name'], ['roleId' => $roleId], true);

            echo json_encode(['success' => true, 'role' => $rolesData['roles'][$foundIndex]]);
            exit;
        }

        // 删除角色
        if ($action === 'deleteRole') {
            requirePermission('roles.manage');
            $roleId = isset($input['id']) ? $input['id'] : '';

            if ($roleId === '') {
                echo json_encode(['success' => false, 'error' => '角色ID不能为空']);
                exit;
            }

            $rolesData = loadRoles();
            $foundIndex = -1;

            foreach ($rolesData['roles'] as $index => $role) {
                if ($role['id'] === $roleId) {
                    $foundIndex = $index;
                    break;
                }
            }

            if ($foundIndex === -1) {
                echo json_encode(['success' => false, 'error' => '角色不存在']);
                exit;
            }

            // 系统角色不允许删除
            if (!empty($rolesData['roles'][$foundIndex]['isSystem'])) {
                echo json_encode(['success' => false, 'error' => '系统内置角色不能删除']);
                exit;
            }

            // 检查是否有用户在使用该角色
            $usersData = loadUsers();
            $usingUsers = [];
            foreach ($usersData['users'] as $user) {
                if (($user['role'] ?? '') === $roleId) {
                    $usingUsers[] = $user['username'];
                }
            }
            if (!empty($usingUsers)) {
                echo json_encode([
                    'success' => false,
                    'error' => '该角色下还有 ' . count($usingUsers) . ' 个用户，无法删除',
                    'usingUsers' => $usingUsers
                ]);
                exit;
            }

            $deletedRoleName = $rolesData['roles'][$foundIndex]['name'];
            array_splice($rolesData['roles'], $foundIndex, 1);
            saveRoles($rolesData);

            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'role.delete', '删除角色: ' . $deletedRoleName);
            }
            recordAudit('roles.delete', '角色: ' . $deletedRoleName, ['roleId' => $roleId], true);

            echo json_encode(['success' => true]);
            exit;
        }

        // 创建分享链接
        if ($action === 'createShare') {
            requirePermission('content.share');
            $itemId = isset($input['itemId']) ? trim($input['itemId']) : '';
            $expiresAt = isset($input['expiresAt']) && $input['expiresAt'] ? $input['expiresAt'] : null;
            $maxViews = isset($input['maxViews']) && $input['maxViews'] ? (int)$input['maxViews'] : null;
            $password = isset($input['password']) && $input['password'] ? $input['password'] : null;

            if ($itemId === '') {
                echo json_encode(['success' => false, 'error' => '缺少文案ID']);
                exit;
            }
            // 校验文案存在
            $data = adminLoadData();
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
                $sharesData = loadShares();
                $token = generateShareToken($sharesData);
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

            $shareUrl = buildShareUrl($token);

            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'share.create', '创建分享链接: ' . substr($token, 0, 8) . '...');
            }
            recordAudit('shares.create', '分享: ' . substr($token, 0, 12) . '...', [
                'token' => $token,
                'itemId' => $itemId,
                'expiresAt' => $expiresAt,
                'maxViews' => $maxViews,
            ], true);
            echo json_encode(['success' => true, 'token' => $token, 'url' => $shareUrl]);
            exit;
        }

        // 撤销分享链接
        if ($action === 'deleteShare') {
            requirePermission('content.share');
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
            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'share.delete', '撤销分享链接: ' . substr($token, 0, 8) . '...');
            }
            recordAudit('shares.delete', '分享: ' . substr($token, 0, 12) . '...', ['token' => $token], true);
            echo json_encode(['success' => true]);
            exit;
        }

        // 清空全部分享链接
        if ($action === 'clearAllShares') {
            requirePermission('shares.manage');
            $lockFp = acquireSharesLock();
            if (!$lockFp) {
                echo json_encode(['success' => false, 'error' => '系统繁忙，请稍后重试']);
                exit;
            }
            try {
                $sharesData = loadShares();
                $tokensToClear = isset($input['tokens']) && is_array($input['tokens']) ? $input['tokens'] : [];
                if (!empty($tokensToClear)) {
                    $tokensSet = array_flip(array_map('trim', $tokensToClear));
                    $beforeCount = count($sharesData['shares']);
                    $sharesData['shares'] = array_filter($sharesData['shares'], function($s) use ($tokensSet) {
                        return !isset($tokensSet[$s['token']]);
                    });
                    $clearedCount = $beforeCount - count($sharesData['shares']);
                } else {
                    $clearedCount = count($sharesData['shares']);
                    $sharesData['shares'] = [];
                }
                if ($clearedCount === 0) {
                    echo json_encode(['success' => false, 'error' => '没有可清空的分享记录']);
                    exit;
                }
                saveShares($sharesData);
            } finally {
                releaseSharesLock($lockFp);
            }
            $currentUser = getCurrentUser();
            if ($currentUser) {
                recordActivity($currentUser['id'], $currentUser['username'], 'share.clear', '清空分享链接（' . $clearedCount . ' 条）');
            }
            recordAudit('shares.clear', '清空分享链接', ['clearedCount' => $clearedCount], true);
            echo json_encode(['success' => true, 'clearedCount' => $clearedCount]);
            exit;
        }

        // 更新分享链接配置
        if ($action === 'updateShare') {
            requirePermission('content.share');
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
            recordAudit('shares.edit', '分享: ' . substr($token, 0, 12) . '...', ['token' => $token], true);
            echo json_encode(['success' => true]);
            exit;
        }

        /* ========== 网盘 API ========== */

        if ($action === 'listDriveFiles') {
            requirePermission('view.drive');
            $parentId = isset($input['parentId']) && $input['parentId'] !== '' ? $input['parentId'] : null;
            $search = isset($input['search']) ? trim($input['search']) : '';
            $data = loadDriveData();
            $files = $data['files'];

            if ($search !== '') {
                $results = [];
                foreach ($files as $f) {
                    if (mb_stripos($f['name'], $search) !== false) {
                        $results[] = $f;
                    }
                }
                echo json_encode(['success' => true, 'files' => $results, 'search' => true]);
                exit;
            }

            $items = [];
            foreach ($files as $f) {
                if ($f['parentId'] === $parentId) {
                    $items[] = $f;
                }
            }
            // Folders first, then files, both sorted by name
            usort($items, function($a, $b) {
                if ($a['type'] !== $b['type']) return $a['type'] === 'folder' ? -1 : 1;
                return strnatcasecmp($a['name'], $b['name']);
            });

            // Build breadcrumb
            $breadcrumb = [];
            $cur = $parentId;
            while ($cur !== null) {
                foreach ($files as $f) {
                    if ($f['id'] === $cur) {
                        array_unshift($breadcrumb, ['id' => $f['id'], 'name' => $f['name']]);
                        $cur = $f['parentId'];
                        break;
                    }
                }
                if ($cur === $parentId && !empty($breadcrumb)) break; // safety
                if ($cur !== null && empty($breadcrumb)) break; // not found
            }

            echo json_encode(['success' => true, 'files' => $items, 'breadcrumb' => $breadcrumb]);
            exit;
        }

        if ($action === 'uploadDriveFile') {
            requirePermission('drive.upload');
            $parentId = isset($_POST['parentId']) && $_POST['parentId'] !== '' ? $_POST['parentId'] : null;

            // 从设置中读取配置
            $driveData = loadDriveData();
            $settings = $driveData['settings'];
            $maxFileSize = isset($settings['maxFileSize']) ? (int)$settings['maxFileSize'] : 100;
            if ($maxFileSize <= 0) $maxFileSize = 100;
            $maxSize = $maxFileSize * 1024 * 1024;
            $blockedExts = ['php', 'phtml', 'php3', 'php4', 'php5', 'phar', 'pht', 'phps', 'shtml', 'asp', 'aspx', 'jsp', 'cgi', 'pl', 'py', 'sh', 'bash', 'htaccess', 'hta'];
            $allowedExts = isset($settings['allowedExts']) ? $settings['allowedExts'] : '*';

            if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                $errCode = isset($_FILES['file']) ? $_FILES['file']['error'] : -1;
                $errMap = [
                    1 => '文件超出 php.ini 中 upload_max_filesize 限制',
                    2 => '文件超出表单 MAX_FILE_SIZE 限制',
                    3 => '文件只有部分被上传',
                    4 => '没有文件被上传',
                    6 => '找不到临时文件夹',
                    7 => '文件写入失败',
                    8 => 'PHP 扩展阻止了文件上传',
                ];
                $errMsg = isset($errMap[$errCode]) ? $errMap[$errCode] : '未接收到文件 (错误码: ' . $errCode . ')';
                echo json_encode(['success' => false, 'error' => $errMsg]);
                exit;
            }
            $file = $_FILES['file'];

            if ($file['size'] > $maxSize) {
                echo json_encode(['success' => false, 'error' => '文件过大，最大允许 ' . $maxFileSize . 'MB']);
                exit;
            }

            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            if (in_array($ext, $blockedExts, true)) {
                echo json_encode(['success' => false, 'error' => '不允许上传可执行文件']);
                exit;
            }
            // 如果设置了白名单（非 '*'），则检查扩展名是否在白名单中
            if (is_array($allowedExts) && !in_array($ext, $allowedExts, true)) {
                echo json_encode(['success' => false, 'error' => '不允许上传 .' . $ext . ' 格式的文件，允许的格式: ' . implode(', ', $allowedExts)]);
                exit;
            }

            $origName = pathinfo($file['name'], PATHINFO_FILENAME);
            $origName = mb_substr($origName, 0, 100);
            if ($ext) $origName .= '.' . $ext;

            $id = 'f_' . bin2hex(random_bytes(8));
            $storedName = $id . ($ext ? '.' . $ext : '');
            $dateDir = date('Y/m');
            $relDir = 'drive/' . $dateDir;
            $absDir = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $relDir);
            if (!is_dir($absDir)) @mkdir($absDir, 0755, true);
            $relPath = $relDir . '/' . $storedName;
            $absPath = $absDir . DIRECTORY_SEPARATOR . $storedName;

            if (!move_uploaded_file($file['tmp_name'], $absPath)) {
                echo json_encode(['success' => false, 'error' => '文件保存失败']);
                exit;
            }

            $finfo = function_exists('finfo_open') ? new finfo(FILEINFO_MIME_TYPE) : null;
            $mimeType = $finfo ? $finfo->file($absPath) : 'application/octet-stream';

            $data = loadDriveData();
            $item = [
                'id' => $id,
                'name' => $origName,
                'type' => 'file',
                'path' => $relPath,
                'size' => $file['size'],
                'mimeType' => $mimeType,
                'parentId' => $parentId,
                'createdBy' => getCurrentUser()['username'] ?? 'unknown',
                'createdAt' => date('Y-m-d H:i:s'),
                'updatedAt' => date('Y-m-d H:i:s'),
            ];
            $data['files'][] = $item;

            // Add to parent's children
            if ($parentId !== null) {
                foreach ($data['files'] as &$pf) {
                    if ($pf['id'] === $parentId && $pf['type'] === 'folder') {
                        if (!isset($pf['children']) || !is_array($pf['children'])) $pf['children'] = [];
                        $pf['children'][] = $id;
                        break;
                    }
                }
                unset($pf);
            }

            saveDriveData($data);
            recordAudit('drive.upload', $origName, ['id' => $id, 'size' => $file['size']], true);
            echo json_encode(['success' => true, 'item' => $item]);
            exit;
        }

        if ($action === 'createDriveFolder') {
            requirePermission('drive.folder');
            $name = isset($input['name']) ? trim($input['name']) : '';
            $parentId = isset($input['parentId']) && $input['parentId'] !== '' ? $input['parentId'] : null;

            if ($name === '') {
                echo json_encode(['success' => false, 'error' => '文件夹名称不能为空']);
                exit;
            }
            if (mb_strlen($name) > 100) {
                echo json_encode(['success' => false, 'error' => '名称过长，最多100个字符']);
                exit;
            }

            $id = 'd_' . bin2hex(random_bytes(8));
            $data = loadDriveData();
            $item = [
                'id' => $id,
                'name' => $name,
                'type' => 'folder',
                'parentId' => $parentId,
                'children' => [],
                'createdBy' => getCurrentUser()['username'] ?? 'unknown',
                'createdAt' => date('Y-m-d H:i:s'),
            ];
            $data['files'][] = $item;

            if ($parentId !== null) {
                foreach ($data['files'] as &$pf) {
                    if ($pf['id'] === $parentId && $pf['type'] === 'folder') {
                        if (!isset($pf['children']) || !is_array($pf['children'])) $pf['children'] = [];
                        $pf['children'][] = $id;
                        break;
                    }
                }
                unset($pf);
            }

            saveDriveData($data);
            recordAudit('drive.createFolder', $name, ['id' => $id], true);
            echo json_encode(['success' => true, 'item' => $item]);
            exit;
        }

        if ($action === 'renameDriveItem') {
            requirePermission('drive.rename');
            $id = isset($input['id']) ? trim($input['id']) : '';
            $newName = isset($input['name']) ? trim($input['name']) : '';

            if ($id === '' || $newName === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }
            if (mb_strlen($newName) > 100) {
                echo json_encode(['success' => false, 'error' => '名称过长']);
                exit;
            }

            $data = loadDriveData();
            $found = false;
            foreach ($data['files'] as &$f) {
                if ($f['id'] === $id) {
                    $oldName = $f['name'];
                    $f['name'] = $newName;
                    $f['updatedAt'] = date('Y-m-d H:i:s');
                    $found = true;
                    break;
                }
            }
            unset($f);

            if (!$found) {
                echo json_encode(['success' => false, 'error' => '项目不存在']);
                exit;
            }

            saveDriveData($data);
            recordAudit('drive.rename', $oldName . ' → ' . $newName, ['id' => $id], true);
            echo json_encode(['success' => true]);
            exit;
        }

        if ($action === 'moveDriveItem') {
            requirePermission('drive.move');
            $id = isset($input['id']) ? trim($input['id']) : '';
            $targetParentId = isset($input['targetParentId']) && $input['targetParentId'] !== '' ? $input['targetParentId'] : null;

            if ($id === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }
            if ($id === $targetParentId) {
                echo json_encode(['success' => false, 'error' => '不能移动到自身']);
                exit;
            }

            $data = loadDriveData();
            $item = null;
            $oldParentId = null;
            $itemIdx = -1;
            foreach ($data['files'] as $i => &$f) {
                if ($f['id'] === $id) {
                    $oldParentId = $f['parentId'];
                    $item = $f;
                    $itemIdx = $i;
                    break;
                }
            }
            unset($f);

            if (!$item) {
                echo json_encode(['success' => false, 'error' => '项目不存在']);
                exit;
            }

            // Check for circular folder move (folder can't be moved into itself or its descendants)
            if ($item['type'] === 'folder' && $targetParentId !== null) {
                $checkId = $targetParentId;
                $visited = [];
                while ($checkId !== null) {
                    if ($checkId === $id) {
                        echo json_encode(['success' => false, 'error' => '不能移动到自身或子文件夹中']);
                        exit;
                    }
                    if (in_array($checkId, $visited)) break;
                    $visited[] = $checkId;
                    $found = false;
                    foreach ($data['files'] as $f) {
                        if ($f['id'] === $checkId) { $checkId = $f['parentId']; $found = true; break; }
                    }
                    if (!$found) break;
                }
            }

            // Apply move after validation
            $data['files'][$itemIdx]['parentId'] = $targetParentId;
            $data['files'][$itemIdx]['updatedAt'] = date('Y-m-d H:i:s');
            $item = $data['files'][$itemIdx];

            // Remove from old parent's children
            if ($oldParentId !== null) {
                foreach ($data['files'] as &$pf) {
                    if ($pf['id'] === $oldParentId && $pf['type'] === 'folder' && isset($pf['children'])) {
                        $pf['children'] = array_values(array_diff($pf['children'], [$id]));
                        break;
                    }
                }
                unset($pf);
            }

            // Add to new parent's children
            if ($targetParentId !== null) {
                foreach ($data['files'] as &$pf) {
                    if ($pf['id'] === $targetParentId && $pf['type'] === 'folder') {
                        if (!isset($pf['children']) || !is_array($pf['children'])) $pf['children'] = [];
                        if (!in_array($id, $pf['children'])) $pf['children'][] = $id;
                        break;
                    }
                }
                unset($pf);
            }

            saveDriveData($data);
            recordAudit('drive.move', $item['name'], ['id' => $id, 'to' => $targetParentId ?? 'root'], true);
            echo json_encode(['success' => true]);
            exit;
        }

        if ($action === 'copyDriveItem') {
            requirePermission('drive.move');
            $id = isset($input['id']) ? trim($input['id']) : '';
            $targetParentId = isset($input['targetParentId']) && $input['targetParentId'] !== '' ? $input['targetParentId'] : null;

            if ($id === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }

            $data = loadDriveData();
            $srcItem = null;
            foreach ($data['files'] as $f) {
                if ($f['id'] === $id) { $srcItem = $f; break; }
            }

            if (!$srcItem) {
                echo json_encode(['success' => false, 'error' => '源文件不存在']);
                exit;
            }
            if ($srcItem['type'] !== 'file') {
                echo json_encode(['success' => false, 'error' => '暂不支持复制文件夹']);
                exit;
            }

            $newId = 'f_' . bin2hex(random_bytes(8));
            $ext = pathinfo($srcItem['name'], PATHINFO_EXTENSION);
            $storedName = $newId . ($ext ? '.' . $ext : '');
            $dateDir = date('Y/m');
            $relDir = 'drive/' . $dateDir;
            $absDir = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $relDir);
            if (!is_dir($absDir)) @mkdir($absDir, 0755, true);
            $newRelPath = $relDir . '/' . $storedName;
            $srcAbsPath = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $srcItem['path']);
            $dstAbsPath = $absDir . DIRECTORY_SEPARATOR . $storedName;

            if (!@copy($srcAbsPath, $dstAbsPath)) {
                echo json_encode(['success' => false, 'error' => '复制文件失败']);
                exit;
            }

            $newItem = [
                'id' => $newId,
                'name' => $srcItem['name'],
                'type' => 'file',
                'path' => $newRelPath,
                'size' => $srcItem['size'],
                'mimeType' => $srcItem['mimeType'],
                'parentId' => $targetParentId,
                'createdBy' => getCurrentUser()['username'] ?? 'unknown',
                'createdAt' => date('Y-m-d H:i:s'),
                'updatedAt' => date('Y-m-d H:i:s'),
            ];
            $data['files'][] = $newItem;

            if ($targetParentId !== null) {
                foreach ($data['files'] as &$pf) {
                    if ($pf['id'] === $targetParentId && $pf['type'] === 'folder') {
                        if (!isset($pf['children']) || !is_array($pf['children'])) $pf['children'] = [];
                        $pf['children'][] = $newId;
                        break;
                    }
                }
                unset($pf);
            }

            saveDriveData($data);
            recordAudit('drive.copy', $srcItem['name'], ['from' => $id, 'newId' => $newId], true);
            echo json_encode(['success' => true, 'item' => $newItem]);
            exit;
        }

        if ($action === 'deleteDriveItems') {
            requirePermission('drive.delete');
            $ids = isset($input['ids']) ? $input['ids'] : [];
            if (!is_array($ids) || empty($ids)) {
                echo json_encode(['success' => false, 'error' => '未选择要删除的项目']);
                exit;
            }

            $data = loadDriveData();
            $deletedNames = [];
            $deletedPhysical = [];
            $failedFiles = [];

            // Collect all IDs to delete (including nested folder contents)
            $allIds = [];
            foreach ($ids as $delId) {
                $allIds = array_merge($allIds, collectFolderFileIds($data['files'], $delId));
            }
            $allIds = array_unique($allIds);

            foreach ($allIds as $delId) {
                foreach ($data['files'] as $f) {
                    if ($f['id'] === $delId) {
                        $deletedNames[] = $f['name'];
                        if ($f['type'] === 'file' && !empty($f['path'])) {
                            $deletedPhysical[] = $f;
                        }
                        break;
                    }
                }
            }

            // Delete physical files
            foreach ($deletedPhysical as $f) {
                $absPath = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $f['path']);
                if (file_exists($absPath)) {
                    if (!@unlink($absPath)) {
                        $failedFiles[] = $f['name'];
                    }
                }
            }

            // Remove from parent children references
            foreach ($allIds as $delId) {
                foreach ($data['files'] as &$f) {
                    if ($f['type'] === 'folder' && isset($f['children']) && in_array($delId, $f['children'])) {
                        $f['children'] = array_values(array_diff($f['children'], [$delId]));
                    }
                }
                unset($f);
            }

            // Remove items from files array
            $data['files'] = array_values(array_filter($data['files'], function($f) use ($allIds) {
                return !in_array($f['id'], $allIds);
            }));

            // Also remove related shares
            $data['shares'] = array_values(array_filter($data['shares'], function($s) use ($allIds) {
                return !in_array($s['fileId'], $allIds);
            }));

            saveDriveData($data);
            recordAudit('drive.delete', implode(', ', $deletedNames), ['count' => count($allIds), 'failedFiles' => $failedFiles], true);

            echo json_encode([
                'success' => true,
                'deletedCount' => count($allIds),
                'failedFiles' => $failedFiles,
            ]);
            exit;
        }

        if ($action === 'getDriveStats') {
            requirePermission('view.drive');
            $data = loadDriveData();
            $files = $data['files'];

            $totalFiles = 0;
            $totalFolders = 0;
            $totalSize = 0;
            $typeMap = [];

            foreach ($files as $f) {
                if ($f['type'] === 'file') {
                    $totalFiles++;
                    $totalSize += isset($f['size']) ? (int)$f['size'] : 0;
                    $mime = isset($f['mimeType']) ? $f['mimeType'] : 'other';
                    $cat = explode('/', $mime)[0];
                    if (!isset($typeMap[$cat])) $typeMap[$cat] = 0;
                    $typeMap[$cat]++;
                } else {
                    $totalFolders++;
                }
            }

            echo json_encode([
                'success' => true,
                'stats' => [
                    'totalFiles' => $totalFiles,
                    'totalFolders' => $totalFolders,
                    'totalSize' => $totalSize,
                    'totalSizeText' => formatBytes($totalSize),
                    'typeDistribution' => $typeMap,
                ]
            ]);
            exit;
        }

        if ($action === 'createDriveShare') {
            requirePermission('drive.share');
            $fileId = isset($input['fileId']) ? trim($input['fileId']) : '';
            $password = isset($input['password']) ? trim($input['password']) : '';
            $expiresAt = isset($input['expiresAt']) ? trim($input['expiresAt']) : '';
            $maxDownloads = isset($input['maxDownloads']) ? (int)$input['maxDownloads'] : 0;

            if ($fileId === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }

            $data = loadDriveData();
            $fileItem = null;
            foreach ($data['files'] as $f) {
                if ($f['id'] === $fileId && $f['type'] === 'file') { $fileItem = $f; break; }
            }

            if (!$fileItem) {
                echo json_encode(['success' => false, 'error' => '文件不存在或不能分享文件夹']);
                exit;
            }

            // 安全修复：提升令牌熵从 32 位到 128 位，防止枚举攻击
            $token = bin2hex(random_bytes(16));
            $share = [
                'id' => 's_' . bin2hex(random_bytes(6)),
                'token' => $token,
                'fileId' => $fileId,
                'fileName' => $fileItem['name'],
                'fileSize' => $fileItem['size'],
                'filePath' => $fileItem['path'],
                'mimeType' => isset($fileItem['mimeType']) ? $fileItem['mimeType'] : 'application/octet-stream',
                'password' => $password !== '' ? password_hash($password, PASSWORD_DEFAULT) : '',
                'hasPassword' => $password !== '',
                'expiresAt' => $expiresAt !== '' ? $expiresAt : null,
                'downloadCount' => 0,
                'maxDownloads' => $maxDownloads > 0 ? $maxDownloads : null,
                'createdBy' => getCurrentUser()['username'] ?? 'unknown',
                'createdAt' => date('Y-m-d H:i:s'),
            ];

            $data['shares'][] = $share;
            saveDriveData($data);
            recordAudit('drive.share', $fileItem['name'], ['token' => $token], true);

            // Return share without password hash
            $ret = $share;
            unset($ret['password']);
            unset($ret['filePath']);
            echo json_encode(['success' => true, 'share' => $ret]);
            exit;
        }

        if ($action === 'deleteDriveShare') {
            requirePermission('drive.share');
            $shareId = isset($input['id']) ? trim($input['id']) : '';
            if ($shareId === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }

            $data = loadDriveData();
            $found = false;
            $data['shares'] = array_values(array_filter($data['shares'], function($s) use ($shareId, &$found) {
                if ($s['id'] === $shareId) { $found = true; return false; }
                return true;
            }));

            if (!$found) {
                echo json_encode(['success' => false, 'error' => '分享不存在']);
                exit;
            }

            saveDriveData($data);
            recordAudit('drive.deleteShare', $shareId, [], true);
            echo json_encode(['success' => true]);
            exit;
        }

        if ($action === 'updateDriveShare') {
            requirePermission('drive.share');
            $shareId = isset($input['id']) ? trim($input['id']) : '';
            if ($shareId === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }

            $data = loadDriveData();
            $found = false;
            foreach ($data['shares'] as &$s) {
                if ($s['id'] === $shareId) {
                    if (isset($input['password'])) {
                        $pw = trim($input['password']);
                        $s['password'] = $pw !== '' ? password_hash($pw, PASSWORD_DEFAULT) : '';
                        $s['hasPassword'] = $pw !== '';
                    }
                    if (isset($input['expiresAt'])) {
                        $s['expiresAt'] = trim($input['expiresAt']) !== '' ? trim($input['expiresAt']) : null;
                    }
                    if (isset($input['maxDownloads'])) {
                        $md = (int)$input['maxDownloads'];
                        $s['maxDownloads'] = $md > 0 ? $md : null;
                    }
                    $found = true;
                    break;
                }
            }
            unset($s);

            if (!$found) {
                echo json_encode(['success' => false, 'error' => '分享不存在']);
                exit;
            }

            saveDriveData($data);
            echo json_encode(['success' => true]);
            exit;
        }

        if ($action === 'clearAllDriveShares') {
            requirePermission('drive.manage');
            $data = loadDriveData();
            $idsToClear = isset($input['ids']) && is_array($input['ids']) ? $input['ids'] : [];
            if (!empty($idsToClear)) {
                $idsSet = array_flip(array_map('trim', $idsToClear));
                $beforeCount = count($data['shares']);
                $data['shares'] = array_filter($data['shares'], function($s) use ($idsSet) {
                    return !isset($idsSet[$s['id']]);
                });
                $clearedCount = $beforeCount - count($data['shares']);
            } else {
                $clearedCount = count($data['shares']);
                $data['shares'] = [];
            }
            if ($clearedCount === 0) {
                echo json_encode(['success' => false, 'error' => '没有可清空的数据网盘分享记录']);
                exit;
            }
            saveDriveData($data);
            recordAudit('drive.clearShares', '清空数据网盘分享链接', ['clearedCount' => $clearedCount], true);
            echo json_encode(['success' => true, 'clearedCount' => $clearedCount]);
            exit;
        }

        if ($action === 'downloadDriveFile') {
            requirePermission('view.drive');
            $id = isset($input['id']) ? trim($input['id']) : '';
            if ($id === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }

            $data = loadDriveData();
            $fileItem = null;
            foreach ($data['files'] as $f) {
                if ($f['id'] === $id && $f['type'] === 'file') { $fileItem = $f; break; }
            }

            if (!$fileItem) {
                echo json_encode(['success' => false, 'error' => '文件不存在']);
                exit;
            }

            $absPath = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $fileItem['path']);
            if (!file_exists($absPath)) {
                echo json_encode(['success' => false, 'error' => '物理文件不存在']);
                exit;
            }

            // Stream file directly
            $fileName = $fileItem['name'];
            $fileSize = filesize($absPath);
            $mimeType = isset($fileItem['mimeType']) ? $fileItem['mimeType'] : 'application/octet-stream';
            $filenameEncoded = rawurlencode($fileName);

            header('Content-Type: ' . $mimeType);
            header('Content-Disposition: attachment; filename="' . $filenameEncoded . '"; filename*=UTF-8\'\'' . $filenameEncoded);
            header('Content-Length: ' . $fileSize);
            header('Cache-Control: no-cache, must-revalidate');
            header('X-Content-Type-Options: nosniff');
            ob_clean();
            readfile($absPath);
            exit;
        }

        if ($action === 'previewDriveFile') {
            requirePermission('view.drive');
            $id = isset($input['id']) ? trim($input['id']) : '';
            if ($id === '') {
                echo json_encode(['success' => false, 'error' => '参数缺失']);
                exit;
            }

            $data = loadDriveData();
            $fileItem = null;
            foreach ($data['files'] as $f) {
                if ($f['id'] === $id && $f['type'] === 'file') { $fileItem = $f; break; }
            }

            if (!$fileItem) {
                echo json_encode(['success' => false, 'error' => '文件不存在']);
                exit;
            }

            $mimeType = isset($fileItem['mimeType']) ? $fileItem['mimeType'] : 'application/octet-stream';
            if (!preg_match('/^image\//', $mimeType) && !preg_match('/\/pdf$/', $mimeType)) {
                echo json_encode(['success' => false, 'error' => '该文件类型不支持预览']);
                exit;
            }

            $absPath = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $fileItem['path']);
            if (!file_exists($absPath)) {
                echo json_encode(['success' => false, 'error' => '物理文件不存在']);
                exit;
            }

            $fileName = $fileItem['name'];
            $fileSize = filesize($absPath);
            $filenameEncoded = rawurlencode($fileName);

            // Override global Content-Type header for file streaming
            header('Content-Type: ' . $mimeType);
            header('Content-Disposition: inline; filename="' . $filenameEncoded . '"; filename*=UTF-8\'\'' . $filenameEncoded);
            header('Content-Length: ' . $fileSize);
            header('Cache-Control: private, max-age=3600');
            header('X-Content-Type-Options: nosniff');
            ob_clean();
            readfile($absPath);
            exit;
        }

        if ($action === 'getDriveFolders') {
            requirePermission('view.drive');
            $data = loadDriveData();
            $folders = [];
            foreach ($data['files'] as $f) {
                if ($f['type'] === 'folder') {
                    $folders[] = ['id' => $f['id'], 'name' => $f['name'], 'parentId' => $f['parentId']];
                }
            }
            echo json_encode(['success' => true, 'folders' => $folders]);
            exit;
        }

        if ($action === 'getDriveSettings') {
            requirePermission('drive.manage');
            $data = loadDriveData();
            echo json_encode(['success' => true, 'settings' => $data['settings']]);
            exit;
        }

        if ($action === 'saveDriveSettings') {
            requirePermission('drive.manage');
            $data = loadDriveData();
            $allowedExts = isset($input['allowedExts']) ? $input['allowedExts'] : '*';
            $maxFileSize = isset($input['maxFileSize']) ? (int)$input['maxFileSize'] : 100;

            // 验证 allowedExts: '*' 或字符串数组
            if ($allowedExts !== '*' && !is_array($allowedExts)) {
                echo json_encode(['success' => false, 'error' => '格式设置无效']);
                exit;
            }
            if (is_array($allowedExts)) {
                $clean = [];
                foreach ($allowedExts as $e) {
                    $e = strtolower(trim(preg_replace('/[^a-zA-Z0-9]/', '', $e)));
                    if ($e !== '') $clean[] = $e;
                }
                $allowedExts = $clean;
            }

            if ($maxFileSize < 1) $maxFileSize = 1;
            if ($maxFileSize > 500) $maxFileSize = 500;

            $data['settings'] = [
                'allowedExts' => $allowedExts,
                'maxFileSize' => $maxFileSize,
            ];
            saveDriveData($data);
            recordAudit('drive.saveSettings', '数据网盘设置', [], true);
            echo json_encode(['success' => true, 'settings' => $data['settings']]);
            exit;
        }

        echo json_encode(['success' => false, 'error' => '未知操作']);
        exit;
    }

    echo json_encode(['success' => false, 'error' => '不支持的请求方法']);
} catch (Exception $e) {
    error_log('admin/api.php error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    echo json_encode(['success' => false, 'error' => '服务器内部错误']);
}
