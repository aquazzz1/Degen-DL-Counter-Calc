const MAX_ENEMIES = 6;
const SELF_HERO_STAR_THRESHOLD = 0.08;
const SELF_HERO_SCORE_SCALE = 100;
const ITEM_NAME_ALIASES = {
  debuffremover: "Dispel Magic"
};

const heroBoard = document.getElementById("hero-board");
const fillDemoButton = document.getElementById("fill-demo");
const importSheetButton = document.getElementById("import-sheet");
const exportSheetButton = document.getElementById("export-sheet");
const importSheetFileInput = document.getElementById("import-sheet-file");
const clearAllButton = document.getElementById("clear-all");
const selectionSummary = document.getElementById("selection-summary");
const teamSummary = document.getElementById("team-summary");
const apiStatus = document.getElementById("api-status");
const emptyState = document.getElementById("results-empty");
const resultsList = document.getElementById("results-list");

const heroNames = window.counterData.heroOrder.slice().sort((a, b) => a.localeCompare(b));
const defaultDemoTeam = ["Lash", "Seven", "Bebop", "Ivy", "Vindicta", "Warden"];
let activeHeroCounters = cloneHeroCounters(window.counterData.heroCounters || {});
const selectionState = {
  enemies: new Set(),
  selfHero: ""
};
const apiState = {
  heroesByName: {},
  itemsById: {},
  selfHeroStatsHeroName: "",
  selfHeroStatsByItem: {},
  assetsLoaded: false,
  loadingAssets: false,
  loadingSelfHeroStats: false,
  assetError: "",
  selfHeroStatsError: "",
  lastSelfHeroStatsLoadedAt: 0,
  preferredItemNamesBySlug: {}
};

refreshPreferredItemNames();
buildHeroBoard();
renderAll();
void initializeApiData();

fillDemoButton.addEventListener("click", () => {
  selectionState.enemies = new Set(defaultDemoTeam);
  selectionState.selfHero = "Haze";
  renderAll();
  void ensureSelfHeroStats("Haze");
});

clearAllButton.addEventListener("click", () => {
  selectionState.enemies.clear();
  selectionState.selfHero = "";
  resetSelfHeroStats();
  renderAll();
});

importSheetButton.addEventListener("click", () => {
  importSheetFileInput.click();
});

exportSheetButton.addEventListener("click", () => {
  exportActiveCheatsheet();
});

importSheetFileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const nextHeroCounters = parsed.heroCounters || parsed;
    activeHeroCounters = sanitizeImportedHeroCounters(nextHeroCounters);
    refreshPreferredItemNames();
    renderAll();
    apiStatus.textContent = `Imported cheatsheet from ${file.name}.`;
  } catch (error) {
    console.error("Failed to import cheatsheet.", error);
    apiStatus.textContent = "Import failed. Use a JSON file with hero names mapped to item lists.";
  } finally {
    importSheetFileInput.value = "";
  }
});

function buildHeroBoard() {
  heroBoard.innerHTML = "";
  heroBoard.dataset.heroCount = String(heroNames.length);

  heroNames.forEach((hero) => {
    const iconPath = window.counterData.heroIcons?.[hero] || "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hero-tile";
    button.dataset.hero = hero;
    button.title = hero;
    button.setAttribute("aria-label", hero);
    button.innerHTML = `
      <span class="hero-art-wrap">
        ${iconPath ? `<img class="hero-art" src="${escapeHtml(iconPath)}" alt="${escapeHtml(hero)}">` : `<span class="hero-fallback">${escapeHtml(hero)}</span>`}
      </span>
      <span class="hero-name">${escapeHtml(hero)}</span>
    `;

    button.addEventListener("click", () => toggleEnemy(hero));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      setSelfHero(hero);
    });

    heroBoard.appendChild(button);
  });
}

function toggleEnemy(hero) {
  if (selectionState.enemies.has(hero)) {
    selectionState.enemies.delete(hero);
    renderAll();
    return;
  }

  if (selectionState.selfHero === hero) {
    selectionState.selfHero = "";
    resetSelfHeroStats();
  }

  if (selectionState.enemies.size >= MAX_ENEMIES) {
    selectionSummary.textContent = "6 / 6 enemy heroes selected. Click one to remove it first.";
    return;
  }

  selectionState.enemies.add(hero);
  renderAll();
}

function setSelfHero(hero) {
  if (selectionState.selfHero === hero) {
    selectionState.selfHero = "";
    resetSelfHeroStats();
    renderAll();
    return;
  }

  selectionState.enemies.delete(hero);
  selectionState.selfHero = hero;
  renderAll();
  void ensureSelfHeroStats(hero);
}

function renderAll() {
  updateHeroBoard();
  updateSummaryText();
  updateApiStatus();
  renderRankings();
}

function updateHeroBoard() {
  const heroTiles = [...document.querySelectorAll("[data-hero]")];

  heroTiles.forEach((tile) => {
    const hero = tile.dataset.hero;
    const isEnemy = selectionState.enemies.has(hero);
    const isSelf = selectionState.selfHero === hero;

    tile.classList.toggle("is-enemy", isEnemy);
    tile.classList.toggle("is-self", isSelf);
  });
}

function updateSummaryText() {
  const enemyCount = selectionState.enemies.size;
  const selfText = selectionState.selfHero ? ` Your hero: ${selectionState.selfHero}.` : " No self hero selected.";
  selectionSummary.textContent = `${enemyCount} / 6 enemy heroes selected.${selfText}`;
}

function renderRankings() {
  const selectedEnemies = [...selectionState.enemies];
  const selfHero = selectionState.selfHero;
  const rankings = rankItems(selectedEnemies, selfHero);

  updateTeamSummary(selectedEnemies, selfHero);

  if (!selectedEnemies.length || !rankings.length) {
    emptyState.hidden = false;
    resultsList.hidden = true;
    resultsList.innerHTML = "";
    return;
  }

  emptyState.hidden = true;
  resultsList.hidden = false;
  resultsList.innerHTML = rankings.map(buildResultRowMarkup).join("");
}

function rankItems(selectedEnemies, selfHero) {
  const itemMap = new Map();
  const selfHeroStats = apiState.selfHeroStatsByItem;
  const activeCounters = buildWeightedCuratedCounters();

  selectedEnemies.forEach((hero) => {
    const counters = activeCounters[hero] || [];

    counters.forEach((entry) => {
      const itemName = entry.item;
      const weight = typeof entry.weight === "number" ? entry.weight : 1;

      if (!itemMap.has(itemName)) {
        itemMap.set(itemName, {
          item: itemName,
          heroes: new Set(),
          rawScore: 0
        });
      }

      const itemState = itemMap.get(itemName);
      itemState.heroes.add(hero);
      itemState.rawScore += weight;
    });
  });

  const totalEnemies = selectedEnemies.length || 1;

  return [...itemMap.values()]
    .map((item) => {
      const coverageCount = item.heroes.size;
      const coveragePercent = (coverageCount / totalEnemies) * 100;
      const weightedPercent = (item.rawScore / totalEnemies) * 100;
      const selfHeroSignal = selfHeroStats[item.item] || null;
      const selfHeroBonus = Math.max(0, (selfHeroSignal?.score || 0) * SELF_HERO_SCORE_SCALE);
      const totalScore = weightedPercent + selfHeroBonus;
      const isStrongSelfItem = Boolean(selfHeroSignal && selfHeroSignal.score >= SELF_HERO_STAR_THRESHOLD);

      return {
        ...item,
        coverageCount,
        coveragePercent,
        weightedPercent,
        selfHeroBonus,
        totalScore,
        isStrongSelfItem,
        heroList: [...item.heroes].sort((a, b) => a.localeCompare(b)),
        selfHeroSignal
      };
    })
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }

      const selfHeroScoreDelta = (right.selfHeroSignal?.score || 0) - (left.selfHeroSignal?.score || 0);
      if (selfHeroScoreDelta !== 0) {
        return selfHeroScoreDelta;
      }

      if (right.coverageCount !== left.coverageCount) {
        return right.coverageCount - left.coverageCount;
      }

      return left.item.localeCompare(right.item);
    });
}

function updateTeamSummary(selectedEnemies, selfHero) {
  if (!selectedEnemies.length) {
    teamSummary.textContent = "Choose enemy heroes to begin.";
    return;
  }

  const enemyText = `Enemy team: ${selectedEnemies.join(", ")}.`;
  const selfText = selfHero ? ` Self hero: ${selfHero}.` : "";
  teamSummary.textContent = `${enemyText}${selfText}`;
}

function buildWeightedCuratedCounters() {
  const overrides = window.counterData.publicWeightOverrides || {};
  const weightedCounters = {};

  Object.entries(activeHeroCounters).forEach(([hero, counters]) => {
    weightedCounters[hero] = counters.map((entry) => ({
      ...entry,
      weight: overrides?.[hero]?.[entry.item] ?? entry.weight ?? 1
    }));
  });

  return weightedCounters;
}

function buildResultRowMarkup(item, index) {
  const itemIconPath = getItemIconPath(item.item);
  const podiumClass = index === 0 ? "podium-1" : index === 1 ? "podium-2" : index === 2 ? "podium-3" : "";
  const trustMarkup = item.isStrongSelfItem && selectionState.selfHero
    ? `<span class="trust-badge">Strong on ${escapeHtml(selectionState.selfHero)}</span>`
    : "";
  const coverageText = `${item.coveragePercent.toFixed(0)}%`;
  const scoreText = `${item.totalScore.toFixed(0)}%`;
  const heroTags = item.heroList.map((hero) => `<span class="mini-chip">${escapeHtml(hero)}</span>`).join("");
  const bonusMeta = item.selfHeroBonus > 0
    ? `<span class="score-small">+${item.selfHeroBonus.toFixed(0)} self bonus</span>`
    : "";
  const selfHeroMeta = item.selfHeroSignal
    ? `<span class="score-small">${escapeHtml(selectionState.selfHero)} ${item.selfHeroSignal.winRateText} WR | ${item.selfHeroSignal.pickRateText} PR</span>`
    : "";

  return `
    <li class="result-row ${item.isStrongSelfItem ? "is-synergy" : ""} ${podiumClass}">
      <div class="rank-cell">${index + 1}</div>
      <div class="icon-cell">
        ${itemIconPath ? `<img class="item-icon item-icon-large" src="${escapeHtml(itemIconPath)}" alt="${escapeHtml(item.item)}">` : ""}
      </div>
      <div class="item-cell">
        <span class="item-name">
          ${escapeHtml(item.item)}
        </span>
        ${trustMarkup}
        <span class="hero-mini-row">${heroTags}</span>
      </div>
      <div class="score-cell">
        <span class="score-big">${escapeHtml(scoreText)}</span>
        <span class="score-small">${escapeHtml(coverageText)} cover</span>
        ${bonusMeta}
        ${selfHeroMeta}
      </div>
    </li>
  `;
}

async function initializeApiData() {
  if (apiState.assetsLoaded || apiState.loadingAssets) {
    return;
  }

  apiState.loadingAssets = true;
  apiState.assetError = "";
  renderAll();

  try {
    const [heroesResponse, itemsResponse] = await Promise.all([
      fetch("https://assets.deadlock-api.com/v2/heroes"),
      fetch("https://assets.deadlock-api.com/v2/items")
    ]);

    if (!heroesResponse.ok || !itemsResponse.ok) {
      throw new Error("Failed to load Deadlock asset metadata.");
    }

    const heroes = await heroesResponse.json();
    const items = await itemsResponse.json();

    apiState.heroesByName = Object.fromEntries(
      heroes
        .filter((hero) => hero.player_selectable)
        .map((hero) => [hero.name, hero.id])
    );
    apiState.itemsById = Object.fromEntries(
      items.map((item) => [item.id, normalizeApiItemName(item.name)])
    );
    apiState.assetsLoaded = true;
  } catch (error) {
    console.error("Failed to initialize Deadlock API assets.", error);
    apiState.assetError = "Public metadata unavailable. Using local cheatsheet data only.";
  } finally {
    apiState.loadingAssets = false;
    renderAll();
  }
}

async function ensureSelfHeroStats(heroName) {
  if (!heroName) {
    resetSelfHeroStats();
    renderAll();
    return;
  }

  if (!apiState.assetsLoaded) {
    await initializeApiData();
  }

  const heroId = apiState.heroesByName[heroName];
  apiState.selfHeroStatsHeroName = heroName;
  apiState.selfHeroStatsError = "";

  if (!heroId) {
    apiState.selfHeroStatsByItem = {};
    apiState.selfHeroStatsError = "No public hero mapping found. Ranking is using cheatsheet data only.";
    renderAll();
    return;
  }

  apiState.loadingSelfHeroStats = true;
  renderAll();

  try {
    const response = await fetch(`https://api.deadlock-api.com/v1/analytics/item-stats?hero_id=${heroId}&min_matches=50`);
    if (!response.ok) {
      throw new Error("Failed to load self hero item stats.");
    }

    const stats = await response.json();
    const maxPlayers = stats.reduce((maxValue, entry) => Math.max(maxValue, entry.players || 0), 0) || 1;
    const averageWinRate = stats.length
      ? stats.reduce((sum, entry) => sum + ((entry.matches || 0) > 0 ? (entry.wins || 0) / (entry.matches || 1) : 0), 0) / stats.length
      : 0;
    const averagePickRate = stats.length
      ? stats.reduce((sum, entry) => sum + ((entry.players || 0) / maxPlayers), 0) / stats.length
      : 0;
    const mappedStats = {};

    stats.forEach((entry) => {
      const itemName = normalizeApiItemName(apiState.itemsById[entry.item_id]);
      if (!itemName) {
        return;
      }

      const matches = entry.matches || 0;
      const players = entry.players || 0;
      const wins = entry.wins || 0;
      const winRate = matches > 0 ? wins / matches : 0;
      const pickRate = players / maxPlayers;
      const winRateDelta = winRate - averageWinRate;
      const pickRateDelta = pickRate - averagePickRate;

      mappedStats[itemName] = {
        score: (winRateDelta + pickRateDelta) / 2,
        winRate,
        pickRate,
        winRateDelta,
        pickRateDelta,
        winRateText: `${(winRate * 100).toFixed(1)}%`,
        pickRateText: `${(pickRate * 100).toFixed(1)}%`,
        deltaText: `${(((winRateDelta + pickRateDelta) / 2) * 100).toFixed(1)}`
      };
    });

    if (selectionState.selfHero === heroName) {
      apiState.selfHeroStatsByItem = mappedStats;
      apiState.lastSelfHeroStatsLoadedAt = Date.now();
    }
  } catch (error) {
    console.error("Failed to load live self hero item stats.", error);

    if (selectionState.selfHero === heroName) {
      apiState.selfHeroStatsByItem = {};
      apiState.selfHeroStatsError = "Self-hero win and pick-rate data could not be loaded. Ranking is using cheatsheet weights only.";
    }
  } finally {
    apiState.loadingSelfHeroStats = false;
    renderAll();
  }
}

function updateApiStatus() {
  apiStatus.textContent = getApiStatusText();
}

function getApiStatusText() {
  if (apiState.loadingAssets) {
    return "Loading public item metadata...";
  }

  if (apiState.assetError) {
    return apiState.assetError;
  }

  if (apiState.loadingSelfHeroStats && selectionState.selfHero) {
    return "Loading self-hero win and pick-rate data...";
  }

  if (apiState.selfHeroStatsError) {
    return apiState.selfHeroStatsError;
  }

  if (selectionState.selfHero && apiState.selfHeroStatsHeroName === selectionState.selfHero && Object.keys(apiState.selfHeroStatsByItem).length) {
    return `Self-hero data loaded ${formatTimestamp(apiState.lastSelfHeroStatsLoadedAt)}.`;
  }

  return "Enemy counters use the local weighted cheatsheet. Self-hero data will load when you right-click your hero.";
}

function getItemIconPath(itemName) {
  const normalizedName = normalizeApiItemName(itemName);
  const fileName = String(normalizedName || itemName).replace(/[^A-Za-z0-9]+/g, "");
  return fileName ? `DLicons/Items/flat/${fileName}.png` : "";
}

function cloneHeroCounters(heroCounters) {
  return Object.fromEntries(
    Object.entries(heroCounters).map(([hero, items]) => [
      hero,
      items.map((entry) => ({ item: entry.item, weight: entry.weight }))
    ])
  );
}

function sanitizeImportedHeroCounters(nextHeroCounters) {
  const sanitized = {};

  heroNames.forEach((hero) => {
    const rawItems = nextHeroCounters?.[hero];
    if (!Array.isArray(rawItems)) {
      sanitized[hero] = cloneHeroCounters(window.counterData.heroCounters || {})[hero] || [];
      return;
    }

    sanitized[hero] = rawItems
      .map((entry) => typeof entry === "string" ? { item: entry } : { item: entry?.item, weight: entry?.weight })
      .filter((entry) => entry.item)
      .map((entry) => ({
        item: String(entry.item).trim(),
        ...(typeof entry.weight === "number" ? { weight: entry.weight } : {})
      }));
  });

  return sanitized;
}

function exportActiveCheatsheet() {
  const blob = new Blob([JSON.stringify({ heroCounters: activeHeroCounters }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "deadlock-cheatsheet.json";
  link.click();
  URL.revokeObjectURL(url);
  apiStatus.textContent = "Exported current cheatsheet JSON.";
}

function resetSelfHeroStats() {
  apiState.selfHeroStatsHeroName = "";
  apiState.selfHeroStatsByItem = {};
  apiState.selfHeroStatsError = "";
  apiState.lastSelfHeroStatsLoadedAt = 0;
}

function refreshPreferredItemNames() {
  const preferredItemNamesBySlug = {};

  Object.values(activeHeroCounters).forEach((counters) => {
    counters.forEach((entry) => {
      preferredItemNamesBySlug[normalizeSlug(entry.item)] = entry.item;
    });
  });

  Object.keys(window.counterData.publicWeightOverrides || {}).forEach((hero) => {
    Object.keys(window.counterData.publicWeightOverrides[hero] || {}).forEach((itemName) => {
      preferredItemNamesBySlug[normalizeSlug(itemName)] = itemName;
    });
  });

  Object.entries(ITEM_NAME_ALIASES).forEach(([alias, canonicalName]) => {
    preferredItemNamesBySlug[alias] = canonicalName;
  });

  apiState.preferredItemNamesBySlug = preferredItemNamesBySlug;
}

function normalizeApiItemName(itemName) {
  if (!itemName) {
    return "";
  }

  const slug = normalizeSlug(itemName);
  return apiState.preferredItemNamesBySlug[slug] || itemName;
}

function normalizeSlug(value) {
  return String(value || "").replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
