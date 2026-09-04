import { useEffect, useState } from "react";
import { useParams, Navigate, Link } from "react-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import Spinner from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, SearchX, AlertTriangle, ArrowRight, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

function getStatusConfig(status) {
  switch (status?.toUpperCase()) {
    case "APPROVED":
    case "APPROVED_PAID":
    case "APPROVED_OFFSET":
      return { color: "bg-emerald-500/10 text-emerald-600", icon: CheckCircle2, label: status };
    case "REJECTED":
    case "CANCELLED":
      return { color: "bg-red-500/10 text-red-600", icon: XCircle, label: status };
    case "PENDING":
    default:
      return { color: "bg-amber-500/10 text-amber-600", icon: Clock, label: status || "PENDING" };
  }
}

export default function VerifyPage() {
  const { token } = useParams();
  const { user, isAuthLoading } = useAuth();
  
  const [data, setData] = useState(null);
  const [fullRecord, setFullRecord] = useState(null);
  const [fullRecordError, setFullRecordError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hashStatus, setHashStatus] = useState({
    applicationValid: null, // true, false, null
    approvalValid: null,    // true, false, null
  });

  useEffect(() => {
    async function fetchRecord() {
      if (!token || isAuthLoading) return;

      setLoading(true);
      setError(null);

      try {
        let record = null;

        // Fetch the limited public record using RPC. verify_form_token now
        // computes both hash comparisons itself and returns two booleans —
        // the client never sees reason, attachments, or the raw hash inputs
        // that a boolean-only response is meant to keep it from recomputing.
        const { data: rpcData, error: fetchError } = await supabase.rpc("verify_form_token", { lookup_token: token });

        if (fetchError) {
          if (fetchError.message?.includes("Rate limit")) {
            setError("rate_limited");
          } else {
            setError("not_found");
          }
        } else if (!rpcData) {
          setError("not_found");
        } else {
          record = rpcData;
          setData(record);
          setHashStatus({
            applicationValid: record.application_valid ?? null,
            approvalValid: record.approval_valid ?? null,
          });
        }

        // Try to fetch the full record if authenticated. RLS (offset_leaves_select
        // / sil_leaves_select / overtime_requests_select) scopes this to the
        // record's own employee, HR, or a Super Admin — an unrelated employee's
        // query simply returns no row. The embeds name their FK constraint
        // explicitly since sil_leaves has two FKs to employees (employee_id,
        // hr_processed_by), which an unqualified embed can't disambiguate.
        if (user && record) {
          let table = "sil_leaves";
          let employeeFkey = "sil_leaves_employee_id_fkey";
          let hrFkey = "sil_leaves_hr_processed_by_fkey";
          if (record.form_type === "Offset") {
            table = "offset_leaves";
            employeeFkey = "offset_leaves_employee_id_fkey";
            hrFkey = "offset_leaves_hr_processed_by_fkey";
          }
          if (record.form_type === "Overtime") {
            table = "overtime_requests";
            employeeFkey = "overtime_requests_employee_id_fkey";
            hrFkey = "overtime_requests_hr_processed_by_fkey";
          }

          const { data: foundFull, error: fullErr } = await supabase
            .from(table)
            .select(`*, hr_leave_categories(label), employees!${employeeFkey}(name), hr:employees!${hrFkey}(name)`)
            .eq("verification_token", token)
            .maybeSingle();

          if (fullErr) {
            console.error("Verification full-record fetch error:", fullErr);
            setFullRecordError(fullErr.message || "Could not load the full record.");
          } else if (foundFull) {
            setFullRecord({
              ...foundFull,
              form_type: record.form_type,
              employee_name: record.employee_name,
              category: record.category,
              total_hours: record.total_hours,
            });
          }
        }
      } catch (err) {
        console.error("Verification error:", err);
        setError("not_found");
      } finally {
        setLoading(false);
      }
    }

    fetchRecord();
  }, [token, user, isAuthLoading]);

  if (isAuthLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mauve-2 p-4">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Spinner size="lg" />
          <p className="text-sm font-bold uppercase tracking-widest animate-pulse">Verifying Record...</p>
        </div>
      </div>
    );
  }

  if (error === "rate_limited") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mauve-2 p-4">
        <Card className="max-w-md w-full shadow-lg border-amber-200 bg-amber-50/50">
          <CardContent className="pt-10 pb-8 px-6 flex flex-col items-center text-center">
            <div className="h-16 w-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-6">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-bold text-amber-900 mb-2">Too Many Requests</h2>
            <p className="text-amber-700/80 mb-6">
              You have exceeded the maximum number of verification attempts. Please try again in a minute.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-mauve-2 p-4">
        <Card className="max-w-md w-full shadow-lg border-border">
          <CardContent className="pt-10 pb-8 px-6 flex flex-col items-center text-center">
            <div className="h-16 w-16 bg-mauve-3 text-muted-foreground rounded-full flex items-center justify-center mb-6">
              <SearchX className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Record Not Found</h2>
            <p className="text-muted-foreground mb-6">
              The verification token is invalid, rotated, or does not exist.
            </p>
            {!user && (
              <Button asChild variant="outline">
                <Link to="/login">Sign In to Portal</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderSignatureBadges = () => {
    if (hashStatus.applicationValid === null) return null; // No hash info

    const isTampered = hashStatus.applicationValid === false || hashStatus.approvalValid === false;

    if (isTampered) {
      const which = hashStatus.applicationValid === false && hashStatus.approvalValid === false
        ? "the employee signature and the HR approval"
        : hashStatus.applicationValid === false
          ? "the employee signature"
          : "the HR approval";
      return (
        <div className="flex items-center gap-2 mt-4 bg-red-50 text-red-700 p-3 rounded-md border border-red-200">
          <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Signature Validation Failed: {which}</p>
            <p className="opacity-90">This record has been modified after it was signed.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2 mt-4">
        {hashStatus.applicationValid && (
          <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 p-2.5 rounded-md border border-emerald-200">
            <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <span className="text-sm font-medium">Valid Employee Signature Match</span>
          </div>
        )}
        {hashStatus.approvalValid && (
          <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 p-2.5 rounded-md border border-emerald-200">
            <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            <span className="text-sm font-medium">Valid HR Approval Signature Match</span>
          </div>
        )}
      </div>
    );
  };

  // Display Full Record (Authenticated and authorized)
  if (fullRecord) {
    const StatusIcon = getStatusConfig(fullRecord.status).icon;
    return (
      <div className="min-h-screen flex items-center justify-center bg-mauve-2 p-4 md:p-8">
        <Card className="max-w-2xl w-full shadow-xl border-border overflow-hidden">
          <div className="bg-primary/5 p-6 border-b border-border flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-1">
                {fullRecord.form_type} Record
              </h1>
              <p className="text-muted-foreground">Internal Verified View</p>
            </div>
            <Badge className={`${getStatusConfig(fullRecord.status).color} border-0 text-sm py-1 px-3 flex items-center gap-1.5`}>
              <StatusIcon className="h-4 w-4" />
              {fullRecord.status}
            </Badge>
          </div>
          
          <CardContent className="p-0">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Employee</h3>
                  <p className="text-lg font-medium text-foreground">{fullRecord.employee_name}</p>
                </div>
                
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Category</h3>
                  <p className="text-foreground">{fullRecord.category}</p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Inclusive Dates</h3>
                  <p className="text-foreground">{new Date(fullRecord.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{fullRecord.total_hours} hours total</p>
                </div>
                
                {renderSignatureBadges()}
              </div>

              <div className="p-6 space-y-6 bg-mauve-1/50">
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Reason (Confidential)</h3>
                  <div className="bg-background rounded-md p-3 text-sm text-foreground border border-border">
                    {fullRecord.reason || <span className="text-muted-foreground italic">No reason provided</span>}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Approval Info</h3>
                  <p className="text-foreground">{fullRecord.status !== 'PENDING' ? 'Processed' : 'Pending Review'}</p>
                  {fullRecord.hr_notes && (
                    <div className="mt-2 p-2 bg-blue-50/50 border border-blue-100 rounded text-sm text-blue-900">
                      <strong>HR Note:</strong> {fullRecord.hr_notes}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
          <div className="p-4 bg-mauve-2 border-t border-border flex justify-end">
             <Button asChild variant="default">
               <Link to="/">Go to Dashboard <ArrowRight className="ml-2 h-4 w-4"/></Link>
             </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Display Limited Public Record
  const StatusIcon = getStatusConfig(data.status).icon;
  return (
    <div className="min-h-screen flex items-center justify-center bg-mauve-2 p-4">
      <Card className="max-w-md w-full shadow-lg border-border">
        <div className="bg-white p-6 border-b border-border flex flex-col items-center text-center">
          <div className="h-12 w-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-1">Verified Record</h1>
          <p className="text-sm text-muted-foreground">This printed form matches our system</p>
        </div>
        
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <span className="text-muted-foreground font-medium">Status</span>
            <Badge className={`${getStatusConfig(data.status).color} border-0 flex items-center gap-1.5`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {data.status}
            </Badge>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Employee</span>
              <span className="font-medium text-right text-foreground">{data.employee_name}</span>
            </div>
            
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Form Type</span>
              <span className="font-medium text-right text-foreground">{data.form_type} ({data.category})</span>
            </div>

            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Dates</span>
              <span className="font-medium text-right text-foreground">{data.inclusive_dates}</span>
            </div>

            <div className="flex justify-between items-start">
              <span className="text-muted-foreground text-sm">Total Hours</span>
              <span className="font-medium text-right text-foreground">{data.total_hours} hrs</span>
            </div>
          </div>
          
          {renderSignatureBadges()}

          {user && fullRecordError && (
            <div className="flex items-center gap-2 bg-amber-50 text-amber-700 p-2.5 rounded-md border border-amber-200 text-sm">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>Couldn't load your authenticated view of this record: {fullRecordError}</span>
            </div>
          )}

          {data.status !== 'PENDING' && (
            <div className="bg-mauve-2 rounded-lg p-4 mt-6 border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 font-semibold">Approval Details</p>
              <div className="space-y-1">
                <p className="text-sm text-foreground">By: <span className="font-medium">{data.approver_name}</span></p>
                <p className="text-sm text-foreground">On: <span className="font-medium">{data.approval_date}</span></p>
              </div>
            </div>
          )}
          
          <div className="pt-2 text-center">
             {!user ? (
                <Link to="/login" className="text-xs text-muted-foreground hover:text-primary hover:underline transition-colors">
                  T3CK Group Employee Login
                </Link>
             ) : (
                <Link to="/" className="text-xs text-muted-foreground hover:text-primary hover:underline transition-colors">
                  Go to Portal
                </Link>
             )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
