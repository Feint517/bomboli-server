/**
 * All Supabase Storage buckets used by the API. Every bucket is private —
 * reads happen via signed URLs only. Never set `public: true`.
 */
export const BUCKETS = {
  AVATARS: 'avatars',
  LISTING_PHOTOS: 'listing-photos',
  SELLER_BANNERS: 'seller-banners',
  CHAT_ATTACHMENTS: 'chat-attachments',
  VERIFICATIONS: 'verifications',
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export const ALL_BUCKETS: readonly BucketName[] = Object.values(BUCKETS);
