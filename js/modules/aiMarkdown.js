'use strict';

// ========== AI Markdown Module ==========
// Markdown rendering, code preview, message bubble creation, code block copy.

(function () {
    var S = window._aiShared;
    var escapeHtml = window._aiEscapeHtml;
    var showToast = window.showToast;
    var copyTextToClipboard = window.copyTextToClipboard;

    // ==================== Markdown Rendering ====================

    var EMOJI_MAP = {
        'smile': '😄', 'laughing': '😆', 'blush': '😊', 'smiley': '😃',
        'wink': '😉', 'joy': '😂', 'rofl': '🤣', 'sad': '😢', 'cry': '😭',
        'angry': '😠', 'rage': '😡', 'heart': '❤️', 'heart_eyes': '😍',
        'ok_hand': '👌', 'thumbsup': '👍', 'thumbsdown': '👎', 'clap': '👏',
        'fire': '🔥', 'sparkles': '✨', 'star': '⭐', 'star2': '🌟',
        'warning': '⚠️', 'white_check_mark': '✅', 'x': '❌', 'heavy_check_mark': '✔️',
        'bulb': '💡', 'rocket': '🚀', 'tada': '🎉', 'tada2': '🥳',
        '100': '💯', 'package': '📦', 'book': '📖', 'books': '📚',
        'memo': '📝', 'pencil': '✏️', 'pushpin': '📌', 'link': '🔗',
        'arrow_right': '➡️', 'arrow_left': '⬅️', 'arrow_up': '⬆️', 'arrow_down': '⬇️',
        'checkered_flag': '🏁', 'gear': '⚙️', 'lock': '🔒', 'unlock': '🔓',
        'eyes': '👀', 'brain': '🧠', 'zap': '⚡', 'wrench': '🔧',
        'hammer': '🔨', 'mag': '🔍', 'chart': '📈', 'bug': '🐛',
        'cake': '🍰', 'coffee': '☕', 'pizza': '🍕', 'apple': '🍎',
        'computer': '💻', 'iphone': '📱', 'keyboard': '⌨️', 'mouse': '🖱️',
        'sun': '☀️', 'moon': '🌙', 'cloud': '☁️', 'umbrella': '☂️',
        'snowflake': '❄️', 'zap2': '⚡', 'ocean': '🌊', 'mountain': '⛰️',
        'mushroom': '🍄', 'flower': '🌸', 'tree': '🌳', 'cactus': '🌵',
        'cat': '🐱', 'dog': '🐶', 'mouse2': '🐭', 'hamster': '🐹',
        'bird': '🐦', 'penguin': '🐧', 'cow': '🐮', 'pig': '🐷',
        'frog': '🐸', 'monkey': '🐵', 'chicken': '🐔', 'unicorn': '🦄',
        'bee': '🐝', 'bug2': '🐞', 'turtle': '🐢', 'snake': '🍍',
        'smile_cat': '😸', 'heartpulse': '💗', 'gift': '🎁', 'cake2': '🎂',
        'email': '📧', 'phone': '📞', 'bomb': '💣', 'hourglass': '⌛',
        'watch': '⌚', 'alarm_clock': '⏰', 'bell': '🔔', 'loudspeaker': '📢'
    };

    function replaceEmojiShortcodes(html) {
        return html.replace(/:([a-z0-9_]+):/g, function (m, name) {
            return EMOJI_MAP[name] != null ? EMOJI_MAP[name] : m;
        });
    }

    function processLists(html) {
        var lines = html.split('\n');
        var out = [];
        var stack = [];

        function closeListsTo(targetIndent) {
            while (stack.length > 0) {
                var top = stack[stack.length - 1];
                if (top.indent > targetIndent) {
                    out.push('</' + (top.type === 'task' ? 'ul' : top.type) + '>');
                    stack.pop();
                } else {
                    break;
                }
            }
        }

        function closeAllLists() {
            while (stack.length > 0) {
                var t = stack.pop();
                out.push('</' + (t.type === 'task' ? 'ul' : t.type) + '>');
            }
        }

        var taskCounter = 0;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var m = line.match(/^(\s*)([-*+]) \[([ xX])\] (.+)$/);
            var ulMatch = !m ? line.match(/^(\s*)([-*+]) (.+)$/) : null;
            var olMatch = (!m && !ulMatch) ? line.match(/^(\s*)(\d+)[.)] (.+)$/) : null;

            if (m || ulMatch || olMatch) {
                var indent = (m || ulMatch || olMatch)[1].replace(/\t/g, '    ').length;
                var listType, content;
                if (m) {
                    listType = 'task';
                    content = m[4];
                    var checked = (m[3] === 'x' || m[3] === 'X');
                    var id = 'ai-task-' + (taskCounter++);
                    content = '<input type="checkbox" id="' + id + '" ' +
                        (checked ? 'checked ' : '') + 'disabled><label for="' + id + '">' + content + '</label>';
                } else if (ulMatch) {
                    listType = 'ul';
                    content = ulMatch[3];
                } else {
                    listType = 'ol';
                    content = olMatch[3];
                }

                closeListsTo(indent);
                if (stack.length > 0 &&
                    stack[stack.length - 1].indent === indent &&
                    stack[stack.length - 1].type === listType) {
                    out.push('<li>' + content + '</li>');
                } else {
                    out.push('<' + (listType === 'task' ? 'ul class="ai-task-list"' : listType) + '>');
                    stack.push({ type: listType, indent: indent });
                    out.push('<li' + (listType === 'task' ? ' class="ai-task-item"' : '') + '>' + content + '</li>');
                }
            } else {
                closeAllLists();
                out.push(line);
            }
        }
        closeAllLists();
        return out.join('\n');
    }

    function safeRenderMarkdown(text) {
        try {
            return renderMarkdown(text);
        } catch (err) {
            console.warn('renderMarkdown 异常，回退纯文本:', err);
            var safe = (text == null) ? '' : String(text);
            return safe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        }
    }

    function renderMarkdown(text) {
        if (!text || typeof text !== 'string') return '';
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        var codeBlocks = [];
        var html = text;

        // Extract fenced code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (match, lang, code) {
            var index = codeBlocks.length;
            codeBlocks.push({ lang: lang, code: code.trim() });
            return '\x00CODEBLOCK' + index + '\x00';
        });

        // Handle unclosed code fence (streaming)
        var unclosedFence = html.indexOf('```');
        if (unclosedFence !== -1) {
            var afterFence = html.substring(unclosedFence + 3);
            if (afterFence.indexOf('```') === -1) {
                var newlineIdx = afterFence.indexOf('\n');
                var streamLang = '';
                var streamCode = '';
                if (newlineIdx === -1) {
                    streamLang = afterFence.replace(/^\s+|\s+$/g, '');
                    streamCode = '';
                } else {
                    streamLang = afterFence.substring(0, newlineIdx).replace(/^\s+|\s+$/g, '');
                    streamCode = afterFence.substring(newlineIdx + 1).replace(/^\n+/, '').replace(/\n+$/, '');
                }
                var streamIndex = codeBlocks.length;
                codeBlocks.push({ lang: streamLang, code: streamCode, streaming: true });
                html = html.substring(0, unclosedFence) + '\x00CODEBLOCK' + streamIndex + '\x00';
            }
        }

        // Extract inline code
        html = html.replace(/`([^`]+)`/g, function (match, code) {
            var index = codeBlocks.length;
            codeBlocks.push({ lang: '', code: code, inline: true });
            return '\x00CODEBLOCK' + index + '\x00';
        });

        // Extract math formulas
        var mathBlocks = [];
        html = html.replace(/\$\$([\s\S]+?)\$\$/g, function (m, formula) {
            var idx = mathBlocks.length;
            mathBlocks.push({ formula: formula, block: true });
            return '\x00MATHBLOCK' + idx + '\x00';
        });
        html = html.replace(/(^|[^\\$])\$([^\$\n]+?)\$(?!\d)/g, function (m, pre, formula) {
            var idx = mathBlocks.length;
            mathBlocks.push({ formula: formula, block: false });
            return pre + '\x00MATHBLOCK' + idx + '\x00';
        });

        // Reference-style link definitions
        var refLinks = {};
        html = html.replace(/^\[([^\]]+)\]:\s*(\S+)(?:\s+["'(]([^\)"']+)["')])?\s*$/gm, function (m, id, url, title) {
            refLinks[id.toLowerCase().trim()] = { url: url, title: title || '' };
            return '';
        });

        // Footnotes
        var footnotes = {};
        var footnoteOrder = [];
        html = html.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, function (m, id, content) {
            if (footnotes[id] === undefined) footnoteOrder.push(id);
            footnotes[id] = content;
            return '';
        });

        // Escape HTML
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // Tables
        var tableRe = new RegExp(
            '^(\\|.+\\|)\\n(\\|(?:\\s*:?-+:?\\s*\\|)+)\\n((?:\\|[^\\n]+\\n?)+)',
            'gm'
        );
        html = html.replace(tableRe, function (match, headerRow, separator, rows) {
            var aligns = separator.split('|')
                .filter(function (c) { return c.trim() !== ''; })
                .map(function (s) {
                    s = s.trim();
                    var left = s.indexOf(':') === 0;
                    var right = s.lastIndexOf(':') === s.length - 1;
                    if (left && right) return 'center';
                    if (right) return 'right';
                    return 'left';
                });
            var headers = headerRow.split('|').filter(function (c) { return c.trim() !== ''; });
            var headerHtml = '<tr>' + headers.map(function (h, i) {
                return '<th style="text-align:' + (aligns[i] || 'left') + '">' + h.trim() + '</th>';
            }).join('') + '</tr>';
            var bodyRows = rows.trim().split('\n');
            var bodyHtml = bodyRows.map(function (row) {
                var cells = row.split('|').filter(function (c) { return c.trim() !== ''; });
                return '<tr>' + cells.map(function (c, i) {
                    return '<td style="text-align:' + (aligns[i] || 'left') + '">' + c.trim() + '</td>';
                }).join('') + '</tr>';
            }).join('');
            return '<div class="ai-table-wrap"><table class="ai-markdown-table"><thead>' + headerHtml + '</thead><tbody>' + bodyHtml + '</tbody></table></div>';
        });

        // Definition lists
        var defListRe = new RegExp(
            '^([^\\n=#*+|>\\x00-][^\\n]+)\\n((?::\\s+.+(?:\\n|$))+)',
            'gm'
        );
        html = html.replace(defListRe, function (match, term, defs) {
            var defItems = defs.trim().split('\n').map(function (d) {
                return '<dd>' + d.replace(/^:\s+/, '').trim() + '</dd>';
            }).join('');
            return '<dl class="ai-deflist"><dt>' + term.trim() + '</dt>' + defItems + '</dl>';
        });

        // Headings
        function slugify(s) {
            return String(s).toLowerCase()
                .replace(/<[^>]+>/g, '')
                .replace(/[^\w\s\u4e00-\u9fa5-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
        }
        html = html.replace(/^###### (.+)$/gm, function (m, t) { return '<h6 id="' + slugify(t) + '">' + t + '</h6>'; });
        html = html.replace(/^##### (.+)$/gm, function (m, t) { return '<h5 id="' + slugify(t) + '">' + t + '</h5>'; });
        html = html.replace(/^#### (.+)$/gm, function (m, t) { return '<h4 id="' + slugify(t) + '">' + t + '</h4>'; });
        html = html.replace(/^### (.+)$/gm, function (m, t) { return '<h3 id="' + slugify(t) + '">' + t + '</h3>'; });
        html = html.replace(/^## (.+)$/gm, function (m, t) { return '<h2 id="' + slugify(t) + '">' + t + '</h2>'; });
        html = html.replace(/^# (.+)$/gm, function (m, t) { return '<h1 id="' + slugify(t) + '">' + t + '</h1>'; });

        // Horizontal rule
        html = html.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr>');

        // Blockquotes
        html = html.replace(/((?:^&gt;\s?.*(?:\n|$))+)/gm, function (match, block) {
            var inner = block.split('\n').map(function (line) {
                return line.replace(/^&gt;\s?/, '');
            }).join('\n').replace(/\n+$/, '');
            return '\x00BQ\x00' + inner + '\x00BQEND\x00';
        });

        // Lists
        html = processLists(html);

        // Inline formatting
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*])\*([^\*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
        html = html.replace(/(^|[^\w])_([^\_\n]+?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
        html = html.replace(/==(.+?)==/g, '<mark>$1</mark>');
        html = html.replace(/(^|[^~])~([^\s~][^~]*?)~(?![~])/g, '$1<sub>$2</sub>');
        html = html.replace(/(^|[^\^])\^([^\s^][^^]*?)\^(?![\^])/g, '$1<sup>$2</sup>');
        html = html.replace(/&lt;kbd&gt;([\s\S]*?)&lt;\/kbd&gt;/g, '<kbd class="ai-kbd">$1</kbd>');
        html = html.replace(/&lt;mark&gt;([\s\S]*?)&lt;\/mark&gt;/g, '<mark>$1</mark>');

        // Auto-links
        html = html.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, function (m, url) {
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
        });
        html = html.replace(/&lt;([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})&gt;/g, function (m, email) {
            return '<a href="mailto:' + email + '">' + email + '</a>';
        });
        html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)"']+)/g, function (m, pre, url) {
            if (pre === '"' || pre === "'") return m;
            return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
        });

        // Images
        html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?(?:\s+=(\d+)x(\d+))?\s*\)/g, function (match, alt, url, title, w, h) {
            var safeUrl = /^(https?:\/\/|data:image\/|\/)/i.test(url) ? url : '';
            var style = 'max-width:100%;border-radius:8px;margin:8px 0;display:block;';
            if (w) style += 'width:' + w + 'px;';
            if (h) style += 'height:' + h + 'px;';
            var titleAttr = title ? ' title="' + title + '"' : '';
            return '<img src="' + safeUrl + '" alt="' + alt + '"' + titleAttr + ' style="' + style + '">';
        });

        // Inline links
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\s*\)/g, function (match, text, url, title) {
            var safeUrl = /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url) ? url : '#';
            var titleAttr = title ? ' title="' + title + '"' : '';
            return '<a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer"' + titleAttr + '>' + text + '</a>';
        });

        // Reference-style links
        html = html.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, function (match, text, id) {
            var refId = (id || text).toLowerCase().trim();
            var ref = refLinks[refId];
            if (ref) {
                var titleAttr = ref.title ? ' title="' + ref.title + '"' : '';
                return '<a href="' + ref.url + '" target="_blank" rel="noopener noreferrer"' + titleAttr + '>' + text + '</a>';
            }
            return match;
        });

        // Reference-style images
        html = html.replace(/!\[([^\]]+)\]\[([^\]]+)\]/g, function (match, alt, id) {
            var ref = refLinks[id.toLowerCase().trim()];
            if (!ref) return match;
            var safeUrl = /^(https?:\/\/|data:image\/|\/)/i.test(ref.url) ? ref.url : '';
            var titleAttr = ref.title ? ' title="' + ref.title + '"' : '';
            return '<img src="' + safeUrl + '" alt="' + alt + '"' + titleAttr + ' style="max-width:100%;border-radius:8px;margin:8px 0;display:block;">';
        });

        // Footnote references
        html = html.replace(/\[\^([^\]]+)\]/g, function (match, id) {
            if (footnotes[id] !== undefined) {
                return '<sup class="ai-footnote-ref"><a href="#fn-' + id + '" id="fnref-' + id + '">[' + id + ']</a></sup>';
            }
            return match;
        });

        // Emoji shortcodes
        html = replaceEmojiShortcodes(html);

        // Hard line breaks
        html = html.replace(/  \n/g, '<br>\n');
        html = html.replace(/\\\n/g, '<br>\n');

        // Restore blockquotes
        html = html.replace(/\x00BQ\x00([\s\S]*?)\x00BQEND\x00/g, function (match, inner) {
            return '<blockquote>' + inner + '</blockquote>';
        });

        // Paragraphs - wrap text lines not already inside block elements
        // Only wrap lines that start with text content (not block-level elements)
        html = html.split('\n').map(function(line) {
            // Skip empty lines
            if (line.trim() === '') return '';
            // Skip lines starting with block elements or special markers
            var skipPattern = /^(\x00|<(h[1-6]|pre|div|table|blockquote|hr|ul|ol|dl|p|section|header|footer|main|aside|nav|figure|figcaption|video|audio|canvas|svg|iframe|details|summary)|<\/(h[1-6]|pre|div|table|blockquote|ul|ol|dl|p|section|header|footer|main|aside|nav|figure|figcaption|video|audio|canvas|svg|iframe|details|summary)|<li|<dd|<dt|<thead|<tbody|<tfoot|<tr|<th|<td|<br|<img|<video|<audio|<hr)/i;
            if (skipPattern.test(line.trim())) return line;
            // Skip lines that are just inline elements that shouldn't be alone
            var inlineOnly = /^<(strong|em|del|mark|a|kbd|sub|sup|code|span|small|big|abbr|cite|q|var|samp|time|data|ins)(\s|>)/i;
            if (inlineOnly.test(line.trim())) return line;
            // Wrap remaining text content
            return '<p>' + line + '</p>';
        }).join('\n');

        // Append footnotes section
        if (footnoteOrder.length > 0) {
            var fnHtml = '<section class="ai-footnotes"><hr><ol>';
            for (var fi = 0; fi < footnoteOrder.length; fi++) {
                var fid = footnoteOrder[fi];
                fnHtml += '<li id="fn-' + fid + '">' + footnotes[fid] +
                    ' <a href="#fnref-' + fid + '" class="ai-footnote-back" title="返回">↩</a></li>';
            }
            fnHtml += '</ol></section>';
            html += fnHtml;
        }

        // Restore math blocks
        html = html.replace(/\x00MATHBLOCK(\d+)\x00/g, function (match, idx) {
            var m = mathBlocks[parseInt(idx)];
            var escaped = m.formula
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            if (m.block) {
                return '<div class="ai-math-block"><code>' + escaped + '</code></div>';
            }
            return '<span class="ai-math-inline"><code>' + escaped + '</code></span>';
        });

        // Clean up extra newlines
        html = html.replace(/\n{3,}/g, '\n\n');

        // Restore code blocks with syntax highlighting
        html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, function (match, index) {
            var block = codeBlocks[parseInt(index)];
            if (block.inline) {
                var escapedCode = block.code
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                return '<code>' + escapedCode + '</code>';
            }

            var escapedCode = block.code
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            var langDisplay = block.lang ? escapeHtml(block.lang) : 'Code';
            var lineCount = escapedCode.split('\n').length;
            // Remove trailing empty line if code ends with newline
            if (escapedCode.endsWith('\n')) {
                lineCount = Math.max(1, lineCount - 1);
            }
            if (lineCount === 1 && escapedCode === '' && block.streaming) {
                lineCount = 1;
            }

            var lineNumbersHtml = '';
            for (var li = 0; li < lineCount; li++) {
                lineNumbersHtml += '<span>' + (li + 1) + '</span>';
            }

            var streamingBadge = block.streaming
                ? '<span class="ai-code-streaming-badge"><span class="ai-code-streaming-dot"></span>生成中</span>'
                : '';

            var isPreviewable = !block.streaming && (block.lang === 'html' || block.lang === 'css' || block.lang === 'javascript' || block.lang === 'js');

            // Build header with tabs
            var tabsHtml = '';
            var previewTabId = '';
            if (isPreviewable) {
                var previewTabId = 'preview_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                tabsHtml = '<div class="ai-code-tabs">' +
                    '<button class="ai-code-tab active" data-tab="code" onclick="switchCodeTab(this, \'' + previewTabId + '\')">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' +
                    '<span>代码</span>' +
                    '</button>' +
                    '<button class="ai-code-tab" data-tab="preview" onclick="switchCodeTab(this, \'' + previewTabId + '\', \'' + block.lang + '\')">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
                    '<span>预览</span>' +
                    '</button>' +
                    '</div>';
            }

            var headerBar = '<div class="ai-code-header">' +
                '<div class="ai-code-header-left">' +
                '<div class="ai-code-lang"><div class="ai-code-lang-dots"><span class="ai-code-lang-dot" style="background:#f38ba8"></span><span class="ai-code-lang-dot" style="background:#f9e2af"></span><span class="ai-code-lang-dot" style="background:#a6e3a1"></span></div><span class="ai-code-lang-text">' + langDisplay + '</span>' + streamingBadge + '</div>' +
                tabsHtml +
                '</div>' +
                '<button class="ai-code-copy-btn" onclick="copyCodeBlock(this)" title="复制代码"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>复制</span></button>' +
                '</div>';

            var codeContent = escapedCode;
            if (typeof Prism !== 'undefined' && block.lang) {
                try {
                    var grammar = Prism.languages[block.lang.toLowerCase()];
                    if (grammar) {
                        codeContent = Prism.highlight(block.code, grammar, block.lang.toLowerCase());
                    }
                } catch (e) {
                    codeContent = escapedCode;
                }
            }

            var streamingCursor = block.streaming ? '<span class="ai-code-cursor"></span>' : '';

            var bodyHtml = '<div class="ai-code-pane ai-code-pane-code">' +
                '<div class="ai-code-body">' +
                '<div class="ai-code-lines">' + lineNumbersHtml + '</div>' +
                '<pre><code class="language-' + escapeHtml(block.lang || 'plaintext') + '">' + codeContent + streamingCursor + '</code></pre>' +
                '</div>' +
                '</div>';

            // Build preview pane (hidden by default)
            var previewPaneHtml = '';
            if (isPreviewable) {
                previewPaneHtml = '<div class="ai-code-pane ai-code-pane-preview" id="' + previewTabId + '" style="display:none;">' +
                    buildPreviewContent(block.lang, block.code, previewTabId) +
                    '</div>';
            }

            var blockClass = 'ai-code-block' + (block.streaming ? ' ai-code-block-streaming' : '');
            return '<div class="' + blockClass + '">' + headerBar + bodyHtml + previewPaneHtml + '</div>';
        });

        return html;
    }

    // ==================== Code Block Copy ====================

    var COPY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    var CHECK_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    window.copyCodeBlock = function copyCodeBlock(btn) {
        var codeBlock = btn.closest('.ai-code-block');
        if (!codeBlock) return;
        var code = codeBlock.querySelector('code');
        if (!code) return;

        var text = code.textContent;
        copyTextToClipboard(text).then(function (ok) {
            if (ok) {
                btn.innerHTML = CHECK_ICON_SVG + '<span>已复制</span>';
                btn.classList.add('copied');
                setTimeout(function () {
                    btn.innerHTML = COPY_ICON_SVG + '<span>复制</span>';
                    btn.classList.remove('copied');
                }, 2000);
            } else {
                showToast('复制失败，请手动复制', 'error');
            }
        });
    };

    // ==================== Code Tab Switching ====================

    window.switchCodeTab = function switchCodeTab(tabBtn, previewId, lang) {
        var block = tabBtn.closest('.ai-code-block');
        if (!block) return;

        // Update tab states
        var tabs = block.querySelectorAll('.ai-code-tab');
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tabBtn.classList.add('active');

        var tab = tabBtn.dataset.tab;
        var codePane = block.querySelector('.ai-code-pane-code');
        var previewPane = block.querySelector('.ai-code-pane-preview');

        if (tab === 'code') {
            if (codePane) codePane.style.display = 'block';
            if (previewPane) previewPane.style.display = 'none';
        } else if (tab === 'preview') {
            if (codePane) codePane.style.display = 'none';
            if (previewPane) {
                previewPane.style.display = 'block';
                // Set iframe srcdoc via JavaScript to avoid attribute escaping issues
                var iframe = previewPane.querySelector('.ai-code-preview-iframe');
                if (iframe && !iframe.srcdoc) {
                    var code = window['_htmlCode_' + previewId] || '';
                    if (lang === 'html' && code) {
                        iframe.srcdoc = code;
                    } else if (lang === 'css') {
                        var css = window['_cssCode_' + previewId] || '';
                        var sampleHtml = '<!DOCTYPE html><html><head><style>' + css + '</style></head><body><div class="sample-content"><h1>示例标题</h1><p>这是一段示例文本</p></div></body></html>';
                        iframe.srcdoc = sampleHtml;
                    }
                }
            }
        }
    };

    // ==================== Preview Content Builder ====================

    function buildPreviewContent(lang, code, previewId) {
        if (lang === 'html') return buildHtmlPreview(code, previewId);
        if (lang === 'css') return buildCssPreview(code, previewId);
        if (lang === 'javascript' || lang === 'js') return buildJsPreview(code, previewId);
        return '';
    }

    function renderPreviewPane(pane, lang, previewId) {
        // Only render once
        if (pane.dataset.rendered) return;
        pane.dataset.rendered = 'true';

        var html = '';
        if (lang === 'html') {
            var code = window['_htmlCode_' + previewId] || '';
            html = '<iframe class="ai-code-preview-iframe" sandbox="allow-scripts" srcdoc="' + code.replace(/"/g, '&quot;').replace(/\n/g, '&#10;') + '"></iframe>';
        } else if (lang === 'css') {
            var css = window['_cssCode_' + previewId] || '';
            var sampleHtml = '<!DOCTYPE html>\n<html>\n<head>\n<style>\n' + css + '\n</style>\n</head>\n<body>\n<div class="sample-content">\n<h1>示例标题</h1>\n<p>这是一段示例文本，用于展示 CSS 样式效果。</p>\n<ul>\n<li>列表项 1</li>\n<li>列表项 2</li>\n<li>列表项 3</li>\n</ul>\n<button class="sample-button">示例按钮</button>\n<a href="#" class="sample-link">示例链接</a>\n<table class="sample-table">\n<tr><th>表头1</th><th>表头2</th></tr>\n<tr><td>数据1</td><td>数据2</td></tr>\n<tr><td>数据3</td><td>数据4</td></tr>\n</table>\n</div>\n</body>\n</html>';
            html = '<iframe class="ai-code-preview-iframe" sandbox="allow-scripts" srcdoc="' + sampleHtml.replace(/"/g, '&quot;').replace(/\n/g, '&#10;') + '"></iframe>';
        }
        pane.innerHTML = html;
    }

    function buildHtmlPreview(htmlCode, previewId) {
        // Store original code for refresh
        window['_htmlCode_' + previewId] = htmlCode;
        return '<div class="ai-preview-content">' +
            '<div class="ai-preview-toolbar">' +
            '<div class="ai-preview-type-label">HTML</div>' +
            '<div class="ai-preview-toolbar-actions">' +
            '<button class="ai-preview-action-btn" onclick="refreshPreview(\'' + previewId + '\', \'html\')" title="刷新预览"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>' +
            '<button class="ai-preview-action-btn" onclick="expandPreview(\'' + previewId + '\')" title="全屏查看"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>' +
            '</div>' +
            '</div>' +
            '<iframe class="ai-code-preview-iframe" id="iframe_' + previewId + '" sandbox="allow-scripts"></iframe>' +
            '</div>';
    }

    function buildCssPreview(cssCode, previewId) {
        // Store original code for refresh
        window['_cssCode_' + previewId] = cssCode;
        return '<div class="ai-preview-content">' +
            '<div class="ai-preview-toolbar">' +
            '<div class="ai-preview-type-label">CSS</div>' +
            '<div class="ai-preview-toolbar-actions">' +
            '<button class="ai-preview-action-btn" onclick="refreshPreview(\'' + previewId + '\', \'css\')" title="刷新预览"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>' +
            '<button class="ai-preview-action-btn" onclick="expandPreview(\'' + previewId + '\')" title="全屏查看"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>' +
            '</div>' +
            '</div>' +
            '<iframe class="ai-code-preview-iframe" id="iframe_' + previewId + '" sandbox="allow-scripts"></iframe>' +
            '</div>';
    }

    function buildJsPreview(jsCode, previewId) {
        var wrappedJs = '(function() {\n' +
            'var _console = {};\n' +
            '["log","warn","error","info","table"].forEach(function(m) {\n' +
            '  _console[m] = function() {\n' +
            '    var msg = Array.prototype.slice.call(arguments).map(function(a) {\n' +
            '      return (typeof a === "object") ? JSON.stringify(a, null, 2) : String(a);\n' +
            '    }).join(" ");\n' +
            '    var el = document.createElement("div");\n' +
            '    el.className = "js-console js-console-" + m;\n' +
            '    el.textContent = msg;\n' +
            '    document.getElementById("js-output-' + previewId.replace(/-/g, '_') + '").appendChild(el);\n' +
            '  };\n' +
            '});\n' +
            'try {\n' +
            jsCode.replace(/<\/script>/gi, "<\\/script>") + '\n' +
            '} catch(e) {\n' +
            '  _console.error(e.message || e);\n' +
            '}\n' +
            '})();';
        var consoleHtml = '<div id="js-output-' + previewId.replace(/-/g, '_') + '" class="js-console-output"></div>';
        window['_jsCode_' + previewId] = wrappedJs;
        return '<div class="ai-preview-content ai-preview-content-js">' +
            '<div class="ai-preview-toolbar">' +
            '<div class="ai-preview-type-label">JavaScript</div>' +
            '<div class="ai-preview-toolbar-actions">' +
            '<button class="ai-preview-action-btn" onclick="runJsPreview(\'' + previewId + '\')" title="运行代码"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>' +
            '<button class="ai-preview-action-btn" onclick="clearJsOutput(\'' + previewId + '\')" title="清空输出"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '</div>' +
            '</div>' +
            consoleHtml +
            '</div>';
    }

    // ==================== Message Bubble Creation ====================

    function createMessageElement(role, content, messageIndex) {
        var msgDiv = document.createElement('div');
        msgDiv.className = 'ai-message ' + role;
        if (typeof messageIndex === 'number') {
            msgDiv.dataset.messageIndex = messageIndex;
        }

        var bubbleWrap = document.createElement('div');
        bubbleWrap.className = 'ai-msg-bubble-wrap';
        var bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble';

        if (role === 'assistant') {
            var avatar = document.createElement('div');
            avatar.className = 'ai-msg-avatar ai-msg-avatar-bot';
            avatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';
            msgDiv.appendChild(avatar);
            var rendered = safeRenderMarkdown(content);
            bubble.innerHTML = rendered;

            var actions = document.createElement('div');
            actions.className = 'ai-msg-actions';

            var copyBtn = document.createElement('button');
            copyBtn.className = 'ai-msg-action-btn';
            var msgCopyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            copyBtn.innerHTML = msgCopyIcon + ' 复制';
            (function (txt, btn, icon) {
                btn.addEventListener('click', function () {
                    copyTextToClipboard(txt).then(function (ok) {
                        if (ok) {
                            btn.textContent = '已复制';
                            setTimeout(function () { btn.innerHTML = icon + ' 复制'; }, 2000);
                        } else {
                            showToast('复制失败，请手动复制', 'error');
                        }
                    });
                });
            })(content, copyBtn, msgCopyIcon);
            actions.appendChild(copyBtn);

            var regenBtn = document.createElement('button');
            regenBtn.className = 'ai-msg-action-btn ai-regenerate-btn';
            regenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 重新生成';
            regenBtn.addEventListener('click', function () {
                if (typeof window.regenerateResponse === 'function') window.regenerateResponse();
            });
            actions.appendChild(regenBtn);

            if (typeof messageIndex === 'number') {
                var delBtn = document.createElement('button');
                delBtn.className = 'ai-msg-action-btn ai-msg-action-btn-danger';
                delBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 删除';
                delBtn.addEventListener('click', function () {
                    if (confirm('确定要删除这条消息吗？')) {
                        if (typeof window.deleteMessage === 'function') window.deleteMessage(messageIndex);
                    }
                });
                actions.appendChild(delBtn);
            }

            bubble.appendChild(actions);
        } else {
            bubble.textContent = content;
        }

        bubbleWrap.appendChild(bubble);

        if (role === 'user' && typeof messageIndex === 'number') {
            var userActions = document.createElement('div');
            userActions.className = 'ai-msg-actions';
            var userDelBtn = document.createElement('button');
            userDelBtn.className = 'ai-msg-action-btn ai-msg-action-btn-danger';
            userDelBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 删除';
            userDelBtn.addEventListener('click', function () {
                if (confirm('确定要删除这条消息吗？')) {
                    if (typeof window.deleteMessage === 'function') window.deleteMessage(messageIndex);
                }
            });
            userActions.appendChild(userDelBtn);
            bubbleWrap.appendChild(userActions);
        }

        msgDiv.appendChild(bubbleWrap);

        if (role === 'user') {
            var userAvatar = document.createElement('div');
            userAvatar.className = 'ai-msg-avatar ai-msg-avatar-user';
            userAvatar.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
            msgDiv.appendChild(userAvatar);
        }

        return msgDiv;
    }

    // ==================== Streaming Assistant Element ====================

    function createStreamingAssistantElement() {
        var msgEl = createMessageElement('assistant', '');
        msgEl.classList.add('ai-streaming-msg');
        var bubble = msgEl.querySelector('.ai-msg-bubble');
        if (bubble) {
            bubble.innerHTML = '';
            bubble.classList.add('ai-streaming-cursor');
        }
        return msgEl;
    }

    function updateAssistantBubble(bubble, content, messageIndex) {
        if (!bubble) return;

        // Check if this is a streaming bubble (has actions already been added)
        var existingActions = bubble.querySelector('.ai-msg-actions');
        var isStreaming = bubble.classList.contains('ai-streaming-cursor');

        // Only update markdown content, preserve action buttons
        if (existingActions && isStreaming) {
            // Extract current text content for copy button
            var rendered = safeRenderMarkdown(content);
            existingActions.remove();
            bubble.innerHTML = rendered;
            bubble.appendChild(existingActions);
        } else {
            // First render or final render - build complete content with actions
            var rendered = safeRenderMarkdown(content);
            bubble.innerHTML = rendered;

            var actions = document.createElement('div');
            actions.className = 'ai-msg-actions';

            var streamCopyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

            // Copy button
            var copyBtn = document.createElement('button');
            copyBtn.className = 'ai-msg-action-btn';
            copyBtn.innerHTML = streamCopyIcon + ' 复制';
            (function (txt, btn, icon) {
                btn.addEventListener('click', function () {
                    copyTextToClipboard(txt).then(function (ok) {
                        if (ok) {
                            btn.textContent = '已复制';
                            setTimeout(function () { btn.innerHTML = icon + ' 复制'; }, 2000);
                        } else {
                            showToast('复制失败，请手动复制', 'error');
                        }
                    });
                });
            })(content, copyBtn, streamCopyIcon);
            actions.appendChild(copyBtn);

            // Regenerate button
            var regenBtn = document.createElement('button');
            regenBtn.className = 'ai-msg-action-btn';
            regenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 重新生成';
            regenBtn.addEventListener('click', function () {
                if (typeof window.regenerateResponse === 'function') window.regenerateResponse();
            });
            actions.appendChild(regenBtn);

            // Delete button (only for numbered messages)
            if (typeof messageIndex === 'number') {
                var delBtn = document.createElement('button');
                delBtn.className = 'ai-msg-action-btn ai-msg-action-btn-danger';
                delBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 删除';
                delBtn.addEventListener('click', function () {
                    if (confirm('确定要删除这条消息吗？')) {
                        if (typeof window.deleteMessage === 'function') window.deleteMessage(messageIndex);
                    }
                });
                actions.appendChild(delBtn);
            }

            bubble.appendChild(actions);
        }
    }

    // ==================== Code Preview Actions ====================

    window.toggleCodePreview = function toggleCodePreview(previewId, btn) {
        var container = document.getElementById(previewId);
        if (!container) return;
        var wrapper = container.closest('.ai-code-preview-wrapper');
        if (!wrapper) return;
        var textEl = btn.querySelector('.toggle-text');
        if (!btn.dataset.originalText && textEl) {
            btn.dataset.originalText = textEl.textContent;
        }
        var wasCollapsed = wrapper.classList.contains('collapsed');
        if (wasCollapsed) {
            wrapper.classList.remove('collapsed');
            btn.classList.remove('collapsed');
            container.classList.add('show');
            var titleEl = container.querySelector('.ai-preview-title');
            if (textEl) textEl.textContent = titleEl ? titleEl.textContent : '预览';
        } else {
            wrapper.classList.add('collapsed');
            btn.classList.add('collapsed');
            container.classList.remove('show');
            if (textEl && btn.dataset.originalText) {
                textEl.textContent = btn.dataset.originalText;
            }
        }
    };

    window.refreshPreview = function refreshPreview(previewId, lang) {
        var pane = document.getElementById(previewId);
        if (!pane) return;
        var iframe = pane.querySelector('.ai-code-preview-iframe');
        if (!iframe) return;

        var toolbar = pane.querySelector('.ai-preview-toolbar');
        if (toolbar) {
            toolbar.classList.add('ai-preview-refreshing');
            setTimeout(function() { toolbar.classList.remove('ai-preview-refreshing'); }, 600);
        }

        // Get code from stored variable
        var codeContent = '';
        if (lang === 'html') {
            codeContent = window['_htmlCode_' + previewId] || '';
            iframe.srcdoc = codeContent;
        } else if (lang === 'css') {
            codeContent = window['_cssCode_' + previewId] || '';
            var sampleHtml = '<!DOCTYPE html>\n<html>\n<head>\n<style>\n' + codeContent + '\n</style>\n</head>\n<body>\n<div class="sample-content">\n<h1>示例标题</h1>\n<p>这是一段示例文本，用于展示 CSS 样式效果。</p>\n<ul>\n<li>列表项 1</li>\n<li>列表项 2</li>\n<li>列表项 3</li>\n</ul>\n<button class="sample-button">示例按钮</button>\n<a href="#" class="sample-link">示例链接</a>\n<table class="sample-table">\n<tr><th>表头1</th><th>表头2</th></tr>\n<tr><td>数据1</td><td>数据2</td></tr>\n<tr><td>数据3</td><td>数据4</td></tr>\n</table>\n</div>\n</body>\n</html>';
            iframe.srcdoc = sampleHtml;
        }
        showToast('预览已刷新', 'success');
    };

    window.expandPreview = function expandPreview(previewId) {
        var pane = document.getElementById(previewId);
        if (!pane) return;
        var iframe = pane.querySelector('.ai-code-preview-iframe');
        if (!iframe) return;
        var overlay = document.createElement('div');
        overlay.className = 'ai-preview-fullscreen';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.9);z-index:10000;display:flex;flex-direction:column;';
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#1e293b;color:white;';
        header.innerHTML = '<span style="font-weight:600;">全屏预览</span>' +
            '<button onclick="this.closest(\'.ai-preview-fullscreen\').remove()" style="background:none;border:none;color:white;font-size:24px;cursor:pointer;">&times;</button>';
        var fullIframe = document.createElement('iframe');
        fullIframe.style.cssText = 'flex:1;border:none;background:white;';
        fullIframe.srcdoc = iframe.srcdoc || '';
        overlay.appendChild(header);
        overlay.appendChild(fullIframe);
        document.body.appendChild(overlay);
    };

    window.runJsPreview = function runJsPreview(previewId) {
        var consoleOutput = document.getElementById('js-output-' + previewId.replace(/-/g, '_'));
        if (!consoleOutput) return;
        consoleOutput.innerHTML = '';
        var jsCode = window['_jsCode_' + previewId];
        if (!jsCode) {
            consoleOutput.innerHTML = '<div class="js-console js-console-error">未找到JavaScript代码</div>';
            return;
        }
        try {
            eval(jsCode);
        } catch(e) {
            consoleOutput.innerHTML += '<div class="js-console js-console-error">运行错误: ' + e.message + '</div>';
        }
    };

    window.clearJsOutput = function clearJsOutput(previewId) {
        var consoleOutput = document.getElementById('js-output-' + previewId.replace(/-/g, '_'));
        if (consoleOutput) {
            consoleOutput.innerHTML = '';
        }
    };

    // ==================== Expose to other modules ====================

    window._aiSafeRenderMarkdown = safeRenderMarkdown;
    window._aiCreateMessageElement = createMessageElement;
    window._aiCreateStreamingAssistantElement = createStreamingAssistantElement;
    window._aiUpdateAssistantBubble = updateAssistantBubble;
})();
