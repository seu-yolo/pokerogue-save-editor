/**
 * This function is intentionally self-contained. Chrome serializes it and runs
 * it in PokéRogue's MAIN world, where the live game objects exist.
 */
export async function pokeroguePageCommand(request) {
  const ADAPTER_VERSION = "1.0.0";
  const SUPPORTED_VERSIONS = ["1.12.0.10", "1.12.0.11"];
  const SCENE_CACHE_KEY = "__ROGUESAVE_SCENE_V1__";
  const PAGE_INSTANCE_KEY = "__ROGUESAVE_PAGE_INSTANCE_V1__";
  const COMMIT_LOCK_KEY = "__ROGUESAVE_COMMIT_LOCK_V1__";
  const TX_RESULTS_KEY = "__ROGUESAVE_TX_RESULTS_V1__";
  const RARE_ENCOUNTER_KEY = "__ROGUESAVE_RARE_ENCOUNTER_V1__";
  const GAME_EXPORTS_KEY = "__ROGUESAVE_GAME_EXPORTS_V1__";
  const ADDABLE_ITEMS = {
    MAP: false, EXP_CHARM: false, SUPER_EXP_CHARM: false, GOLDEN_EXP_CHARM: false,
    SHINY_CHARM: false, ABILITY_CHARM: false, HEALING_CHARM: false, BERRY_POUCH: false,
    CANDY_JAR: false, MEGA_BRACELET: false, DYNAMAX_BAND: false,
    LUCKY_EGG: true, GOLDEN_EGG: true, SOOTHE_BELL: true, SCOPE_LENS: true,
    GRIP_CLAW: true, WIDE_LENS: true, MULTI_LENS: true, FOCUS_BAND: true,
    QUICK_CLAW: true, LEFTOVERS: true, SHELL_BELL: true,
  };
  const MAX_MONEY = Number.MAX_SAFE_INTEGER;
  const MAX_BALL_COUNT = 99;
  const MAX_FRIENDSHIP = 255;
  const MAX_ACCOUNT_EGGS = 99;
  const MAX_LEGENDARY_EGGS_PER_ACTION = 10;
  const LEGENDARY_EGG_TIER = 3;
  const LEGENDARY_EGG_SOURCE_TYPES = Object.freeze({
    move: 0,
    legendary: 1,
    shiny: 2,
  });
  const STATUS_EFFECT_NONE = 0;
  const STATUS_EFFECT_SLEEP = 4;
  const STATUS_EFFECT_FREEZE = 5;
  const STATUS_EFFECT_FAINT = 7;
  const MAX_STATUS_EFFECT = 7;
  const NIGHTMARE_TAG_TYPE = "NIGHTMARE";
  const SLEEP_RESTORE_COUPLED_TAG_TYPES = new Set([
    NIGHTMARE_TAG_TYPE,
    "FLYING",
    "UNDERGROUND",
    "UNDERWATER",
    "HIDDEN",
  ]);
  const SAVED_STATUS_KEYS = new Set([
    "effect",
    "toxicTurnCount",
    "sleepTurnsRemaining",
    "freezeTurnsRemaining",
  ]);
  const MAX_DIAGNOSTIC_FIELDS = 8;
  const MAX_DIAGNOSTIC_DEPTH = 12;
  const MAX_DIAGNOSTIC_NODES = 4_096;
  const DIAGNOSTIC_KEYS_BY_ROLE = Object.freeze({
    account: new Set([
      "trainerId", "secretId", "gender", "dexData", "starterData", "gameStats", "unlocks", "achvUnlocks",
      "voucherUnlocks", "voucherCounts", "eggs", "gameVersion", "eggPity", "unlockPity", "appliedMigrators",
    ]),
    gameStats: new Set([
      "playTime", "battles", "classicSessionsPlayed", "sessionsWon", "ribbonsOwned", "dailyRunSessionsPlayed",
      "dailyRunSessionsWon", "endlessSessionsPlayed", "highestEndlessWave", "highestLevel", "highestMoney",
      "highestDamage", "highestHeal", "pokemonSeen", "pokemonDefeated", "pokemonCaught", "pokemonHatched",
      "subLegendaryPokemonSeen", "subLegendaryPokemonCaught", "subLegendaryPokemonHatched", "legendaryPokemonSeen",
      "legendaryPokemonCaught", "legendaryPokemonHatched", "mythicalPokemonSeen", "mythicalPokemonCaught",
      "mythicalPokemonHatched", "shinyPokemonSeen", "shinyPokemonCaught", "shinyPokemonHatched", "pokemonFused",
      "trainersDefeated", "eggsPulled", "rareEggsPulled", "epicEggsPulled", "legendaryEggsPulled", "manaphyEggsPulled",
    ]),
    dexEntry: new Set(["seenAttr", "caughtAttr", "seenCount", "caughtCount", "natureAttr", "ivs"]),
    starterEntry: new Set(["abilityAttr", "eggMoves", "candyCount", "passiveAttr", "valueReduction", "classicWinCount", "friendship", "moveset"]),
    session: new Set([
      "name", "seed", "gameMode", "dailyConfig", "party", "enemyParty", "modifiers", "enemyModifiers",
      "arena", "pokeballCounts", "money", "score", "waveIndex", "battleType", "trainer", "gameVersion",
      "challenges", "mysteryEncounterType", "mysteryEncounterSaveData", "playerFaints",
    ]),
    pokemon: new Set([
      "id", "player", "species", "nickname", "fusionSpecies", "formIndex", "gender", "shiny", "variant",
      "abilityIndex", "passive", "fusionFormIndex", "fusionGender", "fusionShiny", "fusionVariant",
      "fusionAbilityIndex", "fusionPassive", "nature", "level", "exp", "levelExp", "hp", "stats", "ivs",
      "moveset", "status", "friendship", "metLevel", "metBiome", "metWave", "pokerus", "pokeball",
      "pauseEvolutions", "usedTMs", "summonData", "battleData",
    ]),
    move: new Set(["moveId", "ppUsed", "ppUp"]),
    status: new Set(["effect", "toxicTurnCount", "sleepTurnsRemaining", "freezeTurnsRemaining"]),
    modifier: new Set(["player", "typeId", "typePregenArgs", "args", "stackCount", "className", "pokemonId"]),
    arena: new Set(["biome", "weather", "terrain", "playerTerasUsed", "tags", "positionalTags"]),
    summonData: new Set(["tags", "statStages", "moveset", "types", "ability"]),
    tag: new Set(["tagType", "turnCount", "sourceId", "side"]),
    weather: new Set(["weatherType", "turnsLeft"]),
    terrain: new Set(["terrainType", "turnsLeft"]),
    challenge: new Set(["id", "value"]),
    trainer: new Set(["trainerType", "female", "variant", "partyTemplateIndex", "partyMemberTemplateIndexes"]),
    projectionItem: new Set([
      "type", "value", "key", "party", "id", "ppUsed", "index", "stackCount", "ivs", "stats", "hp", "status",
    ]),
    projectionPokemon: new Set(["id", "hp", "status", "ppUsed"]),
  });
  const BALL_LABELS = {
    "0": "普通球",
    "1": "超级球",
    "2": "高级球",
    "3": "肉鸽球",
    "4": "大师球",
  };

  function errorResult(code, message, extra = {}) {
    return { ok: false, code, message, adapterVersion: ADAPTER_VERSION, ...extra };
  }

  function normalizeVersion(value) {
    return String(value ?? "").trim().replace(/^v/i, "");
  }

  function getPageInstanceId() {
    const existing = window[PAGE_INSTANCE_KEY];
    if (typeof existing === "string" && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const value = crypto.randomUUID();
    try {
      Object.defineProperty(window, PAGE_INSTANCE_KEY, {
        value,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    } catch {
      window[PAGE_INSTANCE_KEY] = value;
    }
    return value;
  }

  function isScene(value) {
    const structurallyValid = Boolean(
      value
      && typeof value === "object"
      && value.gameData
      && typeof value.gameData.getSessionSaveData === "function"
      && typeof value.gameData.getSession === "function"
      && typeof value.getPlayerParty === "function"
      && value.currentBattle
      && Number.isInteger(Number(value.sessionSlotId)),
    );
    if (!structurallyValid) return false;
    try {
      if (typeof value.sys?.isActive === "function" && !value.sys.isActive()) return false;
      if (value.sys?.settings?.status != null && Number(value.sys.settings.status) >= 7) return false;
    } catch {
      return false;
    }
    return true;
  }

  function cacheScene(scene) {
    try {
      Object.defineProperty(window, SCENE_CACHE_KEY, {
        value: scene,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    } catch {
      window[SCENE_CACHE_KEY] = scene;
    }
    return scene;
  }

  async function resolveScene() {
    if (isScene(window[SCENE_CACHE_KEY])) {
      return window[SCENE_CACHE_KEY];
    }
    // Compatibility with a scene handle created manually in DevTools.
    if (isScene(window.__prScene)) {
      return cacheScene(window.__prScene);
    }

    const phaserGames = window.Phaser?.GAMES;
    if (Array.isArray(phaserGames)) {
      for (const game of phaserGames) {
        let scenes = [];
        try {
          scenes = game?.scene?.getScenes?.(true) || game?.scene?.scenes || [];
        } catch {
          scenes = [];
        }
        for (const scene of scenes) {
          if (isScene(scene)) {
            return cacheScene(scene);
          }
        }
      }
    }

    const moduleScripts = Array.from(document.querySelectorAll('script[type="module"][src]'));
    const entryScript = moduleScripts.find(script => {
      try {
        const url = new URL(script.src, location.href);
        return url.origin === location.origin && /\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(url.pathname);
      } catch {
        return false;
      }
    });
    if (!entryScript) {
      throw new Error("找不到当前游戏入口脚本");
    }

    const entryResponse = await fetch(entryScript.src, { cache: "force-cache", credentials: "same-origin" });
    if (!entryResponse.ok) {
      throw new Error(`读取游戏入口脚本失败（HTTP ${entryResponse.status}）`);
    }
    const entrySource = await entryResponse.text();

    // The current production entry statically imports the module that owns
    // globalScene. Importing that exact, already-evaluated same-origin module
    // gives us its live export without starting another Phaser game.
    const sceneModuleMatches = [...entrySource.matchAll(/\.\/FadeOut-[A-Za-z0-9_-]+\.js/g)];
    const sceneModuleUrls = [...new Set(sceneModuleMatches.map(match => new URL(match[0], entryScript.src).href))];
    for (const moduleUrl of sceneModuleUrls) {
      const parsed = new URL(moduleUrl);
      if (parsed.origin !== location.origin || !/\/assets\/FadeOut-[A-Za-z0-9_-]+\.js$/.test(parsed.pathname)) {
        continue;
      }
      try {
        const sceneModule = await import(parsed.href);
        for (const value of Object.values(sceneModule)) {
          if (isScene(value)) {
            return cacheScene(value);
          }
        }
      } catch {
        // Continue to the battle-module compatibility fallback below.
      }
    }

    const battleMatch = entrySource.match(/\.\/battle-scene-[A-Za-z0-9_-]+\.js/);
    if (!battleMatch) {
      throw new Error("当前游戏包结构已变化：找不到战斗模块");
    }

    const battleUrl = new URL(battleMatch[0], entryScript.src);
    const battleResponse = await fetch(battleUrl.href, { cache: "force-cache", credentials: "same-origin" });
    if (!battleResponse.ok) {
      throw new Error(`读取战斗模块失败（HTTP ${battleResponse.status}）`);
    }
    const battleSource = await battleResponse.text();
    const sharedMatch = battleSource.match(/from["']\.\/(loading-scene-[A-Za-z0-9_-]+\.js)["']/);
    if (!sharedMatch) {
      throw new Error("当前游戏包结构已变化：找不到共享模块");
    }

    // Compatibility fallback for builds that re-export the scene through the
    // battle chunk's shared module.
    const sharedUrl = new URL(`./${sharedMatch[1]}`, battleUrl);
    const sharedModule = await import(sharedUrl.href);
    for (const value of Object.values(sharedModule)) {
      if (isScene(value)) {
        return cacheScene(value);
      }
    }
    throw new Error("共享模块中没有发现活动存档场景");
  }

  function toPlain(value) {
    if (value === undefined) {
      return null;
    }
    return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
  }

  async function gameExports(scene) {
    if (window[GAME_EXPORTS_KEY]?.version === getVersion(scene)
      && window[GAME_EXPORTS_KEY]?.adapterVersion === ADAPTER_VERSION) return window[GAME_EXPORTS_KEY];
    if (!SUPPORTED_VERSIONS.includes(getVersion(scene))) throw new Error("当前游戏版本尚未适配");
    // Follow static dependencies of the entry and the already-instantiated
    // BattleScene. New official builds put data tables behind that scene chunk.
    // Never evaluate an unstarted scene or an unrelated dynamic chunk.
    const scripts = Array.from(document.querySelectorAll('script[type="module"][src]'));
    const entry = scripts.map(script => new URL(script.src, location.href))
      .find(url => url.origin === location.origin && /\/assets\/index-[\w-]+\.js$/.test(url.pathname));
    if (!entry) throw new Error("找不到官方游戏数据模块入口");
    const moduleDirectory = new URL("./", entry).pathname;
    const data = { version: getVersion(scene), adapterVersion: ADAPTER_VERSION };
    const queue = [entry.href];
    const visited = new Set();
    while (queue.length && visited.size < 160) {
      const urls = queue.splice(0, 6).filter(url => !visited.has(url));
      urls.forEach(url => visited.add(url));
      await Promise.all(urls.map(async url => {
        const response = await fetch(url, { cache: "force-cache", credentials: "same-origin" });
        if (!response.ok) throw new Error("读取官方游戏数据模块失败");
        const source = await response.text();
        if (url === entry.href && scene.constructor?.name === "BattleScene") {
          // Only the named BattleScene import whose constructor is running.
          // Do not follow arbitrary import() calls, preload links, or URLs.
          const battleImport = source.match(/\{\s*BattleScene\s*:\s*[$\w]+\s*\}\s*=\s*await\s+import\s*\(\s*(["'`])(\.\/battle-scene-[\w-]+\.js)\1\s*\)/);
          if (battleImport) {
            const battleUrl = new URL(battleImport[2], url);
            if (battleUrl.origin === location.origin && battleUrl.pathname.startsWith(moduleDirectory)) queue.push(battleUrl.href);
          }
        }
        for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.\/[A-Za-z0-9_-]+\.js)["']/g)) {
          const dependency = new URL(match[1], url);
          if (dependency.origin === location.origin && dependency.pathname.startsWith(moduleDirectory)
            && !visited.has(dependency.href) && !queue.includes(dependency.href)) queue.push(dependency.href);
        }
        const module = await import(url);
        for (const value of Object.values(module)) {
          if (value && typeof value.getSpecies === "function" && typeof value.getAllStarters === "function") data.registry = value;
          if (Array.isArray(value) && value.length > 100 && value.some(row => row && typeof row.id === "number" && "power" in row)) data.moves = value;
          if (Array.isArray(value) && value.length > 100
            && !value.some(row => row && typeof row === "object" && "power" in row)
            && value.some(row => row && typeof row.id === "number" && typeof row.name === "string" && Array.isArray(row.attrs))) data.abilities = value;
          if (value && typeof value === "object" && !Array.isArray(value)) {
            const entries = Object.entries(value);
            if (entries.length > 100 && entries.every(([key, row]) => /^\d+$/.test(key)
              && Array.isArray(row) && row.length === 4 && row.every(Number.isInteger))) data.eggMoves = value;
          }
          // The official exported ID lookup is a pure table access. Restrict
          // discovery to that shape rather than calling arbitrary exports.
          if (typeof value === "function" && /^function\s*[$\w]*\(\s*[$\w]+\s*\)\s*\{\s*return\s+[$\w]+\[[$\w]+\];?\s*\}$/.test(Function.prototype.toString.call(value))) {
            try {
              const shiny = value("SHINY_CHARM");
              const map = value("MAP");
              if (typeof shiny === "function" && typeof map === "function"
                && typeof shiny().newModifier === "function" && typeof map().newModifier === "function") data.itemLookup = value;
            } catch { /* Not the modifier lookup. */ }
          }
        }
      }));
    }
    if (!data.registry) throw new Error("游戏包中未发现物种注册表；请等待版本适配");
    window[GAME_EXPORTS_KEY] = data;
    return data;
  }

  function systemSnapshot(scene) {
    if (typeof scene.gameData.getSystemSaveData !== "function") throw new Error("游戏缺少账号保存接口");
    const snapshot = toPlain(scene.gameData.getSystemSaveData());
    delete snapshot.timestamp;
    // The official serializer emits small bigint attrs as numbers. Use one
    // representation for comparison without converting counts or identity IDs.
    for (const entry of Object.values(snapshot.dexData || {})) {
      entry.seenAttr = String(entry.seenAttr ?? 0);
      entry.caughtAttr = String(entry.caughtAttr ?? 0);
    }
    return snapshot;
  }

  // Mirror shared/core.js: this function runs standalone in the game's world.
  // The timer continues even at CommandPhase and while saveSystem awaits HTTP.
  // Retain its value in backups/results, but never treat it as a competing edit.
  function accountSnapshotString(snapshot) {
    const comparable = snapshot && typeof snapshot === "object" ? { ...snapshot } : snapshot;
    if (comparable && typeof comparable === "object") {
      delete comparable.timestamp;
      if (comparable.gameStats && typeof comparable.gameStats === "object") {
        comparable.gameStats = { ...comparable.gameStats };
        delete comparable.gameStats.playTime;
      }
    }
    return stableStringify(comparable);
  }

  function requireAccountWritable(scene) {
    if (!SUPPORTED_VERSIONS.includes(getVersion(scene))) throw new Error("当前游戏版本尚未适配");
    requireStablePhase(scene);
    if (!scene.input?.enabled || typeof scene.gameData.saveSystem !== "function") throw new Error("请停在稳定指令界面后重试");
    return systemSnapshot(scene);
  }

  function starterRow(scene, data, id) {
    const species = data.registry.getSpecies(id);
    const dex = scene.gameData.dexData?.[id];
    const starter = scene.gameData.starterData?.[id];
    if (!species || !dex || !starter) throw new Error("该物种没有可编辑的初始宝可梦记录");
    const legal = BigInt(species.getFullUnlocksData());
    const caught = BigInt(dex.caughtAttr || 0);
    const forms = species.forms?.length ? species.forms : [species];
    return {
      id, name: String(species.getName?.() || species.name || id),
      owned: caught !== 0n,
      legendary: Boolean(species.legendary || species.subLegendary || species.mythical),
      shinies: [0, 1, 2].filter(variant => Boolean(legal & (16n << BigInt(variant)))),
      ownedShinies: [0, 1, 2].filter(variant => Boolean(caught & 2n) && Boolean(caught & (16n << BigInt(variant)))),
      forms: forms.map((form, index) => ({ index, name: String(species.getFormNameToDisplay?.(index) || form.formName || "基础形态"),
        available: Boolean(legal & (128n << BigInt(index))) && (index === 0 || form.isStarterSelectable === true),
        owned: Boolean(caught & (128n << BigInt(index))) })).filter(form => form.available),
      natures: Array.from({ length: 25 }, (_, index) => ({ index, owned: Boolean(Number(dex.natureAttr) & (1 << (index + 1))) })),
      eggMoves: (data.eggMoves?.[id] || []).map((moveId, index) => ({ index, moveId,
        name: String(data.moves?.[moveId]?.name || `招式 #${moveId}`), rare: index === 3,
        owned: Boolean(Number(starter.eggMoves) & (1 << index)) })),
      abilities: [species.ability1, species.ability2, species.abilityHidden].map((abilityId, index) => ({
        index, name: String(data.abilities?.[abilityId]?.name || `特性 #${abilityId}`),
        owned: Boolean(Number(starter.abilityAttr) & (1 << index)),
        available: Boolean(abilityId) && (index !== 1 || abilityId !== species.ability1),
      })).filter(ability => ability.available),
    };
  }

  async function collectionCatalog(scene) {
    const data = await gameExports(scene);
    const species = data.registry.getAllStarters().map(id => starterRow(scene, data, Number(id)));
    return { ok: true, species, vouchers: toPlain(scene.gameData.voucherCounts || {}),
      eggMovesAvailable: Boolean(data.eggMoves), version: getVersion(scene) };
  }

  function planAccount(scene, data, operations) {
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 10) throw new Error("账号修改数量无效");
    const before = requireAccountWritable(scene);
    const after = toPlain(before);
    const diffs = [];
    const seen = new Set();
    for (const operation of operations) {
      if (operation.type === "addLegendaryEggs") {
        if (operations.length !== 1) throw new Error("添加蛋不能与其他账号修改混合提交");
        if (!Object.hasOwn(LEGENDARY_EGG_SOURCE_TYPES, operation.source)) throw new Error("扭蛋机来源无效");
        const count = requireInteger(operation.count, 1, 10, "蛋数量");
        if (!accountEggModel(scene).canAddLegendaryEggs || before.eggs.length + count > MAX_ACCOUNT_EGGS) throw new Error("当前不能添加传说蛋，或蛋数量达到上限");
        diffs.push({ label: "随机传说蛋", before: before.eggs.length, after: before.eggs.length + count });
      } else if (operation.type === "setVoucher") {
        const key = String(operation.key);
        if (!/^[0-3]$/.test(key) || !Object.hasOwn(after.voucherCounts || {}, key)) throw new Error("抽奖券类型无效");
        const value = requireInteger(operation.value, 0, 9999, "抽奖券数量");
        if (seen.has(`voucher:${key}`)) throw new Error("重复的抽奖券修改");
        seen.add(`voucher:${key}`);
        if (after.voucherCounts[key] !== value) diffs.push({ label: ["普通券", "高级券", "豪华券", "金券"][Number(key)], before: after.voucherCounts[key], after: value });
        after.voucherCounts[key] = value;
      } else if (operation.type === "unlockStarter") {
        const id = requireInteger(operation.speciesId, 1, 10000, "物种编号");
        if (!data.registry.getAllStarters().includes(id)) throw new Error("只能选择当前版本合法的初始宝可梦");
        if (seen.has(`starter:${id}`)) throw new Error("重复的宝可梦修改");
        seen.add(`starter:${id}`);
        const row = starterRow(scene, data, id);
        const dex = after.dexData[id];
        const starter = after.starterData[id];
        const species = data.registry.getSpecies(id);
        const formIndex = requireInteger(operation.formIndex ?? 0, 0, 63, "形态");
        if (!row.forms.some(form => form.index === formIndex)) throw new Error("该形态不能作为初始宝可梦选择");
        const shiny = String(operation.shiny ?? "keep");
        if (!["keep", "normal", "0", "1", "2"].includes(shiny)) throw new Error("闪光选项无效");
        if (/^[0-2]$/.test(shiny) && !row.shinies.includes(Number(shiny))) throw new Error("该宝可梦没有对应闪光变体");
        const legal = BigInt(species.getFullUnlocksData());
        let attr = BigInt(dex.caughtAttr || 0);
        const initial = attr === 0n;
        if (initial || shiny !== "keep") {
          attr |= 128n << BigInt(formIndex);
          attr |= legal & 4n ? 4n : legal & 8n ? 8n : 0n;
          if (shiny === "keep" || shiny === "normal") attr |= 1n | 16n;
          else attr |= 2n | (16n << BigInt(Number(shiny)));
        } else attr |= 128n << BigInt(formIndex);
        if (attr.toString() !== dex.caughtAttr) diffs.push({ label: `${row.name} · 外观解锁`, before: row.owned ? "已有收藏保留" : "未拥有", after: shiny === "keep" ? "基础解锁／补充形态" : ({ normal: "普通", 0: "黄闪", 1: "蓝闪", 2: "红闪" })[shiny] });
        dex.caughtAttr = attr.toString();
        dex.seenAttr = (BigInt(dex.seenAttr || 0) | attr).toString();
        // A real starter record needs one count and valid default nature/ability.
        // Do not manufacture global statistics, wins, candy or achievements.
        dex.caughtCount = Math.max(Number(dex.caughtCount || 0), 1);
        dex.seenCount = Math.max(Number(dex.seenCount || 0), 1);
        if (!Number(dex.natureAttr) && !operation.natures?.length) dex.natureAttr = 1 << 1;
        if (!Number(starter.abilityAttr) && !operation.abilities?.length) starter.abilityAttr = 1;
        for (const [field, max] of [["natures", 24], ["eggMoves", 3], ["abilities", 2]]) {
          const values = operation[field] ?? [];
          if (!Array.isArray(values) || values.length > max + 1 || new Set(values).size !== values.length) throw new Error(`${field} 选择无效`);
          for (const index of values) {
            requireInteger(index, 0, max, field);
            if (field === "eggMoves" && !row.eggMoves.some(move => move.index === index)) throw new Error("该蛋招式在当前版本不存在");
            if (field === "abilities" && !row.abilities.some(ability => ability.index === index)) throw new Error("该特性在当前版本不存在");
            const target = field === "natures" ? dex : starter;
            const key = field === "natures" ? "natureAttr" : field === "abilities" ? "abilityAttr" : "eggMoves";
            const bit = 1 << (index + (field === "natures" ? 1 : 0));
            if (!(Number(target[key]) & bit)) diffs.push({ label: `${row.name} · ${field === "natures" ? "性格" : field === "abilities" ? "特性" : "蛋招式"}`, before: "未解锁", after: field === "natures" ? `性格 #${index + 1}` : (field === "abilities" ? row.abilities : row.eggMoves).find(value => value.index === index).name });
            target[key] = Number(target[key] || 0) | bit;
          }
        }
      } else throw new Error("不支持的账号修改类型");
    }
    return { before, after, diffs };
  }

  function applyAccountSnapshot(scene, snapshot) {
    const gameData = scene.gameData;
    for (const [id, saved] of Object.entries(snapshot.dexData || {})) {
      if (!gameData.dexData[id]) throw new Error("账号图鉴结构已变化");
      Object.assign(gameData.dexData[id], toPlain(saved), { seenAttr: BigInt(saved.seenAttr), caughtAttr: BigInt(saved.caughtAttr) });
    }
    for (const [id, saved] of Object.entries(snapshot.starterData || {})) Object.assign(gameData.starterData[id], toPlain(saved));
    Object.assign(gameData.voucherCounts, snapshot.voucherCounts);
  }

  function captureSystemCache() {
    const entries = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("data_")) entries.push([key, localStorage.getItem(key)]);
    }
    return entries;
  }

  function restoreSystemCache(before) {
    const originals = new Map(before);
    for (const [key] of captureSystemCache()) if (!originals.has(key)) localStorage.removeItem(key);
    for (const [key, value] of before) localStorage.setItem(key, value);
    if (stableStringify(captureSystemCache().sort()) !== stableStringify(before.slice().sort())) throw new Error("账号缓存恢复失败");
  }

  async function accountPreview(scene, payload) {
    const data = payload.operations?.every(operation => ["setVoucher", "addLegendaryEggs"].includes(operation.type)) ? {} : await gameExports(scene);
    const plan = planAccount(scene, data, payload.operations);
    // Carry the authoritative snapshot as JSON text across Chrome's MAIN-world
    // argument/result boundary. Keep the object for older local clients/tests.
    return { ok: true, expectedSystem: plan.before, expectedSystemJson: JSON.stringify(plan.before),
      diffs: plan.diffs, operations: payload.operations };
  }

  async function commitAccount(scene, payload) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(String(payload.txId))) return errorResult("INVALID_TX", "事务编号无效");
    if (window[COMMIT_LOCK_KEY]) return errorResult("BUSY", "另一个保存任务正在进行");
    const data = payload.operations?.every(operation => ["setVoucher", "addLegendaryEggs"].includes(operation.type)) ? {} : await gameExports(scene);
    const plan = planAccount(scene, data, payload.operations);
    const expectedSystem = typeof payload.expectedSystemJson === "string" ? JSON.parse(payload.expectedSystemJson) : payload.expectedSystem;
    if (accountSnapshotString(plan.before) !== accountSnapshotString(expectedSystem)) {
      const error = whitelistMismatchError("账号数据已变化，请重新预览",
        JSON.parse(accountSnapshotString(expectedSystem)), JSON.parse(accountSnapshotString(plan.before)), "account-cas");
      return errorResult("STALE", error.message, diagnosticExtra(error));
    }
    if (!plan.diffs.length) return errorResult("NO_CHANGES", "所选内容已经拥有，无需修改");
    if (payload.operations[0].type === "addLegendaryEggs") return await addLegendaryEggs(scene, {
      txId: payload.txId, source: payload.operations[0].source, count: payload.operations[0].count,
    });
    const cache = captureSystemCache();
    const guard = captureTransactionGuard(scene);
    const originalGameData = scene.gameData;
    window[COMMIT_LOCK_KEY] = true;
    const releaseInput = lockGameInput(scene);
    let attemptedSave = false;
    try {
      applyAccountSnapshot(scene, plan.after);
      if (accountSnapshotString(systemSnapshot(scene)) !== accountSnapshotString(plan.after)) throw new Error("账号实际修改与预览不一致");
      attemptedSave = true;
      const saved = await scene.gameData.saveSystem();
      if (saved !== true) throw new Error("游戏未确认账号保存成功");
      const afterSystem = systemSnapshot(scene);
      if (scene.gameData !== originalGameData || !transactionGuardMatches(scene, guard) || accountSnapshotString(afterSystem) !== accountSnapshotString(plan.after)) throw new Error("保存期间游戏或账号状态发生变化");
      return { ok: true, code: "VERIFIED", status: "verified", adapterVersion: ADAPTER_VERSION,
        message: "账号修改已保存；永久解锁可在下一次初始选择时使用", afterSystem, afterSystemJson: JSON.stringify(afterSystem) };
    } catch (error) {
      try {
        if (scene.gameData !== originalGameData) throw new Error("账号已重新初始化，不能覆盖新状态");
        applyAccountSnapshot(scene, plan.before); restoreSystemCache(cache);
      }
      catch { return errorResult("UNCERTAIN", "账号保存与恢复未能确认，请导出备份并重新载入游戏", { status: "uncertain" }); }
      return errorResult(attemptedSave ? "UNCERTAIN" : "ACCOUNT_FAILED", attemptedSave
        ? `${error.message}；本地状态已恢复，但服务器结果待确认，请重新载入游戏后核对`
        : `${error.message}；修改已撤销`, { status: attemptedSave ? "uncertain" : "failed" });
    } finally { releaseInput(); window[COMMIT_LOCK_KEY] = false; }
  }

  function makeItem(scene, data, itemId, pokemonId) {
    if (!Object.hasOwn(ADDABLE_ITEMS, itemId) || typeof data.itemLookup !== "function") throw new Error("该道具尚未支持添加");
    const factory = data.itemLookup(itemId);
    if (typeof factory !== "function") throw new Error("当前游戏不存在该道具");
    const type = factory();
    type.id = itemId;
    const modifier = ADDABLE_ITEMS[itemId] ? type.newModifier(findPokemon(scene, pokemonId)) : type.newModifier();
    if (!modifier || typeof modifier.getArgs !== "function" || typeof modifier.getMaxStackCount !== "function") throw new Error("该道具不是可保存的永久道具");
    if (Number(modifier.virtualStackCount || 0) !== 0) throw new Error("该道具存在临时层数");
    return modifier;
  }

  function serializedItem(modifier, count) {
    return toPlain({ player: true, typeId: modifier.type.id, args: modifier.getArgs(),
      stackCount: count, className: modifier.constructor.name });
  }

  async function itemCatalog(scene) {
    const data = await gameExports(scene);
    const savedModifiers = scene.gameData.getSessionSaveData().modifiers || [];
    const items = [];
    for (const [id, held] of Object.entries(ADDABLE_ITEMS)) {
      try {
        const modifier = makeItem(scene, data, id, held ? getParty(scene)[0].id : null);
        const limits = (held ? getParty(scene).map(pokemon => pokemon.id) : [null]).map(pokemonId => {
          const item = held ? makeItem(scene, data, id, pokemonId) : modifier;
          const limit = itemLimit(scene, item);
          return { pokemonId, currentStackCount: limit.current, maxStackCount: limit.maxStackCount,
            virtualStackCount: limit.virtualStackCount, remaining: limit.remaining,
            modifierFingerprint: limit.index >= 0 ? modifierFingerprint(savedModifiers[limit.index], limit.index) : null };
        });
        items.push({ id, held, name: String(modifier.type.name || id), description: String(modifier.type.getDescription?.() || ""), limits });
      } catch { /* Unsupported factories do not become selectable. */ }
    }
    return { ok: true, items };
  }

  function itemLimit(scene, item) {
    const index = getRuntimeModifiers(scene).findIndex(modifier => item.match?.(modifier));
    const existing = index < 0 ? null : getRuntimeModifiers(scene)[index];
    const maxStackCount = requireInteger(Number((existing || item).getMaxStackCount()), 1, Number.MAX_SAFE_INTEGER, "道具上限");
    const current = requireInteger(Number(existing?.stackCount || 0), 0, maxStackCount, "当前道具层数");
    const virtualStackCount = requireInteger(Number(existing?.virtualStackCount || 0), 0, maxStackCount - current, "临时道具层数");
    return { index, current, maxStackCount, virtualStackCount, remaining: maxStackCount - current - virtualStackCount };
  }

  function itemPlan(scene, operation, undoing = false, plannedStacks = null) {
    const data = window[GAME_EXPORTS_KEY];
    if (!data || data.version !== getVersion(scene)) throw new Error("请先加载可添加道具列表");
    const item = makeItem(scene, data, String(operation.itemId), operation.pokemonId);
    const count = requireInteger(operation.count, 1, Number.MAX_SAFE_INTEGER, "添加道具数量");
    const limit = itemLimit(scene, item);
    const { index } = limit;
    const current = plannedStacks?.get(index) ?? limit.current;
    const max = limit.maxStackCount - limit.virtualStackCount;
    if (!undoing) requireInteger(current + count, 1, max, "添加后的道具层数");
    return { item, index, count, total: current + count };
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(typeof value === "bigint" ? value.toString() : value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  function valueType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  function diagnosticChild(role, key, path) {
    const value = String(key);
    if (role === "dexData" || role === "starterData") {
      return { path: `${path}.field`, role: role === "dexData" ? "dexEntry" : "starterEntry" };
    }
    if (role === "pokeballCounts" && Object.hasOwn(BALL_LABELS, value)) {
      return { path: `${path}[${value}]`, role: "opaque" };
    }
    if (!DIAGNOSTIC_KEYS_BY_ROLE[role]?.has(value)) {
      return { path: `${path}.field`, role: "opaque" };
    }
    const nextRole = role === "projectionItem" && value === "party"
      ? "projectionPartyArray"
      : ({
      party: "partyArray",
      enemyParty: "partyArray",
      modifiers: "modifierArray",
      enemyModifiers: "modifierArray",
      moveset: role === "summonData" ? "opaque" : "moveArray",
      status: "status",
      arena: "arena",
      pokeballCounts: "pokeballCounts",
      trainer: "trainer",
      challenges: "challengeArray",
      summonData: "summonData",
      tags: "tagArray",
      positionalTags: "tagArray",
      weather: "weather",
      terrain: "terrain",
      partyMemberTemplateIndexes: "opaque",
      dexData: "dexData",
      starterData: "starterData",
      gameStats: "gameStats",
    })[value] || "opaque";
    return { path: `${path}.${value}`, role: nextRole };
  }

  function diagnosticArrayElementRole(role) {
    return ({
      partyArray: "pokemon",
      modifierArray: "modifier",
      moveArray: "move",
      tagArray: "tag",
      challengeArray: "challenge",
      projectionList: "projectionItem",
      projectionPartyArray: "projectionPokemon",
    })[role] || "opaque";
  }

  function buildDifferenceDiagnostics(expected, actual, stage) {
    const fields = [];
    let mismatchCount = 0;
    let truncated = false;
    let visited = 0;

    const exhausted = () => {
      if (visited < MAX_DIAGNOSTIC_NODES) return false;
      truncated = true;
      return true;
    };

    const record = (path, kind) => {
      if (exhausted()) return false;
      visited += 1;
      mismatchCount += 1;
      if (fields.length < MAX_DIAGNOSTIC_FIELDS) {
        fields.push({ path: String(path || "session").slice(0, 160), kind });
      } else {
        truncated = true;
      }
      return true;
    };

    const visit = (left, right, path, depth, role) => {
      if (exhausted()) return;
      visited += 1;
      if (depth > MAX_DIAGNOSTIC_DEPTH) {
        truncated = true;
        return;
      }
      if (Object.is(left, right)) return;
      // Account collections are large. Skip identical subtrees so the existing
      // bounded diagnostic budget reaches the actual difference, without values.
      if (stage === "account-cas" && stableStringify(left) === stableStringify(right)) return;

      const leftType = valueType(left);
      const rightType = valueType(right);
      if (leftType !== rightType) {
        record(path, "type");
        return;
      }
      if (leftType === "array") {
        if (left.length !== right.length) record(`${path}.length`, "array-length");
        const sharedLength = Math.min(left.length, right.length);
        for (let index = 0; index < sharedLength; index += 1) {
          if (exhausted()) break;
          visit(
            left[index],
            right[index],
            `${path}[${index}]`,
            depth + 1,
            diagnosticArrayElementRole(role),
          );
        }
        for (let index = sharedLength; index < left.length; index += 1) {
          if (!record(`${path}[${index}]`, "missing")) break;
        }
        for (let index = sharedLength; index < right.length; index += 1) {
          if (!record(`${path}[${index}]`, "unexpected")) break;
        }
        return;
      }
      if (leftType === "object") {
        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);
        const rightSet = new Set(rightKeys);
        const leftSet = new Set(leftKeys);
        for (const key of leftKeys.sort()) {
          if (exhausted()) break;
          const child = diagnosticChild(role, key, path);
          if (!rightSet.has(key)) {
            if (!record(child.path, "missing")) break;
          }
          else visit(left[key], right[key], child.path, depth + 1, child.role);
        }
        for (const key of rightKeys.sort()) {
          if (exhausted()) break;
          if (!leftSet.has(key) && !record(diagnosticChild(role, key, path).path, "unexpected")) break;
        }
        return;
      }
      record(path, "value");
    };

    visit(expected, actual, stage === "account-cas" ? "account" : "session", 0,
      stage === "account-cas" ? "account" : Array.isArray(expected) && Array.isArray(actual) ? "projectionList" : "session");
    if (truncated && mismatchCount === fields.length) mismatchCount += 1;
    return { stage, mismatchCount, truncated, fields };
  }

  function whitelistMismatchError(message, expected, actual, stage) {
    const diagnostics = buildDifferenceDiagnostics(expected, actual, stage);
    const shown = diagnostics.fields.slice(0, 3).map(field => field.path).join("、");
    const suffix = shown ? `（差异字段：${shown}${diagnostics.truncated ? " 等" : ""}）` : "";
    const error = new Error(`${message}${suffix}`);
    error.diagnostics = diagnostics;
    return error;
  }

  function diagnosticExtra(error, extra = {}) {
    return error?.diagnostics ? { ...extra, diagnostics: error.diagnostics } : extra;
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(stableStringify(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function canonicalFullSession(session) {
    const copy = toPlain(session);
    if (!copy || typeof copy !== "object") throw new Error("存档快照结构无效");
    delete copy.timestamp;
    delete copy.playTime;
    copy.name = String(copy.name ?? "");
    return copy;
  }

  async function fullSessionHash(session) {
    return await sha256(canonicalFullSession(session));
  }

  function canonicalFullString(session) {
    return stableStringify(canonicalFullSession(session));
  }

  function captureLiveSession(scene, runName) {
    const session = toPlain(scene.gameData.getSessionSaveData());
    session.name = String(runName ?? session.name ?? "");
    return session;
  }

  function requireExactLiveSession(scene, expectedSession, runName, stage, message) {
    const actual = captureLiveSession(scene, runName);
    const expectedCanonical = canonicalFullSession(expectedSession);
    const actualCanonical = canonicalFullSession(actual);
    if (stableStringify(expectedCanonical) !== stableStringify(actualCanonical)) {
      throw whitelistMismatchError(message, expectedCanonical, actualCanonical, stage);
    }
    return actual;
  }

  function getPhaseState(scene) {
    let phase = null;
    try {
      phase = scene.phaseManager?.getCurrentPhase?.() || null;
    } catch {
      phase = null;
    }
    let phaseName = String(phase?.phaseName || phase?.constructor?.name || "未知阶段");
    let stable = false;
    try {
      stable = phase?.is?.("CommandPhase") === true;
    } catch {
      stable = false;
    }
    return { phase, phaseName, stable };
  }

  function requireStablePhase(scene) {
    const phaseState = getPhaseState(scene);
    if (!phaseState.stable) {
      throw new Error(`当前处于“${phaseState.phaseName}”，请回到可选择招式的指令阶段再修改`);
    }
    return phaseState;
  }

  function captureTransactionGuard(scene) {
    const phaseState = requireStablePhase(scene);
    return {
      phase: phaseState.phase,
      phaseName: phaseState.phaseName,
      input: scene.input,
      slotId: Number(scene.sessionSlotId),
      seed: String(scene.seed ?? ""),
      waveIndex: Number(scene.currentBattle?.waveIndex),
      turn: Number(scene.currentBattle?.turn ?? 0),
    };
  }

  function transactionGuardMatches(scene, guard, expectedInputEnabled = false) {
    if (!guard || scene.input !== guard.input || scene.input?.enabled !== expectedInputEnabled) return false;
    const phaseState = getPhaseState(scene);
    return phaseState.stable
      && phaseState.phase === guard.phase
      && phaseState.phaseName === guard.phaseName
      && Number(scene.sessionSlotId) === guard.slotId
      && String(scene.seed ?? "") === guard.seed
      && Number(scene.currentBattle?.waveIndex) === guard.waveIndex
      && Number(scene.currentBattle?.turn ?? 0) === guard.turn;
  }

  function lockGameInput(scene) {
    const input = scene.input;
    if (!input || typeof input.enabled !== "boolean") {
      throw new Error("当前版本无法安全锁定游戏输入");
    }
    const previous = input.enabled;
    if (!previous) throw new Error("游戏输入当前未启用，请等待指令界面稳定后重试");
    input.enabled = false;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      input.enabled = previous;
    };
  }

  function requireInteger(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${label}必须是 ${min}–${max} 之间的整数`);
    }
    return value;
  }

  function getVersion(scene) {
    return normalizeVersion(scene.game?.config?.gameVersion || scene.game?.config?.version || "");
  }

  function findEggGachaHandler(scene) {
    const root = scene?.ui;
    if (!root) return null;
    const queue = [{ value: root, depth: 0 }];
    const seen = new Set();
    let visited = 0;
    while (queue.length > 0 && visited < 1_500) {
      const { value, depth } = queue.shift();
      if (!value || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      if (typeof value.pullEggs === "function"
        && typeof value.getGuaranteedEggTierFromPullCount === "function") {
        return value;
      }
      if (depth >= 5) continue;
      let descriptors;
      try {
        descriptors = Object.getOwnPropertyDescriptors(value);
      } catch {
        continue;
      }
      for (const descriptor of Object.values(descriptors)) {
        if (!Object.hasOwn(descriptor, "value")) continue;
        const child = descriptor.value;
        if (child && (typeof child === "object" || typeof child === "function")) {
          queue.push({ value: child, depth: depth + 1 });
        }
      }
    }
    return null;
  }

  function restoreArray(target, values) {
    if (!Array.isArray(target) || !Array.isArray(values)) return;
    target.splice(0, target.length, ...values);
  }

  function accountEggModel(scene) {
    const gameData = scene?.gameData;
    const eggs = Array.isArray(gameData?.eggs) ? gameData.eggs : null;
    const handler = findEggGachaHandler(scene);
    const supported = SUPPORTED_VERSIONS.includes(getVersion(scene));
    return {
      voucherCounts: toPlain(gameData?.voucherCounts || {}),
      canEditCollection: supported && typeof gameData?.getSystemSaveData === "function",
      eggCount: eggs?.length ?? 0,
      maxEggs: MAX_ACCOUNT_EGGS,
      canAddLegendaryEggs: Boolean(
        supported
        && eggs
        && handler
        && typeof gameData?.saveSystem === "function"
      ),
      readOnlyReason: supported
        ? eggs && handler && typeof gameData?.saveSystem === "function"
          ? ""
          : "当前游戏包没有暴露可验证的官方抽蛋或系统保存接口"
        : `游戏版本 ${getVersion(scene) || "未知"} 尚未验证`,
    };
  }

  function getParty(scene) {
    const party = scene.getPlayerParty();
    if (!Array.isArray(party) || party.length === 0 || party.length > 6) {
      throw new Error("当前玩家队伍结构无效");
    }
    const ids = new Set();
    for (const [memberIndex, pokemon] of party.entries()) {
      if (!Number.isSafeInteger(pokemon?.id) || ids.has(pokemon.id)) {
        throw new Error("队伍中存在无效或重复的宝可梦 ID");
      }
      ids.add(pokemon.id);
    }
    return party;
  }

  function getPokemonName(pokemon, index) {
    let name = "";
    try {
      name = pokemon.getNameToRender?.() || pokemon.getName?.() || pokemon.nickname || pokemon.species?.name || "";
    } catch {
      name = pokemon.nickname || pokemon.species?.name || "";
    }
    name = String(name).replace(/\[[^\]]*\]/g, "").trim();
    return name || `队员 ${index + 1}`;
  }

  function getMoves(pokemon) {
    const moves = pokemon.getMoveset?.() || pokemon.moveset || [];
    return Array.isArray(moves) ? moves : [];
  }

  function modifierFingerprint(saved, index) {
    return stableStringify({
      index,
      player: saved?.player !== false,
      typeId: saved?.typeId ?? null,
      className: saved?.className ?? null,
      args: toPlain(saved?.args ?? []),
      typePregenArgs: toPlain(saved?.typePregenArgs ?? []),
    });
  }

  function getRuntimeModifiers(scene) {
    let modifiers = [];
    try {
      modifiers = scene.findModifiers?.(() => true) || scene.modifiers || [];
    } catch {
      modifiers = scene.modifiers || [];
    }
    return Array.isArray(modifiers) ? modifiers : [];
  }

  function getModifierRows(scene, liveSession, partyRows) {
    const runtimeModifiers = getRuntimeModifiers(scene);
    const savedModifiers = Array.isArray(liveSession.modifiers) ? liveSession.modifiers : [];
    const structureMatches = runtimeModifiers.length === savedModifiers.length;
    const partyNameById = new Map(partyRows.map(pokemon => [pokemon.id, pokemon.name]));

    return savedModifiers.map((saved, index) => {
      const runtime = runtimeModifiers[index];
      let runtimeMax = Number(saved?.stackCount ?? 1);
      let virtualStackCount = 0;
      try {
        runtimeMax = Number(runtime?.getMaxStackCount?.() ?? runtimeMax);
        virtualStackCount = Number(runtime?.virtualStackCount ?? 0);
      } catch {
        runtimeMax = Number(saved?.stackCount ?? 1);
      }
      const maxStackCount = Math.floor(runtimeMax - Math.max(0, virtualStackCount));
      const stackCount = Number(saved?.stackCount ?? runtime?.stackCount ?? 1);
      const className = String(saved?.className || runtime?.constructor?.name || "未知道具");
      const runtimeClassName = String(runtime?.constructor?.name || "");
      const runtimeTypeId = runtime?.type?.id ?? runtime?.typeId ?? null;
      const savedTypeId = saved?.typeId ?? null;
      const savedOwnerId = Number(saved?.args?.[0]);
      const runtimeOwnerId = Number(runtime?.pokemonId);
      const ownerIdentityMatches = Number.isSafeInteger(runtimeOwnerId)
        ? Number.isSafeInteger(savedOwnerId) && savedOwnerId === runtimeOwnerId
        : true;
      const identityMatches = Boolean(
        structureMatches
        && runtime
        && runtimeClassName === className
        && runtimeTypeId != null
        && String(runtimeTypeId) === String(savedTypeId)
        && Number(runtime.stackCount) === stackCount
        && ownerIdentityMatches,
      );
      const protectedClass = /Lapsing|EvoTracker|FormChange|Terastall|Fuse|Splice/i.test(className);
      const editable = Boolean(
        identityMatches
        && saved?.player !== false
        && !protectedClass
        && Number.isSafeInteger(stackCount)
        && Number.isSafeInteger(maxStackCount)
        && stackCount >= 1
        && maxStackCount >= stackCount,
      );

      let name = String(saved?.typeId || className);
      try {
        const candidate = runtime?.type?.name || runtime?.type?.getName?.() || runtime?.getName?.();
        if (candidate) {
          name = String(candidate).replace(/\[[^\]]*\]/g, "").trim();
        }
      } catch {
        // Keep the stable type id as the display name.
      }
      const ownerId = savedOwnerId;
      const ownerName = Number.isSafeInteger(ownerId) ? partyNameById.get(ownerId) || null : null;

      return {
        fingerprint: modifierFingerprint(saved, index),
        index,
        name,
        typeId: saved?.typeId ?? null,
        className,
        stackCount,
        maxStackCount: Math.max(1, maxStackCount || stackCount),
        ownerId: Number.isSafeInteger(ownerId) ? ownerId : null,
        ownerName,
        editable,
        readOnlyReason: editable
          ? null
          : protectedClass
            ? "形态、融合或临时道具受保护"
            : !structureMatches
              ? "运行时与序列化道具数量不一致"
              : !identityMatches
                ? "无法证明运行时道具与存档条目一一对应"
              : "无法确认实时最大层数",
      };
    });
  }

  function getPartyRows(scene) {
    return getParty(scene).map((pokemon, index) => {
      const moves = getMoves(pokemon);
      const maxHp = Number(pokemon.getMaxHp?.() ?? pokemon.stats?.[0] ?? pokemon.hp ?? 0);
      return {
        id: pokemon.id,
        name: getPokemonName(pokemon, index),
        speciesId: Number(pokemon.species?.speciesId ?? pokemon.species?.id ?? -1),
        level: Number(pokemon.level ?? 0),
        hp: Number(pokemon.hp ?? 0),
        maxHp,
        status: toPlain(pokemon.status ?? null),
        ppUsed: moves.map(move => Number(move?.ppUsed ?? 0)),
        moves: moves.map((move, moveIndex) => ({
          index: moveIndex,
          moveId: Number(move?.moveId ?? -1),
          ppUsed: Number(move?.ppUsed ?? 0),
          ppUp: Number(move?.ppUp ?? 0),
        })),
        friendship: Number(pokemon.friendship ?? 0),
        pokerus: Boolean(pokemon.pokerus),
        pauseEvolutions: Boolean(pokemon.pauseEvolutions),
        ivs: Array.isArray(pokemon.ivs) ? pokemon.ivs.map(Number) : [],
      };
    });
  }

  function getModeName(scene) {
    const mode = scene.gameMode || {};
    if (mode.isClassic) return "经典模式";
    if (mode.isEndless) return mode.isSplicedOnly ? "融合无尽模式" : "无尽模式";
    if (mode.isDaily) return "每日模式";
    if (mode.isChallenge) return "挑战模式";
    return `模式 ${mode.modeId ?? "未知"}`;
  }

  function restoreRareEncounterHook(state) {
    if (!state || typeof state !== "object") return;
    try {
      if (state.scene?.randomSpecies === state.wrapper && typeof state.original === "function") {
        state.scene.randomSpecies = state.original;
      }
    } catch {
      // A page reload or game update can replace the scene; the old hook then
      // becomes unreachable and needs no further cleanup.
    }
    state.armed = false;
  }

  function rareEncounterModel(scene) {
    const state = window[RARE_ENCOUNTER_KEY];
    const hookActive = Boolean(
      state
      && state.armed === true
      && state.scene === scene
      && scene.randomSpecies === state.wrapper,
    );
    if (state?.armed && !hookActive) restoreRareEncounterHook(state);
    const supported = Boolean(SUPPORTED_VERSIONS.includes(getVersion(scene))
      && typeof scene.randomSpecies === "function"
      && scene.arena
      && typeof scene.arena.updatePoolsForTimeOfDay === "function");
    return {
      supported,
      armed: hookActive,
      armedAtWave: hookActive ? Number(state.armedAtWave) : null,
      message: hookActive
        ? "正在等待下一次野生遭遇；训练家层不会消耗，刷新游戏页会取消"
        : supported
          ? "未启用；会在生成时读取实际地形，并只影响第一只野生宝可梦"
          : "当前游戏版本或遭遇生成接口尚未验证",
    };
  }

  function isTierPool(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    for (let tier = 0; tier <= 8; tier += 1) {
      if (!Array.isArray(value[tier])) return false;
    }
    return true;
  }

  function forceRarestArenaPools(arena) {
    try {
      arena.updatePoolsForTimeOfDay();
    } catch {
      return null;
    }
    let candidates = [];
    try {
      const entries = [];
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(arena))) {
        if (Object.hasOwn(descriptor, "value") && isTierPool(descriptor.value)) {
          entries.push({ key, pool: descriptor.value });
        }
      }
      const direct = entries.find(entry => entry.key === "pokemonPool" || entry.pool === arena.pokemonPool);
      if (direct) {
        candidates = [direct.pool];
      } else {
        const source = Function.prototype.toString.call(arena.randomSpecies);
        const referenced = entries.filter(entry => {
          const escapedKey = entry.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`\\bthis\\.${escapedKey}(?![$\\w])`).test(source);
        });
        // Production minifies the private field name. Its public method still
        // references that own property, letting us avoid touching trainerPool.
        candidates = (referenced.length === 1 ? referenced : entries).map(entry => entry.pool);
      }
    } catch {
      return null;
    }

    const restorers = [];
    for (const pool of candidates) {
      const normalTier = [4, 3, 2].find(tier => pool[tier].length > 0);
      const bossTier = [8, 7, 6, 5].find(tier => pool[tier].length > 0);
      if (normalTier == null && bossTier == null) continue;
      const snapshot = Array.from({ length: 9 }, (_unused, tier) => pool[tier]);
      try {
        if (normalTier != null) {
          for (let tier = 0; tier <= 4; tier += 1) pool[tier] = snapshot[normalTier];
        }
        if (bossTier != null) {
          for (let tier = 5; tier <= 8; tier += 1) pool[tier] = snapshot[bossTier];
        }
        restorers.push(() => {
          for (let tier = 0; tier <= 8; tier += 1) pool[tier] = snapshot[tier];
        });
      } catch {
        try {
          for (let tier = 0; tier <= 8; tier += 1) pool[tier] = snapshot[tier];
        } catch {
          // Ignore immutable non-Pokémon pool lookalikes.
        }
      }
    }
    if (restorers.length === 0) return null;
    return () => {
      for (const restore of restorers.reverse()) {
        try { restore(); } catch { /* The page reload will rebuild all pools. */ }
      }
    };
  }

  function armRareEncounter(scene) {
    const existing = window[RARE_ENCOUNTER_KEY];
    if (existing?.armed && existing.scene === scene && scene.randomSpecies === existing.wrapper) {
      return { ok: true, code: "ALREADY_ARMED", rareEncounter: rareEncounterModel(scene) };
    }
    if (existing) restoreRareEncounterHook(existing);
    if (!SUPPORTED_VERSIONS.includes(getVersion(scene))) {
      return errorResult("UNSUPPORTED_VERSION", "当前游戏版本尚未验证，不能启用稀有遭遇");
    }
    requireStablePhase(scene);
    if (typeof scene.randomSpecies !== "function"
      || !scene.arena
      || typeof scene.arena.updatePoolsForTimeOfDay !== "function") {
      return errorResult("ENCOUNTER_UNAVAILABLE", "当前版本没有可验证的地形遭遇生成接口");
    }

    const state = {
      armed: true,
      inHook: false,
      scene,
      original: scene.randomSpecies,
      wrapper: null,
      armedAtWave: Number(scene.currentBattle?.waveIndex),
      seed: String(scene.seed ?? ""),
      slotId: Number(scene.sessionSlotId),
    };
    state.wrapper = function rareEncounterRandomSpecies(waveIndex, level, fromArenaPool, ...rest) {
      if (!state.armed || state.inHook) {
        return state.original.call(this, waveIndex, level, fromArenaPool, ...rest);
      }
      const battle = scene.currentBattle;
      const isNextWildEncounter = fromArenaPool === true
        && Number(battle?.battleType) === 0
        && Number(battle?.waveIndex) === Number(waveIndex)
        && Number(waveIndex) > state.armedAtWave
        && String(scene.seed ?? "") === state.seed
        && Number(scene.sessionSlotId) === state.slotId;
      if (!isNextWildEncounter) {
        return state.original.call(this, waveIndex, level, fromArenaPool, ...rest);
      }

      state.inHook = true;
      const restorePools = forceRarestArenaPools(scene.arena);
      if (!restorePools) {
        state.inHook = false;
        return state.original.call(this, waveIndex, level, fromArenaPool, ...rest);
      }
      let generated = false;
      try {
        const result = state.original.call(this, waveIndex, level, fromArenaPool, ...rest);
        generated = true;
        return result;
      } finally {
        restorePools();
        state.inHook = false;
        if (generated) restoreRareEncounterHook(state);
      }
    };
    scene.randomSpecies = state.wrapper;
    try {
      Object.defineProperty(window, RARE_ENCOUNTER_KEY, {
        value: state,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    } catch {
      window[RARE_ENCOUNTER_KEY] = state;
    }
    return {
      ok: true,
      code: "ARMED",
      message: "已等待下一次野生遭遇；训练家层会跳过",
      rareEncounter: rareEncounterModel(scene),
    };
  }

  function cancelRareEncounter(scene) {
    const state = window[RARE_ENCOUNTER_KEY];
    const wasArmed = state?.armed === true;
    if (state) restoreRareEncounterHook(state);
    try { delete window[RARE_ENCOUNTER_KEY]; } catch { /* Status still reports it as inactive. */ }
    return {
      ok: true,
      code: wasArmed ? "CANCELLED" : "ALREADY_IDLE",
      message: wasArmed ? "已取消下一次稀有遭遇" : "当前没有等待中的稀有遭遇",
      rareEncounter: rareEncounterModel(scene),
    };
  }

  function editableSessionState(session) {
    const copy = toPlain(session);
    return {
      seed: copy.seed ?? "",
      waveIndex: Number(copy.waveIndex ?? -1),
      gameVersion: normalizeVersion(copy.gameVersion),
      money: Number(copy.money ?? 0),
      pokeballCounts: Object.fromEntries(Object.keys(BALL_LABELS).map(key => [key, Number(copy.pokeballCounts?.[key] ?? 0)])),
      party: (copy.party || []).map(pokemon => ({
        id: Number(pokemon.id),
        hp: Number(pokemon.hp ?? 0),
        status: pokemon.status ?? null,
        ppUsed: (pokemon.moveset || []).map(move => Number(move?.ppUsed ?? 0)),
        friendship: Number(pokemon.friendship ?? 0),
        pokerus: Boolean(pokemon.pokerus),
        pauseEvolutions: Boolean(pokemon.pauseEvolutions),
        ivs: Array.isArray(pokemon.ivs) ? pokemon.ivs.map(Number) : [],
      })),
      modifiers: (copy.modifiers || []).map((modifier, index) => ({
        fingerprint: modifierFingerprint(modifier, index),
        stackCount: Number(modifier.stackCount ?? 1),
      })),
    };
  }

  async function inspectScene(scene) {
    const slotId = Number(scene.sessionSlotId);
    if (!Number.isInteger(slotId) || slotId < 0 || slotId > 4) {
      throw new Error("活动槽位编号无效");
    }
    const gameData = scene.gameData;
    const persisted = toPlain(await gameData.getSession(slotId));
    if (!persisted || typeof persisted !== "object") {
      throw new Error("当前活动槽位尚无可回读的持久化存档");
    }
    // getSession is asynchronous. Capture every live field only after that
    // await so a change made while the cache was being read cannot be hidden
    // behind an older live hash.
    const liveSession = toPlain(gameData.getSessionSaveData());
    const runName = String(persisted?.name ?? liveSession?.name ?? "");
    liveSession.name = runName;

    const partyRows = getPartyRows(scene);
    const modifierRows = getModifierRows(scene, liveSession, partyRows);
    const version = getVersion(scene);
    const versionSupported = SUPPORTED_VERSIONS.includes(version);
    const phaseState = getPhaseState(scene);
    const normalizerCheck = checkPersistenceNormalizer(gameData, liveSession);
    const readOnlyReasons = [];
    if (!versionSupported) {
      readOnlyReasons.push(`游戏版本 ${version || "未知"} 尚未验证`);
    }
    if (!phaseState.stable) {
      readOnlyReasons.push(`当前是“${phaseState.phaseName}”，请回到可选择招式的指令阶段`);
    }
    const resetStatusPhaseState = getResetStatusPhaseState(scene);
    if (resetStatusPhaseState === "queued") {
      readOnlyReasons.push("检测到待执行的异常状态恢复阶段；请刷新游戏并重新载入存档");
    } else if (resetStatusPhaseState !== "clear") {
      readOnlyReasons.push("无法确认异常状态恢复阶段队列为空");
    }
    if (!normalizerCheck.ok) {
      readOnlyReasons.push(normalizerCheck.reason);
    }
    if (Number(liveSession.waveIndex) !== Number(scene.currentBattle.waveIndex)
      || String(liveSession.seed ?? "") !== String(scene.seed ?? "")) {
      readOnlyReasons.push("实时会话与战斗场景的对局标识不一致，请等待游戏状态稳定后刷新");
    }
    if (!scene.input || typeof scene.input.enabled !== "boolean") {
      readOnlyReasons.push("无法安全锁定游戏输入");
    } else if (!scene.input.enabled) {
      readOnlyReasons.push("游戏输入尚未启用，请等待指令界面稳定");
    }

    const liveFullHash = await fullSessionHash(liveSession);
    const backendFullHash = await fullSessionHash(persisted);
    const normalizedLiveFullHash = normalizerCheck.ok
      ? await fullSessionHash(normalizerCheck.normalized)
      : null;
    const guardHash = await sha256({
      schema: 3,
      slotId,
      phaseName: phaseState.phaseName,
      seed: String(liveSession.seed ?? ""),
      waveIndex: Number(liveSession.waveIndex),
      turn: Number(scene.currentBattle.turn ?? 0),
      sessionHash: liveFullHash,
    });
    const editableHash = await sha256(editableSessionState(liveSession));
    return {
      ok: true,
      adapterVersion: ADAPTER_VERSION,
      pageInstanceId: getPageInstanceId(),
      model: {
        readOnly: readOnlyReasons.length > 0,
        readOnlyReason: readOnlyReasons.join("；"),
        persistenceInSync: normalizedLiveFullHash === backendFullHash,
        hash: guardHash,
        backendHash: backendFullHash,
        run: {
          slotId,
          displaySlot: slotId + 1,
          name: runName,
          waveIndex: Number(liveSession.waveIndex),
          turn: Number(scene.currentBattle.turn ?? 0),
          mode: getModeName(scene),
          seed: String(liveSession.seed ?? ""),
          gameVersion: version,
          phase: phaseState.phaseName,
          accountIdentity: `${gameData.trainerId ?? ""}:${gameData.secretId ?? ""}`,
        },
        money: Number(liveSession.money ?? 0),
        pokeballs: Object.keys(BALL_LABELS).map(key => ({
          key,
          label: BALL_LABELS[key],
          value: Number(liveSession.pokeballCounts?.[key] ?? 0),
          max: MAX_BALL_COUNT,
        })),
        party: partyRows,
        modifiers: modifierRows,
        account: accountEggModel(scene),
        rareEncounter: rareEncounterModel(scene),
        capabilities: {
          nativeBackup: typeof gameData.tryExportData === "function",
          undo: true,
          accountData: true,
          persistenceNormalization: normalizerCheck.ok,
        },
      },
      backup: {
        fullHash: liveFullHash,
        editableHash,
        backendHash: backendFullHash,
        session: liveSession,
      },
    };
  }

  function findPokemon(scene, pokemonId) {
    const matches = getParty(scene).filter(pokemon => pokemon.id === pokemonId);
    if (matches.length !== 1) {
      throw new Error("找不到唯一的目标队伍成员");
    }
    return matches[0];
  }

  function getResetStatusPhaseState(scene) {
    const phaseManager = scene?.phaseManager;
    if (!phaseManager || typeof phaseManager.hasPhaseOfType !== "function") {
      return "unsupported";
    }
    try {
      return phaseManager.hasPhaseOfType("ResetStatusPhase") === true ? "queued" : "clear";
    } catch {
      return "unknown";
    }
  }

  function requireClearResetStatusPhaseQueue(scene, action) {
    const state = getResetStatusPhaseState(scene);
    if (state === "clear") return;
    if (state === "queued") {
      throw new Error(`${action}时检测到待执行的异常状态恢复阶段；请刷新游戏后重试`);
    }
    throw new Error(`${action}时无法确认异常状态恢复阶段队列为空`);
  }

  function getSleepRestoreCoupledTags(pokemon) {
    const tags = pokemon?.summonData?.tags;
    if (!Array.isArray(tags)) return [];
    return tags
      .map(tag => String(tag?.tagType || ""))
      .filter(tagType => SLEEP_RESTORE_COUPLED_TAG_TYPES.has(tagType));
  }

  function statusMatchesSaved(pokemon, savedStatus) {
    return stableStringify(toPlain(pokemon?.status ?? null))
      === stableStringify(toPlain(savedStatus ?? null));
  }

  function validateSavedStatusForRestore(pokemon, savedStatus, memberIndex) {
    if (savedStatus == null) {
      if (pokemon.status != null && typeof pokemon.resetStatus !== "function") {
        throw new Error(`队伍成员 ${memberIndex + 1} 缺少安全的同步状态恢复能力`);
      }
      return null;
    }
    if (typeof savedStatus !== "object" || Array.isArray(savedStatus)) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的备份异常状态结构无效`);
    }
    const unknownKeys = Object.keys(savedStatus).filter(key => !SAVED_STATUS_KEYS.has(key));
    if (unknownKeys.length > 0) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的备份异常状态包含未验证字段`);
    }
    const effect = Number(savedStatus.effect);
    if (!Number.isInteger(effect) || effect <= STATUS_EFFECT_NONE || effect > MAX_STATUS_EFFECT) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的备份异常状态无效`);
    }
    if (typeof pokemon.doSetStatus !== "function") {
      throw new Error(`队伍成员 ${memberIndex + 1} 缺少安全的异常状态恢复能力`);
    }
    // doSetStatus may partially write before it throws or before exact shape
    // validation fails. A synchronous reset is therefore required even when
    // the current status is null, so rollback can remove a partial write.
    if (typeof pokemon.resetStatus !== "function") {
      throw new Error(`队伍成员 ${memberIndex + 1} 缺少安全的同步状态恢复能力`);
    }
    for (const key of ["toxicTurnCount", "sleepTurnsRemaining", "freezeTurnsRemaining"]) {
      if (!Object.hasOwn(savedStatus, key)) continue;
      const value = Number(savedStatus[key]);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`队伍成员 ${memberIndex + 1} 的备份异常计数无效`);
      }
    }
    if (!Object.hasOwn(savedStatus, "toxicTurnCount")) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的备份异常状态缺少中毒回合计数`);
    }
    if (effect === STATUS_EFFECT_SLEEP && !Object.hasOwn(savedStatus, "sleepTurnsRemaining")) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的备份睡眠状态缺少剩余回合`);
    }
    if (effect === STATUS_EFFECT_FREEZE && !Object.hasOwn(savedStatus, "freezeTurnsRemaining")) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的备份冰冻状态缺少剩余回合`);
    }
    if (effect === STATUS_EFFECT_SLEEP && getSleepRestoreCoupledTags(pokemon).length > 0) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的睡眠状态关联了无法安全逆转的战斗标签`);
    }
    return {
      effect,
      sleepTurns: Object.hasOwn(savedStatus, "sleepTurnsRemaining")
        ? Number(savedStatus.sleepTurnsRemaining)
        : undefined,
    };
  }

  function validateImmediateStatusChange(pokemon, memberIndex) {
    const statusEffect = Number(pokemon?.status?.effect ?? STATUS_EFFECT_NONE);
    const hp = Number(pokemon?.hp);
    if (!Number.isSafeInteger(hp) || hp < 0) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的 HP 状态无效`);
    }
    if (statusEffect < STATUS_EFFECT_NONE || statusEffect > MAX_STATUS_EFFECT || !Number.isInteger(statusEffect)) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的异常状态编号无效`);
    }
    if (pokemon.status != null) {
      if (typeof pokemon.resetStatus !== "function") {
        throw new Error(`队伍成员 ${memberIndex + 1} 缺少安全的同步状态恢复能力`);
      }
      if (typeof pokemon.doSetStatus !== "function") {
        throw new Error(`队伍成员 ${memberIndex + 1} 缺少可回滚的异常状态恢复能力`);
      }
    }
    if ((hp === 0) !== (statusEffect === STATUS_EFFECT_FAINT)) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的濒死状态与 HP 不一致`);
    }
    if (pokemon.status != null) {
      validateSavedStatusForRestore(pokemon, toPlain(pokemon.status), memberIndex);
    }
    const pendingStatus = pokemon?.turnData?.pendingStatus;
    if (pendingStatus != null && Number(pendingStatus) !== STATUS_EFFECT_NONE) {
      throw new Error(`队伍成员 ${memberIndex + 1} 仍有待执行的异常状态阶段，请刷新游戏后重试`);
    }
    if (statusEffect === STATUS_EFFECT_SLEEP && getSleepRestoreCoupledTags(pokemon).length > 0) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的睡眠状态关联了无法安全逆转的战斗标签；暂不自动清除`);
    }
  }

  function clearStatusImmediately(pokemon, memberIndex) {
    if (pokemon.status == null) return;
    if (typeof pokemon.resetStatus !== "function") {
      throw new Error(`队伍成员 ${memberIndex + 1} 缺少安全的同步状态恢复能力`);
    }
    pokemon.resetStatus(true, false, false, false);
    if (pokemon.status != null) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的异常状态未能立即清除`);
    }
  }

  function captureRuntime(scene) {
    return {
      money: scene.money,
      pokeballCounts: { ...scene.pokeballCounts },
      party: getParty(scene).map(pokemon => ({
        pokemon,
        hp: pokemon.hp,
        status: toPlain(pokemon.status),
        friendship: pokemon.friendship,
        pokerus: pokemon.pokerus,
        pauseEvolutions: pokemon.pauseEvolutions,
        ivs: Array.isArray(pokemon.ivs) ? pokemon.ivs.slice() : [],
        stats: Array.isArray(pokemon.stats) ? pokemon.stats.slice() : [],
        ppUsed: getMoves(pokemon).map(move => move.ppUsed),
      })),
      modifiers: getRuntimeModifiers(scene).map(modifier => ({ modifier, stackCount: modifier.stackCount })),
    };
  }

  function buildRuntimeTouchPlan(operations, referenceSession, runtimeBackup) {
    const types = new Set(operations.map(operation => operation.type));
    const referenceById = new Map((referenceSession?.party || []).map(pokemon => [Number(pokemon.id), pokemon]));
    const healOperation = operations.find(operation => operation.type === "healParty") || null;
    const healById = new Map();
    if (healOperation) {
      for (const state of runtimeBackup.party) {
        const id = Number(state.pokemon.id);
        const reference = referenceById.get(id);
        if (!reference || !Number.isSafeInteger(Number(reference.hp))) {
          throw new Error("无法确定队伍恢复的精确回滚范围");
        }
        const targetFainted = Number(reference.hp) === 0;
        healById.set(id, {
          hp: healOperation.hp || (healOperation.status && targetFainted),
          status: healOperation.status || (healOperation.hp && targetFainted),
          pp: healOperation.pp,
        });
      }
    }
    const modifierIndexes = new Set();
    for (const operation of operations.filter(item => item.type === "setModifierStack")) {
      const matches = (referenceSession?.modifiers || [])
        .map((modifier, index) => ({ index, fingerprint: modifierFingerprint(modifier, index) }))
        .filter(item => item.fingerprint === String(operation.fingerprint));
      if (matches.length !== 1 || !runtimeBackup.modifiers[matches[0].index]) {
        throw new Error("无法确定目标道具的精确回滚范围");
      }
      modifierIndexes.add(matches[0].index);
    }
    return {
      money: types.has("setMoney"),
      ballKeys: new Set(operations
        .filter(operation => operation.type === "setBallCount")
        .map(operation => String(operation.key))),
      healById,
      friendshipIds: new Set(operations
        .filter(operation => operation.type === "setFriendship")
        .map(operation => Number(operation.pokemonId))),
      pokerusIds: new Set(operations
        .filter(operation => operation.type === "setPokerus")
        .map(operation => Number(operation.pokemonId))),
      evolutionIds: new Set(operations
        .filter(operation => operation.type === "setPauseEvolutions")
        .map(operation => Number(operation.pokemonId))),
      ivIds: new Set(operations
        .filter(operation => operation.type === "maxIvs")
        .map(operation => Number(operation.pokemonId))),
      modifierIndexes,
      addedModifiers: types.has("addModifier"),
    };
  }

  async function refreshRuntimeUi(scene, changedPokemon, modifiersChanged) {
    try {
      scene.updateMoneyText?.();
    } catch {
      // Cosmetic refresh only.
    }
    if (modifiersChanged) {
      try {
        await Promise.resolve(scene.updateModifiers?.(true, true));
      } catch {
        throw new Error("道具层数更新后，游戏拒绝刷新道具状态");
      }
    }
    for (const pokemon of changedPokemon) {
      try {
        await Promise.resolve(pokemon.updateInfo?.(true));
      } catch {
        // The serialized state is authoritative; a hidden party member may not
        // currently have a battle-info widget to refresh.
      }
    }
  }

  async function restoreRuntime(scene, backup, touchPlan) {
    if (touchPlan.money) scene.money = backup.money;
    for (const [key, value] of Object.entries(backup.pokeballCounts)) {
      if (touchPlan.ballKeys.has(key)) scene.pokeballCounts[key] = value;
    }
    const changedPokemon = new Set();
    const modifiersChanged = touchPlan.modifierIndexes.size > 0 || touchPlan.addedModifiers;
    // Recalculating a reverted HP item can clamp HP to the old maximum instead
    // of restoring the old injury. Restore that coupled field after recalculation.
    const coupledHpIds = new Set(backup.party.filter(state => modifiersChanged
      && Number(state.pokemon.stats?.[0]) !== Number(state.stats[0])).map(state => Number(state.pokemon.id)));
    for (const [memberIndex, state] of backup.party.entries()) {
      const pokemon = state.pokemon;
      const healTouch = touchPlan.healById.get(Number(pokemon.id));
      let changed = false;
      if (touchPlan.ivIds.has(Number(pokemon.id))) {
        pokemon.ivs = state.ivs.slice();
        pokemon.stats = state.stats.slice();
        pokemon.hp = state.hp;
        changed = true;
      }
      if (healTouch?.hp) {
        pokemon.hp = state.hp;
        changed = true;
      }
      if (healTouch?.status) {
        if (!statusMatchesSaved(pokemon, state.status)) {
          restoreSavedStatus(pokemon, state.status, memberIndex);
          changed = true;
        }
      }
      if (healTouch?.pp) {
        getMoves(pokemon).forEach((move, index) => {
          move.ppUsed = state.ppUsed[index] ?? move.ppUsed;
        });
        changed = true;
      }
      if (touchPlan.friendshipIds.has(Number(pokemon.id))) {
        pokemon.friendship = state.friendship;
        changed = true;
      }
      if (touchPlan.pokerusIds.has(Number(pokemon.id))) {
        pokemon.pokerus = state.pokerus;
        changed = true;
      }
      if (touchPlan.evolutionIds.has(Number(pokemon.id))) {
        pokemon.pauseEvolutions = state.pauseEvolutions;
        changed = true;
      }
      if (changed) changedPokemon.add(pokemon);
    }
    if (touchPlan.modifierIndexes.size > 0) {
      for (const index of touchPlan.modifierIndexes) {
        const state = backup.modifiers[index];
        state.modifier.stackCount = state.stackCount;
      }
    }
    if (touchPlan.addedModifiers) {
      scene.modifiers.splice(0, scene.modifiers.length, ...backup.modifiers.map(state => state.modifier));
      for (const state of backup.modifiers) state.modifier.stackCount = state.stackCount;
    }
    await refreshRuntimeUi(scene, changedPokemon, modifiersChanged);
    for (const state of backup.party) {
      if (!coupledHpIds.has(Number(state.pokemon.id)) && !touchPlan.ivIds.has(Number(state.pokemon.id))) continue;
      if (stableStringify(state.pokemon.stats) !== stableStringify(state.stats)) {
        throw new Error("回滚后的能力值与修改前不一致");
      }
      state.pokemon.hp = requireInteger(Number(state.hp), 0, Number(state.stats[0]), "回滚 HP");
      changedPokemon.add(state.pokemon);
    }
    if (coupledHpIds.size) await refreshRuntimeUi(scene, changedPokemon, false);
  }

  function validateOperationSet(operations) {
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > 100) {
      throw new Error("修改项目数量无效");
    }
    const seen = new Set();
    for (const operation of operations) {
      if (!operation || typeof operation !== "object" || typeof operation.type !== "string") {
        throw new Error("存在无效修改项目");
      }
      let key = operation.type;
      if (operation.key != null) key += `:${operation.key}`;
      if (operation.pokemonId != null) key += `:${operation.pokemonId}`;
      if (operation.fingerprint != null) key += `:${operation.fingerprint}`;
      if (operation.itemId != null) key += `:${operation.itemId}`;
      if (seen.has(key)) {
        throw new Error(`重复修改项目：${operation.type}`);
      }
      seen.add(key);
    }
  }

  function preflightOperations(scene, operations, initialInspection, undoing = false) {
    validateOperationSet(operations);
    const party = getParty(scene);
    const liveSession = toPlain(scene.gameData.getSessionSaveData());
    const modifierRows = getModifierRows(scene, liveSession, getPartyRows(scene));
    const modifierByFingerprint = new Map(modifierRows.map(row => [row.fingerprint, row]));
    const runtimeModifiers = getRuntimeModifiers(scene);
    const plannedStacks = new Map();
    let finalName = initialInspection.model.run.name;

    for (const operation of operations) {
      switch (operation.type) {
        case "addModifier": {
          const plan = itemPlan(scene, operation, undoing, plannedStacks);
          if (plan.index >= 0) plannedStacks.set(plan.index, plan.total);
          break;
        }
        case "setMoney":
          requireInteger(operation.value, 0, MAX_MONEY, "金钱");
          break;
        case "setBallCount": {
          const key = String(operation.key);
          if (!Object.hasOwn(BALL_LABELS, key) || !Object.hasOwn(scene.pokeballCounts, key)) {
            throw new Error(`精灵球键 ${key} 不受支持`);
          }
          requireInteger(operation.value, 0, MAX_BALL_COUNT, BALL_LABELS[key]);
          break;
        }
        case "healParty": {
          if (typeof operation.hp !== "boolean"
            || typeof operation.status !== "boolean"
            || typeof operation.pp !== "boolean") {
            throw new Error("队伍恢复选项必须是布尔值");
          }
          const { hp, status, pp } = operation;
          if (!hp && !status && !pp) throw new Error("队伍恢复至少需要选择一项");
          for (const [memberIndex, pokemon] of party.entries()) {
            const maxHp = Number(pokemon.getMaxHp?.() ?? pokemon.stats?.[0]);
            if (!Number.isSafeInteger(maxHp) || maxHp < 1) {
              throw new Error(`队伍成员 ${memberIndex + 1} 的最大 HP 无效`);
            }
            const wasFainted = Number(pokemon.hp) === 0;
            if (status || (hp && wasFainted)) validateImmediateStatusChange(pokemon, memberIndex);
          }
          break;
        }
        case "setFriendship":
          findPokemon(scene, operation.pokemonId);
          requireInteger(operation.value, 0, MAX_FRIENDSHIP, "亲密度");
          break;
        case "setPokerus":
          if (typeof operation.value !== "boolean") throw new Error("宝可病毒值必须是布尔值");
          findPokemon(scene, operation.pokemonId);
          break;
        case "setPauseEvolutions":
          if (typeof operation.value !== "boolean") throw new Error("暂停进化值必须是布尔值");
          findPokemon(scene, operation.pokemonId);
          break;
        case "maxIvs": {
          const pokemon = findPokemon(scene, operation.pokemonId);
          const memberIndex = party.findIndex(member => member === pokemon);
          if (!Array.isArray(pokemon.ivs) || pokemon.ivs.length !== 6 || typeof pokemon.calculateStats !== "function") {
            throw new Error(`队伍成员 ${memberIndex + 1} 无法安全重算个体值`);
          }
          const maxHp = Number(pokemon.getMaxHp?.() ?? pokemon.stats?.[0]);
          const hp = Number(pokemon.hp);
          if (!Number.isSafeInteger(maxHp) || maxHp < 1
            || !Number.isSafeInteger(hp) || hp < 0 || hp > maxHp) {
            throw new Error(`队伍成员 ${memberIndex + 1} 的 HP 状态无效`);
          }
          break;
        }
        case "setModifierStack": {
          const row = modifierByFingerprint.get(String(operation.fingerprint));
          if (!row || !row.editable || !runtimeModifiers[row.index]) {
            throw new Error("目标道具不存在、已变化或属于受保护道具");
          }
          requireInteger(operation.value, 1, row.maxStackCount, `${row.name} 层数`);
          plannedStacks.set(row.index, operation.value);
          break;
        }
        case "renameRun": {
          const name = String(operation.value ?? "").trim();
          if (!name || [...name].length > 40) throw new Error("对局名称必须为 1–40 个字符");
          finalName = name;
          break;
        }
        default:
          throw new Error(`不支持的修改类型：${operation.type}`);
      }
    }
    return { party, modifierByFingerprint, runtimeModifiers, finalName };
  }

  async function applyOperations(scene, operations, initialInspection) {
    const preflight = preflightOperations(scene, operations, initialInspection);
    const changedPokemon = new Set();
    let modifiersChanged = false;
    const ivStatsById = new Map();
    let finalName = preflight.finalName;
    const { modifierByFingerprint, runtimeModifiers } = preflight;

    for (const operation of operations) {
      switch (operation.type) {
        case "addModifier": {
          const plan = itemPlan(scene, operation);
          if (plan.index >= 0) runtimeModifiers[plan.index].stackCount = plan.total;
          else { plan.item.stackCount = plan.count; scene.modifiers.push(plan.item); }
          modifiersChanged = true;
          break;
        }
        case "setMoney":
          scene.money = requireInteger(operation.value, 0, MAX_MONEY, "金钱");
          break;
        case "setBallCount": {
          const key = String(operation.key);
          if (!Object.hasOwn(BALL_LABELS, key) || !Object.hasOwn(scene.pokeballCounts, key)) {
            throw new Error(`精灵球键 ${key} 不受支持`);
          }
          scene.pokeballCounts[key] = requireInteger(operation.value, 0, MAX_BALL_COUNT, BALL_LABELS[key]);
          break;
        }
        case "healParty": {
          if (typeof operation.hp !== "boolean"
            || typeof operation.status !== "boolean"
            || typeof operation.pp !== "boolean") {
            throw new Error("队伍恢复选项必须是布尔值");
          }
          const { hp, status, pp } = operation;
          if (!hp && !status && !pp) {
            throw new Error("队伍恢复至少需要选择一项");
          }
          for (const [memberIndex, pokemon] of getParty(scene).entries()) {
            const wasFainted = Number(pokemon.hp) === 0;
            const maxHp = Number(pokemon.getMaxHp?.() ?? pokemon.stats?.[0]);
            if (!Number.isSafeInteger(maxHp) || maxHp < 1) {
              throw new Error(`队伍成员 ${memberIndex + 1} 的最大 HP 无效`);
            }
            const shouldClearStatus = status || (hp && wasFainted);
            if (shouldClearStatus) validateImmediateStatusChange(pokemon, memberIndex);
            if (hp || (status && wasFainted)) pokemon.hp = maxHp;
            if (shouldClearStatus) clearStatusImmediately(pokemon, memberIndex);
            if (pp) getMoves(pokemon).forEach(move => { move.ppUsed = 0; });
            changedPokemon.add(pokemon);
          }
          break;
        }
        case "setFriendship": {
          const pokemon = findPokemon(scene, operation.pokemonId);
          pokemon.friendship = requireInteger(operation.value, 0, MAX_FRIENDSHIP, "亲密度");
          changedPokemon.add(pokemon);
          break;
        }
        case "setPokerus": {
          if (typeof operation.value !== "boolean") throw new Error("宝可病毒值必须是布尔值");
          const pokemon = findPokemon(scene, operation.pokemonId);
          pokemon.pokerus = operation.value;
          changedPokemon.add(pokemon);
          break;
        }
        case "setPauseEvolutions": {
          if (typeof operation.value !== "boolean") throw new Error("暂停进化值必须是布尔值");
          const pokemon = findPokemon(scene, operation.pokemonId);
          pokemon.pauseEvolutions = operation.value;
          changedPokemon.add(pokemon);
          break;
        }
        case "maxIvs": {
          const pokemon = findPokemon(scene, operation.pokemonId);
          const memberIndex = getParty(scene).findIndex(member => member === pokemon);
          const memberLabel = `队伍成员 ${memberIndex + 1}`;
          if (!Array.isArray(pokemon.ivs) || pokemon.ivs.length !== 6 || typeof pokemon.calculateStats !== "function") {
            throw new Error(`${memberLabel} 无法安全重算个体值`);
          }
          const oldMaxHp = Number(pokemon.getMaxHp?.() ?? pokemon.stats?.[0]);
          const oldHp = Number(pokemon.hp);
          if (!Number.isSafeInteger(oldMaxHp) || oldMaxHp < 1
            || !Number.isSafeInteger(oldHp) || oldHp < 0 || oldHp > oldMaxHp) {
            throw new Error(`${memberLabel} 的 HP 状态无效`);
          }
          pokemon.ivs = [31, 31, 31, 31, 31, 31];
          pokemon.calculateStats();
          ivStatsById.set(Number(pokemon.id), toPlain(pokemon.stats));
          const newMaxHp = Number(pokemon.getMaxHp?.() ?? pokemon.stats?.[0]);
          if (!Number.isSafeInteger(newMaxHp) || newMaxHp < 1) {
            throw new Error(`${memberLabel} 重算后的最大 HP 无效`);
          }
          pokemon.hp = oldHp === 0
            ? 0
            : Math.min(newMaxHp, Math.max(1, oldHp + (newMaxHp - oldMaxHp)));
          changedPokemon.add(pokemon);
          break;
        }
        case "setModifierStack": {
          const row = modifierByFingerprint.get(String(operation.fingerprint));
          if (!row || !row.editable) {
            throw new Error("目标道具不存在、已变化或属于受保护道具");
          }
          const value = requireInteger(operation.value, 1, row.maxStackCount, `${row.name} 层数`);
          const runtime = runtimeModifiers[row.index];
          if (!runtime) throw new Error("目标道具运行时对象不存在");
          runtime.stackCount = value;
          modifiersChanged = true;
          break;
        }
        case "renameRun": {
          const name = String(operation.value ?? "").trim();
          if (!name || [...name].length > 40) {
            throw new Error("对局名称必须为 1–40 个字符");
          }
          finalName = name;
          break;
        }
        default:
          throw new Error(`不支持的修改类型：${operation.type}`);
      }
    }

    await refreshRuntimeUi(scene, changedPokemon, modifiersChanged);
    return { finalName, changedPokemon, modifiersChanged, ivStatsById };
  }

  function findSavedPokemon(session, pokemonId) {
    const matches = (session.party || []).filter(pokemon => Number(pokemon.id) === Number(pokemonId));
    if (matches.length !== 1) throw new Error("存档中找不到唯一的目标队伍成员");
    return matches[0];
  }

  function expectedStatHp(hp, oldMax, newMax, preserveDamage = false) {
    requireInteger(Number(oldMax), 1, Number.MAX_SAFE_INTEGER, "原最大 HP");
    requireInteger(Number(newMax), 1, Number.MAX_SAFE_INTEGER, "新最大 HP");
    requireInteger(Number(hp), 0, Number(oldMax), "原 HP");
    if (hp === 0) return 0;
    if (preserveDamage) return Math.min(newMax, Math.max(1, hp + (newMax - oldMax)));
    // Official Pokemon.calculateStats(): clamp on decreases, add the maximum
    // increase to living Pokémon. Never accept arbitrary observed HP changes.
    return hp > newMax ? newMax : newMax > oldMax ? hp + (newMax - oldMax) : hp;
  }

  function buildExpectedCommitSession(originalSession, actualSession, operations, inspection, finalName, ivStatsById) {
    const expected = toPlain(originalSession);
    const actual = toPlain(actualSession);
    expected.name = finalName;
    actual.name = finalName;
    const partyModel = new Map(inspection.model.party.map(pokemon => [pokemon.id, pokemon]));

    for (const operation of operations) {
      switch (operation.type) {
        case "addModifier": {
          const item = makeItem(window[SCENE_CACHE_KEY], window[GAME_EXPORTS_KEY], operation.itemId, operation.pokemonId);
          const saved = serializedItem(item, operation.count);
          const index = (expected.modifiers || []).findIndex(row => row.typeId === saved.typeId
            && stableStringify(row.args || []) === stableStringify(saved.args));
          if (index >= 0) expected.modifiers[index].stackCount += operation.count;
          else (expected.modifiers ||= []).push(saved);
          break;
        }
        case "setMoney":
          expected.money = operation.value;
          break;
        case "setBallCount":
          expected.pokeballCounts[String(operation.key)] = operation.value;
          break;
        case "healParty":
          for (const [memberIndex, originalPokemon] of (expected.party || []).entries()) {
            const modelPokemon = partyModel.get(Number(originalPokemon.id));
            if (!modelPokemon) throw new Error("队伍在应用恢复时发生变化");
            const wasFainted = Number(originalPokemon.hp) === 0;
            if (operation.hp || (operation.status && wasFainted)) {
              originalPokemon.hp = Number(originalPokemon.stats?.[0] ?? modelPokemon.maxHp);
            }
            if (operation.status || (operation.hp && wasFainted)) originalPokemon.status = null;
            if (operation.pp) {
              originalPokemon.moveset = (originalPokemon.moveset || []).map(move => ({ ...move, ppUsed: 0 }));
            }
          }
          break;
        case "setFriendship":
          findSavedPokemon(expected, operation.pokemonId).friendship = operation.value;
          break;
        case "setPokerus":
          findSavedPokemon(expected, operation.pokemonId).pokerus = operation.value;
          break;
        case "setPauseEvolutions":
          findSavedPokemon(expected, operation.pokemonId).pauseEvolutions = operation.value;
          break;
        case "maxIvs": {
          const target = findSavedPokemon(expected, operation.pokemonId);
          const stats = ivStatsById.get(Number(operation.pokemonId));
          if (!Array.isArray(stats) || stats.length !== 6) throw new Error("缺少个体值重算结果");
          target.ivs = [31, 31, 31, 31, 31, 31];
          target.hp = expectedStatHp(Number(target.hp), Number(target.stats[0]), Number(stats[0]), true);
          target.stats = toPlain(stats);
          break;
        }
        case "setModifierStack": {
          const index = inspection.model.modifiers.findIndex(row => row.fingerprint === operation.fingerprint);
          if (index < 0 || !expected.modifiers?.[index]) throw new Error("目标道具存档条目已变化");
          expected.modifiers[index].stackCount = operation.value;
          break;
        }
        case "renameRun":
          expected.name = finalName;
          actual.name = finalName;
          break;
        default:
          throw new Error(`无法验证修改类型：${operation.type}`);
      }
    }

    if (operations.some(operation => ["setModifierStack", "addModifier"].includes(operation.type))) {
      for (const expectedPokemon of expected.party || []) {
        const newStats = findSavedPokemon(actual, expectedPokemon.id).stats;
        expectedPokemon.hp = expectedStatHp(Number(expectedPokemon.hp), Number(expectedPokemon.stats[0]), Number(newStats[0]));
        expectedPokemon.stats = toPlain(newStats);
      }
    }

    const canonicalExpected = canonicalFullSession(expected);
    const canonicalActual = canonicalFullSession(actual);
    if (stableStringify(canonicalExpected) !== stableStringify(canonicalActual)) {
      throw whitelistMismatchError(
        "实际存档变化与本次操作的精确白名单不一致",
        canonicalExpected,
        canonicalActual,
        "commit-whitelist",
      );
    }
    return expected;
  }

  async function runtimeGuardHash(scene, sessionHash) {
    return await sha256({
      schema: 3,
      slotId: Number(scene.sessionSlotId),
      phaseName: getPhaseState(scene).phaseName,
      seed: String(scene.seed ?? ""),
      waveIndex: Number(scene.currentBattle?.waveIndex),
      turn: Number(scene.currentBattle?.turn ?? 0),
      sessionHash,
    });
  }

  async function rollbackAndVerify(scene, runtimeBackup, touchPlan, originalSession) {
    try {
      await restoreRuntime(scene, runtimeBackup, touchPlan);
      const restored = captureLiveSession(scene, originalSession.name);
      return getResetStatusPhaseState(scene) === "clear"
        && await fullSessionHash(restored) === await fullSessionHash(originalSession);
    } catch {
      return false;
    }
  }

  async function rollbackBeforePersistence(
    scene,
    runtimeBackup,
    touchPlan,
    originalSession,
    beforeBackendHash,
    transactionGuard,
  ) {
    try {
      const slotId = Number(scene.sessionSlotId);
      const persistedBefore = toPlain(await scene.gameData.getSession(slotId));
      if (!persistedBefore || await fullSessionHash(persistedBefore) !== beforeBackendHash) {
        return { status: "cache-changed" };
      }
      if (!transactionGuardMatches(scene, transactionGuard, false)
        || getResetStatusPhaseState(scene) !== "clear") {
        return { status: "runtime-unsafe" };
      }
      const restored = await rollbackAndVerify(scene, runtimeBackup, touchPlan, originalSession);
      if (!restored) return { status: "runtime-unverified" };
      if (!transactionGuardMatches(scene, transactionGuard, false)) {
        return { status: "runtime-unverified" };
      }
      const persistedAfter = toPlain(await scene.gameData.getSession(slotId));
      if (!persistedAfter || await fullSessionHash(persistedAfter) !== beforeBackendHash) {
        return { status: "cache-changed" };
      }
      if (!transactionGuardMatches(scene, transactionGuard, false)
        || getResetStatusPhaseState(scene) !== "clear") {
        return { status: "runtime-unverified" };
      }
      const finalLive = captureLiveSession(scene, originalSession.name);
      if (canonicalFullString(finalLive) !== canonicalFullString(originalSession)) {
        return { status: "runtime-unverified" };
      }
      return { status: "restored" };
    } catch {
      return { status: "unverified" };
    }
  }

  function normalizeExpectedPersistence(gameData, session) {
    if (typeof gameData.parseSessionData !== "function") {
      throw new Error("当前版本无法规范化持久化存档，已停止写入");
    }
    const serialized = JSON.stringify(toPlain(session));
    const parsedValue = gameData.parseSessionData(serialized);
    if (parsedValue && typeof parsedValue.then === "function") {
      throw new Error("持久化规范化意外返回异步结果");
    }
    const parsed = toPlain(parsedValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || !Array.isArray(parsed.party) || !Array.isArray(parsed.enemyParty)
      || !Array.isArray(parsed.modifiers) || !Array.isArray(parsed.enemyModifiers)
      || !parsed.pokeballCounts || typeof parsed.pokeballCounts !== "object" || Array.isArray(parsed.pokeballCounts)
      || !Object.hasOwn(parsed, "seed")
      || !Number.isSafeInteger(Number(parsed.waveIndex))
      || !normalizeVersion(parsed.gameVersion)) {
      throw new Error("持久化规范化没有返回完整有效的会话结构");
    }
    parsed.name = String(session?.name ?? "");
    return parsed;
  }

  function checkPersistenceNormalizer(gameData, session) {
    if (typeof gameData.parseSessionData !== "function") {
      return { ok: false, reason: "当前版本缺少可验证的持久化规范化能力" };
    }
    try {
      const once = normalizeExpectedPersistence(gameData, session);
      const twice = normalizeExpectedPersistence(gameData, once);
      if (stableStringify(canonicalFullSession(once)) !== stableStringify(canonicalFullSession(twice))) {
        return { ok: false, reason: "持久化规范化结果不具备确定幂等性" };
      }
      return { ok: true, normalized: once };
    } catch {
      return { ok: false, reason: "持久化规范化能力自检失败" };
    }
  }

  function operationPersistenceProjection(session, operations, inspection) {
    const projection = [{ type: "preserveRunName", value: String(session?.name ?? "") }];
    for (const operation of operations) {
      switch (operation.type) {
        case "addModifier":
          projection.push({ type: operation.type, value: toPlain(session.modifiers) });
          break;
        case "setMoney":
          projection.push({ type: operation.type, value: toPlain(session.money) });
          break;
        case "setBallCount":
          projection.push({
            type: operation.type,
            key: String(operation.key),
            value: toPlain(session.pokeballCounts?.[String(operation.key)]),
          });
          break;
        case "healParty":
          projection.push({
            type: operation.type,
            party: (session.party || []).map(pokemon => ({
              id: Number(pokemon.id),
              ...((operation.hp || operation.status) ? {
                hp: toPlain(pokemon.hp),
                status: toPlain(pokemon.status ?? null),
              } : {}),
              ...(operation.pp ? {
                ppUsed: (pokemon.moveset || []).map(move => toPlain(move?.ppUsed)),
              } : {}),
            })),
          });
          break;
        case "setFriendship": {
          const pokemon = findSavedPokemon(session, operation.pokemonId);
          projection.push({ type: operation.type, id: Number(pokemon.id), value: toPlain(pokemon.friendship) });
          break;
        }
        case "setPokerus": {
          const pokemon = findSavedPokemon(session, operation.pokemonId);
          projection.push({ type: operation.type, id: Number(pokemon.id), value: toPlain(pokemon.pokerus) });
          break;
        }
        case "setPauseEvolutions": {
          const pokemon = findSavedPokemon(session, operation.pokemonId);
          projection.push({ type: operation.type, id: Number(pokemon.id), value: toPlain(pokemon.pauseEvolutions) });
          break;
        }
        case "maxIvs": {
          const pokemon = findSavedPokemon(session, operation.pokemonId);
          projection.push({
            type: operation.type,
            id: Number(pokemon.id),
            ivs: toPlain(pokemon.ivs),
            stats: toPlain(pokemon.stats),
            hp: toPlain(pokemon.hp),
          });
          break;
        }
        case "setModifierStack": {
          const index = inspection.model.modifiers.findIndex(row => row.fingerprint === operation.fingerprint);
          if (index < 0 || !session.modifiers?.[index]) throw new Error("目标道具持久化条目已变化");
          projection.push({
            type: operation.type,
            index,
            stackCount: toPlain(session.modifiers[index].stackCount),
          });
          break;
        }
        case "renameRun":
          projection.push({ type: operation.type, value: String(session.name ?? "") });
          break;
        default:
          throw new Error(`无法验证持久化目标：${operation.type}`);
      }
    }
    return projection;
  }

  function collectTransitionDifferencePaths(before, after) {
    const paths = [];
    const visit = (left, right, path) => {
      if (Object.is(left, right)) return;
      const leftType = valueType(left);
      const rightType = valueType(right);
      if (leftType !== rightType || (leftType !== "array" && leftType !== "object")) {
        paths.push(path);
        return;
      }
      if (leftType === "array") {
        if (left.length !== right.length) {
          paths.push(path);
          return;
        }
        for (let index = 0; index < left.length; index += 1) {
          visit(left[index], right[index], [...path, index]);
        }
        return;
      }
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort()) {
        if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
          paths.push([...path, key]);
        } else {
          visit(left[key], right[key], [...path, key]);
        }
      }
    };
    visit(before, after, []);
    return paths;
  }

  function maskTransitionPaths(value, paths) {
    let masked = toPlain(value);
    const sentinel = { __roguesaveAuthorizedDifference__: true };
    for (const path of paths) {
      if (path.length === 0) {
        masked = sentinel;
        continue;
      }
      let parent = masked;
      let exists = true;
      for (let index = 0; index < path.length - 1; index += 1) {
        const key = path[index];
        if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) {
          exists = false;
          break;
        }
        parent = parent[key];
      }
      const finalKey = path[path.length - 1];
      if (exists && parent && typeof parent === "object" && Object.hasOwn(parent, finalKey)) {
        parent[finalKey] = sentinel;
      }
    }
    return masked;
  }

  function readTransitionPath(value, path) {
    let current = value;
    for (const key of path) {
      if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) {
        return { exists: false, value: null };
      }
      current = current[key];
    }
    return { exists: true, value: current };
  }

  function verifyNormalizedTransition(baselineSession, expectedSession, normalizedBaseline, normalizedExpected) {
    const canonicalBaseline = canonicalFullSession(baselineSession);
    const canonicalExpected = canonicalFullSession(expectedSession);
    const paths = collectTransitionDifferencePaths(canonicalBaseline, canonicalExpected);
    const canonicalNormalizedExpected = canonicalFullSession(normalizedExpected);
    for (const path of paths) {
      const rawTarget = readTransitionPath(canonicalExpected, path);
      const normalizedTarget = readTransitionPath(canonicalNormalizedExpected, path);
      if (rawTarget.exists !== normalizedTarget.exists
        || stableStringify(rawTarget.value) !== stableStringify(normalizedTarget.value)) {
        throw whitelistMismatchError(
          "游戏持久化解析器会改写已授权变化字段的精确结果",
          canonicalExpected,
          canonicalNormalizedExpected,
          "persist-normalization",
        );
      }
    }
    const maskedBaseline = maskTransitionPaths(canonicalFullSession(normalizedBaseline), paths);
    const maskedExpected = maskTransitionPaths(canonicalNormalizedExpected, paths);
    if (stableStringify(maskedBaseline) !== stableStringify(maskedExpected)) {
      throw whitelistMismatchError(
        "游戏持久化解析器会改写本次操作白名单之外的字段",
        maskedBaseline,
        maskedExpected,
        "persist-normalization",
      );
    }
  }

  async function buildPersistencePlan(gameData, baselineSession, expectedSession, operations, inspection) {
    const normalizedBaseline = normalizeExpectedPersistence(gameData, baselineSession);
    const normalizedBaselineTwice = normalizeExpectedPersistence(gameData, normalizedBaseline);
    if (canonicalFullString(normalizedBaseline) !== canonicalFullString(normalizedBaselineTwice)) {
      throw new Error("持久化规范化基线不具备确定幂等性");
    }
    const expectedPersisted = normalizeExpectedPersistence(gameData, expectedSession);
    const expectedPersistedTwice = normalizeExpectedPersistence(gameData, expectedPersisted);
    if (canonicalFullString(expectedPersisted) !== canonicalFullString(expectedPersistedTwice)) {
      throw new Error("修改后的持久化规范化结果不具备确定幂等性");
    }
    verifyNormalizedTransition(baselineSession, expectedSession, normalizedBaseline, expectedPersisted);
    const rawTargets = operationPersistenceProjection(expectedSession, operations, inspection);
    const normalizedTargets = operationPersistenceProjection(expectedPersisted, operations, inspection);
    if (stableStringify(rawTargets) !== stableStringify(normalizedTargets)) {
      throw whitelistMismatchError(
        "游戏持久化解析器会改写本次操作的目标值",
        rawTargets,
        normalizedTargets,
        "persist-normalization",
      );
    }
    return {
      expectedSession,
      expectedPersisted,
      expectedCanonical: canonicalFullString(expectedSession),
      expectedPersistedCanonical: canonicalFullString(expectedPersisted),
      expectedFullHash: await fullSessionHash(expectedSession),
      expectedPersistedHash: await fullSessionHash(expectedPersisted),
    };
  }

  async function persistAndVerify(scene, {
    plan,
    finalName,
    transactionGuard,
  }) {
    const gameData = scene.gameData;
    const slotId = Number(scene.sessionSlotId);
    const expectedFullHash = plan.expectedFullHash;
    const expectedPersisted = plan.expectedPersisted;
    const expectedBackendHash = plan.expectedPersistedHash;
    const expectedPersistedCanonical = plan.expectedPersistedCanonical;
    try {
      let saveResult = null;
      let renameResult = finalName ? false : true;
      try {
        saveResult = await gameData.saveAll(false, true);
      } catch {
        saveResult = null;
      }

      if (saveResult === true && finalName) {
        for (let attempt = 0; attempt < 2 && renameResult !== true; attempt += 1) {
          try {
            renameResult = await gameData.renameSession(slotId, finalName);
          } catch {
            renameResult = false;
          }
        }
      }

      let persisted = null;
      let persistedCanonical = null;
      let consecutiveExpectedReads = 0;
      for (let attempt = 0; attempt < 3 && consecutiveExpectedReads < 2; attempt += 1) {
        try {
          persisted = toPlain(await gameData.getSession(slotId));
          persistedCanonical = persisted ? canonicalFullString(persisted) : null;
        } catch {
          persisted = null;
          persistedCanonical = null;
        }
        consecutiveExpectedReads = persistedCanonical === expectedPersistedCanonical
          ? consecutiveExpectedReads + 1
          : 0;
      }

      let liveAfter = captureLiveSession(scene, finalName);
      let liveMatches = canonicalFullString(liveAfter) === plan.expectedCanonical;
      let guardSafe = transactionGuardMatches(scene, transactionGuard, false);
      let statusQueueSafe = getResetStatusPhaseState(scene) === "clear";
      const preliminaryVerified = saveResult === true
        && renameResult === true
        && consecutiveExpectedReads >= 2
        && liveMatches
        && guardSafe
        && statusQueueSafe;
      let afterHash = null;
      if (preliminaryVerified) {
        afterHash = await runtimeGuardHash(scene, expectedFullHash);
        try {
          persisted = toPlain(await gameData.getSession(slotId));
          persistedCanonical = persisted ? canonicalFullString(persisted) : null;
        } catch {
          persisted = null;
          persistedCanonical = null;
        }
        // Terminal barrier: after the final asynchronous cache read, all
        // remaining checks are synchronous and no game work can interleave.
        liveAfter = captureLiveSession(scene, finalName);
        liveMatches = canonicalFullString(liveAfter) === plan.expectedCanonical;
        guardSafe = transactionGuardMatches(scene, transactionGuard, false);
        statusQueueSafe = getResetStatusPhaseState(scene) === "clear";
      }

      if (preliminaryVerified
        && persistedCanonical === expectedPersistedCanonical
        && liveMatches
        && guardSafe
        && statusQueueSafe
        && afterHash) {
        return {
          status: "verified",
          message: "游戏已确认同步保存，且实时会话与规范化本地缓存回读均符合预期",
          afterHash,
          afterBackendHash: expectedBackendHash,
        };
      }

      const diagnostics = persisted && persistedCanonical !== expectedPersistedCanonical
        ? buildDifferenceDiagnostics(
            canonicalFullSession(expectedPersisted),
            canonicalFullSession(persisted),
            "persist-verify",
          )
        : null;
      const reason = !guardSafe
        ? "保存期间战斗阶段、回合或对局身份发生变化"
        : !statusQueueSafe
          ? "保存期间出现了待执行的异常状态恢复阶段"
          : saveResult !== true
            ? "游戏没有确认服务器同步保存成功"
            : renameResult !== true
              ? "对局名称的服务器同步结果无法确认"
              : persistedCanonical !== expectedPersistedCanonical || consecutiveExpectedReads < 2
                ? "规范化本地缓存的连续回读与预期不一致"
                : "实时会话在保存后与预期不一致";
      return {
        status: "uncertain",
        message: `${reason}；保存流程已经启动，因此未自动回滚运行态，请停止游戏并手动刷新核对`,
        ...(diagnostics ? { diagnostics } : {}),
      };
    } catch {
      return {
        status: "uncertain",
        message: "保存流程已经启动，但后续读取或校验发生异常；未自动回滚运行态，请停止游戏并手动刷新核对",
      };
    }
  }

  async function commit(scene, payload) {
    const txId = String(payload?.txId || "");
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(txId)) {
      return errorResult("INVALID_TX", "事务编号无效");
    }
    window[TX_RESULTS_KEY] ||= new Map();
    if (window[TX_RESULTS_KEY].has(txId)) {
      return window[TX_RESULTS_KEY].get(txId);
    }
    if (window[COMMIT_LOCK_KEY]) {
      return errorResult("BUSY", "另一个保存事务正在进行，请稍后刷新");
    }
    window[COMMIT_LOCK_KEY] = true;
    let releaseInput = null;
    let runtimeBackup = null;
    let runtimeTouchPlan = null;
    let originalSession = null;
    let operations = null;
    let mutationStarted = false;
    let persistenceStarted = false;
    let transactionGuard = null;
    try {
      const inspection = await inspectScene(scene);
      if (inspection.model.readOnly) {
        return errorResult("READ_ONLY", inspection.model.readOnlyReason || "当前版本只读");
      }
      if (inspection.model.hash !== String(payload.expectedHash || "")) {
        return errorResult("STALE", "预览后游戏状态已经变化，请刷新并重新预览", {
          currentHash: inspection.model.hash,
        });
      }
      if (inspection.model.backendHash !== String(payload.expectedBackendHash || "")) {
        return errorResult("BACKEND_STALE", "持久化存档已被另一标签页或自动保存改变，请刷新后重新预览");
      }

      transactionGuard = captureTransactionGuard(scene);
      releaseInput = lockGameInput(scene);
      const lockedInspection = await inspectScene(scene);
      if (lockedInspection.model.hash !== inspection.model.hash
        || lockedInspection.model.backendHash !== inspection.model.backendHash) {
        return errorResult("STALE", "锁定输入前游戏状态发生变化，请刷新后重新预览");
      }
      requireClearResetStatusPhaseQueue(scene, "锁定输入后");

      operations = toPlain(payload.operations);
      try {
        preflightOperations(scene, operations, inspection);
      } catch (error) {
        return errorResult("APPLY_FAILED", error?.message || "修改预检失败");
      }
      try {
        requireExactLiveSession(
          scene,
          lockedInspection.backup.session,
          lockedInspection.model.run.name,
          "pre-mutation-cas",
          "修改前实时会话在锁定期间发生变化",
        );
      } catch (error) {
        return errorResult("STALE", `${error?.message || "修改前实时会话发生变化"}；请刷新并重新预览`, diagnosticExtra(error));
      }
      if (!transactionGuardMatches(scene, transactionGuard, false)) {
        return errorResult("STALE", "修改前战斗阶段发生变化，请刷新并重新预览");
      }
      requireClearResetStatusPhaseQueue(scene, "正式修改前");
      runtimeBackup = captureRuntime(scene);
      originalSession = lockedInspection.backup.session;
      runtimeTouchPlan = buildRuntimeTouchPlan(operations, originalSession, runtimeBackup);
      let applied;
      mutationStarted = true;
      try {
        applied = await applyOperations(scene, operations, inspection);
      } catch (error) {
        const rollback = await rollbackBeforePersistence(
          scene,
          runtimeBackup,
          runtimeTouchPlan,
          originalSession,
          inspection.model.backendHash,
          transactionGuard,
        );
        return rollback.status === "restored"
          ? errorResult("APPLY_FAILED", `${error?.message || "应用修改失败"}；运行态已回滚`)
          : errorResult("UNCERTAIN", `${error?.message || "应用修改失败"}；持久化缓存或运行态无法证明保持原状`, { status: "uncertain" });
      }
      if (!transactionGuardMatches(scene, transactionGuard, false)) {
        return errorResult("UNCERTAIN", "应用修改后战斗阶段发生变化；已停止且未继续回滚", { status: "uncertain" });
      }
      if (getResetStatusPhaseState(scene) !== "clear") {
        return errorResult("UNCERTAIN", "应用修改后出现或无法确认异常状态恢复阶段；已停止且未继续回滚", { status: "uncertain" });
      }

      const liveAfter = toPlain(scene.gameData.getSessionSaveData());
      liveAfter.name = applied.finalName;
      let expectedSession;
      let persistencePlan;
      try {
        expectedSession = buildExpectedCommitSession(originalSession, liveAfter, operations, inspection, applied.finalName, applied.ivStatsById);
        persistencePlan = await buildPersistencePlan(
          scene.gameData,
          originalSession,
          expectedSession,
          operations,
          inspection,
        );
      } catch (error) {
        const rollback = await rollbackBeforePersistence(
          scene,
          runtimeBackup,
          runtimeTouchPlan,
          originalSession,
          inspection.model.backendHash,
          transactionGuard,
        );
        return rollback.status === "restored"
          ? errorResult(
              "UNEXPECTED_DIFF",
              `${error?.message || "检测到白名单之外的数据变化"}；已拒绝保存并回滚`,
              diagnosticExtra(error),
            )
          : errorResult(
              "UNCERTAIN",
              `${error?.message || "写入校验失败"}；无法证明运行态已完全回滚`,
              diagnosticExtra(error, { status: "uncertain" }),
            );
      }

      let persistedBeforeSave;
      try {
        persistedBeforeSave = toPlain(await scene.gameData.getSession(Number(scene.sessionSlotId)));
      } catch {
        return errorResult(
          "UNCERTAIN",
          "保存前无法重新读取本地持久化缓存；未调用保存且未继续回滚，请手动刷新核对",
          { status: "uncertain" },
        );
      }
      if (!persistedBeforeSave
        || await fullSessionHash(persistedBeforeSave) !== inspection.model.backendHash) {
        return errorResult(
          "BACKEND_STALE_AFTER_MUTATION",
          "应用修改后检测到本地持久化缓存已变化；可能存在自动保存，已停止且未继续回滚，请手动刷新核对",
          { status: "uncertain" },
        );
      }
      if (!transactionGuardMatches(scene, transactionGuard, false)) {
        return errorResult("UNCERTAIN", "正式保存前战斗阶段发生变化；已停止且未继续回滚", { status: "uncertain" });
      }
      if (getResetStatusPhaseState(scene) !== "clear") {
        return errorResult("UNCERTAIN", "正式保存前出现或无法确认异常状态恢复阶段；已停止且未继续回滚", { status: "uncertain" });
      }
      try {
        requireExactLiveSession(
          scene,
          persistencePlan.expectedSession,
          applied.finalName,
          "pre-persist-cas",
          "正式保存前实时会话与已验证修改结果不一致",
        );
      } catch (error) {
        const rollback = await rollbackBeforePersistence(
          scene,
          runtimeBackup,
          runtimeTouchPlan,
          originalSession,
          inspection.model.backendHash,
          transactionGuard,
        );
        return rollback.status === "restored"
          ? errorResult("UNEXPECTED_DIFF", `${error?.message || "正式保存前实时状态变化"}；已拒绝保存并回滚`, diagnosticExtra(error))
          : errorResult("UNCERTAIN", `${error?.message || "正式保存前实时状态变化"}；无法证明运行态已完全回滚`, diagnosticExtra(error, { status: "uncertain" }));
      }

      persistenceStarted = true;
      const result = await persistAndVerify(scene, {
        plan: persistencePlan,
        finalName: applied.finalName,
        transactionGuard,
      });
      const response = {
        ok: result.status === "verified",
        code: result.status === "verified" ? "VERIFIED" : result.status.toUpperCase(),
        status: result.status,
        message: result.message,
        adapterVersion: ADAPTER_VERSION,
        beforeHash: inspection.model.hash,
        afterHash: result.afterHash || null,
        afterBackendHash: result.afterBackendHash || null,
        slotId: inspection.model.run.slotId,
        waveIndex: inspection.model.run.waveIndex,
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      };
      window[TX_RESULTS_KEY].set(txId, response);
      while (window[TX_RESULTS_KEY].size > 20) {
        window[TX_RESULTS_KEY].delete(window[TX_RESULTS_KEY].keys().next().value);
      }
      return response;
    } catch (error) {
      if (persistenceStarted) {
        return errorResult(
          "UNCERTAIN",
          `${error?.message || "保存后处理异常"}；保存流程已经启动，未自动回滚运行态，请手动刷新核对`,
          { status: "uncertain" },
        );
      }
      if (mutationStarted && runtimeBackup && originalSession) {
        const rollback = await rollbackBeforePersistence(
          scene,
          runtimeBackup,
          runtimeTouchPlan,
          originalSession,
          String(payload.expectedBackendHash || ""),
          transactionGuard,
        );
        return rollback.status === "restored"
          ? errorResult("COMMIT_FAILED", `${error?.message || "提交失败"}；运行态已回滚`)
          : errorResult("UNCERTAIN", `${error?.message || "提交过程异常"}；无法确认持久化缓存或运行态保持原状`, { status: "uncertain" });
      }
      return errorResult("COMMIT_FAILED", error?.message || "无法开始提交");
    } finally {
      try {
        releaseInput?.();
      } catch {
        // Input restoration is best effort; the page will recover on refresh.
      }
      window[COMMIT_LOCK_KEY] = false;
    }
  }

  function restoreSavedStatus(pokemon, savedStatus, memberIndex = 0) {
    if (statusMatchesSaved(pokemon, savedStatus)) return;
    const plan = validateSavedStatusForRestore(pokemon, savedStatus, memberIndex);
    clearStatusImmediately(pokemon, memberIndex);
    if (!plan) return;

    pokemon.doSetStatus(plan.effect, plan.sleepTurns);
    if (!pokemon.status || Number(pokemon.status.effect) !== plan.effect) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的异常状态未能立即恢复`);
    }

    for (const key of ["toxicTurnCount", "sleepTurnsRemaining", "freezeTurnsRemaining"]) {
      if (!Object.hasOwn(savedStatus, key)) continue;
      pokemon.status[key] = Number(savedStatus[key]);
    }
    if (!statusMatchesSaved(pokemon, savedStatus)) {
      throw new Error(`队伍成员 ${memberIndex + 1} 的异常状态无法精确重建`);
    }
  }

  function buildExpectedUndoSession(currentSession, beforeSession, actualSession, targetOperations, inspection) {
    const expected = toPlain(currentSession);
    const before = toPlain(beforeSession);
    const actual = toPlain(actualSession);
    const beforeById = new Map((before.party || []).map(pokemon => [Number(pokemon.id), pokemon]));

    for (const operation of targetOperations) {
      switch (operation.type) {
        case "addModifier":
          expected.modifiers = toPlain(before.modifiers);
          break;
        case "setMoney":
          expected.money = before.money;
          break;
        case "setBallCount":
          expected.pokeballCounts[String(operation.key)] = before.pokeballCounts?.[String(operation.key)];
          break;
        case "healParty":
          for (const expectedPokemon of expected.party || []) {
            const saved = beforeById.get(Number(expectedPokemon.id));
            if (!saved) throw new Error("备份队伍结构与当前队伍不一致");
            const wasFainted = Number(saved.hp) === 0;
            if (operation.hp || (operation.status && wasFainted)) expectedPokemon.hp = saved.hp;
            if (operation.status || (operation.hp && wasFainted)) expectedPokemon.status = toPlain(saved.status);
            if (operation.pp) {
              expectedPokemon.moveset = (expectedPokemon.moveset || []).map((move, index) => ({
                ...move,
                ppUsed: saved.moveset?.[index]?.ppUsed ?? 0,
              }));
            }
          }
          break;
        case "setFriendship":
          findSavedPokemon(expected, operation.pokemonId).friendship = findSavedPokemon(before, operation.pokemonId).friendship;
          break;
        case "setPokerus":
          findSavedPokemon(expected, operation.pokemonId).pokerus = findSavedPokemon(before, operation.pokemonId).pokerus;
          break;
        case "setPauseEvolutions":
          findSavedPokemon(expected, operation.pokemonId).pauseEvolutions = findSavedPokemon(before, operation.pokemonId).pauseEvolutions;
          break;
        case "maxIvs": {
          const target = findSavedPokemon(expected, operation.pokemonId);
          const saved = findSavedPokemon(before, operation.pokemonId);
          target.ivs = toPlain(saved.ivs);
          target.stats = toPlain(saved.stats);
          target.hp = saved.hp;
          break;
        }
        case "setModifierStack": {
          const index = inspection.model.modifiers.findIndex(row => row.fingerprint === operation.fingerprint);
          if (index < 0 || !expected.modifiers?.[index] || !before.modifiers?.[index]) {
            throw new Error("备份道具结构与当前存档不一致");
          }
          expected.modifiers[index].stackCount = before.modifiers[index].stackCount;
          break;
        }
        case "renameRun":
          expected.name = String(before.name ?? "");
          break;
        default:
          throw new Error(`备份包含不支持的修改类型：${operation.type}`);
      }
    }

    if (targetOperations.some(operation => ["setModifierStack", "addModifier"].includes(operation.type))) {
      for (const expectedPokemon of expected.party || []) {
        expectedPokemon.stats = toPlain(beforeById.get(Number(expectedPokemon.id))?.stats);
        expectedPokemon.hp = beforeById.get(Number(expectedPokemon.id))?.hp;
      }
    }
    actual.name = String(expected.name ?? currentSession.name ?? "");
    const canonicalExpected = canonicalFullSession(expected);
    const canonicalActual = canonicalFullSession(actual);
    if (stableStringify(canonicalExpected) !== stableStringify(canonicalActual)) {
      throw whitelistMismatchError(
        "撤销后的实际变化与目标事务的精确逆操作不一致",
        canonicalExpected,
        canonicalActual,
        "undo-whitelist",
      );
    }
    return expected;
  }

  function preflightBackupSafeState(scene, beforeSession, targetOperations, inspection) {
    preflightOperations(scene, targetOperations, inspection, true);
    const party = getParty(scene);
    const savedParty = Array.isArray(beforeSession?.party) ? beforeSession.party : [];
    const savedById = new Map(savedParty.map(pokemon => [Number(pokemon.id), pokemon]));
    if (party.length !== savedParty.length || savedById.size !== party.length) {
      throw new Error("队伍长度或 ID 已变化，无法撤销");
    }

    const heal = targetOperations.find(operation => operation.type === "healParty");
    const modifiersChanged = targetOperations.some(operation => ["setModifierStack", "addModifier"].includes(operation.type));
    const maxIvIds = new Set(targetOperations.filter(operation => operation.type === "maxIvs").map(operation => Number(operation.pokemonId)));
    const friendshipIds = new Set(targetOperations.filter(operation => operation.type === "setFriendship").map(operation => Number(operation.pokemonId)));
    const pokerusIds = new Set(targetOperations.filter(operation => operation.type === "setPokerus").map(operation => Number(operation.pokemonId)));
    const evolutionIds = new Set(targetOperations.filter(operation => operation.type === "setPauseEvolutions").map(operation => Number(operation.pokemonId)));

    for (const operation of targetOperations) {
      if (operation.type === "setMoney") {
        requireInteger(Number(beforeSession.money), 0, MAX_MONEY, "备份金钱");
      } else if (operation.type === "setBallCount") {
        const key = String(operation.key);
        requireInteger(Number(beforeSession.pokeballCounts?.[key]), 0, MAX_BALL_COUNT, `${BALL_LABELS[key]}备份数量`);
      }
    }

    for (const [memberIndex, pokemon] of party.entries()) {
      const saved = savedById.get(Number(pokemon.id));
      if (!saved) throw new Error(`备份中找不到队伍成员 ${memberIndex + 1}`);
      const moves = getMoves(pokemon);
      const savedMoves = Array.isArray(saved.moveset) ? saved.moveset : [];
      if (moves.length !== savedMoves.length
        || moves.some((move, index) => Number(move.moveId) !== Number(savedMoves[index]?.moveId))) {
        throw new Error(`队伍成员 ${memberIndex + 1} 的技能组已变化，无法撤销`);
      }
      if (maxIvIds.has(pokemon.id)) {
        if (!Array.isArray(saved.ivs) || saved.ivs.length !== 6
          || saved.ivs.some(iv => !Number.isInteger(iv) || iv < 0 || iv > 31)
          || !Array.isArray(saved.stats) || saved.stats.length !== 6
          || saved.stats.some(value => !Number.isSafeInteger(Number(value)))
          || typeof pokemon.calculateStats !== "function") {
          throw new Error(`队伍成员 ${memberIndex + 1} 的备份个体值或属性无效`);
        }
      }
      if (friendshipIds.has(pokemon.id)) {
        requireInteger(Number(saved.friendship), 0, MAX_FRIENDSHIP, "备份亲密度");
      }
      if (pokerusIds.has(pokemon.id) && typeof saved.pokerus !== "boolean") {
        throw new Error(`队伍成员 ${memberIndex + 1} 的备份宝可病毒值无效`);
      }
      if (evolutionIds.has(pokemon.id) && typeof saved.pauseEvolutions !== "boolean") {
        throw new Error(`队伍成员 ${memberIndex + 1} 的备份暂停进化值无效`);
      }

      const wasFainted = Number(saved.hp) === 0;
      if (modifiersChanged || maxIvIds.has(pokemon.id) || heal?.hp || (heal?.status && wasFainted)) {
        const maxHp = modifiersChanged ? Number(saved.stats?.[0]) : Number(pokemon.getMaxHp?.() ?? pokemon.stats?.[0]);
        requireInteger(maxHp, 1, Number.MAX_SAFE_INTEGER, "备份最大 HP");
        requireInteger(Number(saved.hp), 0, maxHp, "备份 HP");
      }
      if ((heal?.status || (heal?.hp && wasFainted)) && !statusMatchesSaved(pokemon, saved.status)) {
        validateSavedStatusForRestore(pokemon, saved.status, memberIndex);
      }
      if (heal?.pp) {
        for (const move of savedMoves) {
          if (!Number.isSafeInteger(Number(move?.ppUsed)) || Number(move.ppUsed) < 0) {
            throw new Error(`队伍成员 ${memberIndex + 1} 的备份 PP 使用量无效`);
          }
        }
      }
    }

    const modifierOperations = targetOperations.filter(operation => operation.type === "setModifierStack");
    if (modifierOperations.length > 0) {
      const liveSession = toPlain(scene.gameData.getSessionSaveData());
      const currentRows = getModifierRows(scene, liveSession, getPartyRows(scene));
      const runtimeModifiers = getRuntimeModifiers(scene);
      for (const operation of modifierOperations) {
        const index = inspection.model.modifiers.findIndex(row => row.fingerprint === operation.fingerprint);
        const row = currentRows[index];
        const saved = beforeSession.modifiers?.[index];
        if (index < 0 || !row?.editable || !runtimeModifiers[index] || !saved
          || row.fingerprint !== modifierFingerprint(saved, index)) {
          throw new Error("目标道具结构已变化，无法撤销");
        }
        requireInteger(Number(saved.stackCount), 1, row.maxStackCount, "备份道具层数");
      }
    }
  }

  async function applyBackupSafeState(scene, beforeSession, targetOperations, inspection) {
    preflightBackupSafeState(scene, beforeSession, targetOperations, inspection);
    const party = getParty(scene);
    const savedParty = Array.isArray(beforeSession.party) ? beforeSession.party : [];
    const savedById = new Map(savedParty.map(pokemon => [Number(pokemon.id), pokemon]));
    if (party.length !== savedParty.length || savedById.size !== party.length) {
      throw new Error("队伍长度或 ID 已变化，无法撤销");
    }

    const heal = targetOperations.find(operation => operation.type === "healParty");
    const maxIvIds = new Set(targetOperations.filter(operation => operation.type === "maxIvs").map(operation => Number(operation.pokemonId)));
    const modifierOperations = targetOperations.filter(operation => operation.type === "setModifierStack");
    const friendshipIds = new Set(targetOperations.filter(operation => operation.type === "setFriendship").map(operation => Number(operation.pokemonId)));
    const pokerusIds = new Set(targetOperations.filter(operation => operation.type === "setPokerus").map(operation => Number(operation.pokemonId)));
    const evolutionIds = new Set(targetOperations.filter(operation => operation.type === "setPauseEvolutions").map(operation => Number(operation.pokemonId)));

    for (const operation of targetOperations) {
      if (operation.type === "setMoney") {
        scene.money = requireInteger(Number(beforeSession.money), 0, MAX_MONEY, "备份金钱");
      } else if (operation.type === "setBallCount") {
        const key = String(operation.key);
        if (!Object.hasOwn(BALL_LABELS, key)) throw new Error("备份精灵球键无效");
        scene.pokeballCounts[key] = requireInteger(Number(beforeSession.pokeballCounts?.[key]), 0, MAX_BALL_COUNT, `${BALL_LABELS[key]}备份数量`);
      }
    }

    const changedPokemon = new Set();
    for (const [memberIndex, pokemon] of party.entries()) {
      const saved = savedById.get(pokemon.id);
      if (!saved) throw new Error(`备份中找不到队伍成员 ${memberIndex + 1}`);
      const moves = getMoves(pokemon);
      const savedMoves = Array.isArray(saved.moveset) ? saved.moveset : [];
      if (moves.length !== savedMoves.length || moves.some((move, index) => Number(move.moveId) !== Number(savedMoves[index]?.moveId))) {
        throw new Error(`队伍成员 ${memberIndex + 1} 的技能组已变化，无法撤销`);
      }
      if (maxIvIds.has(pokemon.id)) {
        if (!Array.isArray(saved.ivs) || saved.ivs.length !== 6
          || saved.ivs.some(iv => !Number.isInteger(iv) || iv < 0 || iv > 31)
          || typeof pokemon.calculateStats !== "function") {
          throw new Error(`队伍成员 ${memberIndex + 1} 的备份个体值无效`);
        }
        pokemon.ivs = saved.ivs.map(Number);
        pokemon.calculateStats();
        changedPokemon.add(pokemon);
      }
      if (friendshipIds.has(pokemon.id)) {
        pokemon.friendship = requireInteger(Number(saved.friendship), 0, MAX_FRIENDSHIP, "备份亲密度");
        changedPokemon.add(pokemon);
      }
      if (pokerusIds.has(pokemon.id)) {
        pokemon.pokerus = saved.pokerus;
        changedPokemon.add(pokemon);
      }
      if (evolutionIds.has(pokemon.id)) {
        pokemon.pauseEvolutions = saved.pauseEvolutions;
        changedPokemon.add(pokemon);
      }
    }

    let modifiersChanged = false;
    if (targetOperations.some(operation => operation.type === "addModifier")) {
      const current = getRuntimeModifiers(scene);
      const restored = (beforeSession.modifiers || []).map((saved, index) => {
        const modifier = current[index];
        if (!modifier || modifier.type.id !== saved.typeId
          || stableStringify(modifier.getArgs?.() || []) !== stableStringify(saved.args || [])) throw new Error("备份道具结构已变化，无法撤销新增道具");
        modifier.stackCount = saved.stackCount;
        return modifier;
      });
      scene.modifiers.splice(0, scene.modifiers.length, ...restored);
      modifiersChanged = true;
    }
    if (modifierOperations.length > 0) {
      const liveSession = toPlain(scene.gameData.getSessionSaveData());
      const currentRows = getModifierRows(scene, liveSession, getPartyRows(scene));
      const runtimeModifiers = getRuntimeModifiers(scene);
      for (const operation of modifierOperations) {
        const index = inspection.model.modifiers.findIndex(row => row.fingerprint === operation.fingerprint);
        const row = currentRows[index];
        const saved = beforeSession.modifiers?.[index];
        if (index < 0 || !row?.editable || !saved
          || row.fingerprint !== modifierFingerprint(saved, index)) {
          throw new Error("目标道具结构已变化，无法撤销");
        }
        const target = requireInteger(Number(saved.stackCount), 1, row.maxStackCount, "备份道具层数");
        runtimeModifiers[index].stackCount = target;
        modifiersChanged = true;
      }
    }

    await refreshRuntimeUi(scene, new Set(), modifiersChanged);

    const verifyStatsForAll = modifiersChanged;
    for (const [memberIndex, pokemon] of party.entries()) {
      const saved = savedById.get(pokemon.id);
      if (verifyStatsForAll || maxIvIds.has(pokemon.id)) {
        const actualStats = Array.isArray(pokemon.stats) ? pokemon.stats.map(Number) : [];
        if (!Array.isArray(saved.stats) || saved.stats.length !== actualStats.length
          || saved.stats.some((value, index) => Number(value) !== actualStats[index])) {
          throw new Error(`队伍成员 ${memberIndex + 1} 的属性重算结果与备份不一致`);
        }
      }
      const wasFainted = Number(saved.hp) === 0;
      if (modifiersChanged || maxIvIds.has(pokemon.id) || heal?.hp || (heal?.status && wasFainted)) {
        const maxHp = Number(pokemon.getMaxHp?.() ?? pokemon.stats?.[0]);
        pokemon.hp = requireInteger(Number(saved.hp), 0, maxHp, "备份 HP");
        changedPokemon.add(pokemon);
      }
      if (heal?.status || (heal?.hp && wasFainted)) {
        if (!statusMatchesSaved(pokemon, saved.status)) {
          restoreSavedStatus(pokemon, saved.status, memberIndex);
          changedPokemon.add(pokemon);
        }
      }
      if (heal?.pp) {
        getMoves(pokemon).forEach((move, index) => {
          const ppUsed = Number(saved.moveset?.[index]?.ppUsed ?? 0);
          if (!Number.isSafeInteger(ppUsed) || ppUsed < 0) throw new Error("备份 PP 使用量无效");
          move.ppUsed = ppUsed;
        });
        changedPokemon.add(pokemon);
      }
    }
    await refreshRuntimeUi(scene, changedPokemon, false);
  }

  async function undo(scene, payload) {
    const txId = String(payload?.txId || "");
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(txId)) return errorResult("INVALID_TX", "撤销事务编号无效");
    window[TX_RESULTS_KEY] ||= new Map();
    if (window[TX_RESULTS_KEY].has(txId)) return window[TX_RESULTS_KEY].get(txId);
    if (window[COMMIT_LOCK_KEY]) return errorResult("BUSY", "另一个保存事务正在进行，请稍后刷新");

    window[COMMIT_LOCK_KEY] = true;
    let releaseInput = null;
    let runtimeBackup = null;
    let runtimeTouchPlan = null;
    let originalSession = null;
    let targetOperations = null;
    let beforeSession = null;
    let mutationStarted = false;
    let persistenceStarted = false;
    let transactionGuard = null;
    try {
      const inspection = await inspectScene(scene);
      if (inspection.model.readOnly) return errorResult("READ_ONLY", inspection.model.readOnlyReason);
      if (inspection.model.hash !== String(payload.expectedHash || "")
        || inspection.model.backendHash !== String(payload.expectedBackendHash || "")) {
        return errorResult("STALE", "游戏或持久化存档已在修改后继续变化，为防止覆盖进度，已禁止撤销");
      }
      beforeSession = toPlain(payload.beforeSession);
      targetOperations = toPlain(payload.targetOperations ?? payload.operations);
      validateOperationSet(targetOperations);
      if (!beforeSession || normalizeVersion(beforeSession.gameVersion) !== getVersion(scene)) {
        return errorResult("VERSION_MISMATCH", "备份与当前游戏版本不一致");
      }
      if (await fullSessionHash(beforeSession) !== String(payload.expectedBeforeFullHash || "")) {
        return errorResult("BACKUP_CORRUPT", "事务备份完整哈希校验失败，已禁止撤销");
      }
      if (Number(beforeSession.waveIndex) !== Number(scene.currentBattle.waveIndex)
        || String(beforeSession.seed ?? "") !== String(scene.seed ?? "")) {
        return errorResult("RUN_MISMATCH", "备份不属于当前波数或当前对局");
      }

      transactionGuard = captureTransactionGuard(scene);
      releaseInput = lockGameInput(scene);
      const lockedInspection = await inspectScene(scene);
      if (lockedInspection.model.hash !== inspection.model.hash
        || lockedInspection.model.backendHash !== inspection.model.backendHash) {
        return errorResult("STALE", "锁定输入前游戏状态发生变化，已禁止撤销");
      }
      requireClearResetStatusPhaseQueue(scene, "锁定输入后");

      try {
        preflightBackupSafeState(scene, beforeSession, targetOperations, inspection);
      } catch (error) {
        return errorResult("UNDO_APPLY_FAILED", error?.message || "撤销预检失败");
      }

      try {
        requireExactLiveSession(
          scene,
          lockedInspection.backup.session,
          lockedInspection.model.run.name,
          "pre-mutation-cas",
          "撤销前实时会话在锁定期间发生变化",
        );
      } catch (error) {
        return errorResult("STALE", `${error?.message || "撤销前实时会话发生变化"}；已禁止撤销`, diagnosticExtra(error));
      }
      if (!transactionGuardMatches(scene, transactionGuard, false)) {
        return errorResult("STALE", "撤销前战斗阶段发生变化，已禁止撤销");
      }
      requireClearResetStatusPhaseQueue(scene, "正式撤销前");

      runtimeBackup = captureRuntime(scene);
      originalSession = lockedInspection.backup.session;
      runtimeTouchPlan = buildRuntimeTouchPlan(targetOperations, beforeSession, runtimeBackup);
      mutationStarted = true;
      try {
        await applyBackupSafeState(scene, beforeSession, targetOperations, inspection);
      } catch (error) {
        const rollback = await rollbackBeforePersistence(
          scene,
          runtimeBackup,
          runtimeTouchPlan,
          originalSession,
          inspection.model.backendHash,
          transactionGuard,
        );
        return rollback.status === "restored"
          ? errorResult("UNDO_APPLY_FAILED", `${error?.message || "撤销校验失败"}；当前运行态已恢复`)
          : errorResult("UNCERTAIN", `${error?.message || "撤销校验失败"}；持久化缓存或运行态无法证明保持撤销前状态`, { status: "uncertain" });
      }
      if (!transactionGuardMatches(scene, transactionGuard, false)) {
        return errorResult("UNCERTAIN", "应用撤销后战斗阶段发生变化；已停止且未继续回滚", { status: "uncertain" });
      }
      if (getResetStatusPhaseState(scene) !== "clear") {
        return errorResult("UNCERTAIN", "应用撤销后出现或无法确认异常状态恢复阶段；已停止且未继续回滚", { status: "uncertain" });
      }

      let expectedSession;
      let persistencePlan;
      const finalName = String(beforeSession.name ?? "");
      try {
        const actual = toPlain(scene.gameData.getSessionSaveData());
        expectedSession = buildExpectedUndoSession(originalSession, beforeSession, actual, targetOperations, inspection);
        persistencePlan = await buildPersistencePlan(
          scene.gameData,
          originalSession,
          expectedSession,
          targetOperations,
          inspection,
        );
      } catch (error) {
        const rollback = await rollbackBeforePersistence(
          scene,
          runtimeBackup,
          runtimeTouchPlan,
          originalSession,
          inspection.model.backendHash,
          transactionGuard,
        );
        return rollback.status === "restored"
          ? errorResult(
              "UNEXPECTED_DIFF",
              `${error?.message || "撤销精确差异校验失败"}；已回滚`,
              diagnosticExtra(error),
            )
          : errorResult(
              "UNCERTAIN",
              `${error?.message || "撤销校验失败"}；无法证明运行态已回滚`,
              diagnosticExtra(error, { status: "uncertain" }),
            );
      }

      let persistedBeforeSave;
      try {
        persistedBeforeSave = toPlain(await scene.gameData.getSession(Number(scene.sessionSlotId)));
      } catch {
        return errorResult(
          "UNCERTAIN",
          "撤销保存前无法重新读取本地持久化缓存；未调用保存且未继续回滚，请手动刷新核对",
          { status: "uncertain" },
        );
      }
      if (!persistedBeforeSave
        || await fullSessionHash(persistedBeforeSave) !== inspection.model.backendHash) {
        return errorResult(
          "BACKEND_STALE_AFTER_MUTATION",
          "应用撤销后检测到本地持久化缓存已变化；可能存在自动保存，已停止且未继续回滚，请手动刷新核对",
          { status: "uncertain" },
        );
      }
      if (!transactionGuardMatches(scene, transactionGuard, false)) {
        return errorResult("UNCERTAIN", "撤销正式保存前战斗阶段发生变化；已停止且未继续回滚", { status: "uncertain" });
      }
      if (getResetStatusPhaseState(scene) !== "clear") {
        return errorResult("UNCERTAIN", "撤销正式保存前出现或无法确认异常状态恢复阶段；已停止且未继续回滚", { status: "uncertain" });
      }
      try {
        requireExactLiveSession(
          scene,
          persistencePlan.expectedSession,
          finalName,
          "pre-persist-cas",
          "撤销正式保存前实时会话与已验证撤销结果不一致",
        );
      } catch (error) {
        const rollback = await rollbackBeforePersistence(
          scene,
          runtimeBackup,
          runtimeTouchPlan,
          originalSession,
          inspection.model.backendHash,
          transactionGuard,
        );
        return rollback.status === "restored"
          ? errorResult("UNEXPECTED_DIFF", `${error?.message || "撤销保存前实时状态变化"}；已拒绝保存并恢复撤销前状态`, diagnosticExtra(error))
          : errorResult("UNCERTAIN", `${error?.message || "撤销保存前实时状态变化"}；无法证明运行态已恢复撤销前状态`, diagnosticExtra(error, { status: "uncertain" }));
      }

      persistenceStarted = true;
      const result = await persistAndVerify(scene, {
        plan: persistencePlan,
        finalName,
        transactionGuard,
      });
      const response = {
        ok: result.status === "verified",
        code: result.status === "verified" ? "VERIFIED" : result.status.toUpperCase(),
        status: result.status,
        message: result.status === "verified" ? "已安全撤销目标修改，游戏确认同步保存且缓存/实时校验通过" : result.message,
        adapterVersion: ADAPTER_VERSION,
        slotId: inspection.model.run.slotId,
        waveIndex: inspection.model.run.waveIndex,
        afterHash: result.afterHash || null,
        afterBackendHash: result.afterBackendHash || null,
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      };
      window[TX_RESULTS_KEY].set(txId, response);
      while (window[TX_RESULTS_KEY].size > 20) {
        window[TX_RESULTS_KEY].delete(window[TX_RESULTS_KEY].keys().next().value);
      }
      return response;
    } catch (error) {
      if (persistenceStarted) {
        return errorResult(
          "UNCERTAIN",
          `${error?.message || "撤销保存后处理异常"}；保存流程已经启动，未自动回滚运行态，请手动刷新核对`,
          { status: "uncertain" },
        );
      }
      if (mutationStarted && runtimeBackup && originalSession) {
        const rollback = await rollbackBeforePersistence(
          scene,
          runtimeBackup,
          runtimeTouchPlan,
          originalSession,
          String(payload.expectedBackendHash || ""),
          transactionGuard,
        );
        return rollback.status === "restored"
          ? errorResult("UNDO_FAILED", `${error?.message || "撤销失败"}；运行态已恢复`)
          : errorResult("UNCERTAIN", `${error?.message || "撤销过程异常"}；无法确认持久化缓存或运行态保持撤销前状态`, { status: "uncertain" });
      }
      return errorResult("UNDO_FAILED", error?.message || "无法开始撤销");
    } finally {
      try { releaseInput?.(); } catch { /* Page refresh restores input. */ }
      window[COMMIT_LOCK_KEY] = false;
    }
  }

  async function addLegendaryEggs(scene, payload) {
    const txId = String(payload?.txId || "");
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(txId)) {
      return errorResult("INVALID_TX", "事务编号无效");
    }
    window[TX_RESULTS_KEY] ||= new Map();
    if (window[TX_RESULTS_KEY].has(txId)) return window[TX_RESULTS_KEY].get(txId);
    if (window[COMMIT_LOCK_KEY]) return errorResult("BUSY", "另一个保存任务正在进行");

    const source = String(payload?.source || "");
    const sourceType = LEGENDARY_EGG_SOURCE_TYPES[source];
    if (!Number.isInteger(sourceType)) return errorResult("INVALID_SOURCE", "请选择有效的官方扭蛋机");
    const count = Number(payload?.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_LEGENDARY_EGGS_PER_ACTION) {
      return errorResult("INVALID_COUNT", `一次只能添加 1–${MAX_LEGENDARY_EGGS_PER_ACTION} 枚传说蛋`);
    }

    const account = accountEggModel(scene);
    if (!account.canAddLegendaryEggs) {
      return errorResult("ACCOUNT_READ_ONLY", account.readOnlyReason || "当前账号数据不可修改");
    }
    if (account.eggCount + count > MAX_ACCOUNT_EGGS) {
      return errorResult(
        "EGG_LIMIT",
        `蛋列表最多保存 ${MAX_ACCOUNT_EGGS} 枚；当前 ${account.eggCount} 枚，最多还能添加 ${MAX_ACCOUNT_EGGS - account.eggCount} 枚`,
      );
    }

    window[COMMIT_LOCK_KEY] = true;
    let releaseInput = null;
    const gameData = scene.gameData;
    const handler = findEggGachaHandler(scene);
    const originalEggs = gameData.eggs.slice();
    const originalEggPity = Array.isArray(gameData.eggPity) ? gameData.eggPity.slice() : null;
    const originalUnlockPity = Array.isArray(gameData.unlockPity) ? gameData.unlockPity.slice() : null;
    const originalEggsPulled = Number(gameData.gameStats?.eggsPulled ?? 0);
    const originalLegendaryEggsPulled = Number(gameData.gameStats?.legendaryEggsPulled ?? 0);
    const originalCursor = handler.gachaCursor;
    const hadOwnGuarantee = Object.hasOwn(handler, "getGuaranteedEggTierFromPullCount");
    const originalGuarantee = handler.getGuaranteedEggTierFromPullCount;
    const originalCache = typeof localStorage === "undefined" ? null : captureSystemCache();
    const guard = captureTransactionGuard(scene);
    let persistenceStarted = false;
    const rollbackRuntime = () => {
      restoreArray(gameData.eggs, originalEggs);
      restoreArray(gameData.eggPity, originalEggPity);
      restoreArray(gameData.unlockPity, originalUnlockPity);
      if (gameData.gameStats) {
        gameData.gameStats.eggsPulled = originalEggsPulled;
        gameData.gameStats.legendaryEggsPulled = originalLegendaryEggsPulled;
      }
    };

    try {
      requireStablePhase(scene);
      releaseInput = lockGameInput(scene);
      handler.gachaCursor = sourceType;
      handler.getGuaranteedEggTierFromPullCount = () => LEGENDARY_EGG_TIER;

      const generated = [];
      for (let index = 0; index < count; index += 1) {
        const pulled = handler.pullEggs(1);
        if (!Array.isArray(pulled) || pulled.length !== 1) throw new Error("官方抽蛋流程没有返回唯一结果");
        const egg = pulled[0];
        if (Number(egg?.tier) !== LEGENDARY_EGG_TIER || Number(egg?.hatchWaves) !== 100) {
          throw new Error("官方抽蛋结果不是标准 100 波传说蛋");
        }
        generated.push(egg);
      }
      if (gameData.eggs.length !== originalEggs.length + count) {
        throw new Error("蛋列表数量与本次添加数量不一致");
      }

      persistenceStarted = true;
      const saved = await gameData.saveSystem();
      if (saved !== true) throw new Error("游戏没有确认账号系统存档保存成功");
      if (scene.gameData !== gameData || !transactionGuardMatches(scene, guard)
        || generated.some(egg => !gameData.eggs.includes(egg))) throw new Error("保存期间游戏或蛋列表发生变化");

      const afterSystem = typeof gameData.getSystemSaveData === "function" ? systemSnapshot(scene) : null;
      const response = {
        ok: true,
        code: "VERIFIED",
        status: "verified",
        adapterVersion: ADAPTER_VERSION,
        message: `已添加 ${count} 枚随机传说蛋；内容将在正常孵化时揭晓`,
        account: {
          eggCount: gameData.eggs.length,
          maxEggs: MAX_ACCOUNT_EGGS,
          added: count,
          source,
          hatchWaves: 100,
        },
        ...(afterSystem ? { afterSystem, afterSystemJson: JSON.stringify(afterSystem) } : {}),
      };
      window[TX_RESULTS_KEY].set(txId, response);
      while (window[TX_RESULTS_KEY].size > 20) {
        window[TX_RESULTS_KEY].delete(window[TX_RESULTS_KEY].keys().next().value);
      }
      return response;
    } catch (error) {
      rollbackRuntime();
      try { if (originalCache) restoreSystemCache(originalCache); } catch {
        return errorResult("UNCERTAIN", "账号缓存恢复失败，请重新载入并核对", { status: "uncertain" });
      }
      return errorResult(persistenceStarted ? "UNCERTAIN" : "ADD_EGGS_FAILED", `${error?.message || "添加传说蛋失败"}；本地变化已撤销${persistenceStarted ? "，服务器结果待确认" : ""}`, { status: persistenceStarted ? "uncertain" : "failed" });
    } finally {
      handler.gachaCursor = originalCursor;
      if (hadOwnGuarantee) handler.getGuaranteedEggTierFromPullCount = originalGuarantee;
      else delete handler.getGuaranteedEggTierFromPullCount;
      try { releaseInput?.(); } catch { /* A page refresh restores input. */ }
      window[COMMIT_LOCK_KEY] = false;
    }
  }

  try {
    if (!request || typeof request !== "object") {
      return errorResult("INVALID_REQUEST", "请求格式无效");
    }
    const scene = await resolveScene();
    switch (request.command) {
      case "collection-catalog":
        return await collectionCatalog(scene);
      case "item-catalog":
        return await itemCatalog(scene);
      case "account-preview":
        return await accountPreview(scene, request.payload || {});
      case "account-commit":
        return await commitAccount(scene, request.payload || {});
      case "account-snapshot":
        return { ok: true, system: requireAccountWritable(scene), pageInstanceId: getPageInstanceId() };
      case "inspect":
        return await inspectScene(scene);
      case "commit":
        if (request.payload?.operations?.some(operation => operation.type === "addModifier")) await gameExports(scene);
        return await commit(scene, request.payload || {});
      case "undo":
        if ((request.payload?.targetOperations || request.payload?.operations)?.some(operation => operation.type === "addModifier")) await gameExports(scene);
        return await undo(scene, request.payload || {});
      case "add-legendary-eggs":
        return await addLegendaryEggs(scene, request.payload || {});
      case "arm-rare-encounter":
        return armRareEncounter(scene);
      case "cancel-rare-encounter":
        return cancelRareEncounter(scene);
      case "export-native": {
        if (typeof scene.gameData.tryExportData !== "function") {
          return errorResult("UNAVAILABLE", "当前版本没有原生导出能力");
        }
        const exported = await scene.gameData.tryExportData(1, Number(scene.sessionSlotId));
        return exported
          ? { ok: true, code: "EXPORTED", message: "已触发游戏原生 .prsv 备份下载" }
          : errorResult("EXPORT_FAILED", "游戏原生备份导出失败");
      }
      case "export-system-native": {
        if (typeof scene.gameData.tryExportData !== "function") {
          return errorResult("UNAVAILABLE", "当前版本没有账号系统存档导出能力");
        }
        const exported = await scene.gameData.tryExportData(0);
        return exported
          ? { ok: true, code: "EXPORTED", message: "已触发游戏原生账号系统 .prsv 备份下载" }
          : errorResult("EXPORT_FAILED", "账号系统存档导出失败");
      }
      default:
        return errorResult("UNKNOWN_COMMAND", "未知命令");
    }
  } catch (error) {
    return errorResult("ADAPTER_ERROR", error?.message || "无法连接当前游戏存档");
  }
}
