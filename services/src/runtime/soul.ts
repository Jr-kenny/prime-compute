import type { Soul } from "./types";

// Minimal, dependency-free YAML-ish frontmatter reader: `key: value` lines between the
// opening and closing `---`. Enough for our flat metadata; no nested YAML needed.
export function parseFrontmatter(src: string): { fields: Record<string, string>; body: string } {
  const match = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("missing frontmatter block (--- ... ---)");
  const frontmatter = match[1] ?? "";
  const body = match[2] ?? "";
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    fields[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return { fields, body };
}

export function requireField(fields: Record<string, string>, key: string, kind: string): string {
  const v = fields[key];
  if (!v) throw new Error(`${kind} frontmatter missing required field: ${key}`);
  return v;
}

export function parseSoul(src: string): Soul {
  const { fields, body } = parseFrontmatter(src);
  return {
    schema: requireField(fields, "schema", "soul"),
    version: requireField(fields, "version", "soul"),
    name: requireField(fields, "name", "soul"),
    body: body.trimStart(),
  };
}
