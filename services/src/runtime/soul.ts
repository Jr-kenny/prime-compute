import type { Soul } from "./types";

// Minimal, dependency-free YAML-ish frontmatter reader: `key: value` lines between the
// opening and closing `---`. Enough for our flat metadata; no nested YAML needed.
export function parseFrontmatter(src: string): { fields: Record<string, string>; body: string } {
  const match = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("missing frontmatter block (--- ... ---)");
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    fields[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return { fields, body: match[2] };
}

export function parseSoul(src: string): Soul {
  const { fields, body } = parseFrontmatter(src);
  for (const key of ["schema", "version", "name"]) {
    if (!fields[key]) throw new Error(`soul frontmatter missing required field: ${key}`);
  }
  return { schema: fields.schema, version: fields.version, name: fields.name, body: body.trimStart() };
}
