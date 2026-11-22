// A single-sheet SpreadsheetML package. Inline strings never become formulas.
// ZIP uses the standard stored method, so the Worker needs no Node APIs or CDN.
const encoder = new TextEncoder();
const MAX_XML_BYTES = 20 * 1024 * 1024;
const xml = value => String(value).replace(/_x([0-9a-f]{4})_/gi, '_x005F_x$1_')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const columnName = index => {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
};
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function zip(files) {
  const entries = Object.entries(files).map(([name, content]) => {
    const data = encoder.encode(content), filename = encoder.encode(name);
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return { data, filename, crc: (crc ^ 0xffffffff) >>> 0 };
  });
  const size = entries.reduce((n, e) => n + 30 + e.filename.length + e.data.length + 46 + e.filename.length, 22);
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  const u16 = (offset, value) => view.setUint16(offset, value, true);
  const u32 = (offset, value) => view.setUint32(offset, value, true);
  let offset = 0;
  for (const e of entries) {
    e.offset = offset;
    u32(offset, 0x04034b50); u16(offset + 4, 20); u16(offset + 6, 0x800); u16(offset + 12, 33);
    u32(offset + 14, e.crc); u32(offset + 18, e.data.length); u32(offset + 22, e.data.length); u16(offset + 26, e.filename.length);
    bytes.set(e.filename, offset + 30); bytes.set(e.data, offset + 30 + e.filename.length);
    offset += 30 + e.filename.length + e.data.length;
  }
  const central = offset;
  for (const e of entries) {
    u32(offset, 0x02014b50); u16(offset + 4, 20); u16(offset + 6, 20); u16(offset + 8, 0x800); u16(offset + 14, 33);
    u32(offset + 16, e.crc); u32(offset + 20, e.data.length); u32(offset + 24, e.data.length);
    u16(offset + 28, e.filename.length); u32(offset + 42, e.offset); bytes.set(e.filename, offset + 46);
    offset += 46 + e.filename.length;
  }
  u32(offset, 0x06054b50); u16(offset + 8, entries.length); u16(offset + 10, entries.length);
  u32(offset + 12, offset - central); u32(offset + 16, central);
  return bytes;
}

// Number/date cells are explicit objects. All saved answers stay literal text.
export function buildRosterWorkbook(headers, rows, { sheetName = '報名出席名單', columnWidths = [] } = {}) {
  if (typeof sheetName !== 'string' || !sheetName.trim() || sheetName.length > 31 || /[\\/?:*\[\]\u0000-\u001f]/.test(sheetName)) throw new RangeError('Excel 工作表名稱無效。');
  if (headers.length > 16384) throw new RangeError('名冊欄位超過 Excel 上限，未下載不完整名冊。');
  const records = [];
  let xmlBytes = 0;
  const append = (values, index, header = false) => {
    const cells = values.map((value, column) => {
      const ref = columnName(column) + (index + 1);
      if (!header && value && typeof value === 'object' && Number.isFinite(value.number)) return `<c r="${ref}" s="${value.date ? 2 : 0}" t="n"><v>${value.number}</v></c>`;
      const text = String(value ?? '');
      if (text.length > 32767) throw new RangeError('名冊欄位內容超過 Excel 上限，未下載截斷的資料。');
      if (!text) return `<c r="${ref}" s="${header ? 1 : 0}"/>`;
      return `<c r="${ref}" s="${header ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
    }).join('');
    const record = `<row r="${index + 1}"${header ? ' ht="34" customHeight="1"' : ''}>${cells}</row>`;
    xmlBytes += encoder.encode(record).length;
    if (xmlBytes > MAX_XML_BYTES) throw new RangeError('名冊內容超過 20 MB，請聯絡管理員分批匯出，未下載不完整名冊。');
    records.push(record);
  };
  append(headers, 0, true);
  rows.forEach((row, index) => append(row, index + 1));
  const range = `A1:${columnName(headers.length - 1)}${rows.length + 1}`;
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const prolog = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zip({
    '[Content_Types].xml': prolog + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': prolog + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': prolog + `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': prolog + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': prolog + `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy/mm/dd hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft JhengHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16654A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': prolog + `<worksheet xmlns="${ns}"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number.isFinite(columnWidths[i]) && columnWidths[i] > 0 && columnWidths[i] <= 255 ? columnWidths[i] : i === 0 ? 8 : i === 3 ? 14 : 26}" customWidth="1"/>`).join('')}</cols><sheetData>${records.join('')}</sheetData><autoFilter ref="${range}"/></worksheet>`,
  });
}
