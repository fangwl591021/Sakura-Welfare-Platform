import qrcode from './vendor/qrcode-generator.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function createBranchQr(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'liff.line.me' || url.length > 1800 || /[^\x20-\x7e]/.test(url)) throw new Error('Invalid branch LIFF URL');
  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  return qr;
}

export function createBranchQrSvg(url) {
  const qr = createBranchQr(url);
  return qr.createSvgTag({cellSize:6, margin:24, scalable:true, alt:'用 LINE 掃碼發起消費', title:'分店消費 QR'});
}

function pngChunk(type, data) {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) {
    crc ^= chunk[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

// LINE image messages need a raster image. Generate locally from the same matrix
// as the printable SVG, keeping a four-module white border on every side.
export async function createBranchQrPng(url) {
  const qr = createBranchQr(url);
  const modules = qr.getModuleCount();
  const quiet = 4;
  const scale = Math.ceil(640 / (modules + quiet * 2));
  const size = (modules + quiet * 2) * scale;
  const stride = size + 1;
  const scanlines = new Uint8Array(stride * size).fill(255);
  for (let y = 0; y < size; y++) scanlines[y * stride] = 0;
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.isDark(row, col)) continue;
      const x = (col + quiet) * scale;
      const y = (row + quiet) * scale;
      for (let dy = 0; dy < scale; dy++) {
        const offset = (y + dy) * stride + 1 + x;
        scanlines.fill(0, offset, offset + scale);
      }
    }
  }
  const compressed = new Response(scanlines).body.pipeThrough(new CompressionStream('deflate'));
  const imageData = new Uint8Array(await new Response(compressed).arrayBuffer());
  const header = new Uint8Array(13);
  const dimensions = new DataView(header.buffer);
  dimensions.setUint32(0, size);
  dimensions.setUint32(4, size);
  header[8] = 8; // 8-bit grayscale; opaque black and white, no palette or metadata.
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', imageData),
    pngChunk('IEND', new Uint8Array()),
  ];
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function renderBranchQrHtml(branch, checkoutUrl) {
  const title = branch.vendorName + '｜' + branch.branchName;
  const svg = createBranchQrSvg(checkoutUrl);
  const file = '/api/branch-redemption/qr.png?location_id=' + encodeURIComponent(branch.locationId) + '&download=1';
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)}｜分店消費 QR</title><style>body{font:18px/1.6 system-ui,sans-serif;margin:0;color:#10263b;background:#f4f6f8}main{max-width:720px;margin:auto;padding:24px}nav{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px}a,button{font:inherit;border:1px solid #bcc9d6;border-radius:8px;background:white;color:#17374b;padding:10px 16px;text-decoration:none;cursor:pointer}.sheet{text-align:center;background:white;padding:32px 20px;border:1px solid #dbe3ee;border-radius:12px}h1{font-size:28px;margin:0 0 8px;overflow-wrap:anywhere}h2{font-size:24px;margin:0 0 12px}p{margin:12px 0}.qr{max-width:400px;margin:auto}.qr svg{width:100%;height:auto;display:block}.muted{color:#435870}.url{font-size:14px;overflow-wrap:anywhere}@media print{body{background:white}nav,.screen-only{display:none!important}main{max-width:none;padding:0}.sheet{border:0}.qr{max-width:105mm}}</style></head><body><main><nav aria-label="QR 操作"><button id="back" type="button">返回／關閉</button><a href="${esc(file)}" download="branch-qr.png">下載 PNG 圖片</a><button id="print" type="button">列印店家立牌</button></nav><section class="sheet"><h1>${esc(branch.vendorName)}</h1><h2>${esc(branch.branchName)}</h2><p class="muted">${esc(branch.address)}</p><div class="qr">${svg}</div><p><strong>開啟 LINE 掃碼，發起本次消費</strong></p><p>填寫金額後，請交由店員核對。<br>店員確認後才完成核銷。</p><p class="screen-only url"><a href="${esc(checkoutUrl)}">開啟用戶掃碼頁</a></p></section></main><script>document.getElementById('print').onclick=()=>window.print();document.getElementById('back').onclick=()=>{if(history.length>1)history.back();else{window.close();setTimeout(()=>{location.href='/partner-stores'},150)}};</script></body></html>`;
}
