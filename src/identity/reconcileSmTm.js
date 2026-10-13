import { normaliseName } from "./playerIdentityResolver.js";

// Conservative cross-provider reconciliation. No match is published as confirmed
// without independent evidence and an unambiguous one-to-one assignment.
const str = x => String(x ?? "").trim();
const dob = x => /^\d{4}-\d{2}-\d{2}$/.test(str(x)) ? str(x) : "";
const name = r => str(r.full_name || r.canonical_name || r.display_name || r.player_name || r.name);
const key = r => normaliseName(name(r));
const id = (r, provider) => str(provider === "sm" ? (r.player_data_id ?? r.playerDataId ?? r.sm_player_data_id) : (r.transfermarkt_id ?? r.player_id ?? r.tm_id));
const tokens = x => new Set(normaliseName(x).split(" ").filter(Boolean));
const similarity = (a,b) => { const x=tokens(a),y=tokens(b); if(!x.size||!y.size)return 0;let n=0;for(const t of x)if(y.has(t))n++;return n/new Set([...x,...y]).size; };
const nationality = r => new Set([r.nationality,r.nationalities].flat().filter(Boolean).map(normaliseName));
function score(sm,tm) {
  const evidence=[], conflicts=[];
  const sd=dob(sm.date_of_birth||sm.dob||sm.birth_date),td=dob(tm.date_of_birth||tm.dob||tm.birth_date);
  if(sd&&td) { if(sd!==td) conflicts.push("dob_conflict"); else evidence.push("dob_exact"); }
  const sn=key(sm),tn=key(tm);
  const sim=similarity(sn,tn);
  if(sn&&sn===tn)evidence.push("name_exact");
  else if(sim>=0.65)evidence.push("name_tokens");
  const sc=normaliseName(sm.real_world_club||sm.current_club||sm.club_name);
  const tc=normaliseName(tm.real_world_club||tm.current_club||tm.club_name);
  if(sc&&tc&&sc===tc)evidence.push("club_exact");
  const sp=normaliseName(sm.position||sm.primary_position),tp=normaliseName(tm.position||tm.primary_position);
  if(sp&&tp&&(sp===tp||sp.includes(tp)||tp.includes(sp)))evidence.push("position_compatible");
  const ns=nationality(sm),nt=nationality(tm);
  if(ns.size&&nt.size&&[...ns].some(n=>nt.has(n)))evidence.push("nationality_overlap");
  const points=(sd&&td&&sd===td?55:0)+(sn&&sn===tn?30:Math.round(sim*24))+(sc&&tc&&sc===tc?10:0)+(evidence.includes("nationality_overlap")?4:0)+(evidence.includes("position_compatible")?3:0);
  return {score:points,evidence,conflicts};
}
export function reconcilePlayerIdentities(smRows, tmRows, decisions=[]) {
  const byDob=new Map(),byName=new Map();
  for(const tm of tmRows) {
    const tid=id(tm,"tm");if(!tid)continue;
    for(const [index,k] of [[byDob,dob(tm.date_of_birth||tm.dob||tm.birth_date)],[byName,key(tm)]])if(k){if(!index.has(k))index.set(k,[]);index.get(k).push(tm);}
  }
  const overrides=new Map(decisions.map(d=>[str(d.sm_player_data_id),d]));
  const proposals=[];
  for(const sm of smRows) {
    const sid=id(sm,"sm");if(!sid)continue;
    const override=overrides.get(sid);
    if(override?.status==="rejected"||override?.status==="unresolved"){proposals.push({sm_player_data_id:sid,status:override.status,candidates:[]});continue;}
    const candidates=new Map();
    for(const tm of [...(byDob.get(dob(sm.date_of_birth||sm.dob||sm.birth_date))||[]),...(byName.get(key(sm))||[])])candidates.set(id(tm,"tm"),tm);
    const ranked=[...candidates.values()].map(tm=>({transfermarkt_id:id(tm,"tm"),tbg_player_id:str(tm.tbg_player_id),...score(sm,tm)})).filter(x=>!x.conflicts.length&&x.score>=50).sort((a,b)=>b.score-a.score||a.transfermarkt_id.localeCompare(b.transfermarkt_id));
    const best=ranked[0],second=ranked[1];
    const confirmed=override?.status==="confirmed"&&override.transfermarkt_id;
    proposals.push({sm_player_data_id:sid,status:confirmed?"reviewed":best&&best.score>=85&&(!second||best.score-second.score>=15)&&best.evidence.includes("dob_exact")?"proposed_auto":"review",candidates:ranked.slice(0,5),...(confirmed?{reviewed_transfermarkt_id:str(override.transfermarkt_id)}:{})});
  }
  // A candidate can be claimed by only one SM identity. Conflicts must be reviewed.
  const claims=new Map();
  for(const p of proposals)if(p.status==="proposed_auto"||p.status==="reviewed"){const tid=p.reviewed_transfermarkt_id||p.candidates[0]?.transfermarkt_id;if(!tid)continue;if(!claims.has(tid))claims.set(tid,[]);claims.get(tid).push(p);}
  for(const [tid,rows] of claims)if(rows.length>1)for(const p of rows){p.status="review";p.conflict="duplicate_tm_claim";delete p.reviewed_transfermarkt_id;}
  return {summary:{sm_rows:smRows.length,tm_rows:tmRows.length,proposed_auto:proposals.filter(p=>p.status==="proposed_auto").length,reviewed:proposals.filter(p=>p.status==="reviewed").length,review:proposals.filter(p=>p.status==="review").length,unresolved:proposals.filter(p=>p.status==="unresolved").length},proposals};
}
