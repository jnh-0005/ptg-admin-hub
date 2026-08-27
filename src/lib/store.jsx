import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as data from "./data";
import { deriveAll, DEFAULT_SETTINGS } from "./calc";
import { buildStorefrontIndex } from "./storefront";

const StoreContext = createContext(null);

const EMPTY = {
  settings: { ...DEFAULT_SETTINGS },
  products: [],
  freebies: [],
  batches: [],
  batchItems: [],
  batchConsumables: [],
  orders: [],
  orderItems: [],
  orderFreebies: [],
  payments: [],
  variants: [],
  movements: [],
  tracking: [],
  storefrontPhotos: [],
};

export function StoreProvider({ children }) {
  const [state, setState] = useState(EMPTY);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await data.loadAll();
      if (alive.current) {
        setState(next);
        setStatus("ready");
        setError(null);
      }
      return next;
    } catch (e) {
      if (!alive.current) return null;
      setError(e?.message || "Could not reach the database");
      setStatus("error");
      throw e;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  /** Every write goes through commit, so a reload always follows a change. */
  const commit = useCallback(
    async (fn) => {
      setBusy(true);
      try {
        const result = await fn(data);
        await refresh();
        return result;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [refresh],
  );

  const derived = useMemo(() => deriveAll({ ...state, variants: state.variants }), [state]);

  /**
   * The photo lookup the desk previews with. Built from the SAME helper the
   * public shop uses, and it indexes approved live rows only — so what the
   * admin says a customer is getting is what the customer actually gets.
   */
  const storefrontIndex = useMemo(
    () => buildStorefrontIndex(state.storefrontPhotos),
    [state.storefrontPhotos],
  );

  const productsById = useMemo(() => {
    const map = new Map();
    for (const p of state.products) map.set(p.id, p);
    return map;
  }, [state.products]);

  const variantsByProduct = useMemo(() => {
    const map = new Map();
    for (const v of state.variants) {
      if (!map.has(v.inventory_id)) map.set(v.inventory_id, []);
      map.get(v.inventory_id).push(v);
    }
    return map;
  }, [state.variants]);

  const ordersById = useMemo(() => {
    const map = new Map();
    for (const o of state.orders) map.set(o.id, o);
    return map;
  }, [state.orders]);

  const freebiesById = useMemo(() => {
    const map = new Map();
    for (const f of state.freebies) map.set(f.id, f);
    return map;
  }, [state.freebies]);

  /** Every tracking event for one order, oldest first: it reads as a timeline. */
  const trackingByOrder = useMemo(() => {
    const map = new Map();
    for (const t of state.tracking) {
      if (!map.has(t.order_id)) map.set(t.order_id, []);
      map.get(t.order_id).push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const d = String(a.event_date || "").localeCompare(String(b.event_date || ""));
        return d !== 0 ? d : a.id - b.id;
      });
    }
    return map;
  }, [state.tracking]);

  const value = useMemo(
    () => ({
      ...state,
      status,
      error,
      busy,
      refresh,
      commit,
      derived,
      productsById,
      ordersById,
      freebiesById,
      trackingByOrder,
      storefrontIndex,
      db: data,
    }),
    [
      state,
      status,
      error,
      busy,
      refresh,
      commit,
      derived,
      productsById,
      ordersById,
      freebiesById,
      trackingByOrder,
      storefrontIndex,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
