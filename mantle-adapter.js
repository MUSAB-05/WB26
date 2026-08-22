(() => {
  const cfg=window.APP_CONFIG||{};
  const nativeFetch=window.fetch.bind(window);
  const base=cfg.MANTLE_BASE_URL||'https://mantledb.sh/v2';

  function decodeTeamToken(token){
    try{const padded=token.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-token.length%4)%4);return JSON.parse(atob(padded));}
    catch{return null;}
  }
  async function request(token,path,{method='GET',body}={}){
    const c=decodeTeamToken(token);if(!c?.n||!c?.k)throw new Error('Invalid private team link.');
    const r=await nativeFetch(`${base}/${encodeURIComponent(c.n)}/${path}`,{method,headers:{'Content-Type':'application/json','X-Mantle-Key':c.k},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}
    if(!r.ok){const e=new Error(data?.error||`Storage error (${r.status})`);e.status=r.status;throw e;}return data;
  }
  async function optionalRequest(token,path){try{return await request(token,path);}catch(e){if(e.status===404)return{};throw e;}}
  async function increment(token,path,key,by){
    const c=decodeTeamToken(token);if(!c?.n||!c?.k)throw new Error('Invalid private team link.');
    const url=`${base}/increment/${encodeURIComponent(c.n)}/${path}`;
    const options={method:'POST',headers:{'Content-Type':'application/json','X-Mantle-Key':c.k},body:JSON.stringify({key,by})};
    let r=await nativeFetch(url,options);
    if(r.status===404){
      await request(token,path,{method:'POST',body:{}});
      r=await nativeFetch(url,options);
    }
    const text=await r.text();let data={};try{data=text?JSON.parse(text):{};}catch{}
    if(!r.ok){const e=new Error(data?.error||`Storage error (${r.status})`);e.status=r.status;throw e;}return data;
  }
  function addDays(dateIso,days){const d=new Date(`${dateIso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
  function localNow(timeZone='Europe/Oslo'){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    const g=t=>parts.find(p=>p.type===t)?.value;return{date:`${g('year')}-${g('month')}-${g('day')}`,minutes:Number(g('hour'))*60+Number(g('minute'))};
  }
  function timeMin(t='00:00'){const[h,m]=t.split(':').map(Number);return(h||0)*60+(m||0);}
  function buildState(team,playersDoc,schedule,responseMap,guestMap){
    const players=playersDoc.players||[],responses=[];
    for(const[k,response]of Object.entries(responseMap||{})){const i=k.indexOf('__');if(i<0)continue;responses.push({session_id:k.slice(0,i),player_id:k.slice(i+2),response});}
    const guests=guestMap||{},state={team,players,weeks:schedule.weeks||[],sessions:(schedule.sessions||[]).map(x=>({...x})),responses,guests};
    const active=players.filter(p=>p.active!==false),now=localNow(team.timezone||'Europe/Oslo');
    const counts=s=>{let coming=0,no=0;for(const p of active){const r=responses.find(x=>x.session_id===s.id&&x.player_id===p.id)?.response||'pending';if(r==='coming')coming++;else if(r==='not_coming')no++;}const g=Math.max(0,Number(guests[s.id]||0));return{coming:coming+g,no,pending:active.length-coming-no,total:active.length};};
    const candidate=s=>{const c=counts(s),min=Number(team.min_players||4),dayBefore=addDays(s.session_date,-1),cut=now.date>dayBefore||(now.date===dayBefore&&now.minutes>=timeMin(team.cutoff_time||'21:00'));if(c.coming>=min)return'confirmed';if(c.total>0&&c.pending===0)return'cancelled';if(cut)return'cancelled';return'waiting';};
    for(const w of state.weeks){const th=state.sessions.find(s=>s.week_id===w.id&&s.kind==='thursday'),fr=state.sessions.find(s=>s.week_id===w.id&&s.kind==='friday');if(!th||!fr)continue;th.status=candidate(th);const fb=candidate(fr);fr.status=th.status==='confirmed'?'not_needed':th.status==='cancelled'?fb:fb==='confirmed'?'backup_ready':fb;}
    return state;
  }
  function responseKey(sessionId,playerId){return`${sessionId}__${playerId}`;}
  async function rpc(name,args={}){
    const token=args.p_token;
    try{
      if(name==='get_team_state'){
        const[team,players,schedule,responses,guests]=await Promise.all([request(token,'team'),request(token,'players'),request(token,'schedule'),request(token,'responses'),optionalRequest(token,'guests')]);
        return{data:buildState(team,players,schedule,responses,guests),error:null};
      }
      if(name==='set_response'){
        const k=responseKey(args.p_session_id,args.p_player_id);await request(token,'responses',{method:'PATCH',body:{[k]:args.p_response==='pending'?null:args.p_response}});return{data:true,error:null};
      }
      if(name==='increment_guest_count'){
        const by=Number(args.p_by||0);if(!Number.isFinite(by)||Math.abs(by)>1)throw new Error('Invalid guest change.');
        let result=await increment(token,'guests',String(args.p_session_id),by);let count=Number(result?.[args.p_session_id]??0);
        if(count<0){result=await increment(token,'guests',String(args.p_session_id),-count);count=Number(result?.[args.p_session_id]??0);}
        return{data:{count:Math.max(0,count)},error:null};
      }
      if(name==='save_push_subscription'){
        const id=localStorage.getItem('wb-push-device')||(crypto.randomUUID?crypto.randomUUID():String(Date.now()));localStorage.setItem('wb-push-device',id);
        await request(token,'subscriptions',{method:'PATCH',body:{devices:{[id]:args.p_subscription}}});return{data:true,error:null};
      }
      throw new Error(`Unsupported operation: ${name}`);
    }catch(e){return{data:null,error:e instanceof Error?e:new Error(String(e))};}
  }
  window.supabase={createClient(){return{rpc};}};
  window.fetch=(input,init)=>{if(String(input).startsWith('https://westfold.local/functions/v1/push-dispatch'))return Promise.resolve(new Response('{}',{status:202,headers:{'Content-Type':'application/json'}}));return nativeFetch(input,init);};
})();
