const nodemailer = require('nodemailer')

function emailConfig() {
  const port = Number(process.env.SMTP_PORT || 0)
  const allowLocalVerificationCode = process.env.NODE_ENV !== 'production'
    || ['1', 'true', 'yes', 'on'].includes(String(process.env.ALLOW_LOCAL_VERIFICATION_CODES || '').toLowerCase())

  return {
    resendApiKey: process.env.RESEND_API_KEY || '',
    host: process.env.SMTP_HOST || '',
    port,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.EMAIL_FROM || '',
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    allowLocalVerificationCode,
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

function attachmentSummary(attachment) {
  if (!attachment) return 'No attachment provided.'

  return [
    `File: ${attachment.filename}`,
    `Type: ${attachment.contentType || 'unknown'}`,
    `Size: ${Math.round((Number(attachment.size) || 0) / 1024)} KB`,
  ].join('\n')
}

function feedbackMessage({ to, feedback, from }) {
  const reporter = feedback.user
    ? `${feedback.user.name || 'Unknown'} <${feedback.user.email || 'no email'}> (ID ${feedback.user.id})`
    : 'Guest or unauthenticated user'
  const contact = feedback.contact || feedback.user?.email || 'Not provided'
  const attachment = feedback.attachment || null
  const attachmentText = attachmentSummary(attachment)
  const safeDescription = escapeHtml(feedback.description).replace(/\n/g, '<br>')

  return {
    from,
    to,
    subject: `[TalkEachOther Feedback] ${feedback.category} - ${feedback.type}`,
    text: [
      'New TalkEachOther feedback submitted.',
      '',
      `Category: ${feedback.category}`,
      `Type: ${feedback.type}`,
      `Contact: ${contact}`,
      `Reporter: ${reporter}`,
      `Page: ${feedback.page_url || 'Not provided'}`,
      `User agent: ${feedback.user_agent || 'Not provided'}`,
      `Submitted: ${feedback.created_at}`,
      '',
      'Description:',
      feedback.description,
      '',
      'Attachment:',
      attachmentText,
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#101827">
        <h2>New TalkEachOther feedback</h2>
        <p><strong>Category:</strong> ${escapeHtml(feedback.category)}</p>
        <p><strong>Type:</strong> ${escapeHtml(feedback.type)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(contact)}</p>
        <p><strong>Reporter:</strong> ${escapeHtml(reporter)}</p>
        <p><strong>Page:</strong> ${escapeHtml(feedback.page_url || 'Not provided')}</p>
        <p><strong>User agent:</strong> ${escapeHtml(feedback.user_agent || 'Not provided')}</p>
        <p><strong>Submitted:</strong> ${escapeHtml(feedback.created_at)}</p>
        <h3>Description</h3>
        <p>${safeDescription}</p>
        <h3>Attachment</h3>
        <pre style="white-space:pre-wrap;background:#f3f4f6;padding:12px;border-radius:8px">${escapeHtml(attachmentText)}</pre>
      </div>
    `,
    attachments: attachment ? [attachment] : [],
  }
}

function smtpReady(config) {
  return Boolean(config.host && config.port && config.user && config.pass && config.from)
}

function resendReady(config) {
  return Boolean(config.resendApiKey && config.from)
}

function resendErrorMessage(status, body) {
  if (status === 401 || /api key is invalid/i.test(body)) {
    return 'Email provider rejected the API key. Add a valid Resend API key on the server, then request a new code.'
  }

  if (/domain|from/i.test(body)) {
    return 'Email provider rejected the sender address. Verify EMAIL_FROM and the sending domain, then request a new code.'
  }

  return 'Email provider rejected the verification email. Check the email provider settings, then request a new code.'
}

function emailDeliveryStatus() {
  const config = emailConfig()
  const resendConfigured = resendReady(config)
  const smtpConfigured = smtpReady(config)

  return {
    configured: resendConfigured || smtpConfigured,
    provider: resendConfigured ? 'resend' : smtpConfigured ? 'smtp' : null,
    resend: {
      api_key: Boolean(config.resendApiKey),
      from: Boolean(config.from),
    },
    smtp: {
      host: Boolean(config.host),
      port: Boolean(config.port),
      user: Boolean(config.user),
      pass: Boolean(config.pass),
      from: Boolean(config.from),
    },
  }
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
      ...(message.attachments?.length ? {
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.encodedContent || attachment.content.toString('base64'),
        })),
      } : {}),
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const error = new Error(resendErrorMessage(response.status, errorText))
    error.status = 502
    error.code = response.status === 401 ? 'email_provider_invalid_key' : 'email_provider_rejected'
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

  await transporter.sendMail({
    ...message,
    attachments: message.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    })),
  })
  return { provider: 'smtp' }
}

async function sendEmailMessage(message, { allowLocalFallback = false, localLog = '' } = {}) {
  const config = emailConfig()
  const prepared = {
    ...message,
    from: config.from,
  }

  if (resendReady(config)) return sendWithResend(config, prepared)
  if (smtpReady(config)) return sendWithSmtp(config, prepared)

  if (allowLocalFallback && config.allowLocalVerificationCode) {
    console.warn(localLog || `[email] Local email fallback: ${prepared.subject}`)
    return { provider: 'local', skipped: true }
  }

  const error = new Error('Email delivery is not configured on this server. Add Resend or SMTP settings, then request a new code.')
  error.status = 503
  error.code = 'email_not_configured'
  throw error
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

  if (config.allowLocalVerificationCode) {
    console.warn(`[email] Verification code for ${to}: ${code}`)
    return {
      provider: 'local',
      skipped: true,
      verification_code: code,
    }
  }

  const error = new Error('Email delivery is not configured on this server. Add Resend or SMTP settings, then request a new code.')
  error.status = 503
  error.code = 'email_not_configured'
  throw error
}

async function sendFeedbackEmail({ to, feedback }) {
  const recipient = to || process.env.FEEDBACK_TO_EMAIL || process.env.SUPERADMIN_EMAIL || 'admin@gmail.com'
  return sendEmailMessage(
    feedbackMessage({
      to: recipient,
      feedback,
      from: '',
    }),
    {
      allowLocalFallback: true,
      localLog: `[email] Feedback for ${recipient}: ${feedback.category} / ${feedback.type}`,
    },
  )
}

module.exports = {
  emailDeliveryStatus,
  sendFeedbackEmail,
  sendVerificationEmail,
}
