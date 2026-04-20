<div align="center">

# 🎛 Blendeck

**Transformez vos playlists Spotify en sets DJ mixés automatiquement.**

Analyse audio par IA · Harmonic mixing · Génération de mix MP3

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://docs.docker.com/compose/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ✨ Fonctionnalités

### 🔬 Analyse Audio Intelligente

- Détection de **BPM**, **tonalité**, **énergie**, **danceabilité**, **valence** via [librosa](https://librosa.org) (Krumhansl-Schmuckler)
- Cross-validation BPM avec Deezer (double/half-time)
- Analyse en temps réel avec progression SSE

### 🎹 Harmonic Mixing

- Système **Camelot Wheel** complet (12 clés × 2 modes)
- Scoring de compatibilité harmonique entre pistes
- Détection des transitions parfaites, adjacentes et relatives

### 🤖 Génération de Sets DJ

- Algorithme **Greedy Beam Search** (largeur configurable)
- 5 critères pondérés : BPM, tonalité, énergie, danceabilité, année
- Courbes d'énergie : arc, montée, descente, plateau

### 🎧 Génération de Mix MP3

- Téléchargement automatique des pistes via YouTube Music
- Cache intelligent des pistes déjà téléchargées
- **6 styles de transition** : crossfade, fade, cut, echo, beatmatch, auto
- Découpe intelligente avec **détection vocale** (analyse spectrale 300–3500 Hz)
- Progression temps réel par étape (téléchargement → découpe → analyse → mixage)
- **Pré-chargement en arrière-plan** des morceaux lors du chargement d'une playlist (configurable)

### 📚 Historique des Mix

- Sauvegarde automatique par playlist (5 derniers mix)
- Lecture en ligne avec lecteur intégré (seekable)
- Re-téléchargement à tout moment

### 📤 Export Multiple

- Nouvelle playlist Spotify
- Réorganisation de la playlist existante
- Export CSV / JSON des métadonnées
- Mix MP3 avec auto-download

### 🎨 Interface

- Drag & drop pour réordonner les pistes
- Graphique d'énergie interactif (Recharts)
- Badges de qualité de transition entre chaque piste
- Tri rapide par BPM, tonalité, énergie, danceabilité, mood, année

### 🛠️ Administration

- **Panel Admin** (`/admin`) pour gérer le cache local
- Inspection des pistes en cache (sources : tracks complets + previews)
- Play/pause des fichiers en cache
- Suppression individuelle par source (preview ou fichier complet)
- Statistiques de cache global (taille, nombre de fichiers)
- Nettoyage du cache par scope (tracks, mixes, transitions, metadata)

### ⚡ Optimisations

- **Cache Spotify API** (30 min TTL) pour `/v1/me` et `/v1/me/playlists`
- Réduction drastique des appels redondants à l'API Spotify
- **Versioning automatique** basé sur les commits git

---

## 🏗 Architecture

```
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│         Frontend (3000)         │     │          Backend (8000)          │
│  Next.js 14 · React 18 · TW    │────▶│  FastAPI · librosa · yt-dlp     │
│  TanStack Query · dnd-kit       │ API │  Spotipy · ytmusicapi · ffmpeg  │
│  Recharts · Lucide              │◀────│  ThreadPoolExecutor · SSE       │
└─────────────────────────────────┘     └──────────────────────────────────┘
                                                      │
                                         ┌────────────┴────────────┐
                                         │    Spotify API          │
                                         │    Deezer API           │
                                         │    YouTube Music        │
                                         └─────────────────────────┘
```

| Couche       | Technologie                       | Rôle                                     |
| ------------ | --------------------------------- | ---------------------------------------- |
| **Frontend** | Next.js 14, React 18, TailwindCSS | Interface, auth PKCE, visualisations     |
| **Backend**  | FastAPI, Python 3.11              | API REST/SSE, analyse audio, mixage      |
| **Analyse**  | librosa, numpy                    | BPM, tonalité, énergie, détection vocale |
| **Audio**    | yt-dlp, ytmusicapi, ffmpeg        | Téléchargement, transcodage, mix         |
| **Auth**     | Spotify OAuth (PKCE S256)         | Scopes: playlists, streaming, playback   |
| **Cache**    | JSON + filesystem                 | Features audio, previews, pistes, mix    |

---

## 🚀 Démarrage rapide

### Prérequis

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- Un compte [Spotify Developer](https://developer.spotify.com/dashboard)

### 1. Créer une app Spotify

1. Aller sur **[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)**
2. Créer une nouvelle application
3. Ajouter `http://localhost:3000/callback` comme **Redirect URI**
4. Noter le **Client ID** et le **Client Secret**

### 2. Configurer les variables d'environnement

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Éditer `backend/.env` :

```env
SPOTIFY_CLIENT_ID=votre_client_id
SPOTIFY_CLIENT_SECRET=votre_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
FRONTEND_URL=http://localhost:3000

# Pré-chargement en arrière-plan (optionnel)
MIX_PREFETCH_CONCURRENCY=2        # Max concurrent downloads
MIX_PREFETCH_MAX_TRACKS=80        # Max tracks to prefetch per playlist
```

Éditer `frontend/.env.local` :

```env
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=votre_client_id
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/callback
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3. Lancer avec Docker Compose

```bash
docker compose up -d --build
```

Ouvrir **[http://localhost:3000](http://localhost:3000)** 🎉

```bash
# Voir les logs
docker compose logs -f

# Arrêter
docker compose down
```

<details>
<summary><b>📦 Installation sans Docker</b></summary>

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Installer ffmpeg : apt install ffmpeg (Linux) / brew install ffmpeg (Mac)
cp .env.example .env
# Éditer .env
uvicorn main:app --reload --port 8000
```

#### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
# Éditer .env.local
npm run dev
```

</details>

---

## 🎵 Algorithmes

### Scoring de transition

Chaque paire de pistes est évaluée sur 5 critères pondérés :

| Critère          | Poids | Logique                                                                       |
| ---------------- | ----- | ----------------------------------------------------------------------------- | --- | ---- |
| **BPM**          | 25%   | ±3 BPM = parfait, dégradation linéaire jusqu'à ±15. Double/half-time supporté |
| **Tonalité**     | 25%   | Distance Camelot Wheel : 0 pas = 1.0, 1 = 0.9, 2 = 0.7, 3 = 0.4               |
| **Énergie**      | 20%   | Flux positionnel : arc, montée, descente, plateau                             |
| **Année**        | 20%   | ±2 ans = 1.0, dégradation linéaire jusqu'à ±20 ans                            |
| **Danceabilité** | 10%   | Score de similarité : `1 −                                                    | Δ   | × 3` |

### Génération de set (Beam Search)

```
1. Sélection du morceau d'ouverture selon la courbe d'énergie
2. Pour chaque étape :
   → Évaluer tous les candidats restants (scoring multi-critères)
   → Garder les K meilleurs chemins parallèles (beam_width = 5)
3. Retourner le chemin avec le meilleur score cumulé
```

### Découpe intelligente des pistes

Quand une durée cible est définie, chaque piste est analysée pour trouver le meilleur extrait :

1. **Énergie RMS** — fenêtre glissante, favorise les passages à haute énergie
2. **Présence vocale** — ratio spectral dans la bande 300–3500 Hz (spectrogramme mel)
3. **Scoring combiné** — bonus vocal ×1.5, pénalité intro/outro, bonus frontières naturelles

### Styles de transition

| Style         | Technique                       | Courbe              |
| ------------- | ------------------------------- | ------------------- |
| **Crossfade** | Fondu croisé standard           | Triangle / Triangle |
| **Fade**      | Fondu sortie puis entrée        | Exponentiel         |
| **Cut**       | Enchaînement direct (50ms)      | —                   |
| **Echo**      | Queue réverbérée                | Log / Quadratic sin |
| **Beatmatch** | Fondu lissé equal-power         | Quadratic sin       |
| **Auto**      | Analyse BPM + énergie par paire | Adaptatif           |

---

## 📁 Structure du projet

```
blendeck/
├── docker-compose.yml
├── backend/
│   ├── main.py                    # FastAPI app + routers
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── core/config.py             # Configuration (env vars)
│   ├── models/track.py            # Pydantic models
│   ├── routers/
│   │   ├── auth.py                # Authentification OAuth Spotify
│   │   ├── playlists.py           # Playlists, tracks, analyse SSE
│   │   ├── sort.py                # Tri & génération de set
│   │   ├── export.py              # Export, mix SSE, download, historique
│   │   └── admin.py               # Admin panel - gestion du cache
│   └── services/
│       ├── audio_analyzer.py      # Analyse librosa (BPM, key, energy...)
│       ├── camelot.py             # Camelot Wheel
│       ├── deezer.py              # BPM hint & previews
│       ├── features_cache.py      # Cache JSON persistant
│       ├── mix_generator.py       # Pipeline de mix complet
│       ├── set_generator.py       # Beam search DJ set
│       ├── spotify.py             # Client Spotify + SSE analysis
│       └── transition.py          # Scoring de transition (5 critères)
├── frontend/
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│       ├── app/
│       │   ├── page.tsx           # Liste des playlists       │   ├── admin/             # Panel admin de cache│       │   ├── playlist/[id]/     # Page playlist (analyse, tri, mix)
│       │   ├── login/             # Page de connexion
│       │   └── callback/          # OAuth callback
│       ├── components/
│       │   ├── TrackTable.tsx      # Table de pistes (drag & drop)
│       │   ├── ExportMenu.tsx      # Export + mix settings
│       │   ├── MixHistory.tsx      # Historique + lecteur audio
│       │   ├── EnergyChart.tsx     # Graphique d'énergie
│       │   ├── SetGeneratorPanel.tsx
│       │   ├── TransitionBadge.tsx
│       │   └── AnalysisProgress.tsx
│       ├── lib/
│       │   ├── api.ts             # Client API + SSE handlers
│       │   └── spotify-auth.ts    # PKCE auth flow
│       └── types/
│           └── global.d.ts
```

---

## 🔌 API

| Méthode  | Endpoint                         | Description                                |
| -------- | -------------------------------- | ------------------------------------------ |
| `GET`    | `/api/playlists`                 | Liste des playlists de l'utilisateur       |
| `GET`    | `/api/playlists/{id}/tracks`     | Pistes avec features audio                 |
| `GET`    | `/api/playlists/{id}/analyze`    | Analyse SSE temps réel                     |
| `POST`   | `/api/sort-playlist/{id}`        | Tri par critère                            |
| `POST`   | `/api/generate-set/{id}`         | Génération de set DJ                       |
| `POST`   | `/api/export/mix`                | Génération de mix SSE                      |
| `GET`    | `/api/export/mix/{id}`           | Téléchargement du mix MP3                  |
| `GET`    | `/api/export/mix/{id}/stream`    | Streaming du mix (lecture en ligne)        |
| `GET`    | `/api/export/mix-history`        | Historique des mix par playlist            |
| `GET`    | `/api/export/transition-preview` | Preview de transition entre deux pistes    |
| `POST`   | `/api/export/new-playlist`       | Créer une nouvelle playlist                |
| `POST`   | `/api/export/reorder`            | Réorganiser une playlist                   |
| `POST`   | `/api/export/file`               | Export CSV/JSON                            |
| `GET`    | `/admin`                         | Panel admin de gestion du cache            |
| `GET`    | `/api/admin/cache-overview`      | Statistiques du cache global               |
| `GET`    | `/api/admin/cached-tracks`       | Liste des pistes en cache (sources mixtes) |
| `GET`    | `/api/admin/cached-track/{id}`   | Streaming d'une piste en cache             |
| `DELETE` | `/api/admin/cached-track/{id}`   | Suppression d'une piste en cache           |
| `POST`   | `/api/admin/clear-cache`         | Nettoyage du cache par scope               |
| `GET`    | `/api/auth/me`                   | Profil utilisateur courant (cached 30min)  |

---

## 💾 Gestion du Cache

### Structure du Cache

```
/app/cache/
├── tracks/              # Fichiers MP3 complets (mix + pistes complètes)
├── previews/            # Previews 30s depuis YouTube Music
├── mixes/               # Mix générés (MP3)
├── audio_features.json  # Cache des features Spotify (BPM, key, energy...)
├── preview_urls.json    # URLs des previews par track_id
├── track_meta.json      # Métadonnées des pistes
└── history.json         # Historique des mix par playlist
```

### Panel Admin

Accédez au panel d'administration à **[http://localhost:3000/admin](http://localhost:3000/admin)** (rôle admin requis).

**Fonctionnalités :**

- 📊 Vue d'ensemble : taille totale, nombre de fichiers par scope
- 🎵 Liste des pistes en cache : originales ET previews
- ▶️ Play/pause pour tester les fichiers en cache
- 🗑️ Suppression individuelle (source-aware)
- 🧹 Nettoyage par scope (tracks, mixes, transitions, metadata)

### Pré-chargement en Arrière-Plan

Lors du chargement d'une playlist, les musiques sont pré-téléchargées en arrière-plan sans bloquer l'interface :

- **Limité à 80 pistes** (configurable via `MIX_PREFETCH_MAX_TRACKS`)
- **Concurrence max 2** téléchargements simultanés (configurable via `MIX_PREFETCH_CONCURRENCY`)
- **TTL 30 min** pour le cache Spotify API (`/v1/me`, `/v1/me/playlists`)

Variables d'environnement dans `backend/.env` :

```env
MIX_PREFETCH_CONCURRENCY=2        # Max concurrent downloads
MIX_PREFETCH_MAX_TRACKS=80        # Max tracks to prefetch per playlist
```

---

## 📦 Versioning

Le projet utilise un système automatique de versioning basé sur les commits Git.

```bash
# Générer la version depuis le nombre de commits (recommandé)
./scripts/update-version-from-git.sh

# Ou faire un bump manuel (major/minor/patch)
./scripts/bump-version.sh patch
```

La version est mise à jour dans :

- `VERSION` (source unique)
- `backend/main.py`
- `frontend/package.json`
- `frontend/package-lock.json`

Voir **[VERSIONING.md](VERSIONING.md)** pour plus de détails.

---

Ce projet est fourni **à des fins éducatives et pour un usage personnel uniquement**. Il n'est pas monétisé et ne génère aucun revenu.

La fonctionnalité de génération de mix MP3 télécharge des pistes audio depuis YouTube Music via yt-dlp. Cela peut constituer une violation des conditions d'utilisation de YouTube et des lois sur le droit d'auteur dans votre juridiction.

**En utilisant ce logiciel, vous reconnaissez que :**

- Vous êtes seul responsable du respect des lois applicables dans votre pays
- Ce projet ne doit pas être utilisé pour distribuer de la musique protégée par le droit d'auteur
- Les mix générés sont destinés à un **usage strictement personnel**
- Les fichiers audio sont temporaires et automatiquement nettoyés
- Les développeurs déclinent toute responsabilité quant à l'usage qui est fait de ce logiciel

---

## 📝 License

MIT
