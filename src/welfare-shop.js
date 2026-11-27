import { activeBenefitEmployee, verifiedBenefitCookieUid } from './vendor-benefit-access.js';
import { readBoundedAdminJson } from './editor-access.js';
import { welfareShopEmailConfigured } from './welfare-shop-director-email.js';

export const shopPhotoPrefix = 'welfare_shop_private_';
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie, Authorization, X-Line-Id-Token, X-Line-Access-Token'
};
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const employee = "status='active' AND bind_status='bound' AND member_type IN ('employee','foreign_employee','manager')";
const rosterMatch = "EXISTS (SELECT 1 FROM employee_roster r WHERE r.employee_no=trim(welfare_members.employee_no) AND r.employee_no<>'')";
const used = "(SELECT COALESCE(SUM(quantity),0) FROM welfare_shop_requests WHERE product_id=p.id AND status<>'cancelled')";
const json = (value, status = 200) => Response.json(value, { status, headers });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { shopStatus: status }); };

function field(value, length, required = false) {
  if (typeof value !== 'string' || value.length > length || (required && !value.trim())) fail('請檢查必填欄位與文字長度。');
  return value.trim();
}

function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('請檢查價格、庫存及數量。');
  return value;
}

function contactPhone(value) {
  if (typeof value !== 'string' || value.length > 32) fail('請填寫有效的聯絡電話。');
  const number = value.normalize('NFKC').trim();
  const digits = number.replace(/\D/g, '');
  if (!/^\+?[0-9() -]+$/.test(number) || digits.length < 7 || digits.length > 15) {
    fail('請填寫有效的聯絡電話。');
  }
  return number;
}

function product(data) {
  return [
    field(data.category, 50, true), field(data.series || '', 80), field(data.name, 150, true),
    field(data.condition_note, 2000, true), field(data.pickup_note || '', 1000),
    integer(data.price_cents, 0, 100000000), integer(data.stock, 0, 9999), integer(data.employee_limit, 1, 9999)
  ];
}

function photoData(base64) {
  if (typeof base64 !== 'string' || !base64 || base64.length > 2_800_000) fail('照片須為 2 MB 以內的 JPEG、PNG 或 WebP。');
  let image;
  try { image = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); }
  catch { fail('照片格式不正確。'); }
  if (image.length > 2 * 1024 * 1024) fail('照片須為 2 MB 以內。');
  const signature = (...values) => values.every((value, i) => image[i] === value);
  const type = signature(255,216,255) ? 'image/jpeg' :
    signature(137,80,78,71,13,10,26,10) ? 'image/png' :
    signature(82,73,70,70) && String.fromCharCode(...image.slice(8,12)) === 'WEBP' ? 'image/webp' : '';
  if (!type) fail('照片須為 JPEG、PNG 或 WebP。');
  return { image, type };
}

async function shopJson(request, limit) {
  try { return await readBoundedAdminJson(request, limit); }
  catch (error) { fail(error.status === 413 ? '檔案超過上傳大小。' : '資料格式不正確。', error.status === 413 ? 413 : 400); }
}

async function savePhoto(bucket, photo) {
  if (!photo) return '';
  if (!bucket) fail('照片儲存暫時無法使用。', 503);
  const key = shopPhotoPrefix + crypto.randomUUID();
  await bucket.put(key, photo.image, { httpMetadata: { contentType: photo.type } });
  return key;
}

const dbNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const batchIsOpen = "(b.starts_at IS NULL OR b.starts_at<=" + dbNow + ") AND b.ends_at>" + dbNow;
const publishedInWindow = "(p.batch_id IS NULL OR EXISTS (SELECT 1 FROM welfare_shop_batches b WHERE b.id=p.batch_id AND " + batchIsOpen + "))";
const insertProduct = 'INSERT INTO welfare_shop_products (id,source_key,category,series,name,condition_note,pickup_note,price_cents,stock,employee_limit,status,photo_key,updated_at,venue_id,venue_assigned_by,batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
const productColumns = 'p.id,p.category,p.series,p.name,p.condition_note,p.pickup_note,p.employee_limit,p.revision';
const roundedPrice = '(CAST((p.price_cents+50)/100 AS INTEGER)*100)';
const orderColumns = 'id,product_id,product_name,price_cents,quantity,status,created_at,updated_at';

async function memberView(request, env, url, path, onNewRequest) {
  const db = env.DB;
  const uid = await verifiedBenefitCookieUid(request, env);
  if (!uid) fail('請先登入 LINE。', 401);
  const identity = await db.prepare('SELECT member_type,status,bind_status,display_name,' + rosterMatch +
    ' AS roster_match FROM welfare_members WHERE line_user_id=?').bind(uid).first();
  if (!activeBenefitEmployee(identity)) fail('福利品商城限已綁定的在職員工使用。', 403);
  if (!identity.roster_match) fail('員工名冊查無對應工號，請洽福委會確認。', 403);

  if (path === '/api/welfare-shop/photo' && request.method === 'GET') {
    const row = await db.prepare("SELECT p.photo_key FROM welfare_shop_products p WHERE p.id=? AND p.status='published' AND " + publishedInWindow)
      .bind(url.searchParams.get('id') || '').first();
    return servePhoto(env.R2_BUCKET, row?.photo_key);
  }
  if (path !== '/api/welfare-shop') fail('找不到資料。', 404);
  if (request.method === 'GET') {
    const [catalog, orders, clock] = await db.batch([
      db.prepare("SELECT " + productColumns + "," + roundedPrice + " AS price_cents,(photo_key<>'') AS has_photo,stock-" + used +
        " AS available,b.ends_at,v.name AS venue_name FROM welfare_shop_products p LEFT JOIN welfare_shop_batches b ON b.id=p.batch_id" +
        " LEFT JOIN welfare_shop_venues v ON v.id=p.venue_id" +
        " WHERE p.status='published' AND (p.batch_id IS NULL OR (" + batchIsOpen + ")) ORDER BY p.series,p.category,p.name,p.id LIMIT 200"),
      db.prepare('SELECT ' + orderColumns + ' FROM welfare_shop_requests WHERE employee_uid=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(uid),
      db.prepare('SELECT ' + dbNow + ' AS server_time, (SELECT MIN(b.starts_at) FROM welfare_shop_batches b' +
        ' WHERE b.starts_at>' + dbNow + ' AND b.starts_at<b.ends_at AND EXISTS' +
        " (SELECT 1 FROM welfare_shop_products p WHERE p.batch_id=b.id AND p.status='published')) AS next_starts_at")
    ]);
    return json({ products: catalog.results, requests: orders.results, viewer: identity.display_name || '員工',
      ...clock.results[0] });
  }
  if (request.method !== 'POST') fail('不支援此操作。', 405);

  const data = await shopJson(request, 4096);
  if (!uuid.test(data?.id || '') || !uuid.test(data?.product_id || '')) fail('申請編號不正確。');
  const revision = integer(data.revision, 1, Number.MAX_SAFE_INTEGER);
  const quantity = integer(data.quantity, 1, 9999);
  const quotedPrice = data.unit_price_cents === undefined ? null : integer(data.unit_price_cents, 0, 100000000);
  const phone = Object.hasOwn(data, 'contact_phone') ? contactPhone(data.contact_phone) : null;
  // Keep contact readable by older clients and by the previous admin UI after a rollback.
  const contact = field(data.contact ?? phone, 120, true), comment = field(data.comment || '', 500);
  const now = new Date().toISOString();
  const [, notification, , result] = await db.batch([
    db.prepare("INSERT INTO welfare_shop_requests (id,product_id,employee_uid,product_name,price_cents,quantity,contact,contact_phone,comment,status,created_at,updated_at)" +
      " SELECT ?,p.id,?,p.name," + roundedPrice + ",?,?,?,?,'pending',?,? FROM welfare_shop_products p" +
      " WHERE p.id=? AND p.status='published' AND p.revision=? AND p.employee_limit>=? AND p.stock-" + used + ">=?" +
      " AND " + publishedInWindow +
      // An older open form carries no quote. It can submit only if rounding would not change its price.
      " AND " + roundedPrice + "=COALESCE(?,p.price_cents)" +
      " AND EXISTS (SELECT 1 FROM welfare_members WHERE line_user_id=? AND " + employee + " AND " + rosterMatch + ") ON CONFLICT DO NOTHING")
      .bind(data.id, uid, quantity, contact, phone, comment, now, now, data.product_id, revision, quantity, quantity, quotedPrice, uid),
    db.prepare('INSERT INTO welfare_shop_telegram(request_id,next_at,updated_at) SELECT ?,?,? WHERE changes()=1')
      .bind(data.id,Date.parse(now),Date.parse(now)),
    db.prepare("INSERT INTO welfare_shop_director_email(request_id,venue_id,venue_name,recipient,employee_name,status,updated_at)" +
      " SELECT ?,v.id,v.name,v.email,?,?,? FROM welfare_shop_products p JOIN welfare_shop_venues v ON v.id=p.venue_id" +
      " WHERE changes()=1 AND p.id=?")
      .bind(data.id, identity.display_name || '員工', welfareShopEmailConfigured(env) ? 'pending' : 'disabled', Date.parse(now), data.product_id),
    db.prepare('SELECT ' + orderColumns + ' FROM welfare_shop_requests WHERE id=? AND employee_uid=? AND product_id=?')
      .bind(data.id, uid, data.product_id)
  ]);
  if (!result.results.length) fail('商品可能尚未上架或已下架、價格或庫存已變更，或您已有此商品的申請。請重新整理。', 409);
  if (notification.meta.changes === 1) onNewRequest?.(data.id);
  return json({ request: result.results[0] });
}

async function servePhoto(bucket, key) {
  const object = key?.startsWith(shopPhotoPrefix) && await bucket?.get(key);
  const type = object?.httpMetadata?.contentType;
  if (!object || !['image/jpeg','image/png','image/webp'].includes(type)) fail('找不到照片。', 404);
  return new Response(object.body, { headers: { ...headers, 'Content-Type': type } });
}

async function saveVenue(db, data, actor, now) {
  const name = field(data.name, 80, true);
  const directorName = field(data.director_name, 80, true);
  const email = field(data.email, 254, true);
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email)) {
    fail('請填寫一組有效的通知信箱。');
  }
  const id = data.id || crypto.randomUUID();
  if (!uuid.test(id)) fail('館別編號不正確。');
  if (data.id) {
    const revision = integer(data.revision, 1, Number.MAX_SAFE_INTEGER);
    const result = await db.prepare('UPDATE OR IGNORE welfare_shop_venues SET name=?,director_name=?,email=?,updated_by=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?')
      .bind(name,directorName,email,actor,now,id,revision).run();
    if (!result.meta.changes) fail('館名已存在，或設定已更新。請重新整理後確認。', 409);
  } else {
    const result = await db.prepare('INSERT INTO welfare_shop_venues(id,name,director_name,email,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING')
      .bind(id,name,directorName,email,actor,now).run();
    if (!result.meta.changes) fail('館名已存在，請選擇既有館別進行編輯。', 409);
  }
  return json({ id });
}

function batchDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    fail('請填寫'+label+'日期與時間（台北時間）。');
  }
  const epoch = Date.parse(value + ':00+08:00');
  if (!Number.isFinite(epoch) || new Date(epoch + 8 * 60 * 60 * 1000).toISOString().slice(0,16) !== value) {
    fail('請填寫有效的'+label+'日期與時間。');
  }
  return new Date(epoch).toISOString();
}

async function saveBatch(db, data, actor, now) {
  const name = field(data.name, 80, true);
  const deadline = batchDate(data.ends_at, '下架');
  if (deadline <= now) fail('下架時間須晚於現在。');
  const id = data.id ?? crypto.randomUUID();
  if (typeof id !== 'string' || !uuid.test(id)) fail('批次編號不正確。');
  const revision = data.id ? integer(data.revision,1,Number.MAX_SAFE_INTEGER) : null;
  let startsAt = null;
  if (Object.hasOwn(data,'starts_at')) {
    if (data.starts_at !== '' && data.starts_at !== null) startsAt = batchDate(data.starts_at, '上架');
  } else if (data.id) {
    const previous = await db.prepare('SELECT starts_at FROM welfare_shop_batches WHERE id=? AND revision=?').bind(id,revision).first();
    startsAt = previous?.starts_at ?? null;
  }
  if (startsAt && startsAt >= deadline) fail('上架時間須早於下架時間。');
  const result = data.id
    ? await db.prepare("UPDATE OR IGNORE welfare_shop_batches SET name=?,starts_at=?,ends_at=?,updated_by=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?")
      .bind(name,startsAt,deadline,actor,now,id,revision).run()
    : await db.prepare("INSERT INTO welfare_shop_batches(id,name,starts_at,ends_at,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(name) DO NOTHING")
      .bind(id,name,startsAt,deadline,actor,now).run();
  if (!result.meta.changes) fail('批次名稱已存在，或批次已更新。請重新整理後確認。', 409);
  return json({ id });
}

async function findBatchId(db, id) {
  if (id === undefined || id === null || id === '') return null;
  if (typeof id !== 'string' || !uuid.test(id) ||
      !await db.prepare('SELECT 1 FROM welfare_shop_batches WHERE id=?').bind(id).first()) fail('找不到指定的批次。');
  return id;
}

async function assignProducts(db, data, actor, now) {
  const batch = data.action === 'batch.assign';
  const id = batch ? data.batch_id : data.venue_id;
  const allowed = batch
    ? "EXISTS (SELECT 1 FROM welfare_shop_batches WHERE id=? AND ends_at>" + dbNow + ")"
    : "EXISTS (SELECT 1 FROM welfare_shop_venues WHERE id=?)";
  if (typeof id !== 'string' || !uuid.test(id) || !(await db.prepare('SELECT '+allowed+' AS allowed').bind(id).first()).allowed) {
    fail(batch ? '請指定尚未到期的批次。' : '找不到指定的出貨館別。');
  }
  if (!Array.isArray(data.products) || data.products.length < 1 || data.products.length > 200) {
    fail('請選擇要套用的商品。');
  }
  const products = data.products.map(item => {
    if (typeof item?.id !== 'string' || !uuid.test(item.id)) fail('商品編號不正確。');
    return { id: item.id, revision: integer(item.revision, 1, Number.MAX_SAFE_INTEGER) };
  });
  if (new Set(products.map(item => item.id)).size !== products.length) fail('選取的商品有重複。');
  const result = await db.prepare(
    "WITH matching AS MATERIALIZED (SELECT p.id FROM json_each(?) AS item JOIN welfare_shop_products p" +
    " ON p.id=json_extract(item.value,'$.id') AND p.revision=json_extract(item.value,'$.revision'))" +
    " UPDATE welfare_shop_products SET " + (batch ? 'batch_id=?,' : 'venue_id=?,venue_assigned_by=?,') +
    "revision=revision+1,updated_at=?" +
    " WHERE " + allowed + " AND id IN (SELECT id FROM matching WHERE (SELECT count(*) FROM matching)=?)"
  ).bind(JSON.stringify(products),id,...(batch?[]:[actor]),now,id,products.length).run();
  if (result.meta.changes !== products.length) fail('商品或指定的設定已變更，請重新整理後確認。', 409);
  return json({ assigned: result.meta.changes });
}

async function adminView(request, env, url, path, admin) {
  if (admin?.role !== 'admin' || !admin.actor) fail('請使用福委會管理員帳號。', 403);
  const db = env.DB, bucket = env.R2_BUCKET;
  if (path === '/admin-api/welfare-shop/settings') {
    if (request.method === 'GET') {
      const [venues, products] = await db.batch([
        db.prepare('SELECT id,name,director_name,email,revision FROM welfare_shop_venues ORDER BY name,id'),
        db.prepare('SELECT id,name,venue_id,revision FROM welfare_shop_products ORDER BY series,name,id LIMIT 200')
      ]);
      return json({ venues: venues.results, products: products.results, email_configured: welfareShopEmailConfigured(env) });
    }
    if (request.method !== 'POST') fail('不支援此操作。', 405);
    const data = await shopJson(request, 32_000);
    const now = new Date().toISOString();
    if (data?.action === 'venue.save') return saveVenue(db, data, admin.actor, now);
    if (data?.action === 'venue.assign' || data?.action === 'batch.assign') return assignProducts(db, data, admin.actor, now);
    if (data?.action === 'batch.save') return saveBatch(db, data, admin.actor, now);
    fail('不支援此操作。');
  }
  if (path === '/admin-api/welfare-shop/photo' && request.method === 'GET') {
    const row = await db.prepare('SELECT photo_key FROM welfare_shop_products WHERE id=?').bind(url.searchParams.get('id') || '').first();
    return servePhoto(bucket, row?.photo_key);
  }
  if (path !== '/admin-api/welfare-shop') fail('找不到資料。', 404);
  if (request.method === 'GET') {
    const state = url.searchParams.get('status') || 'pending';
    if (!['pending','confirmed','completed','cancelled'].includes(state)) fail('申請狀態不正確。');
    const offset = integer(Number(url.searchParams.get('offset') || 0), 0, 100000);
    const [catalog, orders, venues, batches] = await db.batch([
      db.prepare('SELECT ' + productColumns + ',p.venue_id,p.batch_id,p.price_cents,p.stock,p.status,(p.photo_key<>\'\') AS has_photo,' + used +
        ' AS committed FROM welfare_shop_products p ORDER BY p.updated_at DESC,p.id LIMIT 200'),
      db.prepare('SELECT ' + orderColumns.split(',').map(c => 'r.' + c).join(',') +
        ',r.contact,r.contact_phone,r.comment,COALESCE(m.display_name,\'員工\') AS employee,e.venue_name,e.status AS email_status FROM welfare_shop_requests r' +
        ' LEFT JOIN welfare_members m ON m.line_user_id=r.employee_uid LEFT JOIN welfare_shop_director_email e ON e.request_id=r.id' +
        ' WHERE r.status=? ORDER BY r.created_at,r.id LIMIT 51 OFFSET ?').bind(state, offset),
      db.prepare('SELECT id,name,director_name,email,revision FROM welfare_shop_venues ORDER BY name,id'),
      db.prepare('SELECT b.id,b.name,b.starts_at,b.ends_at,b.revision,b.ends_at<='+dbNow+
        ' AS expired,COALESCE(b.starts_at>'+dbNow+',0) AS scheduled,' +
        ' (SELECT COUNT(*) FROM welfare_shop_products p WHERE p.batch_id=b.id) AS product_count' +
        ' FROM welfare_shop_batches b ORDER BY b.ends_at DESC,b.id')
    ]);
    return json({ products: catalog.results, requests: orders.results.slice(0, 50), next: orders.results.length > 50,
      venues: venues.results, batches: batches.results, email_configured: welfareShopEmailConfigured(env) });
  }
  if (request.method !== 'POST') fail('不支援此操作。', 405);
  const data = await shopJson(request, 8_000_000);
  const now = new Date().toISOString();
  if (data?.action === 'import') {
    if (!Array.isArray(data.products) || data.products.length < 1 || data.products.length > 50) fail('每批請匯入 1 至 50 件商品。');
    const batchId = await findBatchId(db,data.batch_id);
    const entries = data.products.map(item => ({
      source: field(item.source_key, 180, true),
      values: product({ ...item, stock: 0, employee_limit: 1 }),
      photo: item.photo ? photoData(item.photo) : null
    }));
    if (new Set(entries.map(item => item.source)).size !== entries.length) fail('匯入批次有重複商品編號。');
    const planned = [];
    for (const { source, values, photo } of entries) {
      if (await db.prepare('SELECT 1 FROM welfare_shop_products WHERE source_key=?').bind(source).first()) continue;
      const key = await savePhoto(bucket, photo);
      planned.push({ key, stmt: db.prepare(insertProduct + ' ON CONFLICT(source_key) DO NOTHING')
        .bind(crypto.randomUUID(), source, ...values, 'draft', key, now, null, null, batchId) });
    }
    const results = planned.length ? await db.batch(planned.map(item => item.stmt)) : [];
    const count = results.filter(row => row.meta.changes === 1).length;
    await Promise.allSettled(planned.filter((item, i) => item.key && results[i].meta.changes !== 1).map(item => bucket.delete(item.key)));
    return json({ imported: count, skipped: entries.length - count });
  }
  if (data?.action === 'product.hide') {
    if (typeof data.id !== 'string' || !uuid.test(data.id)) fail('商品編號不正確。');
    if (!Number.isSafeInteger(data.revision) || data.revision < 1) fail('商品版本不正確，請重新整理。');
    const result = await db.prepare("UPDATE welfare_shop_products SET status='hidden',revision=revision+1,updated_at=? WHERE id=? AND status='published' AND revision=?")
      .bind(now, data.id, data.revision).run();
    if (!result.meta.changes) fail('商品狀態已變更，請重新整理後確認。', 409);
    return json({ id: data.id, status: 'hidden' });
  }
  if (data?.action === 'save') {
    const values = product(data);
    const status = data.status;
    if (!['draft','published','hidden'].includes(status)) fail('上架狀態不正確。');
    if (status === 'published' && (!data.pickup_note?.trim() || values[6] < 1)) fail('上架前請填寫取貨說明，並確認庫存。');
    const id = data.id || crypto.randomUUID();
    if (!uuid.test(id)) fail('商品編號不正確。');
    const revision = data.id ? integer(data.revision, 1, Number.MAX_SAFE_INTEGER) : null;
    const previous = data.id
      ? await db.prepare('SELECT status,batch_id FROM welfare_shop_products WHERE id=? AND revision=?').bind(id,revision).first()
      : null;
    if (data.id && !previous) fail('商品已被更新，請重新整理。', 409);
    const batchId = Object.hasOwn(data,'batch_id') ? await findBatchId(db,data.batch_id) : previous?.batch_id ?? null;
    if (status==='published' && !(previous?.status==='published' && previous.batch_id===batchId)) {
      if (!batchId || !await db.prepare('SELECT 1 FROM welfare_shop_batches WHERE id=? AND ends_at>'+dbNow).bind(batchId).first()) {
        fail('上架前請先指定尚未到期的批次。');
      }
    }
    const venueId = data.venue_id || null;
    if (venueId && (typeof venueId !== 'string' || !uuid.test(venueId) ||
        !await db.prepare('SELECT 1 FROM welfare_shop_venues WHERE id=?').bind(venueId).first())) {
      fail('找不到指定的出貨館別。');
    }
    const photo = data.photo ? photoData(data.photo) : null;
    if (!data.id) {
      const key = await savePhoto(bucket, photo);
      await db.prepare(insertProduct).bind(id, null, ...values, status, key, now, venueId, venueId ? admin.actor : null, batchId).run();
    } else {
      const key = await savePhoto(bucket, photo);
      const result = await db.prepare('UPDATE welfare_shop_products AS p SET category=?,series=?,name=?,condition_note=?,pickup_note=?,' +
        "price_cents=?,stock=?,employee_limit=?,status=?,photo_key=COALESCE(NULLIF(?,''),photo_key)," +
        'venue_assigned_by=CASE WHEN ? AND venue_id IS NOT ? THEN ? ELSE venue_assigned_by END,' +
        'venue_id=CASE WHEN ? THEN ? ELSE venue_id END,batch_id=?,revision=revision+1,updated_at=?' +
        ' WHERE id=? AND revision=? AND ?>=' + used)
        .bind(...values, status, key, Number(Object.hasOwn(data,'venue_id')), venueId, admin.actor,
          Number(Object.hasOwn(data,'venue_id')), venueId, batchId, now, id, revision, values[6]).run();
      if (!result.meta.changes) {
        if (key) await bucket.delete(key);
        fail('商品已被更新，或庫存低於已申請數量。請重新整理。', 409);
      }
    }
    return json({ id });
  }
  if (data?.action === 'status') {
    const transitions = { pending: ['confirmed','cancelled'], confirmed: ['completed','cancelled'] };
    if (!uuid.test(data.id || '') || !Object.hasOwn(transitions, data.previous) || !transitions[data.previous].includes(data.status)) fail('申請狀態不正確。');
    const result = await db.prepare('UPDATE welfare_shop_requests SET status=?,updated_at=?,managed_by=? WHERE id=? AND status=?')
      .bind(data.status, now, admin.actor, data.id, data.previous).run();
    if (!result.meta.changes) fail('申請已由其他人處理。請重新整理。', 409);
    return json({ success: true });
  }
  fail('不支援此操作。', 400);
}

export async function handleWelfareShop(request, env, readAdmin, onNewRequest) {
  const url = new URL(request.url), path = url.pathname;
  const admin = path.startsWith('/admin-api/welfare-shop');
  try {
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)) fail('請由商城頁面操作。', 403);
    if (admin) return await adminView(request, env, url, path, await readAdmin());
    return await memberView(request, env, url, path, onNewRequest);
  } catch (error) {
    return json({ error: error.shopStatus ? error.message : '福利品商城暫時無法使用，請稍後重試。' }, error.shopStatus || 503);
  }
}
