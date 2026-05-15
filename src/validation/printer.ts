import { z } from "zod";

// Correctif #4 : user/key/sn optionnels au niveau du schéma, obligatoires
// seulement quand enabled=true (via superRefine).
export const PrinterConfigSchema = z
  .object({
    enabled: z.boolean(),
    user: z.string().min(1).max(100).optional(),
    key: z.string().min(1).max(500).optional(),
    region: z.enum(["cn", "sg", "de"]).default("cn"),
    sn: z.string().min(1).max(50).optional(),
    voice: z.number().int().min(0).max(4).nullable().optional(),
    header: z.string().max(500).nullable().optional(),
    footer: z.string().max(500).nullable().optional(),
    copies: z.number().int().min(1).max(10).default(1),
    autoOnSaleConfirm: z.boolean().default(true),
    autoOnPaymentConfirm: z.boolean().default(true),
    autoOnDeliveryRegister: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.enabled) {
      if (!data.user) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Requis si activé", path: ["user"] });
      }
      if (!data.key) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Requis si activé", path: ["key"] });
      }
      if (!data.sn) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Requis si activé", path: ["sn"] });
      }
    }
  });

export type PrinterConfigInput = z.infer<typeof PrinterConfigSchema>;

export const PrintNowSchema = z.object({
  kind: z.enum(["sale_receipt", "invoice", "delivery_note", "inventory", "credit_note", "test"]),
  // Correctif #7 : .string().min(1) au lieu de .cuid() — compatible UUID, nanoid, etc.
  relatedId: z.string().min(1).optional(),
  copies: z.number().int().min(1).max(10).optional(),
});

export type PrintNowInput = z.infer<typeof PrintNowSchema>;

export const EnrollPrinterSchema = z.object({
  sn: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  idcode: z.string().max(50).optional(),
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
