// ========== 布局切换 ==========
const LAYOUT_LOCAL_KEY = 'cpydes_layout_local';
// 后台默认布局版本号缓存键：用于检测后台默认布局变更
const LAYOUT_VERSION_KEY = 'cpydes_layout_version';
// 布局机制版本：部署新版后一次性清除所有用户旧的本地偏好，使后台默认布局立即生效
const LAYOUT_SCHEME_KEY = 'cpydes_layout_scheme';
const LAYOUT_SCHEME_VER = 2;

// 缓存 itemMap 以避免重复创建
let _cachedItemMap = null;
let _lastItemsRef = null;
let _lastItemsLength = 0;
let _itemsGeneration = 0;

function getItemMap() {
    const items = appData.items || [];
    if (!_cachedItemMap || _lastItemsRef !== items || _lastItemsLength !== items.length || _itemsGeneration !== _currentItemsGeneration) {
        _cachedItemMap = new Map(items.map(i => [i.id, i]));
        _lastItemsRef = items;
        _lastItemsLength = items.length;
        _itemsGeneration = _currentItemsGeneration;
    }
    return _cachedItemMap;
}

// 当 items 内容被原地修改时（如 saveItem），调用此函数使缓存失效
let _currentItemsGeneration = 0;
function invalidateItemMap() {
    _currentItemsGeneration++;
}

function getSavedLayout() {
    try {
        // 1) 机制版本迁移：部署新版后一次性清除旧的本地偏好，让后台默认布局立即生效
        if (localStorage.getItem(LAYOUT_SCHEME_KEY) !== String(LAYOUT_SCHEME_VER)) {
            localStorage.removeItem(LAYOUT_LOCAL_KEY);
            localStorage.setItem(LAYOUT_SCHEME_KEY, String(LAYOUT_SCHEME_VER));
        }

        const backendVersion = (appData && appData.settings && appData.settings.layoutVersion) ? parseInt(appData.settings.layoutVersion, 10) : 0;
        const storedVersion = parseInt(localStorage.getItem(LAYOUT_VERSION_KEY) || '0', 10);
        let localPrefValid = true;

        // 2) 后台默认布局变更检测：版本不一致时清除本地偏好，应用新的后台默认
        if (backendVersion && storedVersion !== backendVersion) {
            localStorage.removeItem(LAYOUT_LOCAL_KEY);
            localStorage.setItem(LAYOUT_VERSION_KEY, String(backendVersion));
            localPrefValid = false;
        }

        // 3) 本地偏好有效时（版本一致），尊重用户的自行切换选择
        if (localPrefValid) {
            const localLayout = localStorage.getItem(LAYOUT_LOCAL_KEY);
            if (localLayout === 'sidebar' || localLayout === 'top-tabs') {
                return localLayout;
            }
        }

        // 4) 无本地偏好或后台已变更：使用后台默认布局
        if (appData && appData.settings && appData.settings.layout) {
            return appData.settings.layout;
        }
        return 'sidebar';
    } catch { return 'sidebar'; }
}

function saveLayoutLocal(layout) {
    try { localStorage.setItem(LAYOUT_LOCAL_KEY, layout); } catch {}
}

function saveLayoutGlobal(layout) {
    if (!appData.settings) appData.settings = {};
    appData.settings.layout = layout;
    saveLayoutLocal(layout);
    // 持久化到服务端，避免本地/服务端状态不同步
    if (typeof saveSettings === 'function') saveSettings();
}

function initLayout() {
    appState.setState('ui.currentLayout', getSavedLayout());
    applyLayout(currentLayout);
    updateLayoutOptionUI(currentLayout);
}

function applyLayout(layout) {
    const container = document.getElementById('appContainer');
    if (!container) return;

    container.classList.remove('layout-sidebar', 'layout-top-tabs');
    container.classList.add('layout-' + layout);

    const topCatBar = document.getElementById('topCatBar');
    const topSubCatBar = document.getElementById('topSubCatBar');

    if (layout === 'top-tabs') {
        if (topCatBar) topCatBar.style.display = '';
        const cats = appData.categories || [];
        if (!activeCat) {
            if (cats.length > 0) {
                appState.setState('ui.activeCategory', cats[0].id);
            }
        }
        renderCategories();
        renderList();
        const searchInput = document.getElementById('catSearchInput');
        if (searchInput) searchInput.placeholder = '搜索子分类...';
    } else {
        if (topCatBar) topCatBar.style.display = 'none';
        if (topSubCatBar) topSubCatBar.style.display = 'none';
        const section = document.getElementById('subCatOnlySection');
        if (section) section.style.display = 'none';
        const searchInput = document.getElementById('catSearchInput');
        if (searchInput) searchInput.placeholder = '搜索分类...';
    }
}

function switchLayout(layout) {
    if (currentLayout === layout) return;
    appState.setState('ui.currentLayout', layout);
    try { localStorage.removeItem(LAYOUT_LOCAL_KEY); } catch {}
    saveLayoutGlobal(layout);
    applyLayout(layout);
    updateLayoutOptionUI(layout);
    updateThemeMenuActive();
    showToast('已切换为' + (layout === 'top-tabs' ? '顶部标签' : '侧边栏') + '布局', 'success', 1500);
}

function updateLayoutOptionUI(layout) {
    const options = document.querySelectorAll('.layout-option');
    options.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.layout === layout);
    });
}

function renderTopCatTabs() {
    const scroll = document.getElementById('topCatScroll');
    if (!scroll) return;

    const cats = appData.categories || [];
    const catCounts = (typeof getRenderCatCounts === 'function') ? getRenderCatCounts() : null;

    let html = '';

    cats.forEach(cat => {
        const totalCount = catCounts ? (catCounts.get(cat.id) || 0) : countItemsInCategory(cat.id);
        const safeColor = sanitizeColor(cat.color) || '#6366f1';
        const isActive = activeCat === cat.id || (cat.children && cat.children.some(c => c.id === activeCat));

        html += `
            <button class="top-cat-tab ${isActive ? 'active' : ''}" data-cat-id="${escapeAttr(cat.id)}" onclick="selectTopCat('${escapeAttr(cat.id)}')">
                <span class="top-cat-dot" style="background:${safeColor}"></span>
                <span class="top-cat-name">${escapeHtml(cat.name)}</span>
                ${totalCount > 0 ? `<span class="top-cat-count">${totalCount}</span>` : ''}
            </button>
        `;
    });

    scroll.innerHTML = html;
}

function selectTopCat(catId) {
    appState.setState('ui.activeCategory', catId);
    renderCategories();
    renderList();
    if (window.innerWidth <= 900) closeSidebar();
}

function getTopViewParentCat() {
    if (!activeCat) return null;
    const cat = findCategoryById(activeCat);
    if (!cat) return null;
    if (cat.parentId) {
        return findCategoryById(cat.parentId);
    }
    return cat;
}

function renderSubCatOnlySection() {
    const section = document.getElementById('subCatOnlySection');
    const listContainer = document.getElementById('subCatListContainer');
    const emptyEl = document.getElementById('subCatEmpty');
    const allCountEl = document.getElementById('subCatAllCount');
    const favCountEl = document.getElementById('subCatFavCount');
    const allItem = document.getElementById('subCatNavAll');
    const favItem = document.getElementById('subCatNavFavorites');

    if (!section || !listContainer) return;

    if (currentLayout !== 'top-tabs') {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';

    const parentCat = getTopViewParentCat();

    const favIds = getLocalFavorites();
    const items = appData.items || [];
    const itemMap = getItemMap();

    let allCount = 0;
    let favCount = favIds.filter(id => itemMap.has(id)).length;

    const catCounts = (typeof getRenderCatCounts === 'function') ? getRenderCatCounts() : null;

    if (!parentCat) {
        allCount = items.length;
    } else {
        allCount = catCounts ? (catCounts.get(parentCat.id) || 0) : countItemsInCategory(parentCat.id);
        const childIdSet = parentCat.children ? new Set(parentCat.children.map(c => c.id)) : null;
        favCount = favIds.filter(id => {
            const item = itemMap.get(id);
            if (!item) return false;
            if (item.categoryId === parentCat.id) return true;
            return childIdSet ? childIdSet.has(item.categoryId) : false;
        }).length;
    }

    if (allCountEl) allCountEl.textContent = allCount;
    if (favCountEl) favCountEl.textContent = favCount;

    if (allItem) allItem.classList.toggle('active', (!activeCat || activeCat === (parentCat ? parentCat.id : null)) && currentFilter !== 'favorites');
    if (favItem) favItem.classList.toggle('active', currentFilter === 'favorites');

    if (!parentCat || !parentCat.children || parentCat.children.length === 0) {
        listContainer.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    let html = '';
    const canManageCats = hasPermission('categories.manage');

    parentCat.children.forEach((child, childIdx) => {
        const childCnt = catCounts ? (catCounts.get(child.id) || 0) : countItemsInCategory(child.id);
        const isChildActive = activeCat === child.id;
        const safeChildId = escapeAttr(child.id);
        const safeChildColor = sanitizeColor(child.color) || '#818cf8';

        html += `
        <div class="cat-nav-l2 ${isChildActive ? 'active' : ''}"
             ${canManageCats ? `draggable="true"` : ''}
             data-sub-id="${safeChildId}"
             data-parent-id="${escapeAttr(parentCat.id)}"
             data-child-idx="${childIdx}"
             onclick="selectSubCatFromTopView('${safeChildId}')"
             ${canManageCats ? `ondragstart="handleSubDragStart(event, '${escapeAttr(parentCat.id)}', '${safeChildId}', ${childIdx})"
             ondragend="handleSubDragEnd(event)"
             ondragover="handleSubDragOver(event)"
             ondrop="handleSubDrop(event, '${escapeAttr(parentCat.id)}')"` : ''}>
            ${canManageCats ? `<span class="nav-drag-sm"><i data-feather="move"></i></span>` : ''}
            <span class="nav-dot-sm" style="background:${safeChildColor}"></span>
            <span class="nav-name-sm">${escapeHtml(child.name)}</span>
            ${childCnt > 0 ? `<span class="nav-count-sm">${childCnt}</span>` : ''}
            ${canManageCats ? `<div class="nav-l1-actions">
                <button class="nav-action-btn" onclick="event.stopPropagation();editSubCategoryQuick('${escapeAttr(parentCat.id)}','${safeChildId}')" title="重命名"><i data-feather="edit-3"></i></button>
                <button class="nav-action-btn danger" onclick="event.stopPropagation();deleteSubCategoryQuick('${escapeAttr(parentCat.id)}','${safeChildId}')" title="删除"><i data-feather="x"></i></button>
            </div>` : ''}
        </div>`;
    });

    listContainer.innerHTML = html;
    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
}

function selectSubCatFromTopView(catId) {
    const parentCat = getTopViewParentCat();
    if (catId === null) {
        appState.setState('ui.activeCategory', parentCat ? parentCat.id : null);
        resetFilter();
    } else if (catId === '__favorites__') {
        const newFilter = currentFilter === 'favorites' ? 'all' : 'favorites';
        appState.setState('ui.currentFilter', newFilter);
        const tags = document.querySelectorAll('.filter-tag');
        tags.forEach(tag => {
            tag.classList.toggle('active', tag.dataset.filter === newFilter);
        });
        renderList();
        renderCategories();
        if (window.innerWidth <= 900) closeSidebar();
        return;
    } else {
        appState.setState('ui.activeCategory', catId);
    }

    renderCategories();
    renderList();

    if (window.innerWidth <= 900) closeSidebar();
}

function addSubCatFromTopView() {
    const parentCat = getTopViewParentCat();
    if (!parentCat) {
        showToast('请先选择一个分类', 'warning', 1500);
        return;
    }
    addSubCategoryQuick(parentCat.id);
}
