<?php
/**
 * Cpydes 共享库：弹窗公告存储
 *
 * 说明：
 * - 无副作用（不输出、不启动 session），可被任意入口安全 require
 * - 数据文件路径基于 ANNOUNCEMENTS_FILE 常量（由入口定义），未定义时兜底推导
 * - 遵循 lib/settings.php 的独立小文件模式，避免污染业务数据文件
 *
 * 数据结构（data/announcements.json）：
 * {
 *   "announcements": [
 *     {
 *       "id": "ann_xxxxxxxxxxxx",
 *       "title": "公告标题",
 *       "content": "公告正文（纯文本，前端按换行渲染）",
 *       "type": "info",            // info | success | warning | error
 *       "enabled": true,            // 是否启用
 *       "dismissible": true,        // 前台是否允许关闭
 *       "closeBehavior": "permanent", // permanent | session（关闭后行为）
 *                                    //   permanent: 永久不再提醒（写入 localStorage 已读记录）
 *                                    //   session: 仅本会话不再弹，刷新页面后再次提醒（仅 sessionStorage）
 *       "audience": "all",          // all | guests | users（展示对象）
 *       "startAt": null,            // ISO 时间，null 表示立即生效
 *       "endAt": null,              // ISO 时间，null 表示长期有效
 *       "version": 1,               // 内容版本号，每次修改自增（前台据此判断"已读"是否失效）
 *       "createdAt": "...",
 *       "updatedAt": "...",
 *       "createdBy": "userId",
 *       "createdByName": "username"
 *     }
 *   ]
 * }
 */

if (!defined('CPYDES_SITE_ROOT')) {
    define('CPYDES_SITE_ROOT', dirname(__DIR__) . DIRECTORY_SEPARATOR);
}
if (!defined('ANNOUNCEMENTS_FILE')) {
    define('ANNOUNCEMENTS_FILE', CPYDES_SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'announcements.json');
}

if (!function_exists('cpydes_load_announcements')) {
    /**
     * 加载全部公告（请求级缓存）
     * @param bool $reload 强制重新读取
     * @return array ['announcements' => [...]]
     */
    function cpydes_load_announcements($reload = false) {
        static $cache = null;
        if ($cache !== null && !$reload) return $cache;
        $cache = cpydes_json_load(ANNOUNCEMENTS_FILE, ['announcements' => []]);
        if (!isset($cache['announcements']) || !is_array($cache['announcements'])) {
            $cache['announcements'] = [];
        }
        return $cache;
    }
}

if (!function_exists('cpydes_save_announcements')) {
    /**
     * 原子化保存全部公告
     * @param array $announcements
     * @return bool
     */
    function cpydes_save_announcements(array $announcements) {
        $data = ['announcements' => array_values($announcements)];
        $ok = cpydes_json_save_atomic(ANNOUNCEMENTS_FILE, $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if ($ok) cpydes_load_announcements(true);
        return $ok;
    }
}

if (!function_exists('cpydes_generate_announcement_id')) {
    /**
     * 生成公告 ID（ann_ + 12 位十六进制）
     * @return string
     */
    function cpydes_generate_announcement_id() {
        return 'ann_' . bin2hex(random_bytes(6));
    }
}

if (!function_exists('cpydes_normalize_announcement')) {
    /**
     * 规范化公告字段（白名单 + 类型修正），用于入库前清洗
     * @param array $input
     * @param array $existing 已存在的记录（更新时合并）
     * @return array
     */
    function cpydes_normalize_announcement(array $input, array $existing = []) {
        $ann = $existing;
        // 标题：去首尾空白，最长 100 字
        if (isset($input['title'])) {
            $title = trim((string)$input['title']);
            if (function_exists('mb_substr') && mb_strlen($title, 'UTF-8') > 100) {
                $title = mb_substr($title, 0, 100, 'UTF-8');
            }
            $ann['title'] = $title;
        }
        // 内容：最长 5000 字
        if (isset($input['content'])) {
            $content = (string)$input['content'];
            if (function_exists('mb_substr') && mb_strlen($content, 'UTF-8') > 5000) {
                $content = mb_substr($content, 0, 5000, 'UTF-8');
            }
            $ann['content'] = $content;
        }
        // 类型：白名单
        if (isset($input['type'])) {
            $type = (string)$input['type'];
            $ann['type'] = in_array($type, ['info', 'success', 'warning', 'error'], true) ? $type : 'info';
        }
        // 布尔字段
        foreach (['enabled', 'dismissible'] as $boolKey) {
            if (isset($input[$boolKey])) {
                $ann[$boolKey] = !empty($input[$boolKey]);
            }
        }
        // 关闭行为：permanent（永久不再提醒）| session（仅本会话不弹，刷新后再次提醒）
        if (isset($input['closeBehavior'])) {
            $cb = (string)$input['closeBehavior'];
            $ann['closeBehavior'] = in_array($cb, ['permanent', 'session'], true) ? $cb : 'permanent';
        }
        // 受众：白名单
        if (isset($input['audience'])) {
            $audience = (string)$input['audience'];
            $ann['audience'] = in_array($audience, ['all', 'guests', 'users'], true) ? $audience : 'all';
        }
        // 时间字段：空字符串视为 null（立即生效/长期有效）
        foreach (['startAt', 'endAt'] as $timeKey) {
            if (array_key_exists($timeKey, $input)) {
                $v = $input[$timeKey];
                if ($v === '' || $v === null) {
                    $ann[$timeKey] = null;
                } else {
                    $ts = strtotime((string)$v);
                    $ann[$timeKey] = $ts !== false ? date('c', $ts) : null;
                }
            }
        }
        return $ann;
    }
}

if (!function_exists('cpydes_is_announcement_active')) {
    /**
     * 判断公告在当前时间是否处于有效期
     * @param array $ann
     * @param int|null $now 当前时间戳（测试用）
     * @return bool
     */
    function cpydes_is_announcement_active(array $ann, $now = null) {
        if (empty($ann['enabled'])) return false;
        $now = $now !== null ? (int)$now : time();
        if (!empty($ann['startAt'])) {
            $start = strtotime($ann['startAt']);
            if ($start !== false && $now < $start) return false;
        }
        if (!empty($ann['endAt'])) {
            $end = strtotime($ann['endAt']);
            if ($end !== false && $now > $end) return false;
        }
        return true;
    }
}

if (!function_exists('cpydes_filter_announcements_for_user')) {
    /**
     * 按当前访客身份过滤公告（受众匹配 + 有效期）
     * @param array $announcements 全部公告
     * @param bool $isLoggedIn 当前是否为登录用户
     * @return array
     */
    function cpydes_filter_announcements_for_user(array $announcements, $isLoggedIn) {
        $now = time();
        $out = [];
        foreach ($announcements as $ann) {
            if (!cpydes_is_announcement_active($ann, $now)) continue;
            $audience = isset($ann['audience']) ? $ann['audience'] : 'all';
            if ($audience === 'users' && !$isLoggedIn) continue;
            if ($audience === 'guests' && $isLoggedIn) continue;
            $out[] = $ann;
        }
        return $out;
    }
}

if (!function_exists('cpydes_public_announcement_payload')) {
    /**
     * 将公告裁剪为前台可暴露的字段（剔除管理元数据）
     * @param array $ann
     * @return array
     */
    function cpydes_public_announcement_payload(array $ann) {
        return [
            'id'            => $ann['id'] ?? '',
            'title'         => $ann['title'] ?? '',
            'content'       => $ann['content'] ?? '',
            'type'          => isset($ann['type']) ? $ann['type'] : 'info',
            'dismissible'   => isset($ann['dismissible']) ? (bool)$ann['dismissible'] : true,
            'closeBehavior' => isset($ann['closeBehavior']) ? $ann['closeBehavior'] : 'permanent',
            'audience'      => isset($ann['audience']) ? $ann['audience'] : 'all',
            'version'       => isset($ann['version']) ? (int)$ann['version'] : 1,
            'startAt'       => isset($ann['startAt']) ? $ann['startAt'] : null,
            'endAt'         => isset($ann['endAt']) ? $ann['endAt'] : null,
            'updatedAt'     => isset($ann['updatedAt']) ? $ann['updatedAt'] : null,
        ];
    }
}
