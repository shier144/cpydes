// ========== 文案查重模块 ==========
// 基于字符 n-gram 集合交集的查重算法
// 用于在新增/编辑文案时检测与现有内容的重复度，也支持全库两两比对
(function () {
    'use strict';

    // 默认配置（可被 window.DEDUP_CONFIG 覆盖）
    const DEFAULTS = {
        enabled: true,          // 是否在保存时启用查重
        ngramSize: 6,           // n-gram 长度：6 字符（适合中文短语）
        threshold: 15,          // 触发警告的最小匹配 n-gram 数（≈ 20 字连续重复）
        minTextLength: 12,      // 文本长度低于此值跳过查重
        snippetRadius: 30,      // 匹配片段预览的上下文半径（字符）
        maxPairs: 200,          // analyzeAllDuplicates 最多返回的重复对数量
    };

    /**
     * 读取当前生效的查重配置（合并默认值与 window.DEDUP_CONFIG）
     * @returns {object}
     */
    function getConfig() {
        const cfg = (typeof window !== 'undefined' && window.DEDUP_CONFIG && typeof window.DEDUP_CONFIG === 'object')
            ? window.DEDUP_CONFIG : {};
        return {
            enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : DEFAULTS.enabled,
            ngramSize: clampInt(cfg.ngramSize, DEFAULTS.ngramSize, 2, 16),
            threshold: clampInt(cfg.threshold, DEFAULTS.threshold, 1, 500),
            minTextLength: clampInt(cfg.minTextLength, DEFAULTS.minTextLength, 1, 200),
            snippetRadius: clampInt(cfg.snippetRadius, DEFAULTS.snippetRadius, 5, 200),
            maxPairs: clampInt(cfg.maxPairs, DEFAULTS.maxPairs, 1, 2000),
        };
    }

    function clampInt(v, def, min, max) {
        v = parseInt(v, 10);
        if (!Number.isFinite(v)) return def;
        if (v < min) return min;
        if (v > max) return max;
        return v;
    }

    /**
     * 从 HTML 内容中提取纯文本（自包含，不依赖外部 stripHtml）
     * @param {string} html
     * @returns {string}
     */
    function extractText(html) {
        if (!html) return '';
        let s = String(html);
        s = s.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '');
        s = s.replace(/<[^>]*>/g, ' ');
        s = s.replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'");
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }

    /**
     * 构建文本的字符级 n-gram 集合（先去空白，中文无需分词）
     * @param {string} text
     * @param {number} n
     * @returns {Set<string>}
     */
    function buildNgrams(text, n) {
        const set = new Set();
        if (!text || text.length < n) return set;
        const compact = text.replace(/\s+/g, '');
        for (let i = 0; i <= compact.length - n; i++) {
            set.add(compact.substring(i, i + n));
        }
        return set;
    }

    /**
     * 提取首个命中 n-gram 周围的文本片段，用于在提示中预览重复内容
     * @param {string} newText
     * @param {string} existingText
     * @param {Set<string>} newNgrams
     * @param {number} n
     * @param {number} radius
     * @returns {string}
     */
    function findSnippet(newText, existingText, newNgrams, n, radius) {
        try {
            const compactNew = newText.replace(/\s+/g, '');
            const compactOld = existingText.replace(/\s+/g, '');
            for (let i = 0; i <= compactNew.length - n; i++) {
                const gram = compactNew.substring(i, i + n);
                if (newNgrams.has(gram) && compactOld.indexOf(gram) !== -1) {
                    const start = Math.max(0, i - radius);
                    const end = Math.min(compactNew.length, i + n + radius);
                    const snip = compactNew.substring(start, end);
                    return (start > 0 ? '…' : '') + snip + (end < compactNew.length ? '…' : '');
                }
            }
        } catch (e) { /* ignore */ }
        return '';
    }

    // 缓存 extractText 结果，使用统一缓存管理器
    function cachedExtractText(html) {
        if (typeof appCache !== 'undefined' && appCache.extractText) {
            const cached = appCache.extractText.get(html);
            if (cached !== undefined) return cached;
            const result = extractText(html);
            appCache.extractText.set(html, result);
            return result;
        }
        return extractText(html);
    }

    /**
     * 查找与给定内容最重复的现有文案
     * @param {string} newContent - 新内容的 HTML
     * @param {Array} items - 现有文案列表 [{id, title, content, ...}]
     * @param {string|null} excludeId - 排除的文案 ID（编辑时传当前文案 ID，避免与自身比对）
     * @param {object} [options] - { ngramSize, threshold, minTextLength, snippetRadius }（覆盖全局配置）
     * @returns {object|null} 命中阈值时返回 { itemId, title, matchedNgrams, duplicateChars, similarity, snippet }，否则 null
     */
    function findDuplicateContent(newContent, items, excludeId, options) {
        const cfg = getConfig();
        options = options || {};
        const n = clampInt(options.ngramSize, cfg.ngramSize, 2, 16);
        const threshold = clampInt(options.threshold, cfg.threshold, 1, 500);
        const minLen = clampInt(options.minTextLength, cfg.minTextLength, 1, 200);
        const radius = clampInt(options.snippetRadius, cfg.snippetRadius, 5, 200);

        const newText = cachedExtractText(newContent);
        if (newText.length < minLen) return null;

        const newNgrams = buildNgrams(newText, n);
        if (newNgrams.size === 0) return null;

        let best = null;
        const itemsList = Array.isArray(items) ? items : [];

        for (let i = 0; i < itemsList.length; i++) {
            const it = itemsList[i];
            if (!it || (excludeId !== null && it.id === excludeId)) continue;
            const existingText = cachedExtractText(it.content);
            if (existingText.length < minLen) continue;

            const existingNgrams = buildNgrams(existingText, n);
            if (existingNgrams.size === 0) continue;

            // 计算交集：遍历较小的集合以加速
            let matched = 0;
            const [smaller, larger] = newNgrams.size <= existingNgrams.size
                ? [newNgrams, existingNgrams]
                : [existingNgrams, newNgrams];
            for (const g of smaller) {
                if (larger.has(g)) matched++;
            }

            if (matched > 0 && (!best || matched > best.matchedNgrams)) {
                // 估算重复字符数：连续匹配下为 matched + n - 1（下限估计，保守值）
                const duplicateChars = matched + n - 1;
                // 相似度：匹配 n-gram 占新文本 n-gram 总数的比例
                const similarity = newNgrams.size > 0 ? matched / newNgrams.size : 0;
                best = {
                    itemId: it.id,
                    title: it.title || '(无标题)',
                    matchedNgrams: matched,
                    duplicateChars: duplicateChars,
                    similarity: similarity,
                    snippet: findSnippet(newText, existingText, newNgrams, n, radius),
                };
            }
        }

        if (best && best.matchedNgrams >= threshold) {
            return best;
        }
        return null;
    }

    /**
     * 全库两两查重分析：返回所有达到阈值的重复对
     * @param {Array} items - 全部文案
     * @param {object} [options] - { ngramSize, threshold, minTextLength, maxPairs }
     * @param {function} [onProgress] - 可选进度回调 (done, total) => void
     * @returns {Array} 重复对数组，按相似度降序：[{ a:{id,title}, b:{id,title}, matchedNgrams, duplicateChars, similarity, snippet }]
     */
    function analyzeAllDuplicates(items, options, onProgress) {
        const cfg = getConfig();
        options = options || {};
        const n = clampInt(options.ngramSize, cfg.ngramSize, 2, 16);
        const threshold = clampInt(options.threshold, cfg.threshold, 1, 500);
        const minLen = clampInt(options.minTextLength, cfg.minTextLength, 1, 200);
        const maxPairs = clampInt(options.maxPairs, cfg.maxPairs, 1, 2000);

        const list = Array.isArray(items) ? items : [];
        const n2 = list.length;
        const pairs = [];

        // 预计算每个文案的文本和 n-gram 集合（使用缓存）
        const prepared = [];
        for (let i = 0; i < n2; i++) {
            const it = list[i];
            if (!it) continue;
            const text = cachedExtractText(it.content);
            if (text.length < minLen) continue;
            const grams = buildNgrams(text, n);
            if (grams.size === 0) continue;
            prepared.push({ idx: i, item: it, text: text, grams: grams });
        }

        const total = prepared.length;
        let done = 0;

        // 使用倒排索引优化：对每个 n-gram 记录包含它的文档
        // 只比对共享 n-gram 的文档对，大幅减少比较次数
        const gramToDocs = new Map();
        for (let i = 0; i < total; i++) {
            const grams = prepared[i].grams;
            for (const g of grams) {
                if (!gramToDocs.has(g)) gramToDocs.set(g, []);
                gramToDocs.get(g).push(i);
            }
        }

        // 统计每对文档的共同 n-gram 数量
        const pairMatches = new Map();
        for (const docList of gramToDocs.values()) {
            if (docList.length < 2) continue;
            // 只比对文档列表中的两两组合
            for (let i = 0; i < docList.length; i++) {
                for (let j = i + 1; j < docList.length; j++) {
                    const a = docList[i];
                    const b = docList[j];
                    const key = a < b ? a + '-' + b : b + '-' + a;
                    pairMatches.set(key, (pairMatches.get(key) || 0) + 1);
                }
            }
        }

        // 只处理达到阈值的文档对
        const candidatePairs = [];
        for (const [key, matched] of pairMatches.entries()) {
            if (matched >= threshold) {
                const [i, j] = key.split('-').map(Number);
                candidatePairs.push({ i, j, matched });
            }
        }

        // 按匹配数降序排序，优先处理高相似度对
        candidatePairs.sort((x, y) => y.matched - x.matched);

        // 生成结果
        for (const cp of candidatePairs) {
            const A = prepared[cp.i];
            const B = prepared[cp.j];
            const matched = cp.matched;

            // 相似度取双向上限的较小值，避免长短文本误判
            const simA = A.grams.size > 0 ? matched / A.grams.size : 0;
            const simB = B.grams.size > 0 ? matched / B.grams.size : 0;
            const similarity = Math.min(simA, simB);
            const duplicateChars = matched + n - 1;
            pairs.push({
                a: { id: A.item.id, title: A.item.title || '(无标题)' },
                b: { id: B.item.id, title: B.item.title || '(无标题)' },
                matchedNgrams: matched,
                duplicateChars: duplicateChars,
                similarity: similarity,
                snippet: findSnippet(A.text, B.text, A.grams, n, cfg.snippetRadius),
            });

            if (pairs.length >= maxPairs) break;
        }

        done = total;
        if (typeof onProgress === 'function') {
            try { onProgress(done, total); } catch (e) { /* ignore */ }
        }

        pairs.sort((x, y) => y.similarity - x.similarity || y.matchedNgrams - x.matchedNgrams);
        return pairs;
    }

    /**
     * 将重复对按连通性聚合成重复分组（两个文案只要存在重复对即归入同组）
     * @param {Array} pairs - analyzeAllDuplicates 返回值
     * @returns {Array} 分组：[{ ids:[...], pairs:[...] }]
     */
    function groupDuplicates(pairs) {
        const groups = [];
        const idToGroup = new Map();

        pairs.forEach(p => {
            const ga = idToGroup.get(p.a.id);
            const gb = idToGroup.get(p.b.id);
            if (!ga && !gb) {
                const g = { ids: new Set([p.a.id, p.b.id]), pairs: [p] };
                groups.push(g);
                idToGroup.set(p.a.id, g);
                idToGroup.set(p.b.id, g);
            } else if (ga && !gb) {
                ga.ids.add(p.b.id);
                ga.pairs.push(p);
                idToGroup.set(p.b.id, ga);
            } else if (!ga && gb) {
                gb.ids.add(p.a.id);
                gb.pairs.push(p);
                idToGroup.set(p.a.id, gb);
            } else if (ga === gb) {
                ga.pairs.push(p);
            } else {
                // 合并两个组
                const keep = ga;
                const drop = gb;
                drop.ids.forEach(id => { keep.ids.add(id); idToGroup.set(id, keep); });
                drop.pairs.forEach(pr => keep.pairs.push(pr));
                keep.pairs.push(p);
                const idx = groups.indexOf(drop);
                if (idx !== -1) groups.splice(idx, 1);
            }
        });

        return groups.map(g => ({
            ids: Array.from(g.ids),
            pairs: g.pairs.sort((x, y) => y.similarity - x.similarity),
        }));
    }

    // 暴露到全局
    window.findDuplicateContent = findDuplicateContent;
    window.analyzeAllDuplicates = analyzeAllDuplicates;
    window.groupDuplicates = groupDuplicates;
    window.getDedupConfig = getConfig;
    window.dedupExtractText = extractText;
})();
