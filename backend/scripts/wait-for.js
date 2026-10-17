// Usage: node scripts/wait-for.js <url> [timeoutSeconds]
// Polls a URL until it answers with any HTTP status, so launchers can open the browser at the right moment.
const [url, seconds = '60'] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node scripts/wait-for.js <url> [timeoutSeconds]');
  process.exit(2);
}
const deadline = Date.now() + Number(seconds) * 1000;
for (;;) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    process.exit(0);
  } catch {
    if (Date.now() > deadline) process.exit(1);
    await new Promise((r) => setTimeout(r, 750));
  }
}
