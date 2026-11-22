import test from 'node:test';
import assert from 'node:assert/strict';
import { cancellationFixture } from './activity-registration-cancellation.test.mjs';
import { validAnswers } from './activity-form.test.mjs';

export async function editFixture(){
  const f=await cancellationFixture();
  const view=()=>f.call('/api/activity-registration?event_id=event-1',null,'test-member').then(r=>r.json());
  const input=async()=>{const result=await view();return {action:'update_registration',event_id:'event-1',registration_id:result.registration.id,
    edit_revision:result.edit_revision,request_id:crypto.randomUUID(),answers:{...validAnswers,phone:'0911111111'}};};
  const update=(body,token='test-member',extra)=>f.call('/api/activity-registration',body,token,extra);
  return {...f,view,input,update};
}
test('participant edits own answers in place and preserves id, original form snapshot and registration time',async()=>{
  const f=await editFixture();try{
    const before=(await f.view()).registration;assert.equal((await f.view()).can_edit,true);
    const result=await (await f.update(await f.input())).json();assert.equal(result.success,true);assert.equal(result.updated,true);
    assert.equal(result.registration.id,before.id);assert.equal(result.registration.created_at,before.created_at);assert.equal(result.registration.form_revision,before.form_revision);
    assert.equal(result.registration.answers.phone,'0911111111');assert.equal(f.count(),3);
    const audit=f.audits().find(r=>r.event_type==='activity.registration.edit');assert.equal(audit.actor_id,'test-member');
    assert.equal(JSON.parse(audit.raw_json).before.phone,validAnswers.phone);assert.equal(JSON.parse(audit.raw_json).after.phone,'0911111111');
  }finally{f.sqlite.close();}
});
test('edits keep the original schema even when administrators publish a new form version',async()=>{
  const f=await editFixture();try{
    await f.save({revision:1,schema:{fields:[{id:'new',label:'New required field',type:'text',required:true}]}});
    const result=await(await f.update(await f.input())).json();assert.equal(result.success,true);assert.equal(result.registration.form_revision,1);
    assert.equal(result.registration.answers.employee_no,'0001');assert.ok(!Object.hasOwn(result.registration.answers,'new'));
  }finally{f.sqlite.close();}
});
test('editing is idempotent and stale tabs cannot overwrite newer answers',async()=>{
  const f=await editFixture();try{
    const input=await f.input(),stale={...input,request_id:crypto.randomUUID(),answers:{...input.answers,phone:'0922222222'}};
    assert.equal((await f.update(input)).status,200);assert.equal((await(await f.update(input)).json()).replayed,true);
    assert.equal((await f.update(stale)).status,409);assert.equal((await f.view()).registration.answers.phone,'0911111111');
    assert.equal(f.audits().filter(r=>r.event_type==='activity.registration.edit').length,1);
    assert.equal((await f.update({...input,answers:stale.answers})).status,409);
  }finally{f.sqlite.close();}
});
test('anonymous, another participant, forged registration ids and cross-origin edits cannot change answers',async()=>{
  const f=await editFixture();try{
    const input=await f.input();for(const token of ['', 'invalid','another-member'])assert.notEqual((await f.update(input,token)).status,200);
    assert.equal((await f.update({...input,registration_id:'outside'})).status,400);
    assert.equal((await f.update(input,'test-member',{Origin:'https://evil.test'})).status,403);
    assert.equal((await f.view()).registration.answers.phone,validAnswers.phone);assert.equal(f.audits().length,0);
  }finally{f.sqlite.close();}
});
test('server validates edited answers and does not trust client schema or role overrides',async()=>{
  const f=await editFixture();try{
    const input=await f.input();assert.equal((await f.update({...input,answers:{...input.answers,total:999}})).status,400);
    assert.equal((await f.update({...input,answers:{...input.answers,phone:'bad'},schema:{fields:[]},member_type:'admin'})).status,400);
    assert.equal(f.audits().length,0);
  }finally{f.sqlite.close();}
});
test('closed registration, announcements and checked-in participants retain receipts but cannot edit',async()=>{
  for(const kind of ['closed','checked-in','announcement']){const f=await editFixture();try{
    const input=await f.input();
    if(kind==='closed')f.sqlite.exec("UPDATE welfare_activity_events SET registration_end_at='2000-01-01 00:00:00'");
    if(kind==='checked-in')f.sqlite.exec("INSERT INTO welfare_activity_checkins(id,event_id,line_user_id) VALUES('checkin','event-1','test-member')");
    if(kind==='announcement')f.sqlite.exec("CREATE TABLE welfare_activity_club_links(id TEXT,content_json TEXT);INSERT INTO welfare_activity_club_links VALUES('event-1','{\"mode\":\"announcement\"}')");
    assert.equal((await f.view()).can_edit,false);assert.equal((await f.update(input)).status,400);assert.equal(f.audits().length,0);
  }finally{f.sqlite.close();}}
});
test('concurrent check-in, cancellation, member restriction and deadline changes block the atomic edit',async()=>{
  for(const sql of ["INSERT INTO welfare_activity_checkins(id,event_id,line_user_id) VALUES('late','event-1','test-member')","DELETE FROM welfare_activity_registrations WHERE id='one'",
    "UPDATE welfare_members SET status='inactive'","UPDATE welfare_activity_events SET registration_end_at='2000-01-01 00:00:00'"]){const f=await editFixture();try{
    const input=await f.input();f.race(()=>f.sqlite.exec(sql));assert.equal((await f.update(input)).status,409);assert.equal(f.audits().length,0);
  }finally{f.sqlite.close();}}
});
test('audit or transaction failure rolls back all answer changes',async()=>{
  const f=await editFixture();try{
    f.failDelete();assert.equal((await f.update(await f.input())).status,503);
    assert.equal((await f.view()).registration.answers.phone,validAnswers.phone);assert.equal(f.audits().length,0);
  }finally{f.sqlite.close();}
});
