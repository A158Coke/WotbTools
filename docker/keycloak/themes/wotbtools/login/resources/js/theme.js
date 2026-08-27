/* WotBTools auth theme: toggle + persistence + no-flash (bootstrap is inline in template.ftl head). */
(function () {
  'use strict';
  var STORAGE_KEY = 'wotbtools-theme';

  function readTheme() {
    try {
      var t = window.localStorage.getItem(STORAGE_KEY);
      if (t === 'light') return 'light';
      if (t === 'dark') return 'dark';
    } catch (e) { /* ignore */ }
    return 'dark';
  }

  function apply(theme) {
    var el = document.documentElement;
    el.setAttribute('data-theme', theme);
    var btn = document.getElementById('wbtb-theme-toggle');
    if (btn) {
      // Labels come from the FTL-localized data attributes; never hardcode a language.
      var label = theme === 'dark'
        ? (btn.getAttribute('data-label-to-light') || btn.getAttribute('title') || btn.getAttribute('aria-label'))
        : (btn.getAttribute('data-label-to-dark') || btn.getAttribute('title') || btn.getAttribute('aria-label'));
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch (e) { }
  }

  function bind() {
    var btn = document.getElementById('wbtb-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var next = readTheme() === 'dark' ? 'light' : 'dark';
      apply(next);
    });
  }

  function bindLocale() {
    var btn = document.getElementById('kc-current-locale-link');
    var list = document.getElementById('language-switch1');
    if (!btn || !list) return;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var open = list.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (ev) {
      if (!list.contains(ev.target) && !btn.contains(ev.target)) {
        list.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function init() {
    apply(readTheme());
    bind();
    bindLocale();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
