/** React Query keys for the IPAS (#242). */
export const ipasListKey = ["ipas", "list"];
export const ipasKey = (id) => ["ipas", "one", id];
export const ipasRefreshKey = (id) => ["ipas", "refresh", id];
export const ipasSorSearchKey = (term) => ["ipas", "sor-search", term];
export const ipasOptionsKey = (list) => ["ipas", "options", list];
