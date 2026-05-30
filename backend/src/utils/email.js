const nodemailer = require('nodemailer')

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT || 0)

  return {
    host: process.env.SMTP_HOST || '',
    port,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
  }
}

function assertSmtpConfigured() {
  const config = smtpConfig()
  const missing = []

  if (!config.host) missing.push('SMTP_HOST')
  if (!config.port) missing.push('SMTP_PORT')
  if (!config.user) missing.push('SMTP_USER')
  if (!config.pass) missing.push('SMTP_PASS')
  if (!config.from) missing.push('SMTP_FROM')

  if (missing.length) {
    const error = new Error(`Email service is not configured. Missing ${missing.join(', ')}.`)
    error.status = 500
    throw error
  }

  return config
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendVerificationEmail({ to, name, code }) {
  const config = assertSmtpConfigured()
  const safeName = escapeHtml(name || 'there')
  const safeCode = escapeHtml(code)
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  })

  await transporter.sendMail({
    from: config.from,
    to,
    subject: 'Verify your TalkEachOther account',
    text: [
      `Hi ${name || 'there'},`,
      '',
      `Your TalkEachOther verification code is ${code}.`,
      'This code expires in 15 minutes.',
      '',
      'If you did not request this, you can ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#101827">
        <h2>Verify your TalkEachOther account</h2>
        <p>Hi ${safeName},</p>
        <p>Use this code to finish creating your account:</p>
        <div style="font-size:28px;font-weight:700;padding:14px 18px;border-radius:10px;background:#f3f4f6;display:inline-block">${safeCode}</div>
        <p>This code expires in 15 minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
  })
}

module.exports = {
  sendVerificationEmail,
}
