<?php
/**
 * Cpydes 共享库：通用辅助函数
 *
 * 说明：
 * - 无副作用（不输出、不启动 session），可被任意入口安全 require
 * - 含 mb_* 降级 polyfill、SVG 清洗、分享 token 生成、字节格式化、时区初始化
 */

// 为未启用 mbstring 扩展的环境提供降级 polyfill
if (!function_exists('mb_strlen')) {
    function mb_strlen($str, $encoding = 'UTF-8') {
        if (function_exists('iconv_strlen')) {
            return @iconv_strlen($str, $encoding);
        }
        return strlen($str);
    }
}
if (!function_exists('mb_substr')) {
    function mb_substr($str, $start, $length = null, $encoding = 'UTF-8') {
        if (function_exists('iconv_substr')) {
            return @iconv_substr($str, $start, $length, $encoding);
        }
        $cut = substr($str, $start, $length);
        $cut = preg_replace('/[\x80-\xBF]+$/', '', $cut);
        if (preg_match('/[\xC0-\xFF]$/', $cut)) {
            $cut = substr($cut, 0, -1);
        }
        return $cut;
    }
}

if (!function_exists('cpydes_timezone_init')) {
    /**
     * 显式设置时区（从环境变量 APP_TIMEZONE 读取，默认 Asia/Shanghai）
     * 消除各入口时区不一致导致的日志/统计时间偏差
     */
    function cpydes_timezone_init() {
        $tz = getenv('APP_TIMEZONE') ?: 'Asia/Shanghai';
        if (!@date_default_timezone_set($tz)) {
            date_default_timezone_set('Asia/Shanghai');
        }
    }
}

if (!function_exists('cpydes_strip_svg_scripts')) {
    /**
     * 剥离 SVG 中的脚本和危险属性（取两处旧实现的强度并集）
     * @param string $svgContent
     * @return string
     */
    function cpydes_strip_svg_scripts($svgContent) {
        // 移除 <script> 标签及内容
        $svgContent = preg_replace('/<script[^>]*>.*?<\/script>/is', '', $svgContent);
        // 移除 <foreignObject> 标签及内容（可嵌入 HTML/JS）
        $svgContent = preg_replace('/<foreignObject[^>]*>.*?<\/foreignObject>/is', '', $svgContent);
        // 移除所有 on* 事件属性（双引号 / 单引号 / 无引号）
        $svgContent = preg_replace('/\son\w+\s*=\s*"[^"]*"/i', '', $svgContent);
        $svgContent = preg_replace("/\son\w+\s*=\s*'[^']*'/i", '', $svgContent);
        $svgContent = preg_replace('/\son\w+\s*=\s*[^\s>]+/i', '', $svgContent);
        // 移除 javascript: 伪协议
        $svgContent = preg_replace('/javascript\s*:/i', '', $svgContent);
        return $svgContent;
    }
}

if (!function_exists('cpydes_generate_share_token')) {
    /**
     * 生成唯一的分享 token（24 字符 base62 随机串）
     * @param array|null $existingShares 已加载的分享数据（['shares'=>[...]]），
     *        用于内存查重；为 null 时直接生成（调用方应在锁内保证唯一性）
     * @return string
     */
    function cpydes_generate_share_token($existingShares = null) {
        $chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $tokenSet = [];
        if ($existingShares !== null && isset($existingShares['shares']) && is_array($existingShares['shares'])) {
            foreach ($existingShares['shares'] as $s) {
                if (isset($s['token'])) $tokenSet[$s['token']] = true;
            }
        }
        $maxAttempts = 10;
        $token = '';
        for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
            $token = '';
            for ($i = 0; $i < 24; $i++) {
                $token .= $chars[random_int(0, 61)];
            }
            if ($existingShares !== null) {
                if (!isset($tokenSet[$token])) return $token;
            } else {
                return $token;
            }
        }
        // 兜底：用更长的随机串
        return $token . bin2hex(random_bytes(4));
    }
}

if (!function_exists('cpydes_format_bytes')) {
    /**
     * 格式化文件大小
     * @param int|float $bytes
     * @return string
     */
    function cpydes_format_bytes($bytes) {
        if ($bytes < 0) return '0 B';
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, $i === 0 ? 0 : 1) . ' ' . $units[$i];
    }
}
