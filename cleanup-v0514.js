(function(){
'use strict';
const CLEAN_VERSION='0.5.14';
const DONE_KEY='mes-comptes-cleanup-v0514-done';
const BACKUP_KEY='mes-comptes-backup-before-v0514-cleanup';

function isRecovered(t){
  return String(t?.installmentGroup||'').startsWith('recovered-');
}
function isLibreOffice(t){
  return t?.source==='LibreOffice';
}
function isOriginalOds(t){
  return /^ods-/.test(String(t?.id||''));
}
function cleanState(){
  if(localStorage.getItem(DONE_KEY)==='done') return {removed:0,restored:0,already:true};
  try{
    if(!localStorage.getItem(BACKUP_KEY)){
      localStorage.setItem(BACKUP_KEY,JSON.stringify(state));
    }
  }catch(e){}

  let removed=0,restored=0;
  const next=[];
  for(const t of state.transactions||[]){
    if(isRecovered(t)&&isLibreOffice(t)){
      if(isOriginalOds(t)){
        const x={...t};
        delete x.installmentGroup;
        x.historicalInstallment=true;
        next.push(x);
        restored++;
      }else{
        removed++;
      }
      continue;
    }
    next.push(t);
  }
  state.transactions=next;
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
  localStorage.setItem(DONE_KEY,'done');
  return {removed,restored,already:false};
}
function toast(msg){
  try{
    const n=document.createElement('div');n.textContent=msg;
    n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;background:#4a1717;color:#fff;border:1px solid #c95c5c;border-radius:12px;padding:10px 13px;font:700 13px system-ui;box-shadow:0 6px 18px #0008;max-width:92vw;text-align:center';
    document.body.appendChild(n);setTimeout(()=>n.remove(),4200);
  }catch(e){}
}
const result=cleanState();
if((result.removed||result.restored)&&typeof render==='function')render();
setTimeout(()=>{
  if(result.removed)toast(result.removed+' ligne'+(result.removed>1?'s':'')+' artificielle'+(result.removed>1?'s':'')+' de la V0.5.13 supprimée'+(result.removed>1?'s':'')+'.');
},700);
window.MesComptesCleanupV0514Result=result;
})();