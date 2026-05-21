import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { SellersService } from '@modules/sellers/sellers.service';
import { RecentlyViewedService } from '@modules/users/recently-viewed/recently-viewed.service';
import { UsersService } from '@modules/users/users.service';

import { ListingPhotoDto, ListingResponseDto } from './dto/listing-response.dto';
import { ListingsMapper } from './listings.mapper';
import {
  CreateListingInput,
  ListingRow,
  ListingStatusValue,
  ListingsRepository,
  UpdateListingInput,
} from './listings.repository';

const ALLOWED_TRANSITIONS: Record<ListingStatusValue, ListingStatusValue[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['SOLD_OUT', 'ARCHIVED', 'DRAFT'],
  SOLD_OUT: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly users: UsersService,
    private readonly sellers: SellersService,
    private readonly recentlyViewed: RecentlyViewedService,
    private readonly repo: ListingsRepository,
    private readonly mapper: ListingsMapper,
  ) {}

  /**
   * Public read. If `viewerSupabaseId` is present, records the listing in
   * the viewer's recently-viewed set (fire-and-forget).
   */
  async getById(id: string, viewerSupabaseId?: string): Promise<ListingResponseDto> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Listing not found');
    if (viewerSupabaseId) {
      void this.recordViewSafely(id, viewerSupabaseId);
    }
    return this.mapper.composeOne(row);
  }

  async listBySeller(sellerId: string): Promise<ListingResponseDto[]> {
    const rows = await this.repo.listBySeller(sellerId, { onlyPublished: true });
    return this.mapper.composeMany(rows);
  }

  async listMine(actorSupabaseId: string): Promise<ListingResponseDto[]> {
    const sellerId = await this.requireSellerId(actorSupabaseId);
    const rows = await this.repo.listBySeller(sellerId);
    return this.mapper.composeMany(rows);
  }

  async create(
    actorSupabaseId: string,
    input: Omit<CreateListingInput, 'sellerId'>,
  ): Promise<ListingResponseDto> {
    const sellerId = await this.requireSellerId(actorSupabaseId);
    const row = await this.repo.create({ ...input, sellerId });
    return this.mapper.composeOne(row);
  }

  async update(
    actorSupabaseId: string,
    id: string,
    input: UpdateListingInput,
  ): Promise<ListingResponseDto> {
    await this.ensureOwns(actorSupabaseId, id);
    const row = await this.repo.update(id, input);
    if (!row) throw new NotFoundException('Listing not found');
    return this.mapper.composeOne(row);
  }

  async publish(actorSupabaseId: string, id: string): Promise<ListingResponseDto> {
    const row = await this.transitionStatus(actorSupabaseId, id, 'PUBLISHED', {
      publishedAt: new Date(),
    });
    return this.mapper.composeOne(row);
  }

  async archive(actorSupabaseId: string, id: string): Promise<ListingResponseDto> {
    const row = await this.transitionStatus(actorSupabaseId, id, 'ARCHIVED');
    return this.mapper.composeOne(row);
  }

  async softDelete(actorSupabaseId: string, id: string): Promise<void> {
    await this.ensureOwns(actorSupabaseId, id);
    await this.repo.softDelete(id);
  }

  // ----- Photo helpers (used by photos controller) -----

  async getOwnedRowOrFail(actorSupabaseId: string, id: string): Promise<ListingRow> {
    const sellerId = await this.requireSellerId(actorSupabaseId);
    const row = await this.repo.findById(id, { includeDeleted: true });
    if (!row) throw new NotFoundException('Listing not found');
    if (row.sellerId !== sellerId) throw new ForbiddenException('Not your listing');
    return row;
  }

  async setPhotos(id: string, photos: ListingPhotoDto[]): Promise<void> {
    await this.repo.setPhotos(id, photos);
  }

  // ----- Internals -----

  private async transitionStatus(
    actorSupabaseId: string,
    id: string,
    next: ListingStatusValue,
    opts: { publishedAt?: Date } = {},
  ): Promise<ListingRow> {
    const row = await this.ensureOwns(actorSupabaseId, id);
    if (row.status === next) return row;
    if (!ALLOWED_TRANSITIONS[row.status].includes(next)) {
      throw new ConflictException(`Cannot transition from ${row.status} to ${next}`);
    }
    const updated = await this.repo.setStatus(id, next, {
      publishedAt: opts.publishedAt ?? (next === 'PUBLISHED' ? new Date() : undefined),
    });
    if (!updated) throw new NotFoundException('Listing not found');
    return updated;
  }

  private async requireSellerId(actorSupabaseId: string): Promise<string> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const sellerId = await this.sellers.findSellerIdByUserId(user.id);
    if (!sellerId) {
      throw new ForbiddenException(
        'You must create a seller profile first (PUT /v1/sellers/me/profile)',
      );
    }
    return sellerId;
  }

  private async ensureOwns(actorSupabaseId: string, listingId: string): Promise<ListingRow> {
    const sellerId = await this.requireSellerId(actorSupabaseId);
    const row = await this.repo.findById(listingId, { includeDeleted: true });
    if (!row) throw new NotFoundException('Listing not found');
    if (row.sellerId !== sellerId) throw new ForbiddenException('Not your listing');
    return row;
  }

  private async recordViewSafely(listingId: string, viewerSupabaseId: string): Promise<void> {
    try {
      const user = await this.users.findBySupabaseId(viewerSupabaseId);
      if (user) {
        await this.recentlyViewed.record(user.id, listingId);
      }
    } catch (err) {
      this.logger.warn(`Failed to record recently-viewed: ${(err as Error).message}`);
    }
  }
}
