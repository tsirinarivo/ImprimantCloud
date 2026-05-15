import { loadPrinterCfg, sendPrintAndLog } from "./xprint";
import { formatSaleReceipt } from "./xprint-templates";
import type { PrinterCfg } from "./xprint";

// ─── Pattern auto-print ───────────────────────────────────────────────────────
//
// Les fonctions prennent les données déjà chargées en paramètre au lieu
// d'accéder directement aux modèles métier (Sale, Shop, etc.) qui varient
// selon le projet cible. Le caller charge la vente depuis sa propre DB et la passe.
//
// Usage dans une route API métier :
//
//   const sale = await prisma.sale.findUnique({ where: { id }, include: { shop: true, items: true } });
//   if (!sale) return;
//
//   if (body.printReceipt === true) {
//     printSaleReceiptNow(sale.shopId, mapSale(sale)).catch(() => {});   // forcé
//   } else if (body.printReceipt === undefined) {
//     autoPrintSaleReceipt(sale.shopId, mapSale(sale)).catch(() => {});  // respecte le flag
//   }
//   // Si body.printReceipt === false : aucune impression

// Type générique pour les données d'une vente — adapter selon le schéma du projet
export type SaleForReceipt = {
  id: string;
  code: string;
  // N1 : date de transaction fournie par l'appelant — pas new Date() au moment de l'impression
  date: Date;
  cashierName?: string | null;
  shopName: string;
  shopAddr?: string | null;
  shopPhone?: string | null;
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount?: number;
  total: number;
  paymentMethod?: string | null;
  cashGiven?: number | null;
  change?: number | null;
  currency?: string;
};

// A3-1 : buildContent utilise la cfg déjà chargée + mise en cache — plus de 2e aller DB
// A3-2 : logique commune extraite — élimine la duplication entre auto et forcé
function buildReceiptContent(sale: SaleForReceipt, cfg: PrinterCfg): string {
  return formatSaleReceipt({
    shopName: sale.shopName,
    shopAddr: sale.shopAddr ?? null,
    shopPhone: sale.shopPhone ?? null,
    saleCode: sale.code,
    cashierName: sale.cashierName ?? "",
    date: sale.date,
    items: sale.items,
    subtotal: sale.subtotal,
    discount: sale.discount ?? 0,
    total: sale.total,
    paymentLabel: sale.paymentMethod ?? "",
    cashGiven: sale.cashGiven ?? undefined,
    change: sale.change ?? undefined,
    currency: sale.currency,
    header: cfg.header,
    footer: cfg.footer,
  });
}

// ─── Ticket de caisse — auto (respecte le flag autoOnSaleConfirm) ─────────────

export async function autoPrintSaleReceipt(
  ownerId: string,
  sale: SaleForReceipt,
): Promise<void> {
  try {
    // A3-1 : loadPrinterCfg est mis en cache — pas de 2e requête DB pour les flags
    const cfg = await loadPrinterCfg(ownerId);
    if (!cfg?.autoOnSaleConfirm) return;

    const content = buildReceiptContent(sale, cfg);
    await sendPrintAndLog(ownerId, content, {
      kind: "sale_receipt",
      relatedId: sale.id,
      copies: cfg.copies,
    });
  } catch (e) {
    console.warn("[xprint] auto sale failed:", e instanceof Error ? e.message : e);
  }
}

// ─── Ticket de caisse — forcé (depuis l'UI, sans vérif du flag) ──────────────

export async function printSaleReceiptNow(
  ownerId: string,
  sale: SaleForReceipt,
): Promise<void> {
  try {
    // A3-1 : même cache — pas de 2e requête DB
    const cfg = await loadPrinterCfg(ownerId);
    if (!cfg) return;

    const content = buildReceiptContent(sale, cfg);
    await sendPrintAndLog(ownerId, content, {
      kind: "sale_receipt",
      relatedId: sale.id,
      copies: cfg.copies,
    });
  } catch (e) {
    console.warn("[xprint] force sale failed:", e instanceof Error ? e.message : e);
  }
}
