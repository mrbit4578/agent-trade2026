import { runAcceptanceSuite } from "../src/lib/monitor/acceptance";

async function main() {
  const result = await runAcceptanceSuite();
  console.log(`\n=== Trade.2026 Signal Monitor — Acceptance Suite (${result.ranAtUtc}) ===`);
  for (const c of result.checks) {
    console.log(`${c.passed ? "[PASS]" : "[FAIL]"} ${c.id} — ${c.title}`);
    console.log(`       ${c.detail}`);
  }
  if (!result.allPassed) {
    console.error("\nAcceptance suite FAILED.");
    process.exit(1);
  }
  console.log("\nAll acceptance checks PASSED.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
