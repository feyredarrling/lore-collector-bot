require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const cards = JSON.parse(fs.readFileSync('./data/cards.json', 'utf8'));

const validIds = new Set(cards.map(c => c.id));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanup() {
  console.log('Cleaning invalid cards...');

  const { data: userCards, error } = await supabase
    .from('user_cards')
    .select('*');

  if (error) throw error;

  const invalid = userCards.filter(c => !validIds.has(c.card_id));

  console.log(`Found ${invalid.length} invalid cards`);

  for (const card of invalid) {
    await supabase
      .from('user_cards')
      .delete()
      .eq('id', card.id);
  }

  console.log('Cleanup complete');
}

cleanup();