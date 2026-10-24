/* Online recipe editor.
 *
 * How it works: the site is plain files on GitHub Pages. The editor saves
 * changes by committing files to the GitHub repository through the GitHub API.
 * The GitHub access token is stored in data/config.js, encrypted with the
 * editor password (PBKDF2 + AES-GCM), so only someone who knows the password
 * can use it.
 */
(function () {
  'use strict';
  const { $, $$, esc, loadScript, normalizeData, slugify, cssUrl, imgSrc } = window.RB;

  const API = 'https://api.github.com';
  const ITERATIONS = 600000;
  const DATA_PATH = 'data/data.js';
  const CONFIG_PATH = 'data/config.js';
  const SESSION_KEY = 'recipeEditorSession';
  const MAX_IMAGE = 1600; // px, longest side

  let cfg = null;    // { owner, repo, branch, token: {salt, iv, data, iterations} }
  let token = null;  // decrypted GitHub token (memory + this tab's session only)
  let data = null;   // latest site data from GitHub
  let ed = null;     // recipe editor state
  let dirty = false;

  /* ---------------- UI helpers ---------------- */
  const VIEWS = ['loading', 'login', 'setup', 'dash', 'editor'];
  function show(view) {
    VIEWS.forEach(v => { $('#view-' + v).hidden = v !== view; });
    $('#logoutBtn').hidden = !token;
    window.scrollTo(0, 0);
  }
  let statusTimer;
  function status(msg, kind, sticky) {
    const el = $('#status');
    clearTimeout(statusTimer);
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.className = 'status ' + (kind || 'info');
    el.hidden = false;
    if (!sticky && kind !== 'error') statusTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }
  function friendly(err) {
    if (!err) return 'Something went wrong.';
    if (err.status === 401) return 'GitHub did not accept the access token. It may be mistyped or expired.';
    if (err.status === 403) return 'The access token is not allowed to change this repository. Check it has "Contents: Read and write".';
    if (err.status === 404) return 'Repository or branch not found. Check the username, repository name, and that the token can access it.';
    if (err.status === 422) return 'GitHub rejected the change (' + err.message + ').';
    if (err instanceof TypeError) return 'Could not reach GitHub. Check your internet connection.';
    return err.message || String(err);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------------- base64 / crypto ---------------- */
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(String(b64).replace(/\s/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const utf8ToB64 = str => bytesToB64(new TextEncoder().encode(str));
  const b64ToUtf8 = b64 => new TextDecoder().decode(b64ToBytes(b64));

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptToken(tok, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITERATIONS);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(tok)));
    return { salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(ct), iterations: ITERATIONS };
  }
  async function decryptToken(enc, password) {
    const key = await deriveKey(password, b64ToBytes(enc.salt), enc.iterations || ITERATIONS);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.data));
    return new TextDecoder().decode(pt);
  }

  /* ---------------- GitHub API ---------------- */
  async function gh(path, opts) {
    opts = opts || {};
    const headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body, cache: 'no-store' });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch (e) { /* ignore */ }
      const err = new Error(msg || ('GitHub error ' + res.status));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const repoBase = () => '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo);
  const contentsPath = p => repoBase() + '/contents/' + p.split('/').map(encodeURIComponent).join('/');

  async function getFile(path) {
    try {
      const j = await gh(contentsPath(path) + '?ref=' + encodeURIComponent(cfg.branch) + '&t=' + Date.now());
      return { sha: j.sha, text: j.content ? b64ToUtf8(j.content) : '' };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }
  async function putFile(path, base64, message, sha) {
    const body = { message, content: base64, branch: cfg.branch };
    if (sha) body.sha = sha;
    return gh(contentsPath(path), { method: 'PUT', body: JSON.stringify(body) });
  }
  async function deleteFile(path, message) {
    const meta = await gh(contentsPath(path) + '?ref=' + encodeURIComponent(cfg.branch));
    return gh(contentsPath(path), { method: 'DELETE', body: JSON.stringify({ message, sha: meta.sha, branch: cfg.branch }) });
  }

  /* ---------------- site data ---------------- */
  function parseData(text) {
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end < 0) return normalizeData(null);
    return normalizeData(JSON.parse(text.slice(start, end + 1)));
  }
  function serializeData(d) {
    return '/* Recipe data. Edit with admin.html, or carefully by hand (this is JSON). */\n' +
      'window.SITE_DATA = ' + JSON.stringify(d, null, 2) + ';\n';
  }
  async function refreshData() {
    const f = await getFile(DATA_PATH);
    data = f ? parseData(f.text) : normalizeData(null);
    return data;
  }
  // Always applies the change to the newest copy on GitHub, so two people editing don't overwrite each other.
  async function commitData(message, mutate) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const f = await getFile(DATA_PATH);
      const latest = f ? parseData(f.text) : normalizeData(null);
      mutate(latest);
      try {
        await putFile(DATA_PATH, utf8ToB64(serializeData(latest)), message, f && f.sha);
        data = latest;
        return;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 2) continue;
        throw e;
      }
    }
  }

  /* ---------------- images ---------------- */
  function processImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => {
          if (!blob) return reject(new Error('Could not process that image.'));
          const reader = new FileReader();
          reader.onload = () => resolve({
            b64: String(reader.result).split(',')[1],
            preview: URL.createObjectURL(blob)
          });
          reader.onerror = () => reject(new Error('Could not read that image.'));
          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as an image. Try a JPG or PNG.')); };
      img.src = url;
    });
  }
  const newImagePath = id => 'images/' + id + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.jpg';
  const previewOf = p => p.preview || imgSrc(p.src);

  /* ---------------- session ---------------- */
  function saveSession() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, cfg })); } catch (e) { /* ignore */ }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  /* ---------------- startup ---------------- */
  async function init() {
    if (!window.crypto || !crypto.subtle) {
      show('login');
      status('This browser can’t run the editor from here. Open admin.html from your live GitHub Pages site (https).', 'error');
      return;
    }
    try { await loadScript(CONFIG_PATH + '?v=' + Date.now()); } catch (e) { /* no config yet */ }
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { saved = null; }
    cfg = (window.SITE_CONFIG && window.SITE_CONFIG.token) ? window.SITE_CONFIG : (saved && saved.cfg) || null;

    if (saved && saved.token && cfg) {
      token = saved.token;
      try { await enterDashboard(); return; } catch (e) { token = null; clearSession(); }
    }
    if (!cfg) openSetup(false);
    else { show('login'); $('#pw').focus(); }
  }

  async function enterDashboard() {
    status('Loading recipes from GitHub…', 'info', true);
    await refreshData();
    status('');
    route();
  }

  function route() {
    if (!token) return;
    const h = decodeURIComponent(location.hash.slice(1));
    if (h === 'new') openEditor(null);
    else if (h.startsWith('edit=')) openEditor(h.slice(5));
    else renderDash();
  }
  window.addEventListener('hashchange', () => {
    if (!token) return;
    if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    dirty = false;
    route();
  });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- login ---------------- */
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    status('Unlocking…', 'info', true);
    try {
      token = await decryptToken(cfg.token, $('#pw').value);
    } catch (err) {
      token = null;
      status('Wrong password.', 'error');
      $('#pw').select();
      return;
    }
    $('#pw').value = '';
    try {
      await enterDashboard();
      saveSession();
    } catch (err) {
      token = null;
      status(friendly(err) + ' If the token expired, use “Connect to GitHub again”.', 'error');
      show('login');
    }
  });
  $('#toSetup').addEventListener('click', e => { e.preventDefault(); openSetup(true); });
  $('#logoutBtn').addEventListener('click', () => {
    if (dirty && !confirm('You have unsaved changes. Log out anyway?')) return;
    dirty = false; token = null; data = null; clearSession();
    history.replaceState(null, '', location.pathname);
    status('Logged out.', 'ok');
    if (cfg) show('login'); else openSetup(false);
  });

  /* ---------------- setup ---------------- */
  function openSetup(cancellable) {
    const f = $('#setupForm');
    // Guess the repo from a github.io address
    let owner = cfg && cfg.owner, repo = cfg && cfg.repo;
    if (!owner && /\.github\.io$/i.test(location.hostname)) {
      owner = location.hostname.split('.')[0];
      const first = location.pathname.split('/').filter(Boolean)[0];
      repo = first && !/\.html$/.test(first) ? first : owner + '.github.io';
    }
    f.ghOwner.value = owner || '';
    f.ghRepo.value = repo || '';
    f.ghBranch.value = (cfg && cfg.branch) || 'main';
    $('#setupCancel').hidden = !cancellable;
    show('setup');
  }
  $('#setupCancel').addEventListener('click', e => {
    e.preventDefault();
    if (token) route(); else show('login');
  });
  $('#setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const owner = f.ghOwner.value.trim(), repo = f.ghRepo.value.trim(), branch = f.ghBranch.value.trim() || 'main';
    const tok = f.ghToken.value.trim(), pw = f.setPw.value;
    if (pw !== f.setPw2.value) { status('The two passwords don’t match.', 'error'); return; }
    const btn = $('#setupBtn');
    btn.disabled = true;
    const prevCfg = cfg, prevToken = token;
    try {
      cfg = { owner, repo, branch };
      token = tok;
      status('Checking the token with GitHub…', 'info', true);
      const info = await gh(repoBase());
      if (info.permissions && info.permissions.push === false) {
        const err = new Error('This token can read the repository but can’t save to it. Give it "Contents: Read and write".');
        throw err;
      }
      await gh(repoBase() + '/branches/' + encodeURIComponent(branch));
      status('Encrypting and saving the connection…', 'info', true);
      const enc = await encryptToken(tok, pw);
      const newCfg = { owner, repo, branch, token: enc };
      const existing = await getFile(CONFIG_PATH);
      await putFile(CONFIG_PATH,
        utf8ToB64('/* Editor connection. The GitHub token is encrypted with the editor password. */\nwindow.SITE_CONFIG = ' + JSON.stringify(newCfg, null, 2) + ';\n'),
        'Connect online recipe editor', existing && existing.sha);
      cfg = newCfg;
      f.reset();
      saveSession();
      await enterDashboard();
      status('Connected! You can now edit from any browser with the password.', 'ok');
    } catch (err) {
      cfg = prevCfg; token = prevToken;
      status(friendly(err), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------- dashboard ---------------- */
  function renderDash() {
    show('dash');
    const q = $('#dashSearch').value.trim().toLowerCase();
    const known = new Set(data.categories.map(c => c.id));
    const groups = data.categories.map(c => ({ c, list: data.recipes.filter(r => r.category === c.id) }));
    const orphans = data.recipes.filter(r => !known.has(r.category));
    if (orphans.length) groups.push({ c: { id: '', name: 'Other (no category)' }, list: orphans });

    const html = groups.map(({ c, list }) => {
      const rows = list.filter(r => !q || r.title.toLowerCase().includes(q))
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(r => '<a class="dash-row" href="#edit=' + encodeURIComponent(r.id) + '">' +
          '<span class="thumb"' + (r.image ? ' style="background-image:' + esc(cssUrl(r.image)) + '"' : '') + '></span>' +
          '<span class="name">' + esc(r.title) + '</span><span class="edit">Edit ›</span></a>').join('');
      if (q && !rows) return '';
      return '<h2 class="dash-cat">' + esc(c.name) + '</h2>' + (rows || '<p class="muted small">No recipes yet.</p>');
    }).join('');
    $('#dashList').innerHTML = html || '<p class="muted">No recipes match.</p>';
    renderSettings();
  }
  $('#dashSearch').addEventListener('input', () => renderDash());

  /* ---------------- categories & settings ---------------- */
  let catDraft = null;
  function renderSettings() {
    if (!catDraft) catDraft = data.categories.map(c => ({ ...c }));
    const counts = {};
    data.recipes.forEach(r => { counts[r.category] = (counts[r.category] || 0) + 1; });
    $('#settings').innerHTML =
      '<div class="field"><label for="sTitle">Site name</label><input id="sTitle" value="' + esc(data.siteTitle) + '"></div>' +
      '<div class="field"><label for="sTag">Tagline</label><input id="sTag" value="' + esc(data.tagline) + '"></div>' +
      '<h2>Categories</h2><p class="muted small">Rename, reorder, add or remove categories. A category must be empty before it can be removed.</p>' +
      catDraft.map((c, i) =>
        '<div class="cat-row" data-i="' + i + '">' +
        '<input value="' + esc(c.name) + '" data-act="name" aria-label="Category name">' +
        '<span class="n" title="Recipes">' + (counts[c.id] || 0) + '</span>' +
        '<button class="btn" type="button" data-act="up" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn" type="button" data-act="down" aria-label="Move down"' + (i === catDraft.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="btn danger" type="button" data-act="del" aria-label="Remove">✕</button></div>'
      ).join('') +
      '<div class="cat-row"><input id="newCat" placeholder="New category name"><button class="btn" type="button" id="addCat">Add</button></div>' +
      '<div class="photo-actions" style="margin-top:16px"><button class="btn primary" type="button" id="saveSettings">Save categories &amp; settings</button>' +
      '<button class="btn" type="button" id="reconnect">Change password / token</button></div>';
  }
  $('#settings').addEventListener('input', e => {
    if (e.target.dataset.act === 'name') catDraft[+e.target.closest('.cat-row').dataset.i].name = e.target.value;
  });
  $('#settings').addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    const row = t.closest('.cat-row[data-i]');
    const i = row ? +row.dataset.i : -1;
    const keep = () => { const st = $('#sTitle').value, tg = $('#sTag').value; renderSettings(); $('#sTitle').value = st; $('#sTag').value = tg; };
    if (t.dataset.act === 'up' && i > 0) { [catDraft[i - 1], catDraft[i]] = [catDraft[i], catDraft[i - 1]]; keep(); }
    else if (t.dataset.act === 'down' && i < catDraft.length - 1) { [catDraft[i + 1], catDraft[i]] = [catDraft[i], catDraft[i + 1]]; keep(); }
    else if (t.dataset.act === 'del') {
      const n = data.recipes.filter(r => r.category === catDraft[i].id).length;
      if (n) { status('Move or delete the ' + n + ' recipe' + (n > 1 ? 's' : '') + ' in “' + catDraft[i].name + '” first.', 'error'); return; }
      catDraft.splice(i, 1); keep();
    }
    else if (t.id === 'addCat') {
      const name = $('#newCat').value.trim();
      if (!name) return;
      let id = slugify(name), n = 2;
      while (catDraft.some(c => c.id === id)) id = slugify(name) + '-' + n++;
      catDraft.push({ id, name }); keep();
    }
    else if (t.id === 'reconnect') openSetup(true);
    else if (t.id === 'saveSettings') {
      if (catDraft.some(c => !c.name.trim())) { status('Every category needs a name.', 'error'); return; }
      const siteTitle = $('#sTitle').value.trim() || data.siteTitle, tagline = $('#sTag').value.trim();
      t.disabled = true;
      status('Saving…', 'info', true);
      try {
        const cats = catDraft.map(c => ({ id: c.id, name: c.name.trim() }));
        await commitData('Update categories and site settings', d => { d.siteTitle = siteTitle; d.tagline = tagline; d.categories = cats; });
        catDraft = null;
        renderDash();
        $('#settingsPanel').open = true;
        status('Saved! The live site updates in about a minute.', 'ok');
      } catch (err) { status(friendly(err), 'error'); t.disabled = false; }
    }
  });

  /* ---------------- recipe editor ---------------- */
  function blankRecipe() {
    return { id: '', title: '', category: (data.categories[0] || {}).id || '', description: '', image: '',
      prepTime: '', cookTime: '', servings: '', tags: [], ingredients: [], steps: [], notes: '', photos: [] };
  }

  function openEditor(id) {
    const existing = id ? data.recipes.find(r => r.id === id) : null;
    if (id && !existing) { status('That recipe wasn’t found.', 'error'); history.replaceState(null, '', location.pathname); renderDash(); return; }
    const r = existing ? JSON.parse(JSON.stringify(existing)) : blankRecipe();
    ed = {
      isNew: !existing,
      r,
      cover: r.image ? { src: r.image } : null,
      photos: (r.photos || []).map(p => ({ src: p.src, caption: p.caption || '' })),
      removed: []
    };
    dirty = false;
    const catOptions = data.categories.map(c =>
      '<option value="' + esc(c.id) + '"' + (c.id === r.category ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') +
      (r.category && !data.categories.some(c => c.id === r.category) ? '<option value="' + esc(r.category) + '" selected>Other</option>' : '');

    $('#view-editor').innerHTML =
      '<form id="recipeForm" novalidate>' +
      '<div class="editor-head"><h1>' + (ed.isNew ? 'New recipe' : 'Edit recipe') + '</h1>' +
        (ed.isNew ? '' : '<a class="btn small" href="recipe.html?id=' + encodeURIComponent(r.id) + '" target="_blank" rel="noopener">View page ↗</a>') + '</div>' +
      '<div class="card">' +
        '<div class="field"><label for="fTitle">Recipe name *</label><input id="fTitle" name="title" required value="' + esc(r.title) + '"></div>' +
        '<div class="field"><label for="fCat">Category</label><select id="fCat" name="category">' + catOptions + '</select></div>' +
        '<div class="row">' +
          '<div class="field"><label for="fPrep">Prep time</label><input id="fPrep" name="prepTime" placeholder="15 min" value="' + esc(r.prepTime) + '"></div>' +
          '<div class="field"><label for="fCook">Cook time</label><input id="fCook" name="cookTime" placeholder="30 min" value="' + esc(r.cookTime) + '"></div>' +
          '<div class="field"><label for="fServ">Servings</label><input id="fServ" name="servings" placeholder="4" value="' + esc(r.servings) + '"></div>' +
        '</div>' +
        '<div class="field"><label for="fDesc">Short description</label><textarea id="fDesc" name="description" placeholder="A sentence or two about this dish">' + esc(r.description) + '</textarea></div>' +
        '<div class="field"><label for="fTags">Tags</label><input id="fTags" name="tags" placeholder="quick, gluten-free, high-protein" value="' + esc((r.tags || []).join(', ')) + '"><small class="muted">Separate with commas. Tags are searchable.</small></div>' +
      '</div>' +

      '<div class="card ed-section" style="margin-top:16px"><h2>Main photo</h2>' +
        '<div class="cover-box" id="coverBox"></div>' +
        '<div class="photo-actions">' +
          '<label class="btn file-btn">📷 Choose photo<input type="file" accept="image/*" id="coverInput"></label>' +
          '<button class="btn danger" type="button" id="coverRemove">Remove</button>' +
        '</div><p class="hint">Shown behind the name on the home page and at the top of the recipe. No photo = grey box.</p>' +
      '</div>' +

      '<div class="card ed-section">' +
        '<div class="field"><label for="fIng">Ingredients</label><textarea id="fIng" name="ingredients" class="tall" placeholder="1 cup rolled oats&#10;2 tbsp maple syrup&#10;For the topping:&#10;1 banana">' + esc((r.ingredients || []).join('\n')) + '</textarea>' +
          '<small class="muted">One per line. A line ending with “:” becomes a little heading.</small></div>' +
        '<div class="field"><label for="fSteps">Directions</label><textarea id="fSteps" name="steps" class="tall" placeholder="Preheat the oven to 400°F.&#10;Chop the vegetables.">' + esc((r.steps || []).join('\n')) + '</textarea>' +
          '<small class="muted">One step per line. They’re numbered for you.</small></div>' +
        '<div class="field"><label for="fNotes">Notes, story &amp; tips</label><textarea id="fNotes" name="notes" placeholder="Where this recipe came from, swaps, storage tips…">' + esc(r.notes) + '</textarea>' +
          '<small class="muted">Leave a blank line between paragraphs.</small></div>' +
      '</div>' +

      '<div class="card ed-section"><h2>More photos</h2>' +
        '<label class="btn file-btn">➕ Add photos<input type="file" accept="image/*" multiple id="photoInput"></label>' +
        '<div class="photo-list" id="photoList"></div>' +
      '</div>' +

      '<div class="save-bar">' +
        (ed.isNew ? '' : '<button class="btn danger" type="button" id="deleteBtn">Delete</button>') +
        '<span class="spacer"></span>' +
        '<a class="btn" href="#">Cancel</a>' +
        '<button class="btn primary" type="submit" id="saveBtn">Save recipe</button>' +
      '</div></form>';

    renderCover();
    renderPhotos();
    show('editor');
    if (ed.isNew) $('#fTitle').focus();

    const form = $('#recipeForm');
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('submit', onSave);
    $('#coverInput').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      status('Preparing photo…', 'info', true);
      try {
        const img = await processImage(file);
        if (ed.cover && ed.cover.src) ed.removed.push(ed.cover.src);
        ed.cover = img;
        dirty = true;
        renderCover();
        status('');
      } catch (err) { status(friendly(err), 'error'); }
    });
    $('#coverRemove').addEventListener('click', () => {
      if (ed.cover && ed.cover.src) ed.removed.push(ed.cover.src);
      ed.cover = null; dirty = true; renderCover();
    });
    $('#photoInput').addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      for (let i = 0; i < files.length; i++) {
        status('Preparing photo ' + (i + 1) + ' of ' + files.length + '…', 'info', true);
        try { const img = await processImage(files[i]); img.caption = ''; ed.photos.push(img); }
        catch (err) { status(friendly(err), 'error'); }
      }
      if (files.length) { dirty = true; renderPhotos(); status(''); }
    });
    $('#photoList').addEventListener('input', e => {
      if (e.target.dataset.cap != null) ed.photos[+e.target.dataset.cap].caption = e.target.value;
    });
    $('#photoList').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const i = +b.dataset.i;
      if (b.dataset.act === 'remove') {
        const [p] = ed.photos.splice(i, 1);
        if (p.src) ed.removed.push(p.src);
      } else if (b.dataset.act === 'left' && i > 0) {
        [ed.photos[i - 1], ed.photos[i]] = [ed.photos[i], ed.photos[i - 1]];
      } else if (b.dataset.act === 'right' && i < ed.photos.length - 1) {
        [ed.photos[i + 1], ed.photos[i]] = [ed.photos[i], ed.photos[i + 1]];
      } else if (b.dataset.act === 'cover') {
        const [p] = ed.photos.splice(i, 1);
        if (ed.cover) ed.photos.unshift({ ...ed.cover, caption: '' });
        ed.cover = p;
        renderCover();
      }
      dirty = true;
      renderPhotos();
    });
    const del = $('#deleteBtn');
    if (del) del.addEventListener('click', onDelete);
  }

  function renderCover() {
    const box = $('#coverBox');
    box.style.backgroundImage = ed.cover ? cssUrl(previewOf(ed.cover)) : '';
    box.innerHTML = ed.cover ? '' : '<span class="ph">No photo yet</span>';
    $('#coverRemove').hidden = !ed.cover;
  }
  function renderPhotos() {
    $('#photoList').innerHTML = ed.photos.map((p, i) =>
      '<div class="photo-item"><div class="pimg" style="background-image:' + esc(cssUrl(previewOf(p))) + '"></div>' +
      '<input data-cap="' + i + '" placeholder="Caption (optional)" value="' + esc(p.caption) + '">' +
      '<div class="photo-actions">' +
        '<button class="btn" type="button" data-act="left" data-i="' + i + '" aria-label="Move left"' + (i === 0 ? ' disabled' : '') + '>←</button>' +
        '<button class="btn" type="button" data-act="right" data-i="' + i + '" aria-label="Move right"' + (i === ed.photos.length - 1 ? ' disabled' : '') + '>→</button>' +
        '<button class="btn" type="button" data-act="cover" data-i="' + i + '">Make main</button>' +
        '<button class="btn danger" type="button" data-act="remove" data-i="' + i + '">Remove</button>' +
      '</div></div>').join('') || '<p class="muted small">No extra photos. Add step-by-step shots, plating ideas, etc.</p>';
  }

  const lines = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean);

  async function onSave(e) {
    e.preventDefault();
    const f = e.target;
    const title = f.title.value.trim();
    if (!title) { status('Please give the recipe a name.', 'error'); f.title.focus(); return; }

    const r = ed.r;
    r.title = title;
    r.category = f.category.value;
    r.prepTime = f.prepTime.value.trim();
    r.cookTime = f.cookTime.value.trim();
    r.servings = f.servings.value.trim();
    r.description = f.description.value.trim();
    r.tags = f.tags.value.split(',').map(t => t.trim()).filter(Boolean);
    r.ingredients = lines(f.ingredients.value);
    r.steps = lines(f.steps.value);
    r.notes = f.notes.value.trim();
    if (ed.isNew) {
      let id = slugify(title), n = 2;
      while (data.recipes.some(x => x.id === id)) id = slugify(title) + '-' + n++;
      r.id = id;
    }

    const saveBtn = $('#saveBtn');
    $$('#recipeForm button').forEach(b => { b.disabled = true; });
    try {
      // 1. Upload any new photos
      const pending = [ed.cover, ...ed.photos].filter(p => p && p.b64);
      let done = 0;
      for (const p of pending) {
        status('Uploading photo ' + (++done) + ' of ' + pending.length + '…', 'info', true);
        const path = newImagePath(r.id);
        await putFile(path, p.b64, 'Add photo for ' + title);
        p.src = path;
        delete p.b64;
      }
      r.image = ed.cover ? ed.cover.src : '';
      r.photos = ed.photos.map(p => ({ src: p.src, caption: (p.caption || '').trim() }));
      r.updated = today();

      // 2. Save the recipe text
      status('Saving recipe…', 'info', true);
      const isNew = ed.isNew;
      await commitData((isNew ? 'Add' : 'Update') + ' recipe: ' + title, d => {
        if (isNew) {
          let id = r.id, n = 2;
          while (d.recipes.some(x => x.id === id)) id = r.id + '-' + n++;
          r.id = id;
          d.recipes.push(r);
        } else {
          const i = d.recipes.findIndex(x => x.id === r.id);
          if (i >= 0) d.recipes[i] = r; else d.recipes.push(r);
        }
      });

      // 3. Tidy up photos that were replaced or removed
      await removeImages(ed.removed, title);

      dirty = false;
      status('Saved “' + title + '”! The live site updates in about a minute.', 'ok');
      location.hash = '';
      renderDash();
    } catch (err) {
      status('Not saved: ' + friendly(err), 'error');
      $$('#recipeForm button').forEach(b => { b.disabled = false; });
      saveBtn.disabled = false;
    }
  }

  async function onDelete() {
    const r = ed.r;
    if (!confirm('Delete “' + r.title + '” for good? This removes it from the website.')) return;
    $$('#recipeForm button').forEach(b => { b.disabled = true; });
    try {
      status('Deleting…', 'info', true);
      await commitData('Delete recipe: ' + r.title, d => { d.recipes = d.recipes.filter(x => x.id !== r.id); });
      const imgs = [r.image, ...(r.photos || []).map(p => p.src), ...ed.removed];
      await removeImages(imgs, r.title);
      dirty = false;
      status('Deleted “' + r.title + '”.', 'ok');
      location.hash = '';
      renderDash();
    } catch (err) {
      status(friendly(err), 'error');
      $$('#recipeForm button').forEach(b => { b.disabled = false; });
    }
  }

  // Only removes our own uploaded files in images/, and never one still used by another recipe.
  async function removeImages(paths, title) {
    const inUse = new Set();
    data.recipes.forEach(x => { if (x.image) inUse.add(x.image); (x.photos || []).forEach(p => inUse.add(p.src)); });
    const targets = [...new Set(paths)].filter(p => p && /^images\//.test(p) && !inUse.has(p));
    for (const p of targets) {
      try { await deleteFile(p, 'Remove unused photo from ' + title); } catch (e) { /* not critical */ }
    }
  }

  init();
})();
