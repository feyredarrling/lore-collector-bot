require('dotenv').config();

const fs = require('fs');
const sharp = require('sharp');
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

const { createClient } = require('@supabase/supabase-js');

const DAILY_INK_REWARD = 20;
const STANDARD_PACK_COST = 100;
const PREMIUM_PACK_COST = 250;
const MOTHERS_DAY_PACK_COST = 200;
const COLLECTION_PAGE_SIZE = 20;
const EVENT_TIMEZONE = 'America/New_York';

const ALLOWED_CHANNELS = [
  '1501215673139990710',
  '1501239591984955543'
].filter(id => !id.includes('PASTE'));

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

const cards = JSON.parse(fs.readFileSync('./data/cards.json', 'utf8'));

const mothersDayPool = cards.filter(card =>
  MOTHERS_DAY_CARD_NAMES.includes(card.name)
);

const COLLECTION_SET_CHOICES = [...new Set(cards.map(card => card.set).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const pendingPacks = new Map();
const pendingCollections = new Map();

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

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

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

async function processAnnouncements() {

  const { data: announcement, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', 'global')
    .maybeSingle();

  if (error) {
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

client.once('clientReady', () => {

  console.log(`Logged in as ${client.user.tag}`);

  processAnnouncements();

  setInterval(
    processAnnouncements,
    5 * 60 * 1000
  );

});

const rarityEmoji = {
  Common: '⚪',
  Uncommon: '🟢',
  Rare: '🔵',
  'Super Rare': '🟣',
  Legendary: '💎',
  Enchanted: '🌈',
  Promo: '✨'
};

const rarityOrder = {
  Enchanted: 7,
  Legendary: 6,
  'Super Rare': 5,
  Rare: 4,
  Uncommon: 3,
  Common: 2,
  Promo: 1
};

function isMothersDayAvailable() {
  return false;
}

function getCardById(cardId) {
  return cards.find(card => card.id === cardId);
}

function getRandomCardFromPool(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

function getRandomCardByRarity(rarity) {
  const pool = cards.filter(card => card.rarity === rarity);
  return pool.length ? getRandomCardFromPool(pool) : getRandomCardFromPool(cards);
}

function getStandardRareOrBetterCard() {
  const roll = Math.random();

  if (roll < 0.01) return getRandomCardByRarity('Enchanted');
  if (roll < 0.06) return getRandomCardByRarity('Legendary');
  if (roll < 0.20) return getRandomCardByRarity('Super Rare');

  return getRandomCardByRarity('Rare');
}

function getPremiumRareOrBetterCard() {
  const roll = Math.random();

  if (roll < 0.05) return getRandomCardByRarity('Enchanted');
  if (roll < 0.15) return getRandomCardByRarity('Legendary');
  if (roll < 0.35) return getRandomCardByRarity('Super Rare');

  return getRandomCardByRarity('Rare');
}

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

function createMothersDayPack() {
  const pool = mothersDayPool.length ? mothersDayPool : cards;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 6);
}

function getPullMessage(card, isNew = false) {
  if (isNew) return '✨ **NEW CARD ADDED TO YOUR COLLECTION!** ✨';
  if (card.rarity === 'Enchanted') return '🌈✨ ENCHANTED PULL!!! STOP EVERYTHING.';
  if (card.rarity === 'Legendary') return '💎 LEGENDARY!!! Someone clip that.';
  if (card.rarity === 'Super Rare') return '🟣 Super Rare pull! We take those.';
  if (card.rarity === 'Rare') return '🔵 Nice rare pull.';

  return 'Added to your collection.';
}

function createRevealButton(userId, disabled = false, label = 'Reveal Next Card') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reveal_pack_${userId}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

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

function createPackSummary(packItems) {
  return packItems
    .map(item => {
      const newText = item.isNew ? ' ✨ NEW' : '';
      return `${rarityEmoji[item.card.rarity] || '🎴'} **${item.card.name}** — ${item.card.rarity} | ${item.card.ink}${newText}`;
    })
    .join('\n');
}

async function ensureUser(userId, username) {
  const { error } = await supabase.from('users').upsert({
    discord_user_id: userId,
    username
  });

  if (error) throw error;
}

async function getUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('discord_user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function hasAnyDailyClaim(userId) {
  const { data, error } = await supabase
    .from('daily_claims')
    .select('discord_user_id')
    .eq('discord_user_id', userId)
    .limit(1);

  if (error) throw error;
  return data && data.length > 0;
}

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

async function addPackItemsToCollection(userId, username, packItems) {
  await ensureUser(userId, username);

  for (const item of packItems) {
    await addCardToCollection(userId, username, item.card.id);
  }
}

async function downloadImageBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

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

function buildCollectionDetails(ownedCards, selectedSet = null) {
  return ownedCards
    .map(ownedCard => {
      const cardInfo = getCardById(ownedCard.card_id);
      if (!cardInfo || !cardInfo.image) return null;
      if (selectedSet && cardInfo.set !== selectedSet) return null;

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
      const rarityDiff = (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0);
      if (rarityDiff !== 0) return rarityDiff;
      return a.name.localeCompare(b.name);
    });
}

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

async function createCollectionReply(userId, username, collectionDetails, page, selectedSet = null) {
  const pageData = getCollectionPageData(collectionDetails, page);
  const imageBuffer = await createCollectionImage(pageData.pageCards);

  const attachment = new AttachmentBuilder(imageBuffer, {
    name: 'collection-binder.png'
  });

  const content =
    `Set: **${getCollectionFilterLabel(selectedSet)}**\n` +
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

client.on('interactionCreate', async interaction => {
  try {
    let commandName = interaction.isChatInputCommand() ? interaction.commandName : null;

    if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(interaction.channelId)) {
      if (interaction.isChatInputCommand()) {
        await interaction.reply({
          content: 'Please use commands in the Lore Collector channel 🎴',
          ephemeral: true
        });
      }
      return;
    }

    if (interaction.isButton()) {

      if (interaction.customId === 'announcement_daily') {
        commandName = 'daily';
      } else if (interaction.customId === 'announcement_balance') {
        commandName = 'balance';
      } else if (interaction.customId === 'announcement_pack') {
        commandName = 'pack';
      } else {

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
          collectionData.selectedSet
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
          collectionData.selectedSet
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
        .setTitle(`${rarityEmoji[currentCard.rarity] || '🎴'} ${currentCard.name}`)
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
if (interaction.commandName === 'announcement-set') {

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
if (interaction.commandName === 'announcement-stop') {

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
if (interaction.commandName === 'announcement-status') {

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

if (interaction.commandName === 'mothersday') {
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

    if (interaction.commandName === 'lore') {
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

    if (interaction.commandName === 'daily') {
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
          .setTitle(`${rarityEmoji[randomCard.rarity] || '🎴'} ${randomCard.name}`)
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

      const embed = new EmbedBuilder()
        .setTitle(`${rarityEmoji[randomCard.rarity] || '🎴'} ${randomCard.name}`)
        .setDescription(
          `${randomCard.rarity} | ${randomCard.ink} | ${randomCard.set}\n\n${getPullMessage(randomCard, dailyCardIsNew)}\n\n+${DAILY_INK_REWARD} Ink added.\nCurrent balance: **${newBalance} Ink**`
        )
        .setColor(0x00AE86);

      if (randomCard.image) {
        embed.setImage(randomCard.image);
      }

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

    if (interaction.commandName === 'balance') {
      await interaction.deferReply({ ephemeral: true });

      const userId = interaction.user.id;
      const username = interaction.user.username;

      await ensureUser(userId, username);

      const user = await getUser(userId);
      const balance = user?.ink_balance || 0;

      await interaction.editReply(`You currently have **${balance} Ink**.`);
    }

    if (interaction.commandName === 'pack') {
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

    if (interaction.commandName === 'collection') {
      await interaction.deferReply();

      const userId = interaction.user.id;
      const selectedSet = getSelectedCollectionSet(interaction);

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

      const collectionDetails = buildCollectionDetails(ownedCards, selectedSet);

      if (collectionDetails.length === 0) {
        await interaction.editReply(
          `You do not have any cards from **${getCollectionFilterLabel(selectedSet)}** yet.`
        );
        return;
      }

      pendingCollections.set(userId, {
        cards: collectionDetails,
        page: 0,
        selectedSet
      });

      const reply = await createCollectionReply(
        userId,
        interaction.user.username,
        collectionDetails,
        0,
        selectedSet
      );

      await interaction.editReply(reply);
    }

    if (interaction.commandName === 'dupes') {
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
        const rarityDiff = (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0);
        if (rarityDiff !== 0) return rarityDiff;
        return b.quantity - a.quantity;
      });

      const dupeList = duplicateDetails
        .slice(0, 25)
        .map(card => `${rarityEmoji[card.rarity] || '🎴'} **${card.name}** — x${card.quantity} | ${card.rarity} | ${card.ink}`)
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

    if (interaction.commandName === 'leaderboard') {
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

client.login(process.env.DISCORD_TOKEN);
