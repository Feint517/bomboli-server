import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ulid } from 'ulid';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { BUCKETS } from '@infrastructure/storage/buckets';
import { StorageService } from '@infrastructure/storage/storage.service';

import { SellerProfileResponseDto } from './dto/seller-response.dto';
import { SellerImageUploadInitDto, UpsertSellerProfileDto } from './dto/seller.dto';
import { SellersService } from './sellers.service';

interface SellerImageUploadInitResponse {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  expectedUrl: string;
}

@Controller({ path: 'sellers', version: '1' })
export class SellersController {
  constructor(
    private readonly sellers: SellersService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get(':id')
  getProfile(@Param('id') id: string): Promise<SellerProfileResponseDto> {
    return this.sellers.getPublicProfile(id);
  }

  @Get('me/profile')
  async getMyProfile(@CurrentUser() actor: AuthenticatedUser): Promise<SellerProfileResponseDto> {
    const profile = await this.sellers.getMyProfile(actor.id);
    if (!profile) {
      throw new NotFoundException('No seller profile yet — PUT /v1/sellers/me/profile to create');
    }
    return profile;
  }

  /**
   * Create-or-update the caller's seller profile. First call promotes the
   * caller from BUYER to SELLER.
   */
  @Put('me/profile')
  upsertMyProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpsertSellerProfileDto,
  ): Promise<SellerProfileResponseDto> {
    return this.sellers.upsertMyProfile(actor.id, {
      bio: dto.bio,
      deliveryRadiusKm: dto.deliveryRadiusKm,
      availability: dto.availability,
      languages: dto.languages,
      pickupPoint: dto.pickupPoint,
      promoText: dto.promoText,
      promoActive: dto.promoActive,
      promoExpiresAt:
        dto.promoExpiresAt === undefined
          ? undefined
          : dto.promoExpiresAt === null
            ? null
            : new Date(dto.promoExpiresAt),
    });
  }

  /**
   * Two-step upload (same protocol as avatar): init → PUT to signedUrl →
   * PATCH the profile with the returned `expectedUrl` saved as bannerUrl /
   * heroUrl. Returns 201 once the seller profile exists.
   */
  @Post('me/profile/image')
  @HttpCode(HttpStatus.CREATED)
  async initImageUpload(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SellerImageUploadInitDto,
  ): Promise<SellerImageUploadInitResponse> {
    const profile = await this.sellers.getMyProfile(actor.id);
    if (!profile) {
      throw new ForbiddenException('Create a seller profile first');
    }
    const ext =
      dto.contentType === 'image/jpeg' ? 'jpg' : dto.contentType === 'image/png' ? 'png' : 'webp';
    const path = `${profile.id}/${dto.kind}-${ulid()}.${ext}`;
    const signed = await this.storage.createSignedUploadUrl(BUCKETS.SELLER_BANNERS, path);
    const expectedUrl = `${BUCKETS.SELLER_BANNERS}/${signed.path}`;

    if (dto.kind === 'banner') {
      await this.sellers.setBannerUrl(profile.id, expectedUrl);
    } else {
      await this.sellers.setHeroUrl(profile.id, expectedUrl);
    }

    return {
      bucket: BUCKETS.SELLER_BANNERS,
      path: signed.path,
      token: signed.token,
      signedUrl: signed.signedUrl,
      expectedUrl,
    };
  }
}
