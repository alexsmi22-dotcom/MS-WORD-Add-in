// Online IUPAC name → structure via the EMBL-EBI OPSIN web service.
//
// This is the ONE feature that leaves the machine: OPSIN is a Java library with
// no offline browser build, so arbitrary systematic-name parsing (e.g.
// "2-amino-3-(1H-indol-3-yl)propanoic acid") requires the hosted service. It is
// strictly opt-in and gated behind an in-pane consent step in the task pane —
// the typed name is sent over the internet, so it must never fire silently.
//
// The URL builder and response parser are pure and unit-tested; only
// resolveNameOnline performs the network call.

export const OPSIN_ENDPOINT = "https://www.ebi.ac.uk/opsin/ws";

/** Builds the OPSIN JSON endpoint URL for a name (path-encoded). */
export function opsinUrl(name: string): string {
  return `${OPSIN_ENDPOINT}/${encodeURIComponent(name.trim())}.json`;
}

export interface OpsinResult {
  /** SMILES OPSIN produced — feed to the offline OCL depiction/property code. */
  smiles: string;
  /** Standard InChI, when returned. */
  inchi?: string;
  /** Standard InChIKey, when returned (handy for database lookup). */
  inchikey?: string;
}

export type OpsinOutcome = { ok: true; result: OpsinResult } | { ok: false; message: string };

/**
 * Interprets an OPSIN JSON response. Success carries a non-empty SMILES; any
 * other status is a failure with OPSIN's own explanatory message.
 */
export function parseOpsinResponse(json: unknown): OpsinOutcome {
  const j = json as { status?: string; smiles?: string; message?: string; stdinchi?: string; inchi?: string; stdinchikey?: string } | null;
  if (!j || j.status !== "SUCCESS" || !j.smiles) {
    const message = j && j.message ? String(j.message).trim() : "OPSIN did not recognize this name.";
    return { ok: false, message };
  }
  return {
    ok: true,
    result: { smiles: j.smiles, inchi: j.stdinchi || j.inchi, inchikey: j.stdinchikey },
  };
}

/**
 * Resolves a chemical name to a structure via the OPSIN web service. Network
 * failures, non-200 responses, and unparseable names all resolve to
 * `{ ok: false, message }` so the caller can surface a clean status. NEVER call
 * this without explicit user consent — it transmits the name over the internet.
 */
export async function resolveNameOnline(name: string): Promise<OpsinOutcome> {
  if (!name.trim()) return { ok: false, message: "Enter a name first." };
  let res: Response;
  try {
    res = await fetch(opsinUrl(name), { headers: { Accept: "application/json" } });
  } catch {
    return { ok: false, message: "Couldn't reach the OPSIN service — check your internet connection." };
  }
  // OPSIN returns HTTP 404 with a `{status:"FAILURE", message}` JSON body for any
  // name it can't parse — that's "name not recognized," not a service outage. So
  // read the body first and let parseOpsinResponse surface OPSIN's own message;
  // only fall back to an HTTP-status error when there is no usable JSON body
  // (a genuine 5xx / HTML error page).
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) return { ok: false, message: `OPSIN service error (HTTP ${res.status}).` };
    return { ok: false, message: "Unexpected response from the OPSIN service." };
  }
  return parseOpsinResponse(json);
}
