import { parseEmailFile } from '../../dist/index.js';

// Use the built public entrypoint, as the root CI build does before running tests.
// Keeping parsing in a child lets the parent interrupt a blocking parser regression.
const parsed = await parseEmailFile(process.argv[2]);
process.stdout.write(JSON.stringify({
  messageId: parsed.messageId,
  bodyLength: parsed.bodyText.length,
  recipientCount: parsed.to.length,
}));
