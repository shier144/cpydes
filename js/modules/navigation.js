// 阻止浏览器自动填充（Chrome 会忽略 autocomplete="off"）
function disableAutofill() {
    const inputs = document.querySelectorAll('#qInput, #catSearchInput, #catDropdownSearchInput');
    inputs.forEach(input => {
        input.setAttribute('readonly', true);
        input.addEventListener('focus', function() {
            this.removeAttribute('readonly');
        }, { once: true });
        input.addEventListener('input', function() {
            this.dataset.userTyped = '1';
        }, { once: true });
        setTimeout(() => {
            if (input.value && input.id === 'qInput' && !input.dataset.userTyped) {
                input.value = '';
                doSearch();
            }
        }, 200);
    });
}

function doSearch() {
    renderList();
}
// 搜索防抖（150ms）—— typeof 守卫避免 utils.js 未加载时崩溃
if (typeof debounce === 'function') {
    doSearch = debounce(doSearch, 150);
}

function applyFilter(el, filter) {
    document.querySelectorAll('.filter-tag').forEach(tag => tag.classList.remove('active'));
    el.classList.add('active');
    appState.setState('ui.currentFilter', filter);
    renderList();
}

function resetFilter() {
    appState.setState('ui.currentFilter', 'all');
    const tags = document.querySelectorAll('.filter-tag');
    tags.forEach(tag => {
        tag.classList.toggle('active', tag.dataset.filter === 'all');
    });
}

function showAllItems() {
    appState.setState('ui.activeCategory', null);
    resetFilter();
    buildIndices();
    renderCategories();
    renderList();
    if (currentLayout === 'top-tabs') {
        renderTopCatTabs();
    }
    if (window.innerWidth <= 900) closeSidebar();
}

function showAllFavorites() {
    appState.setState('ui.activeCategory', null);
    appState.setState('ui.currentFilter', 'favorites');
    const tags = document.querySelectorAll('.filter-tag');
    tags.forEach(tag => {
        tag.classList.toggle('active', tag.dataset.filter === 'favorites');
    });
    buildIndices();
    renderCategories();
    renderList();
    if (currentLayout === 'top-tabs') {
        renderTopCatTabs();
    }
    if (window.innerWidth <= 900) closeSidebar();
}

function selectCatFromSidebar(catId) {
    if (catId === '__favorites__') {
        const newFilter = currentFilter === 'favorites' ? 'all' : 'favorites';
        appState.setState('ui.currentFilter', newFilter);
        const tags = document.querySelectorAll('.filter-tag');
        tags.forEach(tag => {
            tag.classList.toggle('active', tag.dataset.filter === newFilter);
        });
        renderList();
        renderCategories();
        return;
    }

    appState.setState('ui.activeCategory', activeCat === catId ? null : catId);

    if (activeCat === null) {
        resetFilter();
    }

    buildIndices();
    renderCategories();
    renderList();

    if (currentLayout === 'top-tabs') {
        renderTopCatTabs();
    }

    if (window.innerWidth <= 900) closeSidebar();
}

/** 展开/收起某个一级分类 */
function toggleNavExpand(catId) {
    const cat = findCategoryById(catId);
    if (!cat) return;
    cat._expanded = !cat._expanded;

    const container = document.getElementById('children-' + catId);
    if (container) container.classList.toggle('expanded', cat._expanded);

    const group = container?.parentElement;
    if (group) {
        const header = group.querySelector('.cat-nav-l1');
        const arrow = header?.querySelector('.nav-arrow');
        if (arrow) arrow.classList.toggle('expanded', cat._expanded);
    }
}

function searchCategories(keyword) {
    keyword = keyword.toLowerCase().trim();
    const groups = document.querySelectorAll('.cat-nav-group');
    groups.forEach(group => {
        const name = group.querySelector('.nav-name')?.textContent.toLowerCase() || '';
        const childNames = Array.from(group.querySelectorAll('.nav-name-sm')).map(el => el.textContent.toLowerCase()).join(' ');
        const match = !keyword || name.includes(keyword) || childNames.includes(keyword);
        group.style.display = match ? '' : 'none';
    });
}
// 分类搜索防抖（100ms）
if (typeof debounce === 'function' && typeof searchCategories === 'function') {
    searchCategories = debounce(searchCategories, 100);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('show', sidebar.classList.contains('open'));
        if (sidebar.classList.contains('open')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
}
