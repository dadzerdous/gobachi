
export function createFeedingSession(config) {
  const {
    totalDrops,
    coopBonusPerPlayer,
    coopBonusCap
  } = config;

  let hits = 0;
  let finished = 0;

  function registerDrop(success) {
    finished++;
    if (success) hits++;
  }

  function isComplete() {
    return finished >= totalDrops;
  }

  function getStats(players = 1) {
    const basePercent = totalDrops > 0
      ? Math.round((hits / totalDrops) * 100)
      : 0;

    const coopBonus = Math.min(
      players * coopBonusPerPlayer,
      coopBonusCap
    );

    return {
      percent: basePercent + coopBonus,
      hits,
      misses: totalDrops - hits,
      drops: totalDrops,
      players
    };
  }

  return {
    registerDrop,
    isComplete,
    getStats
  };
}
