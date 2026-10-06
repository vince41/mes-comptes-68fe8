(function(){
'use strict';

const SYNC_VERSION='0.5.33';
const FIREBASE_CONFIG={
  apiKey:'AIzaSyDSSVTMzZ-0ApuChCuocpX0kc0AGb9dxAQ',
  authDomain:'famille-tdah.firebaseapp.com',
  projectId:'famille-tdah',
  databaseURL:'https://famille-tdah-default-rtdb.europe-west1.firebasedatabase.app'
};
const FAMILY_ID='f_7ed42a9c86b146bc9bb2c012dad596a2';
const SECRET_KEY='mes-comptes-sync-secret-v1';
const ROLE_KEY='mes-comptes-sync-role-v1';
const WRITER_KEY='mes-comptes-sync-writer-v1';
const DIRTY_KEY='mes-comptes-sync-dirty-v1';
const CHANGE_KEY='mes-comptes-sync-change-at-v1';
const LAST_REMOTE_KEY='mes-comptes-sync-last-remote-at-v1';
const EXTRA_KEYS=[
  'mes-comptes-custom-categories',
  'mes-comptes-category-rules-v3'
];

let applyingRemote=false;
let connected=false;
let connecting=false;
let remoteRef=null;
let secret='';
let secretBytes=null;
let writerId=localStorage.getItem(WRITER_KEY)||makeId();
let pushTimer=0;
let lastPushedAt=0;
let storageHooked=false;
let initialSnapshotHandled=false;

localStorage.setItem(WRITER_KEY,writerId);

function makeId(){
  try{return crypto.randomUUID()}catch(e){
    const b=new Uint8Array(16);crypto.getRandomValues(b);
    return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
}
function now(){return Date.now();}
function cleanCode(v){return String(v||'').toUpperCase().replace(/^MC-/,'').replace(/[^A-Z2-7]/g,'');}
function formatCode(v){
  const s=cleanCode(v);
  return 'MC-'+(s.match(/.{1,4}/g)||[]).join('-');
}
function bytesToHex(bytes){return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
function b64(bytes){
  let s=''; for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(s);
}
function unb64(s){
  const raw=atob(String(s||'')),out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
  return out;
}
function textBytes(s){return new TextEncoder().encode(String(s));}
function bytesText(b){return new TextDecoder().decode(b);}

function randomCode(){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const b=new Uint8Array(16);crypto.getRandomValues(b);
  let bits=0,value=0,out='';
  for(const x of b){
    value=(value<<8)|x;bits+=8;
    while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}
  }
  if(bits>0)out+=alphabet[(value<<(5-bits))&31];
  return out;
}
async function digestBytes(s){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',textBytes(s)));
}
async function deriveSecret(code){
  const normalized=cleanCode(code);
  const hash=await digestBytes('mes-comptes-sync-v1|'+normalized);
  return {code:normalized,key:await crypto.subtle.importKey('raw',hash,{name:'AES-GCM'},false,['encrypt','decrypt'])};
}
async function houseIdFor(code){
  const h=await digestBytes('mes-comptes-house-v1|'+cleanCode(code));
  return bytesToHex(h).slice(0,32);
}
async function encryptBundle(bundle,key){
  const iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const plain=textBytes(JSON.stringify(bundle));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain));
  return {iv:b64(iv),ciphertext:b64(cipher)};
}
async function decryptBundle(payload,key){
  const iv=unb64(payload.iv),cipher=unb64(payload.ciphertext);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,cipher);
  return JSON.parse(bytesText(new Uint8Array(plain)));
}

function cloneStateForSync(){
  let copy={};
  try{copy=JSON.parse(JSON.stringify(state||{}));}catch(e){}
  delete copy.currentMonth;
  return copy;
}
function buildBundle(){
  const extras={};
  for(const k of EXTRA_KEYS){
    const v=localStorage.getItem(k);
    if(v!==null)extras[k]=v;
  }
  return {schema:1,state:cloneStateForSync(),extras,exportedAt:new Date().toISOString()};
}
function applyBundle(bundle){
  if(!bundle||typeof bundle!=='object'||!bundle.state||typeof bundle.state!=='object')return false;
  const keepMonth=state&&state.currentMonth;
  applyingRemote=true;
  try{
    for(const k of Object.keys(state||{}))delete state[k];
    Object.assign(state,bundle.state);
    if(keepMonth)state.currentMonth=keepMonth;
    if(bundle.extras&&typeof bundle.extras==='object'){
      for(const k of EXTRA_KEYS){
        if(Object.prototype.hasOwnProperty.call(bundle.extras,k))localStorage.setItem(k,String(bundle.extras[k]));
      }
    }
    localStorage.setItem(KEY,JSON.stringify(state));
    localStorage.setItem(DIRTY_KEY,'0');
    try{if(typeof render==='function')render();}catch(e){console.warn('Mes Comptes sync render',e);}
    try{window.dispatchEvent(new CustomEvent('mescomptes:remote-sync',{detail:{at:now()}}));}catch(e){}
    return true;
  }finally{
    applyingRemote=false;
  }
}

function dirty(){
  return localStorage.getItem(DIRTY_KEY)==='1';
}
function markDirty(){
  if(applyingRemote)return;
  localStorage.setItem(DIRTY_KEY,'1');
  localStorage.setItem(CHANGE_KEY,String(now()));
}
function schedulePush(){
  if(!connected||!remoteRef||!secretBytes||applyingRemote)return;
  clearTimeout(pushTimer);
  pushTimer=setTimeout(()=>pushNow('local-change'),350);
}
function watchedKey(k){
  return k===KEY||EXTRA_KEYS.includes(k);
}
function installStorageHook(){
  if(storageHooked)return; storageHooked=true;
  const set=Storage.prototype.setItem;
  const remove=Storage.prototype.removeItem;
  Storage.prototype.setItem=function(k,v){
    const r=set.call(this,k,v);
    if(this===localStorage&&watchedKey(String(k))&&!applyingRemote){
      markDirty();schedulePush();
    }
    return r;
  };
  Storage.prototype.removeItem=function(k){
    const r=remove.call(this,k);
    if(this===localStorage&&watchedKey(String(k))&&!applyingRemote){
      markDirty();schedulePush();
    }
    return r;
  };
}

function setStatus(kind,msg){
  ensureUi();
  const b=document.getElementById('mcSyncBadge');
  if(!b)return;
  b.dataset.kind=kind;
  const prefix=kind==='ok'?'☁':kind==='busy'?'↻':kind==='off'?'☁':'⚠';
  b.textContent=prefix+' '+msg;
}
function toast(msg){
  const n=document.createElement('div');n.textContent=msg;
  n.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:100002;background:#082f50;color:#fff;border:1px solid #2d6b97;border-radius:12px;padding:9px 12px;font:750 13px system-ui;box-shadow:0 7px 20px #0008;max-width:92vw;text-align:center';
  document.body.appendChild(n);setTimeout(()=>n.remove(),2600);
}

function ensureUi(){
  if(document.getElementById('mcSyncBadge'))return;
  const st=document.createElement('style');
  st.textContent=`
  #mcSyncBadge{position:fixed;top:calc(env(safe-area-inset-top) + 8px);left:10px;z-index:99999;border:1px solid #2d6b97;border-radius:999px;padding:5px 9px;background:#0b3153;color:#dff5ff;font:750 12px system-ui;box-shadow:0 4px 14px #0008;cursor:pointer}
  #mcSyncBadge[data-kind="ok"]{border-color:#368b65;color:#bff2d5}
  #mcSyncBadge[data-kind="error"]{border-color:#b85a5a;color:#ffd1d1}
  #mcSyncDialog{border:1px solid #285d80;border-radius:16px;background:#071f33;color:#fff;max-width:520px;width:min(92vw,520px);box-shadow:0 20px 70px #000b;padding:0}
  #mcSyncDialog::backdrop{background:#0009}
  #mcSyncDialog .mc-sync-wrap{padding:18px;display:grid;gap:14px;font:14px/1.45 system-ui}
  #mcSyncDialog h3{margin:0;font-size:1.15rem}
  #mcSyncDialog p{margin:0;color:#c5dcec}
  #mcSyncDialog .mc-code{font:800 15px ui-monospace,monospace;letter-spacing:.03em;padding:10px;border:1px solid #2d6b97;border-radius:10px;background:#041624;word-break:break-all}
  #mcSyncDialog input{box-sizing:border-box;width:100%;padding:11px;border-radius:10px;border:1px solid #2d6b97;background:#031827;color:#fff;font:700 15px system-ui}
  #mcSyncDialog .mc-actions{display:flex;gap:8px;flex-wrap:wrap}
  #mcSyncDialog button{border:1px solid #2d6b97;background:#0b3153;color:#fff;border-radius:10px;padding:9px 11px;font-weight:800;cursor:pointer}
  #mcSyncDialog button.primary{background:#17679b;border-color:#2e8dcc}
  #mcSyncDialog button.danger{background:#4c1f28;border-color:#82404d}
  #mcSyncDialog small{color:#9fc3da}
  `;
  document.head.appendChild(st);
  const b=document.createElement('button');
  b.id='mcSyncBadge';b.type='button';b.dataset.kind='off';b.textContent='☁ Hors synchro';
  b.addEventListener('click',openSyncDialog);
  document.body.appendChild(b);

  const d=document.createElement('dialog');d.id='mcSyncDialog';
  d.innerHTML='<div class="mc-sync-wrap"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h3>Synchronisation familiale</h3><button type="button" id="mcSyncClose">✕</button></div><div id="mcSyncBody"></div></div>';
  document.body.appendChild(d);
  d.querySelector('#mcSyncClose').onclick=()=>d.close();
}
function renderSyncDialog(){
  const body=document.getElementById('mcSyncBody');if(!body)return;
  const saved=localStorage.getItem(SECRET_KEY)||'';
  if(saved){
    body.innerHTML=`
      <div style="display:grid;gap:12px">
        <p>Ce téléphone est relié au foyer partagé. Les dépenses, revenus, crédits, épargne et catégories sont synchronisés en direct.</p>
        <div><small>Code foyer</small><div class="mc-code">${escapeHtml(formatCode(saved))}</div></div>
        <div class="mc-actions"><button class="primary" type="button" id="mcCopyCode">Copier le code</button><button type="button" id="mcSyncNow">Synchroniser maintenant</button><button class="danger" type="button" id="mcLeaveSync">Retirer ce téléphone</button></div>
        <small>Le code sert aussi de clé de chiffrement. Ne le publie pas.</small>
      </div>`;
    body.querySelector('#mcCopyCode').onclick=async()=>{
      try{await navigator.clipboard.writeText(formatCode(saved));toast('Code foyer copié.');}
      catch(e){toast('Copie impossible : sélectionne le code manuellement.');}
    };
    body.querySelector('#mcSyncNow').onclick=()=>{markDirty();pushNow('manual');};
    body.querySelector('#mcLeaveSync').onclick=()=>{
      if(!confirm('Retirer ce téléphone du foyer partagé ? Les données locales restent sur ce téléphone.'))return;
      disconnect();
      localStorage.removeItem(SECRET_KEY);localStorage.removeItem(ROLE_KEY);
      localStorage.removeItem(DIRTY_KEY);localStorage.removeItem(CHANGE_KEY);localStorage.removeItem(LAST_REMOTE_KEY);
      setStatus('off','Hors synchro');renderSyncDialog();
    };
    return;
  }
  body.innerHTML=`
    <div style="display:grid;gap:14px">
      <p><strong>Sur ton téléphone :</strong> crée le foyer une seule fois, puis envoie le code à ta femme.</p>
      <div class="mc-actions"><button class="primary" type="button" id="mcCreateSync">Créer le foyer partagé</button></div>
      <div style="border-top:1px solid #ffffff22;padding-top:12px;display:grid;gap:9px">
        <p><strong>Sur le téléphone de ta femme :</strong> colle le code reçu.</p>
        <input id="mcJoinCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="MC-XXXX-XXXX-XXXX-XXXX">
        <div class="mc-actions"><button type="button" id="mcJoinSync">Rejoindre le foyer</button></div>
      </div>
      <small>Les données envoyées à Firebase sont chiffrées sur le téléphone avant l’envoi.</small>
    </div>`;
  body.querySelector('#mcCreateSync').onclick=async()=>{
    const code=randomCode();
    localStorage.setItem(SECRET_KEY,code);localStorage.setItem(ROLE_KEY,'creator');
    renderSyncDialog();setStatus('busy','Connexion…');
    await connect('creator');
    toast('Foyer créé. Copie le code pour ta femme.');
  };
  body.querySelector('#mcJoinSync').onclick=async()=>{
    const input=cleanCode(body.querySelector('#mcJoinCode').value);
    if(input.length<20){alert('Le code foyer est incomplet.');return;}
    localStorage.setItem(SECRET_KEY,input);localStorage.setItem(ROLE_KEY,'joiner');
    renderSyncDialog();setStatus('busy','Connexion…');
    const ok=await connect('joiner');
    if(!ok){
      disconnect();
      localStorage.removeItem(SECRET_KEY);localStorage.removeItem(ROLE_KEY);
      setStatus('error','Code invalide');renderSyncDialog();
    }
  };
}
function openSyncDialog(){
  ensureUi();renderSyncDialog();
  const d=document.getElementById('mcSyncDialog');
  try{d.showModal();}catch(e){d.setAttribute('open','');}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function loadScript(src,id){
  if(document.getElementById(id))return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');s.id=id;s.src=src;s.async=true;
    s.onload=resolve;s.onerror=()=>reject(new Error('Chargement Firebase impossible'));
    document.head.appendChild(s);
  });
}
async function ensureFirebase(){
  if(!window.firebase?.apps){
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','mcFirebaseApp');
  }
  if(!window.firebase?.auth){
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js','mcFirebaseAuth');
  }
  if(!window.firebase?.database){
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js','mcFirebaseDb');
  }
  if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);
  try{await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);}catch(e){}
  if(!firebase.auth().currentUser)await firebase.auth().signInAnonymously();
}
function disconnect(){
  connected=false;connecting=false;initialSnapshotHandled=false;
  clearTimeout(pushTimer);
  if(remoteRef){try{remoteRef.off();}catch(e){}}
  remoteRef=null;secret='';secretBytes=null;
}

async function connect(requestedRole){
  if(connecting)return false;
  const saved=cleanCode(localStorage.getItem(SECRET_KEY)||'');
  if(!saved){setStatus('off','Hors synchro');return false;}
  connecting=true;initialSnapshotHandled=false;
  try{
    setStatus('busy','Connexion…');
    if(!window.crypto?.subtle)throw new Error('Chiffrement indisponible sur ce navigateur');
    const derived=await deriveSecret(saved);secret=derived.code;secretBytes=derived.key;
    const houseId=await houseIdFor(saved);
    await ensureFirebase();
    remoteRef=firebase.database().ref('/families/'+FAMILY_ID+'/mesComptes/'+houseId);
    connected=true;connecting=false;
    const role=requestedRole||localStorage.getItem(ROLE_KEY)||'joiner';

    const first=await remoteRef.once('value');
    const initial=first.val();
    if(!initial||!initial.ciphertext){
      if(role==='creator'){
        markDirty();
        await pushNow('initial');
        setStatus('ok','Synchronisé');
      }else{
        setStatus('error','Code inconnu');
        alert('Aucun foyer ne correspond à ce code. Vérifie le code envoyé depuis le téléphone principal.');
        return false;
      }
    }else{
      const localAt=Number(localStorage.getItem(CHANGE_KEY)||0);
      const remoteAt=Number(initial.clientUpdatedAt||initial.updatedAt||0);
      if(dirty()&&localAt>remoteAt){
        await pushNow('reconnect-local-newer');
      }else{
        await receiveRemote(initial,true);
      }
    }

    remoteRef.on('value',snap=>{
      const payload=snap.val();
      if(!payload||!payload.ciphertext)return;
      receiveRemote(payload,false).catch(err=>{console.error(err);setStatus('error','Erreur synchro');});
    },err=>{console.error(err);setStatus('error','Synchro refusée');});
    initialSnapshotHandled=true;
    return true;
  }catch(e){
    console.error('Mes Comptes sync connect',e);
    connecting=false;connected=false;
    setStatus('error','Synchro indisponible');
    return false;
  }
}
async function receiveRemote(payload,force){
  if(!connected||!secretBytes||!payload?.ciphertext)return;
  if(!force&&payload.writerId===writerId&&Number(payload.clientUpdatedAt||0)===lastPushedAt){
    setStatus('ok','Synchronisé');return;
  }
  const remoteAt=Number(payload.clientUpdatedAt||payload.updatedAt||0);
  const lastSeen=Number(localStorage.getItem(LAST_REMOTE_KEY)||0);
  if(!force&&remoteAt&&remoteAt<=lastSeen)return;
  try{
    const bundle=await decryptBundle(payload,secretBytes);
    if(applyBundle(bundle)){
      localStorage.setItem(LAST_REMOTE_KEY,String(remoteAt||now()));
      setStatus('ok','Synchronisé');
    }
  }catch(e){
    console.error('Mes Comptes sync decrypt',e);
    setStatus('error','Code incorrect');
  }
}
async function pushNow(reason){
  if(!connected||!remoteRef||!secretBytes||applyingRemote)return false;
  clearTimeout(pushTimer);
  try{
    setStatus('busy','Synchronisation…');
    const changedAt=Number(localStorage.getItem(CHANGE_KEY)||now());
    const enc=await encryptBundle(buildBundle(),secretBytes);
    lastPushedAt=Math.max(changedAt,now());
    const payload={
      schema:1,
      writerId,
      clientUpdatedAt:lastPushedAt,
      updatedAt:firebase.database.ServerValue.TIMESTAMP,
      iv:enc.iv,
      ciphertext:enc.ciphertext
    };
    await remoteRef.set(payload);
    applyingRemote=true;
    try{
      localStorage.setItem(DIRTY_KEY,'0');
      localStorage.setItem(LAST_REMOTE_KEY,String(lastPushedAt));
    }finally{applyingRemote=false;}
    setStatus('ok','Synchronisé');
    return true;
  }catch(e){
    console.error('Mes Comptes sync push',reason,e);
    setStatus('error','Hors ligne');
    return false;
  }
}

function boot(){
  ensureUi();
  installStorageHook();
  const saved=localStorage.getItem(SECRET_KEY);
  if(saved){
    setStatus('busy','Connexion…');
    connect(localStorage.getItem(ROLE_KEY)||'joiner');
  }else setStatus('off','Hors synchro');
  window.addEventListener('online',()=>{
    if(localStorage.getItem(SECRET_KEY)&&!connected)connect(localStorage.getItem(ROLE_KEY)||'joiner');
    else if(connected&&dirty())schedulePush();
  });
  window.addEventListener('offline',()=>setStatus('error','Hors ligne'));
}

window.MesComptesRealtimeSync={
  version:SYNC_VERSION,
  connect,
  pushNow,
  open:openSyncDialog,
  status:()=>({connected,writerId,configured:!!localStorage.getItem(SECRET_KEY)})
};

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();