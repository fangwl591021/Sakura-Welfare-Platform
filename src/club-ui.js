import { normalizeActivityLocale, ACTIVITY_COPY } from './activity-locale.js';

export const CLUB_COPY = {
  zh:{title:'社團資訊',all:'全部社團',search:'搜尋社團、活動、花絮',active:'已成立',preparing:'籌備中',paused:'暫停',description:'社團介紹',contact:'聯絡窗口',join_rules:'加入規則',events:'活動資訊',gallery:'活動花絮',empty:'目前沒有符合條件的內容。',none:'尚未提供',loading:'載入中…',failed:'無法載入，請稍後重試。',employee:'登入 LINE 查看員工限定內容',announcement:'活動公告',unconfigured:'尚未開放報名',open:'開放報名中',not_started:'尚未開放報名',closed:'報名已截止',unavailable:'活動已結束',video:'開啟影片',photos:'照片',club:'社團活動',company:'公司活動',esg:'ESG 活動',charity:'公益活動',original:'內容以發布者提供的語言顯示。'},
  id:{title:'Informasi klub',all:'Semua klub',search:'Cari klub, kegiatan, foto',active:'Aktif',preparing:'Dalam persiapan',paused:'Ditunda',description:'Tentang klub',contact:'Kontak',join_rules:'Ketentuan bergabung',events:'Kegiatan',gallery:'Dokumentasi kegiatan',empty:'Belum ada konten yang sesuai.',none:'Belum tersedia',loading:'Memuat…',failed:'Tidak dapat dimuat. Coba lagi.',employee:'Masuk dengan LINE untuk konten karyawan',announcement:'Pengumuman kegiatan',unconfigured:'Pendaftaran belum dibuka',open:'Pendaftaran dibuka',not_started:'Pendaftaran belum dibuka',closed:'Pendaftaran ditutup',unavailable:'Kegiatan selesai',video:'Buka video',photos:'Foto',club:'Kegiatan klub',company:'Kegiatan perusahaan',esg:'Kegiatan ESG',charity:'Kegiatan sosial',original:'Konten ditampilkan dalam bahasa yang diberikan penerbit.'},
  th:{title:'ข้อมูลชมรม',all:'ทุกชมรม',search:'ค้นหาชมรม กิจกรรม รูปภาพ',active:'จัดตั้งแล้ว',preparing:'กำลังจัดเตรียม',paused:'พักชั่วคราว',description:'เกี่ยวกับชมรม',contact:'ผู้ติดต่อ',join_rules:'กติกาการเข้าร่วม',events:'ข้อมูลกิจกรรม',gallery:'ภาพกิจกรรม',empty:'ยังไม่มีข้อมูลที่ตรงกัน',none:'ยังไม่มีข้อมูล',loading:'กำลังโหลด…',failed:'โหลดไม่ได้ กรุณาลองใหม่',employee:'เข้าสู่ระบบ LINE เพื่อดูข้อมูลสำหรับพนักงาน',announcement:'ประกาศกิจกรรม',unconfigured:'ยังไม่เปิดรับลงทะเบียน',open:'เปิดรับลงทะเบียน',not_started:'ยังไม่เปิดรับลงทะเบียน',closed:'ปิดรับลงทะเบียนแล้ว',unavailable:'กิจกรรมสิ้นสุดแล้ว',video:'เปิดวิดีโอ',photos:'รูปภาพ',club:'กิจกรรมชมรม',company:'กิจกรรมบริษัท',esg:'กิจกรรม ESG',charity:'กิจกรรมเพื่อสังคม',original:'เนื้อหาแสดงตามภาษาที่ผู้เผยแพร่ระบุ'}
};
Object.assign(CLUB_COPY.zh,{album:'活動相簿',openAlbum:'開啟相簿',previous:'上一批',next:'下一批'});
Object.assign(CLUB_COPY.id,{album:'Album kegiatan',openAlbum:'Buka album',previous:'Sebelumnya',next:'Berikutnya'});
Object.assign(CLUB_COPY.th,{album:'อัลบั้มกิจกรรม',openAlbum:'เปิดอัลบั้ม',previous:'ก่อนหน้า',next:'ถัดไป'});
Object.assign(CLUB_COPY.zh,{cover:'社團封面',aiCover:'AI 預設配圖',coverUnavailable:'圖片暫時無法顯示'});
Object.assign(CLUB_COPY.id,{cover:'Sampul klub',aiCover:'Ilustrasi bawaan AI',coverUnavailable:'Gambar belum tersedia'});
Object.assign(CLUB_COPY.th,{cover:'ภาพปกชมรม',aiCover:'ภาพประกอบเริ่มต้นจาก AI',coverUnavailable:'ยังแสดงรูปภาพไม่ได้'});
export const clubCss = `<style>
 .app.club-wide{max-width:1200px}
 .club-area{padding:18px;background:#fff;color:#17212b;letter-spacing:0}.club-area [hidden]{display:none!important}.club-area *{box-sizing:border-box;min-width:0;overflow-wrap:anywhere}
 .club-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}.club-toolbar h2{font-size:22px;margin:0;flex:1}
 .club-area button,.club-area select,.club-area input,.club-area a.club-action{font:inherit;border:1px solid #cad5df;border-radius:6px;background:#fff;color:#17212b;min-height:44px;padding:9px 12px}
 .club-area button{cursor:pointer}.club-area a.club-action{display:inline-flex;align-items:center;text-decoration:none}.club-filters{display:grid;grid-template-columns:1fr 220px;gap:10px;margin-bottom:12px}
 .club-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:16px}.club-card{border:1px solid #dbe3ee;border-radius:8px;padding:16px;background:#fff;text-align:left}
 .club-card h3{font-size:18px;line-height:1.5;margin:0 0 8px}.club-card p{font-size:14px;line-height:1.65;white-space:pre-wrap;color:#536575}.club-card dl{margin:16px 0 0}.club-card dt{font-weight:600;font-size:14px}.club-card dd{margin:4px 0 12px;white-space:pre-wrap;line-height:1.6;font-size:14px}
 #club-list{grid-template-columns:1fr}.club-card.club-profile{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);padding:0;overflow:hidden;border-radius:14px}.club-profile-copy{padding:24px}.club-profile h3{font-size:22px}.club-cover{position:relative;margin:0;min-height:280px;background:#edf3f1}.club-cover img{display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.club-cover figcaption{position:absolute;bottom:14px;left:14px;max-width:calc(100% - 28px);border-radius:6px;background:#fffE;padding:6px 10px;font-size:12px;color:#3e515d}.club-cover.cover-unavailable{display:grid;place-items:center}.club-cover.cover-unavailable figcaption{position:static;background:transparent}
 .club-badge{display:inline-block;max-width:100%;font-size:13px;border-radius:4px;padding:4px 8px;background:#e8f8ee;color:#146c43}.club-badge[data-state=preparing],.club-badge[data-state=not_started],.club-badge[data-state=unconfigured]{background:#fff3cd;color:#805500}.club-badge[data-state=closed],.club-badge[data-state=paused],.club-badge[data-state=unavailable]{background:#f1f2f4;color:#565e67}
 .club-area h2.club-section-title{font-size:20px;margin:28px 0 12px}.club-photos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:12px 0}.club-photos button{padding:0;overflow:hidden;aspect-ratio:4/3}.club-photos img{display:block;width:100%;height:100%;object-fit:cover}
 .club-viewer{padding:16px;border:1px solid #cad5df;border-radius:8px;width:min(94vw,960px);max-height:94vh}.club-viewer::backdrop{background:#0009}.club-viewer button{float:right;font-size:20px;width:44px;height:44px}.club-viewer img{display:block;width:100%;max-height:75vh;object-fit:contain}.club-viewer p{margin:8px 0}
 .club-area :focus-visible{outline:3px solid #1661ab;outline-offset:2px}.club-message{min-height:24px}.club-login-slot{min-height:56px}#club-list:empty{min-height:650px}.club-message[data-error=true]{border-left:4px solid #c8103d;background:#fff0f2;color:#9f1335;padding:12px}
 @media(max-width:700px){.club-card.club-profile{grid-template-columns:1fr}.club-cover{order:-1;aspect-ratio:4/3;min-height:0}.club-profile-copy{padding:18px}}
 @media(max-width:600px){.club-filters{grid-template-columns:1fr}.club-grid{grid-template-columns:1fr}.club-area{padding:16px}.club-toolbar h2{flex-basis:70%}}
 </style>`;

export function clubPanel(language) {
  const locale = normalizeActivityLocale(language), c = CLUB_COPY[locale], a = ACTIVITY_COPY[locale];
  return `<style>.club-card>.club-photos{grid-template-columns:1fr}.club-card>.club-photos button{aspect-ratio:auto;min-height:44px}.club-card>.club-photos img{height:180px;object-fit:cover}#club-album{overflow:auto}#club-album .club-photos button{float:none;width:100%;height:auto;aspect-ratio:4/3}#club-album .club-photos img{height:100%;max-height:none;object-fit:cover}#club-album nav{display:flex;justify-content:space-between;gap:12px}#club-album nav button{float:none;width:auto;min-height:44px}</style><section id="club-section" class="club-area"><div class="club-toolbar"><h2>${c.title}</h2><button type="button" id="club-refresh" title="${a.retry}" aria-label="${a.retry}">↻</button></div>
    <div class="club-filters"><input id="club-search" type="search" aria-label="${c.search}" placeholder="${c.search}"><select id="club-filter" aria-label="${c.all}"><option value="">${c.all}</option></select></div>
    <p class="club-message" id="club-message" role="status" aria-live="polite"></p><div class="club-login-slot"><button type="button" id="club-login">${c.employee}</button></div>
    <div class="club-grid" id="club-list"></div><h2 class="club-section-title" id="club-events-title" hidden>${c.events}</h2><div class="club-grid" id="club-events" hidden></div>
    <h2 class="club-section-title" id="club-galleries-title" hidden>${c.gallery}</h2><div class="club-grid" id="club-galleries" hidden></div>
    <dialog class="club-viewer" id="club-album" aria-label="${c.album}"><button type="button" id="club-album-close" aria-label="${a.close}">×</button><h3 id="club-album-title"></h3><p id="club-album-description"></p><p id="club-album-count" role="status"></p><div class="club-photos" id="club-album-photos"></div><nav><button id="club-album-prev" type="button">${c.previous}</button><button id="club-album-next" type="button">${c.next}</button></nav></dialog>
    <dialog class="club-viewer" id="club-viewer" aria-label="${c.photos}"><button type="button" id="club-viewer-close" aria-label="${a.close}" title="${a.close}">×</button><p id="club-photo-title"></p><img id="club-photo-large" alt=""></dialog></section>`;
}

export const clubBrowser = String.raw`function installClubs(locale,copy,activity) {
 const root=document.getElementById('club-section');if(!root)return;
 const q=s=>root.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text||'';return n;};
 let data={clubs:[],events:[],galleries:[]},token='',ready=false,busy=false,identityJob,generation=0,urls=[],opener=null,albumOpener=null,album=null,albumPage=0,albumGeneration=0,albumUrls=[],jobs=[],running=0,controllers=new Set(),observer=null;
 const status=q('#club-message'),login=q('#club-login'),search=q('#club-search'),filter=q('#club-filter');
 const stamp=value=>{if(!value)return '';const d=new Date(value.replace(' ','T')+(/(Z|[+-]\d{2}:\d{2})$/.test(value)?'':'+08:00'));return Number.isFinite(d.getTime())?d.toLocaleString(activity.dateLocale,{timeZone:'Asia/Taipei'}):value;};
 function clearAlbum(){albumGeneration++;for(const url of albumUrls)URL.revokeObjectURL(url);albumUrls=[];q('#club-album-photos').replaceChildren();q('#club-viewer').close();}
 function clearImages(){generation++;observer?.disconnect();jobs=[];for(const controller of controllers)controller.abort();for(const url of urls)URL.revokeObjectURL(url);urls=[];clearAlbum();q('#club-album').close();q('#club-viewer').close();q('#club-photo-large').removeAttribute('src');}
 function photo(id,img,button,version,isAlbum=false){const expected=albumGeneration;const run=async()=>{
  if(version!==generation||(isAlbum&&expected!==albumGeneration))return;const controller=new AbortController();controllers.add(controller);
  try{const response=await fetch('/club-media/'+encodeURIComponent(id),{headers:token?{Authorization:'Bearer '+token}:{},signal:controller.signal});if(!response.ok)throw new Error();const blob=await response.blob();if(version!==generation||(isAlbum&&expected!==albumGeneration))return;const url=URL.createObjectURL(blob);(isAlbum?albumUrls:urls).push(url);img.src=url;
   if(isAlbum)button.onclick=()=>{opener=button;q('#club-photo-title').textContent=img.alt;q('#club-photo-large').src=url;q('#club-viewer').showModal();};
  }catch(e){if(e.name!=='AbortError'&&version===generation&&(!isAlbum||expected===albumGeneration)){img.alt=copy.failed;status.textContent=copy.failed;status.dataset.error='true';}}finally{controllers.delete(controller);}
 };jobs.push(run);pump();}
 function pump(){while(running<2&&jobs.length){running++;const job=jobs.shift();job().finally(()=>{running--;pump();});}}
 function albumPhotos(){clearAlbum();const start=albumPage*24,end=Math.min(start+24,album.media_ids.length),photos=q('#club-album-photos');q('#club-album-count').textContent=(album.media_ids.length?start+1:0)+'–'+end+' / '+album.media_ids.length+' '+copy.photos;q('#club-album-prev').disabled=albumPage===0;q('#club-album-next').disabled=end>=album.media_ids.length;
  for(let index=start;index<end;index++){const button=el('button');button.type='button';button.setAttribute('aria-label',copy.photos+' '+(index+1));const img=el('img');img.alt=album.title+' '+(index+1);button.append(img);photos.append(button);photo(album.media_ids[index],img,button,generation,true);}
 }
 function openAlbum(item,button){album=item;albumPage=0;albumOpener=button;q('#club-album-title').textContent=item.title;q('#club-album-description').textContent=item.description;q('#club-album').showModal();albumPhotos();}
 function badge(state){const n=el('span',copy[state]||state);n.className='club-badge';n.dataset.state=state;return n;}
 function render(){clearImages();const version=generation;const term=search.value.trim().toLowerCase(),selected=filter.value;
  const matches=item=>(!selected||(item.club_id||item.id)===selected)&&(!term||[item.title,item.description,item.contact,item.join_rules].join(' ').toLowerCase().includes(term));
  const clubs=q('#club-list'),events=q('#club-events'),galleries=q('#club-galleries');for(const n of [clubs,events,galleries])n.replaceChildren();
  for(const item of data.clubs.filter(matches)){const card=el('article');card.className='club-card club-profile';const details=el('div');details.className='club-profile-copy';details.append(el('h3',item.title),badge(item.status));const dl=el('dl');
   for(const key of ['description','contact','join_rules'])dl.append(el('dt',copy[key]),el('dd',item[key]||copy.none));details.append(dl);
   const figure=el('figure');figure.className='club-cover';const img=el('img');img.alt=item.title+' — '+copy.cover;img.loading='lazy';img.decoding='async';img.width=960;img.height=720;const caption=el('figcaption',item.cover_is_default?copy.aiCover:copy.cover);let fallback=item.cover_is_default;
   img.onerror=()=>{if(!fallback&&item.cover_default_url){fallback=true;caption.textContent=copy.aiCover;img.src=item.cover_default_url;}else{img.hidden=true;figure.classList.add('cover-unavailable');caption.textContent=copy.coverUnavailable;}};
   if(item.cover_url)img.src=item.cover_url;else{img.hidden=true;figure.classList.add('cover-unavailable');caption.textContent=copy.coverUnavailable;}
   figure.append(img,caption);card.append(details,figure);clubs.append(card);}
  for(const item of data.events.filter(matches)){const card=el('article');card.className='club-card';card.append(el('h3',item.title),badge(item.registration_state),el('p',copy[item.kind]),el('p',stamp(item.start_at)),el('p',item.location),el('p',item.description));
   if(item.registration_state==='not_started')card.append(el('p',activity.registrationStarts+'：'+stamp(item.registration_start_at)));
   if(item.registration_url){const a=el('a',activity.title);a.href=item.registration_url;a.className='club-action';card.append(a);}events.append(card);}
  observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const img=entry.target;photo(img.dataset.media,img,img.parentElement,version);}},{rootMargin:'200px'});
  for(const item of data.galleries.filter(matches)){const card=el('article');card.className='club-card';card.append(el('h3',item.title),el('p',item.description),el('p',item.media_ids.length+' '+copy.photos));const photos=el('div');photos.className='club-photos';
   const button=el('button',copy.openAlbum);button.type='button';button.setAttribute('aria-label',copy.openAlbum+'：'+item.title);button.onclick=()=>openAlbum(item,button);
   if(item.media_ids.length){const img=el('img');img.alt=item.title;img.dataset.media=item.media_ids[0];button.prepend(img);observer.observe(img);}photos.append(button);
   card.append(photos);if(item.video_url){const a=el('a',copy.video);a.href=item.video_url;a.target='_blank';a.rel='noopener noreferrer';a.className='club-action';card.append(a);}galleries.append(card);}
  if(!clubs.children.length)clubs.append(el('p',copy.empty));
  for(const [n,id] of [[events,'#club-events-title'],[galleries,'#club-galleries-title']]){n.hidden=!n.children.length;q(id).hidden=n.hidden;}
 }
 async function identity(){if(!identityJob)identityJob=(async()=>{const sdk=window.sakuraBenefitLiff?await window.sakuraBenefitLiff():window.liff||await new Promise((resolve,reject)=>{const script=document.getElementById('club-liff-sdk');if(!script)return reject(Error('SDK unavailable'));script.addEventListener('load',()=>resolve(window.liff),{once:true});script.addEventListener('error',reject,{once:true});});if(!sdk)return;await (window.sakuraBenefitLiff?Promise.resolve():sdk.init({liffId:'__SAKURA_LIFF_ID__'}));token=sdk.isLoggedIn()?sdk.getIDToken()||'':'';})().catch(error=>{identityJob=null;throw error;});return Promise.race([identityJob,new Promise((_,reject)=>setTimeout(()=>reject(Error('LINE timeout')),10000))]);}
 async function load(){if(busy)return;busy=true;q('#club-refresh').disabled=true;status.textContent=copy.loading;status.dataset.error='false';
  const startedToken=token,identityReady=identity().catch(()=>{token='';});
  const apply=async currentToken=>{const response=await fetch('/api/clubs?lang='+locale,{headers:currentToken?{Authorization:'Bearer '+currentToken}:{},signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok||!result.success)throw new Error();data=result;ready=true;login.hidden=result.employee;
   const previous=filter.value;filter.replaceChildren(new Option(copy.all,''));for(const club of data.clubs)filter.add(new Option(club.title,club.id));filter.value=previous;status.textContent=locale==='zh'?'':copy.original;render();};
  try{await apply(startedToken);await identityReady;if(token&&token!==startedToken)await apply(token);
  }catch{clearImages();data={clubs:[],events:[],galleries:[]};render();status.textContent=copy.failed;status.dataset.error='true';login.hidden=false;}finally{busy=false;q('#club-refresh').disabled=false;}}
 search.oninput=render;filter.onchange=render;q('#club-refresh').onclick=load;
 login.onclick=async()=>{try{await identity();if(!window.liff)throw new Error();const url=new URL(location.pathname,location.origin);if(location.pathname.startsWith('/current-offers'))url.searchParams.set('view','clubs');
  if(liff.isLoggedIn())liff.logout();liff.login({redirectUri:url.href});}catch{status.textContent=copy.failed;status.dataset.error='true';}};
 q('#club-viewer-close').onclick=()=>q('#club-viewer').close();q('#club-viewer').addEventListener('close',()=>{q('#club-photo-large').removeAttribute('src');opener?.focus();});
 q('#club-album-close').onclick=()=>q('#club-album').close();q('#club-album').addEventListener('close',()=>{clearAlbum();albumOpener?.focus();});q('#club-album-prev').onclick=()=>{if(albumPage>0){albumPage--;albumPhotos();}};q('#club-album-next').onclick=()=>{if((albumPage+1)*24<album.media_ids.length){albumPage++;albumPhotos();}};
 window.addEventListener('pagehide',clearImages);window.addEventListener('sakura-club-show',load);window.addEventListener('sakura-club-hide',clearImages);if(!root.hidden)load();
}`;

export function clubScript(language) {
  const locale = normalizeActivityLocale(language);
  return `<script>document.addEventListener('DOMContentLoaded',()=>(${clubBrowser})(${JSON.stringify(locale)},${JSON.stringify(CLUB_COPY[locale])},${JSON.stringify(ACTIVITY_COPY[locale])}));</script>`;
}
export function buildClubPageHtml(language) {
  const locale = normalizeActivityLocale(language), c=CLUB_COPY[locale],a=ACTIVITY_COPY[locale];
  return `<!doctype html><html lang="${a.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.title}</title>${clubCss}<style>body{margin:0;font-family:system-ui,sans-serif;background:#f5f7f8}main{max-width:1200px;margin:auto}header{padding:16px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}header a{color:#1661ab}</style><script id="club-liff-sdk" async src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script></head><body><main><header><a href="/current-offers${locale==='zh'?'':'-'+locale}">${a.offers}</a><nav><a href="/clubs">繁體中文</a> · <a href="/clubs-id">Bahasa Indonesia</a> · <a href="/clubs-th">ภาษาไทย</a></nav></header>${clubPanel(locale)}</main>${clubScript(locale)}</body></html>`;
}
