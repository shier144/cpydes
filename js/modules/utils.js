// escapeHtml / escapeAttr / sanitizeColor 已迁移至 js/shared-utils.js（前后台共享）
// 本文件仅保留前端专用工具：stripHtml（带缓存）/ expandHex / formatDate（相对时间）/ getRandomColor / debounce / $

function stripHtml(html) {
    if (!html) return '';
    const cached = appCache.stripHtml.get(html);
    if (cached !== undefined) return cached;
    const result = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    appCache.stripHtml.set(html, result);
    return result;
}

/**
 * 将 3/4 位 hex 扩展为 6/8 位
 */
function expandHex(hex) {
    if (!hex || hex[0] !== '#') return hex;
    const h = hex.slice(1);
    if (h.length === 3) return '#' + h.split('').map(c => c + c).join('');
    if (h.length === 4) return '#' + h.split('').map(c => c + c).join('');
    return hex;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    const now = new Date();
    const diff = now - date;

    let result;
    if (diff < 60000) result = '刚刚';
    else if (diff < 3600000) result = Math.floor(diff / 60000) + '分钟前';
    else if (diff < 86400000) result = Math.floor(diff / 3600000) + '小时前';
    else if (diff < 604800000) result = Math.floor(diff / 86400000) + '天前';
    else {
        // 仅缓存绝对日期（超过7天），相对时间会随时间变化不应缓存
        const cached = appCache.formatDate.get(dateStr);
        if (cached !== undefined) return cached;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        result = `${y}-${m}-${d}`;
        appCache.formatDate.set(dateStr, result);
    }

    return result;
}

function getRandomColor() {
    const colors = ['#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// ========== 防抖（通用工具函数） ==========
function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

// ========== DOM 查询缓存 ==========
function $(id) {
    const cached = appCache.dom.get(id);
    if (cached !== undefined) return cached;
    const el = document.getElementById(id);
    appCache.dom.set(id, el);
    return el;
}
