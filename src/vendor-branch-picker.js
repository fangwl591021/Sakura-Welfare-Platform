// A branch selection is always scoped to a visible vendor. This projection is
// public store information only; it never reads or grants employee benefits.
const clean = value => String(value ?? '').trim();
const unavailable = () => ({success:false, status:404, message:'此店家或分店目前無法查看。'});

/**
 * Read a vendor's public branches and resolve an optional branch identifier.
 * A missing branch ID means a multiple-branch vendor must be selected first;
 * a one-branch vendor is selected automatically for existing links.
 * Unknown/hidden/foreign IDs fail closed rather than falling back to another
 * branch. A vendor without public branches returns an empty selection so the
 * caller can retain the previous single-store display behavior.
 */
export async function readVendorBranchSelection(db, rawVendorId, rawLocationId = '') {
  const vendorId=clean(rawVendorId), locationId=clean(rawLocationId);
  if (!db || !vendorId || vendorId.length>200 || locationId.length>200) return unavailable();

  const vendor=await db.prepare(`SELECT id FROM welfare_vendors
    WHERE id=? AND COALESCE(is_hidden,0)=0 AND status IN ('approved','active')`).bind(vendorId).first();
  if (!vendor) return unavailable();

  const rows=await db.prepare(`SELECT id,branch_name,city,district,address,google_maps_url,
      contact_phone,business_hours,holiday_notice,parking_info,latitude,longitude
    FROM welfare_vendor_locations
    WHERE vendor_id=? AND COALESCE(NULLIF(TRIM(status),''),'active')='active'
      AND EXISTS (SELECT 1 FROM welfare_vendors v WHERE v.id=welfare_vendor_locations.vendor_id
        AND COALESCE(v.is_hidden,0)=0 AND v.status IN ('approved','active'))
    ORDER BY COALESCE(branch_name,''),id`).bind(vendorId).all();
  const locations=(rows.results||[]).map(row=>({
    id:clean(row.id),branch_name:clean(row.branch_name),city:clean(row.city),district:clean(row.district),
    address:clean(row.address),google_maps_url:clean(row.google_maps_url),contact_phone:clean(row.contact_phone),
    business_hours:clean(row.business_hours),holiday_notice:clean(row.holiday_notice),parking_info:clean(row.parking_info),
    latitude:row.latitude??null,longitude:row.longitude??null,
  }));
  const selected=locationId?locations.find(row=>row.id===locationId):locations.length===1?locations[0]:null;
  if (locationId && !selected) return unavailable();
  return {success:true,data:{vendorId,locations,selected,selectionRequired:!locationId&&locations.length>1}};
}
