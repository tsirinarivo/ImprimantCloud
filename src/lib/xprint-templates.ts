// ─── Normalisation encodage thermique (correctifs #3 et #6) ──────────────────

// Correctif #3 : tous les caractères spéciaux exprimés en codes Unicode
// explicites — aucun caractère invisible dans le source.
export function normaliseForThermal(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")            // U+0300-U+036F diacritiques combinés
    .replace(/œ/g, "oe").replace(/Œ/g, "OE") // œ Œ
    .replace(/æ/g, "ae").replace(/Æ/g, "AE") // æ Æ
    .replace(/[‘’]/g, "'")                // smart single quotes
    .replace(/[“”]/g, '"')                // smart double quotes
    .replace(/[–—]/g, "-")                // en-dash, em-dash
    .replace(/…/g, "...")                      // ellipsis
    .replace(/€/g, "EUR")                      // €
    .replace(/→/g, "->")                       // →
    .replace(/·/g, "-")                        // ·
    // Correctif #3 : NBSP (U+00A0) et NNBSP (U+202F) entre chiffres → "."
    .replace(/(\d)[\u00A0\u202F](\d)/g, "$1.$2")
    .replace(/[\u00A0\u202F]/g, " ");              // autres → espace normal
}

// Échappe les balises xpyun dans les valeurs utilisateur
export function escapeXprint(s: string): string {
  return normaliseForThermal(s).replace(/</g, "(").replace(/>/g, ")");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WIDTH = 48; // 80mm → 48 chars ; 58mm → 32 chars

const divider = (c = "-"): string => c.repeat(WIDTH);

function row(label: string, value: string): string {
  const pad = WIDTH - label.length - value.length;
  return label + (pad > 0 ? " ".repeat(pad) : " ") + value;
}

// Correctif #6 : NBSP/NNBSP via codes Unicode explicites — pas de regex invisible
function formatMoney(amount: number, suffix = " MGA"): string {
  return (
    new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .format(amount)
      .replace(/[\u00A0\u202F]/g, ".") // séparateurs milliers → "."
    + suffix
  );
}

// ─── Ticket de caisse (correctif #13 : chaîne de traitement documentée) ──────

// Chaîne de traitement obligatoire :
//   valeur brute → formatMoney() → escapeXprint() → template xpyun
// escapeXprint() appelle normaliseForThermal() qui nettoie les NBSP résiduels.

export function formatSaleReceipt(opts: {
  shopName: string;
  shopAddr: string | null;
  shopPhone: string | null;
  saleCode: string;
  cashierName: string;
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  subtotal: number;
  discount: number;
  total: number;
  paymentLabel: string;
  cashGiven?: number;
  change?: number;
  qrPayload?: string;
  header?: string | null;
  footer?: string | null;
}): string {
  const lines: string[] = [];

  if (opts.header?.trim()) {
    opts.header.split("\n").forEach((l) => lines.push(`<C>${escapeXprint(l)}</C>`));
  }
  lines.push(`<C><B>${escapeXprint(opts.shopName.toUpperCase())}</B></C>`);
  if (opts.shopAddr) lines.push(`<C>${escapeXprint(opts.shopAddr)}</C>`);
  if (opts.shopPhone) lines.push(`<C>${escapeXprint(opts.shopPhone)}</C>`);
  lines.push(divider());
  lines.push(`<L>Ticket  : ${escapeXprint(opts.saleCode)}</L>`);
  lines.push(`<L>Caissier: ${escapeXprint(opts.cashierName)}</L>`);
  lines.push(`<L>Date    : ${escapeXprint(new Date().toLocaleString("fr-FR"))}</L>`);
  lines.push(divider());

  for (const it of opts.items) {
    lines.push(`<L>${escapeXprint(it.name.slice(0, WIDTH))}</L>`);
    lines.push(
      `<L>${escapeXprint(row(`  ${it.qty} x ${formatMoney(it.unitPrice)}`, formatMoney(it.total)))}</L>`,
    );
  }

  lines.push(divider());
  lines.push(`<L>${escapeXprint(row("Sous-total", formatMoney(opts.subtotal)))}</L>`);
  if (opts.discount > 0) {
    lines.push(`<L>${escapeXprint(row("Remise", `-${formatMoney(opts.discount)}`))}</L>`);
  }
  lines.push(`<L><B>${escapeXprint(row("TOTAL", formatMoney(opts.total)))}</B></L>`);
  lines.push(divider());
  lines.push(`<L>Paiement : ${escapeXprint(opts.paymentLabel)}</L>`);
  if (opts.cashGiven != null) {
    lines.push(`<L>${escapeXprint(row("Especes recues", formatMoney(opts.cashGiven)))}</L>`);
  }
  if (opts.change != null) {
    lines.push(`<L>${escapeXprint(row("Monnaie rendue", formatMoney(opts.change)))}</L>`);
  }
  if (opts.qrPayload) {
    lines.push("");
    lines.push(`<C><QRCODE>${opts.qrPayload.slice(0, 256)}</QRCODE></C>`);
  }
  lines.push("");
  lines.push(`<C>Merci de votre visite !</C>`);
  if (opts.footer?.trim()) {
    opts.footer.split("\n").forEach((l) => lines.push(`<C>${escapeXprint(l)}</C>`));
  }
  // PAS de <CUT> — xpyun découpe automatiquement en fin de job
  return lines.join("<BR>");
}

// ─── Bon de livraison ─────────────────────────────────────────────────────────

export function formatDeliveryNote(opts: {
  warehouseName: string;
  bonCode: string;
  date: Date;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  driverName: string | null;
  vehiclePlate: string | null;
  items: { ref: string; name: string; qty: number; unit: string }[];
  totalQty: number;
  qrPayload?: string;
}): string {
  const lines: string[] = [];

  lines.push(`<C><B>${escapeXprint(opts.warehouseName.toUpperCase())}</B></C>`);
  lines.push(`<C>BON DE LIVRAISON</C>`);
  lines.push(divider("="));
  lines.push(`<C><B>${escapeXprint(opts.bonCode)}</B></C>`);
  lines.push(`<C>${escapeXprint(opts.date.toLocaleDateString("fr-FR"))}</C>`);
  lines.push(divider());
  lines.push(`<L><BOLD>CLIENT</BOLD></L>`);
  lines.push(`<L>${escapeXprint(opts.clientName)}</L>`);
  lines.push(`<L>${escapeXprint(opts.clientPhone)}</L>`);
  lines.push(`<L>${escapeXprint(opts.clientAddress)}</L>`);

  if (opts.driverName) {
    lines.push(divider());
    lines.push(`<L>Livreur : ${escapeXprint(opts.driverName)}</L>`);
    if (opts.vehiclePlate) {
      lines.push(`<L>Vehicule: ${escapeXprint(opts.vehiclePlate)}</L>`);
    }
  }

  lines.push(divider());
  for (const it of opts.items) {
    lines.push(`<L>${escapeXprint(it.ref)} - ${escapeXprint(it.name.slice(0, 30))}</L>`);
    lines.push(`<L>${escapeXprint(row("  Quantite", `${it.qty} ${it.unit}`))}</L>`);
  }

  lines.push(divider());
  lines.push(`<L><B>${escapeXprint(row("TOTAL COLIS", String(opts.totalQty)))}</B></L>`);
  if (opts.qrPayload) {
    lines.push("");
    lines.push(`<C><QRCODE>${opts.qrPayload.slice(0, 256)}</QRCODE></C>`);
  }
  lines.push("");
  lines.push(`<L>Signature client :</L>`);
  lines.push("");
  lines.push(`<L>______________________</L>`);
  return lines.join("<BR>");
}

// ─── Fiche inventaire ─────────────────────────────────────────────────────────

export function formatInventorySheet(opts: {
  warehouseName: string;
  sheetCode: string;
  date: Date;
  items: { ref: string; name: string; expected: number; unit: string }[];
}): string {
  const lines: string[] = [];

  lines.push(`<C><B>FICHE INVENTAIRE</B></C>`);
  lines.push(`<C>${escapeXprint(opts.warehouseName)}</C>`);
  lines.push(
    `<C>${escapeXprint(opts.sheetCode)} - ${escapeXprint(opts.date.toLocaleDateString("fr-FR"))}</C>`,
  );
  lines.push(divider());
  lines.push(`<L>${escapeXprint(row("Reference / Article", "Theorique"))}</L>`);
  lines.push(divider());

  for (const it of opts.items) {
    lines.push(`<L>${escapeXprint(it.ref)} ${escapeXprint(it.name.slice(0, 20))}</L>`);
    lines.push(
      `<L>${escapeXprint(row("  Compte:  _______", `${it.expected} ${it.unit}`))}</L>`,
    );
  }

  lines.push(divider());
  lines.push(`<L>Inventoriste : __________________</L>`);
  lines.push(`<L>Signature :    __________________</L>`);
  return lines.join("<BR>");
}

// ─── Avoir client / ticket de remboursement (correctif #13) ──────────────────

export function formatCreditNote(opts: {
  shopName: string;
  shopAddr: string | null;
  shopPhone: string | null;
  creditNoteCode: string;
  originalSaleCode: string;
  cashierName: string;
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  totalRefund: number;
  reason: string | null;
  refundMethod: string;
  header?: string | null;
  footer?: string | null;
}): string {
  const lines: string[] = [];

  if (opts.header?.trim()) {
    opts.header.split("\n").forEach((l) => lines.push(`<C>${escapeXprint(l)}</C>`));
  }
  lines.push(`<C><B>${escapeXprint(opts.shopName.toUpperCase())}</B></C>`);
  if (opts.shopAddr) lines.push(`<C>${escapeXprint(opts.shopAddr)}</C>`);
  if (opts.shopPhone) lines.push(`<C>${escapeXprint(opts.shopPhone)}</C>`);
  lines.push(divider("="));
  lines.push(`<C><B>AVOIR CLIENT</B></C>`);
  lines.push(divider("="));
  lines.push(`<L>Avoir N  : ${escapeXprint(opts.creditNoteCode)}</L>`);
  lines.push(`<L>Ticket   : ${escapeXprint(opts.originalSaleCode)}</L>`);
  lines.push(`<L>Caissier : ${escapeXprint(opts.cashierName)}</L>`);
  lines.push(`<L>Date     : ${escapeXprint(new Date().toLocaleString("fr-FR"))}</L>`);

  if (opts.reason) {
    lines.push(divider());
    lines.push(`<L>Motif : ${escapeXprint(opts.reason)}</L>`);
  }

  lines.push(divider());
  for (const it of opts.items) {
    lines.push(`<L>${escapeXprint(it.name.slice(0, WIDTH))}</L>`);
    lines.push(
      `<L>${escapeXprint(row(`  ${it.qty} x ${formatMoney(it.unitPrice)}`, formatMoney(it.total)))}</L>`,
    );
  }

  lines.push(divider());
  lines.push(`<L><B>${escapeXprint(row("REMBOURSEMENT", formatMoney(opts.totalRefund)))}</B></L>`);
  lines.push(`<L>Mode     : ${escapeXprint(opts.refundMethod)}</L>`);
  lines.push("");
  lines.push(`<C>Conserver cet avoir.</C>`);

  if (opts.footer?.trim()) {
    opts.footer.split("\n").forEach((l) => lines.push(`<C>${escapeXprint(l)}</C>`));
  }
  return lines.join("<BR>");
}
