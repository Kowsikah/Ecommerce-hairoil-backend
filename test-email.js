// Usage (from the backend folder):  node test-email.js you@example.com
import 'dotenv/config';

const to = process.argv[2];
if (!to) {
  console.log('Usage: node test-email.js you@example.com');
  process.exit(1);
}

const need = ['MAILJET_API_KEY', 'MAILJET_SECRET_KEY', 'SENDER_EMAIL'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.log('❌ Missing in backend/.env:', missing.join(', '));
  console.log('   Check the file is named ".env", sits directly inside the backend folder, and has no spaces around "=".');
  process.exit(1);
}

console.log('Sender  :', process.env.SENDER_EMAIL);
console.log('API key :', process.env.MAILJET_API_KEY.slice(0, 4) + '…  (secret key length ' + process.env.MAILJET_SECRET_KEY.length + ')');
console.log('Sending to:', to, '\n');

const auth = Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`).toString('base64');

try {
  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: process.env.SENDER_EMAIL, Name: 'Be in Love' },
          To: [{ Email: to }],
          Subject: 'Be in Love test email',
          TextPart: 'If you can read this, email sending works.',
          HTMLPart: '<p>If you can read this, <b>email sending works</b>.</p>',
        },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });

  console.log('HTTP status:', res.status);
  console.log(JSON.stringify(await res.json().catch(() => ({})), null, 2));
} catch (e) {
  console.log('❌ Could not reach Mailjet:', e.message);
}