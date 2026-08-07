<?php
/**
 * Cpydes 共享库：统一的 JSON 文件读写与文件锁
 *
 * 说明：
 * - 本文件无副作用（不输出、不启动 session），可被任意入口安全 require
 * - 函数使用 cpydes_ 前缀，避免与各入口文件的既有同名函数冲突；
 *   入口文件内的原函数名保留为薄包装以兼容现有调用点
 */

if (!function_exists('cpydes_json_load')) {
    /**
     * 读取 JSON 文件并做结构兜底
     * - 文件不存在 / 读取失败 / json_decode 失败 → 返回 $defaults
     * - 顶层键缺失或类型不符 → 用 $defaults 中对应值补齐
     *
     * @param string $file     JSON 文件路径
     * @param array  $defaults 默认结构（顶层键 => 默认值）
     * @return array
     */
    function cpydes_json_load($file, array $defaults = []) {
        if (!is_string($file) || $file === '' || !file_exists($file)) {
            return $defaults;
        }
        $raw = @file_get_contents($file);
        if ($raw === false) {
            return $defaults;
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            error_log('cpydes_json_load: JSON 解析失败: ' . $file . ' (' . json_last_error_msg() . ')');
            return $defaults;
        }
        foreach ($defaults as $key => $defaultValue) {
            if (!array_key_exists($key, $data)) {
                $data[$key] = $defaultValue;
            } elseif (is_array($defaultValue) && !is_array($data[$key])) {
                $data[$key] = $defaultValue;
            }
        }
        return $data;
    }
}

if (!function_exists('cpydes_json_save_atomic')) {
    /**
     * 原子化保存 JSON 文件（唯一正确实现）
     * 流程：写 .tmp（带 LOCK_EX）→ rename 替换；Windows 下 rename 无法覆盖时
     * 先把原文件挪到 .bak 再替换，任何一步失败都会保留原文件并返回 false
     *
     * @param string $file  目标路径
     * @param mixed  $data  数据
     * @param int    $flags json_encode 标志
     * @return bool
     */
    function cpydes_json_save_atomic($file, $data, $flags = JSON_UNESCAPED_UNICODE) {
        $json = json_encode($data, $flags);
        if ($json === false) {
            error_log('cpydes_json_save_atomic: json_encode 失败: ' . $file . ' (' . json_last_error_msg() . ')');
            return false;
        }
        $tmp = $file . '.tmp';
        if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
            error_log('cpydes_json_save_atomic: 写入临时文件失败: ' . $tmp);
            return false;
        }
        // POSIX 下 rename 可原子覆盖；Windows 下目标存在时会失败
        if (@rename($tmp, $file)) {
            return true;
        }
        // Windows 回退路径：先把原文件挪为 .bak，再替换，失败则还原
        $bak = $file . '.bak';
        @unlink($bak);
        if (file_exists($file) && !@rename($file, $bak)) {
            // 原文件无法挪走（可能被占用）：copy 覆盖兜底，不删除原文件
            if (@copy($tmp, $file)) {
                @unlink($tmp);
                return true;
            }
            @unlink($tmp);
            error_log('cpydes_json_save_atomic: 替换失败（原文件保留）: ' . $file);
            return false;
        }
        if (@rename($tmp, $file)) {
            @unlink($bak);
            return true;
        }
        // 替换失败：还原备份，保证原数据不丢
        if (file_exists($bak)) {
            @rename($bak, $file);
        }
        @unlink($tmp);
        error_log('cpydes_json_save_atomic: rename 失败（已还原原文件）: ' . $file);
        return false;
    }
}

if (!function_exists('cpydes_lock_acquire')) {
    /**
     * 获取排他文件锁（阻塞等待）
     * @param string $lockFile 锁文件路径
     * @return resource|false 锁句柄，用完须调用 cpydes_lock_release
     */
    function cpydes_lock_acquire($lockFile) {
        $fp = @fopen($lockFile, 'c');
        if (!$fp) return false;
        if (!flock($fp, LOCK_EX)) {
            fclose($fp);
            return false;
        }
        return $fp;
    }
}

if (!function_exists('cpydes_lock_release')) {
    /**
     * 释放文件锁
     * @param resource|false $fp cpydes_lock_acquire 返回的句柄
     */
    function cpydes_lock_release($fp) {
        if ($fp) {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }
}
