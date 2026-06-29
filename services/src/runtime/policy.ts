import type { Policy } from "./types";
import { parseFrontmatter } from "./soul";

export function parsePolicy(src: string): Policy {
  const { fields, body } = parseFrontmatter(src);
  for (const key of ["schema", "version"]) {
    if (!fields[key]) throw new Error(`policy frontmatter missing required field: ${key}`);
  }
  return { schema: fields.schema, version: fields.version, body: body.trimStart() };
}
