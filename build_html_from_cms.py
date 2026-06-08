#!/usr/bin/env python3
"""Сборка index.html из листов CMS (sections, links, config) через Sheets API."""
from __future__ import annotations

import json
import os
import subprocess
import urllib.parse
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "firebase-public" / "index.html"
CSS = ROOT / "dataroom.css"
JS = ROOT / "dataroom-client.js"
MCP = Path(os.environ.get("DATAROOM_OAUTH_CONFIG", str(ROOT / "oauth-config.json")))

DEFAULT_SPREADSHEET_ID = os.environ.get("DATAROOM_SPREADSHEET_ID", "YOUR_SPREADSHEET_ID")

SECTION_TITLES = {
    "gdrive": "Папки Google Drive",
    "services": "Сервисы",
    "reports": "Протоколы / Отчёты",
    "departments": "Деятельность подразделений",
}


def sheets_token() -> str:
    if os.environ.get("DATAROOM_SHEETS_TOKEN"):
        return os.environ["DATAROOM_SHEETS_TOKEN"]
    if not MCP.is_file():
        raise RuntimeError(
            "Задайте DATAROOM_SHEETS_TOKEN или положите oauth-config.json "
            "(client_id, client_secret, refresh_token)."
        )
    env = json.loads(MCP.read_text())
    if "mcpServers" in env:
        env = env["mcpServers"]["Work"]["env"]
    data = urllib.parse.urlencode(
        {
            "client_id": env["GOOGLE_CLIENT_ID"],
            "client_secret": env["GOOGLE_CLIENT_SECRET"],
            "refresh_token": env["GOOGLE_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        }
    )
    out = subprocess.check_output(
        ["curl", "-s", "-X", "POST", "https://oauth2.googleapis.com/token", "-d", data],
        text=True,
    )
    body = json.loads(out)
    if "access_token" not in body:
        raise RuntimeError(f"OAuth token: {body}")
    return body["access_token"]


def sheet_values(spreadsheet_id: str, range_a1: str, tok: str) -> list[list[str]]:
    q = urllib.parse.quote(range_a1, safe="!")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{q}"
    out = subprocess.check_output(
        ["curl", "-s", url, "-H", f"Authorization: Bearer {tok}"], text=True
    )
    data = json.loads(out)
    if "error" in data:
        err = data["error"]
        msg = err.get("message", err)
        if err.get("status") == "PERMISSION_DENIED":
            raise PermissionError(
                f"Нет доступа к таблице {spreadsheet_id}: {msg}\n"
                "Дайте сервисному аккаунту или OAuth-пользователю доступ «Редактор» к CMS."
            )
        raise RuntimeError(msg)
    return data.get("values") or []


def escape_html(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def read_config(rows: list[list[str]]) -> dict[str, str]:
    cfg = {
        "video_url": "#",
        "contact_url": "mailto:",
        "contact_label": "напишите ответственному",
        "brand_name": "К О М П А Н И Я",
        "brand_sub": "корпоративный портал",
        "brand_mark": "co",
    }
    for row in rows[1:]:
        if len(row) < 2:
            continue
        k, v = str(row[0]).strip(), str(row[1]).strip()
        if k in cfg and v:
            cfg[k] = v
        if k == "brand_name" and v:
            cfg["brand_name"] = v
        if k == "brand_sub" and v:
            cfg["brand_sub"] = v
        if k == "brand_mark" and v:
            cfg["brand_mark"] = v
    return cfg


def read_sections(rows: list[list[str]]) -> list[dict]:
    fallback = [
        {"key": "gdrive", "title": SECTION_TITLES["gdrive"], "order": 1},
        {"key": "services", "title": SECTION_TITLES["services"], "order": 2},
        {"key": "reports", "title": SECTION_TITLES["reports"], "order": 3},
        {"key": "departments", "title": SECTION_TITLES["departments"], "order": 4},
    ]
    if len(rows) < 2:
        return fallback
    out = []
    for row in rows[1:]:
        if len(row) < 4:
            continue
        if str(row[3]).upper() == "FALSE":
            continue
        key = str(row[0]).strip()
        if not key:
            continue
        out.append(
            {
                "key": key,
                "title": str(row[1]).strip() or SECTION_TITLES.get(key, key),
                "order": int(row[2]) if str(row[2]).strip().isdigit() else 999,
            }
        )
    out.sort(key=lambda x: x["order"])
    return out or fallback


def normalize_url(url: str) -> str:
    if not url or url == "#" or url.lower().startswith(("http://", "https://", "mailto:")):
        return url
    if url.startswith("//"):
        return "https:" + url
    return "https://" + url


def read_links(rows: list[list[str]]) -> list[dict]:
    if len(rows) < 2:
        return []
    headers = [str(h or "").strip().lower() for h in rows[0]]

    def idx(name: str) -> int:
        return headers.index(name) if name in headers else -1

    out = []
    for row in rows[1:]:
        def cell(name: str, default: str = "") -> str:
            i = idx(name)
            return str(row[i]).strip() if i >= 0 and i < len(row) else default

        active = cell("active", "TRUE")
        if active.upper() == "FALSE":
            continue
        link_id = cell("id")
        url = normalize_url(cell("url"))
        if not link_id or not url:
            continue
        sort_raw = cell("sort_order", "9999")
        sort_order = int(sort_raw) if sort_raw.isdigit() else 9999
        out.append(
            {
                "id": link_id,
                "section": cell("section"),
                "subsection": cell("subsection"),
                "group": cell("group"),
                "title": cell("title"),
                "desc": cell("desc"),
                "tip": cell("tip"),
                "url": url,
                "sort": sort_order,
                "collapsed": cell("collapsed_default").upper() == "TRUE",
                "highlight": cell("highlight").upper() == "TRUE",
            }
        )
    return out


def render_items(items: list[dict], esc) -> str:
    html = ""
    last_group = None
    for link in items:
        if link["group"] and link["group"] != last_group:
            html += f'<div class="grp">{esc(link["group"])}</div>'
            last_group = link["group"]
        cls = "item featured" if link["highlight"] else "item"
        html += (
            f'<a class="{cls}" href="{esc(link["url"])}" data-id="{esc(link["id"])}" '
            f'target="_blank" rel="noopener noreferrer">'
            f'<span class="item-title">{esc(link["title"])}</span>'
        )
        if link["desc"]:
            html += f'<span class="desc">{esc(link["desc"])}</span>'
        if link["tip"]:
            html += f'<span class="tip-box">{esc(link["tip"])}</span>'
        html += "</a>"
    return html


def render_section_links(links: list[dict], esc) -> str:
    if not links:
        return '<p style="padding:12px 16px;color:#5a6d7e;font-size:14px">Пока нет ссылок</p>'
    by_sub: dict[str, list[dict]] = {}
    sub_order: list[str] = []
    for link in links:
        sub = link["subsection"] or "Прочее"
        if sub not in by_sub:
            by_sub[sub] = []
            sub_order.append(sub)
        by_sub[sub].append(link)

    html = ""
    for sub in sub_order:
        items = by_sub[sub]
        use_details = items[0]["collapsed"] or len(items) > 6
        if use_details:
            html += (
                f'<details><summary data-count="{len(items)}">{esc(sub)}</summary>'
                f'<div class="rows">{render_items(items, esc)}</div></details>'
            )
        else:
            html += f'<div class="sub">{esc(sub)}</div><div class="rows">{render_items(items, esc)}</div>'
    return html


def build_body(sections: list[dict], links: list[dict], cfg: dict[str, str]) -> str:
    esc = escape_html
    updated = datetime.now().strftime("%d.%m.%Y")
    html = ""
    html += '<header class="header"><div class="header-inner">'
    html += (
        f'<div class="header-left"><a class="video-link" href="{esc(cfg["video_url"])}" '
        f'target="_blank" rel="noopener noreferrer">Видеоинструкция по DataRoom</a></div>'
    )
    brand = cfg.get("brand_name", "К О М П А Н И Я")
    brand_sub = cfg.get("brand_sub", "корпоративный портал")
    mark = cfg.get("brand_mark", "co")
    html += f'<div class="header-right"><div class="brand"><div class="brand-mark">{esc(mark)}</div>'
    html += (
        f'<div class="brand-text"><div class="name">{esc(brand)}</div>'
        f'<div class="sub">{esc(brand_sub)}</div></div></div>'
    )
    html += '<div class="brand-illus"></div></div></div></header>'
    html += '<div class="quick">'
    html += (
        '<div class="quick-inner"><span class="quick-label">Часто у вас</span>'
        '<div id="quick-freq" class="quick-links"></div></div>'
    )
    html += (
        '<div class="quick-inner quick-recent" id="quick-recent-wrap" hidden>'
        '<span class="quick-label">Недавно</span><div id="quick-recent" class="quick-links"></div></div>'
    )
    html += "</div>"

    cols = max(1, min(6, len(sections)))
    html += f'<main class="grid cols-{cols}">'
    for sec in sections:
        sec_links = sorted(
            [l for l in links if l["section"] == sec["key"]],
            key=lambda l: (l["subsection"], l["sort"], l["title"]),
        )
        html += (
            f'<section class="col"><div class="col-title">{esc(sec["title"])}</div>'
            f'<div class="col-body">{render_section_links(sec_links, esc)}</div></section>'
        )
    html += "</main>"
    html += (
        f'<footer class="footer"><span>DataRoom · обновлено {updated}</span>'
        f'<span>Нет доступа к файлу — <a href="{esc(cfg["contact_url"])}">'
        f'{esc(cfg["contact_label"])}</a></span></footer>'
    )
    return html


def build_html(spreadsheet_id: str, tok: str) -> str:
    sections = read_sections(sheet_values(spreadsheet_id, "sections!A1:D", tok))
    links = read_links(sheet_values(spreadsheet_id, "links!A1:Z", tok))
    config = read_config(sheet_values(spreadsheet_id, "config!A1:B", tok))
    if not links:
        raise RuntimeError("В links нет строк с id и url — проверьте колонку url.")
    css = CSS.read_text(encoding="utf-8")
    js = JS.read_text(encoding="utf-8")
    body = build_body(sections, links, config)
    return (
        "<!DOCTYPE html><html lang=\"ru\"><head><meta charset=\"UTF-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
        "<title>DataRoom</title><style>"
        + css
        + "</style></head><body>"
        + body
        + "<script>"
        + js.replace("</script>", "<\\/script>")
        + "</script></body></html>"
    )


def main() -> None:
    spreadsheet_id = os.environ.get("DATAROOM_SPREADSHEET_ID", DEFAULT_SPREADSHEET_ID)
    tok = sheets_token()
    html = build_html(spreadsheet_id, tok)
    links = read_links(
        sheet_values(spreadsheet_id, "links!A:L", tok)
    )
    http_n = sum(1 for l in links if l["url"].startswith("http"))
    hash_n = sum(1 for l in links if l["url"] == "#")
    bad_n = len(links) - http_n - hash_n
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    msg = (
        f"OK sheet={spreadsheet_id} links={len(links)} http={http_n} "
        f"hash={hash_n} bad={bad_n} → {OUT} ({len(html)} bytes)"
    )
    if http_n == 0:
        print(
            "WARN: в links нет ни одного url с http — залито, но клики не ведут никуда.",
            file=__import__("sys").stderr,
        )
    if hash_n:
        print(f"WARN: {hash_n} ссылок с url=# — заполните колонку url в таблице.", file=__import__("sys").stderr)
    print(msg)


if __name__ == "__main__":
    main()
