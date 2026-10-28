import MarkupPresetsSection from "./MarkupPresetsSection";
import RatesSection from "./RatesSection";
import SignerListsSection from "./SignerListsSection";
import EvaluationSection from "./EvaluationSection";
import CostGuideSection from "./CostGuideSection";
import { COSTING_SIGNER_LIST } from "../../../constants/costing";

/**
 * The Costing Matrix tab of Settings (#269, #270, spec #266). It is only a list of standalone sections,
 * each one a component that loads and saves its own data and says who sees it, so a ticket adds its
 * section as one entry below without touching the others:
 *
 *   Markup presets      Super Admins, Purchasing access (told they are not theirs to edit) and the
 *                       Final Acquire list (#269)
 *   Rates               Finance access and Super Admins (#270); Finance access alone sees only this
 *   Final Acquire list  Super Admins (#270)
 *   Evaluation          Super Admins (#271): the task template and the evaluation list
 *   Cost guide          Super Admins (#723): each cost category's low and high % of the Final Offer
 *
 * The Settings page offers the tab to anyone who sees at least one section; the database refuses the
 * write of everyone it is not meant for. `managesMarkup` is the Final Acquire list's membership, asked of
 * the database by the page.
 */
const SECTIONS = [
  {
    key: "markup-presets",
    show: ({ isSuperAdmin, hasPurchasingAccess, managesMarkup }) => isSuperAdmin || hasPurchasingAccess || managesMarkup,
    render: () => <MarkupPresetsSection />,
  },
  {
    key: "rates",
    show: ({ isSuperAdmin, hasFinanceAccess }) => isSuperAdmin || hasFinanceAccess,
    render: () => <RatesSection canEdit />,
  },
  {
    key: "final-acquire-list",
    show: ({ isSuperAdmin }) => isSuperAdmin,
    render: () => (
      <SignerListsSection
        listKey={COSTING_SIGNER_LIST.FINAL_ACQUIRE}
        canEdit
        description="Writes Final Acquire and the markup factor, and reads the summary and the margin. A Super Admin is not on it unless added here. Changing the list never changes figures already typed."
      />
    ),
  },
  {
    key: "markup-list",
    show: ({ isSuperAdmin }) => isSuperAdmin,
    render: () => (
      <SignerListsSection
        listKey={COSTING_SIGNER_LIST.MARKUP}
        canEdit
        description="Changes the default multiplier and any row's multiplier. Nobody else can; the database refuses them. Starts with 101 and 201."
      />
    ),
  },
  ...[COSTING_SIGNER_LIST.TEAM_RRD, COSTING_SIGNER_LIST.TEAM_IOE].map((listKey) => ({
    key: listKey,
    show: ({ isSuperAdmin }) => isSuperAdmin,
    render: () => (
      <SignerListsSection
        listKey={listKey}
        canEdit
        description="Marks Complies or Deviates on the rows set to this team, and reads the matrix without money. Nobody else can mark those rows."
      />
    ),
  })),
  {
    key: "evaluation",
    show: ({ isSuperAdmin }) => isSuperAdmin,
    render: () => <EvaluationSection />,
  },
  {
    key: "cost-guide",
    show: ({ isSuperAdmin }) => isSuperAdmin,
    render: () => <CostGuideSection />,
  },
];

export default function CostingMatrixSettings({ isSuperAdmin = false, hasFinanceAccess = false, hasPurchasingAccess = false, managesMarkup = false }) {
  const access = { isSuperAdmin, hasFinanceAccess, hasPurchasingAccess, managesMarkup };
  return (
    <div className="space-y-8" data-testid="costing-matrix-settings">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Costing Matrix</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">The markup presets, the rates behind the summary, the people who set Final Acquire, and how the evaluation of specification is run.</p>
      </div>
      {SECTIONS.filter((section) => section.show(access)).map(({ key, render }) => (
        <div key={key}>{render()}</div>
      ))}
    </div>
  );
}
