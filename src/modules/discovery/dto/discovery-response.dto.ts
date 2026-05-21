import { ListingResponseDto } from '@modules/listings/dto/listing-response.dto';

export interface SearchResponseDto {
  results: ListingResponseDto[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface SellerNearbyDto {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  distanceKm: number;
}

export interface FeedResponseDto {
  aDecouvrir: ListingResponseDto[];
  bonsPlans: ListingResponseDto[];
  bientotTermine: ListingResponseDto[];
  servicesPresDeToi: ListingResponseDto[];
  vendeursProches: SellerNearbyDto[];
  vuRecemment: ListingResponseDto[];
}
