/* Cpydes 管理后台 —— 由 admin.js 机械拆分（admin-images.js），依赖 admin-core.js 先加载 */
'use strict';

/* ========== 图片管理 ========== */
let _imageScanCache = null;

async function renderImages() {
    const c = document.getElementById('adminContent');
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div>扫描图片目录...</div>';

    // 调用后台专用接口扫描 img/ 目录
    let scan;
    try {
        const r = await adminApiFetch('scanImages');
        if (r.status === 401) {
            showToast('会话已过期，请重新登录', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        scan = await r.json();
        if (!scan.success) {
            c.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">${escapeHtml(scan.error || '加载失败')}</div></div>`;
            return;
        }
    } catch (e) {
        console.error(e);
        c.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-feather="alert-triangle" style="width:48px;height:48px;"></i></div><div class="empty-text">网络错误</div></div>';
        return;
    }

    _imageScanCache = scan;
    AdminState.imageList = scan.images;
    AdminState.imageSelected.clear();
    renderImageView();
}

function renderImageView() {
    const scan = _imageScanCache;
    if (!scan) return renderImages();

    const kw = AdminState.imageFilter.toLowerCase();
    let images = scan.images;
    if (kw) images = images.filter(i => i.name.toLowerCase().includes(kw));
    if (AdminState.imageFilterMode === 'referenced') images = images.filter(i => i.referenced);
    if (AdminState.imageFilterMode === 'orphan') images = images.filter(i => !i.referenced);
    if (AdminState.imageTypeFilter) {
        const ext = AdminState.imageTypeFilter.toLowerCase();
        images = images.filter(i => {
            const n = (i.name || '').toLowerCase();
            return n.endsWith('.' + ext) || (ext === 'jpg' && n.endsWith('.jpeg'));
        });
    }

    // 排序
    const sf = AdminState.imageSortField || 'modified';
    const sd = AdminState.imageSortDir === 'asc' ? 1 : -1;
    images = images.slice().sort((a, b) => {
        let va, vb;
        if (sf === 'name') {
            va = (a.name || '').toLowerCase();
            vb = (b.name || '').toLowerCase();
            return va < vb ? -sd : va > vb ? sd : 0;
        } else if (sf === 'size') {
            va = a.size || 0;
            vb = b.size || 0;
            return (va - vb) * sd;
        } else if (sf === 'referenced') {
            va = a.referenced ? 1 : 0;
            vb = b.referenced ? 1 : 0;
            return (va - vb) * sd;
        } else {
            va = new Date(a.modified || 0).getTime();
            vb = new Date(b.modified || 0).getTime();
            return (va - vb) * sd;
        }
    });

    const selectedCount = AdminState.imageSelected.size;
    const canDelete = hasPermission('images.delete');

    // 统计各类型数量
    const typeCounts = {};
    scan.images.forEach(i => {
        const m = (i.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
        const ext = m ? m[1] : '';
        if (ext) typeCounts[ext] = (typeCounts[ext] || 0) + 1;
    });
    const typeOpts = ['png', 'jpg', 'gif', 'webp', 'svg'].filter(e => typeCounts[e]).map(e =>
        `<option value="${e}"${AdminState.imageTypeFilter === e ? ' selected' : ''}>${e.toUpperCase()} (${typeCounts[e]})</option>`
    ).join('');

    const html = `
    <div class="stats-grid" style="margin-bottom:18px;">
        <div class="stat-card stat-info">
            <div class="stat-head"><div class="stat-label">图片总数</div><div class="stat-icon"><i data-feather="image"></i></div></div>
            <div class="stat-value">${scan.total}</div>
        </div>
        <div class="stat-card stat-ok">
            <div class="stat-head"><div class="stat-label">已引用</div><div class="stat-icon"><i data-feather="check-circle"></i></div></div>
            <div class="stat-value">${scan.referencedCount}</div>
        </div>
        <div class="stat-card stat-warn">
            <div class="stat-head"><div class="stat-label">未引用（孤儿）</div><div class="stat-icon"><i data-feather="alert-triangle"></i></div></div>
            <div class="stat-value">${scan.orphanCount}</div>
            <div class="stat-foot">可清理释放空间</div>
        </div>
        <div class="stat-card">
            <div class="stat-head"><div class="stat-label">总占用</div><div class="stat-icon"><i data-feather="hard-drive"></i></div></div>
            <div class="stat-value" style="font-size:22px;">${escapeHtml(scan.totalSizeText)}</div>
        </div>
    </div>

    <div class="toolbar">
        <div class="toolbar-left">
            <input type="text" class="search-input" placeholder="搜索图片名..." value="${escapeAttr(AdminState.imageFilter)}"
                   oninput="onImageSearch(this.value)" autocomplete="off">
            <select class="filter-select" onchange="onImageFilterModeChange(this.value)">
                <option value="all"${AdminState.imageFilterMode === 'all' ? ' selected' : ''}>全部 (${scan.total})</option>
                <option value="referenced"${AdminState.imageFilterMode === 'referenced' ? ' selected' : ''}>已引用 (${scan.referencedCount})</option>
                <option value="orphan"${AdminState.imageFilterMode === 'orphan' ? ' selected' : ''}>未引用 (${scan.orphanCount})</option>
            </select>
            <select class="filter-select" onchange="onImageTypeFilterChange(this.value)" style="width:120px">
                <option value="">所有类型</option>
                ${typeOpts}
            </select>
            <select class="filter-select" onchange="onImageSortChange(this.value)" style="width:130px">
                <option value="modified-desc"${sf==='modified'&&sd===-1?' selected':''}>最新优先</option>
                <option value="modified-asc"${sf==='modified'&&sd===1?' selected':''}>最旧优先</option>
                <option value="name-asc"${sf==='name'&&sd===1?' selected':''}>名称 A-Z</option>
                <option value="name-desc"${sf==='name'&&sd===-1?' selected':''}>名称 Z-A</option>
                <option value="size-desc"${sf==='size'&&sd===-1?' selected':''}>文件最大</option>
                <option value="size-asc"${sf==='size'&&sd===1?' selected':''}>文件最小</option>
                <option value="referenced-desc"${sf==='referenced'&&sd===-1?' selected':''}>已引用优先</option>
                <option value="referenced-asc"${sf==='referenced'&&sd===1?' selected':''}>未引用优先</option>
            </select>
        </div>
        <div class="toolbar-right">
            ${canDelete && selectedCount > 0 ? `<button class="btn btn-danger btn-sm" onclick="batchDeleteImages()"><i data-feather="trash-2" style="width:14px;height:14px;"></i> 删除选中 (${selectedCount})</button>` : ''}
            ${canDelete ? `<button class="btn btn-default btn-sm" onclick="toggleAllImageSelect()">
                ${selectedCount === images.length && images.length > 0 ? '取消全选' : '全选'}
            </button>` : ''}
            ${canDelete && scan.orphanCount > 0 ? '<button class="btn btn-danger btn-sm" onclick="deleteUnreferencedImages()"><i data-feather="trash" style="width:14px;height:14px;"></i> 清理未引用</button>' : ''}
        </div>
    </div>

    <div class="panel">
        <div class="panel-body">
            ${images.length === 0 ?
                '<div class="empty-state"><div class="empty-icon"><i data-feather="image" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无图片</div></div>' :
                '<div class="image-grid">' + images.map(img => {
                    const checked = AdminState.imageSelected.has(img.path);
                    const extMatch = (img.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
                    const ext = extMatch ? extMatch[1].toUpperCase() : '?';
                    return `
                    <div class="image-card${checked ? ' selected' : ''}" data-path="${escapeAttr(img.path)}">
                        <div class="image-thumb" onclick="previewImage('${escapeAttr(img.path)}')">
                            <img src="../${escapeAttr(img.path)}" loading="lazy" onerror="this.style.display='none';this.parentElement.style.background='#fef2f2';">
                            <span class="image-type-badge">${escapeHtml(ext)}</span>
                            ${canDelete ? `<div class="image-check${checked ? ' checked' : ''}" onclick="event.stopPropagation();toggleImageSelect('${escapeAttr(img.path)}')">
                                ${checked ? '<i data-feather="check" style="width:14px;height:14px;"></i>' : ''}
                            </div>
                            <button class="image-delete" onclick="event.stopPropagation();deleteImage('${escapeAttr(img.path)}')" title="删除图片">
                                <i data-feather="trash-2" style="width:14px;height:14px;"></i>
                            </button>` : ''}
                        </div>
                        <div class="image-info">
                            <div class="image-name" title="${escapeAttr(img.name)}">${escapeHtml(img.name)}</div>
                            <div class="image-meta">
                                ${img.referenced ? '<span class="badge badge-ok" style="font-size:10px;padding:1px 6px;">已引用</span>' : '<span class="badge badge-warn" style="font-size:10px;padding:1px 6px;">未引用</span>'}
                                · ${escapeHtml(img.sizeText || formatSize(img.size))}
                            </div>
                        </div>
                    </div>`;
                }).join('') + '</div>'
            }
        </div>
    </div>
    `;
    document.getElementById('adminContent').innerHTML = html;
    refreshFeatherIcons();
}

let _imageSearchTimer = null;
function onImageSearch(v) {
    clearTimeout(_imageSearchTimer);
    _imageSearchTimer = setTimeout(() => {
        AdminState.imageFilter = v;
        renderImageView();
    }, 300);
}

function onImageFilterModeChange(v) {
    AdminState.imageFilterMode = v;
    renderImageView();
}

function onImageSortChange(v) {
    const [field, dir] = v.split('-');
    AdminState.imageSortField = field;
    AdminState.imageSortDir = dir;
    renderImageView();
}

function onImageTypeFilterChange(v) {
    AdminState.imageTypeFilter = v;
    renderImageView();
}

function toggleImageSelect(path) {
    if (AdminState.imageSelected.has(path)) {
        AdminState.imageSelected.delete(path);
    } else {
        AdminState.imageSelected.add(path);
    }
    renderImageView();
}

function toggleAllImageSelect() {
    const kw = AdminState.imageFilter.toLowerCase();
    let images = _imageScanCache ? _imageScanCache.images : [];
    if (kw) images = images.filter(i => i.name.toLowerCase().includes(kw));
    if (AdminState.imageFilterMode === 'referenced') images = images.filter(i => i.referenced);
    if (AdminState.imageFilterMode === 'orphan') images = images.filter(i => !i.referenced);
    if (AdminState.imageTypeFilter) {
        const ext = AdminState.imageTypeFilter.toLowerCase();
        images = images.filter(i => {
            const n = (i.name || '').toLowerCase();
            return n.endsWith('.' + ext) || (ext === 'jpg' && n.endsWith('.jpeg'));
        });
    }

    if (AdminState.imageSelected.size === images.length && images.length > 0) {
        AdminState.imageSelected.clear();
    } else {
        images.forEach(i => AdminState.imageSelected.add(i.path));
    }
    renderImageView();
}

async function deleteImage(path) {
    if (!hasPermission('images.delete')) { showToast('无删除图片权限', 'error'); return; }
    const ok = await showConfirm(`确定删除图片「${path.split('/').pop()}」吗？`, 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteImages', {
            method: 'POST',
            body: JSON.stringify({ paths: [path] }),
        });
        const j = await r.json();
        if (j.success && j.deleted > 0) {
            showToast(`已删除 ${j.deleted} 张图片${j.freedBytes > 0 ? '，释放 ' + j.freedBytesText : ''}`, 'success');
            renderImages();
        } else {
            showToast('删除失败：' + (j.failed && j.failed[0] ? j.failed[0] : '未知原因'), 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

async function batchDeleteImages() {
    if (!hasPermission('images.delete')) { showToast('无删除图片权限', 'error'); return; }
    const paths = Array.from(AdminState.imageSelected);
    if (paths.length === 0) return;
    const ok = await showConfirm(`确定删除选中的 ${paths.length} 张图片吗？此操作不可恢复。`, 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteImagesBatch', {
            method: 'POST',
            body: JSON.stringify({ paths }),
        });
        const j = await r.json();
        if (j.success) {
            showToast(`已删除 ${j.deleted} 张图片${j.freedBytes > 0 ? '，释放 ' + j.freedBytesText : ''}`, 'success');
            if (j.failedCount > 0) {
                showToast(`${j.failedCount} 张删除失败`, 'warn');
            }
            renderImages();
        } else {
            showToast(j.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

async function deleteUnreferencedImages() {
    if (!hasPermission('images.delete')) { showToast('无删除图片权限', 'error'); return; }
    const orphanCount = _imageScanCache ? _imageScanCache.orphanCount : 0;
    if (orphanCount === 0) {
        showToast('没有未引用的图片', 'info');
        return;
    }
    const ok = await showConfirm(`确定清理 ${orphanCount} 张未引用的孤儿图片吗？此操作不可恢复。`, 'trash');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteUnreferencedImages', { method: 'POST' });
        const j = await r.json();
        if (j.success) {
            showToast(`已清理 ${j.deleted} 张图片${j.freedBytes > 0 ? '，释放 ' + j.freedBytesText : ''}`, 'success');
            if (j.failedCount > 0) {
                showToast(`${j.failedCount} 张清理失败`, 'warn');
            }
            renderImages();
        } else {
            showToast(j.error || '清理失败', 'error');
        }
    } catch (e) {
        showToast('清理失败', 'error');
    }
}

/* ========== 图片预览灯箱 ========== */
function previewImage(path) {
    const name = path.split('/').pop();
    const body = `
        <div style="text-align:center;">
            <img src="../${escapeAttr(path)}" style="max-width:100%;max-height:60vh;border-radius:var(--radius-sm);box-shadow:var(--shadow);" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
            <div style="display:none;padding:40px;color:var(--t3);">图片加载失败</div>
        </div>
        <div style="margin-top:14px;font-size:13px;color:var(--t2);word-break:break-all;">
            <strong>文件名：</strong>${escapeHtml(name)}<br>
            <strong>路径：</strong><code style="font-size:12px;">${escapeHtml(path)}</code>
        </div>
    `;
    const foot = `
        <button class="btn btn-default" onclick="closeModal()">关闭</button>
        <a class="btn btn-default" href="../${escapeAttr(path)}" target="_blank" download="${escapeAttr(name)}"><i data-feather="download" style="width:12px;height:12px;"></i> 下载</a>
        ${hasPermission('images.delete') ? `<button class="btn btn-danger" onclick="closeModal();deleteImage('${escapeAttr(path)}')"><i data-feather="trash-2" style="width:12px;height:12px;"></i> 删除</button>` : ''}
    `;
    openModal('图片预览', body, foot);
}

/* ========== 备份恢复 ========== */
function renderBackup() {
    const canCreate = hasPermission('backup.create');
    const canRestore = hasPermission('backup.restore');
    const canDelete = hasPermission('backup.delete');
    const canClear = hasPermission('backup.clear');
    const html = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="hard-drive" style="width:16px;height:16px;"></i> 创建备份</div>
        </div>
        <div class="panel-body">
            <div class="backup-section">
                ${canCreate ? `<div class="backup-item">
                    <div class="backup-icon" style="background:rgba(99,102,241,0.1);"><i data-feather="save" style="color:var(--pri);"></i></div>
                    <div class="backup-info">
                        <div class="backup-title">在服务器上创建备份</div>
                        <div class="backup-desc">将当前数据（含图片）备份到服务器，可直接在服务器上管理和恢复</div>
                    </div>
                    <button class="btn btn-primary" onclick="openCreateBackupModal(true)"><i data-feather="save" style="width:14px;height:14px;"></i> 完整备份</button>
                    <button class="btn btn-default" onclick="openCreateBackupModal(false)" style="margin-left:6px;"><i data-feather="file-text" style="width:14px;height:14px;"></i> 仅数据</button>
                </div>` : ''}
                <div class="backup-item">
                    <div class="backup-icon"><i data-feather="download" style="color:var(--pri);"></i></div>
                    <div class="backup-info">
                        <div class="backup-title">导出备份文件</div>
                        <div class="backup-desc">导出全部文案、分类和图片为 .cpydes 备份文件下载到本地</div>
                    </div>
                    <button class="btn btn-default" onclick="exportBackup()"><i data-feather="download" style="width:14px;height:14px;"></i> 导出</button>
                </div>
                ${canRestore ? `<div class="backup-item">
                    <div class="backup-icon"><i data-feather="upload" style="color:var(--warn);"></i></div>
                    <div class="backup-info">
                        <div class="backup-title">从本地文件恢复</div>
                        <div class="backup-desc">上传 .cpydes 备份文件恢复全部数据（将覆盖当前数据）</div>
                    </div>
                    <label class="btn btn-warn" style="cursor:pointer;">
                        <i data-feather="upload" style="width:14px;height:14px;"></i> 选择文件
                        <input type="file" accept=".cpydes,.json" onchange="importBackup(event)" hidden>
                    </label>
                </div>` : ''}
                <div class="backup-item">
                    <div class="backup-icon"><i data-feather="file-text"></i></div>
                    <div class="backup-info">
                        <div class="backup-title">仅导出数据（不含图片）</div>
                        <div class="backup-desc">导出文案和分类的 JSON 数据（不含图片文件）</div>
                    </div>
                    <button class="btn btn-default" onclick="exportDataOnly()"><i data-feather="download" style="width:14px;height:14px;"></i> 导出 JSON</button>
                </div>
            </div>
        </div>
    </div>

    <div class="panel" style="margin-top:16px;">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="server" style="width:16px;height:16px;"></i> 服务器备份记录</div>
            <button class="btn btn-default btn-sm" onclick="loadBackupList()" style="margin-left:auto;"><i data-feather="refresh-cw" style="width:12px;height:12px;"></i> 刷新</button>
        </div>
        <div class="panel-body" id="backupListContainer">
            <div class="loading-state"><div class="spinner"></div>加载备份记录...</div>
        </div>
    </div>

    ${canClear ? `<div class="panel" style="margin-top:16px;">
        <div class="panel-head"><div class="panel-title" style="color:var(--err);"><i data-feather="alert-triangle" style="width:16px;height:16px;"></i> 危险操作</div></div>
        <div class="panel-body">
            <div class="danger-zone">
                <div style="display:flex;align-items:center;gap:16px;">
                    <div style="font-size:32px;"><i data-feather="trash" style="width:32px;height:32px;color:var(--err);"></i></div>
                    <div style="flex:1;">
                        <div style="font-weight:700;color:var(--err);">清空所有数据</div>
                        <div style="font-size:12.5px;color:var(--t2);margin-top:3px;">删除全部文案、分类和图片文件，此操作不可恢复！</div>
                    </div>
                    <button class="btn btn-danger" onclick="clearAllData()"><i data-feather="trash-2" style="width:14px;height:14px;"></i> 清空</button>
                </div>
            </div>
        </div>
    </div>` : ''}
    `;
    document.getElementById('adminContent').innerHTML = html;
    refreshFeatherIcons();
    loadBackupList();
}

async function loadBackupList() {
    const container = document.getElementById('backupListContainer');
    if (!container) return;
    try {
        const r = await adminApiFetch('listBackups');
        if (!r.ok) {
            container.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
            return;
        }
        const j = await r.json();
        if (!j.success) {
            container.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error || '加载失败')}</div></div>`;
            return;
        }
        const backups = j.backups || [];
        if (backups.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i data-feather="archive" style="width:48px;height:48px;"></i></div><div class="empty-text">暂无备份记录</div><div class="empty-sub">点击上方「完整备份」或「仅数据」创建第一个备份</div></div>';
            refreshFeatherIcons();
            return;
        }
        const canRestore = hasPermission('backup.restore');
        const canDelete = hasPermission('backup.delete');
        const canDownload = hasPermission('backup.create');
        let rows = '';
        backups.forEach(b => {
            const date = b.createdAt ? new Date(b.createdAt) : null;
            const dateStr = date ? date.toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-';
            const imgBadge = b.hasImages ? '<span class="bk-badge bk-badge-img">含图片</span>' : '<span class="bk-badge bk-badge-data">仅数据</span>';
            rows += `<tr>
                <td>
                    <div class="bk-name">${dateStr}</div>
                    ${b.note ? `<div class="bk-note">${escapeHtml(b.note)}</div>` : ''}
                </td>
                <td>${imgBadge}</td>
                <td>
                    <span class="bk-stat">${b.itemCount} 文案</span>
                    <span class="bk-stat-sep">/</span>
                    <span class="bk-stat">${b.categoryCount} 分类</span>
                    ${b.hasImages ? `<span class="bk-stat-sep">/</span><span class="bk-stat">${b.imageCount} 图片</span>` : ''}
                </td>
                <td>${escapeHtml(b.sizeText)}</td>
                <td>${b.createdBy ? escapeHtml(b.createdBy) : '-'}</td>
                <td class="bk-actions">
                    ${canRestore ? `<button class="btn btn-sm btn-warn" onclick="openRestoreBackupModal('${escapeAttr(b.id)}')" title="恢复"><i data-feather="rotate-ccw" style="width:12px;height:12px;"></i></button>` : ''}
                    ${canDownload ? `<a class="btn btn-sm btn-default" href="api.php?action=downloadBackup&id=${encodeURIComponent(b.id)}" title="下载"><i data-feather="download" style="width:12px;height:12px;"></i></a>` : ''}
                    ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteServerBackup('${escapeAttr(b.id)}')" title="删除"><i data-feather="trash-2" style="width:12px;height:12px;"></i></button>` : ''}
                </td>
            </tr>`;
        });
        container.innerHTML = `<div class="bk-table-wrap"><table class="bk-table">
            <thead><tr>
                <th>时间</th>
                <th>类型</th>
                <th>内容</th>
                <th>大小</th>
                <th>创建者</th>
                <th>操作</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
        refreshFeatherIcons();
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
    }
}

function openCreateBackupModal(includeImages) {
    if (!hasPermission('backup.create')) { showToast('无创建备份权限', 'error'); return; }
    const title = includeImages ? '创建完整备份' : '创建数据备份';
    const desc = includeImages ? '将备份所有文案、分类和图片数据到服务器' : '将备份文案和分类数据到服务器（不含图片）';
    const body = `
        <div style="margin-bottom:12px;color:var(--t2);font-size:13px;">${desc}</div>
        <div class="form-group">
            <label class="form-label">备注（可选，最多100字）</label>
            <input type="text" id="backupNote" class="form-input" placeholder="例如：上线前备份、数据迁移前..." maxlength="100">
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:12px;margin-top:12px;font-size:12.5px;color:var(--t3);">
            <div style="margin-bottom:4px;">当前数据概况：</div>
            <div>${AdminState.data.items ? AdminState.data.items.length : 0} 条文案 / ${AdminState.data.categories ? AdminState.data.categories.length : 0} 个分类</div>
        </div>
    `;
    const foot = `
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="doCreateBackup(${includeImages})"><i data-feather="save" style="width:14px;height:14px;"></i> 创建备份</button>
    `;
    openModal(title, body, foot);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
    refreshFeatherIcons();
}

async function doCreateBackup(includeImages) {
    const noteEl = document.getElementById('backupNote');
    const note = noteEl ? noteEl.value.trim() : '';
    showToast('正在创建备份...', 'info', 2000);
    try {
        const r = await adminApiFetch('createBackup', {
            method: 'POST',
            body: JSON.stringify({ includeImages, note }),
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            if (r.status === 401) {
                showToast('会话已过期，请重新登录', 'error');
                setTimeout(() => location.reload(), 1500);
                return;
            }
            showToast(j.error || '创建失败', 'error');
            return;
        }
        const j = await r.json();
        if (j.success) {
            closeModal();
            showToast(`备份已创建（${j.itemCount} 文案${includeImages ? '、' + j.imageCount + ' 图片' : ''}，${j.sizeText}）`, 'success');
            loadBackupList();
        } else {
            showToast(j.error || '创建失败', 'error');
        }
    } catch (e) {
        showToast('创建失败: ' + (e.message || '网络错误'), 'error');
    }
}

function openRestoreBackupModal(backupId) {
    if (!hasPermission('backup.restore')) { showToast('无恢复备份权限', 'error'); return; }
    const body = `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:16px;">
            <div style="font-weight:700;color:var(--err);margin-bottom:4px;"><i data-feather="alert-triangle" style="width:14px;height:14px;"></i> 警告</div>
            <div style="font-size:13px;color:#991b1b;">恢复备份将覆盖当前数据，操作前建议先创建一份新备份！</div>
        </div>
        <div style="font-size:13px;color:var(--t2);margin-bottom:16px;">请选择需要恢复的内容：</div>
        <div class="form-group">
            <label class="form-checkbox-label">
                <input type="checkbox" id="restoreImages" checked>
                <span>恢复图片文件</span>
            </label>
        </div>
        <div class="form-group">
            <label class="form-checkbox-label">
                <input type="checkbox" id="restoreUsers">
                <span>恢复用户数据（含密码，慎选）</span>
            </label>
        </div>
        <div class="form-group">
            <label class="form-checkbox-label">
                <input type="checkbox" id="restoreShares">
                <span>恢复分享数据</span>
            </label>
        </div>
    `;
    const foot = `
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-warn" onclick="doRestoreBackup('${escapeAttr(backupId)}')"><i data-feather="rotate-ccw" style="width:14px;height:14px;"></i> 确认恢复</button>
    `;
    openModal('恢复备份', body, foot);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
    refreshFeatherIcons();
}

async function doRestoreBackup(backupId) {
    if (!hasPermission('backup.restore')) { showToast('无恢复备份权限', 'error'); return; }
    const restoreImages = document.getElementById('restoreImages')?.checked ?? true;
    const restoreUsers = document.getElementById('restoreUsers')?.checked ?? false;
    const restoreShares = document.getElementById('restoreShares')?.checked ?? false;
    const ok = await showConfirm('确定从该备份恢复吗？当前数据将被覆盖！', 'alert-triangle');
    if (!ok) return;

    showToast('正在恢复备份...', 'info', 2000);
    try {
        const r = await adminApiFetch('restoreBackup', {
            method: 'POST',
            body: JSON.stringify({ id: backupId, restoreImages, restoreUsers, restoreShares }),
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            if (r.status === 401) {
                showToast('会话已过期，请重新登录', 'error');
                setTimeout(() => location.reload(), 1500);
                return;
            }
            showToast(j.error || '恢复失败', 'error');
            return;
        }
        const j = await r.json();
        if (j.success) {
            closeModal();
            let msg = `已恢复 ${j.itemCount} 文案、${j.categoryCount} 分类`;
            if (restoreImages) msg += `、${j.restoredImages} 图片`;
            showToast(msg, 'success');
            await loadAdminData();
            loadBackupList();
        } else {
            showToast(j.error || '恢复失败', 'error');
        }
    } catch (e) {
        showToast('恢复失败: ' + (e.message || '网络错误'), 'error');
    }
}

async function deleteServerBackup(backupId) {
    if (!hasPermission('backup.delete')) { showToast('无删除备份权限', 'error'); return; }
    const ok = await showConfirm('确定删除该备份记录吗？删除后不可恢复。', 'alert-triangle');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteBackup', {
            method: 'POST',
            body: JSON.stringify({ id: backupId }),
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            showToast(j.error || '删除失败', 'error');
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast('备份已删除', 'success');
            loadBackupList();
        } else {
            showToast(j.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

async function exportBackup() {
    if (!hasPermission('backup.create')) { showToast('无导出备份权限', 'error'); return; }
    showToast('正在生成备份...', 'info', 2000);
    try {
        const r = await apiFetch('fullExport');
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            if (r.status === 401) {
                showToast('会话已过期，请重新登录', 'error');
                setTimeout(() => location.reload(), 1500);
                return;
            }
            showToast(j.error || '导出失败 (HTTP ' + r.status + ')', 'error');
            return;
        }
        const text = await r.text();
        let j;
        try {
            j = JSON.parse(text);
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            showToast('服务器返回数据格式错误', 'error');
            return;
        }
        if (j.success) {
            const blob = new Blob([JSON.stringify(j.backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cpydes-backup-${new Date().toISOString().slice(0, 10)}.cpydes`;
            a.click();
            URL.revokeObjectURL(url);
            showToast(`已导出 ${j.backup.imageCount || 0} 张图片`, 'success');
        } else {
            showToast(j.error || '导出失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('导出失败: ' + (e.message || '网络错误'), 'error');
    }
}

async function exportDataOnly() {
    const data = AdminState.data;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cpydes-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出', 'success');
}

async function importBackup(event) {
    if (!hasPermission('backup.restore')) { showToast('无恢复备份权限', 'error'); return; }
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    const ok = await showConfirm('恢复备份将覆盖当前所有数据，且不可恢复。确定继续吗？', 'alert-triangle');
    if (!ok) return;

    try {
        const text = await file.text();
        const backup = JSON.parse(text);
        if (!backup.data || !backup.images) {
            showToast('备份文件格式不正确', 'error');
            return;
        }
        const r = await apiFetch('fullImport', {
            method: 'POST',
            body: JSON.stringify({ backup }),
        });
        if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            if (r.status === 401) {
                showToast('会话已过期，请重新登录', 'error');
                setTimeout(() => location.reload(), 1500);
                return;
            }
            showToast(j.error || '恢复失败', 'error');
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(j.message || '恢复成功', 'success');
            await loadAdminData();
        } else {
            showToast(j.error || '恢复失败', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('文件解析失败', 'error');
    }
}

async function clearAllData() {
    if (!hasPermission('backup.clear')) { showToast('无清空数据权限', 'error'); return; }
    const ok = await showConfirm('此操作将删除全部文案、分类和图片，且不可恢复！确定清空吗？', 'alert-triangle');
    if (!ok) return;
    const ok2 = await showConfirm('再次确认：真的要清空所有数据吗？', 'alert-octagon');
    if (!ok2) return;
    try {
        const r = await adminApiFetch('clearAll', { method: 'POST' });
        if (!r.ok) {
            if (r.status === 401) {
                showToast('会话已过期，请重新登录', 'error');
                setTimeout(() => location.reload(), 1500);
                return;
            }
            const j = await r.json().catch(() => ({}));
            showToast(j.error || '清空失败', 'error');
            return;
        }
        const j = await r.json();
        if (j.success) {
            showToast(`已清空 ${j.deletedImages || 0} 张图片`, 'success');
            await loadAdminData();
        } else {
            showToast(j.error || '清空失败', 'error');
        }
    } catch (e) {
        showToast('清空失败', 'error');
    }
}


