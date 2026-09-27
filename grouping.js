(function(){
'use strict';
const GROUPING_VERSION='0.5.20';
let groupingMode=localStorage.getItem('mes-comptes-list-mode')||'grouped';
const expandedGroups=new Set();

function addGroupingStyles(){
  if(document.getElementById('groupingStyles')) return;
  const st=document.createElement('style');
  st.id='groupingStyles';
  st.textContent=`
  .view-mode{display:flex;align-items:center;gap:6px;margin-left:auto}.view-mode-label{font-size:.76rem;color:var(--soft);font-weight:800}.view-mode .btn{padding:7px 9px}.view-mode .btn.active{background:linear-gradient(135deg,#099ce7,#056ab5);border-color:#44c5ff;color:#fff}
  .tx-group{border:1px solid #1d628f;border-radius:13px;background:#052946;margin-top:7px;overflow:hidden}.tx-group-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px}.tx-group-main{min-width:0}.tx-group-title{font-weight:900;display:flex;align-items:center;gap:7px;flex-wrap:wrap}.tx-group-sub{font-size:.77rem;color:var(--soft);margin-top:4px}.tx-group-amount{text-align:right;font-weight:950;font-size:1.02rem}.tx-group-split{font-size:.76rem;color:#b9d9ec;margin-top:4px}.tx-group-toggle{border:1px solid #276f9e;background:#082f50;color:#eaf8ff;border-radius:9px;padding:6px 9px;font-weight:800;cursor:pointer;margin-top:6px}.tx-group-items{display:none;padding:0 10px 8px;border-top:1px solid #1c5c84}.tx-group.open .tx-group-items{display:block}.tx-group-items .tx{margin-left:0;margin-right:0}.group-count{display:inline-flex;padding:2px 7px;border-radius:999px;background:#0b3a61;color:#8fd6ff;font-size:.68rem;font-weight:900}.group-status{font-size:.74rem;margin-top:3px;color:#9bc8e3}.tx-group.confirmed{border-color:#267755;background:#07362f}.tx-group.partial{border-color:#9d7523;background:#3a2e10}.tx-group.confirmed .tx-group-amount{color:#62e3ac}.tx-group.partial .tx-group-amount{color:#ffd166}
  @media(max-width:760px){.view-mode{grid-column:1/-1;margin-left:0;display:grid;grid-template-columns:auto 1fr 1fr;width:100%}.view-mode .btn{width:100%}.tx-group-head{grid-template-columns:1fr}.tx-group-amount{text-align:left}}
  `;
  document.head.appendChild(st);
}
function addGroupingControls(){
  const filters=document.querySelector('.filters');
  if(!filters||document.getElementById('modeGrouped')) return;
  const box=document.createElement('div');
  box.className='view-mode';
  box.innerHTML='<span class="view-mode-label">Affichage</span><button class="btn" type="button" id="modeGrouped">Regroupé</button><button class="btn" type="button" id="modeDetailed">Détaillé</button>';
  filters.appendChild(box);
  document.getElementById('modeGrouped').onclick=()=>setGroupingMode('grouped');
  document.getElementById('modeDetailed').onclick=()=>setGroupingMode('detailed');
  syncGroupingButtons();
}
function setGroupingMode(mode){
  groupingMode=mode;
  localStorage.setItem('mes-comptes-list-mode',mode);
  expandedGroups.clear();
  syncGroupingButtons();
  if(typeof render==='function') render();
}
function syncGroupingButtons(){
  document.getElementById('modeGrouped')?.classList.toggle('active',groupingMode==='grouped');
  document.getElementById('modeDetailed')?.classList.toggle('active',groupingMode==='detailed');
}
function merchantKey(t){return String(t?.label||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function groupKey(t){return [merchantKey(t),String(t.category||autoCategory(t)),String(t.paymentMethod||'other'),String(t.cardOwner||'')].join('|')}
function shownAmount(t){return filterOwner==='Vincent'||filterOwner==='Lili'?profileAmount(t,filterOwner):Number(t.amount||0)}
function shownDebited(t){return filterOwner==='Vincent'||filterOwner==='Lili'?profileDebited(t,filterOwner):expenseDebited(t)}
function shownRemaining(t){return filterOwner==='Vincent'||filterOwner==='Lili'?profileRemaining(t,filterOwner):expenseRemaining(t)}
function expenseRow(t){
  const who=filterOwner==='Vincent'||filterOwner==='Lili'?filterOwner:null,a=shownAmount(t),r=shownRemaining(t),d=shownDebited(t),full=r<=0,partial=d>0&&!full,row=document.createElement('div');
  row.className='tx'+(full?' confirmed':partial?' partial':''); row.classList.toggle('projection-card',!!t.projected);
  const badge=t.source==='LibreOffice'?'<span class="source-badge">LibreOffice</span>':t.projected?'<span class="projected-badge">Prévision auto</span>':'';
  let actions='';
  const multi=Number(t.debitPartCount||1)>1;
  const parts=multi&&window.MesComptesDebitParts?window.MesComptesDebitParts.buildParts(t.amount,t.debitPartCount):[];
  const passed=multi&&window.MesComptesDebitParts?window.MesComptesDebitParts.passedCount(t):0;
  const nextAmt=multi&&passed<parts.length?parts[passed]:0;
  if(t.projected) actions=`<button data-action="projectEdit" data-id="${t.id}">Modifier</button>${multi?`<button class="paid-btn" data-action="nextSubDebit" data-id="${t.id}">✓ Passer ${passed+1}/${parts.length} · ${euro.format(nextAmt)}</button>`:`<button class="paid-btn" data-action="projectFull" data-id="${t.id}">✓ Paiement passé</button>`}`;
  else if(full) actions=`<button data-action="edit" data-id="${t.id}">Modifier</button><button data-action="${multi?'undoSubDebit':'unpay'}" data-id="${t.id}">↩ ${multi?'Annuler dernier passage':'Annuler passage'}</button><button data-action="delete" data-id="${t.id}">🗑</button>`;
  else actions=`<button data-action="edit" data-id="${t.id}">Modifier</button><button class="paid-btn" data-action="${multi?'nextSubDebit':'full'}" data-id="${t.id}">${multi?`✓ Passer ${passed+1}/${parts.length} · ${euro.format(nextAmt)}`:'✓ Paiement passé'}</button><button data-action="debit" data-id="${t.id}">Montant partiel</button><button data-action="delete" data-id="${t.id}">🗑</button>`;
  if(typeof window.MesComptesExpenseActions==='function'){const custom=window.MesComptesExpenseActions(t);if(custom)actions=custom;}
  const sourceTxt=t.paymentMethod==='card_deferred'?('Carte différée '+(t.cardOwner||t.owner||'')):(t.paymentMethod==='direct_debit'?'Prélèvement compte':paymentLabel(t.paymentMethod));
  const multiTxt=multi?` · ${passed}/${parts.length} passages validés`:'';
  row.innerHTML=`<div><div class="tx-title"><span class="category-badge">${esc(t.category||autoCategory(t))}</span>${esc(t.label)} ${badge}</div><div class="tx-meta">${esc(sourceTxt)}${multiTxt} · ${esc(txMeta(t))}</div><div class="who-line">Source : ${esc(sourceTxt)}</div><div class="status-line">${esc(statusLabel(t,who))}</div></div><div><div class="tx-amount">${euro.format(a)}</div><div class="tx-actions">${actions}</div></div>`;
  return row;
}
function makeGroups(arr){
  const map=new Map();
  for(const t of arr){const k=groupKey(t);if(!map.has(k))map.set(k,[]);map.get(k).push(t)}
  return [...map.entries()].map(([key,items])=>({key,items})).sort((a,b)=>{
    const ad=a.items.map(x=>x.date||'').sort()[0]||'',bd=b.items.map(x=>x.date||'').sort()[0]||'';
    return ad.localeCompare(bd)||(a.items[0]?.label||'').localeCompare(b.items[0]?.label||'');
  });
}
function groupRow(g){
  if(g.items.length===1) return expenseRow(g.items[0]);
  const amount=round(sum(g.items,shownAmount)),debited=round(sum(g.items,shownDebited)),remaining=round(sum(g.items,shownRemaining)),full=remaining<=0,partial=debited>0&&!full,first=g.items[0],open=expandedGroups.has(g.key),v=round(sum(g.items,t=>profileAmount(t,'Vincent'))),l=round(sum(g.items,t=>profileAmount(t,'Lili'))),dates=g.items.map(t=>t.date).filter(Boolean).sort(),dateTxt=dates.length?(dates[0]===dates.at(-1)?dates[0]:`${dates[0]} → ${dates.at(-1)}`):'dates non renseignées',wrap=document.createElement('div');
  wrap.className='tx-group'+(open?' open':'')+(full?' confirmed':partial?' partial':'');wrap.dataset.groupKey=g.key;
  let split='';
  if(filterOwner==='Tous'){const bits=[];if(v>0)bits.push(`Vincent ${euro.format(v)}`);if(l>0)bits.push(`Lili ${euro.format(l)}`);if(bits.length)split=`<div class="tx-group-split">${bits.join(' · ')}</div>`}
  const status=full?`Tout est passé sur le compte : ${euro.format(debited)}`:partial?`Déjà passé ${euro.format(debited)} · reste ${euro.format(remaining)}`:`Encore à prélever : ${euro.format(amount)}`;
  wrap.innerHTML=`<div class="tx-group-head"><div class="tx-group-main"><div class="tx-group-title"><span class="category-badge">${esc(first.category||autoCategory(first))}</span>${esc(first.label)} <span class="group-count">${g.items.length} achats</span></div><div class="tx-group-sub">${esc((paymentLabel(first.paymentMethod)||'Autre')+(first.cardOwner?' · carte '+first.cardOwner:''))} · ${esc(dateTxt)}</div>${split}<div class="group-status">${esc(status)}</div><button class="tx-group-toggle" type="button" data-group-toggle="1">${open?'▲ Masquer le détail':`▼ Voir les ${g.items.length} achats`}</button></div><div class="tx-group-amount">${euro.format(amount)}</div></div><div class="tx-group-items"></div>`;
  const inner=wrap.querySelector('.tx-group-items');
  for(const t of [...g.items].sort((a,b)=>(a.date||'').localeCompare(b.date||''))) inner.appendChild(expenseRow(t));
  wrap.querySelector('[data-group-toggle]').onclick=e=>{e.preventDefault();e.stopPropagation();if(expandedGroups.has(g.key))expandedGroups.delete(g.key);else expandedGroups.add(g.key);if(typeof render==='function')render()};
  return wrap;
}
const originalRenderExpenses=renderExpenses;
renderExpenses=function(id,arr){
  const el=document.getElementById(id);if(!el)return;
  if(groupingMode==='detailed'){
    if(!arr.length){el.innerHTML='<div class="empty">Aucune opération</div>';return}
    el.innerHTML='';
    for(const t of [...arr].sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.label||'').localeCompare(b.label||''))) el.appendChild(expenseRow(t));
    return;
  }
  if(!arr.length){el.innerHTML='<div class="empty">Aucune opération</div>';return}
  el.innerHTML='';
  for(const g of makeGroups(arr)) el.appendChild(groupRow(g));
};
function patchVersion(){
  document.title='Mes Comptes · V'+GROUPING_VERSION;
  const v=document.querySelector('.top-brand h1 small');if(v)v.textContent='V'+GROUPING_VERSION;
  const badge=document.getElementById('mcVersionBadge');if(badge)badge.textContent='V'+GROUPING_VERSION;
}
addGroupingStyles();addGroupingControls();patchVersion();
if(typeof render==='function') render();
})();

function materializeProjectedForAction(id){
  const p=(typeof effectiveTransactions==='function'?effectiveTransactions(state.currentMonth):[]).find(x=>x.id===id);
  if(!p||!p.projected)return state.transactions.find(x=>x.id===id)||null;
  const real={...p,projected:false,source:'Prévision enregistrée'};
  state.transactions.push(real);
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
  return real;
}
document.body.addEventListener('click',e=>{
  const b=e.target.closest('[data-action="projectEdit"],[data-action="projectFull"]');
  if(!b)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  const t=materializeProjectedForAction(b.dataset.id);if(!t)return;
  if(b.dataset.action==='projectEdit'){openTx(t.type,t);return;}
  t.debitedAmount=Number(t.amount||0);save();
},true);
