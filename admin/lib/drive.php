<?php
// 由 admin/api.php 机械拆分而来，网盘数据管理；仅供 admin/api.php 引入
if (!defined('SITE_ROOT')) { http_response_code(403); exit; }

/* ========== 网盘数据管理 ========== */

function loadDriveData() {
    $data = cpydes_json_load(DRIVE_FILE, ['files' => [], 'shares' => [], 'settings' => []]);
    if (empty($data['settings'])) $data['settings'] = getDefaultDriveSettings();
    return $data;
}

function getDefaultDriveSettings() {
    return [
        'allowedExts' => '*', // '*' 表示允许所有（除阻止列表外），或数组如 ['pdf','doc','docx','xls','xlsx','ppt','pptx','zip','rar','7z','txt','csv','jpg','png','gif','mp4','mp3']
        'maxFileSize' => 100, // MB
    ];
}

function saveDriveData($data) {
    return cpydes_json_save_atomic(DRIVE_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

function collectFolderFileIds($files, $folderId) {
    $ids = [];
    $folder = null;
    foreach ($files as $f) {
        if ($f['id'] === $folderId) { $folder = $f; break; }
    }
    if (!$folder || $folder['type'] !== 'folder') return [$folderId];
    $ids[] = $folderId;
    if (!empty($folder['children'])) {
        // 性能优化：使用引用追加而非 array_merge，避免 O(n²) 复杂度
        foreach ($folder['children'] as $cid) {
            foreach (collectFolderFileIds($files, $cid) as $cid2) {
                $ids[] = $cid2;
            }
        }
    }
    return $ids;
}

/**
 * 生成唯一的分享 token（24 字符 base62 随机串）
 * @param array|null $existingShares 已加载的分享数据，避免重复 IO；为 null 时直接生成（调用方应在锁内保证唯一性）
 */
function generateShareToken($existingShares = null) {
    return cpydes_generate_share_token($existingShares);
}

/**
 * 解析 PHP size 字符串（如 "128M", "1G"）为字节数
 */
function parsePhpSize($size) {
    if (empty($size)) return 0;
    $size = trim($size);
    if ($size === '-1') return -1; // 无限制
    $val = (int)$size;
    if ($val <= 0) return 0;
    $last = strtolower(substr($size, -1));
    switch ($last) {
        case 'g': $val *= 1024 * 1024 * 1024; break;
        case 'm': $val *= 1024 * 1024; break;
        case 'k': $val *= 1024; break;
    }
    return $val;
}