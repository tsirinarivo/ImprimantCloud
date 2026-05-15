import { PrismaClient } from "@prisma/client";
import { loadPrinterCfg, sendPrintAndLog } from "./xprint";
import { formatSaleReceipt } from "./xprint-templates";

const prisma = new PrismaClient();

// ─── Pattern auto-print ───────────────────────────────────────────────────────
//
// Chaque wrapper autoPrintXxx() :
//   1. Charge la config (cachée 60s)
//   2. Vérifie le flag tenant
//   3. Formate le document
//   4. Appelle sendPrintAndLog
//
// Appelé en fire-and-forget depuis les routes métier :
//   autoPrintSaleReceipt(sale.id).catch(() => {});

// ─── Ticket de caisse — auto (respecte le flag autoOnSaleConfirm) ─────────────

export async function autoPrintSaleReceipt(saleId: string): Promise<void> {
  try {
    // Adapter l'include selon le schéma Prisma du projet cible
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true, shop: true },
    });
    if (!sale) return;

    const cfg = await prisma.printerConfig.findUnique({ where: { ownerId: sale.shopId } });
    if (!cfg?.enabled || !cfg.autoOnSaleConfirm) return;

    const content = formatSaleReceipt({
      shopName: sale.shop.name,
      shopAddr: sale.shop.address ?? null,
      shopPhone: sale.shop.phone ?? null,
      saleCode: sale.code,
      cashierName: sale.cashierName ?? "",
      items: sale.items.map((it) => ({
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
        total: it.total,
      })),
      subtotal: sale.subtotal,
      discount: sale.discount ?? 0,
      total: sale.total,
      paymentLabel: sale.paymentMethod ?? "",
      cashGiven: sale.cashGiven ?? undefined,
      change: sale.change ?? undefined,
      header: cfg.header,
      footer: cfg.footer,
    });

    await sendPrintAndLog(sale.shopId, content, {
      kind: "sale_receipt",
      relatedId: sale.id,
      copies: cfg.copies,
    });
  } catch (e) {
    console.warn("[xprint] auto sale failed:", e instanceof Error ? e.message : e);
  }
}

// ─── Ticket de caisse — forcé (depuis l'UI, sans vérif de flag) ──────────────

export async function printSaleReceiptNow(saleId: string): Promise<void> {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true, shop: true },
    });
    if (!sale) return;

    const cfg = await prisma.printerConfig.findUnique({ where: { ownerId: sale.shopId } });
    if (!cfg?.enabled) return;

    const content = formatSaleReceipt({
      shopName: sale.shop.name,
      shopAddr: sale.shop.address ?? null,
      shopPhone: sale.shop.phone ?? null,
      saleCode: sale.code,
      cashierName: sale.cashierName ?? "",
      items: sale.items.map((it) => ({
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
        total: it.total,
      })),
      subtotal: sale.subtotal,
      discount: sale.discount ?? 0,
      total: sale.total,
      paymentLabel: sale.paymentMethod ?? "",
      cashGiven: sale.cashGiven ?? undefined,
      change: sale.change ?? undefined,
      header: cfg.header,
      footer: cfg.footer,
    });

    await sendPrintAndLog(sale.shopId, content, {
      kind: "sale_receipt",
      relatedId: sale.id,
      copies: cfg.copies,
    });
  } catch (e) {
    console.warn("[xprint] force sale failed:", e instanceof Error ? e.message : e);
  }
}

// ─── Usage dans une route API métier ─────────────────────────────────────────
//
//  const sale = await prisma.sale.create({ ... });
//
//  if (body.printReceipt === true) {
//    printSaleReceiptNow(sale.id).catch(() => {});    // force
//  } else if (body.printReceipt === undefined) {
//    autoPrintSaleReceipt(sale.id).catch(() => {});   // respecte le flag
//  }
//  // Si body.printReceipt === false : aucune impression
