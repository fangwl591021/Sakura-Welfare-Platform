const LABELS = {
  zh: {
    categories: {
      "食": "食", "衣": "衣", "住": "住", "行": "行", "育": "育", "樂": "樂",
      "醫療": "醫療", "生活服務": "生活服務", "其他": "其他",
    },
    regions: {
      "北部": "北部", "中部": "中部", "南部": "南部", "花東": "花東", "離島": "離島", "其他": "其他",
    },
  },
  id: {
    categories: {
      "食": "Makanan", "衣": "Pakaian", "住": "Hunian", "行": "Transportasi", "育": "Pendidikan", "樂": "Hiburan",
      "醫療": "Layanan medis", "生活服務": "Layanan sehari-hari", "其他": "Lainnya",
    },
    regions: {
      "北部": "Utara", "中部": "Tengah", "南部": "Selatan", "花東": "Hualien–Taitung", "離島": "Pulau terluar", "其他": "Lainnya",
    },
  },
  th: {
    categories: {
      "食": "อาหาร", "衣": "เสื้อผ้า", "住": "ที่พักอาศัย", "行": "การเดินทาง", "育": "การศึกษา", "樂": "สันทนาการ",
      "醫療": "การแพทย์", "生活服務": "บริการในชีวิตประจำวัน", "其他": "อื่นๆ",
    },
    regions: {
      "北部": "ภาคเหนือ", "中部": "ภาคกลาง", "南部": "ภาคใต้", "花東": "ฮัวเหลียน–ไถตง", "離島": "หมู่เกาะรอบนอก", "其他": "อื่นๆ",
    },
  },
};

export function getPartnerStoreOptionLabels(locale = "zh") {
  return LABELS[locale] || LABELS.zh;
}
