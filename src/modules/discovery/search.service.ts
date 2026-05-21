import { Injectable } from '@nestjs/common';

import { ListingsMapper } from '@modules/listings/listings.mapper';

import { DiscoveryRepository } from './discovery.repository';
import { SearchResponseDto } from './dto/discovery-response.dto';
import { SearchDto } from './dto/search.dto';

@Injectable()
export class SearchService {
  constructor(
    private readonly repo: DiscoveryRepository,
    private readonly mapper: ListingsMapper,
  ) {}

  async search(dto: SearchDto): Promise<SearchResponseDto> {
    const { rows, total } = await this.repo.search({
      q: dto.q,
      category: dto.category,
      maxDistanceKm: dto.maxDistanceKm,
      lat: dto.lat,
      lng: dto.lng,
      sort: dto.sort,
      offset: dto.offset,
      limit: dto.limit,
    });
    const results = await this.mapper.composeMany(rows);
    return {
      results,
      total,
      offset: dto.offset,
      limit: dto.limit,
      hasMore: dto.offset + results.length < total,
    };
  }
}
