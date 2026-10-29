export function testDatabaseUrl(connectionString: string | undefined, schemaOverride?: string): URL {
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL is required. Use npm run verify:prisma for an isolated test database.");
  }
  const url = new URL(connectionString);
  const rootSchema = url.searchParams.get("schema") ?? "";
  const schema = schemaOverride ?? rootSchema;
  const testSchema = /^wallet_(?:test|api_test|auth_test)_[a-z0-9_]+$/;
  if (!testSchema.test(rootSchema) || !testSchema.test(schema)) {
    throw new Error("Database tests require a wallet_test_ schema; application schemas are refused.");
  }
  url.hostname = url.hostname.replace("-pooler", "");
  url.searchParams.set("schema", schema);
  // Prisma's schema option does not scope raw SQL. Both must target the test schema.
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url;
}
