import type { Category, Product } from './api';

export const specificationKey = 'specification';
export const specificationLabel = '颜色 / 规格等已知信息';

export function factLabel(key: string, category?: Category) {
  return key === specificationKey
    ? specificationLabel
    : (category?.fields.find((field) => field.key === key)?.label ?? key);
}

export function specificationText(product?: Product, category?: Category) {
  if (!product) return '';
  return (
    product.facts[specificationKey]?.value ??
    Object.entries(product.facts)
      .map(([key, fact]) => `${factLabel(key, category)}：${fact.value}`)
      .join('\n')
  );
}
