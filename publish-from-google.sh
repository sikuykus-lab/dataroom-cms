#!/bin/bash
# CMS (лист links) → HTML → Firebase. Без Web App и кэша.
set -euo pipefail
cd "$(dirname "$0")"
OAUTH_CFG="${DATAROOM_OAUTH_CONFIG:-oauth-config.json}"
if [[ -z "${DATAROOM_SHEETS_TOKEN:-}" && ! -f "$OAUTH_CFG" ]]; then
  echo "Нет OAuth: положите oauth-config.json или задайте DATAROOM_SHEETS_TOKEN" >&2
  exit 1
fi
if [[ ! -f .firebase-sa-key.json ]]; then
  echo "Нет ключа Firebase SA: dataroom/.firebase-sa-key.json" >&2
  exit 1
fi
python3 build_html_from_cms.py
node <<'NODE'
const fs=require('fs'),crypto=require('crypto'),zlib=require('zlib');
const sa=JSON.parse(fs.readFileSync('.firebase-sa-key.json','utf8'));
function b64url(s){return Buffer.from(s).toString('base64url')}
(async()=>{
  const now=Math.floor(Date.now()/1000),claim={iss:sa.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
  const toSign=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+b64url(JSON.stringify(claim));
  const jwt=toSign+'.'+crypto.createSign('RSA-SHA256').update(toSign).sign(sa.private_key,'base64url');
  const tok=(await(await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})})).json()).access_token;
  const html=fs.readFileSync('firebase-public/index.html'),gz=zlib.gzipSync(html),hash=crypto.createHash('sha256').update(gz).digest('hex');
  const SITE=process.env.FIREBASE_PROJECT_ID||'YOUR_FIREBASE_PROJECT_ID',HOST='https://firebasehosting.googleapis.com/v1beta1';
  const ver=await(await fetch(`${HOST}/sites/${SITE}/versions`,{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({config:{headers:[{glob:'**',headers:{'Cache-Control':'public, max-age=300'}}]}})})).json();
  const vn=ver.name,pop=await(await fetch(`${HOST}/${vn}:populateFiles`,{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({files:{'/index.html':hash}})})).json();
  await fetch(pop.uploadUrl+'/'+hash,{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/gzip'},body:gz});
  await fetch(`${HOST}/${vn}?updateMask=status`,{method:'PATCH',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({status:'FINALIZED'})});
  await fetch(`${HOST}/sites/${SITE}/releases?versionName=${encodeURIComponent(vn)}`,{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:'{}'});
  console.log('https://'+SITE+'.web.app/');
})();
NODE
