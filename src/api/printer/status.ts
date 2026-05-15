import { getPrinterStatus } from "../../lib/xprint";

const STATUS_LABELS: Record<number, string> = {
  0: "Hors ligne",
  1: "En ligne",
  2: "Anomalie",
};

// GET /api/printer/status — état temps réel de l'imprimante
export async function printerStatus(ownerId: string) {
  const result = await getPrinterStatus(ownerId);
  return {
    ...result,
    label: STATUS_LABELS[result.status] ?? "Inconnu",
  };
}
