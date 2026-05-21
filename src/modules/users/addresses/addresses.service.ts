import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { UsersService } from '../users.service';
import { AddressRow, AddressesRepository } from './addresses.repository';

export interface CreateAddressArgs {
  label: string;
  formatted: string;
  lat: number;
  lng: number;
  gateCode?: string;
  floor?: string;
  deliveryInstructions?: string;
  isDefault?: boolean;
}

export interface UpdateAddressArgs {
  label?: string;
  formatted?: string;
  lat?: number;
  lng?: number;
  gateCode?: string | null;
  floor?: string | null;
  deliveryInstructions?: string | null;
}

@Injectable()
export class AddressesService {
  constructor(
    private readonly users: UsersService,
    private readonly repo: AddressesRepository,
  ) {}

  async list(actorSupabaseId: string): Promise<AddressRow[]> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    return this.repo.listByUser(user.id);
  }

  async create(actorSupabaseId: string, args: CreateAddressArgs): Promise<AddressRow> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    // First address becomes default automatically.
    const existing = await this.repo.listByUser(user.id);
    const isDefault = args.isDefault ?? existing.length === 0;
    return this.repo.create({
      userId: user.id,
      label: args.label,
      formatted: args.formatted,
      lat: args.lat,
      lng: args.lng,
      gateCode: args.gateCode ?? null,
      floor: args.floor ?? null,
      deliveryInstructions: args.deliveryInstructions ?? null,
      isDefault,
    });
  }

  async update(actorSupabaseId: string, id: string, args: UpdateAddressArgs): Promise<AddressRow> {
    await this.ensureOwns(actorSupabaseId, id);
    const updated = await this.repo.update(id, args);
    if (!updated) throw new NotFoundException('Address not found');
    return updated;
  }

  async remove(actorSupabaseId: string, id: string): Promise<void> {
    await this.ensureOwns(actorSupabaseId, id);
    await this.repo.delete(id);
  }

  async setDefault(actorSupabaseId: string, id: string): Promise<AddressRow> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Address not found');
    if (existing.userId !== user.id) throw new ForbiddenException('Not your address');
    const updated = await this.repo.setDefault(user.id, id);
    if (!updated) throw new NotFoundException('Address not found');
    return updated;
  }

  /**
   * Public helper used by the orders module to snapshot an address into a
   * new order. Validates ownership and returns the AddressRow (with lat/lng
   * already decoded from PostGIS).
   */
  async findOwnedOrFail(actorSupabaseId: string, addressId: string): Promise<AddressRow> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const row = await this.repo.findById(addressId);
    if (!row) throw new NotFoundException('Address not found');
    if (row.userId !== user.id) throw new ForbiddenException('Not your address');
    return row;
  }

  private async ensureOwns(actorSupabaseId: string, addressId: string): Promise<void> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const row = await this.repo.findById(addressId);
    if (!row) throw new NotFoundException('Address not found');
    if (row.userId !== user.id) throw new ForbiddenException('Not your address');
  }
}
