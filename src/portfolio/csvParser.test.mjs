import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv } from './csvParser.js';

test('parses a simple header + rows', () => {
  const { header, rows } = parseCsv('name,address,lat,lon\nStore A,123 Main St,40.1,-75.2\n');
  assert.deepEqual(header, ['name', 'address', 'lat', 'lon']);
  assert.deepEqual(rows, [['Store A', '123 Main St', '40.1', '-75.2']]);
});

test('handles quoted fields with embedded commas', () => {
  const { rows } = parseCsv('name,address\n"Store B","123 Main St, Suite 4"\n');
  assert.deepEqual(rows, [['Store B', '123 Main St, Suite 4']]);
});

test('handles escaped double quotes inside quoted fields', () => {
  const { rows } = parseCsv('name,note\n"Store ""C""","says ""hi"""\n');
  assert.deepEqual(rows, [['Store "C"', 'says "hi"']]);
});

test('handles CRLF line endings', () => {
  const { header, rows } = parseCsv('name,address\r\nStore A,123 Main St\r\nStore B,456 Oak Ave\r\n');
  assert.deepEqual(header, ['name', 'address']);
  assert.deepEqual(rows, [['Store A', '123 Main St'], ['Store B', '456 Oak Ave']]);
});

test('drops blank lines', () => {
  const { rows } = parseCsv('name,address\nStore A,123 Main St\n\nStore B,456 Oak Ave\n');
  assert.deepEqual(rows, [['Store A', '123 Main St'], ['Store B', '456 Oak Ave']]);
});

test('handles a file with no trailing newline', () => {
  const { header, rows } = parseCsv('name,address\nStore A,123 Main St');
  assert.deepEqual(header, ['name', 'address']);
  assert.deepEqual(rows, [['Store A', '123 Main St']]);
});

test('empty input yields empty header and no rows', () => {
  const { header, rows } = parseCsv('');
  assert.deepEqual(header, []);
  assert.deepEqual(rows, []);
});

test('handles a quoted field spanning multiple lines', () => {
  const { rows } = parseCsv('name,address\n"Store A","123 Main St\nBuilding 2"\n');
  assert.deepEqual(rows, [['Store A', '123 Main St\nBuilding 2']]);
});
