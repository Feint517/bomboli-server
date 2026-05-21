import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Device } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { UsersService } from '../users.service';

export interface RegisterDeviceArgs {
  platform: 'ios' | 'android' | 'web';
  pushToken: string;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async list(actorSupabaseId: string): Promise<Device[]> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    return this.prisma.device.findMany({
      where: { userId: user.id },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /**
   * Idempotent upsert keyed by `pushToken` (provider-unique). If the token
   * was previously registered to a different user (e.g. multi-account on the
   * same device), it migrates to the current user.
   */
  async register(actorSupabaseId: string, args: RegisterDeviceArgs): Promise<Device> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    return this.prisma.device.upsert({
      where: { pushToken: args.pushToken },
      create: {
        userId: user.id,
        platform: args.platform,
        pushToken: args.pushToken,
      },
      update: {
        userId: user.id,
        platform: args.platform,
        lastSeenAt: new Date(),
      },
    });
  }

  async unregister(actorSupabaseId: string, deviceId: string): Promise<void> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    if (device.userId !== user.id) throw new ForbiddenException('Not your device');
    await this.prisma.device.delete({ where: { id: deviceId } });
  }
}
