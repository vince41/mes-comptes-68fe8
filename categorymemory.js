(function(){
'use strict';
const CATEGORY_MEMORY_VERSION='0.5.12.1';
const STORAGE_KEY='mes-comptes-custom-categories';

function clean(v){return String(v||'').trim().replace(/\s+/g,' ');}
function loadSaved(){
  try{
    const a=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
    return Array.isArray(a)?a.map(clean).filter(Boolean):[];
  }catch(e){return [];}
}
function builtins(){
  const dl=document.getElementById('categoryOptions');
  return dl?[...dl.querySelectorAll('option')].map(o=>clean(o.value)).filter(Boolean):[];
}
function transactionCategories(){
  try{
    return [...new Set((state.transactions||[]).filter(t=>t.type==='expense').map(t=>clean(t.category)).filter(Boolean))];
  }catch(e){return [];}
}
function uniqueCaseInsensitive(values){
  const seen=new Set(),out=[];
  for(const raw of values){
    const v=clean(raw),k=v.toLocaleLowerCase('fr-FR');
    if(!v||seen.has(k))continue;
    seen.add(k);out.push(v);
  }
  return out;
}
function allCategories(){
  return uniqueCaseInsensitive([...builtins(),...loadSaved(),...transactionCategories()]);
}
function persistCategory(cat){
  cat=clean(cat); if(!cat)return;
  const base=builtins();
  if(base.some(x=>x.toLocaleLowerCase('fr-FR')===cat.toLocaleLowerCase('fr-FR'))){
    refreshOptions();return;
  }
  const saved=uniqueCaseInsensitive([...loadSaved(),cat]).sort((a,b)=>a.localeCompare(b,'fr'));
  localStorage.setItem(STORAGE_KEY,JSON.stringify(saved));
  refreshOptions();
}
function refreshOptions(){
  const dl=document.getElementById('categoryOptions'); if(!dl)return;
  const cats=uniqueCaseInsensitive([...builtins(),...loadSaved(),...transactionCategories()]).sort((a,b)=>a.localeCompare(b,'fr'));
  dl.innerHTML='';
  for(const c of cats){const o=document.createElement('option');o.value=c;dl.appendChild(o);}
}
function setVersion(){
  document.title='Mes Comptes · V'+CATEGORY_MEMORY_VERSION;
  const v=document.querySelector('.top-brand h1 small');if(v)v.textContent='V'+CATEGORY_MEMORY_VERSION;
  let badge=document.getElementById('mcVersionBadge');
  if(!badge){badge=document.createElement('div');badge.id='mcVersionBadge';badge.style.cssText='position:fixed;top:calc(env(safe-area-inset-top) + 8px);right:10px;z-index:99999;background:#0b3153;color:#f4c767;border:1px solid #2d6b97;border-radius:999px;padding:5px 9px;font:700 12px system-ui;box-shadow:0 4px 14px #0008';document.body.appendChild(badge);}
  badge.textContent='V'+CATEGORY_MEMORY_VERSION;
}
refreshOptions();
const input=document.getElementById('category');
if(input){
  input.addEventListener('change',()=>{if(clean(input.value))persistCategory(input.value)});
}
const saveBtn=document.getElementById('saveTx');
if(saveBtn){
  saveBtn.addEventListener('click',()=>{
    const type=document.getElementById('txType')?.value;
    const cat=clean(document.getElementById('category')?.value);
    if(type==='expense'&&cat)setTimeout(()=>persistCategory(cat),0);
  },true);
}
window.addEventListener('focus',refreshOptions);
setVersion();
setTimeout(()=>{refreshOptions();setVersion();},300);
})();