# La Roulotte — kit du projet

Tout ce qu'il faut pour développer, tester et présenter **votre** API de click & collect.
Aucune dépendance à installer : Node.js 22 suffit.

| Dossier | Contenu | Le modifier ? |
|---|---|---|
| `contrat/openapi.yaml` | Le contrat de l'API : routes, champs, statuts, codes d'erreur | **Non** — c'est la référence |
| `donnees/menu.json` | Le menu et les 3 comptes à charger dans votre seed | **Non** — copiez-le dans votre projet |
| `front/` | L'application web qui consomme votre API | **Non** — interdit |
| `pay-sim/` | Le simulateur de prestataire de paiement (palier 4) | **Non** |
| `recette/` | Les tests automatiques de chaque palier | **Non** |
| `fourni/auth/` | Le module d'authentification (inscription, connexion, JWT, rôles, Helmet, CORS, anti force brute) | **Non** — copiez-le dans `src/fourni/auth` et branchez-le : voir son `README.md` |

Votre API vit dans **votre propre dépôt**, pas dans ce kit.

## Lancer le front

```bash
npm run front            # http://localhost:5173
```

Le front appelle l'API sur `http://localhost:3000`. Autre port ? Changez l'adresse dans la page
**Statut de l'API** du front (sans toucher au code). Cette page détecte aussi les routes de chaque palier.

Votre API doit autoriser l'origine `http://localhost:5173` (CORS).

## Vérifier votre API : la recette

Votre API tourne, avec le seed chargé, dans un autre terminal :

```bash
npm run recette:1        # palier 1
npm run recette:2        # paliers 1 et 2
npm run recette:3        # paliers 1 à 3
npm run recette:4        # paliers 1 à 4 (lancez d'abord : npm run paiement)
```

Chaque test en échec dit ce qui était attendu et ce que votre API a répondu.
La recette crée des comptes, des plats et des commandes : relancez votre seed quand vous voulez repartir de zéro.

Variables utiles : `API_URL` (défaut `http://localhost:3000`), `FRONT_ORIGIN` (défaut `http://localhost:5173`),
`PAY_SIM_URL` (défaut `http://localhost:4010`). Sous PowerShell : `$env:API_URL="http://localhost:3001"; npm run recette:1`.

## Palier 4 : le simulateur de paiement

```bash
npm run paiement         # http://localhost:4010 — voir pay-sim/README.md
```

## Comptes du seed (donnees/menu.json)

| Email | Mot de passe | Rôle |
|---|---|---|
| admin@roulotte.test | Admin123! | ADMIN |
| cuisine@roulotte.test | Cuisine123! | STAFF |
| client@roulotte.test | Client123! | CUSTOMER |
