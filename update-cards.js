const fs = require('fs');

const raritiesToFetch = [
  'common',
  'uncommon',
  'rare',
  'super rare',
  'legendary',
  'enchanted',
  'promo'
];

function normalizeRarity(rarity) {
  const rarityMap = {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    'super rare': 'Super Rare',
    legendary: 'Legendary',
    enchanted: 'Enchanted',
    promo: 'Promo'
  };

  return rarityMap[String(rarity).toLowerCase()] || rarity;
}

function getCardImage(card) {
  return (
    card.image_uris?.digital?.large ||
    card.image_uris?.digital?.normal ||
    card.image_uris?.digital?.small ||
    null
  );
}

function formatCard(card) {
  return {
    id: card.id,
    name: card.version ? `${card.name} - ${card.version}` : card.name,
    rarity: normalizeRarity(card.rarity),
    ink: card.ink || 'None',
    set: card.set?.name || 'Unknown Set',
    image: getCardImage(card),
    cost: card.cost ?? null,
    type: Array.isArray(card.type) ? card.type.join(', ') : '',
    collector_number: card.collector_number || '',
    set_code: card.set?.code || ''
  };
}

async function fetchCardsByRarity(rarity) {
  const encodedRarity = encodeURIComponent(`rarity:${rarity}`);
  const url = `https://api.lorcast.com/v0/cards/search?q=${encodedRarity}&unique=prints`;

  console.log(`Fetching ${rarity} cards...`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API request failed for ${rarity}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.results || [];
}

async function updateCards() {
  let allCards = [];

  for (const rarity of raritiesToFetch) {
    const cards = await fetchCardsByRarity(rarity);
    allCards = allCards.concat(cards);
  }

  const uniqueCards = Array.from(
    new Map(allCards.map(card => [card.id, card])).values()
  );

  const formattedCards = uniqueCards
    .map(formatCard)
    .filter(card => card.id && card.name && card.image);

  fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync('./data/cards.json', JSON.stringify(formattedCards, null, 2));

  console.log(`Saved ${formattedCards.length} cards to data/cards.json`);
}

updateCards().catch(error => {
  console.error('Failed to update cards:', error);
  process.exit(1);
});