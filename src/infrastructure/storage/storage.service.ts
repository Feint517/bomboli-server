import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import { ALL_BUCKETS, BucketName } from './buckets';

const DEFAULT_READ_TTL_SECONDS = 3600;

export interface SignedUploadUrl {
  path: string;
  token: string;
  signedUrl: string;
}

export interface SignedReadUrl {
  signedUrl: string;
  expiresAt: Date;
}

/**
 * Thin wrapper around Supabase Storage. Always operates with the service-role
 * client (SupabaseAdminService) — bypasses RLS by design. Buckets are private;
 * reads go through signed URLs.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly admin: SupabaseAdminService) {}

  async onModuleInit(): Promise<void> {
    // Local/test convenience: create buckets if missing. In production we
    // expect them to be provisioned via migration / IaC, so we skip there.
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    try {
      await this.ensureBuckets();
    } catch (err) {
      this.logger.warn(
        `Bucket bootstrap skipped (${(err as Error).message}). Run manually if needed.`,
      );
    }
  }

  async ensureBuckets(): Promise<void> {
    const { data: existing, error } = await this.admin.client.storage.listBuckets();
    if (error) {
      throw error;
    }
    const have = new Set((existing ?? []).map((b) => b.name));
    for (const name of ALL_BUCKETS) {
      if (have.has(name)) continue;
      const { error: createErr } = await this.admin.client.storage.createBucket(name, {
        public: false,
      });
      if (createErr) {
        throw createErr;
      }
      this.logger.log(`Created storage bucket: ${name}`);
    }
  }

  async createSignedUploadUrl(bucket: BucketName, path: string): Promise<SignedUploadUrl> {
    const { data, error } = await this.admin.storage(bucket).createSignedUploadUrl(path);
    if (error || !data) {
      throw error ?? new Error('Failed to create signed upload URL');
    }
    return { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }

  async createSignedReadUrl(
    bucket: BucketName,
    path: string,
    expiresInSeconds: number = DEFAULT_READ_TTL_SECONDS,
  ): Promise<SignedReadUrl> {
    const { data, error } = await this.admin
      .storage(bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) {
      throw error ?? new Error('Failed to create signed read URL');
    }
    return {
      signedUrl: data.signedUrl,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async delete(bucket: BucketName, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.admin.storage(bucket).remove(paths);
    if (error) {
      throw error;
    }
  }
}
