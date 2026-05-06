const fs = require('fs');

const cards = JSON.parse(fs.readFileSync('./data/cards.json', 'utf8'));

const searchTerms = [
  'nani',
  'kala',
  'sarabi',
  'perdita',
  'eudora',
  'mrs. potts',
  'mrs potts',
  'queen',
  'mother',
  'mama',
  'alma',
  'ming lee',
  'sina',
  'helen',
  'elastigirl',
  'rapunzel',
  'gothel',
  'julieta',
  'mirabel',
  'maribel'
];

const matches = cards.filter(card => {
  const name = String(card.name || '').toLowerCase();
  return searchTerms.some(term => name.includes(term));
});

const uniqueNames = [...new Set(matches.map(card => card.name))].sort();

console.log(`Found ${matches.length} matching card prints`);
console.log(`Found ${uniqueNames.length} unique matching names\n`);

uniqueNames.forEach(name => console.log(name));