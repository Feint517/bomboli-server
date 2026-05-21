import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RegisterDeviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  /** FCM/APNs token. Long, opaque; bound at 2048 chars defensively. */
  pushToken: z.string().trim().min(1).max(2048),
});

export class RegisterDeviceDto extends createZodDto(RegisterDeviceSchema) {}
