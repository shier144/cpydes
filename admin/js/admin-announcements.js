/* Cpydes 管理后台 —— 弹窗公告管理（admin-announcements.js），依赖 admin-core.js 先加载 */
'use strict';

/* ========== 公告管理 ========== */

// 公告类型元数据：图标 + 显示名 + badge 样式
const ANNOUNCEMENT_TYPES = {
    info:    { label: '通知', icon: 'info',          badge: 'badge-info' },
    success: { label: '成功', icon: 'check-circle',  badge: 'badge-ok' },
    warning: { label: '警告', icon: 'alert-triangle', badge: 'badge-warn' },
    error:   { label: '紧急', icon: 'alert-octagon',  badge: 'badge-err' },
};

// 受众选项
const ANNOUNCEMENT_AUDIENCES = [
    { value: 'all',    label: '所有人' },
    { value: 'users',  label: '仅登录用户' },
    { value: 'guests', label: '仅访客（未登录）' },
];

// 关闭行为选项
const ANNOUNCEMENT_CLOSE_BEHAVIORS = [
    { value: 'permanent', label: '不再提醒',   hint: '用户关闭后永久不再弹出（即使刷新或再次访问）' },
    { value: 'session',   label: '刷新后提醒', hint: '用户关闭后仅本次会话不再弹，刷新页面或下次访问时再次提醒' },
];

/**
 * 渲染公告管理视图（列表 + 工具栏）
 */
async function renderAnnouncements() {
    const c = document.getElementById('adminContent');
    const canManage = hasPermission('announcements.manage');
    const canView = hasPermission('view.announcements') || canManage;
    if (!canView) {
        c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="lock" style="width:48px;height:48px;"></i></div><div class="empty-text">权限不足，无法访问公告管理</div></div>`;
        refreshFeatherIcons();
        return;
    }

    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载公告列表...</div>';

    let list = [];
    try {
        const r = await adminApiFetch('listAnnouncements');
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        if (r.status === 403) {
            c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="lock" style="width:48px;height:48px;"></i></div><div class="empty-text">权限不足</div></div>`;
            refreshFeatherIcons();
            return;
        }
        const j = await r.json();
        if (!j.success) {
            c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`;
            refreshFeatherIcons();
            return;
        }
        list = Array.isArray(j.announcements) ? j.announcements : [];
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">网络错误</div></div>';
        refreshFeatherIcons();
        return;
    }

    AdminState.announcements = list;
    renderAnnouncementListView(list, canManage);
}

/**
 * 渲染公告列表视图
 * 采用标准 data-table 表格列表，与文案/用户管理等模块保持一致
 */
function renderAnnouncementListView(list, canManage) {
    const c = document.getElementById('adminContent');
    const kw = (AdminState.announcementFilter.keyword || '').toLowerCase();
    const statusFilter = AdminState.announcementFilter.status || 'all';

    let filtered = list.slice();
    if (kw) {
        filtered = filtered.filter(a => {
            const title = (a.title || '').toLowerCase();
            const content = (a.content || '').toLowerCase();
            return title.includes(kw) || content.includes(kw);
        });
    }
    if (statusFilter === 'active') {
        filtered = filtered.filter(a => isAnnouncementActiveNow(a));
    } else if (statusFilter === 'inactive') {
        filtered = filtered.filter(a => !isAnnouncementActiveNow(a));
    }

    const activeCount = list.filter(isAnnouncementActiveNow).length;
    const isFiltered = filtered.length !== list.length;

    // 列表主体：空态 or 表格
    let bodyHtml;
    if (filtered.length === 0) {
        const emptyText = list.length === 0 ? '暂无公告' : '没有符合条件的公告';
        const emptyHint = (list.length === 0 && canManage) ? '<div class="empty-hint">点击右上角"新建公告"创建</div>' : '';
        bodyHtml = `<div class="empty-state"><div class="empty-icon"><i data-feather="inbox" style="width:48px;height:48px;"></i></div><div class="empty-text">${emptyText}</div>${emptyHint}</div>`;
    } else {
        bodyHtml = `<table class="data-table">
            <thead>
                <tr>
                    <th style="width:90px">类型</th>
                    <th>标题</th>
                    <th>内容预览</th>
                    <th style="width:110px">展示对象</th>
                    <th style="width:180px">有效期</th>
                    <th style="width:90px">创建人</th>
                    <th style="width:140px">创建时间</th>
                    <th style="width:54px">版本</th>
                    ${canManage ? '<th style="width:150px;text-align:right">操作</th>' : ''}
                </tr>
            </thead>
            <tbody>
                ${filtered.map(a => renderAnnouncementRow(a, canManage)).join('')}
            </tbody>
        </table>`;
    }

    c.innerHTML = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="bell" style="width:16px;height:16px;"></i> 弹窗公告</div>
            <div class="panel-head-actions">
                ${canManage ? `<button class="btn btn-primary btn-sm" onclick="openAnnouncementEditor()"><i data-feather="plus" style="width:14px;height:14px;"></i> 新建公告</button>` : ''}
            </div>
        </div>
        <div class="panel-body no-pad">
            <div class="filter-bar" style="padding:14px 18px;border-bottom:1px solid var(--bd);display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                <div class="filter-search" style="flex:1;min-width:200px;position:relative;">
                    <span class="search-icon-xs" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--t4);"><i data-feather="search" style="width:14px;height:14px;"></i></span>
                    <input type="text" class="form-input" id="announcementKwInput"
                        placeholder="搜索标题或内容..."
                        value="${escapeAttr(AdminState.announcementFilter.keyword || '')}"
                        oninput="onAnnouncementFilterChange()"
                        style="padding-left:32px;width:100%;"
                        autocomplete="off" readonly onfocus="this.removeAttribute('readonly')">
                </div>
                <select class="form-select" id="announcementStatusFilter" onchange="onAnnouncementFilterChange()" style="min-width:140px;">
                    <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>全部状态</option>
                    <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>生效中</option>
                    <option value="inactive" ${statusFilter === 'inactive' ? 'selected' : ''}>未生效</option>
                </select>
            </div>
            <div class="stats-row" style="padding:8px 18px;font-size:12px;color:var(--t4);border-bottom:1px solid var(--bd);">
                共 ${list.length} 条 · 生效中 ${activeCount} 条 · 未生效 ${list.length - activeCount} 条${isFiltered ? ` · 当前筛选 ${filtered.length} 条` : ''}
            </div>
            ${bodyHtml}
        </div>
    </div>`;

    refreshFeatherIcons();
}

/**
 * 渲染单条公告行（表格行）
 */
function renderAnnouncementRow(a, canManage) {
    const type = ANNOUNCEMENT_TYPES[a.type] || ANNOUNCEMENT_TYPES.info;
    const isActive = isAnnouncementActiveNow(a);
    const enabled = !!a.enabled;
    const audience = a.audience || 'all';
    const audienceLabel = (ANNOUNCEMENT_AUDIENCES.find(x => x.value === audience) || {}).label || '所有人';
    const closeBehavior = a.closeBehavior || 'permanent';
    const closeBehaviorMeta = ANNOUNCEMENT_CLOSE_BEHAVIORS.find(x => x.value === closeBehavior) || ANNOUNCEMENT_CLOSE_BEHAVIORS[0];

    // 有效期展示
    let periodText = '长期有效';
    if (a.startAt && a.endAt) {
        periodText = `${formatDate(a.startAt)} ~ ${formatDate(a.endAt)}`;
    } else if (a.startAt) {
        periodText = `${formatDate(a.startAt)} 起`;
    } else if (a.endAt) {
        periodText = `截至 ${formatDate(a.endAt)}`;
    }

    // 状态徽章
    let statusBadge;
    if (!enabled) {
        statusBadge = '<span class="badge badge-err">已禁用</span>';
    } else if (!isActive) {
        statusBadge = '<span class="badge badge-warn">未生效</span>';
    } else {
        statusBadge = '<span class="badge badge-ok">生效中</span>';
    }

    const contentPreview = truncate(stripHtml(a.content || ''), 60) || '(无内容)';
    const titleText = truncate(a.title || '(无标题)', 30);

    return `
    <tr>
        <td><span class="badge ${type.badge}"><i data-feather="${type.icon}" style="width:11px;height:11px;vertical-align:middle;"></i> ${escapeHtml(type.label)}</span></td>
        <td class="cell-title">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="title-text">${escapeHtml(titleText)}</span>
                ${statusBadge}
            </div>
        </td>
        <td class="cell-preview" title="${escapeAttr(contentPreview)}">${escapeHtml(contentPreview)}</td>
        <td>
            <div>${escapeHtml(audienceLabel)}</div>
            <div style="font-size:11px;color:var(--t4);margin-top:2px;" title="${escapeAttr(closeBehaviorMeta.hint)}">
                <i data-feather="${closeBehavior === 'session' ? 'refresh-cw' : 'eye-off'}" style="width:10px;height:10px;vertical-align:middle;"></i>
                ${escapeHtml(closeBehaviorMeta.label)}
            </div>
        </td>
        <td class="cell-time">${escapeHtml(periodText)}</td>
        <td style="white-space:nowrap">${escapeHtml(a.createdByName || '未知')}</td>
        <td class="cell-time">${formatDate(a.createdAt)}</td>
        <td class="cell-id">v${a.version || 1}</td>
        ${canManage ? `<td class="cell-actions">
            <div class="row-actions">
                <button class="row-btn" onclick="editAnnouncement('${escapeAttr(a.id)}')"><i data-feather="edit-3" style="width:12px;height:12px;"></i> 编辑</button>
                <button class="row-btn" onclick="toggleAnnouncementStatus('${escapeAttr(a.id)}', ${enabled ? false : true})"><i data-feather="${enabled ? 'eye-off' : 'eye'}" style="width:12px;height:12px;"></i> ${enabled ? '禁用' : '启用'}</button>
                <button class="row-btn row-btn-danger" onclick="deleteAnnouncementConfirm('${escapeAttr(a.id)}')"><i data-feather="trash-2" style="width:12px;height:12px;"></i> 删除</button>
            </div>
        </td>` : ''}
    </tr>`;
}

/**
 * 判断公告当前是否处于生效状态（前端镜像 cpydes_is_announcement_active 逻辑）
 */
function isAnnouncementActiveNow(a) {
    if (!a || !a.enabled) return false;
    const now = Date.now();
    if (a.startAt) {
        const start = new Date(a.startAt).getTime();
        if (!isNaN(start) && now < start) return false;
    }
    if (a.endAt) {
        const end = new Date(a.endAt).getTime();
        if (!isNaN(end) && now > end) return false;
    }
    return true;
}

/**
 * 筛选条件变更
 */
function onAnnouncementFilterChange() {
    const kwInput = document.getElementById('announcementKwInput');
    const statusSelect = document.getElementById('announcementStatusFilter');
    if (kwInput) AdminState.announcementFilter.keyword = kwInput.value;
    if (statusSelect) AdminState.announcementFilter.status = statusSelect.value;
    const canManage = hasPermission('announcements.manage');
    renderAnnouncementListView(AdminState.announcements, canManage);
}

/**
 * 打开公告编辑器（新建或编辑）
 */
function openAnnouncementEditor(announcement) {
    const canManage = hasPermission('announcements.manage');
    if (!canManage) { showToast('无管理公告权限', 'error'); return; }

    const isEdit = !!announcement;
    const a = announcement || {
        id: '',
        title: '',
        content: '',
        type: 'info',
        enabled: true,
        dismissible: true,
        closeBehavior: 'permanent',
        audience: 'all',
        startAt: '',
        endAt: '',
    };
    // 旧数据兼容：未设置 closeBehavior 时默认 permanent
    if (!a.closeBehavior) a.closeBehavior = 'permanent';

    // 将 ISO 时间转换为 datetime-local 可用格式
    const toLocalInput = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const pad = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const typeOptions = Object.entries(ANNOUNCEMENT_TYPES).map(([value, meta]) =>
        `<option value="${value}" ${a.type === value ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`
    ).join('');
    const audienceOptions = ANNOUNCEMENT_AUDIENCES.map(opt =>
        `<option value="${opt.value}" ${a.audience === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`
    ).join('');
    const closeBehaviorOptions = ANNOUNCEMENT_CLOSE_BEHAVIORS.map(opt =>
        `<option value="${opt.value}" ${a.closeBehavior === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`
    ).join('');

    const bodyHtml = `
        <div class="ann-editor">
            <div class="form-group">
                <label class="form-label">标题 <span style="color:var(--err);">*</span></label>
                <input type="text" id="annTitleInput" class="form-input" maxlength="100"
                    placeholder="例如：系统维护通知" value="${escapeAttr(a.title || '')}" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label">内容</label>
                <textarea id="annContentInput" class="form-textarea" rows="4" maxlength="5000"
                    placeholder="公告正文，支持换行（最长 5000 字）">${escapeHtml(a.content || '')}</textarea>
            </div>
            <div class="ann-grid2">
                <div class="form-group">
                    <label class="form-label">类型</label>
                    <select id="annTypeSelect" class="form-select">${typeOptions}</select>
                </div>
                <div class="form-group">
                    <label class="form-label">展示对象</label>
                    <select id="annAudienceSelect" class="form-select">${audienceOptions}</select>
                </div>
            </div>
            <div class="ann-grid2">
                <div class="form-group">
                    <label class="form-label">生效时间</label>
                    <input type="datetime-local" id="annStartAtInput" class="form-input" value="${toLocalInput(a.startAt)}">
                </div>
                <div class="form-group">
                    <label class="form-label">失效时间</label>
                    <input type="datetime-local" id="annEndAtInput" class="form-input" value="${toLocalInput(a.endAt)}">
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">关闭后行为</label>
                <select id="annCloseBehaviorSelect" class="form-select" onchange="updateCloseBehaviorHint()">${closeBehaviorOptions}</select>
                <div class="ann-cb-hint" id="annCloseBehaviorHint"></div>
            </div>
            <div class="ann-toggles">
                <div class="ann-toggle-row">
                    <div class="ann-toggle-info">
                        <span class="ann-toggle-title">启用公告</span>
                        <span class="ann-toggle-desc">关闭后即使到达生效时间也不会显示</span>
                    </div>
                    <label class="access-switch">
                        <input type="checkbox" id="annEnabledInput" ${a.enabled ? 'checked' : ''}>
                        <span class="access-switch-slider"></span>
                    </label>
                </div>
                <div class="ann-toggle-row">
                    <div class="ann-toggle-info">
                        <span class="ann-toggle-title">允许前台关闭</span>
                        <span class="ann-toggle-desc">关闭后用户可点击关闭按钮；否则只能等待失效</span>
                    </div>
                    <label class="access-switch">
                        <input type="checkbox" id="annDismissibleInput" ${a.dismissible ? 'checked' : ''}>
                        <span class="access-switch-slider"></span>
                    </label>
                </div>
            </div>
            <div class="ann-foot-note">
                <i data-feather="info" style="width:13px;height:13px;flex-shrink:0;color:var(--pri);"></i>
                <span>修改标题/内容/类型时版本号自增，前台已读状态将失效，用户会再次看到公告</span>
            </div>
        </div>
    `;

    const footHtml = `
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveAnnouncementFromEditor('${escapeAttr(a.id || '')}')">
            <i data-feather="save" style="width:14px;height:14px;"></i> ${isEdit ? '保存修改' : '创建公告'}
        </button>
    `;

    openModal(
        `<i data-feather="${isEdit ? 'edit-3' : 'plus'}" style="width:16px;height:16px;vertical-align:middle;"></i> ${isEdit ? '编辑公告' : '新建公告'}`,
        bodyHtml,
        footHtml
    );
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.remove('modal-narrow', 'modal-wide');
    refreshFeatherIcons();
    updateCloseBehaviorHint();
    setTimeout(() => { document.getElementById('annTitleInput')?.focus(); }, 100);
}

/**
 * 根据当前选择的关闭行为更新提示文案
 */
function updateCloseBehaviorHint() {
    const sel = document.getElementById('annCloseBehaviorSelect');
    const hint = document.getElementById('annCloseBehaviorHint');
    if (!sel || !hint) return;
    const opt = ANNOUNCEMENT_CLOSE_BEHAVIORS.find(x => x.value === sel.value);
    hint.textContent = opt ? opt.hint : '';
}

/**
 * 编辑现有公告
 */
function editAnnouncement(id) {
    const a = AdminState.announcements.find(x => x.id === id);
    if (!a) { showToast('公告不存在', 'error'); return; }
    openAnnouncementEditor(a);
}

/**
 * 保存公告（新建/编辑统一入口）
 */
async function saveAnnouncementFromEditor(id) {
    if (!hasPermission('announcements.manage')) { showToast('无管理公告权限', 'error'); return; }
    const titleInput = document.getElementById('annTitleInput');
    const contentInput = document.getElementById('annContentInput');
    const typeSelect = document.getElementById('annTypeSelect');
    const audienceSelect = document.getElementById('annAudienceSelect');
    const closeBehaviorSelect = document.getElementById('annCloseBehaviorSelect');
    const startInput = document.getElementById('annStartAtInput');
    const endInput = document.getElementById('annEndAtInput');
    const enabledInput = document.getElementById('annEnabledInput');
    const dismissibleInput = document.getElementById('annDismissibleInput');

    const title = (titleInput?.value || '').trim();
    if (!title) { showToast('公告标题不能为空', 'error'); titleInput?.focus(); return; }

    const payload = {
        title,
        content: contentInput?.value || '',
        type: typeSelect?.value || 'info',
        audience: audienceSelect?.value || 'all',
        closeBehavior: closeBehaviorSelect?.value || 'permanent',
        startAt: startInput?.value || '',
        endAt: endInput?.value || '',
        enabled: !!enabledInput?.checked,
        dismissible: !!dismissibleInput?.checked,
    };

    const action = id ? 'updateAnnouncement' : 'createAnnouncement';
    if (id) payload.id = id;

    try {
        const r = await adminApiFetch(action, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (j.success) {
            showToast(id ? '公告已更新' : '公告已创建', 'success');
            closeModal();
            await renderAnnouncements();
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

/**
 * 切换公告启用状态
 */
async function toggleAnnouncementStatus(id, enabled) {
    if (!hasPermission('announcements.manage')) { showToast('无管理公告权限', 'error'); return; }
    try {
        const r = await adminApiFetch('toggleAnnouncement', {
            method: 'POST',
            body: JSON.stringify({ id, enabled }),
        });
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (j.success) {
            showToast(enabled ? '已启用' : '已禁用', 'success', 1500);
            // 局部更新缓存中的状态，避免全量重载
            const idx = AdminState.announcements.findIndex(x => x.id === id);
            if (idx !== -1) {
                AdminState.announcements[idx].enabled = enabled;
                AdminState.announcements[idx].updatedAt = new Date().toISOString();
            }
            const canManage = hasPermission('announcements.manage');
            renderAnnouncementListView(AdminState.announcements, canManage);
        } else {
            showToast(j.error || '操作失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

/**
 * 删除公告（带确认）
 */
async function deleteAnnouncementConfirm(id) {
    if (!hasPermission('announcements.manage')) { showToast('无管理公告权限', 'error'); return; }
    const a = AdminState.announcements.find(x => x.id === id);
    const title = a ? a.title : '';
    const ok = await showConfirm(`确定删除公告「${title}」吗？此操作不可恢复。`, 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteAnnouncement', {
            method: 'POST',
            body: JSON.stringify({ id }),
        });
        if (r.status === 401) { showToast('会话已过期，请重新登录', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (j.success) {
            showToast('公告已删除', 'success');
            AdminState.announcements = AdminState.announcements.filter(x => x.id !== id);
            const canManage = hasPermission('announcements.manage');
            renderAnnouncementListView(AdminState.announcements, canManage);
        } else {
            showToast(j.error || '删除失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}
