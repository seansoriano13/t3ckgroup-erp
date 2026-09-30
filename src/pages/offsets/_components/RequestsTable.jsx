import { Link } from 'react-router';
import { Trash2, ShieldCheck } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import StatusBadge from '../../../components/StatusBadge';
import { Button } from '@/components/ui/button';
import { AttachmentList } from '../../../components/ui/Attachments';
import { formatWindow } from '../../../utils/time';
import { deriveRequestStage } from '../../../utils/requestStage';
import { getRequestStageTheme } from '../../../constants/status';
import { REQUEST_TYPE_BADGE } from './requestTypes';

/**
 * Every request an employee filed, one row each, with the stage it has
 * reached (issue #158, #160). Split from My Requests so Release Notes can
 * show the same table filled with Sample Data (ADR 0030).
 */
export default function RequestsTable({ rows, onWithdraw }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card animate-in fade-in duration-300">
      <Table className="whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>Applied On</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Hours</TableHead>
            <TableHead>Files</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((req) => {
            const stage = deriveRequestStage(req);
            return (
              <TableRow key={req.type + '-' + req.id}>
                <TableCell className="text-xs text-muted-foreground font-medium">
                  {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </TableCell>
                <TableCell>
                  <span className={`font-black uppercase tracking-wider px-2 py-0.5 rounded text-[10px] border ${REQUEST_TYPE_BADGE[req.type].badgeClass}`}>
                    {REQUEST_TYPE_BADGE[req.type].label}
                  </span>
                </TableCell>
                <TableCell className="text-sm font-bold text-foreground">
                  {req.dayCount > 1 ? (
                    <>
                      {new Date(req.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' – '}
                      {new Date(req.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      <span className="ml-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {req.dayCount} days
                      </span>
                    </>
                  ) : (
                    new Date(req.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-sm text-foreground">
                      {(req.type === 'OVERTIME' || req.type === 'OFFSET') && req.approved_hours != null && req.approved_hours !== req.hours ? (
                        <>
                          <span className="line-through text-muted-foreground mr-1.5">{req.hours}</span>
                          {req.approved_hours} hrs
                        </>
                      ) : (
                        `${req.hours} hrs`
                      )}
                    </span>
                    {req.start_time && req.end_time && (
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {formatWindow(req.start_time, req.end_time)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {req.attachments?.length ? (
                    <AttachmentList attachments={req.attachments} compact />
                  ) : (
                    <span className="text-xs text-muted-foreground/50">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge theme={getRequestStageTheme(stage.tone)} label={stage.label} />
                </TableCell>
                <TableCell className="text-xs font-semibold text-muted-foreground truncate max-w-[200px]" title={stage.note || ''}>
                  {stage.note || '-'}
                </TableCell>
                <TableCell className="text-right flex items-center justify-end gap-2">
                  {req.verification_token && (
                    <Link
                      to={`/verify/${req.verification_token}`}
                      target="_blank"
                      className="p-2 text-primary/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors cursor-pointer"
                      title="View Verified Form"
                    >
                      <ShieldCheck size={18} />
                    </Link>
                  )}
                  {req.status === 'PENDING' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onWithdraw(req)}
                      className="bg-destructive/10 hover:bg-destructive/20 text-destructive border border-transparent hover:border-destructive/20"
                      title="Withdraw Request"
                      aria-label="Withdraw Request"
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
