export interface AddressResponseDto {
  id: string;
  label: string;
  formatted: string;
  lat: number;
  lng: number;
  gateCode: string | null;
  floor: string | null;
  deliveryInstructions: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
