/** 打开图片墙模式 */
function openGallery() {
    const overlay = document.getElementById('galleryOverlay');
    if (!overlay) return;
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';

    // 填充分类筛选下拉
    const select = document.getElementById('galleryCatFilter');
    if (select) {
        select.innerHTML = '<option value="">全部分类</option>';
        (appData.categories || []).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            select.appendChild(opt);
            if (cat.children) {
                cat.children.forEach(child => {
                    const childOpt = document.createElement('option');
                    childOpt.value = child.id;
                    childOpt.textContent = '  └ ' + child.name;
                    select.appendChild(childOpt);
                });
            }
        });
    }

    renderGallery();
}

function closeGallery() {
    const overlay = document.getElementById('galleryOverlay');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
    // 清理滚动监听器与图片懒加载 Observer，避免内存泄漏
    const grid = document.getElementById('galleryGrid');
    if (galleryScrollListener && grid) {
        grid.removeEventListener('scroll', galleryScrollListener);
        galleryScrollListener = null;
    }
    if (_galleryLazyObserver) {
        _galleryLazyObserver.disconnect();
        _galleryLazyObserver = null;
    }
    // 清理待执行的搜索定时器，避免关闭后仍触发渲染
    if (gallerySearchTimer) {
        clearTimeout(gallerySearchTimer);
        gallerySearchTimer = null;
    }
    galleryAllImages = [];
    galleryPage = 0;
    galleryLoading = false;
}

function filterGallery() {
    renderGallery();
}

let gallerySearchTimer = null;

function searchGallery() {
    if (gallerySearchTimer) {
        clearTimeout(gallerySearchTimer);
    }
    gallerySearchTimer = setTimeout(() => {
        renderGallery();
    }, 200);
}

let galleryAllImages = [];
let galleryPage = 0;
const GALLERY_PAGE_SIZE = 20;
let galleryLoading = false;
let galleryScrollListener = null;
let _galleryLazyObserver = null;

function renderGallery() {
    const grid = document.getElementById('galleryGrid');
    const empty = document.getElementById('galleryEmpty');
    const countEl = document.getElementById('galleryCount');
    const catFilter = document.getElementById('galleryCatFilter');
    const catId = catFilter ? catFilter.value : '';
    const keyword = (document.getElementById('gallerySearch')?.value || '').trim().toLowerCase();

    if (!grid || !empty) return;

    if (galleryScrollListener && grid) {
        grid.removeEventListener('scroll', galleryScrollListener);
        galleryScrollListener = null;
    }
    if (_galleryLazyObserver) {
        _galleryLazyObserver.disconnect();
        _galleryLazyObserver = null;
    }

    let images = [];
    // 预计算分类信息，避免在循环中重复查询
    const filterCat = catId ? findCategoryById(catId) : null;
    const filterCatChildIds = filterCat && filterCat.children ? new Set(filterCat.children.map(c => c.id)) : null;

    // 预缓存分类标签，避免重复生成 HTML
    const catLabelCache = new Map();

    (appData.items || []).forEach(item => {
        if (catId) {
            if (!filterCat) return;
            if (item.categoryId !== catId) {
                if (filterCatChildIds) {
                    if (!filterCatChildIds.has(item.categoryId)) {
                        return;
                    }
                } else {
                    return;
                }
            }
        }
        if (keyword) {
            const title = (item.title || '').toLowerCase();
            let catLabel = catLabelCache.get(item.categoryId);
            if (catLabel === undefined) {
                catLabel = getCategoryLabelText(item.categoryId).toLowerCase();
                catLabelCache.set(item.categoryId, catLabel);
            }
            if (!title.includes(keyword) && !catLabel.includes(keyword)) {
                return;
            }
        }
        if (!item.content) return;
        // 使用正则表达式提取图片，避免创建临时 DOM 元素
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = imgRegex.exec(item.content)) !== null) {
            const src = match[1];
            if (src && !src.startsWith('data:') && src.startsWith('img/')) {
                images.push({
                    src: src,
                    title: item.title,
                    catId: item.categoryId,
                    itemId: item.id
                });
            }
        }
    });

    galleryAllImages = images;
    galleryPage = 0;
    galleryLoading = false;
    if (countEl) countEl.textContent = `共 ${images.length} 张`;

    if (images.length === 0) {
        grid.style.display = 'none';
        empty.style.display = 'flex';
        return;
    }

    grid.style.display = 'grid';
    empty.style.display = 'none';
    grid.innerHTML = '';

    appendGalleryPage();

    let _galleryScrollTicking = false;
    galleryScrollListener = function() {
        if (_galleryScrollTicking) return;
        _galleryScrollTicking = true;
        requestAnimationFrame(() => {
            _galleryScrollTicking = false;
            if (galleryLoading) return;
            if (galleryPage * GALLERY_PAGE_SIZE >= galleryAllImages.length) return;
            if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200) {
                appendGalleryPage();
            }
        });
    };
    grid.addEventListener('scroll', galleryScrollListener, { passive: true });
}

function appendGalleryPage() {
    if (galleryLoading) return;
    if (galleryPage * GALLERY_PAGE_SIZE >= galleryAllImages.length) return;

    galleryLoading = true;
    const grid = document.getElementById('galleryGrid');
    const start = galleryPage * GALLERY_PAGE_SIZE;
    const end = Math.min(start + GALLERY_PAGE_SIZE, galleryAllImages.length);
    const pageImages = galleryAllImages.slice(start, end);

    const frag = document.createDocumentFragment();
    pageImages.forEach(img => {
        const card = document.createElement('div');
        card.className = 'gallery-card';
        card.onclick = () => showPreview(img.itemId);
        const safeTitle = img.title || '';
        card.innerHTML = `
            <div class="gallery-card-img-wrap">
                <img data-src="${escapeAttr(img.src)}" alt="${escapeAttr(safeTitle)}">
            </div>
            <div class="gallery-card-info">
                <div class="gallery-card-title">${escapeHtml(safeTitle.substring(0, 26))}</div>
                <div class="gallery-card-cat">${escapeHtml(getCategoryLabelText(img.catId))}</div>
            </div>
        `;
        frag.appendChild(card);
    });

    if (galleryPage === 0) {
        grid.innerHTML = '';
    }
    grid.appendChild(frag);

    setupGalleryLazyImages();

    galleryPage++;
    galleryLoading = false;

    checkAndLoadMoreGallery();
}

function checkAndLoadMoreGallery() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    if (galleryLoading) return;
    if (galleryPage * GALLERY_PAGE_SIZE >= galleryAllImages.length) return;
    if (grid.scrollHeight <= grid.clientHeight + 50) {
        appendGalleryPage();
    }
}

function setupGalleryLazyImages() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    const imgs = grid.querySelectorAll('img[data-src]:not([data-loaded])');
    if (!imgs.length) return;

    if (!_galleryLazyObserver) {
        _galleryLazyObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.dataset.src;
                    if (src) {
                        img.onload = function() {
                            img.onload = null;
                            checkAndLoadMoreGallery();
                        };
                        img.src = src;
                        img.dataset.loaded = 'true';
                        img.removeAttribute('data-src');
                    }
                    _galleryLazyObserver.unobserve(img);
                }
            });
        }, { root: grid, rootMargin: '100px' });
    }

    imgs.forEach(img => _galleryLazyObserver.observe(img));
}
