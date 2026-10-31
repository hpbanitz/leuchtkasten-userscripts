// ==UserScript==
// @name         Leuchtkasten.net – Untermenüs (3. Ebene)
// @namespace    https://www.leuchtkasten.net/
// @version      1.2.1
// @description  Ergänzt das Kopfmenü um eine 3. Ebene: Unter "Leuchtkasten Standard" usw. erscheinen die einzelnen Produkte (z. B. "Leuchtkasten einseitig Scheibe") als Ausklapp-Menü.
// @author       Hans-Peter
// @homepageURL  https://github.com/hpbanitz/leuchtkasten-userscripts
// @updateURL    https://raw.githubusercontent.com/hpbanitz/leuchtkasten-userscripts/main/leuchtkasten-untermenues.user.js
// @downloadURL  https://raw.githubusercontent.com/hpbanitz/leuchtkasten-userscripts/main/leuchtkasten-untermenues.user.js
// @match        https://www.leuchtkasten.net/*
// @match        http://www.leuchtkasten.net/*
// @match        https://leuchtkasten.net/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Einstellungen ----------
  const CACHE_KEY = 'lk3_cache_v3';
  const log = (...a) => console.log('[LK3]', ...a);
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h – danach werden die Unterseiten neu eingelesen
  const PARALLEL = 3;                    // gleichzeitige Abrufe (Server schonen)
  const PRODUCT_SELECTOR = '.listing-product-title a'; // Produktlinks auf den Kategorieseiten
  const MOBILE_MAX = 940;                // unterhalb dieser Breite: Foundation-Mobilmenü, keine 3. Ebene

  const nav = document.querySelector('nav.top-bar');
  if (!nav) return;

  // ---------- CSS ----------
  const style = document.createElement('style');
  style.id = 'lk3-style';
  style.textContent = (`
    nav.top-bar ul.dropdown { overflow: visible !important; }
    nav.top-bar ul.dropdown > li.lk3-parent { position: relative; }
    nav.top-bar ul.dropdown > li.lk3-parent > a { padding-right: 28px !important; }
    nav.top-bar ul.dropdown > li.lk3-parent > a .lk3-arrow {
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
      font-size: 1.1em; line-height: 1; opacity: .7; pointer-events: none;
    }
    nav.top-bar ul.lk3-sub {
      display: none; position: absolute; top: 0; left: 100%;
      min-width: 260px; width: max-content; margin: 0; padding: 0; list-style: none;
      z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,.25);
    }
    nav.top-bar ul.lk3-sub.lk3-left { left: auto; right: 100%; }
    nav.top-bar ul.dropdown > li.lk3-parent:hover > ul.lk3-sub,
    nav.top-bar ul.dropdown > li.lk3-parent:focus-within > ul.lk3-sub { display: block; }
    nav.top-bar ul.lk3-sub > li { float: none !important; display: block; width: auto !important; }
    nav.top-bar ul.lk3-sub > li > a { white-space: nowrap; display: block; width: auto !important; padding-right: 20px !important; }
    @media (max-width: ${MOBILE_MAX}px) {
      nav.top-bar ul.lk3-sub,
      nav.top-bar ul.dropdown > li.lk3-parent > a .lk3-arrow { display: none !important; }
      nav.top-bar ul.dropdown > li.lk3-parent > a { padding-right: inherit !important; }
    }
  `);
  document.head.appendChild(style);

  // ---------- Cache ----------
  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return c && typeof c === 'object' && c.data ? c : { ts: 0, data: {} };
    } catch (e) { return { ts: 0, data: {} }; }
  }
  function saveCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) { /* egal */ }
  }

  // Neu einlesen erzwingen: an die Adresse ?lk3reset anhängen
  if (/[?&]lk3reset\b/.test(location.search)) { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }

  // ---------- Menüeinträge der 2. Ebene sammeln ----------
  const norm = (u) => { try { const x = new URL(u, location.href); return (x.origin + x.pathname).replace(/\/+$/, ''); } catch (e) { return u; } };

  const items = [...nav.querySelectorAll('ul.dropdown > li:not(.title) > a[href]')]
    .filter(a => /\/produkte\//.test(a.href))
    .map(a => ({ li: a.parentElement, a, url: norm(a.href) }));
  log('Menüpunkte 2. Ebene:', items.length);
  if (!items.length) return;

  const here = norm(location.href);

  // ---------- Untermenü bauen ----------
  function render(item, products) {
    const { li, a } = item;
    li.querySelector(':scope > ul.lk3-sub')?.remove();
    li.classList.remove('lk3-parent');
    a.querySelector('.lk3-arrow')?.remove();
    if (!products || !products.length) return;

    const ul = document.createElement('ul');
    ul.className = 'lk3-sub';
    // Hintergrund vom bestehenden Dropdown übernehmen, damit es gleich aussieht
    const parentUl = li.parentElement;
    const bg = getComputedStyle(parentUl).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ul.style.backgroundColor = bg;

    for (const p of products) {
      const sli = document.createElement('li');
      if (norm(p.h) === here) sli.className = 'active';
      const sa = document.createElement('a');
      sa.href = p.h;
      sa.textContent = p.t;
      sli.appendChild(sa);
      ul.appendChild(sli);
    }

    const arrow = document.createElement('span');
    arrow.className = 'lk3-arrow';
    arrow.textContent = '›';
    a.appendChild(arrow);
    li.classList.add('lk3-parent');
    li.appendChild(ul);

    // Bei Platzmangel rechts nach links aufklappen
    li.addEventListener('mouseenter', () => {
      ul.classList.remove('lk3-left');
      ul.style.display = 'block';
      const r = ul.getBoundingClientRect();
      ul.style.display = '';
      if (r.right > document.documentElement.clientWidth - 8) ul.classList.add('lk3-left');
    });
  }

  // ---------- Kategorieseite abrufen und Produkte auslesen ----------
  async function fetchProducts(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status + ' ' + url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    const out = [];
    for (const l of doc.querySelectorAll(PRODUCT_SELECTOR)) {
      const h = new URL(l.getAttribute('href'), url).href;
      const t = l.textContent.trim();
      if (!t || seen.has(h)) continue;
      seen.add(h);
      out.push({ t, h });
    }
    return out;
  }

  async function refresh(cache) {
    const data = {};
    const queue = [...items];
    let failed = 0;
    async function worker() {
      while (queue.length) {
        const it = queue.shift();
        try {
          data[it.url] = await fetchProducts(it.url);
        } catch (e) {
          failed++;
          log('Fehler bei', it.url, e);
          data[it.url] = cache.data[it.url] || []; // alten Stand behalten
        }
        render(it, data[it.url]);
      }
    }
    // Hinweis: Array.from wird von der Seite (Joomla/MooTools) überschrieben – daher klassische Schleife
    const workers = [];
    for (let i = 0; i < PARALLEL; i++) workers.push(worker());
    await Promise.all(workers);
    // Nur speichern, wenn nicht alles schiefging (z. B. offline)
    if (failed < items.length) saveCache(data);
    log('fertig, Fehler:', failed, '| mit Untermenü:', Object.values(data).filter(x => x.length).length);
  }

  // ---------- Start ----------
  const cache = loadCache();
  for (const it of items) render(it, cache.data[it.url]);

  const fresh = Date.now() - cache.ts < CACHE_TTL && items.every(it => it.url in cache.data);
  if (!fresh) refresh(cache);
})();
