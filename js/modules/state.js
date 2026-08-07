// ========== 轻量级状态管理 ==========
// StateManager：统一的状态存储、更新、订阅机制
// LRUCache：统一的 LRU 缓存管理，替代分散的手工缓存实现

// ========== LRUCache ==========
class LRUCache {
    constructor(maxSize) {
        this._maxSize = maxSize || 200;
        this._map = new Map();
    }

    get(key) {
        if (!this._map.has(key)) return undefined;
        const value = this._map.get(key);
        // 访问时移到末尾（最近使用）
        this._map.delete(key);
        this._map.set(key, value);
        return value;
    }

    set(key, value) {
        if (this._map.has(key)) {
            this._map.delete(key);
        } else if (this._map.size >= this._maxSize) {
            // 淘汰最久未使用
            const firstKey = this._map.keys().next().value;
            this._map.delete(firstKey);
        }
        this._map.set(key, value);
    }

    has(key) {
        return this._map.has(key);
    }

    delete(key) {
        this._map.delete(key);
    }

    clear() {
        this._map.clear();
    }

    get size() {
        return this._map.size;
    }
}

// ========== StateManager ==========
class StateManager {
    constructor(initialState) {
        this._state = initialState || {};
        this._listeners = new Map();
    }

    getState(path) {
        if (!path) return this._state;
        return path.split('.').reduce((obj, key) => obj?.[key], this._state);
    }

    setState(path, value) {
        const oldValue = this._getNestedValue(path);
        this._setNestedValue(path, value);
        this._notifyListeners(path, oldValue, value);
    }

    subscribe(path, listener) {
        if (!this._listeners.has(path)) {
            this._listeners.set(path, new Set());
        }
        this._listeners.get(path).add(listener);
        return () => {
            this._listeners.get(path)?.delete(listener);
        };
    }

    _getNestedValue(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this._state);
    }

    _setNestedValue(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => {
            if (obj[key] === undefined || obj[key] === null) obj[key] = {};
            return obj[key];
        }, this._state);
        target[lastKey] = value;
    }

    _notifyListeners(path, oldValue, newValue) {
        // 通知精确路径的监听器
        this._listeners.get(path)?.forEach(listener => {
            try { listener(newValue, oldValue, path); } catch (e) { console.error('StateManager listener error:', e); }
        });
        // 通知父级路径的监听器
        const parts = path.split('.');
        for (let i = parts.length - 1; i > 0; i--) {
            const parentPath = parts.slice(0, i).join('.');
            this._listeners.get(parentPath)?.forEach(listener => {
                try { listener(this._getNestedValue(parentPath), oldValue, path); } catch (e) { console.error('StateManager listener error:', e); }
            });
        }
    }
}

// ========== 全局状态管理器实例 ==========
const appState = new StateManager({
    // 数据层
    data: {
        categories: [],
        items: [],
        settings: {}
    },
    // 认证层
    auth: {
        authenticated: false,
        protectionEnabled: false,
        submitting: false,
        mode: 'code',
        user: null,
        accessCodePermissions: []
    },
    // UI 层
    ui: {
        activeCategory: null,
        currentFilter: 'all',
        editingItemId: null,
        selectedCategoryId: null,
        selectedRowIdx: -1,
        filteredItemsCount: 0,
        currentLayout: 'sidebar',
        isDark: false
    },
    // 缓存层（索引、标签等运行时缓存）
    cache: {
        catIndex: new Map(),
        itemIndex: new Map(),
        catItemCount: new Map(),
        catLabelCache: new LRUCache(200)
    },
    // 实时同步层（版本号 + 配置，由 sync.js 维护）
    sync: {
        version: null,   // {content, settings, shares, announcements, drive} 各自文件 mtime
        config: { enabled: false, interval: 5 }
    }
});

// ========== 全局缓存管理器 ==========
const appCache = {
    catLabel: new LRUCache(200),
    stripHtml: new LRUCache(500),
    formatDate: new LRUCache(500),
    extractText: new LRUCache(500),
    dom: new LRUCache(100),

    clearAll() {
        this.catLabel.clear();
        this.stripHtml.clear();
        this.formatDate.clear();
        this.extractText.clear();
        this.dom.clear();
    }
};

// ========== 保留兼容的全局变量（向后兼容） ==========
// 这些变量仍然作为快捷方式存在，但状态变更应通过 appState.setState 进行
let appData = {
    categories: [],
    items: [],
    settings: {}
};
let activeCat = null;
let currentFilter = 'all';
let editingItemId = null;
let selectedCategoryId = null;
let selectedRowIdx = -1;
let filteredItemsCount = 0;

let currentUser = null;
let currentLayout = 'sidebar';

// 订阅所有路径变更，自动同步到全局变量
appState.subscribe('data', () => { appData = appState.getState('data'); });
appState.subscribe('ui.activeCategory', (v) => { activeCat = v; });
appState.subscribe('ui.currentFilter', (v) => { currentFilter = v; });
appState.subscribe('ui.editingItemId', (v) => { editingItemId = v; });
appState.subscribe('ui.selectedCategoryId', (v) => { selectedCategoryId = v; });
appState.subscribe('ui.selectedRowIdx', (v) => { selectedRowIdx = v; });
appState.subscribe('ui.filteredItemsCount', (v) => { filteredItemsCount = v; });
appState.subscribe('auth.user', (v) => { currentUser = v; });
appState.subscribe('ui.currentLayout', (v) => { currentLayout = v; });

// ========== 权限检查 ==========
function hasPermission(permission) {
    const protectionEnabled = appState.getState('auth.protectionEnabled');
    const allowGuestAccess = appState.getState('auth.allowGuestAccess');
    const user = appState.getState('auth.user');

    if (!user && (!protectionEnabled || allowGuestAccess)) {
        // 未登录 + (保护关闭 或 允许访客访问)：按访客权限配置
        const guestPerms = appState.getState('auth.guestPermissions') || [];
        if (guestPerms.includes('*')) return true;
        if (Array.isArray(permission)) {
            return permission.some(p => guestPerms.includes(p));
        }
        return guestPerms.includes(permission);
    }
    if (!user) {
        // 保护开启 + 不允许访客 + 未登录：无任何权限
        return false;
    }
    const userPerms = user.permissions || [];
    if (userPerms.includes('*')) return true;
    if (Array.isArray(permission)) {
        return permission.some(p => userPerms.includes(p));
    }
    return userPerms.includes(permission);
}

// ========== 收藏管理（支持云端同步） ==========
const FAV_KEY = 'cpydes_favorites';
const FAV_USER_KEY = 'cpydes_last_fav_user';
let _favSet = null;
let _favSyncTimer = null;
let _cloudFavLoaded = false;

function getLocalFavorites() {
    try {
        return JSON.parse(localStorage.getItem(FAV_KEY)) || [];
    } catch { return []; }
}

function _getFavSet() {
    if (!_favSet) {
        _favSet = new Set(getLocalFavorites());
    }
    return _favSet;
}

function saveLocalFavorites(ids) {
    try {
        localStorage.setItem(FAV_KEY, JSON.stringify(ids));
        _favSet = new Set(ids);
    } catch {}
}

function isUserFavorite(itemId) {
    return _getFavSet().has(itemId);
}

/**
 * 判断当前是否为账户登录状态（用于决定是否云端同步收藏）
 */
function isUserLoggedIn() {
    const user = appState.getState('auth.user');
    return !!(user && user.id);
}

function toggleLocalFavorite(itemId) {
    const ids = getLocalFavorites();
    const idx = ids.indexOf(itemId);
    if (idx >= 0) {
        ids.splice(idx, 1);
    } else {
        ids.push(itemId);
    }
    saveLocalFavorites(ids);
    // 已登录时，延迟同步到云端（去抖，避免连续点击多次请求）
    if (isUserLoggedIn()) {
        scheduleFavSyncToServer();
    }
    return idx < 0;
}

/**
 * 去抖同步收藏到云端（2 秒内的多次 toggle 合并为一次请求）
 */
function scheduleFavSyncToServer() {
    if (_favSyncTimer) clearTimeout(_favSyncTimer);
    _favSyncTimer = setTimeout(function() {
        _favSyncTimer = null;
        syncFavoritesToServer();
    }, 2000);
}

/**
 * 立即同步当前收藏到云端（全量替换）
 */
async function syncFavoritesToServer() {
    if (!isUserLoggedIn()) return;
    const ids = getLocalFavorites();
    try {
        const r = await apiFetch('api.php?action=saveFavorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorites: ids })
        });
        const j = await r.json();
        if (!j.success && j.needsLogin) {
            // 登录态失效，停止后续同步
            console.warn('云端收藏同步失败：未登录');
        }
    } catch (e) {
        console.error('同步收藏到云端失败:', e);
    }
}

/**
 * 从云端加载当前用户收藏，并与本地合并（并集）后回写两端
 * 在登录成功后调用，确保跨设备数据一致
 */
async function loadCloudFavorites() {
    if (!isUserLoggedIn()) {
        _cloudFavLoaded = true;
        return;
    }
    const user = appState.getState('auth.user');
    const userId = user ? user.id : '';
    let lastUserId = null;
    try { lastUserId = localStorage.getItem(FAV_USER_KEY) || null; } catch {}

    try {
        const r = await fetch('api.php?action=getFavorites');
        if (r.status === 401) {
            _cloudFavLoaded = true;
            return;
        }
        const j = await r.json();
        if (j.success && Array.isArray(j.favorites)) {
            const cloudIds = j.favorites;
            // 用户切换检测：与上次同步的用户不同时，丢弃本地收藏（防止前一用户数据泄漏）
            const userSwitched = lastUserId !== null && lastUserId !== userId;
            let localIds = userSwitched ? [] : getLocalFavorites();

            // 合并策略：并集（保留本地收藏，同时拉取云端新增）
            const mergedSet = new Set(localIds);
            let changed = false;
            for (const id of cloudIds) {
                if (!mergedSet.has(id)) {
                    mergedSet.add(id);
                    changed = true;
                }
            }
            const merged = Array.from(mergedSet);
            // 更新内存与本地存储
            saveLocalFavorites(merged);
            // 记录本次同步的用户 ID
            try { localStorage.setItem(FAV_USER_KEY, userId); } catch {}
            // 如果合并产生了新增（本地没有的云端项），回写到云端保持一致
            if (changed || merged.length !== cloudIds.length) {
                syncFavoritesToServer();
            }
            _cloudFavLoaded = true;
            // 合并后重新渲染，确保星标状态与最新收藏一致
            if (typeof render === 'function') {
                try { render(); } catch (e) { /* 渲染失败忽略，等待 loadData 完成后会再渲染 */ }
            }
        } else {
            _cloudFavLoaded = true;
        }
    } catch (e) {
        console.error('加载云端收藏失败:', e);
        _cloudFavLoaded = true;
    }
}
