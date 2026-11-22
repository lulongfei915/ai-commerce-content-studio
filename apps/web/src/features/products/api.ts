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

export { uploadMedia as uploadPhoto } from '../../shared/api/upload';
