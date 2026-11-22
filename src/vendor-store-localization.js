export function normalizeStoreLocale(value) {
  const locale = String(value || "").toLowerCase().split(/[-_]/)[0];
  return locale === "id" || locale === "th" ? locale : "zh";
}

// Only first-party store pages inherit locale; external merchant links stay intact.
export function localizeStoreUrl(value, locale, origin) {
  const raw = String(value || "");
  if (!raw) return raw;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || url.pathname !== "/vendor-store") return raw;
    url.searchParams.set("lang", normalizeStoreLocale(locale));
    return url.pathname + url.search + url.hash;
  } catch {
    return raw;
  }
}

// Presentation only: never change stored schedules or infer whether a store is open.
export function localizeBusinessHours(value, locale) {
  const text = String(value ?? "");
  const language = normalizeStoreLocale(locale);
  if (language === "zh" || !text) return text;
  const days = language === "id"
    ? ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu", "Minggu"]
    : ["วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์", "วันอาทิตย์", "วันอาทิตย์"];
  const weekdays = Object.fromEntries(Array.from("一二三四五六日天", (day, index) => [day, days[index]]));
  const labels = language === "id" ? {
    "營業時間": "Jam operasional", "营业时间": "Jam operasional",
    "國定假日照常營業": "Tetap buka pada hari libur nasional", "假日照常營業": "Tetap buka pada hari libur",
    "國定假日": "Hari libur nasional", "例假日": "Hari libur", "假日": "Hari libur",
    "公休日": "Hari tutup", "公休": "Tutup", "店休": "Tutup", "休息": "Tutup", "休業": "Tutup", "休息中": "Tutup",
    "全天營業": "Buka 24 jam", "24小時營業": "Buka 24 jam", "24 小時營業": "Buka 24 jam", "照常營業": "Buka seperti biasa",
    "每日": "Setiap hari", "每天": "Setiap hari", "平日": "Hari kerja", "週末": "Akhir pekan", "周末": "Akhir pekan",
    "上午": "Pagi", "下午": "Sore", "晚上": "Malam", "中午": "Siang", "午休": "Istirahat siang", "次日": "Hari berikutnya", "隔日": "Hari berikutnya",
  } : {
    "營業時間": "เวลาเปิดทำการ", "营业时间": "เวลาเปิดทำการ",
    "國定假日照常營業": "เปิดตามปกติในวันหยุดนักขัตฤกษ์", "假日照常營業": "เปิดตามปกติในวันหยุด",
    "國定假日": "วันหยุดนักขัตฤกษ์", "例假日": "วันหยุด", "假日": "วันหยุด",
    "公休日": "วันหยุดร้าน", "公休": "ปิด", "店休": "ปิด", "休息": "ปิด", "休業": "ปิด", "休息中": "ปิด",
    "全天營業": "เปิด 24 ชั่วโมง", "24小時營業": "เปิด 24 ชั่วโมง", "24 小時營業": "เปิด 24 ชั่วโมง", "照常營業": "เปิดตามปกติ",
    "每日": "ทุกวัน", "每天": "ทุกวัน", "平日": "วันธรรมดา", "週末": "วันสุดสัปดาห์", "周末": "วันสุดสัปดาห์",
    "上午": "ช่วงเช้า", "下午": "ช่วงบ่าย", "晚上": "ช่วงค่ำ", "中午": "ช่วงเที่ยง", "午休": "พักกลางวัน", "次日": "วันถัดไป", "隔日": "วันถัดไป",
  };
  const dayPattern = /(?:星期|週|周|禮拜|礼拜)([一二三四五六日天])/g;
  let result = text
    .replace(/(?:星期|週|周|禮拜|礼拜)([一二三四五六日天])\s*(?:至|到)\s*(?:(?:星期|週|周|禮拜|礼拜))?([一二三四五六日天])/g, (_, from, to) => weekdays[from] + " – " + weekdays[to])
    .replace(/每(?=(?:星期|週|周|禮拜|礼拜)[一二三四五六日天])/g, language === "id" ? "Setiap " : "ทุก")
    .replace(dayPattern, (_, day) => weekdays[day]);
  const knownLabels = Object.keys(labels).sort((a, b) => b.length - a.length).join("|");
  // Avoid translating a label inside unrelated words such as 休息區.
  result = result.replace(new RegExp("(?:" + knownLabels + ")(?![\\p{Script=Han}])", "gu"), label => labels[label]);
  return result;
}

export const STORE_COPY = {
  zh: {
    page: "店家首頁", loading: "讀取中...", partner: "櫻花福委會特約店", unnamed: "未命名店家",
    icon: "店", intro: "店家介紹", address: "地址", phone: "電話", offers: "優惠活動", share: "分享名片",
    info: "店家資訊", hours: "營業時間", noHours: "尚未設定營業時間。", storeUrl: "商店網址", website: "網站", social: "社群", open: "開啟",
    noIntro: "店家尚未填寫介紹。", noOffers: "目前沒有已核准的優惠活動。", employee: "員工優惠", visitor: "訪客價",
    policy: "提供給櫻花員工的優惠政策", noPolicy: "尚未填寫員工優惠政策。",
    loadFailed: "讀取店家失敗", copied: "已複製店家首頁連結", dm: "店家 DM", carousel: "店家 DM 跑馬燈", slide: "圖片",
  },
  id: {
    page: "Halaman toko", loading: "Memuat...", partner: "Mitra SAKURA Welfare", unnamed: "Toko tanpa nama",
    icon: "S", intro: "Tentang toko", address: "Alamat", phone: "Telepon", offers: "Promo", share: "Bagikan toko",
    info: "Informasi toko", hours: "Jam operasional", noHours: "Jam operasional belum tersedia.", storeUrl: "Toko online", website: "Situs web", social: "Media sosial", open: "Buka",
    noIntro: "Deskripsi toko belum tersedia.", noOffers: "Belum ada promo yang disetujui.", employee: "Diskon karyawan", visitor: "Harga pengunjung",
    policy: "Ketentuan diskon karyawan SAKURA", noPolicy: "Ketentuan diskon karyawan belum tersedia.",
    loadFailed: "Gagal memuat toko", copied: "Tautan toko telah disalin", dm: "Brosur toko", carousel: "Brosur toko", slide: "Gambar",
  },
  th: {
    page: "หน้าร้านค้า", loading: "กำลังโหลด...", partner: "ร้านค้าพันธมิตร SAKURA Welfare", unnamed: "ร้านค้าที่ยังไม่มีชื่อ",
    icon: "S", intro: "เกี่ยวกับร้าน", address: "ที่อยู่", phone: "โทรศัพท์", offers: "โปรโมชัน", share: "แชร์ร้านค้า",
    info: "ข้อมูลร้านค้า", hours: "เวลาเปิดทำการ", noHours: "ยังไม่ได้ระบุเวลาเปิดทำการ", storeUrl: "ร้านค้าออนไลน์", website: "เว็บไซต์", social: "โซเชียลมีเดีย", open: "เปิด",
    noIntro: "ยังไม่มีคำแนะนำร้านค้า", noOffers: "ยังไม่มีโปรโมชันที่อนุมัติแล้ว", employee: "ส่วนลดพนักงาน", visitor: "ราคาบุคคลทั่วไป",
    policy: "เงื่อนไขส่วนลดสำหรับพนักงาน SAKURA", noPolicy: "ยังไม่ได้ระบุเงื่อนไขส่วนลดพนักงาน",
    loadFailed: "โหลดข้อมูลร้านค้าไม่สำเร็จ", copied: "คัดลอกลิงก์ร้านค้าแล้ว", dm: "โบรชัวร์ร้านค้า", carousel: "โบรชัวร์ร้านค้า", slide: "รูปภาพ",
  },
};
