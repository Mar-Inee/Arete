
(() => {
'use strict';

const STORAGE_KEY='arete.now.state.v1';
const DB_NAME='arete-now-files';
const DB_STORE='files';
const $=(sel,root=document)=>root.querySelector(sel);
const $$=(sel,root=document)=>[...root.querySelectorAll(sel)];
const uid=(p='id')=>`${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtDate=v=>v?new Date(v+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
const nowIso=()=>new Date().toISOString();
const today=()=>new Date().toISOString().slice(0,10);
const dayKey=d=>new Date(d).toISOString().slice(0,10);

const defaultState=()=>({
  version:1,
  tasks:[],
  lists:[{id:'inbox',name:'Inbox',icon:'⌂'}],
  countdowns:[],
  trackers:[],
  generalNoteFolders:[
    {id:uid('nf'),name:'General',subnotes:[]}
  ],
  activity:[],
  focus:{preset:25,remaining:25*60,running:false,endsAt:null,taskId:'',sessions:0},
  settings:{cloudProvider:'local',theme:'sprout'}
});

let state=loadState();
let currentView='today';
let currentModal=null;
let modalTab='details';
let editingTaskId=null;
let editingTrackerId=null;
let scanPages=[];
let installPrompt=null;
let tickHandle=null;
let groundingInitialized=false;
let activeTaskFilter='open';

function normalizeState(s){
  const base=defaultState();
  s={...base,...(s||{})};
  s.tasks=(s.tasks||[]).map(t=>({
    id:t.id||uid('t'),title:t.title||'Untitled task',completed:!!t.completed,priority:t.priority||'none',
    dueDate:t.dueDate||'',dueTime:t.dueTime||'',tags:Array.isArray(t.tags)?t.tags:[],
    subtasks:Array.isArray(t.subtasks)?t.subtasks:[],noteFolders:Array.isArray(t.noteFolders)?t.noteFolders:[],
    resources:Array.isArray(t.resources)?t.resources:[],createdAt:t.createdAt||nowIso(),completedAt:t.completedAt||null,
    listId:t.listId||'inbox',urgent:!!t.urgent,important:!!t.important,pinned:!!t.pinned,wontDo:!!t.wontDo
  }));
  s.lists=Array.isArray(s.lists)&&s.lists.length?s.lists:[{id:'inbox',name:'Inbox',icon:'⌂'}];
  if(!s.lists.some(l=>l.id==='inbox'))s.lists.unshift({id:'inbox',name:'Inbox',icon:'⌂'});
  s.countdowns=Array.isArray(s.countdowns)?s.countdowns:[];
  s.trackers=(s.trackers||[]).map(t=>({...t,logs:Array.isArray(t.logs)?t.logs:[],resources:Array.isArray(t.resources)?t.resources:[]}));
  s.generalNoteFolders=Array.isArray(s.generalNoteFolders)&&s.generalNoteFolders.length?s.generalNoteFolders:base.generalNoteFolders;
  s.activity=Array.isArray(s.activity)?s.activity:[];
  s.focus={...base.focus,...(s.focus||{})};
  s.settings={...base.settings,...(s.settings||{})};
  return s;
}
function loadState(){
  try{return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}catch(e){return defaultState();}
}
function saveState(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
}
function addActivity(type,text,taskId='',meta={}){
  state.activity.unshift({id:uid('a'),type,text,taskId,at:nowIso(),...meta});
  state.activity=state.activity.slice(0,500);
}
function toast(msg){
  const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);
  setTimeout(()=>el.remove(),2300);
}

async function openFileDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DB_STORE))req.result.createObjectStore(DB_STORE);};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function putFile(file){
  const db=await openFileDB(),id=uid('file');
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(file,id);
    tx.oncomplete=()=>resolve(id);tx.onerror=()=>reject(tx.error);
  });
}
async function getFile(id){
  const db=await openFileDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(DB_STORE).objectStore(DB_STORE).get(id);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function deleteFile(id){
  if(!id)return;const db=await openFileDB();return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}

function iconForView(v){return({today:'⌂',tasks:'✓',trackers:'↗',progress:'▥',focus:'◷',matrix:'⌘',countdown:'⌛',more:'•••',notes:'▤',scanner:'▣',resources:'↗',arete:'❧',sync:'⇄'})[v]||'•'}
const navItems=[
  ['today','Today'],['tasks','Tasks'],['focus','Focus'],['progress','Progress'],['matrix','Matrix'],['countdown','Countdown'],
  ['trackers','Trackers'],['notes','Notes'],['scanner','Scanner'],['resources','Resources'],['arete','Arete'],['sync','Backup']
];

function shell(){
  const app=$('#app');
  app.innerHTML=`
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><img src="icon-192.png"><div><h1>Arete</h1><small>Cultivate what matters.</small></div></div>
        <nav class="nav">${navItems.map(([v,l])=>`<button data-nav="${v}" class="${v===currentView?'active':''}"><span class="icon">${iconForView(v)}</span>${l}</button>`).join('')}</nav>
        <div class="sidebar-foot"><b>Local-first • sync-ready</b><p>Your data stays on this device now. Cloud sync can plug into the same data model later.</p></div>
      </aside>
      <main class="main"><div id="view"></div></main>
      <nav class="mobile-nav">
        ${[['tasks','Tasks'],['focus','Focus'],['progress','Overview'],['matrix','Matrix'],['more','More']].map(([v,l])=>`<button data-nav="${v}" class="${v===currentView?'active':''}"><span>${iconForView(v)}</span>${l}</button>`).join('')}
      </nav>
    </div>`;
  $$('[data-nav]').forEach(b=>b.onclick=()=>{currentView=b.dataset.nav;shell();renderView();});
}

function header(title,subtitle,action=''){
  return `<div class="topbar"><div><div class="eyebrow">Arete workspace</div><h2>${esc(title)}</h2><div class="subtitle">${esc(subtitle)}</div></div><div class="top-actions">${action}</div></div>${installBanner()}`;
}
function installBanner(){
  if(window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone)return '';
  return `<div class="install-banner"><p><b>Install Arete on this device</b>Web: use Install if available. iPhone: Safari → Share → Add to Home Screen.</p><button class="btn small" id="install-btn">Install</button></div>`;
}
function wireInstall(){
  const b=$('#install-btn'); if(!b)return;
  b.onclick=async()=>{
    if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;renderView();}
    else if(/iPhone|iPad|iPod/i.test(navigator.userAgent)) alert('In Safari: tap Share (square with ↑) → Add to Home Screen → Add.');
    else alert('Use your browser menu and choose “Install Arete” / “Install app” / “Create shortcut”.');
  };
}

function renderView(){
  if(!$('#view'))return;
  if(!groundingInitialized && typeof chooseGroundingCard==='function'){chooseGroundingCard();groundingInitialized=true;}
  switch(currentView){
    case'today':renderToday();break;
    case'tasks':renderTasks();break;
    case'trackers':renderTrackers();break;
    case'progress':renderProgress();break;
    case'focus':renderFocus();break;
    case'matrix':renderMatrix();break;
    case'countdown':renderCountdown();break;
    case'more':renderMore();break;
    case'notes':renderNotes();break;
    case'scanner':renderScanner();break;
    case'resources':renderResources();break;
    case'arete':renderArete();break;
    case'sync':renderSync();break;
    default:renderToday();
  }
  wireInstall();
}


function listName(id){return state.lists.find(l=>l.id===id)?.name||'Inbox';}
function localDateKey(d=new Date()){const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,10);}
function tomorrowKey(){const d=new Date();d.setDate(d.getDate()+1);return localDateKey(d);}
function next7EndKey(){const d=new Date();d.setDate(d.getDate()+7);return localDateKey(d);}
function filteredTasks(){
  let rows=[...state.tasks];
  const f=activeTaskFilter;
  if(f==='open')rows=rows.filter(t=>!t.completed&&!t.wontDo);
  else if(f==='all')rows=rows.filter(t=>!t.wontDo);
  else if(f==='today')rows=rows.filter(t=>!t.completed&&!t.wontDo&&t.dueDate===localDateKey());
  else if(f==='tomorrow')rows=rows.filter(t=>!t.completed&&!t.wontDo&&t.dueDate===tomorrowKey());
  else if(f==='next7')rows=rows.filter(t=>!t.completed&&!t.wontDo&&t.dueDate&&t.dueDate>=localDateKey()&&t.dueDate<=next7EndKey());
  else if(f==='overdue')rows=rows.filter(t=>!t.completed&&!t.wontDo&&t.dueDate&&t.dueDate<localDateKey());
  else if(f==='completed')rows=rows.filter(t=>t.completed);
  else if(f==='wontdo')rows=rows.filter(t=>t.wontDo);
  else if(f.startsWith('list:'))rows=rows.filter(t=>t.listId===f.slice(5)&&!t.wontDo);
  else if(f.startsWith('tag:'))rows=rows.filter(t=>(t.tags||[]).includes(f.slice(4))&&!t.wontDo);
  return rows.sort((a,b)=>(Number(b.pinned)-Number(a.pinned))||(Number(b.important)-Number(a.important))||(String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))));
}
function taskFilterLabel(){
  const map={open:'Open',all:'All',today:'Today',tomorrow:'Tomorrow',next7:'Next 7 Days',overdue:'Overdue',completed:'Completed',wontdo:"Won't Do"};
  if(map[activeTaskFilter])return map[activeTaskFilter];
  if(activeTaskFilter.startsWith('list:'))return listName(activeTaskFilter.slice(5));
  if(activeTaskFilter.startsWith('tag:'))return '#'+activeTaskFilter.slice(4);
  return 'Tasks';
}

function taskStats(){
  const relevant=state.tasks.filter(t=>!t.wontDo),total=relevant.length,done=relevant.filter(t=>t.completed).length;
  const subs=state.tasks.flatMap(t=>t.subtasks||[]),sd=subs.filter(s=>s.completed).length;
  return{total,done,open:total-done,pct:total?Math.round(done/total*100):0,subs:subs.length,sd,spct:subs.length?Math.round(sd/subs.length*100):0};
}
function taskCard(t){
  const subs=(t.subtasks||[]),sd=subs.filter(s=>s.completed).length;
  return `<div class="task-card ${t.completed?'done':''}" data-open-task="${t.id}">
    <button class="check ${t.completed?'on':''}" data-toggle-task="${t.id}" aria-label="toggle task"></button>
    <div><div class="task-title">${esc(t.title)}</div>
      <div class="task-meta">
        ${t.pinned?`<span class="pill">⌖ pinned</span>`:''}
        ${t.priority!=='none'?`<span class="pill ${t.priority}">${esc(t.priority)}</span>`:''}
        ${t.dueDate?`<span class="pill">${esc(fmtDate(t.dueDate))}${t.dueTime?' • '+esc(t.dueTime):''}</span>`:''}
        <span class="pill">${esc(listName(t.listId))}</span>
        ${t.urgent||t.important?`<span class="pill">${t.urgent?'Urgent':''}${t.urgent&&t.important?' + ':''}${t.important?'Important':''}</span>`:''}
        ${(t.tags||[]).slice(0,3).map(x=>`<span class="pill">#${esc(x)}</span>`).join('')}
        ${subs.length?`<span>${sd}/${subs.length} subtasks</span>`:''}
      </div>
      ${subs.length?`<div class="sub-preview">${subs.slice(0,3).map(s=>`<div>${s.completed?'✓':'○'} ${esc(s.title)}</div>`).join('')}</div>`:''}
    </div><button class="task-arrow" aria-label="open">›</button>
  </div>`;
}
function wireTaskCards(){
  $$('[data-toggle-task]').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleTask(b.dataset.toggleTask);});
  $$('[data-open-task]').forEach(c=>c.onclick=e=>{if(e.target.closest('[data-toggle-task]'))return;openTaskModal(c.dataset.openTask);});
}
function toggleTask(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;t.completed=!t.completed;t.completedAt=t.completed?nowIso():null;
  addActivity(t.completed?'task_complete':'task_reopen',`${t.completed?'Completed':'Reopened'} “${t.title}”`,t.id);saveState();renderView();
}
function renderToday(){
  const s=taskStats(),high=state.tasks.filter(t=>!t.completed&&(t.priority==='high'||t.priority==='urgent')),other=state.tasks.filter(t=>!t.completed&&!high.includes(t));
  $('#view').innerHTML=header('Today','A clear view of what deserves attention.',`<button class="btn primary" id="new-task">+ New task</button>`) + `
    <div class="grid four">
      <div class="card stat"><div class="k">OPEN TASKS</div><div class="v">${s.open}</div><div class="hint">Still in motion</div></div>
      <div class="card stat"><div class="k">COMPLETED</div><div class="v">${s.done}</div><div class="hint">Finished intentionally</div></div>
      <div class="card stat"><div class="k">SUBTASKS</div><div class="v">${s.sd}/${s.subs}</div><div class="hint">Steps completed</div></div>
      <div class="card stat"><div class="k">OVERALL</div><div class="v">${s.pct}%</div><div class="hint">Task completion</div></div>
    </div>
    ${monthlyGrowthFeatureHtml(true)}
    ${groundingCardHtml(true)}
    <div class="section-head"><h3>High priority</h3><span>You decide what belongs here</span></div>
    <div class="task-list">${high.length?high.map(taskCard).join(''):`<div class="empty"><div class="sprout">🌱</div><b>No high-priority task</b>Keep this section intentional.</div>`}</div>
    <div class="section-head"><h3>Other tasks</h3><span>${other.length} open</span></div>
    <div class="task-list">${other.length?other.map(taskCard).join(''):`<div class="empty"><b>Nothing else pending</b>Add a task when something becomes actionable.</div>`}</div>`;
  $('#new-task').onclick=()=>openTaskModal();
  if($('#open-growth'))$('#open-growth').onclick=()=>go('progress');
  if($('#grounding-mini'))$('#grounding-mini').onclick=()=>{chooseGroundingCard();go('progress');};
  wireTaskCards();wireInstall();
}
function renderTasks(){
  const rows=filteredTasks();
  const tags=[...new Set(state.tasks.flatMap(t=>t.tags||[]))].sort();
  const smart=[['open','Open'],['today','Today'],['tomorrow','Tomorrow'],['next7','Next 7 Days'],['overdue','Overdue'],['completed','Completed'],['wontdo',"Won't Do"],['all','All']];
  $('#view').innerHTML=header(taskFilterLabel(),'Smart lists, custom lists, tags and nested work.',`<button class="btn" id="add-list">+ List</button><button class="btn primary" id="new-task">+ Task</button>`) + `
    <div class="planner-strip">
      <div class="planner-group"><b>Smart Lists</b><div class="smart-chips">${smart.map(([id,l])=>`<button data-filter="${id}" class="${activeTaskFilter===id?'active':''}">${esc(l)}</button>`).join('')}</div></div>
      <div class="planner-group"><b>Lists</b><div class="smart-chips">${state.lists.map(l=>`<button data-filter="list:${l.id}" class="${activeTaskFilter===`list:${l.id}`?'active':''}">${esc(l.icon||'•')} ${esc(l.name)}</button>`).join('')}</div></div>
      <div class="planner-group"><b>Tags</b><div class="smart-chips">${tags.length?tags.map(t=>`<button data-filter="tag:${esc(t)}" class="${activeTaskFilter===`tag:${t}`?'active':''}">#${esc(t)}</button>`).join(''):'<span class="subtitle">Tags appear when you add them to tasks.</span>'}</div></div>
    </div>
    <div class="section-head"><h3>${esc(taskFilterLabel())}</h3><span>${rows.length} task${rows.length===1?'':'s'}</span></div>
    <div class="task-list">${rows.length?rows.map(taskCard).join(''):`<div class="empty"><div class="sprout">🌱</div><b>Nothing here</b>This smart list will fill itself as your tasks change.</div>`}</div>`;
  $('#new-task').onclick=()=>openTaskModal();
  $('#add-list').onclick=()=>{const name=prompt('List name');if(!name)return;const icon=prompt('Optional icon / emoji','')||'•';const l={id:uid('list'),name:name.trim(),icon:icon.trim()||'•'};state.lists.push(l);activeTaskFilter='list:'+l.id;saveState();renderTasks();};
  $$('[data-filter]').forEach(b=>b.onclick=()=>{activeTaskFilter=b.dataset.filter;renderTasks();});
  wireTaskCards();wireInstall();
}

function renderTrackers(){
  $('#view').innerHTML=header('Trackers','Create the tracker you need; Arete does not choose the category for you.',`<button class="btn primary" id="new-tracker">+ New tracker</button>`) + `
  <div class="grid three">${state.trackers.length?state.trackers.map(t=>{
    const latest=t.logs?.[0];
    return `<div class="tracker-card" data-tracker="${t.id}"><div class="tracker-top"><div><h4>${esc(t.name)}</h4><p>${esc(t.mode)}${t.unit?' • '+esc(t.unit):''}</p></div><button class="btn small">Open</button></div><div class="value">${latest?esc(latest.value):'—'}</div><p>${latest?'Latest entry • '+new Date(latest.at).toLocaleDateString():'No entries yet'}</p></div>`;
  }).join(''):`<div class="empty" style="grid-column:1/-1"><div class="sprout">🌿</div><b>No trackers yet</b>Create any tracker and define what it means yourself.</div>`}</div>`;
  $('#new-tracker').onclick=()=>openTrackerModal();
  $$('[data-tracker]').forEach(x=>x.onclick=()=>openTrackerModal(x.dataset.tracker));wireInstall();
}


const groundingCards=[
  {
    id:'steady-effort',
    mood:'Steady effort',
    surah:'An-Najm',
    surahNo:53,
    ayah:'39',
    arabic:'وَأَن لَّيْسَ لِلْإِنسَانِ إِلَّا مَا سَعَىٰ',
    translation:'And that there is not for man except that [good] for which he strives.',
    quranUrl:'https://quran.com/53/39',
    reflection:'Your effort matters. Let a strong day become evidence that you can continue—not a reason to sprint until you burn out.',
    hadith:'The most beloved deed to Allah is the most regular and constant even if it were little.',
    hadithRef:'Sahih al-Bukhari 6464',
    hadithBook:'Book 81, Hadith 53',
    sunnahUrl:'https://sunnah.com/bukhari:6464'
  },
  {
    id:'slow-day',
    mood:'A slower day',
    surah:'Ali ‘Imran',
    surahNo:3,
    ayah:'139',
    arabic:'وَلَا تَهِنُوا وَلَا تَحْزَنُوا وَأَنتُمُ الْأَعْلَوْنَ إِن كُنتُم مُّؤْمِنِينَ',
    translation:'So do not weaken and do not grieve, and you will be superior if you are [true] believers.',
    quranUrl:'https://quran.com/3/139',
    reflection:'A lower streak is data, not a verdict on you. Return to the next right action without turning comparison with yesterday into despair.',
    hadith:'The most regular constant deeds even though they may be few.',
    hadithRef:'Sahih al-Bukhari 6465',
    hadithBook:'Book 81, Hadith 54',
    sunnahUrl:'https://sunnah.com/bukhari:6465'
  },
  {
    id:'capacity',
    mood:'Protect your capacity',
    surah:'Al-Baqarah',
    surahNo:2,
    ayah:'286',
    arabic:'لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا',
    translation:'Allah does not charge a soul except [with that within] its capacity.',
    quranUrl:'https://quran.com/2/286',
    reflection:'Do not convert productivity into self-punishment. Make the next plan demanding enough to matter and sustainable enough to repeat.',
    hadith:"Don't take upon yourselves, except the deeds which are within your ability.",
    hadithRef:'Sahih al-Bukhari 6465',
    hadithBook:'Book 81, Hadith 54',
    sunnahUrl:'https://sunnah.com/bukhari:6465'
  },
  {
    id:'hard-month',
    mood:'When the month feels heavy',
    surah:'Ash-Sharh',
    surahNo:94,
    ayah:'5',
    arabic:'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا',
    translation:'So, surely with hardship comes ease.',
    quranUrl:'https://quran.com/94/5',
    reflection:'This verse is not a productivity guarantee. It is a grounding reminder: difficulty does not remove the possibility of ease, so keep your next step proportionate and hopeful.',
    hadith:'Do good deeds properly, sincerely and moderately, and receive good news.',
    hadithRef:'Sahih al-Bukhari 6467',
    hadithBook:'Book 81, Hadith 56',
    sunnahUrl:'https://sunnah.com/bukhari:6467'
  },
  {
    id:'reset-with-hope',
    mood:'Reset without despair',
    surah:'Az-Zumar',
    surahNo:39,
    ayah:'53',
    arabic:'قُلْ يَا عِبَادِيَ الَّذِينَ أَسْرَفُوا عَلَىٰ أَنفُسِهِمْ لَا تَقْنَطُوا مِن رَّحْمَةِ اللَّهِ',
    translation:'Say, “O My servants who have transgressed against themselves … do not despair of the mercy of Allah.”',
    quranUrl:'https://quran.com/39/53',
    reflection:'This ayah concerns Allah’s mercy and repentance, not task scores. Arete uses it only as a spiritual anti-despair reminder: a missed target should never become hopelessness.',
    hadith:'Do good deeds properly, sincerely and moderately, and receive good news.',
    hadithRef:'Sahih al-Bukhari 6467',
    hadithBook:'Book 81, Hadith 56',
    sunnahUrl:'https://sunnah.com/bukhari:6467'
  }
];
let groundingIndex=0;
let groundingFlipped=false;

function dateInMonth(iso,year,month){
  const d=new Date(iso);
  return d.getFullYear()===year && d.getMonth()===month;
}
function focusMinutesFromActivity(a){
  if(a.type!=='focus')return 0;
  if(Number.isFinite(Number(a.minutes)))return Number(a.minutes);
  const m=String(a.text||'').match(/(\d+)-minute focus/i);
  return m?Number(m[1]):0;
}
function monthSnapshot(offset=0){
  const now=new Date();
  const anchor=new Date(now.getFullYear(),now.getMonth()+offset,1);
  const year=anchor.getFullYear(),month=anchor.getMonth();
  const isCurrent=year===now.getFullYear()&&month===now.getMonth();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const observedDays=isCurrent?now.getDate():daysInMonth;
  const acts=state.activity.filter(a=>dateInMonth(a.at,year,month));
  const taskDone=acts.filter(a=>a.type==='task_complete').length;
  const focusMinutes=acts.reduce((sum,a)=>sum+focusMinutesFromActivity(a),0);
  const activeDays=new Set(
    acts.filter(a=>['task_complete','focus'].includes(a.type)).map(a=>dayKey(a.at))
  ).size;
  return{
    year,month,observedDays,daysInMonth,taskDone,focusMinutes,activeDays,
    taskRate:taskDone/Math.max(1,observedDays),
    focusRate:focusMinutes/Math.max(1,observedDays),
    activeRate:activeDays/Math.max(1,observedDays)
  };
}
function pctChange(curr,prev){
  if(prev===0)return curr===0?0:100;
  return Math.max(-100,Math.min(100,((curr-prev)/Math.abs(prev))*100));
}
function monthlyGrowth(){
  const current=monthSnapshot(0),previous=monthSnapshot(-1);
  const changes={
    tasks:pctChange(current.taskRate,previous.taskRate),
    focus:pctChange(current.focusRate,previous.focusRate),
    active:pctChange(current.activeRate,previous.activeRate)
  };
  const hasPrev=previous.taskDone>0||previous.focusMinutes>0||previous.activeDays>0;
  const overall=hasPrev?Math.round((changes.tasks+changes.focus+changes.active)/3):null;
  return{current,previous,changes,overall,hasPrev};
}
function dayEffort(offset=0){
  const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+offset);const key=dayKey(d);
  const acts=state.activity.filter(a=>dayKey(a.at)===key);
  return{
    tasks:acts.filter(a=>a.type==='task_complete').length,
    focusMinutes:acts.reduce((sum,a)=>sum+focusMinutesFromActivity(a),0),
    actions:acts.filter(a=>['task_complete','focus'].includes(a.type)).length
  };
}
function chooseGroundingCard(){
  const g=monthlyGrowth(),todayE=dayEffort(0),yesterdayE=dayEffort(-1);
  let id='capacity';
  if(g.hasPrev && g.overall!==null && g.overall<=-15) id='hard-month';
  else if(todayE.actions===0 && yesterdayE.actions>0) id='reset-with-hope';
  else if(todayE.actions<yesterdayE.actions) id='slow-day';
  else if(todayE.tasks>=3 || todayE.focusMinutes>=75 || (g.overall!==null&&g.overall>=25)) id='steady-effort';
  else id='capacity';
  const idx=groundingCards.findIndex(c=>c.id===id);
  groundingIndex=idx>=0?idx:0;
  return groundingCards[groundingIndex];
}
function growthTone(v){
  if(v===null)return'baseline';
  if(v>=10)return'growing';
  if(v<=-10)return'rebuilding';
  return'steady';
}
function growthArrow(v){
  if(v===null)return'•';
  if(v>4)return'↑';
  if(v<-4)return'↓';
  return'→';
}
function monthlyGrowthFeatureHtml(compact=false){
  const g=monthlyGrowth(),c=g.current,p=g.previous,tone=growthTone(g.overall);
  const monthName=new Date(c.year,c.month,1).toLocaleDateString(undefined,{month:'long'});
  if(compact){
    const label=g.hasPrev?`${g.overall>=0?'+':''}${g.overall}% vs last month`:'Baseline month';
    return `<div class="growth-strip" id="open-growth">
      <div><span class="growth-leaf">❧</span><b>${esc(monthName)} growth</b><small>${esc(label)} • ${c.taskDone} tasks • ${Math.round(c.focusMinutes)} focus min • ${c.activeDays} active days</small></div>
      <span class="growth-open">›</span>
    </div>`;
  }
  const metric=(label,value,prevValue,change,unit='')=>{
    const max=Math.max(1,value,prevValue);
    const currW=Math.min(100,(value/max)*100),prevW=Math.min(100,(prevValue/max)*100);
    return `<div class="growth-metric">
      <div class="growth-metric-head"><span>${esc(label)}</span><b>${unit==='min'?Math.round(value)+'m':value}</b></div>
      <div class="growth-compare">
        <div><small>${esc(monthName)}</small><span><i style="width:${currW}%"></i></span></div>
        <div class="previous"><small>Previous</small><span><i style="width:${prevW}%"></i></span></div>
      </div>
      <div class="growth-change ${change>=10?'up':change<=-10?'down':''}">${growthArrow(change)} ${Math.abs(Math.round(change))}% pace change</div>
    </div>`;
  };
  const overallLabel=g.hasPrev?`${g.overall>=0?'+':''}${g.overall}%`:'Baseline';
  return `<div class="card monthly-growth-card">
    <div class="section-head" style="margin-top:0"><h3>Monthly overall growth</h3><span>pace, not perfection</span></div>
    <div class="monthly-growth-top">
      <div class="growth-orb ${tone}">
        <span class="sprout-mark">❧</span>
        <strong>${esc(overallLabel)}</strong>
        <small>${g.hasPrev?'vs previous month':'first month with comparable data'}</small>
      </div>
      <div class="growth-summary">
        <b>${tone==='growing'?'Growing with momentum':tone==='rebuilding'?'Rebuilding the rhythm':tone==='steady'?'Holding a steady rhythm':'Building your baseline'}</b>
        <p>Arete compares your daily pace for completed tasks, focus minutes and active days. It does not punish one low day or reward one unsustainable sprint.</p>
      </div>
    </div>
    <div class="growth-metrics">
      ${metric('Tasks completed',c.taskDone,p.taskDone,g.changes.tasks)}
      ${metric('Focus time',c.focusMinutes,p.focusMinutes,g.changes.focus,'min')}
      ${metric('Active days',c.activeDays,p.activeDays,g.changes.active)}
    </div>
    <div class="growth-formula">Overall = average month-over-month change in daily task-completion pace, focus-minute pace and active-day share. Each component is capped at ±100% so one metric cannot dominate.</div>
  </div>`;
}
function groundingCardHtml(compact=false){
  const card=groundingCards[groundingIndex]||chooseGroundingCard();
  if(compact){
    return `<button class="grounding-mini" id="grounding-mini">
      <span class="mini-label">Today’s grounding</span>
      <span class="mini-verse">${esc(card.translation)}</span>
      <span class="mini-ref">Qur’an • ${esc(card.surah)} ${esc(card.surahNo+':'+card.ayah)} <i>tap</i></span>
    </button>`;
  }
  return `<div class="grounding-shell">
    <div class="grounding-toolbar">
      <div><span class="eyebrow">Grounding flashcard</span><b>${esc(card.mood)}</b></div>
      <div class="grounding-controls"><button class="btn small" id="ground-prev">‹</button><button class="btn small" id="ground-flip">${groundingFlipped?'Verse':'Why this card?'}</button><button class="btn small" id="ground-next">›</button></div>
    </div>
    <div class="grounding-card ${groundingFlipped?'flipped':''}" id="grounding-card">
      ${!groundingFlipped?`
        <div class="ground-front">
          <div class="quran-badge">Qur’an</div>
          <div class="arabic-verse" dir="rtl">${esc(card.arabic)}</div>
          <blockquote>${esc(card.translation)}</blockquote>
          <div class="verse-reference"><b>Surah ${esc(card.surah)}</b><span>Surah ${card.surahNo} • Ayah ${esc(card.ayah)}</span></div>
          <a class="source-link" href="${esc(card.quranUrl)}" target="_blank" rel="noopener">Read full verse & context ↗</a>
        </div>`:`
        <div class="ground-back">
          <div class="reflection-label">Arete reflection — not tafsir</div>
          <p>${esc(card.reflection)}</p>
          <div class="hadith-anchor">
            <span>Prophetic anchor</span>
            <blockquote>“${esc(card.hadith)}”</blockquote>
            <b>${esc(card.hadithRef)}</b>
            <small>${esc(card.hadithBook)} • Chapter: adoption of a middle course and regularity of deeds</small>
            <a class="source-link" href="${esc(card.sunnahUrl)}" target="_blank" rel="noopener">Verify on Sunnah.com ↗</a>
          </div>
        </div>`}
    </div>
    <div class="grounding-note">The verse is never used as a score or reward. Arete chooses a card to ground your response to the day; the original Qur’anic and hadith contexts remain primary.</div>
  </div>`;
}
function wireGrounding(){
  const flip=()=>{groundingFlipped=!groundingFlipped;renderProgress();};
  if($('#ground-flip'))$('#ground-flip').onclick=flip;
  if($('#grounding-card'))$('#grounding-card').onclick=e=>{if(e.target.closest('a'))return;groundingFlipped=!groundingFlipped;renderProgress();};
  if($('#ground-prev'))$('#ground-prev').onclick=()=>{groundingIndex=(groundingIndex-1+groundingCards.length)%groundingCards.length;groundingFlipped=false;renderProgress();};
  if($('#ground-next'))$('#ground-next').onclick=()=>{groundingIndex=(groundingIndex+1)%groundingCards.length;groundingFlipped=false;renderProgress();};
}

function sevenDayData(){
  const arr=[];for(let i=6;i>=0;i--){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);const k=dayKey(d);const count=state.activity.filter(a=>['task_complete','sub_complete'].includes(a.type)&&dayKey(a.at)===k).length;arr.push({date:d,key:k,count});}return arr;
}
function renderProgress(){
  const s=taskStats(),days=sevenDayData(),max=Math.max(1,...days.map(d=>d.count));
  const tags={};state.tasks.filter(t=>!t.completed).forEach(t=>(t.tags||[]).forEach(tag=>tags[tag]=(tags[tag]||0)+1));
  const tagRows=Object.entries(tags).sort((a,b)=>b[1]-a[1]).slice(0,12);
  if(!groundingCards[groundingIndex])chooseGroundingCard();
  $('#view').innerHTML=header('Progress','Useful signals only — no dashboard clutter.') + `
    <div class="feature-stack">
      ${monthlyGrowthFeatureHtml(false)}
      ${groundingCardHtml(false)}
    </div>
    <div class="grid two" style="margin-top:15px">
      <div class="card">
        <div class="section-head" style="margin-top:0"><h3>Overall completion</h3><span>${s.done}/${s.total} tasks</span></div>
        <div class="overview-main"><div class="progress-ring" style="--p:${s.pct}"><div class="inside"><strong>${s.pct}%</strong><small>tasks done</small></div></div>
          <div>
            <div class="metric-row"><span>Open tasks</span><b>${s.open}</b></div>
            <div class="metric-row"><span>Completed tasks</span><b>${s.done}</b></div>
            <div class="metric-row"><span>Subtask progress</span><div class="mini-progress"><i style="width:${s.spct}%"></i></div><b>${s.spct}%</b></div>
          </div>
        </div>
      </div>
      <div class="card"><div class="section-head" style="margin-top:0"><h3>7-day activity</h3><span>task + subtask completions</span></div>
        <div class="bars">${days.map(d=>`<div class="bar-col"><b>${d.count||''}</b><div class="bar" style="height:${Math.max(4,d.count/max*135)}px"></div><small>${d.date.toLocaleDateString(undefined,{weekday:'short'}).slice(0,2)}</small></div>`).join('')}</div>
      </div>
    </div>
    <div class="grid two" style="margin-top:15px">
      <div class="card"><div class="section-head" style="margin-top:0"><h3>Active tags</h3><span>open tasks</span></div><div class="tagcloud">${tagRows.length?tagRows.map(([t,c])=>`<button>#${esc(t)} <b>${c}</b></button>`).join(''):'<span class="subtitle">No active tags yet.</span>'}</div></div>
      <div class="card"><div class="section-head" style="margin-top:0"><h3>Recent task activity</h3><span>latest 8</span></div><div class="activity">${activityRows(8)}</div></div>
    </div>`;
  wireGrounding();wireInstall();
}
function activityRows(n=8){
  const rows=state.activity.slice(0,n);
  return rows.length?rows.map(a=>`<div class="activity-row"><span class="dot"></span><div>${esc(a.text)}</div><time>${relativeTime(a.at)}</time></div>`).join(''):`<div class="subtitle">Activity appears as you work.</div>`;
}
function relativeTime(iso){
  const ms=Date.now()-new Date(iso).getTime(),m=Math.floor(ms/60000);
  if(m<1)return'now';if(m<60)return`${m}m`;const h=Math.floor(m/60);if(h<24)return`${h}h`;return new Date(iso).toLocaleDateString();
}

function focusRemaining(){
  if(state.focus.running&&state.focus.endsAt){return Math.max(0,Math.ceil((new Date(state.focus.endsAt).getTime()-Date.now())/1000));}
  return state.focus.remaining;
}
function fmtTimer(sec){const m=Math.floor(sec/60),s=sec%60;return`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
function renderFocus(){
  const rem=focusRemaining();
  if(state.focus.running&&rem<=0){finishFocus();}
  $('#view').innerHTML=header('Focus','Pomodoro plus a small set of productivity tools.') + `
    <div class="grid two">
      <div class="card pomo-wrap">
        <div class="timer-label">${state.focus.preset===5||state.focus.preset===15?'Break':'Focus session'}</div>
        <div class="timer" id="timer">${fmtTimer(rem)}</div>
        <div class="preset-row">${[[25,'25 Focus'],[50,'50 Deep'],[5,'5 Break'],[15,'15 Long']].map(([m,l])=>`<button data-preset="${m}" class="${state.focus.preset===m?'active':''}">${l}</button>`).join('')}</div>
        <div class="field" style="max-width:360px;margin:0 auto 15px;text-align:left"><label>Focus task</label><select id="focus-task"><option value="">No task selected</option>${state.tasks.filter(t=>!t.completed).map(t=>`<option value="${t.id}" ${state.focus.taskId===t.id?'selected':''}>${esc(t.title)}</option>`).join('')}</select></div>
        <div style="display:flex;justify-content:center;gap:8px"><button class="btn primary" id="focus-toggle">${state.focus.running?'Pause':'Start'}</button><button class="btn" id="focus-reset">Reset</button></div>
        <div class="subtitle" style="margin-top:15px">${state.focus.sessions} focus sessions completed</div>
      </div>
      <div class="card"><div class="section-head" style="margin-top:0"><h3>Focus queue</h3><span>choose deliberately</span></div>
        <div class="task-list">${state.tasks.filter(t=>!t.completed).slice(0,6).map(taskCard).join('')||'<div class="empty"><b>No task in queue</b>Add a task first.</div>'}</div>
      </div>
    </div>
    ${focusStatsHtml()}
    <div class="section-head"><h3>Productivity tools</h3><span>small tools with a clear purpose</span></div>
    <div class="grid four">
      ${toolCard('✦','Quick capture','Create a task before the thought disappears.','quick-capture')}
      ${toolCard('▥','Daily review','Open progress and review what moved.','go-progress')}
      ${toolCard('▣','Note scanner','Turn handwritten pages into a PDF.','go-scan')}
      ${toolCard('⌘','Resource library','Books, links, tutorials and files in one place.','go-resources')}
    </div>`;
  $('#focus-toggle').onclick=toggleFocus;$('#focus-reset').onclick=resetFocus;$('#focus-task').onchange=e=>{state.focus.taskId=e.target.value;saveState();};
  $$('[data-preset]').forEach(b=>b.onclick=()=>setPreset(Number(b.dataset.preset)));
  $('#quick-capture').onclick=()=>openTaskModal();$('#go-progress').onclick=()=>go('progress');$('#go-scan').onclick=()=>go('scanner');$('#go-resources').onclick=()=>go('resources');
  wireTaskCards();wireInstall();startTick();
}
function toolCard(icon,title,p,id){return`<button id="${id}" class="card tool-card" style="text-align:left;border:1px solid var(--line)"><div class="tool-icon">${icon}</div><h4>${esc(title)}</h4><p>${esc(p)}</p></button>`}
function go(v){currentView=v;shell();renderView();}
function setPreset(m){state.focus.preset=m;state.focus.remaining=m*60;state.focus.running=false;state.focus.endsAt=null;saveState();renderFocus();}
function toggleFocus(){
  if(state.focus.running){state.focus.remaining=focusRemaining();state.focus.running=false;state.focus.endsAt=null;}
  else{state.focus.running=true;state.focus.endsAt=new Date(Date.now()+state.focus.remaining*1000).toISOString();}
  saveState();renderFocus();
}
function resetFocus(){state.focus.running=false;state.focus.remaining=state.focus.preset*60;state.focus.endsAt=null;saveState();renderFocus();}
function finishFocus(){
  state.focus.running=false;state.focus.remaining=state.focus.preset*60;state.focus.endsAt=null;
  if(state.focus.preset>=20){state.focus.sessions++;const t=state.tasks.find(x=>x.id===state.focus.taskId);addActivity('focus',`Finished ${state.focus.preset}-minute focus${t?' for “'+t.title+'”':''}`,t?.id||'',{minutes:state.focus.preset});}
  saveState();toast('Focus session finished.'); 
}
function startTick(){
  clearInterval(tickHandle);tickHandle=setInterval(()=>{
    if(currentView!=='focus')return;const el=$('#timer');if(!el)return;const r=focusRemaining();el.textContent=fmtTimer(r);
    if(state.focus.running&&r<=0){finishFocus();renderFocus();}
  },1000);
}


function renderMatrix(){
  const quadrants=[
    {title:'I · Urgent & Important',cls:'q1',test:t=>t.urgent&&t.important},
    {title:'II · Important, not Urgent',cls:'q2',test:t=>!t.urgent&&t.important},
    {title:'III · Urgent, not Important',cls:'q3',test:t=>t.urgent&&!t.important},
    {title:'IV · Neither',cls:'q4',test:t=>!t.urgent&&!t.important}
  ];
  const open=state.tasks.filter(t=>!t.completed&&!t.wontDo);
  $('#view').innerHTML=header('Eisenhower Matrix','Urgency and importance are optional task fields.',`<button class="btn primary" id="matrix-new">+ Task</button>`) + `
    <div class="matrix-grid">${quadrants.map(q=>{const rows=open.filter(q.test);return`<div class="matrix-box ${q.cls}"><h3>${esc(q.title)}</h3><div class="matrix-tasks">${rows.length?rows.map(taskCard).join(''):'<div class="matrix-empty">No tasks</div>'}</div></div>`}).join('')}</div>`;
  $('#matrix-new').onclick=()=>openTaskModal();wireTaskCards();wireInstall();
}
function countdownDiff(item){
  const target=new Date(item.date+'T00:00:00'),now=new Date();now.setHours(0,0,0,0);
  return Math.round((target-now)/86400000);
}
function renderCountdown(){
  const rows=[...state.countdowns].sort((a,b)=>Math.abs(countdownDiff(a))-Math.abs(countdownDiff(b)));
  $('#view').innerHTML=header('Countdown','Days left and days since, without mixing them into your task list.',`<button class="btn primary" id="new-countdown">+ Countdown</button>`) + `
    <div class="countdown-list">${rows.length?rows.map(c=>{const diff=countdownDiff(c),since=diff<0;return`<div class="count-card"><div class="count-icon">${esc(c.icon||'⌛')}</div><div><b>${esc(c.name)}</b><small>${esc(c.date)}</small></div><div class="count-number ${since?'since':''}"><strong>${Math.abs(diff)}</strong><span>Days ${since?'Since':'Left'}</span></div><button class="minus-btn" data-count-remove="${c.id}">−</button></div>`}).join(''):`<div class="empty"><div class="sprout">⌛</div><b>No countdowns</b>Add an exam, deadline, milestone or a date you want to count from.</div>`}</div>`;
  $('#new-countdown').onclick=()=>{const name=prompt('Countdown name');if(!name)return;const date=prompt('Date (YYYY-MM-DD)',localDateKey());if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return alert('Use YYYY-MM-DD.');const icon=prompt('Optional icon / emoji','⌛')||'⌛';state.countdowns.push({id:uid('cd'),name:name.trim(),date,icon});saveState();renderCountdown();};
  $$('[data-count-remove]').forEach(b=>b.onclick=()=>{state.countdowns=state.countdowns.filter(c=>c.id!==b.dataset.countRemove);saveState();renderCountdown();});
  wireInstall();
}
function focusStats(){
  const acts=state.activity.filter(a=>a.type==='focus'),todayK=localDateKey();
  const todayActs=acts.filter(a=>dayKey(a.at)===todayK);
  const totalMinutes=acts.reduce((sum,a)=>sum+focusMinutesFromActivity(a),0);
  const todayMinutes=todayActs.reduce((sum,a)=>sum+focusMinutesFromActivity(a),0);
  const days=[];for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const k=localDateKey(d);const mins=acts.filter(a=>dayKey(a.at)===k).reduce((sum,a)=>sum+focusMinutesFromActivity(a),0);days.push({d,mins});}
  return{todayPomo:todayActs.length,todayMinutes,totalPomo:acts.length,totalMinutes,days};
}
function focusStatsHtml(){
  const fs=focusStats(),max=Math.max(1,...fs.days.map(d=>d.mins));
  const hm=m=>`${Math.floor(m/60)}h ${m%60}m`;
  return `<div class="section-head"><h3>Focus Statistics</h3><span>real sessions only</span></div>
    <div class="grid four focus-stat-grid">
      <div class="card stat"><div class="k">TODAY'S POMO</div><div class="v">${fs.todayPomo}</div></div>
      <div class="card stat"><div class="k">TODAY'S FOCUS</div><div class="v focus-v">${hm(fs.todayMinutes)}</div></div>
      <div class="card stat"><div class="k">TOTAL POMO</div><div class="v">${fs.totalPomo}</div></div>
      <div class="card stat"><div class="k">TOTAL FOCUS</div><div class="v focus-v">${hm(fs.totalMinutes)}</div></div>
    </div>
    <div class="card" style="margin-top:15px"><div class="section-head" style="margin-top:0"><h3>7-day focus trend</h3><span>minutes</span></div>
      <div class="bars">${fs.days.map(x=>`<div class="bar-col"><b>${x.mins||''}</b><div class="bar focus-bar" style="height:${Math.max(4,x.mins/max*135)}px"></div><small>${x.d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,2)}</small></div>`).join('')}</div>
    </div>`;
}
function renderMore(){
  const tools=[
    ['trackers','↗','Trackers','Custom metrics and logs'],
    ['countdown','⌛','Countdown','Days left / days since'],
    ['notes','▤','Notes','Folders and subnotes'],
    ['scanner','▣','Scanner','Handwritten pages → PDF'],
    ['resources','⌘','Resources','Books, links and tutorials'],
    ['arete','❧','Arete','Philosophy and growth'],
    ['sync','⇄','Backup','Export / import local data']
  ];
  $('#view').innerHTML=header('More','Utilities stay here so the primary navigation remains clean.')+`<div class="grid three">${tools.map(([v,i,t,d])=>`<button class="card tool-card more-tile" data-more="${v}"><div class="tool-icon">${i}</div><h4>${esc(t)}</h4><p>${esc(d)}</p></button>`).join('')}</div>`;
  $$('[data-more]').forEach(b=>b.onclick=()=>go(b.dataset.more));wireInstall();
}

function allNoteFolders(){
  const general=state.generalNoteFolders.map(f=>({...f,scope:'General',taskId:''}));
  const taskFolders=state.tasks.flatMap(t=>(t.noteFolders||[]).map(f=>({...f,scope:t.title,taskId:t.id})));
  return[...general,...taskFolders];
}
let activeNoteFolderId='';
function renderNotes(){
  const folders=allNoteFolders();if(!activeNoteFolderId&&folders[0])activeNoteFolderId=folders[0].id;
  const active=folders.find(f=>f.id===activeNoteFolderId)||folders[0];
  $('#view').innerHTML=header('Notes','Folders and subnotes — organized without turning into a second file system.',`<button class="btn primary" id="new-general-folder">+ Folder</button>`) + `
    <div class="notes-layout">
      <div class="card flat"><div class="section-head" style="margin-top:0"><h3>Folders</h3><span>${folders.length}</span></div><div class="folder-list">
        ${folders.map(f=>`<button class="folder-item ${active?.id===f.id?'active':''}" data-folder="${f.id}"><span><b>${esc(f.name)}</b><br><small>${esc(f.scope)}</small></span><span class="minus" data-remove-folder="${f.id}">−</span></button>`).join('')}
      </div></div>
      <div class="card">${active?`<div class="section-head" style="margin-top:0"><h3>${esc(active.name)}</h3><span>${esc(active.scope)}</span></div>
        <div id="notes-list">${(active.subnotes||[]).map(n=>`<div class="note-item"><div style="display:flex;justify-content:space-between;gap:8px"><h4>${esc(n.title||'Untitled')}</h4><button class="minus-btn" data-remove-note="${n.id}">−</button></div><p>${esc(n.body||'')}</p></div>`).join('')||'<div class="empty"><b>No subnotes</b>Add the first note inside this folder.</div>'}</div>
        <button class="btn sage" id="add-subnote" style="margin-top:12px">+ Subnote</button>`:'<div class="empty"><b>No folder selected</b></div>'}</div>
    </div>`;
  $('#new-general-folder').onclick=()=>{const name=prompt('Folder name');if(!name)return;const f={id:uid('nf'),name:name.trim(),subnotes:[]};state.generalNoteFolders.push(f);activeNoteFolderId=f.id;saveState();renderNotes();};
  $$('[data-folder]').forEach(b=>b.onclick=e=>{if(e.target.closest('[data-remove-folder]'))return;activeNoteFolderId=b.dataset.folder;renderNotes();});
  $$('[data-remove-folder]').forEach(b=>b.onclick=e=>{e.stopPropagation();removeNoteFolder(b.dataset.removeFolder);});
  if(active){$('#add-subnote').onclick=()=>addSubnote(active);$$('[data-remove-note]').forEach(b=>b.onclick=()=>removeSubnote(active,b.dataset.removeNote));}
  wireInstall();
}
function locateFolder(id){
  let f=state.generalNoteFolders.find(x=>x.id===id);if(f)return{folder:f,arr:state.generalNoteFolders};
  for(const t of state.tasks){f=(t.noteFolders||[]).find(x=>x.id===id);if(f)return{folder:f,arr:t.noteFolders,task:t};}
  return null;
}
function removeNoteFolder(id){
  const loc=locateFolder(id);if(!loc)return;if(!confirm(`Remove folder “${loc.folder.name}” and its subnotes?`))return;
  loc.arr.splice(loc.arr.indexOf(loc.folder),1);activeNoteFolderId='';saveState();renderNotes();
}
function addSubnote(folder){
  const title=prompt('Subnote title');if(title===null)return;const body=prompt('Write note')??'';
  const loc=locateFolder(folder.id);if(!loc)return;loc.folder.subnotes.push({id:uid('sn'),title:title.trim()||'Untitled',body,createdAt:nowIso()});
  if(loc.task)addActivity('note_add',`Added note “${title.trim()||'Untitled'}” to “${loc.task.title}”`,loc.task.id);
  saveState();renderNotes();
}
function removeSubnote(folder,nid){
  const loc=locateFolder(folder.id);if(!loc)return;loc.folder.subnotes=loc.folder.subnotes.filter(n=>n.id!==nid);saveState();renderNotes();
}

function allResources(){
  const taskRes=state.tasks.flatMap(t=>(t.resources||[]).map(r=>({...r,owner:t.title,ownerType:'Task'})));
  const trackerRes=state.trackers.flatMap(t=>(t.resources||[]).map(r=>({...r,owner:t.name,ownerType:'Tracker'})));
  return[...taskRes,...trackerRes].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
}
function resourceIcon(type){return({book:'▤',tutorial:'▶',article:'≡',video:'▷',link:'↗',file:'▣',note:'✎'})[type]||'⌘'}
function renderResources(){
  const res=allResources();
  $('#view').innerHTML=header('Resource Library','Everything saved to a task or tracker, collected here.') + `
  <div class="card"><div class="section-head" style="margin-top:0"><h3>Saved resources</h3><span>${res.length}</span></div>
    ${res.length?res.map(r=>`<div class="resource-row"><div class="resource-icon">${resourceIcon(r.type)}</div><div><b>${esc(r.title)}</b><small>${esc(r.type)} • ${esc(r.ownerType)}: ${esc(r.owner)}${r.fileName?' • '+esc(r.fileName):''}</small></div><button class="btn small" data-open-resource="${r.id}">Open</button></div>`).join(''):`<div class="empty"><b>No resources saved</b>Add a book, tutorial, link or file from a task or tracker.</div>`}
  </div>`;
  $$('[data-open-resource]').forEach(b=>b.onclick=()=>openGlobalResource(b.dataset.openResource));wireInstall();
}
async function openGlobalResource(id){
  const owners=[...state.tasks,...state.trackers];let r;
  for(const o of owners){r=(o.resources||[]).find(x=>x.id===id);if(r)break;}
  if(!r)return;
  if(r.fileId){const f=await getFile(r.fileId);if(f){const url=URL.createObjectURL(f);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000);return;}}
  if(r.url){window.open(r.url,'_blank','noopener');return;}
  alert(r.note||'No link or local file attached.');
}

function renderScanner(){
  $('#view').innerHTML=header('Handwritten Note Scanner','Take/select page photos and convert them into one PDF.',`<button class="btn primary" id="add-scan">+ Add pages</button>`) + `
    <div class="card">
      <div class="section-head" style="margin-top:0"><h3>Pages</h3><span>${scanPages.length}</span></div>
      ${scanPages.length?`<div class="scan-grid">${scanPages.map((p,i)=>`<div class="scan-page"><img src="${p.url}" alt="page ${i+1}"><button data-remove-page="${i}">−</button></div>`).join('')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:15px"><button class="btn sage" id="make-pdf">Create PDF</button><button class="btn" id="clear-scan">Clear</button></div>`:`<div class="empty"><div class="sprout">📄</div><b>No pages yet</b>On iPhone, choose Camera or Photo Library. Add several pages if needed.</div>`}
    </div>`;
  $('#add-scan').onclick=()=>$('#scan-input').click();
  $$('[data-remove-page]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.removePage);URL.revokeObjectURL(scanPages[i].url);scanPages.splice(i,1);renderScanner();});
  if($('#clear-scan'))$('#clear-scan').onclick=()=>{scanPages.forEach(p=>URL.revokeObjectURL(p.url));scanPages=[];renderScanner();};
  if($('#make-pdf'))$('#make-pdf').onclick=createImagePdf;
  wireInstall();
}
$('#scan-input').addEventListener('change',e=>{
  [...e.target.files].forEach(file=>scanPages.push({file,url:URL.createObjectURL(file)}));e.target.value='';if(currentView==='scanner')renderScanner();
});
async function imageToJpeg(file){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url;});
    const max=1800,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);
    const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.88));
    return{bytes:new Uint8Array(await blob.arrayBuffer()),width:c.width,height:c.height};
  } finally {URL.revokeObjectURL(url);}
}
function enc(s){return new TextEncoder().encode(s);}
function concatBytes(arrs){const n=arrs.reduce((a,b)=>a+b.length,0),out=new Uint8Array(n);let p=0;for(const a of arrs){out.set(a,p);p+=a.length;}return out;}
async function createImagePdf(){
  if(!scanPages.length)return;
  toast('Building PDF…');
  try{
    const imgs=[];for(const p of scanPages)imgs.push(await imageToJpeg(p.file));
    const objs=[];const pageIds=[],imageIds=[],contentIds=[];
    let next=3;for(let i=0;i<imgs.length;i++){pageIds.push(next++);imageIds.push(next++);contentIds.push(next++);}
    objs[1]=enc(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    objs[2]=enc(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${imgs.length} >>\nendobj\n`);
    const PW=595,PH=842,M=20;
    imgs.forEach((im,i)=>{
      const fit=Math.min((PW-2*M)/im.width,(PH-2*M)/im.height),w=im.width*fit,h=im.height*fit,x=(PW-w)/2,y=(PH-h)/2;
      objs[pageIds[i]]=enc(`${pageIds[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${imageIds[i]} 0 R >> >> /Contents ${contentIds[i]} 0 R >>\nendobj\n`);
      const prefix=enc(`${imageIds[i]} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`);
      const suffix=enc(`\nendstream\nendobj\n`);objs[imageIds[i]]=concatBytes([prefix,im.bytes,suffix]);
      const content=`q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im${i} Do\nQ\n`;
      objs[contentIds[i]]=enc(`${contentIds[i]} 0 obj\n<< /Length ${enc(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    });
    const maxId=next-1,header=enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');let offset=header.length;const offsets=Array(maxId+1).fill(0),parts=[header];
    for(let id=1;id<=maxId;id++){offsets[id]=offset;parts.push(objs[id]);offset+=objs[id].length;}
    const xrefPos=offset;let xref=`xref\n0 ${maxId+1}\n0000000000 65535 f \n`;
    for(let id=1;id<=maxId;id++)xref+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;
    xref+=`trailer\n<< /Size ${maxId+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    parts.push(enc(xref));const pdf=concatBytes(parts),blob=new Blob([pdf],{type:'application/pdf'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`Arete-Scan-${today()}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    addActivity('scan','Created a handwritten-note PDF');saveState();toast('PDF created.');
  }catch(err){console.error(err);alert('PDF creation failed for one of the images. Try fewer/smaller pages.');}
}

function renderArete(){
  $('#view').innerHTML=header('Arete','The philosophy behind the workspace.') + `
  <div class="concept-hero"><div class="eyebrow">Why this app exists</div><h3>Excellence is cultivated.</h3>
  <p><b>Arete</b> is built around deliberate growth rather than busyness. The system should help you decide what matters, break it into concrete actions, keep useful knowledge beside the work, and make progress visible without turning your life into a noisy dashboard.</p>
  <div class="growth-steps">
    <div class="growth-step"><span>◉</span><b>Seed</b><small>Choose what matters.</small></div>
    <div class="growth-step"><span>⌁</span><b>Root</b><small>Build consistency.</small></div>
    <div class="growth-step"><span>♧</span><b>Sprout</b><small>Make progress visible.</small></div>
    <div class="growth-step"><span>❀</span><b>Bloom</b><small>Turn effort into excellence.</small></div>
  </div></div>
  <div class="grid three" style="margin-top:15px">
    <div class="card"><h4>Clarity before quantity</h4><p class="subtitle">High Priority is empty until you choose what deserves it.</p></div>
    <div class="card"><h4>Knowledge beside action</h4><p class="subtitle">Books, links, tutorials, files and notes live with the task or tracker they support.</p></div>
    <div class="card"><h4>Signals, not noise</h4><p class="subtitle">Progress uses a few useful visuals: completion, recent activity, subtasks and a 7-day trend.</p></div>
  </div>`;wireInstall();
}

function renderSync(){
  $('#view').innerHTML=header('Backup & Sync','Cloud-ready architecture; immediate build uses local storage.') + `
    <div class="grid two">
      <div class="card"><div class="section-head" style="margin-top:0"><h3>Current storage</h3><span>Local-first</span></div>
        <p class="subtitle">Tasks, trackers, notes and activity are stored in this browser/app installation. Uploaded files are kept in the browser’s local file database.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:15px"><button class="btn sage" id="export-backup">Export backup</button><button class="btn" id="import-backup">Import backup</button></div>
      </div>
      <div class="card"><div class="section-head" style="margin-top:0"><h3>Cloud sync layer</h3><span>architecture reserved</span></div>
        <p class="subtitle">The data model is already separated from the UI so a real account/database sync provider can replace the local provider without rebuilding task logic.</p>
        <div class="metric-row"><span>Web ↔ iPhone real-time sync</span><b>Next backend step</b></div>
        <div class="metric-row"><span>Immediate cross-device fallback</span><b>Backup import/export</b></div>
      </div>
    </div>`;
  $('#export-backup').onclick=exportBackup;$('#import-backup').onclick=()=>$('#import-backup-input').click();wireInstall();
}
function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Arete-Backup-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Backup exported.');
}
$('#import-backup-input').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;try{const parsed=JSON.parse(await f.text());state=normalizeState(parsed);saveState();toast('Backup imported.');renderView();}catch(err){alert('That file is not a valid Arete backup.');}e.target.value='';
});

function openTaskModal(id=''){
  editingTaskId=id||null;modalTab='details';
  const t=id?state.tasks.find(x=>x.id===id):{id:'',title:'',completed:false,priority:'none',dueDate:'',dueTime:'',tags:[],subtasks:[],noteFolders:[],resources:[],listId:'inbox',urgent:false,important:false,pinned:false,wontDo:false};
  if(!t)return;
  currentModal=document.createElement('div');currentModal.className='modal-backdrop';document.body.appendChild(currentModal);
  drawTaskModal(t);
}
function drawTaskModal(t){
  const tempNew=!t.id;
  currentModal.innerHTML=`<div class="modal"><div class="modal-head"><div><div class="eyebrow">${tempNew?'New task':'Task'}</div><h3>${esc(t.title||'Untitled task')}</h3></div><button class="btn small" id="close-modal">Close</button></div>
  <div class="modal-body">
    <div class="tabs"><button data-tab="details" class="${modalTab==='details'?'active':''}">Details</button><button data-tab="notes" class="${modalTab==='notes'?'active':''}" ${tempNew?'disabled':''}>Notes</button><button data-tab="resources" class="${modalTab==='resources'?'active':''}" ${tempNew?'disabled':''}>Resources</button><button data-tab="activity" class="${modalTab==='activity'?'active':''}" ${tempNew?'disabled':''}>Activity</button><button data-tab="more" class="${modalTab==='more'?'active':''}" ${tempNew?'disabled':''}>More</button></div>
    <div id="task-tab">${taskTabHtml(t,tempNew)}</div>
  </div>
  <div class="modal-foot"><button class="btn" id="cancel-task">Cancel</button>${t.id?'<button class="btn danger" id="delete-task">Delete</button>':''}<button class="btn primary" id="save-task">${t.id?'Save':'Create task'}</button></div></div>`;
  $('#close-modal').onclick=closeModal;$('#cancel-task').onclick=closeModal;$('#save-task').onclick=()=>saveTaskFromModal(t);
  if($('#delete-task'))$('#delete-task').onclick=()=>deleteTask(t.id);
  $$('[data-tab]').forEach(b=>b.onclick=()=>{if(b.disabled)return;captureTaskFields(t);modalTab=b.dataset.tab;drawTaskModal(t);});
  wireTaskTab(t);
}
function taskTabHtml(t,tempNew){
  if(modalTab==='details')return `
    <div class="form-grid">
      <div class="field full"><label>Task</label><div style="display:grid;grid-template-columns:auto 1fr;gap:9px;align-items:center"><button class="check ${t.completed?'on':''}" id="edit-task-check"></button><input id="task-title" value="${esc(t.title)}" placeholder="What needs to be done?"></div></div>
      <div class="field"><label>List</label><select id="task-list">${state.lists.map(l=>`<option value="${l.id}" ${t.listId===l.id?'selected':''}>${esc(l.icon||'•')} ${esc(l.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Priority</label><select id="task-priority">${['none','low','medium','high','urgent'].map(p=>`<option ${t.priority===p?'selected':''}>${p}</option>`).join('')}</select></div>
      <div class="field"><label>Tags</label><input id="task-tags" value="${esc((t.tags||[]).join(', '))}" placeholder="work, study, health"></div>
      <div class="field"><label>Planning</label><div class="toggle-row"><label><input id="task-urgent" type="checkbox" ${t.urgent?'checked':''}> Urgent</label><label><input id="task-important" type="checkbox" ${t.important?'checked':''}> Important</label></div></div>
      <div class="field"><label>Due date</label><input id="task-date" type="date" value="${esc(t.dueDate)}"></div>
      <div class="field"><label>Due time</label><input id="task-time" type="time" value="${esc(t.dueTime)}"></div>
      <div class="field full"><label>Subtasks</label><div class="subtask-editor" id="subtask-editor">${(t.subtasks||[]).map(s=>subtaskLine(s)).join('')}</div><button class="btn small" id="add-subtask" style="align-self:flex-start;margin-top:7px">+ Subtask</button></div>
    </div>`;
  if(modalTab==='notes')return taskNotesHtml(t);
  if(modalTab==='resources')return taskResourcesHtml(t);
  if(modalTab==='more')return `<div class="task-action-grid">
    <button class="action-tile" id="action-pin"><span>⌖</span><b>${t.pinned?'Unpin':'Pin'}</b><small>Keep near the top</small></button>
    <button class="action-tile" id="action-focus"><span>◷</span><b>Start Focus</b><small>Open Pomodoro with this task</small></button>
    <button class="action-tile" id="action-duplicate"><span>⧉</span><b>Duplicate</b><small>Create a copy</small></button>
    <button class="action-tile" id="action-wontdo"><span>⊠</span><b>${t.wontDo?'Restore':'Won\'t Do'}</b><small>Archive without completion</small></button>
    <button class="action-tile" id="action-share"><span>↗</span><b>Share</b><small>Copy task summary</small></button>
    <button class="action-tile danger-tile" id="action-delete-more"><span>−</span><b>Delete</b><small>Remove task</small></button>
  </div>`;
  const acts=state.activity.filter(a=>a.taskId===t.id);
  return `<div class="activity">${acts.length?acts.slice(0,40).map(a=>`<div class="activity-row"><span class="dot"></span><div>${esc(a.text)}</div><time>${relativeTime(a.at)}</time></div>`).join(''):'<div class="empty"><b>No activity yet</b></div>'}</div>`;
}
function subtaskLine(s){return`<div class="subtask-line" data-sub="${s.id}"><button class="check ${s.completed?'on':''}" data-sub-check="${s.id}"></button><input value="${esc(s.title)}" data-sub-title="${s.id}" placeholder="Subtask"><button class="minus-btn" data-sub-remove="${s.id}" title="Remove">−</button></div>`}
function wireTaskTab(t){
  if(modalTab==='details'){
    $('#edit-task-check').onclick=()=>{t.completed=!t.completed;$('#edit-task-check').classList.toggle('on',t.completed);};
    $('#add-subtask').onclick=()=>{captureTaskFields(t);t.subtasks.push({id:uid('st'),title:'',completed:false});drawTaskModal(t);};
    $$('[data-sub-check]').forEach(b=>b.onclick=()=>{const sub=t.subtasks.find(x=>x.id===b.dataset.subCheck);if(sub){sub.completed=!sub.completed;sub.completedAt=sub.completed?nowIso():null;b.classList.toggle('on',sub.completed);if(t.id){const actual=state.tasks.find(x=>x.id===t.id);const real=actual?.subtasks.find(x=>x.id===sub.id);if(real){real.completed=sub.completed;real.completedAt=sub.completedAt;}addActivity(sub.completed?'sub_complete':'sub_reopen',`${sub.completed?'Completed':'Reopened'} subtask “${sub.title||'Untitled'}”`,t.id);saveState();}}});
    $$('[data-sub-remove]').forEach(b=>b.onclick=()=>{captureTaskFields(t);t.subtasks=t.subtasks.filter(x=>x.id!==b.dataset.subRemove);drawTaskModal(t);});
  }else if(modalTab==='notes'){
    $('#add-task-folder').onclick=()=>{const name=prompt('Folder name');if(name){t.noteFolders.push({id:uid('nf'),name:name.trim(),subnotes:[]});saveState();drawTaskModal(t);}};
    $$('[data-task-folder-remove]').forEach(b=>b.onclick=()=>{t.noteFolders=t.noteFolders.filter(f=>f.id!==b.dataset.taskFolderRemove);saveState();drawTaskModal(t);});
    $$('[data-add-task-note]').forEach(b=>b.onclick=()=>{const f=t.noteFolders.find(x=>x.id===b.dataset.addTaskNote);if(!f)return;const title=prompt('Subnote title');if(title===null)return;const body=prompt('Write note')??'';f.subnotes.push({id:uid('sn'),title:title.trim()||'Untitled',body,createdAt:nowIso()});addActivity('note_add',`Added note “${title.trim()||'Untitled'}” to “${t.title}”`,t.id);saveState();drawTaskModal(t);});
    $$('[data-remove-task-note]').forEach(b=>b.onclick=()=>{const [fid,nid]=b.dataset.removeTaskNote.split('|'),f=t.noteFolders.find(x=>x.id===fid);if(f)f.subnotes=f.subnotes.filter(n=>n.id!==nid);saveState();drawTaskModal(t);});
  }else if(modalTab==='resources'){
    $('#add-resource').onclick=()=>openResourcePrompt(t,'task');
    $$('[data-res-remove]').forEach(b=>b.onclick=async()=>{const r=t.resources.find(x=>x.id===b.dataset.resRemove);if(r?.fileId)await deleteFile(r.fileId);t.resources=t.resources.filter(x=>x.id!==b.dataset.resRemove);saveState();drawTaskModal(t);});
    $$('[data-res-open]').forEach(b=>b.onclick=()=>openResource(t.resources.find(x=>x.id===b.dataset.resOpen)));
  }else if(modalTab==='more'){
    $('#action-pin').onclick=()=>{t.pinned=!t.pinned;const a=state.tasks.find(x=>x.id===t.id);if(a)a.pinned=t.pinned;addActivity('task_update',`${t.pinned?'Pinned':'Unpinned'} “${t.title}”`,t.id);saveState();drawTaskModal(t);};
    $('#action-focus').onclick=()=>{state.focus.taskId=t.id;saveState();closeModal();go('focus');};
    $('#action-duplicate').onclick=()=>{const copy=JSON.parse(JSON.stringify(t));copy.id=uid('t');copy.title=t.title+' — copy';copy.completed=false;copy.completedAt=null;copy.createdAt=nowIso();copy.pinned=false;state.tasks.unshift(copy);addActivity('task_create',`Duplicated “${t.title}”`,copy.id);saveState();closeModal();renderView();};
    $('#action-wontdo').onclick=()=>{t.wontDo=!t.wontDo;const a=state.tasks.find(x=>x.id===t.id);if(a)a.wontDo=t.wontDo;addActivity('task_update',`${t.wontDo?'Marked Won\'t Do':'Restored'} “${t.title}”`,t.id);saveState();drawTaskModal(t);};
    $('#action-share').onclick=async()=>{const text=`${t.title}${t.dueDate?' — '+t.dueDate:''}`;try{if(navigator.share)await navigator.share({title:'Arete task',text});else{await navigator.clipboard.writeText(text);toast('Task copied.');}}catch(e){}};
    $('#action-delete-more').onclick=()=>deleteTask(t.id);
  }
}
function captureTaskFields(t){
  if(modalTab!=='details')return;
  t.title=$('#task-title')?.value??t.title;t.priority=$('#task-priority')?.value??t.priority;t.dueDate=$('#task-date')?.value??t.dueDate;t.dueTime=$('#task-time')?.value??t.dueTime;
  t.listId=$('#task-list')?.value??t.listId;t.urgent=!!$('#task-urgent')?.checked;t.important=!!$('#task-important')?.checked;
  t.tags=($('#task-tags')?.value||'').split(',').map(x=>x.trim()).filter(Boolean);
  $$('[data-sub-title]').forEach(inp=>{const s=t.subtasks.find(x=>x.id===inp.dataset.subTitle);if(s)s.title=inp.value;});
}
function saveTaskFromModal(t){
  captureTaskFields(t);t.subtasks=t.subtasks.filter(s=>s.title.trim());
  if(!t.title.trim()){alert('Write a task name first.');return;}
  if(!t.id){t.id=uid('t');t.createdAt=nowIso();t.completedAt=t.completed?nowIso():null;state.tasks.unshift(t);addActivity('task_create',`Created “${t.title}”`,t.id);}
  else{
    const actual=state.tasks.find(x=>x.id===t.id);if(actual){Object.assign(actual,t);addActivity('task_update',`Updated “${t.title}”`,t.id);}
  }
  saveState();closeModal();renderView();
}
function deleteTask(id){
  const t=state.tasks.find(x=>x.id===id);if(!t||!confirm(`Delete “${t.title}”?`))return;
  (t.resources||[]).forEach(r=>r.fileId&&deleteFile(r.fileId));state.tasks=state.tasks.filter(x=>x.id!==id);addActivity('task_delete',`Deleted “${t.title}”`);saveState();closeModal();renderView();
}
function taskNotesHtml(t){
  return `<div class="section-head" style="margin-top:0"><h3>Note folders</h3><button class="btn small" id="add-task-folder">+ Folder</button></div>
  ${(t.noteFolders||[]).length?t.noteFolders.map(f=>`<div class="card flat" style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(f.name)}</b><button class="minus-btn" data-task-folder-remove="${f.id}">−</button></div>
    <div style="margin-top:9px">${(f.subnotes||[]).map(n=>`<div class="note-item"><div style="display:flex;justify-content:space-between"><h4>${esc(n.title)}</h4><button class="minus-btn" data-remove-task-note="${f.id}|${n.id}">−</button></div><p>${esc(n.body)}</p></div>`).join('')||'<div class="subtitle">No subnotes.</div>'}</div>
    <button class="btn small" data-add-task-note="${f.id}">+ Subnote</button></div>`).join(''):`<div class="empty"><b>No note folders</b>Create folders such as Research, Book Notes, Ideas or Meeting Notes.</div>`}`;
}
function taskResourcesHtml(t){
  return `<div class="section-head" style="margin-top:0"><h3>Resource Vault</h3><button class="btn small" id="add-resource">+ Resource</button></div>
  ${(t.resources||[]).length
    ? t.resources.map(r=>`<div class="resource-row"><div class="resource-icon">${resourceIcon(r.type)}</div><div><b>${esc(r.title)}</b><small>${esc(r.type)}${r.fileName?' • '+esc(r.fileName):''}${r.note?' • '+esc(r.note):''}</small></div><div><button class="btn small" data-res-open="${r.id}">Open</button> <button class="minus-btn" data-res-remove="${r.id}">−</button></div></div>`).join('')
    : `<div class="empty"><b>No resources</b>Save a book, tutorial, link, PDF/file or reference note beside this task.</div>`}`;
}
async function openResource(r){
  if(!r)return;if(r.fileId){const f=await getFile(r.fileId);if(f){const u=URL.createObjectURL(f);window.open(u,'_blank');setTimeout(()=>URL.revokeObjectURL(u),60000);return;}}
  if(r.url)window.open(r.url,'_blank','noopener');else alert(r.note||'No link/file attached.');
}
let pendingResourceOwner=null;
function openResourcePrompt(owner,ownerType){
  const type=prompt('Type: book, tutorial, article, video, link, file, note','link');if(type===null)return;
  const clean=(type||'link').trim().toLowerCase();const title=prompt('Title');if(!title)return;
  if(clean==='file'||clean==='book'){
    if(confirm('Choose a local/Drive/Files document now?\n\nCancel = save a URL/reference instead.')){
      pendingResourceOwner={owner,ownerType,type:clean,title:title.trim()};$('#resource-file-input').click();return;
    }
  }
  const url=prompt('URL or reference (optional)','')??'';const note=prompt('Context / note (optional)','')??'';
  owner.resources=owner.resources||[];owner.resources.push({id:uid('r'),type:clean,title:title.trim(),url:url.trim(),note:note.trim(),createdAt:nowIso()});
  if(ownerType==='task')addActivity('resource_add',`Saved ${clean} “${title.trim()}” to “${owner.title}”`,owner.id);
  saveState();if(currentModal)drawTaskModal(owner);else renderView();
}
$('#resource-file-input').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f||!pendingResourceOwner)return;
  try{
    const fileId=await putFile(f),p=pendingResourceOwner,o=p.owner;o.resources=o.resources||[];
    o.resources.push({id:uid('r'),type:p.type,title:p.title,url:'',note:'',fileId,fileName:f.name,mime:f.type,size:f.size,createdAt:nowIso()});
    if(p.ownerType==='task')addActivity('resource_add',`Attached “${f.name}” to “${o.title}”`,o.id);
    saveState();toast('File attached.');if(currentModal&&p.ownerType==='task')drawTaskModal(o);else renderView();
  }catch(err){console.error(err);alert('Could not store that file locally. Try a smaller file or save a Drive link instead.');}
  pendingResourceOwner=null;
});

function openTrackerModal(id=''){
  const existing=id?state.trackers.find(x=>x.id===id):null;
  const t=existing||{id:'',name:'',mode:'Check-in',unit:'',target:'',logs:[],resources:[]};
  editingTrackerId=id||null;
  currentModal=document.createElement('div');currentModal.className='modal-backdrop';document.body.appendChild(currentModal);
  currentModal.innerHTML=`<div class="modal"><div class="modal-head"><div><div class="eyebrow">Tracker</div><h3>${esc(t.name||'New tracker')}</h3></div><button class="btn small" id="close-modal">Close</button></div>
  <div class="modal-body">
    <div class="form-grid"><div class="field full"><label>Name</label><input id="tr-name" value="${esc(t.name)}" placeholder="You decide the tracker"></div>
      <div class="field"><label>Tracking mode</label><select id="tr-mode">${['Check-in','Counter','Rating','Duration','Number','Text Log'].map(x=>`<option ${t.mode===x?'selected':''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Unit</label><input id="tr-unit" value="${esc(t.unit||'')}" placeholder="pages, km, minutes..."></div>
      <div class="field"><label>Target</label><input id="tr-target" value="${esc(t.target||'')}" placeholder="optional"></div>
      <div class="field"><label>New entry</label><input id="tr-value" placeholder="value / text"></div></div>
    ${t.id?`<div style="display:flex;gap:8px;margin-bottom:16px"><button class="btn sage" id="add-log">Add entry</button><button class="btn" id="tr-add-resource">+ Resource</button></div>
    <div class="section-head"><h3>Recent entries</h3><span>${t.logs.length}</span></div>${t.logs.slice(0,15).map(l=>`<div class="activity-row"><span class="dot"></span><div>${esc(l.value)}</div><time>${relativeTime(l.at)}</time></div>`).join('')||'<div class="subtitle">No entries.</div>'}
    <div class="section-head"><h3>Resources</h3><span>${t.resources.length}</span></div>${t.resources.map(r=>`<div class="resource-row"><div class="resource-icon">${resourceIcon(r.type)}</div><div><b>${esc(r.title)}</b><small>${esc(r.type)}</small></div><button class="btn small" data-tr-res="${r.id}">Open</button></div>`).join('')||'<div class="subtitle">No resources.</div>'}`:''}
  </div><div class="modal-foot"><button class="btn" id="cancel-tr">Cancel</button>${t.id?'<button class="btn danger" id="delete-tr">Delete</button>':''}<button class="btn primary" id="save-tr">${t.id?'Save':'Create tracker'}</button></div></div>`;
  $('#close-modal').onclick=closeModal;$('#cancel-tr').onclick=closeModal;
  $('#save-tr').onclick=()=>{t.name=$('#tr-name').value.trim();t.mode=$('#tr-mode').value;t.unit=$('#tr-unit').value.trim();t.target=$('#tr-target').value.trim();if(!t.name)return alert('Name the tracker.');if(!t.id){t.id=uid('tr');state.trackers.unshift(t);}saveState();closeModal();renderTrackers();};
  if($('#add-log'))$('#add-log').onclick=()=>{const v=$('#tr-value').value.trim();if(!v)return;t.logs.unshift({id:uid('lg'),value:v,at:nowIso()});saveState();openTrackerAgain(t.id);};
  if($('#tr-add-resource'))$('#tr-add-resource').onclick=()=>openResourcePrompt(t,'tracker');
  $$('[data-tr-res]').forEach(b=>b.onclick=()=>openResource(t.resources.find(x=>x.id===b.dataset.trRes)));
  if($('#delete-tr'))$('#delete-tr').onclick=()=>{if(confirm(`Delete “${t.name}”?`)){state.trackers=state.trackers.filter(x=>x.id!==t.id);saveState();closeModal();renderTrackers();}};
}
function openTrackerAgain(id){closeModal();openTrackerModal(id);}
function closeModal(){if(currentModal){currentModal.remove();currentModal=null;}}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
if('serviceWorker'in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentView==='focus')renderFocus();});

shell();renderView();
})();
