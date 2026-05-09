// journeys.js
// Scripted camera journeys for Campaign Buddy.
// Each journey is a plain object with namedPlaces and keyframes.
//
// Usage in app.js:
//   import { introJourney } from "./journeys.js";
//   journey.play(introJourney, { card, shipPanel });

// ── Named places ──────────────────────────────────────────────────────────────
// Any keyframe's `hex` field can use these names instead of raw coordinates.
const PLACES = {
  overview:   "20,20",   // wide establishing shot — adjust to taste
  wormDungeon:"29,08",
  birdNest:   "25,10",
  ship:       "19,03",
};

// ── Card data for each stop ───────────────────────────────────────────────────
// Mirrors the shape that card.open() expects.
const CARDS = {
  wormDungeon: {
    title:    "Worm Dungeon",
    subtitle: "Dungeon",
    body:     "Add your description here.",
    tags:     ["dungeon", "danger"],
  },
  birdNest: {
    title:    "Great Bird Nest",
    subtitle: "Point of Interest",
    body:     "Add your description here.",
    tags:     ["wilderness"],
  },
  ship: {
    title:    "The Implication",
    subtitle: "Longship",
    body:     "Home and transport for the crew. A reliable vessel with a complicated past.",
    tags:     ["vessel", "crew"],
  },
};

// ── The intro journey ─────────────────────────────────────────────────────────
export const introJourney = {
  namedPlaces: PLACES,

  keyframes: [

    // 0. Wide establishing shot — instant cut, no card
    {
      hex:       "overview",
      zoom:      900,
      durationMs: 1000,
      pauseMs:   1200,
      easing:    "ease",
    },

    // 1. Zoom to Worm Dungeon — tilt slightly on arrival
    {
      hex:       "wormDungeon",
      zoom:      220,
      durationMs: 3500,
      pauseMs:   2000,
      rotateDeg: -45,
      rotateMs:  1200,
      easing:    "ease",
      onArrive:  ({ card }) => card.open(CARDS.wormDungeon),
      onDepart:  ({ card }) => card.close(),
    },

    // 2. Pan to Great Bird Nest — level out
    {
      hex:       "birdNest",
      zoom:      220,
      durationMs: 2000,
      pauseMs:   2000,
      rotateDeg:  0,
      rotateMs:   800,
      easing:    "ease",
      onArrive:  ({ card }) => card.open(CARDS.birdNest),
      onDepart:  ({ card }) => card.close(),
    },

    // 3. Final zoom to The Implication
    {
      hex:       "ship",
      zoom:      160,
      durationMs: 2000,
      pauseMs:    2000,
      rotateDeg:  90,
      easing:    "ease",
      onDepart: ({ card }) => card.close(),
      onArrive: ({ card }) => card.open(CARDS.ship), 
    },

    {
      hex: "overview",
      zoom: 1400,
      durationMs: 2500,
      pauseMs: 1200,
      easing: "ease-out",
      onDepart: ({ card }) => card.close(),
    },

  ],
};

export const zoomJourney = {
  namedPlaces: PLACES,

  keyframes: [

    // 0. Start wide — instant cut to establish position
    {
      hex: "25, 06",
      zoom: 1800,
      durationMs: 0,
      pauseMs: 4000,
    },

    // 1. Begin slow zoom — no rotation yet
    {
      hex: "25, 06",
      zoom: 600,
      durationMs: 8000,
      pauseMs: 0,
      rotateDeg: 0,
      easing: "linear",
    },

    // 2. Continue zooming in — rotation begins
    {
      hex: "ship",
      zoom: 60,
      durationMs: 8000,
      pauseMs: 5000,
      rotateDeg: 90,
      easing: "ease-out",
    },

    // 3. Level out and hold on the ship
    {
      hex: "ship",
      zoom: 160,
      durationMs: 10000,
      pauseMs: 0,
      rotateDeg: 0,
      easing: "ease-out",
    },

  ],
};