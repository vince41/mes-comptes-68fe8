(function(){
'use strict';
const CATEGORY_SYNC_VERSION='0.5.9';

function norm(s){
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function sameFutureExpense(base,t){
  if(!t||t.type!=='expense'||String(t.month||'')<=String(base.month||''))return false;
  if(base.seriesId&&t.seriesId===base.seriesId)return true;
  if(base.installmentGroup&&t.installmentGroup===base.installmentGroup)return true;
  return norm(t.label)===norm(base.label)
    && String(t.paymentMethod||'')===String(base.paymentMethod||'')
    && String(t.owner||'')===String(base.owner||'');
}
function setVersion(){
  document.title='Mes Comptes · V'+CATEGORY_SYNC_VERSION;
  const v=document.querySelector('.top-brand h1 small');if(v)v.textContent='V'+CATEGORY_SYNC_VERSION;
  let badge=document.getElementById('mcVersionBadge');
  if(!badge){badge=document.createElement('div');badge.id='mcVersionBadge';badge.style.cssText='position:fixed;top:calc(env(safe-area-inset-top) + 8px);right:10px;z-index:99999;background:#0b3153;color:#f4c767;border:1px solid #2d6b97;border-radius:999px;padding:5px 9px;font:700 12px system-ui;box-shadow:0 4px 14px #0008';document.body.appendChild(badge);}
  badge.textContent='V'+CATEGORY_SYNC_VERSION;
}
const btn=document.getElementById('saveTx');
if(btn){
  const previous=btn.onclick;
  btn.onclick=function(e){
    const id=document.getElementById('editId')?.value||'';
    const before=id?state.transactions.find(x=>x.id===id):null;
    const snapshot=before?{
      id:before.id,
      type:before.type,
      month:before.month,
      category:before.category||autoCategory(before),
      label:before.label,
      paymentMethod:before.paymentMethod,
      owner:before.owner,
      seriesId:before.seriesId||'',
      installmentGroup:before.installmentGroup||''
    }:null;

    previous.call(this,e);

    if(!snapshot||snapshot.type!=='expense')return;
    const dlg=document.getElementById('txDialog');
    if(dlg?.open)return;

    const updated=state.transactions.find(x=>x.id===snapshot.id);
    if(!updated)return;
    const newCategory=updated.category||autoCategory(updated);
    if(String(newCategory)===String(snapshot.category))return;

    const base={
      ...snapshot,
      month:updated.month||snapshot.month,
      label:updated.label||snapshot.label,
      paymentMethod:updated.paymentMethod||snapshot.paymentMethod,
      owner:updated.owner||snapshot.owner,
      seriesId:updated.seriesId||snapshot.seriesId,
      installmentGroup:updated.installmentGroup||snapshot.installmentGroup
    };
    let changed=0;
    for(const t of state.transactions||[]){
      if(t.id===updated.id)continue;
      if(sameFutureExpense(base,t)){
        t.category=newCategory;
        changed++;
      }
    }
    if(changed){
      localStorage.setItem(KEY,JSON.stringify(state));
      if(typeof render==='function')render();
    }
    try{
      const msg=changed?('Catégorie appliquée à '+changed+' opération'+(changed>1?'s':'')+' des mois suivants.'):'Catégorie enregistrée pour cette opération.';
      const host=document.querySelector('.topbar')||document.body;
      const n=document.createElement('div');
      n.textContent=msg;
      n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;background:#082f50;color:#eaf8ff;border:1px solid #2d6b97;border-radius:12px;padding:9px 12px;font:700 13px system-ui;box-shadow:0 6px 18px #0008';
      document.body.appendChild(n);setTimeout(()=>n.remove(),2200);
    }catch(err){}
  };
}
setVersion();
setTimeout(setVersion,300);
})();