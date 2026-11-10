import { Navigate, useLocation } from "react-router";
import { redirectTarget } from "@/lib/redirectTarget";

export default function CommissionFormulaRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={redirectTarget("/sors/commission", location, { tab: "formula" })}
      replace
    />
  );
}
