CREATE OR REPLACE FUNCTION generated_project_cover(project_code text, project_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  safe_name text := replace(replace(replace(replace(replace(coalesce(nullif(trim(project_name), ''), '项目'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&apos;');
  safe_code text := replace(replace(replace(replace(replace(upper(left(coalesce(nullif(trim(project_code), ''), 'PROJECT'), 18)), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&apos;');
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
SET cover_image_url = 'data:image/svg+xml;base64,' || encode(convert_to($svg$
<svg class="project-cover calendar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 480" role="img" aria-label="学习计划日历">
  <rect width="960" height="480" fill="#fff2e8"/>
  <circle cx="830" cy="90" r="180" fill="#ffe0d3"/>
  <rect x="194" y="74" width="572" height="334" rx="28" fill="#fffdf9" stroke="#f4c5b9" stroke-width="6"/>
  <rect x="194" y="74" width="572" height="76" rx="28" fill="#ed8791"/>
  <text x="244" y="121" fill="#fff" font-family="Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="4">LEARNING PLAN</text>
  <g fill="#f5d3ca"><rect x="244" y="188" width="74" height="46" rx="10"/><rect x="340" y="188" width="74" height="46" rx="10"/><rect x="436" y="188" width="74" height="46" rx="10"/></g>
  <g fill="#d7e3ff"><rect x="532" y="188" width="74" height="46" rx="10"/><rect x="628" y="188" width="74" height="46" rx="10"/></g>
  <g fill="#d9f0dc"><rect x="244" y="258" width="74" height="46" rx="10"/><rect x="340" y="258" width="74" height="46" rx="10"/></g>
  <g fill="#f7e6b7"><rect x="436" y="258" width="74" height="46" rx="10"/><rect x="532" y="258" width="74" height="46" rx="10"/><rect x="628" y="258" width="74" height="46" rx="10"/></g>
  <text x="244" y="366" fill="#65566b" font-family="Arial, sans-serif" font-size="34" font-weight="700">学习计划日历</text>
</svg>
$svg$, 'UTF8'), 'base64')
WHERE code = 'study-plan';
