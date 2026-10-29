const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

/* Photos are taken live with the camera. Only documents, discharge papers (the scanner's Upload), the old purchase receipt and the
   return label, and the CSV import pick files. */
const FILES_OK = ['doc-file', 'csv-file', 'receipt-upload', 'plan-label-file', '${upload}'];
test('every photo input opens the camera; only documents and papers pick files', () => {
  for (const f of fs.readdirSync('.').filter(f => f.endsWith('.js'))) {
    for (const [tag] of fs.readFileSync(f, 'utf8').matchAll(/<input[^>]*type="file"[^>]*>/g)) {
      const id = (/id="([^"]+)"/.exec(tag) || [])[1];
      if (FILES_OK.includes(id)) continue;
      assert.match(tag, /\scapture[\s=>]/, `${f}: ${id} should open the camera`);
      assert.doesNotMatch(tag, /\smultiple/, `${f}: ${id} takes one photo at a time`);
    }
  }
  const scan = fs.readFileSync('scan.js', 'utf8');
  assert.doesNotMatch(scan, /Upload from your photos|flow-card-pick/);
  assert.match(scan, /files\?\(multiple\?' multiple':''\):' capture="environment"'/, 'medication scans take photos live; papers can still be uploaded');
});
