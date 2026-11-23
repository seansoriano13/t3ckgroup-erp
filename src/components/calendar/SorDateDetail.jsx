import { Link } from 'react-router';
import { SlideOverBody } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection } from '@/components/ui/DetailParts';
import { buttonVariants } from '@/components/ui/button';
import { formatEntryDate } from './entryFormat.js';

/** An SOR date on the Calendar (#1197): which SOR, which date, and a link that opens the SOR. */
export default function SorDateDetail({ entry }) {
  const d = entry.details ?? {};
  return (
    <SlideOverBody>
      <DetailSection title="SOR date">
        <dl>
          <DetailRow label="Date">{formatEntryDate(entry)}</DetailRow>
          {d.field_label && <DetailRow label="What">{d.field_label}</DetailRow>}
          <DetailRow label="SOR">{d.sales_reference || entry.title}</DetailRow>
        </dl>
      </DetailSection>
      {d.opportunity_id && (
        <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} to={`/sors?open=sor:${d.opportunity_id}`}>
          Open SOR
        </Link>
      )}
    </SlideOverBody>
  );
}
