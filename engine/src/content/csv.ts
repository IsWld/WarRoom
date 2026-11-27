/**
 * Minimal CSV parser for content files (RFC 4180 style): comma separated, optional double
 * quotes, "" escapes a quote inside a quoted field, CRLF or LF line endings. The first row
 * is the header. Blank lines and lines starting with # are skipped.
 *
 * Throws an Error with a `line` property on malformed input.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = splitRows(text);
  if (rows.length === 0) return [];
  const [headerRow, ...dataRows] = rows;
  const header = headerRow!.fields.map((h) => h.trim());
  if (header.some((h) => h === '')) throw lineError('Empty column name in header', headerRow!.line);
  if (new Set(header).size !== header.length)
    throw lineError('Duplicate column name in header', headerRow!.line);

  return dataRows.map(({ fields, line }) => {
    if (fields.length !== header.length) {
      throw lineError(`Expected ${header.length} fields, found ${fields.length}`, line);
    }
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      record[name] = fields[i]!.trim();
    });
    return record;
  });
}

interface Row {
  fields: string[];
  line: number;
}

function splitRows(text: string): Row[] {
  const rows: Row[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let rowHasContent = false;
  let rowHasQuotedStart = false;

  const endRow = () => {
    fields.push(field);
    const isBlank = !rowHasContent && fields.length === 1 && fields[0]!.trim() === '';
    const isComment = fields[0]!.trimStart().startsWith('#') && !rowHasQuotedStart;
    if (!isBlank && !isComment) rows.push({ fields, line: rowLine });
    fields = [];
    field = '';
    rowHasContent = false;
    rowHasQuotedStart = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (field.trim() !== '') throw lineError('Quote in the middle of an unquoted field', line);
      if (fields.length === 0) rowHasQuotedStart = true;
      field = '';
      inQuotes = true;
      rowHasContent = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
      rowHasContent = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += c;
    }
  }
  if (inQuotes) throw lineError('Unclosed quote', rowLine);
  if (field !== '' || fields.length > 0) endRow();
  return rows;
}

function lineError(message: string, line: number): Error {
  return Object.assign(new Error(`${message} (line ${line})`), { line });
}
