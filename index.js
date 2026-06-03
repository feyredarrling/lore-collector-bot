/**
 * The Lore Collector - Live Discord Bot
 *
 * Purpose:
 * Main Discord bot for Lorcana card collecting.
 *
 * Handles:
 * - /daily card claims
 * - /balance
 * - /pack
 * - /collection binder
 * - /dupes
 * - /leaderboard
 * - pack reveal buttons
 *
 * Environment:
 * - Production normally runs on Railway using .env.
 * - Local testing can run with NODE_ENV=test to load .env.test.
 *
 * Safety Notes:
 * - Do not commit .env or .env.test.
 * - ALLOWED_CHANNEL_IDS controls where commands can run.
 * - Supabase keys decide whether the bot writes to live or test data.
 *
 * Shared Logic:
 * Reusable Lorcana helpers live in lib/lorcana.js.
 */


// Loads environment variables.
// NODE_ENV=test loads .env.test for safe local testing.
// Otherwise, the bot uses .env for production/Railway.

require('dotenv').config({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env'
});


// Shared Lorcana game logic used by both the live Discord bot and Twitch testing.

const lorcana = require('./lib/lorcana');


// File system access for loading card data.

const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const tmi = require('tmi.js');
const express = require('express');

// Sharp is used to generate collection binder images.

const sharp = require('sharp');

// Discord.js tools used for slash commands, embeds, buttons, and image attachments.

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  PermissionsBitField
} = require('discord.js');


// Supabase client used for users, cards, daily claims, ink balances, and leaderboards.

const { createClient } = require('@supabase/supabase-js');


// Twitch feature flags.
// These keep Twitch chat and overlay behavior controlled by .env / .env.test.

const TWITCH_CHAT_ENABLED = process.env.TWITCH_CHAT_ENABLED === 'true';
const TWITCH_EVENTSUB_ENABLED = process.env.TWITCH_EVENTSUB_ENABLED === 'true';
const OVERLAY_ENABLED = process.env.OVERLAY_ENABLED === 'true';
const OVERLAY_MODE = process.env.OVERLAY_MODE || 'log';
const OVERLAY_DISPLAY_MS = Number(process.env.OVERLAY_DISPLAY_MS || 9000);
let twitchAccessToken = process.env.TWITCH_ACCESS_TOKEN;


// Web server settings used for Twitch OAuth callbacks.
// PORT is required for hosting platforms like Railway.

const PORT = process.env.PORT || 3000;
const TWITCH_REDIRECT_URI = process.env.TWITCH_REDIRECT_URI;
const TWITCH_LINK_TTL_MS = 10 * 60 * 1000;
const TWITCH_PULL_DISCORD_CHANNEL_ID =
  process.env.TWITCH_PULL_DISCORD_CHANNEL_ID ||
  process.env.DISCORD_TEST_CHANNEL_ID;


// Economy settings.
// These control ink rewards and pack costs.

const DAILY_INK_REWARD = 20;
const STANDARD_PACK_COST = 100;
const PREMIUM_PACK_COST = 250;
const MOTHERS_DAY_PACK_COST = 200;
const COLLECTION_PAGE_SIZE = 20;
const EVENT_TIMEZONE = 'America/New_York';


// Restricts where bot commands can run.
// Production and testing environments each use different channel IDs
// through .env / .env.test.

// Prevents the bot from being spammed across unrelated channels.
// Production and testing environments intentionally use different channel lists.

const ALLOWED_CHANNELS = (process.env.ALLOWED_CHANNEL_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);


// Special event card pool.
// These names are used to build the limited Mother's Day pack
// from the full cards.json list.

const MOTHERS_DAY_CARD_NAMES = [
  'Alma Madrigal - Accepting Grandmother',
  'Alma Madrigal - Family Matriarch',
  'Alma Madrigal - Heart of the Family',
  'Alma Madrigal - Keeper of the Flame',
  'Alma Madrigal - Leading the Way',
  'Big Mama - Clever and Calming',
  'Chicha - Dedicated Mother',
  'Della Duck - Returning Mother',
  'Eudora - Accomplished Seamstress',
  'Fa Li - Mulan’s Mother',
  'Grandmother Fa - Spirited Elder',
  'Grandmother Willow - Ancient Advisor',
  'Iduna - Caring Mother',
  'Julieta Madrigal - Caring Baker',
  'Julieta Madrigal - Excellent Cook',
  'Kanga - Nurturing Mother',
  'Minnie Mouse - Tiny Tim\'s Mother',
  'Mrs. Incredible - Helen Parr',
  'Mrs. Potts - Enchanted Teapot',
  'Mrs. Potts - Head Housekeeper',
  'Nani - Caring Sister',
  'Nani - No Worries',
  'Nani - Protective Sister',
  'Perdita - Determined Mother',
  'Perdita - Devoted Mother',
  'Perdita - On the Lookout',
  'Perdita - Playful Mother',
  'Raksha - Fearless Mother',
  'Sarabi - Protecting the Pride',
  'Sina - Vigilant Parent'
];


// Full Lorcana card database loaded from local JSON.

const cards = JSON.parse(fs.readFileSync('./data/cards.json', 'utf8'));

const mothersDayPool = cards.filter(card =>
  MOTHERS_DAY_CARD_NAMES.includes(card.name)
);

const COLLECTION_SET_CHOICES = [...new Set(cards.map(card => card.set).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b));

const COLLECTION_RARITY_CHOICES = [
  'Common',
  'Uncommon',
  'Rare',
  'Super Rare',
  'Epic',
  'Legendary',
  'Enchanted',
  'Promo'
];


// Supabase database connection.
// Environment variables determine whether this points to LIVE or TEST data.

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// =====================================================
// Twitch Chat Client
// Sends Lorcana pull announcements into Twitch chat.
// Controlled by TWITCH_CHAT_ENABLED.
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


// Main Discord bot client connection.

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});


// =====================================================
// Express Web Server
// Handles Twitch OAuth callback routes.
// =====================================================

const app = express();
const overlayClients = new Set();

function sendOverlayEvent(data) {
  const payload = `event: pull\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of overlayClients) {
    client.write(payload);
  }
}

function createOverlayHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>The Lore Collector Overlay</title>
  <style>
    :root {
      --gold: #f4c76b;
      --gold-bright: #ffe6a0;
      --ink: #120a1d;
      --plum: #2b1646;
      --violet: #a45cff;
      --panel: rgba(16, 9, 30, 0.92);
      --panel-soft: rgba(49, 24, 78, 0.88);
      --shadow: rgba(0, 0, 0, 0.48);
    }

    * { box-sizing: border-box; }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: transparent;
      font-family: "Segoe UI", Arial, sans-serif;
      color: var(--ink);
    }

    body {
      position: relative;
      padding: 36px;
    }

    .pull {
      position: absolute;
      top: 50%;
      left: 50%;
      width: min(500px, calc(100vw - 72px));
      display: grid;
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 12px;
      padding: 0;
      background: transparent;
      opacity: 0;
      transform: translate(-50%, -44%);
      transition: opacity 360ms ease, transform 360ms ease;
    }

    .pull.show {
      opacity: 1;
      transform: translate(-50%, -50%);
    }

    .card-image {
      width: min(300px, 36vw, 42vh);
      aspect-ratio: 734 / 1024;
      border: 3px solid var(--gold);
      border-radius: 18px;
      object-fit: cover;
      background: #21182d;
      box-shadow:
        0 0 0 6px rgba(18, 10, 29, 0.78),
        0 0 34px rgba(244, 199, 107, 0.38),
        0 24px 70px var(--shadow);
    }

    .pull > div {
      width: 100%;
      position: relative;
      padding: 12px 16px 14px;
      border: 2px solid rgba(244, 199, 107, 0.86);
      border-radius: 10px;
      background:
        linear-gradient(180deg, rgba(61, 28, 95, 0.72), rgba(12, 8, 26, 0.96)),
        radial-gradient(circle at 50% 0%, rgba(164, 92, 255, 0.28), transparent 48%);
      text-align: center;
    }

    .eyebrow {
      display: inline-block;
      margin: -24px 0 7px;
      padding: 4px 15px;
      font-size: 10px;
      font-weight: 700;
      color: #f7e6c7;
      font-style:italic;
    }

    .card-name {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(18px, 2.8vw, 28px);
      line-height: 0.95;
      font-weight: 900;
      color: var(--gold-bright);
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 9px;
      margin-top: 20px;
      font-size: 10px;
      font-weight: 700;
    }

    .pill {
      min-width: 92px;
      padding: 5px 8px;
      border: 2px solid rgba(164, 92, 255, 0.82);
      border-radius: 7px;
      color: #f5dcff;
    }

    @media (max-width: 640px) {
      body { padding: 18px; }

      .pull {
        width: calc(100vw - 36px);
        gap: 12px;
      }

      .card-image { width: min(230px, 58vw, 40vh); }
      .eyebrow { font-size: 10px; }
      .card-name { font-size: 21px; }
      .meta { font-size: 10px; }
    }
  </style>
</head>
<body>
  <section id="pull" class="pull" aria-live="polite">
    <img id="cardImage" class="card-image" alt="">
    <div>
      <p id="eyebrow" class="eyebrow"></p>
      <h1 id="cardName" class="card-name"></h1>
      <div class="meta">
        <span id="rarity" class="pill"></span>
        <span id="setName" class="pill"></span>
      </div>
    </div>
  </section>

  <script>
    const displayMs = ${OVERLAY_DISPLAY_MS};
    const pull = document.getElementById('pull');
    const cardImage = document.getElementById('cardImage');
    const eyebrow = document.getElementById('eyebrow');
    const cardName = document.getElementById('cardName');
    const rarity = document.getElementById('rarity');
    const setName = document.getElementById('setName');
    let hideTimer = null;

    function showPull(data) {
      const card = data.card || {};
      cardImage.src = card.image || '';
      cardImage.alt = card.name || 'Pulled Lorcana card';
      eyebrow.textContent = (data.username || 'Someone') + ' pulled';
      cardName.textContent = card.name || 'Unknown Card';
      rarity.textContent = (data.rarityEmoji || '') + ' ' + (card.rarity || 'Unknown');
      setName.textContent = data.setName || card.set || 'Unknown Set';

      clearTimeout(hideTimer);
      pull.classList.add('show');
      hideTimer = setTimeout(() => pull.classList.remove('show'), displayMs);
    }

    const events = new EventSource('/overlay/events');
    events.addEventListener('pull', event => showPull(JSON.parse(event.data)));
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createTwitchLinkResultHtml({
  status = 'success',
  eyebrow = 'The Lore Collector',
  title,
  message,
  details = [],
  action = 'You can return to Discord now.'
}) {
  const isSuccess = status === 'success';
  const statusColor = isSuccess ? 'var(--success)' : 'var(--error)';
  const detailItems = details
    .filter(Boolean)
    .map(item => `<li>${escapeHtml(item)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title || 'Twitch Link Status')}</title>
  <style>
    :root {
      --bg: #171322;
      --panel: rgba(34, 27, 48, 0.94);
      --panel-strong: rgba(22, 18, 32, 0.98);
      --border: #d9c78f;
      --gold: #f4d37c;
      --text: #f8f0dc;
      --muted: #c9bdd8;
      --success: #38d675;
      --error: #ff6b7d;
    }

    * { box-sizing: border-box; }

    html,
    body {
      width: 100%;
      min-height: 100%;
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      color: var(--text);
      background:
        linear-gradient(135deg, rgba(16, 12, 24, 0.96), rgba(31, 24, 45, 0.98)),
        radial-gradient(circle at 50% 0%, rgba(244, 211, 124, 0.14), transparent 46%);
    }

    body {
      display: grid;
      place-items: center;
      padding: 28px;
    }

    main {
      width: min(620px, 100%);
      padding: 28px;
      border: 2px solid rgba(217, 199, 143, 0.82);
      border-radius: 10px;
      background:
        linear-gradient(180deg, rgba(49, 39, 68, 0.88), var(--panel-strong));
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
      text-align: center;
    }

    .mark {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      margin: 0 auto 16px;
      border: 2px solid var(--status);
      border-radius: 50%;
      color: var(--status);
      font-size: 30px;
      font-weight: 900;
      line-height: 1;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--gold);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(28px, 7vw, 46px);
      line-height: 1;
      color: var(--text);
    }

    .message {
      margin: 16px auto 0;
      max-width: 48ch;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.5;
    }

    ul {
      width: min(440px, 100%);
      margin: 22px auto 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 8px;
    }

    li {
      padding: 10px 12px;
      border: 1px solid rgba(217, 199, 143, 0.34);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text);
      font-weight: 700;
    }

    .action {
      margin: 24px 0 0;
      padding-top: 18px;
      border-top: 1px solid rgba(217, 199, 143, 0.26);
      color: var(--gold);
      font-weight: 800;
    }

    @media (max-width: 520px) {
      body { padding: 18px; }
      main { padding: 22px 18px; }
      h1 { font-size: 30px; }
      .message { font-size: 15px; }
    }
  </style>
</head>
<body>
  <main style="--status: ${statusColor};">
    <div class="mark" aria-hidden="true">${isSuccess ? '&check;' : '!'}</div>
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <h1>${escapeHtml(title || 'Twitch Link Status')}</h1>
    <p class="message">${escapeHtml(message || '')}</p>
    ${detailItems ? `<ul>${detailItems}</ul>` : ''}
    <p class="action">${escapeHtml(action)}</p>
  </main>
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.send('The Lore Collector bot is running 🎴');
});


// =====================================================
// Overlay Routes
// Provides an OBS browser source and a Server-Sent Events stream.
// =====================================================

app.get('/overlay', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(createOverlayHtml());
});

app.get('/overlay/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write('event: ready\ndata: {}\n\n');
  overlayClients.add(res);

  req.on('close', () => {
    overlayClients.delete(res);
  });
});

app.get('/overlay/test', (req, res) => {
  const card = lorcana.cards.find(item => item.image) || lorcana.cards[0];
  const payload = lorcana.createOverlayPullData({
    username: 'FeyreDarrling',
    card,
    setName: card.set,
    isNew: true,
    quantity: 1
  });

  sendOverlayEvent(payload);
  res.json({ ok: true, payload });
});


// =====================================================
// Twitch OAuth Callback
// Twitch redirects users here after authorization.
// =====================================================

app.get('/auth/twitch/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error('Twitch OAuth error:', error, error_description);
      res.status(400).send(createTwitchLinkResultHtml({
        status: 'error',
        title: 'Link Canceled',
        message: 'Twitch authorization was canceled or could not be completed.',
        action: 'Return to Discord and start the link again when you are ready.'
      }));
      return;
    }

    if (!code || !state) {
      res.status(400).send(createTwitchLinkResultHtml({
        status: 'error',
        title: 'Missing Link Details',
        message: 'The Twitch callback did not include the details needed to finish linking.',
        action: 'Return to Discord and try the Link Twitch Account button again.'
      }));
      return;
    }

    const pendingLink = pendingTwitchLinks.get(state);

    if (!pendingLink || pendingLink.expiresAt < Date.now()) {
      pendingTwitchLinks.delete(state);
      res.status(400).send(createTwitchLinkResultHtml({
        status: 'error',
        title: 'Link Expired',
        message: 'This Twitch link request expired before it could be completed.',
        action: 'Return to Discord and press Link Twitch Account again.'
      }));
      return;
    }

    pendingTwitchLinks.delete(state);
    const discordUserId = pendingLink.discordUserId;

    // Exchanges the temporary Twitch authorization code for an access token.
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TWITCH_REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Twitch token exchange failed:', tokenData);
      res.status(500).send(createTwitchLinkResultHtml({
        status: 'error',
        title: 'Twitch Verification Failed',
        message: 'Twitch responded, but the bot could not verify the authorization code.',
        action: 'Please try linking again. If it keeps happening, contact the channel owner.'
      }));
      return;
    }

    // Uses the verified Twitch access token to fetch the authorized user's profile.
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-Id': process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    const userData = await userResponse.json();

    if (!userResponse.ok || !userData.data || userData.data.length === 0) {
      console.error('Twitch user lookup failed:', userData);
      res.status(500).send(createTwitchLinkResultHtml({
        status: 'error',
        title: 'Could Not Verify Twitch',
        message: 'The bot could not confirm which Twitch account authorized the link.',
        action: 'Please try linking again from Discord.'
      }));
      return;
    }

    const twitchUser = userData.data[0];

    console.log('Verified Twitch user:', {
      discordUserId,
      twitchUserId: twitchUser.id,
      twitchUsername: twitchUser.login,
      twitchDisplayName: twitchUser.display_name
    });

    // Saves the verified Twitch account connection.
    // This lets future Twitch redeems route into the correct Discord collection.

    const { error: linkError } = await supabase
      .from('linked_accounts')
      .upsert({
        discord_user_id: discordUserId,
        twitch_user_id: twitchUser.id,
        twitch_username: twitchUser.login,
        linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'discord_user_id'
      });

    if (linkError) {
      console.error('Failed to save linked Twitch account:', linkError);
      res.status(500).send(createTwitchLinkResultHtml({
        status: 'error',
        title: 'Link Save Failed',
        message: 'Twitch verified your account, but the bot could not save the Discord connection.',
        action: 'Please contact the channel owner before trying again.'
      }));
      return;
    }

    // Merges any Twitch-only pulls into the linked Discord collection.

    const mergeResult = await lorcana.mergeTwitchCollectionIntoDiscord(
      supabase,
      twitchUser.id,
      discordUserId,
      twitchUser.display_name
    );

    if (!mergeResult.success) {
      console.error('Failed to merge Twitch collection.');
      res.status(500).send(createTwitchLinkResultHtml({
        status: 'error',
        title: 'Merge Failed',
        message: 'Your Twitch account linked, but merging your saved Twitch cards failed.',
        action: 'Please contact the channel owner before linking again.'
      }));
      return;
    }

    res.send(createTwitchLinkResultHtml({
      status: 'success',
      title: 'Twitch Linked',
      message: `${twitchUser.display_name} is now connected to your Discord collection.`,
      details: [
        `Merged ${mergeResult.mergedCount} Twitch card(s) into your Discord collection.`,
        'Future Twitch pulls will save to your Discord collection automatically.'
      ],
      action: 'You can return to Discord now.'
    }));
  } catch (error) {
    console.error('Twitch OAuth callback failed:', error);
    res.status(500).send(createTwitchLinkResultHtml({
      status: 'error',
      title: 'Something Went Wrong',
      message: 'Something went wrong while linking Twitch.',
      action: 'Please return to Discord and try again.'
    }));
  }
});


// Temporary in-memory state for interactive Discord button flows.
// These reset when the bot restarts.

// Stores pack reveal progress by user ID.
const pendingPacks = new Map();
// Stores collection page/binder state by user ID.
const pendingCollections = new Map();
// Stores short-lived Twitch OAuth state nonces by random token.
const pendingTwitchLinks = new Map();


// Slash commands registered with Discord.
// These define the commands users can run in the server.

const commands = [
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily card and Ink for this server'),
  new SlashCommandBuilder().setName('balance').setDescription('Check your Ink balance'),
  new SlashCommandBuilder()
    .setName('collection')
    .setDescription('View your Lorcana collection binder')
    .addStringOption(option =>
      option
        .setName('set')
        .setDescription('Show only one Lorcana set')
        .setRequired(false)
        .addChoices(
          { name: 'All Sets', value: 'all' },
          ...COLLECTION_SET_CHOICES.map(setName => ({
            name: setName,
            value: setName
          }))
        )
    )
    .addStringOption(option =>
      option
        .setName('rarity')
        .setDescription('Show only one card rarity')
        .setRequired(false)
        .addChoices(
          { name: 'All Rarities', value: 'all' },
          ...COLLECTION_RARITY_CHOICES.map(rarity => ({
            name: rarity,
            value: rarity
          }))
        )
    ),
  new SlashCommandBuilder().setName('dupes').setDescription('View your duplicate Lorcana cards'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('View top collectors and richest players'),
  new SlashCommandBuilder().setName('pack').setDescription('Choose and open a Lorcana card pack'),
  new SlashCommandBuilder().setName('lore').setDescription('How to play The Lore Collector'),
  new SlashCommandBuilder()
  .setName('mothersday')
  .setDescription('Claim your free Mother’s Day Pack'),
  new SlashCommandBuilder()
  .setName('announcement-set')
  .setDescription('Admin only: set a rotating channel announcement')
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('Announcement message')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option
      .setName('interval_hours')
      .setDescription('How often to repost the announcement')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('end_at')
      .setDescription('When to stop, like 2026-05-10 00:00')
      .setRequired(false)
  ),

new SlashCommandBuilder()
  .setName('announcement-stop')
  .setDescription('Admin only: stop the rotating announcement'),

new SlashCommandBuilder()
  .setName('announcement-status')
  .setDescription('Admin only: view the active rotating announcement')
].map(command => command.toJSON());


// Discord requires slash commands to be converted to JSON before registration.


// REST client used to register/update slash commands with Discord.

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);


// Registers slash commands globally with Discord when the bot starts.
// Global commands can take a little time to update in Discord.

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );

    console.log('Global commands registered');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();

const lastAnnouncementMessages = new Map();
let missingAnnouncementsTableLogged = false;

async function processAnnouncements() {

  const { data: announcement, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', 'global')
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST205' && error.message?.includes("table 'public.announcements'")) {
      if (!missingAnnouncementsTableLogged) {
        console.log('Announcements table is not available; skipping rotating announcements.');
        missingAnnouncementsTableLogged = true;
      }
      return;
    }

    console.error('Failed to load announcement:', error);
    return;
  }

  if (!announcement || !announcement.is_active) {
    return;
  }

  // Stop if expired
  if (
    announcement.end_at &&
    new Date() > new Date(announcement.end_at)
  ) {
    await supabase
      .from('announcements')
      .update({
        is_active: false
      })
      .eq('id', 'global');

    return;
  }

  const now = new Date();

  const lastPosted = announcement.last_posted_at
    ? new Date(announcement.last_posted_at)
    : null;

  const intervalMs =
    announcement.interval_hours * 60 * 60 * 1000;

  const shouldPost =
    !lastPosted ||
    now - lastPosted >= intervalMs;

  if (!shouldPost) {
    return;
  }

  for (const channelId of ALLOWED_CHANNELS) {

    try {

      const channel = await client.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        continue;
      }

      const { data: savedMessage } = await supabase
  .from('announcement_messages')
  .select('message_id')
  .eq('announcement_id', announcement.id)
  .eq('channel_id', channelId)
  .maybeSingle();

if (savedMessage?.message_id) {
  try {
    const previousMessage = await channel.messages.fetch(savedMessage.message_id);
    await previousMessage.delete();
  } catch {
    // Ignore if the old message was already deleted
  }
}

const newMessage = await channel.send({
  content: announcement.message,
  components: [createAnnouncementButtons()]
});

await supabase
  .from('announcement_messages')
  .upsert({
    announcement_id: announcement.id,
    channel_id: channelId,
    message_id: newMessage.id
  });

    } catch (error) {

      console.error(
        `Failed posting announcement in ${channelId}:`,
        error
      );

    }

  }

  await supabase
    .from('announcements')
    .update({
      last_posted_at: now.toISOString()
    })
    .eq('id', 'global');

}

client.once('clientReady', async () => {

  console.log(`Logged in as ${client.user.tag}`);

  processAnnouncements();

  setInterval(
    processAnnouncements,
    5 * 60 * 1000
  );

  if (TWITCH_CHAT_ENABLED) {
    await twitchChatClient.connect();
    console.log('Twitch chat client connected.');
  }

  if (TWITCH_EVENTSUB_ENABLED) {
    await refreshTwitchAccessTokenIfConfigured();
    connectToTwitchEventSub();
  } else {
    console.log('Twitch EventSub disabled by TWITCH_EVENTSUB_ENABLED.');
  }
});

// =====================================================
// Twitch Reward Helpers
// Identifies which Lorcana set a Twitch channel point reward belongs to.
// =====================================================

function getSetFromRewardTitle(rewardTitle) {
  const title = rewardTitle.toLowerCase();

  if (title.includes('the first chapter')) return 'The First Chapter';
  if (title.includes('rise of the floodborn')) return 'Rise of the Floodborn';
  if (title.includes('into the inklands')) return 'Into the Inklands';
  if (title.includes('ursula')) return "Ursula's Return";
  if (title.includes('shimmering skies')) return 'Shimmering Skies';
  if (title.includes('azurite sea')) return 'Azurite Sea';
  if (title.includes('fabled')) return 'Fabled';

  return null;
}

function isLorcanaPullReward(rewardTitle) {
  return /^test pull:/i.test(rewardTitle) || /^pull:/i.test(rewardTitle);
}

/**
 * Builds the Twitch OAuth authorization URL.
 * Users visit this link to securely connect their Twitch account.
 */
function createTwitchLinkState(discordUserId) {
  const state = crypto.randomBytes(24).toString('hex');

  pendingTwitchLinks.set(state, {
    discordUserId,
    expiresAt: Date.now() + TWITCH_LINK_TTL_MS
  });

  return state;
}

function cleanupExpiredTwitchLinks() {
  const now = Date.now();

  for (const [state, pendingLink] of pendingTwitchLinks.entries()) {
    if (pendingLink.expiresAt < now) {
      pendingTwitchLinks.delete(state);
    }
  }
}

function buildTwitchOAuthUrl(discordUserId) {
  cleanupExpiredTwitchLinks();
  const state = createTwitchLinkState(discordUserId);

  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: 'code',
    scope: '',
    state
  });

  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}


/**
 * Sends a message into Twitch chat if Twitch chat posting is enabled.
 */
async function postToTwitchChat(message) {
  if (!TWITCH_CHAT_ENABLED) {
    console.log('Twitch chat disabled. Would have posted:', message);
    return;
  }

  await twitchChatClient.say(process.env.TWITCH_CHAT_CHANNEL, message);
}


/**
 * Fetches the Discord channel where Twitch pull embeds should be posted.
 */
async function fetchTwitchPullDiscordChannel() {
  if (!TWITCH_PULL_DISCORD_CHANNEL_ID) {
    throw new Error('TWITCH_PULL_DISCORD_CHANNEL_ID is required when Twitch redeems are enabled.');
  }

  return client.channels.fetch(TWITCH_PULL_DISCORD_CHANNEL_ID);
}


/**
 * Handles overlay payload output.
 * Currently only logs locally for testing.
 */
async function handleOverlayData(data) {
  if (!OVERLAY_ENABLED) {
    console.log('Overlay disabled.');
    return;
  }

  sendOverlayEvent(data);

  if (OVERLAY_MODE === 'log') {
    console.log('Overlay Payload:', JSON.stringify(data, null, 2));
    return;
  }

  if (OVERLAY_MODE === 'browser') {
    console.log(`Overlay event sent to ${overlayClients.size} client(s).`);
    return;
  }

  console.log(`Unknown overlay mode: ${OVERLAY_MODE}`);
}


/**
 * Refreshes the broadcaster access token when a refresh token is configured.
 * This keeps EventSub startup from depending on a short-lived access token.
 */
async function refreshTwitchAccessTokenIfConfigured() {
  if (!process.env.TWITCH_REFRESH_TOKEN) {
    return;
  }

  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: process.env.TWITCH_REFRESH_TOKEN
  });

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Twitch token refresh failed:', {
      error: data.error,
      status: data.status,
      message: data.message
    });
    throw new Error('Could not refresh Twitch access token.');
  }

  twitchAccessToken = data.access_token;

  if (data.refresh_token && data.refresh_token !== process.env.TWITCH_REFRESH_TOKEN) {
    console.log('Twitch returned a new refresh token; update TWITCH_REFRESH_TOKEN in the production environment.');
  }

  console.log('Twitch access token refreshed.');
}


/**
 * Subscribes this bot session to Twitch channel point redeems.
 * Twitch sends redeem events through the active EventSub WebSocket session.
 */
async function subscribeToChannelPointRedeems(sessionId) {
  if (!twitchAccessToken) {
    throw new Error('TWITCH_ACCESS_TOKEN is required when Twitch EventSub is enabled.');
  }

  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${twitchAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: {
        broadcaster_user_id: process.env.TWITCH_BROADCASTER_ID
      },
      transport: {
        method: 'websocket',
        session_id: sessionId
      }
    })
  });

  const body = await response.json();

  if (!response.ok) {
    console.error('Twitch subscription error:', body);
    throw new Error('Could not subscribe to Twitch redeems.');
  }

  console.log('Subscribed to Twitch Channel Point redeems.');
}


/**
 * Opens the Twitch EventSub WebSocket connection.
 * This listens for channel point redeem notifications.
 */
function connectToTwitchEventSub() {
  const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

  ws.on('open', () => {
    console.log('Connected to Twitch EventSub WebSocket.');
  });

  ws.on('message', async rawData => {
    const message = JSON.parse(rawData.toString());

    if (message.metadata.message_type === 'session_welcome') {
      const sessionId = message.payload.session.id;
      console.log('Twitch session ID:', sessionId);

      try {
        await subscribeToChannelPointRedeems(sessionId);
      } catch (error) {
        console.error('Twitch EventSub subscription failed, but the bot will keep running:', error.message);
        return;
      }

      return;
    }

    if (message.metadata.message_type === 'notification') {
      const event = message.payload.event;

      const viewerName = event.user_name;
      const viewerId = event.user_id;
      const rewardTitle = event.reward.title;

      console.log('Redeem received:', viewerName, rewardTitle);

      const isLorcanaReward = isLorcanaPullReward(rewardTitle);

      if (!isLorcanaReward) {
        console.log(`Ignoring non-Lorcana reward: ${rewardTitle}`);
        return;
      }

      const setName = getSetFromRewardTitle(rewardTitle);

      if (!setName) {
        console.log(`Ignoring unknown Lorcana reward: ${rewardTitle}`);
        return;
      }

      const pulledCard = lorcana.getRandomCardFromSet(setName);

      if (!pulledCard) {
        const channel = await fetchTwitchPullDiscordChannel();
        await channel.send(`❌ No cards found for set: ${setName}`);
        return;
      }

      // Looks up the Twitch user in linked_accounts.
      // If linked, the card goes into their Discord collection.
      // If not linked, the card is stored in a Twitch-only collection for later merge.

      const { data: linkedAccount, error: linkedAccountError } = await supabase
        .from('linked_accounts')
        .select('*')
        .eq('twitch_user_id', viewerId)
        .maybeSingle();

      if (linkedAccountError) {
        console.error('Linked account lookup failed:', linkedAccountError);
        return;
      }

      if (!linkedAccount) {
        console.log(`No linked Discord account found for Twitch user ${viewerName}. Saving to Twitch collection.`);

        const twitchAddResult = await lorcana.addCardToTwitchCollection(
          supabase,
          viewerId,
          viewerName,
          pulledCard.id
        );

        if (!twitchAddResult) {
          console.error('Could not save unlinked Twitch pull.');
          return;
        }

        const embed = lorcana.createSingleCardEmbed({
          username: viewerName,
          card: pulledCard,
          isNew: twitchAddResult.isNew,
          quantity: twitchAddResult.quantity,
          titlePrefix: 'Twitch Pull: '
        });

        const overlayData = lorcana.createOverlayPullData({
          username: viewerName,
          card: pulledCard,
          setName,
          isNew: twitchAddResult.isNew,
          quantity: twitchAddResult.quantity
        });

        await handleOverlayData(overlayData);

        const channel = await fetchTwitchPullDiscordChannel();
        const discordChannelUrl =
          channel.url || `https://discord.com/channels/${channel.guildId}/${channel.id}`;

        await channel.send({
          content:
            `🎴 **${viewerName}**, your Twitch pull has been saved!\n\n` +
            `Link your Twitch account in Discord later to merge these cards into your main collection.`,
          embeds: [embed],
          components: [createTwitchLinkButtonRow()]
        });

        await postToTwitchChat(
          `${viewerName} pulled ${lorcana.rarityEmoji[pulledCard.rarity] || '🎴'} ${pulledCard.name}! Link Twitch in Discord to merge your collection: ${discordChannelUrl}`
        );

        return;
      }

      const discordCollectionUserId = linkedAccount.discord_user_id;

      const addResult = await lorcana.addCardToCollection(
        discordCollectionUserId,
        viewerName,
        pulledCard.id,
        { skipEnsureUser: true }
      );

      const embed = lorcana.createSingleCardEmbed({
        username: linkedAccount.twitch_username || viewerName,
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

      const channel = await fetchTwitchPullDiscordChannel();
      await channel.send({ embeds: [embed] });

      await postToTwitchChat(
        lorcana.createTwitchPullMessage({
          username: viewerName,
          card: pulledCard,
          setName
        })
      );
    }
  });

  ws.on('error', error => {
    console.error('WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('Twitch EventSub WebSocket closed.');
  });
}


// =====================================================
// Card Pull + Pack Generation Helpers
// Handles rarity rolls, pack creation, and pull messaging.
// =====================================================


// Checks whether the Mother's Day event pack should be available.
// Uses a fixed timezone so the event activates consistently for everyone.

function isMothersDayAvailable() {
  return false;
}


// Finds a specific card from cards.json by its unique card ID.

function getCardById(cardId) {
  return cards.find(card => card.id === cardId);
}


// Returns one random card from a provided card pool/array.

function getRandomCardFromPool(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}


// Pulls a random card matching a specific rarity.
// Falls back to the full card pool if no cards match.

function getRandomCardByRarity(rarity) {
  const pool = cards.filter(card => card.rarity === rarity);
  return pool.length ? getRandomCardFromPool(pool) : getRandomCardFromPool(cards);
}


// Handles rarity odds for standard packs.
// Controls chances for Rare, Super Rare, Legendary, and Enchanted pulls.


// Current standard pack odds:
// Enchanted: 1%
// Legendary: 5%
// Super Rare: 14%
// Rare: remaining chance

function getStandardRareOrBetterCard() {
  const roll = Math.random();

  if (roll < 0.01) return getRandomCardByRarity('Enchanted');
  if (roll < 0.06) return getRandomCardByRarity('Legendary');
  if (roll < 0.20) return getRandomCardByRarity('Super Rare');

  return getRandomCardByRarity('Rare');
}


// Handles boosted rarity odds for premium packs.


// Current premium pack odds:
// Enchanted: 5%
// Legendary: 10%
// Super Rare: 20%
// Rare: remaining chance

function getPremiumRareOrBetterCard() {
  const roll = Math.random();

  if (roll < 0.05) return getRandomCardByRarity('Enchanted');
  if (roll < 0.15) return getRandomCardByRarity('Legendary');
  if (roll < 0.35) return getRandomCardByRarity('Super Rare');

  return getRandomCardByRarity('Rare');
}


// Generates the full contents of a standard pack.

function createStandardPack() {
  return [
    getRandomCardByRarity('Common'),
    getRandomCardByRarity('Common'),
    getRandomCardByRarity('Common'),
    getRandomCardByRarity('Uncommon'),
    getRandomCardByRarity('Uncommon'),
    getStandardRareOrBetterCard()
  ];
}


// Generates the full contents of a premium pack with improved rarity odds.

function createPremiumPack() {
  return [
    getRandomCardByRarity('Common'),
    getRandomCardByRarity('Uncommon'),
    getRandomCardByRarity('Uncommon'),
    getPremiumRareOrBetterCard(),
    getPremiumRareOrBetterCard(),
    getPremiumRareOrBetterCard()
  ];
}


// Generates a limited-time Mother's Day themed pack.
// Falls back to all cards if the themed pool is empty.

function createMothersDayPack() {
  const pool = mothersDayPool.length ? mothersDayPool : cards;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 6);
}


// =====================================================
// Discord Message + Button UI Helpers
// Builds pull messages, buttons, and interactive Discord UI.
// =====================================================


// Returns flavor text shown after a card pull.
// Special rarities get more exciting reactions/messages.

function getPullMessage(card, isNew = false) {
  if (isNew) return '✨ **NEW CARD ADDED TO YOUR COLLECTION!** ✨';
  if (card.rarity === 'Enchanted') return '🌈✨ ENCHANTED PULL!!! STOP EVERYTHING.';
  if (card.rarity === 'Legendary') return '💎 LEGENDARY!!! Someone clip that.';
  if (card.rarity === 'Super Rare') return '🟣 Super Rare pull! We take those.';
  if (card.rarity === 'Rare') return '🔵 Nice rare pull.';

  return 'Added to your collection.';
}


// Creates the "Reveal Next Card" button used during pack openings.

function createRevealButton(userId, disabled = false, label = 'Reveal Next Card') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reveal_pack_${userId}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}


// =====================================================
// Twitch Account Linking Buttons
// =====================================================

/**
 * Creates the "Link Twitch Account" button shown to users
 * who have not connected their Twitch account yet.
 */
function createTwitchLinkButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('link_twitch_account')
      .setLabel('Link Twitch Account')
      .setStyle(ButtonStyle.Primary)
  );
}


// Creates the pack selection buttons shown during /pack.
// Buttons automatically disable if the user cannot afford the pack.

function createPackChoiceButtons(userId, balance) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`choose_pack_standard_${userId}`)
      .setLabel(`Standard Pack - ${STANDARD_PACK_COST} Ink`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(balance < STANDARD_PACK_COST),

    new ButtonBuilder()
      .setCustomId(`choose_pack_premium_${userId}`)
      .setLabel(`Premium Pack - ${PREMIUM_PACK_COST} Ink`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(balance < PREMIUM_PACK_COST)
  ];

  buttons.push(
  new ButtonBuilder()
    .setCustomId(`save_ink_${userId}`)
    .setLabel('Save My Ink')
    .setStyle(ButtonStyle.Secondary)
  );


  return new ActionRowBuilder().addComponents(buttons);
}

function createAnnouncementButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('announcement_daily')
      .setLabel('Daily')
      .setEmoji('🎴')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('announcement_balance')
      .setLabel('Balance')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('announcement_pack')
      .setLabel('Pack')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success)
  );
}


// Creates Previous/Next page buttons for collection binder navigation.

function createCollectionButtons(userId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`collection_prev_${userId}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`collection_next_${userId}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}


// Builds the final text summary shown after a pack is fully revealed.

function createPackSummary(packItems) {
  return packItems
    .map(item => {
      const newText = item.isNew ? ' ✨ NEW' : '';
      return `${lorcana.rarityEmoji[item.card.rarity] || '🎴'} **${item.card.name}** — ${item.card.rarity} | ${item.card.ink}${newText}`;
    })
    .join('\n');
}


// =====================================================
// User + Collection Database Helpers
// Handles Supabase storage for users, cards, ink, and daily claims.
// =====================================================


// Creates or updates a user record in Supabase.
// Called before most economy or collection actions.

// Supabase tables used in this section:
// users
// daily_claims
// user_cards

async function ensureUser(userId, username) {
  const { error } = await supabase.from('users').upsert({
    discord_user_id: userId,
    username
  });

  if (error) throw error;
}


// Retrieves a user's stored profile and ink balance.

async function getUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('discord_user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}


// Checks whether the user has EVER claimed a daily reward before.
// Used for first-time bonus rewards.

async function hasAnyDailyClaim(userId) {
  const { data, error } = await supabase
    .from('daily_claims')
    .select('discord_user_id')
    .eq('discord_user_id', userId)
    .limit(1);

  if (error) throw error;
  return data && data.length > 0;
}


// Retrieves the user's most recent daily claim for a specific server.

async function getDailyClaim(userId, guildId) {
  const { data, error } = await supabase
    .from('daily_claims')
    .select('*')
    .eq('discord_user_id', userId)
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) throw error;
  return data;
}


// Updates the user's daily claim timestamp for the current server.

async function setDailyClaim(userId, guildId, today) {
  const { error } = await supabase
    .from('daily_claims')
    .upsert({
      discord_user_id: userId,
      guild_id: guildId,
      last_daily_claim: today,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;
}


// Checks whether the user already owns a specific card.

async function isNewCard(userId, cardId) {
  const { data, error } = await supabase
    .from('user_cards')
    .select('quantity')
    .eq('discord_user_id', userId)
    .eq('card_id', cardId)
    .maybeSingle();

  if (error) throw error;
  return !data;
}


// Adds ink currency to a user's balance.

async function addInk(userId, username, amount) {
  await ensureUser(userId, username);

  const user = await getUser(userId);
  const currentBalance = user?.ink_balance || 0;
  const newBalance = currentBalance + amount;

  const { error } = await supabase
    .from('users')
    .update({
      ink_balance: newBalance,
      username
    })
    .eq('discord_user_id', userId);

  if (error) throw error;
  return newBalance;
}


// Removes ink from a user's balance.
// Prevents spending more ink than the user owns.

async function spendInk(userId, amount) {
  const user = await getUser(userId);
  const currentBalance = user?.ink_balance || 0;

  if (currentBalance < amount) {
    return { success: false, balance: currentBalance };
  }

  const newBalance = currentBalance - amount;

  const { error } = await supabase
    .from('users')
    .update({ ink_balance: newBalance })
    .eq('discord_user_id', userId);

  if (error) throw error;

  return { success: true, balance: newBalance };
}


// Adds a card to the user's collection.
// If the card already exists, quantity increases instead.

async function addCardToCollection(userId, username, cardId) {
  await ensureUser(userId, username);

  const { data: existingCard, error: lookupError } = await supabase
    .from('user_cards')
    .select('quantity')
    .eq('discord_user_id', userId)
    .eq('card_id', cardId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existingCard) {
    const { error } = await supabase
      .from('user_cards')
      .update({
        quantity: existingCard.quantity + 1,
        last_pulled_at: new Date().toISOString()
      })
      .eq('discord_user_id', userId)
      .eq('card_id', cardId);

    if (error) throw error;
  } else {
    const { error } = await supabase.from('user_cards').insert({
      discord_user_id: userId,
      card_id: cardId,
      quantity: 1
    });

    if (error) throw error;
  }
}


// =====================================================
// Pack Processing + Collection Image Generation
// Handles pack ownership logic and visual collection rendering.
// =====================================================


// Determines whether pulled cards are NEW or DUPLICATES.
// Also prevents duplicate cards inside the SAME pack
// from incorrectly showing as "new" multiple times.

async function buildPackItems(userId, pulledCards) {
  const seenInThisPack = new Set();
  const packItems = [];

  for (const card of pulledCards) {
    const alreadyOwned = !(await isNewCard(userId, card.id));
    const duplicateWithinPack = seenInThisPack.has(card.id);

    packItems.push({
      card,
      isNew: !alreadyOwned && !duplicateWithinPack
    });

    seenInThisPack.add(card.id);
  }

  return packItems;
}


// Adds all cards from a completed pack reveal into the user's collection.

async function addPackItemsToCollection(userId, username, packItems) {
  await ensureUser(userId, username);

  for (const item of packItems) {
    await addCardToCollection(userId, username, item.card.id);
  }
}


// Downloads a card image so Sharp can use it in collection binder generation.

async function downloadImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}


// Generates the visual collection binder image shown in /collection.
// Uses Sharp to combine multiple card images into a grid layout.

async function createCollectionImage(pageCards) {
  const cardWidth = 200;
  const cardHeight = 280;
  const gap = 16;
  const columns = 5;
  const padding = 24;

  const rows = Math.max(1, Math.ceil(pageCards.length / columns));
  const imageWidth = padding * 2 + columns * cardWidth + (columns - 1) * gap;
  const imageHeight = padding * 2 + rows * cardHeight + (rows - 1) * gap;

  const background = sharp({
    create: {
      width: imageWidth,
      height: imageHeight,
      channels: 4,
      background: { r: 22, g: 32, b: 46, alpha: 1 }
    }
  }).png();

  const composites = [];

  for (let i = 0; i < pageCards.length; i++) {
    const card = pageCards[i];
    const row = Math.floor(i / columns);
    const col = i % columns;

    const left = padding + col * (cardWidth + gap);
    const top = padding + row * (cardHeight + gap);

    try {
      const imageBuffer = await downloadImageBuffer(card.image);
      const resizedCard = await sharp(imageBuffer)
        .resize(cardWidth, cardHeight, {
          fit: 'contain',
          background: { r: 22, g: 32, b: 46, alpha: 1 }
        })
        .png()
        .toBuffer();

      composites.push({ input: resizedCard, top, left });
    } catch (error) {
      console.error(`Failed to render card image for ${card.name}:`, error.message);
    }
  }

  return background.composite(composites).png().toBuffer();
}


// Formats leaderboard results into a clean Discord message.
// Used for displaying top users by ink, collection size, or other stats.

function formatLeaderboardList(data, label) {
  if (!data || data.length === 0) return 'No data yet.';

  return data
    .slice(0, 5)
    .map((user, index) => {
      const medal = ['🥇', '🥈', '🥉', '4.', '5.'][index];
      return `${medal} **${user.username || 'Unknown'}** — ${user.value || 0} ${label}`;
    })
    .join('\n');
}

function getCollectionFilterLabel(selectedSet) {
  return selectedSet ? selectedSet : 'All Sets';
}

function getCollectionRarityLabel(selectedRarity) {
  return selectedRarity ? selectedRarity : 'All Rarities';
}

function getSelectedCollectionSet(interaction) {
  const selectedSet = interaction.options.getString('set');

  if (!selectedSet || selectedSet === 'all') {
    return null;
  }

  if (!COLLECTION_SET_CHOICES.includes(selectedSet)) {
    return null;
  }

  return selectedSet;
}

function getSelectedCollectionRarity(interaction) {
  const selectedRarity = interaction.options.getString('rarity');

  if (!selectedRarity || selectedRarity === 'all') {
    return null;
  }

  if (!COLLECTION_RARITY_CHOICES.includes(selectedRarity)) {
    return null;
  }

  return selectedRarity;
}

function buildCollectionDetails(ownedCards, selectedSet = null, selectedRarity = null) {
  return ownedCards
    .map(ownedCard => {
      const cardInfo = getCardById(ownedCard.card_id);
      if (!cardInfo || !cardInfo.image) return null;
      if (selectedSet && cardInfo.set !== selectedSet) return null;
      if (selectedRarity && cardInfo.rarity !== selectedRarity) return null;

      return {
        id: ownedCard.card_id,
        name: cardInfo.name,
        rarity: cardInfo.rarity || 'Unknown',
        ink: cardInfo.ink || 'Unknown',
        set: cardInfo.set || 'Unknown',
        image: cardInfo.image,
        quantity: ownedCard.quantity
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const rarityDiff = (lorcana.rarityOrder[b.rarity] || 0) - (lorcana.rarityOrder[a.rarity] || 0);
      if (rarityDiff !== 0) return rarityDiff;
      return a.name.localeCompare(b.name);
    });
}


// Calculates which cards belong on a specific collection binder page.
// Handles pagination logic for the /collection image viewer.

function getCollectionPageData(collectionDetails, page) {
  const totalCards = collectionDetails.reduce((sum, card) => sum + card.quantity, 0);
  const uniqueCards = collectionDetails.length;
  const totalPages = Math.max(1, Math.ceil(collectionDetails.length / COLLECTION_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * COLLECTION_PAGE_SIZE;
  const pageCards = collectionDetails.slice(start, start + COLLECTION_PAGE_SIZE);

  return {
    totalCards,
    uniqueCards,
    totalPages,
    page: safePage,
    pageCards
  };
}

// Builds the full Discord response for a collection binder page.
// Generates the binder image, page navigation buttons, and summary text.

async function createCollectionReply(
  userId,
  username,
  collectionDetails,
  page,
  selectedSet = null,
  selectedRarity = null
) {
  const pageData = getCollectionPageData(collectionDetails, page);
  const imageBuffer = await createCollectionImage(pageData.pageCards);

  const attachment = new AttachmentBuilder(imageBuffer, {
    name: 'collection-binder.png'
  });

  const content =
    `Set: **${getCollectionFilterLabel(selectedSet)}** | Rarity: **${getCollectionRarityLabel(selectedRarity)}**\n` +
    `Here is your Lorcana binder, ${username} 🎴\n` +
    `Total Cards: **${pageData.totalCards}** • Unique Cards: **${pageData.uniqueCards}**\n` +
    `Page **${pageData.page + 1}** of **${pageData.totalPages}**`;

  return {
    content,
    files: [attachment],
    components:
      pageData.totalPages > 1
        ? [createCollectionButtons(userId, pageData.page, pageData.totalPages)]
        : []
  };
}


// Starts the interactive pack reveal sequence.
// Stores temporary reveal progress and sends the first reveal message/button.

async function startPackReveal(interaction, userId, username, packItems, packLabel, introText) {
  await addPackItemsToCollection(userId, username, packItems);

  pendingPacks.set(userId, {
    items: packItems,
    index: 0
  });

  const embed = new EmbedBuilder()
    .setTitle(`${username} opened a ${packLabel} 🎴`)
    .setDescription(introText)
    .setColor(0x00AE86);

  await interaction.editReply({
    embeds: [embed],
    components: [createRevealButton(userId)]
  });
}


// Processes a user's selected pack type from the pack choice buttons.
// Handles ink spending, pack generation, and starting the reveal flow.

async function handlePackChoice(interaction, packType, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'This is not your pack choice, sneaky little collector 👀',
      ephemeral: true
    });
    return;
  }

  if (packType === 'mothers' && !isMothersDayAvailable()) {
    await interaction.reply({
      content: 'The Mother’s Day Pack is not available right now 🎴',
      ephemeral: true
    });
    return;
  }

  const userId = interaction.user.id;
  const username = interaction.user.username;

  await ensureUser(userId, username);

  const isPremium = packType === 'premium';
  const isMothers = packType === 'mothers';

  const cost = isMothers
    ? MOTHERS_DAY_PACK_COST
    : isPremium
      ? PREMIUM_PACK_COST
      : STANDARD_PACK_COST;

  const packLabel = isMothers
    ? "Mother's Day Pack"
    : isPremium
      ? 'Premium Pack'
      : 'Standard Pack';

  const spendResult = await spendInk(userId, cost);

  if (!spendResult.success) {
    await interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Not enough Ink')
          .setDescription(
            `You need **${cost} Ink** to open a ${packLabel}.\n` +
            `You currently have **${spendResult.balance} Ink**.\n\n` +
            `Use /daily to earn more.`
          )
          .setColor(0xff4d4d)
      ]
    });
    return;
  }

  await interaction.deferUpdate();

  const pulledCards = isMothers
    ? createMothersDayPack()
    : isPremium
      ? createPremiumPack()
      : createStandardPack();

  const packItems = await buildPackItems(userId, pulledCards);

  await startPackReveal(
    interaction,
    userId,
    username,
    packItems,
    packLabel,
    `Spent **${cost} Ink**.\nRemaining balance: **${spendResult.balance} Ink**.\n\nYour ${packLabel} has **${packItems.length} cards**.\nClick the button below to reveal them one at a time.`
  );
}


// =====================================================
// Discord Interaction Handler
// Main event listener for slash commands and button interactions.
// =====================================================

// IMPORTANT:
// All Discord interactions pass through this single handler.
// Be careful when adding new button IDs or command names
// to avoid accidental overlap/conflicts.

client.on('interactionCreate', async interaction => {
  try {
    let commandName = interaction.isChatInputCommand() ? interaction.commandName : null;

    if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(interaction.channelId)) {
      // Handles slash commands like /daily, /pack, /collection, etc.

      if (interaction.isChatInputCommand()) {
        await interaction.reply({
          content: 'Please use commands in the Lore Collector channel 🎴',
          ephemeral: true
        });
      }
      return;
    }


    // Handles interactive Discord buttons like pack reveals and collection paging.

    if (interaction.isButton()) {
      // =====================================================
// Twitch Account Linking Buttons
// =====================================================

    if (interaction.customId === 'link_twitch_account') {
      const oauthUrl = buildTwitchOAuthUrl(interaction.user.id);

      await interaction.reply({
        content:
            '## Link Your Twitch Account 🎴\n\n' +
            'Click the link below to securely connect your Twitch account.\n\n' +
            'Once linked, Twitch channel point pulls will be added to your Discord collection automatically.\n\n' +
            `${oauthUrl}`,
        ephemeral: true
      });

      return;
    }


      // =====================================================
      // Collection Pagination Buttons
      // Handles Previous/Next page navigation in the collection binder.
      // =====================================================

      if (interaction.customId === 'announcement_daily') {
        commandName = 'daily';
      } else if (interaction.customId === 'announcement_balance') {
        commandName = 'balance';
      } else if (interaction.customId === 'announcement_pack') {
        commandName = 'pack';
      }

      if (!commandName) {

      if (interaction.customId.startsWith('collection_prev_')) {
        const ownerId = interaction.customId.replace('collection_prev_', '');

        if (interaction.user.id !== ownerId) {
          await interaction.reply({
            content: 'This is not your binder, sneaky little collector 👀',
            ephemeral: true
          });
          return;
        }

        const collectionData = pendingCollections.get(ownerId);

        if (!collectionData) {
          await interaction.reply({
            content: 'This binder page expired. Use /collection again 🎴',
            ephemeral: true
          });
          return;
        }

        collectionData.page -= 1;

        await interaction.deferUpdate();

        const reply = await createCollectionReply(
          ownerId,
          interaction.user.username,
          collectionData.cards,
          collectionData.page,
          collectionData.selectedSet,
          collectionData.selectedRarity
        );

        await interaction.editReply({
          ...reply,
          attachments: []
        });

        return;
      }

      if (interaction.customId.startsWith('collection_next_')) {
        const ownerId = interaction.customId.replace('collection_next_', '');

        if (interaction.user.id !== ownerId) {
          await interaction.reply({
            content: 'This is not your binder, sneaky little collector 👀',
            ephemeral: true
          });
          return;
        }

        const collectionData = pendingCollections.get(ownerId);

        if (!collectionData) {
          await interaction.reply({
            content: 'This binder page expired. Use /collection again 🎴',
            ephemeral: true
          });
          return;
        }

        collectionData.page += 1;

        await interaction.deferUpdate();

        const reply = await createCollectionReply(
          ownerId,
          interaction.user.username,
          collectionData.cards,
          collectionData.page,
          collectionData.selectedSet,
          collectionData.selectedRarity
        );

        await interaction.editReply({
          ...reply,
          attachments: []
        });

        return;
      }

      if (interaction.customId.startsWith('save_ink_')) {
       const ownerId = interaction.customId.replace('save_ink_', '');

       if (interaction.user.id !== ownerId) {
        await interaction.reply({
          content: 'This is not your Ink stash, sneaky little collector 👀',
          ephemeral: true
        });
     return;
    }

    await interaction.update({
      content: 'Your Ink has been safely tucked away for another day 🎴',
      embeds: [],
      components: []
    });

    return;
   }

      if (interaction.customId.startsWith('choose_pack_standard_')) {
        const ownerId = interaction.customId.replace('choose_pack_standard_', '');
        await handlePackChoice(interaction, 'standard', ownerId);
        return;
      }

      if (interaction.customId.startsWith('choose_pack_premium_')) {
        const ownerId = interaction.customId.replace('choose_pack_premium_', '');
        await handlePackChoice(interaction, 'premium', ownerId);
        return;
      }

      if (interaction.customId.startsWith('choose_pack_mothers_')) {
        const ownerId = interaction.customId.replace('choose_pack_mothers_', '');
        await handlePackChoice(interaction, 'mothers', ownerId);
        return;
      }


      // =====================================================
      // Pack Reveal Buttons
      // Handles revealing cards one-by-one during pack openings.
      // =====================================================

      if (!interaction.customId.startsWith('reveal_pack_')) return;

      const ownerId = interaction.customId.replace('reveal_pack_', '');

      if (interaction.user.id !== ownerId) {
        await interaction.reply({
          content: 'This is not your pack, sneaky little collector 👀',
          ephemeral: true
        });
        return;
      }

      const packData = pendingPacks.get(ownerId);

      if (!packData) {
        await interaction.update({
          content: 'This pack reveal expired. Open a new pack with /pack 🎴',
          embeds: [],
          components: []
        });
        return;
      }

      const currentItem = packData.items[packData.index];
      const currentCard = currentItem.card;
      packData.index += 1;

      const isLastCard = packData.index >= packData.items.length;

      const embed = new EmbedBuilder()
        .setTitle(`${lorcana.rarityEmoji[currentCard.rarity] || '🎴'} ${currentCard.name}`)
        .setDescription(
          `Card ${packData.index} of ${packData.items.length}\n\n${currentCard.rarity} | ${currentCard.ink} | ${currentCard.set}\n\n${getPullMessage(currentCard, currentItem.isNew)}`
        )
        .setColor(0x00AE86);

      if (currentCard.image) {
        embed.setImage(currentCard.image);
      }

      if (isLastCard) {
        const summary = createPackSummary(packData.items);

        embed.addFields({
          name: 'Pack Summary',
          value: summary.slice(0, 1024)
        });

        embed.setFooter({ text: 'All cards were added to your collection.' });

        const hypeCards = packData.items
          .map(item => item.card)
          .filter(card => card.rarity === 'Enchanted' || card.rarity === 'Legendary');

        pendingPacks.delete(ownerId);

        await interaction.update({
          embeds: [embed],
          components: [createRevealButton(ownerId, true, 'Pack Complete')]
        });

        if (hypeCards.length > 0) {
          const hypeList = hypeCards
            .map(card => {
              if (card.rarity === 'Enchanted') {
                return `🌈 **ENCHANTED:** ${card.name}`;
              }

              return `💎 **LEGENDARY:** ${card.name}`;
            })
            .join('\n');

          await interaction.followUp(
            `🚨 ${interaction.user.username} pulled a BIG pack!\n${hypeList}`
          );
        }

        return;
      }

      await interaction.update({
        embeds: [embed],
        components: [createRevealButton(ownerId)]
      });

      return;
    }
    }

       if (!commandName) return;

    // =========================
// ANNOUNCEMENT ADMIN COMMANDS
// =========================

if (
  commandName === 'announcement-set' ||
  commandName === 'announcement-stop' ||
  commandName === 'announcement-status'
) {

  if (
    !interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    await interaction.reply({
      content: 'Only server admins can use announcement commands.',
      ephemeral: true
    });

    return;
  }

}

// SET ANNOUNCEMENT
if (commandName === 'announcement-set') {

  await interaction.deferReply({ ephemeral: true });

  const message = interaction.options.getString('message');
  const intervalHours = interaction.options.getInteger('interval_hours');
  const endAt = interaction.options.getString('end_at');

  const parsedEndAt = endAt
    ? new Date(endAt).toISOString()
    : null;

  const { error } = await supabase
    .from('announcements')
    .upsert({
      id: 'global',
      message,
      interval_hours: intervalHours,
      end_at: parsedEndAt,
      is_active: true,
      last_posted_at: null,
      created_by: interaction.user.id,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;

  await interaction.editReply(
    '✅ Rotating announcement updated successfully.'
  );

  return;
}

// STOP ANNOUNCEMENT
if (commandName === 'announcement-stop') {

  await interaction.deferReply({ ephemeral: true });

  const { error } = await supabase
    .from('announcements')
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', 'global');

  if (error) throw error;

  await interaction.editReply(
    '🛑 Rotating announcement stopped.'
  );

  return;
}

// STATUS
if (commandName === 'announcement-status') {

  await interaction.deferReply({ ephemeral: true });

  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', 'global')
    .maybeSingle();

  if (error) throw error;

  if (!data || !data.is_active) {
    await interaction.editReply(
      'No active rotating announcement.'
    );

    return;
  }

  await interaction.editReply(
    `📢 Active Announcement\n\n` +
    `Message:\n${data.message}\n\n` +
    `Interval: Every ${data.interval_hours} hour(s)\n` +
    `Ends: ${data.end_at || 'No end date'}`
  );

  return;
}

if (commandName === 'mothersday') {
  await interaction.deferReply();

  const userId = interaction.user.id;
  const username = interaction.user.username;

  await ensureUser(userId, username);

  const { data: existingClaim } = await supabase
    .from('special_claims')
    .select('*')
    .eq('discord_user_id', userId)
    .eq('claim_type', 'mothers_day_2026')
    .maybeSingle();

  if (existingClaim) {
    await interaction.editReply(
      'You already claimed your free Mother’s Day Pack 🎴'
    );
    return;
  }

  const pulledCards = createMothersDayPack();
  const packItems = await buildPackItems(userId, pulledCards);

  await addPackItemsToCollection(userId, username, packItems);

  await supabase
    .from('special_claims')
    .insert({
      discord_user_id: userId,
      claim_type: 'mothers_day_2026'
    });

  pendingPacks.set(userId, {
    items: packItems,
    index: 0
  });

  const embed = new EmbedBuilder()
    .setTitle('🌸 Free Mother’s Day Pack')
    .setDescription(
      `Sorry the event pack did not work properly over the weekend.\n\n` +
      `Enjoy a free Mother’s Day Pack on us 💖\n\n` +
      `Click below to reveal your cards!`
    )
    .setColor(0xff8fb1);

  await interaction.editReply({
    embeds: [embed],
    components: [createRevealButton(userId)]
  });

  return;
}


    // =====================================================
    // /lore
    // Explains how The Lore Collector works.
    // =====================================================

    if (commandName === 'lore') {
      await interaction.deferReply({ ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle('📖 The Lore Collector Guide')
        .setDescription(
          `Welcome to your community Lorcana collection game 🎴\n\n` +
          `**Daily Reward**\n` +
          `/daily → Get 1 free card + ${DAILY_INK_REWARD} Ink\n` +
          `You can claim once per server each day.\n\n` +
          `**Ink**\n` +
          `/balance → Check your Ink\n` +
          `Use Ink to open packs.\n\n` +
          `**Packs**\n` +
          `/pack → Choose a pack with buttons\n` +
          `• Standard Pack — ${STANDARD_PACK_COST} Ink\n` +
          `• Premium Pack — ${PREMIUM_PACK_COST} Ink, better odds\n` +
          `• Mother's Day Pack — ${MOTHERS_DAY_PACK_COST} Ink, limited-time themed pack\n\n` +
          `**Collection**\n` +
          `/collection → View your visual binder\n` +
          `/dupes → See duplicate cards\n\n` +
          `**Leaderboard**\n` +
          `/leaderboard → See top collectors and richest players\n\n` +
          `🎁 First-ever /daily claim gives a free Premium Pack.`
        )
        .setColor(0x00AE86);

      await interaction.editReply({ embeds: [embed] });
    }


    // =====================================================
    // /daily
    // Gives a daily random card + ink reward.
    // Also handles first-time premium pack bonuses.
    // =====================================================

    if (commandName === 'daily') {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const username = interaction.user.username;
      const guildId = interaction.guildId;
      const today = new Date().toISOString().slice(0, 10);

      await ensureUser(userId, username);

      const existingClaim = await getDailyClaim(userId, guildId);

      if (existingClaim?.last_daily_claim === today) {
        await interaction.editReply(
          'You already claimed your daily reward in this server today. Check in again tomorrow 🎴'
        );
        return;
      }

      const isFirstEverClaim = !(await hasAnyDailyClaim(userId));

      const randomCard = getRandomCardFromPool(cards);
      const dailyCardIsNew = await isNewCard(userId, randomCard.id);

      await addCardToCollection(userId, username, randomCard.id);
      const newBalance = await addInk(userId, username, DAILY_INK_REWARD);
      await setDailyClaim(userId, guildId, today);

      if (isFirstEverClaim) {
        const premiumCards = createPremiumPack();
        const premiumItems = await buildPackItems(userId, premiumCards);

        await addPackItemsToCollection(userId, username, premiumItems);

        pendingPacks.set(userId, {
          items: premiumItems,
          index: 0
        });

        const embed = new EmbedBuilder()
          .setTitle(`${lorcana.rarityEmoji[randomCard.rarity] || '🎴'} ${randomCard.name}`)
          .setDescription(
            `${randomCard.rarity} | ${randomCard.ink} | ${randomCard.set}\n\n${getPullMessage(randomCard, dailyCardIsNew)}\n\n+${DAILY_INK_REWARD} Ink added.\nCurrent balance: **${newBalance} Ink**\n\n🎁 **First check-in bonus:** You also received a free **Premium Pack**!\nClick the button below to reveal it.`
          )
          .setColor(0x00AE86);

        if (randomCard.image) {
          embed.setImage(randomCard.image);
        }

        await interaction.editReply({
          embeds: [embed],
          components: [createRevealButton(userId, false, 'Reveal Free Premium Pack')]
        });


        return;
      }

      const embed = lorcana.createSingleCardEmbed({
  	username,
  	card: randomCard,
  	isNew: dailyCardIsNew
      });

      embed.setDescription(
  	`${randomCard.rarity} | ${randomCard.ink} | ${randomCard.set}\n\n${getPullMessage(randomCard, dailyCardIsNew)}\n\n+${DAILY_INK_REWARD} Ink added.\nCurrent balance: **${newBalance} Ink**`
      );

      await interaction.editReply({ embeds: [embed] });
if (randomCard.rarity === 'Enchanted') {

  await interaction.followUp(
    `🚨 ${interaction.user.username} pulled an ENCHANTED daily card!\n🌈 **ENCHANTED:** ${randomCard.name}`
  );

} else if (randomCard.rarity === 'Legendary') {

  await interaction.followUp(
    `🚨 ${interaction.user.username} pulled a LEGENDARY daily card!\n💎 **LEGENDARY:** ${randomCard.name}`
  );

}
    }


    // =====================================================
    // /balance
    // Displays the user's current ink balance.
    // =====================================================

    if (commandName === 'balance') {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const username = interaction.user.username;

      await ensureUser(userId, username);

      const user = await getUser(userId);
      const balance = user?.ink_balance || 0;

      const linkedAccount = await lorcana.getLinkedTwitchAccount(supabase, userId);

      if (linkedAccount?.twitch_username) {
        await interaction.editReply({
          content:
            `You currently have **${balance} Ink**.\n\n` +
            `✅ Twitch linked: **${linkedAccount.twitch_username}**`,
          components: []
        });

        return;
      }

      await interaction.editReply({
        content:
          `You currently have **${balance} Ink**.\n\n` +
          `Want Twitch pulls to go into this collection?`,
        components: [createTwitchLinkButtonRow()]
      });
    }


    // =====================================================
    // /pack
    // Lets users purchase and open packs using ink.
    // Uses interactive reveal buttons.
    // =====================================================

    if (commandName === 'pack') {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const username = interaction.user.username;

      await ensureUser(userId, username);

      const user = await getUser(userId);
      const balance = user?.ink_balance || 0;

      const packDescriptionParts = [
        `Current balance: **${balance} Ink**\n`,
        `**Standard Pack** — ${STANDARD_PACK_COST} Ink\n3 Common, 2 Uncommon, 1 Rare+\n`,
        `**Premium Pack** — ${PREMIUM_PACK_COST} Ink\n1 Common, 2 Uncommon, 3 boosted Rare+ pulls`
      ];


      // Only shows the limited-time Mother's Day pack while the event is active.

      if (isMothersDayAvailable()) {
        packDescriptionParts.push(
          `**Mother's Day Pack** — ${MOTHERS_DAY_PACK_COST} Ink\n6 limited-time motherly cards`
        );
      }

      const canAffordAnyPack =
        balance >= STANDARD_PACK_COST ||
        balance >= PREMIUM_PACK_COST ||
        (isMothersDayAvailable() && balance >= MOTHERS_DAY_PACK_COST);

      const embed = new EmbedBuilder()
        .setTitle(canAffordAnyPack ? 'Choose your pack 🎴' : 'Not enough Ink 🎴')
        .setDescription(
          canAffordAnyPack
            ? packDescriptionParts.join('\n\n')
            : `You currently have **${balance} Ink**.\n\nStandard Pack — ${STANDARD_PACK_COST} Ink\nPremium Pack — ${PREMIUM_PACK_COST} Ink${
                isMothersDayAvailable() ? `\nMother's Day Pack — ${MOTHERS_DAY_PACK_COST} Ink` : ''
              }\n\nUse /daily to earn more Ink.`
        )
        .setColor(canAffordAnyPack ? 0x00AE86 : 0xff4d4d);

      await interaction.editReply({
        embeds: [embed],
        components: canAffordAnyPack ? [createPackChoiceButtons(userId, balance)] : []
      });
    }


    // =====================================================
    // /collection
    // Displays the user's card collection as a visual binder.
    // Supports pagination buttons.
    // =====================================================

    if (commandName === 'collection') {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const selectedSet = getSelectedCollectionSet(interaction);
      const selectedRarity = getSelectedCollectionRarity(interaction);

      const { data: ownedCards, error } = await supabase
        .from('user_cards')
        .select('*')
        .eq('discord_user_id', userId);

      if (error) throw error;

      if (!ownedCards || ownedCards.length === 0) {
        await interaction.editReply(
          'You do not have any cards yet. Use /daily to start your collection 🎴'
        );
        return;
      }

      const collectionDetails = buildCollectionDetails(ownedCards, selectedSet, selectedRarity);

      if (collectionDetails.length === 0) {
        await interaction.editReply(
          `You do not have any cards matching set **${getCollectionFilterLabel(selectedSet)}** and rarity **${getCollectionRarityLabel(selectedRarity)}** yet.`
        );
        return;
      }

      pendingCollections.set(userId, {
        cards: collectionDetails,
        page: 0,
        selectedSet,
        selectedRarity
      });

      const reply = await createCollectionReply(
        userId,
        interaction.user.username,
        collectionDetails,
        0,
        selectedSet,
        selectedRarity
      );

      await interaction.editReply(reply);
    }


    // =====================================================
    // /dupes
    // Shows cards the user owns more than once.
    // Useful for future trading systems.
    // =====================================================

    if (commandName === 'dupes') {
      await interaction.deferReply();

      const userId = interaction.user.id;

      const { data: ownedCards, error } = await supabase
        .from('user_cards')
        .select('*')
        .eq('discord_user_id', userId)
        .gt('quantity', 1);

      if (error) throw error;

      if (!ownedCards || ownedCards.length === 0) {
        await interaction.editReply('No duplicates yet. Every card is still precious and singular 🎴');
        return;
      }

      const duplicateDetails = ownedCards
        .map(ownedCard => {
          const cardInfo = getCardById(ownedCard.card_id);
          if (!cardInfo) return null;

          return {
            name: cardInfo.name,
            rarity: cardInfo.rarity || 'Unknown',
            ink: cardInfo.ink || 'Unknown',
            quantity: ownedCard.quantity
          };
        })
        .filter(Boolean);

      if (duplicateDetails.length === 0) {
        await interaction.editReply(
          'You have duplicates, but they are from older card data that no longer matches your current cards.json.'
        );
        return;
      }

      duplicateDetails.sort((a, b) => {
        const rarityDiff = (lorcana.rarityOrder[b.rarity] || 0) - (lorcana.rarityOrder[a.rarity] || 0);
        if (rarityDiff !== 0) return rarityDiff;
        return b.quantity - a.quantity;
      });

      const dupeList = duplicateDetails
        .slice(0, 25)
        .map(card => `${lorcana.rarityEmoji[card.rarity] || '🎴'} **${card.name}** — x${card.quantity} | ${card.rarity} | ${card.ink}`)
        .join('\n');

      const totalDupes = duplicateDetails.reduce(
        (sum, card) => sum + (card.quantity - 1),
        0
      );

      const embed = new EmbedBuilder()
        .setTitle(`${interaction.user.username}'s Duplicate Cards`)
        .setDescription(
          `Extra cards available: **${totalDupes}**\nDuplicate types: **${duplicateDetails.length}**\n\n${dupeList}`
        )
        .setColor(0x00AE86);

      await interaction.editReply({ embeds: [embed] });
    }


    // =====================================================
    // /leaderboard
    // Displays top collectors or highest ink balances.
    // =====================================================

    if (commandName === 'leaderboard') {
      await interaction.deferReply();

      const { data: totalData, error: totalError } = await supabase.rpc('get_total_cards');
      if (totalError) throw totalError;

      const { data: uniqueData, error: uniqueError } = await supabase.rpc('get_unique_cards');
      if (uniqueError) throw uniqueError;

      const { data: inkData, error: inkError } = await supabase
        .from('users')
        .select('username, ink_balance')
        .order('ink_balance', { ascending: false })
        .limit(5);

      if (inkError) throw inkError;

      const inkLeaderboard = (inkData || []).map(user => ({
        username: user.username,
        value: user.ink_balance || 0
      }));

      const embed = new EmbedBuilder()
        .setTitle('🏆 Lorcana Leaderboard')
        .addFields(
          {
            name: 'Most Cards Collected',
            value: formatLeaderboardList(totalData, 'cards'),
            inline: false
          },
          {
            name: 'Most Unique Cards',
            value: formatLeaderboardList(uniqueData, 'unique cards'),
            inline: false
          },
          {
            name: 'Richest Collectors',
            value: formatLeaderboardList(inkLeaderboard, 'Ink'),
            inline: false
          }
        )
        .setColor(0x00AE86);

      await interaction.editReply({ embeds: [embed] });
    }

  } catch (error) {
    console.error(error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Something went wrong while running this command.');
    } else {
      await interaction.reply({
        content: 'Something went wrong while running this command.',
        ephemeral: true
      });
    }
  }
});

// Starts the web server for Twitch OAuth callbacks.
// Discord bot login stays separate below.

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);

// =====================================================
// Future Architecture Notes
// =====================================================
//
// Planned shared systems:
// - Move more helper logic into lib/lorcana.js
// - Shared pack generation between Discord + Twitch
// - Shared rarity handling
// - Shared collection rendering
// - Shared overlay payload generation
//
// Planned Twitch features:
// - Twitch chat pull announcements
// - OBS/StreamElements overlay support
// - Twitch ink redeems
// - Twitch-linked collections
//
// Planned gameplay systems:
// - Trading
// - Set-specific collection tracking
// - Event packs
// - Limited-time drops
// - Achievements
//
// Important:
// index.js should eventually become mostly Discord-specific logic,
// while lib/lorcana.js becomes the shared game engine layer.
