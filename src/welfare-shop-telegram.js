const maxAttempts = 3;
const unknownAfter = 120_000;

function lines(order, adminUrl) {
  const name = order.product_name.replace(/\s+/g, ' ').trim();
  const total = new Intl.NumberFormat('zh-TW', {
    style: 'currency', currency: 'TWD', minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(order.price_cents * order.quantity / 100);
  return [
    '福利品商城有新購買申請',
    '商品｜' + name,
    '數量｜' + order.quantity + ' 件',
    '金額｜' + total,
    '申請編號｜' + order.request_id,
    '請至商城管理確認申請',
    adminUrl
  ];
}

async function deliver(db, id, send, adminUrl) {
  const now = Date.now();
  const claim = await db.prepare(
    "UPDATE welfare_shop_telegram SET status='sending',attempts=attempts+1,updated_at=? " +
    "WHERE request_id=? AND status='pending' AND next_at<=? RETURNING attempts"
  ).bind(now,id,now).first();
  if (!claim) return;

  const order = await db.prepare(
    'SELECT id AS request_id,product_name,price_cents,quantity FROM welfare_shop_requests WHERE id=?'
  ).bind(id).first();
  let result;
  try { result = await send(lines(order,adminUrl)); }
  catch { result = {}; }
  const status = Number.isInteger(result?.status) ? result.status : null;
  const retry = status === 429 && claim.attempts < maxAttempts;
  const outcome = result?.ok ? 'sent'
    : retry ? 'pending'
    : result?.reason === 'disabled' || result?.reason === 'event_disabled' ? 'disabled'
    : result?.skipped || (status >= 400 && status < 500 && status !== 408) ? 'failed'
    : 'unknown';
  const finishedAt = Date.now();
  const retryDelay = Math.max(60, Number(result?.retryAfterSeconds) || 0) * 1000;
  await db.prepare(
    "UPDATE welfare_shop_telegram SET status=?,next_at=?,updated_at=?,provider_status=? " +
    "WHERE request_id=? AND status='sending' AND attempts=?"
  ).bind(outcome,retry ? finishedAt+retryDelay : finishedAt,finishedAt,status,id,claim.attempts).run();
}

export async function flushWelfareShopTelegram(db, send, adminUrl, requestId) {
  if (requestId) return deliver(db,requestId,send,adminUrl);
  const now = Date.now();
  await db.prepare("UPDATE welfare_shop_telegram SET status='unknown',updated_at=? WHERE status='sending' AND updated_at<?")
    .bind(now,now-unknownAfter).run();
  const due = await db.prepare("SELECT request_id FROM welfare_shop_telegram WHERE status='pending' AND next_at<=? ORDER BY next_at,request_id LIMIT 5")
    .bind(now).all();
  await Promise.all(due.results.map(row=>deliver(db,row.request_id,send,adminUrl)));
}
