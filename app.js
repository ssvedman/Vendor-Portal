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
  $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
  $("userChip").innerHTML = esc(state.email)+` <span class="role-tag">${esc(state.role)}</span>`;
  if (DEMO) $("appDemoPill").classList.remove("hidden");
  if (canUploadAny()) $("adminLink").classList.remove("hidden");

  const sel=$("divisionSel");
  sel.innerHTML=CFG.DIVISIONS.map(d=>`<option value="${d.key}">${esc(d.label)}</option>`).join("");
  sel.addEventListener("change",()=>loadDivision(sel.value));

  // date range
  $("fromDate").value=state.range.from; $("toDate").value=state.range.to;
  ["change","input"].forEach(ev=>{ $("fromDate").addEventListener(ev,onRange); $("toDate").addEventListener(ev,onRange); });
  $("rangeReset").addEventListener("click",()=>{ state.range={...CFG.DEFAULT_RANGE};
    $("fromDate").value=state.range.from; $("toDate").value=state.range.to; renderAll(); });

  // tabs
  document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active"); state.view=t.dataset.view; renderView(); }));

  $("logoutBtn").addEventListener("click",logout);
  $("adminLink").addEventListener("click",showAdmin);
  $("dashLink").addEventListener("click",showDashboard);
  $("printBtn").addEventListener("click",()=>window.print());
  $("homeLogo").addEventListener("click",()=>{ showDashboard(); activateTab("community"); state.view="community"; renderView(); });
  setupGlobalSearch();
  initAdmin();
  await loadDivision(CFG.DIVISIONS[0].key);
}
function onRange(){
  const f=$("fromDate").value, t=$("toDate").value;
  if (f&&t&&f<=t){ state.range={from:f,to:t}; renderAll(); }
}

async function loadDivision(key){
  state.divKey=key;
  if (state.cache[key]){ state.data=state.cache[key]; renderAll(); return; }
  $("viewArea").innerHTML=`<div class="empty">Loading…</div>`;
  try {
    let data;
    if (DEMO){ const res=await fetch(`data/${key}.json`); if(!res.ok) throw new Error("Data file not found"); data=await res.json(); }
    else { const {data:row,error}=await sb.from("division_data").select("payload,updated_at,updated_by").eq("key",key).single();
           if(error) throw error; data=row.payload; data._updated=row.updated_at; data._by=row.updated_by; }
    state.cache[key]=data; state.data=data; renderAll();
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
  const when = d._updated ? new Date(d._updated).toLocaleString() : "bundled data (not yet published to backend)";
  const by = d._by ? " by "+esc(d._by) : "";
  const span = d.startsDateRange ? ` • starts data spans ${d.startsDateRange.min} → ${d.startsDateRange.max}` : "";
  $("banner").innerHTML = `<b>${esc(d.division)}</b> — last updated: ${esc(when)}${by}${span}
    <span class="range-note">Showing communities active ${state.range.from} → ${state.range.to}</span>`;
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
        <td>${esc(v.name)}${supTag(v)}</td><td>${esc(v.tradeCode||"—")}</td></tr>`).join("")}</tbody></table></div>`
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
  const cats=["All categories",...[...new Set(src.map(v=>v.category).filter(Boolean))].sort()];
  $("viewArea").innerHTML=`
    ${toolbar(`<input type="text" id="mSearch" placeholder="Search vendor…">
      <select id="mCat">${cats.map(c=>`<option>${esc(c)}</option>`).join("")}</select>
      <select id="mComm"><option value="">All communities</option>${[...d.communities].filter(c=>active.has(c.name)).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${esc(c.name)}">${esc(commLabel(c.name))}</option>`).join("")}</select>
      <button class="btn mini ghost" id="mExport">Export CSV</button><span class="count" id="mCount"></span>`)}
    <div class="panel"><div class="table-wrap" id="mBody"></div></div>`;
  const render=()=>{
    const q=$("mSearch").value.trim().toLowerCase(), cat=$("mCat").value, only=$("mComm").value;
    let rows=src.slice();
    if(cat!=="All categories") rows=rows.filter(v=>v.category===cat);
    if(q) rows=rows.filter(v=>v.name.toLowerCase().includes(q));
    if(only) rows=rows.filter(v=>v.assigned.includes(only));
    let comms=only?d.communities.filter(c=>c.name===only):[...d.communities].filter(c=>active.has(c.name)).sort((a,b)=>a.name.localeCompare(b.name));
    rows.sort((a,b)=>(a.category||"").localeCompare(b.category||"")||a.name.localeCompare(b.name));
    $("mCount").textContent=`${rows.length} vendors × ${comms.length} communities`;
    const cap=rows.slice(0,250);
    $("mBody").innerHTML=`<table class="matrix"><thead><tr><th class="sticky">Trade Partner</th>${comms.map(c=>`<th class="vhead" title="${esc(commLabel(c.name))}">${esc(c.name)}${c.id?"  ·  "+esc(shortId(c.id)):""}</th>`).join("")}</tr></thead>
      <tbody>${cap.map(v=>{const set=new Set(v.assigned);
        return `<tr><td class="sticky">${esc(v.name)}${supTag(v)}<br><span class="cat-tag">${esc(v.category||"")}</span></td>${comms.map(c=>`<td class="cell">${set.has(c.name)?'<span class="x-mark">✓</span>':''}</td>`).join("")}</tr>`;}).join("")}</tbody></table>
      ${rows.length>250?`<div class="empty">Showing first 250 of ${rows.length}. Narrow with filters.</div>`:""}`;
    window._expM=()=>exportCSV(`${d.key}_assignment_matrix`,
      ["Trade Partner","Supplier #","Trade Category",...comms.map(c=>commLabel(c.name))],
      rows.map(v=>{const set=new Set(v.assigned); return [v.name, v.supplierCode||"", v.category||"", ...comms.map(c=>set.has(c.name)?"X":"")];}));
  };
  $("mSearch").addEventListener("input",render); $("mCat").addEventListener("change",render); $("mComm").addEventListener("change",render);
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
  else coverageByTrade(d,rowsAll,total);
}

function coverageByTrade(d,rowsAll,total){
  $("covContent").innerHTML=`
    ${toolbar(`<input type="text" id="cgSearch" placeholder="Filter trade…">
      <select id="cgFilter"><option value="risk">Risks only (single-source or gaps)</option><option value="all">All trades</option>
        <option value="single">Single-source only</option><option value="core">Core trades only</option></select>
      <button class="btn mini ghost" id="cgExport">Export CSV</button><span class="count" id="cgCount"></span>`)}
    <div class="panel"><div class="table-wrap" id="cgBody"></div></div>`;
  const render=()=>{
    const q=$("cgSearch").value.trim().toLowerCase(), f=$("cgFilter").value;
    let rows=rowsAll.slice();
    if(f==="risk") rows=rows.filter(r=>r.risk==="single-source"||r.risk==="gaps");
    else if(f==="single") rows=rows.filter(r=>r.vendors===1);
    else if(f==="core") rows=rows.filter(r=>r.core);
    if(q) rows=rows.filter(r=>r.cat.toLowerCase().includes(q));
    rows.sort((a,b)=>(b.core-a.core)||b.missing.length-a.missing.length || a.cat.localeCompare(b.cat));
    $("cgCount").textContent=`${rows.length} trades`;
    const riskTag=r=> r.risk==="single-source"?'<span class="risk risk-s">Single-source</span>'
      : r.risk==="gaps"?'<span class="risk risk-g">Gaps</span>'
      : r.risk==="limited"?'<span class="risk risk-l">Limited</span>'
      : '<span class="risk risk-ok">OK</span>';
    $("cgBody").innerHTML=`<table><thead><tr><th>Trade Category</th><th class="num">Vendors</th><th class="num">Coverage</th><th>Status</th><th>Missing communities</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td>${esc(r.cat)}${r.core?' <span class="cat-tag">core</span>':''}</td><td class="num">${r.vendors}</td>
        <td class="num">${r.covered}/${total}</td>
        <td>${riskTag(r)}</td>
        <td>${r.missing.length? r.missing.slice(0,8).map(c=>`<span class="chip warn-chip">${esc(commLabel(c))}</span>`).join("")+(r.missing.length>8?`<span class="cat-tag">+${r.missing.length-8}</span>`:"") : '<span class="cat-tag">full coverage</span>'}</td>
      </tr>`).join("")}</tbody></table>`;
    window._exp=()=>exportCSV(`${d.key}_coverage_by_trade`,["Trade","Core","Vendors","Covered","Total","Status","Missing communities"],
      rows.map(r=>[r.cat,r.core?"yes":"no",r.vendors,r.covered,total,r.risk,r.missing.join("; ")]));
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
    if(f==="gaps") rows=rows.filter(r=>r.gaps>0);
    if(q) rows=rows.filter(r=>r.community.toLowerCase().includes(q));
    rows.sort((a,b)=>b.gaps-a.gaps || a.community.localeCompare(b.community));
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
      <div class="chart-box"><canvas id="chMonth" height="90"></canvas></div></div>
    <div class="panel" style="margin-bottom:16px"><div class="panel-h">Top communities by starts (in range)</div>
      <div class="chart-box"><canvas id="chComm" height="120"></canvas></div></div>
    ${toolbar(`<input type="text" id="sSearch" placeholder="Filter community…"><button class="btn mini ghost" id="sExport">Export CSV</button><span class="count" id="sCount"></span>`)}
    <div class="panel"><div class="table-wrap" id="sBody"></div></div>`;
  if (window.Chart){
    charts.push(new Chart($("chMonth"),{type:"bar",data:{labels:monthLabels,datasets:[{label:"Starts",data:totalsByMonth,backgroundColor:"#0057b8"}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}}));
    charts.push(new Chart($("chComm"),{type:"bar",data:{labels:topComm.map(c=>c.community),datasets:[{label:"Starts",data:topComm.map(c=>c.total),backgroundColor:"#0a2540"}]},options:{indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{beginAtZero:true}}}}));
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
      jumpTo(el.dataset.t, el.dataset.v); panel.classList.add("hidden"); box.value=""; }));
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
  $("adminLink").classList.add("hidden"); $("dashLink").classList.remove("hidden"); }
function showDashboard(){ $("admin").classList.add("hidden"); $("dashboard").classList.remove("hidden");
  $("dashLink").classList.add("hidden"); if(canUploadAny()) $("adminLink").classList.remove("hidden"); }

let uploadFiles={ re2:null, starts:null };
function initAdmin(){
  const sel=$("adminDiv");
  const opts=CFG.DIVISIONS.filter(dv=>canEdit(dv.key));
  sel.innerHTML=(opts.length?opts:CFG.DIVISIONS).map(d=>`<option value="${d.key}">${esc(d.label)}</option>`).join("");
  $("pickRe2").addEventListener("click",()=>$("re2Input").click());
  $("pickStarts").addEventListener("click",()=>$("startsInput").click());
  $("re2Input").addEventListener("change",e=>{ if(e.target.files[0]) loadUpload("re2",e.target.files[0]); });
  $("startsInput").addEventListener("change",e=>{ if(e.target.files[0]) loadUpload("starts",e.target.files[0]); });
  sel.addEventListener("change",()=>{ if(uploadFiles.re2||uploadFiles.starts) tryBuildPreview(); });
  $("historyBtn").addEventListener("click",()=>{ showDashboard(); activateTab("history"); state.view="history"; renderView(); });
}
function adminMsg(t,k){ const m=$("adminMsg"); m.className="msg "+(k||"info"); m.textContent=t; }

async function loadUpload(kind,file){
  adminMsg("Reading "+file.name+"…","info");
  try {
    const buf=await file.arrayBuffer();
    uploadFiles[kind]={name:file.name, wb:XLSX.read(buf,{type:"array"})};
    $(kind==="re2"?"re2Name":"startsName").textContent=file.name;
    tryBuildPreview();
  } catch(e){ adminMsg("Could not read "+file.name+": "+e.message,"err"); }
}

function tryBuildPreview(){
  const key=$("adminDiv").value;
  if(!uploadFiles.re2 && !uploadFiles.starts){ return; }
  adminMsg("Parsing…","info");
  try {
    const parsed=buildDivision(key, uploadFiles.re2 && uploadFiles.re2.wb, uploadFiles.starts && uploadFiles.starts.wb);
    window._parsed=parsed;
    $("previewPanel").classList.remove("hidden");
    $("previewBody").innerHTML=`
      <div class="kpis" style="margin:6px 0 14px">
        <div class="kpi"><div class="n">${fmt(parsed.communities.length)}</div><div class="l">Communities</div></div>
        <div class="kpi"><div class="n">${fmt(new Set(parsed.vendors.map(v=>v.name)).size)}</div><div class="l">Trade Partners</div></div>
        <div class="kpi"><div class="n">${fmt(parsed.categories.length)}</div><div class="l">Categories</div></div>
        <div class="kpi"><div class="n">${fmt((parsed.startRecords||[]).length)}</div><div class="l">Start records</div></div>
      </div>
      <p class="tiny" style="text-align:left">Sources: ${uploadFiles.re2?esc(uploadFiles.re2.name):"<i>no RE2 assignment file</i>"} · ${uploadFiles.starts?esc(uploadFiles.starts.name):"<i>no starts file</i>"}</p>
      <button class="btn" id="publishBtn">Publish — replace ${esc($("adminDiv").selectedOptions[0].text)} data</button>`;
    $("publishBtn").addEventListener("click",()=>publish(parsed,key));
    adminMsg("Preview ready. Review counts, then Publish.","ok");
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
  if (re2wb){
    const rows=XLSX.utils.sheet_to_json(fixRange(re2wb.Sheets[firstSheet(re2wb)]),{defval:null});
    const code=(CFG.DIVISIONS.find(d=>d.key===key)||{}).code || key.toUpperCase();
    const today=new Date().toISOString().slice(0,10);
    const groups=new Map(); // cat|vendor -> {cat,vendor,tradeCode,bill?,comms:Set}
    for (const r of rows){
      const div=S(r["Division"]); if (div && code && div.toUpperCase()!==code.toUpperCase()) continue;
      const vendor=S(r["Supplier Desc"]); const cat=S(r["Trade Desc."])||S(r["Trade Desc"]);
      if(!vendor||!cat||cat===".") continue;
      const exp=xlDate(r["Expired Date"]); if(exp && exp<today) continue; // skip expired
      const cid=digits(r["Community"]); if(!cid) continue;
      const cidNorm=cid.length>=11?cid.slice(0,7)+"0000":cid;
      const nm=idName[cidNorm]||cleanCommName(S(r["Description"]))||cidNorm;
      commSet.set(cidNorm,nm);
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
          communities,categories,vendors,startRecords,startsDateRange:dr};
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
  const pv=new Set((prev&&prev.vendors||[]).map(v=>v.name)), nv=new Set(next.vendors.map(v=>v.name));
  const pc=new Set((prev&&prev.communities||[]).map(c=>c.name)), nc=new Set(next.communities.map(c=>c.name));
  const pa=(prev&&prev.vendors||[]).reduce((s,v)=>s+v.assigned.length,0);
  const na=next.vendors.reduce((s,v)=>s+v.assigned.length,0);
  const diff=(A,B)=>[...B].filter(x=>!A.has(x)).length;
  return {vendors:nv.size,communities:nc.size,vendorsAdded:diff(pv,nv),vendorsRemoved:diff(nv,pv),
          commsAdded:diff(pc,nc),commsRemoved:diff(nc,pc),assignDelta:na-pa};
}

async function publish(parsed,key){
  if (DEMO){ adminMsg("Demo mode: parsing works, but publishing needs the Supabase backend (see SETUP.md). Nothing was saved.","info"); return; }
  adminMsg("Publishing…","info");
  try {
    const {data:prevRow}=await sb.from("division_data").select("payload").eq("key",key).maybeSingle();
    const summary=diffPayload(prevRow&&prevRow.payload,parsed);
    const {error}=await sb.from("division_data").upsert(
      {key,label:parsed.division,payload:parsed,updated_at:new Date().toISOString(),updated_by:state.email},{onConflict:"key"});
    if(error) throw error;
    await sb.from("change_log").insert({key,actor:state.email,summary});
    delete state.cache[key];
    const sign = summary.assignDelta>=0 ? "+" : "";
    adminMsg("Published. "+parsed.division+" replaced. Assignments "+sign+summary.assignDelta+", +"+summary.vendorsAdded+"/-"+summary.vendorsRemoved+" vendors.","ok");
  } catch(e){ adminMsg("Publish failed: "+e.message,"err"); }
}

checkExistingSession();
