# Soins Expert Plus — Plateforme de gestion du personnel de santé

> 9437-7827 Québec Inc. / Gestion Taief Inc.

## Architecture

```
soins-expert-plus/
├── backend/                    # FastAPI + PostgreSQL
│   ├── app/
│   │   ├── main.py            # App entry point
│   │   ├── database.py        # Async SQLAlchemy + PostgreSQL
│   │   ├── models/
│   │   │   ├── models.py      # SQLAlchemy models
│   │   │   └── schemas.py     # Pydantic schemas
│   │   ├── routers/
│   │   │   ├── auth.py        # JWT + magic link auth
│   │   │   ├── employees.py   # CRUD + notes
│   │   │   ├── schedules.py   # CRUD + recurrence
│   │   │   ├── timesheets.py  # Submit/approve/reject
│   │   │   ├── invoices.py    # CRUD + tax calc
│   │   │   ├── accommodations.py
│   │   │   ├── clients.py
│   │   │   └── chatbot.py     # Claude Sonnet integration
│   │   └── services/
│   │       ├── auth_service.py # JWT, bcrypt, magic tokens
│   │       └── email_service.py # SMTP emails
│   ├── seed.py                # Initial data seeding
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── UI.jsx         # Modal, Badge, Avatar, Sidebar
│   │   │   └── ChatWidget.jsx # Floating Claude chatbot
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── SchedulesPage.jsx
│   │   │   ├── EmployeesPage.jsx
│   │   │   ├── TimesheetsPage.jsx
│   │   │   ├── InvoicesPage.jsx
│   │   │   └── AccommodationsPage.jsx
│   │   ├── hooks/
│   │   │   ├── useAuth.jsx
│   │   │   └── useToast.js
│   │   ├── utils/
│   │   │   ├── api.js         # API client with auth
│   │   │   └── helpers.js     # Formatting, constants
│   │   └── styles/
│   │       └── global.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── render.yaml                 # Render.com deployment blueprint
```

## Développement local

### Prérequis
- Python 3.12+
- Node.js 18+
- PostgreSQL 15+

### Backend

```bash
cd backend

# Créer la DB
createdb soins_expert

# Installer les dépendances
pip install -r requirements.txt

# Seeder la base de données
python seed.py

# Lancer le serveur
uvicorn app.main:app --reload --port 10000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Le frontend tourne sur http://localhost:5173 avec proxy vers le backend.

### Connexion initiale
- **Admin**: rh@soins-expert-plus.com / admin2026!

## Déploiement Render.com

### Option 1 : Blueprint (recommandé)

1. Push le code sur GitHub
2. Sur Render.com → **New Blueprint Instance**
3. Connecter le repo GitHub
4. Render détecte `render.yaml` et crée automatiquement :
   - Backend (Web Service, Docker)
   - Frontend (Static Site)
   - PostgreSQL (Database)
5. Configurer les variables d'environnement manuelles :
   - `ANTHROPIC_API_KEY` → ta clé API Anthropic
   - `SMTP_PASS` → mot de passe SMTP
6. Seeder la DB : `render run --service soins-expert-api python seed.py`

### Option 2 : Manuel

1. **Database** : New PostgreSQL → copier l'Internal Database URL
2. **Backend** : New Web Service → Docker, pointer vers `/backend`
3. **Frontend** : New Static Site → build command `cd frontend && npm install && npm run build`, publish dir `frontend/dist`

## Fonctionnalités

### Portail Admin (rh@soins-expert-plus.com)
- Grille horaire Dim→Sam avec récurrence et dépenses
- Gestion des employés avec notes horodatées
- Feuilles de temps (garde 8h=1h, rappel, pause)
- Facturation avec TPS/TVQ, aperçu client, modification post-sauvegarde
- Hébergement par jour travaillé
- Chatbot Claude intégré (panneau flottant)
- Auth : mot de passe + magic link

### Portail Employé (courriel perso)
- Voir son horaire publié seulement
- Auth : magic link par courriel

## Taux et constantes
- Infirmière : 86.23$/h
- Inf. auxiliaire : 57.18$/h
- PAB : 50.35$/h
- Garde : 8h = 1h facturable × 86.23$/h
- Kilométrage : 0.525$/km
- TPS : 5% | TVQ : 9.975%
- Clients exemptés : Conseil Cri, Centre Inuulitsivik
