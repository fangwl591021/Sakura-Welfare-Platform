import { activityScopeSql, editorCanReadEvent, readBoundedAdminJson } from './editor-access.js';
import { buildRosterWorkbook } from './activity-roster-xlsx.js';
import { csvCell } from './activity-roster-export.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const fail = (message, status = 409) => json({ success: false, message }, status);
const policies = ['event_once', 'per_prize'];
const maxAward = 1000;
const modes = ['employee_only', 'with_family'];
const emptyState = () => ({ policy: 'event_once', mode: 'employee_only', prizes: [], winners: [], actions: [], roster: null, frozenAt: null });
const selectRoster = `SELECT json_group_array(json_array(id, name, attendance)) AS roster FROM (
  SELECT r.id, COALESCE(NULLIF(TRIM(r.display_name), ''), NULLIF(TRIM(c.display_name), ''), '員工') AS name,
    CASE WHEN json_valid(c.raw_payload) THEN
      CASE WHEN json_type(c.raw_payload,'$.attendance_count')='integer'
      AND json_extract(c.raw_payload,'$.attendance_count') BETWEEN 1 AND 10000
      THEN json_extract(c.raw_payload,'$.attendance_count') END
    END AS attendance
  FROM welfare_activity_checkins c
  JOIN welfare_activity_registrations r ON r.event_id=c.event_id AND r.line_user_id=c.line_user_id
  WHERE c.event_id=? AND c.checkin_status='checked_in'
    AND EXISTS (SELECT 1 FROM welfare_members m WHERE m.line_user_id=c.line_user_id
      AND m.member_type IN ('employee','foreign_employee','manager') AND m.status='active' AND m.bind_status='bound')
  ORDER BY c.checked_at, r.id
)`;

function summarize(roster, mode) {
  let people = 0, unknown = 0;
  const ends = roster.map(([, , attendance]) => {
    if (mode === 'employee_only') return ++people;
    if (attendance == null) unknown++;
    people += attendance ?? 1;
    return people;
  });
  return { groups: roster.length, people, companions: people - roster.length, unknown, ends };
}

function randomIndex(size) {
  if (!Number.isInteger(size) || size < 1 || size > 0x100000000) throw new RangeError('Invalid lottery size');
  const sample = new Uint32Array(1), limit = 0x100000000 - (0x100000000 % size);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % size;
}

// Sample unused tickets without expanding each family's count into individual rows.
function drawTickets(size, count, blocked) {
  const used = [...blocked].sort((a, b) => a - b), chosen = [];
  while (chosen.length < count) {
    let index = randomIndex(size - used.length);
    let i = 0;
    while (i < used.length && used[i] <= index) { index++; i++; }
    used.splice(i, 0, index);
    chosen.push(index);
  }
  return chosen;
}

function ticketInfo(roster, ends, ticket) {
  let start = 0, end = ends.length - 1;
  while (start < end) {
    const mid = Math.floor((start + end) / 2);
    if (ticket < ends[mid]) end = mid;
    else start = mid + 1;
  }
  const name = roster[start][1], ordinal = ticket - (ends[start - 1] ?? 0);
  const suffix = ordinal ? '-' + ordinal : '';
  return { label: name + suffix, code: String(start + 1).padStart(4, '0') + suffix, ordinal };
}

function blockedTickets(state, prizeId) {
  return new Set(state.winners.filter(row => row.status === 'absent' || state.policy === 'event_once' || row.prizeId === prizeId)
    .map(row => row.ticket));
}

function present(state, roster, event, revision, extras = {}) {
  const { ends, ...attendance } = summarize(roster, state.mode);
  const otherMode = state.mode === 'with_family' ? 'employee_only' : 'with_family';
  const alternate = state.roster ? null : summarize(roster, otherMode);
  const attendancePreview = alternate ? { mode: otherMode, people: alternate.people, groups: alternate.groups,
    companions: alternate.companions, unknown: alternate.unknown } : null;
  return { success: true, event, revision, policy: state.policy, mode: state.mode, frozenAt: state.frozenAt, attendance, attendancePreview,
    prizes: state.prizes.map(prize => ({
      ...prize,
      drawn: state.winners.filter(row => row.prizeId === prize.id && row.status !== 'absent').length,
      eligible: attendance.people - blockedTickets(state, prize.id).size
    })),
    winners: state.winners.map(({ ticket, ...row }) => ({ ...row, ...ticketInfo(roster, ends, ticket) })), ...extras };
}

function resultsDownload(event, data, format) {
  const headers = ['獎項', '抽獎編號', '得獎者', '身分', '結果', '抽出時間（台北）', '確認／缺席時間（台北）', '缺席原因', '補抽對應編號'];
  const prizes = new Map(data.prizes.map(prize => [prize.id, prize.name]));
  const codes = new Map(data.winners.map(row => [row.id, row.code]));
  const time = value => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hourCycle: 'h23' }) : '';
  const rows = data.winners.map(row => [prizes.get(row.prizeId), row.code, row.label, row.ordinal ? '眷屬' : '員工',
    { drawn: '待領獎', claimed: '已領獎', absent: '缺席' }[row.status], time(row.drawnAt), time(row.changedAt),
    row.reason || '', codes.get(row.replaces) || '']);
  const xlsx = format === 'xlsx';
  return new Response(xlsx ? buildRosterWorkbook(headers, rows, { sheetName: '活動抽獎結果' })
    : '\ufeff' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n'), {
    headers: {
      'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv;charset=UTF-8',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(event.title + '-抽獎紀錄.' + format)
    }
  });
}

export async function handleActivityLottery(request, db, actor) {
  if (!db) return fail('暫時無法連線至活動資料。', 503);
  if (!/^(admin:|line:|editor:(activity_editor|club_editor):).+/.test(actor || '')) {
    return fail('請使用具活動管理權限的帳號。', 403);
  }
  const url = new URL(request.url);
  const isPost = request.method === 'POST';
  if (!isPost && request.method !== 'GET') return fail('不支援此操作方式。', 405);
  let body;
  try { body = isPost ? await readBoundedAdminJson(request, 65000) : {}; }
  catch (error) { return fail(error.status === 413 ? '資料過大。' : '操作資料格式有誤。', error.status === 413 ? 413 : 400); }
  const eventId = isPost ? body?.event_id : url.searchParams.get('event_id');
  if (typeof eventId !== 'string' || !eventId || eventId.length > 100) return fail('請先選取活動。', 400);
  if (!await editorCanReadEvent(db, actor, eventId)) return fail('此活動不在您的管理範圍。', 403);
  try {
    const event = await db.prepare('SELECT id, title, status FROM welfare_activity_events WHERE id=?').bind(eventId).first();
    if (!event) return fail('找不到活動。', 404);
    const current = await db.prepare('SELECT revision, state_json FROM welfare_activity_lotteries WHERE event_id=?').bind(eventId).first();
    const revision = current?.revision ?? 0, state = current ? JSON.parse(current.state_json) : emptyState();
    const snapshot = state.roster === null ? await db.prepare(selectRoster).bind(eventId).first('roster') : null;
    const roster = state.roster ?? JSON.parse(snapshot);
    const attendance = summarize(roster, state.mode);
    const extra = state.roster === null ? { rosterVersion: await digest(snapshot) } : {};
    if (!isPost) {
      const data = present(state, roster, event, revision, extra), format = url.searchParams.get('export');
      return ['xlsx', 'csv'].includes(format) ? resultsDownload(event, data, format) : json(data);
    }
    const { action, request_id: requestId, prize_id: prizeId, winner_id: winnerId } = body;
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) return fail('操作識別有誤，請重新載入。', 400);
    const inputHash = await digest(JSON.stringify(body));
    const audit = state.actions.find(row => row.id === requestId);
    if (audit) {
      if (audit.actor !== actor || audit.inputHash !== inputHash) {
        return fail('操作識別已使用，請重新載入。');
      }
      return json(present(state, roster, event, revision, { ...extra, replayed: true }));
    }
    if (body.revision !== revision) return fail('抽獎紀錄已更新，請重新載入並核對。');
    const now = new Date().toISOString();
    const prize = state.prizes.find(row => row.id === prizeId);
    const winner = state.winners.find(row => row.id === winnerId && row.prizeId === prizeId);
    const entry = { id: requestId, inputHash, action, actor, at: now, prizeId: prizeId || '', winnerId: winnerId || '' };
    let firstDraw = false;
    if (action === 'save_prize') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const quantity = body.quantity;
      if (!name || name.length > 100 || !Number.isInteger(quantity) || quantity < 1 || quantity > maxAward) return fail('請輸入獎項名稱和有效名額。', 400);
      if (prizeId && !prize) return fail('找不到獎項。', 404);
      if (state.winners.some(row => row.prizeId === prizeId)) return fail('已正式抽出的獎項無法修改。');
      entry.before = prize ? { ...prize } : null;
      const saved = { id: prizeId || crypto.randomUUID(), name, quantity };
      entry.savedPrizeId = saved.id;
      entry.after = { name, quantity };
      if (prize) Object.assign(prize, saved);
      else state.prizes.push(saved);
    } else if (action === 'save_settings') {
      if (state.roster) return fail('正式開獎後，中獎規則與名單已鎖定。');
      if (!policies.includes(body.policy) || !modes.includes(body.mode)) return fail('無效的抽獎資格或中獎規則。', 400);
      entry.before = { policy: state.policy, mode: state.mode };
      entry.after = { policy: body.policy, mode: body.mode };
      Object.assign(state, entry.after);
    } else if (action === 'claim') {
      if (!winner || winner.status !== 'drawn') return fail('這筆中獎結果已處理，請重新載入。');
      winner.status = 'claimed'; winner.changedAt = now;
    } else if (['trial', 'draw', 'redraw'].includes(action)) {
      if (!prize) return fail('請選取獎項。', 400);
      if (!state.roster && body.rosterVersion !== extra.rosterVersion) return fail('簽到名單已變更，請重新載入並核對人數。');
      if (action !== 'trial' && body.confirmed !== true) return fail('請確認後再執行正式抽獎。', 400);
      if (action === 'draw' && !state.roster && attendance.unknown && body.confirmedUnknown !== true) {
        return fail('請先核對未記錄實到人數的簽到。');
      }
      const drawn = state.winners.filter(row => row.prizeId === prizeId && row.status !== 'absent').length;
      const count = action === 'redraw' ? 1 : prize.quantity - drawn;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (action === 'redraw' && (!winner || winner.status !== 'drawn' || !reason || reason.length > 200)) {
        return fail('只能補抽待領獎的名額，並請填寫缺席原因。');
      }
      const blocked = blockedTickets(state, prizeId);
      if (!count || count > attendance.people - blocked.size) return fail('可抽人數不足，或此獎項名額已抽完。');
      const tickets = drawTickets(attendance.people, count, blocked);
      if (action === 'trial') {
        return json(present(state, roster, event, revision, { ...extra, trial: tickets.map(ticket => ticketInfo(roster, attendance.ends, ticket)) }));
      }
      firstDraw = state.roster === null;
      if (firstDraw) { state.roster = roster; state.frozenAt = now; }
      if (action === 'redraw') { winner.status = 'absent'; winner.changedAt = now; winner.reason = reason; }
      const newWinners = tickets.map(ticket => ({ id: crypto.randomUUID(), ticket, prizeId, status: 'drawn', drawnAt: now,
        ...(action === 'redraw' ? { replaces: winner.id } : {}) }));
      entry.resultIds = newWinners.map(row => row.id);
      state.winners.push(...newWinners);
    } else {
      return fail('不支援的抽獎操作。', 400);
    }
    state.actions.push(entry);
    const next = JSON.stringify(state);
    if (new TextEncoder().encode(next).length > 1500000) return fail('此活動的抽獎紀錄超過容量上限，尚未變更資料。', 413);
    const scope = activityScopeSql(actor), params = [eventId, revision + 1, next, eventId];
    const snapshotGuard = firstDraw ? `AND (${selectRoster})=?` : '';
    if (firstDraw) params.push(eventId, snapshot);
    const result = await db.prepare(`INSERT INTO welfare_activity_lotteries(event_id,revision,state_json)
      SELECT ?,?,? FROM welfare_activity_events e WHERE e.id=? ${scope ? 'AND ' + scope : ''} ${snapshotGuard}
      ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json
      WHERE welfare_activity_lotteries.revision=?`).bind(...params, revision).run();
    if (!result.meta?.changes) return fail('簽到或抽獎資料已變更，請重新載入並核對。');
    return json(present(state, roster, event, revision + 1, state.roster ? {} : extra));
  } catch {
    return fail('暫時無法讀取或儲存抽獎資料。若剛才已送出，請使用同一次操作重試或重新載入核對。', 503);
  }
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
