import nodemailer, { type Transporter } from 'nodemailer'

export interface ApplicationEmailPayload {
  to: string
  candidateName: string
  jobTitle: string
  company: string
  jobUrl: string
  status: 'SUBMITTED' | 'FAILED' | 'READY_FOR_REVIEW'
  submittedAt?: string
  errorMessage?: string
  fieldSummary?: Array<{ label: string; value: string }>
}

let transporter: Transporter | null = null

function getTransporter(): Transporter | null {
  if (transporter) return transporter

  const gmailUser = process.env.GMAIL_USER || process.env.SMTP_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS

  if (gmailUser && gmailPass) {
    if (process.env.SMTP_HOST) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT || 587) === 465,
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      })
    } else {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      })
    }
    return transporter
  }

  return null
}

export async function sendApplicationEmail(payload: ApplicationEmailPayload): Promise<{ sent: boolean; message: string }> {
  const mailer = getTransporter()
  const fromEmail = process.env.SMTP_FROM || process.env.GMAIL_USER || 'notifications@jobcopilot.local'
  const isSuccess = payload.status === 'SUBMITTED'
  const subject = isSuccess
    ? `🎉 Application Submitted: ${payload.jobTitle} at ${payload.company}`
    : `⚠️ Application Update: ${payload.jobTitle} at ${payload.company} (${payload.status})`

  const fieldRowsHtml = (payload.fieldSummary || [])
    .map(
      (f) =>
        `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-weight: 600;">${escapeHtml(
          f.label
        )}</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${escapeHtml(
          f.value
        )}</td></tr>`
    )
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        .header { background: ${isSuccess ? '#10b981' : '#f59e0b'}; padding: 24px; color: #ffffff; text-align: center; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; }
        .content { padding: 24px; color: #334155; line-height: 1.6; }
        .job-box { background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 16px 0; }
        .job-box h2 { margin: 0 0 8px 0; font-size: 18px; color: #0f172a; }
        .job-box p { margin: 4px 0; font-size: 14px; }
        .table-container { margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .button { display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; margin-top: 12px; }
        .footer { background: #f8fafc; padding: 16px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>${isSuccess ? 'Application Successfully Submitted!' : 'Application Status Update'}</h1>
        </div>
        <div class="content">
          <p>Hi <strong>${escapeHtml(payload.candidateName)}</strong>,</p>
          <p>${
            isSuccess
              ? 'Your job application has been successfully submitted to the employer via automated browser application.'
              : `Your application process reached status: <strong>${payload.status}</strong>.`
          }</p>
          
          <div class="job-box">
            <h2>${escapeHtml(payload.jobTitle)}</h2>
            <p><strong>Company:</strong> ${escapeHtml(payload.company)}</p>
            <p><strong>Job URL:</strong> <a href="${escapeHtml(payload.jobUrl)}" target="_blank">${escapeHtml(payload.jobUrl)}</a></p>
            <p><strong>Timestamp:</strong> ${payload.submittedAt || new Date().toLocaleString()}</p>
            ${payload.errorMessage ? `<p style="color: #dc2626;"><strong>Note:</strong> ${escapeHtml(payload.errorMessage)}</p>` : ''}
          </div>

          ${
            fieldRowsHtml
              ? `<div class="table-container">
                  <h3 style="font-size: 15px; color: #1e293b; margin-bottom: 8px;">Submitted Details:</h3>
                  <table>
                    <tbody>
                      ${fieldRowsHtml}
                    </tbody>
                  </table>
                </div>`
              : ''
          }

          <p style="text-align: center;">
            <a href="${escapeHtml(payload.jobUrl)}" class="button" target="_blank">View Job Posting</a>
          </p>
        </div>
        <div class="footer">
          Automated by CampusPe JobCopilot • Find the right role, faster.
        </div>
      </div>
    </body>
    </html>
  `

  if (!mailer) {
    console.log(`[EmailService] SMTP / Gmail credentials not configured in .env.`)
    console.log(`[EmailService] Simulated sending email to: ${payload.to}`)
    console.log(`[EmailService] Subject: ${subject}`)
    console.log(`[EmailService] Summary: ${payload.jobTitle} at ${payload.company} -> ${payload.status}`)
    return {
      sent: false,
      message: 'SMTP not configured. Email logged to console. Configure GMAIL_USER and GMAIL_APP_PASSWORD in .env to send real emails.',
    }
  }

  try {
    await mailer.sendMail({
      from: `"JobCopilot" <${fromEmail}>`,
      to: payload.to,
      subject,
      html,
    })
    console.log(`[EmailService] Successfully sent application email to ${payload.to}`)
    return { sent: true, message: `Email sent to ${payload.to}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[EmailService] Failed to send email to ${payload.to}:`, message)
    return { sent: false, message: `Failed to send email: ${message}` }
  }
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
