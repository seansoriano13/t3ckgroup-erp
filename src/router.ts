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
  | `/approvals/components/GroupTaskApprovalSection`
  | `/approvals/hr-verification`
  | `/approvals/hr-verification/components/BulkVerifyModal`
  | `/approvals/tasks`
  | `/group-tasks`
  | `/group-tasks/components/CreateGroupTaskModal`
  | `/group-tasks/components/GroupRoleManagerModal`
  | `/group-tasks/components/GroupTaskCard`
  | `/group-tasks/components/GroupTaskDetailModal`
  | `/group-tasks/components/GroupTaskMemberPanel`
  | `/group-tasks/components/GroupTaskMemberRail`
  | `/group-tasks/components/RateEmployeesModal`
  | `/group-tasks/components/SaveGroupTaskTemplateModal`
  | `/group-tasks/templates`
  | `/group-tasks/templates/components/TemplateEditorModal`
  | `/hr-master-log`
  | `/hr/management`
  | `/hr/offsets`
  | `/login`
  | `/offsets`
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
