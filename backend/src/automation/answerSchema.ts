import { z } from 'zod'

// Canonical IDs can include the full question and its option labels.
// The manager accepts only IDs present in this user's saved form.
export const automationAnswersSchema = z.object({
  fields: z.array(z.object({ id: z.string().min(1), value: z.string().max(10000) })).max(200),
})
