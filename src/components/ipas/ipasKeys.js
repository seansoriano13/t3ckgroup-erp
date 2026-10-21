/** React Query keys for the IPAS (#242). */
export const ipasListKey = ["ipas", "list"];
export const ipasKey = (id) => ["ipas", "one", id];
export const ipasRefreshKey = (id) => ["ipas", "refresh", id];
export const ipasSorSearchKey = (term) => ["ipas", "sor-search", term];
/** The caller's last five SORs named on an IPAS (#601). */
export const ipasRecentSorsKey = ["ipas", "recent-sors"];
export const ipasOptionsKey = (list) => ["ipas", "options", list];
/** The options a filed IPAS uses: those can't be renamed. */
export const ipasFiledOptionsKey = ["ipas", "filed-options"];
export const ipasSignerListsKey = ["ipas", "signer-lists"];
/** Who changed the sign-off lists (Super Admins). */
export const ipasSignerListLogKey = ["ipas", "signer-list-log"];
/** The IPAS awaiting one person's signature (the Approval Center queue and its badge). */
export const ipasPendingPrefix = ["ipas", "pending-signoffs"];
export const ipasPendingKey = (employeeId) => [...ipasPendingPrefix, employeeId];
/** The required documents nobody has ticked, read when the Approve (files the IPAS) dialog opens. */
export const ipasFilingWarningsKey = (id) => ["ipas", "filing-warnings", id];
/** An SOR's IPAS summaries (#249). */
export const ipasSorSummariesKey = (opportunityId) => ["ipas", "sor-summaries", opportunityId];
