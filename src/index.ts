// Point d'entrée public du module — réexporte uniquement les surfaces stables

export { encrypt, decrypt } from "./lib/encrypt";
export {
  callXprint,
  loadPrinterCfg,
  invalidateCfgCache,
  sendPrintAndLog,
  refreshPendingLogs,
  getPrinterStatus,
  isString,
  isBoolean,
  isNumber,
  isRecord,
} from "./lib/xprint";
export type { PrinterCfg, XprintResponse } from "./lib/xprint";
export {
  normaliseForThermal,
  escapeXprint,
  formatSaleReceipt,
  formatDeliveryNote,
  formatInventorySheet,
  formatCreditNote,
} from "./lib/xprint-templates";
export {
  PrinterConfigSchema,
  PrintNowSchema,
  EnrollPrinterSchema,
  LogsQuerySchema,
} from "./validation/printer";
export type {
  PrinterConfigInput,
  PrintNowInput,
  EnrollPrinterInput,
  LogsQueryInput,
} from "./validation/printer";

// Handlers API
export { getConfig, updateConfig } from "./api/printer/config";
export { printTest } from "./api/printer/test";
export { printerStatus } from "./api/printer/status";
export { getLogs, refreshLogs } from "./api/printer/logs";
export { enrollPrinter } from "./api/printer/enroll";
export { printNow } from "./api/printer/print-now";

// Auto-print
export { autoPrintSaleReceipt, printSaleReceiptNow } from "./lib/xprint-auto";
