---
name: kindle-web-development
description: Exhaustive web development guide for Amazon Kindle e-ink browsers — covering every known constraint, quirk, workaround, and best practice for CSS, JavaScript, browser APIs, e-ink rendering, and device-specific behavior.
version: 2.0.0
author: gwyntel
license: MutuaL-1.2
tags: [kindle, e-ink, browser, webkit, chromium, css, javascript, mobile, embedded]
---

# Kindle Web Development: Complete Reference

**Exhaustively detailed guide** for building web applications that run on Amazon Kindle e-ink browsers. Every known constraint, quirk, workaround, and optimization technique documented.

---

## Table of Contents

1. [Browser Eras & Firmware Versions](#browser-eras--firmware-versions)
2. [Device Specifications](#device-specifications)
3. [JavaScript Constraints](#javascript-constraints)
4. [CSS Constraints & Bugs](#css-constraints--bugs)
5. [E-Ink Display Characteristics](#e-ink-display-characteristics)
6. [Typography & Text](#typography--text)
7. [Browser APIs](#browser-apis)
8. [Network & Connectivity](#network--connectivity)
9. [Input & Interaction](#input--interaction)
10. [Storage & State](#storage--state)
11. [Security & CORS](#security--cors)
12. [Performance Optimization](#performance-optimization)
13. [Memory Management](#memory-management)
14. [UI Patterns for E-Ink](#ui-patterns-for-e-ink)
15. [Specific Kindle Models](#specific-kindle-models)
16. [Debugging & Testing](#debugging--testing)
17. [Pitfalls Reference](#pitfalls-reference)
18. [Resources](#resources)

---

## Browser Eras & Firmware Versions

### Era 1: Legacy WebKit (Pre-5.16.4)

The original "Experimental Browser" built on ancient WebKit:

**WebKit Version**: `webkit-1.0_1.4.2` (disclosed in Amazon open-source compliance)

**Firmware Ranges**:
- Kindle 2: 2.x - 3.x
- Kindle Keyboard (K3): 3.0 - 3.4
- Kindle Touch: 5.0 - 5.3
- Kindle Paperwhite 1: 5.0 - 5.6
- Kindle Paperwhite 2: 5.4 - 5.12

**HTML5Test Scores**:
- Firmware 3.2.x: **55 / 555** (worse than IE8)
- Firmware 5.8.x: **152 / 555** (comparable to IE9)

**JavaScript Support**:
- ES3 specification
- Partial ES5.1 (many features missing or broken)
- No strict mode
- No `Object.create`, `Object.freeze`, etc.
- `Array.isArray` may be missing

**CSS Support**:
- CSS 2.1 partial
- CSS 3 fragments
- WebKit prefixes REQUIRED (`-webkit-`)
- No CSS Grid
- Flexbox buggy and incomplete
- No `calc()`, no `vh/vw` units

**Notable Features**:
- Web Workers: Supported
- Cross-Document Messaging: Supported
- Cross-Origin Resource Sharing (CORS): Supported
- Local Storage: Supported
- Canvas: Supported
- WebSockets: Partial/broken (hangs on complex data)
- Server-Sent Events: NOT supported
- Touch Events: NOT supported

**Performance**:
- Acid3 Test: 100% pass (pixel-perfect, no timing issues)
- JavaScript benchmarks (JetStream, ARES-6, Ringmark): **Browser hangs or crashes**
- ~100x slower than modern browsers on JS execution

### Era 2: Modern Chromium (5.16.4+)

The "Web Browser" (no longer called "Experimental") built on Chromium:

**Release Date**: November 2023 (silent update, not in changelog)

**Chromium Version**: ~75-80 (estimated based on feature support)

**Firmware**: 5.16.4 and later

**Affected Devices**:
- Kindle Scribe
- Kindle Paperwhite 10th Generation (2018)
- Kindle Paperwhite 11th Generation (2021)
- Kindle 10th Generation (2019)
- Kindle 11th Generation (2022, "Kindle Basic")
- Kindle Oasis 10th Generation (2019)

**HTML5Test Score**: ~400+ / 555 (modern web capable)

**JavaScript Support**:
- ES2019 (ES10) full support
- ES2020+ syntax causes parse errors
- JIT disabled (`--js-flags="jitless"`)
- 5-10x slower than standard Chrome

**CSS Support**:
- Flexbox: Supported but NO `gap` (Chrome 84 feature)
- CSS Grid: Fully supported including `gap`
- CSS Variables: Supported
- `calc()`: Supported
- `vh/vw` units: Supported
- Transforms: Supported
- Animations: Supported but cause ghosting (avoid)

**New Features in 5.16.4**:
- Modern HTML5 rendering
- Proper JavaScript execution
- Streaming fetch responses
- SSE (Server-Sent Events) support
- WebP image support
- Complex CSS layouts work
- Modern mobile sites render correctly

### How to Check Firmware Version

On Kindle:
```
Settings → Device Options → Device Info → Firmware Version
```

Firmware format: `5.16.2.1.1 (40974470002)`

---

## Device Specifications

### Screen Resolutions

| Device | Resolution | DPI | Grayscale |
|--------|-----------|-----|-----------|
| Kindle Basic (10th) | 1072 × 1448 | 167 | 16-level |
| Kindle Basic (11th) | 1072 × 1448 | 167 | 16-level |
| Paperwhite 10th | 1072 × 1448 | 300 | 16-level |
| Paperwhite 11th | 1236 × 1648 | 300 | 16-level |
| Oasis 10th | 1680 × 1264 | 300 | 16-level |
| Scribe | 1860 × 2480 | 300 | 16-level |

### Viewport Dimensions (Paperwhite 3 Example)

```
Screen Physical:     1072 × 1448 px
Browser Viewport:    1072 × 1268 px (reported by documentElement)
Usable Content:      ~1072 × 1231 px (after browser UI)
```

The browser reports actual pixel width, not a scaled viewport. This differs from smartphones which report a logical viewport (e.g., 375px) and scale content.

### Grayscale Rendering

- 16 levels of grayscale (4-bit)
- No color (e-ink is monochrome)
- Gradients render poorly — use solid colors or sharp transitions
- Anti-aliasing may cause fuzzy edges at small sizes

### Screen Refresh Characteristics

| Mode | Description | Use Case |
|------|-------------|----------|
| Full Refresh | Complete redraw, flashes black | Navigation, page turns |
| Partial Refresh | Incremental update | Minor changes, typing |
| A2 Mode | Fast refresh, lower quality | Scrolling (not available in browser) |

Browser uses automatic refresh mode selection. You cannot control refresh programmatically.

### Unicode vs. Emoji Support (Critical)

**Kindle browsers do NOT include emoji fonts.**
- ❌ **Standard Emojis** (e.g., 😂, 🚀, 💡) will render as empty boxes or "huh?" symbols ().
- ✅ **Unicode Glyphs** (Dingbats, Mathematical Operators, Geometric Shapes) are **robustly supported**.
- Kindles (especially Post-K3) have deep support for UTF-8 encoded glyphs found in system fonts like **Bookerly**, **Amazon Ember**, and **Georgia**.

**Reliable Glyph Ranges for UI**:
- **Dingbats (U+2700–27BF)**: `✓` (2713), `✕` (2715), `✎` (270E), `❧` (2767).
- **Miscellaneous Symbols (U+2600–26FF)**: `☀` (2600), `⚙` (2699), `⚠` (26A0), `⌛` (231B).
- **Geometric Shapes (U+25A0–25FF)**: `■`, `▲`, `●`.
- **Enclosed Alphanumerics (U+2460–24FF)**: `①`, `ⓐ`, `ⓘ`.

**Best Practices**:
1. **Always use UTF-8** encoding (`<meta charset="UTF-8">`).
2. **Avoid fallback chains** for glyphs; stick to common Unicode blocks that Kindle system fonts cover natively.
3. **Use glyphs for hierarchy** instead of color or thin borders, as they render with high contrast on e-ink.

## JavaScript Constraints

### ES2019 Ceiling — Complete Reference

#### ES2020+ Features That CRASH the Browser

These cause **parse-time SyntaxError** — the entire script fails to load:

```javascript
// ❌ OPTIONAL CHAINING (ES2020)
obj?.prop
obj?.[expr]
obj?.method?.()
arr?.[index]
func?.()

// ❌ NULLISH COALESCING (ES2020)
a ?? b
a ?? b ?? c
value ?? default
config.setting ?? fallback

// ❌ LOGICAL ASSIGNMENT (ES2021)
a ||= b
a &&= b
a ??= b

// ❌ NUMERIC SEPARATORS (ES2021)
1_000_000
0b1010_1010
0xFF_FF

// ❌ CLASS PRIVATE FIELDS (ES2022)
class Example {
  #privateField = 1;
  #privateMethod() {}
}

// ❌ TOP-LEVEL AWAIT (ES2022)
// At module scope:
const data = await fetch('/api');
```

#### ES2019 and Earlier — SAFE

```javascript
// ✅ LET/CONST (ES6)
let count = 0;
const PI = 3.14159;

// ✅ ARROW FUNCTIONS (ES6)
const sum = (a, b) => a + b;
const greet = name => `Hello, ${name}`;
const multiLine = (x) => {
  const doubled = x * 2;
  return doubled;
};

// ✅ TEMPLATE LITERALS (ES6)
const html = `<div class="${className}">${content}</div>`;
const path = `/api/users/${id}/posts/${postId}`;

// ✅ DESTRUCTURING (ES6)
const { name, age } = person;
const [first, second, ...rest] = array;
function foo({ a, b = 10 }) { }

// ✅ DEFAULT PARAMETERS (ES6)
function fetch(url, options = {}) { }
function greet(name = 'World') { }

// ✅ REST PARAMETERS (ES6)
function log(...args) { console.log(args); }
function sum(...numbers) { return numbers.reduce((a, b) => a + b, 0); }

// ✅ SPREAD OPERATOR (ES6)
const merged = { ...obj1, ...obj2 };
const combined = [...arr1, ...arr2];
const copy = [...original];

// ✅ FOR...OF (ES6)
for (const item of items) { }
for (const [key, value] of map) { }
for (const char of 'string') { }

// ✅ CLASSES (ES6)
class Animal {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return `${this.name} makes a sound`;
  }
}
class Dog extends Animal {
  constructor(name, breed) {
    super(name);
    this.breed = breed;
  }
}

// ✅ MAP, SET, WEAKMAP, WEAKSET (ES6)
const map = new Map([['a', 1], ['b', 2]]);
const set = new Set([1, 2, 3]);
const weakMap = new WeakMap();
const weakSet = new WeakSet();

// ✅ SYMBOLS (ES6)
const sym = Symbol('description');
const obj = { [sym]: 'value' };

// ✅ PROMISES (ES6)
new Promise((resolve, reject) => { })
Promise.resolve(value)
Promise.reject(error)
Promise.all([...promises])
Promise.race([...promises])

// ✅ ASYNC/AWAIT (ES2017)
async function fetchUser(id) {
  const response = await fetch(`/api/users/${id}`);
  const user = await response.json();
  return user;
}

// ✅ OBJECT.VALUES/ENTRIES (ES2017)
Object.values(obj)
Object.entries(obj)

// ✅ STRING PADDING (ES2017)
'str'.padStart(10, '.')
'str'.padEnd(10, '.')

// ✅ TRAILING COMMAS (ES2017)
const obj = {
  a: 1,
  b: 2,  // OK
};
function foo(a, b,) { }  // OK

// ✅ ASYNC ITERATION (ES2018)
async function* asyncGenerator() {
  yield await Promise.resolve(1);
}
for await (const value of asyncGenerator()) { }

// ✅ OBJECT REST/SPREAD (ES2018)
const { a, ...rest } = obj;
const merged = { ...obj1, ...obj2 };

// ✅ PROMISE.FINALLY (ES2018)
promise
  .then(result => { })
  .catch(error => { })
  .finally(() => { });

// ✅ ARRAY.FLAT/FLATMAP (ES2019)
[[1, 2], [3, 4]].flat()      // [1, 2, 3, 4]
[[1, 2], [3, 4]].flat(2)     // [1, 2, 3, 4]
arr.flatMap(x => [x, x*2])

// ✅ OBJECT.FROMENTRIES (ES2019)
Object.fromEntries([['a', 1], ['b', 2]])  // { a: 1, b: 2 }

// ✅ STRING TRIM METHODS (ES2019)
'  str  '.trimStart()
'  str  '.trimEnd()
'  str  '.trimLeft()   // Deprecated alias
'  str  '.trimRight()  // Deprecated alias

// ✅ TRY/CATCH BINDING (ES2019)
try {
  // ...
} catch {  // No binding parameter needed
  handle();
}

// ✅ JSON.SUPERSET (ES2019)
// Line separators allowed in strings (valid in JSON but not pre-ES2019 JS)
const json = '{"text": "line\u2028separator"}';
```

#### Detailed Workarounds

**For Optional Chaining**:

```javascript
// Instead of: user?.profile?.address?.city
function getNestedValue(obj, ...keys) {
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}
const city = getNestedValue(user, 'profile', 'address', 'city');

// Or simply:
const city = user && user.profile && user.profile.address && user.profile.address.city;

// Or helper:
function safeGet(obj, path) {
  return path.split('.').reduce((acc, key) => {
    return acc === null || acc === undefined ? undefined : acc[key];
  }, obj);
}
const city = safeGet(user, 'profile.address.city');

// For methods:
// Instead of: obj.method?.()
if (obj && typeof obj.method === 'function') {
  obj.method();
}

// For arrays:
// Instead of: arr?.[0]?.name
const item = arr && arr.length > 0 ? arr[0] : undefined;
const name = item && item.name;
```

**For Nullish Coalescing**:

```javascript
// Instead of: value ?? default
function coalesce(value, fallback) {
  return value !== null && value !== undefined ? value : fallback;
}
const result = coalesce(maybeNull, 'default');

// Or inline:
const result = value !== null && value !== undefined ? value : 'default';

// For multiple levels:
// Instead of: a ?? b ?? c ?? 'final'
const result = coalesce(coalesce(coalesce(a, b), c), 'final');
// Or:
let result = a;
if (result === null || result === undefined) result = b;
if (result === null || result === undefined) result = c;
if (result === null || result === undefined) result = 'final';

// Difference from || (OR):
// || treats 0, '', false as falsy
// ?? treats only null/undefined as nullish
const val = 0;
const a = val || 'default';  // 'default' (0 is falsy)
const b = coalesce(val, 'default');  // 0 (0 is NOT nullish)
```

**For Logical Assignment**:

```javascript
// Instead of: a ||= b
if (!a) a = b;

// Instead of: a &&= b
if (a) a = b;

// Instead of: a ??= b
if (a === null || a === undefined) a = b;
```

### JIT-less V8 Performance Impact

The Kindle runs Chromium's V8 engine with JIT compilation disabled:

```
--js-flags="jitless"
```

**Impact**:
- **5-10x slower** than standard Chrome on same hardware
- No TurboFan optimization pipeline
- No Ignition interpreter optimization
- Bytecode interpretation only

**Practical Implications**:

```javascript
// ❌ AVOID: CPU-intensive loops
for (let i = 0; i < 1000000; i++) {
  result += complexCalculation(i);
}

// ❌ AVOID: Large JSON parsing on main thread
const huge = JSON.parse(largeJsonString);  // Blocks UI for seconds

// ❌ AVOID: Complex regex on large strings
const result = largeString.match(/complex.*pattern.*with.*backtracking/g);

// ✅ BETTER: Break into chunks with yielding
function processInChunks(items, chunkSize, processFn) {
  let index = 0;
  function processChunk() {
    const end = Math.min(index + chunkSize, items.length);
    while (index < end) {
      processFn(items[index]);
      index++;
    }
    if (index < items.length) {
      setTimeout(processChunk, 0);  // Yield to UI
    }
  }
  processChunk();
}

// ✅ BETTER: Use requestAnimationFrame for animations
function animate() {
  updateState();
  render();
  requestAnimationFrame(animate);
}
```

### Module Support

```javascript
// ✅ <script> tags work
<script src="app.js"></script>

// ⚠️ ES modules may work but unreliable
<script type="module" src="app.js"></script>

// ✅ Bundlers recommended (Webpack, Rollup, esbuild)
// Transpile to ES2019 + bundle to single file

// ❌ Dynamic import may not work
const module = await import('./module.js');
```

---

## CSS Constraints & Bugs

### The Flexbox Gap Bug (Critical)

**Chromium 75 supports `gap` for Grid but NOT for Flexbox** (added in Chrome 84).

```css
/* ❌ BROKEN — gap property ignored in flexbox */
.flex-container {
  display: flex;
  gap: 16px;  /* IGNORED */
}

.flex-column {
  display: flex;
  flex-direction: column;
  gap: 12px;  /* IGNORED */
}

/* ✅ USE MARGINS ON ADJACENT SIBLINGS */
.horizontal-flex {
  display: flex;
}

.horizontal-flex > * + * {
  margin-left: 16px;
}

.vertical-flex {
  display: flex;
  flex-direction: column;
}

.vertical-flex > * + * {
  margin-top: 12px;
}

/* ✅ GRID GAP WORKS FINE */
.grid-container {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;  /* WORKS */
}

.grid-rows {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 12px;  /* WORKS */
}
```

**Complete Flexbox Gap Workaround**:

```css
/* Utility classes for flexbox spacing */
.flex-row { display: flex; flex-direction: row; }
.flex-col { display: flex; flex-direction: column; }

/* Spacing utilities */
.gap-4 > * + * { margin-left: 4px; }
.gap-8 > * + * { margin-left: 8px; }
.gap-12 > * + * { margin-left: 12px; }
.gap-16 > * + * { margin-left: 16px; }
.gap-24 > * + * { margin-left: 24px; }

.flex-col.gap-4 > * + * { margin-left: 0; margin-top: 4px; }
.flex-col.gap-8 > * + * { margin-left: 0; margin-top: 8px; }
.flex-col.gap-12 > * + * { margin-left: 0; margin-top: 12px; }
.flex-col.gap-16 > * + * { margin-left: 0; margin-top: 16px; }
.flex-col.gap-24 > * + * { margin-left: 0; margin-top: 24px; }
```

### Flexbox Other Bugs

```css
/* ⚠️ Flexbox shorthand quirks */
flex: 1;         /* May not work as expected */
flex: 1 1 auto;  /* More explicit, better */

/* ✅ Explicit longform */
flex-grow: 1;
flex-shrink: 1;
flex-basis: auto;

/* ⚠️ Min-height in flex containers */
.flex-child {
  min-height: 100px;  /* May be ignored */
}

/* ✅ Use explicit height */
.flex-child {
  height: 100px;
  flex-shrink: 0;  /* Prevent shrinking */
}
```

### CSS Properties Reference

#### Properties That Work

```css
/* Layout */
display: flex;
display: grid;
display: block;
display: inline-block;
display: none;

position: relative;
position: absolute;
/* position: fixed — causes checkerboarding, avoid */
/* position: sticky — causes checkerboarding, avoid */

float: left;
float: right;
clear: both;

/* Box Model */
width: 100px;
width: 100%;
width: auto;
min-width: 100px;
max-width: 100%;
height: 100px;
min-height: 100px;
max-height: 100vh;

padding: 16px;
padding-top: 8px;
margin: 16px;
margin: auto;

border: 2px solid black;
border-radius: 4px;

box-sizing: border-box;

/* Flexbox (without gap) */
flex-direction: row | column;
justify-content: flex-start | flex-end | center | space-between | space-around;
align-items: flex-start | flex-end | center | stretch | baseline;
flex-wrap: wrap | nowrap;
align-content: flex-start | flex-end | center | stretch;
flex: 1;
order: 1;
align-self: center;

/* Grid */
grid-template-columns: 1fr 1fr 1fr;
grid-template-rows: auto 1fr auto;
grid-template-areas: "header header" "sidebar main";
gap: 16px;  /* WORKS in Grid */
grid-column: span 2;
grid-row: span 2;

/* Typography */
font-family: Arial, sans-serif;
font-size: 16px;
font-size: 1rem;
font-weight: normal;
font-weight: bold;
font-style: normal;
font-style: italic;
line-height: 1.5;
text-align: left | center | right;
text-decoration: none;
text-transform: uppercase;

/* Color (rendered as grayscale) */
color: black;
color: #000000;
color: rgb(0, 0, 0);
background-color: white;
background-color: #ffffff;

/* Units */
px, %, em, rem, vh, vw, vmin, vmax
/* calc() works */
width: calc(100% - 32px);

/* CSS Variables */
:root {
  --spacing: 16px;
  --border-color: #000;
}
.element {
  padding: var(--spacing);
  border: 2px solid var(--border-color);
}
```

#### Properties That DON'T Work or Work Poorly

```css
/* ❌ FLEXBOX GAP */
gap: 16px;  /* In flexbox context — IGNORED */

/* ❌ ANIMATIONS & TRANSITIONS */
transition: all 0.3s;  /* Causes ghosting */
animation: fade 1s;   /* Causes flashing, ghosting */
@keyframes fade { }   /* Doesn't animate smoothly */

/* ❌ BOX SHADOW WITH BLUR */
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);  /* Blur renders poorly */

/* ❌ GRADIENTS */
background: linear-gradient(white, gray);  /* Banding, poor render */
background: radial-gradient(circle, white, black);  /* Poor */

/* ❌ FILTERS */
filter: blur(4px);  /* Not supported or poor */
filter: brightness(1.2);  /* Not supported */
filter: grayscale(1);  /* Not supported */

/* ❌ BACKDROP FILTER */
backdrop-filter: blur(10px);  /* Not supported */

/* ❌ CLIP PATH */
clip-path: polygon(0 0, 100% 0, 100% 100%);  /* Not supported */

/* ❌ MASK */
mask: url(mask.svg);  /* Not supported */

/* ❌ BLEND MODES */
mix-blend-mode: multiply;  /* Not supported */
background-blend-mode: overlay;  /* Not supported */

/* ❌ COLUMNS */
column-count: 3;  /* Poor support */
column-gap: 16px;  /* Poor support */

/* ⚠️ POSITION FIXED (causes artifacts) */
position: fixed;
/* Works technically but causes checkerboarding on scroll */

/* ⚠️ POSITION STICKY (causes artifacts) */
position: sticky;
top: 0;
/* Works technically but causes checkerboarding */

/* ❌ WEBKIT PREFIXES (modern Kindles) */
-webkit-flex: 1;  /* Not needed in Chromium era */
/* Only needed for legacy WebKit era */

/* ❌ CSS COUNTERS */
counter-reset: section;  /* May not work reliably */
counter-increment: section;
content: counter(section);

/* ❌ CUSTOM PROPERTIES IN MEDIA QUERIES */
@media (min-width: var(--breakpoint)) { }  /* Doesn't work */
```

### Complete Animation Ban

```css
/* ✅ RECOMMENDED: Disable all animations globally */
* {
  transition: none !important;
  animation: none !important;
}

/* If you need state changes, do instant flips */
.button:active {
  background-color: #000;
  color: #fff;
  transform: translate(2px, 2px);
}

/* ❌ NEVER USE */
.fade-in { animation: fadeIn 0.3s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.slide-in { animation: slideIn 0.2s; }
@keyframes slideIn { from { transform: translateX(-100%); } }

.spinner { animation: spin 1s infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
```

---

## E-Ink Display Characteristics

### Grayscale Rendering

16 levels of grayscale (4-bit depth):

```
Level 0:  #000000 (black)
Level 1:  #111111
Level 2:  #222222
...
Level 15: #ffffff (white)
```

**Color to Grayscale Conversion**:

Colors are automatically converted to grayscale. The formula is roughly:

```
Gray = 0.299 * R + 0.587 * G + 0.114 * B
```

**Practical Implications**:

```css
/* Colors with same luminance become identical */
color: #ff0000;  /* Red */
color: #00ff00;  /* Green */
/* May render identically */

/* ✅ Use grayscale values explicitly */
color: #000000;  /* Black */
color: #333333;  /* Dark gray */
color: #666666;  /* Medium gray */
color: #999999;  /* Light gray */
color: #cccccc;  /* Lighter gray */
color: #ffffff;  /* White */

/* Or use named grayscale colors */
color: black;
color: dimgray;    /* #696969 */
color: gray;        /* #808080 */
color: darkgray;    /* #a9a9a9 */
color: silver;      /* #c0c0c0 */
color: white;
```

### Refresh Rates & Ghosting

E-ink refresh modes:

| Mode | Quality | Speed | Use Case |
|------|---------|-------|----------|
| Full | Best | Slow (~1s) | Page turns, navigation |
| Partial | Good | Medium (~300ms) | Text input, minor updates |
| Fast (A2) | Poor | Fast (~100ms) | Scrolling (not available in browser) |

**Ghosting** occurs when previous content is still faintly visible after refresh. Causes:

- Rapid updates (partial refresh accumulation)
- Animations
- High-contrast borders
- Fixed/sticky positioning

**Ghosting Prevention**:

```css
/* ✅ Minimize DOM updates */
/* Only update text content, not entire trees */

/* ✅ Use full refreshes for major changes */
/* (Can't control programmatically, but avoid rapid changes) */

/* ✅ Avoid high-frequency updates */
/* Don't use setInterval for UI updates */

/* ✅ Use sharp color transitions */
/* No gradients */
border: 2px solid #000;  /* Good */
border: 1px solid rgba(0,0,0,0.5);  /* Poor (anti-aliased) */
```

### Anti-Aliasing

```css
/* Anti-aliasing is automatic and can cause fuzzy edges */
/* At small sizes, text can appear blurry */

/* ✅ Use larger font sizes */
font-size: 16px;  /* Minimum readable */
font-size: 18px;  /* Better */

/* ⚠️ Sub-pixel rendering doesn't work */
/* (E-ink has no color sub-pixels) */

/* ✅ Sharp borders without blur */
border: 2px solid #000;  /* Sharp */
box-shadow: 2px 2px 0 #000;  /* Hard shadow */
```

---

## Typography & Text

### System Fonts ONLY

```css
/* ✅ SAFE FONTS — always available */
font-family: Arial, sans-serif;
font-family: Verdana, sans-serif;
font-family: "Courier New", monospace;
font-family: Georgia, serif;
font-family: "Times New Roman", serif;
font-family: Geneva, sans-serif;
font-family: serif;
font-family: sans-serif;
font-family: monospace;

/* ⚠️ KINDLE-SPECIFIC FONTS (may be available) */
font-family: "Amazon Ember";  /* Kindle's custom font */
font-family: "Bookerly";       /* Kindle's book font */

/* ❌ AVOID — web fonts */
@import url('https://fonts.googleapis.com/css2?family=Inter');
@import url('https://fonts.googleapis.com/css2?family=Roboto');
font-family: 'Inter', sans-serif;  /* Won't load or very slow */

/* ❌ AVOID — local fonts */
/* Kindle doesn't allow custom font installation */
```

### Font Loading Considerations

Web fonts cause:
- Slow page render (blocks on download)
- Flash of invisible text (FOIT)
- Flash of unstyled text (FOUT)
- May not render at all

**Solution**: Use system fonts only. If you need specific weights:

```css
/* ✅ Use browser defaults */
body {
  font-family: Arial, Verdana, sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

h1 {
  font-family: Georgia, serif;
  font-size: 24px;
  font-weight: bold;
}

code, pre {
  font-family: "Courier New", monospace;
}
```

### NO EMOJIS (Native Font)

Emojis render as empty boxes `□` (tofu) because Kindle lacks emoji fonts.

**Solution: Use Twemoji** (converts emoji to PNG/SVG images)

```html
<!-- Add Twemoji CDN -->
<script src="https://unpkg.com/twemoji@14.0.2/dist/twemoji.min.js"></script>

<!-- After rendering content, call: -->
<script>
twemoji.parse(document.body, { folder: 'svg', ext: '.svg' });
</script>
```

**CSS for e-ink:**
```css
img.emoji {
  height: 1em;
  width: 1em;
  vertical-align: -0.1em;
  filter: grayscale(100%);  /* Color emoji muddy on e-ink */
  image-rendering: crisp-edges;
}
.dark-mode img.emoji {
  filter: grayscale(100%) invert(1);  /* White emoji on black bg */
}
```

**Alternative: ASCII Emoticons**

| Emoji | ASCII | Emoji | ASCII |
|-------|-------|-------|--------|
| ✓ | [OK] | ✗ | [X] |
| ⚠ | [!] | ℹ | [i] |
| ❤ | <3 | → | -> |
| ← | <- | ↑ | ^ |
| ↓ | v | ✓ | [v] |
| ✗ | [x] | … | ... |
| • | * | — | -- |
| " | " | " | " |
| ' | ' | ' | ' |
| © | (c) | ® | (R) |
| ™ | (TM) | ° | deg |

**Using SVG for Icons**:

```html
<!-- ✅ SVG works well -->
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <circle cx="12" cy="12" r="10"/>
  <path d="M9 12l2 2 4-4"/>
</svg>

<!-- Inline SVG in CSS -->
.icon-check::before {
  content: '';
  display: inline-block;
  width: 16px;
  height: 16px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'/%3E%3C/svg%3E");
  background-size: contain;
}
```

### Font Size Recommendations

```css
/* Minimum readable size */
body {
  font-size: 16px;  /* Minimum for readability */
}

/* Better for e-ink */
.article {
  font-size: 18px;
  line-height: 1.6;
}

/* Headers */
h1 { font-size: 24px; }
h2 { font-size: 20px; }
h3 { font-size: 18px; }

/* Small text (avoid if possible) */
.caption {
  font-size: 14px;  /* Minimum for captions */
}

/* ❌ TOO SMALL */
.tiny {
  font-size: 12px;  /* May be unreadable */
  font-size: 10px;  /* Definitely unreadable */
}
```

### Line Height

```css
/* ✅ Generous line height for readability */
body {
  line-height: 1.5;  /* Minimum */
}

.article {
  line-height: 1.6;  /* Better */
}

.long-form {
  line-height: 1.8;  /* Best for long text */
}
```

---

## Browser APIs

### fetch() API

Fully supported in Chromium era:

```javascript
// ✅ Basic fetch
const response = await fetch('/api/data');
const data = await response.json();

// ✅ POST request
const response = await fetch('/api/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name: 'John' })
});

// ✅ With error handling
async function fetchData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }
    return await response.json();
  } catch (error) {
    console.error('Fetch failed:', error);
    throw error;
  }
}

// ✅ Streaming response
async function streamData(url) {
  const response = await fetch(url);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}
```

### XMLHttpRequest (Legacy)

Works for backwards compatibility:

```javascript
// ✅ Works but use fetch() instead
function legacyFetch(url, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        callback(JSON.parse(xhr.responseText));
      } else {
        callback(null);
      }
    }
  };
  xhr.send();
}
```

### localStorage

Available but volatile:

```javascript
// ✅ Basic usage
localStorage.setItem('key', 'value');
const value = localStorage.getItem('key');
localStorage.removeItem('key');
localStorage.clear();

// ✅ Store objects (serialize first)
localStorage.setItem('user', JSON.stringify({ name: 'John', age: 30 }));
const user = JSON.parse(localStorage.getItem('user'));

// ⚠️ LIMITATIONS
// - 64MB total cache limit for entire browser
// - OS can wipe cache at any time
// - Cache cleared if limit exceeded
// - Don't store critical data
// - Don't store large data

// ✅ Safe usage: user preferences
const preferences = {
  theme: 'light',
  fontSize: 18
};
localStorage.setItem('preferences', JSON.stringify(preferences));

// ❌ UNSAFE: user data
const userData = { /* lots of data */ };
localStorage.setItem('userData', JSON.stringify(userData));  // May be wiped
```

### Server-Sent Events (SSE)

Supported in Chromium era:

```javascript
// ✅ Basic SSE
const eventSource = new EventSource('/api/stream');

eventSource.onmessage = function(event) {
  console.log('Message:', event.data);
};

eventSource.onerror = function(error) {
  console.error('SSE Error:', error);
  eventSource.close();
};

// ✅ Named events
const source = new EventSource('/api/stream');

source.addEventListener('message', function(event) {
  console.log('Message:', event.data);
});

source.addEventListener('custom-event', function(event) {
  console.log('Custom:', event.data);
});

// ⚠️ Pre-5.16.4: Not supported, use fallback
function createSSE(url, onMessage) {
  if (typeof EventSource !== 'undefined') {
    const source = new EventSource(url);
    source.onmessage = function(e) { onMessage(e.data); };
    return source;
  } else {
    // Fallback to polling
    const interval = setInterval(function() {
      fetch(url).then(r => r.text()).then(onMessage);
    }, 1000);
    return { close: function() { clearInterval(interval); } };
  }
}
```

### WebSockets

Partial/unreliable support:

```javascript
// ⚠️ Works but may hang on complex data
const ws = new WebSocket('wss://example.com/socket');

ws.onopen = function() {
  ws.send('Hello');
};

ws.onmessage = function(event) {
  console.log('Received:', event.data);
};

ws.onerror = function(error) {
  console.error('WebSocket error:', error);
};

// ✅ Prefer SSE for streaming
// ✅ Prefer fetch for API calls
```

### Canvas

Supported:

```javascript
// ✅ Basic canvas
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

ctx.fillStyle = 'white';
ctx.fillRect(0, 0, canvas.width, canvas.height);

ctx.strokeStyle = 'black';
ctx.lineWidth = 2;
ctx.strokeRect(10, 10, 100, 100);

// ✅ Text rendering
ctx.font = '16px Arial';
ctx.fillStyle = 'black';
ctx.fillText('Hello', 20, 50);

// ⚠️ Animations cause ghosting
// Use canvas for static graphics only
```

### DOM Manipulation

```javascript
// ✅ Standard DOM APIs work
const el = document.getElementById('myId');
const els = document.getElementsByClassName('myClass');
const els2 = document.querySelectorAll('.myClass');

const newEl = document.createElement('div');
newEl.textContent = 'Hello';
newEl.setAttribute('class', 'my-class');
parent.appendChild(newEl);

parent.removeChild(child);
parent.replaceChild(newChild, oldChild);

el.classList.add('active');
el.classList.remove('active');
el.classList.toggle('active');

el.style.backgroundColor = 'white';
el.style.color = 'black';

// ✅ Template literals with innerHTML
el.innerHTML = '<div class="' + className + '">' + content + '</div>';

// ✅ textContent for plain text (prevents XSS)
el.textContent = userInput;

// ❌ Avoid innerHTML with user input
el.innerHTML = userInput;  // XSS vulnerability
```

### Events

```javascript
// ✅ Standard events
element.addEventListener('click', function(e) {
  console.log('Clicked');
});

element.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    submit();
  }
});

element.addEventListener('submit', function(e) {
  e.preventDefault();
  // Handle submit
});

// ⚠️ Touch events
// Pre-5.16.4: Not supported
// Post-5.16.4: Basic support
element.addEventListener('touchstart', function(e) { });
element.addEventListener('touchmove', function(e) { });
element.addEventListener('touchend', function(e) { });

// ✅ Pointer events (preferred)
element.addEventListener('pointerdown', function(e) { });
element.addEventListener('pointerup', function(e) { });
```

### NOT Supported

```javascript
// ❌ These don't work or silently fail
alert('message');
confirm('Are you sure?');
prompt('Enter name:');

window.print();  // No printer support

// ✅ Custom implementations required
function showAlert(message) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><p>' + message + '</p><button>OK</button></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('button').onclick = function() { overlay.remove(); };
}

function showConfirm(message, onConfirm, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><p>' + message + '</p>' +
    '<button class="cancel">Cancel</button>' +
    '<button class="confirm">OK</button></div>';
  document.body.appendChild(overlay);
  
  overlay.querySelector('.cancel').onclick = function() {
    overlay.remove();
    if (onCancel) onCancel();
  };
  overlay.querySelector('.confirm').onclick = function() {
    overlay.remove();
    if (onConfirm) onConfirm();
  };
}
```

---

## Network & Connectivity

### WiFi vs 3G

| Network | Speed | Reliability | Notes |
|---------|-------|-------------|-------|
| WiFi | Good | Good | Recommended |
| 3G (older Kindles) | Slow | Variable | Being phased out by carriers |

**3G Limitations**:
- Amazon has disabled 3G browsing on many older Kindles
- Only works with Amazon services (Whispernet)
- Not recommended for web apps

### HTTPS

Modern Kindles require HTTPS for most features:

```
✅ https://example.com  — Works
⚠️ http://example.com   — May be blocked or limited
```

### CORS (Critical)

**Most external APIs cannot be called directly from Kindle browser** due to CORS restrictions.

```javascript
// ❌ BLOCKED — OpenAI API from browser
fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sk-...',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ model: 'gpt-4', messages: [...] })
});
// Error: CORS policy: No 'Access-Control-Allow-Origin' header

// ❌ BLOCKED — Most APIs from browser
fetch('https://api.example.com/data');
// Error: CORS policy blocked

// ✅ SOLUTION: Use backend proxy
// Browser → Your Server (same origin) → External API

// Or use APIs that allow CORS:
// - Google Gemini API (allows browser requests)
// - Your own backend with CORS headers
```

### Request Timeout

```javascript
// ⚠️ No built-in timeout for fetch
// Implement manually:

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const id = setTimeout(function() { controller.abort(); }, timeout);
  
  try {
    const response = await fetch(url, Object.assign({}, options, {
      signal: controller.signal
    }));
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

// Usage
try {
  const data = await fetchWithTimeout('/api/data', {}, 10000);
} catch (e) {
  console.log('Request failed:', e.message);
}
```

---

## Input & Interaction

### Touch Targets

```css
/* ✅ Minimum 48x48px touch targets */
button, a, input[type="checkbox"], input[type="radio"] {
  min-width: 48px;
  min-height: 48px;
  padding: 12px 16px;
}

/* ✅ Larger for primary actions */
.button-primary {
  min-width: 64px;
  min-height: 56px;
  padding: 16px 24px;
}

/* ✅ Add spacing between touch targets */
.button-group > * + * {
  margin-left: 8px;
}
```

### Virtual Keyboard

Kindle has a software keyboard that takes screen space:

```
Keyboard height: ~200-300px (varies by model)
Keyboard covers bottom of viewport when active
```

```javascript
// Handle keyboard appearing
input.addEventListener('focus', function() {
  // Scroll input into view
  setTimeout(function() {
    input.scrollIntoView({ behavior: 'instant', block: 'center' });
  }, 100);  // Wait for keyboard animation
});

// ⚠️ No reliable way to detect keyboard height
// Use fixed positioning at top for critical elements
```

### Form Inputs

```css
/* ✅ Large, readable inputs */
input[type="text"],
input[type="email"],
input[type="password"],
input[type="search"],
textarea,
select {
  font-family: inherit;
  font-size: 16px;
  padding: 12px 16px;
  border: 2px solid #000;
  background: #fff;
  color: #000;
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
}

/* Remove default styling */
input, button, textarea, select {
  border-radius: 0;
  -webkit-border-radius: 0;
}

/* ✅ Focus state (instant, no animation) */
input:focus {
  outline: none;
  border-color: #000;
  border-width: 3px;
}

/* ✅ Labels above inputs */
label {
  display: block;
  margin-bottom: 4px;
  font-weight: bold;
}

.form-group {
  margin-bottom: 16px;
}
```

### Buttons

```css
/* ✅ Kindle-friendly buttons */
button {
  font-family: inherit;
  font-size: 16px;
  padding: 12px 24px;
  border: 2px solid #000;
  background: #fff;
  color: #000;
  cursor: pointer;
  min-height: 48px;
}

button:active {
  background: #000;
  color: #fff;
  /* No transition — instant feedback */
}

button:disabled {
  background: #ccc;
  color: #666;
  cursor: not-allowed;
}

/* Primary button */
.button-primary {
  background: #000;
  color: #fff;
}

.button-primary:active {
  background: #333;
}
```

### Keyboard Shortcuts

Kindle has limited keyboard support (only on models with physical keyboard):

```javascript
// ✅ Basic keyboard handling
document.addEventListener('keydown', function(e) {
  // Navigation
  if (e.key === 'Enter') {
    submitForm();
  }
  
  if (e.key === 'Escape') {
    closeModal();
  }
});

// ⚠️ Kindle-specific keys may not be mappable
// Most modern Kindles use touch only
```

---

## Storage & State

### localStorage

```javascript
// Capacity: ~5MB per origin (standard browser limit)
// BUT: Kindle total cache is 64MB for entire browser
// OS wipes entire cache if exceeded

// ✅ Safe for: User preferences, small settings
// ❌ NOT safe for: User data, large content, anything critical

// Helper functions
function savePreference(key, value) {
  try {
    localStorage.setItem('pref_' + key, JSON.stringify(value));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

function loadPreference(key, defaultValue) {
  try {
    const value = localStorage.getItem('pref_' + key);
    return value ? JSON.parse(value) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// ⚠️ Always wrap in try/catch
// localStorage can throw on quota exceeded
```

### sessionStorage

```javascript
// ✅ Works like localStorage
// Cleared when browser/tab closes
sessionStorage.setItem('key', 'value');
const value = sessionStorage.getItem('key');
```

### IndexedDB

May work but unreliable:

```javascript
// ⚠️ Limited testing, may not work on all Kindles
const request = indexedDB.open('MyDatabase', 1);

request.onupgradeneeded = function(event) {
  const db = event.target.result;
  db.createObjectStore('store', { keyPath: 'id' });
};

// Prefer localStorage for simplicity
```

### Cookies

```javascript
// ✅ Works, but limited
document.cookie = 'name=value; path=/';

// Read cookies
function getCookie(name) {
  const value = '; ' + document.cookie;
  const parts = value.split('; ' + name + '=');
  if (parts.length === 2) return parts.pop().split(';').shift();
}
```

---

## Security & CORS

### CORS Proxy Required

Most external APIs cannot be called directly:

```
Kindle Browser → Your Backend → External API
        ↑              ↓              ↓
    Same Origin    Add CORS     Returns Data
```

**Backend Example (Node.js/Express)**:

```javascript
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// Enable CORS for Kindle origin
app.use(cors({
  origin: '*',  // Or specific Kindle origins
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: messages
    })
  });
  
  const data = await response.json();
  res.json(data);
});

app.listen(3000);
```

**Cloudflare Worker Example**:

```javascript
export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    
    const body = await request.json();
    
    const response = await fetch('https://api.example.com/endpoint', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    const data = await response.json();
    
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
```

### Content Security Policy

```html
<!-- ⚠️ May interfere with inline scripts -->
<!-- Use external scripts when possible -->

<!-- ✅ Avoid inline event handlers -->
<button onclick="doSomething()">Click</button>

<!-- ✅ Use addEventListener instead -->
<button id="myButton">Click</button>
<script src="app.js"></script>

<!-- In app.js -->
document.getElementById('myButton').addEventListener('click', doSomething);
```

---

## Performance Optimization

### Minimize DOM Size

```javascript
// ❌ AVOID: Large DOM trees
for (let i = 0; i < 1000; i++) {
  document.body.appendChild(document.createElement('div'));
}

// ✅ BETTER: Pagination
function renderPage(items, pageNumber, pageSize) {
  const start = pageNumber * pageSize;
  const end = start + pageSize;
  const pageItems = items.slice(start, end);
  
  container.innerHTML = '';
  pageItems.forEach(function(item) {
    const el = document.createElement('div');
    el.textContent = item.name;
    container.appendChild(el);
  });
}

// ✅ BETTER: Virtual scrolling for lists
// (Render only visible items)
```

### Batch DOM Updates

```javascript
// ❌ SLOW: Multiple reflows
items.forEach(function(item) {
  const el = document.createElement('div');
  el.textContent = item;
  container.appendChild(el);  // Reflow each time
});

// ✅ FASTER: DocumentFragment
const fragment = document.createDocumentFragment();
items.forEach(function(item) {
  const el = document.createElement('div');
  el.textContent = item;
  fragment.appendChild(el);
});
container.appendChild(fragment);  // Single reflow

// ✅ FASTER: Build string, single innerHTML
let html = '';
items.forEach(function(item) {
  html += '<div>' + item + '</div>';
});
container.innerHTML = html;
```

### Avoid Layout Thrashing

```javascript
// ❌ SLOW: Alternating read/write
for (let i = 0; i < elements.length; i++) {
  const height = elements[i].offsetHeight;  // Read
  elements[i].style.height = height + 10 + 'px';  // Write
}

// ✅ FASTER: Batch reads, then writes
const heights = [];
for (let i = 0; i < elements.length; i++) {
  heights.push(elements[i].offsetHeight);  // All reads
}
for (let i = 0; i < elements.length; i++) {
  elements[i].style.height = heights[i] + 10 + 'px';  // All writes
}
```

### Debounce/Throttle Events

```javascript
// ✅ Debounce resize/scroll events
function debounce(func, wait) {
  let timeout;
  return function() {
    const context = this;
    const args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function() {
      func.apply(context, args);
    }, wait);
  };
}

window.addEventListener('resize', debounce(function() {
  handleResize();
}, 250));

// ✅ Throttle frequent events
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const context = this;
    const args = arguments;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(function() { inThrottle = false; }, limit);
    }
  };
}

document.addEventListener('scroll', throttle(function() {
  handleScroll();
}, 100));
```

---

## Memory Management

### Kindle Browser Memory Limits

- Total browser memory: Limited (varies by device)
- Large pages: Browser crashes
- Large images: Can cause crashes
- 64MB total cache limit (localStorage + images + everything)

### Memory-Safe Patterns

```javascript
// ❌ AVOID: Loading all data at once
const allData = await fetch('/api/all-data').then(r => r.json());

// ✅ BETTER: Lazy loading
async function loadData(offset, limit) {
  const response = await fetch('/api/data?offset=' + offset + '&limit=' + limit);
  return response.json();
}

// ❌ AVOID: Large images
<img src="huge-image.jpg" alt="...">

// ✅ BETTER: Optimized images
<img src="optimized.webp" alt="..." width="300" height="200">

// ❌ AVOID: Storing large data in memory
let cache = [];
data.forEach(item => cache.push(process(item)));

// ✅ BETTER: Process and discard
data.forEach(function(item) {
  process(item);
  // Don't store if not needed
});
```

### Image Optimization

```css
/* ✅ Use WebP for smaller files */
img {
  content: url('image.webp');
}

/* ✅ Specify dimensions to prevent reflow */
img {
  width: 300px;
  height: 200px;
}

/* ✅ Lazy loading */
<img loading="lazy" src="image.webp" alt="...">

/* ⚠️ CSS backgrounds */
/* Background images may not lazy load */
.banner {
  background-image: url('banner.webp');
  background-size: cover;
}
```

### Clean Up Event Listeners

```javascript
// ❌ MEMORY LEAK: Event listener without cleanup
element.addEventListener('click', handler);

// ✅ Clean up when element removed
element.addEventListener('click', handler);
// When removing element:
element.removeEventListener('click', handler);
element.remove();

// ✅ Use AbortController (modern)
const controller = new AbortController();
element.addEventListener('click', handler, {
  signal: controller.signal
});
// Later:
controller.abort();  // Removes all listeners with this signal
```

---

## UI Patterns for E-Ink

### High Contrast Design

```css
/* ✅ Maximum contrast for e-ink */
body {
  background-color: #ffffff;
  color: #000000;
}

/* Strong borders */
.card {
  border: 2px solid #000000;
  background: #ffffff;
}

/* Clear hover/active states */
.button:active {
  background: #000000;
  color: #ffffff;
}

/* Avoid subtle colors */
/* ❌ color: #444; */
/* ✅ color: #000; */

/* Avoid light text on dark backgrounds */
/* ❌ Dark mode */
/* body { background: #000; color: #fff; } */
/* Works but less readable on e-ink */
```

### Typography Scale

```css
/* ✅ Kindle-friendly scale */
h1 { font-size: 24px; font-weight: bold; margin-bottom: 16px; }
h2 { font-size: 20px; font-weight: bold; margin-bottom: 12px; }
h3 { font-size: 18px; font-weight: bold; margin-bottom: 8px; }
p  { font-size: 16px; line-height: 1.6; margin-bottom: 12px; }
small { font-size: 14px; }

/* ✅ Generous spacing */
.container { padding: 16px; }
.section { margin-bottom: 24px; }
```

### Layout Patterns

```css
/* ✅ Simple vertical layout */
.page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.header {
  padding: 16px;
  border-bottom: 2px solid #000;
}

.main {
  flex: 1;
  padding: 16px;
}

.footer {
  padding: 16px;
  border-top: 2px solid #000;
}

/* ✅ Card layout */
.card {
  border: 2px solid #000;
  padding: 16px;
  margin-bottom: 16px;
  background: #fff;
}

/* ✅ List layout */
.list-item {
  padding: 12px;
  border-bottom: 1px solid #ccc;
}
.list-item:last-child {
  border-bottom: none;
}
```

### Modal Pattern

```css
/* ✅ Custom modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.modal {
  background: #fff;
  border: 2px solid #000;
  padding: 24px;
  max-width: 90%;
  max-height: 90%;
  overflow: auto;
}

.modal-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 16px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.modal-actions > * + * {
  margin-left: 8px;
}
```

---

## Specific Kindle Models

### Paperwhite 10th/11th Gen

- Resolution: 1072×1448 (10th) / 1236×1648 (11th)
- 300 DPI
- Touch screen
- No physical keyboard
- Chromium browser (5.16.4+)

### Oasis 10th Gen

- Resolution: 1680×1264 (landscape default)
- 300 DPI
- Physical buttons for page turn
- Touch screen
- Chromium browser (5.16.4+)

### Kindle Basic 10th/11th Gen

- Resolution: 1072×1448
- 167 DPI (10th) / 300 DPI (11th)
- Touch screen
- No physical keyboard
- Chromium browser (5.16.4+)

### Kindle Scribe

- Resolution: 1860×2480
- 300 DPI
- Large screen
- Stylus support (may work for drawing)
- Chromium browser

---

## Debugging & Testing

### No Built-in DevTools

Kindle browser has no developer tools. Debugging options:

**1. Console Log Trapping**:

```javascript
// Display console.log on page
(function() {
  const logEl = document.createElement('div');
  logEl.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:100px;overflow:auto;background:#000;color:#0f0;font-family:monospace;font-size:12px;z-index:99999;padding:8px;';
  document.body.appendChild(logEl);
  
  const originalLog = console.log;
  console.log = function() {
    originalLog.apply(console, arguments);
    const args = Array.prototype.slice.call(arguments);
    logEl.innerHTML += args.map(function(a) {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ') + '<br>';
  };
})();
```

**2. Error Display**:

```javascript
// Display errors on page
window.onerror = function(message, source, lineno, colno, error) {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#fee;border:2px solid #c00;padding:8px;z-index:99999;font-family:monospace;';
  div.innerHTML = '<b>Error:</b> ' + message + '<br>' + source + ':' + lineno;
  document.body.appendChild(div);
  return false;
};
```

**3. Feature Testing**:

```javascript
// Test browser capabilities
function testFeatures() {
  return {
    fetch: typeof fetch !== 'undefined',
    promise: typeof Promise !== 'undefined',
    asyncAwait: (function() {
      try { new Function('async function test() {}'); return true; } catch(e) { return false; }
    })(),
    customElements: typeof customElements !== 'undefined',
    shadowDOM: !!Element.prototype.attachShadow,
    sse: typeof EventSource !== 'undefined',
    webSockets: typeof WebSocket !== 'undefined',
    localStorage: (function() {
      try { localStorage.setItem('test', '1'); localStorage.removeItem('test'); return true; } catch(e) { return false; }
    })(),
    canvas: (function() {
      try { return !!document.createElement('canvas').getContext('2d'); } catch(e) { return false; }
    })(),
    webp: (function() {
      // Can't easily test without loading an image
      return true; // Assume supported on modern Kindles
    })()
  };
}

console.log(JSON.stringify(testFeatures(), null, 2));
```

### Testing Checklist

```
[ ] Test on actual Kindle hardware (not emulator)
[ ] Test on WiFi (3G unreliable)
[ ] Check firmware version (5.16.4+ recommended)
[ ] Test touch targets (48x48px minimum)
[ ] Verify no animations/transitions
[ ] Check flexbox gap (use margins)
[ ] Verify no optional chaining/nullish coalescing
[ ] Test with large content (memory limits)
[ ] Verify no alert/confirm/prompt
[ ] Check emoji rendering (should use ASCII)
[ ] Test forms and virtual keyboard
[ ] Verify HTTPS (HTTP may be blocked)
[ ] Test localStorage persistence
[ ] Check for ghosting after interactions
```

---

## Pitfalls Reference

### JavaScript Pitfalls

| Issue | Symptom | Solution |
|-------|---------|----------|
| `?.` optional chaining | Script doesn't load | Transpile to ES2019 |
| `??` nullish coalescing | Script doesn't load | Use ternary operator |
| `\|\|=` logical assignment | Syntax error | Use if statement |
| `#private` class fields | Syntax error | Use underscore convention |
| `_` numeric separators | Syntax error | Remove underscores |
| `await` at top level | Syntax error | Wrap in async function |

### CSS Pitfalls

| Issue | Symptom | Solution |
|-------|---------|----------|
| Flexbox `gap` | Layout broken | Use margins on siblings |
| Animation | Ghosting, flashing | `transition: none !important` |
| Position `fixed` | Checkerboarding | Use `relative` |
| Position `sticky` | Checkerboarding | Use `relative` |
| Web font | Slow/missing | Use system fonts |
| Emoji | `□` boxes | Use ASCII emoticons |
| Gradient | Banding | Use solid colors |
| Blur shadow | Poor render | Hard shadows only |
| `alert()` | Nothing happens | Custom modal |

### Browser API Pitfalls

| Issue | Symptom | Solution |
|-------|---------|----------|
| External API call | CORS error | Backend proxy |
| `alert()` | Silent failure | Custom modal |
| `confirm()` | Silent failure | Custom modal |
| `prompt()` | Silent failure | Custom modal |
| localStorage | Data loss | Don't store critical data |
| WebSocket | May hang | Prefer SSE/fetch |
| Large DOM | Browser crash | Paginate, limit size |
| Heavy JS | Slow/freeze | JIT-less 5-10x slower |

---

## Session Management

For apps that need to display conversation history from JSONL files:

### Reading Hermes Session Files

Sessions are stored in `~/.hermes/sessions/` as JSONL:

```
YYYYMMDD_HHMMSS_<id>.jsonl
```

Each line is a JSON object:
- `role: "session_meta"` — metadata (platform, model, tools array)
- `role: "user"` — user message with `content` and `timestamp`
- `role: "assistant"` — assistant message, may have `tool_calls` array
- `role: "tool"` — tool output with `tool_call_id` reference

### Merging Tool Outputs

Tool calls and outputs are separate entries. Merge for display:

```python
def read_session_messages(session_file, turns=15):
    all_entries = []
    tool_outputs = {}  # Map tool_call_id -> output
    
    with open(session_file, 'r') as f:
        for line in f:
            entry = json.loads(line.strip())
            if entry.get("role") == "session_meta":
                continue
            if entry.get("role") == "tool":
                tool_call_id = entry.get("tool_call_id")
                if tool_call_id:
                    tool_outputs[tool_call_id] = entry.get("content", "")[:200]
                continue
            all_entries.append(entry)
    
    # Merge tool outputs into assistant messages
    messages = []
    for entry in all_entries:
        msg = {
            "role": entry.get("role"),
            "content": entry.get("content", ""),
            "tools": []
        }
        if entry.get("role") == "assistant" and entry.get("tool_calls"):
            for tc in entry.get("tool_calls", []):
                fn = tc.get("function", {})
                msg["tools"].append({
                    "name": fn.get("name", "unknown"),
                    "args": fn.get("arguments", "")[:50],
                    "output": tool_outputs.get(tc.get("id", ""), "")
                })
        messages.append(msg)
    
    return messages[-turns * 2:]  # Last N turns
```

### Security: No config.js

Never expose configuration in a separate file that can be fetched:

```python
# Block config.js requests server-side
if self.path == '/config.js':
    self.send_error(404)
    return
```

Hardcode defaults in app.js instead, store user settings in localStorage after they enter them.

## Resources

### Official Documentation

- Amazon Kindle Firmware Updates: amazon.com/gp/help/customer/display.html?nodeId=GKWH6VWF4K7Q7QW8
- Amazon Open Source Disclosures: amazon.com/gp/help/customer/display.html?nodeId=201909250

### Community Resources

- **ReKindleOS COMPATIBILITY.md**: [github.com/ReKindleOS/ReKindle/blob/main/COMPATIBILITY.md](https://github.com/ReKindleOS/ReKindle/blob/main/COMPATIBILITY.md) — Detailed Chromium constraints, System 7 UI patterns
- **Thorgall's Kindle Browser Docs**: [thorgalle.me/notes/documentation-for-the-kindle-browser](https://thorgalle.me/notes/documentation-for-the-kindle-browser) — Paperwhite 3 deep dive
- **MobileRead Forums**: [mobileread.com/forums](https://www.mobileread.com/forums) — Kindle developer community
- **AndroidAuthority 5.16.4 Coverage**: [androidauthority.com/amazon-kindle-web-browser-update-3383765](https://www.androidauthority.com/amazon-kindle-web-browser-update-3383765) — Browser update details

### Example Projects

- **KWebBrew**: [github.com/KindleModding/KWebBrew](https://github.com/KindleModding/KWebBrew) — Local app framework (pre-5.16.4)
- **Kindle-ChatGPT**: [kindle-chatgpt.com](https://kindle-chatgpt.com) — Working example using Gemini
- **Readup.ink**: Kindle-optimized RSS reader

### Transpilation Tools

- **Babel**: Configure with `target: { chrome: 75 }` or `target: "es2019"`
- **esbuild**: `--target=es2019`
- **TypeScript**: `target: ES2019` in tsconfig.json
- **Webpack**: Use Babel loader with ES2019 preset

```javascript
// Babel config
module.exports = {
  presets: [
    ['@babel/preset-env', {
      targets: { chrome: 75 },
      // Or: targets: "es2019"
    }]
  ]
};

// TypeScript config
{
  "compilerOptions": {
    "target": "ES2019"
  }
}

// esbuild
esbuild.build({
  target: 'es2019',
  // ...
});
```
