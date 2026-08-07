<?php
/**
 * Cpydes 共享库：实时同步版本与配置
 *
 * 设计说明：
 * - 各数据类型独立存储文件（content=copywriting.json / settings=library_settings.json
 *   / shares=shares.json / announcements=announcements.json / drive=drive.json）
 * - 直接以文件 mtime 作为版本号：写盘即自动变更，无需在保存函数埋点，零侵入
 * - 前端轮询 getSyncVersion（仅 stat 5 个文件，超轻量），对比 mtime 变化后按类型增量拉取
 * - 同步开关与间隔存于 library_settings.sync = {enabled, interval}
 *
 * 无副作用（不输出、不启动 session），可被任意入口安全 require
 */

if (!defined('CPYDES_SITE_ROOT')) {
    define('CPYDES_SITE_ROOT', dirname(__DIR__) . DIRECTORY_SEPARATOR);
}

/**
 * 取得某数据文件路径（优先用入口已定义的常量，未定义时按 DATA_FILE 目录推导）
 * @param string $type content|settings|shares|announcements|drive
 * @return string
 */
function cpydes_sync_file_for($type) {
    switch ($type) {
        case 'content':
            return defined('DATA_FILE') ? DATA_FILE : CPYDES_SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'copywriting.json';
        case 'settings':
            return defined('LIBRARY_SETTINGS_FILE')
                ? LIBRARY_SETTINGS_FILE
                : CPYDES_SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'library_settings.json';
        case 'shares':
            return defined('SHARES_FILE')
                ? SHARES_FILE
                : CPYDES_SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'shares.json';
        case 'announcements':
            return defined('ANNOUNCEMENTS_FILE')
                ? ANNOUNCEMENTS_FILE
                : CPYDES_SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'announcements.json';
        case 'drive':
            return defined('DRIVE_FILE')
                ? DRIVE_FILE
                : CPYDES_SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'drive.json';
    }
    return '';
}

if (!function_exists('cpydes_get_sync_version')) {
    /**
     * 读取各数据类型的版本号（= 文件 mtime，文件不存在返回 0）
     * 清理 stat 缓存确保拿到最新 mtime（同一请求内多次调用也准确）
     * @return array {content, settings, shares, announcements, drive}
     */
    function cpydes_get_sync_version() {
        $out = [];
        foreach (['content', 'settings', 'shares', 'announcements', 'drive'] as $type) {
            $file = cpydes_sync_file_for($type);
            clearstatcache(true, $file);
            $out[$type] = $file !== '' && file_exists($file) ? (int)@filemtime($file) : 0;
        }
        return $out;
    }
}

if (!function_exists('cpydes_get_sync_config')) {
    /**
     * 读取实时同步配置（library_settings.sync）
     * @return array {enabled: bool, interval: int}
     */
    function cpydes_get_sync_config() {
        $cfg = ['enabled' => false, 'interval' => 5];
        if (function_exists('loadLibrarySettings')) {
            $settings = loadLibrarySettings();
            if (isset($settings['sync']) && is_array($settings['sync'])) {
                $sync = $settings['sync'];
                if (isset($sync['enabled'])) $cfg['enabled'] = !empty($sync['enabled']);
                if (isset($sync['interval'])) {
                    $i = (int)$sync['interval'];
                    // 间隔范围 2~300 秒，避免过小打爆服务器或过大失去意义
                    if ($i < 2) $i = 2;
                    if ($i > 300) $i = 300;
                    $cfg['interval'] = $i;
                }
            }
        }
        return $cfg;
    }
}
