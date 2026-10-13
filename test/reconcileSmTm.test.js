import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePlayerIdentities } from "../src/identity/reconcileSmTm.js";
const sm=(id,name,dob,club="Club A")=>({playerDataId:id,name,date_of_birth:dob,current_club:club});
const tm=(id,name,dob,club="Club A")=>({transfermarkt_id:id,name,date_of_birth:dob,current_club:club});
test("strong DOB, name and club produces an unambiguous proposal",()=>{
 const r=reconcilePlayerIdentities([sm(1,"José García","2000-01-02")],[tm(10,"Jose Garcia","2000-01-02")]);
 assert.equal(r.proposals[0].status,"proposed_auto");
 assert.equal(r.proposals[0].candidates[0].transfermarkt_id,"10");
});
test("contradictory birth dates cannot link",()=>{
 const r=reconcilePlayerIdentities([sm(1,"Alex Smith","2000-01-02")],[tm(10,"Alex Smith","2001-01-02")]);
 assert.equal(r.proposals[0].status,"review");
 assert.equal(r.proposals[0].candidates.length,0);
});
test("same name and birth date across multiple identities requires review",()=>{
 const r=reconcilePlayerIdentities([sm(1,"Alex Smith","2000-01-02")],[tm(10,"Alex Smith","2000-01-02"),tm(11,"Alex Smith","2000-01-02")]);
 assert.equal(r.proposals[0].status,"review");
});
test("two SM identities cannot automatically claim the same TM identity",()=>{
 const r=reconcilePlayerIdentities([sm(1,"Alex Smith","2000-01-02"),sm(2,"Alex Smith","2000-01-02")],[tm(10,"Alex Smith","2000-01-02")]);
 assert.deepEqual(r.proposals.map(x=>x.status),["review","review"]);
});
test("explicit rejection is retained",()=>{
 const r=reconcilePlayerIdentities([sm(1,"Alex Smith","2000-01-02")],[tm(10,"Alex Smith","2000-01-02")],[{sm_player_data_id:"1",status:"rejected"}]);
 assert.equal(r.proposals[0].status,"rejected");
});
