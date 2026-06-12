/**
 * ORCID existence check via the public API. No client_id / secret needed —
 * the `pub.orcid.org` endpoint is fully unauthenticated.
 *
 * ⚠️  This only proves the ORCID iD *exists* in the registry. It does NOT
 * prove the caller owns it — that would require full OAuth (Sign-in-with-
 * ORCID). For the v1 demo we accept this gap: a council-review narrative
 * in the UI tells users a human will manually cross-check the iD against
 * their stated identity within 48h.
 */

const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export function isValidOrcidFormat(s: string): boolean {
  return ORCID_RE.test(s);
}

export interface OrcidProfile {
  /** True if the iD is in the registry (HTTP 200 from pub.orcid.org). */
  exists: boolean;
  /** Concatenated given + family name from the registry, when available. */
  fullName: string | null;
  /** Affiliation from the most recent employment entry, when available. */
  employer: string | null;
}

/** Fetch a public ORCID record and return the bits we care about for the
 *  Lab Profile. Returns `{ exists: false }` on any 404 / network / parse
 *  failure (we treat all non-200s as "not verified"). */
export async function fetchOrcidProfile(orcid: string): Promise<OrcidProfile> {
  if (!isValidOrcidFormat(orcid)) return { exists: false, fullName: null, employer: null };

  // pub.orcid.org returns JSON when we ask for it with the Accept header.
  // 5-second timeout — ORCID's API is usually <1s but we don't want a
  // flaky upstream to wedge our PUT request.
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}/record`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return { exists: false, fullName: null, employer: null };
    const json: any = await res.json();

    const given  = json?.person?.name?.["given-names"]?.value ?? "";
    const family = json?.person?.name?.["family-name"]?.value ?? "";
    const fullName = [given, family].filter(Boolean).join(" ").trim() || null;

    // Walk employment summaries: the first group's first summary is the
    // most recent role. Path: activities-summary.employments.affiliation-group[].summaries[].organization.name
    const empGroups = json?.["activities-summary"]?.employments?.["affiliation-group"] ?? [];
    let employer: string | null = null;
    for (const g of empGroups) {
      const sum = g?.summaries?.[0]?.["employment-summary"];
      const name = sum?.organization?.name;
      if (name) { employer = String(name); break; }
    }

    return { exists: true, fullName, employer };
  } catch {
    return { exists: false, fullName: null, employer: null };
  } finally {
    clearTimeout(timeout);
  }
}
