/**
 * Geo + price fixtures used by the discovery e2e tests. The radii match the
 * per-category caps in src/common/geo/category-caps.ts so we can craft both
 * "in-cap" and "out-of-cap" listings.
 */

// Center of Kinshasa (≈ Gombe). Distances below are great-circle approximations.
export const KIN_CENTER = { lat: -4.3217, lng: 15.3125 };

/** ≈3km north of center. Comfortably inside every category cap. */
export const KIN_NEAR = { lat: -4.295, lng: 15.31 };

/** ≈10km east of center. Inside SECONDE_MAIN(15), SERVICES(20), TEXTILE/COSMETIQUE/AUTRES(25), AGRICOLE(30). */
export const KIN_MID = { lat: -4.32, lng: 15.4 };

/** ≈22km north-east. Outside SECONDE_MAIN(15) and SERVICES(20); inside the rest. */
export const KIN_FAR = { lat: -4.13, lng: 15.43 };

/** ≈55km south. Outside every category cap. */
export const KIN_WAY_OUT = { lat: -4.8, lng: 15.31 };

export const LISTING_TEMPLATES = {
  iphone: {
    title: 'iPhone 13 Pro reconditionné',
    description: 'En parfait état, batterie 92%, livré avec chargeur et coque.',
    category: 'SECONDE_MAIN' as const,
    priceCents: 69900,
  },
  samsung: {
    title: 'Samsung Galaxy S22 reconditionné',
    description: 'État neuf, écran AMOLED 6.1 pouces, 128 Go de stockage.',
    category: 'SECONDE_MAIN' as const,
    priceCents: 44900,
  },
  savonNoir: {
    title: 'Savon noir artisanal',
    description: 'Savon de Marseille au beurre de karité, fabriqué à la main.',
    category: 'COSMETIQUE' as const,
    priceCents: 800,
  },
  beurreKarite: {
    title: 'Beurre de karité bio',
    description: "Hydratant pur, idéal pour peaux sèches. 250g d'origine Mbandaka.",
    category: 'COSMETIQUE' as const,
    priceCents: 1200,
  },
  coiffure: {
    title: 'Coiffure à domicile',
    description: 'Tresses, défrisage, soins capillaires. Déplacement inclus dans Kinshasa.',
    category: 'SERVICES' as const,
    priceCents: 2500,
  },
  reparation: {
    title: 'Réparation smartphone express',
    description: "Changement d'écran, batterie, dégât d'eau. Délai 24h.",
    category: 'SERVICES' as const,
    priceCents: 1800,
  },
  manioc: {
    title: 'Manioc frais',
    description: 'Récolte du matin, livré depuis Maluku. Sac de 5 kg.',
    category: 'AGRICOLE' as const,
    priceCents: 600,
  },
  pagne: {
    title: 'Pagne wax 6 yards',
    description: 'Tissu vichy 100% coton, motif fleuri, idéal pour couture.',
    category: 'TEXTILE' as const,
    priceCents: 3500,
  },
};

export type ListingTemplateKey = keyof typeof LISTING_TEMPLATES;
