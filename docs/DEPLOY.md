# Deploying the demo

The demo is hosted on GitHub Pages the same way as sensds-web: every push to
`main` runs `.github/workflows/pages.yml`, which runs `npm ci`, `npm test`,
`npm run build`, and publishes `dist/`. If a test fails, nothing is deployed.

- Live site: https://michaeladeleke2.github.io/radar-js/
- Repository: https://github.com/michaeladeleke2/radar-js (public: on the
  current GitHub plan, Pages is not available for private repositories)

## Day to day

```bash
git push
gh run watch          # or the repository's Actions tab; about a minute
```

## Set it up from scratch on another machine

Needs Node 22.18 or newer, git, and the GitHub CLI (`gh`). Python 3 with numpy and scipy only to regenerate the golden data.

```bash
gh auth login                                   # once per machine
git clone https://github.com/michaeladeleke2/radar-js.git
cd radar-js
npm ci
npm test && npm run build                       # same checks CI runs
```

To recreate the GitHub side for a new repository (what was done on 2026-10-21):

```bash
gh repo create <owner>/radar-js --public --source . --remote origin --push
gh api -X POST repos/<owner>/radar-js/pages -f build_type=workflow
gh run list --limit 1                           # the deploy started by the push
```

(A private repository needs a paid GitHub plan for Pages; the API answers
"Your current plan does not support GitHub Pages for this repository".)

## Run locally with the radar

```bash
npm run dev        # http://localhost:5173 (Web Serial works on localhost)
```
