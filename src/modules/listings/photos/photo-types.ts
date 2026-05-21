/**
 * Job payload for the `image-processing` queue. The producer (photo commit
 * endpoint) enqueues; the worker resizes the original into sm/md/lg variants
 * and patches the listing.photos array.
 */
export interface ImageProcessingJob {
  listingId: string;
  photoId: string;
  /** Full path including bucket prefix? No — just the bucket-relative path. */
  originalPath: string;
}

export const VARIANT_SIZES = [
  { suffix: 'sm', width: 400 },
  { suffix: 'md', width: 800 },
  { suffix: 'lg', width: 1600 },
] as const;

export type VariantSuffix = (typeof VARIANT_SIZES)[number]['suffix'];
