// field-definitions.js — the 11 user-facing PII field categories.
// Ported from the original doc_redaction browser extension (shared.js).
// `keywords` are the field-label strings commonly seen in Taiwanese HR
// documents ("姓名：王小明" / "電話：0912-345-678"); the keyword detector
// uses them to pull the value that follows a label on the same line.

export const FIELD_DEFINITIONS = [
  { id: 'name', label: '姓名', replacement: '[姓名]', keywords: ['姓名', '名字', '員工姓名', '人員姓名', '負責人姓名', '負責人', '代表人', '總經理', '聯絡人', '申請人'] },
  { id: 'id_number', label: '身分證號', replacement: '[身分證號]', keywords: ['身分證', '身份證', '證號', '身分證字號'] },
  { id: 'phone', label: '電話', replacement: '[電話]', keywords: ['電話', '手機', '手機號碼', '電話號碼', '公司電話', '聯絡電話', '連絡電話', '分機', 'phone', 'tel'] },
  { id: 'email', label: 'Email', replacement: '[Email]', keywords: ['email', 'e-mail', '電子信箱', '電子郵件', 'mail'] },
  { id: 'address', label: '地址', replacement: '[地址]', keywords: ['地址', '住址', '戶籍地址', '通訊地址', '公司地址', '聯絡地址', '登記地址'] },
  { id: 'birthday', label: '生日', replacement: '[生日]', keywords: ['生日', '出生日期', '出生年月日', '出生日'] },
  { id: 'company', label: '公司名稱', replacement: '[公司名稱]', keywords: ['公司', '公司名稱', '所屬公司', '任職公司', '服務單位', '機構名稱', '抽樣公司'] },
  { id: 'tax_id', label: '統一編號', replacement: '[統一編號]', keywords: ['統一編號', '統編', '公司統編', '營利事業統一編號'] },
  { id: 'project', label: '專案名稱', replacement: '[專案名稱]', keywords: ['專案', '專案名稱', '專案代號', '計畫名稱', '計畫代號', 'project'] },
  { id: 'amount', label: '金額', replacement: '[金額]', keywords: ['金額', '薪資', '薪水', '月薪', '年薪', '報酬', '資本額', '實收資本額', '費用', '預算'] },
  { id: 'account', label: '帳號資訊', replacement: '[帳號資訊]', keywords: ['帳號', '銀行帳號', '帳戶', '帳戶資訊', '登入帳號', '員工編號', '工號', '帳號資訊'] }
];

// Default detection settings: every field enabled, letter-style labels
// switch to numeric once a document contains more than 10 distinct names.
export const DEFAULT_SETTINGS = {
  labelThreshold: 10,
  fields: FIELD_DEFINITIONS.map((def) => ({ id: def.id, enabled: true })),
  customKeywords: []
};
