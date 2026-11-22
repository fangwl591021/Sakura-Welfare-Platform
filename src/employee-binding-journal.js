const START='employee.binding.started',COMPLETE='employee.binding.completed';
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function recordBindingStart(db,watch,key){
  const id='binding-start:'+await digest(watch.uid+':'+watch.startEventId);
  await db.prepare(`INSERT OR IGNORE INTO welfare_audit_events(id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
    SELECT ?,'line',?,?,'member',?,'開始櫻花報到',?,? FROM system_settings
    WHERE setting_key=? AND json_extract(setting_value,'$.startEventId')=?`)
    .bind(id,watch.uid,START,watch.uid,JSON.stringify({language:watch.language,event_id:watch.startEventId}),new Date().toISOString(),key,watch.startEventId).run();
}
export async function recordBindingCompletion(db,member,source='mother_sync'){
  if(!member || member.status!=='active' || member.bind_status!=='bound' || !member.employee_no || !['employee','foreign_employee','manager'].includes(member.member_type))return null;
  const id='binding-complete:'+await digest(JSON.stringify([member.line_user_id,member.employee_no,member.mother_reported_at||'']));
  const data={uid:member.line_user_id,name:member.display_name||'',employee_no:member.employee_no,language:member.language||'zh-TW',
    mother_reported_at:member.mother_reported_at||'',synced_at:member.verified_at||'',source,
    notification:{channel:'telegram',state:'pending',attempts:0,next_at:0}};
  await db.prepare(`INSERT OR IGNORE INTO welfare_audit_events(id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
    VALUES(?,'system',?,?,'member',?,'母站綁定已完成並同步',?,?)`)
    .bind(id,member.line_user_id,COMPLETE,member.line_user_id,JSON.stringify(data),new Date().toISOString()).run();
  return id;
}
export async function flushBindingNotifications(db,env,send,now=Date.now()){
  // An interrupted or uncertain send cannot safely be assumed undelivered.
  await db.prepare(`UPDATE welfare_audit_events SET raw_json=json_set(raw_json,'$.notification.state','unknown')
    WHERE event_type=? AND json_extract(raw_json,'$.notification.state')='sending'
      AND COALESCE(json_extract(raw_json,'$.notification.lease_until'),0)<?`).bind(COMPLETE,now).run();
  const rows=await db.prepare(`SELECT id,raw_json FROM welfare_audit_events WHERE event_type=?
    AND json_extract(raw_json,'$.notification.state') IN ('pending','retry','disabled','missing_credentials')
    AND COALESCE(json_extract(raw_json,'$.notification.next_at'),0)<=? ORDER BY created_at LIMIT 5`).bind(COMPLETE,now).all();
  for(const row of rows.results||[]){
    const claimed=await db.prepare(`UPDATE welfare_audit_events SET raw_json=json_set(raw_json,'$.notification.state','sending',
      '$.notification.lease_until',?,'$.notification.attempts',COALESCE(json_extract(raw_json,'$.notification.attempts'),0)+1)
      WHERE id=? AND json_extract(raw_json,'$.notification.state') IN ('pending','retry','disabled','missing_credentials')
      AND COALESCE(json_extract(raw_json,'$.notification.next_at'),0)<=?`)
      .bind(now+90000,row.id,now).run();
    if(!claimed.meta?.changes)continue;
    const data=JSON.parse(row.raw_json);let result;
    try{result=await send(db,env,'telegram_notify_employee_binding',[
      '櫻花員工綁定完成','姓名：'+(data.name||'LINE 使用者'),'工號：'+data.employee_no,
      '語系：'+data.language,'母站報到時間：'+(data.mother_reported_at||'未提供'),'平台同步時間：'+(data.synced_at||'已完成')
    ]);}catch{result={ok:false,status:0};}
    const state=result?.ok?'sent':result?.skipped?(result.reason==='missing_credentials'?'missing_credentials':'disabled')
      :result?.status===429?'retry':result?.status?'failed':'unknown';
    const status=Number(result?.status||0),at=new Date().toISOString();
    await db.prepare(`UPDATE welfare_audit_events SET raw_json=json_set(raw_json,'$.notification.state',?,
      '$.notification.http_status',?,'$.notification.checked_at',?,'$.notification.next_at',?)
      WHERE id=? AND json_extract(raw_json,'$.notification.state')='sending'`)
      .bind(state,status,at,now+(state==='retry'?60000:300000),row.id).run();
  }
}
export async function readBindingHistory(db,lineUserId=''){
  const rows=await db.prepare(`SELECT a.id,a.actor_id,a.event_type,a.summary,a.raw_json,a.created_at,COALESCE(m.display_name,'') AS display_name
    FROM welfare_audit_events a LEFT JOIN welfare_members m ON m.line_user_id=a.target_id
    WHERE a.event_type IN (?,?) ${lineUserId?'AND a.target_id=?':''} ORDER BY a.created_at DESC,a.id DESC LIMIT 100`)
    .bind(START,COMPLETE,...(lineUserId?[lineUserId]:[])).all();
  return (rows.results||[]).map(row=>{
    let data={};try{data=JSON.parse(row.raw_json);}catch{}
    return {id:row.id,line_user_id:row.actor_id,display_name:row.display_name||data.name||'',event_type:row.event_type,
      summary:row.summary,created_at:row.created_at,language:data.language||'',employee_no:data.employee_no||'',
      mother_reported_at:data.mother_reported_at||'',synced_at:data.synced_at||'',
      notification_state:data.notification?.state||'',notification_at:data.notification?.checked_at||''};
  });
}
