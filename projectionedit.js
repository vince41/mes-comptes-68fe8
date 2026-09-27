(function(){
'use strict';
const PROJECTION_EDIT_VERSION='0.5.17';

function materializeProjection(id){
  let p=null;
  try{p=(typeof effectiveTransactions==='function'?effectiveTransactions(state.currentMonth):[]).find(x=>x.id===id);}catch(e){}
  if(!p||!p.projected)return state.transactions.find(x=>x.id===id)||null;
  const real={...p,projected:false,source:'Prévision enregistrée'};
  state.transactions.push(real);
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
  return real;
}

const oldRenderIncomes=renderIncomes;
renderIncomes=function(id,arr){
  const el=document.getElementById(id);
  if(!el)return;
  if(!arr.length){el.innerHTML='<div class="empty">Aucune entrée d’argent</div>';return;}
  el.innerHTML='';
  for(const t of arr){
    const rec=t.incomeStatus==='received',d=document.createElement('div');
    d.className='tx'+(rec?' confirmed':'');
    d.classList.toggle('projection-card',!!t.projected);
    const badge=t.source==='LibreOffice'?'<span class="source-badge">LibreOffice</span>':t.projected?'<span class="projected-badge">Prévision auto</span>':'';
    const actions=t.projected
      ? `<button data-action="projectIncomeEdit" data-id="${t.id}">Modifier</button><button data-action="projectIncomeReceive" data-id="${t.id}">${rec?'↩ Pas encore reçu':'✓ Reçu sur le compte'}</button>`
      : `<button data-action="edit" data-id="${t.id}">Modifier</button><button data-action="incomeToggle" data-id="${t.id}">${rec?'↩ Pas encore reçu':'✓ Reçu sur le compte'}</button><button data-action="delete" data-id="${t.id}">🗑</button>`;
    d.innerHTML=`<div><div class="tx-title">${esc(t.label)} ${badge}</div><div class="tx-meta">${t.date||'date prévue non renseignée'} · ${rec?'Reçu sur le compte':'Pas encore reçu'}</div></div><div><div class="tx-amount">+ ${euro.format(t.amount)}</div><div class="tx-actions">${actions}</div></div>`;
    el.appendChild(d);
  }
};

document.body.addEventListener('click',e=>{
  const b=e.target.closest('[data-action="projectIncomeEdit"],[data-action="projectIncomeReceive"]');
  if(!b)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  const t=materializeProjection(b.dataset.id);if(!t)return;
  if(b.dataset.action==='projectIncomeEdit'){openTx('income',t);return;}
  t.incomeStatus=t.incomeStatus==='received'?'expected':'received';
  save();
},true);

if(typeof render==='function')render();
})();