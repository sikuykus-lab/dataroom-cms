/**
 * DataRoom — публикация страницы из листов sections + links.
 * Меню: DataRoom → Обновить сайт / Открыть сайт
 */
var DR = {
  sheets: { sections: "sections", links: "links", config: "config" },
  cacheKey: "dataroom_html_v1",
  cacheTtl: 21600,
  sectionTitles: {
    gdrive: "Папки Google Drive",
    services: "Сервисы",
    reports: "Протоколы / Отчёты",
    departments: "Деятельность подразделений",
  },
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("DataRoom")
    .addItem("Обновить сайт (CMS → HTML)", "refreshDataRoomCache")
    .addItem("Опубликовать на Firebase", "deployFirebaseHosting_")
    .addItem("Проверить Firebase (диагностика)", "checkFirebaseDeploySetup_")
    .addSeparator()
    .addItem("Открыть сайт (Web App)", "openDataRoomSite")
    .addToUi();
}

function doGet() {
  var cache = CacheService.getScriptCache();
  var html = cache.get(DR.cacheKey);
  if (!html) {
    html = buildDataRoomHtml_();
    cache.put(DR.cacheKey, html, DR.cacheTtl);
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle("DataRoom")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function refreshDataRoomCache() {
  var html = buildDataRoomHtml_();
  CacheService.getScriptCache().put(DR.cacheKey, html, DR.cacheTtl);
  saveHtmlArtifacts_(html);
  SpreadsheetApp.getActive().toast(
    "HTML из CMS сохранён (html_store + Drive). Дальше: Опубликовать на Firebase.",
    "DataRoom",
    8
  );
}

/** Сохраняем собранную страницу для Firebase / бэкапа */
function saveHtmlArtifacts_(html) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var store = ss.getSheetByName("html_store");
  if (!store) {
    store = ss.insertSheet("html_store");
    store.hideSheet();
  }
  store.getRange("A1").setValue(html);

  var cfg = ss.getSheetByName(DR.sheets.config);
  var fileId = "";
  if (cfg) {
    fileId = String(cfg.getRange("B5").getValue() || "") + String(cfg.getRange("B6").getValue() || "");
  }
  if (fileId && fileId.length > 20) {
    DriveApp.getFileById(fileId).setContent(html);
  }
}

function openDataRoomSite() {
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert(
      "Сначала разверните Web App: Развернуть → Новое развёртывание → Веб-приложение."
    );
    return;
  }
  var html = HtmlService.createHtmlOutput(
    '<script>window.open("' + url + '","_blank");google.script.host.close();</script>'
  );
  SpreadsheetApp.getUi().showModalDialog(html, "Открываю DataRoom…");
}

function buildDataRoomHtml_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = readConfig_(ss);
  var sections = readSections_(ss);
  var links = readLinks_(ss);
  var cols = Math.max(1, Math.min(6, sections.length));
  var css = getDataroomCss_();
  var js = getDataroomJs_();
  var body = buildBody_(sections, links, cfg, cols);
  return (
    "<!DOCTYPE html><html lang=\"ru\"><head><meta charset=\"UTF-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" +
    "<title>DataRoom</title><style>" +
    css +
    "</style></head><body>" +
    body +
    "<script>" +
    js +
    "</script></body></html>"
  );
}

function readConfig_(ss) {
  var sh = ss.getSheetByName(DR.sheets.config);
  var cfg = {
    videoUrl: "#",
    contactUrl: "mailto:",
    contactLabel: "напишите ответственному",
    brandName: "К О М П А Н И Я",
    brandSub: "корпоративный портал",
    brandMark: "co",
  };
  if (!sh || sh.getLastRow() < 2) return cfg;
  var rows = sh.getRange(2, 1, sh.getLastRow(), 2).getValues();
  rows.forEach(function (r) {
    var k = String(r[0] || "").trim();
    var v = String(r[1] || "").trim();
    if (k === "video_url") cfg.videoUrl = v || cfg.videoUrl;
    if (k === "contact_url") cfg.contactUrl = v || cfg.contactUrl;
    if (k === "contact_label") cfg.contactLabel = v || cfg.contactLabel;
    if (k === "brand_name") cfg.brandName = v || cfg.brandName;
    if (k === "brand_sub") cfg.brandSub = v || cfg.brandSub;
    if (k === "brand_mark") cfg.brandMark = v || cfg.brandMark;
  });
  return cfg;
}

function readSections_(ss) {
  var sh = ss.getSheetByName(DR.sheets.sections);
  var fallback = [
    { key: "gdrive", title: DR.sectionTitles.gdrive, order: 1 },
    { key: "services", title: DR.sectionTitles.services, order: 2 },
    { key: "reports", title: DR.sectionTitles.reports, order: 3 },
    { key: "departments", title: DR.sectionTitles.departments, order: 4 },
  ];
  if (!sh || sh.getLastRow() < 2) return fallback;
  var data = sh.getRange(2, 1, sh.getLastRow(), 4).getValues();
  var out = [];
  data.forEach(function (r) {
    if (String(r[3]).toUpperCase() === "FALSE") return;
    var key = String(r[0] || "").trim();
    if (!key) return;
    out.push({
      key: key,
      title: String(r[1] || "").trim() || DR.sectionTitles[key] || key,
      order: Number(r[2]) || 999,
    });
  });
  out.sort(function (a, b) {
    return a.order - b.order;
  });
  return out.length ? out : fallback;
}

function normalizeUrl_(url) {
  if (!url || url === "#" || /^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
    return url;
  }
  if (url.indexOf("//") === 0) {
    return "https:" + url;
  }
  return "https://" + url;
}

function readLinks_(ss) {
  var sh = ss.getSheetByName(DR.sheets.links);
  if (!sh || sh.getLastRow() < 2) return [];
  var headers = sh
    .getRange(1, 1, 1, sh.getLastColumn())
    .getValues()[0]
    .map(function (h) {
      return String(h || "")
        .trim()
        .toLowerCase();
    });
  var idx = function (name) {
    var i = headers.indexOf(name);
    return i >= 0 ? i : -1;
  };
  var data = sh.getRange(2, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var out = [];
  data.forEach(function (r) {
    var active = idx("active") >= 0 ? r[idx("active")] : true;
    if (String(active).toUpperCase() === "FALSE") return;
    var id = String(r[idx("id")] || "").trim();
    var url = normalizeUrl_(String(r[idx("url")] || "").trim());
    if (!id || !url) return;
    out.push({
      id: id,
      section: String(r[idx("section")] || "").trim(),
      subsection: String(r[idx("subsection")] || "").trim(),
      group: idx("group") >= 0 ? String(r[idx("group")] || "").trim() : "",
      title: String(r[idx("title")] || "").trim(),
      desc: idx("desc") >= 0 ? String(r[idx("desc")] || "").trim() : "",
      tip: idx("tip") >= 0 ? String(r[idx("tip")] || "").trim() : "",
      url: url,
      sort: Number(r[idx("sort_order")]) || 9999,
      collapsed:
        idx("collapsed_default") >= 0 &&
        String(r[idx("collapsed_default")]).toUpperCase() === "TRUE",
      highlight:
        idx("highlight") >= 0 &&
        String(r[idx("highlight")]).toUpperCase() === "TRUE",
    });
  });
  return out;
}

function buildBody_(sections, links, cfg, cols) {
  var esc = escapeHtml_;
  var updated = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || "Europe/Moscow",
    "dd.MM.yyyy"
  );
  var html = "";
  html += '<header class="header"><div class="header-inner">';
  html +=
    '<div class="header-left"><a class="video-link" href="' +
    esc(cfg.videoUrl) +
    '" target="_blank" rel="noopener noreferrer">Видеоинструкция по DataRoom</a></div>';
  html +=
    '<div class="header-right"><div class="brand"><div class="brand-mark">' + esc(cfg.brandMark || "co") + '</div>';
  html +=
    '<div class="brand-text"><div class="name">' + esc(cfg.brandName || "К О М П А Н И Я") +
    '</div><div class="sub">' + esc(cfg.brandSub || "корпоративный портал") + '</div></div></div>';
  html += '<div class="brand-illus"></div></div></div></header>';
  html += '<div class="quick">';
  html +=
    '<div class="quick-inner"><span class="quick-label">Часто у вас</span><div id="quick-freq" class="quick-links"></div></div>';
  html +=
    '<div class="quick-inner quick-recent" id="quick-recent-wrap" hidden><span class="quick-label">Недавно</span><div id="quick-recent" class="quick-links"></div></div>';
  html += "</div>";
  html += '<main class="grid cols-' + cols + '">';

  sections.forEach(function (sec) {
    var secLinks = links
      .filter(function (l) {
        return l.section === sec.key;
      })
      .sort(function (a, b) {
        if (a.subsection !== b.subsection)
          return a.subsection.localeCompare(b.subsection, "ru");
        if (a.sort !== b.sort) return a.sort - b.sort;
        return a.title.localeCompare(b.title, "ru");
      });
    html += '<section class="col"><div class="col-title">' + esc(sec.title) + "</div><div class=\"col-body\">";
    html += renderSectionLinks_(secLinks, esc);
    html += "</div></section>";
  });

  html += "</main>";
  html +=
    '<footer class="footer"><span>DataRoom · обновлено ' +
    updated +
    '</span><span>Нет доступа к файлу — <a href="' +
    esc(cfg.contactUrl) +
    '">' +
    esc(cfg.contactLabel) +
    "</a></span></footer>";
  return html;
}

function renderSectionLinks_(links, esc) {
  if (!links.length) {
    return '<p style="padding:12px 16px;color:#5a6d7e;font-size:14px">Пока нет ссылок</p>';
  }
  var bySub = {};
  var subOrder = [];
  links.forEach(function (l) {
    var sub = l.subsection || "Прочее";
    if (!bySub[sub]) {
      bySub[sub] = [];
      subOrder.push(sub);
    }
    bySub[sub].push(l);
  });

  var html = "";
  subOrder.forEach(function (sub) {
    var items = bySub[sub];
    var useDetails = items[0].collapsed || items.length > 6;
    if (useDetails) {
      html +=
        "<details><summary data-count=\"" +
        items.length +
        "\">" +
        esc(sub) +
        "</summary><div class=\"rows\">";
      html += renderItems_(items, esc);
      html += "</div></details>";
    } else {
      html += '<div class="sub">' + esc(sub) + '</div><div class="rows">';
      html += renderItems_(items, esc);
      html += "</div>";
    }
  });
  return html;
}

function renderItems_(items, esc) {
  var html = "";
  var lastGroup = null;
  items.forEach(function (l) {
    if (l.group && l.group !== lastGroup) {
      html += '<div class="grp">' + esc(l.group) + "</div>";
      lastGroup = l.group;
    }
    var cls = l.highlight ? "item featured" : "item";
    html +=
      '<a class="' +
      cls +
      '" href="' +
      esc(l.url) +
      '" data-id="' +
      esc(l.id) +
      '" target="_blank" rel="noopener noreferrer">';
    html += '<span class="item-title">' + esc(l.title) + "</span>";
    if (l.desc) html += '<span class="desc">' + esc(l.desc) + "</span>";
    if (l.tip) html += '<span class="tip-box">' + esc(l.tip) + "</span>";
    html += "</a>";
  });
  return html;
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** CSS/JS вшиты в bundle (apps-script-bundle.gs) */
function getDataroomCss_() {
  return DATAROOM_CSS || "";
}

function getDataroomJs_() {
  return DATAROOM_JS || "";
}



var DATAROOM_CSS = `:root {
  /* число колонок: 2–6, задаёт CMS/генератор на .grid */
  --cols: 4;
  --col-min: 220px;
  --abs-navy: #1a3a5c;
  --abs-blue: #2f6faa;
  --abs-blue-dark: #255a8a;
  --abs-sky: #d4e6f6;
  --abs-sky-soft: #eaf3fb;
  --abs-bg: #eef2f6;
  --abs-white: #ffffff;
  --abs-text: #1e2d3d;
  --abs-muted: #5a6d7e;
  --abs-line: #c5d3e0;
  --abs-link: #1a5fad;
  --abs-gold: #a67c00;
  --abs-gold-bg: #fdf8ec;
  --max-w: 1560px;
  --row-size: 17px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  /* системные шрифты — без CDN, без лишних запросов */
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  background: var(--abs-bg);
  color: var(--abs-text);
  font-size: var(--row-size);
  line-height: 1.4;
  padding-bottom: 32px;
  min-height: 2800px; /* для embed в Google Sites */
}

.header {
  background: var(--abs-white);
  border-bottom: 3px solid var(--abs-navy);
}

.header-inner {
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 20px 28px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.video-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--abs-link);
  font-size: 16px;
  font-weight: 700;
  text-decoration: none;
  padding: 8px 0;
}

.video-link:hover { color: var(--abs-navy); }

.video-link::before {
  content: "▶";
  font-size: 11px;
  width: 22px;
  height: 22px;
  background: var(--abs-sky);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--abs-blue-dark);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-mark {
  width: 52px;
  height: 52px;
  background: var(--abs-navy);
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
  font-size: 20px;
  letter-spacing: -.03em;
}

.brand-text .name {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: .18em;
  color: var(--abs-navy);
  line-height: 1.2;
}

.brand-text .sub {
  font-size: 12px;
  color: var(--abs-muted);
  margin-top: 2px;
}

.brand-illus {
  width: 180px;
  height: 72px;
  background: linear-gradient(135deg, var(--abs-sky-soft) 0%, #f5f8fa 100%);
  border: 1px solid var(--abs-line);
  border-radius: 4px;
}

.quick {
  max-width: var(--max-w);
  margin: 16px auto 0;
  padding: 0 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-inner {
  background: var(--abs-white);
  border: 1px solid var(--abs-line);
  border-left: 4px solid var(--abs-gold);
  padding: 12px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.quick-inner.quick-recent {
  border-left-color: var(--abs-blue);
}

.quick-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--abs-muted);
  text-transform: uppercase;
  letter-spacing: .06em;
  white-space: nowrap;
}

.quick-links {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.quick-links a {
  font-size: 15px;
  font-weight: 700;
  color: var(--abs-link);
  text-decoration: none;
  padding: 5px 0;
  border-bottom: 1px solid transparent;
}

.quick-links a:hover {
  color: var(--abs-navy);
  border-bottom-color: var(--abs-blue);
}

.quick-dot {
  color: var(--abs-line);
  user-select: none;
}

.grid {
  max-width: var(--max-w);
  margin: 16px auto 0;
  padding: 0 20px;
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(var(--col-min), 1fr));
  gap: 14px;
  align-items: stretch;
}

/* явные классы от генератора (если не задан style="--cols:N") */
.grid.cols-2 { --cols: 2; }
.grid.cols-3 { --cols: 3; }
.grid.cols-4 { --cols: 4; }
.grid.cols-5 { --cols: 5; }
.grid.cols-6 { --cols: 6; }

.col {
  background: var(--abs-white);
  border: 1px solid var(--abs-line);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  min-height: 520px;
  box-shadow: 0 1px 4px rgba(26, 58, 92, .06);
}

.col-title {
  background: var(--abs-blue);
  color: #fff;
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  padding: 13px 10px;
  border-radius: 3px 3px 0 0;
  position: sticky;
  top: 0;
  z-index: 2;
}

.col-body { padding: 6px 0 16px; flex: 1; }

.sub {
  background: var(--abs-sky);
  color: var(--abs-navy);
  font-size: 15px;
  font-weight: 700;
  padding: 8px 16px;
  margin: 10px 10px 0;
  border-radius: 2px;
}

.sub:first-child { margin-top: 8px; }

details { margin: 10px 10px 0; }

details > summary {
  background: var(--abs-sky);
  color: var(--abs-navy);
  font-size: 15px;
  font-weight: 700;
  padding: 8px 16px;
  cursor: pointer;
  list-style: none;
  border-radius: 2px;
  user-select: none;
}

details > summary:hover { background: #c5dff2; }
details > summary::-webkit-details-marker { display: none; }

details > summary::after {
  content: attr(data-count);
  float: right;
  font-size: 12px;
  font-weight: 400;
  color: var(--abs-muted);
  background: rgba(255,255,255,.55);
  padding: 1px 8px;
  border-radius: 10px;
}

details > summary::before {
  content: "+ ";
  font-weight: 400;
  color: var(--abs-blue-dark);
}

details[open] > summary::before { content: "− "; }
details[open] > summary { border-radius: 2px 2px 0 0; }

details .rows {
  border: 1px solid var(--abs-sky);
  border-top: none;
  border-radius: 0 0 2px 2px;
  background: #fafcfe;
}

.rows { margin: 0 10px; }
.sub + .rows { margin-top: 0; }

a.item {
  display: block;
  position: relative;
  padding: 10px 16px;
  color: var(--abs-link);
  text-decoration: none;
  border-bottom: 1px solid #edf2f7;
  transition: background .1s;
}

a.item:last-child { border-bottom: none; }

a.item:hover {
  background: var(--abs-sky-soft);
  color: var(--abs-navy);
  z-index: 5;
}

a.item-title {
  display: block;
  font-weight: 700;
  font-size: var(--row-size);
}

a.item .desc {
  display: block;
  font-size: 13px;
  font-weight: 400;
  color: var(--abs-muted);
  margin-top: 3px;
  line-height: 1.35;
}

a.item .tip-box {
  display: none;
  position: absolute;
  left: 8px;
  right: 8px;
  top: calc(100% - 2px);
  padding: 10px 12px;
  background: rgba(26, 58, 92, .88);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  color: #fff;
  font-size: 13px;
  line-height: 1.45;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, .15);
  box-shadow: 0 6px 20px rgba(26, 58, 92, .2);
  z-index: 20;
  pointer-events: none;
}

a.item:hover .tip-box { display: block; }

a.item.featured {
  background: var(--abs-gold-bg);
  border-left: 3px solid var(--abs-gold);
  padding-left: 13px;
}

a.item.featured:hover { background: #faf0dc; }

.grp {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--abs-muted);
  padding: 10px 16px 4px;
  background: #fafcfe;
}

.footer {
  max-width: var(--max-w);
  margin: 20px auto 0;
  padding: 14px 28px;
  font-size: 13px;
  color: var(--abs-muted);
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.footer a { color: var(--abs-link); text-decoration: none; }
.footer a:hover { text-decoration: underline; }

@media (prefers-reduced-motion: reduce) {
  a.item, details > summary { transition: none; }
}

/* адаптив: не ломаем задуманное число колонок на широком мониторе */
@media (max-width: 1400px) {
  .grid.cols-5, .grid.cols-6,
  .grid[style*="--cols: 5"], .grid[style*="--cols: 6"] {
    --col-min: 200px;
  }
}

@media (max-width: 1100px) {
  .grid { --cols: 2 !important; }
}

@media (max-width: 640px) {
  .grid { --cols: 1 !important; }
  .header-inner { flex-direction: column; align-items: flex-start; }
  .brand-illus { display: none; }
}
`;
var DATAROOM_JS = `/**
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
  var FALLBACK_FREQ = ["main-table", "absplan-likova", "staff-smr", "portal"];

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
`;
