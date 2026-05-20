/**
 * Money is always cents + ISO 4217 currency. Never floats. The DRC ships
 * with CDF as primary and USD as a shadow-pricing display option.
 */

export type Currency = 'CDF' | 'USD';

export const SUPPORTED_CURRENCIES: readonly Currency[] = ['CDF', 'USD'] as const;

export const DEFAULT_CURRENCY: Currency = 'CDF';

const FRACTION_DIGITS: Record<Currency, number> = {
  CDF: 0,
  USD: 2,
};

export function formatMoney(amountCents: number, currency: Currency, locale = 'fr-CD'): string {
  const fractionDigits = FRACTION_DIGITS[currency];
  const major = amountCents / 10 ** fractionDigits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);
}

export function toCents(major: number, currency: Currency): number {
  return Math.round(major * 10 ** FRACTION_DIGITS[currency]);
}

export function fromCents(cents: number, currency: Currency): number {
  return cents / 10 ** FRACTION_DIGITS[currency];
}
