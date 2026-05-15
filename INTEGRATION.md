# ImprimantCloud — Guide d'intégration

Module TypeScript pour l'impression thermique cloud via [xpyun.net](https://www.xpyun.net) (Xprinter).

---

## Installation

```bash
npm install github:tsirinarivo/ImprimantCloud#claude/add-french-support-dgA4o
```

### Variables d'environnement

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
APP_ENCRYPTION_KEY="une-chaine-aleatoire-32-chars-min"
```

`APP_ENCRYPTION_KEY` sert à chiffrer la UserKEY xpyun en AES-256-GCM. Ne jamais la committer.

### Migration base de données

Copier les modèles Prisma dans ton `schema.prisma` (ou merger avec l'existant) :

```prisma
enum PrintLogStatus {
  pending
  printed
  failed
}

model PrinterConfig {
  id        String  @id @default(cuid())
  ownerId   String  @unique
  enabled   Boolean @default(false)

  user    String?
  key     String?
  region  String  @default("cn") // "cn" | "sg" | "de"
  sn      String?

  voice  Int?     // 0-4 : 0=voix fort, 1=voix moyen, 2=voix bas, 3=bip, 4=muet
  header String?
  footer String?
  copies Int      @default(1)

  autoOnSaleConfirm      Boolean @default(true)
  autoOnPaymentConfirm   Boolean @default(true)
  autoOnDeliveryRegister Boolean @default(false)

  updatedAt DateTime @updatedAt
}

model PrintLog {
  id        String         @id @default(cuid())
  ownerId   String
  sn        String
  kind      String
  relatedId String?
  content   String
  copies    Int            @default(1)
  status    PrintLogStatus @default(pending)
  orderId   String?
  error     String?
  failedAt  DateTime?
  createdAt DateTime       @default(now())

  @@index([ownerId, createdAt])
  @@index([status])
}
```

```bash
npx prisma migrate dev --name add-imprimantcloud
```

---

## Serveurs disponibles

| Région | Code | URL |
|--------|------|-----|
| Chine (défaut) | `cn` | platform.xpyun.net |
| Singapour | `sg` | sg.xpyun.net |
| Allemagne (Europe) | `de` | gm.xpyun.net |

> Utilise la même région que celle configurée dans le firmware de l'imprimante.

```ts
import { XPYUN_REGIONS } from "imprimantcloud";
// { cn: "https://...", sg: "https://...", de: "https://..." }
```

---

## Routes API — exemple Next.js App Router

### GET/PUT `/api/printer/config`

```ts
// app/api/printer/config/route.ts
import { getConfig, updateConfig } from "imprimantcloud";
import { auth } from "@/lib/auth";

export async function GET(req: Request) {
  const { userId } = await auth();
  const cfg = await getConfig(userId);
  return Response.json(cfg);
}

export async function PUT(req: Request) {
  const { userId } = await auth();
  const body = await req.json();
  const result = await updateConfig(userId, body);
  return Response.json(result);
}
```

Body `PUT` :

```json
{
  "enabled": true,
  "user": "mon_user_xpyun",
  "key": "ma_userkey_xpyun",
  "sn": "XXXXXXXXXXX",
  "region": "de",
  "voice": 1,
  "copies": 1,
  "header": "Bienvenue\nwww.monshop.fr",
  "footer": "Merci !",
  "autoOnSaleConfirm": true,
  "autoOnPaymentConfirm": true,
  "autoOnDeliveryRegister": false
}
```

> `getConfig` masque la clé avec `"••••••••"`. Pour ne pas l'écraser, renvoyer cette valeur telle quelle dans le PUT.

---

### POST `/api/printer/test`

```ts
// app/api/printer/test/route.ts
import { printTest } from "imprimantcloud";

export async function POST(req: Request) {
  const { userId } = await auth();
  const result = await printTest(userId);
  return Response.json(result);
}
```

---

### POST `/api/printer/print-now`

```ts
// app/api/printer/print-now/route.ts
import { printNow } from "imprimantcloud";

export async function POST(req: Request) {
  const { userId } = await auth();
  const body = await req.json();

  const result = await printNow(userId, body, async (kind, relatedId) => {
    // Construire le contenu selon le type
    if (kind === "sale_receipt") {
      const sale = await db.sale.findUnique({ where: { id: relatedId } });
      if (!sale) return null;
      return formatSaleReceipt({ /* ... */ });
    }
    return null;
  });

  return Response.json(result);
}
```

Body :

```json
{
  "kind": "sale_receipt",
  "relatedId": "clxxx123",
  "copies": 1
}
```

---

### GET `/api/printer/status`

```ts
import { printerStatus } from "imprimantcloud";

export async function GET(req: Request) {
  const { userId } = await auth();
  const result = await printerStatus(userId);
  return Response.json(result);
}
```

---

### GET `/api/printer/logs`

```ts
import { getLogs } from "imprimantcloud";

export async function GET(req: Request) {
  const { userId } = await auth();
  const { searchParams } = new URL(req.url);
  const result = await getLogs(userId, Object.fromEntries(searchParams));
  return Response.json(result);
}
```

Query params : `page`, `perPage`, `status` (`pending|printed|failed`), `kind`.

---

### POST `/api/printer/enroll`

```ts
import { enrollPrinter } from "imprimantcloud";

export async function POST(req: Request) {
  const { userId } = await auth();
  const body = await req.json();
  const result = await enrollPrinter(userId, body);
  return Response.json(result);
}
```

Body :

```json
{
  "sn": "XXXXXXXXXXX",
  "name": "Caisse principale",
  "idcode": "optionnel",
  "cardno": "optionnel"
}
```

---

## Auto-print à la vente

```ts
import { autoPrintSaleReceipt, printSaleReceiptNow } from "imprimantcloud";
import type { SaleForReceipt } from "imprimantcloud";

const sale: SaleForReceipt = {
  id: "clxxx123",
  date: new Date(),           // date de transaction (pas new Date() au moment print)
  saleCode: "VTE-0042",
  cashierName: "Marie",
  shopName: "Mon Shop",
  shopAddr: "12 rue de la Paix",
  shopPhone: "01 23 45 67 89",
  items: [
    { name: "Café", qty: 2, unitPrice: 150, total: 300 },
  ],
  subtotal: 300,
  discount: 0,
  total: 300,
  paymentLabel: "Espèces",
  cashGiven: 500,
  change: 200,
  currency: "MGA",            // optionnel, défaut "MGA"
};

// Déclenche uniquement si autoOnSaleConfirm=true dans la config
await autoPrintSaleReceipt(ownerId, sale, "sale_confirm");

// Impression forcée sans vérifier le flag
await printSaleReceiptNow(ownerId, sale);
```

---

## Templates d'impression

```ts
import {
  formatSaleReceipt,
  formatDeliveryNote,
  formatInventorySheet,
  formatCreditNote,
  formatMoney,
  normaliseForThermal,
  escapeXprint,
} from "imprimantcloud";

// Montant formaté
formatMoney(12500, " MGA"); // "12.500 MGA"
formatMoney(99.9, " EUR");  // "100 EUR"

// Ticket de caisse
const content = formatSaleReceipt({ /* voir SaleForReceipt */ });

// Bon de livraison
const bon = formatDeliveryNote({
  warehouseName: "Entrepôt Central",
  bonCode: "BL-0021",
  date: new Date(),
  clientName: "Jean Dupont",
  clientPhone: "034 00 000 00",
  clientAddress: "Lot II A 42",
  driverName: "Paul",
  vehiclePlate: "1234 ABC",
  items: [{ ref: "REF001", name: "Carton biscuits", qty: 10, unit: "ctn" }],
  totalQty: 10,
});

// Fiche inventaire
const fiche = formatInventorySheet({
  warehouseName: "Entrepôt Central",
  sheetCode: "INV-2024-01",
  date: new Date(),
  items: [{ ref: "REF001", name: "Biscuits", expected: 50, unit: "ctn" }],
});

// Avoir client
const avoir = formatCreditNote({
  shopName: "Mon Shop",
  shopAddr: null,
  shopPhone: null,
  creditNoteCode: "AV-001",
  originalSaleCode: "VTE-0042",
  cashierName: "Marie",
  date: new Date(),
  items: [{ name: "Café", qty: 1, unitPrice: 150, total: 150 }],
  totalRefund: 150,
  reason: "Article défectueux",
  refundMethod: "Espèces",
});
```

---

## Mise à jour du module

```bash
# Récupérer les derniers commits
npm install github:tsirinarivo/ImprimantCloud#claude/add-french-support-dgA4o

# Si le schéma Prisma a changé
npx prisma migrate dev --name update-imprimantcloud
```

---

## Sécurité

- `APP_ENCRYPTION_KEY` : ne jamais committer, ne jamais logger
- La UserKEY xpyun est chiffrée en AES-256-GCM en base
- `getConfig` retourne toujours `"••••••••"` pour la clé — jamais en clair
- Valider `ownerId` côté serveur avant chaque appel (ne pas faire confiance au body)
