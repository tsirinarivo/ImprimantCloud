import { prisma } from "./prisma";
import { sendPrintAndLog } from "./xprint";
import { formatSaleReceipt } from "./xprint-templates";

// ─── Pattern auto-print ───────────────────────────────────────────────────────
//
// Correctif #8 : les fonctions prennent les données déjà chargées en paramètre
// au lieu d'accéder directement aux modèles métier (Sale, Shop, etc.) qui varient
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
};

// Charge uniquement les flags d'impression (pas le modèle Sale)
async function loadPrintFlags(ownerId: string) {
  return prisma.printerConfig.findUnique({
    where: { ownerId },
    select: {
      enabled: true,
      autoOnSaleConfirm: true,
      copies: true,
      header: true,
      footer: true,
    },
  });
}

// ─── Ticket de caisse — auto (respecte le flag autoOnSaleConfirm) ─────────────

export async function autoPrintSaleReceipt(
  ownerId: string,
  sale: SaleForReceipt,
): Promise<void> {
  try {
    const flags = await loadPrintFlags(ownerId);
    if (!flags?.enabled || !flags.autoOnSaleConfirm) return;

    const content = formatSaleReceipt({
      shopName: sale.shopName,
      shopAddr: sale.shopAddr ?? null,
      shopPhone: sale.shopPhone ?? null,
      saleCode: sale.code,
      cashierName: sale.cashierName ?? "",
      items: sale.items,
      subtotal: sale.subtotal,
      discount: sale.discount ?? 0,
      total: sale.total,
      paymentLabel: sale.paymentMethod ?? "",
      cashGiven: sale.cashGiven ?? undefined,
      change: sale.change ?? undefined,
      header: flags.header,
      footer: flags.footer,
    });

    await sendPrintAndLog(ownerId, content, {
      kind: "sale_receipt",
      relatedId: sale.id,
      copies: flags.copies,
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
    const flags = await loadPrintFlags(ownerId);
    if (!flags?.enabled) return;

    const content = formatSaleReceipt({
      shopName: sale.shopName,
      shopAddr: sale.shopAddr ?? null,
      shopPhone: sale.shopPhone ?? null,
      saleCode: sale.code,
      cashierName: sale.cashierName ?? "",
      items: sale.items,
      subtotal: sale.subtotal,
      discount: sale.discount ?? 0,
      total: sale.total,
      paymentLabel: sale.paymentMethod ?? "",
      cashGiven: sale.cashGiven ?? undefined,
      change: sale.change ?? undefined,
      header: flags.header,
      footer: flags.footer,
    });

    await sendPrintAndLog(ownerId, content, {
      kind: "sale_receipt",
      relatedId: sale.id,
      copies: flags.copies,
    });
  } catch (e) {
    console.warn("[xprint] force sale failed:", e instanceof Error ? e.message : e);
  }
}
