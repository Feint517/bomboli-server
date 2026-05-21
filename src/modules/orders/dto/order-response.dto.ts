import { DelivererSummaryDto } from '@modules/deliverers/dto/deliverer-response.dto';
import { ListingSellerSummaryDto } from '@modules/listings/dto/listing-response.dto';

export interface OrderItemResponseDto {
  id: string;
  listingId: string;
  titleSnapshot: string;
  priceCentsSnapshot: number;
  photoUrlSnapshot: string | null;
  quantity: number;
  options: Record<string, unknown> | null;
  lineTotalCents: number;
}

export interface OrderAddressSnapshotDto {
  label: string;
  formatted: string;
  lat: number;
  lng: number;
  gateCode: string | null;
  floor: string | null;
  deliveryInstructions: string | null;
}

export interface OrderResponseDto {
  id: string;
  buyerId: string;
  sellerId: string;
  seller: ListingSellerSummaryDto | null;
  status: 'PREPARING' | 'ON_THE_WAY' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';
  fulfillmentType: 'DELIVERY' | 'PICKUP';
  addressSnapshot: OrderAddressSnapshotDto | null;
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  currency: string;
  etaAt: string | null;
  delivererId: string | null;
  /** Public-safe summary surfaced once a deliverer is assigned. Null otherwise. */
  deliverer: DelivererSummaryDto | null;
  paymentId: string | null;
  items: OrderItemResponseDto[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderListResponseDto {
  results: OrderResponseDto[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
