import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import jwt from 'jsonwebtoken';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { ListingResponseDto } from './dto/listing-response.dto';
import { CreateListingDto, UpdateListingDto } from './dto/listing.dto';
import { ListingsService } from './listings.service';

import type { Request } from 'express';

@Controller({ path: 'listings', version: '1' })
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get()
  listPublished(): Promise<ListingResponseDto[]> {
    return this.listings.listPublished();
  }

  /**
   * Public listing detail. If the caller IS authenticated (Bearer present),
   * we record the view in their recently-viewed set. The endpoint itself is
   * @Public so unauthenticated browsing works.
   */
  @Public()
  @Get(':id')
  async getById(@Param('id') id: string, @Req() req: Request): Promise<ListingResponseDto> {
    const viewerSupabaseId = extractViewerSub(req);
    return this.listings.getById(id, viewerSupabaseId);
  }

  @Get('me/owned')
  listMine(@CurrentUser() actor: AuthenticatedUser): Promise<ListingResponseDto[]> {
    return this.listings.listMine(actor.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateListingDto,
  ): Promise<ListingResponseDto> {
    return this.listings.create(actor.id, {
      title: dto.title,
      description: dto.description,
      category: dto.category,
      priceCents: dto.priceCents,
      currency: dto.currency ?? 'CDF',
      lat: dto.lat,
      lng: dto.lng,
      quantityAvailable: dto.quantityAvailable ?? 1,
      options: dto.options ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ): Promise<ListingResponseDto> {
    return this.listings.update(actor.id, id, {
      title: dto.title,
      description: dto.description,
      category: dto.category,
      priceCents: dto.priceCents,
      currency: dto.currency,
      lat: dto.lat,
      lng: dto.lng,
      quantityAvailable: dto.quantityAvailable,
      options: dto.options,
      expiresAt:
        dto.expiresAt === undefined
          ? undefined
          : dto.expiresAt === null
            ? null
            : new Date(dto.expiresAt),
    });
  }

  @Post(':id/publish')
  publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ListingResponseDto> {
    return this.listings.publish(actor.id, id);
  }

  @Post(':id/archive')
  archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ListingResponseDto> {
    return this.listings.archive(actor.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async softDelete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.listings.softDelete(actor.id, id);
  }
}

/**
 * Extracts the `sub` claim from a Bearer token without verifying — the only
 * use here is opportunistic (record-the-view-if-known). A forged token can't
 * cause harm because nothing privileged is gated on it; the strategy still
 * runs for any authenticated endpoint.
 */
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
