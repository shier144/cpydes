// ========== 文案分段功能 ==========
// 将一条富文本文案智能拆分为多个可独立复制的段落
// 拆分策略（按优先级）：
//   0. 手动同段标记 <div class="segment-keep">...</div> 整体作为一段（不拆分）
//   1. 手动分段符 <hr class="segment-divider"> 强制切分（用户在编辑器中插入）
//   2. <!--StartFragment-->...<!--EndFragment--> 标记（来自 Word/网页粘贴）
//   3. 顶层块级元素（div/p/ul/ol/table/blockquote/h1-h6 等）
//   4. 独立的 <img> 单独作为一段
// 同时自动过滤空白段落、仅含 <br> 的空段落
// 智能合并（紧邻吸附规则）：开启后，相邻两段中至少有一段是图片则合并，
//   实现"段落+配图"自动成组；标题段、segment-keep 段独立；
//   段间存在空行/空段落（语义断点）时阻止向后合并，尊重用户排版意图
// 手动分段符优先于智能合并：有手动分段符时，按分段符切分，
//   每个分段内部再走结构化拆分+智能合并逻辑

// 块级元素集合
const _SEG_BLOCK_TAGS = new Set([
    'DIV', 'P', 'UL', 'OL', 'LI', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH',
    'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'SECTION',
    'ARTICLE', 'PRE', 'FIGURE', 'FIGCAPTION'
]);

// 手动分段符正则：<hr class="segment-divider"> 或带其他 class 的 hr
const _SEG_DIVIDER_REGEX = /<hr[^>]*class\s*=\s*["'][^"']*segment-divider[^"']*["'][^>]*>/gi;
// 不带 g 标志的测试正则，仅用于 test()，避免与 exec() 共享 lastIndex
const _SEG_DIVIDER_TEST_REGEX = /<hr[^>]*class\s*=\s*["'][^"']*segment-divider[^"']*["'][^>]*>/i;

// segment-keep 容器检测正则：<div class="segment-keep"> 或带其他 class 的 div
const _SEG_KEEP_REGEX = /<div[^>]*class\s*=\s*["'][^"']*segment-keep[^"']*["']/i;

// 预览弹窗的分段模式状态
let previewSegmentMode = false;
// 当前预览的段落数据缓存
let _previewSegments = [];

/**
 * 智能拆分文案内容为段落数组
 * @param {string} html 富文本内容
 * @returns {string[]} 段落 HTML 数组（已去空、去重相邻重复）
 */
function splitContentToSegments(html) {
    if (!html || !html.trim()) return [];

    // 优先级 1：手动分段符切分（用户在编辑器中插入的 <hr class="segment-divider">）
    // 每个分段内部再走结构化拆分 + 智能合并，避免跨分段合并丢失用户意图
    if (_SEG_DIVIDER_TEST_REGEX.test(html)) {
        const parts = [];
        let lastIdx = 0;
        let m;
        while ((m = _SEG_DIVIDER_REGEX.exec(html)) !== null) {
            if (m.index > lastIdx) parts.push(html.slice(lastIdx, m.index));
            lastIdx = m.index + m[0].length;
        }
        if (lastIdx < html.length) parts.push(html.slice(lastIdx));

        const collected = [];
        parts.forEach(part => {
            const segs = _splitContentToSegmentsInner(part);
            segs.forEach(s => collected.push(s));
        });
        // 合并后再次去重相邻重复
        const deduped = [];
        collected.forEach(s => {
            if (deduped.length === 0 || deduped[deduped.length - 1] !== s) {
                deduped.push(s);
            }
        });
        return deduped;
    }

    return _splitContentToSegmentsInner(html);
}

/**
 * 内部分段逻辑：按 StartFragment 标记 / 块级元素 / 独立图片切分 + 智能合并
 * @param {string} html 富文本内容（不含手动分段符）
 * @returns {string[]}
 */
function _splitContentToSegmentsInner(html) {
    if (!html || !html.trim()) return [];

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const segments = [];

    // 提取 StartFragment...EndFragment 之间的内容
    const extractFragments = (htmlStr) => {
        const res = [];
        const regex = /<!--\s*StartFragment\s*-->([\s\S]*?)<!--\s*EndFragment\s*-->/gi;
        let m;
        while ((m = regex.exec(htmlStr)) !== null) {
            const c = m[1].trim();
            if (c) res.push(c);
        }
        return res;
    };

    // 判断节点是否为“空白段落”（仅含 <br>、空白文本，且无图片）
    const isBlankSegment = (el) => {
        if (el.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = el.tagName;
        if (tag === 'BR') return true;
        if (tag === 'IMG') return false;
        if (el.querySelector('img')) return false;
        // 文本内容为空
        if (!el.textContent.trim()) return true;
        // 内容只是空白字符或 &nbsp;
        const txt = el.textContent.replace(/\u00a0/g, '').trim();
        return !txt;
    };

    // 遍历顶层子节点
    Array.from(temp.childNodes).forEach(node => {
        if (node.nodeType === Node.COMMENT_NODE) {
            // 顶层注释（含 Fragment 标记）跳过，由元素内部提取处理
            return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text) segments.push(text);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        // 独立 <img> 标签直接作为一段（确保图片不被遗漏）
        if (node.tagName === 'IMG') {
            segments.push(node.outerHTML);
            return;
        }

        // segment-keep 容器：整体作为一段，不拆分内部结构
        // 用户用此标记强制把"段落+配图"等内容绑定为同一段
        if (node.tagName === 'DIV' && node.classList && node.classList.contains('segment-keep')) {
            segments.push(node.outerHTML);
            return;
        }

        const inner = node.innerHTML || '';
        const hasFragments = inner.indexOf('StartFragment') !== -1;

        if (hasFragments) {
            const frags = extractFragments(inner);
            if (frags.length > 0) {
                // 检查块级元素中是否有 Fragment 标记之外的内容（如图片）
                // 若有，则剥离标记后整体作为一段，避免丢弃标记外的图片等内容
                const stripped = inner.replace(/<!--\s*(Start|End)Fragment\s*-->/gi, '').trim();
                const fragOnlyText = frags.join('').replace(/<[^>]*>/g, '').trim();
                const fullPlainText = stripped.replace(/<[^>]*>/g, '').trim();
                if (fullPlainText.length > fragOnlyText.length || /<img/i.test(stripped)) {
                    // 标记外有额外内容（文字或图片），整体作为一段
                    if (stripped && !isBlankSegment(node)) segments.push(stripped);
                } else {
                    // 标记内包含了全部有意义的内容
                    frags.forEach(f => {
                        if (f.trim()) segments.push(f);
                    });
                }
            } else {
                // 有标记但未匹配成对，剥离标记后整体作为一段
                const stripped = inner.replace(/<!--\s*(Start|End)Fragment\s*-->/gi, '').trim();
                if (stripped && !isBlankSegment(node)) segments.push(stripped);
            }
            return;
        }

        // 无 Fragment 标记：整体作为一段（过滤空白）
        if (!isBlankSegment(node)) {
            segments.push(node.outerHTML);
        }
    });

    // 后处理：过滤空内容（纯文本为空且无图片）
    const cleaned = segments.filter(s => {
        if (!s || !s.trim()) return false;
        const plain = stripHtml(s).trim();
        const hasImg = /<img/i.test(s);
        return plain || hasImg;
    });

    // 去除相邻完全相同的段落
    const deduped = [];
    cleaned.forEach(s => {
        if (deduped.length === 0 || deduped[deduped.length - 1] !== s) {
            deduped.push(s);
        }
    });

    // 智能合并：图文段紧邻吸附（文字+图片、图片+文字、图片+图片 自动成组）
    // 始终启用：所有合并规则都涉及图片，文字+文字不会合并，无副作用
    const merged = mergeImageTextSegments(deduped);

    // 合并后再次去重（合并可能产生新的相邻重复）
    const finalSegs = [];
    merged.forEach(s => {
        if (finalSegs.length === 0 || finalSegs[finalSegs.length - 1] !== s) {
            finalSegs.push(s);
        }
    });

    return finalSegs;
}

/**
 * 智能合并图文段（紧邻吸附规则）
 * 规则：
 *   - 连续的图片段 → 合并为一段（配套图组）
 *   - 图片段 + 紧邻的文字段（任意长度）→ 合并（图注/说明）
 *   - 文字段 + 紧邻的图片段 → 合并（段落配图）
 *   - mixed 段（已含图文）尾部无断点时 → 可向后吸收连续图片
 *   - 文字段 + 文字段 → 不合并（避免把无关段落合并在一起）
 *   - 标题段（h1-h6）→ 独立成段，不参与合并
 *   - segment-keep 段 → 独立，不参与合并
 *   - 段间存在语义断点（段尾 <br><br> / 空 <p></p> / 空 <div></div>，
 *     或下段开头有空行标记）→ 阻止向后合并，尊重用户排版意图
 * @param {string[]} segments HTML 段落数组
 * @returns {string[]} 合并后的段落数组
 */
function mergeImageTextSegments(segments) {
    if (!segments || segments.length <= 1) return segments || [];

    // 标题段独立
    const isHeading = (seg) => /^<h[1-6]\b/i.test((seg || '').trim());
    // segment-keep 段独立
    const isKeepSegment = (seg) => _SEG_KEEP_REGEX.test(seg || '');
    // 段尾语义断点：连续两个 <br>、末尾空 <p></p>、空 <div></div>
    const hasTrailingBreak = (seg) => {
        const s = seg || '';
        return /<br\s*\/?>(\s|&nbsp;)*<br\s*\/?>\s*$/i.test(s)
            || /<p[^>]*>\s*(<br\s*\/?>)?\s*<\/p>\s*$/i.test(s)
            || /<div[^>]*>\s*(<br\s*\/?>)?\s*<\/div>\s*$/i.test(s);
    };
    // 段首语义断点：开头连续两个 <br>、开头空 <p></p>、空 <div></div>
    const hasLeadingBreak = (seg) => {
        const s = (seg || '').replace(/^\s+/, '');
        return /^(\s|&nbsp;)*<br\s*\/?>(\s|&nbsp;)*<br\s*\/?>/i.test(s)
            || /^<p[^>]*>\s*(<br\s*\/?>)?\s*<\/p>/i.test(s)
            || /^<div[^>]*>\s*(<br\s*\/?>)?\s*<\/div>/i.test(s);
    };

    const getType = (seg) => {
        if (isKeepSegment(seg)) return 'keep';
        if (isHeading(seg)) return 'heading';
        const hasImg = /<img/i.test(seg);
        const plain = stripHtml(seg).trim();
        const hasText = plain.length > 0;
        if (hasImg && hasText) return 'mixed';
        if (hasImg) return 'image';
        if (hasText) return 'text';
        return 'empty';
    };

    // 以图片为锚点向后吸收：支持"图片+文字+图片+文字..."循环吸收
    // 吸收文字的条件：前一段无尾断点，当前文字段无首断点
    const absorbFromImage = (startIdx, prefix) => {
        let merged = prefix;
        let hasTrailing = hasTrailingBreak(merged);
        let j = startIdx;

        // 循环吸收：图片 → 文字 → 图片 → 文字 → ...
        while (j < segments.length && !hasTrailing) {
            const seg = segments[j];
            const segType = getType(seg);

            // 1. 吸收连续图片或混合段（含图片的段）
            if ((segType === 'image' || segType === 'mixed') && !hasLeadingBreak(seg)) {
                merged += seg;
                j++;
                hasTrailing = hasTrailingBreak(merged);
                continue;
            }

            // 2. 吸收一段文字（任意长度）
            if (segType === 'text' && !hasLeadingBreak(seg)) {
                merged += seg;
                j++;
                hasTrailing = hasTrailingBreak(merged);
                // 继续循环，可能后面还有图片
                continue;
            }

            // 其他类型或存在断点，停止吸收
            break;
        }

        return { merged, nextIdx: j };
    };

    const result = [];
    let i = 0;
    while (i < segments.length) {
        const cur = segments[i];
        const curType = getType(cur);

        // keep / heading：保持独立
        if (curType === 'keep' || curType === 'heading') {
            result.push(cur);
            i++;
            continue;
        }

        // 图片段为锚点：向后吸收
        if (curType === 'image') {
            const { merged, nextIdx } = absorbFromImage(i + 1, cur);
            result.push(merged);
            i = nextIdx;
            continue;
        }

        // 文字段 + 紧邻图片 → 合并（段落配图）
        // 继续支持"文字+图片+文字+图片..."循环吸收
        if (curType === 'text'
            && !hasTrailingBreak(cur)
            && i + 1 < segments.length
            && (getType(segments[i + 1]) === 'image' || getType(segments[i + 1]) === 'text' || getType(segments[i + 1]) === 'mixed')
            && !hasLeadingBreak(segments[i + 1])) {
            const { merged, nextIdx } = absorbFromImage(i + 1, cur);
            result.push(merged);
            i = nextIdx;
            continue;
        }

        // mixed 段：尾部无断点时向后吸收连续图片
        if (curType === 'mixed' && !hasTrailingBreak(cur)) {
            let merged = cur;
            let j = i + 1;
            while (j < segments.length
                   && getType(segments[j]) === 'image'
                   && !hasLeadingBreak(segments[j])
                   && !hasTrailingBreak(merged)) {
                merged += segments[j];
                j++;
            }
            result.push(merged);
            i = j;
            continue;
        }

        // 默认：保持独立
        result.push(cur);
        i++;
    }
    return result;
}

/**
 * 渲染分段视图到预览弹窗
 * @param {object} item 文案对象
 */
function renderPreviewSegments(item) {
    const bodyEl = document.getElementById('previewBody');
    if (!bodyEl || !item) return;

    const segments = splitContentToSegments(item.content || '');
    _previewSegments = segments;

    const copyBtn = document.getElementById('previewCopyBtn');
    const segBtn = document.getElementById('previewSegmentBtn');

    if (segments.length === 0) {
        bodyEl.innerHTML = '<em style="color:#9ca3af">暂无可分段内容</em>';
        if (copyBtn) {
            copyBtn.innerHTML = '<i data-feather="copy" style="width:14px;height:14px;"></i> 复制内容';
        }
        return;
    }

    // 单段文案：提示无需分段，但仍然展示
    const singleHint = segments.length === 1
        ? '<div class="seg-info-banner"><i data-feather="info" style="width:14px;height:14px;"></i> 该文案仅包含 1 个段落，无需分段复制</div>'
        : `<div class="seg-info-banner"><i data-feather="layers" style="width:14px;height:14px;"></i> 共 <strong>${segments.length}</strong> 段，可单独复制每段</div>`;

    const cardsHtml = segments.map((segHtml, idx) => {
        const plain = stripHtml(segHtml).trim();
        const charCount = plain ? plain.length : 0;
        const imgCount = (segHtml.match(/<img/gi) || []).length;
        const countLabel = charCount > 0
            ? (imgCount > 0 ? `${charCount} 字 · ${imgCount} 图` : `${charCount} 字`)
            : (imgCount > 0 ? `${imgCount} 张图片` : '');

        const safeSeg = (typeof sanitizeHtmlBeforeInsert === 'function')
            ? sanitizeHtmlBeforeInsert(segHtml)
            : segHtml;
        // 包装相邻图片为 img-group，让多图横排显示
        const finalSeg = (typeof wrapAdjacentImages === 'function')
            ? wrapAdjacentImages(safeSeg)
            : safeSeg;

        return `
        <div class="seg-card" data-seg-idx="${idx}">
            <div class="seg-card-head">
                <span class="seg-badge">段落 ${idx + 1}</span>
                ${countLabel ? `<span class="seg-meta">${countLabel}</span>` : ''}
                <button class="seg-copy-btn" onclick="copySegmentByIndex(${idx})">
                    <i data-feather="copy" style="width:13px;height:13px;"></i> 复制本段
                </button>
            </div>
            <div class="seg-card-body">${finalSeg}</div>
        </div>`;
    }).join('');

    bodyEl.innerHTML = singleHint + `<div class="seg-cards-wrap">${cardsHtml}</div>`;

    // 绑定图片点击放大
    bodyEl.querySelectorAll('img').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.onclick = (e) => {
            e.stopPropagation();
            if (typeof openImageViewer === 'function') openImageViewer(img.src);
        };
    });

    // 主复制按钮变为"复制全部"
    if (copyBtn) {
        copyBtn.innerHTML = '<i data-feather="copy" style="width:14px;height:14px;"></i> 复制全部';
    }
    // 高亮分段按钮
    if (segBtn) segBtn.classList.add('active');

    if (typeof refreshFeatherIcons === 'function') refreshFeatherIcons();
}

/**
 * 恢复为全量内容视图
 * @param {object} item 文案对象
 */
function renderPreviewFull(item) {
    const bodyEl = document.getElementById('previewBody');
    if (!bodyEl || !item) return;

    const safeContent = (typeof sanitizeHtmlBeforeInsert === 'function' && item.content)
        ? sanitizeHtmlBeforeInsert(item.content)
        : (item.content || '');
    bodyEl.innerHTML = safeContent || '<em style="color:#9ca3af">暂无内容</em>';

    bodyEl.querySelectorAll('img').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.onclick = (e) => {
            e.stopPropagation();
            if (typeof openImageViewer === 'function') openImageViewer(img.src);
        };
    });

    const copyBtn = document.getElementById('previewCopyBtn');
    if (copyBtn) {
        copyBtn.innerHTML = '<i data-feather="copy" style="width:14px;height:14px;"></i> 复制内容';
    }
    const segBtn = document.getElementById('previewSegmentBtn');
    if (segBtn) segBtn.classList.remove('active');
}

/**
 * 切换预览弹窗的分段/全量模式
 */
function togglePreviewSegmentMode() {
    if (previewItemId === null) return;
    const item = getItemById(previewItemId);
    if (!item) return;

    // 只有一个分段时不允许切换
    if (getSegmentCount(item) <= 1) return;

    previewSegmentMode = !previewSegmentMode;

    if (previewSegmentMode) {
        renderPreviewSegments(item);
    } else {
        renderPreviewFull(item);
    }
}

/**
 * 按索引复制单个段落
 * @param {number} idx 段落索引
 */
function copySegmentByIndex(idx) {
    if (idx < 0 || idx >= _previewSegments.length) {
        showToast('段落不存在', 'error');
        return;
    }
    const segHtml = _previewSegments[idx];
    // 段落复制：透传当前文案 item，用于时效提醒判定
    const item = previewItemId !== null ? getItemById(previewItemId) : null;
    copyRichContent(segHtml, item);
}

/**
 * 复制全部段落（分段模式下使用，等价于复制整条文案）
 */
function copyAllSegments() {
    if (previewItemId === null) return;
    const item = getItemById(previewItemId);
    if (!item) return;
    copyRichContent(item.content || '', item);
}

/**
 * 获取当前文案的段落数（供 UI 提示用）
 * @param {object} item
 * @returns {number}
 */
function getSegmentCount(item) {
    if (!item || !item.content) return 0;
    return splitContentToSegments(item.content).length;
}

/**
 * 读取后台"默认分段展示"配置
 * @returns {boolean}
 */
function isPreviewSegmentDefault() {
    return window.PREVIEW_SEGMENT_DEFAULT === true;
}

/**
 * 将 HTML 中相邻的 <img> 节点包装到 <div class="img-group"> 容器中
 * 让连续多张图片在 CSS 中以 flex 横排显示
 * 规则：
 *   - 仅当连续 ≥2 张 <img>（中间仅有空白文本或 <br>）才包装
 *   - 单图保持原样
 *   - 遇到非空文本节点或其他元素时，结束当前图片组
 * @param {string} html
 * @returns {string}
 */
function wrapAdjacentImages(html) {
    if (!html || !html.trim()) return html || '';
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const result = [];
    let imgBuffer = [];

    const flush = () => {
        if (imgBuffer.length === 0) return;
        if (imgBuffer.length === 1) {
            result.push(imgBuffer[0]);
        } else {
            // 多张相邻图：包装到 img-group
            const group = '<div class="img-group">' + imgBuffer.join('') + '</div>';
            result.push(group);
        }
        imgBuffer = [];
    };

    const children = Array.from(temp.childNodes);
    children.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG') {
            imgBuffer.push(node.outerHTML);
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
            // <br> 不打破图片组，但也不计入（横排时忽略换行）
            return;
        } else if (node.nodeType === Node.TEXT_NODE) {
            // 纯空白文本节点不打破图片组
            if (!node.textContent.trim()) return;
            // 非空文本：结束图片组，保留文本
            flush();
            result.push(node.textContent);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // 其他元素：结束图片组，保留元素
            flush();
            result.push(node.outerHTML);
        }
        // 注释节点等忽略
    });
    flush();

    return result.join('');
}
