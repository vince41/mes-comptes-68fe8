(function(){
'use strict';
// Prévisions uniquement : aucune transaction fictive, aucun changement du solde bancaire ou des données synchronisées.
const monthNow=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
const cash=n=>round(Number(n)||0);
const average=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
function lastClosedDebitMonth(owner){
  const m=monthNow();
  const preceding=prevMonth(m);
  const [y,mo]=preceding.split('-').map(Number);
  const configured=Number(state.settings?.[owner]?.closeDay||25);
  const closing=Math.min(Math.max(1,configured),new Date(y,mo,0).getDate());
  const closedAt=new Date(y,mo-1,closing,23,59,59,999);
  return new Date()>closedAt?m:prevMonth(m);
}
function completedHistory(m,owner){
  let latest=lastClosedDebitMonth(owner);
  if(latest>=m)latest=prevMonth(m);
  const history=[];
  for(let i=0;i<6;i++){
    const hm=addMonths(latest,-i);
    const total=cash(cardCycleTotal(hm,owner));
    if(total>0)history.push(total);
  }
  return history;
}
function cardEstimate(m){
  const owners={};let known=0,expected=0,avg=0,history=[];
  for(const who of ['Vincent','Lili']){
    const hist=completedHistory(m,who),mean=cash(average(hist));
    const recorded=cash(cardCycleTotal(m,who));
    const progress=cycleProgressForDebitMonth(m,who);
    // La moyenne historique represente le TOTAL du cycle, pas un budget a ajouter aux achats saisis.
    // Completer uniquement la difference non encore saisie. Ne rien ajouter si le cycle est clos.
    // Si les achats reels depassent la moyenne, privilegier le montant reel sans jamais le reduire.
    const predicted=progress>=1||!hist.length?recorded:cash(Math.max(recorded,mean));
    owners[who]={avg:mean,known:recorded,projected:predicted,missing:cash(Math.max(0,predicted-recorded)),progress,samples:hist.length};
    known+=recorded;expected+=predicted;avg+=mean;history=history.concat(hist);
  }
  // Un budget CB mensuel personnalisé prime sur la moyenne automatique, pour tous les mois futurs.
  // Les sommes déjà saisies sont incluses dans ce budget et ne sont jamais ajoutées deux fois.
  const setting=Number(state.settings?.cardForecastMonthlyTotal);
  const hasCustomBudget=Number.isFinite(setting)&&setting>0;
  // Quand les deux cycles sont déjà clos, seul le montant réellement saisi compte.
  const cycleOpen=owners.Vincent.progress<1||owners.Lili.progress<1;
  const manual=hasCustomBudget&&cycleOpen;
  if(manual){
    const total=cash(Math.max(known,setting));
    const missing=cash(total-known);
    const gapV=Math.max(0,owners.Vincent.avg-owners.Vincent.known);
    const gapL=Math.max(0,owners.Lili.avg-owners.Lili.known);
    const totalGap=gapV+gapL;
    const weighted=totalGap>0?gapV/totalGap:(avg>0?owners.Vincent.avg/avg:0.5);
    const vMissing=cash(missing*weighted);
    const lMissing=cash(missing-vMissing);
    owners.Vincent.missing=vMissing;
    owners.Lili.missing=lMissing;
    owners.Vincent.projected=cash(owners.Vincent.known+vMissing);
    owners.Lili.projected=cash(owners.Lili.known+lMissing);
    expected=total;
  }
  return {owners,known:cash(known),projected:cash(expected),avg:cash(avg),missing:cash(Math.max(0,expected-known)),history,manual,manualTarget:manual?cash(setting):0};
}
function estimatedMonth(m,cache=new Map(),level=0){
  if(cache.has(m))return cache.get(m);
  const s=summary(m),cards=cardEstimate(m),today=monthNow();
  if(m<today||level>60){
    const past={month:m,realStart:s.start,start:s.start,bookEnd:s.forecast,end:s.forecast,missing:0,cards};
    cache.set(m,past);return past;
  }
  const manual=Boolean(state.months?.[m]?.manualStart);
  const start=m===today||manual?s.start:estimatedMonth(prevMonth(m),cache,level+1).end;
  const missing=cards.missing;
  const end=cash(start+(s.forecast-s.start)-missing);
  const result={month:m,realStart:s.start,start:cash(start),bookEnd:s.forecast,end,missing,cards};
  cache.set(m,result);return result;
}
function adviceForMonth(m){
  const cache=new Map();
  const thisMonth=estimatedMonth(m,cache);
  const forward=[thisMonth,estimatedMonth(nextMonth(m),cache),estimatedMonth(addMonths(m,2),cache)];
  const allHist=[];
  for(const who of ['Vincent','Lili']){
    const h=completedHistory(m,who);
    // Dispersion sur des cycles complets et non sur des mois futurs incomplets.
    if(h.length)allHist.push({who,values:h});
  }
  const avg=thisMonth.cards.avg;
  let variation=0;
  if(allHist.length){
    const sumHist=[];
    for(let i=0;i<6;i++){
      const a=allHist.map(x=>x.values[i]).filter(v=>Number.isFinite(v));
      if(a.length===allHist.length)sumHist.push(a.reduce((s,v)=>s+v,0));
    }
    if(sumHist.length>1){const mean=average(sumHist);variation=Math.sqrt(average(sumHist.map(v=>(v-mean)**2)));}
  }
  const safety=cash(Math.max(100,Math.min(500,variation*.25+avg*.04)));
  const max=cash(Math.max(0,Math.min(...forward.map(x=>x.end))));
  const suggested=Math.max(0,Math.floor((max-safety)/10)*10);
  const sampleCount=Math.min(...['Vincent','Lili'].map(w=>thisMonth.cards.owners[w].samples));
  const confidence=sampleCount>=5?'Bonne':sampleCount>=3?'Moyenne':'Faible';
  return {thisMonth,forward,max,suggested,safety,variation,confidence};
}
function ensureEstimatedCard(){
  if(document.getElementById('mcEstimatedCard'))return;
  const grid=document.querySelector('#accountsView .grid');if(!grid)return;
  const card=document.createElement('article');card.id='mcEstimatedCard';card.className='card mc-estimate-card';
  card.innerHTML='<span>Solde estimé fin de mois avec CB</span><strong id="mcEstimatedEnd"></strong><small id="mcEstimateDetails"></small><button id="mcAdjustCbForecast" type="button">Ajuster ma moyenne CB</button>';
  card.querySelector('#mcAdjustCbForecast').addEventListener('click',openCbForecastDialog);
  const forecast=document.getElementById('forecast')?.closest('.metric');
  if(forecast)forecast.insertAdjacentElement('afterend',card);else grid.appendChild(card);
  if(!document.getElementById('mcEstimatedStyle')){
    const style=document.createElement('style');style.id='mcEstimatedStyle';
    style.textContent='.mc-estimate-card{display:flex;flex-direction:column;justify-content:center;gap:6px;padding:16px 19px;background:linear-gradient(145deg,#0a5261,#10345d);border:1px solid #48b2c7;border-radius:18px;color:#effaff}.mc-estimate-card span{font-size:.88rem;font-weight:850;color:#a9e6ed}.mc-estimate-card strong{font-size:1.65rem;font-weight:900;line-height:1.2}.mc-estimate-card strong.negative{color:#ff9da0}.mc-estimate-card small{font-size:.78rem;line-height:1.45;color:#d2e8f2}.mc-estimate-card button{margin-top:5px;background:#174b67;color:#f3fcff;border:1px solid #73bcd1;border-radius:10px;padding:9px;font:750 .82rem system-ui;cursor:pointer}';
    document.head.appendChild(style);
  }
}

function updateLiveBalanceCard(){
  // Le montant du mois consulté est de nouveau visible ; aucune carte du mois précédent.
  const old=document.getElementById('mcLiveBalanceCard');
  if(old)old.remove();
}
function openCbForecastDialog(){
  let d=document.getElementById('mcCbForecastDialog');
  if(!d){
    d=document.createElement('dialog');
    d.id='mcCbForecastDialog';
    d.style.cssText='box-sizing:border-box;width:min(92vw,480px);border:1px solid #66abc9;border-radius:16px;background:#102f45;color:#eef8ff;padding:20px;box-shadow:0 15px 50px #000a';
    d.innerHTML=`<form id="mcCbForecastForm" style="display:grid;gap:13px;font:14px/1.5 system-ui">
      <h3 style="margin:0">Prévision mensuelle des cartes CB</h3>
      <p id="mcCbHistoryInfo" style="margin:0"></p>
      <label style="display:grid;gap:6px">Budget total mensuel Vincent + Lili (€)
        <input id="mcCbForecastAmount" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" style="font:inherit;border-radius:9px;border:1px solid #77afc8;background:#f8feff;padding:10px;color:#13283a" required>
      </label>
      <p style="margin:0;font-size:.87rem">Montant prévu pour chaque prélèvement mensuel des deux cartes. Les achats déjà enregistrés sont déduits de ce budget. Si les dépenses réelles dépassent le budget, elles restent prises en compte.</p>
      <p id="mcCbForecastInfo" style="margin:0"></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="mcCbForecastAuto" style="padding:10px;background:#234861;color:#fff;border:1px solid #5b8ca4;border-radius:9px">Moyenne automatique</button>
        <button type="button" id="mcCbForecastCancel" style="padding:10px;background:#234861;color:#fff;border:1px solid #5b8ca4;border-radius:9px">Annuler</button>
        <button type="submit" style="padding:10px;background:#116f99;color:#fff;border:1px solid #5cb9e0;border-radius:9px">Enregistrer</button>
      </div>
    </form>`;
    document.body.appendChild(d);
    d.querySelector('#mcCbForecastCancel').onclick=()=>d.close();
    d.querySelector('#mcCbForecastAuto').onclick=()=>{
      if(!state.settings)state.settings={};
      delete state.settings.cardForecastMonthlyTotal;
      localStorage.setItem(KEY,JSON.stringify(state));
      d.close();render();
    };
    d.querySelector('#mcCbForecastForm').addEventListener('submit',ev=>{
      ev.preventDefault();
      const val=Number(d.querySelector('#mcCbForecastAmount').value);
      if(!Number.isFinite(val)||val<=0||val>1000000)return alert('Entre un montant CB mensuel valable.');
      if(!state.settings)state.settings={};
      state.settings.cardForecastMonthlyTotal=cash(val);
      localStorage.setItem(KEY,JSON.stringify(state));
      d.close();render();
    });
  }
  const auto=cardEstimate(state.currentMonth);
  const histTotal=euro.format(auto.avg);
  const manual=Number(state.settings?.cardForecastMonthlyTotal||0);
  d.querySelector('#mcCbHistoryInfo').textContent='Moyenne calculée sur les anciens cycles CB : '+histTotal+'.';
  d.querySelector('#mcCbForecastAmount').value=manual>0?String(manual):String(auto.avg||'');
  d.querySelector('#mcCbForecastInfo').textContent=manual>0?'Budget personnalisé actuel : '+euro.format(manual):'Mode automatique actuel : estimation à partir des cycles passés.';
  d.showModal();
}

function updateEstimatedCard(){
  ensureEstimatedCard();const e=estimatedMonth(state.currentMonth);
  const strong=document.getElementById('mcEstimatedEnd'),small=document.getElementById('mcEstimateDetails');
  if(strong){strong.textContent=euro.format(e.end);strong.classList.toggle('negative',e.end<0);}
  if(small)small.textContent=`Départ estimé ${euro.format(e.start)} · CB déjà comptées ${euro.format(e.cards.known)} · Référence CB ${euro.format(e.cards.projected)} (${e.cards.manual?'personnalisée':'moyenne auto'}) · CB encore à prévoir ${euro.format(e.missing)}. Aucun débit fictif.`;
  const book=document.getElementById('forecast')?.closest('.metric');
  if(book){const heading=book.querySelector('span'),description=book.querySelector('small');if(heading)heading.textContent='Reste fin de mois hors CB à estimer';if(description)description.textContent='solde comptable prévisionnel, sans dépenses CB encore inconnues';}
  const bankMetric=document.getElementById('currentBalance')?.closest('.metric');
  // Afficher le solde du MOIS SÉLECTIONNÉ, sans reprendre celui du mois précédent.
  if(bankMetric){
    bankMetric.style.display='';
    const heading=bankMetric.querySelector('span'),description=bankMetric.querySelector('small');
    if(state.currentMonth>monthNow()){
      if(heading)heading.textContent='Solde du compte simulé de '+monthLabel(state.currentMonth);
      if(description)description.textContent='départ de ce mois + revenus reçus − dépenses marquées débitées dans ce mois';
    }else if(state.currentMonth===monthNow()){
      if(heading)heading.textContent='Solde réel du compte';
      if(description)description.textContent='solde suivi selon les revenus reçus et les paiements passés';
    }else{
      if(heading)heading.textContent='Solde du compte de '+monthLabel(state.currentMonth);
      if(description)description.textContent='historique des opérations de ce mois';
    }
  }
  const initial=document.getElementById('startBalance')?.closest('.metric');
  if(initial&&state.currentMonth>monthNow()){
    const heading=initial.querySelector('span'),description=initial.querySelector('small');
    if(heading)heading.textContent='Départ comptable (hors CB estimées)';
    if(description)description.textContent='report comptable, pas un solde bancaire constaté';
  }
}
const previousRenderSavings=renderSavings;
renderSavings=function(){
  previousRenderSavings();
  const m=state.currentMonth;
  const a=adviceForMonth(m),c=a.thisMonth.cards;
  const put=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
  put('savingMonth',monthLabel(m));
  put('savingSuggested',euro.format(a.suggested));
  put('savingMax',euro.format(a.max));
  put('savingEnd',euro.format(a.thisMonth.end));
  put('savingReserve',euro.format(a.safety));
  put('savingCardAvg',euro.format(c.avg));
  put('savingCardKnown',euro.format(c.known));
  put('savingCardProjected',euro.format(c.projected));
  put('savingNextCredits',euro.format(sum(creditsForMonth(m),x=>x.amount)));
  put('savingFollowingMonth',monthLabel(m));
  put('savingConfidence',a.confidence);
  const reasons=a.forward.map(x=>`${monthLabel(x.month)} : ${euro.format(x.end)}`);
  put('savingReason',a.thisMonth.end<=0
    ?`Le mois de ${monthLabel(m)} ne dégage pas d'argent après les CB estimées : 0 € d'épargne conseillée.`
    :`Épargne évaluée à la FIN de ${monthLabel(m)}. Protection des soldes estimés : ${reasons.join(' · ')}. L'épargne proposée conserve en plus ${euro.format(a.safety)} de sécurité.`);
  put('savingLive',`CB de ${monthLabel(m)} : ${euro.format(c.known)} déjà saisies, ${euro.format(c.missing)} encore estimées.`);
  put('savingDetail',`Référence CB ${c.manual?'personnalisée':'automatique'} : ${euro.format(c.projected)} au total (moyenne historique : ${euro.format(c.avg)}). Vincent : ${euro.format(c.owners.Vincent.known)} déjà saisis. Lili : ${euro.format(c.owners.Lili.known)} déjà saisis. Complément CB : ${euro.format(c.missing)}. Aucun débit fictif.`);
  const intro=document.getElementById('savingMonth')?.previousSibling;
  if(intro&&intro.nodeType===3)intro.nodeValue='Épargne possible fin ';
  const hero=document.querySelector('#savingsView .savings-hero strong');if(hero)hero.textContent='Épargne conseillée pour le mois affiché';
  const explanation=document.querySelector('#savingsView .savings-hero p');if(explanation)explanation.textContent='Calcul basé sur le solde estimé en fin de mois, les charges automatiques, les CB habituelles et les mois suivants.';
  const maxLabel=document.getElementById('savingMax')?.parentElement?.querySelector('span');if(maxLabel)maxLabel.textContent='Maximum théorique fin de mois';
  const maxHelp=document.getElementById('savingMax')?.parentElement?.querySelector('small');if(maxHelp)maxHelp.textContent='après CB estimées et vérification des deux mois suivants';
  const endLabel=document.getElementById('savingEnd')?.parentElement?.querySelector('span');if(endLabel)endLabel.textContent='Solde estimé fin du mois affiché';
  const creditsLabel=document.getElementById('savingNextCredits')?.parentElement?.querySelector('span');if(creditsLabel)creditsLabel.textContent='Crédits / 4x du mois affiché';
  const suggest=document.getElementById('savingSuggested');if(suggest)suggest.classList.toggle('negative',false);
};
const oldRender=render;
render=function(){oldRender();updateEstimatedCard();updateLiveBalanceCard();};
render();
})();