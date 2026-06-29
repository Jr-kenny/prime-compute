import { test, expect } from "bun:test";
import { parseSoul } from "./soul";

const sample = `---
schema: soul/v1
version: 1.2.3
name: Broker
---
# Identity
You are the Prime Compute broker.
`;

test("parses frontmatter and body", () => {
  const soul = parseSoul(sample);
  expect(soul.schema).toBe("soul/v1");
  expect(soul.version).toBe("1.2.3");
  expect(soul.name).toBe("Broker");
  expect(soul.body).toContain("# Identity");
  expect(soul.body).not.toContain("schema:");
});

test("throws when a required frontmatter field is missing", () => {
  const noName = `---\nschema: soul/v1\nversion: 1.0.0\n---\nbody`;
  expect(() => parseSoul(noName)).toThrow(/name/);
});

test("throws when there is no frontmatter block", () => {
  expect(() => parseSoul("# just a body")).toThrow(/frontmatter/);
});
