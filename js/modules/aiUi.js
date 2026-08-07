'use strict';

// ========== AI UI Module ==========
// UI utilities: toast, clipboard, scroll, typing indicator, welcome screen,
// input state, sidebar, streaming state, poll management, gen history storage.

(function () {
    var S = window._aiShared;

    // ==================== Utility Helpers ====================

    function pad2(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function generateChatId() {
        var d = new Date();
        return 'chat_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
            + '_' + d.getHours() + pad2(d.getMinutes()) + pad2(d.getSeconds())
            + '_' + Math.random().toString(36).substring(2, 8);
    }

    function getEl(id) {
        return document.getElementById(id);
    }

    function escapeHtml(str) {
        if (typeof str !== 'string') return String(str);
        return str.replace(/[&<>"']/g, function (c) {
            var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return map[c] || c;
        });
    }

    function sanitizeHtml(html) {
        return html;
    }

    // ==================== Clipboard Helper ====================

    function copyTextToClipboard(text) {
        return new Promise(function (resolve) {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(text).then(function () {
                    resolve(true);
                }).catch(function () {
                    _copyWithFallback(text, resolve);
                });
            } else {
                _copyWithFallback(text, resolve);
            }
        });
    }

    function _copyWithFallback(text, resolve) {
        try {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(textarea);
            resolve(ok);
        } catch (e) {
            resolve(false);
        }
    }

    // ==================== Toast ====================

    window.showToast = function showToast(msg, type) {
        type = type || 'info';
        var existing = document.querySelector('.ai-toast');
        if (existing) {
            try { existing.parentNode.removeChild(existing); } catch (e) { /* ignore */ }
        }
        var toast = document.createElement('div');
        toast.className = 'ai-toast';
        toast.textContent = msg;
        if (type === 'error') toast.style.background = '#dc2626';
        if (type === 'success') toast.style.background = '#16a34a';
        document.body.appendChild(toast);
        setTimeout(function () {
            var el = document.querySelector('.ai-toast');
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }, 3000);
    };

    // ==================== Poll Management ====================

    function abortPoll(taskId) {
        var entry = S.pollRegistry[taskId];
        if (!entry) return false;
        try { entry.controller.abort(); } catch (e) { /* ignore */ }
        delete S.pollRegistry[taskId];
        return true;
    }

    function registerPoll(taskId, type) {
        abortPoll(taskId);
        S.pollRegistry[taskId] = {
            controller: typeof AbortController !== 'undefined' ? new AbortController() : null,
            type: type
        };
        return S.pollRegistry[taskId];
    }

    // ==================== Streaming State ====================

    function isChatStreaming(chatId) {
        return S.streamingChats[chatId] && S.streamingChats[chatId].isStreaming;
    }

    function isCurrentChatStreaming() {
        return S.currentChatId && isChatStreaming(S.currentChatId);
    }

    function getChatStreamState(chatId) {
        return S.streamingChats[chatId] || null;
    }

    function setChatStreaming(chatId, isStreaming, abortController) {
        if (isStreaming) {
            S.streamingChats[chatId] = {
                isStreaming: true,
                abortController: abortController || null,
                streamingContent: ''
            };
        } else {
            delete S.streamingChats[chatId];
        }
        updateActionButtonsState();
    }

    function getStreamingChatCount() {
        return Object.keys(S.streamingChats).length;
    }

    function updateActionButtonsState() {
        var streaming = isCurrentChatStreaming();
        var regenBtns = document.querySelectorAll('.ai-regenerate-btn');
        regenBtns.forEach(function(btn) {
            btn.disabled = streaming;
        });
        var suggestionGrid = getEl('aiSuggestionGrid');
        if (suggestionGrid) {
            var suggestionBtns = suggestionGrid.querySelectorAll('button');
            suggestionBtns.forEach(function(btn) {
                btn.disabled = streaming;
            });
        }
    }

    // ==================== Gen History Storage ====================

    function loadGenHistory() {
        try {
            var raw = localStorage.getItem(S.GEN_HISTORY_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                S.imageHistory = Array.isArray(parsed.image) ? parsed.image : [];
                S.videoHistory = Array.isArray(parsed.video) ? parsed.video : [];
            }
        } catch (e) {
            console.error('加载生成历史失败:', e);
            S.imageHistory = [];
            S.videoHistory = [];
        }
    }

    function saveGenHistory() {
        try {
            localStorage.setItem(S.GEN_HISTORY_KEY, JSON.stringify({
                image: S.imageHistory,
                video: S.videoHistory
            }));
        } catch (e) {
            console.error('保存生成历史失败:', e);
        }
    }

    function clearGenHistory() {
        S.imageHistory = [];
        S.videoHistory = [];
        saveGenHistory();
    }

    // ==================== Streaming Storage ====================

    function loadStreamingFromStorage() {
        try {
            var raw = sessionStorage.getItem(S.STREAM_STORAGE_KEY);
            if (raw) {
                return JSON.parse(raw);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function saveStreamingToStorage(chatId, content) {
        try {
            var raw = sessionStorage.getItem(S.STREAM_STORAGE_KEY);
            var data = raw ? JSON.parse(raw) : {};
            data[chatId] = { content: content, timestamp: Date.now() };
            sessionStorage.setItem(S.STREAM_STORAGE_KEY, JSON.stringify(data));
        } catch (e) { /* ignore */ }
    }

    function clearStreamingFromStorage(chatId) {
        try {
            var raw = sessionStorage.getItem(S.STREAM_STORAGE_KEY);
            if (!raw) return;
            var data = JSON.parse(raw);
            if (data[chatId]) {
                delete data[chatId];
                sessionStorage.setItem(S.STREAM_STORAGE_KEY, JSON.stringify(data));
            }
        } catch (e) { /* ignore */ }
    }

    // ==================== Auto Scroll ====================

    function scrollToBottom() {
        requestAnimationFrame(function () {
            var container = document.querySelector('.ai-content');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
            var btn = getEl('aiScrollBottomBtn');
            if (btn) btn.style.display = 'none';
        });
    }

    function isNearBottom() {
        var container = document.querySelector('.ai-content');
        if (!container) return true;
        return (container.scrollHeight - container.scrollTop - container.clientHeight) <= S.SCROLL_NEAR_THRESHOLD;
    }

    function scrollToBottomIfNear() {
        if (isNearBottom()) {
            scrollToBottom();
        }
    }

    // ==================== Typing Indicator ====================

    function showTypingIndicator() {
        var indicator = document.createElement('div');
        indicator.className = 'ai-message assistant';
        indicator.id = 'ai-typing-indicator';

        var avatar = document.createElement('div');
        avatar.className = 'ai-msg-avatar ai-msg-avatar-bot';
        avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';
        indicator.appendChild(avatar);

        var bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'ai-msg-bubble-wrap';
        var bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble';

        var dots = document.createElement('div');
        dots.className = 'ai-typing-indicator';
        dots.innerHTML = '<span></span><span></span><span></span>';

        bubble.appendChild(dots);
        bubbleWrap.appendChild(bubble);
        indicator.appendChild(bubbleWrap);

        S.els.messages.appendChild(indicator);
        scrollToBottom();
        return indicator;
    }

    function removeTypingIndicator() {
        var el = document.getElementById('ai-typing-indicator');
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    // ==================== UI State Management ====================

    function hideWelcomeScreen() {
        var welcome = S.els.welcome || getEl('aiWelcome');
        var messages = S.els.messages || getEl('aiMessages');
        if (welcome) welcome.style.display = 'none';
        if (messages) messages.style.display = 'flex';
    }

    function showMessagePanel() {
        var welcome = S.els.welcome || getEl('aiWelcome');
        var messages = S.els.messages || getEl('aiMessages');
        if (welcome) welcome.style.display = 'none';
        if (messages) messages.style.display = 'flex';
    }

    function showWelcomeScreen() {
        if (S.els.welcome) S.els.welcome.style.display = '';
        if (S.els.messages) S.els.messages.style.display = 'none';
        S.els.messages.innerHTML = '';
        var titleEl = getEl('aiHeaderTitle');
        if (S.aiMode === 'image') {
            if (titleEl) titleEl.textContent = 'AI 图像生成';
            updateHeaderSub('输入描述，生成高质量图片');
        } else if (S.aiMode === 'video') {
            if (titleEl) titleEl.textContent = 'AI 视频生成';
            updateHeaderSub('输入描述，生成创意视频');
        } else {
            if (titleEl) titleEl.textContent = 'AI 智能对话';
            updateHeaderSub('有什么可以帮助你的吗？');
        }
    }

    function updateWelcomeContent(mode) {
        var h1El = null;
        var pEl = null;
        var suggestionGrid = null;
        if (S.els.welcome) {
            var headings = S.els.welcome.querySelectorAll('h1');
            if (headings.length > 0) h1El = headings[0];
            var paras = S.els.welcome.querySelectorAll('p');
            if (paras.length > 0) pEl = paras[0];
            suggestionGrid = S.els.welcome.querySelector('.ai-suggestion-grid');
        }
        if (mode === 'chat') {
            if (h1El) h1El.textContent = '你好，我是 AI 助手';
            if (pEl) pEl.textContent = '我可以帮你撰写文案、优化表达、生成创意灵感';
            if (suggestionGrid) suggestionGrid.style.display = '';
        } else if (mode === 'image') {
            if (h1El) h1El.textContent = 'AI 图像生成';
            if (pEl) pEl.textContent = '输入描述，AI 将为你生成高质量图片';
            if (suggestionGrid) suggestionGrid.style.display = 'none';
        } else if (mode === 'video') {
            if (h1El) h1El.textContent = 'AI 视频生成';
            if (pEl) pEl.textContent = '输入描述，AI 将为你生成创意视频';
            if (suggestionGrid) suggestionGrid.style.display = 'none';
        }
    }

    function updateHeaderSub(text) {
        if (S.els.headerSub) S.els.headerSub.textContent = text;
    }

    function setInputEnabled(enabled) {
        if (S.els.input) S.els.input.disabled = !enabled;
        var hasText = S.els.input && S.els.input.value.trim();
        if (S.els.sendBtn) S.els.sendBtn.disabled = !enabled || !hasText;
        var streaming = isCurrentChatStreaming();
        if (S.els.stopBtn) S.els.stopBtn.style.display = streaming ? 'flex' : 'none';
    }

    function updateSendButtonState() {
        if (S.els.sendBtn) {
            var hasText = S.els.input && S.els.input.value.trim();
            S.els.sendBtn.disabled = isCurrentChatStreaming() || !hasText;
        }
        if (S.els.inputCounter && S.els.input) {
            S.els.inputCounter.textContent = S.els.input.value.length;
        }
    }

    // ==================== Sidebar ====================

    window.toggleAiSidebar = function toggleAiSidebar() {
        if (!S.els.sidebar) return;
        var overlay = getEl('aiSidebarOverlay');
        S.els.sidebar.classList.toggle('open');
        if (overlay) {
            overlay.classList.toggle('show');
        }
    };

    function closeSidebar() {
        if (!S.els.sidebar) return;
        S.els.sidebar.classList.remove('open');
        var overlay = getEl('aiSidebarOverlay');
        if (overlay) overlay.classList.remove('show');
    }

    // ==================== Theme Toggle ====================

    window.toggleTheme = function toggleTheme() {
        var isDark = false;
        try {
            if (typeof appState !== 'undefined' && appState.getState) {
                isDark = !!appState.getState('ui.isDark');
            } else {
                isDark = document.documentElement.classList.contains('dark-mode');
            }
        } catch (e) {
            isDark = document.documentElement.classList.contains('dark-mode');
        }

        var newIsDark = !isDark;

        if (typeof appState !== 'undefined' && appState.setState) {
            appState.setState('ui.isDark', newIsDark);
        }
        document.documentElement.classList.toggle('dark-mode', newIsDark);

        try {
            localStorage.setItem('cpydes_theme', newIsDark ? 'dark' : 'light');
        } catch (e) { /* ignore */ }

        var themeIcon = document.getElementById('aiThemeIcon');
        if (themeIcon) {
            themeIcon.setAttribute('data-feather', newIsDark ? 'sun' : 'moon');
        }

        if (typeof refreshFeatherIcons === 'function') {
            refreshFeatherIcons();
        }
    };

    // ==================== Auto Resize ====================

    window.autoResizeTextarea = function autoResizeTextarea(el) {
        if (!el) return;
        el.style.height = 'auto';
        var newHeight = Math.min(el.scrollHeight, 200);
        el.style.height = newHeight + 'px';
        updateSendButtonState();
    };

    // ==================== Default Models ====================

    function getDefaultModels() {
        return [
            { id: 'default', name: '默认模型', desc: '通用对话，适合大多数场景' },
            { id: 'creative', name: '创意写作', desc: '擅长文案创作和灵感生成' },
            { id: 'professional', name: '专业助手', desc: '严谨风格，适合工作场景' }
        ];
    }

    // ==================== Expose to other modules ====================

    // Utility functions used by other modules
    window._aiPad2 = pad2;
    window._aiGetEl = getEl;
    window._aiEscapeHtml = escapeHtml;
    window._aiSanitizeHtml = sanitizeHtml;
    window._aiGetDefaultModels = getDefaultModels;

    // Storage functions
    window._aiLoadGenHistory = loadGenHistory;
    window._aiSaveGenHistory = saveGenHistory;
    window._aiClearGenHistory = clearGenHistory;
    window._aiLoadStreamingFromStorage = loadStreamingFromStorage;
    window._aiSaveStreamingToStorage = saveStreamingToStorage;
    window._aiClearStreamingFromStorage = clearStreamingFromStorage;

    // Streaming state functions
    window._aiIsChatStreaming = isChatStreaming;
    window._aiIsCurrentChatStreaming = isCurrentChatStreaming;
    window._aiGetChatStreamState = getChatStreamState;
    window._aiSetChatStreaming = setChatStreaming;
    window._aiGetStreamingChatCount = getStreamingChatCount;
    window._aiUpdateActionButtonsState = updateActionButtonsState;

    // Poll functions
    window._aiAbortPoll = abortPoll;
    window._aiRegisterPoll = registerPoll;

    // Scroll functions
    window.scrollToBottom = scrollToBottom;
    window._aiScrollToBottomIfNear = scrollToBottomIfNear;
    window._aiIsNearBottom = isNearBottom;

    // Typing indicator
    window._aiShowTypingIndicator = showTypingIndicator;
    window._aiRemoveTypingIndicator = removeTypingIndicator;

    // UI state functions
    window._aiHideWelcomeScreen = hideWelcomeScreen;
    window._aiShowMessagePanel = showMessagePanel;
    window._aiShowWelcomeScreen = showWelcomeScreen;
    window._aiUpdateWelcomeContent = updateWelcomeContent;
    window._aiUpdateHeaderSub = updateHeaderSub;
    window._aiSetInputEnabled = setInputEnabled;
    window._aiUpdateSendButtonState = updateSendButtonState;
    window._aiCloseSidebar = closeSidebar;

    // Clipboard
    window.copyTextToClipboard = copyTextToClipboard;
    window.generateChatId = generateChatId;
})();
