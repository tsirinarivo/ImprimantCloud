import { loadPrinterCfg, sendPrintAndLog } from "../../lib/xprint";
import { escapeXprint } from "../../lib/xprint-templates";

// POST /api/printer/test — imprime un ticket de test (debug=1 si XPYUN_DEBUG=1)
export async function printTest(ownerId: string) {
  const cfg = await loadPrinterCfg(ownerId);
  if (!cfg) return { ok: false, errorMessage: "Imprimante non configurée" };

  const now = new Date().toLocaleString("fr-FR");
  const lines = [
    `<C><B>TEST IMPRIMANTE</B></C>`,
    `<C>${escapeXprint(now)}</C>`,
    "-".repeat(48),
    `<L>SN     : ${escapeXprint(cfg.sn)}</L>`,
    `<L>User   : ${escapeXprint(cfg.user)}</L>`,
    `<L>Copies : ${cfg.copies}</L>`,
    "-".repeat(48),
    `<C>Impression OK !</C>`,
  ];

  return sendPrintAndLog(ownerId, lines.join("<BR>"), { kind: "test" });
}
