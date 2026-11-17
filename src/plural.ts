// Склонение по числу: 1 запись, 2 записи, 5 записей, 11 записей, 21 запись
export function plural(n: number, forms: [string, string, string]): string {
  const hundred = Math.abs(n) % 100
  const digit = hundred % 10
  if (hundred > 10 && hundred < 20) return forms[2]
  if (digit > 1 && digit < 5) return forms[1]
  if (digit === 1) return forms[0]
  return forms[2]
}

export const withUnit = (n: number, forms: [string, string, string]) => `${n} ${plural(n, forms)}`
