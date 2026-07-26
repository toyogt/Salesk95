export type OutletMode = 'all' | 'nonbuyers' | 'beatplan';

export interface Distributor {
  distributor_id: string;
  distributor_name: string;
}

export interface Outlet {
  outlet_id: string;
  outlet_name: string | null;
  distributor_id: string | null;
  outlet_type: string | null;
  status: string | null;
  visit_day: string | null;
  location: string | null;
  Contact: number | null;
  'Email ID': string | null;
  location_url: string | null;
}

export interface Product {
  product_id: string;
  product_name: string;
  product_type: string | null;
  case_rate: number | null;
  pack_size: string | null;
  status: string | null;
}

export interface OrderLineItem {
  product_id: string;
  product_name: string;
  qty: number;
  rate: number;
}

export interface AccessRecord {
  role_name: string;
  distributor_ids: string[] | null;
  tile_permissions?: {
    order_form?: { access?: string };
  };
}

export interface NewOutletForm {
  name: string;
  visitDay: string;
  type: string;
  location: string;
  contact: string;
  email: string;
  mapUrl: string;
  outletIdPreview: string;
}
