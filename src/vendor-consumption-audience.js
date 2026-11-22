// Read-only audience projection. The caller must first authenticate the merchant
// and supply the vendor ID bound to that authenticated session.
const asPage = value => {
  if (value == null || value === '') return 1;
  if (!/^\d+$/.test(String(value))) throw Object.assign(new Error('頁碼不正確。'),{status:400});
  const page=Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw Object.assign(new Error('頁碼不正確。'),{status:400});
  return page;
};

/**
 * A confirmed personal-QR POS transaction has a server-generated id of
 * `pos:<vendor_id>:<UUIDv4>`. Other redemption origins are intentionally not
 * inferred from status alone. Only valid LINE identities which still agree
 * with their linked member record count toward this projection.
 * No LINE UID, member ID, QR payload, employee data or amount is returned.
 */
export async function getVendorConsumptionAudience(db, authorizedVendorId, options={}) {
  if (!db || typeof authorizedVendorId !== 'string' || !authorizedVendorId.trim() || authorizedVendorId.length>200 || /[\x00-\x1f]/.test(authorizedVendorId)) {
    throw Object.assign(new Error('無法確認廠商權限。'),{status:403});
  }
  const vendorId=authorizedVendorId.trim(),page=asPage(options.page),pageSize=20;
  if (options.q != null && typeof options.q !== 'string') throw Object.assign(new Error('搜尋條件不正確。'),{status:400});
  const query=(options.q||'').trim();
  if (query.length>100) throw Object.assign(new Error('搜尋條件過長。'),{status:400});
  const prefix='pos:'+vendorId+':';
  // Use the locally cached LINE profile only if the member name is absent or a placeholder.
  // This is a read-only exact-UID join; it never makes a LINE API call.
  const candidateName="trim(CASE WHEN trim(COALESCE(m.display_name,''))='' OR trim(m.display_name) IN ('LINE 使用者','未命名用戶','用戶','LINE 會員') THEN COALESCE(lp.display_name,'') ELSE m.display_name END)";
  const compactName=`replace(replace(replace(replace(replace(${candidateName},' ',''),'-',''),'(',''),')',''),'+','')`;
  const suffix="substr(r.id,-36)";
  // Aggregate transactions before name masking: the bounded character scan
  // must run per distinct member, not once for every transaction.
  const base=`WITH grouped AS (
    SELECT r.line_user_id AS uid,MIN(m.id) AS member_id,
      MIN(datetime(COALESCE(NULLIF(trim(r.redeemed_at),''),NULLIF(trim(r.created_at),'')))) AS first_consumed_at,
      MAX(datetime(COALESCE(NULLIF(trim(r.redeemed_at),''),NULLIF(trim(r.created_at),'')))) AS last_consumed_at,
      COUNT(*) AS consumption_count
    FROM welfare_redemptions r
    JOIN welfare_members m ON m.id=r.member_id AND m.line_user_id=r.line_user_id
    WHERE r.vendor_id=? AND r.status='confirmed'
      AND length(r.line_user_id)=33 AND substr(r.line_user_id,1,1)='U'
      AND substr(r.line_user_id,2) NOT GLOB '*[^0-9a-fA-F]*'
      AND substr(r.id,1,length(?))=? AND length(r.id)=length(?)+36
      AND substr(${suffix},9,1)='-' AND substr(${suffix},14,1)='-'
      AND substr(${suffix},19,1)='-' AND substr(${suffix},24,1)='-'
      AND substr(${suffix},15,1)='4' AND lower(substr(${suffix},20,1)) IN ('8','9','a','b')
      AND length(replace(${suffix},'-',''))=32
      AND replace(${suffix},'-','') NOT GLOB '*[^0-9a-fA-F]*'
    GROUP BY r.line_user_id
  ), scoped AS (
    SELECT grouped.uid,grouped.first_consumed_at,grouped.last_consumed_at,grouped.consumption_count,
      CASE WHEN ${candidateName}='' OR ${candidateName} IN ('LINE 使用者','未命名用戶','用戶','LINE 會員')
        OR length(${candidateName})>160
        OR EXISTS (WITH RECURSIVE name_offsets(n) AS (
          SELECT 1 UNION ALL SELECT n+1 FROM name_offsets WHERE n<min(160,length(${candidateName}))
        ) SELECT 1 FROM name_offsets WHERE (
          (substr(${candidateName},n,1)='U' AND length(substr(${candidateName},n+1,32))=32
            AND substr(${candidateName},n+1,32) NOT GLOB '*[^0-9a-fA-F]*')
          OR (length(substr(${compactName},n,7))=7 AND substr(${compactName},n,7) NOT GLOB '*[^0-9]*')
        ))
        OR ${candidateName}=m.id
        OR (trim(COALESCE(m.employee_no,''))<>'' AND ${candidateName}=trim(m.employee_no))
        OR (trim(COALESCE(m.phone,''))<>'' AND ${candidateName}=trim(m.phone))
        OR ${candidateName} GLOB '*?@?*.?*'
        THEN 'LINE 會員' ELSE ${candidateName} END AS display_name
    FROM grouped
    JOIN welfare_members m ON m.id=grouped.member_id AND m.line_user_id=grouped.uid
    LEFT JOIN line_user_profiles lp ON lp.line_user_id=grouped.uid
  )`;
  const binds=[vendorId,prefix,prefix,prefix,query];
  const count=await db.prepare(base+' SELECT COUNT(*) AS total FROM scoped WHERE instr(lower(display_name),lower(?))>0').bind(...binds).first();
  const rows=await db.prepare(base+' SELECT display_name,first_consumed_at,last_consumed_at,consumption_count FROM scoped WHERE instr(lower(display_name),lower(?))>0 ORDER BY last_consumed_at IS NULL, last_consumed_at DESC, uid ASC LIMIT ? OFFSET ?').bind(...binds,pageSize,(page-1)*pageSize).all();
  const total=Number(count?.total||0);
  return {success:true,data:{items:(rows.results||[]).map(row=>({display_name:row.display_name,first_consumed_at:row.first_consumed_at,last_consumed_at:row.last_consumed_at,consumption_count:Number(row.consumption_count)})),page,page_size:pageSize,total,has_more:page*pageSize<total}};
}
