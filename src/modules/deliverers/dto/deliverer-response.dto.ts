export interface DelivererResponseDto {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  vehicleType: 'MOTO' | 'VOITURE' | 'VELO' | 'A_PIED';
  phoneMasked: string;
  available: boolean;
  currentLocation: { lat: number; lng: number } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public-facing summary surfaced on order responses when a deliverer has
 * been assigned. Never includes the full phone or live location — only
 * what a buyer needs to recognize their courier.
 */
export interface DelivererSummaryDto {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  vehicleType: 'MOTO' | 'VOITURE' | 'VELO' | 'A_PIED';
  phoneMasked: string;
}
