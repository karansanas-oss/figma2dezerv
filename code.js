// figma2dezerv: minimal plugin controller (with minimal debugging)
// Preserves Figma order; adds debug info to inspect ordering/overwrites.

figma.showUI(__html__, { width: 640, height: 480, themeColors: true });

// Toggle this to false when you no longer need debug output
const DEBUG = true;

// Dropdown options
const DROPDOWN_OPTIONS = ["Colors", "Text"];

// Text modes (from Figma, or hardcoded if not available)
const TEXT_MODES = ["app", "desktop", "deck"];

// Format flag: 'flutter' or 'react'
let colorFormat = 'flutter';
// Helper to fetch text styles and variables for each mode
function getTextStylesSnapshot() {
  try {
    const collections = figma.variables.getLocalVariableCollections();
    const typographyCollection = collections.find(
      (c) => c.name.toLowerCase() === "typography"
    );
    if (!typographyCollection)
      return { error: "No 'Typography' collection found" };

    const textStyles = figma.getLocalTextStyles();
    const modes = typographyCollection.modes.map((m) => ({
      modeId: m.modeId,
      name: m.name,
    }));

    function resolveVariableValue(varId, modeId, modeName, depth = 0) {
      if (!varId || depth > 20) return null;

      const variable = figma.variables.getVariableById(varId);
      if (!variable) return null;

      let val = variable.valuesByMode[modeId];

      // Follow aliases
      if (val && val.type === "VARIABLE_ALIAS") {
        return resolveVariableValue(val.id, modeId, modeName, depth + 1);
      }

      // If value is missing, try resolving via modeName in the variable's own collection
      if (val == null) {
        const coll = figma.variables.getVariableCollectionById(
          variable.variableCollectionId
        );
        if (coll) {
          const match = coll.modes.find((m) => m.name === modeName);
          if (match) {
            val = variable.valuesByMode[match.modeId];
          }
          // fallback to first mode if still null
          if (val == null && coll.modes.length > 0) {
            val = variable.valuesByMode[coll.modes[0].modeId];
          }
        }
      }

      if (val == null) return null;

      // Normalize by variable type
      switch (variable.resolvedType) {
        case "FLOAT":
          return val; // numbers like fontSize, lineHeight, letterSpacing
        case "STRING":
          return val; // fontFamily
        case "BOOLEAN":
          return !!val;
        case "COLOR":
          return figma.util.rgbToHex(val);
        default:
          return val;
      }
    }

    function assignNested(obj, path, value) {
      let node = obj;
      for (let i = 0; i < path.length; i++) {
        const key = path[i];
        if (i === path.length - 1) {
          node[key] = value;
        } else {
          if (!node[key]) node[key] = {};
          node = node[key];
        }
      }
    }

    let values = {};
    for (const { modeId, name: modeName } of modes) {
      values[modeName] = {};

      for (const style of textStyles) {
        const bound = style.boundVariables || {};
        console.warn(bound);

        let entry = {};

        entry.fontSize = bound.fontSize
          ? resolveVariableValue(bound.fontSize.id, modeId, modeName)
          : style.fontSize;

        entry.fontFamily = bound.fontName
          ? resolveVariableValue(bound.fontName.id, modeId, modeName)
          : style.fontName.family;

        entry.letterSpacing = bound.letterSpacing
          ? resolveVariableValue(
              bound.letterSpacing.id,
              modeId,
              modeName
            ).toFixed(2)
          : style.letterSpacing.value;

        entry.lineHeight = bound.lineHeight
          ? resolveVariableValue(bound.lineHeight.id, modeId, modeName)
          : style.lineHeight.value;

        entry.fontWeight = bound.fontWeight
          ? resolveVariableValue(bound.fontWeight.id, modeId, modeName)
          : style.fontName.style;

        const path = style.name
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean);
        assignNested(values[modeName], path, entry);
      }
    }

    console.warn({
      collection: {
        id: typographyCollection.id,
        name: typographyCollection.name,
      },
      modes: modes.map((m) => m.name),
      values,
    });

    return {
      collection: {
        id: typographyCollection.id,
        name: typographyCollection.name,
      },
      modes: modes.map((m) => m.name),
      values,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

function sortObject(obj, parentKey = "") {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;

  const GROUP_ORDER = ["neutral", "semantic", "charts", "feature", "helper"];
  const TYPE_ORDER = [
    "text",
    "bg",
    "icon",
    "border",
    "light",
    "dark",
    "red",
    "yellow",
    "brown",
    "lightGreen",
    "green",
    "purple",
    "directMutualFunds",
    "regularMutualFunds",
    "monthlyExpenses",
    "excessBalance",
    "insights",
    "alwaysWhite",
    "alwaysBlack",
    "overlay",
    "alpha",
    "helpers",
    "zero",
  ];

  const ROLE_ORDER = {
    default: [
      "primary",
      "secondary",
      "tertiary",
      "disabled",
      "actionPrimary",
      "actionSecondary",
    ],
    border: [
      "primary",
      "secondary",
      "highContrast",
      "focused",
      "actionPrimary",
      "actionSecondary",
    ],
    semanticBg: [
      "negativePrimary",
      "negativeSecondary",
      "warningPrimary",
      "warningSecondary",
      "positivePrimary",
      "positiveSecondary",
    ],
    semanticIcon: [
      "negativePrimary",
      "negativeSecondary",
      "warningPrimary",
      "warningSecondary",
      "positivePrimary",
      "positiveSecondary",
    ],
    semanticBorder: ["negative", "warning", "positive"],
    helperAlpha: [
      "primaryZeroPercent",
      "invertedZeroPercent",
      "negativeAlpha",
      "warningAlpha",
      "positiveAlpha",
    ],
    helperStates: [
      "hoverDarken",
      "pressedDarken",
      "hoverLighten",
      "pressedLighten",
    ],
  };

  function getOrder(key, parentPath) {
    const parts = parentPath.split(".");
    const [group, type] = parts;

    // Top-level group ordering
    if (GROUP_ORDER.includes(key)) return GROUP_ORDER.indexOf(key) + 1;
    // Inside neutral/semantic/... → order types
    if (TYPE_ORDER.includes(key)) return TYPE_ORDER.indexOf(key) + 1;

    // Figure out role list
    let roleList;
    if (type === "border") {
      roleList = ROLE_ORDER.border;
    } else if (group === "semantic" && type === "bg") {
      roleList = ROLE_ORDER.semanticBg;
    } else if (group === "semantic" && type === "icon") {
      roleList = ROLE_ORDER.semanticIcon;
    } else if (group === "semantic" && type === "border") {
      roleList = ROLE_ORDER.semanticBorder;
    } else if (group === "helper" && parentPath.endsWith("alpha")) {
      roleList = ROLE_ORDER.helperAlpha;
    } else if (group === "helper" && parentPath.endsWith("states")) {
      roleList = ROLE_ORDER.helperStates;
    } else {
      roleList = ROLE_ORDER.default;
    }

    const idx = roleList.indexOf(key);
    if (idx >= 0) return idx + 1;

    // Special case: charts series
    if (group === "charts" && /^series/.test(key)) {
      const map = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
      for (const word in map) {
        if (key.toLowerCase().includes(word)) return map[word];
      }
    }

    return 999; // fallback
  }

  const sorted = {};
  Object.keys(obj)
    .sort((a, b) => {
      const pa = getOrder(a, parentKey);
      const pb = getOrder(b, parentKey);
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    })
    .forEach((key) => {
      const newParent = parentKey ? parentKey + "." + key : key;
      sorted[key] = sortObject(obj[key], newParent);
    });

  return sorted;
}

function getColorVariablesSnapshot() {
  try {
    // Fetch collections & variables
    const collections = figma.variables.getLocalVariableCollections();
    const allVariables = figma.variables.getLocalVariables();

    function findCollection(name) {
      for (var i = 0; i < collections.length; i++) {
        var c = collections[i];
        if (c.name.toLowerCase() === name.toLowerCase()) return c;
      }
      return null;
    }

    const colorCollection = findCollection("color");
    const primitivesCollection = findCollection("primitives: color");

    if (!colorCollection) {
      return { error: "No 'color' collection found" };
    }

    var modes = colorCollection.modes.map(function (m) {
      return { modeId: m.modeId, name: m.name };
    });

    function filterVariables(collectionId) {
      return allVariables.filter(function (v) {
        return (
          v.resolvedType === "COLOR" && v.variableCollectionId === collectionId
        );
      });
    }

    var colorVariables = filterVariables(colorCollection.id);
    var primitiveVariables = primitivesCollection
      ? filterVariables(primitivesCollection.id)
      : [];

    // --- Normalization helpers (same as before) ---
    var SEGMENT_MAP = {
      "✦": "neutral",
      "🎨": "feature",
      "📊": "charts",
      "🍇": "purple",
      "🍋": "yellow",
      "🍐": "light green",
      "🍓": "red",
      "🥔": "brown",
      "🥬": "green",
      "🚦": "semantic",
      "🚨": "helper",
      "☀": "light",
      "☾": "dark",
      i0: "inverted zero",
    };

    var SUPERS = {
      "series 1ˢᵗ": "series First",
      "series 2ⁿᵈ": "series Second",
      "series 3ʳᵈ": "series Third",
      "series 4ᵗʰ": "series Fourth",
      "series 5ᵗʰ": "series Fifth",
    };

    var NUM_WORDS = {
      0: "zero",
      1: "one",
      2: "two",
      3: "three",
      4: "four",
      5: "five",
      6: "six",
      7: "seven",
      8: "eight",
      9: "nine",
      10: "ten",
      11: "eleven",
      12: "twelve",
      13: "thirteen",
      14: "fourteen",
      15: "fifteen",
      16: "sixteen",
      17: "seventeen",
      18: "eighteen",
      19: "nineteen",
      20: "twenty",
    };

    function normalizeOrdinal(seg) {
      if (SUPERS.hasOwnProperty(seg)) return SUPERS[seg];
      var m = seg.match(/^(\d+)\s*(?:st|nd|rd|th)$/i);
      return m ? m[1] : seg;
    }

    function numberToWord(n) {
      if (NUM_WORDS.hasOwnProperty(n)) return NUM_WORDS[n];
      var num = parseInt(n, 10);
      if (!isNaN(num) && num < 100) {
        var tens = Math.floor(num / 10) * 10;
        var ones = num % 10;
        if (NUM_WORDS.hasOwnProperty(tens) && NUM_WORDS.hasOwnProperty(ones)) {
          return NUM_WORDS[tens] + " " + NUM_WORDS[ones];
        }
      }
      return n;
    }

    function toCamelKey(str) {
      if (!str) return str;
      var s = String(str);
      s = s.replace(/\b(\d+)\s*%/g, function (_, n) {
        return numberToWord(n) + " percent";
      });
      s = s.replace(/\b(\d+)\b/g, function (_, n) {
        return numberToWord(n);
      });
      s = s.trim().replace(/\s+/g, " ");
      var parts = s.split(/\s+/);
      for (var i = 0; i < parts.length; i++) {
        if (i === 0) parts[i] = parts[i].toLowerCase();
        else parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
      }
      return parts.join("");
    }

    function normalizeSegment(s) {
      var norm = normalizeOrdinal(s);
      if (SEGMENT_MAP.hasOwnProperty(norm)) norm = SEGMENT_MAP[norm];
      return toCamelKey(norm);
    }

    function splitPath(name) {
      return name
        .split("/")
        .filter(function (p) {
          return p.length > 0;
        })
        .map(normalizeSegment);
    }

    function toHexByte(n) {
      return Math.round(Math.max(0, Math.min(1, n)) * 255)
        .toString(16)
        .toUpperCase()
        .padStart(2, "0");
    }

      function rgbaToHex(rgba) {
        if (!rgba || typeof rgba !== "object") return null;
        var r = toHexByte(rgba.r);
        var g = toHexByte(rgba.g);
        var b = toHexByte(rgba.b);
        var a = rgba.a == null ? 1 : rgba.a;
        if (colorFormat === 'flutter') {
          // Flutter: 0xAARRGGBB
          return "0x" + toHexByte(a) + r + g + b;
        } else {
          // React: #RRGGBBAA
          return "#" + r + g + b + toHexByte(a);
        }
      }

    function resolveAliasValue(valueOrAlias, modeId, modeName, guardDepth) {
      var depth = guardDepth || 0;
      if (valueOrAlias == null) return valueOrAlias;
      if (
        typeof valueOrAlias === "object" &&
        valueOrAlias.type === "VARIABLE_ALIAS"
      ) {
        if (depth > 20) return null;
        var ref = figma.variables.getVariableById(valueOrAlias.id);
        if (!ref) return null;
        var next = ref.valuesByMode[modeId];
        if (next == null) {
          var refCollection = figma.variables.getVariableCollectionById(
            ref.variableCollectionId
          );
          if (refCollection) {
            var match = null;
            for (var mi = 0; mi < refCollection.modes.length; mi++) {
              if (refCollection.modes[mi].name === modeName) {
                match = refCollection.modes[mi];
                break;
              }
            }
            if (match) next = ref.valuesByMode[match.modeId];
            if (next == null && refCollection.modes.length > 0) {
              next = ref.valuesByMode[refCollection.modes[0].modeId];
            }
          }
        }
        return resolveAliasValue(next, modeId, modeName, depth + 1);
      }
      return valueOrAlias;
    }

    // --- Assignment helpers with overwrite detection for debugging ---
    function assignNested(obj, path, value) {
      var node = obj;
      for (var i = 0; i < path.length; i++) {
        var key = path[i];
        if (i === path.length - 1) {
          node[key] = value;
        } else {
          if (!node[key] || typeof node[key] !== "object") node[key] = {};
          node = node[key];
        }
      }
    }

    // --- DEBUG bookkeeping structures ---
    var debugSummary = null;
    var debugAssignments = [];
    var perModeLeafMap = {}; // per-mode map of leafPath -> { varName, allIndex, colorIndex }

    // (debug logging unchanged…)

    // --- Build values while recording assignment order and overwrites ---
    var values = {};
    for (var mi = 0; mi < modes.length; mi++) {
      values[modes[mi].name] = {};
      perModeLeafMap[modes[mi].name] = {};
    }

    for (var cvIndex = 0; cvIndex < colorVariables.length; cvIndex++) {
      var v = colorVariables[cvIndex];
      var path = splitPath(v.name);
      for (var mIndex = 0; mIndex < modes.length; mIndex++) {
        var m = modes[mIndex];
        var raw = v.valuesByMode[m.modeId];
        var resolved = resolveAliasValue(raw, m.modeId, m.name);
        var hex = rgbaToHex(resolved);
        if (!hex) continue;

        // detect leaf overwrite: leaf path string in a mode
        var leafKey = path.join("/");
        var prev = perModeLeafMap[m.name][leafKey] || null;

        // set current as last-writer for this leaf
        perModeLeafMap[m.name][leafKey] = {
          varName: v.name,
          allIndex: (function () {
            for (var t = 0; t < allVariables.length; t++)
              if (allVariables[t].id === v.id) return t;
            return -1;
          })(),
          colorIndex: cvIndex,
        };

        assignNested(values[m.name], path, hex);
      }
    }

    // --- Build primitives (unchanged) ---
    function buildPrimitivesForMode(mode, sourceVars) {
      var bucket = {};

      for (var i = 0; i < sourceVars.length; i++) {
        var vv = sourceVars[i];
        var raw = vv.valuesByMode[mode.modeId];
        if (raw && typeof raw === "object" && raw.type === "VARIABLE_ALIAS")
          continue;
        var hex = rgbaToHex(raw);
        if (hex) assignNested(bucket, splitPath(vv.name), hex);
      }
      return bucket;
    }

    var primitives = {};

    if (primitivesCollection) {
      // Output primitives as a single group, using the first mode in the collection
      var firstMode = primitivesCollection.modes[0];
      if (firstMode) {
        Object.assign(
          primitives,
          buildPrimitivesForMode(firstMode, primitiveVariables)
        );
      }
    } else {
      // Fallback: use first mode from color collection
      var firstMode = modes[0];
      if (firstMode) {
        Object.assign(
          primitives,
          buildPrimitivesForMode(firstMode, colorVariables)
        );
      }
    }

    // Filter out the 🥽 group from primitives
    if (primitives["🥽"]) {
      delete primitives["🥽"];
    }

    console.warn(primitives);

    // Merge primitives into values as a 'primitives' group, sorted by mode and color
    if (Object.keys(primitives).length > 0) {
      Object.keys(values).forEach(function (modeName) {
        values[modeName].primitives = primitives;
      });
    }
    return {
      collection: { id: colorCollection.id, name: colorCollection.name },
      modes: modes.map((m) => m.name),
      values,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

// Post snapshot immediately on open
var snapshot = getColorVariablesSnapshot();
snapshot.values = Object.fromEntries(
  Object.entries(snapshot.values).map(([mode, tree]) => [
    mode,
    sortObject(tree),
  ])
);

figma.ui.postMessage({ type: "vars", payload: snapshot });

// Also post text styles snapshot
var textSnapshot = getTextStylesSnapshot();
figma.ui.postMessage({ type: "textVars", payload: textSnapshot });

// Listen for UI messages to handle dropdown selection and download all
figma.ui.onmessage = async (msg) => {
  if (msg.type === "downloadAll") {
    // Download 3x color JSONs
    for (const mode of snapshot.modes) {
      const colorJson = JSON.stringify(snapshot.values[mode], null, 2);
      figma.ui.postMessage({
        type: "download",
        filename: `colors-${mode}.json`,
        content: colorJson,
      });
    }
    // Download 3x text JSONs
    for (const mode of textSnapshot.modes) {
      const textJson = JSON.stringify(textSnapshot.values[mode], null, 2);
      figma.ui.postMessage({
        type: "download",
        filename: `text-${mode}.json`,
        content: textJson,
      });
    }
  }
  if (msg.type === 'setFormat') {
    if (msg.format === 'flutter' || msg.format === 'react') {
      colorFormat = msg.format;
      if (DEBUG) figma.notify('Color format set to ' + colorFormat);
        // Recompute color snapshot and send to UI
        var snapshot = getColorVariablesSnapshot();
        snapshot.values = Object.fromEntries(
          Object.entries(snapshot.values).map(([mode, tree]) => [
            mode,
            sortObject(tree),
          ])
        );
        figma.ui.postMessage({ type: "vars", payload: snapshot });
    }
  }
};
