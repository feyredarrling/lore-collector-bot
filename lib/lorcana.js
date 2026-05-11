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

module.exports = {
  cards,
  supabase,
  rarityEmoji,
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
  createOverlayPullData
};