// ─── Normalisation encodage thermique ────────────────────────────────────────

// A3-5 : garde-fou null/undefined — retourne "" plutôt que TypeError
// Tous les codes spéciaux exprimés en \uXXXX — aucun caractère invisible dans le source.
export function normaliseForThermal(s: string): string {
  if (typeof s !== "string") return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")  // diacritiques combinés U+0300\u2013U+036F
    .replace(/\u0153/g, "oe").replace(/\u0152/g, "OE") // \u0153 \u0152
    .replace(/\u00E6/g, "ae").replace(/\u00C6/g, "AE") // \u00E6 \u00C6
    .replace(/[\u2018\u2019]/g, "'")  // smart single quotes
    .replace(/[\u201C\u201D]/g, '"')  // smart double quotes
    .replace(/[\u2013\u2014]/g, "-")  // en-dash, em-dash
    .replace(/\u2026/g, "...")        // ellipsis
    .replace(/\u20AC/g, "EUR")        // \u20AC
    .replace(/\u2192/g, "->")         // \u2192
    .replace(/\u00B7/g, "-")          // \u00B7
    // NBSP (U+00A0) et NNBSP (U+202F) entre chiffres → "." (séparateur milliers fr-FR)
    .replace(/(\d)[\u00A0\u202F](\d)/g, "$1.$2")
    .replace(/[\u00A0\u202F]/g, " "); // autres NBSP/NNBSP \u2192 espace normal
}

// Échappe les balises xpyun dans les valeurs utilisateur
export function escapeXprint(s: string): string {
  return normaliseForThermal(s).replace(/</g, "(").replace(/>/g, ")");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WIDTH = 48; // 80mm → 48 chars ; 58mm → 32 chars

const divider = (c = "-"): string => c.repeat(WIDTH);

// A3-6 : tronque le label si label+value dépasse WIDTH — plus de débordement silencieux
function row(label: string, value: string): string {
  const pad = WIDTH - label.length - value.length;
  if (pad > 0) return label + " ".repeat(pad) + value;
  const truncLen = Math.max(0, WIDTH - value.length - 1);
  return label.slice(0, truncLen) + " " + value;
}

// A3-7 : exportée pour réutilisation ; suffix configurable (défaut " MGA")
// Intl.NumberFormat("fr-FR") produit NBSP (U+00A0) ou NNBSP (U+202F) comme séparateur milliers.
export function formatMoney(amount: number, suffix = " MGA"): string {
  return (
    new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .format(amount)
      .replace(/[\u00A0\u202F]/g, ".") // séparateurs milliers \u2192 "."
    + suffix
  );
}

// ─── Ticket de caisse ─────────────────────────────────────────────────────────

// Chaîne de traitement obligatoire :
//   valeur brute → formatMoney() → escapeXprint() → template xpyun
// escapeXprint() appelle normaliseForThermal() qui nettoie les NBSP résiduels.

export function formatSaleReceipt(opts: {
  shopName: string;
  shopAddr: string | null;
  shopPhone: string | null;
  saleCode: string;
  cashierName: string;
  // N1 : date de transaction fournie par l'appelant — pas new Date() au moment de l'impression
  date: Date;
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
  // A3-7 : devise configurable (défaut "MGA")
  currency?: string;
}): string {
  const cur = opts.currency ? ` ${opts.currency}` : " MGA";
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
  lines.push(`<L>Date    : ${escapeXprint(opts.date.toLocaleString("fr-FR"))}</L>`);
  lines.push(divider());

  for (const it of opts.items) {
    lines.push(`<L>${escapeXprint(it.name.slice(0, WIDTH))}</L>`);
    lines.push(
      `<L>${escapeXprint(row(`  ${it.qty} x ${formatMoney(it.unitPrice, cur)}`, formatMoney(it.total, cur)))}</L>`,
    );
  }

  lines.push(divider());
  lines.push(`<L>${escapeXprint(row("Sous-total", formatMoney(opts.subtotal, cur)))}</L>`);
  if (opts.discount > 0) {
    lines.push(`<L>${escapeXprint(row("Remise", `-${formatMoney(opts.discount, cur)}`))}</L>`);
  }
  lines.push(`<L><B>${escapeXprint(row("TOTAL", formatMoney(opts.total, cur)))}</B></L>`);
  lines.push(divider());
  lines.push(`<L>Paiement : ${escapeXprint(opts.paymentLabel)}</L>`);
  if (opts.cashGiven != null) {
    lines.push(`<L>${escapeXprint(row("Especes recues", formatMoney(opts.cashGiven, cur)))}</L>`);
  }
  if (opts.change != null) {
    lines.push(`<L>${escapeXprint(row("Monnaie rendue", formatMoney(opts.change, cur)))}</L>`);
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

// ─── Avoir client / ticket de remboursement ───────────────────────────────────

export function formatCreditNote(opts: {
  shopName: string;
  shopAddr: string | null;
  shopPhone: string | null;
  creditNoteCode: string;
  originalSaleCode: string;
  cashierName: string;
  // N1 : date de l'avoir fournie par l'appelant — pas new Date() au moment de l'impression
  date: Date;
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  totalRefund: number;
  reason: string | null;
  refundMethod: string;
  header?: string | null;
  footer?: string | null;
  // A3-7 : devise configurable (défaut "MGA")
  currency?: string;
}): string {
  const cur = opts.currency ? ` ${opts.currency}` : " MGA";
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
  lines.push(`<L>Date     : ${escapeXprint(opts.date.toLocaleString("fr-FR"))}</L>`);

  if (opts.reason) {
    lines.push(divider());
    lines.push(`<L>Motif : ${escapeXprint(opts.reason)}</L>`);
  }

  lines.push(divider());
  for (const it of opts.items) {
    lines.push(`<L>${escapeXprint(it.name.slice(0, WIDTH))}</L>`);
    lines.push(
      `<L>${escapeXprint(row(`  ${it.qty} x ${formatMoney(it.unitPrice, cur)}`, formatMoney(it.total, cur)))}</L>`,
    );
  }

  lines.push(divider());
  lines.push(`<L><B>${escapeXprint(row("REMBOURSEMENT", formatMoney(opts.totalRefund, cur)))}</B></L>`);
  lines.push(`<L>Mode     : ${escapeXprint(opts.refundMethod)}</L>`);
  lines.push("");
  lines.push(`<C>Conserver cet avoir.</C>`);

  if (opts.footer?.trim()) {
    opts.footer.split("\n").forEach((l) => lines.push(`<C>${escapeXprint(l)}</C>`));
  }
  return lines.join("<BR>");
}
