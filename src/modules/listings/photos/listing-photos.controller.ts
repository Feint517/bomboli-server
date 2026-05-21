import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { ListingPhotosService, InitPhotoResult } from './listing-photos.service';
import { ListingPhotoDto } from '../dto/listing-response.dto';
import { InitListingPhotoDto } from '../dto/listing.dto';

@Controller({ path: 'listings/:id/photos', version: '1' })
export class ListingPhotosController {
  constructor(private readonly photos: ListingPhotosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  init(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') listingId: string,
    @Body() dto: InitListingPhotoDto,
  ): Promise<InitPhotoResult> {
    return this.photos.initUpload(actor.id, listingId, dto.contentType, dto.alt);
  }

  @Post(':photoId/commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') listingId: string,
    @Param('photoId') photoId: string,
  ): Promise<ListingPhotoDto> {
    return this.photos.commit(actor.id, listingId, photoId);
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') listingId: string,
    @Param('photoId') photoId: string,
  ): Promise<void> {
    await this.photos.delete(actor.id, listingId, photoId);
  }
}
