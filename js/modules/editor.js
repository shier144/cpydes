// ========== 统一富文本编辑器（前端 + 后台共用） ==========
// 该模块整合了原 imageHandler.js / emojiPicker.js / admin.js 中的编辑器逻辑
// 通过 window.EDITOR_CONTEXT 配置不同上下文（路径前缀、CSRF、权限、上传URL等）

(function () {
    // 上下文默认值（前台）；后台在 admin/index.php 中覆盖
    window.EDITOR_CONTEXT = Object.assign({
        imagePathPrefix: '',                    // 前台：'' / 后台：'../'
        uploadUrl: 'api.php?action=uploadImage',
        proxyUrl: 'api.php?action=proxyImage', // 本地环境代理 file:// 图片
        withCsrf: false,                       // 后台 true
        hasPermission: function () { return true; },
        onImageClick: null,                    // 默认使用内置 openImageViewer
        apiFetch: function (url, opts) { return fetch(url, opts); },
        ensureCsrf: function () { return Promise.resolve(null); },
        showToast: function (msg, type) {
            if (typeof showToast === 'function') showToast(msg, type);
            else if (type === 'error') console.error(msg); else console.info(msg);
        }
    }, window.EDITOR_CONTEXT || {});

    // 多实例状态：editorId → { sourceMode: false }
    const _editorStates = {};

    // ============ 工具函数 ============
    function _escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function _escapeAttr(s) { return _escapeHtml(s); }

    function _stripHtml(html) {
        if (!html) return '';
        return String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    }

    function _isLocalFilePath(src) {
        if (!src) return false;
        if (src.indexOf('file://') === 0) return true;
        // Windows 盘符路径：C:\ C:/ D:\ 等
        if (/^[a-zA-Z]:[\\\/]/.test(src)) return true;
        return false;
    }

    function _hasLocalPathInSrcset(srcset) {
        if (!srcset) return false;
        return srcset.split(',').some(function (part) {
            var url = part.trim().split(/\s+/)[0];
            return _isLocalFilePath(url);
        });
    }

    // ============ 预编译正则 ============
    const _imgTagRegex = /<img[^>]*>/gi;
    const _srcAttrRegex = /src\s*=\s*["']?([^"'\s>]*)["']?/i;
    const _srcsetAttrRegex = /srcset\s*=\s*["']([^"']*)["']/i;
    const _altAttrRegex = /alt\s*=\s*["']?([^"'\s>]*)["']?/i;
    const _hrefAttrRegex = /href\s*=\s*["']?([^"'\s>]*)["']?/i;
    const _colspanAttrRegex = /colspan\s*=\s*["']?(\d+)["']?/i;
    const _rowspanAttrRegex = /rowspan\s*=\s*["']?(\d+)["']?/i;
    const _tagRegex = /<(\w+)([^>]*)>/gi;

    // ============ 内容清洗 ============

    /**
     * 插入 HTML 前过滤本地路径图片，并清理富文本样式（粘贴时调用）
     */
    function sanitizeHtmlBeforeInsert(html) {
        if (!html) return html;
        let cleaned = html;

        // 过滤本地路径图片
        cleaned = cleaned.replace(_imgTagRegex, function (imgTag) {
            const srcMatch = imgTag.match(_srcAttrRegex);
            const srcsetMatch = imgTag.match(_srcsetAttrRegex);
            const hasLocalSrc = srcMatch && _isLocalFilePath(srcMatch[1]);
            const hasLocalSrcset = srcsetMatch && _hasLocalPathInSrcset(srcsetMatch[1]);
            if (hasLocalSrc || hasLocalSrcset) return '';
            return imgTag;
        });

        // 移除 font 标签
        cleaned = cleaned.replace(/<font[^>]*>/gi, '');
        cleaned = cleaned.replace(/<\/font>/gi, '');

        // 清理标签属性（保留必要属性）
        cleaned = cleaned.replace(_tagRegex, function (fullTag, tagName, attrs) {
            const lowerName = tagName.toLowerCase();
            if (lowerName === 'img') {
                const srcMatch = attrs.match(_srcAttrRegex);
                const altMatch = attrs.match(_altAttrRegex);
                const src = srcMatch ? ` src="${srcMatch[1]}"` : '';
                const alt = altMatch ? ` alt="${altMatch[1]}"` : '';
                return `<img${src}${alt}>`;
            }
            if (lowerName === 'a') {
                const hrefMatch = attrs.match(_hrefAttrRegex);
                const href = hrefMatch ? ` href="${hrefMatch[1]}"` : '';
                return `<a${href}>`;
            }
            if (lowerName === 'table' || lowerName === 'tr' || lowerName === 'td' || lowerName === 'th') {
                const colspanMatch = attrs.match(_colspanAttrRegex);
                const rowspanMatch = attrs.match(_rowspanAttrRegex);
                const colspan = colspanMatch ? ` colspan="${colspanMatch[1]}"` : '';
                const rowspan = rowspanMatch ? ` rowspan="${rowspanMatch[1]}"` : '';
                return `<${tagName}${colspan}${rowspan}>`;
            }
            if (lowerName === 'hr') {
                const classMatch = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
                if (classMatch && /segment-divider/.test(classMatch[1])) {
                    return `<${tagName} class="segment-divider">`;
                }
                return `<${tagName}>`;
            }
            if (lowerName === 'div') {
                const classMatch = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
                if (classMatch && /segment-keep/.test(classMatch[1])) {
                    return `<${tagName} class="segment-keep">`;
                }
                return `<${tagName}>`;
            }
            return `<${tagName}>`;
        });

        return cleaned;
    }

    /**
     * 清理内容中的危险标签和属性（保存前调用）
     */
    function sanitizeContent(html) {
        if (!html) return '';
        let s = String(html);
        s = s.replace(/<(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, '');
        s = s.replace(/<(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, '');
        s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        s = s.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s"'>]*)/gi, '$1="#"');
        return s.trim();
    }

    // ============ 编辑器上下文快捷取值 ============
    function _ctx() { return window.EDITOR_CONTEXT; }

    function _normalizeUploadUrl(url) {
        // 上传 API 返回 img/xxx.png，后台需显示为 ../img/xxx.png
        const prefix = _ctx().imagePathPrefix;
        if (!prefix) return url;
        if (url.startsWith('../')) return url;
        return prefix + url;
    }

    function _denormalizeUploadUrl(html) {
        // 保存时把 ../img/ 还原为 img/（与前台路径一致）
        const prefix = _ctx().imagePathPrefix;
        if (!prefix) return html;
        const escPrefix = prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const re = new RegExp('src=["\'](' + escPrefix + ')(img/[^"\']+)["\']', 'gi');
        return html.replace(re, 'src="$2"');
    }

    // ============ 构建 HTML ============

    /**
     * 计算文案元信息（最后更新时间、是否失效、失效提示语、颜色与字号）
     * 编辑器底部状态条据此显示「最后更新：YYYY-MM-DD HH:MM」与失效提示标签。
     * 判定策略与 copyReminder 一致：always 恒失效；aged 按 updatedAt 距今天数与 thresholdDays 比较。
     * 前后台共用（editor.js 前后台均加载），避免在 clipboard.js 中重复定义。
     * @param {object} item 文案对象
     * @returns {object} metaInfo { updatedAt, createdAt, isExpired, expiredMessage, textColor, fontSize }
     */
    function computeItemMetaInfo(item) {
        const meta = {
            updatedAt: (item && item.updatedAt) || '',
            createdAt: (item && item.createdAt) || '',
            isExpired: false,
            expiredMessage: '',
            textColor: '',
            fontSize: 0,
        };
        const cfg = window.COPY_REMINDER;
        if (!cfg || !cfg.enabled) return meta;

        let hit = false;
        if (cfg.strategy === 'always') {
            hit = true;
        } else if (cfg.strategy === 'aged') {
            const ts = (item && (item.updatedAt || item.createdAt)) || '';
            if (ts) {
                const t = Date.parse(ts);
                if (!isNaN(t)) {
                    const thresholdDays = Number(cfg.thresholdDays) || 30;
                    hit = (Date.now() - t) > thresholdDays * 86400000;
                }
            }
        }
        meta.isExpired = hit;
        meta.expiredMessage = (typeof cfg.message === 'string' && cfg.message.trim())
            ? cfg.message
            : '此文案可能因活动过期或内容变更而失效，使用前请核对并按需修改。';
        meta.textColor = (typeof cfg.textColor === 'string' ? cfg.textColor : '').trim();
        meta.fontSize = Number(cfg.fontSize) || 0;
        return meta;
    }

    /**
     * 构建文案元信息 HTML 片段（供调用方插入到弹窗标题右侧与底部按钮行）
     * - head: 字数统计 + 最后更新时间（插入到 modal-head 标题右侧）
     * - foot: 失效提示（插入到 modal-foot 按钮同一行）
     * 字数统计元素 ID 约定为 editorCount_<editorId>，与 _updateEditorCount 联动实时更新。
     * @param {object|null} metaInfo - computeItemMetaInfo 返回值（新增文案时传 null）
     * @param {string} editorId - 编辑器 ID（用于字数统计元素 ID 关联）
     * @param {boolean} [showCharCount=true] - 是否显示字数统计
     * @returns {{head:string, foot:string}} head 插入到标题右侧，foot 插入到底部按钮行
     */
    function buildMetaHTML(metaInfo, editorId, showCharCount) {
        editorId = editorId || 'unifiedEditor';
        showCharCount = showCharCount !== false;
        const headParts = [];
        const footParts = [];

        if (showCharCount) {
            headParts.push('<span class="modal-head-count" id="editorCount_' + editorId + '">共 0 字</span>');
        }

        if (metaInfo) {
            // 最后更新时间 → 标题右侧
            const ts = metaInfo.updatedAt || metaInfo.createdAt || '';
            if (ts) {
                const d = new Date(ts);
                if (!isNaN(d.getTime())) {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    const h = String(d.getHours()).padStart(2, '0');
                    const mi = String(d.getMinutes()).padStart(2, '0');
                    headParts.push('<span class="modal-head-updated">最后更新：' + y + '-' + m + '-' + day + ' ' + h + ':' + mi + '</span>');
                }
            }
            // 失效提示 → 底部按钮同一行（颜色与字号经 sanitizeColor / 整数校验，防 CSS 注入）
            if (metaInfo.isExpired && metaInfo.expiredMessage) {
                const styleArr = [];
                if (metaInfo.textColor && typeof window.sanitizeColor === 'function') {
                    const c = window.sanitizeColor(metaInfo.textColor);
                    if (c) styleArr.push('color:' + c);
                }
                if (metaInfo.fontSize && Number.isFinite(metaInfo.fontSize) && metaInfo.fontSize >= 11 && metaInfo.fontSize <= 24) {
                    styleArr.push('font-size:' + Math.round(metaInfo.fontSize) + 'px');
                }
                const styleStr = styleArr.length ? ' style="' + styleArr.join(';') + '"' : '';
                footParts.push('<span class="modal-foot-expired"' + styleStr + '><i data-feather="alert-triangle" style="width:13px;height:13px;"></i> ' + _escapeHtml(metaInfo.expiredMessage) + '</span>');
            }
        }

        return {
            head: headParts.length ? '<div class="modal-head-meta">' + headParts.join('') + '</div>' : '',
            foot: footParts.join('')
        };
    }

    /**
     * 构建统一编辑器 HTML（工具栏 + 编辑区）
     * 注：字数统计、最后更新时间、失效提示已迁移到 buildMetaHTML，由调用方
     * 插入到弹窗标题右侧（modal-head-meta）与底部按钮行（modal-foot-meta）。
     * @param {Object} opts
     * @param {string} opts.editorId - contenteditable 元素 ID（必填）
     * @param {string} [opts.content] - 初始内容 HTML
     * @param {string} [opts.placeholder] - 占位提示文字
     * @param {boolean} [opts.showImageUpload=true] - 是否显示图片上传按钮
     * @param {boolean} [opts.showEmoji=true] - 是否显示表情按钮
     * @param {boolean} [opts.showSourceMode=true] - 是否显示源码模式按钮
     * @param {boolean} [opts.showFormatting=true] - 是否显示完整格式化工具栏
     * @returns {string} HTML 字符串
     */
    function buildUnifiedEditorHTML(opts) {
        opts = opts || {};
        const editorId = opts.editorId || 'unifiedEditor';
        const content = opts.content || '';
        const placeholder = opts.placeholder || '在此输入内容，可直接粘贴图片...';
        const showImageUpload = opts.showImageUpload !== false;
        const showEmoji = opts.showEmoji !== false;
        const showSourceMode = opts.showSourceMode !== false;
        const showFormatting = opts.showFormatting !== false;

        const canUpload = showImageUpload && _ctx().hasPermission('images.upload');

        let toolbar = '<div class="unified-editor-toolbar" id="toolbar_' + editorId + '">';

        if (showFormatting) {
            toolbar +=
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'bold\')" title="加粗 (Ctrl+B)"><b>B</b></button>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'italic\')" title="斜体 (Ctrl+I)"><i>I</i></button>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'underline\')" title="下划线 (Ctrl+U)"><u>U</u></button>' +
                '<span class="editor-btn-sep"></span>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'formatBlock\',\'<h1>\')" title="一级标题">H1</button>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'formatBlock\',\'<h2>\')" title="二级标题">H2</button>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'formatBlock\',\'<h3>\')" title="三级标题">H3</button>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'formatBlock\',\'<p>\')" title="正文"><i data-feather="align-left" style="width:13px;height:13px;"></i>正文</button>' +
                '<span class="editor-btn-sep"></span>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'insertUnorderedList\')" title="无序列表"><i data-feather="list" style="width:13px;height:13px;"></i>列表</button>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'insertOrderedList\')" title="有序列表"><i data-feather="hash" style="width:13px;height:13px;"></i>编号</button>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'formatBlock\',\'<blockquote>\')" title="引用"><i data-feather="align-left" style="width:13px;height:13px;"></i>引用</button>' +
                '<span class="editor-btn-sep"></span>';

            if (showEmoji) {
                toolbar +=
                    '<button type="button" class="editor-btn" onclick="unifiedToggleEmojiPicker(event,\'' + editorId + '\')" id="emojiToggleBtn_' + editorId + '" title="表情"><i data-feather="smile" style="width:13px;height:13px;"></i>表情</button>';
            }

            toolbar +=
                '<button type="button" class="editor-btn" onclick="unifiedEditorInsertLink(\'' + editorId + '\')" title="插入链接"><i data-feather="link" style="width:13px;height:13px;"></i>链接</button>' +
                '<span class="editor-btn-sep"></span>' +
                '<button type="button" class="editor-btn" onclick="unifiedEditorExec(\'' + editorId + '\',\'removeFormat\')" title="清除格式"><i data-feather="x" style="width:13px;height:13px;"></i>清除</button>';
        }

        if (canUpload) {
            toolbar += '<button type="button" class="editor-btn" onclick="unifiedEditorUploadImage(\'' + editorId + '\')" title="上传图片"><i data-feather="image" style="width:13px;height:13px;"></i>图片</button>';
        }

        toolbar +=
            '<button type="button" class="editor-btn" onclick="unifiedEditorInsertSegmentDivider(\'' + editorId + '\')" title="插入分段符（在此处强制分段）"><i data-feather="divide" style="width:13px;height:13px;"></i>分段</button>' +
            '<button type="button" class="editor-btn" onclick="unifiedEditorWrapSegmentKeep(\'' + editorId + '\')" title="将选中内容标记为同段（分段时不拆分，适合段落+配图绑定）"><i data-feather="link-2" style="width:13px;height:13px;"></i>同段</button>';

        if (showSourceMode) {
            toolbar += '<button type="button" class="editor-btn" onclick="unifiedEditorToggleSource(\'' + editorId + '\')" title="HTML 源码模式" id="editorSourceBtn_' + editorId + '"><i data-feather="code" style="width:13px;height:13px;"></i>源码</button>';
        }

        if (showEmoji) {
            toolbar +=
                '<div class="emoji-picker" id="emojiPicker_' + editorId + '">' +
                '  <div class="emoji-picker-head">' +
                '    <span class="emoji-picker-title">选择表情</span>' +
                '    <button type="button" class="emoji-close-btn" onclick="unifiedCloseEmojiPicker(\'' + editorId + '\')"><i data-feather="x" style="width:14px;height:14px;"></i></button>' +
                '  </div>' +
                '  <div class="emoji-body"><div class="emoji-grid" id="emojiGrid_' + editorId + '"></div></div>' +
                '  <div class="emoji-categories" id="emojiCategories_' + editorId + '"></div>' +
                '</div>';
        }

        toolbar += '</div>';

        const editorDiv =
            '<div class="unified-editor" id="' + editorId + '" contenteditable="true" data-placeholder="' + _escapeAttr(placeholder) + '">' + content + '</div>';

        return toolbar + editorDiv;
    }

    // ============ 初始化 ============

    /**
     * 初始化统一编辑器（绑定所有事件）
     * @param {Object} opts
     * @param {string} opts.editorId - contenteditable 元素 ID（必填）
     */
    function initUnifiedEditor(opts) {
        opts = opts || {};
        const editorId = opts.editorId || 'unifiedEditor';
        const editor = document.getElementById(editorId);
        if (!editor) return;

        _editorStates[editorId] = { sourceMode: false };

        const ctx = _ctx();
        const editorOpts = {
            editorId: editorId,
            imagePathPrefix: ctx.imagePathPrefix,
            uploadUrl: ctx.uploadUrl,
            proxyUrl: ctx.proxyUrl,
            withCsrf: ctx.withCsrf,
            permissionCheck: ctx.hasPermission,
            onImageClick: ctx.onImageClick,
            apiFetch: ctx.apiFetch,
            ensureCsrf: ctx.ensureCsrf,
            showToast: ctx.showToast
        };

        _setupImagePaste(editor, editorOpts);
        _setupEditorImageClick(editor, editorOpts);
        _setupSegmentKeepEnter(editor, editorId);
        editor.addEventListener('input', function () { _updateEditorCount(editorId); });
        _updateEditorCount(editorId);

        // 点击外部关闭表情面板
        setTimeout(function () {
            const picker = document.getElementById('emojiPicker_' + editorId);
            const btn = document.getElementById('emojiToggleBtn_' + editorId);
            if (picker && btn) {
                document.addEventListener('click', function (e) {
                    if (!picker.contains(e.target) && !btn.contains(e.target)) {
                        _closeEmojiPicker(editorId);
                    }
                });
            }
        }, 0);
    }

    // ============ 工具栏动作（暴露到全局） ============

    window.unifiedEditorExec = function (editorId, command, value) {
        const state = _editorStates[editorId];
        if (state && state.sourceMode) return;
        const editor = document.getElementById(editorId);
        if (!editor) return;
        editor.focus();

        // 增强版"清除格式"：同时移除内联格式、块级格式（转为正文）、解开链接
        if (command === 'removeFormat') {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
                _ctx().showToast('请先选中要清除格式的内容', 'warning');
                return;
            }
            const range = sel.getRangeAt(0);

            // 1. 解开选区内的链接
            let node = range.commonAncestorContainer;
            const links = [];
            if (node.nodeType === 1) {
                node.querySelectorAll('a').forEach(function (a) { links.push(a); });
            } else if (node.parentNode) {
                node.parentNode.querySelectorAll('a').forEach(function (a) {
                    if (range.intersectsNode(a)) links.push(a);
                });
            }
            links.forEach(function (a) {
                const parent = a.parentNode;
                while (a.firstChild) parent.insertBefore(a.firstChild, a);
                parent.removeChild(a);
            });

            // 2. 移除内联格式（粗体/斜体/下划线/颜色等）
            document.execCommand('removeFormat', false, null);

            // 3. 将块级格式转为正文段落（H1-H6、blockquote、pre），保留列表/图片/分段符/同段
            const fragment = range.cloneContents();
            const blockSel = 'h1,h2,h3,h4,h5,h6,blockquote,pre';
            let hasBlock = false;
            if (fragment.querySelector) {
                fragment.querySelectorAll(blockSel).forEach(function () { hasBlock = true; });
            }
            if (hasBlock) {
                // 重新选中当前选区
                const currentSel = window.getSelection();
                if (currentSel && currentSel.rangeCount > 0) {
                    const curRange = currentSel.getRangeAt(0);
                    const container = curRange.commonAncestorContainer;
                    if (container.nodeType === 1) {
                        container.querySelectorAll(blockSel).forEach(function (block) {
                            if (!curRange.intersectsNode(block)) return;
                            const p = document.createElement('p');
                            while (block.firstChild) p.appendChild(block.firstChild);
                            block.replaceWith(p);
                        });
                    }
                }
            }

            _updateEditorCount(editorId);
            _ctx().showToast('已清除选中内容的格式', 'success');
            return;
        }

        document.execCommand(command, false, value || null);
        _updateEditorCount(editorId);
    };

    window.unifiedEditorInsertLink = function (editorId) {
        const state = _editorStates[editorId];
        if (state && state.sourceMode) return;
        const url = prompt('请输入链接地址：', 'https://');
        if (!url) return;
        if (!/^(https?:|mailto:|\/|#)/i.test(url)) {
            _ctx().showToast('链接地址格式不合法', 'error');
            return;
        }
        const text = prompt('链接显示文字（留空使用链接地址）：', '');
        const editor = document.getElementById(editorId);
        if (!editor) return;
        editor.focus();
        if (text) {
            document.execCommand('insertHTML', false, `<a href="${_escapeAttr(url)}" target="_blank" rel="noopener">${_escapeHtml(text)}</a>`);
        } else {
            document.execCommand('createLink', false, url);
        }
        _updateEditorCount(editorId);
    };

    window.unifiedEditorUploadImage = function (editorId) {
        const state = _editorStates[editorId];
        if (state && state.sourceMode) return;
        if (!_ctx().hasPermission('images.upload')) {
            _ctx().showToast('无上传图片权限', 'error');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
        input.onchange = async function () {
            const file = input.files[0];
            if (file) await _uploadAndInsertImageFile(editorId, file);
        };
        input.click();
    };

    window.unifiedEditorToggleSource = function (editorId) {
        const state = _editorStates[editorId];
        if (!state) return;
        const btn = document.getElementById('editorSourceBtn_' + editorId);
        if (!btn) return;

        if (!state.sourceMode) {
            // 切到源码模式
            const editor = document.getElementById(editorId);
            if (!editor) return;
            const source = document.createElement('textarea');
            source.className = 'unified-editor-source';
            source.id = editorId + '_source';
            source.value = editor.innerHTML;
            editor.replaceWith(source);
            btn.classList.add('active');
            state.sourceMode = true;
            source.focus();
        } else {
            // 切回富文本
            const source = document.getElementById(editorId + '_source');
            if (!source) return;
            const newEditor = document.createElement('div');
            newEditor.className = 'unified-editor';
            newEditor.id = editorId;
            newEditor.setAttribute('contenteditable', 'true');
            newEditor.setAttribute('data-placeholder', '输入文案内容，可直接粘贴或拖入图片...');
            newEditor.innerHTML = sanitizeContent(source.value);
            source.replaceWith(newEditor);
            btn.classList.remove('active');
            state.sourceMode = false;
            // 重新绑定事件
            const ctx = _ctx();
            const editorOpts = {
                editorId: editorId,
                imagePathPrefix: ctx.imagePathPrefix,
                uploadUrl: ctx.uploadUrl,
                proxyUrl: ctx.proxyUrl,
                withCsrf: ctx.withCsrf,
                permissionCheck: ctx.hasPermission,
                onImageClick: ctx.onImageClick,
                apiFetch: ctx.apiFetch,
                ensureCsrf: ctx.ensureCsrf,
                showToast: ctx.showToast
            };
            _setupImagePaste(newEditor, editorOpts);
            _setupEditorImageClick(newEditor, editorOpts);
            _setupSegmentKeepEnter(newEditor, editorId);
            newEditor.addEventListener('input', function () { _updateEditorCount(editorId); });
            _updateEditorCount(editorId);
        }
    };

    window.unifiedEditorInsertSegmentDivider = function (editorId) {
        const state = _editorStates[editorId];
        if (state && state.sourceMode) {
            // 源码模式下直接插入 HTML 文本
            const ta = document.getElementById(editorId + '_source');
            if (!ta) return;
            const insertText = '<hr class="segment-divider">';
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const val = ta.value;
            ta.value = val.slice(0, start) + insertText + val.slice(end);
            ta.selectionStart = ta.selectionEnd = start + insertText.length;
            ta.focus();
            return;
        }
        const editor = document.getElementById(editorId);
        if (!editor) return;
        editor.focus();

        const selection = window.getSelection();
        if (selection.rangeCount > 0 && selection.isCollapsed === false) {
            selection.deleteFromDocument();
        }

        const marker = 'seg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        let hr = null;
        if (document.execCommand) {
            document.execCommand('insertHTML', false, '<hr class="segment-divider" data-seg-marker="' + marker + '">');
            hr = editor.querySelector('hr.segment-divider[data-seg-marker="' + marker + '"]');
        } else {
            hr = document.createElement('hr');
            hr.className = 'segment-divider';
            hr.setAttribute('data-seg-marker', marker);
            if (selection.rangeCount > 0) {
                selection.getRangeAt(0).insertNode(hr);
            } else {
                editor.appendChild(hr);
            }
        }

        if (hr) {
            hr.removeAttribute('data-seg-marker');
            const BLOCK_TAGS = ['P','DIV','H1','H2','H3','H4','H5','H6','UL','OL','BLOCKQUOTE','TABLE','PRE'];
            let next = hr.nextSibling;
            let landing = null;
            if (next && next.nodeType === 1 && BLOCK_TAGS.indexOf(next.tagName) !== -1) {
                landing = next;
            } else {
                landing = document.createElement('p');
                landing.innerHTML = '<br>';
                hr.parentNode.insertBefore(landing, next);
            }
            const sel = window.getSelection();
            if (sel) {
                const r = document.createRange();
                r.setStart(landing, 0);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
            }
        }
        _updateEditorCount(editorId);
    };

    window.unifiedEditorWrapSegmentKeep = function (editorId) {
        const state = _editorStates[editorId];
        if (state && state.sourceMode) {
            const ta = document.getElementById(editorId + '_source');
            if (!ta) return;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const val = ta.value;
            const selected = val.slice(start, end);
            const before = val.slice(Math.max(0, start - 60), start);
            const after = val.slice(end, Math.min(val.length, end + 30));
            const openMatch = before.match(/<div[^>]*class\s*=\s*["'][^"']*segment-keep[^"']*["'][^>]*>\s*$/i);
            const closeMatch = after.match(/^\s*<\/div>/i);
            if (openMatch && closeMatch) {
                const newBefore = before.slice(0, before.length - openMatch[0].length);
                const newAfter = after.slice(closeMatch[0].length);
                ta.value = val.slice(0, Math.max(0, start - 60)) + newBefore + selected + newAfter;
                const startOffset = Math.max(0, start - 60) + newBefore.length;
                ta.selectionStart = startOffset;
                ta.selectionEnd = startOffset + selected.length;
            } else {
                const insertText = '<div class="segment-keep">' + selected + '</div>';
                ta.value = val.slice(0, start) + insertText + val.slice(end);
                ta.selectionStart = start;
                ta.selectionEnd = start + insertText.length;
            }
            ta.focus();
            return;
        }

        const editor = document.getElementById(editorId);
        if (!editor) return;
        editor.focus();

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            _ctx().showToast('请先将光标放到要标记的内容处', 'warning');
            return;
        }
        const range = selection.getRangeAt(0);

        // 检查是否已在 segment-keep 内 → 取消标记
        let node = range.commonAncestorContainer;
        let keepParent = null;
        while (node && node !== editor) {
            if (node.nodeType === 1 && node.tagName === 'DIV' &&
                node.classList && node.classList.contains('segment-keep')) {
                keepParent = node;
                break;
            }
            node = node.parentNode;
        }

        if (keepParent) {
            const parent = keepParent.parentNode;
            while (keepParent.firstChild) {
                parent.insertBefore(keepParent.firstChild, keepParent);
            }
            parent.removeChild(keepParent);
            _updateEditorCount(editorId);
            _ctx().showToast('已取消同段标记', 'success');
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'segment-keep';

        if (range.collapsed) {
            wrapper.innerHTML = '<br>';
            range.insertNode(wrapper);
            const newRange = document.createRange();
            newRange.setStart(wrapper, 0);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        } else {
            try {
                range.surroundContents(wrapper);
            } catch (e) {
                const frag = range.extractContents();
                wrapper.appendChild(frag);
                range.insertNode(wrapper);
            }
            const newRange = document.createRange();
            newRange.selectNodeContents(wrapper);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }
        _updateEditorCount(editorId);
        _ctx().showToast('已标记为同段，分段时不会被拆分', 'success');
    };

    // ============ 字数统计 ============
    function _updateEditorCount(editorId) {
        const editor = document.getElementById(editorId);
        const countEl = document.getElementById('editorCount_' + editorId);
        if (!editor || !countEl) return;
        const text = _stripHtml(editor.innerHTML).replace(/\s/g, '');
        countEl.textContent = '共 ' + text.length + ' 字';
    }

    // ============ 图片上传 ============

    async function _uploadAndInsertImageFile(editorId, file) {
        if (!_ctx().hasPermission('images.upload')) {
            _ctx().showToast('无上传图片权限', 'error');
            return;
        }
        const editor = document.getElementById(editorId);
        if (!editor) return;
        if (file.size > 10 * 1024 * 1024) {
            _ctx().showToast('图片不能超过 10MB', 'warning');
            return;
        }
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (!allowed.includes(file.type)) {
            _ctx().showToast('仅支持 png/jpg/gif/webp/svg 格式', 'warning');
            return;
        }

        editor.classList.add('uploading');
        try {
            const ctx = _ctx();
            let headers = {};
            if (ctx.withCsrf) {
                const token = await ctx.ensureCsrf();
                if (token) headers['X-CSRF-Token'] = token;
            }
            const formData = new FormData();
            formData.append('image', file);
            const r = await ctx.apiFetch(ctx.uploadUrl, {
                method: 'POST',
                headers: headers,
                body: formData
            });
            const j = await r.json();
            if (j.success && j.url) {
                const displayUrl = _normalizeUploadUrl(j.url);
                editor.focus();
                document.execCommand('insertHTML', false, `<img src="${_escapeAttr(displayUrl)}" alt="" style="max-width:100%;border-radius:6px;">`);
                _updateEditorCount(editorId);
            } else {
                _ctx().showToast(j.error || '图片上传失败', 'error');
            }
        } catch (e) {
            console.error(e);
            _ctx().showToast('图片上传失败', 'error');
        } finally {
            editor.classList.remove('uploading');
        }
    }

    async function _uploadImageFile(file) {
        // 仅上传，不插入；供预上传使用
        const ctx = _ctx();
        let headers = {};
        if (ctx.withCsrf) {
            const token = await ctx.ensureCsrf();
            if (token) headers['X-CSRF-Token'] = token;
        }
        const formData = new FormData();
        formData.append('image', file);
        const r = await ctx.apiFetch(ctx.uploadUrl, {
            method: 'POST',
            headers: headers,
            body: formData
        });
        const result = await r.json();
        if (result.success) return _normalizeUploadUrl(result.url);
        throw new Error(result.error || '上传失败');
    }

    async function _uploadBase64Image(dataUrl) {
        const ctx = _ctx();
        const controller = new AbortController();
        const timeoutId = setTimeout(function () { controller.abort(); }, 30000);
        try {
            let headers = { 'Content-Type': 'application/json' };
            if (ctx.withCsrf) {
                const token = await ctx.ensureCsrf();
                if (token) headers['X-CSRF-Token'] = token;
            }
            const response = await ctx.apiFetch(ctx.uploadUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ base64: dataUrl }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const result = await response.json();
            if (result.success) return _normalizeUploadUrl(result.url);
            throw new Error(result.error || '上传失败');
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') throw new Error('图片上传超时（30秒）');
            throw e;
        }
    }

    async function _uploadBlobImage(blobUrl) {
        const ctrl1 = new AbortController();
        const t1 = setTimeout(function () { ctrl1.abort(); }, 15000);
        try {
            const resp = await fetch(blobUrl, { signal: ctrl1.signal });
            clearTimeout(t1);
            const blob = await resp.blob();
            const file = new File([blob], 'pasted_image.png', { type: blob.type || 'image/png' });
            return await _uploadImageFile(file);
        } catch (e) {
            clearTimeout(t1);
            if (e.name === 'AbortError') throw new Error('图片读取超时（15秒）');
            throw e;
        }
    }

    function _insertImageAtCursor(editor, src) {
        if (!editor) return;
        editor.focus();
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const img = document.createElement('img');
            img.src = src;
            img.style.maxWidth = '100%';
            img.style.borderRadius = '6px';
            range.insertNode(img);
            range.setStartAfter(img);
            range.setEndAfter(img);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            editor.innerHTML += `<img src="${_escapeAttr(src)}" style="max-width:100%;border-radius:6px">`;
        }
    }

    // ============ 图片粘贴/拖拽（高级版，源自 imageHandler.js） ============

    function _setupImagePaste(editor, opts) {
        if (!editor) return;

        editor.addEventListener('paste', async function (e) {
            const state = _editorStates[opts.editorId];
            if (state && state.sourceMode) return;
            if (!_ctx().hasPermission('images.upload')) {
                // 无上传权限时让默认行为处理纯文本粘贴
                return;
            }
            const items = e.clipboardData.items;
            const types = e.clipboardData.types;

            const imageFiles = [];
            for (let item of items) {
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                }
            }

            const hasRichText = types.some(function (t) {
                return t === 'text/html' || t === 'text/rtf' || t === 'text/enriched' || t === 'application/xhtml+xml';
            });
            const hasPlainText = types.includes('text/plain');
            const hasTextContent = hasRichText || hasPlainText;
            const isPureImagePaste = imageFiles.length > 0 && !hasTextContent;

            if (isPureImagePaste) {
                e.preventDefault();
                let successCount = 0;
                let failCount = 0;
                for (const file of imageFiles) {
                    try {
                        const url = await _uploadImageFile(file);
                        _insertImageAtCursor(editor, url);
                        successCount++;
                    } catch (err) {
                        console.error('图片上传失败:', err);
                        failCount++;
                    }
                }
                if (successCount > 0 && failCount === 0) {
                    _ctx().showToast('图片已保存', 'success');
                } else if (failCount > 0) {
                    _ctx().showToast(`${failCount} 张图片上传失败${successCount > 0 ? `，${successCount} 张成功` : ''}`, 'error');
                }
            } else if (imageFiles.length > 0 && hasTextContent) {
                // 图片+文字混合
                e.preventDefault();
                const urlMap = new Map();
                for (const file of imageFiles) {
                    try {
                        const url = await _uploadImageFile(file);
                        urlMap.set(file.name || 'image', url);
                    } catch (err) {
                        console.error('预上传图片失败:', err);
                    }
                }

                const htmlText = e.clipboardData.getData('text/html') || '';
                const plainText = e.clipboardData.getData('text/plain') || '';

                if (hasRichText && htmlText) {
                    let processedHtml = htmlText;
                    let replaceCount = 0;
                    let remainingLocalImgs = 0;

                    if (urlMap.size > 0) {
                        const urls = Array.from(urlMap.values());
                        let urlIndex = 0;
                        processedHtml = processedHtml.replace(
                            /<img[^>]*src\s*=\s*["']?(?:file:\/\/|[a-zA-Z]:[\\\/])[^"'\s>]*["']?[^>]*>/gi,
                            function (imgTag) {
                                if (urlIndex < urls.length) {
                                    const newUrl = urls[urlIndex++];
                                    replaceCount++;
                                    return imgTag.replace(
                                        /src\s*=\s*["']?(?:file:\/\/|[a-zA-Z]:[\\\/])[^"'\s>]*["']?/i,
                                        `src="${newUrl}"`
                                    );
                                }
                                remainingLocalImgs++;
                                return imgTag;
                            }
                        );
                    }

                    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '';

                    if (remainingLocalImgs > 0 && isLocalhost) {
                        processedHtml = processedHtml.replace(
                            /src\s*=\s*["']?(file:\/\/[^"'\s>]*)["']?/gi,
                            function (match, filePath) {
                                const encodedPath = encodeURIComponent(filePath);
                                return `src="${opts.proxyUrl}&path=${encodedPath}" data-file-src="${filePath}"`;
                            }
                        );
                        processedHtml = processedHtml.replace(
                            /src\s*=\s*["']?([a-zA-Z]:[\\\/][^"'\s>]*)["']?/gi,
                            function (match, winPath) {
                                const filePath = 'file://' + winPath.replace(/\\/g, '/');
                                const encodedPath = encodeURIComponent(filePath);
                                return `src="${opts.proxyUrl}&path=${encodedPath}" data-file-src="${filePath}"`;
                            }
                        );
                        const safeHtml = sanitizeHtmlBeforeInsert(processedHtml);
                        document.execCommand('insertHTML', false, safeHtml);
                        setTimeout(async function () {
                            await _processProxiedImagesInEditor(editor);
                        }, 300);
                        const totalImgs = replaceCount + remainingLocalImgs;
                        _ctx().showToast(`正在处理 ${totalImgs} 张图片...`, 'info');
                    } else if (remainingLocalImgs > 0) {
                        // 远程环境：尝试 Clipboard API 兜底
                        let clipboardImages = [];
                        try {
                            if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
                                const clipboardItems = await navigator.clipboard.read();
                                for (const item of clipboardItems) {
                                    const imageType = item.types.find(function (t) { return t.startsWith('image/'); });
                                    if (imageType) {
                                        const blob = await item.getType(imageType);
                                        clipboardImages.push(blob);
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('Clipboard API 读取失败:', err.message || err);
                        }

                        const newUploadedUrls = [];
                        for (const blob of clipboardImages) {
                            try {
                                const url = await _uploadImageFile(new File([blob], 'pasted_image.png', { type: blob.type || 'image/png' }));
                                newUploadedUrls.push(url);
                            } catch (uploadErr) {
                                console.error('预上传失败:', uploadErr);
                            }
                        }

                        if (newUploadedUrls.length > 0) {
                            let replaceIdx = replaceCount;
                            processedHtml = processedHtml.replace(
                                /src\s*=\s*["']?(?:file:\/\/|[a-zA-Z]:[\\\/])[^"'\s>]*["']?/gi,
                                function () {
                                    if (replaceIdx < replaceCount + newUploadedUrls.length) {
                                        return `src="${newUploadedUrls[replaceIdx - replaceCount]}"`;
                                    }
                                    return '';
                                }
                            );
                            processedHtml = sanitizeHtmlBeforeInsert(processedHtml);
                            document.execCommand('insertHTML', false, processedHtml);
                            const total = replaceCount + newUploadedUrls.length;
                            _ctx().showToast(`已处理 ${total} 张图片`, 'success');
                        } else {
                            processedHtml = sanitizeHtmlBeforeInsert(processedHtml);
                            document.execCommand('insertHTML', false, processedHtml);
                            if (remainingLocalImgs > 0) {
                                _ctx().showToast(`${remainingLocalImgs} 张图片无法加载（远程服务器无法读取本地文件），建议单独粘贴图片`, 'warning');
                            } else {
                                _ctx().showToast(`已处理 ${replaceCount} 张图片`, 'success');
                            }
                        }
                    } else {
                        processedHtml = sanitizeHtmlBeforeInsert(processedHtml);
                        document.execCommand('insertHTML', false, processedHtml);
                        if (replaceCount > 0) {
                            _ctx().showToast(`已处理 ${replaceCount} 张图片`, 'success');
                        }
                    }
                } else {
                    const text = e.clipboardData.getData('text/plain') || '';
                    document.execCommand('insertText', false, text);
                    for (const url of urlMap.values()) {
                        _insertImageAtCursor(editor, url);
                    }
                    _ctx().showToast(`已处理 ${urlMap.size} 张图片`, 'success');
                }
            } else if (!imageFiles.length && hasRichText) {
                // 富文本但无图片文件（可能含本地路径图片）
                e.preventDefault();
                const htmlText = e.clipboardData.getData('text/html') || '';
                const plainText = e.clipboardData.getData('text/plain') || '';

                if (!htmlText) {
                    document.execCommand('insertText', false, plainText);
                    _ctx().showToast('已以纯文本方式粘贴（避免本地图片安全限制）', 'info');
                    return;
                }

                const hasLocalPath = /(?:file:\/\/|[a-zA-Z]:[\\\/])/i.test(htmlText);

                if (hasLocalPath) {
                    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '';

                    if (isLocalhost) {
                        let processedHtml = htmlText;
                        processedHtml = processedHtml.replace(
                            /src\s*=\s*["']?(file:\/\/[^"'\s>]*)["']?/gi,
                            function (match, filePath) {
                                const encodedPath = encodeURIComponent(filePath);
                                return `src="${opts.proxyUrl}&path=${encodedPath}" data-file-src="${filePath}"`;
                            }
                        );
                        processedHtml = processedHtml.replace(
                            /src\s*=\s*["']?([a-zA-Z]:[\\\/][^"'\s>]*)["']?/gi,
                            function (match, winPath) {
                                const filePath = 'file://' + winPath.replace(/\\/g, '/');
                                const encodedPath = encodeURIComponent(filePath);
                                return `src="${opts.proxyUrl}&path=${encodedPath}" data-file-src="${filePath}"`;
                            }
                        );
                        const safeHtml = sanitizeHtmlBeforeInsert(processedHtml);
                        document.execCommand('insertHTML', false, safeHtml);
                        setTimeout(async function () {
                            await _processProxiedImagesInEditor(editor);
                        }, 300);
                        _ctx().showToast('正在处理图片...', 'info');
                    } else {
                        let clipboardImages = [];
                        try {
                            if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
                                const clipboardItems = await navigator.clipboard.read();
                                for (const item of clipboardItems) {
                                    const imageType = item.types.find(function (t) { return t.startsWith('image/'); });
                                    if (imageType) {
                                        const blob = await item.getType(imageType);
                                        clipboardImages.push(blob);
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('Clipboard API 读取失败:', err.message || err);
                        }

                        if (clipboardImages.length > 0) {
                            const uploadedUrls = [];
                            for (const blob of clipboardImages) {
                                try {
                                    const url = await _uploadImageFile(new File([blob], 'pasted_image.png', { type: blob.type || 'image/png' }));
                                    uploadedUrls.push(url);
                                } catch (uploadErr) {
                                    console.error('预上传失败:', uploadErr);
                                }
                            }
                            let processedHtml = htmlText;
                            let replaceIdx = 0;
                            processedHtml = processedHtml.replace(
                                /src\s*=\s*["']?(?:file:\/\/|[a-zA-Z]:[\\\/])[^"'\s>]*["']?/gi,
                                function () {
                                    if (replaceIdx < uploadedUrls.length) {
                                        return `src="${uploadedUrls[replaceIdx++]}"`;
                                    }
                                    return '';
                                }
                            );
                            const safeHtml = sanitizeHtmlBeforeInsert(processedHtml);
                            document.execCommand('insertHTML', false, safeHtml);
                            _ctx().showToast(`已处理 ${uploadedUrls.length} 张图片`, 'success');
                        } else {
                            let cleanedHtml = htmlText.replace(
                                /<img[^>]+src\s*=\s*["']?(?:file:\/\/|[a-zA-Z]:[\\\/])[^"'\s>]*["'][^>]*>/gi,
                                ''
                            );
                            cleanedHtml = sanitizeHtmlBeforeInsert(cleanedHtml);
                            document.execCommand('insertHTML', false, cleanedHtml);
                            _ctx().showToast('远程服务器无法读取本地图片，已过滤图片并保留文字内容（建议单独粘贴图片）', 'warning');
                        }
                    }
                } else {
                    const safeHtml = sanitizeHtmlBeforeInsert(htmlText);
                    document.execCommand('insertHTML', false, safeHtml);
                    setTimeout(async function () {
                        await _processLocalImagesInEditor(editor);
                    }, 100);
                }
            }
        });

        // 拖拽
        editor.addEventListener('drop', async function (e) {
            const state = _editorStates[opts.editorId];
            if (state && state.sourceMode) return;
            if (!_ctx().hasPermission('images.upload')) return;
            const files = e.dataTransfer.files;
            if (!files || files.length === 0) return;
            e.preventDefault();
            let successCount = 0;
            let failCount = 0;
            for (const file of files) {
                if (file.type && file.type.indexOf('image/') === 0) {
                    try {
                        const url = await _uploadImageFile(file);
                        _insertImageAtCursor(editor, url);
                        successCount++;
                    } catch (err) {
                        console.error('拖拽图片上传失败:', err);
                        failCount++;
                    }
                }
            }
            if (successCount > 0 && failCount === 0) {
                _ctx().showToast('图片已保存', 'success');
            } else if (failCount > 0) {
                _ctx().showToast(`${failCount} 张图片上传失败${successCount > 0 ? `，${successCount} 张成功` : ''}`, 'error');
            }
        });

        editor.addEventListener('dragover', function (e) {
            const state = _editorStates[opts.editorId];
            if (state && state.sourceMode) return;
            if (!_ctx().hasPermission('images.upload')) return;
            if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
            }
        });

        // MutationObserver：实时移除漏网的本地路径图片
        const observer = new MutationObserver(function (mutations) {
            for (const mutation of mutations) {
                if (mutation.type !== 'childList') continue;
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    const checkAndRemoveLocalImg = function (img) {
                        if (img.tagName !== 'IMG') return;
                        const src = img.getAttribute('src') || '';
                        const srcset = img.getAttribute('srcset') || '';
                        if (_isLocalFilePath(src) || _hasLocalPathInSrcset(srcset)) {
                            console.warn('MutationObserver 拦截本地路径图片:', src || srcset);
                            img.remove();
                        }
                    };
                    checkAndRemoveLocalImg(node);
                    if (node.querySelectorAll) {
                        node.querySelectorAll('img').forEach(checkAndRemoveLocalImg);
                    }
                });
            }
        });
        observer.observe(editor, { childList: true, subtree: true });
    }

    async function _processLocalImagesInEditor(editor) {
        if (!editor) return 0;
        const images = editor.querySelectorAll('img');
        let convertedCount = 0;

        for (let img of images) {
            if (img.dataset.processed || img.src.includes('img/')) continue;
            try {
                const src = img.src;
                let newSrc = null;
                if (src.startsWith('data:image/')) {
                    newSrc = await _uploadBase64Image(src);
                } else if (src.startsWith('blob:')) {
                    newSrc = await _uploadBlobImage(src);
                } else if (src.startsWith('file://')) {
                    console.warn('跳过本地路径图片（浏览器安全限制）:', src);
                    img.remove();
                    continue;
                }
                if (newSrc) {
                    img.src = newSrc;
                    img.dataset.processed = 'true';
                    convertedCount++;
                }
            } catch (err) {
                console.error('图片处理失败:', err, img.src);
                img.remove();
            }
        }

        if (convertedCount > 0) {
            _ctx().showToast(`已自动处理 ${convertedCount} 张图片`, 'success');
        }
    }

    async function _processProxiedImagesInEditor(editor) {
        if (!editor) return;
        const images = editor.querySelectorAll('img[data-file-src]');
        if (images.length === 0) return;

        let successCount = 0;
        let failCount = 0;

        for (const img of images) {
            if (img.dataset.processed) continue;
            try {
                await new Promise(function (resolve, reject) {
                    if (img.complete && img.naturalWidth > 0) { resolve(); return; }
                    const onDone = function () { clearTimeout(timer); resolve(); };
                    const onErr = function () { clearTimeout(timer); reject(new Error('代理图片加载失败: ' + img.src)); };
                    img.onload = onDone;
                    img.onerror = onErr;
                    const timer = setTimeout(onErr, 15000);
                });
                if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                    throw new Error('图片尺寸为0');
                }
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx2d = canvas.getContext('2d');
                ctx2d.drawImage(img, 0, 0);
                const blob = await new Promise(function (resolve, reject) {
                    canvas.toBlob(resolve, 'image/png', 1.0);
                    setTimeout(function () { reject(new Error('toBlob 超时')); }, 10000);
                });
                if (!blob) throw new Error('Blob生成失败');
                const imageFile = new File([blob], 'pasted_image.png', { type: 'image/png' });
                const url = await _uploadImageFile(imageFile);
                img.src = url;
                img.removeAttribute('data-file-src');
                img.dataset.processed = 'true';
                successCount++;
            } catch (err) {
                console.error('代理图片处理失败:', err);
                img.removeAttribute('data-file-src');
                img.dataset.processed = 'true';
                failCount++;
            }
        }

        if (successCount > 0) {
            _ctx().showToast(`已处理 ${successCount} 张图片${failCount > 0 ? `，${failCount} 张失败` : ''}`, failCount > 0 ? 'warning' : 'success');
        } else if (failCount > 0) {
            _ctx().showToast(`${failCount} 张图片处理失败`, 'error');
        }
    }

    // ============ 图片点击预览 ============

    function openImageViewer(src) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:12000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<i data-feather="x"></i>';
        closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;width:44px;height:44px;border:none;border-radius:50%;background:rgba(255,255,255,0.2);color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;z-index:12001;';
        closeBtn.onmouseover = function () { closeBtn.style.background = 'rgba(255,255,255,0.35)'; };
        closeBtn.onmouseout = function () { closeBtn.style.background = 'rgba(255,255,255,0.2)'; };
        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'max-width:92%;max-height:90%;border-radius:8px;cursor:default;';
        const onEsc = function (ev) { if (ev.key === 'Escape') closeIt(); };
        const closeIt = function () {
            overlay.remove();
            document.removeEventListener('keydown', onEsc);
        };
        closeBtn.onclick = function (ev) { ev.stopPropagation(); closeIt(); };
        overlay.onclick = function (ev) { if (ev.target === overlay) closeIt(); };
        document.addEventListener('keydown', onEsc);
        overlay.appendChild(closeBtn);
        overlay.appendChild(img);
        document.body.appendChild(overlay);
        if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
        else if (typeof feather !== 'undefined') feather.replace();
    }

    function _setupEditorImageClick(editor, opts) {
        if (!editor) return;
        editor.addEventListener('click', function (e) {
            if (e.target && e.target.tagName && e.target.tagName.toUpperCase() === 'IMG') {
                const src = e.target.getAttribute('src') || e.target.src || '';
                if (!src) return;
                if (opts.onImageClick) {
                    opts.onImageClick(src);
                } else {
                    openImageViewer(src);
                }
            }
        });
    }

    // ============ segment-keep 回车处理 ============

    function _setupSegmentKeepEnter(editor, editorId) {
        if (!editor) return;

        function findSegmentKeep(node) {
            while (node && node !== editor) {
                if (node.nodeType === 1 && node.tagName === 'DIV' &&
                    node.classList && node.classList.contains('segment-keep')) {
                    return node;
                }
                node = node.parentNode;
            }
            return null;
        }

        editor.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            const keepParent = findSegmentKeep(range.commonAncestorContainer);
            if (!keepParent) return;

            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const newP = document.createElement('p');
                newP.innerHTML = '<br>';
                if (keepParent.nextSibling) {
                    keepParent.parentNode.insertBefore(newP, keepParent.nextSibling);
                } else {
                    keepParent.parentNode.appendChild(newP);
                }
                const newRange = document.createRange();
                newRange.setStart(newP, 0);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
                _updateEditorCount(editorId);
                return;
            }

            e.preventDefault();
            document.execCommand('insertLineBreak', false, null);
            _updateEditorCount(editorId);
        });

        // 点击空白区域定位光标
        editor.addEventListener('mousedown', function (e) {
            if (e.target !== editor) return;
            e.preventDefault();

            const children = Array.from(editor.children);
            const clickY = e.clientY;

            for (let child of children) {
                const rect = child.getBoundingClientRect();
                if (clickY >= rect.top && clickY <= rect.bottom) {
                    const display = window.getComputedStyle(child).display;
                    const isInline = display === 'inline' || display === 'inline-block';
                    const isBlockImg = (display === 'block') && child.tagName === 'IMG';
                    if (isInline || isBlockImg) {
                        const sel = window.getSelection();
                        const range = document.createRange();
                        range.setStartAfter(child);
                        range.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(range);
                        return;
                    }
                }
            }

            let insertBefore = null;
            for (let child of children) {
                const rect = child.getBoundingClientRect();
                if (clickY < rect.top + rect.height / 2) {
                    insertBefore = child;
                    break;
                }
            }

            const landing = document.createElement('p');
            landing.innerHTML = '<br>';
            if (insertBefore) {
                editor.insertBefore(landing, insertBefore);
            } else {
                editor.appendChild(landing);
            }

            const sel = window.getSelection();
            const range = document.createRange();
            range.setStart(landing, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            _updateEditorCount(editorId);
        });
    }

    // ============ 表情选择器 ============

    const EMOJI_CATEGORIES = [
        { name: '常用', icon: '⭐', emojis: ['😀','😂','🤣','😊','😍','😘','🤔','😢','😡','👍','👎','❤️','🔥','🎉','✅','❌','⭐','💯','🙏','👏','🤝','💪','🤩','😏','😇','🥹','😂','🤮','💀','👻','🎃','🦄','🐱','🐶'] },
        { name: '笑脸手势', icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'] },
        { name: '心形符号', icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💌','💋','💯','💢','💥','💫','💦','💨','🕳️','💬','👁️‍🗨️','🗨️','🗯️','💭','💤'] },
        { name: '动物食物', icon: '🐱', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿️','🦔','🐾','🐉','🐲','🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🍁','🍂','🍃','🍄','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','🌎','🌍','🌏','🪐','💫','⭐','🌟','✨','⚡','☄️','💥','🔥','🌪️','🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','💧','💦','☔','☂️','🌊','🌫️','🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍩','🍪','🌰','🥜','🍯'] },
        { name: '活动物品', icon: '⚽', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩'] },
        { name: '其他', icon: '📦', emojis: ['📦','📧','📨','📩','📤','📥','📦','🏷️','📪','📫','📬','📭','📮','📯','📜','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️','📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'] }
    ];

    const _emojiCatState = {};

    function _initEmojiPicker(editorId) {
        const catContainer = document.getElementById('emojiCategories_' + editorId);
        if (!catContainer) return;
        catContainer.innerHTML = EMOJI_CATEGORIES.map(function (cat, i) {
            return `<button type="button" class="emoji-cat-btn${i === 0 ? ' active' : ''}" data-cat="${i}" onclick="unifiedSwitchEmojiCategory('${editorId}', ${i})">${cat.icon}</button>`;
        }).join('');
        _renderEmojiGrid(editorId, 0);
    }

    function _renderEmojiGrid(editorId, catIndex) {
        const grid = document.getElementById('emojiGrid_' + editorId);
        if (!grid) return;
        grid.innerHTML = EMOJI_CATEGORIES[catIndex].emojis.map(function (emo) {
            return `<button type="button" class="emoji-item" onclick="unifiedInsertEmoji('${_escapeAttr(emo)}', '${editorId}')">${emo}</button>`;
        }).join('');
    }

    window.unifiedSwitchEmojiCategory = function (editorId, index) {
        _emojiCatState[editorId] = index;
        const container = document.getElementById('emojiCategories_' + editorId);
        if (container) {
            container.querySelectorAll('.emoji-cat-btn').forEach(function (btn, i) {
                btn.classList.toggle('active', i === index);
            });
        }
        _renderEmojiGrid(editorId, index);
    };

    window.unifiedInsertEmoji = function (emo, editorId) {
        const editor = document.getElementById(editorId);
        if (!editor) return;
        editor.focus();
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(emo);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            editor.textContent += emo;
        }
        _closeEmojiPicker(editorId);
        _updateEditorCount(editorId);
    };

    window.unifiedToggleEmojiPicker = function (e, editorId) {
        e.stopPropagation();
        const picker = document.getElementById('emojiPicker_' + editorId);
        const btn = document.getElementById('emojiToggleBtn_' + editorId);
        if (picker && picker.classList.contains('show')) {
            _closeEmojiPicker(editorId);
        } else {
            if (picker) {
                _initEmojiPicker(editorId);
                picker.classList.add('show');
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () { _positionEmojiPicker(btn, picker); });
                });
            }
        }
    };

    function _positionEmojiPicker(triggerBtn, picker) {
        if (!picker || !triggerBtn) return;
        const rect = triggerBtn.getBoundingClientRect();
        let left = rect.left - 8;
        if (left + 400 > window.innerWidth) {
            left = window.innerWidth - 416;
        }
        if (left < 8) left = 8;
        const pickerHeight = picker.offsetHeight || 350;
        const top = rect.top - pickerHeight - 6;
        picker.style.left = left + 'px';
        picker.style.top = top + 'px';
    }

    function _closeEmojiPicker(editorId) {
        const picker = document.getElementById('emojiPicker_' + editorId);
        if (picker) picker.classList.remove('show');
    }
    window.unifiedCloseEmojiPicker = function (editorId) { _closeEmojiPicker(editorId); };

    // ============ 暴露给外部的 API ============

    // 暴露给前台 items.js / preview.js / segment.js 等使用
    window.openImageViewer = openImageViewer;
    window.sanitizeHtmlBeforeInsert = sanitizeHtmlBeforeInsert;
    window.sanitizeContent = sanitizeContent;
    window.processLocalImagesInEditor = function () {
        // 兼容旧 API：处理当前打开的编辑器
        // 找到第一个 .unified-editor 元素
        const editor = document.querySelector('.unified-editor');
        return _processLocalImagesInEditor(editor);
    };

    // 暴露模块 API
    window.UnifiedEditor = {
        buildHTML: buildUnifiedEditorHTML,
        buildMetaHTML: buildMetaHTML,
        init: initUnifiedEditor,
        sanitizeHtmlBeforeInsert: sanitizeHtmlBeforeInsert,
        sanitizeContent: sanitizeContent,
        openImageViewer: openImageViewer,
        denormalizeImgPaths: _denormalizeUploadUrl,
        computeItemMetaInfo: computeItemMetaInfo,
        normalizeImgPaths: function (html) {
            // 把 img/xxx 转换为 prefix+img/xxx（用于显示）
            const prefix = _ctx().imagePathPrefix;
            if (!prefix || !html) return html;
            return html.replace(/src=["'](img\/[^"']+)["']/gi, function (match, path) {
                if (path.startsWith('../')) return match;
                return `src="${prefix}${path}"`;
            });
        },
        getState: function (editorId) { return _editorStates[editorId]; },
        /**
         * 获取编辑器当前内容（处理源码模式与富文本模式）
         * @param {string} editorId
         * @returns {string} HTML 内容
         */
        getContent: function (editorId) {
            const state = _editorStates[editorId];
            if (state && state.sourceMode) {
                const source = document.getElementById(editorId + '_source');
                return source ? source.value : '';
            }
            const editor = document.getElementById(editorId);
            return editor ? editor.innerHTML : '';
        },
        /**
         * 销毁指定编辑器实例（清理状态）
         * @param {string} editorId
         */
        destroy: function (editorId) {
            if (_editorStates[editorId]) delete _editorStates[editorId];
        }
    };
})();
