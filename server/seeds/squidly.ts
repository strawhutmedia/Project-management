import { pool } from '../db'
import { logError, logInfo } from '../diag'

// Seeds the first faceless-YouTube channel — "Squidly" — with its locked art
// style, recurring cast, and Episode 1 (fully scripted, scene by scene).
// Idempotent: keyed on the channel name so it only plants once. Mirrors the
// pattern of seeds/back_in_your_arms.ts (runs at boot from server/index.ts).

const ART_STYLE = `Art style: Classic mid-century hand-drawn children's picture-book illustration, in the technique of the original Curious George books by H.A. Rey. Loose, confident hand-inked black outlines with a slight brush taper. Coloring is soft, smoothly blended gouache — gently darker at the edges, warm and rounded, no visible grain. Simple facial features: small dot eyes, one simple curved smile, flat cream highlights. No detailed background — plain soft/white backdrop, no ground shadow. Warm, cheerful, cozy, timeless.`

type SeedCharacter = { name: string; role: string; lookLock: string; personality: string }

const CHARACTERS: SeedCharacter[] = [
  {
    name: 'Squidly',
    role: 'Main character',
    lookLock:
      'A small young squid rendered in the locked hand-drawn Curious George style. Round soft head, small dot eyes, tiny curved smile, rosy cheeks. Coral-orange body with soft blended gouache shading (gently darker at the edges), soft cream belly. Eight short rounded arms he uses like little hands, tips that curl; two slightly longer tentacles. One arm often raised mid-wave or mid-question. Soft, huggable, wide-eyed with wonder.',
    personality:
      'Curious about everything, especially the human/surface world. Kind-hearted and always means well, but gets carried away — his curiosity tips into nosiness, which is where the gentle trouble comes from. Always learns, says sorry, and makes it right.',
  },
  {
    name: 'Suds',
    role: 'Best friend (comic relief)',
    lookLock:
      "A small, squishy natural sea sponge in the same hand-inked, smooth-gouache Curious George style. Irregular rounded blobby shape covered in little holes (pores), warm ochre-yellow color with soft blended shading. Simple dot eyes and a wide expressive mouth drawn right on the sponge — no arms, no legs (that's the joke: he can't move). Always being carried or propped on a ledge. Squishy, goofy, lovable. Deliberately NOT square and NOT wearing clothes — a real blobby sponge, nothing like SpongeBob.",
    personality:
      "The funny one. Big opinions, great comic timing, a little dramatic, secretly loyal. Because he can't move himself, he's pure commentary — the reactions and deadpan asides. Also Squidly's little conscience: when curiosity tips into nosy, Suds is usually the one saying 'this is not our business, my friend.'",
  },
  {
    name: 'Tuck',
    role: 'Mentor',
    lookLock:
      'An old, calm sea turtle in the locked hand-drawn Curious George style. Rounded shell with soft blended gouache shading, gentle wrinkled face, kind half-moon eyes, small warm smile. Moves slowly. Grandfatherly and reassuring.',
    personality:
      "Slow, kind, patient, a little wise. Squidly's gentle guide — the grown-up who helps him find the lesson without ever scolding. The show's Man-in-the-Yellow-Hat figure.",
  },
]

type SeedScene = { visual: string; narration: string }

const EP1_SCENES: SeedScene[] = [
  {
    visual:
      'Coral Cove in the morning, sunbeams striping down through blue water. Squidly swims along carrying Suds tucked under one arm; both look up toward the shimmering surface.',
    narration:
      'Deep down in Coral Cove, where the water is warm and the sun comes down in stripes, lived a small squid named Squidly — and his very best friend, Suds. Suds was a sponge. And sponges can\'t swim, or float, or go anywhere at all. So Squidly carried him everywhere.\nSquidly: "Isn\'t it a beautiful morning, Suds?"\nSuds: "It would be more beautiful if you\'d stop holding me upside down."',
  },
  {
    visual:
      'A shiny glass bottle sinks down through the sunbeams, a little rolled-up paper inside. Squidly\'s eyes go huge; Suds squints.',
    narration:
      'Just then, something drifted down from above. Down, down, down… a shiny glass bottle — with a little rolled-up paper inside.\nSquidly: "Ooh! Suds — what is that?"\nSuds: "It\'s a bottle. Can we go home now?"\nSquidly: "We are not going home."',
  },
  {
    visual: 'Squidly turns the bottle over in his little arms; Suds propped on top of his head.',
    narration:
      'Squidly turned it this way. He turned it that way. The paper had colors on it.\nSquidly: "Is it a picture? A secret? A treasure map? Whose is this? I have to find out!"\nSuds: "Or… hear me out… we mind our own business."\nSquidly: "Never heard of it."',
  },
  {
    visual:
      "Squidly pokes into Ollie Octopus's tidy den, nudging her neat little pots; Suds tucked under his arm.",
    narration:
      'First, Squidly peeked into Ollie Octopus\'s tidy den, poking through her things.\nSquidly: "Is this yours, Ollie?"\nOllie: "It is not — and please don\'t poke my pots!"\nSuds: "Told you."',
  },
  {
    visual: "Squidly reaches for Old Crab's rock; the crab jolts awake underneath.",
    narration:
      'Suds: "Squidly. Buddy. That\'s a sleeping crab\'s roof."\nSquidly: "I just want to see!"\nHe lifted the rock anyway.\nOld Crab: "BUBBLES! A fellow can\'t even nap!"\nSquidly\'s cheeks went pink.\nSuds: "That\'s what curious always says… right before it turns nosy."',
  },
  {
    visual: 'Tuck the old sea turtle glides in, slow and calm.',
    narration:
      'Along came Tuck, the old sea turtle, slow and kind.\nTuck: "Squidly — wondering is a wonderful thing. But peeking in homes and lifting nap-rocks? That\'s not curious. That\'s a little bit nosy."\nSuds: "Finally. A grown-up."',
  },
  {
    visual: 'Tuck, Squidly, and Suds together in a quiet spot.',
    narration:
      'Squidly: "Then how do I find out whose it is?"\nTuck: "When you want to know something about someone, you don\'t sneak, Squidly. You ask."',
  },
  {
    visual:
      'Squidly apologizing to Ollie and Old Crab; then everyone gathers kindly around the little drawing.',
    narration:
      'So Squidly said sorry to Ollie, and sorry to Old Crab. And then — he asked.\nSquidly: "Does anyone know whose this is?"\nThey looked at the paper together — a drawing of a house, a sun, and a child.\nTuck: "This didn\'t come from the reef, Squidly. It came from up there. The world above."',
  },
  {
    visual: 'Squidly holds the drawing, gazing up at the sunlit surface; Suds beside him.',
    narration:
      'Squidly held the little drawing and looked up, up, up. Somewhere up there was a child who drew suns and houses.\nSquidly: "One day, Suds, we\'re going to see that world for ourselves."\nSuds: "We? I can\'t even see over this rock."\nSquidly: "That\'s why I\'ll carry you."\nSuds: "…Okay. That\'s actually really nice."',
  },
  {
    visual: 'Coral Cove at dusk; Squidly waves one arm, Suds tucked under the other. (Reusable series sign-off.)',
    narration:
      'Goodnight, Coral Cove. Goodnight, Squidly. Goodnight, Suds. See you next time — when something new drifts down from above. Stay curious!',
  },
]

export async function seedSquidly(): Promise<void> {
  try {
    const existing = await pool.query('SELECT id FROM channels WHERE name = $1 LIMIT 1', ['Squidly'])
    if (existing.rows.length > 0) return

    // Attribute the channel to the admin (Ryan) when present.
    const admin = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
    )
    const createdBy = admin.rows[0]?.id ?? null

    const ch = await pool.query<{ id: string }>(
      `INSERT INTO channels (name, subtitle, premise, audience, art_style, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        'Squidly',
        'A curious little squid who dreams of the world above',
        'Squidly is a small, curious squid who dreams of the world beyond the ocean — and keeps learning where curious ends and nosy begins. Same character, same world every episode; only the feeling changes (calm, silly, or adventurous). A character-driven, faceless kids show in the storybook style of Curious George.',
        'Little kids, ages 3–6',
        ART_STYLE,
        createdBy,
      ],
    )
    const channelId = ch.rows[0].id

    let pos = 0
    for (const c of CHARACTERS) {
      pos += 10
      await pool.query(
        `INSERT INTO channel_characters (channel_id, name, role, look_lock, personality, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [channelId, c.name, c.role, c.lookLock, c.personality, pos],
      )
    }

    const ep = await pool.query<{ id: string }>(
      `INSERT INTO channel_episodes
         (channel_id, episode_number, title, feeling, logline, youtube_title,
          thumbnail_concept, short_concept, status, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'script', $9) RETURNING id`,
      [
        channelId,
        1,
        'Squidly and the Bottle from Above',
        'warm & funny, with a gentle adventure',
        'A bottle drifts down from the surface with a child\'s drawing inside; Squidly\'s hunt for its owner tips from curious into nosy until Tuck teaches him to ask instead of snoop.',
        'Squidly and the Bottle from Above 🐙 | A Curious Little Squid Story for Kids',
        'Squidly wide-eyed hugging the glowing bottle, Suds squished under his other arm pulling a funny face, bright sunbeams behind them.',
        'The nap-rock beat (Scene 5) — on-screen hook: "When \'curious\' turns a little too NOSY 🙊"',
        10,
      ],
    )
    const episodeId = ep.rows[0].id

    let spos = 0
    for (const s of EP1_SCENES) {
      spos += 10
      await pool.query(
        `INSERT INTO episode_scenes (episode_id, position, visual, narration)
         VALUES ($1, $2, $3, $4)`,
        [episodeId, spos, s.visual, s.narration],
      )
    }

    logInfo('seeded Squidly channel', { channelId, episodeId })
  } catch (err) {
    logError('seedSquidly failed', { error: err instanceof Error ? err.message : String(err) })
  }
}
