require("dotenv").config({ path: ".env.test" });

const lorcana = require("./lib/lorcana");



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

      const setName = getSetFromRewardTitle(rewardTitle);

if (!setName) {
  await postToDiscord(
    `❌ Unknown set for reward: ${rewardTitle}`
  );
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

await postToDiscord({ embeds: [embed] });
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  ws.on("close", () => {
    console.log("Twitch EventSub WebSocket closed.");
  });
}

discordClient.once("ready", () => {
  console.log(`Discord logged in as ${discordClient.user.tag}`);
  connectToTwitchEventSub();
});

discordClient.login(process.env.DISCORD_TOKEN);