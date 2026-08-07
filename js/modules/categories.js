async function addCategoryQuick() {
    if (!hasPermission('categories.manage')) {
        showToast('无分类管理权限', 'error');
        return;
    }
    const name = await showInputDialog('请输入分类名称：', { icon: 'folder', placeholder: '分类名称' });
    if (name && name.trim()) {
        const newCat = {
            id: 'cat_' + Date.now(),
            name: name.trim(),
            color: getRandomColor()
        };
        appData.categories.push(newCat);
        await saveData();
        buildIndices();
        renderCategories();
        renderTopCatTabs();
        updateStats();
        showToast('分类创建成功', 'success');
    }
}

async function addCategoryFromDropdown() {
    if (!hasPermission('categories.manage')) {
        showToast('无分类管理权限', 'error');
        return;
    }
    const name = await showInputDialog('请输入分类名称：', { icon: 'folder', placeholder: '分类名称' });
    if (name && name.trim()) {
        const newCat = {
            id: 'cat_' + Date.now(),
            name: name.trim(),
            color: getRandomColor()
        };
        appData.categories.push(newCat);
        await saveData();
        buildIndices();
        renderCategories();
        renderCatDropdown();
        updateStats();
        showToast('分类创建成功', 'success');
    }
    closeCatDropdown();
}

/** 快速添加子分类 */
async function addSubCategoryQuick(parentId) {
    if (!hasPermission('categories.manage')) {
        showToast('无分类管理权限', 'error');
        return;
    }
    const parent = findCategoryById(parentId);
    if (!parent) return;

    const name = await showInputDialog('请输入「' + parent.name + '」的子分类名称：', { icon: 'folder', placeholder: '子分类名称' });
    if (!name || !name.trim()) return;

    const colors = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#10b981','#06b6d4','#3b82f6'];
    const newSub = {
        id: 'sub_' + Date.now(),
        name: name.trim(),
        color: colors[Math.floor(Math.random() * colors.length)],
        parentId: parentId
    };

    if (!parent.children) parent.children = [];
    parent.children.push(newSub);
    parent._expanded = true;

    if (!(await saveData())) { loadData(); return; }
    buildIndices();
    renderCategories();
    showToast('子分类「' + newSub.name + '」已创建', 'success');
}

/** 快速编辑分类 */
async function editCategoryQuick(catId) {
    if (!hasPermission('categories.manage')) {
        showToast('无分类管理权限', 'error');
        return;
    }
    const cat = findCategoryById(catId);
    if (!cat) return;

    const newName = await showInputDialog('修改分类名称：', { icon: 'edit-3', placeholder: '新名称', defaultValue: cat.name });
    if (!newName || !newName.trim() || newName.trim() === cat.name) return;

    cat.name = newName.trim();
    if (!(await saveData())) { loadData(); return; }
    buildIndices();
    renderCategories();
    showToast('已重命名为「' + cat.name + '」', 'success');
}

/** 快速删除分类 */
async function deleteCategoryQuick(catId) {
    if (!hasPermission('categories.manage')) {
        showToast('无分类管理权限', 'error');
        return;
    }
    const cat = findCategoryById(catId);
    if (!cat) return;

    let msg = '确定删除分类「' + cat.name + '」吗？';
    const affectedCount = countItemsInCategory(catId);
    if (affectedCount > 0) msg += '\n该分类及子分类下有 ' + affectedCount + ' 条文案将变为无分类。';
    if (cat.children?.length > 0) msg += '\n以及 ' + cat.children.length + ' 个子分类。';

    const ok = await showConfirm(msg, 'trash-2');
    if (!ok) return;

    // 从分类列表中移除
    appData.categories = appData.categories.filter(c => c.id !== catId);
    appData.categories.forEach(c => {
        if (c.children) c.children = c.children.filter(ch => ch.id !== catId);
    });
    // 文案处理：把该分类及其所有子分类下的文案都置为无分类
    // 使用 Set 优化查找性能
    const childIdSet = new Set(cat.children ? cat.children.map(ch => ch.id) : []);
    for (const item of (appData.items || [])) {
        if (item.categoryId === catId || childIdSet.has(item.categoryId)) {
            item.categoryId = null;
        }
    }

    if (activeCat === catId || childIdSet.has(activeCat)) appState.setState('ui.activeCategory', null);
    if (!(await saveData())) { loadData(); return; }
    buildIndices();
    renderCategories();
    renderList();
    updateStats();
    showToast('分类已删除', 'success');
}

/** 快速重命名子分类 */
async function editSubCategoryQuick(parentId, childId) {
    if (!hasPermission('categories.manage')) {
        showToast('无分类管理权限', 'error');
        return;
    }
    const parent = findCategoryById(parentId);
    if (!parent || !parent.children) return;
    const child = parent.children.find(c => c.id === childId);
    if (!child) return;

    const newName = await showInputDialog('重命名子分类：', { icon: 'edit-3', placeholder: '新名称', defaultValue: child.name });
    if (newName && newName.trim() && newName.trim() !== child.name) {
        child.name = newName.trim();
        await saveData();
        buildIndices();
        renderCategories();
        showToast('子分类已重命名', 'success');
    }
}

/** 快速删除子分类 */
async function deleteSubCategoryQuick(parentId, childId) {
    if (!hasPermission('categories.manage')) {
        showToast('无分类管理权限', 'error');
        return;
    }
    buildIndices();
    const parent = findCategoryById(parentId);
    if (!parent || !parent.children) return;
    const child = parent.children.find(c => c.id === childId);
    if (!child) return;

    let affectedCount = 0;
    for (const item of (appData.items || [])) {
        if (item.categoryId === childId) affectedCount++;
    }
    let msg = '确定删除子分类「' + child.name + '」吗？';
    if (affectedCount > 0) msg += '\n该分类下有 ' + affectedCount + ' 条文案将变为无分类。';

    const ok = await showConfirm(msg, 'trash-2');
    if (!ok) return;

    parent.children = parent.children.filter(c => c.id !== childId);
    (appData.items || []).forEach(item => { if (item.categoryId === childId) item.categoryId = null; });
    if (activeCat === childId) appState.setState('ui.activeCategory', null);
    if (parent.children.length > 0) parent._expanded = true;
    if (!(await saveData())) { loadData(); return; }
    buildIndices();
    renderCategories();
    renderList();
    updateStats();
    showToast('子分类已删除', 'success');
}

function toggleCatDropdown() {
    const wrapper = document.getElementById('catSelectWrapper');
    if (!wrapper) return;
    wrapper.classList.toggle('open');
    if (wrapper.classList.contains('open')) {
        renderCatDropdown();
        const searchInput = document.getElementById('catDropdownSearchInput');
        if (searchInput) searchInput.focus();
    }
}

function closeCatDropdown() {
    const wrapper = document.getElementById('catSelectWrapper');
    if (wrapper) wrapper.classList.remove('open');
}

function renderCatDropdown() {
    const list = document.getElementById('catDropdownList');
    if (!list) return;
    list.innerHTML = `
        <div class="cat-opt-none ${!selectedCategoryId ? 'selected' : ''}" onclick="selectCategory(null)">
            不分类
        </div>
        ${(appData.categories || []).map(cat => {
            const dc = sanitizeColor(cat.color) || '#6366f1';
            return `
            <div class="cat-opt-item ${selectedCategoryId === cat.id ? 'selected' : ''}" onclick="selectCategory('${escapeAttr(cat.id)}')">
                <span class="cat-opt-dot" style="width:9px;height:9px;border-radius:50%;background:${dc}"></span>
                <span class="cat-opt-name">${escapeHtml(cat.name)}</span>
                <span class="cat-opt-count">${countItemsInCategory(cat.id)}</span>
            </div>
            ${cat.children ? `
                <div class="cat-opt-children">
                    ${cat.children.map(child => {
                        const scc = sanitizeColor(child.color) || '#818cf8';
                        return `
                        <div class="cat-opt-child ${selectedCategoryId === child.id ? 'selected' : ''}" onclick="selectCategory('${escapeAttr(child.id)}')">
                            <span class="cat-opt-dot-sm" style="width:7px;height:7px;border-radius:50%;background:${scc}"></span>
                            <span class="cat-opt-name-sm">${escapeHtml(child.name)}</span>
                            <span class="cat-opt-count-sm">${countItemsInCategory(child.id)}</span>
                        </div>
                    `;}).join('')}
                </div>
            ` : ''}
        `;}).join('')}
    `;
}

function selectCategory(id) {
    appState.setState('ui.selectedCategoryId', id);
    updateCatSelectText();
    renderCatDropdown();
    closeCatDropdown();
}

function updateCatSelectText() {
    const textEl = document.getElementById('catSelectText');
    const dotEl = document.getElementById('catSelectDot');
    if (!textEl) return;
    if (!selectedCategoryId) {
        textEl.textContent = '选择分类...';
        textEl.classList.add('placeholder');
        if (dotEl) dotEl.style.display = 'none';
    } else {
        const cat = findCategoryById(selectedCategoryId);
        if (cat) {
            // 拼接父级路径：如 "实操 / 追单"
            let path = cat.name;
            if (cat.parentId) {
                const parent = findCategoryById(cat.parentId);
                if (parent) path = parent.name + ' / ' + path;
            }
            textEl.textContent = path;
            textEl.classList.remove('placeholder');

            // 同时显示颜色圆点
            if (dotEl) {
                const safeColor = sanitizeColor(cat.color) || '#6366f1';
                dotEl.style.background = safeColor;
                dotEl.style.display = 'inline-flex';
            }
        } else {
            textEl.textContent = '选择分类...';
            textEl.classList.add('placeholder');
            if (dotEl) dotEl.style.display = 'none';
        }
    }
}

function filterCatDropdown(q) {
    q = q.toLowerCase().trim();
    const items = document.querySelectorAll('#catDropdownList .cat-opt-item, #catDropdownList .cat-opt-child, #catDropdownList .cat-opt-none');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? '' : 'none';
    });
}
