// ========== 渲染周期内的分类计数缓存 ==========
let _renderCatCounts = null;

/**
 * 批量刷新指定容器内的 Feather Icons（避免全局刷新）
 * @param {HTMLElement|string} container - 容器元素或选择器
 */
function refreshFeatherIn(container) {
    if (typeof feather !== 'undefined' && typeof feather.replace === 'function') {
        try { 
            feather.replace(typeof container === 'string' ? { container } : container); 
        } catch(e) {}
    }
}

function getRenderCatCounts() {
    if (_renderCatCounts) return _renderCatCounts;
    const cats = appData.categories || [];
    _renderCatCounts = new Map();
    cats.forEach(cat => {
        _renderCatCounts.set(cat.id, countItemsInCategory(cat.id));
        if (cat.children) {
            cat.children.forEach(child => {
                _renderCatCounts.set(child.id, countItemsInCategory(child.id));
            });
        }
    });
    return _renderCatCounts;
}

function render() {
    if (typeof buildIndices === 'function') buildIndices();
    _renderCatCounts = null;
    if (currentLayout === 'top-tabs') {
        const cats = appData.categories || [];
        if (!activeCat) {
            if (cats.length > 0) {
                appState.setState('ui.activeCategory', cats[0].id);
            }
        }
    }
    renderCategories();
    renderList();
    updateStats();
    // 统一在末尾刷新一次图标，避免多次刷新
    requestAnimationFrame(() => {
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    });
}

function renderCategories() {
    const container = document.getElementById('catTreeContainer');
    const emptyEl = document.getElementById('sidebarEmpty');
    const cats = appData.categories || [];

    if (!container) return;

    if (cats.length === 0) {
        container.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const catCounts = getRenderCatCounts();

    let html = '';

    const canManageCats = hasPermission('categories.manage');

    cats.forEach((cat, idx) => {
        const totalCount = catCounts.get(cat.id) || 0;
        const hasChildren = cat.children && cat.children.length > 0;
        const isChildActive = hasChildren && cat.children.some(c => c.id === activeCat);
        const isActive = activeCat === cat.id || isChildActive;
        const isExpanded = (cat._expanded !== false || isChildActive) && hasChildren;
        const safeId = escapeAttr(cat.id);
        const safeCatColor = sanitizeColor(cat.color) || '#6366f1';

        html += `
        <div class="cat-nav-group" ${canManageCats ? `draggable="true"` : ''} data-cat-id="${safeId}" data-cat-index="${idx}"
             ${canManageCats ? `ondragstart="handleCatDragStart(event, '${safeId}')"
             ondragend="handleCatDragEnd(event)"
             ondragover="handleCatDragOver(event)"
             ondragleave="handleCatDragLeave(event)"
             ondrop="handleCatDrop(event)"` : ''}>
            <div class="cat-nav-l1 ${isActive ? 'active' : ''}" onclick="selectCatFromSidebar('${safeId}')">
                <span class="nav-arrow ${isExpanded ? 'expanded' : ''} ${!hasChildren ? 'no-child' : ''}"
                      onclick="event.stopPropagation();toggleNavExpand('${safeId}')"><i data-feather="chevron-right"></i></span>
                <span class="nav-dot" style="background:${safeCatColor};color:${safeCatColor}"></span>
                <span class="nav-name">${escapeHtml(cat.name)}</span>
                ${totalCount > 0 ? `<span class="nav-count">${totalCount}</span>` : ''}
                ${canManageCats ? `<div class="nav-l1-actions">
                    <button class="nav-action-btn" onclick="event.stopPropagation();addSubCategoryQuick('${safeId}')" title="添加子分类"><i data-feather="plus"></i></button>
                    <button class="nav-action-btn" onclick="event.stopPropagation();editCategoryQuick('${safeId}')" title="编辑"><i data-feather="edit-3"></i></button>
                    <button class="nav-action-btn danger" onclick="event.stopPropagation();deleteCategoryQuick('${safeId}')" title="删除"><i data-feather="x"></i></button>
                </div>` : ''}
            </div>`;

        if (hasChildren) {
            html += `<div class="nav-children ${isExpanded ? 'expanded' : ''}" id="children-${safeId}">`;
            cat.children.forEach((child, childIdx) => {
                const childCnt = catCounts.get(child.id) || 0;
                const isChildActive = activeCat === child.id;
                const safeChildId = escapeAttr(child.id);
                const safeChildColor = sanitizeColor(child.color) || '#818cf8';
                html += `
                <div class="cat-nav-l2 ${isChildActive ? 'active' : ''}"
                     ${canManageCats ? `draggable="true"` : ''}
                     data-sub-id="${safeChildId}"
                     data-parent-id="${safeId}"
                     data-child-idx="${childIdx}"
                     onclick="selectCatFromSidebar('${safeChildId}')"
                     ${canManageCats ? `ondragstart="handleSubDragStart(event, '${safeId}', '${safeChildId}', ${childIdx})"
                     ondragend="handleSubDragEnd(event)"
                     ondragover="handleSubDragOver(event)"
                     ondrop="handleSubDrop(event, '${safeId}')"` : ''}>
                    ${canManageCats ? `<span class="nav-drag-sm"><i data-feather="move"></i></span>` : ''}
                    <span class="nav-dot-sm" style="background:${safeChildColor}"></span>
                    <span class="nav-name-sm">${escapeHtml(child.name)}</span>
                    ${childCnt > 0 ? `<span class="nav-count-sm">${childCnt}</span>` : ''}
                    ${canManageCats ? `<div class="nav-l1-actions">
                        <button class="nav-action-btn" onclick="event.stopPropagation();editSubCategoryQuick('${safeId}','${safeChildId}')" title="重命名"><i data-feather="edit-3"></i></button>
                        <button class="nav-action-btn danger" onclick="event.stopPropagation();deleteSubCategoryQuick('${safeId}','${safeChildId}')" title="删除"><i data-feather="x"></i></button>
                    </div>` : ''}
                </div>`;
            });
            html += `
            ${canManageCats ? `<div class="nav-add-sub" onclick="addSubCategoryQuick('${safeId}')"><i data-feather="plus"></i> 添加子分类</div>` : ''}`;
            html += `</div>`;
        }
        html += `</div>`;
    });

    html += `
    <div class="cat-drop-zone"
         id="catDropZone"
         ondragover="handleCatDropZoneOver(event)"
         ondragleave="handleCatDropZoneLeave(event)"
         ondrop="handleCatDropZoneDrop(event)">
        <span>拖到此处移至底部</span>
    </div>`;

    container.innerHTML = html;
    // 图标刷新由 render() 统一调度，此处不再单独调用

    const allItem = document.querySelector('.cat-nav-all');
    if (allItem) allItem.classList.toggle('active', !activeCat && currentFilter !== 'favorites');

    const favItem = document.querySelector('.cat-nav-favorites');
    if (favItem) favItem.classList.toggle('active', currentFilter === 'favorites');

    if (currentLayout === 'top-tabs') {
        renderTopCatTabs();
        renderSubCatOnlySection();
    }
}

// ========== 渲染上下文缓存 ==========
let _renderFavSet = null;
let _renderQueryText = '';

/** 渲染单行（虚拟滚动与全量渲染共用） */
function renderItemRow(item, idx) {
    const queryText = _renderQueryText;
    const isFav = _renderFavSet ? _renderFavSet.has(item.id) : isUserFavorite(item.id);
    const plain = item.content ? stripHtml(item.content) : '';
    const canEdit = hasPermission('content.edit');
    const canDelete = hasPermission('content.delete');
    const canSort = hasPermission('content.sort');
    return `
    <tr data-item-id="${escapeAttr(item.id)}"
        data-item-idx="${idx}"
        ondragover="handleItemDragOver(event)"
        ondrop="handleItemDrop(event)"
        onclick="selectRow(event, ${idx})">
        <td class="row-num-cell" onclick="event.stopPropagation()">
            <div class="row-num" ${canSort ? `draggable="true"
                data-item-id="${escapeAttr(item.id)}"
                ondragstart="handleItemDragStart(event, '${escapeAttr(item.id)}')"
                ondragend="handleItemDragEnd(event)"` : ''}
                title="${canSort ? '拖拽排序' : ''}">
                <span class="num-text">${idx + 1}</span>
            </div>
        </td>
        <td onclick="event.stopPropagation()">
            <button class="fav-btn ${isFav ? 'active' : ''}" onclick="toggleFavorite('${escapeAttr(item.id)}')">
                <i data-feather="star"></i>
            </button>
        </td>
        <td>
            <div class="row-title">
                <span>${highlightText((item.title || '').substring(0, 26), queryText)}</span>
                ${item.content && /<img/i.test(item.content) ? '<span class="has-img-badge"><i data-feather="image"></i> 含图</span>' : ''}
            </div>
        </td>
        <td onclick="event.stopPropagation();handleRowClick(event, '${escapeAttr(item.id)}', ${idx})" style="cursor:pointer">
            <div class="row-desc">${highlightText(plain.substring(0, 40), queryText)}${plain.length > 40 ? '...' : ''}</div>
        </td>
        <td>
            ${getCategoryLabel(item.categoryId)}
        </td>
        <td>
            ${getUserLabel(item.createdBy)}
        </td>
        <td>
            <div class="row-time">${formatDate(item.updatedAt || item.createdAt)}</div>
        </td>
        <td onclick="event.stopPropagation()">
            <div class="row-ops">
                <button class="op-btn op-copy" onclick="copyItem('${escapeAttr(item.id)}')">复制</button>
                ${canEdit ? `<button class="op-btn op-edit" onclick="editItem('${escapeAttr(item.id)}')">编辑</button>` : ''}
                ${canDelete ? `<button class="op-btn op-del" onclick="deleteItemConfirm('${escapeAttr(item.id)}')">删除</button>` : ''}
            </div>
        </td>
    </tr>`;
}

function renderList() {
    const tbody = document.getElementById('dataTableBody');
    if (!tbody) return;
    let items = [...(appData.items || [])];

    const favIds = getLocalFavorites();
    _renderFavSet = new Set(favIds);
    const qInput = document.getElementById('qInput');
    const q = (qInput ? qInput.value : '').toLowerCase().trim();
    _renderQueryText = q;

    if (activeCat) {
        const selectedCat = findCategoryById(activeCat);
        if (!selectedCat) {
            items = [];
        } else if (selectedCat.parentId) {
            items = items.filter(item => item.categoryId === activeCat);
        } else {
            const childIdSet = selectedCat.children ? new Set(selectedCat.children.map(c => c.id)) : null;
            items = items.filter(item => {
                if (item.categoryId === activeCat) return true;
                return childIdSet ? childIdSet.has(item.categoryId) : false;
            });
        }
    }

    if (q) {
        items = items.filter(item => {
            const title = (item.title || '').toLowerCase();
            const content = item.content ? stripHtml(item.content).toLowerCase() : '';
            return title.includes(q) || content.includes(q);
        });
    }

    if (currentFilter === 'img') {
        items = items.filter(item => item.content && item.content.includes('<img'));
    } else if (currentFilter === 'favorites') {
        items = items.filter(item => _renderFavSet.has(item.id));
    } else if (currentFilter === 'recent') {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const timeCache = new Map();
        items = items.filter(item => {
            if (!timeCache.has(item.id)) {
                timeCache.set(item.id, new Date(item.updatedAt || item.createdAt).getTime());
            }
            return timeCache.get(item.id) > weekAgo;
        });
    }

    if (items.length === 0) {
        teardownVirtualScroll();
        const canCreate = hasPermission('content.create');
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <div class="empty-icon"><i data-feather="inbox"></i></div>
                        <div class="empty-title">暂无文案</div>
                        <div class="empty-desc">${canCreate ? '点击右上角"新增"按钮添加第一条文案' : '暂无可用文案'}</div>
                        ${canCreate ? `<button class="empty-action" onclick="openModal()"><i data-feather="plus"></i> 新增文案</button>` : ''}
                    </div>
                </td>
            </tr>
        `;
        // 图标刷新由 render() 统一调度
    } else if (items.length > VIRTUAL_THRESHOLD) {
        const ok = renderVirtualList(items, tbody, renderItemRow);
        if (!ok) {
            tbody.innerHTML = items.map(function (item, idx) { return renderItemRow(item, idx); }).join('');
        }
    } else {
        teardownVirtualScroll();
        tbody.innerHTML = items.map(function (item, idx) { return renderItemRow(item, idx); }).join('');
    }

    const cntAllEl = document.getElementById('cntAll');
    const cntShowEl = document.getElementById('cntShow');
    if (cntAllEl) cntAllEl.textContent = (appData.items || []).length;
    if (cntShowEl) cntShowEl.textContent = items.length;
    appState.setState('ui.filteredItemsCount', items.length);

    if (selectedRowIdx >= items.length) {
        appState.setState('ui.selectedRowIdx', items.length - 1);
    }
    if (selectedRowIdx >= 0) {
        requestAnimationFrame(highlightSelectedRow);
    }
    // 虚拟滚动模式下，selectedRowIdx 校正后需重新同步可视区
    if (typeof isVirtualScrollActive === 'function' && isVirtualScrollActive() && typeof updateVirtualView === 'function') {
        updateVirtualView();
    }

    // 刷新表格内的 Feather Icons（搜索时直接调用 renderList 需要刷新图标）
    requestAnimationFrame(() => {
        refreshFeatherIn(tbody);
    });
}

function updateStats() {
    const allEl = document.getElementById('navAllCount');
    const favEl = document.getElementById('navFavCount');
    const items = appData.items || [];
    const total = items.length;
    const itemIdSet = new Set(items.map(i => i.id));
    const favCount = getLocalFavorites().filter(id => itemIdSet.has(id)).length;
    if (allEl) allEl.textContent = total;
    if (favEl) favEl.textContent = favCount;

    const greetingTotalEl = document.getElementById('greetingTotal');
    const greetingFavEl = document.getElementById('greetingFav');
    if (greetingTotalEl) greetingTotalEl.textContent = total;
    if (greetingFavEl) greetingFavEl.textContent = favCount;
}

function updateGreeting() {
    const greetingEl = document.getElementById('greetingText');
    if (!greetingEl) return;
    const now = new Date();
    const hour = now.getHours();
    let text, icon, quotes;
    if (hour >= 5 && hour < 9) {
        text = '早上好'; icon = 'sun';
        quotes = ['新的一天，从一条好文案开始', '清晨的灵感最珍贵，快记下来', '早起的人，已经赢在开头了'];
    } else if (hour >= 9 && hour < 12) {
        text = '上午好'; icon = 'star';
        quotes = ['状态正好，适合高效产出', '好文案是改出来的，动手吧', '专注一小时，胜过忙碌一整天'];
    } else if (hour >= 12 && hour < 14) {
        text = '中午好'; icon = 'coffee';
        quotes = ['吃好喝好，灵感才会来敲门', '午后小憩，让思路清零重启'];
    } else if (hour >= 14 && hour < 18) {
        text = '下午好'; icon = 'coffee';
        quotes = ['来杯咖啡，文思如泉涌', '灵感卡壳时，翻翻收藏夹', '先写出烂稿，再慢慢改好'];
    } else if (hour >= 18 && hour < 22) {
        text = '晚上好'; icon = 'moon';
        quotes = ['夜晚适合把想法沉淀成文字', '今天的积累，是明天的素材库'];
    } else {
        text = '夜深了'; icon = 'moon';
        quotes = ['灵感记下就好，早点休息', '熬夜伤神，好文案明天再写'];
    }
    const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    greetingEl.innerHTML = `${text} <i data-feather="${icon}" style="width:16px;height:16px;vertical-align:-2px;"></i><span class="greeting-date">${now.getMonth() + 1}月${now.getDate()}日 · 周${week}</span>`;
    const quoteEl = document.getElementById('greetingQuote');
    if (quoteEl) quoteEl.textContent = quotes[Math.floor(Math.random() * quotes.length)];
}

// ========== 搜索关键词高亮 ==========

function highlightText(text, query) {
    if (!query || !text) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return escaped.replace(new RegExp(q, 'gi'), match => `<mark class="hl-keyword">${match}</mark>`);
    } catch {
        return escaped;
    }
}

function highlightSelectedRow() {
    const tbody = document.querySelector('#dataTableBody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr[data-item-id]'));

    rows.forEach(row => row.classList.remove('row-selected'));

    if (selectedRowIdx < 0) return;
    const target = rows.find(row => parseInt(row.getAttribute('data-item-idx'), 10) === selectedRowIdx);
    if (target) target.classList.add('row-selected');
}
