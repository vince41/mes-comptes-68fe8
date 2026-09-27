(function(){
'use strict';
const CATEGORY_SYNC_VERSION='0.5.12.1';
const RULES_KEY='mes-comptes-category-rules-v2';
const MIGRATION_KEY='mes-comptes-category-migration-v0512';

function clean(v){return String(v||'').trim().replace(/\s+/g,' ');}
function norm(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function cents(v){return Math.round(Number(v||0)*100);}
function loadRules(){
  try{const x=JSON.parse(localStorage.getItem(RULES_KEY)||'[]');return Array.isArray(x)?x:[];}
  catch(e){return [];}
}
function saveRules(rules){localStorage.setItem(RULES_KEY,JSON.stringify(rules));}
function identityKeys(t){
  const keys=[];
  if(t?.installmentGroup)keys.push('install:'+t.installmentGroup);
  if(t?.seriesId)keys.push('series:'+t.seriesId);
  keys.push('match:'+[
    norm(t?.label),
    String(t?.paymentMethod||''),
    String(t?.owner||''),
    String(cents(t?.amount))
  ].join('|'));
  return keys;
}
function ruleFor(t){
  const month=String(t?.month||'');
  const keys=identityKeys(t);
  const rules=loadRules();
  for(const key of keys){
    const matches=rules
      .filter(x=>x.key===key && (!x.fromMonth||month>=x.fromMonth) && x.category)
      .sort((a,b)=>String(b.fromMonth||'').localeCompare(String(a.fromMonth||'')));
    if(matches.length)return matches[0];
  }
  return null;
}
function rememberRule(t,category,fromMonth){
  category=clean(category); if(!t||!category)return;
  const rules=loadRules(), start=String(fromMonth||t.month||'');
  for(const key of identityKeys(t)){
    const next={key,category,fromMonth:start,updatedAt:new Date().toISOString()};
    const i=rules.findIndex(x=>x.key===key && String(x.fromMonth||'')===start);
    if(i>=0)rules[i]=next; else rules.push(next);
  }
  saveRules(rules);
}
function applyRules(){
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
function persistState(){
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
}
function setVersion(){
  document.title='Mes Comptes · V'+CATEGORY_SYNC_VERSION;
  const v=document.querySelector('.top-brand h1 small');if(v)v.textContent='V'+CATEGORY_SYNC_VERSION;
  let badge=document.getElementById('mcVersionBadge');
  if(!badge){badge=document.createElement('div');badge.id='mcVersionBadge';badge.style.cssText='position:fixed;top:calc(env(safe-area-inset-top) + 8px);right:10px;z-index:99999;background:#0b3153;color:#f4c767;border:1px solid #2d6b97;border-radius:999px;padding:5px 9px;font:700 12px system-ui;box-shadow:0 4px 14px #0008';document.body.appendChild(badge);}
  badge.textContent='V'+CATEGORY_SYNC_VERSION;
}
function toast(msg){
  try{
    const n=document.createElement('div');n.textContent=msg;
    n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;background:#082f50;color:#eaf8ff;border:1px solid #2d6b97;border-radius:12px;padding:9px 12px;font:700 13px system-ui;box-shadow:0 6px 18px #0008;max-width:90vw;text-align:center';
    document.body.appendChild(n);setTimeout(()=>n.remove(),2600);
  }catch(e){}
}

const previousAutoCategory=autoCategory;

function migrateLegacyManualCategories(){
  if(localStorage.getItem(MIGRATION_KEY)==='done')return 0;
  const rows=(state.transactions||[])
    .filter(t=>t?.type==='expense'&&(t.installmentGroup||t.seriesId||t.recurring))
    .sort((a,b)=>String(a.month||'').localeCompare(String(b.month||''))||String(a.date||'').localeCompare(String(b.date||'')));
  let found=0;
  for(const t of rows){
    const current=clean(t.category);
    if(!current)continue;
    const automatic=clean(previousAutoCategory(t));
    if(current.toLocaleLowerCase('fr-FR')!==automatic.toLocaleLowerCase('fr-FR')){
      rememberRule(t,current,t.month||'');
      t.manualCategory=true;
      found++;
    }
  }
  localStorage.setItem(MIGRATION_KEY,'done');
  return found;
}

autoCategory=function(t){
  const r=ruleFor(t);
  return r?.category||previousAutoCategory(t);
};

const previousProjected=typeof projectedTransactions==='function'?projectedTransactions:null;
if(previousProjected){
  projectedTransactions=function(m){
    const rows=previousProjected(m);
    return rows.map(t=>{
      const r=ruleFor({...t,month:m});
      return r?{...t,category:r.category,manualCategory:true}:t;
    });
  };
}

const btn=document.getElementById('saveTx');
if(btn){
  const previous=btn.onclick;
  btn.onclick=function(e){
    const type=document.getElementById('txType')?.value;
    const selected=clean(document.getElementById('category')?.value);
    const editId=document.getElementById('editId')?.value||'';
    const beforeIds=new Set((state.transactions||[]).map(t=>t.id));
    previous.call(this,e);

    const dlg=document.getElementById('txDialog');
    if(dlg?.open || type!=='expense' || !selected)return;

    let base=null;
    if(editId)base=state.transactions.find(t=>t.id===editId);
    if(!base){
      const created=(state.transactions||[]).filter(t=>!beforeIds.has(t.id)&&t.type==='expense');
      base=created[0]||null;
    }
    if(!base)return;

    base.manualCategory=true;
    rememberRule(base,selected,base.month||state.currentMonth);
    const changed=applyRules();
    persistState();
    if(typeof render==='function')render();

    if(base.installmentGroup){
      toast('Catégorie "'+selected+'" appliquée à ce paiement en plusieurs fois et aux échéances suivantes.');
    }else if(base.seriesId||base.recurring){
      toast('Catégorie "'+selected+'" appliquée à cette dépense mensuelle et aux mois suivants.');
    }else if(changed){
      toast('Catégorie "'+selected+'" conservée pour les opérations correspondantes des mois suivants.');
    }
  };
}

const migrated=migrateLegacyManualCategories();
const initialChanged=applyRules();
if(migrated||initialChanged)persistState();
setVersion();
setTimeout(()=>{
  setVersion();
  if(typeof render==='function')render();
  if(migrated)toast(migrated+' ancien'+(migrated>1?'s choix de catégorie récupérés':' choix de catégorie récupéré')+'.');
},300);
})();