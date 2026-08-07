/* Cpydes 管理后台 —— 由 admin.js 机械拆分（admin-ai.js），依赖 admin-core.js 先加载 */
'use strict';

/* ========== AI 管理（合并：AI 设置 + AI 任务） ========== */
const AI_MANAGE_TABS = [
    { id: 'settings', label: 'AI 设置', icon: 'cpu',  perm: 'settings.manage' },
    { id: 'tasks',    label: 'AI 任务', icon: 'list', perm: 'settings.manage' },
];

async function renderAiManage(targetContainer, tab) {
    const c = targetContainer || document.getElementById('adminContent');

    if (!tab || !AI_MANAGE_TABS.find(t => t.id === tab)) {
        tab = 'settings';
    }
    AdminState.aiManageTab = tab;

    const tabsHtml = AI_MANAGE_TABS.map(t => {
        const active = t.id === tab ? 'active' : '';
        return `<button class="adm-tab-btn ${active}" onclick="switchAiManageTab('${t.id}')"><i data-feather="${t.icon}"></i> ${t.label}</button>`;
    }).join('');

    c.innerHTML = `
    <div class="adm-tabs-shell">
        <div class="adm-tabs-bar">${tabsHtml}</div>
        <div class="adm-tab-body" id="aiManageBody"><div class="loading-state"><div class="spinner"></div>加载中...</div></div>
    </div>`;
    refreshFeatherIcons();

    const body = document.getElementById('aiManageBody');
    if (!body) return;

    if (tab === 'settings') {
        await renderAiSettings(body);
    } else if (tab === 'tasks') {
        await renderAiTasks(body);
    }
}

function switchAiManageTab(tab) {
    renderAiManage(null, tab);
}

/* ========== AI 设置管理 ========== */

async function renderAiSettings(targetContainer) {
    const c = targetContainer || document.getElementById('adminContent');

    // 加载 AI 设置
    let aiSettings = {
        enabled: false,
        models: [],
        systemPrompt: '你是一个智能助手，可以帮助用户撰写文案、优化表达、生成创意灵感。',
        defaultModel: 'default'
    };
    
    try {
        // 调用根目录的 api.php 而不是 admin/api.php
        const r = await fetch('../api.php?action=getAiSettings', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        });
        const j = await r.json();
        if (j.success && j.settings) {
            aiSettings = j.settings;
            // 补齐 type 字段（兼容旧数据）
            if (aiSettings.models) {
                aiSettings.models.forEach(model => {
                    if (!model.type) {
                        model.type = 'chat';
                    }
                });
            }
        } else {
            console.warn('AI 设置加载失败:', j);
        }
    } catch (e) {
        console.error('加载 AI 设置失败:', e);
    }
    
    // 保存设置到全局状态以便编辑
    AdminState.aiSettings = aiSettings;

    // 渲染模型表格
    const modelsHtml = buildAiModelRows(aiSettings.models, aiSettings);
    
    c.innerHTML = `
    <div class="panel">
        <div class="panel-head">
            <div class="panel-title"><i data-feather="cpu" style="width:16px;height:16px;"></i> AI 设置</div>
            <button class="btn btn-primary btn-sm" onclick="saveAiSettings()">
                <i data-feather="save" style="width:14px;height:14px;"></i> 保存设置
            </button>
        </div>
        <div class="panel-body">
            <div class="ai-settings-section">
                <div class="ai-settings-field">
                    <label class="ai-settings-label">
                        <input type="checkbox" id="aiEnabled" ${aiSettings.enabled ? 'checked' : ''}>
                        <span>启用 AI 功能</span>
                    </label>
                    <p class="ai-settings-hint">启用后，用户可以在前台使用 AI 对话功能</p>
                </div>

                <div class="ai-settings-field">
                    <label>系统提示词</label>
                    <textarea class="form-input ai-system-prompt" rows="3" placeholder="设置 AI 的行为和角色...">${escapeHtml(aiSettings.systemPrompt)}</textarea>
                </div>
            </div>
                
            <div class="ai-settings-section">
                <div class="ai-settings-section-header">
                    <div class="ai-settings-section-title">AI 模型配置</div>
                    <button class="btn btn-default btn-sm" onclick="editAiModel(-1)">
                        <i data-feather="plus" style="width:14px;height:14px;"></i> 添加模型
                    </button>
                </div>
                <p class="ai-settings-hint" style="margin-bottom:14px;">每种类型的第一个模型即为该类型的默认模型。点击 ★ 可快速设为默认。</p>
                <div class="ai-table-wrap">
                    <table class="ai-model-table">
                        <thead>
                            <tr>
                                <th style="width:30px;"></th>
                                <th>名称</th>
                                <th>模型 ID</th>
                                <th>API 地址</th>
                                <th style="text-align:center;">类型</th>
                                <th style="text-align:center;">默认</th>
                                <th style="width:160px;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="aiModelsTableBody">
                            ${modelsHtml || '<tr><td colspan="7" class="empty-state"><div class="empty-text">暂无模型配置，请点击“添加模型”</div></td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    
    <!-- 模型编辑弹窗 -->
    <div id="aiModelEditOverlay" class="confirm-overlay" style="display:none;">
        <div class="confirm-box ai-model-edit-box">
            <div class="ai-modal-header">
                <div class="confirm-title" id="aiModelEditTitle">编辑模型</div>
                <button class="ai-modal-close" onclick="closeAiModelEdit()" type="button">
                    <i data-feather="x" style="width:18px;height:18px;"></i>
                </button>
            </div>
            <div class="ai-model-edit-body">
                <div class="ai-compact-grid">
                    <div class="ai-model-field">
                        <label>显示名称 <span class="req">*</span></label>
                        <input type="text" class="form-input" id="editModelName" placeholder="我的模型">
                    </div>
                    <div class="ai-model-field">
                        <label>模型 ID <span class="req">*</span></label>
                        <input type="text" class="form-input" id="editModelId" placeholder="my-model">
                    </div>
                    <div class="ai-model-field">
                        <label>模型名称 <span class="req">*</span></label>
                        <input type="text" class="form-input" id="editModelModelName" placeholder="如: agnes-2.0-flash">
                        <small style="font-size:11px;color:#6b7288;">API 服务的模型名，不填将导致请求失败</small>
                    </div>
                    <div class="ai-model-field">
                        <label>描述</label>
                        <input type="text" class="form-input" id="editModelDesc" placeholder="可选">
                    </div>
                    <div class="ai-model-field ai-field-span2">
                        <label>API 地址 <span class="req">*</span></label>
                        <input type="text" class="form-input" id="editModelApiUrl" placeholder="基础URL或完整端点路径均可">
                    </div>
                    <div class="ai-model-field ai-field-span2">
                        <label>API 密钥 <span class="req">*</span></label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <input type="password" class="form-input" id="editModelApiKey" placeholder="sk-..." style="font-family:monospace;flex:1;" onchange="clearApiKeyVisibilityCache(this)">
                            <button type="button" id="toggleApiKeyIcon" class="btn btn-default btn-sm" onclick="toggleApiKeyVisibilityByIcon()" title="切换密钥显示" style="padding:2px 8px;height:34px;display:flex;align-items:center;">
                                <i data-feather="eye" style="width:16px;height:16px;"></i>
                            </button>
                        </div>
                    </div>
                    <div class="ai-model-field">
                        <label>模型类型 <span class="req">*</span></label>
                        <select class="form-input" id="editModelType">
                            <option value="chat">对话 (Chat)</option>
                            <option value="image">图片 (Image)</option>
                            <option value="video">视频 (Video)</option>
                        </select>
                    </div>
                    <div class="ai-model-field">
                        <label>最大 Token</label>
                        <input type="number" class="form-input" id="editModelMaxTokens" value="8192" min="100" max="1000000" step="100">
                    </div>
                    <div class="ai-model-field">
                        <label>温度</label>
                        <input type="number" class="form-input" id="editModelTemperature" value="0.7" min="0" max="2" step="0.1">
                    </div>
                    <div class="ai-model-field ai-field-span2">
                        <button type="button" class="btn btn-primary btn-sm" onclick="testAiModelEdit()" style="width:100%;">测试连接并获取可用模型</button>
                        <div id="editModelTestResult" style="margin-top:8px;font-size:13px;"></div>
                        <div id="editModelSuggestList" style="margin-top:8px;font-size:12px;"></div>
                    </div>
                </div>
            </div>
            <div class="confirm-btns">
                <button class="btn btn-default" onclick="closeAiModelEdit()">取消</button>
                <button class="btn btn-primary" onclick="saveAiModelEdit()">保存</button>
            </div>
        </div>
    </div>`;
    
    refreshFeatherIcons();
    
    // 刷新表格并绑定事件委托（document 级别，不受 DOM 重新渲染影响）
    refreshAiModelsTable();
}

function editAiModel(index) {
    const overlay = document.getElementById('aiModelEditOverlay');
    if (!overlay) return;

    const titleEl = document.getElementById('aiModelEditTitle');
    const nameEl = document.getElementById('editModelName');
    const idEl = document.getElementById('editModelId');
    const modelNameEl = document.getElementById('editModelModelName');
    const descEl = document.getElementById('editModelDesc');
    const apiUrlEl = document.getElementById('editModelApiUrl');
    const apiKeyEl = document.getElementById('editModelApiKey');
    const typeEl = document.getElementById('editModelType');
    const maxTokensEl = document.getElementById('editModelMaxTokens');
    const temperatureEl = document.getElementById('editModelTemperature');

    if (index >= 0 && AdminState.aiSettings && AdminState.aiSettings.models[index]) {
        // 编辑模式
        const model = AdminState.aiSettings.models[index];
        titleEl.textContent = '编辑模型';
        nameEl.value = model.name || '';
        idEl.value = model.id || '';
        modelNameEl.value = model.modelName || '';
        descEl.value = model.desc || '';
        apiUrlEl.value = model.apiUrl || '';
        apiKeyEl.value = model.apiKey || '';
        typeEl.value = model.type || 'chat';
        maxTokensEl.value = model.maxTokens || 8192;
        temperatureEl.value = model.temperature || 0.7;
        overlay.dataset.editIndex = index;
    } else {
        // 添加模式
        titleEl.textContent = '添加模型';
        nameEl.value = '';
        idEl.value = 'model_' + Date.now();
        modelNameEl.value = '';
        descEl.value = '';
        apiUrlEl.value = '';
        apiKeyEl.value = '';
        typeEl.value = 'chat';
        maxTokensEl.value = 8192;
        temperatureEl.value = 0.7;
        overlay.dataset.editIndex = '-1';
    }
    
    // 初始化密钥图标状态：默认显示为闭眼（密码模式）
    const iconBtn = document.getElementById('toggleApiKeyIcon');
    const eyeIcon = iconBtn ? iconBtn.querySelector('i') : null;
    if (eyeIcon) {
        eyeIcon.setAttribute('data-feather', 'eye-off');
    }
    // 确保输入框是密码模式（初始状态）
    apiKeyEl.type = 'password';

    overlay.style.display = 'flex';
    nameEl.focus();
}

function closeAiModelEdit() {
    const overlay = document.getElementById('aiModelEditOverlay');
    if (overlay) overlay.style.display = 'none';
}

// 切换 API 密钥显示/隐藏（图标按钮版本）
function toggleApiKeyVisibilityByIcon() {
    const apiKeyInput = document.getElementById('editModelApiKey');
    const iconBtn = document.getElementById('toggleApiKeyIcon');
    const eyeIcon = iconBtn.querySelector('i');
    
    // 检查当前输入框类型
    const isCurrentlyText = apiKeyInput.type === 'text';
    
    if (isCurrentlyText) {
        // 隐藏：切换为密码模式，显示闭眼图标
        apiKeyInput.type = 'password';
        feather.replace(); // 刷新 feather 图标
        if (eyeIcon) eyeIcon.setAttribute('data-feather', 'eye-off');
    } else {
        // 显示：切换为明文模式，显示睁眼图标
        apiKeyInput.type = 'text';
        feather.replace(); // 刷新 feather 图标
        if (eyeIcon) eyeIcon.setAttribute('data-feather', 'eye');
    }
}

// 清除密钥值缓存（当用户手动修改输入框时）
function clearApiKeyVisibilityCache(input) {
    if (input._originalApiKey) {
        input._originalApiKey = input.value;
    }
}

// 获取 API 密钥值（考虑显示状态）
function getApiKeyWithVisibility() {
    const apiKeyInput = document.getElementById('editModelApiKey');
    
    // 如果当前是明文模式，直接返回当前值
    if (apiKeyInput.type === 'text') {
        return apiKeyInput.value;
    }
    
    // 如果用户曾输入过值，确保在切换回密码模式时不丢失
    if (!apiKeyInput._originalApiKey) {
        apiKeyInput._originalApiKey = apiKeyInput.value;
    }
    
    return apiKeyInput._originalApiKey;
}

async function saveAiModelEdit() {
    const name = document.getElementById('editModelName').value.trim();
    const id = document.getElementById('editModelId').value.trim();
    const modelName = document.getElementById('editModelModelName').value.trim();
    const desc = document.getElementById('editModelDesc').value.trim();
    const apiUrl = document.getElementById('editModelApiUrl').value.trim();
    // 使用考虑显示状态的密钥获取函数
    const apiKey = getApiKeyWithVisibility();
    const type = document.getElementById('editModelType').value || 'chat';
    const maxTokens = parseInt(document.getElementById('editModelMaxTokens').value) || 8192;
    const temperature = parseFloat(document.getElementById('editModelTemperature').value) || 0.7;

    if (!name || !id || !modelName || !apiUrl || !apiKey) {
        showToast('请填写所有必填项', 'error');
        return;
    }

    // 规范化 API URL：仅去除尾部斜杠和剥离已知端点路径，不强制追加 /v1
    let normalizedApiUrl = apiUrl.replace(/\/+$/, '');
    const _knownEndpoints = ['/chat/completions', '/images/generations', '/videos'];
    for (const ep of _knownEndpoints) {
        if (normalizedApiUrl.endsWith(ep)) {
            normalizedApiUrl = normalizedApiUrl.slice(0, -ep.length);
            break;
        }
    }

    const model = { id, name, desc, apiUrl: normalizedApiUrl, apiKey, modelName, type, maxTokens, temperature };
    const overlay = document.getElementById('aiModelEditOverlay');
    const index = parseInt(overlay.dataset.editIndex);
    
    if (!AdminState.aiSettings) {
        AdminState.aiSettings = { enabled: false, models: [], systemPrompt: '', defaultModel: '' };
    }
    if (!AdminState.aiSettings.models) {
        AdminState.aiSettings.models = [];
    }
    
    if (index >= 0) {
        // 备份原始模型用于回滚
        AdminState.aiSettings._backupModel = Object.assign({}, AdminState.aiSettings.models[index]);
        AdminState.aiSettings.models[index] = model;
    } else {
        AdminState.aiSettings.models.push(model);
    }

    // 立即保存到服务器
    try {
        await autoSaveAiModels();
        showToast('模型已' + (index >= 0 ? '更新' : '添加'), 'success');
        closeAiModelEdit();
        refreshAiModelsTable();
    } catch (e) {
        console.error('保存模型失败:', e);
        // 保存失败，回滚内存状态
        if (index >= 0) {
            AdminState.aiSettings.models[index] = AdminState.aiSettings._backupModel;
        } else {
            AdminState.aiSettings.models.pop();
        }
        showToast('网络错误，保存失败', 'error');
    }
}

// 构建模型表格行 HTML
function buildAiModelRows(models, aiSettings) {
    if (!models || models.length === 0) return '';
    const typeMap = { chat: '对话', image: '图片', video: '视频' };
    const typeColor = { chat: '#6366f1', image: '#10b981', video: '#f59e0b' };
    // 计算每种类型的默认模型（该类型的第一个）
    const defaults = {};
    models.forEach(m => {
        const t = m.type || 'chat';
        if (!defaults[t]) defaults[t] = m.id;
    });

    return models.map((model, idx) => {
        const type = model.type || 'chat';
        const typeLabel = typeMap[type] || type;
        const color = typeColor[type] || '#6366f1';
        const isDefault = defaults[type] === model.id;
        return `
        <tr data-index="${idx}" draggable="true">
            <td class="ai-drag-handle" title="拖拽排序">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>
            </td>
            <td>${escapeHtml(model.name)}</td>
            <td><code>${escapeHtml(model.id)}</code></td>
            <td style="font-size:11px;opacity:0.7;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeAttr(model.apiUrl || '-')}">${escapeHtml(model.apiUrl || '-')}</td>
            <td style="text-align:center;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;color:#fff;background:${color};">${escapeHtml(typeLabel)}</span>
            </td>
            <td style="text-align:center;">
                <span class="ai-default-star" data-idx="${idx}" onclick="setAiDefaultModel(${idx})" title="设为${typeLabel}默认模型" style="cursor:pointer;font-size:18px;${isDefault ? 'color:#f59e0b;' : 'color:#d1d5db;'}">★</span>
            </td>
            <td class="ai-table-actions">
                <button type="button" class="btn btn-default btn-sm" onclick="copyAiModel(${idx})" title="复制模型">
                    <i data-feather="copy" style="width:14px;height:14px;"></i>
                </button>
                <button type="button" class="btn btn-default btn-sm" onclick="editAiModel(${idx})" title="编辑">
                    <i data-feather="edit-2" style="width:14px;height:14px;"></i>
                </button>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeAiModel(${idx})" title="删除">
                    <i data-feather="trash-2" style="width:14px;height:14px;"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

// 复制模型
function copyAiModel(index) {
    if (!AdminState.aiSettings || !AdminState.aiSettings.models) return;
    const src = AdminState.aiSettings.models[index];
    if (!src) return;
    const copy = Object.assign({}, src);
    copy.id = src.id + '-copy';
    copy.name = src.name + ' (副本)';
    // 确保 ID 唯一
    const existingIds = new Set(AdminState.aiSettings.models.map(m => m.id));
    let suffix = 2;
    while (existingIds.has(copy.id)) {
        copy.id = src.id + '-copy' + suffix;
        suffix++;
    }
    AdminState.aiSettings.models.splice(index + 1, 0, copy);
    refreshAiModelsTable();
    showToast('模型已复制', 'success');
    autoSaveAiModels();
}

// 设置默认模型（将模型移到同类型的第一位）
function setAiDefaultModel(index) {
    if (!AdminState.aiSettings || !AdminState.aiSettings.models) return;
    const models = AdminState.aiSettings.models;
    const model = models[index];
    if (!model) return;
    const type = model.type || 'chat';
    const firstOfTypeIdx = models.findIndex(m => (m.type || 'chat') === type);
    if (firstOfTypeIdx === index) {
        showToast('已经是默认模型', 'info');
        return;
    }
    models.splice(index, 1);
    models.splice(firstOfTypeIdx, 0, model);
    refreshAiModelsTable();
    const typeLabel = type === 'chat' ? '对话' : type === 'image' ? '图片' : '视频';
    showToast(`已将「${model.name}」设为${typeLabel}默认模型`, 'success');
    autoSaveAiModels();
}

// 初始化表格行拖拽排序
function initAiModelDrag() {
    const tbody = document.getElementById('aiModelsTableBody');
    if (!tbody) return;
    let dragRow = null;

    tbody.addEventListener('dragstart', function(e) {
        const row = e.target.closest('tr[draggable]');
        if (!row) return;
        dragRow = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    tbody.addEventListener('dragend', function(e) {
        if (dragRow) dragRow.classList.remove('dragging');
        tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        dragRow = null;
        // 根据 DOM 顺序更新内存状态
        const rows = tbody.querySelectorAll('tr[data-index]');
        if (rows.length > 0 && AdminState.aiSettings && AdminState.aiSettings.models) {
            const newOrder = [];
            rows.forEach(row => {
                const idx = parseInt(row.dataset.index);
                if (AdminState.aiSettings.models[idx]) {
                    newOrder.push(AdminState.aiSettings.models[idx]);
                }
            });
            AdminState.aiSettings.models = newOrder;
            refreshAiModelsTable();
            autoSaveAiModels();
        }
    });

    tbody.addEventListener('dragover', function(e) {
        e.preventDefault();
        const row = e.target.closest('tr[draggable]');
        if (!row || row === dragRow) return;
        tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
            row.classList.add('drag-over-top');
        } else {
            row.classList.add('drag-over-bottom');
        }
    });

    tbody.addEventListener('drop', function(e) {
        e.preventDefault();
        const row = e.target.closest('tr[draggable]');
        if (!row || !dragRow || row === dragRow) return;
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
            tbody.insertBefore(dragRow, row);
        } else {
            tbody.insertBefore(dragRow, row.nextSibling);
        }
    });
}

function refreshAiModelsTable() {
    const tbody = document.getElementById('aiModelsTableBody');
    if (!tbody || !AdminState.aiSettings) return;
    
    const models = AdminState.aiSettings.models || [];
    tbody.innerHTML = buildAiModelRows(models, AdminState.aiSettings) || '<tr><td colspan="7" class="empty-state"><div class="empty-text">暂无模型配置，请点击“添加模型”</div></td></tr>';
    refreshFeatherIcons();
    initAiModelDrag();
    
    // 事件委托绑定测试按钮
    if (!window.__aiTestBound) {
        window.__aiTestBound = true;
        document.addEventListener('click', async function(e) {
            const testEl = e.target.closest('.ai-test-status');
            if (testEl) {
                const idx = parseInt(testEl.dataset.idx);
                await testAiModelConnection(idx, testEl);
            }
        });
    }
}

async function testAiModelConnection(index, statusEl) {
    if (!AdminState.aiSettings || !AdminState.aiSettings.models) return;
    const model = AdminState.aiSettings.models[index];
    if (!model) return;
    
    statusEl.textContent = '测试中...';
    statusEl.style.color = '#f59e0b';
    
    try {
        const res = await apiFetch('testAiModel', {
            method: 'POST',
            body: JSON.stringify({
                apiUrl: model.apiUrl,
                apiKey: model.apiKey
            })
        });
        const data = await res.json();
        
        if (data.success && data.connected) {
            statusEl.textContent = '连接成功';
            statusEl.style.color = '#10b981';
            
            let tips = [];
            let detectedModels = [];
            
            if (data.models && data.models.length > 0) {
                detectedModels = data.models;
                // 保存检测到的可用模型列表
                if (!AdminState.aiSettings.modelDetections) {
                    AdminState.aiSettings.modelDetections = {};
                }
                AdminState.aiSettings.modelDetections[model.id] = {
                    models: detectedModels,
                    timestamp: Date.now()
                };
                tips.push('模型:' + detectedModels.map(m => m.id).join(','));
            }
            
            // 更新所有模型提示
            statusEl.title = tips.join(' | ');
            showToast('AI 服务连接正常', 'success');
        } else {
            statusEl.textContent = '连接失败';
            statusEl.style.color = '#ef4444';
            let errMsg = '';
            if (data.error) errMsg = data.error;
            statusEl.title = errMsg || '未知错误';
            showToast('连接失败：' + (errMsg || '未知错误'), 'error');
        }
    } catch (err) {
        statusEl.textContent = '网络错误';
        statusEl.style.color = '#ef4444';
        statusEl.title = err.message;
        showToast('请求失败：' + err.message, 'error');
    }
}

async function testAiModelEdit() {
    const resultDiv = document.getElementById('editModelTestResult');
    const suggestDiv = document.getElementById('editModelSuggestList');
    const apiUrl = document.getElementById('editModelApiUrl').value.trim();
    // 使用考虑显示状态的密钥获取函数
    const apiKey = getApiKeyWithVisibility();
    
    if (!apiUrl || !apiKey) {
        resultDiv.innerHTML = '<span style="color:#ef4444;">请先填写 API 地址和密钥</span>';
        return;
    }
    
    resultDiv.innerHTML = '<span style="color:#f59e0b;">测试中...</span>';
    suggestDiv.innerHTML = '';
    
    try {
        const res = await apiFetch('testAiModel', {
            method: 'POST',
            body: JSON.stringify({ apiUrl, apiKey })
        });
        const data = await res.json();
        
        if (data.success && data.connected) {
            resultDiv.innerHTML = '<span style="color:#10b981;">连接成功！</span>';
            
            if (data.models && data.models.length > 0) {
                // 过滤出常见的对话/生图/生视频模型
                const chatModels = data.models.filter(m => 
                    ['chat', 'completion', 'gpt', 'claude', 'mistral', 'llama', 'qwen', 'glm'].some(k => 
                        m.id.toLowerCase().includes(k)
                    )
                ).map(m => m.id);
                
                const imageModels = data.models.filter(m =>
                    ['image', 'dall', 'flux', 'midjourney'].some(k =>
                        m.id.toLowerCase().includes(k)
                    )
                ).map(m => m.id);
                
                let suggestHtml = '';
                if (chatModels.length > 0 || imageModels.length > 0) {
                    suggestHtml += '<div style="color:#64748b;margin-top:4px;">';
                    if (chatModels.length > 0) {
                        suggestHtml += `<div><strong style="color:#3b82f6;">对话模型：</strong>${chatModels.join(', ')}</div>`;
                    }
                    if (imageModels.length > 0) {
                        suggestHtml += `<div><strong style="color:#8b5cf6;">生图模型：</strong>${imageModels.join(', ')}</div>`;
                    }
                    suggestHtml += '</div>';
                } else {
                    suggestHtml = '可用模型：' + data.models.map(m => m.id).join(', ');
                }
                suggestDiv.innerHTML = suggestHtml;
            } else {
                resultDiv.innerHTML = '<span style="color:#10b981;">连接成功！</span><br><span style="color:#f59e0b;font-size:12px;">API 连通，但未获取到模型列表。</span>';
            }
            showToast('AI 服务连接正常', 'success');
        } else {
            let errMsg = '';
            if (data.error) errMsg = data.error;
            resultDiv.innerHTML = '<span style="color:#ef4444;">连接失败：' + (errMsg || '未知错误') + '</span>';
            showToast('连接失败：' + (errMsg || '未知错误'), 'error');
        }
    } catch (err) {
        resultDiv.innerHTML = '<span style="color:#ef4444;">网络错误：' + err.message + '</span>';
        showToast('请求失败：' + err.message, 'error');
    }
}

/* ========== AI 后台任务管理 ========== */
async function renderAiTasks(targetContainer) {
    const container = targetContainer || document.getElementById('adminContent');
    container.innerHTML = `
        <div class="ai-task-panel">
            <div class="ai-task-toolbar">
                <button class="btn btn-default btn-sm" onclick="loadAiTasks()" id="aiTaskRefreshBtn">
                    <i data-feather="refresh-cw" style="width:14px;height:14px;"></i> 刷新列表
                </button>
                <span class="ai-task-count" id="aiTaskCount">加载中...</span>
                <div class="ai-task-filters">
                    <select id="aiTaskFilterType" onchange="filterAiTasks()">
                        <option value="all">全部类型</option>
                        <option value="image">图片生成</option>
                        <option value="video">视频生成</option>
                    </select>
                    <select id="aiTaskFilterStatus" onchange="filterAiTasks()">
                        <option value="all">全部状态</option>
                        <option value="pending">等待中</option>
                        <option value="processing">处理中</option>
                        <option value="polling">生成中</option>
                        <option value="completed">已完成</option>
                        <option value="failed">失败</option>
                    </select>
                </div>
            </div>
            <div class="ai-task-table-wrap">
                <table class="ai-task-table" id="aiTaskTable">
                    <thead>
                        <tr>
                            <th style="width:100px;">任务 ID</th>
                            <th style="width:80px;">类型</th>
                            <th style="width:90px;">状态</th>
                            <th>提示词</th>
                            <th style="width:100px;">进度</th>
                            <th style="width:120px;">开始时间</th>
                            <th style="width:120px;">结束时间</th>
                            <th style="width:80px;">耗时</th>
                            <th style="width:260px;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="aiTaskTableBody">
                        <tr><td colspan="9" style="text-align:center;padding:60px;color:#94a3b8;">点击"刷新列表"加载任务数据</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    loadAiTasks();
}

let _aiTaskAllData = [];
let _aiTaskFilteredData = [];

async function loadAiTasks() {
    const tbody = document.getElementById('aiTaskTableBody');
    const btn = document.getElementById('aiTaskRefreshBtn');
    const countEl = document.getElementById('aiTaskCount');
    if (!tbody) return;

    btn.disabled = true;
    btn.innerHTML = '<i data-feather="loader" style="width:14px;height:14px;animation:spin 1s linear infinite;"></i> 加载中...';
    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();

    try {
        const res = await apiFetch('aiTaskList');
        const data = await res.json();
        
        if (!data.success || !data.tasks) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#ef4444;">加载失败</td></tr>';
            countEl.textContent = '加载失败';
            return;
        }

        _aiTaskAllData = data.tasks || [];
        filterAiTasks();
        countEl.textContent = '共 ' + (typeof data.count === 'number' ? data.count : _aiTaskAllData.length) + ' 条任务';
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#ef4444;">网络错误：' + escapeHtml(e.message) + '</td></tr>';
        countEl.textContent = '加载失败';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-feather="refresh-cw" style="width:14px;height:14px;"></i> 刷新列表';
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }
}

function filterAiTasks() {
    const typeFilter = document.getElementById('aiTaskFilterType').value;
    const statusFilter = document.getElementById('aiTaskFilterStatus').value;

    _aiTaskFilteredData = _aiTaskAllData.filter(function(task) {
        if (typeFilter !== 'all' && task.type !== typeFilter) return false;
        if (statusFilter !== 'all' && task.status !== statusFilter) return false;
        return true;
    });

    renderAiTaskTable();
}

function renderAiTaskTable() {
    const tbody = document.getElementById('aiTaskTableBody');
    if (!tbody) return;

    if (_aiTaskFilteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8;">暂无匹配的任务数据</td></tr>';
        return;
    }

    var html = '';
    for (var i = 0; i < _aiTaskFilteredData.length; i++) {
        var t = _aiTaskFilteredData[i];
        var typeLabel = t.type === 'video' ? '视频' : '图片';
        var typeClass = t.type === 'video' ? 'type-video' : 'type-image';
        var statusLabel = getTaskStatusLabel(t.status);
        var statusClass = 'status-' + t.status;
        var isFailed = t.status === 'failed';
        if (isFailed) {
            statusClass += ' status-failed-highlight';
        }
        
        // 格式化时间
        var startTime = formatTaskTimestamp(t.startTime);
        var endTime = formatTaskTimestamp(t.endTime);
        var duration = calculateDuration(t.startTime, t.endTime);

        // 进度条
        var progressHtml = '-';
        if ((t.status === 'processing' || t.status === 'polling') && t.data) {
            var pct = 0;
            if (t.data.progress && !isNaN(t.data.progress)) {
                pct = Math.min(100, parseInt(t.data.progress, 10));
            }
            progressHtml = '<div class="task-progress-wrap"><div class="task-progress-bar" style="width:' + pct + '%"></div></div><span class="task-progress-text">' + pct + '%</span>';
        } else if (t.status === 'completed') {
            progressHtml = '<span style="color:#22c55e;">100%</span>';
        }

        // 操作按钮
        var actionsHtml = '';
        actionsHtml += '<button class="btn btn-primary btn-xs" onclick="showTaskDetail(\'' + escapeAttr(t.taskId) + '\')" title="查看详情"><i data-feather="info" style="width:14px;height:14px;"></i> 详情</button>';
        if (t.status === 'pending' || t.status === 'processing' || t.status === 'polling') {
            actionsHtml += '<button class="btn btn-danger btn-xs" onclick="cancelAiTask(\'' + escapeAttr(t.taskId) + '\')" title="终止任务"><i data-feather="square" style="width:14px;height:14px;"></i> 终止</button>';
        }
        if (t.status === 'completed' && t.data) {
            var resultData = t.data;
            if (t.type === 'image' && resultData.images && resultData.images.length > 0) {
                for (var j = 0; j < resultData.images.length; j++) {
                    var imgUrl = resultData.images[j].url || resultData.images[j].b64 || '';
                    if (imgUrl) {
                        var imgLink = imgUrl.startsWith('http') ? imgUrl : '../' + imgUrl;
                        actionsHtml += '<a href="' + imgLink + '" target="_blank" class="btn btn-default btn-xs" title="查看图片"><i data-feather="eye" style="width:14px;height:14px;"></i> 查看</a>';
                        break;
                    }
                }
            } else if (t.type === 'video' && resultData.videoUrl) {
                var videoLink = resultData.videoUrl.startsWith('http') ? resultData.videoUrl : '../' + resultData.videoUrl;
                actionsHtml += '<a href="' + videoLink + '" target="_blank" class="btn btn-default btn-xs" title="播放视频"><i data-feather="play-circle" style="width:14px;height:14px;"></i> 播放</a>';
            }
        }
        actionsHtml += '<button class="btn btn-default btn-xs" onclick="deleteAiTask(\'' + escapeAttr(t.taskId) + '\')" title="删除任务" style="color:#ef4444;border-color:#fecaca;"><i data-feather="trash-2" style="width:14px;height:14px;"></i> 删除</button>';

        var rowClass = isFailed ? ' failed' : '';

        // 提示词显示
        var promptDisplay = '';
        var promptTitle = '';
        if (t.data && t.data.prompt) {
            var promptText = t.data.prompt;
            promptTitle = escapeAttr(promptText);
            promptDisplay = '<div class="task-prompt-display" title="' + promptTitle + '">' + escapeHtml(promptText.substring(0, 150)) + (promptText.length > 150 ? '...' : '') + '</div>';
        } else {
            promptDisplay = '<span class="task-empty">-</span>';
        }

        html += '<tr class="' + rowClass + '">' +
            '<td style="white-space:nowrap;"><code style="font-size:13px;">' + escapeHtml(t.taskId.substring(0, 24)) + (t.taskId.length > 24 ? '...' : '') + '</code></td>' +
            '<td style="white-space:nowrap;"><span class="type-badge ' + typeClass + '">' + typeLabel + '</span></td>' +
            '<td style="white-space:nowrap;"><span class="' + statusClass + '">' + statusLabel + '</span></td>' +
            '<td title="' + promptTitle + '">' + promptDisplay + '</td>' +
            '<td style="white-space:nowrap;">' + progressHtml + '</td>' +
            '<td style="white-space:nowrap;font-size:13px;color:var(--t2);">' + startTime + '</td>' +
            '<td style="white-space:nowrap;font-size:13px;color:var(--t2);">' + (endTime || '-') + '</td>' +
            '<td style="white-space:nowrap;font-size:13px;color:var(--t1);font-weight:500;">' + duration + '</td>' +
            '<td><div class="task-actions">' + (actionsHtml || '<span class="task-empty">-</span>') + '</div></td>' +
        '</tr>';
    }

    tbody.innerHTML = html;
    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
}

function showTaskDetail(taskId) {
    var task = null;
    for (var i = 0; i < _aiTaskAllData.length; i++) {
        if (_aiTaskAllData[i].taskId === taskId) {
            task = _aiTaskAllData[i];
            break;
        }
    }
    if (!task) {
        openModal('任务详情', '<p style="color:#ef4444;font-size:14px;">未找到该任务</p>');
        return;
    }

    var html = '<div class="task-detail-content">';
    
    // 基本信息
    html += '<div class="task-detail-section">';
    html += '<h3 class="task-detail-title"><i data-feather="info" style="width:16px;height:16px;margin-right:6px;"></i>基本信息</h3>';
    html += '<div class="task-detail-grid">';
    html += '<div class="task-detail-row"><span class="task-detail-label">任务ID</span><code class="task-detail-value">' + escapeHtml(task.taskId) + '</code></div>';
    html += '<div class="task-detail-row"><span class="task-detail-label">类型</span><span class="task-detail-value type-badge ' + (task.type === 'video' ? 'type-video' : 'type-image') + '">' + (task.type === 'video' ? '视频生成' : '图片生成') + '</span></div>';
    html += '<div class="task-detail-row"><span class="task-detail-label">状态</span><span class="task-detail-value ' + (task.status || '') + '">' + getTaskStatusLabel(task.status) + '</span></div>';
    html += '<div class="task-detail-row"><span class="task-detail-label">开始时间</span><span class="task-detail-value">' + formatTaskTimestamp(task.startTime) + '</span></div>';
    html += '<div class="task-detail-row"><span class="task-detail-label">结束时间</span><span class="task-detail-value">' + formatTaskTimestamp(task.endTime) + '</span></div>';
    html += '<div class="task-detail-row"><span class="task-detail-label">耗时</span><span class="task-detail-value">' + calculateDuration(task.startTime, task.endTime) + '</span></div>';
    if (task.data && task.data.modelName) {
        html += '<div class="task-detail-row"><span class="task-detail-label">使用模型</span><span class="task-detail-value">' + escapeHtml(task.data.modelName) + '</span></div>';
    }
    html += '</div></div>';

    // 提示词
    if (task.data && task.data.prompt) {
        html += '<div class="task-detail-section">';
        html += '<h3 class="task-detail-title"><i data-feather="file-text" style="width:16px;height:16px;margin-right:6px;"></i>提示词</h3>';
        html += '<div class="task-detail-prompt">' + escapeHtml(task.data.prompt) + '</div>';
        html += '</div>';
    }

    // 生成过程日志 - data 中所有额外信息
    if (task.data) {
        var logEntries = [];
        var extraData = {};
        
        // 收集所有日志/步骤信息
        if (task.data.logs && Array.isArray(task.data.logs)) {
            logEntries = task.data.logs;
        } else if (task.data.steps && Array.isArray(task.data.steps)) {
            logEntries = task.data.steps;
        } else if (task.data.processLog && typeof task.data.processLog === 'string') {
            logEntries = [task.data.processLog];
        } else if (task.data.message) {
            logEntries = [task.data.message];
        }
        
        // 收集其他非标准字段作为额外数据
        var standardFields = ['prompt', 'images', 'videoUrl', 'progress', 'error', 'logs', 'steps', 'processLog', 'message', 'httpCode', 'modelId', 'modelName', 'videoId', 'imageUrl'];
        for (var key in task.data) {
            if (task.data.hasOwnProperty(key)) {
                var isStandard = standardFields.indexOf(key) >= 0;
                if (!isStandard && task.data[key] !== null && task.data[key] !== undefined) {
                    extraData[key] = task.data[key];
                }
            }
        }

        // 显示进度
        if (task.data.progress !== undefined && task.data.progress !== null) {
            html += '<div class="task-detail-section">';
            html += '<h3 class="task-detail-title"><i data-feather="activity" style="width:16px;height:16px;margin-right:6px;"></i>进度</h3>';
            html += '<div class="task-detail-progress"><div class="task-detail-progress-bar" style="width:' + task.data.progress + '%"></div></div>';
            html += '<div class="task-detail-progress-text">' + task.data.progress + '%</div>';
            html += '</div>';
        }

        // 显示日志
        if (logEntries.length > 0) {
            html += '<div class="task-detail-section">';
            html += '<h3 class="task-detail-title"><i data-feather="list" style="width:16px;height:16px;margin-right:6px;"></i>生成过程日志</h3>';
            html += '<div class="task-detail-logs">';
            for (var l = 0; l < logEntries.length; l++) {
                var entry = logEntries[l];
                if (typeof entry === 'string') {
                    html += '<div class="task-detail-log-item">' + escapeHtml(entry) + '</div>';
                } else if (entry && typeof entry === 'object') {
                    var timeStr = entry.time || entry.timestamp || '';
                    var msgStr = entry.message || entry.msg || entry.content || JSON.stringify(entry);
                    html += '<div class="task-detail-log-item"><span class="task-detail-log-time">[' + escapeHtml(timeStr) + ']</span> ' + escapeHtml(msgStr) + '</div>';
                }
            }
            html += '</div></div>';
        } else if (Object.keys(extraData).length > 0) {
            // 显示额外数据
            html += '<div class="task-detail-section">';
            html += '<h3 class="task-detail-title"><i data-feather="database" style="width:16px;height:16px;margin-right:6px;"></i>详细信息</h3>';
            html += '<div class="task-detail-logs">';
            for (var eKey in extraData) {
                if (extraData.hasOwnProperty(eKey)) {
                    var eVal = extraData[eKey];
                    if (typeof eVal === 'string') {
                        html += '<div class="task-detail-log-item"><strong>' + escapeHtml(eKey) + ':</strong> ' + escapeHtml(eVal) + '</div>';
                    } else {
                        html += '<div class="task-detail-log-item"><strong>' + escapeHtml(eKey) + ':</strong> ' + escapeHtml(JSON.stringify(eVal)) + '</div>';
                    }
                }
            }
            html += '</div></div>';
        }
    }

    // 错误信息
    if (task.status === 'failed' && task.data && task.data.error) {
        html += '<div class="task-detail-section task-detail-error">';
        html += '<h3 class="task-detail-title"><i data-feather="alert-triangle" style="width:16px;height:16px;margin-right:6px;"></i>错误信息</h3>';
        html += '<div class="task-detail-error-text">' + escapeHtml(task.data.error) + '</div>';
        html += '</div>';
    }

    // 结果展示
    if (task.status === 'completed' && task.data) {
        if (task.type === 'image' && task.data.images && task.data.images.length > 0) {
            html += '<div class="task-detail-section">';
            html += '<h3 class="task-detail-title"><i data-feather="image" style="width:16px;height:16px;margin-right:6px;"></i>生成结果 (' + task.data.images.length + ' 张)</h3>';
            html += '<div class="task-detail-images">';
            for (var r = 0; r < task.data.images.length; r++) {
                var imgUrl = task.data.images[r].url || task.data.images[r].b64 || '';
                if (imgUrl) {
                    var imgSrc = imgUrl.startsWith('http') ? imgUrl : '../' + imgUrl;
                    html += '<a href="' + imgSrc + '" target="_blank" class="task-detail-image-item"><img src="' + imgSrc + '" /></a>';
                }
            }
            html += '</div></div>';
        } else if (task.type === 'video' && task.data.videoUrl) {
            html += '<div class="task-detail-section">';
            html += '<h3 class="task-detail-title"><i data-feather="video" style="width:16px;height:16px;margin-right:6px;"></i>生成结果</h3>';
            var videoSrc = task.data.videoUrl.startsWith('http') ? task.data.videoUrl : '../' + task.data.videoUrl;
            html += '<div class="task-detail-video-wrap"><video src="' + videoSrc + '" controls></video></div>';
            html += '</div>';
        }
    }

    html += '</div>';
    openModal('<i data-feather="info" style="width:16px;height:16px;vertical-align:middle;"></i> 任务详情', html, '<button class="btn btn-default" onclick="closeModal()">关闭</button>');
    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
}

async function cancelAiTask(taskId) {
    if (!confirm('确定要终止任务 ' + taskId + ' 吗？')) return;

    try {
        var res = await adminApiFetch('aiCancelTask?taskId=' + encodeURIComponent(taskId));
        var data = await res.json();
        if (data.success) {
            showToast('任务已终止', 'success');
            loadAiTasks();
        } else {
            showToast(data.error || '终止任务失败', 'error');
        }
    } catch (e) {
        showToast('网络错误：' + (e.message || e), 'error');
    }
}

async function deleteAiTask(taskId) {
    if (!confirm('确定要删除任务 ' + taskId + ' 吗？\n删除后将无法恢复任务记录。')) return;

    try {
        var res = await adminApiFetch('aiDeleteTask?taskId=' + encodeURIComponent(taskId));
        var data = await res.json();
        if (data.success) {
            showToast('任务已删除', 'success');
            loadAiTasks();
        } else {
            showToast(data.error || '删除任务失败', 'error');
        }
    } catch (e) {
        showToast('网络错误：' + (e.message || e), 'error');
    }
}

function getTaskStatusLabel(status) {
    switch (status) {
        case 'pending': return '等待中';
        case 'processing': return '处理中';
        case 'polling': return '生成中';
        case 'completed': return '已完成';
        case 'failed': return '失败';
        default: return status;
    }
}

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

function formatTaskTimestamp(ts) {
    if (!ts) return '-';
    var d = new Date(ts * 1000);
    var Y = d.getFullYear();
    var M = pad2(d.getMonth() + 1);
    var D = pad2(d.getDate());
    var h = pad2(d.getHours());
    var m = pad2(d.getMinutes());
    var s = pad2(d.getSeconds());
    return Y + '-' + M + '-' + D + ' ' + h + ':' + m + ':' + s;
}

function calculateDuration(startTs, endTs) {
    if (!startTs) return '-';
    var end = endTs || Math.floor(Date.now() / 1000);
    var diff = end - startTs;
    if (diff < 0) return '-';
    if (diff < 60) return diff + '秒';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟';
    return Math.floor(diff / 3600) + '小时' + Math.floor((diff % 3600) / 60) + '分钟';
}

// escapeAttr 已迁移至 js/shared-utils.js（前后台共享）

function removeAiModel(index) {
    if (!AdminState.aiSettings || !AdminState.aiSettings.models) return;
    AdminState.aiSettings.models.splice(index, 1);
    refreshAiModelsTable();
    autoSaveAiModels();
    showToast('模型已删除', 'success');
}

// 自动保存模型配置到服务器（所有模型操作后调用）
async function autoSaveAiModels() {
    if (!AdminState.aiSettings) return;
    const models = AdminState.aiSettings.models || [];
    const defaults = {};
    for (const m of models) { const t = m.type || 'chat'; if (!defaults[t]) defaults[t] = m.id; }
    const settings = {
        enabled: AdminState.aiSettings.enabled || false,
        systemPrompt: AdminState.aiSettings.systemPrompt || '',
        models,
        defaultModel: defaults.chat || '',
        defaultImageModel: defaults.image || '',
        defaultVideoModel: defaults.video || '',
        modelDetections: AdminState.aiSettings.modelDetections || {}
    };
    try {
        const token = await ensureCsrf();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-CSRF-Token'] = token;
        const r = await fetch('../api.php?action=saveAiSettings', {
            method: 'POST', headers,
            body: JSON.stringify({ settings })
        });
        const j = await r.json();
        if (!j.success) console.warn('[AI] 自动保存失败:', j.error);
    } catch (e) {
        console.warn('[AI] 自动保存异常:', e);
    }
}

async function saveAiSettings() {
    const enabled = document.getElementById('aiEnabled').checked;
    const systemPrompt = document.querySelector('.ai-system-prompt').value;
    
    // 更新内存状态
    if (AdminState.aiSettings) {
        AdminState.aiSettings.enabled = enabled;
        AdminState.aiSettings.systemPrompt = systemPrompt;
    }
    
    // 保存完整设置（包含当前模型配置）
    await autoSaveAiModels();
    showToast('AI 设置已保存', 'success');
}


