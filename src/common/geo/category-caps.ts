/**
 * Per-category maximum proximity radius in kilometers. Source: PRODUCT.md §3.
 * Enforced at query time on search and feed endpoints — listings past the
 * cap for their category are filtered out.
 */

export const ListingCategories = {
  COSMETIQUE: 'COSMETIQUE',
  TEXTILE: 'TEXTILE',
  SECONDE_MAIN: 'SECONDE_MAIN',
  AGRICOLE: 'AGRICOLE',
  SERVICES: 'SERVICES',
  AUTRES: 'AUTRES',
} as const;

export type ListingCategory = (typeof ListingCategories)[keyof typeof ListingCategories];

export const CATEGORY_MAX_KM: Record<ListingCategory, number> = {
  COSMETIQUE: 25,
  TEXTILE: 25,
  SECONDE_MAIN: 15,
  AGRICOLE: 30,
  SERVICES: 20,
  AUTRES: 25,
};

export function maxRadiusKm(category: ListingCategory): number {
  return CATEGORY_MAX_KM[category];
}
