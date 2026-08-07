'use strict';

// ========== AI Init Module ==========
// Initialization, auth check, model management, mode switching.

(function () {
    var S = window._aiShared;
    var getEl = window._aiGetEl;
    var getDefaultModels = window._aiGetDefaultModels;
    var loadChatHistoryFromStorage = window._aiLoadChatHistoryFromStorage;
    var saveChatHistoryToStorage = window._aiSaveChatHistoryToStorage;
    var loadStreamingFromStorage = window._aiLoadStreamingFromStorage;
    var clearStreamingFromStorage = window._aiClearStreamingFromStorage;
    var loadGenHistory = window._aiLoadGenHistory;
    var createMessageElement = window._aiCreateMessageElement;
    var hideWelcomeScreen = window._aiHideWelcomeScreen;
    var showWelcomeScreen = window._aiShowWelcomeScreen;
    var updateWelcomeContent = window._aiUpdateWelcomeContent;
    var updateHeaderSub = window._aiUpdateHeaderSub;
    var setInputEnabled = window._aiSetInputEnabled;
    var updateSendButtonState = window._aiUpdateSendButtonState;
    var isNearBottom = window._aiIsNearBottom;
    var scrollToBottom = window.scrollToBottom;
    var autoResizeTextarea = window.autoResizeTextarea;
    var selectChat = window.selectChat;
    var renderChatList = window.renderChatList;

    // ==================== Auth Gate ====================

    /**
     * 显示 AI 访问门禁（未登录或无权限）
     * @param {string} type - 'login' 需要登录 | 'permission' 无权限
     */
    function showAiAuthGate(type) {
        var gate = getEl('aiAuthGate');
        var app = getEl('aiAppContainer');
        var title = getEl('aiAuthGateTitle');
        var text = getEl('aiAuthGateText');
        var icon = getEl('aiAuthGateIcon');
        if (app) app.style.display = 'none';
        if (gate) gate.style.display = 'flex';
        if (type === 'permission') {
            if (title) title.textContent = '无使用权限';
            if (text) text.textContent = '你的账户没有 AI 功能使用权限，请联系管理员开通。';
            if (icon) icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
        } else {
            if (title) title.textContent = '需要登录';
            if (text) text.textContent = '请先登录账户后使用 AI 功能';
            if (icon) icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        }
    }

    /**
     * 检查 AI 接口返回是否为鉴权错误（会话过期 / 未登录 / 无权限）
     * 若是则显示门禁并返回 true，否则返回 false。
     * @param {object} json - 接口返回的 JSON
     * @returns {boolean} 是否已作为鉴权错误处理
     */
    function handleAiAuthError(json) {
        if (!json) return false;
        if (json.needsPermission) {
            showAiAuthGate('permission');
            return true;
        }
        if (json.needsLogin || json.needsLibraryAuth) {
            showAiAuthGate('login');
            return true;
        }
        return false;
    }

    /**
     * 检查 AI 访问权限：必须账户登录且拥有 ai.use 权限，或允许访客访问且访客有 ai.use 权限
     * @returns {Promise<boolean>} 是否通过权限检查
     */
    async function checkAiAccess() {
        try {
            var response = await fetch('api.php?action=getLibraryAccessStatus');
            if (!response.ok) {
                showAiAuthGate('login');
                return false;
            }
            var result = await response.json();
            if (!result.success) {
                showAiAuthGate('login');
                return false;
            }
            
            // 已登录用户：检查用户权限
            if (result.user) {
                var perms = result.user.permissions || [];
                var role = result.user.role || '';
                var hasAiPermission = role === 'admin' || role === 'role_admin' ||
                    perms.indexOf('*') !== -1 || perms.indexOf('ai.use') !== -1;
                if (!hasAiPermission) {
                    showAiAuthGate('permission');
                    return false;
                }
            } else {
                // 未登录用户：检查是否允许访客访问
                var protectionEnabled = result.protectionEnabled;
                var allowGuestAccess = result.allowGuestAccess;
                
                // 保护关闭或允许访客访问时，检查访客权限
                if (!protectionEnabled || allowGuestAccess) {
                    var guestPerms = result.guestPermissions || [];
                    var hasGuestAiPermission = guestPerms.indexOf('*') !== -1 || guestPerms.indexOf('ai.use') !== -1;
                    if (!hasGuestAiPermission) {
                        showAiAuthGate('permission');
                        return false;
                    }
                } else {
                    // 保护开启且不允许访客访问
                    showAiAuthGate('login');
                    return false;
                }
            }
            // 权限通过：显示主应用
            var gate = getEl('aiAuthGate');
            var app = getEl('aiAppContainer');
            if (gate) gate.style.display = 'none';
            if (app) app.style.display = '';
            return true;
        } catch (e) {
            console.error('AI 权限检查失败:', e);
            showAiAuthGate('login');
            return false;
        }
    }

    // ==================== Model Management ====================

    function getModelsByType(type) {
        return S.aiModels.filter(function (m) {
            // 优先使用模型显式设置的 type
            if (m.type) {
                if (m.type === type) return true;
                // type 已指定且不匹配，排除
                return false;
            }
            // 无 type 字段时，视为通用模型，可用于所有类型
            return true;
        });
    }

    function getCurrentModeModelId() {
        return S.selectedModelByMode[S.aiMode] || '';
    }

    // 切换模式时选择合适的默认模型
    function ensureModeModelSelected(type) {
        var models = getModelsByType(type);
        if (models.length === 0) return null;
        var saved = S.selectedModelByMode[type];
        // 已保存的选择仍有效
        for (var i = 0; i < models.length; i++) {
            if (models[i].id === saved) return saved;
        }
        // 使用后端默认
        var backendDefault = S.backendDefaults[type];
        for (var j = 0; j < models.length; j++) {
            if (models[j].id === backendDefault) {
                S.selectedModelByMode[type] = backendDefault;
                return backendDefault;
            }
        }
        // 回退到第一个
        S.selectedModelByMode[type] = models[0].id;
        return models[0].id;
    }

    window.selectModel = function selectModel(modelId) {
        // 根据当前模式存储选择
        var storeType = S.chatImageMode ? 'image' : S.aiMode;
        S.selectedModelByMode[storeType] = modelId;
        // 对话模式同步 selectedModel（兼容旧逻辑）
        if (storeType === 'chat') S.selectedModel = modelId;

        for (var i = 0; i < S.aiModels.length; i++) {
            if (S.aiModels[i].id === modelId) {
                var nameEl = getEl('aiModelName');
                if (nameEl) nameEl.textContent = S.aiModels[i].name;
                break;
            }
        }
        // 持久化对话模型选择，刷新后仍生效
        if (storeType === 'chat') {
            try {
                localStorage.setItem('cpydes_ai_selected_model', modelId);
            } catch (e) { /* ignore */ }
        }
        // Update dropdown active state
        if (S.els.modelDropdown) {
            var options = S.els.modelDropdown.querySelectorAll('.ai-model-option');
            options.forEach(function (opt) {
                opt.classList.toggle('active', opt.dataset.model === modelId);
            });
        }
        closeModelDropdown();
    };

    function renderModelDropdown() {
        if (!S.els.modelDropdown) return;

        S.els.modelDropdown.innerHTML = '';

        // 按当前模式过滤模型（对话模式下若开启图片生成则显示图片模型）
        var filterType = S.chatImageMode ? 'image' : S.aiMode;
        var currentId = S.chatImageMode ? S.selectedModelByMode.image : getCurrentModeModelId();
        var filteredModels = getModelsByType(filterType);

        // 无对应类型模型时，回退显示全部模型（兼容旧配置）
        if (filteredModels.length === 0 && S.aiMode === 'chat' && !S.chatImageMode) {
            filteredModels = S.aiModels;
        }

        for (var i = 0; i < filteredModels.length; i++) {
            var model = filteredModels[i];
            var option = document.createElement('div');
            option.className = 'ai-model-option' + (model.id === currentId ? ' active' : '');
            option.dataset.model = model.id;

            var radio = document.createElement('div');
            radio.className = 'ai-model-option-radio';

            var info = document.createElement('div');
            info.className = 'ai-model-option-info';

            var nameSpan = document.createElement('div');
            nameSpan.className = 'ai-model-option-name';
            nameSpan.textContent = model.name;

            var descSpan = document.createElement('div');
            descSpan.className = 'ai-model-option-desc';
            descSpan.textContent = model.desc;

            info.appendChild(nameSpan);
            info.appendChild(descSpan);
            option.appendChild(radio);
            option.appendChild(info);

            (function (mdlId) {
                option.addEventListener('click', function () {
                    window.selectModel(mdlId);
                });
            })(model.id);

            S.els.modelDropdown.appendChild(option);
        }

        if (typeof refreshFeatherIcons === 'function') {
            refreshFeatherIcons();
        }
    }

    function openModelDropdown() {
        if (!S.els.modelDropdown) return;
        renderModelDropdown();
        S.els.modelDropdown.style.display = 'block';

        // Close on outside click
        if (S.modelDropdownCloseHandler) {
            document.removeEventListener('click', S.modelDropdownCloseHandler);
        }
        S.modelDropdownCloseHandler = function (e) {
            var headerModel = getEl('aiHeaderModel');
            if (S.els.modelSelector && !S.els.modelSelector.contains(e.target) &&
                S.els.modelDropdown && !S.els.modelDropdown.contains(e.target) &&
                (!headerModel || !headerModel.contains(e.target))) {
                closeModelDropdown();
            }
        };
        document.addEventListener('click', S.modelDropdownCloseHandler);
    }

    function closeModelDropdown() {
        if (S.els.modelDropdown) S.els.modelDropdown.style.display = 'none';
        if (S.modelDropdownCloseHandler) {
            document.removeEventListener('click', S.modelDropdownCloseHandler);
            S.modelDropdownCloseHandler = null;
        }
    }

    // 更新模型选择器显示（名称 + 下拉列表按当前模式过滤）
    function updateModelSelectorDisplay() {
        var type = S.chatImageMode ? 'image' : S.aiMode;
        var models = getModelsByType(type);
        var currentId = S.chatImageMode ? S.selectedModelByMode.image : getCurrentModeModelId();

        // 获取当前模型名称
        var modelName = '无可用模型';
        var found = false;
        for (var i = 0; i < models.length; i++) {
            if (models[i].id === currentId) {
                modelName = models[i].name;
                found = true;
                break;
            }
        }
        if (!found && models.length > 0) {
            modelName = models[0].name;
        }

        // 更新头部模型名称
        if (S.els.modelName) {
            S.els.modelName.textContent = modelName;
        }

        renderModelDropdown();
    }

    async function fetchAvailableModels() {
        // 后端配置的默认模型 ID（优先级低于用户手动选择）
        var backendDefaultModel = 'default';

        // Fetch models from backend API
        try {
            var response = await fetch('api.php?action=getAiSettings', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                var result = await response.json();
                if (result.success && result.settings && result.settings.enabled) {
                    var backendModels = result.settings.models;
                    if (Array.isArray(backendModels) && backendModels.length > 0) {
                        S.aiModels = backendModels;

                        // 保存 modelDetections（包含能力检测结果）
                        var detections = result.settings.modelDetections || {};
                        S.modelDetections = detections;

                        for (var i = 0; i < S.aiModels.length; i++) {
                            var mid = S.aiModels[i].id;
                            if (detections[mid] && detections[mid].capabilities) {
                                // 保存能力检测结果到模型对象上，供 getModelsByType 使用
                                if (!S.aiModels[i].capabilities) {
                                    S.aiModels[i].capabilities = detections[mid].capabilities;
                                }
                            }
                        }
                    } else {
                        S.aiModels = getDefaultModels();
                    }
                    // 记录后端配置的默认模型
                    if (result.settings.defaultModel) {
                        backendDefaultModel = result.settings.defaultModel;
                    }
                    // 记录后端配置的图片/视频默认模型
                    S.backendDefaults.chat = result.settings.defaultModel || '';
                    S.backendDefaults.image = result.settings.defaultImageModel || '';
                    S.backendDefaults.video = result.settings.defaultVideoModel || '';
                } else {
                    // AI 功能未启用或无配置，使用默认模型
                    S.aiModels = getDefaultModels();
                }
            } else {
                S.aiModels = getDefaultModels();
            }
        } catch (e) {
            console.warn('获取 AI 模型列表失败:', e);
            S.aiModels = getDefaultModels();
        }

        // 选择优先级：localStorage 用户选择 > 后端 defaultModel > 第一个模型
        try {
            var savedModel = localStorage.getItem('cpydes_ai_selected_model');
            if (savedModel) {
                var found = false;
                for (var i = 0; i < S.aiModels.length; i++) {
                    if (S.aiModels[i].id === savedModel) {
                        S.selectedModel = savedModel;
                        found = true;
                        break;
                    }
                }
                if (!found) S.selectedModel = S.aiModels[0].id;
            } else {
                // 无用户选择时，使用后端 defaultModel
                var defaultFound = false;
                for (var k = 0; k < S.aiModels.length; k++) {
                    if (S.aiModels[k].id === backendDefaultModel) {
                        S.selectedModel = backendDefaultModel;
                        defaultFound = true;
                        break;
                    }
                }
                if (!defaultFound && S.aiModels.length > 0) {
                    S.selectedModel = S.aiModels[0].id;
                }
            }
        } catch (e) {
            if (S.aiModels.length > 0) S.selectedModel = S.aiModels[0].id;
        }

        // 初始化各模式已选模型
        S.selectedModelByMode.chat = S.selectedModel;
        ensureModeModelSelected('image');
        ensureModeModelSelected('video');

        // Update display name
        var fetchedModelName = '无可用模型';
        for (var j = 0; j < S.aiModels.length; j++) {
            if (S.aiModels[j].id === S.selectedModel) {
                fetchedModelName = S.aiModels[j].name;
                break;
            }
        }
        if (S.els.modelName) {
            S.els.modelName.textContent = fetchedModelName;
        }

        renderModelDropdown();
    }

    // ==================== Mode Switching ====================

    window.switchAiMode = function switchAiMode(mode) {
        if (mode !== 'chat' && mode !== 'image' && mode !== 'video') return;
        if (S.aiMode === mode) return; // 已经是当前模式，无需切换

        // 保存当前模式的对话 ID，以便切回时恢复
        S.lastChatIdByMode[S.aiMode] = S.currentChatId;

        S.aiMode = mode;
        // 对话模式切换时重置图片生成开关
        if (mode !== 'chat') S.chatImageMode = false;

        // 恢复该模式上次的对话 ID
        S.currentChatId = S.lastChatIdByMode[mode] || null;

        // 更新标签激活态
        var tabs = document.querySelectorAll('.ai-input-mode-tab');
        tabs.forEach(function (tab) {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });

        // 隐藏工具栏
        var imageToolbar = getEl('aiImageToolbar');
        var videoToolbar = getEl('aiVideoToolbar');
        var inputEl = getEl('aiInput');
        if (imageToolbar) imageToolbar.style.display = 'none';
        if (videoToolbar) videoToolbar.style.display = 'none';

        // 如果有上次的对话，恢复它；否则显示欢迎屏
        if (S.currentChatId) {
            // 验证该对话仍然存在
            var chatExists = false;
            for (var ci = 0; ci < S.chatHistory.length; ci++) {
                if (S.chatHistory[ci].id === S.currentChatId) {
                    chatExists = true;
                    break;
                }
            }
            if (chatExists) {
                selectChat(S.currentChatId);
            } else {
                S.currentChatId = null;
                S.lastChatIdByMode[mode] = null;
                updateWelcomeContent(mode);
                showWelcomeScreen();
            }
        } else {
            updateWelcomeContent(mode);
            showWelcomeScreen();
        }

        // 根据模式显示工具栏和设置 placeholder
        if (mode === 'chat') {
            if (inputEl) inputEl.placeholder = '有问题，尽管问…';
            S.selectedModel = S.selectedModelByMode.chat || 'default';
        } else if (mode === 'image') {
            if (imageToolbar) imageToolbar.style.display = '';
            if (inputEl) inputEl.placeholder = '描述你想生成的图片...';
        } else if (mode === 'video') {
            if (videoToolbar) videoToolbar.style.display = '';
            if (inputEl) inputEl.placeholder = '描述你想生成的视频...';
        }

        // 选择该模式的模型
        ensureModeModelSelected(mode);
        updateModelSelectorDisplay();

        if (inputEl) {
            inputEl.value = '';
            autoResizeTextarea(inputEl);
            inputEl.focus();
        }
        setInputEnabled(true);
        updateSendButtonState();
        renderChatList();
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    };

    // 对话模式下切换图片生成模式
    window.toggleChatImageMode = function toggleChatImageMode() {
        S.chatImageMode = !S.chatImageMode;
        var inputEl = getEl('aiInput');
        if (S.chatImageMode) {
            // 确保图片模型已选中
            ensureModeModelSelected('image');
            if (inputEl) inputEl.placeholder = '描述你想生成的图片，发送后将显示在对话中...';
        } else {
            if (inputEl) inputEl.placeholder = '有问题，尽管问…';
            // 恢复对话模型选择
            S.selectedModel = S.selectedModelByMode.chat || 'default';
            updateModelSelectorDisplay();
        }
    };

    // ==================== Initialization ====================

    window.initAiChat = async function initAiChat() {
        // 权限检查：必须账户登录且拥有 ai.use 权限
        var hasAccess = await checkAiAccess();
        if (!hasAccess) return;

        // Cache DOM elements
        S.els.messages = getEl('aiMessages');
        S.els.welcome = getEl('aiWelcome');
        S.els.input = getEl('aiInput');
        S.els.sendBtn = getEl('aiSendBtn');
        S.els.stopBtn = getEl('aiStopBtn');
        S.els.inputCounter = getEl('aiInputCounter');
        S.els.sidebar = getEl('aiSidebar');
        S.els.chatList = getEl('chatList');
        S.els.chatListEmpty = getEl('chatListEmpty');
        S.els.modelName = getEl('aiModelName');
        S.els.modelDropdown = getEl('aiModelDropdown');
        S.els.modelSelector = getEl('aiModelSelector');
        S.els.themeIcon = getEl('aiThemeIcon');
        S.els.headerSub = getEl('aiHeaderSub');

        // Load chat history from localStorage
        loadChatHistoryFromStorage();

        // 加载生成历史记录（图片/视频）
        loadGenHistory();

        // 检查是否有页面刷新前正在进行的流式回复
        // 注意：页面刷新后原 fetch 连接已断开，流式实际已结束，仅恢复已接收的部分内容
        var streamRestored = false;
        var persistedStream = loadStreamingFromStorage();
        if (persistedStream && Object.keys(persistedStream).length > 0) {
            for (var chatId in persistedStream) {
                if (persistedStream.hasOwnProperty(chatId) && persistedStream[chatId].content) {
                    // 找到对应的对话记录
                    var restoredChat = null;
                    for (var i = 0; i < S.chatHistory.length; i++) {
                        if (S.chatHistory[i].id === chatId) {
                            restoredChat = S.chatHistory[i];
                            break;
                        }
                    }
                    if (restoredChat) {
                        var partialContent = persistedStream[chatId].content;
                        // 更新已存在的助手占位消息，或追加新消息
                        var lastMsg = restoredChat.messages[restoredChat.messages.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant') {
                            // 已有占位消息，更新内容
                            lastMsg.content = partialContent;
                        } else {
                            // 无占位，追加新消息
                            restoredChat.messages.push({ role: 'assistant', content: partialContent });
                        }
                        restoredChat.updatedAt = new Date().toISOString();
                        saveChatHistoryToStorage();

                        // 恢复为当前对话并渲染
                        S.currentChatId = chatId;
                        S.lastChatIdByMode[S.aiMode] = chatId;
                        hideWelcomeScreen();
                        S.els.messages.innerHTML = '';
                        for (var m = 0; m < restoredChat.messages.length; m++) {
                            var msg = restoredChat.messages[m];
                            var msgEl = createMessageElement(msg.role, msg.content, m);
                            S.els.messages.appendChild(msgEl);
                        }

                        var titleEl = getEl('aiHeaderTitle');
                        if (titleEl) titleEl.textContent = restoredChat.title || '未命名对话';
                        updateHeaderSub(restoredChat.messages.length + ' 条消息 · 已从上次会话恢复');

                        setInputEnabled(true);
                        updateSendButtonState();
                        scrollToBottom();
                        streamRestored = true;
                        break; // 只恢复第一个遗留的流式
                    } else {
                        // 对话已删除，清理孤立的流式数据
                        clearStreamingFromStorage(chatId);
                    }
                }
            }
            // 清空所有遗留的流式数据（流已死）
            try { sessionStorage.removeItem(S.STREAM_STORAGE_KEY); } catch (e) { /* ignore */ }
        }

        // Fetch available models
        fetchAvailableModels();

        // Set up model selector toggle
        if (S.els.modelSelector) {
            S.els.modelSelector.addEventListener('click', function () {
                var isOpen = S.els.modelDropdown && S.els.modelDropdown.style.display !== 'none';
                if (isOpen) {
                    closeModelDropdown();
                } else {
                    openModelDropdown();
                }
            });
        }

        // Refresh feather icons
        if (typeof feather !== 'undefined' && typeof feather.replace === 'function') {
            feather.replace();
        }

        // Show welcome screen initially (only if no stream was restored)
        if (!streamRestored) {
            showWelcomeScreen();
        }
        renderChatList();

        // Auto-resize textarea on focus
        if (S.els.input) {
            S.els.input.addEventListener('focus', function () {
                autoResizeTextarea(S.els.input);
            });
        }

        // Scroll-to-bottom button visibility
        var contentArea = document.querySelector('.ai-content');
        if (contentArea) {
            contentArea.addEventListener('scroll', function () {
                var btn = getEl('aiScrollBottomBtn');
                if (!btn) return;
                if (isNearBottom()) {
                    btn.style.display = 'none';
                } else {
                    btn.style.display = 'flex';
                }
            });
        }
    };

    // Expose internal state for debugging (optional)
    window.__aiChatState = {
        get chatHistory() { return S.chatHistory; },
        get currentChatId() { return S.currentChatId; },
        get isStreaming() { return window._aiIsCurrentChatStreaming(); },
        get streamingChats() { return S.streamingChats; },
        get selectedModel() { return S.selectedModel; },
        get models() { return S.aiModels; }
    };

    // ==================== Expose to other modules ====================

    window._aiShowAiAuthGate = showAiAuthGate;
    window._aiHandleAiAuthError = handleAiAuthError;
    window._aiGetModelsByType = getModelsByType;
    window._aiEnsureModeModelSelected = ensureModeModelSelected;
    window._aiUpdateModelSelectorDisplay = updateModelSelectorDisplay;
})();
