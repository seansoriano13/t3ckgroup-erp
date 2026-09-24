import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { groupTaskService } from "../../../services/groupTaskService";
import { useAuth } from "../../../context/AuthContext";
import { useState } from "react";
import { Users, CheckCircle2, XCircle, Search, Star } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function GroupTaskApprovalSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: groupTasks = [], isLoading } = useQuery({
    queryKey: ["groupTasksForHR"],
    queryFn: () => groupTaskService.getGroupTasks(user.id, false, true), // HR sees all
    enabled: !!user?.id,
  });

  const pendingHrTasks = groupTasks.filter(t => t.status === "HR_PENDING");
  
  const filteredTasks = pendingHrTasks.filter(t => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return t.title.toLowerCase().includes(q) || t.creator?.name.toLowerCase().includes(q);
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, remarks }) => groupTaskService.verifyGroupTask(id, user.id, remarks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasksForHR"] });
      toast.success("Group Task Verified!");
    },
    onError: (err) => toast.error(err.message)
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }) => groupTaskService.rejectGroupTask(id, user.id, remarks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasksForHR"] });
      toast.success("Group Task Rejected back to Head!");
    },
    onError: (err) => toast.error(err.message)
  });

  const [actionRemarks, setActionRemarks] = useState({});

  if (isLoading) {
    return <div className="py-20 text-center font-bold text-muted-foreground">Loading Group Task Approvals...</div>;
  }

  if (pendingHrTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 bg-card border border-border rounded-xl shadow-sm text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-6 bg-muted text-muted-foreground ring-4 ring-muted/50">
          <Users size={32} />
        </div>
        <p className="text-foreground font-bold text-2xl tracking-tight">No Group Tasks Pending</p>
        <p className="text-muted-foreground mt-2 font-medium">There are no group tasks awaiting HR verification right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative w-full max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search by title or creator..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          containerClassName="w-full" className="pl-9 pr-4"
        />
      </div>

      <div className="grid gap-6">
        {filteredTasks.map(task => (
          <div key={task.id} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-border flex flex-col md:flex-row justify-between gap-4">
               <div>
                  <h3 className="font-black text-xl text-foreground">{task.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">Created by: <span className="font-bold text-foreground">{task.creator?.name}</span></p>
                  {task.description && <p className="text-sm text-muted-foreground mt-2">{task.description}</p>}
               </div>
               <div className="shrink-0 flex flex-col gap-2 min-w-[250px]">
                  <textarea 
                    placeholder="HR Remarks (required for rejection)"
                    value={actionRemarks[task.id] || ""}
                    onChange={(e) => setActionRemarks(prev => ({ ...prev, [task.id]: e.target.value }))}
                    className="w-full text-xs p-2 bg-muted/50 border border-border rounded-lg outline-none focus:border-primary resize-none h-16"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={() => verifyMutation.mutate({ id: task.id, remarks: actionRemarks[task.id] })}
                      disabled={verifyMutation.isPending}
                      className="flex-1 h-auto py-1.5 text-xs font-bold bg-green-9 text-primary-foreground hover:bg-green-9"
                    >
                      <CheckCircle2 size={14} /> Verify
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        if (!actionRemarks[task.id]?.trim()) {
                          toast.error("Remarks are required to reject.");
                          return;
                        }
                        rejectMutation.mutate({ id: task.id, remarks: actionRemarks[task.id] });
                      }}
                      disabled={rejectMutation.isPending}
                      className="flex-1 h-auto py-1.5 text-xs font-bold bg-destructive text-primary-foreground hover:bg-destructive"
                    >
                      <XCircle size={14} /> Reject
                    </Button>
                  </div>
               </div>
            </div>
            
            <div className="p-5 bg-muted/10">
               <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Member Evaluations</h4>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                 {task.members?.map(m => (
                   <div key={m.id} className="bg-card border border-border p-3 rounded-lg flex flex-col gap-1.5">
                     <div className="flex justify-between items-start">
                       <span className="font-bold text-sm">{m.employee?.name}</span>
                       <div className="flex items-center text-amber-9 bg-warning/10 px-1.5 py-0.5 rounded text-xs font-bold gap-0.5">
                         {m.grade} <Star size={10} fill="currentColor" />
                       </div>
                     </div>
                     <p className="text-[11px] text-muted-foreground line-clamp-2">{m.task_description}</p>
                     {m.grade_remarks && (
                       <div className="mt-1 p-1.5 bg-muted rounded text-[10px] text-muted-foreground italic">
                         "{m.grade_remarks}"
                       </div>
                     )}
                   </div>
                 ))}
               </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
