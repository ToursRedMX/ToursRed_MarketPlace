// Version de texto plano de un correo HTML, para la parte text/plain.
//
// POR QUE EXISTE (28-oct-2026, UAT NOT-02): los correos salian solo en HTML y con el remitente a secas. Los de
// cancelacion cayeron en cuarentena de Microsoft Defender (SCL:5, SPM por contenido) con SPF, DKIM y DMARC en
// pass. Un correo solo-HTML sin parte de texto es una de las senales que pesan en ese filtro. `enviarCorreo`
// la agrega cuando quien llama no mando la suya.
//
// No es un renderizador: conserva el texto, los saltos de linea y el destino de cada enlace, y descarta todo lo demas.

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ntilde: "ñ", Ntilde: "Ñ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í",
  Oacute: "Ó", Uacute: "Ú", uuml: "ü", iexcl: "¡", iquest: "¿", copy: "©", middot: "·", ndash: "–", mdash: "—",
};

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entero, ent: string) => {
    if (ent[0] === "#") {
      const codigo = ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      try { return String.fromCodePoint(codigo); } catch { return entero; }
    }
    return ENTIDADES[ent] ?? entero;
  });
}

export function htmlATexto(html: string): string {
  const texto = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, "")
    // Un enlace con texto distinto de su destino se escribe "texto (destino)"; si son iguales, solo el destino.
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, interior: string) => {
      const visible = interior.replace(/<[^>]+>/g, "").trim();
      if (!/^https?:\/\//i.test(href)) return visible;
      return !visible || visible === href ? href : `${visible} (${href})`;
    })
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return decodificar(texto)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
