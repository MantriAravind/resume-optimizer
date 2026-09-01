# Appends the failure alarm and issue permissions to every fetch workflow.
# Run once from the repo root:  powershell -ExecutionPolicy Bypass -File Add-Alarm.ps1
# Idempotent: a file that already has the alarm is skipped.

$alarm = @'

      # ── FAILURE ALARM ─────────────────────────────────────────────────────
      # Runs ONLY when a step above failed. Opens a GitHub issue named after this
      # workflow; GitHub emails the repo owner when an issue opens, so a broken
      # fetcher becomes an email instead of a silently stale board. A repeat
      # failure comments on the existing issue rather than opening another.
      - name: Open an issue on failure
        if: failure()
        env:
          GH_TOKEN: ${{ github.token }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          TITLE="🔴 ${{ github.workflow }} failed"
          BODY="Run: $RUN_URL
          Failed at: $(date -u '+%Y-%m-%d %H:%M UTC')

          The board stops getting this source's jobs until this is fixed. The sweep guard prevents deletions, so nothing is lost - but nothing is fresh either."
          EXISTING=$(gh issue list --state open --search "\"$TITLE\" in:title" --json number --jq '.[0].number' || true)
          if [ -n "$EXISTING" ]; then
            gh issue comment "$EXISTING" --body "Failed again: $RUN_URL"
          else
            gh issue create --title "$TITLE" --body "$BODY"
          fi
'@

$perms = @'

# The alarm step opens issues; without this the token is read-only and the alarm
# itself fails with a 403.
permissions:
  contents: read
  issues: write
'@

$files = Get-ChildItem .github\workflows\fetch-*.yml
foreach ($f in $files) {
  $text = Get-Content $f.FullName -Raw
  if ($text -match 'FAILURE ALARM') { Write-Host "skip (already has alarm): $($f.Name)"; continue }
  Add-Content $f.FullName $alarm
  if ($text -notmatch '(?m)^permissions:') { Add-Content $f.FullName $perms }
  Write-Host "updated: $($f.Name)"
}
Write-Host "`nDone. Open one file and check the alarm sits under 'steps:' before pushing."
