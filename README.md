# Rewoork — Bot Discord + MySQL + Prisma

Bot Discord robuste, sécurisé et prêt pour CI/CD.  
Stack : **Node.js 22**, **discord.js v14**, **Prisma**, **MySQL**, **Docker Compose**.

---

## 🚀 Prérequis

- Node.js >= 22
- npm >= 9
- Docker + Docker Compose
- Un **Bot Token Discord** et son **Application ID** depuis [Discord Developer Portal](https://discord.com/developers/applications)
- (Facultatif) Accès à une base MySQL distante, sinon MySQL en local via Docker.

---

## 📦 Installation

```bash
# Clone le projet
git clone https://github.com/ton-compte/rewoork.git
cd rewoork

# Installe les dépendances Node
npm ci
```

---

## ⚙️ Configuration

Crée un fichier `.env` à la racine (copie de `.env.example`) :

```ini
# Discord
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=

# DB (user en lecture/écriture minimal)
DATABASE_URL="mysql://user:password@host:3306/botdb?connection_limit=5"

# App
NODE_ENV=development
LOG_LEVEL=info
HEALTH_PORT=3000
```

> 💡 Ne mets **jamais** `.env` dans un commit (déjà ignoré dans `.gitignore`).

---

## 🐳 Utilisation avec Docker Compose

Lancement complet (bot + MySQL + Adminer) :

```bash
npm run compose:up
```

Arrêt des services :

```bash
npm run compose:down
```

Logs du bot en temps réel :

```bash
npm run compose:logs
```

État des services :

```bash
npm run compose:ps
```

---

## 🗄️ Gestion de la base de données (dans le conteneur bot)

Pousser le schéma Prisma vers la BDD (création des tables) :

```bash
npm run db:push:docker
```

Déployer les migrations Prisma (prod) :

```bash
npm run db:migrate:docker
```

Ouvrir Prisma Studio (interface web de la DB) :

```bash
npm run db:studio:docker
```

---

## 🖥️ Utilisation en local (sans Docker)

Assurez-vous d’avoir MySQL en route (local ou distant).  
Puis configurez `DATABASE_URL` dans `.env` :

```ini
DATABASE_URL="mysql://user:pass@host:3306/botdb?connection_limit=5"
```

Démarrage en mode dev avec rechargement auto :

```bash
npm run dev
```

Démarrage en mode prod :

```bash
npm start
```

---

## 📜 Commandes npm

| Commande                | Description |
|-------------------------|-------------|
| `npm run dev`           | Lance le bot en mode développement |
| `npm start`             | Lance le bot en mode production |
| `npm run compose:up`    | Build + démarre bot + MySQL (+ Adminer) |
| `npm run compose:down`  | Stoppe et supprime les conteneurs |
| `npm run compose:logs`  | Logs du bot |
| `npm run compose:ps`    | Statut des services |
| `npm run db:push:docker`| Push schéma Prisma dans la BDD Docker |
| `npm run db:migrate:docker` | Applique migrations Prisma dans Docker |
| `npm run db:studio:docker`  | Ouvre Prisma Studio via Docker |
| `npm run lint`          | Lint du code |
| `npm run check`         | Lint + vérifications de base |

---

## 🛡️ Sécurité

- **Pas de secrets dans le code** → tout dans `.env`
- **User MySQL avec privilèges limités** : seulement `SELECT, INSERT, UPDATE, DELETE` en prod
- **Intents Discord minimaux** pour réduire la surface d’attaque
- **Cooldowns** sur les commandes pour éviter le spam
- **Logs** filtrés pour éviter les infos sensibles
- **Graceful shutdown** géré (`SIGINT`, `SIGTERM`)

---

## 🩺 Healthcheck

Un endpoint HTTP renvoie l’état du bot pour Kubernetes, Docker, etc.  
Accessible sur `http://localhost:3000` (configurable via `HEALTH_PORT`).

---

## ⚙️ CI/CD (GitHub Actions)

Le repo est prêt pour CI/CD avec :
- Lint et tests à chaque PR
- Build et push Docker image sur tag `v*.*.*`

Secrets à définir dans GitHub Actions :
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID` (facultatif)
- `MYSQL_ROOT_PASSWORD`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`

---

## 📝 Licence

[MIT](./LICENSE)
