import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ulid } from 'ulid';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { BUCKETS } from '@infrastructure/storage/buckets';
import { StorageService } from '@infrastructure/storage/storage.service';

import { MeResponseDto } from './dto/me-response.dto';
import { UpdateProfileDto, AvatarUploadInitDto } from './dto/update-profile.dto';
import { toMeResponse } from './users.mapper';
import { UsersService } from './users.service';

interface AvatarUploadInitResponse {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  expectedAvatarUrl: string;
}

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly storage: StorageService,
  ) {}

  @Get('me')
  async getMe(@CurrentUser() actor: AuthenticatedUser): Promise<MeResponseDto> {
    const user = await this.users.getMeWithLocation(actor.id);
    return toMeResponse(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MeResponseDto> {
    const user = await this.users.updateProfile(actor.id, {
      displayName: dto.displayName,
      preferredLanguage: dto.preferredLanguage,
      themePref: dto.themePref,
      defaultLocation: dto.defaultLocation,
    });
    return toMeResponse(user);
  }

  /**
   * Two-step upload protocol. Client:
   *   1. POST /users/me/avatar with the content-type → receives signed URL.
   *   2. PUT the binary to `signedUrl`.
   *   3. PATCH /users/me with `{ avatarUrl: expectedAvatarUrl }` to commit.
   *
   * The bucket is private; reads happen via a separately-signed read URL.
   */
  @Post('me/avatar')
  async initAvatarUpload(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AvatarUploadInitDto,
  ): Promise<AvatarUploadInitResponse> {
    const extension =
      dto.contentType === 'image/jpeg' ? 'jpg' : dto.contentType === 'image/png' ? 'png' : 'webp';
    const path = `${actor.id}/${ulid()}.${extension}`;
    const signed = await this.storage.createSignedUploadUrl(BUCKETS.AVATARS, path);
    return {
      bucket: BUCKETS.AVATARS,
      path: signed.path,
      token: signed.token,
      signedUrl: signed.signedUrl,
      expectedAvatarUrl: `${BUCKETS.AVATARS}/${signed.path}`,
    };
  }
}
