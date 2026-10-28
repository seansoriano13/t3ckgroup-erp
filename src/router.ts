// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `/`
  | `/approvals`
  | `/approvals/bid-decisions`
  | `/approvals/canvass-signoffs`
  | `/approvals/hr-verification`
  | `/approvals/ipas`
  | `/approvals/leaves`
  | `/approvals/meetings`
  | `/approvals/tasks`
  | `/approvals/transmittals`
  | `/bug-reports`
  | `/calendar`
  | `/costing-matrix`
  | `/costing-matrix/:id`
  | `/crm`
  | `/crm/commission`
  | `/crm/commission-formula`
  | `/flow-versions/:snapshotId`
  | `/group-tasks`
  | `/group-tasks/templates`
  | `/hr`
  | `/hr/management`
  | `/hr/offsets`
  | `/login`
  | `/my-sors`
  | `/offsets`
  | `/opportunities`
  | `/opportunities/commission`
  | `/opportunities/commission-formula`
  | `/profile`
  | `/purchasing`
  | `/purchasing/canvasses`
  | `/purchasing/dashboard`
  | `/purchasing/ipas`
  | `/purchasing/ipas/:id`
  | `/purchasing/ipas/settings`
  | `/purchasing/order-monitoring`
  | `/purchasing/packing-lists`
  | `/purchasing/packing-lists/:id`
  | `/purchasing/transmittals`
  | `/purchasing/transmittals/:id`
  | `/purchasing/transmittals/new`
  | `/release-notes`
  | `/reset-password`
  | `/retail`
  | `/settings`
  | `/settings/FAQEditor`
  | `/sors`
  | `/sors/commission`
  | `/sors/commission-formula`
  | `/super-admin`
  | `/super-admin/activity-log`
  | `/super-admin/commission`
  | `/super-admin/flow-access`
  | `/super-admin/flow-canvas`
  | `/super-admin/lead-sources`
  | `/tasks`
  | `/verify/:token`

export type Params = {
  '/costing-matrix/:id': { id: string }
  '/flow-versions/:snapshotId': { snapshotId: string }
  '/purchasing/ipas/:id': { id: string }
  '/purchasing/packing-lists/:id': { id: string }
  '/purchasing/transmittals/:id': { id: string }
  '/verify/:token': { token: string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
