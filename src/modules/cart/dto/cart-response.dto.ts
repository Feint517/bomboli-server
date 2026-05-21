import { ListingSellerSummaryDto } from '@modules/listings/dto/listing-response.dto';

export interface CartItemListingSummaryDto {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  primaryPhotoUrl: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'SOLD_OUT' | 'ARCHIVED';
}

export interface CartItemResponseDto {
  id: string;
  listing: CartItemListingSummaryDto;
  quantity: number;
  options: Record<string, unknown> | null;
  lineTotalCents: number;
}

export interface CartResponseDto {
  id: string;
  sellerId: string | null;
  currency: string | null;
  seller: ListingSellerSummaryDto | null;
  items: CartItemResponseDto[];
  itemCount: number;
  subtotalCents: number;
}
