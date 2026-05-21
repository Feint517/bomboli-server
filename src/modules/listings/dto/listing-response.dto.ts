export interface ListingPhotoDto {
  id: string;
  url: string;
  sm: string | null;
  md: string | null;
  lg: string | null;
  alt: string | null;
  uploadedAt: string | null;
  /** True once the original is uploaded; variants may still be processing. */
  ready: boolean;
}

export interface ListingSellerSummaryDto {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
}

export interface ListingResponseDto {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: 'COSMETIQUE' | 'TEXTILE' | 'SECONDE_MAIN' | 'AGRICOLE' | 'SERVICES' | 'AUTRES';
  priceCents: number;
  currency: 'CDF' | 'USD';
  location: { lat: number; lng: number };
  photos: ListingPhotoDto[];
  options: Record<string, unknown> | null;
  quantityAvailable: number;
  status: 'DRAFT' | 'PUBLISHED' | 'SOLD_OUT' | 'ARCHIVED';
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  seller: ListingSellerSummaryDto | null;
}
