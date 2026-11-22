import { apiPrefix } from '../../shared/api/client';

export function photoPreviewUrl(productId: string, fileId: string): string {
  return `${apiPrefix}/products/${encodeURIComponent(productId)}/photos/${encodeURIComponent(fileId)}/preview`;
}
