import { stubRpc } from "@/test/msw/server"

/**
 * `canvass_subject_can_read_money` (supabase/migrations/20261019100000_canvass_repoint.sql, #276):
 * whether the caller's tier may see an Offer's prices. The fake has no caller and no tier, so a
 * test says which side it is on: `{ money: true }` is a purchaser (closed_book, cost or price),
 * `{ money: false }` a Stage Participant. The real rule is proven in the policy tier
 * (90-canvass-tables.test.js).
 */
export function stubCanvassMoneyRpc({ money = true } = {}) {
  stubRpc("canvass_subject_can_read_money", () => money)
}
