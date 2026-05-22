import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthenticatedUser } from '@common/types/authenticated-request.type';
import type { JwtPayload } from '@common/types/jwt-payload.type';

import { supabaseConfig } from '@config/supabase.config';

import { UsersService } from '@modules/users/users.service';

/**
 * Verifies JWTs issued by Supabase Auth.
 *
 * Supabase migrated from HS256 (shared secret) to asymmetric ES256 with JWKS
 * key rotation. We support both so that:
 *   - Real Supabase access tokens (ES256, verified against the JWKS endpoint)
 *     work in production.
 *   - Locally-minted test tokens from `scripts/mint-test-jwt.ts` (HS256
 *     against SUPABASE_JWT_SECRET) still work in our e2e suite.
 *
 * The algorithm is detected from the token header and the appropriate key
 * material is supplied to passport-jwt's verifier.
 *
 * On valid tokens, the local User row is fetched (or JIT-provisioned from
 * JWT claims when missing — see the SupabaseWebhookController for the
 * canonical provisioning path).
 */
@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private static readonly ALGS = ['HS256', 'ES256', 'RS256'] as const;
  private readonly logger = new Logger(SupabaseJwtStrategy.name);

  constructor(
    @Inject(supabaseConfig.KEY) cfg: ConfigType<typeof supabaseConfig>,
    private readonly users: UsersService,
  ) {
    if (!cfg.jwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET is required');
    }
    const jwks = jwksClient({
      jwksUri: `${cfg.url}/auth/v1/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 30,
    });
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      audience: 'authenticated',
      algorithms: [...SupabaseJwtStrategy.ALGS],
      secretOrKeyProvider: (_req, rawToken, done) => {
        try {
          const decoded = jwt.decode(rawToken, { complete: true });
          if (!decoded || typeof decoded === 'string') {
            return done(new Error('Cannot decode token'));
          }
          const alg = decoded.header.alg;
          if (alg === 'HS256') {
            return done(null, cfg.jwtSecret);
          }
          if (alg !== 'ES256' && alg !== 'RS256') {
            return done(new Error(`Unsupported JWT algorithm: ${alg}`));
          }
          jwks.getSigningKey(decoded.header.kid, (err, key) => {
            if (err || !key) {
              return done(err ?? new Error('No matching signing key'));
            }
            done(null, key.getPublicKey());
          });
        } catch (err) {
          done(err as Error);
        }
      },
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    let user = await this.users.findBySupabaseId(payload.sub);

    if (!user) {
      if (!payload.email) {
        throw new UnauthorizedException('Cannot provision user: token missing email');
      }
      this.logger.warn(`JIT-provisioning user ${payload.sub} (webhook may not have fired)`);
      user = await this.users.provisionFromSupabase({
        supabaseId: payload.sub,
        email: payload.email,
        phone: payload.phone ?? null,
      });
    }

    return {
      id: payload.sub,
      email: user.email,
      // Empty string from the JWT would collide with User.phone @unique; treat
      // falsy values as undefined.
      phone: user.phone ?? undefined,
      isAdmin: user.isAdmin,
    };
  }
}
