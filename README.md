# ai-life

Static display build for Cloudflare Pages.

## Update workflow

Cloudflare Pages is connected to `davidt052082-ai/ai-life` on the `main` branch.
It deploys the `public/` directory automatically after each GitHub push.

To publish local page changes:

```bash
cp index.html public/index.html
rm -rf public/assets
cp -R assets public/assets
git add public README.md .gitignore
git commit -m "Update static site"
git push origin main
```

Production URL:

```text
https://ai-life-wgk.pages.dev
https://www.ai-life.top
```
