# Rapport d'analyse — Problèmes de facturation (Régénération & Suppression)

**Date:** 2026-04-03  
**Fichiers analysés:**
- `backend/app/routers/invoices_approved.py`
- `backend/app/routers/invoices.py`
- `backend/app/routers/invoices_bulk.py`
- `backend/app/models/models_invoice.py`
- `frontend/src/pages/SchedulesPage.jsx`
- `frontend/src/pages/InvoicesPage.jsx`
- `frontend/src/utils/api.js`

---

## Problème 1 : La régénération d'une facture pour une période déjà facturée échoue

### Symptôme
Quand l'utilisateur clique sur **"Générer la facture approuvée"** dans l'onglet Horaires pour une période qui a déjà été facturée, l'erreur suivante apparaît :
> *"Erreur génération: Impossible de joindre le serveur. Vérifiez que le backend est démarré."*

### Cause racine

**Le backend retourne HTTP 400 (pas une erreur serveur) mais le frontend masque le vrai message.**

#### Côté backend (`invoices_approved.py`, lignes 62-64) :
```python
existing = await db.execute(
    select(Invoice).where(
        Invoice.employee_id == employee_id,
        Invoice.client_id == effective_client_id,
        Invoice.period_start == ps,
        Invoice.period_end == pe,
        Invoice.status != 'cancelled'
    )
)
if existing.scalar_one_or_none():
    raise HTTPException(400, 'Une facture existe déjà pour cet employé/client/période')
```

C'est une **vérification intentionnelle de doublon** — le backend refuse de créer une facture si une facture non-annulée existe déjà pour le même employé/client/période. **Ce comportement est correct.**

#### Côté frontend (`SchedulesPage.jsx`, ligne 114-115) :

**Pour le bouton individuel "Générer la facture approuvée"** (ligne 114) :
```javascript
} catch (err) {
    const msg = err.message || 'Erreur réseau';
    toast?.('Erreur: ' + (msg.includes('fetch') ? 'Impossible de joindre le serveur.' : msg));
}
```

**Pour le bouton "Générer toutes les factures approuvées"** (ligne 115) :
```javascript
} catch (err) {
    const msg = err.message || 'Erreur réseau';
    toast?.('Erreur génération: ' + (msg.includes('fetch') ? 
        'Impossible de joindre le serveur. Vérifiez que le backend est démarré.' : msg));
}
```

**Le problème:** L'utilitaire `api.post()` (via `api.js`) fait probablement un `fetch()` qui, en cas d'erreur HTTP 400, lance une erreur dont le `message` peut contenir le mot `"fetch"` ou être une chaîne générique. Le code frontend vérifie `msg.includes('fetch')` pour détecter une erreur réseau, mais cette heuristique est trop large et capture aussi les erreurs HTTP valides.

De plus, il y a **deux flux différents** pour la génération individuelle vs bulk :
- **Individuel** appelle `api.generateFromSchedules()` → endpoint `/api/invoices-approved/generate-from-approved-schedules`
- **Bulk** appelle `api.generateAllApprovedInvoices()` → endpoint `/api/invoices-approved/generate-all-approved-schedules`

Le **bulk endpoint** (lignes 150-175) gère correctement les doublons en les ajoutant à `skipped[]` via un try/catch. Le toast affiche alors `"0 facture(s) approuvée(s) générée(s) (X ignorée(s))"`.

Le **endpoint individuel** (ligne 43-147) lance directement une `HTTPException(400)` qui est mal gérée par le frontend.

### Correction recommandée

1. **Frontend** — Corriger la gestion d'erreur dans `generateInvoice()` pour afficher le vrai message d'erreur du backend au lieu de "Impossible de joindre le serveur":
```javascript
} catch (err) {
    const msg = err.message || 'Erreur réseau';
    // Ne masquer que les vraies erreurs réseau (TypeError: Failed to fetch)
    if (msg === 'Failed to fetch' || msg === 'NetworkError when attempting to fetch resource.') {
        toast?.('Erreur: Impossible de joindre le serveur.');
    } else {
        toast?.('Erreur: ' + msg);
    }
}
```

2. **Backend (optionnel)** — Si on veut permettre la régénération, il y a deux options :
   - **Option A** : Supprimer automatiquement l'ancienne facture avant de créer la nouvelle (risqué si la facture a déjà été envoyée/payée)
   - **Option B** : Ne bloquer la régénération que si la facture existante est dans un état non-modifiable (`sent`, `paid`, `partially_paid`), et permettre la régénération si elle est en `draft` ou `validated`

---

## Problème 2 : La suppression de factures échoue (ou est bloquée)

### Symptôme
Lors de la tentative de suppression d'une facture dans l'onglet Facturation, un message d'erreur apparaît. Le screenshot `image (3).png` montre le message *"1 facture(s) approuvée(s) générée(s)"* qui est le toast de succès du bulk generate, pas une erreur de suppression.

### Analyse de la logique de suppression

#### Suppression individuelle (`invoices.py`, lignes 623-655) :
```python
if invoice.status not in (InvoiceStatus.DRAFT.value, InvoiceStatus.CANCELLED.value):
    raise HTTPException(400, "Seules les factures brouillon ou annulées peuvent être supprimées")
```

**Restriction clé :** Seules les factures avec statut `draft` ou `cancelled` peuvent être supprimées.

Or, les factures générées via "Générer la facture approuvée" ont le statut **`validated`** (ligne 130 de `invoices_approved.py`). Cela signifie que :
- **Les factures approuvées ne peuvent PAS être supprimées directement** car elles sont créées en statut `validated`, pas `draft`.
- L'utilisateur doit d'abord **annuler** la facture (`PUT /{id}/cancel`), puis la supprimer.

#### Suppression bulk (`invoices_bulk.py`, lignes 20-44) :
Même restriction — ne supprime que les factures `draft` ou `cancelled`. Les factures `validated` sont ajoutées à `skipped[]`.

### Cause racine

La suppression échoue parce que les factures générées depuis les horaires approuvés sont créées directement en statut **`validated`**, et la suppression n'est autorisée que pour les statuts **`draft`** ou **`cancelled`**.

### Corrections recommandées

1. **Option A (recommandée)** — Permettre aussi la suppression des factures `validated` :
```python
if invoice.status not in ('draft', 'cancelled', 'validated'):
    raise HTTPException(400, "Seules les factures brouillon, validées ou annulées peuvent être supprimées")
```

2. **Option B** — Ajouter un workflow d'annulation+suppression dans le frontend (bouton "Annuler et supprimer").

3. **Option C** — Créer les factures en statut `draft` au lieu de `validated` dans `invoices_approved.py` (mais cela change le workflow actuel).

---

## Problème 3 : Conflit de routes entre `invoices.py` et `invoices_bulk.py`

Les deux fichiers sont montés sur le même préfixe `/api/invoices` :
```python
app.include_router(invoices.router, prefix="/api/invoices")
app.include_router(invoices_bulk.router, prefix="/api/invoices")
```

Et les deux définissent une route `/bulk/delete` ou `/bulk-delete` :
- `invoices.py` : `@router.post("/bulk/delete")` et `@router.post("/bulk-delete")` (lignes 1313-1314)
- `invoices_bulk.py` : `@router.post('/bulk-delete')` (ligne 20)

Cela peut créer des **conflits de routes** imprévisibles. FastAPI utilise la première route correspondante, donc selon l'ordre d'inclusion, l'une des deux sera ignorée.

### Correction recommandée
- Supprimer les routes bulk de `invoices.py` (lignes 1313+) puisqu'elles existent déjà dans `invoices_bulk.py`.
- OU supprimer `invoices_bulk.py` et garder tout dans `invoices.py`.

---

## Problème 4 : Erreur "Impossible de joindre le serveur" dans l'onglet Horaires

### Symptôme
Le screenshot `image (2).png` montre l'erreur au bas de la page Horaires :
> *"Erreur génération: Impossible de joindre le serveur. Vérifiez que le backend est démarré."*

### Cause racine
C'est le **même problème que le #1**. Le bouton "Générer toutes les factures approuvées" (en haut de la page) tente de générer les factures pour TOUTES les semaines approuvées. Si **une seule** des générations échoue (ex: facture déjà existante), le catch global intercepte l'erreur et affiche ce message trompeur.

En regardant le code du bulk endpoint (lignes 150-175), il gère bien les erreurs individuellement et fait un `rollback` par approbation échouée. Le problème est que le `rollback` dans la boucle peut corrompre la session pour les itérations suivantes, causant une erreur inattendue qui remonte au frontend comme une erreur de connexion.

### Correction recommandée
- Utiliser une sous-transaction (savepoint) au lieu d'un rollback complet dans la boucle du bulk generate.

---

## Résumé des changements requis

| # | Fichier | Changement | Priorité |
|---|---------|-----------|----------|
| 1 | `frontend/src/pages/SchedulesPage.jsx` | Corriger la gestion d'erreur pour afficher le vrai message (lignes 114-115) | 🔴 Haute |
| 2 | `backend/app/routers/invoices.py` | Permettre la suppression des factures `validated` (ligne 640) | 🔴 Haute |
| 3 | `backend/app/routers/invoices_bulk.py` | Permettre la suppression bulk des factures `validated` (ligne 26) | 🔴 Haute |
| 4 | `backend/app/routers/invoices_approved.py` | (Optionnel) Permettre la régénération en remplaçant la facture existante en `draft`/`validated` | 🟡 Moyenne |
| 5 | `backend/app/routers/invoices.py` | Supprimer les routes bulk dupliquées (lignes 1313+) | 🟡 Moyenne |
| 6 | `backend/app/routers/invoices_approved.py` | Utiliser des savepoints dans le bulk generate (lignes 166-174) | 🟡 Moyenne |

---

## Schéma de la base de données

Aucun changement de schéma n'est nécessaire. Le modèle `Invoice` a des index sur `(client_id, period_start, period_end)` et `(employee_id, period_start, period_end)` mais **pas de contrainte UNIQUE** sur ces combinaisons. La vérification de doublon est faite **uniquement au niveau applicatif** (dans le code Python), ce qui est suffisant.
