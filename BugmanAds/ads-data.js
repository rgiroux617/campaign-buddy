// ads-data.js version 03-16-01
export const ADS = [

  {
    id: "oracle-premium",
    theme: "oracle",
    variant: "premium",
    slotSize: "banner",

    kicker: "Available now -",

    title: "Oracle Premium Services",

    bannerImage: "ad-oracle-premium-banner.png",

    body: [

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      Sitting pretty with extra rations? Why let them spoil when you can invest in what one Viking daily referred to as
      <span class="italicText">"the top foraging consultation service in the greater island area."</span>
      That's right,
      <span class="boldText greenText">Forage Buddy</span> and
      <span class="boldText purpleText">Oracle Consultation</span>
      are now available on a premium tier, offering unlimited consults. Tired of catty responses from the Oracle? Not anymore!
      With the Forage Buddy Premium you'll be the envy of your clan.
      Act now and receive a new app color just to show off your great taste!
      `
      },

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      For the low rate of just
      <span class="redText">1.5 rations per day</span>
      you can be living the good life. Don't be the only Knud in your Karvi without it!
      `
      }

    ],

    buttons: [

      {
        label: "Go Premium!",
        action: "premium",
        className: "btn"
      },

      {
        label: "Close",
        action: "close",
        className: "btn"
      }

    ]
  },

  {
    id: "bugman-pawn-loan",
    theme: "bugman",
    variant: "standard",
    slotSize: "banner",

    title: "Bugman Pawn & Loan",

    bannerImage: "ad-pawn-loan-banner.png",

    body: [

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      Is foraging no longer cutting it? Maybe you've seen a few weak willed crewmembers straight up starve to death and have decided there has got to be a better way. And there is!
      `
      },

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      Bugman Pawn & Loan has been a trusted fixture of the Nordic island community since 754BC.
      With shops in nearly every port, our staff of technical specialists will find a solution
      <span class="boldText">for you!</span>
      Our services include:
      `
      },

      {
        type: "list",
        className: "simpleList",
        items: [
          "Indentured servitude",
          "Ration trading (at market rates)",
          "Best prices per oz for silver and gold"
        ]
      },

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      At Bugman Pawn & Loan, we believe no one should have to die just because they suck balls at foraging
      (or have a half dozen 1HP 'friends' to support). There are always sponsors willing to milk the raw
      energy your body produces in exchange for gruel. Suffer no more! Inquire today.
      `
      }

    ],

    buttons: [

      {
        label: "Close",
        action: "close",
        className: "btn"
      }

    ]

  },

  {
    id: "bugmans-picks",
    theme: "patriot",
    variant: "standard",
    slotSize: "banner",

    title: "Bugman's Picks",

    bannerImage: "ad-bugmans-picks-banner.png",

    body: [

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      Subscribe to Douglas Tran's "North Sea Bounty" substack for insights on all things
      survival related in the greater archipelago, including the Bugman's patented ward grading system©,
      sure to guide you to just the right ward for whatever freaky ass shit you are getting up to.
      `
      }

    ],

    buttons: [

      {
        label: "Close",
        action: "close",
        className: "btn"
      }

    ]

  },

  {
    id: "visit-lothing",
    theme: "summer",
    variant: "standard",
    slotSize: "banner",

    title: "Lothing Welcomes You!",

    bannerImage: "ad-visit_lothing-banner.png",

    body: [

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      We, the tourism board for beautiful Lothing, jewel of the North Sea, want to welcome you.  
      Explore local customs, trade smoked fish, chase the locals around our beautiful and historic bell tower.
      It all awaits you in Lothing.  So please visit! and please help - they've got us locked in this stupid tower
      `
      }

    ],

    buttons: [

      {
        label: "Send Help",
        action: "close",
        className: "btn"
      }

    ]

  },

  {
    id: "bugman-wards",
    theme: "spooky",
    variant: "standard",
    slotSize: "banner",

    title: "Hexes got you down?",

    bannerImage: "ad-feeling-cursed-banner.png",

    body: [

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      Get yourself to a <b>Bugman Ward Shop</b>.  Here at Bugman Wards, we dedicate ourselves to making sure that
      paralytic arm doesn't stay strapped to your side for the rest of your life just because you gave some old 
      woman the finger!  We've got plants, ointments, disgusting berries of all kinds and one is sure to cure you.  
      See our selection of bloods for the very best in protective help.  Our prices can't be beat anywhere
      in the North Sea.  
      `
      },

      {
        type: "paragraph",
        className: "netScreed",
        html: `
      Accept nothing but the best.  For adventurers travelling the fjords...it's <i>Bugman Wards!</i>
      `
      },

    ],

    buttons: [

      {
        label: "Spooky!",
        action: "close",
        className: "btn"
      }

    ]

  }

];