/* Home page: category sections, dropdown jump menu, live search */
(async function () {
  'use strict';
  const { $, $$, esc, loadSiteData, tileHTML, recipeUrl, LEAF_SVG } = window.RB;

  const data = await loadSiteData();

  // Header
  $('#siteTitle').innerHTML = LEAF_SVG + esc(data.siteTitle);
  $('#siteTagline').textContent = data.tagline;
  $('#siteTagline').hidden = !data.tagline;
  document.title = data.siteTitle;

  // Group recipes by category (unknown categories go to "Other")
  const known = new Set(data.categories.map(c => c.id));
  const cats = data.categories.slice();
  if (data.recipes.some(r => !known.has(r.category))) cats.push({ id: '__other', name: 'Other' });
  const byCat = {};
  cats.forEach(c => { byCat[c.id] = []; });
  data.recipes.forEach(r => byCat[known.has(r.category) ? r.category : '__other'].push(r));
  Object.values(byCat).forEach(list => list.sort((a, b) => a.title.localeCompare(b.title)));

  const sectionId = c => 'cat-' + c.id;

  // Sections
  $('#sections').innerHTML = cats.map(c => {
    const list = byCat[c.id];
    return '<section class="category" id="' + esc(sectionId(c)) + '" data-cat="' + esc(c.id) + '">' +
      '<h2 class="category-title">' + esc(c.name) + '<span class="count">' + list.length + ' recipe' + (list.length === 1 ? '' : 's') + '</span></h2>' +
      (list.length
        ? '<div class="grid">' + list.map(r => tileHTML(r)).join('') + '</div>'
        : '<p class="empty">No recipes here yet.</p>') +
      '</section>';
  }).join('') || '<p class="result-note">No recipes yet. Add some from the editor!</p>';

  // Attach search text to each tile
  const searchIndex = new Map();
  data.recipes.forEach(r => {
    searchIndex.set(recipeUrl(r), [
      r.title, r.description, (r.tags || []).join(' '), (r.ingredients || []).join(' ')
    ].join(' ').toLowerCase());
  });

  // Dropdown menu
  const menu = $('#catMenu'), btn = $('#catButton'), dd = $('#catDropdown');
  menu.innerHTML = '<li><a href="#top">All recipes</a></li>' + cats.map(c =>
    '<li><a href="#' + esc(sectionId(c)) + '">' + esc(c.name) + '<span class="count">' + byCat[c.id].length + '</span></a></li>'
  ).join('');
  function setMenu(open) {
    menu.hidden = !open;
    dd.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  }
  btn.addEventListener('click', e => { e.stopPropagation(); setMenu(menu.hidden); if (!menu.hidden) menu.querySelector('a').focus(); });
  menu.addEventListener('click', e => {
    if (e.target.closest('a')) {
      setMenu(false);
      if (searchBox.value) { searchBox.value = ''; runSearch(); }
    }
  });
  document.addEventListener('click', e => { if (!dd.contains(e.target)) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); btn.focus(); } });

  // Search
  const searchBox = $('#search'), clearBtn = $('#clearSearch'), note = $('#resultNote');
  function runSearch() {
    const q = searchBox.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    $$('.category').forEach(sec => {
      let secShown = 0;
      $$('.tile', sec).forEach(tile => {
        const text = searchIndex.get(tile.getAttribute('href')) || '';
        const match = terms.every(t => text.includes(t));
        tile.hidden = !match;
        if (match) secShown++;
      });
      const emptyMsg = $('.empty', sec);
      sec.hidden = terms.length > 0 && secShown === 0;
      if (emptyMsg) emptyMsg.hidden = terms.length > 0;
      shown += secShown;
    });
    clearBtn.hidden = !q;
    note.hidden = !q;
    if (q) note.innerHTML = shown
      ? shown + ' recipe' + (shown === 1 ? '' : 's') + ' matching “' + esc(searchBox.value.trim()) + '”'
      : 'No recipes match “' + esc(searchBox.value.trim()) + '”. Try a different word or ingredient.';
    const url = new URL(location.href);
    if (q) url.searchParams.set('q', searchBox.value.trim()); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
  }
  searchBox.addEventListener('input', runSearch);
  clearBtn.addEventListener('click', () => { searchBox.value = ''; runSearch(); searchBox.focus(); });
  const initialQ = new URLSearchParams(location.search).get('q');
  if (initialQ) { searchBox.value = initialQ; runSearch(); }

  // Back to top
  const toTop = $('#toTop');
  window.addEventListener('scroll', () => { toTop.hidden = window.scrollY < 600; }, { passive: true });
  toTop.addEventListener('click', () => window.scrollTo({ top: 0 }));

  // Jump to a section if the page was opened with #cat-... in the URL
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
  }
})();
