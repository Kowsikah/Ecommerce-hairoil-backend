import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const router = Router();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'; // or 'llama-3.1-8b-instant' (faster/cheaper)

/* ── Edit the facts the assistant may use ── */
const SYSTEM_PROMPT = `You are the friendly shopping assistant for "Be in Love", an Indian brand of 100% natural Ayurvedic hair oil.

FACTS (only use these; never invent anything else):
- Product: Be in Love Hair Oil, 200 ml, price Rs. 598.
- Ingredients: coconut oil, hibiscus, bhringaraj, amla, tanner's cassia, curry leaves and other Ayurvedic herbs. Free from harsh chemicals.
- Suitable for all hair types; for men, women and children.
- Benefits: helps reduce hair fall, improves growth and texture, reduces frizz and premature greying, adds shine, strengthens strands, hydrates, helps repair split ends, soothes the scalp.
- How to use: massage a small amount into scalp and hair, leave 30 minutes or overnight, wash with mild shampoo; apply on ends regularly for split ends.
- Order tracking: website page /track-order (needs Order ID plus email or phone used at checkout).
- Refunds: only for damaged, leaking, wrong or defective items, reported within 48 hours of delivery with photos/video to Beinlove.in@gmail.com or WhatsApp. Opened or used bottles cannot be returned. Page: /refund-policy.
- Cancellation: possible before dispatch only. Page: /cancellation-policy. Privacy: /privacy-policy.
- Contact: WhatsApp +91 6374 962 519, email Beinlove.in@gmail.com.

RULES:
- Be warm, concise (2-4 short sentences), plain text, no markdown.
- Only discuss Be in Love, its product, orders and policies. Politely decline unrelated topics.
- Do not make medical claims or promise results; say results vary from person to person. For scalp conditions or allergies, suggest consulting a doctor.
- If you do not know something (delivery time, shipping fee, stock, discounts), do not guess: say you are not sure and offer WhatsApp +91 6374 962 519.`;

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages. Please try again shortly.' },
});

router.post('/', limiter, async (req, res) => {
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Chat is not configured.' });
  }

  // Accept only user/assistant text, last 10 turns, capped length
  const messages = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'No message provided.' });
  }

  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 300,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
    });

    if (!r.ok) {
      console.error('Groq error', r.status, await r.text());
      return res.status(502).json({ error: 'The assistant is unavailable right now.' });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) return res.status(502).json({ error: 'Empty response.' });
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'The assistant is unavailable right now.' });
  }
});

export default router;
