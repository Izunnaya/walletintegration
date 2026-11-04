export function toMinor(input: string): string {
  const value = input.trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a positive naira amount with at most 2 decimal places.')
  const [whole, fraction = ''] = value.replaceAll(',', '').split('.')
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
  if (minor <= BigInt(0)) throw new Error('Amount must be greater than zero.')
  return minor.toString()
}
export function money(input: string | bigint): string {
  const value = BigInt(input)
  const absolute = value < BigInt(0) ? -value : value
  return `${value < BigInt(0) ? '−' : ''}₦${(absolute / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(absolute % BigInt(100)).toString().padStart(2, '0')}`
}

// The overview prints the kobo dimmed against the naira, so it needs the two halves apart.
// It splits the formatted string rather than the minor units, to keep the thousands
// grouping and the currency symbol in one place.
export function moneyParts(input: string | bigint): { whole: string; fraction: string } {
  const formatted = money(input)
  const point = formatted.lastIndexOf('.')
  return { whole: formatted.slice(0, point), fraction: formatted.slice(point + 1) }
}
