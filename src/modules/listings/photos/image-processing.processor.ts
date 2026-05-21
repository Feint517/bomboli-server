import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import sharp from 'sharp';

import { Queues } from '@infrastructure/jobs/queues';
import { BUCKETS } from '@infrastructure/storage/buckets';
import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import { ListingPhotoDto } from '../dto/listing-response.dto';
import { ListingsRepository } from '../listings.repository';
import { ImageProcessingJob, VARIANT_SIZES } from './photo-types';

const BUCKET = BUCKETS.LISTING_PHOTOS;
const VARIANT_QUALITY = 85;

/**
 * Worker for `image-processing`. Downloads the original from Supabase
 * Storage, resizes to sm/md/lg variants via sharp, uploads them back, and
 * patches `listing.photos[]` with the variant paths + `ready: true`.
 *
 * Failures bubble up to BullMQ; the JobsModule's `defaultJobOptions` retries
 * with exponential backoff. After exhausting attempts the job lands in the
 * failed set, where ops can inspect it via Bull Board (M11/admin).
 */
@Processor(Queues.ImageProcessing)
export class ImageProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessingProcessor.name);

  constructor(
    private readonly admin: SupabaseAdminService,
    private readonly listings: ListingsRepository,
  ) {
    super();
  }

  async process(job: Job<ImageProcessingJob>): Promise<void> {
    const { listingId, photoId, originalPath } = job.data;
    this.logger.log(`Processing photo ${photoId} for listing ${listingId}`);

    // 1. Download the original.
    const { data, error } = await this.admin.storage(BUCKET).download(originalPath);
    if (error || !data) {
      throw new Error(`Failed to download original ${originalPath}: ${error?.message}`);
    }
    const buffer = Buffer.from(await data.arrayBuffer());

    // 2. Generate and upload each variant.
    const variantPaths: Record<string, string> = {};
    for (const variant of VARIANT_SIZES) {
      const variantPath = pathWithSuffix(originalPath, variant.suffix);
      const resized = await sharp(buffer)
        .resize({ width: variant.width, withoutEnlargement: true })
        .jpeg({ quality: VARIANT_QUALITY, progressive: true, mozjpeg: true })
        .toBuffer();
      const up = await this.admin
        .storage(BUCKET)
        .upload(variantPath, resized, { contentType: 'image/jpeg', upsert: true });
      if (up.error) {
        throw new Error(`Failed to upload variant ${variantPath}: ${up.error.message}`);
      }
      variantPaths[variant.suffix] = `${BUCKET}/${variantPath}`;
    }

    // 3. Patch the listing's photos array.
    const row = await this.listings.findById(listingId, { includeDeleted: true });
    if (!row) {
      this.logger.warn(`Listing ${listingId} disappeared mid-processing`);
      return;
    }
    const updated: ListingPhotoDto[] = row.photos.map((p) =>
      p.id === photoId
        ? {
            ...p,
            sm: variantPaths.sm ?? null,
            md: variantPaths.md ?? null,
            lg: variantPaths.lg ?? null,
            ready: true,
          }
        : p,
    );
    await this.listings.setPhotos(listingId, updated);
    this.logger.log(`Photo ${photoId} variants ready`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ImageProcessingJob>, err: Error): void {
    this.logger.error(
      `image-processing job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}): ${err.message}`,
    );
  }
}

function pathWithSuffix(original: string, suffix: string): string {
  const dot = original.lastIndexOf('.');
  if (dot < 0) return `${original}_${suffix}.jpg`;
  return `${original.slice(0, dot)}_${suffix}.jpg`;
}
