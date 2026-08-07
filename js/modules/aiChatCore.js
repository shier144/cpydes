'use strict';

// ========== AI Chat Core Module ==========
// Chat history storage, SSE streaming, message sending, chat management.

(function () {
    var S = window._aiShared;
    var getEl = window._aiGetEl;
    var safeRenderMarkdown = window._aiSafeRenderMarkdown;
    var createMessageElement = window._aiCreateMessageElement;
    var createStreamingAssistantElement = window._aiCreateStreamingAssistantElement;
    var updateAssistantBubble = window._aiUpdateAssistantBubble;
    var isChatStreaming = window._aiIsChatStreaming;
    var isCurrentChatStreaming = window._aiIsCurrentChatStreaming;
    var getChatStreamState = window._aiGetChatStreamState;
    var setChatStreaming = window._aiSetChatStreaming;
    var getStreamingChatCount = window._aiGetStreamingChatCount;
    var updateActionButtonsState = window._aiUpdateActionButtonsState;
    var saveStreamingToStorage = window._aiSaveStreamingToStorage;
    var clearStreamingFromStorage = window._aiClearStreamingFromStorage;
    var showTypingIndicator = window._aiShowTypingIndicator;
    var removeTypingIndicator = window._aiRemoveTypingIndicator;
    var hideWelcomeScreen = window._aiHideWelcomeScreen;
    var showWelcomeScreen = window._aiShowWelcomeScreen;
    var updateHeaderSub = window._aiUpdateHeaderSub;
    var setInputEnabled = window._aiSetInputEnabled;
    var updateSendButtonState = window._aiUpdateSendButtonState;
    var closeSidebar = window._aiCloseSidebar;
    var scrollToBottom = window.scrollToBottom;
    var scrollToBottomIfNear = window._aiScrollToBottomIfNear;
    var showToast = window.showToast;
    var generateChatId = window.generateChatId;
    var autoResizeTextarea = window.autoResizeTextarea;

    // ==================== Chat History (localStorage) ====================

    function loadChatHistoryFromStorage() {
        try {
            var raw = localStorage.getItem('cpydes_ai_chat_history');
            if (raw) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    S.chatHistory = parsed;
                } else {
                    S.chatHistory = [];
                }
            } else {
                S.chatHistory = [];
            }
        } catch (e) {
            console.error('加载对话历史失败:', e);
            S.chatHistory = [];
        }
    }

    function saveChatHistoryToStorage() {
        try {
            if (S.chatHistory.length > S.MAX_CHAT_HISTORY) {
                S.chatHistory.length = S.MAX_CHAT_HISTORY;
            }
            localStorage.setItem('cpydes_ai_chat_history', JSON.stringify(S.chatHistory));
        } catch (e) {
            console.error('保存对话历史失败:', e);
        }
    }

    function getCurrentChat() {
        if (!S.currentChatId) return null;
        for (var i = 0; i < S.chatHistory.length; i++) {
            if (S.chatHistory[i].id === S.currentChatId) {
                return S.chatHistory[i];
            }
        }
        return null;
    }

    // ==================== API Call (SSE Streaming) ====================

    async function callAiApi(chatId, messages, model) {
        var requestBody = {
            messages: messages,
            model: model
        };

        var csrfToken = '';
        try {
            if (typeof ensureCsrfToken === 'function') {
                csrfToken = await ensureCsrfToken() || '';
            }
        } catch (e) {
            console.warn('获取CSRF token失败', e);
        }

        var abortController = new AbortController();
        setChatStreaming(chatId, true, abortController);

        var isCurrentlyViewed = (chatId === S.currentChatId);
        if (isCurrentlyViewed) {
            setInputEnabled(false);
            updateSendButtonState();
            showTypingIndicator();
        }

        var assistantContent = '';
        var assistantMsgEl = null;
        var hadError = false;

        var pendingStorageContent = '';
        var storageTimeout = null;

        try {
            var fetchHeaders = { 'Content-Type': 'application/json' };
            if (csrfToken) {
                fetchHeaders['X-CSRF-Token'] = csrfToken;
            }
            var _fetchTimeout = setTimeout(function () { abortController.abort(); }, 120000);
            var response;
            try {
                response = await fetch('api.php?action=aiChat', {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify(requestBody),
                    signal: abortController.signal
                });
            } finally {
                clearTimeout(_fetchTimeout);
            }

            if (!response.ok) {
                var errText = '';
                var errJson = null;
                try {
                    errJson = await response.json();
                    if (errJson && errJson.error) errText = errJson.error;
                } catch (e) { /* ignore */ }
                if (errJson && (errJson.needsLogin || errJson.needsLibraryAuth || errJson.needsPermission)) {
                    setChatStreaming(chatId, false);
                    if (isCurrentlyViewed) {
                        removeTypingIndicator();
                        setInputEnabled(true);
                        updateSendButtonState();
                    }
                    window._aiShowAiAuthGate(errJson.needsPermission ? 'permission' : 'login');
                    throw new Error(errText);
                }
                throw new Error(errText || ('服务器响应错误: ' + response.status));
            }

            var contentType = response.headers.get('content-type') || '';
            if (contentType.indexOf('application/json') !== -1) {
                var jsonResult = await response.json();
                if (jsonResult && (jsonResult.needsLogin || jsonResult.needsLibraryAuth || jsonResult.needsPermission)) {
                    setChatStreaming(chatId, false);
                    if (isCurrentlyViewed) {
                        removeTypingIndicator();
                        setInputEnabled(true);
                        updateSendButtonState();
                    }
                    window._aiShowAiAuthGate(jsonResult.needsPermission ? 'permission' : 'login');
                    throw new Error(jsonResult.error || 'AI 请求失败');
                }
                var jsonErr = (jsonResult && jsonResult.error) ? jsonResult.error : 'AI 请求失败';
                throw new Error(jsonErr);
            }

            var reader = response.body.getReader();
            var decoder = new TextDecoder('utf-8');
            var buffer = '';
            var typingRemoved = false;
            var pendingRender = false;
            var streamFinished = false;

            while (true) {
                var _readResult = await reader.read();
                var done = _readResult.done;
                var value = _readResult.value;

                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                var lines = buffer.split('\n');
                buffer = lines.pop();

                var gotNewChunk = false;

                for (var l = 0; l < lines.length; l++) {
                    var line = lines[l].trim();
                    if (!line.startsWith('data:')) continue;

                    var dataStr = line.substring(5).trim();
                    if (!dataStr) continue;

                    try {
                        var eventData = JSON.parse(dataStr);
                    } catch (parseErr) {
                        assistantContent += dataStr;
                        gotNewChunk = true;
                        continue;
                    }

                    if (eventData.type === 'chunk') {
                        assistantContent += eventData.content || '';
                        gotNewChunk = true;
                    } else if (eventData.type === 'error') {
                        throw new Error(eventData.message || 'AI 返回错误');
                    } else if (eventData.type === 'done') {
                        // Stream complete
                    }
                }

                if (gotNewChunk) {
                    var streamState = getChatStreamState(chatId);
                    if (streamState) {
                        streamState.streamingContent = assistantContent;
                    }

                    isCurrentlyViewed = (chatId === S.currentChatId);
                    if (isCurrentlyViewed) {
                        if (!typingRemoved) {
                            removeTypingIndicator();
                            typingRemoved = true;
                            assistantMsgEl = createStreamingAssistantElement();
                            S.els.messages.appendChild(assistantMsgEl);
                        }
                        if (assistantMsgEl && !document.contains(assistantMsgEl)) {
                            var existingStreaming = S.els.messages.querySelector('.ai-streaming-msg');
                            if (existingStreaming) {
                                assistantMsgEl = existingStreaming;
                            } else {
                                assistantMsgEl = createStreamingAssistantElement();
                                S.els.messages.appendChild(assistantMsgEl);
                            }
                        }
                        if (!pendingRender) {
                            pendingRender = true;
                            (function () {
                                var bubble = assistantMsgEl ? assistantMsgEl.querySelector('.ai-msg-bubble') : null;
                                if (!bubble) return;
                                bubble.innerHTML = safeRenderMarkdown(assistantContent);
                                bubble.classList.add('ai-streaming-cursor');
                                scrollToBottomIfNear();
                                requestAnimationFrame(function () { pendingRender = false; });
                            })();
                        }
                    }

                    if (storageTimeout) clearTimeout(storageTimeout);
                    storageTimeout = setTimeout(function() {
                        if (pendingStorageContent !== assistantContent) {
                            pendingStorageContent = assistantContent;
                            saveStreamingToStorage(chatId, assistantContent);
                            // 同步更新对话记录中的助手消息，防止刷新丢失
                            var chat = null;
                            for (var ci = 0; ci < S.chatHistory.length; ci++) {
                                if (S.chatHistory[ci].id === chatId) { chat = S.chatHistory[ci]; break; }
                            }
                            if (chat) {
                                var msgs = chat.messages;
                                for (var mi = msgs.length - 1; mi >= 0; mi--) {
                                    if (msgs[mi].role === 'assistant') {
                                        msgs[mi].content = assistantContent;
                                        break;
                                    }
                                }
                                chat.updatedAt = new Date().toISOString();
                                saveChatHistoryToStorage();
                            }
                        }
                    }, 500);
                }
            }

            streamFinished = true;

        } catch (err) {
            hadError = true;
            if (chatId === S.currentChatId) {
                removeTypingIndicator();
            }
            if (assistantMsgEl) {
                var errBubble = assistantMsgEl.querySelector('.ai-msg-bubble');
                if (errBubble) {
                    errBubble.classList.remove('ai-streaming-cursor');
                    if (assistantContent) {
                        updateAssistantBubble(errBubble, assistantContent);
                    }
                }
            }
            if (err.name !== 'AbortError') {
                console.error('AI 请求失败:', err);
                if (chatId === S.currentChatId) {
                    showToast(err.message || 'AI 请求失败，请重试', 'error');
                }
            }
        } finally {
            if (storageTimeout) {
                clearTimeout(storageTimeout);
            }
            saveStreamingToStorage(chatId, assistantContent);
            clearStreamingFromStorage(chatId);
            setChatStreaming(chatId, false);

            // 强制最终 Markdown 渲染（双阶段节流的收尾）
            if (assistantMsgEl && document.contains(assistantMsgEl)) {
                var _fb = assistantMsgEl.querySelector('.ai-msg-bubble');
                if (_fb && assistantContent) {
                    _fb.innerHTML = safeRenderMarkdown(assistantContent);
                }
            } else if (chatId === S.currentChatId) {
                var _es = S.els.messages.querySelector('.ai-streaming-msg');
                if (_es) {
                    var _eb = _es.querySelector('.ai-msg-bubble');
                    if (_eb && assistantContent) {
                        _eb.innerHTML = safeRenderMarkdown(assistantContent);
                    }
                }
            }

            if (typingRemoved === false && isCurrentlyViewed) {
                removeTypingIndicator();
            }

            if (assistantMsgEl && document.contains(assistantMsgEl)) {
                var finalBubble = assistantMsgEl.querySelector('.ai-msg-bubble');
                if (finalBubble) {
                    finalBubble.classList.remove('ai-streaming-cursor');
                    updateAssistantBubble(finalBubble, assistantContent);
                }
            } else if (chatId === S.currentChatId) {
                var existingStreamEl = S.els.messages.querySelector('.ai-streaming-msg');
                if (existingStreamEl) {
                    var existingBubble = existingStreamEl.querySelector('.ai-msg-bubble');
                    if (existingBubble) {
                        existingBubble.classList.remove('ai-streaming-cursor');
                        updateAssistantBubble(existingBubble, assistantContent);
                    }
                }
            }

            if (chatId === S.currentChatId) {
                setInputEnabled(true);
                updateSendButtonState();
            }
            renderChatList();
        }

        return { content: assistantContent, element: assistantMsgEl, error: hadError };
    }

    // ==================== Core Functions ====================

    window.startNewChat = function startNewChat() {
        S.currentChatId = null;
        S.lastChatIdByMode[S.aiMode] = null;

        showWelcomeScreen();
        setInputEnabled(true);
        updateSendButtonState();
        renderChatList();
        closeSidebar();
        if (S.els.input) {
            S.els.input.value = '';
            autoResizeTextarea(S.els.input);
            S.els.input.focus();
        }
    };

    window.sendSuggestion = function sendSuggestion(text) {
        if (S.els.input) {
            S.els.input.value = text;
            autoResizeTextarea(S.els.input);
        }
        sendMessage();
    };

    window.sendMessage = async function sendMessage() {
        if (S.isSending) return;
        if (isCurrentChatStreaming()) return;
        if (S.isGenerating) return;
        if (!S.els.input) return;

        var text = S.els.input.value.trim();
        if (!text) return;

        // 生图模式：调用图片生成
        if (S.aiMode === 'image') {
            window.generateImage();
            return;
        }
        // 生视频模式：调用视频生成
        if (S.aiMode === 'video') {
            window.generateVideo();
            return;
        }
        // 对话模式下图片生成开关开启：在对话中生成图片
        if (S.aiMode === 'chat' && S.chatImageMode) {
            S.isSending = true;
            sendMessageWithImage(text);
            return;
        }

        S.isSending = true;

        try {
            hideWelcomeScreen();
            updateHeaderSub('正在回复中...');

            var userMsgEl = createMessageElement('user', text);
            S.els.messages.appendChild(userMsgEl);

            var chatRecord = getCurrentChat();
            if (!chatRecord) {
                var chatId = generateChatId();
                var firstChar = text.length > 20 ? text.substring(0, 20) + '...' : text;
                firstChar = firstChar.replace(/<[^>]*>/g, '');
                chatRecord = {
                    id: chatId,
                    title: firstChar,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    messages: []
                };
                S.chatHistory.unshift(chatRecord);
                S.currentChatId = chatId;
                S.lastChatIdByMode[S.aiMode] = chatId;
                saveChatHistoryToStorage();
                renderChatList();
                var sendTitleEl = getEl('aiHeaderTitle');
                if (sendTitleEl) sendTitleEl.textContent = chatRecord.title;
            } else {
                chatRecord.updatedAt = new Date().toISOString();
                saveChatHistoryToStorage();
            }

            chatRecord.messages.push({ role: 'user', content: text });

            // 预先创建助手消息占位符，避免刷新丢失
            chatRecord.messages.push({ role: 'assistant', content: '' });
            chatRecord.updatedAt = new Date().toISOString();
            saveChatHistoryToStorage();

            S.els.input.value = '';
            autoResizeTextarea(S.els.input);
            scrollToBottom();

            var apiMessages = chatRecord.messages.slice(0, -1).slice(-20);
            var result = await callAiApi(chatRecord.id, apiMessages, S.selectedModel);
            var replyContent = result.content || '';

            if (!replyContent) {
                if (chatRecord.id === S.currentChatId) {
                    if (!result.element) {
                        var errMsgEl = createMessageElement('assistant', '');
                        S.els.messages.appendChild(errMsgEl);
                        result.element = errMsgEl;
                    }
                    replyContent = '抱歉，我没有收到有效的回复。请重试。';
                    var errBubble = result.element.querySelector('.ai-msg-bubble');
                    if (errBubble) {
                        errBubble.classList.remove('ai-streaming-cursor');
                        updateAssistantBubble(errBubble, replyContent);
                    }
                } else {
                    replyContent = '抱歉，我没有收到有效的回复。请重试。';
                }
            }

            // 更新已存在的助手占位消息
            var lastAssistantMsg = chatRecord.messages[chatRecord.messages.length - 1];
            if (lastAssistantMsg && lastAssistantMsg.role === 'assistant') {
                lastAssistantMsg.content = replyContent || lastAssistantMsg.content;
            } else {
                chatRecord.messages.push({ role: 'assistant', content: replyContent });
            }
            chatRecord.updatedAt = new Date().toISOString();
            saveChatHistoryToStorage();
            renderChatList();

            if (chatRecord.id === S.currentChatId) {
                scrollToBottom();
                var titleEl = getEl('aiHeaderTitle');
                if (titleEl) titleEl.textContent = chatRecord.title;
                updateHeaderSub(chatRecord.messages.length + ' 条消息');
            }
        } finally {
            S.isSending = false;
        }
    };

    window.handleAiInputKey = function handleAiInputKey(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    // 对话模式下生成图片：用户消息 + 助手消息（内嵌图片）
    async function sendMessageWithImage(text) {
        if (!S.els.input) return;
        hideWelcomeScreen();
        updateHeaderSub('正在生成图片...');

        var userMsgEl = createMessageElement('user', text);

        var chatRecord = getCurrentChat();
        if (!chatRecord) {
            var chatId = generateChatId();
            var firstChar = text.length > 20 ? text.substring(0, 20) + '...' : text;
            firstChar = firstChar.replace(/<[^>]*>/g, '');
            chatRecord = {
                id: chatId,
                title: firstChar,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                messages: []
            };
            S.chatHistory.unshift(chatRecord);
            S.currentChatId = chatId;
            S.lastChatIdByMode[S.aiMode] = chatId;
            saveChatHistoryToStorage();
            renderChatList();
        } else {
            chatRecord.updatedAt = new Date().toISOString();
            saveChatHistoryToStorage();
        }

        chatRecord.messages.push({ role: 'user', content: text });

        var assistantPlaceholder = '正在生成中...';
        chatRecord.messages.push({ role: 'assistant', content: assistantPlaceholder });
        chatRecord.updatedAt = new Date().toISOString();
        saveChatHistoryToStorage();
        renderChatList();

        S.els.input.value = '';
        autoResizeTextarea(S.els.input);
        scrollToBottom();

        var assistantMsgEl = createMessageElement('assistant', '');
        var bubble = assistantMsgEl.querySelector('.ai-msg-bubble');
        if (bubble) {
            bubble.innerHTML = '<div class="ai-chat-img-loading"><div class="ai-gen-spinner"></div><span>正在生成图片...</span></div>';
            bubble.classList.add('ai-streaming-cursor');
        }
        S.els.messages.appendChild(assistantMsgEl);
        scrollToBottom();
        setInputEnabled(false);
        updateSendButtonState();

        var modelId = S.selectedModelByMode.image || '';
        var models = window._aiGetModelsByType('image');
        if (!modelId && models.length > 0) {
            modelId = models[0].id;
            S.selectedModelByMode.image = modelId;
        }

        var replyContent = '';
        try {
            var result = await window._aiCallImageApi(text, modelId, '1280x720', 1);
            if (bubble) bubble.classList.remove('ai-streaming-cursor');

            if (result.taskId) {
                try {
                    result = await window._aiPollImageStatus(result.taskId);
                } catch (pollErr) {
                    throw new Error(pollErr.message || '图片生成失败');
                }
            }

            if (result && result.images && result.images.length > 0) {
                var md = '';
                result.images.forEach(function (img, idx) {
                    var url = window._aiNormalizeGeneratedMediaUrl(img.url);
                    if (!url && img.b64) url = 'data:image/png;base64,' + img.b64;
                    if (url) {
                        if (idx > 0) md += '\n\n';
                        md += '![生成图片](' + url + ')';
                    }
                });
                replyContent = md || '图片生成失败，请重试。';
            } else {
                replyContent = '图片生成失败：' + (result.error || '未知错误');
                showToast(result.error || '图片生成失败', 'error');
            }
        } catch (e) {
            if (bubble) bubble.classList.remove('ai-streaming-cursor');
            replyContent = '图片生成请求失败：' + (e.message || e);
            showToast('网络错误', 'error');
        }

        var _reply = replyContent;
        var _b = bubble;
        setTimeout(function () {
            if (_b) {
                _b.innerHTML = safeRenderMarkdown(_reply);
                var imgs = _b.querySelectorAll('img');
                imgs.forEach(function (img) {
                    if (img.complete) {
                        img.classList.add('ai-img-loaded');
                    } else {
                        img.addEventListener('load', function () {
                            this.classList.add('ai-img-loaded');
                        });
                    }
                });
                updateAssistantBubble(_b, _reply);
            }
        }, 0);

        var lastMsg = chatRecord.messages[chatRecord.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === '正在生成中...') {
            lastMsg.content = replyContent;
        } else {
            chatRecord.messages.push({ role: 'assistant', content: replyContent });
        }
        chatRecord.updatedAt = new Date().toISOString();
        saveChatHistoryToStorage();
        renderChatList();

        setInputEnabled(true);
        updateSendButtonState();
        scrollToBottom();

        var titleEl = getEl('aiHeaderTitle');
        if (titleEl && chatRecord) titleEl.textContent = chatRecord.title;
        updateHeaderSub(chatRecord ? chatRecord.messages.length + ' 条消息' : '');

        S.isSending = false;
    }

    window.clearCurrentChat = function clearCurrentChat() {
        if (!confirm('确定要清空当前对话吗？此操作不可撤销。')) return;
        if (S.els.messages) S.els.messages.innerHTML = '';
        if (S.currentChatId) {
            var streamState = getChatStreamState(S.currentChatId);
            if (streamState && streamState.abortController) {
                streamState.abortController.abort();
            }
            for (var i = 0; i < S.chatHistory.length; i++) {
                if (S.chatHistory[i].id === S.currentChatId) {
                    S.chatHistory.splice(i, 1);
                    break;
                }
            }
            saveChatHistoryToStorage();
            clearStreamingFromStorage(S.currentChatId);
        }
        S.currentChatId = null;
        S.lastChatIdByMode[S.aiMode] = null;
        if (S.els.messages) S.els.messages.innerHTML = '';
        showWelcomeScreen();
        setInputEnabled(true);
        updateSendButtonState();
        renderChatList();
        if (S.els.input) {
            S.els.input.value = '';
            autoResizeTextarea(S.els.input);
        }
        showToast('当前对话已清空', 'success');
    };

    window.stopGeneration = function stopGeneration() {
        if (S.currentChatId) {
            var streamState = getChatStreamState(S.currentChatId);
            if (streamState && streamState.abortController) {
                streamState.abortController.abort();
                showToast('已停止生成', 'info');
            }
        }
    };

    window.regenerateResponse = function regenerateResponse() {
        if (isCurrentChatStreaming()) return;
        var chat = getCurrentChat();
        if (!chat || !chat.messages || chat.messages.length === 0) return;

        var lastAssistantIdx = -1;
        for (var i = chat.messages.length - 1; i >= 0; i--) {
            if (chat.messages[i].role === 'assistant') {
                lastAssistantIdx = i;
                break;
            }
        }

        if (lastAssistantIdx === -1) {
            showToast('没有可重新生成的回复', 'info');
            return;
        }

        chat.messages.splice(lastAssistantIdx, 1);
        saveChatHistoryToStorage();

        var msgElements = S.els.messages.querySelectorAll('.ai-message.assistant');
        if (msgElements.length > 0) {
            var lastMsgEl = msgElements[msgElements.length - 1];
            lastMsgEl.parentNode.removeChild(lastMsgEl);
        }

        if (chat.messages.length === 0) {
            for (var e = 0; e < S.chatHistory.length; e++) {
                if (S.chatHistory[e].id === chat.id) {
                    S.chatHistory.splice(e, 1);
                    break;
                }
            }
            saveChatHistoryToStorage();
            S.currentChatId = null;
            if (S.els.messages) S.els.messages.innerHTML = '';
            showWelcomeScreen();
            setInputEnabled(true);
            updateSendButtonState();
            renderChatList();
            showToast('没有可发送的用户消息，对话已清空', 'info');
            return;
        }

        var apiMessages = chat.messages.slice(-20);
        // 预先创建助手消息占位符
        chat.messages.push({ role: 'assistant', content: '' });
        chat.updatedAt = new Date().toISOString();
        saveChatHistoryToStorage();
        callAiApi(chat.id, apiMessages, S.selectedModel).then(function(result) {
            var replyContent = result.content || '';

            if (!replyContent && !result.element && chat.id === S.currentChatId) {
                var errMsgEl = createMessageElement('assistant', '抱歉，重新生成失败。请重试。');
                S.els.messages.appendChild(errMsgEl);
                result.element = errMsgEl;
                replyContent = '抱歉，重新生成失败。请重试。';
            }

            // 更新已存在的助手占位消息
            var lastMsg = chat.messages[chat.messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content = replyContent || lastMsg.content;
            } else {
                chat.messages.push({ role: 'assistant', content: replyContent });
            }
            chat.updatedAt = new Date().toISOString();
            saveChatHistoryToStorage();
            renderChatList();
            if (chat.id === S.currentChatId) {
                scrollToBottom();
            }
        });
    };

    window.deleteMessage = function deleteMessage(messageIndex) {
        var chat = getCurrentChat();
        if (!chat || !chat.messages) return;
        if (messageIndex < 0 || messageIndex >= chat.messages.length) return;

        chat.messages.splice(messageIndex, 1);
        saveChatHistoryToStorage();

        if (chat.messages.length === 0) {
            for (var j = 0; j < S.chatHistory.length; j++) {
                if (S.chatHistory[j].id === chat.id) {
                    S.chatHistory.splice(j, 1);
                    break;
                }
            }
            saveChatHistoryToStorage();
            S.currentChatId = null;
            if (S.els.messages) S.els.messages.innerHTML = '';
            showWelcomeScreen();
            setInputEnabled(true);
            updateSendButtonState();
            renderChatList();
            showToast('消息已删除，对话已清空', 'success');
            return;
        }

        if (S.els.messages) {
            S.els.messages.innerHTML = '';
            for (var i = 0; i < chat.messages.length; i++) {
                var msg = chat.messages[i];
                var msgEl = createMessageElement(msg.role, msg.content, i);
                S.els.messages.appendChild(msgEl);
            }
        }

        renderChatList();
        showToast('消息已删除', 'success');
    };

    window.exportChat = function exportChat() {
        var chat = getCurrentChat();
        if (!chat || !chat.messages || chat.messages.length === 0) {
            showToast('没有可导出的对话', 'info');
            return;
        }

        var markdown = '# ' + (chat.title || '未命名对话') + '\n\n';
        markdown += '*导出时间: ' + new Date().toLocaleString('zh-CN') + '*\n\n---\n\n';

        for (var i = 0; i < chat.messages.length; i++) {
            var msg = chat.messages[i];
            if (msg.role === 'user') {
                markdown += '## 👤 用户\n\n';
                markdown += msg.content + '\n\n';
            } else if (msg.role === 'assistant') {
                markdown += '## 🤖 AI 助手\n\n';
                markdown += msg.content + '\n\n';
            }
            if (i < chat.messages.length - 1) {
                markdown += '---\n\n';
            }
        }

        var blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (chat.title || '对话') + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('对话已导出', 'success');
    };

    window.searchChats = function searchChats(query) {
        if (!S.els.chatList) return;

        query = (query || '').trim().toLowerCase();

        if (!query) {
            renderChatList();
            return;
        }

        var results = [];

        for (var ci = 0; ci < S.chatHistory.length; ci++) {
            var chat = S.chatHistory[ci];
            if (!chat.messages || chat.messages.length === 0) continue;
            var found = false;
            if (chat.title && chat.title.toLowerCase().indexOf(query) !== -1) found = true;
            if (!found) {
                for (var mi = 0; mi < chat.messages.length; mi++) {
                    if (chat.messages[mi].content && chat.messages[mi].content.toLowerCase().indexOf(query) !== -1) {
                        found = true;
                        break;
                    }
                }
            }
            if (found) {
                results.push({ type: 'chat', data: chat });
            }
        }

        for (var ii = 0; ii < S.imageHistory.length; ii++) {
            var imgEntry = S.imageHistory[ii];
            if (!imgEntry || !imgEntry.prompt) continue;
            if (imgEntry.prompt.toLowerCase().indexOf(query) !== -1) {
                results.push({ type: 'image', data: imgEntry });
            }
        }

        for (var vi = 0; vi < S.videoHistory.length; vi++) {
            var vidEntry = S.videoHistory[vi];
            if (!vidEntry || !vidEntry.prompt) continue;
            if (vidEntry.prompt.toLowerCase().indexOf(query) !== -1) {
                results.push({ type: 'video', data: vidEntry });
            }
        }

        var items = S.els.chatList.querySelectorAll('.ai-chat-item');
        for (var i = 0; i < items.length; i++) {
            items[i].parentNode.removeChild(items[i]);
        }

        var emptyEl = getEl('chatListEmpty');

        if (results.length === 0) {
            if (emptyEl) {
                emptyEl.style.display = '';
                emptyEl.querySelector('p').textContent = '未找到匹配的记录';
                emptyEl.querySelector('small').textContent = '尝试其他关键词';
            }
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';

        for (var k = 0; k < results.length; k++) {
            var r = results[k];
            var type = r.type;
            var data = r.data;
            var title = '';
            var streamBadgeHtml = '';

            if (type === 'chat') {
                title = data.title || '未命名对话';
                if (isChatStreaming(data.id)) {
                    streamBadgeHtml = '<span class="ai-chat-streaming-badge" title="正在回复中..."></span>';
                }
            } else if (type === 'image') {
                var promptText = (data.prompt || '').replace(/<[^>]*>/g, '');
                title = '图片: ' + (promptText.length > 30 ? promptText.substring(0, 30) + '...' : promptText);
            } else if (type === 'video') {
                var vidPromptText = (data.prompt || '').replace(/<[^>]*>/g, '');
                title = '视频: ' + (vidPromptText.length > 30 ? vidPromptText.substring(0, 30) + '...' : vidPromptText);
            }

            var item = document.createElement('div');
            item.className = 'ai-chat-item' + (data.id === S.currentChatId ? ' active' : '');
            item.dataset.id = data.id;
            item.dataset.type = type;

            var titleSpan = document.createElement('span');
            titleSpan.className = 'ai-chat-item-title';
            titleSpan.innerHTML = streamBadgeHtml + title;

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'ai-chat-item-delete';
            deleteBtn.title = '删除此记录';
            deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

            item.appendChild(titleSpan);
            item.appendChild(deleteBtn);

            (function (elItem, itemType, itemData, delBtn) {
                elItem.addEventListener('click', function () {
                    window.loadHistoryItem(itemType, itemData.id);
                });
                delBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    window.deleteHistoryItem(itemType, itemData.id);
                });
            })(item, type, data, deleteBtn);

            S.els.chatList.appendChild(item);
        }

        if (typeof refreshFeatherIcons === 'function') {
            refreshFeatherIcons();
        }
        updateActionButtonsState();
    };

    window.selectChat = function selectChat(chatId) {
        var chat = null;
        for (var i = 0; i < S.chatHistory.length; i++) {
            if (S.chatHistory[i].id === chatId) {
                chat = S.chatHistory[i];
                break;
            }
        }

        if (!chat || !chat.messages) return;

        S.currentChatId = chatId;
        S.lastChatIdByMode[S.aiMode] = chatId;

        if (S.els.welcome) S.els.welcome.style.display = 'none';
        if (S.els.messages) S.els.messages.style.display = 'flex';

        S.els.messages.innerHTML = '';
        var _totalMsgs = chat.messages.length;
        var _PAGE_SIZE = 50;
        var _msgStart = _totalMsgs > _PAGE_SIZE ? _totalMsgs - _PAGE_SIZE : 0;
        var _frag = document.createDocumentFragment();
        if (_msgStart > 0) {
            var _loadMoreBtn = document.createElement('button');
            _loadMoreBtn.className = 'ai-load-earlier-btn';
            _loadMoreBtn.textContent = '加载更早的 ' + _msgStart + ' 条消息';
            _loadMoreBtn.setAttribute('data-start', String(_msgStart));
            _loadMoreBtn.onclick = function () {
                var curStart = parseInt(this.getAttribute('data-start'), 10);
                var chat2 = null;
                for (var k = 0; k < S.chatHistory.length; k++) {
                    if (S.chatHistory[k].id === S.currentChatId) { chat2 = S.chatHistory[k]; break; }
                }
                if (!chat2) return;
                var btn = this;
                var newStart = Math.max(0, curStart - _PAGE_SIZE);
                var frag2 = document.createDocumentFragment();
                for (var j = newStart; j < curStart; j++) {
                    frag2.appendChild(createMessageElement(chat2.messages[j].role, chat2.messages[j].content, j));
                }
                btn.parentNode.insertBefore(frag2, btn);
                if (newStart === 0) {
                    btn.remove();
                } else {
                    btn.setAttribute('data-start', String(newStart));
                    btn.textContent = '加载更早的 ' + newStart + ' 条消息';
                }
                scrollToBottom();
            };
            _frag.appendChild(_loadMoreBtn);
        }
        for (var m = _msgStart; m < _totalMsgs; m++) {
            var msg = chat.messages[m];
            var msgEl = createMessageElement(msg.role, msg.content, m);
            _frag.appendChild(msgEl);
        }
        S.els.messages.appendChild(_frag);

        var streamState = getChatStreamState(chatId);
        if (streamState && streamState.isStreaming) {
            if (streamState.streamingContent) {
                var streamingEl = createStreamingAssistantElement();
                var streamingBubble = streamingEl.querySelector('.ai-msg-bubble');
                if (streamingBubble) {
                    streamingBubble.innerHTML = safeRenderMarkdown(streamState.streamingContent);
                    streamingBubble.classList.add('ai-streaming-cursor');
                }
                S.els.messages.appendChild(streamingEl);
            } else {
                showTypingIndicator();
            }
        }

        var titleEl = getEl('aiHeaderTitle');
        if (titleEl) titleEl.textContent = chat.title;
        var msgCount = chat.messages.length;
        var streamCount = getStreamingChatCount();
        var subText = msgCount + ' 条消息';
        if (streamState && streamState.isStreaming) {
            subText = '正在回复中...';
        } else if (streamCount > 0) {
            subText = msgCount + ' 条消息 · ' + streamCount + ' 个对话回复中';
        }
        updateHeaderSub(subText);

        var isStreaming = isCurrentChatStreaming();
        setInputEnabled(!isStreaming);
        updateSendButtonState();

        renderChatList();
        scrollToBottom();
        updateActionButtonsState();
        closeSidebar();
    };

    window.renameChat = function renameChat(chatId) {
        var chat = null;
        for (var i = 0; i < S.chatHistory.length; i++) {
            if (S.chatHistory[i].id === chatId) {
                chat = S.chatHistory[i];
                break;
            }
        }
        if (!chat) return;

        var newName = prompt('重命名对话', chat.title || '');
        if (newName !== null && newName.trim() !== '') {
            chat.title = newName.trim().replace(/<[^>]*>/g, '');
            chat.updatedAt = new Date().toISOString();
            saveChatHistoryToStorage();
            renderChatList();
            if (S.currentChatId === chatId) {
                var titleEl = getEl('aiHeaderTitle');
                if (titleEl) titleEl.textContent = chat.title;
            }
        }
    };

    window.deleteChat = function deleteChat(chatId) {
        var streamState = getChatStreamState(chatId);
        if (streamState && streamState.abortController) {
            streamState.abortController.abort();
        }

        for (var i = 0; i < S.chatHistory.length; i++) {
            if (S.chatHistory[i].id === chatId) {
                S.chatHistory.splice(i, 1);
                break;
            }
        }

        if (S.currentChatId === chatId) {
            S.currentChatId = null;
            showWelcomeScreen();
            setInputEnabled(true);
            updateSendButtonState();
        }

        saveChatHistoryToStorage();
        renderChatList();
        showToast('对话已删除', 'success');
    };

    window.renderChatList = function renderChatList() {
        if (!S.els.chatList) return;

        var validChats = S.chatHistory.filter(function (c) {
            return c.messages && c.messages.length > 0;
        });

        var allItems = [];

        for (var ci = 0; ci < validChats.length; ci++) {
            var chat = validChats[ci];
            allItems.push({
                type: 'chat',
                id: chat.id,
                title: chat.title || '未命名对话',
                createdAt: chat.updatedAt || chat.createdAt,
                updatedAt: chat.updatedAt,
                messages: chat.messages,
                isStreaming: isChatStreaming(chat.id)
            });
        }

        for (var ii = 0; ii < S.imageHistory.length; ii++) {
            var imgEntry = S.imageHistory[ii];
            if (!imgEntry) continue;
            if (!imgEntry.isStreaming && (!imgEntry.images || imgEntry.images.length === 0)) continue;
            var promptText = (imgEntry.prompt || '').replace(/<[^>]*>/g, '');
            allItems.push({
                type: 'image',
                id: imgEntry.id,
                title: '图片: ' + (promptText.length > 30 ? promptText.substring(0, 30) + '...' : promptText),
                createdAt: imgEntry.createdAt,
                messages: null,
                isStreaming: imgEntry.isStreaming || false
            });
        }

        for (var vi = 0; vi < S.videoHistory.length; vi++) {
            var vidEntry = S.videoHistory[vi];
            if (!vidEntry) continue;
            if (!vidEntry.isStreaming && !vidEntry.videoUrl) continue;
            var vidPromptText = (vidEntry.prompt || '').replace(/<[^>]*>/g, '');
            allItems.push({
                type: 'video',
                id: vidEntry.id,
                title: '视频: ' + (vidPromptText.length > 30 ? vidPromptText.substring(0, 30) + '...' : vidPromptText),
                createdAt: vidEntry.createdAt,
                messages: null,
                isStreaming: vidEntry.isStreaming || false
            });
        }

        allItems.sort(function (a, b) {
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        var emptyEl = getEl('chatListEmpty');
        if (allItems.length === 0) {
            if (emptyEl) {
                emptyEl.style.display = '';
                var pEl = emptyEl.querySelector('p');
                var sEl = emptyEl.querySelector('small');
                if (pEl) pEl.textContent = '暂无对话记录';
                if (sEl) sEl.textContent = '开始新的对话吧';
            }
            var items = S.els.chatList.querySelectorAll('.ai-chat-item');
            for (var i = 0; i < items.length; i++) {
                items[i].parentNode.removeChild(items[i]);
            }
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';

        var existingItems = S.els.chatList.querySelectorAll('.ai-chat-item, .ai-chat-group-label');
        for (var j = 0; j < existingItems.length; j++) {
            existingItems[j].parentNode.removeChild(existingItems[j]);
        }

        function getDateLabel(dateStr) {
            if (!dateStr) return '更早';
            var d = new Date(dateStr);
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var yesterday = new Date(today.getTime() - 86400000);
            var itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            if (itemDate.getTime() === today.getTime()) return '今天';
            if (itemDate.getTime() === yesterday.getTime()) return '昨天';
            var weekAgo = new Date(today.getTime() - 7 * 86400000);
            if (itemDate >= weekAgo) return '近7天';
            var monthAgo = new Date(today.getTime() - 30 * 86400000);
            if (itemDate >= monthAgo) return '近30天';
            return '更早';
        }

        var lastGroup = '';
        for (var k = 0; k < allItems.length; k++) {
            var item = allItems[k];
            var groupLabel = getDateLabel(item.createdAt);
            if (groupLabel !== lastGroup) {
                lastGroup = groupLabel;
                var groupEl = document.createElement('div');
                groupEl.className = 'ai-chat-group-label';
                groupEl.textContent = groupLabel;
                S.els.chatList.appendChild(groupEl);
            }
            var el = document.createElement('div');
            el.className = 'ai-chat-item' + (item.id === S.currentChatId ? ' active' : '');
            el.dataset.id = item.id;
            el.dataset.type = item.type;

            var titleSpan = document.createElement('span');
            titleSpan.className = 'ai-chat-item-title';

            var typeIcon = document.createElement('span');
            typeIcon.className = 'ai-chat-item-type-icon';
            if (item.type === 'image') {
                typeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5" polyline="points="21 15 16 10 5 21"/></svg>';
                typeIcon.style.color = '#f59e0b';
            } else if (item.type === 'video') {
                typeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
                typeIcon.style.color = '#8b5cf6';
            } else {
                typeIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
                typeIcon.style.color = 'var(--ai-pri)';
            }
            titleSpan.appendChild(typeIcon);

            var textSpan = document.createElement('span');
            textSpan.textContent = item.title;
            titleSpan.appendChild(textSpan);

            if (item.isStreaming) {
                var streamBadge = document.createElement('span');
                streamBadge.className = 'ai-chat-streaming-badge';
                streamBadge.title = '正在回复中...';
                titleSpan.appendChild(streamBadge);
            }

            var cancelBtn = null;
            if (item.isStreaming && (item.type === 'image' || item.type === 'video')) {
                cancelBtn = document.createElement('button');
                cancelBtn.className = 'ai-chat-item-cancel';
                cancelBtn.title = '终止任务';
                cancelBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
            }

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'ai-chat-item-delete';
            deleteBtn.title = '删除此记录';
            deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

            el.appendChild(titleSpan);

            var renameBtn = null;
            if (item.type === 'chat') {
                renameBtn = document.createElement('button');
                renameBtn.className = 'ai-chat-item-delete ai-chat-item-rename';
                renameBtn.title = '重命名';
                renameBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
                el.appendChild(renameBtn);
            }

            if (cancelBtn) {
                el.appendChild(cancelBtn);
            }

            el.appendChild(deleteBtn);

            (function (elItem, itemData, delBtn, rnmBtn, cnlBtn) {
                elItem.addEventListener('click', function () {
                    window.loadHistoryItem(itemData.type, itemData.id);
                });
                elItem.addEventListener('dblclick', function (e) {
                    if (itemData.type !== 'chat') return;
                    e.preventDefault();
                    renameChat(itemData.id);
                });
                if (rnmBtn) {
                    rnmBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        renameChat(itemData.id);
                    });
                }
                if (cnlBtn) {
                    cnlBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        window.cancelAiTask(itemData.id, itemData.type);
                    });
                }
                delBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    window.deleteHistoryItem(itemData.type, itemData.id);
                });
            })(el, item, deleteBtn, renameBtn, cancelBtn);

            S.els.chatList.appendChild(el);
        }

        if (typeof refreshFeatherIcons === 'function') {
            refreshFeatherIcons();
        }
    };

    // ==================== Expose to other modules ====================

    window._aiLoadChatHistoryFromStorage = loadChatHistoryFromStorage;
    window._aiSaveChatHistoryToStorage = saveChatHistoryToStorage;
    window._aiGetCurrentChat = getCurrentChat;
    window._aiCallAiApi = callAiApi;
})();
