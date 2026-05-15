import crypto from "crypto";
import { prisma } from "./prisma";
import { decrypt } from "./encrypt";

// ─── Types ────────────────────────────────────────────────────────────────────

// Serveurs cloud xpyun documentés (Cloud Printer Server Config Guide)
export const XPYUN_REGIONS = {
  cn: "https://platform.xpyun.net/api/openapi/xprinter", // Chine (défaut)
  sg: "https://sg.xpyun.net/api/openapi/xprinter",       // Singapour
  de: "https://gm.xpyun.net/api/openapi/xprinter",       // Allemagne (Europe)
} as const;

export type XpyunRegion = keyof typeof XPYUN_REGIONS;

export type PrinterCfg = {
  enabled: boolean;
  user: string;
  key: string;
  region: XpyunRegion;
  baseUrl: string; // résolu depuis region — utilisé par callXprint
  sn: string;
  voice: number | null;
  header: string | null;
  footer: string | null;
  copies: number;
  // A3-1 : flags auto-print inclus dans le cache — évite un second aller/retour DB
  autoOnSaleConfirm: boolean;
  autoOnPaymentConfirm: boolean;
  autoOnDeliveryRegister: boolean;
};

export type XprintResponse<T> = {
  ok: boolean;
  code: number;
  msg: string;
  data: T | null;
};

// ─── Validators de type runtime ───────────────────────────────────────────────

export const isString = (v: unknown): v is string => typeof v === "string";
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
export const isNumber = (v: unknown): v is number => typeof v === "number";
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ─── Signature SHA-1 ──────────────────────────────────────────────────────────

function sign(user: string, key: string, ts: string): string {
  return crypto.createHash("sha1").update(user + key + ts).digest("hex");
}

// ─── Détection environnement serverless (calculé une seule fois) ──────────────

const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY ||
  process.env.CF_PAGES
);

// ─── Cache config en mémoire (TTL + limite de taille + cache null) ─────────────

type CacheEntry = { cfg: PrinterCfg | null; expiresAt: number };

const cfgCache = new Map<string, CacheEntry>();
const CFG_TTL_MS = 60_000;
const NULL_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 500;

function setCacheEntry(ownerId: string, entry: CacheEntry): void {
  if (cfgCache.size >= MAX_CACHE_SIZE && !cfgCache.has(ownerId)) {
    const oldest = cfgCache.keys().next().value;
    if (oldest !== undefined) cfgCache.delete(oldest);
  }
  cfgCache.set(ownerId, entry);
}

export function invalidateCfgCache(ownerId: string): void {
  cfgCache.delete(ownerId);
}

// ─── Appel API xpyun : timeout + retry rate-limit + retry réseau ──────────────

const FETCH_TIMEOUT_MS = 8_000;
const RATE_LIMIT_CODE = 1010;
// 3 délais → 4 tentatives maximum (tentative initiale + 3 réessais)
const RETRY_DELAYS_MS = [1_000, 3_000, 7_000] as const;

export async function callXprint<T>(
  cfg: Pick<PrinterCfg, "user" | "key" | "baseUrl">,
  action: string,
  privateParams: Record<string, unknown>,
  validator?: (v: unknown) => v is T,
): Promise<XprintResponse<T>> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const ts = Math.floor(Date.now() / 1000).toString();
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
          debug: process.env.XPYUN_DEBUG === "1" ? "1" : "0",
        }),
        signal: controller.signal,
      });

      raw = await res.json().catch(() => null);

      // N8 : réponse HTTP non-2xx sans corps JSON valide → réessai ou erreur claire
      if (!res.ok && !isRecord(raw)) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise<void>((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        return { ok: false, code: res.status, msg: `HTTP ${res.status} — service indisponible`, data: null };
      }
    } catch (err) {
      clearTimeout(timer);
      // AbortError = notre propre timeout — pas de réessai (l'API est déjà lente)
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, code: -100, msg: `Timeout (${FETCH_TIMEOUT_MS / 1000}s)`, data: null };
      }
      // N3 : erreur réseau transitoire — réessai avec délai exponentiel
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise<void>((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      return { ok: false, code: -100, msg: "Erreur réseau — tentatives épuisées", data: null };
    } finally {
      clearTimeout(timer);
    }

    if (!isRecord(raw)) {
      return { ok: false, code: -100, msg: "Réponse invalide", data: null };
    }

    const code = isNumber(raw.code) ? raw.code : -1;
    // N2 : msg vide possible quand l'API ne renvoie pas de champ msg
    const msg = (isString(raw.msg) && raw.msg) ? raw.msg : `Code ${code}`;

    if (code === RATE_LIMIT_CODE) {
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise<void>((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      return { ok: false, code: RATE_LIMIT_CODE, msg: "Rate limit — tentatives épuisées", data: null };
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

  return { ok: false, code: -1, msg: "Unreachable", data: null };
}

// ─── Chargement de config avec cache ─────────────────────────────────────────

export async function loadPrinterCfg(ownerId: string): Promise<PrinterCfg | null> {
  const now = Date.now();
  const cached = cfgCache.get(ownerId);
  if (cached && cached.expiresAt > now) return cached.cfg;

  const row = await prisma.printerConfig.findUnique({ where: { ownerId } });
  if (!row?.enabled || !row.user || !row.key || !row.sn) {
    setCacheEntry(ownerId, { cfg: null, expiresAt: now + NULL_TTL_MS });
    return null;
  }

  let decryptedKey: string;
  try {
    decryptedKey = decrypt(row.key);
  } catch {
    console.warn("[xprint] UserKEY non chiffrée pour ownerId:", ownerId, "— migration recommandée");
    decryptedKey = row.key;
  }

  const region = (row.region in XPYUN_REGIONS ? row.region : "cn") as XpyunRegion;

  const cfg: PrinterCfg = {
    enabled: true,
    user: row.user,
    key: decryptedKey,
    region,
    baseUrl: XPYUN_REGIONS[region],
    sn: row.sn,
    voice: row.voice ?? null,
    header: row.header ?? null,
    footer: row.footer ?? null,
    copies: row.copies ?? 1,
    // A3-1 : flags auto-print mis en cache avec le reste de la config
    autoOnSaleConfirm: row.autoOnSaleConfirm,
    autoOnPaymentConfirm: row.autoOnPaymentConfirm,
    autoOnDeliveryRegister: row.autoOnDeliveryRegister,
  };

  setCacheEntry(ownerId, { cfg, expiresAt: now + CFG_TTL_MS });
  return cfg;
}

// ─── Helpers internes ─────────────────────────────────────────────────────────

// Troncature UTF-8 aware — recule jusqu'à un octet de début de séquence
function safeBytePreview(content: string, maxBytes: number): string {
  const buf = Buffer.from(content, "utf-8");
  if (buf.length <= maxBytes) return content;
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8");
}

// ─── Envoi + log ──────────────────────────────────────────────────────────────

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
  // N2 : msg peut être "" — fallback vers un message lisible
  const errorMessage = res.ok ? undefined : (res.msg || `Erreur xprint (code ${res.code})`);

  // A3-4 : échec de la création du log tracé — ne masque pas le résultat d'impression
  let logId: string | undefined;
  try {
    const log = await prisma.printLog.create({
      data: {
        ownerId,
        sn: cfg.sn,
        kind: meta.kind,
        relatedId: meta.relatedId ?? null,
        content: safeBytePreview(content, LOG_PREVIEW_BYTES),
        copies,
        status: res.ok ? "pending" : "failed",
        orderId: orderId ?? null,
        error: res.ok ? null : `${res.code} ${res.msg}`,
        failedAt: res.ok ? null : new Date(),
      },
    });
    logId = log.id;
  } catch (logErr) {
    console.error(
      "[xprint] Impossible de créer PrintLog:",
      logErr instanceof Error ? logErr.message : logErr,
    );
    return { ok: res.ok, orderId, errorMessage };
  }

  // ⚠️ NOTE SERVERLESS : ce setTimeout ne s'exécutera PAS sur Vercel/Lambda.
  // Utiliser un cron job + refreshPendingLogs() comme alternative universelle.
  if (res.ok && orderId && logId && !IS_SERVERLESS) {
    const lid = logId;
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

  return { ok: res.ok, orderId, errorMessage };
}

// ─── Refresh statuts en batch rate-limit safe ─────────────────────────────────

const REFRESH_BATCH_SIZE = 10;
const REFRESH_BATCH_DELAY_MS = 3_500;

// N6 : pagination curseur — traite tous les jobs pending sans limite de 100
export async function refreshPendingLogs(
  ownerId: string,
): Promise<{ checked: number; printed: number }> {
  const cfg = await loadPrinterCfg(ownerId);
  if (!cfg) return { checked: 0, printed: 0 };

  let checked = 0;
  let printed = 0;
  let cursor: string | undefined;
  const PAGE = 100;

  for (;;) {
    const page = await prisma.printLog.findMany({
      where: { ownerId, status: "pending", orderId: { not: null } },
      select: { id: true, orderId: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;
    checked += page.length;

    for (let i = 0; i < page.length; i += REFRESH_BATCH_SIZE) {
      const batch = page.slice(i, i + REFRESH_BATCH_SIZE);

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

      if (i + REFRESH_BATCH_SIZE < page.length) {
        await new Promise<void>((r) => setTimeout(r, REFRESH_BATCH_DELAY_MS));
      }
    }

    if (page.length < PAGE) break;
  }

  return { checked, printed };
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
    status: r.data ?? -1,
    msg: r.msg,
  };
}
