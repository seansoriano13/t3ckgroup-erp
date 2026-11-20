/** React Query keys for the IPAS (#242). */
export const ipasListKey = ["ipas", "list"];
/**
 * Marks the IPAS list out of date without reading it again now (#928). The record is a
 * window over the list: a change made in it should not reload the whole list behind it,
 * which reads again once it is shown on its own.
 */
export const markIpasListStale = (queryClient) => queryClient.invalidateQueries({ queryKey: ipasListKey, refetchType: "none" });
export const ipasKey = (id) => ["ipas", "one", id];
/** Every open IPAS record, whatever its id (a setting changed under them, #959). */
export const ipasAllRecordsKey = ["ipas", "one"];
export const ipasRefreshKey = (id) => ["ipas", "refresh", id];
/** An IPAS's chat thread. */
export const ipasMessagesKey = (id) => ["ipas", "messages", id];
/** Everyone who can be mentioned in an IPAS chat. */
export const ipasChatPeopleKey = ["ipas", "chat-people"];
export const ipasSorSearchKey = (term) => ["ipas", "sor-search", term];
/** The caller's last five SORs named on an IPAS (#601). */
export const ipasRecentSorsKey = ["ipas", "recent-sors"];
export const ipasOptionsKey = (list) => ["ipas", "options", list];
/** The options a filed IPAS uses: those can't be renamed. */
export const ipasFiledOptionsKey = ["ipas", "filed-options"];
/** The two file switches (#959). */
export const ipasFileRulesKey = ["ipas", "file-rules"];
export const ipasSignerListsKey = ["ipas", "signer-lists"];
/** Who changed the sign-off lists (Super Admins). */
export const ipasSignerListLogKey = ["ipas", "signer-list-log"];
/** The IPAS awaiting one person's signature (the Approval Center queue and its badge). */
export const ipasPendingPrefix = ["ipas", "pending-signoffs"];
export const ipasPendingKey = (employeeId) => [...ipasPendingPrefix, employeeId];
/** The required documents nobody has ticked, read when the Approve (files the IPAS) dialog opens. */
export const ipasFilingWarningsKey = (id) => ["ipas", "filing-warnings", id];
/** The foreign payments whose pesos are still blank, read when the filing question opens (#1124). */
export const ipasWaitingPesosKey = (id) => ["ipas", "waiting-pesos", id];
/** An SOR's IPAS summaries (#249). */
export const ipasSorSummariesKey = (opportunityId) => ["ipas", "sor-summaries", opportunityId];
/** The number the next IPAS will take (#600). */
export const ipasNextNumberKey = ["ipas", "next-number"];
