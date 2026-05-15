import { z } from "zod";

// Correctif #8 : schémas Zod pour toutes les entrées API imprimante

export const PrinterConfigSchema = z.object({
  enabled: z.boolean(),
  user: z.string().min(1).max(100),
  key: z.string().min(1).max(500),
  baseUrl: z.string().url().optional(),
  sn: z.string().min(1).max(50),
  voice: z.number().int().min(0).max(15).nullable().optional(),
  header: z.string().max(500).nullable().optional(),
  footer: z.string().max(500).nullable().optional(),
  copies: z.number().int().min(1).max(10).default(1),
  autoOnSaleConfirm: z.boolean().default(true),
  autoOnPaymentConfirm: z.boolean().default(true),
  autoOnDeliveryRegister: z.boolean().default(false),
});

export type PrinterConfigInput = z.infer<typeof PrinterConfigSchema>;

export const PrintNowSchema = z.object({
  kind: z.enum(["sale_receipt", "invoice", "delivery_note", "inventory", "credit_note", "test"]),
  relatedId: z.string().cuid().optional(),
  copies: z.number().int().min(1).max(10).optional(),
});

export type PrintNowInput = z.infer<typeof PrintNowSchema>;

export const EnrollPrinterSchema = z.object({
  sn: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  cardno: z.string().max(50).optional(),
  pin: z.string().max(20).optional(),
});

export type EnrollPrinterInput = z.infer<typeof EnrollPrinterSchema>;

export const LogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "printed", "failed"]).optional(),
  kind: z.string().optional(),
});

export type LogsQueryInput = z.infer<typeof LogsQuerySchema>;
