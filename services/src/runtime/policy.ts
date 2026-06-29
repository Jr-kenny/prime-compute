import type { Policy } from "./types";
import { parseFrontmatter, requireField } from "./soul";

export function parsePolicy(src: string): Policy {
  const { fields, body } = parseFrontmatter(src);
  return {
    schema: requireField(fields, "schema", "policy"),
    version: requireField(fields, "version", "policy"),
    body: body.trimStart(),
  };
}
