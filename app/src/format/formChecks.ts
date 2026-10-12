/// Field-level checks the composers show under the field, in one vocabulary.

/// A maturity date that has already passed isn't an error: an overdue debt is a real debt, and it
/// can be netted straight away. It gets a plain note so the date isn't a surprise.
export function pastMaturityNote(maturityDate: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(maturityDate)) return null;
  const today = now.toISOString().slice(0, 10);
  return maturityDate < today ? "That date has already passed, so this can be netted as soon as it's signed and registered." : null;
}

export function isZeroAddress(address: string): boolean {
  return /^0x0{40}$/i.test(address.trim());
}
