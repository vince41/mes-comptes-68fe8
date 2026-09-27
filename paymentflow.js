(function(){
'use strict';
const PAYMENT_FLOW_VERSION='0.5.20';

function money(v){return Math.round(Number(v||0)*100)/100;}
function num(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0;}
function ensureCompteOption(){
  const owner=document.getElementById('owner');
  if(owner&&!owner.querySelector('option[value="Compte"]')){
    const o=document.createElement('option');o.value='Compte';o.textContent='Compte courant';owner.appendChild(o);
  }
}
function sourceFromTx(t){
  if(t?.paymentMethod==='card_deferred'){
    if(t.cardOwner==='Lili'||t.owner==='Lili')return 'card_lili';
    return 'card_vincent';
  }
  return 'account_direct';
}
function buildParts(amount,count){
  const total=Math.round(Number(amount||0)*100),n=Math.max(1,Math.min(24,Number(count||1)));
  let remain=total;const out=[];
  for(let i=0;i<n;i++){const c=i===n-1?remain:Math.round(total/n);remain-=c;out.push(c/100);}
  return out;
}
function passedCount(t){
  const parts=Array.isArray(t?.debitPartAmounts)&&t.debitPartAmounts.length? t.debitPartAmounts:buildParts(t?.amount,t?.debitPartCount||1);
  const paid=money(t?.debitedAmount||0);let sum=0,count=0;
  for(const p of parts){if(money(sum+p)<=paid+0.011){sum=money(sum+p);count++;}else break;}
  return count;
}
function syncBackendFields(){
  const source=document.getElementById('debitSource')?.value||'account_direct';
  const amount=money(num(document.getElementById('amount')?.value));
  const pm=document.getElementById('paymentMethod'),owner=document.getElementById('owner');
  const sv=document.getElementById('splitV'),sl=document.getElementById('splitL');
  ensureCompteOption();
  if(source==='card_vincent'){
    if(pm)pm.value='card_deferred';if(owner)owner.value='Vincent';
    if(sv)sv.value=amount?String(amount):'';if(sl)sl.value='';
  }else if(source==='card_lili'){
    if(pm)pm.value='card_deferred';if(owner)owner.value='Lili';
    if(sv)sv.value='';if(sl)sl.value=amount?String(amount):'';
  }else{
    if(pm)pm.value='direct_debit';if(owner)owner.value='Compte';
    if(sv)sv.value='';if(sl)sl.value='';
  }
}
function updatePartPreview(){
  const count=Math.max(1,Number(document.getElementById('debitPartCount')?.value||1));
  const amount=money(num(document.getElementById('amount')?.value));
  const p=document.getElementById('debitPartPreview');
  if(!p)return;
  if(count<=1||!amount){p.textContent='Un seul passage à valider sur le compte.';return;}
  const parts=buildParts(amount,count);
  p.textContent=count+' passages à valider : '+parts.map(x=>euro.format(x)).join(' + ')+'.';
}
function updateDebitMonthFromSource(){
  const source=document.getElementById('debitSource')?.value||'account_direct';
  const month=document.getElementById('debitMonth');
  if(!month)return;
  if(source==='account_direct'){month.value=state.currentMonth;return;}
  const date=document.getElementById('date')?.value;
  const who=source==='card_lili'?'Lili':'Vincent';
  if(date&&typeof predictedDebitMonth==='function')month.value=predictedDebitMonth(date,who);
}
function ensureFields(){
  ensureCompteOption();
  if(document.getElementById('debitSource'))return;
  const pm=document.getElementById('paymentMethod'),owner=document.getElementById('owner');
  if(!pm||!owner)return;
  const row=pm.closest('.fields2');
  if(!row)return;
  row.style.display='none';

  const wrap=document.createElement('div');
  wrap.id='paymentSourceFields';
  wrap.className='fields2';
  wrap.innerHTML='<label>Source du paiement<select id="debitSource"><option value="account_direct">Prélèvement direct sur le compte</option><option value="card_vincent">Carte différée Vincent</option><option value="card_lili">Carte différée Lili</option></select></label><label>Nombre de passages sur le compte<input id="debitPartCount" type="number" min="1" max="24" value="1"><small id="debitPartPreview" style="display:block;margin-top:5px;color:var(--soft)">Un seul passage à valider sur le compte.</small></label>';
  row.insertAdjacentElement('afterend',wrap);

  const split=document.getElementById('splitV')?.closest('.fields2');
  if(split)split.style.display='none';

  document.getElementById('debitSource').addEventListener('change',()=>{syncBackendFields();updateDebitMonthFromSource();});
  document.getElementById('debitPartCount').addEventListener('input',updatePartPreview);
  document.getElementById('amount')?.addEventListener('input',()=>{syncBackendFields();updatePartPreview();});
  document.getElementById('date')?.addEventListener('change',updateDebitMonthFromSource);
}

ensureFields();
const oldOpenTx=openTx;
openTx=function(type,t=null){
  oldOpenTx(type,t);
  ensureFields();
  if(type!=='expense')return;
  const src=document.getElementById('debitSource');
  const cnt=document.getElementById('debitPartCount');
  if(src)src.value=sourceFromTx(t);
  if(cnt)cnt.value=String(Math.max(1,Number(t?.debitPartCount||1)));
  syncBackendFields();
  if(!t)updateDebitMonthFromSource();
  updatePartPreview();
};

const btn=document.getElementById('saveTx');
if(btn){
  const previous=btn.onclick;
  btn.onclick=function(e){
    const type=document.getElementById('txType')?.value;
    const source=document.getElementById('debitSource')?.value||'account_direct';
    const count=Math.max(1,Math.min(24,Number(document.getElementById('debitPartCount')?.value||1)));
    const editId=document.getElementById('editId')?.value||'';
    const beforeIds=new Set((state.transactions||[]).map(t=>t.id));
    syncBackendFields();
    previous.call(this,e);
    if(document.getElementById('txDialog')?.open||type!=='expense')return;

    let rows=[];
    if(editId){
      const t=state.transactions.find(x=>x.id===editId);
      if(t){
        if(t.seriesId)rows=state.transactions.filter(x=>x.seriesId===t.seriesId);
        else if(t.installmentGroup)rows=state.transactions.filter(x=>x.installmentGroup===t.installmentGroup);
        else rows=[t];
      }
    }else rows=(state.transactions||[]).filter(t=>!beforeIds.has(t.id)&&t.type==='expense');

    for(const t of rows){
      if(source==='card_vincent'){t.paymentMethod='card_deferred';t.cardOwner='Vincent';t.owner='Vincent';t.splitVincent=Number(t.amount||0);t.splitLili=0;}
      else if(source==='card_lili'){t.paymentMethod='card_deferred';t.cardOwner='Lili';t.owner='Lili';t.splitVincent=0;t.splitLili=Number(t.amount||0);}
      else {t.paymentMethod='direct_debit';delete t.cardOwner;t.owner='Compte';t.splitVincent=0;t.splitLili=0;}
      t.debitPartCount=count;
      t.debitPartAmounts=buildParts(t.amount,count);
      const pc=passedCount(t);
      t.debitPartsPassed=Math.min(pc,count);
    }
    try{localStorage.setItem(KEY,JSON.stringify(state));}catch(err){}
    if(typeof render==='function')render();
  };
}

function projectedById(id){
  try{return (typeof effectiveTransactions==='function'?effectiveTransactions(state.currentMonth):[]).find(x=>x.id===id)||null}catch(e){return null}
}
function materialize(t){
  if(!t?.projected)return t;
  const stored=(state.transactions||[]).find(x=>x.id===t.id);if(stored)return stored;
  const real={...t,projected:false,source:'Prévision enregistrée'};
  state.transactions.push(real);return real;
}
function saveQuiet(){
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
  if(typeof render==='function')render();
}
document.body.addEventListener('click',e=>{
  const b=e.target.closest('[data-action="nextSubDebit"],[data-action="undoSubDebit"]');
  if(!b)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  let t=(state.transactions||[]).find(x=>x.id===b.dataset.id)||projectedById(b.dataset.id);
  if(!t)return;t=materialize(t);
  const parts=Array.isArray(t.debitPartAmounts)&&t.debitPartAmounts.length?t.debitPartAmounts:buildParts(t.amount,t.debitPartCount||1);
  let passed=passedCount(t);
  if(b.dataset.action==='nextSubDebit'){
    if(passed>=parts.length)return;
    t.debitedAmount=money((t.debitedAmount||0)+parts[passed]);
    t.debitPartsPassed=passed+1;
  }else{
    if(passed<=0){t.debitedAmount=0;t.debitPartsPassed=0;}
    else{
      t.debitedAmount=money(Math.max(0,(t.debitedAmount||0)-parts[passed-1]));
      t.debitPartsPassed=passed-1;
    }
    delete t.autoValidatedAt;
    if(t.autoValidate)t.autoValidationPaused=true;
  }
  saveQuiet();
},true);

window.MesComptesDebitParts={buildParts,passedCount};
if(typeof render==='function')render();
})();