/**
 * Structural metrics fixtures — `large-functions`, `deeply-nested-functions`,
 * `high-complexity-untested`, and `refactor-risk-ranking`.
 */

export function deeplyNested(level: number): number {
  if (level > 0) {
    if (level > 1) {
      if (level > 2) {
        if (level > 3) {
          return level;
        }
        return 3;
      }
      return 2;
    }
    return 1;
  }
  return 0;
}

export function labyrinth(seed: number): number {
  let acc = seed;
  if (seed % 2 === 0) {
    acc += 1;
  } else if (seed % 3 === 0) {
    acc += 2;
  } else if (seed % 5 === 0) {
    acc += 3;
  } else {
    acc -= 1;
  }

  for (let i = 0; i < 4; i++) {
    if (i % 2 === 0) {
      acc += i;
    } else if (i % 3 === 0) {
      acc -= i;
    } else {
      acc *= 2;
    }
    for (let j = 0; j < 3; j++) {
      if (j === 0) {
        acc += 1;
      } else if (j === 1) {
        acc += 2;
      } else if (j === 2) {
        acc += 3;
      }
    }
  }

  if (acc > 100) {
    acc = acc % 100;
  } else if (acc > 50) {
    acc = acc % 50;
  } else if (acc > 25) {
    acc = acc % 25;
  } else if (acc < 0) {
    acc = Math.abs(acc);
  }

  switch (seed % 4) {
    case 0:
      acc += 10;
      break;
    case 1:
      acc += 20;
      break;
    case 2:
      acc += 30;
      break;
    default:
      acc += 40;
      break;
  }

  if (seed > 10) {
    acc += deeplyNested(seed % 5);
  }

  return acc;
}
