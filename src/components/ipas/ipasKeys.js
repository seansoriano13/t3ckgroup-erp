/** React Query keys for the IPAS (#242). */
export const ipasListKey = ["ipas", "list"];
export const ipasKey = (id) => ["ipas", "one", id];
export const ipasRefreshKey = (id) => ["ipas", "refresh", id];
export const ipasSorSearchKey = (term) => ["ipas", "sor-search", term];
export const ipasOptionsKey = (list) => ["ipas", "options", list];
export const ipasSignerListsKey = ["ipas", "signer-lists"];
/** The IPAS awaiting one person's signature (the Approval Center queue and its badge). */
export const ipasPendingPrefix = ["ipas", "pending-signoffs"];
export const ipasPendingKey = (employeeId) => [...ipasPendingPrefix, employeeId];
