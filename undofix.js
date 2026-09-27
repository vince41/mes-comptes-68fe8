(function(){
'use strict';
const HOTFIX_VERSION='0.5.18';

function findStored(id){
  return (state.transactions||[]).find(x=>x.id===id)||null;
}
function persistAndRender(){
  try{
    state.transactions=categorizeTransactions(state.transactions);
    localStorage.setItem(KEY,JSON.stringify(state));
  }catch(e){}
  if(typeof render==='function')render();
}
function materializeProjected(id){
  let p=null;
  try{p=(typeof effectiveTransactions==='function'?effectiveTransactions(state.currentMonth):[]).find(x=>x.id===id);}catch(e){}
  if(!p||!p.projected)return findStored(id);
  const real={...p,projected:false,source:'Prévision enregistrée'};
  state.transactions.push(real);
  return real;
}

document.body.addEventListener('click',function(e){
  const b=e.target.closest('[data-action]');
  if(!b)return;
  const a=b.dataset.action;
  if(!['unpay','undoPassed','incomeToggle','projectIncomeReceive'].includes(a))return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  let t=findStored(b.dataset.id);

  if(a==='projectIncomeReceive'){
    t=materializeProjected(b.dataset.id);
    if(!t)return;
    t.incomeStatus=t.incomeStatus==='received'?'expected':'received';
    if(t.incomeStatus==='expected'){
      delete t.autoValidatedAt;
      if(t.autoValidate)t.autoValidationPaused=true;
    }
    persistAndRender();
    return;
  }

  if(!t)return;

  if(a==='unpay'||a==='undoPassed'){
    t.debitedAmount=0;
    delete t.autoValidatedAt;
    if(t.autoValidate)t.autoValidationPaused=true;
    persistAndRender();
    return;
  }

  if(a==='incomeToggle'){
    t.incomeStatus=t.incomeStatus==='received'?'expected':'received';
    if(t.incomeStatus==='expected'){
      delete t.autoValidatedAt;
      if(t.autoValidate)t.autoValidationPaused=true;
    }else{
      delete t.autoValidationPaused;
    }
    persistAndRender();
  }
},true);
})();