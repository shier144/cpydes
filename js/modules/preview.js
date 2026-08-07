// ========== 快速预览 ==========
let previewItemId = null;

function handleRowClick(e, itemId, idx) {
    appState.setState('ui.selectedRowIdx', idx);
    highlightSelectedRow();
    showPreview(itemId);
}

function selectRow(e, idx) {
    appState.setState('ui.selectedRowIdx', idx);
    highlightSelectedRow();
}

function showPreview(id) {
    const item = getItemById(id);
    if (!item) return;
    previewItemId = id;

    // 每次打开预览时，根据后台配置重置分段模式（尊重"默认"语义）
    // 仅当存在多段内容（>1）时才默认进入分段模式，与分享界面保持一致
    if (typeof isPreviewSegmentDefault === 'function') {
        previewSegmentMode = isPreviewSegmentDefault() && typeof getSegmentCount === 'function' && getSegmentCount(item) > 1;
    }

    // 只有一个分段时隐藏分段按钮
    const segBtnEl = document.getElementById('previewSegmentBtn');
    if (segBtnEl && (typeof getSegmentCount !== 'function' || getSegmentCount(item) <= 1)) {
        segBtnEl.style.display = 'none';
    }

    // 如果图片墙开着，先关掉（避免层叠遮挡）
    const galleryOverlay = document.getElementById('galleryOverlay');
    if (galleryOverlay && galleryOverlay.classList.contains('show')) {
        closeGallery();
    }

    const titleEl = document.getElementById('previewTitle');
    const metaEl = document.getElementById('previewMeta');
    const bodyEl = document.getElementById('previewBody');
    const copyBtn = document.getElementById('previewCopyBtn');
    const overlay = document.getElementById('previewOverlay');

    if (titleEl) titleEl.textContent = item.title || '无标题';
    // 直接获取纯文本分类标签，避免剥离 HTML 标签时的脆弱性
    const catText = (typeof getCategoryLabelText === 'function')
        ? getCategoryLabelText(item.categoryId)
        : '';
    if (metaEl) metaEl.textContent = catText + ' · ' + formatDate(item.updatedAt || item.createdAt);

    // 绑定按钮事件（先绑定，渲染时可能根据分段模式覆盖文案）
    if (copyBtn) copyBtn.onclick = () => {
        if (typeof previewSegmentMode !== 'undefined' && previewSegmentMode) {
            copyAllSegments();
        } else {
            copyItem(id);
        }
    };

    // 根据分段模式状态渲染内容
    if (typeof previewSegmentMode !== 'undefined' && previewSegmentMode
        && typeof renderPreviewSegments === 'function') {
        renderPreviewSegments(item);
    } else {
        const safeContent = (typeof sanitizeHtmlBeforeInsert === 'function' && item.content)
            ? sanitizeHtmlBeforeInsert(item.content)
            : (item.content || '');
        // 包装相邻图片为 img-group，让多图横排显示
        const finalContent = (typeof wrapAdjacentImages === 'function')
            ? wrapAdjacentImages(safeContent)
            : safeContent;
        if (bodyEl) bodyEl.innerHTML = finalContent || '<em style="color:#9ca3af">暂无内容</em>';

        // 绑定图片点击放大
        if (bodyEl) {
            bodyEl.querySelectorAll('img').forEach(img => {
                img.style.cursor = 'zoom-in';
                img.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof openImageViewer === 'function') openImageViewer(img.src);
                };
            });
        }

        // 恢复主复制按钮文案与分段按钮状态
        if (copyBtn) {
            copyBtn.innerHTML = '<i data-feather="copy" style="width:14px;height:14px;"></i> 复制内容';
        }
        const segBtnEl = document.getElementById('previewSegmentBtn');
        if (segBtnEl) segBtnEl.classList.remove('active');
    }
    const shareBtn = document.getElementById('previewShareBtn');
    if (shareBtn) {
        // 仅在有分享权限时显示
        const canShare = (typeof hasPermission === 'function') ? hasPermission('content.share') : false;
        shareBtn.style.display = canShare ? '' : 'none';
        shareBtn.onclick = () => {
            if (typeof openShareDialog === 'function') openShareDialog(id);
            else if (typeof quickShare === 'function') quickShare(id);
        };
    }
    const editBtn = document.getElementById('previewEditBtn');
    if (editBtn) {
        editBtn.style.display = hasPermission('content.edit') ? '' : 'none';
        editBtn.onclick = () => { closePreview(); editItem(id); };
    }

    if (overlay) overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closePreview() {
    const overlay = document.getElementById('previewOverlay');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
    previewItemId = null;
}
