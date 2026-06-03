const nodemailer = require('nodemailer')

function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]
    if (value !== undefined && value !== '') return value
  }

  return ''
}

function emailFromAddress() {
  const smtpFrom = firstEnv('SMTP_FROM', 'EMAIL_FROM')
  if (smtpFrom) return smtpFrom

  const mailAddress = firstEnv('MAIL_FROM_ADDRESS', 'SMTP_USER', 'MAIL_USERNAME')
  if (!mailAddress) return ''

  const mailName = firstEnv('MAIL_FROM_NAME')
  return mailName ? `${mailName} <${mailAddress}>` : mailAddress
}

function emailConfig() {
  const port = Number(firstEnv('SMTP_PORT', 'MAIL_PORT') || 0)
  const encryption = firstEnv('SMTP_SECURE', 'MAIL_ENCRYPTION').toLowerCase()
  const allowLocalVerificationCode = process.env.NODE_ENV !== 'production'
    || ['1', 'true', 'yes', 'on'].includes(String(process.env.ALLOW_LOCAL_VERIFICATION_CODES || '').toLowerCase())

  return {
    resendApiKey: process.env.RESEND_API_KEY || '',
    host: firstEnv('SMTP_HOST', 'MAIL_HOST'),
    port,
    user: firstEnv('SMTP_USER', 'MAIL_USERNAME'),
    pass: firstEnv('SMTP_PASS', 'MAIL_PASSWORD'),
    from: emailFromAddress(),
    secure: ['true', '1', 'yes', 'on', 'ssl', 'smtps'].includes(encryption) || port === 465,
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

function normalizeEmailProvider(value) {
  if (!value) return ''

  const normalized = String(value).trim().toLowerCase()
  if (['smtp', 'mail', 'nodemailer'].includes(normalized)) return 'smtp'
  if (['resend'].includes(normalized)) return 'resend'

  return normalized
}

function preferredProvider(config) {
  return normalizeEmailProvider(process.env.EMAIL_PROVIDER || process.env.MAIL_MAILER || process.env.MAILER || '')
}

function providerOrder(config) {
  const hasResend = resendReady(config)
  const hasSmtp = smtpReady(config)
  const preferred = preferredProvider(config)

  if (!hasResend && !hasSmtp) return []

  if (preferred === 'resend') {
    return hasResend ? ['resend', ...(hasSmtp ? ['smtp'] : [])] : (hasSmtp ? ['smtp'] : [])
  }

  if (preferred === 'smtp') {
    return hasSmtp ? ['smtp', ...(hasResend ? ['resend'] : [])] : (hasResend ? ['resend'] : [])
  }

  return hasSmtp ? ['smtp', ...(hasResend ? ['resend'] : [])] : ['resend']
}

function resendErrorMessage(status, body) {
  if (status === 401 || /api key is invalid/i.test(body)) {
    return 'Email provider rejected the API key. Add a valid Resend API key on the server, then request a new code.'
  }

  if (/domain|from/i.test(body)) {
    return 'Email provider rejected the sender address. Verify EMAIL_FROM or MAIL_FROM_ADDRESS and the sending domain, then request a new code.'
  }

  return 'Email provider rejected the verification email. Check the email provider settings, then request a new code.'
}

function smtpErrorMessage(error = {}) {
  const raw = `${error.message || ''} ${error.code || ''} ${error.response || ''}`.toLowerCase()

  if (raw.includes('eauth') || raw.includes('invalid login') || raw.includes('username and password')) {
    return 'SMTP authentication failed. Check SMTP_USER and SMTP_PASS (use an app password for Gmail).' 
  }

  if (raw.includes('535') || raw.includes('auth') || raw.includes('authentication')) {
    return 'SMTP authentication failed. Check SMTP_USER and SMTP_PASS (use an app password for Gmail).' 
  }

  if (raw.includes('hostname') || raw.includes('getaddrinfo') || raw.includes('connect econnrefused') || raw.includes('network is unreachable')) {
    return 'SMTP server was not reachable. Check SMTP_HOST and SMTP_PORT and server firewall/network access.'
  }

  if (raw.includes('from') && raw.includes('not')) {
    return 'SMTP provider rejected sender email address. Verify SMTP_FROM and mailbox sender permissions.'
  }

  return 'SMTP provider rejected the verification email. Check the SMTP settings, then request a new code.'
}

function emailDeliveryStatus() {
  const config = emailConfig()
  const resendConfigured = resendReady(config)
  const smtpConfigured = smtpReady(config)
  const providers = providerOrder(config)

  return {
    configured: resendConfigured || smtpConfigured,
    provider: providers[0] || null,
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

  try {
    await transporter.sendMail({
      ...message,
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    })
  } catch (error) {
    const smtpError = new Error(smtpErrorMessage(error))
    smtpError.status = 502
    smtpError.code = 'smtp_provider_rejected'
    throw smtpError
  }

  return { provider: 'smtp' }
}

async function sendEmailMessage(message, { allowLocalFallback = false, localLog = '' } = {}) {
  const config = emailConfig()
  const prepared = {
    ...message,
    from: config.from,
  }

  const providers = providerOrder(config)

  for (const provider of providers) {
    try {
      if (provider === 'resend') return await sendWithResend(config, prepared)
      if (provider === 'smtp') return await sendWithSmtp(config, prepared)
    } catch (error) {
      if (provider === providers[providers.length - 1]) {
        throw error
      }

      console.error(`[email] ${provider} failed, trying alternative provider`, error)
    }
  }

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

  return sendEmailMessage(message, {
    allowLocalFallback: config.allowLocalVerificationCode,
    localLog: `[email] Verification code for ${to}: ${code}`,
  }).then((result) => ({
    ...result,
    ...(result.provider === 'local' ? { verification_code: code } : {}),
  }))
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
