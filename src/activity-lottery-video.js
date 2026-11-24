import defaultVideoBase64 from '../assets/activity-lottery-default-media.js';
import { activityScopeSql } from './editor-access.js';
import { readBytes } from './flex-video-media.js';

export const lotteryDefaultVideoPath = '/activity-lottery-media/default-v1.mp4';
export const lotteryVideoAdminPath = '/admin-api/activity-lottery-video';
export const lotteryVideoPrefix = 'activity_lottery_private_video_';
export const maxLotteryVideoBytes = 20_000_000;
const json = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store' }
});
const fail = (message, status) => json({ success: false, message }, status);

export function serveDefaultLotteryVideo(request) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const size = defaultVideoBase64.length / 4 * 3 - (defaultVideoBase64.endsWith('==') ? 2 : defaultVideoBase64.endsWith('=') ? 1 : 0);
  const etag = '"sakura-lottery-default-v1"';
  const headers = new Headers({
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ETag: etag,
    'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'
  });
  const rawRange = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  let start = 0, end = size - 1, status = 200;
  if (rawRange && (!ifRange || ifRange === etag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rawRange.trim());
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      headers.set('Content-Range', 'bytes */' + size);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
  }
  headers.set('Content-Length', String(end - start + 1));
  let body = null;
  if (request.method !== 'HEAD') {
    const alignedStart = Math.floor(start / 3);
    const decoded = atob(defaultVideoBase64.slice(alignedStart * 4, Math.ceil((end + 1) / 3) * 4));
    const offset = start % 3;
    body = new Uint8Array(end - start + 1);
    for (let i = 0; i < body.length; i++) body[i] = decoded.charCodeAt(offset + i);
  }
  return new Response(body, { status, headers });
}

export async function handleActivityLotteryVideo(request, db, bucket, actor) {
  if (!actor) return fail('請使用具活動管理權限的帳號。', 403);
  const method = request.method;
  if (!['GET', 'PUT', 'DELETE'].includes(method)) return fail('不支援此操作方式。', 405);
  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  if (!eventId || eventId.length > 100) return fail('請先選取活動。', 400);
  if (!db || !bucket) return fail('影片儲存暫時無法使用。', 503);
  const scope = activityScopeSql(actor);
  const eventQuery = () => db.prepare('SELECT e.id FROM welfare_activity_events e WHERE e.id=?' + (scope ? ' AND ' + scope : '')).bind(eventId).first();
  const key = lotteryVideoPrefix + encodeURIComponent(eventId);
  try {
    if (!await eventQuery()) return fail('此活動不存在或不在您的管理範圍。', 403);
    if (method === 'GET') {
      if (url.searchParams.get('view') === 'status') return json({ success: true, custom: Boolean(await bucket.head(key)) });
      const object = await bucket.get(key);
      if (!object) return fail('此活動使用預設影片。', 404);
      return new Response(object.body, { headers: {
        'Cache-Control': 'private, no-store', 'Content-Type': 'video/mp4',
        'Content-Length': String(object.size), 'X-Content-Type-Options': 'nosniff'
      } });
    }
    if (method === 'DELETE') {
      await bucket.delete(key);
      return json({ success: true, custom: false });
    }
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'video/mp4') return fail('請選擇 MP4 影片。', 415);
    const bytes = await readBytes(request, maxLotteryVideoBytes);
    if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') return fail('請選擇有效的 MP4 影片。', 415);
    if (!await eventQuery()) return fail('此活動已不在您的管理範圍。', 403);
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'video/mp4' }, customMetadata: { actor } });
    return json({ success: true, custom: true });
  } catch (error) {
    return error.status ? fail(error.status === 413 ? '影片須為 20 MB 以下的 MP4。' : error.message, error.status)
      : fail('影片操作未確認，請重新載入後核對。', 503);
  }
}
