const TOPS = [
  " .-\"\"-. ",
  " .----. ",
  " .-~~-. ",
  " .-__-. ",
  " .-==-. "
];

const EYES = [
  "| o  o |",
  "| ^  ^ |",
  "| -  - |",
  "| @  @ |",
  "| 0  0 |"
];

const NOSES = [
  "|   ^  |",
  "|   v  |",
  "|   -  |",
  "|   ~  |",
  "|   _  |"
];

const MOUTHS = [
  "|  \\_/ |",
  "|  ___ |",
  "|  --- |",
  "|  _-_ |",
  "|  uuu |"
];

const CHINS = [
  " '----' ",
  " `----` ",
  " '====' ",
  " `====` ",
  " '____' "
];

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(list, hash, shift) {
  const index = (hash >>> shift) % list.length;
  return list[index];
}

export function generateAsciiPortrait(seed = "") {
  const hash = hashSeed(String(seed));
  return [
    pick(TOPS, hash, 0),
    pick(EYES, hash, 3),
    pick(NOSES, hash, 6),
    pick(MOUTHS, hash, 9),
    pick(CHINS, hash, 12),
  ];
}
