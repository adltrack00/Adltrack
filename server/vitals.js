/* Vital-sign photos: one photo of a blood pressure cuff's screen or a thermometer goes to a vision-capable Claude model with
   structured output, and the numbers on the screen come back to fill the vital sign's form. The person checks them and
   saves; a number that can't be read clearly comes back empty so it's typed instead. A temperature in °C is turned into °F,
   the way the app records it. */
const { MODEL } = require('./label');

const SYSTEM = `You read the numbers on the screen of a home medical device for a family caregiver app: a blood pressure monitor (systolic, diastolic and pulse) or a thermometer. Someone checks your numbers before they're saved, so null is always better than a guess.
- Copy only numbers shown on the device's screen. Never work out, round or estimate a number.
- systolic is the top/SYS number in mmHg, diastolic the DIA number in mmHg, pulse the PUL/PULSE/heart-rate number in beats per minute.
- temperature is the temperature reading on a thermometer, with temperature_unit "F" or "C" as shown (or as is obvious from the number), else "".
- Use null for any number the photo doesn't show clearly. A number from a stored memory list or a clock is not a reading.
- problem: "blurry", "dark", "glare" or "not_device" when that stops you reading the screen; otherwise "none".`;

const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const SCHEMA = {
  type: 'object',
  properties: {
    problem: { type: 'string', enum: ['none', 'blurry', 'dark', 'glare', 'not_device'] },
    systolic: num, diastolic: num, pulse: num, temperature: num,
    temperature_unit: { type: 'string', enum: ['F', 'C', ''] }
  },
  required: ['problem', 'systolic', 'diastolic', 'pulse', 'temperature', 'temperature_unit'],
  additionalProperties: false
};

/* What the app fills in: whole numbers in sensible ranges for a person, and the temperature in °F to one decimal. */
function clean(r = {}) {
  const whole = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi ? String(Math.round(x)) : '';
  let t = Number.isFinite(r.temperature) ? r.temperature : null;
  if (t !== null && (r.temperature_unit === 'C' || (r.temperature_unit !== 'F' && t < 50))) t = t * 9 / 5 + 32;
  const sys = whole(r.systolic, 50, 300), dia = whole(r.diastolic, 20, 200);
  return {
    sys: sys && dia ? sys : '', dia: sys && dia ? dia : '',
    pulse: whole(r.pulse, 20, 250),
    temp: t !== null && t >= 86 && t <= 113 ? String(Math.round(t * 10) / 10) : '',
    problem: ['blurry', 'dark', 'glare', 'not_device'].includes(r.problem) ? r.problem : ''
  };
}

function createVitalsReader({ apiKey = process.env.ANTHROPIC_API_KEY, client = null, log = console } = {}) {
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  }
  async function read(photo) {
    if (!client || !photo) return null;
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 2000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: photo.contentType, data: photo.body.toString('base64') } },
          { type: 'text', text: 'Read the numbers on this device.' }
        ] }]
      });
      if (response.usage) log.log(`Vital signs photo read: ${response.usage.input_tokens} input and ${response.usage.output_tokens} output tokens.`);
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      const answer = response.content.find(b => b.type === 'text');
      return answer ? clean(JSON.parse(answer.text)) : null;
    } catch (err) {
      log.error('Vital signs photo reading failed:', err.message);
      return null;
    }
  }
  return { read, available: () => !!client };
}

module.exports = { createVitalsReader, clean, SCHEMA };
