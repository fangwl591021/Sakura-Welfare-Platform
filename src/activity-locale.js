export function normalizeActivityLocale(value) {
  const language = String(value || "").toLowerCase().split(/[-_]/)[0];
  return ["id", "th"].includes(language) ? language : "zh";
}

export const ACTIVITY_COPY = {
  zh: {
    editRegistration:'修改報名',saveRegistration:'儲存修改',cancelEdit:'取消修改',registrationUpdated:'報名修改已儲存',
    registrationChanged:'報名資料已更新，請重新載入後再修改。',editClosed:'此活動目前不開放修改報名。',checkedIn:'已完成簽到，報名資料無法再修改。',
    registrationUpcoming: "尚未開放報名", registrationOpen: "開放報名中",
    registrationStarts: "接受報名時間", registrationEnds: "報名截止時間",
    registrationNotStarted: "此活動尚未到接受報名時間。", registrationClosed: "此活動報名已截止。",
    language: "zh-Hant", dateLocale: "zh-TW", title: "活動報名", activities: "活動專區", close: "返回／關閉",
    offers: "本期特約", submit: "確認報名", select: "請選擇", cover: "活動封面", login: "LINE 登入",
    imageUnavailable: "封面暫時無法顯示，點此開啟圖片。",
    loginRequired: "登入 LINE 後查看可報名的活動。", checking: "正在確認 LINE 身分...", loading: "正在載入活動...",
    empty: "目前沒有可顯示的活動。", sending: "正在送出報名...", done: "報名完成", retry: "重新載入",
    failed: "無法取得活動，請稍後重試。", identity: "無法確認 LINE 身分，請重新登入。",
    sdk: "LINE SDK 載入失敗，請從 LINE 重新開啟。", denied: "無權限，請使用已授權帳號登入。",
    closed: "此活動目前未開放報名。", noForm: "此活動尚未設定報名欄位。",
    changed: "欄位版本已更新，請重新載入後再確認。", invalid: "請確認必填欄位、選項及人數後再送出。",
    original: "部分內容暫以原文顯示，報名功能仍可使用。", leave: "尚未送出的內容將不會保留，確定切換語言？"
  },
  id: {
    editRegistration:'Ubah pendaftaran',saveRegistration:'Simpan perubahan',cancelEdit:'Batalkan perubahan',registrationUpdated:'Perubahan pendaftaran tersimpan',
    registrationChanged:'Data pendaftaran telah berubah. Muat ulang sebelum mengubahnya.',editClosed:'Pendaftaran kegiatan ini tidak dapat diubah saat ini.',checkedIn:'Anda sudah check-in. Pendaftaran tidak dapat diubah.',
    registrationUpcoming: "Pendaftaran belum dibuka", registrationOpen: "Pendaftaran dibuka",
    registrationStarts: "Pendaftaran dibuka", registrationEnds: "Batas pendaftaran",
    registrationNotStarted: "Pendaftaran kegiatan ini belum dimulai.", registrationClosed: "Pendaftaran kegiatan ini sudah ditutup.",
    language: "id", dateLocale: "id-ID", title: "Pendaftaran kegiatan", activities: "Kegiatan", close: "Kembali / Tutup",
    offers: "Mitra pilihan", submit: "Konfirmasi pendaftaran", select: "Pilih", cover: "Poster kegiatan", login: "Masuk dengan LINE",
    imageUnavailable: "Poster tidak dapat ditampilkan. Buka gambar.",
    loginRequired: "Masuk dengan LINE untuk melihat kegiatan yang dapat Anda ikuti.", checking: "Memverifikasi identitas LINE...", loading: "Memuat kegiatan...",
    empty: "Belum ada kegiatan yang dapat ditampilkan.", sending: "Mengirim pendaftaran...", done: "Pendaftaran berhasil", retry: "Muat ulang",
    failed: "Kegiatan tidak dapat dimuat. Silakan coba lagi.", identity: "Identitas LINE tidak dapat diverifikasi. Silakan masuk kembali.",
    sdk: "LINE tidak dapat dimuat. Silakan buka kembali melalui LINE.", denied: "Anda tidak memiliki akses. Gunakan akun yang berwenang.",
    closed: "Pendaftaran kegiatan ini sedang ditutup.", noForm: "Formulir pendaftaran belum tersedia.",
    changed: "Formulir telah diperbarui. Muat ulang sebelum mengirim.", invalid: "Periksa kolom wajib, pilihan, dan jumlah peserta sebelum mengirim.",
    original: "Sebagian konten ditampilkan dalam bahasa asli. Pendaftaran tetap tersedia.", leave: "Isian yang belum dikirim akan hilang. Ganti bahasa?"
  },
  th: {
    editRegistration:'แก้ไขการลงทะเบียน',saveRegistration:'บันทึกการแก้ไข',cancelEdit:'ยกเลิกการแก้ไข',registrationUpdated:'บันทึกการแก้ไขการลงทะเบียนแล้ว',
    registrationChanged:'ข้อมูลการลงทะเบียนมีการเปลี่ยนแปลง โปรดโหลดใหม่ก่อนแก้ไข',editClosed:'ขณะนี้ไม่สามารถแก้ไขการลงทะเบียนกิจกรรมนี้ได้',checkedIn:'เช็กอินแล้ว ไม่สามารถแก้ไขการลงทะเบียนได้',
    registrationUpcoming: "ยังไม่เปิดรับลงทะเบียน", registrationOpen: "เปิดรับลงทะเบียน",
    registrationStarts: "เริ่มรับลงทะเบียน", registrationEnds: "ปิดรับลงทะเบียน",
    registrationNotStarted: "ยังไม่ถึงเวลาเปิดรับลงทะเบียนกิจกรรมนี้", registrationClosed: "กิจกรรมนี้ปิดรับลงทะเบียนแล้ว",
    language: "th", dateLocale: "th-TH", title: "ลงทะเบียนกิจกรรม", activities: "กิจกรรม", close: "กลับ / ปิด",
    offers: "ร้านค้าพิเศษ", submit: "ยืนยันการลงทะเบียน", select: "เลือก", cover: "โปสเตอร์กิจกรรม", login: "เข้าสู่ระบบด้วย LINE",
    imageUnavailable: "ไม่สามารถแสดงโปสเตอร์ได้ กดเพื่อเปิดรูปภาพ",
    loginRequired: "เข้าสู่ระบบด้วย LINE เพื่อดูกิจกรรมที่คุณสามารถลงทะเบียนได้", checking: "กำลังยืนยันตัวตน LINE...", loading: "กำลังโหลดกิจกรรม...",
    empty: "ขณะนี้ไม่มีกิจกรรมที่สามารถแสดงได้", sending: "กำลังส่งการลงทะเบียน...", done: "ลงทะเบียนสำเร็จ", retry: "โหลดใหม่",
    failed: "ไม่สามารถโหลดกิจกรรมได้ กรุณาลองอีกครั้ง", identity: "ไม่สามารถยืนยันตัวตน LINE ได้ กรุณาเข้าสู่ระบบอีกครั้ง",
    sdk: "ไม่สามารถโหลด LINE ได้ กรุณาเปิดผ่าน LINE อีกครั้ง", denied: "คุณไม่มีสิทธิ์เข้าถึง กรุณาใช้บัญชีที่ได้รับอนุญาต",
    closed: "กิจกรรมนี้ยังไม่เปิดรับลงทะเบียน", noForm: "ยังไม่มีแบบฟอร์มลงทะเบียนสำหรับกิจกรรมนี้",
    changed: "แบบฟอร์มได้รับการอัปเดต กรุณาโหลดใหม่ก่อนส่ง", invalid: "กรุณาตรวจสอบช่องที่จำเป็น ตัวเลือก และจำนวนผู้เข้าร่วมก่อนส่ง",
    original: "เนื้อหาบางส่วนแสดงเป็นภาษาต้นฉบับ แต่ยังสามารถลงทะเบียนได้", leave: "ข้อมูลที่ยังไม่ได้ส่งจะไม่ถูกบันทึก ต้องการเปลี่ยนภาษาหรือไม่?"
  }
};

// Browser source is kept literal because the Worker bundles the surrounding module.
export const activityLocaleBrowser = String.raw`function activityLocaleBrowser(locale, copy) {
  const offersUrl = "/current-offers" + (locale === "zh" ? "" : "-" + locale);
  function registrationUrl(id) {
    const url = new URL("/activity-registration", location.origin);
    if (id) url.searchParams.set("event_id", id);
    url.searchParams.set("lang", locale);
    return url.pathname + url.search;
  }
  function timestamp(value) {
    if (!value) return "";
    let input = String(value).replace(" ", "T");
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(input)) input += "+08:00";
    const date = new Date(input);
    return Number.isFinite(date.getTime()) ? date.toLocaleString(copy.dateLocale, { timeZone: "Asia/Taipei" }) : String(value);
  }
  function errorText(message, translations = {}, status = 0) {
    if (locale === "zh" && message) return message;
    const known = {
      '報名資料已更新，請重新載入後再修改。':copy.registrationChanged,
      '此活動目前不開放修改報名。':copy.editClosed,
      '已完成簽到，報名資料無法再修改。':copy.checkedIn,
      "無權限，請使用已授權帳號登入。": copy.denied,
      "此活動目前未開放報名。": copy.closed,
      "此活動尚未到接受報名時間。": copy.registrationNotStarted,
      "此活動報名已截止。": copy.registrationClosed,
      "此活動尚未設定報名欄位。": copy.noForm,
      "欄位版本已更新，請重新載入後再確認。": copy.changed
    };
    return known[message] || (Object.hasOwn(translations, message) ? translations[message] : "")
      || (status === 400 ? copy.invalid : copy.failed);
  }
  return { offersUrl, registrationUrl, timestamp, errorText };
}`;
