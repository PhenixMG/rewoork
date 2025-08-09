# Documentation des Fonctionnalités du Bot

## 1. Gestion multi-guildes
- **Guild** : stocke les infos des serveurs Discord (ID, nom, langue, timezone).
- **GuildChannels** : configuration des salons clés (bienvenue, au revoir, logs, annonces bot, TD2 raids/activités/incursions).

## 2. The Division 2 — Raids
- **Raid** : création et gestion des raids (zone, nom, date/heure, notes, max joueurs, post Discord).
- **RaidParticipant** : rôles (`DPS`, `HEAL`, `TANK`), statut (`CONFIRMED`, `LATE`, `ABSENT`, `SUBSTITUTE`), positions, timestamps.
- Rappels automatiques (15 min avant).
- Historique complet des participations.

## 3. The Division 2 — Activités
- **Activity** : création et gestion d’activités (type, nom, date/heure, notes, max joueurs, post Discord).
- **ActivityParticipant** : titulaires et suppléants, historique de participation.
- Rappels automatiques.

## 4. The Division 2 — Incursions
- **Incursion** : création et gestion (nom, difficulté, date/heure, notes, max joueurs, post Discord).
- **IncursionParticipant** : rôles, statut, positions, historique de participation.
- Rappels automatiques.

## 5. Builds & Points Joueurs
- **PlayerBuild** : builds par joueur (nom, rôle, détails), unique par joueur/guilde.
- **PlayerPoints** : points cumulés par joueur/guilde (classements).
- **UserProfile** : alias, timezone, notes.

## 6. Modération
- **GuildModerationSettings** : rôle mute, escalade auto, automod simple (block liens/invites, anti-caps/mentions).
- **AutomodRule** : config JSON avancée (mots bannis, seuils).
- **Infraction** : système de cas (numéro par guilde), types (`WARN`, `BAN`, etc.), preuves multiples (`CaseAttachment`), expiration sanctions, fermeture de cas.
- **ModNote** : notes modération non punitives.

## 7. Jobs & Automatisation
- **Job** : planification de tâches (rappels, nettoyages, relances), verrouillage pour éviter exécution multiple.

## 8. Historique & Statistiques
- Historique de participation complet par joueur (raids, activités, incursions).
- Statistiques sur rôles joués, retards, absences, points cumulés.
- Classements possibles côté code.

## 9. Extensibilité
- Ajout possible de : templates d’événements, squads enregistrés, rappels multiples, commandes supplémentaires.
