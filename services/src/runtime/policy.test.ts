import { test, expect } from "bun:test";
import { parsePolicy } from "./policy";

const sample = `---
schema: policy/v1
version: 1.0.0
---
# Platform Policy
- Never fabricate execution results.
`;

test("parses frontmatter and body", () => {
  const policy = parsePolicy(sample);
  expect(policy.schema).toBe("policy/v1");
  expect(policy.version).toBe("1.0.0");
  expect(policy.body).toContain("Never fabricate");
});

test("throws when version is missing", () => {
  const noVersion = `---\nschema: policy/v1\n---\nbody`;
  expect(() => parsePolicy(noVersion)).toThrow(/version/);
});
