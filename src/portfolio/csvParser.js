/**
 * @file Minimal RFC4180-ish CSV parser: quoted fields, escaped `""`, embedded
 * commas/newlines inside quotes, CRLF/LF tolerant. No npm dependency — this
 * app is vanilla ES modules and the format need here (a store-address export)
 * doesn't warrant pulling in a library.
 * @module portfolio/csvParser
 */

/**
 * Parse CSV text into a header row and data rows. Blank lines are dropped.
 * @param {string} text
 * @returns {{header: string[], rows: string[][]}}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawAnyField = false;
  const input = typeof text === 'string' ? text : '';

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    sawAnyField = false;
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      inQuotes = true;
      sawAnyField = true;
      continue;
    }
    if (char === ',') {
      endField();
      sawAnyField = true;
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      if (sawAnyField || field !== '') endRow();
      continue;
    }
    field += char;
    sawAnyField = true;
  }
  if (sawAnyField || field !== '') endRow();

  const [header, ...dataRows] = rows;
  return { header: header || [], rows: dataRows };
}
