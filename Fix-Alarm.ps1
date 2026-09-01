# The alarm's gh commands inferred the repo from a git checkout, and the test
# workflow has no checkout, so gh saw "not a git repository" and the alarm died.
# Naming the repo explicitly with -R works with or without a checkout.
# Run once from the repo root:  powershell -ExecutionPolicy Bypass -File Fix-Alarm.ps1

$files = Get-ChildItem .github\workflows\fetch-*.yml, .github\workflows\test-alarm.yml
foreach ($f in $files) {
  $text = Get-Content $f.FullName -Raw
  if ($text -notmatch 'FAILURE ALARM|Fail deliberately') { Write-Host "skip: $($f.Name)"; continue }
  if ($text -match 'issue list -R') { Write-Host "already fixed: $($f.Name)"; continue }
  $text = $text.Replace('gh issue list --state', 'gh issue list -R ${{ github.repository }} --state')
  $text = $text.Replace('gh issue comment "$EXISTING"', 'gh issue comment -R ${{ github.repository }} "$EXISTING"')
  $text = $text.Replace('gh issue create --title', 'gh issue create -R ${{ github.repository }} --title')
  Set-Content $f.FullName $text -NoNewline
  Write-Host "fixed: $($f.Name)"
}
Write-Host "`nDone. Push, then run the test workflow again."
