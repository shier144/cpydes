function openModal(itemId = null) {
    if (itemId && !hasPermission('content.edit')) {
        showToast('无编辑权限', 'error');
        return;
    }
    if (!itemId && !hasPermission('content.create')) {
        showToast('无新增权限', 'error');
        return;
    }

    const modalOverlay = document.getElementById('modalOverlay');
    if (!modalOverlay) return;

    const titleInput = document.getElementById('titleInput');
    const editorContainer = document.getElementById('editorContainer');
    const modalTitleEl = document.getElementById('modalTitle');
    const tagsInput = document.getElementById('itemTags');

    let initialContent = '';
    let editingItem = null;
    if (itemId) {
        const item = getItemById(itemId);
        if (item) {
            editingItem = item;
            if (modalTitleEl) modalTitleEl.textContent = '编辑文案';
            if (titleInput) titleInput.value = item.title;
            if (tagsInput) tagsInput.value = Array.isArray(item.tags) ? item.tags.join(', ') : '';
            initialContent = item.content || '';
            appState.setState('ui.selectedCategoryId', item.categoryId);
            updateCatSelectText();
        }
    } else {
        if (modalTitleEl) modalTitleEl.textContent = '新增文案';
        if (titleInput) titleInput.value = '';
        if (tagsInput) tagsInput.value = '';
        appState.setState('ui.selectedCategoryId', activeCat || null);
        updateCatSelectText();
    }

    // 计算文案元信息（最后更新时间、失效提示），仅编辑现有文案时计算
    let metaInfo = null;
    if (editingItem && window.UnifiedEditor && typeof window.UnifiedEditor.computeItemMetaInfo === 'function') {
        metaInfo = window.UnifiedEditor.computeItemMetaInfo(editingItem);
    }

    // 通过 UnifiedEditor 构建编辑器并初始化
    if (editorContainer && window.UnifiedEditor) {
        editorContainer.innerHTML = window.UnifiedEditor.buildHTML({
            editorId: 'contentEditor',
            content: initialContent,
            showImageUpload: true,
            showEmoji: true,
            showSourceMode: true,
            showFormatting: true
        });
        // 注入元信息到弹窗标题右侧（字数统计 + 最后更新时间）与底部按钮行（失效提示）
        if (typeof window.UnifiedEditor.buildMetaHTML === 'function') {
            const metaHTML = window.UnifiedEditor.buildMetaHTML(metaInfo, 'contentEditor', true);
            const headMetaEl = document.getElementById('modalHeadMeta');
            const footMetaEl = document.getElementById('modalFootMeta');
            if (headMetaEl) headMetaEl.innerHTML = metaHTML.head;
            if (footMetaEl) footMetaEl.innerHTML = metaHTML.foot;
        }
        window.UnifiedEditor.init({ editorId: 'contentEditor' });
        // 渲染工具栏图标
        if (typeof refreshFeatherIcons === 'function') {
            refreshFeatherIcons();
        } else if (typeof feather !== 'undefined' && feather.replace) {
            try { feather.replace(); } catch(e) {}
        }
    }

    appState.setState('ui.editingItemId', itemId);
    modalOverlay.classList.add('show');
    document.body.style.overflow = 'hidden';

    // 使用与后台一致的宽模态框（1200px / 95%）
    const dialog = modalOverlay.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-wide');

    setTimeout(() => { if (titleInput) titleInput.focus(); }, 50);
}
function closeModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) modalOverlay.classList.remove('show');
    const dialog = modalOverlay && modalOverlay.querySelector('.modal-dialog');
    if (dialog) dialog.classList.remove('modal-wide');
    // 清空弹窗标题右侧与底部按钮行的元信息容器
    const headMetaEl = document.getElementById('modalHeadMeta');
    const footMetaEl = document.getElementById('modalFootMeta');
    if (headMetaEl) headMetaEl.innerHTML = '';
    if (footMetaEl) footMetaEl.innerHTML = '';
    document.body.style.overflow = '';
    appState.setState('ui.editingItemId', null);
}

async function saveItem() {
    const titleInputEl = document.getElementById('titleInput');
    if (!titleInputEl) return;
    let title = titleInputEl.value.trim();

    // 标题为空时，自动从内容中提取前30个字符作为标题
    if (!title) {
        // 先获取内容用于自动生成标题
        let _previewContent;
        if (window.UnifiedEditor && typeof window.UnifiedEditor.getContent === 'function') {
            _previewContent = window.UnifiedEditor.getContent('contentEditor');
        } else {
            const _ed = document.getElementById('contentEditor');
            _previewContent = _ed ? _ed.innerHTML : '';
        }
        const _plainText = (typeof stripHtml === 'function') ? stripHtml(_previewContent) : _previewContent.replace(/<[^>]*>/g, '');
        const _autoTitle = _plainText.replace(/\s+/g, ' ').trim().substring(0, 30);
        if (_autoTitle) {
            title = _autoTitle;
            titleInputEl.value = title;
        } else {
            showToast('内容不能为空', 'warning');
            return;
        }
    }

    // 若处于源码模式，先切回富文本以便后续图片处理
    if (window.UnifiedEditor) {
        const state = window.UnifiedEditor.getState('contentEditor');
        if (state && state.sourceMode) {
            unifiedEditorToggleSource('contentEditor');
        }
    }

    const editor = document.getElementById('contentEditor');
    if (!editor) return;
    const images = editor.querySelectorAll('img');
    const placeholders = editor.querySelectorAll('.local-image-placeholder');
    let hasLocalImage = false;

    for (let img of images) {
        if (img.src.startsWith('file://')) {
            hasLocalImage = true;
            break;
        }
    }

    if (hasLocalImage) {
        showToast('正在自动转换图片，请稍候...', 'info');
        await processLocalImagesInEditor();
    }

    const remainingPlaceholders = editor.querySelectorAll('.local-image-placeholder');
    if (remainingPlaceholders.length > 0) {
        showToast(`还有 ${remainingPlaceholders.length} 张图片需要上传，请点击占位符完成`, 'warning');
        return;
    }

    // 通过 UnifiedEditor 统一获取内容并保存前消毒
    let content;
    if (window.UnifiedEditor && typeof window.UnifiedEditor.getContent === 'function') {
        content = window.UnifiedEditor.getContent('contentEditor');
    } else {
        content = editor.innerHTML;
    }
    if (typeof window.sanitizeContent === 'function') {
        content = window.sanitizeContent(content);
    }

    const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const existingItem = editingItemId ? getItemById(editingItemId) : null;
    const tagsInput = document.getElementById('itemTags');
    const tags = tagsInput ? tagsInput.value.split(',').map(s => s.trim()).filter(s => s !== '').slice(0, 20) : [];
    const item = {
        id: editingItemId || 'itm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11),
        title: title,
        content: content,
        categoryId: selectedCategoryId,
        tags: tags,
        createdAt: existingItem ? existingItem.createdAt : nowIso,
        updatedAt: nowIso
    };

    // 查重检测
    if (typeof findDuplicateContent === 'function' && Array.isArray(appData.items)) {
        const dedupCfg = (typeof getDedupConfig === 'function') ? getDedupConfig() : null;
        const dedupEnabled = !dedupCfg || dedupCfg.enabled !== false;
        if (dedupEnabled) {
            const dup = findDuplicateContent(content, appData.items, editingItemId || null);
            if (dup) {
                const action = await showDedupConfirm(dup);
                if (action === 'cancel') return;
                if (action === 'view') {
                    // 打开左右对比视图（与后台对比逻辑一致），保留当前编辑器未保存内容
                    if (dup.itemId && typeof compareItems === 'function') {
                        compareItems(editingItemId || null, dup.itemId);
                    }
                    return;
                }
            }
        }
    }

    try {
        const response = await apiFetch('api.php?action=saveItem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item: item })
        });
        if (response.status === 403) {
            let errMsg = '权限不足';
            try { const j = await response.json(); if (j.error) errMsg = j.error; } catch (_) {}
            showToast(errMsg, 'error');
            return;
        }
        if (response.status === 401) {
            if (typeof openLibraryAuth === 'function') openLibraryAuth();
            return;
        }
        let result;
        try { result = await response.json(); }
        catch (_) { showToast('保存失败：服务端响应解析错误', 'error'); return; }
        if (result.success) {
            // 使用服务端返回的最新数据，保证时间戳等字段一致
            if (result.item) Object.assign(item, result.item);
            if (editingItemId) {
                const index = appData.items.findIndex(i => i.id === editingItemId);
                if (index !== -1) {
                    appData.items[index] = item;
                    updateItemIndex(item);
                    // 使 layout.js 的 getItemMap 缓存失效（原地替换不改变数组引用和长度）
                    if (typeof invalidateItemMap === 'function') invalidateItemMap();
                }
            } else {
                appData.items.unshift(item);
                updateItemIndex(item);
            }
            closeModal();
            render();
            showToast(editingItemId ? '更新成功' : '保存成功', 'success');
        } else {
            showToast(result.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error('保存失败', e);
        showToast('保存失败', 'error');
    }
}

function editItem(id) {
    openModal(id);
}

/* ========== 文案对比视图（与后台一致：左右对比 + 编辑/关闭逻辑） ========== */
// 对比状态：保存当前编辑上下文，便于从对比弹窗返回编辑器
let _compareState = null;

/**
 * 打开文案对比视图
 * @param {string|null} editingId - 当前编辑中的文案 ID（新增时为 null）
 * @param {string} dupItemId - 检测到的重复文案 ID
 */
function compareItems(editingId, dupItemId) {
    const dupItem = appData.items.find(i => i.id === dupItemId);
    if (!dupItem) {
        showToast('重复文案不存在，可能已被删除', 'error');
        return;
    }

    // 读取当前编辑器中的内容（未保存的实时内容）
    let currentTitle = '';
    let currentContent = '';
    let currentCatId = selectedCategoryId || '';
    const titleInputEl = document.getElementById('titleInput');
    if (titleInputEl) currentTitle = titleInputEl.value.trim();
    if (window.UnifiedEditor && typeof window.UnifiedEditor.getContent === 'function') {
        currentContent = window.UnifiedEditor.getContent('contentEditor');
    } else {
        const ed = document.getElementById('contentEditor');
        currentContent = ed ? ed.innerHTML : '';
    }

    _compareState = { editingId, dupItemId };

    // 分类标签
    const catA = currentCatId ? findCategoryById(currentCatId) : null;
    const catB = dupItem.categoryId ? findCategoryById(dupItem.categoryId) : null;
    const catAColor = catA ? (sanitizeColor(catA.color) || '#6366f1') : '#9ca3af';
    const catBColor = catB ? (sanitizeColor(catB.color) || '#6366f1') : '#9ca3af';
    const catAName = currentCatId ? getCategoryLabelText(currentCatId) : '未分类';
    const catBName = dupItem.categoryId ? getCategoryLabelText(dupItem.categoryId) : '未分类';

    // 图片路径归一化（用于显示）
    const normalizeFn = (window.UnifiedEditor && typeof window.UnifiedEditor.normalizeImgPaths === 'function')
        ? window.UnifiedEditor.normalizeImgPaths
        : (html => html);
    const contentAHtml = normalizeFn(currentContent) || '<span style="color:var(--t3);font-style:italic;">无内容</span>';
    const contentBHtml = normalizeFn(dupItem.content) || '<span style="color:var(--t3);font-style:italic;">无内容</span>';

    const titleA = currentTitle || '(无标题)';
    const titleB = dupItem.title || '(无标题)';

    const body = `
        <div class="compare-container">
            <div class="compare-panel">
                <div class="compare-header">
                    <div class="compare-title">${editingId ? '当前编辑' : '新增内容'}</div>
                    <span class="compare-cat" style="background:${catAColor}">${escapeHtml(catAName)}</span>
                </div>
                <div class="compare-title-input">${escapeHtml(titleA)}</div>
                <div class="compare-content">${contentAHtml}</div>
                <div class="compare-footer">
                    <button class="btn btn-sm btn-primary" onclick="editFromCompare('left')"><i data-feather="edit-3" style="width:12px;height:12px;"></i> 继续编辑</button>
                </div>
            </div>
            <div class="compare-divider">
                <span class="compare-arrow"><i data-feather="repeat" style="width:20px;height:20px;"></i></span>
            </div>
            <div class="compare-panel">
                <div class="compare-header">
                    <div class="compare-title">重复文案</div>
                    <span class="compare-cat" style="background:${catBColor}">${escapeHtml(catBName)}</span>
                </div>
                <div class="compare-title-input">${escapeHtml(titleB)}</div>
                <div class="compare-content">${contentBHtml}</div>
                <div class="compare-footer">
                    <button class="btn btn-sm btn-primary" onclick="editFromCompare('right')"><i data-feather="edit-3" style="width:12px;height:12px;"></i> 编辑</button>
                </div>
            </div>
        </div>`;

    const compareBody = document.getElementById('compareModalBody');
    if (compareBody) compareBody.innerHTML = body;
    const overlay = document.getElementById('compareOverlay');
    if (overlay) overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
}

/**
 * 从对比弹窗触发编辑
 * @param {'left'|'right'} side - left=继续编辑当前内容, right=编辑重复文案
 */
function editFromCompare(side) {
    if (!_compareState) { closeCompare(); return; }
    if (side === 'right') {
        // 切换到重复文案进行编辑（关闭当前编辑器，丢弃未保存内容）
        const dupId = _compareState.dupItemId;
        _compareState = null;
        const overlay = document.getElementById('compareOverlay');
        if (overlay) overlay.classList.remove('show');
        closeModal(); // 关闭当前编辑器
        editItem(dupId);
    } else {
        // 继续编辑当前内容（仅关闭对比弹窗，编辑器保持打开）
        closeCompare();
    }
}

/**
 * 关闭对比弹窗（返回编辑器，保留未保存内容）
 */
function closeCompare() {
    _compareState = null;
    const overlay = document.getElementById('compareOverlay');
    if (overlay) overlay.classList.remove('show');
    const compareBody = document.getElementById('compareModalBody');
    if (compareBody) compareBody.innerHTML = '';
    // 不恢复 body.overflow，因为底层编辑器仍打开
}

function copyItem(id) {
    const item = appData.items.find(i => i.id === id);
    if (item) {
        copyRichContent(item.content, item);
    }
}

async function deleteItemConfirm(id) {
    if (!hasPermission('content.delete')) {
        showToast('无删除权限', 'error');
        return;
    }
    const ok = await showConfirm('确定要删除这条文案吗？', 'alert-triangle');
    if (ok) deleteItem(id);
}

async function deleteItem(id) {
    try {
        const item = getItemById(id);
        const imgPaths = (item && item.content) ? extractImagePaths(item.content) : [];

        // 先删除文案记录（确保数据一致性：文案删除成功后再删图片，避免图片丢失但文案仍存在）
        const response = await apiFetch('api.php?action=saveItem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item: {
                    id: id,
                    _delete: true
                }
            })
        });
        if (response.status === 401) {
            if (typeof openLibraryAuth === 'function') openLibraryAuth();
            return;
        }
        let result;
        try { result = await response.json(); }
        catch (_) { showToast('删除失败：服务端响应解析错误', 'error'); return; }
        if (!result.success) {
            showToast('删除失败：' + (result.error || '未知错误'), 'error');
            return;
        }

        // 文案删除成功后，再删除关联图片
        let deletedImgCount = 0;
        let failedImgCount = 0;
        if (imgPaths.length > 0) {
            try {
                const imgResp = await apiFetch('api.php?action=deleteImages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paths: imgPaths })
                });
                let imgResult;
                try { imgResult = await imgResp.json(); }
                catch (_) { console.error('删除图片响应解析失败'); imgResult = {}; }
                if (imgResult.success) {
                    deletedImgCount = imgResult.deleted || 0;
                    failedImgCount = imgResult.failedCount || 0;
                }
            } catch (imgErr) {
                console.error('删除图片失败:', imgErr);
            }
        }

        appData.items = appData.items.filter(i => i.id !== id);
        removeItemIndex(id);
        render();
        let msg = '删除成功';
        if (deletedImgCount > 0) msg += `（含 ${deletedImgCount} 张图片）`;
        if (failedImgCount > 0) msg += `，${failedImgCount} 张图片删除失败`;
        showToast(msg, failedImgCount > 0 ? 'warning' : 'success');
    } catch (e) {
        console.error('删除失败', e);
        showToast('删除失败，网络错误', 'error');
    }
}

async function toggleFavorite(id) {
    toggleLocalFavorite(id);
    render();
}

/** 快速添加子分类 */
