'use strict';

// ========== AI Media Generation Module ==========
// Image generation, video generation, media utilities, history management.

(function () {
    var S = window._aiShared;
    var getEl = window._aiGetEl;
    var pad2 = window._aiPad2;
    var safeRenderMarkdown = window._aiSafeRenderMarkdown;
    var createMessageElement = window._aiCreateMessageElement;
    var isChatStreaming = window._aiIsChatStreaming;
    var getChatStreamState = window._aiGetChatStreamState;
    var abortPoll = window._aiAbortPoll;
    var registerPoll = window._aiRegisterPoll;
    var saveGenHistory = window._aiSaveGenHistory;
    var scrollToBottom = window.scrollToBottom;
    var showToast = window.showToast;
    var autoResizeTextarea = window.autoResizeTextarea;
    var setInputEnabled = window._aiSetInputEnabled;
    var updateSendButtonState = window._aiUpdateSendButtonState;
    var updateHeaderSub = window._aiUpdateHeaderSub;
    var showWelcomeScreen = window._aiShowWelcomeScreen;
    var showMessagePanel = window._aiShowMessagePanel;
    var closeSidebar = window._aiCloseSidebar;
    var copyTextToClipboard = window.copyTextToClipboard;

    // ==================== Media Utilities ====================

    function normalizeGeneratedMediaUrl(url) {
        if (!url || typeof url !== 'string') return '';
        if (/^(https?:\/\/|data:|blob:|\/)/i.test(url)) return url;
        return '/' + url.replace(/^\.?\/+/, '');
    }

    function attachImageErrorHandler(imgEl, card, url) {
        imgEl.addEventListener('error', function () {
            if (card.classList.contains('ai-img-error')) return;
            card.classList.add('ai-img-error');
            card.classList.remove('ai-skeleton-card');
            var retryBtn = document.createElement('button');
            retryBtn.className = 'ai-img-retry';
            retryBtn.type = 'button';
            retryBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg><span>点击重试</span>';
            retryBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                card.classList.remove('ai-img-error');
                imgEl.classList.remove('ai-img-loaded');
                var sep = url.indexOf('?') >= 0 ? '&' : '?';
                imgEl.src = url + sep + '_r=' + Date.now();
                if (retryBtn.parentNode) retryBtn.parentNode.removeChild(retryBtn);
            });
            card.appendChild(retryBtn);
        });
    }

    function formatGenTimestamp(isoStr) {
        try {
            var d = new Date(isoStr);
            var Y = d.getFullYear();
            var M = pad2(d.getMonth() + 1);
            var D = pad2(d.getDate());
            var h = pad2(d.getHours());
            var m = pad2(d.getMinutes());
            return Y + '-' + M + '-' + D + ' ' + h + ':' + m;
        } catch (e) {
            return isoStr || '';
        }
    }

    function downloadAsset(url, filename) {
        fetch(url)
            .then(function (response) { return response.blob(); })
            .then(function (blob) {
                var blobUrl = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            })
            .catch(function (error) {
                console.warn('Direct download failed, likely due to CORS policy.', error);
                var a = document.createElement('a');
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
    }

    // ==================== Image Generation ====================

    async function callImageApi(prompt, model, size, n) {
        var csrfToken = '';
        try {
            if (typeof ensureCsrfToken === 'function') {
                csrfToken = await ensureCsrfToken() || '';
            }
        } catch (e) { /* ignore */ }

        var headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        var body = { prompt: prompt, model: model, size: size, n: n };

        var response = await fetch('api.php?action=aiGenerateImage', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            var errJson = null;
            try { errJson = await response.json(); } catch (e2) { /* ignore */ }
            if (errJson && window._aiHandleAiAuthError(errJson)) {
                throw new Error(errJson.error || '会话已过期');
            }
            var statusMsg = response.status === 504 ? '服务端响应超时' :
                           response.status === 500 ? '服务器内部错误' :
                           '请求失败';
            throw new Error(statusMsg + ' (HTTP ' + response.status + ')');
        }

        var result = await response.json();
        if (result && !result.success && window._aiHandleAiAuthError(result)) {
            throw new Error(result.error || '会话已过期');
        }

        return result;
    }

    async function callImageStatusApi(taskId) {
        var response = await fetch('api.php?action=aiImageStatus&taskId=' + encodeURIComponent(taskId), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        var result = await response.json();
        if (result && !result.success && window._aiHandleAiAuthError(result)) {
            var err = new Error(result.error || '会话已过期');
            err.isAuthError = true;
            throw err;
        }
        return result;
    }

    async function pollImageStatus(taskId, maxAttempts, interval) {
        maxAttempts = maxAttempts || 60;
        interval = interval || 3000;
        var attempts = 0;
        return await new Promise(function(resolve, reject) {
            var poll = async function() {
                attempts++;
                if (attempts > maxAttempts) {
                    reject(new Error('图片生成超时，请稍后重试'));
                    return;
                }

                try {
                    var result = await callImageStatusApi(taskId);
                    if (!result.success) {
                        reject(new Error(result.error || '查询图片状态失败'));
                        return;
                    }

                    if (result.status === 'completed') {
                        resolve(result.data);
                    } else if (result.status === 'failed') {
                        reject(new Error(result.data.error || '图片生成失败'));
                    } else {
                        setTimeout(poll, interval);
                    }
                } catch (e) {
                    if (e && e.isAuthError) {
                        reject(e);
                        return;
                    }
                    if (attempts < maxAttempts) {
                        setTimeout(poll, interval);
                    } else {
                        reject(e);
                    }
                }
            };
            setTimeout(poll, 1000);
        });
    }

    function renderImageResult(messagesContainer, images, prompt) {
        setTimeout(function () {
            var wrap = document.createElement('div');
            wrap.className = 'ai-message assistant';

            var avatar = document.createElement('div');
            avatar.className = 'ai-msg-avatar ai-msg-avatar-bot';
            avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';

            var bubbleWrap = document.createElement('div');
            bubbleWrap.className = 'ai-msg-bubble-wrap';
            var bubble = document.createElement('div');
            bubble.className = 'ai-msg-bubble';

            var grid = document.createElement('div');
            grid.className = 'ai-image-grid';
            grid.setAttribute('data-count', String(images.length));

            images.forEach(function (img, idx) {
                var item = document.createElement('div');
                item.className = 'ai-image-card';
                var url = normalizeGeneratedMediaUrl(img.url);
                if (!url && img.b64) url = 'data:image/png;base64,' + img.b64;
                if (!url) return;

                var imgEl = document.createElement('img');
                imgEl.src = url;
                imgEl.alt = prompt || '生成图片';
                imgEl.loading = 'lazy';
                imgEl.addEventListener('load', function () {
                    this.classList.add('ai-img-loaded');
                });
                attachImageErrorHandler(imgEl, item, url);
                if (imgEl.complete) imgEl.classList.add('ai-img-loaded');

                var actions = document.createElement('div');
                actions.className = 'ai-image-actions';
                var dlBtn = document.createElement('button');
                dlBtn.className = 'ai-image-action-btn';
                dlBtn.title = '下载';
                dlBtn.innerHTML = '<i data-feather="download" style="width:14px;height:14px;"></i>';
                dlBtn.addEventListener('click', function () {
                    downloadAsset(url, 'ai-image-' + Date.now() + '.png');
                });
                var openBtn = document.createElement('button');
                openBtn.className = 'ai-image-action-btn';
                openBtn.title = '新窗口打开';
                openBtn.innerHTML = '<i data-feather="external-link" style="width:14px;height:14px;"></i>';
                openBtn.addEventListener('click', function () {
                    window.open(url, '_blank');
                });
                actions.appendChild(openBtn);
                actions.appendChild(dlBtn);

                item.appendChild(imgEl);
                item.appendChild(actions);
                grid.appendChild(item);
            });

            bubble.appendChild(grid);

            if (prompt) {
                var promptEl = document.createElement('div');
                promptEl.className = 'ai-gen-prompt';
                promptEl.textContent = '提示词：' + prompt;
                bubble.appendChild(promptEl);
            }

            var actionsBar = document.createElement('div');
            actionsBar.className = 'ai-msg-actions';
            var copyBtn = document.createElement('button');
            copyBtn.className = 'ai-msg-action-btn';
            copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制';
            copyBtn.addEventListener('click', function () {
                copyTextToClipboard(prompt || '图片生成结果').then(function (ok) {
                    if (ok) {
                        copyBtn.textContent = '已复制';
                        setTimeout(function () { copyBtn.innerHTML = copyBtn.innerHTML; }, 2000);
                    }
                });
            });
            actionsBar.appendChild(copyBtn);
            bubble.appendChild(actionsBar);

            var timeWrap = document.createElement('div');
            timeWrap.className = 'ai-msg-timestamp';
            timeWrap.textContent = formatGenTimestamp(new Date().toISOString());

            bubbleWrap.appendChild(bubble);
            bubbleWrap.appendChild(timeWrap);
            wrap.appendChild(avatar);
            wrap.appendChild(bubbleWrap);

            messagesContainer.appendChild(wrap);
            if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
        }, 0);
    }

    function renderImageLoading(messagesContainer, prompt, n, size) {
        var wrap = document.createElement('div');
        wrap.className = 'ai-message assistant ai-gen-loading';

        var avatar = document.createElement('div');
        avatar.className = 'ai-msg-avatar ai-msg-avatar-bot';
        avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';

        var bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'ai-msg-bubble-wrap';
        var bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble ai-gen-item ai-gen-loading';

        var loadingHeader = document.createElement('div');
        loadingHeader.className = 'ai-gen-loading-header';
        loadingHeader.innerHTML = '<div class="ai-gen-spinner"></div><div class="ai-gen-loading-text">图片生成中<span class="ai-gen-loading-dots"></span>&nbsp;&nbsp;&nbsp;</div>';
        bubble.appendChild(loadingHeader);

        var grid = document.createElement('div');
        grid.className = 'ai-image-grid';
        n = n || 1;
        grid.setAttribute('data-count', String(n));
        size = size || '1280x720';
        var aspect = '4 / 3';
        if (size.indexOf('x') !== -1) {
            var parts = size.split('x');
            if (parts.length === 2) {
                aspect = parts[0] + ' / ' + parts[1];
            }
        }
        for (var i = 0; i < n; i++) {
            var item = document.createElement('div');
            item.className = 'ai-image-card ai-skeleton-card';
            item.style.aspectRatio = aspect;
            item.style.setProperty('--ai-skel-delay', (i * 0.15) + 's');
            grid.appendChild(item);
        }
        bubble.appendChild(grid);

        if (prompt) {
            var p = document.createElement('div');
            p.className = 'ai-gen-prompt';
            p.textContent = '提示词：' + prompt;
            bubble.appendChild(p);
        }

        bubbleWrap.appendChild(bubble);
        wrap.appendChild(avatar);
        wrap.appendChild(bubbleWrap);
        messagesContainer.appendChild(wrap);
        return wrap;
    }

    function updateImageResult(wrap, images, prompt) {
        wrap.classList.remove('ai-gen-loading');
        var bubbleWrap = wrap.querySelector('.ai-msg-bubble-wrap');
        var bubble = wrap.querySelector('.ai-msg-bubble');
        if (!bubble) return;
        bubble.classList.remove('ai-gen-loading');
        
        var header = bubble.querySelector('.ai-gen-loading-header');
        if (header && header.parentNode) header.parentNode.removeChild(header);

        var grid = bubble.querySelector('.ai-image-grid');
        if (!grid) return;
        
        var items = grid.querySelectorAll('.ai-image-card');
        images.forEach(function (img, idx) {
            var item = items[idx];
            if (!item) {
                item = document.createElement('div');
                item.className = 'ai-image-card';
                grid.appendChild(item);
            }
            item.classList.remove('ai-skeleton-card');
            
            var url = normalizeGeneratedMediaUrl(img.url);
            if (!url && img.b64) url = 'data:image/png;base64,' + img.b64;
            if (!url) return;

            var imgEl = document.createElement('img');
            imgEl.src = url;
            imgEl.alt = prompt || '生成图片';
            imgEl.loading = 'lazy';
            imgEl.addEventListener('load', function () {
                this.classList.add('ai-img-loaded');
            });
            attachImageErrorHandler(imgEl, item, url);
            if (imgEl.complete) imgEl.classList.add('ai-img-loaded');

            var actions = document.createElement('div');
            actions.className = 'ai-image-actions';
            var dlBtn = document.createElement('button');
            dlBtn.className = 'ai-image-action-btn';
            dlBtn.title = '下载';
            dlBtn.innerHTML = '<i data-feather="download" style="width:14px;height:14px;"></i>';
            dlBtn.addEventListener('click', function () { downloadAsset(url, 'ai-image-' + Date.now() + '.png'); });
            var openBtn = document.createElement('button');
            openBtn.className = 'ai-image-action-btn';
            openBtn.title = '新窗口打开';
            openBtn.innerHTML = '<i data-feather="external-link" style="width:14px;height:14px;"></i>';
            openBtn.addEventListener('click', function () { window.open(url, '_blank'); });
            actions.appendChild(openBtn);
            actions.appendChild(dlBtn);

            item.appendChild(imgEl);
            item.appendChild(actions);
        });

        for (var i = images.length; i < items.length; i++) {
            if (items[i] && items[i].parentNode) {
                items[i].parentNode.removeChild(items[i]);
            }
        }

        var actionsBar = document.createElement('div');
        actionsBar.className = 'ai-msg-actions';
        var copyBtn = document.createElement('button');
        copyBtn.className = 'ai-msg-action-btn';
        copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制';
        copyBtn.addEventListener('click', function () {
            copyTextToClipboard(prompt || '图片生成结果').then(function (ok) {
                if (ok) {
                    copyBtn.textContent = '已复制';
                    setTimeout(function () { copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制'; }, 2000);
                }
            });
        });
        actionsBar.appendChild(copyBtn);
        bubble.appendChild(actionsBar);

        var timeWrap = document.createElement('div');
        timeWrap.className = 'ai-msg-timestamp';
        timeWrap.textContent = formatGenTimestamp(new Date().toISOString());
        if (bubbleWrap) {
            bubbleWrap.appendChild(timeWrap);
        }

        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }

    function renderHistoricalImageItem(messagesContainer, entry) {
        if (!entry.images || entry.images.length === 0) return;
        var wrap = document.createElement('div');
        wrap.className = 'ai-message assistant';
        wrap.setAttribute('data-history', 'image');
        wrap.dataset.historyId = entry.id;

        var avatar = document.createElement('div');
        avatar.className = 'ai-msg-avatar ai-msg-avatar-bot';
        avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';

        var bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'ai-msg-bubble-wrap';
        var bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble';

        var grid = document.createElement('div');
        grid.className = 'ai-image-grid';
        grid.setAttribute('data-count', String(entry.images.length));

        entry.images.forEach(function (img) {
            var url = normalizeGeneratedMediaUrl(img.url);
            if (!url && img.b64) url = 'data:image/png;base64,' + img.b64;
            if (!url) return;
            var item = document.createElement('div');
            item.className = 'ai-image-card ai-skeleton-card';
            var imgEl = document.createElement('img');
            imgEl.src = url;
            imgEl.alt = entry.prompt || '生成图片';
            imgEl.loading = 'lazy';
            imgEl.addEventListener('load', function () {
                this.classList.add('ai-img-loaded');
            });
            attachImageErrorHandler(imgEl, item, url);
            if (imgEl.complete) imgEl.classList.add('ai-img-loaded');
            var actions = document.createElement('div');
            actions.className = 'ai-image-actions';
            var dlBtn = document.createElement('button');
            dlBtn.className = 'ai-image-action-btn';
            dlBtn.title = '下载';
            dlBtn.innerHTML = '<i data-feather="download" style="width:14px;height:14px;"></i>';
            dlBtn.addEventListener('click', function () { downloadAsset(url, 'ai-image-' + Date.now() + '.png'); });
            var openBtn = document.createElement('button');
            openBtn.className = 'ai-image-action-btn';
            openBtn.title = '新窗口打开';
            openBtn.innerHTML = '<i data-feather="external-link" style="width:14px;height:14px;"></i>';
            openBtn.addEventListener('click', function () { window.open(url, '_blank'); });
            actions.appendChild(openBtn);
            actions.appendChild(dlBtn);
            item.appendChild(imgEl);
            item.appendChild(actions);
            grid.appendChild(item);
        });

        bubble.appendChild(grid);

        var promptEl = document.createElement('div');
        promptEl.className = 'ai-gen-prompt';
        promptEl.textContent = '提示词：' + (entry.prompt || '');
        bubble.appendChild(promptEl);

        var timeWrap = document.createElement('div');
        timeWrap.className = 'ai-msg-timestamp';
        timeWrap.textContent = formatGenTimestamp(entry.createdAt);

        bubbleWrap.appendChild(bubble);
        bubbleWrap.appendChild(timeWrap);
        wrap.appendChild(avatar);
        wrap.appendChild(bubbleWrap);

        messagesContainer.insertBefore(wrap, messagesContainer.firstChild);
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }

    window.generateImage = async function generateImage() {
        if (!S.els.input) return;
        var prompt = S.els.input.value.trim();
        if (!prompt) return;

        if (S.isGenerating) {
            showToast('请等待当前任务完成', 'error');
            return;
        }

        var modelId = S.selectedModelByMode.image || '';
        var models = window._aiGetModelsByType('image');
        if (models.length === 0) {
            showToast('未配置图片生成模型，请联系管理员', 'error');
            return;
        }
        if (!modelId) {
            modelId = models[0].id;
            S.selectedModelByMode.image = modelId;
        }

        var sizeEl = getEl('aiImageSize');
        var countEl = getEl('aiImageCount');
        var size = sizeEl ? sizeEl.value : '1280x720';
        var n = countEl ? parseInt(countEl.value, 10) || 1 : 1;

        var messages = getEl('aiMessages');
        if (!messages) return;

        showMessagePanel();

        var titleEl = getEl('aiHeaderTitle');
        if (titleEl) titleEl.textContent = 'AI 图像生成';
        updateHeaderSub('已提交到后台任务...');

        S.isGenerating = true;
        var loadingEl = renderImageLoading(messages, prompt, n, size);
        S.els.input.value = '';
        autoResizeTextarea(S.els.input);
        setInputEnabled(false);
        updateSendButtonState();

        var recordId = 'gen_img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        var pendingEntry = {
            id: recordId,
            prompt: prompt,
            images: [],
            createdAt: new Date().toISOString(),
            isStreaming: true,
            status: 'pending'
        };
        S.imageHistory.unshift(pendingEntry);
        if (S.imageHistory.length > 50) S.imageHistory = S.imageHistory.slice(0, 50);
        saveGenHistory();
        window.renderChatList();

        try {
            var createResult = await callImageApi(prompt, modelId, size, n);
            if (!createResult.success) {
                showToast(createResult.error || '图片任务创建失败', 'error');
                if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
                for (var ri = 0; ri < S.imageHistory.length; ri++) {
                    if (S.imageHistory[ri].id === recordId) {
                        S.imageHistory.splice(ri, 1);
                        break;
                    }
                }
                saveGenHistory();
                window.renderChatList();
                S.isGenerating = false;
                setInputEnabled(true);
                updateSendButtonState();
                return;
            }

            var taskId = createResult.taskId;
            for (var ri3 = 0; ri3 < S.imageHistory.length; ri3++) {
                if (S.imageHistory[ri3].id === recordId) {
                    S.imageHistory[ri3].taskId = taskId;
                    break;
                }
            }
            saveGenHistory();
            window.renderChatList();

            if (loadingEl && loadingEl.parentNode) {
                loadingEl.classList.remove('ai-gen-loading');
                var loadHeader = loadingEl.querySelector('.ai-gen-loading-header');
                if (loadHeader) {
                    loadHeader.innerHTML = '<div class="ai-gen-spinner"></div><div class="ai-gen-loading-text">任务已提交到后台执行&nbsp;&nbsp;<span style="background:#3b82f6;font-size:11px;padding:2px 8px;border-radius:4px;color:#fff;">处理中</span></div>';
                }
            }

            pollSingleImageTask(taskId, loadingEl, prompt, recordId);

        } catch (e) {
            if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
            showToast('网络错误：' + (e.message || e), 'error');
            for (var ri2 = 0; ri2 < S.imageHistory.length; ri2++) {
                if (S.imageHistory[ri2].id === recordId) {
                    S.imageHistory.splice(ri2, 1);
                    break;
                }
            }
            saveGenHistory();
            window.renderChatList();
            S.isGenerating = false;
            setInputEnabled(true);
            updateSendButtonState();
        }
    };

    function pollSingleImageTask(taskId, loadingEl, prompt, recordId) {
        var attempts = 0;
        var maxAttempts = 100;
        var entry = registerPoll(taskId, 'image');
        var signal = entry.controller ? entry.controller.signal : undefined;

        (function poll() {
            attempts++;
            if (attempts > maxAttempts || !loadingEl || !loadingEl.parentNode) {
                abortPoll(taskId);
                return;
            }
            if (signal && signal.aborted) return;

            var fetchOpts = { method: 'GET' };
            if (signal) fetchOpts.signal = signal;
            fetch('api.php?action=aiImageStatus&taskId=' + encodeURIComponent(taskId), fetchOpts)
                .then(function(r) { return r.json(); })
                .then(function(result) {
                    if (signal && signal.aborted) return;
                    if (!result.success) {
                        setTimeout(poll, 3000);
                        return;
                    }

                    if (result.status === 'completed' && result.data && result.data.images && result.data.images.length > 0) {
                        abortPoll(taskId);
                        updateImageResult(loadingEl, result.data.images, prompt);
                        for (var ri = 0; ri < S.imageHistory.length; ri++) {
                            if (S.imageHistory[ri].id === recordId) {
                                S.imageHistory[ri].images = result.data.images;
                                S.imageHistory[ri].isStreaming = false;
                                S.imageHistory[ri].status = 'completed';
                                break;
                            }
                        }
                        saveGenHistory();
                        window.renderChatList();
                        scrollToBottom();
                        updateHeaderSub('图片生成完成');
                        S.isGenerating = false;
                        setInputEnabled(true);
                        updateSendButtonState();
                    } else if (result.status === 'failed') {
                        abortPoll(taskId);
                        if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
                        showToast((result.data && result.data.error) || '图片生成失败', 'error');
                        for (var ri2 = 0; ri2 < S.imageHistory.length; ri2++) {
                            if (S.imageHistory[ri2].id === recordId) {
                                S.imageHistory.splice(ri2, 1);
                                break;
                            }
                        }
                        saveGenHistory();
                        window.renderChatList();
                        S.isGenerating = false;
                        setInputEnabled(true);
                        updateSendButtonState();
                    } else {
                        var loadHeader = loadingEl.querySelector('.ai-gen-loading-header');
                        if (loadHeader) {
                            loadHeader.innerHTML = '<div class="ai-gen-spinner"></div><div class="ai-gen-loading-text">任务已提交到后台执行&nbsp;&nbsp;<span style="background:#3b82f6;font-size:11px;padding:2px 8px;border-radius:4px;color:#fff;">处理中</span></div>';
                        }
                        var delay = Math.min(3000 + Math.floor(attempts / 5) * 2000, 8000);
                        setTimeout(poll, delay);
                    }
                })
                .catch(function(e) {
                    if (e && (e.name === 'AbortError' || (signal && signal.aborted))) return;
                    setTimeout(poll, 5000);
                });
        })();
    }

    // ==================== Video Generation ====================

    async function callVideoCreateApi(prompt, model, imageUrl) {
        var csrfToken = '';
        try {
            if (typeof ensureCsrfToken === 'function') {
                csrfToken = await ensureCsrfToken() || '';
            }
        } catch (e) { /* ignore */ }

        var headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        var body = { prompt: prompt, model: model };
        if (imageUrl) body.imageUrl = imageUrl;

        var response = await fetch('api.php?action=aiVideoCreate', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
        var result = await response.json();
        if (result && !result.success && window._aiHandleAiAuthError(result)) {
            throw new Error(result.error || '会话已过期');
        }
        return result;
    }

    async function callVideoStatusApi(taskId, videoId, model) {
        var params = 'model=' + encodeURIComponent(model);
        if (taskId) params += '&taskId=' + encodeURIComponent(taskId);
        if (videoId) params += '&videoId=' + encodeURIComponent(videoId);
        var response = await fetch('api.php?action=aiVideoStatus&' + params, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        var result = await response.json();
        if (result && !result.success && window._aiHandleAiAuthError(result)) {
            var err = new Error(result.error || '会话已过期');
            err.isAuthError = true;
            throw err;
        }
        return result;
    }

    function renderVideoLoading(messagesContainer, prompt) {
        var wrap = document.createElement('div');
        wrap.className = 'ai-message assistant ai-gen-loading';

        var avatar = document.createElement('div');
        avatar.className = 'ai-msg-avatar ai-msg-avatar-bot';
        avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';

        var bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'ai-msg-bubble-wrap';
        var bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble ai-gen-item ai-gen-loading';

        var loadingHeader = document.createElement('div');
        loadingHeader.className = 'ai-gen-loading-header';
        loadingHeader.innerHTML = '<div class="ai-gen-spinner"></div><div class="ai-gen-loading-text">视频生成中，请耐心等待<span class="ai-gen-loading-dots"></span>&nbsp;&nbsp;&nbsp;</div>';
        bubble.appendChild(loadingHeader);

        var grid = document.createElement('div');
        grid.className = 'ai-image-grid';
        grid.setAttribute('data-count', '1');

        var videoPlaceholder = document.createElement('div');
        videoPlaceholder.className = 'ai-video-placeholder ai-image-card ai-skeleton-card';
        videoPlaceholder.style.aspectRatio = '1280 / 720';
        grid.appendChild(videoPlaceholder);
        bubble.appendChild(grid);

        var progressBar = document.createElement('div');
        progressBar.className = 'ai-gen-progress-bar';
        progressBar.innerHTML = '<div class="ai-gen-progress-bar-track"></div>';
        bubble.appendChild(progressBar);

        if (prompt) {
            var p = document.createElement('div');
            p.className = 'ai-gen-prompt';
            p.textContent = '提示词：' + prompt;
            bubble.appendChild(p);
        }

        bubbleWrap.appendChild(bubble);
        wrap.appendChild(avatar);
        wrap.appendChild(bubbleWrap);
        messagesContainer.appendChild(wrap);
        return wrap;
    }

    function updateVideoResult(wrap, videoUrl, prompt) {
        wrap.classList.remove('ai-gen-loading');
        var bubble = wrap.querySelector('.ai-msg-bubble');
        if (!bubble) return;
        bubble.classList.remove('ai-gen-loading');

        var loadingHeader = bubble.querySelector('.ai-gen-loading-header');
        if (loadingHeader && loadingHeader.parentNode) loadingHeader.parentNode.removeChild(loadingHeader);

        var progressBar = bubble.querySelector('.ai-gen-progress-bar');
        if (progressBar && progressBar.parentNode) progressBar.parentNode.removeChild(progressBar);

        var videoPlaceholder = bubble.querySelector('.ai-video-placeholder');
        if (videoPlaceholder) {
            var videoEl = document.createElement('video');
            videoEl.className = 'ai-video-player';
            videoEl.src = normalizeGeneratedMediaUrl(videoUrl);
            videoEl.controls = true;
            videoEl.playsInline = true;
            videoEl.autoplay = true;
            videoEl.muted = true;
            videoPlaceholder.appendChild(videoEl);

            var revealVideo = function () {
                videoEl.classList.add('ai-video-loaded');
                videoPlaceholder.classList.remove('ai-skeleton-card');
            };
            videoEl.addEventListener('canplay', revealVideo);
            if (videoEl.readyState >= 3) revealVideo();
            setTimeout(function () {
                if (!videoEl.classList.contains('ai-video-loaded')) revealVideo();
            }, 3000);

            var actions = document.createElement('div');
            actions.className = 'ai-image-actions';
            var dlBtn = document.createElement('button');
            dlBtn.className = 'ai-image-action-btn';
            dlBtn.title = '下载';
            dlBtn.innerHTML = '<i data-feather="download" style="width:14px;height:14px;"></i> 下载视频';
            dlBtn.addEventListener('click', function () {
                downloadAsset(normalizeGeneratedMediaUrl(videoUrl), 'ai-video-' + Date.now() + '.mp4');
            });
            actions.appendChild(dlBtn);
            videoPlaceholder.appendChild(actions);
        }

        var promptEl = bubble.querySelector('.ai-gen-prompt');
        if (promptEl && prompt) {
            promptEl.textContent = '提示词：' + prompt;
        }

        var timeWrap = document.createElement('div');
        timeWrap.className = 'ai-msg-timestamp';
        timeWrap.textContent = formatGenTimestamp(new Date().toISOString());
        bubble.appendChild(timeWrap);

        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }

    function updateVideoLoadingProgress(wrap, progressText) {
        if (!wrap) return;
        var track = wrap.querySelector('.ai-gen-progress-bar-track');
        var labelEl = wrap.querySelector('.ai-gen-loading-text');
        var pct = null;
        if (progressText !== null && progressText !== undefined && progressText !== '') {
            var s = String(progressText).trim();
            var m = s.match(/(\d+(?:\.\d+)?)/);
            if (m) {
                var num = parseFloat(m[1]);
                if (s.indexOf('%') !== -1) {
                    pct = num;
                } else if (num <= 1 && s.indexOf('1') === -1) {
                    pct = num * 100;
                } else {
                    pct = num;
                }
                pct = Math.max(5, Math.min(99, pct));
            }
        }
        if (track) {
            if (pct !== null) {
                track.classList.remove('ai-gen-progress-indeterminate');
                track.style.width = pct + '%';
            } else {
                track.style.width = '40%';
                track.classList.add('ai-gen-progress-indeterminate');
            }
        }
        if (labelEl) {
            var baseText = '视频生成中，请耐心等待';
            if (pct !== null) {
                baseText = '视频生成中  ' + Math.round(pct) + '%';
            }
            labelEl.innerHTML = baseText + '<span class="ai-gen-loading-dots"></span>';
        }
    }

    function renderVideoResult(messagesContainer, videoUrl, prompt) {
        var wrap = document.createElement('div');
        wrap.className = 'ai-message assistant';

        var avatar = document.createElement('div');
        avatar.className = 'ai-msg-avatar ai-msg-avatar-bot';
        avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';

        var bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'ai-msg-bubble-wrap';
        var bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble';

        var videoEl = document.createElement('video');
        videoEl.className = 'ai-video-player';
        videoEl.src = normalizeGeneratedMediaUrl(videoUrl);
        videoEl.controls = true;
        videoEl.playsInline = true;
        bubble.appendChild(videoEl);

        var actions = document.createElement('div');
        actions.className = 'ai-image-actions';
        var dlBtn = document.createElement('button');
        dlBtn.className = 'ai-image-action-btn';
        dlBtn.title = '下载';
        dlBtn.innerHTML = '<i data-feather="download" style="width:14px;height:14px;"></i> 下载视频';
        dlBtn.addEventListener('click', function () {
            downloadAsset(normalizeGeneratedMediaUrl(videoUrl), 'ai-video-' + Date.now() + '.mp4');
        });
        actions.appendChild(dlBtn);
        bubble.appendChild(actions);

        if (prompt) {
            var promptEl = document.createElement('div');
            promptEl.className = 'ai-gen-prompt';
            promptEl.textContent = '提示词：' + prompt;
            bubble.appendChild(promptEl);
        }

        var timeWrap = document.createElement('div');
        timeWrap.className = 'ai-msg-timestamp';
        timeWrap.textContent = formatGenTimestamp(new Date().toISOString());

        bubbleWrap.appendChild(bubble);
        bubbleWrap.appendChild(timeWrap);
        wrap.appendChild(avatar);
        wrap.appendChild(bubbleWrap);

        messagesContainer.appendChild(wrap);
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }

    function renderHistoricalVideoItem(messagesContainer, entry) {
        if (!entry.videoUrl) return;
        var wrap = document.createElement('div');
        wrap.className = 'ai-message assistant';
        wrap.setAttribute('data-history', 'video');
        wrap.dataset.historyId = entry.id;

        var avatar = document.createElement('div');
        avatar.className = 'ai-msg-avatar ai-msg-avatar-bot';
        avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';

        var bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'ai-msg-bubble-wrap';
        var bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble';

        var videoPlaceholder = document.createElement('div');
        videoPlaceholder.className = 'ai-video-placeholder ai-image-card ai-skeleton-card';

        var videoEl = document.createElement('video');
        videoEl.className = 'ai-video-player';
        videoEl.src = normalizeGeneratedMediaUrl(entry.videoUrl);
        videoEl.controls = true;
        videoEl.playsInline = true;
        videoEl.addEventListener('canplay', function() {
            this.classList.add('ai-video-loaded');
            videoPlaceholder.classList.remove('ai-skeleton-card');
        });

        var actions = document.createElement('div');
        actions.className = 'ai-image-actions';
        var dlBtn = document.createElement('button');
        dlBtn.className = 'ai-image-action-btn';
        dlBtn.title = '下载';
        dlBtn.innerHTML = '<i data-feather="download" style="width:14px;height:14px;"></i> 下载视频';
        dlBtn.addEventListener('click', function () { downloadAsset(normalizeGeneratedMediaUrl(entry.videoUrl), 'ai-video-' + Date.now() + '.mp4'); });
        actions.appendChild(dlBtn);
        
        videoPlaceholder.appendChild(videoEl);
        videoPlaceholder.appendChild(actions);
        bubble.appendChild(videoPlaceholder);

        var promptEl = document.createElement('div');
        promptEl.className = 'ai-gen-prompt';
        promptEl.textContent = '提示词：' + (entry.prompt || '');
        bubble.appendChild(promptEl);

        var timeWrap = document.createElement('div');
        timeWrap.className = 'ai-msg-timestamp';
        timeWrap.textContent = formatGenTimestamp(entry.createdAt);

        bubbleWrap.appendChild(bubble);
        bubbleWrap.appendChild(timeWrap);
        wrap.appendChild(avatar);
        wrap.appendChild(bubbleWrap);

        messagesContainer.insertBefore(wrap, messagesContainer.firstChild);
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    }

    window.generateVideo = async function generateVideo() {
        if (!S.els.input) return;
        var prompt = S.els.input.value.trim();
        if (!prompt) return;

        if (S.isGenerating) {
            showToast('请等待当前任务完成', 'error');
            return;
        }

        var modelId = S.selectedModelByMode.video || '';
        var models = window._aiGetModelsByType('video');
        if (models.length === 0) {
            showToast('未配置视频生成模型，请联系管理员', 'error');
            return;
        }
        if (!modelId) {
            modelId = models[0].id;
            S.selectedModelByMode.video = modelId;
        }

        var imageUrlEl = getEl('aiVideoImageUrl');
        var imageUrl = imageUrlEl ? imageUrlEl.value.trim() : '';

        var messages = getEl('aiMessages');
        if (!messages) return;

        showMessagePanel();
        var vidTitleEl = getEl('aiHeaderTitle');
        if (vidTitleEl) vidTitleEl.textContent = 'AI 视频生成';
        updateHeaderSub('已提交到后台任务...');

        S.isGenerating = true;
        var loadingEl = renderVideoLoading(messages, prompt);
        S.els.input.value = '';
        autoResizeTextarea(S.els.input);
        setInputEnabled(false);
        updateSendButtonState();

        var recordId = 'gen_vid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        var pendingEntry = {
            id: recordId,
            prompt: prompt,
            videoUrl: '',
            imageUrl: imageUrl,
            createdAt: new Date().toISOString(),
            isStreaming: true,
            status: 'pending'
        };
        S.videoHistory.unshift(pendingEntry);
        if (S.videoHistory.length > 50) S.videoHistory = S.videoHistory.slice(0, 50);
        saveGenHistory();
        window.renderChatList();

        try {
            var createResult = await callVideoCreateApi(prompt, modelId, imageUrl);
            if (!createResult.success) {
                if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
                showToast(createResult.error || '视频任务创建失败', 'error');
                for (var ri = 0; ri < S.videoHistory.length; ri++) {
                    if (S.videoHistory[ri].id === recordId) {
                        S.videoHistory.splice(ri, 1);
                        break;
                    }
                }
                saveGenHistory();
                window.renderChatList();
                S.isGenerating = false;
                setInputEnabled(true);
                updateSendButtonState();
                return;
            }

            var taskId = createResult.taskId || '';
            for (var ri3 = 0; ri3 < S.videoHistory.length; ri3++) {
                if (S.videoHistory[ri3].id === recordId) {
                    S.videoHistory[ri3].taskId = taskId;
                    break;
                }
            }
            saveGenHistory();
            window.renderChatList();

            if (loadingEl && loadingEl.parentNode) {
                loadingEl.classList.remove('ai-gen-loading');
                var loadHeader = loadingEl.querySelector('.ai-gen-loading-header');
                if (loadHeader) {
                    loadHeader.innerHTML = '<div class="ai-gen-spinner"></div><div class="ai-gen-loading-text">任务已提交到后台执行&nbsp;&nbsp;<span style="background:#3b82f6;font-size:11px;padding:2px 8px;border-radius:4px;color:#fff;">处理中</span></div>';
                }
            }

            pollSingleVideoTask(taskId, modelId, loadingEl, prompt, imageUrl, recordId);

        } catch (e) {
            if (loadingEl && loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
            showToast('网络错误：' + (e.message || e), 'error');
            for (var ri2 = 0; ri2 < S.videoHistory.length; ri2++) {
                if (S.videoHistory[ri2].id === recordId) {
                    S.videoHistory.splice(ri2, 1);
                    break;
                }
            }
            saveGenHistory();
            window.renderChatList();
            S.isGenerating = false;
            setInputEnabled(true);
            updateSendButtonState();
        }
    };

    function pollSingleVideoTask(taskId, modelId, loadingEl, prompt, imageUrl, recordId) {
        var attempts = 0;
        var maxAttempts = 120;
        var consecutiveErrors = 0;
        var entry = registerPoll(taskId, 'video');
        var signal = entry.controller ? entry.controller.signal : undefined;

        function removeVideoRecord(rid) {
            for (var ri = 0; ri < S.videoHistory.length; ri++) {
                if (S.videoHistory[ri].id === rid) {
                    S.videoHistory.splice(ri, 1);
                    break;
                }
            }
            saveGenHistory();
            window.renderChatList();
        }

        (function poll() {
            attempts++;
            if (signal && signal.aborted) return;
            if (attempts > maxAttempts) {
                abortPoll(taskId);
                if (loadingEl && loadingEl.parentNode) {
                    var errorBubble = '<div class="ai-msg-bubble ai-error-bubble">' +
                        '<i data-feather="alert-circle" style="width:16px;height:16px;flex-shrink:0;"></i>' +
                        '<span>视频生成超时，请稍后重试</span></div>';
                    loadingEl.classList.remove('ai-gen-loading');
                    var bubbleWrap = loadingEl.querySelector('.ai-msg-bubble-wrap');
                    if (bubbleWrap) {
                        bubbleWrap.innerHTML = errorBubble;
                        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
                    }
                }
                showToast('视频生成超时', 'error');
                removeVideoRecord(recordId);
                S.isGenerating = false;
                setInputEnabled(true);
                updateSendButtonState();
                return;
            }
            if (!loadingEl || !loadingEl.parentNode) return;

            var fetchOpts = { method: 'GET' };
            if (signal) fetchOpts.signal = signal;
            fetch('api.php?action=aiVideoStatus&model=' + encodeURIComponent(modelId) + '&taskId=' + encodeURIComponent(taskId), fetchOpts)
                .then(function(r) { return r.json(); })
                .then(function(st) {
                    if (signal && signal.aborted) return;
                    if (st.success) {
                        if (st.status === 'completed' && st.videoUrl) {
                            abortPoll(taskId);
                            updateVideoResult(loadingEl, st.videoUrl, prompt);
                            for (var ri = 0; ri < S.videoHistory.length; ri++) {
                                if (S.videoHistory[ri].id === recordId) {
                                    S.videoHistory[ri].videoUrl = st.videoUrl;
                                    S.videoHistory[ri].isStreaming = false;
                                    S.videoHistory[ri].status = 'completed';
                                    break;
                                }
                            }
                            saveGenHistory();
                            window.renderChatList();
                            showToast('视频生成完成', 'success');
                            scrollToBottom();
                            updateHeaderSub('视频生成完成');
                            S.isGenerating = false;
                            setInputEnabled(true);
                            updateSendButtonState();
                        } else if (st.status === 'failed') {
                            abortPoll(taskId);
                            if (loadingEl && loadingEl.parentNode) {
                                var errorBubble = '<div class="ai-msg-bubble ai-error-bubble">' +
                                    '<i data-feather="alert-circle" style="width:16px;height:16px;flex-shrink:0;"></i>' +
                                    '<span>' + (st.message || st.error || '视频生成失败') + '</span></div>';
                                loadingEl.classList.remove('ai-gen-loading');
                                var bubbleWrap = loadingEl.querySelector('.ai-msg-bubble-wrap');
                                if (bubbleWrap) {
                                    bubbleWrap.innerHTML = errorBubble;
                                    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
                                }
                            }
                            showToast(st.message || '视频生成失败', 'error');
                            removeVideoRecord(recordId);
                            S.isGenerating = false;
                            setInputEnabled(true);
                            updateSendButtonState();
                            if (typeof updateTaskBadge === 'function') updateTaskBadge();
                        } else {
                            if (st.progress) {
                                updateVideoLoadingProgress(loadingEl, st.progress);
                            }
                            var delay = Math.min(5000 + Math.floor(attempts / 4) * 3000, 15000);
                            setTimeout(poll, delay);
                        }
                    } else {
                        consecutiveErrors++;
                        if (consecutiveErrors >= 3) {
                            abortPoll(taskId);
                            if (loadingEl && loadingEl.parentNode) {
                                var errorBubble = '<div class="ai-msg-bubble ai-error-bubble">' +
                                    '<i data-feather="alert-circle" style="width:16px;height:16px;flex-shrink:0;"></i>' +
                                    '<span>' + (st.error || '查询视频状态失败') + '</span></div>';
                                loadingEl.classList.remove('ai-gen-loading');
                                var bubbleWrap = loadingEl.querySelector('.ai-msg-bubble-wrap');
                                if (bubbleWrap) {
                                    bubbleWrap.innerHTML = errorBubble;
                                    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
                                }
                            }
                            showToast(st.error || '查询视频状态失败', 'error');
                            removeVideoRecord(recordId);
                            S.isGenerating = false;
                            setInputEnabled(true);
                            updateSendButtonState();
                        } else {
                            setTimeout(poll, 5000);
                        }
                    }
                })
                .catch(function(e) {
                    if (e && (e.name === 'AbortError' || (signal && signal.aborted))) return;
                    consecutiveErrors++;
                    if (consecutiveErrors >= 3) {
                        abortPoll(taskId);
                        if (loadingEl && loadingEl.parentNode) {
                            var errorBubble = '<div class="ai-msg-bubble ai-error-bubble">' +
                                '<i data-feather="alert-circle" style="width:16px;height:16px;flex-shrink:0;"></i>' +
                                '<span>网络错误：' + (e.message || e) + '</span></div>';
                            loadingEl.classList.remove('ai-gen-loading');
                            var bubbleWrap = loadingEl.querySelector('.ai-msg-bubble-wrap');
                            if (bubbleWrap) {
                                bubbleWrap.innerHTML = errorBubble;
                                if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
                            }
                        }
                        showToast('网络错误：' + (e.message || e), 'error');
                        removeVideoRecord(recordId);
                        S.isGenerating = false;
                        setInputEnabled(true);
                        updateSendButtonState();
                    } else {
                        setTimeout(poll, 5000);
                    }
                });
        })();
    }

    // ==================== History Item Loading / Deletion / Cancel ====================

    window.loadHistoryItem = function loadHistoryItem(type, itemId) {
        var messages = getEl('aiMessages');
        if (!messages) return;

        messages.innerHTML = '';

        if (S.els.welcome) S.els.welcome.style.display = 'none';
        if (messages) messages.style.display = 'flex';

        if (type === 'image') {
            var entry = null;
            for (var i = 0; i < S.imageHistory.length; i++) {
                if (S.imageHistory[i].id === itemId) {
                    entry = S.imageHistory[i];
                    break;
                }
            }
            if (!entry) return;
            renderHistoricalImageItem(messages, entry);
            S.aiMode = 'image';
            var tabs = document.querySelectorAll('.ai-input-mode-tab');
            tabs.forEach(function (tab) {
                tab.classList.toggle('active', tab.dataset.mode === 'image');
            });
            var imageToolbar = getEl('aiImageToolbar');
            var videoToolbar = getEl('aiVideoToolbar');
            if (imageToolbar) imageToolbar.style.display = '';
            if (videoToolbar) videoToolbar.style.display = 'none';
            var inputEl = getEl('aiInput');
            if (inputEl) inputEl.placeholder = '描述你想生成的图片...';
            var titleEl = getEl('aiHeaderTitle');
            if (titleEl) titleEl.textContent = 'AI 图像生成';
            updateHeaderSub('输入描述，生成高质量图片');
            window._aiEnsureModeModelSelected('image');
            window._aiUpdateModelSelectorDisplay();
        } else if (type === 'video') {
            var vEntry = null;
            for (var j = 0; j < S.videoHistory.length; j++) {
                if (S.videoHistory[j].id === itemId) {
                    vEntry = S.videoHistory[j];
                    break;
                }
            }
            if (!vEntry) return;
            renderHistoricalVideoItem(messages, vEntry);
            S.aiMode = 'video';
            var tabs2 = document.querySelectorAll('.ai-input-mode-tab');
            tabs2.forEach(function (tab) {
                tab.classList.toggle('active', tab.dataset.mode === 'video');
            });
            var imageToolbar2 = getEl('aiImageToolbar');
            var videoToolbar2 = getEl('aiVideoToolbar');
            if (imageToolbar2) imageToolbar2.style.display = 'none';
            if (videoToolbar2) videoToolbar2.style.display = '';
            var inputEl2 = getEl('aiInput');
            if (inputEl2) inputEl2.placeholder = '描述你想生成的视频...';
            var titleEl2 = getEl('aiHeaderTitle');
            if (titleEl2) titleEl2.textContent = 'AI 视频生成';
            updateHeaderSub('输入描述，生成创意视频');
            window._aiEnsureModeModelSelected('video');
            window._aiUpdateModelSelectorDisplay();
        } else {
            window.selectChat(itemId);
            return;
        }

        S.currentChatId = itemId;
        S.lastChatIdByMode[S.aiMode] = itemId;
        window.renderChatList();
        scrollToBottom();
        closeSidebar();
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
    };

    window.deleteHistoryItem = function deleteHistoryItem(type, itemId) {
        if (type === 'chat') {
            var streamState = getChatStreamState(itemId);
            if (streamState && streamState.abortController) {
                streamState.abortController.abort();
            }

            for (var i = 0; i < S.chatHistory.length; i++) {
                if (S.chatHistory[i].id === itemId) {
                    S.chatHistory.splice(i, 1);
                    break;
                }
            }

            if (S.currentChatId === itemId) {
                S.currentChatId = null;
                showWelcomeScreen();
                setInputEnabled(true);
                updateSendButtonState();
            }

            window._aiSaveChatHistoryToStorage();
            window._aiClearStreamingFromStorage(itemId);
        } else if (type === 'image') {
            for (var j = 0; j < S.imageHistory.length; j++) {
                if (S.imageHistory[j].id === itemId) {
                    S.imageHistory.splice(j, 1);
                    break;
                }
            }
            saveGenHistory();
        } else if (type === 'video') {
            for (var k = 0; k < S.videoHistory.length; k++) {
                if (S.videoHistory[k].id === itemId) {
                    S.videoHistory.splice(k, 1);
                    break;
                }
            }
            saveGenHistory();
        }

        if (S.currentChatId === itemId) {
            var messages = getEl('aiMessages');
            if (messages) {
                messages.innerHTML = '';
            }
            S.currentChatId = null;
            S.lastChatIdByMode[S.aiMode] = null;
            showWelcomeScreen();
        }

        window.renderChatList();
        showToast('记录已删除', 'success');
    };

    window.cancelAiTask = function cancelAiTask(itemId, type) {
        if (!confirm('确定要终止此任务吗？')) {
            return;
        }

        var taskId = null;
        if (type === 'image') {
            for (var i = 0; i < S.imageHistory.length; i++) {
                if (S.imageHistory[i].id === itemId) {
                    taskId = S.imageHistory[i].taskId;
                    S.imageHistory[i].isStreaming = false;
                    S.imageHistory[i].status = 'failed';
                    break;
                }
            }
        } else if (type === 'video') {
            for (var j = 0; j < S.videoHistory.length; j++) {
                if (S.videoHistory[j].id === itemId) {
                    taskId = S.videoHistory[j].taskId;
                    S.videoHistory[j].isStreaming = false;
                    S.videoHistory[j].status = 'failed';
                    break;
                }
            }
        }

        if (taskId) {
            abortPoll(taskId);

            fetch('api.php?action=aiCancelTask&taskId=' + encodeURIComponent(taskId))
                .then(function(r) { return r.json(); })
                .then(function(result) {
                    if (result.success) {
                        showToast('任务已终止', 'success');
                    } else {
                        showToast(result.error || '终止任务失败', 'error');
                    }
                    saveGenHistory();
                    window.renderChatList();
                })
                .catch(function(e) {
                    showToast('终止任务失败', 'error');
                    saveGenHistory();
                    window.renderChatList();
                });
        } else {
            saveGenHistory();
            window.renderChatList();
            showToast('任务已终止', 'success');
        }
    };

    // ==================== Expose to other modules ====================

    window._aiNormalizeGeneratedMediaUrl = normalizeGeneratedMediaUrl;
    window._aiCallImageApi = callImageApi;
    window._aiPollImageStatus = pollImageStatus;
    window._aiFormatGenTimestamp = formatGenTimestamp;
    window._aiDownloadAsset = downloadAsset;
})();
