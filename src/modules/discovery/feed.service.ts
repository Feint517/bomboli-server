import { Injectable } from '@nestjs/common';

import { ListingsMapper } from '@modules/listings/listings.mapper';
import { ListingsRepository } from '@modules/listings/listings.repository';
import { RecentlyViewedService } from '@modules/users/recently-viewed/recently-viewed.service';
import { UsersService } from '@modules/users/users.service';

import { DiscoveryRepository, SellerNearbyRow } from './discovery.repository';
import { FeedResponseDto, SellerNearbyDto } from './dto/discovery-response.dto';

@Injectable()
export class FeedService {
  constructor(
    private readonly repo: DiscoveryRepository,
    private readonly listings: ListingsRepository,
    private readonly mapper: ListingsMapper,
    private readonly users: UsersService,
    private readonly recentlyViewed: RecentlyViewedService,
  ) {}

  /**
   * Builds all six home-feed rails in parallel. When `point` is omitted the
   * proximity rails (aDecouvrir, bonsPlans, bientotTermine,
   * servicesPresDeToi, vendeursProches) return empty arrays — the home
   * screen should prompt for location permission. When `viewerSupabaseId`
   * is omitted, `vuRecemment` is empty too.
   */
  async getFeed(
    point: { lat: number; lng: number } | undefined,
    viewerSupabaseId: string | undefined,
    limit: number,
  ): Promise<FeedResponseDto> {
    const empty = [] as never[];
    const proximityQueries = point
      ? Promise.all([
          this.repo.aDecouvrir(point, limit),
          this.repo.bonsPlans(point, limit),
          this.repo.bientotTermine(point, limit),
          this.repo.servicesPresDeToi(point, limit),
          this.repo.vendeursProches(point, limit),
        ])
      : Promise.resolve([empty, empty, empty, empty, [] as SellerNearbyRow[]] as const);

    const recentlyViewedQuery = viewerSupabaseId
      ? this.hydrateRecentlyViewed(viewerSupabaseId, limit)
      : Promise.resolve([]);

    const [
      [aDecouvrirRows, bonsPlansRows, bientotTermineRows, servicesRows, vendeursRows],
      vuRecemment,
    ] = await Promise.all([proximityQueries, recentlyViewedQuery]);

    const [aDecouvrir, bonsPlans, bientotTermine, servicesPresDeToi] = await Promise.all([
      this.mapper.composeMany(aDecouvrirRows),
      this.mapper.composeMany(bonsPlansRows),
      this.mapper.composeMany(bientotTermineRows),
      this.mapper.composeMany(servicesRows),
    ]);

    return {
      aDecouvrir,
      bonsPlans,
      bientotTermine,
      servicesPresDeToi,
      vendeursProches: vendeursRows.map(toSellerNearby),
      vuRecemment,
    };
  }

  private async hydrateRecentlyViewed(
    viewerSupabaseId: string,
    limit: number,
  ): Promise<FeedResponseDto['vuRecemment']> {
    const user = await this.users.findBySupabaseId(viewerSupabaseId);
    if (!user) return [];
    const ids = await this.recentlyViewed.list(user.id, limit);
    if (ids.length === 0) return [];
    // Load each listing and preserve the order from Redis.
    const rows = await Promise.all(ids.map((id) => this.listings.findById(id)));
    const ordered = rows.filter((r): r is NonNullable<typeof r> => r !== null);
    return this.mapper.composeMany(ordered);
  }
}

function toSellerNearby(row: SellerNearbyRow): SellerNearbyDto {
  return {
    id: row.sellerId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bannerUrl: row.bannerUrl,
    distanceKm: Number(row.distance_m) / 1000,
  };
}
