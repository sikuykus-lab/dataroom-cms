# DataRoom — навигатор по корпоративным ссылкам

Короче: **таблица как CMS → статический сайт → Firebase Hosting бесплатно**.  
Пользователь кликает — сервер молчит. Правки в таблице — два пункта меню, и прод обновлён.

Задача была простая: сотня папок Drive, порталы, отчёты — люди теряются в закладках. Нужен один экран, который **редактирует не разработчик, а тот, кто ведёт ссылки**, и который **не падает**, когда зашли 200 человек одновременно.

---

## Что сделано

- **CMS на Google Sheets** — листы `links`, `sections`, `config`; без отдельной админки.
- **Генератор HTML** — Apps Script в таблице или Python-скрипт с Mac.
- **Статика на Firebase Hosting** — один `index.html`, CDN, $0 на типичных нагрузках.
- **Клиентский JS** — «часто у вас» и «недавно» через `localStorage`, только id, без запросов на сервер.
- **Деплой из меню таблицы** — «Обновить сайт» → «Опубликовать на Firebase»; SA-ключ лежит на Drive, не в коде.

Никаких своих серверов, баз, Docker. Таблица уже есть у компании — используем её.

---

## Фишки и удобство

| Фишка | Зачем |
|-------|-------|
| Колонки 2–6 из листа `sections` | Верстка под структуру компании, не хардкод |
| `<details>` по подразделам | Длинные списки не давят на экран |
| `desc` + `tip` на hover | Подсказки без модалок и без JS на сервере |
| `highlight` / `featured` | Важные ссылки видно сразу |
| `active=FALSE` | Выключить ссылку, не удаляя строку |
| Quick-bar «часто / недавно» | Персонально в браузере, общий HTML один на всех |
| `url=#` | Черновик в таблице — на сайте заглушка, не битая ссылка |

**Плюсы по деньгам и нагрузке:** при 200 пользователях — 200 отдач gzip-статики с CDN, не 200× Apps Script. Google Sheets API дергается **только при публикации**, не при каждом клике. Firebase Spark покрывает такой сценарий.

---

## Схема хранения (почему это эффективно)

```mermaid
flowchart TB
  subgraph edit ["Редактирование (редко)"]
    CMS["Google Sheet CMS\nlinks · sections · config"]
    AS["Apps Script\nсборка HTML"]
    PY["Python build_html_from_cms.py\nопционально с Mac"]
  end

  subgraph publish ["Публикация (по кнопке)"]
    HS["html_store / кэш скрипта"]
    FB["Firebase Hosting\nindex.html gzip"]
  end

  subgraph runtime ["Работа пользователя (часто)"]
    CDN["CDN Firebase\nCache-Control 5 мин"]
    BR["Браузер"]
    LS["localStorage\nтолько id кликов"]
    DRV["Drive / порталы\nправа как были"]
  end

  CMS --> AS
  CMS --> PY
  AS --> HS
  PY --> FB
  AS --> FB
  HS --> FB
  FB --> CDN
  CDN --> BR
  BR --> LS
  BR -->|"клик href из HTML"| DRV
```

**Идея:** тяжёлое — один раз при публикации; на пользователя — кэш и локальная история.

---

## Процесс пользователя

```mermaid
flowchart LR
  A["Открыл DataRoom"] --> B["Видит колонки\nпо разделам"]
  B --> C{"Нужная ссылка\nв quick-bar?"}
  C -->|да| D["Клик → Drive/портал"]
  C -->|нет| E["Раскрыл подраздел\nили прокрутил"]
  E --> F["Hover → tip"]
  F --> D
  D --> G["id в localStorage\nURL не пишем"]
  G --> H["В следующий раз\n«часто / недавно»"]
```

**Редактор контента** (не пользователь сайта):

```mermaid
flowchart TD
  R1["Правка url в links"] --> R2["DataRoom → Обновить сайт"]
  R2 --> R3["DataRoom → Опубликовать на Firebase"]
  R3 --> R4["Ctrl+F5 на проде\n~секунды, CDN до 5 мин"]
```

---

## Стек

| Слой | Технология |
|------|------------|
| CMS | Google Sheets |
| Сборка | Apps Script / Python 3 |
| Хостинг | Firebase Hosting (Spark) |
| Фронт | HTML + CSS + vanilla JS |
| Авторизация файлов | Google Drive (как было) |

---

## Структура репозитория

```
apps-script/Code.gs           — меню, сборка HTML из листов
apps-script/FirebaseHosting.gs  — деплой через Hosting API + SA
build_html_from_cms.py        — та же сборка без Web App
publish-from-google.sh        — CMS → Firebase с Mac
dataroom.css / dataroom-client.js
docs/DATA-SCHEMA.md             — схема листов
docs/DESIGN-EDGE-CASES.md       — запас прочности
```

---

## Быстрый старт (обезличенно)

1. Создайте таблицу с листами по `docs/DATA-SCHEMA.md`.
2. **Расширения → Apps Script** — вставьте `apps-script/Code.gs` и `FirebaseHosting.gs`, `appsscript.json`.
3. Firebase: проект Spark, Hosting, service account → ключ в Drive, `firebase_sa_file_id` в `config`.
4. Меню **DataRoom → Обновить → Опубликовать**.

С Mac (без меню):

```bash
export DATAROOM_SPREADSHEET_ID="YOUR_SPREADSHEET_ID"
export DATAROOM_SHEETS_TOKEN="..."   # или oauth-config.json
cp .firebaserc.example .firebaserc   # подставить project id
# положить .firebase-sa-key.json
bash publish-from-google.sh
```

---

## Безопасность localStorage

Храним **только id** (`link-12`, `portal-main`). URL всегда из HTML страницы — если ссылку убрали из CMS, старый id просто не найдётся. Подменить href через DevTools пользователь может и так; доступ к файлам всё равно на стороне Drive.

---

## Лицензия

MIT — используйте как шаблон под свой портал ссылок.
