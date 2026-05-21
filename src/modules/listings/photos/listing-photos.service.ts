import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ulid } from 'ulid';

import { Queues } from '@infrastructure/jobs/queues';
import { BUCKETS } from '@infrastructure/storage/buckets';
import { StorageService } from '@infrastructure/storage/storage.service';

import { ListingPhotoDto } from '../dto/listing-response.dto';
import { ListingsService } from '../listings.service';
import { ImageProcessingJob } from './photo-types';

const BUCKET = BUCKETS.LISTING_PHOTOS;
const MAX_PHOTOS = 10;

export interface InitPhotoResult {
  photoId: string;
  bucket: string;
  path: string;
  signedUrl: string;
  token: string;
}

@Injectable()
export class ListingPhotosService {
  constructor(
    private readonly storage: StorageService,
    private readonly listings: ListingsService,
    @InjectQueue(Queues.ImageProcessing) private readonly imageQueue: Queue<ImageProcessingJob>,
  ) {}

  /**
   * Reserves a photo slot: adds a pending entry to `listing.photos` and
   * returns a signed PUT URL. After client uploads, they must call `commit`
   * to enqueue processing. If commit never runs, the entry stays marked as
   * `ready: false` and ops can prune it.
   */
  async initUpload(
    actorSupabaseId: string,
    listingId: string,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
    alt?: string,
  ): Promise<InitPhotoResult> {
    const row = await this.listings.getOwnedRowOrFail(actorSupabaseId, listingId);
    if (row.photos.length >= MAX_PHOTOS) {
      throw new NotFoundException(`Photo limit reached (${MAX_PHOTOS})`);
    }
    const photoId = ulid();
    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
    const path = `${listingId}/${photoId}.${ext}`;
    const signed = await this.storage.createSignedUploadUrl(BUCKET, path);

    const entry: ListingPhotoDto = {
      id: photoId,
      url: `${BUCKET}/${signed.path}`,
      sm: null,
      md: null,
      lg: null,
      alt: alt ?? null,
      uploadedAt: null,
      ready: false,
    };
    await this.listings.setPhotos(listingId, [...row.photos, entry]);

    return {
      photoId,
      bucket: BUCKET,
      path: signed.path,
      signedUrl: signed.signedUrl,
      token: signed.token,
    };
  }

  /**
   * Called once the client has finished uploading to the signed URL. Marks
   * the photo's uploadedAt timestamp and enqueues variant generation.
   */
  async commit(
    actorSupabaseId: string,
    listingId: string,
    photoId: string,
  ): Promise<ListingPhotoDto> {
    const row = await this.listings.getOwnedRowOrFail(actorSupabaseId, listingId);
    const idx = row.photos.findIndex((p) => p.id === photoId);
    if (idx < 0) throw new NotFoundException('Photo not found');
    const photo = row.photos[idx];
    const updatedPhoto: ListingPhotoDto = {
      ...photo,
      uploadedAt: new Date().toISOString(),
    };
    const next = [...row.photos];
    next[idx] = updatedPhoto;
    await this.listings.setPhotos(listingId, next);

    // Path inside the bucket (strip the `BUCKET/` prefix we stored).
    const originalPath = photo.url.startsWith(`${BUCKET}/`)
      ? photo.url.slice(BUCKET.length + 1)
      : photo.url;
    await this.imageQueue.add('process', {
      listingId,
      photoId,
      originalPath,
    });

    return updatedPhoto;
  }

  async delete(actorSupabaseId: string, listingId: string, photoId: string): Promise<void> {
    const row = await this.listings.getOwnedRowOrFail(actorSupabaseId, listingId);
    const photo = row.photos.find((p) => p.id === photoId);
    if (!photo) throw new NotFoundException('Photo not found');

    // Best-effort storage cleanup — variants might not exist yet.
    const paths = [photo.url, photo.sm, photo.md, photo.lg]
      .filter((p): p is string => Boolean(p))
      .map((p) => (p.startsWith(`${BUCKET}/`) ? p.slice(BUCKET.length + 1) : p));
    if (paths.length > 0) {
      try {
        await this.storage.delete(BUCKET, paths);
      } catch {
        // ignore — orphans get cleaned up out-of-band
      }
    }

    const next = row.photos.filter((p) => p.id !== photoId);
    await this.listings.setPhotos(listingId, next);
  }
}
