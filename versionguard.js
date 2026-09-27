(function(){
'use strict';
const V='0.5.25';
function setV(){
  document.title='Mes Comptes · V'+V;
  const h=document.querySelector('.top-brand h1 small');if(h)h.textContent='V'+V;
  let b=document.getElementById('mcVersionBadge');
  if(!b){b=document.createElement('div');b.id='mcVersionBadge';b.style.cssText='position:fixed;top:calc(env(safe-area-inset-top) + 8px);right:10px;z-index:99999;background:#0b3153;color:#f4c767;border:1px solid #2d6b97;border-radius:999px;padding:5px 9px;font:700 12px system-ui;box-shadow:0 4px 14px #0008';document.body.appendChild(b);}
  b.textContent='V'+V;
}
if(typeof render==='function'){const prev=render;render=function(){prev();setV();};}
setV();setTimeout(setV,350);setTimeout(setV,1200);window.addEventListener('focus',setV);
})();