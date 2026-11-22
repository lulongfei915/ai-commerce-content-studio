import { apiFetch } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';

type Schema = components['schemas'];
export type Product = Schema['ProductResponse'];
export type ProductInput = Schema['ProductCreate'];
export type Category = Schema['CategoryFields'];
export type Facts = Product['facts'];

export function productCategories(signal: AbortSignal) {
  return apiFetch<Category[]>('/products/categories', { signal });
}

export function listProducts(
  query: string,
  cursor: string | null,
  signal: AbortSignal,
  category?: string,
) {
  const params = new URLSearchParams({ q: query });
  if (cursor) params.set('cursor', cursor);
  if (category) params.set('category', category);
  return apiFetch<Schema['ProductList']>(`/products?${params}`, { signal });
}

export function createProduct(input: ProductInput, token: string) {
  return apiFetch<Product>('/products', {
    method: 'POST',
    headers: { 'X-CSRF-Token': token },
    body: JSON.stringify(input),
  });
}

export function updateFacts(id: string, input: Schema['FactsUpdate'], token: string) {
  return apiFetch<Product>(`/products/${encodeURIComponent(id)}/facts`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': token },
    body: JSON.stringify(input),
  });
}

export async function uploadPhoto(file: File, token: string): Promise<string> {
  const headers = { 'X-CSRF-Token': token };
  const upload = await apiFetch<Schema['UploadReservation']>('/files/uploads', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    }),
  });
  const response = await fetch(upload.upload_path, {
    method: 'PUT',
    credentials: 'same-origin',
    body: file,
    headers: { ...headers, 'Content-Type': file.type },
  });
  if (!response.ok) throw new Error('实拍上传失败，请重新选择有效图片。');
  const ready = await apiFetch<Schema['MediaFile']>(
    `/files/${encodeURIComponent(upload.id)}/complete`,
    {
      method: 'POST',
      headers,
    },
  );
  return ready.id;
}
