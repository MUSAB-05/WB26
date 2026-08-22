const cfg = window.APP_CONFIG || {};
const db = window.supabase?.createClient
  ? window.supabase.createClient(cfg.SUPABASE_URL || 'https://westfold.local', cfg.SUPABASE_PUBLISHABLE_KEY || 'mantle-adapter', {
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    })
  : null;

const $ = id => document.getElementById(id);
const el = {
  teamName:$('teamName'), teamLogo:$('teamLogo'), setupNotice:$('setupNotice'),
  installBtn:$('installBtn'), notifyBtn:$('notifyBtn'),
  prevWeeksBtn:$('prevWeeksBtn'), nextWeeksBtn:$('nextWeeksBtn'),
  rangeLabel:$('rangeLabel'), weeksBoard:$('weeksBoard'), toast:$('toast'), liveBadge:$('liveBadge'),
  prideList:$('prideList'), prideSummary:$('prideSummary')
};

let state = null;
let staticConfig = {
  teamName:'Westfold Benchwarmers', minimumPlayers:4, timezone:'Europe/Oslo',
  trainingTime:'19:00', cutoffTime:'21:00', voteReminderTime:'19:00',
  trainingReminderTime:'10:00', weeksVisible:2
};
let configuredPlayers = [];
let groupStart = 0;
let planningFloor = 0;
let installPrompt = null;
let mutationsInFlight = 0;
let refreshInFlight = false;
let lastFingerprint = '';
const LIVE_REFRESH_MS = 1000;

let token = (() => {
  const q = new URLSearchParams(location.search).get('team');
  if (q) localStorage.setItem('wb-token',q);
  return q || localStorage.getItem('wb-token') || '';
})();

const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stableId(name) {
  let h = 2166136261;
  for (const ch of name.trim().toLowerCase()) { h ^= ch.codePointAt(0); h = Math.imul(h,16777619); }
  return `p-${(h>>>0).toString(16).padStart(8,'0')}`;
}
function toast(message) {
  el.toast.textContent=message; el.toast.classList.add('show');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.toast.classList.remove('show'),2800);
}
function addDays(dateIso,days) {
  const d=new Date(`${dateIso}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
}
function timeMin(t='00:00') { const [h,m]=String(t).split(':').map(Number); return (h||0)*60+(m||0); }
function localNow() {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:staticConfig.timezone||'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const g=t=>parts.find(p=>p.type===t)?.value;
  const date=`${g('year')}-${g('month')}-${g('day')}`;
  return {date,minutes:Number(g('hour'))*60+Number(g('minute')),weekday:new Date(`${date}T12:00:00Z`).getUTCDay()};
}
function fmtDate(dateIso) {
  return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'}).format(new Date(`${dateIso}T12:00:00Z`));
}
function fmtShortRange(a,b) {
  const f=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short'}).format(new Date(`${d}T12:00:00Z`));
  return `${f(a)} – ${f(b)}`;
}
function statusLabel(status,kind) {
  const day=kind==='thursday'?'Thursday':'Friday';
  return {confirmed:`${day} confirmed`,cancelled:`${day} cancelled`,backup_ready:'Backup ready',not_needed:'Not needed',waiting:'Waiting'}[status]||'Waiting';
}
function responseFor(playerId,sessionId) {
  return state.responses.find(r=>r.player_id===playerId&&r.session_id===sessionId)?.response||'pending';
}
function guestCount(sessionId) { return Math.max(0,Number(state?.guests?.[sessionId]||0)); }
function counts(session) {
  const players=state.players.filter(p=>p.active!==false);
  let playerComing=0,notComing=0;
  for(const p of players) {
    const r=responseFor(p.id,session.id);
    if(r==='coming')playerComing++; else if(r==='not_coming')notComing++;
  }
  const guests=guestCount(session.id);
  return {playerComing,guests,coming:playerComing+guests,notComing,pending:players.length-playerComing-notComing,total:players.length};
}
function candidate(session) {
  const c=counts(session),min=Number(staticConfig.minimumPlayers||4);
  if(c.coming>=min)return'confirmed';
  if(c.total>0&&c.pending===0)return'cancelled';
  const now=localNow(),dayBefore=addDays(session.session_date,-1);
  if(now.date>dayBefore||(now.date===dayBefore&&now.minutes>=timeMin(staticConfig.cutoffTime||'21:00')))return'cancelled';
  return'waiting';
}
function recalc() {
  if(!state)return;
  for(const w of state.weeks) {
    const th=state.sessions.find(s=>s.week_id===w.id&&s.kind==='thursday');
    const fr=state.sessions.find(s=>s.week_id===w.id&&s.kind==='friday');
    if(!th||!fr)continue;
    th.status=candidate(th); const fs=candidate(fr);
    fr.status=th.status==='confirmed'?'not_needed':th.status==='cancelled'?fs:fs==='confirmed'?'backup_ready':fs;
  }
}
async function loadStaticConfig() {
  try {
    const [configRes,playersRes]=await Promise.all([fetch('./team-config.json',{cache:'no-store'}),fetch('./players.txt',{cache:'no-store'})]);
    if(configRes.ok) staticConfig={...staticConfig,...await configRes.json()};
    if(playersRes.ok) {
      const names=(await playersRes.text()).split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
      configuredPlayers=names.map((name,i)=>({id:stableId(name),name,active:true,sort_order:i}));
    }
  } catch(e) { console.warn('Could not load team config:',e); }
}
function applyStaticConfig() {
  if(!state)return;
  state.team={...state.team,name:staticConfig.teamName,min_players:Number(staticConfig.minimumPlayers||4),timezone:staticConfig.timezone||'Europe/Oslo',cutoff_time:staticConfig.cutoffTime||'21:00',vote_reminder_time:staticConfig.voteReminderTime||'19:00',training_reminder_time:staticConfig.trainingReminderTime||'10:00',training_time:staticConfig.trainingTime||'19:00'};
  if(configuredPlayers.length)state.players=configuredPlayers;
  state.guests ||= {};
  state.weeks.sort((a,b)=>a.thursday_date.localeCompare(b.thursday_date));
  recalc();
}
function chooseInitialGroup() {
  if(!state?.weeks?.length){groupStart=planningFloor=0;return;}
  const now=localNow(),weekend=now.weekday===6||now.weekday===0;
  let i=state.weeks.findIndex(w=>weekend?w.thursday_date>now.date:w.friday_date>=now.date);
  if(i<0)i=Math.max(0,state.weeks.length-1);
  planningFloor=i;
  groupStart=i;
}
function fingerprint(nextState) {
  const responses=(nextState.responses||[]).map(r=>`${r.session_id}:${r.player_id}:${r.response}`).sort();
  const guests=Object.entries(nextState.guests||{}).sort();
  const weeks=(nextState.weeks||[]).map(w=>`${w.id}:${w.thursday_date}:${w.friday_date}`).sort();
  return JSON.stringify([responses,guests,weeks]);
}
async function fetchState() {
  const {data,error}=await db.rpc('get_team_state',{p_token:token});
  if(error)throw error;
  return data;
}
async function load() {
  await loadStaticConfig();
  el.teamName.textContent=staticConfig.teamName; document.title=staticConfig.teamName; el.teamLogo.alt=`${staticConfig.teamName} logo`;
  if(!token||!db) { el.setupNotice.hidden=false; el.weeksBoard.innerHTML='<div class="week-card"><div class="empty-week">Open the private team link to load the schedule.</div></div>'; return; }
  try {
    state=await fetchState(); applyStaticConfig(); chooseInitialGroup(); lastFingerprint=fingerprint(state); render(); setLive(true);
  } catch(e) { console.error(e); setLive(false); toast(e.message||'Could not load team'); }
}
function overallStatus(th,fr) {
  if(th.status==='confirmed')return{text:'Thursday confirmed',cls:'confirmed'};
  if(th.status==='cancelled'&&fr.status==='confirmed')return{text:'Friday confirmed',cls:'confirmed'};
  if(th.status==='cancelled'&&fr.status==='cancelled')return{text:'No training',cls:'cancelled'};
  if(th.status==='cancelled')return{text:'Thursday cancelled',cls:'cancelled'};
  if(fr.status==='backup_ready')return{text:'Friday backup ready',cls:'backup'};
  return{text:'Waiting for votes',cls:''};
}
function countLine(c) {
  return `<div class="count-line"><span class="count-yes">✓ ${c.playerComing}</span>${c.guests?`<span class="count-guest">+${c.guests} guest${c.guests===1?'':'s'}</span>`:''}<span class="count-pending">? ${c.pending}</span><span class="count-no">✕ ${c.notComing}</span></div>`;
}
function voteButtons(player,session) {
  const current=responseFor(player.id,session.id),opts=[['coming','✓','yes','Coming'],['pending','?','pending','Pending'],['not_coming','✕','no','Not coming']];
  return `<div class="vote-control">${opts.map(([value,symbol,cls,label])=>`<button class="vote-btn ${current===value?`active ${cls}`:''}" data-player-id="${esc(player.id)}" data-session-id="${esc(session.id)}" data-response="${value}" title="${label}" aria-label="${esc(player.name)}: ${label}">${symbol}</button>`).join('')}</div>`;
}
function guestControl(session) {
  const n=guestCount(session.id);
  return `<div class="guest-control" aria-label="Guest count">
    <button class="guest-btn" data-guest-session="${esc(session.id)}" data-guest-change="-1" ${n<=0?'disabled':''} aria-label="Remove guest">−</button>
    <strong class="guest-number">${n}</strong>
    <button class="guest-btn plus" data-guest-session="${esc(session.id)}" data-guest-change="1" aria-label="Add guest">+</button>
  </div>`;
}
function dayStatus(session,kind) {
  const c=counts(session),guestText=c.guests?` · ${c.guests} guest${c.guests===1?'':'s'}`:'';
  return `<div class="day-status"><strong>${statusLabel(session.status,kind)}</strong><span>${c.coming}/${staticConfig.minimumPlayers} coming${guestText} · ${c.pending} pending</span></div>`;
}
function renderWeek(w) {
  const th=state.sessions.find(s=>s.week_id===w.id&&s.kind==='thursday'),fr=state.sessions.find(s=>s.week_id===w.id&&s.kind==='friday');
  if(!th||!fr)return'';
  const overall=overallStatus(th,fr),tc=counts(th),fc=counts(fr),players=state.players.filter(p=>p.active!==false).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const today=localNow().date,current=today>=w.thursday_date&&today<=w.friday_date;
  return `<article class="week-card ${current?'current':''}">
    <header class="week-card-header"><div class="week-title-row"><div><h2>Week ${w.iso_week}</h2><p class="week-dates">${fmtShortRange(w.thursday_date,w.friday_date)}</p></div><span class="status-pill ${overall.cls}">${overall.text}</span></div><div class="day-statuses">${dayStatus(th,'thursday')}${dayStatus(fr,'friday')}</div></header>
    <div class="sheet-scroll"><table class="attendance-table"><thead><tr><th>Player</th><th>${fmtDate(w.thursday_date)}<br>${esc(staticConfig.trainingTime)}</th><th>${fmtDate(w.friday_date)}<br>${esc(staticConfig.trainingTime)}</th></tr></thead>
      <tbody>${players.length?players.map(p=>`<tr><td class="player-name" title="${esc(p.name)}">${esc(p.name)}</td><td>${voteButtons(p,th)}</td><td>${voteButtons(p,fr)}</td></tr>`).join(''):`<tr><td colspan="3" class="empty-week">No players configured yet.</td></tr>`}
      <tr class="guest-row"><td class="player-name"><span>Guests</span><small>anonymous count</small></td><td>${guestControl(th)}</td><td>${guestControl(fr)}</td></tr></tbody>
      <tfoot><tr><td>Total</td><td>${countLine(tc)}</td><td>${countLine(fc)}</td></tr></tfoot></table></div>
    <p class="table-tip">Thursday has priority. Guests count toward the minimum.</p>
  </article>`;
}
function actualTrainingSession(w) {
  const th=state.sessions.find(s=>s.week_id===w.id&&s.kind==='thursday');
  const fr=state.sessions.find(s=>s.week_id===w.id&&s.kind==='friday');
  if(!th||!fr)return null;
  if(th.status==='confirmed')return th;
  if(th.status==='cancelled'&&fr.status==='confirmed')return fr;
  return null;
}
function sessionFinished(session) {
  const now=localNow();
  if(now.date>session.session_date)return true;
  if(now.date<session.session_date)return false;
  return now.minutes>=timeMin(staticConfig.trainingTime||'19:00');
}
function prideStats() {
  const completed=[];
  for(const w of state.weeks) {
    const session=actualTrainingSession(w);
    if(session&&sessionFinished(session))completed.push({week:w,session});
  }
  const rows=state.players.filter(p=>p.active!==false).map((p,i)=>({
    id:p.id,name:p.name,sort:Number(p.sort_order??i),
    attended:completed.reduce((n,x)=>n+(responseFor(p.id,x.session.id)==='coming'?1:0),0)
  })).sort((a,b)=>b.attended-a.attended||a.sort-b.sort||a.name.localeCompare(b.name));
  let last=null,rank=0;
  rows.forEach((r,i)=>{if(r.attended!==last){rank=i+1;last=r.attended;}r.rank=rank;});
  return {rows,completedWeeks:completed.length};
}
function renderPride() {
  if(!el.prideList)return;
  const {rows,completedWeeks}=prideStats();
  if(el.prideSummary)el.prideSummary.textContent=completedWeeks?`${completedWeeks} completed training week${completedWeeks===1?'':'s'} counted`:'Starts counting after the first completed training';
  if(!rows.length){el.prideList.innerHTML='<div class="pride-empty">No players configured yet.</div>';return;}
  const badge=rank=>rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'⭐';
  el.prideList.innerHTML=rows.map(r=>`<div class="pride-row"><span class="pride-rank" aria-label="Rank ${r.rank}">${badge(r.rank)}</span><span class="pride-name">${esc(r.name)}</span><span class="pride-count"><strong>${r.attended}</strong><small>week${r.attended===1?'':'s'}</small></span></div>`).join('');
}
function render() {
  if(!state)return;
  el.setupNotice.hidden=true; el.teamName.textContent=staticConfig.teamName;
  const visible=Math.max(1,Number(staticConfig.weeksVisible||2)),slice=state.weeks.slice(groupStart,groupStart+visible);
  el.weeksBoard.innerHTML=slice.length?slice.map(renderWeek).join(''):'<div class="week-card"><div class="empty-week">No weeks available.</div></div>';
  el.rangeLabel.textContent=!slice.length?'No weeks':slice.length===1?`Week ${slice[0].iso_week}`:`Weeks ${slice[0].iso_week}–${slice.at(-1).iso_week}`;
  el.prevWeeksBtn.disabled=groupStart<=planningFloor; el.nextWeeksBtn.disabled=groupStart+visible>=state.weeks.length;
  renderPride();
}
async function setVote(playerId,sessionId,response) {
  mutationsInFlight++;
  try {
    const old=state.responses.find(r=>r.player_id===playerId&&r.session_id===sessionId);
    if(response==='pending')state.responses=state.responses.filter(r=>!(r.player_id===playerId&&r.session_id===sessionId)); else if(old)old.response=response; else state.responses.push({player_id:playerId,session_id:sessionId,response});
    recalc(); render();
    const {error}=await db.rpc('set_response',{p_token:token,p_player_id:playerId,p_session_id:sessionId,p_response:response});
    if(error)throw error;
  } catch(e) { toast(e.message||'Could not save vote'); }
  finally { mutationsInFlight--; await reloadState(true); }
}
async function changeGuests(sessionId,by) {
  const before=guestCount(sessionId); if(by<0&&before<=0)return;
  mutationsInFlight++; state.guests[sessionId]=Math.max(0,before+by); recalc(); render();
  try {
    const {data,error}=await db.rpc('increment_guest_count',{p_token:token,p_session_id:sessionId,p_by:by});
    if(error)throw error;
    if(Number.isFinite(Number(data?.count)))state.guests[sessionId]=Math.max(0,Number(data.count));
    recalc(); render();
  } catch(e) { state.guests[sessionId]=before; recalc(); render(); toast(e.message||'Could not update guests'); }
  finally { mutationsInFlight--; await reloadState(true); }
}
function setLive(ok) {
  if(!el.liveBadge)return;
  el.liveBadge.classList.toggle('offline',!ok); el.liveBadge.querySelector('span:last-child').textContent=ok?'Live':'Reconnecting';
}
async function reloadState(force=false) {
  if(!db||!token||refreshInFlight||mutationsInFlight)return;
  refreshInFlight=true;
  try {
    const oldGroup=groupStart,oldFloor=planningFloor,wasAtFloor=oldGroup===oldFloor;
    const next=await fetchState(); state=next; applyStaticConfig(); const fp=fingerprint(state);
    if(force||fp!==lastFingerprint){
      lastFingerprint=fp;
      chooseInitialGroup();
      if(!wasAtFloor)groupStart=Math.max(planningFloor,Math.min(oldGroup,state.weeks.length-1));
      render();
    }
    setLive(true);
  } catch(e) { console.error(e); setLive(false); }
  finally { refreshInFlight=false; }
}
function b64(s) { const p='='.repeat((4-s.length%4)%4),x=atob((s+p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...x].map(c=>c.charCodeAt(0))); }
async function notifications() {
  if(!('serviceWorker'in navigator&&'PushManager'in window))return toast('Push notifications are not supported here.');
  if(!cfg.VAPID_PUBLIC_KEY)return toast('Notifications are not configured.');
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  if(ios&&!standalone)return toast('On iPhone/iPad, add the app to Home Screen first.');
  try {
    if(await Notification.requestPermission()!=='granted')return;
    const reg=await navigator.serviceWorker.ready; let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(cfg.VAPID_PUBLIC_KEY)});
    const {error}=await db.rpc('save_push_subscription',{p_token:token,p_subscription:sub.toJSON()}); if(error)throw error;
    el.notifyBtn.textContent='🔔✓'; toast('Notifications enabled.');
  } catch(e) { toast(e.message||'Could not enable notifications'); }
}

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.error);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;el.installBtn.hidden=false;});
el.installBtn.onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;el.installBtn.hidden=true;}else toast('Use your browser menu → Add to Home Screen / Install app.');};
el.notifyBtn.onclick=notifications;
el.prevWeeksBtn.onclick=()=>{groupStart=Math.max(planningFloor,groupStart-Math.max(1,Number(staticConfig.weeksVisible||2)));render();};
el.nextWeeksBtn.onclick=()=>{groupStart=Math.min(Math.max(planningFloor,state.weeks.length-1),groupStart+Math.max(1,Number(staticConfig.weeksVisible||2)));render();};
el.weeksBoard.onclick=e=>{
  const vote=e.target.closest('[data-response]');
  if(vote){setVote(vote.dataset.playerId,vote.dataset.sessionId,vote.dataset.response);return;}
  const guest=e.target.closest('[data-guest-change]');
  if(guest)changeGuests(guest.dataset.guestSession,Number(guest.dataset.guestChange));
};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reloadState(true);});
setInterval(()=>{if(document.visibilityState==='visible')reloadState(false);},LIVE_REFRESH_MS);
load();
