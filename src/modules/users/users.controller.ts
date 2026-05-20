import { Controller, Get } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { MeResponseDto } from './dto/me-response.dto';
import { toMeResponse } from './users.mapper';
import { UsersService } from './users.service';

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() actor: AuthenticatedUser): Promise<MeResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actor.id);
    return toMeResponse(user);
  }
}
