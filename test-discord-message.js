require("dotenv").config({ path: ".env.test" });
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(process.env.DISCORD_TEST_CHANNEL_ID);

  await channel.send("🎴 Lorcana test bot message received! Phase 1 Discord test is working.");

  console.log("Test message sent.");
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);