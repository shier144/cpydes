/* Cpydes 管理后台 —— 由 admin.js 机械拆分（admin-drive.js），依赖 admin-core.js 先加载 */
'use strict';

/* ========== 数据网盘分享管理操作 ========== */

async function copyDriveShareUrl(url) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            showToast('已复制', 'success');
        } else {
            const ta = document.createElement('textarea');
            ta.value = url; document.body.appendChild(ta);
            ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
            showToast('已复制', 'success');
        }
    } catch (e) { showToast('复制失败，请手动复制', 'warning'); }
}

async function revokeDriveShare(shareId) {
    if (!hasPermission('drive.share')) { showToast('无数据网盘分享权限', 'error'); return; }
    const ok = await showConfirm('确定要撤销该数据网盘分享链接吗？此操作不可恢复。', 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteDriveShare', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: shareId })
        });
        const j = await r.json();
        if (j.success) { showToast('数据网盘分享链接已撤销', 'success'); renderShares('drive'); }
        else { showToast(j.error || '撤销失败', 'error'); }
    } catch (e) { showToast('撤销失败', 'error'); }
}

async function clearAllDriveShares() {
    if (!hasPermission('drive.manage')) { showToast('无数据网盘管理权限', 'error'); return; }
    const filtered = AdminState._lastDriveShares || [];
    if (filtered.length === 0) { showToast('没有可清空的数据网盘分享记录', 'warning'); return; }
    const ids = filtered.map(s => s.id);
    const ok = await showConfirm(`确定要清空当前筛选结果中的 ${filtered.length} 条数据网盘分享链接吗？此操作不可恢复。`, 'trash-2');
    if (!ok) return;
    const ok2 = await showConfirm('再次确认：真的要清空这些数据网盘分享链接吗？', 'alert-octagon');
    if (!ok2) return;
    try {
        const r = await adminApiFetch('clearAllDriveShares', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        const j = await r.json();
        if (j.success) { showToast(`已清空 ${j.clearedCount} 条数据网盘分享链接`, 'success'); renderShares('drive'); }
        else { showToast(j.error || '清空失败', 'error'); }
    } catch (e) { showToast('清空失败', 'error'); }
}

async function editDriveShareConfig(shareId) {
    if (!hasPermission('drive.share')) { showToast('无数据网盘分享权限', 'error'); return; }
    if (!AdminState._lastDriveShares) { showToast('请先加载分享列表', 'error'); return; }
    const s = AdminState._lastDriveShares.find(x => x.id === shareId);
    if (!s) { showToast('未找到分享记录', 'error'); return; }

    const expiresVal = s.expiresAt ? s.expiresAt.substring(0, 16) : '';
    const maxDlVal = s.maxDownloads || '';

    const bodyHtml = `
        <div class="form-group">
            <label class="form-label">过期时间</label>
            <input type="datetime-local" class="form-input" id="editDriveShareExpires" value="${escapeAttr(expiresVal)}">
            <small style="color:var(--t3);font-size:12px;">留空表示永不过期</small>
        </div>
        <div class="form-group">
            <label class="form-label">下载次数上限</label>
            <input type="number" class="form-input" id="editDriveShareMaxDl" value="${escapeAttr(String(maxDlVal))}" min="1" placeholder="留空表示不限">
            <small style="color:var(--t3);font-size:12px;">当前已下载 ${s.downloadCount || 0} 次；留空表示不限</small>
        </div>
        <div class="form-group">
            <label class="form-label">新密码（可选）</label>
            <input type="password" class="form-input" id="editDriveSharePassword" placeholder="留空保持不变" autocomplete="new-password">
        </div>`;
    const footHtml = `
        <button class="btn btn-default" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveDriveShareConfig('${escapeAttr(shareId)}')"><i data-feather="save" style="width:14px;height:14px;"></i> 保存</button>`;

    openModal('编辑数据网盘分享配置 - ' + (s.fileName || shareId), bodyHtml, footHtml);
    const dialog = document.querySelector('.modal-dialog');
    if (dialog) dialog.classList.add('modal-narrow');
}

async function saveDriveShareConfig(shareId) {
    const expiresInput = document.getElementById('editDriveShareExpires');
    const maxDlInput = document.getElementById('editDriveShareMaxDl');
    const pwdInput = document.getElementById('editDriveSharePassword');

    const payload = { id: shareId };
    if (expiresInput) {
        const v = expiresInput.value.trim();
        payload.expiresAt = v || null;
        if (v && new Date(v).getTime() <= Date.now()) {
            showToast('过期时间必须晚于当前时间', 'error'); return;
        }
    }
    if (maxDlInput) {
        const v = maxDlInput.value.trim();
        payload.maxDownloads = v ? Math.max(1, parseInt(v, 10) || 0) : null;
    }
    if (pwdInput && pwdInput.value) payload.password = pwdInput.value;

    try {
        const r = await adminApiFetch('updateDriveShare', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const j = await r.json();
        if (j.success) { showToast('数据网盘分享配置已更新', 'success'); closeModal(); renderShares('drive'); }
        else { showToast(j.error || '保存失败', 'error'); }
    } catch (e) { showToast('保存失败', 'error'); }
}



/* ========== 数据网盘 ========== */

async function renderDrive() {
    const c = document.getElementById('adminContent');
    AdminState.driveParentId = null;
    AdminState.driveSearch = '';
    AdminState.driveSelected = [];
    AdminState.drivePage = 1;

    // Ensure persistent file input exists (survives innerHTML replacements)
    if (!document.getElementById('driveFileInput')) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'driveFileInput';
        fileInput.multiple = true;
        fileInput.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        fileInput.addEventListener('change', function() {
            if (this.files && this.files.length > 0) {
                driveHandleUpload(this.files);
            }
            this.value = '';
        });
        document.body.appendChild(fileInput);
    }

    c.innerHTML = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="hard-drive" style="width:16px;height:16px;"></i> 数据网盘</div>
            <div class="drive-toolbar">
                ${hasPermission('drive.upload') ? `<button class="btn btn-primary btn-sm" onclick="driveUploadClick()"><i data-feather="upload" style="width:14px;height:14px;"></i> 上传文件</button>` : ''}
                ${hasPermission('drive.folder') ? `<button class="btn btn-default btn-sm" onclick="driveCreateFolder()"><i data-feather="folder-plus" style="width:14px;height:14px;"></i> 新建文件夹</button>` : ''}
                ${hasPermission('drive.manage') ? `<button class="btn btn-default btn-sm" onclick="driveShowSettings()"><i data-feather="settings" style="width:14px;height:14px;"></i> 设置</button>` : ''}
                <div class="drive-search-wrap">
                    <i data-feather="search" style="width:14px;height:14px;color:var(--t3);flex-shrink:0;"></i>
                    <input type="text" class="form-input drive-search-input" id="driveSearchInput" placeholder="搜索文件名..." value="${escapeAttr(AdminState.driveSearch || '')}" oninput="driveOnSearch(this.value)">
                    ${AdminState.driveSearch ? `<button class="drive-search-clear" onclick="driveClearSearch()" title="清除"><i data-feather="x" style="width:12px;height:12px;"></i></button>` : ''}
                </div>
                <div class="drive-view-toggle">
                    <button class="btn btn-default btn-sm ${AdminState.driveView === 'list' ? 'active' : ''}" onclick="driveSetView('list')" title="列表视图"><i data-feather="list" style="width:14px;height:14px;"></i></button>
                    <button class="btn btn-default btn-sm ${AdminState.driveView === 'grid' ? 'active' : ''}" onclick="driveSetView('grid')" title="网格视图"><i data-feather="grid" style="width:14px;height:14px;"></i></button>
                </div>
            </div>
        </div>
        <div id="driveBreadcrumb" class="drive-breadcrumb">
            <div class="drive-breadcrumb-left" id="driveBreadcrumbLeft"></div>
            <div class="drive-breadcrumb-right" id="driveBatchBar" style="display:none;">
                <div class="drive-batch-info">
                    <label class="drive-batch-check"><input type="checkbox" id="driveBatchCheckAll" onchange="driveToggleAll(this.checked)"></label>
                    <span id="driveBatchCount">已选 0 项</span>
                </div>
                <div class="drive-batch-actions">
                    ${hasPermission('view.drive') ? `<button class="btn btn-default btn-sm" onclick="driveBatchDownload()"><i data-feather="download" style="width:14px;height:14px;"></i> 下载</button>` : ''}
                    ${hasPermission('drive.move') ? `<button class="btn btn-default btn-sm" onclick="driveBatchMove()"><i data-feather="corner-up-right" style="width:14px;height:14px;"></i> 移动</button>` : ''}
                    ${hasPermission('drive.share') ? `<button class="btn btn-default btn-sm" onclick="driveBatchShare()"><i data-feather="share-2" style="width:14px;height:14px;"></i> 分享</button>` : ''}
                    ${hasPermission('drive.delete') ? `<button class="btn btn-danger btn-sm" onclick="driveBatchDelete()"><i data-feather="trash-2" style="width:14px;height:14px;"></i> 删除</button>` : ''}
                    <button class="btn btn-default btn-sm" onclick="driveBatchClear()"><i data-feather="x" style="width:14px;height:14px;"></i> 取消</button>
                </div>
            </div>
        </div>
        <div class="panel-body" id="driveBody">
            <div class="loading-state"><div class="spinner"></div>加载中...</div>
        </div>
        <div id="drivePager" class="drive-pager-wrap" style="display:none;"></div>
    </div>
    <div id="driveDropOverlay" class="drive-drop-overlay" style="display:none;">
        <div class="drive-drop-content"><i data-feather="upload-cloud" style="width:48px;height:48px;"></i><div>拖放文件到此处上传</div></div>
    </div>`;
    refreshFeatherIcons();
    driveLoadFiles();
    driveSetupDropZone();
}

function driveSetupDropZone() {
    const c = document.getElementById('adminContent');
    const overlay = document.getElementById('driveDropOverlay');
    if (!c || !overlay) return;
    let dragCounter = 0;
    c.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (!hasPermission('drive.upload')) return;
        dragCounter++;
        overlay.style.display = 'flex';
    });
    c.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) { overlay.style.display = 'none'; dragCounter = 0; }
    });
    c.addEventListener('dragover', (e) => e.preventDefault());
    c.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.style.display = 'none';
        if (!hasPermission('drive.upload')) return;
        if (e.dataTransfer.files.length > 0) driveHandleUpload(e.dataTransfer.files);
    });
}

async function driveLoadFiles() {
    const body = document.getElementById('driveBody');
    if (!body) return;
    try {
        const r = await adminApiFetch('listDriveFiles', { method: 'POST', body: JSON.stringify({ parentId: AdminState.driveParentId, search: AdminState.driveSearch }) });
        const j = await r.json();
        if (!j.success) { body.innerHTML = `<div class="empty-state"><div class="empty-text">${escapeHtml(j.error)}</div></div>`; return; }
        AdminState.driveSelected = [];
        AdminState._allDriveFiles = j.files || [];
        AdminState._isDriveSearch = j.search || false;
        driveRenderBreadcrumb(j.breadcrumb || []);
        driveRenderPage();
        driveUpdateBatchBar();
    } catch (e) {
        body.innerHTML = '<div class="empty-state"><div class="empty-text">网络错误</div></div>';
    }
}

function driveRenderBreadcrumb(items) {
    const el = document.getElementById('driveBreadcrumbLeft');
    if (!el) return;
    let html = '<span class="drive-crumb" onclick="driveNavigate(null)">数据网盘</span>';
    items.forEach(item => {
        html += `<span class="drive-crumb-sep">/</span><span class="drive-crumb" onclick="driveNavigate('${item.id}')">${escapeHtml(item.name)}</span>`;
    });
    el.innerHTML = html;
}

function driveNavigate(parentId) {
    AdminState.driveParentId = parentId;
    AdminState.driveSearch = '';
    AdminState.drivePage = 1;
    const si = document.getElementById('driveSearchInput');
    if (si) si.value = '';
    driveLoadFiles();
}

function driveSetView(view) {
    AdminState.driveView = view;
    driveRenderPage();
}

let driveSearchTimer = null;
function driveOnSearch(val) {
    clearTimeout(driveSearchTimer);
    driveSearchTimer = setTimeout(() => {
        AdminState.driveSearch = val;
        AdminState.drivePage = 1;
        if (val) AdminState.driveParentId = null;
        driveLoadFiles();
    }, 300);
}

function driveClearSearch() {
    AdminState.driveSearch = '';
    AdminState.drivePage = 1;
    const si = document.getElementById('driveSearchInput');
    if (si) si.value = '';
    driveLoadFiles();
}

function driveRenderPage() {
    const allFiles = AdminState._allDriveFiles || [];
    const isSearch = AdminState._isDriveSearch || false;
    const total = allFiles.length;
    const pageSize = AdminState.drivePageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (AdminState.drivePage > totalPages) AdminState.drivePage = totalPages;
    const page = AdminState.drivePage;
    const start = (page - 1) * pageSize;
    const pageFiles = allFiles.slice(start, start + pageSize);

    driveRenderFiles(pageFiles, isSearch);

    // 分页控件
    const pagerEl = document.getElementById('drivePager');
    if (pagerEl && total > pageSize) {
        let html = '<div class="drive-pager">';
        html += `<span class="drive-pager-info">共 ${total} 项</span>`;
        html += `<button class="btn btn-default btn-sm drive-pager-btn" ${page <= 1 ? 'disabled' : ''} onclick="driveGoPage(1)" title="首页"><i data-feather="chevrons-left" style="width:12px;height:12px;"></i></button>`;
        html += `<button class="btn btn-default btn-sm drive-pager-btn" ${page <= 1 ? 'disabled' : ''} onclick="driveGoPage(${page - 1})" title="上一页"><i data-feather="chevron-left" style="width:12px;height:12px;"></i></button>`;
        // 页码按钮
        const maxButtons = 5;
        let startP = Math.max(1, page - Math.floor(maxButtons / 2));
        let endP = Math.min(totalPages, startP + maxButtons - 1);
        if (endP - startP < maxButtons - 1) startP = Math.max(1, endP - maxButtons + 1);
        if (startP > 1) html += `<span class="drive-pager-ellipsis">...</span>`;
        for (let i = startP; i <= endP; i++) {
            html += `<button class="btn ${i === page ? 'btn-primary' : 'btn-default'} btn-sm drive-pager-num" onclick="driveGoPage(${i})">${i}</button>`;
        }
        if (endP < totalPages) html += `<span class="drive-pager-ellipsis">...</span>`;
        html += `<button class="btn btn-default btn-sm drive-pager-btn" ${page >= totalPages ? 'disabled' : ''} onclick="driveGoPage(${page + 1})" title="下一页"><i data-feather="chevron-right" style="width:12px;height:12px;"></i></button>`;
        html += `<button class="btn btn-default btn-sm drive-pager-btn" ${page >= totalPages ? 'disabled' : ''} onclick="driveGoPage(${totalPages})" title="末页"><i data-feather="chevrons-right" style="width:12px;height:12px;"></i></button>`;
        html += `<span class="drive-pager-info">${page} / ${totalPages}</span>`;
        html += '</div>';
        pagerEl.innerHTML = html;
        pagerEl.style.display = 'flex';
        refreshFeatherIcons();
    } else if (pagerEl) {
        pagerEl.innerHTML = '';
        pagerEl.style.display = 'none';
    }
}

function driveGoPage(p) {
    AdminState.drivePage = p;
    AdminState.driveSelected = [];
    driveRenderPage();
    driveUpdateBatchBar();
    document.getElementById('driveBody')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function driveGetIcon(item) {
    if (item.type === 'folder') return 'folder';
    const mime = item.mimeType || '';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'film';
    if (mime.startsWith('audio/')) return 'music';
    if (mime.includes('pdf')) return 'file-text';
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || mime.includes('tar') || mime.includes('gz')) return 'archive';
    if (mime.includes('word') || mime.includes('document')) return 'file-text';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return 'grid';
    if (mime.includes('powerpoint') || mime.includes('presentation')) return 'monitor';
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript')) return 'file-code';
    return 'file';
}

function driveGetFileType(item) {
    if (item.type === 'folder') return '文件夹';
    const mime = item.mimeType || '';
    if (mime.startsWith('image/')) return '图片';
    if (mime.startsWith('video/')) return '视频';
    if (mime.startsWith('audio/')) return '音频';
    if (mime.includes('pdf')) return 'PDF';
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return '压缩包';
    if (mime.includes('word') || mime.includes('document')) return '文档';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return '表格';
    if (mime.includes('powerpoint') || mime.includes('presentation')) return '演示';
    if (mime.startsWith('text/')) return '文本';
    return '文件';
}

function driveRenderFiles(files, isSearch) {
    const body = document.getElementById('driveBody');
    if (!body) return;

    if (files.length === 0) {
        body.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-feather="folder" style="width:48px;height:48px;"></i></div><div class="empty-text">${AdminState.driveSearch ? '未找到匹配的文件' : '此目录为空'}</div></div>`;
        refreshFeatherIcons();
        return;
    }

    if (AdminState.driveView === 'grid') {
        driveRenderGrid(body, files);
    } else {
        driveRenderList(body, files);
    }
    refreshFeatherIcons();
}

function driveRenderList(body, files) {
    let html = `<table class="drive-table">
        <thead><tr>
            <th style="width:36px;"><input type="checkbox" onchange="driveToggleAll(this.checked)"></th>
            <th>名称</th>
            <th style="width:100px;">类型</th>
            <th style="width:100px;">大小</th>
            <th style="width:150px;">修改时间</th>
            <th style="width:120px;">操作</th>
        </tr></thead><tbody>`;

    files.forEach(f => {
        const checked = AdminState.driveSelected.includes(f.id) ? 'checked' : '';
        const icon = driveGetIcon(f);
        const mime = f.mimeType || '';
        const canPreview = f.type === 'file' && (mime.startsWith('image/') || mime.includes('pdf'));
        const dblClick = f.type === 'folder' ? `driveNavigate('${f.id}')` : canPreview ? `drivePreview('${f.id}','${escapeHtml(f.name).replace(/'/g, "\\'")}','${escapeHtml(mime).replace(/'/g, "\\'")}')` : '';
        html += `<tr class="drive-row ${checked ? 'drive-row-selected' : ''}" data-id="${escapeHtml(f.id)}" data-type="${f.type}">
            <td><input type="checkbox" ${checked} onchange="driveToggleSelect('${f.id}', this.checked)"></td>
            <td>
                <div class="drive-name-cell" ondblclick="${dblClick}">
                    <i data-feather="${icon}" class="drive-file-icon drive-icon-${f.type === 'folder' ? 'folder' : 'file'}"></i>
                    <span class="drive-name" onclick="${f.type === 'folder' ? `driveNavigate('${f.id}')` : canPreview ? `drivePreview('${f.id}','${escapeHtml(f.name).replace(/'/g, "\\'")}','${escapeHtml(mime).replace(/'/g, "\\'")}')` : ''}">${escapeHtml(f.name)}</span>
                </div>
            </td>
            <td><span class="drive-type-badge">${driveGetFileType(f)}</span></td>
            <td>${f.type === 'file' ? formatBytesLocal(f.size || 0) : '-'}</td>
            <td class="drive-time">${escapeHtml(f.updatedAt || f.createdAt || '-')}</td>
            <td class="drive-actions">${driveGetActions(f)}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    body.innerHTML = html;
}

function driveRenderGrid(body, files) {
    let html = '<div class="drive-grid">';
    files.forEach(f => {
        const icon = driveGetIcon(f);
        const checked = AdminState.driveSelected.includes(f.id);
        const mime = f.mimeType || '';
        const canPreview = f.type === 'file' && (mime.startsWith('image/') || mime.includes('pdf'));
        const dblClick = f.type === 'folder' ? `driveNavigate('${f.id}')` : canPreview ? `drivePreview('${f.id}','${escapeHtml(f.name).replace(/'/g, "\\'")}','${escapeHtml(mime).replace(/'/g, "\\'")}')` : '';
        html += `<div class="drive-grid-card ${checked ? 'drive-grid-selected' : ''}" data-id="${escapeHtml(f.id)}" data-type="${f.type}" ondblclick="${dblClick}">
            <div class="drive-grid-check"><input type="checkbox" ${checked ? 'checked' : ''} onchange="driveToggleSelect('${f.id}', this.checked)" onclick="event.stopPropagation()"></div>
            <div class="drive-grid-icon"><i data-feather="${icon}"></i></div>
            <div class="drive-grid-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
            <div class="drive-grid-meta">${f.type === 'file' ? formatBytesLocal(f.size || 0) : '文件夹'}</div>
            <div class="drive-grid-actions">${driveGetActions(f)}</div>
        </div>`;
    });
    html += '</div>';
    body.innerHTML = html;
}

function driveGetActions(f) {
    let btns = '';
    if (f.type === 'file') {
        const mime = f.mimeType || '';
        const canPreview = mime.startsWith('image/') || mime.includes('pdf');
        if (canPreview && hasPermission('view.drive')) btns += `<button class="btn btn-default btn-sm" onclick="drivePreview('${f.id}','${escapeHtml(f.name).replace(/'/g, "\\'")}','${escapeHtml(mime).replace(/'/g, "\\'")}')" title="预览"><i data-feather="eye" style="width:14px;height:14px;"></i></button>`;
        if (hasPermission('view.drive')) btns += `<button class="btn btn-default btn-sm" onclick="driveDownload('${f.id}')" title="下载"><i data-feather="download" style="width:14px;height:14px;"></i></button>`;
        if (hasPermission('drive.share')) btns += `<button class="btn btn-default btn-sm" onclick="driveShare('${f.id}')" title="分享"><i data-feather="share-2" style="width:14px;height:14px;"></i></button>`;
    }
    if (hasPermission('drive.rename')) btns += `<button class="btn btn-default btn-sm" onclick="driveRename('${f.id}','${escapeHtml(f.name).replace(/'/g, "\\'")}')" title="重命名"><i data-feather="edit-2" style="width:14px;height:14px;"></i></button>`;
    if (hasPermission('drive.move')) btns += `<button class="btn btn-default btn-sm" onclick="driveMove('${f.id}')" title="移动"><i data-feather="corner-up-right" style="width:14px;height:14px;"></i></button>`;
    if (hasPermission('drive.move') && f.type === 'file') btns += `<button class="btn btn-default btn-sm" onclick="driveCopy('${f.id}')" title="复制"><i data-feather="copy" style="width:14px;height:14px;"></i></button>`;
    if (hasPermission('drive.delete')) btns += `<button class="btn btn-danger btn-sm" onclick="driveDelete('${f.id}','${escapeHtml(f.name).replace(/'/g, "\\'")}')" title="删除"><i data-feather="trash-2" style="width:14px;height:14px;"></i></button>`;
    return btns;
}

function driveToggleAll(checked) {
    if (checked) {
        // 全选当前页
        const pageIds = Array.from(document.querySelectorAll('.drive-row, .drive-grid-card')).map(el => el.dataset.id);
        pageIds.forEach(id => { if (!AdminState.driveSelected.includes(id)) AdminState.driveSelected.push(id); });
    } else {
        // 取消选择当前页
        const pageIds = new Set(Array.from(document.querySelectorAll('.drive-row, .drive-grid-card')).map(el => el.dataset.id));
        AdminState.driveSelected = AdminState.driveSelected.filter(id => !pageIds.has(id));
    }
    document.querySelectorAll('.drive-row input[type="checkbox"], .drive-grid-card input[type="checkbox"]').forEach(cb => cb.checked = checked);
    document.querySelectorAll('.drive-row').forEach(row => row.classList.toggle('drive-row-selected', checked));
    document.querySelectorAll('.drive-grid-card').forEach(card => card.classList.toggle('drive-grid-selected', checked));
    driveUpdateBatchBar();
}

function driveToggleSelect(id, checked) {
    if (checked && !AdminState.driveSelected.includes(id)) {
        AdminState.driveSelected.push(id);
    } else if (!checked) {
        AdminState.driveSelected = AdminState.driveSelected.filter(x => x !== id);
    }
    driveUpdateBatchBar();
}

function driveUpdateBatchBar() {
    const bar = document.getElementById('driveBatchBar');
    if (!bar) return;
    const cnt = AdminState.driveSelected.length;
    bar.style.display = cnt > 0 ? 'flex' : 'none';
    const countEl = document.getElementById('driveBatchCount');
    if (countEl) countEl.textContent = `已选 ${cnt} 项`;
    const checkAll = document.getElementById('driveBatchCheckAll');
    if (checkAll) {
        const pageIds = Array.from(document.querySelectorAll('.drive-row, .drive-grid-card')).map(el => el.dataset.id);
        const allPageSelected = pageIds.length > 0 && pageIds.every(id => AdminState.driveSelected.includes(id));
        checkAll.checked = allPageSelected;
        checkAll.indeterminate = !allPageSelected && pageIds.some(id => AdminState.driveSelected.includes(id));
    }
}

function driveBatchClear() {
    AdminState.driveSelected = [];
    document.querySelectorAll('.drive-row input[type="checkbox"], .drive-grid-card input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('.drive-row').forEach(row => row.classList.remove('drive-row-selected'));
    document.querySelectorAll('.drive-grid-card').forEach(card => card.classList.remove('drive-grid-selected'));
    driveUpdateBatchBar();
}

function drivePreview(id, name, mimeType) {
    if (!hasPermission('view.drive')) { showToast('无预览权限', 'error'); return; }
    const existing = document.getElementById('drivePreviewOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'drivePreviewOverlay';
    overlay.className = 'drive-preview-overlay';

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const isImage = mimeType.startsWith('image/');
    const isPdf = mimeType.includes('pdf');

    const header = `<div class="drive-preview-header">
        <span class="drive-preview-title">${escapeHtml(name)}</span>
        <div class="drive-preview-actions">
            ${isPdf ? `<button class="btn btn-default btn-sm" id="drivePreviewPrintBtn" title="打印"><i data-feather="printer" style="width:14px;height:14px;"></i></button>` : ''}
            <button class="btn btn-default btn-sm" onclick="driveDownload('${id}')" title="下载"><i data-feather="download" style="width:14px;height:14px;"></i></button>
            <button class="btn btn-default btn-sm" id="drivePreviewCloseBtn" title="关闭"><i data-feather="x" style="width:14px;height:14px;"></i></button>
        </div>
    </div>`;

    let bodyHtml = '';
    if (isImage) {
        bodyHtml = `<div class="drive-preview-body drive-preview-img">
            <div class="drive-preview-loading">加载中...</div>
            <img src="" class="drive-preview-image" alt="${escapeHtml(name)}" style="display:none;">
        </div>`;
    } else if (isPdf) {
        bodyHtml = `<div class="drive-preview-body drive-preview-pdf">
            <iframe name="drivePreviewIframe" src="" class="drive-preview-iframe" frameborder="0"></iframe>
        </div>`;
    }

    overlay.innerHTML = header + bodyHtml;
    document.body.appendChild(overlay);
    document.getElementById('drivePreviewCloseBtn').addEventListener('click', close);

    // Print button for PDF
    const printBtn = document.getElementById('drivePreviewPrintBtn');
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            const iframe = overlay.querySelector('.drive-preview-iframe');
            if (iframe && iframe.contentWindow) {
                try { iframe.contentWindow.print(); } catch (e) { window.print(); }
            }
        });
    }

    if (isImage) {
        const img = overlay.querySelector('.drive-preview-image');
        const loading = overlay.querySelector('.drive-preview-loading');
        (async () => {
            try {
                const token = await ensureCsrf();
                const r = await adminApiFetch('previewDriveFile', { method: 'POST', body: JSON.stringify({ id }) });
                if (!r.ok) {
                    try {
                        const j = await r.json();
                        loading.textContent = j.error || '预览失败';
                    } catch { loading.textContent = '预览失败 (' + r.status + ')'; }
                    return;
                }
                const blob = await r.blob();
                img.src = URL.createObjectURL(blob);
                img.style.display = '';
                loading.style.display = 'none';
                img.onload = () => URL.revokeObjectURL(img.src);
            } catch (e) { loading.textContent = '网络错误'; }
        })();
    } else if (isPdf) {
        const iframe = overlay.querySelector('.drive-preview-iframe');
        (async () => {
            try {
                const token = await ensureCsrf();
                const form = document.createElement('form');
                form.method = 'POST';
                form.action = 'api.php?action=previewDriveFile';
                form.target = 'drivePreviewIframe';
                form.style.display = 'none';
                const idInput = document.createElement('input');
                idInput.type = 'hidden';
                idInput.name = 'id';
                idInput.value = id;
                form.appendChild(idInput);
                if (token) {
                    const csrfInput = document.createElement('input');
                    csrfInput.type = 'hidden';
                    csrfInput.name = '_csrf';
                    csrfInput.value = token;
                    form.appendChild(csrfInput);
                }
                overlay.appendChild(form);
                form.submit();
                form.remove();
            } catch (e) { /* iframe load error */ }
        })();
    }

    const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    refreshFeatherIcons();
}

function driveUploadClick() {
    document.getElementById('driveFileInput').click();
}

async function driveHandleUpload(fileList) {
    if (!hasPermission('drive.upload')) { showToast('无上传文件权限', 'error'); return; }
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    const concurrency = 3;
    let index = 0;

    async function uploadNext() {
        while (index < files.length) {
            const currentIndex = index++;
            const file = files[currentIndex];
            const fd = new FormData();
            fd.append('parentId', AdminState.driveParentId || '');
            fd.append('file', file);
            try {
                const r = await adminApiFetch('uploadDriveFile', { method: 'POST', body: fd });
                if (!r.ok) {
                    failCount++;
                    try { const j = await r.json(); errors.push(file.name + ': ' + (j.error || '上传失败')); }
                    catch { errors.push(file.name + ': 服务器错误 (' + r.status + ')'); }
                    continue;
                }
                const j = await r.json();
                if (j.success) successCount++;
                else { failCount++; errors.push(file.name + ': ' + (j.error || '上传失败')); }
            } catch (e) { failCount++; errors.push(file.name + ': 网络错误'); }
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, files.length); i++) {
        workers.push(uploadNext());
    }
    await Promise.all(workers);

    if (successCount > 0) showToast(`成功上传 ${successCount} 个文件`, 'success');
    if (failCount > 0) showToast(`${failCount} 个文件上传失败: ${errors.slice(0, 3).join('; ')}`, 'error');
    driveLoadFiles();
}

async function driveCreateFolder() {
    if (!hasPermission('drive.folder')) { showToast('无新建文件夹权限', 'error'); return; }
    const name = await drivePromptInput('新建文件夹', '请输入文件夹名称', '');
    if (!name) return;
    try {
        const r = await adminApiFetch('createDriveFolder', { method: 'POST', body: JSON.stringify({ name, parentId: AdminState.driveParentId }) });
        const j = await r.json();
        if (j.success) { showToast('文件夹已创建', 'success'); driveLoadFiles(); }
        else showToast(j.error || '创建失败', 'error');
    } catch (e) { showToast('网络错误', 'error'); }
}

async function driveRename(id, oldName) {
    if (!hasPermission('drive.rename')) { showToast('无重命名权限', 'error'); return; }
    const newName = await drivePromptInput('重命名', '请输入新名称', oldName);
    if (!newName || newName === oldName) return;
    try {
        const r = await adminApiFetch('renameDriveItem', { method: 'POST', body: JSON.stringify({ id, name: newName }) });
        const j = await r.json();
        if (j.success) { showToast('已重命名', 'success'); driveLoadFiles(); }
        else showToast(j.error || '重命名失败', 'error');
    } catch (e) { showToast('网络错误', 'error'); }
}

function drivePromptInput(title, label, defaultVal) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const cancel = () => { overlay.remove(); resolve(null); };
        overlay.innerHTML = `<div class="modal-dialog" style="max-width:400px;height:auto;">
            <div class="modal-head"><div class="modal-title">${title}</div><button class="modal-close" id="drivePromptClose">&times;</button></div>
            <div class="modal-body">
                <label class="form-label">${label}</label>
                <input type="text" class="form-input" id="drivePromptVal" value="${escapeHtml(defaultVal)}" autofocus>
            </div>
            <div class="modal-foot">
                <button class="btn btn-default" id="drivePromptCancel">取消</button>
                <button class="btn btn-primary" id="drivePromptOk">确定</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        const inp = overlay.querySelector('#drivePromptVal');
        setTimeout(() => { inp.focus(); inp.select(); }, 100);
        const ok = () => { const v = inp.value.trim(); overlay.remove(); resolve(v || null); };
        overlay.querySelector('#drivePromptOk').onclick = ok;
        overlay.querySelector('#drivePromptCancel').onclick = cancel;
        overlay.querySelector('#drivePromptClose').onclick = cancel;
        inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); };
    });
}

async function driveMove(id) {
    if (!hasPermission('drive.move')) { showToast('无移动权限', 'error'); return; }
    try {
        const r = await adminApiFetch('getDriveFolders', { method: 'POST' });
        const j = await r.json();
        if (!j.success) { showToast('获取文件夹列表失败', 'error'); return; }

        const folders = j.folders.filter(f => f.id !== id);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-dialog" style="max-width:400px;height:auto;">
            <div class="modal-head"><div class="modal-title">移动到</div><button class="modal-close" onclick="this.closest('.modal-overlay').remove();">&times;</button></div>
            <div class="modal-body">
                <div class="drive-move-list">
                    <div class="drive-move-item" data-id=""><i data-feather="hard-drive" style="width:14px;height:14px;"></i> 根目录</div>
                    ${folders.map(f => `<div class="drive-move-item" data-id="${f.id}"><i data-feather="folder" style="width:14px;height:14px;"></i> ${escapeHtml(f.name)}</div>`).join('')}
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        refreshFeatherIcons();

        overlay.querySelectorAll('.drive-move-item').forEach(el => {
            el.onclick = async () => {
                const targetId = el.dataset.id || null;
                overlay.remove();
                const mr = await adminApiFetch('moveDriveItem', { method: 'POST', body: JSON.stringify({ id, targetParentId: targetId }) });
                const mj = await mr.json();
                if (mj.success) { showToast('已移动', 'success'); driveLoadFiles(); }
                else showToast(mj.error || '移动失败', 'error');
            };
        });
    } catch (e) { showToast('网络错误', 'error'); }
}

async function driveCopy(id) {
    if (!hasPermission('drive.move')) { showToast('无复制权限', 'error'); return; }
    try {
        const r = await adminApiFetch('getDriveFolders', { method: 'POST' });
        const j = await r.json();
        if (!j.success) { showToast('获取文件夹列表失败', 'error'); return; }

        const folders = j.folders;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-dialog" style="max-width:400px;height:auto;">
            <div class="modal-head"><div class="modal-title">复制到</div><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div>
            <div class="modal-body">
                <div class="drive-move-list">
                    <div class="drive-move-item" data-id=""><i data-feather="hard-drive" style="width:14px;height:14px;"></i> 根目录</div>
                    ${folders.map(f => `<div class="drive-move-item" data-id="${f.id}"><i data-feather="folder" style="width:14px;height:14px;"></i> ${escapeHtml(f.name)}</div>`).join('')}
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        refreshFeatherIcons();

        overlay.querySelectorAll('.drive-move-item').forEach(el => {
            el.onclick = async () => {
                const targetId = el.dataset.id || null;
                overlay.remove();
                const cr = await adminApiFetch('copyDriveItem', { method: 'POST', body: JSON.stringify({ id, targetParentId: targetId }) });
                const cj = await cr.json();
                if (cj.success) { showToast('已复制', 'success'); driveLoadFiles(); }
                else showToast(cj.error || '复制失败', 'error');
            };
        });
    } catch (e) { showToast('网络错误', 'error'); }
}

async function driveDelete(id, name) {
    if (!hasPermission('drive.delete')) { showToast('无删除权限', 'error'); return; }
    if (!confirm(`确定要删除「${name}」吗？`)) return;
    try {
        const r = await adminApiFetch('deleteDriveItems', { method: 'POST', body: JSON.stringify({ ids: [id] }) });
        const j = await r.json();
        if (j.success) { showToast(`已删除 ${j.deletedCount} 个项目`, 'success'); driveLoadFiles(); }
        else showToast(j.error || '删除失败', 'error');
    } catch (e) { showToast('网络错误', 'error'); }
}

async function driveBatchDelete() {
    if (!hasPermission('drive.delete')) { showToast('无删除权限', 'error'); return; }
    const ids = AdminState.driveSelected.filter(id => {
        const row = document.querySelector(`[data-id="${id}"]`);
        return row && row.dataset.type !== 'folder';
    }).concat(AdminState.driveSelected.filter(id => {
        const row = document.querySelector(`[data-id="${id}"]`);
        return row && row.dataset.type === 'folder';
    }));
    // Use all selected ids
    const allIds = AdminState.driveSelected;
    if (allIds.length === 0) return;
    const ok = await showConfirm(`确定要删除选中的 ${allIds.length} 个项目吗？`, 'trash-2');
    if (!ok) return;
    try {
        const r = await adminApiFetch('deleteDriveItems', { method: 'POST', body: JSON.stringify({ ids: allIds }) });
        const j = await r.json();
        if (j.success) { showToast(`已删除 ${j.deletedCount} 个项目`, 'success'); AdminState.driveSelected = []; driveLoadFiles(); }
        else showToast(j.error || '删除失败', 'error');
    } catch (e) { showToast('网络错误', 'error'); }
}

async function driveBatchDownload() {
    if (!hasPermission('view.drive')) { showToast('无下载权限', 'error'); return; }
    const ids = AdminState.driveSelected;
    if (ids.length === 0) return;
    // 仅下载文件（非文件夹）
    const fileIds = ids.filter(id => {
        const row = document.querySelector(`[data-id="${id}"]`);
        if (!row) return false;
        // 检查是否为文件类型
        const icon = row.querySelector('.drive-icon-file');
        return !!icon;
    });
    if (fileIds.length === 0) { showToast('选中的项目没有可下载的文件', 'warning'); return; }
    // 逐个下载（浏览器限制）
    if (fileIds.length > 10) { showToast('单次最多下载 10 个文件', 'warning'); return; }
    for (const id of fileIds) {
        await driveDownload(id);
        await new Promise(r => setTimeout(r, 500));
    }
    showToast(`已下载 ${fileIds.length} 个文件`, 'success');
}

async function driveBatchMove() {
    if (!hasPermission('drive.move')) { showToast('无移动权限', 'error'); return; }
    const ids = AdminState.driveSelected;
    if (ids.length === 0) return;
    try {
        const r = await adminApiFetch('getDriveFolders', { method: 'POST' });
        const j = await r.json();
        if (!j.success) { showToast('获取文件夹列表失败', 'error'); return; }

        const folders = j.folders.filter(f => !ids.includes(f.id));
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-dialog" style="max-width:400px;height:auto;">
            <div class="modal-head"><div class="modal-title">移动 ${ids.length} 个项目到</div><button class="modal-close" onclick="this.closest('.modal-overlay').remove();">&times;</button></div>
            <div class="modal-body">
                <div class="drive-move-list">
                    <div class="drive-move-item" data-id=""><i data-feather="hard-drive" style="width:14px;height:14px;"></i> 根目录</div>
                    ${folders.map(f => `<div class="drive-move-item" data-id="${f.id}"><i data-feather="folder" style="width:14px;height:14px;"></i> ${escapeHtml(f.name)}</div>`).join('')}
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        refreshFeatherIcons();

        overlay.querySelectorAll('.drive-move-item').forEach(el => {
            el.onclick = async () => {
                const targetId = el.dataset.id || null;
                overlay.remove();
                // 逐个移动
                let moved = 0, failed = 0;
                for (const id of ids) {
                    try {
                        const mr = await adminApiFetch('moveDriveItem', { method: 'POST', body: JSON.stringify({ id, targetParentId: targetId }) });
                        const mj = await mr.json();
                        if (mj.success) moved++;
                        else failed++;
                    } catch { failed++; }
                }
                if (moved > 0) showToast(`已移动 ${moved} 个项目`, 'success');
                if (failed > 0) showToast(`${failed} 个项目移动失败`, 'error');
                AdminState.driveSelected = [];
                driveLoadFiles();
            };
        });
    } catch (e) { showToast('网络错误', 'error'); }
}

async function driveBatchShare() {
    if (!hasPermission('drive.share')) { showToast('无分享权限', 'error'); return; }
    const ids = AdminState.driveSelected;
    if (ids.length === 0) return;
    // 仅分享文件
    const fileIds = ids.filter(id => {
        const row = document.querySelector(`[data-id="${id}"]`);
        if (!row) return false;
        const icon = row.querySelector('.drive-icon-file');
        return !!icon;
    });
    if (fileIds.length === 0) { showToast('选中的项目没有可分享的文件', 'warning'); return; }
    let shared = 0, failed = 0;
    for (const id of fileIds) {
        try {
            const r = await adminApiFetch('createDriveShare', { method: 'POST', body: JSON.stringify({ fileId: id }) });
            const j = await r.json();
            if (j.success) shared++;
            else failed++;
        } catch { failed++; }
    }
    if (shared > 0) showToast(`已创建 ${shared} 个分享链接`, 'success');
    if (failed > 0) showToast(`${failed} 个文件分享失败`, 'error');
}

async function driveDownload(id) {
    if (!hasPermission('view.drive')) { showToast('无下载权限', 'error'); return; }
    try {
        const token = await ensureCsrf();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-CSRF-Token'] = token;
        const r = await fetch('api.php?action=downloadDriveFile', { method: 'POST', headers, body: JSON.stringify({ id }) });
        if (!r.ok) {
            try { const j = await r.json(); showToast(j.error || '下载失败', 'error'); } catch { showToast('下载失败', 'error'); }
            return;
        }
        const disposition = r.headers.get('Content-Disposition') || '';
        let fileName = 'download';
        const match = disposition.match(/filename="?(.+?)"?$/);
        if (match) fileName = decodeURIComponent(match[1]);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { showToast('网络错误', 'error'); }
}

async function driveShare(fileId) {
    if (!hasPermission('drive.share')) { showToast('无分享权限', 'error'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-dialog" style="max-width:440px;height:auto;">
        <div class="modal-head"><div class="modal-title">创建分享链接</div><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div>
        <div class="modal-body">
            <div class="form-group">
                <label class="form-label">访问密码（留空则无需密码）</label>
                <input type="text" class="form-input" id="driveSharePwd" placeholder="可选" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label">过期时间</label>
                <input type="datetime-local" class="form-input" id="driveShareExpire">
            </div>
            <div class="form-group">
                <label class="form-label">最大下载次数（0=不限）</label>
                <input type="number" class="form-input" id="driveShareMaxDl" value="0" min="0">
            </div>
        </div>
        <div class="modal-foot">
            <button class="btn btn-default" onclick="this.closest('.modal-overlay').remove()">取消</button>
            <button class="btn btn-primary" id="driveShareCreateBtn">创建分享</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#driveShareCreateBtn').onclick = async () => {
        const pwd = overlay.querySelector('#driveSharePwd').value.trim();
        const expire = overlay.querySelector('#driveShareExpire').value;
        const maxDl = parseInt(overlay.querySelector('#driveShareMaxDl').value) || 0;

        try {
            const r = await adminApiFetch('createDriveShare', { method: 'POST', body: JSON.stringify({ fileId, password: pwd, expiresAt: expire, maxDownloads: maxDl }) });
            const j = await r.json();
            if (j.success) {
                overlay.remove();
                const shareUrl = buildDriveShareUrl(j.share.token);
                driveShowShareResult(shareUrl, j.share.hasPassword);
            } else {
                showToast(j.error || '创建失败', 'error');
            }
        } catch (e) { showToast('网络错误', 'error'); }
    };
}

function driveShowShareResult(url, hasPassword) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-dialog" style="max-width:480px;height:auto;">
        <div class="modal-head"><div class="modal-title">分享链接已创建</div><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div>
        <div class="modal-body">
            <div class="form-group">
                <label class="form-label">分享链接</label>
                <div class="drive-share-url">
                    <input type="text" class="form-input" id="driveShareUrlInput" value="${escapeHtml(url)}" readonly>
                    <button class="btn btn-default btn-sm" onclick="window.open('${escapeAttr(url)}','_blank')"><i data-feather="external-link" style="width:13px;height:13px;"></i> 访问</button>
                    <button class="btn btn-primary btn-sm" onclick="driveCopyShareUrl()">复制</button>
                </div>
            </div>
            ${hasPassword ? '<div class="drive-share-hint">此链接需要密码才能访问</div>' : '<div class="drive-share-hint">此链接无需密码即可访问</div>'}
        </div>
        <div class="modal-foot">
            <button class="btn btn-default" onclick="this.closest('.modal-overlay').remove()">关闭</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    refreshFeatherIcons();
}

async function driveCopyShareUrl() {
    const input = document.getElementById('driveShareUrlInput');
    if (!input) return;
    try {
        await navigator.clipboard.writeText(input.value);
        showToast('已复制', 'success');
    } catch (e) {
        input.select();
        document.execCommand('copy');
        showToast('已复制', 'success');
    }
}

async function driveShowSettings() {
    if (!hasPermission('drive.manage')) { showToast('无网盘设置权限', 'error'); return; }
    try {
        const r = await adminApiFetch('getDriveSettings', { method: 'POST' });
        const j = await r.json();
        if (!j.success) { showToast(j.error || '获取设置失败', 'error'); return; }
        const s = j.settings;
        const isAll = s.allowedExts === '*';
        const extStr = isAll ? '' : (Array.isArray(s.allowedExts) ? s.allowedExts.join(', ') : '');
        
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-dialog" style="max-width:460px;height:auto;">
            <div class="modal-head"><div class="modal-title">数据网盘设置</div><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">允许上传的文件格式</label>
                    <div class="drive-settings-mode">
                        <label class="radio-label"><input type="radio" name="extMode" value="all" ${isAll ? 'checked' : ''}> 允许所有格式（除可执行文件外）</label>
                        <label class="radio-label"><input type="radio" name="extMode" value="custom" ${!isAll ? 'checked' : ''}> 自定义格式</label>
                    </div>
                    <div id="driveExtCustomArea" style="${isAll ? 'display:none' : ''}">
                        <textarea class="form-input" id="driveExtInput" rows="3" placeholder="输入允许的扩展名，用逗号分隔，如: pdf, doc, docx, xls, xlsx, zip, rar, jpg, png, mp4">${escapeHtml(extStr)}</textarea>
                        <div class="form-hint">只允许上传指定扩展名的文件，多个格式用逗号分隔</div>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">单文件最大大小（MB）</label>
                    <input type="number" class="form-input" id="driveMaxSizeInput" value="${s.maxFileSize || 100}" min="1" max="500" style="width:120px;">
                    <div class="form-hint">范围 1-500 MB</div>
                </div>
                <div class="drive-settings-presets">
                    <span class="form-label">快捷预设：</span>
                    <button class="btn btn-default btn-xs" onclick="driveApplyPreset('document')">文档</button>
                    <button class="btn btn-default btn-xs" onclick="driveApplyPreset('image')">图片</button>
                    <button class="btn btn-default btn-xs" onclick="driveApplyPreset('media')">音视频</button>
                    <button class="btn btn-default btn-xs" onclick="driveApplyPreset('archive')">压缩包</button>
                    <button class="btn btn-default btn-xs" onclick="driveApplyPreset('office')">Office</button>
                    <button class="btn btn-default btn-xs" onclick="driveApplyPreset('all')">全部格式</button>
                </div>
            </div>
            <div class="modal-foot">
                <button class="btn btn-default" onclick="this.closest('.modal-overlay').remove()">取消</button>
                <button class="btn btn-primary" id="driveSaveSettingsBtn">保存设置</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        refreshFeatherIcons();
        
        // Radio toggle
        overlay.querySelectorAll('input[name="extMode"]').forEach(radio => {
            radio.onchange = () => {
                const area = overlay.querySelector('#driveExtCustomArea');
                area.style.display = radio.value === 'custom' && radio.checked ? '' : 'none';
            };
        });
        
        // Save
        overlay.querySelector('#driveSaveSettingsBtn').onclick = async () => {
            const mode = overlay.querySelector('input[name="extMode"]:checked').value;
            let allowedExts = '*';
            if (mode === 'custom') {
                const raw = overlay.querySelector('#driveExtInput').value.trim();
                if (!raw) { showToast('请输入至少一个格式', 'error'); return; }
                allowedExts = raw.split(/[,，\s]+/).map(e => e.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()).filter(e => e);
                if (allowedExts.length === 0) { showToast('请输入有效的格式', 'error'); return; }
            }
            const maxFileSize = parseInt(overlay.querySelector('#driveMaxSizeInput').value) || 100;
            
            try {
                const sr = await adminApiFetch('saveDriveSettings', { method: 'POST', body: JSON.stringify({ allowedExts, maxFileSize }) });
                const sj = await sr.json();
                if (sj.success) { showToast('设置已保存', 'success'); overlay.remove(); }
                else showToast(sj.error || '保存失败', 'error');
            } catch (e) { showToast('网络错误', 'error'); }
        };
    } catch (e) { showToast('网络错误', 'error'); }
}

function driveApplyPreset(type) {
    const presets = {
        document: 'pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, rtf, odt, ods, odp',
        image: 'jpg, jpeg, png, gif, bmp, svg, webp, ico, tiff, tif',
        media: 'mp3, wav, ogg, flac, aac, mp4, avi, mkv, mov, wmv, flv, webm',
        archive: 'zip, rar, 7z, tar, gz, bz2, xz',
        office: 'doc, docx, xls, xlsx, ppt, pptx, pdf, txt, csv',
        all: '__ALL__',
    };
    const area = document.querySelector('#driveExtCustomArea');
    const input = document.querySelector('#driveExtInput');
    const radioAll = document.querySelector('input[name="extMode"][value="all"]');
    const radioCustom = document.querySelector('input[name="extMode"][value="custom"]');
    
    if (type === 'all') {
        radioAll.checked = true;
        if (area) area.style.display = 'none';
        return;
    }
    
    radioCustom.checked = true;
    if (area) area.style.display = '';
    if (input) input.value = presets[type] || '';
}


