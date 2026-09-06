import React from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import ProtectedRoute from '../../../components/ProtectedRoute';
import FlowCanvas from '../../../components/settings/FlowCanvas';
import { SandboxFlowDataProvider } from '../../../components/settings/SandboxFlowDataProvider';
import { flowPlanService } from '../../../services/flowPlanService';
import { Button } from '../../../components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';

export default function FlowPlanSandboxPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: plan, isLoading } = useQuery({
    queryKey: ['flow_plans', id],
    queryFn: () => flowPlanService.getPlan(id),
  });

  if (isLoading) {
    return (
      <ProtectedRoute>
        <div className="flex h-full items-center justify-center bg-mauve-1">
          <Spinner size="lg" />
        </div>
      </ProtectedRoute>
    );
  }

  if (!plan) {
    return (
      <ProtectedRoute>
        <div className="flex h-full flex-col items-center justify-center p-8 text-center bg-mauve-2">
          <h2 className="text-xl font-bold text-foreground">Plan not found</h2>
          <p className="mt-2 text-sm text-muted-foreground">The plan may have been deleted or doesn't exist.</p>
          <Button className="mt-6" onClick={() => navigate('/super-admin/flow-plans')}>
            Back to Flow Plans
          </Button>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="flex h-full flex-col">
        {/* Top bar for Sandbox context */}
        <header className="flex shrink-0 items-center gap-4 border-b border-mauve-5 bg-card px-4 py-3 z-10 relative shadow-sm">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate('/super-admin/flow-plans')}>
            <ArrowLeft size={16} />
          </Button>
          <div>
            <h1 className="text-sm font-bold text-foreground flex items-center gap-2">
              <span className="rounded-md bg-amber-4 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-11">
                Sandbox
              </span>
              {plan.name}
            </h1>
          </div>
        </header>

        {/* The Canvas */}
        <div className="flex-1 relative">
          <SandboxFlowDataProvider planId={id}>
            <FlowCanvas />
          </SandboxFlowDataProvider>
        </div>
      </div>
    </ProtectedRoute>
  );
}
