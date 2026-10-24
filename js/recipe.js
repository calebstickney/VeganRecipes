/* Single recipe page: recipe.html?id=... */
(async function () {
  'use strict';
  const { $, $$, esc, loadSiteData, imgSrc, isSubhead, paragraphs, categoryName, tileHTML, LEAF_SVG } = window.RB;

  const data = await loadSiteData();
  $('#siteTitle').innerHTML = LEAF_SVG + esc(data.siteTitle);

  const id = new URLSearchParams(location.search).get('id');
  const r = data.recipes.find(x => x.id === id);
  const main = $('#recipe');

  if (!r) {
    document.title = 'Recipe not found · ' + data.siteTitle;
    main.innerHTML = '<div class="recipe-top"><h1 class="recipe-title">Recipe not found</h1>' +
      '<p>We couldn’t find that recipe. It may have been renamed or removed.</p>' +
      '<p><a class="btn primary" href="index.html">See all recipes</a></p></div>';
    return;
  }

  document.title = r.title + ' · ' + data.siteTitle;
  const catName = categoryName(data, r.category);

  const meta = [
    ['Prep', r.prepTime], ['Cook', r.cookTime], ['Serves', r.servings]
  ].filter(m => m[1]).map(m => '<span>' + m[0] + ': <strong>' + esc(m[1]) + '</strong></span>').join('');

  const tags = (r.tags || []).filter(Boolean).map(t =>
    '<li><a href="index.html?q=' + encodeURIComponent(t) + '">' + esc(t) + '</a></li>').join('');

  const ingredients = (r.ingredients || []).filter(s => s.trim()).map((line, i) =>
    isSubhead(line)
      ? '<li class="subhead">' + esc(line.replace(/:\s*$/, '')) + '</li>'
      : '<li><label><input type="checkbox" data-i="' + i + '"><span>' + esc(line) + '</span></label></li>'
  ).join('');

  const steps = (r.steps || []).filter(s => s.trim()).map(line =>
    isSubhead(line)
      ? '<li class="subhead">' + esc(line.replace(/:\s*$/, '')) + '</li>'
      : '<li>' + esc(line) + '</li>'
  ).join('');

  const photos = (r.photos || []).filter(p => p && p.src);
  const gallery = photos.map((p, i) =>
    '<figure><button type="button" data-photo="' + i + '" aria-label="Open photo ' + (i + 1) + '">' +
    '<img src="' + esc(imgSrc(p.src)) + '" alt="' + esc(p.caption || r.title) + '" loading="lazy"></button>' +
    (p.caption ? '<figcaption>' + esc(p.caption) + '</figcaption>' : '') + '</figure>'
  ).join('');

  const more = data.recipes.filter(x => x.category === r.category && x.id !== r.id)
    .sort(() => Math.random() - .5).slice(0, 4);

  main.innerHTML =
    '<div class="recipe-top">' +
      '<nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">All recipes</a><span>›</span>' +
      '<a href="index.html#cat-' + esc(r.category) + '">' + esc(catName) + '</a></nav>' +
      '<h1 class="recipe-title">' + esc(r.title) + '</h1>' +
      (meta ? '<div class="meta">' + meta + '</div>' : '') +
      (tags ? '<ul class="tags">' + tags + '</ul>' : '') +
    '</div>' +
    (r.image ? '<div class="hero"><img src="' + esc(imgSrc(r.image)) + '" alt="' + esc(r.title) + '"></div>' : '') +
    (r.description ? '<div class="lead">' + paragraphs(r.description) + '</div>' : '') +
    '<div class="recipe-actions">' +
      '<button class="btn" type="button" id="printBtn">🖨️ Print</button>' +
      (navigator.share ? '<button class="btn" type="button" id="shareBtn">↗ Share</button>' : '') +
      (ingredients ? '<button class="btn" type="button" id="resetChecks">Clear ticks</button>' : '') +
      '<a class="btn" href="admin.html#edit=' + encodeURIComponent(r.id) + '">✏️ Edit</a>' +
    '</div>' +
    '<div class="recipe-body">' +
      '<section class="panel"><h2>Ingredients</h2>' +
        (ingredients ? '<ul class="ingredients">' + ingredients + '</ul>' : '<p class="empty">No ingredients listed yet.</p>') +
      '</section>' +
      '<section class="panel"><h2>Directions</h2>' +
        (steps ? '<ol class="steps">' + steps + '</ol>' : '<p class="empty">No directions listed yet.</p>') +
      '</section>' +
    '</div>' +
    (r.notes ? '<section class="panel notes"><h2>Notes</h2>' + paragraphs(r.notes) + '</section>' : '') +
    (gallery ? '<section class="section-gap gallery-wrap"><h2>Photos</h2><div class="gallery">' + gallery + '</div></section>' : '') +
    (more.length ? '<section class="section-gap more-like"><h2>More ' + esc(catName) + '</h2><div class="grid">' + more.map(tileHTML).join('') + '</div></section>' : '');

  // Print / share
  $('#printBtn').addEventListener('click', () => window.print());
  const shareBtn = $('#shareBtn');
  if (shareBtn) shareBtn.addEventListener('click', () => navigator.share({ title: r.title, url: location.href }).catch(() => {}));

  // Remember ticked ingredients while cooking (this browser only)
  const key = 'ticks:' + r.id;
  let ticks = {};
  try { ticks = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { ticks = {}; }
  $$('.ingredients input').forEach(cb => {
    cb.checked = !!ticks[cb.dataset.i];
    cb.addEventListener('change', () => {
      ticks[cb.dataset.i] = cb.checked;
      try { localStorage.setItem(key, JSON.stringify(ticks)); } catch (e) { /* ignore */ }
    });
  });
  const reset = $('#resetChecks');
  if (reset) reset.addEventListener('click', () => {
    ticks = {};
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    $$('.ingredients input').forEach(cb => { cb.checked = false; });
  });

  // Simple lightbox for extra photos
  main.addEventListener('click', e => {
    const b = e.target.closest('[data-photo]');
    if (!b) return;
    const p = photos[+b.dataset.photo];
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.innerHTML = '<div><img src="' + esc(imgSrc(p.src)) + '" alt="' + esc(p.caption || r.title) + '">' +
      (p.caption ? '<p>' + esc(p.caption) + '</p>' : '') + '</div>';
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = ev => { if (ev.key === 'Escape') close(); };
    box.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
  });
})();
