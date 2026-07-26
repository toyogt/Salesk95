import { supabase } from '../lib/supabase';
import type { AccessRecord, Distributor } from '../types';

export async function fetchAccess(email: string): Promise<AccessRecord | null> {
  const { data, error } = await supabase
    .from('access_manager')
    .select('role_name, distributor_ids, tile_permissions')
    .eq('user_email', email)
    .maybeSingle();

  if (error) throw error;
  return data as AccessRecord | null;
}

export async function fetchDistributorsForUser(email: string): Promise<Distributor[]> {
  const access = await fetchAccess(email);
  if (!access) throw new Error('No access record found for this account.');

  const perm = access.tile_permissions?.order_form?.access;
  if (perm === 'none') throw new Error('You do not have access to the Order Form.');

  const role = access.role_name || 'user';
  let query = supabase
    .from('distributors')
    .select('distributor_id, distributor_name')
    .eq('status', 'Active')
    .order('distributor_name');

  if (role !== 'admin' && role !== 'nsm') {
    const ids = access.distributor_ids || [];
    if (ids.length === 0) throw new Error('No distributors assigned to your account.');
    query = query.in('distributor_id', ids);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) throw new Error('No active distributors available.');
  return data as Distributor[];
}
