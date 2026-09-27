(function(){
'use strict';
const REPAIR_VERSION='0.5.13';
const REPAIR_KEY='mes-comptes-series-repair-v0513';

function clean(v){return String(v||'').trim();}
function norm(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function monthAdd(m,n){
  if(!/^\d{4}-\d{2}$/.test(String(m||'')))return m||'';
  const [y,mo]=m.split('-').map(Number);
  const d=new Date(y,mo-1+n,1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function dateForMonth(date,month){
  if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}-\d{2}$/.test(month))return date||'';
  const day=Number(date.slice(8,10)||1),[y,m]=month.split('-').map(Number);
  const last=new Date(y,m,0).getDate();
  return month+'-'+String(Math.min(day,last)).padStart(2,'0');
}
function parseCounter(t){
  const s=(clean(t.note)+' '+clean(t.label)).toLowerCase();
  let m=s.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if(!m)m=s.match(/\b(\d{1,2})\s*(?:sur|sr)\s*(\d{1,2})\b/);
  if(!m)return null;
  const index=Number(m[1]),total=Number(m[2]);
  if(index<1||total<2||index>total||total>60)return null;
  return {index,total};
}
function stableLegacyKey(t,total){
  return 'legacy-'+norm(t.label)+'-'+String(t.owner||'')+'-'+String(t.paymentMethod||'')+'-'+Math.round(Number(t.amount||0)*100)+'-'+total;
}
function existsFor(group,index){
  return (state.transactions||[]).some(x=>x.installmentGroup===group&&Number(x.installmentIndex||0)===Number(index));
}
function cloneInstallment(seed,group,index,total,month){
  const x={...seed};
  x.id=uid();
  x.month=month;
  x.date=dateForMonth(seed.date,month);
  x.installmentGroup=group;
  x.installmentIndex=index;
  x.installmentCount=total;
  x.debitedAmount=0;
  x.projected=false;
  delete x.autoValidatedAt;
  delete x.autoValidationPaused;
  if(x.plannedBankDate)x.plannedBankDate=dateForMonth(x.plannedBankDate,month);
  const note=clean(x.note);
  if(note){
    x.note=note
      .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/,index+'/'+total)
      .replace(/\b\d{1,2}\s*(?:sur|sr)\s*\d{1,2}\b/i,index+'sur'+total);
  }else x.note=index+'/'+total;
  return x;
}
function repairExplicitGroups(){
  let added=0;
  const groups=new Map();
  for(const t of state.transactions||[]){
    if(t?.type!=='expense'||!t.installmentGroup||!Number(t.installmentCount||0))continue;
    if(!groups.has(t.installmentGroup))groups.set(t.installmentGroup,[]);
    groups.get(t.installmentGroup).push(t);
  }
  for(const [group,rows] of groups){
    rows.sort((a,b)=>Number(a.installmentIndex||0)-Number(b.installmentIndex||0));
    const seed=rows[rows.length-1];
    const total=Math.max(...rows.map(x=>Number(x.installmentCount||0)));
    const lastIndex=Math.max(...rows.map(x=>Number(x.installmentIndex||0)));
    if(!total||!lastIndex||lastIndex>=total)continue;
    const baseMonth=seed.month;
    for(let i=lastIndex+1;i<=total;i++){
      if(existsFor(group,i))continue;
      const month=monthAdd(baseMonth,i-lastIndex);
      state.transactions.push(cloneInstallment(seed,group,i,total,month));
      added++;
    }
  }
  return added;
}
function repairLegacyCounters(){
  let added=0;
  const candidates=[];
  for(const t of state.transactions||[]){
    if(t?.type!=='expense'||t.projected||t.creditProjection||t.installmentGroup)continue;
    const c=parseCounter(t);
    if(c)candidates.push({t,...c});
  }
  const buckets=new Map();
  for(const c of candidates){
    const key=stableLegacyKey(c.t,c.total);
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(c);
  }
  for(const [key,items] of buckets){
    items.sort((a,b)=>a.index-b.index||String(a.t.month||'').localeCompare(String(b.t.month||'')));
    const group='recovered-'+key;
    for(const it of items){
      it.t.installmentGroup=group;
      it.t.installmentIndex=it.index;
      it.t.installmentCount=it.total;
    }
    const seedItem=items[items.length-1],lastIndex=seedItem.index,total=seedItem.total,seed=seedItem.t;
    if(lastIndex>=total)continue;
    for(let i=lastIndex+1;i<=total;i++){
      if(existsFor(group,i))continue;
      const month=monthAdd(seed.month,i-lastIndex);
      state.transactions.push(cloneInstallment(seed,group,i,total,month));
      added++;
    }
  }
  return added;
}
function repairLooseInstallmentMetadata(){
  let added=0;
  const rows=(state.transactions||[]).filter(t=>t?.type==='expense'&&!t.installmentGroup&&Number(t.installmentCount||0)>=2);
  for(const t of rows){
    const total=Number(t.installmentCount||0);
    let index=Number(t.installmentIndex||0);
    if(!index){const p=parseCounter(t);index=p?.index||1;}
    const group='recovered-'+stableLegacyKey(t,total)+'-'+String(t.month||'');
    t.installmentGroup=group;t.installmentIndex=index;
    for(let i=index+1;i<=total;i++){
      if(existsFor(group,i))continue;
      const month=monthAdd(t.month,i-index);
      state.transactions.push(cloneInstallment(t,group,i,total,month));
      added++;
    }
  }
  return added;
}
function repairRecurring(){
  let added=0;
  const groups=new Map();
  for(const t of state.transactions||[]){
    if(t?.type!=='expense'||!t.recurring||!Number(t.seriesCount||0))continue;
    const key=t.seriesId||('legacy-rec-'+norm(t.label)+'-'+String(t.owner||'')+'-'+String(t.paymentMethod||'')+'-'+Math.round(Number(t.amount||0)*100));
    t.seriesId=key;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(t);
  }
  for(const [series,rows] of groups){
    rows.sort((a,b)=>Number(a.seriesIndex||0)-Number(b.seriesIndex||0));
    const seed=rows[rows.length-1];
    const total=Math.max(...rows.map(x=>Number(x.seriesCount||0)));
    const lastIndex=Math.max(...rows.map(x=>Number(x.seriesIndex||0)))||rows.length;
    if(lastIndex>=total)continue;
    for(let i=lastIndex+1;i<=total;i++){
      if((state.transactions||[]).some(x=>x.seriesId===series&&Number(x.seriesIndex||0)===i))continue;
      const month=monthAdd(seed.month,i-lastIndex);
      const x={...seed,id:uid(),month,date:dateForMonth(seed.date,month),seriesId:series,seriesIndex:i,seriesCount:total,debitedAmount:0,projected:false};
      delete x.autoValidatedAt;delete x.autoValidationPaused;
      if(x.plannedBankDate)x.plannedBankDate=dateForMonth(x.plannedBankDate,month);
      state.transactions.push(x);added++;
    }
  }
  return added;
}
function persist(){
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}
}
function toast(msg){
  try{
    const n=document.createElement('div');n.textContent=msg;
    n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;background:#082f50;color:#eaf8ff;border:1px solid #2d6b97;border-radius:12px;padding:10px 13px;font:700 13px system-ui;box-shadow:0 6px 18px #0008;max-width:92vw;text-align:center';
    document.body.appendChild(n);setTimeout(()=>n.remove(),3200);
  }catch(e){}
}
function runRepair(show){
  const before=(state.transactions||[]).length;
  const a=repairExplicitGroups();
  const b=repairLooseInstallmentMetadata();
  const c=repairLegacyCounters();
  const d=repairRecurring();
  const added=(state.transactions||[]).length-before;
  if(added){
    try{state.transactions=categorizeTransactions(state.transactions);}catch(e){}
    persist();
    if(typeof render==='function')render();
  }
  localStorage.setItem(REPAIR_KEY,JSON.stringify({at:new Date().toISOString(),added,explicit:a,loose:b,counters:c,recurring:d}));
  if(show&&added)toast(added+' échéance'+(added>1?'s':'')+' manquante'+(added>1?'s':'')+' récupérée'+(added>1?'s':'')+'.');
  return added;
}
const added=runRepair(false);
setTimeout(()=>{if(added)toast(added+' ancienne'+(added>1?'s échéances':' échéance')+' 4×/récurrente'+(added>1?'s':'')+' récupérée'+(added>1?'s':'')+'.');},600);
window.MesComptesRepairSeries=()=>runRepair(true);
})();