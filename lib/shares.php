<?php
// 由 api.php 机械拆分而来（分享数据/锁/收藏/分享 token 与 URL），仅供 api.php 引入
if (!defined('DATA_FILE')) { http_response_code(403); exit; }

/**
 * 加载分享数据
 */
function loadShares() {
    return cpydes_json_load(SHARES_FILE, ['shares' => []]);
}

function saveShares($data) {
    return saveJsonFile(SHARES_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

/**
 * 获取分享操作的排他锁（用于串行化创建/撤销等写操作）
 * 防止并发请求互相覆盖数据
 * @return resource|false 锁文件句柄（使用后需调用 releaseSharesLock 释放）
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
 * 加载收藏数据（按用户ID隔离）
 * @return array 结构 ['favorites' => [userId => [itemId, ...]]]
 */
function loadFavorites() {
    return cpydes_json_load(FAVORITES_FILE, ['favorites' => []]);
}

/**
 * 原子化保存收藏数据（通用 saveJsonFile 复用）
 */
function saveFavoritesData($data) {
    return saveJsonFile(FAVORITES_FILE, $data, JSON_UNESCAPED_UNICODE);
}

/**
 * 获取收藏写入排他锁
 */
function acquireFavoritesLock() {
    return cpydes_lock_acquire(FAVORITES_LOCK_FILE);
}

/**
 * 释放收藏写入锁
 */
function releaseFavoritesLock($fp) {
    cpydes_lock_release($fp);
}

/**
 * 清洗收藏数据：去重、仅保留字符串 ID、限制单用户最大数量
 */
function sanitizeFavoritesIds($ids) {
    if (!is_array($ids)) return [];
    $seen = [];
    $result = [];
    $maxCount = 5000; // 单用户上限，防止滥用
    foreach ($ids as $id) {
        if (is_string($id) && $id !== '' && !isset($seen[$id])) {
            $seen[$id] = true;
            $result[] = substr($id, 0, 100);
            if (count($result) >= $maxCount) break;
        }
    }
    return $result;
}

/**
 * 生成唯一的分享 token（24 字符 base62 随机串）
 * @param array|null $existingShares 已加载的分享数据，避免重复 IO；为 null 时内部加载
 */
function generateShareToken($existingShares = null) {
    return cpydes_generate_share_token($existingShares);
}

/**
 * 构建分享 URL（健壮处理反代/HTTPS/子目录）
 */
function buildShareUrl($token) {
    // 协议：处理反代 HTTPS
    $scheme = 'http';
    if (
        (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
        (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https')
    ) {
        $scheme = 'https';
    }
    // 主机名
    $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? 'localhost';
    // 基础路径：优先用 SCRIPT_NAME 推导（最可靠）
    $base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\');
    return $scheme . '://' . $host . $base . '/share.php?token=' . $token;
}
