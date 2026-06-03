/**
 * Shared Lorcana Library
 *
 * Purpose:
 * Central shared game logic used by:
 * - Live Discord bot
 * - Twitch redeem listener
 * - Future overlays
 * - Future Twitch chat integration
 * - Future web/dashboard tools
 *
 * This file should contain reusable systems only.
 * Avoid putting platform-specific Discord/Twitch logic here.
 *
 * Responsibilities:
 * - Load Lorcana card data
 * - Manage Supabase connections
 * - Handle collection updates
 * - Handle duplicate tracking
 * - Generate shared Discord embeds
 * - Generate Twitch chat messages
 * - Generate overlay payloads
 *
 * Environment:
 * Uses whichever environment variables are currently loaded:
 * - .env (production)
 * - .env.test (testing)
 */



const fs = require('fs');

const { createClient } = require('@supabase/supabase-js');
const { EmbedBuilder } = require('discord.js');

const cards = JSON.parse(
  fs.readFileSync('./data/cards.json', 'utf8')
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

function getRandomCardFromSet(setName) {
  const setCards = cards.filter(card => card.set === setName);
  return setCards.length ? getRandomCardFromPool(setCards) : null;
}

function getPullMessage(card, isNew = false) {
  if (isNew) return '✨ **NEW CARD ADDED TO YOUR COLLECTION!** ✨';
  if (card.rarity === 'Enchanted') return '🌈✨ ENCHANTED PULL!!! STOP EVERYTHING.';
  if (card.rarity === 'Legendary') return '💎 LEGENDARY!!! Someone clip that.';
  if (card.rarity === 'Super Rare') return '🟣 Super Rare pull! We take those.';
  if (card.rarity === 'Rare') return '🔵 Nice rare pull.';

  return 'Added to your collection.';
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

async function ensureUserExistsForMerge(supabase, userId, username) {
  const { data: existingUser, error: lookupError } = await supabase
    .from('users')
    .select('discord_user_id')
    .eq('discord_user_id', userId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existingUser) return;

  const { error: insertError } = await supabase
    .from('users')
    .insert({
      discord_user_id: userId,
      username: username || 'Unknown'
    });

  if (insertError) throw insertError;
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

async function addCardToCollection(userId, username, cardId, options = {}) {
  if (!options.skipEnsureUser) {
    await ensureUser(userId, username);
  }

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

    return {
      isNew: false,
      quantity: existingCard.quantity + 1
    };
  }

  const { error } = await supabase.from('user_cards').insert({
    discord_user_id: userId,
    card_id: cardId,
    quantity: 1
  });

  if (error) throw error;

  return {
    isNew: true,
    quantity: 1
  };
}

function createSingleCardEmbed({
  username,
  card,
  isNew = false,
  quantity = null,
  titlePrefix = ''
}) {
  const embed = new EmbedBuilder()
    .setTitle(`${titlePrefix}${rarityEmoji[card.rarity] || '🎴'} ${card.name}`)
    .setDescription(
      `${card.rarity} | ${card.ink} | ${card.set}\n\n` +
      `${getPullMessage(card, isNew)}` +
      (quantity !== null ? `\n\nQuantity Owned: **${quantity}**` : '')
    )
    .setColor(0x00AE86);

  if (card.image) {
    embed.setImage(card.image);
  }

  if (username) {
    embed.setFooter({ text: `Pulled by ${username}` });
  }

  return embed;
}

function createTwitchPullMessage({
  username,
  card,
  setName
}) {
  return `${username} pulled ${rarityEmoji[card.rarity] || '🎴'} ${card.name} from ${setName}!`;
}

function createOverlayPullData({
  username,
  card,
  setName,
  isNew = false,
  quantity = null
}) {
  return {
    type: 'lorcana_pull',
    username,
    setName,
    card: {
      id: card.id,
      name: card.name,
      rarity: card.rarity,
      ink: card.ink,
      set: card.set,
      image: card.image
    },
    isNew,
    quantity,
    message: getPullMessage(card, isNew),
    rarityEmoji: rarityEmoji[card.rarity] || '🎴',
    createdAt: new Date().toISOString()
  };
}

// =====================================================
// TWITCH ACCOUNT LINKING HELPERS
// =====================================================


/**
 * Checks whether a Discord user already has a linked Twitch account.
 */
async function getLinkedTwitchAccount(supabase, discordUserId) {
  const { data, error } = await supabase
    .from('linked_accounts')
    .select('*')
    .eq('discord_user_id', discordUserId)
    .maybeSingle();

  if (error) {
    console.error('Error checking linked Twitch account:', error);
    return null;
  }

  return data;
}

// =====================================================
// Twitch Collection Helpers
// Stores Twitch-only pulls before a Discord account is linked.
// =====================================================

/**
 * Adds a card to a Twitch user's temporary collection.
 * Used before a Twitch account is linked to Discord.
 */
async function addCardToTwitchCollection(
  supabase,
  twitchUserId,
  twitchUsername,
  cardId
) {
  const { data: existingCard, error: lookupError } = await supabase
    .from('twitch_user_cards')
    .select('*')
    .eq('twitch_user_id', twitchUserId)
    .eq('card_id', cardId)
    .maybeSingle();

  if (lookupError) {
    console.error('Error checking Twitch collection:', lookupError);
    return null;
  }

  if (existingCard) {
    const { data, error } = await supabase
      .from('twitch_user_cards')
      .update({
        quantity: existingCard.quantity + 1,
        last_pulled_at: new Date().toISOString()
      })
      .eq('id', existingCard.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating Twitch collection:', error);
      return null;
    }

    return {
      isNew: false,
      quantity: data.quantity
    };
  }

  const { data, error } = await supabase
    .from('twitch_user_cards')
    .insert({
      twitch_user_id: twitchUserId,
      twitch_username: twitchUsername,
      card_id: cardId,
      quantity: 1
    })
    .select()
    .single();

  if (error) {
    console.error('Error inserting Twitch collection card:', error);
    return null;
  }

  return {
    isNew: true,
    quantity: 1
  };
}

/**
 * Merges all Twitch-only cards into the linked Discord collection.
 * Keeps the Twitch records for audit/history and marks them as merged.
 */
async function mergeTwitchCollectionIntoDiscord(
  supabase,
  twitchUserId,
  discordUserId,
  discordUsername
) {
  try {
    await ensureUserExistsForMerge(supabase, discordUserId, discordUsername);
  } catch (error) {
    console.error('Error ensuring Discord user exists for Twitch merge:', error);
    return { success: false, mergedCount: 0 };
  }

  const { data: twitchCards, error: fetchError } = await supabase
    .from('twitch_user_cards')
    .select('*')
    .eq('twitch_user_id', twitchUserId)
    .is('merged_at', null);

  if (fetchError) {
    console.error('Error fetching Twitch cards for merge:', fetchError);
    return { success: false, mergedCount: 0 };
  }

  if (!twitchCards || twitchCards.length === 0) {
    return { success: true, mergedCount: 0 };
  }

  for (const twitchCard of twitchCards) {
    try {
      for (let i = 0; i < twitchCard.quantity; i++) {
        await addCardToCollection(discordUserId, discordUsername, twitchCard.card_id, {
          skipEnsureUser: true
        });
      }
    } catch (error) {
      console.error('Error adding Twitch cards to Discord collection:', error);
      return { success: false, mergedCount: 0 };
    }

    const { error: markMergedError } = await supabase
      .from('twitch_user_cards')
      .update({
        merged_to_discord_user_id: discordUserId,
        merged_at: new Date().toISOString()
      })
      .eq('id', twitchCard.id);

    if (markMergedError) {
      console.error('Error marking Twitch cards as merged:', markMergedError);
      return { success: false, mergedCount: 0 };
    }
  }

  const mergedCount = twitchCards.reduce((sum, card) => sum + card.quantity, 0);

  return {
    success: true,
    mergedCount
  };
}


module.exports = {
  cards,
  supabase,
  rarityEmoji,
  rarityOrder,
  getCardById,
  getRandomCardFromPool,
  getRandomCardFromSet,
  getPullMessage,
  createSingleCardEmbed,
  ensureUser,
  getUser,
  isNewCard,
  addCardToCollection,
  createTwitchPullMessage,
  createOverlayPullData,
  getLinkedTwitchAccount,
  addCardToTwitchCollection,
  mergeTwitchCollectionIntoDiscord
};
