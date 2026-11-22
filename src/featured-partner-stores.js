const FEATURED_PARTNER_STORE_ROUTES = new Map([
  ["/featured-partner-stores", "zh"],
  ["/featured-partner-stores-id", "id"],
  ["/featured-partner-stores-th", "th"],
  ["/current-offers", "zh"],
  ["/current-offers-id", "id"],
  ["/current-offers-th", "th"],
]);

export function resolveFeaturedPartnerStoreLocale(pathname) {
  return FEATURED_PARTNER_STORE_ROUTES.get(String(pathname || "")) || null;
}

export function isFeaturedPartnerStoreQuery(url) {
  const value = String(url?.searchParams?.get("featured") || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function normalizeFeaturedVendorFlag(value) {
  if (value === true || value === 1) return 1;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized) ? 1 : 0;
}

export function featuredPartnerStoreSqlFilter(featuredOnly, alias = "v") {
  if (!featuredOnly) return "";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid SQL alias.");
  return `AND COALESCE(${alias}.is_current_featured, 0) = 1`;
}
