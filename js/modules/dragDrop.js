// ========== 拖拽排序功能 ==========

/** 生成美观的拖拽预览图像 */
function setDragPreview(e, label) {
    const preview = document.createElement('div');
    preview.textContent = '⠿  ' + (label.length > 20 ? label.substring(0, 18) + '..' : label);
    preview.style.cssText = [
        'position:fixed;left:-9999px;top:-9999px',
        'display:inline-flex;align-items:center;gap:6px',
        'padding:8px 16px',
        'background:linear-gradient(135deg,#6366f1,#4f46e5)',
        'color:white;font-size:13px;font-weight:600',
        'border-radius:8px',
        'box-shadow:0 8px 24px rgba(99,102,241,0.4)',
        'white-space:nowrap',
        'pointer-events:none;z-index:99999'
    ].join(';');
    document.body.appendChild(preview);
    e.dataTransfer.setDragImage(preview, 12, 14);
    requestAnimationFrame(function() { document.body.removeChild(preview); });
}

let dragSrcId = null;
let dragSrcIndex = null;

function handleCatDragStart(e, catId) {
    dragSrcId = catId;
    dragSrcIndex = parseInt(e.currentTarget.dataset.catIndex, 10);
    if (isNaN(dragSrcIndex)) { dragSrcId = null; return; }
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', catId);

    const catName = e.currentTarget.querySelector('.nav-name')?.textContent || '分类';
    setDragPreview(e, catName);
}

function handleCatDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.cat-nav-group').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-bottom');
    });
    dragSrcId = null;
    dragSrcIndex = null;
}

function handleCatDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const targetGroup = e.currentTarget;
    if (targetGroup.classList.contains('cat-nav-group') && !targetGroup.classList.contains('dragging')) {
        targetGroup.classList.add('drag-over');
        targetGroup.classList.remove('drag-over-bottom');
    }
}

function handleCatDragLeave(e) {
    const targetGroup = e.currentTarget;
    const relatedTarget = e.relatedTarget;
    if (!targetGroup.contains(relatedTarget)) {
        targetGroup.classList.remove('drag-over', 'drag-over-bottom');
    }
}

function handleCatDrop(e) {
    e.preventDefault();
    const targetGroup = e.currentTarget;
    targetGroup.classList.remove('drag-over', 'drag-over-bottom');

    if (dragSrcId === null || targetGroup.classList.contains('dragging')) return;

    const targetId = targetGroup.dataset.catId;
    if (targetId === dragSrcId) return;

    const targetIndex = parseInt(targetGroup.dataset.catIndex, 10);
    if (isNaN(targetIndex)) return;
    reorderCategories(dragSrcIndex, targetIndex);
}

/** 重新排列分类顺序 */
function reorderCategories(fromIndex, toIndex) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= (appData.categories||[]).length || toIndex >= (appData.categories||[]).length) return;
    const [movedCat] = appData.categories.splice(fromIndex, 1);
    // 移除后，若源在目标之前，目标索引需要前移一位以保持原位置语义
    const adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
    appData.categories.splice(adjustedTo, 0, movedCat);
    saveData().then(function(ok) {
        if (!ok) { loadData(); showToast('保存失败，已恢复', 'error', 1500); return; }
        showToast('分类顺序已更新', 'success', 1500);
    });
    buildIndices();
    renderCategories();
}

// ========== 子分类（L2）拖拽排序 ==========

let subDragSrcId = null;   // 被拖的子分类ID
let subDragParentId = null; // 被拖子分类的父级ID
let subDragSrcIdx = null;

function handleSubDragStart(e, parentId, childId, idx) {
    subDragSrcId = childId;
    subDragParentId = parentId;
    subDragSrcIdx = idx;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', childId);

    const childName = e.currentTarget.querySelector('.nav-name-sm')?.textContent || '子分类';
    setDragPreview(e, childName);
}

function handleSubDragEnd(e) {
    e.currentTarget.classList.remove('dragging', 'drag-over-sub');
    const subs = document.querySelectorAll('.cat-nav-l2.drag-over-sub');
    for (let i = 0; i < subs.length; i++) subs[i].classList.remove('drag-over-sub');
    const zone = document.getElementById('catDropZone');
    if (zone) zone.classList.remove('drag-over');
    subDragSrcId = null;
    subDragParentId = null;
    subDragSrcIdx = null;
}

function handleSubDragOver(e) {
    e.preventDefault();
    const target = e.currentTarget;
    if (!target.classList.contains('dragging')) {
        document.querySelectorAll('.cat-nav-l2.drag-over-sub').forEach(function(el) { el.classList.remove('drag-over-sub'); });
        target.classList.add('drag-over-sub');
    }
}

function handleSubDrop(e, parentId) {
    e.preventDefault();
    e.stopPropagation();
    const targetEl = e.currentTarget;
    targetEl.classList.remove('drag-over-sub');

    if (!subDragSrcId || targetEl.classList.contains('dragging')) return;

    // 只能在同一父分类下排序
    if (subDragParentId !== parentId) {
        showToast('只能在同一父分类下调整顺序', 'warning', 1500);
        return;
    }

    const targetChildId = targetEl.getAttribute('data-sub-id');
    if (!targetChildId || targetChildId === subDragSrcId) return;

    const parent = findCategoryById(parentId);
    if (!parent || !parent.children) return;

    let srcIdx = -1, tgtIdx = -1;
    for (let i = 0; i < parent.children.length; i++) {
        if (parent.children[i].id === subDragSrcId) srcIdx = i;
        if (parent.children[i].id === targetChildId) tgtIdx = i;
    }
    if (srcIdx < 0 || tgtIdx < 0) return;

    const moved = parent.children.splice(srcIdx, 1)[0];
    const adjustedTgt = srcIdx < tgtIdx ? tgtIdx - 1 : tgtIdx;
    parent.children.splice(adjustedTgt, 0, moved);

    saveData().then(function(ok) {
        if (!ok) { loadData(); showToast('保存失败，已恢复', 'error', 1200); return; }
        showToast('子分类顺序已调整', 'success', 1200);
    });
    buildIndices();
    renderCategories();
}

// ========== 分类侧边栏底部拖放区域 ==========

function handleCatDropZoneOver(e) {
    e.preventDefault();
    // 仅在分类或子分类拖拽时高亮（item 拖拽不高亮）
    if (dragSrcId === null && subDragSrcId === null) return;
    const zone = document.getElementById('catDropZone');
    if (zone) zone.classList.add('drag-over');
}

function handleCatDropZoneLeave(e) {
    const zone = document.getElementById('catDropZone');
    if (zone && !zone.contains(e.relatedTarget)) {
        zone.classList.remove('drag-over');
    }
}

function handleCatDropZoneDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const zone = document.getElementById('catDropZone');
    if (zone) zone.classList.remove('drag-over');

    // 处理一级分类拖到底部
    if (dragSrcId !== null) {
        const cats = appData.categories || [];
        let srcIdx = -1;
        for (let i = 0; i < cats.length; i++) {
            if (cats[i].id === dragSrcId) { srcIdx = i; break; }
        }
        if (srcIdx >= 0) {
            const moved = cats.splice(srcIdx, 1)[0];
            cats.push(moved);
            saveData().then(function(ok) {
                if (!ok) { loadData(); showToast('保存失败，已恢复', 'error', 1200); return; }
                showToast('已移至底部', 'success', 1200);
            });
            buildIndices();
            renderCategories();
            return;
        }
    }

    // 处理子分类拖到底部
    if (subDragSrcId !== null) {
        const parent = findCategoryById(subDragParentId);
        if (parent && parent.children) {
            let sIdx = -1;
            for (let j = 0; j < parent.children.length; j++) {
                if (parent.children[j].id === subDragSrcId) { sIdx = j; break; }
            }
            if (sIdx >= 0) {
                const smoved = parent.children.splice(sIdx, 1)[0];
                parent.children.push(smoved);
                saveData().then(function(ok) {
                    if (!ok) { loadData(); showToast('保存失败，已恢复', 'error', 1200); return; }
                    showToast('子分类已移至底部', 'success', 1200);
                });
                buildIndices();
                renderCategories();
            }
        }
    }
}

// ========== 文案拖拽排序 ==========

let itemDragSrcId = null;

function handleItemDragStart(e, itemId) {
    itemDragSrcId = itemId;
    const row = e.currentTarget.closest('tr');
    if (row) row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);

    const title = row?.querySelector('.row-title span')?.textContent || '文案';
    setDragPreview(e, title);
}

function handleItemDragEnd(e) {
    const row = e.currentTarget.closest('tr');
    if (row) row.classList.remove('dragging');
    const rows = document.querySelectorAll('#dataTableBody tr.drag-over');
    for (let i = 0; i < rows.length; i++) rows[i].classList.remove('drag-over');
    itemDragSrcId = null;
}

function handleItemDragOver(e) {
    e.preventDefault();
    if (!e.currentTarget.classList.contains('dragging')) {
        const rows = document.querySelectorAll('#dataTableBody tr.drag-over');
        for (let i = 0; i < rows.length; i++) rows[i].classList.remove('drag-over');
        e.currentTarget.classList.add('drag-over');
    }
}

function handleItemDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetRow = e.currentTarget;
    targetRow.classList.remove('drag-over');

    // 获取目标行的ID
    const targetId = targetRow.dataset.itemId || targetRow.getAttribute('data-item-id') || null;

    if (!itemDragSrcId || !targetId || itemDragSrcId === targetId) return;

    // 在完整数据数组中找到两个位置并交换
    const items = appData.items || [];
    let srcIdx = -1, tgtIdx = -1;
    for (let i = 0; i < items.length; i++) {
        if (items[i].id === itemDragSrcId) srcIdx = i;
        if (items[i].id === targetId) tgtIdx = i;
    }
    if (srcIdx < 0 || tgtIdx < 0) return;

    // 移动元素
    const moved = items.splice(srcIdx, 1)[0];
    const adjustedTgt = srcIdx < tgtIdx ? tgtIdx - 1 : tgtIdx;
    items.splice(adjustedTgt, 0, moved);

    saveItemOrder().then(function(ok) {
        if (!ok) { loadData(); showToast('保存失败，已恢复', 'error', 1200); return; }
        showToast('顺序已调整', 'success', 1200);
    });
    renderList();
}

// ========== 底部拖放区域（移至末尾） ==========

// 缓存拖放区域元素引用，避免频繁 DOM 查询
let _dataTableDropZone = null;
function getDataTableDropZone() {
    if (!_dataTableDropZone) {
        _dataTableDropZone = document.getElementById('dataTableDropZone');
    }
    return _dataTableDropZone;
}

function handleDropZoneOver(e) {
    e.preventDefault();
    const zone = getDataTableDropZone();
    if (zone) zone.classList.add('drag-over');
}

function handleDropZoneLeave(e) {
    // 检查是否真的离开了区域
    const zone = getDataTableDropZone();
    if (zone && !zone.contains(e.relatedTarget)) {
        zone.classList.remove('drag-over');
    }
}

function handleDropZoneDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const zone = getDataTableDropZone();
    if (zone) zone.classList.remove('drag-over');

    if (!itemDragSrcId) return;

    const items = appData.items || [];
    let srcIdx = -1;
    for (let i = 0; i < items.length; i++) {
        if (items[i].id === itemDragSrcId) { srcIdx = i; break; }
    }
    if (srcIdx < 0) return;

    // 移到数组最末尾
    const moved = items.splice(srcIdx, 1)[0];
    items.push(moved);

    saveItemOrder().then(function(ok) {
        if (!ok) { loadData(); showToast('保存失败，已恢复', 'error', 1200); return; }
        showToast('已移至底部', 'success', 1200);
    });
    renderList();
}
