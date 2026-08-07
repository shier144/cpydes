/** 并行初始化：UI 更新 + 权限检查可同时进行，无需串行等待 */
document.addEventListener('DOMContentLoaded', () => {
    // 并行执行：主题初始化、问候语、自动填充禁用、图标刷新（这些不阻塞数据加载）
    Promise.all([
        initTheme ? initTheme() : Promise.resolve(),
        updateGreeting ? updateGreeting() : Promise.resolve(),
        disableAutofill ? (disableAutofill(), Promise.resolve()) : Promise.resolve(),
        refreshFeatherIcons ? refreshFeatherIcons() : Promise.resolve()
    ]).catch(() => {});
    
    // 后检查文案库访问权限，通过后再加载数据
    (async function() {
        try {
            const authed = await checkLibraryAccess();
            if (authed && typeof loadData === 'function') loadData();
            // 访问权限通过后，拉取并展示未读公告（不阻塞主流程）
            if (authed && typeof checkAnnouncements === 'function') {
                checkAnnouncements();
            }
            // 数据加载后启动实时同步轮询（后台关闭时自动降频为心跳）
            if (authed && typeof startSyncLoop === 'function') {
                startSyncLoop();
            }
        } catch(e) {
            console.error('初始化失败:', e);
            if (typeof showToast === 'function') showToast('初始化失败，请刷新重试', 'error');
        }
    })();
});

// 表情面板外部点击关闭由 UnifiedEditor 内部按实例处理，这里不再需要全局监听

// Enter键提交 + 键盘快捷键（优化：缓存元素引用，减少重复 DOM 查询）
const OVERLAY_IDS = [
    'inputDialogOverlay', 'confirmOverlay', 'dedupConfirmOverlay',
    'libraryAuthOverlay', 'previewOverlay', 'galleryOverlay',
    'announcementOverlay', 'compareOverlay'
];

document.addEventListener('keydown', function(e) {
    let anyOverlayOpen = false;
    // 原有的 Enter 和 Escape 逻辑（批量检查 overlay，$() 走 DOM 缓存）
    if (e.key === 'Enter') {
        for (const id of OVERLAY_IDS) {
            const el = $(id);
            if (el?.classList.contains('show')) {
                anyOverlayOpen = true;
                e.preventDefault();
                break;
            }
        }
        // Enter 弹窗提交处理
        if ($('inputDialogOverlay')?.classList.contains('show')) {
            submitInputDialog();
        }
    }
    
    if (e.key === 'Escape') {
        // 批量关闭所有 overlay（减少 getElementById 调用）
        const closeMap = {
            'inputDialogOverlay': () => closeInputDialog(null),
            'confirmOverlay': () => closeConfirm(false),
            'dedupConfirmOverlay': () => closeDedupConfirm('cancel'),
            'libraryAuthOverlay': () => cancelLibraryAuth(),
            'previewOverlay': () => closePreview(),
            'galleryOverlay': () => closeGallery(),
            'announcementOverlay': () => dismissAnnouncementBackdrop(),
            'compareOverlay': () => closeCompare()
        };
        for (const [id, fn] of Object.entries(closeMap)) {
            if ($(id)?.classList.contains('show')) {
                fn();
            }
        }
    }

    // 检查是否在输入框中（避免与输入冲突）
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
    );

    // Ctrl+K: 聚焦搜索框并选中文字
    if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        const qInput = $('qInput');
        if (qInput) {
            qInput.focus();
            qInput.select();
        }
        return;
    }

    // Ctrl+N: 打开新增文案弹窗（仅非输入框时且有权限）
    if (e.ctrlKey && e.key === 'n' && !isInputFocused && hasPermission('content.create')) {
        e.preventDefault();
        openModal();
        return;
    }

    // Ctrl+G: 打开图片墙模式
    if (e.ctrlKey && e.key === 'g' && !isInputFocused) {
        e.preventDefault();
        if (typeof openGallery === 'function') {
            openGallery();
        }
        return;
    }

    // 方向键导航（仅非输入框时）
    if (!isInputFocused && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const tbody = document.querySelector('#dataTableBody');
        if (!tbody) return;
        if (filteredItemsCount === 0) return;

        e.preventDefault();

        if (e.key === 'ArrowDown') {
            if (selectedRowIdx < filteredItemsCount - 1) {
                appState.setState('ui.selectedRowIdx', selectedRowIdx + 1);
            } else {
                appState.setState('ui.selectedRowIdx', 0);
            }
        } else if (e.key === 'ArrowUp') {
            if (selectedRowIdx > 0) {
                appState.setState('ui.selectedRowIdx', selectedRowIdx - 1);
            } else {
                appState.setState('ui.selectedRowIdx', filteredItemsCount - 1);
            }
        }

        // 选中行若不在可视区，滚动到该行（虚拟滚动会自动渲染）
        if (typeof virtualScrollToIndex === 'function' && isVirtualScrollActive()) {
            virtualScrollToIndex(selectedRowIdx);
        }
        highlightSelectedRow();

        // 确保选中行可见（全量渲染模式下）
        const rows = Array.from(tbody.querySelectorAll('tr[data-item-id]'));
        const target = rows.find(r => parseInt(r.getAttribute('data-item-idx'), 10) === selectedRowIdx);
        if (target) {
            target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return;
    }

    // Enter: 复制选中的文案（不阻止默认行为，避免输入框问题）
    if (e.key === 'Enter' && !isInputFocused && !anyOverlayOpen && selectedRowIdx >= 0) {
        const tbody = document.querySelector('#dataTableBody');
        if (tbody) {
            const rows = Array.from(tbody.querySelectorAll('tr[data-item-id]'));
            const target = rows.find(r => parseInt(r.getAttribute('data-item-idx'), 10) === selectedRowIdx);
            if (target) {
                const itemId = target.dataset.itemId;
                if (itemId) {
                    copyItem(itemId);
                }
            }
        }
        // 不调用 e.preventDefault()，允许在输入框中的正常回车行为
    }
});

document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('catSelectWrapper');
    if (!wrapper || !wrapper.contains(e.target)) {
        closeCatDropdown();
    }
});
