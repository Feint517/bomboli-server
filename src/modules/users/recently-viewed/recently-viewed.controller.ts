import { Controller, Get } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { UsersService } from '../users.service';
import { RecentlyViewedService } from './recently-viewed.service';

interface RecentlyViewedResponseDto {
  /** Listing IDs only — full listing details come once M2 ships listings. */
  listingIds: string[];
}

@Controller({ path: 'users/me/recently-viewed', version: '1' })
export class RecentlyViewedController {
  constructor(
    private readonly recentlyViewed: RecentlyViewedService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<RecentlyViewedResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actor.id);
    const listingIds = await this.recentlyViewed.list(user.id);
    return { listingIds };
  }
}
