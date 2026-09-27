(function(){
'use strict';
const BANKFLOW_VERSION='0.5.25';
const oldDefaultState=defaultState;
const oldNormalizeState=normalizeState;
const oldSummary=summary;
const oldRender=render;
const oldFixedProjectionTemplates=fixedProjectionTemplates;

function calendarMonth(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function migrateBankFlow(out, source){
  const hadBankFlow=!!source?.bankFlowV1;
  const anchor=source?.flowAnchorMonth||calendarMonth();
  out.version=5.6;
  out.flowAnchorMonth=anchor;
  out.bankFlowV1=true;
  out.settings=out.settings||{};
  out.settings.Vincent={closeDay:25,debitDay:4,...(out.settings.Vincent||{})};
  out.settings.Lili={closeDay:25,debitDay:4,...(out.settings.Lili||{})};
  if(!hadBankFlow){
    out.transactions=(out.transactions||[]).map(t=>{
      if(t?.source==='LibreOffice' && t.month>anchor){
        if(t.type==='income') return {...t,incomeStatus:'expected'};
        if(t.type==='expense') return {...t,debitedAmount:0};
      }
      return t;
    });
  }
  return out;
}
defaultState=function(){return migrateBankFlow(oldDefaultState(),{bankFlowV1:false,flowAnchorMonth:calendarMonth()});};
normalizeState=function(x){return migrateBankFlow(oldNormalizeState(x),x||{});};

if(!state.bankFlowV1){
  state=migrateBankFlow(state,state||{});
  localStorage.setItem(KEY,JSON.stringify(state));
}

summary=function(m,stack=new Set()){
  const anchor=state.flowAnchorMonth||calendarMonth();
  if(m<=anchor) return oldSummary(m,stack);
  const arr=effectiveTransactions(m),inc=arr.filter(t=>t.type==='income'),ex=arr.filter(t=>t.type==='expense'),md=monthData(m);
  let start=0,forecastStart=0;
  if(md.manualStart){
    start=Number(md.startBalance||0); forecastStart=start;
  }else if(!stack.has(m)){
    const nextStack=new Set(stack); nextStack.add(m);
    const p=prevMonth(m);
    if(effectiveTransactions(p).length||state.months[p]){
      const ps=summary(p,nextStack);
      start=ps.currentBalance;
      forecastStart=ps.forecast;
    }
  }
  const incomeTotal=sum(inc),receivedIncome=sum(inc.filter(t=>t.incomeStatus==='received'));
  const expenseTotal=sum(ex),debitedTotal=sum(ex,expenseDebited),remaining=sum(ex,expenseRemaining);
  const expectedIncome=sum(inc.filter(t=>t.incomeStatus!=='received'));
  const forecast=round(forecastStart+incomeTotal-expenseTotal);
  const currentBalance=round(start+receivedIncome-debitedTotal);
  return {arr,inc,ex,md,start:round(start),forecastStart:round(forecastStart),incomeTotal:round(incomeTotal),receivedIncome:round(receivedIncome),expenseTotal:round(expenseTotal),debitedTotal:round(debitedTotal),remaining:round(remaining),forecast,currentBalance,expectedIncome:round(expectedIncome)};
};

fixedProjectionTemplates=function(){
  const source=(state.transactions&&state.transactions.length)?state.transactions:[];
  let ref=source.some(t=>t.month==='2026-11')?'2026-11':null;
  if(!ref){const ms=[...new Set(source.map(t=>t.month).filter(Boolean))].sort();ref=ms.at(-1)||'2026-11';}
  const fuel=t=>{const x=(String(t?.label||'')+' '+String(t?.note||'')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return t?.type==='expense'&&(x.includes('essence')||x.includes('carburant'));};
  const rows=source.filter(t=>t.month===ref&&((t.type==='income'&&Number(t.sourceRow||999)<=5)||(t.type==='expense'&&(Number(t.sourceRow||999)<=39||fuel(t)))));
  return rows.length?rows.map(t=>({...t})):oldFixedProjectionTemplates();
};

function cardPart(t,who){
  if(t?.type!=='expense') return 0;
  const sv=Number(t.splitVincent||0),sl=Number(t.splitLili||0);
  if(t.paymentMethod==='card_deferred'&&(t.cardOwner==='Vincent'||t.cardOwner==='Lili')) return t.cardOwner===who?Number(t.amount||0):0;
  if(t.source==='LibreOffice') return who==='Vincent'?sv:sl;
  if(t.paymentMethod!=='card_deferred') return 0;
  if(sv||sl) return who==='Vincent'?sv:sl;
  return t.owner===who?Number(t.amount||0):0;
}
function deferredAmount(t){return round(cardPart(t,'Vincent')+cardPart(t,'Lili'));}
function isDeferred(t){return t?.type==='expense'&&(t.paymentMethod==='card_deferred'||deferredAmount(t)>0);}
function deferredPending(){return effectiveTransactions(state.currentMonth).filter(t=>isDeferred(t)&&expenseRemaining(t)>0&&!t.projected);}

function ensureDeferredCard(){
  if(document.getElementById('confirmDeferredBatch')) return;
  const detail=document.querySelector('.person-card.card');
  if(!detail) return;
  const sec=document.createElement('section');
  sec.className='deferred-batch card';
  sec.style.cssText='padding:13px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap';
  sec.innerHTML=`<div><strong>CB différées du mois précédent</strong><div class="muted" id="deferredBatchInfo"></div></div><button class="btn" id="confirmDeferredBatch" type="button">✓ Valider le prélèvement CB du 4</button>`;
  detail.insertAdjacentElement('afterend',sec);
  sec.querySelector('#confirmDeferredBatch').onclick=()=>{
    const list=deferredPending();
    if(!list.length) return;
    const total=round(sum(list,t=>expenseRemaining(t)));
    if(!confirm(`Confirmer le prélèvement global des cartes différées pour ${euro.format(total)} ?`)) return;
    for(const t of list)t.debitedAmount=Number(t.amount||0);
    save();
  };
}
function updateDeferredCard(){
  ensureDeferredCard();
  const info=document.getElementById('deferredBatchInfo'),btn=document.getElementById('confirmDeferredBatch');
  if(!info||!btn)return;
  const list=deferredPending();
  const v=round(sum(list,t=>cardPart(t,'Vincent'))),l=round(sum(list,t=>cardPart(t,'Lili'))),total=round(sum(list,t=>expenseRemaining(t)));
  if(list.length){
    info.textContent=`À passer sur le compte : Vincent ${euro.format(v)} · Lili ${euro.format(l)} · total ${euro.format(total)}. Valide quand le débit global apparaît à la banque.`;
    btn.disabled=false; btn.textContent='✓ Valider le prélèvement CB du 4';
  }else{
    info.textContent='Aucun prélèvement CB différé restant à valider pour ce mois.';
    btn.disabled=true; btn.textContent='✓ CB différées déjà validées';
  }
}
function textOf(el,txt){if(el)el.textContent=txt;}
function patchLabels(){
  document.title=`Mes Comptes · V${BANKFLOW_VERSION}`;
  const cards=[...document.querySelectorAll('.metric.card')];
  if(cards[0]){textOf(cards[0].querySelector('span'),'Solde réel au début du mois');textOf(cards[0].querySelector('small'),'reprend le solde réel de fin du mois précédent');}
  if(cards[1]){textOf(cards[1].querySelector('span'),'Entrées prévues du mois');textOf(cards[1].querySelector('small'),'elles ne modifient le solde réel qu’une fois marquées reçues');}
  const cb=document.getElementById('currentBalance');if(cb){const c=cb.closest('.metric');textOf(c?.querySelector('span'),'Solde réel du compte');textOf(c?.querySelector('small'),'début du mois + revenus reçus − paiements passés');}
  const q=document.querySelector('.quick.card'),inc=document.getElementById('addIncome'),exp=document.getElementById('addExpense');if(q&&inc&&exp)q.insertBefore(inc,exp);
  const il=document.getElementById('incomeList'),pl=document.getElementById('pendingList');if(il&&pl){const is=il.closest('.list-section'),ps=pl.closest('.list-section');if(is&&ps&&is.parentNode===ps.parentNode)ps.parentNode.insertBefore(is,ps);textOf(is?.querySelector('.eyebrow'),'1 · Revenus du mois');textOf(ps?.querySelector('.eyebrow'),'2 · Dépenses prévues');}
  const dl=document.getElementById('doneList');textOf(dl?.closest('.list-section')?.querySelector('.eyebrow'),'3 · Paiements passés');
  document.querySelectorAll('#pendingList [data-action="full"]').forEach(b=>b.textContent='✓ Paiement passé');
  document.querySelectorAll('#pendingList [data-action="debit"]').forEach(b=>b.textContent='€ Paiement partiel');
  document.querySelectorAll('#doneList [data-action="debit"]').forEach(b=>{b.dataset.action='undoPassed';b.textContent='↩ Annuler passage';});
  const v=document.querySelector('.top-brand h1 small');if(v)v.textContent=`V${BANKFLOW_VERSION}`;
  let badge=document.getElementById('mcVersionBadge');if(!badge){badge=document.createElement('div');badge.id='mcVersionBadge';badge.style.cssText='position:fixed;top:calc(env(safe-area-inset-top) + 8px);right:10px;z-index:99999;background:#0b3153;color:#f4c767;border:1px solid #2d6b97;border-radius:999px;padding:5px 9px;font:700 12px system-ui;box-shadow:0 4px 14px #0008';document.body.appendChild(badge);}badge.textContent=`V${BANKFLOW_VERSION}`;
}
function importFix(){const b=document.getElementById('importBtn'),f=document.getElementById('importFile');if(!b||!f)return;b.style.display='inline-flex';b.disabled=false;b.textContent=state.transactions?.some(t=>t.source==='LibreOffice')?'Mettre à jour mon historique':'Charger mon historique privé';b.onclick=e=>{e.preventDefault();f.click();};}

render=function(){oldRender();patchLabels();importFix();updateDeferredCard();};

document.body.addEventListener('click',e=>{
  const b=e.target.closest('[data-action="undoPassed"]');if(!b)return;
  e.preventDefault();e.stopPropagation();
  const t=state.transactions.find(x=>x.id===b.dataset.id);if(!t)return;
  t.debitedAmount=0;save();
},true);

render();
})();