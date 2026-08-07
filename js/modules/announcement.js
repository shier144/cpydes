// ========== 弹窗公告模块 ==========
// 职责：在前台加载完成后拉取并展示当前有效的公告
// 已读状态：以 localStorage（key: cpydes_read_announcements）记录 {id: version}
//          当公告版本号变更或被删除后，已读记录自动失效
//
// 依赖：appState（state.js）、escapeHtml/$（utils.js）、showToast（dialogs.js）、refreshFeatherIcons（index.php）

const ANNOUNCEMENT_READ_KEY = 'cpydes_read_announcements';
const ANNOUNCEMENT_DISMISSED_KEY = 'cpydes_dismissed_announcements';

// 类型 → 图标 + 主题色（用于头部图标背景与边框）
const ANNOUNCEMENT_TYPE_META = {
    info:    { icon: 'info',           color: '#007aff' },
    success: { icon: 'check-circle',   color: '#34c759' },
    warning: { icon: 'alert-triangle', color: '#ff9500' },
    error:   { icon: 'alert-octagon',  color: '#ff3b30' },
};

// 当前会话内已弹出的公告队列（按顺序展示）
let _announcementQueue = [];
let _announcementCurrentIdx = 0;

/**
 * 主入口：拉取并展示未读的生效公告
 * 在 app.js 初始化、访问权限校验通过后调用
 */
async function checkAnnouncements() {
    try {
        const r = await fetch('api.php?action=getActiveAnnouncements');
        if (!r.ok) return;
        const j = await r.json();
        if (!j.success || !Array.isArray(j.announcements)) return;
        if (j.announcements.length === 0) return;

        // 过滤未读：以 id + version 判断
        const readMap = loadReadMap();
        const pending = j.announcements.filter(a => {
            const readVersion = readMap[a.id];
            return readVersion !== (a.version || 1);
        });
        if (pending.length === 0) return;

        // 过滤当前会话已主动关闭的（避免用户关闭后又刷新反复弹）
        const dismissed = loadDismissedSet();
        const toShow = pending.filter(a => !dismissed.has(a.id + '_v' + (a.version || 1)));
        if (toShow.length === 0) return;

        _announcementQueue = toShow;
        _announcementCurrentIdx = 0;
        showAnnouncementAt(0);
    } catch (e) {
        console.error('加载公告失败:', e);
    }
}

/**
 * 展示队列中指定索引的公告
 */
function showAnnouncementAt(idx) {
    if (idx < 0 || idx >= _announcementQueue.length) {
        closeAnnouncementOverlay();
        return;
    }
    _announcementCurrentIdx = idx;
    const a = _announcementQueue[idx];
    renderAnnouncementOverlay(a, idx, _announcementQueue.length);
    openAnnouncementOverlay();
}

/**
 * 渲染公告弹窗内容
 */
function renderAnnouncementOverlay(a, idx, total) {
    const overlay = document.getElementById('announcementOverlay');
    if (!overlay) return;

    const meta = ANNOUNCEMENT_TYPE_META[a.type] || ANNOUNCEMENT_TYPE_META.info;

    // 头部图标与配色
    const iconWrap = document.getElementById('announcementIconWrap');
    if (iconWrap) {
        iconWrap.innerHTML = `<i data-feather="${meta.icon}" style="width:22px;height:22px;"></i>`;
        iconWrap.style.background = meta.color + '1a';  // 10% 透明度
        iconWrap.style.color = meta.color;
    }
    const dialog = document.getElementById('announcementDialog');
    if (dialog) {
        dialog.style.borderTop = `3px solid ${meta.color}`;
    }

    // 标题
    const titleEl = document.getElementById('announcementTitle');
    if (titleEl) titleEl.textContent = a.title || '公告';

    // 正文：按换行渲染为段落，HTML 转义后注入
    const bodyEl = document.getElementById('announcementBody');
    if (bodyEl) {
        const content = a.content || '';
        const paragraphs = content.split(/\r?\n/).map(line => {
            if (line.trim() === '') return '';
            return '<p>' + escapeHtml(line) + '</p>';
        }).filter(Boolean).join('');
        bodyEl.innerHTML = paragraphs || '<p style="color:var(--t3);">（无内容）</p>';
    }

    // 关闭按钮：dismissible=false 时隐藏
    const closeBtn = document.getElementById('announcementCloseBtn');
    if (closeBtn) {
        closeBtn.style.display = a.dismissible === false ? 'none' : '';
    }

    // 底部按钮：dismissible=false 时隐藏；否则按 closeBehavior 调整文案
    const footEl = document.getElementById('announcementFoot');
    if (footEl) {
        if (a.dismissible === false) {
            footEl.style.display = 'none';
        } else {
            footEl.style.display = '';
            const btn = footEl.querySelector('button');
            if (btn) {
                // closeBehavior: 'permanent' → 不再提醒；'session' → 本次关闭（刷新后再次提醒）
                const isSession = (a.closeBehavior || 'permanent') === 'session';
                const baseText = isSession ? '本次关闭' : '我知道了';
                btn.textContent = total > 1 ? `${baseText} (${idx + 1}/${total})` : baseText;
                btn.title = isSession ? '本次关闭后，刷新页面或下次访问时将再次提醒' : '关闭后不再提醒';
            }
        }
    }

    // 分页指示器（多条公告时显示）
    const pager = document.getElementById('announcementPager');
    if (pager) {
        if (total > 1) {
            const dots = _announcementQueue.map((_, i) => {
                const cls = i === idx ? 'ann-dot active' : 'ann-dot';
                return `<span class="${cls}" onclick="showAnnouncementAt(${i}); event.stopPropagation();"></span>`;
            }).join('');
            pager.innerHTML = dots;
            pager.style.display = 'flex';
        } else {
            pager.style.display = 'none';
            pager.innerHTML = '';
        }
    }

    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
}

/**
 * 打开弹窗（添加 show 类）
 */
function openAnnouncementOverlay() {
    const overlay = document.getElementById('announcementOverlay');
    if (overlay) {
        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

/**
 * 关闭弹窗（移除 show 类，不标记已读）
 */
function closeAnnouncementOverlay() {
    const overlay = document.getElementById('announcementOverlay');
    if (overlay) {
        overlay.classList.remove('show');
        document.body.style.overflow = '';
    }
}

/**
 * 关闭当前公告，若队列中还有下一条则展示下一条
 *
 * 关闭策略由公告的 closeBehavior 字段决定：
 * - 'permanent'（默认）：写入 localStorage 永久标记已读，刷新或再次访问时不再提醒
 * - 'session'：仅写入 sessionStorage 标记本会话已关闭，刷新页面或下次访问时再次提醒
 *
 * 两种策略都会写入 sessionStorage，防止本会话内刷新反复弹出
 */
function dismissCurrentAnnouncement() {
    const a = _announcementQueue[_announcementCurrentIdx];
    if (a) {
        const behavior = a.closeBehavior || 'permanent';
        // session 关闭记录始终写入，防止本会话内重复弹出
        markAnnouncementDismissed(a.id, a.version || 1);
        // 仅 permanent 模式才写入 localStorage 永久已读记录
        if (behavior === 'permanent') {
            markAnnouncementRead(a.id, a.version || 1);
        }
    }
    const next = _announcementCurrentIdx + 1;
    if (next < _announcementQueue.length) {
        showAnnouncementAt(next);
    } else {
        // 队列已空：清理已关闭记录中不再有效的条目（避免 sessionStorage 无限增长）
        cleanupDismissedSet();
        closeAnnouncementOverlay();
        _announcementQueue = [];
        _announcementCurrentIdx = 0;
    }
}

/**
 * 点击背景关闭：仅当当前公告允许关闭时才生效
 */
function dismissAnnouncementBackdrop() {
    const a = _announcementQueue[_announcementCurrentIdx];
    if (!a) return;
    if (a.dismissible === false) return;  // 不可关闭时，点击背景无效
    dismissCurrentAnnouncement();
}

/* ========== 已读状态管理（localStorage）========== */

function loadReadMap() {
    try {
        const raw = localStorage.getItem(ANNOUNCEMENT_READ_KEY);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? obj : {};
    } catch (e) {
        return {};
    }
}

function saveReadMap(map) {
    try {
        localStorage.setItem(ANNOUNCEMENT_READ_KEY, JSON.stringify(map));
    } catch (e) {}
}

function markAnnouncementRead(id, version) {
    const map = loadReadMap();
    map[id] = version;
    saveReadMap(map);
}

/* ========== 当前会话已关闭记录（防止刷新重复弹）========== */

function loadDismissedSet() {
    try {
        const raw = sessionStorage.getItem(ANNOUNCEMENT_DISMISSED_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch (e) {
        return new Set();
    }
}

function saveDismissedSet(set) {
    try {
        sessionStorage.setItem(ANNOUNCEMENT_DISMISSED_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {}
}

function markAnnouncementDismissed(id, version) {
    const set = loadDismissedSet();
    set.add(id + '_v' + version);
    saveDismissedSet(set);
}

/**
 * 清理已关闭记录中不再有效的条目（公告被删除或版本变更后）
 */
function cleanupDismissedSet() {
    const set = loadDismissedSet();
    if (set.size === 0) return;
    const validIds = new Set(_announcementQueue.map(a => a.id + '_v' + (a.version || 1)));
    const cleaned = new Set();
    set.forEach(key => { if (validIds.has(key)) cleaned.add(key); });
    if (cleaned.size !== set.size) saveDismissedSet(cleaned);
}

/**
 * 重置所有公告的已读状态（前台入口，便于用户重新查看）
 */
function resetAnnouncementReadState() {
    saveReadMap({});
    try { sessionStorage.removeItem(ANNOUNCEMENT_DISMISSED_KEY); } catch (e) {}
}
