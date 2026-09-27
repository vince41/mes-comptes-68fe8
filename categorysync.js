(function(){
'use strict';
const CATEGORY_SYNC_VERSION='0.5.16';
const RULES_KEY='mes-comptes-category-rules-v3';

function clean(v){return String(v||'').trim().replace(/\s+/g,' ');}
function norm(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function cents(v){return Math.round(Number(v||0)*100);}
function addMonths(m,n){
  if(!/^\d{4}-\d{2}$/.test(String(m||'')))return '';
  const [y,mo]=String(m).split('-').map(Number);
  const d=new Date(y,mo-1+n,1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function installmentSeriesKey(t){
  const count=Number(t?.installmentCount||0);
  const index=Number(t?.installmentIndex||0);
  const month=String(t?.month||'');
  if(count<2||index<1||index>count||!/^\d{4}-\d{2}$/.test(month))return '';
  const start=addMonths(month,-(index-1));
  return 'inst:'+cents(t.amount)+'|'+count+'|'+start;
}
function recurringFallbackKey(t){
  if(!t?.recurring)return '';
  return 'rec:'+norm(t.label)+'|'+cents(t.amount);
}
function loadRules(){
  try{const x=JSON.parse(localStorage.getItem(RULES_KEY)||'[]');return Array.isArray(x)?x:[];}
  catch(e){return [];}
}
function saveRules(rules){localStorage.setItem(RULES_KEY,JSON.stringify(rules));}
function identityKeys(t){
  const keys=[];
  const ik=installmentSeriesKey(t); if(ik)keys.push(ik);
  if(t?.installmentGroup)keys.push('installGroup:'+t.installmentGroup);
  if(t?.seriesId)keys.push('series:'+t.seriesId);
  const rk=recurringFallbackKey(t); if(rk)keys.push(rk);
  return keys;
}
function ruleFor(t){
  const keys=identityKeys(t);
  if(!keys.length)return null;
  const rules=loadRules();
  for(const key of keys){
    const r=rules.find(x=>x.key===key&&x.category);
    if(r)return r;
  }
  return null;
}
function sameSeries(snapshot,t){
  if(!snapshot||!t||t.type!=='expense')return false;
  const group=snapshot.installmentGroup||'';
  if(group&&t.installmentGroup===group)return true;
  const series=snapshot.seriesId||'';
  if(series&&t.seriesId===series)return true;
  const ik=installmentSeriesKey(snapshot);
  if(ik&&installmentSeriesKey(t)===ik)return true;
  const rk=recurringFallbackKey(snapshot);
  if(rk&&recurringFallbackKey(t)===rk)return true;
  return false;
}
function membersFor(before,after){
  const seed=before||after;
  if(!seed)return [];
  let rows=(state.transactions||[]).filter(t=>sameSeries(seed,t));
  if(after&&!rows.some(t=>t.id===after.id))rows.push(after);
  return rows;
}
function replaceSeriesRule(before,after,members,category){
  category=clean(category);
  if(!category)return;
  const keySet=new Set();
  for(const t of [before,after,...members]){
    if(!t)continue;
    for(const k of identityKeys(t))keySet.add(k);
  }
  let rules=loadRules().filter(r=>!keySet.has(r.key));
  const now=new Date().toISOString();
  for(const k of keySet)rules.push({key:k,category,updatedAt:now});
  saveRules(rules);
}
function applyStoredRules(){
  let changed=0;
  for(const t of state.transactions||[]){
    if(t?.type!=='expense')continue;
    const r=ruleFor(t);
    if(r&&clean(t.category)!==clean(r.category)){
      t.category=r.category;
      t.manualCategory=true;
      changed++;
    }
  }
  return changed;
}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
function toast(msg){
  try{
    const n=document.createElement('div');n.textContent=msg;
    n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;background:#082f50;color:#eaf8ff;border:1px solid #2d6b97;border-radius:12px;padding:9px 12px;font:700 13px system-ui;box-shadow:0 6px 18px #0008;max-width:92vw;text-align:center';
    document.body.appendChild(n);setTimeout(()=>n.remove(),2800);
  }catch(e){}
}

const previousAutoCategory=autoCategory;
autoCategory=function(t){
  const r=ruleFor(t);
  return r?.category||previousAutoCategory(t);
};

const previousProjected=typeof projectedTransactions==='function'?projectedTransactions:null;
if(previousProjected){
  projectedTransactions=function(m){
    const rows=previousProjected(m);
    return rows.map(t=>{
      const r=ruleFor(t);
      return r?{...t,category:r.category,manualCategory:true}:t;
    });
  };
}

const btn=document.getElementById('saveTx');
if(btn){
  const previous=btn.onclick;
  btn.onclick=function(e){
    const editId=document.getElementById('editId')?.value||'';
    const beforeTx=editId?state.transactions.find(t=>t.id===editId):null;
    const before=beforeTx?JSON.parse(JSON.stringify(beforeTx)):null;
    const selectedCategory=clean(document.getElementById('category')?.value);
    const typedLabel=clean(document.getElementById('label')?.value);
    const type=document.getElementById('txType')?.value;

    previous.call(this,e);

    const dlg=document.getElementById('txDialog');
    if(dlg?.open||type!=='expense'||!editId||!before)return;

    const after=state.transactions.find(t=>t.id===editId);
    if(!after)return;

    const members=membersFor(before,after);
    if(members.length<2)return;

    const categoryChanged=selectedCategory&&clean(before.category)!==selectedCategory;
    const labelChanged=typedLabel&&clean(before.label)!==typedLabel;

    if(!categoryChanged&&!labelChanged)return;

    for(const t of members){
      if(labelChanged)t.label=typedLabel;
      if(categoryChanged){
        t.category=selectedCategory;
        t.manualCategory=true;
      }
    }

    if(categoryChanged)replaceSeriesRule(before,after,members,selectedCategory);

    persist();
    if(typeof render==='function')render();

    const parts=[];
    if(labelChanged)parts.push('nom');
    if(categoryChanged)parts.push('catégorie');
    toast('Le '+parts.join(' et la ')+' a été synchronisé sur toute la série ('+members.length+' échéances).');
  };
}

const changed=applyStoredRules();
if(changed){persist();if(typeof render==='function')render();}
})();