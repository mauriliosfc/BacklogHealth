// Minimal XLSX writer — zero dependencies, browser ES module.
// Uses inline strings (t="inlineStr") to avoid sharedStrings.xml entirely.

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function _crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const b of bytes) crc = _crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const _enc  = new TextEncoder();
const _utf8 = s => _enc.encode(s);

// Strip characters illegal in XML 1.0 (all control chars except tab/LF/CR)
const _sanitize = s => String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
const _x = s => _sanitize(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ── ZIP stored entry (no compression) ────────────────────────────────────────
function _zipEntry(name, data) {
  const nb  = _utf8(name);
  const crc = _crc32(data);
  const sz  = data.length;

  const local = new Uint8Array(30 + nb.length);
  const lv    = new DataView(local.buffer);
  lv.setUint32(0,  0x04034B50, true); // local file header signature
  lv.setUint16(4,  20,         true); // version needed
  lv.setUint16(6,  0,          true); // general purpose flags
  lv.setUint16(8,  0,          true); // compression method: stored
  lv.setUint16(10, 0,          true); // last mod time
  lv.setUint16(12, 0,          true); // last mod date
  lv.setUint32(14, crc,        true); // crc-32
  lv.setUint32(18, sz,         true); // compressed size
  lv.setUint32(22, sz,         true); // uncompressed size
  lv.setUint16(26, nb.length,  true); // file name length
  lv.setUint16(28, 0,          true); // extra field length
  local.set(nb, 30);

  return { local, data, nb, crc, sz };
}

// ── Assemble ZIP ──────────────────────────────────────────────────────────────
function _buildZip(entries) {
  const offsets = [];
  let pos = 0;
  for (const e of entries) { offsets.push(pos); pos += e.local.length + e.sz; }

  const cdEntries = entries.map((e, i) => {
    const cd = new Uint8Array(46 + e.nb.length);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0,  0x02014B50, true);
    dv.setUint16(4,  20,         true);
    dv.setUint16(6,  20,         true);
    dv.setUint16(8,  0,          true);
    dv.setUint16(10, 0,          true);
    dv.setUint16(12, 0,          true);
    dv.setUint16(14, 0,          true);
    dv.setUint32(16, e.crc,      true);
    dv.setUint32(20, e.sz,       true);
    dv.setUint32(24, e.sz,       true);
    dv.setUint16(28, e.nb.length, true);
    dv.setUint16(30, 0,          true);
    dv.setUint16(32, 0,          true);
    dv.setUint16(34, 0,          true);
    dv.setUint16(36, 0,          true);
    dv.setUint32(38, 0,          true);
    dv.setUint32(42, offsets[i], true);
    cd.set(e.nb, 46);
    return cd;
  });

  const cdSize   = cdEntries.reduce((s, e) => s + e.length, 0);
  const cdOffset = pos;

  const eocd = new Uint8Array(22);
  const ev   = new DataView(eocd.buffer);
  ev.setUint32(0,  0x06054B50,     true);
  ev.setUint16(4,  0,              true);
  ev.setUint16(6,  0,              true);
  ev.setUint16(8,  entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize,         true);
  ev.setUint32(16, cdOffset,       true);
  ev.setUint16(20, 0,              true);

  const total  = cdOffset + cdSize + eocd.length;
  const result = new Uint8Array(total);
  let   p      = 0;
  for (const e of entries) {
    result.set(e.local, p); p += e.local.length;
    result.set(e.data,  p); p += e.sz;
  }
  for (const cd of cdEntries) { result.set(cd, p); p += cd.length; }
  result.set(eocd, p);
  return result;
}

// ── XLSX static XML parts ─────────────────────────────────────────────────────
// No sharedStrings — uses inline strings only.
const _CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const _RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const _WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const _WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"    Target="styles.xml"/>
</Relationships>`;

// Two cell XFs: 0 = normal, 1 = bold header
const _STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
</styleSheet>`;

// ── Column letter helper ───────────────────────────────────────────────────────
function _colLetter(n) {
  let s = '';
  n++;
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ── Sheet builder — inline strings ────────────────────────────────────────────
function _buildSheetXml(headers, rows) {
  const allRows   = [headers, ...rows];
  const sheetRows = allRows.map((row, ri) =>
    `<row r="${ri + 1}">${
      row.map((cell, ci) => {
        const ref   = `${_colLetter(ci)}${ri + 1}`;
        const style = ri === 0 ? ' s="1"' : '';
        return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${_x(cell)}</t></is></c>`;
      }).join('')
    }</row>`
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Builds a minimal .xlsx file.
 * @param {string[]} headers - Column headers (bold row 1).
 * @param {string[][]} rows  - Data rows.
 * @returns {Uint8Array} Raw bytes of the .xlsx file.
 */
export function buildXlsx(headers, rows) {
  const sheet = _buildSheetXml(headers, rows);
  const files = [
    { name: '[Content_Types].xml',        content: _CONTENT_TYPES },
    { name: '_rels/.rels',                content: _RELS          },
    { name: 'xl/workbook.xml',            content: _WORKBOOK      },
    { name: 'xl/_rels/workbook.xml.rels', content: _WORKBOOK_RELS },
    { name: 'xl/styles.xml',              content: _STYLES        },
    { name: 'xl/worksheets/sheet1.xml',   content: sheet          },
  ];
  return _buildZip(files.map(f => _zipEntry(f.name, _utf8(f.content))));
}
