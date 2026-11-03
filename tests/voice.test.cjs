const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { voiceJoin, VOICE_FIELDS } = require('../voice.js');

/* Talking instead of typing: a mic on every note box, words added to what's already written. */
test('spoken words are added to what is already in the box', () => {
  assert.equal(voiceJoin('', 'she walked to the kitchen'), 'She walked to the kitchen');
  assert.equal(voiceJoin('Ate lunch.', 'then a nap'), 'Ate lunch. Then a nap');
  assert.equal(voiceJoin('Ate lunch', 'and soup'), 'Ate lunch and soup');
  assert.equal(voiceJoin('Note ', ''), 'Note ');
});
test('every note box gets the mic, and the app loads it after the assistant', () => {
  assert.match(VOICE_FIELDS, /^textarea/);
  for (const n of ['what', 'done', 'witnesses', 'told']) assert.ok(VOICE_FIELDS.includes(`name="${n}"`), n);
  const html = fs.readFileSync('app.html', 'utf8');
  assert.ok(html.indexOf('assistant.js') < html.indexOf('voice.js') && html.includes('voice.css'));
  const sw = fs.readFileSync('sw.js', 'utf8'); assert.ok(sw.includes("'voice.js'") && sw.includes("'voice.css'"));
});
