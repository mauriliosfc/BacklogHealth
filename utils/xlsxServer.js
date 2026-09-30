// Server-side XLSX writer — Node.js only, uses zlib for DEFLATE compression.
// Generates a valid .xlsx (Office Open XML) with a single worksheet.
'use strict';

const zlib = require('zlib');

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

function _crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = _crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── ZIP entry with DEFLATE compression ───────────────────────────────────────
function _zipEntry(name, content) {
  const raw        = Buffer.from(content, 'utf8');
  const compressed = zlib.deflateRawSync(raw, { level: 6 });
  const nb         = Buffer.from(name, 'utf8');
  const crc        = _crc32(raw);

  const local = Buffer.alloc(30 + nb.length);
  local.writeUInt32LE(0x04034b50, 0);           // local file header sig
  local.writeUInt16LE(20, 4);                    // version needed
  local.writeUInt16LE(0, 6);                     // general purpose flag
  local.writeUInt16LE(8, 8);                     // compression: deflated
  local.writeUInt16LE(0, 10);                    // mod time
  local.writeUInt16LE(0, 12);                    // mod date
  local.writeUInt32LE(crc, 14);                  // crc-32
  local.writeUInt32LE(compressed.length, 18);    // compressed size
  local.writeUInt32LE(raw.length, 22);           // uncompressed size
  local.writeUInt16LE(nb.length, 26);            // name length
  local.writeUInt16LE(0, 28);                    // extra length
  nb.copy(local, 30);

  return { local, compressed, nb, crc, compressedSize: compressed.length, rawSize: raw.length };
}

// ── Assemble ZIP ──────────────────────────────────────────────────────────────
function _buildZip(entries) {
  const offsets = [];
  let pos = 0;
  for (const e of entries) {
    offsets.push(pos);
    pos += e.local.length + e.compressedSize;
  }

  const cdParts = entries.map((e, i) => {
    const cd = Buffer.alloc(46 + e.nb.length);
    cd.writeUInt32LE(0x02014b50, 0);           // central directory sig
    cd.writeUInt16LE(20, 4);                    // version made by
    cd.writeUInt16LE(20, 6);                    // version needed
    cd.writeUInt16LE(0, 8);                     // flags
    cd.writeUInt16LE(8, 10);                    // compression: deflated
    cd.writeUInt16LE(0, 12);                    // mod time
    cd.writeUInt16LE(0, 14);                    // mod date
    cd.writeUInt32LE(e.crc, 16);                // crc-32
    cd.writeUInt32LE(e.compressedSize, 20);     // compressed size
    cd.writeUInt32LE(e.rawSize, 24);            // uncompressed size
    cd.writeUInt16LE(e.nb.length, 28);          // name length
    cd.writeUInt16LE(0, 30);                    // extra length
    cd.writeUInt16LE(0, 32);                    // comment length
    cd.writeUInt16LE(0, 34);                    // disk number start
    cd.writeUInt16LE(0, 36);                    // internal attributes
    cd.writeUInt32LE(0, 38);                    // external attributes
    cd.writeUInt32LE(offsets[i], 42);           // local header offset
    e.nb.copy(cd, 46);
    return cd;
  });

  const cdSize   = cdParts.reduce((s, e) => s + e.length, 0);
  const cdOffset = pos;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);            // end of central dir sig
  eocd.writeUInt16LE(0, 4);                      // disk number
  eocd.writeUInt16LE(0, 6);                      // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);         // entries on disk
  eocd.writeUInt16LE(entries.length, 10);        // total entries
  eocd.writeUInt32LE(cdSize, 12);                // central dir size
  eocd.writeUInt32LE(cdOffset, 16);              // central dir offset
  eocd.writeUInt16LE(0, 20);                     // comment length

  return Buffer.concat([
    ...entries.flatMap(e => [e.local, e.compressed]),
    ...cdParts,
    eocd,
  ]);
}

// ── XML helpers ───────────────────────────────────────────────────────────────
// Strip illegal XML 1.0 control characters (keep tab/LF/CR)
const _sanitize = s => String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
const _x = s => _sanitize(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ── XLSX static parts ─────────────────────────────────────────────────────────
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"          ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml"     ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Incidentes" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"    Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"       Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>
  </numFmts>
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
  <cellXfs count="3">
    <xf numFmtId="0"   fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0"   fontId="1" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
</styleSheet>`;

// ── Excel date serial (days since Dec 31 1899, +1 for Excel's fake Feb 29 1900)
function _dateSerial(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date  = new Date(Date.UTC(y, m - 1, d));
  const epoch = new Date(Date.UTC(1899, 11, 31));
  let serial  = Math.round((date - epoch) / 86400000);
  if (serial >= 60) serial++; // compensate Excel leap-year bug
  return serial;
}

// ── Column letter ─────────────────────────────────────────────────────────────
function _colLetter(n) {
  let s = '';
  n++;
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ── Build shared strings + sheet XML ─────────────────────────────────────────
function _buildParts(headers, rows) {
  const strings = [];
  const strMap  = new Map();
  const si = v => {
    const s = _sanitize(v);
    if (!strMap.has(s)) { strMap.set(s, strings.length); strings.push(s); }
    return strMap.get(s);
  };

  const allRows   = [headers, ...rows];
  const sheetRows = allRows.map((row, ri) =>
    `<row r="${ri + 1}">${
      row.map((cell, ci) => {
        const ref = `${_colLetter(ci)}${ri + 1}`;
        if (ri === 0) return `<c r="${ref}" t="s" s="1"><v>${si(cell)}</v></c>`;
        if (typeof cell === 'string' && cell.startsWith('DATE:')) {
          return `<c r="${ref}" s="2"><v>${_dateSerial(cell.slice(5))}</v></c>`;
        }
        if (typeof cell === 'number') {
          return `<c r="${ref}"><v>${cell}</v></c>`;
        }
        return `<c r="${ref}" t="s"><v>${si(cell)}</v></c>`;
      }).join('')
    }</row>`
  ).join('');

  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `count="${strings.length}" uniqueCount="${strings.length}">\n` +
    strings.map(s => `<si><t xml:space="preserve">${_x(s)}</t></si>`).join('\n') +
    `\n</sst>`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;

  return { sheet, sharedStrings };
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Builds a .xlsx Buffer.
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {Buffer}
 */
function buildXlsx(headers, rows) {
  const { sheet, sharedStrings } = _buildParts(headers, rows);
  const files = [
    { name: '[Content_Types].xml',        content: CONTENT_TYPES  },
    { name: '_rels/.rels',                content: RELS           },
    { name: 'xl/workbook.xml',            content: WORKBOOK       },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS  },
    { name: 'xl/styles.xml',              content: STYLES         },
    { name: 'xl/sharedStrings.xml',       content: sharedStrings  },
    { name: 'xl/worksheets/sheet1.xml',   content: sheet          },
  ];
  return _buildZip(files.map(f => _zipEntry(f.name, f.content)));
}

module.exports = { buildXlsx };
