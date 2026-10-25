const { createTwitch, loadStoredTokens, TOKEN_FILE } = require('../src/twitch');

const timeoutMs = 60_000;
async function main() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const channel = process.env.TWITCH_CHANNEL;
  if (!clientId || !channel) throw new Error('Set TWITCH_CLIENT_ID and TWITCH_CHANNEL first.');
  const tokens = await loadStoredTokens(TOKEN_FILE);
  console.log('Step 1/5: stored token loaded (token values hidden).');
  let reportFailure;
  const failure = new Promise((_, reject) => { reportFailure = reject; });
  let gotMessage;
  const message = new Promise(resolve => { gotMessage = resolve; });
  let client; let timeout;
  try {
    client = await createTwitch(clientId, channel, event => {
      console.log(`Step 5/5: received chat from ${event.user}: ${event.text}`);
      gotMessage(event);
    }, status => {
      console.log(status);
      if (status.startsWith('EventSub subscription refused')) reportFailure(new Error(status));
      if (status.startsWith('Connected to Twitch chat')) console.log('Step 4/5: EventSub subscription active; waiting for a chat message.');
    }, { tokens, tokenFile: TOKEN_FILE });
    await Promise.race([message, failure, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Timed out after 60 seconds without a chat message.')), timeoutMs); })]);
  } finally {
    clearTimeout(timeout);
    client?.close();
  }
}

main().catch(error => { console.error(`Twitch check failed: ${error.message}`); process.exitCode = 1; });
