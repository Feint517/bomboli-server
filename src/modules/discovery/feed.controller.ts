import { Controller, Get, Query, Req } from '@nestjs/common';
import jwt from 'jsonwebtoken';

import { Public } from '@common/decorators/public.decorator';

import { FeedResponseDto } from './dto/discovery-response.dto';
import { FeedDto } from './dto/feed.dto';
import { FeedService } from './feed.service';

import type { Request } from 'express';

@Controller({ path: 'feed', version: '1' })
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  /**
   * Single endpoint returning all six home-feed rails. Public, but
   * opportunistically reads the `sub` claim from a Bearer token (if
   * present) to populate the `vuRecemment` rail from the caller's
   * recently-viewed set. Without auth, the rail is empty.
   */
  @Public()
  @Get()
  async getFeed(@Query() dto: FeedDto, @Req() req: Request): Promise<FeedResponseDto> {
    const point =
      dto.lat !== undefined && dto.lng !== undefined ? { lat: dto.lat, lng: dto.lng } : undefined;
    const viewerSupabaseId = extractViewerSub(req);
    return this.feed.getFeed(point, viewerSupabaseId, dto.limit);
  }
}

function extractViewerSub(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length);
  try {
    const decoded = jwt.decode(token);
    if (typeof decoded === 'object' && decoded && typeof decoded.sub === 'string') {
      return decoded.sub;
    }
  } catch {
    // ignore
  }
  return undefined;
}
