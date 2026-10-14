(function(){
'use strict';
// V0.5.41 - Suppressions explicites et recherche des échéances.
// Ne réécrit jamais la liste entière d'opérations à l'ouverture.
const JOURNAL='mes-comptes-deletion-journal-v1';
const dateMonth=t=>String(t?.month||t?.debitMonth||t?.date||state.currentMonth||'').slice(0,7);
const clean=v=>String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
const num=v=>Number(v)||0;
const recKey=t=>{
  if(t?.installmentGroup)return'installment:'+t.installmentGroup;
  if(t?.seriesId)return'series:'+t.seriesId;
  const n=num(t?.installmentCount)||num(t?.seriesCount);
  if(n>1)return'legacy:'+clean(t.label).replace(/[^a-z0-9]+/g,' ')+'|'+String(t.owner||'')+'|'+String(t.paymentMethod||'')+'|'+Math.round(num(t.amount)*100)+'|'+n;
  return t?.recurring?'recurring:'+clean(t.label).replace(/[^a-z0-9]+/g,' ')+'|'+String(t.owner||'')+'|'+String(t.paymentMethod||'')+'|'+Math.round(num(t.amount)*100):'';
};
const idx=t=>num(t?.installmentIndex)||num(t?.seriesIndex)||0;
const projectedSignature=t=>[dateMonth(t),clean(t?.label),Math.round(num(t?.amount)*100),String(t?.paymentMethod||''),String(t?.cardOwner||''),String(t?.installmentGroup||t?.seriesId||''),idx(t),String(t?.sourceRow||'')].join('|');
const fourTimes=t=>{
  const n=num(t?.installmentCount)||num(t?.seriesCount);
  const text=String(t?.note||'')+' '+String(t?.label||'');
  return n>=2&&n<=12||!!t?.installmentGroup||/\b[1-9]\s*\/\s*(?:[2-9]|1[012])\b/.test(text)||/\b(?:en\s*)?[234]\s*(?:x|fois)\b/i.test(text);
};
function readJournal(){
  try{const v=JSON.parse(localStorage.getItem(JOURNAL)||'[]');return Array.isArray(v)?v:[];}catch(e){return[];}
}
let tombstoneCache=null;
function tombstones(){
  if(tombstoneCache)return tombstoneCache;
  const map=new Map();
  for(const t of [...readJournal(),...(Array.isArray(state.operationTombstones)?state.operationTombstones:[])]){
    if(t&&(t.id||t.signature))map.set(String(t.id||'')+'|'+String(t.signature||''),t);
  }
  tombstoneCache=[...map.values()];
  return tombstoneCache;
}
function reconcileJournal(){
  tombstoneCache=null;
  const rows=tombstones();
  if(!Array.isArray(state.operationTombstones)||state.operationTombstones.length!==rows.length){
    state.operationTombstones=rows;
  }
  try{localStorage.setItem(JOURNAL,JSON.stringify(rows));}catch(e){}
  return rows;
}
function isDeleted(t){
  if(!t)return false;
  const id=String(t.id||''),sig=t.projected?projectedSignature(t):'';
  for(const d of tombstones()){
    if(id&&d.id===id)return true;
    if(sig&&d.signature===sig)return true;
  }
  return false;
}
const oldEffective=effectiveTransactions;
effectiveTransactions=function(m){return oldEffective(m).filter(t=>!isDeleted(t));};
const oldProjected=projectedTransactions;
projectedTransactions=function(m){return oldProjected(m).filter(t=>!isDeleted(t));};
function persist(){
  state.operationTombstones=tombstones();
  try{localStorage.setItem(JOURNAL,JSON.stringify(state.operationTombstones));}catch(e){}
  // Même clé que l'app : la synchronisation existante voit la modification.
  try{state.transactions=categorizeTransactions(state.transactions);}catch(e){}
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
  if(typeof render==='function')render();
}
function markOne(t){
  if(!t)return;
  const row={id:String(t.id||''),signature:t.projected?projectedSignature(t):'',at:new Date().toISOString()};
  if(!Array.isArray(state.operationTombstones))state.operationTombstones=[];
  if(!state.operationTombstones.some(d=>d.id===row.id&&d.signature===row.signature))state.operationTombstones.push(row);
  tombstoneCache=null;
}
function markSeries(t,mode){
  const key=recKey(t);
  if(!key)return;
  if(!Array.isArray(state.seriesCancellations))state.seriesCancellations=[];
  const i=idx(t),m=dateMonth(t);
  const marker=mode==='future'?{mode:'future',key,fromIndex:i,fromMonth:m}:{mode:'one',key,index:i,month:m};
  if(!state.seriesCancellations.some(x=>x.key===key&&x.mode===marker.mode&&
      (x.index||0)===(marker.index||0)&&(x.fromIndex||0)===(marker.fromIndex||0)&&
      String(x.month||'')===String(marker.month||'')&&String(x.fromMonth||'')===String(marker.fromMonth||''))){
    state.seriesCancellations.push({...marker,createdAt:new Date().toISOString()});
  }
}
function removeOperation(t,allFollowing=false){
  // Garder une copie de récupération du compte AVANT une suppression.
  try{localStorage.setItem('mes-comptes-backup-before-delete-v0541',
    JSON.stringify({at:new Date().toISOString(),state}));}catch(e){}
  const key=recKey(t),i=idx(t),m=dateMonth(t);
  const selected=(state.transactions||[]).filter(x=>{
    if(x.id===t.id)return true;
    if(!allFollowing||!key||recKey(x)!==key)return false;
    if(i&&idx(x))return idx(x)>=i;
    return dateMonth(x)>=m;
  });
  for(const x of selected)markOne(x);
  markOne(t);
  if(key)markSeries(t,allFollowing?'future':'one');
  const ids=new Set(selected.map(x=>String(x.id||'')));
  state.transactions=(state.transactions||[]).filter(x=>!ids.has(String(x.id||'')));
  persist();
}
function findById(id){
  const row=(state.transactions||[]).find(t=>String(t.id)===String(id));
  if(row)return row;
  const cur=String(state.currentMonth||'');
  return (effectiveTransactions(cur)||[]).find(t=>String(t.id)===String(id))||null;
}
function ensureDeleteDialog(){
  let d=document.getElementById('mcSafeDeleteDialog');
  if(d)return d;
  d=document.createElement('dialog');d.id='mcSafeDeleteDialog';
  d.style.cssText='box-sizing:border-box;width:min(92vw,470px);border:1px solid #4c89a8;border-radius:16px;background:#09263e;color:#f1f8ff;padding:20px;box-shadow:0 20px 60px #000b';
  d.innerHTML='<h3 style="margin:0 0 10px">Supprimer une opération</h3><p id="mcSafeDeleteInfo"></p><div style="display:grid;gap:9px"><button type="button" id="mcSafeDelOne">Supprimer cette échéance</button><button type="button" id="mcSafeDelFuture">Supprimer cette échéance et les suivantes</button><button type="button" id="mcSafeDelCancel">Annuler</button></div>';
  document.body.appendChild(d);
  for(const b of d.querySelectorAll('button'))b.style.cssText='font:750 14px system-ui;border:1px solid #5b8ca4;border-radius:10px;background:#134361;color:white;padding:11px;cursor:pointer';
  d.querySelector('#mcSafeDelCancel').onclick=()=>d.close();
  return d;
}
function askDelete(t){
  const d=ensureDeleteDialog(),series=!!recKey(t);
  const p=d.querySelector('#mcSafeDeleteInfo');
  p.textContent=String(t.label||'Dépense')+' · '+dateMonth(t)+' · '+Number(t.amount||0).toFixed(2)+' €.'+
    (t.projected?' Cette opération est une prévision automatique.':'');
  d.querySelector('#mcSafeDelFuture').style.display=series?'':'none';
  d.querySelector('#mcSafeDelOne').textContent=series?'Supprimer cette échéance':'Supprimer cette opération';
  d.querySelector('#mcSafeDelOne').onclick=()=>{d.close();removeOperation(t,false);};
  d.querySelector('#mcSafeDelFuture').onclick=()=>{d.close();removeOperation(t,true);};
  d.showModal();
}
function addDeleteButtons(root=document){
  for(const row of root.querySelectorAll('.tx')){
    const actions=row.querySelector('.tx-actions'),existing=row.querySelector('[data-id]');
    if(!actions||!existing||actions.querySelector('[data-action="delete"],[data-action="mcSafeDelete"]'))continue;
    const b=document.createElement('button');
    b.type='button';b.dataset.action='mcSafeDelete';b.dataset.id=existing.dataset.id;
    b.textContent='🗑 Supprimer';
    actions.appendChild(b);
  }
}
const oldRenderExpenses=renderExpenses;
renderExpenses=function(id,arr){
  oldRenderExpenses(id,arr);
  const root=document.getElementById(id);
  if(root)addDeleteButtons(root);
};
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-action="delete"],[data-action="mcSafeDelete"]');
  if(!btn||!btn.closest('.tx'))return;
  const t=findById(btn.dataset.id);
  if(!t)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  askDelete(t);
},true);
// Chercher des échéances existantes dans TOUS les mois, même déplacées.
// Lecture seule : ce diagnostic ne crée aucune opération.
function ensureFinder(){
  const anchor=document.querySelector('#accountsView .filters')||document.querySelector('#accountsView .grid');
  if(!anchor||document.getElementById('mcFindInstallments'))return;
  const b=document.createElement('button');b.type='button';b.id='mcFindInstallments';b.className='btn';
  b.textContent='🔎 Retrouver mes paiements 4×';
  b.style.cssText='margin:10px 0;padding:10px;font-weight:800';
  anchor.appendChild(b);b.onclick=openFinder;
}
function openFinder(){
  let d=document.getElementById('mcFindInstallmentsDialog');
  if(!d){
    d=document.createElement('dialog');d.id='mcFindInstallmentsDialog';
    d.style.cssText='box-sizing:border-box;width:min(96vw,680px);max-height:85vh;overflow:auto;background:#08273d;color:white;border:1px solid #629ab7;border-radius:15px;padding:17px';
    d.innerHTML='<div style="display:flex;gap:8px;justify-content:space-between"><strong>Mes paiements en plusieurs fois enregistrés</strong><button type="button" id="mcFindClose">Fermer</button></div><p id="mcFindDescription"></p><div id="mcFindResults" style="display:grid;gap:8px"></div>';
    document.body.appendChild(d);
    d.querySelector('#mcFindClose').onclick=()=>d.close();
    d.addEventListener('click',e=>{
      const b=e.target.closest('[data-mc-view-month]');
      if(!b)return;
      state.currentMonth=b.dataset.mcViewMonth;
      d.close();render();
    });
  }
  const rows=(state.transactions||[]).filter(t=>t.type==='expense'&&fourTimes(t));
  const sorted=[...rows].sort((a,b)=>dateMonth(a).localeCompare(dateMonth(b))||(a.label||'').localeCompare(b.label||''));
  d.querySelector('#mcFindDescription').textContent=rows.length+
    ' ligne(s) de paiement en plusieurs fois détectée(s) dans les données du compte, tous mois confondus. Les opérations supprimées sont exclues.';
  const wrap=d.querySelector('#mcFindResults');wrap.replaceChildren();
  let visible=0;
  for(const t of sorted){
    if(isDeleted(t))continue;
    const month=dateMonth(t);if(!/^\d{4}-\d{2}$/.test(month))continue;
    visible++;
    const box=document.createElement('div');box.style.cssText='display:grid;gap:4px;padding:9px;border:1px solid #346485;border-radius:9px';
    const desc=document.createElement('span');
    desc.textContent=month+' · '+String(t.label||'Sans libellé')+' · '+Number(t.amount||0).toFixed(2)+' € · '+(t.paymentMethod==='card_deferred'?'Carte '+String(t.cardOwner||t.owner||''):'Prélèvement compte')+' · '+(t.installmentIndex||t.seriesIndex||'?')+'/'+(t.installmentCount||t.seriesCount||'?');
    const btn=document.createElement('button');btn.type='button';btn.dataset.mcViewMonth=month;btn.textContent='Voir le mois '+month;
    btn.style.cssText='max-width:max-content;padding:8px;border:1px solid #5a9fc3;background:#124d70;color:#fff;border-radius:8px';
    box.append(desc,btn);wrap.appendChild(box);
  }
  if(!visible){
    const info=document.createElement('p');info.textContent='Aucune échéance 4× encore visible dans les opérations actuellement enregistrées. Ne les recrée pas en double : vérifie les sauvegardes ci-dessous.';
    wrap.appendChild(info);
  }
  // Diagnostics de récupération en lecture seule : on n'importe ni ne remplace jamais les comptes automatiquement.
  for(const key of ['mes-comptes-backup-before-delete-v0541','mes-comptes-backup-before-sync-v0541','mes-comptes-backup-before-v0534']){
    let b=null;
    try{const raw=JSON.parse(localStorage.getItem(key)||'null');b=raw?.state||raw;}catch(e){}
    const saved=Array.isArray(b?.transactions)?b.transactions.filter(t=>t.type==='expense'&&fourTimes(t)):[];
    if(!saved.length)continue;
    const title=document.createElement('strong');
    title.textContent=(key.includes('before-delete')?'Sauvegarde avant suppression':key.includes('sync')?'Sauvegarde avant synchronisation':'Sauvegarde ancienne')+' · '+saved.length+' échéance(s) dans cette copie (consultation seulement)';
    title.style.marginTop='12px';wrap.appendChild(title);
    for(const t of saved.slice(0,80)){
      const line=document.createElement('div');line.style.cssText='padding:7px;border:1px dashed #527c91;border-radius:8px;font-size:.86rem';
      line.textContent=dateMonth(t)+' · '+String(t.label||'Sans libellé')+' · '+Number(t.amount||0).toFixed(2)+' € · '+(t.paymentMethod==='card_deferred'?'Carte '+String(t.cardOwner||t.owner||''):'Prélèvement compte');
      wrap.appendChild(line);
    }
    if(saved.length>80){const p=document.createElement('p');p.textContent='80 premières lignes sur '+saved.length+' affichées.';wrap.appendChild(p);}
  }
  d.showModal();
}
const oldRender=render;
render=function(){oldRender();ensureFinder();addDeleteButtons();};
reconcileJournal();
window.addEventListener('mescomptes:remote-sync',()=>{
  tombstoneCache=null;
  reconcileJournal();
});
render();
})();