INSERT INTO projects (id, code, name, description, route, cover_image_url, sort_order)
VALUES (
  '6cc66a0d-0ad2-4873-ac2c-e2e4a4bb6f1a',
  'trade-analysis',
  '交易分析',
  '展示账户资金流水、收益、持仓与交易行为分析。',
  '/projects/trade-analysis',
  NULL,
  3
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  route = EXCLUDED.route,
  cover_image_url = EXCLUDED.cover_image_url,
  sort_order = EXCLUDED.sort_order;
