(function(){
'use strict';
const SAVINGS_LEDGER_VERSION='0.5.28';
const INITIAL_SAVINGS=322.60;
const oldSummary=summary;
const oldRender=render;

function money(n){return Math.round((Number(n||0)+Number.EPSILON)*100)/100;}
function localToday(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function currentCalendarMonth(){return localToday().slice(0,7);}
function defaultSavingsDate(){return state.currentMonth===currentCalendarMonth()?localToday():state.currentMonth+'-01';}
function savingsRows(){return Array.isArray(state.savingsLedger)?state.savingsLedger:[];}
function savingsBalance(){return money(savingsRows().reduce((s,x)=>s+Number(x.delta||0),0));}
function savingsFlowsForMonth(m){return savingsRows().filter(x=>x.affectsAccount!==false&&x.month===m);}
function savingsNetForMonth(m){return money(savingsFlowsForMonth(m).reduce((s,x)=>s+Number(x.delta||0),0));}
function persistState(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}

function migrateSavings(){
  let changed=false;
  if(!Array.isArray(state.savingsLedger)){
    state.savingsLedger=[{
      id:'savings-opening-20261005',
      delta:INITIAL_SAVINGS,
      kind:'opening',
      label:'Épargne déjà présente',
      date:'2026-10-05',
      month:'2026-10',
      affectsAccount:false,
      createdAt:'2026-10-05T20:43:00+02:00'
    }];
    changed=true;
  }
  if(!state.savingsLedgerV1){state.savingsLedgerV1=true;changed=true;}
  if(changed)persistState();
}

migrateSavings();

summary=function(m,stack=new Set()){
  const s=oldSummary(m,stack);
  const net=savingsNetForMonth(m);
  if(!net)return s;
  return {...s,forecast:money(Number(s.forecast||0)-net),currentBalance:money(Number(s.currentBalance||0)-net),savingsNet:net};
};

function ensureStyle(){
  if(document.getElementById('savingsLedgerStyle'))return;
  const st=document.createElement('style');
  st.id='savingsLedgerStyle';
  st.textContent=`
    .metric.card[data-metric-detail]{cursor:pointer;position:relative;transition:transform .12s ease,border-color .12s ease,box-shadow .12s ease}
    .metric.card[data-metric-detail]:hover,.metric.card[data-metric-detail]:focus-visible{transform:translateY(-1px);border-color:#4a8fbd;box-shadow:0 8px 20px #0002;outline:none}
    .metric.card[data-metric-detail]::after{content:'Voir le détail';display:block;margin-top:7px;font-size:.68rem;font-weight:850;color:#8ec7eb}
    #savingsActualMetric{background:linear-gradient(145deg,#173d58,#315a87);border-color:#6aa7cf}
    .savings-actual{padding:16px;display:grid;gap:12px;background:linear-gradient(145deg,#102c3e,#173d58);color:#fff}
    .savings-actual .eyebrow,.savings-actual .muted{color:#bed8e9}
    .savings-actual-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
    .savings-actual-actions{display:flex;gap:8px;flex-wrap:wrap}
    .savings-history{display:grid;gap:7px}
    .savings-row{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:9px 10px;border:1px solid #ffffff22;border-radius:10px;background:#ffffff0b}
    .savings-row strong{white-space:nowrap}.savings-row .in{color:#9ff0bf}.savings-row .out{color:#ffd0d0}.savings-row small{display:block;color:#bed8e9;margin-top:2px}
    .savings-row button{border:1px solid #ffffff33;background:#ffffff10;color:#fff;border-radius:8px;padding:5px 7px;font-weight:800;cursor:pointer}
    .metric-detail-list{display:grid;gap:7px}.metric-detail-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:9px 0;border-bottom:1px solid #e5e7eb}.metric-detail-row:last-child{border-bottom:0}.metric-detail-row small{display:block;color:#6b7280;margin-top:2px}.metric-detail-total{display:flex;justify-content:space-between;gap:12px;padding:10px;border-radius:10px;background:#f3f4f6;font-weight:900}.metric-detail-note{margin:0;color:#4b5563;line-height:1.45}.metric-detail-breakdown{display:grid;gap:7px;padding:10px;border:1px solid #e5e7eb;border-radius:10px}.metric-detail-breakdown div{display:flex;justify-content:space-between;gap:12px}.metric-detail-breakdown .final{padding-top:7px;border-top:1px solid #d1d5db;font-weight:950}
    @media(max-width:520px){.savings-row{grid-template-columns:1fr auto}.savings-row button{grid-column:1/-1}.savings-actual-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.savings-actual-actions .btn{width:100%}}
  `;
  document.head.appendChild(st);
}

function ensureSavingsUI(){
  ensureStyle();
  const grid=document.querySelector('#accountsView .grid');
  if(grid&&!document.getElementById('savingsActualMetric')){
    const card=document.createElement('article');
    card.className='metric card emphasis';
    card.id='savingsActualMetric';
    card.innerHTML='<span>Épargne actuelle</span><strong id="savingsActualAmount"></strong><small>argent actuellement mis de côté</small>';
    grid.appendChild(card);
  }
  const quick=document.querySelector('#accountsView .quick.card');
  const edit=document.getElementById('editMonth');
  if(quick&&edit&&!document.getElementById('addSavings')){
    const b=document.createElement('button');
    b.className='btn';b.id='addSavings';b.type='button';b.textContent='+ Épargne';
    quick.insertBefore(b,edit);
    b.addEventListener('click',()=>openSavingsDialog('deposit'));
  }
  const view=document.getElementById('savingsView');
  if(view&&!document.getElementById('savingsActualPanel')){
    const sec=document.createElement('section');
    sec.className='savings-actual card';sec.id='savingsActualPanel';
    sec.innerHTML=`<div class="savings-actual-head"><div><div class="eyebrow">Épargne réelle</div><div class="savings-number" id="savingsActualBalance"></div><strong>Mis de côté actuellement</strong><p class="muted">Les mouvements d’épargne sont séparés des dépenses courantes.</p></div><div class="savings-actual-actions"><button class="btn primary" id="savingsDeposit" type="button">+ Mettre en épargne</button><button class="btn" id="savingsWithdraw" type="button">− Reprendre sur le compte</button></div></div><div><div class="eyebrow">Mouvements récents</div><div class="savings-history" id="savingsHistory"></div></div>`;
    view.insertBefore(sec,view.firstChild);
    sec.querySelector('#savingsDeposit').addEventListener('click',()=>openSavingsDialog('deposit'));
    sec.querySelector('#savingsWithdraw').addEventListener('click',()=>openSavingsDialog('withdraw'));
  }
  if(!document.getElementById('savingsDialog')){
    const d=document.createElement('dialog');
    d.id='savingsDialog';
    d.innerHTML=`<form class="dialog-form" id="savingsForm"><div class="dialog-head"><h3 id="savingsDialogTitle">Épargne</h3><button class="icon-btn" type="button" id="closeSavingsDialog">✕</button></div><label>Mouvement<select id="savingsDirection"><option value="deposit">Mettre de l’argent en épargne</option><option value="withdraw">Reprendre de l’épargne vers le compte</option></select></label><div class="fields2"><label>Montant (€)<input id="savingsAmountInput" type="number" min="0.01" step="0.01" inputmode="decimal"></label><label>Date<input id="savingsDateInput" type="date"></label></div><label>Libellé<input id="savingsLabelInput" autocomplete="off" placeholder="Ex. Épargne du mois"></label><p class="hint" id="savingsDialogHint"></p><menu><button class="btn" type="button" id="cancelSavingsDialog">Annuler</button><button class="btn primary" id="saveSavings" type="submit">Enregistrer</button></menu></form>`;
    document.body.appendChild(d);
    d.querySelector('#closeSavingsDialog').onclick=()=>d.close();
    d.querySelector('#cancelSavingsDialog').onclick=()=>d.close();
    d.querySelector('#savingsDirection').addEventListener('change',updateSavingsDialogHint);
    d.querySelector('#savingsForm').addEventListener('submit',saveSavingsMovement);
  }
  if(!document.getElementById('metricDetailDialog')){
    const d=document.createElement('dialog');
    d.id='metricDetailDialog';
    d.innerHTML='<form class="dialog-form"><div class="dialog-head"><h3 id="metricDetailTitle">Détail</h3><button class="icon-btn" type="button" id="closeMetricDetail">✕</button></div><div id="metricDetailBody"></div><menu><button class="btn primary" type="button" id="okMetricDetail">Fermer</button></menu></form>';
    document.body.appendChild(d);
    d.querySelector('#closeMetricDetail').onclick=()=>d.close();
    d.querySelector('#okMetricDetail').onclick=()=>d.close();
  }
}

function openSavingsDialog(direction){
  ensureSavingsUI();
  const d=document.getElementById('savingsDialog');
  document.getElementById('savingsDirection').value=direction==='withdraw'?'withdraw':'deposit';
  document.getElementById('savingsAmountInput').value='';
  document.getElementById('savingsDateInput').value=defaultSavingsDate();
  document.getElementById('savingsLabelInput').value='';
  updateSavingsDialogHint();
  d.showModal();
  setTimeout(()=>document.getElementById('savingsAmountInput')?.focus(),50);
}
function updateSavingsDialogHint(){
  const dir=document.getElementById('savingsDirection')?.value||'deposit';
  const b=savingsBalance();
  const title=document.getElementById('savingsDialogTitle'),hint=document.getElementById('savingsDialogHint');
  if(title)title.textContent=dir==='withdraw'?'Reprendre de l’épargne':'Mettre en épargne';
  if(hint)hint.textContent=dir==='withdraw'?`Disponible dans l’épargne : ${euro.format(b)}. Le montant repris remontera le solde réel du compte.`:'Le montant sera ajouté à l’épargne et retiré du solde réel du compte.';
}
function saveSavingsMovement(e){
  e.preventDefault();
  const dir=document.getElementById('savingsDirection').value;
  const amount=money(Number(document.getElementById('savingsAmountInput').value));
  const date=document.getElementById('savingsDateInput').value||defaultSavingsDate();
  const label=document.getElementById('savingsLabelInput').value.trim()||(dir==='withdraw'?'Reprise d’épargne':'Mise en épargne');
  if(!Number.isFinite(amount)||amount<=0)return alert('Entre un montant d’épargne supérieur à 0 €.');
  if(dir==='withdraw'&&amount>savingsBalance()+0.001)return alert(`Tu n’as que ${euro.format(savingsBalance())} dans l’épargne.`);
  savingsRows().push({id:uid(),delta:dir==='withdraw'?-amount:amount,kind:dir,label,date,month:date.slice(0,7)||state.currentMonth,affectsAccount:true,createdAt:new Date().toISOString()});
  document.getElementById('savingsDialog').close();
  persistState();
  render();
}

function renderSavingsLedger(){
  const bal=savingsBalance();
  const metric=document.getElementById('savingsActualAmount');if(metric)metric.textContent=euro.format(bal);
  const head=document.getElementById('savingsActualBalance');if(head)head.textContent=euro.format(bal);
  const list=document.getElementById('savingsHistory');if(!list)return;
  const rows=[...savingsRows()].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  if(!rows.length){list.innerHTML='<div class="empty">Aucun mouvement d’épargne</div>';return;}
  list.innerHTML=rows.slice(0,12).map(x=>{
    const val=Number(x.delta||0),initial=x.kind==='opening';
    const meta=(x.date||'date non renseignée')+(initial?' · solde de départ':val>=0?' · vers épargne':' · vers compte');
    return `<div class="savings-row"><div><strong>${esc(x.label||'Épargne')}</strong><small>${esc(meta)}</small></div><strong class="${val>=0?'in':'out'}">${val>=0?'+ ':'− '}${euro.format(Math.abs(val))}</strong>${initial?'<span></span>':`<button type="button" data-savings-delete="${esc(x.id)}">Annuler</button>`}</div>`;
  }).join('');
}

function movementRowsForMonth(m){return savingsFlowsForMonth(m).map(x=>({label:x.label||'Épargne',amount:Number(x.delta||0),date:x.date||'',kind:'savings'}));}
function rowHtml(label,amount,meta=''){
  return `<div class="metric-detail-row"><div><strong>${esc(label||'Opération')}</strong>${meta?`<small>${esc(meta)}</small>`:''}</div><strong>${euro.format(Number(amount||0))}</strong></div>`;
}
function expenseMeta(t){
  const d=t.date||'date non renseignée';
  const rem=expenseRemaining(t),deb=expenseDebited(t);
  return `${d} · ${deb>0?euro.format(deb)+' débité': 'pas encore débité'}${rem>0?' · '+euro.format(rem)+' restant':''}`;
}
function incomeMeta(t){return `${t.date||'date non renseignée'} · ${t.incomeStatus==='received'?'reçu':'attendu'}`;}
function metricConfig(id){
  const s=summary(state.currentMonth),moves=movementRowsForMonth(state.currentMonth),net=savingsNetForMonth(state.currentMonth);
  if(id==='startBalance'){
    const md=monthData(state.currentMonth),source=md.manualStart?'saisi manuellement':'repris automatiquement du mois précédent';
    return {title:'Solde réel au début du mois',body:`<p class="metric-detail-note">${euro.format(s.start)} · ${esc(source)}.</p>`};
  }
  if(id==='incomeTotal'){
    return {title:'Entrées prévues du mois',body:`<div class="metric-detail-total"><span>Total</span><strong>${euro.format(s.incomeTotal)}</strong></div><div class="metric-detail-list">${s.inc.map(t=>rowHtml(t.label,t.amount,incomeMeta(t))).join('')||'<div class="empty">Aucune entrée</div>'}</div>`};
  }
  if(id==='expenseTotal'){
    return {title:'Total à débiter ce mois',body:`<div class="metric-detail-total"><span>Total prévu</span><strong>${euro.format(s.expenseTotal)}</strong></div><div class="metric-detail-list">${s.ex.map(t=>rowHtml(t.label,t.amount,expenseMeta(t))).join('')||'<div class="empty">Aucune dépense</div>'}</div>`};
  }
  if(id==='debitedTotal'){
    const rows=s.ex.filter(t=>expenseDebited(t)>0);
    return {title:'Total déjà débité',body:`<div class="metric-detail-total"><span>Déjà passé</span><strong>${euro.format(s.debitedTotal)}</strong></div><div class="metric-detail-list">${rows.map(t=>rowHtml(t.label,expenseDebited(t),expenseMeta(t))).join('')||'<div class="empty">Aucun paiement passé</div>'}</div>`};
  }
  if(id==='remainingTotal'){
    const rows=s.ex.filter(t=>expenseRemaining(t)>0);
    return {title:'Reste à prélever',body:`<div class="metric-detail-total"><span>Encore à prélever</span><strong>${euro.format(s.remaining)}</strong></div><div class="metric-detail-list">${rows.map(t=>rowHtml(t.label,expenseRemaining(t),expenseMeta(t))).join('')||'<div class="empty">Plus rien à prélever</div>'}</div>`};
  }
  if(id==='forecast'){
    return {title:'Ce qu’il restera à la fin du mois',body:`<div class="metric-detail-breakdown"><div><span>Solde de début</span><strong>${euro.format(s.start)}</strong></div><div><span>+ Entrées prévues</span><strong>${euro.format(s.incomeTotal)}</strong></div><div><span>− Dépenses prévues</span><strong>${euro.format(s.expenseTotal)}</strong></div><div><span>${net>=0?'−':'+'} Mouvements nets d’épargne</span><strong>${euro.format(Math.abs(net))}</strong></div><div class="final"><span>Reste prévu</span><strong>${euro.format(s.forecast)}</strong></div></div><div class="metric-detail-list">${moves.map(x=>rowHtml(x.label,Math.abs(x.amount),(x.amount>=0?'vers épargne':'vers compte')+(x.date?' · '+x.date:''))).join('')}</div>`};
  }
  if(id==='currentBalance'){
    const incomes=s.inc.filter(t=>t.incomeStatus==='received'),expenses=s.ex.filter(t=>expenseDebited(t)>0);
    const rows=[...incomes.map(t=>rowHtml('+ '+t.label,t.amount,incomeMeta(t))),...expenses.map(t=>rowHtml('− '+t.label,expenseDebited(t),expenseMeta(t))),...moves.map(x=>rowHtml((x.amount>=0?'− ':'+ ')+(x.label||'Épargne'),Math.abs(x.amount),(x.amount>=0?'vers épargne':'vers compte')+(x.date?' · '+x.date:'')))].join('');
    return {title:'Solde réel du compte',body:`<div class="metric-detail-breakdown"><div><span>Solde de début</span><strong>${euro.format(s.start)}</strong></div><div><span>+ Revenus reçus</span><strong>${euro.format(s.receivedIncome)}</strong></div><div><span>− Paiements passés</span><strong>${euro.format(s.debitedTotal)}</strong></div><div><span>${net>=0?'−':'+'} Épargne nette</span><strong>${euro.format(Math.abs(net))}</strong></div><div class="final"><span>Solde réel</span><strong>${euro.format(s.currentBalance)}</strong></div></div><div class="metric-detail-list">${rows||'<div class="empty">Aucun mouvement réel ce mois</div>'}</div>`};
  }
  if(id==='savingsActualAmount'){
    const rows=[...savingsRows()].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).map(x=>rowHtml(x.label||'Épargne',Math.abs(Number(x.delta||0)),(Number(x.delta||0)>=0?'vers épargne':'vers compte')+(x.date?' · '+x.date:''))).join('');
    return {title:'Épargne actuelle',body:`<div class="metric-detail-total"><span>Total épargné</span><strong>${euro.format(savingsBalance())}</strong></div><div class="metric-detail-list">${rows}</div>`};
  }
  return null;
}
function openMetricDetail(id){
  ensureSavingsUI();
  const cfg=metricConfig(id);if(!cfg)return;
  document.getElementById('metricDetailTitle').textContent=cfg.title;
  document.getElementById('metricDetailBody').innerHTML=cfg.body;
  document.getElementById('metricDetailDialog').showModal();
}
function wireMetricCards(){
  document.querySelectorAll('#accountsView .metric.card').forEach(card=>{
    const strong=card.querySelector('strong[id]');if(!strong)return;
    card.dataset.metricDetail=strong.id;card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',(card.querySelector('span')?.textContent||'Détail')+' — ouvrir le détail');
  });
}

function patchVersion(){
  const v=document.querySelector('.top-brand h1 small');if(v)v.textContent='V'+SAVINGS_LEDGER_VERSION;
  const badge=document.getElementById('mcVersionBadge');if(badge)badge.textContent='V'+SAVINGS_LEDGER_VERSION;
  document.title='Mes Comptes · V'+SAVINGS_LEDGER_VERSION;
}

render=function(){
  oldRender();
  ensureSavingsUI();
  renderSavingsLedger();
  wireMetricCards();
  patchVersion();
};

document.body.addEventListener('click',e=>{
  const del=e.target.closest('[data-savings-delete]');
  if(del){
    e.preventDefault();e.stopPropagation();
    const row=savingsRows().find(x=>x.id===del.dataset.savingsDelete);if(!row)return;
    if(!confirm(`Annuler ce mouvement d’épargne de ${euro.format(Math.abs(Number(row.delta||0)))} ?`))return;
    state.savingsLedger=savingsRows().filter(x=>x.id!==row.id);persistState();render();return;
  }
  const card=e.target.closest('#accountsView .metric.card[data-metric-detail]');
  if(card){e.preventDefault();openMetricDetail(card.dataset.metricDetail);}
},true);
document.body.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  const card=e.target.closest?.('#accountsView .metric.card[data-metric-detail]');if(!card)return;
  e.preventDefault();openMetricDetail(card.dataset.metricDetail);
},true);

render();
})();
