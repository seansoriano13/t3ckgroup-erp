import { useState } from "react"
import { Button } from "@/components/ui/button"
import EmptyState from "@/components/ui/EmptyState"
import QueryError from "@/components/ui/QueryError"
import TabGroup from "@/components/ui/TabGroup"
import MarketplaceBreakdown from "../sor/MarketplaceBreakdown"
import { RetailOrderTable } from "../sor/RetailOrderRow"
import { PEOPLE, daysAgo, hoursAgo } from "./sampleData"

/**
 * The Everywhere and Retail tabs' samples: the app's own components fed
 * Sample Data. Throwaway (ADR 0030, 2026-11 amendment): if one breaks, delete it.
 */

export function RetrySample() {
  const [view, setView] = useState("error")
  return (
    <div className="space-y-4">
      <TabGroup
        variant="pill"
        size="sm"
        tabs={[
          { value: "error", label: "A list that failed" },
          { value: "filtered", label: "Filters hide everything" },
        ]}
        activeTab={view}
        onChange={setView}
      />
      <div className="rounded-2xl border border-border bg-card p-4">
        {view === "error" ? (
          <QueryError title="Your SORs could not be loaded." onRetry={() => setView("filtered")} />
        ) : (
          <EmptyState
            title="No results match these filters"
            description="Nothing here fits the current search or filters."
            action={
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setView("error")}>
                Clear filters
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}

const order = (n, marketplace, amount, fee, income, hours) => ({
  id: `ro-${n}`,
  odoo_so_id: null,
  odoo_so_number: `S0${String(9100 + n)}`,
  marketplace,
  marketplace_order_id: `${marketplace === "Shopee" ? "2611" : "LZ"}${String(48210000 + n * 137)}`,
  buyer_name: ["Demo Buyer A", "Demo Buyer B", "Demo Buyer C", "Demo Buyer D", "Demo Buyer E"][n % 5],
  odoo_salesperson_name: n % 2 ? PEOPLE.paolo.name : PEOPLE.lara.name,
  ordered_at: hours < 48 ? hoursAgo(hours) : daysAgo(Math.round(hours / 24)),
  amount,
  marketplace_fee: fee,
  order_income: income,
})

const ORDERS = [
  order(1, "Shopee", 12000, 1500, 10500, 3),
  order(2, "Lazada", 8000, 1100, 6900, 20),
  order(3, "Shopee", 4000, 500, 3500, 50),
  order(4, "Lazada", 15000, 2000, null, 70),
  order(5, "Shopee", 6000, 800, 5200, 120),
]

export function RetailIncomeSample() {
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <RetailOrderTable orders={ORDERS} salesperson />
      </div>
      <MarketplaceBreakdown orders={ORDERS} />
    </div>
  )
}
