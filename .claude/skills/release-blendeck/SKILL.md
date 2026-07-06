---
name: release-blendeck
description: Bumper la version et déployer Blendeck en production (blendeck.fr). Utiliser avant tout push sur main, pour une release taguée, ou pour comprendre le pipeline de deploy.
---

# Release & deploy Blendeck

Pipeline `.github/workflows/deploy.yml` : **test (pytest backend, bloquant) → build GHCR → deploy**. Un push sur main publie les images `latest` mais **ne déploie pas** ; le deploy SSH ne s'exécute que sur un tag `v*` ou un workflow_dispatch. Ne jamais pousser sur main sans avoir bumpé la version.

## Étapes

1. Bumper la version (synchronise `VERSION`, `backend/main.py`, `frontend/package.json` + lock) :
   ```bash
   ./scripts/update-version-from-git.sh   # auto : 1.0.<nb de commits>
   # ou
   ./scripts/bump-version.sh patch|minor|major
   ```
2. Committer en conventional commits (`feat:`, `fix:`, `chore:`, scopes `(mix)`, `(auth)`, `(deploy)`), le bump en commit séparé `chore: bump version to X.Y.Z`.
3. Pousser sur main (build des images `latest`). Pour déployer en prod : `git tag vX.Y.Z && git push --tags` (ou `workflow_dispatch` avec le tag).

## Points d'attention prod

- `docker-compose.prod.yml` : images GHCR, ports bindés sur 127.0.0.1 derrière Apache (HTTPS blendeck.fr).
- `cookies.txt` (cookies YouTube, format Netscape) doit exister dans `$DEPLOY_PATH` sur le serveur AVANT le deploy — sinon Docker crée un répertoire à sa place et yt-dlp l'ignore.
- Le `.env` backend est généré côté serveur par le workflow ; les secrets Spotify viennent des secrets GitHub Actions.
- Les tests backend (`backend/tests/`) bloquent le build : les lancer avant de pousser —
  `docker run --rm -v ./backend:/w -w /w -e CACHE_DIR=/tmp/cache python:3.11-slim bash -c "pip install -q -r requirements-dev.txt && python -m pytest tests"`
