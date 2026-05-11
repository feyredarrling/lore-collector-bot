/**
 * Twitch Redeem Test Listener
 *
 * Purpose:
 * - Listens for Twitch Channel Point redeems in the TEST environment.
 * - Pulls a Lorcana card from a selected set.
 * - Writes card/collection updates to the TEST Supabase project.
 * - Posts results to the TEST Discord channel using the TEST Discord bot.
 *
 * Safety:
 * - This file should only run with .env.test.
 * - BOT_MODE must be "test" or the script will stop.
 * - Twitch chat and overlay output are controlled by feature flags.
 *
 * Current flow:
 * Twitch Channel Point Redeem
 * → EventSub WebSocket
 * → identify reward/set
 * → pull random card
 * → add/update TEST collection
 * → post TEST Discord embed
 * → prepare Twitch chat + overlay data if enabled
 */


require("dotenv").config({ path: ".env.test" });

const lorcana = require("./lib/lorcana");


// Twitch IRC chat client used for sending messages into Twitch chat.

const tmi = require('tmi.js');


// Feature flags:
// Keep these OFF while testing during a live stream.
// They let us build Twitch chat and overlay features without accidentally posting publicly.

const TWITCH_CHAT_ENABLED = process.env.TWITCH_CHAT_ENABLED === "true";
const OVERLAY_ENABLED = process.env.OVERLAY_ENABLED === "true";
const OVERLAY_MODE = process.env.OVERLAY_MODE || "log";

// =====================================================
// Twitch Chat Client
// Sends Lorcana pull announcements into Twitch chat.
// Uses a separate OAuth token from EventSub.
// =====================================================

const twitchChatClient = new tmi.Client({
  options: {
    debug: true
  },

  identity: {
    username: process.env.TWITCH_CHAT_USERNAME,
    password: process.env.TWITCH_CHAT_OAUTH
  },

  channels: [process.env.TWITCH_CHAT_CHANNEL]
});



function getSetFromRewardTitle(rewardTitle) {
  const title = rewardTitle.toLowerCase();

  if (title.includes("the first chapter")) return "The First Chapter";
  if (title.includes("rise of the floodborn")) return "Rise of the Floodborn";
  if (title.includes("into the inklands")) return "Into the Inklands";
  if (title.includes("ursula")) return "Ursula's Return";
  if (title.includes("shimmering skies")) return "Shimmering Skies";
  if (title.includes("azurite sea")) return "Azurite Sea";

  return null;
}



const WebSocket = require("ws");
const { Client, GatewayIntentBits } = require("discord.js");

if (process.env.BOT_MODE !== "test") {
  throw new Error("Safety stop: BOT_MODE must be test.");
}

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function postToDiscord(payload) {
  const channel = await discordClient.channels.fetch(
    process.env.DISCORD_TEST_CHANNEL_ID
  );

  await channel.send(payload);
}

async function postToTwitchChat(message) {
  if (!TWITCH_CHAT_ENABLED) {
    console.log("Twitch chat disabled. Would have posted:", message);
    return;
  }

  // Sends the finalized Lorcana pull message into Twitch chat.
  await twitchChatClient.say(process.env.TWITCH_CHAT_CHANNEL, message);
}

async function handleOverlayData(data) {
  if (!OVERLAY_ENABLED) {
    console.log("Overlay disabled.");
    return;
  }

  if (OVERLAY_MODE === "log") {
    console.log("Overlay Payload:", JSON.stringify(data, null, 2));
    return;
  }

  console.log(`Unknown overlay mode: ${OVERLAY_MODE}`);
}

async function subscribeToChannelPointRedeems(sessionId) {
  const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
    method: "POST",
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "channel.channel_points_custom_reward_redemption.add",
      version: "1",
      condition: {
        broadcaster_user_id: process.env.TWITCH_BROADCASTER_ID,
      },
      transport: {
        method: "websocket",
        session_id: sessionId,
      },
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    console.error("Twitch subscription error:", body);
    throw new Error("Could not subscribe to Twitch redeems.");
  }

  console.log("Subscribed to Twitch Channel Point redeems.");
}

function connectToTwitchEventSub() {
  const ws = new WebSocket("wss://eventsub.wss.twitch.tv/ws");

  ws.on("open", () => {
    console.log("Connected to Twitch EventSub WebSocket.");
  });

  ws.on("message", async (rawData) => {
    const message = JSON.parse(rawData.toString());

    if (message.metadata.message_type === "session_welcome") {
      const sessionId = message.payload.session.id;
      console.log("Twitch session ID:", sessionId);

      await subscribeToChannelPointRedeems(sessionId);
      await postToDiscord("🎴 Twitch redeem test listener is online.");
      return;
    }

    if (message.metadata.message_type === "notification") {
      const event = message.payload.event;

      const viewerName = event.user_name;
      const rewardTitle = event.reward.title;

      console.log("Redeem received:", viewerName, rewardTitle);

      const isLorcanaTestReward = rewardTitle.startsWith("TEST Pull:");

if (!isLorcanaTestReward) {
  console.log(`Ignoring non-Lorcana reward: ${rewardTitle}`);
  return;
}

const setName = getSetFromRewardTitle(rewardTitle);

if (!setName) {
  console.log(`Ignoring unknown Lorcana test reward: ${rewardTitle}`);
  return;
}

const pulledCard = lorcana.getRandomCardFromSet(setName);

const viewerId = event.user_id;

const addResult = await lorcana.addCardToCollection(
  viewerId,
  viewerName,
  pulledCard.id
);

const pullMessage = lorcana.getPullMessage(
  pulledCard,
  addResult.isNew
);

if (!pulledCard) {
  await postToDiscord(
    `❌ No cards found for set: ${setName}`
  );
  return;
}

const embed = lorcana.createSingleCardEmbed({
  username: viewerName,
  card: pulledCard,
  isNew: addResult.isNew,
  quantity: addResult.quantity,
  titlePrefix: 'Twitch Pull: '
});

const overlayData = lorcana.createOverlayPullData({
  username: viewerName,
  card: pulledCard,
  setName,
  isNew: addResult.isNew,
  quantity: addResult.quantity
});

await handleOverlayData(overlayData);

await postToDiscord({ embeds: [embed] });

await postToTwitchChat(
  lorcana.createTwitchPullMessage({
    username: viewerName,
    card: pulledCard,
    setName
  })
);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on("close", () => {
    console.log("Twitch EventSub WebSocket closed.");
  });
}

discordClient.once("ready", async () => {
  console.log(`Discord logged in as ${discordClient.user.tag}`);

  // Connects to Twitch chat only when chat posting is enabled.
  // This keeps testing safe when TWITCH_CHAT_ENABLED=false.
  if (TWITCH_CHAT_ENABLED) {
    await twitchChatClient.connect();
    console.log("Twitch chat client connected.");
  }

  connectToTwitchEventSub();
});

discordClient.login(process.env.DISCORD_TOKEN);