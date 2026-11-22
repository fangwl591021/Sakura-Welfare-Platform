function benefitLoginRuntime(liffId) {
  const lang=document.documentElement.lang,T=lang.startsWith('id')?{login:'Masuk dengan LINE',retry:'Coba lagi'}:lang.startsWith('th')?{login:'เข้าสู่ระบบ LINE',retry:'ลองอีกครั้ง'}:{login:'登入 LINE',retry:'重試'};
  const nativeFetch=window.fetch.bind(window);
  const paths=new Set(['/api/partner-stores','/api/featured-partner-stores','/api/medical-providers','/api/vendor-store','/api/vendor-directory','/api/vendor-nearby','/api/member-app','/api/vendor-store/documents']);
  let sdkPromise, state={}, ready, revision=0;
  async function sdk() {
    if(!sdkPromise)sdkPromise=(async()=>{
      if(!window.liff)await new Promise((resolve,reject)=>{const existing=document.querySelector('script[src="https://static.line-scdn.net/liff/edge/2/sdk.js"]'),script=existing||document.createElement('script');script.addEventListener('load',resolve,{once:true});script.addEventListener('error',reject,{once:true});if(!existing){script.src='https://static.line-scdn.net/liff/edge/2/sdk.js';document.head.appendChild(script);}});
      await window.liff.init({liffId});return window.liff;
    })().catch(error=>{sdkPromise=null;throw error;});
    return sdkPromise;
  }
  async function initialize(login=false) {
    try {
      const cached=await nativeFetch('/api/vendor-benefits/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)}).then(r=>r.json());
      if(cached.employee && !login){state=cached;return;}
      const liff=await Promise.race([sdk(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('SDK timeout')),10000))]);
      if(!liff.isLoggedIn()){state={};if(login)liff.login({redirectUri:location.href});return;}
      const response=await nativeFetch('/api/vendor-benefits/session',{method:'POST',credentials:'same-origin',headers:{'X-Line-Id-Token':liff.getIDToken()||''},signal:AbortSignal.timeout(15000)});
      const data=await response.json();if(!data.success)throw new Error('Access unavailable');state=data;return true;
    } catch {state={error:true};}
    finally {revision++;draw();}
  }
  function draw(){
    const banner=document.getElementById('employee-benefit-login');if(!banner)return;
    banner.hidden=state.employee===true||state.operator===true||state.identified===true||Boolean(window.liff?.isLoggedIn?.());
    const confirmed=document.getElementById('employee-benefit-confirmed');
    if(confirmed){confirmed.hidden=true;confirmed.textContent='';}
    banner.querySelector('span').hidden=true;banner.querySelector('span').textContent='';
    banner.querySelector('button').textContent=state.identified||state.error?T.retry:T.login;
    document.documentElement.dataset.employeeBenefits=String(state.employee===true);
  }

  window.fetch=async function(input,options){
    const url=new URL(input instanceof Request?input.url:input,location.href);
    const method=String(options?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    const scoped=url.origin===location.origin&&paths.has(url.pathname)&&method==='GET',version=revision;
    let response=await nativeFetch(input,options);
    // Public data never waits for LIFF. If identity changed while this request
    // was in flight, obtain a fresh, server-authorized response before returning.
    if(scoped&&version!==revision){const result=await response.clone().json().catch(()=>null);if(typeof result?.employeeBenefits==='boolean'&&result.employeeBenefits!==(state.employee===true)&&!result.data?.canEdit&&!result.data?.editable)response=await nativeFetch(input,options);}
    if(url.origin===location.origin&&url.pathname==='/api/vendor-store'&&method==='GET')response.clone().json().then(data=>{if(data.data?.canEdit){state.operator=true;draw();}}).catch(()=>{});
    return response;
  };
  window.sakuraBenefitLiff=sdk;
  const refresh=async(login=false)=>{const wasEmployee=state.employee===true,changed=await initialize(login);if((changed||wasEmployee)&&(state.employee===true)!==wasEmployee&&!state.operator){const jobs=[];window.dispatchEvent(new CustomEvent('sakura-benefits-changed',{detail:jobs}));await Promise.allSettled(jobs);}};
  ready=refresh();
  window.sakuraBenefitReady=ready;
  const mount=()=>{
    const slot=document.getElementById('employee-benefit-slot'),banner=document.createElement('section');banner.id='employee-benefit-login';banner.style.cssText='color:#173657;font:14px/1.6 system-ui';banner.setAttribute('aria-live','polite');
    const text=document.createElement('span'),button=document.createElement('button');button.type='button';button.style.cssText='display:block;margin-top:8px;padding:9px 14px;border:1px solid #b9cce4;border-radius:8px;background:white;color:#173657';banner.append(text,button);
    const host=document.querySelector('.safe,.hero,main,.app')||document.body;slot.prepend(banner);draw();
    button.onclick=async()=>{button.disabled=true;try{ready=refresh(true);window.sakuraBenefitReady=ready;await ready;}finally{button.disabled=false;}};
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
}

export function decorateBenefitLogin(html,liffId) {
  const script='<script data-employee-benefits>(()=>{const __name=target=>target;('+benefitLoginRuntime.toString()+')('+JSON.stringify(liffId).replace(/</g,'\\u003c')+');})();</script>';
  const slot='<aside id="employee-benefit-slot" style="box-sizing:border-box;min-height:56px;padding:4px 16px;color:#173657;font:14px/1.6 system-ui"><p id="employee-benefit-confirmed" hidden style="margin:0" role="status"></p></aside>';
  const store=html.includes('id="storeName"');
  const loading=store?'<style>.safe:not([data-store-ready]){visibility:hidden}#store-loading{position:absolute;left:50%;transform:translateX(-50%);width:min(90%,430px);padding:24px;box-sizing:border-box}#store-loading i{display:block;height:180px;background:#edf1f5;border-radius:16px;margin-bottom:20px}#store-loading button{padding:10px 16px;background:white;border:1px solid #cad5df;border-radius:8px;cursor:pointer}</style><div id="store-loading" role="status"><i aria-hidden="true"></i><button type="button" onclick="location.reload()">'+(/<html[^>]+lang="id/.test(html)?'Muat ulang':/<html[^>]+lang="th/.test(html)?'โหลดใหม่':'重新載入')+'</button></div>':'';
  return html.replace('</head>',script+'</head>').replace(/<body\b[^>]*>/i,body=>body+slot+loading);
}
