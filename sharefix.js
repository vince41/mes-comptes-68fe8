(function(){
'use strict';
const SHARE_FIX_VERSION='0.5.19';

function n(v){
  const x=Number(String(v??'').replace(',','.'));
  return Number.isFinite(x)?x:0;
}
function money(v){return Math.round(Number(v||0)*100)/100;}
function fillSharedSplit(){
  const type=document.getElementById('txType')?.value;
  const owner=document.getElementById('owner')?.value;
  if(type!=='expense'||owner!=='Commun')return;

  const amount=money(n(document.getElementById('amount')?.value));
  if(!(amount>0))return;

  const vEl=document.getElementById('splitV');
  const lEl=document.getElementById('splitL');
  if(!vEl||!lEl)return;

  const vr=String(vEl.value||'').trim();
  const lr=String(lEl.value||'').trim();

  if(!vr&&!lr){
    const vc=Math.floor(amount*100/2);
    const lc=Math.round(amount*100)-vc;
    vEl.value=(vc/100).toFixed(2);
    lEl.value=(lc/100).toFixed(2);
    return;
  }
  if(vr&&!lr){
    const v=money(n(vr));
    const l=money(amount-v);
    if(l>=0)lEl.value=l.toFixed(2);
    return;
  }
  if(!vr&&lr){
    const l=money(n(lr));
    const v=money(amount-l);
    if(v>=0)vEl.value=v.toFixed(2);
  }
}

document.addEventListener('click',e=>{
  if(e.target.closest('#saveTx'))fillSharedSplit();
},true);

document.getElementById('owner')?.addEventListener('change',()=>{
  if(document.getElementById('owner')?.value==='Commun'){
    const v=document.getElementById('splitV'),l=document.getElementById('splitL');
    if(v&&!String(v.value||'').trim()&&l&&!String(l.value||'').trim())fillSharedSplit();
  }
});
})();