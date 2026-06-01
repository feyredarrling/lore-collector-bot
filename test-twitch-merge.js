require('dotenv').config({ path: '.env.test' });

if (process.env.NODE_ENV !== 'test' || process.env.BOT_MODE !== 'test') {
  throw new Error('Safety stop: run with NODE_ENV=test and BOT_MODE=test.');
}

const assert = require('assert');
const lorcana = require('./lib/lorcana');

const supabase = lorcana.supabase;

const TEST_DISCORD_USER_ID = 'codex_merge_test_discord_user';
const TEST_TWITCH_USER_ID = 'codex_merge_test_twitch_user';
const TEST_DISCORD_USERNAME = 'CodexMergeDiscord';
const TEST_TWITCH_USERNAME = 'CodexMergeTwitch';

async function cleanup() {
  await supabase
    .from('user_cards')
    .delete()
    .eq('discord_user_id', TEST_DISCORD_USER_ID);

  await supabase
    .from('twitch_user_cards')
    .delete()
    .eq('twitch_user_id', TEST_TWITCH_USER_ID);

  await supabase
    .from('users')
    .delete()
    .eq('discord_user_id', TEST_DISCORD_USER_ID);
}

async function getUserCard(cardId) {
  const { data, error } = await supabase
    .from('user_cards')
    .select('*')
    .eq('discord_user_id', TEST_DISCORD_USER_ID)
    .eq('card_id', cardId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getUnmergedTwitchCards() {
  const { data, error } = await supabase
    .from('twitch_user_cards')
    .select('*')
    .eq('twitch_user_id', TEST_TWITCH_USER_ID)
    .is('merged_at', null);

  if (error) throw error;
  return data || [];
}

async function main() {
  const [firstCard, secondCard] = lorcana.cards;

  assert(firstCard?.id, 'First test card is missing.');
  assert(secondCard?.id, 'Second test card is missing.');
  assert.notStrictEqual(firstCard.id, secondCard.id, 'Test cards must be different.');

  await cleanup();
  await lorcana.ensureUser(TEST_DISCORD_USER_ID, TEST_DISCORD_USERNAME);

  await lorcana.addCardToTwitchCollection(
    supabase,
    TEST_TWITCH_USER_ID,
    TEST_TWITCH_USERNAME,
    firstCard.id
  );
  await lorcana.addCardToTwitchCollection(
    supabase,
    TEST_TWITCH_USER_ID,
    TEST_TWITCH_USERNAME,
    firstCard.id
  );
  await lorcana.addCardToTwitchCollection(
    supabase,
    TEST_TWITCH_USER_ID,
    TEST_TWITCH_USERNAME,
    secondCard.id
  );

  const mergeResult = await lorcana.mergeTwitchCollectionIntoDiscord(
    supabase,
    TEST_TWITCH_USER_ID,
    TEST_DISCORD_USER_ID,
    TEST_DISCORD_USERNAME
  );

  assert.deepStrictEqual(mergeResult, { success: true, mergedCount: 3 });

  const mergedFirstCard = await getUserCard(firstCard.id);
  const mergedSecondCard = await getUserCard(secondCard.id);

  assert.strictEqual(mergedFirstCard.quantity, 2);
  assert.strictEqual(mergedSecondCard.quantity, 1);

  const unmergedAfterFirstRun = await getUnmergedTwitchCards();
  assert.strictEqual(unmergedAfterFirstRun.length, 0);

  const secondMergeResult = await lorcana.mergeTwitchCollectionIntoDiscord(
    supabase,
    TEST_TWITCH_USER_ID,
    TEST_DISCORD_USER_ID,
    TEST_DISCORD_USERNAME
  );

  assert.deepStrictEqual(secondMergeResult, { success: true, mergedCount: 0 });

  const firstCardAfterSecondRun = await getUserCard(firstCard.id);
  const secondCardAfterSecondRun = await getUserCard(secondCard.id);

  assert.strictEqual(firstCardAfterSecondRun.quantity, 2);
  assert.strictEqual(secondCardAfterSecondRun.quantity, 1);

  await cleanup();

  console.log('Twitch merge test passed.');
}

main().catch(async error => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
