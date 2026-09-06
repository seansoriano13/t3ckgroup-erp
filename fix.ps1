$content = Get-Content -Raw "src/test/pages/approvals.e2e.test.jsx"
$content = $content -replace 'import \{ makeCategory, makeEmployee, makeHead, makeHrEmployee, makeTask \} from "@/test/factories"', 'import { makeCategory, makeEmployee, makeHead, makeHrEmployee, makeSuperAdmin, makeTask } from "@/test/factories"'
Set-Content -Path "src/test/pages/approvals.e2e.test.jsx" -Value $content
