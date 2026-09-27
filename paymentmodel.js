(function(){
'use strict';
const PAYMENT_MODEL_VERSION='0.5.23';

function clean(v){return String(v??'').trim();}
function num(v){const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0;}
function money(v){return Math.round(Number(v||0)*100)/100;}
function cents(v){return Math.round(Number(v||0)*100);}
function euro2(v){try{return euro.format(Number(v||0));}catch(e){return money(v).toFixed(2)+' €';}}

function ensureUI(){
  if(document.getElementById('paymentRoutingFields'))return;
  const method=document.getElementById('paymentMethod');
  const expense=document.getElementById('expenseFields');
  if(!method||!expense)return;

  const od=method.querySelector('option[value="direct_debit"]');
  const oc=method.querySelector('option[value="card_deferred"]');
  if(od)od.textContent='Prélèvement direct sur le compte';
  if(oc)oc.textContent='Carte à débit différé';

  const firstRow=method.closest('.fields2');
  if(!firstRow)return;

  const methodLabel=method.closest('label');
  if(methodLabel)methodLabel.style.display='none';

  const sourceWrap=document.createElement('div');
  sourceWrap.id='debitSourceWrap';
  sourceWrap.className='fields2';
  sourceWrap.innerHTML='<label><span>Débité via</span><select id="debitSource"><option value="account_direct">Compte direct / prélèvement</option><option value="card_vincent">Carte différée Vincent</option><option value="card_lili">Carte différée Lili</option></select><small>Choisis où la dépense sera réellement débitée.</small></label>';
  firstRow.insertAdjacentElement('beforebegin',sourceWrap);

  const wrap=document.createElement('div');
  wrap.id='paymentRoutingFields';
  wrap.className='fields2';
  wrap.innerHTML=
    '<label id="cardOwnerWrap"><span>Carte débit différé utilisée</span><select id="cardOwner"><option value="">Choisir la carte</option><option value="Vincent">Carte Vincent</option><option value="Lili">Carte Lili</option></select><small>Indépendant de la personne concernée par la dépense.</small></label>'+
    '<label id="bankPartsWrap"><span>Nombre de paiements / prélèvements</span><input id="bankPartCount" type="number" min="1" max="12" value="1"><span style="margin-top:7px">Calcul des prélèvements</span><select id="bankPartMode"><option value="split_total">Répartir le montant total</option><option value="repeat_each">Répéter ce montant à chaque prélèvement</option></select><small>Ex. WoW : 25,98 € répartis en 2 = 12,99 € + 12,99 €. Netlify : 5 € répété 2 fois = 10 € au total.</small></label>';
  firstRow.insertAdjacentElement('afterend',wrap);

  const prev=document.createElement('div');
  prev.id='bankPartsPreview';
  prev.style.cssText='display:none;margin:-2px 0 10px;padding:9px 11px;border:1px solid #245b7f;border-radius:10px;background:#06233b;color:#b9d9ec;font-size:.78rem';
  wrap.insertAdjacentElement('afterend',prev);

  const ownerLabel=document.getElementById('owner')?.closest('label');
  if(ownerLabel){
    const span=ownerLabel.querySelector('span');
    if(span)span.textContent='Qui est concerné par la dépense ?';
  }

  method.addEventListener('change',()=>{
    syncUI();
    if(method.value==='card_deferred')updateDebitMonth(true);
    else if(method.value==='direct_debit'&&!debitMonthTouched){
      const dm=document.getElementById('debitMonth');if(dm)dm.value=state.currentMonth;
    }
  });
  document.getElementById('debitSource')?.addEventListener('change',()=>{
    applySourceToLegacyFields();
    syncUI();
    updateDebitMonth(true);
  });
  document.getElementById('cardOwner')?.addEventListener('change',()=>updateDebitMonth(true));
  document.getElementById('bankPartCount')?.addEventListener('input',updatePreview);
  document.getElementById('bankPartMode')?.addEventListener('change',updatePreview);
  document.getElementById('amount')?.addEventListener('input',updatePreview);
  document.getElementById('date')?.addEventListener('change',()=>updateDebitMonth(false));
  document.getElementById('installBox')?.addEventListener('change',syncUI);
}

function inferCardOwner(t){
  if(t?.cardOwner==='Vincent'||t?.cardOwner==='Lili')return t.cardOwner;
  if(t?.paymentMethod!=='card_deferred')return '';
  if(t.owner==='Vincent'||t.owner==='Lili')return t.owner;
  const v=Number(t.splitVincent||0),l=Number(t.splitLili||0);
  if(v>0&&l<=0)return 'Vincent';
  if(l>0&&v<=0)return 'Lili';
  return '';
}

function splitAmounts(total,count){
  count=Math.max(1,Math.min(12,Number(count||1)));
  const totalC=cents(total);
  const base=Math.floor(totalC/count);
  let rem=totalC-base*count;
  const arr=[];
  for(let i=0;i<count;i++){
    const c=base+(i>=count-rem?1:0);
    arr.push(c/100);
  }
  return arr;
}

function updatePreview(){
  const box=document.getElementById('bankPartsPreview');
  const countEl=document.getElementById('bankPartCount');
  const amountEl=document.getElementById('amount');
  const source=document.getElementById('debitSource')?.value||'account_direct';
  if(!box||!countEl||!amountEl||source!=='account_direct'){if(box)box.style.display='none';return;}
  const n=Math.max(1,Math.min(12,Number(countEl.value||1)));
  const amount=num(amountEl.value);
  if(n<=1||amount<=0){box.style.display='none';return;}
  const mode=document.getElementById('bankPartMode')?.value||'split_total';
  const parts=mode==='repeat_each'?Array.from({length:n},()=>money(amount)):splitAmounts(amount,n);
  const total=money(parts.reduce((s,x)=>s+Number(x||0),0));
  box.style.display='block';
  box.textContent=n+' prélèvements : '+parts.map((x,i)=>(i+1)+'/'+n+' '+euro2(x)).join(' · ')+' · Total prévu '+euro2(total);
}

function syncUI(){
  ensureUI();
  const install=!!document.getElementById('installBox')?.checked;
  const cw=document.getElementById('cardOwnerWrap');
  const bw=document.getElementById('bankPartsWrap');
  const source=document.getElementById('debitSource')?.value||'account_direct';
  const count=document.getElementById('bankPartCount');
  const mode=document.getElementById('bankPartMode');
  if(cw)cw.style.display='none';
  if(bw){
    bw.style.display='grid';
    bw.style.opacity=(source==='account_direct'&&!install)?'1':'.55';
  }
  const enabled=source==='account_direct'&&!install;
  if(count)count.disabled=!enabled;
  if(mode)mode.disabled=!enabled;
  const hint=bw?.querySelector('small');
  if(hint){
    hint.textContent=enabled
      ? 'Ex. WoW : 25,98 € répartis en 2 = 12,99 € + 12,99 €. Netlify : 5 € répété 2 fois = 10 € au total.'
      : install
        ? 'Le suivi 4× utilise déjà ses propres échéances mensuelles.'
        : 'Les paiements multiples séparés s’utilisent avec Compte direct / prélèvement.';
  }
  updatePreview();
}

function sourceFromTx(t){
  if(t?.paymentMethod==='card_deferred'){
    const card=inferCardOwner(t);
    return card==='Lili'?'card_lili':'card_vincent';
  }
  return 'account_direct';
}
function applySourceToLegacyFields(){
  const source=document.getElementById('debitSource')?.value||'account_direct';
  const method=document.getElementById('paymentMethod');
  const card=document.getElementById('cardOwner');
  if(source==='card_vincent'){
    if(method)method.value='card_deferred';
    if(card)card.value='Vincent';
  }else if(source==='card_lili'){
    if(method)method.value='card_deferred';
    if(card)card.value='Lili';
  }else{
    if(method)method.value='direct_debit';
    if(card)card.value='';
  }
}
function updateDebitMonth(force){
  const source=document.getElementById('debitSource')?.value||'account_direct';
  const dm=document.getElementById('debitMonth');
  if(!dm)return;
  if(source==='card_vincent'||source==='card_lili'){
    const card=source==='card_lili'?'Lili':'Vincent';
    const date=document.getElementById('date')?.value;
    if(!date)return;
    if(force||!debitMonthTouched)dm.value=predictedDebitMonth(date,card);
  }else if(force||!debitMonthTouched){
    dm.value=state.currentMonth;
  }
}

function ensureCommunSplit(){
  if(document.getElementById('txType')?.value!=='expense')return;
  if(document.getElementById('owner')?.value!=='Commun')return;
  const amount=money(num(document.getElementById('amount')?.value));
  if(!(amount>0))return;
  const v=document.getElementById('splitV'),l=document.getElementById('splitL');
  if(!v||!l)return;
  const vr=clean(v.value),lr=clean(l.value);
  if(!vr&&!lr){
    const vc=Math.floor(cents(amount)/2),lc=cents(amount)-vc;
    v.value=(vc/100).toFixed(2);l.value=(lc/100).toFixed(2);
  }else if(vr&&!lr){
    const rest=money(amount-num(vr));if(rest>=0)l.value=rest.toFixed(2);
  }else if(!vr&&lr){
    const rest=money(amount-num(lr));if(rest>=0)v.value=rest.toFixed(2);
  }
}

function makeBankParts(amount,count,old,mode='split_total',unitAmount=0){
  const amounts=mode==='repeat_each'
    ? Array.from({length:Math.max(1,Math.min(12,Number(count||1)))},()=>money(unitAmount||0))
    : splitAmounts(amount,count);
  return amounts.map((a,i)=>({
    id:old?.[i]?.id||('part-'+(i+1)),
    amount:a,
    passed:!!old?.[i]?.passed
  }));
}
function recalcDebited(t){
  if(!Array.isArray(t.bankParts)||!t.bankParts.length)return;
  t.debitedAmount=money(t.bankParts.reduce((s,p)=>s+(p.passed?Number(p.amount||0):0),0));
}
function persist(){
  try{state.transactions=categorizeTransactions(state.transactions);}catch(e){}
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
}
function editTargets(t){
  if(!t)return[];
  if(t.seriesId)return (state.transactions||[]).filter(x=>x.seriesId===t.seriesId);
  if(t.installmentGroup)return (state.transactions||[]).filter(x=>x.installmentGroup===t.installmentGroup);
  return[t];
}

ensureUI();
const previousOpenTx=openTx;
openTx=function(type,t=null){
  previousOpenTx(type,t);
  ensureUI();
  if(type!=='expense')return;
  const card=document.getElementById('cardOwner');
  const source=document.getElementById('debitSource');
  const count=document.getElementById('bankPartCount');
  const mode=document.getElementById('bankPartMode');
  const amountEl=document.getElementById('amount');
  if(source)source.value=t?sourceFromTx(t):'account_direct';
  if(card)card.value=t?inferCardOwner(t):'';
  if(count)count.value=Array.isArray(t?.bankParts)&&t.bankParts.length?t.bankParts.length:1;
  if(mode)mode.value=t?.bankPartMode==='repeat_each'?'repeat_each':'split_total';
  applySourceToLegacyFields();
  if(t?.bankPartMode==='repeat_each'&&amountEl){
    const unit=Number(t.bankPartUnitAmount||t.bankParts?.[0]?.amount||0);
    if(unit>0)amountEl.value=String(unit);
  }
  syncUI();
  if(!t)updateDebitMonth(false);
};

const saveBtn=document.getElementById('saveTx');
if(saveBtn){
  saveBtn.addEventListener('click',e=>{
    if(document.getElementById('txType')?.value!=='expense')return;
    ensureUI();

    applySourceToLegacyFields();
    const source=document.getElementById('debitSource')?.value||'account_direct';
    const method=document.getElementById('paymentMethod')?.value;
    const cardOwner=source==='card_lili'?'Lili':source==='card_vincent'?'Vincent':'';
    if(method==='card_deferred'&&!cardOwner){
      e.preventDefault();e.stopImmediatePropagation();
      alert('Choisis Carte Vincent ou Carte Lili pour un paiement en débit différé.');
      return;
    }

    const editId=document.getElementById('editId')?.value||'';
    const beforeIds=new Set((state.transactions||[]).map(t=>t.id));
    const count=Math.max(1,Math.min(12,Number(document.getElementById('bankPartCount')?.value||1)));
    const installment=!!document.getElementById('installBox')?.checked;
    const partMode=document.getElementById('bankPartMode')?.value||'split_total';
    const amountEl=document.getElementById('amount');
    const enteredAmount=money(num(amountEl?.value));
    const repeatedUnit=(method==='direct_debit'&&count>1&&!installment&&partMode==='repeat_each')?enteredAmount:0;
    if(repeatedUnit>0&&amountEl){
      amountEl.value=String(money(repeatedUnit*count));
    }
    ensureCommunSplit();

    setTimeout(()=>{
      if(document.getElementById('txDialog')?.open){
        if(repeatedUnit>0&&amountEl)amountEl.value=String(repeatedUnit);
        updatePreview();
        return;
      }
      let targets=[];
      if(editId){
        const t=(state.transactions||[]).find(x=>x.id===editId);
        targets=editTargets(t);
      }else{
        targets=(state.transactions||[]).filter(t=>!beforeIds.has(t.id)&&t.type==='expense');
      }
      if(!targets.length)return;

      for(const t of targets){
        if(method==='card_deferred')t.cardOwner=cardOwner;
        else delete t.cardOwner;

        if(method==='direct_debit'&&count>1&&!installment){
          if(partMode==='repeat_each'&&repeatedUnit>0){
            t.bankPartMode='repeat_each';
            t.bankPartUnitAmount=repeatedUnit;
            t.amount=money(repeatedUnit*count);
            t.bankParts=makeBankParts(t.amount,count,t.bankParts,'repeat_each',repeatedUnit);
          }else{
            t.bankPartMode='split_total';
            delete t.bankPartUnitAmount;
            t.bankParts=makeBankParts(t.amount,count,t.bankParts,'split_total',0);
          }
          recalcDebited(t);
        }else{
          delete t.bankPartMode;
          delete t.bankPartUnitAmount;
          if(Array.isArray(t.bankParts))delete t.bankParts;
        }
      }
      persist();
      if(typeof render==='function')render();
    },0);
  },true);
}

const previousProjected=typeof projectedTransactions==='function'?projectedTransactions:null;
if(previousProjected){
  projectedTransactions=function(m){
    return previousProjected(m).map(t=>{
      if(!t.projected||!Array.isArray(t.bankParts)||t.bankParts.length<2)return t;
      const parts=t.bankParts.map(p=>({...p,passed:false}));
      return {...t,bankParts:parts,debitedAmount:0};
    });
  };
}

const previousTxMeta=typeof txMeta==='function'?txMeta:null;
if(previousTxMeta){
  txMeta=function(t){
    const bits=[];
    const base=previousTxMeta(t);if(base)bits.push(base);
    if(t?.paymentMethod==='card_deferred'&&t.cardOwner)bits.push('Carte '+t.cardOwner);
    if(Array.isArray(t?.bankParts)&&t.bankParts.length>1){
      const done=t.bankParts.filter(p=>p.passed).length;
      bits.push(done+'/'+t.bankParts.length+' prélèvements passés');
    }
    return bits.join(' · ');
  };
}

window.MesComptesExpenseActions=function(t){
  if(!Array.isArray(t?.bankParts)||t.bankParts.length<2)return '';
  let html=t.projected
    ? '<button data-action="projectEdit" data-id="'+t.id+'">Modifier</button>'
    : '<button data-action="edit" data-id="'+t.id+'">Modifier</button>';
  t.bankParts.forEach((p,i)=>{
    const label=(p.passed?'↩ ':'✓ ')+euro2(p.amount)+' ('+(i+1)+'/'+t.bankParts.length+')';
    html+='<button data-action="'+(p.passed?'bankPartUndo':'bankPartPass')+'" data-id="'+t.id+'" data-part="'+i+'">'+label+'</button>';
  });
  if(!t.projected)html+='<button data-action="delete" data-id="'+t.id+'">🗑</button>';
  return html;
};

function materializeProjected(id){
  let p=null;
  try{p=(typeof effectiveTransactions==='function'?effectiveTransactions(state.currentMonth):[]).find(x=>x.id===id);}catch(e){}
  if(!p||!p.projected)return (state.transactions||[]).find(x=>x.id===id)||null;
  const real={...p,projected:false,source:'Prévision enregistrée',bankParts:Array.isArray(p.bankParts)?p.bankParts.map(x=>({...x})):p.bankParts};
  state.transactions.push(real);
  return real;
}

document.body.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');
  if(!b)return;
  const a=b.dataset.action;

  if(a==='edit'){
    const t=(state.transactions||[]).find(x=>x.id===b.dataset.id);
    if(!t)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    openTx(t.type,t);
    return;
  }

  if(a==='bankPartPass'||a==='bankPartUndo'){
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    const t=materializeProjected(b.dataset.id);if(!t||!Array.isArray(t.bankParts))return;
    const i=Number(b.dataset.part);if(!Number.isInteger(i)||!t.bankParts[i])return;
    t.bankParts[i].passed=a==='bankPartPass';
    recalcDebited(t);
    if(t.autoValidate)t.autoValidationPaused=true;
    delete t.autoValidatedAt;
    persist();if(typeof render==='function')render();
    return;
  }

  if(a==='unpay'||a==='undoPassed'){
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    const t=(state.transactions||[]).find(x=>x.id===b.dataset.id);if(!t)return;
    t.debitedAmount=0;
    if(Array.isArray(t.bankParts))t.bankParts.forEach(p=>p.passed=false);
    if(t.autoValidate)t.autoValidationPaused=true;
    delete t.autoValidatedAt;
    persist();if(typeof render==='function')render();
  }
},true);

syncUI();
if(typeof render==='function')render();
})();