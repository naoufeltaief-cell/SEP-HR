# Demande fonctionnelle — Approbation hebdomadaire des heures et génération des factures approuvées

## Objectif
Permettre à l’administrateur de modifier, vérifier et approuver le total des quarts/heures par semaine de travail dans l’onglet **Horaire** pour chaque employé, sur une période allant du **dimanche au samedi**.

Une fois les heures validées avec les pièces justificatives, le système doit permettre de générer uniquement les **factures approuvées** à partir des heures officiellement approuvées.

---

## Besoin d’affaires
Actuellement, les données d’horaire servent de base au calcul des heures et à la facturation. Il faut ajouter un niveau de contrôle administratif afin de :

1. ajuster le total hebdomadaire des quarts/heures au besoin ;
2. joindre les preuves justificatives (feuilles de temps, factures d’hébergement, autres documents) ;
3. approuver officiellement les heures après vérification ;
4. générer des factures basées uniquement sur les heures approuvées.

---

## Comportement attendu

### 1) Modification du total hebdomadaire
Dans l’onglet **Horaire**, l’administrateur doit pouvoir :
- consulter les quarts d’un employé par semaine (**dimanche à samedi**) ;
- voir le total calculé automatiquement ;
- modifier manuellement le total hebdomadaire si nécessaire ;
- enregistrer la valeur finale retenue pour approbation.

### 2) Pièces justificatives
Avant l’approbation, l’administrateur doit pouvoir joindre un ou plusieurs documents, par exemple :
- feuille de temps ;
- facture d’hébergement ;
- preuve de déplacement ;
- toute autre pièce justificative.

### 3) Approbation des heures
L’administrateur doit pouvoir marquer une semaine comme **Approuvée** une fois les vérifications terminées.

Chaque approbation devrait idéalement enregistrer :
- l’utilisateur administrateur ayant approuvé ;
- la date et l’heure d’approbation ;
- le total final approuvé ;
- les pièces jointes associées.

### 4) Génération des factures approuvées
Une fois la semaine approuvée, le système doit afficher une option permettant de générer les **factures approuvées**.

Règles :
- seules les heures approuvées doivent être utilisées pour la facture ;
- les semaines non approuvées ne doivent pas être facturables via cette option ;
- le statut de la facture doit refléter qu’elle provient d’heures approuvées.

---

## Règles métier
- La période de référence d’une semaine est toujours **du dimanche au samedi**.
- Une approbation doit s’appliquer à une **semaine précise** et à un **employé précis**.
- Une semaine approuvée peut être verrouillée, ou alors toute modification ultérieure doit forcer une nouvelle approbation.
- Les factures approuvées ne doivent jamais être générées à partir d’heures non approuvées.

---

## Suggestions de statuts
### Statut des heures
- `Brouillon`
- `En vérification`
- `Approuvé`

### Statut de la facture
- `Non générée`
- `Facture approuvée générée`

---

## Critères d’acceptation
1. Un administrateur peut sélectionner une semaine de travail du dimanche au samedi dans l’onglet **Horaire**.
2. Le système affiche le total calculé des quarts/heures pour cette semaine.
3. L’administrateur peut ajuster ce total avant approbation.
4. L’administrateur peut joindre des documents justificatifs à cette semaine.
5. L’administrateur peut approuver la semaine après vérification.
6. Le système conserve une trace de l’approbation (admin, date/heure, total approuvé).
7. Le bouton ou l’action **Générer les factures approuvées** n’est disponible que pour les semaines approuvées.
8. La facture générée utilise uniquement le total approuvé.
9. Une modification après approbation exige une nouvelle approbation ou enlève automatiquement le statut approuvé.

---

## Proposition UX minimale
Dans l’onglet **Horaire**, ajouter pour chaque employé et chaque semaine :
- le total calculé ;
- le total approuvé/modifiable ;
- une zone de dépôt de documents ;
- un bouton **Approuver les heures** ;
- un bouton **Générer la facture approuvée**.

---

## Résultat attendu
Le flux final doit être :

**Horaire hebdomadaire → Vérification administrative → Ajout de pièces justificatives → Approbation des heures → Génération de la facture approuvée**
