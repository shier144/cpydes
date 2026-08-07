/**
 * 共享工具模块（前后台通用）
 * 提供 escapeHtml / escapeAttr / sanitizeColor / refreshFeatherIcons 等基础工具
 * 由 index.php / ai.html / admin/index.php 在 head 中以 defer 方式加载（早于业务模块）
 */
(function (global) {
    'use strict';

    // ========== 高性能 HTML/属性转义（正则替代 DOM 操作） ==========
    var ESCAPE_REPL = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    var ESCAPE_RE = /[&<>"']/g;

    function escapeHtml(text) {
        if (text == null) return '';
        if (typeof text !== 'string') text = String(text);
        return text.replace(ESCAPE_RE, function (c) { return ESCAPE_REPL[c]; });
    }

    function escapeAttr(str) {
        if (str == null) return '';
        if (typeof str !== 'string') str = String(str);
        return str.replace(ESCAPE_RE, function (c) { return ESCAPE_REPL[c]; });
    }

    // ========== 颜色值过滤：只允许 #hex 和 rgb()/rgba() 格式，防止 CSS 注入 ==========
    var HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    var RGBA_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i;

    function sanitizeColor(c) {
        if (typeof c !== 'string') return null;
        c = c.trim();
        if (!c) return null;
        if (HEX_RE.test(c)) return c;
        if (RGBA_RE.test(c)) return c;
        return null;
    }

    // ========== feather 图标刷新（rAF 节流，避免短时间重复触发 reflow） ==========
    var _featherRafQueued = false;
    function refreshFeatherIcons() {
        if (_featherRafQueued) return;
        _featherRafQueued = true;
        (global.requestAnimationFrame || function (cb) { setTimeout(cb, 16); })(function () {
            _featherRafQueued = false;
            if (typeof global.feather !== 'undefined' && typeof global.feather.replace === 'function') {
                try { global.feather.replace(); } catch (e) { /* ignore */ }
            }
        });
    }

    // ========== 暴露到全局 ==========
    global.escapeHtml = escapeHtml;
    global.escapeAttr = escapeAttr;
    global.sanitizeColor = sanitizeColor;
    global.refreshFeatherIcons = refreshFeatherIcons;
})(typeof window !== 'undefined' ? window : this);
