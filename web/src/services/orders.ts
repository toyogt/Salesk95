import { supabase } from '../lib/supabase';
import type { NewOutletForm, OrderLineItem, Outlet, Product } from '../types';

const CACHE_OUTLETS = 'k95_outlets_';
const CACHE_PRODUCTS = 'k95_products';
const CACHE_INVENTORY = 'k95_inventory_';
const LAST_DISTRIBUTOR = 'k95_last_distributor';

export { CACHE_OUTLETS, CACHE_PRODUCTS, CACHE_INVENTORY, LAST_DISTRIBUTOR };

export async function loadOutlets(distributorId: string): Promise<Outlet[]> {
  const { getCachedOrFetch } = await import('../lib/cache');
  return getCachedOrFetch(
    CACHE_OUTLETS + distributorId,
    async () => {
      const { data, error } = await supabase
        .from('outlets')
        .select('*')
        .eq('distributor_id', distributorId)
        .eq('status', 'Active');
      if (error) throw error;
      return (data ?? []).sort((a, b) =>
        (a.outlet_name || '').localeCompare(b.outlet_name || '')
      ) as Outlet[];
    },
    60_000
  );
}

export async function loadProducts(): Promise<Product[]> {
  const { getCachedOrFetch } = await import('../lib/cache');
  return getCachedOrFetch(
    CACHE_PRODUCTS,
    async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'Active');
      if (error) throw error;
      return (data ?? []).sort((a, b) =>
        (a.product_name || '').localeCompare(b.product_name || '')
      ) as Product[];
    },
    60_000
  );
}

export async function loadInventory(
  distributorId: string
): Promise<Record<string, { qty: number; reorder: number }>> {
  const { getCachedOrFetch } = await import('../lib/cache');
  const rows = await getCachedOrFetch(
    CACHE_INVENTORY + distributorId,
    async () => {
      const { data, error } = await supabase
        .from('distributor_inventory')
        .select('product_id, quantity_on_hand, reorder_level')
        .eq('distributor_id', distributorId);
      if (error) throw error;
      return data ?? [];
    },
    60_000
  );

  const map: Record<string, { qty: number; reorder: number }> = {};
  for (const row of rows) {
    map[row.product_id] = {
      qty: row.quantity_on_hand ?? 0,
      reorder: row.reorder_level ?? 5,
    };
  }
  return map;
}

export async function loadNonBuyerOutletIds(
  distributorId: string,
  reportMonth: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('non_buyers')
    .select('outlet_id')
    .eq('report_month', reportMonth)
    .eq('distributor_id', distributorId);
  if (error) throw error;
  return (data ?? []).map((r) => r.outlet_id);
}

export async function createOutlet(
  distributorId: string,
  form: NewOutletForm,
  outletId: string
): Promise<void> {
  const { error } = await supabase.from('outlets').insert({
    outlet_id: outletId,
    outlet_name: form.name,
    distributor_id: distributorId,
    outlet_type: form.type,
    status: 'Active',
    visit_day: form.visitDay,
    location: form.location || null,
    Contact: form.contact || null,
    'Email ID': form.email || null,
    location_url: form.mapUrl || null,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
  localStorage.removeItem(CACHE_OUTLETS + distributorId);
}

export async function resolveUserId(
  email: string,
  fallbackDistributorId: string
): Promise<string> {
  const { data } = await supabase
    .from('users')
    .select('employee_id')
    .eq('email_id', email)
    .maybeSingle();
  return data?.employee_id ?? fallbackDistributorId;
}

export async function submitOrder(params: {
  email: string;
  distributorId: string;
  outletId: string;
  comment: string;
  fulfillmentType: string;
  items: OrderLineItem[];
}): Promise<string> {
  const userId = await resolveUserId(params.email, params.distributorId);
  const orderNumber = `ORD-${Date.now()}`;
  const itemsJson = params.items.map((i) => ({
    product_id: i.product_id,
    product_name: i.product_name,
    qty: i.qty,
    rate: i.rate,
  }));

  const { data: orders, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_number: orderNumber,
      user_id: userId,
      distributor_id: params.distributorId,
      outlet_id: params.outletId,
      comment: params.comment || null,
      fulfillment_type: params.fulfillmentType,
      order_status: 'Draft',
      created_by_email: params.email,
      items: itemsJson,
    })
    .select('id');

  if (orderError) throw orderError;
  const orderId = orders?.[0]?.id;
  if (!orderId) throw new Error('Order was not created');
  for (const item of params.items) {
    const { error } = await supabase.from('order_items').insert({
      order_id: orderId,
      product_id: item.product_id,
      qty: item.qty,
      rate: item.rate,
    });
    if (error) throw error;
  }

  return orderNumber;
}

export async function detectLocation(): Promise<{
  latitude: number;
  longitude: number;
  address: string;
  mapUrl: string;
}> {
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
    });
  });

  const { latitude, longitude } = position.coords;
  const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  let address = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
    );
    if (res.ok) {
      const data = await res.json();
      const parts: string[] = [];
      if (data.locality) parts.push(data.locality);
      if (data.city) parts.push(data.city);
      else if (data.town) parts.push(data.town);
      if (data.principalSubdivision) parts.push(data.principalSubdivision);
      if (data.countryName) parts.push(data.countryName);
      if (parts.length) address = parts.join(', ');
    }
  } catch {
    /* use coordinates */
  }

  return { latitude, longitude, address, mapUrl };
}
