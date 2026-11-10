// The IPAS as one road with two stretches, for the rail:
//   1. Get it ready   the work: files, Landed Cost final, Item Location, Transmittal, Logistics
//   2. Sign it        once everything is ready, the signers read the final IPAS form and sign it
// Every item says who does it, by name, and whether it is the viewer's.
// Pure: built from the IPAS, its digest and the signer lists.

import {
  IPAS_COMPUTATION_STATUS,
  IPAS_LANDED_COST_REASON,
  IPAS_SIGNER_LIST,
  IPAS_SOURCE,
} from "@/constants/ipas";
import { TRANSMITTAL_STAFF_LIST } from "@/constants/transmittals";

const LIST_NAME = {
  [IPAS_SIGNER_LIST.S1_APPROVED]: "Order approvers",
  [IPAS_SIGNER_LIST.S3_APPROVED]: "Payments approvers",
  [IPAS_SIGNER_LIST.S6_APPROVED]: "Costs approvers",
  [IPAS_SIGNER_LIST.S7_RECEIVED]: "Received",
  [IPAS_SIGNER_LIST.S7_NOTED]: "Noted",
  [IPAS_SIGNER_LIST.S7_CHECKED]: "Checked",
  [IPAS_SIGNER_LIST.S7_APPROVED]: "Filing approvers",
  [IPAS_SIGNER_LIST.LOGISTICS_SIGNED]: "Logistics",
};

/** Sections 1, 2 and 3 as stored (1, 3 and 6), each with the list that approves it. */
const SIGN_SECTIONS = [
  [1, IPAS_SIGNER_LIST.S1_APPROVED],
  [3, IPAS_SIGNER_LIST.S3_APPROVED],
  [6, IPAS_SIGNER_LIST.S6_APPROVED],
];
const CHECK_LISTS = [IPAS_SIGNER_LIST.S7_RECEIVED, IPAS_SIGNER_LIST.S7_NOTED, IPAS_SIGNER_LIST.S7_CHECKED];

const orList = (names) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`);
const andList = (items) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

export function journeyFor({ ipas, digest, lists, userId, can }) {
  const members = (keys) => {
    const seen = new Map();
    for (const key of keys) for (const m of lists?.[key] ?? []) if (m.name) seen.set(m.employeeId, m.name);
    return seen;
  };
  const onList = (keys) => Boolean(userId) && members(keys).has(userId);
  /** "Ana or Ben", or, for an empty list, who has to fix that. */
  const who = (keys) => {
    const names = [...members(keys).values()];
    if (names.length > 0) return { names: orList(names), empty: false };
    return {
      names: `Nobody is on the ${andList(keys.map((key) => LIST_NAME[key] ?? key))} list yet. A Super Admin adds someone in IPAS settings.`,
      empty: true,
    };
  };
  const buyer = { names: ipas.creator?.name ? `${ipas.creator.name} (Purchasing)` : "Purchasing", empty: false };

  const { s1, s3, s6, s7, s8 } = digest;
  const signoffs = { 1: s1, 3: s3, 6: s6 };
  const missing = digest.docs?.missingByPart ?? {};
  const rawFiles = [...(missing.purchasing ?? []), ...(missing.finance ?? []), ...(missing.costing ?? []), ...(missing.filing ?? [])];
  // The same name twice (two payments on one day) reads as a typo: say it once, with a count.
  const files = [...new Set(rawFiles)].map((label) => {
    const n = rawFiles.filter((other) => other === label).length;
    return n > 1 ? `${label} (×${n})` : label;
  });
  // Proof of payment is Finance's (#937); the other files are Purchasing's to attach.
  const isProof = (label) => label.startsWith("Proof of payment");
  const proofs = files.filter(isProof);
  const otherFiles = files.filter((label) => !isProof(label));
  const finance = { names: "Finance", empty: false };
  // A foreign-currency payment with no Forex Rate Paid (a PHP PO has no rate to fill).
  const foreignPo = Boolean(ipas.currency) && String(ipas.currency).toUpperCase() !== "PHP";
  const noRate = foreignPo ? (ipas.payments ?? []).filter((payment) => payment.forex_rate === null || payment.forex_rate === undefined).length : 0;
  // Logistics signed means what it needed was in when it was signed: those items stay ticked.
  const logisticsSigned = Boolean(s8?.approved);
  const located = logisticsSigned || Boolean(ipas.itemLocation || ipas.item_location_id);
  const carried = logisticsSigned || (ipas.slips ?? []).length > 0;
  const isImport = ipas.source === IPAS_SOURCE.IMPORT;
  const arrived = logisticsSigned || !isImport || Boolean(ipas.arrived_in_whs_on);
  const logisticsReady = located && carried && arrived;

  // Why Landed Cost has no figure, and where to fix it.
  const lcReason = ipas.landedCost?.reason;
  const noFigure =
    lcReason === IPAS_LANDED_COST_REASON.NO_REFERENCE_RATE
      ? { line: "A payment has no Forex Rate Paid yet. Type it in 2 · Payments.", section: "payments", label: "Type rate in 2 · Payments" }
      : lcReason === IPAS_LANDED_COST_REASON.FREIGHT_CURRENCY
        ? { line: "The freight is in a currency that can't be converted. Enter it in pesos or the PO's currency.", section: "costs", label: "Fix freight in 3 · Costs" }
        : lcReason === IPAS_LANDED_COST_REASON.NO_PAYMENTS
          ? { line: "A foreign-currency PO needs a payment first.", section: "payments", label: "Add payment in 2 · Payments" }
          : { line: "Landed Cost has no figure yet.", section: null, label: null };

  // A charge with no amount stops section 2's sign-off in the database: it is fixed (or removed) before signing.
  const blankCharges = (ipas.charges ?? []).filter((charge) => charge.amount_php === null || charge.amount_php === undefined).length;
  // …and a charge with an amount needs its file (the database checks both when signing).
  const chargesNoFile = (ipas.charges ?? []).filter((charge) => charge.amount_php !== null && charge.amount_php !== undefined && !charge.attachment_url).length;
  const chargeProblems = [
    blankCharges > 0 && `${blankCharges} ${blankCharges === 1 ? "charge has" : "charges have"} no amount (fill in or remove)`,
    chargesNoFile > 0 && `${chargesNoFile} ${chargesNoFile === 1 ? "charge has" : "charges have"} no file`,
  ].filter(Boolean);

  // ── 1. Get it ready ────────────────────────────────────────────────────
  const ready = [
    {
      key: "files",
      label: "Attach the files",
      done: otherFiles.length === 0,
      line: otherFiles.length === 0 ? "Every required file is attached." : `Still missing: ${otherFiles.join(", ")}.`,
      who: buyer,
      action: can.change && otherFiles.length > 0 ? { kind: "edit", section: "documents", label: "Attach in 5 · Documents" } : null,
    },
    {
      key: "charges",
      label: "Record payments and charges",
      done: chargeProblems.length === 0,
      line: chargeProblems.length === 0 ? "Every charge has an amount and a file." : `${chargeProblems.join("; ")}.`,
      who: finance,
      action: can.record && chargeProblems.length > 0 ? { kind: "edit", section: "costs", label: "Fill in 3 · Costs" } : null,
    },
    {
      key: "proof",
      label: "Attach proof of payment",
      done: proofs.length === 0,
      line: proofs.length === 0 ? "Every payment has its proof." : `Still missing: ${proofs.join(", ")}.`,
      who: finance,
      action: can.record && proofs.length > 0 ? { kind: "edit", section: "payments", label: "Attach proof in 2 · Payments" } : null,
    },
    {
      key: "forex",
      label: "Fill the Forex Rate Paid",
      done: noRate === 0,
      line: noRate === 0 ? "Every payment has its rate." : `${noRate} ${noRate === 1 ? "payment has" : "payments have"} no Forex Rate Paid yet.`,
      who: finance,
      action: can.record && noRate > 0 ? { kind: "edit", section: "payments", label: "Type rate in 2 · Payments" } : null,
    },
    {
      key: "landed",
      label: "Mark Landed Cost final",
      done: Boolean(digest.costsComplete),
      line: digest.costsComplete
        ? `Final at ${digest.money.landedFigureText}.`
        : digest.landedUnavailable
          ? noFigure.line
          : `Now ${digest.money.landedText}. Check 3 · Costs, then mark it final.`,
      who: buyer,
      action: !(can.change || can.record) || digest.costsComplete
        ? null
        : digest.landedUnavailable
          ? (noFigure.section ? { kind: "edit", section: noFigure.section, label: noFigure.label } : null)
          : can.change
            ? { kind: "landed", label: "Mark Landed Cost final", status: IPAS_COMPUTATION_STATUS.LC_ODOO_DONE }
            : null,
    },
    {
      key: "location",
      label: "Pick the Item Location",
      done: located,
      line: located ? (ipas.itemLocation?.label ?? "Set.") : "Where the goods are kept.",
      who: buyer,
      action: can.pickLocation && !located ? { kind: "edit", section: "delivery", label: "Pick it in 4 · Delivery" } : null,
    },
    {
      key: "transmittal",
      label: "Raise a Transmittal",
      done: carried,
      line: carried ? ((ipas.slips ?? []).map((slip) => slip.number).join(", ") || "Done.") :"Logistics can only be signed once a Transmittal carries this IPAS.",
      who: who([TRANSMITTAL_STAFF_LIST.LOGISTICS, TRANSMITTAL_STAFF_LIST.WAREHOUSE]).empty
        ? buyer
        : { names: `${buyer.names}, ${who([TRANSMITTAL_STAFF_LIST.LOGISTICS, TRANSMITTAL_STAFF_LIST.WAREHOUSE]).names}`, empty: false },
      action: !carried && (can.purchasing || onList([TRANSMITTAL_STAFF_LIST.LOGISTICS, TRANSMITTAL_STAFF_LIST.WAREHOUSE]))
        ? { kind: "link", to: `/purchasing/transmittals/new?ipas=${encodeURIComponent(ipas.number ?? "")}`, label: "Raise a Transmittal" }
        : null,
    },
    isImport && {
      key: "arrived",
      label: "Type the warehouse arrival date",
      done: arrived,
      line: arrived ? "Typed." : "The day the goods reached the warehouse.",
      who: buyer,
      action: can.change && !arrived ? { kind: "edit", section: "delivery", label: "Type it in 4 · Delivery" } : null,
    },
    {
      key: "logistics",
      label: "Sign Logistics",
      done: Boolean(s8?.approved),
      line: s8?.approved
        ? `Signed by ${s8.approved.signedBy?.name ?? "someone"}.`
        : logisticsReady
          ? "The goods are at their location: sign it."
          : `Opens once the ${andList([!located && "Item Location", !carried && "Transmittal", !arrived && "arrival date"].filter(Boolean))} ${[!located, !carried, !arrived].filter(Boolean).length > 1 ? "are" : "is"} in.`,
      who: who([IPAS_SIGNER_LIST.LOGISTICS_SIGNED]),
      action: !s8?.approved && logisticsReady && onList([IPAS_SIGNER_LIST.LOGISTICS_SIGNED])
        ? { kind: "logistics", label: "Review and sign", confirm: "Sign Logistics", what: "the goods are signed as delivered" }
        : null,
    },
  ].filter(Boolean);
  const readyDone = ready.every((item) => item.done);

  // ── 2. Sign the final IPAS ─────────────────────────────────────────────
  const toPrepare = SIGN_SECTIONS.filter(([section]) => !signoffs[section]?.prepared && !signoffs[section]?.approved);
  const sent = toPrepare.length === 0;
  const toApprove = SIGN_SECTIONS.filter(([section]) => !signoffs[section]?.approved);
  const approved = toApprove.length === 0;
  const myApprovals = toApprove.filter(
    ([section, list]) =>
      signoffs[section]?.prepared && onList([list]) && signoffs[section].prepared.signedBy?.id !== userId,
  );
  const preparer = SIGN_SECTIONS.map(([section]) => signoffs[section]?.prepared?.signedBy).find(Boolean);
  const checked = Boolean(s7.received && s7.noted && s7.checked);
  const filed = Boolean(s7.approved) || digest.filed;
  const approverWho = who(toApprove.length > 0 ? toApprove.map(([, list]) => list) : SIGN_SECTIONS.map(([, list]) => list));

  const sign = [
    {
      key: "send",
      label: "Send for signing",
      done: sent,
      line: sent
        ? `Sent by ${preparer?.name ?? "Purchasing"}.`
        : "Read the final IPAS form, then send it to the approvers.",
      who: buyer,
      action: readyDone && !sent && can.purchasing
        ? {
            kind: "sign",
            label: "Review and send",
            confirm: "Send for signing",
            what: "the approvers are told it is ready",
            steps: toPrepare.map(([section]) => ({ section, role: "prepared" })),
          }
        : null,
    },
    {
      key: "approve",
      label: "Approve",
      done: approved,
      line: approved
        ? "Approved."
        : preparer && toApprove.every(([section]) => signoffs[section]?.prepared) && myApprovals.length === 0 && onList(toApprove.map(([, list]) => list))
          ? `${preparer.name} sent it, so someone else on the list approves it.`
          : "Approves the whole IPAS in one go.",
      // Section 1 vouches for the payment: the supplier bill check's warning is said here (#603). It warns, never blocks.
      warning: approved ? null : (digest.bill?.warning ?? null),
      who: approverWho,
      action: readyDone && sent && myApprovals.length > 0
        ? {
            kind: "sign",
            label: "Review and approve",
            confirm: "Approve",
            what: myApprovals.length < toApprove.length
              ? "you approve the sections on your list; the rest wait for their approvers"
              : "it goes to the Check",
            steps: myApprovals.map(([section]) => ({ section, role: "approved" })),
          }
        : null,
    },
    {
      key: "check",
      label: "Check",
      done: checked,
      line: checked
        ? `Checked by ${s7.checked?.signedBy?.name ?? "someone"}.`
        : "Received, Noted and Checked in one sign-off.",
      who: who(CHECK_LISTS),
      action: readyDone && approved && !checked && onList(CHECK_LISTS)
        ? { kind: "check", label: "Review and check", confirm: "Check", what: "it goes to the filing approver" }
        : null,
    },
    {
      key: "file",
      label: "Approve and file",
      done: filed,
      line: filed ? `Filed by ${s7.approved?.signedBy?.name ?? "someone"}.` : "Files the IPAS. It can't be changed after that.",
      who: who([IPAS_SIGNER_LIST.S7_APPROVED]),
      action: readyDone && checked && !filed && onList([IPAS_SIGNER_LIST.S7_APPROVED])
        ? { kind: "file", label: "Review and file", confirm: "Approve and file", what: "the IPAS is filed and frozen" }
        : null,
    },
  ];

  const now = readyDone ? sign.find((step) => !step.done) ?? null : null;
  const mine = [...ready, ...sign].filter((item) => item.action);

  let headline;
  if (digest.filed) headline = "Filed. Nothing left to do.";
  else if (digest.cancelled) headline = "Cancelled. Nothing to do.";
  else if (mine.length > 0) headline = `Your turn: ${mine[0].label}.`;
  else if (!readyDone) {
    const open = ready.find((item) => !item.done);
    headline = `Getting it ready. Waiting on ${open.who.empty ? "a signer list" : open.who.names}: ${open.label}.`;
  } else if (now) headline = now.who.empty ? `Stuck: ${now.who.names}` : `Waiting on ${now.who.names}: ${now.label}.`;
  else headline = "Nothing left to do.";

  return { ready, readyDone, sign, now, mine, headline };
}

/** Whether an action is a sign-off: the rail only points to it, the row in 6 · Sign-offs signs it. */
export const isSignAction = (action) => ["sign", "check", "file", "logistics"].includes(action?.kind);

/**
 * The section that needs the viewer, which opens on arrival: where the rail's first
 * item of theirs leads (a sign-off lives in 6 · Sign-offs). Null when nothing waits on them.
 */
export function actionSectionFor(journey) {
  const action = journey?.mine?.[0]?.action;
  if (!action) return null;
  if (isSignAction(action)) return "signoffs";
  if (action.kind === "landed") return "costs";
  return action.section ?? null;
}
