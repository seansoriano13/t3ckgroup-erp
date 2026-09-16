import SorModal from "./modal/SorModal";

/**
 * Thin wrapper kept at this path so every existing call site (the register,
 * GlobalDetailManager, the Board) is unchanged — the real modal is `SorModal`
 * (#298), split into a header, one component per tab, and a chat column.
 */
export default function OpportunityDetailsModal({ isOpen, onClose, opportunity, siblingIds, onNavigate }) {
  return (
    <SorModal
      isOpen={isOpen}
      onClose={onClose}
      opportunity={opportunity}
      siblingIds={siblingIds}
      onNavigate={onNavigate}
    />
  );
}
