import { lotteryDefaultVideoPath } from './activity-lottery-video.js';

export const lotteryStagePath = '/activity-lottery-stage';
export const lotteryStagePageSize = 9;

export const lotteryStageHtml = `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>現場投影 | SAKURA Welfare</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:#161523;color:#fff8ef;font:17px/1.45 system-ui,sans-serif}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px clamp(16px,4vw,64px);border-bottom:1px solid #ffffff28}
header p{margin:0;font-weight:700;font-size:clamp(15px,2vw,30px);overflow-wrap:anywhere}
nav{display:flex;gap:8px;flex-shrink:0}button{padding:8px 12px;min-height:44px;font:inherit;color:inherit;background:#242237;border:1px solid #ffffff60;border-radius:8px;cursor:pointer}
main{width:min(1280px,100%);margin:auto;text-align:center;padding:clamp(20px,5vh,60px) clamp(16px,4vw,56px)}
h1{font-size:clamp(38px,7vw,104px);line-height:1.12;letter-spacing:.025em;margin:0 0 12px;overflow-wrap:anywhere}
#phase{font-size:clamp(19px,2.8vw,44px);color:#ffdbaf;margin:0 0 24px}
video{display:block;width:100%;max-height:65dvh;background:#0c0b11;border-radius:12px}
ol{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,1.5vh,16px)}
li{display:grid;gap:4px;padding:clamp(6px,1.5vh,16px) 10px;background:#252237;border:1px solid #ffffff38;border-radius:12px;font-size:clamp(22px,3.2vw,5vh);overflow-wrap:anywhere}
li span{color:#ffdbaf;font-size:.65em;font-variant-numeric:tabular-nums}
ol[data-layout="multiple"][data-columns="1"]{max-width:440px;margin-inline:auto;grid-template-columns:1fr}
ol[data-layout="multiple"][data-columns="2"]{max-width:860px;margin-inline:auto;grid-template-columns:repeat(2,minmax(0,1fr))}
ol[data-layout="single"]{max-width:940px;margin:auto;grid-template-columns:1fr}
ol[data-layout="single"] li{padding:clamp(22px,6vh,70px) 16px;font-size:clamp(54px,10vw,150px);line-height:1.08;border-color:#d19f69;background:radial-gradient(ellipse at top,#4c3450,#252237 75%)}
ol[data-layout="single"] li span{margin-top:14px;font-size:clamp(22px,3vw,48px)}
#result-meta{margin:16px 0 0;color:#ffdbaf;font-size:clamp(16px,2.4vw,30px);font-variant-numeric:tabular-nums}
@media(max-width:640px){ol{grid-template-columns:repeat(2,minmax(0,1fr))}}
[hidden]{display:none!important}
</style></head><body>
<header><p id="event">活動抽獎</p><nav aria-label="投影視窗"><button id="full" type="button">全螢幕</button><button id="close" type="button">關閉投影</button></nav></header>
<main><h1 id="prize">現場抽獎</h1><p id="phase" role="status">等待主持人開始</p>
<video id="video" playsinline preload="none" aria-label="抽獎過場影片" hidden></video>
<ol id="winners" aria-label="中獎結果"></ol><p id="result-meta" role="status" hidden></p></main>
<script>
const el = id => document.getElementById(id);
const openerWindow = window.opener;
const video = el('video');
let objectUrl = '', timer, generation = 0;
const tellHost = message => openerWindow?.postMessage(message, location.origin);
function stopVideo() {
  generation++;
  clearTimeout(timer);
  video.onended = video.onerror = video.onplaying = null;
  video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
}
const pageSize = ${lotteryStagePageSize};
function showResult(frame, page = 0) {
  el('phase').textContent = frame.phase === 'trial' ? '試抽結果' : frame.phase === 'result' ? '恭喜中獎' : '等待主持人開始';
  const rows = frame.winners || [], results = el('winners'), meta = el('result-meta');
  const pages = Math.ceil(rows.length / pageSize);
  const index = Math.max(0, Math.min(Number.isInteger(page) ? page : 0, pages - 1));
  const visible = rows.slice(index * pageSize, (index + 1) * pageSize);
  results.dataset.layout = rows.length === 1 ? 'single' : 'multiple';
  results.dataset.columns = String(Math.min(3, visible.length));
  results.replaceChildren();
  meta.hidden = rows.length < 2;
  meta.textContent = '共 ' + rows.length + ' 位' + (pages > 1 ? '　｜　第 ' + (index + 1) + '／' + pages + ' 頁' : '');
  for (const winner of visible) {
    const item = document.createElement('li'), name = document.createElement('strong'), code = document.createElement('span');
    name.textContent = winner.name; code.textContent = '抽獎編號 ' + winner.code;
    item.append(name, code); results.append(item);
  }
}
async function play(frame, clip, sound, round) {
  const run = generation;
  const finish = () => {
    if (run !== generation) return;
    stopVideo(); showResult(frame); tellHost({type:'lottery-stage-finished',round});
  };
  el('phase').textContent = frame.phase === 'trial' ? '試抽進行中' : '開獎中';
  video.hidden = false; video.muted = !sound;
  video.onended = video.onerror = finish;
  // Bound startup time only. Once playing, the clip determines when results are revealed.
  timer = setTimeout(finish, 12000);
  video.onplaying = () => clearTimeout(timer);
  if (clip instanceof Blob) { objectUrl = URL.createObjectURL(clip); video.src = objectUrl; }
  else video.src = ${JSON.stringify(lotteryDefaultVideoPath)};
  try { await video.play(); }
  catch {
    if (run !== generation) return;
    video.muted = true;
    try { await video.play(); } catch { finish(); }
  }
}
window.addEventListener('message', event => {
  const data = event.data;
  if (!openerWindow || event.source !== openerWindow || event.origin !== location.origin || data?.type !== 'lottery-stage-frame') return;
  stopVideo();
  const frame = data.frame;
  el('event').textContent = frame.event || '活動抽獎';
  el('prize').textContent = frame.prize || '現場抽獎';
  el('winners').replaceChildren();
  el('result-meta').hidden = true;
  if (typeof data.round === 'number') void play(frame, data.clip, data.sound, data.round);
  else showResult(frame,data.page);
});
el('full').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {}
};
document.addEventListener('fullscreenchange', () => { el('full').textContent = document.fullscreenElement ? '退出全螢幕' : '全螢幕'; });
el('full').hidden = !document.fullscreenEnabled;
el('close').onclick = () => window.close();
tellHost({type:'lottery-stage-ready'});
</script></body></html>`;
