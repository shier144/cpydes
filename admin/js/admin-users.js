/* Cpydes 管理后台 —— 由 admin.js 机械拆分（admin-users.js），依赖 admin-core.js 先加载 */
'use strict';

/* ========== 用户管理（合并：用户列表 + 角色管理） ========== */
const USER_MANAGE_TABS = [
    { id: 'users', label: '用户列表', icon: 'user',   perm: 'view.users' },
    { id: 'roles', label: '角色管理', icon: 'shield', perm: 'view.roles' },
];

async function renderUserManage(targetContainer, tab) {
    const c = targetContainer || document.getElementById('adminContent');

    // 默认 Tab：按权限选择第一个可见 Tab
    if (!tab || !USER_MANAGE_TABS.find(t => t.id === tab && hasPermission(t.perm))) {
        const first = USER_MANAGE_TABS.find(t => hasPermission(t.perm));
        tab = first ? first.id : '';
    }
    AdminState.userManageTab = tab;

    if (!tab) {
        c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">权限不足，无法访问用户管理</div></div>`;
        refreshFeatherIcons();
        return;
    }

    const tabsHtml = USER_MANAGE_TABS.map(t => {
        if (!hasPermission(t.perm)) return '';
        const active = t.id === tab ? 'active' : '';
        return `<button class="adm-tab-btn ${active}" onclick="switchUserManageTab('${t.id}')"><i data-feather="${t.icon}"></i> ${t.label}</button>`;
    }).join('');

    c.innerHTML = `
    <div class="adm-tabs-shell">
        <div class="adm-tabs-bar">${tabsHtml}</div>
        <div class="adm-tab-body" id="userManageBody"><div class="loading-state"><div class="spinner"></div>加载中...</div></div>
    </div>`;
    refreshFeatherIcons();

    const body = document.getElementById('userManageBody');
    if (!body) return;

    if (tab === 'users') {
        await renderUsers(body);
    } else if (tab === 'roles') {
        await renderRoles(body);
    }
}

function switchUserManageTab(tab) {
    renderUserManage(null, tab);
}

/* ========== 统计分析（合并：在线用户 + 访问日志 + 使用统计） ========== */
const STATS_ANALYSIS_TABS = [
    { id: 'online',    label: '在线用户', icon: 'wifi',         perm: 'view.onlineUsers' },
    { id: 'activity',  label: '访问日志', icon: 'clock',        perm: 'view.activityLog' },
    { id: 'usage',     label: '使用统计', icon: 'trending-up',  perm: 'view.usageStats' },
];

async function renderStatsAnalysis(targetContainer, tab) {
    const c = targetContainer || document.getElementById('adminContent');

    if (!tab || !STATS_ANALYSIS_TABS.find(t => t.id === tab && hasPermission(t.perm))) {
        const first = STATS_ANALYSIS_TABS.find(t => hasPermission(t.perm));
        tab = first ? first.id : '';
    }
    AdminState.statsAnalysisTab = tab;

    if (!tab) {
        c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">权限不足，无法访问统计分析</div></div>`;
        refreshFeatherIcons();
        return;
    }

    const tabsHtml = STATS_ANALYSIS_TABS.map(t => {
        if (!hasPermission(t.perm)) return '';
        const active = t.id === tab ? 'active' : '';
        return `<button class="adm-tab-btn ${active}" onclick="switchStatsAnalysisTab('${t.id}')"><i data-feather="${t.icon}"></i> ${t.label}</button>`;
    }).join('');

    c.innerHTML = `
    <div class="adm-tabs-shell">
        <div class="adm-tabs-bar">${tabsHtml}</div>
        <div class="adm-tab-body" id="statsAnalysisBody"><div class="loading-state"><div class="spinner"></div>加载中...</div></div>
    </div>`;
    refreshFeatherIcons();

    const body = document.getElementById('statsAnalysisBody');
    if (!body) return;

    if (tab === 'online') {
        await renderOnlineUsers(body);
    } else if (tab === 'activity') {
        await renderActivityLog(body);
    } else if (tab === 'usage') {
        await renderUsageStats(body);
    }
}

function switchStatsAnalysisTab(tab) {
    renderStatsAnalysis(null, tab);
}

/* ========== 用户管理 ========== */

// 角色列表缓存
let _rolesCache = null;
let _rolesCacheTime = 0;
const ROLES_CACHE_TTL = 60000;

async function getRolesList(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _rolesCache && (now - _rolesCacheTime) < ROLES_CACHE_TTL) {
        return _rolesCache;
    }
    try {
        const r = await adminApiFetch('listRoles');
        const j = await r.json();
        if (j.success) {
            _rolesCache = j.roles || [];
            _rolesCacheTime = now;
            return _rolesCache;
        }
    } catch (e) {
        console.error('加载角色列表失败', e);
    }
    return _rolesCache || [];
}

function getRoleName(roleId, roles) {
    if (!roleId) return '未知';
    const role = (roles || []).find(r => r.id === roleId);
    if (role) return role.name;
    // 向后兼容旧角色名
    const compatNames = { admin: '管理员', editor: '编辑者', viewer: '访客' };
    return compatNames[roleId] || roleId;
}

function buildRoleOptions(roles, selectedRole) {
    return roles.map(role =>
        `<option value="${escapeAttr(role.id)}" ${role.id === selectedRole ? 'selected' : ''}>${escapeHtml(role.name)}${role.isSystem ? ' (系统)' : ''}</option>`
    ).join('');
}

async function renderUsers(targetContainer) {
    const c = targetContainer || document.getElementById('userManageBody') || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载用户列表...</div>';

    try {
        // 并行加载用户和角色列表
        const [usersR, roles] = await Promise.all([
            adminApiFetch('getUsers'),
            getRolesList()
        ]);
        
        if (usersR.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await usersR.json();
        if (!j.success) {
            c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`;
            return;
        }

        const users = j.users || [];
        AdminState.users = users;
        const canManage = hasPermission('users.manage');

        const statusLabels = { active: '正常', disabled: '已禁用', banned: '已封禁' };

        const userRows = users.map(user => {
            const status = user.status || 'active';
            const roleDisplay = getRoleName(user.role, roles);
            return `
            <tr>
                <td class="checkbox-col"><input type="checkbox" class="user-checkbox" data-id="${escapeAttr(user.id)}" ${status !== 'active' ? 'disabled title="该用户非正常状态"' : ''}></td>
                <td><a href="javascript:void(0)" onclick="showUserDetail('${user.id}')" style="color:var(--p);text-decoration:none;font-weight:500">${escapeHtml(user.username)}</a></td>
                <td><span class="user-role-badge">${escapeHtml(roleDisplay)}</span></td>
                <td><span class="status-indicator status-${status}"></span>${statusLabels[status] || status}</td>
                <td>${user.loginCount || 0}</td>
                <td>${formatDate(user.lastLogin)}</td>
                <td class="user-actions">
                    ${canManage ? `<button class="btn btn-default btn-sm" onclick="editUser('${escapeAttr(user.id)}')">编辑</button>` : ''}
                    ${canManage ? `<button class="btn btn-default btn-sm" onclick="resetPassword('${escapeAttr(user.id)}')">重置密码</button>` : ''}
                    ${canManage && user.id !== AdminState.currentUser?.id ? `<button class="btn btn-default btn-sm" onclick="deleteUser('${escapeAttr(user.id)}')">删除</button>` : ''}
                </td>
            </tr>`;
        }).join('');

        const html = `
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="users" style="width:16px;height:16px;"></i> 用户管理</div>
                <div style="display:flex;gap:8px;align-items:center">
                    <select id="userStatusFilter" class="form-select" style="width:100px" onchange="filterUsersByStatus()">
                        <option value="">全部状态</option>
                        <option value="active">正常</option>
                        <option value="disabled">已禁用</option>
                        <option value="banned">已封禁</option>
                    </select>
                    ${canManage ? '<button class="btn btn-primary btn-sm" onclick="createUser()"><i data-feather="user-plus" style="width:14px;height:14px;"></i> 新建用户</button>' : ''}
                </div>
            </div>
            <div class="panel-body">
                <table class="user-table">
                    <thead>
                        <tr>
                            <th class="checkbox-col"><input type="checkbox" id="selectAllUsers" onchange="toggleAllUserCheckboxes(this.checked)"></th>
                            <th>用户名</th>
                            <th>角色</th>
                            <th>状态</th>
                            <th>登录次数</th>
                            <th>最后登录</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody id="userTableBody">
                        ${users.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--t3);">暂无用户</td></tr>' : userRows}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="bulk-action-bar" id="bulkActionBar" style="display:none">
            <span id="bulkSelectedCount">已选择 0 个用户</span>
            <button class="btn btn-default btn-sm" onclick="bulkUpdateUserStatus('active')">启用</button>
            <button class="btn btn-default btn-sm" onclick="bulkUpdateUserStatus('disabled')">禁用</button>
            <button class="btn btn-default btn-sm" onclick="bulkUpdateUserStatus('banned')">封禁</button>
        </div>`;
        c.innerHTML = html;
        refreshFeatherIcons();

        // 监听 checkbox 变化
        document.querySelectorAll('.user-checkbox').forEach(cb => {
            cb.addEventListener('change', updateBulkActionBar);
        });
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">网络错误</div></div>';
    }
}

function toggleAllUserCheckboxes(checked) {
    document.querySelectorAll('.user-checkbox').forEach(cb => { cb.checked = checked; });
    updateBulkActionBar();
}

function updateBulkActionBar() {
    const checked = document.querySelectorAll('.user-checkbox:checked');
    const bar = document.getElementById('bulkActionBar');
    const count = document.getElementById('bulkSelectedCount');
    if (bar) {
        bar.style.display = checked.length > 0 ? 'flex' : 'none';
        if (count) count.textContent = `已选择 ${checked.length} 个用户`;
    }
}

function filterUsersByStatus() {
    const filter = document.getElementById('userStatusFilter')?.value || '';
    const rows = document.querySelectorAll('#userTableBody tr');
    rows.forEach(row => {
        if (row.children.length < 4) { row.style.display = ''; return; }
        if (!filter) { row.style.display = ''; return; }
        const statusCell = row.children[3];
        if (!statusCell) { row.style.display = ''; return; }
        const text = statusCell.textContent || '';
        const statusMap = { active: '正常', disabled: '已禁用', banned: '已封禁' };
        row.style.display = text.includes(statusMap[filter] || filter) ? '' : 'none';
    });
}

async function bulkUpdateUserStatus(status) {
    if (!hasPermission('users.manage')) { showToast('无管理用户权限', 'error'); return; }
    const checked = document.querySelectorAll('.user-checkbox:checked');
    if (checked.length === 0) return;
    const statusLabel = { active: '启用', disabled: '禁用', banned: '封禁' }[status] || status;
    // 排除当前登录用户自己，避免误把自己禁用/封禁后无法访问后台
    const currentId = AdminState.currentUser?.id;
    const allIds = Array.from(checked).map(cb => cb.dataset.id);
    const userIds = allIds.filter(id => id !== currentId);
    if (status !== 'active' && userIds.length < allIds.length) {
        showToast('不能对自己执行禁用/封禁操作，已自动排除', 'warning');
    }
    if (userIds.length === 0) return;
    const ok = await showConfirm(`确定要${statusLabel} ${userIds.length} 个用户吗？`, 'alert-triangle');
    if (!ok) return;
    try {
        const r = await adminApiFetch('bulkUpdateStatus', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds, status })
        });
        const j = await r.json();
        if (j.success) { showToast(`已${statusLabel} ${j.updated} 个用户`, 'success'); renderUsers(); }
        else { showToast(j.error || '操作失败', 'error'); }
    } catch (e) { showToast('操作失败', 'error'); }
}

async function showUserDetail(userId) {
    try {
        const [detailR, roles] = await Promise.all([
            adminApiFetch('getUserDetail?userId=' + encodeURIComponent(userId)),
            getRolesList()
        ]);
        const j = await detailR.json();
        if (!j.success) { showToast(j.error || '获取失败', 'error'); return; }
        const u = j.user;
        const statusLabels = { active: '正常', disabled: '已禁用', banned: '已封禁' };
        const status = u.status || 'active';
        const roleDisplay = getRoleName(u.role, roles);

        const recentRows = (j.recentActivity || []).map(l => {
            const label = ACTION_LABELS[l.action] || l.action;
            return `<tr><td>${formatDate(l.timestamp)}</td><td><span class="activity-action-badge ${getActionBadgeClass(l.action)}">${escapeHtml(label)}</span></td><td>${escapeHtml(l.detail || '-')}</td><td><span class="activity-result-badge ${l.success ? 'result-success' : 'result-fail'}">${l.success ? '成功' : '失败'}</span></td></tr>`;
        }).join('');

        const modalHtml = `
        <div class="user-detail-card">
            <div class="detail-row"><span class="detail-label">用户名</span><span class="detail-value">${escapeHtml(u.username)}</span></div>
            <div class="detail-row"><span class="detail-label">角色</span><span class="detail-value"><span class="user-role-badge">${escapeHtml(roleDisplay)}</span></span></div>
            <div class="detail-row"><span class="detail-label">状态</span><span class="detail-value"><span class="status-indicator status-${status}"></span>${statusLabels[status]} ${j.isOnline ? '<span class="online-indicator"></span> 在线' : '离线'}</span></div>
            <div class="detail-row"><span class="detail-label">备注</span><span class="detail-value">${escapeHtml(u.notes || '-')}</span></div>
            <div class="detail-row"><span class="detail-label">创建时间</span><span class="detail-value">${formatDate(u.createdAt)}</span></div>
            <div class="detail-row"><span class="detail-label">最后登录</span><span class="detail-value">${formatDate(u.lastLogin)}</span></div>
            <div class="detail-row"><span class="detail-label">登录次数</span><span class="detail-value">${u.loginCount || 0}</span></div>
        </div>
        <div style="margin-top:16px">
            <div style="font-weight:600;margin-bottom:8px">最近活动</div>
            <table class="user-table activity-table" style="font-size:12px">
                <thead><tr><th>时间</th><th>操作</th><th>详情</th><th>结果</th></tr></thead>
                <tbody>${recentRows || '<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:20px">暂无活动</td></tr>'}</tbody>
            </table>
        </div>`;

        // 详情视图是只读的，用 openModal + "关闭"按钮，而非 showModal 的"保存"按钮
        openModal('用户详情 - ' + u.username, modalHtml, '<button class="btn btn-default" onclick="closeModal()">关闭</button>');
    } catch (e) { showToast('获取用户详情失败', 'error'); }
}

async function resetPassword(userId) {
    if (!hasPermission('users.manage')) { showToast('无管理用户权限', 'error'); return; }
    // 从已加载的用户列表中查找用户名，避免拼接 onclick 字符串时的引号注入风险
    const user = (AdminState.users || []).find(u => u.id === userId);
    const username = user ? user.username : userId;

    const modalHtml = `
        <div class="user-form-group">
            <label>新密码</label>
            <input type="password" id="resetPwdInput" class="form-input" placeholder="请输入新密码（至少4位）..." autocomplete="new-password" required minlength="4">
        </div>
        <div class="user-form-group">
            <label>确认新密码</label>
            <input type="password" id="resetPwdConfirm" class="form-input" placeholder="请再次输入新密码..." autocomplete="new-password" required minlength="4">
        </div>
        <div class="user-form-group">
            <label class="perm-checkbox"><input type="checkbox" id="resetForceRelogin" checked><span>强制重新登录</span></label>
        </div>`;

    await showModal(`重置密码 - ${escapeHtml(username)}`, modalHtml, async () => {
        const newPwd = document.getElementById('resetPwdInput').value;
        const confirm = document.getElementById('resetPwdConfirm').value;
        if (!newPwd || newPwd.length < 6 || newPwd.length > 72) { showToast('密码长度需为 6-72 位', 'error'); return false; }
        if (newPwd !== confirm) { showToast('两次密码不一致', 'error'); return false; }
        try {
            const r = await adminApiFetch('resetPassword', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: userId, newPassword: newPwd, forceRelogin: document.getElementById('resetForceRelogin').checked })
            });
            const j = await r.json();
            if (j.success) { showToast('密码重置成功', 'success'); return true; }
            else { showToast(j.error || '重置失败', 'error'); return false; }
        } catch (e) { showToast('重置失败', 'error'); return false; }
    });
}

async function createUser() {
    if (!hasPermission('users.manage')) { showToast('无管理用户权限', 'error'); return; }
    
    // 先获取角色列表
    const roles = await getRolesList();
    const roleOptions = buildRoleOptions(roles, 'role_editor');
    
    const modalHtml = `
        <div class="user-form-group">
            <label>用户名</label>
            <input type="text" id="newUsername" class="form-input" placeholder="请输入用户名..." autocomplete="off" required>
        </div>
        <div class="user-form-group">
            <label>密码</label>
            <input type="password" id="newUserPassword" class="form-input" placeholder="请输入密码（至少4位）..." autocomplete="new-password" required minlength="4">
        </div>
        <div class="user-form-group">
            <label>角色</label>
            <select id="newUserRole" class="form-select">
                ${roleOptions}
            </select>
        </div>
        <div class="user-form-group">
            <label>备注（可选）</label>
            <textarea id="newUserNotes" class="form-input" rows="2" placeholder="备注信息..."></textarea>
        </div>
    `;

    // 先打开弹窗
    const openPromise = new Promise((resolve) => {
        if (_modalResolver) _modalResolver(false);
        openModal(
            '新建用户',
            modalHtml,
            '<button class="btn btn-default" onclick="closeModalAndResolve(false)">取消</button>' +
            '<button class="btn btn-primary" onclick="handleModalSave()">保存</button>'
        );
        const dialog = document.querySelector('.modal-dialog');
        if (dialog) dialog.classList.add('modal-narrow');
        setTimeout(() => { document.getElementById('newUsername')?.focus(); }, 100);
        _modalResolver = resolve;
        window._modalOnSave = async () => {
            const username = document.getElementById('newUsername').value.trim();
            const password = document.getElementById('newUserPassword').value;
            const role = document.getElementById('newUserRole').value;
            const notes = document.getElementById('newUserNotes').value.trim();

            if (!username) {
                showToast('请输入用户名', 'error');
                return false;
            }
            if (!password || password.length < 6 || password.length > 72) {
                showToast('密码长度需为 6-72 位', 'error');
                return false;
            }

            try {
                const r = await adminApiFetch('createUser', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, role, notes })
                });
                const j = await r.json();
                if (j.success) {
                    showToast('用户创建成功', 'success');
                    renderUsers();
                    return true;
                } else {
                    showToast(j.error || '创建失败', 'error');
                    return false;
                }
            } catch (e) {
                showToast('创建失败', 'error');
                return false;
            }
        };
    });
    return await openPromise;
}

async function editUser(userId) {
    if (!hasPermission('users.manage')) { showToast('无管理用户权限', 'error'); return; }
    try {
        // 并行加载用户和角色列表
        const [usersR, roles] = await Promise.all([
            adminApiFetch('getUsers'),
            getRolesList()
        ]);
        const j = await usersR.json();
        if (!j.success) {
            showToast('获取用户信息失败', 'error');
            return;
        }

        const user = j.users.find(u => u.id === userId);
        if (!user) {
            showToast('用户不存在', 'error');
            return;
        }

        // 权限点定义（按菜单分类分组，子分组内查看权限在前、操作权限在后）
        const permissionGroups = [
            {
                label: '仪表盘',
                perms: [
                    { key: 'view.dashboard', label: '查看仪表盘' },
                ]
            },
            {
                label: '内容管理',
                subgroups: [
                    { heading: '文案管理', perms: [
                        { key: 'view.content', label: '查看' },
                        { key: 'content.create', label: '新增' },
                        { key: 'content.edit', label: '编辑' },
                        { key: 'content.delete', label: '删除' },
                        { key: 'content.sort', label: '排序' },
                        { key: 'content.share', label: '分享' },
                    ]},
                    { heading: '分类管理', perms: [
                        { key: 'view.categories', label: '查看' },
                        { key: 'categories.manage', label: '管理' },
                    ]},
                    { heading: '图片管理', perms: [
                        { key: 'view.images', label: '查看' },
                        { key: 'images.upload', label: '上传' },
                        { key: 'images.delete', label: '删除' },
                        { key: 'images.scan', label: '扫描' },
                    ]},
                    { heading: '查重分析', perms: [
                        { key: 'view.dedup', label: '查看' },
                        { key: 'dedup.view', label: '查看配置' },
                        { key: 'dedup.config', label: '修改配置' },
                    ]},
                    { heading: '分享管理', perms: [
                        { key: 'view.shares', label: '查看' },
                        { key: 'shares.manage', label: '管理（含清空）' },
                    ]},
                    { heading: '数据网盘', perms: [
                        { key: 'view.drive', label: '查看' },
                        { key: 'drive.upload', label: '上传' },
                        { key: 'drive.delete', label: '删除' },
                        { key: 'drive.rename', label: '重命名' },
                        { key: 'drive.move', label: '移动/复制' },
                        { key: 'drive.folder', label: '新建文件夹' },
                        { key: 'drive.share', label: '分享' },
                        { key: 'drive.manage', label: '管理（含清空分享）' },
                    ]},
                ]
            },
            {
                label: '用户管理',
                subgroups: [
                    { heading: '用户管理', perms: [
                        { key: 'view.users', label: '查看' },
                        { key: 'users.manage', label: '管理' },
                    ]},
                    { heading: '访问控制', perms: [
                        { key: 'view.access', label: '查看' },
                        { key: 'access.manage', label: '管理' },
                    ]},
                ]
            },
            {
                label: '统计分析',
                subgroups: [
                    { heading: '在线用户', perms: [
                        { key: 'view.onlineUsers', label: '查看' },
                    ]},
                    { heading: '访问日志', perms: [
                        { key: 'view.activityLog', label: '查看' },
                        { key: 'activity.cleanup', label: '清理' },
                    ]},
                    { heading: '使用统计', perms: [
                        { key: 'view.usageStats', label: '查看' },
                        { key: 'stats.export', label: '导出' },
                    ]},
                ]
            },
            {
                label: '系统设置',
                subgroups: [
                    { heading: '服务器监控', perms: [
                        { key: 'view.serverMonitor', label: '查看' },
                    ]},
                    { heading: '操作审计', perms: [
                        { key: 'view.auditLog', label: '查看' },
                        { key: 'audit.manage', label: '管理' },
                    ]},
                    { heading: '外观设置', perms: [
                        { key: 'view.appearance', label: '查看' },
                        { key: 'appearance.manage', label: '管理' },
                    ]},
                    { heading: '备份恢复', perms: [
                        { key: 'view.backup', label: '查看' },
                        { key: 'backup.create', label: '创建' },
                        { key: 'backup.restore', label: '恢复' },
                        { key: 'backup.delete', label: '删除' },
                        { key: 'backup.clear', label: '清空' },
                    ]},
                    { heading: '系统信息', perms: [
                        { key: 'view.system', label: '查看' },
                    ]},
                ]
            },
            {
                label: 'AI 功能',
                subgroups: [
                    { heading: 'AI 使用', perms: [
                        { key: 'ai.use', label: '使用 AI 功能（对话/生图/生视频）' },
                    ]},
                ]
            },
            {
                label: '公告管理',
                subgroups: [
                    { heading: '公告管理', perms: [
                        { key: 'view.announcements', label: '查看' },
                        { key: 'announcements.manage', label: '管理（新增/编辑/删除）' },
                    ]},
                ]
            },
        ];

        // 渲染权限子分组 HTML
        function renderPermSubgroups(subgroups, userPerms) {
            return subgroups.map(sg => `
                <div class="perm-subgroup">
                    <div class="perm-subgroup-head">
                        <span class="perm-subgroup-title">${sg.heading}</span>
                        <button type="button" class="perm-subgroup-toggle" onclick="toggleSubgroupPerms(this)">全选</button>
                    </div>
                    <div class="perm-subgroup-items">
                        ${sg.perms.map(p => `
                            <label class="perm-checkbox">
                                <input type="checkbox" name="perm_${p.key}" value="${p.key}"
                                       ${userPerms.includes(p.key) ? 'checked' : ''}>
                                <span>${p.label}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        }

        const userPerms = user.permissions || [];
        // ['*'] 视为非自定义权限（拥有全部），按"跟随角色默认"处理，避免编辑后丢失通配权限
        const hasWildcard = Array.isArray(user.permissions) && user.permissions.includes('*');
        const useCustom = !hasWildcard && user.permissions !== null && user.permissions !== undefined;

        // 生成权限编辑器 HTML
        const permEditorHtml = `
            <div class="user-form-group">
                <label>权限配置</label>
                <div class="perm-mode-toggle">
                    <label class="perm-mode-radio">
                        <input type="radio" name="permMode" value="default" ${!useCustom ? 'checked' : ''}
                               onchange="togglePermMode(this.value)">
                        <span>跟随角色默认</span>
                    </label>
                    <label class="perm-mode-radio">
                        <input type="radio" name="permMode" value="custom" ${useCustom ? 'checked' : ''}
                               onchange="togglePermMode(this.value)">
                        <span>自定义权限</span>
                    </label>
                </div>
                <div id="customPermPanel" style="display:${useCustom ? 'block' : 'none'}">
                    ${permissionGroups.map(group => `
                        <div class="perm-group">
                            <div class="perm-group-title">${group.label}</div>
                            ${group.subgroups
                                ? renderPermSubgroups(group.subgroups, userPerms)
                                : `<div class="perm-group-items">
                                    ${group.perms.map(p => `
                                        <label class="perm-checkbox">
                                            <input type="checkbox" name="perm_${p.key}" value="${p.key}"
                                                   ${userPerms.includes(p.key) ? 'checked' : ''}>
                                            <span>${p.label}</span>
                                        </label>
                                    `).join('')}
                                </div>`
                            }
                        </div>
                    `).join('')}
                    <div class="perm-actions">
                        <button type="button" class="btn btn-default btn-sm" onclick="selectAllPerms()">全选</button>
                        <button type="button" class="btn btn-default btn-sm" onclick="deselectAllPerms()">全不选</button>
                    </div>
                </div>
            </div>
        `;

        const modalHtml = `
            <div class="user-form-group">
                <label>用户名</label>
                <input type="text" id="editUsername" class="form-input" value="${escapeHtml(user.username)}" autocomplete="off" required>
            </div>
            <div class="user-form-group">
                <label>新密码（留空则不修改）</label>
                <input type="password" id="editUserPassword" class="form-input" placeholder="请输入新密码（至少4位）..." autocomplete="new-password">
            </div>
            <div class="user-form-group">
                <label>角色</label>
                <select id="editUserRole" class="form-select">
                    ${buildRoleOptions(roles, user.role)}
                </select>
            </div>
            <div class="user-form-group">
                <label>状态</label>
                <select id="editUserStatus" class="form-select">
                    <option value="active" ${(user.status || 'active') === 'active' ? 'selected' : ''}>正常</option>
                    <option value="disabled" ${(user.status || 'active') === 'disabled' ? 'selected' : ''}>已禁用</option>
                    <option value="banned" ${(user.status || 'active') === 'banned' ? 'selected' : ''}>已封禁</option>
                </select>
            </div>
            <div class="user-form-group">
                <label>备注</label>
                <textarea id="editUserNotes" class="form-input" rows="2" placeholder="备注信息...">${escapeHtml(user.notes || '')}</textarea>
            </div>
            ${permEditorHtml}
        `;

        const ok = await showModal('编辑用户', modalHtml, async () => {
            const username = document.getElementById('editUsername').value.trim();
            const password = document.getElementById('editUserPassword').value;
            const role = document.getElementById('editUserRole').value;
            const status = document.getElementById('editUserStatus').value;
            const notes = document.getElementById('editUserNotes').value.trim();

            if (!username) {
                showToast('请输入用户名', 'error');
                return false;
            }
            if (password && (password.length < 6 || password.length > 72)) {
                showToast('密码长度需为 6-72 位', 'error');
                return false;
            }

            // 收集权限数据
            const permMode = document.querySelector('input[name="permMode"]:checked').value;
            let permissions = null;
            if (permMode === 'custom') {
                permissions = [];
                document.querySelectorAll('#customPermPanel input[type="checkbox"]:checked').forEach(cb => {
                    permissions.push(cb.value);
                });
            }

            try {
                const payload = { id: userId, username, role, permissions, status, notes };
                if (password) payload.password = password;

                const r = await adminApiFetch('updateUser', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const j = await r.json();
                if (j.success) {
                    showToast('用户更新成功', 'success');
                    renderUsers();
                    return true;
                } else {
                    showToast(j.error || '更新失败', 'error');
                    return false;
                }
            } catch (e) {
                showToast('更新失败', 'error');
                return false;
            }
        });
    } catch (e) {
        showToast('获取用户信息失败', 'error');
    }
}

// 权限模式切换
function togglePermMode(mode) {
    const panel = document.getElementById('customPermPanel');
    if (panel) {
        panel.style.display = mode === 'custom' ? 'block' : 'none';
    }
}

// 全选权限
function selectAllPerms() {
    document.querySelectorAll('#customPermPanel input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
    });
}

// 全不选权限
function deselectAllPerms() {
    document.querySelectorAll('#customPermPanel input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });
}

function toggleSubgroupPerms(btn) {
    const subgroup = btn.closest('.perm-subgroup');
    const checkboxes = subgroup.querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => { cb.checked = !allChecked; });
    btn.textContent = allChecked ? '全选' : '取消';
}

async function deleteUser(userId) {
    if (!hasPermission('users.manage')) { showToast('无管理用户权限', 'error'); return; }
    // 从已加载的用户列表中查找用户名，避免拼接 onclick 字符串时的引号注入风险
    const user = (AdminState.users || []).find(u => u.id === userId);
    const username = user ? user.username : userId;
    const ok = await showConfirm(`确定要删除用户"${username}"吗？此操作不可恢复。`, 'trash-2');
    if (!ok) return;

    try {
        const r = await adminApiFetch('deleteUser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: userId })
        });
        const j = await r.json();
        if (j.success) {
            showToast('用户已删除', 'success');
            renderUsers();
        } else {
            showToast(j.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

/* ========== 角色管理 ========== */

// 权限分组中文名称
const PERMISSION_GROUP_LABELS = {
    view: '查看权限',
    content: '内容管理',
    categories: '分类管理',
    images: '图片管理',
    dedup: '查重管理',
    backup: '备份管理',
    access: '访问控制',
    appearance: '外观设置',
    users: '用户管理',
    roles: '角色管理',
    activity: '活动日志',
    stats: '统计分析',
    shares: '分享管理',
    audit: '审计管理',
    drive: '网盘管理',
    ai: 'AI 功能',
    announcements: '公告管理',
};

// 权限点 → 中文标签映射
const PERMISSION_LABELS = {
    'view.dashboard': '查看仪表盘',
    'view.content': '查看文案',
    'view.dedup': '查看查重',
    'view.categories': '查看分类',
    'view.images': '查看图片',
    'view.backup': '查看备份',
    'view.access': '查看访问控制',
    'view.appearance': '查看外观设置',
    'view.system': '查看系统信息',
    'view.users': '查看用户',
    'view.roles': '查看角色',
    'view.onlineUsers': '查看在线用户',
    'view.activityLog': '查看访问日志',
    'view.usageStats': '查看使用统计',
    'view.shares': '查看分享',
    'view.serverMonitor': '查看服务器监控',
    'view.auditLog': '查看操作审计',
    'view.drive': '查看数据网盘',
    'view.announcements': '查看公告',
    'content.create': '新增文案',
    'content.edit': '编辑文案',
    'content.delete': '删除文案',
    'content.sort': '排序文案',
    'content.share': '分享文案',
    'categories.manage': '管理分类',
    'images.upload': '上传图片',
    'images.delete': '删除图片',
    'images.scan': '扫描图片',
    'dedup.view': '查看查重配置',
    'dedup.config': '修改查重配置',
    'backup.create': '创建备份',
    'backup.delete': '删除备份',
    'backup.restore': '恢复备份',
    'backup.clear': '清空备份',
    'access.manage': '管理访问控制',
    'appearance.manage': '管理外观设置',
    'users.manage': '管理用户',
    'roles.manage': '管理角色',
    'activity.cleanup': '清理日志',
    'stats.export': '导出统计',
    'shares.manage': '管理分享',
    'audit.manage': '管理审计',
    'drive.upload': '上传文件',
    'drive.delete': '删除文件',
    'drive.rename': '重命名',
    'drive.move': '移动/复制',
    'drive.folder': '新建文件夹',
    'drive.share': '分享文件',
    'drive.manage': '管理网盘',
    'ai.use': '使用 AI 功能',
    'announcements.manage': '管理公告',
};

function getPermLabel(perm) {
    return PERMISSION_LABELS[perm] || perm;
}

async function renderRoles(targetContainer) {
    const c = targetContainer || document.getElementById('userManageBody') || document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载角色列表...</div>';

    try {
        const r = await adminApiFetch('listRoles');
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        const j = await r.json();
        if (!j.success) {
            c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`;
            return;
        }

        const roles = j.roles || [];
        AdminState.roles = roles;
        const canManage = hasPermission('roles.manage');

        const roleRows = roles.map(role => {
            const isSystem = role.isSystem;
            return `
            <tr>
                <td><span class="role-name">${escapeHtml(role.name)}</span>${isSystem ? '<span class="system-role-badge">系统</span>' : ''}</td>
                <td class="role-desc">${escapeHtml(role.description || '-')}</td>
                <td><span class="perm-count-badge">${role.permissionCount || 0} 项权限</span></td>
                <td>${role.userCount || 0} 人</td>
                <td>${formatDate(role.updatedAt)}</td>
                <td class="role-actions">
                    <button class="btn btn-default btn-sm" onclick="viewRolePermissions('${escapeAttr(role.id)}')">查看权限</button>
                    ${canManage ? `<button class="btn btn-default btn-sm" onclick="editRole('${escapeAttr(role.id)}')">${isSystem ? '编辑权限' : '编辑'}</button>` : ''}
                    ${canManage && !isSystem ? `<button class="btn btn-default btn-sm" onclick="deleteRole('${escapeAttr(role.id)}')">删除</button>` : ''}
                </td>
            </tr>`;
        }).join('');

        const html = `
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="shield" style="width:16px;height:16px;"></i> 角色管理</div>
                <div style="display:flex;gap:8px;align-items:center">
                    ${canManage ? '<button class="btn btn-primary btn-sm" onclick="createRole()"><i data-feather="plus" style="width:14px;height:14px;"></i> 新建角色</button>' : ''}
                </div>
            </div>
            <div class="panel-body">
                <table class="user-table">
                    <thead>
                        <tr>
                            <th>角色名称</th>
                            <th>描述</th>
                            <th>权限数量</th>
                            <th>用户数</th>
                            <th>更新时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${roles.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--t3);">暂无角色</td></tr>' : roleRows}
                    </tbody>
                </table>
            </div>
        </div>`;
        c.innerHTML = html;
        refreshFeatherIcons();
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">网络错误</div></div>';
    }
}

async function viewRolePermissions(roleId) {
    if (!hasPermission('view.roles')) { showToast('无查看角色权限', 'error'); return; }
    const role = (AdminState.roles || []).find(r => r.id === roleId);
    if (!role) return;

    // 获取所有权限点并按组显示
    try {
        const r = await adminApiFetch('getAllPermissions');
        const j = await r.json();
        if (!j.success) return;

        const groups = j.groups || {};
        const rolePerms = role.permissions || [];
        const hasAll = rolePerms.includes('*');

        let groupsHtml = '';
        for (const [group, perms] of Object.entries(groups)) {
            const groupLabel = PERMISSION_GROUP_LABELS[group] || group;
            const permsHtml = perms.map(p => {
                const checked = hasAll || rolePerms.includes(p);
                return `<div class="perm-item ${checked ? 'checked' : ''}">
                    <i data-feather="${checked ? 'check-square' : 'square'}" style="width:14px;height:14px;"></i>
                    <span>${escapeHtml(getPermLabel(p))}</span>
                </div>`;
            }).join('');
            groupsHtml += `
            <div class="perm-group">
                <div class="perm-group-title">${escapeHtml(groupLabel)}</div>
                <div class="perm-list">${permsHtml}</div>
            </div>`;
        }

        openModal(`${role.name} - 权限详情`, `
            <div class="role-perm-detail">
                <div style="margin-bottom:16px;color:var(--t2);font-size:13px;">
                    ${escapeHtml(role.description || '')}
                </div>
                ${hasAll ? '<div class="all-perms-badge"><i data-feather="award" style="width:16px;height:16px;"></i> 拥有全部权限</div>' : ''}
                ${groupsHtml}
            </div>
        `, '<button class="btn btn-default" onclick="closeModal()">关闭</button>');
        refreshFeatherIcons();
    } catch (e) {
        showToast('加载失败', 'error');
    }
}

async function createRole() {
    if (!hasPermission('roles.manage')) { showToast('无角色管理权限', 'error'); return; }
    showRoleEditor(null);
}

async function editRole(roleId) {
    if (!hasPermission('roles.manage')) { showToast('无角色管理权限', 'error'); return; }
    const role = (AdminState.roles || []).find(r => r.id === roleId);
    if (!role) { showToast('角色不存在', 'error'); return; }
    showRoleEditor(role);
}

async function showRoleEditor(role) {
    const isEdit = !!role;
    const isSystem = role?.isSystem;

    try {
        // 获取所有权限点
        const r = await adminApiFetch('getAllPermissions');
        const j = await r.json();
        if (!j.success) { showToast(j.error || '加载权限失败', 'error'); return; }

        const groups = j.groups || {};
        const rolePerms = role?.permissions || [];

        let groupsHtml = '';
        for (const [group, perms] of Object.entries(groups)) {
            const groupLabel = PERMISSION_GROUP_LABELS[group] || group;
            const permsHtml = perms.map(p => {
                const checked = rolePerms.includes('*') || rolePerms.includes(p);
                return `<label class="perm-checkbox">
                    <input type="checkbox" value="${escapeAttr(p)}" ${checked ? 'checked' : ''} data-perm>
                    <span>${escapeHtml(getPermLabel(p))}</span>
                </label>`;
            }).join('');
            groupsHtml += `
            <div class="perm-group">
                <div class="perm-group-title">
                    <label class="perm-group-check">
                        <input type="checkbox" class="group-check-all" data-group="${escapeAttr(group)}">
                        <span>${escapeHtml(groupLabel)}</span>
                    </label>
                </div>
                <div class="perm-list">${permsHtml}</div>
            </div>`;
        }

        const bodyHtml = `
            <form id="roleForm">
                <div class="form-group">
                    <label class="form-label">角色名称</label>
                    <input type="text" id="roleName" class="form-input" value="${escapeHtml(role?.name || '')}" 
                           placeholder="请输入角色名称" required maxlength="50">
                </div>
                <div class="form-group">
                    <label class="form-label">角色描述</label>
                    <textarea id="roleDesc" class="form-textarea" placeholder="请输入角色描述" 
                              rows="2" maxlength="200">${escapeHtml(role?.description || '')}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">权限配置</label>
                    <div class="role-perms-editor">
                        ${isSystem ? '<div class="system-perm-hint">系统内置角色标识不可修改</div>' : ''}
                        <div class="all-perms-check">
                            <label class="perm-checkbox">
                                <input type="checkbox" id="allPermsCheck" ${rolePerms.includes('*') ? 'checked' : ''}>
                                <span><b>全部权限</b>（拥有所有操作权限）</span>
                            </label>
                        </div>
                        ${groupsHtml}
                    </div>
                </div>
            </form>
        `;

        openModal(isEdit ? '编辑角色' : '新建角色', bodyHtml,
            '<button class="btn btn-default" onclick="closeModal()">取消</button>' +
            `<button class="btn btn-primary" onclick="saveRole(${role ? `'${escapeAttr(role.id)}'` : 'null'})">${isEdit ? '保存' : '创建'}</button>`
        );
        refreshFeatherIcons();

        // 绑定全选事件
        const allPermsCheck = document.getElementById('allPermsCheck');
        if (allPermsCheck) {
            allPermsCheck.addEventListener('change', function() {
                const checked = this.checked;
                document.querySelectorAll('[data-perm]').forEach(cb => {
                    cb.checked = checked;
                    cb.disabled = checked;
                });
                document.querySelectorAll('.group-check-all').forEach(cb => {
                    cb.checked = checked;
                    cb.disabled = checked;
                });
            });
        }

        // 绑定分组全选事件
        document.querySelectorAll('.group-check-all').forEach(cb => {
            cb.addEventListener('change', function() {
                const group = this.dataset.group;
                const groupDiv = this.closest('.perm-group');
                const perms = groupDiv.querySelectorAll('[data-perm]');
                perms.forEach(p => { p.checked = this.checked; });
            });
        });

        // 初始化分组全选状态
        document.querySelectorAll('.perm-group').forEach(groupDiv => {
            const perms = groupDiv.querySelectorAll('[data-perm]');
            const checked = groupDiv.querySelectorAll('[data-perm]:checked');
            const groupCheck = groupDiv.querySelector('.group-check-all');
            if (groupCheck && perms.length > 0) {
                groupCheck.checked = checked.length === perms.length;
            }
        });

        // 初始状态：如果是全部权限，禁用单独选择
        if (allPermsCheck && allPermsCheck.checked) {
            document.querySelectorAll('[data-perm]').forEach(cb => { cb.disabled = true; });
            document.querySelectorAll('.group-check-all').forEach(cb => { cb.disabled = true; });
        }

    } catch (e) {
        console.error(e);
        showToast('加载失败', 'error');
    }
}

async function saveRole(roleId) {
    if (!hasPermission('roles.manage')) { showToast('无角色管理权限', 'error'); return; }
    const role = roleId ? (AdminState.roles || []).find(r => r.id === roleId) : null;
    const isEdit = !!role;
    const name = document.getElementById('roleName')?.value.trim();
    const description = document.getElementById('roleDesc')?.value.trim();
    const allPermsCheck = document.getElementById('allPermsCheck');
    const hasAllPerms = allPermsCheck?.checked;

    if (!name) { showToast('请输入角色名称', 'error'); return; }

    let permissions = [];
    if (hasAllPerms) {
        permissions = ['*'];
    } else {
        const permCheckboxes = document.querySelectorAll('[data-perm]:checked');
        permissions = Array.from(permCheckboxes).map(cb => cb.value);
    }

    try {
        const action = isEdit ? 'updateRole' : 'createRole';
        const body = isEdit
            ? { id: role.id, name, description, permissions }
            : { name, description, permissions };

        const r = await adminApiFetch(action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const j = await r.json();
        if (j.success) {
            showToast(isEdit ? '角色已更新' : '角色已创建', 'success');
            closeModal();
            renderRoles();
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        showToast('保存失败', 'error');
    }
}

async function deleteRole(roleId) {
    if (!hasPermission('roles.manage')) { showToast('无角色管理权限', 'error'); return; }
    const role = (AdminState.roles || []).find(r => r.id === roleId);
    if (!role) return;
    if (role.isSystem) { showToast('系统内置角色不能删除', 'error'); return; }

    const ok = await showConfirm(`确定要删除角色"${role.name}"吗？此操作不可恢复。`, 'trash-2');
    if (!ok) return;

    try {
        const r = await adminApiFetch('deleteRole', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: roleId })
        });
        const j = await r.json();
        if (j.success) {
            showToast('角色已删除', 'success');
            renderRoles();
        } else {
            if (j.usingUsers && j.usingUsers.length > 0) {
                showToast(`${j.error}（${j.usingUsers.join('、')}）`, 'error');
            } else {
                showToast(j.error || '删除失败', 'error');
            }
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

/* ========== 在线用户 ========== */
async function renderOnlineUsers(targetContainer) {
    const c = targetContainer || document.getElementById('statsAnalysisBody') || document.getElementById('adminContent');
    const canManage = hasPermission('users.manage');

    // 构建完整布局（在线列表 + 热力图）
    c.innerHTML = `
    <div class="stats-toolbar">
        <div class="stats-toolbar-title">在线用户监控</div>
        <div class="stats-toolbar-actions">
            <button class="btn btn-default btn-sm" onclick="refreshOnlineTable()"><i data-feather="refresh-cw" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>刷新列表</button>
            <button class="btn btn-default btn-sm" onclick="renderPageHeatmap()"><i data-feather="grid" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>刷新热力图</button>
            ${canManage ? `<button class="btn btn-default btn-sm" onclick="clearPageViews()"><i data-feather="trash-2" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>清空访问统计</button>` : ''}
        </div>
    </div>
    <div class="panel" style="margin-bottom:20px">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="wifi" style="width:16px;height:16px;"></i> 在线用户 <span class="online-badge" id="onlineCountBadge">0</span></div>
        </div>
        <div class="panel-body">
            <table class="user-table">
                <thead><tr><th>用户名</th><th>角色</th><th>登录时间</th><th>最后活动</th><th>IP</th><th>当前页面</th><th>操作</th></tr></thead>
                <tbody id="onlineTableBody"><tr><td colspan="7" style="text-align:center;padding:20px;color:var(--t3)"><div class="spinner"></div>加载中...</td></tr></tbody>
            </table>
        </div>
    </div>
    <div class="panel">
        <div class="panel-head"><div class="panel-title"><i data-feather="grid" style="width:16px;height:16px;"></i> 页面访问热力图（近7天）</div></div>
        <div class="panel-body" id="heatmapBody"><div style="text-align:center;padding:20px;color:var(--t3)"><div class="spinner"></div>加载热力图...</div></div>
    </div>`;
    refreshFeatherIcons();

    // 重置上次会话快照
    AdminState._prevOnlineSessions = {};

    // 加载表格与热力图
    await refreshOnlineTable();
    renderPageHeatmap();

    // 设置自动刷新定时器（5秒）
    if (AdminState._onlineViewTimer) clearInterval(AdminState._onlineViewTimer);
    if (AdminState.currentView === 'onlineUsers') {
        AdminState._onlineViewTimer = setInterval(refreshOnlineTable, 5000);
    }
}

// 轻量刷新：仅更新在线用户表格（不重建布局、不重取热力图）
async function refreshOnlineTable() {
    if (AdminState.currentView !== 'onlineUsers') return;
    const tbody = document.getElementById('onlineTableBody');
    if (!tbody) return;
    try {
        const [r, roles] = await Promise.all([
            adminApiFetch('getOnlineUsers'),
            getRolesList()
        ]);
        if (r.status === 401) { showToast('会话已过期', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (AdminState.currentView !== 'onlineUsers') return;
        if (!j.success) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--t3)">${escapeHtml(j.error || '加载失败')}</td></tr>`; return; }

        const sessions = j.sessions || [];
        const canManage = hasPermission('users.manage');
        const viewNames = {
            dashboard: '仪表盘', content: '文案管理', dedup: '查重分析', categories: '分类管理',
            images: '图片管理', backup: '备份恢复', access: '访问控制', appearance: '外观设置',
            system: '系统信息', users: '用户管理', onlineUsers: '在线用户', activityLog: '访问日志',
            usageStats: '使用统计', shares: '分享管理',
            serverMonitor: '服务器监控', auditLog: '审计日志',
        };

        const currentIds = new Set(sessions.map(s => s.sessionId));
        const prevSessions = AdminState._prevOnlineSessions || {};

        // 当前在线行（新出现的会话加 row-entering 动画）
        const rows = sessions.map(s => {
            const isNew = !prevSessions[s.sessionId];
            const roleDisplay = getRoleName(s.role, roles);
            return `<tr data-session-id="${escapeAttr(s.sessionId)}" class="${isNew ? 'row-entering' : ''}">
                <td><span class="online-indicator"></span> ${escapeHtml(s.username)}</td>
                <td><span class="user-role-badge">${escapeHtml(roleDisplay)}</span></td>
                <td>${formatDate(s.loginAt)}</td>
                <td>${formatDate(s.lastHeartbeat)}</td>
                <td>${escapeHtml(s.ip)}</td>
                <td><span class="page-badge">${escapeHtml(viewNames[s.currentPage] || s.currentPage || '-')}</span></td>
                <td>${canManage && s.userId !== AdminState.currentUser?.id ? `<button class="btn btn-default btn-sm" onclick="forceLogoutUser('${escapeAttr(s.sessionId)}')">强制下线</button>` : ''}</td>
            </tr>`;
        }).join('');

        // 离开行（上次有、本次无）—— 带淡出动画
        const leavingRows = Object.keys(prevSessions)
            .filter(sid => !currentIds.has(sid))
            .map(sid => {
                const s = prevSessions[sid];
                const roleDisplay = getRoleName(s.role, roles);
                return `<tr class="leaving-row">
                    <td><span class="offline-indicator"></span> ${escapeHtml(s.username || '')}</td>
                    <td><span class="user-role-badge">${escapeHtml(roleDisplay || '')}</span></td>
                    <td>${formatDate(s.loginAt)}</td>
                    <td>已离开</td>
                    <td>${escapeHtml(s.ip || '')}</td>
                    <td><span class="page-badge" style="background:rgba(239,68,68,0.15);color:#ef4444">已下线</span></td>
                    <td></td>
                </tr>`;
            }).join('');

        tbody.innerHTML = (sessions.length === 0 && !leavingRows)
            ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--t3)">当前无在线用户</td></tr>'
            : rows + leavingRows;

        // 更新计数徽标
        const badge = document.getElementById('onlineCountBadge');
        if (badge) badge.textContent = sessions.length;

        // 更新会话快照
        const newPrev = {};
        sessions.forEach(s => { newPrev[s.sessionId] = s; });
        AdminState._prevOnlineSessions = newPrev;
    } catch (e) {
        console.error(e);
    }
}

// 渲染页面访问热力图
async function renderPageHeatmap() {
    const body = document.getElementById('heatmapBody');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)"><div class="spinner"></div>加载热力图...</div>';
    try {
        const r = await adminApiFetch('getPageViewsStats?days=7');
        if (r.status === 401) return;
        const j = await r.json();
        if (!j.success) { body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--t3)">${escapeHtml(j.error || '加载失败')}</div>`; return; }

        const dates = j.dates || [];
        const rows = j.rows || [];
        const maxVal = Math.max(1, j.maxVal || 0);

        if (rows.length === 0 || (j.maxVal || 0) === 0) {
            body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">暂无访问数据</div>';
            return;
        }

        const headerCells = dates.map(d => `<th>${d.slice(5)}</th>`).join('');
        const heatRows = rows.map(row => {
            const cells = row.days.map(d => {
                const intensity = d.count / maxVal;
                const opacity = d.count > 0 ? Math.max(0.15, intensity) : 0.04;
                const title = `${row.label} ${d.date}: ${d.count} 次`;
                return `<td class="heatmap-cell" style="background-color:rgba(99,102,241,${opacity.toFixed(2)})" title="${escapeAttr(title)}">${d.count > 0 ? d.count : ''}</td>`;
            }).join('');
            return `<tr><td class="heatmap-row-label">${escapeHtml(row.label)}</td>${cells}<td class="heatmap-total">${row.total}</td></tr>`;
        }).join('');

        body.innerHTML = `
        <div class="heatmap-wrap">
            <table class="heatmap-table">
                <thead><tr><th>页面</th>${headerCells}<th>合计</th></tr></thead>
                <tbody>${heatRows}</tbody>
            </table>
            <div class="heatmap-legend">
                <span class="heatmap-legend-label">少</span>
                <span class="heatmap-legend-cell" style="background:rgba(99,102,241,0.15)"></span>
                <span class="heatmap-legend-cell" style="background:rgba(99,102,241,0.35)"></span>
                <span class="heatmap-legend-cell" style="background:rgba(99,102,241,0.6)"></span>
                <span class="heatmap-legend-cell" style="background:rgba(99,102,241,0.85)"></span>
                <span class="heatmap-legend-cell" style="background:rgba(99,102,241,1)"></span>
                <span class="heatmap-legend-label">多</span>
            </div>
        </div>`;
    } catch (e) {
        console.error(e);
        body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">网络错误</div>';
    }
}

// 清空页面访问统计
async function clearPageViews() {
    if (!hasPermission('users.manage')) { showToast('无管理权限', 'error'); return; }
    const ok = await showConfirm('确定要清空所有页面访问统计数据吗？此操作不可恢复。', 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('clearPageViews', { method: 'POST' });
        const j = await r.json();
        if (j.success) {
            showToast('已清空页面访问统计', 'success');
            renderPageHeatmap();
        } else {
            showToast(j.error || '操作失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

async function forceLogoutUser(sessionId) {
    if (!hasPermission('users.manage')) { showToast('无管理用户权限', 'error'); return; }
    const ok = await showConfirm(`确定要强制下线该用户吗？`, 'alert-triangle');
    if (!ok) return;
    try {
        const r = await adminApiFetch('forceLogout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        const j = await r.json();
        if (j.success) { showToast(`已强制下线`, 'success'); refreshOnlineTable(); }
        else { showToast(j.error || '操作失败', 'error'); }
    } catch (e) { showToast('操作失败', 'error'); }
}

/* ========== 访问日志 ========== */
const ACTION_LABELS = {
    'login': '登录', 'login.fail': '登录失败', 'logout': '登出',
    'content.create': '创建文案', 'content.edit': '编辑文案', 'content.delete': '删除文案',
    'content.bulkDelete': '批量删除文案', 'content.batchTag': '批量标签操作',
    'categories.manage': '管理分类', 'images.upload': '上传图片', 'images.delete': '删除图片',
    'images.bulkDelete': '批量删除图片',
    'user.create': '创建用户', 'user.update': '更新用户', 'user.delete': '删除用户',
    'user.forceLogout': '强制下线', 'user.statusChange': '状态变更', 'user.passwordReset': '密码重置',
    'backup.create': '创建备份', 'backup.delete': '删除备份', 'backup.restore': '恢复备份', 'backup.clear': '清空数据', 'activity.cleanup': '清理日志', 'system.config': '系统配置',
    'data.clear': '清空数据',
};

function getActionBadgeClass(action) {
    if (action.startsWith('login') || action === 'logout') return 'action-auth';
    if (action.startsWith('content.') || action.startsWith('images.')) return 'action-content';
    if (action.startsWith('user.') || action.startsWith('categories.')) return 'action-user';
    if (action.includes('delete') || action.includes('clear')) return 'action-danger';
    return 'action-default';
}

async function renderActivityLog(targetContainer) {
    const c = targetContainer || document.getElementById('statsAnalysisBody') || document.getElementById('adminContent');
    const f = AdminState.activityFilter;

    // 构建查询参数（注意：筛选字段命名为 actionType，避免与 API 分派参数 action 冲突）
    const params = new URLSearchParams({
        page: AdminState.activityPage, pageSize: AdminState.activityPageSize,
        userId: f.user, actionType: f.action, success: f.success,
        dateFrom: f.dateFrom, dateTo: f.dateTo
    });

    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载访问日志...</div>';
    try {
        const r = await adminApiFetch('getActivityLog?' + params.toString());
        if (r.status === 401) { showToast('会话已过期', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { c.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`; return; }

        AdminState.activityLogs = j.logs || [];
        AdminState.activityTotal = j.total || 0;
        AdminState.activityActionTypes = j.actionTypes || [];
        AdminState.activityPage = j.page || 1;
        // 优先使用服务端返回的完整用户列表，跨页也能筛到
        AdminState.activityUserOptions = j.userOptions || [];

        const totalPages = Math.ceil(AdminState.activityTotal / AdminState.activityPageSize);

        // 筛选栏：用户下拉使用服务端返回的完整用户列表，避免只能筛当前页出现过的用户
        const userOptions = AdminState.activityUserOptions.map(uo => {
            return `<option value="${escapeAttr(uo.id)}" ${f.user === uo.id ? 'selected' : ''}>${escapeHtml(uo.username || uo.id)}</option>`;
        }).join('');

        const actionOptions = AdminState.activityActionTypes.map(a => `<option value="${escapeAttr(a)}" ${f.action === a ? 'selected' : ''}>${escapeHtml(ACTION_LABELS[a] || a)}</option>`).join('');

        const rows = AdminState.activityLogs.map(l => {
            const label = ACTION_LABELS[l.action] || l.action;
            const badgeClass = getActionBadgeClass(l.action);
            return `<tr>
                <td>${formatDate(l.timestamp)}</td>
                <td>${escapeHtml(l.username || '-')}</td>
                <td><span class="activity-action-badge ${badgeClass}">${escapeHtml(label)}</span></td>
                <td>${escapeHtml(l.detail || '-')}</td>
                <td>${escapeHtml(l.ip || '-')}</td>
                <td>${escapeHtml(l.userAgent || '-')}</td>
                <td><span class="activity-result-badge ${l.success ? 'result-success' : 'result-fail'}">${l.success ? '成功' : '失败'}</span></td>
            </tr>`;
        }).join('');

        c.innerHTML = `
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="activity" style="width:16px;height:16px;"></i> 访问日志</div>
                ${hasPermission('activity.cleanup') ? '<button class="btn btn-default btn-sm" onclick="cleanupActivityLog()"><i data-feather="trash-2" style="width:14px;height:14px;"></i> 清理日志</button>' : ''}
            </div>
            <div class="activity-filter-bar">
                <select class="form-select" style="width:130px" onchange="AdminState.activityFilter.user=this.value;AdminState.activityPage=1;renderActivityLog()">
                    <option value="">全部用户</option>${userOptions}
                </select>
                <select class="form-select" style="width:130px" onchange="AdminState.activityFilter.action=this.value;AdminState.activityPage=1;renderActivityLog()">
                    <option value="">全部操作</option>${actionOptions}
                </select>
                <select class="form-select" style="width:100px" onchange="AdminState.activityFilter.success=this.value;AdminState.activityPage=1;renderActivityLog()">
                    <option value="">全部结果</option>
                    <option value="true" ${f.success === 'true' ? 'selected' : ''}>成功</option>
                    <option value="false" ${f.success === 'false' ? 'selected' : ''}>失败</option>
                </select>
                <input type="date" class="form-input" style="width:140px" value="${f.dateFrom}" onchange="AdminState.activityFilter.dateFrom=this.value;AdminState.activityPage=1;renderActivityLog()" placeholder="开始日期">
                <input type="date" class="form-input" style="width:140px" value="${f.dateTo}" onchange="AdminState.activityFilter.dateTo=this.value;AdminState.activityPage=1;renderActivityLog()" placeholder="结束日期">
                <button class="btn btn-default btn-sm" onclick="AdminState.activityFilter={user:'',action:'',success:'',dateFrom:'',dateTo:''};AdminState.activityPage=1;renderActivityLog()">重置</button>
            </div>
            <div class="panel-body">
                <table class="user-table activity-table">
                    <thead><tr><th>时间</th><th>用户</th><th>操作</th><th>详情</th><th>IP</th><th>设备</th><th>结果</th></tr></thead>
                    <tbody>${rows.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--t3);">暂无日志记录</td></tr>' : rows}</tbody>
                </table>
                ${totalPages > 1 ? `<div class="pagination-bar">
                    <span class="pagination-info">第 ${(AdminState.activityPage-1)*AdminState.activityPageSize+1}-${Math.min(AdminState.activityPage*AdminState.activityPageSize, AdminState.activityTotal)} 条，共 ${AdminState.activityTotal} 条</span>
                    <button class="btn btn-default btn-sm" ${AdminState.activityPage<=1?'disabled':''} onclick="AdminState.activityPage--;renderActivityLog()">上一页</button>
                    <button class="btn btn-default btn-sm" ${AdminState.activityPage>=totalPages?'disabled':''} onclick="AdminState.activityPage++;renderActivityLog()">下一页</button>
                </div>` : ''}
            </div>
        </div>`;
        refreshFeatherIcons();
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
    }
}

async function cleanupActivityLog() {
    if (!hasPermission('activity.cleanup')) { showToast('无清理日志权限', 'error'); return; }
    const ok = await showConfirm('确定要清理90天前的日志记录吗？', 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('cleanupActivity', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ retentionDays: 90 })
        });
        const j = await r.json();
        if (j.success) { showToast(`已清理 ${j.removed} 条日志`, 'success'); renderActivityLog(); }
        else { showToast(j.error || '清理失败', 'error'); }
    } catch (e) { showToast('清理失败', 'error'); }
}


/* ========== 操作审计日志 ========== */
async function renderAuditLog(targetContainer) {
    const c = targetContainer || document.getElementById('systemMonitorBody') || document.getElementById('adminContent');
    const f = AdminState.auditFilter;

    const params = new URLSearchParams({
        page: AdminState.auditPage,
        pageSize: AdminState.auditPageSize,
        auditAction: f.action,
        userId: f.user,
        success: f.success,
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
        keyword: f.keyword,
    });

    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>加载审计日志...</div>';
    try {
        const r = await adminApiFetch('listAuditLog?' + params.toString());
        if (r.status === 401) { showToast('会话已过期', 'error'); setTimeout(() => location.reload(), 1500); return; }
        if (r.status === 403) {
            c.innerHTML = '<div class="empty-state"><div class="empty-text">无权限查看审计日志</div></div>';
            return;
        }
        const j = await r.json();
        if (!j.success) {
            c.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`;
            return;
        }

        AdminState.auditActionTypes = j.actionTypes || {};
        AdminState.auditUserOptions = j.userOptions || [];
        AdminState.auditTotal = j.total || 0;
        AdminState.auditPage = j.page || 1;
        AdminState.auditStats = j.stats || null;
        AdminState.auditSettings = j.settings || null;

        const logs = j.logs || [];
        const totalPages = Math.max(1, Math.ceil(AdminState.auditTotal / AdminState.auditPageSize));
        const stats = AdminState.auditStats || {};
        const byType = stats.byType || {};

        const userOptions = AdminState.auditUserOptions.map(uo => {
            return `<option value="${escapeAttr(uo.id)}" ${f.user === uo.id ? 'selected' : ''}>${escapeHtml(uo.username || uo.id)}</option>`;
        }).join('');

        const actionOptions = Object.keys(AdminState.auditActionTypes).map(a => {
            return `<option value="${escapeAttr(a)}" ${f.action === a ? 'selected' : ''}>${escapeHtml(AdminState.auditActionTypes[a] || a)}</option>`;
        }).join('');

        const rows = logs.map(l => {
            const label = l.actionLabel || AdminState.auditActionTypes[l.action] || l.action;
            const successBadge = l.success
                ? '<span class="audit-result-badge result-success">成功</span>'
                : '<span class="audit-result-badge result-fail">失败</span>';
            // 详情摘要：如果 detail 被截断
            let detailStr = '';
            if (l.detail && typeof l.detail === 'object') {
                if (l.detail._truncated) {
                    detailStr = '<span class="audit-detail-truncated" title="详情过长已截断">已截断</span>';
                } else if (Object.keys(l.detail).length > 0) {
                    detailStr = escapeHtml(JSON.stringify(l.detail).substring(0, 100));
                    if (detailStr.length >= 100) detailStr += '...';
                }
            }
            return `<tr>
                <td class="audit-time-cell">${formatDate(l.timestamp)}</td>
                <td><span class="audit-action-badge">${escapeHtml(label)}</span></td>
                <td class="audit-target-cell">${escapeHtml(l.target || '-')}</td>
                <td>${escapeHtml(l.username || '-')}</td>
                <td>${escapeHtml(l.ip || '-')}</td>
                <td>${successBadge}</td>
                <td class="audit-detail-cell">${detailStr}</td>
                <td class="actions-cell">
                    <button class="btn btn-ghost btn-sm" onclick="viewAuditDetail('${escapeAttr(l.id)}')" title="查看详情"><i data-feather="eye" style="width:14px;height:14px;"></i></button>
                </td>
            </tr>`;
        }).join('');

        // 统计卡片
        const statsBlock = stats.total !== undefined ? `
        <div class="audit-stats-bar">
            <div class="audit-stat-item">
                <div class="audit-stat-num">${stats.total || 0}</div>
                <div class="audit-stat-label">总记录</div>
            </div>
            <div class="audit-stat-item">
                <div class="audit-stat-num">${stats.today || 0}</div>
                <div class="audit-stat-label">今日</div>
            </div>
            <div class="audit-stat-item">
                <div class="audit-stat-num">${stats.week || 0}</div>
                <div class="audit-stat-label">近 7 天</div>
            </div>
            <div class="audit-stat-item audit-stat-top">
                <div class="audit-stat-top-title">操作类型 Top 5</div>
                <div class="audit-stat-top-list">
                    ${Object.entries(byType).slice(0, 5).map(([k, v]) => {
                        return `<div class="audit-stat-top-row">
                            <span>${escapeHtml(AdminState.auditActionTypes[k] || k)}</span>
                            <strong>${v}</strong>
                        </div>`;
                    }).join('') || '<div class="audit-stat-empty">暂无数据</div>'}
                </div>
            </div>
        </div>` : '';

        c.innerHTML = `
        <div class="panel">
            <div class="panel-head">
                <div class="panel-title"><i data-feather="shield" style="width:16px;height:16px;"></i> 操作审计日志</div>
                <div class="audit-toolbar-actions">
                    ${hasPermission('audit.manage') ? `<button class="btn btn-default btn-sm" onclick="exportAuditLog('json')"><i data-feather="download" style="width:14px;height:14px;"></i> 导出 JSON</button>
                    <button class="btn btn-default btn-sm" onclick="exportAuditLog('csv')"><i data-feather="file-text" style="width:14px;height:14px;"></i> 导出 CSV</button>` : ''}
                    ${hasPermission('audit.manage') ? '<button class="btn btn-danger btn-sm" onclick="clearAuditLog()"><i data-feather="trash-2" style="width:14px;height:14px;"></i> 清空</button>' : ''}
                    ${hasPermission('audit.manage') ? '<button class="btn btn-default btn-sm" onclick="openAuditSettings()"><i data-feather="settings" style="width:14px;height:14px;"></i> 设置</button>' : ''}
                </div>
            </div>
            ${statsBlock}
            <div class="audit-filter-bar">
                <select class="form-select" style="width:140px" onchange="AdminState.auditFilter.action=this.value;AdminState.auditPage=1;renderAuditLog()">
                    <option value="">全部操作</option>${actionOptions}
                </select>
                <select class="form-select" style="width:130px" onchange="AdminState.auditFilter.user=this.value;AdminState.auditPage=1;renderAuditLog()">
                    <option value="">全部用户</option>${userOptions}
                </select>
                <select class="form-select" style="width:100px" onchange="AdminState.auditFilter.success=this.value;AdminState.auditPage=1;renderAuditLog()">
                    <option value="">全部结果</option>
                    <option value="true" ${f.success === 'true' ? 'selected' : ''}>成功</option>
                    <option value="false" ${f.success === 'false' ? 'selected' : ''}>失败</option>
                </select>
                <input type="date" class="form-input" style="width:140px" value="${f.dateFrom}" onchange="AdminState.auditFilter.dateFrom=this.value;AdminState.auditPage=1;renderAuditLog()" placeholder="开始日期">
                <input type="date" class="form-input" style="width:140px" value="${f.dateTo}" onchange="AdminState.auditFilter.dateTo=this.value;AdminState.auditPage=1;renderAuditLog()" placeholder="结束日期">
                <input type="text" class="form-input" style="width:180px" value="${escapeAttr(f.keyword)}" placeholder="搜索对象/用户/操作..." onchange="AdminState.auditFilter.keyword=this.value;AdminState.auditPage=1;renderAuditLog()">
                <button class="btn btn-default btn-sm" onclick="AdminState.auditFilter={action:'',user:'',success:'',dateFrom:'',dateTo:'',keyword:''};AdminState.auditPage=1;renderAuditLog()">重置</button>
            </div>
            <div class="panel-body">
                <table class="audit-table">
                    <thead><tr>
                        <th style="width:140px">时间</th>
                        <th style="width:120px">操作</th>
                        <th>操作对象</th>
                        <th style="width:110px">用户</th>
                        <th style="width:120px">IP</th>
                        <th style="width:70px">结果</th>
                        <th>详情摘要</th>
                        <th style="width:70px">操作</th>
                    </tr></thead>
                    <tbody>${rows.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--t3);">暂无审计记录</td></tr>' : rows}</tbody>
                </table>
                ${totalPages > 1 ? `<div class="pagination-bar">
                    <span class="pagination-info">第 ${(AdminState.auditPage-1)*AdminState.auditPageSize+1}-${Math.min(AdminState.auditPage*AdminState.auditPageSize, AdminState.auditTotal)} 条，共 ${AdminState.auditTotal} 条</span>
                    <button class="btn btn-default btn-sm" ${AdminState.auditPage<=1?'disabled':''} onclick="AdminState.auditPage--;renderAuditLog()">上一页</button>
                    <span class="pagination-page">第 ${AdminState.auditPage} / ${totalPages} 页</span>
                    <button class="btn btn-default btn-sm" ${AdminState.auditPage>=totalPages?'disabled':''} onclick="AdminState.auditPage++;renderAuditLog()">下一页</button>
                </div>` : ''}
            </div>
        </div>`;
        refreshFeatherIcons();
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
    }
}

async function viewAuditDetail(id) {
    if (!id) return;
    try {
        const r = await adminApiFetch('getAuditDetail?id=' + encodeURIComponent(id));
        if (r.status === 401) { showToast('会话已过期', 'error'); setTimeout(() => location.reload(), 1500); return; }
        const j = await r.json();
        if (!j.success) { showToast(j.error || '加载失败', 'error'); return; }
        const log = j.log || {};
        const detailJson = log.detail ? JSON.stringify(log.detail, null, 2) : '{}';
        const bodyHtml = `
            <div class="audit-detail-modal">
                <div class="audit-detail-row"><span class="audit-detail-label">时间</span><span class="audit-detail-value">${escapeHtml(formatDate(log.timestamp))}</span></div>
                <div class="audit-detail-row"><span class="audit-detail-label">操作类型</span><span class="audit-detail-value">${escapeHtml(log.action || '')}</span></div>
                <div class="audit-detail-row"><span class="audit-detail-label">操作标签</span><span class="audit-detail-value">${escapeHtml(log.actionLabel || '')}</span></div>
                <div class="audit-detail-row"><span class="audit-detail-label">操作对象</span><span class="audit-detail-value">${escapeHtml(log.target || '-')}</span></div>
                <div class="audit-detail-row"><span class="audit-detail-label">用户</span><span class="audit-detail-value">${escapeHtml(log.username || '-')} <span class="audit-detail-sub">(${escapeHtml(log.role || '')})</span></span></div>
                <div class="audit-detail-row"><span class="audit-detail-label">IP</span><span class="audit-detail-value">${escapeHtml(log.ip || '-')}</span></div>
                <div class="audit-detail-row"><span class="audit-detail-label">设备</span><span class="audit-detail-value">${escapeHtml(log.userAgent || '-')}</span></div>
                <div class="audit-detail-row"><span class="audit-detail-label">结果</span><span class="audit-detail-value">${log.success ? '<span class="audit-result-badge result-success">成功</span>' : '<span class="audit-result-badge result-fail">失败</span>'}</span></div>
                <div class="audit-detail-row audit-detail-json-row">
                    <span class="audit-detail-label">详细信息</span>
                    <pre class="audit-detail-json">${escapeHtml(detailJson)}</pre>
                </div>
            </div>`;
        const footHtml = `<button class="btn btn-default" onclick="closeModal()">关闭</button>`;
        openModal('审计详情 - ' + (log.id || '').substring(0, 16), bodyHtml, footHtml);
    } catch (e) {
        console.error(e);
        showToast('网络错误', 'error');
    }
}

function exportAuditLog(format) {
    if (!hasPermission('view.auditLog')) { showToast('无导出审计日志权限', 'error'); return; }
    const f = AdminState.auditFilter;
    const params = new URLSearchParams({
        format: format,
        auditAction: f.action,
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
    });
    const url = 'api.php?action=exportAuditLog&' + params.toString();
    // 通过隐藏 iframe 下载，避免触发页面跳转
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => { iframe.remove(); }, 60000);
    showToast('已开始下载审计日志', 'success');
}

async function clearAuditLog() {
    if (!hasPermission('audit.manage')) { showToast('无管理审计权限', 'error'); return; }
    if (!confirm('确定要清空所有审计日志吗？此操作不可恢复，但会保留本次清空操作的记录。')) return;
    if (!confirm('再次确认：清空所有审计日志？')) return;
    try {
        const r = await adminApiFetch('clearAuditLog', { method: 'POST' });
        const j = await r.json();
        if (j.success) {
            showToast('已清空 ' + (j.removed || 0) + ' 条审计日志', 'success');
            renderAuditLog();
        } else {
            showToast(j.error || '操作失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}

function openAuditSettings() {
    if (!hasPermission('audit.manage')) { showToast('无管理审计权限', 'error'); return; }
    const s = AdminState.auditSettings || { maxLogs: 5000, retentionDays: 180 };
    const bodyHtml = `
        <div class="audit-settings-form">
            <div class="form-group">
                <label class="form-label">最大日志条数</label>
                <input type="number" id="auditMaxLogs" class="form-input" value="${s.maxLogs || 5000}" min="100" max="100000" step="100">
                <div class="form-hint">范围：100 - 100000，超过会自动裁剪旧记录</div>
            </div>
            <div class="form-group">
                <label class="form-label">保留天数</label>
                <input type="number" id="auditRetentionDays" class="form-input" value="${s.retentionDays || 180}" min="7" max="3650" step="1">
                <div class="form-hint">范围：7 - 3650 天，超过保留期的记录将自动清理</div>
            </div>
        </div>`;
    const footHtml = `<button class="btn btn-default" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveAuditSettings()">保存</button>`;
    openModal('审计日志设置', bodyHtml, footHtml);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
}

async function saveAuditSettings() {
    if (!hasPermission('audit.manage')) { showToast('无管理审计权限', 'error'); return; }
    const maxLogs = parseInt(document.getElementById('auditMaxLogs').value, 10);
    const retentionDays = parseInt(document.getElementById('auditRetentionDays').value, 10);
    if (isNaN(maxLogs) || maxLogs < 100 || maxLogs > 100000) { showToast('最大日志条数应在 100-100000 之间', 'error'); return; }
    if (isNaN(retentionDays) || retentionDays < 7 || retentionDays > 3650) { showToast('保留天数应在 7-3650 之间', 'error'); return; }
    try {
        const r = await adminApiFetch('updateAuditSettings', {
            method: 'POST',
            body: JSON.stringify({ maxLogs, retentionDays }),
        });
        const j = await r.json();
        if (j.success) {
            AdminState.auditSettings = j.settings;
            showToast('审计日志设置已保存', 'success');
            closeModal();
            renderAuditLog();
        } else {
            showToast(j.error || '保存失败', 'error');
        }
    } catch (e) {
        showToast('网络错误', 'error');
    }
}


