import { SegmentPushError } from './segment-audience.js';

// Build only LINE's ordinary text/image message objects. Preview persists this
// exact ordered array, so send can continue to use the existing snapshot and
// retry protections without accepting content again from the client.
export function buildCompositeMessages(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SegmentPushError('推播內容格式不正確。');
  }
  const readString = (value, label) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw new SegmentPushError(label + '格式不正確。');
    return value.trim();
  };
  const text = readString(input.text, '文字內容');
  if (text.length > 5000) throw new SegmentPushError('文字內容不可超過 5000 字。');
  const order = input.messageOrder === undefined ? 'text_first' : input.messageOrder;
  if (!['text_first', 'image_first'].includes(order)) throw new SegmentPushError('文字與圖片順序不正確。');
  const original = readString(input.originalContentUrl, '圖片網址');
  const preview = readString(input.previewImageUrl, '圖片預覽網址');
  if (!original && preview) throw new SegmentPushError('請先提供圖片網址。');
  const messages = [];
  if (text) messages.push({ type: 'text', text });
  if (original) {
    const isHttpsImageUrl = value => {
      if (value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) return false;
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
      } catch { return false; }
    };
    const previewImageUrl = preview || original;
    if (!isHttpsImageUrl(original) || !isHttpsImageUrl(previewImageUrl)) {
      throw new SegmentPushError('圖片與預覽網址必須為有效的 HTTPS 網址。');
    }
    messages.push({ type: 'image', originalContentUrl: original, previewImageUrl });
  }
  if (!messages.length) throw new SegmentPushError('請輸入文字或加入圖片。');
  if (order === 'image_first') messages.reverse();
  return messages;
}
