import { writeFile } from 'node:fs/promises'
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'

const sectionNames = /^(summary|professional summary|profile|experience|professional experience|work experience|skills|technical skills|education|projects|certifications|awards|publications)$/i
const bulletPattern = /^(?:[-*•]|\d+[.)])\s+/
const cleanLines = (text: string) => text.split(/\r?\n/).map((line) => line.replace(/[§]/g, '').replace(/\s+#\s+/g, ' | ').replace(/\s{2,}/g, ' ').trim()).filter((line) => Boolean(line) && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line))
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export async function createTailoredResumeDocx(text: string, outputPath: string) {
  const lines = cleanLines(text)
  if (!lines.length) throw new Error('The tailored resume has no content.')
  const children: Paragraph[] = []
  lines.forEach((line, index) => {
    if (index === 0) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: line, bold: true, size: 34, font: 'Arial', color: '172033' })] }))
      return
    }
    const firstSectionIndex = lines.findIndex((item) => sectionNames.test(item.replace(/:$/, '')))
    if (index > 0 && (firstSectionIndex < 0 || index < firstSectionIndex)) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: index === firstSectionIndex - 1 ? 150 : 25 }, children: [new TextRun({ text: line, size: 17, font: 'Arial', color: '4B5565' })] }))
      return
    }
    if (sectionNames.test(line.replace(/:$/, ''))) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 180, after: 70 }, border: { bottom: { color: 'C8CDD8', style: BorderStyle.SINGLE, size: 5, space: 3 } }, children: [new TextRun({ text: line.replace(/:$/, '').toUpperCase(), bold: true, size: 21, font: 'Arial', color: '243B63' })] }))
      return
    }
    if (bulletPattern.test(line)) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 25, line: 220 }, indent: { left: 320, hanging: 160 }, children: [new TextRun({ text: line.replace(bulletPattern, ''), size: 18, font: 'Arial', color: '20242D' })] }))
      return
    }
    const looksLikeRole = /\s(?:\|| at | - |—)\s/.test(line) && line.length < 180
    children.push(new Paragraph({ spacing: { before: looksLikeRole ? 65 : 0, after: looksLikeRole ? 20 : 35, line: 220 }, keepNext: looksLikeRole, children: [new TextRun({ text: line, bold: looksLikeRole, size: looksLikeRole ? 19 : 18, font: 'Arial', color: '20242D' })] }))
  })
  const document = new Document({
    creator: 'JobCopilot', title: 'Tailored Resume', description: 'Job-specific resume approved by the candidate',
    styles: { default: { document: { run: { font: 'Arial', size: 18, color: '20242D' }, paragraph: { spacing: { after: 35, line: 220 } } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 620, right: 720, bottom: 620, left: 720, header: 300, footer: 300 } } }, children }],
  })
  await writeFile(outputPath, await Packer.toBuffer(document), { mode: 0o600 })
}

export function tailoredResumePreviewHtml(text: string) {
  const lines = cleanLines(text); const firstSectionIndex = lines.findIndex((item) => sectionNames.test(item.replace(/:$/, '')))
  const content = lines.map((line, index) => {
    const safe = escapeHtml(line)
    if (index === 0) return `<h1>${safe}</h1>`
    if (index > 0 && (firstSectionIndex < 0 || index < firstSectionIndex)) return `<p class="contact">${safe}</p>`
    if (sectionNames.test(line.replace(/:$/, ''))) return `<h2>${escapeHtml(line.replace(/:$/, '').toUpperCase())}</h2>`
    if (bulletPattern.test(line)) return `<p class="bullet"><span>•</span>${escapeHtml(line.replace(bulletPattern, ''))}</p>`
    const roleClass = /\s(?:\|| at | - |—)\s/.test(line) && line.length < 180 ? ' class="role"' : ''
    return `<p${roleClass}>${safe}</p>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;background:#eef0f4;color:#20242d;font-family:Arial,sans-serif}.page{width:min(816px,calc(100% - 32px));min-height:1056px;margin:24px auto;padding:42px 48px;background:white;box-shadow:0 4px 18px rgba(27,34,51,.1)}h1{margin:0 0 5px;text-align:center;font-size:25px;color:#172033}.contact{margin:2px 0;text-align:center;color:#4b5565;font-size:12px}h2{margin:18px 0 7px;padding-bottom:5px;border-bottom:1px solid #c8cdd8;color:#243b63;font-size:15px}p{margin:4px 0;font-size:12px;line-height:1.35}.role{margin-top:8px;font-weight:700}.bullet{display:flex;gap:7px;padding-left:12px}.bullet span{font-weight:700}@media(max-width:600px){.page{margin:10px auto;padding:28px 24px;min-height:auto}}</style></head><body><main class="page">${content}</main></body></html>`
}
