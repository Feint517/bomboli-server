export interface SellerVerificationDto {
  kind: 'IDENTITY' | 'HYGIENE_CHARTER' | 'PHONE' | 'ADDRESS';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  verifiedAt: string | null;
}

export interface SellerStatsDto {
  avgRating: number;
  ratingCount: number;
  distribution: Record<string, number>;
  hygieneBar: number;
  qualityBar: number;
  packagingBar: number;
  topSentimentTags: string[];
}

export interface SellerProfileResponseDto {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  heroUrl: string | null;
  bannerUrl: string | null;
  deliveryRadiusKm: number;
  availability: Record<string, string | null> | null;
  languages: string[];
  pickupPoint: { lat: number; lng: number } | null;
  promo: { text: string; expiresAt: string | null } | null;
  verifications: SellerVerificationDto[];
  stats: SellerStatsDto;
  createdAt: string;
  updatedAt: string;
}
