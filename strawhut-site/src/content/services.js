// Per-service landing pages — each captures a long-tail search cluster
// ("podcast production company", "podcast advertising", "podcast studio Los
// Angeles") with its own Service schema, FAQ, and conversion-focused copy.
// Data-driven: server.js maps each config to a route and views.servicePage()
// renders it. Adding a service = adding an entry here + one route line.

export const SERVICE_PAGES = [
  {
    slug: 'podcast-production',
    path: '/podcast-production',
    navLabel: 'Podcast Production',
    title: 'Podcast Production Company — Full-Service | Straw Hut Media',
    description:
      'Straw Hut Media is a full-service podcast production company. We handle recording, editing, sound design, distribution, and growth so you get a chart-ready show without building a team.',
    summary: 'Full-service podcast production — recording, editing, sound design, distribution, and growth.',
    breadcrumbName: 'Podcast Production',
    hero: {
      h1: 'Full-service <span class="accent">podcast production</span>',
      dek: 'From first idea to chart-topping show — one award-winning team handles production, distribution, and growth, so you can just be the host.',
      cta: { label: 'Book a 15-min fit call', href: '/book' },
    },
    intro:
      'Straw Hut Media is a full-service podcast production company and network based in Hollywood. Whether you are launching a brand-new show or leveling up an existing one, we own the entire process — concept, recording, editing, sound design, publishing, distribution, and audience growth — so you get a professional, chart-competitive podcast without hiring and managing a team of specialists.',
    highlights: [
      { name: 'Show development', text: 'Concept, format, positioning, and a real launch plan built to stand out and last.' },
      { name: 'Studio recording', text: 'Record in our fully-equipped Hollywood studio — pro audio and multi-camera 4K video.' },
      { name: 'Editing & sound design', text: 'Content editing, mixing, original sound design, and broadcast-standard mastering on every episode.' },
      { name: 'Distribution', text: 'Published and optimized across Apple Podcasts, Spotify, YouTube, and every major platform.' },
      { name: 'Growth & marketing', text: 'Social clips, cross-promotion, and paid campaigns that build audience deliberately.' },
      { name: 'Monetization', text: 'Host-read ads, brand partnerships, and premium models that turn listeners into revenue.' },
    ],
    sections: [
      {
        h2: 'Why full-service beats piecing it together',
        html:
          '<p>Hiring a freelance editor here and a designer there turns you into a project manager — briefing, coordinating, and quality-checking a chain of people who never talk to each other. With Straw Hut Media, one team owns the whole show and nothing falls through the handoffs. You get a cohesive, finished product and your time back, plus the strategic layer — format, launch, distribution, and growth — that piecemeal freelancers simply do not provide.</p>',
      },
      {
        h2: 'Who we produce for',
        html:
          '<p>We produce award-winning original shows and partner podcasts for individual creators, brands, and businesses. That includes flagship shows for personalities, branded podcasts that build authority for companies, and everything in between. If you have an idea and an audience you want to reach, we can build the show that reaches them. Want a primer first? Read <a href="/resources/how-to-start-a-podcast">how to start a podcast</a> or <a href="/resources/how-much-does-podcast-production-cost">what podcast production costs</a>.</p>',
      },
    ],
    faq: [
      ['What does a podcast production company do?', 'A full-service podcast production company like Straw Hut Media handles the entire show — development and strategy, recording, editing and sound design, distribution across every platform, audience growth, and monetization — so you get a professional podcast without assembling and managing your own team.'],
      ['How much does full-service podcast production cost?', 'It depends on your format, episode length, frequency, and goals. Straw Hut Media offers packages that scale from a single flagship show to a full slate of episodes and scopes pricing to what you are trying to build. See our podcast production cost guide for the full picture.'],
      ['Do you produce branded podcasts for companies?', 'Yes. Straw Hut Media produces branded podcasts for companies and businesses alongside award-winning original shows — from concept through production, distribution, and promotion.'],
      ['Will I own my podcast?', 'Yes. You keep your show, your RSS feed, and your IP. We produce and grow it; it stays yours.'],
    ],
    schema: {
      name: 'Podcast Production',
      serviceType: 'Podcast production',
      description:
        'Full-service podcast production: show development, studio recording, editing, sound design, distribution, growth, and monetization for creators, brands, and businesses.',
    },
  },

  {
    slug: 'advertise',
    path: '/advertise',
    navLabel: 'Advertise',
    title: 'Podcast Advertising & Brand Partnerships | Straw Hut Media',
    description:
      'Advertise on Straw Hut Media podcasts. Reach engaged, loyal listeners with host-read ads and branded content across our network of award-winning shows.',
    summary: 'Podcast advertising and brand partnerships — host-read ads and branded content across our network.',
    breadcrumbName: 'Advertise',
    hero: {
      h1: 'Advertise on <span class="accent">podcasts people trust</span>',
      dek: 'Reach engaged, loyal audiences through host-read ads and branded content across the Straw Hut Media network.',
      cta: { label: 'Get advertising rates', href: '/contact?topic=advertising' },
    },
    intro:
      'Podcast listeners are among the most engaged, loyal, and action-taking audiences in media — and host-read endorsements carry a level of trust that display ads never will. Straw Hut Media offers advertising and brand partnerships across our network of award-winning original and partner shows, handled in-house from strategy to execution.',
    highlights: [
      { name: 'Host-read ads', text: 'Authentic endorsements read by the hosts your audience already trusts.' },
      { name: 'Branded content', text: 'Custom segments and integrations built around your product and message.' },
      { name: 'Network reach', text: 'Access an audience across a network of shows spanning many genres and demographics.' },
      { name: 'Full-funnel', text: 'From awareness to conversion, with tracking and creative handled for you.' },
    ],
    sections: [
      {
        h2: 'Why podcast advertising works',
        html:
          '<p>Podcasts are intimate. Listeners choose their shows, listen for hours, and build real relationships with hosts — which is exactly why a host-read recommendation converts far better than an interruptive ad. When the right show reaches the right audience with a genuine endorsement, advertising stops feeling like advertising and starts feeling like a tip from a friend.</p>',
      },
      {
        h2: 'How to advertise with us',
        html:
          '<p>Tell us your product, your goals, and your target audience, and we will match you to the shows and formats that fit — then handle the creative, the read, and the placement. Whether you want a single flight on one flagship show or a network-wide campaign, we make it simple. <a href="/contact?topic=advertising">Request rates and availability</a> to get started.</p>',
      },
    ],
    faq: [
      ['How do I advertise on a podcast?', 'To advertise on a Straw Hut Media podcast, contact us with your product, budget, and target audience. We match you to the right shows and formats — host-read ads or branded content — and handle the creative, the read, and the placement across our network.'],
      ['How much does podcast advertising cost?', 'Podcast advertising is typically priced by audience reach and format. Straw Hut Media scopes campaigns to your budget and goals, from a single flight on one show to a network-wide campaign. Contact us for current rates and availability.'],
      ['What is a host-read ad?', 'A host-read ad is an endorsement read by the podcast’s own host in their voice, rather than a pre-produced spot. Because listeners trust their hosts, host-read ads consistently outperform generic inserted ads.'],
      ['What kinds of brands advertise on Straw Hut Media shows?', 'A wide range — from consumer products to services to B2B brands — across our network of shows spanning many genres and audiences. We match each advertiser to the shows whose listeners fit their target.'],
    ],
    schema: {
      name: 'Podcast Advertising & Brand Partnerships',
      serviceType: 'Podcast advertising',
      description:
        'Podcast advertising and brand partnerships across the Straw Hut Media network — host-read ads and branded content that reach engaged, loyal podcast audiences.',
    },
  },

  {
    slug: 'podcast-studio-los-angeles',
    path: '/podcast-studio-los-angeles',
    navLabel: 'LA Studio',
    title: 'Podcast Studio in Los Angeles (Hollywood) | Straw Hut Media',
    description:
      'Book a professional podcast studio in Los Angeles. Straw Hut Media’s Hollywood studio offers pro audio and multi-camera 4K video by the hour — 1080p at $125/hr, 4K at $150/hr.',
    summary: 'Professional podcast studio in Los Angeles (Hollywood) — audio + multi-camera 4K video, booked by the hour.',
    breadcrumbName: 'LA Podcast Studio',
    hero: {
      h1: 'A podcast studio in <span class="accent">the heart of Hollywood</span>',
      dek: 'Professional audio and multi-camera 4K video, booked by the hour — the Los Angeles studio where great shows get made.',
      cta: { label: 'Book the studio', href: '/studio#book' },
    },
    intro:
      'Straw Hut Media’s podcast studio sits in the heart of Hollywood, Los Angeles — a fully-equipped, professional space built specifically for podcasting. Record broadcast-quality audio and stunning multi-camera video in a room designed to make you sound and look your best, then walk out with content ready to publish. Book by the hour, choose your setup, and reserve your time online.',
    highlights: [
      { name: 'Hollywood location', text: 'Centrally located in Los Angeles — easy for hosts, guests, and crews across the city.' },
      { name: 'Pro audio', text: 'Broadcast-quality microphones and acoustically-treated space for a clean, warm sound.' },
      { name: '4K multi-camera video', text: 'Up to four 4K cameras capture polished video for YouTube, Spotify, and social.' },
      { name: 'Two setups', text: 'The Podcast Table for interviews and panels, or the Cozy Couch for a relaxed vibe.' },
    ],
    sections: [
      {
        h2: 'Rates',
        html:
          '<p><strong>1080p HD — $125/hour.</strong> Full audio and video in 1080p, recorded and ready to publish.<br><strong>4K Ultra HD — $150/hour.</strong> Full audio and video captured on four 4K cameras for a cinematic look. Book enough time to cover setup and wrap — see the <a href="/studio">studio page</a> for booking details and tips.</p>',
      },
      {
        h2: 'Who books our LA studio',
        html:
          '<p>Independent creators, brands filming branded shows, agencies producing client content, and hosts who want a professional room without the overhead of building one. Whether you need a one-off session or a recurring weekly booking, the Straw Hut studio is built to make Los Angeles podcasters sound and look their best. New to this? Read <a href="/resources/how-to-start-a-podcast">how to start a podcast</a> first.</p>',
      },
    ],
    faq: [
      ['Where is the Straw Hut Media podcast studio located?', 'The Straw Hut Media podcast studio is in the heart of Hollywood, Los Angeles — a professional, fully-equipped space for recording podcast audio and multi-camera 4K video, available to book by the hour.'],
      ['How much does it cost to book a podcast studio in Los Angeles?', 'At Straw Hut Media’s Hollywood studio, a 1080p HD session is $125/hour and a 4K Ultra HD session is $150/hour, with full audio and video included. Book enough time to cover setup and wrap-up.'],
      ['Does the studio record video as well as audio?', 'Yes. The studio captures broadcast-quality audio and multi-camera video up to 4K on four cameras — ideal for YouTube, Spotify video, and social clips.'],
      ['Can I book the LA studio for a single session?', 'Yes. You can book by the hour for a one-off session or set up recurring bookings. Choose your setup and reserve your time online on the studio page.'],
    ],
    schema: {
      name: 'Podcast Studio Los Angeles',
      serviceType: 'Podcast recording studio rental',
      description:
        'Professional podcast recording studio in Hollywood, Los Angeles — pro audio and multi-camera 4K video by the hour. 1080p at $125/hour, 4K at $150/hour.',
      areaServed: { '@type': 'City', name: 'Los Angeles' },
      offers: [
        { '@type': 'Offer', name: '1080p HD studio session', priceCurrency: 'USD', price: '125', priceSpecification: { '@type': 'UnitPriceSpecification', price: '125', priceCurrency: 'USD', unitCode: 'HUR', unitText: 'per hour' } },
        { '@type': 'Offer', name: '4K Ultra HD studio session', priceCurrency: 'USD', price: '150', priceSpecification: { '@type': 'UnitPriceSpecification', price: '150', priceCurrency: 'USD', unitCode: 'HUR', unitText: 'per hour' } },
      ],
    },
  },
];

export function getServicePage(slug) {
  return SERVICE_PAGES.find((s) => s.slug === slug) || null;
}
