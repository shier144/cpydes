<?php
// 由 api.php 机械拆分而来（后台密码限流验证 + 文案库访问密码保护），仅供 api.php 引入
if (!defined('DATA_FILE')) { http_response_code(403); exit; }

/* ========== 文案库运行配置（独立文件 library_settings.json） ==========
 * 历史上 settings 与 categories/items 一起存于 copywriting.json，导致：
 *  - 每次写一个小配置项都会触发整个文案文件的原子重写
 *  - 业务数据膨胀后写入开销线性放大，引发性能下降与并发锁竞争
 * 拆分后：settings 走独立小文件，业务数据写盘不再受配置影响
 */

$_libSettingsCache = null;

/**
 * 加载文案库运行配置（请求级缓存 + 一次性迁移）
 * - 若 LIBRARY_SETTINGS_FILE 存在：直接读取
 * - 若不存在但 copywriting.json 中含 settings：迁移并清理原文件
 * - 否则返回空数组
 * @param bool $reload 强制重新读取
 * @return array
 */
function loadLibrarySettings($reload = false) {
    global $_libSettingsCache;
    if ($_libSettingsCache !== null && !$reload) return $_libSettingsCache;

    if (file_exists(LIBRARY_SETTINGS_FILE)) {
        $raw = @file_get_contents(LIBRARY_SETTINGS_FILE);
        $data = $raw !== false ? json_decode($raw, true) : null;
        $_libSettingsCache = is_array($data) ? $data : [];
        return $_libSettingsCache;
    }

    // 一次性迁移：从 copywriting.json 抽离 settings
    $migrated = [];
    if (file_exists(DATA_FILE)) {
        $raw = @file_get_contents(DATA_FILE);
        $data = $raw !== false ? json_decode($raw, true) : null;
        if (is_array($data) && isset($data['settings']) && is_array($data['settings']) && !empty($data['settings'])) {
            $migrated = $data['settings'];
            // 写入新独立文件（仅在写入成功后才从原文件清理，防止迁移失败导致数据丢失）
            $migrateOk = @cpydes_json_save_atomic(LIBRARY_SETTINGS_FILE, $migrated, JSON_UNESCAPED_UNICODE);
            if ($migrateOk) {
                // 清理 copywriting.json 中的 settings 键（避免双份存储导致不一致）
                unset($data['settings']);
                @cpydes_json_save_atomic(DATA_FILE, $data, JSON_UNESCAPED_UNICODE);
            }
        }
    }
    $_libSettingsCache = $migrated;
    return $_libSettingsCache;
}

/**
 * 整体覆盖保存文案库运行配置
 * @param array $settings
 * @return bool
 */
function saveLibrarySettings($settings) {
    global $_libSettingsCache;
    if (!is_array($settings)) $settings = [];
    $ok = cpydes_json_save_atomic(LIBRARY_SETTINGS_FILE, $settings, JSON_UNESCAPED_UNICODE);
    if ($ok) {
        $_libSettingsCache = $settings;
    }
    return $ok;
}

/**
 * 更新单个配置项（load + merge + save）
 * @param string $key
 * @param mixed $value
 * @return bool
 */
function updateLibrarySetting($key, $value) {
    $settings = loadLibrarySettings();
    $settings[$key] = $value;
    return saveLibrarySettings($settings);
}

/**
 * 密码尝试限流：5 次失败后锁定 15 分钟
 */
function checkRateLimit() {
    $now = time();
    $attempts = isset($_SESSION['pwd_attempts']) ? $_SESSION['pwd_attempts'] : ['count' => 0, 'lockout' => 0];
    if ($attempts['lockout'] > $now) {
        http_response_code(429);
        $waitMin = ceil(($attempts['lockout'] - $now) / 60);
        echo json_encode(['success' => false, 'error' => "尝试过多，请 {$waitMin} 分钟后再试"]);
        exit;
    }
}

function recordFailedAttempt() {
    $attempts = isset($_SESSION['pwd_attempts']) ? $_SESSION['pwd_attempts'] : ['count' => 0, 'lockout' => 0];
    $attempts['count']++;
    if ($attempts['count'] >= 5) {
        $attempts['lockout'] = time() + 900; // 15 分钟
        $attempts['count'] = 0;
    }
    $_SESSION['pwd_attempts'] = $attempts;
}

function clearFailedAttempts() {
    unset($_SESSION['pwd_attempts']);
}

/**
 * 验证设置中心密码
 * 优先用环境变量 SETTINGS_PASSWORD，其次用 data/.pwd_hash（password_hash）
 * @param string $password
 * @return bool
 */
function verifySettingsPassword($password) {
    // 1. 环境变量优先
    $envPwd = getenv('SETTINGS_PASSWORD');
    if ($envPwd !== false && $envPwd !== '') {
        return hash_equals($envPwd, $password);
    }

    // 2. 哈希文件
    if (defined('PWD_HASH_FILE') && file_exists(PWD_HASH_FILE)) {
        $hash = trim(file_get_contents(PWD_HASH_FILE));
        if ($hash && password_verify($password, $hash)) {
            return true;
        }
    }

    // 3. 无可用密码时返回 false（触发首次设置流程）
    return false;
}

/**
 * 检查是否需要首次设置密码
 * @return bool
 */
function needsPasswordSetup() {
    $envPwd = getenv('SETTINGS_PASSWORD');
    if ($envPwd !== false && $envPwd !== '') return false;
    if (defined('PWD_HASH_FILE') && file_exists(PWD_HASH_FILE)) {
        $hash = trim(file_get_contents(PWD_HASH_FILE));
        if ($hash) return false;
    }
    return true;
}

/**
 * 设置新密码（写入 data/.pwd_hash）
 */
function setNewPassword($password) {
    if (strlen($password) < 6 || strlen($password) > 72) {
        return false;
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    if ($hash === false) return false;
    // 确保目录存在
    $dir = dirname(PWD_HASH_FILE);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return file_put_contents(PWD_HASH_FILE, $hash) !== false;
}

/* ========== 文案库访问密码保护 ========== */

/**
 * 文案库访问密码尝试限流：5 次失败后锁定 15 分钟（独立于管理密码限流）
 */
function checkLibRateLimit() {
    $now = time();
    $attempts = isset($_SESSION['lib_pwd_attempts']) ? $_SESSION['lib_pwd_attempts'] : ['count' => 0, 'lockout' => 0];
    if ($attempts['lockout'] > $now) {
        http_response_code(429);
        $waitMin = ceil(($attempts['lockout'] - $now) / 60);
        echo json_encode(['success' => false, 'error' => "尝试过多，请 {$waitMin} 分钟后再试", 'locked' => true, 'lockout' => $attempts['lockout'] - $now]);
        exit;
    }
}

function recordLibFailedAttempt() {
    $attempts = isset($_SESSION['lib_pwd_attempts']) ? $_SESSION['lib_pwd_attempts'] : ['count' => 0, 'lockout' => 0];
    $attempts['count']++;
    if ($attempts['count'] >= 5) {
        $attempts['lockout'] = time() + 900; // 15 分钟
        $attempts['count'] = 0;
    }
    $_SESSION['lib_pwd_attempts'] = $attempts;
}

function clearLibFailedAttempts() {
    unset($_SESSION['lib_pwd_attempts']);
}

/**
 * 检查文案库是否需要首次设置密码
 * @return bool
 */
function needsLibraryPasswordSetup() {
    if (defined('LIB_PWD_HASH_FILE') && file_exists(LIB_PWD_HASH_FILE)) {
        $hash = trim(file_get_contents(LIB_PWD_HASH_FILE));
        if ($hash) return false;
    }
    return true;
}

/**
 * 设置文案库访问密码（写入 data/.lib_pwd_hash）
 * @param string $password
 * @return bool
 */
function setNewLibraryPassword($password) {
    if (strlen($password) < 6 || strlen($password) > 72) {
        return false;
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    if ($hash === false) return false;
    $dir = dirname(LIB_PWD_HASH_FILE);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return file_put_contents(LIB_PWD_HASH_FILE, $hash) !== false;
}

/**
 * 检查文案库密码保护是否开启
 * 读取 library_settings.libraryPasswordEnabled
 * @return bool
 */
function isLibraryProtectionEnabled() {
    $settings = loadLibrarySettings();
    return !empty($settings['libraryPasswordEnabled']);
}

/**
 * 检查是否允许访客访问(保护开启时)
 * 读取 library_settings.allowGuestAccess
 * @return bool
 */
function isAllowGuestAccess() {
    $settings = loadLibrarySettings();
    return !empty($settings['allowGuestAccess']);
}

/**
 * 获取访客默认权限列表（保护关闭时，未登录用户的权限）
 * 读取 library_settings.guestPermissions，若未设置则返回默认值（全部权限）
 * @return array
 */
function getGuestPermissions() {
    $settings = loadLibrarySettings();
    if (isset($settings['guestPermissions']) && is_array($settings['guestPermissions'])) {
        return $settings['guestPermissions'];
    }
    // 默认：保护关闭时，访客拥有全部功能权限
    return [
        'content.create', 'content.edit', 'content.delete', 'content.sort', 'content.share',
        'categories.manage',
        'images.upload', 'images.delete',
        'ai.use',
        'drive.view', 'drive.upload', 'drive.delete', 'drive.rename', 'drive.move', 'drive.folder', 'drive.share',
    ];
}

/**
 * 检查是否允许用户自主注册
 * 读取 library_settings.registrationEnabled，默认关闭
 * @return bool
 */
function isRegistrationEnabled() {
    $settings = loadLibrarySettings();
    return !empty($settings['registrationEnabled']);
}

/**
 * 获取新用户注册后的默认角色 ID
 * 读取 library_settings.defaultRegisterRole，默认 role_viewer
 * @return string
 */
function getDefaultRegisterRole() {
    $settings = loadLibrarySettings();
    $role = isset($settings['defaultRegisterRole']) ? (string)$settings['defaultRegisterRole'] : '';
    if ($role === '') return 'role_viewer';
    return $role;
}

/**
 * 检查访客是否拥有指定权限
 * @param string $permission
 * @return bool
 */
function guestHasPermission($permission) {
    $perms = getGuestPermissions();
    if (in_array('*', $perms, true)) return true;
    if (is_array($permission)) {
        foreach ($permission as $p) {
            if (in_array($p, $perms, true)) return true;
        }
        return false;
    }
    return in_array($permission, $perms, true);
}

/**
 * 获取文案库访问有效期（秒），读取 library_settings.libraryAuthTimeout
 * 0 表示永不超时，默认 7200（2 小时）
 * @return int
 */
function getLibraryAuthTimeout() {
    $settings = loadLibrarySettings();
    if (isset($settings['libraryAuthTimeout'])) {
        $t = (int)$settings['libraryAuthTimeout'];
        if ($t >= 0) return $t;
    }
    return 7200; // 默认 2 小时
}

/**
 * 检查文案库访问是否已通过密码验证（含可配置超时）
 * @return bool
 */
function isLibraryAuthed() {
    if (empty($_SESSION['library_authenticated']) || $_SESSION['library_authenticated'] !== true) {
        return false;
    }
    $authTime = isset($_SESSION['library_auth_time']) ? $_SESSION['library_auth_time'] : 0;
    $timeout = getLibraryAuthTimeout();
    // timeout=0 表示永不超时
    if ($timeout > 0 && (time() - $authTime) > $timeout) {
        unset($_SESSION['library_authenticated']);
        return false;
    }
    return true;
}

/**
 * 要求文案库访问验证（未验证则 401）
 */
function requireLibraryAuth() {
    if (isLibraryProtectionEnabled() && !isLibraryAuthed()) {
        // 保护开启 + 允许访客访问：放行，由后续权限检查控制
        if (isAllowGuestAccess()) {
            return;
        }
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => '需要文案库访问密码', 'needsLibraryAuth' => true]);
        exit;
    }
}

// 检查设置中心是否已通过密码验证（超时由后台 libraryAuthTimeout 统一控制）
function requireSettingsAuth() {
    if (empty($_SESSION['settings_authenticated']) || $_SESSION['settings_authenticated'] !== true) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => '未授权，请先验证密码']);
        exit;
    }
    // 超时统一使用 libraryAuthTimeout（0=永不超时），与前台一致
    $authTime = isset($_SESSION['settings_auth_time']) ? $_SESSION['settings_auth_time'] : 0;
    $timeout = getLibraryAuthTimeout();
    if ($timeout > 0 && (time() - $authTime) > $timeout) {
        unset($_SESSION['settings_authenticated']);
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => '会话已过期，请重新验证密码']);
        exit;
    }
    // 续期
    $_SESSION['settings_auth_time'] = time();
}

/**
 * 检查后台管理员是否已通过密码验证且会话未过期（超时由后台 libraryAuthTimeout 统一控制）
 * 与 requireSettingsAuth() 不同：本函数不触发 401 退出，仅返回布尔值。
 * 过期时会清理会话标记。
 * @return bool
 */
function isBackendAuthed() {
    if (empty($_SESSION['settings_authenticated']) || $_SESSION['settings_authenticated'] !== true) {
        return false;
    }
    $authTime = isset($_SESSION['settings_auth_time']) ? $_SESSION['settings_auth_time'] : 0;
    $timeout = getLibraryAuthTimeout();
    if ($timeout > 0 && (time() - $authTime) > $timeout) {
        unset($_SESSION['settings_authenticated'], $_SESSION['settings_auth_time']);
        return false;
    }
    return true;
}