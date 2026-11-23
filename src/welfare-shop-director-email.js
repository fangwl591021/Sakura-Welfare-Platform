const staleAfter = 120_000;

export function welfareShopEmailConfigured(env) {
  return Boolean(env.WELFARE_SHOP_EMAIL_FROM && (env.RESEND_API_KEY || env.EMAIL_API_KEY));
}

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function sendEmail(env, order, send) {
  const venue = singleLine(order.venue_name);
  const amount = new Intl.NumberFormat('zh-TW').format(order.price_cents * order.quantity / 100);
  const text = [
    '狀態：待福委會確認',
    '館別：' + venue,
    '申請編號：' + order.request_id,
    '商品：' + singleLine(order.product_name),
    '數量：' + order.quantity + ' 件',
    '金額：NT$' + amount,
    '申請人：' + singleLine(order.employee_name),
    ...(order.contact_phone ? ['聯絡電話：' + order.contact_phone] : []),
    '請在福委會確認後安排取貨。'
  ].join('\n');
  return send('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: 'Bearer ' + (env.RESEND_API_KEY || env.EMAIL_API_KEY),
      'Content-Type': 'application/json',
      'Idempotency-Key': 'welfare-shop-director/' + order.request_id
    },
    body: JSON.stringify({
      from: env.WELFARE_SHOP_EMAIL_FROM,
      to: [order.recipient],
      subject: '福利品預訂待確認｜' + venue,
      text
    })
  });
}

async function deliver(env, id, send) {
  const db = env.DB;
  const claim = await db.prepare("UPDATE welfare_shop_director_email SET status='sending',updated_at=? WHERE request_id=? AND status='pending' RETURNING request_id")
    .bind(Date.now(), id).first();
  if (!claim) return;
  const order = await db.prepare(
    'SELECT e.*,v.email AS current_recipient,r.product_name,r.quantity,r.price_cents,r.contact_phone,r.status AS request_status' +
    ' FROM welfare_shop_director_email e JOIN welfare_shop_requests r ON r.id=e.request_id' +
    ' JOIN welfare_shop_venues v ON v.id=e.venue_id WHERE e.request_id=?'
  )
    .bind(id).first();
  let status = 'unknown', providerStatus = null;
  if (!welfareShopEmailConfigured(env)) status = 'disabled';
  else if (order?.request_status === 'cancelled') status = 'cancelled';
  else if (order && order.recipient !== order.current_recipient) status = 'recipient_changed';
  else if (order) {
    try {
      const response = await sendEmail(env, order, send);
      providerStatus = response.status;
      if (response.ok) status = 'accepted';
      else if (providerStatus >= 400 && providerStatus < 500 && ![408,409].includes(providerStatus)) status = 'failed';
      await response.body?.cancel();
    } catch {
      // A transport timeout can occur after provider acceptance.
    }
  }
  await db.prepare("UPDATE welfare_shop_director_email SET status=?,provider_status=?,updated_at=? WHERE request_id=? AND status='sending'")
    .bind(status, providerStatus, Date.now(), id).run();
}

export async function flushWelfareShopDirectorEmail(env, requestId, send = fetch) {
  if (requestId) return deliver(env, requestId, send);
  await env.DB.prepare("UPDATE welfare_shop_director_email SET status='unknown',updated_at=? WHERE status='sending' AND updated_at<?")
    .bind(Date.now(), Date.now() - staleAfter).run();
  const due = await env.DB.prepare("SELECT request_id FROM welfare_shop_director_email WHERE status='pending' ORDER BY updated_at,request_id LIMIT 5").all();
  await Promise.all(due.results.map(row => deliver(env, row.request_id, send)));
}
