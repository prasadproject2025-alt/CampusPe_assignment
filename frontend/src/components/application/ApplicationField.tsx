import type { ReactNode } from 'react'
import type { ApplicationField as ApplicationFieldModel } from './types'

export function ApplicationField({ children }: { field: ApplicationFieldModel; children: ReactNode }) {
  return <div className="application-field-wrap">{children}</div>
}
