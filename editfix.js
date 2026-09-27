(function(){
'use strict';
const EDIT_FIX_VERSION='0.5.12.1';
let editSnapshot=null;
const oldOpenTx=openTx;
const oldSaveTx=$('saveTx').onclick;

function fieldValue(id){return String($(id)?.value??'');}
function num(v){const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:0;}
function nearly(a,b){return Math.abs(Number(a||0)-Number(b||0))<=0.02;}
function setVersion(){
  const small=document.querySelector('.top-brand h1 small');
  if(small)small.textContent='V'+EDIT_FIX_VERSION;
  const badge=document.getElementById('mcVersionBadge');
  if(badge)badge.textContent='V'+EDIT_FIX_VERSION;
  document.title='Mes Comptes · V'+EDIT_FIX_VERSION;
}

openTx=function(type,t=null){
  oldOpenTx(type,t);
  editSnapshot=null;
  if(t&&type==='expense'){
    $('installBox').disabled=false;
    $('repeatBox').disabled=false;
    $('installBox').checked=!!t.installmentGroup;
    $('repeatBox').checked=!!t.recurring;
    $('installCount').value=t.installmentCount||4;
    $('repeatCount').value=t.seriesCount||12;
    toggleExtras();
    editSnapshot={
      id:t.id,
      amount:Number(t.amount||0),
      owner:t.owner||'Vincent',
      splitV:fieldValue('splitV'),
      splitL:fieldValue('splitL'),
      installment:!!t.installmentGroup,
      recurring:!!t.recurring
    };
  }
};

function applySplits(t,amount,owner){
  const rawV=fieldValue('splitV').trim(),rawL=fieldValue('splitL').trim();
  const sameStructure=editSnapshot&&editSnapshot.id===t.id&&
    nearly(amount,editSnapshot.amount)&&owner===editSnapshot.owner&&
    rawV===editSnapshot.splitV&&rawL===editSnapshot.splitL;
  if(sameStructure)return true;
  let v=rawV===''?0:num(rawV),l=rawL===''?0:num(rawL);
  if(owner==='Vincent'&&!v&&!l)v=amount;
  if(owner==='Lili'&&!v&&!l)l=amount;
  if(owner==='Commun'&&!nearly(v+l,amount)){
    alert('Pour une dépense qui concerne Vincent et Lili, part Vincent + part Lili doit correspondre au montant total.');
    return false;
  }
  t.splitVincent=v;t.splitLili=l;
  return true;
}

function makeInstallments(t,n,first){
  if(t.installmentGroup)return;
  const base={...t};
  const oldDebited=expenseDebited(t);
  const group=uid();
  const totalC=Math.round(Number(base.amount||0)*100);
  const vTotal=Math.round(Number(base.splitVincent||0)*100);
  const lTotal=Math.round(Number(base.splitLili||0)*100);
  let rem=totalC,vRem=vTotal,lRem=lTotal;
  const rows=[];
  for(let i=0;i<n;i++){
    const c=i===n-1?rem:Math.round(totalC/n);
    const vc=i===n-1?vRem:Math.round(vTotal/n);
    const lc=i===n-1?lRem:Math.round(lTotal/n);
    rem-=c;vRem-=vc;lRem-=lc;
    rows.push({...base,id:i===0?t.id:uid(),amount:c/100,splitVincent:vc/100,splitLili:lc/100,
      month:addMonths(first,i),installmentGroup:group,installmentIndex:i+1,installmentCount:n,
      debitedAmount:i===0?Math.min(oldDebited,c/100):0});
  }
  Object.assign(t,rows[0]);
  for(let i=1;i<rows.length;i++)state.transactions.push(rows[i]);
}

function makeRecurring(t,n,first){
  if(t.recurring)return;
  const base={...t},series=uid();
  t.recurring=true;t.seriesId=series;t.seriesIndex=1;t.seriesCount=n;t.month=first;
  for(let i=1;i<n;i++)state.transactions.push({...base,id:uid(),month:addMonths(first,i),recurring:true,seriesId:series,seriesIndex:i+1,seriesCount:n,debitedAmount:0});
}

$('saveTx').onclick=function(e){
  const id=$('editId').value;
  if(!id)return oldSaveTx.call(this,e);
  e.preventDefault();
  const t=state.transactions.find(x=>x.id===id);if(!t)return;
  const type=$('txType').value,label=$('label').value.trim(),amount=Number($('amount').value);
  if(!label||!Number.isFinite(amount)||amount===0)return alert('Libellé et montant obligatoires.');
  t.label=label;t.amount=amount;t.date=$('date').value;t.month=$('debitMonth').value||state.currentMonth;
  if(type==='income'){
    t.incomeStatus=$('incomeStatus').value;
    $('txDialog').close();save();return;
  }
  const owner=$('owner').value;
  t.paymentMethod=$('paymentMethod').value;t.owner=owner;t.note=$('note').value.trim();
  t.category=$('category').value.trim()||autoCategory(t);
  if(!applySplits(t,amount,owner))return;
  if(expenseDebited(t)>amount)t.debitedAmount=amount;
  const first=$('debitMonth').value||state.currentMonth;
  const wantsInstall=$('installBox').checked,wantsRepeat=$('repeatBox').checked;
  if(wantsInstall&&!t.installmentGroup){makeInstallments(t,Math.max(2,Number($('installCount').value||2)),first);}
  else if(wantsRepeat&&!t.recurring){makeRecurring(t,Math.max(2,Number($('repeatCount').value||12)),first);}
  $('txDialog').close();save();
};

$('installBox').disabled=false;$('repeatBox').disabled=false;
setVersion();
setTimeout(setVersion,300);
})();