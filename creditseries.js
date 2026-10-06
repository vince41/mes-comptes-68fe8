(function(){
'use strict';
const CREDIT_SERIES_VERSION='0.5.29';
const CANCEL_FIELD='seriesCancellations';
let pendingDelete=null;
let activeEditTx=null;

function clean(v){return String(v??'').trim();}
function norm(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function txMonth(t){return clean(t?.month)||clean(t?.date).slice(0,7)||clean(state?.currentMonth);}
function counters(t){
  let index=n(t?.installmentIndex)||n(t?.seriesIndex);
  let total=n(t?.installmentCount)||n(t?.seriesCount);
  if((!index||!total)){
    const s=(clean(t?.note)+' '+clean(t?.label)).toLowerCase();
    let m=s.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
    if(!m)m=s.match(/\b(\d{1,3})\s*(?:sur|sr)\s*(\d{1,3})\b/);
    if(m){index=index||n(m[1]);total=total||n(m[2]);}
  }
  return {index,total};
}
function seriesKey(t){
  if(!t)return'';
  if(t.installmentGroup)return'installment:'+t.installmentGroup;
  if(t.seriesId)return'series:'+t.seriesId;
  const c=counters(t);
  if(c.total>1){
    return'legacy:'+norm(t.label)+'|'+clean(t.owner)+'|'+clean(t.paymentMethod)+'|'+Math.round(n(t.amount)*100)+'|'+c.total;
  }
  if(t.recurring){return'recurring:'+norm(t.label)+'|'+clean(t.owner)+'|'+clean(t.paymentMethod)+'|'+Math.round(n(t.amount)*100);}
  return'';
}
function isSeries(t){
  const c=counters(t);
  return !!seriesKey(t)&&(c.total>1||!!t?.installmentGroup||!!t?.seriesId||!!t?.recurring);
}
function cancellations(){
  if(!Array.isArray(state[CANCEL_FIELD]))state[CANCEL_FIELD]=[];
  return state[CANCEL_FIELD];
}
function markerMatches(t,m){
  if(!t||!m||seriesKey(t)!==m.key)return false;
  const c=counters(t),month=txMonth(t);
  if(m.mode==='one'){
    if(m.index>0&&c.index>0)return c.index===m.index;
    return !!m.month&&month===m.month;
  }
  if(m.mode==='future'){
    if(m.fromIndex>0&&c.index>0)return c.index>=m.fromIndex;
    return !!m.fromMonth&&!!month&&month>=m.fromMonth;
  }
  return false;
}
function suppressed(t){return cancellations().some(m=>markerMatches(t,m));}
function persistAndRender(){
  try{state.transactions=categorizeTransactions(state.transactions);}catch(e){}
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
  if(typeof render==='function')render();
}
function addMarker(marker){
  const list=cancellations();
  const duplicate=list.some(x=>x.mode===marker.mode&&x.key===marker.key&&n(x.index)===n(marker.index)&&n(x.fromIndex)===n(marker.fromIndex)&&clean(x.month)===clean(marker.month)&&clean(x.fromMonth)===clean(marker.fromMonth));
  if(!duplicate)list.push({...marker,createdAt:new Date().toISOString()});
}
function sameSeries(t,key){return seriesKey(t)===key;}
function removeCurrent(t){
  const key=seriesKey(t),c=counters(t),month=txMonth(t);
  if(!key)return false;
  addMarker({mode:'one',key,index:c.index||0,month});
  const before=(state.transactions||[]).length;
  state.transactions=(state.transactions||[]).filter(x=>{
    if(x.id===t.id)return false;
    if(!sameSeries(x,key))return true;
    const xc=counters(x);
    if(c.index>0&&xc.index>0)return xc.index!==c.index;
    return txMonth(x)!==month;
  });
  return state.transactions.length!==before||true;
}
function truncateSeriesMetadata(key,cutIndex){
  if(cutIndex<=1)return;
  const newTotal=cutIndex-1;
  for(const x of state.transactions||[]){
    if(!sameSeries(x,key))continue;
    const xc=counters(x);
    if(xc.index>0&&xc.index<cutIndex){
      if(x.installmentGroup||n(x.installmentCount)>0)x.installmentCount=newTotal;
      if(x.seriesId||n(x.seriesCount)>0)x.seriesCount=newTotal;
    }
  }
}
function removeCurrentAndFuture(t){
  const key=seriesKey(t),c=counters(t),month=txMonth(t);
  if(!key)return false;
  addMarker({mode:'future',key,fromIndex:c.index||0,fromMonth:month});
  state.transactions=(state.transactions||[]).filter(x=>{
    if(!sameSeries(x,key))return true;
    const xc=counters(x);
    if(c.index>0&&xc.index>0)return xc.index<c.index;
    return txMonth(x)<month;
  });
  truncateSeriesMetadata(key,c.index||0);
  return true;
}
function findTx(id){
  let t=(state.transactions||[]).find(x=>x.id===id)||null;
  if(t)return t;
  try{t=(typeof effectiveTransactions==='function'?effectiveTransactions(state.currentMonth):[]).find(x=>x.id===id)||null;}catch(e){}
  return t;
}
function isPaid(t){
  if(!t||t.type!=='expense')return false;
  try{return typeof expenseRemaining==='function'&&expenseRemaining(t)<=0;}catch(e){}
  return n(t.debitedAmount)>=n(t.amount)&&n(t.amount)>0;
}
function remainingText(t,totalOverride=0){
  if(!t)return'';
  const c=counters(t);
  const total=n(totalOverride)||c.total;
  if(total<=1)return'';
  if(c.index>0){
    const remaining=Math.max(0,total-c.index+(isPaid(t)?0:1));
    return'Échéance '+c.index+'/'+total+' · '+remaining+' échéance'+(remaining===1?'':'s')+' restante'+(remaining===1?'':'s');
  }
  return total+' échéances restantes';
}
function appendRemainingMeta(base,t){
  const txt=remainingText(t);
  if(!txt||String(base||'').includes(txt))return base;
  return [base,txt].filter(Boolean).join(' · ');
}

function ensureDialog(){
  if(document.getElementById('seriesDeleteDialog'))return;
  const d=document.createElement('dialog');
  d.id='seriesDeleteDialog';
  d.innerHTML=`<form method="dialog" class="dialog-form" style="max-width:460px">
    <div class="dialog-head"><h3>Supprimer une échéance</h3><button class="icon-btn" value="cancel" aria-label="Fermer">✕</button></div>
    <p id="seriesDeleteText" style="line-height:1.45;margin:.4rem 0 1rem"></p>
    <div style="display:grid;gap:9px">
      <button class="btn" type="button" data-series-delete-choice="one">Supprimer seulement cette échéance</button>
      <button class="btn" type="button" data-series-delete-choice="future" style="border-color:#b94a48">Annuler cette échéance et toutes les suivantes</button>
      <button class="btn primary" value="cancel">Garder le crédit</button>
    </div>
  </form>`;
  document.body.appendChild(d);
}
function openDeleteDialog(t){
  ensureDialog();
  pendingDelete=t;
  const c=counters(t),txt=remainingText(t);
  const p=document.getElementById('seriesDeleteText');
  if(p)p.textContent=(clean(t.label)||'Ce crédit')+(txt?' — '+txt:'')+'. Choisis ce que tu veux réellement supprimer.';
  document.getElementById('seriesDeleteDialog').showModal();
}
function closeDeleteDialog(){
  const d=document.getElementById('seriesDeleteDialog');
  if(d?.open)d.close();
  pendingDelete=null;
}

function findInstallmentCountInput(){
  const ids=['installmentCount','installCount','installments','installmentTotal','installmentMonths','creditInstallments'];
  for(const id of ids){const el=document.getElementById(id);if(el&&el.matches('input,select'))return el;}
  const root=document.getElementById('txDialog')||document;
  const fields=[...root.querySelectorAll('input[type="number"],select')];
  return fields.find(el=>{
    if(el.id==='bankPartCount'||el.id==='amount')return false;
    const lab=el.closest('label');
    const text=(lab?.textContent||'').toLowerCase();
    return /échéance|echeance|mensualit|nombre de mois|paiement.*fois/.test(text);
  })||null;
}
function ensureRemainingHint(){
  let box=document.getElementById('creditRemainingHint');
  if(box)return box;
  const install=document.getElementById('installBox');
  if(!install)return null;
  box=document.createElement('div');
  box.id='creditRemainingHint';
  box.style.cssText='display:none;margin:7px 0 10px;padding:9px 11px;border:1px solid #2d6b97;border-radius:10px;background:#06233b;color:#d9efff;font-size:.8rem;font-weight:800';
  const anchor=install.closest('label')||install.parentElement;
  anchor?.insertAdjacentElement('afterend',box);
  return box;
}
function updateRemainingHint(){
  const box=ensureRemainingHint();if(!box)return;
  const install=document.getElementById('installBox');
  const countEl=findInstallmentCountInput();
  const total=n(countEl?.value)||counters(activeEditTx).total;
  if(!install?.checked||total<=1){box.style.display='none';return;}
  box.style.display='block';
  box.textContent=activeEditTx?remainingText(activeEditTx,total):(total+' échéances restantes au départ');
}

const oldOpenTx=typeof openTx==='function'?openTx:null;
if(oldOpenTx){
  openTx=function(type,t=null){
    activeEditTx=t||null;
    oldOpenTx(type,t);
    setTimeout(updateRemainingHint,0);
  };
}

const oldTxMeta=typeof txMeta==='function'?txMeta:null;
if(oldTxMeta){
  txMeta=function(t){return appendRemainingMeta(oldTxMeta(t),t);};
}

const oldProjected=typeof projectedTransactions==='function'?projectedTransactions:null;
if(oldProjected){
  projectedTransactions=function(m){return oldProjected(m).filter(t=>!suppressed(t));};
}
const oldEffective=typeof effectiveTransactions==='function'?effectiveTransactions:null;
if(oldEffective){
  effectiveTransactions=function(m){return oldEffective(m).filter(t=>!suppressed(t));};
}

document.body.addEventListener('input',e=>{
  if(e.target===document.getElementById('installBox')||e.target===findInstallmentCountInput())updateRemainingHint();
},true);
document.body.addEventListener('change',e=>{
  if(e.target===document.getElementById('installBox')||e.target===findInstallmentCountInput())updateRemainingHint();
},true);

document.body.addEventListener('click',e=>{
  const choice=e.target.closest('[data-series-delete-choice]');
  if(choice){
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    if(!pendingDelete)return closeDeleteDialog();
    const mode=choice.dataset.seriesDeleteChoice;
    if(mode==='future')removeCurrentAndFuture(pendingDelete);else removeCurrent(pendingDelete);
    closeDeleteDialog();
    persistAndRender();
    return;
  }
  const b=e.target.closest('[data-action="delete"]');
  if(!b)return;
  const t=findTx(b.dataset.id);
  if(!t||!isSeries(t))return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  openDeleteDialog(t);
},true);

function patchExistingRows(){
  document.querySelectorAll('.tx').forEach(row=>{
    const b=row.querySelector('[data-id]');if(!b)return;
    const t=findTx(b.dataset.id);if(!t)return;
    const meta=row.querySelector('.tx-meta');if(!meta)return;
    const txt=remainingText(t);if(txt&&!meta.textContent.includes(txt))meta.textContent+=' · '+txt;
  });
}
const oldRender=typeof render==='function'?render:null;
if(oldRender){
  render=function(){oldRender();patchExistingRows();updateRemainingHint();};
}

window.MesComptesCreditSeries={version:CREDIT_SERIES_VERSION,remainingText,removeCurrent,removeCurrentAndFuture};
ensureDialog();
patchExistingRows();
})();
