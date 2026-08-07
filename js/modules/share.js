/**
 * 文案分享功能模块
 * 提供创建分享链接、管理分享、复制链接等功能
 */

// 当前预览的文案 ID（由 preview.js 同步）
let _shareItemId = null;

/**
 * 打开分享对话框
 * @param {string} itemId - 文案 ID
 */
async function openShareDialog(itemId) {
    if (!itemId) {
        showToast('缺少文案 ID', 'error');
        return;
    }
    if (!hasPermission('content.share')) {
        showToast('无分享权限', 'error');
        return;
    }
    _shareItemId = itemId;

    const item = getItemById(itemId);
    const itemTitle = item ? (item.title || '无标题') : '未知文案';

    const html = `
        <div class="share-dialog">
            <div class="share-config-section">
                <div class="share-section-title">
                    <i data-feather="settings" style="width:13px;height:13px;"></i> 分享设置
                </div>
                <div class="share-form-grid">
                    <div class="share-form-group">
                        <label class="share-label">过期时间</label>
                        <select id="shareExpiresSelect" class="share-select" onchange="toggleShareExpiresCustom()">
                            <option value="">永不过期</option>
                            <option value="1d">1 天后</option>
                            <option value="7d">7 天后</option>
                            <option value="30d">30 天后</option>
                            <option value="custom">自定义...</option>
                        </select>
                        <input type="datetime-local" id="shareExpiresCustom" class="share-input share-expires-custom" style="display:none;">
                    </div>
                    <div class="share-form-group">
                        <label class="share-label">查看次数上限</label>
                        <select id="shareMaxViewsSelect" class="share-select" onchange="toggleShareMaxViewsCustom()">
                            <option value="">不限</option>
                            <option value="10">10 次</option>
                            <option value="50">50 次</option>
                            <option value="100">100 次</option>
                            <option value="custom">自定义...</option>
                        </select>
                        <input type="number" id="shareMaxViewsCustom" class="share-input share-maxviews-custom" min="1" placeholder="输入次数" style="display:none;">
                    </div>
                </div>
                <div class="share-form-group">
                    <label class="share-label">访问密码（可选）</label>
                    <input type="password" id="sharePassword" class="share-input" placeholder="留空表示无需密码" autocomplete="new-password">
                </div>
            </div>
            <div class="share-actions">
                <button class="btn btn-primary share-generate-btn" id="createShareBtn" onclick="createShareLink('${escapeAttr(itemId)}')"><i data-feather="link" style="width:14px;height:14px;"></i> 生成分享链接</button>
            </div>
            <div class="share-result" id="shareResult" style="display:none;">
                <div class="share-result-header">
                    <i data-feather="check-circle" style="width:14px;height:14px;color:#10b981;"></i>
                    <span class="share-result-title">分享链接已生成</span>
                </div>
                <div class="share-link-box">
                    <input type="text" id="shareLinkInput" class="share-input" readonly>
                    <button class="btn btn-default btn-sm" onclick="copyShareLink()"><i data-feather="copy" style="width:12px;height:12px;"></i> 复制</button>
                </div>
                <div class="share-qr-section">
                    <div class="share-qr-wrap">
                        <img id="shareQrImg" class="share-qr-img" alt="分享二维码">
                    </div>
                    <div class="share-qr-tip">
                        <i data-feather="smartphone" style="width:13px;height:13px;"></i>
                        <span>手机扫码查看</span>
                    </div>
                </div>
                <div class="share-info-text" id="shareInfoText"></div>
            </div>
        </div>
    `;

    // 使用专门的分享弹窗
    const overlay = document.getElementById('shareOverlay');
    const titleEl = document.getElementById('shareDialogTitle');
    const bodyEl = document.getElementById('shareDialogBody');
    if (!overlay || !titleEl || !bodyEl) {
        // 降级为快速分享
        quickShare(itemId);
        return;
    }
    titleEl.textContent = '分享文案 - ' + itemTitle;
    bodyEl.innerHTML = html;
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';

    setTimeout(() => { if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons(); }, 50);
}

/**
 * 关闭分享对话框
 */
function closeShareDialog() {
    const overlay = document.getElementById('shareOverlay');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
    _shareItemId = null;
}

/**
 * 切换自定义过期时间输入框
 */
function toggleShareExpiresCustom() {
    const select = document.getElementById('shareExpiresSelect');
    const custom = document.getElementById('shareExpiresCustom');
    if (!select || !custom) return;
    custom.style.display = select.value === 'custom' ? '' : 'none';
}

/**
 * 切换自定义查看次数输入框
 */
function toggleShareMaxViewsCustom() {
    const select = document.getElementById('shareMaxViewsSelect');
    const custom = document.getElementById('shareMaxViewsCustom');
    if (!select || !custom) return;
    custom.style.display = select.value === 'custom' ? '' : 'none';
}

/**
 * 解析过期时间选择，返回 ISO 字符串或 null
 */
function resolveExpiresAt() {
    const select = document.getElementById('shareExpiresSelect');
    if (!select) return null;
    const val = select.value;
    if (!val) return null;
    if (val === 'custom') {
        const custom = document.getElementById('shareExpiresCustom');
        if (!custom || !custom.value) return null;
        // datetime-local 转为 ISO
        return new Date(custom.value).toISOString();
    }
    // 1d / 7d / 30d
    const days = parseInt(val, 10);
    if (isNaN(days)) return null;
    const d = new Date(Date.now() + days * 86400000);
    return d.toISOString();
}

/**
 * 解析查看次数上限
 */
function resolveMaxViews() {
    const select = document.getElementById('shareMaxViewsSelect');
    if (!select) return null;
    const val = select.value;
    if (!val) return null;
    if (val === 'custom') {
        const custom = document.getElementById('shareMaxViewsCustom');
        if (!custom || !custom.value) return null;
        const n = parseInt(custom.value, 10);
        return isNaN(n) || n <= 0 ? null : n;
    }
    const n = parseInt(val, 10);
    return isNaN(n) || n <= 0 ? null : n;
}

/**
 * 创建分享链接
 */
async function createShareLink(itemId) {
    if (!itemId) return;
    if (!hasPermission('content.share')) {
        showToast('无分享权限', 'error');
        return;
    }

    const expiresAt = resolveExpiresAt();
    const maxViews = resolveMaxViews();
    const passwordInput = document.getElementById('sharePassword');
    const password = passwordInput ? passwordInput.value : '';

    // 校验自定义过期时间
    if (expiresAt !== null && new Date(expiresAt).getTime() <= Date.now()) {
        showToast('过期时间必须晚于当前时间', 'error');
        return;
    }

    const btn = document.getElementById('createShareBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-feather="loader" style="width:14px;height:14px;"></i> 生成中...'; }

    let shareSuccess = false;
    try {
        const response = await apiFetch('api.php?action=createShare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId, expiresAt, maxViews, password: password || null })
        });
        if (response.status === 401) {
            if (typeof openLibraryAuth === 'function') openLibraryAuth();
            return;
        }
        if (response.status === 403) {
            let msg = '无权限';
            try { const j = await response.json(); if (j.error) msg = j.error; } catch (_) {}
            showToast(msg, 'error');
            return;
        }
        let result;
        try { result = await response.json(); }
        catch (_) { showToast('生成失败：服务端响应解析错误', 'error'); return; }

        if (result.success) {
            shareSuccess = true;
            // 显示链接
            const resultBox = document.getElementById('shareResult');
            const linkInput = document.getElementById('shareLinkInput');
            const infoText = document.getElementById('shareInfoText');
            const qrImg = document.getElementById('shareQrImg');
            if (resultBox) resultBox.style.display = '';
            if (linkInput) linkInput.value = result.url || '';

            // 生成二维码
            if (qrImg && result.url) {
                const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&data=' + encodeURIComponent(result.url);
                qrImg.src = qrUrl;
            }

            let info = '分享链接已生成';
            if (expiresAt) info += '，过期时间：' + new Date(expiresAt).toLocaleString();
            if (maxViews) info += '，查看上限：' + maxViews + ' 次';
            if (password) info += '，已设置访问密码';
            if (infoText) infoText.textContent = info;

            // 自动选中链接便于复制
            if (linkInput) { linkInput.focus(); linkInput.select(); }
            showToast('分享链接已生成', 'success');

            // 隐藏创建按钮
            if (btn) btn.style.display = 'none';
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        console.error('创建分享链接失败', e);
        showToast('创建分享链接失败', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i data-feather="link" style="width:14px;height:14px;"></i> 重新生成';
            // 仅在失败时恢复按钮显示（成功时保持隐藏）
            if (!shareSuccess) btn.style.display = '';
        }
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }
}

/**
 * 复制分享链接到剪贴板
 */
function copyShareLink() {
    const input = document.getElementById('shareLinkInput');
    if (!input || !input.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(() => {
                showToast('已复制', 'success');
            }).catch(() => fallbackCopyShareLink(input));
    } else {
        fallbackCopyShareLink(input);
    }
}

function fallbackCopyShareLink(input) {
    try {
        input.select();
        document.execCommand('copy');
        showToast('已复制', 'success');
    } catch (e) {
        showToast('复制失败，请手动复制', 'error');
    }
}

/**
 * 快速分享（无密码、永不过期）
 */
async function quickShare(itemId) {
    if (!itemId) return;
    if (!hasPermission('content.share')) {
        showToast('无分享权限', 'error');
        return;
    }
    try {
        const response = await apiFetch('api.php?action=createShare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId })
        });
        if (response.status === 401) { if (typeof openLibraryAuth === 'function') openLibraryAuth(); return; }
        if (response.status === 403) { showToast('无权限', 'error'); return; }
        const result = await response.json();
        if (result.success && result.url) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(result.url).then(() => {
                    showToast('已复制', 'success');
                }).catch(() => { showToast('链接：' + result.url, 'info'); });
            } else {
                showToast('链接已生成：' + result.url, 'info');
            }
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        console.error('快速分享失败', e);
        showToast('快速分享失败', 'error');
    }
}
