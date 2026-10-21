import { readText, type Source } from './source.ts';

/** One row of a table: column name -> value. */
export type Row = Record<string, number | string>;

const quote = (v: number | string) => {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Rows to CSV text: a header line with every column, then one line per row
 * (one row per time step works well in CODAP and spreadsheets).
 *
 * @param rows table rows; columns are taken from the first row
 */
export function toCsv(rows: Row[]): string {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const lines = [columns.map(quote).join(',')];
  for (const row of rows) lines.push(columns.map(c => quote(row[c] ?? '')).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Rows as a CSV Blob, ready to download. */
export const saveCsv = (rows: Row[]): Blob => new Blob([toCsv(rows)], { type: 'text/csv' });

/**
 * CSV text to rows. Numbers become numbers; quoted fields, commas and line
 * breaks inside quotes are handled.
 */
export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let field = '', record: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field); records.push(record); record = []; field = '';
    } else field += ch;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  const [header, ...body] = records.filter(r => r.length > 1 || r[0] !== '');
  if (!header) return [];
  return body.map(r => Object.fromEntries(header.map((h, i) => {
    const v = r[i] ?? '';
    return [h, v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v];
  })));
}

/** Load a CSV file (File, Blob, bytes or text) as rows. */
export async function loadCsv(source: Source | string): Promise<Row[]> {
  return parseCsv(await readText(source));
}
