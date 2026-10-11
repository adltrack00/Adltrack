/* Sorts an item into one of its retailer's policy categories ("electronics", "non-returnable", ...) from the item name,
   with one small Claude call on the server. Returns a category id, "general" (none of them apply), "unsure", or null
   when no answer is available (no API key, or the call failed), so the engine falls back to the safest reading. */
const { productCategories } = require('./engine');

const MODEL = 'claude-opus-5-5';
const SYSTEM = 'You sort a shopping item into a retailer\'s return-policy categories. Judge only by what the product is: ignore whether it is opened, used or on sale. Answer "general" when none of the categories fit, and "unsure" when the name is too vague to tell.';

function createClassifier({ apiKey = process.env.ANTHROPIC_API_KEY, client = null } = {}) {
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
  }
  const cache = new Map();

  async function classify(name, policy) {
    const categories = productCategories(policy);
    if (!categories.length) return 'general';
    const item = String(name || '').trim().slice(0, 200);
    if (!item || !client) return null;
    const key = `${policy.id}:${policy.version}:${item.toLowerCase()}`;
    if (cache.has(key)) return cache.get(key);
    const ids = categories.map(c => c.id);
    const list = categories.map(c => `- ${c.id}: ${c.label}${c.examples && c.examples.length ? ` (for example ${c.examples.join(', ')})` : ''}`).join('\n');
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 2000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: { type: 'object', properties: { category: { type: 'string', enum: [...ids, 'general', 'unsure'] } }, required: ['category'], additionalProperties: false } }
        },
        system: SYSTEM,
        messages: [{ role: 'user', content: `Retailer: ${policy.name}\nCategories:\n${list}\n\nItem name: ${JSON.stringify(item)}` }]
      });
      if (response.stop_reason === 'refusal') return null;
      const text = response.content.find(b => b.type === 'text');
      const category = text && JSON.parse(text.text).category;
      if (![...ids, 'general', 'unsure'].includes(category)) return null;
      if (cache.size > 5000) cache.delete(cache.keys().next().value);
      cache.set(key, category);
      return category;
    } catch (err) {
      console.error('Item classification failed:', err.message);
      return null;
    }
  }
  return { classify, available: () => !!client };
}

module.exports = { createClassifier, MODEL };
