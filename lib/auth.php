<?php
/**
 * Cpydes 共享库：认证 / 用户 / 角色权限
 *
 * 说明：
 * - 无副作用（不输出、不自动启动 session），可被任意入口安全 require
 * - 数据文件路径基于本库所在位置推导（lib/ 位于站点根目录下）
 */

require_once __DIR__ . '/json_store.php';

if (!defined('CPYDES_SITE_ROOT')) {
    define('CPYDES_SITE_ROOT', dirname(__DIR__) . DIRECTORY_SEPARATOR);
}
if (!defined('CPYDES_USERS_FILE')) {
    define('CPYDES_USERS_FILE', CPYDES_SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'users.json');
}
if (!defined('CPYDES_ROLES_FILE')) {
    define('CPYDES_ROLES_FILE', CPYDES_SITE_ROOT . 'data' . DIRECTORY_SEPARATOR . 'roles.json');
}

if (!function_exists('cpydes_session_start')) {
    /**
     * 统一的 session 启动（cookie 路径为根目录，前后台共享）
     */
    function cpydes_session_start() {
        if (session_status() === PHP_SESSION_ACTIVE) return;
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https'),
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
        @session_start();
    }
}

if (!function_exists('cpydes_load_users')) {
    /**
     * 加载用户数据（请求级缓存，每请求只读一次盘）
     * @param bool $reload 强制重新读取
     * @return array ['users' => [...]]
     */
    function cpydes_load_users($reload = false) {
        static $cache = null;
        if ($cache !== null && !$reload) return $cache;
        $cache = cpydes_json_load(CPYDES_USERS_FILE, ['users' => []]);
        return $cache;
    }
}

if (!function_exists('cpydes_load_roles')) {
    /**
     * 加载角色数据（请求级缓存）
     * @param bool $reload 强制重新读取
     * @return array ['roles' => [...]]
     */
    function cpydes_load_roles($reload = false) {
        static $cache = null;
        if ($cache !== null && !$reload) return $cache;
        $cache = cpydes_json_load(CPYDES_ROLES_FILE, ['roles' => []]);
        return $cache;
    }
}

if (!function_exists('cpydes_find_user_by_id')) {
    /**
     * 按 ID 查找用户
     * @param string $userId
     * @return array|null
     */
    function cpydes_find_user_by_id($userId) {
        if ($userId === '' || $userId === null) return null;
        $usersData = cpydes_load_users();
        foreach ($usersData['users'] as $user) {
            if (($user['id'] ?? '') === $userId) return $user;
        }
        return null;
    }
}

if (!function_exists('cpydes_get_role_by_id')) {
    /**
     * 按 ID 查找角色
     * @param string $roleId
     * @return array|null
     */
    function cpydes_get_role_by_id($roleId) {
        $rolesData = cpydes_load_roles();
        foreach ($rolesData['roles'] as $role) {
            if (($role['id'] ?? '') === $roleId) return $role;
        }
        return null;
    }
}

if (!function_exists('cpydes_get_role_default_permissions')) {
    /**
     * 角色默认权限（支持动态角色和向后兼容旧角色名 admin/editor/viewer）
     * @param string $role 角色 ID 或旧角色名
     * @return array
     */
    function cpydes_get_role_default_permissions($role) {
        $roleData = cpydes_get_role_by_id($role);
        if ($roleData && isset($roleData['permissions']) && is_array($roleData['permissions'])) {
            return $roleData['permissions'];
        }
        $compatMap = [
            'admin' => 'role_admin',
            'editor' => 'role_editor',
            'viewer' => 'role_viewer',
        ];
        if (isset($compatMap[$role])) {
            $compatRole = cpydes_get_role_by_id($compatMap[$role]);
            if ($compatRole && isset($compatRole['permissions']) && is_array($compatRole['permissions'])) {
                return $compatRole['permissions'];
            }
        }
        return [];
    }
}

if (!function_exists('cpydes_get_user_effective_permissions')) {
    /**
     * 获取用户有效权限列表（自定义权限优先，否则用角色默认权限）
     * @param array $user
     * @return array
     */
    function cpydes_get_user_effective_permissions($user) {
        if (isset($user['permissions']) && is_array($user['permissions']) && !empty($user['permissions'])) {
            return $user['permissions'];
        }
        return cpydes_get_role_default_permissions($user['role'] ?? 'viewer');
    }
}

if (!function_exists('cpydes_user_has_permission')) {
    /**
     * 检查指定用户是否拥有某权限（admin/role_admin 角色拥有所有权限）
     * @param array|null $user
     * @param string $permission
     * @return bool
     */
    function cpydes_user_has_permission($user, $permission) {
        if (!$user) return false;
        $role = $user['role'] ?? '';
        if ($role === 'admin' || $role === 'role_admin') return true;
        $permissions = cpydes_get_user_effective_permissions($user);
        if (in_array('*', $permissions, true)) return true;
        return in_array($permission, $permissions, true);
    }
}
