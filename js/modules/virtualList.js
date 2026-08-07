// ========== 虚拟滚动模块 ==========
// 大数据集（> VIRTUAL_THRESHOLD）时仅渲染可视区行 + buffer，前后用 spacer <tr> 撑总高度。
// 小数据集由调用方走原逻辑，配合 CSS content-visibility: auto 优化。
// 降级保护：scrollContainer 不存在或异常时返回 false，调用方走全量渲染。

const VIRTUAL_THRESHOLD = 200;
const DEFAULT_ROW_HEIGHT = 50;
const BUFFER = 10;
const SCROLL_THROTTLE_MS = 16; // ~60fps throttle

let _virtualState = {
    active: false,
    items: [],
    tbody: null,
    scrollContainer: null,
    onScroll: null,
    rowHeight: DEFAULT_ROW_HEIGHT,
    measured: false,
    lastRenderTime: 0
};

/**
 * 尝试启用虚拟滚动渲染
 * @param {Array} filteredItems - 过滤后的完整列表
 * @param {HTMLElement} tbody - <tbody> 目标元素
 * @param {Function} renderRowFn - (item, idx) => 行HTML字符串
 * @returns {boolean} true=已启用虚拟滚动；false=未启用（调用方应走原逻辑）
 */
function renderVirtualList(filteredItems, tbody, renderRowFn) {
    // 先卸载旧状态
    teardownVirtualScroll();

    const scrollContainer = document.getElementById('listArea');
    if (!scrollContainer || !tbody || typeof renderRowFn !== 'function') {
        return false;
    }
    if (filteredItems.length <= VIRTUAL_THRESHOLD) {
        return false;
    }

    _virtualState = {
        active: true,
        items: filteredItems,
        tbody: tbody,
        scrollContainer: scrollContainer,
        renderRowFn: renderRowFn,
        rowHeight: DEFAULT_ROW_HEIGHT,
        measured: false,
        lastRenderTime: 0
    };

    let scrollTicking = false;
    function onScroll() {
        if (!scrollTicking) {
            requestAnimationFrame(function () {
                updateVirtualView();
                scrollTicking = false;
            });
            scrollTicking = true;
        }
    }
    _virtualState.onScroll = onScroll;

    try {
        scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    } catch (e) {
        // 旧浏览器不支持 passive 选项对象
        try {
            scrollContainer.addEventListener('scroll', onScroll);
        } catch (e2) {
            _virtualState.active = false;
            return false;
        }
    }

    updateVirtualView();
    return true;
}

function updateVirtualView() {
    if (!_virtualState.active) return;
    
    // 节流：限制最高渲染频率 ~60fps
    const now = Date.now();
    if (now - _virtualState.lastRenderTime < SCROLL_THROTTLE_MS) return;
    _virtualState.lastRenderTime = now;
    
    const state = _virtualState;
    const items = state.items;
    const tbody = state.tbody;
    const scrollContainer = state.scrollContainer;
    const rowH = state.rowHeight;

    // 边界保护：行高非法会导致除零与 Infinity 渲染异常
    if (!rowH || rowH <= 0) return;
    if (!tbody || !scrollContainer) return;

    const scrollTop = scrollContainer.scrollTop;
    const containerHeight = scrollContainer.clientHeight;

    const startIdx = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER);
    const endIdx = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / rowH) + BUFFER);

    const topSpacerHeight = startIdx * rowH;
    const bottomSpacerHeight = (items.length - endIdx) * rowH;

    // 优化：使用数组拼接替代字符串 +=，减少中间对象创建
    const rows = [];
    if (topSpacerHeight > 0) {
        rows.push('<tr class="virtual-spacer" style="height:' + topSpacerHeight + 'px"><td colspan="7" style="padding:0;border:0;line-height:0"></td></tr>');
    }
    for (let i = startIdx; i < endIdx; i++) {
        rows.push(state.renderRowFn(items[i], i));
    }
    if (bottomSpacerHeight > 0) {
        rows.push('<tr class="virtual-spacer" style="height:' + bottomSpacerHeight + 'px"><td colspan="7" style="padding:0;border:0;line-height:0"></td></tr>');
    }
    tbody.innerHTML = rows.join('');

    // 首次渲染后动态测量真实行高，更新 rowHeight 并触发一次重算
    if (!state.measured) {
        const firstRow = tbody.querySelector('tr[data-item-id]');
        if (firstRow) {
            const realH = firstRow.offsetHeight;
            if (realH > 0 && Math.abs(realH - DEFAULT_ROW_HEIGHT) > 2) {
                state.rowHeight = realH;
                state.measured = true;
                // 用新行高重算一次（递归内已会执行 highlightSelectedRow）
                updateVirtualView();
                return;
            }
        }
        state.measured = true;
    }

    // 恢复选中行高亮（虚拟视图更新后需重新调用）
    if (typeof highlightSelectedRow === 'function') {
        highlightSelectedRow();
    }
}

function isVirtualScrollActive() {
    return _virtualState.active;
}

function teardownVirtualScroll() {
    if (_virtualState.onScroll && _virtualState.scrollContainer) {
        try {
            _virtualState.scrollContainer.removeEventListener('scroll', _virtualState.onScroll);
        } catch (e) {}
    }
    _virtualState = {
        active: false,
        items: [],
        tbody: null,
        scrollContainer: null,
        onScroll: null,
        rowHeight: DEFAULT_ROW_HEIGHT,
        measured: false,
        lastRenderTime: 0
    };
}

/**
 * 滚动到指定行索引（用于选中行跳转）
 * @param {number} idx - 过滤后列表中的索引
 */
function virtualScrollToIndex(idx) {
    if (!_virtualState.active) return;
    if (!_virtualState.scrollContainer) return;
    // 边界保护：负数或超出长度的索引会导致滚动到无效位置
    if (typeof idx !== 'number' || idx < 0 || idx >= _virtualState.items.length) return;
    if (!_virtualState.rowHeight || _virtualState.rowHeight <= 0) return;
    const targetTop = idx * _virtualState.rowHeight;
    const container = _virtualState.scrollContainer;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (targetTop < viewTop || targetTop >= viewBottom) {
        container.scrollTop = Math.max(0, targetTop - _virtualState.rowHeight * 2);
    }
}
