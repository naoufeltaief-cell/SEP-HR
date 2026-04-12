# HANDOFF — FDT → Schedule → Invoice workflow

**Pour : l'autre LLM qui prend la suite**
**De : Claude (session du 12 avril 2026)**
**Repo : github.com/naoufeltaief-cell/SEP-HR**
**Dernier commit stable : `9ac9e48`**

---

## Le contexte en 30 secondes

Nao (propriétaire de Soins Expert Plus) a un chatbot de facturation qui lit les FDT (feuilles de temps) manuscrites envoyées par ses employés nurses/PAB et génère des factures pour les CISSS/CIUSSS clients.

**Bug critique observé en prod aujourd'hui :** quand l'utilisateur joint une FDT et demande une facture, l'agent appelle `generate_current_invoice_for_employee` qui lit l'horaire existant dans la DB **au lieu** de la FDT. Résultat : facture avec les mauvaises dates, mauvaises heures, mauvais pauses, mauvaise période — et l'agent prétend l'avoir fait à partir de la FDT. Exemple concret : FDT couvre 29 mars – 4 avril 2026, facture générée pour 12-18 avril 2026 avec des quarts complètement différents.

## Ce qui a déjà été fait dans cette session

**Commit `798010f` — Fixes de base :**
- `_render_pdf_pages_png` rend maintenant jusqu'à 3 pages d'un PDF (avant : page 1 seulement, les FDT bi-hebdo perdaient la semaine 2)
- `extract_timesheet_shift_summary` lève une erreur claire si `OPENAI_API_KEY` manque au lieu de retourner `{}` en silence
- `analyze_chat_session_documents` dans `chatbot.py` wrappé en try/except pour que les erreurs OpenAI remontent au chat
- Défaut de modèle changé de `gpt-5.4-mini` (qui ne marchait pas sur ce compte) à `gpt-4o`

**Commit `9ac9e48` — Durcissement des prompts :**
- `AGENT_FACTURATION_PROMPT` contient maintenant une règle explicite en 4 étapes pour le workflow FDT→facture
- Le prompt référence l'outil `apply_timesheet_to_schedule` **qui n'existe pas encore** — le prompt dit explicitement à l'agent de s'arrêter et de demander une intervention manuelle tant qu'il n'est pas dispo. C'est intentionnel : mieux vaut un refus honnête qu'une fausse facture.
- Le prompt vision dans `extract_timesheet_shift_summary` explique maintenant le format de date YY/MM/DD (les FDT écrivent `26/03/29` = 29 mars 2026, pas 26 mars 2029)

**Ta mission : implémenter `apply_timesheet_to_schedule`.**

## Les décisions métier déjà validées par Nao

1. **Calcul des heures** : il y a déjà un calculateur dans l'interface Horaire. Tu saisis start + end + pause, il calcule `hours` automatiquement. Dans le code, c'est `_calculate_schedule_hours(start, end, pause_hours)` dans `chatbot.py`. **Ne pas redévelopper de formule**, utiliser cette fonction.

2. **Source de vérité des heures** : le champ `hours` dans la table `schedules` est la source de vérité pour la facturation (`invoice_service.py:255` fait `getattr(s, "hours", 0)`). Le "TOTAL HEURES RÉG." écrit à la main par la ressource sur la FDT est ignoré — on recalcule.

3. **Cas "case barrée sur la FDT mais quart existe dans l'horaire"** : Nao veut **marquer le quart comme annulé/non travaillé mais le garder pour traçabilité** (option B). Ne PAS supprimer. Mettre `status='cancelled'` ou un équivalent. Vérifier quels status valides existent dans `Schedule` — regarder `models.py` et les valeurs passées par `create_schedule_shift` (par défaut `'published'`).

4. **Confirmation humaine obligatoire** : tout changement à l'horaire via une FDT doit être proposé en `dry_run` d'abord, présenté clairement à l'utilisateur, et appliqué seulement après confirmation explicite.

5. **Le client n'est pas sur la FDT** : le champ "ÉTABLISSEMENT : lieu de travail" est souvent vide sur les FDT (vu sur la FDT de Joyce). Le `client_id` doit être résolu autrement : soit (a) depuis l'horaire existant pour l'employé à cette période, soit (b) depuis le `client_id` par défaut de l'employé (`Employee.client_id`), soit (c) l'agent demande à l'utilisateur. Priorité : a > b > c.

6. **Format de dates** : Les FDT peuvent écrire les dates en `AA/MM/JJ` (ex: `26/03/29` = 2026-03-29) ou `JJ/MM/AA`. Se fier au champ "Semaine du X au Y" en haut du formulaire pour déterminer le format et l'année. Le prompt vision a été mis à jour pour retourner les dates en ISO `AAAA-MM-JJ`, donc normalement tu les reçois déjà propres. Mais prévoir une validation défensive côté Python au cas où le modèle se trompe.

## Spec de l'outil à implémenter

### Nom : `apply_timesheet_to_schedule`

### Paramètres d'entrée (tool schema)

```python
{
    "name": "apply_timesheet_to_schedule",
    "description": "Appliquer les quarts extraits d'une FDT jointe dans le chat aux horaires de l'employe. Compare chaque quart de la FDT avec les quarts existants dans la meme periode, puis propose ou applique un diff: creations, modifications d'heures/pause, annulations (cases barrees). Toujours utiliser dry_run=True d'abord pour presenter le diff a l'utilisateur avant d'appliquer.",
    "input_schema": {
        "type": "object",
        "properties": {
            "document_id": {"type": "string", "description": "ID du document FDT uploade dans la session (si plusieurs docs joints)"},
            "employee_id": {"type": "integer"},
            "employee_name": {"type": "string"},
            "client_id": {"type": "integer", "description": "Client par defaut si non resolu depuis l'horaire existant"},
            "client_name": {"type": "string"},
            "dry_run": {"type": "boolean", "default": True, "description": "Si True, retourne seulement le diff sans modifier la base"}
        },
        "required": []
    }
}
```

### Algo (pseudocode)

```
1. Trouver le document FDT cible dans la session chatbot
   - Si document_id fourni: _get_chat_session_uploads puis filtrer par ID
   - Sinon: prendre le premier upload qui ressemble à une FDT
   - Si aucun: return "Aucune FDT dans cette conversation"

2. Analyser la FDT pour extraire les quarts
   - Appeler summarize_explicit_timesheet_documents(db, [_chat_upload_to_document(upload)], employee=..., raise_on_openai_error=True)
   - wrap try/except — retourner l'erreur claire en cas d'échec
   - Extraire: employee_name, period_start, period_end, shifts[]
   - Chaque shift contient déjà: date (ISO), start, end, pause_minutes, hours (estimée par le modèle — à recalculer), type, unit, approver_name, notes

3. Résoudre l'employé
   - Si employee_id/employee_name fournis en input: _find_employee direct
   - Sinon: utiliser summary.employee_name pour matcher via _find_employee ou match_employee_from_email
   - Si échec: return "Employe introuvable pour cette FDT"

4. Résoudre le client
   - Priorité 1: chercher les Schedule existants pour cet employé sur la période period_start..period_end et prendre le client_id dominant
   - Priorité 2: Employee.client_id
   - Priorité 3: input_data client_id/client_name
   - Si aucun: return "Impossible de determiner le client pour cette FDT — fournir client_id ou client_name en parametre"

5. Charger les schedules existants dans la période
   - SELECT * FROM schedules WHERE employee_id = X AND date BETWEEN period_start AND period_end

6. Pour chaque shift de la FDT:
   a. Normaliser date (ISO), start (HH:MM), end (HH:MM), pause_hours = pause_minutes / 60
   b. Recalculer hours via _calculate_schedule_hours(start, end, pause_hours) — ignorer le shift.hours du modèle
   c. Chercher un schedule existant avec la même date (et si ambigu, le plus proche en start)
   d. Classifier l'action:
      - Aucun match → CREATE (nouveau quart)
      - Match exact (start, end, pause tous identiques) → SKIP (rien à faire)
      - Match avec start/end/pause différents → UPDATE
      - shift.type == "cancelled" ou ligne barrée → MARK_CANCELLED sur le match existant (sinon SKIP si pas de match)
   e. Ajouter à la liste diff[]

7. Pour chaque schedule existant qui n'a PAS de shift correspondant dans la FDT:
   - Si la FDT contient explicitement une ligne barrée pour cette date → déjà traité en étape 6
   - Sinon → ajouter à diff[] comme "ORPHAN: quart dans horaire mais absent de la FDT, vérification humaine requise"
   - Ne PAS supprimer automatiquement — Nao veut garder pour traçabilité

8. Si dry_run=True:
   - Formater le diff en texte lisible type:
     ```
     📋 Diff FDT → Horaire pour Joyce Fuamba, période 29/03/2026 au 04/04/2026

     ➕ CRÉER (0):
     ✏️ MODIFIER (2):
       - 2026-03-29: 06:45-15:05 pause 45min → 7.58h (actuellement: 07:00-15:15 pause 0min, 8.25h)
       - 2026-04-03: pause 45min → 7.58h (actuellement: pause 60min, 7.25h)
     🚫 ANNULER (1):
       - 2026-03-31: marquer comme non-travaillé (case barrée sur FDT)
     ⚠️ ORPHELINS (0):
     ✅ INCHANGÉS (3):

     Total avant: 45.5h | Total après: 45.48h
     Veux-tu que j'applique ces changements ?
     ```
   - Return ce texte, ne rien modifier en DB

9. Si dry_run=False:
   - Pour chaque action dans diff[]:
     - CREATE: créer un Schedule (réutiliser le pattern de create_schedule_shift handler lignes 1640-1682)
     - UPDATE: setattr sur le Schedule existant (réutiliser le pattern de update_schedule_shift lignes 1683-1744)
     - MARK_CANCELLED: setattr(schedule, 'status', 'cancelled') + note "Annulé via FDT du {date_today}"
   - commit une seule fois à la fin
   - Return un résumé: "X créations, Y modifications, Z annulations appliquées. Période 29/03 au 04/04. Tu peux maintenant appeler generate_invoice_for_employee avec period_start='2026-03-29' et period_end='2026-04-04'."
```

### Emplacement du code

1. **Ajouter la définition du tool** dans `RAW_TOOLS` de `backend/app/routers/chatbot.py` — juste après `analyze_chat_session_documents` (actuellement ligne ~121) pour rester groupé logiquement.

2. **Ajouter le handler** dans la boucle de dispatch des outils dans `backend/app/routers/chatbot.py`. Regarder comment les autres handlers sont structurés — chercher `if name == 'analyze_chat_session_documents':` (~ligne 1373 avant mes éditions, probablement ~1388 après). Ajouter le nouveau handler juste après.

3. **Les helpers à réutiliser** (tous dans `chatbot.py`):
   - `_get_chat_session_uploads(db, chat_session_id)` → list[ChatbotUpload]
   - `_chat_upload_to_document(upload)` → dict format attendu par timesheet_service
   - `_find_employee(db, employee_id, employee_name)` → Employee ou None
   - `_find_client(db, client_id, client_name)` → Client ou None
   - `_parse_date_value(value)` → date
   - `_normalize_time_value(value, 'start'|'end')` → str "HH:MM"
   - `_calculate_schedule_hours(start, end, pause_hours)` → float
   - `_serialize_schedule(schedule, employee_name, client_name)` → dict
   - `_get_schedule_names(db, schedule)` → (employee_name, client_name)
   - `new_id()` → str (pour l'ID du nouveau Schedule)

4. **Les imports depuis timesheet_service.py**: `summarize_explicit_timesheet_documents` est déjà importé quelque part dans `chatbot.py` — vérifier et importer si besoin.

### Structure du Schedule (modèle existant)

Fichier `backend/app/models/models.py`, chercher `class Schedule(Base)`. Les champs pertinents:
- `id` (str, uuid)
- `employee_id` (int FK)
- `client_id` (int FK, peut être NULL — bug historique connu sur anciennes lignes)
- `date` (Date)
- `start` (str "HH:MM")
- `end` (str "HH:MM")
- `hours` (float) — **source de vérité pour la facturation**
- `pause` (float, en HEURES — attention, pas en minutes)
- `billable_rate` (float)
- `status` (str) — valeurs observées: `'published'`, probablement d'autres. Vérifier dans models.py ou chercher les valeurs assignées dans le code.
- `location` (str)
- `notes` (str)
- `garde_hours`, `rappel_hours` (float)
- `km`, `deplacement`, `autre_dep` (float)

**Conversion pause FDT → schedule** : la FDT donne `pause_minutes` (ex: 45). Le Schedule stocke en `pause` (heures). Donc `pause_hours = pause_minutes / 60`. Le shift extrait par le modèle vision retourne `pause_minutes` dans le champ `pause_minutes` de chaque shift.

## Tests à faire après implémentation

1. **Test avec JOYCE_FDT_29-04.jpeg** (la FDT utilisée pour diagnostiquer le bug) :
   - Uploader dans le chat
   - Demander "lis cette FDT et applique-la à l'horaire"
   - Vérifier que dry_run retourne un diff cohérent avec période 2026-03-29 au 2026-04-04
   - Vérifier que le quart du mardi 31/03 est marqué à annuler (case barrée sur FDT)
   - Confirmer avec "oui applique"
   - Vérifier en DB que les Schedule correspondent
   - Demander une facture → vérifier qu'elle utilise bien la période 29/03 au 04/04 avec les bonnes heures

2. **Test FDT bi-hebdomadaire** (Gemima ou autre) pour vérifier que `_render_pdf_pages_png` ramène bien les 2 semaines

3. **Test de refus** : FDT avec champ illisible → l'agent doit refuser de générer la facture et demander vérification

4. **Test du cas "client pas sur FDT"** : vérifier que le fallback Schedule existant → Employee.client_id → input fonctionne

## Pattern pour pousser le commit sur GitHub

Nao t'a probablement déjà donné un PAT. Format du push :
```bash
cd /tmp/SEP-HR
git add -A
git commit -m "feat(chatbot): apply_timesheet_to_schedule tool for FDT-driven schedule updates

<détails du commit>"
git push https://naoufeltaief-cell:[PAT]@github.com/naoufeltaief-cell/SEP-HR.git main
```

**Important** : demander à Nao de révoquer le PAT après usage (Settings → Developer settings → PAT → Delete). Les PAT en clair dans un chat sont compromis par définition.

## Gotchas observés dans cette codebase

1. **Le prompt système est défini 4 fois dans `chatbot.py`** (lignes ~2008, 2012, 2028, 2059 avant mes éditions). Seule la **dernière** définition compte (elle écrase les précédentes). Éditer la bonne.

2. **`raise_on_openai_error=True`** doit être passé à `summarize_explicit_timesheet_documents` pour que les erreurs remontent. Sinon silence mortel.

3. **`_calculate_schedule_hours` attend `pause_hours` (float en heures), pas `pause_minutes`**. Bug facile à faire.

4. **Les dates dans la FDT vs l'ISO**: après le commit `9ac9e48`, le modèle vision doit retourner les dates déjà en ISO `AAAA-MM-JJ` dans le champ `date` de chaque shift. Mais prévoir un parsing défensif au cas où — utiliser `_parse_date_value`.

5. **`client_id` peut être NULL dans des Schedule existants**. Nao a débuggé ce bug récemment (voir mémoire: "schedule approve/billing buttons not appearing due to suspected NULL `client_id` values"). Ne pas supposer qu'il est toujours présent.

6. **Render déploie automatiquement sur push `main`**. Le déploiement prend 2-3 minutes. Nao peut suivre dans Render Dashboard → SEP-HR → Events.

7. **Validation syntaxe obligatoire avant push** :
   ```bash
   python -c "import ast; ast.parse(open('backend/app/routers/chatbot.py').read()); ast.parse(open('backend/app/services/timesheet_service.py').read()); print('OK')"
   ```

## Estimation de temps

Pour une session LLM concentrée avec accès au repo : **45 à 90 minutes**. Les briques existent déjà, c'est principalement de l'orchestration + la boucle de diff.

## Après ce commit

Il restera (Commit 3 éventuel) :
- Mettre à jour le `AGENT_FACTURATION_PROMPT` pour supprimer la note "cet outil n'existe pas encore" et activer le workflow complet
- Peut-être ajouter un raccourci dans le prompt général pour que l'agent comprenne "lire la FDT + générer facture" comme un workflow en une demande utilisateur

Et plus tard (Parties B et C de la conversation originale, pas encore décidées) :
- **Partie B** : extraction de frais (taxi, traversier) depuis les courriels employés → ajout automatique à la facture via `add_invoice_expense_line` qui existe déjà
- Double-lecture des FDT à enjeu pour réduire les hallucinations
- Score de confiance exposé dans la réponse du chatbot

Bonne chance. Nao est compétent, patient, communique en français québécois, préfère un diagnostic clair à une action précipitée. Il n'aime pas quand l'agent (ou l'LLM) prétend avoir fait quelque chose qu'il n'a pas vraiment fait — c'est littéralement le bug qu'on corrige ici.
