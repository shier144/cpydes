// 复制富文本内容（含图片）
function copyRichContent(html, item) {
    // 把图片相对路径转成绝对路径
    const absoluteHtml = convertImageUrlsToAbsolute(html);

    // 优先使用现代 Clipboard API 支持富文本
    if (navigator.clipboard && navigator.clipboard.write) {
        copyRichWithModernApi(absoluteHtml, item);
    } else {
        copyRichWithExecCommand(absoluteHtml, item);
    }
}

// 将图片URL转换为绝对路径（用于复制时图片能正确显示）
function convertImageUrlsToAbsolute(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const images = temp.querySelectorAll('img');
    images.forEach(img => {
        const rawSrc = img.getAttribute('src') || '';
        if (rawSrc && !rawSrc.startsWith('data:') && (rawSrc.startsWith('/') || rawSrc.startsWith('./') || rawSrc.match(/^img\//))) {
            try { img.src = new URL(rawSrc, location.href).href; } catch(e) {}
        }
    });

    return temp.innerHTML;
}

// 现代 Clipboard API 复制富文本
async function copyRichWithModernApi(html, item) {
    try {
        const text = stripHtml(html);

        // 创建 HTML 和纯文本内容
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([text], { type: 'text/plain' });

        const data = [new ClipboardItem({
            'text/html': blobHtml,
            'text/plain': blobText
        })];

        await navigator.clipboard.write(data);
        showToast('已复制', 'success');
        maybeShowCopyReminder(item);
    } catch (err) {
        console.log('现代API复制富文本失败，尝试传统方式:', err);
        copyRichWithExecCommand(html, item);
    }
}

// 传统 execCommand 复制富文本
function copyRichWithExecCommand(html, item) {
    try {
        const div = document.createElement('div');
        div.innerHTML = html;
        div.style.position = 'fixed';
        div.style.top = '-9999px';
        div.style.left = '-9999px';
        div.style.zIndex = '-1000';
        div.style.opacity = '0';
        div.style.pointerEvents = 'none';
        document.body.appendChild(div);

        // 选择内容
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(div);
        selection.removeAllRanges();
        selection.addRange(range);

        // 执行复制
        const successful = document.execCommand('copy');

        // 清理
        selection.removeAllRanges();
        document.body.removeChild(div);

        if (successful) {
            showToast('已复制', 'success');
            maybeShowCopyReminder(item);
        } else {
            // 如果富文本复制失败，回退到纯文本
            const text = stripHtml(html);
            fallbackCopy(text, item);
        }
    } catch (err) {
        console.warn('传统方式复制富文本失败:', err);
        const text = stripHtml(html);
        fallbackCopy(text, item);
    }
}

// 降级复制方案
function fallbackCopy(text, item) {
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showToast('已复制', 'success');
                maybeShowCopyReminder(item);
            } else {
                console.error('复制失败: execCommand 返回 false');
                showToast('复制失败，请手动复制', 'warning');
            }
        } catch (err) {
            console.error('复制失败:', err);
            showToast('复制失败，请手动复制', 'warning');
        }

        document.body.removeChild(textArea);
    } catch (err) {
        console.error('复制失败:', err);
        showToast('复制失败，请手动复制', 'warning');
    }
}

/** 从 HTML 内容中提取所有图片路径 */
function extractImagePaths(html) {
    if (!html) return [];
    const paths = [];
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        if (src && src.startsWith('img/')) {
            paths.push(src);
        }
    }
    return paths;
}

/**
 * 复制文案时效提醒
 * 复制成功后按后台策略判断是否需要追加提醒，提醒文案与时效策略均由后台控制。
 * @param {object|null} item 被复制的文案对象（需含 updatedAt / createdAt）
 */
function maybeShowCopyReminder(item) {
    const cfg = window.COPY_REMINDER;
    if (!cfg || !cfg.enabled) return;
    if (!item || typeof item !== 'object') return;

    // 策略判定
    let hit = false;
    if (cfg.strategy === 'always') {
        hit = true;
    } else if (cfg.strategy === 'aged') {
        const ts = item.updatedAt || item.createdAt || '';
        if (ts) {
            const t = Date.parse(ts);
            if (!isNaN(t)) {
                const thresholdDays = Number(cfg.thresholdDays) || 30;
                hit = (Date.now() - t) > thresholdDays * 86400000;
            }
        }
    }
    if (!hit) return;

    // 组装提醒文案（showUpdatedAt 为真时附「最后更新」，换行分隔独立成行）
    const message = (typeof cfg.message === 'string' && cfg.message.trim()) ? cfg.message : '此文案可能已失效，使用前请核对并按需修改。';
    let text = message;
    if (cfg.showUpdatedAt) {
        const ts = item.updatedAt || item.createdAt || '';
        if (ts) {
            const d = new Date(ts);
            if (!isNaN(d.getTime())) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                // 换行分隔，toast 已支持 pre-wrap 换行渲染
                text += `\n（最后更新：${y}-${m}-${day}）`;
            }
        }
    }

    // 展示方式（透传 textColor / fontSize 样式覆盖）
    const styleOpts = {
        textColor: (typeof cfg.textColor === 'string' ? cfg.textColor : '').trim(),
        fontSize: Number(cfg.fontSize) || 0,
    };
    if (cfg.displayMode === 'modal') {
        if (typeof showConfirm === 'function') {
            showConfirm(text, 'alert-triangle', styleOpts);
        } else if (typeof showToast === 'function') {
            showToast(text, 'warning', Number(cfg.duration) || 5000, styleOpts);
        }
    } else {
        if (typeof showToast === 'function') {
            showToast(text, 'warning', Number(cfg.duration) || 5000, styleOpts);
        }
    }
}
