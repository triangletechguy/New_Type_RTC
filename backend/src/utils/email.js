const nodemailer = require('nodemailer')

function emailConfig() {
  const port = Number(process.env.SMTP_PORT || 0)

  return {
    resendApiKey: process.env.RESEND_API_KEY || '',
    host: process.env.SMTP_HOST || '',
    port,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.EMAIL_FROM || '',
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function verificationMessage({ to, name, code, from }) {
  const safeName = escapeHtml(name || 'there')
  const safeCode = escapeHtml(code)

  return {
    from,
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
  }
}

function smtpReady(config) {
  return Boolean(config.host && config.port && config.user && config.pass && config.from)
}

function resendReady(config) {
  return Boolean(config.resendApiKey && config.from)
}

async function sendWithResend(config, message) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const error = new Error(errorText || `Resend email failed with status ${response.status}.`)
    error.status = 502
    throw error
  }

  return { provider: 'resend' }
}

async function sendWithSmtp(config, message) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  })

  await transporter.sendMail(message)
  return { provider: 'smtp' }
}

async function sendVerificationEmail({ to, name, code }) {
  const config = emailConfig()
  const message = verificationMessage({
    to,
    name,
    code,
    from: config.from,
  })

  if (resendReady(config)) return sendWithResend(config, message)
  if (smtpReady(config)) return sendWithSmtp(config, message)

  const error = new Error('Email service is not configured. Set RESEND_API_KEY with EMAIL_FROM, or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.')
  error.status = 503
  throw error
}

module.exports = {
  sendVerificationEmail,
}
