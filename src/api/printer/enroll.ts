import { loadPrinterCfg, callXprint } from "../../lib/xprint"; // N4 : isString non utilisé, supprimé
import { EnrollPrinterSchema } from "../../validation/printer";

type EnrollResult = { success: string[]; fail: string[] };

// POST /api/printer/enroll — rattache un nouveau SN au compte xpyun
export async function enrollPrinter(ownerId: string, body: unknown) {
  const parsed = EnrollPrinterSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const cfg = await loadPrinterCfg(ownerId);
  if (!cfg) return { ok: false, errorMessage: "Imprimante non configurée" };

  const { sn, name, idcode, cardno, pin } = parsed.data;

  const res = await callXprint<EnrollResult>(
    cfg,
    "addPrinters",
    { items: [{ sn, name, ...(idcode ? { idcode } : {}), ...(cardno ? { cardno } : {}), ...(pin ? { pin } : {}) }] },
    (v): v is EnrollResult =>
      typeof v === "object" &&
      v !== null &&
      Array.isArray((v as EnrollResult).success) &&
      Array.isArray((v as EnrollResult).fail),
  );

  if (!res.ok || !res.data) {
    return { ok: false, errorMessage: res.msg };
  }

  return {
    ok: res.data.success.includes(sn),
    enrolled: res.data.success,
    failed: res.data.fail,
  };
}
