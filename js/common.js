/* Shared helpers used by every page */
(function () {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // Cache-busted so edits show up as soon as GitHub Pages has rebuilt.
  async function loadSiteData() {
    try {
      await loadScript('data/data.js?v=' + Date.now());
    } catch (e) { /* fall through to empty data */ }
    return normalizeData(window.SITE_DATA);
  }

  function normalizeData(d) {
    d = d && typeof d === 'object' ? d : {};
    return {
      siteTitle: d.siteTitle || "Sticknavila Vegan Recipes",
      tagline: d.tagline || '',
      categories: Array.isArray(d.categories) ? d.categories : [],
      recipes: Array.isArray(d.recipes) ? d.recipes : []
    };
  }

  function slugify(s) {
    return String(s || '').toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'recipe';
  }

  // A CSS url() value that is safe inside a style="" attribute
  function cssUrl(src) {
    return "url('" + encodeURI(src).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29') + "')";
  }

  function imgSrc(src) {
    if (!src) return '';
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    return encodeURI(src);
  }

  // Lines ending with ":" are treated as little subheadings ("For the sauce:")
  function isSubhead(line) {
    return /:\s*$/.test(line) && line.length < 60;
  }

  function paragraphs(text) {
    return String(text || '').trim().split(/\n\s*\n/).filter(Boolean)
      .map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
  }

  function categoryName(data, id) {
    const c = data.categories.find(c => c.id === id);
    return c ? c.name : 'Other';
  }

  function recipeUrl(r) { return 'recipe.html?id=' + encodeURIComponent(r.id); }

  function tileHTML(r) {
    const style = r.image ? ' style="background-image:' + esc(cssUrl(r.image)) + '"' : '';
    return '<a class="tile' + (r.image ? '' : ' no-img') + '" href="' + esc(recipeUrl(r)) + '">' +
      '<div class="tile-img"' + style + '></div>' +
      '<span class="tile-name">' + esc(r.title) + '</span></a>';
  }

  const LEAF_SVG = '<svg class="leaf" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5 3.5c-7.6-.4-13 2.2-15.3 7.1-1.4 3-1 6 .3 8.2L3.7 20.6l1.1 1.1 1.8-1.8c2.2 1.3 5.2 1.7 8.2.3 4.9-2.3 7.5-7.7 7.1-15.3l-.1-1.3-1.3-.1zM8.4 17.1l6.3-6.3-1.1-1.1-6.3 6.3c-.5-1.5-.4-3.3.4-5 1.7-3.6 5.7-5.8 11.2-5.9-.1 5.5-2.3 9.5-5.9 11.2-1.7.8-3.5.9-4.6.8z"/></svg>';

  window.RB = { $, $$, esc, loadScript, loadSiteData, normalizeData, slugify, cssUrl, imgSrc, isSubhead, paragraphs, categoryName, recipeUrl, tileHTML, LEAF_SVG };
})();
