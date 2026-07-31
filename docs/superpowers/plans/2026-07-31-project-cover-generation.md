# 项目独立封面生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every non-wearable project a stable, project-specific cover and eliminate the wearable image as the homepage fallback.

**Architecture:** A small shared JavaScript module generates safe SVG data URLs for the homepage and provides a special warm-calendar illustration for the learning-plan project. A PostgreSQL migration creates an insert trigger that stores a generic generated SVG cover for every future non-wearable project, and backfills existing projects without covers. The homepage uses the shared generator only as a safe last-resort fallback.

**Tech Stack:** Node.js ESM, PostgreSQL migrations and triggers, Express static routes, vanilla browser JavaScript, Node built-in test runner.

---

## File structure

- Create: `src/project-cover.js` — deterministic SVG cover generation and XML/data URL encoding.
- Create: `db/migrations/007_project_cover_generation.sql` — existing-cover backfill and automatic future-project cover trigger.
- Modify: `server.js` — publishes the shared browser module at `/project-cover.js`.
- Modify: `project-home.html` — imports the cover generator and removes the wearable fallback.
- Modify: `test/database-config.test.js` — includes migration 007 in expected migration ordering.
- Create: `test/project-cover.test.js` — generator, homepage fallback, and migration regression tests.

### Task 1: Add a deterministic project-cover generator

**Files:**
- Create: `src/project-cover.js`
- Create: `test/project-cover.test.js`

- [ ] **Step 1: Write failing generator tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { generateProjectCover } from "../src/project-cover.js";

test("study-plan gets a dedicated warm calendar cover", () => {
  const cover = generateProjectCover({ code: "study-plan", name: "学习计划日历", description: "计划" });
  assert.match(cover, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(cover.split(",")[1], "base64").toString("utf8");
  assert.match(svg, /LEARNING PLAN/);
  assert.match(svg, /calendar/);
  assert.doesNotMatch(svg, /智能穿戴/);
});

test("generic project covers are stable, project-specific, and XML-safe", () => {
  const first = generateProjectCover({ code: "meal-plan", name: "膳食 <计划>", description: "" });
  const second = generateProjectCover({ code: "meal-plan", name: "膳食 <计划>", description: "" });
  const other = generateProjectCover({ code: "habit", name: "习惯", description: "" });
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(Buffer.from(first.split(",")[1], "base64").toString("utf8"), /膳食 &lt;计划&gt;/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/project-cover.test.js`

Expected: FAIL because `src/project-cover.js` does not exist.

- [ ] **Step 3: Implement the shared generator**

Create `src/project-cover.js` with browser-safe base64 encoding, XML escaping, a deterministic hash, and these exports:

```js
export const WEARABLE_PROJECT_CODE = "wearable-monitoring";
export const STUDY_PLAN_PROJECT_CODE = "study-plan";

function escapeXml(value) {
  return String(value || "项目").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[character]);
}

function toBase64(value) {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "utf8").toString("base64");
  return btoa(unescape(encodeURIComponent(value)));
}

function hashCode(value) {
  return [...String(value || "project")].reduce((hash, character) => ((hash * 31) + character.codePointAt(0)) >>> 0, 2166136261);
}

function genericSvg(project) {
  const hue = 24 + (hashCode(project.code) % 250);
  const name = escapeXml(project.name || "项目");
  const tag = escapeXml((project.code || "PROJECT").slice(0, 18).toUpperCase());
  return `<svg class="project-cover" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 480" role="img" aria-label="${name}"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="hsl(${hue} 62% 26%)"/><stop offset="1" stop-color="hsl(${(hue + 48) % 360} 70% 53%)"/></linearGradient></defs><rect width="960" height="480" fill="url(#g)"/><circle cx="790" cy="94" r="170" fill="#fff" opacity=".12"/><path d="M0 390Q200 280 430 405T960 335V480H0Z" fill="#fff" opacity=".13"/><text x="72" y="164" fill="#fff" font-family="Arial, PingFang SC, sans-serif" font-size="24" font-weight="700" letter-spacing="5">${tag}</text><text x="72" y="252" fill="#fff" font-family="Arial, PingFang SC, sans-serif" font-size="58" font-weight="700">${name}</text></svg>`;
}

function studyPlanSvg(project) {
  const name = escapeXml(project.name || "学习计划日历");
  return `<svg class="project-cover calendar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 480" role="img" aria-label="${name}"><rect width="960" height="480" fill="#fff2e8"/><circle cx="830" cy="90" r="180" fill="#ffe0d3"/><rect x="194" y="74" width="572" height="334" rx="28" fill="#fffdf9" stroke="#f4c5b9" stroke-width="6"/><rect x="194" y="74" width="572" height="76" rx="28" fill="#ed8791"/><text x="244" y="121" fill="#fff" font-family="Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="4">LEARNING PLAN</text><g fill="#f5d3ca"><rect x="244" y="188" width="74" height="46" rx="10"/><rect x="340" y="188" width="74" height="46" rx="10"/><rect x="436" y="188" width="74" height="46" rx="10"/></g><g fill="#d7e3ff"><rect x="532" y="188" width="74" height="46" rx="10"/><rect x="628" y="188" width="74" height="46" rx="10"/></g><g fill="#d9f0dc"><rect x="244" y="258" width="74" height="46" rx="10"/><rect x="340" y="258" width="74" height="46" rx="10"/></g><g fill="#f7e6b7"><rect x="436" y="258" width="74" height="46" rx="10"/><rect x="532" y="258" width="74" height="46" rx="10"/><rect x="628" y="258" width="74" height="46" rx="10"/></g><text x="244" y="366" fill="#65566b" font-family="Arial, PingFang SC, sans-serif" font-size="34" font-weight="700">${name}</text></svg>`;
}

export function generateProjectCover(project = {}) {
  const svg = project.code === STUDY_PLAN_PROJECT_CODE ? studyPlanSvg(project) : genericSvg(project);
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}
```

The `class="calendar"` attribute is intentional: it provides an exact semantic test marker without affecting rendering.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node --test test/project-cover.test.js`

Expected: PASS for the two generator tests.

- [ ] **Step 5: Commit the generator and its tests**

```bash
git add src/project-cover.js test/project-cover.test.js
git commit -m "feat: generate project-specific cover art"
```

### Task 2: Persist covers for existing and future projects

**Files:**
- Create: `db/migrations/007_project_cover_generation.sql`
- Modify: `test/database-config.test.js`
- Modify: `test/project-cover.test.js`

- [ ] **Step 1: Add a failing migration test**

Append this test to `test/project-cover.test.js`:

```js
import fs from "node:fs/promises";

test("project cover migration backfills projects and generates covers on future inserts", async () => {
  const sql = await fs.readFile(new URL("../db/migrations/007_project_cover_generation.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION generated_project_cover/);
  assert.match(sql, /CREATE TRIGGER projects_generated_cover_trigger/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF code, name, cover_image_url ON projects/);
  assert.match(sql, /WHERE code <> 'wearable-monitoring' AND \(cover_image_url IS NULL OR cover_image_url = ''\)/);
  assert.match(sql, /WHERE code = 'study-plan'/);
});
```

Extend the migration assertion in `test/database-config.test.js` to end with:

```js
"006_custom_study_people.sql",
"007_project_cover_generation.sql"
```

- [ ] **Step 2: Run migration-focused tests to verify they fail**

Run: `node --test test/database-config.test.js test/project-cover.test.js`

Expected: FAIL because migration `007_project_cover_generation.sql` does not exist.

- [ ] **Step 3: Create the automatic-cover migration**

Create `db/migrations/007_project_cover_generation.sql` with the following SQL. It uses PostgreSQL `hashtext` for a stable hue and writes base64 SVG directly into `cover_image_url` without external calls:

```sql
CREATE OR REPLACE FUNCTION generated_project_cover(project_code text, project_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  safe_name text := replace(replace(replace(coalesce(nullif(trim(project_name), ''), '项目'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  safe_code text := replace(replace(replace(upper(left(coalesce(nullif(trim(project_code), ''), 'PROJECT'), 18)), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  hue integer := 24 + (abs(hashtext(coalesce(project_code, 'project'))) % 250);
  svg text;
BEGIN
  svg := format(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 480" role="img" aria-label="%s"><rect width="960" height="480" fill="hsl(%s 62%% 26%%)"/><circle cx="790" cy="94" r="170" fill="#fff" opacity=".12"/><path d="M0 390Q200 280 430 405T960 335V480H0Z" fill="#fff" opacity=".13"/><text x="72" y="164" fill="#fff" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="5">%s</text><text x="72" y="252" fill="#fff" font-family="Arial, sans-serif" font-size="58" font-weight="700">%s</text></svg>',
    safe_name, hue, safe_code, safe_name
  );
  RETURN 'data:image/svg+xml;base64,' || encode(convert_to(svg, 'UTF8'), 'base64');
END;
$$;

CREATE OR REPLACE FUNCTION set_generated_project_cover()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code <> 'wearable-monitoring' AND (NEW.cover_image_url IS NULL OR NEW.cover_image_url = '') THEN
    NEW.cover_image_url := generated_project_cover(NEW.code, NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_generated_cover_trigger
BEFORE INSERT OR UPDATE OF code, name, cover_image_url ON projects
FOR EACH ROW EXECUTE FUNCTION set_generated_project_cover();

UPDATE projects
SET cover_image_url = generated_project_cover(code, name)
WHERE code <> 'wearable-monitoring' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE projects
SET cover_image_url = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NjAgNDgwIj48cmVjdCB3aWR0aD0iOTYwIiBoZWlnaHQ9IjQ4MCIgZmlsbD0iI2ZmZjJlOCIvPjxyZWN0IHg9IjE5NCIgeT0iNzQiIHdpZHRoPSI1NzIiIGhlaWdodD0iMzM0IiByeD0iMjgiIGZpbGw9IiNmZmZkZjkiIHN0cm9rZT0iI2Y0YzViOSIgc3Ryb2tlLXdpZHRoPSI2Ii8+PHJlY3QgeD0iMTk0IiB5PSI3NCIgd2lkdGg9IjU3MiIgaGVpZ2h0PSI3NiIgcng9IjI4IiBmaWxsPSIjZWQ4NzkxIi8+PHRleHQgeD0iMjQ0IiB5PSIxMjEiIGZpbGw9IiNmZmYiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyMiIgZm9udC13ZWlnaHQ9IjcwMCIgbGV0dGVyLXNwYWNpbmc9IjQiPkxFQVJOSU5HIFBMQU48L3RleHQ+PHRleHQgeD0iMjQ0IiB5PSIzNjYiIGZpbGw9IiM2NTU2NmIiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIzNCIgZm9udC13ZWlnaHQ9IjcwMCI+5a2m5Lmg6K6h5YiS5pel5Y6GPC90ZXh0Pjwvc3ZnPg=='
WHERE code = 'study-plan';
```

The final `UPDATE` deliberately overrides the generic backfill for study-plan with the confirmed warm-calendar illustration. It has no effect on the wearable project.

- [ ] **Step 4: Run migration-focused tests to verify they pass**

Run: `node --test test/database-config.test.js test/project-cover.test.js`

Expected: PASS with migration 007 present and both generator tests green.

- [ ] **Step 5: Apply and verify the migration locally**

Run: `npm run db:migrate`

Expected: `Applied database migrations.`

Then run a read-only verification:

```bash
node --input-type=module -e 'import "dotenv/config"; import { createDatabasePool } from "./src/db/pool.js"; const pool = createDatabasePool(); try { const result = await pool.query("SELECT code, left(cover_image_url, 26) AS prefix FROM projects ORDER BY sort_order, code"); console.log(result.rows); } finally { await pool.end(); }'
```

Expected: wearable-monitoring starts with `/assets/cyber-body-base.png`; study-plan starts with `data:image/svg+xml;base64,`.

- [ ] **Step 6: Commit migration work**

```bash
git add db/migrations/007_project_cover_generation.sql test/database-config.test.js test/project-cover.test.js
git commit -m "feat: generate covers for future projects"
```

### Task 3: Use the independent cover on the project homepage

**Files:**
- Modify: `server.js`
- Modify: `project-home.html`
- Modify: `test/project-cover.test.js`

- [ ] **Step 1: Add failing homepage tests**

Append this test to `test/project-cover.test.js`:

```js
test("project homepage falls back to a project-specific generated cover", async () => {
  const home = await fs.readFile(new URL("../project-home.html", import.meta.url), "utf8");
  const server = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(home, /import \{ generateProjectCover \} from "\/project-cover\.js"/);
  assert.match(home, /project\.coverImageUrl \|\| generateProjectCover\(project\)/);
  assert.doesNotMatch(home, /coverImageUrl \|\| "\/assets\/cyber-body-base\.png"/);
  assert.match(server, /app\.get\("\/project-cover\.js"/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/project-cover.test.js`

Expected: FAIL because the browser module route and new fallback are absent.

- [ ] **Step 3: Publish the module and change homepage rendering**

Add this route beside the existing `/study-plan/schedule.js` static module route in `server.js`:

```js
app.get("/project-cover.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "src", "project-cover.js"));
});
```

Change the final `<script>` in `project-home.html` to a module and add its import as the first script line:

```html
<script type="module">
  import { generateProjectCover } from "/project-cover.js";
```

In `renderProjects`, replace only the image expression:

```js
<img src="${escapeAttribute(project.coverImageUrl || generateProjectCover(project))}" alt="${escapeAttribute(`${project.name} 项目封面`)}" />
```

Do not change `guestProjects`: its wearable `coverImageUrl` remains explicitly `/assets/cyber-body-base.png`, because it is the wearable project itself.

- [ ] **Step 4: Run homepage and full regression tests**

Run: `node --test test/project-cover.test.js && npm test`

Expected: all project-cover tests pass and the complete suite reports zero failures.

- [ ] **Step 5: Commit the homepage integration**

```bash
git add server.js project-home.html test/project-cover.test.js
git commit -m "feat: show independent project covers on home"
```

## Review notes

- Spec coverage: Task 1 implements deterministic local SVG generation and the selected warm calendar art; Task 2 persists covers for existing and future non-wearable projects; Task 3 removes the homepage's wearable fallback and retains a safe generated fallback.
- Placeholder scan: no incomplete implementation steps or unresolved choices are present.
- Type consistency: every call accepts a project object with `code`, `name`, and optional `description`; the stored and rendered property is consistently `coverImageUrl` / `cover_image_url`.
- Scope check: authorization, project administration, and external image services are intentionally unchanged.
