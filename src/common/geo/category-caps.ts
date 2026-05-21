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

/**
 * Global ceiling — never search past this even if a category cap is higher.
 * Mirrors the largest individual cap so the SQL helper is a no-op when no
 * client cap is passed.
 */
export const GLOBAL_MAX_KM = 30;

/**
 * Builds the per-category radius (in meters) as a SQL CASE expression. Embed
 * inside a raw SQL template:
 *
 *   ST_DWithin(l.location, $point, ${categoryRadiusMetersSql('l')})
 *
 * The `alias` parameter must qualify the `category` column unambiguously
 * (`l.category`, not just `category`) — required in queries with joins.
 */
export function categoryRadiusMetersSql(tableAlias: string): string {
  return `
    CASE ${tableAlias}.category
      WHEN 'COSMETIQUE'   THEN ${CATEGORY_MAX_KM.COSMETIQUE * 1000}
      WHEN 'TEXTILE'      THEN ${CATEGORY_MAX_KM.TEXTILE * 1000}
      WHEN 'SECONDE_MAIN' THEN ${CATEGORY_MAX_KM.SECONDE_MAIN * 1000}
      WHEN 'AGRICOLE'     THEN ${CATEGORY_MAX_KM.AGRICOLE * 1000}
      WHEN 'SERVICES'     THEN ${CATEGORY_MAX_KM.SERVICES * 1000}
      WHEN 'AUTRES'       THEN ${CATEGORY_MAX_KM.AUTRES * 1000}
    END
  `;
}
