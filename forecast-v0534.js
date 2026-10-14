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

function isCardInstallment(t){
  if(!t||t.type!=='expense')return false;
  const count=Number(t.installmentCount||0),series=Number(t.seriesCount||0);
  if(t.installmentGroup||count>1)return true;
  // Longue série sur CB (4×, 10×, etc.) : les mensualités ont été générées dans les transactions.
  if(t.seriesId&&series>1&&(t.finiteCreditSeries||series<=12))return true;
  const text=String(t.note||'')+' '+String(t.label||'');
  return /\b(?:paiement\s*)?(?:en\s*)?(?:[23456789]|1[012])\s*(?:x|fois)\b/i.test(text)
    || /\b[1-9]\d?\s*\/\s*(?:[23456789]|1[012])\b/.test(text);
}
function monthCardBreakdown(m){
  const ex=summary(m).ex||[];
  let installments=0,ordinary=0,total=0;
  for(const t of ex){
    const amount=cash(cardAmount(t,'Vincent')+cardAmount(t,'Lili'));
    if(amount<=0)continue;
    if(isCardInstallment(t))installments+=amount;
    else ordinary+=amount;
    total+=amount;
  }
  return {month:m,total:cash(total),installments:cash(installments),ordinary:cash(ordinary)};
}
function typicalCbRange(){
  const cfg=state.settings||{};
  const low=Number(cfg.cardForecastTypicalMin),high=Number(cfg.cardForecastTypicalMax);
  if(Number.isFinite(low)&&Number.isFinite(high)&&low>0&&high>=low&&high<=1000000)return {low,high};
  return {low:1800,high:2400};
}
function completedJointCardHistory(m){
  // Une seule date de prélèvement pour les deux cartes, pour ne pas mélanger les cycles.
  const last=[lastClosedDebitMonth('Vincent'),lastClosedDebitMonth('Lili')].sort()[0];
  const latest=last>=m?prevMonth(m):last;
  const history=[];
  for(let i=0;i<12&&history.length<6;i++){
    const h=addMonths(latest,-i);
    const row=monthCardBreakdown(h);
    if(row.total>0)history.push(row);
  }
  return history;
}
function cbTendency(m){
  const history=completedJointCardHistory(m),range=typicalCbRange();
  const historicalInstallments=history.length?average(history.map(x=>x.installments)):monthCardBreakdown(monthNow()).installments;
  const floor=Math.max(0,range.low-historicalInstallments);
  const ceiling=Math.max(floor,range.high-historicalInstallments);
  let variable,trend='historique insuffisant';
  if(history.length){
    const arr=history.map(x=>x.ordinary).sort((a,b)=>a-b);
    const mid=Math.floor(arr.length/2);
    const median=arr.length%2?arr[mid]:average([arr[mid-1],arr[mid]]);
    const cleaned=history.map(x=>Math.max(median*.8,Math.min(median*1.2,x.ordinary)));
    const recent=cleaned.slice(0,Math.min(3,cleaned.length)),older=cleaned.slice(recent.length);
    const recentAvg=average(recent),olderAvg=older.length?average(older):recentAvg;
    // 70 % sur les derniers cycles, 30 % sur les anciens, robustifiés autour de la médiane.
    const raw=.7*recentAvg+.3*olderAvg;
    const neutral=(floor+ceiling)/2;
    variable=history.length===1?(.45*raw+.55*neutral):history.length===2?(.75*raw+.25*neutral):raw;
    const drift=recentAvg-olderAvg;
    trend=history.length<3?'historique limité':drift>80?'en hausse':drift< -80?'en baisse':'stable';
  }else variable=(floor+ceiling)/2;
  // Fourchette habituelle : ancre du quotidien, pas plafond des dépenses réelles.
  const normal=cash(Math.max(floor,Math.min(ceiling,variable)));
  return {ordinaryBudget:normal,trend,history,range,samples:history.length,
    historicalInstallments:cash(historicalInstallments)};
}
function cardEstimate(m){
  const owners={},ownerKnown={};let known=0;
  for(const who of ['Vincent','Lili']){
    const hist=completedHistory(m,who),mean=cash(average(hist));
    const recorded=cash(cardCycleTotal(m,who));
    const progress=cycleProgressForDebitMonth(m,who);
    owners[who]={avg:mean,known:recorded,projected:recorded,missing:0,progress,samples:hist.length};
    ownerKnown[who]=recorded;
    known+=recorded;
  }
  known=cash(known);
  const trend=cbTendency(m),cycle=monthCardBreakdown(m);
  const scheduled=cycle.installments,alreadyOrdinary=cycle.ordinary;
  const setting=Number(state.settings?.cardForecastMonthlyTotal);
  const fixed=Number.isFinite(setting)&&setting>0;
  const anchorSetting=Number(state.settings?.cardForecastManualInstallmentAnchor);
  const anchor=Number.isFinite(anchorSetting)&&anchorSetting>=0?anchorSetting:monthCardBreakdown(monthNow()).installments;
  const normalBudget=fixed?cash(Math.max(0,setting-anchor)):trend.ordinaryBudget;
  const cycleOpen=owners.Vincent.progress<1||owners.Lili.progress<1;
  // Montant des achats déjà saisis (y compris les mensualités 4x prévues)
  // + UNIQUEMENT les achats courants encore à prévoir. Une fin de 4x baisse
  // automatiquement 'scheduled', une nouvelle échéance augmente cette partie.
  const additional=cycleOpen?cash(Math.max(0,normalBudget-alreadyOrdinary)):0;
  const projected=cash(known+additional);
  const gapV=Math.max(0,owners.Vincent.avg-ownerKnown.Vincent);
  const gapL=Math.max(0,owners.Lili.avg-ownerKnown.Lili);
  const weighted=gapV+gapL>0?gapV/(gapV+gapL):.5;
  const extraV=cash(additional*weighted),extraL=cash(additional-extraV);
  owners.Vincent.missing=extraV;owners.Lili.missing=extraL;
  owners.Vincent.projected=cash(owners.Vincent.known+extraV);
  owners.Lili.projected=cash(owners.Lili.known+extraL);
  return {owners,known,projected,avg:cash(trend.ordinaryBudget+trend.historicalInstallments),
    missing:additional,manual:fixed,manualTarget:fixed?cash(setting):0,trend:trend.trend,
    trendSamples:trend.samples,history:trend.history,normalBudget,
    scheduledInstallments:scheduled,alreadyOrdinary,typicalBounds:trend.range,
    historicalInstallments:trend.historicalInstallments};
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
  card.innerHTML='<span>Solde estimé fin de mois avec CB</span><strong id="mcEstimatedEnd"></strong><small id="mcEstimateDetails"></small><button id="mcAdjustCbForecast" type="button">Tendance CB / 4×</button>';
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
      <p style="margin:0;font-size:.86rem">La tendance combine les cycles CB complets Vincent + Lili en excluant les 4× de la moyenne des dépenses courantes. Les mensualités des 4× encore actifs sont ajoutées séparément.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label style="display:grid;gap:5px">Habituel minimum (€)<input id="mcCbTypicalMin" type="number" min="1" max="1000000" step="1" inputmode="decimal" style="width:100%;box-sizing:border-box;padding:9px;border-radius:8px"></label>
        <label style="display:grid;gap:5px">Habituel maximum (€)<input id="mcCbTypicalMax" type="number" min="1" max="1000000" step="1" inputmode="decimal" style="width:100%;box-sizing:border-box;padding:9px;border-radius:8px"></label>
      </div>
      <small>La fourchette guide les dépenses courantes mais n'empêche pas une nouvelle mensualité 4× d'augmenter la prévision.</small>
      <label style="display:grid;gap:6px">Budget total fixe (€), échéances 4× incluses au mois de référence
        <input id="mcCbForecastAmount" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" style="font:inherit;border-radius:9px;border:1px solid #77afc8;background:#f8feff;padding:10px;color:#13283a" required>
      </label>
      <p style="margin:0;font-size:.87rem">Le budget fixe est converti en dépenses courantes et mensualités 4×. Les nouveaux 4× augmentent la prévision ; ceux terminés la diminuent.</p>
      <p id="mcCbForecastInfo" style="margin:0"></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="mcCbForecastAuto" style="padding:10px;background:#234861;color:#fff;border:1px solid #5b8ca4;border-radius:9px">Moyenne automatique</button>
        <button type="button" id="mcCbForecastCancel" style="padding:10px;background:#234861;color:#fff;border:1px solid #5b8ca4;border-radius:9px">Annuler</button>
        <button type="submit" style="padding:10px;background:#116f99;color:#fff;border:1px solid #5cb9e0;border-radius:9px">Enregistrer</button>
      </div>
    </form>`;
    document.body.appendChild(d);
    d.querySelector('#mcCbForecastCancel').onclick=()=>d.close();
    function saveBounds(){
      const low=Number(d.querySelector('#mcCbTypicalMin').value);
      const high=Number(d.querySelector('#mcCbTypicalMax').value);
      if(!Number.isFinite(low)||!Number.isFinite(high)||low<=0||high<low||high>1000000){
        alert('Fourchette CB incorrecte : minimum positif et maximum supérieur au minimum.');
        return false;
      }
      if(!state.settings)state.settings={};
      state.settings.cardForecastTypicalMin=cash(low);
      state.settings.cardForecastTypicalMax=cash(high);
      return true;
    }
    d.querySelector('#mcCbForecastAuto').onclick=()=>{
      if(!saveBounds())return;
      delete state.settings.cardForecastMonthlyTotal;
      delete state.settings.cardForecastManualInstallmentAnchor;
      localStorage.setItem(KEY,JSON.stringify(state));
      d.close();render();
    };
    d.querySelector('#mcCbForecastForm').addEventListener('submit',ev=>{
      ev.preventDefault();
      const val=Number(d.querySelector('#mcCbForecastAmount').value);
      if(!Number.isFinite(val)||val<=0||val>1000000)return alert('Entre un montant CB mensuel valable.');
      if(!saveBounds())return;
      state.settings.cardForecastMonthlyTotal=cash(val);
      state.settings.cardForecastManualInstallmentAnchor=monthCardBreakdown(state.currentMonth).installments;
      localStorage.setItem(KEY,JSON.stringify(state));
      d.close();render();
    });
  }
  const auto=cardEstimate(state.currentMonth);
  const manual=Number(state.settings?.cardForecastMonthlyTotal||0);
  d.querySelector('#mcCbTypicalMin').value=String(auto.typicalBounds.low);
  d.querySelector('#mcCbTypicalMax').value=String(auto.typicalBounds.high);
  d.querySelector('#mcCbHistoryInfo').textContent='Prévision : dépenses courantes '+euro.format(auto.normalBudget)+' + échéances CB en plusieurs fois '+euro.format(auto.scheduledInstallments)+' = '+euro.format(auto.normalBudget+auto.scheduledInstallments)+' · tendance '+auto.trend+' ('+auto.trendSamples+' cycles complets).';
  d.querySelector('#mcCbForecastAmount').value=String(manual>0?manual:auto.normalBudget+auto.scheduledInstallments);
  d.querySelector('#mcCbForecastInfo').textContent=manual>0?'Budget fixe actif : '+euro.format(manual)+' à la date de saisi. Les 4× le font évoluer.':'Tendance automatique active. Pour enregistrer la fourchette, clique sur Moyenne automatique.';
  d.showModal();
}

function updateEstimatedCard(){
  ensureEstimatedCard();const e=estimatedMonth(state.currentMonth);
  const strong=document.getElementById('mcEstimatedEnd'),small=document.getElementById('mcEstimateDetails');
  if(strong){strong.textContent=euro.format(e.end);strong.classList.toggle('negative',e.end<0);}
  if(small)small.textContent=`Dépenses courantes prévues ${euro.format(e.cards.normalBudget)} · Échéances CB 4× actives ${euro.format(e.cards.scheduledInstallments)} · CB déjà saisies ${euro.format(e.cards.known)} · Autres achats CB à prévoir ${euro.format(e.missing)} · Tendance ${e.cards.trend}.`;
  const directInstallments=(summary(state.currentMonth).ex||[]).filter(t=>
    isCardInstallment(t)&&cardAmount(t,'Vincent')+cardAmount(t,'Lili')===0
    &&t.paymentMethod==='direct_debit');
  if(small&&directInstallments.length)small.textContent+=' Attention : '+directInstallments.length+
    ' échéance(s) en plusieurs fois sont classées en prélèvement direct. Si elles passent sur ta CB, corrige « Débité via » dans leurs fiches.';
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
  put('savingCardAvg',euro.format(c.normalBudget+c.scheduledInstallments));
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
  put('savingDetail',`Dépenses CB courantes prévues ${euro.format(c.normalBudget)} · Mensualités 4× actives ${euro.format(c.scheduledInstallments)} · CB enregistrées ${euro.format(c.known)} · Autres dépenses CB estimées ${euro.format(c.missing)} · Tendance ${c.trend}. Chaque fin ou nouveau paiement en plusieurs fois modifie les prévisions des mois concernés.`);
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