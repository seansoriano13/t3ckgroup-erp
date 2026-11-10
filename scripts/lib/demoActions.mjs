/**
 * Pure helpers for scripts/demo-purchasing-setup.mjs (#896). They change the
 * Stage Actions of the demo's copy of the Project flow before it is written to
 * staging, so the demo never carries an action that cannot run.
 *
 * Kept apart from the script so the rules can be unit tested without a database.
 */

/**
 * Literal labels a Stage Action title can carry in production (the DELCOM title
 * was typed as "DELCOM - (Sales Order Number) - (Agency Name) - (Bidder Company)"),
 * mapped to the template token each one stands for. Anything else is left as it is.
 */
export const DEMO_TITLE_FIXES = [
  ["(Sales Order Number)", "{{so_number}}"],
  ["(Agency Name)", "{{company}}"],
  ["(Bidder Company)", "{{project_title}}"],
]

function actionLabel(action) {
  const config = action?.config ?? {}
  const named = config.title || config.titleTemplate || config.projectTitle
  return typeof named === "string" && named.trim() ? named.trim() : action?.kind ?? "Stage Action"
}

function fixTitle(text) {
  let next = text
  for (const [from, to] of DEMO_TITLE_FIXES) next = next.split(from).join(to)
  return next
}

/**
 * Prepares the Stage Actions of a demo copy. Mutates `actions` in place.
 *
 *   - A Group Task member whose employee id is not in `knownIds` is dropped
 *     (listed in `droppedMembers`). Staging does not have that person, so the
 *     action would fail when the demo runs it.
 *   - An action left with no members at all throws. Dropping its last member
 *     would make the app assign the task to whoever moves the SOR, which is not
 *     what the flow says. The rehearsal stops instead.
 *   - Titles with a literal label from DEMO_TITLE_FIXES get the matching token
 *     (listed in `retitled`).
 *
 * @param {Array<{ kind: string, config?: object }>} actions
 * @param {Set<string>} knownIds ids that exist on the target database
 * @returns {{ droppedMembers: Array<{ action: string, employeeId: string }>, retitled: Array<{ action: string, from: string, to: string }> }}
 */
export function prepareDemoActions(actions, knownIds) {
  const droppedMembers = []
  const retitled = []

  for (const action of actions ?? []) {
    const config = action?.config
    if (!config) continue

    if (action.kind === "create_group_task" && Array.isArray(config.members)) {
      const label = actionLabel(action)
      const kept = config.members.filter((m) => {
        const employeeId = m?.employeeId
        if (!employeeId || knownIds.has(employeeId)) return true
        droppedMembers.push({ action: label, employeeId })
        return false
      })
      if (kept.length === 0 && config.members.length > 0) {
        throw new Error(`"${label}" has no member left on staging. Give it a member on staging, then run again.`)
      }
      config.members = kept
    }

    for (const key of ["title", "titleTemplate"]) {
      const current = config[key]
      if (typeof current !== "string") continue
      const next = fixTitle(current)
      if (next !== current) {
        retitled.push({ action: actionLabel(action), from: current, to: next })
        config[key] = next
      }
    }
  }

  return { droppedMembers, retitled }
}

// Who sits on each list after a reset. IPAS s1 = section 1, s3 = section 2, s6 = section 3,
// s7_* = section 4. The Markup list is 201 (101 is a Super Admin); Final Acquire is kept only
// because it is the list that may unlock a Go.
export const DEMO_LISTS = {
  ipas_signer_lists: {
    s1_approved: ["101"], s3_approved: ["101"], s6_approved: ["jelai"],
    s7_received: ["grace"], s7_noted: ["101"], s7_checked: ["201"], s7_approved: ["201"],
    logistics_signed: ["aldrin"],
    transmittal_warehouse: ["aldrin"], transmittal_technical: ["sherwin"], transmittal_logistics: ["aldrin"],
    transmittal_check_by: ["jen", "grace"],
  },
  costing_signer_lists: {
    // RRD/IOE team lists are retired (#908): Sherwin (Technical sub-department) is picked as
    // the Technical in-charge on each S0 Evaluation instead.
    // The Evaluation list approves an S0 Evaluation from the Technical page. Grace does it in the run sheet; 201 and 101
    // are on it too so the General Manager and the Super Admin can (a Super Admin approves only when on the list).
    markup: ["201"], final_acquire: ["201"], evaluation: ["grace", "201", "101"],
  },
}
