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
import { IpasSignoffs } from "@/components/ipas/IpasSignoffs";

export function buildBlocks(ctx) {
  const { ipas, can, on, rights } = ctx;

  const signoffs = (section) => (
    <IpasSignoffs section={section} state={ipas.signoffSections[section]} rights={rights[section]} />
  );

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

  return {
    // Parts the long edit form places itself (#581): the sign-offs of sections 1, 2 and 3 (stored 1, 3 and 6).
    // The money is typed there.
    signoffs1: signoffs(1),
    signoffs3: signoffs(3),
    signoffs6: signoffs(6),
    header: (
      <IpasHeaderSection ipas={ipas} canChange={can.change} onEditOverride={on.editOverride} onResetOverride={on.resetOverride} onEditHeader={on.editHeader} />
    ),
    purchasing: (
      <IpasPurchasingSection ipas={ipas} refreshing={ctx.refreshing} canChange={can.change} onEditHeader={on.editHeader}>
        {payments}
        {signoffs(1)}
      </IpasPurchasingSection>
    ),
    finance: (
      <IpasChargesSection
        ipas={ipas}
        canRecord={can.record}
        onAddCharge={on.addCharge}
        onEditCharge={on.editCharge}
        onRemoveCharge={on.removeCharge}
      >
        {documents}
        <IpasBankDetails ipas={ipas} canChange={can.change} onEdit={on.editBank} />
        {signoffs(3)}
      </IpasChargesSection>
    ),
    costing: (
      <IpasCostingSection
        ipas={ipas}
        canChange={can.change}
        canSetStatus={can.setStatus}
        onSetStatus={on.setComputationStatus}
        onSetSplit={on.setSplit}
        canSetMarkup={can.markup}
        onSetMarkup={on.setMarkup}
      >
        {signoffs(6)}
      </IpasCostingSection>
    ),
    filing: (
      <IpasFilingSection ipas={ipas} rights={rights[7]} canSendBack={rights.sendBack7} />
    ),
    sales: (
      <IpasSalesSection
        ipas={ipas}
        canChange={can.change}
        onEditOverride={on.editOverride}
        onResetOverride={on.resetOverride}
        onTick={on.tickSheet}
      />
    ),
    logistics: (
      <IpasLogisticsSection
        ipas={ipas}
        canChange={can.change}
        onPick={on.pickLocation}
        signRights={rights[8]}
        busy={ctx.busy?.signoff}
        onSign={() => on.approve(8, "logistics")}
      />
    ),
    status: (
      <IpasStatusSection
        ipas={ipas}
        canChange={can.change}
        onEditOrigin={on.editOrigin}
        onEditStatus={on.editStatus}
        onStamp={on.stamp}
        onClearStamp={on.clearStamp}
      />
    ),
    history: <IpasHistorySection events={ipas.events} />,
  };
}
