import { defineConfig } from "vitest/config";

// Le frontend n'avait aucun banc d'essai. La logique pure — disposition de la
// carte, validation d'adresse — se vérifie sans navigateur : elle mérite d'être
// tenue par des tests comme celle du backend.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
