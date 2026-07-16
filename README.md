# Famiflora — Relais "L'expert des plantes"

Petit serveur qui alimente la fonction plantes de l'app Famiflora :

1. **`/care`** — genere une **fiche d'entretien detaillee et specifique** pour l'espece identifiee (arrosage, lumiere, temperature, humidite, substrat, engrais, rempotage, problemes courants, toxicite, astuce Famiflora). Chaque fiche est produite **une seule fois** par Claude puis **mise en cache** : la bibliotheque s'enrichit toute seule au fil des identifications, et le cout tend vers zero.
2. **`/identify`** — proxifie l'identification **Pl@ntNet** en gardant la cle **cote serveur** (plus de cle en clair dans l'app).

Les cles d'API (Claude, Pl@ntNet) ne sont jamais dans l'APK : elles vivent uniquement ici, en variables d'environnement.

## Endpoints

| Methode | Chemin | Description |
|--------|--------|-------------|
| GET | `/health` | Etat du service, modele, nb de fiches en cache |
| GET | `/care?name=<nom scientifique>&common=<nom commun>&family=<famille>` | Fiche d'entretien (depuis le cache ou generee) |
| POST | `/care` | Idem, corps JSON `{ "name", "common", "family" }` |
| POST | `/identify` | multipart `images=<photo>` -> resultat Pl@ntNet |

Reponse `/care` : `{ "cached": true|false, "sheet": { ...fiche... } }`.

## Deploiement sur Railway

1. Pousser ce repo sur GitHub (deja fait).
2. Sur [railway.app](https://railway.app) : **New Project → Deploy from GitHub repo** → choisir `FAmiflora-APK`.
3. Ajouter le plugin **PostgreSQL** au projet (bouton *New → Database → PostgreSQL*). Railway injecte `DATABASE_URL` automatiquement — le cache devient persistant.
4. Dans **Variables** du service, ajouter :
   - `ANTHROPIC_API_KEY` = ta cle Claude (console.anthropic.com)
   - `PLANTNET_KEY` = ta cle Pl@ntNet (si tu utilises `/identify`)
   - `CLAUDE_MODEL` = `claude-sonnet-5` (defaut ; `claude-opus-4-8` pour la qualite max, `claude-haiku-4-5` pour le cout le plus bas)
5. Railway build et deploie tout seul (`npm start`). Recupere l'URL publique (ex. `https://famiflora-xxxx.up.railway.app`).
6. Tester : `https://<ton-url>/health`.

## Cote application (plant.html)

- **Identification** : remplacer l'appel direct a `my-api.plantnet.org` par un POST vers `https://<ton-url>/identify` (la cle Pl@ntNet disparait de l'app).
- **Conseils** : apres identification, appeler `https://<ton-url>/care?name=<nomScientifique>` et afficher la fiche riche renvoyee. On garde en local (localStorage) les fiches deja recues pour un affichage instantane hors-ligne au 2e passage.

## Pre-remplissage du cache (rendre les conseils instantanes)

Au depart le cache est vide : chaque plante identifiee doit etre generee par Claude (quelques secondes d'attente). Pour eviter ca, on **pre-remplit** le cache avec la liste des plantes courantes (`plants.js`, ~300 especes). Ensuite ces plantes s'affichent **instantanement**, sans appel API ; Claude n'est sollicite que pour une espece rare pas encore connue.

**Une seule fois, apres deploiement :**

1. Definir la variable `SEED_TOKEN` (une chaine secrete, ex. `famiflora-2026-xyz`) dans les Variables Railway. Optionnel : `SEED_MODEL=claude-sonnet-5` (qualite des fiches).
2. Ouvrir dans le navigateur :
   `https://<ton-url>/admin/seed?token=<ton SEED_TOKEN>`
   -> repond `pre-remplissage demarre`. La generation tourne en arriere-plan.
3. Suivre l'avancement : `https://<ton-url>/admin/seed-status`
   (ou `/health`, champ `fichesEnCache` qui monte jusqu'a ~300).

C'est idempotent : relancer `/admin/seed` ignore les fiches deja generees. Pour ajouter des especes, completer `plants.js` et relancer le seed. Cout du pre-remplissage : quelques euros, une seule fois.

## Developpement local

```bash
npm install
cp .env.example .env   # remplir ANTHROPIC_API_KEY
npm start
# http://localhost:3000/health
```

Sans `DATABASE_URL`, le cache est en memoire (repart a zero au redemarrage) — suffisant pour tester.

## Cout & modele

Une fiche generee coute quelques fractions de centime, **une seule fois par espece** grace au cache. `claude-sonnet-5` par defaut (tres bon rapport qualite/cout pour des fiches factuelles) ; `claude-opus-4-8` pour la qualite maximale ; `claude-haiku-4-5` pour le cout le plus bas.
