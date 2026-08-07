/* Cpydes 管理后台 —— 由 admin.js 机械拆分（admin-content.js），依赖 admin-core.js 先加载 */
'use strict';

/* ========== 文案管理 ========== */
function findCategoryById(id) {
    for (const c of AdminState.data.categories) {
        if (c.id === id) return c;
        if (c.children) {
            const ch = c.children.find(x => x.id === id);
            if (ch) return ch;
        }
    }
    return null;
}

function getCategoryFullName(catId) {
    if (!catId) return null;
    for (const c of AdminState.data.categories) {
        if (c.id === catId) return c.name || '';
        if (c.children) {
            const ch = c.children.find(x => x.id === catId);
            if (ch) return (c.name || '') + ' / ' + (ch.name || '');
        }
    }
    return null;
}

/** 根据用户 ID 获取用户名标签 */
function getUserLabel(userId) {
    if (!userId) return '<span style="color:var(--t3)">-</span>';
    const users = AdminState.data.users || [];
    const user = users.find(u => u.id === userId);
    if (user) {
        const roleBadge = user.role === 'admin' || user.role === 'role_admin'
            ? ' <span style="background:#fef3c7;color:#b45309;font-size:10px;padding:1px 4px;border-radius:3px;">管理员</span>'
            : '';
        return `<span style="color:var(--pri);">${escapeHtml(user.username)}${roleBadge}</span>`;
    }
    return '<span style="color:var(--t3)">未知用户</span>';
}

function renderContent() {
    const data = AdminState.data;
    const f = AdminState.contentFilter;
    let items = data.items.slice();

    // 权限检查
    const canCreate = hasPermission('content.create');
    const canEdit = hasPermission('content.edit');
    const canDelete = hasPermission('content.delete');
    const canBatch = canEdit || canDelete;

    // 收集所有标签
    const tagSet = new Set();
    items.forEach(it => {
        if (Array.isArray(it.tags)) it.tags.forEach(t => tagSet.add(t));
    });
    AdminState.contentAllTags = Array.from(tagSet).sort();

    // 搜索过滤（标题/内容/标签）
    if (f.keyword) {
        const kw = f.keyword.toLowerCase();
        items = items.filter(it => {
            const title = (it.title || '').toLowerCase();
            const content = stripHtml(it.content || '').toLowerCase();
            const tags = (Array.isArray(it.tags) ? it.tags.join(' ') : '').toLowerCase();
            return title.includes(kw) || content.includes(kw) || tags.includes(kw);
        });
    }
    // 分类过滤
    if (f.categoryId) {
        const cat = findCategoryById(f.categoryId);
        const childIds = cat && cat.children ? cat.children.map(c => c.id) : [];
        items = items.filter(it => it.categoryId === f.categoryId || childIds.includes(it.categoryId));
    }
    // 标签过滤
    if (f.tag) {
        items = items.filter(it => Array.isArray(it.tags) && it.tags.includes(f.tag));
    }

    // 排序
    const sf = f.sortField || 'updatedAt';
    const sd = f.sortDir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
        let va, vb;
        if (sf === 'title') {
            va = (a.title || '').toLowerCase();
            vb = (b.title || '').toLowerCase();
            return va < vb ? -sd : va > vb ? sd : 0;
        } else if (sf === 'category') {
            const ca = getCategoryFullName(a.categoryId) || '';
            const cb = getCategoryFullName(b.categoryId) || '';
            return ca < cb ? -sd : ca > cb ? sd : 0;
        } else if (sf === 'createdAt') {
            va = new Date(a.createdAt || 0).getTime();
            vb = new Date(b.createdAt || 0).getTime();
            return (va - vb) * sd;
        } else {
            va = new Date(a.updatedAt || a.createdAt || 0).getTime();
            vb = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return (va - vb) * sd;
        }
    });

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / AdminState.contentPageSize));
    if (AdminState.contentPage > totalPages) AdminState.contentPage = totalPages;
    const start = (AdminState.contentPage - 1) * AdminState.contentPageSize;
    const pageItems = items.slice(start, start + AdminState.contentPageSize);
    const pageIds = pageItems.map(it => it.id);
    AdminState._contentPageIds = pageIds;

    const catOptions = buildCategoryOptions(f.categoryId);
    const tagOptions = AdminState.contentAllTags.map(t =>
        `<option value="${escapeAttr(t)}"${t === f.tag ? ' selected' : ''}>${escapeHtml(t)}</option>`
    ).join('');

    // 批量选择状态
    const selectedCount = AdminState.contentSelected.size;
    const allPageSelected = pageIds.length > 0 && pageIds.every(id => AdminState.contentSelected.has(id));

    // 排序指示器
    const sortIcon = (field) => {
        if (f.sortField !== field) return '<i data-feather="chevrons-up" style="width:11px;height:11px;opacity:0.3;vertical-align:middle;"></i>';
        return f.sortDir === 'asc'
            ? '<i data-feather="chevron-up" style="width:12px;height:12px;vertical-align:middle;color:var(--pri)"></i>'
            : '<i data-feather="chevron-down" style="width:12px;height:12px;vertical-align:middle;color:var(--pri)"></i>';
    };
    const sortTh = (field, label, width) =>
        `<th${width ? ` style="width:${width}"` : ''} class="th-sortable" onclick="onContentSort('${field}')">${label} ${sortIcon(field)}</th>`;

    const html = `
    <div class="toolbar">
        <div class="toolbar-left">
            <input type="text" class="search-input" placeholder="搜索标题/内容/标签..." value="${escapeAttr(f.keyword)}"
                   oninput="onContentSearch(this.value)" autocomplete="off">
            <select class="filter-select" onchange="onContentCatChange(this.value)">
                <option value="">全部分类</option>
                ${catOptions}
            </select>
            <select class="filter-select" onchange="onContentTagChange(this.value)" style="width:130px">
                <option value="">全部标签</option>
                ${tagOptions}
            </select>
            <select class="filter-select" onchange="onContentSortChange(this.value)" style="width:130px">
                <option value="updatedAt-desc"${f.sortField==='updatedAt'&&f.sortDir==='desc'?' selected':''}>最近更新</option>
                <option value="updatedAt-asc"${f.sortField==='updatedAt'&&f.sortDir==='asc'?' selected':''}>最早更新</option>
                <option value="createdAt-desc"${f.sortField==='createdAt'&&f.sortDir==='desc'?' selected':''}>最近创建</option>
                <option value="title-asc"${f.sortField==='title'&&f.sortDir==='asc'?' selected':''}>标题 A-Z</option>
                <option value="title-desc"${f.sortField==='title'&&f.sortDir==='desc'?' selected':''}>标题 Z-A</option>
                <option value="category-asc"${f.sortField==='category'&&f.sortDir==='asc'?' selected':''}>分类排序</option>
            </select>
            ${(f.tag || (f.keyword && selectedCount === 0)) ? `<button class="btn btn-ghost btn-sm" onclick="AdminState.contentFilter={keyword:'',categoryId:'',tag:'',sortField:'updatedAt',sortDir:'desc'};AdminState.contentPage=1;renderContent()">重置</button>` : ''}
        </div>
        <div class="toolbar-right">
            ${canCreate ? '<button class="btn btn-primary btn-sm" onclick="openItemEditor()"><i data-feather="plus" style="width:14px;height:14px;"></i> 新增文案</button>' : ''}
        </div>
    </div>
    ${selectedCount > 0 ? `
    <div class="batch-bar">
        <div class="batch-info">
            <i data-feather="check-square" style="width:14px;height:14px;"></i>
            已选择 <strong>${selectedCount}</strong> 项
            <button class="btn btn-ghost btn-sm" onclick="clearContentSelection()">取消选择</button>
        </div>
        <div class="batch-actions">
            ${canEdit ? `<button class="btn btn-default btn-sm" onclick="openBatchTagEditor()"><i data-feather="tag" style="width:14px;height:14px;"></i> 批量标签</button>` : ''}
            ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="batchDeleteItems()"><i data-feather="trash-2" style="width:14px;height:14px;"></i> 批量删除</button>` : ''}
        </div>
    </div>` : ''}
    <div class="panel">
        <div class="panel-body no-pad">
            ${pageItems.length === 0 ?
                '<div class="empty-state"><div class="empty-icon"><i data-feather="inbox" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无文案数据</div>' + (canCreate ? '<div class="empty-hint">点击右上角"新增文案"创建</div>' : '') + '</div>' :
                `<table class="data-table">
                    <thead>
                        <tr>
                            ${canBatch ? `<th style="width:40px"><input type="checkbox" ${allPageSelected ? 'checked' : ''} onchange="toggleSelectAllPage(this.checked)" title="全选/取消当前页"></th>` : ''}
                            <th style="width:50px">#</th>
                            ${sortTh('title', '标题')}
                            <th>内容预览</th>
                            <th style="width:120px">标签</th>
                            ${sortTh('category', '分类', '130px')}
                            <th style="width:90px">创建人</th>
                            ${sortTh('createdAt', '创建时间', '140px')}
                            ${sortTh('updatedAt', '更新时间', '140px')}
                            <th style="width:${canEdit && canDelete ? '120px' : (canEdit || canDelete ? '80px' : '0')}">${canEdit || canDelete ? '操作' : ''}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pageItems.map((it, i) => {
                            const cat = it.categoryId ? findCategoryById(it.categoryId) : null;
                            const catFullName = getCategoryFullName(it.categoryId);
                            const catLabel = catFullName !== null ? escapeHtml(catFullName) : '<span style="color:var(--t3)">未分类</span>';
                            const catColor = cat ? (sanitizeColor(cat.color) || '#6366f1') : '#9ca3af';
                            const preview = truncate(stripHtml(it.content), 60);
                            const tags = Array.isArray(it.tags) ? it.tags : [];
                            const tagsHtml = tags.slice(0, 3).map(tg => `<span class="content-tag" onclick="AdminState.contentFilter.tag='${escapeAttr(tg)}';AdminState.contentPage=1;renderContent()">${escapeHtml(tg)}</span>`).join('') + (tags.length > 3 ? `<span class="content-tag-more" title="${escapeAttr(tags.slice(3).join(', '))}">+${tags.length-3}</span>` : '');
                            const isSelected = AdminState.contentSelected.has(it.id);
                            return `
                            <tr class="${isSelected ? 'row-selected' : ''}">
                                ${canBatch ? `<td><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleContentSelect('${escapeAttr(it.id)}', this.checked)"></td>` : ''}
                                <td class="cell-id">${start + i + 1}</td>
                                <td class="cell-title">
                                    <span class="title-text"${canEdit ? ` ondblclick="inlineEditTitle('${escapeAttr(it.id)}', event)" title="双击可快速编辑标题"` : ''}>${escapeHtml(truncate(it.title || '(无标题)', 30))}</span>
                                    ${canEdit ? `<i data-feather="edit-3" class="inline-edit-icon" onclick="inlineEditTitle('${escapeAttr(it.id)}', event)" title="快速编辑标题"></i>` : ''}
                                </td>
                                <td class="cell-preview" title="${escapeAttr(preview)}">${escapeHtml(preview) || '<span style="color:var(--t3)">-</span>'}</td>
                                <td class="cell-tags">${tagsHtml || '<span style="color:var(--t4)">-</span>'}</td>
                                <td><span class="cat-tag" style="background:${catColor}15;color:${catColor}">${catLabel}</span></td>
                                <td style="white-space:nowrap">${getUserLabel(it.createdBy)}</td>
                                <td class="cell-time">${formatDate(it.createdAt)}</td>
                                <td class="cell-time">${formatDate(it.updatedAt || it.createdAt)}</td>
                                <td class="cell-actions">
                                    <div class="row-actions">
                                        ${canEdit ? `<button class="row-btn" onclick="openItemEditor('${escapeAttr(it.id)}')"><i data-feather="edit-3" style="width:12px;height:12px;"></i> 编辑</button>` : ''}
                                        ${canDelete ? `<button class="row-btn row-btn-danger" onclick="deleteItem('${escapeAttr(it.id)}')"><i data-feather="trash-2" style="width:12px;height:12px;"></i> 删除</button>` : ''}
                                    </div>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>`
            }
        </div>
        ${total > 0 ? renderPagination(total, totalPages) : ''}
    </div>
    `;
    document.getElementById('adminContent').innerHTML = html;
    refreshFeatherIcons();
    const sels = document.querySelectorAll('.filter-select');
    sels.forEach(s => {
        if (s.options[0] && s.options[0].value === '') s.value = f.categoryId;
    });
}

function buildCategoryOptions(selectedId) {
    let html = '';
    const cats = AdminState.data.categories || [];
    cats.forEach(c => {
        html += `<option value="${escapeAttr(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`;
        if (c.children && Array.isArray(c.children) && c.children.length > 0) {
            c.children.forEach(ch => {
                html += `<option value="${escapeAttr(ch.id)}"${ch.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)} / ${escapeHtml(ch.name)}</option>`;
            });
        }
    });
    return html;
}

function renderPagination(total, totalPages) {
    const cur = AdminState.contentPage;
    const pageSize = AdminState.contentPageSize;
    const start = (cur - 1) * pageSize + 1;
    const end = Math.min(cur * pageSize, total);
    let pages = '';
    const maxShow = 7;
    let s = Math.max(1, cur - 3);
    let e = Math.min(totalPages, s + maxShow - 1);
    s = Math.max(1, e - maxShow + 1);
    if (cur > 1) pages += `<button class="page-btn" onclick="goContentPage(${cur - 1})">‹</button>`;
    for (let i = s; i <= e; i++) {
        pages += `<button class="page-btn${i === cur ? ' active' : ''}" onclick="goContentPage(${i})">${i}</button>`;
    }
    if (cur < totalPages) pages += `<button class="page-btn" onclick="goContentPage(${cur + 1})">›</button>`;
    return `
    <div class="pagination">
        <div class="pagination-info">显示 ${start}-${end} 条，共 ${total} 条</div>
        <div class="pagination-pages">${pages}</div>
    </div>`;
}

let _contentSearchTimer = null;
function onContentSearch(v) {
    clearTimeout(_contentSearchTimer);
    _contentSearchTimer = setTimeout(() => {
        AdminState.contentFilter.keyword = v;
        AdminState.contentPage = 1;
        renderContent();
    }, 300);
}
function onContentCatChange(v) {
    AdminState.contentFilter.categoryId = v;
    AdminState.contentPage = 1;
    renderContent();
}
function onContentTagChange(v) {
    AdminState.contentFilter.tag = v;
    AdminState.contentPage = 1;
    renderContent();
}
function onContentSortChange(v) {
    const [field, dir] = v.split('-');
    AdminState.contentFilter.sortField = field;
    AdminState.contentFilter.sortDir = dir;
    renderContent();
}
function onContentSort(field) {
    const f = AdminState.contentFilter;
    if (f.sortField === field) {
        f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        f.sortField = field;
        f.sortDir = (field === 'title' || field === 'category') ? 'asc' : 'desc';
    }
    renderContent();
}
function goContentPage(p) {
    AdminState.contentPage = p;
    renderContent();
}

/* ===== 批量选择与操作 ===== */
function toggleContentSelect(id, checked) {
    if (checked) AdminState.contentSelected.add(id);
    else AdminState.contentSelected.delete(id);
    renderContent();
}
function toggleSelectAllPage(checked) {
    const ids = AdminState._contentPageIds || [];
    if (checked) ids.forEach(id => AdminState.contentSelected.add(id));
    else ids.forEach(id => AdminState.contentSelected.delete(id));
    renderContent();
}
function clearContentSelection() {
    AdminState.contentSelected.clear();
    renderContent();
}
async function batchDeleteItems() {
    if (!hasPermission('content.delete')) { showToast('无删除权限', 'error'); return; }
    const ids = Array.from(AdminState.contentSelected);
    if (ids.length === 0) return;
    const ok = await showConfirm(`确定批量删除 ${ids.length} 条文案吗？此操作不可恢复。`, 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('batchDeleteItems', {
            method: 'POST',
            body: JSON.stringify({ ids }),
        });
        const j = await r.json();
        if (j.success) {
            const idSet = new Set(ids);
            AdminState.data.items = AdminState.data.items.filter(it => !idSet.has(it.id));
            AdminState.contentSelected.clear();
            showToast('已删除 ' + j.deleted + ' 条文案', 'success');
            renderContent();
        } else {
            showToast(j.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}
function openBatchTagEditor() {
    if (!hasPermission('content.edit')) { showToast('无编辑权限', 'error'); return; }
    const count = AdminState.contentSelected.size;
    if (count === 0) return;
    const allTags = AdminState.contentAllTags.map(t =>
        `<span class="tag-suggestion" onclick="addTagToBatchInput('${escapeAttr(t)}')">${escapeHtml(t)}</span>`
    ).join('');
    const bodyHtml = `
        <div class="batch-tag-form">
            <div class="form-group">
                <label class="form-label">操作模式</label>
                <select id="batchTagMode" class="form-select" onchange="onBatchTagModeChange(this.value)">
                    <option value="add">添加标签（保留已有标签）</option>
                    <option value="replace">替换标签（覆盖已有标签）</option>
                    <option value="remove">移除标签</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" id="batchTagLabel">标签（逗号分隔，最多 20 个）</label>
                <input type="text" id="batchTagInput" class="form-input" placeholder="如: 营销, 通知, 公告">
            </div>
            ${allTags ? `<div class="tag-suggestions"><div class="tag-suggestions-title">已有标签（点击添加）:</div><div class="tag-suggestions-list">${allTags}</div></div>` : ''}
            <div class="form-hint">将对 ${count} 条选中文案执行批量标签操作</div>
        </div>`;
    const footHtml = `<button class="btn btn-default" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveBatchTags()"><i data-feather="tag" style="width:14px;height:14px;"></i> 应用</button>`;
    openModal('批量标签操作', bodyHtml, footHtml);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
    refreshFeatherIcons();
}
function addTagToBatchInput(tag) {
    const input = document.getElementById('batchTagInput');
    const current = input.value.split(',').map(s => s.trim()).filter(s => s);
    if (!current.includes(tag)) current.push(tag);
    input.value = current.join(', ');
    input.focus();
}
function onBatchTagModeChange(mode) {
    const label = document.getElementById('batchTagLabel');
    const input = document.getElementById('batchTagInput');
    if (mode === 'remove') {
        label.textContent = '要移除的标签（逗号分隔）';
        input.placeholder = '输入要移除的标签...';
    } else if (mode === 'replace') {
        label.textContent = '新标签（逗号分隔，将覆盖原有标签）';
        input.placeholder = '如: 营销, 通知, 公告';
    } else {
        label.textContent = '标签（逗号分隔，最多 20 个）';
        input.placeholder = '如: 营销, 通知, 公告';
    }
}
async function saveBatchTags() {
    const mode = document.getElementById('batchTagMode').value;
    const tagsStr = document.getElementById('batchTagInput').value;
    const tags = tagsStr.split(',').map(s => s.trim()).filter(s => s !== '');
    if (tags.length === 0 && mode !== 'remove') {
        showToast('请输入至少一个标签', 'error');
        return;
    }
    const ids = Array.from(AdminState.contentSelected);
    const body = { ids, mode };
    if (mode === 'remove') body.removeTags = tags;
    else body.addTags = tags;
    try {
        const r = await adminApiFetch('batchTagItems', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        const j = await r.json();
        if (j.success) {
            // 本地更新标签
            const idSet = new Set(ids);
            AdminState.data.items.forEach(it => {
                if (!idSet.has(it.id)) return;
                let current = Array.isArray(it.tags) ? it.tags : [];
                if (mode === 'replace') {
                    current = tags.slice(0, 20);
                } else if (mode === 'add') {
                    tags.forEach(t => { if (!current.includes(t)) current.push(t); });
                    current = current.slice(0, 20);
                } else if (mode === 'remove') {
                    current = current.filter(t => !tags.includes(t));
                }
                it.tags = current;
                it.updatedAt = new Date().toISOString();
            });
            AdminState.contentSelected.clear();
            showToast('已' + (mode === 'replace' ? '替换' : (mode === 'remove' ? '移除' : '添加')) + '标签到 ' + j.updated + ' 条文案', 'success');
            closeModal();
            renderContent();
        } else {
            showToast(j.error || '操作失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

/* ===== 行内标题编辑 ===== */
function inlineEditTitle(id, evt) {
    const item = AdminState.data.items.find(i => i.id === id);
    if (!item) return;
    if (!hasPermission('content.edit')) { showToast('无编辑权限', 'error'); return; }
    const cell = evt && evt.target ? evt.target.closest('.cell-title') : null;
    if (!cell) return;
    const currentTitle = item.title || '';
    cell.innerHTML = `<input type="text" class="inline-edit-input" value="${escapeAttr(currentTitle)}" maxlength="200" style="width:100%;height:30px;padding:2px 8px;border:1px solid var(--pri);border-radius:4px;font-size:14px;">`;
    const input = cell.querySelector('input');
    if (input) {
        input.focus();
        input.select();
        let saved = false;
        const save = async () => {
            if (saved) return;
            saved = true;
            const newTitle = input.value.trim();
            if (!newTitle || newTitle === currentTitle) {
                renderContent();
                return;
            }
            const updated = { ...item, title: newTitle.substring(0, 200) };
            try {
                const r = await adminApiFetch('saveItem', {
                    method: 'POST',
                    body: JSON.stringify({ item: updated }),
                });
                const j = await r.json();
                if (j.success) {
                    const idx = AdminState.data.items.findIndex(i => i.id === id);
                    if (idx >= 0) {
                        AdminState.data.items[idx] = j.item || updated;
                    }
                    showToast('标题已更新', 'success');
                    renderContent();
                } else {
                    showToast(j.error || '保存失败', 'error');
                    renderContent();
                }
            } catch (e) {
                showToast('网络错误', 'error');
                renderContent();
            }
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            else if (e.key === 'Escape') { saved = true; renderContent(); }
        });
        input.addEventListener('blur', save);
    }
}

/* ===== 标签输入辅助 ===== */
function addTagToItemEditor(tag) {
    const input = document.getElementById('itemTags');
    if (!input) return;
    const current = input.value.split(',').map(s => s.trim()).filter(s => s);
    if (!current.includes(tag)) current.push(tag);
    input.value = current.slice(0, 20).join(', ');
    input.focus();
}

/* ========== 文案编辑器（使用统一编辑器模块） ========== */
// 注意：editor.js 已在 admin/index.php 中加载，并已通过 window.EDITOR_CONTEXT 配置后台上下文
// 以下函数均委托给 UnifiedEditor / 全局函数处理，避免重复维护

function openItemEditor(itemId) {
    let item = null;
    if (itemId) {
        item = AdminState.data.items.find(i => i.id === itemId);
        if (!item) { showToast('文案不存在', 'error'); return; }
    }
    // effItem 即当前编辑的文案（新增时为 null）
    const effItem = item;
    AdminState.editingItem = item; // 仍然保存真实 item（用于 saveItemFromEditor 判断 isEdit）
    // 从对比弹窗进入编辑器时锁定 compareState，避免编辑器关闭时被自动弹回对比窗
    window._compareStateLocked = !!AdminState.compareState;
    const catOptions = buildCategoryOptions(effItem ? effItem.categoryId : '');
    const existingTags = Array.isArray(effItem && effItem.tags) ? effItem.tags.join(', ') : '';
    const allTags = AdminState.contentAllTags || [];
    const tagSuggestions = allTags.slice(0, 15).map(t =>
        `<span class="tag-suggestion" onclick="addTagToItemEditor('${escapeAttr(t)}')">${escapeHtml(t)}</span>`
    ).join('');

    // 通过 UnifiedEditor 生成编辑器 HTML（统一前后端样式与功能）
    const initialContent = window.UnifiedEditor
        ? window.UnifiedEditor.normalizeImgPaths(window.sanitizeContent(item ? item.content : ''))
        : normalizeImgPaths(sanitizeContent(item ? item.content : ''));
    // 计算文案元信息（最后更新时间、失效提示），仅编辑现有文案时计算
    // 复用 editor.js 的 UnifiedEditor.computeItemMetaInfo（前后台共用）
    const metaInfo = item ? (window.UnifiedEditor && typeof window.UnifiedEditor.computeItemMetaInfo === 'function' ? window.UnifiedEditor.computeItemMetaInfo(item) : null) : null;
    // 元信息拆分：head（字数+最后更新）注入标题右侧，foot（失效提示）注入底部按钮行
    const metaHTML = (window.UnifiedEditor && typeof window.UnifiedEditor.buildMetaHTML === 'function')
        ? window.UnifiedEditor.buildMetaHTML(metaInfo, 'itemEditor', true)
        : { head: '', foot: '' };
    const editorHTML = window.UnifiedEditor
        ? window.UnifiedEditor.buildHTML({
            editorId: 'itemEditor',
            content: initialContent,
            showImageUpload: true,
            showEmoji: true,
            showSourceMode: true,
            showFormatting: true
        })
        : '';

    const body = `
        <div class="form-group">
            <label class="form-label">标题</label>
            <input type="text" class="form-input" id="itemTitle" value="${escapeAttr(effItem ? effItem.title : '')}" placeholder="输入标题..." maxlength="200">
        </div>
        <div class="form-group">
            <label class="form-label">分类</label>
            <select class="form-select" id="itemCat">
                <option value="">未分类</option>
                ${catOptions}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">标签（逗号分隔，最多 20 个）</label>
            <input type="text" class="form-input" id="itemTags" value="${escapeAttr(existingTags)}" placeholder="如: 营销, 通知, 公告">
            ${tagSuggestions ? `<div class="tag-suggestions"><div class="tag-suggestions-title">已有标签:</div><div class="tag-suggestions-list">${tagSuggestions}</div></div>` : ''}
        </div>
        <div class="form-group">
            <label class="form-label">内容</label>
            <div id="unifiedEditorContainer">${editorHTML}</div>
        </div>
    `;
    const foot = `
        <div class="modal-foot-meta">${metaHTML.foot}</div>
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveItemFromEditor()">保存</button>
    `;
    openModal(item ? '编辑文案' : '新增文案', body, foot);
    // 注入元信息到弹窗标题右侧（字数统计 + 最后更新时间）
    const headMetaEl = document.getElementById('modalHeadMeta');
    if (headMetaEl) headMetaEl.innerHTML = metaHTML.head;
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-wide');

    // 初始化统一编辑器事件
    if (window.UnifiedEditor) {
        window.UnifiedEditor.init({ editorId: 'itemEditor' });
    }
    if (typeof feather !== 'undefined') {
        try { feather.replace(); } catch(e) {}
    }
}

async function saveItemFromEditor() {
    const existing = AdminState.editingItem;
    if (existing) {
        if (!hasPermission('content.edit')) { showToast('无编辑文案权限', 'error'); return; }
    } else {
        if (!hasPermission('content.create')) { showToast('无创建文案权限', 'error'); return; }
    }
    let title = document.getElementById('itemTitle').value.trim();
    const categoryId = document.getElementById('itemCat').value;

    // 读取标签
    const tagsInput = document.getElementById('itemTags');
    const tags = tagsInput ? tagsInput.value.split(',').map(s => s.trim()).filter(s => s !== '').slice(0, 20) : [];

    // 读取内容：优先使用 UnifiedEditor.getContent（处理源码模式），否则降级
    let content;
    if (window.UnifiedEditor && typeof window.UnifiedEditor.getContent === 'function') {
        content = window.UnifiedEditor.getContent('itemEditor');
    } else {
        const state = window.UnifiedEditor ? window.UnifiedEditor.getState('itemEditor') : null;
        if (state && state.sourceMode) {
            const src = document.getElementById('itemEditor_source');
            content = src ? src.value : '';
        } else {
            const editor = document.getElementById('itemEditor');
            content = editor ? editor.innerHTML : '';
        }
    }
    // 还原 ../img/ 前缀为 img/（与前端一致）
    if (window.UnifiedEditor && typeof window.UnifiedEditor.denormalizeImgPaths === 'function') {
        content = window.UnifiedEditor.denormalizeImgPaths(content);
    } else {
        content = normalizeSaveImgPaths(content);
    }
    // 保存前消毒
    if (typeof window.sanitizeContent === 'function') {
        content = window.sanitizeContent(content);
    } else {
        content = sanitizeContent(content);
    }

    // 标题为空时，自动从内容中提取前30个字符作为标题
    if (!title) {
        const _plainText = (typeof stripHtml === 'function') ? stripHtml(content) : content.replace(/<[^>]*>/g, '');
        const _autoTitle = _plainText.replace(/\s+/g, ' ').trim().substring(0, 30);
        if (_autoTitle) {
            title = _autoTitle;
            document.getElementById('itemTitle').value = title;
        } else {
            showToast('内容不能为空', 'warn');
            return;
        }
    }

    const item = {
        id: existing ? existing.id : 'itm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10),
        title: title.substring(0, 200),
        content: content.substring(0, 1048576),
        categoryId: categoryId,
        tags: tags,
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
        createdBy: existing ? (existing.createdBy || '') : '',
        updatedAt: new Date().toISOString(),
    };

    // 查重：检测与现有文案的重复内容（编辑时排除自身）
    if (typeof findDuplicateContent === 'function' && Array.isArray(AdminState.data.items)) {
        const dedupCfg = (typeof getDedupConfig === 'function') ? getDedupConfig() : null;
        const dedupEnabled = !dedupCfg || dedupCfg.enabled !== false; // 默认启用
        if (dedupEnabled) {
            const dup = findDuplicateContent(content, AdminState.data.items, existing ? existing.id : null);
            if (dup) {
                const action = await showDedupConfirm(dup);
                if (action === 'cancel') return;
                if (action === 'view') {
                    // 关闭当前编辑器，就地打开重复文案进行查看/编辑
                    closeModal();
                    if (dup.itemId) openItemEditor(dup.itemId);
                    return;
                }
                // action === 'save' 继续保存
            }
        }
    }

    try {
        const r = await adminApiFetch('saveItem', {
            method: 'POST',
            body: JSON.stringify({ item }),
        });
        const j = await r.json();
        if (j.success) {
            if (existing) {
                const idx = AdminState.data.items.findIndex(i => i.id === item.id);
                if (idx >= 0) AdminState.data.items[idx] = j.item || item;
            } else {
                AdminState.data.items.unshift(j.item || item);
            }
            closeModal();
            showToast(existing ? '已更新' : '已新增', 'success');
            refreshAfterItemChange(item.id, 'save');
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('保存失败', 'error');
    }
}

async function deleteItem(id) {
    if (!hasPermission('content.delete')) { showToast('无删除权限', 'error'); return; }
    const item = AdminState.data.items.find(i => i.id === id);
    if (!item) return;
    const ok = await showConfirm(`确定删除文案「${truncate(item.title || '(无标题)', 30)}」吗？此操作不可恢复。`, 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteItem', {
            method: 'POST',
            body: JSON.stringify({ id }),
        });
        const j = await r.json();
        if (j.success) {
            AdminState.data.items = AdminState.data.items.filter(i => i.id !== id);
            showToast('已删除', 'success');
            refreshAfterItemChange(id, 'delete');
        } else {
            showToast(j.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

/* ========== 查重分析 ========== */
async function renderDedupAnalysis() {
    const c = document.getElementById('adminContent');

    // 首次进入：加载策略
    if (!AdminState.dedupConfig) {
        c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载查重策略...</div>';
        await loadDedupConfig();
    }
    if (!AdminState.dedupDraftConfig) {
        AdminState.dedupDraftConfig = Object.assign({}, AdminState.dedupConfig || {});
    }

    const cfg = AdminState.dedupDraftConfig;
    const itemCount = (AdminState.data.items || []).length;
    const results = AdminState.dedupResults;
    const canConfig = hasPermission('dedup.config');
    const canView = hasPermission('dedup.view');

    const cfgDisabledAttr = canConfig ? '' : 'disabled';

    const html = `
    <div class="panel">
        <div class="panel-head"><div class="panel-title"><i data-feather="settings" style="width:16px;height:16px;"></i> 查重策略</div></div>
        <div class="panel-body">
            <div class="dedup-config-form">
                <div class="dedup-config-row">
                    <div class="access-info">
                        <div class="access-title">保存时自动查重</div>
                        <div class="access-desc">新增/编辑文案时自动检测与现有内容的重复度，命中阈值时弹出确认</div>
                    </div>
                    <label class="access-switch">
                        <input type="checkbox" id="dedupEnabled" ${cfg.enabled ? 'checked' : ''} onchange="onDedupCfgChange('enabled', this.checked)" ${cfgDisabledAttr}>
                        <span class="access-switch-slider"></span>
                    </label>
                </div>

                <div class="dedup-slider-row">
                    <div class="dedup-slider-label">
                        <span>n-gram 长度</span>
                        <span class="dedup-slider-val" id="dedupNgramVal">${cfg.ngramSize}</span>
                    </div>
                    <input type="range" class="dedup-slider" min="2" max="12" step="1" value="${cfg.ngramSize}" oninput="onDedupCfgChange('ngramSize', Number(this.value))" ${cfgDisabledAttr}>
                    <div class="dedup-slider-hint">字符级切片长度。越小越敏感（能检出零散改写），越大越严格（仅检出大段雷同）。中文推荐 4-8</div>
                </div>

                <div class="dedup-slider-row">
                    <div class="dedup-slider-label">
                        <span>触发阈值</span>
                        <span class="dedup-slider-val" id="dedupThresholdVal">${cfg.threshold}</span>
                    </div>
                    <input type="range" class="dedup-slider" min="1" max="100" step="1" value="${cfg.threshold}" oninput="onDedupCfgChange('threshold', Number(this.value))" ${cfgDisabledAttr}>
                    <div class="dedup-slider-hint">命中 n-gram 数达到此值才视为重复。约 ≈ 阈值+n-1 字连续重复。调低=更宽松，调高=更严格</div>
                </div>

                <div class="dedup-slider-row">
                    <div class="dedup-slider-label">
                        <span>最短文本</span>
                        <span class="dedup-slider-val" id="dedupMinLenVal">${cfg.minTextLength}</span>
                    </div>
                    <input type="range" class="dedup-slider" min="1" max="50" step="1" value="${cfg.minTextLength}" oninput="onDedupCfgChange('minTextLength', Number(this.value))" ${cfgDisabledAttr}>
                    <div class="dedup-slider-hint">文本长度低于此值的文案跳过查重（避免短标题误报）</div>
                </div>

                <div class="dedup-config-actions">
                    ${canConfig ? '<button class="btn btn-primary" onclick="saveDedupConfig()"><i data-feather="save" style="width:14px;height:14px;"></i> 保存策略</button>' : ''}
                    ${canConfig ? '<button class="btn btn-default" onclick="resetDedupConfig()"><i data-feather="rotate-ccw" style="width:14px;height:14px;"></i> 恢复默认</button>' : ''}
                    ${!canConfig ? '<span style="color:var(--t3);font-size:12px;"><i data-feather="lock" style="width:12px;height:12px;vertical-align:middle;"></i> 无权限修改查重策略</span>' : ''}
                    <span class="dedup-config-status" id="dedupCfgStatus"></span>
                </div>
            </div>
        </div>
    </div>

    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="search" style="width:16px;height:16px;"></i> 全库重复分析</div>
            <div class="panel-head-actions">
                <span class="dedup-stat-chip">共 ${itemCount} 条文案</span>
            </div>
        </div>
        <div class="panel-body">
            <div class="dedup-analyze-bar">
                ${canView ? `<button class="btn btn-primary" id="dedupRunBtn" onclick="runDedupAnalysis()" ${itemCount < 2 ? 'disabled' : ''}>
                    <i data-feather="zap" style="width:14px;height:14px;"></i> ${AdminState.dedupAnalyzing ? '分析中...' : '开始全库查重'}
                </button>` : ''}
                ${canView ? `<button class="btn btn-default" id="dedupClearBtn" onclick="clearDedupResults()" ${!results ? 'disabled' : ''}>清空结果</button>` : ''}
                ${!canView ? '<span style="color:var(--t3);font-size:12px;"><i data-feather="lock" style="width:12px;height:12px;vertical-align:middle;"></i> 无权限执行查重分析</span>' : ''}
                <div class="dedup-analyze-hint">
                    使用当前编辑中的策略对全部文案两两比对，找出重复对并自动聚合成组。
                    ${itemCount > 300 ? '<br><span style="color:var(--warn);"><i data-feather="alert-triangle" style="width:12px;height:12px;vertical-align:middle;"></i> 文案数量较多（>300），分析可能耗时数秒，期间界面短暂无响应属正常现象。</span>' : ''}
                </div>
            </div>
            <div class="dedup-progress" id="dedupProgress" style="display:none;">
                <div class="spinner"></div>
                <span id="dedupProgressText">准备分析...</span>
            </div>
            <div id="dedupResultsContainer">
                ${results ? renderDedupResultsHtml(results) : ''}
            </div>
        </div>
    </div>
    `;
    c.innerHTML = html;
    refreshFeatherIcons();
}

/**
 * 渲染查重结果 HTML
 */
function renderDedupResultsHtml(results) {
    const { pairs, groups, scannedAt, itemCount, skippedCount, stale } = results;
    const staleBanner = stale ? `
    <div class="dedup-stale-banner">
        <span class="dedup-stale-icon"><i data-feather="alert-triangle" style="width:16px;height:16px;"></i></span>
        <span>文案已变更，当前结果可能不准确</span>
        <button class="btn btn-primary btn-sm" onclick="runDedupAnalysis()">重新分析</button>
    </div>` : '';

    if (!pairs || pairs.length === 0) {
        return staleBanner + `
        <div class="dedup-result-summary">
            <div class="dedup-summary-ok">
                <div class="dedup-summary-icon"><i data-feather="check-circle" style="width:24px;height:24px;"></i></div>
                <div>
                    <div class="dedup-summary-title">未发现重复文案</div>
                    <div class="dedup-summary-desc">在当前策略下，扫描了 ${itemCount} 条文案，未检出达到阈值的重复内容。</div>
                </div>
            </div>
        </div>`;
    }

    // 涉及的独立文案数
    const involvedIds = new Set();
    pairs.forEach(p => { involvedIds.add(p.a.id); involvedIds.add(p.b.id); });
    const maxSim = pairs[0].similarity;
    const pct = (v) => Math.round(v * 100);

    const canDeleteContent = hasPermission('content.delete');
    
    const groupCards = groups.map((g, gi) => {
        const topPair = g.pairs[0];
        const members = g.ids.map(id => {
            const it = (AdminState.data.items || []).find(x => x.id === id);
            const title = it ? truncate(it.title || '(无标题)', 30) : '(已删除)';
            return `<span class="dedup-member" title="点击标题编辑${canDeleteContent ? '，点击删除' : ''}">
                <span class="dedup-member-title" onclick="jumpToEditItem('${escapeAttr(id)}')">${escapeHtml(title)}</span>
                ${canDeleteContent ? `<span class="dedup-member-del" onclick="deleteItem('${escapeAttr(id)}')" title="删除该文案"><i data-feather="x" style="width:12px;height:12px;"></i></span>` : ''}
            </span>`;
        }).join('');

        const pairRows = g.pairs.slice(0, 5).map(p => {
            return `
            <div class="dedup-pair-row">
                <div class="dedup-pair-titles">
                    <span onclick="jumpToEditItem('${escapeAttr(p.a.id)}')" title="点击编辑">${escapeHtml(truncate(p.a.title, 20))}</span>
                    <span class="dedup-pair-link"><i data-feather="repeat" style="width:14px;height:14px;"></i></span>
                    <span onclick="jumpToEditItem('${escapeAttr(p.b.id)}')" title="点击编辑">${escapeHtml(truncate(p.b.title, 20))}</span>
                </div>
                <div class="dedup-pair-bar"><div class="dedup-pair-bar-fill" style="width:${pct(p.similarity)}%"></div></div>
                <span class="dedup-pair-sim">${pct(p.similarity)}%</span>
                <span class="dedup-pair-chars">${p.duplicateChars}字</span>
                ${p.snippet ? `<div class="dedup-pair-snip" title="重复片段预览">“${escapeHtml(truncate(p.snippet, 80))}”</div>` : ''}
                <button class="btn btn-sm btn-default dedup-pair-compare" onclick="compareItems('${escapeAttr(p.a.id)}','${escapeAttr(p.b.id)}')"><i data-feather="columns" style="width:12px;height:12px;"></i> 对比</button>
            </div>`;
        }).join('');
        const morePairs = g.pairs.length > 5 ? `<div class="dedup-pair-more">还有 ${g.pairs.length - 5} 个重复对...</div>` : '';

        return `
        <div class="dedup-group-card">
            <div class="dedup-group-head">
                <span class="dedup-group-badge">#${gi + 1}</span>
                <span class="dedup-group-count">${g.ids.length} 条文案 · ${g.pairs.length} 个重复对</span>
                <span class="dedup-group-maxsim">最高 ${pct(topPair.similarity)}%</span>
            </div>
            <div class="dedup-group-members">${members}</div>
            <div class="dedup-pair-list">${pairRows}${morePairs}</div>
        </div>`;
    }).join('');

    return staleBanner + `
    <div class="dedup-result-summary">
        <div class="dedup-stat-grid">
            <div class="dedup-stat-card"><div class="dedup-stat-val">${itemCount}</div><div class="dedup-stat-lbl">扫描文案</div></div>
            <div class="dedup-stat-card dedup-stat-warn"><div class="dedup-stat-val">${involvedIds.size}</div><div class="dedup-stat-lbl">涉及重复</div></div>
            <div class="dedup-stat-card"><div class="dedup-stat-val">${pairs.length}</div><div class="dedup-stat-lbl">重复对</div></div>
            <div class="dedup-stat-card"><div class="dedup-stat-val">${groups.length}</div><div class="dedup-stat-lbl">重复分组</div></div>
            <div class="dedup-stat-card dedup-stat-danger"><div class="dedup-stat-val">${pct(maxSim)}%</div><div class="dedup-stat-lbl">最高相似度</div></div>
        </div>
        <div class="dedup-scanned-time">分析时间：${escapeHtml(formatDate(scannedAt))}${skippedCount ? ` · 跳过 ${skippedCount} 条过短文案` : ''}</div>
    </div>
    <div class="dedup-group-list">${groupCards}</div>`;
}

/**
 * 策略表单变更：更新草稿，刷新滑块右侧数值
 */
function onDedupCfgChange(field, value) {
    if (!AdminState.dedupDraftConfig) AdminState.dedupDraftConfig = {};
    AdminState.dedupDraftConfig[field] = value;
    // 同步显示值
    const map = { ngramSize: 'dedupNgramVal', threshold: 'dedupThresholdVal', minTextLength: 'dedupMinLenVal' };
    if (map[field]) {
        const el = document.getElementById(map[field]);
        if (el) el.textContent = value;
    }
    // 标记未保存
    const status = document.getElementById('dedupCfgStatus');
    if (status) status.textContent = '策略未保存，分析将使用此草稿';
}

/**
 * 保存查重策略到服务器
 */
async function saveDedupConfig() {
    if (!hasPermission('dedup.config')) { showToast('无修改查重配置权限', 'error'); return; }
    const draft = AdminState.dedupDraftConfig || AdminState.dedupConfig || {};
    const cfg = {
        enabled: !!draft.enabled,
        ngramSize: Number(draft.ngramSize) || 6,
        threshold: Number(draft.threshold) || 15,
        minTextLength: Number(draft.minTextLength) || 12,
    };
    try {
        const r = await adminApiFetch('updateDedupConfig', {
            method: 'POST',
            body: JSON.stringify({ config: cfg }),
        });
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (j.success) {
            AdminState.dedupConfig = j.config;
            AdminState.dedupDraftConfig = Object.assign({}, j.config);
            window.DEDUP_CONFIG = j.config;
            const status = document.getElementById('dedupCfgStatus');
            if (status) status.textContent = '✓ 已保存';
            showToast('查重策略已保存', 'success');
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

/**
 * 恢复默认策略
 */
function resetDedupConfig() {
    const defaults = { enabled: true, ngramSize: 6, threshold: 15, minTextLength: 12 };
    AdminState.dedupDraftConfig = Object.assign({}, defaults);
    if (!AdminState.dedupConfig) AdminState.dedupConfig = Object.assign({}, defaults);
    const status = document.getElementById('dedupCfgStatus');
    if (status) status.textContent = '已恢复默认值（需点击保存生效）';
    renderDedupAnalysis();
}

/**
 * 运行全库查重分析
 */
async function runDedupAnalysis() {
    if (!hasPermission('dedup.view')) { showToast('无查重分析权限', 'error'); return; }
    if (AdminState.dedupAnalyzing) return;
    const items = AdminState.data.items || [];
    if (items.length < 2) {
        showToast('文案不足 2 条，无需查重', 'warn');
        return;
    }

    const cfg = AdminState.dedupDraftConfig || AdminState.dedupConfig || {};
    const options = {
        ngramSize: Number(cfg.ngramSize) || 6,
        threshold: Number(cfg.threshold) || 15,
        minTextLength: Number(cfg.minTextLength) || 12,
    };

    AdminState.dedupAnalyzing = true;
    const btn = document.getElementById('dedupRunBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-feather="loader" style="width:14px;height:14px;animation:spin 1s linear infinite;"></i> 分析中...'; refreshFeatherIcons(); }
    const progress = document.getElementById('dedupProgress');
    const progressText = document.getElementById('dedupProgressText');
    if (progress) progress.style.display = 'flex';
    if (progressText) progressText.textContent = `正在分析 ${items.length} 条文案...`;

    // 让 UI 先渲染再开始计算
    await new Promise(r => setTimeout(r, 30));

    let pairs = [];
    let scannedCount = 0;
    let skippedCount = 0;
    try {
        // 预统计跳过数
        const minLen = options.minTextLength;
        items.forEach(it => {
            const text = (typeof dedupExtractText === 'function' ? dedupExtractText(it.content) : String(it.content || '').replace(/<[^>]*>/g, ''));
            if (text.length < minLen) skippedCount++;
            else scannedCount++;
        });

        pairs = analyzeAllDuplicates(items, options, (done, total) => {
            if (progressText) progressText.textContent = `分析进度：${done} / ${total}...`;
        });
    } catch (e) {
        console.error('查重分析失败:', e);
        showToast('分析失败：' + (e.message || e), 'error');
        AdminState.dedupAnalyzing = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-feather="zap" style="width:14px;height:14px;"></i> 开始全库查重'; refreshFeatherIcons(); }
        if (progress) progress.style.display = 'none';
        return;
    }

    const groups = groupDuplicates(pairs);
    AdminState.dedupResults = {
        pairs,
        groups,
        scannedAt: new Date().toISOString(),
        itemCount: items.length,
        scannedCount,
        skippedCount,
    };
    AdminState.dedupAnalyzing = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-feather="refresh-cw" style="width:14px;height:14px;"></i> 重新分析'; refreshFeatherIcons(); }
    if (progress) progress.style.display = 'none';

    // 仅刷新结果区，避免重置表单草稿
    const container = document.getElementById('dedupResultsContainer');
    if (container) container.innerHTML = renderDedupResultsHtml(AdminState.dedupResults);
    
    // 启用清空按钮
    const clearBtn = document.getElementById('dedupClearBtn');
    if (clearBtn) clearBtn.disabled = false;
    
    showToast(`分析完成：发现 ${pairs.length} 个重复对，${groups.length} 个分组`, pairs.length ? 'warn' : 'success');
}

/**
 * 清空查重结果
 */
function clearDedupResults() {
    AdminState.dedupResults = null;
    const container = document.getElementById('dedupResultsContainer');
    if (container) container.innerHTML = '';
    const btn = document.getElementById('dedupRunBtn');
    if (btn) { btn.innerHTML = '<i data-feather="zap" style="width:14px;height:14px;"></i> 开始全库查重'; refreshFeatherIcons(); }
    
    // 禁用清空按钮
    const clearBtn = document.getElementById('dedupClearBtn');
    if (clearBtn) clearBtn.disabled = true;
    
    showToast('已清空查重结果', 'info', 1500);
}

/**
 * 从查重结果就地打开文案编辑器（不跳转视图）
 */
function jumpToEditItem(id) {
    const it = (AdminState.data.items || []).find(x => x.id === id);
    if (!it) {
        showToast('该文案可能已被删除，请重新分析', 'warn');
        return;
    }
    openItemEditor(id);
}

function compareItems(idA, idB) {
    const itemA = (AdminState.data.items || []).find(x => x.id === idA);
    const itemB = (AdminState.data.items || []).find(x => x.id === idB);
    if (!itemA || !itemB) {
        showToast('文案不存在，请重新分析', 'error');
        return;
    }

    AdminState.compareState = { idA, idB };

    const catA = itemA.categoryId ? findCategoryById(itemA.categoryId) : null;
    const catB = itemB.categoryId ? findCategoryById(itemB.categoryId) : null;
    const catAName = getCategoryFullName(itemA.categoryId);
    const catBName = getCategoryFullName(itemB.categoryId);

    const body = `
        <div class="compare-container">
            <div class="compare-panel">
                <div class="compare-header">
                    <div class="compare-title">文案 A</div>
                    <span class="compare-cat" style="background:${catA ? sanitizeColor(catA.color) || '#6366f1' : '#9ca3af'}">${catAName !== null ? escapeHtml(catAName) : '未分类'}</span>
                </div>
                <div class="compare-title-input">${escapeHtml(itemA.title)}</div>
                <div class="compare-content">${normalizeImgPaths(itemA.content) || '<span style="color:var(--t3);font-style:italic;">无内容</span>'}</div>
                <div class="compare-footer">
                    <button class="btn btn-sm btn-primary" onclick="openItemEditor('${escapeAttr(idA)}')"><i data-feather="edit-3" style="width:12px;height:12px;"></i> 编辑</button>
                </div>
            </div>
            <div class="compare-divider">
                <span class="compare-arrow"><i data-feather="repeat" style="width:20px;height:20px;"></i></span>
            </div>
            <div class="compare-panel">
                <div class="compare-header">
                    <div class="compare-title">文案 B</div>
                    <span class="compare-cat" style="background:${catB ? sanitizeColor(catB.color) || '#6366f1' : '#9ca3af'}">${catBName !== null ? escapeHtml(catBName) : '未分类'}</span>
                </div>
                <div class="compare-title-input">${escapeHtml(itemB.title)}</div>
                <div class="compare-content">${normalizeImgPaths(itemB.content) || '<span style="color:var(--t3);font-style:italic;">无内容</span>'}</div>
                <div class="compare-footer">
                    <button class="btn btn-sm btn-primary" onclick="openItemEditor('${escapeAttr(idB)}')"><i data-feather="edit-3" style="width:12px;height:12px;"></i> 编辑</button>
                </div>
            </div>
        </div>`;

    openModal('文案对比', body, '<button class="btn btn-default" onclick="closeCompare()">关闭</button>');
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-wide');
    const modalCloseBtn = document.querySelector('.modal-close');
    if (modalCloseBtn) modalCloseBtn.onclick = closeCompare;
}

function closeCompare() {
    AdminState.compareState = null;
    window._compareStateLocked = false;
    closeModal();
}

/**
 * 文案保存/删除后，根据当前视图刷新界面
 * 在查重页时：不跳走，就地更新查重结果（删除即时移除，编辑标记过期）
 */
function refreshAfterItemChange(changedId, changeType) {
    if (AdminState.currentView === 'dedup') {
        if (AdminState.dedupResults) {
            if (changeType === 'delete') {
                AdminState.dedupResults.pairs = (AdminState.dedupResults.pairs || []).filter(
                    p => p.a.id !== changedId && p.b.id !== changedId
                );
                AdminState.dedupResults.groups = groupDuplicates(AdminState.dedupResults.pairs);
                AdminState.dedupResults.itemCount = (AdminState.data.items || []).length;
            } else {
                AdminState.dedupResults.stale = true;
            }
            const container = document.getElementById('dedupResultsContainer');
            if (container) container.innerHTML = renderDedupResultsHtml(AdminState.dedupResults);
            
            // 删除后检查是否还有重复对，无则禁用清空按钮
            const clearBtn = document.getElementById('dedupClearBtn');
            if (clearBtn) clearBtn.disabled = !AdminState.dedupResults.pairs || AdminState.dedupResults.pairs.length === 0;
        }
    } else {
        renderContent();
    }
}

/* ========== 分类管理 ========== */
function renderCategories() {
    const cats = AdminState.data.categories;
    const canManage = hasPermission('categories.manage');

    const html = `
    <div class="toolbar">
        <div class="toolbar-left">
            <div class="panel-title">共 ${cats.length} 个一级分类</div>
            <span style="font-size:12px;color:var(--t3);"><i data-feather="info" style="width:12px;height:12px;vertical-align:middle;"></i> 拖拽分类可调整排序</span>
        </div>
        <div class="toolbar-right">
            ${canManage ? '<button class="btn btn-primary btn-sm" onclick="openCategoryEditor()"><i data-feather="plus" style="width:14px;height:14px;"></i> 新增分类</button>' : ''}
            ${canManage ? '<button class="btn btn-default btn-sm" onclick="saveCategoriesOrder()"><i data-feather="save" style="width:14px;height:14px;"></i> 保存排序</button>' : ''}
        </div>
    </div>
    <div class="panel">
        <div class="panel-body">
            ${cats.length === 0 ?
                '<div class="empty-state"><div class="empty-icon"><i data-feather="folder" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无分类</div></div>' :
                '<div class="cat-tree" id="catTreeRoot">' + cats.map((c, i) => renderCatNode(c, i)).join('') + '</div>'
            }
        </div>
    </div>
    `;
    document.getElementById('adminContent').innerHTML = html;
    refreshFeatherIcons();
}

function renderCatNode(cat, idx) {
    const children = cat.children || [];
    const itemCount = countItemsInCategory(cat.id);
    const canManage = hasPermission('categories.manage');

    return `
    <div class="cat-tree-node" id="cat-${escapeAttr(cat.id)}" data-cat-id="${escapeAttr(cat.id)}" data-cat-level="top"
         draggable="${canManage ? 'true' : 'false'}"
         ondragstart="onCatDragStart(event,'${escapeAttr(cat.id)}','top')"
         ondragover="onCatDragOver(event,'${escapeAttr(cat.id)}','top')"
         ondragleave="onCatDragLeave(event)"
         ondrop="onCatDrop(event,'${escapeAttr(cat.id)}','top')">
        <div class="cat-tree-head" onclick="toggleCatNode('${escapeAttr(cat.id)}')">
            <span class="cat-tree-toggle"><i data-feather="chevron-right" style="width:14px;height:14px;"></i></span>
            ${canManage ? '<span class="cat-drag-handle" title="拖拽排序"><i data-feather="move" style="width:14px;height:14px;"></i></span>' : ''}
            <span class="cat-tree-color" style="background:${sanitizeColor(cat.color) || '#6366f1'}"></span>
            <span class="cat-tree-name">${escapeHtml(cat.name)}</span>
            <span class="cat-tree-meta">${children.length} 子分类 · ${itemCount} 文案</span>
            <div class="row-actions" onclick="event.stopPropagation()">
                ${canManage ? `<button class="row-btn" onclick="openCategoryEditor(null,'${escapeAttr(cat.id)}')"><i data-feather="plus" style="width:12px;height:12px;"></i> 子分类</button>` : ''}
                ${canManage ? `<button class="row-btn" onclick="openCategoryEditor('${escapeAttr(cat.id)}')"><i data-feather="edit-3" style="width:12px;height:12px;"></i> 编辑</button>` : ''}
                ${canManage ? `<button class="row-btn row-btn-danger" onclick="deleteCategory('${escapeAttr(cat.id)}')"><i data-feather="trash-2" style="width:12px;height:12px;"></i> 删除</button>` : ''}
            </div>
        </div>
        <div class="cat-tree-children">
            ${children.length === 0 ? '<div style="color:var(--t3);font-size:12.5px;padding:6px 0;">暂无子分类</div>' :
                children.map(ch => `
                    <div class="cat-child-row" data-cat-id="${escapeAttr(ch.id)}" data-parent-id="${escapeAttr(cat.id)}"
                         draggable="${canManage ? 'true' : 'false'}"
                         ondragstart="onCatDragStart(event,'${escapeAttr(ch.id)}','sub')"
                         ondragover="onCatDragOver(event,'${escapeAttr(ch.id)}','sub')"
                         ondragleave="onCatDragLeave(event)"
                         ondrop="onCatDrop(event,'${escapeAttr(ch.id)}','sub')">
                        ${canManage ? '<span class="cat-drag-handle" title="拖拽排序"><i data-feather="move" style="width:14px;height:14px;"></i></span>' : ''}
                        <span class="cat-tree-color" style="background:${sanitizeColor(ch.color) || '#6366f1'}"></span>
                        <span style="flex:1;font-weight:500;color:var(--t1);">${escapeHtml(ch.name)}</span>
                        <span class="cat-tree-meta">${countItemsInCategory(ch.id)} 文案</span>
                        <div class="row-actions">
                            ${canManage ? `<button class="row-btn" onclick="openCategoryEditor('${escapeAttr(ch.id)}')"><i data-feather="edit-3" style="width:12px;height:12px;"></i></button>` : ''}
                            ${canManage ? `<button class="row-btn row-btn-danger" onclick="deleteCategory('${escapeAttr(ch.id)}')"><i data-feather="trash-2" style="width:12px;height:12px;"></i></button>` : ''}
                        </div>
                    </div>
                `).join('')
            }
        </div>
    </div>`;
}

function toggleCatNode(id) {
    document.getElementById('cat-' + id).classList.toggle('expanded');
}

/* ========== 分类拖拽排序 ========== */
let _catDragData = null; // { id, level }

function onCatDragStart(e, catId, level) {
    _catDragData = { id: catId, level: level };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', catId);
    e.currentTarget.classList.add('dragging');
}

function onCatDragOver(e, targetId, level) {
    if (!_catDragData) return;
    // 同层级才允许放置
    if (_catDragData.level !== level) return;
    if (_catDragData.id === targetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function onCatDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function onCatDrop(e, targetId, level) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
    if (!_catDragData || _catDragData.level !== level) return;
    if (_catDragData.id === targetId) return;

    const dragId = _catDragData.id;
    _catDragData = null;

    if (level === 'top') {
        reorderCategories(dragId, targetId);
    } else {
        reorderSubCategories(dragId, targetId);
    }
}

function reorderCategories(dragId, targetId) {
    const cats = AdminState.data.categories;
    const fromIdx = cats.findIndex(c => c.id === dragId);
    const toIdx = cats.findIndex(c => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = cats.splice(fromIdx, 1);
    cats.splice(toIdx, 0, moved);
    renderCategories();
    showToast('排序已更新，点击"保存排序"持久化', 'info', 2000);
}

function reorderSubCategories(dragId, targetId) {
    // 找到两个子分类的共同父分类
    let parent = null;
    for (const c of AdminState.data.categories) {
        if (c.children) {
            const hasDrag = c.children.some(ch => ch.id === dragId);
            const hasTarget = c.children.some(ch => ch.id === targetId);
            if (hasDrag && hasTarget) { parent = c; break; }
        }
    }
    if (!parent || !parent.children) return;
    const children = parent.children;
    const fromIdx = children.findIndex(ch => ch.id === dragId);
    const toIdx = children.findIndex(ch => ch.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = children.splice(fromIdx, 1);
    children.splice(toIdx, 0, moved);
    renderCategories();
    showToast('排序已更新，点击"保存排序"持久化', 'info', 2000);
}

// 拖拽结束时清理样式
document.addEventListener('dragend', () => {
    document.querySelectorAll('.cat-tree-node.dragging, .cat-child-row.dragging, .cat-tree-node.drag-over, .cat-child-row.drag-over').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
    _catDragData = null;
});

function countItemsInCategory(catId) {
    const cat = findCategoryById(catId);
    if (!cat) return 0;
    const childIds = cat.children ? cat.children.map(c => c.id) : [];
    return AdminState.data.items.filter(it => it.categoryId === catId || childIds.includes(it.categoryId)).length;
}

function openCategoryEditor(editId, parentId) {
    if (!hasPermission('categories.manage')) { showToast('无管理分类权限', 'error'); return; }
    let editing = null;
    if (editId) {
        editing = findCategoryById(editId);
        if (!editing) { showToast('分类不存在', 'error'); return; }
    }
    const isChild = editing && editing.parentId;
    const title = editing ? '编辑' + (isChild ? '子分类' : '分类') : (parentId ? '新增子分类' : '新增分类');
    const body = `
        <div class="form-group">
            <label class="form-label">分类名称</label>
            <input type="text" class="form-input" id="catName" value="${escapeAttr(editing ? editing.name : '')}" placeholder="输入分类名称..." maxlength="200">
        </div>
        <div class="form-group">
            <label class="form-label">颜色标识</label>
            <div style="display:flex;align-items:center;gap:10px;">
                <input type="color" id="catColorPicker" value="${(sanitizeColor(editing ? editing.color : '') || '#6366f1')}" style="width:48px;height:42px;border:1.5px solid var(--line);border-radius:var(--radius-sm);cursor:pointer;background:white;">
                <input type="text" class="form-input" id="catColorText" value="${escapeAttr(sanitizeColor(editing ? editing.color : '') || '#6366f1')}" style="flex:1;" maxlength="20">
            </div>
            <small style="color:var(--t3);font-size:12px;">仅支持 #hex 或 rgb() 格式</small>
        </div>
    `;
    const foot = `
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveCategoryFromEditor('${escapeAttr(editId || '')}','${escapeAttr(parentId || '')}')">保存</button>
    `;
    openModal(title, body, foot);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
    // 颜色同步
    const picker = document.getElementById('catColorPicker');
    const text = document.getElementById('catColorText');
    picker.addEventListener('input', () => { text.value = picker.value; });
    text.addEventListener('input', () => {
        const sc = sanitizeColor(text.value);
        if (sc && /^#[0-9a-fA-F]{6}$/.test(sc)) picker.value = sc;
    });
}

function saveCategoryFromEditor(editId, parentId) {
    if (!hasPermission('categories.manage')) { showToast('无管理分类权限', 'error'); return; }
    const name = document.getElementById('catName').value.trim();
    const color = sanitizeColor(document.getElementById('catColorText').value) || '#6366f1';
    if (!name) { showToast('请输入分类名称', 'warn'); return; }

    const cats = AdminState.data.categories;
    if (editId) {
        // 编辑
        let updated = false;
        for (const c of cats) {
            if (c.id === editId) {
                c.name = name.substring(0, 200);
                c.color = color;
                updated = true;
                break;
            }
            if (c.children) {
                const ch = c.children.find(x => x.id === editId);
                if (ch) {
                    ch.name = name.substring(0, 200);
                    ch.color = color;
                    updated = true;
                    break;
                }
            }
        }
        if (!updated) { showToast('未找到分类', 'error'); return; }
    } else if (parentId) {
        // 新增子分类
        const parent = cats.find(c => c.id === parentId);
        if (!parent) { showToast('父分类不存在', 'error'); return; }
        if (!parent.children) parent.children = [];
        parent.children.push({
            id: 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            name: name.substring(0, 200),
            color: color,
            parentId: parentId,
        });
    } else {
        // 新增一级分类
        cats.push({
            id: 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            name: name.substring(0, 200),
            color: color,
            children: [],
        });
    }

    saveCategoriesToServer();
    closeModal();
}

async function deleteCategory(id) {
    if (!hasPermission('categories.manage')) { showToast('无管理分类权限', 'error'); return; }
    const cat = findCategoryById(id);
    if (!cat) return;
    const cnt = countItemsInCategory(id);
    const msg = cnt > 0
        ? `分类「${cat.name}」下有 ${cnt} 条文案，删除后文案将变为未分类。确定删除吗？`
        : `确定删除分类「${cat.name}」吗？`;
    const ok = await showConfirm(msg, 'trash-2');
    if (!ok) return;

    const cats = AdminState.data.categories;
    for (let i = 0; i < cats.length; i++) {
        if (cats[i].id === id) {
            cats.splice(i, 1);
            break;
        }
        if (cats[i].children) {
            const j = cats[i].children.findIndex(x => x.id === id);
            if (j >= 0) { cats[i].children.splice(j, 1); break; }
        }
    }
    // 解除文案关联
    AdminState.data.items.forEach(it => { if (it.categoryId === id) it.categoryId = ''; });

    saveCategoriesToServer();
    showToast('已删除', 'success');
    renderCategories();
}

async function saveCategoriesToServer() {
    if (!hasPermission('categories.manage')) { showToast('无管理分类权限', 'error'); return; }
    try {
        const r = await adminApiFetch('saveCategories', {
            method: 'POST',
            body: JSON.stringify({ categories: AdminState.data.categories }),
        });
        const j = await r.json();
        if (j.success) {
            if (j.categories) AdminState.data.categories = j.categories;
            showToast('已保存', 'success', 1500);
            renderCategories();
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        showToast('保存失败', 'error');
    }
}

async function saveCategoriesOrder() {
    await saveCategoriesToServer();
}


/* ========== 分享管理 ========== */
// 分享管理筛选状态
if (!AdminState.sharesFilter) AdminState.sharesFilter = { keyword: '', status: '' };
if (!AdminState.sharesTab) AdminState.sharesTab = 'content';
if (!AdminState.driveSharesFilter) AdminState.driveSharesFilter = { keyword: '', status: '' };

async function renderShares(tab) {
    if (tab) AdminState.sharesTab = tab;
    
    // 如果没有 drive.share 权限，强制切换到 content tab
    const hasDriveShare = hasPermission('drive.share');
    if (!hasDriveShare && AdminState.sharesTab === 'drive') {
        AdminState.sharesTab = 'content';
    }
    
    const currentTab = AdminState.sharesTab;
    const c = document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载分享列表...</div>';
    try {
        // 先渲染带 Tab 的外壳
        c.innerHTML = `
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="share-2" style="width:16px;height:16px;"></i> 分享管理</div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-default btn-sm" onclick="renderShares()"><i data-feather="refresh-cw" style="width:13px;height:13px;"></i> 刷新</button>
                </div>
            </div>
            <div class="share-tabs" style="display:flex;border-bottom:1px solid var(--border);padding:0 16px;">
                <button class="share-tab-btn ${currentTab === 'content' ? 'active' : ''}" onclick="AdminState.sharesTab='content';renderShares('content')" style="padding:10px 20px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:500;color:${currentTab === 'content' ? 'var(--pri)' : 'var(--t2)'};border-bottom-color:${currentTab === 'content' ? 'var(--pri)' : 'transparent'};">文案分享</button>
                ${hasDriveShare ? `<button class="share-tab-btn ${currentTab === 'drive' ? 'active' : ''}" onclick="AdminState.sharesTab='drive';renderShares('drive')" style="padding:10px 20px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:500;color:${currentTab === 'drive' ? 'var(--pri)' : 'var(--t2)'};border-bottom-color:${currentTab === 'drive' ? 'var(--pri)' : 'transparent'};">数据网盘分享</button>` : ''}
            </div>
            <div id="shareTabContent"></div>
        </div>`;
        refreshFeatherIcons();

        if (currentTab === 'drive') {
            await renderDriveSharesTab();
        } else {
            await renderContentSharesTab();
        }
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
    }
}

async function renderContentSharesTab() {
    const container = document.getElementById('shareTabContent');
    if (!container) return;
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3);">加载中...</div>';
    try {
        const r = await adminApiFetch('listShares');
        if (r.status === 401) { showToast('会话已过期', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { container.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }

        const shares = j.shares || [];
        const f = AdminState.sharesFilter;
        const filtered = shares.filter(s => {
            if (f.keyword) {
                const kw = f.keyword.toLowerCase();
                if (!(s.itemTitle || '').toLowerCase().includes(kw) && !s.token.toLowerCase().includes(kw)) return false;
            }
            if (f.status) {
                const now = Date.now();
                const expired = s.expiresAt && new Date(s.expiresAt).getTime() <= now;
                const exhausted = s.maxViews && s.viewCount >= s.maxViews;
                if (f.status === 'active' && (expired || exhausted || !s.itemExists)) return false;
                if (f.status === 'expired' && !expired) return false;
                if (f.status === 'exhausted' && !exhausted) return false;
                if (f.status === 'invalid' && s.itemExists) return false;
            }
            return true;
        });

        const now = Date.now();
        let activeCnt = 0, expiredCnt = 0, exhaustedCnt = 0, invalidCnt = 0, totalViews = 0;
        shares.forEach(s => {
            totalViews += s.viewCount || 0;
            const expired = s.expiresAt && new Date(s.expiresAt).getTime() <= now;
            const exhausted = s.maxViews && s.viewCount >= s.maxViews;
            if (!s.itemExists) invalidCnt++;
            else if (expired) expiredCnt++;
            else if (exhausted) exhaustedCnt++;
            else activeCnt++;
        });

        const rows = filtered.map(s => {
            const expired = s.expiresAt && new Date(s.expiresAt).getTime() <= now;
            const exhausted = s.maxViews && s.viewCount >= s.maxViews;
            const remaining = s.maxViews ? Math.max(0, s.maxViews - s.viewCount) : null;
            let statusBadge;
            if (!s.itemExists) statusBadge = '<span class="share-status-badge status-invalid">文案已删除</span>';
            else if (expired) statusBadge = '<span class="share-status-badge status-expired">已过期</span>';
            else if (exhausted) statusBadge = '<span class="share-status-badge status-exhausted">次数用尽</span>';
            else statusBadge = '<span class="share-status-badge status-active">活跃</span>';

            const pwdBadge = s.hasPassword ? '<span class="share-pwd-badge" title="已设置密码"><i data-feather="lock" style="width:11px;height:11px;"></i></span>' : '';
            const expiresIn = s.expiresAt && !expired ? `<span class="share-meta">将于 ${formatDate(s.expiresAt)} 过期</span>` : '';
            const viewsInfo = s.maxViews
                ? `${s.viewCount} / ${s.maxViews} 次${remaining !== null ? '（剩 ' + remaining + '）' : ''}`
                : `${s.viewCount} 次`;
            const lastView = s.lastViewAt ? formatDate(s.lastViewAt) : '—';

            return `<tr>
                <td><div class="share-token-cell">
                    <code class="share-token-code" title="${escapeAttr(s.token)}">${escapeHtml(s.token)}</code>
                    ${pwdBadge}
                </div></td>
                <td>${escapeHtml(s.itemTitle || '(已删除)')}${!s.itemExists ? '<span class="share-meta-warn">文案不存在</span>' : ''}</td>
                <td>${statusBadge}</td>
                <td><span class="share-views">${viewsInfo}</span>${expiresIn}</td>
                <td>${escapeHtml(lastView)}</td>
                <td>${escapeHtml(s.createdAt ? formatDate(s.createdAt) : '—')}</td>
                <td>${escapeHtml(s.createdByName || s.createdBy || '—')}</td>
                <td class="actions-cell">
                    <button class="btn btn-default btn-sm" onclick="openShareLink('${escapeAttr(s.token)}')" title="访问链接"><i data-feather="external-link" style="width:13px;height:13px;"></i></button>
                    <button class="btn btn-default btn-sm" onclick="copyShareLinkByToken('${escapeAttr(s.token)}')" title="复制链接"><i data-feather="copy" style="width:13px;height:13px;"></i></button>
                    ${hasPermission('content.share') ? `<button class="btn btn-default btn-sm" onclick="editShareConfig('${escapeAttr(s.token)}')" title="编辑配置"><i data-feather="edit-3" style="width:13px;height:13px;"></i></button>` : ''}
                    ${hasPermission('content.share') ? `<button class="btn btn-danger btn-sm" onclick="revokeShare('${escapeAttr(s.token)}')" title="撤销"><i data-feather="trash-2" style="width:13px;height:13px;"></i></button>` : ''}
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <div class="share-stats-bar">
                <div class="share-stat-item"><span class="share-stat-num">${shares.length}</span><span class="share-stat-label">总分享</span></div>
                <div class="share-stat-item"><span class="share-stat-num active">${activeCnt}</span><span class="share-stat-label">活跃中</span></div>
                <div class="share-stat-item"><span class="share-stat-num warn">${expiredCnt}</span><span class="share-stat-label">已过期</span></div>
                <div class="share-stat-item"><span class="share-stat-num warn">${exhaustedCnt}</span><span class="share-stat-label">次数用尽</span></div>
                <div class="share-stat-item"><span class="share-stat-num danger">${invalidCnt}</span><span class="share-stat-label">文案已删除</span></div>
                <div class="share-stat-item"><span class="share-stat-num">${totalViews}</span><span class="share-stat-label">总浏览次数</span></div>
            </div>
            <div class="activity-filter-bar">
                <input type="text" class="form-input" style="width:200px" placeholder="搜索 token 或文案标题..." value="${escapeAttr(f.keyword)}" oninput="AdminState.sharesFilter.keyword=this.value;renderSharesTableOnly()">
                <select class="form-select" style="width:130px" onchange="AdminState.sharesFilter.status=this.value;renderSharesTableOnly()">
                    <option value="">全部状态</option>
                    <option value="active" ${f.status === 'active' ? 'selected' : ''}>活跃</option>
                    <option value="expired" ${f.status === 'expired' ? 'selected' : ''}>已过期</option>
                    <option value="exhausted" ${f.status === 'exhausted' ? 'selected' : ''}>次数用尽</option>
                    <option value="invalid" ${f.status === 'invalid' ? 'selected' : ''}>文案已删除</option>
                </select>
                <button class="btn btn-default btn-sm" onclick="AdminState.sharesFilter={keyword:'',status:''};renderShares()">重置</button>
                ${hasPermission('shares.manage') && shares.length > 0 ? `<button class="btn btn-danger btn-sm" style="margin-left:auto;" onclick="clearAllShares()"><i data-feather="trash-2" style="width:13px;height:13px;"></i> 清空全部</button>` : ''}
            </div>
            <div class="panel-body">
                <table class="user-table share-table">
                    <thead><tr><th>Token</th><th>文案</th><th>状态</th><th>查看次数</th><th>最后查看</th><th>创建时间</th><th>分享人</th><th style="text-align:right">操作</th></tr></thead>
                    <tbody>${filtered.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--t3);">暂无分享记录</td></tr>' : rows}</tbody>
                </table>
            </div>`;
        refreshFeatherIcons();
        AdminState._lastShares = filtered;
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
    }
}

async function renderDriveSharesTab() {
    const container = document.getElementById('shareTabContent');
    if (!container) return;
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3);">加载中...</div>';
    try {
        const r = await adminApiFetch('listDriveShares');
        if (r.status === 401) { showToast('会话已过期', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { container.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }

        const shares = j.shares || [];
        const f = AdminState.driveSharesFilter;
        const filtered = shares.filter(s => {
            if (f.keyword) {
                const kw = f.keyword.toLowerCase();
                if (!(s.fileName || '').toLowerCase().includes(kw) && !(s.token || '').toLowerCase().includes(kw)) return false;
            }
            if (f.status) {
                const now = Date.now();
                const expired = s.expiresAt && new Date(s.expiresAt).getTime() <= now;
                const exhausted = s.maxDownloads && s.downloadCount >= s.maxDownloads;
                if (f.status === 'active' && (expired || exhausted)) return false;
                if (f.status === 'expired' && !expired) return false;
                if (f.status === 'exhausted' && !exhausted) return false;
            }
            return true;
        });

        const now = Date.now();
        let activeCnt = 0, expiredCnt = 0, exhaustedCnt = 0, totalDownloads = 0;
        shares.forEach(s => {
            totalDownloads += s.downloadCount || 0;
            const expired = s.expiresAt && new Date(s.expiresAt).getTime() <= now;
            const exhausted = s.maxDownloads && s.downloadCount >= s.maxDownloads;
            if (expired) expiredCnt++;
            else if (exhausted) exhaustedCnt++;
            else activeCnt++;
        });

        function fmtSize(b) {
            if (!b) return '0 B';
            const u = ['B', 'KB', 'MB', 'GB'];
            let i = 0;
            while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
            return (i === 0 ? Math.round(b) : b.toFixed(1)) + ' ' + u[i];
        }

        const rows = filtered.map(s => {
            const expired = s.expiresAt && new Date(s.expiresAt).getTime() <= now;
            const exhausted = s.maxDownloads && s.downloadCount >= s.maxDownloads;
            let statusBadge;
            if (expired) statusBadge = '<span class="share-status-badge status-expired">已过期</span>';
            else if (exhausted) statusBadge = '<span class="share-status-badge status-exhausted">次数用尽</span>';
            else statusBadge = '<span class="share-status-badge status-active">活跃</span>';

            const pwdBadge = s.hasPassword ? '<span class="share-pwd-badge" title="已设置密码"><i data-feather="lock" style="width:11px;height:11px;"></i></span>' : '';
            const expiresIn = s.expiresAt && !expired ? `<span class="share-meta">将于 ${formatDate(s.expiresAt)} 过期</span>` : '';
            const dlInfo = s.maxDownloads
                ? `${s.downloadCount} / ${s.maxDownloads} 次`
                : `${s.downloadCount} 次`;

            return `<tr>
                <td><div class="share-token-cell">
                    <code class="share-token-code" title="${escapeAttr(s.token)}">${escapeHtml(s.token)}</code>
                    ${pwdBadge}
                </div></td>
                <td style="word-break:break-all;min-width:120px;">${escapeHtml(s.fileName || '(未知)')}</td>
                <td>${fmtSize(s.fileSize)}</td>
                <td>${statusBadge}</td>
                <td><span class="share-views">${dlInfo}</span>${expiresIn}</td>
                <td>${escapeHtml(s.createdAt ? formatDate(s.createdAt) : '—')}</td>
                <td>${escapeHtml(s.createdBy || '—')}</td>
                <td class="actions-cell">
                    <button class="btn btn-default btn-sm" onclick="openDriveShareLink('${escapeAttr(s.token)}')" title="访问链接"><i data-feather="external-link" style="width:13px;height:13px;"></i></button>
                    <button class="btn btn-default btn-sm" onclick="copyDriveShareUrl('${escapeAttr(buildDriveShareUrl(s.token))}')" title="复制链接"><i data-feather="copy" style="width:13px;height:13px;"></i></button>
                    ${hasPermission('drive.share') ? `<button class="btn btn-default btn-sm" onclick="editDriveShareConfig('${escapeAttr(s.id)}')" title="编辑配置"><i data-feather="edit-3" style="width:13px;height:13px;"></i></button>` : ''}
                    ${hasPermission('drive.share') ? `<button class="btn btn-danger btn-sm" onclick="revokeDriveShare('${escapeAttr(s.id)}')" title="撤销"><i data-feather="trash-2" style="width:13px;height:13px;"></i></button>` : ''}
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <div class="share-stats-bar">
                <div class="share-stat-item"><span class="share-stat-num">${shares.length}</span><span class="share-stat-label">总分享</span></div>
                <div class="share-stat-item"><span class="share-stat-num active">${activeCnt}</span><span class="share-stat-label">活跃中</span></div>
                <div class="share-stat-item"><span class="share-stat-num warn">${expiredCnt}</span><span class="share-stat-label">已过期</span></div>
                <div class="share-stat-item"><span class="share-stat-num warn">${exhaustedCnt}</span><span class="share-stat-label">次数用尽</span></div>
                <div class="share-stat-item"><span class="share-stat-num">${totalDownloads}</span><span class="share-stat-label">总下载次数</span></div>
            </div>
            <div class="activity-filter-bar">
                <input type="text" class="form-input" style="width:200px" placeholder="搜索 token 或文件名..." value="${escapeAttr(f.keyword)}" oninput="AdminState.driveSharesFilter.keyword=this.value;renderDriveSharesTableOnly()">
                <select class="form-select" style="width:130px" onchange="AdminState.driveSharesFilter.status=this.value;renderDriveSharesTableOnly()">
                    <option value="">全部状态</option>
                    <option value="active" ${f.status === 'active' ? 'selected' : ''}>活跃</option>
                    <option value="expired" ${f.status === 'expired' ? 'selected' : ''}>已过期</option>
                    <option value="exhausted" ${f.status === 'exhausted' ? 'selected' : ''}>次数用尽</option>
                </select>
                <button class="btn btn-default btn-sm" onclick="AdminState.driveSharesFilter={keyword:'',status:''};renderShares('drive')">重置</button>
                ${hasPermission('drive.manage') && shares.length > 0 ? `<button class="btn btn-danger btn-sm" style="margin-left:auto;" onclick="clearAllDriveShares()"><i data-feather="trash-2" style="width:13px;height:13px;"></i> 清空全部</button>` : ''}
            </div>
            <div class="panel-body">
                <table class="user-table share-table drive-share-table">
                    <thead><tr><th>Token</th><th>文件名</th><th>大小</th><th>状态</th><th>下载次数</th><th>创建时间</th><th>分享人</th><th style="text-align:right">操作</th></tr></thead>
                    <tbody>${filtered.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--t3);">暂无数据网盘分享记录</td></tr>' : rows}</tbody>
                </table>
            </div>`;
        refreshFeatherIcons();
        AdminState._lastDriveShares = filtered;
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
    }
}

function renderDriveSharesTableOnly() {
    clearTimeout(renderDriveSharesTableOnly._t);
    renderDriveSharesTableOnly._t = setTimeout(() => renderDriveSharesTab(), 200);
}

// 仅重渲染表格部分（避免输入筛选时整页刷新导致输入框失焦）
function renderSharesTableOnly() {
    clearTimeout(renderSharesTableOnly._t);
    renderSharesTableOnly._t = setTimeout(() => {
        if (AdminState.sharesTab === 'drive') renderDriveSharesTab();
        else renderShares();
    }, 200);
}

function buildShareUrl(token) {
    return getSiteBaseUrl() + '/share.php?token=' + token;
}

function buildDriveShareUrl(token) {
    return getSiteBaseUrl() + '/share.php?drive=' + token;
}

function openShareLink(token) {
    window.open(buildShareUrl(token), '_blank');
}

function openDriveShareLink(token) {
    window.open(buildDriveShareUrl(token), '_blank');
}

async function copyShareLinkByToken(token) {
    const url = buildShareUrl(token);
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            showToast('已复制', 'success');
        } else {
            const ta = document.createElement('textarea');
            ta.value = url; document.body.appendChild(ta);
            ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
            showToast('已复制', 'success');
        }
    } catch (e) { showToast('复制失败，请手动复制', 'warning'); }
}

async function revokeShare(token) {
    if (!hasPermission('content.share')) { showToast('无分享管理权限', 'error'); return; }
    const ok = await showConfirm('确定要撤销该分享链接吗？此操作不可恢复。', 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteShare', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const j = await r.json();
        if (j.success) { showToast('分享链接已撤销', 'success'); renderShares('content'); }
        else { showToast(j.error || '撤销失败', 'error'); }
    } catch (e) { showToast('撤销失败', 'error'); }
}

async function clearAllShares() {
    if (!hasPermission('shares.manage')) { showToast('无管理分享权限', 'error'); return; }
    const filtered = AdminState._lastShares || [];
    if (filtered.length === 0) { showToast('没有可清空的分享记录', 'warning'); return; }
    const tokens = filtered.map(s => s.token);
    const ok = await showConfirm(`确定要清空当前筛选结果中的 ${filtered.length} 条分享链接吗？此操作不可恢复。`, 'trash-2');
    if (!ok) return;
    const ok2 = await showConfirm('再次确认：真的要清空这些分享链接吗？', 'alert-octagon');
    if (!ok2) return;
    try {
        const r = await adminApiFetch('clearAllShares', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokens })
        });
        const j = await r.json();
        if (j.success) { showToast(`已清空 ${j.clearedCount} 条分享链接`, 'success'); renderShares('content'); }
        else { showToast(j.error || '清空失败', 'error'); }
    } catch (e) { showToast('清空失败', 'error'); }
}

async function editShareConfig(token) {
    if (!hasPermission('content.share')) { showToast('无分享权限', 'error'); return; }
    if (!AdminState._lastShares) { showToast('请先加载分享列表', 'error'); return; }
    const s = AdminState._lastShares.find(x => x.token === token);
    if (!s) { showToast('未找到分享记录', 'error'); return; }

    const expiresVal = s.expiresAt ? s.expiresAt.substring(0, 16) : '';
    const maxViewsVal = s.maxViews || '';

    const bodyHtml = `
        <div class="form-group">
            <label class="form-label">过期时间</label>
            <input type="datetime-local" class="form-input" id="editShareExpires" value="${escapeAttr(expiresVal)}">
            <small style="color:var(--t3);font-size:12px;">留空表示永不过期</small>
        </div>
        <div class="form-group">
            <label class="form-label">查看次数上限</label>
            <input type="number" class="form-input" id="editShareMaxViews" value="${escapeAttr(String(maxViewsVal))}" min="1" placeholder="留空表示不限">
            <small style="color:var(--t3);font-size:12px;">当前已查看 ${s.viewCount || 0} 次；留空表示不限</small>
        </div>
        <div class="form-group">
            <label class="form-label">新密码（可选）</label>
            <input type="password" class="form-input" id="editSharePassword" placeholder="留空保持不变" autocomplete="new-password">
            <label style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:13px;color:var(--t2);cursor:pointer;">
                <input type="checkbox" id="editShareClearPwd"> 清除密码保护
            </label>
        </div>`;
    const footHtml = `
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveShareConfig('${escapeAttr(token)}')"><i data-feather="save" style="width:14px;height:14px;"></i> 保存</button>`;

    openModal('编辑分享配置 - ' + token.substring(0, 12) + '…', bodyHtml, footHtml);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
}

async function saveShareConfig(token) {
    if (!hasPermission('content.share')) { showToast('无分享管理权限', 'error'); return; }
    const expiresInput = document.getElementById('editShareExpires');
    const maxViewsInput = document.getElementById('editShareMaxViews');
    const pwdInput = document.getElementById('editSharePassword');
    const clearPwdInput = document.getElementById('editShareClearPwd');

    const payload = { token };
    if (expiresInput) {
        const v = expiresInput.value.trim();
        payload.expiresAt = v ? new Date(v).toISOString() : null;
        if (v && new Date(payload.expiresAt).getTime() <= Date.now()) {
            showToast('过期时间必须晚于当前时间', 'error'); return;
        }
    }
    if (maxViewsInput) {
        const v = maxViewsInput.value.trim();
        payload.maxViews = v ? Math.max(1, parseInt(v, 10) || 0) : null;
    }
    if (pwdInput && pwdInput.value) payload.password = pwdInput.value;
    if (clearPwdInput && clearPwdInput.checked) payload.clearPassword = true;

    try {
        const r = await adminApiFetch('updateShare', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const j = await r.json();
        if (j.success) { showToast('分享配置已更新', 'success'); closeModal(); renderShares('content'); }
        else { showToast(j.error || '保存失败', 'error'); }
    } catch (e) { showToast('保存失败', 'error'); }
}


