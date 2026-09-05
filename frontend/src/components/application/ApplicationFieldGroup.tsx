import type { ReactNode } from 'react'

export function ApplicationFieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="application-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}
