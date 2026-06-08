/**
 * DataRoom — клиентская часть (браузер пользователя).
 * Не ходит на сервер при кликах, hover, «недавно/часто».
 * В localStorage — только id ссылок; URL всегда из HTML страницы (CMS).
 */
(function () {
  "use strict";

  var STORAGE_RECENT = "dataroom-recent-v1";
  var STORAGE_FREQ = "dataroom-freq-v1";
  var MAX_RECENT = 5;
  var MAX_FREQ_KEYS = 40;
  var ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

  /** id по умолчанию, если у пользователя ещё нет истории */
  var FALLBACK_FREQ = ["doc-main", "portal", "reports", "standards"];

  var registry = Object.create(null);

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* квота или private mode — просто не пишем */
    }
  }

  function isValidId(id) {
    return typeof id === "string" && ID_RE.test(id);
  }

  /** Реестр ссылок только из DOM — единственный источник URL */
  function buildRegistry() {
    registry = Object.create(null);
    document.querySelectorAll("a.item[data-id]").forEach(function (a) {
      var id = a.getAttribute("data-id");
      var titleEl = a.querySelector(".item-title");
      if (!isValidId(id) || !titleEl) return;
      registry[id] = {
        href: a.getAttribute("href") || "#",
        title: titleEl.textContent.trim()
      };
    });
  }

  function recordClick(id) {
    if (!isValidId(id) || !registry[id]) return;

    var recent = readJson(STORAGE_RECENT, []);
    if (!Array.isArray(recent)) recent = [];
    recent = recent.filter(function (x) { return x !== id && isValidId(x); });
    recent.unshift(id);
    recent = recent.slice(0, MAX_RECENT);
    writeJson(STORAGE_RECENT, recent);

    var freq = readJson(STORAGE_FREQ, {});
    if (typeof freq !== "object" || freq === null) freq = {};
    freq[id] = (freq[id] || 0) + 1;
    var keys = Object.keys(freq);
    if (keys.length > MAX_FREQ_KEYS) {
      keys.sort(function (a, b) { return freq[b] - freq[a]; });
      var trimmed = Object.create(null);
      keys.slice(0, MAX_FREQ_KEYS).forEach(function (k) {
        trimmed[k] = freq[k];
      });
      freq = trimmed;
    }
    writeJson(STORAGE_FREQ, freq);
    renderQuickBars();
  }

  function topFrequent(limit) {
    var freq = readJson(STORAGE_FREQ, {});
    var ids = Object.keys(freq).filter(function (id) {
      return isValidId(id) && registry[id];
    });
    ids.sort(function (a, b) { return freq[b] - freq[a]; });
    if (ids.length >= limit) return ids.slice(0, limit);
    var out = ids.slice();
    FALLBACK_FREQ.forEach(function (id) {
      if (out.length >= limit) return;
      if (registry[id] && out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  function getRecent() {
    var recent = readJson(STORAGE_RECENT, []);
    if (!Array.isArray(recent)) return [];
    return recent.filter(function (id) {
      return isValidId(id) && registry[id];
    }).slice(0, MAX_RECENT);
  }

  function renderLinkList(container, ids) {
    if (!container) return;
    container.textContent = "";
    ids.forEach(function (id, i) {
      var entry = registry[id];
      if (!entry) return;
      if (i > 0) {
        var dot = document.createElement("span");
        dot.className = "quick-dot";
        dot.textContent = "·";
        container.appendChild(dot);
      }
      var link = document.createElement("a");
      link.href = entry.href;
      link.textContent = entry.title;
      link.setAttribute("rel", "noopener noreferrer");
      link.setAttribute("target", "_blank");
      container.appendChild(link);
    });
  }

  function renderQuickBars() {
    renderLinkList(document.getElementById("quick-freq"), topFrequent(4));
    var recentIds = getRecent();
    var recentWrap = document.getElementById("quick-recent-wrap");
    if (recentWrap) {
      recentWrap.hidden = recentIds.length === 0;
    }
    renderLinkList(document.getElementById("quick-recent"), recentIds);
  }

  function bindClicks() {
    document.querySelectorAll("a.item[data-id]").forEach(function (a) {
      a.setAttribute("rel", "noopener noreferrer");
      a.setAttribute("target", "_blank");
      a.addEventListener("click", function () {
        recordClick(a.getAttribute("data-id"));
      });
    });
  }

  function init() {
    buildRegistry();
    bindClicks();
    renderQuickBars();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
