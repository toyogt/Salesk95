import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { fetchDistributorsForUser } from '../../services/access';
import {
  createOutlet,
  detectLocation,
  LAST_DISTRIBUTOR,
  loadInventory,
  loadNonBuyerOutletIds,
  loadOutlets,
  loadProducts,
  submitOrder,
} from '../../services/orders';
import {
  compareProductsByTypeThenName,
  generateOutletId,
  monthStartIso,
  titleCaseOutletName,
} from '../../lib/format';
import type {
  Distributor,
  NewOutletForm,
  OrderLineItem,
  Outlet,
  OutletMode,
  Product,
} from '../../types';

const defaultNewOutlet: NewOutletForm = {
  name: '',
  visitDay: 'Monday',
  type: 'HVO',
  location: '',
  contact: '',
  email: '',
  mapUrl: '',
  outletIdPreview: '',
};

export function useOrderForm() {
  const { user } = useAuth();
  const email = user?.email ?? '';

  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [distributorId, setDistributorId] = useState('');
  const [loadingDistributors, setLoadingDistributors] = useState(true);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<Record<string, { qty: number; reorder: number }>>({});

  const [outletMode, setOutletMode] = useState<OutletMode>('all');
  const [isNewOutlet, setIsNewOutlet] = useState(false);
  const [outletTypeFilter, setOutletTypeFilter] = useState('ALL');
  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [newOutlet, setNewOutlet] = useState<NewOutletForm>(defaultNewOutlet);

  const [productTypeFilter, setProductTypeFilter] = useState('all');
  const [orderItems, setOrderItems] = useState<Record<string, OrderLineItem>>({});
  const [comment, setComment] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState('Distributor');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(
    null
  );

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  }, []);

  const currentDistributor = useMemo(
    () => distributors.find((d) => d.distributor_id === distributorId),
    [distributors, distributorId]
  );

  useEffect(() => {
    if (!email) return;
    setLoadingDistributors(true);
    fetchDistributorsForUser(email)
      .then((list) => {
        setDistributors(list);
        const last = localStorage.getItem(LAST_DISTRIBUTOR);
        if (last && list.some((d) => d.distributor_id === last)) {
          setDistributorId(last);
        }
      })
      .catch((e: Error) => showToast(e.message, 'error'))
      .finally(() => setLoadingDistributors(false));
  }, [email, showToast]);

  const loadCatalog = useCallback(
    async (distId: string) => {
      setLoadingCatalog(true);
      try {
        const [o, p, inv] = await Promise.all([
          loadOutlets(distId),
          loadProducts(),
          loadInventory(distId),
        ]);
        setOutlets(o);
        setProducts(p);
        setInventory(inv);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Failed to load catalog', 'error');
      } finally {
        setLoadingCatalog(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (!distributorId) return;
    localStorage.setItem(LAST_DISTRIBUTOR, distributorId);
    loadCatalog(distributorId);
  }, [distributorId, loadCatalog]);

  const [nonBuyerIds, setNonBuyerIds] = useState<string[]>([]);
  useEffect(() => {
    if (!distributorId || outletMode !== 'nonbuyers') {
      setNonBuyerIds([]);
      return;
    }
    loadNonBuyerOutletIds(distributorId, monthStartIso())
      .then(setNonBuyerIds)
      .catch(() => setNonBuyerIds([]));
  }, [distributorId, outletMode]);

  const filteredOutlets = useMemo(() => {
    let list = [...outlets];
    if (outletMode === 'nonbuyers') {
      list = list.filter((o) => nonBuyerIds.includes(o.outlet_id));
    } else if (outletMode === 'beatplan') {
      const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });
      list = list.filter((o) => o.visit_day === day);
    }
    if (outletTypeFilter !== 'ALL') {
      list = list.filter((o) => (o.outlet_type || 'UNKNOWN') === outletTypeFilter);
    }
    return list.sort((a, b) => (a.outlet_name || '').localeCompare(b.outlet_name || ''));
  }, [outlets, outletMode, nonBuyerIds, outletTypeFilter]);

  const outletTypes = useMemo(() => {
    const base =
      outletMode === 'all'
        ? outlets
        : outletMode === 'nonbuyers'
          ? outlets.filter((o) => nonBuyerIds.includes(o.outlet_id))
          : outlets.filter(
              (o) => o.visit_day === new Date().toLocaleDateString('en-US', { weekday: 'long' })
            );
    return [...new Set(base.map((o) => o.outlet_type || 'UNKNOWN'))].sort();
  }, [outlets, outletMode, nonBuyerIds]);

  const productTypes = useMemo(() => {
    const types = [...new Set(products.map((p) => p.product_type || 'Other'))];
    return types.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [products]);

  const productGroups = useMemo(() => {
    const filtered =
      productTypeFilter === 'all'
        ? [...products]
        : products.filter((p) => (p.product_type || 'Other') === productTypeFilter);
    const sorted = filtered.sort(compareProductsByTypeThenName);

    if (productTypeFilter !== 'all') {
      return [{ type: productTypeFilter, products: sorted }];
    }

    const groups: { type: string; products: Product[] }[] = [];
    for (const product of sorted) {
      const type = product.product_type || 'Other';
      const last = groups[groups.length - 1];
      if (!last || last.type !== type) {
        groups.push({ type, products: [product] });
      } else {
        last.products.push(product);
      }
    }
    return groups;
  }, [products, productTypeFilter]);

  const lineItems = useMemo(() => Object.values(orderItems), [orderItems]);

  const sortedLineItems = useMemo(() => {
    const typeById = Object.fromEntries(
      products.map((p) => [p.product_id, p.product_type || 'Other'])
    );
    return [...lineItems].sort((a, b) => {
      const typeA = typeById[a.product_id]?.toLowerCase() ?? '';
      const typeB = typeById[b.product_id]?.toLowerCase() ?? '';
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      return a.product_name.localeCompare(b.product_name, undefined, { sensitivity: 'base' });
    });
  }, [lineItems, products]);

  const totalQty = useMemo(() => lineItems.reduce((s, i) => s + i.qty, 0), [lineItems]);
  const totalAmount = useMemo(
    () => lineItems.reduce((s, i) => s + i.qty * Number(i.rate), 0),
    [lineItems]
  );

  const changeDistributor = useCallback(
    (newId: string) => {
      if (newId === distributorId) return;
      const hasItems = Object.keys(orderItems).length > 0;
      if (newId && hasItems && !window.confirm('Change distributor? Line items in this order will be cleared.')) {
        return;
      }
      setDistributorId(newId);
      setSelectedOutletId('');
      setOrderItems({});
      setIsNewOutlet(false);
      setNewOutlet(defaultNewOutlet);
      setOutletTypeFilter('ALL');
      setOutletMode('all');
    },
    [distributorId, orderItems]
  );

  const updateNewOutletName = (name: string) => {
    const titled = titleCaseOutletName(name);
    setNewOutlet((prev) => ({
      ...prev,
      name: titled,
      outletIdPreview: generateOutletId(titled),
    }));
  };

  const setQty = (product: Product, qty: number) => {
    const safe = Math.max(0, Math.floor(qty) || 0);
    setOrderItems((prev) => {
      const next = { ...prev };
      if (safe === 0) {
        delete next[product.product_id];
      } else {
        next[product.product_id] = {
          product_id: product.product_id,
          product_name: product.product_name,
          qty: safe,
          rate: Number(product.case_rate) || 0,
        };
      }
      return next;
    });
  };

  const handleDetectLocation = async () => {
    try {
      const loc = await detectLocation();
      setNewOutlet((prev) => ({
        ...prev,
        location: loc.address,
        mapUrl: loc.mapUrl,
      }));
      showToast('Location detected', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Location detection failed', 'error');
    }
  };

  const clearForm = () => {
    setOrderItems({});
    setComment('');
    setNewOutlet(defaultNewOutlet);
    setSelectedOutletId('');
  };

  const handleSubmit = async () => {
    if (submitting || !currentDistributor || !email) return;

    let outletId = selectedOutletId;
    if (isNewOutlet) {
      if (!newOutlet.name.trim()) {
        showToast('Outlet name is required', 'error');
        return;
      }
      outletId =
        newOutlet.outletIdPreview ||
        `OUT${Date.now().toString().slice(-8)}-${Math.random().toString(36).substring(2, 4).toUpperCase()}`;
    } else if (!outletId || outletId === 'new') {
      showToast('Please select an outlet', 'error');
      return;
    }

    if (lineItems.length === 0) {
      showToast('Please add at least one product', 'error');
      return;
    }

    if (fulfillmentType === 'Distributor') {
      const overStock = lineItems.filter((item) => {
        const stock = inventory[item.product_id]?.qty ?? 0;
        return item.qty > stock;
      });
      if (overStock.length > 0) {
        const names = overStock.map((i) => i.product_name).join(', ');
        const ok = window.confirm(
          `These items exceed current stock: ${names}. Save as draft anyway?`
        );
        if (!ok) return;
      }
    }

    setSubmitting(true);
    try {
      if (isNewOutlet) {
        await createOutlet(currentDistributor.distributor_id, newOutlet, outletId);
        const refreshed = await loadOutlets(currentDistributor.distributor_id);
        setOutlets(refreshed);
        setIsNewOutlet(false);
        setSelectedOutletId(outletId);
      }

      const orderNumber = await submitOrder({
        email,
        distributorId: currentDistributor.distributor_id,
        outletId,
        comment,
        fulfillmentType,
        items: lineItems,
      });
      showToast(`Order ${orderNumber} saved as draft`, 'success');
      clearForm();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Submit failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedOutlet = outlets.find((o) => o.outlet_id === selectedOutletId);

  const catalogReady = Boolean(distributorId) && !loadingCatalog;

  return {
    email,
    distributors,
    distributorId,
    changeDistributor,
    currentDistributor,
    loadingDistributors,
    loadingCatalog,
    outletMode,
    setOutletMode,
    isNewOutlet,
    setIsNewOutlet,
    outletTypeFilter,
    setOutletTypeFilter,
    outletTypes,
    filteredOutlets,
    selectedOutletId,
    setSelectedOutletId,
    selectedOutlet,
    newOutlet,
    setNewOutlet,
    updateNewOutletName,
    productTypeFilter,
    setProductTypeFilter,
    productTypes,
    productGroups,
    catalogReady,
    inventory,
    orderItems,
    setQty,
    comment,
    setComment,
    fulfillmentType,
    setFulfillmentType,
    sortedLineItems,
    totalQty,
    totalAmount,
    submitting,
    handleSubmit,
    handleDetectLocation,
    clearForm,
    toast,
    clearToast: () => setToast(null),
  };
}
