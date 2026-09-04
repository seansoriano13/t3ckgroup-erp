// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `/`
  | `/approvals`
  | `/approvals/hr-verification`
  | `/approvals/tasks`
  | `/group-tasks`
  | `/group-tasks/templates`
  | `/hr`
  | `/hr/management`
  | `/hr/offsets`
  | `/hr/offsets/components/DocumentCenterTab`
  | `/login`
  | `/offsets`
  | `/opportunities`
  | `/opportunities/commission`
  | `/opportunities/commission-formula`
  | `/profile`
  | `/purchasing`
  | `/settings`
  | `/settings/FAQEditor`
  | `/settings/FAQModal`
  | `/super-admin`
  | `/super-admin/activity-log`
  | `/super-admin/commission`
  | `/super-admin/flow-canvas`
  | `/super-admin/lead-sources`
  | `/tasks`
  | `/verify/:token`

export type Params = {
  '/verify/:token': { token: string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
