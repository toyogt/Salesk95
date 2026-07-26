export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function titleCaseOutletName(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function generateOutletId(name: string): string {
  const clean = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return '';
  return `${clean.slice(0, 6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

import type { Product } from '../types';

/** Sort by product type, then product name (case-insensitive). */
export function compareProductsByTypeThenName(a: Product, b: Product): number {
  const typeA = (a.product_type || 'Other').toLowerCase();
  const typeB = (b.product_type || 'Other').toLowerCase();
  if (typeA !== typeB) return typeA.localeCompare(typeB);
  return (a.product_name || '').localeCompare(b.product_name || '', undefined, { sensitivity: 'base' });
}

export function monthStartIso(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}
