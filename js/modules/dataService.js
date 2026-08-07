// ========== CSRF Token 管理（懒加载，支持请求去重） ==========
let CSRF_TOKEN = null;
let _csrfPromise = null; // 避免并发获取 token 时产生多个请求

// ========== 索引缓存（通过 appState.cache 管理） ==========
// 兼容性别名：读取 appState 中的索引
function _catIndex() { return appState.getState('cache.catIndex'); }
function _itemIndex() { return appState.getState('cache.itemIndex'); }
function _catItemCount() { return appState.getState('cache.catItemCount'); }

/** 构建内存索引并清空分类标签缓存 */
function buildIndices() {
    const catIndex = appState.getState('cache.catIndex');
    const itemIndex = appState.getState('cache.itemIndex');
    const catItemCount = appState.getState('cache.catItemCount');

    catIndex.clear();
    itemIndex.clear();
    catItemCount.clear();
    clearCatLabelCache();

    // 优化：单次遍历同时填充 itemIndex 和 catItemCount，减少遍历次数
    for (const cat of appData.categories) {
        catIndex.set(cat.id, cat);
        if (cat.children) {
            for (const child of cat.children) catIndex.set(child.id, child);
        }
    }
    
    for (const item of appData.items) {
        itemIndex.set(item.id, item);
        const cid = item.categoryId;
        if (!cid) continue;
        
        // 累加当前分类计数
        catItemCount.set(cid, (catItemCount.get(cid) || 0) + 1);
        
        // 如果是子分类，同步累加父分类计数
        const cat = catIndex.get(cid);
        if (cat && cat.parentId) {
            catItemCount.set(cat.parentId, (catItemCount.get(cat.parentId) || 0) + 1);
        }
    }
}

function getItemById(id) {
    return appState.getState('cache.itemIndex').get(id) || null;
}

function updateItemIndex(item) {
    appState.getState('cache.itemIndex').set(item.id, item);
}

function removeItemIndex(id) {
    appState.getState('cache.itemIndex').delete(id);
}

async function ensureCsrfToken() {
    if (CSRF_TOKEN) return CSRF_TOKEN;
    // 请求去重：并发调用时共享同一个 Promise
    if (_csrfPromise) return _csrfPromise;
    try {
        _csrfPromise = (async () => {
            const r = await fetch('api.php?action=getCsrfToken');
            const j = await r.json();
            if (j.success) CSRF_TOKEN = j.token;
            return CSRF_TOKEN;
        })();
        await _csrfPromise;
    } catch (e) {
        console.error('获取 CSRF Token 失败', e);
    } finally {
        _csrfPromise = null; // 重置以便下次重新获取
    }
    return CSRF_TOKEN;
}

/**
 * fetch 包装器：GET 透传，POST/DELETE 自动注入 X-CSRF-Token 头
 */
async function apiFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET') {
        return fetch(url, options);
    }
    const token = await ensureCsrfToken();
    const isFormData = options.body instanceof FormData;
    if (!isFormData) {
        options.headers = options.headers || {};
        if (token) options.headers['X-CSRF-Token'] = token;
    } else {
        if (token) options.body.append('_csrf', token);
    }
    return fetch(url, options);
}

/** 数据验证常量 */
const EMPTY_DATA = { categories: [], items: [], settings: {}, users: [] };

async function loadData() {
    try {
        const response = await fetch('api.php?action=getAll', {
            // 使用 cache='no-cache' 避免浏览器强缓存导致数据 stale
            cache: 'no-cache'
        });
        
        if (response.status === 403) {
            let errMsg = '权限不足';
            try { 
                const j = await response.json(); 
                if (j.error) errMsg = j.error; 
            } catch (_) {}
            showToast(errMsg, 'error');
            return;
        }
        if (response.status === 401) {
            if (typeof openLibraryAuth === 'function') openLibraryAuth();
            return;
        }
        const result = await response.json();
        if (result.success) {
            // result.data 异常时回退为空结构，避免后续解构抛 TypeError
            const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
                ? result.data
                : EMPTY_DATA;
            // 通过 appState 更新数据
            appState.setState('data', data);

            // 确保数据结构正确（防御性编程）
            if (!Array.isArray(appData.categories)) appData.categories = [];
            if (!Array.isArray(appData.items)) appData.items = [];
            if (!appData.settings) appData.settings = {};
            if (!Array.isArray(appData.users)) appData.users = [];
            
            // 同步后台配置到全局变量（查重策略/分段展示/复制提醒/问候语录）
            applySettingsToGlobals(appData.settings);
            buildIndices();
            if (typeof initLayout === 'function') initLayout();
            render();
        }
    } catch (e) {
        console.error('加载数据失败', e);
        showToast('加载数据失败', 'error');
    }
}

// ========== 实时同步：增量刷新函数（仅拉取变化的数据类型） ==========

/**
 * 应用 settings 到全局变量（DEDUP_CONFIG / PREVIEW_SEGMENT_DEFAULT / COPY_REMINDER / 问候语录）
 * loadData 与 refreshSettings 共用，避免逻辑漂移
 */
function applySettingsToGlobals(settings) {
    if (!settings || typeof settings !== 'object') return;
    if (settings.dedup && typeof settings.dedup === 'object') {
        window.DEDUP_CONFIG = settings.dedup;
    }
    window.PREVIEW_SEGMENT_DEFAULT = !!settings.previewSegmentDefault;
    window.COPY_REMINDER = (settings.copyReminder && typeof settings.copyReminder === 'object')
        ? settings.copyReminder
        : null;
    const gq = settings.greetingQuotes;
    if (Array.isArray(gq) && gq.length > 0) {
        const quoteEl = document.getElementById('greetingQuote');
        if (quoteEl) quoteEl.textContent = gq[Math.floor(Math.random() * gq.length)];
    }
}

/**
 * 增量刷新内容（分类 + 文案）
 * 仅在 content 版本变化时调用，重建索引并重新渲染（不重置布局/筛选状态）
 */
async function refreshContent() {
    try {
        const response = await fetch('api.php?action=getData&type=content', { cache: 'no-cache' });
        if (!response.ok) return;
        const result = await response.json();
        if (!result.success) return;
        const data = result.data || {};
        // 合并到现有 appData（保留 settings/users 不变）
        const cur = appState.getState('data') || {};
        const merged = Object.assign({}, cur, {
            categories: Array.isArray(data.categories) ? data.categories : [],
            items: Array.isArray(data.items) ? data.items : [],
        });
        appState.setState('data', merged);
        buildIndices();
        if (typeof render === 'function') render();
    } catch (e) {
        console.error('增量刷新内容失败:', e);
    }
}

/**
 * 增量刷新系统设置
 * 仅在 settings 版本变化时调用，应用到全局变量并重新渲染
 */
async function refreshSettings() {
    try {
        const response = await fetch('api.php?action=getData&type=settings', { cache: 'no-cache' });
        if (!response.ok) return;
        const result = await response.json();
        if (!result.success) return;
        const settings = (result.data && result.data.settings) || {};
        const cur = appState.getState('data') || {};
        appState.setState('data', Object.assign({}, cur, { settings: settings }));
        applySettingsToGlobals(settings);
        if (typeof render === 'function') render();
    } catch (e) {
        console.error('增量刷新设置失败:', e);
    }
}

/**
 * 增量刷新公告
 * 复用 checkAnnouncements() 的未读过滤与展示逻辑（内部自带 getActiveAnnouncements 拉取）
 */
async function refreshAnnouncements() {
    try {
        if (typeof checkAnnouncements === 'function') await checkAnnouncements();
    } catch (e) {
        console.error('增量刷新公告失败:', e);
    }
}

let _saveCatPromise = null;

async function saveCategories() {
    if (_saveCatPromise) return _saveCatPromise;
    try {
        _saveCatPromise = (async () => {
            const response = await apiFetch('api.php?action=saveCategories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categories: appData.categories })
            });
            const result = await response.json();
            if (!result.success) {
                showToast('保存分类失败', 'error');
                return false;
            }
            return true;
        })();
        const result = await _saveCatPromise;
        return result;
    } catch (e) {
        console.error('保存数据失败', e);
        showToast('保存数据失败', 'error');
        return false;
    } finally {
        _saveCatPromise = null;
    }
}

// 向后兼容别名（原 saveData 实际只保存分类，已重命名为 saveCategories）
var saveData = saveCategories;

async function saveItemOrder() {
    try {
        const response = await apiFetch('api.php?action=saveItemsOrder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: appData.items })
        });
        const result = await response.json();
        if (!result.success) {
            showToast('保存排序失败', 'error');
            return false;
        }
        return true;
    } catch (e) {
        console.error('保存排序失败', e);
        showToast('保存排序失败', 'error');
        return false;
    }
}

function findCategoryById(id) {
    const catIndex = _catIndex();
    // 优先 O(1) 索引查找
    if (catIndex.size > 0) return catIndex.get(id) || null;
    // 降级：索引未构建时线性查找
    for (const cat of appData.categories) {
        if (cat.id === id) return cat;
        if (cat.children) {
            const child = cat.children.find(c => c.id === id);
            if (child) return child;
        }
    }
    return null;
}

function countItemsInCategory(catId) {
    const catItemCount = _catItemCount();
    // 优先 O(1) 索引查找
    if (catItemCount.size > 0) return catItemCount.get(catId) || 0;
    // 降级：索引未构建时线性查找
    const cat = findCategoryById(catId);
    if (!cat) return 0;
    const childIds = cat.children ? cat.children.map(c => c.id) : [];
    return appData.items.filter(item => item.categoryId === catId || childIds.includes(item.categoryId)).length;
}

function clearCatLabelCache() {
    appCache.catLabel.clear();
}

function getCategoryLabel(catId) {
    const cached = appCache.catLabel.get(catId);
    if (cached !== undefined) return cached;

    let result;
    const catIndex = _catIndex();
    const cat = catIndex.size > 0 ? catIndex.get(catId) : null;
    if (cat) {
        const safeColor = sanitizeColor(cat.color);
        const bgColor = safeColor ? expandHex(safeColor) + '15' : 'rgba(99,102,241,0.1)';
        if (cat.parentId) {
            const parent = catIndex.get(cat.parentId);
            const parentName = parent ? parent.name : '';
            result = `<span class="row-cat-tag" style="background:${bgColor} ; color:${safeColor || '#818cf8'}">${escapeHtml(parentName)} / ${escapeHtml(cat.name)}</span>`;
        } else {
            result = `<span class="row-cat-tag" style="background:${bgColor} ; color:${safeColor || '#6366f1'}">${escapeHtml(cat.name)}</span>`;
        }
    } else {
        result = '<span class="row-cat-tag" style="background:#f3f4f6;color:#6b7280">-</span>';
    }

    appCache.catLabel.set(catId, result);
    return result;
}

/** 返回分类纯文本标签（不含 HTML），供 gallery 等场景使用 */
function getCategoryLabelText(catId) {
    const catIndex = _catIndex();
    // 优先使用 O(1) 索引查找
    if (catIndex.size > 0) {
        const cat = catIndex.get(catId);
        if (cat) {
            return cat.parentId
                ? (catIndex.get(cat.parentId)?.name || '') + ' / ' + (cat.name || '')
                : (cat.name || '');
        }
        return '-';
    }
    // 降级：索引未构建时线性查找
    for (const c of appData.categories) {
        if (c.id === catId) return c.name || '';
        if (c.children) {
            const child = c.children.find(ch => ch.id === catId);
            if (child) return (c.name || '') + ' / ' + (child.name || '');
        }
    }
    return '-';
}

async function saveSettings() {
    try {
        const response = await apiFetch('api.php?action=saveSettings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: appData.settings || {} })
        });
        const result = await response.json();
        if (!result.success) {
            showToast('保存设置失败', 'error');
        }
    } catch (e) {
        console.error('保存设置失败', e);
        showToast('保存设置失败', 'error');
    }
}

/** 根据用户 ID 获取用户名 */
function getUserLabel(userId) {
    if (!userId) return '<span class="row-user-tag" style="color:#9ca3af">-</span>';
    const users = appData.users || [];
    const user = users.find(u => u.id === userId);
    if (user) {
        return `<span class="row-user-tag" style="color:#6366f1;">${escapeHtml(user.username)}</span>`;
    }
    return '<span class="row-user-tag" style="color:#9ca3af">未知用户</span>';
}
