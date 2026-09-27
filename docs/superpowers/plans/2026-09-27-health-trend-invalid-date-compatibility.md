# Health Trend Invalid-Date Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep complete health trend history available while preventing invalid legacy event dates from breaking execution-detail charts.

**Architecture:** Preserve the server-side full-history query introduced in `src/routes/healthRoutes.js`. Add one browser-side normalization boundary in `health-client.js` so execution metrics aggregate only valid `YYYY-MM-DD` dates; invalid records remain stored and returned by the API but do not become chart points.

**Tech Stack:** Node.js ES modules, browser JavaScript, `node:test`, Express, PM2, Tencent Cloud command execution.

---

## File structure

- Modify `test/health-page.test.js`: add a source-contract regression test for strict date validation and guarded trend aggregation.
- Modify `health-client.js`: add `validTrendDate()` and use it before inserting event or meal points into the execution trend map.
- Retain `src/routes/healthRoutes.js`: keep commit `8518839` so the API reads full history and derives the requested date range in application code.
- Publish `health-client.js` and `src/routes/healthRoutes.js`: both runtime files must move together because the validated behavior depends on the client guard and server history change.

### Task 1: Add the failing browser regression test

**Files:**
- Modify: `test/health-page.test.js`

- [ ] **Step 1: Add strict date-guard assertions to the trend-page test**

Add these assertions inside `test("trend page renders current metrics, real series, and explicit unavailable states", ...)` after the existing `executionPoints`-related expectations:

```js
  assert.match(client, /function validTrendDate\(value\)/);
  assert.match(client, /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//);
  assert.match(client, /parsed\.toISOString\(\)\.slice\(0, 10\) !== date/);
  assert.match(client, /const date = validTrendDate\(dateValue\); if \(!date\) return/);
```

- [ ] **Step 2: Run the focused test and verify that it fails**

Run:

```bash
node --test test/health-page.test.js
```

Expected: the trend-page test fails because `health-client.js` does not yet contain `validTrendDate()` or the guarded insertion.

### Task 2: Implement the minimal client-side compatibility guard

**Files:**
- Modify: `health-client.js:255-260`
- Test: `test/health-page.test.js`

- [ ] **Step 1: Add a strict date normalizer immediately before `executionPoints()`**

Insert:

```js
function validTrendDate(value) {
  const date = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return date;
}
```

This accepts actual calendar dates such as `2026-09-27` and rejects missing values, malformed strings, and impossible dates such as `2026-02-30`.

- [ ] **Step 2: Guard map insertion inside `executionPoints()`**

Replace the existing `add` callback with:

```js
  const add = (dateValue, value, daily = false) => {
    const date = validTrendDate(dateValue); if (!date) return;
    byDate.set(date, daily ? 1 : (byDate.get(date) || 0) + value);
  };
```

Keep the existing event and meal loops unchanged. They may pass malformed legacy values to `add`, but those values will no longer reach sorting or `dateLabel()`.

- [ ] **Step 3: Run syntax and focused tests**

Run:

```bash
node --check health-client.js
node --test test/health-page.test.js test/health-routes.test.js test/health-summary.test.js
```

Expected: syntax check succeeds; all focused tests pass.

- [ ] **Step 4: Run the full test suite**

Run outside the restricted sandbox because trade-analysis route tests bind to `127.0.0.1`:

```bash
npm test
```

Expected: 159 passing, 0 failing, 1 skipped unless unrelated tests have been added since this plan was written.

- [ ] **Step 5: Commit only the compatibility fix**

```bash
git add -- health-client.js test/health-page.test.js
git commit -m "Handle invalid dates in health trends"
```

Expected: the commit contains exactly the runtime client change and its regression test. Existing unrelated untracked files remain untouched.

### Task 3: Build and verify the release candidate

**Files:**
- Package: `health-client.js`
- Package: `src/routes/healthRoutes.js`

- [ ] **Step 1: Record exact source sizes and hashes**

Run:

```bash
wc -c health-client.js src/routes/healthRoutes.js
shasum -a 256 health-client.js src/routes/healthRoutes.js
```

Expected: both files have nonzero sizes; save the reported SHA-256 values for candidate, live-filesystem, and public-response verification.

- [ ] **Step 2: Create a compressed candidate containing only runtime files**

Run:

```bash
tar -cJf /private/tmp/health-date-compatibility-20260927.tar.xz health-client.js src/routes/healthRoutes.js
wc -c /private/tmp/health-date-compatibility-20260927.tar.xz
shasum -a 256 /private/tmp/health-date-compatibility-20260927.tar.xz
```

Expected: the archive contains exactly the two listed runtime files and has a recorded nonzero size and SHA-256.

### Task 4: Publish atomically and verify production

**Files:**
- Update: `/opt/ai-life/health-client.js`
- Update: `/opt/ai-life/src/routes/healthRoutes.js`
- Backup: `/home/ubuntu/ai-life-backups/health-date-compatibility-$STAMP/previous/health-client.js` and `/home/ubuntu/ai-life-backups/health-date-compatibility-$STAMP/previous/src/routes/healthRoutes.js`

- [ ] **Step 1: Rediscover the production process and current hashes**

Run through the authenticated Tencent Cloud command channel:

```bash
PID=$(sudo -iu ubuntu pm2 pid ai-life | tail -1)
echo "PID=$PID CWD=$(readlink -f /proc/$PID/cwd)"
wc -c /opt/ai-life/health-client.js /opt/ai-life/src/routes/healthRoutes.js
sha256sum /opt/ai-life/health-client.js /opt/ai-life/src/routes/healthRoutes.js
```

Expected: PM2 reports a positive PID and the working directory resolves to the active application root. The server route hash still matches the rolled-back stable version before promotion.

- [ ] **Step 2: Transfer and verify the candidate before promotion**

Transfer the archive into `/home/ubuntu/health-date-compatibility-20260927.tar.xz`. Before touching `/opt/ai-life`, run:

```bash
wc -c /home/ubuntu/health-date-compatibility-20260927.tar.xz
sha256sum /home/ubuntu/health-date-compatibility-20260927.tar.xz
```

Expected: both outputs exactly match the local archive size and SHA-256 recorded in Task 3. Do not promote the candidate if either value differs.

- [ ] **Step 3: Back up, stage in the live directories, rename, and restart**

Use the candidate hashes recorded in Task 3:

```bash
set -eu
APP=/opt/ai-life
STAMP=$(date +%Y%m%d-%H%M%S)
REL=/home/ubuntu/ai-life-backups/health-date-compatibility-$STAMP
FILES='health-client.js src/routes/healthRoutes.js'
mkdir -p "$REL/candidate" "$REL/previous"
tar -xJf /home/ubuntu/health-date-compatibility-20260927.tar.xz -C "$REL/candidate"
node --check "$REL/candidate/health-client.js"
node --check "$REL/candidate/src/routes/healthRoutes.js"
for f in $FILES; do install -D -m 0644 "$APP/$f" "$REL/previous/$f"; done
for f in $FILES; do install -D -o ubuntu -g ubuntu -m 0644 "$REL/candidate/$f" "$APP/$f.new"; done
for f in $FILES; do mv -f "$APP/$f.new" "$APP/$f"; done
sudo -iu ubuntu pm2 restart ai-life --update-env
```

Before each rename, compare candidate size and SHA-256 with Task 3. If any later verification fails, restore both files from `$REL/previous` and restart PM2.

- [ ] **Step 4: Verify filesystem, application-local, and public layers**

Run:

```bash
sha256sum /opt/ai-life/health-client.js /opt/ai-life/src/routes/healthRoutes.js
curl -fsS http://127.0.0.1:5173/health-client.js -o "$REL/client.local"
curl -fsS "https://ai-life.top/health-client.js?v=health-date-compatibility-20260927" -o "$REL/client.public"
wc -c "$REL/client.local" "$REL/client.public"
sha256sum "$REL/client.local" "$REL/client.public"
```

Expected: live filesystem hashes match Task 3; local and public client bodies return the full expected byte size and client hash; HTTPS returns 200.

- [ ] **Step 5: Perform authenticated browser acceptance**

Open `https://ai-life.top/projects/health?v=health-date-compatibility-20260927` in the existing logged-in Chrome profile and verify:

1. Open “趋势”.
2. Open “体重” and select “全部”; the chart remains visible.
3. Close it, open “总饮水量”, and select “全部”; valid points render, or “暂无总饮水量记录” appears.
4. Inspect browser error logs; there must be no `Invalid time value` and no newly introduced errors.

Expected: all four checks pass without altering health records.

- [ ] **Step 6: Report completion**

Report the final URL, update-upload mode, source hashes, public 200/full-size/hash result, timestamped backup path, final commit, and test counts. Mention that the existing login and health data were preserved.
