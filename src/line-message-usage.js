// Read-only LINE Official Account usage. No message delivery or data writes.
const LINE = 'https://api.line.me';
const EXPECTED_BASIC_ID = '@020aelyz';
const COUNTERS = ['broadcast', 'targeting', 'stepMessage', 'apiPush', 'apiMulticast', 'apiBroadcast', 'apiNarrowcast'];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function japanDay(now) {
  const japan = new Date(now + 9 * 60 * 60 * 1000);
  return Date.UTC(japan.getUTCFullYear(), japan.getUTCMonth(), japan.getUTCDate());
}

async function readLine(fetcher, path, token) {
  try {
    const response = await fetcher(LINE + path, {
      method: 'GET', headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'},
      signal: AbortSignal.timeout(6000), redirect: 'error',
    });
    if (!response.ok) { await response.body?.cancel(); return {status:response.status, data:null}; }
    const json = await response.json();
    return {status:response.status, data:json && typeof json === 'object' && !Array.isArray(json) ? json : null};
  } catch (_) { return {status:0, data:null}; }
}

export async function getLineMessageUsage(env, deps = {}) {
  const token = env?.LINE_CHANNEL_ACCESS_TOKEN;
  if (typeof token !== 'string' || !token.trim()) return {success:false, message:'LINE 用量服務尚未設定。'};
  const fetcher = deps.fetch || fetch;
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const today = japanDay(now);
  const date = deps.date || new Date(today - 86400000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {success:false, message:'日期格式不正確。'};
  const stamp = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0,10) !== date || stamp > today || stamp < today - 59 * 86400000) return {success:false, message:'請選擇日本時間最近 60 天的日期。'};
  const bot = await readLine(fetcher, '/v2/bot/info', token);
  if (bot.status === 429) return {success:false, message:'LINE 查詢過於頻繁，請稍後再試。'};
  if (!bot.data || bot.data.basicId !== EXPECTED_BASIC_ID) return {success:false, message:'無法確認 LINE 官方帳號，暫不顯示用量。'};
  const [quotaResponse, usageResponse, dailyResponse] = await Promise.all([
    readLine(fetcher, '/v2/bot/message/quota', token),
    readLine(fetcher, '/v2/bot/message/quota/consumption', token),
    readLine(fetcher, '/v2/bot/insight/message/delivery?date=' + date.replaceAll('-', ''), token),
  ]);
  const quotaRaw=quotaResponse.data, usageRaw=usageResponse.data, raw=dailyResponse.data;
  const limit = quotaRaw?.type === 'limited' ? count(quotaRaw.value) : null;
  const quota = quotaRaw?.type === 'limited' && limit !== null ? {type:'limited', value:limit}
    : quotaRaw?.type === 'none' ? {type:'none', value:null} : {type:'unknown', value:null};
  const used = count(usageRaw?.totalUsage);
  return {success:true,data:{
    identity:{basicId:EXPECTED_BASIC_ID}, quota, consumption:used,
    rateLimited:[quotaResponse.status,usageResponse.status,dailyResponse.status].includes(429),
    remaining:quota.type === 'limited' && used !== null ? Math.max(0, quota.value - used) : null,
    asOf:new Date(now).toISOString(),
    days:[(() => {
      const status=raw?.status;
      if (status !== 'ready') return {date,status:dailyResponse.status===429?'rate_limited':status === 'unready' || status === 'out_of_service' ? status : 'unavailable',counts:null};
      return {date,status:'ready',counts:Object.fromEntries(COUNTERS.map(key=>[key,count(raw[key])]))};
    })()],
  }};
}
