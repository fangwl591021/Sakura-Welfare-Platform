// Registration dates are stored as Taipei wall time, matching existing activity dates.
export function normalizeRegistrationWindow(data, existing = {}) {
  const result = {};
  for (const key of ["registration_start_at", "registration_end_at"]) {
    const value = Object.hasOwn(data, key) ? data[key] : existing?.[key] || "";
    if (value === "" || value == null) { result[key] = ""; continue; }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(value)) {
      throw new Error("請輸入有效的報名日期與時間（台北時間）。");
    }
    const local = value.replace("T", " ") + (value.length === 16 ? ":00" : "");
    const time = Date.parse(local.replace(" ", "T") + "+08:00");
    if (!Number.isFinite(time) || new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ") !== local) {
      throw new Error("請輸入有效的報名日期與時間（台北時間）。");
    }
    result[key] = local;
  }
  if (result.registration_start_at && result.registration_end_at && result.registration_start_at >= result.registration_end_at) {
    throw new Error("報名截止時間必須晚於接受報名時間。");
  }
  return result;
}

function timestamp(value) {
  let input = String(value).replace(" ", "T");
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(input)) input += "+08:00";
  return Date.parse(input);
}

export function registrationWindowState(event, now = Date.now()) {
  if (event.status !== "active") return "unavailable";
  if (event.end_at && !(now <= timestamp(event.end_at))) return "unavailable";
  if (event.registration_end_at && !(now < timestamp(event.registration_end_at))) return "closed";
  if (event.registration_start_at && !(now >= timestamp(event.registration_start_at))) return "not_started";
  return "open";
}

export const REGISTRATION_WINDOW_MESSAGES = {
  not_started: "此活動尚未到接受報名時間。",
  closed: "此活動報名已截止。",
  unavailable: "此活動目前未開放報名。"
};
