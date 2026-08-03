// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `/`
  | `/approvals`
  | `/approvals/components/ApprovalHeader`
  | `/approvals/components/ApprovalRow`
  | `/approvals/components/BulkDeclineModal`
  | `/approvals/components/BulkGradeModal`
  | `/approvals/components/CommitteeApprovalSection`
  | `/approvals/hr-verification`
  | `/approvals/hr-verification/components/BulkVerifyModal`
  | `/approvals/tasks`
  | `/committee`
  | `/committee/components/CommitteeRoleManagerModal`
  | `/committee/components/CommitteeTaskCard`
  | `/committee/components/CommitteeTaskDetailModal`
  | `/committee/components/CreateCommitteeTaskModal`
  | `/committee/components/RateEmployeesModal`
  | `/hr-master-log`
  | `/hr/management`
  | `/login`
  | `/opportunities`
  | `/profile`
  | `/settings`
  | `/settings/FAQEditor`
  | `/settings/FAQModal`
  | `/super-admin`
  | `/super-admin/activity-log`
  | `/tasks`

export type Params = {
  
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
