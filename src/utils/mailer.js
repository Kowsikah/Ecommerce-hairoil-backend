import nodemailer from 'nodemailer';

/* ── helpers ── */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const orderNumber = (id) => String(id).slice(0, 8).toUpperCase();

/* ── send through Gmail (Nodemailer) ── */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});

async function send({ to, replyTo, subject, text, html }) {
  await transporter.sendMail({
    from: `"Be in Love" <${process.env.GMAIL_USER}>`,
    to: to.email,
    replyTo,
    subject,
    text,
    html,
  });
  console.log(`📧 Email sent to ${to.email} — ${subject}`);
}

/* ── email layout ── */
const wrap = (inner) => `
<div style="background:#faf8f3;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#23281b">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e2d6">
    <div style="background:#3c4726;color:#ffffff;padding:24px;text-align:center">
      <div style="font-family:Georgia,serif;font-size:28px;font-style:italic">Be in love</div>
      <div style="font-size:11px;letter-spacing:2px;color:#d9a557;margin-top:6px">MAKE YOUR HAIR HEALTHIER</div>
    </div>
    <div style="padding:28px">${inner}</div>
    <div style="background:#faf8f3;padding:16px;text-align:center;font-size:12px;color:#777">
      Questions? WhatsApp +91 6374 962 519 &nbsp;|&nbsp; Beinlove.in@gmail.com
    </div>
  </div>
</div>`;

const itemsTable = (lines) => `
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px">
  ${lines
    .map(
      (l) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee">${esc(l.name)} &times; ${l.qty}</td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right">${inr(l.unitPrice * l.qty)}</td>
      </tr>`
    )
    .join('')}
</table>`;

const totalsTable = ({ subtotal, shippingFee, total }) => `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14px">
  <tr><td style="padding:4px 0;color:#555">Subtotal</td><td style="text-align:right">${inr(subtotal)}</td></tr>
  <tr><td style="padding:4px 0;color:#555">Shipping</td><td style="text-align:right">${shippingFee === 0 ? 'Free' : inr(shippingFee)}</td></tr>
  <tr><td style="padding:10px 0 0;font-weight:bold;font-size:16px">Total (Cash on Delivery)</td>
      <td style="padding:10px 0 0;text-align:right;font-weight:bold;font-size:18px;color:#3c4726">${inr(total)}</td></tr>
</table>`;

const addressBlock = (c) =>
  `${esc(c.name)}<br>${esc(c.address)}<br>${esc(c.city)}, ${esc(c.state)} – ${esc(c.pincode)}<br>Mobile: ${esc(c.phone)}`;

/* ── public: send the customer + owner emails ── */
export async function sendOrderEmails({ orderId, customer: c, lines, subtotal, shippingFee, total }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing). Skipping order emails.');
    return;
  }

  const no = orderNumber(orderId);
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER; // where new-order alerts go
  const totals = { subtotal, shippingFee, total };
  const textLines = lines.map((l) => `- ${l.name} x ${l.qty}: ${inr(l.unitPrice * l.qty)}`).join('\n');

  const jobs = [];

  // 1) Customer confirmation
  if (c.email) {
    jobs.push(
      send({
        to: { email: c.email, name: c.name },
        replyTo: owner || undefined,
        subject: `Your Be in Love order #${no} is confirmed`,
        text:
          `Hi ${c.name},\n\nThank you for your order! Your order number is ${no}.\n\n${textLines}\n\n` +
          `Subtotal: ${inr(subtotal)}\nShipping: ${shippingFee === 0 ? 'Free' : inr(shippingFee)}\n` +
          `Total (Cash on Delivery): ${inr(total)}\n\nDeliver to:\n${c.name}\n${c.address}\n${c.city}, ${c.state} - ${c.pincode}\n\n` +
          `We will contact you on ${c.phone} to confirm delivery.\n\nBe in Love`,
        html: wrap(`
          <h2 style="font-family:Georgia,serif;margin:0 0 8px;color:#3c4726">Thank you, ${esc(c.name.split(' ')[0])}!</h2>
          <p style="margin:0 0 20px;color:#555">Your order has been placed. We will contact you on your mobile number to confirm delivery.</p>
          <div style="background:#faf8f3;border-radius:12px;padding:16px;text-align:center">
            <div style="font-size:12px;letter-spacing:2px;color:#777">ORDER NUMBER</div>
            <div style="font-family:Georgia,serif;font-size:30px;font-weight:bold;color:#3c4726;letter-spacing:2px">${no}</div>
          </div>
          <h3 style="margin:24px 0 0;font-size:15px">Your items</h3>
          ${itemsTable(lines)}
          ${totalsTable(totals)}
          <h3 style="margin:24px 0 6px;font-size:15px">Delivering to</h3>
          <p style="margin:0;line-height:1.6;color:#555">${addressBlock(c)}</p>
        `),
      })
    );
  }

  // 2) New-order alert for the shop owner
  if (owner) jobs.push(
    send({
      to: { email: owner },
      replyTo: c.email || undefined,
      subject: `New order #${no} — ${inr(total)}`,
      text:
        `New order ${no}\n\n${textLines}\nTotal: ${inr(total)} (Cash on Delivery)\n\n` +
        `${c.name}\n${c.phone}\n${c.email || '(no email)'}\n${c.address}\n${c.city}, ${c.state} - ${c.pincode}\n` +
        (c.notes ? `Notes: ${c.notes}\n` : ''),
      html: wrap(`
        <h2 style="font-family:Georgia,serif;margin:0 0 8px;color:#3c4726">New order #${no}</h2>
        ${itemsTable(lines)}
        ${totalsTable(totals)}
        <h3 style="margin:24px 0 6px;font-size:15px">Customer</h3>
        <p style="margin:0;line-height:1.6;color:#555">
          ${addressBlock(c)}<br>
          ${c.email ? `Email: ${esc(c.email)}<br>` : ''}
          ${c.notes ? `<em>Note: ${esc(c.notes)}</em>` : ''}
        </p>
      `),
    })
  );

  const results = await Promise.allSettled(jobs);
  results.forEach((r) => {
    if (r.status === 'rejected') console.error('Email failed:', r.reason?.message || r.reason);
  });
}