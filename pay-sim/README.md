# Simulateur de paiement (palier 4)

Un faux prestataire de paiement, sur le modèle des vrais (Stripe, Adyen…). Votre API l'appelle
quand un client paie sa commande. **Ne le modifiez pas** : c'est votre API qui doit s'adapter à lui.

```bash
npm run paiement        # http://localhost:4010
```

## Appel à faire depuis votre API

```http
POST http://localhost:4010/v1/charges
Authorization: Bearer sk_test_roulotte
Idempotency-Key: 3f1c9a52-…            (un identifiant unique par paiement, réutilisé à chaque nouvelle tentative)
Content-Type: application/json

{ "amountCents": 1550, "currency": "EUR", "reference": "order-42", "token": "tok_visa" }
```

| Réponse | Signification |
|---|---|
| **201** `{ "id": "ch_…", "status": "succeeded", … }` | Paiement accepté |
| **402** `{ "id": "ch_…", "status": "declined", "declineReason": "…" }` | Paiement refusé : ne pas réessayer |
| **400** | Requête invalide (votre corps JSON n'a pas la bonne forme) |
| **401** | Clé secrète absente ou fausse |
| **5xx** | Panne passagère ou durable du prestataire : réessayer (avec la même `Idempotency-Key`) |

Mettez l'URL et la clé dans votre `.env` (par exemple `PAYMENT_URL` et `PAYMENT_API_KEY`), jamais en dur dans le code.

## Jetons de test

| Jeton | Comportement | Ce que votre API doit répondre |
|---|---|---|
| `tok_visa` | Accepté | 200, `paymentStatus: "PAID"` |
| `tok_declined` | Refusé (402) | 402 `PAYMENT_DECLINED`, en **une seule** tentative |
| `tok_flaky` | Le paiement est enregistré, mais la **première réponse se perd** (503) | 200 après une nouvelle tentative, et **un seul** paiement enregistré |
| `tok_slow` | Répond au bout de 5 s | 504 `PAYMENT_PROVIDER_TIMEOUT` après 3 tentatives de 2 s |
| `tok_down` | Erreur 500 à chaque appel | 502 `PAYMENT_PROVIDER_ERROR` après 3 tentatives |

`tok_flaky` montre l'intérêt de l'`Idempotency-Key` : sans elle, la nouvelle tentative crée
un **second** paiement — le client est débité deux fois.

## Outils de vérification (utilisés par la recette)

```http
GET /v1/charges?reference=order-42     → { "items": [ …paiements de cette commande… ] }
GET /v1/attempts?reference=order-42    → { "reference": "order-42", "attempts": 3 }
```

(avec le même en-tête `Authorization`)

Le terminal du simulateur affiche chaque appel reçu : c'est le meilleur moyen de vérifier vos
nouvelles tentatives.
