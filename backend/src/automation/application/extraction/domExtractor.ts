import type { Page } from 'playwright-core'
import type { FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion } from '../../types.js'
import { DOM_EXTRACT_SCRIPT } from './domExtractScript.js'
import { dedupeExtractedFields } from './deduplicator.js'
import { canonicalFieldId } from '../canonicalIdentity.js'
import { isGeneratedWorkableName } from './fieldNormalizer.js'
import type { ExtractedControl } from './types.js'

export type { ExtractedControl } from './types.js'

function mapKind(kind: string): { fieldType: FieldType; inputType: string } {
  if (kind === 'textarea') return { fieldType: 'textarea', inputType: 'textarea' }
  if (kind === 'radio') return { fieldType: 'select', inputType: 'radio' }
  if (kind === 'checkbox') return { fieldType: 'select', inputType: 'checkbox-group' }
  if (kind === 'select') return { fieldType: 'select', inputType: 'select' }
  if (kind === 'file') return { fieldType: 'text', inputType: 'file' }
  if (kind === 'email') return { fieldType: 'text', inputType: 'email' }
  if (kind === 'phone') return { fieldType: 'text', inputType: 'tel' }
  if (kind === 'url') return { fieldType: 'text', inputType: 'url' }
  if (kind === 'date') return { fieldType: 'text', inputType: 'date' }
  return { fieldType: 'text', inputType: 'text' }
}

export function controlsToQuestions(controls: ExtractedControl[]): AdapterQuestion[] {
  const unique = dedupeExtractedFields(controls)
  return unique.map((control) => {
    const mapped = mapKind(control.kind)
    const isResume = mapped.inputType === 'file' && /resume|cv/i.test(control.question)
    const atsId = control.generatedName ? undefined : (control.dataUi || control.id || control.name)
    const id = canonicalFieldId({
      question: control.question.replace(/[✱*]+$/g, '').trim(),
      kind: mapped.inputType,
      atsId,
      options: control.options,
      section: control.section,
    })
    return {
      id,
      text: control.question.replace(/[✱*]+$/g, '').trim(),
      fieldType: mapped.fieldType,
      options: control.options.length ? control.options : undefined,
      required: control.required || isResume,
      locator: { kind: 'field', value: isGeneratedWorkableName(control.name) ? `label:${control.question}` : (control.name ? `name:${control.name}` : `label:${control.question}`) },
      answered: control.answered,
      inputType: mapped.inputType === 'file' && /cover/i.test(control.question) ? 'file' : mapped.inputType,
    }
  })
}

export async function extractQuestionsFromPage(page: Page): Promise<AdapterQuestion[]> {
  await page.evaluate(`(() => {
    var root = document.querySelector('#application-form, form[id*="application" i], .ashby-application-form, [class*="application-form"], main') || document.scrollingElement || document.body;
    if (root && 'scrollTop' in root) root.scrollTop = root.scrollHeight || 0;
    window.scrollTo(0, document.body.scrollHeight || 0);
  })()`)
  await page.locator('input:not([type="hidden"]):not([type="submit"]), textarea, select').last().scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => undefined)
  const raw = await page.evaluate(DOM_EXTRACT_SCRIPT) as ExtractedControl[]
  return controlsToQuestions(Array.isArray(raw) ? raw : [])
}

export function rejectsGeneratedIdentity(name: string) {
  return isGeneratedWorkableName(name)
}
