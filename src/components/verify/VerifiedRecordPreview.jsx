import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import PageLoading from "@/components/ui/PageLoading";
import { CheckCircle2, XCircle, Clock, SearchX, AlertTriangle, ArrowRight, ShieldCheck, ShieldAlert } from "lucide-react";

function getStatusConfig(status) {
  switch (status?.toUpperCase()) {
    case "APPROVED":
    case "APPROVED_PAID":
    case "APPROVED_OFFSET":
      return { color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle2, label: status };
    case "REJECTED":
    case "CANCELLED":
      return { color: "text-red-700 bg-red-50 border-red-200", icon: XCircle, label: status };
    case "PENDING":
    default:
      return { color: "text-amber-700 bg-amber-50 border-amber-200", icon: Clock, label: status || "PENDING" };
  }
}

/** Same wording the printed TG-11 uses for how a record is treated. */
function treatedAsLabel(formType, category) {
  if (formType === "Offset") return "Offset";
  if (formType === "LWOP") return "Leave Without Pay (LWOP)";
  if (formType === "Leave") return "Leave With Pay (LWP)";
  return category;
}

export default function VerifiedRecordPreview({ token, standalone = false }) {
  const { user, isAuthLoading } = useAuth();
  
  const [data, setData] = useState(null);
  const [fullRecord, setFullRecord] = useState(null);
  const [fullRecordError, setFullRecordError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hashStatus, setHashStatus] = useState({
    applicationValid: null,
    approvalValid: null,
  });

  useEffect(() => {
    async function fetchRecord() {
      if (!token || isAuthLoading) return;

      setLoading(true);
      setError(null);

      try {
        let record = null;
        const { data: rpcData, error: fetchError } = await supabase.rpc("verify_form_token", { lookup_token: token });

        if (fetchError) {
          setError("not_found");
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

        if (user && record) {
          let table = "sil_leaves";
          let employeeFkey = "sil_leaves_employee_id_fkey";
          let hrFkey = "sil_leaves_hr_processed_by_fkey";
          if (record.form_type === "Offset") {
            table = "offset_leaves";
            employeeFkey = "offset_leaves_employee_id_fkey";
            hrFkey = "offset_leaves_hr_processed_by_fkey";
          }
          if (record.form_type === "LWOP") {
            table = "lwop_leaves";
            employeeFkey = "lwop_leaves_employee_id_fkey";
            hrFkey = "lwop_leaves_hr_processed_by_fkey";
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
      <div className={`flex items-center justify-center p-8 ${standalone ? 'min-h-screen bg-[#F7F7F5]' : 'min-h-[400px]'}`}>
        <PageLoading label="record" className="py-0 text-[#37352F]" />
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className={`flex items-center justify-center p-4 ${standalone ? 'min-h-screen bg-[#F7F7F5]' : ''}`}>
        <div role="alert" className="max-w-md w-full border border-[#E9E9E7] bg-white rounded-md p-8 text-center text-[#37352F] shadow-sm">
          <SearchX className="h-8 w-8 text-[#9B9A97] mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Record Not Found</h2>
          <p className="text-sm opacity-80 mb-6">
            The verification token is invalid, rotated, or does not exist.
          </p>
          {standalone && !user && (
            <Link to="/login" className="inline-flex items-center justify-center px-4 py-2 border border-[#E9E9E7] rounded-md text-sm font-medium hover:bg-[#F1F1EF] transition-colors">
              Sign In to Portal
            </Link>
          )}
        </div>
      </div>
    );
  }

  const renderSignatureBadges = () => {
    if (hashStatus.applicationValid === null) return null;

    const isTampered = hashStatus.applicationValid === false || hashStatus.approvalValid === false;

    if (isTampered) {
      // User requested to bypass tamper error if approved by HR
      if (data?.status && data.status.startsWith('APPROVED')) {
        return (
          <div className="flex flex-col gap-2 mt-4">
            <div className="flex items-center gap-2 bg-[#F3FBF4] text-[#0F7B42] p-2.5 rounded-md border border-[#E1F3E5]">
              <ShieldCheck className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm font-medium">Record Validated (HR Approved)</span>
            </div>
          </div>
        );
      }

      const which = hashStatus.applicationValid === false && hashStatus.approvalValid === false
        ? "the employee signature and the HR approval"
        : hashStatus.applicationValid === false
          ? "the employee signature"
          : "the HR approval";
      return (
        <div className="flex items-start gap-3 mt-4 bg-[#FFF4F4] text-[#E03E3E] p-3 rounded-md border border-[#FDEBEC]">
          <ShieldAlert className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Signature Validation Failed: {which}</p>
            <p className="opacity-90 mt-0.5">This record has been modified after it was signed.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2 mt-4">
        {hashStatus.applicationValid && (
          <div className="flex items-center gap-2 bg-[#F3FBF4] text-[#0F7B42] p-2.5 rounded-md border border-[#E1F3E5]">
            <ShieldCheck className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">Valid Employee Signature Match</span>
          </div>
        )}
        {hashStatus.approvalValid && (
          <div className="flex items-center gap-2 bg-[#F3FBF4] text-[#0F7B42] p-2.5 rounded-md border border-[#E1F3E5]">
            <ShieldCheck className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">Valid HR Approval Signature Match</span>
          </div>
        )}
      </div>
    );
  };

  const StatusIcon = getStatusConfig(data.status).icon;
  const statusColor = getStatusConfig(data.status).color;

  const DetailRow = ({ label, value }) => (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 py-2 border-b border-[#F1F1EF] last:border-0">
      <span className="text-[#787774] text-sm w-32 flex-shrink-0 font-medium">{label}</span>
      <span className="text-[#37352F] text-sm font-medium">{value}</span>
    </div>
  );

  const containerClass = standalone
    ? "min-h-screen flex items-center justify-center bg-[#F7F7F5] p-4 md:p-8 font-sans"
    : "w-full h-full font-sans max-h-[80vh] overflow-y-auto";

  const cardClass = standalone
    ? "max-w-2xl w-full bg-white border border-[#E9E9E7] rounded-md shadow-sm overflow-hidden"
    : "w-full bg-white rounded-md";

  if (fullRecord) {
    return (
      <div className={containerClass}>
        <div className={cardClass}>
          <div className="p-6 md:p-8">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
              <div>
                <h1 className="text-3xl font-bold text-[#37352F] tracking-tight mb-2">
                  {fullRecord.form_type} Record
                </h1>
                <p className="text-sm text-[#787774]">Internal Verified View</p>
              </div>
              <div className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md border ${statusColor}`}>
                <StatusIcon className="h-3.5 w-3.5" />
                {fullRecord.status}
              </div>
            </div>
            
            <div className="space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-[#37352F] border-b border-[#E9E9E7] pb-2 mb-4">Details</h2>
                <div className="space-y-1">
                  <DetailRow label="Employee" value={fullRecord.employee_name} />
                  <DetailRow label="Treated as" value={treatedAsLabel(fullRecord.form_type, fullRecord.category)} />
                  <DetailRow label="Inclusive Dates" value={new Date(fullRecord.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
                  <DetailRow label="Total Hours" value={`${fullRecord.total_hours} hrs`} />
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-[#37352F] border-b border-[#E9E9E7] pb-2 mb-4">Signatures</h2>
                {renderSignatureBadges()}
              </div>

              <div>
                <h2 className="text-lg font-semibold text-[#37352F] border-b border-[#E9E9E7] pb-2 mb-4">Remarks & Info</h2>
                <div className="bg-[#F7F7F5] rounded-md p-4 text-sm text-[#37352F] whitespace-pre-wrap">
                  {fullRecord.reason || <span className="text-[#9B9A97] italic">No reason provided</span>}
                </div>
                
                {fullRecord.hr_notes && (
                  <div className="mt-4 p-4 border-l-2 border-[#37352F] bg-[#F7F7F5] text-sm text-[#37352F]">
                    <span className="font-bold mr-2">HR Note:</span>
                    {fullRecord.hr_notes}
                  </div>
                )}
                <div className="mt-4 text-sm text-[#787774]">
                  Approval Status: {fullRecord.status !== 'PENDING' ? 'Processed' : 'Pending Review'}
                </div>
              </div>
            </div>
          </div>
          {standalone && (
            <div className="p-4 border-t border-[#E9E9E7] bg-[#F7F7F5] flex justify-end">
              <Link 
                to="/" 
                className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary-hover transition-colors"
              >
                Go to Dashboard <ArrowRight className="ml-2 h-4 w-4"/>
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Display Limited Public Record
  return (
    <div className={containerClass}>
      <div className={cardClass}>
        <div className="p-6 md:p-8">
          <div className="flex flex-col items-center text-center mb-8">
            <CheckCircle2 className="h-10 w-10 text-[#0F7B42] mb-4" />
            <h1 className="text-2xl font-bold text-[#37352F] tracking-tight mb-2">Verified Record</h1>
            <p className="text-sm text-[#787774]">This printed form matches our system</p>
          </div>
          
          <div className="max-w-md mx-auto space-y-8">
            <div className="flex items-center justify-between border-b border-[#E9E9E7] pb-2">
              <span className="text-[#787774] text-sm font-medium">Status</span>
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-md border ${statusColor}`}>
                <StatusIcon className="h-3 w-3" />
                {data.status}
              </div>
            </div>

            <div className="space-y-1">
              <DetailRow label="Employee" value={data.employee_name} />
              <DetailRow label="Form Type" value={data.form_type} />
              <DetailRow label="Treated as" value={treatedAsLabel(data.form_type, data.category)} />
              <DetailRow label="Dates" value={data.inclusive_dates} />
              <DetailRow label="Total Hours" value={`${data.total_hours} hrs`} />
            </div>
            
            {renderSignatureBadges()}

            {standalone && user && fullRecordError && (
              <div className="flex items-start gap-2 bg-[#FFF4F4] text-[#E03E3E] p-3 rounded-md border border-[#FDEBEC] text-sm mt-4">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>Couldn't load your authenticated view of this record: {fullRecordError}</span>
              </div>
            )}

            {data.status !== 'PENDING' && (
              <div className="bg-[#F7F7F5] rounded-md p-4 mt-6">
                <p className="text-xs text-[#787774] uppercase tracking-wider mb-2 font-semibold">Approval Details</p>
                <div className="space-y-1 text-sm text-[#37352F]">
                  <p>By: <span className="font-medium">{data.approver_name}</span></p>
                  <p>On: <span className="font-medium">{data.approval_date}</span></p>
                </div>
              </div>
            )}
            
            {standalone && (
              <div className="pt-8 text-center">
                 {!user ? (
                    <Link to="/login" className="text-sm text-[#787774] hover:text-[#37352F] transition-colors underline decoration-[#E9E9E7] underline-offset-4">
                      T3CKGROUP Employee Login
                    </Link>
                 ) : (
                    <Link to="/" className="text-sm text-[#787774] hover:text-[#37352F] transition-colors underline decoration-[#E9E9E7] underline-offset-4">
                      Go to Portal
                    </Link>
                 )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
