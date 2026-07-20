/* ============================================================
   Lennar Vendor Assignments Portal — v2
   Features: Supabase auth, role tiers, date-range filter,
   global search, coverage gaps, change tracking, print/PDF,
   last-updated banner, mobile-responsive.
   ============================================================ */
const CFG = window.APP_CONFIG;
const DEMO = !CFG.SUPABASE_URL || CFG.SUPABASE_URL.startsWith("YOUR_");
let sb = null;
if (!DEMO && window.supabase) sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "lennar-vendor-portal-auth" }
});

const state = { email:null, role:"viewer", roleDivs:[], divKey:null, data:null,
                view:"community", cache:{}, range:{...CFG.DEFAULT_RANGE}, coreFrac:0.5 };
const $  = id => document.getElementById(id);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => (n==null||isNaN(n))?"—":Number(n).toLocaleString();
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
(function(){ try{ const t=localStorage.getItem("vp_theme"); if(t) document.documentElement.setAttribute("data-theme",t);
  else if(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.setAttribute("data-theme","dark"); }catch(e){} })();
function toggleTheme(){ const isDark=document.documentElement.getAttribute("data-theme")==="dark"; const next=isDark?"light":"dark";
  document.documentElement.setAttribute("data-theme",next); try{localStorage.setItem("vp_theme",next);}catch(e){}
  const b=$("themeBtn"); if(b) b.textContent=next==="dark"?"Light":"Dark"; }

/* ---------------- ROLES ---------------- */
function resolveRole(email){
  const e = (email||"").toLowerCase();
  const r = CFG.ROLES[e];
  if (!r) return { role: CFG.DEFAULT_ROLE, divisions: [] };
  return { role: r.role || CFG.DEFAULT_ROLE, divisions: r.divisions || [] };
}
const isAdmin  = () => state.role === "admin";
const canEdit  = k => state.role==="admin" || (state.role==="editor" && state.roleDivs.includes(k));
const canUploadAny = () => state.role==="admin" || state.role==="editor";

/* ---------------- AUTH ---------------- */
function authMsg(t,k){ const m=$("authMsg"); m.className="msg "+(k||"info"); m.textContent=t; }
function clearAuth(){ const m=$("authMsg"); m.className="msg"; m.textContent=""; }
function prettyErr(e, fallback){
  console.error("Auth error:", e);
  let msg = (e && (e.message || e.error_description || e.msg)) || "";
  if (!msg || msg === "{}" || msg === "[object Object]") {
    return fallback + " Supabase couldn't send the email — finish the SMTP + email-template setup (SETUP.md Part C), confirm your Brevo sender is verified, and that new sign-ups are enabled. Check Supabase > Authentication > Logs for the exact reason.";
  }
  if (/not authorized|sending|smtp|confirmation email/i.test(msg))
    msg += " (Check the SMTP settings + verified sender in Supabase.)";
  return msg;
}
if (DEMO) $("demoPill").classList.remove("hidden");

$("sendBtn").addEventListener("click", sendCode);
$("email").addEventListener("keydown", e=>{ if(e.key==="Enter") sendCode(); });
$("verifyBtn").addEventListener("click", verifyCode);
$("code").addEventListener("keydown", e=>{ if(e.key==="Enter") verifyCode(); });
$("backBtn").addEventListener("click", ()=>{ $("stepCode").classList.add("hidden"); $("stepEmail").classList.remove("hidden"); clearAuth(); });

// ---- anti-abuse: throttle login-code requests per browser ----
function otpHistory(){ try{ return JSON.parse(localStorage.getItem("vp_otp_sends")||"[]"); }catch(e){ return []; } }
function otpRecord(){ const h=otpHistory(); h.push(Date.now()); try{ localStorage.setItem("vp_otp_sends",JSON.stringify(h.slice(-50))); }catch(e){} }
function otpGate(){
  const L=CFG.OTP_LIMITS||{cooldownSec:45,perHour:5,perDay:15};
  const now=Date.now(), h=otpHistory(), last=h[h.length-1];
  if(last && now-last < L.cooldownSec*1000) return {ok:false,msg:`Please wait ${Math.ceil((L.cooldownSec*1000-(now-last))/1000)}s before requesting another code.`};
  if(h.filter(t=>now-t<3600000).length >= L.perHour) return {ok:false,msg:"Too many code requests this hour — please try again later."};
  if(h.filter(t=>now-t<86400000).length >= L.perDay) return {ok:false,msg:"Daily code-request limit reached — please try again tomorrow."};
  return {ok:true};
}
function startCooldown(){
  const L=CFG.OTP_LIMITS||{}; let s=L.cooldownSec||45; const btn=$("sendBtn");
  btn.disabled=true; btn.textContent=`Resend in ${s}s`;
  clearInterval(window._cdT); window._cdT=setInterval(()=>{ s--;
    if(s<=0){ clearInterval(window._cdT); btn.disabled=false; btn.textContent="Send verification code"; }
    else btn.textContent=`Resend in ${s}s`; },1000);
}
async function sendCode(){
  const email = $("email").value.trim().toLowerCase();
  clearAuth();
  if (!email || !email.includes("@")) return authMsg("Please enter your email address.","err");
  if (!email.endsWith(CFG.ALLOWED_DOMAIN)) return authMsg("Access is limited to "+CFG.ALLOWED_DOMAIN+" email addresses.","err");
  const gate=otpGate(); if(!gate.ok) return authMsg(gate.msg,"err");
  $("sendBtn").disabled=true; $("sendBtn").textContent="Sending…";
  try {
    if (DEMO){ await new Promise(r=>setTimeout(r,400)); authMsg("Demo mode: enter code "+CFG.DEMO_CODE+" to continue.","info"); }
    else { const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true}}); if(error) throw error;
           authMsg("Code sent. Check your inbox (and spam).","ok"); }
    otpRecord();
    state.email=email; $("sentTo").textContent=email;
    $("stepEmail").classList.add("hidden"); $("stepCode").classList.remove("hidden"); $("code").focus();
    startCooldown();
  } catch(e){ authMsg(prettyErr(e,"Could not send the code."),"err"); $("sendBtn").disabled=false; $("sendBtn").textContent="Send verification code"; }
}
async function verifyCode(){
  const code=$("code").value.trim(); clearAuth();
  if (!/^\d{4,10}$/.test(code)) return authMsg("Enter the numeric code from the email.","err");
  $("verifyBtn").disabled=true; $("verifyBtn").textContent="Verifying…";
  try {
    if (DEMO){ await new Promise(r=>setTimeout(r,300)); if(code!==CFG.DEMO_CODE) throw new Error("Incorrect code. (Demo code is "+CFG.DEMO_CODE+".)"); }
    else { const {error}=await sb.auth.verifyOtp({email:state.email,token:code,type:"email"}); if(error) throw error; }
    enterApp(state.email);
  } catch(e){ authMsg(prettyErr(e,"Verification failed."),"err"); }
  finally { $("verifyBtn").disabled=false; $("verifyBtn").textContent="Verify & sign in"; }
}
async function checkExistingSession(){
  if (DEMO||!sb) return;
  const {data}=await sb.auth.getSession();
  if (data&&data.session&&data.session.user) enterApp(data.session.user.email);
  sb.auth.onAuthStateChange((_e, session)=>{ if (session&&session.user) enterApp(session.user.email); });
}
async function logout(){ if(!DEMO&&sb) await sb.auth.signOut(); location.reload(); }

/* ---------------- APP INIT ---------------- */
let entered=false;
async function enterApp(email){
  if (entered) return; entered=true;
  state.email=email.toLowerCase();
  const r=resolveRole(state.email); state.role=r.role; state.roleDivs=r.divisions;
  if(!DEMO && sb){ try{ const {data}=await sb.from("app_roles").select("role,divisions").eq("email",state.email).maybeSingle(); if(data){ state.role=data.role||state.role; state.roleDivs=data.divisions||state.roleDivs; } }catch(e){} }
  $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
  $("userChip").innerHTML = esc(state.email)+` <span class="role-tag">${esc(state.role)}</span>`;
  if (DEMO) $("appDemoPill").classList.remove("hidden");
  if (canUploadAny()) $("adminLink").classList.remove("hidden");

  const prefs=loadPrefs();
  if(prefs.from && prefs.to && prefs.from<=prefs.to) state.range={from:prefs.from,to:prefs.to};
  if(prefs.view) state.view=prefs.view;

  await loadDivisionsFromDB();
  const sel=$("divisionSel");
  sel.innerHTML=CFG.DIVISIONS.map(d=>`<option value="${d.key}">${esc(d.label)}</option>`).join("");
  sel.addEventListener("change",()=>loadDivision(sel.value));

  // date range
  $("fromDate").value=state.range.from; $("toDate").value=state.range.to;
  ["change","input"].forEach(ev=>{ $("fromDate").addEventListener(ev,onRange); $("toDate").addEventListener(ev,onRange); });
  $("rangeReset").addEventListener("click",()=>{ state.range={...CFG.DEFAULT_RANGE};
    $("fromDate").value=state.range.from; $("toDate").value=state.range.to; savePrefs(); renderAll(); });

  // tabs
  document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active"); state.view=t.dataset.view; savePrefs(); renderView(); }));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.view===state.view));

  $("logoutBtn").addEventListener("click",logout);
  $("adminLink").addEventListener("click",showAdmin);
  $("dashLink").addEventListener("click",showDashboard);
  $("printBtn").addEventListener("click",()=>window.print());
  $("themeBtn").addEventListener("click",toggleTheme); $("themeBtn").textContent=document.documentElement.getAttribute("data-theme")==="dark"?"Light":"Dark";
  $("homeLogo").addEventListener("click",()=>{ showDashboard(); activateTab("community"); state.view="community"; renderView(); });
  setupGlobalSearch();
  $("viewArea").addEventListener("click",e=>{ const el=e.target.closest("[data-vendor]"); if(el){ e.preventDefault(); openVendor(el.getAttribute("data-vendor")); } });
  initAdmin();
  const startKey=(prefs.divKey && CFG.DIVISIONS.some(d=>d.key===prefs.divKey)) ? prefs.divKey : CFG.DIVISIONS[0].key;
  sel.value=startKey;
  await loadDivision(startKey);
}
function onRange(){
  const f=$("fromDate").value, t=$("toDate").value;
  if (f&&t&&f<=t){ state.range={from:f,to:t}; savePrefs(); renderAll(); }
}

async function loadDivision(key){
  state.divKey=key; savePrefs();
  $("viewArea").innerHTML=`<div class="empty">Loading…</div>`;
  try {
    if (state.cache[key]){ state.data=state.cache[key]; }
    else {
      let data;
      if (DEMO){ const res=await fetch(`data/${key}.json`); if(!res.ok) throw new Error("Data file not found"); data=await res.json(); }
      else { const {data:row,error}=await sb.from("division_data").select("payload,updated_at,updated_by").eq("key",key).single();
             if(error) throw error; data=row.payload; data._updated=row.updated_at; data._by=row.updated_by; }
      state.cache[key]=data; state.data=data;
    }
    await loadChanges(key);
    renderAll();
  } catch(e){ $("viewArea").innerHTML=`<div class="empty">Could not load ${esc(key)}: ${esc(e.message)}</div>`; }
}

function renderAll(){ renderBanner(); renderKPIs(); renderView(); }

/* ---------------- DERIVED: starts within range ---------------- */
function monthsInRange(){
  const [fy,fm]=state.range.from.split("-").map(Number);
  const [ty,tm]=state.range.to.split("-").map(Number);
  const out=[]; let y=fy,m=fm;
  while (y<ty || (y===ty&&m<=tm)){ out.push({y,m,key:`${y}-${String(m).padStart(2,"0")}`,
      label:MON[m-1]+(fy!==ty?" '"+String(y).slice(2):"")}); m++; if(m>12){m=1;y++;} if(out.length>240) break; }
  return out;
}
function startsAgg(){
  const recs=state.data.startRecords||[];
  const from=state.range.from, to=state.range.to;
  const months=monthsInRange();
  const idx={}; months.forEach((mo,i)=>idx[mo.key]=i);
  const byComm={};
  let total=0;
  for (const r of recs){
    if (r.date<from || r.date>to) continue;
    const mk=r.date.slice(0,7);
    if (!(mk in idx)) continue;
    if (!byComm[r.community]) byComm[r.community]=new Array(months.length).fill(0);
    byComm[r.community][idx[mk]]++; total++;
  }
  const rows=Object.keys(byComm).sort().map(c=>({community:c,values:byComm[c],
      total:byComm[c].reduce((a,b)=>a+b,0)}));
  return {months,rows,total};
}

/* ---------------- BANNER ---------------- */
function renderBanner(){
  const d=state.data;
  const when = d._updated ? new Date(d._updated).toLocaleString() : "not yet published";
  const by = d._by ? " by "+esc(d._by) : "";
  const unread = changesUnread();
  $("banner").innerHTML = `<b>${esc(d.division)}</b> — last updated: ${esc(when)}${by}`
    + ` <button class="linkbtn changesBtn${unread?' has-changes':''}" id="changesBtn">View changes${unread?'<span class="notif-dot" aria-label="major change"></span>':''}</button>`;
  const b=$("changesBtn"); if(b) b.addEventListener("click",openChanges);
}
function loadPrefs(){ try{ return JSON.parse(localStorage.getItem("vp_prefs")||"{}"); }catch(e){ return {}; } }
function savePrefs(){ try{ localStorage.setItem("vp_prefs",JSON.stringify({divKey:state.divKey,from:state.range.from,to:state.range.to,view:state.view})); }catch(e){} }
async function loadChanges(key){
  state.changes=[];
  if(DEMO||!sb) return;
  try{ const {data}=await sb.from("change_log").select("id,key,actor,summary,created_at").order("created_at",{ascending:false}).limit(200); state.changes=data||[]; }catch(e){ state.changes=[]; }
}
function latestMajorChange(){ return (state.changes||[]).find(x=>x.key===state.divKey && x.summary && ((x.summary.commsAdded||0)>0||(x.summary.commsRemoved||0)>0))||null; }
function changesUnread(){ const c=latestMajorChange(); if(!c) return false; try{ return String(localStorage.getItem("vp_seen_change_"+state.divKey))!==String(c.id); }catch(e){ return true; } }
function openChanges(){
  const c=latestMajorChange(); if(c){ try{ localStorage.setItem("vp_seen_change_"+state.divKey,String(c.id)); }catch(e){} }
  const all=state.changes||[]; const num=v=>fmt(v||0);
  const divLabel=k=>(CFG.DIVISIONS.find(d=>d.key===k)||{}).label||k;
  const chips=(arr,cls)=> (Array.isArray(arr)&&arr.length)? arr.map(x=>`<span class="chip ${cls}">${esc(x)}</span>`).join("") : "";
  const pairs=(arr,cls)=> (Array.isArray(arr)&&arr.length)? `<ul class="chg-list">${arr.map(p=>{const i=String(p).indexOf("|"); const vn=i>=0?p.slice(0,i):p, cn=i>=0?p.slice(i+1):""; return `<li><span class="${cls}">${esc(vn)}</span>${cn?` <span class="chg-arrow">to</span> ${esc(cn)}`:""}</li>`;}).join("")}</ul>` : "";
  const more=(total,list)=> (Array.isArray(list)&&total>list.length)? `<div class="cat-tag">+${num(total-list.length)} more</div>` : "";
  const card=(r,i)=>{ const s=r.summary||{};
      const cA=s.commsAdded||0, cR=s.commsRemoved||0;
      const aA=(s.assignmentsAdded!=null)?s.assignmentsAdded:null, aR=(s.assignmentsRemoved!=null)?s.assignmentsRemoved:null;
      const major=cA>0||cR>0;
      const assignTag=(aA!=null||aR!=null)? `assign +${num(aA||0)}/-${num(aR||0)}` : `assign net ${(s.assignDelta>=0?"+":"")+num(s.assignDelta||0)}`;
      const detail=
        (cA?`<div class="chg-sec"><div class="chg-sec-h">Communities added (${num(cA)})</div>${chips(s.commsAddedList,"good-chip")||'<span class="tiny">names not recorded</span>'}${more(cA,s.commsAddedList)}</div>`:"")
       +(cR?`<div class="chg-sec"><div class="chg-sec-h">Communities removed (${num(cR)})</div>${chips(s.commsRemovedList,"bad-chip")||'<span class="tiny">names not recorded</span>'}${more(cR,s.commsRemovedList)}</div>`:"")
       +((aA||0)?`<div class="chg-sec"><div class="chg-sec-h">Trade assignments added (${num(aA)})</div>${pairs(s.assignAddedList,"add-v")||'<span class="tiny">details not recorded for this update</span>'}${more(aA,s.assignAddedList)}</div>`:"")
       +((aR||0)?`<div class="chg-sec"><div class="chg-sec-h">Trade assignments removed (${num(aR)})</div>${pairs(s.assignRemovedList,"rem-v")||'<span class="tiny">details not recorded for this update</span>'}${more(aR,s.assignRemovedList)}</div>`:"")
       +((!cA&&!cR&&!(aA||0)&&!(aR||0))?`<div class="tiny">No structural changes recorded for this update.</div>`:"");
      return `<div class="chg${major?' chg-major':''}">
        <button class="chg-toggle" data-i="${i}" aria-expanded="false">
          <span class="chg-div">${esc(divLabel(r.key))}</span>
          <span class="chg-when"><span class="chg-date">${new Date(r.created_at).toLocaleString()}</span><span class="chg-by">${esc(r.actor||"")}</span></span>
          <span class="chg-tags">${(cA||cR)?`<span class="chip warn-chip">comm +${num(cA)}/-${num(cR)}</span>`:""}<span class="chip">${assignTag}</span></span>
          <span class="chg-chev">&#9656;</span>
        </button>
        <div class="chg-detail hidden" id="chgd-${i}">${detail}</div>
      </div>`; };
  const listHtml=list=> list.length? list.map((r,i)=>card(r,i)).join("") : `<div class="empty">No updates for this division.</div>`;
  const filterOpts=`<option value="">All divisions</option>${CFG.DIVISIONS.map(d=>`<option value="${d.key}">${esc(d.label)}</option>`).join("")}`;
  const shell = all.length
    ? `<div class="chg-filter"><label for="chgFilter">Division</label><select id="chgFilter">${filterOpts}</select><span class="count" id="chgCount"></span></div><div id="chgList"></div>`
    : `<div class="empty">No updates recorded yet${DEMO?" (demo mode - change history needs the backend)":""}.</div>`;
  showModal("Change history &middot; newest first", shell);
  const wire=()=>{ document.querySelectorAll("#vpModal .chg-toggle").forEach(btn=>btn.addEventListener("click",()=>{
    const dd=$("chgd-"+btn.dataset.i); const isOpen=!dd.classList.contains("hidden");
    dd.classList.toggle("hidden"); btn.classList.toggle("open"); btn.setAttribute("aria-expanded",String(!isOpen)); })); };
  const applyFilter=()=>{ const sel=$("chgFilter"); const k=sel?sel.value:""; const list=k? all.filter(r=>r.key===k):all;
    $("chgList").innerHTML=listHtml(list); if($("chgCount")) $("chgCount").textContent=list.length+" update"+(list.length===1?"":"s"); wire(); };
  if(all.length){ applyFilter(); const fs=$("chgFilter"); if(fs) fs.addEventListener("change",applyFilter); }
  renderBanner();
}
function showModal(title, html){
  closeModal();
  const ov=document.createElement("div"); ov.id="vpModal"; ov.className="modal-ov";
  ov.innerHTML=`<div class="modal-card"><div class="modal-h"><span>${title}</span><button class="linkbtn" id="modalX" aria-label="Close">&times;</button></div><div class="modal-body">${html}</div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click",e=>{ if(e.target===ov) closeModal(); });
  document.addEventListener("keydown",escClose);
  $("modalX").addEventListener("click",closeModal);
}
function escClose(e){ if(e.key==="Escape") closeModal(); }
function closeModal(){ const m=$("vpModal"); if(m) m.remove(); document.removeEventListener("keydown",escClose); }
function openVendor(name){
  if(!state.data) return;
  const rows=state.data.vendors.filter(v=>v.name===name);
  if(!rows.length) return;
  const sup=(rows.find(v=>v.supplierCode)||{}).supplierCode;
  const agg=startsAgg(); const byComm={}; agg.rows.forEach(r=>byComm[r.community]=r.total);
  const allC=new Set(); rows.forEach(v=>v.assigned.forEach(c=>allC.add(c)));
  const totalStarts=[...allC].reduce((s,c)=>s+(byComm[c]||0),0);
  const trades=rows.slice().sort((a,b)=>(a.category||"").localeCompare(b.category||""));
  const body=`<div class="vd-meta">${sup?`<span class="sup">#${esc(sup)}</span> &middot; `:""}${trades.length} trade${trades.length===1?"":"s"} &middot; ${allC.size} communities &middot; ${fmt(totalStarts)} starts in range (${state.range.from} to ${state.range.to})</div>`
    + trades.map(v=>{ const st=v.assigned.reduce((s,c)=>s+(byComm[c]||0),0);
        return `<div class="vd-trade"><div class="vd-trade-h">${esc(v.category||"—")} <span class="cat-tag">${v.assigned.length} communities &middot; ${fmt(st)} starts</span></div>`
          +`<div class="vd-comms">${v.assigned.slice().sort().map(c=>`<span class="chip">${esc(commLabel(c))}</span>`).join("")||'<span class="tiny">no communities in range</span>'}</div></div>`; }).join("");
  showModal(esc(name), body);
}

/* ---------------- KPIs ---------------- */
function activeCommunities(){ // communities that have >=1 vendor assignment
  const s=new Set(); state.data.vendors.forEach(v=>v.assigned.forEach(c=>s.add(c))); return s;
}
function renderKPIs(){
  const d=state.data;
  const active=rangeCommSet();
  const comms=d.communities.filter(c=>active.has(c.name));
  const vIn=d.vendors.filter(v=>v.assigned.some(c=>active.has(c)));
  const homesites=comms.reduce((s,c)=>s+(c.homesites||0),0);
  const agg=startsAgg();
  const kpis=[
    ["Communities", fmt(comms.length)],
    ["Trade Partners", fmt(new Set(vIn.map(v=>v.name)).size)],
    ["Trade Categories", fmt(new Set(vIn.map(v=>v.category).filter(Boolean)).size)],
    ["Starts in range", fmt(agg.total)],
  ];
  if (homesites>0) kpis.splice(3,0,["Total Homesites", fmt(homesites)]);
  $("kpis").innerHTML=kpis.map(([l,n])=>`<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
}

/* ---------------- VIEWS ---------------- */
function renderView(){
  ({community:viewByCommunity,vendor:viewByVendor,matrix:viewMatrix,
    coverage:viewCoverage,starts:viewStarts,history:viewHistory}[state.view]||viewByCommunity)();
}
const toolbar = inner => `<div class="toolbar">${inner}</div>`;
function commId(name){ const c=(state.data.communities||[]).find(x=>x.name===name); return c && c.id ? c.id : null; }
function shortId(id){ return id ? String(id).replace(/0000$/,"") : id; }
function commLabel(name){ const id=commId(name); return id ? name+" ("+shortId(id)+")" : name; }
function supTag(v){ return v && v.supplierCode ? ` <span class="sup">#${esc(v.supplierCode)}</span>` : ""; }
function rangeCommSet(){ const from=state.range.from, to=state.range.to, s=new Set();
  (state.data.startRecords||[]).forEach(r=>{ if(r.date>=from && r.date<=to) s.add(r.community); }); return s; }

/* --- By Community --- */
function viewByCommunity(){
  const d=state.data;
  const active=rangeCommSet();
  const comms=[...d.communities].filter(c=>active.has(c.name)).sort((a,b)=>a.name.localeCompare(b.name));
  if(!comms.length){ $("viewArea").innerHTML=`<div class="empty">No communities have starts in the selected date range — widen the range above.</div>`; return; }
  $("viewArea").innerHTML=`
    ${toolbar(`<select id="commPick">${comms.map(c=>`<option value="${esc(c.name)}">${esc(commLabel(c.name))}</option>`).join("")}</select>
      <input type="text" id="commSearch" placeholder="Filter vendors / trades…">
      <button class="btn mini ghost" id="commExport">Export CSV</button>
      <span class="count" id="commCount"></span>`)}
    <div class="panel"><div id="commBody"></div></div>`;
  const render=()=>{
    const comm=$("commPick").value, q=$("commSearch").value.trim().toLowerCase();
    let rows=d.vendors.filter(v=>v.assigned.includes(comm));
    if(q) rows=rows.filter(v=>(v.name+" "+(v.category||"")+" "+(v.tradeCode||"")).toLowerCase().includes(q));
    rows.sort((a,b)=>(a.category||"").localeCompare(b.category||"")||a.name.localeCompare(b.name));
    $("commCount").textContent=`${rows.length} vendors serving ${commLabel(comm)}`;
    $("commBody").innerHTML=rows.length?`<div class="table-wrap"><table>
      <thead><tr><th>Trade Category</th><th>Trade Partner</th><th>Trade Code</th></tr></thead>
      <tbody>${rows.map(v=>`<tr><td><span class="cat-tag">${esc(v.category||"—")}</span></td>
        <td><span class="vlink" data-vendor="${esc(v.name)}">${esc(v.name)}</span>${supTag(v)}</td><td>${esc(v.tradeCode||"—")}</td></tr>`).join("")}</tbody></table></div>`
      :`<div class="empty">No vendors match.</div>`;
    window._exp=()=>exportCSV(`${comm}_vendors`,["Category","Trade Partner","Supplier #","Trade Code"],rows.map(v=>[v.category,v.name,v.supplierCode,v.tradeCode]));
  };
  $("commPick").addEventListener("change",render); $("commSearch").addEventListener("input",render);
  $("commExport").addEventListener("click",()=>window._exp()); render();
}

/* --- By Vendor --- */
function viewByVendor(){
  const d=state.data; const active=rangeCommSet();
  const src=d.vendors.map(v=>({...v, assigned:v.assigned.filter(c=>active.has(c))})).filter(v=>v.assigned.length>0);
  src.sort((a,b)=>(a.category||"").localeCompare(b.category||"")||a.name.localeCompare(b.name));
  if(!src.length){ $("viewArea").innerHTML=`<div class="empty">No trade partners active in the selected date range.</div>`; return; }
  const agg=startsAgg(); const monthLabels=agg.months.map(m=>m.label);
  const byComm={}; agg.rows.forEach(r=>byComm[r.community]=r);
  const label=v=>((v.category||"—")+" — "+v.name+(v.supplierCode?"  #"+v.supplierCode:""));
  const allOpts=src.map((v,i)=>({i,text:label(v).toLowerCase()}));
  $("viewArea").innerHTML=`
    ${toolbar(`<input type="text" id="vSearch" placeholder="Filter trade partners…" style="max-width:260px">
      <select id="vPick" style="max-width:440px;flex:1"></select>
      <button class="btn mini ghost" id="vExport">Export CSV</button>`)}
    <div class="panel"><div class="panel-h" id="vTitle"></div><div class="table-wrap" id="vBody"></div></div>`;
  const fillSelect=()=>{
    const q=$("vSearch").value.trim().toLowerCase();
    const list=allOpts.filter(o=>!q||o.text.includes(q));
    $("vPick").innerHTML=(list.length?list:allOpts).map(o=>`<option value="${o.i}">${esc(label(src[o.i]))}</option>`).join("");
  };
  const render=()=>{
    const v=src[+$("vPick").value||0]; if(!v) return;
    const comms=[...v.assigned].sort();
    const monTotals=monthLabels.map((_,mi)=>comms.reduce((s,c)=>s+((byComm[c]&&byComm[c].values[mi])||0),0));
    const grand=monTotals.reduce((a,b)=>a+b,0);
    $("vTitle").textContent=`${label(v)}  —  ${comms.length} communities, ${grand} starts in range`;
    $("vBody").innerHTML=`<table><thead><tr><th class="sticky">Community</th><th>Comm</th>${monthLabels.map(m=>`<th class="num">${esc(m)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${comms.map(c=>{const row=byComm[c]||{values:monthLabels.map(()=>0),total:0};
        return `<tr><td class="sticky">${esc(c)}</td><td class="num">${esc(shortId(commId(c))||"")}</td>${row.values.map(x=>`<td class="num">${x||0}</td>`).join("")}<td class="num"><b>${row.total}</b></td></tr>`;}).join("")}
        <tr class="totalrow"><td class="sticky">TOTALS</td><td></td>${monTotals.map(x=>`<td class="num"><b>${x}</b></td>`).join("")}<td class="num"><b>${grand}</b></td></tr>
      </tbody></table>`;
    window._exp=()=>exportCSV(`${d.key}_${v.name}_starts`,["Community","Comm",...monthLabels,"Total"],
      comms.map(c=>{const row=byComm[c]||{values:[],total:0}; return [c,commId(c)||"",...monthLabels.map((_,mi)=>row.values[mi]||0),row.total||0];}));
  };
  $("vSearch").addEventListener("input",()=>{ fillSelect(); render(); });
  $("vPick").addEventListener("change",render);
  $("vExport").addEventListener("click",()=>window._exp());
  fillSelect(); render();
}

/* --- Full Matrix --- */
function viewMatrix(){
  const d=state.data; const active=rangeCommSet();
  const src=d.vendors.map(v=>({...v, assigned:v.assigned.filter(c=>active.has(c))})).filter(v=>v.assigned.length>0);
  const agg=startsAgg(); const byComm={}; agg.rows.forEach(r=>byComm[r.community]=r.total); const totalStarts=agg.total;
  const vStarts=v=>v.assigned.reduce((s,c)=>s+(byComm[c]||0),0);
  const vPct=v=>totalStarts?Math.round(vStarts(v)/totalStarts*1000)/10:0;
  const cats=[...new Set(src.map(v=>v.category).filter(Boolean))].sort();
  $("viewArea").innerHTML=`
    ${toolbar(`<input type="text" id="mSearch" placeholder="Search vendor…">
      <div class="msel" id="mCatMsel">
        <button type="button" class="msel-btn" id="mCatBtn">All categories</button>
        <div class="msel-panel hidden" id="mCatPanel">
          <div class="msel-actions"><button type="button" class="linkbtn" id="mCatAll">Select all</button><button type="button" class="linkbtn" id="mCatNone">Unselect all</button></div>
          <div class="msel-list">${cats.map(c=>`<label class="msel-opt"><input type="checkbox" value="${esc(c)}" checked>${esc(c)}</label>`).join("")}</div>
        </div>
      </div>
      <div class="msel" id="mCommMsel">
        <button type="button" class="msel-btn" id="mCommBtn">All communities</button>
        <div class="msel-panel hidden" id="mCommPanel">
          <div class="msel-actions"><button type="button" class="linkbtn" id="mCommAll">Select all</button><button type="button" class="linkbtn" id="mCommNone">Unselect all</button></div>
          <div class="msel-list">${[...d.communities].filter(c=>active.has(c.name)).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<label class="msel-opt"><input type="checkbox" value="${esc(c.name)}" checked>${esc(commLabel(c.name))}</label>`).join("")}</div>
        </div>
      </div>
      <button class="btn mini ghost" id="mExport">Export CSV</button><span class="count" id="mCount"></span>`)}
    <div class="panel"><div class="table-wrap" id="mBody"></div></div>`;
  const render=()=>{
    const q=$("mSearch").value.trim().toLowerCase();
    const boxes=[...$("mCatPanel").querySelectorAll("input[type=checkbox]")];
    const selCats=new Set(boxes.filter(b=>b.checked).map(b=>b.value)); const allSel=selCats.size===cats.length;
    $("mCatBtn").textContent=allSel?"All categories":(selCats.size===0?"No categories":selCats.size+" of "+cats.length+" trades");
    const cboxes=[...$("mCommPanel").querySelectorAll("input[type=checkbox]")];
    const selComm=new Set(cboxes.filter(b=>b.checked).map(b=>b.value)); const allComm=selComm.size===cboxes.length;
    $("mCommBtn").textContent=allComm?"All communities":(selComm.size===0?"No communities":selComm.size+" communities");
    let rows=src.slice();
    if(!allSel) rows=rows.filter(v=>selCats.has(v.category));
    if(q) rows=rows.filter(v=>v.name.toLowerCase().includes(q));
    if(!allComm) rows=rows.filter(v=>v.assigned.some(c=>selComm.has(c)));
    let comms=(allComm?[...d.communities].filter(c=>active.has(c.name)):[...d.communities].filter(c=>selComm.has(c.name))).sort((a,b)=>a.name.localeCompare(b.name));
    rows.sort((a,b)=>(a.category||"").localeCompare(b.category||"")||a.name.localeCompare(b.name));
    $("mCount").textContent=`${rows.length} vendors × ${comms.length} communities`;
    const cap=rows.slice(0,250);
    $("mBody").innerHTML=`<table class="matrix"><thead><tr><th class="sticky">Trade Partner</th>${comms.map(c=>`<th class="vhead" title="${esc(commLabel(c.name))}">${esc(c.name)}${c.id?"  ·  "+esc(shortId(c.id)):""}</th>`).join("")}</tr></thead>
      <tbody>${cap.map(v=>{const set=new Set(v.assigned); const sv=vStarts(v); const p=vPct(v);
        return `<tr><td class="sticky"><span class="vlink" data-vendor="${esc(v.name)}">${esc(v.name)}</span>${supTag(v)}<br><span class="cat-tag">${esc(v.category||"")}</span> <span class="starts-chip" title="Starts in this vendor's communities for the selected range">${fmt(sv)} starts · ${p}%</span></td>${comms.map(c=>`<td class="cell">${set.has(c.name)?'<span class="x-mark">✓</span>':''}</td>`).join("")}</tr>`;}).join("")}</tbody></table>
      ${rows.length>250?`<div class="empty">Showing first 250 of ${rows.length}. Narrow with filters.</div>`:""}`;
    window._expM=()=>exportCSV(`${d.key}_assignment_matrix`,
      ["Trade Partner","Supplier #","Trade Category","Starts (range)","% of starts",...comms.map(c=>commLabel(c.name))],
      rows.map(v=>{const set=new Set(v.assigned); return [v.name, v.supplierCode||"", v.category||"", vStarts(v), vPct(v), ...comms.map(c=>set.has(c.name)?"X":"")];}));
  };
  $("mSearch").addEventListener("input",render);
  $("mCatBtn").addEventListener("click",e=>{ e.stopPropagation(); $("mCatPanel").classList.toggle("hidden"); });
  $("mCatAll").addEventListener("click",()=>{ $("mCatPanel").querySelectorAll("input").forEach(b=>b.checked=true); render(); });
  $("mCatNone").addEventListener("click",()=>{ $("mCatPanel").querySelectorAll("input").forEach(b=>b.checked=false); render(); });
  $("mCatPanel").addEventListener("change",render);
  $("mCommBtn").addEventListener("click",e=>{ e.stopPropagation(); $("mCommPanel").classList.toggle("hidden"); });
  $("mCommAll").addEventListener("click",()=>{ $("mCommPanel").querySelectorAll("input").forEach(b=>b.checked=true); render(); });
  $("mCommNone").addEventListener("click",()=>{ $("mCommPanel").querySelectorAll("input").forEach(b=>b.checked=false); render(); });
  $("mCommPanel").addEventListener("change",render);
  if(!window._mselInit){ window._mselInit=true; document.addEventListener("click",ev=>{ document.querySelectorAll(".msel-panel:not(.hidden)").forEach(p=>{ const w=p.closest(".msel"); if(w&&!w.contains(ev.target)) p.classList.add("hidden"); }); }); }
  $("mExport").addEventListener("click",()=>window._expM()); render();
}

/* --- Coverage Gaps --- */
let coverageMode="trade";
function viewCoverage(){
  const CORE_FRAC=state.coreFrac;
  const d=state.data;
  const inR=rangeCommSet(); const assignSet=activeCommunities();
  const active=[...assignSet].filter(n=>inR.has(n)).sort();
  const total=active.length;
  const byCat={};
  d.vendors.forEach(v=>{ if(!v.category) return; (byCat[v.category]=byCat[v.category]||{vendors:new Set(),comms:new Set()});
    byCat[v.category].vendors.add(v.name); v.assigned.forEach(c=>byCat[v.category].comms.add(c)); });
  const cats=Object.keys(byCat).sort();
  const threshold=Math.max(1,Math.ceil(total*CORE_FRAC));
  const rowsAll=cats.map(cat=>{ const info=byCat[cat];
    const covered=active.filter(c=>info.comms.has(c)).length;
    const missing=active.filter(c=>!info.comms.has(c));
    const core=covered>=threshold;
    let risk;
    if(info.vendors.size===1) risk="single-source";
    else if(core && missing.length) risk="gaps";
    else if(!core && missing.length) risk="limited";
    else risk="ok";
    return {cat,vendors:info.vendors.size,covered,core,missing,risk}; });
  const coreCats=cats.filter(cat=>active.filter(c=>byCat[cat].comms.has(c)).length>=threshold);
  const singleSource=rowsAll.filter(r=>r.vendors===1).length;
  const withGaps=rowsAll.filter(r=>r.core && r.missing.length>0).length;
  const totalGaps=rowsAll.filter(r=>r.core).reduce((s,r)=>s+r.missing.length,0);
  $("viewArea").innerHTML=`
    <div class="kpis" style="margin-bottom:16px">
      <div class="kpi warn"><div class="n">${fmt(singleSource)}</div><div class="l">Single-source trades</div></div>
      <div class="kpi warn"><div class="n">${fmt(withGaps)}</div><div class="l">Core trades with gaps</div></div>
      <div class="kpi"><div class="n">${fmt(totalGaps)}</div><div class="l">Total gaps (core trades)</div></div>
      <div class="kpi"><div class="n">${fmt(total)}</div><div class="l">Active communities</div></div>
    </div>
    <div class="cov-controls">
      <div class="subtabs">
        <button class="subtab ${coverageMode==='trade'?'active':''}" data-cov="trade">By Trade</button>
        <button class="subtab ${coverageMode==='community'?'active':''}" data-cov="community">By Community</button>
      </div>
      <div class="core-ctrl">
        <label for="coreSlider">Core threshold</label>
        <input type="range" id="coreSlider" min="10" max="90" step="5" value="${Math.round(CORE_FRAC*100)}">
        <b id="coreVal">${Math.round(CORE_FRAC*100)}%</b>
        <span class="tiny" id="coreHint">= core trade in ≥ ${threshold} of ${total} active communities</span>
      </div>
    </div>
    <div id="covContent"></div>`;
  $("viewArea").querySelectorAll(".subtab").forEach(b=>b.addEventListener("click",()=>{ coverageMode=b.dataset.cov; viewCoverage(); }));
  const cs=$("coreSlider");
  cs.addEventListener("input",()=>{ const pct=+cs.value; $("coreVal").textContent=pct+"%";
    $("coreHint").textContent=`= core trade in ≥ ${Math.max(1,Math.ceil(total*pct/100))} of ${total} active communities`; });
  cs.addEventListener("change",()=>{ state.coreFrac=(+cs.value)/100; viewCoverage(); });
  if(coverageMode==="community") coverageByCommunity(d,active,coreCats,byCat);
  else coverageByTrade(d,rowsAll,total,byCat,active);
}

function coverageByTrade(d,rowsAll,total,byCat,active){
  $("covContent").innerHTML=`
    ${toolbar(`<input type="text" id="cgSearch" placeholder="Filter trade…">
      <select id="cgFilter"><option value="risk">All Risks</option><option value="all">All trades</option>
        <option value="single">Single-source only</option><option value="core">Core trades only</option></select>
      <button class="btn mini ghost" id="cgExport">Export CSV</button><span class="count" id="cgCount"></span>`)}
    <div id="cgBody"></div>`;
  const riskTag=r=> r.risk==="single-source"?'<span class="risk risk-s">Single-source</span>'
    : r.risk==="gaps"?'<span class="risk risk-g">Gaps</span>'
    : r.risk==="limited"?'<span class="risk risk-l">Limited</span>'
    : '<span class="risk risk-ok">OK</span>';
  const render=()=>{
    const q=$("cgSearch").value.trim().toLowerCase(), f=$("cgFilter").value;
    let rows=rowsAll.slice();
    if(f==="risk") rows=rows.filter(r=>r.risk==="single-source"||r.risk==="gaps");
    else if(f==="single") rows=rows.filter(r=>r.vendors===1);
    else if(f==="core") rows=rows.filter(r=>r.core);
    if(q) rows=rows.filter(r=>r.cat.toLowerCase().includes(q));
    rows.sort((a,b)=>(b.core-a.core)||b.missing.length-a.missing.length || a.cat.localeCompare(b.cat));
    $("cgCount").textContent=`${rows.length} trades`;
    $("cgBody").innerHTML=rows.length? rows.map((r,i)=>{
      const vendors=byCat[r.cat]?[...byCat[r.cat].vendors].sort():[];
      const covered=byCat[r.cat]?active.filter(c=>byCat[r.cat].comms.has(c)):[];
      return `<div class="acc">
        <button class="acc-head" data-i="${i}">
          <span class="acc-title">${esc(r.cat)}${r.core?' <span class="cat-tag">core</span>':''}</span>
          <span class="acc-meta">${r.vendors} vendor${r.vendors===1?'':'s'} &middot; ${r.covered}/${total} covered</span>
          ${riskTag(r)}
          <span class="acc-count ${r.missing.length?'has-gaps':'no-gaps'}">${r.missing.length} missing</span>
        </button>
        <div class="acc-body hidden" id="cgd-${i}">
          <div class="chg-sec"><div class="chg-sec-h">Trade partners (${vendors.length})</div>${vendors.map(v=>`<span class="chip">${esc(v)}</span>`).join("")||'<span class="tiny">no vendors</span>'}</div>
          <div class="chg-sec"><div class="chg-sec-h">Missing communities (${r.missing.length})</div>${r.missing.length? r.missing.map(c=>`<span class="chip warn-chip">${esc(commLabel(c))}</span>`).join("") : '<span class="cat-tag">full coverage</span>'}</div>
          <div class="chg-sec"><div class="chg-sec-h">Covered communities (${covered.length})</div>${covered.length? covered.map(c=>`<span class="chip">${esc(commLabel(c))}</span>`).join("") : '<span class="tiny">none</span>'}</div>
        </div>
      </div>`; }).join("") : `<div class="empty">No trades match.</div>`;
    $("cgBody").querySelectorAll(".acc-head").forEach(b=>b.addEventListener("click",()=>{ $("cgd-"+b.dataset.i).classList.toggle("hidden"); b.classList.toggle("open"); }));
    window._exp=()=>exportCSV(`${d.key}_coverage_by_trade`,["Trade","Core","Vendors","Trade partners","Covered","Total","Status","Missing communities"],
      rows.map(r=>{const vs=byCat[r.cat]?[...byCat[r.cat].vendors].sort():[]; return [r.cat,r.core?"yes":"no",r.vendors,vs.join("; "),r.covered,total,r.risk,r.missing.join("; ")];}));
  };
  $("cgSearch").addEventListener("input",render); $("cgFilter").addEventListener("change",render);
  $("cgExport").addEventListener("click",()=>window._exp()); render();
}

function coverageByCommunity(d,active,coreCats,byCat){
  const commRows=active.map(c=>{ const missing=coreCats.filter(cat=>!byCat[cat].comms.has(c));
    return {community:c, gaps:missing.length, missing}; });
  $("covContent").innerHTML=`
    ${toolbar(`<input type="text" id="ccSearch" placeholder="Filter community…">
      <select id="ccFilter"><option value="gaps">With gaps only</option><option value="all">All communities</option></select>
      <button class="btn mini ghost" id="ccExport">Export CSV</button><span class="count" id="ccCount"></span>`)}
    <div id="ccBody"></div>`;
  const render=()=>{
    const q=$("ccSearch").value.trim().toLowerCase(), f=$("ccFilter").value;
    let rows=commRows.slice();
    if(f!=="all") rows=rows.filter(r=>r.gaps>0);
    if(q) rows=rows.filter(r=>r.community.toLowerCase().includes(q));
    if(f==="all") rows.sort((a,b)=>a.community.localeCompare(b.community));
    else rows.sort((a,b)=>b.gaps-a.gaps || a.community.localeCompare(b.community));
    $("ccCount").textContent=`${rows.length} communities`;
    $("ccBody").innerHTML=rows.length?rows.map((r,i)=>`
      <div class="acc">
        <button class="acc-head" data-i="${i}">
          <span class="acc-title">${esc(commLabel(r.community))}</span>
          <span class="acc-count ${r.gaps?'has-gaps':'no-gaps'}">${r.gaps} gap${r.gaps===1?'':'s'} found</span>
        </button>
        <div class="acc-body hidden" id="acc-${i}">${r.gaps? r.missing.map(m=>`<span class="chip warn-chip">${esc(m)}</span>`).join("") : '<span class="cat-tag">All core trades covered</span>'}</div>
      </div>`).join(""):`<div class="empty">No communities in the selected range.</div>`;
    $("ccBody").querySelectorAll(".acc-head").forEach(b=>b.addEventListener("click",()=>{
      $("acc-"+b.dataset.i).classList.toggle("hidden"); b.classList.toggle("open"); }));
    window._exp=()=>exportCSV(`${d.key}_coverage_by_community`,["Community","Gaps found","Missing core trades"],
      rows.map(r=>[r.community,r.gaps,r.missing.join("; ")]));
  };
  $("ccSearch").addEventListener("input",render); $("ccFilter").addEventListener("change",render);
  $("ccExport").addEventListener("click",()=>window._exp()); render();
}

/* --- Starts (date-range aware) --- */
let charts=[];
function destroyCharts(){ charts.forEach(c=>{try{c.destroy()}catch(e){}}); charts=[]; }
function viewStarts(){
  destroyCharts();
  const d=state.data; const agg=startsAgg();
  const monthLabels=agg.months.map(m=>m.label);
  const totalsByMonth=agg.months.map((_,i)=>agg.rows.reduce((s,r)=>s+r.values[i],0));
  const topComm=[...agg.rows].sort((a,b)=>b.total-a.total).slice(0,12);
  $("viewArea").innerHTML=`
    <div class="panel" style="margin-bottom:16px"><div class="panel-h">Starts per month — ${esc(d.division)} <span class="range-note">${state.range.from} → ${state.range.to}</span></div>
      <div class="chart-box"><div class="chart-h"><canvas id="chMonth"></canvas></div></div></div>
    <div class="panel" style="margin-bottom:16px"><div class="panel-h">Top communities by starts (in range)</div>
      <div class="chart-box"><div class="chart-h chart-h-tall"><canvas id="chComm"></canvas></div></div></div>
    ${toolbar(`<input type="text" id="sSearch" placeholder="Filter community…"><button class="btn mini ghost" id="sExport">Export CSV</button><span class="count" id="sCount"></span>`)}
    <div class="panel"><div class="table-wrap" id="sBody"></div></div>`;
  if (window.Chart){
    charts.push(new Chart($("chMonth"),{type:"bar",data:{labels:monthLabels,datasets:[{label:"Starts",data:totalsByMonth,backgroundColor:"#0057b8"}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}}));
    charts.push(new Chart($("chComm"),{type:"bar",data:{labels:topComm.map(c=>c.community),datasets:[{label:"Starts",data:topComm.map(c=>c.total),backgroundColor:"#0a2540"}]},options:{responsive:true,maintainAspectRatio:false,animation:false,indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{beginAtZero:true}}}}));
  }
  const render=()=>{
    const q=$("sSearch").value.trim().toLowerCase();
    let rows=agg.rows.filter(r=>!q||r.community.toLowerCase().includes(q));
    $("sCount").textContent=`${rows.length} communities • ${agg.total} starts`;
    $("sBody").innerHTML=rows.length?`<table><thead><tr><th class="sticky">Community</th>${monthLabels.map(m=>`<th class="num">${esc(m)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td class="sticky">${esc(commLabel(r.community))}</td>${r.values.map(v=>`<td class="num">${v||0}</td>`).join("")}<td class="num"><b>${r.total}</b></td></tr>`).join("")}</tbody></table>`
      :`<div class="empty">No starts in this date range.</div>`;
    window._exp=()=>exportCSV(`${d.key}_starts`,["Community",...monthLabels,"Total"],rows.map(r=>[r.community,...r.values,r.total]));
  };
  $("sSearch").addEventListener("input",render); $("sExport").addEventListener("click",()=>window._exp()); render();
}

/* --- History (admin) --- */
async function viewHistory(){
  $("viewArea").innerHTML=`<div class="panel"><div class="panel-h">Upload / Change History</div><div id="histBody" style="padding:18px"></div></div>`;
  const body=$("histBody");
  if (DEMO){ body.innerHTML=`<div class="empty">Change history is recorded once the Supabase backend is connected.<br>Each admin upload logs a diff (added/removed vendors, communities, assignment changes).</div>`; return; }
  try {
    const {data,error}=await sb.from("change_log").select("*").eq("key",state.divKey).order("created_at",{ascending:false}).limit(50);
    if(error) throw error;
    body.innerHTML=data.length?`<div class="table-wrap"><table><thead><tr><th>When</th><th>By</th><th>Vendors</th><th>Communities</th><th>Assignments Δ</th><th>Summary</th></tr></thead>
      <tbody>${data.map(r=>{const s=r.summary||{};return `<tr><td>${new Date(r.created_at).toLocaleString()}</td><td>${esc(r.actor||"")}</td>
        <td class="num">${fmt(s.vendors)}</td><td class="num">${fmt(s.communities)}</td>
        <td class="num">${(s.assignDelta>0?"+":"")+fmt(s.assignDelta)}</td>
        <td>+${fmt(s.vendorsAdded)}/−${fmt(s.vendorsRemoved)} vendors, +${fmt(s.commsAdded)}/−${fmt(s.commsRemoved)} comms</td></tr>`;}).join("")}</tbody></table></div>`
      :`<div class="empty">No uploads recorded yet for ${esc(state.divKey)}.</div>`;
  } catch(e){ body.innerHTML=`<div class="empty">Could not load history: ${esc(e.message)}</div>`; }
}

/* ---------------- GLOBAL SEARCH ---------------- */
function setupGlobalSearch(){
  const box=$("globalSearch"), panel=$("gsResults");
  const run=()=>{
    const q=box.value.trim().toLowerCase();
    if(!q||!state.data){ panel.classList.add("hidden"); panel.innerHTML=""; return; }
    const d=state.data;
    const vend=[...new Map(d.vendors.filter(v=>v.name.toLowerCase().includes(q)).map(v=>[v.name,v])).values()].slice(0,6);
    const inR=rangeCommSet();
    const comm=d.communities.filter(c=>inR.has(c.name) && c.name.toLowerCase().includes(q)).slice(0,6);
    const cats=d.categories.filter(c=>c.toLowerCase().includes(q)).slice(0,6);
    const sect=(title,items)=>items.length?`<div class="gs-sect">${title}</div>`+items:"";
    let html="";
    html+=sect("Trade Partners", vend.map(v=>`<div class="gs-item" data-t="vendor" data-v="${esc(v.name)}">${esc(v.name)}${supTag(v)} <span class="cat-tag">${esc(v.category||"")}</span></div>`));
    html+=sect("Communities", comm.map(c=>`<div class="gs-item" data-t="community" data-v="${esc(c.name)}">${esc(c.name)}</div>`));
    html+=sect("Trades", cats.map(c=>`<div class="gs-item" data-t="category" data-v="${esc(c)}">${esc(c)}</div>`));
    panel.innerHTML=html||`<div class="gs-sect">No matches</div>`;
    panel.classList.remove("hidden");
    panel.querySelectorAll(".gs-item").forEach(el=>el.addEventListener("click",()=>{
      panel.classList.add("hidden"); box.value="";
      if(el.dataset.t==="vendor") openVendor(el.dataset.v); else jumpTo(el.dataset.t, el.dataset.v); }));
  };
  box.addEventListener("input",run);
  box.addEventListener("focus",run);
  document.addEventListener("click",e=>{ if(!panel.contains(e.target)&&e.target!==box) panel.classList.add("hidden"); });
}
function activateTab(view){ document.querySelectorAll(".tab").forEach(t=>{t.classList.toggle("active",t.dataset.view===view);}); state.view=view; }
function jumpTo(type,val){
  showDashboard();
  if(type==="community"){ activateTab("community"); renderView(); const s=$("commPick"); if(s){s.value=val; s.dispatchEvent(new Event("change"));} }
  else if(type==="vendor"){ activateTab("vendor"); renderView(); const s=$("vSearch"); if(s){s.value=val; s.dispatchEvent(new Event("input"));} }
  else if(type==="category"){ activateTab("coverage"); renderView(); const s=$("cgSearch"); if(s){s.value=val; $("cgFilter").value="all"; s.dispatchEvent(new Event("input"));} }
}

/* ---------------- CSV ---------------- */
function exportCSV(name,headers,rows){
  const q=s=>{ let v=String(s==null?"":s); if(/^[=+\-@\t\r]/.test(v)) v="'"+v; return `"${v.replace(/"/g,'""')}"`; };
  const csv=[headers.map(q).join(","),...rows.map(r=>r.map(q).join(","))].join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download=name+".csv"; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------------- ADMIN ---------------- */
function showAdmin(){ if(!canUploadAny()) return;
  $("dashboard").classList.add("hidden"); $("admin").classList.remove("hidden");
  $("adminLink").classList.add("hidden"); $("dashLink").classList.remove("hidden");
  renderPerms(); renderRollback($("adminDiv").value); }

/* ---------------- Access & permissions (admin only) ---------------- */
function renderPerms(){
  const p=$("permsPanel");
  if(!isAdmin()){ p.classList.add("hidden"); return; }
  p.classList.remove("hidden");
  const divChecks=CFG.DIVISIONS.map(d=>`<label class="permchk"><input type="checkbox" value="${d.key}" class="permDiv"> ${esc(d.label)}</label>`).join("");
  p.innerHTML=`<div class="panel"><div class="panel-h">Access &amp; permissions</div>
    <div style="padding:16px">
      <p class="tiny" style="margin:0 0 12px">Everyone at ${esc(CFG.ALLOWED_DOMAIN)} can view. Grant <b>editor</b> (upload for chosen divisions) or <b>admin</b> (full access) below.</p>
      <div class="permform">
        <input type="email" id="permEmail" placeholder="user@lennar.com">
        <select id="permRole"><option value="viewer">viewer</option><option value="editor">editor</option><option value="admin">admin</option></select>
        <span id="permDivs" class="permdivs">${divChecks}</span>
        <button class="btn mini" id="permSave">Save user</button>
      </div>
      <div id="permMsg" class="msg"></div>
      <div class="table-wrap" id="permList"></div>
    </div></div>`;
  const toggleDivs=()=>{ $("permDivs").style.display = $("permRole").value==="editor" ? "inline-flex":"none"; };
  $("permRole").addEventListener("change",toggleDivs); toggleDivs();
  $("permSave").addEventListener("click",savePerm);
  loadPermList();
}
function permMsg(t,k){ const m=$("permMsg"); if(m){ m.className="msg "+(k||"info"); m.textContent=t; } }
function permTable(rows){
  if(!rows.length) return `<div class="empty">No explicit roles yet — everyone at ${esc(CFG.ALLOWED_DOMAIN)} is a viewer.</div>`;
  const dl=k=>(CFG.DIVISIONS.find(d=>d.key===k)||{}).label||k;
  return `<table><thead><tr><th>Email</th><th>Role</th><th>Divisions</th><th></th></tr></thead><tbody>${
    rows.map(r=>`<tr><td>${esc(r.email)}</td><td><span class="role-tag">${esc(r.role)}</span></td>
      <td>${(r.divisions&&r.divisions.length)? r.divisions.map(k=>`<span class="chip">${esc(dl(k))}</span>`).join("") : (r.role==="admin"?'<span class="cat-tag">all</span>':'—')}</td>
      <td class="num">${DEMO?"":`<button class="linkbtn permEdit" data-email="${esc(r.email)}" data-role="${esc(r.role)}" data-divisions="${esc((r.divisions||[]).join(','))}">Edit</button> <button class="linkbtn permDel" data-email="${esc(r.email)}">Remove</button>`}</td></tr>`).join("")
  }</tbody></table>`;
}
async function loadPermList(){
  const list=$("permList"); if(!list) return;
  if(DEMO){
    const rows=Object.entries(CFG.ROLES).map(([email,r])=>({email,role:r.role,divisions:r.divisions||[]}));
    list.innerHTML=permTable(rows)+`<p class="tiny">Demo mode: this list comes from config.js and is read-only. Connect Supabase to manage users here.</p>`;
    return;
  }
  try{
    const {data,error}=await sb.from("app_roles").select("email,role,divisions").order("email");
    if(error) throw error;
    list.innerHTML=permTable(data);
    list.querySelectorAll(".permEdit").forEach(b=>b.addEventListener("click",()=>fillPermForm(b.dataset)));
    list.querySelectorAll(".permDel").forEach(b=>b.addEventListener("click",()=>delPerm(b.dataset.email)));
  }catch(e){ list.innerHTML=`<div class="empty">Could not load users: ${esc(e.message)}</div>`; }
}
function fillPermForm(ds){
  $("permEmail").value=ds.email; $("permRole").value=ds.role;
  const divs=(ds.divisions||"").split(",").filter(Boolean);
  $("permDivs").querySelectorAll(".permDiv").forEach(c=>{ c.checked=divs.includes(c.value); });
  $("permRole").dispatchEvent(new Event("change"));
}
async function savePerm(){
  const email=$("permEmail").value.trim().toLowerCase();
  const role=$("permRole").value;
  const divisions=role==="editor" ? [...$("permDivs").querySelectorAll(".permDiv:checked")].map(c=>c.value) : [];
  if(!email || !email.endsWith(CFG.ALLOWED_DOMAIN)) return permMsg("Email must be a "+CFG.ALLOWED_DOMAIN+" address.","err");
  if(email===state.email && role!=="admin") return permMsg("You can't remove your own admin access.","err");
  if(role==="editor" && !divisions.length) return permMsg("Pick at least one division for an editor.","err");
  if(DEMO) return permMsg("Demo mode: connect Supabase to save users (or edit config.js ROLES).","info");
  try{
    const {error}=await sb.from("app_roles").upsert({email,role,divisions},{onConflict:"email"}); if(error) throw error;
    permMsg(`Saved ${email} as ${role}${divisions.length?" ("+divisions.join(", ")+")":""}.`,"ok");
    $("permEmail").value=""; loadPermList();
  }catch(e){ permMsg("Save failed: "+e.message,"err"); }
}
async function delPerm(email){
  if(email===state.email) return permMsg("You can't remove your own access.","err");
  if(DEMO) return permMsg("Demo mode: connect Supabase to manage users.","info");
  try{
    const {error}=await sb.from("app_roles").delete().eq("email",email); if(error) throw error;
    permMsg(`Removed ${email} — now a default viewer.`,"ok"); loadPermList();
  }catch(e){ permMsg("Remove failed: "+e.message,"err"); }
}
function showDashboard(){ $("admin").classList.add("hidden"); $("dashboard").classList.remove("hidden");
  $("dashLink").classList.add("hidden"); if(canUploadAny()) $("adminLink").classList.remove("hidden"); }

let uploadFiles={ re2:null, starts:null };
function initAdmin(){
  const sel=$("adminDiv");
  const opts=CFG.DIVISIONS.filter(dv=>canEdit(dv.key));
  sel.innerHTML=(opts.length?opts:CFG.DIVISIONS).map(d=>`<option value="${d.key}">${esc(d.label)}</option>`).join("");
  wireTile("tileRe2","re2Input","re2");
  wireTile("tileStarts","startsInput","starts");
  $("re2Input").addEventListener("change",e=>{ if(e.target.files[0]) loadUpload("re2",e.target.files[0]); e.target.value=""; });
  $("startsInput").addEventListener("change",e=>{ if(e.target.files[0]) loadUpload("starts",e.target.files[0]); e.target.value=""; });
  sel.addEventListener("change",()=>{ renderRollback(sel.value); if(uploadFiles.re2||uploadFiles.starts) tryBuildPreview(); });
  $("historyBtn").addEventListener("click",()=>{ showDashboard(); activateTab("history"); state.view="history"; renderView(); });
}
function wireTile(tileId,inputId,kind){
  const tile=$(tileId); if(!tile) return;
  const open=()=>$(inputId).click();
  tile.addEventListener("click",open);
  tile.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } });
  ["dragenter","dragover"].forEach(ev=>tile.addEventListener(ev,e=>{ e.preventDefault(); tile.classList.add("drag"); }));
  ["dragleave","dragend","drop"].forEach(ev=>tile.addEventListener(ev,e=>{ e.preventDefault(); tile.classList.remove("drag"); }));
  tile.addEventListener("drop",e=>{ const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(f) loadUpload(kind,f); });
}
function adminMsg(t,k){ const m=$("adminMsg"); m.className="msg "+(k||"info"); m.textContent=t; }

async function loadUpload(kind,file){
  adminMsg("Reading "+file.name+"…","info");
  try {
    const buf=await file.arrayBuffer();
    uploadFiles[kind]={name:file.name, wb:XLSX.read(buf,{type:"array"})};
    $(kind==="re2"?"re2Name":"startsName").textContent=file.name;
    const tile=$(kind==="re2"?"tileRe2":"tileStarts");
    if(tile){ tile.classList.add("filled"); const ic=tile.querySelector(".uptile-ic"); if(ic) ic.innerHTML="&#10003;"; }
    tryBuildPreview();
  } catch(e){ adminMsg("Could not read "+file.name+": "+e.message,"err"); }
}

async function tryBuildPreview(){
  const key=$("adminDiv").value;
  if(!uploadFiles.re2 && !uploadFiles.starts){ return; }
  adminMsg("Parsing…","info");
  try {
    const parsed=buildDivision(key, uploadFiles.re2 && uploadFiles.re2.wb, uploadFiles.starts && uploadFiles.starts.wb);
    const diag=parsed._diag||{};
    let current=state.cache[key]||null;
    if(!current && !DEMO && sb){ try{ const {data}=await sb.from("division_data").select("payload").eq("key",key).maybeSingle(); current=(data&&data.payload)||null; }catch(e){} }
    const diff = current ? diffPayload(current, parsed) : null;
    const warns=[];
    if(uploadFiles.re2){
      const codes=Object.keys(diag.divCounts||{}).sort((a,b)=>diag.divCounts[b]-diag.divCounts[a]);
      const match=diag.divCounts?(diag.divCounts[diag.code]||0):0;
      if(match===0 && diag.re2Rows>0) warns.push(`No rows in this file match division <b>${esc(diag.code)}</b> — this looks like the wrong file.`);
      else if(codes[0] && codes[0]!==diag.code) warns.push(`This file is mostly division <b>${esc(codes[0])}</b>; only ${fmt(match)} of ${fmt(diag.re2Rows)} rows are <b>${esc(diag.code)}</b>.`);
      if((diag.unmatched||[]).length) warns.push(`${fmt(diag.unmatched.length)} communities couldn't be matched to a name (shown by ID) — upload the matching starts file for best names.`);
    }
    if(current && diff){
      if(parsed.communities.length < current.communities.length*0.3)
        warns.push(`Removes ~${fmt(current.communities.length-parsed.communities.length)} of ${fmt(current.communities.length)} communities (over 70%). Check you picked the right file.`);
      const curA=current.vendors.reduce((s,v)=>s+v.assigned.length,0), newA=parsed.vendors.reduce((s,v)=>s+v.assigned.length,0);
      if(newA < curA*0.3) warns.push(`Removes over 70% of trade assignments (${fmt(curA)} → ${fmt(newA)}).`);
    }
    window._parsed=parsed;
    $("previewPanel").classList.remove("hidden");
    const diffHtml = diff
      ? `<div class="diffrow"><span class="dl">Changes vs current:</span><span class="chip good-chip">+${fmt(diff.commsAdded)} comm</span><span class="chip bad-chip">-${fmt(diff.commsRemoved)} comm</span><span class="chip">assign +${fmt(diff.assignmentsAdded)}/-${fmt(diff.assignmentsRemoved)}</span><span class="chip">vendors +${fmt(diff.vendorsAdded)}/-${fmt(diff.vendorsRemoved)}</span></div>`
      : `<p class="tiny">First upload for this division — nothing to compare against.</p>`;
    const warnHtml = warns.length ? `<div class="warnbox"><b>Review before publishing</b><ul>${warns.map(w=>`<li>${w}</li>`).join("")}</ul></div>` : "";
    $("previewBody").innerHTML=`
      <div class="kpis" style="margin:6px 0 12px">
        <div class="kpi"><div class="n">${fmt(parsed.communities.length)}</div><div class="l">Communities</div></div>
        <div class="kpi"><div class="n">${fmt(new Set(parsed.vendors.map(v=>v.name)).size)}</div><div class="l">Trade Partners</div></div>
        <div class="kpi"><div class="n">${fmt(parsed.categories.length)}</div><div class="l">Categories</div></div>
        <div class="kpi"><div class="n">${fmt((parsed.startRecords||[]).length)}</div><div class="l">Start records</div></div>
      </div>
      ${diffHtml}${warnHtml}
      <p class="tiny" style="text-align:left">Sources: ${uploadFiles.re2?esc(uploadFiles.re2.name):"<i>no RE2 file</i>"} · ${uploadFiles.starts?esc(uploadFiles.starts.name):"<i>no starts file</i>"}</p>
      <button class="btn${warns.length?' ghost':''}" id="publishBtn">Publish — replace ${esc($("adminDiv").selectedOptions[0].text)} data</button>`;
    $("publishBtn").addEventListener("click",()=>{
      const strip=w=>w.replace(/<[^>]+>/g,"");
      const msg="Replace ALL "+parsed.division+" data?\n\n"
        +(diff?`Communities: +${diff.commsAdded} / -${diff.commsRemoved}\nAssignments: +${diff.assignmentsAdded} / -${diff.assignmentsRemoved}\nVendors: +${diff.vendorsAdded} / -${diff.vendorsRemoved}\n`:"First upload for this division.\n")
        +(warns.length?"\nWarnings:\n- "+warns.map(strip).join("\n- ")+"\n":"")
        +"\nThis overwrites the current data and cannot be undone.";
      if(confirm(msg)) publish(parsed,key);
    });
    adminMsg(warns.length?"Preview ready — please review the warnings before publishing.":"Preview ready. Review the changes, then Publish.", warns.length?"info":"ok");
  } catch(e){ adminMsg("Parse error: "+e.message,"err"); }
}

function fixRange(ws){
  if(!ws) return ws;
  let minR=Infinity,minC=Infinity,maxR=0,maxC=0,any=false;
  for(const k in ws){ if(k[0]==="!") continue; const c=XLSX.utils.decode_cell(k);
    any=true; if(c.r<minR)minR=c.r; if(c.c<minC)minC=c.c; if(c.r>maxR)maxR=c.r; if(c.c>maxC)maxC=c.c; }
  if(any) ws["!ref"]=XLSX.utils.encode_range({s:{r:minR,c:minC},e:{r:maxR,c:maxC}});
  return ws;
}

/* Build a division payload from raw RE2 + starts workbooks (mirrors the pipeline). */
function buildDivision(key, re2wb, startswb){
  const label=(CFG.DIVISIONS.find(d=>d.key===key)||{}).label||key;
  const digits=x=>String(x==null?"":x).replace(/\D/g,"");
  const S=s=>(s==null?null:String(s).trim()||null);
  const sheetRows=(wb,name)=>wb&&wb.Sheets[name]?XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null}):null;
  const firstSheet=wb=>wb?wb.SheetNames[0]:null;

  // ---- starts ----
  let startRecords=[];
  const idName={}; // community id -> name (from starts jobs)
  if (startswb){
    // detect format by sheet + headers
    let sheet = startswb.SheetNames.includes("Start Log") ? "Start Log"
              : startswb.SheetNames.includes("START SCHEDULE") ? "START SCHEDULE"
              : firstSheet(startswb);
    const rows=XLSX.utils.sheet_to_json(fixRange(startswb.Sheets[sheet]),{defval:null});
    for (const r of rows){
      let comm=null, date=null, kind="Projected", job=null;
      if (r["Comm"]!=null){ comm=S(r["Comm"]); const p=r["Start (Prj)"], a=r["Start (Act)"]; date=xlDate(a||p); kind=a?"Actual":"Projected"; job=r["Job"]; }
      else if (r["Project"]!=null){ const proj=S(r["Project"])||""; comm=proj.includes(" - ")?proj.split(" - ").slice(1).join(" - ").trim():proj; const a=r["ActStart"],p=r["PrjStart"]; date=xlDate(a||p); kind=a?"Actual":"Projected"; job=r["Job"]; }
      if(!comm||!date) continue;
      startRecords.push({community:comm,date,kind});
      const id=digits(job); if(id.length>=11) idName[id.slice(0,7)+"0000"]=comm;
    }
  }

  // ---- vendors from RE2 ----
  let vendors=[], communities=[], categories=[];
  const commSet=new Map(); // id -> name
  const diag={divCounts:{},unmatched:new Set(),re2Rows:0,code:(CFG.DIVISIONS.find(d=>d.key===key)||{}).code||key.toUpperCase()};
  if (re2wb){
    const rows=XLSX.utils.sheet_to_json(fixRange(re2wb.Sheets[firstSheet(re2wb)]),{defval:null});
    const code=diag.code;
    const today=new Date().toISOString().slice(0,10);
    const groups=new Map(); // cat|vendor -> {cat,vendor,tradeCode,bill?,comms:Set}
    for (const r of rows){
      const div=S(r["Division"]); diag.re2Rows++; if(div) diag.divCounts[div.toUpperCase()]=(diag.divCounts[div.toUpperCase()]||0)+1;
      if (div && code && div.toUpperCase()!==code.toUpperCase()) continue;
      const vendor=S(r["Supplier Desc"]); const cat=S(r["Trade Desc."])||S(r["Trade Desc"]);
      if(!vendor||!cat||cat===".") continue;
      const exp=xlDate(r["Expired Date"]); if(exp && exp<today) continue; // skip expired
      const cid=digits(r["Community"]); if(!cid) continue;
      const cidNorm=cid.length>=11?cid.slice(0,7)+"0000":cid;
      const nm=idName[cidNorm]||cleanCommName(S(r["Description"]))||cidNorm;
      commSet.set(cidNorm,nm);
      if(nm===cidNorm) diag.unmatched.add(cidNorm);
      const gk=cat+"|"+vendor;
      if(!groups.has(gk)) groups.set(gk,{category:cat,name:vendor,tradeCode:S(r["Trade Code"]),supplierCode:S(r["Supplier"]),comms:new Set()});
      if(!groups.get(gk).supplierCode) groups.get(gk).supplierCode=S(r["Supplier"]);
      groups.get(gk).comms.add(nm);
    }
    vendors=[...groups.values()].map(g=>({category:g.category,billCode:null,tradeCode:g.tradeCode,supplierCode:g.supplierCode,name:g.name,
      totalCommunities:g.comms.size,total2026:null,assigned:[...g.comms].sort()}));
    categories=[...new Set(vendors.map(v=>v.category))].sort();
  } else {
    // keep existing vendor matrix (RE2 not uploaded this time)
    const cur=state.cache[key];
    if(cur){ vendors=cur.vendors; categories=cur.categories; cur.communities.forEach(c=>{ if(c.id) commSet.set(digits(c.id).slice(0,7)+"0000"||c.id,c.name); else commSet.set(c.name,c.name); }); }
  }

  // ---- union communities: assignment comms ∪ starts comms ----
  const names=new Set([...commSet.values()]);
  startRecords.forEach(r=>names.add(r.community));
  const name2id={};
  for (const [cid,nm] of commSet.entries()) if(nm && !(nm in name2id)) name2id[nm]=cid;
  for (const cid in idName){ const nm=idName[cid]; if(nm && !(nm in name2id)) name2id[nm]=cid; }
  communities=[...names].sort().map(n=>({name:n,id:name2id[n]||null,homesites:null}));

  const dr = startRecords.length? {min:startRecords.reduce((a,b)=>b.date<a?b.date:a,startRecords[0].date),
                                   max:startRecords.reduce((a,b)=>b.date>a?b.date:a,startRecords[0].date)} : null;
  return {division:label,code:(CFG.DIVISIONS.find(d=>d.key===key)||{}).code||key.toUpperCase(),key,
          communities,categories,vendors,startRecords,startsDateRange:dr,
          _diag:{divCounts:diag.divCounts,unmatched:[...diag.unmatched],re2Rows:diag.re2Rows,code:diag.code}};
}
function cleanCommName(desc){ if(!desc) return null; // strip plan/parenthetical suffixes
  return desc.replace(/\(.*?\)/g,"").replace(/[-*].*$/,"").trim()||null; }
function xlDate(v){
  if(v==null||v==="") return null;
  if(typeof v==="number"){ const d=new Date(Math.round((v-25569)*86400*1000)); return isNaN(d)?null:d.toISOString().slice(0,10); }
  const d=new Date(v); return isNaN(d)?null:d.toISOString().slice(0,10);
}

/* Diff for change log */
function diffPayload(prev,next){
  const names=arr=>new Set((arr||[]).map(x=>x.name));
  const pv=names(prev&&prev.vendors), nv=names(next.vendors);
  const pc=names(prev&&prev.communities), nc=names(next.communities);
  const pairs=vs=>{ const s=new Set(); (vs||[]).forEach(v=>(v.assigned||[]).forEach(c=>s.add(v.name+"|"+c))); return s; };
  const pp=pairs(prev&&prev.vendors), np=pairs(next.vendors);
  const added=(A,B)=>[...B].filter(x=>!A.has(x));
  const cAdd=added(pc,nc), cRem=added(nc,pc);
  const aAdd=added(pp,np), aRem=added(np,pp);
  return {vendors:nv.size, communities:nc.size,
    vendorsAdded:added(pv,nv).length, vendorsRemoved:added(nv,pv).length,
    commsAdded:cAdd.length, commsRemoved:cRem.length,
    commsAddedList:cAdd, commsRemovedList:cRem,
    assignmentsAdded:aAdd.length, assignmentsRemoved:aRem.length,
    assignAddedList:aAdd, assignRemovedList:aRem,
    assignDelta:np.size-pp.size};
}

async function publish(parsed,key){
  if (DEMO){ adminMsg("Demo mode: parsing works, but publishing needs the Supabase backend (see SETUP.md). Nothing was saved.","info"); return; }
  adminMsg("Publishing…","info");
  delete parsed._diag;
  try {
    const {data:prevRow}=await sb.from("division_data").select("payload,updated_at,updated_by").eq("key",key).maybeSingle();
    const summary=diffPayload(prevRow&&prevRow.payload,parsed);
    const {error}=await sb.from("division_data").upsert(
      {key,label:parsed.division,payload:parsed,updated_at:new Date().toISOString(),updated_by:state.email,
       prev_payload:prevRow?prevRow.payload:null,prev_updated_at:prevRow?prevRow.updated_at:null,prev_by:prevRow?prevRow.updated_by:null},{onConflict:"key"});
    if(error) throw error;
    await sb.from("change_log").insert({key,actor:state.email,summary});
    delete state.cache[key];
    const sign = summary.assignDelta>=0 ? "+" : "";
    adminMsg("Published. "+parsed.division+" replaced. Assignments "+sign+summary.assignDelta+", +"+summary.vendorsAdded+"/-"+summary.vendorsRemoved+" vendors.","ok");
    renderRollback(key);
  } catch(e){ adminMsg("Publish failed: "+e.message,"err"); }
}
async function revertDivision(key){
  if(DEMO||!sb) return;
  adminMsg("Reverting…","info");
  try{
    const {data:row}=await sb.from("division_data").select("payload,updated_at,updated_by,prev_payload,prev_updated_at,prev_by,label").eq("key",key).maybeSingle();
    if(!row||!row.prev_payload){ adminMsg("No previous version to revert to.","err"); return; }
    const summary=diffPayload(row.payload,row.prev_payload);
    const label=(row.prev_payload&&row.prev_payload.division)||row.label;
    const {error}=await sb.from("division_data").upsert(
      {key,label,payload:row.prev_payload,updated_at:new Date().toISOString(),updated_by:state.email+" (revert)",
       prev_payload:row.payload,prev_updated_at:row.updated_at,prev_by:row.updated_by},{onConflict:"key"});
    if(error) throw error;
    await sb.from("change_log").insert({key,actor:state.email+" (revert)",summary});
    delete state.cache[key];
    adminMsg("Reverted "+label+" to the previous version.","ok");
    renderRollback(key);
  }catch(e){ adminMsg("Revert failed: "+e.message,"err"); }
}
async function renderRollback(key){
  const wrap=$("rollbackWrap"); if(!wrap) return;
  if(DEMO||!sb){ wrap.innerHTML=""; return; }
  try{
    const {data:row}=await sb.from("division_data").select("updated_at,updated_by,prev_updated_at,prev_by,prev_payload").eq("key",key).maybeSingle();
    const dl=(CFG.DIVISIONS.find(d=>d.key===key)||{}).label||key;
    if(!row){ wrap.innerHTML=`<div class="panel"><div class="panel-h">Rollback</div><div style="padding:14px"><p class="tiny">No data published for ${esc(dl)} yet.</p></div></div>`; return; }
    const has=!!row.prev_payload;
    wrap.innerHTML=`<div class="panel"><div class="panel-h">Rollback — ${esc(dl)}</div><div style="padding:14px">
      <p class="tiny" style="margin:0 0 6px">Current: ${row.updated_at?esc(new Date(row.updated_at).toLocaleString()):"—"}${row.updated_by?" by "+esc(row.updated_by):""}</p>
      ${has?`<p class="tiny" style="margin:0 0 10px">Previous: ${row.prev_updated_at?esc(new Date(row.prev_updated_at).toLocaleString()):"—"}${row.prev_by?" by "+esc(row.prev_by):""}</p><button class="btn mini ghost" id="revertBtn">Revert to previous version</button>`
        :`<p class="tiny">No previous version yet — rollback becomes available after your next upload.</p>`}
    </div></div>`;
    if(has){ $("revertBtn").addEventListener("click",()=>{ if(confirm("Revert "+dl+" to the previous version?\n\nThe current version is swapped out (revert again to redo). This is logged in the change history.")) revertDivision(key); }); }
  }catch(e){ wrap.innerHTML=""; }
}
async function loadDivisionsFromDB(){
  if(DEMO||!sb) return;
  try{ const {data}=await sb.from("app_divisions").select("key,label,code,sort").order("sort");
    if(data&&data.length){ CFG.DIVISIONS.length=0; data.forEach(d=>CFG.DIVISIONS.push({key:d.key,label:d.label,code:d.code})); } }catch(e){}
}

checkExistingSession();
/* v: permissions editor */
