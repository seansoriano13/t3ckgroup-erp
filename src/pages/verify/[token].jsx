import { useEffect, useState } from "react";
import { useParams, Navigate, Link } from "react-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import Spinner from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, SearchX, AlertTriangle, ArrowRight } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchRecord() {
      if (!token || isAuthLoading) return;
      
      setLoading(true);
      setError(null);

      try {
        // 1. Try to fetch the full record if authenticated
        if (user) {
          const [leaveReq, offsetReq, otReq] = await Promise.all([
            supabase.from("sil_leaves").select("*, hr_leave_categories(label), employees!sil_leaves_employee_id_fkey(first_name, last_name)").eq("verification_token", token).maybeSingle(),
            supabase.from("offset_leaves").select("*, hr_leave_categories(label), employees!offset_leaves_employee_id_fkey(first_name, last_name)").eq("verification_token", token).maybeSingle(),
            supabase.from("overtime_requests").select("*, hr_leave_categories(label), employees!overtime_requests_employee_id_fkey(first_name, last_name)").eq("verification_token", token).maybeSingle(),
          ]);

          const foundFull = leaveReq.data || offsetReq.data || otReq.data;
          
          if (foundFull) {
            setFullRecord({
              ...foundFull,
              form_type: leaveReq.data ? "Leave" : offsetReq.data ? "Offset" : "Overtime",
              employee_name: `${foundFull.employees?.first_name} ${foundFull.employees?.last_name}`,
              category: foundFull.hr_leave_categories?.label || "General"
            });
            setLoading(false);
            return;
          }
        }

        // 2. Fetch the limited public record using RPC
        const { data: record, error: fetchError } = await supabase.rpc("verify_form_token", { lookup_token: token });
        
        if (fetchError) {
          if (fetchError.message?.includes("Rate limit")) {
            setError("rate_limited");
          } else {
            setError("not_found");
          }
        } else if (!record) {
          setError("not_found");
        } else {
          setData(record);
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

  if (error === "not_found" && !fullRecord) {
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
                  <p className="text-sm text-muted-foreground mt-0.5">{fullRecord.hours} hours total</p>
                </div>
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
