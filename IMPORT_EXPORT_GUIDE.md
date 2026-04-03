# Guide Import/Export CSV/Excel — Horaires

## Vue d'ensemble

Fonctionnalité d'import et d'export de quarts de travail au format CSV et Excel (.xlsx) ajoutée à la page **Horaires** de Soins Expert Plus.

---

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `backend/app/routers/schedules.py` | Ajout des endpoints `POST /api/schedules/import-csv` et `GET /api/schedules/export-csv` |
| `backend/requirements.txt` | Ajout de `pandas>=2.0` et `openpyxl>=3.1` |
| `frontend/src/pages/SchedulesPage.jsx` | Ajout des boutons Importer/Exporter + modals avec drag-and-drop |

---

## Import CSV/Excel

### Endpoint
```
POST /api/schedules/import-csv
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

### Colonnes CSV attendues (format AgendRH)
| Colonne CSV | Champ Schedule | Notes |
|-------------|---------------|-------|
| `Prénom` + `Nom` | → lookup `employee_id` | Correspondance par nom complet |
| `Date_du_quart` | `date` | Format YYYY-MM-DD |
| `Heure_debut` | `start` | "7:00" → "07:00" |
| `Heure_fin` | `end` | "15:15" → "15:15" |
| `Heures_travaillees` | `hours` | Float |
| `Taux_horaire` | `billable_rate` | Float |
| `Lieu` + `Sous_lieu` | `location` | Concaténés avec " - " |
| `Lieu` | → lookup `client_id` | Correspondance partielle par nom de client |
| `Statut` | `status` | "quart assigné" → "published", "annulé" → ignoré |
| `Note`, `Note_employe`, `Note_interne` | `notes` | Concaténés avec "; " |

### Comportement
- **Import partiel** : les lignes invalides sont ignorées, les valides sont importées
- **Quarts annulés** : les lignes avec statut contenant "annul" sont automatiquement ignorées
- **Encodage** : UTF-8 auto-détecté, fallback vers Latin-1
- **Formats supportés** : `.csv`, `.xlsx`, `.xls`

### Réponse
```json
{
  "success": 5200,
  "errors": 42,
  "total_rows": 5692,
  "error_details": [
    { "row": 15, "error": "Employé introuvable: Jean Tremblay" }
  ],
  "message": "5200 quarts importés avec succès, 42 erreurs"
}
```

---

## Export CSV/Excel

### Endpoint
```
GET /api/schedules/export-csv?date_start=2025-01-01&date_end=2026-07-31&format=csv
Authorization: Bearer <token>
```

### Paramètres de filtre (tous optionnels)
| Paramètre | Description |
|-----------|-------------|
| `date_start` | Date de début (YYYY-MM-DD) |
| `date_end` | Date de fin (YYYY-MM-DD) |
| `employee_id` | ID de l'employé |
| `client_id` | ID du client |
| `format` | `csv` (défaut) ou `xlsx` |

### Colonnes exportées
Prénom, Nom, Employé_ID, Courriel, Date, Début, Fin, Heures, Pause, Taux horaire, Lieu, Client, Client_ID, KM, Déplacement, Autre dépense, Heures garde, Heures rappel, Statut, Notes

---

## Interface utilisateur

### Boutons dans l'en-tête de la page Horaires
- **📤 Importer** : ouvre un modal avec zone de glisser-déposer pour fichiers CSV/Excel
- **📥 Exporter** : ouvre un modal avec filtres de date, employé, client et choix de format

### Import Modal
- Zone de drag-and-drop ou clic pour sélectionner un fichier
- Bouton d'import avec indicateur de progression
- Affichage des résultats (succès/erreurs) avec détails des erreurs ligne par ligne

### Export Modal
- Filtres : date début, date fin, employé, client
- Choix du format : CSV ou Excel (.xlsx)
- Téléchargement automatique du fichier

---

## Validation et gestion d'erreurs

1. **Employé introuvable** : correspondance par nom complet (prénom + nom) avec recherche inversée et partielle
2. **Date invalide** : supporte YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
3. **Heures de temps** : normalisation automatique (ex: "7:00" → "07:00")
4. **Client** : correspondance partielle par nom de lieu, fallback vers le client par défaut de l'employé
5. **Fichier illisible** : message d'erreur clair retourné à l'utilisateur
