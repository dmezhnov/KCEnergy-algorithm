// Runs the fuel-allocation plugin of the platform on an input JSON
// (`input.example_*.json` shape) and prints the allocated volume per request.
//
//   bun run scripts/allocate.bun.ts <input.json> [--out <response.json>]
//
// The plugin answers `{ result, moving_average }`; `result` holds one row per
// request with its axes and the allocated `value`. `--out` keeps the raw response.

const ENDPOINT =
  "https://kc-e.mybpm.kz/web/plugin/kc_energy/algorithm/fuel-allocation";

async function allocate(argv: string[]): Promise<void> {
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const inputPath = argv.find(
    (arg, i) => !arg.startsWith("--") && (outIndex < 0 || i !== outIndex + 1),
  );
  if (!inputPath || (outIndex >= 0 && !outPath)) {
    throw new Error("usage: allocate.bun.ts <input.json> [--out <response.json>]");
  }

  const input = Bun.file(inputPath);
  if (!(await input.exists())) throw new Error(`no such file: ${inputPath}`);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await input.text(),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`plugin answered ${response.status}: ${body.slice(0, 2000)}`);
  }
  if (outPath) await Bun.write(outPath, body);

  type Row = { axes: { key: string; value: string }[]; value: number };
  const { result } = JSON.parse(body) as { result?: Row[] };
  if (!Array.isArray(result)) {
    throw new Error(`no "result" array in the response: ${body.slice(0, 2000)}`);
  }

  const lines = result.map((row) => {
    const axes = Object.fromEntries(row.axes.map((a) => [a.key, a.value]));
    return { request: Number(axes.Request), axes, value: row.value };
  });
  lines.sort((a, b) => a.request - b.request);
  const keys = [...new Set(result.flatMap((row) => row.axes.map((a) => a.key)))];
  const widths = keys.map((k) =>
    Math.max(k.length, ...lines.map((l) => (l.axes[k] ?? "").length)),
  );
  console.log([...keys.map((k, i) => k.padEnd(widths[i])), "value"].join("  "));
  for (const line of lines) {
    const cells = keys.map((k, i) => (line.axes[k] ?? "").padEnd(widths[i]));
    console.log([...cells, String(line.value)].join("  "));
  }
  if (outPath) console.log(`\nraw response: ${outPath}`);
}

await allocate(Bun.argv.slice(2));
