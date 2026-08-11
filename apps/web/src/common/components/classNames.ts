type ClassNameValue = string | false | null | undefined

export const classNames = (...values: ClassNameValue[]): string => {
  return values.filter(Boolean).join(' ')
}
