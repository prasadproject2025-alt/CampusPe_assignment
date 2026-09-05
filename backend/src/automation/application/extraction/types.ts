export type ExtractedControl = {
  question: string
  kind: string
  required: boolean
  visible: boolean
  options: string[]
  name: string
  id: string
  dataUi: string
  answered: boolean
  generatedName: boolean
  section?: string
  atsId?: string
}
