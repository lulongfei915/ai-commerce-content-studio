import type { Product } from '../products/api';
import { photoPreviewUrl } from '../products/preview';

export function BoundPhotos({ product }: { product: Product }) {
  return (
    <div className="photo-list" aria-label="已绑定商品实拍">
      {product.photos.map((photo, index) => (
        <img
          key={photo.file_id}
          loading="lazy"
          src={photoPreviewUrl(product.id, photo.file_id)}
          alt={`${product.name}实拍 ${index + 1}`}
        />
      ))}
    </div>
  );
}
