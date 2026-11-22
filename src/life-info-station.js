export const LIFE_INFO_STATION_COMMANDS = Object.freeze({
  zh: '員工生活情報站',
  id: 'Pusat Informasi Karyawan',
  th: 'ศูนย์ข้อมูลพนักงาน',
});

export const LIFE_INFO_STATION_LABELS = Object.freeze({
  zh: ['本期優惠', '特約店家', '活動專區', '社團資訊', '活動花絮'],
  id: ['Promo Terkini', 'Mitra Toko', 'Kegiatan', 'Komunitas', 'Sorotan Kegiatan'],
  th: ['โปรโมชัน', 'ร้านค้าพันธมิตร', 'กิจกรรม', 'ชมรม', 'ภาพกิจกรรม'],
});
const QUERIES = ['', '?view=directory', '?view=activities', '?view=clubs', '?view=activities&stories=1'];

export function lifeInfoStationLanguage(text) {
  const value = String(text || '').trim();
  return Object.keys(LIFE_INFO_STATION_COMMANDS).find(language => LIFE_INFO_STATION_COMMANDS[language] === value) || '';
}

export function lifeInfoStationItemLanguage(item) {
  if (!item || item.eventType !== 'message' || item.messageType !== 'text' || item.sourceType !== 'user' || !item.replyToken) return '';
  return lifeInfoStationLanguage(item.text);
}

function lifeInfoStationEventLanguage(event) {
  return lifeInfoStationItemLanguage({
    eventType: event?.type,
    messageType: event?.message?.type,
    sourceType: event?.source?.type,
    replyToken: event?.replyToken,
    text: event?.message?.text,
  });
}

export function buildLifeInfoStationMessage(language, publicOrigin, buildLiff) {
  if (!Object.hasOwn(LIFE_INFO_STATION_LABELS, language) || typeof buildLiff !== 'function') throw new Error('Invalid life information station configuration');
  const origin = new URL(String(publicOrigin || ''));
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('Life information image requires an HTTPS origin');
  const base = '/featured-partner-stores' + (language === 'zh' ? '' : '-' + language);
  const items = LIFE_INFO_STATION_LABELS[language].map((label, index) => {
    const uri = String(buildLiff(base + QUERIES[index]));
    const target = new URL(uri);
    if (target.protocol !== 'https:' || target.hostname !== 'liff.line.me' || target.username || target.password) throw new Error('Life information action requires LIFF');
    return { type: 'action', action: { type: 'uri', label, uri } };
  });
  return {
    type: 'image',
    originalContentUrl: new URL('/file/line-life-info/20261030/share.png', origin).toString(),
    previewImageUrl: new URL('/file/line-life-info/20261030/share-preview.jpg', origin).toString(),
    quickReply: { items },
  };
}

// Only this private entry belongs to the child. Keep the original bytes and
// signature for every other delivery, including empty verification batches.
export function partitionLifeInfoForwardPayload(rawBody, signatureVerified, additionallyOwned) {
  const unchanged = { body: rawBody, changed: false, shouldForward: true, ownedEvents: 0 };
  if (signatureVerified !== true) return unchanged;
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return unchanged; }
  if (!Array.isArray(payload?.events)) return unchanged;
  const events = payload.events.filter(event => !lifeInfoStationEventLanguage(event) && !additionallyOwned?.(event));
  const ownedEvents = payload.events.length - events.length;
  if (!ownedEvents) return unchanged;
  return { body: JSON.stringify({ ...payload, events }), changed: true, shouldForward: events.length > 0, ownedEvents };
}

export async function signLifeInfoForwardPayload(rawBody, channelSecret) {
  if (!channelSecret) throw new Error('Missing channel secret');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}
