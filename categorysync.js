(function(){
'use strict';
const SERIES_SYNC_VERSION='0.5.17';
const RULES_KEY='mes-comptes-category-rules-v3';
const MIGRATION_KEY='mes-comptes-series-rules-v0517';

function clean(v){return String(v||'').trim().replace(/\s+/g,' ');}
function norm(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function cents(v){return Math.round(Number(v||0)*100);}
function addM(m,n){
  if(!/^\d{4}-\d{2}$/.test(String(m||'')))return '';
  const [y,mo]=String(m).split('-').map(Number),d=new Date(y,mo-1+n,1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function stableInstallmentKey(t){
  const total=Number(t?.installmentCount||0),idx=Number(t?.installmentIndex||0),m=String(t?.month||'');
  if(total<2||idx<1||idx>total||!/^\d{4}-\d{2}$/.test(m))return '';
  return 'inst:'+cents(t.amount)+'|'+total+'|'+addM(m,-(idx-1));
}
function legacyInstallmentKey(t){
  const total=Number(t?.installmentCount||0),idx=Number(t?.installmentIndex||0),m=String(t?.month||'');
  if(total<2||idx<1||idx>total||!/^\d{4}-\d{2}$/.test(m))return '';
  return 'instsig:'+norm(t.label)+'|'+cents(t.amount)+'|'+total+'|'+addM(m,-(idx-1));
}
function keys(t){
  const a=[];
  const sk=stableInstallmentKey(t),lk=legacyInstallmentKey(t);
  if(sk)a.push(sk); if(lk)a.push(lk);
  if(t?.installmentGroup)a.push('installGroup:'+t.installmentGroup,'install:'+t.installmentGroup);
  if(t?.seriesId)a.push('series:'+t.seriesId);
  return [...new Set(a)];
}
function loadRules(){try{const x=JSON.parse(localStorage.getItem(RULES_KEY)||'[]');return Array.isArray(x)?x:[]}catch(e){return []}}
function saveRules(x){localStorage.setItem(RULES_KEY,JSON.stringify(x))}
function findRule(t){
  const ks=keys(t),rs=loadRules();
  for(const k of ks){
    const hit=rs.filter(r=>r.key===k).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))[0];
    if(hit)return hit;
  }
  return null;
}
function upsertSeriesRule(t,patch){
  const ks=keys(t); if(!ks.length)return;
  let rs=loadRules(),now=new Date().toISOString();
  for(const k of ks){
    const i=rs.findIndex(r=>r.key===k);
    const old=i>=0?rs[i]:{key:k};
    const next={...old,...patch,key:k,updatedAt:now};
    if(i>=0)rs[i]=next;else rs.push(next);
  }
  saveRules(rs);
}
function sameSeries(a,b){
  if(!a||!b||b.type!=='expense')return false;
  if(a.installmentGroup&&b.installmentGroup===a.installmentGroup)return true;
  if(a.seriesId&&b.seriesId===a.seriesId)return true;
  const ak=stableInstallmentKey(a),bk=stableInstallmentKey(b);
  return !!ak&&ak===bk;
}
function migrateOldRules(){
  if(localStorage.getItem(MIGRATION_KEY)==='done')return 0;
  let made=0;
  for(const t of state.transactions||[]){
    if(t?.type!=='expense'||Number(t.installmentCount||0)<2)continue;
    const rs=loadRules(),lk=legacyInstallmentKey(t),sk=stableInstallmentKey(t);
    const old=rs.find(r=>r.key===lk);
    if(old&&sk&&!rs.some(r=>r.key===sk)){
      rs.push({...old,key:sk,updatedAt:new Date().toISOString()});saveRules(rs);made++;
    }
    const auto=clean(previousAutoCategory(t)),current=clean(t.category);
    if(current&&current.toLocaleLowerCase('fr-FR')!==auto.toLocaleLowerCase('fr-FR')){
      upsertSeriesRule(t,{category:current});made++;
    }
  }
  localStorage.setItem(MIGRATION_KEY,'done');
  return made;
}
function applyRulesToStored(){
  let n=0;
  for(const t of state.transactions||[]){
    if(t?.type!=='expense')continue;
    const r=findRule(t);if(!r)continue;
    if(r.category&&clean(t.category)!==clean(r.category)){t.category=r.category;t.manualCategory=true;n++}
    if(r.label&&clean(t.label)!==clean(r.label)){t.label=r.label;n++}
  }
  return n;
}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
function toast(s){
  const n=document.createElement('div');n.textContent=s;
  n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;background:#082f50;color:#eaf8ff;border:1px solid #2d6b97;border-radius:12px;padding:9px 12px;font:700 13px system-ui;box-shadow:0 6px 18px #0008;max-width:92vw;text-align:center';
  document.body.appendChild(n);setTimeout(()=>n.remove(),2800);
}

const previousAutoCategory=autoCategory;
autoCategory=function(t){
  const r=findRule(t);
  return r?.category||previousAutoCategory(t);
};

const oldProjected=typeof projectedTransactions==='function'?projectedTransactions:null;
if(oldProjected){
  projectedTransactions=function(m){
    return oldProjected(m).map(t=>{
      const r=findRule(t);if(!r)return t;
      return {...t,category:r.category||t.category,label:r.label||t.label,manualCategory:!!r.category};
    });
  };
}

const saveBtn=document.getElementById('saveTx');
if(saveBtn){
  const prev=saveBtn.onclick;
  saveBtn.onclick=function(e){
    const id=document.getElementById('editId')?.value||'';
    const type=document.getElementById('txType')?.value;
    const beforeTx=id?state.transactions.find(x=>x.id===id):null;
    const before=beforeTx?JSON.parse(JSON.stringify(beforeTx)):null;
    const newCategory=clean(document.getElementById('category')?.value);
    const newLabel=clean(document.getElementById('label')?.value);

    prev.call(this,e);

    if(document.getElementById('txDialog')?.open||type!=='expense'||!before)return;
    const after=state.transactions.find(x=>x.id===id);if(!after)return;
    const series=(state.transactions||[]).filter(t=>sameSeries(before,t)||sameSeries(after,t));
    if(series.length<2)return;

    const categoryChanged=!!newCategory&&clean(before.category)!==newCategory;
    const labelChanged=!!newLabel&&clean(before.label)!==newLabel;
    if(!categoryChanged&&!labelChanged)return;

    for(const t of series){
      if(categoryChanged){t.category=newCategory;t.manualCategory=true}
      if(labelChanged)t.label=newLabel;
    }
    upsertSeriesRule(before,{
      ...(categoryChanged?{category:newCategory}:{}),
      ...(labelChanged?{label:newLabel}:{})
    });
    upsertSeriesRule(after,{
      ...(categoryChanged?{category:newCategory}:{}),
      ...(labelChanged?{label:newLabel}:{})
    });
    persist();
    if(typeof render==='function')render();
    toast((categoryChanged&&labelChanged?'Nom et catégorie synchronisés':categoryChanged?'Catégorie synchronisée':'Nom synchronisé')+' sur toute la série.');
  };
}

const migrated=migrateOldRules();
const changed=applyRulesToStored();
if(migrated||changed){persist();if(typeof render==='function')render()}
})();