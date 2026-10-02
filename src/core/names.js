// Random track names: three distinct words, shuffled through a few shapes.

const ADJECTIVES = [
  'Amber', 'Ashen', 'Broken', 'Burnt', 'Cosmic', 'Crooked', 'Dusty', 'Electric', 'Feral', 'Frozen',
  'Ghostly', 'Golden', 'Hollow', 'Hungry', 'Lazy', 'Liquid', 'Lonely', 'Lucky', 'Midnight', 'Neon',
  'Paper', 'Purple', 'Restless', 'Rusty', 'Sacred', 'Salty', 'Silent', 'Sleepy', 'Smoky', 'Static',
  'Sticky', 'Sunken', 'Tangled', 'Tiny', 'Velvet', 'Wicked', 'Wild', 'Wooden', 'Woolly', 'Young',
  'Ancient', 'Bitter', 'Brave', 'Cracked', 'Crystal', 'Distant', 'Fuzzy', 'Gentle', 'Haunted', 'Heavy',
  'Infinite', 'Magnetic', 'Molten', 'Nervous', 'Polished', 'Secret', 'Strange', 'Sweet', 'Twisted', 'Weird',
  // colours
  'Azure', 'Black', 'Blue', 'Cobalt', 'Copper', 'Crimson', 'Emerald', 'Indigo', 'Ivory', 'Jade',
  'Lavender', 'Lilac', 'Magenta', 'Orange', 'Pink', 'Red', 'Scarlet', 'Silver', 'Teal', 'White',
];

const NOUNS = [
  'Anchor', 'Arcade', 'Ashes', 'Bonfire', 'Cassette', 'Cathedral', 'Comet', 'Coyote', 'Desert', 'Embers',
  'Engine', 'Factory', 'Feather', 'Forest', 'Furnace', 'Garden', 'Glacier', 'Harbor', 'Lantern', 'Lighthouse',
  'Machine', 'Meadow', 'Mirror', 'Moon', 'Moth', 'Ocean', 'Orchard', 'Pilot', 'Radio', 'River',
  'Robot', 'Sailor', 'Signal', 'Spark', 'Stranger', 'Thunder', 'Tiger', 'Tower', 'Voltage', 'Wolf',
  'Astronaut', 'Balloon', 'Bandit', 'Basement', 'Canyon', 'Carnival', 'Circuit', 'Cloud', 'Diamond', 'Dragon',
  'Echo', 'Fox', 'Ghost', 'Highway', 'Island', 'Jungle', 'Kitten', 'Lagoon', 'Magnet', 'Monster',
  'Mountain', 'Owl', 'Phantom', 'Planet', 'Rain', 'Rocket', 'Satellite', 'Shadow', 'Snake', 'Volcano',
];

const VERBS = [
  'Burning', 'Chasing', 'Crawling', 'Dancing', 'Dreaming', 'Drifting', 'Falling', 'Floating', 'Flying', 'Glowing',
  'Howling', 'Humming', 'Hunting', 'Melting', 'Running', 'Shaking', 'Sinking', 'Sleeping', 'Spinning', 'Swimming',
  'Talking', 'Waiting', 'Walking', 'Whispering', 'Wandering',
  'Blinking', 'Breaking', 'Calling', 'Climbing', 'Crying', 'Digging', 'Fading', 'Glitching', 'Jumping', 'Laughing',
  'Rolling', 'Screaming', 'Shining', 'Singing', 'Smiling', 'Stealing', 'Waking', 'Watching', 'Weeping', 'Bleeding',
];

const SHAPES = [
  ['adj', 'noun', 'noun'], // Rusty Radio Tower
  ['verb', 'adj', 'noun'], // Drifting Velvet Moon
  ['adj', 'adj', 'noun'], // Lazy Golden Comet
  ['verb', 'noun', 'noun'], // Howling Furnace Wolf
  ['noun', 'verb', 'noun'], // Moth Chasing Lantern
];
const LISTS = { adj: ADJECTIVES, noun: NOUNS, verb: VERBS };

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function randomName() {
  const used = new Set();
  return pick(SHAPES).map((kind) => {
    let w;
    do w = pick(LISTS[kind]); while (used.has(w));
    used.add(w);
    return w;
  }).join(' ');
}
