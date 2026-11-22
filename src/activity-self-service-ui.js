import {normalizeActivityLocale} from './activity-locale.js';

export const MY_REGISTRATION_COPY={
  zh:{title:'本人報名',all:'查看全部報名',cancellable:'自行取消報名',loading:'正在讀取本人報名…',login:'登入 LINE 查看本人報名',loginNeeded:'登入 LINE 後即可查看自己的報名紀錄。',failed:'目前無法讀取本人報名，請稍後重新載入。',empty:'目前沒有報名紀錄。',emptyCancellable:'目前沒有可以自行取消的報名。',registered:'已報名',cancelled:'已取消',created:'報名時間',cancelledAt:'取消時間',details:'查看報名內容',open:'查看／修改報名',cancel:'取消這筆報名',confirm:'確認取消報名',keep:'保留報名',confirmText:'確定取消以下活動的本人報名？取消後若要再次參加，仍須符合活動報名資格與期限。',sending:'正在取消報名，請勿重複操作…',done:'報名已取消。',uncertain:'取消結果尚未確認。請先查詢結果，勿重新發起其他取消。',check:'查詢取消結果',retryOriginal:'再次確認原取消操作',notFound:'尚未查到已完成結果；若要重試，將沿用原操作識別。',changed:'報名狀態已變更，請重新載入後確認。',reload:'重新載入',previous:'上一頁',next:'下一頁',page:'頁',total:'筆報名',close:'關閉',detailsUnavailable:'報名內容較多，請開啟原報名頁查看。',cancelledDetailsUnavailable:'資料較多，請聯絡管理員查詢。',authBusy:'正在確認 LINE 登入狀態，請稍候再點選登入。',blocked:{checked_in:'已簽到，不能取消。',event_started:'活動已開始，不能自行取消。',event_unavailable:'此活動目前不提供自行取消。',identity_restricted:'目前身分不符合自行取消資格。',cancelled:'已取消。'}},
  id:{title:'Pendaftaran saya',all:'Lihat semua pendaftaran',cancellable:'Batalkan pendaftaran sendiri',loading:'Memuat pendaftaran saya…',login:'Masuk LINE untuk melihat pendaftaran',loginNeeded:'Masuk LINE untuk melihat pendaftaran Anda sendiri.',failed:'Pendaftaran tidak dapat dimuat. Coba muat ulang nanti.',empty:'Belum ada riwayat pendaftaran.',emptyCancellable:'Tidak ada pendaftaran yang dapat dibatalkan.',registered:'Terdaftar',cancelled:'Dibatalkan',created:'Waktu pendaftaran',cancelledAt:'Waktu pembatalan',details:'Lihat isi pendaftaran',open:'Lihat / ubah pendaftaran',cancel:'Batalkan pendaftaran ini',confirm:'Konfirmasi pembatalan',keep:'Pertahankan pendaftaran',confirmText:'Batalkan pendaftaran Anda untuk kegiatan ini? Pendaftaran ulang tetap mengikuti persyaratan dan batas pendaftaran.',sending:'Membatalkan pendaftaran. Jangan ulangi tindakan…',done:'Pendaftaran telah dibatalkan.',uncertain:'Hasil pembatalan belum dikonfirmasi. Periksa hasil sebelum membuat pembatalan lain.',check:'Periksa hasil pembatalan',retryOriginal:'Konfirmasi ulang tindakan awal',notFound:'Hasil selesai belum ditemukan. Percobaan ulang memakai identitas tindakan yang sama.',changed:'Status pendaftaran berubah. Muat ulang sebelum melanjutkan.',reload:'Muat ulang',previous:'Sebelumnya',next:'Berikutnya',page:'Halaman',total:'pendaftaran',close:'Tutup',detailsUnavailable:'Isi pendaftaran terlalu panjang. Buka halaman pendaftaran asli.',cancelledDetailsUnavailable:'Data terlalu panjang. Hubungi administrator untuk melihatnya.',authBusy:'Status masuk LINE sedang diperiksa. Tunggu sebentar, lalu pilih masuk lagi.',blocked:{checked_in:'Sudah check-in dan tidak dapat dibatalkan.',event_started:'Kegiatan sudah dimulai dan tidak dapat dibatalkan sendiri.',event_unavailable:'Kegiatan ini tidak menyediakan pembatalan sendiri.',identity_restricted:'Identitas saat ini tidak memenuhi syarat pembatalan.',cancelled:'Sudah dibatalkan.'}},
  th:{title:'การลงทะเบียนของฉัน',all:'ดูการลงทะเบียนทั้งหมด',cancellable:'ยกเลิกการลงทะเบียนด้วยตนเอง',loading:'กำลังโหลดการลงทะเบียนของฉัน…',login:'เข้าสู่ระบบ LINE เพื่อดูการลงทะเบียน',loginNeeded:'เข้าสู่ระบบ LINE เพื่อดูการลงทะเบียนของคุณเอง',failed:'โหลดการลงทะเบียนไม่ได้ โปรดลองโหลดใหม่ภายหลัง',empty:'ยังไม่มีประวัติการลงทะเบียน',emptyCancellable:'ไม่มีการลงทะเบียนที่ยกเลิกได้ในขณะนี้',registered:'ลงทะเบียนแล้ว',cancelled:'ยกเลิกแล้ว',created:'เวลาลงทะเบียน',cancelledAt:'เวลายกเลิก',details:'ดูข้อมูลการลงทะเบียน',open:'ดู / แก้ไขการลงทะเบียน',cancel:'ยกเลิกการลงทะเบียนนี้',confirm:'ยืนยันการยกเลิก',keep:'เก็บการลงทะเบียนไว้',confirmText:'ต้องการยกเลิกการลงทะเบียนของคุณสำหรับกิจกรรมนี้หรือไม่? การลงทะเบียนใหม่ยังต้องเป็นไปตามคุณสมบัติและกำหนดเวลา',sending:'กำลังยกเลิกการลงทะเบียน โปรดอย่าทำรายการซ้ำ…',done:'ยกเลิกการลงทะเบียนแล้ว',uncertain:'ยังยืนยันผลการยกเลิกไม่ได้ โปรดตรวจสอบผลก่อนเริ่มการยกเลิกรายการอื่น',check:'ตรวจสอบผลการยกเลิก',retryOriginal:'ยืนยันการทำรายการเดิมอีกครั้ง',notFound:'ยังไม่พบผลที่เสร็จสมบูรณ์ การลองใหม่จะใช้รหัสรายการเดิม',changed:'สถานะการลงทะเบียนเปลี่ยนไป โปรดโหลดใหม่ก่อนดำเนินการ',reload:'โหลดใหม่',previous:'ก่อนหน้า',next:'ถัดไป',page:'หน้า',total:'รายการ',close:'ปิด',detailsUnavailable:'ข้อมูลการลงทะเบียนมีจำนวนมาก โปรดเปิดหน้าลงทะเบียนเดิม',cancelledDetailsUnavailable:'ข้อมูลมีจำนวนมาก โปรดติดต่อผู้ดูแลระบบเพื่อสอบถาม',authBusy:'กำลังตรวจสอบสถานะเข้าสู่ระบบ LINE โปรดรอสักครู่แล้วกดเข้าสู่ระบบอีกครั้ง',blocked:{checked_in:'เช็กอินแล้ว ไม่สามารถยกเลิกได้',event_started:'กิจกรรมเริ่มแล้ว ไม่สามารถยกเลิกด้วยตนเองได้',event_unavailable:'กิจกรรมนี้ไม่เปิดให้ยกเลิกด้วยตนเอง',identity_restricted:'สถานะผู้ใช้ปัจจุบันไม่มีสิทธิ์ยกเลิก',cancelled:'ยกเลิกแล้ว'}}
};

export function myRegistrationsPanel(language){
  const c=MY_REGISTRATION_COPY[normalizeActivityLocale(language)];
  return `<section id="my-activity-registrations" aria-labelledby="mar-heading"><div class="mar-heading"><h2 id="mar-heading">${c.title}</h2><button id="mar-reload" type="button">${c.reload}</button></div><div class="mar-tabs" role="tablist" aria-label="${c.title}"><button id="mar-tab-all" type="button" role="tab" aria-selected="true" aria-controls="mar-list">${c.all}</button><button id="mar-tab-cancellable" type="button" role="tab" aria-selected="false" tabindex="-1" aria-controls="mar-list">${c.cancellable}</button></div><p id="mar-status" role="status" aria-live="polite"></p><button id="mar-login" type="button" hidden>${c.login}</button><div class="mar-pending" id="mar-pending" hidden><p>${c.uncertain}</p><button id="mar-check-result" type="button">${c.check}</button><button id="mar-retry-original" type="button" hidden>${c.retryOriginal}</button></div><div id="mar-list" role="tabpanel" aria-labelledby="mar-tab-all"></div><nav class="mar-pagination" aria-label="${c.page}" id="mar-pagination" hidden><button id="mar-previous" type="button">${c.previous}</button><span id="mar-page"></span><button id="mar-next" type="button">${c.next}</button></nav><dialog id="mar-cancel-dialog" aria-labelledby="mar-confirm-heading"><h3 id="mar-confirm-heading">${c.confirm}</h3><p>${c.confirmText}</p><strong id="mar-confirm-event"></strong><p id="mar-confirm-date"></p><div class="mar-confirm-actions"><button id="mar-keep-registration" type="button">${c.keep}</button><button id="mar-confirm-cancel" type="button">${c.confirm}</button></div><p id="mar-confirm-status" role="status" aria-live="polite"></p></dialog></section>`;
}

export const installMyRegistrations=String.raw`function installMyRegistrations(locale,copy,auth){
  const root=document.getElementById('my-activity-registrations');if(!root||root.dataset.installed)return;root.dataset.installed='1';
  const $=id=>document.getElementById(id),list=$('mar-list'),status=$('mar-status'),dialog=$('mar-cancel-dialog');
  const storageKey='sakura_activity_cancel_pending';
  let view='all',page=1,pages=1,loaded=false,loading=false,cancelling=false,sequence=0,pending=null,retryItem=null,selected=null;
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;return el;};
  const date=value=>{if(!value)return '';let raw=String(value).replace(' ','T');if(!/(Z|[+-]\d{2}:\d{2})$/i.test(raw))raw+='+08:00';const d=new Date(raw);return Number.isFinite(d.getTime())?d.toLocaleString({zh:'zh-TW',id:'id-ID',th:'th-TH'}[locale],{timeZone:'Asia/Taipei'}):String(value);};
  const message=(text,error=false)=>{status.textContent=text;status.setAttribute('role',error?'alert':'status');};
  function remember(value){pending=value;retryItem=null;try{if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey);}catch{}$('mar-pending').hidden=!pending;$('mar-retry-original').hidden=true;}
  try{const value=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(value&&/^[0-9a-f-]{36}$/i.test(value.request_id||'')&&typeof value.registration_id==='string'&&typeof value.event_id==='string'&&/^[0-9a-f]{64}$/i.test(value.cancel_revision||''))remember(value);}catch{}
  async function identity(){
    await auth.initialize();const token=auth.token();
    if(!token){const error=new Error(copy.loginNeeded);error.status=401;throw error;}return token;
  }
  async function api(query={},body){
    const token=await identity(),params=new URLSearchParams({lang:locale,...query});
    const response=await fetch('/api/my-activity-registrations?'+params,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok||!result.success){const error=new Error([401,403].includes(response.status)?copy.loginNeeded:locale==='zh'&&result.message?result.message:copy.changed);error.status=response.status;throw error;}return result;
  }
  function lock(){
    $('mar-reload').disabled=loading||cancelling;$('mar-check-result').disabled=loading||cancelling;$('mar-retry-original').disabled=loading||cancelling;
    $('mar-previous').disabled=loading||cancelling||page<=1;$('mar-next').disabled=loading||cancelling||page>=pages;
    for(const button of root.querySelectorAll('[data-my-registration-cancel]'))button.disabled=loading||cancelling||!!pending;
    $('mar-tab-all').disabled=cancelling;$('mar-tab-cancellable').disabled=cancelling;
    $('mar-confirm-cancel').disabled=cancelling;$('mar-keep-registration').disabled=cancelling;
  }
  function failure(error){if([401,403].includes(error.status)){list.replaceChildren();$('mar-login').hidden=false;}message(error.status?error.message:copy.failed,true);}
  function render(result){
    page=result.page||1;pages=result.pages||1;list.replaceChildren();
    for(const item of result.registrations||[]){
      const card=node('article');card.className='mar-card';card.dataset.registrationId=item.id;if(item.history_id)card.dataset.historyId=item.history_id;
      const cancelled=item.status==='cancelled',badge=node('span',cancelled?copy.cancelled:copy.registered);badge.className='mar-badge';badge.dataset.state=cancelled?'cancelled':'registered';
      card.append(node('h3',item.event.title),badge,node('p',[date(item.event.start_at),item.event.location].filter(Boolean).join(' · ')),node('p',copy.created+'：'+date(item.created_at)));
      if(cancelled&&item.cancelled_at)card.append(node('p',copy.cancelledAt+'：'+date(item.cancelled_at)));
      if(item.schema?.fields&&item.answers){const details=node('details'),dl=node('dl');details.append(node('summary',copy.details));for(const field of item.schema.fields)if(Object.hasOwn(item.answers,field.id)){dl.append(node('dt',field.label),node('dd',Array.isArray(item.answers[field.id])?item.answers[field.id].join('、'):String(item.answers[field.id])));}details.append(dl);card.append(details);}
      if(item.details_available===false)card.append(node('p',cancelled?copy.cancelledDetailsUnavailable:copy.detailsUnavailable));
      if(!cancelled){const link=node('a',copy.open);link.href='/activity-registration?'+new URLSearchParams({event_id:item.event.id,lang:locale});card.append(link);}
      if(view==='cancellable'&&!cancelled&&item.can_cancel){const button=node('button',copy.cancel);button.type='button';button.dataset.myRegistrationCancel=item.id;button.onclick=()=>openConfirmation(item);card.append(button);}
      else if(!cancelled&&!item.can_cancel){const text=copy.blocked[item.cancel_block_reason]||(locale==='zh'?item.cancel_block_message:'')||copy.blocked.event_unavailable;card.append(node('p',text));}
      list.append(card);
    }
    if(!list.children.length)list.append(node('p',view==='cancellable'?copy.emptyCancellable:copy.empty));
    $('mar-pagination').hidden=pages<=1;$('mar-page').textContent=copy.page+' '+page+' / '+pages;
    message(String(result.total??result.registrations?.length??0)+' '+copy.total);
  }
  async function load(nextPage=page){
    if(cancelling)return;const serial=++sequence;loading=true;lock();message(copy.loading);$('mar-login').hidden=true;
    try{const result=await api({page:String(nextPage),...(view==='cancellable'?{filter:'cancellable'}:{})});if(serial!==sequence)return;render(result);loaded=true;}
    catch(error){if(serial===sequence)failure(error);}finally{if(serial===sequence){loading=false;lock();}}
  }
  function openConfirmation(item,original=false){
    if(cancelling||loading||(!original&&pending))return;selected={item,original};$('mar-confirm-event').textContent=item.event.title;$('mar-confirm-date').textContent=date(item.event.start_at);$('mar-confirm-status').textContent='';
    if(typeof dialog.showModal==='function')dialog.showModal();else if(confirm(copy.confirmText+'\n'+item.event.title))cancelSelected();
  }
  async function cancelSelected(){
    if(cancelling||!selected)return;const {item,original}=selected;
    const operation=original?pending:{action:'cancel_registration',registration_id:item.id,event_id:item.event.id,cancel_revision:item.cancel_revision,request_id:crypto.randomUUID(),confirmed:true};
    if(!operation)return;remember(operation);cancelling=true;lock();$('mar-confirm-status').textContent=copy.sending;
    try{await api({},operation);remember(null);if(dialog.open)dialog.close();message(copy.done);cancelling=false;await load(page);message(copy.done);}
    catch(error){if(dialog.open)dialog.close();if(error.status&&error.status<500){remember(null);failure(error);cancelling=false;await load(page);failure(error);}else{message(copy.uncertain,true);}}
    finally{cancelling=false;selected=null;lock();}
  }
  async function checkResult(){
    if(!pending||loading||cancelling)return;loading=true;lock();message(copy.loading);
    try{const result=await api({request_id:pending.request_id});if(result.operation?.status==='cancelled'){remember(null);loading=false;await load(page);message(copy.done);return;}
      const current=await api({registration_id:pending.registration_id});const item=(current.registrations||[]).find(row=>row.id===pending.registration_id&&row.status!=='cancelled');
      retryItem=item?.can_cancel?item:null;$('mar-retry-original').hidden=!retryItem;message(copy.notFound,true);
    }catch(error){failure(error);}finally{loading=false;lock();}
  }
  function select(next){if(cancelling)return;view=next;page=1;loaded=false;list.replaceChildren();for(const name of ['all','cancellable']){const tab=$('mar-tab-'+name);tab.setAttribute('aria-selected',String(name===view));tab.tabIndex=name===view?0:-1;}$('mar-list').setAttribute('aria-labelledby','mar-tab-'+view);load(1);}
  $('mar-tab-all').onclick=()=>select('all');$('mar-tab-cancellable').onclick=()=>select('cancellable');
  root.querySelector('.mar-tabs').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();select(event.key==='Home'?'all':event.key==='End'?'cancellable':view==='all'?'cancellable':'all');$('mar-tab-'+view).focus();};
  $('mar-previous').onclick=()=>load(page-1);$('mar-next').onclick=()=>load(page+1);$('mar-reload').onclick=()=>load(page);
  $('mar-keep-registration').onclick=()=>{if(!cancelling){dialog.close();selected=null;}};$('mar-confirm-cancel').onclick=cancelSelected;dialog.addEventListener('cancel',event=>{if(cancelling)event.preventDefault();else selected=null;});
  $('mar-check-result').onclick=checkResult;$('mar-retry-original').onclick=()=>retryItem&&openConfirmation(retryItem,true);
  $('mar-login').onclick=()=>{if(auth.login()===false)message(copy.authBusy,true);};
  const section=$('fa-section');const maybeLoad=()=>{if(!section.hidden&&!section.classList.contains('stories-active')&&!loaded&&!loading)load(1);};
  new MutationObserver(maybeLoad).observe(section,{attributes:true,attributeFilter:['hidden','class']});window.addEventListener('sakura-stories-show',maybeLoad);maybeLoad();lock();
}`;

export const myRegistrationsCss=`<style>
  #fa-section.stories-active>#my-activity-registrations{display:none!important}
  #my-activity-registrations{border-bottom:1px solid #dbe3ee;padding-bottom:24px;margin-bottom:24px;min-width:0}.mar-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.mar-heading h2{font-size:20px!important}.mar-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:16px 0}.mar-tabs button{min-width:0;white-space:normal;overflow-wrap:anywhere;line-height:1.5}.mar-tabs [aria-selected=true]{background:#c8103d!important;color:#fff!important;border-color:#c8103d!important}#mar-status{white-space:pre-wrap;line-height:1.6;overflow-wrap:anywhere}#mar-status[role=alert]{color:#9a3412}#mar-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.mar-card{border:1px solid #dbe3ee;border-radius:8px;padding:14px;background:#fff;overflow-wrap:anywhere}.mar-card h3{font-size:18px;margin:0 0 8px;line-height:1.5}.mar-card p{font-size:14px;line-height:1.6;white-space:pre-wrap}.mar-card a{display:inline-flex;align-items:center;min-height:44px;padding:8px 0;margin-right:12px;color:#1661ab}.mar-card button{color:#b91c1c!important;background:#fff1f2!important;display:block}.mar-card summary{cursor:pointer;min-height:44px;padding:10px 0}.mar-card dt{font-weight:600}.mar-card dd{margin:4px 0 12px;white-space:pre-wrap}.mar-badge{display:inline-block;background:#e8f8ee;color:#146c43;border-radius:4px;padding:4px 8px;font-size:13px}.mar-badge[data-state=cancelled]{background:#f1f5f9;color:#475569}.mar-pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px}.mar-pending{background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:12px;margin:12px 0;line-height:1.6}.mar-pending button{margin:4px;white-space:normal}.mar-tabs button:focus-visible,.mar-card a:focus-visible,#my-activity-registrations button:focus-visible{outline:3px solid #1661ab;outline-offset:2px}#mar-cancel-dialog{width:min(520px,calc(100vw - 24px));max-height:90dvh;padding:20px;border:1px solid #cad5df;border-radius:10px;color:#17212b;overflow:auto}#mar-cancel-dialog::backdrop{background:#14233380}#mar-cancel-dialog p{line-height:1.6;overflow-wrap:anywhere}#mar-confirm-event{display:block;overflow-wrap:anywhere;line-height:1.6}.mar-confirm-actions{display:flex;flex-wrap:wrap;gap:8px}#mar-confirm-cancel{background:#b91c1c!important;color:#fff!important;border-color:#b91c1c!important}#my-activity-registrations button:disabled{opacity:.5;cursor:wait}@media(max-width:540px){#mar-list{grid-template-columns:1fr}.mar-tabs button{padding:8px!important;font-size:14px!important}.mar-heading{align-items:flex-start}.mar-heading h2{font-size:18px!important}.mar-heading button{font-size:13px!important;flex:none}}
</style>`;
