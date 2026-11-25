import type {
  CoinEntity,
  GapSegment,
  PatrolEnemy,
  SolidBlock,
} from './types';

export const BLOCK_COLORS = {
  brick: '#b8432e', // Terracotta red-clay masonry brick
  question: '#e59a1a', // Warm gold-amber mystery block
  platform: '#855836', // Natural oak wood & mossy stone bridge deck
  pipe: '#16a34a', // Classic emerald warp pipe
  spring: '#e11d48', // Crimson spring bounce pad
  pause: '#dc2626', // Super Mario Run red Pause Block
  goal_flag: '#f8fafc', // Goal flagpole & stone castle
};

export function makeBlock(
  id: string,
  kind: SolidBlock['kind'],
  x: number,
  y: number,
  width: number,
  height: number,
  reward?: 'coins' | 'mushroom',
): SolidBlock {
  return {
    id,
    kind,
    x,
    y,
    width,
    height,
    colorHex: BLOCK_COLORS[kind],
    hitCount: 0,
    maxHits: kind === 'question' ? 1 : 99,
    hitAnimTimer: 0,
    reward,
    broken: false,
    passed: false,
  };
}

function makeCoinArc(
  prefix: string,
  startX: number,
  baseY: number,
  count: number,
  stepX: number,
  arcHeight: number,
): CoinEntity[] {
  const coins: CoinEntity[] = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const arc = Math.sin(t * Math.PI) * arcHeight;
    coins.push({
      id: `${prefix}_c_${i}`,
      x: startX + i * stepX,
      y: baseY + arc,
      isStarCoin: false,
      collected: false,
    });
  }
  return coins;
}

function makeEnemy(
  id: string,
  x: number,
  y: number,
  patrolRadius: number,
  speed = 2.0,
): PatrolEnemy {
  return {
    id,
    x,
    y,
    width: 0.9,
    height: 0.85,
    minX: x - patrolRadius,
    maxX: x + patrolRadius,
    vx: -speed,
    alive: true,
    squashedTimer: 0,
  };
}

export function createInitialMeadowEntities(): {
  blocks: SolidBlock[];
  coins: CoinEntity[];
  enemies: PatrolEnemy[];
  gaps: GapSegment[];
} {
  return {
    blocks: [
      makeBlock('start_pipe0', 'pipe', 15, 0, 1.6, 0.9), // Low auto-vault starter pipe!
      makeBlock('start_q1', 'question', 24, 3.2, 1.25, 1.25, 'mushroom'),
      makeBlock('start_b1', 'brick', 25.3, 3.2, 1.25, 1.25),
      makeBlock('start_q2', 'question', 26.6, 3.2, 1.25, 1.25, 'coins'),
      makeBlock('start_b2', 'brick', 27.9, 3.2, 1.25, 1.25),
    ],
    coins: [
      ...makeCoinArc('start_a1', 9.5, 1.15, 4, 1.35, 0),
      ...makeCoinArc('start_a2', 24.0, 5.1, 4, 1.35, 0.85),
    ],
    enemies: [makeEnemy('start_e1', 33, 0, 2.2, 1.8)],
    gaps: [],
  };
}

function nextRand(seed: number): [number, number] {
  const next = (seed * 1664525 + 1013904223) >>> 0;
  return [next, next / 4294967296];
}

export function generateMeadowChunk(
  startX: number,
  seed: number,
  chunkIndex: number,
): {
  endX: number;
  nextSeed: number;
  blocks: SolidBlock[];
  coins: CoinEntity[];
  enemies: PatrolEnemy[];
  gaps: GapSegment[];
} {
  let s = seed;
  let r = 0;
  const pick = () => {
    [s, r] = nextRand(s);
    return r;
  };

  const difficultyRamp = Math.min(1, startX / 650);
  const pattern = Math.floor(pick() * 6);
  const blocks: SolidBlock[] = [];
  const coins: CoinEntity[] = [];
  const enemies: PatrolEnemy[] = [];
  const gaps: GapSegment[] = [];
  const prefix = `mr_${chunkIndex}`;
  const chunkWidth = 29;

  if (pattern === 0) {
    // Low pipe auto-vault + brick & ? line + tall pipe
    blocks.push(makeBlock(`${prefix}_p_low`, 'pipe', startX + 4, 0, 1.5, 0.9));
    blocks.push(
      makeBlock(
        `${prefix}_q`,
        'question',
        startX + 12,
        3.3,
        1.25,
        1.25,
        pick() > 0.7 ? 'mushroom' : 'coins',
      ),
    );
    blocks.push(makeBlock(`${prefix}_b`, 'brick', startX + 13.3, 3.3, 1.25, 1.25));
    blocks.push(makeBlock(`${prefix}_p_tall`, 'pipe', startX + 21.5, 0, 1.8, 2.2));
    coins.push(...makeCoinArc(`${prefix}_c`, startX + 11, 5.2, 4, 1.35, 0.9));
    enemies.push(makeEnemy(`${prefix}_e`, startX + 17.5, 0, 2.0, 1.9 + difficultyRamp));
  } else if (pattern === 1) {
    // Pause Block timing puzzle + elevated wooden bridge + Pink Coin
    blocks.push(makeBlock(`${prefix}_pause`, 'pause', startX + 4.5, 0, 1.5, 0.55));
    blocks.push(makeBlock(`${prefix}_plat`, 'platform', startX + 9.5, 3.6, 6.2, 0.85));
    coins.push(...makeCoinArc(`${prefix}_c`, startX + 10.4, 5.0, 4, 1.4, 0));
    coins.push({
      id: `${prefix}_pink`,
      x: startX + 12.6,
      y: 6.7,
      isStarCoin: true,
      collected: false,
    });
    enemies.push(makeEnemy(`${prefix}_e`, startX + 20.5, 0, 2.4, 2.1 + difficultyRamp));
  } else if (pattern === 2) {
    // River ravine gap + wooden platform bridge
    gaps.push({ id: `${prefix}_g`, startX: startX + 7, endX: startX + 11.4 });
    blocks.push(makeBlock(`${prefix}_plat`, 'platform', startX + 13.5, 2.3, 5.8, 0.85));
    coins.push(...makeCoinArc(`${prefix}_c`, startX + 6.5, 1.8, 4, 1.45, 2.1));
  } else if (pattern === 3) {
    // Classic 3-block brick/?/brick + spring pad
    blocks.push(makeBlock(`${prefix}_b1`, 'brick', startX + 6, 3.2, 1.25, 1.25));
    blocks.push(makeBlock(`${prefix}_q1`, 'question', startX + 7.35, 3.2, 1.25, 1.25, 'coins'));
    blocks.push(makeBlock(`${prefix}_b2`, 'brick', startX + 8.7, 3.2, 1.25, 1.25));
    blocks.push(makeBlock(`${prefix}_spr`, 'spring', startX + 18.5, 0, 1.45, 0.6));
    coins.push(...makeCoinArc(`${prefix}_c`, startX + 19.5, 3.6, 4, 1.35, 1.8));
    enemies.push(makeEnemy(`${prefix}_e`, startX + 13, 0, 2.2, 2.0 + difficultyRamp));
  } else if (pattern === 4) {
    // Twin emerald pipes + mushroom patrol
    blocks.push(makeBlock(`${prefix}_p1`, 'pipe', startX + 6, 0, 1.75, 1.75));
    blocks.push(makeBlock(`${prefix}_p2`, 'pipe', startX + 15.5, 0, 1.85, 2.7));
    coins.push(...makeCoinArc(`${prefix}_c`, startX + 14.2, 3.9, 4, 1.35, 1.2));
    enemies.push(makeEnemy(`${prefix}_e`, startX + 10.8, 0, 1.6, 1.8 + difficultyRamp));
  } else {
    // Multi-tier grassland bridge + high Pink Coin
    gaps.push({ id: `${prefix}_g1`, startX: startX + 6.5, endX: startX + 10.0 });
    blocks.push(makeBlock(`${prefix}_plat1`, 'platform', startX + 10.8, 2.2, 4.8, 0.85));
    gaps.push({ id: `${prefix}_g2`, startX: startX + 16.0, endX: startX + 19.6 });
    blocks.push(makeBlock(`${prefix}_plat2`, 'platform', startX + 20.4, 3.9, 4.8, 0.85));
    coins.push(...makeCoinArc(`${prefix}_c`, startX + 11.4, 3.6, 3, 1.4, 0));
    coins.push({
      id: `${prefix}_pink`,
      x: startX + 22.8,
      y: 6.3,
      isStarCoin: true,
      collected: false,
    });
  }

  return {
    endX: startX + chunkWidth,
    nextSeed: s,
    blocks,
    coins,
    enemies,
    gaps,
  };
}
