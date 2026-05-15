import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { decrypt } from "./encrypt";

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrinterCfg = {
  enabled: boolean;
  user: string;
  key: string;
  baseUrl: string;
  sn: string;
  voice: number | null;
  header: string | null;
  footer: string | null;
  copies: number;
};

export type XprintResponse<T> = {
  ok: boolean;
  code: number;
  msg: string;
  data: T | null;
};

// ─── Validators de type runtime (correctif #12) ───────────────────────────────

export const isString = (v: unknown): v is string => typeof v === "string";
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
export const isNumber = (v: unknown): v is number => typeof v === "number";
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ─── Signature SHA-1 ──────────────────────────────────────────────────────────

function sign(user: string, key: string, ts: string): string {
  return crypto.createHash("sha1").update(user + key + ts).digest("hex");
}

// ─── Détection environnement serverless (correctif #1) ────────────────────────

function isServerless(): boolean {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.CF_PAGES
  );
}

// ─── Cache config en mémoire 60s (correctif #11) ─────────────────────────────

const cfgCache = new Map<string, { cfg: PrinterCfg; expiresAt: number }>();
const CFG_TTL_MS = 60_000;

export function invalidateCfgCache(ownerId: string): void {
  cfgCache.delete(ownerId);
}

// ─── Appel API xpyun : timeout + retry rate-limit (correctifs #4 et #10) ─────

const FETCH_TIMEOUT_MS = 8_000;
const RATE_LIMIT_CODE = 1010;
const RETRY_DELAYS_MS = [1_000, 3_000, 7_000] as const;

export async function callXprint<T>(
  cfg: Pick<PrinterCfg, "user" | "key" | "baseUrl">,
  action: string,
  privateParams: Record<string, unknown>,
  // Correctif #12 : validator de type runtime optionnel
  validator?: (v: unknown) => v is T,
): Promise<XprintResponse<T>> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const ts = Math.floor(Date.now() / 1000).toString();

    // Correctif #4 : timeout fetch via AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let raw: unknown;
    try {
      const res = await fetch(`${cfg.baseUrl}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json;charset=UTF-8" },
        body: JSON.stringify({
          ...privateParams,
          user: cfg.user,
          timestamp: ts,
          sign: sign(cfg.user, cfg.key, ts),
          // Correctif #9 : debug via env var
          debug: process.env.XPYUN_DEBUG === "1" ? "1" : "0",
        }),
        signal: controller.signal,
      });
      raw = await res.json().catch(() => null);
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        code: -100,
        msg: isAbort ? `Timeout (${FETCH_TIMEOUT_MS / 1000}s)` : "Erreur réseau",
        data: null,
      };
    } finally {
      clearTimeout(timer);
    }

    if (!isRecord(raw)) {
      return { ok: false, code: -100, msg: "Réponse invalide", data: null };
    }

    const code = isNumber(raw.code) ? raw.code : -1;
    const msg = isString(raw.msg) ? raw.msg : "";

    // Correctif #10 : retry automatique sur rate limit 1010
    if (code === RATE_LIMIT_CODE && attempt < RETRY_DELAYS_MS.length) {
      await new Promise<void>((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }

    const rawData = raw.data ?? null;
    const data: T | null =
      rawData === null
        ? null
        : validator
          ? validator(rawData)
            ? rawData
            : null
          : (rawData as T);

    return { ok: code === 0, code, msg, data };
  }

  return {
    ok: false,
    code: RATE_LIMIT_CODE,
    msg: "Rate limit — tentatives épuisées",
    data: null,
  };
}

// ─── Chargement de config (correctif #11 : cache 60s) ────────────────────────

export async function loadPrinterCfg(ownerId: string): Promise<PrinterCfg | null> {
  const now = Date.now();
  const cached = cfgCache.get(ownerId);
  if (cached && cached.expiresAt > now) return cached.cfg;

  const row = await prisma.printerConfig.findUnique({ where: { ownerId } });
  if (!row?.enabled || !row.user || !row.key || !row.sn) return null;

  // Correctif #2 : déchiffrement de la clé — rétrocompat si non chiffrée
  let decryptedKey: string;
  try {
    decryptedKey = decrypt(row.key);
  } catch {
    console.warn("[xprint] UserKEY non chiffrée pour ownerId:", ownerId, "— migration recommandée");
    decryptedKey = row.key;
  }

  const cfg: PrinterCfg = {
    enabled: true,
    user: row.user,
    key: decryptedKey,
    baseUrl: (row.baseUrl ?? "https://open.xpyun.net/api/openapi/xprinter").replace(/\/$/, ""),
    sn: row.sn,
    voice: row.voice ?? null,
    header: row.header ?? null,
    footer: row.footer ?? null,
    copies: row.copies ?? 1,
  };

  cfgCache.set(ownerId, { cfg, expiresAt: now + CFG_TTL_MS });
  return cfg;
}

// ─── Envoi + log (correctifs #1 #5) ──────────────────────────────────────────

const MAX_CONTENT_BYTES = 4096;
const LOG_PREVIEW_BYTES = 500;

export async function sendPrintAndLog(
  ownerId: string,
  content: string,
  meta: { kind: string; relatedId?: string | null; copies?: number },
): Promise<{ ok: boolean; orderId?: string; errorMessage?: string }> {
  const cfg = await loadPrinterCfg(ownerId);
  if (!cfg) return { ok: false, errorMessage: "Imprimante non configurée" };

  const contentBytes = Buffer.byteLength(content, "utf-8");
  if (contentBytes > MAX_CONTENT_BYTES) {
    return { ok: false, errorMessage: `Contenu trop long (${contentBytes} bytes > ${MAX_CONTENT_BYTES})` };
  }

  const copies = meta.copies ?? cfg.copies;

  const res = await callXprint<string>(
    cfg,
    "print",
    { sn: cfg.sn, content, copies, mode: 1 },
    isString,
  );

  const orderId = res.data ?? undefined;

  // Correctif #5 : preview en bytes (pas en chars) pour cohérence avec la limite
  const contentPreview = Buffer.from(content, "utf-8")
    .subarray(0, LOG_PREVIEW_BYTES)
    .toString("utf-8");

  const log = await prisma.printLog.create({
    data: {
      ownerId,
      sn: cfg.sn,
      kind: meta.kind,
      relatedId: meta.relatedId ?? null,
      content: contentPreview,
      copies,
      status: res.ok ? "pending" : "failed",
      orderId: orderId ?? null,
      error: res.ok ? null : `${res.code} ${res.msg}`,
      failedAt: res.ok ? null : new Date(),
    },
  });

  // Correctif #1 : setTimeout ignoré en serverless — utiliser un cron job
  // ou un système de queue (BullMQ, Inngest, Trigger.dev) sur ces plateformes.
  // refreshPendingLogs() est la solution universelle (§8.3 / /api/printer/logs/refresh).
  if (res.ok && orderId && !isServerless()) {
    const lid = log.id;
    setTimeout(() => {
      callXprint<boolean>(cfg, "queryOrderState", { orderId }, isBoolean)
        .then((r) => {
          if (r.ok && r.data === true) {
            prisma.printLog
              .updateMany({ where: { id: lid, status: "pending" }, data: { status: "printed" } })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, 15_000);
  }

  return { ok: res.ok, orderId, errorMessage: res.ok ? undefined : res.msg };
}

// ─── Refresh statuts en batch rate-limit safe (correctif #7) ─────────────────

const REFRESH_BATCH_SIZE = 10;
const REFRESH_BATCH_DELAY_MS = 3_500; // 10 req / 3.5s << limite 30 req / 10s

export async function refreshPendingLogs(
  ownerId: string,
): Promise<{ checked: number; printed: number }> {
  const cfg = await loadPrinterCfg(ownerId);
  if (!cfg) return { checked: 0, printed: 0 };

  const pending = await prisma.printLog.findMany({
    where: { ownerId, status: "pending", orderId: { not: null } },
    select: { id: true, orderId: true },
    take: 100,
  });

  let printed = 0;

  for (let i = 0; i < pending.length; i += REFRESH_BATCH_SIZE) {
    const batch = pending.slice(i, i + REFRESH_BATCH_SIZE);

    await Promise.all(
      batch.map(async (log) => {
        const r = await callXprint<boolean>(
          cfg,
          "queryOrderState",
          { orderId: log.orderId! },
          isBoolean,
        );
        if (r.ok && r.data === true) {
          await prisma.printLog.update({ where: { id: log.id }, data: { status: "printed" } });
          printed++;
        }
      }),
    );

    // Pause entre batches pour rester sous le rate limit
    if (i + REFRESH_BATCH_SIZE < pending.length) {
      await new Promise<void>((r) => setTimeout(r, REFRESH_BATCH_DELAY_MS));
    }
  }

  return { checked: pending.length, printed };
}

// ─── Status imprimante ────────────────────────────────────────────────────────

export async function getPrinterStatus(
  ownerId: string,
): Promise<{ ok: boolean; status: number; msg: string }> {
  const cfg = await loadPrinterCfg(ownerId);
  if (!cfg) return { ok: false, status: -1, msg: "Non configuré" };

  const r = await callXprint<number>(cfg, "queryPrinterStatus", { sn: cfg.sn }, isNumber);
  return {
    ok: r.ok,
    status: r.data ?? -1, // 0=offline, 1=online OK, 2=anomalie
    msg: r.msg,
  };
}
