(function(){
'use strict';
const AUTO_VERSION='0.5.12.1';

function localToday(){
  const d=new Date(), y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
function frDate(v){
  if(!v)return '';
  const p=v.split('-'); return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:v;
}
function dateForMonth(base,month){
  if(!base||!month)return base||'';
  const day=Number(base.slice(8,10)||1), [y,m]=month.split('-').map(Number);
  const last=new Date(y,m,0).getDate();
  return month+'-'+String(Math.min(day,last)).padStart(2,'0');
}
function ensureScheduleFields(){
  if(document.getElementById('plannedBankDate'))return;
  const anchor=document.getElementById('amount')?.closest('.fields2');
  if(!anchor)return;
  const wrap=document.createElement('div');
  wrap.id='bankScheduleFields';
  wrap.className='fields2';
  wrap.innerHTML='<label><span id="plannedBankDateLabel">Date prévue sur le compte</span><input id="plannedBankDate" type="date"></label><label class="auto-date-label"><span>Automatisation</span><span class="auto-date-check"><input id="autoValidateDate" type="checkbox"> Valider automatiquement ce jour</span><small>Si l’application est fermée, la validation se fera à la prochaine ouverture après cette date.</small></label>';
  anchor.insertAdjacentElement('afterend',wrap);
  const st=document.createElement('style');
  st.textContent='.auto-date-label{display:grid;gap:6px}.auto-date-check{display:flex;gap:7px;align-items:center;font-weight:800}.auto-date-check input{width:auto}.auto-date-label small{color:var(--soft);font-size:.72rem;line-height:1.3}';
  document.head.appendChild(st);
}
function patchVersion(){
  document.title='Mes Comptes · V'+AUTO_VERSION;
  const v=document.querySelector('.top-brand h1 small'); if(v)v.textContent='V'+AUTO_VERSION;
  let badge=document.getElementById('mcVersionBadge');
  if(!badge){badge=document.createElement('div');badge.id='mcVersionBadge';badge.style.cssText='position:fixed;top:calc(env(safe-area-inset-top) + 8px);right:10px;z-index:99999;background:#0b3153;color:#f4c767;border:1px solid #2d6b97;border-radius:999px;padding:5px 9px;font:700 12px system-ui;box-shadow:0 4px 14px #0008';document.body.appendChild(badge);}
  badge.textContent='V'+AUTO_VERSION;
}
function persistOnly(){
  try{state.transactions=categorizeTransactions(state.transactions);}catch(e){}
  localStorage.setItem(KEY,JSON.stringify(state));
}
function markPassed(t,today){
  if(t.type==='income'){
    if(t.incomeStatus==='received')return false;
    t.incomeStatus='received';
  }else if(t.type==='expense'){
    if(expenseRemaining(t)<=0)return false;
    t.debitedAmount=Number(t.amount||0);
  }else return false;
  t.autoValidatedAt=today;
  return true;
}
function runDue(renderAfter){
  const today=localToday();
  let changed=false;
  for(const t of state.transactions||[]){
    if(!t.autoValidate||!t.plannedBankDate||t.plannedBankDate>today||t.autoValidationPaused||t.autoValidatedAt)continue;
    if(markPassed(t,today))changed=true;
  }
  try{
    const projections=projectedTransactions(state.currentMonth)||[];
    for(const p of projections){
      if(!p.autoValidate||!p.plannedBankDate||p.plannedBankDate>today)continue;
      const t=materializeProjected(p);
      if(markPassed(t,today))changed=true;
    }
  }catch(e){}
  if(changed){
    persistOnly();
    if(renderAfter&&typeof render==='function')render();
  }
  return changed;
}
function scheduleRows(rows,baseDate,auto){
  for(const t of rows){
    if(!baseDate){
      delete t.plannedBankDate; delete t.autoValidate; delete t.autoValidatedAt; delete t.autoValidationPaused;
      continue;
    }
    t.plannedBankDate=(rows.length>1||t.recurring||t.installmentGroup)?dateForMonth(baseDate,t.month):baseDate;
    t.autoValidate=!!auto;
    delete t.autoValidatedAt;
    delete t.autoValidationPaused;
  }
}
function patchIncomeMeta(){
  document.querySelectorAll('#incomeList .tx').forEach(row=>{
    const b=row.querySelector('[data-id]'); if(!b)return;
    let t=null; try{t=actionTransaction(b.dataset.id);}catch(e){}
    if(!t?.plannedBankDate)return;
    const meta=row.querySelector('.tx-meta'); if(!meta||meta.dataset.autoDatePatched==='1')return;
    meta.dataset.autoDatePatched='1';
    meta.textContent+=' · réception prévue '+frDate(t.plannedBankDate)+(t.autoValidate?' · automatique':'');
  });
}
const oldProjected=typeof projectedTransactions==='function'?projectedTransactions:null;
if(oldProjected){
  projectedTransactions=function(m){
    const rows=oldProjected(m);
    for(const t of rows)if(t.plannedBankDate)t.plannedBankDate=dateForMonth(t.plannedBankDate,m);
    return rows;
  };
}
const oldTxMeta=typeof txMeta==='function'?txMeta:null;
if(oldTxMeta){
  txMeta=function(t){
    let s=oldTxMeta(t);
    if(t?.plannedBankDate)s+=' · débit prévu '+frDate(t.plannedBankDate)+(t.autoValidate?' · automatique':'');
    return s;
  };
}

ensureScheduleFields();
const oldOpenTx=openTx;
openTx=function(type,t=null){
  oldOpenTx(type,t);
  ensureScheduleFields();
  const input=document.getElementById('plannedBankDate'), auto=document.getElementById('autoValidateDate'), lab=document.getElementById('plannedBankDateLabel');
  if(lab)lab.textContent=type==='income'?'Date prévue de réception':'Date prévue de débit';
  if(input)input.value=t?.plannedBankDate||'';
  if(auto)auto.checked=!!t?.autoValidate;
};

const saveBtn=document.getElementById('saveTx');
const oldSaveClick=saveBtn.onclick;
saveBtn.onclick=function(e){
  const planned=document.getElementById('plannedBankDate')?.value||'';
  const auto=!!document.getElementById('autoValidateDate')?.checked;
  if(auto&&!planned){e.preventDefault();alert('Choisis une date prévue avant d’activer la validation automatique.');return;}
  const editId=document.getElementById('editId')?.value||'';
  const before=new Set((state.transactions||[]).map(t=>t.id));
  oldSaveClick.call(this,e);
  const dlg=document.getElementById('txDialog');
  if(dlg?.open)return;
  let rows=[];
  if(editId){
    const t=state.transactions.find(x=>x.id===editId);
    if(t){
      if(t.seriesId)rows=state.transactions.filter(x=>x.seriesId===t.seriesId);
      else if(t.installmentGroup)rows=state.transactions.filter(x=>x.installmentGroup===t.installmentGroup);
      else rows=[t];
    }
  }else rows=state.transactions.filter(t=>!before.has(t.id));
  if(!rows.length)return;
  scheduleRows(rows,planned,auto);
  runDue(false);
  persistOnly();
  if(typeof render==='function')render();
};

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]'); if(!b)return;
  const a=b.dataset.action;
  if(a!=='unpay'&&a!=='incomeToggle')return;
  let t=null; try{t=actionTransaction(b.dataset.id);}catch(err){}
  if(!t?.autoValidate)return;
  const reversing=(a==='unpay'&&t.type==='expense'&&expenseRemaining(t)<=0)||(a==='incomeToggle'&&t.type==='income'&&t.incomeStatus==='received');
  if(reversing)t.autoValidationPaused=true;
},true);

const oldRender=render;
render=function(){
  runDue(false);
  oldRender();
  patchVersion();
  patchIncomeMeta();
};
window.addEventListener('focus',()=>runDue(true));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')runDue(true)});
setInterval(()=>runDue(true),60000);
runDue(false);
render();
})();