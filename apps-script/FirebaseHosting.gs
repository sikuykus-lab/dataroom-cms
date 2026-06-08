/**
 * Деплой HTML на Firebase Hosting из таблицы.
 * Авторизация: service account Firebase (ключ на Drive, config: firebase_sa_file_id).
 * Меню: DataRoom → Обновить сайт → Опубликовать на Firebase
 */
var FB_SITE = "YOUR_FIREBASE_PROJECT_ID";
var FB_HOST = "https://firebasehosting.googleapis.com/v1beta1";
var FB_SA_FILE_ID_FALLBACK = "";

function getFirebaseSaFileId_() {
  if (typeof readConfigFileId_ === "function") {
    var id = readConfigFileId_("firebase_sa_file_id");
    if (id) return id;
  }
  return FB_SA_FILE_ID_FALLBACK;
}

function loadFirebaseServiceAccount_() {
  var id = getFirebaseSaFileId_();
  var json = DriveApp.getFileById(id).getBlob().getDataAsString("UTF-8");
  return JSON.parse(json);
}

function base64Url_(text) {
  return Utilities.base64EncodeWebSafe(text).replace(/=+$/, "");
}

function base64UrlBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

function getFirebaseAccessToken_() {
  var sa = loadFirebaseServiceAccount_();
  var now = Math.floor(Date.now() / 1000);
  var header = { alg: "RS256", typ: "JWT" };
  var claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  var toSign = base64Url_(JSON.stringify(header)) + "." + base64Url_(JSON.stringify(claim));
  var sig = Utilities.computeRsaSha256Signature(toSign, sa.private_key);
  var jwt = toSign + "." + base64UrlBytes_(sig);
  var resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });
  var data = json_(resp);
  if (!data.access_token) {
    throw new Error("SA token: " + JSON.stringify(data));
  }
  return data.access_token;
}

function authorizeFirebaseDeploy_() {
  var check = testFirebaseHostingAccess_();
  if (!check.ok) throw new Error(check.message);
  var msg = "Firebase Hosting: доступ OK.\n\n" + check.message;
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
  return msg;
}

function checkFirebaseDeploySetup_() {
  var check = testFirebaseHostingAccess_();
  var lines = [check.message];
  if (!check.ok) {
    lines.push(
      "Проверьте лист config: firebase_sa_file_id → JSON ключа на Drive.\n" +
        "Файл: firebase-sa-key.json на Drive (доступ только владельцу проекта)."
    );
  }
  SpreadsheetApp.getUi().alert(lines.join("\n\n"));
  return lines.join("\n");
}

function testFirebaseHostingAccess_() {
  var token;
  try {
    token = getFirebaseAccessToken_();
  } catch (e) {
    return { ok: false, message: "Ключ SA: " + e };
  }
  var res = UrlFetchApp.fetch(FB_HOST + "/sites/" + FB_SITE + "/versions?pageSize=1", {
    method: "get",
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code === 200) {
    return { ok: true, message: "API OK: " + FB_SITE + " (versions HTTP 200)." };
  }
  return { ok: false, message: "Тест API HTTP " + code + ":\n" + body.slice(0, 500) };
}

function deployFirebaseHosting_() {
  var html = loadStandaloneHtml_();
  var gzBlob = Utilities.gzip(Utilities.newBlob(html, "text/html", "index.html"));
  var gzBytes = gzBlob.getBytes();
  var hash = sha256Hex_(gzBytes);
  var token = getFirebaseAccessToken_();

  var ver = json_(UrlFetchApp.fetch(FB_HOST + "/sites/" + FB_SITE + "/versions", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ config: { headers: [{ glob: "**", headers: { "Cache-Control": "public, max-age=300" } }] } }),
    muteHttpExceptions: true,
  }));
  if (!ver.name) throw new Error("versions.create: " + JSON.stringify(ver));
  var versionName = ver.name;

  var pop = json_(UrlFetchApp.fetch(FB_HOST + "/" + versionName + ":populateFiles", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ files: { "/index.html": hash } }),
    muteHttpExceptions: true,
  }));
  if (!pop.uploadUrl) throw new Error("populateFiles: " + JSON.stringify(pop));

  var up = UrlFetchApp.fetch(pop.uploadUrl + "/" + hash, {
    method: "post",
    contentType: "application/gzip",
    headers: { Authorization: "Bearer " + token },
    payload: gzBytes,
    muteHttpExceptions: true,
  });
  if (up.getResponseCode() >= 300) throw new Error("upload " + up.getResponseCode() + ": " + up.getContentText());

  json_(UrlFetchApp.fetch(FB_HOST + "/" + versionName + "?updateMask=status", {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ status: "FINALIZED" }),
    muteHttpExceptions: true,
  }));

  var rel = json_(UrlFetchApp.fetch(FB_HOST + "/sites/" + FB_SITE + "/releases?versionName=" + encodeURIComponent(versionName), {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: "{}",
    muteHttpExceptions: true,
  }));
  var url = "https://" + FB_SITE + ".web.app/";
  Logger.log("Live: " + url);
  SpreadsheetApp.getUi().alert("Firebase Hosting\n" + url + "\n\nrelease: " + (rel.name || JSON.stringify(rel)));
  return url;
}

function loadStandaloneHtml_() {
  if (typeof buildDataRoomHtml_ === "function") {
    return buildDataRoomHtml_();
  }
  var cache = CacheService.getScriptCache().get("dataroom_html_v1");
  if (cache) return cache;
  var store = SpreadsheetApp.getActive().getSheetByName("html_store");
  if (store) {
    var cell = store.getRange("A1").getValue();
    if (cell) return String(cell);
  }
  throw new Error("Сначала: DataRoom → Обновить сайт (CMS → HTML)");
}

function sha256Hex_(bytes) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return d.map(function (b) {
    return ("0" + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join("");
}

function json_(res) {
  var t = res.getContentText();
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new Error(t);
  }
}
