const FILES = Object.freeze({
  "食": "food", "衣": "fashion", "住": "living", "行": "travel",
  "育": "education", "樂": "leisure", "醫療": "medical",
  "生活服務": "lifestyle", "其他": "other",
});

const LEGACY_DEFAULTS = new Set([
  "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_4_news.png",
  "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80",
]);

export function vendorDefaultCover(category) {
  const key = String(category || "").trim();
  const name = Object.hasOwn(FILES, key) ? FILES[key] : "other";
  return "/file/" + encodeURIComponent(`vendor-default-covers/20261003-v1/${name}.jpg`);
}

export function resolveVendorCover(category, cover, logo = "") {
  for (const value of [cover, logo]) {
    if (String(value || "").trim() && !LEGACY_DEFAULTS.has(String(value).trim())) return value;
  }
  return vendorDefaultCover(category);
}
