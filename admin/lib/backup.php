<?php
// 由 admin/api.php 机械拆分而来，服务器备份管理；仅供 admin/api.php 引入
if (!defined('SITE_ROOT')) { http_response_code(403); exit; }

// ============ 服务器备份管理 ============

/**
 * 确保备份目录存在
 */
function ensureBackupsDir() {
    if (!is_dir(BACKUPS_DIR)) {
        @mkdir(BACKUPS_DIR, 0755, true);
    }
    // 保护备份目录：创建 .htaccess 防止直接访问
    $htaccess = BACKUPS_DIR . DIRECTORY_SEPARATOR . '.htaccess';
    if (!file_exists($htaccess)) {
        @file_put_contents($htaccess, "Deny from all\n");
    }
}

/**
 * 获取备份列表（按时间倒序）
 */
function listServerBackups() {
    ensureBackupsDir();
    $backups = [];
    $files = glob(BACKUPS_DIR . DIRECTORY_SEPARATOR . 'backup_*.json') ?: [];
    foreach ($files as $filepath) {
        $basename = basename($filepath);
        $size = @filesize($filepath);
        $mtime = @filemtime($filepath);
        // 只读取文件开头部分获取元数据，避免大文件占用内存
        $meta = [];
        $fp = @fopen($filepath, 'r');
        if ($fp) {
            $head = fread($fp, 4096);
            fclose($fp);
            // 尝试从头部提取元数据字段
            if (preg_match('/"createdAt"\s*:\s*"([^"]+)"/', $head, $m)) $meta['createdAt'] = $m[1];
            if (preg_match('/"itemCount"\s*:\s*(\d+)/', $head, $m)) $meta['itemCount'] = (int)$m[1];
            if (preg_match('/"categoryCount"\s*:\s*(\d+)/', $head, $m)) $meta['categoryCount'] = (int)$m[1];
            if (preg_match('/"imageCount"\s*:\s*(\d+)/', $head, $m)) $meta['imageCount'] = (int)$m[1];
            if (preg_match('/"hasImages"\s*:\s*(true|false)/', $head, $m)) $meta['hasImages'] = $m[1] === 'true';
            if (preg_match('/"createdBy"\s*:\s*"([^"]*)"/', $head, $m)) $meta['createdBy'] = $m[1];
            if (preg_match('/"note"\s*:\s*"([^"]*)"/', $head, $m)) $meta['note'] = $m[1];
        }
        $backups[] = [
            'id' => $basename,
            'filename' => $basename,
            'size' => $size,
            'sizeText' => formatBytes($size),
            'createdAt' => isset($meta['createdAt']) ? $meta['createdAt'] : date('c', $mtime),
            'itemCount' => isset($meta['itemCount']) ? $meta['itemCount'] : 0,
            'categoryCount' => isset($meta['categoryCount']) ? $meta['categoryCount'] : 0,
            'imageCount' => isset($meta['imageCount']) ? $meta['imageCount'] : 0,
            'hasImages' => isset($meta['hasImages']) ? $meta['hasImages'] : false,
            'createdBy' => isset($meta['createdBy']) ? $meta['createdBy'] : '',
            'note' => isset($meta['note']) ? $meta['note'] : '',
        ];
    }
    // 按创建时间倒序
    usort($backups, function($a, $b) {
        return strcmp($b['createdAt'], $a['createdAt']);
    });
    return $backups;
}

/**
 * 创建服务器端备份
 * @param bool $includeImages 是否包含图片
 * @param string $note 备份备注
 * @return array 结果
 */
function createServerBackup($includeImages = true, $note = '') {
    ensureBackupsDir();
    ini_set('memory_limit', '512M');
    set_time_limit(120);

    $data = adminLoadData();
    $currentUser = getCurrentUser();
    $timestamp = date('Ymd_His');
    $randomSuffix = substr(bin2hex(random_bytes(2)), 0, 4);
    $filename = "backup_{$timestamp}_{$randomSuffix}.json";

    $backup = [
        'version' => '2.0',
        'createdAt' => date('c'),
        'app' => 'Cpydes 文案库',
        'createdBy' => $currentUser ? $currentUser['username'] : '',
        'note' => $note,
        'itemCount' => count($data['items']),
        'categoryCount' => count($data['categories']),
        'hasImages' => $includeImages,
        'data' => $data,
        'images' => [],
        'imageCount' => 0,
    ];

    if ($includeImages && is_dir(IMG_DIR)) {
        $files = array_merge(
            glob(IMG_DIR . '/*') ?: [],
            glob(IMG_DIR . '/*/*') ?: [],
            glob(IMG_DIR . '/*/*/*') ?: []
        );
        $images = [];
        foreach ($files as $filepath) {
            if (is_dir($filepath)) continue;
            $relPath = str_replace('\\', '/', substr($filepath, strlen(SITE_ROOT)));
            $imgData = @file_get_contents($filepath);
            if ($imgData !== false && strlen($imgData) > 0) {
                $ext = strtolower(pathinfo($filepath, PATHINFO_EXTENSION));
                $mimeMap = ['png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg',
                            'gif'=>'image/gif','webp'=>'image/webp','svg'=>'image/svg+xml'];
                $mime = isset($mimeMap[$ext]) ? $mimeMap[$ext] : 'application/octet-stream';
                $images[$relPath] = 'data:' . $mime . ';base64,' . base64_encode($imgData);
            }
        }
        $backup['images'] = $images;
        $backup['imageCount'] = count($images);
    }

    // 同时备份用户和分享数据（走带兜底的加载器，避免解析失败写入 null）
    $backup['users'] = loadUsers();
    $backup['shares'] = loadShares();

    $filepath = BACKUPS_DIR . DIRECTORY_SEPARATOR . $filename;
    $json = json_encode($backup, JSON_UNESCAPED_UNICODE);
    if (file_put_contents($filepath, $json, LOCK_EX) === false) {
        return ['success' => false, 'error' => '备份文件写入失败'];
    }

    // 更新 .last_backup 时间戳
    @file_put_contents(BACKUPS_DIR . DIRECTORY_SEPARATOR . '.last_backup', time(), LOCK_EX);

    return [
        'success' => true,
        'backupId' => $filename,
        'size' => filesize($filepath),
        'sizeText' => formatBytes(filesize($filepath)),
        'itemCount' => $backup['itemCount'],
        'categoryCount' => $backup['categoryCount'],
        'imageCount' => $backup['imageCount'],
    ];
}

/**
 * 从服务器端备份恢复
 * @param string $backupId 备份文件名
 * @param bool $restoreImages 是否恢复图片
 * @param bool $restoreUsers 是否恢复用户数据
 * @param bool $restoreShares 是否恢复分享数据
 * @return array 结果
 */
function restoreServerBackup($backupId, $restoreImages = true, $restoreUsers = false, $restoreShares = false) {
    // 安全检查文件名
    $backupId = basename($backupId);
    if (!preg_match('/^backup_\d{8}_\d{6}_[a-zA-Z0-9]{4}\.json$/', $backupId)) {
        return ['success' => false, 'error' => '无效的备份文件名'];
    }
    $filepath = BACKUPS_DIR . DIRECTORY_SEPARATOR . $backupId;
    if (!file_exists($filepath)) {
        return ['success' => false, 'error' => '备份文件不存在'];
    }

    ini_set('memory_limit', '512M');
    set_time_limit(120);

    $backup = @json_decode(file_get_contents($filepath), true);
    if (!$backup || !isset($backup['data'])) {
        return ['success' => false, 'error' => '备份文件格式不正确'];
    }

    // 恢复文案数据
    $backupData = $backup['data'];
    if (!is_array($backupData) || !isset($backupData['items']) || !isset($backupData['categories'])) {
        return ['success' => false, 'error' => '备份数据结构不正确'];
    }
    if (isset($backupData['categories'])) {
        $backupData['categories'] = sanitizeCategories($backupData['categories']);
    }
    adminSaveData($backupData);

    $restoredImages = 0;
    // 恢复图片
    if ($restoreImages && isset($backup['images']) && is_array($backup['images'])) {
        $imgDir = realpath(IMG_DIR);
        $allowedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
        if (!is_dir(IMG_DIR)) {
            @mkdir(IMG_DIR, 0755, true);
        }
        foreach ($backup['images'] as $relPath => $base64Data) {
            if (strpos($relPath, 'img/') !== 0) continue;
            if (strpos($relPath, '..') !== false) continue;
            $ext = strtolower(pathinfo($relPath, PATHINFO_EXTENSION));
            if (!in_array($ext, $allowedExts, true)) continue;

            if (preg_match('/^data:image\/(\w+);base64,(.+)$/s', $base64Data, $matches)) {
                $imgBin = base64_decode($matches[2]);
                if ($imgBin) {
                    $destPath = SITE_ROOT . str_replace('/', DIRECTORY_SEPARATOR, $relPath);
                    $dir = dirname($destPath);
                    if (!is_dir($dir)) {
                        @mkdir($dir, 0755, true);
                    }
                    $realDirPath = realpath($dir);
                    if ($realDirPath === false) continue;
                    $realFilePath = $realDirPath . DIRECTORY_SEPARATOR . basename($destPath);
                    // 安全修复：追加 DIRECTORY_SEPARATOR 防止前缀混淆（如 /site/img 与 /site/img-secret）
                    if ($imgDir && $realFilePath !== $imgDir && strpos($realFilePath, $imgDir . DIRECTORY_SEPARATOR) !== 0) continue;
                    @file_put_contents($destPath, $imgBin);
                    $restoredImages++;
                }
            }
        }
    }

    // 恢复用户数据
    $restoredUsers = false;
    if ($restoreUsers && isset($backup['users']) && is_array($backup['users'])) {
        saveUsers($backup['users']);
        $restoredUsers = true;
    }

    // 恢复分享数据
    $restoredShares = false;
    if ($restoreShares && isset($backup['shares']) && is_array($backup['shares'])) {
        saveShares($backup['shares']);
        $restoredShares = true;
    }

    return [
        'success' => true,
        'restoredImages' => $restoredImages,
        'restoredUsers' => $restoredUsers,
        'restoredShares' => $restoredShares,
        'itemCount' => count($backupData['items']),
        'categoryCount' => count($backupData['categories']),
    ];
}

/**
 * 删除服务器端备份
 */
function deleteServerBackup($backupId) {
    $backupId = basename($backupId);
    if (!preg_match('/^backup_\d{8}_\d{6}_[a-zA-Z0-9]{4}\.json$/', $backupId)) {
        return ['success' => false, 'error' => '无效的备份文件名'];
    }
    $filepath = BACKUPS_DIR . DIRECTORY_SEPARATOR . $backupId;
    if (!file_exists($filepath)) {
        return ['success' => false, 'error' => '备份文件不存在'];
    }
    if (@unlink($filepath)) {
        return ['success' => true];
    }
    return ['success' => false, 'error' => '删除失败，请检查文件权限'];
}