<?php
// 由 admin/api.php 机械拆分而来，数据读写/图片扫描/内容工具 + 分享数据；仅供 admin/api.php 引入
if (!defined('SITE_ROOT')) { http_response_code(403); exit; }

/**
 * 安全读取数据文件（请求级缓存，每请求只读一次盘）
 * @param bool $reload 强制重新读取（保存后刷新缓存）
 */
function adminLoadData($reload = false) {
    static $cache = null;
    if ($cache !== null && !$reload) return $cache;
    $cache = cpydes_json_load(DATA_FILE, ['categories' => [], 'items' => []]);
    // 合并 library_settings（含 copyReminder 等配置），与前台 loadData() 保持一致
    // 避免 getAll 未返回 settings 导致编辑器无法获取文案失效配置
    $settings = function_exists('loadLibrarySettings') ? loadLibrarySettings($reload) : [];
    // 归一化 copyReminder，确保字段类型和默认值正确（与 getLibrarySettings 接口一致）
    if (function_exists('normalizeCopyReminderConfig')) {
        $settings['copyReminder'] = normalizeCopyReminderConfig($settings['copyReminder'] ?? []);
    }
    $cache['settings'] = $settings;
    return $cache;
}

/**
 * 从文案内容中提取所有被引用的图片路径（相对路径，如 img/xxx.png）
 */
function collectReferencedImages($items) {
    $referenced = [];
    foreach ($items as $item) {
        if (empty($item['content'])) continue;
        // 匹配 src="img/..." 或 src='img/...'
        if (preg_match_all('/src=["\'](img\/[^"\'\\\\]+)["\']/i', $item['content'], $matches)) {
            foreach ($matches[1] as $p) {
                $normalized = str_replace('\\', '/', $p);
                $referenced[$normalized] = true;
            }
        }
    }
    return $referenced;
}

/**
 * 递归扫描 img/ 目录（兼容 glob，与主站一致）
 */
function scanImageDir() {
    $files = [];
    if (!is_dir(IMG_DIR)) return $files;
    $patterns = [
        IMG_DIR . '/*',
        IMG_DIR . '/*/*',
        IMG_DIR . '/*/*/*',
    ];
    foreach ($patterns as $pattern) {
        $matched = glob($pattern) ?: [];
        foreach ($matched as $f) {
            if (is_file($f)) $files[] = $f;
        }
    }
    return $files;
}

/**
 * 格式化文件大小
 */
function formatBytes($bytes) {
    return cpydes_format_bytes($bytes);
}

/**
 * 原子化保存数据文件（委托共享库；失败时保留原文件）
 * 大 JSON 不使用 PRETTY_PRINT，减小体积与解析开销（与前台 api.php 一致）
 */
function adminSaveData($data) {
    $ok = cpydes_json_save_atomic(DATA_FILE, $data, JSON_UNESCAPED_UNICODE);
    if ($ok) adminLoadData(true); // 刷新请求级缓存
    return $ok;
}

/**
 * 安全生成图片文件名（时间戳 + 随机串）
 */
function generateSecureFilename($ext) {
    return 'img_' . time() . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
}

/**
 * 剥离 SVG 中的脚本和危险属性（委托共享库的更强实现）
 */
function stripSvgScripts($svgContent) {
    return cpydes_strip_svg_scripts($svgContent);
}

/**
 * 校验图片真实 MIME 类型
 */
function verifyImageMime($filepath, $ext) {
    if (!function_exists('finfo_open')) return false;
    $mimeMap = [
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'svg' => 'image/svg+xml',
    ];
    if (!isset($mimeMap[$ext])) return false;

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $actualMime = finfo_file($finfo, $filepath);
    finfo_close($finfo);

    if ($ext === 'svg') {
        return $actualMime === 'image/svg+xml' || $actualMime === 'text/xml' || $actualMime === 'application/xml';
    }

    return $actualMime === $mimeMap[$ext];
}

/**
 * 安全验证颜色值，只允许 #hex 和 rgb() 格式
 */
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

/**
 * 递归验证分类数据，清除非法字段和验证颜色值
 */
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
 * 规范化查重策略配置，合并默认值
 */
function normalizeDedupConfig($cfg) {
    $defaults = [
        'enabled' => true,
        'ngramSize' => 6,
        'threshold' => 15,
        'minTextLength' => 12,
    ];
    if (!is_array($cfg)) $cfg = [];
    $clampInt = function($v, $def, $min, $max) {
        $v = (int)$v;
        if (!is_int($v) || $v < $min) return $def;
        if ($v > $max) return $max;
        return $v;
    };
    return [
        'enabled' => is_bool($cfg['enabled'] ?? null) ? $cfg['enabled'] : $defaults['enabled'],
        'ngramSize' => $clampInt($cfg['ngramSize'] ?? $defaults['ngramSize'], $defaults['ngramSize'], 2, 16),
        'threshold' => $clampInt($cfg['threshold'] ?? $defaults['threshold'], $defaults['threshold'], 1, 500),
        'minTextLength' => $clampInt($cfg['minTextLength'] ?? $defaults['minTextLength'], $defaults['minTextLength'], 1, 200),
    ];
}

/**
 * 规范化「复制文案时效提醒」策略配置，合并默认值
 * - enabled: 总开关
 * - strategy: always(每次复制都提醒) | aged(按文案时效阈值提醒)
 * - thresholdDays: aged 策略下距 updatedAt 超过该天数才触发
 * - message: 后台可控提示语（最长 200 字，前端 escapeHtml 渲染）
 * - displayMode: toast | modal
 * - duration: toast 停留毫秒数
 * - showUpdatedAt: 是否在提醒中附「文案最后更新时间」
 * - textColor: 提示文字颜色（空=跟随主题默认；只允许 #hex 与 rgb()/rgba() 格式，防 CSS 注入）
 * - fontSize: 提示文字字号 px（0=跟随默认；范围 11-24）
 */
function normalizeCopyReminderConfig($cfg) {
    $defaults = [
        'enabled' => false,
        'strategy' => 'aged',
        'thresholdDays' => 30,
        'message' => '此文案可能因活动过期或内容变更而失效，使用前请核对并按需修改。',
        'displayMode' => 'toast',
        'duration' => 5000,
        'showUpdatedAt' => true,
        'textColor' => '',
        'fontSize' => 0,
    ];
    if (!is_array($cfg)) $cfg = [];

    $strategy = isset($cfg['strategy']) && in_array($cfg['strategy'], ['always', 'aged'], true)
        ? $cfg['strategy'] : $defaults['strategy'];
    $displayMode = isset($cfg['displayMode']) && in_array($cfg['displayMode'], ['toast', 'modal'], true)
        ? $cfg['displayMode'] : $defaults['displayMode'];

    $message = isset($cfg['message']) && is_string($cfg['message']) ? trim($cfg['message']) : '';
    if ($message === '') $message = $defaults['message'];
    // 截断 200 字（UTF-8 安全）
    if (function_exists('mb_strlen') && mb_strlen($message, 'UTF-8') > 200) {
        $message = mb_substr($message, 0, 200, 'UTF-8');
    } elseif (strlen($message) > 600) {
        $message = substr($message, 0, 600);
    }

    // 颜色值仅允许 #hex 与 rgb()/rgba()，防 style 注入（与前端 sanitizeColor 一致）
    $textColor = '';
    if (isset($cfg['textColor']) && is_string($cfg['textColor'])) {
        $c = trim($cfg['textColor']);
        if ($c !== '' && preg_match('/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/', $c)
            || preg_match('/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i', $c)) {
            $textColor = $c;
        }
    }

    $clampInt = function($v, $def, $min, $max) {
        $v = (int)$v;
        if (!is_int($v) || $v < $min) return $def;
        if ($v > $max) return $max;
        return $v;
    };
    // fontSize=0 表示跟随默认（不覆盖）
    $fontSizeRaw = isset($cfg['fontSize']) ? (int)$cfg['fontSize'] : 0;
    $fontSize = ($fontSizeRaw === 0) ? 0 : $clampInt($fontSizeRaw, 0, 11, 24);

    return [
        'enabled' => is_bool($cfg['enabled'] ?? null) ? $cfg['enabled'] : $defaults['enabled'],
        'strategy' => $strategy,
        'thresholdDays' => $clampInt($cfg['thresholdDays'] ?? $defaults['thresholdDays'], $defaults['thresholdDays'], 1, 365),
        'message' => $message,
        'displayMode' => $displayMode,
        'duration' => $clampInt($cfg['duration'] ?? $defaults['duration'], $defaults['duration'], 2000, 60000),
        'showUpdatedAt' => is_bool($cfg['showUpdatedAt'] ?? null) ? $cfg['showUpdatedAt'] : $defaults['showUpdatedAt'],
        'textColor' => $textColor,
        'fontSize' => $fontSize,
    ];
}

/**
 * 加载用户数据（委托共享库，含请求级缓存）
 */
function loadUsers() {
    return cpydes_load_users();
}

/**
 * 保存用户数据（原子写入，失败时保留原文件）
 */
function saveUsers($data) {
    $ok = cpydes_json_save_atomic(USERS_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($ok) cpydes_load_users(true); // 刷新请求级缓存
    return $ok;
}

/**
 * 加载分享数据
 */
function loadShares() {
    return cpydes_json_load(SHARES_FILE, ['shares' => []]);
}

/**
 * 原子化保存分享数据（失败时保留原文件）
 */
function saveShares($data) {
    return cpydes_json_save_atomic(SHARES_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

/**
 * 获取分享操作的排他锁（串行化创建/撤销等写操作，防止并发覆盖）
 */
function acquireSharesLock() {
    return cpydes_lock_acquire(SHARES_LOCK_FILE);
}

/**
 * 释放分享操作锁
 */
function releaseSharesLock($fp) {
    cpydes_lock_release($fp);
}

/**
 * 构建分享 URL（admin 位于子目录，需上溯一层到站点根）
 */
function buildShareUrl($token) {
    $scheme = 'http';
    if (
        (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
        (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https')
    ) {
        $scheme = 'https';
    }
    $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? 'localhost';
    // admin/api.php 位于 {base}/admin/，需上溯到 {base}
    $base = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\');
    return $scheme . '://' . $host . $base . '/share.php?token=' . $token;
}