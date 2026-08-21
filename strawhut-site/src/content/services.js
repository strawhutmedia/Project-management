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
      { name: 'Creative direction', text: 'A creative director prepping every brief, script, and rundown and guiding hosts and guests through recording and post — so the talent can focus purely on the content while we shape the show.' },
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
        'Full-service podcast production: show development, creative direction, studio recording, editing, sound design, distribution, growth, and monetization for creators, brands, and businesses.',
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

];

export function getServicePage(slug) {
  return SERVICE_PAGES.find((s) => s.slug === slug) || null;
}
