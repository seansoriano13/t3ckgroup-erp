$changelog = Get-Content -Raw "src/data/changelog.json" | ConvertFrom-Json
$newEntry = @{
    version = "1.3.7"
    date = (Get-Date).ToString("yyyy-MM-dd")
    title = "Fixed HR Verification Queue Filtering"
    changes = @(
        "Super admins are now properly filtered out of the HR Verification employee filter.",
        "Backlog staleness is now accurately measured based on when a task was graded, rather than when it was originally logged."
    )
}
$changelog = @($newEntry) + $changelog
$changelog | ConvertTo-Json -Depth 10 | Set-Content -Path "src/data/changelog.json" -Encoding utf8
