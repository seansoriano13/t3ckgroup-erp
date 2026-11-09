// The record's section bodies, one per section key, built from the page's
// state. Each is the existing section component, unchanged; the drawer frames
// it (see sectionChrome.js). `ctx` is what the page hands the record:
// { ipas, refreshing, can, rights, busy, on }.

import { IpasBankDetails } from "@/components/ipas/IpasBankDetails";
import { IpasDocuments } from "@/components/ipas/IpasDocuments";
import { IpasFilingSection } from "@/components/ipas/IpasFiling";
import { IpasLogisticsSection } from "@/components/ipas/IpasLogistics";
import { IpasChargesSection, IpasCostingSection, IpasPaymentsBlock } from "@/components/ipas/IpasMoneySections";
import {
  IpasHeaderSection,
  IpasHistorySection,
  IpasPurchasingSection,
  IpasSalesSection,
  IpasStatusSection,
} from "@/components/ipas/IpasSections";

import SignoffList from "./SignoffList";

export function buildBlocks(ctx) {
  const { ipas, can, on, rights } = ctx;

  const payments = (
    <IpasPaymentsBlock
      ipas={ipas}
      canChange={can.change}
      canRecord={can.record}
      onEditAmount={on.editAmount}
      onPickFreight={on.pickFreight}
      onAddPayment={on.addPayment}
      onEditPayment={on.editPayment}
      onRemovePayment={on.removePayment}
    />
  );

  const documents = (
    <IpasDocuments
      ipas={ipas}
      canChange={can.change}
      canTickFinance={can.tickFinance}
      onTick={on.tickDocument}
      onAttach={on.attach}
      onRemoveAttachment={on.removeAttachment}
      onAdd={on.addDocument}
      onSuggest={on.suggestDocuments}
      onRemove={on.removeDocument}
    />
  );

  const purchasing = (
    <IpasPurchasingSection ipas={ipas} refreshing={ctx.refreshing} canChange={can.change} onEditHeader={on.editHeader} />
  );
  const costing = (
    <IpasCostingSection
      ipas={ipas}
      canChange={can.change}
      onSetSplit={on.setSplit}
      canSetMarkup={can.markup}
      onSetMarkup={on.setMarkup}
    />
  );
  const charges = (
    <IpasChargesSection ipas={ipas} canRecord={can.record} onAddCharge={on.addCharge} onEditCharge={on.editCharge} onRemoveCharge={on.removeCharge} />
  );
  const sales = (
    <IpasSalesSection ipas={ipas} canChange={can.change} onEditOverride={on.editOverride} onResetOverride={on.resetOverride} />
  );
  const logistics = (
    <IpasLogisticsSection
      ipas={ipas}
      canChange={can.pickLocation ?? can.change}
      onPick={on.pickLocation}
    />
  );
  const status = (
    <IpasStatusSection
      ipas={ipas}
      canChange={can.change}
      onEditOrigin={on.editOrigin}
      onEditStatus={on.editStatus}
      onStamp={on.stamp}
      onClearStamp={on.clearStamp}
    />
  );

  return {
    // Kept for the edit view's typed bodies, which embed the read parts they don't type.
    filing: <IpasFilingSection ipas={ipas} rights={rights[7]} canSendBack={rights.sendBack7} />,
    // 1 · Order: what we bought, from whom, for which SOR.
    order: (
      <div className="space-y-6">
        {purchasing}
        {sales}
        <IpasHeaderSection ipas={ipas} canChange={can.change} onEditOverride={on.editOverride} onResetOverride={on.resetOverride} onEditHeader={on.editHeader} />
      </div>
    ),
    // 2 · Payments: what was paid, and to which account.
    payments: (
      <div className="space-y-6">
        {payments}
        <IpasBankDetails ipas={ipas} canChange={can.change} onEdit={on.editBank} />
      </div>
    ),
    // 3 · Costs: the charges on top of the price, and the Landed Cost they make.
    costs: (
      <div className="space-y-6">
        {charges}
        {costing}
      </div>
    ),
    // 4 · Delivery: where the goods are.
    delivery: (
      <div className="space-y-6">
        {logistics}
        {status}
      </div>
    ),
    // 5 · Documents: every file, in one list.
    documents,
    // 6 · Sign-offs: who signed the final IPAS.
    signoffs: (
      <SignoffList
        ctx={ctx}
        steps={[
          // Logistics is the first sign-off; it is a "get it ready" step on the rail and gates "Send for signing".
          ...(ctx.journey?.ready ?? []).filter((step) => step.key === "logistics"),
          ...(ctx.journey?.sign ?? []),
        ]}
      />
    ),
    history: <IpasHistorySection events={ipas.events} />,
  };
}
