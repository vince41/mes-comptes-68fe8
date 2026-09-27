(function(){
'use strict';
const PAYMENT_MODEL_VERSION='0.5.20';

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

  const wrap=document.createElement('div');
  wrap.id='paymentRoutingFields';
  wrap.className='fields2';
  wrap.innerHTML=
    '<label id="cardOwnerWrap"><span>Carte débit différé utilisée</span><select id="cardOwner"><option value="">Choisir la carte</option><option value="Vincent">Carte Vincent</option><option value="Lili">Carte Lili</option></select><small>Indépendant de la personne concernée par la dépense.</small></label>'+
    '<label id="bankPartsWrap"><span>Nombre de prélèvements sur le compte</span><input id="bankPartCount" type="number" min="1" max="12" value="1"><small>Ex. 25,98 € avec 2 prélèvements = 2 × 12,99 €.</small></label>';
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
  document.getElementById('cardOwner')?.addEventListener('change',()=>updateDebitMonth(true));
  document.getElementById('bankPartCount')?.addEventListener('input',updatePreview);
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
  const method=document.getElementById('paymentMethod');
  if(!box||!countEl||!amountEl||method?.value!=='direct_debit'){if(box)box.style.display='none';return;}
  const n=Math.max(1,Math.min(12,Number(countEl.value||1)));
  const amount=num(amountEl.value);
  if(n<=1||amount<=0){box.style.display='none';return;}
  const parts=splitAmounts(amount,n);
  box.style.display='block';
  box.textContent=n+' prélèvements sur le compte : '+parts.map((x,i)=>(i+1)+'/'+n+' '+euro2(x)).join(' · ');
}

function syncUI(){
  ensureUI();
  const method=document.getElementById('paymentMethod')?.value;
  const install=!!document.getElementById('installBox')?.checked;
  const cw=document.getElementById('cardOwnerWrap');
  const bw=document.getElementById('bankPartsWrap');
  if(cw)cw.style.display=method==='card_deferred'?'grid':'none';
  if(bw)bw.style.display=method==='direct_debit'&&!install?'grid':'none';
  updatePreview();
}

function updateDebitMonth(force){
  const method=document.getElementById('paymentMethod')?.value;
  const dm=document.getElementById('debitMonth');
  if(!dm)return;
  if(method==='card_deferred'){
    const card=document.getElementById('cardOwner')?.value;
    const date=document.getElementById('date')?.value;
    if(!card||!date)return;
    if(force||!debitMonthTouched)dm.value=predictedDebitMonth(date,card);
  }else if(method==='direct_debit'&&(force||!debitMonthTouched)){
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

function makeBankParts(amount,count,old){
  const amounts=splitAmounts(amount,count);
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
  const count=document.getElementById('bankPartCount');
  if(card)card.value=t?inferCardOwner(t):(document.getElementById('owner')?.value==='Lili'?'Lili':'Vincent');
  if(count)count.value=Array.isArray(t?.bankParts)&&t.bankParts.length?t.bankParts.length:1;
  syncUI();
  if(!t)updateDebitMonth(false);
};

const saveBtn=document.getElementById('saveTx');
if(saveBtn){
  saveBtn.addEventListener('click',e=>{
    if(document.getElementById('txType')?.value!=='expense')return;
    ensureUI();

    const method=document.getElementById('paymentMethod')?.value;
    const cardOwner=document.getElementById('cardOwner')?.value||'';
    if(method==='card_deferred'&&!cardOwner){
      e.preventDefault();e.stopImmediatePropagation();
      alert('Choisis Carte Vincent ou Carte Lili pour un paiement en débit différé.');
      return;
    }

    ensureCommunSplit();

    const editId=document.getElementById('editId')?.value||'';
    const beforeIds=new Set((state.transactions||[]).map(t=>t.id));
    const count=Math.max(1,Math.min(12,Number(document.getElementById('bankPartCount')?.value||1)));
    const installment=!!document.getElementById('installBox')?.checked;

    setTimeout(()=>{
      if(document.getElementById('txDialog')?.open)return;
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
          t.bankParts=makeBankParts(t.amount,count,t.bankParts);
          recalcDebited(t);
        }else if(Array.isArray(t.bankParts)){
          delete t.bankParts;
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