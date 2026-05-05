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
  AttachmentBuilder
} = require('discord.js');

const { createClient } = require('@supabase/supabase-js');

const DAILY_INK_REWARD = 20;
const STANDARD_PACK_COST = 100;
const PREMIUM_PACK_COST = 250;

const cards = JSON.parse(fs.readFileSync('./data/cards.json', 'utf8'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const pendingPacks = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily card and Ink for this server'),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your Ink balance'),

  new SlashCommandBuilder()
    .setName('collection')
    .setDescription('View your Lorcana collection binder'),

  new SlashCommandBuilder()
    .setName('dupes')
    .setDescription('View your duplicate Lorcana cards'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View top collectors and richest players'),

  new SlashCommandBuilder()
    .setName('pack')
    .setDescription('Choose and open a Lorcana card pack'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn how to use The Lore Collector')
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

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
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

function createPackChoiceButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`choose_pack_standard_${userId}`)
      .setLabel(`Standard Pack - ${STANDARD_PACK_COST} Ink`)
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`choose_pack_premium_${userId}`)
      .setLabel(`Premium Pack - ${PREMIUM_PACK_COST} Ink`)
      .setStyle(ButtonStyle.Success)
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
    return {
      success: false,
      balance: currentBalance
    };
  }

  const newBalance = currentBalance - amount;

  const { error } = await supabase
    .from('users')
    .update({ ink_balance: newBalance })
    .eq('discord_user_id', userId);

  if (error) throw error;

  return {
    success: true,
    balance: newBalance
  };
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

function escapeSvgText(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function createSvgText(text, width, height, fontSize = 36) {
  return Buffer.from(`
    <svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">
        ${escapeSvgText(text)}
      </text>
    </svg>
  `);
}

async function createCollectionImage(username, collectionDetails) {
  const cardWidth = 160;
  const cardHeight = 224;
  const gap = 24;
  const columns = 5;
  const headerHeight = 140;
  const footerHeight = 60;
  const padding = 32;

  const displayCards = collectionDetails.slice(0, 40);
  const rows = Math.max(1, Math.ceil(displayCards.length / columns));

  const imageWidth = padding * 2 + columns * cardWidth + (columns - 1) * gap;
  const imageHeight =
    headerHeight + padding + rows * (cardHeight + 44) + (rows - 1) * gap + footerHeight;

  const background = sharp({
    create: {
      width: imageWidth,
      height: imageHeight,
      channels: 4,
      background: { r: 22, g: 32, b: 46, alpha: 1 }
    }
  }).png();

  const composites = [];

  const totalCards = collectionDetails.reduce((sum, card) => sum + card.quantity, 0);
  const uniqueCards = collectionDetails.length;

  composites.push({
    input: Buffer.from(`
      <svg width="${imageWidth}" height="${headerHeight}">
        <text x="32" y="54" font-family="Arial, sans-serif" font-size="42" font-weight="800" fill="#ffffff">
          ${escapeSvgText(username)}'s Lorcana Binder
        </text>
        <text x="34" y="98" font-family="Arial, sans-serif" font-size="24" fill="#d9f7f2">
          Total Cards: ${totalCards} • Unique Cards: ${uniqueCards} • Showing ${displayCards.length}
        </text>
      </svg>
    `),
    top: 0,
    left: 0
  });

  for (let i = 0; i < displayCards.length; i++) {
    const card = displayCards[i];
    const row = Math.floor(i / columns);
    const col = i % columns;

    const left = padding + col * (cardWidth + gap);
    const top = headerHeight + row * (cardHeight + 44 + gap);

    try {
      const imageBuffer = await downloadImageBuffer(card.image);
      const resizedCard = await sharp(imageBuffer)
        .resize(cardWidth, cardHeight, { fit: 'cover' })
        .png()
        .toBuffer();

      composites.push({ input: resizedCard, top, left });

      composites.push({
        input: createSvgText(`x${card.quantity}`, 64, 34, 24),
        top: top + cardHeight - 40,
        left: left + cardWidth - 68
      });

      const rarityLabel = Buffer.from(`
        <svg width="${cardWidth}" height="38">
          <text x="50%" y="24" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#ffffff">
            ${escapeSvgText(`${rarityEmoji[card.rarity] || '🎴'} ${card.rarity}`)}
          </text>
        </svg>
      `);

      composites.push({
        input: rarityLabel,
        top: top + cardHeight + 8,
        left
      });
    } catch (error) {
      console.error(`Failed to render card image for ${card.name}:`, error.message);
    }
  }

  if (collectionDetails.length > displayCards.length) {
    composites.push({
      input: Buffer.from(`
        <svg width="${imageWidth}" height="${footerHeight}">
          <text x="50%" y="36" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="20" fill="#d9f7f2">
            Showing first ${displayCards.length} cards sorted by rarity. More binder pages coming soon.
          </text>
        </svg>
      `),
      top: imageHeight - footerHeight,
      left: 0
    });
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

  const userId = interaction.user.id;
  const username = interaction.user.username;

  await ensureUser(userId, username);

  const isPremium = packType === 'premium';
  const cost = isPremium ? PREMIUM_PACK_COST : STANDARD_PACK_COST;
  const packLabel = isPremium ? 'Premium Pack' : 'Standard Pack';

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

  const pulledCards = isPremium ? createPremiumPack() : createStandardPack();
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
    if (interaction.isButton()) {
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

        pendingPacks.delete(ownerId);

        await interaction.update({
          embeds: [embed],
          components: [createRevealButton(ownerId, true, 'Pack Complete')]
        });

        const rarestCard = [...packData.items]
          .map(item => item.card)
          .sort((a, b) => {
            return (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0);
          })[0];

        if (rarestCard.rarity === 'Enchanted') {
          await interaction.followUp('🚨 EVERYONE LOOK 🚨 ENCHANTED PULL IN CHAT 🚨');
        } else if (rarestCard.rarity === 'Legendary') {
          await interaction.followUp(
            `💎 ${interaction.user.username} just pulled a LEGENDARY: **${rarestCard.name}**!`
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

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'help') {
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
          `• Premium Pack — ${PREMIUM_PACK_COST} Ink, better odds\n\n` +
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

      const embed = new EmbedBuilder()
        .setTitle('Choose your pack 🎴')
        .setDescription(
          `Current balance: **${balance} Ink**\n\n` +
          `**Standard Pack** — ${STANDARD_PACK_COST} Ink\n` +
          `3 Common, 2 Uncommon, 1 Rare+\n\n` +
          `**Premium Pack** — ${PREMIUM_PACK_COST} Ink\n` +
          `1 Common, 2 Uncommon, 3 boosted Rare+ pulls`
        )
        .setColor(0x00AE86);

      await interaction.editReply({
        embeds: [embed],
        components: [createPackChoiceButtons(userId)]
      });
    }

    if (interaction.commandName === 'collection') {
      await interaction.deferReply();

      const userId = interaction.user.id;

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

      const collectionDetails = ownedCards
        .map(ownedCard => {
          const cardInfo = getCardById(ownedCard.card_id);
          if (!cardInfo || !cardInfo.image) return null;

          return {
            id: ownedCard.card_id,
            name: cardInfo.name,
            rarity: cardInfo.rarity || 'Unknown',
            ink: cardInfo.ink || 'Unknown',
            set: cardInfo.set || 'Unknown',
            image: cardInfo.image,
            quantity: ownedCard.quantity,
            lastPulledAt: ownedCard.last_pulled_at
          };
        })
        .filter(Boolean);

      collectionDetails.sort((a, b) => {
        const rarityDiff =
          (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0);

        if (rarityDiff !== 0) return rarityDiff;

        return a.name.localeCompare(b.name);
      });

      const imageBuffer = await createCollectionImage(
        interaction.user.username,
        collectionDetails
      );

      const attachment = new AttachmentBuilder(imageBuffer, {
        name: 'collection-binder.png'
      });

      await interaction.editReply({
        content: `Here is your Lorcana binder, ${interaction.user.username} 🎴`,
        files: [attachment]
      });
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
        const rarityDiff =
          (rarityOrder[b.rarity] || 0) - (rarityOrder[a.rarity] || 0);

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
        .setColor(0x00AE86)
        .setFooter({
          text:
            duplicateDetails.length > 25
              ? 'Showing top 25 duplicates sorted by rarity.'
              : 'Sorted by rarity first.'
        });

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