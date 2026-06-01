const express = require('express')
const { optionalAuthMiddleware } = require('../middleware/auth')
const { sendFeedbackEmail } = require('../utils/email')

const router = express.Router()

const feedbackCategories = new Set(['Account', 'Room / RTC', 'Payment', 'Chat', 'Safety'])
const feedbackTypes = new Set(['Bug report', 'Feature request', 'Payment issue', 'Abuse report', 'Other'])
const maxAttachmentBytes = 25 * 1024 * 1024
const allowedAttachmentTypes = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|webm|quicktime))$/i

function cleanText(value, maxLength = 1000) {
  return String(value || '').trim().replace(/\s+\n/g, '\n').slice(0, maxLength)
}

function cleanSingleLine(value, maxLength = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function normalizeAttachment(value) {
  if (!value) return null

  const filename = cleanSingleLine(value.name || value.filename || 'feedback-attachment', 180)
  const contentType = cleanSingleLine(value.type || value.contentType || '')
  const dataUrl = String(value.data_url || value.dataUrl || '')
  const match = dataUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)

  if (!filename || !contentType || !match) {
    const error = new Error('Attachment could not be read. Please try a PNG, JPG, GIF, MP4, or WebM file.')
    error.status = 422
    throw error
  }

  const detectedType = match[1]
  const encodedContent = match[2].replace(/\s/g, '')
  const finalType = contentType || detectedType

  if (!allowedAttachmentTypes.test(finalType) || !allowedAttachmentTypes.test(detectedType)) {
    const error = new Error('Attachment must be a PNG, JPG, GIF, MP4, or WebM file.')
    error.status = 422
    throw error
  }

  const content = Buffer.from(encodedContent, 'base64')
  if (!content.length || content.length > maxAttachmentBytes) {
    const error = new Error('Attachment must be 25 MB or smaller.')
    error.status = 422
    throw error
  }

  return {
    filename,
    contentType: finalType,
    size: content.length,
    content,
    encodedContent,
  }
}

router.post('/', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const category = feedbackCategories.has(req.body.category) ? req.body.category : 'Account'
    const type = feedbackTypes.has(req.body.type) ? req.body.type : 'Other'
    const description = cleanText(req.body.description)
    const contact = cleanSingleLine(req.body.contact, 180)

    if (description.length < 10) {
      return res.status(422).json({ message: 'Please add at least 10 characters so support can understand the issue.' })
    }

    const attachment = normalizeAttachment(req.body.attachment)

    const emailDelivery = await sendFeedbackEmail({
      feedback: {
        category,
        type,
        description,
        contact,
        page_url: cleanSingleLine(req.body.page_url, 500),
        user_agent: cleanSingleLine(req.body.user_agent, 500),
        created_at: new Date().toISOString(),
        attachment,
        user: req.user ? {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
        } : null,
      },
    })

    res.status(202).json({
      message: 'Feedback sent to support.',
      email_delivery: emailDelivery,
    })
  } catch (error) {
    next(error)
  }
})

module.exports = router
